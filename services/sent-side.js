'use strict';
// OUR SIDE OF THE CONVERSATION, READ FROM THE MAILBOX ITSELF (R-085).
//
// The owner: "An issue during AI summary of emails is that it is not able to read
// the emails as sent to the client. It is only reading incoming emails and the
// first outreach email. Nothing of the [replies] from our side. AI summary needs
// reading both to and fro."
//
// Why it was true: PACE stores what it SENDS from its own engines (`emails`,
// `email_tracking`) and what COMES IN (`conversation_messages`). A reply typed in
// the in-app mailbox, or straight from Gmail/Outlook, is stored nowhere PACE
// reads — and the mailbox rule is that nothing is mirrored into Postgres. So the
// summary saw them writing and never saw us answering.
//
// The fix keeps that rule: nothing is copied. When a summary (or the Emails tab)
// is asked for, this reads the SENT folder of the caller's own mailboxes, live,
// for the addresses on the lead — and hands back messages in the same shape as
// every other source, so nothing downstream has to know where they came from.
//
// Read-only and best-effort. A mailbox that cannot be read is COUNTED and SAID
// (`ok:false`, with a reason), never silently treated as "nothing was sent" —
// a summary written from half a conversation must know it is half.
//
// PURE of I/O: the provider, the clock and the text cleaners are handed in, so
// every branch is testable without a network.

const FOLDER = { Gmail: 'SENT', Microsoft: 'sentitems' };
const MAX_MAILBOXES = 3;     // a person has one or two; three bounds the worst case
const MAX_ADDRESSES = 5;     // people on the lead worth searching for
const PER_SEARCH = 10;       // newest sent items per mailbox × address
const MAX_BODIES = 8;        // bodies fetched per read — each is one provider call
const SAME_MESSAGE_MS = 30 * 60 * 1000;

const norm = (s) => String(s || '').trim().toLowerCase();
const normSubject = (s) => String(s || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();

// A leads-engine send is stored with a DATE only (`emails.sent_at` is a `date`,
// written as the UTC day of the send) — no time of day. Found 2026-10-02: the
// half-hour rule below could never match a midnight-UTC date to the real send
// time, so every leads email showed TWICE on a lead's Emails tab — once from
// PACE's record, once from the sender's Sent folder — and the date-only copy
// read as the previous day to anyone west of Greenwich.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDateOnly = (s) => DATE_ONLY_RE.test(String(s || '').trim());
const DAY_MS = 24 * 60 * 60 * 1000;

// Is this sent item already represented by a message PACE stored (the leads
// engine's own send, a tracked client email)? Three ways to be the same message:
//   1. the provider's own message id, kept on the row when it was sent (exact);
//   2. a stored send with a real time: same subject, same address, within half an hour;
//   3. a stored send with only a DATE: same subject, same address, and the real
//      send falls on that UTC day (the day PACE wrote). The subject must match
//      exactly (a "Re:" is a different email), because a whole day is a wide window.
function alreadyHave(item, have) {
  const subj = normSubject(item.subject), at = Date.parse(item.date || '');
  const rawSubj = String(item.subject || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const toList = [].concat(item.to || [], item.cc || []).map(a => norm(a && a.email)).filter(Boolean);
  const sameAddress = (h) => {
    const hto = norm(h.to);
    return !hto || toList.length === 0 || toList.includes(hto) || hto.split(/[,;\s]+/).some(x => toList.includes(x));
  };
  return (have || []).some(h => {
    if (h.message_id && item.id && String(h.message_id) === String(item.id)) return true;
    if (!Number.isFinite(at)) return false;
    if (isDateOnly(h.sent_at)) {
      const dayStart = Date.parse(String(h.sent_at).trim() + 'T00:00:00Z');
      const hSubj = String(h.subject || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (hSubj !== rawSubj) return false;
      // Half an hour of slack either side: the day is stamped when the send starts.
      return at >= dayStart - SAME_MESSAGE_MS && at < dayStart + DAY_MS + SAME_MESSAGE_MS && sameAddress(h);
    }
    if (normSubject(h.subject) !== subj) return false;
    const ht = Date.parse(h.sent_at || '');
    if (!Number.isFinite(ht) || Math.abs(at - ht) > SAME_MESSAGE_MS) return false;
    return sameAddress(h);
  });
}

/**
 * @param {object}   o
 * @param {object}   o.mail        createMailProvider(...) — { forMailbox(row) }
 * @param {object[]} o.mailboxes   the caller's OWN mailbox rows { id, email_address, platform }
 * @param {string[]} o.addresses   the lead's contact addresses
 * @param {object[]} o.have        outbound messages PACE already holds { sent_at, subject, to }
 * @param {function} o.trim        text for the AI (≤ a few hundred words)
 * @param {function} o.full        text for the reading view
 * @returns {Promise<{messages: object[], ok: boolean, reason: string|null, mailboxes_read: number, mailboxes_failed: number}>}
 */
async function readOurSide({ mail, mailboxes, addresses, have, trim, full }) {
  const boxes = (mailboxes || []).slice(0, MAX_MAILBOXES);
  const addrs = [...new Set((addresses || []).map(norm).filter(Boolean))].slice(0, MAX_ADDRESSES);
  if (!boxes.length) return { messages: [], ok: false, reason: 'no_mailbox', mailboxes_read: 0, mailboxes_failed: 0 };
  if (!addrs.length) return { messages: [], ok: true, reason: null, mailboxes_read: boxes.length, mailboxes_failed: 0 };

  const found = [];
  let read = 0, failed = 0;
  for (const mb of boxes) {
    let adapter;
    try { adapter = mail.forMailbox(mb); } catch (_) { failed++; continue; }
    let boxOk = true;
    for (const addr of addrs) {
      try {
        const page = await adapter.listMessages({ folderId: FOLDER[mb.platform] || FOLDER.Microsoft, q: addr, limit: PER_SEARCH });
        for (const m of (page && page.messages) || []) {
          if (!m || m.is_draft) continue;
          // A provider's search is loose (Gmail matches the word anywhere); only a
          // message actually ADDRESSED to this person is part of this conversation.
          const to = [].concat(m.to || [], m.cc || []).map(a => norm(a && a.email));
          if (!to.includes(addr)) continue;
          if (alreadyHave(m, have)) continue;
          if (found.some(f => f.mailbox.id === mb.id && f.m.id === m.id)) continue;
          found.push({ mailbox: mb, m, adapter });
        }
      } catch (_) { boxOk = false; }
    }
    if (boxOk) read++; else failed++;
  }

  found.sort((a, b) => String(b.m.date || '').localeCompare(String(a.m.date || '')));
  const messages = [];
  for (const f of found.slice(0, MAX_BODIES)) {
    try {
      const full_ = await f.adapter.getMessage(f.m.id);
      const html = (full_ && full_.body_html) || '';
      messages.push({
        id: 'mb:' + f.mailbox.id + ':' + f.m.id, source: 'mailbox', direction: 'outbound', sent_at: f.m.date,
        from: (f.m.from && f.m.from.email) || f.mailbox.email_address,
        to: (f.m.to || []).map(a => a && a.email).filter(Boolean).join(', '),
        subject: f.m.subject || '', text: trim(html), full: full(html), facts: null, person: null,
      });
    } catch (_) { failed++; }
  }
  // "ok" = we managed to read at least one mailbox and none of the searches we
  // needed threw. Anything less is reported, so the summary can say it is partial.
  const ok = read > 0 && failed === 0;
  return { messages, ok, reason: ok ? null : (read === 0 ? 'unreadable' : 'partial'), mailboxes_read: read, mailboxes_failed: failed };
}

module.exports = { readOurSide, alreadyHave, isDateOnly, normSubject, FOLDER, MAX_MAILBOXES, MAX_ADDRESSES, PER_SEARCH, MAX_BODIES };
