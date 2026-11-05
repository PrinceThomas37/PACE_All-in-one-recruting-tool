'use strict';
// SEQUENCES MADE IN THE NEW BUILDER (R-269/R-270, D-0158/D-0159).
//
// The owner: the new sequence builder (My Setup → Write my sequence) is THE way to make a sequence — "+ New sequence",
// "Add to sequence" on leads, ticking candidates on a job — and a person keeps MANY named sequences. They are stored where
// named sequences always were (workflow_definitions + workflow_steps), so the engine that already sends them, stops them on a
// reply and rotates mailboxes keeps doing so; sequences made in the old window are left exactly as they are.
//
// A step the new builder wrote carries `config.builder = 'v2'`. Its shape: a first email and follow-ups, each with a subject,
// a body and up to two more VERSIONS (one is picked at random for each person); for candidates, `ai: true` on the first email
// means "AI writes each one" — the candidate writer builds it, and the written email is the backup.
//
// PURE: no database, no clock (the random source is handed in).

const sequenceDraft = require('./sequence-draft');

const BUILDER = 'v2';
// What a candidate email can be filled with (routes/recruiting/outreach.js buildCandidateVars) plus the sender, filled at send.
const CANDIDATE_VARS = new Set(['first_name', 'full_name', 'title', 'location', 'position', 'client', 'company', 'job_code', 'sender', 'senderemail']);
const LEAD_CHANNEL = 'email', CANDIDATE_CHANNEL = 'candidate_email';
const isCandidates = (entityType) => entityType === 'submission' || entityType === 'candidate';
// shortcut: this is only the fallback when a caller does not pass the admin's number. The routes always pass `maxVersions` — the admin's
// `sequence_versions_max` (config/settings.js, versions per step INCLUDING the step's own) — because no limit on a customer is typed in code
// (D-0123, D-0216). Upgrade: drop the fallback once every caller passes it.
const MAX_VERSIONS = 2;
const txt = (v) => String(v == null ? '' : v);

function allowedFor(entityType) { return isCandidates(entityType) ? CANDIDATE_VARS : sequenceDraft.ALLOWED_VARS; }
function varsIn(t) { const out = []; txt(t).replace(/{{\s*(\w+)\s*}}/g, (m, k) => { if (!out.includes(k)) out.push(k); return m; }); return out; }

/** Is this a sequence the new builder can open? Every step must be one it wrote. */
function isV2(def) { const st = (def && def.steps) || []; return st.length > 0 && st.every((s) => s && s.config && s.config.builder === BUILDER); }

/**
 * Why a v2 step list cannot be saved, in the person's words — or null. Run on the server for every step marked v2, so a hole in
 * an email is refused where it can be fixed, never sent (CLAUDE.md: a merge field is filled and then CHECKED).
 */
function problem(steps, entityType, opts) {
  const allowed = allowedFor(entityType);
  // versions per step INCLUDING the step's own words (the admin's `sequence_versions_max`); the old fixed "2 extra" only when none is passed
  const maxExtra = opts && Number.isInteger(opts.maxVersions) && opts.maxVersions >= 1 ? opts.maxVersions - 1 : MAX_VERSIONS;
  const v2 = (steps || []).filter((s) => s && s.config && s.config.builder === BUILDER);
  for (let i = 0; i < v2.length; i++) {
    const s = v2[i], c = s.config, label = i === 0 ? 'The first email' : `Follow-up ${i}`;
    const want = isCandidates(entityType) ? CANDIDATE_CHANNEL : LEAD_CHANNEL;
    if (s.channel !== want) return `${label}: this kind of sequence sends with "${want}".`;
    if (i === 0 && !txt(c.subject).trim()) return 'The first email needs a subject.';
    if (txt(c.body).trim().length < (i === 0 ? 20 : 5)) return `${label} has no text yet.`;
    const versions = Array.isArray(c.versions) ? c.versions : [];
    if (versions.length > maxExtra) return `${label}: at most ${maxExtra + 1} versions (this one's own words and ${maxExtra} more).`;
    const texts = [c.subject, c.body].concat(...versions.map((v) => [v && v.subject, v && v.body]));
    const bad = [...new Set([].concat(...texts.map(varsIn)))].filter((k) => !allowed.has(k));
    if (bad.length) return `${label}: PACE cannot fill ${bad.map((k) => '{{' + k + '}}').join(', ')}. Use "Add a detail" instead.`;
    if (c.ai && i > 0) return 'Only the first email can be written by AI.';
    if (c.ai && !isCandidates(entityType)) return 'For leads, "AI writes each one" is set in Your outreach (My Setup).';
  }
  return null;
}

/**
 * Versions on ANY step — also steps written in the older builder, which `problem` (v2 steps only) does not look at (R-383, D-0216).
 * Each step may carry `config.versions` [{subject?, body}]; at most `maxVersions` in all (its own words included); each needs text;
 * every {{field}} must be one PACE can fill. Returns the person's words, or null.
 */
function versionsProblem(steps, entityType, maxVersions) {
  const allowed = allowedFor(entityType);
  const maxExtra = Number.isInteger(maxVersions) && maxVersions >= 1 ? maxVersions - 1 : MAX_VERSIONS;
  const list = steps || [];
  for (let i = 0; i < list.length; i++) {
    const c = (list[i] && list[i].config) || {};
    if (!Array.isArray(c.versions) || !c.versions.length) continue;
    const label = i === 0 ? 'The first email' : `Follow-up ${i}`;
    if (c.versions.length > maxExtra) return `${label}: at most ${maxExtra + 1} versions in all (its own words and ${maxExtra} more).`;
    for (let k = 0; k < c.versions.length; k++) {
      const v = c.versions[k] || {};
      if (!txt(v.body).trim()) return `${label}, version ${k + 2} has no text — write it or remove it.`;
      const bad = [...new Set([].concat(varsIn(v.subject), varsIn(v.body)))].filter((f) => !allowed.has(f));
      if (bad.length) return `${label}, version ${k + 2}: PACE cannot fill ${bad.map((f) => '{{' + f + '}}').join(', ')}.`;
    }
  }
  return null;
}

/** The subject and body to send: the step's own, or one of its versions, picked at random. A version with no subject keeps the step's. */
function pickVersion(cfg, rand = Math.random) {
  const c = cfg || {};
  const list = [{ subject: c.subject, body: c.body }].concat((Array.isArray(c.versions) ? c.versions : []).filter((v) => v && txt(v.body).trim()));
  const at = list.length > 1 ? Math.min(list.length - 1, Math.floor(rand() * list.length)) : 0;
  const v = list[at];
  return { subject: txt(v.subject).trim() ? v.subject : c.subject, body: v.body, version: at + 1, versions: list.length };
}

/**
 * WHICH EMAIL A CANDIDATE STEP SENDS — one rule, callable (the channel in routes/recruiting/outreach.js calls it; the test drives it).
 *   1. the step's own words, or one of its versions at random, filled for this candidate (or the house default when blank);
 *   2. with `ai` on and a job attached, the candidate writer's email instead — when it returns one (it is checked inside);
 *   3. the sender filled from the MAILBOX that sends; then every merge field must be filled — a hole is refused, never sent.
 * io = { fill(text, vars), render({subject, body}) → {subject, body}, unresolved(text) → [names], aiWrite() → {subject, prose, panelHtml}|null, rand }
 */
async function composeCandidateStep({ cfg, defaults, vars, hasJob }, io) {
  const c = cfg || {}, d = defaults || {};
  const picked = (c.subject && c.body && Array.isArray(c.versions) && c.versions.length) ? pickVersion(c, io.rand) : { subject: c.subject, body: c.body };
  let subject = io.fill(picked.subject || d.subject, vars), body = io.fill(picked.body || d.body, vars), panelHtml = '', writtenBy = 'written';
  if (c.ai && hasJob) {
    let ai = null; try { ai = await io.aiWrite(); } catch (_) { ai = null; }
    if (ai && txt(ai.subject).trim() && txt(ai.prose).trim()) { subject = ai.subject; body = ai.prose; panelHtml = ai.panelHtml || ''; writtenBy = 'ai'; }
  }
  const r = io.render({ subject, body });
  const holes = io.unresolved(r.subject + ' ' + r.body);
  if (holes.length) return { ok: false, error: 'PACE could not fill ' + holes.map((k) => '{{' + k + '}}').join(', ') };
  return { ok: true, subject: r.subject, body: r.body, panelHtml, writtenBy };
}

module.exports = { BUILDER, versionsProblem, composeCandidateStep, CANDIDATE_VARS, LEAD_CHANNEL, CANDIDATE_CHANNEL, MAX_VERSIONS, isCandidates, allowedFor, isV2, problem, pickVersion };
