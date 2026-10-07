// ============================================================================
// THE LEAD FINDER — the rules, with no database and no network (R-157, D-0087…D-0091).
// ----------------------------------------------------------------------------
// A person saves a SEARCH (job titles, where the jobs are, company size, how recent). Each night — or when they
// press "Run now" — PACE asks Apollo for companies hiring for those titles and turns the best into CARDS. Nothing
// is saved as a lead until the person presses Accept (the owner: "if every search result is added then the storage
// build will be humongous"), so a card is a short-lived suggestion, not a record.
//
// This file holds only the decisions that need no I/O:
//   * the sector presets (the owner's list) and the size bands (small 11–50, mid 51–500, large 501+);
//   * validating a saved search, and turning it into Apollo's filter names;
//   * reading an Apollo company row (either bucket) into one shape;
//   * leaving staffing firms out (a competitor, not a client) and ranking the rest;
//   * reading a company's postings (title, link, where, when) and the plain-words signals in them;
//   * the keys the daily meters and the per-person switches live under.
// routes/finder.js owns the database and the Apollo calls; services/people-apollo.js is the only caller of Apollo.
// ============================================================================
const rule = require('./lead-decision');

// The owner's sectors (7 Oct 2026): "IT … medical, manufacturing, construction, legal, accounting, property
// management, engineering and all; big, small and medium companies". Picking one FILLS IN typical job titles;
// the person edits them.
const SECTORS = {
  it: { label: 'IT', titles: ['Software Engineer', 'Data Analyst', 'Systems Administrator', 'QA Engineer', 'Network Engineer', 'DevOps Engineer'] },
  medical: { label: 'Medical', titles: ['Registered Nurse', 'Medical Assistant', 'Medical Billing Specialist', 'Dental Hygienist', 'Physical Therapist', 'Patient Care Coordinator'] },
  manufacturing: { label: 'Manufacturing', titles: ['CNC Machinist', 'Production Supervisor', 'Quality Inspector', 'Maintenance Technician', 'Welder', 'Industrial Engineer'] },
  construction: { label: 'Construction', titles: ['Project Manager', 'Site Superintendent', 'Estimator', 'Safety Coordinator', 'Project Engineer', 'Construction Manager'] },
  legal: { label: 'Legal', titles: ['Paralegal', 'Legal Assistant', 'Contracts Administrator', 'Legal Secretary', 'Compliance Specialist', 'Litigation Support'] },
  accounting: { label: 'Accounting', titles: ['Staff Accountant', 'Accounts Payable Clerk', 'Controller', 'Payroll Specialist', 'Accounts Receivable Specialist', 'Senior Accountant'] },
  property: { label: 'Property management', titles: ['Property Manager', 'Leasing Agent', 'Maintenance Supervisor', 'Assistant Property Manager', 'Community Manager', 'Leasing Consultant'] },
  engineering: { label: 'Engineering', titles: ['Mechanical Engineer', 'Civil Engineer', 'Electrical Engineer', 'Project Engineer', 'Design Engineer', 'Manufacturing Engineer'] },
};

// Size bands as Apollo spells them (employee ranges).
const SIZE_BANDS = [
  { id: 'small', label: 'Small 11–50', ranges: ['11,50'] },
  { id: 'mid', label: 'Mid 51–500', ranges: ['51,200', '201,500'] },
  { id: 'large', label: 'Large 501+', ranges: ['501,1000', '1001,2000', '2001,5000', '5001,10000'] },
];
const POSTED_CHOICES = [7, 14, 30];
const LIMITS = { name: 80, titles: 15, title: 80, locations: 8, location: 80, keywords: 8, keyword: 40, domains: 30 };

const txt = (v) => String(v == null ? '' : v).trim();
function uniqueList(v, max, each) {
  const seen = new Set(), out = [];
  (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[\n,;]+/)).forEach((x) => {
    const s = txt(x).slice(0, each);
    const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); out.push(s); }
  });
  return out.slice(0, max);
}
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);

/** A saved search, checked. { ok:true, value } or { ok:false, error } in the person's words. */
function normalizeSearch(input) {
  const i = input || {};
  const name = txt(i.name).slice(0, LIMITS.name);
  if (!name) return { ok: false, error: 'Give the search a name, so you can find it in your list later.' };
  const titles = uniqueList(i.titles, LIMITS.titles, LIMITS.title);
  if (!titles.length) return { ok: false, error: 'Add at least one job title to look for.' };
  const locations = uniqueList(i.locations, LIMITS.locations, LIMITS.location);
  if (!locations.length) return { ok: false, error: 'Add at least one place where the job is (a city, a state, or "remote").' };
  const sizes = uniqueList(i.sizes, 3, 10).map((s) => s.toLowerCase()).filter((s) => SIZE_BANDS.some((b) => b.id === s));
  const posted = Number(i.posted_days);
  const sector = Object.prototype.hasOwnProperty.call(SECTORS, i.sector) ? i.sector : null;
  const domains = uniqueList(i.domains, LIMITS.domains, 120).map(rule.normalizeDomain).filter(Boolean);
  return {
    ok: true,
    value: {
      name, sector, titles, locations, sizes,
      posted_days: POSTED_CHOICES.includes(posted) ? posted : 14,
      keywords: uniqueList(i.keywords, LIMITS.keywords, LIMITS.keyword),
      domains: Array.from(new Set(domains)),
      active: i.active !== false,
    },
  };
}

/** Apollo's own filter names for a saved search (docs.apollo.io "Organization Search"). */
function apolloFilters(search, now) {
  const s = search || {};
  const f = {
    q_organization_job_titles: s.titles || [],
    organization_job_locations: s.locations || [],
    organization_job_posted_at_range: { min: isoDate(new Date(new Date(now).getTime() - (s.posted_days || 14) * 86400000)) },
  };
  const ranges = (s.sizes || []).reduce((a, id) => a.concat((SIZE_BANDS.find((b) => b.id === id) || { ranges: [] }).ranges), []);
  if (ranges.length) f.organization_num_employees_ranges = ranges;
  if ((s.keywords || []).length) f.q_organization_keyword_tags = s.keywords;
  if ((s.domains || []).length) f.q_organization_domains_list = s.domains;
  return f;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** One Apollo company row (either bucket) in one shape. */
function normalizeOrg(o) {
  const r = o || {};
  const domain = rule.normalizeDomain(r.primary_domain || r.domain || r.website_url);
  const phone = (r.primary_phone && (r.primary_phone.number || r.primary_phone.sanitized_number)) || r.phone || r.sanitized_phone || null;
  const city = txt(r.organization_city || r.city), state = txt(r.organization_state || r.state), country = txt(r.organization_country || r.country);
  return {
    // The "saved accounts" bucket carries the company's own id as organization_id and an ACCOUNT id as id.
    apollo_org_id: txt(r.organization_id || r.id) || null,
    saved_in_apollo: r.modality === 'account' || !!r.organization_id,
    name: txt(r.name),
    domain,
    website: txt(r.website_url) || (domain ? 'https://' + domain : ''),
    linkedin_url: rule.normalizeLinkedIn(r.linkedin_url) ? txt(r.linkedin_url).replace(/^http:/, 'https:') : '',
    phone: phone ? txt(phone) : '',
    address: txt(r.organization_raw_address || r.raw_address || r.street_address),
    city, state, country,
    employees: num(r.estimated_num_employees),
    revenue: txt(r.organization_revenue_printed),
    growth6: num(r.organization_headcount_six_month_growth),
    growth12: num(r.organization_headcount_twelve_month_growth),
    industry: txt(r.industry),
    sic: Array.isArray(r.sic_codes) ? r.sic_codes.map(String) : [],
    naics: Array.isArray(r.naics_codes) ? r.naics_codes.map(String) : [],
    founded_year: num(r.founded_year),
  };
}

// A staffing or recruiting firm is a competitor, not a client (the owner's choice, and lead-ingest.js says the same).
// SIC 7361 employment agencies and 7363 help supply, NAICS 5613xx employment services, then the name.
const STAFFING_NAME = /\b(staffing|recruit(ing|ers?|ment)?|talent (solutions|acquisition|partners)|workforce|personnel|headhunt\w*|employment (agency|services)|temp (agency|services)|manpower|search (firm|partners))\b/i;
function isStaffingFirm(org) {
  const o = org || {};
  if ((o.sic || []).some((c) => /^736[123]/.test(c))) return true;
  if ((o.naics || []).some((c) => /^5613/.test(c))) return true;
  return STAFFING_NAME.test(String(o.name || ''));
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (f) => Math.round(f * 100);

/**
 * The cheap ranking, from what the company search already says (opening a company's postings costs a credit, so
 * posting signals come later, when a card is opened). Growth is the main signal; a company that cannot be reached
 * (no phone, no LinkedIn, no website) sorts lower. The score only orders cards — it is never shown as a number.
 */
function scoreOrg(org, search) {
  const o = org || {};
  let score = 50;
  const chips = [];
  if (o.growth12 != null) {
    score += clamp(o.growth12 * 100, -20, 40) * 0.75;
    if (o.growth12 >= 0.05) chips.push('Headcount +' + pct(o.growth12) + '% in a year');
    else if (o.growth12 <= -0.05) chips.push('Headcount ' + pct(o.growth12) + '% in a year');
  }
  const band = (search && search.sizes && search.sizes.length === 1) ? SIZE_BANDS.find((b) => b.id === search.sizes[0]) : null;
  if (o.employees != null) {
    chips.push('About ' + o.employees.toLocaleString('en-US') + ' staff');
    if (band) {
      const [lo, hi] = [band.ranges[0], band.ranges[band.ranges.length - 1]].map((r, k) => Number(r.split(',')[k]));
      if (o.employees >= lo && o.employees <= hi) score += 10;
    }
  }
  if (o.phone) score += 4;
  if (o.linkedin_url) score += 3;
  if (o.website) score += 3;
  if (o.revenue) chips.push('Revenue ' + o.revenue);
  if (o.saved_in_apollo) chips.push('Already saved in your Apollo');
  return { score: Math.round(clamp(score, 0, 100) * 10) / 10, chips };
}

const BOARD_HOSTS = [[/linkedin\.com/i, 'LinkedIn'], [/indeed\.com/i, 'Indeed'], [/glassdoor\.com/i, 'Glassdoor'], [/ziprecruiter\.com/i, 'ZipRecruiter'], [/simplyhired\.com/i, 'SimplyHired'], [/monster\.com/i, 'Monster'], [/dice\.com/i, 'Dice']];
function sourceOf(url) {
  const u = txt(url);
  if (!u) return '';
  const hit = BOARD_HOSTS.find(([re]) => re.test(u));
  if (hit) return hit[1];
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

/** Apollo's postings, as the card shows them, newest first. */
function normalizePostings(list, now) {
  const at = new Date(now).getTime();
  return (Array.isArray(list) ? list : []).map((p) => {
    const posted = p && (p.posted_at || p.last_seen_at) ? new Date(p.posted_at || p.last_seen_at) : null;
    const t = posted && !isNaN(posted.getTime()) ? posted.getTime() : null;
    return {
      title: txt(p && p.title).slice(0, 200),
      url: /^https?:\/\//i.test(txt(p && p.url)) ? txt(p.url).slice(0, 600) : '',
      city: txt(p && p.city), state: txt(p && p.state), country: txt(p && p.country),
      posted_at: t ? new Date(t).toISOString() : null,
      age_days: t ? Math.max(0, Math.floor((at - t) / 86400000)) : null,
      source: sourceOf(p && p.url),
    };
  }).filter((p) => p.title).sort((a, b) => (a.age_days == null ? 9e9 : a.age_days) - (b.age_days == null ? 9e9 : b.age_days));
}

/** What the postings say about the company, in plain words (these are the "hard to fill / team build" signals). */
function postingSignals(postings) {
  const list = postings || [];
  if (!list.length) return { open_roles: 0, oldest_days: null, repeated: [], chips: [] };
  const ages = list.map((p) => p.age_days).filter((d) => d != null);
  const oldest = ages.length ? Math.max.apply(null, ages) : null;
  const counts = {};
  list.forEach((p) => { const k = p.title.toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
  const repeated = Object.keys(counts).filter((k) => counts[k] > 1).map((k) => ({ title: list.find((p) => p.title.toLowerCase() === k).title, times: counts[k] }));
  const chips = [list.length + ' open role' + (list.length === 1 ? '' : 's')];
  if (oldest != null && oldest >= 30) chips.push('Oldest open ' + oldest + ' days');
  repeated.forEach((r) => chips.push(r.title + ' posted ' + r.times + ' times'));
  return { open_roles: list.length, oldest_days: oldest, repeated, chips };
}

/** The facts an email can state truthfully when the posting TEXT cannot be read (never invented). */
function factsLines(org, postings) {
  const o = org || {}, sig = postingSignals(postings);
  const lines = [];
  if (sig.open_roles) lines.push(o.name + ' has ' + sig.open_roles + ' open role' + (sig.open_roles === 1 ? '' : 's') + (sig.oldest_days != null && sig.oldest_days >= 14 ? ', the oldest posted ' + sig.oldest_days + ' days ago' : '') + '.');
  if (o.growth12 != null && Math.abs(o.growth12) >= 0.05) lines.push('Headcount has ' + (o.growth12 > 0 ? 'grown ' : 'changed ') + pct(o.growth12) + '% in the last year.');
  sig.repeated.forEach((r) => lines.push('The ' + r.title + ' role has been posted ' + r.times + ' times.'));
  return lines;
}

// ── the meters and the switches (all in app_settings; none needs a migration) ──
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const creditKey = (orgId, now) => 'finder_credits_' + (orgId || 'default') + '_' + dayOf(now);
const revealKey = (userId, now) => 'finder_reveals_' + userId + '_' + dayOf(now);
const accessKey = (userId) => 'finder_user_' + userId;
/** { enabled, daily } from the stored JSON; anything unreadable is "not enabled". */
function readAccess(value) {
  let v = null;
  try { v = typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { v = null; }
  if (!v || typeof v !== 'object') return { enabled: false, daily: null };
  const d = Number(v.daily);
  return { enabled: v.enabled === true, daily: Number.isFinite(d) && d >= 0 ? Math.floor(d) : null };
}
const dailyFor = (access, orgDefault) => (access && access.daily != null ? access.daily : Math.max(0, Number(orgDefault) || 0));

/** A card on Wait comes back when its date arrives. */
const waitUntil = (now, days) => dayOf(new Date(new Date(now).getTime() + Math.max(1, Number(days) || 14) * 86400000));
const isDue = (card, now) => !!card && card.status === 'waiting' && !!card.wait_until && String(card.wait_until) <= dayOf(now);

/**
 * Which of a person's mailboxes a lead should default to: the one that has sent the FEWEST emails today (so a person
 * with several mailboxes rotates through them instead of every lead landing on the first), then the larger daily
 * limit, then the address (so the answer never depends on the order the database happens to return rows in).
 * `sentToday` is { mailboxId: n }. Returns an id, or null when there is none.
 */
function suggestMailbox(accounts, sentToday) {
  const list = (accounts || []).filter((a) => a && a.id);
  if (!list.length) return null;
  const sent = (a) => Number((sentToday || {})[a.id]) || 0;
  const limit = (a) => Number(a.daily_send_limit) || 150;
  return list.slice().sort((a, b) => sent(a) - sent(b) || limit(b) - limit(a) || String(a.email_address || '').localeCompare(String(b.email_address || '')))[0].id;
}

module.exports = {
  SECTORS, SIZE_BANDS, POSTED_CHOICES, LIMITS,
  normalizeSearch, apolloFilters, normalizeOrg, isStaffingFirm, scoreOrg,
  normalizePostings, postingSignals, factsLines, sourceOf,
  dayOf, creditKey, revealKey, accessKey, readAccess, dailyFor, waitUntil, isDue, suggestMailbox,
};
