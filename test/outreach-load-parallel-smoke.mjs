// OUTREACH INSIGHTS MUST NOT WAIT ONE READ AT A TIME (R-393, owner 4 Nov 2026: "the cards show after about a minute").
// A person with ~3,500 sent emails needs ~55 chunked reads; one after another at database latency that is the minute.
// This runs the REAL route against a fake database where every read takes 20 ms, and checks two things:
//   * the numbers are right (people, emails — the same rules, only faster);
//   * the reads overlap (several at a time), so the wait is divided — it fails if they go back to one after another.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };

const ORG = 'org-a', ME = 'bd-1', LATENCY = 20;
const today = new Date(); const day = (n) => new Date(today.getTime() - n * 86400000).toISOString();
const N_EMAILS = 3500, N_PEOPLE = 2100;
const D = { workflow_definitions: [{ id: 'wfA', name: 'Seq A', created_by: ME, org_id: ORG }], workflow_step_runs: [],
  emails: [], email_tracking: [], contacts: [], jobs: [], users: [{ id: ME, name: 'Me', org_id: ORG, deleted_at: null }] };
for (let i = 0; i < N_PEOPLE; i++) { D.contacts.push({ id: 'c' + i, first_name: 'P' + i, last_name: '', email: 'p' + i + '@x.test', email_status: 'valid', replied_at: null, job_id: 'j' + i, org_id: ORG });
  D.jobs.push({ id: 'j' + i, stage: 'Assigned', position: 'Role', industry: 'Tech', timezone: 'EST', company: { name: 'Co', industry: 'Tech' }, org_id: ORG }); }
for (let i = 0; i < N_EMAILS; i++) { D.emails.push({ id: 'e' + i, sent_by: ME, status: 'sent', sent_at: day(i % 20).slice(0, 10), contact_id: 'c' + (i % N_PEOPLE), org_id: ORG });
  if (i % 8 !== 0) D.email_tracking.push({ email_id: 'e' + i, open_count: 0, org_id: ORG }); }

let live = 0, peak = 0, reads = 0;
function q(table) {
  const f = []; let range = null;
  const api = {
    select() { return api; }, order() { return api; },
    eq(k, v) { f.push(r => r[k] === v); return api; },
    is(k, v) { f.push(r => (r[k] == null) === (v == null)); return api; },
    gte(k, v) { f.push(r => String(r[k] || '') >= String(v)); return api; },
    lte(k, v) { f.push(r => String(r[k] || '') <= String(v)); return api; },
    in(k, vs) { f.push(r => vs.includes(r[k])); return api; },
    range(a, b) { range = [a, b]; return api; },
    then(ok, bad) {
      return (async () => {
        live++; reads++; peak = Math.max(peak, live);
        await new Promise(r => setTimeout(r, LATENCY));
        live--;
        let rows = (D[table] || []).filter(r => f.every(fn => fn(r)));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return { data: rows, error: null };
      })().then(ok, bad);
    },
  };
  return api;
}
const router = require('../routes/workflows.js')({ supabase: { from: q }, auth: (_q, _s, n) => n(), hasRole: (req, ...r) => r.some(x => (req.user.roles || []).includes(x)),
  today: () => new Date().toISOString().slice(0, 10), logActivity() {}, INDUSTRIES: [], normInd: (x) => x, userOrgId: async () => ORG,
  withOrg: (qq) => qq, reportingChainIds: async (id) => new Set([id]) });
const h = router.stack.find(l => l.route && l.route.path === '/insights/outreach').route.stack.slice(-1)[0].handle;

let status = 200, body = null; const res = { status(s) { status = s; return res; }, json(j) { body = j; return res; } };
const t0 = Date.now();
await h({ query: {}, user: { id: ME, role: 'bd', roles: ['bd'] }, orgId: ORG }, res);
const ms = Date.now() - t0;

step('the route answers', status === 200 && body && body.totals, 'status ' + status);
step('the numbers are right: every email and every person counted', body.totals.emailed === N_EMAILS && body.totals.people === N_PEOPLE, JSON.stringify({ emailed: body.totals.emailed, people: body.totals.people }));
const sequential = reads * LATENCY;                       // what one-after-another would have cost
step('the probe measured real work (many reads happened)', reads >= 40, reads + ' reads');
step('reads overlap — several at a time, not one after another', peak >= 3, 'peak ' + peak);
step('so the wait is a fraction of one-after-another', ms < sequential * 0.5, `${ms} ms vs ${sequential} ms if sequential`);

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
