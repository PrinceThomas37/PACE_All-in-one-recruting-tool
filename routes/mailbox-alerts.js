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

  // The alerts this person may see (scope + rules), before anything is hidden.
  // Shared by the list and by the two things that act on one alert, so "which
  // mailbox, in what state" is decided in exactly one place.
  async function buildAlerts(req) {
    const isAdmin = hasRole(req, 'admin');
    const chain = isAdmin ? null : await reportingChainIds(req.user.id, orgOf(req));
    const scope = own.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });

    let q = db.forRequest(req).from('user_emails').select('id,email_address,user_id,is_active,platform');
    if (!scope.all) q = q.in('user_id', scope.ownerIds.length ? scope.ownerIds : ['__none__']);
    const { data: boxes, error } = await q;
    if (error) throw error;
    const active = (boxes || []).filter(b => b.is_active !== false);
    if (!active.length) return { alerts: [], scope: scope.label };

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
    return { alerts: mailboxAlerts.sortAlerts(alerts), scope: scope.label, isAdmin };
  }

  // What this person has hidden (R-122 step 3). Best-effort, like the needs-you
  // snoozes: a store that cannot be read means a warning shows, never that one
  // is lost.
  async function readHidden(userId) {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', mailboxAlerts.hideKey(userId)).maybeSingle();
      if (data && data.value) return mailboxAlerts.pruneHidden(typeof data.value === 'string' ? JSON.parse(data.value) : data.value, Date.now());
    } catch (_) { /* shows the warning */ }
    return {};
  }
  async function writeHidden(userId, store) {
    const { error } = await supabase.from('app_settings').upsert({ key: mailboxAlerts.hideKey(userId), value: JSON.stringify(store) }, { onConflict: 'key' });
    if (error) throw error;
  }
  const askedTitle = 'Reconnect your mailbox';

  router.get('/mailboxes/alerts', auth, async (req, res) => {
    try {
      const built = await buildAlerts(req);
      const after = mailboxAlerts.applyHidden(built.alerts, await readHidden(req.user.id), Date.now());

      // "Asked" is remembered: a teammate's warning whose owner already has our
      // reminder waiting on their list says so, instead of offering to ask again.
      const others = after.alerts.filter(a => !a.is_owner && a.owner_id);
      if (others.length) {
        try {
          const { data: pend } = await db.forRequest(req).from('reminders').select('user_id,company_name')
            .eq('status', 'pending').eq('reminder_type', 'manager_prompt').eq('contact_name', askedTitle)
            .in('user_id', [...new Set(others.map(a => a.owner_id))]);
          const have = new Set((pend || []).map(r => `${r.user_id}|${String(r.company_name || '').toLowerCase()}`));
          others.forEach(a => { a.asked = have.has(`${a.owner_id}|${String(a.email || '').toLowerCase()}`); });
        } catch (_) { /* the button simply stays available */ }
      }
      res.json({ alerts: after.alerts, hidden: after.hidden, scope: built.scope });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Hide one warning, for me only, for a week. It comes back sooner if the
  // mailbox fails in a new way (the fingerprint changes).
  router.post('/mailboxes/alerts/hide', auth, async (req, res) => {
    try {
      const id = req.body && req.body.mailbox_id;
      const built = await buildAlerts(req);
      const alert = built.alerts.find(a => a.mailbox_id === id);
      if (!alert) return res.status(404).json({ error: 'That warning is not on your list any more — it may already be fixed.' });
      const store = mailboxAlerts.recordHide(await readHidden(req.user.id), alert, Date.now());
      await writeHidden(req.user.id, store);
      res.json({ success: true, until: store[id].until });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Bring every hidden warning back.
  router.post('/mailboxes/alerts/show', auth, async (req, res) => {
    try {
      await writeHidden(req.user.id, {});
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ASK THE OWNER TO RECONNECT (D-0020). Only the owner can complete the
  // provider's consent screen, so the manager's job is to PROMPT: a dated task
  // on the owner's own "Needs you today" list naming who asked, exactly like the
  // team review's prompt. Nothing is created for a mailbox that is working.
  router.post('/mailboxes/alerts/:mailboxId/ask', auth, async (req, res) => {
    try {
      const built = await buildAlerts(req);
      const alert = built.alerts.find(a => a.mailbox_id === req.params.mailboxId);
      if (!alert) return res.status(404).json({ error: 'That mailbox is not showing a warning any more — it may already be fixed.' });
      const org = orgOf(req);
      const chain = built.isAdmin ? null : await reportingChainIds(req.user.id, org);
      const refusal = mailboxAlerts.askRefusal({ askerId: req.user.id, ownerId: alert.owner_id, isAdmin: built.isAdmin, chainIds: chain });
      if (refusal) return res.status(403).json({ error: refusal });

      const { data: already } = await db.forRequest(req).from('reminders').select('id')
        .eq('user_id', alert.owner_id).eq('status', 'pending').eq('reminder_type', 'manager_prompt')
        .eq('contact_name', askedTitle).eq('company_name', alert.email).limit(1);
      if (already && already.length) return res.json({ success: true, already: true });

      const note = own.promptNote({
        fromName: req.user.name, title: askedTitle, subtitle: alert.email,
        note: `${alert.sentence} Open Today and press Reconnect on the mailbox warning.`,
      });
      const { error } = await db.forRequest(req).from('reminders').insert({
        user_id: alert.owner_id, contact_name: askedTitle, company_name: alert.email,
        return_date: new Date().toISOString().slice(0, 10), reminder_time: '09:00',
        note, status: 'pending', reminder_type: 'manager_prompt',
      });
      if (error) throw error;
      res.status(201).json({ success: true, note });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
