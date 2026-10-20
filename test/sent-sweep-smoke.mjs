// OUR REPLIES, LEARNED IN THE BACKGROUND (R-296). The owner (20 Oct): "Needs you today" must know when we answered — from
// Gmail, Outlook or PACE's mailbox, on the same thread or another — without the live mailbox check that ran the server out of
// memory (R-291). services/sent-sweep.js reads a mailbox's Sent folder in the reply sweep and keeps a sent email ONLY when it
// went to someone who has written to us before. Pinned here with fakes (no network):
//   kept: a reply to a person who wrote in, on any thread · filed to their contact / candidate / lead · a short copy only
//   not kept: cold outreach to someone who never wrote · PACE's own engine sends (dropped by id, never even read) · mail
//             between colleagues
//   bounded: headers read one at a time, never more than MAX_FETCH per visit, a first visit reaches back 30 days, and the
//            bound moves forward so the next visit reads only newer mail.
// Usage: node test/sent-sweep-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ss = require('../services/sent-sweep.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };

const NOW = Date.parse('2026-10-20T12:00:00Z');
const MAILBOX = { user_email_id: 'mb1', email_address: 'Bea@Ours.com', org_id: 'org-a', provider: 'gmail' };
const OWN = new Set(['bea@ours.com', 'sam@ours.com']);
const KNOWN = new Map([
  ['shane@willis.com', { contact_id: 'c1', candidate_id: null, job_id: 'j1', company_id: 'co1' }],
  ['priya@mail.com', { contact_id: null, candidate_id: 'cand1', job_id: null, company_id: null }],
]);

function harness(sent, { paceIds = [] } = {}) {
  const log = { listedFrom: null, read: [], inFlight: 0, maxInFlight: 0, stored: [], knownAsked: null };
  return {
    log,
    run: (since) => ss.sweepSent({
      mailbox: MAILBOX, since, own: OWN, now: NOW,
      listIds: async (from, max) => { log.listedFrom = from; const ids = sent.filter(m => m.date > from).map(m => m.id); return { ids: ids.slice(0, max), more: ids.length > max }; },
      paceIds: async (ids) => new Set(ids.filter(id => paceIds.includes(id))),
      readHeaders: async (id) => {
        log.inFlight++; log.maxInFlight = Math.max(log.maxInFlight, log.inFlight); log.read.push(id);
        await new Promise(r => setTimeout(r, 1));
        log.inFlight--;
        return sent.find(m => m.id === id);
      },
      knownPeople: async (addrs) => { log.knownAsked = addrs; return new Map([...KNOWN].filter(([a]) => addrs.includes(a))); },
      store: async (row) => { log.stored.push(row); },
    }),
  };
}

const sent = [
  { id: 'g1', thread_key: 't-new', to: ['Shane@Willis.com'], cc: [], subject: 'Quick answer on start date', date: '2026-10-19T10:00:00Z', preview: 'Hi Shane — start date is the 3rd.' },
  { id: 'g2', thread_key: 't9', to: ['cold@prospect.com'], cc: [], subject: 'Hiring help?', date: '2026-10-19T11:00:00Z', preview: 'Cold note' },
  { id: 'g3', thread_key: 't7', to: ['shane@willis.com'], cc: [], subject: 'Engine follow-up', date: '2026-10-19T12:00:00Z', preview: 'Engine send' },
  { id: 'g4', thread_key: 't8', to: ['sam@ours.com'], cc: [], subject: 'internal', date: '2026-10-19T13:00:00Z', preview: 'colleague' },
  { id: 'g5', thread_key: 't5', to: ['someone@else.com'], cc: ['priya@mail.com'], subject: 'Interview', date: '2026-10-19T14:00:00Z', preview: 'x'.repeat(900) },
];
let h = harness(sent, { paceIds: ['g3'] });
let r = await h.run(null);
step('a first visit reaches back 30 days', h.log.listedFrom === new Date(NOW - 30 * 864e5).toISOString(), h.log.listedFrom);
const byId = Object.fromEntries(h.log.stored.map(x => [x.message_key, x]));
step('a reply to someone who wrote in is kept — on a NEW thread too (matched by person, not thread)', !!byId.g1 && byId.g1.thread_key === 't-new');
step('…filed to their contact and lead, as OUR side', byId.g1 && byId.g1.contact_id === 'c1' && byId.g1.job_id === 'j1' && byId.g1.company_id === 'co1' && byId.g1.direction === 'outbound',
  JSON.stringify(byId.g1));
step('…from the mailbox, to that person, stamped with the mailbox\'s company', byId.g1 && byId.g1.from_email === 'bea@ours.com' && byId.g1.to_email === 'shane@willis.com' && byId.g1.org_id === 'org-a');
step('cold outreach to someone who never wrote is NOT kept', !byId.g2);
step('PACE\'s own engine send is NOT kept — and never even read', !byId.g3 && !h.log.read.includes('g3'), JSON.stringify(h.log.read));
step('mail between colleagues is NOT kept', !byId.g4);
step('a candidate on cc counts (filed to the candidate)', byId.g5 && byId.g5.candidate_id === 'cand1' && byId.g5.contact_id === null);
step('only a short copy is kept (≤ 500 characters)', byId.g5 && byId.g5.body.length <= ss.BODY_CHARS);
step('our own addresses are never looked up as people', h.log.knownAsked && !h.log.knownAsked.includes('sam@ours.com'), JSON.stringify(h.log.knownAsked));
step('headers are read ONE at a time', h.log.maxInFlight === 1, `max in flight ${h.log.maxInFlight}`);
step('the bound moves to the newest sent email read', r.newest === '2026-10-19T14:00:00Z' && r.stored === 2, JSON.stringify(r));

h = harness(sent, { paceIds: ['g3'] });
r = await h.run('2026-10-19T13:30:00Z');
step('the next visit reads only newer mail', h.log.read.join() === 'g5', JSON.stringify(h.log.read));

const many = Array.from({ length: ss.MAX_FETCH + 50 }, (_, i) => ({ id: 'm' + i, to: ['x' + i + '@a.com'], cc: [], subject: 's', date: new Date(NOW - i * 60000).toISOString(), preview: '' }));
h = harness(many);
r = await h.run(null);
step('a busy Sent folder is bounded: never more than MAX_FETCH headers per visit, and says so', h.log.read.length === ss.MAX_FETCH && r.capped === true, `read=${h.log.read.length} capped=${r.capped}`);

step('addresses are read out of real header values', JSON.stringify(ss.addressesIn('"Laura K" <Laura@Elevate.com>, bob@y.co; <laura@elevate.com>')) === JSON.stringify(['laura@elevate.com', 'bob@y.co']),
  JSON.stringify(ss.addressesIn('"Laura K" <Laura@Elevate.com>, bob@y.co; <laura@elevate.com>')));

// lookupKnownPeople against an in-memory database: a stored reply wins, then a contact marked replied, then a candidate; scoped to the company.
const T = {
  conversation_messages: [
    { org_id: 'org-a', direction: 'inbound', from_email: 'shane@willis.com', contact_id: 'c1', candidate_id: null, job_id: 'j1', company_id: 'co1', sent_at: '2026-10-15T00:00:00Z' },
    { org_id: 'org-b', direction: 'inbound', from_email: 'other@org.com', contact_id: 'cx', candidate_id: null, job_id: 'jx', company_id: null, sent_at: '2026-10-15T00:00:00Z' },
  ],
  contacts: [{ org_id: 'org-a', id: 'c2', job_id: 'j2', email: 'jt@action.com', replied_at: '2026-10-01T00:00:00Z' },
    { org_id: 'org-a', id: 'c3', job_id: 'j3', email: 'never@replied.com', replied_at: null }],
  jobs: [{ id: 'j2', company_id: 'co2' }],
  candidates: [{ org_id: 'org-a', id: 'cand1', email: 'priya@mail.com', last_reply_at: '2026-10-02T00:00:00Z' }],
};
function q(table) {
  const f = [];
  const api = new Proxy({}, { get(_, k) {
    if (k === 'eq') return (c, v) => { f.push(r => r[c] === v); return api; };
    if (k === 'in') return (c, vs) => { f.push(r => vs.includes(r[c])); return api; };
    if (k === 'not') return (c, _op, _v) => { f.push(r => r[c] != null); return api; };
    if (k === 'then') return (a, b) => Promise.resolve({ data: (T[table] || []).filter(x => f.every(fn => fn(x))), error: null }).then(a, b);
    return () => api;
  } });
  return api;
}
const known = await ss.lookupKnownPeople({ from: q }, 'org-a', ['shane@willis.com', 'jt@action.com', 'priya@mail.com', 'never@replied.com', 'other@org.com']);
step('a person with a stored reply is known, filed to their lead', known.get('shane@willis.com') && known.get('shane@willis.com').contact_id === 'c1');
step('a contact marked replied is known, with the lead\'s company', known.get('jt@action.com') && known.get('jt@action.com').company_id === 'co2', JSON.stringify(known.get('jt@action.com')));
step('a candidate who answered is known', known.get('priya@mail.com') && known.get('priya@mail.com').candidate_id === 'cand1');
step('a contact who never replied is NOT known (cold outreach stays out)', !known.has('never@replied.com'));
step('another company\'s people are NOT known', !known.has('other@org.com'));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
