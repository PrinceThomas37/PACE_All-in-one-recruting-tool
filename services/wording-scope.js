// ============================================================================
// WHICH WORDING AN EMAIL ID SENDS — one for all of a person's email IDs, or one each (R-176, D-0111)
// ----------------------------------------------------------------------------
// The owner (8 Oct): "the outreach template that goes out is not particular for from email ID, just the signature is. If we have 2
// different company emails of the same person … the system chooses only one outreach for all the email IDs. Can we differentiate
// that part too." — and, on the blank-page worry: "there can be an option to select one email for all from email ID outreach or
// individual."
//
// Until now the wording was saved once per PERSON (`u_<id>_tmpl_<slot>_*`). Now a person chooses (`u_<id>_tmpl_scope`):
//   'all'   one wording for every email ID — exactly how it always worked (the default; nothing changes for anyone who never asks)
//   'each'  an email ID may have wording of its OWN (`ue_<mailboxId>_tmpl_<slot>_*`); an email ID with none falls back to the
//           person's wording, so choosing "each" never leaves a blank page and never stops an email going out
//
// Precedence, most specific first (the step's own text, from a sequence, still beats all of these — services/sequence-templates.js):
//   1. this email ID's own wording        (only when the person chose 'each')
//   2. the person's wording               u_<id>_tmpl_<slot>_*
//   3. the organisation's / the built-in default (the caller's existing fallbacks)
//
// PURE: no database, no clock. `settings` is a map of app_settings key → value, as everywhere else.
// ============================================================================
'use strict';
const { isLegacyTemplate } = require('../email-vars');

const SLOTS = ['o1', 'fu1', 'fu2', 'fu3', 'fu4', 'fu5'];
const FIELDS = SLOTS.reduce((a, s) => a.concat([`tmpl_${s}_subject`, `tmpl_${s}_body`]), []);

const scopeKey = (userId) => `u_${userId}_tmpl_scope`;
const mailboxKey = (mailboxId, field) => `ue_${mailboxId}_${field}`;
const personKey = (userId, field) => `u_${userId}_${field}`;

/** Did the person choose a wording for each email ID? Anything but the exact word 'each' is 'all'. */
function isEach(settings, userId) { return !!settings && settings[scopeKey(userId)] === 'each'; }

const text = (v) => String(v == null ? '' : v).trim();

/** This email ID's own wording for a field, or '' (also '' when the person has not chosen 'each' — a stored text is then dormant). */
function mailboxOwn(settings, userId, mailboxId, field) {
  if (!mailboxId || !isEach(settings, userId)) return '';
  return text(settings[mailboxKey(mailboxId, field)]) ? settings[mailboxKey(mailboxId, field)] : '';
}

/**
 * Does this email ID have a first email of its OWN (the same bar as a person's own sequence: a real text, not the old stock one)?
 * A person who chose 'each' and wrote it only for one email ID may start outreach from THAT email ID.
 */
function mailboxHasOwnSequence(settings, userId, mailboxId) {
  const v = text(mailboxOwn(settings, userId, mailboxId, 'tmpl_o1_body'));
  return v.length > 20 && !isLegacyTemplate(v);
}

/** The raw saved text to use for a field, before the caller applies its own default: the email ID's, else the person's, else the global key. */
function pickRaw(settings, { userId, mailboxId, field, globalKey }) {
  const own = mailboxOwn(settings, userId, mailboxId, field);
  if (own) return own;
  const mine = settings && settings[personKey(userId, field)];
  if (text(mine)) return mine;
  return globalKey && settings ? (settings[globalKey] || '') : '';
}

/** Every app_settings key a reader must load for these people and email IDs (the scope flag, and each email ID's six texts). */
function neededKeys(userIds, mailboxIds) {
  const out = [];
  (userIds || []).forEach((u) => { if (u) out.push(scopeKey(u)); });
  (mailboxIds || []).forEach((m) => { if (m) FIELDS.forEach((f) => out.push(mailboxKey(m, f))); });
  return out;
}

/**
 * A follow-up's wording for the email ID it goes out from.
 *   step      'fu1' … 'fu5'     resolve  the app's resolveTemplate (a saved value may be blank or a variant marker)
 *   defaults  DEFAULT_TEMPLATES (the last resort)
 *   strict    true = only the person's own text, no fallback of any kind (D-0114)
 * → { subject, body, own }  — `own` = this email ID has its own text for this step, so a random rotation must leave it alone.
 */
function followupTexts(settings, { userId, mailboxId, step, resolve, defaults, strict }) {
  // strict (D-0114): only what THIS PERSON wrote — never the organisation's or the built-in wording. Nothing written = '' (the caller skips).
  if (strict) {
    const own = (part) => text(pickRaw(settings, { userId, mailboxId, field: `tmpl_${step}_${part}`, globalKey: null }));
    return { subject: own('subject'), body: own('body'), own: !!mailboxOwn(settings, userId, mailboxId, `tmpl_${step}_body`) };
  }
  const res = typeof resolve === 'function' ? resolve : (v) => v;
  const one = (part) => {
    const field = `tmpl_${step}_${part}`;
    return res(pickRaw(settings, { userId, mailboxId, field, globalKey: `template_${step}_${part}` }), `${step}_${part}`) || (defaults || {})[`${step}_${part}`];
  };
  return { subject: one('subject'), body: one('body'), own: !!mailboxOwn(settings, userId, mailboxId, `tmpl_${step}_body`) };
}

module.exports = { followupTexts, SLOTS, FIELDS, scopeKey, mailboxKey, personKey, isEach, mailboxOwn, mailboxHasOwnSequence, pickRaw, neededKeys };
