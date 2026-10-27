// ============================================================================
// CONTACT DATA — one door to "who works at this company and how do I reach them", whichever provider a company brings
// (R-321, D-0175 "no contact-data vendor is hard-wired", D-0180 owner's go: 27 Oct 2026).
// ----------------------------------------------------------------------------
// WHAT IT IS. A small contract and a registry. A PROVIDER is an adapter that answers the same six questions, in the same
// shapes, whatever its vendor calls them:
//
//   searchPeople             people at a company whose titles fit             (no email yet)
//   revealPerson             one person's verified work email                 (the step that costs)
//   enrichOrganization       one company by its website: size, industry …
//   searchOrganizations      companies by what they are hiring for (Find Leads)
//   organizationJobPostings  one company's open postings
//   checkPeopleSearch        can this key do the job at all? (the Integrations card's Test)
//
// Apollo is the first adapter and is `services/people-apollo.js` UNCHANGED — the existing names already are the contract, so
// the credit rules around it (never retried, key in a header, plain-sentence failures) and the ~15 test files that pin them
// did not move. A second vendor is `register()`-ed with its own adapter file; it needs that vendor's current API docs and a
// customer's test key to be written honestly, so none is guessed here (owner, 27 Oct: "build the slot only for now").
//
// WHAT EACH PROVIDER CAN DO IS DATA (`capabilities`), and the screens read it: a provider that cannot search companies by
// hiring does not get the button, and says so — a screen must not advertise what the chosen provider does not have.
// A verb a provider does not offer is NEVER undefined: `adapterFor()` fills it with an answer that says "not offered", so
// no caller can reach a missing function (a guarded call to a function that does not exist is dead code).
//
// WHOSE: every company picks its own provider (`config/integrations.js` active-contact choice, per organisation) and holds its
// own key under that provider's integration id. Nothing chosen = the first provider that has a key, else the first registered.
//
// PURE apart from the settings read. No vendor name is written into a caller: callers ask `resolve()` and get an adapter,
// the provider's id and label (for the one place a person needs the name — the picker and a failure about that provider).
// ============================================================================
'use strict';

const integrations = require('../config/integrations');
const peopleApollo = require('./people-apollo');
const leadFinder = require('./lead-finder');   // the shape of PACE's own searches; Apollo's translation of them is registered below

/** The contract: every adapter answers these, always as { ok, status, ... } (error in plain words) and never throws. */
const VERBS = ['searchPeople', 'revealPerson', 'enrichOrganization', 'searchOrganizations', 'organizationJobPostings', 'checkPeopleSearch'];

// What a verb COSTS the company, in the unit the screens use. `credits` is per call (null = the provider says nothing).
const FREE = Object.freeze({ offered: true, credits: 0 });
const ONE = (note) => Object.freeze({ offered: true, credits: 1, note });
const NOT_OFFERED = Object.freeze({ offered: false, credits: null });

const PROVIDERS = new Map();

/**
 * Add a provider. `id` is also its integration id (config/integrations.js: where its key lives). Throws at start-up, never at a
 * customer, when an adapter cannot keep the contract — a verb is either a function or declared not offered.
 */
function register({ id, label, name, adapter, capabilities, criteria }) {
  if (!id || !label || !adapter) throw new Error('contact-data: a provider needs an id, a label and an adapter');
  const caps = {};
  for (const v of VERBS) {
    const c = capabilities && capabilities[v];
    const offered = !!(c && c.offered);
    if (offered && typeof adapter[v] !== 'function') throw new Error('contact-data: ' + id + ' says it offers ' + v + ' but has no such function');
    caps[v] = offered ? { offered: true, credits: c.credits == null ? null : Number(c.credits), note: c.note || '' } : NOT_OFFERED;
  }
  if (caps.searchOrganizations.offered && !(criteria && typeof criteria.translate === 'function')) throw new Error('contact-data: ' + id + ' searches companies but has no criteria.translate (PACE\'s search → its own query)');
  PROVIDERS.set(id, { id, label, name: name || label, adapter, capabilities: Object.freeze(caps), criteria: criteria || null });
}

register({
  id: 'apollo', label: 'Apollo.io', name: 'Apollo', adapter: peopleApollo,
  // PACE asks for companies in ITS OWN words (a saved search, a list of websites, a name); each provider turns that into its own query.
  // Apollo's field names live here and in services/lead-finder.js (`apolloFilters`, `companyNameFilters`) — nowhere in a route.
  criteria: {
    translate(c, now) {
      const k = (c && c.kind) || 'search';
      if (k === 'domains') return { q_organization_domains_list: (c.domains || []).slice(0, 100) };
      if (k === 'name') return leadFinder.companyNameFilters(c.name);
      return leadFinder.apolloFilters(c.search, now);
    },
  },
  capabilities: {
    searchPeople: Object.assign({}, FREE, { note: 'Finding people by job title is free' }),
    revealPerson: ONE('One credit for each verified email'),
    enrichOrganization: ONE('One credit when the company is found, none when it is not'),
    searchOrganizations: ONE('One credit for each page of companies'),
    organizationJobPostings: ONE('One credit for each company whose jobs are opened'),
    checkPeopleSearch: FREE,
  },
});

const get = (id) => PROVIDERS.get(id) || null;
const has = (id) => PROVIDERS.has(id);

/** For the picker: every provider, what it is called and what it can do. */
function list() {
  return Array.from(PROVIDERS.values()).map((p) => ({ id: p.id, label: p.label, name: p.name, capabilities: p.capabilities }));
}

const notOffered = (name, verb) => async () => ({ ok: false, status: 0, error: name + ' does not offer that (' + verb + ') — pick a different contact database in Admin → Integrations, or do it by hand.' });

/** The provider's adapter with EVERY verb defined: a verb it does not offer answers "not offered" instead of being undefined. */
function adapterFor(id) {
  const p = get(id); if (!p) return null;
  const out = Object.assign({}, p.adapter);          // keeps callRecord, describe*, normalisers — whatever else the adapter carries
  for (const v of VERBS) if (!p.capabilities[v].offered || typeof p.adapter[v] !== 'function') out[v] = notOffered(p.name, v);
  if (typeof out.callRecord !== 'function') out.callRecord = (call, r, at) => ({ at: at || null, call, ok: !!(r && r.ok), status: r && r.status != null ? r.status : null });
  return out;
}

/** The adapter with `searchOrganizations` taking PACE's neutral `criteria` (+ `now`) instead of a vendor's `filters` (a test's own `filters` still pass straight through). */
function withCriteria(adapter, provider) {
  const out = Object.assign({}, adapter);
  const inner = adapter.searchOrganizations;
  out.searchOrganizations = (args) => {
    const a = Object.assign({}, args || {});
    if (a.criteria && !a.filters && provider.criteria) a.filters = provider.criteria.translate(a.criteria, a.now);
    delete a.criteria; delete a.now;
    return inner(a);
  };
  return out;
}

/** Which provider this organisation uses: its own choice if it still exists, else the first one that has a key, else the first registered. */
async function providerIdFor(supabase, orgId) {
  let chosen = null;
  try { chosen = await integrations.getActiveContact(supabase, orgId); } catch (_) { chosen = null; }
  if (chosen && PROVIDERS.has(chosen)) return chosen;
  for (const p of PROVIDERS.values()) {
    try { if (await integrations.isConfigured(supabase, p.id, orgId)) return p.id; } catch (_) { /* try the next */ }
  }
  return PROVIDERS.keys().next().value;
}

/**
 * Everything a route needs to use the organisation's contact database: { id, label, adapter, key, configured, capabilities }.
 * `override` is a test's (or a legacy caller's) ready-made adapter; it is used as-is under the chosen provider's id.
 */
async function resolve(supabase, orgId, override) {
  const id = await providerIdFor(supabase, orgId);
  const p = get(id);
  let key = null;
  try { key = await integrations.getSecret(supabase, id, 'api_key', orgId); } catch (_) { key = null; }
  return { id, label: p.label, name: p.name, adapter: withCriteria(override || adapterFor(id), p), key: key || null, configured: !!key, capabilities: p.capabilities };
}

/** What the screens are told: is a contact database connected for this organisation, which, and what it can do. */
async function statusFor(supabase, orgId) {
  const id = await providerIdFor(supabase, orgId);
  const p = get(id);
  let configured = false;
  try { configured = await integrations.isConfigured(supabase, id, orgId); } catch (_) { configured = false; }
  return { provider: id, label: p.label, name: p.name, connected: configured, capabilities: p.capabilities };
}

module.exports = { VERBS, register, list, get, has, adapterFor, providerIdFor, resolve, statusFor };
