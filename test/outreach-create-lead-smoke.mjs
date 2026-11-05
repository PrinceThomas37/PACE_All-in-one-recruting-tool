// "TAKE THE INFORMATION FROM THESE EMAILS AND CREATE THE LEAD FOR THAT USER BY DEFAULT" (R-396, owner 4 Nov 2026).
// The company search already knows the company, its website and place, the person, their title, and the job posting that was pasted.
// When the page's box is ticked (it is, until the person unticks it) the send also creates, with NO sequence needed:
//   the company (name, website, location) · the lead (the job title, the posting in its notes), OWNED by the sender · the person (name, title, email)
// Not ticked → nothing is created (as before). An address already on a lead is never duplicated. A lead that cannot be made never
// fails a send that has already gone. The real route runs against a fake database that actually stores rows.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };

const ORG = 'o1', ME = { id: 'ash', role: 'bd', roles: ['bd'] };
let DB, failJobs = false, seq = 0;
const reset = () => { DB = { companies: [], jobs: [], contacts: [], email_tracking: [], workflow_definitions: [{ id: 'a1', org_id: ORG, created_by: 'ash', status: 'active', entity_type: 'contact' }] }; failJobs = false; seq = 0; sent.length = 0; };
const sent = [];
function table(name) {
  const f = []; let mode = 'select', row = null, patch = null, lim = null;
  const match = () => (DB[name] = DB[name] || []).filter((r) => f.every((fn) => fn(r)));
  const api = {
    select() { return api; }, limit(n) { lim = n; return api; },
    eq(k, v) { f.push((r) => r[k] === v); return api; }, ilike(k, v) { f.push((r) => String(r[k] || '').toLowerCase() === String(v).toLowerCase()); return api; },
    insert(r) { mode = 'insert'; row = r; return api; }, update(p) { mode = 'update'; patch = p; return api; }, upsert() { return Promise.resolve({ data: null, error: null }); },
    _do() {
      if (mode === 'insert') {
        if (name === 'jobs' && failJobs) return { data: null, error: new Error('jobs insert failed') };
        const x = Object.assign({ id: name + (++seq) }, row); (DB[name] = DB[name] || []).push(x); return { data: x, error: null };
      }
      if (mode === 'update') { match().forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
      const rows = match(); return { data: lim ? rows.slice(0, lim) : rows, error: null };
    },
    single() { const r = api._do(); return Promise.resolve(r.error ? r : { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: null }); },
    maybeSingle() { const r = api._do(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: null }); },
    then(a, b) { return Promise.resolve(api._do()).then(a, b); },
  };
  return api;
}
const router = require('../routes/outreach-generator.js')({
  supabase: { from: table }, auth: (_q, _s, n) => n(), today: () => '2026-11-04', buildHtmlEmailBody: (t) => t, getMailboxSignature: async () => '',
  loadSuppressedSet: async () => new Set(), recruiterSendingMailbox: async () => null,
  sendMailboxNewMessage: async (mb, m) => { sent.push(m.to); return {}; }, sendingMailboxFor: async () => ({ id: 'mb', email_address: 'ash@vhc.test', platform: 'Gmail' }),
  ownSendingMailboxes: async () => [], withOrg: (q, req) => (req.orgId ? q.eq('org_id', req.orgId) : q), orgStamp: () => ({ org_id: ORG }), logActivity() {},
  wfEngine: { enroll: async () => ({ id: 'en1', next_step_due_date: '2026-11-07' }) }, hasRole: (req, ...r) => r.some((x) => (req.user.roles || []).includes(x)),
  orgIdFor: () => ORG, canTouchJob: async () => true,
});
const send = router.stack.find((l) => l.route && l.route.path === '/outreach/send' && l.route.methods.post).route.stack.slice(-1)[0].handle;
async function call(body) { let code = 200, out = null; const res = { status(s) { code = s; return res; }, json(j) { out = j; return res; } };
  await send({ user: ME, orgId: ORG, body, query: {}, params: {}, headers: {} }, res); return { code, out }; }
const BASE = { to: 'kelly.mazur@pasadenavilla.com', subject: 'Mental Health Therapist candidate', body: 'Hi Kelly', name: 'Kelly Mazur', title: 'Executive Director',
  company: 'Pasadena Villa Outpatient', website: 'pasadenavillaoutpatient.com', location: 'Brentwood, Tennessee', position: 'Mental Health Therapist',
  job_description: 'Licensed therapist, master\'s in counseling, Michigan clinical license.' };

reset();
let r = await call({ ...BASE, create_lead: true });
const co = DB.companies[0], job = DB.jobs[0], ct = DB.contacts[0];
step('ticked, no sequence: the email goes AND a lead is created', r.out.sent === true && r.out.lead && !r.out.lead.error && !r.out.lead.existing && !!job, JSON.stringify(r.out));
step('…the company carries its name, website and place', co && co.name === 'Pasadena Villa Outpatient' && co.website === 'pasadenavillaoutpatient.com' && co.location === 'Brentwood, Tennessee', JSON.stringify(co));
step('…the lead is the job title, at that place, with the posting in its notes', job && job.position === 'Mental Health Therapist' && job.location === 'Brentwood, Tennessee' && /Job posting:/.test(job.notes) && /Michigan clinical license/.test(job.notes), JSON.stringify(job && { p: job.position, n: job.notes }));
step('…OWNED by the sender (the lead is theirs, in their Leads)', job && job.assigned_to_bd === 'ash' && job.created_by === 'ash' && job.stage === 'Assigned');
step('…the person has their name, title and email, and is the primary contact', ct && ct.first_name === 'Kelly' && ct.last_name === 'Mazur' && ct.designation === 'Executive Director' && ct.email === 'kelly.mazur@pasadenavilla.com' && ct.is_primary === true, JSON.stringify(ct));
step('…and the sent email is linked to that lead', !!job && DB.email_tracking.some((t) => t.lead_id === job.id));
step('no sequence was started', r.out.sequence === null);

reset();
r = await call({ ...BASE, create_lead: false });
step('box UNticked: the email goes and NOTHING is created', r.out.sent === true && DB.jobs.length === 0 && DB.companies.length === 0 && DB.contacts.length === 0 && r.out.lead === null, JSON.stringify(r.out));
reset();
r = await call({ ...BASE });
step('…and a caller that says nothing creates nothing (the old rule for every other screen)', r.out.sent === true && DB.jobs.length === 0);

reset();
DB.contacts.push({ id: 'c0', job_id: 'j0', email: 'kelly.mazur@pasadenavilla.com', org_id: ORG }); DB.jobs.push({ id: 'j0', org_id: ORG });
r = await call({ ...BASE, create_lead: true });
step('an address already on a lead is NEVER duplicated — the answer says "already a lead"', r.out.lead && r.out.lead.existing === true && r.out.lead.job_id === 'j0' && DB.jobs.length === 1 && DB.contacts.length === 1, JSON.stringify(r.out.lead));

reset(); failJobs = true;
r = await call({ ...BASE, create_lead: true });
step('a lead that cannot be made does NOT fail the send (the email has already gone) — the answer says what did not happen', r.code === 200 && r.out.sent === true && sent.length === 1 && r.out.lead && /jobs insert failed/.test(r.out.lead.error), JSON.stringify(r));

reset();
r = await call({ ...BASE, sequence_id: 'a1' });
step('choosing a sequence still creates the lead (unchanged) and reports both', r.out.sent === true && r.out.lead && !r.out.lead.error && r.out.sequence && r.out.sequence.enrollment_id === 'en1' && DB.jobs.length === 1, JSON.stringify(r.out));

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
