// ============================================================================
// A PERSON'S OWN SEQUENCE — what counts as having one, and the starter they can copy (owner, 8 Oct 2026, D-0104).
// ----------------------------------------------------------------------------
// PURE: no database, no clock. A "sequence" is the wording of the first email and its two follow-ups (and the days between),
// saved per person under u_<id>_tmpl_*. Until now a person who had saved nothing silently sent PACE's stock wording — which
// names Fute Global LLC. The owner's rule: a person must have their OWN sequence before they START outreach (a lead's first
// email, or the Lead Finder's "write the first email"); individual emails never need one; mail already queued still goes.
//
// The starter is the standard wording with the person's OWN company in it (said on a mailbox: "sends as"), saved as THEIR text,
// to be edited — never a silent fallback, and never another company's name.
// ============================================================================
const { DEFAULT_TEMPLATES, isLegacyTemplate } = require('../email-vars');

const STOCK_COMPANY = 'Fute Global LLC';
const TEMPLATE_KEYS = ['o1_subject', 'o1_body', 'fu1_subject', 'fu1_body', 'fu2_subject', 'fu2_body'];
const DEFAULT_DAYS = { fu1_day: '3', fu2_day: '7' };

/** Does this person have a sequence of their own? `settings` is a map of app_settings key → value. */
function hasOwnSequence(settings, userId) {
  const v = settings && settings[`u_${userId}_tmpl_o1_body`];
  const t = String(v == null ? '' : v).trim();
  return t.length > 20 && !isLegacyTemplate(t);
}

/** The keys (without the `u_<id>_` prefix) the starter writes: six wordings and the two follow-up days. */
function starterFor(company) {
  const co = String(company || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  if (!co) return null;
  const out = {};
  TEMPLATE_KEYS.forEach((k) => { out[`tmpl_${k}`] = String(DEFAULT_TEMPLATES[k] || '').split(STOCK_COMPANY).join(co); });
  Object.assign(out, DEFAULT_DAYS);
  return out;
}

/**
 * Group leads' owners who may NOT have outreach started for them yet.
 * `owners` is [{ id, name }], `settings` the map above. Returns the ids with their own sequence and the ones without.
 */
function splitBySequence(owners, settings) {
  const ok = [], needs = [];
  (owners || []).forEach((o) => { (hasOwnSequence(settings, o.id) ? ok : needs).push(o); });
  return { ok, needs };
}

module.exports = { hasOwnSequence, starterFor, splitBySequence, TEMPLATE_KEYS, STOCK_COMPANY, DEFAULT_DAYS };
