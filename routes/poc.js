// ============================================================================
// THE POC FINDER — server side (R-053, D-0049; docs/CONTACT_FINDER_DESIGN.md).
// The RULES are services/poc-targets.js (pure) and the Apollo calls are
// services/people-apollo.js; this file is only the database around them.
//
//   GET  /jobs/:id/poc                         — size, the job's function, the
//        four slots, the people who fit none, people found and waiting, the
//        company's email format, whether Apollo is connected and today's
//        credits, and whether the caller may change anything.
//   PUT  /jobs/:id/company-size                — the size pick, remembered for
//        the COMPANY (source 'manual' — Apollo never overwrites it).
//   POST /jobs/:id/company-size/lookup         — ask Apollo for the company's
//        size by its website (1 credit when found, 0 when not).
//   POST /jobs/:id/poc/find                    — "Search contacts" (every
//        empty slot) or "Search contact" on one slot (`slot_key`): looks the
//        company's size up first when nobody has set it, then asks Apollo for
//        people in the EMPTY slots and stores them as suggestions.
//   POST /jobs/:id/poc/suggestions/:sid/accept — the person becomes a contact
//        on the lead, through the same code as "Add contact".
//   POST /jobs/:id/poc/suggestions/:sid/reject — "Not this person": never
//        suggested for this lead again.
//
// Seeing follows the lead's own rule (own.canSeeLead → 404 otherwise, the same
// shape as GET /jobs/:id: a 403 would confirm the lead exists). Changing
// anything follows canTouchJob — the same gate as adding a contact.
//
// The format is learned from addresses on the company's OTHER leads too, but
// only the pattern and a count leave this file — never another lead's people,
// which the caller may not be allowed to see (D-0034). Those people are also
// never suggested again: somebody already on file is one person, not a new one.
//
// THE FINDER NEVER WRITES A CONTACT BY ITSELF. The send engine emails a lead's
// contacts, so a person PACE merely found waits in poc_suggestions until a
// human accepts them (design §6 rule 2). And D-0049 — A GUESSED ADDRESS IS
// NEVER EMAILED — holds at three levels: an email is stored only as
// 'confirmed' (Apollo verified it) or 'likely' (built from the company's own
// format, learned from real addresses there), the table refuses anything else
// (migration 052), and Apollo's own guesses ("extrapolated") are dropped.
// ============================================================================
const express = require('express');
const poc = require('../services/poc-targets');
const own = require('../services/ownership');
const integrations = require('../config/integrations');
const settings = require('../config/settings');
const peopleApollo = require('../services/people-apollo');
const { addLeadContact, lookupExisting, findDuplicate, duplicateResponse, duplicatePayload } = require('../services/lead-contacts');
const { createDb } = require('../models');

// Apollo refusals that mean "stop asking today", as opposed to one person
// failing: the key, the plan, the rate limit.
const STOP_STATUSES = new Set([401, 403, 429]);

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, canTouchJob, orgIdFor, logActivity } = ctx;
  const db = ctx.db || createDb(supabase);
  // Tests hand in a fake Apollo; production calls the real one.
  const apollo = ctx.apollo || peopleApollo;
  const { reportingChainIds } = require('../hierarchy')(supabase);

  async function scopeFor(req) {
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgIdFor(req));
    return own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
  }

  // The lead, if this caller may see it; null otherwise (the caller answers 404).
  async function visibleLead(req, id) {
    const { data } = await db.forRequest(req).from('jobs')
      .select('id,company_id,position,industry,stage,created_by,assigned_to,assigned_to_bd,org_id')
      .eq('id', id).is('deleted_at', null).maybeSingle();
    if (!data) return null;
    return own.canSeeLead(data, await scopeFor(req)) ? data : null;
  }

  // Everything the rules need about one lead: its company, its people, the
  // people on the company's other leads (format + "already on file" only), the
  // four slots filled from what is on file, and the learned email format.
  async function leadContext(req, lead) {
    let company = null;
    if (lead.company_id) {
      const { data } = await db.forRequest(req).from('companies')
        .select('id,name,website,size_band,employee_count,size_source,size_checked_at,apollo_org_id').eq('id', lead.company_id).maybeSingle();
      company = data || null;
    }
    const { data: contacts } = await db.forRequest(req).from('contacts')
      .select('id,first_name,last_name,designation,email,email_status,is_primary').eq('job_id', lead.id);
    let siblings = [];
    if (lead.company_id) {
      const { data: sibs } = await db.forRequest(req).from('jobs')
        .select('id').eq('company_id', lead.company_id).is('deleted_at', null).limit(50);
      const ids = (sibs || []).map(s => s.id).filter(x => x !== lead.id);
      if (ids.length) {
        const { data: more } = await db.forRequest(req).from('contacts')
          .select('first_name,last_name,email,email_status').in('job_id', ids).limit(300);
        siblings = more || [];
      }
    }
    const targets = poc.pocTargets({ position: lead.position, industry: lead.industry }, company && company.size_band);
    const filled = poc.fillSlots(targets, contacts || []);
    const format = poc.learnFormat((contacts || []).concat(siblings), company && company.website);
    return { company, contacts: contacts || [], siblings, targets, filled, format };
  }

  // ── the Apollo credit meter ─────────────────────────────────────────────
  // app_settings, keyed per org and per UTC day — the AI meter's shape
  // (services/ai-budget.js): no migration, and it expires by never being read
  // again. Counted on every lookup Apollo answered, whether or not an email
  // came back: over-counting is the safe direction for a ceiling.
  const creditKey = (orgId) => `poc_credits_${orgId || 'default'}_${new Date().toISOString().slice(0, 10)}`;
  async function creditsUsed(orgId) {
    try {
      const { data } = await db.global.from('app_settings').select('value').eq('key', creditKey(orgId)).maybeSingle();
      const n = Number(data && data.value);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (_) { return 0; }
  }
  async function recordCredits(orgId, used) {
    try {
      await db.global.from('app_settings')
        .upsert({ key: creditKey(orgId), value: String(used), updated_at: new Date() }, { onConflict: 'key' });
    } catch (_) { /* a meter is not worth an outage */ }
  }

  // The last thing Apollo said, kept so a failure somebody saw can be read
  // from the database instead of being transcribed: `apollo_last_call`, plus
  // `apollo_last_error`, which keeps the last FAILURE after later successes.
  // Never the key. Best-effort — a note must never be why a search fails.
  async function noteApollo(call, result) {
    try {
      const rec = peopleApollo.callRecord(call, result, new Date().toISOString());
      const rows = [{ key: 'apollo_last_call', value: JSON.stringify(rec), updated_at: new Date() }];
      if (!rec.ok) rows.push({ key: 'apollo_last_error', value: JSON.stringify(rec), updated_at: new Date() });
      await db.global.from('app_settings').upsert(rows, { onConflict: 'key' });
    } catch (_) { /* best-effort */ }
  }

  async function creditBudget(req) {
    const orgId = orgIdFor(req);
    return { orgId, used: await creditsUsed(orgId), limit: await settings.getSetting(supabase, 'poc_apollo_daily_credits') };
  }

  // ── the company's size, from Apollo (owner, 2026-09-28) ─────────────────
  // Found by the company's WEBSITE — the record is exact — and then the NAME
  // is checked (poc.sameCompany): a website belonging to a parent group, or
  // one typed wrong at import, would hand back somebody else's headcount, and
  // a wrong size looks for the wrong people. A size somebody PICKED is never
  // overwritten. 1 credit when Apollo finds the company, 0 when it does not;
  // a company Apollo did not know is not asked again for 30 days unless a
  // person presses "Look up with Apollo" themselves.
  const RECHECK_MS = 30 * 86400000;
  async function lookupSize(req, cx, key, budget, force) {
    const co = cx.company;
    if (!co) return { status: 'no_company' };
    if (co.size_band && co.size_source === 'manual') return { status: 'manual', sentence: 'The company size was picked by hand — PACE leaves it as it is.' };
    if (co.size_band && !force) return { status: 'known' };
    if (!force && co.size_checked_at && (Date.now() - new Date(co.size_checked_at).getTime()) < RECHECK_MS) return { status: 'checked_recently' };
    const domains = [poc.normalizeDomain(co.website), cx.format.domain].filter((d, i, a) => d && a.indexOf(d) === i);
    if (!domains.length) return { status: 'no_domain', sentence: 'Company size: PACE needs the company’s website to look it up.' };
    if (budget.used >= budget.limit) {
      return { status: 'no_credits', sentence: `Company size not looked up — today's ${budget.limit} Apollo credit${budget.limit === 1 ? ' is' : 's are'} used up.` };
    }
    let hit = null, failed = null;
    for (const d of domains) {
      const r = await apollo.enrichOrganization({ key, domain: d });
      await noteApollo('company_lookup', r);
      if (!r.ok) { failed = r; break; }
      if (r.found) {
        hit = Object.assign({ asked: d }, r.org);
        budget.used++;                             // 1 credit — only when found
        await recordCredits(budget.orgId, budget.used);
        break;
      }
    }
    if (failed) return { status: 'error', http: failed.status, sentence: 'Company size: ' + failed.error };
    const stamp = { size_checked_at: new Date(), updated_at: new Date() };
    if (!hit) {
      await db.forRequest(req).from('companies').update(stamp).eq('id', co.id);
      return { status: 'not_found', sentence: `Apollo does not know ${domains[0]} — pick the company size yourself.` };
    }
    if (!poc.sameCompany(co.name, hit.name)) {
      await db.forRequest(req).from('companies').update(stamp).eq('id', co.id);
      return { status: 'no_match', sentence: `Apollo’s record for ${hit.asked} is “${hit.name}”, not ${co.name}, so the size was left for you to pick.` };
    }
    const patch = Object.assign({}, stamp, { apollo_org_id: String(hit.id).slice(0, 100) });
    const band = poc.sizeBandFor(hit.employees);
    if (!band) {
      await db.forRequest(req).from('companies').update(patch).eq('id', co.id);
      return { status: 'no_size', sentence: `Apollo knows ${co.name} but not how many people work there — pick the size yourself.` };
    }
    Object.assign(patch, { size_band: band, employee_count: hit.employees, size_source: 'apollo' });
    const { error } = await db.forRequest(req).from('companies').update(patch).eq('id', co.id);
    if (error) throw error;
    const label = (poc.SIZE_BANDS.find(b => b.id === band) || {}).label || band;
    return { status: 'set', band, employees: hit.employees,
      sentence: `Company size from Apollo: about ${hit.employees.toLocaleString('en-US')} people (${label}).` };
  }

  async function finderState(req) {
    const apolloOn = await integrations.isConfigured(supabase, 'apollo');
    return {
      apollo: apolloOn,
      credits: {
        used: apolloOn ? await creditsUsed(orgIdFor(req)) : 0,
        limit: await settings.getSetting(supabase, 'poc_apollo_daily_credits'),
      },
      // Only an admin can connect Apollo, so only an admin is told how.
      is_admin: hasRole(req, 'admin'),
    };
  }

  async function payload(req, lead) {
    const cx = await leadContext(req, lead);
    const { data: waiting } = await db.forRequest(req).from('poc_suggestions')
      .select('id,slot_key,first_name,last_name,title,email,email_confidence,email_source,source,linkedin_url,created_at')
      .eq('job_id', lead.id).eq('status', 'suggested').order('created_at', { ascending: true });
    return {
      lead_id: lead.id,
      company_id: lead.company_id || null,
      company_name: (cx.company && cx.company.name) || null,
      size: cx.targets.size,
      size_known: cx.targets.size_known,
      // Where the size came from ('manual' / 'apollo' / null), Apollo's
      // estimate, and when Apollo was last asked.
      size_source: (cx.company && cx.company.size_source) || null,
      employee_count: (cx.company && cx.company.employee_count) || null,
      size_checked_at: (cx.company && cx.company.size_checked_at) || null,
      sizes: poc.SIZE_BANDS,
      function: cx.targets.function,
      slots: cx.filled.slots.map(s => ({ key: s.key, kind: s.kind, label: s.label, titles: s.titles, contact_id: s.contact_id })),
      others: cx.filled.others,
      found: cx.filled.slots.filter(s => s.contact_id).length,
      // People found and waiting for a yes or no, each in the slot it was found for.
      suggestions: waiting || [],
      // pattern + domain + how many real addresses agree. `example` shows the
      // shape on a made-up name; null when the format is not known — and then
      // nothing builds an address at all (D-0049: a guess is never emailed).
      format: {
        domain: cx.format.domain,
        pattern: cx.format.pattern,
        learned_from: cx.format.learned_from,
        example: cx.format.pattern ? poc.emailFor('Jane', 'Smith', cx.format) : null,
      },
      finder: await finderState(req),
      can_edit: await canTouchJob(req, lead.id),
    };
  }

  router.get('/jobs/:id/poc', auth, async (req, res) => {
    try {
      const lead = await visibleLead(req, req.params.id);
      if (!lead) return res.status(404).json({ error: 'Not found' });
      res.json(await payload(req, lead));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.put('/jobs/:id/company-size', auth, async (req, res) => {
    try {
      const lead = await visibleLead(req, req.params.id);
      if (!lead) return res.status(404).json({ error: 'Not found' });
      if (!(await canTouchJob(req, lead.id))) return res.status(403).json({ error: 'Only the people working this lead can change it.' });
      if (!lead.company_id) return res.status(409).json({ error: 'This lead has no company to size.' });
      const raw = req.body && req.body.size;
      const size = raw === null || raw === '' ? null : poc.normalizeSize(raw);
      if (raw != null && raw !== '' && !size) return res.status(400).json({ error: 'Pick one of the listed sizes.' });
      const { error } = await db.forRequest(req).from('companies')
        .update({ size_band: size, size_source: size ? 'manual' : null, updated_at: new Date() }).eq('id', lead.company_id);
      if (error) throw error;
      res.json(await payload(req, lead));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // "Look up with Apollo" beside the size pick — asked for by a person, so it
  // asks even when Apollo said "not known" recently; never over a picked size.
  router.post('/jobs/:id/company-size/lookup', auth, async (req, res) => {
    try {
      const lead = await visibleLead(req, req.params.id);
      if (!lead) return res.status(404).json({ error: 'Not found' });
      if (!(await canTouchJob(req, lead.id))) return res.status(403).json({ error: 'Only the people working this lead can change it.' });
      if (!lead.company_id) return res.status(409).json({ error: 'This lead has no company to size.' });
      const key = await integrations.getSecret(supabase, 'apollo');
      if (!key) return res.status(409).json({ error: notConnected(req) });
      const budget = await creditBudget(req);
      const sz = await lookupSize(req, await leadContext(req, lead), key, budget, true);
      if (sz.status === 'error') return res.status(502).json({ error: sz.sentence });
      res.json(Object.assign(await payload(req, lead),
        { result: { size: sz.status, message: sz.sentence || null, credits: { used: budget.used, limit: budget.limit } } }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  function notConnected(req) {
    return hasRole(req, 'admin')
      ? 'Apollo is not connected yet — add its key in Admin → Integrations.'
      : 'Apollo is not connected yet — ask an admin to add its key in Admin → Integrations.';
  }

  // ── "Search contacts" / "Search contact" ────────────────────────────────
  // Only the EMPTY slots, and only those with nobody already waiting. The
  // search is free; a credit is spent on a person only when nothing free can
  // do the job — Apollo hid their surname, or PACE has no format to build
  // their address from — and never past the day's ceiling.
  router.post('/jobs/:id/poc/find', auth, async (req, res) => {
    try {
      const lead = await visibleLead(req, req.params.id);
      if (!lead) return res.status(404).json({ error: 'Not found' });
      if (!(await canTouchJob(req, lead.id))) return res.status(403).json({ error: 'Only the people working this lead can look for people on it.' });
      const key = await integrations.getSecret(supabase, 'apollo');
      if (!key) return res.status(409).json({ error: notConnected(req) });
      // One slot ("Search contact" on it) or every empty one ("Search contacts").
      const only = req.body && req.body.slot_key ? String(req.body.slot_key) : null;
      if (only && !['hr1', 'hr2', 'mgr1', 'mgr2'].includes(only)) return res.status(400).json({ error: 'Unknown slot.' });
      const budget = await creditBudget(req);

      // The size decides which titles to look for, so an unknown size is
      // looked up FIRST (the same click — the owner wants Apollo used only
      // when a button is pressed). A picked size is never touched.
      let cx = await leadContext(req, lead);
      let sizeNote = null;
      if (!cx.targets.size_known) {
        const sz = await lookupSize(req, cx, key, budget, false);
        if (sz.status === 'error' && sz.http === 401) return res.status(502).json({ error: sz.sentence });
        sizeNote = sz.sentence || null;
        if (sz.status === 'set') cx = await leadContext(req, lead);
      }
      const noted = (msg) => [sizeNote, msg].filter(Boolean).join(' ');

      const { data: prior } = await db.forRequest(req).from('poc_suggestions')
        .select('slot_key,source,source_ref,status').eq('job_id', lead.id);
      const waitingSlots = (prior || []).filter(p => p.status === 'suggested').map(p => p.slot_key);
      const open = cx.filled.slots.filter(s => !s.contact_id && !waitingSlots.includes(s.key) && (!only || s.key === only));
      const reply = async (result) => res.json(Object.assign(await payload(req, lead),
        { result: Object.assign({ credits: { used: budget.used, limit: budget.limit } }, result) }));
      if (!open.length) {
        return reply({ added: 0, message: noted(only
          ? 'That slot already has somebody, or somebody waiting for you to look at.'
          : 'Every slot already has somebody, or somebody waiting for you to look at.') });
      }

      const site = poc.normalizeDomain(cx.company && cx.company.website);
      const domains = [site, cx.format.domain].filter((d, i, a) => d && a.indexOf(d) === i);
      if (!domains.length) {
        return res.status(409).json({ error: 'PACE needs this company’s website, or one real email address there, to search by — add it to the company first.' });
      }

      const titles = open.reduce((all, s) => all.concat(s.titles), []).filter((t, i, a) => a.indexOf(t) === i);
      const search = await apollo.searchPeople({ key, domains, titles, perPage: 25 });
      await noteApollo('people_search', search);
      if (!search.ok) return res.status(502).json({ error: noted(search.error) });

      const onFile = cx.contacts.concat(cx.siblings);
      // Slots NOT being searched are skipped exactly like slots with somebody waiting.
      const skip = waitingSlots.concat(only ? cx.filled.slots.map(s => s.key).filter(k => k !== only) : []);
      const picks = poc.pickPeople(cx.filled.slots, search.people, {
        ids: (prior || []).filter(p => p.source === 'apollo' && p.source_ref).map(p => p.source_ref),
        names: onFile.map(c => [c.first_name, c.last_name].filter(Boolean).join(' ')),
      }, cx.targets.size, skip);
      if (!picks.length) {
        return reply({ added: 0, message: noted(search.people.length
          ? `Apollo knows people at ${(cx.company && cx.company.name) || domains[0]}, but nobody new in ${only ? 'that role' : 'the roles still open'}.`
          : `Apollo has nobody at ${domains[0]} in ${only ? 'that role' : 'the roles still open'}.`) });
      }

      // A person already looked up for ANOTHER lead is never paid for twice.
      const pickIds = picks.map(x => String(x.person.id));
      const { data: seen } = await db.forRequest(req).from('poc_suggestions')
        .select('source_ref,first_name,last_name,title,email,email_confidence,email_source,linkedin_url')
        .eq('source', 'apollo').in('source_ref', pickIds);
      const looked = {};
      (seen || []).forEach(r => {
        if (!r.last_name) return;
        const had = looked[r.source_ref];
        if (!had || (r.email && !had.email)) looked[r.source_ref] = r;
      });

      const knownNames = new Set(onFile.map(c => poc.nameKey((c.first_name || '') + ' ' + (c.last_name || ''))).filter(Boolean));
      const knownEmails = new Set(onFile.map(c => String(c.email || '').toLowerCase()).filter(Boolean));
      const out = { added: 0, held_for_credits: 0, already_known: 0, opted_out: 0, failed: 0 };
      let stopped = null;
      const found = [];
      for (const { slot_key, person } of picks) {
        const p = { slot_key, ref: String(person.id), first: person.first_name, last: person.last_name || '',
          title: person.title || '', linkedin: person.linkedin_url || null, email: null, conf: null, esrc: null };
        const prev = looked[p.ref];
        if (prev) {
          p.first = prev.first_name || p.first; p.last = prev.last_name || p.last;
          p.title = prev.title || p.title; p.linkedin = prev.linkedin_url || p.linkedin;
          if (prev.email) { p.email = prev.email; p.conf = prev.email_confidence; p.esrc = prev.email_source; }
        }
        if (!p.email && p.last && cx.format.pattern) {
          p.email = poc.emailFor(p.first, p.last, cx.format);
          if (p.email) { p.conf = 'likely'; p.esrc = 'format'; }
        }
        const needsCredit = !p.last || (!p.email && person.has_email);
        if (needsCredit) {
          if (stopped || budget.used >= budget.limit) {
            // Without a credit a hidden surname cannot even be named: leave
            // them for another day rather than store half a person.
            if (!p.last) { out.held_for_credits++; continue; }
          } else {
            const r = await apollo.revealPerson({ key, id: person.id });
            await noteApollo('person_lookup', r);
            if (r.ok) {
              budget.used++;
              await recordCredits(budget.orgId, budget.used);
              p.first = r.first_name || p.first; p.last = r.last_name || p.last;
              p.title = r.title || p.title; p.linkedin = r.linkedin_url || p.linkedin;
              if (!p.email) {
                // Only Apollo's "verified" is Confirmed. Its other statuses are
                // guesses — dropped, and the company's own format used instead.
                if (r.email && r.email_verified) { p.email = r.email; p.conf = 'confirmed'; p.esrc = 'apollo'; }
                else if (p.last && cx.format.pattern) {
                  p.email = poc.emailFor(p.first, p.last, cx.format);
                  if (p.email) { p.conf = 'likely'; p.esrc = 'format'; }
                }
              }
            } else {
              if (STOP_STATUSES.has(r.status)) stopped = r.error; else out.failed++;
              if (!p.last) { if (stopped) out.held_for_credits++; continue; }
            }
          }
        }
        found.push(p);
      }

      // Opted out anywhere → never suggested (design §6 rule 3). The check is
      // deployment-wide, exactly as the send path's is (index.js
      // loadSuppressedSet); the caller learns only a count, never whose.
      const emails = found.map(p => p.email && p.email.toLowerCase()).filter(Boolean);
      const suppressed = new Set();
      if (emails.length) {
        try {
          const { data } = await db.crossOrg('suppression_list').select('email').in('email', emails);
          (data || []).forEach(r => suppressed.add(String(r.email).toLowerCase()));
        } catch (_) {}
      }

      const now = new Date();
      for (const p of found) {
        const row = {
          job_id: lead.id, company_id: lead.company_id || null, slot_key: p.slot_key,
          first_name: String(p.first || '').slice(0, 100), last_name: p.last ? String(p.last).slice(0, 100) : null,
          title: p.title ? String(p.title).slice(0, 200) : null,
          email: null, email_confidence: null, email_source: null,
          source: 'apollo', source_ref: p.ref.slice(0, 200),
          linkedin_url: p.linkedin ? String(p.linkedin).slice(0, 500) : null,
          status: 'suggested', created_by: req.user.id,
        };
        const lower = p.email ? p.email.toLowerCase() : null;
        const known = knownNames.has(poc.nameKey(p.first + ' ' + p.last)) || (lower && knownEmails.has(lower));
        if (known || (lower && suppressed.has(lower))) {
          // Recorded as turned down by PACE itself (decided_by stays empty), so
          // the same person is never looked up — or paid for — on this lead
          // again. No address is kept for somebody who opted out.
          if (known) out.already_known++; else out.opted_out++;
          Object.assign(row, { status: 'rejected', decided_at: now });
        } else if (p.email && (p.conf === 'confirmed' || p.conf === 'likely')) {
          Object.assign(row, { email: p.email.slice(0, 320), email_confidence: p.conf, email_source: p.esrc });
        }
        if (!row.first_name) continue;
        const { error } = await db.forRequest(req).from('poc_suggestions').insert(row);
        if (error) {
          if (error.code === '23505') continue;   // found by somebody else a moment ago
          throw error;
        }
        if (row.status === 'suggested') out.added++;
      }

      const limit = budget.limit;
      const bits = [];
      if (sizeNote) bits.push(sizeNote);
      bits.push(out.added ? `Found ${out.added} ${out.added === 1 ? 'person' : 'people'} — accept the ones you want on this lead.` : 'Nobody new to suggest.');
      if (out.already_known) bits.push(`${out.already_known} already on file at this company.`);
      if (out.opted_out) bits.push(`${out.opted_out} left out — asked not to be emailed.`);
      if (out.held_for_credits) bits.push(stopped
        ? `${out.held_for_credits} not looked up: ${stopped}`
        : `${out.held_for_credits} more need an Apollo credit to see their full name, and today's ${limit} ${limit === 1 ? 'is' : 'are'} used up.`);
      else if (stopped) bits.push(stopped);
      if (out.failed) bits.push(`Apollo could not look up ${out.failed}.`);
      return reply(Object.assign(out, { credits: { used: budget.used, limit: budget.limit }, message: bits.join(' ') }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  async function waitingSuggestion(req, lead, sid) {
    const { data } = await db.forRequest(req).from('poc_suggestions')
      .select('id,job_id,slot_key,first_name,last_name,title,email,email_confidence,email_source,source,linkedin_url,status')
      .eq('id', sid).eq('job_id', lead.id).maybeSingle();
    return data || null;
  }

  // ── Accept: the person becomes a contact on the lead ────────────────────
  router.post('/jobs/:id/poc/suggestions/:sid/accept', auth, async (req, res) => {
    try {
      const lead = await visibleLead(req, req.params.id);
      if (!lead) return res.status(404).json({ error: 'Not found' });
      if (!(await canTouchJob(req, lead.id))) return res.status(403).json({ error: 'Only the people working this lead can add people to it.' });
      const s = await waitingSuggestion(req, lead, req.params.sid);
      if (!s) return res.status(404).json({ error: 'Not found' });
      if (s.status !== 'suggested') return res.status(409).json({ error: s.status === 'accepted' ? 'Already on this lead.' : 'This person was turned down.' });

      // D-0049 at the last step too: an address travels only with a confidence.
      const email = s.email && (s.email_confidence === 'confirmed' || s.email_confidence === 'likely') ? s.email : null;
      // Already added? The SAME check as "Add contact" (services/lead-contacts.js):
      // the address anywhere in the org, the name on this lead or at this company.
      const person = { first_name: s.first_name, last_name: s.last_name || '', email };
      const found = await lookupExisting({ db, req, jobId: lead.id, companyId: lead.company_id || null, email });
      const dup = findDuplicate(person, found.people, { jobId: lead.id, companyId: lead.company_id || null });
      const same = dup && dup.where === 'this_lead' ? dup.contact : null;
      const scope = await scopeFor(req);
      const turnDown = () => db.forRequest(req).from('poc_suggestions')
        .update({ status: 'rejected', decided_at: new Date() }).eq('id', s.id).eq('status', 'suggested');
      const refusal = async (d) => {
        try { return await duplicateResponse({ db, req, dup: d, job: found.jobs[d.contact.job_id] || d.job || null, canSee: (j) => own.canSeeLead(j, scope) }); }
        catch (_) { return duplicatePayload(d, { visible: false }); }
      };

      // One person, one conversation (design §6 rule 4). Somebody on ANOTHER
      // lead — at this company, or anywhere with this address — is not added a
      // second time: two people from one firm emailing the same HR manager
      // about two roles reads as disorganised, and is how complaints start.
      // PACE turns the suggestion down itself (decided_by stays empty) and
      // says so — naming the other lead only if the caller may see it (D-0034).
      if (dup && !same) {
        await turnDown();
        return res.status(409).json(await refusal(dup));
      }

      // Claim it before adding, so two clicks (or two people) cannot add one person twice.
      const { data: claimed, error: claimErr } = await db.forRequest(req).from('poc_suggestions')
        .update({ status: 'accepted', decided_by: req.user.id, decided_at: new Date() })
        .eq('id', s.id).eq('status', 'suggested').select('id');
      if (claimErr) throw claimErr;
      if (!claimed || !claimed.length) return res.status(409).json({ error: 'Somebody has just decided on this person.' });

      let contact = same || null;
      if (!contact) {
        try {
          const how = s.source === 'apollo' ? 'Apollo' : s.source;
          contact = await addLeadContact({
            db, req, logActivity, companyId: lead.company_id || null,
            fields: {
              job_id: lead.id, first_name: s.first_name, last_name: s.last_name || '',
              designation: s.title || null, email, linkedin: s.linkedin_url || null,
              is_primary: !found.people.some(p => p.job_id === lead.id),
            },
            activityText: `Contact added from the POC finder (${how}${email ? ', email ' + (s.email_confidence === 'confirmed' ? 'confirmed by ' + how : 'built from the company’s format') : ''}): ${[s.first_name, s.last_name].filter(Boolean).join(' ')}`,
          });
        } catch (e) {
          if (e && e.code === 'duplicate_contact') {
            // Added by somebody else in the moment since the check above.
            await db.forRequest(req).from('poc_suggestions')
              .update({ status: 'rejected', decided_by: null, decided_at: new Date() }).eq('id', s.id);
            return res.status(409).json(await refusal(e.duplicate));
          }
          // Put the suggestion back — a person who was not added was not accepted.
          await db.forRequest(req).from('poc_suggestions')
            .update({ status: 'suggested', decided_by: null, decided_at: null }).eq('id', s.id);
          throw e;
        }
      }
      await db.forRequest(req).from('poc_suggestions').update({ contact_id: contact.id }).eq('id', s.id);
      // Already on this lead: nothing new was added, and the page says so in
      // the same pop-up "Add contact" shows (no "add anyway" — Accept is not
      // typing a new person, it is recognising one).
      let already = null;
      if (same) {
        const who = [same.first_name, same.last_name].filter(Boolean).join(' ') || 'This person';
        already = Object.assign(duplicatePayload(dup).duplicate, {
          title: 'Already added', can_add_anyway: false,
          message: `${who} is already on this lead, so nothing new was added.`,
        });
      }
      res.json(Object.assign(await payload(req, lead), { contact: { id: contact.id }, already_on_lead: !!same },
        already ? { duplicate: already } : {}));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Not this person ─────────────────────────────────────────────────────
  router.post('/jobs/:id/poc/suggestions/:sid/reject', auth, async (req, res) => {
    try {
      const lead = await visibleLead(req, req.params.id);
      if (!lead) return res.status(404).json({ error: 'Not found' });
      if (!(await canTouchJob(req, lead.id))) return res.status(403).json({ error: 'Only the people working this lead can decide on people for it.' });
      const s = await waitingSuggestion(req, lead, req.params.sid);
      if (!s) return res.status(404).json({ error: 'Not found' });
      if (s.status !== 'suggested') return res.status(409).json({ error: 'Somebody has already decided on this person.' });
      const { data: done, error } = await db.forRequest(req).from('poc_suggestions')
        .update({ status: 'rejected', decided_by: req.user.id, decided_at: new Date() })
        .eq('id', s.id).eq('status', 'suggested').select('id');
      if (error) throw error;
      if (!done || !done.length) return res.status(409).json({ error: 'Somebody has just decided on this person.' });
      res.json(await payload(req, lead));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
