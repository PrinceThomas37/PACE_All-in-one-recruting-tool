// AI ON / OFF PER PERSON (D-0195, owner 2 Nov 2026): "the admin switch[es] the AI enabler for each user". Pins the SERVER
// rule, not the hidden buttons: with the switch off, complete() makes NO provider request for that person (from inside their
// request, without the caller passing anything), availability() says user_off, other people are untouched, engine work (no
// person) is untouched, unknown = on, and the admin's routes are admin-only and same-company only.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const access = require('../services/ai-access.js');
const provider = require('../services/ai-provider.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

function fakeDb(settings) {
  const reads = [], writes = [];
  const api = { reads, writes, from: (t) => {
    let k = null;
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; }, like() { return q; }, in(_c, list) { k = list; return q; },
      eq(col, v) { if (col === 'key') k = v; return q; },
      maybeSingle: async () => { reads.push(k); return { data: t === 'app_settings' && settings[k] != null ? { value: settings[k] } : null }; },
      single: async () => ({ data: null }),
      then(res) { const list = Array.isArray(k) ? k.filter((x) => settings[x] != null).map((x) => ({ key: x, value: settings[x] })) : []; return Promise.resolve({ data: list, error: null }).then(res); },
      insert: async (row) => { writes.push({ t, row }); return { error: null }; },
      upsert: async (row) => { writes.push({ t, row }); if (t === 'app_settings') settings[row.key] = row.value; return { error: null }; },
      delete() { return q; },
    };
    return q;
  } };
  return api;
}

// 1. the stored switch
access._clear();
const db1 = fakeDb({ 'u_off_ai_access': 'off', 'u_on_ai_access': 'on' });
step('No setting = AI on (the owner\'s default for everyone)', await access.isOn(db1, 'nobody') === true);
step('"off" = AI off for that person', await access.isOn(db1, 'off') === false);
step('Another person is untouched', await access.isOn(db1, 'on') === true);
step('Work with no person behind it (engine timers) is never blocked', await access.allowed(db1, null) === true);
access._clear();
const broken = { from: () => { throw new Error('db down'); } };
step('A setting that cannot be read never takes AI away', await access.isOn(broken, 'x') === true);

// 2. the request context reaches the AI door through awaits
let seen = null;
await access.runAs('off', async () => { await new Promise((r) => setTimeout(r, 5)); seen = access.currentUserId(); });
step('The person whose request this is survives an await', seen === 'off');
step('Outside a request there is no person', access.currentUserId() === null);

// 3. complete(): no provider request for a person whose AI is off — without the caller saying who
access._clear();
let fetched = 0;
const realFetch = global.fetch;
global.fetch = async () => { fetched++; throw new Error('should not be called'); };
const db2 = fakeDb({ 'u_off_ai_access': 'off' });
const out = await access.runAs('off', () => provider.complete(db2, { feature: 'sequence_draft', orgId: 'o1', prompt: 'hi' }));
step('AI off: complete() answers null (the rules write it)…', out === null);
step('…makes no AI request…', fetched === 0);
step('…and records no AI call (none was made)', !db2.writes.some((w) => w.t === 'ai_calls'), JSON.stringify(db2.writes));
const av = await access.runAs('off', () => provider.availability(db2, { feature: 'sequence_draft', orgId: 'o1' }));
step('AI off: availability() says why (user_off)', av.available === false && av.reason === 'user_off', JSON.stringify(av));
const avOther = await access.runAs('someone-else', () => provider.availability(db2, { feature: 'x', orgId: 'o1' }));
step('Someone else in the same company is not told "user_off"', avOther.reason !== 'user_off', JSON.stringify(avOther));
global.fetch = realFetch;

// 4. set() and forUsers()
access._clear();
const db3 = fakeDb({});
await access.set(db3, 'u9', false);
step('The admin\'s switch is stored per person', db3.writes.some((w) => w.row.key === 'u_u9_ai_access' && w.row.value === 'off'));
step('…and takes effect at once (no waiting for the cache)', await access.isOn(db3, 'u9') === false);
const map = await access.forUsers(fakeDb({ 'u_a_ai_access': 'off' }), ['a', 'b']);
step('The admin\'s list: off where off, on everywhere else', map.a === false && map.b === true, JSON.stringify(map));

// 5. the wiring that makes it a rule: auth runs every request as its person; the routes are admin-only and same-company
const idx = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
step('auth runs the rest of every request as its person (the switch cannot be skipped by a route)', /aiAccess\.runAs\(claims\.id, next\)/.test(idx));
const authSrc = fs.readFileSync(new URL('../routes/auth.js', import.meta.url), 'utf8');
const put = authSrc.slice(authSrc.indexOf("router.put('/users/:id/ai-access'"), authSrc.indexOf("router.get('/users/email-limit-changes'"));
step('Changing someone\'s AI is admin-only and same-company only', /hasRole\(req, 'admin'\)/.test(put) && /guardUser\(req, res, req\.params\.id\)/.test(put));
step('The literal /users/ai-access is registered above every /users/:id route', authSrc.indexOf("router.get('/users/ai-access'") < authSrc.indexOf("router.put('/users/:id'"));

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
