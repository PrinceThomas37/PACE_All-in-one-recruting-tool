// ============================================================================
// WHAT KIND OF BOUNCE IS THIS — blocked or invalid? (owner, 29 Oct 2026)
//
// "You see here the email ID is blocked but it was marked as invalid." Until now every bounce notice marked the contact
// Invalid without reading WHY it bounced. Two different facts arrive as bounces:
//   * INVALID — the address does not exist (no such user, 5.1.1, address not found). Nobody is there.
//   * BLOCKED — the address is real, but their side refused our mail (550 … :blocked, 5.7.x policy, spam filter, a gateway).
//     contact-status.js keeps these apart on purpose: a blocked address still teaches its domain's format, and the person
//     can be reached another way.
// When a notice says both, "does not exist" wins (an address that is not there cannot be blocked). When it says neither,
// it stays Invalid, as before — the safe answer, nothing more is sent either way.
// PURE.
// ============================================================================
'use strict';

const INVALID_SIGNS = [
  /does ?n[o']t exist/i, /no such (user|mailbox|recipient|address)/i, /user ?unknown/i, /unknown (user|recipient|mailbox)/i,
  /address (was )?not found/i, /recipient (address )?not found/i, /mailbox (not found|unavailable|does not exist)/i,
  /\b5\.1\.(1|10|2)\b/, /invalid (recipient|mailbox|address)/i, /couldn'?t be found/i, /no such domain/i, /domain (not found|does not exist)/i,
  /account (has been )?(disabled|deleted|closed)/i, /address couldn'?t be found/i,
];
const BLOCKED_SIGNS = [
  /message (was )?blocked/i, /has been blocked/i, /:\s*blocked\b/i, /\bblocked\b/i, /\b5\.7\.\d+\b/,
  /(rejected|refused|denied) (by|due to|for) (policy|security|spam|content)/i, /policy (violation|reasons|rejection)/i,
  /\bspam\b/i, /block ?list|black ?list|blacklisted/i, /sender (denied|rejected|blocked)/i, /not (authori[sz]ed|permitted) to send/i,
  /reputation/i, /\bdmarc\b/i,
];

// 'blocked' | 'invalid' for one bounce notice's text.
function bounceKind(text) {
  const t = String(text || '');
  if (INVALID_SIGNS.some(re => re.test(t))) return 'invalid';
  if (BLOCKED_SIGNS.some(re => re.test(t))) return 'blocked';
  return 'invalid';
}

// A send REFUSED at the door (the provider said no while we were sending) — is it about this recipient, and which kind?
// null = not about the recipient (sign-in, throttling, our setup): the contact is left alone.
function refusalKind(errMsg) {
  const t = String(errMsg || '');
  if (!/\b55\d\b|5\.\d\.\d+|recipient|mailbox unavailable|rejected|blocked/i.test(t)) return null;
  if (/suppression|opted? ?out|unauthori[sz]ed|token|sign-in|quota|rate limit|throttl|too many/i.test(t)) return null;
  return bounceKind(t);
}

module.exports = { bounceKind, refusalKind };
