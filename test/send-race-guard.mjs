// Guard test for the duplicate-email-send fix (index.js).
//
// Root cause: processPendingEmailSends dispatched an email and only THEN marked
// it 'sent', with no atomic claim, and /emails/queue-all ran without the
// activeSendByUser concurrency lock. Two concurrent runs (double-click, or the
// manual send-all overlapping the auto-send / 20-min retry) both read the same
// 'pending' row and both dispatched to the provider → recipient emailed twice
// from ONE database row.
//
// The DB-level compare-and-swap is verified live against Supabase; this test
// pins the source-level invariants so the guard can't be silently removed:
//   1. an atomic pending->sending claim exists immediately before the send,
//      and the send is skipped when the claim returns no rows;
//   2. the deferred-follow-up path releases the claim back to 'pending';
//   3. /emails/queue-all acquires + releases the activeSendByUser lock.
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(new URL('../index.js', import.meta.url).pathname), 'utf8');
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

// 1. Atomic claim: conditional update pending->sending, scoped to the row.
const claim = /update\(\{\s*status:\s*'sending'\s*\}\)[\s\S]{0,120}\.eq\('id',\s*email\.id\)[\s\S]{0,60}\.eq\('status',\s*'pending'\)[\s\S]{0,40}\.select\(/;
step('Atomic pending->sending claim before dispatch', claim.test(SRC));

// The claim's result gates the dispatch (skip when nothing was claimed).
step('Send is skipped when the row was already claimed', /if\s*\(!claimedRows[\s\S]{0,300}continue;/.test(SRC));

// The claim must sit BEFORE the actual provider dispatch (the CALL, not the
// function definition — match the specific "const graph = await ..." call).
const claimIdx = SRC.search(/update\(\{\s*status:\s*'sending'\s*\}\)/);
const dispatchIdx = SRC.indexOf('const graph = await deliverOutboundEmail(');
step('Claim happens before the deliverOutboundEmail dispatch', claimIdx > -1 && dispatchIdx > -1 && claimIdx < dispatchIdx);

// 2. Deferred follow-up releases the claim back to pending (was never sent).
step('Deferred follow-up releases the claim back to pending',
  /deferFollowup[\s\S]{0,220}update\(\{\s*status:\s*'pending'\s*\}\)[\s\S]{0,80}\.eq\('status',\s*'sending'\)/.test(SRC));

// 3. queue-all respects the concurrency lock.
const qaStart = SRC.indexOf("app.post('/emails/queue-all'");
const qaBlock = SRC.slice(qaStart, qaStart + 4200);
step('queue-all skips when a send is already running for the user', /if\s*\(activeSendByUser\.has\(userId\)\)[\s\S]{0,120}return;/.test(qaBlock));
step('queue-all acquires the lock', /activeSendByUser\.add\(userId\)/.test(qaBlock));
step('queue-all releases the lock in finally', /finally\s*\{\s*activeSendByUser\.delete\(userId\)/.test(qaBlock));

const fails = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
