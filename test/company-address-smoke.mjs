// A new company made from "Add lead" carries its POSTAL address in the columns
// migration 043 already added (street, suite, city, state, ZIP, country) — the
// same ones the New Job form writes — and `location` (the short "City, ST" the
// rest of the app reads) is derived when the caller did not give one. A part
// can be cleared with an empty string; unknown fields are never written. (D-0077)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const captured = { insert: null, update: null };
function q(table) {
  const api = {
    insert(row) { captured.insert = { table, row }; return api; },
    update(row) { captured.update = { table, row }; return api; },
    select() { return api; }, eq() { return api; }, is() { return api; }, ilike() { return api; }, in() { return api; },
    maybeSingle() { return Promise.resolve({ data: { id: 'co-1', org_id: 'o1', name: 'Acme', created_by: 'u-adm' }, error: null }); },
    single() { return Promise.resolve({ data: Object.assign({ id: 'co-new' }, captured.insert && captured.insert.row), error: null }); },
    then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
  };
  return api;
}
const router = require('../routes/companies.js')({
  supabase: { from: q }, auth: (_a, _b, n) => n(), hasRole: (req, ...r) => r.some(x => (req.user.roles || []).includes(x)),
  withOrg: (query) => query, orgStamp: () => ({ org_id: 'o1' }), orgIdFor: () => 'o1',
});
const handler = (method, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]).route.stack.slice(-1)[0].handle;
const run = async (method, path, body, params = {}) => { let out, code = 200; const res = { status(c) { code = c; return res; }, json(j) { out = j; return res; } }; await handler(method, path)({ user: { id: 'u-adm', roles: ['admin'] }, orgId: 'o1', body, params }, res); return { code, out }; };

let r = await run('post', '/companies', { name: 'Globex', website: 'globex.com', industry: 'Construction', address_line1: '12 Main St', address_line2: 'Suite 4', city: 'Austin', state: 'TX', postal_code: '78701', country: 'United States', hacker: 'x', address: 'nope' });
const row = captured.insert.row;
step('a new company is saved with its structured postal address', row.address_line1 === '12 Main St' && row.address_line2 === 'Suite 4' && row.city === 'Austin' && row.state === 'TX' && row.postal_code === '78701' && row.country === 'United States', JSON.stringify(row));
step('…and the short "City, ST" location is derived (the form the rest of the app reads)', row.location === 'Austin, TX');
step('…nothing outside the known columns is written (no stray "address", no "hacker")', !('hacker' in row) && !('address' in row));
step('…it is stamped with the organisation and the creator', row.org_id === 'o1' && row.created_by === 'u-adm');

await run('post', '/companies', { name: 'Initech', location: 'Dallas, TX', city: 'Plano', state: 'TX' });
step('a location the caller gave is kept, never overwritten by the derived one', captured.insert.row.location === 'Dallas, TX');
await run('post', '/companies', { name: 'Bare Co' });
step('a company with no address at all still saves (every part is optional)', captured.insert.row.name === 'Bare Co' && !('address_line1' in captured.insert.row) && !('city' in captured.insert.row), JSON.stringify(captured.insert.row));
step('a company with no name is refused', (await run('post', '/companies', {})).code === 400);

await run('put', '/companies/:id', { city: 'Houston', postal_code: '', address_line2: '  ' }, { id: 'co-1' });
const up = captured.update.row;
step('an edit changes the parts sent and CLEARS a part sent empty', up.city === 'Houston' && up.postal_code === null && up.address_line2 === null, JSON.stringify(up));
step('…and leaves untouched the parts it did not mention', !('address_line1' in up) && !('state' in up) && !('country' in up));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
