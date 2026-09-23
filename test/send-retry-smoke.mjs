// A failed send is sorted, retried on a backoff when the failure is temporary,
// never auto-retried when it might have gone out, and never offered a Retry
// when the recipient cannot receive it. (Session 29, R-036.)
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../services/send-retry.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }
const NOW = Date.parse('2026-09-23T18:00:00Z');
const mins = (iso) => Math.round((Date.parse(iso) - NOW) / 60000);

console.log('\nSend retry — classification');
t('THE INCIDENT: a sign-in failure is temporary, and an auth failure', () => {
  const msg = 'Token refresh failed: AADSTS700082 invalid_grant';
  assert.equal(R.classifyFailure(msg), R.KIND.TEMPORARY);
  assert.equal(R.isAuthFailure(msg), true);
});
t('throttling and Outlook store errors are temporary', () => {
  assert.equal(R.classifyFailure('Graph API 429 Too Many Requests'), R.KIND.TEMPORARY);
  assert.equal(R.classifyFailure('The item was not found in the store'), R.KIND.TEMPORARY);
});
t('recipient facts are permanent', () => {
  for (const m of ['suppression', 'Invalid recipient — not an email', 'Recipient address rejected: invalid', 'undeliverable'])
    assert.equal(R.classifyFailure(m), R.KIND.PERMANENT, m);
});
t('setup faults need a fix, not a wait', () => {
  for (const m of ['No sending email configured for this job', 'Gmail sending is not configured on the server yet', 'MailboxNotEnabledForRESTAPI'])
    assert.equal(R.classifyFailure(m), R.KIND.NEEDS_FIX, m);
});
t('a timeout mid-send is UNCERTAIN — it may have been delivered', () => {
  assert.equal(R.classifyFailure('Request to https://graph.microsoft.com/... timed out after 20000ms'), R.KIND.UNCERTAIN);
  assert.equal(R.classifyFailure('fetch failed'), R.KIND.UNCERTAIN);
});

console.log('\nSend retry — the ladder');
t('temporary: retried after 15 min, 1 h, 4 h, then stop', () => {
  const a = R.failureUpdate({ attempt_count: 0 }, 'invalid_grant', 'Sign-in expired', NOW);
  assert.equal(a.status, 'pending'); assert.equal(a.attempt_count, 1); assert.equal(mins(a.next_attempt_at), 15);
  const b = R.failureUpdate({ attempt_count: 1 }, 'invalid_grant', 'x', NOW);
  assert.equal(b.status, 'pending'); assert.equal(mins(b.next_attempt_at), 60);
  const c = R.failureUpdate({ attempt_count: 2 }, 'invalid_grant', 'x', NOW);
  assert.equal(c.status, 'pending'); assert.equal(mins(c.next_attempt_at), 240);
  const d = R.failureUpdate({ attempt_count: 3 }, 'invalid_grant', 'x', NOW);
  assert.equal(d.status, 'failed'); assert.equal(d.attempt_count, R.MAX_ATTEMPTS); assert.equal(d.next_attempt_at, null);
});
t('permanent, needs-fix and uncertain are never retried automatically', () => {
  for (const m of ['suppression', 'No sending email configured for this job', 'timed out']) {
    const u = R.failureUpdate({ attempt_count: 0 }, m, m, NOW);
    assert.equal(u.status, 'failed', m); assert.equal(u.next_attempt_at, null, m);
  }
});
t('the reason is always recorded, and bounded', () => {
  assert.equal(R.failureUpdate({}, 'x', 'Plain sentence', NOW).fail_reason, 'Plain sentence');
  assert.equal(R.failureUpdate({}, 'y'.repeat(900), null, NOW).fail_reason.length, 500);
});
t('a waiting row is not due until its time; a never-failed row is due', () => {
  assert.equal(R.isDue({ next_attempt_at: new Date(NOW + 60000).toISOString() }, NOW), false);
  assert.equal(R.isDue({ next_attempt_at: new Date(NOW - 1).toISOString() }, NOW), true);
  assert.equal(R.isDue({ next_attempt_at: null }, NOW), true);
});

console.log('\nSend retry — by hand');
t('an opted-out / bad-address failure is NEVER offered Retry', () => {
  assert.equal(R.canRetryByHand({ status: 'failed', fail_kind: 'permanent' }), false);
});
t('temporary-exhausted, uncertain, needs-fix and old unlabelled rows can be retried', () => {
  for (const k of ['temporary', 'uncertain', 'needs_fix', null, undefined])
    assert.equal(R.canRetryByHand({ status: 'failed', fail_kind: k }), true, String(k));
  assert.equal(R.canRetryByHand({ status: 'sent' }), false);
});
t('a manual retry is a fresh start, due now', () => {
  assert.deepEqual(R.manualRetryUpdate(), { status: 'pending', attempt_count: 0, next_attempt_at: null, fail_kind: null, fail_reason: null });
});
t('no retry when the same step for that contact is already queued or sent', () => {
  const e = { id: 'a', contact_id: 'c', job_id: 'j', followup_type: null, status: 'failed' };
  assert.equal(R.hasLiveTwin(e, [{ id: 'b', contact_id: 'c', job_id: 'j', followup_type: 'initial', status: 'sent' }]), true);
  assert.equal(R.hasLiveTwin(e, [{ id: 'b', contact_id: 'c', job_id: 'j', followup_type: 'fu1', status: 'sent' }]), false);
  assert.equal(R.hasLiveTwin(e, [{ id: 'b', contact_id: 'c', job_id: 'j', followup_type: null, status: 'failed' }]), false);
  assert.equal(R.hasLiveTwin(e, [e]), false);
});
t('the page sentence names the next try and never the raw provider text', () => {
  const s = R.describeRetry({ status: 'pending', attempt_count: 1, next_attempt_at: new Date(NOW + 15 * 60000).toISOString() }, NOW);
  assert.equal(s, 'Retry 1 of 3 in 15 min');
  assert.match(R.describeRetry({ status: 'failed', fail_kind: 'uncertain', attempt_count: 1 }, NOW), /Check Sent/);
  assert.match(R.describeRetry({ status: 'failed', fail_kind: 'temporary', attempt_count: 4 }, NOW), /Gave up after 3 retries/);
});

console.log('\nSend retry — wiring');
const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
t('the send loop never writes a bare status:failed except the no-columns fallback', () => {
  const bare = idx.match(/update\(\{ status: 'failed' \}\)/g) || [];
  assert.equal(bare.length, 1, `found ${bare.length}`);
  assert.match(idx, /async function recordSendFailure[\s\S]{0,900}update\(\{ status: 'failed' \}\)/);
});
t('the pending fetch filters rows still waiting out their backoff', () => {
  assert.match(idx, /pendingEmails\.filter\(e => sendRetry\.isDue\(e, now\)\)/);
  assert.match(idx, /PENDING_EMAIL_JOB_SELECT = '[^']*attempt_count, next_attempt_at/);
});
t('a mailbox whose sign-in fails is skipped for the rest of the run', () => {
  assert.match(idx, /sendRetry\.isAuthFailure\(e && e\.message\)\) authFailedMailboxes\.add\(userEmailId\)/);
  assert.match(idx, /authFailedMailboxes\.has\(userEmailId\)[\s\S]{0,200}continue;/);
});
t('the literal retry-failed route is registered above /emails/:id/retry', () => {
  const a = idx.indexOf("app.post('/emails/retry-failed'"), b = idx.indexOf("app.post('/emails/:id/retry'");
  assert.ok(a > 0 && b > a);
});
t('retry routes go through the org-scoped model, never raw supabase', () => {
  const block = idx.slice(idx.indexOf('async function requeueFailedEmails'), idx.indexOf("app.post('/emails/:id/retry'") + 1200);
  assert.doesNotMatch(block, /supabase\.from\('emails'\)/);
  assert.match(block, /db\.forRequest\(req\)\.from\('emails'\)/);
});
t('every onclick the Email page emits for retry is a real global', () => {
  const page = readFileSync(new URL('../public/js/07-page-email.js', import.meta.url), 'utf8');
  const acts = readFileSync(new URL('../public/js/11-bind-and-actions.js', import.meta.url), 'utf8');
  for (const fn of ['retryFailedEmail', 'retryAllFailedEmails']) {
    assert.ok(page.includes(fn + '('), 'page uses ' + fn);
    assert.ok(acts.includes('window.' + fn + '=function'), fn + ' defined');
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
