// ============================================================================
// MY SETUP — a person sets up THEIR OWN outreach (owner, 8 Oct 2026, D-0103 / D-0104).
//   POST /my-setup/sequence/starter   copy the starter sequence (with their company's name) as THEIR own
//   POST /my-setup/sync               put / close the person's setup tasks (mailbox, sequence) — idempotent
//   GET  /my-setup/send-window        the organisation's hours, the person's choice, what applies
//   PUT  /my-setup/send-window        narrow it (days, start, stop) or { reset:true }
// Everything is the CALLER's own: no id in any path, so nobody can reach another person's setup through here.
// The rules are in services/sequence-starter.js, services/setup-tasks.js, services/send-window.js (all pure).
// ============================================================================
const express = require('express');
const sequenceStarter = require('../services/sequence-starter');
const setupTasks = require('../services/setup-tasks');
const sendWindow = require('../services/send-window');
const { sendsAsKey, cleanSendsAs } = require('../email-signature');
const { mailboxConnections } = require('../mailbox-health');
const wording = require('../services/wording-scope');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, db, auth, hasRole, today, getSendWindowHours } = ctx;
  const SEQUENCE_ROLES = ['bd', 'bd_lead', 'admin'];

  async function myMailboxes(userId) {
    const { data } = await supabase.from('user_emails').select('id,is_primary,is_active,created_at').eq('user_id', userId).eq('is_active', true);
    return (data || []).slice().sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || String(a.created_at).localeCompare(String(b.created_at)));
  }
  // The company a person's mailboxes say they write for: the first mailbox (primary first) that says one.
  async function myCompany(boxes) {
    if (!boxes.length) return null;
    const { data } = await supabase.from('app_settings').select('key,value').in('key', boxes.map((m) => sendsAsKey(m.id)));
    const by = {}; (data || []).forEach((r) => { by[r.key] = r.value; });
    for (const m of boxes) { try { const s = cleanSendsAs(JSON.parse(by[sendsAsKey(m.id)] || 'null')); if (s.company) return s.company; } catch (_) { /* unreadable = not said */ } }
    return null;
  }
  // Has this person started a sequence of their own — their wording, or (R-176) a first email written for one of their email IDs
  // when they chose a wording for each? Either is enough to start outreach from the email ID that has it.
  async function startedSequence(userId, boxes) {
    const person = await settingsOf(userId, ['tmpl_o1_body', 'tmpl_scope']);
    if (sequenceStarter.hasOwnSequence(person, userId)) return true;
    if (!wording.isEach(person, userId)) return false;
    const keys = (boxes || []).map((m) => wording.mailboxKey(m.id, 'tmpl_o1_body'));
    if (!keys.length) return false;
    const { data } = await supabase.from('app_settings').select('key,value').in('key', keys);
    const by = Object.assign({}, person); (data || []).forEach((r) => { by[r.key] = r.value; });
    return (boxes || []).some((m) => wording.mailboxHasOwnSequence(by, userId, m.id));
  }
  async function settingsOf(userId, names) {
    const keys = names.map((n) => `u_${userId}_${n}`);
    const { data } = await supabase.from('app_settings').select('key,value').in('key', keys);
    const m = {}; (data || []).forEach((r) => { m[r.key] = r.value; });
    return m;
  }

  // ── the starter sequence ───────────────────────────────────────────────
  router.post('/my-setup/sequence/starter', auth, async (req, res) => {
    try {
      if (!hasRole(req, ...SEQUENCE_ROLES)) return res.status(403).json({ error: 'Only managers and admins write an outreach sequence.' });
      const uid = req.user.id;
      const have = await startedSequence(uid, await myMailboxes(uid));
      if (have && !(req.body && req.body.replace === true)) return res.status(409).json({ error: 'You already have your own sequence. Edit it on the Email page.', has_own: true });
      const company = await myCompany(await myMailboxes(uid));
      if (!company) return res.status(400).json({ error: 'Say which company your mailbox writes for first (My Setup, step 2) — the starter uses your company\'s name.', needs: 'sends_as' });
      const starter = sequenceStarter.starterFor(company);
      const rows = Object.keys(starter).map((k) => ({ key: `u_${uid}_${k}`, value: String(starter[k]), updated_at: new Date() }));
      const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
      const plan = {}; Object.keys(starter).forEach((k) => { plan[k] = String(starter[k]); });
      res.status(201).json({ company, plan });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── the person's setup tasks ───────────────────────────────────────────
  router.post('/my-setup/sync', auth, async (req, res) => {
    try {
      const uid = req.user.id;
      const sends = hasRole(req, 'admin', 'bd', 'bd_lead', 'ra_lead', 'recruiter', 'director', 'associate_director');
      const boxes = await myMailboxes(uid);
      const conns = boxes.length ? await mailboxConnections(supabase, boxes.map((m) => m.id)) : {};
      const connected = boxes.filter((m) => conns[m.id] && conns[m.id].connected).length;
      const hasSeq = await startedSequence(uid, boxes);
      const owedKeys = setupTasks.owed({ sends, hasSequenceRole: hasRole(req, ...SEQUENCE_ROLES), connected, hasOwnSequence: hasSeq });
      const scoped = db.forRequest(req);
      const { data: existing, error: exErr } = await scoped.from('reminders').select('id,contact_name,status,created_at')
        .eq('user_id', uid).eq('reminder_type', 'setup');
      if (exErr) throw exErr;
      const todo = setupTasks.plan(owedKeys, existing || [], new Date());
      for (const key of todo.create) {
        const { error } = await scoped.from('reminders').insert({
          user_id: uid, contact_name: setupTasks.TITLES[key], company_name: 'My Setup', return_date: today(), reminder_time: '09:00',
          note: setupTasks.NOTES[key], status: 'pending', reminder_type: 'setup',
        });
        if (error) throw error;
      }
      if (todo.close.length) {
        const { error } = await scoped.from('reminders').update({ status: 'sent', updated_at: new Date() }).in('id', todo.close).eq('user_id', uid);
        if (error) throw error;
      }
      res.json({ owed: owedKeys, created: todo.create, closed: todo.close.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── sending days and hours ─────────────────────────────────────────────
  async function windowAnswer(uid) {
    const org = await getSendWindowHours();
    const m = await settingsOf(uid, ['send_days', 'send_start_hour', 'send_end_hour']);
    const prefs = sendWindow.readPrefs({ days: m[`u_${uid}_send_days`], start: m[`u_${uid}_send_start_hour`], end: m[`u_${uid}_send_end_hour`] });
    return { org, prefs, effective: sendWindow.effectiveWindow(org, prefs), days: sendWindow.DAYS };
  }
  router.get('/my-setup/send-window', auth, async (req, res) => {
    try { res.json(await windowAnswer(req.user.id)); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.put('/my-setup/send-window', auth, async (req, res) => {
    try {
      const uid = req.user.id, b = req.body || {};
      const keys = ['send_days', 'send_start_hour', 'send_end_hour'].map((k) => `u_${uid}_${k}`);
      if (b.reset === true) {
        await supabase.from('app_settings').delete().in('key', keys);
        return res.json(await windowAnswer(uid));
      }
      const chk = sendWindow.checkPrefs(b);
      if (chk.error) return res.status(400).json({ error: chk.error });
      const org = await getSendWindowHours();
      const eff = sendWindow.effectiveWindow(org, chk.prefs);
      if (chk.prefs.start < org.start || chk.prefs.end > org.end || eff.conflict) return res.status(400).json({ error: `Your organisation sends between ${org.start}:00 and ${org.end}:00 (the lead's time). Pick hours inside that — you can narrow it, not widen it.` });
      const { error } = await supabase.from('app_settings').upsert([
        { key: keys[0], value: chk.prefs.days.join(','), updated_at: new Date() },
        { key: keys[1], value: String(chk.prefs.start), updated_at: new Date() },
        { key: keys[2], value: String(chk.prefs.end), updated_at: new Date() },
      ], { onConflict: 'key' });
      if (error) throw error;
      res.json(await windowAnswer(uid));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
