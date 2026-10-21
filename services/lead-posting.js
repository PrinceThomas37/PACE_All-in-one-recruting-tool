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

// THE LEAD LIST CARRIES NO POSTING TEXT (R-301, 21 Oct). The pasted job description was 7.7 MB of the 8.7 MB of research on
// 1,479 leads, and every Jobs load (each tab, every 3 minutes) read, parsed and re-sent all of it: the watcher saw GET /jobs grow
// the server 65-110 MB each time. The list needs only to KNOW whether the AI has a posting, so a list copy keeps every other
// research field, drops `jd_raw`, marks that it did (`jd_raw_omitted`) and carries the same `posting` state the posting box shows.
// The text itself loads with the one lead (GET /jobs/:id) when someone opens it.
function forList(job) {
  if (!job || typeof job !== 'object') return job;
  const r = parseResearch(job.research);
  const posting = postingState(job);
  if (!txt(r.jd_raw)) return Object.assign({}, job, { posting });
  const research = Object.assign({}, r);
  delete research.jd_raw;
  research.jd_raw_omitted = true;
  return Object.assign({}, job, { research, posting });
}

// A research object written back from a list copy must never wipe the posting it never had: when `jd_raw` is absent, or marked
// omitted, the stored text is kept. An explicit value (including an empty one with no mark) is the person's edit and wins.
function keepStoredPosting(incoming, stored) {
  if (incoming == null) return incoming;
  const out = Object.assign({}, parseResearch(incoming));
  const omitted = out.jd_raw_omitted === true;
  delete out.jd_raw_omitted;
  const untouched = omitted ? !txt(out.jd_raw) : !Object.prototype.hasOwnProperty.call(out, 'jd_raw');
  if (untouched) {
    const prev = parseResearch(stored).jd_raw;
    if (prev !== undefined) out.jd_raw = prev; else delete out.jd_raw;
  }
  return out;
}

module.exports = { POSTING_MAX_CHARS, postingBody, postingState, withPosting, forList, keepStoredPosting };
