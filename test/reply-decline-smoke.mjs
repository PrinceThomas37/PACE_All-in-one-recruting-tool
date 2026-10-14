// A CLIENT WHO SAYS NO IS REJECTED, NOT CONNECTED — AND A FRIENDLY REPLY IS NEVER AN UNSUBSCRIBE (owner, 14 Oct).
// 1. services/reply-decline.js, with the live wording: the four leads that had to be moved by hand, and the replies that must stay interested;
// 2. the REAL reply sweep (processInboundMessages lifted out of index.js): a decline moves an Assigned lead to Rejected and stops the
//    follow-ups; an unsubscribe also goes on the do-not-email list; an interested reply is still Connected; a mixed or soft reply is left for a
//    person; and — found on the live data — a friendly reply that QUOTES our own footer ("just reply 'unsubscribe'") is NOT an opt-out any more
//    (seven interested contacts had been put on the do-not-email list that way).
// Usage: node test/reply-decline-smoke.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const { classifyDecline } = require('../services/reply-decline.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const msgOf = (text, extra) => Object.assign({ id: uid(), subject: 'Re: Candidates', receivedDateTime: '2026-10-14T12:00:00Z', from: { emailAddress: { address: 'jcoffman@thomaselectricalinc.com', name: 'J' } }, bodyPreview: text.slice(0, 200), body: { contentType: 'text', content: text } }, extra || {});
const FOOTER = '\n\nOn Wed, Oct 14, 2026 at 9:51 AM Prince Thomas <prince.thomas@futeglobal.com> wrote:\n> Hi Tj,\n> Can I send you a few resumes?\n> If you\'d prefer not to hear from me, just reply "unsubscribe" and I\'ll remove you from my list.';

// ── 1. the rule ──
const no = (t) => classifyDecline(msgOf(t));
step('Phillips: "No thank you. We hire via Indeed and referrals." is a no', no('No thank you. We hire via Indeed and referrals.\n\nJennifer Smith\nHuman Resources Manager').decline);
step('ARC: "We don\'t use outside agencies. Please unsubscribe." is a no (unsubscribe)', no("We don't use outside agencies. Please unsubscribe. Thank you!").why === 'unsubscribe');
step('Tessmer: "UNSUBSCRIBE" is a no', no('UNSUBSCRIBE\n\nFrom: prince.thomas@futeglobal.com\nSent: Wednesday').decline);
step('Elevate: "not the correct person … please remove me from your list" is a no', no('I am not the correct person to reach out to about positions here; please\nremove me from your list.').decline);
step('"Not interested" alone is a no', no('Not interested – thank you.').why === 'declined');
for (const t of ['What are your fees?', 'Yes, please send them over. Thanks!', 'Sounds good, thank you.', 'We only pay 10%\nThanks', 'OK we will have a look. Thank you:)', 'Sure', 'If you would like to send resumes I can review.']) step('an interested reply is not a no: "' + t.split('\n')[0] + '"', !no(t).decline);
step('MIXED: "not interested in this role, but send me your other profiles" is left for a person', !no('Not interested in this role, but please send me your other profiles.').decline);
step('SOFT: "we are good for now, maybe next quarter" is left for a person', !no('We are good for now, maybe next quarter.').decline);
step('SOFT: "all set at the moment, keep us in mind" is left for a person', !no('Thanks. We are all set at the moment, keep us in mind.').decline);
step('an unsubscribe is a no even when it asks for something', no('Please unsubscribe me. Send me no more profiles.').decline);
step('the quote of OUR email is never read ("no charge", "reply unsubscribe")', !no('Yes, please send them over. Thanks!' + FOOTER).decline);

// ── 2. the real sweep ──
const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const m = src.match(/async function processInboundMessages\([\s\S]*?\n\}\n/);
step('index.js still defines processInboundMessages', !!m);
function build() {
  const ORG = 'org-a', JOB = uid(), CT = uid();
  const fake = createFakeDb({ tables: { jobs: [{ id: JOB, org_id: ORG, stage: 'Assigned' }], contacts: [{ id: CT, org_id: ORG, job_id: JOB, email: 'jcoffman@thomaselectricalinc.com', replied_at: null, email_status: 'valid' }], email_tracking: [], emails: [] } });
  const log = { activity: [], skipped: [], suppressed: [] };
  const deps = { supabase: fake.supabase, autoReply: require('../services/auto-reply.js'), replyDecline: require('../services/reply-decline.js'),
    isWarmupMessage: () => false, isNdrMessage: () => false, isOptOutReply: require('../deliverability.js').isOptOutReply,
    clientIntel: { domainOf: () => '', gateMessage: () => ({ keep: false }) }, storeConversationMessage: async () => {},
    addToSuppression: async (email, reason) => { log.suppressed.push([email, reason]); }, skipActiveFollowUpsForContact: async (id) => { log.skipped.push(id); },
    logActivity: async (j, c, u, type, text) => { log.activity.push({ type, text }); }, emit: () => {},
    EVENTS: { CONTACT_REPLIED: 'r', CONTACT_UNSUBSCRIBED: 'u', CANDIDATE_REPLIED: 'cr', CANDIDATE_UNSUBSCRIBED: 'cu' } };
  const names = Object.keys(deps);
  return { fn: new Function(...names, m[0] + '\nreturn processInboundMessages;')(...names.map(k => deps[k])), fake, log, JOB, CT };
}
const tokenRow = { email_address: 'me@futeglobal.com', org_id: 'org-a' };
async function run(text) {
  const w = build(); await w.fn([msgOf(text)], new Set(['me@futeglobal.com']), tokenRow, '2026-10-01T00:00:00Z');
  return { stage: w.fake.tables.jobs[0].stage, replied: !!w.fake.tables.contacts[0].replied_at, ...w.log };
}
let r = await run('No thank you. We hire via Indeed and referrals.');
step('SWEEP: a "no thank you" moves an Assigned lead to REJECTED (not Connected)', r.stage === 'Rejected', r.stage);
step('…the follow-ups stop and the reply is recorded', r.skipped.length === 1 && r.replied);
step('…the history says why', r.activity.some(a => a.type === 'stage_change' && /Rejected/.test(a.text) && /said no/.test(a.text)));
step('…and a plain "no" is NOT put on the do-not-email list (they did not ask to be removed)', r.suppressed.length === 0, JSON.stringify(r.suppressed));
r = await run("We don't use outside agencies. Please unsubscribe.");
step('SWEEP: an unsubscribe is Rejected AND goes on the do-not-email list', r.stage === 'Rejected' && r.suppressed.length === 1 && r.suppressed[0][1] === 'unsubscribe');
r = await run('What are your fees?');
step('SWEEP: an interested reply is still CONNECTED', r.stage === 'Connected' && r.suppressed.length === 0);
r = await run('Not interested in this role, but please send me your other profiles.');
step('SWEEP: a mixed reply stays Connected for a person to read', r.stage === 'Connected');
r = await run('We are good for now, maybe next quarter.');
step('SWEEP: a soft "not now" stays Connected for a person to read', r.stage === 'Connected');
r = await run('Yes, please send them over. Thanks!' + FOOTER);
step('SWEEP: a friendly reply that QUOTES our "reply unsubscribe" footer is Connected…', r.stage === 'Connected', r.stage);
step('…and is NOT put on the do-not-email list (seven live contacts had been, by this)', r.suppressed.length === 0, JSON.stringify(r.suppressed));
r = await run('unsubscribe' + FOOTER);
step('SWEEP: a real "unsubscribe" with the footer quoted underneath still counts', r.stage === 'Rejected' && r.suppressed.length === 1);
const bad = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
