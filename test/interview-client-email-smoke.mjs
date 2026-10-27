// THE INTERVIEW EMAILS: ONE FOR EACH PERSON, EACH WITH WHAT THEY NEED (R-317, owner 26 Oct: "choose the sending mailbox; separate
// emails to client and candidate. Client: candidate full name, email, phone, interview time, mode, resume attached. Candidate:
// interviewers and their titles, invite link / phone / address by mode, JD").
//   The words (services/interview-invite.js) and the real route (POST /submissions/:id/interview-invite) against a fake database,
//   a fake file store and spy senders — nothing is sent anywhere:
//   · candidate + client → two separate emails from the chosen mailbox; the client's carries the résumé and the candidate's details;
//   · unticking the résumé sends no file and says nothing about one; no résumé on file → it goes and says so;
//   · a résumé that cannot be read just now stops the CLIENT copy only (never "attached" when it is not);
//   · a recruiter cannot email the client; no client address → refused in words.
// Usage: node test/interview-client-email-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };
const IV = require('../services/interview-invite.js');

const job = { id: 'jo1', job_title: 'HVAC Service Technician', client: 'Griffith Energy', city: 'Westminster', state: 'MD', job_type: 'Full-time',
  job_description: 'Service and repair commercial HVAC systems. Hold EPA 608.', company: { name: 'Griffith Energy' }, bd_manager: { id: 'bd1', name: 'Neil Patrick', email: 'neil@ours.com' } };
const subRow = { id: 'sub1', interview_at: '2026-10-05T14:00:00Z', interview_type: 'virtual', interview_platform: 'Zoom', interview_link: 'https://zoom.us/j/123',
  interviewers: ['Jane Smith (Hiring Manager)', 'Raj Patel (CTO)'], candidate_id: 'cd1', job_order_id: 'jo1' };
const cand = { id: 'cd1', full_name: 'Sarah Chen', email: 'sarah@x.test', phone: '+1 410 555 0100' };

// ── the words ──
const toClient = IV.buildInviteText({ sub: subRow, candidate: cand, job, role: 'client', tz: 'America/New_York', toName: 'Mark Lowe', resume: 'attached' });
step('client: addressed to the contact, with the candidate\'s full name, email and phone', /^Hi Mark,/.test(toClient) && /Name: Sarah Chen/.test(toClient) && /Email: sarah@x\.test/.test(toClient) && /Phone: \+1 410 555 0100/.test(toClient), toClient);
step('…when (in the zone, spelled out) and how (Zoom + link), and who is interviewing', /Date & time: .*Eastern/.test(toClient) && /Virtual \(Zoom\)/.test(toClient) && /zoom\.us\/j\/123/.test(toClient) && /Jane Smith \(Hiring Manager\)/.test(toClient));
step('…says the résumé is attached, and does NOT carry the job description back to the client', /résumé is attached/.test(toClient) && !/Job description/.test(toClient));
const toCand = IV.buildInviteText({ sub: subRow, candidate: cand, job, role: 'candidate', tz: 'America/New_York' });
step('candidate: interviewers with their titles, the join link, and the job description', /Interviewers:\n  • Jane Smith \(Hiring Manager\)\n  • Raj Patel \(CTO\)/.test(toCand) && /zoom\.us\/j\/123/.test(toCand) && /Job description\nService and repair/.test(toCand) && !/Phone: \+1 410/.test(toCand), toCand);
const inPerson = IV.buildInviteText({ sub: Object.assign({}, subRow, { interview_type: 'in_person', interview_address: '12 Main St, Westminster' }), candidate: cand, job, role: 'candidate', tz: 'UTC' });
const phone = IV.buildInviteText({ sub: Object.assign({}, subRow, { interview_type: 'phone', interview_link: '+1 555 010 0000' }), candidate: cand, job, role: 'candidate', tz: 'UTC' });
step('by mode: in person gives the address, phone gives the number', /Address: 12 Main St/.test(inPerson) && /Number: \+1 555 010 0000/.test(phone));
step('the résumé is not mentioned when the sender chose not to attach it', !/résumé/.test(IV.buildInviteText({ sub: subRow, candidate: cand, job, role: 'client', tz: 'UTC' })));
step('subjects say what each one is', IV.subjectFor({ role: 'client', candidate: cand, job }) === 'Interview confirmed: Sarah Chen — HVAC Service Technician' && /^Your interview/.test(IV.subjectFor({ role: 'candidate', candidate: cand, job })));

// ── the route ──
const ORG = 'org-a', ME = 'u-me';
const D = {
  user_emails: [{ id: 'mb-primary', user_id: ME, org_id: ORG, email_address: 'me@ours.com', display_name: 'Me', is_primary: true, is_active: true, platform: 'Microsoft' },
                { id: 'mb-gmail', user_id: ME, org_id: ORG, email_address: 'me@gmail.test', display_name: 'Me Two', is_primary: false, is_active: true, platform: 'Gmail' }],
  microsoft_tokens: [{ user_email_id: 'mb-primary' }], gmail_tokens: [{ user_email_id: 'mb-gmail' }],
  submissions: [Object.assign({ org_id: ORG, candidate: cand, job }, subRow)],
  candidate_documents: [{ id: 'doc1', candidate_id: 'cd1', org_id: ORG, doc_type: 'resume', filename: 'Sarah_Chen_Resume.pdf', content_type: 'application/pdf', storage_path: 'cd1/resume.pdf', deleted_at: null, uploaded_at: '2026-10-01' }],
  suppression_list: [],
};
let storageWorks = true;
function table(name) {
  const st = { f: [] };
  const rows = () => (D[name] || []).filter((r) => st.f.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'is' ? (r[k] == null) === (v == null) : true));
  const api = {
    select() { return api; }, eq(k, v) { st.f.push(['eq', k, v]); return api; }, in(k, v) { st.f.push(['in', k, v]); return api; },
    is(k, v) { st.f.push(['is', k, v]); return api; }, not() { return api; }, order() { return api; }, limit() { return api; },
    single() { const r = rows()[0]; return Promise.resolve(r ? { data: r, error: null } : { data: null, error: { message: 'none' } }); },
    maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
    insert() { return Promise.resolve({ data: null, error: null }); }, upsert() { return Promise.resolve({ data: null, error: null }); },
    then(a, b) { return Promise.resolve({ data: rows(), error: null }).then(a, b); },
  };
  return api;
}
const supabase = { from: table, storage: { from: () => ({ download: async () => (storageWorks ? { data: new Blob([Buffer.from('%PDF-1.4 resume')]), error: null } : { data: null, error: { message: 'down' } }) }) } };
const sent = [];
const handlers = {};
const app = new Proxy({}, { get: (_t, verb) => (path, ...fns) => { handlers[verb.toUpperCase() + ' ' + path] = fns[fns.length - 1]; } });
require('../routes/recruiting/outreach.js')(app, {
  supabase, auth: (_q, _s, n) => n(), hasRole: (req, ...roles) => roles.some((r) => (req.user.roles || []).includes(r)),
  today: () => '2026-10-27', wfEngine: { registerChannel() {}, registerContextLoader() {}, exitEntity() {} },
  gmailProvider: { sendNewMessage: async (id, m) => { sent.push({ via: 'gmail', mailboxId: id, to: m.to, cc: m.cc, subject: m.subject, html: m.htmlBody, att: (m.attachments || []).map((a) => a.filename) }); return { messageId: 'm', threadId: 't' }; } },
  sendMicrosoftNewMessage: async (id, m) => { sent.push({ via: 'microsoft', mailboxId: id, to: m.to, cc: m.cc, subject: m.subject, html: m.htmlBody, att: (m.attachments || []).map((a) => a.filename) }); return {}; },
  config: {}, settingsConfig: { getSetting: async () => 0 }, graphMailRequest: async () => ({}),
  buildHtmlEmailBody: (text) => '<div>' + text + '</div>', getMailboxSignature: async () => '', getMicrosoftToken: async () => 't',
  warmupLimit: () => 999, isSendingPaused: () => false, isManagerPaused: () => false, loadMailboxDelivState: async () => ({}), loadSuppressedSet: async () => new Set(), friendlySendError: (e) => String(e),
});
async function invite(body, roles) {
  let status = 200, out = null;
  const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } };
  await handlers['POST /submissions/:id/interview-invite']({ user: { id: ME, roles: roles || ['bd'] }, orgId: ORG, body, params: { id: 'sub1' }, query: {}, headers: {} }, res);
  return { status, body: out };
}
let r = await invite({ recipients: ['candidate', 'client'], client_to: 'mark@griffith.test, ops@griffith.test', client_name: 'Mark Lowe', mailbox_id: 'mb-gmail', interview_tz: 'America/New_York' });
const toC = sent.find((x) => x.to === 'sarah@x.test'), toCl = sent.find((x) => x.to === 'mark@griffith.test');
step('route: candidate and client get SEPARATE emails, both from the chosen mailbox', r.status === 200 && r.body.sent === 2 && sent.length === 2 && sent.every((x) => x.mailboxId === 'mb-gmail'), JSON.stringify(r.body));
step('…the client\'s goes to the contact (the second address copied) with the résumé attached', toCl && toCl.cc && toCl.cc[0] === 'ops@griffith.test' && toCl.att.join() === 'Sarah_Chen_Resume.pdf' && /Phone: \+1 410 555 0100/.test(toCl.html) && /résumé is attached/.test(toCl.html), JSON.stringify(toCl && { cc: toCl.cc, att: toCl.att }));
step('…the candidate\'s has no attachment, and the job description', toC && !toC.att.length && /Job description/.test(toC.html));
sent.length = 0;
r = await invite({ recipients: ['client'], client_to: 'mark@griffith.test', attach_resume: false });
step('résumé unticked: no file, and the email says nothing about one', r.body.sent === 1 && !sent[0].att.length && !/résumé/.test(sent[0].html));
sent.length = 0; storageWorks = false;
r = await invite({ recipients: ['candidate', 'client'], client_to: 'mark@griffith.test' });
const failedClient = (r.body.results || []).find((x) => x.role === 'client');
step('a résumé that cannot be read just now stops the CLIENT copy only — the candidate still gets theirs', r.body.sent === 1 && sent.length === 1 && sent[0].to === 'sarah@x.test' && failedClient && failedClient.status === 'failed' && /could not be attached/.test(failedClient.reason), JSON.stringify(r.body));
storageWorks = true; sent.length = 0;
const docs = D.candidate_documents; D.candidate_documents = [];
r = await invite({ recipients: ['client'], client_to: 'mark@griffith.test' });
step('no résumé on file: the client email still goes, and says so', r.body.sent === 1 && /no résumé on file|not have a résumé on file/i.test(sent[0].html));
D.candidate_documents = docs; sent.length = 0;
r = await invite({ recipients: ['client'], client_to: 'mark@griffith.test' }, ['recruiter']);
step('a recruiter cannot email the client (403), and nothing is sent', r.status === 403 && sent.length === 0);
r = await invite({ recipients: ['client'], client_to: 'not an address' });
step('no valid client address → refused in words, nothing sent', r.status === 400 && /client/.test(r.body.error) && sent.length === 0, JSON.stringify(r.body));

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
