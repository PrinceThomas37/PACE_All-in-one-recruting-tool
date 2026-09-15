// Dismissing a "Needs you today" item (Session 23).
//
// The fault: only reminder_due had a Done button, so reply_due, commitment_due,
// nudge and stage_suggested could not be dismissed AT ALL. A lead last
// contacted 91 days ago sat under a heading reading "today", permanently.
//
// The fix must not become the OPPOSITE fault — a queue you can empty with a
// click tells you nothing. So the two properties pinned hardest here are:
//   * a snooze EXPIRES;
//   * a snooze is VOID as soon as the thread changes, however long it had left.
import d from '../services/next-action-dismissals.js';
import { buildNextActions, NUDGE_MAX_AGE_DAYS } from '../next-action.js';
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };

const NOW = new Date('2026-09-10T12:00:00Z').getTime();
const DAY = 86400000;

const item = {
  kind: 'reply_due', entity_type: 'contact', entity_id: 'c1',
  last_activity_at: '2026-09-09T10:00:00Z', overdue_days: 1, state: 'awaiting_us',
};

// ── keys ──────────────────────────────────────────────────────────────────
ok('a key is stable for the same action on the same record',
  d.itemKey(item) === d.itemKey({ ...item, title: 'renamed' }));
ok('a different kind is a different key',
  d.itemKey(item) !== d.itemKey({ ...item, kind: 'nudge' }));
ok('a different record is a different key',
  d.itemKey(item) !== d.itemKey({ ...item, entity_id: 'c2' }));
ok('a reminder keys off the reminder id',
  d.itemKey({ reminder_id: 'r9' }) === 'reminder:r9');
ok('no item, no key', d.itemKey(null) === null);

// ── snooze expires ────────────────────────────────────────────────────────
let store = d.recordDismissal({}, item, 'today', NOW);
ok('snoozed now', d.isDismissed(store, item, NOW) === true);
ok('still snoozed a few hours later', d.isDismissed(store, item, NOW + 6 * 3600e3) === true);
ok('BACK tomorrow — a snooze expires', d.isDismissed(store, item, NOW + 2 * DAY) === false);

store = d.recordDismissal({}, item, 'week', NOW);
ok('a week snooze holds at 6 days', d.isDismissed(store, item, NOW + 6 * DAY) === true);
ok('a week snooze is over at 8 days', d.isDismissed(store, item, NOW + 8 * DAY) === false);

store = d.recordDismissal({}, item, 'drop', NOW);
ok('a drop holds for months', d.isDismissed(store, item, NOW + 120 * DAY) === true);
// Deliberately not forever — forever is how a queue silently stops being true.
ok('even a drop expires eventually', d.isDismissed(store, item, NOW + 200 * DAY) === false);

// ── the fingerprint: a new message voids the snooze ───────────────────────
store = d.recordDismissal({}, item, 'drop', NOW);
const replied = { ...item, last_activity_at: '2026-09-10T11:00:00Z' };
ok('a NEW message on the thread voids even a drop',
  d.isDismissed(store, replied, NOW + DAY) === false);
const sameThreadOlderCount = { ...item, overdue_days: 5 };
ok('the silence growing also voids it',
  d.isDismissed(store, sameThreadOlderCount, NOW + DAY) === false);
ok('an unchanged thread stays snoozed',
  d.isDismissed(store, { ...item }, NOW + DAY) === true);

// ── prune keeps the stored object proportional ────────────────────────────
const messy = {
  live:    { until: new Date(NOW + 5 * DAY).toISOString(), fp: 'x' },
  expired: { until: new Date(NOW - 5 * DAY).toISOString(), fp: 'x' },
  broken:  { until: 'not-a-date', fp: 'x' },
  nulled:  null,
  noUntil: { fp: 'x' },
};
const pruned = d.prune(messy, NOW);
ok('prune keeps only live entries', Object.keys(pruned).join(',') === 'live');
ok('prune is safe on junk', Object.keys(d.prune(null, NOW)).length === 0);
// The store must not become the very thing this module cures.
const grown = d.recordDismissal(messy, item, 'today', NOW);
ok('recording also prunes, so the row cannot grow without bound',
  Object.keys(grown).sort().join(',') === [d.itemKey(item), 'live'].sort().join(','));

// ── applyDismissals reports what it held back ────────────────────────────
const items = [item, { ...item, entity_id: 'c2' }, { ...item, entity_id: 'c3' }];
const s2 = d.recordDismissal({}, items[1], 'today', NOW);
const applied = d.applyDismissals(items, s2, NOW);
ok('the snoozed item is gone', applied.items.length === 2);
ok('and it is COUNTED, not silently dropped', applied.snoozed === 1);
ok('no store means nothing hidden', d.applyDismissals(items, {}, NOW).snoozed === 0);
ok('applyDismissals is safe on junk', d.applyDismissals(null, {}, NOW).items.length === 0);

// ── the 91-day nudge from the owner's screenshot ──────────────────────────
const thread = (daysSilent) => ({
  entity_type: 'contact', entity_id: 'z1', name: 'Michael Saracena',
  company: 'Phoenix Tailings', stage: 'Connected',
  messages: [{ direction: 'outbound', sent_at: new Date(NOW - daysSilent * DAY).toISOString(), body: 'Following up' }],
});
const fresh = buildNextActions({ threads: [thread(10)], now: NOW });
const stale = buildNextActions({ threads: [thread(91)], now: NOW });
ok('a 10-day silence still needs you today', fresh.some(i => i.kind === 'nudge'));
ok('the 91-day silence is NOT on today\'s list', !stale.some(i => i.kind === 'nudge'));
ok('but it is counted, so it can be decided once', stale.stale_nudges === 1);
ok('the age limit is a real number', NUDGE_MAX_AGE_DAYS > 0 && NUDGE_MAX_AGE_DAYS < 91);
// Someone waiting on US never ages out — that debt does not expire.
const owed = {
  entity_type: 'contact', entity_id: 'z2', name: 'Frank', stage: 'Connected',
  messages: [
    { direction: 'outbound', sent_at: new Date(NOW - 200 * DAY).toISOString(), body: 'Hello' },
    { direction: 'inbound',  sent_at: new Date(NOW - 190 * DAY).toISOString(), body: 'Yes please send resumes' },
  ],
};
const owedItems = buildNextActions({ threads: [owed], now: NOW });
ok('a reply we owe is never aged out, however old',
  owedItems.some(i => i.kind === 'reply_due'));
// Turning the gate off must be possible and explicit.
ok('a 0 age limit disables the gate',
  buildNextActions({ threads: [thread(91)], now: NOW, nudgeMaxAgeDays: 0 }).some(i => i.kind === 'nudge'));

// ── every item carries what a snooze fingerprints against ────────────────
ok('items carry last_activity_at', fresh.every(i => 'last_activity_at' in i));
ok('and it is the real message time',
  fresh[0].last_activity_at === new Date(NOW - 10 * DAY).toISOString());

// ── the UI must actually offer the exits ─────────────────────────────────
const NA = fs.readFileSync(path.resolve(new URL('../public/js/44-next-actions.js', import.meta.url).pathname), 'utf8');
ok('every non-reminder row offers a snooze', /naSnooze\(this,\\?'today\\?'/.test(NA));
ok('a week and a drop are offered too', /naSnooze\(this,\\?'week\\?'/.test(NA) && /naSnooze\(this,\\?'drop\\?'/.test(NA));
ok('the reminder keeps its real Done', /naDone\(/.test(NA));
ok('the row carries the item so the snooze can fingerprint it', /data-na-item="/.test(NA));
ok('the card says what it is hiding', /naHiddenLine/.test(NA) && /gone quiet over/.test(NA));
// A failed dismissal must put the row back rather than eat it.
ok('a failed snooze restores the row', /row\.style\.display='';/.test(NA));

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
