// ============================================================================
// A PERSON'S SENDING DAYS AND HOURS (owner, 8 Oct 2026, D-0104).
// ----------------------------------------------------------------------------
// PURE. The organisation sets the hours lead emails may go out (Admin → Settings: "start/stop sending", in the LEAD's local
// time). A person may NARROW that for their own mail — fewer days, a shorter day — never widen it, and never touch the daily
// number (that stays an admin's). Days are read in the lead's local time, like the hours.
//
// Stored per person in app_settings: u_<id>_send_days ("mon,tue,wed,thu,fri"), u_<id>_send_start_hour, u_<id>_send_end_hour.
// Nothing stored = the organisation's window unchanged (every existing person behaves exactly as before).
// ============================================================================
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

/** Read stored text into preferences: { days: [..]|null, start: int|null, end: int|null }. Anything unreadable is "not set". */
function readPrefs(raw) {
  const r = raw || {};
  let days = null;
  if (r.days != null && String(r.days).trim() !== '') {
    const set = String(r.days).toLowerCase().split(/[,\s]+/).filter((d) => DAYS.indexOf(d) >= 0);
    if (set.length) days = DAYS.filter((d) => set.indexOf(d) >= 0);
  }
  const hour = (v, lo, hi) => { if (v == null || String(v).trim() === '') return null; const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  return { days, start: hour(r.start, 0, 23), end: hour(r.end, 1, 24) };
}

/** What a person may save: at least one day, and a start before the end. Returns { prefs } or { error } in words. */
function checkPrefs(input) {
  const i = input || {};
  const list = Array.isArray(i.days) ? i.days : String(i.days == null ? '' : i.days).split(/[,\s]+/);
  const days = DAYS.filter((d) => list.map((x) => String(x).toLowerCase()).indexOf(d) >= 0);
  if (!days.length) return { error: 'Pick at least one day to send on.' };
  const s = Math.floor(Number(i.start)), e = Math.floor(Number(i.end));
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || s > 23 || e < 1 || e > 24) return { error: 'Hours are whole numbers: a start from 0 to 23 and a stop from 1 to 24.' };
  if (!(s < e)) return { error: 'The start hour must be earlier than the stop hour.' };
  return { prefs: { days, start: s, end: e } };
}

/**
 * The window a person's mail obeys: the organisation's, narrowed by their choice.
 * `org` = { start, end } (the organisation's hours). Returns { start, end, days|null, narrowed }.
 * If their hours do not overlap the organisation's at all, the organisation's hours are used (sending is never silently
 * switched off by a setting) and `conflict` says so.
 */
function effectiveWindow(org, prefs) {
  const o = { start: org && Number.isFinite(org.start) ? org.start : 8, end: org && Number.isFinite(org.end) ? org.end : 16 };
  const p = prefs || { days: null, start: null, end: null };
  const start = Math.max(o.start, p.start == null ? o.start : p.start);
  const end = Math.min(o.end, p.end == null ? o.end : p.end);
  const days = p.days && p.days.length < 7 ? p.days.slice() : null;
  if (!(start < end)) return { start: o.start, end: o.end, days, narrowed: !!days, conflict: true };
  return { start, end, days, narrowed: start !== o.start || end !== o.end || !!days };
}

/** Is `dayIndex` (0 = Sunday, in the lead's local time) allowed by the window? No restriction = every day. */
function dayAllowed(window, dayIndex) {
  if (!window || !window.days || !window.days.length) return true;
  return window.days.indexOf(DAYS[dayIndex]) >= 0;
}

/** The clock in a time zone: minutes since midnight and the weekday (0 = Sunday). `iana` is e.g. 'America/Chicago'. */
function localParts(iana, date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: iana, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const wd = DAYS.indexOf(get('weekday').toLowerCase().slice(0, 3));
  return { minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10), dayIndex: wd < 0 ? 0 : wd };
}

/** Is this moment inside the window, in that zone? (days first, then the hours) */
function isOpen(iana, date, window) {
  const w = window || { start: 8, end: 16 };
  const p = localParts(iana, date);
  if (!dayAllowed(w, p.dayIndex)) return false;
  return p.minutes >= w.start * 60 && p.minutes < w.end * 60;
}

module.exports = { DAYS, DAY_LABELS, readPrefs, checkPrefs, effectiveWindow, dayAllowed, localParts, isOpen };
