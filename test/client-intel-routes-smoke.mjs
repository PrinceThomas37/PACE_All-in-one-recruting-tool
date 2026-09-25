// CLIENT INTELLIGENCE — the two routes, driven for real against an in-memory
// database and a stub AI. Each assertion is one of the owner's rules:
//   D-0039  switched OFF → nothing is read and no summary can be made
//   D-0040  only the client's OWNER sees the emails and the summary
//   D-0041  each person's own daily allowance
//   D-0042  a summary only on the button; nothing new → zero tokens
//   and "checked, not trusted": an invented figure is thrown away, never saved.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── in-memory PostgREST ────────────────────────────────────────────────────
const ORG = 'org-a';
const T = {
  app_settings: [], companies: [], jobs: [], job_orders: [], contacts: [], users: [],
  conversation_messages: [], emails: [], email_tracking: [], client_summaries: [], user_emails: [],
};
const reads = [];
function q(table) {
  const st = { f: [], op: 'select', payload: null, order: null, lim: null };
  const rows = () => {
    let r = T[table].filter(x => st.f.every(fn => fn(x)));
    if (st.order) r = r.slice().sort((a, b) => (a[st.order.k] < b[st.order.k] ? -1 : 1) * (st.order.asc ? 1 : -1));
    if (st.lim) r = r.slice(0, st.lim);
    return r;
  };
  const api = {
    select() { return api; },
    eq(k, v) { st.f.push(r => r[k] === v); return api; },
    is(k, v) { st.f.push(r => (r[k] == null) === (v == null)); return api; },
    not(k, op, v) { st.f.push(r => r[k] != null); return api; },
    in(k, vs) { st.f.push(r => vs.includes(r[k])); return api; },
    order(k, o) { st.order = { k, asc: !(o && o.ascending === false) }; return api; },
    limit(n) { st.lim = n; return api; },
    upsert(p, o) { st.op = 'upsert'; st.payload = p; st.conflict = o && o.onConflict; return api; },
    insert(p) { st.op = 'insert'; st.payload = p; return api; },
    async maybeSingle() { const r = await run(); return { data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }; },
    then(a, b) { return run().then(a, b); },
  };
  async function run() {
    reads.push(table);
    if (st.op === 'upsert') {
      const k = st.conflict || 'id';
      const ex = T[table].find(r => r[k] === st.payload[k]);
      if (ex) Object.assign(ex, st.payload); else T[table].push(Object.assign({ id: 'id' + Math.random() }, st.payload));
      return { data: null, error: null };
    }
    if (st.op === 'insert') { T[table].push(st.payload); return { data: st.payload, error: null }; }
    return { data: rows(), error: null };
  }
  return api;
}
const supabase = { from: q };

// ── stub AI ────────────────────────────────────────────────────────────────
const aiProvider = require('../services/ai-provider.js');
let aiCalls = 0, aiText = '';
aiProvider.availability = async () => ({ available: true, reason: null });
aiProvider.complete = async () => { aiCalls++; return { text: aiText, model: 'stub', usage: { total_tokens: 2100 } }; };

function mount() {
  delete require.cache[require.resolve('../config/settings.js')];
  delete require.cache[require.resolve('../routes/client-intel.js')];
  const router = require('../routes/client-intel.js')({
    supabase, auth: (_q, _s, n) => n(), hasRole: (req, r) => (req.user.roles || []).includes(r),
    withOrg: (query, req) => query.eq('org_id', req.orgId), orgStamp: (req) => ({ org_id: req.orgId }),
  });
  const find = (method, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]).route.stack.slice(-1)[0].handle;
  return {
    get: (id, user) => call(find('get', '/clients/:id/intel'), id, user, {}),
    post: (id, user, body) => call(find('post', '/clients/:id/summary'), id, user, body || {}),
  };
}
async function call(h, id, user, body) {
  let status = 200, out = null;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await h({ params: { id }, user, orgId: ORG, body }, res);
  return { status, body: out };
}
const setting = (k, v) => { T.app_settings = T.app_settings.filter(r => r.key !== 'sys_' + k); T.app_settings.push({ key: 'sys_' + k, value: String(v) }); };

// ── a client owned by Priya, with a thread ─────────────────────────────────
const priya = { id: 'u-priya', roles: ['bd'] }, sam = { id: 'u-sam', roles: ['bd_lead'] }, admin = { id: 'u-adm', roles: ['admin'] };
T.companies.push({ id: 'co1', name: 'Acme', org_id: ORG, deleted_at: null, created_by: 'u-x' });
T.jobs.push({ id: 'j1', company_id: 'co1', org_id: ORG, deleted_at: null, assigned_to_bd: 'u-priya', created_at: '2026-09-01' });
T.contacts.push({ id: 'ct1', job_id: 'j1', org_id: ORG, email: 'maria@acme.com', first_name: 'Maria', last_name: 'Lopez' });
T.users.push({ id: 'u-priya', name: 'Priya' });
T.emails.push({ id: 'e1', contact_id: 'ct1', org_id: ORG, status: 'sent', to_email: 'maria@acme.com', subject: 'HVAC roles',
  body: 'Hi Maria, {{sender}} here — three profiles attached.', sent_at: '2026-09-10T10:00:00Z', sending_email_id: 'mb1' });
T.user_emails.push({ id: 'mb1', email_address: 'priya@ours.com', display_name: 'Priya Shah' });
T.conversation_messages.push({ id: 'cm1', org_id: ORG, contact_id: 'ct1', company_id: 'co1', direction: 'inbound',
  from_email: 'maria@acme.com', subject: 'Re: HVAC roles', body: 'Thanks. What are your rates? I will decide next week.', sent_at: '2026-09-20T10:00:00Z' });

// ── OFF ────────────────────────────────────────────────────────────────────
setting('client_intel_enabled', 0); setting('client_intel_ai_enabled', 0);
let r = mount();
reads.length = 0;
let g = await r.get('co1', priya);
step('switched off: the tab answers "not enabled"', g.body && g.body.enabled === false);
step('switched off: no email table is even read', !reads.some(t => ['conversation_messages', 'emails', 'email_tracking'].includes(t)), reads.join(','));
let p = await r.post('co1', priya);
step('switched off: no summary can be made', p.status === 409 && p.body.code === 'switched_off' && aiCalls === 0);

// ── ON, timeline only ──────────────────────────────────────────────────────
setting('client_intel_enabled', 1);
r = mount();
g = await r.get('co1', priya);
step('the owner sees the timeline — our email and their reply', g.body.owner === true && g.body.timeline.length === 2, JSON.stringify(g.body.timeline && g.body.timeline.map(m => m.direction)));
step('a stored {{sender}} is rendered before it is shown', g.body.timeline.some(m => /Priya Shah here/.test(m.text)) && !g.body.timeline.some(m => /\{\{sender\}\}/.test(m.text)));
step('the free facts say they are waiting on us', /haven't replied/.test(g.body.facts.summary) && g.body.facts.next_steps[0].id === 'reply', g.body.facts.summary);
step('with the AI switch off, the page is told so', g.body.ai.enabled === false);
const gs = await r.get('co1', sam);
step('a manager (not the owner) gets NO email text (D-0040)', gs.body.owner === false && !gs.body.timeline && gs.body.owner_name === 'Priya');
const ga = await r.get('co1', admin);
step('an admin is not the owner either when the client has one', ga.body.owner === false && !ga.body.timeline);
p = await r.post('co1', priya);
step('the AI switch off still refuses the button', p.body.code === 'switched_off' && aiCalls === 0);

// ── ON, with AI ────────────────────────────────────────────────────────────
setting('client_intel_ai_enabled', 1); setting('client_intel_ai_per_user_daily', 2);
r = mount();
aiText = '{"summary":"Maria at Acme has asked about rates and said she will decide next week. We sent three profiles on 10 Sep.","next_steps":[{"id":"reply","why":"She asked about rates."}]}';
p = await r.post('co1', sam);
step('only the owner may press the button', p.status === 403 && aiCalls === 0);
p = await r.post('co1', priya);
step('the owner gets a saved AI summary', p.body.saved === true && p.body.summary.engine === 'ai' && aiCalls === 1, JSON.stringify(p.body).slice(0, 160));
step('…with the next step labelled from the playbook', p.body.summary.next_steps[0].label === 'Reply to their last email');
step('…stamped with this company and what it covered', T.client_summaries[0].org_id === ORG && T.client_summaries[0].covers_until === '2026-09-20T10:00:00.000Z');
p = await r.post('co1', priya);
step('pressing it again with nothing new costs ZERO tokens', p.body.reused === true && p.body.tokens === 0 && aiCalls === 1);
g = await r.get('co1', priya);
step('the page shows "up to date" and the saved summary', g.body.status.state === 'up_to_date' && /rates/.test(g.body.summary.summary));

// A new reply arrives → one more summary, then the person's allowance (2) is spent.
T.conversation_messages.push({ id: 'cm2', org_id: ORG, contact_id: 'ct1', company_id: 'co1', direction: 'inbound',
  from_email: 'maria@acme.com', subject: 'Re: HVAC roles', body: 'Can we talk Friday?', sent_at: '2026-09-22T10:00:00Z' });
g = await r.get('co1', priya);
step('a new email flips it to "1 new"', g.body.status.state === 'new' && g.body.status.new_count === 1);
aiText = '{"summary":"Maria agreed to a fee of $25,000 and wants to talk Friday. Things are moving.","next_steps":[{"id":"book_call","why":"She asked to talk Friday."}]}';
p = await r.post('co1', priya);
step('an invented fee is caught and NOT saved', p.body.rejected === true && !/25,000/.test(T.client_summaries[0].summary));
step('…and the call still counts against the allowance', aiCalls === 2);
aiText = '{"summary":"Maria asked to talk on Friday after asking about rates. We have not replied yet.","next_steps":[{"id":"book_call","why":"She asked to talk Friday."}]}';
p = await r.post('co1', priya);
step('the per-person daily allowance is enforced', p.status === 409 && p.body.code === 'daily_limit' && aiCalls === 2, JSON.stringify(p.body));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
