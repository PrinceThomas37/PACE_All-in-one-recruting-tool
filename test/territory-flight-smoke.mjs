// The island's flight log: every light that moves is a real repository event.
//
// Why this exists: the island used to emit a light along a random arc every
// third of a second. It read as data and was not — the one thing a survey of
// a codebase must never be. The lights now replay real commits and real border
// requests out of `scripts/territory-map.mjs`.
//
// That is only true while the generator and the page agree, and they are two
// files that drift apart silently: the page carries its data INLINE (an
// artifact cannot fetch a local file), so a regenerated _map.json with a stale
// island.html shows old work under a new date and nothing says so. Same shape
// as the capability-register drift check, and here for the same reason.
//
//   node test/territory-flight-smoke.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const map = JSON.parse(read('docs/territories/_map.json'));
const html = read('docs/territories/island.html');

console.log('\n== 1. the page carries the survey it was generated from ==');
const a = html.indexOf('/*MAP_START*/'), b = html.indexOf('/*MAP_END*/');
ok('island.html has the generated map block', a !== -1 && b !== -1 && b > a);
let inline = null;
try { inline = JSON.parse(html.slice(a + '/*MAP_START*/'.length, b)); } catch (e) {}
ok('that block is valid JSON', !!inline);
ok('the page and _map.json are the same survey',
   inline && JSON.stringify(inline) === JSON.stringify(map),
   'run `node scripts/territory-map.mjs` — the page has drifted from the map');

console.log('\n== 2. the events are real, and resolve ==');
const ids = new Set(map.territories.map(t => t.id));
const events = map.events || [];
ok('there are events to fly', events.length > 0, `${events.length} found`);
ok('every event carries a date', events.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)));
ok('events are in chronological order',
   events.every((e, i) => i === 0 || events[i - 1].date <= e.date));

const badTerr = [];
for (const e of events) {
  const named = e.k === 'contract' ? [e.from, e.to] : e.t.map(x => x[0]);
  for (const id of named) if (!ids.has(id)) badTerr.push(`${e.sha || e.id}:${id}`);
}
ok('every territory an event names exists', !badTerr.length, badTerr.join(', '));

const commits = events.filter(e => e.k === 'commit');
ok('a commit reports the lines it moved',
   commits.every(e => e.t.every(([, n]) => Number.isFinite(n) && n >= 0)));
ok('a commit that touched nothing is not recorded',
   commits.every(e => e.files > 0));

console.log('\n== 3. every event that flies has a route to fly ==');
// The page draws the declared edges AND the pairs history actually shows, so
// an event can never be dropped for want of an arc. This is what proves it.
const routes = new Set([
  ...map.edges.map(([x, y]) => [x, y].sort().join('|')),
  ...(map.observed || []).map(([x, y]) => [x, y].sort().join('|')),
]);
const stranded = [];
for (const e of events) {
  if (e.k === 'contract') {
    if (!routes.has([e.from, e.to].sort().join('|'))) stranded.push(e.id);
    continue;
  }
  if (e.t.length < 2) continue;                 // a flare, or documentation
  const home = e.t[0][0];
  for (let i = 1; i < e.t.length; i++)
    if (!routes.has([home, e.t[i][0]].sort().join('|'))) stranded.push(`${e.sha}→${e.t[i][0]}`);
}
ok('no event is stranded without a route', !stranded.length, stranded.join(', '));
ok('the observed routes are genuinely undeclared',
   (map.observed || []).every(([x, y]) =>
     !map.edges.some(([p, q]) => [p, q].sort().join('|') === [x, y].sort().join('|'))));

console.log('\n== 4. no decorative motion has crept back ==');
// A light picked at random is the bug this whole file exists to prevent, so
// the page may not choose an arc by chance anywhere.
const emitsAtRandom = /emit\([^)]*Math\.random\(\)\s*\*\s*\w*(arcs|live)/.test(html) ||
  /live\[\(Math\.random\(\)\s*\*\s*live\.length\)/.test(html);
ok('the island never picks an arc at random', !emitsAtRandom);
ok('the log drives the lights', html.includes('flyEvent') && html.includes('MAP.events'));
ok('a caught light holds still', html.includes('heldPulse') && html.includes('const pdt ='));
ok('the log runs without WebGL too',
   html.indexOf('function startFlight') < html.indexOf('function buildIsland'),
   'the clock must not live inside the island');

console.log(`\nSUMMARY: ${passed}/${passed + failed} passed`);
if (failed) console.log('RESULT: FAIL'); else console.log('RESULT: PASS');
process.exit(failed ? 1 : 0);
