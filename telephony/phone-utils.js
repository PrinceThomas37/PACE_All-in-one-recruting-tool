// Shared by every telephony adapter — kept in one place so "how do we match a
// phone number" has exactly one answer, the same reasoning that keeps email
// reply-matching in one shared processInboundMessages instead of per-provider
// copies (see index.js).

/** Digits-only, last 10 — the same normalization candidates.phone_norm
 * already applies in Postgres (migration 012), kept here for JS-side
 * matching against contacts, which has no equivalent generated column. */
function last10Digits(phone) {
  return String(phone || '').replace(/[^0-9]/g, '').slice(-10);
}

module.exports = { last10Digits };
