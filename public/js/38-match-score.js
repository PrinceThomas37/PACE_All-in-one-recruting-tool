// ===== CANDIDATE ↔ JOB MATCH SCORING =====
// A free, deterministic rule-based match score (0–100) between a candidate and a
// job order, so recruiters see best-fit candidates first. Uses data we already
// have (parsed skills, experience, work auth, title, location). No AI key
// required — an AI re-rank can be layered on later behind the same API.
//
// ONE FILE, TWO RUNTIMES. This module is loaded by the browser as a plain
// <script> (as it always was) AND required by the Node backend via
// match-engine.js. That is deliberate: the score shown in the grid and the score
// the server sorts by must be identical, and this codebase has already been
// bitten by the same rules living in several files at once (see the stage
// vocabulary note in CLAUDE.md — six copies to keep in sync). One file cannot
// drift from itself.
//
// Public API (identical in both runtimes):
//   matchScore(candidate, job) -> { score:Number|null, band, reasons:[] }
//   matchBadge(result)         -> small colored HTML pill
//   matchScoreValue(cand, job) -> Number (null → -1, for sorting)

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;                       // Node: require('./public/js/38-match-score.js')
  }
  if (root) {                                   // Browser: the globals the pages already call
    root.matchScore = api.matchScore;
    root.matchScoreValue = api.matchScoreValue;
    root.matchBadge = api.matchBadge;
    root.MATCH_ENGINE_VERSION = api.VERSION;
  }
})(typeof window !== 'undefined' ? window : null, function () {

  // Bump when the scoring rules change, so persisted scores can be spotted as
  // stale rather than silently compared against results from different rules.
  var VERSION = 1;

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  // tokenize a comma/slash/newline separated field into clean lowercase terms
  function tok(s){
    return String(s == null ? '' : s)
      .toLowerCase()
      .split(/[,;/|\n·•]+/)
      .map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length > 1; });
  }
  function num(v){ var n = parseFloat(v); return isNaN(n) ? null : n; }

  // a required skill is "met" if the candidate's skill/title text contains it (or
  // vice-versa) at word level — loose enough to catch "react" ↔ "react.js".
  function skillMet(req, candText){
    if (!req) return false;
    if (candText.indexOf(req) > -1) return true;
    // also succeed if the requirement is multi-word and all words appear
    var parts = req.split(/\s+/).filter(function (w) { return w.length > 2; });
    if (parts.length > 1 && parts.every(function (w) { return candText.indexOf(w) > -1; })) return true;
    return false;
  }

  function skillsSignal(cand, job){
    var primary = tok(job.primary_skills), secondary = tok(job.secondary_skills);
    if (!primary.length && !secondary.length) return null;                 // job lists no skills → skip
    var candText = ' ' + [cand.skills, cand.current_title, cand.headline].map(function (s) { return String(s || '').toLowerCase(); }).join(' , ') + ' ';
    var wP = 2, wS = 1, got = 0, need = primary.length * wP + secondary.length * wS, metCount = 0;
    primary.forEach(function (s) { if (skillMet(s, candText)) { got += wP; metCount++; } });
    secondary.forEach(function (s) { if (skillMet(s, candText)) { got += wS; metCount++; } });
    var totalReq = primary.length + secondary.length;
    return { weight: 0.5, value: need ? got / need : 0,
      reason: metCount + '/' + totalReq + ' skills' };
  }

  function experienceSignal(cand, job){
    var y = num(cand.experience_years); if (y === null) return null;
    var min = num(job.exp_min), max = num(job.exp_max);
    if (min === null && max === null) return null;
    var v = 1, note;
    if (min !== null && y < min) { v = Math.max(0.15, y / Math.max(min, 1)) * 0.85; note = y + ' yrs (needs ' + min + '+)'; }
    else if (max !== null && y > max) { v = 0.9; note = y + ' yrs (over ' + max + ')'; }
    else { v = 1; note = y + ' yrs ✓'; }
    return { weight: 0.2, value: v, reason: note };
  }

  function workAuthSignal(cand, job){
    var need = String(job.work_auth || '').trim().toLowerCase();
    if (!need) return null;
    var have = String(cand.work_authorization || '').trim().toLowerCase();
    if (!have) return { weight: 0.15, value: 0.5, reason: 'work auth unknown' };
    var ok = have === need || have.indexOf(need) > -1 || need.indexOf(have) > -1;
    return { weight: 0.15, value: ok ? 1 : 0.15, reason: ok ? 'work auth ✓' : 'work auth ≠' };
  }

  function titleSignal(cand, job){
    var jt = tok((job.job_title || '').replace(/\s+/g, ',')); // word tokens
    var ct = ' ' + [cand.current_title, cand.headline].join(' ').toLowerCase() + ' ';
    if (!jt.length || ct.trim().length < 2) return null;
    var hit = jt.filter(function (w) { return w.length > 2 && ct.indexOf(w) > -1; }).length;
    var denom = jt.filter(function (w) { return w.length > 2; }).length || 1;
    return { weight: 0.1, value: hit / denom, reason: 'title ' + Math.round((hit / denom) * 100) + '%' };
  }

  function locationSignal(cand, job){
    if (String(job.remote || '').toLowerCase().indexOf('remote') > -1) return null; // remote → location irrelevant
    var js = String(job.state || '').trim().toLowerCase();
    if (!js) return null;
    var cs = String(cand.state || '').trim().toLowerCase();
    if (!cs) return null;
    var same = cs === js;
    return { weight: 0.05, value: same ? 1 : 0.4, reason: same ? 'same state' : 'diff state' };
  }

  function matchScore(cand, job){
    cand = cand || {}; job = job || {};
    var signals = [ skillsSignal(cand, job), experienceSignal(cand, job), workAuthSignal(cand, job),
      titleSignal(cand, job), locationSignal(cand, job) ].filter(Boolean);
    if (!signals.length) return { score: null, band: 'none', reasons: [] };
    var totalW = signals.reduce(function (s, x) { return s + x.weight; }, 0);
    var acc = signals.reduce(function (s, x) { return s + x.weight * x.value; }, 0);
    var score = Math.round((acc / totalW) * 100);
    var band = score >= 75 ? 'strong' : score >= 50 ? 'good' : score >= 25 ? 'fair' : 'low';
    return { score: score, band: band, reasons: signals.map(function (x) { return x.reason; }) };
  }

  function matchScoreValue(cand, job){
    var r = matchScore(cand, job);
    return (r && r.score != null) ? r.score : -1;
  }

  var BAND = {
    strong: { c: '#fff', bg: 'var(--green)', label: 'Strong' },
    good:   { c: '#fff', bg: 'var(--amber)', label: 'Good' },
    fair:   { c: 'var(--text2)', bg: 'var(--bg)', label: 'Fair' },
    low:    { c: 'var(--text3)', bg: 'var(--bg)', label: 'Low' }
  };
  function matchBadge(result){
    if (!result || result.score == null) {
      return '<span style="font-size:11px;color:var(--text3)" title="Not enough job/candidate detail to score">—</span>';
    }
    var b = BAND[result.band] || BAND.fair;
    var tip = esc(result.reasons.join(' · '));
    return '<span title="' + tip + '" style="display:inline-block;min-width:58px;text-align:center;font-size:11px;font-weight:700;color:' + b.c +
      ';background:' + b.bg + ';border:1px solid var(--border);border-radius:10px;padding:2px 8px">' + result.score + '% ' + b.label + '</span>';
  }

  return {
    VERSION: VERSION,
    matchScore: matchScore,
    matchScoreValue: matchScoreValue,
    matchBadge: matchBadge
  };
});
