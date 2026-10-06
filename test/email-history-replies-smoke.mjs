// ALL EMAIL SHOWS WHAT CAME BACK AS WELL AS WHAT WENT OUT (owner, 6 Oct): "all email will have both outbound
// and inbound". The replies come from conversation_messages (the sweeps' quote-stripped copy). Who may see
// one is decided in SQL, per the email-ownership rule (D-0034/36): a reply on a lead you OWN, or anything that
// reached one of YOUR mailboxes; admin sees the company's; a creator who does not own the lead sees nothing.
// Same fake-PostgREST harness as email-history-scope-smoke (the fake projects to the route's own select).
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const express = require(path.join(ROOT, 'node_modules/express'));
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'));

const O = 'org1';
const users = [
  { id: 'ADMIN', role: 'admin', manager_id: null },
  { id: 'BDM', role: 'bd_lead', manager_id: null },
  { id: 'BD', role: 'bd', manager_id: 'BDM' },
  { id: 'BD2', role: 'bd', manager_id: 'BDM' },
  { id: 'RA', role: 'ra', manager_id: null },
].map(u => ({ ...u, org_id: O, deleted_at: null }));
const jobs = [
  { id: 'J1', org_id: O, created_by: 'RA', assigned_to_bd: 'BD', assigned_to: null, deleted_at: null },
  { id: 'J3', org_id: O, created_by: 'RA', assigned_to_bd: 'BD2', assigned_to: null, deleted_at: null },
];
const user_emails = [{ user_id: 'BD', email_address: 'bd@x.com' }, { user_id: 'BD2', email_address: 'bd2@x.com' }, { user_id: 'ADMIN', email_address: 'admin@x.com' }];
const M = (id, o) => Object.assign({ id, org_id: O, direction: 'inbound', provider: 'microsoft', message_key: 'mk-' + id, sent_at: '2026-10-0' + id.slice(1) + 'T10:00:00Z', body: 'hello ' + id, contact_id: null, candidate_id: null }, o);
const conversation_messages = [
  M('M1', { job_id: 'J1', from_email: 'ceo@client.com', to_email: 'bd@x.com', subject: 'Reply on BD lead' }),
  M('M2', { job_id: 'J3', from_email: 'hr@other.com', to_email: 'bd2@x.com', subject: 'Reply on BD2 lead' }),
  M('M3', { job_id: null, candidate_id: 'C1', from_email: 'cand@gmail.com', to_email: 'bd@x.com', subject: 'Candidate answered BD' }),
  M('M4', { job_id: 'J1', direction: 'outbound', from_email: 'bd@x.com', to_email: 'ceo@client.com', subject: 'Our outbound copy' }),
  M('M5', { org_id: 'org2', job_id: 'J1', from_email: 'x@y.com', to_email: 'bd@x.com', subject: 'Another company' }),
];

const DB = { users, jobs, emails: [], email_tracking: [], candidate_outreach: [], user_emails, conversation_messages };

function test(row, col, expr) {
  const v = row ? row[col] : undefined;
  const [op, ...rest] = expr.split('.'); const arg = rest.join('.');
  if (op === 'eq') return String(v) === arg;
  if (op === 'is') return arg === 'null' ? v == null : false;
  if (op === 'not') { const [op2, ...r2] = arg.split('.'); return !test(row, col, op2 + '.' + r2.join('.')); }
  if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').includes(String(v));
  throw new Error('op ' + op);
}

async function fakeFetch(u) {
  const url = new URL(String(u));
  const table = url.pathname.split('/').pop();
  const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let rows = (DB[table] || []).slice();
  for (const [k, v] of url.searchParams) {
    if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
    rows = rows.filter(r => test(r, k, v));
  }
  const ord = url.searchParams.get('order');
  if (ord) {
    const [col, dir] = ord.split('.');
    rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1));
  }
  const lim = url.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim);
  // PROJECT to exactly the columns the route asked for — real PostgREST does
  // this, and a select string missing a column (rampart's R1: `emails`
  // missing `sent_by`) must make the caller's downstream logic see that
  // field as `undefined`, not silently fall back to the full row.
  const selectParam = url.searchParams.get('select');
  if (selectParam && selectParam !== '*' && !selectParam.includes('(')) {
    const cols = selectParam.split(',').map(s => s.trim()).filter(Boolean);
    rows = rows.map(r => { const out = {}; for (const c of cols) out[c] = r[c]; return out; });
  }
  return J(rows);
}

const supabase = createClient('http://db.local', 'k', { global: { fetch: fakeFetch }, auth: { persistSession: false } });
const { hasRole } = require(path.join(ROOT, 'middleware/authorize'))({ supabase });

const orgIdFor = (req) => (req && req.user && req.user.org_id) || null;
const withOrg = (q, req) => { const o = orgIdFor(req); return o ? q.eq('org_id', o) : q; };

const ctx = {
  supabase, hasRole, withOrg, orgIdFor,
  auth: (req, res, next) => {
    const id = req.headers['x-user'];
    const u = users.find(x => x.id === id);
    req.user = { id, role: u.role, roles: [u.role], org_id: O };
    req.orgId = O;
    next();
  },
};

const app = express();
app.use(express.json());
app.use(require(path.join(ROOT, 'routes/email-history.js'))(ctx));
const server = app.listen(0);
const PORT = server.address().port;

function call(user, qs = '') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/email/history?days=0' + qs, method: 'GET', headers: { 'x-user': user } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    r.on('error', reject); r.end();
  });
}

const results = [];
const ok = (n, c, d) => results.push({ n, c: !!c, d });
(async () => {
  const get = async (user, qs = '') => { const r = await call(user, qs); if (r.status !== 200) throw new Error(user + ' -> ' + r.status + ' ' + JSON.stringify(r.body)); return r.body; };
  const subj = async (user, qs) => (await get(user, qs)).items.map(i => i.subject).sort();
  const none = [];

  const bd = await get('BD');
  ok('CANNOT-MEASURE GUARD: the answer has an items array and the replies source', Array.isArray(bd.items) && bd.by_source && 'replies' in bd.by_source, Object.keys(bd));
  ok('the owning BD sees the reply on their lead AND the candidate who wrote to their mailbox', JSON.stringify(await subj('BD')) === JSON.stringify(['Candidate answered BD', 'Reply on BD lead']), await subj('BD'));
  ok('…never the other BD\'s reply, never our own outbound copy, never another company\'s', !(await subj('BD')).some(s => /BD2|Our outbound|Another company/.test(s)));
  ok('the other BD sees only their own', JSON.stringify(await subj('BD2')) === JSON.stringify(['Reply on BD2 lead']), await subj('BD2'));
  ok('the manager sees replies on the leads their team owns — and NOT a reply that landed in a team member\'s own mailbox about no lead', JSON.stringify(await subj('BDM')) === JSON.stringify(['Reply on BD lead', 'Reply on BD2 lead']), await subj('BDM'));
  ok('an RA who created the lead but does not own it sees none', JSON.stringify(await subj('RA')) === JSON.stringify(none), await subj('RA'));
  ok('admin sees the company\'s replies (all three, still not another company\'s)', JSON.stringify(await subj('ADMIN')) === JSON.stringify(['Candidate answered BD', 'Reply on BD lead', 'Reply on BD2 lead']), await subj('ADMIN'));

  const rows = (await get('BD')).items;
  const m1 = rows.find(i => i.subject === 'Reply on BD lead');
  ok('a received row says so (direction in, source replies, status received) and carries sender + the mailbox it reached', m1 && m1.direction === 'in' && m1.source === 'replies' && m1.status === 'received' && m1.from_email === 'ceo@client.com' && m1.to_email === 'bd@x.com', m1);
  ok('its id cannot collide with a sent email (prefixed in:)', m1 && /^in:/.test(m1.id), m1 && m1.id);
  ok('the stored copy comes with it', m1 && m1.body === 'hello M1');
  ok('"Read the full email" is offered when it reached MY mailbox on a lead', m1 && m1.can_open_full === true);
  const mgr = (await get('BDM')).items.find(i => i.subject === 'Reply on BD lead');
  ok('…and NOT to the manager (it is not the manager\'s mailbox)', mgr && mgr.can_open_full === false, mgr);
  const cand = rows.find(i => i.subject === 'Candidate answered BD');
  ok('…and not for a reply with no lead (nothing to open it through)', cand && cand.can_open_full === false, cand);

  const inOnly = await get('BD', '&direction=in');
  ok('direction=in: only what came back', inOnly.items.length === 2 && inOnly.items.every(i => i.direction === 'in'), inOnly.items.map(i => i.subject));
  const outOnly = await get('BD', '&direction=out');
  ok('direction=out: no replies at all', outOnly.items.every(i => i.source !== 'replies') && outOnly.by_source.replies === 0, outOnly.by_source);
  const q = await get('BD', '&q=ceo%40client');
  ok('a search finds a reply by the SENDER\'s address', q.items.length === 1 && q.items[0].subject === 'Reply on BD lead', q.items.map(i => i.subject));

  const failed = results.filter(x => !x.c);
  for (const r of results) console.log((r.c ? 'PASS' : 'FAIL') + ' - ' + r.n + (r.c ? '' : ' :: ' + JSON.stringify(r.d)));
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
