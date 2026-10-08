// UP TO FIVE FOLLOW-UPS, THE PERSON'S CHOICE (owner, 8 Oct: "do the database change — it's the user's choice to select the number of
// follow-ups, if any needed"). Proven here, pure: how many a person wants (and that nobody who never chose changes: still two, day 3 and 7),
// when each is due, that only the NEXT one is ever due, that sending the last scheduled one finishes the row, and that a row made before
// follow-ups 3–5 existed behaves exactly as it always did.
// Usage: node test/followup-steps-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const F = require('../services/followup-steps.js');

step('nobody who never chose changes: two follow-ups, on day 3 and day 7', F.countFor({}, 'u') === 2 && F.dayFor({}, 'u', 1) === 3 && F.dayFor({}, 'u', 2) === 7);
step('a person can ask for none, or up to five', [0, 1, 2, 3, 4, 5].every(n => F.countFor({ u_u_fu_count: String(n) }, 'u') === n));
step('anything odd (6, -1, "x", 2.5, empty) is the old two — never a crash, never six', ['6', '-1', 'x', '2.5', ''].every(v => F.countFor({ u_u_fu_count: v }, 'u') === 2));
step('the days after the first email: 3, 7, 14, 21, 28 unless the person set their own (1–90 only)', [1, 2, 3, 4, 5].map(n => F.dayFor({}, 'u', n)).join() === '3,7,14,21,28' && F.dayFor({ u_u_fu3_day: '10' }, 'u', 3) === 10 && F.dayFor({ u_u_fu3_day: '0' }, 'u', 3) === 14 && F.dayFor({ u_u_fu3_day: '91' }, 'u', 3) === 14);
const t0 = new Date('2026-10-08T12:00:00Z');
let d = F.dueDates({}, 'u', t0);
step('a new row for a person who never chose gets exactly what it always did: follow-ups 1 and 2, nothing for 3–5', d.followup1_due_date === '2026-10-11' && d.followup2_due_date === '2026-10-15' && d.followup3_due_date === null && d.followup4_due_date === null && d.followup5_due_date === null, JSON.stringify(d));
d = F.dueDates({ u_u_fu_count: '4', u_u_fu3_day: '12' }, 'u', t0);
step('four follow-ups: four due dates (with the person\'s own day for the third), the fifth empty', d.followup3_due_date === '2026-10-20' && d.followup4_due_date === '2026-10-29' && d.followup5_due_date === null);
d = F.dueDates({ u_u_fu_count: '0' }, 'u', t0);
step('none: no due date at all (the caller then schedules nothing)', Object.values(d).every(v => v === null));

// a row's life
const base = { followup1_due_date: '2026-10-11', followup2_due_date: '2026-10-15', followup3_due_date: '2026-10-22', followup4_due_date: null, followup5_due_date: null };
let row = { ...base };
step('before its date nothing is due', F.nextDue(row, '2026-10-10') === 0);
step('on its date follow-up 1 is due', F.nextDue(row, '2026-10-11') === 1);
step('only the NEXT one: a long-overdue row is due for 1, not 1 and 2 and 3 at once', F.nextDue(row, '2026-12-01') === 1);
row.followup1_sent_at = 'x';
step('after 1 has gone, 2 is due on its date', F.nextDue(row, '2026-10-14') === 0 && F.nextDue(row, '2026-10-15') === 2);
row.followup2_sent_at = 'x';
step('then 3', F.nextDue(row, '2026-10-21') === 0 && F.nextDue(row, '2026-10-22') === 3);
step('1 and 2 are not "last"; 3 is (nothing scheduled after it)', !F.isLast(row, 1) && !F.isLast(row, 2) && F.isLast(row, 3));
row.followup3_sent_at = 'x';
step('after the last scheduled one nothing is ever due again', F.nextDue(row, '2027-01-01') === 0);
step('a follow-up cannot jump the queue: 2 is not due while 1 has not gone, even if its date has passed', F.nextDue({ ...base }, '2026-10-16') === 1);
const old = { followup1_due_date: '2026-10-11', followup1_sent_at: 'x', followup2_due_date: '2026-10-15', followup2_sent_at: null };
step('a row made before 3–5 existed: 2 is due, then it is the last — exactly as before', F.nextDue(old, '2026-10-15') === 2 && F.isLast(old, 2) && F.isLast(old, 1) === false);

step('the types: fu1…fu5 are follow-ups, "reminder" and "initial" are not', ['fu1', 'fu2', 'fu3', 'fu4', 'fu5'].every(F.isFollowupType) && !F.isFollowupType('reminder') && !F.isFollowupType('initial') && !F.isFollowupType(null) && !F.isFollowupType('fu6'));
step('each replies under the one before it (1 under the first email)', F.prevType('fu1') === null && F.prevType('fu2') === 'fu1' && F.prevType('fu5') === 'fu4' && F.stepNumber('fu3') === 3 && F.typeOf(4) === 'fu4' && F.dueCol(3) === 'followup3_due_date' && F.sentCol(5) === 'followup5_sent_at');

console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
