// lead-ingest.js — turn free employer job feeds into reviewable leads.
//
// THE PIPELINE, per configured board:
//
//   fetch → normalize → hash → is this new? → classify the company →
//   parse the JD → work out why the role exists → infer a contact →
//   check it isn't already a lead → stage it for review
//
// NOTHING HERE CREATES A LEAD. Everything lands in `sourced_jobs_raw` with
// status 'new'. A human approves it, and only then does it become a `jobs` row
// that the outreach engine can act on. That gate is deliberate: an automated
// pipeline that can email people without review is one bad parse away from
// embarrassing the business.
//
// Every step is rule-based and free — no AI key (the app has none), and the only
// network calls are the public board feeds plus DNS.

const crypto = require('crypto');
const { fetchBoard } = require('./lead-sources');
const { classifyCompany } = require('./company-classifier');
const { inferHiringReason } = require('./why-hiring');
const { findContacts, normalizeDomain } = require('./enrichment');
const jdParser = require('./jd-parser');

// Identity of a posting: the company, the role, and where it is. Deliberately
// NOT the description or the provider's id — an employer editing the JD, or
// re-publishing under a new id, must not read as a brand-new lead. This is what
// stops the review queue filling with the same twenty reqs every night.
function contentHash({ company_name, title, city, state, country }) {
  const key = [company_name, title, city || '', state || '', country || '']
    .map(s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim())
    .join('|');
  return crypto.createHash('sha1').update(key).digest('hex');
}

// Optional per-source narrowing, so one board doesn't drag in every req a
// company has when the desk only sells engineering.
function passesFilters(posting, filters) {
  if (!filters || typeof filters !== 'object') return true;
  const title = String(posting.title || '').toLowerCase();
  const loc = `${posting.location || ''} ${posting.city || ''} ${posting.state || ''}`.toLowerCase();
  const dept = String(posting.department || '').toLowerCase();
  const any = (list, hay) => !Array.isArray(list) || !list.length
    || list.some(v => hay.includes(String(v).toLowerCase()));

  if (Array.isArray(filters.exclude_titles) && filters.exclude_titles.length
      && filters.exclude_titles.some(v => title.includes(String(v).toLowerCase()))) return false;
  return any(filters.titles, title) && any(filters.locations, loc) && any(filters.departments, dept);
}

function safeParseJd(text, industry) {
  if (!text) return null;
  try { return jdParser.parseJobDescription(text, industry || null); }
  catch { return null; }   // ~1100 lines of regex over arbitrary text; never fatal
}

// Build the per-company context the hiring-reason inference needs. All of it
// comes from the same fetch, so it costs nothing extra.
function buildCompanyContext(postings) {
  const titleCounts = new Map();
  for (const p of postings) {
    const k = String(p.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (k) titleCounts.set(k, (titleCounts.get(k) || 0) + 1);
  }
  return { openRoles: postings.length, titleCounts };
}

// ── the one exported entry point ────────────────────────────────────────────
//
// deps: { supabase, fetchImpl? }  — fetchImpl is injected by tests
// Returns a summary suitable for engine_runs.counts.
// `now` is injectable for the same reason conversation-intel.js takes a clock:
// the hiring-reason inference is a claim about elapsed time ("open 105 days"),
// so a test that pins fixture dates but not the clock silently changes meaning
// as real time passes — a posting dated in the fixture drifts from "just posted"
// to "long open" and the expected category changes with it. Production passes
// nothing and gets the real clock.
async function ingestSource(source, deps) {
  const { supabase } = deps;
  const summary = {
    source_id: source.id, provider: source.provider, board: source.board_token,
    found: 0, staged: 0, updated: 0, filtered: 0, staffing_skipped: 0, duplicates: 0, errors: 0
  };

  const res = await fetchBoard(source.provider, source.board_token, {
    fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs
  });

  if (!res.ok) {
    await markSourceRun(supabase, source.id, { status: 'error', error: res.error, found: 0 });
    return Object.assign(summary, { errors: 1, error: res.error });
  }

  const postings = res.postings || [];
  summary.found = postings.length;

  const companyName = source.company_name || (postings[0] && postings[0].company_name) || source.board_token;
  const domain = normalizeDomain(source.company_domain);

  // Classify the employer ONCE per run, not per posting — the verdict is about
  // the company, and the board-shape signal needs every posting anyway.
  const verdict = classifyCompany({
    name: companyName,
    description: postings.map(p => p.description).filter(Boolean).slice(0, 3).join('\n').slice(0, 4000),
    postings,
    domain,
    from_ats_board: true
  });

  // The owner wants end clients, not vendors. A confident staffing verdict stops
  // the whole board — but 'unknown' still flows through, because wrongly
  // excluding a real client is the more expensive mistake and a human is about
  // to look at these anyway.
  if (verdict.kind === 'staffing_firm' && verdict.confidence !== 'low') {
    await markSourceRun(supabase, source.id, {
      status: 'ok', error: null, found: postings.length,
      note: `skipped: looks like a staffing firm (${verdict.why.join('; ')})`
    });
    return Object.assign(summary, { staffing_skipped: postings.length, company_kind: verdict.kind });
  }

  const ctx = buildCompanyContext(postings);
  const now = deps.now ? new Date(deps.now) : new Date();

  for (const posting of postings) {
    try {
      if (!passesFilters(posting, source.filters)) { summary.filtered++; continue; }

      const withCompany = Object.assign({}, posting, { company_name: posting.company_name || companyName });
      const hash = contentHash(withCompany);

      // Already staged? Then this is a "still open" observation, and possibly a
      // genuine repost — both are outreach signals, so update rather than insert.
      const { data: existing } = await supabase.from('sourced_jobs_raw')
        .select('id,seen_count,repost_count,posted_at,first_posted_at,status')
        .eq('org_id', source.org_id || null).eq('content_hash', hash).maybeSingle();

      if (existing) {
        const prev = existing.posted_at ? new Date(existing.posted_at) : null;
        const next = withCompany.posted_at ? new Date(withCompany.posted_at) : null;
        // A relist is the ATS moving the publish date forward. One day of slack
        // absorbs feeds that touch the timestamp on every edit.
        const reposted = prev && next && (next - prev) > 86400000;
        await supabase.from('sourced_jobs_raw').update({
          seen_count: (existing.seen_count || 1) + 1,
          repost_count: (existing.repost_count || 0) + (reposted ? 1 : 0),
          last_seen_at: now,
          posted_at: withCompany.posted_at || existing.posted_at,
          first_posted_at: existing.first_posted_at || existing.posted_at || withCompany.posted_at
        }).eq('id', existing.id);
        summary.updated++;
        continue;
      }

      // New posting — do the expensive-ish work only now.
      const parsed = safeParseJd(withCompany.description, null);
      const titleKey = String(withCompany.title || '').toLowerCase().replace(/\s+/g, ' ').trim();

      const reason = inferHiringReason(withCompany, {
        now,
        repost_count: 0,
        company_open_roles: ctx.openRoles,
        same_title_count: ctx.titleCounts.get(titleKey) || 1
      });

      // Contact inference is DNS-only and free. We have no person's name from a
      // job board, so this yields role mailboxes (careers@, hr@) — which for
      // recruiting outreach are frequently the right target anyway, and are
      // labelled as such rather than dressed up as a named contact.
      let contacts = [];
      if (domain) {
        try {
          const found = await findContacts({ companyName, domain });
          contacts = found.contacts || [];
        } catch { /* enrichment is best-effort; the lead is still worth staging */ }
      }

      // Is this already a lead we own? Match on company + role, the same way a
      // human would. Prevents re-sourcing a client the desk is already working.
      const dup = await findExistingLead(supabase, source.org_id, companyName, withCompany.title);

      const { error } = await supabase.from('sourced_jobs_raw').insert({
        org_id: source.org_id || null,
        lead_source_id: source.id,
        provider: source.provider,
        external_id: withCompany.external_id,
        content_hash: hash,
        company_name: companyName,
        company_domain: domain,
        title: withCompany.title,
        location: withCompany.location,
        city: withCompany.city, state: withCompany.state, country: withCompany.country,
        remote: withCompany.remote,
        department: withCompany.department,
        description: (withCompany.description || '').slice(0, 20000),
        url: withCompany.url,
        posted_at: withCompany.posted_at,
        first_posted_at: withCompany.posted_at,
        parsed: parsed ? {
          skills: parsed.skills, suggested_skills: parsed.suggested_skills,
          skill_1: parsed.skill_1, skill_2: parsed.skill_2, skill_3: parsed.skill_3,
          salary_display: parsed.salary_display, salary_min: parsed.salary_min,
          salary_max: parsed.salary_max, location: parsed.location, city: parsed.city
        } : null,
        hiring_reason: reason,
        company_kind: verdict.kind,
        company_kind_why: (verdict.why || []).join('; ') || null,
        contacts,
        status: dup ? 'duplicate' : 'new',
        dup_job_id: dup ? dup.id : null
      });
      if (error) throw error;

      if (dup) summary.duplicates++; else summary.staged++;
    } catch (err) {
      summary.errors++;
      console.error('[lead-ingest] posting failed:', err.message);
    }
  }

  await markSourceRun(supabase, source.id, { status: 'ok', error: null, found: postings.length });
  return summary;
}

// Does this company+role already exist as a lead? Uses the same loose matching a
// person would: the company name, and a title that overlaps.
async function findExistingLead(supabase, orgId, companyName, title) {
  if (!companyName || !title) return null;
  try {
    let q = supabase.from('companies').select('id,name').ilike('name', companyName).limit(1);
    if (orgId) q = q.eq('org_id', orgId);
    const { data: companies } = await q;
    if (!companies || !companies.length) return null;

    let jq = supabase.from('jobs').select('id,position,stage')
      .eq('company_id', companies[0].id).is('deleted_at', null).limit(25);
    if (orgId) jq = jq.eq('org_id', orgId);
    const { data: jobs } = await jq;

    const want = String(title).toLowerCase();
    return (jobs || []).find(j => {
      const have = String(j.position || '').toLowerCase();
      return have === want || have.includes(want) || want.includes(have);
    }) || null;
  } catch {
    return null;   // a dedup lookup failing must not block staging
  }
}

async function markSourceRun(supabase, sourceId, { status, error, found, note }) {
  try {
    await supabase.from('lead_sources').update({
      last_run_at: new Date(), last_status: status,
      last_error: error ? String(error).slice(0, 500) : (note || null),
      last_found: found == null ? null : found,
      updated_at: new Date()
    }).eq('id', sourceId);
  } catch { /* bookkeeping only */ }
}

// Run every source that is due. This is what the engine runner calls.
async function runDueSources(deps) {
  const { supabase } = deps;
  const out = { sources: 0, staged: 0, updated: 0, duplicates: 0, filtered: 0, staffing_skipped: 0, errors: 0, details: [] };

  let sources;
  try {
    const { data, error } = await supabase.from('lead_sources')
      .select('*').eq('active', true).is('deleted_at', null).limit(200);
    if (error) throw error;
    sources = data || [];
  } catch (err) {
    // The table not existing (migration 035 not yet applied) is the expected
    // case before rollout, and is not an error worth alarming anyone about.
    return { skipped: 'lead sourcing not configured yet' };
  }

  if (!sources.length) return { skipped: 'no lead sources configured' };

  const now = Date.now();
  for (const s of sources) {
    const due = !s.last_run_at
      || (now - new Date(s.last_run_at).getTime()) >= (Number(s.every_hours || 24) * 3600 * 1000);
    if (!due) continue;

    out.sources++;
    const r = await ingestSource(s, deps);
    out.staged += r.staged || 0;
    out.updated += r.updated || 0;
    out.duplicates += r.duplicates || 0;
    out.filtered += r.filtered || 0;
    out.staffing_skipped += r.staffing_skipped || 0;
    out.errors += r.errors || 0;
    out.details.push(r);
  }

  if (!out.sources) return { skipped: 'no sources due yet' };
  return out;
}

module.exports = { ingestSource, runDueSources, contentHash, passesFilters, findExistingLead };
