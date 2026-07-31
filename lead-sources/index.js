// lead-sources/ — free, ToS-clean employer job-board adapters.
//
// WHAT THESE ARE. Companies that run their own hiring on Greenhouse, Lever,
// Ashby, Workable, SmartRecruiters or Recruitee publish their open reqs as a
// public JSON endpoint. No key, no scraping, no terms violated — it is the feed
// the company's own careers page renders from. For a staffing desk targeting END
// CLIENTS (the owner's explicit choice), this is exactly the right signal: a
// company with a dozen open engineering reqs is a company that needs vendors.
//
// WHAT THESE ARE NOT. We do not scrape Indeed or LinkedIn. Their terms prohibit
// it, they actively block it, and a product we intend to sell cannot rest on it.
// That constraint is recorded in docs/AUTONOMOUS_ENGINE_PLAN.md and in
// config/sourcing.js, and it is not a limitation to engineer around.
//
// EVERY ADAPTER RETURNS THE SAME SHAPE, so the ingest pipeline never knows which
// board it is talking to:
//
//   { external_id, title, location, city, state, country, remote,
//     department, description, url, posted_at, company_name }
//
// A NOTE ON DEFENSIVENESS. These are third-party feeds that change without
// warning, and every field below is optional in at least one provider. Parsers
// therefore never assume a field exists, never throw on a shape they don't
// recognise, and skip individual malformed postings rather than failing the
// whole fetch — one bad row must not cost a company's entire board.

const { parseLocation } = require('./location');

// ── shared helpers ──────────────────────────────────────────────────────────

const str = (v) => (v == null ? '' : String(v)).trim();

// Decode HTML entities. `&amp;` is done LAST, or "&amp;lt;" would turn into "<"
// and reintroduce a tag that was never really there.
function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch { return _; } })
    .replace(/&amp;/gi, '&');
}

// Feeds return descriptions as HTML, and jd-parser wants text. Block-level tags
// become newlines so bullet structure survives — jd-parser's section detection
// (Required / Preferred / Responsibilities) keys off line breaks, and losing
// them costs us the skills.
//
// Entities are decoded BEFORE stripping tags because several providers —
// Greenhouse most notably — return the description with its markup escaped, so
// the tags arrive as "&lt;p&gt;". Stripping first would leave those as literal
// visible text in the description. They are decoded again afterwards to catch
// entities that were inside the text itself.
function htmlToText(html) {
  if (!html) return '';
  const withTags = decodeEntities(String(html));
  return decodeEntities(
    withTags
      .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(l => l.trim()).join('\n')
    .trim();
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Most feeds don't have a "remote" boolean; the location string carries it.
function isRemote(locationText, explicit) {
  if (typeof explicit === 'boolean') return explicit;
  return /\bremote\b|\bwork from home\b|\banywhere\b/i.test(str(locationText));
}

// Build one normalized posting, filling the location breakdown from whatever
// free-text the provider gave us. Returns null when there is nothing usable —
// a posting with no title is not a lead.
function normalize(raw) {
  const title = str(raw.title);
  if (!title) return null;
  const locationText = str(raw.location);
  const loc = parseLocation(locationText);
  return {
    external_id: str(raw.external_id) || null,
    title,
    location: locationText || null,
    city: raw.city || loc.city || null,
    state: raw.state || loc.state || null,
    country: raw.country || loc.country || null,
    remote: isRemote(locationText, raw.remote),
    department: str(raw.department) || null,
    description: str(raw.description) || '',
    url: str(raw.url) || null,
    posted_at: toDate(raw.posted_at),
    company_name: str(raw.company_name) || null
  };
}

// Run a provider's row parser over a list, dropping anything malformed rather
// than losing the whole board to one bad entry.
function mapRows(rows, fn) {
  const out = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    try {
      const n = normalize(fn(row) || {});
      if (n) out.push(n);
    } catch { /* skip this posting only */ }
  }
  return out;
}

// ── the adapters ────────────────────────────────────────────────────────────
// `url(token)` builds the public endpoint; `parse(payload)` normalizes it.
// `example` is shown in the UI so someone can tell what a board token looks like.

const PROVIDERS = {
  greenhouse: {
    id: 'greenhouse',
    label: 'Greenhouse',
    // content=true asks Greenhouse to include the full description, which we
    // need for skills and the hiring-reason signals.
    url: (token) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
    example: 'e.g. the "stripe" in job-boards.greenhouse.io/stripe',
    parse: (payload) => mapRows(payload && payload.jobs, (j) => ({
      external_id: j.id,
      title: j.title,
      location: j.location && j.location.name,
      description: htmlToText(j.content),
      url: j.absolute_url,
      posted_at: j.updated_at || j.first_published,
      department: (j.departments && j.departments[0] && j.departments[0].name) || null,
      company_name: j.company_name || null
    }))
  },

  lever: {
    id: 'lever',
    label: 'Lever',
    url: (token) => `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
    example: 'e.g. the "netflix" in jobs.lever.co/netflix',
    // Lever returns a bare array, and splits the body across description +
    // lists[] (Requirements, Responsibilities). The lists carry the bullets that
    // matter most for skills, so they're folded back in.
    parse: (payload) => mapRows(payload, (j) => {
      const lists = (j.lists || []).map(l =>
        `${str(l.text)}\n${htmlToText(l.content)}`).join('\n\n');
      return {
        external_id: j.id,
        title: j.text,
        location: (j.categories && j.categories.location) || null,
        department: (j.categories && (j.categories.department || j.categories.team)) || null,
        description: [htmlToText(j.descriptionPlain || j.description), lists].filter(Boolean).join('\n\n'),
        url: j.hostedUrl || j.applyUrl,
        posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        remote: (j.workplaceType || '').toLowerCase() === 'remote'
      };
    })
  },

  ashby: {
    id: 'ashby',
    label: 'Ashby',
    url: (token) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`,
    example: 'e.g. the "ramp" in jobs.ashbyhq.com/ramp',
    parse: (payload) => mapRows(payload && payload.jobs, (j) => ({
      external_id: j.id,
      title: j.title,
      location: j.location,
      department: j.department || j.team,
      description: htmlToText(j.descriptionHtml || j.descriptionPlain),
      url: j.jobUrl || j.applyUrl,
      posted_at: j.publishedAt,
      remote: j.isRemote
    }))
  },

  workable: {
    id: 'workable',
    label: 'Workable',
    url: (token) => `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`,
    example: 'e.g. the "myco" in apply.workable.com/myco',
    parse: (payload) => mapRows(payload && payload.jobs, (j) => ({
      external_id: j.shortcode || j.id,
      title: j.title,
      // Workable gives structured location rather than a string.
      location: [j.city, j.state, j.country].filter(Boolean).join(', ')
              || (j.location && [j.location.city, j.location.region, j.location.country].filter(Boolean).join(', ')),
      city: j.city || (j.location && j.location.city) || null,
      state: j.state || (j.location && j.location.region) || null,
      country: j.country || (j.location && j.location.country) || null,
      department: j.department,
      description: htmlToText([j.description, j.requirements].filter(Boolean).join('\n\n')),
      url: j.application_url || j.url || j.shortlink,
      posted_at: j.published_on || j.created_at,
      remote: j.telecommuting,
      company_name: (payload && payload.name) || null
    }))
  },

  smartrecruiters: {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    url: (token) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100`,
    example: 'e.g. the company id in careers.smartrecruiters.com/<id>',
    // NOTE: the list endpoint returns summaries without the full description.
    // The pipeline works from title + location alone here; the description is
    // fetched per-posting only if we later decide it's worth the extra calls.
    parse: (payload) => mapRows(payload && payload.content, (j) => ({
      external_id: j.id,
      title: j.name,
      location: j.location
        ? [j.location.city, j.location.region, j.location.country].filter(Boolean).join(', ')
        : null,
      city: j.location && j.location.city,
      state: j.location && j.location.region,
      country: j.location && j.location.country,
      remote: j.location && j.location.remote,
      department: j.department && j.department.label,
      description: htmlToText(j.jobAd && j.jobAd.sections && [
        j.jobAd.sections.companyDescription, j.jobAd.sections.jobDescription,
        j.jobAd.sections.qualifications
      ].filter(Boolean).map(s => s.text).join('\n\n')),
      url: j.applyUrl || (j.ref && j.ref.jobAd),
      posted_at: j.releasedDate || j.createdOn,
      company_name: j.company && j.company.name
    }))
  },

  recruitee: {
    id: 'recruitee',
    label: 'Recruitee',
    url: (token) => `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`,
    example: 'e.g. the "myco" in myco.recruitee.com',
    parse: (payload) => mapRows(payload && payload.offers, (j) => ({
      external_id: j.id,
      title: j.title,
      location: j.location || [j.city, j.country].filter(Boolean).join(', '),
      city: j.city, country: j.country,
      department: j.department,
      description: htmlToText([j.description, j.requirements].filter(Boolean).join('\n\n')),
      url: j.careers_url || j.url,
      posted_at: j.published_at || j.created_at,
      remote: j.remote
    }))
  }
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

function getProvider(id) { return PROVIDERS[String(id || '').toLowerCase()] || null; }

// What the settings UI lists. Deliberately excludes url/parse — the browser has
// no business knowing the endpoints.
function providerList() {
  return PROVIDER_IDS.map(id => ({
    id, label: PROVIDERS[id].label, example: PROVIDERS[id].example
  }));
}

// Fetch and normalize one board. Never throws for an expected failure — a dead
// board must not take down a nightly run over every other source.
async function fetchBoard(providerId, boardToken, opts = {}) {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Unknown provider "${providerId}"`, postings: [] };
  if (!str(boardToken)) return { ok: false, error: 'No board token configured', postings: [] };

  const url = provider.url(str(boardToken));
  const timeoutMs = opts.timeoutMs || 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await (opts.fetchImpl || fetch)(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'fute-lead-sourcing/1.0' }
    });
    if (!res.ok) {
      // 404 is the common, meaningful one: the board token is wrong or the
      // company moved off that provider. Say so plainly — it's the error the
      // person configuring a source will actually hit.
      return {
        ok: false, postings: [], status: res.status,
        error: res.status === 404
          ? `No public board found for "${boardToken}" on ${provider.label} — check the board name.`
          : `${provider.label} returned HTTP ${res.status}`
      };
    }
    const payload = await res.json();
    return { ok: true, url, postings: provider.parse(payload) || [], status: res.status };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || /abort/i.test(String(err.message)));
    return {
      ok: false, postings: [], url,
      error: aborted ? `${provider.label} did not respond within ${Math.round(timeoutMs / 1000)}s` : String(err.message || err)
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  PROVIDERS, PROVIDER_IDS, getProvider, providerList, fetchBoard,
  htmlToText, normalize        // exported for tests
};
