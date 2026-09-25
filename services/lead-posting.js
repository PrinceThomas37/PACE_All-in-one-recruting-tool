// ============================================================================
// A LEAD'S JOB POSTING — the text the AI writes a first email from (R-056,
// D-0046). PURE: no db, no clock.
//
// Measured 2026-09-25: all 82 live leads carried only "Title: <position>" in
// `research.jd_raw` (median 34 characters), so every AI-written first email
// had nothing to be specific about. 80 of them link to LinkedIn / Indeed /
// SimplyHired / Glassdoor, which PACE cannot read (login walls, their terms),
// so the text arrives by a person pasting it — on the lead row, or as a
// "Job Description" column on import (which already works).
//
// "Does this lead have a posting?" is answered with the SAME rule the AI draft
// uses (engine-draft's postingOf + THIN_POSTING_CHARS), so the screen can
// never say "the AI has the posting" while the writer treats it as thin.
// ============================================================================
const { THIN_POSTING_CHARS, postingOf } = require('./engine-draft');

const POSTING_MAX_CHARS = 8000;   // same cap the lead-source import uses

const txt = (v) => String(v == null ? '' : v).trim();

function parseResearch(r) {
  if (r && typeof r === 'object') return r;
  if (typeof r === 'string') { try { const o = JSON.parse(r); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
  return {};
}

// The pasted part only — the "Title: X" line the importer writes is not a posting.
function postingBody(research) {
  const raw = txt(parseResearch(research).jd_raw);
  return raw.replace(/^Title:[^\n]*\n*/i, '').trim();
}

// What the screen says about a lead's posting.
function postingState(job) {
  const body = postingBody(job && job.research);
  const all = postingOf({ research: parseResearch(job && job.research), position: job && job.position });
  return {
    has_posting: all.length >= THIN_POSTING_CHARS,
    chars: body.length,
    words: body ? body.split(/\s+/).length : 0,
  };
}

// The research object to store after someone pastes (or clears) the posting.
// Keeps every other research field; keeps the "Title:" line first because the
// importer writes it that way and older readers expect it.
function withPosting(research, position, text) {
  const out = Object.assign({}, parseResearch(research));
  const body = txt(text).slice(0, POSTING_MAX_CHARS);
  const title = txt(position) ? 'Title: ' + txt(position) : '';
  out.jd_raw = [title, body].filter(Boolean).join('\n\n') || null;
  return out;
}

module.exports = { POSTING_MAX_CHARS, postingBody, postingState, withPosting };
