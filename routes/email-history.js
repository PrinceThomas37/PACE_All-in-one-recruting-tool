// ============================================================================
// EMAIL HISTORY — one window onto three pipelines. Item 5 of
// docs/AGEING_UI_PLAN.md.
// ----------------------------------------------------------------------------
// The owner's report (Session 23): "I cannot see the email preview of the sent
// emails to clients, also when I send individual emails it doesn't come in the
// pending section, like I feel the pipeline is different, also the pending
// emails to the candidates do not come in the pending tab."
//
// Every clause was correct. PACE has THREE email pipelines:
//
//   emails             leads engine — cold + follow-ups. QUEUED and drip-sent,
//                      so it appears in Pending and then in Sent.
//   email_tracking     individual sends — a client email, a one-off candidate
//                      email, an interview invite. Sends IMMEDIATELY, so there
//                      is nothing to pend; and the Sent tab reads `emails`, so
//                      it never showed up there either.
//   candidate_outreach candidate batches — its own queue, its own drip, its own
//                      send window (evenings/weekends, in the CANDIDATE's
//                      timezone). Deliberately separate: `emails` is welded to
//                      the leads engine and its send loop is the most
//                      load-bearing code in the app.
//
// The bodies of the second and third WERE being stored the whole time. They
// were simply never read back anywhere central — which is why "I cannot see
// what we sent" was true even though the text was on disk. This router is that
// read, and nothing more.
//
// READ-ONLY, ON PURPOSE. No send path, no status change, no queue mutation.
// Merging three pipelines for DISPLAY is safe; merging them for SENDING is how
// you break the one that already works.
//
// STORED BODIES ARE RENDERED. `emails.body` and `candidate_outreach.body` keep
// {{sender}}/{{senderemail}} unrendered because the mailbox that sends is
// resolved at send time (Session 14: 152 cold emails went out under the wrong
// name). Every reader must call renderStoredEmail first, and
// test/sender-identity-smoke.mjs greps this file to make sure it does.
// ============================================================================
const express = require('express');
const { renderStoredEmail } = require('../email-vars');
const horizon = require('../services/view-horizon');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, withOrg } = ctx;

  // Bounded per source. Three unbounded selects merged in memory is the same
  // ageing bug this plan exists to remove, just moved to the server.
  const PER_SOURCE = 400;
  const PAGE = 25;

  function normalise(row, source) {
    return {
      source,
      id: row.id || row.token || null,
      to_email: row.to_email || null,
      from_email: row.from_email || row.mailbox_email || null,
      subject: row.subject || '',
      body: row.body || '',
      status: row.status || 'sent',
      sent_at: row.sent_at || row.created_at || null,
      opened_at: row.opened_at || null,
      open_count: row.open_count || 0,
      replied_at: row.replied_at || null,
      job_id: row.job_id || null,
      contact_id: row.contact_id || null,
      candidate_id: row.candidate_id || null,
      company_id: row.company_id || null,
      job_order_id: row.job_order_id || null,
    };
  }

  // GET /email/history
  //   ?q=            search subject / recipient
  //   ?days=90       horizon; 0 = everything
  //   ?page=0
  //   ?source=       leads | individual | candidates (omit for all three)
  //   ?company_id= / ?candidate_id= / ?contact_id=   narrow to one record
  router.get('/email/history', auth, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      // A typed search reaches all of history — someone looking for a specific
      // message should not be silently limited to the last 90 days.
      const days = q ? 0
        : (req.query.days === undefined ? horizon.DEFAULT_HORIZON_DAYS : Number(req.query.days));
      const only = String(req.query.source || '').trim();
      const wants = (s) => !only || only === s;

      const out = [];
      const sourceErrors = [];

      // ── 1. the leads engine ────────────────────────────────────────────────
      if (wants('leads')) {
        try {
          let sel = withOrg(supabase.from('emails')
            .select('id,to_email,from_email,subject,body,status,sent_at,created_at,job_id,contact_id')
            .order('created_at', { ascending: false }).limit(PER_SOURCE), req);
          if (req.query.contact_id) sel = sel.eq('contact_id', req.query.contact_id);
          if (req.query.job_id) sel = sel.eq('job_id', req.query.job_id);
          const { data, error } = await sel;
          if (error) throw error;
          for (const r of (data || [])) {
            // Render before anything can show it. See the header note.
            const rendered = renderStoredEmail(r, null);
            out.push(normalise({ ...r, subject: rendered.subject, body: rendered.body }, 'leads'));
          }
        } catch (e) { sourceErrors.push('leads: ' + e.message); }
      }

      // ── 2. individual sends ────────────────────────────────────────────────
      if (wants('individual')) {
        try {
          let sel = withOrg(supabase.from('email_tracking')
            .select('token,to_email,mailbox_email,subject,body,sent_at,opened_at,open_count,replied_at,channel,company_id,candidate_id,job_order_id')
            .order('sent_at', { ascending: false }).limit(PER_SOURCE), req);
          if (req.query.company_id) sel = sel.eq('company_id', req.query.company_id);
          if (req.query.candidate_id) sel = sel.eq('candidate_id', req.query.candidate_id);
          const { data, error } = await sel;
          if (error) throw error;
          for (const r of (data || [])) {
            // These are stored already-rendered (they were sent immediately),
            // but rendering again is a no-op and keeps one rule for all three.
            const rendered = renderStoredEmail(r, null);
            out.push(Object.assign(
              normalise({ ...r, id: r.token, subject: rendered.subject, body: rendered.body }, 'individual'),
              { channel: r.channel || null }
            ));
          }
        } catch (e) { sourceErrors.push('individual: ' + e.message); }
      }

      // ── 3. candidate outreach ──────────────────────────────────────────────
      if (wants('candidates')) {
        try {
          let sel = withOrg(supabase.from('candidate_outreach')
            .select('id,to_email,subject,body,status,send_after,sent_at,candidate_id,job_order_id,angle,engine,fail_reason')
            .order('send_after', { ascending: false }).limit(PER_SOURCE), req);
          if (req.query.candidate_id) sel = sel.eq('candidate_id', req.query.candidate_id);
          const { data, error } = await sel;
          if (error) throw error;
          for (const r of (data || [])) {
            const rendered = renderStoredEmail(r, null);
            out.push(Object.assign(
              normalise({ ...r, sent_at: r.sent_at || r.send_after, subject: rendered.subject, body: rendered.body }, 'candidates'),
              { angle: r.angle || null, engine: r.engine || null, fail_reason: r.fail_reason || null,
                due_at: r.send_after || null }
            ));
          }
        } catch (e) { sourceErrors.push('candidates: ' + e.message); }
      }

      // A missing table must not empty the whole view — candidate_outreach
      // arrives with migration 042, and this endpoint has to be useful before
      // and after it. Partial results are reported as partial, never as none.
      let rows = out;
      if (q) {
        rows = rows.filter((r) =>
          String(r.subject).toLowerCase().includes(q) ||
          String(r.to_email).toLowerCase().includes(q));
      }

      const part = horizon.partitionForView(rows, {
        horizonDays: days,
        showAll: !days,
        dateOf: (r) => r.sent_at,
      });

      part.visible.sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')));

      const page = Math.max(0, Number(req.query.page) || 0);
      const start = page * PAGE;
      const slice = part.visible.slice(start, start + PAGE);

      res.json({
        items: slice,
        counts: part.counts,
        page,
        page_size: PAGE,
        pages: Math.max(1, Math.ceil(part.visible.length / PAGE)),
        horizon_days: days,
        by_source: {
          leads: rows.filter((r) => r.source === 'leads').length,
          individual: rows.filter((r) => r.source === 'individual').length,
          candidates: rows.filter((r) => r.source === 'candidates').length,
        },
        // Named honestly: a caller must be able to tell "nothing was sent" from
        // "one of the three could not be read".
        partial: sourceErrors.length > 0,
        source_errors: sourceErrors,
        capped_per_source: PER_SOURCE,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
