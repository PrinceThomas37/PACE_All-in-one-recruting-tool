// EMAIL THE SUBMISSION DETAILS, WITH THE RÉSUMÉ (R-092, D-0066).
// Owner: "when a candidate is submitted to BDM or to client, a send email option should be there with
// submission details. I need that." — "yes it should be able to attach resume."
//   part 1 the words (pure): only what the submission holds; an empty field is left out
//   part 2 the server: who it can go to, the résumé rides along (only THIS candidate's), Cc, tracking,
//          the client copy is BD-only, a foreign mailbox / foreign org is refused BEFORE anything is sent
//   part 3 the windows (real browser): the section is in the recruiter's "Submit to BD Manager" window and in
//          the stage window for "Submitted to Client"; the email goes out only AFTER the move is saved
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── part 1 ───────────────────────────────────────────────────────────────────
const se = require('../services/submission-email');
const CAND = { full_name: 'Sarah Chen', email: 'sarah@x.test', phone: '+1 555 0100', city: 'Austin', state: 'TX', current_title: 'Estimator', current_employer: 'BuildCo', work_authorization: 'US Citizen' };
const SUB = { submission_details: { first_name: 'Sarah', last_name: 'Chen', email: 'sarah@x.test', mobile: '+1 555 0100', home_phone: 'N/A', work_auth: 'US Citizen', current_location: 'Austin, TX', relocation: 'Open to relocate', availability: '2 weeks', comment: 'Strong estimator, 8 years in commercial HVAC.' } };
const JOB = { job_title: 'Estimator', job_code: 'JO-7', client: 'Acme' };
const bdm = se.buildSubmissionEmail({ kind: 'bdm', sub: SUB, candidate: CAND, job: JOB, note: 'Please look today.', toName: 'Neil Patrick', senderName: 'Priya', attachmentCount: 1 });
step('subject names the person and the role', bdm.subject === 'Submission for review: Sarah Chen — Estimator (JO-7)', bdm.subject);
step('BD copy: greets the manager, says who submitted, carries the note, the details and the comment', /^Hi Neil,/.test(bdm.text) && /Priya has submitted a candidate/.test(bdm.text) && /Please look today\./.test(bdm.text) && /Relocation: Open to relocate/.test(bdm.text) && /Strong estimator, 8 years/.test(bdm.text) && /The résumé is attached\./.test(bdm.text), bdm.text.slice(0, 200));
step('"N/A" and empty fields are left out, never printed', !/Home phone/.test(bdm.text) && !/N\/A/.test(bdm.text));
const cl = se.buildSubmissionEmail({ kind: 'client', sub: SUB, candidate: CAND, job: JOB, attachmentCount: 2 });
step('client copy: no named greeting, speaks of the client, counts the files', /^Hello,/.test(cl.text) && /for Estimator \(JO-7\) at Acme/.test(cl.text) && /\(2 files\)/.test(cl.text) && /^Candidate submission: /.test(cl.subject));
step('with no stored details it still states what the candidate record holds', /Email: sarah@x\.test/.test(se.buildSubmissionEmail({ kind: 'client', sub: {}, candidate: CAND, job: JOB }).text));
const ok = (a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a);
step('addresses: list or comma string, "Name <a@b.com>", duplicates and junk dropped', JSON.stringify(se.parseAddresses('a@x.com, B@y.com; a@X.com, nope, Jo <jo@z.com>', ok)) === '["a@x.com","B@y.com","jo@z.com"]');

// ── part 2 ───────────────────────────────────────────────────────────────────
const ORG = 'org-a', ME = 'u-me';
const D = {
  user_emails: [{ id: 'mb1', user_id: ME, org_id: ORG, email_address: 'me@ours.com', display_name: 'Priya', is_primary: true, is_active: true, platform: 'Microsoft' },
    { id: 'mb-theirs', user_id: 'u-x', org_id: ORG, email_address: 'x@ours.com', is_primary: true, is_active: true, platform: 'Microsoft' }],
  microsoft_tokens: [{ user_email_id: 'mb1' }, { user_email_id: 'mb-theirs' }], gmail_tokens: [],
  submissions: [{ id: 'sub1', org_id: ORG, deleted_at: null, stage: 'Submitted to BDM', submission_details: SUB.submission_details, candidate_id: 'cd1', job_order_id: 'jo1', recruiter_id: ME,
    candidate: CAND, job: Object.assign({ id: 'jo1', company_id: 'co1', bd_manager: { id: 'bd1', name: 'Neil Patrick', email: 'neil@ours.com' } }, JOB) },
    { id: 'sub-foreign', org_id: 'org-b', deleted_at: null, candidate_id: 'cdx', job_order_id: 'jox', candidate: CAND, job: JOB }],
  candidate_documents: [
    { id: 'd-new', candidate_id: 'cd1', org_id: ORG, doc_type: 'resume', filename: 'Sarah_Submission.doc', storage_path: 'cd1/new', uploaded_at: '2026-10-01', deleted_at: null },
    { id: 'd-old', candidate_id: 'cd1', org_id: ORG, doc_type: 'resume', filename: 'Sarah.pdf', storage_path: 'cd1/old', uploaded_at: '2026-09-01', deleted_at: null },
    { id: 'd-other', candidate_id: 'cd-other', org_id: ORG, doc_type: 'resume', filename: 'Someone_else.pdf', storage_path: 'x/other', uploaded_at: '2026-09-01', deleted_at: null }],
  jobs: [{ id: 'lead1', company_id: 'co1', org_id: ORG, deleted_at: null, created_at: '2026-09-01', contacts: [{ first_name: 'Dana', last_name: 'Cruz', email: 'dana@acme.test', email_status: 'valid' }, { first_name: 'Bad', last_name: 'Box', email: 'bad@acme.test', email_status: 'invalid' }] }],
};
const inserted = [];
function table(name) {
  const f = [], st = {};
  const rows = () => { const all = (D[name] || []).filter(r => f.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'is' ? (r[k] == null) === (v == null) : true)); return st.limit ? all.slice(0, st.limit) : all; };
  const api = { select() { return api; }, eq(k, v) { f.push(['eq', k, v]); return api; }, in(k, v) { f.push(['in', k, v]); return api; }, is(k, v) { f.push(['is', k, v]); return api; }, not() { return api; },
    order() { return api; }, limit(n) { st.limit = n; return api; }, single() { const r = rows()[0]; return Promise.resolve(r ? { data: r, error: null } : { data: null, error: { message: 'none' } }); },
    maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
    insert(p) { inserted.push({ table: name, row: p }); return Promise.resolve({ data: null, error: null }); }, upsert() { return Promise.resolve({ data: null, error: null }); },
    then(a, b) { return Promise.resolve({ data: rows(), error: null }).then(a, b); } };
  return api;
}
const supabase = { from: table, storage: { from: () => ({ download: async (p) => ({ data: { arrayBuffer: async () => Buffer.from('FILE:' + p) }, error: null }) }) } };
const sent = [];
const handlers = {};
const app = new Proxy({}, { get: (_t, verb) => (p, ...fns) => { handlers[verb.toUpperCase() + ' ' + p] = fns[fns.length - 1]; } });
const ctx = { supabase, auth: (_q, _s, n) => n(), hasRole: (req, ...roles) => roles.some(r => (req.user.roles || []).includes(r)), today: () => '2026-10-01',
  wfEngine: { registerChannel() {}, registerContextLoader() {}, exitEntity() {} }, gmailProvider: {}, config: {}, settingsConfig: { getSetting: async () => 0 },
  graphMailRequest: async () => ({}), sendMicrosoftNewMessage: async (mailboxId, m) => { sent.push({ mailboxId, to: m.to, cc: m.cc, subject: m.subject, html: m.htmlBody, attachments: m.attachments }); return { graphMessageId: 'g1', conversationId: 'c1' }; },
  buildHtmlEmailBody: (t, sig) => '<div>' + t + '</div>' + (sig || ''), getMailboxSignature: async () => '', getMicrosoftToken: async () => 't', warmupLimit: () => 999,
  isSendingPaused: () => false, isManagerPaused: () => false, loadMailboxDelivState: async () => ({}), loadSuppressedSet: async () => new Set(), friendlySendError: (e) => String(e && e.message || e) };
require('../routes/recruiting/outreach.js')(app, ctx);
async function call(key, { user, body, params, query }) {
  let status = 200, out = null; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await handlers[key]({ user: user || { id: ME, roles: ['ra'] }, orgId: ORG, body: body || {}, params: params || {}, query: query || {}, headers: {} }, res); return { status, body: out };
}
const BD = { id: ME, roles: ['bd'] };   // a BD manager who has a connected mailbox
let r = await call('GET /submissions/:id/submission-email/options', { params: { id: 'sub1' }, query: { kind: 'bdm' } });
step('options (BDM copy): suggests the job\'s BD manager and lists the candidate\'s résumés, newest first', r.status === 200 && r.body.suggestions[0].email === 'neil@ours.com' && r.body.documents.map(d => d.id).join() === 'd-new,d-old', JSON.stringify(r.body));
r = await call('GET /submissions/:id/submission-email/options', { params: { id: 'sub1' }, query: { kind: 'client' }, user: BD });
step('options (client copy): suggests people we know at the client — never an invalid address', r.body.suggestions.map(s => s.email).join() === 'dana@acme.test', JSON.stringify(r.body.suggestions));
r = await call('GET /submissions/:id/submission-email/options', { params: { id: 'sub1' }, query: { kind: 'nope' } });
step('options: an unknown kind is refused', r.status === 400);
r = await call('GET /submissions/:id/submission-email/options', { params: { id: 'sub-foreign' }, query: { kind: 'bdm' } });
step('options: another organisation\'s submission reads as absent', r.status === 404);

sent.length = 0;
r = await call('POST /submissions/:id/submission-email', { params: { id: 'sub1' }, body: { kind: 'bdm', to: 'neil@ours.com', cc: 'a@x.com, b@y.com', note: 'Please look today.', attach_doc_ids: ['d-new'], mailbox_id: 'mb1' } });
step('BDM copy is sent from the chosen mailbox with the résumé attached', r.status === 200 && sent.length === 1 && sent[0].to === 'neil@ours.com' && sent[0].attachments.length === 1 && sent[0].attachments[0].filename === 'Sarah_Submission.doc', JSON.stringify(r.body));
step('…Cc carries both extra addresses; the body has the details and the note', sent[0] && sent[0].cc.join() === 'a@x.com,b@y.com' && /Strong estimator/.test(sent[0].html) && /Please look today/.test(sent[0].html));
step('…and it is tracked as a "submission" email on the candidate and the job', inserted.some(i => i.table === 'email_tracking' && i.row.channel === 'submission' && i.row.candidate_id === 'cd1' && i.row.job_order_id === 'jo1' && i.row.to_email === 'neil@ours.com'));
sent.length = 0;
r = await call('POST /submissions/:id/submission-email', { params: { id: 'sub1' }, body: { kind: 'bdm', to: 'neil@ours.com' } });
step('nothing said about attachments → the candidate\'s LATEST résumé is attached', sent.length === 1 && sent[0].attachments.length === 1 && sent[0].attachments[0].filename === 'Sarah_Submission.doc');
sent.length = 0;
r = await call('POST /submissions/:id/submission-email', { params: { id: 'sub1' }, body: { kind: 'bdm', to: 'neil@ours.com', attach_doc_ids: [] } });
step('an empty list means "attach nothing" — and the mail says no résumé is attached', sent.length === 1 && sent[0].attachments.length === 0 && !/résumé is attached/.test(sent[0].html));
sent.length = 0;
r = await call('POST /submissions/:id/submission-email', { params: { id: 'sub1' }, body: { kind: 'bdm', to: 'neil@ours.com', attach_doc_ids: ['d-other'] } });
step('another candidate\'s résumé can never ride along — refused, NOTHING sent', r.status === 409 && sent.length === 0, r.status + ' ' + JSON.stringify(r.body));
r = await call('POST /submissions/:id/submission-email', { params: { id: 'sub1' }, body: { kind: 'bdm', to: 'not an email' } });
step('no valid address → 400, nothing sent', r.status === 400 && sent.length === 0);
r = await call('POST /submissions/:id/submission-email', { params: { id: 'sub1' }, body: { kind: 'bdm', to: 'neil@ours.com', mailbox_id: 'mb-theirs' } });
step('a mailbox that is not yours is refused before anything is sent', r.status === 404 && sent.length === 0);
r = await call('POST /submissions/:id/submission-email', { params: { id: 'sub1' }, body: { kind: 'client', to: 'dana@acme.test' } });
step('the client copy is the BD team\'s: a recruiter is refused', r.status === 403 && sent.length === 0);
sent.length = 0;
r = await call('POST /submissions/:id/submission-email', { params: { id: 'sub1' }, user: BD, body: { kind: 'client', to: 'dana@acme.test', attach_doc_ids: ['d-old'] } });
step('…a BD manager sends it, with the résumé they ticked', r.status === 200 && sent.length === 1 && sent[0].attachments[0].filename === 'Sarah.pdf' && /^Candidate submission: /.test(sent[0].subject));
sent.length = 0;
r = await call('POST /submissions/:id/submission-email', { params: { id: 'sub-foreign' }, body: { kind: 'bdm', to: 'neil@ours.com' } });
step('another organisation\'s submission: 404, nothing sent', r.status === 404 && sent.length === 0);

// ── part 3 ───────────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise(rr => server.listen(0, '127.0.0.1', () => rr(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx2 = await browser.newContext(); await ctx2.route('**', rt => rt.request().url().startsWith(BASE) ? rt.continue() : rt.abort());
  const page = await ctx2.newPage(); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);
  const OPTS = { suggestions: [{ email: 'neil@ours.com', name: 'Neil Patrick', role: 'BD manager' }], documents: [{ id: 'd-new', filename: 'Sarah_Submission.doc' }, { id: 'd-old', filename: 'Sarah.pdf' }] };
  await ev((o) => { window.__calls = []; window.__patchFails = false;
    window.apiGet = (u) => /submission-email\/options/.test(u) ? Promise.resolve(o) : (/^\/candidates\//.test(u) ? Promise.resolve({ id: 'c1', full_name: 'Sarah Chen', email: 'sarah@x.test', first_name: 'Sarah', last_name: 'Chen' }) : Promise.resolve([]));
    window.apiPatch = (u, b) => { window.__calls.push({ m: 'PATCH', u, b }); return window.__patchFails ? Promise.reject(new Error('refused')) : Promise.resolve({ id: 's1', stage: b.stage }); };
    window.apiPost = (u, b) => { window.__calls.push({ m: 'POST', u, b }); return Promise.resolve({ to: b.to, attached: ['x'] }); };
    STATE.bd = STATE.bd || {}; STATE.bd.jobOrders = [{ id: 'job1', job_code: 'JO-1', job_title: 'Estimator', client: 'Acme' }];
    STATE.bd.submissions = [{ id: 's1', job_order_id: 'job1', stage: 'Submitted to BDM', candidate: { id: 'c1', full_name: 'Sarah Chen' } }]; }, OPTS);

  // (a) the stage window for "Submitted to Client"
  await ev(() => openStageModal('s1', 'Submitted to Client', null));
  await page.waitForSelector('.se-doc', { timeout: 5000 });
  const win = await ev(() => ({ on: document.getElementById('se-on').checked, docs: [...document.querySelectorAll('.se-doc')].map(x => x.value + ':' + x.checked), cc: !!document.querySelector('#se-box [data-chipf]'), from: !!document.getElementById('se-from') }));
  step('"Submitted to Client" window offers the email: résumés listed, the newest ticked, Cc chips, a From picker', win.on && win.docs.join() === 'd-new:true,d-old:false' && win.cc && win.from, JSON.stringify(win));
  await ev(() => { document.getElementById('stg-note').value = 'Sent'; stgApply(); });
  await page.waitForTimeout(200);
  let c = await ev(() => window.__calls);
  step('no address typed → refused up front; neither the move nor an email happened', c.length === 0);
  await ev(() => { document.getElementById('se-to').value = 'dana@acme.test'; document.getElementById('se-note').value = 'Strong fit'; stgApply(); });
  await page.waitForTimeout(300);
  c = await ev(() => window.__calls);
  const patchI = c.findIndex(x => x.m === 'PATCH'), postI = c.findIndex(x => x.m === 'POST' && /submission-email/.test(x.u));
  step('the move is saved FIRST, then the email goes (kind=client, the ticked résumé, the note)', patchI === 0 && postI === 1 && c[postI].b.kind === 'client' && c[postI].b.to === 'dana@acme.test' && c[postI].b.attach_doc_ids.join() === 'd-new' && c[postI].b.note === 'Strong fit', JSON.stringify(c));
  // a failed move sends nothing
  await ev(() => { window.__calls = []; window.__patchFails = true; openStageModal('s1', 'Submitted to Client', null); });
  await page.waitForSelector('.se-doc', { timeout: 5000 });
  await ev(() => { document.getElementById('stg-note').value = 'Sent'; document.getElementById('se-to').value = 'dana@acme.test'; stgApply(); });
  await page.waitForTimeout(300);
  c = await ev(() => window.__calls);
  step('if the move fails, NO email is sent', c.some(x => x.m === 'PATCH') && !c.some(x => /submission-email/.test(x.u || '')));
  // unticked → no email
  await ev(() => { window.__calls = []; window.__patchFails = false; closeModal(); openStageModal('s1', 'Submitted to Client', null); });
  await page.waitForSelector('.se-doc', { timeout: 5000 });
  await ev(() => { document.getElementById('se-on').checked = false; document.getElementById('stg-note').value = 'Sent'; stgApply(); });
  await page.waitForTimeout(300);
  c = await ev(() => window.__calls);
  step('email unticked → the move happens, no email', c.some(x => x.m === 'PATCH') && !c.some(x => /submission-email/.test(x.u || '')));
  // other stages do not show it
  await ev(() => { closeModal(); openStageModal('s1', 'Offer', null); });
  step('other stages do not offer it', await ev(() => !document.getElementById('se-box')));

  // (b) the recruiter's "Submit to BD Manager" window
  await ev(() => { window.__calls = []; closeModal(); STATE.user = Object.assign({}, STATE.user); openSubmitToBDMModal('s1', null, { candidateId: 'c1', name: 'Sarah Chen' }); });
  await page.waitForSelector('#se-to', { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('se-to').value === 'neil@ours.com', null, { timeout: 5000 }).catch(() => {});
  const bw = await ev(() => ({ to: document.getElementById('se-to').value, attach: document.getElementById('se-attach').checked }));
  step('"Submit to BD Manager" offers the email, To already filled with the job\'s BD manager, résumé ticked', bw.to === 'neil@ours.com' && bw.attach, JSON.stringify(bw));
  await ev(() => { document.getElementById('sbdm-first').value = 'Sarah'; document.getElementById('sbdm-email').value = 'sarah@x.test'; document.getElementById('sbdm-comment').value = 'Strong estimator'; sbdmSubmit(); });
  await page.waitForTimeout(400);
  c = await ev(() => window.__calls);
  const p2 = c.findIndex(x => x.m === 'PATCH'), q2 = c.findIndex(x => x.m === 'POST' && /submission-email/.test(x.u));
  step('recruiter: the stage moves first, then the BDM copy goes (no files uploaded here → the server attaches the latest résumé)', p2 >= 0 && q2 > p2 && c[q2].b.kind === 'bdm' && c[q2].b.to === 'neil@ours.com' && c[q2].b.attach_doc_ids === undefined, JSON.stringify(c.map(x => x.m + ' ' + x.u)));
  step('No page errors', errs.length === 0, errs.join('|'));
} catch (e) { console.log('[FAIL] crashed — ' + (e && e.stack || e)); results.push(false); }
finally { if (browser) await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
