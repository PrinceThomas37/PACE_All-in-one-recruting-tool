// PLACE SUGGESTIONS for the Find Leads "Where the job is" box (owner, 14 Oct: "state and city suggestion should be enabled in the
// location search box for find leads"). public/js/71-places-data.js is loaded in a bare sandbox and asked what it would suggest:
//   * every US state is offered, typed in full or by its two letters; the cities of a state are found by name, by "city st"
//     or "city state", in any word order
//   * what a pick WRITES is the way a person (and a job search) would say it: "Texas", "Austin, Texas", "Hyderabad, India"
//   * a place already added is not offered again; nothing typed → nothing offered; a typo → nothing, never a wrong place
// Usage: node test/places-smoke.mjs
import fs from 'node:fs';
import vm from 'node:vm';
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 220) : '')); };

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../public/js/71-places-data.js', import.meta.url), 'utf8'), sandbox);
const P = sandbox.window.PLACES;
const labels = (q, n, skip) => P.suggest(q, n, skip).map((x) => x.label);

step('the list is loaded and is big enough to be useful (every state, hundreds of cities)', P && typeof P.suggest === 'function' && P.count > 500, P && P.count);
const states = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];
step('every one of the 50 states and DC can be found by typing its name', states.every((s) => labels(s, 20).includes(s)), states.filter((s) => !labels(s, 20).includes(s)).join());
step('typing the first letters of a state offers it first ("tex" → Texas)', labels('tex', 5)[0] === 'Texas', labels('tex', 5).join(' | '));
step('typing the two-letter code offers the state, then its biggest cities ("tx" → Texas, Houston, San Antonio, Dallas, Austin…)', labels('tx', 5).join() === 'Texas,Houston, Texas,San Antonio, Texas,Dallas, Texas,Austin, Texas', labels('tx', 5).join(' | '));
step('a city is offered with its state, written the way a person would ("aus" → Austin, Texas)', labels('aus', 6).includes('Austin, Texas'), labels('aus', 6).join(' | '));
step('"austin tx", "tx austin" and "austin texas" all find Austin, Texas', ['austin tx', 'tx austin', 'austin texas', 'Austin, TX'].every((q) => labels(q, 3)[0] === 'Austin, Texas'), ['austin tx', 'tx austin', 'austin texas'].map((q) => labels(q, 2).join('/')).join(' | '));
step('two cities of the same name in different states are both offered ("portland")', ['Portland, Maine', 'Portland, Oregon'].every((c) => labels('portland', 6).includes(c)));
step('a state before a city when both start the same ("new york" → New York first, then New York City)', labels('new york', 4)[0] === 'New York' && labels('new york', 4).includes('New York City, New York'), labels('new york', 4).join(' | '));
step('India is covered: states and cities, written "…, India" (which is how the job search tells the country)', labels('hyd', 3)[0] === 'Hyderabad, India' && labels('karna', 3)[0] === 'Karnataka, India' && labels('benga', 5).includes('Bengaluru, India') && labels('west beng', 3)[0] === 'West Bengal, India', labels('hyd', 3).join(' | '));
step('"remote" is offered too (jobs that are not in one place)', labels('rem', 3)[0] === 'Remote');
step('"Washington, DC" and the state of Washington are different places and both can be picked', labels('washington', 6).includes('Washington') && labels('washington', 6).includes('Washington, DC') && labels('dc', 3).includes('Washington, DC'), labels('washington', 6).join(' | '));
step('a place already added is not offered again', !labels('tex', 5, ['Texas']).includes('Texas') && labels('aus', 5, ['austin, texas']).indexOf('Austin, Texas') === -1);
step('nothing typed → nothing offered; a typo that matches nothing → nothing (never a wrong place)', P.suggest('', 8).length === 0 && P.suggest('   ', 8).length === 0 && P.suggest('qzxv', 8).length === 0);
step('the list is capped at what was asked for', P.suggest('a', 5).length === 5 && P.suggest('a', 3).length === 3);
step('no suggestion is written twice', (() => { const l = labels('s', 200); return new Set(l).size === l.length; })());

console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
