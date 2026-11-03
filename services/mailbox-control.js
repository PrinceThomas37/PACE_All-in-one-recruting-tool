'use strict';
// ============================================================================
// ONE MAILBOX, ONE PLACE TO ACT (owner, 3 Nov 2026, Deliverability → admin).
//
// The owner: "I need email ID search and an option to pause, start, block, deactivate, delete — not different sections. The details of that
// particular email ID: health, deliverability rate, bounce rate, open rate … so this window is the action window for each email ID."
// Answers (3 Nov): Block = locked (only an admin lifts it; also leaves warm-up); Start = start SENDING again, warm-up is its own switch.
//
// This file is PURE (no database, no clock): what state a mailbox is in, which actions are OFFERED for that state (a rule that decides whether an
// action is allowed lives where the action is offered — the screen draws only what this returns, the route re-checks with the same function), and
// the plain sentences. The route (routes/mailbox-control.js) does the reading and writing.
//
// STATES (one word each, most specific first):
//   deactivated — is_active is false: out of use, kept in the list so it can be started again
//   blocked     — locked by an admin: outreach and warm-up stop; only "Unblock" lifts it
//   paused      — an admin paused it (kind 'manual'): OUTREACH stops until Start
//   auto_paused — PACE paused it by itself (too many bounces): OUTREACH stops until Start
// WHAT A PAUSE STOPS (owner, 3 Nov 2026: "Pause means outreach is paused, not individual emailing or conversations"): the outreach engines — the lead send
// loop, sequences/workflows, candidate outreach — and warm-up. It does NOT stop a person writing an email one by one, replying in the inbox, or any
// conversation. That is how the code already behaves (only those engines read auto_paused_at); test/mailbox-control-smoke.mjs pins the list so an
// engine joining it, or the inbox ever joining it, is a decision, not an accident.
//   active      — can send
// Paused and blocked reuse user_emails.auto_paused_at because every send loop ALREADY refuses a mailbox that has it (index.js, recruiting/outreach.js);
// what KIND of pause it is lives in the pause note (app_settings, mailbox-alerts.saveNote) — no schema change, nothing new for the loops to learn.
// ============================================================================

const STATES = ['active', 'paused', 'auto_paused', 'blocked', 'deactivated'];
const STATE_LABEL = { active: 'Active', paused: 'Paused', auto_paused: 'Auto-paused', blocked: 'Blocked', deactivated: 'Deactivated' };

/** @param mb { is_active, auto_paused_at }   @param note the pause note (or null): { kind:'manual'|'blocked', by, at } | { bounces, sent, pct } */
function stateOf(mb, note) {
  if (!mb) return null;
  if (mb.is_active === false) return 'deactivated';
  if (mb.auto_paused_at) {
    if (note && note.kind === 'blocked') return 'blocked';
    if (note && note.kind === 'manual') return 'paused';
    return 'auto_paused';           // no note, or PACE's own bounce note
  }
  return 'active';
}

// What each state may do. `delete` is offered always (the route refuses with a reason when the mailbox has sent mail — better a clear
// sentence than a button that vanishes). Everything but Delete is a plain state change.
const OFFERED = {
  active:      ['pause', 'block', 'deactivate', 'delete'],
  paused:      ['start', 'block', 'deactivate', 'delete'],
  auto_paused: ['start', 'block', 'deactivate', 'delete'],
  blocked:     ['unblock', 'deactivate', 'delete'],     // Start is deliberately NOT offered: a blocked mailbox is unlocked first, on purpose
  deactivated: ['start', 'delete'],
};
const LABEL = { pause: 'Pause', start: 'Start', block: 'Block', unblock: 'Unblock', deactivate: 'Deactivate', delete: 'Delete' };
const ACTIONS = Object.keys(LABEL);

function actionsFor(state) { return (OFFERED[state] || []).map((a) => ({ action: a, label: LABEL[a], danger: a === 'delete' || a === 'block' || a === 'deactivate' })); }

/** Can this action be done from this state? { ok, error }. The error is a sentence for the person. */
function check(action, state) {
  if (!ACTIONS.includes(action)) return { ok: false, error: 'Unknown action.' };
  if (!state) return { ok: false, error: 'Mailbox not found.' };
  if (state === 'blocked' && action === 'start') return { ok: false, error: 'This mailbox is blocked. Unblock it first, then start it.' };
  if ((OFFERED[state] || []).includes(action)) return { ok: true };
  const why = {
    pause: state === 'active' ? '' : `It is already ${STATE_LABEL[state].toLowerCase()}.`,
    start: 'It is already sending.',
    unblock: 'It is not blocked.',
    block: state === 'deactivated' ? 'It is deactivated — start it before blocking it.' : 'It is already blocked.',
    deactivate: 'It is already deactivated.',
  }[action];
  return { ok: false, error: why || 'That is not possible from its current state.' };
}

/** The note kept beside a manual pause or a block. */
function noteFor(action, byName, nowIso) {
  return { kind: action === 'block' ? 'blocked' : 'manual', by: byName || 'an admin', at: nowIso };
}

function day(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
/** What to tell the person about a paused / blocked mailbox. Never invents numbers it does not have. */
function noteSentence(state, note) {
  if (state === 'blocked') return `Blocked by ${(note && note.by) || 'an admin'}${note && note.at ? ' on ' + day(note.at) : ''}. Nothing can be sent from it, outreach and emails written one by one alike, and it is out of warm-up until an admin unblocks it.`;
  if (state === 'paused') return `Paused by ${(note && note.by) || 'an admin'}${note && note.at ? ' on ' + day(note.at) : ''}. Outreach from it is stopped until it is started. Emails written one by one and replies still go.`;
  return null;
}

/**
 * Delete is permanent, and the database keeps a sent email tied to the mailbox that sent it. A mailbox that has sent (or is holding) mail
 * cannot be deleted without losing that history — say so and offer Deactivate, rather than "succeeding" without deleting anything.
 */
function deleteCheck({ emailCount, typedAddress, address }) {
  if (String(typedAddress || '').trim().toLowerCase() !== String(address || '').trim().toLowerCase()) {
    return { ok: false, status: 400, error: 'To delete it, type the mailbox address exactly as confirmation.' };
  }
  if (emailCount > 0) {
    return { ok: false, status: 409, error: `This mailbox has ${emailCount} email${emailCount === 1 ? '' : 's'} on record (sent or waiting). Deleting it would erase that history, so it is kept. Deactivate it instead — it stops being used and stays in the records.` };
  }
  return { ok: true };
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);   // nothing under a rate → null ("—"), never 0 %

/**
 * One line of health, from what is known. The bounce limit is the COMPANY'S own (the admin's setting) — no number is invented here.
 * @param o { state, connection:{status}, bounceRate, bounceLimitPct, sent }
 * @returns { level:'good'|'watch'|'bad'|'off', label, tips:[] }
 */
function healthOf(o) {
  const tips = [];
  if (o.state === 'deactivated') return { level: 'off', label: 'Not in use', tips: ['It is deactivated. Start it to use it again.'] };
  if (o.state === 'blocked') return { level: 'off', label: 'Blocked', tips: ['It is locked. Unblock it to use it again.'] };
  const c = o.connection || {};
  if (c.status === 'expired') tips.push('The sign-in has expired. Only the mailbox\'s owner can reconnect it (Email IDs).');
  if (c.status === 'none' && o.sent === 0) tips.push('It has never been connected, so nothing can be sent from it.');
  const over = o.bounceRate != null && o.bounceLimitPct > 0 && o.bounceRate >= o.bounceLimitPct;
  if (over) tips.push(`Its bounce rate (${o.bounceRate}%) is at or over your limit of ${o.bounceLimitPct}%.`);
  if (o.state === 'auto_paused') tips.push('PACE paused it by itself because of bounces. Start it again once the list behind it is cleaned.');
  if (o.state === 'paused') tips.push('Its outreach is paused. Emails written one by one and replies still go.');
  if (c.status === 'expired' || over || o.state === 'auto_paused') return { level: 'bad', label: c.status === 'expired' ? 'Sign-in expired' : over ? 'Bounce limit reached' : 'Auto-paused', tips };
  if (o.state === 'paused') return { level: 'watch', label: 'Paused', tips };
  if (c.status === 'none') return { level: 'watch', label: 'Not connected', tips };
  return { level: 'good', label: 'Healthy', tips };
}

/**
 * The detail numbers for one mailbox over a window.
 * Definitions are the ones PACE already uses (services/bd-insights.js), never a second copy:
 *   bounce rate = of the PEOPLE emailed from it, the share whose address is 'invalid' or 'blocked'      (null when nobody was emailed)
 *   open rate   = of the emails sent WITH open tracking, the share opened by someone who looks like the recipient (null when none tracked)
 *   reply rate  = of the PEOPLE emailed, the share who replied after we wrote
 * @param o { sent:[{id,contact_id,contact:{email_status,replied_at}}], failed, pending, tracking:[{open_count}], lastFailure }
 */
function statsOf(o, bounceKind) {
  const sent = o.sent || [];
  const people = new Map();
  sent.forEach((e) => { if (e.contact_id && !people.has(e.contact_id)) people.set(e.contact_id, e.contact || {}); });
  const emailed = people.size;
  const bounced = [...people.values()].filter((c) => bounceKind(c.email_status)).length;
  const replied = [...people.values()].filter((c) => c.replied_at).length;
  const tracked = (o.tracking || []).length;
  const opened = (o.tracking || []).filter((t) => Number(t.open_count) > 0).length;
  return {
    sent: sent.length, failed: o.failed || 0, pending: o.pending || 0,
    people_emailed: emailed, bounced, replied, tracked, opened,
    bounce_rate: pct(bounced, emailed), reply_rate: pct(replied, emailed), open_rate: pct(opened, tracked),
    fail_rate: pct(o.failed || 0, (o.failed || 0) + sent.length),
    last_failure: o.lastFailure || null,
  };
}

/** What to tell someone who tries to write an email one by one from a BLOCKED mailbox (owner 3 Nov 2026: Block stops those too). */
function blockedSendSentence(note) {
  return `This mailbox is blocked${note && note.by ? ' by ' + note.by : ''}${note && note.at ? ' on ' + day(note.at) : ''}. Nothing can be sent from it, including emails written one by one, until an admin unblocks it.`;
}

/** One sentence that says what Pause and Block do — shown on the card, so nobody has to guess (owner, 3 Nov 2026). */
const SCOPE_NOTE = 'Pause stops OUTREACH from this mailbox (sequences, bulk sends, candidate outreach) and its warm-up; the person can still write emails one by one, reply and hold conversations. Block stops all of that AND every email sent from it, one by one included, until an admin unblocks it.';

module.exports = { blockedSendSentence, SCOPE_NOTE, STATES, STATE_LABEL, ACTIONS, LABEL, stateOf, actionsFor, check, noteFor, noteSentence, deleteCheck, healthOf, statsOf, pct };
