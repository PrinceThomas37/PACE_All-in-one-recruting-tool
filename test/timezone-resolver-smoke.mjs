// Pins getTimezoneFromLocation() in index.js against real, messy lead
// `location` strings measured against the live database (see contract
// C-0014, gateway -> deep, 2026-09-09).
//
// WHY THIS TEST EXTRACTS SOURCE INSTEAD OF INVENTING A COPY: index.js boots a
// real HTTP server as a side effect of being required (see
// test/backend-smoke.mjs and test/candidate-outreach-drip-smoke.mjs, which
// both avoid requiring it directly for the same reason), so a pure function
// living inline in that file cannot be imported like a module export without
// either standing up a live Supabase-backed server or duplicating the logic
// by hand in the test — and a hand-copied duplicate would drift from the real
// function silently, which is exactly the class of bug this suite exists to
// catch. Instead this test reads the EXACT source text of the function (and
// the three tables it closes over) out of index.js between two literal
// anchors and evaluates that text as a small CommonJS module. If gateway
// renames or restructures any of the anchors, this test fails loudly (it
// cannot find the markers) rather than silently testing stale logic.
//
// WHY A PREVIOUS TEST DID NOT CATCH THE BUG THIS TEST IS BUILT TO CATCH:
// `test/lead-location-parse-smoke.mjs` has "location parse" in its name and
// exercises 14 assertions that passed both before and after the timezone fix
// — but it does not call getTimezoneFromLocation at all. It drives the
// frontend's `bdOpenNewJob()` prefill, a browser-side city/state splitter
// used only when converting a Connected lead into a Job Order. Same-sounding
// name, unrelated function, unrelated file (public/js), unrelated bug class.
// A 26.2%-of-live-rows defect in the backend resolver had no test anywhere
// near it. Lesson applied here: name this file for the function it tests, and
// assert on strings taken from the live database, not invented ones.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

const START = 'const US_TZ_MAP = {';
const END_MARK = '\nlet sendWindowCache';
const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END_MARK);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error('[FAIL] could not locate getTimezoneFromLocation source block in index.js — anchors moved, update this test');
  process.exit(1);
}
const block = src.slice(startIdx, endIdx);
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', block + '\nmodule.exports = { getTimezoneFromLocation, LEAD_TZ_IANA, US_TZ_MAP };')(mod, mod.exports);
const { getTimezoneFromLocation, LEAD_TZ_IANA, US_TZ_MAP } = mod.exports;

const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

// ── Real, messy strings that were WRONG before the fix and must be right now ──
const fixedCases = [
  ['Denver, CO', 'MST'],
  ['Arizona, Arizona', 'MST'],
  ['Moreno Valley, CA', 'PST'],
  ['Los Angeles, California', 'PST'],
  ['Sacramento, CA', 'PST'],
  ['El Segundo, CA', 'PST'],
  ['Chandler, AZ', 'MST'],
  ['Austin, TX', 'CST'],
  ['Milwaukee, WI', 'CST'],
  ['Eugene, OR', 'PST'],
  ['Ogden, UT', 'MST'],
  ['Omaha, NE', 'CST'],
  ['Raleigh-Durham-Chapel Hill Area', 'EST'],
];
for (const [loc, expected] of fixedCases) {
  const got = getTimezoneFromLocation(loc);
  step(`"${loc}" -> ${expected}`, got === expected, `got ${got}`);
}

// ── Strings that already resolved correctly and must not regress ──────────────
const regressionCases = [
  ['Fort Worth, TX ·', 'CST'],
  ['Houston, TX', 'CST'],
  ['New Haven, Ct', 'EST'],
  ['Broomall, PA', 'EST'],
  ['United States', 'EST'],
  ['NORWOOD, NORFOLK', 'EST'],
];
for (const [loc, expected] of regressionCases) {
  const got = getTimezoneFromLocation(loc);
  step(`no regression: "${loc}" -> ${expected}`, got === expected, `got ${got}`);
}

// Edge inputs that must never throw.
for (const loc of [null, undefined, '', '   ', ',', 'xx']) {
  let got, threw = false;
  try { got = getTimezoneFromLocation(loc); } catch (e) { threw = true; }
  step(`does not throw on ${JSON.stringify(loc)}`, !threw, threw ? 'threw' : `got ${got}`);
}

// ── The class of bug, not just the instances: no bare substring match ─────────
// The defect was that ANY 2-letter state code could match as a substring
// anywhere in the lowercased text, first-match-in-object-order wins. Build,
// for every code in US_TZ_MAP, a location whose text contains that code
// embedded inside an unrelated word (never as a real state abbreviation or
// state name) with a DIFFERENT real trailing state code, and assert the
// resolver follows the real trailing code, not the embedded substring.
const EMBED_WORDS = {
  ny: 'Tammany', nj: 'Ninja', fl: 'Waffle', ma: 'Panorama', pa: 'Panorama',
  ga: 'Yoga', nc: 'Quincy', sc: 'Descend', va: 'Videographer', ct: 'Doctor',
  me: 'Homeless', nh: 'Anhui', vt: 'Advtech', ri: 'Marina', de: 'Videographer',
  md: 'Almond', dc: 'Endcap', oh: 'Choose', mi: 'Admirer', in: 'Skiing',
  ky: 'Rocky', wv: 'Wvcorp', tn: 'Autonomy', tx: 'Context', il: 'Emails',
  mn: 'Alumni', wi: 'Kiwi', mo: 'Almost', ia: 'Marketing', ks: 'Kayaks',
  ne: 'Skyline', sd: 'Wisdom', nd: 'Errand', ok: 'Broken', la: 'Gala',
  ar: 'Guitar', ms: 'Chrome', al: 'Portal', co: 'Falcon', az: 'Amazon',
  nm: 'Denmark', ut: 'Beautiful', wy: 'Anyway', mt: 'Summit', id: 'Rapid',
  ca: 'Vacation', wa: 'Award', or: 'Editor', nv: 'Convince', ak: 'Cupcake',
  hi: 'Chip',
};
let substringFails = [];
for (const code of Object.keys(US_TZ_MAP)) {
  const embedWord = EMBED_WORDS[code];
  if (!embedWord) continue;
  const trailingCode = code === 'tx' ? 'ca' : 'tx'; // always different from `code`
  const loc = `${embedWord} Ave, ${trailingCode.toUpperCase()}`;
  const got = getTimezoneFromLocation(loc);
  const expected = US_TZ_MAP[trailingCode];
  if (got !== expected) substringFails.push(`"${loc}" -> ${got}, expected ${expected} (embedded code was "${code}")`);
}
step('no state code matches as a bare substring inside an unrelated word (all US_TZ_MAP codes checked)',
  substringFails.length === 0, substringFails.join('; '));

// Same class, no comma at all: an unrelated word embedding a code must not
// resolve to that code's zone when there is no real state signal present.
let noCommaFails = [];
for (const code of Object.keys(US_TZ_MAP)) {
  const embedWord = EMBED_WORDS[code];
  if (!embedWord) continue;
  const loc = `${embedWord} Remote Position`;
  const got = getTimezoneFromLocation(loc);
  if (got === US_TZ_MAP[code] && got !== 'EST') noCommaFails.push(`"${loc}" resolved to ${got} via embedded "${code}"`);
}
step('an embedded code with no trailing state signal falls through to the default, never the embedded code',
  noCommaFails.length === 0, noCommaFails.join('; '));

// ── Downstream contract: every value the resolver can emit must have an
// LEAD_TZ_IANA entry (both send-window checks key off that map; an unmapped
// value silently falls back to America/New_York, which is a real defect). ──
const possibleOutputs = new Set(Object.values(US_TZ_MAP));
possibleOutputs.add('EST'); // the unresolved default
const unmapped = [...possibleOutputs].filter((tz) => !LEAD_TZ_IANA[tz]);
step('every value getTimezoneFromLocation can emit has a LEAD_TZ_IANA entry',
  unmapped.length === 0, `unmapped: ${unmapped.join(', ')}`);

const fails = results.filter((r) => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
