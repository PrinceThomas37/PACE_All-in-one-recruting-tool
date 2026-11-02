// ============================================================================
// VERSIONS OF A PERSON'S OWN EMAILS, PICKED AT RANDOM PER LEAD (owner, 15 Oct 2026, D-0150 … D-0152, R-258; R-343 / D-0196).
// ----------------------------------------------------------------------------
// "I write it": the person writes each email of their sequence once; AI may write more VERSIONS of it (same facts, other
// words), and the engine picks one at random for each lead, so 200 emails a day are not 200 identical emails. The person's
// own text is version 1. Versions are stored beside it:
//   u_<id>_tmpl_<slot>_v2_subject / _v2_body … _v20_   (slot = o1, fu1 … fu5)
// HOW MANY (D-0196, owner 2 Nov 2026): "let the user choose the number, maybe 1,2,3,4 anything; keep the admin limit on the
// higher end". The admin's ceiling is the setting `sequence_versions_max` (config/settings.js, starts at 20); each person's own
// choice is u_<id>_versions_count (their own email included). No choice yet = "keep what they have": every saved version is used.
// A version with no body does not exist. PURE: no database; the random number is passed in so a test can pin it.
// ============================================================================
'use strict';

const MAX_TOTAL = 20;                                      // the most the admin's ceiling can be (settings max)
const EXTRA = Array.from({ length: MAX_TOTAL - 1 }, (_, i) => i + 2);   // v2 … v20 — version 1 is the person's own text
const SLOTS = ['o1', 'fu1', 'fu2', 'fu3', 'fu4', 'fu5'];

const key = (userId, slot, v, part) => `u_${userId}_tmpl_${slot}_v${v}_${part}`;
const countKey = (userId) => `u_${userId}_versions_count`;
const text = (x) => String(x == null ? '' : x);

/** A whole number in 1..ceiling, or null for "not chosen". */
function clampCount(n, ceiling) {
  const c = Math.max(1, Math.min(MAX_TOTAL, Math.floor(Number(ceiling) || MAX_TOTAL)));
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return null;
  return Math.min(v, c);
}

/** The person's own choice (their own email included), or null when they have not chosen. */
function chosenCount(settings, userId) {
  const raw = (settings || {})[countKey(userId)];
  return raw == null || raw === '' ? null : clampCount(raw, MAX_TOTAL);
}

/** Every app_settings key the versions of these people can live under (for loaders that read keys by name). */
function neededKeys(userIds, slots = SLOTS) {
  const out = [];
  (userIds || []).forEach((id) => {
    out.push(countKey(id));
    slots.forEach((s) => EXTRA.forEach((v) => { out.push(key(id, s, v, 'subject'), key(id, s, v, 'body')); }));
  });
  return out;
}

/** The extra versions this person saved for a slot: [{ v, subject, body }] — only ones with a body, at most (count − 1). */
function extraVersions(settings, userId, slot) {
  const m = settings || {};
  const list = EXTRA.map((v) => ({ v, subject: text(m[key(userId, slot, v, 'subject')]), body: text(m[key(userId, slot, v, 'body')]) }))
    .filter((x) => x.body.trim().length > 0);
  const n = chosenCount(m, userId);
  return n == null ? list : list.slice(0, n - 1);
}

/**
 * Pick the text a lead gets. `own` = { subject, body } (version 1, the person's own). An extra version without a subject keeps
 * the person's subject. `rand` is a number in [0, 1). Returns { subject, body, id } where id is 'own_v1' … 'own_v20'.
 */
function pick(settings, userId, slot, own, rand) {
  const all = [{ v: 1, subject: text(own && own.subject), body: text(own && own.body) }].concat(extraVersions(settings, userId, slot));
  const r = Number(rand);
  const i = all.length > 1 && r >= 0 && r < 1 ? Math.floor(r * all.length) : 0;
  const c = all[i];
  return { subject: c.subject.trim() ? c.subject : text(own && own.subject), body: c.body, id: 'own_v' + c.v };
}

/** The rows to save for one slot's versions: [{ subject, body }, …] → app_settings upserts; the rest are cleared (''). */
function rowsFor(userId, slot, versions, limit = EXTRA.length) {
  const room = Math.max(0, Math.min(EXTRA.length, Math.floor(Number(limit)) || 0));
  const list = (Array.isArray(versions) ? versions : []).filter((x) => x && text(x.body).trim()).slice(0, room);
  const rows = [];
  EXTRA.forEach((v, i) => {
    const x = list[i] || {};
    rows.push({ key: key(userId, slot, v, 'subject'), value: text(x.subject).slice(0, 300) });
    rows.push({ key: key(userId, slot, v, 'body'), value: text(x.body).slice(0, 6000) });
  });
  return rows;
}

module.exports = { MAX_TOTAL, EXTRA, SLOTS, key, countKey, clampCount, chosenCount, neededKeys, extraVersions, pick, rowsFor };
