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
    ilike(k, v) { st.f.push(r => String(r[k] || '').toLowerCase() === String(v).toLowerCase()); return api; },
    is(k, v) { st.f.push(r => (r[k] == null) === (v == null)); return api; },
    not(k, op, v) { st.f.push(r => r[k] != null); return api; },
    gte(k, v) { st.f.push(r => String(r[k] || '') >= String(v)); return api; },
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

// Stub mailbox: the full original, as the mailbox would return it.
const mp = require('../services/mail-provider.js');
let mailFetches = 0;
mp.createMailProvider = () => ({ forMailbox: () => ({ getMessage: async () => { mailFetches++; return {
  subject: 'Re: HVAC roles', date: '2026-09-20T10:00:00Z',
  body_html: '<p>Thanks. What are your rates? I will decide next week.</p><p>On Mon Lisa wrote:</p><blockquote>Here are three profiles.</blockquote><script>alert(1)</script>' }; } }) });

function mount() {
  delete require.cache[require.resolve('../config/settings.js')];
  delete require.cache[require.resolve('../routes/client-intel.js')];
  const router = require('../routes/client-intel.js')({
    supabase, auth: (_q, _s, n) => n(), hasRole: (req, r) => (req.user.roles || []).includes(r),
    withOrg: (query, req) => query.eq('org_id', req.orgId), orgStamp: (req) => ({ org_id: req.orgId }),
  });
  const find = (method, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]).route.stack.slice(-1)[0].handle;
  return {
    full: (id, mid, user) => call(find('get', '/clients/:id/intel/messages/:mid/full'), id, user, {}, { mid }),
    get: (id, user) => call(find('get', '/clients/:id/intel'), id, user, {}),
    post: (id, user, body) => call(find('post', '/clients/:id/summary'), id, user, body || {}),
  };
}
mount.lead = function () {
  delete require.cache[require.resolve('../config/settings.js')];
  delete require.cache[require.resolve('../routes/client-intel.js')];
  const router = require('../routes/client-intel.js')({
    supabase, auth: (_q, _s, n) => n(), hasRole: (req, r) => (req.user.roles || []).includes(r),
    withOrg: (query, req) => query.eq('org_id', req.orgId), orgStamp: (req) => ({ org_id: req.orgId }),
  });
  const find = (method, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]).route.stack.slice(-1)[0].handle;
  return {
    full: (id, mid, user) => call(find('get', '/leads/:id/intel/messages/:mid/full'), id, user, {}, { mid }),
    get: (id, user) => call(find('get', '/leads/:id/intel'), id, user, {}),
    post: (id, user, body) => call(find('post', '/leads/:id/summary'), id, user, body || {}),
  };
};
async function call(h, id, user, body, extra) {
  let status = 200, out = null;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await h({ params: Object.assign({ id }, extra || {}), user, orgId: ORG, body }, res);
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
  body: 'Hi Maria, {{sender}} here — three profiles attached. ' + 'Details of each candidate follow. '.repeat(120) + 'THE-END-OF-OUR-EMAIL', sent_at: '2026-09-10T10:00:00Z', sending_email_id: 'mb1' });
T.user_emails.push({ id: 'mb1', email_address: 'priya@ours.com', display_name: 'Priya Shah' });
T.user_emails.push({ id: 'mb-priya', user_id: 'u-priya', email_address: 'priya@ours.com', platform: 'Gmail', is_active: true });
T.conversation_messages.push({ id: 'cm1', org_id: ORG, contact_id: 'ct1', company_id: 'co1', direction: 'inbound', message_key: 'gm-1', to_email: 'priya@ours.com',
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
step('our own sent email is shown IN FULL (not cut at 1,500)', g.body.timeline.some(m => m.direction === 'outbound' && /THE-END-OF-OUR-EMAIL/.test(m.text)));
step('a stored reply offers "open the full email"', g.body.timeline.some(m => m.id === 'in:cm1' && m.can_open_full));
step('the answer says WHICH email "Reply" opens — their reply, its mailbox id, and who it is from (so the button opens that email, not the mailbox)', !!g.body.reply_target && g.body.reply_target.last_inbound && g.body.reply_target.last_inbound.message_id === 'gm-1' && g.body.reply_target.last_inbound.mailbox_id === 'mb-priya' && g.body.reply_target.last_inbound.other_email === 'maria@acme.com', JSON.stringify(g.body.reply_target));
T.user_emails[1].user_id = 'u-other';
let gOther = await r.get('co1', priya);
step('a reply that reached somebody ELSE\'s mailbox is not offered as a target', gOther.body.reply_target && gOther.body.reply_target.last_inbound === null);
T.user_emails[1].user_id = 'u-priya';
let fm = await r.full('co1', 'in:cm1', priya);
step('the owner can open the full reply from their own mailbox', fm.status === 200 && /Here are three profiles/.test(fm.body.text) && mailFetches === 1, JSON.stringify(fm.body).slice(0, 120));
step('…as plain text — nothing from the sender\'s HTML can run', !/<script|<p>/.test(fm.body.text));
fm = await r.full('co1', 'in:cm1', sam);
step('a manager cannot open it', fm.status === 403 && mailFetches === 1);
T.user_emails[1].user_id = 'u-other';
fm = await r.full('co1', 'in:cm1', priya);
step('a reply that arrived in someone ELSE\'s mailbox is not fetched', fm.status === 409 && fm.body.code === 'not_your_mailbox' && mailFetches === 1);
T.user_emails[1].user_id = 'u-priya';
fm = await r.full('co2', 'in:cm1', priya);
step('an email cannot be opened through a different client', fm.status === 404 && mailFetches === 1);
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

// ── ONE LEAD on the Leads list (Session 31: "just this lead list") ────────
// A second lead at the SAME company, owned by Sam, with its own contact and
// reply. The lead view must show only its own lead's mail, never the company's.
T.jobs.push({ id: 'j2', position: 'Plumber', company_id: 'co1', org_id: ORG, deleted_at: null, assigned_to_bd: 'u-sam', created_at: '2026-09-02' });
T.jobs[0].position = 'HVAC Tech';
T.contacts.push({ id: 'ct2', job_id: 'j2', org_id: ORG, email: 'bob@acme.com', first_name: 'Bob' });
T.users.push({ id: 'u-sam', name: 'Sam' });
T.conversation_messages.push({ id: 'cm3', org_id: ORG, contact_id: 'ct2', company_id: 'co1', direction: 'inbound', message_key: 'gm-3', to_email: 'sam@ours.com',
  from_email: 'bob@acme.com', subject: 'Re: plumbers', body: 'BOB-ONLY-TEXT send me resumes', sent_at: '2026-09-21T10:00:00Z' });
setting('client_intel_ai_per_user_daily', 10);
{
  const lr = mount.lead();
  let lg = await lr.get('j1', priya);
  const texts = (lg.body.timeline || []).map(m => m.text).join(' ');
  step('lead: its owner (assigned BD) sees that lead\'s emails', lg.body.owner === true && lg.body.timeline.length === 3, String(lg.body.timeline && lg.body.timeline.length));
  step('lead: another lead\'s mail at the same company is NOT in it', !/BOB-ONLY-TEXT/.test(texts));
  lg = await lr.get('j1', sam);
  step('lead: a manager is not the owner and gets no email text', lg.body.owner === false && !lg.body.timeline && lg.body.owner_name === 'Priya');
  lg = await lr.get('j2', sam);
  step('lead: Sam owns his own lead and sees only Bob', lg.body.owner === true && lg.body.timeline.length === 1 && /BOB-ONLY-TEXT/.test(lg.body.timeline[0].text));
  let lf = await lr.full('j2', 'in:cm1', sam);
  step('lead: a reply from a different lead cannot be opened through this one', lf.status === 404);
  lf = await lr.full('j1', 'in:cm1', priya);
  step('lead: the owner can open the full reply from their mailbox', lf.status === 200 && /Here are three profiles/.test(lf.body.text));
  aiText = '{"summary":"Maria asked to talk on Friday after asking about rates. We have not replied yet.","next_steps":[{"id":"book_call","why":"She asked to talk Friday."}]}';
  const before = aiCalls;
  let lp = await lr.post('j1', sam);
  step('lead: only the owner may press Summarise', lp.status === 403 && aiCalls === before);
  lp = await lr.post('j1', priya);
  const stored = T.app_settings.find(x => x.key === 'lead_summary_j1');
  step('lead: the summary is saved per lead (app_settings, no migration)', lp.body.saved === true && stored && JSON.parse(stored.value).org_id === ORG, JSON.stringify(lp.body).slice(0, 140));
  step('lead: it does not touch the client summary table', T.client_summaries.length === 1);
  lp = await lr.post('j1', priya);
  step('lead: nothing new → reused, zero tokens', lp.body.reused === true && aiCalls === before + 1);
  const gone = await lr.get('nope', priya);
  step('lead: an unknown lead is a 404', gone.status === 404);
}

// ── THE DAILY DIGEST + TEAM ROLL-UP (D-0040, D-0043) ───────────────────────
{
  // Sam manages Priya.
  T.users = [
    { id: 'u-priya', name: 'Priya', org_id: ORG, manager_id: 'u-sam', deleted_at: null },
    { id: 'u-sam', name: 'Sam', org_id: ORG, manager_id: null, deleted_at: null },
  ];
  delete require.cache[require.resolve('../config/settings.js')];
  delete require.cache[require.resolve('../routes/client-intel.js')];
  const router = require('../routes/client-intel.js')({
    supabase, auth: (_q, _s, n) => n(), hasRole: (req, r) => (req.user.roles || []).includes(r),
    withOrg: (query, req) => query.eq('org_id', req.orgId), orgStamp: (req) => ({ org_id: req.orgId }),
  });
  const layer = router.stack.find(l => l.route && l.route.path === '/client-intel/digest');
  step('digest: GET /client-intel/digest exists', !!layer);
  const dg = (user) => call(layer.route.stack.slice(-1)[0].handle, null, user, {});
  const aiBefore = aiCalls;
  let d = (await dg(priya)).body;
  step('digest: the owner sees their live conversation', d.enabled && d.mine.length === 1 && d.mine[0].id === 'j1', JSON.stringify(d.mine.map(x => x.id)));
  step('digest: …with where it stands and the next step', d.mine[0].state === 'needs_reply' && d.mine[0].needs_you && d.mine[0].next_step && d.mine[0].next_step.id === 'reply');
  step('digest: …and the first line of THEIR saved summary', /Maria asked to talk on Friday/.test(d.mine[0].summary_line || ''), d.mine[0].summary_line);
  step('digest: someone with no reports gets no team section', d.team.length === 0);
  d = (await dg(sam)).body;
  step('digest: a manager sees their own conversation', d.mine.length === 1 && d.mine[0].id === 'j2');
  step('digest: …and their report\'s, grouped under the report', d.team.length === 1 && d.team[0].owner_name === 'Priya' && d.team[0].items[0].id === 'j1' && d.team[0].waiting === 1);
  const teamJson = JSON.stringify(d.team);
  step('digest: the team view is FACTS ONLY — no summary, no email wording (D-0040)',
    !/Maria asked to talk|rates|Friday/.test(teamJson) && !('summary_line' in d.team[0].items[0]) && !('next_step' in d.team[0].items[0]), teamJson.slice(0, 160));
  step('digest: a manager never reads "You haven\'t replied" about someone else\'s thread', !/You haven't replied/.test(teamJson) && /No reply from us yet/.test(teamJson));
  step('digest: drawing it costs no AI call', aiCalls === aiBefore);
  // ── "completed" (R-099, D-0066): the checkbox leaves the list until they write again ──
  const dis = require('../services/next-action-dismissals');
  d = (await dg(priya)).body;
  const comp = d.mine[0] && d.mine[0].complete;
  step('digest: each of my rows carries the item a completion is recorded against (the browser echoes it back)', !!comp && comp.kind === 'client_conversation' && comp.entity_type === 'lead' && comp.entity_id === 'j1' && comp.state === 'needs_reply' && !!comp.last_activity_at, JSON.stringify(comp));
  const storeKey = dis.settingsKey(priya.id);
  T.app_settings = T.app_settings.filter(r => r.key !== storeKey);
  T.app_settings.push({ key: storeKey, value: JSON.stringify(dis.recordDismissal({}, comp, 'drop')) });
  d = (await dg(priya)).body;
  step('digest: ticked completed → the conversation leaves my list, and the count of completed is stated', d.mine.length === 0 && d.completed === 1, JSON.stringify({ n: d.mine.length, completed: d.completed }));
  T.app_settings = T.app_settings.filter(r => r.key !== storeKey);
  T.app_settings.push({ key: storeKey, value: JSON.stringify(dis.recordDismissal({}, Object.assign({}, comp, { last_activity_at: '2020-01-01T00:00:00.000Z' }), 'drop')) });
  d = (await dg(priya)).body;
  step('digest: …but a conversation that has moved on since the tick (they wrote again) comes back', d.mine.length === 1 && d.mine[0].id === 'j1' && d.completed === 0);
  T.app_settings = T.app_settings.filter(r => r.key !== storeKey);
  d = (await dg(sam)).body;
  step('digest: completing is per person — the manager\'s own list and the report\'s row in the team view are unaffected', d.mine.length === 1 && d.team.length === 1);
  setting('client_intel_enabled', 0);
  delete require.cache[require.resolve('../config/settings.js')];
  delete require.cache[require.resolve('../routes/client-intel.js')];
  const r2 = require('../routes/client-intel.js')({ supabase, auth: (_q, _s, n) => n(), hasRole: () => false,
    withOrg: (query, req) => query.eq('org_id', req.orgId), orgStamp: (req) => ({ org_id: req.orgId }) });
  reads.length = 0;
  const off = await call(r2.stack.find(l => l.route && l.route.path === '/client-intel/digest').route.stack.slice(-1)[0].handle, null, priya, {});
  step('digest: switched off → nothing read, nothing shown', off.body.enabled === false && !reads.some(t => ['conversation_messages', 'emails', 'contacts'].includes(t)));
  setting('client_intel_enabled', 1);
}

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
