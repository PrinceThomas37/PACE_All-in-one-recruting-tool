'use strict';
// ============================================================================
// CANDIDATE OUTREACH — the API behind the Email page's Compose → Candidates side.
//
// Pick a job order we already own, see the candidate pool ranked against it,
// pick the people, queue the emails. The writing itself is in
// services/candidate-outreach.js (pure); this file is the database, the AI
// call, the queue and the drip.
//
// THREE THINGS THIS FILE IS CAREFUL ABOUT
//
// 1. ONE AI CALL PER JOB, NOT PER CANDIDATE. The brief is written once and
//    cached on the job order (migration 042). See the note in the service.
//
// 2. THE BODY IS STORED WITH {{sender}} UNRENDERED. These emails are queued and
//    drained later, and the mailbox that ends up sending can differ from the
//    one that was current when the recruiter clicked. Every read goes through
//    renderStoredEmail(row, mailbox) — including the preview, which resolves
//    from the SELECTED SENDING MAILBOX and never from the logged-in session. A
//    preview keyed off the session user would have hidden the Session 14 bug
//    rather than caught it.
//
// 3. REGISTRATION ORDER. Literal paths sit above any :param route of the same
//    prefix. test/route-shadowing-smoke.mjs fails the build otherwise.
// ============================================================================

const express = require('express');
const aiProvider = require('../services/ai-provider');
const gen = require('../services/candidate-outreach');
const matchEngine = require('../match-engine');
const { emailSyntaxValid } = require('../email-validation');
const { newToken: newTrackToken, injectPixel: injectTrackPixel } = require('../email-tracking');
const { fillSignatureHtml } = require('../email-signature');
const { renderStoredEmail } = require('../email-vars');
const { resolveBaseUrl } = require('../email-tracking');
const { clientIp } = require('../middleware/rate-limit');

// The drip. One email per candidate every 75-105 seconds, jittered, so a batch
// of twenty does not arrive as twenty near-identical messages inside a minute —
// which is precisely the pattern that gets a sending domain flagged.
const DRIP_MIN_MS = 75 * 1000;
const DRIP_MAX_MS = 105 * 1000;

// ⚠ A BACKLOG MUST NOT BECOME A BURST. `send_after` spaces a batch at queue
// time, but if the candidate window was shut when those slots came round, every
// row is due the moment it opens — and a loop with no pause would then fire the
// whole backlog back to back, which is exactly the pattern that gets a sending
// domain flagged. The queue-time spacing states the intent; this enforces it.
//
// So the drain sends at most a handful per tick and SLEEPS between them, the
// same way the leads engine's waitForMailboxSlot does. Six sends at 75-105s is
// under eight minutes, which fits inside the ten-minute tick without one run
// overlapping the next (engine-runs.js also guards that, but not overlapping in
// the first place is better than being stopped).
const DRAIN_PER_TICK = 6;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = (ctx) => {
  const router = express.Router();
  const {
    supabase, auth, today, withOrg, orgStamp, buildHtmlEmailBody, getMailboxSignature,
    loadSuppressedSet, recruiterSendingMailbox, sendMailboxNewMessage, connectedMailboxById,
    loadMailboxDelivState, warmupLimit, settingsConfig,
    isSendingPaused, isManagerPaused,
    getTimezoneFromLocation, LEAD_TZ_IANA, friendlySendError, logActivity,
    addToSuppression, pixelLimiter,
  } = ctx;

  const txt = (v) => String(v == null ? '' : v).trim();

  async function orgCompanyName(req) {
    try {
      if (!req.orgId) return 'our team';
      const { data } = await supabase.from('organizations').select('name').eq('id', req.orgId).maybeSingle();
      return (data && data.name) || 'our team';
    } catch (_) { return 'our team'; }
  }

  // The signature, filled from the MAILBOX — never from the session. Same rule
  // and the same helper shape as routes/outreach-generator.js.
  async function mailboxSignature(mailbox, userId) {
    if (!mailbox) return '';
    try {
      const raw = await getMailboxSignature(mailbox.id, userId);
      return fillSignatureHtml(raw, {
        displayName: mailbox.display_name || mailbox.email_address || '',
        emailAddress: mailbox.email_address || '',
      });
    } catch (_) { return ''; }
  }

  // ⚠ THE PREVIEW AND THE QUEUE MUST READ THE BRIEF THE SAME WAY.
  // They did not. The preview built its input without a `brief` at all, so
  // draftParts fell back to the RULES brief, while the queue read the cached AI
  // one — the screen showed one email and a different email went out. That is
  // the exact failure a preview exists to prevent, and it hid the real reason
  // three of four candidates were skipped in the first live batch (the AI brief
  // said "2-3 years of field experience"; the rules brief did not).
  // One loader, called by both. Do not inline this again.
  function briefFor(job) {
    if (!job) return null;
    const raw = txt(job.outreach_brief);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p && txt(p.hook)) {
          return { hook: p.hook, detail: p.detail, engine: job.outreach_brief_engine || 'rules' };
        }
      } catch (_) { /* fall through to the rules brief */ }
    }
    return gen.rulesJobBrief(job);
  }

  async function lastAiError(feature) {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'ai_last_error').maybeSingle();
      const rec = data && JSON.parse(data.value);
      const f = rec && rec.feature === feature && (rec.failures || [])[0];
      return f ? `${f.provider}/${f.model}: ${f.error}` : null;
    } catch (_) { return null; }
  }

  // ── WHAT TIME IS IT WHERE THE CANDIDATE IS ───────────────────────────────
  // The window is judged in THEIR local day and hour, never the server's. A
  // Texas candidate and a Connecticut one on the same list get different
  // answers, which is the whole point.
  function localPartsFor(place, when) {
    const tz = getTimezoneFromLocation(place || '');
    const iana = (LEAD_TZ_IANA && LEAD_TZ_IANA[tz]) || 'America/New_York';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: iana, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(when || new Date());
    const get = (t) => (parts.find(p => p.type === t) || {}).value;
    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = days[get('weekday')];
    const hour = parseInt(get('hour'), 10) % 24;
    const minute = parseInt(get('minute'), 10);
    return { tz, day: Number.isFinite(day) ? day : 1, minutes: (hour * 60) + (minute || 0) };
  }

  // The candidate window, read through config/settings.js — the SAME schema the
  // Admin → System settings screen writes, so the hours an admin types and the
  // hours the drain obeys cannot be two different numbers. That schema owns the
  // defaults, the range and the validation; this only assembles the pair.
  //
  // Cached briefly because the drain asks once per tick and the queue endpoint
  // once per request, and neither wants a settings round-trip per row.
  //
  // ⚠ AND THE WHOLE WINDOW IS A SWITCH THAT IS OFF BY DEFAULT (owner's call,
  // 2026-09-09 evening, reversing their own call from that morning: "remove the
  // barricade of timezone for candidate emails ... Only the outreach goes
  // within the time zone"). Eight real emails sat pending because every one of
  // those candidates was below the 17:00 opening in their own state.
  // The hours are kept and still obeyed WHEN THE SWITCH IS ON, because a
  // decision reversed within a day can be reversed again — and a setting that
  // silently does nothing is worse than no setting, so the four hour entries in
  // Admin → System settings are only consulted while `enabled` is true, and the
  // sender payload says which of the two is in force.
  let windowCache = { at: 0, cfg: null };
  async function candidateWindow() {
    if (windowCache.cfg && Date.now() - windowCache.at < 60000) return windowCache.cfg;
    let enabled = false;
    try {
      const { data } = await supabase.from('app_settings').select('value')
        .eq('key', gen.CANDIDATE_SEND_WINDOW_KEY).maybeSingle();
      enabled = gen.windowEnabledFromSetting(data && data.value);
    } catch (_) { enabled = false; }   // unreadable settings must not re-impose it
    let cfg = { enabled, weekday: gen.CANDIDATE_WINDOW.weekday.slice(), weekend: gen.CANDIDATE_WINDOW.weekend.slice() };
    if (!enabled) { windowCache = { at: Date.now(), cfg: gen.normalizeWindow(cfg) }; return windowCache.cfg; }
    try {
      const [wds, wde, wes, wee] = await Promise.all([
        settingsConfig.getSetting(supabase, 'candidate_window_weekday_start'),
        settingsConfig.getSetting(supabase, 'candidate_window_weekday_end'),
        settingsConfig.getSetting(supabase, 'candidate_window_weekend_start'),
        settingsConfig.getSetting(supabase, 'candidate_window_weekend_end'),
      ]);
      cfg = { enabled: true, weekday: [wds, wde], weekend: [wes, wee] };
    } catch (_) { /* the schema defaults are the answer if settings are unreadable */ }
    windowCache = { at: Date.now(), cfg: gen.normalizeWindow(cfg) };
    return windowCache.cfg;
  }

  const placeOf = (c) => txt((c || {}).current_location) ||
    [(c || {}).city, (c || {}).state].filter(Boolean).join(', ');

  // ══════════════════════════════════════════════════════════════════════════
  // THE ANSWER — two links in the email, and the page they open
  //
  // Public: no session, because the person answering is a candidate who has
  // never signed in to anything of ours and never will.
  //
  // ⚠ THE LINK MUST NOT RECORD THE ANSWER. Corporate mail security — Outlook
  // Safe Links, Mimecast, Proofpoint — fetches every URL in an inbound message
  // to check it is safe. A GET that recorded would mark candidates interested,
  // or opted out, before a human ever opened the email, and we would never know
  // it had happened. So GET renders a page with real buttons on it and writes
  // nothing; the POST from that page is the answer.
  //
  // "NOT FOR ME" IS ABOUT THIS JOB, NOT ABOUT US. Turning one decline into a
  // global suppression would throw away a good candidate for every future role
  // over a single "wrong city", which is not what they said and not what they
  // meant. A real, global opt-out exists — it is the quieter third choice on
  // the page, and only that one writes to suppression_list.
  // ══════════════════════════════════════════════════════════════════════════

  const ANSWER_LABELS = {
    interested: 'Interested',
    not_interested: 'Not this one',
    opted_out: 'Opted out of all roles',
  };

  // One page, one look, no external assets — this is opened from a mail client
  // on a phone as often as not, and a stylesheet that fails to load must not be
  // able to make it unreadable.
  function answerPage({ title, lead, body, tone }) {
    const bar = tone === 'good' ? '#166534' : tone === 'quiet' ? '#64748b' : '#0f172a';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex,nofollow">' +
      '<title>' + gen.escapeHtml(title) + '</title></head>' +
      '<body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#0f172a">' +
      '<div style="max-width:520px;margin:0 auto;padding:32px 18px">' +
      '<div style="background:#fff;border-radius:14px;padding:26px 24px;box-shadow:0 1px 3px rgba(15,23,42,.12)">' +
        '<div style="height:4px;width:44px;border-radius:99px;background:' + bar + ';margin-bottom:18px"></div>' +
        '<h1 style="margin:0 0 10px;font-size:20px;line-height:1.3">' + gen.escapeHtml(title) + '</h1>' +
        (lead ? '<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#475569">' + lead + '</p>' : '') +
        body +
      '</div>' +
      '<p style="margin:16px 4px 0;font-size:12px;color:#94a3b8">You are seeing this because we emailed you about a role. Nothing here signs you up for anything.</p>' +
      '</div></body></html>';
  }

  const sendPage = (res, status, html) => {
    res.status(status);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    // This page is a private answer to one person; it must never be framed by
    // somebody else's site or indexed.
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.end(html);
  };

  // Deliberately identical for an unknown token, a deleted row and a malformed
  // one. A token is 32 random hex characters; someone guessing must learn
  // nothing from the difference between "wrong" and "gone".
  const gonePage = (res) => sendPage(res, 404, answerPage({
    title: 'This link is no longer active',
    lead: 'It may have expired, or the role may have been filled. If you were in the middle of replying, just reply to the email instead and it will reach us.',
    body: '', tone: 'quiet',
  }));

  // A PUBLIC PAGE MAY NEVER HANG ON THE DATABASE. Measured with an unreachable
  // Supabase: supabase-js retries a refused connection for SEVEN SECONDS before
  // giving up. That is a spinner on a candidate's phone, on the one screen where
  // we are asking them for a favour — and they will close it. So every database
  // call behind these routes is bounded, and the timeout falls through to the
  // same honest page as any other failure. `null` here means "we could not find
  // out", which the callers already handle.
  const DB_TIMEOUT_MS = 4000;
  function withTimeout(promise, ms) {
    return Promise.race([
      Promise.resolve(promise).catch(() => null),
      new Promise(resolve => setTimeout(() => resolve(undefined), ms || DB_TIMEOUT_MS)),
    ]);
  }

  // Not a success page and not an error page — the honest one. It never blames
  // the candidate and it always leaves them a route that works.
  const unsurePage = (res) => sendPage(res, 200, answerPage({
    title: 'We could not save that just now',
    lead: 'Our end is having a moment. Reply to the email instead — a recruiter reads those — or tap the button again in a minute.',
    body: '', tone: 'quiet',
  }));

  async function loadAnswerRow(token) {
    // A malformed token is rejected here, before any query — which also means a
    // scanner walking the URL space costs us nothing.
    if (!/^[a-f0-9]{8,64}$/i.test(String(token || ''))) return null;
    const res = await withTimeout(supabase.from('candidate_outreach')
      .select('id,candidate_id,job_order_id,to_email,response,responded_at,sent_by,org_id,status')
      .eq('track_token', token).maybeSingle());
    return (res && res.data) || null;
  }

  async function jobTitleFor(row) {
    if (!row.job_order_id) return '';
    try {
      const res = await withTimeout(supabase.from('job_orders')
        .select('job_title,client,city,state').eq('id', row.job_order_id).maybeSingle());
      const data = res && res.data;
      if (!data) return '';   // the page reads fine without the role line
      const place = [data.city, data.state].filter(Boolean).join(', ');
      return [data.job_title, data.client, place].filter(Boolean).join(' · ');
    } catch (_) { return ''; }
  }

  router.get('/i/:token', async (req, res) => {
    try {
      // Rate limited so a token cannot be brute-forced by scanning. Unlike the
      // pixel, a 429 here is fine: a person waits and taps again, and there is
      // no broken image for them to see.
      if (pixelLimiter && !pixelLimiter.consume(`answer:${clientIp(req)}`).allowed) {
        return sendPage(res, 429, answerPage({
          title: 'One moment', lead: 'Too many requests from this connection just now. Wait a few seconds and tap the button again.', body: '', tone: 'quiet',
        }));
      }
      const token = String(req.params.token || '').trim();
      const row = await loadAnswerRow(token);
      if (!row) return gonePage(res);

      const role = await jobTitleFor(row);
      const t = gen.escapeHtml(token);
      const pre = String(req.query.a || '') === 'no' ? 'no' : String(req.query.a || '') === 'yes' ? 'yes' : '';

      // ALREADY ANSWERED: say what we recorded and let them change it. Somebody
      // who tapped the wrong button on a phone must be able to fix it — the
      // alternative is a good candidate written off by a mis-tap.
      const answered = row.response
        ? '<p style="margin:0 0 16px;padding:11px 14px;background:#f8fafc;border-radius:9px;font-size:14px;color:#334155">' +
          'You already told us: <strong>' + gen.escapeHtml(ANSWER_LABELS[row.response] || row.response) + '</strong>. ' +
          'You can change it below.</p>'
        : '';

      const form = (action, label, style) =>
        '<form method="post" action="/i/' + t + '/' + action + '" style="display:inline-block;margin:0 8px 10px 0">' +
          '<button type="submit" style="' + style + '">' + label + '</button></form>';

      const primary = 'cursor:pointer;font-family:inherit;font-size:15px;font-weight:600;padding:13px 22px;border-radius:9px;border:1px solid #166534;background:#166534;color:#fff';
      const secondary = 'cursor:pointer;font-family:inherit;font-size:15px;font-weight:600;padding:13px 22px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;color:#334155';
      const quiet = 'cursor:pointer;font-family:inherit;font-size:13px;padding:0;border:0;background:none;color:#64748b;text-decoration:underline';

      sendPage(res, 200, answerPage({
        title: pre === 'no' ? 'Not this one?' : 'Interested in this role?',
        lead: role ? '<strong style="color:#0f172a">' + gen.escapeHtml(role) + '</strong>' : 'The role we emailed you about.',
        tone: pre === 'no' ? 'quiet' : 'good',
        body: answered +
          // The tap in the email is a HINT, never the answer — it only decides
          // which button is emphasised here.
          '<p style="margin:0 0 14px;font-size:14px;color:#475569">One tap and a recruiter will pick it up from there.</p>' +
          form('interested', 'Yes, I am interested', pre === 'no' ? secondary : primary) +
          form('not-interested', 'Not this one', pre === 'no' ? primary : secondary) +
          '<div style="margin-top:16px;padding-top:14px;border-top:1px solid #e2e8f0">' +
            form('opt-out', 'Do not email me about any roles', quiet) +
            '<div style="font-size:12px;color:#94a3b8;margin-top:2px">Saying no to this role does not remove you from our list — this does.</div>' +
          '</div>',
      }));
    } catch (_) { gonePage(res); }
  });

  // Recording an answer must never fail loudly at the candidate. If the write
  // breaks, they still see that we heard them — and the recruiter still has the
  // reply path. A 500 here reads as "this company is broken".
  async function recordAnswer(req, res, response, opts) {
    const o = opts || {};
    try {
      const token = String(req.params.token || '').trim();
      const row = await loadAnswerRow(token);
      if (!row) return gonePage(res);

      const wrote = await withTimeout(supabase.from('candidate_outreach')
        .update({ response, responded_at: new Date() }).eq('id', row.id));
      // NEVER SAY "DONE" FOR A WRITE THAT DID NOT HAPPEN. If the update timed
      // out or errored, the candidate is told the truth and given the path that
      // still works — replying to the email a human is already watching.
      if (wrote === undefined || (wrote && wrote.error)) return unsurePage(res);

      // A tap IS an answer, so the candidate record shows they came back.
      await withTimeout(supabase.from('candidates')
        .update({ last_reply_at: new Date() }).eq('id', row.candidate_id));

      if (o.suppress && row.to_email) {
        // The real opt-out, and the only branch that writes to suppression_list.
        await withTimeout(addToSuppression(row.to_email, 'unsubscribe', 'candidate_outreach', row.sent_by, 'Opted out from a candidate outreach email'));
        // Anything still queued for them stops. Leaving it would send more mail
        // to somebody who just asked us not to, which is the one outcome an
        // opt-out exists to prevent.
        await withTimeout(supabase.from('candidate_outreach')
          .update({ status: 'skipped', fail_reason: 'recipient opted out' })
          .eq('status', 'pending').ilike('to_email', row.to_email));
      }

      if (logActivity && row.job_order_id) {
        await withTimeout(logActivity(null, null, row.sent_by, 'candidate_answer',
          `${row.to_email} answered: ${ANSWER_LABELS[response] || response}`));
      }

      sendPage(res, 200, answerPage({
        title: o.title, lead: o.lead, tone: o.tone,
        body: '<p style="margin:0;font-size:14px;color:#475569">You can close this page.</p>',
      }));
    } catch (_) {
      unsurePage(res);
    }
  }

  router.post('/i/:token/interested', (req, res) => recordAnswer(req, res, 'interested', {
    title: 'Thanks — a recruiter will be in touch',
    lead: 'We have passed this straight to the recruiter working the role. Expect to hear from them shortly.',
    tone: 'good',
  }));

  router.post('/i/:token/not-interested', (req, res) => recordAnswer(req, res, 'not_interested', {
    title: 'Understood — we will leave this one',
    lead: 'We have noted that this role is not for you. We may still let you know about a different one; use the opt-out in any email if you would rather we did not.',
    tone: 'quiet',
  }));

  router.post('/i/:token/opt-out', (req, res) => recordAnswer(req, res, 'opted_out', {
    title: 'Done — you are off the list',
    lead: 'We will not email you about roles again, and anything already queued for you has been stopped.',
    tone: 'quiet',
  }));

  // ── WHICH JOB ────────────────────────────────────────────────────────────
  // Literal path, registered before anything with a :param under the same
  // prefix. Active jobs first: you do not cold-email candidates about a role
  // that is filled.
  router.get('/candidate-outreach/jobs', auth, async (req, res) => {
    try {
      const q = txt(req.query.q);
      let query = withOrg(supabase.from('job_orders')
        .select('id,job_code,job_title,client,city,state,country,status,positions,outreach_brief_at')
        .is('deleted_at', null), req);
      if (q) query = query.or(`job_title.ilike.%${q}%,client.ilike.%${q}%,job_code.ilike.%${q}%`);
      const { data } = await query.order('created_at', { ascending: false }).limit(40);
      const rows = (data || []).map(j => ({
        id: j.id, job_code: j.job_code, job_title: j.job_title, client: j.client || '',
        place: [j.city, j.state].filter(Boolean).join(', ') || j.country || '',
        status: j.status, positions: j.positions,
        has_brief: !!j.outreach_brief_at,
      }));
      // Active first, then everything else — both are returned, because a
      // recruiter chasing a role that just went on hold still needs it.
      rows.sort((a, b) => (a.status === 'Active' ? 0 : 1) - (b.status === 'Active' ? 0 : 1));
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // What is already queued or sent, so the page can show state without
  // guessing. Literal, so it goes above /candidate-outreach/:id-shaped routes.
  router.get('/candidate-outreach/queue', auth, async (req, res) => {
    try {
      // `body` comes back too: the exact text that went to this person. It has
      // always been stored and was never returned, so the only way to know what
      // a candidate actually received was to look in the mailbox's Sent folder.
      let q = withOrg(supabase.from('candidate_outreach')
        .select('id,candidate_id,job_order_id,to_email,subject,body,status,send_after,sent_at,fail_reason,response,responded_at,angle,engine,track_token,candidates(full_name,current_location,city,state)')
        .eq('sent_by', req.user.id), req);
      const jobId = txt(req.query.job_order_id);
      if (jobId) q = q.eq('job_order_id', jobId);
      const { data } = await q.order('created_at', { ascending: false }).limit(100);
      const rows = data || [];

      // ── WHY IT HAS NOT GONE YET ──────────────────────────────────────────
      // A pending row whose due time has passed looks broken. It usually is not:
      // the drip slot came round, the drain picked it up, and the CANDIDATE's
      // local send window was shut, so it waits. The owner had to ask which of
      // those it was — the app knew and would not say, which is the same
      // failure as reporting a skip only as "failed check".
      const now = new Date();
      const win = await candidateWindow();
      const paused = !!(isSendingPaused && isSendingPaused());
      const waitFor = (r) => {
        if (r.status !== 'pending') return null;
        if (paused) return { reason: 'paused', text: 'Sending is paused for your team.' };
        if (new Date(r.send_after) > now) return { reason: 'queued', text: 'Waiting for its turn in the drip.' };
        const place = placeOf(r.candidates);
        const at = localPartsFor(place, now);
        const state = gen.candidateWindowState(at.day, at.minutes, win);
        if (state.open) return { reason: 'due', text: 'Due now — goes on the next pass.' };
        const opens = gen.describeWindowOpens(state, at.day);
        return {
          reason: 'window',
          // Their hours, not ours: "we are not emailing them at 9am on a
          // Tuesday because they are at work" is the whole reason for the wait.
          text: `${place || 'They'} — outside candidate sending hours. Goes ${opens}.`,
          opens_label: opens, place: place || null,
        };
      };

      res.json(rows.map(r => ({
        id: r.id, candidate_id: r.candidate_id, job_order_id: r.job_order_id,
        name: (r.candidates && r.candidates.full_name) || '', to_email: r.to_email,
        subject: r.subject, body: r.body || '', status: r.status, send_after: r.send_after, sent_at: r.sent_at,
        fail_reason: r.fail_reason, response: r.response, responded_at: r.responded_at,
        angle: r.angle, engine: r.engine, track_token: r.track_token,
        wait: waitFor(r),
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Who this will send as, and whether an AI writer is available. The page must
  // be able to say "this will send from X" before anybody writes anything.
  router.get('/candidate-outreach/sender', auth, async (req, res) => {
    try {
      const [mailbox, companyName] = await Promise.all([
        recruiterSendingMailbox(req.user.id), orgCompanyName(req)
      ]);
      // The page must be able to state the sending hours BEFORE anything is
      // queued. The owner queued a batch at 3am and then had to ask why nothing
      // moved; "they go out in the evening" belongs on screen beforehand, and
      // it comes from the same config the drain obeys so the two cannot drift.
      const win = await candidateWindow();
      res.json({
        company_name: companyName,
        ai: await aiProvider.isAvailable(supabase),
        mailbox: mailbox ? {
          id: mailbox.id, email: mailbox.email_address,
          display_name: mailbox.display_name || null, platform: mailbox.platform || 'Microsoft',
        } : null,
        signature_html: await mailboxSignature(mailbox, req.user.id),
        // ⚠ WHEN THE WINDOW IS OFF THIS MUST STOP PROMISING ONE. The sentence
        // on screen was "Candidates are emailed in their own local free time —
        // 5:00 PM-9:00 PM on weekdays..." while nothing was waiting for any
        // hour at all. `enabled` and `sentence` carry the whole claim so a page
        // never has to assemble one around a half-truth.
        window: {
          enabled: !!win.enabled,
          weekday: win.weekday, weekend: win.weekend,
          label: win.enabled
            ? `${gen.clockLabel(win.weekday[0] * 60)}–${gen.clockLabel(win.weekday[1] * 60)} on weekdays, ` +
              `${gen.clockLabel(win.weekend[0] * 60)}–${gen.clockLabel(win.weekend[1] * 60)} at weekends`
            : 'any time of day',
          sentence: win.enabled
            ? 'Candidates are emailed in their own local free time — ' +
              `${gen.clockLabel(win.weekday[0] * 60)}–${gen.clockLabel(win.weekday[1] * 60)} on weekdays, ` +
              `${gen.clockLabel(win.weekend[0] * 60)}–${gen.clockLabel(win.weekend[1] * 60)} at weekends, ` +
              'in their own timezone — so a batch queued now may wait.'
            : 'Candidates are emailed at any hour, about one every 90 seconds, ' +
              'starting as soon as this batch is queued.',
        },
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── THE RANKED POOL ──────────────────────────────────────────────────────
  // The same ranking the job-order page shows, returned with the outreach state
  // attached so the list can grey out anyone already emailed about this job.
  // Reuses match-engine directly rather than calling our own HTTP endpoint.
  router.get('/candidate-outreach/jobs/:id/candidates', auth, async (req, res) => {
    try {
      const { data: job } = await withOrg(supabase.from('job_orders')
        .select('*').eq('id', req.params.id).is('deleted_at', null), req).maybeSingle();
      if (!job) return res.status(404).json({ error: 'Job order not found' });

      const q = txt(req.query.q).replace(/[,()]/g, ' ').trim();
      let query = withOrg(supabase.from('candidates')
        .select('id,candidate_code,full_name,email,current_title,current_location,city,state,skills,experience_years,applicant_status,last_contact_at')
        .is('deleted_at', null), req);
      if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,current_title.ilike.%${q}%`);
      const { data: pool } = await query.limit(2000);

      const ranked = matchEngine.rankCandidates(pool || [], job, {});

      // Who has already had this ask. The unique index refuses a duplicate at
      // insert time; showing it here means the recruiter never picks somebody
      // only to be told no afterwards.
      const { data: already } = await withOrg(supabase.from('candidate_outreach')
        .select('candidate_id,status,response,sent_at').eq('job_order_id', job.id), req);
      const seen = {};
      (already || []).forEach(r => { seen[r.candidate_id] = r; });

      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      res.json({
        job_order: {
          id: job.id, job_code: job.job_code, job_title: job.job_title,
          client: job.client || '', place: [job.city, job.state].filter(Boolean).join(', ') || job.country || '',
        },
        // Surfaced so the page can say WHY scores look thin rather than leaving
        // the recruiter to wonder — a job with no skills scores on title and
        // location alone.
        scoreable: Boolean(txt(job.primary_skills) || txt(job.secondary_skills)),
        pool_size: (pool || []).length,
        results: ranked.slice(0, limit).map(r => {
          const c = r.candidate || {};
          const prior = seen[c.id] || null;
          return {
            candidate_id: c.id, name: c.full_name, email: c.email || '',
            title: c.current_title || '', location: c.current_location || [c.city, c.state].filter(Boolean).join(', '),
            experience_years: c.experience_years, applicant_status: c.applicant_status || '',
            score: r.score, band: r.band, reasons: r.reasons || [],
            // No email address means no outreach. Said plainly here so the row
            // can explain itself instead of silently failing at queue time.
            emailable: !!(c.email && emailSyntaxValid(c.email)),
            prior: prior ? { status: prior.status, response: prior.response, sent_at: prior.sent_at } : null,
          };
        }),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── THE JOB BRIEF — ONE AI CALL, REUSED BY EVERY CANDIDATE ───────────────
  router.get('/candidate-outreach/jobs/:id/brief', auth, async (req, res) => {
    try {
      const { data: job } = await withOrg(supabase.from('job_orders')
        .select('*').eq('id', req.params.id).is('deleted_at', null), req).maybeSingle();
      if (!job) return res.status(404).json({ error: 'Job order not found' });
      const cached = txt(job.outreach_brief);
      if (cached) {
        let parsed = null;
        try { parsed = JSON.parse(cached); } catch (_) { /* fall through to rules */ }
        if (parsed && txt(parsed.hook)) {
          return res.json({ ...parsed, engine: job.outreach_brief_engine || 'rules', written_at: job.outreach_brief_at, cached: true });
        }
      }
      res.json({ ...gen.rulesJobBrief(job), cached: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/candidate-outreach/jobs/:id/brief', auth, async (req, res) => {
    try {
      const { data: job } = await withOrg(supabase.from('job_orders')
        .select('*').eq('id', req.params.id).is('deleted_at', null), req).maybeSingle();
      if (!job) return res.status(404).json({ error: 'Job order not found' });

      const rules = gen.rulesJobBrief(job);
      const store = async (brief) => {
        try {
          await supabase.from('job_orders').update({
            outreach_brief: JSON.stringify({ hook: brief.hook, detail: brief.detail }),
            outreach_brief_at: new Date(),
            outreach_brief_engine: brief.engine,
          }).eq('id', job.id);
        } catch (_) { /* caching is a saving, never the point of the request */ }
      };

      if (!(await aiProvider.isAvailable(supabase))) {
        await store(rules);
        return res.json({ ...rules, ai_available: false });
      }

      const system = gen.buildBriefSystemPrompt();
      const ask = (prompt) => aiProvider.complete(supabase, {
        maxTokens: 500, feature: 'candidate_brief', orgId: req.orgId, system, prompt,
      });

      // The job description is the one uncapped input here — a pasted or
      // imported JD can be enormous. Trim the AI's copy; the rules writer still
      // reads the fields, which is where the facts it uses actually live.
      const payload = aiProvider.budget.trimToTokens(gen.buildBriefPayload(job), 2200);
      const out = await ask(payload);
      if (!out) {
        await store(rules);
        return res.json({ ...rules, ai_available: true, ai_error: 'ai_unavailable', ai_error_detail: await lastAiError('candidate_brief') });
      }
      const parsed = gen.parseBrief(out.text);
      if (!parsed) {
        await store(rules);
        return res.json({ ...rules, ai_available: true, ai_error: 'ai_unparseable' });
      }
      // A brief is written once and then read by every candidate on this job, so
      // it is checked once here rather than 25 times downstream. No repair turn:
      // a second call per job is affordable, but the rules brief is a genuinely
      // good answer and this is not prose a prospect judges us on.
      const check = gen.checkBrief(parsed, job);
      if (!check.ok) {
        await store(rules);
        return res.json({ ...rules, ai_available: true, ai_error: 'brief_rejected', violations: check.violations });
      }
      await store(parsed);
      res.json({ ...parsed, ai_available: true, engine_model: out.model, engine_provider: out.provider });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── PREVIEW ──────────────────────────────────────────────────────────────
  // Every angle for ONE candidate, rendered as the recipient will see it. The
  // {{sender}} tokens are resolved here from the mailbox that will actually
  // send — never from req.user — so what is on screen is what goes out.
  router.post('/candidate-outreach/preview', auth, async (req, res) => {
    try {
      const b = req.body || {};
      const candidateId = txt(b.candidate_id);
      if (!candidateId) return res.status(400).json({ error: 'candidate_id is required.' });

      const { data: candidate } = await withOrg(supabase.from('candidates')
        .select('id,full_name,first_name,email,current_title,current_location,city,state,skills,experience_years')
        .eq('id', candidateId).is('deleted_at', null), req).maybeSingle();
      if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

      let job = null;
      const jobId = txt(b.job_order_id);
      if (jobId) {
        const { data } = await withOrg(supabase.from('job_orders')
          .select('*').eq('id', jobId).is('deleted_at', null), req).maybeSingle();
        if (!data) return res.status(404).json({ error: 'Job order not found' });
        job = data;
      }

      const [mailbox, companyName] = await Promise.all([
        recruiterSendingMailbox(req.user.id), orgCompanyName(req)
      ]);
      const signatureHtml = await mailboxSignature(mailbox, req.user.id);
      const input = {
        candidate, job,
        brief: briefFor(job),
        reasons: job ? (matchEngine.rankCandidates([candidate], job, {})[0] || {}).reasons || [] : [],
        outreach_type: job ? 'job' : 'nurture',
      };
      const check = gen.validateInput(input);
      if (!check.ok) return res.status(400).json({ error: 'Missing: ' + check.missing.join(', ') + '.' });

      // hasButtons changes the closing line (the buttons carry the opt-out, so
      // "just say so" would contradict them) and tells the checker that the way
      // out is present even though it is not a sentence.
      const opts = { companyName, omitSignOff: !!signatureHtml.trim(), hasButtons: true };
      const variants = gen.rulesVariants(input, opts).map(v => {
        const q = gen.checkCandidateDraft(v, input, { angle: v.id, omitSignOff: opts.omitSignOff, hasButtons: true });
        const shown = renderStoredEmail({ subject: v.subject, body: v.email }, mailbox);
        return {
          ...v,
          // Stored form (tokens intact) and shown form (tokens resolved from the
          // sending mailbox) travel together. The page previews `preview_*` and
          // queues nothing — the server rebuilds the stored form at queue time.
          preview_subject: shown.subject, preview_email: shown.body,
          quality: { ok: q.ok, violations: q.violations },
        };
      });

      res.json({
        candidate: { id: candidate.id, name: candidate.full_name, email: candidate.email },
        job_order: job ? { id: job.id, job_title: job.job_title, client: job.client || '' } : null,
        sends_as: mailbox ? mailbox.email_address : null,
        signature_html: signatureHtml,
        // Previewed with a dead token: the page must show the buttons, because
        // approving an email you have not fully seen is the failure this whole
        // preview exists to prevent — but a live token in a preview is a link
        // that answers on somebody's behalf.
        buttons_html: gen.answerButtonsHtml(resolveBaseUrl(), 'preview', {}),
        variants,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── QUEUE ────────────────────────────────────────────────────────────────
  // Many candidates, one job, one angle. Nothing sends here: every row lands
  // `pending` with its own send_after, and the heartbeat drains what is due.
  router.post('/candidate-outreach/queue', auth, async (req, res) => {
    try {
      const b = req.body || {};
      const ids = Array.isArray(b.candidate_ids) ? b.candidate_ids.map(txt).filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ error: 'Pick at least one candidate.' });
      if (ids.length > 200) return res.status(400).json({ error: 'That is more than 200 people in one go. Split it up.' });

      const angle = txt(b.angle) || 'direct';
      const mailbox = await recruiterSendingMailbox(req.user.id);
      if (!mailbox) return res.status(409).json({ error: 'no_connected_mailbox' });

      let job = null;
      const jobId = txt(b.job_order_id);
      if (jobId) {
        const { data } = await withOrg(supabase.from('job_orders')
          .select('*').eq('id', jobId).is('deleted_at', null), req).maybeSingle();
        if (!data) return res.status(404).json({ error: 'Job order not found' });
        job = data;
      }
      if (!gen.angleBrief(angle)) return res.status(400).json({ error: 'Unknown angle.' });
      if (!job && angle !== 'nurture') return res.status(400).json({ error: 'That angle needs a job. Pick one, or use "Keeping in touch".' });

      const { data: candidates } = await withOrg(supabase.from('candidates')
        .select('id,full_name,first_name,email,current_title,current_location,city,state,skills,experience_years')
        .in('id', ids).is('deleted_at', null), req);

      const companyName = await orgCompanyName(req);
      const signatureHtml = await mailboxSignature(mailbox, req.user.id);
      const opts = { companyName, omitSignOff: !!signatureHtml.trim(), hasButtons: true };

      // Cached brief, read once for the whole batch — the entire reason this
      // feature is affordable. Same loader the preview uses.
      const brief = briefFor(job);

      const suppressed = await loadSuppressedSet((candidates || []).map(c => c.email).filter(Boolean));
      const ranked = job ? matchEngine.rankCandidates(candidates || [], job, {}) : [];
      const reasonsFor = {};
      ranked.forEach(r => { reasonsFor[r.candidate_id] = r.reasons || []; });

      const org = orgStamp(req);
      const rows = [];
      const skipped = [];
      let offset = 0;
      for (const c of (candidates || [])) {
        const to = txt(c.email);
        if (!to || !emailSyntaxValid(to)) { skipped.push({ candidate_id: c.id, name: c.full_name, reason: 'no_valid_email' }); continue; }
        if (suppressed.has(to.toLowerCase())) { skipped.push({ candidate_id: c.id, name: c.full_name, reason: 'opted_out' }); continue; }

        const input = { candidate: c, job, brief, reasons: reasonsFor[c.id] || [], outreach_type: job ? 'job' : 'nurture' };
        const variant = gen.rulesVariants(input, opts).find(v => v.id === angle);
        if (!variant) { skipped.push({ candidate_id: c.id, name: c.full_name, reason: 'angle_not_applicable' }); continue; }

        // The house check runs on every queued email, not just the previewed
        // one. A batch is where a bad draft does real damage, and the recruiter
        // only ever looked at one of them.
        const q = gen.checkCandidateDraft(variant, input, { angle, omitSignOff: opts.omitSignOff, hasButtons: true });
        if (!q.ok) {
          // THE SENTENCE, NOT THE CODE. The first live batch skipped three of
          // four people and told the recruiter only "failed check" — which is
          // the app knowing exactly what is wrong and refusing to say. The
          // instruction text is already written for a human; send that.
          skipped.push({
            candidate_id: c.id, name: c.full_name, reason: 'failed_check',
            detail: q.violations.map(x => x.instruction).join(' '),
            codes: q.violations.map(x => x.code).join(', '),
          });
          continue;
        }

        // Each row carries its own due time. Jittered rather than exactly 90s
        // apart, because a perfectly regular cadence is itself a signature.
        offset += DRIP_MIN_MS + Math.floor(Math.random() * (DRIP_MAX_MS - DRIP_MIN_MS));
        rows.push(Object.assign({
          candidate_id: c.id,
          job_order_id: job ? job.id : null,
          sent_by: req.user.id,
          mailbox_id: mailbox.id,
          to_email: to,
          subject: variant.subject,
          // STORED WITH {{sender}} INTACT — see the file header.
          body: variant.email,
          angle,
          engine: (brief && brief.engine) || 'rules',
          status: 'pending',
          send_after: new Date(Date.now() + offset),
        }, org));
      }

      if (!rows.length) return res.status(400).json({ error: 'Nothing could be queued.', skipped });

      // The unique index refuses anyone already asked about this job. Insert
      // one at a time so one duplicate does not lose the other twenty-four —
      // a batch insert is all-or-nothing and the whole point of the guard is
      // that hitting it should be harmless.
      const queued = [];
      for (const row of rows) {
        const { data, error } = await supabase.from('candidate_outreach').insert(row).select('id,candidate_id,send_after').single();
        if (error) {
          skipped.push({ candidate_id: row.candidate_id, reason: /duplicate|unique/i.test(error.message) ? 'already_asked' : error.message });
          continue;
        }
        queued.push(data);
      }

      // Add to the job's pipeline — ONLY if asked. Emailing somebody is not the
      // same as working them, and a board that fills with people who never
      // answered stops being worth looking at. The owner chose this default.
      let pipeline = null;
      if (job && b.add_to_pipeline && queued.length) {
        pipeline = { added: 0, existing: 0, failed: 0 };
        for (const row of queued) {
          try {
            const { data: existing } = await withOrg(supabase.from('submissions')
              .select('id').eq('candidate_id', row.candidate_id).eq('job_order_id', job.id)
              .is('deleted_at', null), req).maybeSingle();
            if (existing) {
              await supabase.from('candidate_outreach').update({ submission_id: existing.id }).eq('id', row.id);
              pipeline.existing++;
              continue;
            }
            const { data: made, error } = await supabase.from('submissions').insert(Object.assign({
              candidate_id: row.candidate_id, job_order_id: job.id,
              recruiter_id: req.user.id, stage: 'Sourced',
              notes: 'Added when candidate outreach was queued.',
            }, org)).select('id').single();
            if (error) throw error;
            await supabase.from('candidate_outreach').update({ submission_id: made.id }).eq('id', row.id);
            pipeline.added++;
          } catch (_) {
            // A pipeline failure must never report the queued email as failed —
            // the email is the deliverable and it is already queued.
            pipeline.failed++;
          }
        }
      }

      try {
        if (logActivity && job) await logActivity(null, null, req.user.id, 'candidate_outreach_queued',
          `${queued.length} candidate email(s) queued for ${job.job_title}`);
      } catch (_) { /* audit is best-effort */ }

      res.status(201).json({
        queued: queued.length,
        skipped,
        pipeline,
        mailbox: mailbox.email_address,
        // What the page tells the user, computed here so the two cannot drift.
        first_at: queued.length ? queued[0].send_after : null,
        last_at: queued.length ? queued[queued.length - 1].send_after : null,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Pull one back before it goes. Only your own, and only while still pending.
  router.post('/candidate-outreach/cancel/:id', auth, async (req, res) => {
    try {
      const { data: row } = await withOrg(supabase.from('candidate_outreach')
        .select('id,status,sent_by').eq('id', req.params.id), req).maybeSingle();
      // 404 rather than 403 for someone else's row: an id must not be probeable.
      if (!row || row.sent_by !== req.user.id) return res.status(404).json({ error: 'Not found' });
      if (row.status !== 'pending') return res.status(409).json({ error: 'That one has already gone out.' });
      await supabase.from('candidate_outreach')
        .update({ status: 'skipped', fail_reason: 'cancelled by sender' }).eq('id', row.id);
      res.json({ cancelled: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── THE DRAIN ────────────────────────────────────────────────────────────
  // Called by the heartbeat, not by a request. Sends what is due, applying the
  // same gates the lead send loop applies — pause, send window, daily cap,
  // warm-up ramp, mailbox auto-pause, suppression. A candidate email that
  // ignored those would burn the same domain the cold email depends on.
  async function drainDueOutreach(limit = DRAIN_PER_TICK) {
    if (isSendingPaused && isSendingPaused()) return { sent: 0, skipped: 0, reason: 'paused' };

    const { data: due } = await supabase.from('candidate_outreach')
      .select('*')
      .eq('status', 'pending')
      .lte('send_after', new Date().toISOString())
      .order('send_after', { ascending: true })
      .limit(limit);
    if (!due || !due.length) return { sent: 0, skipped: 0, failed: 0 };

    const win = await candidateWindow();
    const suppressed = await loadSuppressedSet(due.map(r => r.to_email).filter(Boolean));
    const delivState = await loadMailboxDelivState([...new Set(due.map(r => r.mailbox_id).filter(Boolean))]);
    const [warmupStart, warmupStep] = await Promise.all([
      settingsConfig.getSetting(supabase, 'mailbox_warmup_start'),
      settingsConfig.getSetting(supabase, 'mailbox_warmup_step'),
    ]);

    let sent = 0, skipped = 0, failed = 0, deferred = 0;
    const sentToday = {};

    for (const row of due) {
      try {
        // Pace between real sends only. A row that is skipped, deferred or
        // suppressed costs nothing and must not buy the next one a free slot —
        // otherwise a queue full of opted-out addresses would let the few
        // genuine sends through in a burst.
        if (sent > 0) await sleep(DRIP_MIN_MS + Math.floor(Math.random() * (DRIP_MAX_MS - DRIP_MIN_MS)));
        if (isManagerPaused && isManagerPaused(row.sent_by)) { deferred++; continue; }
        if (suppressed.has(String(row.to_email || '').toLowerCase())) {
          await supabase.from('candidate_outreach')
            .update({ status: 'skipped', fail_reason: 'recipient opted out' }).eq('id', row.id);
          skipped++; continue;
        }

        const mailbox = row.mailbox_id ? await connectedMailboxById(row.mailbox_id) : null;
        if (!mailbox) { deferred++; continue; }
        if (mailbox.is_active === false) { deferred++; continue; }
        if (delivState[mailbox.id] && delivState[mailbox.id].auto_paused_at) { deferred++; continue; }

        // THE SEND WINDOW — OFF BY DEFAULT since 2026-09-09 (owner: "remove the
        // barricade of timezone for candidate emails ... Only the outreach goes
        // within the time zone"). `candidateWindowState` returns open for every
        // hour while the switch is off, so this gate costs one comparison and
        // nothing else; turn `candidate_send_window_enabled` on and the
        // evenings-and-weekends behaviour comes back exactly as it was.
        //
        // The candidate lookup is skipped entirely when the window is off — no
        // row-by-row query to answer a question nobody is asking.
        if (win.enabled) {
          const { data: cand } = await supabase.from('candidates')
            .select('id,current_location,city,state').eq('id', row.candidate_id).maybeSingle();
          const at = localPartsFor(placeOf(cand), new Date());
          if (!gen.candidateWindowState(at.day, at.minutes, win).open) { deferred++; continue; }
        }

        // Daily cap and warm-up ramp, counted per mailbox across this tick.
        if (sentToday[mailbox.id] === undefined) {
          const { data: log } = await supabase.from('email_send_log')
            .select('emails_sent').eq('send_date', today()).eq('user_email_id', mailbox.id).maybeSingle();
          sentToday[mailbox.id] = (log && log.emails_sent) || 0;
        }
        const base = mailbox.daily_send_limit || 150;
        const wl = warmupLimit(delivState[mailbox.id], warmupStart, warmupStep);
        const cap = wl ? Math.min(base, wl) : base;
        if (sentToday[mailbox.id] >= cap) { deferred++; continue; }

        // THE SENDER IS RESOLVED HERE, FROM THE MAILBOX THAT IS ACTUALLY
        // SENDING — the whole reason the body was stored with the token in it.
        const rendered = renderStoredEmail(row, mailbox);
        const signature = await mailboxSignature(mailbox, row.sent_by);
        const token = row.track_token || newTrackToken();
        // The answer buttons carry the same token as the pixel — one token per
        // send, so an open, a reply and a tap all describe the same message.
        // They go ABOVE the signature: the ask is the email, the signature is
        // the footer. The token has to exist before the HTML is built, which is
        // why it is resolved a line earlier than it strictly needs to be.
        const buttons = gen.answerButtonsHtml(resolveBaseUrl(), token, {});
        const htmlBody = injectTrackPixel(
          buildHtmlEmailBody(rendered.body, buttons + signature), token);

        // The token is written BEFORE the send, not after. If the send succeeds
        // and the update then fails, a candidate could tap a button whose token
        // matches no row and be told the link is dead — so the row is ready for
        // an answer before the email that carries it can possibly arrive.
        if (!row.track_token) {
          await supabase.from('candidate_outreach').update({ track_token: token }).eq('id', row.id);
        }

        await sendMailboxNewMessage(mailbox, { to: row.to_email, subject: rendered.subject, htmlBody });

        await supabase.from('candidate_outreach').update({
          status: 'sent', sent_at: new Date(), track_token: token,
        }).eq('id', row.id);

        // Tracking must never fail a send that has already gone out.
        try {
          await supabase.from('email_tracking').insert({
            token, channel: 'candidate_outreach',
            candidate_id: row.candidate_id, job_order_id: row.job_order_id,
            to_email: row.to_email, subject: rendered.subject, body: rendered.body,
            sent_by: row.sent_by, mailbox_email: mailbox.email_address || null,
            ...(row.org_id ? { org_id: row.org_id } : {}),
          });
        } catch (_) { /* the send is what matters */ }

        sentToday[mailbox.id] += 1;
        await supabase.from('email_send_log').upsert(
          { user_email_id: mailbox.id, send_date: today(), emails_sent: sentToday[mailbox.id] },
          { onConflict: 'user_email_id,send_date' }
        );
        try { await supabase.from('candidates').update({ last_contact_at: new Date() }).eq('id', row.candidate_id); } catch (_) {}
        sent++;
      } catch (e) {
        // The failure reason is WRITTEN DOWN. On the lead side an auth failure
        // marks emails failed with nowhere to record why, so the one useful
        // sentence dies with the process (CLAUDE.md, "KNOWN, UNFIXED"). This
        // table has a column for it, so use it.
        try {
          await supabase.from('candidate_outreach').update({
            status: 'failed',
            fail_reason: (friendlySendError ? friendlySendError(e.message) : e.message || 'Send failed').slice(0, 500),
          }).eq('id', row.id);
        } catch (_) {}
        failed++;
      }
    }
    return { sent, skipped, failed, deferred };
  }

  return { router, drainDueOutreach };
};
