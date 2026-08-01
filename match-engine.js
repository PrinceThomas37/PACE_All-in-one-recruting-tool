// match-engine.js — the server side of candidate ↔ job relevance.
//
// The scoring rules themselves are NOT here. They live in
// public/js/38-match-score.js, which is written to load in both the browser and
// Node, and this module requires that same file. That is deliberate: the score a
// recruiter sees in the grid and the score the server sorts a whole pool by must
// be the same number, and this codebase has already been bitten by identical
// rules living in several files at once (CLAUDE.md documents the stage
// vocabulary existing in six places). One file cannot drift from itself.
//
// What this module adds on top of the shared scorer:
//   • rankCandidates()  — score a whole pool and sort it, which the browser
//                         cannot do because it never holds the whole pool.
//   • deriveJobSkills() — run the existing rule-based jd-parser over a job
//                         order's description to fill in the skill fields that
//                         are currently typed by hand.
//   • buildRequirement()— one normalized "what we are looking for" object, which
//                         is the single input both sourcing branches will search
//                         against later (see docs/AUTONOMOUS_ENGINE_PLAN.md).
//
// Everything here is rule-based and free. There is no AI dependency: the app has
// no funded API key, and an AI re-rank would sit behind this same interface.

const scorer = require('./public/js/38-match-score.js');
const jdParser = require('./jd-parser.js');

// ── scoring ──────────────────────────────────────────────────────────────────

function scoreCandidate(candidate, job) {
  return scorer.matchScore(candidate || {}, job || {});
}

// Score a pool against one job and sort best-first.
//
// Unscoreable candidates (score === null — not enough detail on either side)
// sort last rather than being dropped: a recruiter looking at their own database
// should still see everyone, just in a sensible order. `minScore` is opt-in for
// callers that genuinely want a shortlist.
function rankCandidates(candidates, job, opts = {}) {
  const { limit, minScore } = opts;
  const rows = (candidates || []).map(c => {
    const r = scoreCandidate(c, job);
    return {
      candidate: c,
      candidate_id: c && c.id,
      score: r.score,
      band: r.band,
      reasons: r.reasons
    };
  });

  const filtered = (minScore == null)
    ? rows
    : rows.filter(r => r.score != null && r.score >= minScore);

  filtered.sort((a, b) => {
    const av = a.score == null ? -1 : a.score;
    const bv = b.score == null ? -1 : b.score;
    if (bv !== av) return bv - av;
    // Stable, meaningful tiebreak so equal scores don't shuffle between reads.
    return String((a.candidate && a.candidate.full_name) || '')
      .localeCompare(String((b.candidate && b.candidate.full_name) || ''));
  });

  return (limit && limit > 0) ? filtered.slice(0, limit) : filtered;
}

// ── deriving what a job actually requires ────────────────────────────────────

// "5+ years", "3-7 years", "minimum of 8 years" → { min, max }
// Deliberately conservative: it only reads ranges and lower bounds that are
// explicitly about years, and returns nulls rather than guessing. A wrong
// exp_min is worse than an absent one, because experience carries 20% of the
// score and would quietly penalise good candidates.
function extractExperienceRange(text) {
  const s = String(text || '');
  let min = null, max = null;

  const range = s.match(/\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*years?\b/i);
  if (range) {
    min = parseInt(range[1], 10);
    max = parseInt(range[2], 10);
    if (min > max) { const t = min; min = max; max = t; }
    return { min, max };
  }

  const lower = s.match(/\b(?:minimum\s+of\s+|at\s+least\s+)?(\d{1,2})\s*\+\s*years?\b/i)
             || s.match(/\b(?:minimum\s+of\s+|at\s+least\s+)(\d{1,2})\s*years?\b/i);
  if (lower) min = parseInt(lower[1], 10);

  // Sanity bound — "20 years" is plausible, "99 years" is a parse artefact.
  if (min != null && (min < 0 || min > 40)) min = null;
  return { min, max };
}

// Parse a job order's description into the fields the scorer relies on.
//
// Returns ONLY fields worth writing, and never overwrites something a human
// typed — a BD's hand-entered skills beat the parser's guess every time. Caller
// decides whether to persist.
function deriveJobSkills(jobOrder) {
  const jo = jobOrder || {};
  const text = String(jo.job_description || '').trim();
  const out = {};
  if (!text) return out;

  let parsed;
  try {
    parsed = jdParser.parseJobDescription(text, jo.industry || null);
  } catch (err) {
    // The parser is ~1100 lines of regex over arbitrary pasted text. If it ever
    // throws on a strange JD, the job order must still save.
    return out;
  }

  const skills = (parsed && parsed.skills) || [];
  const blank = (v) => v == null || String(v).trim() === '';

  if (skills.length && blank(jo.primary_skills)) {
    // The parser already returns skills in priority order (required-section
    // bullets and "N years of X" phrases rank above preferred//nice-to-have),
    // so the leading few are the best available stand-in for "primary".
    out.primary_skills = skills.slice(0, 3).join(', ');
  }
  if (skills.length > 3 && blank(jo.secondary_skills)) {
    out.secondary_skills = skills.slice(3, 10).join(', ');
  }

  if (blank(jo.exp_min) && blank(jo.exp_max)) {
    const { min, max } = extractExperienceRange(text);
    if (min != null) out.exp_min = min;
    if (max != null) out.exp_max = max;
  }

  if (Object.keys(out).length) out.skills_source = 'jd_parser';
  return out;
}

// ── the shared requirement object ────────────────────────────────────────────

// One normalized description of "what we are looking for", derived from a job
// order today and from a free-text search box later. Both sourcing branches
// (find companies hiring for this / find people who match this) will search
// against this same shape, so it is defined once, here, before either exists.
//
// Stored as JSONB on job_orders.requirement, mirroring how jobs.research works.
function buildRequirement(jobOrder) {
  const jo = jobOrder || {};
  const list = (v) => String(v || '')
    .split(/[,;/|\n]+/).map(s => s.trim()).filter(s => s.length > 1);

  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  return {
    version: scorer.VERSION,
    title: jo.job_title || null,
    normalized_title: jo.job_title ? safeNormalizeTitle(jo.job_title) : null,
    skills: {
      primary: list(jo.primary_skills),
      secondary: list(jo.secondary_skills)
    },
    experience: { min: num(jo.exp_min), max: num(jo.exp_max) },
    location: {
      city: jo.city || null,
      state: jo.state || null,
      country: jo.country || null,
      zip: jo.zip || null,
      // Remote is free text in the DB ("No", "Hybrid", "100% Remote") — reduce
      // it to the one boolean the scorer and any future search actually need.
      remote: /remote/i.test(String(jo.remote || ''))
    },
    work_auth: jo.work_auth || null,
    clearance: jo.clearance || null,
    industry: jo.industry || null,
    domain: jo.domain || null,
    employment: { type: jo.job_type || null, level: jo.emp_level || null },
    rate: {
      currency: jo.pay_cur || null,
      min: num(jo.pay_min),
      max: num(jo.pay_max)
    },
    built_at: new Date().toISOString()
  };
}

// jd-parser's normalizeJobTitle returns a rich object ({normalized, tokens,
// canon, head}); the requirement only wants the canonical string, so unwrap it
// rather than storing the whole structure in JSONB.
function safeNormalizeTitle(t) {
  try {
    const n = jdParser.normalizeJobTitle(t);
    if (!n) return null;
    return typeof n === 'string' ? n : (n.normalized || null);
  } catch { return null; }
}

module.exports = {
  VERSION: scorer.VERSION,
  scoreCandidate,
  rankCandidates,
  deriveJobSkills,
  buildRequirement,
  extractExperienceRange   // exported for tests
};
