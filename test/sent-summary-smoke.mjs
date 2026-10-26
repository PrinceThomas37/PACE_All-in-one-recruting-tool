// "WHAT WENT OUT" COUNTS THE REAL THING (R-315, owner 26 Oct: "the screenshot shows 400 sent, but it does not show how many
// were today's outreach, FU1, FU2 and all by dates").
//   · services/sent-summary.js buckets by sequence step (empty = first email, fu1…, reminder) and orders them;
//   · GET /email/sent-summary counts EVERY sent email in the range — past the list's 400-row page, through PostgREST's
//     1,000-row pages — and only what the viewer may see (the same people rule as the list: I sent it, or I own the lead);
//   · only SENT rows, only inside the range (start included, end excluded); a bad range is refused in words.
// Usage: node test/sent-summary-smoke.mjs
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const express = require(path.join(ROOT, 'node_modules/express'));
const S = require(path.join(ROOT, 'services/sent-summary.js'));
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── the rule ──
step('a step is read from followup_type: empty = first, fu1/FU2 = follow-ups, reminder, anything else = other',
  [null, '', 'fu1', 'FU2', 'reminder', 'weird'].map(S.stepOf).join() === 'first,first,fu1,fu2,reminder,other');
const sum = S.summarize([{ followup_type: 'fu2' }, {}, { followup_type: 'fu1' }, {}, { followup_type: 'fu10' }, { followup_type: 'reminder' }], { oneOff: 3 });
step('the summary orders steps First → FU1 → FU2 → … → Reminder → One-off, and totals them',
  sum.steps.map((x) => x.label + ':' + x.count).join('|') === 'First email:2|Follow-up 1:1|Follow-up 2:1|Follow-up 10:1|Reminder:1|One-off:3' && sum.total === 9, JSON.stringify(sum));
step('an empty step is left out (no "0" rows)', !S.summarize([{}]).steps.some((x) => x.count === 0));
step('a range with its end before its start, or no dates, is refused in words',
  !!S.readRange({ from: '2026-10-26T00:00:00Z', to: '2026-10-25T00:00:00Z' }).error && !!S.readRange({}).error);

// ── the route, over a database bigger than the list's page ──
const O = 'org1';
const users = [
  { id: 'ADMIN', role: 'admin', manager_id: null }, { id: 'BDM', role: 'bd_lead', manager_id: null },
  { id: 'BD', role: 'bd', manager_id: 'BDM' }, { id: 'BD2', role: 'bd', manager_id: null },
].map((u) => ({ ...u, org_id: O, deleted_at: null }));
const jobs = [{ id: 'J1', org_id: O, assigned_to_bd: 'BD', deleted_at: null }, { id: 'J2', org_id: O, assigned_to_bd: 'BD2', deleted_at: null }];
const DAY = '2026-10-26';
const at = (h) => `${DAY}T${String(h).padStart(2, '0')}:00:00.000Z`;
const emails = [];
let n = 0;
const add = (k, o) => { for (let i = 0; i < k; i++) emails.push({ id: 'E' + (++n), org_id: O, status: 'sent', sent_at: at(10), job_id: 'J1', sent_by: 'BD', followup_type: null, ...o }); };
add(1300, {});                                  // BD's first emails today — more than one 1,000-row page and the list's 400
add(250, { followup_type: 'fu1' });
add(120, { followup_type: 'fu2' });
add(7, { job_id: 'J2', sent_by: 'BD2' });        // another BD's lead, sent by them: not BD's to see
add(5, { status: 'pending' });                   // not sent yet
add(4, { sent_at: '2026-10-25T23:59:59.000Z' }); // yesterday
add(2, { sent_at: at(23) });                   // still today (23:00)
const db = createFakeDb({ tables: { users, jobs, emails, email_tracking: [{ id: 'T1', org_id: O, sent_by: 'BD', sent_at: at(9) }, { id: 'T2', org_id: O, sent_by: 'BD2', sent_at: at(9) }],
  candidate_outreach: [{ id: 'C1', org_id: O, sent_by: 'BD', status: 'sent', sent_at: at(20) }, { id: 'C2', org_id: O, sent_by: 'BD', status: 'pending', sent_at: null }] } });
const { hasRole } = require(path.join(ROOT, 'middleware/authorize'))({ supabase: db.supabase });
const withOrg = (q, req) => q.eq('org_id', req.user.org_id);
const app = express();
app.use(require(path.join(ROOT, 'routes/email-history.js'))({ supabase: db.supabase, hasRole, withOrg, orgIdFor: (req) => req.user.org_id,
  auth: (req, _res, next) => { const u = users.find((x) => x.id === req.headers['x-user']); req.user = { id: u.id, role: u.role, roles: [u.role], org_id: O }; next(); } }));
const server = app.listen(0); const PORT = server.address().port;
const call = (user, qs) => new Promise((ok, no) => { const r = http.request({ host: '127.0.0.1', port: PORT, path: '/email/sent-summary' + qs, headers: { 'x-user': user } }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(b || 'null') })); }); r.on('error', no); r.end(); });
const today = `?from=${DAY}T00:00:00.000Z&to=2026-10-27T00:00:00.000Z`;
const pick = (b) => Object.fromEntries((b.steps || []).map((x) => [x.step, x.count]));

let r = await call('ADMIN', today);
let c = pick(r.body);
step('admin: every first email today is counted — 1,309, past the 400-row list and the 1,000-row page (pending and yesterday left out)', r.status === 200 && c.first === 1300 + 7 + 2, JSON.stringify(c));
step('admin: follow-ups by step (FU1 250, FU2 120), one-offs 2, candidate batches 1 sent', c.fu1 === 250 && c.fu2 === 120 && c.oneoff === 2 && c.candidates === 1, JSON.stringify(c));
r = await call('BD', today); c = pick(r.body);
step('a BD counts only their own: not the other BD\'s 7 first emails or their one-off', c.first === 1302 && c.oneoff === 1 && r.body.total === 1302 + 250 + 120 + 1 + 1, JSON.stringify(c));
r = await call('BDM', today); c = pick(r.body);
step('the BD\'s manager sees the BD\'s numbers (their reporting chain)', c.first === 1302, JSON.stringify(c));
r = await call('BD2', today); c = pick(r.body);
step('the other BD sees only their own 7', c.first === 7 && !c.fu1, JSON.stringify(c));
r = await call('ADMIN', `?from=${DAY}T00:00:00.000Z&to=${DAY}T00:00:00.000Z`);
step('an empty range is refused (400) in words', r.status === 400 && /after its start/.test(r.body.error));

server.close();
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
