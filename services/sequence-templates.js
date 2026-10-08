// ============================================================================
// WHICH TEMPLATE A SEQUENCE'S EMAIL STEP SENDS — one place, testable.
// PURE. No db, no clock.
//
// The bug this exists for (Session 40, D-0077). A sequence's first email step is
// stored with `template_key: 'initial'`. A person's OWN first-outreach template
// (Email → Outreach Plan) is stored as `o1` (`u_<id>_tmpl_o1_*`), and the
// built-in defaults are `o1_*`, `fu1_*`, `fu2_*`. Nothing was ever stored as
// `initial_*`, so the live "Standard Sales Outreach" sequence — whose step 1 is
// `initial` — looked up four settings that do not exist and ended in
// `No template for key "initial"`: the first email of a sequence could not be
// written, whatever the person had saved as their Outreach 1.
//
// `initial` is the sequence's NAME for the first outreach; `o1` is where it
// lives. The alias is stated once, here, and every reader of a step's template
// goes through `settingKeys()` / `pickTemplate()`.
//
// Precedence, most specific first (unchanged from before, only the slot name):
//   1. the step's OWN subject/body (the person wrote this email for this step)
//   1b. the email ID's own wording (R-176) — only when the person chose "a wording for each email ID"; ue_<mailbox>_tmpl_<slot>_*
//   2. the person's own saved template  u_<id>_tmpl_<slot>_subject|body
//   3. the organisation's global one    template_<slot>_subject|body
//   4. the built-in default             DEFAULT_TEMPLATES[<slot>_subject|body]
// ============================================================================
'use strict';

const wording = require('./wording-scope');

const SLOT_ALIASES = { initial: 'o1' };

/** The storage slot for a step's template_key ('initial' → 'o1'; fu1/fu2 as they are). */
function slotFor(key) {
  const k = String(key || 'initial');
  return SLOT_ALIASES[k] || k;
}

/** The four app_settings keys to read for a step, in precedence order. */
function settingKeys(bdId, key, mailboxId) {
  const slot = slotFor(key);
  const keys = [`u_${bdId}_tmpl_${slot}_subject`, `u_${bdId}_tmpl_${slot}_body`, `template_${slot}_subject`, `template_${slot}_body`];
  // R-176: the person's choice ("a wording for each email ID") and the email ID's own two texts for this slot.
  if (mailboxId) keys.push(wording.scopeKey(bdId), wording.mailboxKey(mailboxId, `tmpl_${slot}_subject`), wording.mailboxKey(mailboxId, `tmpl_${slot}_body`));
  return keys;
}

/**
 * The subject and body a step sends, or the reason it cannot.
 *   cfg:      the step's config  { template_key, subject?, body? }
 *   settings: { [app_settings key]: value }  — rows read with settingKeys()
 *   defaults: DEFAULT_TEMPLATES
 *   resolve:  (saved, 'o1_subject') → string   — the app's resolveTemplate (a
 *             saved value may be blank or a variant marker)
 * → { subject, body, slot } or { error }
 */
function pickTemplate({ cfg, bdId, mailboxId, settings, defaults, resolve }) {
  const c = cfg || {};
  const slot = slotFor(c.template_key);
  const s = settings || {};
  const res = typeof resolve === 'function' ? resolve : (v) => v;
  let subject = c.subject, body = c.body;
  if (!subject || !body) {
    const raw = (field) => wording.pickRaw(s, { userId: bdId, mailboxId, field, globalKey: `template_${slot}_${field.split('_').pop()}` });
    subject = subject || res(raw(`tmpl_${slot}_subject`), `${slot}_subject`) || (defaults || {})[`${slot}_subject`];
    body = body || res(raw(`tmpl_${slot}_body`), `${slot}_body`) || (defaults || {})[`${slot}_body`];
  }
  if (!subject || !body) return { error: `There is no template called "${c.template_key || 'initial'}" — pick one of Outreach 1, Follow-up 1, Follow-up 2, or write this step's own email.` };
  return { subject, body, slot };
}

/** What the person sees for each key (the builder's dropdown). */
const TEMPLATE_CHOICES = [
  { key: 'initial', label: 'Outreach 1 — your first email' },
  { key: 'fu1', label: 'Follow-up 1' },
  { key: 'fu2', label: 'Follow-up 2' },
];

module.exports = { SLOT_ALIASES, slotFor, settingKeys, pickTemplate, TEMPLATE_CHOICES };
