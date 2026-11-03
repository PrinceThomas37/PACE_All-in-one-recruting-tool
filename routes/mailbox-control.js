// ============================================================================
// ONE MAILBOX, ONE PLACE TO ACT — Deliverability → admin (owner, 3 Nov 2026). The rules are services/mailbox-control.js.
//
//   GET  /admin/mailboxes/summary           how many mailboxes are in each state (the "needs attention" chips) — never the list
//   GET  /admin/mailboxes/search?q=&state=  find a mailbox by address, name or owner (or the few in one state); an empty search returns NOTHING
//   GET  /admin/mailboxes/:id/detail?days=  one mailbox: state, health, the numbers, warm-up, what to do
//   POST /admin/mailboxes/:id/action        pause | start | block | unblock | deactivate | delete
//
// ADMIN ONLY, and every read and write goes through db.forRequest(req): another company's mailbox is a 404, never a 403 (it does not exist
// here). The literal paths are registered BEFORE the :id routes.
//
// A mailbox's sends are matched by its ADDRESS (emails.from_email), not emails.sending_email_id: measured on 3 Nov, 8,951 of 8,958 sent emails
// in 30 days have no sending_email_id, but all have from_email. Opens come from email_tracking.mailbox_email (the same address).
// ============================================================================
const express = require('express');
const { createDb } = require('../models');
const mc = require('../services/mailbox-control');
const { bounceKind } = require('../services/bd-insights');
const alerts = require('../services/mailbox-alerts');
const { mailboxConnections } = require('../mailbox-health');
const { reassignJobsOffMailbox } = require('../services/mailbox-reassign');
const { getSetting } = require('../config/settings');
const { readAllPages, readByIds } = require('../services/batched-read');

const MAX_ACTIVE_PER_USER = 4;      // the product's existing rule (routes/auth.js PATCH /users/:id/emails/:eid), kept the same here
const SEARCH_LIMIT = 10, STATE_LIMIT = 25;
const isBadId = (err) => !!err && err.code === '22P02';
// An address matched EXACTLY and ignoring case: `_` and `%` are wildcards to LIKE, so they are escaped (first_last@ must not match firstXlast@).
const exactCi = (a) => String(a || '').replace(/[\\%_]/g, '\\$&');
const like = (s) => String(s || '').trim().replace(/[%,()*\\]/g, ' ').slice(0, 80);

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole } = ctx;
  const db = ctx.db || createDb(supabase);
  const orgOf = (req) => (ctx.orgIdFor ? ctx.orgIdFor(req) : ((req && (req.orgId || (req.user && req.user.org_id))) || null));
  const adminOnly = (req, res) => { if (!hasRole(req, 'admin')) { res.status(403).json({ error: 'Admin only' }); return false; } return true; };

  const COLS = 'id,user_id,email_address,display_name,platform,is_primary,is_active,daily_send_limit,created_at,warmup_start_date,auto_paused_at,warmup_status,warmup_days,warmup_pool_opt_in,warmup_graduated_at';

  async function loadMailbox(req, id) {
    const { data, error } = await db.forRequest(req).from('user_emails').select(COLS).eq('id', id).maybeSingle();
    if (error) { if (isBadId(error)) return null; throw error; }
    return data || null;
  }
  async function notesFor(ids) {
    const out = {};
    const list = (ids || []).filter(Boolean);
    if (!list.length) return out;
    const rows = await readByIds(supabase, 'app_settings', 'key,value', 'key', list.map(alerts.pauseNoteKey));
    rows.forEach((r) => { try { out[r.key] = JSON.parse(r.value); } catch (_) { /* a note that does not parse is "no note" */ } });
    return out;
  }
  const noteOf = (notes, id) => notes[alerts.pauseNoteKey(id)] || null;
  async function ownersOf(req, userIds) {
    const out = {};
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return out;
    const rows = await readByIds(db.forRequest(req), 'users', 'id,name,role', 'id', ids).catch(() => []);
    rows.forEach((u) => { out[u.id] = u; });
    return out;
  }
  const shape = (m, notes, owners, conns) => {
    const state = mc.stateOf(m, noteOf(notes, m.id));
    return { id: m.id, email: m.email_address, name: m.display_name || '', owner: (owners[m.user_id] || {}).name || '', state, state_label: mc.STATE_LABEL[state],
      sign_in: (conns[m.id] || {}).status || 'none' };
  };

  // ── summary: counts only ──────────────────────────────────────────────────
  router.get('/admin/mailboxes/summary', auth, async (req, res) => {
    try {
      if (!adminOnly(req, res)) return;
      const rows = await readAllPages(() => db.forRequest(req).from('user_emails').select('id,is_active,auto_paused_at').order('id'));
      const paused = rows.filter((m) => m.is_active !== false && m.auto_paused_at).map((m) => m.id);
      const notes = await notesFor(paused);
      const counts = { total: rows.length, active: 0, paused: 0, auto_paused: 0, blocked: 0, deactivated: 0, expired: 0 };
      rows.forEach((m) => { counts[mc.stateOf(m, noteOf(notes, m.id))]++; });
      const live = rows.filter((m) => m.is_active !== false).map((m) => m.id);
      const conns = await mailboxConnections(supabase, live);
      counts.expired = live.filter((id) => (conns[id] || {}).status === 'expired').length;
      res.json(counts);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── search: a few matches, never the whole list ──────────────────────────
  router.get('/admin/mailboxes/search', auth, async (req, res) => {
    try {
      if (!adminOnly(req, res)) return;
      const q = like(req.query.q), state = String(req.query.state || '');
      if (!q && !state) return res.json({ results: [], more: 0 });          // nothing typed, nothing chosen: no list
      const all = await readAllPages(() => db.forRequest(req).from('user_emails').select(COLS).order('email_address'));
      const owners = await ownersOf(req, all.map((m) => m.user_id));
      const needle = q.toLowerCase();
      let hits = all.filter((m) => !needle || String(m.email_address || '').toLowerCase().includes(needle)
        || String(m.display_name || '').toLowerCase().includes(needle) || String((owners[m.user_id] || {}).name || '').toLowerCase().includes(needle));
      const paused = hits.filter((m) => m.is_active !== false && m.auto_paused_at).map((m) => m.id);
      const notes = await notesFor(paused);
      const conns = await mailboxConnections(supabase, hits.filter((m) => m.is_active !== false).map((m) => m.id));
      let shaped = hits.map((m) => shape(m, notes, owners, conns));
      if (state === 'expired') shaped = shaped.filter((m) => m.sign_in === 'expired' && m.state !== 'deactivated');
      else if (mc.STATES.includes(state)) shaped = shaped.filter((m) => m.state === state);
      const cap = q ? SEARCH_LIMIT : STATE_LIMIT;
      res.json({ results: shaped.slice(0, cap), more: Math.max(0, shaped.length - cap) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── one mailbox: the detail ──────────────────────────────────────────────
  router.get('/admin/mailboxes/:id/detail', auth, async (req, res) => {
    try {
      if (!adminOnly(req, res)) return;
      const mb = await loadMailbox(req, req.params.id);
      if (!mb) return res.status(404).json({ error: 'Mailbox not found' });
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const scoped = db.forRequest(req);
      const addr = mb.email_address;
      const notes = await notesFor([mb.id]);
      const note = noteOf(notes, mb.id);
      const state = mc.stateOf(mb, note);
      const owners = await ownersOf(req, [mb.user_id]);
      const conns = await mailboxConnections(supabase, [mb.id]);
      const conn = conns[mb.id] || { connected: false, status: 'none' };

      const countOf = async (q) => { const { count, error } = await q; if (error) throw error; return count || 0; };
      const sentRows = await readAllPages(() => scoped.from('emails').select('id,contact_id,created_at').ilike('from_email', exactCi(addr)).eq('status', 'sent').gte('created_at', since).order('created_at', { ascending: false }));
      const contacts = await readByIds(scoped, 'contacts', 'id,email_status,replied_at', 'id', sentRows.map((e) => e.contact_id));
      const byContact = {}; contacts.forEach((c) => { byContact[c.id] = c; });
      sentRows.forEach((e) => { e.contact = byContact[e.contact_id] || null; });
      const [failed, pending, anyEmail, lastFail] = await Promise.all([
        countOf(scoped.from('emails').select('id', { count: 'exact', head: true }).ilike('from_email', exactCi(addr)).eq('status', 'failed').gte('created_at', since)),
        countOf(scoped.from('emails').select('id', { count: 'exact', head: true }).ilike('from_email', exactCi(addr)).eq('status', 'pending')),
        countOf(scoped.from('emails').select('id', { count: 'exact', head: true }).ilike('from_email', exactCi(addr))),
        scoped.from('emails').select('fail_reason,fail_kind,created_at').ilike('from_email', exactCi(addr)).eq('status', 'failed').order('created_at', { ascending: false }).limit(3).then((r) => r.data || []),
      ]);
      const tracking = await readAllPages(() => scoped.from('email_tracking').select('id,open_count').ilike('mailbox_email', exactCi(addr)).gte('sent_at', since).order('sent_at', { ascending: false }));
      const stats = mc.statsOf({ sent: sentRows, failed, pending, tracking, lastFailure: lastFail[0] ? { reason: lastFail[0].fail_reason, kind: lastFail[0].fail_kind, at: lastFail[0].created_at } : null }, bounceKind);

      const limitPct = Number(await getSetting(supabase, 'bounce_rate_threshold_pct', orgOf(req))) || 0;
      const health = mc.healthOf({ state, connection: conn, bounceRate: stats.bounce_rate, bounceLimitPct: limitPct, sent: stats.sent });
      const today = new Date().toISOString().slice(0, 10);
      const sentToday = sentRows.filter((e) => String(e.created_at || '').slice(0, 10) === today).length;
      const byDay = {};
      sentRows.forEach((e) => { const d = String(e.created_at || '').slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; });
      const week = [];
      for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); week.push({ day: d, sent: byDay[d] || 0 }); }

      res.json({
        id: mb.id, email: addr, name: mb.display_name || '', platform: mb.platform || '', primary: !!mb.is_primary, created_at: mb.created_at,
        owner: { id: mb.user_id, name: (owners[mb.user_id] || {}).name || '' },
        state, state_label: mc.STATE_LABEL[state], state_note: mc.noteSentence(state, note) || (state === 'auto_paused' ? alerts.pausedSentence(note) : null),
        paused_at: mb.auto_paused_at || null, sign_in: conn.status || 'none', connection: { status: conn.status || 'none', connected: !!conn.connected },
        health, window_days: days, stats, bounce_limit_pct: limitPct || null,
        limit: { daily: mb.daily_send_limit, sent_today: sentToday }, week,
        warmup: { status: mb.warmup_status || null, started: mb.warmup_start_date || null, days: mb.warmup_days || null, pool: !!mb.warmup_pool_opt_in, graduated_at: mb.warmup_graduated_at || null },
        email_count: anyEmail, scope_note: ['paused', 'auto_paused', 'blocked'].includes(state) ? mc.SCOPE_NOTE : null,
        actions: mc.actionsFor(state),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── an action ────────────────────────────────────────────────────────────
  router.post('/admin/mailboxes/:id/action', auth, async (req, res) => {
    try {
      if (!adminOnly(req, res)) return;
      const action = String((req.body && req.body.action) || '');
      const mb = await loadMailbox(req, req.params.id);
      if (!mb) return res.status(404).json({ error: 'Mailbox not found' });
      const notes = await notesFor([mb.id]);
      const state = mc.stateOf(mb, noteOf(notes, mb.id));
      const ok = mc.check(action, state);
      if (!ok.ok) return res.status(409).json({ error: ok.error, state });
      const scoped = db.forRequest(req);
      const update = async (patch) => { const { error } = await scoped.from('user_emails').update({ ...patch, updated_at: new Date() }).eq('id', mb.id); if (error) throw error; };
      const who = (req.user && (req.user.name || req.user.email)) || 'an admin';
      const nowIso = new Date().toISOString();
      const leaveWarmup = () => (mb.warmup_status === 'warming' ? { warmup_status: 'paused' } : {});
      let extra = {};

      if (action === 'pause') {
        await update({ auto_paused_at: new Date() });
        await alerts.saveNote(supabase, mb.id, mc.noteFor('pause', who, nowIso));
      } else if (action === 'block') {
        await update({ auto_paused_at: mb.auto_paused_at || new Date(), warmup_pool_opt_in: false, ...leaveWarmup() });
        await alerts.saveNote(supabase, mb.id, mc.noteFor('block', who, nowIso));
      } else if (action === 'unblock') {
        // Unlocked, NOT started: it becomes a plain pause, so its outreach stays held until someone presses Start on purpose.
        await alerts.saveNote(supabase, mb.id, mc.noteFor('pause', who, nowIso));
      } else if (action === 'start') {
        if (state === 'deactivated') {
          const { count } = await scoped.from('user_emails').select('id', { count: 'exact', head: true }).eq('user_id', mb.user_id).eq('is_active', true).neq('id', mb.id);
          if ((count || 0) >= MAX_ACTIVE_PER_USER) return res.status(409).json({ error: `Its owner already has ${MAX_ACTIVE_PER_USER} active email IDs, which is the most allowed. Deactivate another one first.`, state });
        }
        await update({ is_active: true, auto_paused_at: null });
        await alerts.forgetNote(supabase, mb.id);
      } else if (action === 'deactivate') {
        await update({ is_active: false, ...leaveWarmup() });
        extra.reassignment = await reassignJobsOffMailbox(supabase, mb.id, mb.user_id);
      } else if (action === 'delete') {
        const anyEmail = await (async () => { const { count, error } = await scoped.from('emails').select('id', { count: 'exact', head: true }).ilike('from_email', exactCi(mb.email_address)); if (error) throw error; return count || 0; })();
        const byId = await (async () => { const { count, error } = await scoped.from('emails').select('id', { count: 'exact', head: true }).eq('sending_email_id', mb.id); if (error) throw error; return count || 0; })();
        const d = mc.deleteCheck({ emailCount: Math.max(anyEmail, byId), typedAddress: req.body && req.body.confirm_address, address: mb.email_address });
        if (!d.ok) return res.status(d.status).json({ error: d.error, state });
        extra.reassignment = await reassignJobsOffMailbox(supabase, mb.id, mb.user_id);
        const { error } = await scoped.from('user_emails').delete().eq('id', mb.id);
        if (error) return res.status(409).json({ error: 'It could not be deleted: ' + error.message + '. Deactivate it instead.', state });
        await alerts.forgetNote(supabase, mb.id);
        if (typeof ctx.logActivity === 'function') await Promise.resolve(ctx.logActivity(null, null, req.user.id, 'mailbox_delete', `Deleted mailbox ${mb.email_address}`)).catch(() => {});
        return res.json({ success: true, deleted: true, ...extra });
      }
      if (typeof ctx.logActivity === 'function') await Promise.resolve(ctx.logActivity(null, null, req.user.id, 'mailbox_' + action, `${mc.LABEL[action]} — ${mb.email_address}`)).catch(() => {});
      const fresh = await loadMailbox(req, mb.id);
      const n2 = await notesFor([mb.id]);
      const s2 = mc.stateOf(fresh, noteOf(n2, mb.id));
      res.json({ success: true, state: s2, state_label: mc.STATE_LABEL[s2], actions: mc.actionsFor(s2), ...extra });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
