// A lead sent back to the pool and re-assigned must be emailable again, and a
// finished send card must not outlive the queue it describes.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { cycleStartOf, blocksRegeneration, releaseToPoolUpdate } = require('../services/outreach-cycle.js');
const { isStaleProgress } = require('../services/send-progress.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }

console.log('\nOutreach cycle');
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-06-01T00:00:00.000Z';

t('cycle starts at the later of assigned_at / last_recycled_at', () => {
  assert.equal(cycleStartOf({ assigned_at: T1, last_recycled_at: T0 }), T1);
  assert.equal(cycleStartOf({ assigned_at: null, last_recycled_at: T1 }), T1);
});
t('a never-assigned lead has no cycle start', () => {
  assert.equal(cycleStartOf({ assigned_at: null, last_recycled_at: null }), null);
});
t('THE BUG: last cycle\'s sent outreach does not block the new cycle', () => {
  const old = { contact_id: 'c1', status: 'sent', followup_type: null, created_at: T0 };
  assert.equal(blocksRegeneration(old, cycleStartOf({ assigned_at: T1 })), false);
});
t('this cycle\'s outreach still blocks a duplicate', () => {
  const cur = { contact_id: 'c1', status: 'pending', followup_type: 'initial', created_at: '2026-06-02T00:00:00.000Z' };
  assert.equal(blocksRegeneration(cur, cycleStartOf({ assigned_at: T1 })), true);
});
t('with no cycle start, every prior outreach blocks (the safe direction)', () => {
  assert.equal(blocksRegeneration({ contact_id: 'c1', status: 'sent', created_at: T0 }, null), true);
});
t('failed and cancelled attempts never block', () => {
  for (const status of ['failed', 'cancelled']) {
    assert.equal(blocksRegeneration({ contact_id: 'c1', status, created_at: T1 }, T0), false, status);
  }
});
t('follow-ups never block an initial outreach', () => {
  assert.equal(blocksRegeneration({ contact_id: 'c1', status: 'sent', followup_type: 'fu1', created_at: T1 }, T0), false);
});
t('an email with no contact never blocks', () => {
  assert.equal(blocksRegeneration({ contact_id: null, status: 'sent', created_at: T1 }, T0), false);
});
t('releasing to the pool stamps last_recycled_at — the whole point', () => {
  const now = new Date(T1);
  const u = releaseToPoolUpdate(now);
  assert.equal(u.stage, 'Unassigned');
  assert.equal(u.assigned_to_bd, null);
  assert.equal(u.assigned_at, null);
  assert.equal(u.sending_email_id, null);
  assert.equal(u.last_recycled_at, now);
});
t('release then re-assign makes the lead emailable end to end', () => {
  const sent = { contact_id: 'c1', status: 'sent', followup_type: null, created_at: T0 };
  const released = releaseToPoolUpdate(new Date(T1));
  const reassigned = { assigned_at: '2026-06-05T00:00:00.000Z', last_recycled_at: released.last_recycled_at };
  assert.equal(blocksRegeneration(sent, cycleStartOf(reassigned)), false);
});

console.log('\nSend progress staleness');
const NOW = Date.parse('2026-09-07T12:00:00.000Z');
t('an active run never expires, however old', () => {
  assert.equal(isStaleProgress({ active: true, startedAt: T0 }, NOW), false);
});
t('a run finished minutes ago still shows', () => {
  assert.equal(isStaleProgress({ active: false, done: true, completedAt: new Date(NOW - 60000).toISOString() }, NOW), false);
});
t('a run finished hours ago is stale', () => {
  assert.equal(isStaleProgress({ active: false, done: true, completedAt: new Date(NOW - 3 * 3600e3).toISOString() }, NOW), true);
});
t('a finished run with no timestamp cannot sit on screen forever', () => {
  assert.equal(isStaleProgress({ active: false, done: true }, NOW), true);
});
t('nothing to expire when there is no progress', () => {
  assert.equal(isStaleProgress(null, NOW), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
