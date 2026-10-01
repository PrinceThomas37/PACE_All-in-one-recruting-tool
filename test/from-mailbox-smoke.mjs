// CHOOSE THE FROM ADDRESS ON EVERY EMAIL, AND THE INTERVIEW CONFIRMATION (R-087, R-086).
//
// Owner, 29 Sep: "Selection of email ID is not there for client like its candidate.
// For any email that goes out there should be an option to choose from email ID."
// And: "Email is not initiated to the candidate after interview is scheduled. Even if
// it's phone call, the interview confirmation email should go with job details."
//
// The rule that makes the first safe: the page NAMES an id, the SERVER checks it is
// one of the caller's OWN connected, active mailboxes, and anything else is refused
// as if it did not exist — a From address the browser could set freely would be an
// identity chosen by the browser.
//
// The router is mounted for real against a fake database and spy senders; nothing
// is sent anywhere.
//   part 1 — the list: only mine, only connected, only active
//   part 2 — client email, candidate email, interview invite: the chosen mailbox
//            sends (and is recorded), a foreign one is refused BEFORE anything is
//            sent, and no choice means the primary as before
//   part 3 — the interview invite: a Gmail mailbox now sends (it used to call
//            Microsoft directly and fail), a phone interview still emails, and the
//            candidate's copy carries the job details while the BD manager's does not
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ORG = 'org-a', ME = 'u-me', OTHER = 'u-other';
const D = {
  user_emails: [
    { id: 'mb-primary', user_id: ME, org_id: ORG, email_address: 'me@ours.com', display_name: 'Me One', is_primary: true, is_active: true, platform: 'Microsoft' },
    { id: 'mb-gmail', user_id: ME, org_id: ORG, email_address: 'me@gmail.test', display_name: 'Me Two', is_primary: false, is_active: true, platform: 'Gmail' },
    { id: 'mb-dead', user_id: ME, org_id: ORG, email_address: 'dead@ours.com', display_name: 'Dead', is_primary: false, is_active: true, platform: 'Microsoft' },   // no token
    { id: 'mb-off', user_id: ME, org_id: ORG, email_address: 'off@ours.com', display_name: 'Off', is_primary: false, is_active: false, platform: 'Microsoft' },
    { id: 'mb-theirs', user_id: OTHER, org_id: ORG, email_address: 'them@ours.com', display_name: 'Them', is_primary: true, is_active: true, platform: 'Microsoft' },
  ],
  microsoft_tokens: [{ user_email_id: 'mb-primary' }, { user_email_id: 'mb-off' }, { user_email_id: 'mb-theirs' }],
  gmail_tokens: [{ user_email_id: 'mb-gmail' }],
  companies: [{ id: 'co1', name: 'Acme', org_id: ORG, deleted_at: null }],
  submissions: [],
  suppression_list: [],
};
const inserted = [], upserted = [];
function table(name) {
  const st = { f: [] };
  const rows = () => (D[name] || []).filter(r => st.f.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'is' ? (r[k] == null) === (v == null) : true));
  const api = {
    select() { return api; }, eq(k, v) { st.f.push(['eq', k, v]); return api; }, in(k, v) { st.f.push(['in', k, v]); return api; },
    is(k, v) { st.f.push(['is', k, v]); return api; }, not() { return api; }, order() { return api; }, limit() { return api; },
    single() { const r = rows()[0]; return Promise.resolve(r ? { data: r, error: null } : { data: null, error: { message: 'none' } }); },
    maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
    insert(p) { inserted.push({ table: name, row: p }); return Promise.resolve({ data: null, error: null }); },
    upsert(p) { upserted.push({ table: name, row: p }); return Promise.resolve({ data: null, error: null }); },
    then(a, b) { return Promise.resolve({ data: rows(), error: null }).then(a, b); },
  };
  return api;
}
const supabase = { from: table };

const sent = [];
const spy = {
  sendMicrosoftNewMessage: async (mailboxId, m) => { sent.push({ via: 'microsoft', mailboxId, to: m.to, subject: m.subject, html: m.htmlBody }); return { graphMessageId: 'g1', conversationId: 'c1' }; },
  gmailProvider: { sendNewMessage: async (mailboxId, m) => { sent.push({ via: 'gmail', mailboxId, to: m.to, subject: m.subject, html: m.htmlBody, from: m.fromAddress }); return { messageId: 'm1', threadId: 't1' }; } },
};

// ── mount the real router with a fake app ────────────────────────────────
const handlers = {};
const app = new Proxy({}, { get: (_t, verb) => (path, ...fns) => { handlers[verb.toUpperCase() + ' ' + path] = fns[fns.length - 1]; } });
const ctx = {
  supabase, auth: (_q, _s, n) => n(), hasRole: (req, ...roles) => roles.some(r => (req.user.roles || []).includes(r)),
  today: () => '2026-09-30', wfEngine: { registerChannel() {}, registerContextLoader() {}, exitEntity() {} },
  gmailProvider: spy.gmailProvider, config: {}, settingsConfig: { getSetting: async () => 0 },
  graphMailRequest: async () => ({}), sendMicrosoftNewMessage: spy.sendMicrosoftNewMessage,
  buildHtmlEmailBody: (text, sig) => '<div>' + text + '</div>' + (sig || ''), getMailboxSignature: async () => '', getMicrosoftToken: async () => 't',
  warmupLimit: () => 999, isSendingPaused: () => false, isManagerPaused: () => false,
  loadMailboxDelivState: async () => ({}), loadSuppressedSet: async () => new Set(), friendlySendError: (e) => String(e && e.message || e),
};
const built = require('../routes/recruiting/outreach.js')(app, ctx);
async function call(key, { user, body, params, query }) {
  let status = 200, out = null;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  const req = { user: user || { id: ME, roles: ['admin'] }, orgId: ORG, body: body || {}, params: params || {}, query: query || {}, headers: {} };
  await handlers[key](req, res);
  return { status, body: out };
}

// ═══ part 1 — the list ═══════════════════════════════════════════════════
const list = await call('GET /me/sending-mailboxes', {});
const ids = (list.body.mailboxes || []).map(m => m.id);
step('the From list is the caller\'s OWN mailboxes', ids.includes('mb-primary') && ids.includes('mb-gmail') && !ids.includes('mb-theirs'), ids.join(','));
step('…only ones that are connected and active (a mailbox with no token, or switched off, is not offered)', !ids.includes('mb-dead') && !ids.includes('mb-off'));
step('…with the default named (the primary, as before)', list.body.default_id === 'mb-primary');

// ═══ part 2 — every send honours the choice, and only among your own ═════════
D.companies[0].created_by = ME;
sent.length = 0; inserted.length = 0;
let r = await call('POST /companies/:id/email', { params: { id: 'co1' }, body: { to: 'cto@acme.test', subject: 'Hello', body: 'Hi', mailbox_id: 'mb-gmail' } });
step('client email: the chosen mailbox sends it — and it goes by ITS platform (Gmail)', r.status === 200 && sent.length === 1 && sent[0].via === 'gmail' && sent[0].mailboxId === 'mb-gmail', JSON.stringify(r.body));
step('…and the tracking record says which address it left from', inserted.some(i => i.table === 'email_tracking' && i.row.mailbox_email === 'me@gmail.test'));
sent.length = 0;
r = await call('POST /companies/:id/email', { params: { id: 'co1' }, body: { to: 'cto@acme.test', subject: 'Hello', body: 'Hi', mailbox_id: 'mb-theirs' } });
step('client email: somebody else\'s mailbox is refused as if it did not exist, and NOTHING is sent', r.status === 404 && sent.length === 0, r.status + ' ' + JSON.stringify(r.body));
r = await call('POST /companies/:id/email', { params: { id: 'co1' }, body: { to: 'cto@acme.test', subject: 'Hello', body: 'Hi', mailbox_id: 'mb-dead' } });
step('client email: a mailbox that is not connected is refused too', r.status === 404 && sent.length === 0);
r = await call('POST /companies/:id/email', { params: { id: 'co1' }, body: { to: 'cto@acme.test', subject: 'Hello', body: 'Hi' } });
step('client email: no choice means the primary, exactly as before', r.status === 200 && sent.length === 1 && sent[0].mailboxId === 'mb-primary');

sent.length = 0;
r = await call('POST /candidates/email', { body: { recipients: [{ email: 'cand@x.test', candidate_id: 'cd1' }], subject: 'Role', body: 'Hi', mailbox_id: 'mb-gmail' } });
step('candidate email: the same choice, the same check', r.status === 200 && sent.length === 1 && sent[0].mailboxId === 'mb-gmail');
sent.length = 0;
r = await call('POST /candidates/email', { body: { recipients: [{ email: 'cand@x.test' }], subject: 'Role', body: 'Hi', mailbox_id: 'mb-theirs' } });
step('candidate email: a mailbox that is not yours is refused before anything is sent', r.status === 404 && sent.length === 0);

// ═══ part 3 — the interview confirmation ════════════════════════════════
const job = { id: 'jo1', job_title: 'HVAC Service Technician', client: 'Griffith Energy', city: 'Westminster', state: 'MD',
  job_type: 'Full-time', remote: 'No', job_description: 'Service and repair commercial HVAC systems.  Hold EPA 608. ' + 'Work with a small crew. '.repeat(60),
  company: { name: 'Griffith Energy' }, bd_manager: { id: 'bd1', name: 'Neil Patrick', email: 'neil@ours.com' } };
const sub = (over) => Object.assign({ id: 'sub1', org_id: ORG, interview_at: '2026-10-05T14:00:00Z', interview_type: 'phone', interview_link: '+1 555 010 0000',
  interviewers: ['Jane Smith'], candidate_id: 'cd1', job_order_id: 'jo1', candidate: { id: 'cd1', full_name: 'Sarah Chen', email: 'sarah@x.test' }, job }, over || {});
D.submissions = [sub()];
sent.length = 0;
r = await call('POST /submissions/:id/interview-invite', { params: { id: 'sub1' }, body: { recipients: ['candidate'], mailbox_id: 'mb-gmail' } });
step('interview invite from a GMAIL mailbox now sends (it used to call Microsoft directly and fail)', r.status === 200 && r.body.sent === 1 && sent.length === 1 && sent[0].via === 'gmail', JSON.stringify(r.body));
const cand = sent[0] ? sent[0].html : '';
step('a PHONE interview still gets its confirmation, saying it is a phone call and the number', /Phone call/.test(cand) && /555 010 0000/.test(cand));
step('the candidate\'s copy carries the job details: place, job type, what the role is', /Westminster, MD/.test(cand) && /Full-time/.test(cand) && /About the role: Service and repair commercial HVAC/.test(cand), cand.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400));
step('…the description is cut short, never dumped whole', !/(Work with a small crew\. ){40}/.test(cand));
step('…and it states no pay figure', !/\$|per hour|salary|pay rate/i.test(cand));
sent.length = 0;
r = await call('POST /submissions/:id/interview-invite', { params: { id: 'sub1' }, body: { recipients: ['bd_manager'] } });
const bd = sent[0] ? sent[0].html : '';
step('the BD manager\'s copy does not carry the candidate-facing job blurb', r.body.sent === 1 && !/About the role/.test(bd) && /Sarah Chen/.test(bd));
sent.length = 0;
r = await call('POST /submissions/:id/interview-invite', { params: { id: 'sub1' }, body: { recipients: ['candidate'], mailbox_id: 'mb-theirs' } });
step('an invite from a mailbox that is not yours is refused before anything is sent', r.status === 404 && sent.length === 0);

// ── the interview time says WHICH clock it is on (R-095) ─────────────────────
const inviteHtml = async (tz) => { sent.length = 0; const body = { recipients: ['candidate'], mailbox_id: 'mb-gmail' }; if (tz) body.interview_tz = tz;
  await call('POST /submissions/:id/interview-invite', { params: { id: 'sub1' }, body }); return (sent[0] || {}).html || ''; };
const kol = await inviteHtml('Asia/Kolkata');
step('invite: 14:00 UTC picked in Kolkata reads 7:30 PM India Standard Time (UTC+05:30)', /7:30 PM India Standard Time/.test(kol) && /UTC\+05:30/.test(kol), kol.replace(/<[^>]+>/g, ' ').match(/Date & time:[^\n]{0,90}/) + '');
const ny = await inviteHtml('America/New_York');
step('invite: the same instant in New York reads 10:00 AM Eastern Daylight Time', /10:00 AM Eastern Daylight Time/.test(ny), ny.replace(/<[^>]+>/g, ' ').match(/Date & time:[^\n]{0,90}/) + '');
const none = await inviteHtml();
step('invite: no zone given says UTC plainly — never a bare time', /2:00 PM Coordinated Universal Time/.test(none));
const bogus = await inviteHtml('Mars/Olympus');
step('invite: an unknown zone is treated as UTC, not an error', /Coordinated Universal Time/.test(bogus));

const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
