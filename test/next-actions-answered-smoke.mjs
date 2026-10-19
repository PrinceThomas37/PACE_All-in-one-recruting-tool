// "NEEDS YOU TODAY" KNOWS WHEN WE ALREADY ANSWERED (R-268). The owner (19 Oct): the card said "Reply to Shane Willis —
// They asked a question today. You haven't replied." about people who HAD been answered. Two causes, both pinned here by
// driving the REAL GET /next-actions route against an in-memory database and a fake mailbox:
//   1. once the reply sweep had stored a conversation (their emails), the emails PACE itself had sent were left out of it,
//      so every stored thread read as unanswered;
//   2. a reply typed in Gmail, Outlook or PACE's mailbox is stored nowhere, so it was never seen. The list now asks the
//      caller's OWN mailboxes (headers only, cached, time-boxed) before calling a conversation "reply due".
// A mailbox that cannot be read changes nothing — the card stays, the safe direction.
// Usage: node test/next-actions-answered-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };

const ORG = 'org-a', ME = 'u-bea';
let T;
function seed() {
  T = {
    users: [{ id: ME, name: 'Bea', org_id: ORG, manager_id: null, deleted_at: null }],
    jobs: [
      { id: 'j1', org_id: ORG, position: 'Electrical Designer', stage: 'Connected', assigned_to_bd: ME, company: { name: 'Willis Electrical' } },
      { id: 'j2', org_id: ORG, position: 'Superintendent', stage: 'Connected', assigned_to_bd: ME, company: { name: 'Action Contractors' } },
    ],
    contacts: [
      { id: 'c1', org_id: ORG, job_id: 'j1', first_name: 'Shane', last_name: 'Willis', email: 'shane@williselectrical.com', created_at: '2026-10-01T00:00:00Z' },
      { id: 'c2', org_id: ORG, job_id: 'j2', first_name: 'Jonathan', last_name: 'Tasis', email: 'jt@actioncontractors.com', created_at: '2026-10-01T00:00:00Z' },
    ],
    conversation_messages: [
      { contact_id: 'c1', direction: 'inbound', body: 'Would we be able to do a brief phone interview? What is the potential start date?', sent_at: '2026-10-15T15:00:00Z' },
      { contact_id: 'c2', direction: 'inbound', body: 'Can you send the resumes over?', sent_at: '2026-10-08T15:00:00Z' },
    ],
    // PACE's own engine sent c2 a follow-up AFTER their email (stored in `emails`, the leads engine).
    emails: [{ org_id: ORG, contact_id: 'c2', status: 'sent', subject: 'Re: Candidates for your Superintendent role', sent_at: '2026-10-09T16:00:00Z' }],
    submissions: [], email_tracking: [], reminders: [], app_settings: [], organizations: [],
    user_emails: [{ id: 'mb1', user_id: ME, email_address: 'bea@ours.com', platform: 'Gmail', is_active: true }],
  };
}
function q(table) {
  const f = []; let lim = null;
  const api = new Proxy({}, { get(_, k) {
    if (k === 'eq') return (c, v) => { f.push(r => r[c] === v); return api; };
    if (k === 'neq') return (c, v) => { f.push(r => r[c] !== v); return api; };
    if (k === 'in') return (c, vs) => { f.push(r => vs.includes(r[c])); return api; };
    if (k === 'is') return (c, v) => { f.push(r => (r[c] == null) === (v == null)); return api; };
    if (k === 'limit') return (n) => { lim = n; return api; };
    if (k === 'maybeSingle' || k === 'single') return async () => ({ data: rows()[0] || null, error: null });
    if (k === 'then') return (a, b) => Promise.resolve({ data: rows(), error: null }).then(a, b);
    return () => api;   // select, order, not, gte … — this test does not need them to filter
  } });
  const rows = () => { const r = (T[table] || []).filter(x => f.every(fn => fn(x))); return lim ? r.slice(0, lim) : r; };
  return api;
}
const supabase = { from: q };

// The fake mailbox: what the Sent folder lists for a search. null = cannot be listed.
const mp = require('../services/mail-provider.js');
let sentFolder = null, lists = 0, bodies = 0;
mp.createMailProvider = () => ({ forMailbox: () => ({
  listMessages: async ({ q: addr }) => { lists++; if (!sentFolder) throw new Error('down'); return { messages: sentFolder.filter(m => JSON.stringify(m.to).toLowerCase().includes(String(addr).toLowerCase())) }; },
  getMessage: async () => { bodies++; return {}; },
}) });

function mount() {
  delete require.cache[require.resolve('../routes/next-actions.js')];
  const router = require('../routes/next-actions.js')({
    supabase, auth: (_q, _s, n) => n(), orgIdFor: () => null, today: () => '2026-10-19',
    withOrg: (query) => query,
  });
  const layer = router.stack.find(l => l.route && l.route.path === '/next-actions' && l.route.methods.get);
  return async () => {
    let body = null;
    const res = { status() { return res; }, json(b) { body = b; return res; } };
    await layer.route.stack.slice(-1)[0].handle({ user: { id: ME, role: 'bd', roles: ['bd'], name: 'Bea' }, query: {}, orgId: ORG }, res, () => {});
    return body;
  };
}
const replyDueFor = (body, name) => (body.items || []).some(i => /reply/i.test(String(i.kind || i.type || '')) && JSON.stringify(i).includes(name));
const mentions = (body, name) => JSON.stringify(body.items || []).includes(name);

seed(); sentFolder = null;
let b = await mount()();
step('the route answers', !!b && Array.isArray(b.items), JSON.stringify(b).slice(0, 200));
step('a conversation PACE\'s engine answered AFTER their email is NOT "reply due" (our logged send counts even when the sweep stored theirs)',
  !replyDueFor(b, 'Jonathan'), JSON.stringify(b.items.map(i => [i.kind, i.name || i.title])));
step('a conversation nobody answered, with the mailbox unreadable, still asks for a reply (the safe direction)',
  replyDueFor(b, 'Shane'), JSON.stringify(b.items.map(i => [i.kind, i.name || i.title])));

seed(); sentFolder = [{ id: 's1', subject: 'Re: Candidate Submission', date: '2026-10-14T10:00:00Z', to: [{ email: 'shane@williselectrical.com' }] }];
b = await mount()();
step('our mailbox reply from BEFORE their last email does not count', replyDueFor(b, 'Shane'));

seed(); sentFolder = [{ id: 's2', subject: 'Re: Candidate Submission', date: '2026-10-15T17:30:00Z', to: [{ email: 'Shane@WillisElectrical.com' }] }];
lists = 0; bodies = 0;
const run = mount();
b = await run();
step('a reply sent from Gmail/Outlook/PACE\'s mailbox AFTER theirs → no longer "reply due"', !replyDueFor(b, 'Shane'), JSON.stringify(b.items.map(i => [i.kind, i.name || i.title])));
step('…read from headers only — no email body was opened', lists > 0 && bodies === 0, `lists=${lists} bodies=${bodies}`);
const before = lists; await run();
step('…and asked once: a second load within minutes is answered from the cache', lists === before, `lists=${lists}`);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
