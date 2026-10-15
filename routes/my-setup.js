// ============================================================================
// MY SETUP — a person sets up THEIR OWN outreach (owner, 8 Oct 2026, D-0103 / D-0104).
//   POST /my-setup/sequence/starter   copy the starter sequence (with their company's name) as THEIR own
//   POST /my-setup/sync               put / close the person's setup tasks (mailbox, sequence) — idempotent
//   GET  /my-setup/send-window        the organisation's hours, the person's choice, what applies
//   PUT  /my-setup/send-window        narrow it (days, start, stop) or { reset:true }
//   GET  /my-setup/sequence           the person's sequence as the "Write your first sequence" screen edits it (R-258)
//   PUT  /my-setup/sequence           save it: how the first email is written, the emails, their versions, the follow-ups
//   POST /my-setup/sequence/preview   the first email exactly as a real lead of theirs would get it (R-256)
//   POST /my-setup/sequence/draft     AI help: draft from one sentence, or write a version keeping every detail
//   POST /my-setup/sequence/ai-test   "AI writes each one": the AI writes the first email and follow-up 1 for one real lead (R-259)
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
const followupSteps = require('../services/followup-steps');
const versions = require('../services/sequence-versions');
const sequenceDraft = require('../services/sequence-draft');
const aiProvider = require('../services/ai-provider');
const aiFirst = require('../services/ai-first-choice');
const aiTeach = require('../services/ai-teach');
const aiStyle = require('../services/ai-style');
const engineDraft = require('../services/engine-draft');
const outreachGen = require('../services/outreach-generator');
const settingsConfig = require('../config/settings');
const { buildEmailVars, fillTemplate, unresolvedVars, DEFER_SENDER } = require('../email-vars');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, db, auth, hasRole, today, getSendWindowHours, userOrgId } = ctx;
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
    const org = await getSendWindowHours(userOrgId ? await userOrgId(uid) : undefined);
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
      const org = await getSendWindowHours(userOrgId ? await userOrgId(uid) : undefined);
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

  // ── the sequence screen (R-258, D-0150 … D-0154) ───────────────────────
  // The SAME stores the engine already reads: u_<id>_tmpl_<slot>_subject/body, u_<id>_fu_count, u_<id>_fu<N>_day, and the person's
  // AI first-email choice (u_<id>_ai_first): "I write it" = off, "AI writes each one" = on. Versions live beside each email
  // (services/sequence-versions.js) and the engine picks one at random per lead.
  const SLOTS = ['o1'].concat(followupSteps.STEPS);
  const seqKeys = (uid) => {
    const k = [`u_${uid}_fu_count`, aiFirst.personKey(uid), aiTeach.key(uid)];
    SLOTS.forEach((sl) => { k.push(`u_${uid}_tmpl_${sl}_subject`, `u_${uid}_tmpl_${sl}_body`); });
    followupSteps.STEPS.forEach((t) => k.push(`u_${uid}_${t}_day`));
    return k.concat(versions.neededKeys([uid]));
  };
  async function followupMax(req) {
    try { const v = Number(await settingsConfig.getSetting(supabase, 'followup_max', req.orgId || undefined)); return Number.isInteger(v) && v >= 0 ? Math.min(v, followupSteps.MAX) : followupSteps.MAX; }
    catch (_) { return followupSteps.MAX; }
  }
  router.get('/my-setup/sequence', auth, async (req, res) => {
    try {
      if (!hasRole(req, ...SEQUENCE_ROLES)) return res.status(403).json({ error: 'Only managers and admins write an outreach sequence.' });
      const uid = req.user.id;
      const { data } = await supabase.from('app_settings').select('key,value').in('key', seqKeys(uid));
      const m = {}; (data || []).forEach((r) => { m[r.key] = r.value; });
      const own = (sl, part) => String(m[`u_${uid}_tmpl_${sl}_${part}`] || '');
      const max = await followupMax(req);
      const count = Math.min(followupSteps.countFor(m, uid), max);
      const mode = aiFirst.normalize(m[aiFirst.personKey(uid)]) === 'on' ? 'ai' : (sequenceStarter.hasOwnSequence(m, uid) ? 'template' : null);
      res.json({
        mode,
        first: { subject: own('o1', 'subject'), body: own('o1', 'body'), versions: versions.extraVersions(m, uid, 'o1').map((v) => ({ subject: v.subject, body: v.body })) },
        followups: followupSteps.STEPS.slice(0, count).map((t, i) => ({
          day: followupSteps.dayFor(m, uid, i + 1), subject: own(t, 'subject'), body: own(t, 'body'),
          versions: versions.extraVersions(m, uid, t).map((v) => ({ subject: v.subject, body: v.body })),
        })),
        followup_max: max,
        // "AI writes each one": the person's answers (R-259) and the choices the screen offers — the server's lists, not the page's.
        teach: aiTeach.normalize(m[aiTeach.key(uid)]),
        teach_options: aiTeach.options(),
        // The lead the screen's live preview fills in: one of the person's own, else an example (said so on screen).
        sample: await (async () => {
          const lead = await sampleLead(req);
          const vars = buildEmailVars({ job: lead.job, contact: lead.contact, senderDisplayName: DEFER_SENDER });
          Object.keys(vars).forEach((k) => { if (vars[k] === null) delete vars[k]; });
          return { vars, example: lead.example, name: [lead.contact.first_name, lead.contact.last_name].filter(Boolean).join(' '), company: (lead.job.company && lead.job.company.name) || '', email: lead.contact.email };
        })(),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.put('/my-setup/sequence', auth, async (req, res) => {
    try {
      if (!hasRole(req, ...SEQUENCE_ROLES)) return res.status(403).json({ error: 'Only managers and admins write an outreach sequence.' });
      const uid = req.user.id, b = req.body || {};
      const mode = b.mode === 'ai' ? 'ai' : (b.mode === 'template' ? 'template' : null);
      if (!mode) return res.status(400).json({ error: 'Choose how your first email is written.' });
      const clean = (x, n) => String(x == null ? '' : x).replace(/\r/g, '').slice(0, n);
      const first = b.first || {};
      const fSubj = clean(first.subject, 300).trim(), fBody = clean(first.body, 6000).trim();
      if (!fSubj || fBody.length < 20) return res.status(400).json({ error: mode === 'ai' ? 'Write your backup email first: a subject and a few lines.' : 'Write your first email: a subject and a few lines.' });
      const fus = Array.isArray(b.followups) ? b.followups : [];
      const max = await followupMax(req);
      if (fus.length > max) return res.status(400).json({ error: `Your company allows up to ${max} follow-up${max === 1 ? '' : 's'}.` });
      for (let i = 0; i < fus.length; i++) {
        const d = Number(fus[i] && fus[i].day);
        if (!Number.isInteger(d) || d < 1 || d > 90) return res.status(400).json({ error: `Follow-up ${i + 1}: pick a number of days between 1 and 90.` });
        if (i > 0 && d <= Number(fus[i - 1].day)) return res.status(400).json({ error: `Follow-up ${i + 1} must go out after follow-up ${i}.` });
        if (clean(fus[i].body, 6000).trim().length < 5) return res.status(400).json({ error: `Follow-up ${i + 1} has no text yet.` });
      }
      // Every detail in the text must be one PACE can fill — a check, not a hope (unknown {{names}} would ship raw).
      const texts = [fSubj, fBody].concat(...(first.versions || []).map((v) => [v.subject, v.body]), ...fus.map((f) => [f.subject, f.body].concat(...(f.versions || []).map((v) => [v.subject, v.body]))));
      const unknown = [...new Set([].concat(...texts.map((t) => unresolvedVars(String(t || '')).filter((k) => !sequenceDraft.ALLOWED_VARS.has(k)))))];
      if (unknown.length) return res.status(400).json({ error: 'PACE cannot fill ' + unknown.map((k) => '{{' + k + '}}').join(', ') + '. Use "Add a detail" instead.' });
      // "AI writes each one" needs the AI taught (R-259): at least what the email is for. "I write it" clears the answers, so no
      // follow-up of theirs is AI-written any more.
      const teach = aiTeach.normalize(b.teach);
      if (mode === 'ai') { const why = aiTeach.problem(teach); if (why) return res.status(400).json({ error: why }); }
      teach.fus = teach.fus.slice(0, fus.length);

      const now = new Date();
      const rows = [
        { key: `u_${uid}_tmpl_o1_subject`, value: fSubj }, { key: `u_${uid}_tmpl_o1_body`, value: fBody },
        { key: `u_${uid}_fu_count`, value: String(fus.length) },
        { key: aiFirst.personKey(uid), value: mode === 'ai' ? 'on' : 'off' },
        // The person's own words (and versions) are what goes out: PACE's stock rotation, if it was on, is turned off.
        { key: `u_${uid}_random_template_mode`, value: 'false' },
        { key: aiTeach.key(uid), value: mode === 'ai' ? JSON.stringify(teach) : '' },
      ].concat(versions.rowsFor(uid, 'o1', mode === 'template' ? first.versions : []));
      followupSteps.STEPS.forEach((t, i) => {
        const f = fus[i];
        if (!f) { rows.push(...versions.rowsFor(uid, t, [])); return; }        // a follow-up taken away keeps its wording, loses its versions
        rows.push({ key: `u_${uid}_${t}_day`, value: String(Number(f.day)) },
          { key: `u_${uid}_tmpl_${t}_subject`, value: clean(f.subject, 300).trim() || ('Re: ' + fSubj) },
          { key: `u_${uid}_tmpl_${t}_body`, value: clean(f.body, 6000).trim() },
          ...versions.rowsFor(uid, t, f.versions));
      });
      const { error } = await supabase.from('app_settings').upsert(rows.map((r) => Object.assign(r, { updated_at: now })), { onConflict: 'key' });
      if (error) throw error;
      res.json({ ok: true, mode, followups: fus.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // One of the person's own leads with a contact, filled the way the engine fills a first email. None yet: an example lead, said so.
  const EXAMPLE = { job: { position: 'Senior Java Developer', location: 'Dallas, TX', industry: 'Healthcare', salary_range: '$140k to $160k',
    company: { name: 'Acme Health', industry: 'Healthcare' }, research: { requirements: { skills: ['Java', 'Spring Boot', 'HL7'] } } },
    contact: { first_name: 'Dana', last_name: 'Lee', email: 'dana@acmehealth.example' } };
  async function sampleLead(req) {
    try {
      const { data } = await db.forRequest(req).from('jobs').select(ctx.JOB_SELECT).eq('assigned_to_bd', req.user.id).order('created_at', { ascending: false }).limit(25);
      for (const job of data || []) {
        const c = (job.contacts || []).find((x) => x && x.first_name && x.email);
        if (c) return { job, contact: c, example: false };
      }
    } catch (_) { /* no lead to show is not a failure: the example is used */ }
    return Object.assign({ example: true }, EXAMPLE);
  }
  router.post('/my-setup/sequence/preview', auth, async (req, res) => {
    try {
      if (!hasRole(req, ...SEQUENCE_ROLES)) return res.status(403).json({ error: 'Only managers and admins write an outreach sequence.' });
      const b = req.body || {}, uid = req.user.id;
      const lead = await sampleLead(req);
      const vars = buildEmailVars({ job: lead.job, contact: lead.contact, senderDisplayName: DEFER_SENDER });
      // The engine's own choice: version 1 or one of the versions, at random (services/sequence-versions.js).
      const settings = {};
      (Array.isArray(b.versions) ? b.versions : []).slice(0, 2).forEach((v, i) => {
        settings[versions.key(uid, 'o1', i + 2, 'subject')] = String((v && v.subject) || '');
        settings[versions.key(uid, 'o1', i + 2, 'body')] = String((v && v.body) || '');
      });
      const pick = versions.pick(settings, uid, 'o1', { subject: String(b.subject || ''), body: String(b.body || '') }, Number.isFinite(Number(b.rand)) ? Number(b.rand) : Math.random());
      const subject = fillTemplate(pick.subject, vars), body = fillTemplate(pick.body, vars);
      const missing = unresolvedVars(subject + '\n' + body);
      res.json({
        subject, body, version: Number(pick.id.replace('own_v', '')), versions: 1 + versions.extraVersions(settings, uid, 'o1').length,
        to: { name: [lead.contact.first_name, lead.contact.last_name].filter(Boolean).join(' '), company: (lead.job.company && lead.job.company.name) || '', email: lead.contact.email },
        example: lead.example, missing,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // "Show me what a lead gets" in AI mode (R-259): the AI writes the first email and follow-up 1 for one real lead of the person's,
  // with the answers ON SCREEN (not yet saved), the same writer and checker the send uses. No AI today, or a draft the checker
  // rejected: said plainly, and the backup is what that lead would get. A few tries an hour per person — each one is two AI calls.
  const TEST_LIMIT = 6, TEST_WINDOW_MS = 60 * 60 * 1000, testLog = new Map();
  async function orgName(req) {
    try { const { data } = await supabase.from('organizations').select('name').eq('id', req.orgId).maybeSingle(); return (data && data.name) || ''; }
    catch (_) { return ''; }
  }
  router.post('/my-setup/sequence/ai-test', auth, async (req, res) => {
    try {
      if (!hasRole(req, ...SEQUENCE_ROLES)) return res.status(403).json({ error: 'Only managers and admins write an outreach sequence.' });
      const uid = req.user.id, b = req.body || {};
      const teach = aiTeach.normalize(b.teach);
      const why = aiTeach.problem(teach);
      if (why) return res.status(400).json({ error: why });
      const lead = await sampleLead(req);
      const to = { name: [lead.contact.first_name, lead.contact.last_name].filter(Boolean).join(' '), company: (lead.job.company && lead.job.company.name) || '', email: lead.contact.email };
      const posting = engineDraft.postingOf(lead.job);
      const base = { to, example: lead.example, read: posting.slice(0, 4000) };
      const avail = await aiProvider.availability(supabase, { feature: 'sequence_test', orgId: req.orgId }).catch(() => ({ available: false, reason: 'not_configured' }));
      if (!avail.available) return res.json(Object.assign(base, { ai: false, reason: avail.reason }));
      const now = Date.now(), log = (testLog.get(uid) || []).filter((t) => now - t < TEST_WINDOW_MS);
      if (log.length >= TEST_LIMIT) return res.status(429).json({ error: `That is ${TEST_LIMIT} tests this hour — try again a little later.` });
      testLog.set(uid, log.concat(now));
      const style = await aiStyle.effectiveFor(supabase, { userId: uid, orgId: req.orgId }).catch(() => '');
      const boxes = await myMailboxes(uid);
      const companyName = (await myCompany(boxes)) || (await orgName(req)) || outreachGen.DEFAULT_COMPANY;
      const input = engineDraft.engineInput({ job: lead.job, contact: lead.contact, sender: { name: req.user.name || 'You', email: req.user.email || '' } });
      const complete = (system, prompt) => aiProvider.complete(supabase, { system, prompt, maxTokens: 800, orgId: req.orgId, feature: 'sequence_test' });
      const first = await engineDraft.draftFirstEmail({
        gen: outreachGen, input, companyName, omitSignOff: true,
        complete: (system, prompt) => complete(system + aiStyle.styleBlock(style) + aiTeach.firstBlock(teach), prompt),
      });
      if (!first.body) return res.json(Object.assign(base, { ai: true, written: false, reason: first.skipped, violations: first.violations || [] }));
      const unsender = (t) => String(t || '').split('{{senderemail}}').join(req.user.email || '').split('{{sender}}').join(req.user.name || 'You');
      const out = Object.assign(base, { ai: true, written: true, subject: unsender(first.subject), body: unsender(first.body) });
      if (aiTeach.followupFor(teach, 1)) {
        const fu = await aiTeach.writeFollowup({
          gen: outreachGen, teach, step: 1, input, firstEmail: { subject: out.subject, body: out.body }, omitSignOff: true,
          complete: (system, prompt) => complete(system + aiStyle.styleBlock(style), prompt),
        });
        out.followup = fu.body ? { written: true, body: fu.body } : { written: false, reason: fu.skipped };
      }
      res.json(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // AI help, held to the same checker as the sequence builder's (services/sequence-draft.js): "draft" from one sentence, or a
  // "variant" that keeps every {{detail}}. No AI, nothing left today, or a broken draft: the person's text or a starter, said so.
  router.post('/my-setup/sequence/draft', auth, async (req, res) => {
    try {
      if (!hasRole(req, ...SEQUENCE_ROLES)) return res.status(403).json({ error: 'Only managers and admins write an outreach sequence.' });
      const b = req.body || {};
      const mode = b.mode === 'variant' ? 'variant' : 'draft';
      const result = await sequenceDraft.draft({
        prompt: String(b.prompt || '').trim().slice(0, 600),
        purpose: sequenceDraft.purposeOf(b.purpose), mode,
        subject: String(b.subject || '').slice(0, 300), body: String(b.body || '').slice(0, 8000),
        complete: (system, user) => aiProvider.complete(supabase, { feature: 'sequence_draft', orgId: req.orgId, maxTokens: 1100, system, prompt: user }),
      });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
