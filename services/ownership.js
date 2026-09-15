// ============================================================================
// OWNERSHIP — whose work is this, and what may somebody else do about it?
// ----------------------------------------------------------------------------
// PURE. No db, no clock, no request. Everything is passed in, because who can
// see what is the one class of bug in this app that produces no error message
// and no visible symptom until a customer notices.
//
// WHY THIS EXISTS (Session 24, D-0020)
// The owner asked the question directly: *"reminders information is not just for
// one user who is responsible for it, its been showed to everyone and every user
// as a manager can interact with it… Maybe we can define what ownership or
// responsibility means."*
//
// It had never been defined. `/next-actions` scoped by the REPORTING CHAIN, so a
// manager's own daily list silently carried every report's reminders, unlabelled
// and mixed in with their own. Worse, each of those rows drew a **Done** button
// while the endpoint behind it correctly refused to close a reminder the caller
// does not own — so the button reported success, the toast said "Marked done",
// and the row came back on the next load. A thing you can see, appear to act on,
// and not actually change is worse than either showing it or hiding it.
//
// ── THE DEFINITION ──────────────────────────────────────────────────────────
// Every record has exactly ONE responsible person:
//
//     reminder / task   →  reminders.user_id        (who it was created for)
//     lead              →  jobs.assigned_to_bd
//     submission        →  submissions.recruiter_id
//     contact           →  the owner of the job it hangs off
//
// What ownership BUYS you: it appears on your daily list, and you can act on it.
// What it COSTS everyone else: nobody else's daily list carries your work, and
// nobody else can close it.
//
// A manager gets their own list, a COUNT of what is open beneath them, and a
// review screen where they can PROMPT the owner. They cannot do it for them.
// *Review and initiate* — the owner's own words — not reach in.
// ============================================================================

/**
 * Who is responsible for this queue item?
 *
 * `owner_id` is set by whichever builder produced the item (see next-action.js),
 * and is the reminder's user, the lead's BD, or the submission's recruiter. An
 * item with NO owner is nobody's work — it is treated as the viewer's, because
 * the alternative is a row that can never be seen or closed by anyone.
 */
function ownerOf(item, viewerId) {
  const owner = item && item.owner_id;
  return owner || viewerId || null;
}

/** Is this item the viewer's own work? */
function isMine(item, viewerId) {
  if (!viewerId) return false;
  return ownerOf(item, viewerId) === viewerId;
}

/**
 * Split a queue into what the viewer owns and what merely sits beneath them.
 *
 * Returns `{ mine, team }`. The DAILY LIST renders `mine` and nothing else;
 * `team` exists only to be counted and reviewed. That separation is the whole
 * decision — a to-do list containing other people's to-dos is not a to-do list.
 */
function splitByOwner(items, viewerId) {
  const mine = [];
  const team = [];
  for (const it of (items || [])) {
    (isMine(it, viewerId) ? mine : team).push(it);
  }
  return { mine, team };
}

/**
 * The one line a manager sees instead of their team's rows.
 *
 * `names` maps a user id to a display name. A count with no people named is
 * useless ("7 open across your team" — whose?), and naming everybody is a list
 * again, so it names up to three and counts the rest.
 */
function teamSummary(teamItems, names) {
  const items = teamItems || [];
  if (!items.length) return { total: 0, people: [], label: '', sentence: '' };

  const byOwner = new Map();
  for (const it of items) {
    const id = it.owner_id || 'unassigned';
    if (!byOwner.has(id)) byOwner.set(id, { owner_id: id, name: (names && names[id]) || 'Someone', count: 0 });
    byOwner.get(id).count += 1;
  }
  const people = [...byOwner.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  const total = items.length;

  const shown = people.slice(0, 3).map(p => `${p.name} (${p.count})`);
  const rest = people.length - shown.length;
  const who = shown.join(', ') + (rest > 0 ? `, and ${rest} other${rest === 1 ? '' : 's'}` : '');

  return {
    total,
    people,
    label: `${total} open across your team`,
    sentence: `${total} open across your team — ${who}.`
  };
}

/**
 * What may the viewer DO with this item?
 *
 * The only two answers are "act" (it is yours) and "prompt" (it is not). There
 * is deliberately no third answer that lets a manager close somebody else's
 * task: the case that would want it — somebody leaves, or goes on holiday — is
 * REASSIGNMENT, a change of who owns the record, and that is a different
 * feature with a different audit trail. See D-0020's "Re-open when".
 */
function actionsFor(item, viewerId) {
  return isMine(item, viewerId)
    ? { can_act: true, can_prompt: false, verb: 'act' }
    : { can_act: false, can_prompt: true, verb: 'prompt' };
}

/**
 * The note a prompt leaves on the owner's own list.
 *
 * It is written as a REMINDER for the owner — reusing the plumbing they already
 * read every morning rather than inventing a second inbox — and it always names
 * who asked. An anonymous "please action this" is how a nudge becomes noise.
 */
function promptNote({ fromName, title, subtitle, note }) {
  const who = String(fromName || 'Your manager').trim() || 'Your manager';
  const what = [title, subtitle].filter(Boolean).join(' · ');
  const lines = [`${who} asked you to pick this up.`];
  if (what) lines.push(what);
  if (note) lines.push(String(note));
  return lines.join('\n');
}

/**
 * May this viewer CLOSE this record? Returns null to allow, or the sentence to
 * refuse with.
 *
 * A FUNCTION rather than an `if` inside the route, for the reason already paid
 * for once this session (services/outreach-dedup.js callTaskSkipReason): a rule
 * pinned by grepping a route file for its condition goes on passing when that
 * condition is disabled with `if (false && …)`. A test that greps for source
 * text cannot tell a live rule from a dead one, so the rule lives where a test
 * can call it with real inputs.
 *
 * The refusal names what the viewer CAN do. "Not allowed" with no alternative is
 * how a person concludes the app is broken rather than that they asked for the
 * wrong thing.
 */
function closeRefusal(record, viewerId) {
  const owner = record && record.user_id;
  if (!owner || owner === viewerId) return null;
  return 'This reminder belongs to somebody else, so it is not yours to close. '
       + 'You can ask them to pick it up instead.';
}

module.exports = { ownerOf, isMine, splitByOwner, teamSummary, actionsFor, promptNote, closeRefusal };
