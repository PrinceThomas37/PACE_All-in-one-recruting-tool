// A SEND RUN PICKS UP MAIL QUEUED WHILE IT RUNS (owner, 29 Oct 2026).
// "It shows 41 to go but Pending says 211" · "on the 28th the follow-ups went first, then the first outreach" ·
// "sending stops and I have to start it again". All three came from a run working through a snapshot of the queue taken
// when it began. Here the REAL index.js runSendPasses (lifted out of the source) drives a fake send loop: a pass that
// stops because new mail arrived is followed by a fresh pass over the WHOLE queue, and the totals add up across passes.
// Usage: node test/send-passes-smoke.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sendPasses = require('../services/send-passes.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const fnSrc = (src.match(/async function runSendPasses\([\s\S]*?\n\}\n/) || [])[0];
step('index.js defines runSendPasses', !!fnSrc);
step('Send all pending runs through it', /app\.post\('\/emails\/queue-all'[\s\S]*?await runSendPasses\(userId, pendingEmails/.test(src));
step('the automatic run goes through it too', /async function autoSendForManager[\s\S]*?await runSendPasses\(managerId, pendingEmails/.test(src));
step('a pass looks for mail queued since it began, and stops for it', /opts\.watchArrivals[\s\S]{0,400}gt\('created_at', opts\.fetchedAt \|\| startedAt\)[\s\S]{0,200}restart = true;[\s\S]{0,200}break;/.test(src));
step('the mailbox spacing carries across passes', /lastSendAtByMailbox = \(opts\.carry && opts\.carry\.lastSendAtByMailbox\)/.test(src));
step('a run cut off by a restart is resumed after boot', /send_progress_%[\s\S]{0,900}autoSendForManager\(uid\)/.test(src));

// Drive it: pass 1 sends 3 follow-ups, then 2 first emails arrive → pass 2 sees all 5 left, first emails first, sends them.
const queue = [
  { id: 'f1', t: 'fu1' }, { id: 'f2', t: 'fu1' }, { id: 'f3', t: 'fu2' }, { id: 'f4', t: 'fu2' }, { id: 'f5', t: 'fu2' },
];
const sentOrder = [], calls = [];
let arrived = false;
async function processPendingEmailSends(userId, pending, opts) {
  calls.push({ n: pending.length, prior: opts.prior, carry: opts.carry });
  const order = pending.slice().sort((a, b) => (a.t === 'initial' ? 0 : 1) - (b.t === 'initial' ? 0 : 1));
  let sent = 0;
  for (const e of order) {
    if (opts.watchArrivals && !arrived && sent === 3) {               // the first emails of a fresh assignment land
      arrived = true; queue.push({ id: 'i1', t: 'initial' }, { id: 'i2', t: 'initial' });
      return { sent, failed: 0, retrying: 0, failDetails: [], sentContactIds: [], sentJobIds: [], totalCount: pending.length, restart: true, carry: { lastSendAtByMailbox: { m: 1 } } };
    }
    sentOrder.push(e.id); sent++; queue.splice(queue.findIndex(q => q.id === e.id), 1);
  }
  return { sent, failed: 0, retrying: 0, failDetails: [], sentContactIds: [], sentJobIds: [], totalCount: pending.length, restart: false, carry: opts.carry };
}
async function fetchPendingEmailsForUser() { return queue.slice(); }
const runSendPasses = new Function('processPendingEmailSends', 'fetchPendingEmailsForUser', 'sendPasses', fnSrc + '\nreturn runSendPasses;')(processPendingEmailSends, fetchPendingEmailsForUser, sendPasses);

const r = await runSendPasses('u1', queue.slice(), { autoSend: true });
step('two passes ran', calls.length === 2, String(calls.length));
step('the second pass saw the whole queue, including the new first emails', calls[1].n === 4, String(calls[1].n));
step('the new first emails went before the remaining follow-ups', sentOrder.join(',') === 'f1,f2,f3,i1,i2,f4,f5', sentOrder.join(','));
step('the spacing from pass 1 was handed to pass 2', calls[1].carry && calls[1].carry.lastSendAtByMailbox.m === 1);
step('the run totals add up: 7 sent of 7', r.sent === 7 && r.totalCount === 7, `${r.sent}/${r.totalCount}`);
step('nothing is left in the queue', queue.length === 0);

// The card during pass 2 adds pass 1 underneath.
const prior = sendPasses.addPass(null, { sent: 3, failed: 1, retrying: 0, failDetails: [{ to: 'x' }] }, 'T0');
const shown = sendPasses.withPrior({ total: 10, sent: 2, failed: 0, retrying: 0, failDetails: [] }, prior);
step('the card counts both passes', shown.total === 14 && shown.sent === 5 && shown.failed === 1 && shown.failDetails.length === 1);
step('a pass that ended for any other reason does not start another', !sendPasses.shouldContinue({ restart: false }, 1, 50));
step('nothing due → no further pass', !sendPasses.shouldContinue({ restart: true }, 1, 0));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
