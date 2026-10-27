// CONTACT DATA FROM ANY PROVIDER (R-321, D-0175, D-0180) — services/contact-data.js and the organisation's choice, over an in-memory database.
//   * the CONTRACT: every provider answers the same six verbs; a provider that cannot keep it is refused when it is REGISTERED (start-up), not
//     met by a customer; a verb a provider does not offer is never undefined — it answers "not offered" in words;
//   * Apollo is the first adapter and is the existing file unchanged (nothing to translate on the way in);
//   * EACH ORGANISATION picks its own provider and holds its own key — one company's choice and key are never another's, a stale choice
//     (a provider that is gone) falls back, nothing chosen = the first provider that has a key;
//   * PACE's own search words are translated by the PROVIDER (criteria), and a caller that hands in a vendor's own `filters` still passes
//     straight through (so the older tests are untouched);
//   * the Integrations routes: only a contact-data provider can be made "the one", the choice is the admin's own organisation's, it is
//     read back, and a card's Test goes through that provider's adapter.
// A guard that cannot fail is not a guard: the mutations at the end are checked by hand-running the same file against broken copies.
// Usage: node test/contact-data-smoke.mjs
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const cdata = require(path.join(ROOT, 'services/contact-data.js'));
const integ = require(path.join(ROOT, 'config/integrations.js'));

// ── 1. the contract ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const apollo = cdata.adapterFor('apollo');
step('Apollo is registered, with all six verbs as real functions', cdata.has('apollo') && cdata.VERBS.length === 6 && cdata.VERBS.every((v) => typeof apollo[v] === 'function'), cdata.VERBS.join());
step('…and its adapter IS services/people-apollo.js (the credit rules and their tests did not move)', apollo.searchPeople === require(path.join(ROOT, 'services/people-apollo.js')).searchPeople);
const listed = cdata.list().find((p) => p.id === 'apollo');
step('the picker\'s list says what each verb costs: people search free, a lookup one credit', listed && listed.capabilities.searchPeople.credits === 0 && listed.capabilities.revealPerson.credits === 1 && listed.capabilities.searchOrganizations.offered === true && listed.label === 'Apollo.io' && listed.name === 'Apollo');
let threw = '';
try { cdata.register({ id: 'bad1', label: 'Bad', adapter: {}, capabilities: { revealPerson: { offered: true, credits: 1 } } }); } catch (e) { threw = e.message; }
step('a provider that SAYS it offers a verb but has no such function is refused at registration', /offers revealPerson but has no such function/.test(threw) && !cdata.has('bad1'), threw);
threw = '';
try { cdata.register({ id: 'bad2', label: 'Bad', adapter: { searchOrganizations: async () => ({ ok: true }) }, capabilities: { searchOrganizations: { offered: true, credits: 1 } } }); } catch (e) { threw = e.message; }
step('a provider that searches companies but cannot translate PACE\'s search into its own query is refused too', /no criteria\.translate/.test(threw) && !cdata.has('bad2'), threw);
threw = '';
try { cdata.register({ label: 'x', adapter: {} }); } catch (e) { threw = e.message; }
step('no id / no label / no adapter is refused', /needs an id, a label and an adapter/.test(threw));

const searched = [];
cdata.register({
  id: 'zeta', label: 'Zeta Data', name: 'Zeta',
  adapter: { async searchPeople(a) { return { ok: true, status: 200, people: [], total: 0, key: a.key }; }, async searchOrganizations(a) { searched.push(a); return { ok: true, status: 200, organizations: [] }; } },
  capabilities: { searchPeople: { offered: true, credits: 0 }, searchOrganizations: { offered: true, credits: 2 } },
  criteria: { translate(c, now) { return { kind: c.kind, t: c.search && c.search.titles, d: c.domains, n: c.name, now: !!now }; } },
});
integ.INTEGRATIONS.push({ id: 'zeta', category: 'Contact database', label: 'Zeta Data', description: 'x', contact: true, fields: [{ key: 'api_key', label: 'API key' }], test: null });
integ.BY_ID.set('zeta', integ.INTEGRATIONS[integ.INTEGRATIONS.length - 1]);

const zeta = cdata.adapterFor('zeta');
const missing = await Promise.all(['revealPerson', 'enrichOrganization', 'organizationJobPostings', 'checkPeopleSearch'].map((v) => zeta[v]({ key: 'k', id: 'x', domain: 'x.com', orgId: 'a'.repeat(24) })));
step('EVERY verb exists on every registered provider — one it does not offer answers { ok:false } in words naming it', cdata.list().every((p) => cdata.VERBS.every((v) => typeof cdata.adapterFor(p.id)[v] === 'function')) && missing.every((r) => r.ok === false && r.status === 0 && /^Zeta does not offer that \(/.test(r.error)), JSON.stringify(missing[0]));
step('…and a verb it DOES offer is its own function, untouched', (await zeta.searchPeople({ key: 'kk' })).key === 'kk');
step('adapterFor an unknown provider is null (never a half-made adapter)', cdata.adapterFor('nope') === null);

// ── 2. each organisation's own choice and key ──────────────────────────────────────────────────────────────────────────────────────
const fake = createFakeDb({ tables: {
  organizations: [{ id: 'oA', created_at: '2026-01-01' }, { id: 'oB', created_at: '2026-02-01' }, { id: 'oC', created_at: '2026-03-01' }, { id: 'oD', created_at: '2026-04-01' }],
  app_settings: [
    { key: 'int_contact_active__org_oA', value: 'zeta' }, { key: 'int_zeta_api_key__org_oA', value: 'zeta-key-A' }, { key: 'int_apollo_api_key__org_oA', value: 'apollo-key-A' },
    { key: 'int_apollo_api_key__org_oB', value: 'apollo-key-B' },
    { key: 'int_contact_active__org_oC', value: 'gone-provider' }, { key: 'int_apollo_api_key__org_oC', value: 'apollo-key-C' },
  ],
} });
const supabase = fake.supabase;
integ._resetForTests({ id: 'oA', multi: true });
const a = await cdata.resolve(supabase, 'oA'), b = await cdata.resolve(supabase, 'oB'), c = await cdata.resolve(supabase, 'oC'), d = await cdata.resolve(supabase, 'oD');
step('an organisation that CHOSE Zeta gets Zeta, with ITS Zeta key (not its Apollo key)', a.id === 'zeta' && a.key === 'zeta-key-A' && a.configured === true && a.name === 'Zeta' && a.label === 'Zeta Data', JSON.stringify([a.id, a.key]));
step('an organisation that chose nothing and has only an Apollo key gets Apollo, with its own key — never A\'s', b.id === 'apollo' && b.key === 'apollo-key-B' && b.name === 'Apollo');
step('a choice that no longer exists (a provider taken away) falls back instead of breaking the organisation', c.id === 'apollo' && c.key === 'apollo-key-C', c.id);
step('an organisation with no key at all is told "not connected" but still gets a provider to name (the first)', d.id === 'apollo' && d.key === null && d.configured === false);
step('one company\'s key never reaches another: B asks for Zeta and gets nothing', (await integ.getSecret(supabase, 'zeta', 'api_key', 'oB')) === null && (await integ.getSecret(supabase, 'apollo', 'api_key', 'oA')) === 'apollo-key-A');
const st = await cdata.statusFor(supabase, 'oA');
step('statusFor (what the screens are told): provider, name, connected, and every verb\'s capability', st.provider === 'zeta' && st.name === 'Zeta' && st.connected === true && st.capabilities.searchOrganizations.credits === 2 && st.capabilities.revealPerson.offered === false);
const stD = await cdata.statusFor(supabase, 'oD');
step('…and connected:false for an organisation with no key', stD.connected === false && stD.provider === 'apollo');

// ── 3. PACE's words → the provider's query ─────────────────────────────────────────────────────────────────────────────────────────
await a.adapter.searchOrganizations({ key: 'k', criteria: { kind: 'search', search: { titles: ['Welder'] } }, now: new Date(), page: 2, perPage: 50 });
await a.adapter.searchOrganizations({ key: 'k', criteria: { kind: 'domains', domains: ['x.com'] } });
await a.adapter.searchOrganizations({ key: 'k', criteria: { kind: 'name', name: 'Acme' } });
step('a search is translated by the PROVIDER (search / list of websites / a name), with the clock, and the paging passes through', JSON.stringify(searched[0].filters) === '{"kind":"search","t":["Welder"],"now":true}' && searched[0].page === 2 && searched[0].perPage === 50 && JSON.stringify(searched[1].filters) === '{"kind":"domains","d":["x.com"],"now":false}' && JSON.stringify(searched[2].filters) === '{"kind":"name","n":"Acme","now":false}', JSON.stringify(searched.map((x) => x.filters)));
step('…and neither `criteria` nor `now` is handed on to the vendor call', searched.every((x) => !('criteria' in x) && !('now' in x)));
await a.adapter.searchOrganizations({ key: 'k', filters: { vendor: 'own' } });
step('a caller that already holds the vendor\'s own `filters` passes straight through, untranslated (the older code and tests)', JSON.stringify(searched[3].filters) === '{"vendor":"own"}');
const apolloDirect = await cdata.resolve(supabase, 'oB', { searchOrganizations: async (x) => x });
const viaApollo = await apolloDirect.adapter.searchOrganizations({ key: 'k', criteria: { kind: 'domains', domains: ['a.com', 'b.com'] } });
step('Apollo\'s own translation: a list of websites → its q_organization_domains_list; a name → q_organization_name; a saved search → its job filters', JSON.stringify(viaApollo.filters) === '{"q_organization_domains_list":["a.com","b.com"]}'
  && JSON.stringify((await apolloDirect.adapter.searchOrganizations({ key: 'k', criteria: { kind: 'name', name: '  Acme  ' } })).filters) === '{"q_organization_name":"Acme"}'
  && (await apolloDirect.adapter.searchOrganizations({ key: 'k', now: new Date('2026-10-27T00:00:00Z'), criteria: { kind: 'search', search: { titles: ['Welder'], locations: ['Texas'], posted_days: 7 } } })).filters.q_organization_job_titles.join() === 'Welder', JSON.stringify(viaApollo));
step('a test\'s ready-made adapter (ctx.apollo) is used as-is under the chosen provider\'s id', apolloDirect.id === 'apollo');

// ── 4. the Integrations routes ─────────────────────────────────────────────────────────────────────────────────────────────────────
const USERS = { admA: { id: 'admA', org_id: 'oA', role: 'admin', roles: ['admin'] }, admB: { id: 'admB', org_id: 'oB', role: 'admin', roles: ['admin'] }, bdA: { id: 'bdA', org_id: 'oA', role: 'bd', roles: ['bd'] } };
const app = express(); app.use(express.json());
const auth = (req, res, next) => { const u = USERS[req.headers['x-user']]; if (!u) return res.status(401).end(); req.user = u; req.orgId = u.org_id; next(); };
const hasRole = (req, ...r) => (req.user.roles || []).some((x) => r.includes(x));
app.use(require(path.join(ROOT, 'routes/integrations.js'))({ supabase, auth, hasRole }));
const server = http.createServer(app);
const PORT = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const call = async (method, p, user, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers: { 'content-type': 'application/json', 'x-user': user }, body: body ? JSON.stringify(body) : undefined }); let json = null; try { json = await r.json(); } catch (_) {} return { status: r.status, body: json }; };
const row = (k) => (fake.T('app_settings').find((x) => x.key === k) || {}).value;
let g = await call('GET', '/admin/integrations', 'admA');
const zetaItem = g.body.categories.flatMap((x) => x.items).find((i) => i.id === 'zeta'), apolloItem = g.body.categories.flatMap((x) => x.items).find((i) => i.id === 'apollo');
step('the list marks which cards are contact databases, and which one this organisation uses', g.status === 200 && zetaItem.contact === true && apolloItem.contact === true && g.body.active_contact === 'zeta' && zetaItem.active_contact === true && apolloItem.active_contact === false, JSON.stringify([g.body.active_contact, zetaItem.active_contact]));
g = await call('GET', '/admin/integrations', 'admB');
step('…another organisation\'s admin sees THEIR own choice (none), not A\'s', g.body.active_contact === null);
let r = await call('POST', '/admin/integrations/apollo', 'admA', { active: true, kind: 'contact' });
step('an admin makes Apollo the one: stored for THEIR organisation, read back', r.status === 200 && row('int_contact_active__org_oA') === 'apollo' && r.body.active_contact === 'apollo' && row('int_contact_active__org_oB') === undefined, row('int_contact_active__org_oA'));
r = await call('POST', '/admin/integrations/zeta', 'admA', { active: true });
step('"active" on a contact provider with no kind means the contact choice (not the verifier\'s)', r.status === 200 && row('int_contact_active__org_oA') === 'zeta' && r.body.active_contact === 'zeta' && row('int_verifier_active__org_oA') === undefined && row('int_email_verify_active__org_oA') === undefined);
r = await call('POST', '/admin/integrations/groq', 'admA', { active: true, kind: 'contact' });
step('only a contact-data provider can be made the contact choice (400 for an AI provider)', r.status === 400 && /Not a contact-data provider/.test(r.body.error) && row('int_contact_active__org_oA') === 'zeta');
r = await call('POST', '/admin/integrations/zeta', 'bdA', { active: true });
step('only an admin (403)', r.status === 403);
r = await call('POST', '/admin/integrations/zeta', 'admA', { active: false, kind: 'contact' });
step('un-choosing clears the choice (back to "the first with a key")', r.status === 200 && row('int_contact_active__org_oA') === undefined && r.body.active_contact === null);
await call('POST', '/admin/integrations/groq', 'admA', { active: true });
step('an AI provider\'s "active" is still the AI choice — the older meaning is untouched', row('int_ai_active__org_oA') === 'groq');
const tested = await call('POST', '/admin/integrations/zeta/test', 'admA', { api_key: 'zeta-key-A' });
step('a contact card\'s Test goes through THAT provider\'s adapter ("people search" is a verb it does not offer here → said in words)', tested.status === 200 && tested.body.ok === false && /Zeta does not offer that \(checkPeopleSearch\)/.test(tested.body.error), JSON.stringify(tested.body));
server.close();

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
