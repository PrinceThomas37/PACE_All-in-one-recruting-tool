// ============================================================================
// WHO GETS AN AI-WRITTEN FIRST EMAIL (D-0117, R-177)
// ----------------------------------------------------------------------------
// The company has one switch (engine_ai_first_email, default on). Each person
// can say "same as the company", "on for me", or "off". When their wording is
// per email ID (wording-scope 'each'), that choice is per mailbox; otherwise
// it is one choice for the person. A missing row is "same as the company".
//
// Follow-ups are never decided here. The caller already knows this row is a
// first email. This does not change what the engine writer says — only whether
// it runs.
//
// PURE. `settings` is a map of app_settings key → value.
// ============================================================================
'use strict';

const CHOICES = ['company', 'on', 'off'];

const personKey = (userId) => `u_${userId}_ai_first`;
const mailboxKey = (mailboxId) => `ue_${mailboxId}_ai_first`;

function normalize(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (s === 'on' || s === '1' || s === 'true') return 'on';
  if (s === 'off' || s === '0' || s === 'false') return 'off';
  return 'company';
}

/** The choice that applies: the email ID's when wording is per email ID, otherwise the person's. */
function resolveChoice(settings, { userId, mailboxId, each }) {
  const map = settings || {};
  const raw = each && mailboxId ? map[mailboxKey(mailboxId)] : map[personKey(userId)];
  return normalize(raw);
}

function allows({ companyOn, choice }) {
  if (choice === 'on') return true;
  if (choice === 'off') return false;
  return !!companyOn;
}

/**
 * Should the send replace this first email with an AI draft?
 *   companyOn  the admin switch
 *   aiReady    a provider is configured (the badge on the list may pass true:
 *              it describes the switch, not whether a key is set)
 *   each       the person chose a wording per email ID
 *   isFirst    this row is a first email (follow-ups stay the person's wording)
 *   alreadyAi  a retry of a draft already written — never pay for a second one
 */
function shouldWriteFirst({ companyOn, aiReady, settings, userId, mailboxId, each, isFirst, alreadyAi }) {
  if (!aiReady || !isFirst || alreadyAi) return false;
  return allows({ companyOn, choice: resolveChoice(settings, { userId, mailboxId, each }) });
}

module.exports = { CHOICES, personKey, mailboxKey, normalize, resolveChoice, allows, shouldWriteFirst };
