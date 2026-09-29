// THE AI SUMMARY READS OUR REPLIES TOO (R-085).
//
// Owner, 29 Sep: "An issue during AI summary of emails is that it is not able to
// read the emails as sent to the client. It is only reading incoming emails and
// the first outreach email. Nothing of the [replies] from our side. AI summary
// needs reading both to and fro."
//
// Cause: replies written in the in-app mailbox, or straight from Gmail/Outlook,
// were stored nowhere PACE reads (and nothing is mirrored into Postgres). They are
// now read LIVE from the caller's own Sent folder when the Emails tab or the
// summary is asked for (services/sent-side.js) — never copied, never guessed.
//
//   part 1 — the reader itself, against a fake provider: right folder per platform,
//            only mail actually ADDRESSED to the person, no double count of what
//            PACE already sent, drafts skipped, bounded, and every failure REPORTED
//            (a summary from half a conversation must know it is half);
//   part 2 — the route: the tab shows our reply, the AI is handed it, a failure is
//            said not hidden and not cached, and a second look is one read.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ss = require('../services/sent-side.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const addr = (email) => ({ name: '', email });
const item = (id, subject, date, to, extra) => Object.assign({ id, subject, date, to: [addr(to)], cc: [], from: addr('me@ours.com'), is_draft: false }, extra || {});
const trim = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function fakeMail(perMailbox) {
  const seen = { folders: [], searches: [], bodies: 0 };
  return { seen, mail: { forMailbox: (mb) => {
    const cfg = perMailbox[mb.id] || {};
    return {
      listMessages: async ({ folderId, q }) => { seen.folders.push(mb.platform + ':' + folderId); seen.searches.push(mb.id + ':' + q); if (cfg.throws) throw new Error('boom'); return { messages: (cfg.items || []).slice() }; },
      getMessage: async (id) => { seen.bodies++; return { body_html: '<p>' + ((cfg.bodies || {})[id] || 'body of ' + id) + '</p>' }; },
    };
  } } };
}
const box = (id, platform) => ({ id, email_address: id + '@ours.com', platform });

// ═══ part 1 — the reader ═══════════════════════════════════════════════════
{
  const { mail, seen } = fakeMail({
    g1: { items: [item('m1', 'Re: HVAC roles', '2026-09-21T10:00:00Z', 'maria@acme.com'), item('m2', 'Hello someone else', '2026-09-21T11:00:00Z', 'other@else.com')], bodies: { m1: 'Happy to send rates: $95/hr.' } },
    o1: { items: [item('m3', 'Following up', '2026-09-22T09:00:00Z', 'maria@acme.com')] },
  });
  const r = await ss.readOurSide({ mail, mailboxes: [box('g1', 'Gmail'), box('o1', 'Microsoft')], addresses: ['Maria@Acme.com'], have: [], trim, full: trim });
  step('reads our sent mail to the person, from every one of the caller\'s mailboxes', r.messages.length === 2 && r.ok === true, JSON.stringify(r.messages.map(m => m.id)));
  step('…each in the same shape as every other message (outbound, source mailbox, with the text)',
    r.messages.every(m => m.direction === 'outbound' && m.source === 'mailbox' && m.sent_at && m.subject) && /\$95\/hr/.test(r.messages.find(m => m.id === 'mb:g1:m1').text));
  step('…newest first, and a message addressed to somebody ELSE is never included (Gmail\'s search is loose)', r.messages[0].id === 'mb:o1:m3' && !r.messages.some(m => /m2/.test(m.id)));
  step('it asks Gmail\'s SENT label and Outlook\'s sentitems folder', seen.folders.includes('Gmail:SENT') && seen.folders.includes('Microsoft:sentitems'), seen.folders.join(','));
}
{
  const { mail } = fakeMail({ g1: { items: [
    item('a', 'Re: HVAC roles', '2026-09-21T10:05:00Z', 'maria@acme.com'),     // PACE already holds this send
    item('b', 'Re: HVAC roles', '2026-09-24T10:00:00Z', 'maria@acme.com'),     // same subject, three days later — a different email
    item('c', 'Different subject', '2026-09-21T10:06:00Z', 'maria@acme.com'),  // same time, different email
    item('d', 'A draft', '2026-09-25T10:00:00Z', 'maria@acme.com', { is_draft: true }) ] } });
  const have = [{ sent_at: '2026-09-21T10:00:00Z', subject: 'HVAC roles', to: 'maria@acme.com' }];
  const r = await ss.readOurSide({ mail, mailboxes: [box('g1', 'Gmail')], addresses: ['maria@acme.com'], have, trim, full: trim });
  const ids = r.messages.map(m => m.id.split(':')[2]).sort();
  step('what PACE already sent is not counted twice (same subject, same person, within half an hour)', !ids.includes('a'), ids.join(','));
  step('…but a later email with the same subject, and a different one at the same time, both count', ids.includes('b') && ids.includes('c'));
  step('a draft is never part of the conversation', !ids.includes('d'));
}
{
  const many = Array.from({ length: 30 }, (_, i) => item('x' + i, 'Note ' + i, '2026-09-' + String(10 + (i % 15)).padStart(2, '0') + 'T10:00:00Z', 'maria@acme.com'));
  const { mail, seen } = fakeMail({ g1: { items: many } });
  const r = await ss.readOurSide({ mail, mailboxes: [box('g1', 'Gmail')], addresses: ['maria@acme.com'], have: [], trim, full: trim });
  step('bounded: at most ' + ss.MAX_BODIES + ' bodies are fetched however much was sent', r.messages.length === ss.MAX_BODIES && seen.bodies === ss.MAX_BODIES, r.messages.length + ' / ' + seen.bodies);
}
{
  const a = await ss.readOurSide({ mail: fakeMail({}).mail, mailboxes: [], addresses: ['maria@acme.com'], have: [], trim, full: trim });
  step('no mailbox connected is SAID — never "nothing was sent"', a.ok === false && a.reason === 'no_mailbox' && a.messages.length === 0);
  const b = await ss.readOurSide({ mail: fakeMail({ g1: { throws: true } }).mail, mailboxes: [box('g1', 'Gmail')], addresses: ['maria@acme.com'], have: [], trim, full: trim });
  step('an unreadable mailbox is SAID (ok:false, unreadable), not read as an empty Sent folder', b.ok === false && b.reason === 'unreadable' && b.messages.length === 0, JSON.stringify(b));
  const c = await ss.readOurSide({ mail: fakeMail({ g1: { throws: true }, o1: { items: [item('m9', 'Hi', '2026-09-22T09:00:00Z', 'maria@acme.com')] } }).mail, mailboxes: [box('g1', 'Gmail'), box('o1', 'Microsoft')], addresses: ['maria@acme.com'], have: [], trim, full: trim });
  step('one mailbox failing and one working is reported as PARTIAL, with what was read', c.ok === false && c.reason === 'partial' && c.messages.length === 1, JSON.stringify({ ok: c.ok, reason: c.reason, n: c.messages.length }));
  const d = await ss.readOurSide({ mail: fakeMail({}).mail, mailboxes: [box('g1', 'Gmail')], addresses: [], have: [], trim, full: trim });
  step('a lead with no contact address has nothing to look for — and that is fine, not a failure', d.ok === true && d.messages.length === 0);
}

// ═══ part 2 — the route ═══════════════════════════════════════════════════
const ORG = 'org-a';
const T = { app_settings: [], companies: [], jobs: [], job_orders: [], contacts: [], users: [], conversation_messages: [], emails: [], email_tracking: [], client_summaries: [], user_emails: [] };
function q(table) {
  const st = { f: [], op: 'select', payload: null, order: null, lim: null };
  const rows = () => { let r = T[table].filter(x => st.f.every(fn => fn(x))); if (st.order) r = r.slice().sort((a, b) => (a[st.order.k] < b[st.order.k] ? -1 : 1) * (st.order.asc ? 1 : -1)); if (st.lim) r = r.slice(0, st.lim); return r; };
  const api = {
    select() { return api; }, eq(k, v) { st.f.push(r => r[k] === v); return api; }, ilike(k, v) { st.f.push(r => String(r[k] || '').toLowerCase() === String(v).toLowerCase()); return api; },
    is(k, v) { st.f.push(r => (r[k] == null) === (v == null)); return api; }, not() { st.f.push(r => true); return api; }, gte(k, v) { st.f.push(r => String(r[k] || '') >= String(v)); return api; },
    in(k, vs) { st.f.push(r => vs.includes(r[k])); return api; }, order(k, o) { st.order = { k, asc: !(o && o.ascending === false) }; return api; }, limit(n) { st.lim = n; return api; },
    upsert(p, o) { st.op = 'upsert'; st.payload = p; st.conflict = o && o.onConflict; return api; }, insert(p) { st.op = 'insert'; st.payload = p; return api; },
    async maybeSingle() { const r = await run(); return { data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }; },
    then(a, b) { return run().then(a, b); },
  };
  async function run() {
    if (st.op === 'upsert') { const k = st.conflict || 'id'; const ex = T[table].find(r => r[k] === st.payload[k]); if (ex) Object.assign(ex, st.payload); else T[table].push(Object.assign({ id: 'id' + Math.random() }, st.payload)); return { data: null, error: null }; }
    if (st.op === 'insert') { T[table].push(st.payload); return { data: st.payload, error: null }; }
    return { data: rows(), error: null };
  }
  return api;
}
const supabase = { from: q };
const aiProvider = require('../services/ai-provider.js');
let aiPrompt = '';
aiProvider.availability = async () => ({ available: true, reason: null });
aiProvider.complete = async (_s, o) => { aiPrompt = o.system + '\n' + o.prompt; return { text: '{"summary":"Maria asked for rates and we replied with $95/hr.","next_steps":[{"id":"reply","why":"x"}]}', model: 'stub', usage: { total_tokens: 900 } }; };
const mp = require('../services/mail-provider.js');
let listCalls = 0, sentItems = [], failList = false;
mp.createMailProvider = () => ({ forMailbox: () => ({
  listMessages: async () => { listCalls++; if (failList) throw new Error('provider down'); return { messages: sentItems.slice() }; },
  getMessage: async (id) => ({ subject: 's', date: '2026-09-22T09:00:00Z', body_html: '<p>' + (id === 'sent1' ? 'We can do $95/hr for the two technicians. Shall we book a call?' : 'other') + '</p>' }),
}) });
const settingsFor = (k, v) => { T.app_settings = T.app_settings.filter(r => r.key !== 'sys_' + k); T.app_settings.push({ key: 'sys_' + k, value: String(v) }); };
function mount() {
  delete require.cache[require.resolve('../config/settings.js')]; delete require.cache[require.resolve('../routes/client-intel.js')];
  const router = require('../routes/client-intel.js')({ supabase, auth: (_q, _s, n) => n(), hasRole: (req, r) => (req.user.roles || []).includes(r),
    withOrg: (query, req) => query.eq('org_id', req.orgId), orgStamp: (req) => ({ org_id: req.orgId }) });
  const find = (method, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]).route.stack.slice(-1)[0].handle;
  const call = async (h, id, user, body) => { let status = 200, out = null; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } }; await h({ params: { id }, user, orgId: ORG, body }, res); return { status, body: out }; };
  return { get: (id, user) => call(find('get', '/leads/:id/intel'), id, user, {}), post: (id, user, body) => call(find('post', '/leads/:id/summary'), id, user, body || {}) };
}
const priya = { id: 'u-priya', roles: ['bd'] };
T.companies.push({ id: 'co1', name: 'Acme', org_id: ORG, deleted_at: null, created_by: 'u-x' });
T.jobs.push({ id: 'j1', company_id: 'co1', org_id: ORG, deleted_at: null, assigned_to_bd: 'u-priya', created_at: '2026-09-01', position: 'HVAC', location: 'TX' });
T.contacts.push({ id: 'ct1', job_id: 'j1', org_id: ORG, email: 'maria@acme.com', first_name: 'Maria', last_name: 'Lopez' });
T.users.push({ id: 'u-priya', name: 'Priya' });
T.user_emails.push({ id: 'mb-priya', user_id: 'u-priya', email_address: 'priya@ours.com', platform: 'Gmail', is_active: true });
T.conversation_messages.push({ id: 'cm1', org_id: ORG, contact_id: 'ct1', company_id: 'co1', direction: 'inbound', message_key: 'gm-1', to_email: 'priya@ours.com',
  from_email: 'maria@acme.com', subject: 'Re: HVAC roles', body: 'Thanks. What are your rates for two technicians?', sent_at: '2026-09-20T10:00:00Z' });
settingsFor('client_intel_enabled', 1); settingsFor('client_intel_ai_enabled', 1); settingsFor('client_intel_ai_per_user_daily', 5);

sentItems = [item('sent1', 'Re: HVAC roles', '2026-09-22T09:00:00Z', 'maria@acme.com')];
let r = mount();
let g = await r.get('j1', priya);
const mine = (g.body.timeline || []).filter(m => m.source === 'mailbox');
step('the Emails tab shows OUR reply, read from the mailbox', mine.length === 1 && mine[0].direction === 'outbound' && /\$95\/hr/.test(mine[0].text), JSON.stringify((g.body.timeline || []).map(m => m.source + ':' + m.direction)));
step('…and says that our side was read', g.body.sent_side && g.body.sent_side.ok === true && g.body.sent_side.added === 1);
const callsAfterFirst = listCalls;
await r.get('j1', priya);
step('a second look within minutes is served from the short cache — one read, not two', listCalls === callsAfterFirst, listCalls + ' vs ' + callsAfterFirst);
const p = await r.post('j1', priya);
step('the AI is handed OUR reply as well as theirs', /\$95\/hr for the two technicians/.test(aiPrompt) && /What are your rates/.test(aiPrompt) && p.body.saved === true);
step('…and the response carries how our side was read', p.body.sent_side && p.body.sent_side.ok === true);

failList = true; sentItems = [];
r = mount();
g = await r.get('j1', priya);
step('when the mailbox cannot be read the tab says so and still shows everything else', g.body.sent_side && g.body.sent_side.ok === false && g.body.sent_side.reason === 'unreadable' && (g.body.timeline || []).some(m => m.direction === 'inbound'), JSON.stringify(g.body.sent_side));
const c1 = listCalls; await r.get('j1', priya);
step('a failure is never cached — the next look tries again', listCalls > c1);
failList = false; T.user_emails.length = 0;
g = await mount().get('j1', priya);
step('a person with no mailbox connected is told to connect one, not shown an empty Sent folder', g.body.sent_side && g.body.sent_side.ok === false && g.body.sent_side.reason === 'no_mailbox');

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
