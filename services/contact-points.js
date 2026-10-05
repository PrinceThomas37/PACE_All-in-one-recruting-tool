'use strict';
// ============================================================================
// CONTACT POINTS — one MAIN email and phone per person, plus extras (R-114,
// D-0070). The ONE home for the rules; the candidate routes, the lead-contact
// routes, the résumé reader and every send path call these and never re-derive
// them.
//
//   row.email / row.phone                 the MAIN — every email goes here
//   row.extra_emails / row.extra_phones   jsonb lists of strings (migration 056)
//
// The main stays where it always was, so everything that reads `email` or
// `phone` keeps working. The extras never contain the main and never repeat.
// Switching the main is a swap inside ONE row, so it is one update.
//
// THE SAFETY RULE (the owner agreed it, D-0070): an address that opted out can
// never be made the main, and a send to a person checks ALL of their
// addresses — otherwise "someone who said stop" is one click away from being
// emailed on the address nobody checked.
// ============================================================================

const { emailSyntaxValid } = require('../email-validation');

const MAX_EXTRAS = 10;   // per kind; a person with more than ten numbers is a paste accident

const normEmail = (s) => String(s == null ? '' : s).trim().toLowerCase();
// Last 10 digits — the same normalisation the duplicate rule and migration 012's
// generated `phone_norm` column use, so "(555) 123-4567" and "+1 555.123.4567" are one number.
const normPhone = (s) => (String(s == null ? '' : s).match(/\d/g) || []).join('').slice(-10);
const digits = (s) => (String(s == null ? '' : s).match(/\d/g) || []).length;

function asList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    // a form or query string may send "a@x.com, b@y.com"
    return v.split(/[,;\n]/);
  }
  return [];
}

// ── cleaning ────────────────────────────────────────────────────────────────
// Returns { list, rejected } — `rejected` is what was dropped and why, so a
// caller can say it out loud instead of silently losing something the user typed.
function cleanEmailList(input, main) {
  const seen = new Set([normEmail(main)].filter(Boolean));
  const list = [], rejected = [];
  asList(input).forEach(function (raw) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) return;
    if (!emailSyntaxValid(v)) { rejected.push({ value: v, reason: 'not_an_email' }); return; }
    const n = normEmail(v);
    if (seen.has(n)) return;                  // the main, or a repeat — said nothing, nothing lost
    if (list.length >= MAX_EXTRAS) { rejected.push({ value: v, reason: 'too_many' }); return; }
    seen.add(n); list.push(n);                // emails are stored lower-case: the address is the same either way
  });
  return { list, rejected };
}

function cleanPhoneList(input, main) {
  const seen = new Set([normPhone(main)].filter(Boolean));
  const list = [], rejected = [];
  asList(input).forEach(function (raw) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) return;
    if (digits(v) < 7) { rejected.push({ value: v, reason: 'not_a_phone' }); return; }
    const n = normPhone(v);
    if (seen.has(n)) return;
    if (list.length >= MAX_EXTRAS) { rejected.push({ value: v, reason: 'too_many' }); return; }
    seen.add(n); list.push(v);                // phones keep the way the person wrote them
  });
  return { list, rejected };
}

// ── reading ─────────────────────────────────────────────────────────────────
function listOf(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x.trim(); }) : []; }

function allEmails(row) {
  row = row || {};
  const out = [], seen = new Set();
  [row.email].concat(listOf(row.extra_emails)).forEach(function (v) {
    const n = normEmail(v);
    if (n && !seen.has(n)) { seen.add(n); out.push(String(v).trim()); }
  });
  return out;
}
function allPhones(row) {
  row = row || {};
  const out = [], seen = new Set();
  [row.phone].concat(listOf(row.extra_phones)).forEach(function (v) {
    const n = normPhone(v);
    if (n && !seen.has(n)) { seen.add(n); out.push(String(v).trim()); }
  });
  return out;
}

// Do two people share ANY email or ANY phone number? (the duplicate rule, D-0070)
function sharesContactPoint(a, b) {
  const ea = new Set(allEmails(a).map(normEmail));
  const pa = new Set(allPhones(a).map(normPhone));
  return allEmails(b).some(function (x) { return ea.has(normEmail(x)); })
      || allPhones(b).some(function (x) { return pa.has(normPhone(x)); });
}

// ── switching the main ──────────────────────────────────────────────────────
// Swap the chosen extra into the main spot; the old main takes its place in the
// extras list. Returns the two columns to write, or null when `value` is not one
// of the person's extras (including when it already IS the main).
function makeMain(row, kind, value) {
  row = row || {};
  const isEmail = kind === 'email';
  const norm = isEmail ? normEmail : normPhone;
  const mainKey = isEmail ? 'email' : 'phone';
  const listKey = isEmail ? 'extra_emails' : 'extra_phones';
  const extras = listOf(row[listKey]);
  const at = extras.findIndex(function (x) { return norm(x) === norm(value); });
  if (at < 0) return null;
  const next = extras.slice();
  const chosen = next[at];
  if (row[mainKey] && String(row[mainKey]).trim()) next[at] = String(row[mainKey]).trim();
  else next.splice(at, 1);                    // no old main to put back
  const out = {};
  out[mainKey] = isEmail ? normEmail(chosen) : String(chosen).trim();
  out[listKey] = next;
  return out;
}

// ── opt-out (the safety rule) ───────────────────────────────────────────────
// `set` is a Set of LOWER-CASE suppressed addresses (what loadSuppressedSet returns).
// Returns the first of the person's addresses that opted out, or ''.
function firstSuppressed(row, set) {
  if (!set || !set.size) return '';
  const hit = allEmails(row).find(function (e) { return set.has(normEmail(e)); });
  return hit ? normEmail(hit) : '';
}

// ── what a résumé yields ────────────────────────────────────────────────────
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_IN_TEXT = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

// EVERY email and phone number in the text, in the order they appear, no repeats.
// The first of each is the usual main; the rest are offered to the user as extras
// to confirm (D-0070) — never added silently.
function extractContactPoints(text) {
  const t = String(text || '');
  const emails = [], phones = [];
  const eSeen = new Set(), pSeen = new Set();
  (t.match(EMAIL_IN_TEXT) || []).forEach(function (m) {
    const v = m.replace(/[.,;:]+$/, '');
    const n = normEmail(v);
    if (n && emailSyntaxValid(v) && !eSeen.has(n)) { eSeen.add(n); emails.push(n); }
  });
  (t.match(PHONE_IN_TEXT) || []).forEach(function (m) {
    const v = m.trim();
    const n = normPhone(v);
    if (n.length === 10 && !pSeen.has(n)) { pSeen.add(n); phones.push(v); }
  });
  return { emails: emails.slice(0, MAX_EXTRAS + 1), phones: phones.slice(0, MAX_EXTRAS + 1) };
}

// Everything a write needs, in one call. `src` is what the form sent, `prior` the
// row as it stands (nothing on a create). An extras list the form did NOT send is
// left alone — a caller that only knows about `email` must never wipe the extras —
// but is still checked against a NEW main, so an address that has just become the
// main stops being listed as an extra too.
function normaliseForWrite(src, prior) {
  src = src || {}; prior = prior || {};
  const out = {}, rejected = [];
  const tag = function (kind, r) { return r.map(function (x) { return Object.assign({ kind: kind }, x); }); };
  if (src.extra_emails !== undefined || src.email !== undefined) {
    const main = src.email !== undefined ? src.email : prior.email;
    const from = src.extra_emails !== undefined ? src.extra_emails : prior.extra_emails;
    const r = cleanEmailList(from, main);
    out.extra_emails = r.list; rejected.push.apply(rejected, tag('email', r.rejected));
  }
  if (src.extra_phones !== undefined || src.phone !== undefined) {
    const main = src.phone !== undefined ? src.phone : prior.phone;
    const from = src.extra_phones !== undefined ? src.extra_phones : prior.extra_phones;
    const r = cleanPhoneList(from, main);
    out.extra_phones = r.list; rejected.push.apply(rejected, tag('phone', r.rejected));
  }
  return { columns: out, rejected };
}

module.exports = {
  MAX_EXTRAS, normEmail, normPhone,
  cleanEmailList, cleanPhoneList, allEmails, allPhones, sharesContactPoint,
  makeMain, firstSuppressed, extractContactPoints, normaliseForWrite,
};
