// ============================================================================
// EMAIL TRACKING
// The public open-tracking pixel + a read endpoint for a candidate's email
// activity. The send paths write `email_tracking` rows (candidate, client,
// interview, sequence, outreach, candidate_outreach); this module only READS
// and counts opens — it never touches the live send code.
// ============================================================================
const express = require('express');
const { TRANSPARENT_GIF } = require('../email-tracking');
const { clientIp } = require('../middleware/rate-limit');
const ownership = require('../services/ownership');

// ── A CANDIDATE'S EMAIL ACTIVITY: THE ENVELOPE IS SHARED, THE LETTER IS NOT ──
// (Session 30, D-0034, contract C-0025.)
//
// The owner: *"emails belong to whoever they were generated for."* Before this,
// `GET /candidates/:id/email-activity` handed EVERY user in the org every
// recruiter's email to that candidate, bodies included, because it returned
// `select('*')` scoped by organisation only.
//
// Two halves, deliberately different:
//   * THE ENVELOPE — who it went to, who sent it, when, the subject, opened,
//     replied — stays visible to anyone in the org who can open the candidate.
//     That is what stops a second recruiter cold-emailing somebody a colleague
//     approached yesterday about the same role; hiding it would make a shared
//     candidate record actively dangerous to work from.
//   * THE LETTER — `body` — only when the viewer's scope covers the SENDER
//     (`ownership.canSeeEmail(row, null, scope)`: the sender, anyone they report
//     up to on `users.manager_id`, and an admin). This holds whichever way the
//     owner answers D1 (whether the candidate pool is shared), which is why it
//     did not wait for it.
//
// THE SUBJECT IS ENVELOPE, NOT LETTER — a judgement call, stated plainly. In
// every path that writes these rows it names the ROLE ("Interview scheduled: …
// — HVAC Technician", a sequence template, a candidate-outreach variant), and
// the role is exactly the fact a colleague needs to avoid a duplicate approach.
// If the owner reads the subject as part of the correspondence, add 'subject'
// to SENDER_ONLY and nothing else changes.
//
// `token` NEVER LEAVES THE SERVER. It is the bearer secret behind the pixel AND
// behind the candidate's answer page: `POST /i/<token>/opt-out` needs nothing
// else, and writes the GLOBAL suppression list. `select('*')` was handing it to
// every user in the org, so one colleague — or one compromised browser — could
// opt a candidate out of every future role with a single request. Nothing on
// screen reads it. The output is therefore built from an ALLOW-LIST, so a
// future `select('*')` still cannot put it back on the wire.
const ENVELOPE_FIELDS = Object.freeze([
  'id', 'channel', 'candidate_id', 'job_order_id', 'to_email', 'subject',
  'sent_by', 'mailbox_email', 'sent_at', 'opened_at', 'last_open_at',
  'open_count', 'replied_at',
]);
const SENDER_ONLY = Object.freeze(['body']);
const ACTIVITY_SELECT = [...ENVELOPE_FIELDS, ...SENDER_ONLY].join(',');

/**
 * The sentence shown where a withheld body would have been. It names who holds
 * the text and what the reader can still see, because "hidden" with no reason
 * reads as "lost" — and the card's existing fallback for a null body says the
 * text was never kept, which would be false here.
 */
function withheldNote(senderName) {
  const who = String(senderName || '').trim();
  return (who ? `Sent by ${who}.` : 'Sent by a colleague.')
    + ' Only the sender, whoever they report to and an admin can read what it said.'
    + ' You can still see when it went, and whether it was opened or answered.';
}

/**
 * One activity row as a given viewer may see it. PURE — callable from a test
 * with a fixture row and a scope, so the rule is pinned by behaviour rather
 * than by grepping this file for its condition.
 *
 * Returns the envelope, plus `body_visible`; `body` only when visible, and
 * `body_note` (the sentence above) when not. `body_visible: true` with a null
 * `body` still means "sent before PACE kept a copy" (migration 042) — the two
 * nulls are kept apart on purpose.
 */
function activityRowFor(row, scope, senderName) {
  const out = {};
  for (const k of ENVELOPE_FIELDS) out[k] = row && row[k] !== undefined ? row[k] : null;
  out.sender_name = senderName || null;
  const visible = ownership.canSeeEmail(row, null, scope);
  out.body_visible = visible;
  if (visible) {
    for (const k of SENDER_ONLY) out[k] = row && row[k] !== undefined ? row[k] : null;
  } else {
    for (const k of SENDER_ONLY) out[k] = null;
    out.body_note = withheldNote(senderName);
  }
  return out;
}

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, db, auth, orgIdFor, pixelLimiter } = ctx;
  const { reportingChainIds } = require('../hierarchy')(supabase);

  // Public tracking pixel — the recipient's email client requests this when the
  // message is opened. Always returns the gif (even for an unknown/blank token)
  // so nothing about our data is revealed, and an open is never allowed to error.
  router.get('/o/:token', async (req, res) => {
    const token = String(req.params.token || '').replace(/\.gif$/i, '').trim();
    // Rate limited by SKIPPING THE DB WORK, never by returning an error: a mail
    // client that gets a 429 instead of an image renders a broken-image box to
    // the recipient, which is worse than an uncounted open. Over the limit, the
    // pixel still returns — we just stop paying for the read+write.
    const withinLimit = pixelLimiter ? pixelLimiter.consume(`pixel:${clientIp(req)}`).allowed : true;
    try {
      if (token && withinLimit) {
        const { data } = await supabase.from('email_tracking')
          .select('id,open_count,opened_at').eq('token', token).maybeSingle();
        if (data) {
          const now = new Date();
          await supabase.from('email_tracking').update({
            open_count: (data.open_count || 0) + 1,
            opened_at: data.opened_at || now,
            last_open_at: now
          }).eq('id', data.id);
        }
      }
    } catch (_) { /* a tracking failure must never break the pixel */ }
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.end(TRANSPARENT_GIF);
  });

  // A candidate's tracked email activity — the profile's "Email activity" card.
  // See the header: envelope to the org, body to the sender's scope, never the
  // token. ORG SCOPING is by construction (db.forRequest stamps
  // `.eq('org_id', …)` on the select); `auth` has already refused an org-less
  // session wherever a second org can exist, so the org is always resolved.
  router.get('/candidates/:id/email-activity', auth, async (req, res) => {
    try {
      const scoped = db.forRequest(req);
      const { data, error } = await scoped.from('email_tracking').select(ACTIVITY_SELECT)
        .eq('candidate_id', req.params.id)
        .order('sent_at', { ascending: false })
        .limit(200);   // one candidate's history; bounded so one record cannot stall the card
      if (error) throw error;
      const rows = data || [];

      // The viewer's scope. FAIL CLOSED: if the chain cannot be read, the
      // viewer is judged as themselves alone (viewScope with no chain), never
      // as everybody. Admin needs no chain — the role alone is the whole org.
      const isAdmin = ownership.rolesOf(req.user || {}).includes('admin');
      let chain = null;
      if (!isAdmin && req.user && req.user.id) {
        try { chain = await reportingChainIds(req.user.id, orgIdFor(req)); }
        catch (_) { chain = null; }
      }
      const scope = ownership.viewScope({
        role: req.user && req.user.role, roles: req.user && req.user.roles,
        userId: req.user && req.user.id, chainIds: chain,
      });

      // Who sent each one, by name — one query, best-effort. A missing name
      // degrades to "a colleague"; it never fails the card.
      const names = {};
      const senderIds = [...new Set(rows.map(r => r.sent_by).filter(Boolean))];
      if (senderIds.length) {
        try {
          const { data: users } = await scoped.from('users').select('id,name').in('id', senderIds);
          (users || []).forEach(u => { names[u.id] = u.name; });
        } catch (_) { /* names are a courtesy, not the record */ }
      }

      res.json(rows.map(r => activityRowFor(r, scope, names[r.sent_by])));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};

// Exported for tests: the rule is a function, so it can be called with real
// inputs (a guard that greps this file for its condition cannot tell a live
// rule from a disabled one — CLAUDE.md, Session 24).
module.exports.activityRowFor = activityRowFor;
module.exports.withheldNote = withheldNote;
module.exports.ENVELOPE_FIELDS = ENVELOPE_FIELDS;
module.exports.SENDER_ONLY = SENDER_ONLY;
