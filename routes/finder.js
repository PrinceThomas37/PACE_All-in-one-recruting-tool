// ============================================================================
// THE LEAD FINDER — server side (R-157; D-0085…D-0091; the design is the owner's mockups of 7 Oct 2026).
//
//   GET    /finder/access                  am I switched on, my daily number, the meters, the choices to offer
//   GET    /finder/diagnose        (admin) what this Apollo key can and cannot do, in plain words (spends ~2 credits)
//   POST   /finder/run                     run ALL my active searches now
//   GET    /finder/admin/users     (admin) who may use the finder, and each person's daily number
//   PUT    /finder/admin/users/:id (admin) switch a person on/off and set their daily number
//   GET|POST /finder/searches              my saved searches (personal) / save one
//   PUT|DELETE /finder/searches/:id        change / delete one of mine
//   POST   /finder/searches/:id/run        run one of mine now
//   GET    /finder/cards                   today's cards: companies waiting for Accept / Wait / Reject
//   POST   /finder/cards/:id/reject|wait   turn a card down for good / for the admin's number of days
//   POST   /finder/cards/:id/postings      open the company's postings (1 Apollo credit, once)
//   POST   /finder/cards/:id/people        find people by job title (free)
//   POST   /finder/cards/:id/reveal        reveal one person's verified work email (1 credit)
//   POST   /finder/cards/:id/accept        save the lead + up to 3 contacts — the ONLY thing that writes a lead
//
// RULES that hold across all of it:
//   * Nothing is written as a lead until Accept (the owner: storage). A card is a short-lived suggestion.
//   * A company already worked in THIS organisation (website / LinkedIn / name, active lead, cooldown) never becomes a
//     card, and Accept is refused if it became one meanwhile — services/lead-decision.js, the same rule as everywhere.
//   * Nothing is shared between customers (D-0090): every query goes through the organisation-scoped data layer.
//   * Every credit is counted against the organisation's daily limit (admin-set) BEFORE the call; searching for people
//     is free. An address is stored only if Apollo VERIFIED it (D-0049: a guess is never emailed).
//   * Apollo is called ONLY through services/people-apollo.js, never retried (a retry can be charged twice).
//   * Literal paths are registered ABOVE the :id routes of their prefix.
// ============================================================================
const express = require('express');
const finder = require('../services/lead-finder');
const leadCheck = require('../services/lead-check');
const peopleApollo = require('../services/people-apollo');
const integrations = require('../config/integrations');
const settings = require('../config/settings');
const contactPoints = require('../services/contact-points');
const leadDistribution = require('../services/lead-distribution');
const poc = require('../services/poc-targets');
const { annotateContactEmailStatus, emailSyntaxValid } = require('../email-validation');
const { createDb } = require('../models');

const ADDERS = ['admin', 'bd', 'bd_lead', 'ra', 'ra_lead', 'director', 'associate_director'];
const MAX_SEARCHES = 20;
const RERUN_GAP_MS = 60 * 1000;
const DEFAULT_PEOPLE_TITLES = ['HR Manager', 'Human Resources', 'Talent Acquisition', 'Recruiter', 'Hiring Manager', 'Operations Manager', 'General Manager', 'Director', 'Owner', 'President'];

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, logActivity, getTimezoneFromLocation, withOrg } = ctx;
  const db = ctx.db || createDb(supabase);
  const apollo = ctx.apollo || peopleApollo;               // tests hand in a fake Apollo
  const clock = ctx.now || (() => new Date());

  // ── the small stores in app_settings (global, keyed by person or organisation) ──────────────────────────
  async function readSetting(key) {
    try { const { data } = await db.global.from('app_settings').select('value').eq('key', key).maybeSingle(); return data ? data.value : null; } catch (_) { return null; }
  }
  async function writeSetting(key, value) {
    const { error } = await db.global.from('app_settings').upsert({ key, value: String(value), updated_at: new Date() }, { onConflict: 'key' });
    if (error) throw error;
  }
  const readCount = async (key) => { const n = Number(await readSetting(key)); return Number.isFinite(n) && n > 0 ? n : 0; };
  const orgOf = (req) => (req && (req.orgId || (req.user && req.user.org_id))) || null;
  const num = (key) => settings.getSetting(supabase, key);

  async function accessOf(req) {
    const isAdmin = hasRole(req, 'admin');
    const a = finder.readAccess(await readSetting(finder.accessKey(req.user.id)));
    return { enabled: isAdmin || (a.enabled && hasRole(req, ...ADDERS)), is_admin: isAdmin, daily: finder.dailyFor(a, await num('finder_cards_per_day')) };
  }
  // The caller must be switched on; answers the 403 itself.
  async function needAccess(req, res) {
    const a = await accessOf(req);
    if (!a.enabled) { res.status(403).json({ error: 'The Lead Finder is not switched on for you. Ask an admin to turn it on.' }); return null; }
    return a;
  }

  // Apollo's last answer, kept so a failure somebody saw can be read from the database (the same row the POC finder keeps).
  async function noteApollo(call, result) {
    try {
      const rec = apollo.callRecord ? apollo.callRecord(call, result, clock().toISOString()) : { call, ok: !!(result && result.ok) };
      const rows = [{ key: 'apollo_last_call', value: JSON.stringify(rec), updated_at: new Date() }];
      if (!rec.ok) rows.push({ key: 'apollo_last_error', value: JSON.stringify(rec), updated_at: new Date() });
      await db.global.from('app_settings').upsert(rows, { onConflict: 'key' });
    } catch (_) { /* best-effort: a note is never why a search fails */ }
  }

  // The organisation's daily Apollo credit meter. `spend()` writes BEFORE the call is trusted: over-counting is the safe direction.
  async function budgetFor(orgId, now) {
    const limit = await num('finder_apollo_daily_credits');
    const key = finder.creditKey(orgId, now);
    const b = { orgId, limit, used: await readCount(key) };
    b.left = () => Math.max(0, b.limit - b.used);
    b.spend = async (n) => { b.used += n; await writeSetting(key, b.used); };
    return b;
  }

  // ═════════ RUNNING A SEARCH ═════════════════════════════════════════════════════════════════════════
  // One saved search → up to `remaining` new cards. Returns a summary; never throws for an Apollo problem (it says so).
  // Safe to repeat and safe to be killed half-way: a card is written one at a time and the unique index stops a repeat, and
  // `last_run_at` is only set at the end, so an interrupted run is simply run again.
  async function runSearch({ scoped, orgId, userId, search, daily, key, budget, now }) {
    const day = finder.dayOf(now);
    const out = { search_id: search.id, name: search.name, found: 0, cards: 0, staffing: 0, worked: 0, seen: 0, note: '', error: null };
    const finish = async (note) => {
      out.note = note;
      await scoped.from('finder_searches').update({ last_run_at: now, last_run_note: note.slice(0, 400), updated_at: now }).eq('id', search.id);
      return out;
    };
    if (daily <= 0) return finish('You have no cards a day. Ask an admin to set a number for you.');
    const made = await scoped.from('finder_cards').select('id').eq('user_id', userId).eq('created_on', day);
    if (made.error) throw made.error;
    const remaining = daily - (made.data || []).length;
    if (remaining <= 0) return finish('You already have your ' + daily + ' cards for today.');
    if (!key) return finish('Apollo is not connected. An admin adds its key in Admin → Integrations.');
    if (budget.left() < 1) return finish('Your organisation has used today\'s Apollo credit limit (' + budget.limit + ').');

    const r = await apollo.searchOrganizations({ key, filters: finder.apolloFilters(search, now), page: 1, perPage: 100 });
    await noteApollo('finder_company_search', r);
    if (!r.ok) { out.error = r.error; return finish(r.error); }
    if ((r.organizations || []).length) await budget.spend(1);          // 1 credit per page that returns results
    const orgs = []; const seenKeys = new Set();
    (r.organizations || []).forEach((raw) => {
      const o = finder.normalizeOrg(raw);
      const k = o.apollo_org_id || o.domain;
      if (!o.name || !k || seenKeys.has(k)) return;
      seenKeys.add(k); o.company_key = k; orgs.push(o);
    });
    out.found = orgs.length;

    // Leave out staffing firms, then what this person has already seen.
    const clients = orgs.filter((o) => { if (finder.isStaffingFirm(o)) { out.staffing++; return false; } return true; });
    const keys = clients.map((o) => o.company_key);
    const had = keys.length ? await scoped.from('finder_cards').select('company_key').eq('user_id', userId).in('company_key', keys) : { data: [] };
    if (had.error) throw had.error;
    const hadSet = new Set((had.data || []).map((c) => c.company_key));
    const fresh = clients.filter((o) => { if (hadSet.has(o.company_key)) { out.seen++; return false; } return true; });

    const ranked = fresh.map((o) => Object.assign({ o }, finder.scoreOrg(o, search))).sort((a, b) => b.score - a.score);
    for (const c of ranked) {
      if (out.cards >= remaining) break;
      // A company this organisation already works (website / LinkedIn / name, active lead, cooldown) is not a new lead.
      const verdict = await leadCheck.checkCompany({ db, supabase, req: { orgId }, candidate: { name: c.o.name, website: c.o.domain || c.o.website, linkedin: c.o.linkedin_url }, now });
      if (verdict.blocked) { out.worked++; continue; }
      const row = {
        user_id: userId, search_id: search.id, company_key: c.o.company_key, apollo_org_id: c.o.apollo_org_id,
        company_name: c.o.name.slice(0, 300), score: c.score, status: 'new', created_on: day,
        payload: { company: c.o, chips: c.chips, on_file_as: verdict.company_id ? { id: verdict.company_id, name: verdict.company_name, matched: verdict.matched_text } : null, search: { titles: search.titles, locations: search.locations } },
      };
      const ins = await scoped.from('finder_cards').insert(row);
      if (ins.error) { if (String(ins.error.code) === '23505') { out.seen++; continue; } throw ins.error; }
      out.cards++;
    }
    return finish('Found ' + out.found + ' companies hiring. ' + out.cards + ' new card' + (out.cards === 1 ? '' : 's') +
      (out.staffing ? '; ' + out.staffing + ' staffing firm' + (out.staffing === 1 ? '' : 's') + ' left out' : '') +
      (out.worked ? '; ' + out.worked + ' already in your organisation' : '') + (out.seen ? '; ' + out.seen + ' you have already seen' : '') + '.');
  }

  // Cards nobody acted on go; a company put on Wait whose day has come returns to the person's cards.
  async function housekeeping(scoped, userId, now) {
    const gone = new Date(new Date(now).getTime() - (await num('finder_card_days')) * 86400000).toISOString();
    let del = scoped.from('finder_cards').delete().eq('status', 'new').lt('created_at', gone);
    if (userId) del = del.eq('user_id', userId);
    await del;
    let wake = scoped.from('finder_cards').update({ status: 'new', wait_until: null, created_on: finder.dayOf(now), created_at: now }).eq('status', 'waiting').lte('wait_until', finder.dayOf(now));
    if (userId) wake = wake.eq('user_id', userId);
    await wake;
  }

  // The nightly sweep (engine runner): every person's active searches, each at most once a day.
  async function runDue() {
    const now = clock();
    const rows = await db.crossOrg('finder_searches').select('*').is('deleted_at', null).eq('active', true);
    if (rows.error) throw rows.error;
    const key = await integrations.getSecret(supabase, 'apollo');
    const summary = { searches: 0, cards: 0, errors: 0 };
    const budgets = {}, defaults = await num('finder_cards_per_day');
    for (const s of (rows.data || [])) {
      try {
        if (s.last_run_at && now.getTime() - new Date(s.last_run_at).getTime() < 20 * 3600 * 1000) continue;     // already run today
        const scoped = db.forOrg(s.org_id);
        const u = await scoped.from('users').select('id,role,roles').eq('id', s.user_id).maybeSingle();
        if (!u.data) continue;
        const roles = [].concat(u.data.role || [], u.data.roles || []);
        const acc = finder.readAccess(await readSetting(finder.accessKey(s.user_id)));
        if (!(roles.includes('admin') || (acc.enabled && roles.some((r) => ADDERS.includes(r))))) continue;       // switched off since
        await housekeeping(scoped, s.user_id, now);
        budgets[s.org_id] = budgets[s.org_id] || await budgetFor(s.org_id, now);
        const r = await runSearch({ scoped, orgId: s.org_id, userId: s.user_id, search: s, daily: finder.dailyFor(acc, defaults), key, budget: budgets[s.org_id], now });
        summary.searches++; summary.cards += r.cards; if (r.error) summary.errors++;
      } catch (e) { summary.errors++; console.error('[LeadFinder] search ' + s.id + ' failed:', e.message); }
    }
    return summary;
  }
  router.runDue = runDue;

  // ═════════ ACCESS, DIAGNOSE, ADMIN ══════════════════════════════════════════════════════════════════
  router.get('/finder/access', auth, async (req, res) => {
    try {
      const a = await accessOf(req);
      if (!a.enabled) return res.json({ enabled: false, is_admin: a.is_admin });
      const now = clock(), orgId = orgOf(req);
      res.json({
        enabled: true, is_admin: a.is_admin, daily: a.daily,
        apollo: { connected: await integrations.isConfigured(supabase, 'apollo') },
        credits: { used: await readCount(finder.creditKey(orgId, now)), limit: await num('finder_apollo_daily_credits') },
        reveals: { used: await readCount(finder.revealKey(req.user.id, now)), limit: await num('finder_reveals_per_day') },
        wait_days: await num('finder_wait_days'), card_days: await num('finder_card_days'),
        sectors: Object.keys(finder.SECTORS).map((id) => ({ id, label: finder.SECTORS[id].label, titles: finder.SECTORS[id].titles })),
        sizes: finder.SIZE_BANDS.map((b) => ({ id: b.id, label: b.label })), posted: finder.POSTED_CHOICES,
        goes_to: hasRole(req, 'bd', 'bd_lead') ? 'you' : 'pool',
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Admin: what this key can and cannot do. Each check is said in words; the two that cost a credit say so beforehand in the UI.
  router.get('/finder/diagnose', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const key = await integrations.getSecret(supabase, 'apollo');
      if (!key) return res.json({ connected: false, checks: [{ id: 'key', ok: false, text: 'Apollo is not connected. Add its key in Admin → Integrations.' }] });
      const now = clock(), budget = await budgetFor(orgOf(req), now), checks = [{ id: 'key', ok: true, text: 'An Apollo key is saved.' }];
      const people = await apollo.checkPeopleSearch({ key });
      await noteApollo('finder_check_people', people);
      checks.push({ id: 'people', ok: !!people.ok, text: people.ok ? 'Finding people by job title works (free).' : people.error });
      let orgId = null;
      if (budget.left() >= 2) {
        const f = finder.apolloFilters({ titles: ['accountant'], locations: ['united states'], sizes: ['mid'], posted_days: 30 }, now);
        const o = await apollo.searchOrganizations({ key, filters: f, page: 1, perPage: 1 });
        await noteApollo('finder_check_companies', o);
        if (o.ok && o.organizations.length) await budget.spend(1);
        checks.push({ id: 'companies', ok: !!o.ok, text: o.ok ? 'Searching companies by the jobs they are hiring for works (1 credit used).' : o.error });
        if (o.ok && o.organizations.length) { const n = finder.normalizeOrg(o.organizations[0]); orgId = n.apollo_org_id; }
        if (orgId) {
          const p = await apollo.organizationJobPostings({ key, orgId, perPage: 1 });
          await noteApollo('finder_check_postings', p);
          if (p.ok) await budget.spend(1);
          checks.push({ id: 'postings', ok: !!p.ok, text: p.ok ? 'Reading a company\'s job postings works (1 credit used).' : p.error });
        }
      } else checks.push({ id: 'credits', ok: false, text: 'Not enough of today\'s Apollo credit limit is left to test company search.' });
      res.json({ connected: true, ok: checks.every((c) => c.ok), checks, credits: { used: budget.used, limit: budget.limit } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/finder/admin/users', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const { data, error } = await db.forRequest(req).from('users').select('id,name,email,role,roles').order('name', { ascending: true });
      if (error) throw error;
      const dflt = await num('finder_cards_per_day');
      const out = [];
      for (const u of (data || [])) {
        const roles = [].concat(u.role || [], u.roles || []);
        if (!roles.some((r) => ADDERS.includes(r))) continue;
        const a = finder.readAccess(await readSetting(finder.accessKey(u.id)));
        out.push({ id: u.id, name: u.name, email: u.email, roles: Array.from(new Set(roles)), enabled: a.enabled, daily: a.daily, effective_daily: finder.dailyFor(a, dflt) });
      }
      res.json({ users: out, default_daily: dflt });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.put('/finder/admin/users/:id', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const { data: u } = await db.forRequest(req).from('users').select('id,role,roles').eq('id', req.params.id).maybeSingle();
      if (!u) return res.status(404).json({ error: 'User not found' });       // another organisation's person does not exist for this admin
      const roles = [].concat(u.role || [], u.roles || []);
      if (!roles.some((r) => ADDERS.includes(r))) return res.status(400).json({ error: 'This person\'s role does not add leads, so the Lead Finder is not for them.' });
      const b = req.body || {};
      const daily = b.daily === null || b.daily === '' || b.daily === undefined ? null : Math.floor(Number(b.daily));
      if (daily !== null && !(daily >= 0 && daily <= 500)) return res.status(400).json({ error: 'Cards a day must be a number from 0 to 500, or empty to use the organisation\'s number.' });
      const value = { enabled: b.enabled === true };
      if (daily !== null) value.daily = daily;
      await writeSetting(finder.accessKey(u.id), JSON.stringify(value));
      res.json({ id: u.id, enabled: value.enabled, daily });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ═════════ SAVED SEARCHES — personal ═══════════════════════════════════════════════════════════════
  const mine = (req) => db.forRequest(req).from('finder_searches').select('*').eq('user_id', req.user.id).is('deleted_at', null);

  router.get('/finder/searches', auth, async (req, res) => {
    try {
      if (!(await needAccess(req, res))) return;
      const { data, error } = await mine(req).order('created_at', { ascending: false });
      if (error) throw error;
      res.json({ searches: data || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/finder/searches', auth, async (req, res) => {
    try {
      if (!(await needAccess(req, res))) return;
      const v = finder.normalizeSearch(req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const have = await mine(req);
      if (have.error) throw have.error;
      if ((have.data || []).length >= MAX_SEARCHES) return res.status(400).json({ error: 'You can keep ' + MAX_SEARCHES + ' saved searches. Delete one first.' });
      const { data, error } = await db.forRequest(req).from('finder_searches').insert(Object.assign({ user_id: req.user.id }, v.value)).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.put('/finder/searches/:id', auth, async (req, res) => {
    try {
      if (!(await needAccess(req, res))) return;
      const v = finder.normalizeSearch(req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const { data, error } = await db.forRequest(req).from('finder_searches').update(Object.assign({}, v.value, { updated_at: clock() }))
        .eq('id', req.params.id).eq('user_id', req.user.id).is('deleted_at', null).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Search not found' });     // somebody else's search does not exist for you
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/finder/searches/:id', auth, async (req, res) => {
    try {
      if (!(await needAccess(req, res))) return;
      const { data, error } = await db.forRequest(req).from('finder_searches').update({ deleted_at: clock(), active: false })
        .eq('id', req.params.id).eq('user_id', req.user.id).is('deleted_at', null).select('id').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Search not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // "Run now" — for one search, or all of mine. Rate-limited per search so a double-click costs one call, not two.
  async function runMine(req, res, only) {
    const access = await needAccess(req, res); if (!access) return;
    const now = clock(), orgId = orgOf(req), scoped = db.forRequest(req);
    const { data, error } = await mine(req);
    if (error) throw error;
    const list = (data || []).filter((s) => (only ? s.id === only : s.active));
    if (only && !list.length) return res.status(404).json({ error: 'Search not found' });
    if (!list.length) return res.status(400).json({ error: 'You have no saved searches to run. Save one first.' });
    const key = await integrations.getSecret(supabase, 'apollo');
    await housekeeping(scoped, req.user.id, now);
    const budget = await budgetFor(orgId, now);
    const results = [];
    for (const s of list) {
      if (s.last_run_at && now.getTime() - new Date(s.last_run_at).getTime() < RERUN_GAP_MS && !ctx.noRerunGap) {
        results.push({ search_id: s.id, name: s.name, cards: 0, note: 'Ran a moment ago. Give it a minute.', skipped: true }); continue;
      }
      results.push(await runSearch({ scoped, orgId, userId: req.user.id, search: s, daily: access.daily, key, budget, now }));
    }
    res.json({ results, new_cards: results.reduce((n, r) => n + (r.cards || 0), 0), credits: { used: budget.used, limit: budget.limit } });
  }
  router.post('/finder/run', auth, async (req, res) => { try { await runMine(req, res, null); } catch (err) { res.status(500).json({ error: err.message }); } });
  router.post('/finder/searches/:id/run', auth, async (req, res) => { try { await runMine(req, res, req.params.id); } catch (err) { res.status(500).json({ error: err.message }); } });

  // ═════════ CARDS ═══════════════════════════════════════════════════════════════════════════════════
  const cardOf = async (req, id) => {
    const { data, error } = await db.forRequest(req).from('finder_cards').select('*').eq('id', id).eq('user_id', req.user.id).maybeSingle();
    if (error) throw error;
    return data || null;                      // somebody else's card does not exist for you
  };
  const present = (c, decision) => {
    const p = c.payload || {}, co = p.company || {};
    const posts = Array.isArray(c.postings) ? c.postings : null;
    const sig = posts ? finder.postingSignals(posts) : null;
    return {
      id: c.id, company_name: c.company_name, status: c.status, wait_until: c.wait_until, created_on: c.created_on,
      domain: co.domain || '', website: co.website || '', linkedin_url: co.linkedin_url || '', phone: co.phone || '',
      city: co.city || '', state: co.state || '', address: co.address || '', employees: co.employees || null, revenue: co.revenue || '',
      chips: [].concat(p.chips || [], sig ? sig.chips : []),
      on_file_as: p.on_file_as || null,
      postings: posts, people: Object.values(p.people || {}), search: p.search || null,
      decision: decision ? { blocked: decision.blocked, state: decision.state, sentence: decision.sentence } : null,
    };
  };

  router.get('/finder/cards', auth, async (req, res) => {
    try {
      const access = await needAccess(req, res); if (!access) return;
      const now = clock(), scoped = db.forRequest(req);
      await housekeeping(scoped, req.user.id, now);
      const { data, error } = await scoped.from('finder_cards').select('*').eq('user_id', req.user.id).eq('status', 'new').order('score', { ascending: false });
      if (error) throw error;
      const waiting = await scoped.from('finder_cards').select('id,wait_until').eq('user_id', req.user.id).eq('status', 'waiting');
      const out = [];
      for (const c of (data || [])) {
        const co = (c.payload && c.payload.company) || {};
        // Asked again as the card is shown: a colleague may have taken this company since last night.
        let d = null;
        try { d = await leadCheck.checkCompany({ db, supabase, req, candidate: { name: c.company_name, website: co.domain || co.website, linkedin: co.linkedin_url }, now }); } catch (_) { d = null; }
        out.push(present(c, d));
      }
      const made = await scoped.from('finder_cards').select('id').eq('user_id', req.user.id).eq('created_on', finder.dayOf(now));
      res.json({ cards: out, waiting: (waiting.data || []).length, daily: access.daily, today: (made.data || []).length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/finder/cards/:id/reject', auth, async (req, res) => {
    try {
      if (!(await needAccess(req, res))) return;
      const { data, error } = await db.forRequest(req).from('finder_cards')
        .update({ status: 'rejected', payload: null, postings: null, wait_until: null, decided_at: clock() })
        .eq('id', req.params.id).eq('user_id', req.user.id).in('status', ['new', 'waiting']).select('id').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Card not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/finder/cards/:id/wait', auth, async (req, res) => {
    try {
      if (!(await needAccess(req, res))) return;
      const until = finder.waitUntil(clock(), await num('finder_wait_days'));
      const { data, error } = await db.forRequest(req).from('finder_cards')
        .update({ status: 'waiting', wait_until: until, decided_at: clock() })
        .eq('id', req.params.id).eq('user_id', req.user.id).eq('status', 'new').select('id').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Card not found' });
      res.json({ success: true, wait_until: until });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Open the company's postings — a credit, once; then it is on the card.
  router.post('/finder/cards/:id/postings', auth, async (req, res) => {
    try {
      if (!(await needAccess(req, res))) return;
      const card = await cardOf(req, req.params.id);
      if (!card || card.status !== 'new') return res.status(404).json({ error: 'Card not found' });
      if (Array.isArray(card.postings)) return res.json({ postings: card.postings, signals: finder.postingSignals(card.postings), cached: true });
      const key = await integrations.getSecret(supabase, 'apollo');
      if (!key) return res.status(409).json({ error: 'Apollo is not connected. An admin adds its key in Admin → Integrations.' });
      const now = clock(), budget = await budgetFor(orgOf(req), now);
      if (budget.left() < 1) return res.status(429).json({ error: 'Your organisation has used today\'s Apollo credit limit (' + budget.limit + ').' });
      const r = await apollo.organizationJobPostings({ key, orgId: card.apollo_org_id, perPage: 50 });
      await noteApollo('finder_postings', r);
      if (!r.ok) return res.status(502).json({ error: r.error });
      await budget.spend(1);
      const postings = finder.normalizePostings(r.postings, now).slice(0, 25);
      const { error } = await db.forRequest(req).from('finder_cards').update({ postings }).eq('id', card.id);
      if (error) throw error;
      res.json({ postings, signals: finder.postingSignals(postings), credits: { used: budget.used, limit: budget.limit } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Find people by job title — free. Names only; an email costs a credit and is asked for separately.
  router.post('/finder/cards/:id/people', auth, async (req, res) => {
    try {
      if (!(await needAccess(req, res))) return;
      const card = await cardOf(req, req.params.id);
      if (!card || card.status !== 'new') return res.status(404).json({ error: 'Card not found' });
      const key = await integrations.getSecret(supabase, 'apollo');
      if (!key) return res.status(409).json({ error: 'Apollo is not connected. An admin adds its key in Admin → Integrations.' });
      const co = (card.payload && card.payload.company) || {};
      const typed = String((req.body && req.body.title) || '').split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean).slice(0, 10);
      const r = await apollo.searchPeople({ key, domain: co.domain, titles: typed.length ? typed : DEFAULT_PEOPLE_TITLES, perPage: 25 });
      await noteApollo('finder_people_search', r);
      if (!r.ok) return res.status(502).json({ error: r.error });
      const have = (card.payload && card.payload.people) || {};
      res.json({ people: r.people.map((p) => Object.assign({}, p, { revealed: !!have[p.id], email: have[p.id] ? have[p.id].email : null })), total: r.total });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Reveal one person's work email — 1 credit, counted first, never repeated for the same person, and only a VERIFIED address is kept.
  router.post('/finder/cards/:id/reveal', auth, async (req, res) => {
    try {
      if (!(await needAccess(req, res))) return;
      const card = await cardOf(req, req.params.id);
      if (!card || card.status !== 'new') return res.status(404).json({ error: 'Card not found' });
      const personId = String((req.body && req.body.person_id) || '').slice(0, 80);
      if (!personId) return res.status(400).json({ error: 'Say whose email to reveal.' });
      const payload = Object.assign({}, card.payload || {});
      payload.people = Object.assign({}, payload.people || {});
      if (payload.people[personId]) return res.json({ person: payload.people[personId], cached: true });
      const now = clock(), orgId = orgOf(req);
      const mineKey = finder.revealKey(req.user.id, now), used = await readCount(mineKey), limit = await num('finder_reveals_per_day');
      if (used >= limit) return res.status(429).json({ error: 'You have revealed your ' + limit + ' emails for today. More tomorrow, or ask an admin to raise it.' });
      const key = await integrations.getSecret(supabase, 'apollo');
      if (!key) return res.status(409).json({ error: 'Apollo is not connected. An admin adds its key in Admin → Integrations.' });
      const budget = await budgetFor(orgId, now);
      if (budget.left() < 1) return res.status(429).json({ error: 'Your organisation has used today\'s Apollo credit limit (' + budget.limit + ').' });
      await budget.spend(1); await writeSetting(mineKey, used + 1);              // counted BEFORE the answer is trusted
      const r = await apollo.revealPerson({ key, id: personId });
      await noteApollo('finder_reveal', r);
      if (!r.ok) return res.status(502).json({ error: r.error });
      const person = {
        id: personId, first_name: r.first_name || '', last_name: r.last_name || '', title: r.title || '', linkedin_url: r.linkedin_url || null,
        email: r.email && r.email_verified ? String(r.email).toLowerCase() : null,            // D-0049: a guess is never kept
      };
      payload.people[personId] = person;
      const { error } = await db.forRequest(req).from('finder_cards').update({ payload }).eq('id', card.id);
      if (error) throw error;
      res.json({ person, note: person.email ? null : 'Apollo has no verified email for this person.', credits: { used: budget.used, limit: budget.limit } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ACCEPT — the only thing that writes a lead.
  router.post('/finder/cards/:id/accept', auth, async (req, res) => {
    let claimed = null;
    const undo = async () => { if (claimed) { try { await db.forRequest(req).from('finder_cards').update({ status: 'new', decided_at: null }).eq('id', claimed); } catch (_) { /* the card simply stays accepted-less on a later look */ } } };
    try {
      if (!(await needAccess(req, res))) return;
      const scoped = db.forRequest(req), now = clock();
      const card = await cardOf(req, req.params.id);
      if (!card || card.status !== 'new') return res.status(404).json({ error: 'Card not found' });
      const co = (card.payload && card.payload.company) || {};
      const b = req.body || {};
      const position = String(b.position || '').trim().slice(0, 200);
      if (!position) return res.status(400).json({ error: 'Pick the job this lead is for.' });

      // Contacts: up to 3, each with a verified/typed email. People revealed on this card are taken from the card, never from the browser.
      const picked = (Array.isArray(b.contacts) ? b.contacts : []).slice(0, 3);
      const rawContacts = [];
      for (const c of picked) {
        if (c && c.person_id) {
          const p = ((card.payload && card.payload.people) || {})[String(c.person_id)];
          if (!p || !p.email) return res.status(400).json({ error: 'Reveal that person\'s email first — a contact needs an email PACE can use.' });
          rawContacts.push({ first_name: p.first_name, last_name: p.last_name, designation: p.title, email: p.email, linkedin: p.linkedin_url });
        } else if (c && c.email) {
          rawContacts.push({ first_name: c.first_name, last_name: c.last_name, designation: c.designation, email: c.email, phone: c.phone, linkedin: c.linkedin });
        }
      }
      if (!rawContacts.length) return res.status(400).json({ error: 'Pick at least one contact with an email, so the lead can be emailed.' });
      const contacts = rawContacts.map((r) => contactPoints.tidyImportedContact(r).contact);
      const bad = contacts.find((c) => !c.first_name || !c.email || !emailSyntaxValid(c.email));
      if (bad) return res.status(400).json({ error: 'Each contact needs a first name and a valid email.' });

      // The add rule, asked again at the moment of Accept (a colleague may have taken the company since the card appeared).
      const verdict = await leadCheck.checkCompany({ db, supabase, req, candidate: { name: card.company_name, website: co.domain || co.website, linkedin: co.linkedin_url }, now });
      if (verdict.blocked) return res.status(409).json({ error: verdict.sentence, reason: verdict.state });

      // Where it goes: a BD manager's lead comes straight to them, in one of their connected mailboxes; everyone else's goes to the pool (D-0088, D-0089).
      const toMe = hasRole(req, 'bd', 'bd_lead');
      let mailboxId = null;
      if (toMe) {
        const mb = await leadDistribution.connectedMailboxesFor({ supabase, withOrg: (q) => withOrg(q, req), userId: req.user.id, todayStr: finder.dayOf(now), who: 'You', ignoreRoom: true });
        if (mb.error) return res.status(400).json({ error: mb.error + ' (Nothing was saved.)' });
        mailboxId = leadDistribution.assignmentQueue(mb.accounts, 1)[0] || null;
      }

      // Claim the card in one conditional step so a double-click can never make two leads.
      const claim = await scoped.from('finder_cards').update({ status: 'accepted', decided_at: now }).eq('id', card.id).eq('status', 'new').select('id');
      if (claim.error) throw claim.error;
      if (!claim.data || !claim.data.length) return res.status(409).json({ error: 'This card was already handled.' });
      claimed = card.id;

      // The company: the one already on file (found by website / LinkedIn / name), else a new one with what Apollo told us.
      let companyId = verdict.company_id || null;
      if (!companyId) {
        const row = { name: card.company_name, website: co.website || (co.domain ? 'https://' + co.domain : null), location: [co.city, co.state].filter(Boolean).join(', ') || null, industry: co.industry || null, created_by: req.user.id, apollo_org_id: card.apollo_org_id || null };
        if (co.linkedin_url) row.linkedin_url = co.linkedin_url;
        if (co.employees) { row.employee_count = co.employees; row.size_source = 'apollo'; const band = poc.sizeBandFor(co.employees); if (band) row.size_band = band; }
        const ins = await scoped.from('companies').insert(row).select('id').single();
        if (ins.error) throw ins.error;
        companyId = ins.data.id;
      }

      const posts = Array.isArray(card.postings) ? card.postings : [];
      const chosen = posts.find((p) => p.title === position) || null;
      const location = (chosen && [chosen.city, chosen.state].filter(Boolean).join(', ')) || [co.city, co.state].filter(Boolean).join(', ') || null;
      const facts = finder.factsLines(co, posts);
      const research = {
        requirements: { skill_1: null, skill_2: null, skill_3: null, skills: [], suggested_skills: [], skills_source: 'none', location, city: (chosen && chosen.city) || co.city || null },
        company: { expertise: '', notes: '', headcount: '', hiring_volume: '' }, outreach: { angle: facts[0] || '', avoid: '' }, contacts: [],
        // Only the title: the posting TEXT cannot be read from Apollo, so the AI writes a short email from facts, never invented duties (D-0087).
        jd_raw: 'Title: ' + position,
        source: { kind: 'finder', provider: 'apollo', apollo_org_id: card.apollo_org_id || null, search_id: card.search_id || null, found_at: card.created_at, posting_url: (chosen && chosen.url) || null },
        finder: { facts, postings: posts.slice(0, 10).map((p) => ({ title: p.title, url: p.url, posted_at: p.posted_at, source: p.source })) },
      };
      const leadRow = {
        company_id: companyId, position, location, source: 'Finder · Apollo', job_url: (chosen && chosen.url) || null,
        stage: toMe ? 'Assigned' : 'Unassigned', notes: facts.join(' '), research, created_by: req.user.id,
        created_date: finder.dayOf(now), freshness: 'New', timezone: getTimezoneFromLocation ? getTimezoneFromLocation(location) : null,
      };
      if (toMe) Object.assign(leadRow, { assigned_to_bd: req.user.id, assigned_to: req.user.id, sending_email_id: mailboxId, assigned_at: now.toISOString ? now.toISOString() : now });
      const lead = await scoped.from('jobs').insert(leadRow).select('id').single();
      if (lead.error) throw lead.error;

      const rows = contacts.map((c, i) => ({ job_id: lead.data.id, first_name: c.first_name || '', last_name: c.last_name || '', designation: c.designation || null, email: c.email, phone: c.phone || null, extra_emails: c.extra_emails || [], extra_phones: c.extra_phones || [], linkedin: c.linkedin || null, is_primary: i === 0 }));
      try { await annotateContactEmailStatus(rows); } catch (_) { /* best-effort, as on every other way a lead is made */ }
      const cIns = await scoped.from('contacts').insert(rows);
      if (cIns.error) throw cIns.error;

      await scoped.from('finder_cards').update({ lead_id: lead.data.id, postings: null }).eq('id', card.id);
      try { if (logActivity) await logActivity(lead.data.id, null, req.user.id, 'lead_found', 'Found with the Lead Finder (Apollo): ' + position); } catch (_) { /* the audit is a record, never the point */ }
      claimed = null;
      res.status(201).json({ lead_id: lead.data.id, company_id: companyId, goes_to: toMe ? 'you' : 'pool', contacts: rows.length });
    } catch (err) { await undo(); res.status(500).json({ error: err.message }); }
  });

  return router;
};
