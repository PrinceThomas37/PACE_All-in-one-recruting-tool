// ============================================================================
// VERSIONS OF A PERSON'S OWN EMAILS, PICKED AT RANDOM PER LEAD (owner, 15 Oct 2026, D-0150 … D-0152, R-258).
// ----------------------------------------------------------------------------
// "I write it": the person writes each email of their sequence once; AI may write one or two more VERSIONS of it (same facts,
// other words), and the engine picks one at random for each lead, so 200 emails a day are not 200 identical emails. The person's
// own text is version 1. Versions are stored beside it:
//   u_<id>_tmpl_<slot>_v2_subject / _v2_body, and _v3_  (slot = o1, fu1 … fu5)
// A version with no body does not exist. PURE: no database; the random number is passed in so a test can pin it.
// ============================================================================
'use strict';

const EXTRA = [2, 3];                                     // version 1 is the person's own text; up to two more
const SLOTS = ['o1', 'fu1', 'fu2', 'fu3', 'fu4', 'fu5'];

const key = (userId, slot, v, part) => `u_${userId}_tmpl_${slot}_v${v}_${part}`;
const text = (x) => String(x == null ? '' : x);

/** Every app_settings key the versions of these people can live under (for loaders that read keys by name). */
function neededKeys(userIds, slots = SLOTS) {
  const out = [];
  (userIds || []).forEach((id) => slots.forEach((s) => EXTRA.forEach((v) => { out.push(key(id, s, v, 'subject'), key(id, s, v, 'body')); })));
  return out;
}

/** The extra versions this person saved for a slot: [{ v, subject, body }] — only ones with a body. */
function extraVersions(settings, userId, slot) {
  const m = settings || {};
  return EXTRA.map((v) => ({ v, subject: text(m[key(userId, slot, v, 'subject')]), body: text(m[key(userId, slot, v, 'body')]) }))
    .filter((x) => x.body.trim().length > 0);
}

/**
 * Pick the text a lead gets. `own` = { subject, body } (version 1, the person's own). An extra version without a subject keeps
 * the person's subject. `rand` is a number in [0, 1). Returns { subject, body, id } where id is 'own_v1' | 'own_v2' | 'own_v3'.
 */
function pick(settings, userId, slot, own, rand) {
  const all = [{ v: 1, subject: text(own && own.subject), body: text(own && own.body) }].concat(extraVersions(settings, userId, slot));
  const r = Number(rand);
  const i = all.length > 1 && r >= 0 && r < 1 ? Math.floor(r * all.length) : 0;
  const c = all[i];
  return { subject: c.subject.trim() ? c.subject : text(own && own.subject), body: c.body, id: 'own_v' + c.v };
}

/** The rows to save for one slot's versions: [{ subject, body }, …] → app_settings upserts; missing ones are cleared (''). */
function rowsFor(userId, slot, versions) {
  const list = Array.isArray(versions) ? versions.slice(0, EXTRA.length) : [];
  const rows = [];
  EXTRA.forEach((v, i) => {
    const x = list[i] || {};
    rows.push({ key: key(userId, slot, v, 'subject'), value: text(x.subject).slice(0, 300) });
    rows.push({ key: key(userId, slot, v, 'body'), value: text(x.body).slice(0, 6000) });
  });
  return rows;
}

module.exports = { EXTRA, SLOTS, key, neededKeys, extraVersions, pick, rowsFor };
