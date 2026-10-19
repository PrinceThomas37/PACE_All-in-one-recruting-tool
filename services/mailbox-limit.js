// ============================================================================
// WHO MAY CHANGE A MAILBOX'S DAILY LIMIT, AND TO WHAT (owner, 19 Oct 2026, R-266).
// ----------------------------------------------------------------------------
// An admin or team lead may set any whole number of 1 or more — no top is typed here (D-0123); the admin decides. The person a
// mailbox belongs to may only LOWER it, never raise it (raising stays with the organisation). A number above the admin's own
// warning line (`daily_limit_warn_above`) still saves; the screen says plainly that Google / Microsoft may throttle it.
//
// PURE. `current` is what the mailbox has now (null/0 = none of its own, so the default applies and is passed as `fallback`).
// ============================================================================
'use strict';

function whole(v) {
  const n = Number(v);
  return Number.isFinite(n) && Math.floor(n) === n ? n : null;
}

/** → { ok:true, value, warn } or { ok:false, status, error } */
function decideLimitChange({ staff, owner, current, fallback, requested, warnAbove }) {
  const value = whole(requested);
  if (value === null || value < 1) return { ok: false, status: 400, error: 'The daily limit must be a whole number of 1 or more.' };
  if (!staff) {
    if (!owner) return { ok: false, status: 403, error: 'Only an admin or team lead can change a mailbox\'s daily limit.' };
    const now = whole(current) >= 1 ? Number(current) : Number(fallback);
    if (now >= 1 && value > now) return { ok: false, status: 403, error: 'You can lower your own daily limit, but only an admin can raise it.' };
  }
  const line = Number(warnAbove);
  const warn = line >= 1 && value > line
    ? `${value} a day is above ${line}. Gmail and Outlook may slow or flag a mailbox that sends this much, which can hurt the whole domain.`
    : null;
  return { ok: true, value, warn };
}

/** One readable row of the change log from a record_history row. */
function describeChange(row, who, mailbox) {
  const from = row && row.old_value && row.old_value.value != null ? Number(row.old_value.value) : null;
  const to = row && row.new_value && row.new_value.value != null ? Number(row.new_value.value) : null;
  return {
    at: row.created_at, mailbox_id: row.entity_id, mailbox: mailbox || null, by: who || null,
    from, to, note: row.note || null,
  };
}

module.exports = { decideLimitChange, describeChange };
