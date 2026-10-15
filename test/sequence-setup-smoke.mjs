// WRITE YOUR FIRST SEQUENCE, SERVER SIDE (owner, 15 Oct 2026, D-0150 … D-0154, R-258)
//   * pay: a lead without pay loses the WHOLE sentence that holds {{pay}} — never "The pay is ." (D-0152)
//   * versions: the person's own email is version 1; up to two more; the engine picks one at random per lead, first emails AND
//     follow-ups, and an email ID with wording of its own is left alone
//   * the screen's routes: what is saved is what the engine reads (wording, follow-up days and count, versions), "I write it" turns
//     the AI first email off and "AI writes each one" turns it on, PACE's stock rotation is switched off, an unknown {{detail}}
//     is refused, and the test email is built by the same fill as a real lead's
//   * AI help with no AI available gives the person's text back, never an error and never a silent swap
// Usage: node test/sequence-setup-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-sequence-setup';
const express = require('express');
const jwt = require('jsonwebtoken');
const ev = require('../email-vars.js');
const versions = require('../services/sequence-versions.js');
const { buildPendingEmailsFromJobs } = require('../services/lead-outreach-queue.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

console.log('\nPay: its sentence goes when a lead has none');
const T1 = 'Hi {{fn}}. The pay is {{pay}}. Want resumes?\n\nThanks,';
step('no pay → the sentence is left out, the rest untouched', ev.fillTemplate(T1, { fn: 'Dana', pay: '' }) === 'Hi Dana. Want resumes?\n\nThanks,', JSON.stringify(ev.fillTemplate(T1, { fn: 'Dana', pay: '' })));
step('pay known → filled in place', ev.fillTemplate(T1, { fn: 'Dana', pay: '$140k' }) === 'Hi Dana. The pay is $140k. Want resumes?\n\nThanks,');
step('a line that held only the pay goes, line and all', ev.fillTemplate('Hi {{fn}},\n\nPay: {{pay}}\n\nThanks,', { fn: 'D' }) === 'Hi D,\n\nThanks,');
step('a template without {{pay}} is unchanged by the rule', ev.fillTemplate('Hi {{fn}}, the {{pos}} role.', { fn: 'D', pos: 'Welder' }) === 'Hi D, the Welder role.');
const vars = ev.buildEmailVars({ job: { position: 'Welder', salary_range: '$30/hr', company: { name: 'Acme' } }, contact: { first_name: 'Pat' } });
step('the lead\'s pay comes from its salary', vars.pay === '$30/hr');

console.log('\nVersions, picked at random per lead');
const S = { 'u_a_tmpl_o1_v2_subject': 'V2 subject', 'u_a_tmpl_o1_v2_body': 'V2 body {{fn}}', 'u_a_tmpl_o1_v3_body': 'V3 body' };
const own = { subject: 'Own subject', body: 'Own body' };
step('rand near 0 → the person\'s own (version 1)', versions.pick(S, 'a', 'o1', own, 0.01).id === 'own_v1' && versions.pick(S, 'a', 'o1', own, 0.01).body === 'Own body');
step('rand in the middle → version 2 with its own subject', versions.pick(S, 'a', 'o1', own, 0.5).id === 'own_v2' && versions.pick(S, 'a', 'o1', own, 0.5).subject === 'V2 subject');
step('a version without a subject keeps the person\'s subject', versions.pick(S, 'a', 'o1', own, 0.99).id === 'own_v3' && versions.pick(S, 'a', 'o1', own, 0.99).subject === 'Own subject');
step('no versions → always the person\'s own', versions.pick({}, 'a', 'o1', own, 0.9).id === 'own_v1');
step('saving fewer versions clears the rest', versions.rowsFor('a', 'o1', [{ subject: 's', body: 'b' }]).filter((r) => r.value === '').length === 2);

const job = (id, owner) => ({ id, position: 'Welder', location: 'Austin, TX', company: { name: 'Acme ' + id }, assigned_to_bd: owner, contacts: [{ id: id + 'c', email: `p@${id}.example.com`, first_name: 'Pat' }], research: {} });
const settings = Object.assign({ 'u_bdA_tmpl_o1_subject': 'Your {{pos}} opening', 'u_bdA_tmpl_o1_body': 'Hi {{fn}}, I have welders for {{company}} who can start this week.' },
  { 'u_bdA_tmpl_o1_v2_subject': 'Welders for {{company}}', 'u_bdA_tmpl_o1_v2_body': 'Hello {{fn}}, welders ready for {{company}}, available this week.' });
const realRandom = Math.random;
Math.random = () => 0.9;
let built = buildPendingEmailsFromJobs([job('j1', 'bdA')], 'adm', { bdA: { id: 'bdA' } }, {}, settings, new Set());
step('the engine sends version 2 when the draw says so, filled in, and records which', built.emailsToInsert[0].body.startsWith('Hello Pat') && built.emailsToInsert[0].subject === 'Welders for Acme j1' && built.emailsToInsert[0].template_variant === 'own_v2', JSON.stringify(built.emailsToInsert[0]));
Math.random = () => 0.1;
built = buildPendingEmailsFromJobs([job('j1', 'bdA')], 'adm', { bdA: { id: 'bdA' } }, {}, settings, new Set());
step('…and the person\'s own when it says so (nothing recorded: their own is the plain case)', built.emailsToInsert[0].body.startsWith('Hi Pat') && !built.emailsToInsert[0].template_variant);
Math.random = realRandom;

// ── the routes, over an in-memory database ─────────────────────────────────────────────────────────
const T = {
  users: [{ id: 'bd1', org_id: 'o1', roles: ['bd'] }, { id: 'ra1', org_id: 'o1', roles: ['ra'] }],
  user_emails: [], app_settings: [], reminders: [], jobs: [],
};
function from(name) {
  let mode = 'select', filters = [], row = null, one = false;
  const rows = () => (T[name] || []).filter((r) => filters.every((f) => f(r)));
  const q = {
    select() { return q; }, order() { return q; }, limit() { return q; },
    eq(c, v) { filters.push((r) => r[c] === v); return q; }, in(c, l) { filters.push((r) => l.includes(r[c])); return q; },
    upsert(r) { mode = 'upsert'; row = r; return q; }, single() { one = true; return q; }, maybeSingle() { one = true; return q; },
    then(res, rej) {
      let out; T[name] = T[name] || [];
      if (mode === 'upsert') { for (const r of [].concat(row)) { const i = T[name].findIndex((x) => x.key === r.key); if (i >= 0) Object.assign(T[name][i], r); else T[name].push({ ...r }); } out = { data: null, error: null }; }
      else { const d = rows(); out = { data: one ? d[0] || null : d, error: null }; }
      return Promise.resolve(out).then(res, rej);
    },
  };
  return q;
}
const supabase = { from };
const db = { forRequest: () => ({ from }) };
const hasRole = (req, ...r) => (req.user.roles || []).some((x) => r.includes(x));
const auth = (req, res, next) => { try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET); req.orgId = req.user.org_id; next(); } catch { res.status(401).json({ error: 'Invalid token' }); } };
const tokenFor = (id) => { const u = T.users.find((x) => x.id === id); return jwt.sign({ id, org_id: u.org_id, roles: u.roles, role: u.roles[0] }, process.env.JWT_SECRET); };
const app = express(); app.use(express.json());
app.use(require('../routes/my-setup.js')({ supabase, db, auth, hasRole, today: () => '2026-10-15', getSendWindowHours: async () => ({ start: 8, end: 16 }), JOB_SELECT: '*' }));
const server = http.createServer(app);
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const call = async (method, p, who, body) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + tokenFor(who) } : {}) }, body: body ? JSON.stringify(body) : undefined }); let out = null; try { out = await r.json(); } catch (_) { /* none */ } return { code: r.status, out }; };
const setting = (k) => { const r = T.app_settings.find((x) => x.key === k); return r ? r.value : undefined; };

console.log('\nThe sequence screen\'s routes');
step('someone who does not write sequences is turned away', (await call('GET', '/my-setup/sequence', 'ra1')).code === 403);
let r = await call('GET', '/my-setup/sequence', 'bd1');
step('a new person: no choice yet, nothing written, an example lead said to be one', r.code === 200 && r.out.mode === null && r.out.first.body === '' && r.out.sample.example === true && r.out.sample.vars.fn === 'Dana', JSON.stringify(r.out).slice(0, 300));
step('saving without choosing how the first email is written is refused', (await call('PUT', '/my-setup/sequence', 'bd1', { first: { subject: 'x', body: 'y'.repeat(30) } })).code === 400);
const good = { mode: 'template',
  first: { subject: 'Your {{pos}} opening', body: 'Hi {{fn}},\n\nI saw {{company}} is hiring in {{city}}. The pay is {{pay}}. Want resumes?\n\nThanks,', versions: [{ subject: 'About {{pos}}', body: 'Hello {{fn}}, candidates for {{company}}.' }] },
  followups: [{ day: 3, body: 'Hi {{fn}}, did you see my note?', versions: [{ body: 'Hi {{fn}}, a quick nudge.' }] }, { day: 7, body: 'Hi {{fn}}, last note from me.' }] };
r = await call('PUT', '/my-setup/sequence', 'bd1', Object.assign({}, good, { first: Object.assign({}, good.first, { body: good.first.body + ' {{nonsense}}' }) }));
step('a {{detail}} PACE cannot fill is refused, by name', r.code === 400 && /nonsense/.test(r.out.error), JSON.stringify(r.out));
r = await call('PUT', '/my-setup/sequence', 'bd1', Object.assign({}, good, { followups: [{ day: 7, body: 'Hi {{fn}} one' }, { day: 3, body: 'Hi {{fn}} two' }] }));
step('a follow-up that would go before the one ahead of it is refused', r.code === 400 && /after follow-up 1/.test(r.out.error));
r = await call('PUT', '/my-setup/sequence', 'bd1', good);
step('a good sequence saves', r.code === 200 && r.out.ok === true, JSON.stringify(r.out));
step('…into the keys the engine reads: first email, follow-up count and days', setting('u_bd1_tmpl_o1_body') === good.first.body && setting('u_bd1_fu_count') === '2' && setting('u_bd1_fu1_day') === '3' && setting('u_bd1_fu2_day') === '7' && setting('u_bd1_tmpl_fu2_body') === 'Hi {{fn}}, last note from me.');
step('…a follow-up without a subject replies under the first email\'s', setting('u_bd1_tmpl_fu1_subject') === 'Re: Your {{pos}} opening');
step('…the versions, beside each email', setting('u_bd1_tmpl_o1_v2_body') === 'Hello {{fn}}, candidates for {{company}}.' && setting('u_bd1_tmpl_fu1_v2_body') === 'Hi {{fn}}, a quick nudge.' && setting('u_bd1_tmpl_o1_v3_body') === '');
step('…"I write it" turns the AI first email OFF and PACE\'s stock rotation off', setting('u_bd1_ai_first') === 'off' && setting('u_bd1_random_template_mode') === 'false');
r = await call('GET', '/my-setup/sequence', 'bd1');
step('reading it back gives the same sequence', r.out.mode === 'template' && r.out.first.versions.length === 1 && r.out.followups.length === 2 && r.out.followups[1].day === 7 && r.out.followups[0].versions[0].body === 'Hi {{fn}}, a quick nudge.', JSON.stringify(r.out).slice(0, 400));

r = await call('POST', '/my-setup/sequence/preview', 'bd1', { subject: good.first.subject, body: good.first.body, versions: good.first.versions, rand: 0.1 });
step('the test is the engine\'s fill: details filled, pay in place, version 1 of 2', r.code === 200 && r.out.body.includes('Hi Dana,') && r.out.body.includes('The pay is $140k to $160k.') && r.out.subject === 'Your Senior Java Developer opening' && r.out.version === 1 && r.out.versions === 2 && r.out.missing.length === 0, JSON.stringify(r.out));
r = await call('POST', '/my-setup/sequence/preview', 'bd1', { subject: good.first.subject, body: good.first.body, versions: good.first.versions, rand: 0.9 });
step('…and the other version when the draw says so', r.out.version === 2 && r.out.body.startsWith('Hello Dana'));

r = await call('PUT', '/my-setup/sequence', 'bd1', Object.assign({}, good, { mode: 'ai' }));
step('"AI writes each one" turns the AI first email ON, keeps the email as the backup, drops first-email versions', r.code === 200 && setting('u_bd1_ai_first') === 'on' && setting('u_bd1_tmpl_o1_body') === good.first.body && setting('u_bd1_tmpl_o1_v2_body') === '');
step('…and reads back as the AI choice', (await call('GET', '/my-setup/sequence', 'bd1')).out.mode === 'ai');

r = await call('POST', '/my-setup/sequence/draft', 'bd1', { mode: 'variant', purpose: 'first', subject: 'Your {{pos}} opening', body: 'Hi {{fn}}, my own words.' });
step('a version asked for with no AI available gives the person\'s text back and says so', r.code === 200 && r.out.source === 'kept' && r.out.body === 'Hi {{fn}}, my own words.' && !!r.out.note, JSON.stringify(r.out));

server.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
