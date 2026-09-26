// ============================================================================
// MAILBOX SIGN-IN ALERTS — GET /mailboxes/alerts (R-037)
//
// Which of the mailboxes this person should know about have a dead or
// probably-dead sign-in, and how much mail is stuck behind each. The rules
// (what counts, what it says) are services/mailbox-alerts.js; this is the IO.
//
// WHO SEES WHAT (D-0034): your own mailboxes; a manager also sees their
// reporting chain's (a dead mailbox stops a report's outreach, and the manager
// is the one who notices the numbers fall — they PROMPT, the owner reconnects,
// D-0020); admin sees the whole company. Another organisation's mailboxes are
// never read: every query goes through db.forRequest(req).
//
// `is_owner` tells the page whether to offer the Reconnect button — only the
// mailbox's owner can complete the provider's consent screen.
// ============================================================================
const express = require('express');
const { mailboxConnections } = require('../mailbox-health');
const own = require('../services/ownership');
const mailboxAlerts = require('../services/mailbox-alerts');
const { createDb } = require('../models');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole } = ctx;
  const db = ctx.db || createDb(supabase);
  const { reportingChainIds } = require('../hierarchy')(supabase);
  const orgOf = (req) => (ctx.orgIdFor ? ctx.orgIdFor(req) : ((req && (req.orgId || (req.user && req.user.org_id))) || null));

  router.get('/mailboxes/alerts', auth, async (req, res) => {
    try {
      const isAdmin = hasRole(req, 'admin');
      const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgOf(req));
      const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });

      let q = db.forRequest(req).from('user_emails').select('id,email_address,user_id,is_active,platform');
      if (!scope.all) q = q.in('user_id', scope.ownerIds.length ? scope.ownerIds : ['__none__']);
      const { data: boxes, error } = await q;
      if (error) throw error;
      const active = (boxes || []).filter(b => b.is_active !== false);
      if (!active.length) return res.json({ alerts: [], scope: scope.label });

      const ids = active.map(b => b.id);
      const conns = await mailboxConnections(supabase, ids);

      // Mail waiting behind each mailbox: a pending email is sent by its own
      // override mailbox if it has one, otherwise by its lead's mailbox — the
      // same rule the send loop uses.
      const held = {};
      const { data: direct } = await db.forRequest(req).from('emails')
        .select('id,sending_email_id').eq('status', 'pending').in('sending_email_id', ids);
      (direct || []).forEach(e => { held[e.sending_email_id] = (held[e.sending_email_id] || 0) + 1; });
      const { data: leads } = await db.forRequest(req).from('jobs')
        .select('id,sending_email_id').in('sending_email_id', ids).is('deleted_at', null);
      const leadBox = {}; (leads || []).forEach(j => { leadBox[j.id] = j.sending_email_id; });
      const leadIds = Object.keys(leadBox);
      for (let i = 0; i < leadIds.length; i += 200) {
        const { data: viaLead } = await db.forRequest(req).from('emails')
          .select('id,job_id').eq('status', 'pending').is('sending_email_id', null).in('job_id', leadIds.slice(i, i + 200));
        (viaLead || []).forEach(e => { const mb = leadBox[e.job_id]; if (mb) held[mb] = (held[mb] || 0) + 1; });
      }

      let alerts = active.map(mb => {
        const a = mailboxAlerts.alertFor({ mailbox: mb, conn: conns[mb.id], held: held[mb.id] || 0 });
        return a && Object.assign(a, { owner_id: mb.user_id, is_owner: mb.user_id === req.user.id });
      }).filter(Boolean);

      if (alerts.length) {
        const ownerIds = [...new Set(alerts.map(a => a.owner_id).filter(Boolean))];
        const { data: people } = await db.forRequest(req).from('users').select('id,name').in('id', ownerIds);
        const nameOf = {}; (people || []).forEach(p => { nameOf[p.id] = p.name; });
        alerts.forEach(a => { a.owner_name = nameOf[a.owner_id] || null; });
      }
      res.json({ alerts: mailboxAlerts.sortAlerts(alerts), scope: scope.label });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
