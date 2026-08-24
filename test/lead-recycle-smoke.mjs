// Unit checks for services/lead-recycle.js — deciding whether a stale
// 'Assigned' lead with no reply should be returned to the Unassigned pool.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isRecyclable, DAY_MS } = require('../services/lead-recycle.js');

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const NOW = Date.parse('2026-08-24T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * DAY_MS).toISOString();

step('a lead assigned 31 days ago with no reply IS recyclable',
  isRecyclable({ stage: 'Assigned', assigned_at: daysAgo(31) }, [], NOW, 30));

step('a lead assigned exactly at the threshold IS recyclable',
  isRecyclable({ stage: 'Assigned', assigned_at: daysAgo(30) }, [], NOW, 30));

step('a lead assigned only 10 days ago is NOT recyclable yet',
  !isRecyclable({ stage: 'Assigned', assigned_at: daysAgo(10) }, [], NOW, 30));

step('a lead not in Assigned stage is never recyclable',
  !isRecyclable({ stage: 'Connected', assigned_at: daysAgo(60) }, [], NOW, 30));

step('a lead with no assigned_at is never recyclable',
  !isRecyclable({ stage: 'Assigned', assigned_at: null }, [], NOW, 30));

step('a lead where ANY contact replied is never recycled — real engagement, not dead weight',
  !isRecyclable(
    { stage: 'Assigned', assigned_at: daysAgo(60) },
    [{ replied_at: null }, { replied_at: daysAgo(40) }],
    NOW, 30
  ));

step('a lead with contacts but no replies at all is still recyclable',
  isRecyclable(
    { stage: 'Assigned', assigned_at: daysAgo(60) },
    [{ replied_at: null }, { replied_at: null }],
    NOW, 30
  ));

step('the threshold is configurable — 45 days holds off a 31-day-old lead',
  !isRecyclable({ stage: 'Assigned', assigned_at: daysAgo(31) }, [], NOW, 45));

step('a missing job is handled safely',
  !isRecyclable(null, [], NOW, 30));

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
