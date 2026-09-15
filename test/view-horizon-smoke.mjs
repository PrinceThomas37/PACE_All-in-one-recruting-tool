// services/view-horizon.js — the horizon vocabulary (Session 23).
//
// Every function here makes a claim about elapsed time, so every test injects
// its own clock. Never call these with the real one.
import horizon from '../services/view-horizon.js';
const {
  DEFAULT_HORIZON_DAYS, PICKER_CAP, ageInDays, withinHorizon,
  isClosedLeadStage, isClosedAtsStage, partitionForView, describeHidden, pickerMode,
} = horizon;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name); } };

const NOW = new Date('2026-09-10T12:00:00Z').getTime();
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

// ── ageInDays ──────────────────────────────────────────────────────────────
ok('age of today is ~0', Math.abs(ageInDays(daysAgo(0), NOW)) < 0.001);
ok('age of 91 days reads 91', Math.abs(ageInDays(daysAgo(91), NOW) - 91) < 0.001);
ok('accepts a Date object', Math.abs(ageInDays(new Date(NOW - 5 * 86400000), NOW) - 5) < 0.001);
// No date must NOT come back as 0 — that would read as "today".
ok('null date has no age', ageInDays(null, NOW) === null);
ok('empty string has no age', ageInDays('', NOW) === null);
ok('garbage date has no age', ageInDays('not-a-date', NOW) === null);

// ── withinHorizon ─────────────────────────────────────────────────────────
ok('inside the window', withinHorizon(daysAgo(30), 90, NOW) === true);
ok('exactly on the boundary is inside', withinHorizon(daysAgo(90), 90, NOW) === true);
ok('past the boundary is outside', withinHorizon(daysAgo(91), 90, NOW) === false);
// The 91-day lead from the owner's screenshot, against the default.
ok('the 91-day nudge falls outside the default horizon', withinHorizon(daysAgo(91), DEFAULT_HORIZON_DAYS, NOW) === false);
ok('a future date is inside', withinHorizon(new Date(NOW + 86400000).toISOString(), 90, NOW) === true);
// "Show all" is expressed as no horizon, and must be explicit.
ok('0 days means no horizon', withinHorizon(daysAgo(9999), 0, NOW) === true);
ok('undefined days falls back to the default, not to no-horizon', withinHorizon(daysAgo(9999), undefined, NOW) === false);
// A dateless row cannot be asserted to be recent.
ok('a dateless row is outside a real window', withinHorizon(null, 90, NOW) === false);
ok('a dateless row is inside no-horizon', withinHorizon(null, 0, NOW) === true);

// ── closed states ─────────────────────────────────────────────────────────
ok('Converted is a closed lead', isClosedLeadStage('Converted') === true);
ok('Connected is NOT closed', isClosedLeadStage('Connected') === false);
ok('Assigned is NOT closed', isClosedLeadStage('Assigned') === false);
ok('Placement is a closed ATS stage', isClosedAtsStage('Placement') === true);
ok('Not Accepted is a closed ATS stage', isClosedAtsStage('Not Accepted') === true);
ok('Interview Scheduled is NOT closed', isClosedAtsStage('Interview Scheduled') === false);
ok('null stage is not closed', isClosedLeadStage(null) === false);

// ── partitionForView ──────────────────────────────────────────────────────
const rows = [
  { id: 'a', created_at: daysAgo(1),  stage: 'Connected' },
  { id: 'b', created_at: daysAgo(10), stage: 'Connected' },
  { id: 'c', created_at: daysAgo(200),stage: 'Connected' },   // aged out
  { id: 'd', created_at: daysAgo(2),  stage: 'Converted' },   // took its exit
  { id: 'e', created_at: daysAgo(400),stage: 'Converted' },   // both
];
const p = partitionForView(rows, { now: NOW, closedOf: (r) => isClosedLeadStage(r.stage) });
ok('only open + recent are visible', p.visible.map(r => r.id).join(',') === 'a,b');
ok('total is every row', p.counts.total === 5);
ok('showing matches visible', p.counts.showing === 2);
ok('closed counted', p.counts.closed === 2);
ok('aged counted', p.counts.aged === 1);
ok('hidden is closed + aged', p.counts.hidden === 3);
// Closed is checked BEFORE age, so a row is never counted twice.
ok('no row is counted in two buckets', p.counts.showing + p.counts.hidden === p.counts.total);

const pAll = partitionForView(rows, { now: NOW, closedOf: (r) => isClosedLeadStage(r.stage), showAll: true, showClosed: true });
ok('show everything shows everything', pAll.visible.length === 5 && pAll.counts.hidden === 0);

const pClosedOnly = partitionForView(rows, { now: NOW, closedOf: (r) => isClosedLeadStage(r.stage), showClosed: true });
ok('showClosed keeps finished rows but still applies the horizon', pClosedOnly.visible.map(r => r.id).join(',') === 'a,b,d');

ok('empty input is safe', partitionForView([], { now: NOW }).counts.total === 0);
ok('non-array input is safe', partitionForView(null, { now: NOW }).counts.total === 0);

// ── describeHidden ────────────────────────────────────────────────────────
ok('nothing hidden means no bar at all', describeHidden(p.counts && { total: 2, showing: 2, closed: 0, aged: 0, hidden: 0 }) === null);
const sentence = describeHidden(p.counts, 90);
ok("the sentence admits what is missing and why", /2 of 5/.test(sentence) && /1 older than 90 days/.test(sentence) && /2 finished/.test(sentence));
ok('null counts is safe', describeHidden(null) === null);

// ── pickerMode ────────────────────────────────────────────────────────────
ok('a small picker stays chips', pickerMode(19 - 10) === 'chips');
ok('at the cap it is still chips', pickerMode(PICKER_CAP) === 'chips');
ok('one past the cap becomes search', pickerMode(PICKER_CAP + 1) === 'search');
// The owner's screenshot: 19 connected leads is already past the cap.
ok('the 19 chips in the screenshot become a search', pickerMode(19) === 'search');
ok('zero is chips', pickerMode(0) === 'chips');

// ── THE TWO COPIES MUST AGREE ─────────────────────────────────────────────
// The browser cannot require() a CommonJS service, so 00-ui-kit.js carries its
// own copy of these numbers. A constant duplicated without a test is a
// constant that drifts — the same arrangement REWRITE_LIMIT already has, for
// the same reason.
import fs from 'node:fs';
import path from 'node:path';
const KIT = fs.readFileSync(path.resolve(new URL('../public/js/00-ui-kit.js', import.meta.url).pathname), 'utf8');
const kitNum = (name) => {
  const m = KIT.match(new RegExp('var\\s+' + name + '\\s*=\\s*(\\d+)'));
  return m ? Number(m[1]) : null;
};
ok('the UI kit agrees on the horizon', kitNum('HORIZON_DAYS') === DEFAULT_HORIZON_DAYS);
ok('the UI kit agrees on the picker cap', kitNum('PICKER_CAP') === PICKER_CAP);
ok('the UI kit agrees on how many recents a search picker keeps',
  kitNum('PICKER_RECENT') === horizon.PICKER_RECENT);
// And the two implementations must actually behave the same, not just share
// numbers — the boundary cases are where a hand-ported copy goes wrong.
ok('the UI kit exports the same helpers it needs',
  /withinHorizon:withinHorizon/.test(KIT) && /partition:partition/.test(KIT) &&
  /horizonBar:horizonBar/.test(KIT) && /pager:pager/.test(KIT));
ok('the browser copy checks closed BEFORE aged, like the server',
  /closedOf\(r\)\)\{closed\+\+;continue;\}[\s\S]{0,120}withinHorizon/.test(KIT));
ok('the browser copy also treats a dateless row as outside a real window',
  /if\(a===null\) return false;/.test(KIT));

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
