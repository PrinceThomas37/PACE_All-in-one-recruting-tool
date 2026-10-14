// WHO YOU HAVE WRITTEN TO BEFORE — the suggestions under the To / Cc box (owner, 14 Oct: "when an email ID is typed in the compose, reply,
// forward or reply-all bar, there should be auto suggest if the email ID was typed previously, like Gmail or Outlook").
//
// Nothing is stored: the in-app mailbox mirrors nothing into Postgres (CLAUDE.md). The list is read from the mailbox's OWN Sent folder —
// the people the person actually wrote to, newest first — held in memory for a few minutes by the route, never kept. How far back it
// looks is the admin's number (`mailbox_recipient_lookback`, D-0123), not a number typed here.
//
// PURE: messages in (as the mail provider returns them), people out.
//   collectRecipients(messages, ownAddresses) → [{ email, name, last, times }] — one entry per address, newest first.
// A name is kept only when the message carried one that is not just the address again; the most recent usable name wins. The mailbox's
// own addresses are never suggested to itself.

const norm = (e) => String(e || '').trim().toLowerCase();
const looksLikeAddress = (e) => /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(e);

function collectRecipients(messages, ownAddresses) {
  const own = new Set((ownAddresses || []).map(norm));
  const byEmail = new Map();
  const sorted = (messages || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  for (const m of sorted) {
    for (const p of [].concat(m.to || [], m.cc || [])) {
      const email = norm(p && p.email);
      if (!email || !looksLikeAddress(email) || own.has(email)) continue;
      const name = String((p && p.name) || '').trim();
      const usable = name && norm(name) !== email ? name : '';
      const hit = byEmail.get(email);
      if (hit) { hit.times++; if (!hit.name && usable) hit.name = usable; }
      else byEmail.set(email, { email, name: usable, last: m.date || null, times: 1 });
    }
  }
  return [...byEmail.values()];
}

module.exports = { collectRecipients };
