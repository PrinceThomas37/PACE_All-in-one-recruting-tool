// "REWRITE WITH AI" ON ONE WAITING FIRST EMAIL (R-319, owner's 28 notes): the REAL routes/email-rewrite.js over an in-memory database.
//   * it rewrites the ONE email asked for, stores the AI text (template_variant 'ai') and hands back the old wording to undo with;
//   * Undo puts the old wording back exactly (and its template_variant), and only while the email is still waiting;
//   * the writer is the shared one (aiDraftFirstEmail) — a draft the house checker rejects, or no AI today, leaves the wording
//     UNCHANGED and says why in words (never an error, never half-written text);
//   * only the sender's own email (a manager gets 404, D-0020), only a still-pending one (409), only a FIRST email (400);
//   * an email that went out in the middle of the AI's thinking time is never overwritten (conditional write).
// A guard that cannot fail is not a guard: the "unchanged" checks read the stored row back, they do not trust the response.
// Usage: node test/email-rewrite-smoke.mjs
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const O = 'org-a';
const users = [
  { id: 'bd1', role: 'bd' }, { id: 'bd2', role: 'bd' }, { id: 'lead', role: 'bd_lead' }, { id: 'cand', role: 'recruiter' },
].map(u => ({ ...u, org_id: O, deleted_at: null }));
const email = (id, over) => Object.assign({
  id, org_id: O, status: 'pending', subject: 'Template subject', body: 'Template body {{sender}}', job_id: 'j1', contact_id: 'c1', sent_by: 'bd1',
  from_email: 'bd1@x.test', to_email: 'dana@acme.test', followup_type: null, template_variant: null, sending_email_id: null,
}, over || {});
const fake = createFakeDb({
  tables: {
    users,
    jobs: [{ id: 'j1', org_id: O, sending_email_id: 'mb1' }],
    user_emails: [{ id: 'mb1', org_id: O, email_address: 'bea@x.test', display_name: 'Bea Smith', user_id: 'bd1' }],
    emails: [email('e1'), email('e2', { followup_type: 'fu1' }), email('e3', { status: 'sent' }), email('e4', { sent_by: 'bd2' }), email('e5'), email('e6')],
    app_settings: [],
  },
  relations: { emails: { job: { table: 'jobs', fk: 'job_id' } }, jobs: { sending_email: { table: 'user_emails', fk: 'sending_email_id' } } },
});
const supabase = fake.supabase;
const { createDb } = require(path.join(ROOT, 'models/index.js'));
const db = createDb(supabase);
const { hasRole } = require(path.join(ROOT, 'middleware/authorize.js'))({ supabase });
const row = (id) => fake.T('emails').find(r => r.id === id);

let aiOn = true, draft = null, draftCalls = [];
const ctx = {
  supabase, db, hasRole,
  auth: (req, res, next) => { const u = users.find(x => x.id === req.headers['x-user']); if (!u) return res.status(401).json({ error: 'no user' }); req.user = { id: u.id, org_id: O, role: u.role, roles: [u.role] }; req.orgId = O; next(); },
  loadMailboxSignatures: async (ids) => Object.fromEntries(ids.map(i => [i, '<p>--<br>{{sender}}</p>'])),
  aiProvider: { availability: async () => ({ available: aiOn }) },
  aiDraftFirstEmail: async (e, mailbox, sig) => { draftCalls.push({ id: e.id, mailbox: mailbox && mailbox.id, sig }); return { res: typeof draft === 'function' ? await draft(e) : draft, c: {} }; },
};
const app = express(); app.use(express.json()); app.use(require(path.join(ROOT, 'routes/email-rewrite.js'))(ctx));
const server = app.listen(0, '127.0.0.1'); await new Promise(res => server.once('listening', res));
const post = (who, p, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port: server.address().port, path: p, method: 'POST', headers: { 'x-user': who, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let out = ''; res.on('data', d => { out += d; }); res.on('end', () => { let json = null; try { json = JSON.parse(out); } catch (_) {} resolve({ status: res.statusCode, json }); });
  }); r.on('error', reject); r.end(data);
});

// ── the happy path ──
draft = { subject: 'Your Estimator opening', body: 'Hi Dana,\n\nI saw the Estimator role.\n\n{{sender}}', repaired: false };
let r = await post('bd1', '/emails/e1/rewrite-ai');
step('a rewrite answers written:true with the new wording', r.status === 200 && r.json.ai === true && r.json.written === true && /Estimator opening/.test(r.json.email.subject), JSON.stringify(r.json).slice(0, 160));
step('…the AI text is STORED (read back), marked as an AI draft', row('e1').subject === 'Your Estimator opening' && row('e1').template_variant === 'ai' && /I saw the Estimator role/.test(row('e1').body));
step('…the screen is handed the sender\'s real name, never a raw {{sender}}', !/\{\{sender\}\}/.test(r.json.email.body) && /Bea Smith/.test(r.json.email.body), r.json.email.body);
step('…and the OLD wording comes back untouched, raw, to undo with', r.json.previous && r.json.previous.subject === 'Template subject' && r.json.previous.body === 'Template body {{sender}}' && r.json.previous.template_variant === null);
step('…the shared writer was asked once, for that email, with the mailbox that sends it and its signature (so it does not sign twice)', draftCalls.length === 1 && draftCalls[0].id === 'e1' && draftCalls[0].mailbox === 'mb1' && /\{\{sender\}\}/.test(draftCalls[0].sig));
step('…and no OTHER email was touched', row('e5').subject === 'Template subject' && row('e6').template_variant === null && row('e4').subject === 'Template subject');

// ── undo ──
const prev = r.json.previous;
r = await post('bd1', '/emails/e1/rewrite-ai', { restore: prev });
step('Undo puts the old wording back, exactly, and the stored row proves it', r.status === 200 && r.json.restored === true && row('e1').subject === 'Template subject' && row('e1').body === 'Template body {{sender}}' && row('e1').template_variant === null);
step('…the screen gets the rendered old wording', /Bea Smith/.test(r.json.email.body) && !/\{\{sender\}\}/.test(r.json.email.body));

// ── the AI cannot / will not ──
draft = { skipped: 'draft_rejected', violations: ['invented_fact'] };
r = await post('bd1', '/emails/e5/rewrite-ai');
step('a draft the house checker rejects leaves the wording UNCHANGED and says so in words', r.status === 200 && r.json.written === false && /house rules/.test(r.json.reason) && row('e5').subject === 'Template subject' && row('e5').template_variant === null, r.json.reason);
draft = { skipped: 'ai_unavailable' };
r = await post('bd1', '/emails/e5/rewrite-ai');
step('an AI that does not answer is a plain sentence, not an error', r.status === 200 && r.json.written === false && /did not answer/.test(r.json.reason));
aiOn = false; draftCalls = [];
r = await post('bd1', '/emails/e5/rewrite-ai');
step('no AI today (switched off / allowance used) → the reason, and the writer is never even called', r.status === 200 && r.json.ai === false && r.json.written === false && /allowance/.test(r.json.reason) && draftCalls.length === 0);
aiOn = true;

// ── who and what ──
draft = { subject: 'S', body: 'B', repaired: false };
r = await post('lead', '/emails/e1/rewrite-ai');
step('a manager cannot rewrite the sender\'s email — it does not exist for them (404, D-0020)', r.status === 404 && row('e1').template_variant === null);
r = await post('bd2', '/emails/e1/rewrite-ai');
step('another BD gets 404 too', r.status === 404);
r = await post('bd1', '/emails/e4/rewrite-ai');
step('…and a BD cannot reach an email that is not theirs by id (404), nothing changes', r.status === 404 && row('e4').subject === 'Template subject');
r = await post('cand', '/emails/e1/rewrite-ai');
step('a role that does not send leads\' emails is refused (403)', r.status === 403);
r = await post('bd1', '/emails/e3/rewrite-ai');
step('an email that has already been sent cannot be rewritten (409) and is unchanged', r.status === 409 && row('e3').subject === 'Template subject' && row('e3').template_variant === null);
r = await post('bd1', '/emails/e2/rewrite-ai');
step('a follow-up is not rewritten here (400) — the button is for a lead\'s first email', r.status === 400 && row('e2').subject === 'Template subject');
r = await post('bd1', '/emails/e3/rewrite-ai', { restore: { subject: 'x', body: 'y' } });
step('Undo is refused for an email that is no longer waiting (409)', r.status === 409 && row('e3').subject === 'Template subject');
r = await post('nobody', '/emails/e1/rewrite-ai');
step('no sign-in → 401', r.status === 401);

// ── the race: it goes out while the AI is thinking ──
draft = async (e) => { row('e6').status = 'sent'; return { subject: 'Late', body: 'Late', repaired: false }; };
r = await post('bd1', '/emails/e6/rewrite-ai');
step('an email that went out while the AI was writing is NEVER overwritten (409; the sent text is what was sent)', r.status === 409 && row('e6').subject === 'Template subject' && row('e6').template_variant === null, JSON.stringify(r.json));

server.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
