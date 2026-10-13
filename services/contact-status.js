// ============================================================================
// A CONTACT'S EMAIL STATUS — the one definition (owner, 13 Oct: "add Blocked to the email validity").
// ----------------------------------------------------------------------------
// valid          — mail goes to them.
// invalid        — the address does not work (bounced, dead domain, typo).
// deactivated    — the person has left or the mailbox is closed.
// blocked        — the address is RIGHT, but their side rejects our mail (their security team, a gateway, an allow-list). Mailing on
//                  only hurts the sender's reputation, so — like invalid and deactivated — nothing more is sent to this address.
//                  Unlike invalid, the address still teaches its domain's format, and the person can be tried another way.
// out_of_office  — a pause until the person's return date; it comes back by itself (services/ooo-return.js).
//
// Every place that asks "may we email this contact?" calls these functions, so a new status is added HERE and nowhere else.
// The list a person picks from (public/js/01-constants.js CONTACT_STATUSES) must agree with STATUSES — test/contact-status-smoke.mjs.
// PURE.
// ============================================================================
'use strict';

const STATUSES = ['valid', 'invalid', 'deactivated', 'blocked', 'out_of_office'];   // the order they are offered in
const LABELS = { valid: 'Valid', invalid: 'Invalid', deactivated: 'Deactivated', blocked: 'Blocked', out_of_office: 'Out of office' };

// Nothing more is sent, to any email type, until a person changes the status.
const NEVER_EMAIL = new Set(['invalid', 'deactivated', 'blocked']);
// Follow-ups also stop while someone is out of office (the pause ends by itself).
const NO_FOLLOWUPS = new Set([...NEVER_EMAIL, 'out_of_office']);
// An address that BOUNCED teaches nothing about its domain's format. A blocked one is a real address, so it still does.
const TEACHES_NOTHING = new Set(['invalid', 'deactivated']);

const norm = (s) => String(s == null || s === '' ? 'valid' : s).toLowerCase();

const isKnown = (s) => STATUSES.includes(s);
const neverEmail = (s) => NEVER_EMAIL.has(norm(s));
const blocksFollowups = (s) => NO_FOLLOWUPS.has(norm(s));
const teachesNothing = (s) => TEACHES_NOTHING.has(norm(s));
const label = (s) => LABELS[norm(s)] || String(s || '');

/** Why a send was refused, in words — said on the row so nobody wonders. */
function sentence(s) {
  const k = norm(s);
  if (k === 'blocked') return 'Not sent — this contact is marked Blocked: the address is right, but their side rejects our mail. Change the status if that has been sorted out.';
  if (k === 'deactivated') return 'Not sent — this contact is marked Deactivated.';
  if (k === 'invalid') return 'Not sent — this address is marked Invalid.';
  return 'Not sent — this contact is marked ' + label(k) + '.';
}

module.exports = { STATUSES, LABELS, NEVER_EMAIL, isKnown, neverEmail, blocksFollowups, teachesNothing, label, sentence, norm };
