// THE REPLY SWEEP DOES NOT TREAT AN OUT-OF-OFFICE AS AN ANSWER (owner, 14 Oct: "a lead that gets an automated reply is being
// marked as Connected").
//
// The REAL processInboundMessages is lifted out of index.js and run over an in-memory database (as contact-status-smoke does for the
// send-time rules). Two messages arrive from the same contact:
//   1. an Outlook "Automatic reply:" — the lead must STAY Assigned, replied_at stays empty, the follow-ups are NOT cancelled, the
//      lead is tagged Auto-replied, and the history says what happened;
//   2. then a person answering — NOW the lead moves to Connected, replied_at is stamped, follow-ups stop, and the tag is cleared.
// And a database that has not had migration 066: the auto-reply still must not move the lead (the tag simply cannot be written).
// Usage: node test/auto-reply-sweep-smoke.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const m = src.match(/async function processInboundMessages\([\s\S]*?\n\}\n/);
step('index.js still defines processInboundMessages', !!m);

function build({ migrated, status = 'valid' }) {
  const ORG = 'org-a', JOB = uid(), CT = uid();
  const fake = createFakeDb({
    tables: {
      jobs: [{ id: JOB, org_id: ORG, stage: 'Assigned', ...(migrated ? { auto_replied_at: null } : {}) }],
      contacts: [{ id: CT, org_id: ORG, job_id: JOB, email: 'jcoffman@thomaselectricalinc.com', replied_at: null, email_status: status, ooo_until: null }],
      email_tracking: [], emails: [],
    },
  });
  // a database without migration 066 refuses the unknown column, as the real one does (42703)
  const supabase = migrated ? fake.supabase : { ...fake.supabase, from(t) {
    const q = fake.supabase.from(t);
    if (t !== 'jobs') return q;
    const upd = q.update.bind(q);
    q.update = (p) => (p && 'auto_replied_at' in p) ? { eq: () => ({ not: () => Promise.resolve({ error: { code: '42703', message: 'column "auto_replied_at" does not exist' } }), then: (r) => r({ error: { code: '42703' } }) }), then: (r) => r({ error: { code: '42703' } }) } : upd(p);
    return q;
  } };
  const log = { activity: [], skipped: [], emitted: [] };
  const deps = {
    supabase, autoReply: require('../services/auto-reply.js'), replyDecline: require('../services/reply-decline.js'),
    isWarmupMessage: () => false, isNdrMessage: () => false, isOptOutReply: () => false,
    clientIntel: { domainOf: () => '', gateMessage: () => ({ keep: false }) },
    storeConversationMessage: async () => {}, addToSuppression: async () => {},
    skipActiveFollowUpsForContact: async (id) => { log.skipped.push(id); },
    logActivity: async (job, contact, user, type, text) => { log.activity.push({ type, text }); },
    emit: (e) => { log.emitted.push(e); }, EVENTS: { CONTACT_REPLIED: 'CONTACT_REPLIED', CONTACT_UNSUBSCRIBED: 'u', CANDIDATE_REPLIED: 'c', CANDIDATE_UNSUBSCRIBED: 'cu' },
  };
  const names = Object.keys(deps);
  const fn = new Function(...names, m[0] + '\nreturn processInboundMessages;')(...names.map(k => deps[k]));
  return { fn, fake, log, JOB, CT };
}
const tokenRow = { email_address: 'me@futeglobal.com', org_id: 'org-a' };
const from = { emailAddress: { address: 'jcoffman@thomaselectricalinc.com', name: 'Jamyce' } };
const auto = { id: 'a1', subject: 'Automatic reply: Commercial Electrical Superintendent - candidates ready', from, receivedDateTime: '2026-10-09T10:00:00Z',
  bodyPreview: 'I am currently out of the office, returning Monday, October 12th, 2026.', body: { contentType: 'text', content: 'I am currently out of the office, returning Monday, October 12th, 2026. I will respond upon my return.' } };
const human = { id: 'h1', subject: 'Re: Commercial Electrical Superintendent', from, receivedDateTime: '2026-10-13T10:00:00Z',
  bodyPreview: 'Yes, please send two profiles.', body: { contentType: 'text', content: 'Yes, please send two profiles.' } };

for (const migrated of [true, false]) {
  const tag = migrated ? '' : '(before migration 066) ';
  const { fn, fake, log, JOB, CT } = build({ migrated });
  const job = () => fake.tables.jobs.find(r => r.id === JOB), ct = () => fake.tables.contacts.find(r => r.id === CT);
  const r1 = await fn([auto], new Set(['me@futeglobal.com']), tokenRow, '2026-10-01T00:00:00Z');
  step(tag + 'an automatic reply leaves the lead at Assigned', job().stage === 'Assigned', job().stage);
  step(tag + '…does not stamp the contact as having replied', !ct().replied_at);
  step(tag + '…does not cancel the follow-ups', log.skipped.length === 0);
  step(tag + '…is not counted as a reply received', r1.detected === 0 && !log.emitted.includes('CONTACT_REPLIED'), JSON.stringify(r1));
  step(tag + '…and the history says it was automatic', log.activity.some(a => a.type === 'auto_reply_received' && /out of office/.test(a.text)));
  if (migrated) step('…and tags the lead Auto-replied', !!job().auto_replied_at);
  await fn([human], new Set(['me@futeglobal.com']), tokenRow, '2026-10-01T00:00:00Z');
  step(tag + 'then a person answering moves it to Connected', job().stage === 'Connected', job().stage);
  step(tag + '…stamps the reply and stops the follow-ups', !!ct().replied_at && log.skipped.length === 1);
  if (migrated) step('…and clears the Auto-replied tag', job().auto_replied_at == null);
}
// ── an out-of-office that says WHEN they are back pauses the follow-ups until then ──
{
  const { fn, fake, log, CT, JOB } = build({ migrated: true });
  const ct = () => fake.tables.contacts.find(r => r.id === CT);
  await fn([auto], new Set(['me@futeglobal.com']), tokenRow, '2026-10-01T00:00:00Z');
  step('"returning Monday, October 12th, 2026" marks the contact Out of office until 2026-10-12', ct().email_status === 'out_of_office' && ct().ooo_until === '2026-10-12', JSON.stringify([ct().email_status, ct().ooo_until]));
  step('…and the history says why, with the words it read', log.activity.some(a => a.type === 'ooo_set' && /2026-10-12/.test(a.text) && /returning Monday/.test(a.text)));
  step('…the lead itself still did not move', fake.tables.jobs.find(r => r.id === JOB).stage === 'Assigned');
}
{
  const { fn, fake, log, CT } = build({ migrated: true });
  const past = Object.assign({}, auto, { id: 'p1', subject: 'Automatic reply: x', body: { contentType: 'text', content: 'I am currently out of office without access to phone or email. I will return September 10th, 2026' } });
  await fn([past], new Set(['me@futeglobal.com']), tokenRow, '2026-10-01T00:00:00Z');
  const c = fake.tables.contacts.find(r => r.id === CT);
  step('a return date already in the past pauses nothing', c.email_status === 'valid' && !c.ooo_until && !log.activity.some(a => a.type === 'ooo_set'));
}
for (const st of ['invalid', 'blocked', 'deactivated']) {
  const { fn, fake, CT } = build({ migrated: true, status: st });
  await fn([auto], new Set(['me@futeglobal.com']), tokenRow, '2026-10-01T00:00:00Z');
  step('a ' + st + ' contact is never rescued by an auto-reply (status unchanged)', fake.tables.contacts.find(r => r.id === CT).email_status === st);
}
{
  const { fn, fake, JOB } = build({ migrated: true });
  const receipt = { id: 'r1', subject: 'Read: No Hire No Fee | Physician Assistant', from, receivedDateTime: '2026-10-08T22:02:00Z', bodyPreview: 'Your message was read', body: { contentType: 'text', content: 'Your message\n\n To: James Hu\n Subject: x\n Sent: Thursday\n\n was read on Thursday, October 8, 2026 2:56:00 PM (UTC-08:00).' } };
  await fn([receipt], new Set(['me@futeglobal.com']), tokenRow, '2026-10-01T00:00:00Z');
  step('a read receipt does not move the lead to Connected', fake.tables.jobs.find(r => r.id === JOB).stage === 'Assigned');
}
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
