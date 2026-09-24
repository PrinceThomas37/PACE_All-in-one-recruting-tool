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
const own = require('../services/ownership');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, withOrg, orgIdFor } = ctx;
  const { reportingChainIds } = require('../hierarchy')(supabase);

  // Bounded per source. Three unbounded selects merged in memory is the same
  // ageing bug this plan exists to remove, just moved to the server.
  const PER_SOURCE = 400;
  const PAGE = 25;

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // The leads engine's `emails` table is about a LEAD, so a viewer sees their
  // own sends plus anyone else's send on a lead they own (D-0034 canSeeEmail).
  // `email_tracking`/`candidate_outreach` aren't about a lead at all (a client
  // email, a one-off candidate email, a candidate batch), so — per
  // rampart.md's D1/D2, still open — they narrow to the sender's own scope
  // only for now: self + reporting chain, or the whole org for admin.
  async function scopeFor(req) {
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgIdFor(req));
    return own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
  }

  // The lead ids that make a THIRD PARTY's email visible to this viewer:
  // canSeeEmail's rule is "I sent it, OR the lead is OWNED (assigned_to_bd) in
  // my scope" — NOT canSeeLead's wider "created it / was assigned to research
  // it / pool". Using canSeeLead here was C-0021's review finding #2: it let
  // an RA read a BD's email body on a lead they merely researched, and let an
  // RA Lead read the old BD's mail on a recycled pool lead or on their own
  // RAs' leads — exactly what D-0036 forbids. Also returns the jobsById map so
  // the caller can run `own.scopeEmails` as the final gate over the merged
  // rows, rather than trusting the two SQL-narrowed queries alone.
  async function ownedJobMap(req, scope) {
    if (scope.all) return { ids: null, jobsById: null };
    const { data } = await withOrg(supabase.from('jobs')
      .select('id,assigned_to_bd').is('deleted_at', null), req);
    const jobsById = new Map();
    for (const j of (data || [])) jobsById.set(j.id, j);
    const ids = (data || []).filter(j => own.inScope(j.assigned_to_bd, scope)).map(j => j.id);
    return { ids, jobsById };
  }

  function normalise(row, source) {
    return {
      source,
      // NEVER row.token. A ledger fix (routes/tracking.js) found the same
      // fault: `email_tracking.token` is the bearer secret behind the open
      // pixel AND `POST /i/<token>/opt-out`, which writes the GLOBAL
      // suppression list — so handing it to the browser as a row's "id" let
      // anyone who can see this list opt a candidate out of every future role.
      // The real `id` column identifies the row just as well and is not a
      // credential.
      id: row.id || null,
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
      const scope = await scopeFor(req);

      // ── 1. the leads engine ────────────────────────────────────────────────
      // C-0021 #4 (D-0034): every user saw all three pipelines org-wide. This
      // one is ABOUT a lead, so canSeeEmail is "I sent it" OR "I own the lead
      // it was about" — two queries, each narrowed in SQL before its own
      // .limit() (never filtered after one), merged and de-duped by id so a
      // lead handed to a new BD still shows its history to its new owner.
      if (wants('leads')) {
        try {
          const LEAD_SELECT = 'id,to_email,from_email,subject,body,status,sent_at,created_at,job_id,contact_id';
          const base = () => {
            let sel = withOrg(supabase.from('emails').select(LEAD_SELECT), req);
            if (req.query.contact_id) sel = sel.eq('contact_id', req.query.contact_id);
            if (req.query.job_id) sel = sel.eq('job_id', req.query.job_id);
            return sel;
          };
          let rows = [];
          let jobsById = null;
          if (scope.all) {
            const { data, error } = await base().order('created_at', { ascending: false }).limit(PER_SOURCE);
            if (error) throw error;
            rows = data || [];
          } else {
            const ownIds = own.queryOwnerIds(scope) || [];
            const owned = await ownedJobMap(req, scope);
            const jobIds = owned.ids;
            jobsById = owned.jobsById;
            const queries = [];
            if (ownIds.length) queries.push(base().in('sent_by', ownIds).order('created_at', { ascending: false }).limit(PER_SOURCE));
            for (const part of chunk(jobIds || [], 200)) {
              queries.push(base().in('job_id', part).order('created_at', { ascending: false }).limit(PER_SOURCE));
            }
            const results = await Promise.all(queries);
            for (const r of results) { if (r.error) throw r.error; rows.push(...(r.data || [])); }
            const byId = new Map();
            for (const r of rows) byId.set(r.id, r);
            // Each query is SQL-narrowed by construction (sent_by IN the
            // viewer's own ids, or job_id IN leads OWNED in the viewer's
            // scope) — merged and capped here for speed. `own.scopeEmails` is
            // still run as the FINAL gate below, because the SQL narrowing is
            // the speed optimisation, not the rule; the predicate is the rule.
            rows = [...byId.values()]
              .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
              .slice(0, PER_SOURCE);
            rows = own.scopeEmails(rows, jobsById, scope);
          }
          for (const r of rows) {
            // Render before anything can show it. See the header note.
            const rendered = renderStoredEmail(r, null);
            out.push(normalise({ ...r, subject: rendered.subject, body: rendered.body }, 'leads'));
          }
        } catch (e) { sourceErrors.push('leads: ' + e.message); }
      }

      // ── 2. individual sends ────────────────────────────────────────────────
      // Not about a lead (a client email, a one-off candidate email) — scoped
      // to the SENDER's own D-0034 scope until D2 (rampart.md) says whether
      // these should also follow the client/candidate they were about.
      if (wants('individual')) {
        try {
          let sel = withOrg(supabase.from('email_tracking')
            .select('id,to_email,mailbox_email,subject,body,sent_at,opened_at,open_count,replied_at,channel,company_id,candidate_id,job_order_id,sent_by'), req);
          if (req.query.company_id) sel = sel.eq('company_id', req.query.company_id);
          if (req.query.candidate_id) sel = sel.eq('candidate_id', req.query.candidate_id);
          if (!scope.all) {
            const ids = own.queryOwnerIds(scope) || [];
            sel = sel.in('sent_by', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
          }
          const { data, error } = await sel.order('sent_at', { ascending: false }).limit(PER_SOURCE);
          if (error) throw error;
          for (const r of (data || [])) {
            // These are stored already-rendered (they were sent immediately),
            // but rendering again is a no-op and keeps one rule for all three.
            const rendered = renderStoredEmail(r, null);
            out.push(Object.assign(
              normalise({ ...r, subject: rendered.subject, body: rendered.body }, 'individual'),
              { channel: r.channel || null }
            ));
          }
        } catch (e) { sourceErrors.push('individual: ' + e.message); }
      }

      // ── 3. candidate outreach ──────────────────────────────────────────────
      if (wants('candidates')) {
        try {
          let sel = withOrg(supabase.from('candidate_outreach')
            .select('id,to_email,subject,body,status,send_after,sent_at,candidate_id,job_order_id,angle,engine,fail_reason,sent_by'), req);
          if (req.query.candidate_id) sel = sel.eq('candidate_id', req.query.candidate_id);
          if (!scope.all) {
            const ids = own.queryOwnerIds(scope) || [];
            sel = sel.in('sent_by', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
          }
          const { data, error } = await sel.order('send_after', { ascending: false }).limit(PER_SOURCE);
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
