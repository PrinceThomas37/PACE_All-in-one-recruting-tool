// ============================================================================
// GET /admin/system-health — what is broken, since when, and which buttons to offer (R-367). The rules and the sentences are
// services/system-health.js (pure); this reads the facts. Admin only. The company's own facts (its mailboxes) go through db.forRequest;
// the engine and server facts are the PACE operator's (they run for every company) and are not even read for anyone else.
// Every button it offers calls an endpoint that exists and checks its own role (POST /follow-ups/run: admin/bd_lead; POST /admin/engine/run/:job: operator).
// ============================================================================
const express = require('express');
const health = require('../services/system-health');
const alerts = require('../services/mailbox-alerts');
const { mailboxConnections } = require('../mailbox-health');
const { createDb } = require('../models');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, runner } = ctx;
  const isOperator = ctx.isOperator || (() => false);
  const db = ctx.db || createDb(supabase);
  const now = ctx.now || (() => Date.now());
  // shortcut: the free server's memory (Render free = 512 MB) is read from the environment, default 512; a bigger plan sets RENDER_MEMORY_MB. Not a customer limit.
  const memLimitMb = () => Number(process.env.RENDER_MEMORY_MB) || 512;

  async function settingsMap(keys) {
    const out = {};
    try { const { data, error } = await supabase.from('app_settings').select('key,value').in('key', keys); if (error) return null; (data || []).forEach((r) => { out[r.key] = r.value; }); return out; } catch (_) { return null; }
  }

  router.get('/admin/system-health', auth, async (req, res) => {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    try {
      const operator = !!isOperator(req);
      const t = now();
      const ist = new Date(t + 5.5 * 3600e3);
      const todayIst = ist.toISOString().slice(0, 10);
      const facts = { now: t, isOperator: operator };

      // follow-ups
      const s = await settingsMap(['last_followup_run', 'followup_send_time', 'followup_engine_alert']);
      if (!s) facts.followups = { checked: false };
      else {
        let alert = null; try { const a = s.followup_engine_alert && JSON.parse(s.followup_engine_alert); alert = a && a.date === todayIst ? a : null; } catch (_) { /* no alert */ }
        facts.followups = { checked: true, alert, lastRunDate: s.last_followup_run || null, todayIst, sendTime: s.followup_send_time || '08:30', istMinutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
      }

      // mailboxes of THIS company
      try {
        const { data: boxes, error } = await db.forRequest(req).from('user_emails').select('id,email_address,is_active,auto_paused_at,platform');
        if (error) throw error;
        const live = (boxes || []).filter((b) => b.is_active !== false);
        const ids = live.map((b) => b.id);
        const conns = ids.length ? await mailboxConnections(supabase, ids) : {};
        const locks = ids.length ? await alerts.blockedNotes(supabase, ids) : {};
        const blocked = live.filter((b) => locks[b.id]);
        facts.mailboxes = {
          checked: true,
          expired: live.filter((b) => !locks[b.id] && conns[b.id] && conns[b.id].status === 'expired').map((b) => b.email_address),
          autoPaused: live.filter((b) => b.auto_paused_at && !locks[b.id]).map((b) => b.email_address),
          blocked: blocked.map((b) => b.email_address),
        };
      } catch (_) { facts.mailboxes = { checked: false }; }

      // engine + server: the operator's
      if (operator && runner) {
        try {
          const recent = await runner.recent(60);
          const pingAt = await runner.lastPingAt();
          const sincePing = pingAt ? t - new Date(pingAt).getTime() : null;
          facts.engine = { checked: true, jobs: await runner.status(), lastRuns: recent,
            heartbeat: { state: sincePing === null ? 'silent' : sincePing < 90 * 60e3 ? 'healthy' : sincePing < 8 * 3600e3 ? 'late' : 'silent', minutes_since_ping: sincePing === null ? null : Math.round(sincePing / 60000) } };
        } catch (_) { facts.engine = { checked: false }; }
        facts.server = { uptimeMin: Math.floor(process.uptime() / 60), rssMb: Math.round(process.memoryUsage().rss / 1048576), rssLimitMb: memLimitMb() };
      }

      res.set('Cache-Control', 'private, no-store');
      res.json({ checked_at: new Date(t).toISOString(), issues: health.evaluate(facts) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
