// ============================================================================
// APP-PASSWORD MAILBOXES — connect, check, disconnect (D-0120, R-200 step b). The counterpart of routes/gmail.js and
// routes/microsoft.js for a mailbox with no OAuth sign-in in PACE (Zoho and any other provider).
//
//   GET    /smtp/info/:userEmailId      is it available on this server, what provider is the address on, how to get an app password
//   POST   /smtp/connect/:userEmailId   { password, username?, smtp_host?, smtp_port?, imap_host?, imap_port? } — runs the checks one
//                                       by one and answers with every step; stores NOTHING unless sending AND reading both work
//   GET    /smtp/status/:userEmailId    connected? did the sign-in last work?
//   DELETE /smtp/:userEmailId           disconnect
//
// ctx = { supabase, auth, hasRole, orgIdFor, smtp: { store, mailbox, secret, resolver } }  (index.js builds smtp; tests inject fakes)
//
// RULES.
//   • The mailbox slot must be the caller's own (or the caller an admin) in the caller's organisation — a miss is a 404, never a 403.
//   • The password is only ever in the request body and the encrypted row. It is never returned, logged, or put in an error message.
//   • Not available when the server has no MAILBOX_SECRET_KEY (nothing can be stored safely) — said plainly, never half-working.
//   • A person gets a few tries, not unlimited: this is a way to test a password against a mail server.
// ============================================================================
const express = require('express');
const crypto = require('crypto');
const presets = require('../services/smtp-presets');
const emailSetup = require('../services/email-setup');
const { reassignJobsOffMailbox } = require('../services/mailbox-reassign');

const TRY_LIMIT = 6, TRY_WINDOW_MS = 10 * 60 * 1000;

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, orgIdFor, smtp } = ctx;
  const tries = new Map();

  async function ownedSlot(req, userEmailId) {
    if (!userEmailId) return null;
    const { data } = await supabase.from('user_emails').select('id,user_id,email_address,display_name,org_id,daily_send_limit,is_active').eq('id', userEmailId).maybeSingle();
    if (!data) return null;
    const org = orgIdFor(req);
    if (org && data.org_id && data.org_id !== org) return null;
    if (data.user_id !== req.user.id && !hasRole(req, 'admin')) return null;
    return data;
  }
  // The write is tied to the slot's own organisation as well as its id (the ownership check above already refused anything else) —
  // an update never reaches a row in another organisation even if an id were somehow mixed up.
  function updateSlot(slot, set) {
    let q = supabase.from('user_emails').update(set).eq('id', slot.id);
    if (slot.org_id) q = q.eq('org_id', slot.org_id);
    return q;
  }
  function tooManyTries(userId, now) {
    const t = now || Date.now(), recent = (tries.get(userId) || []).filter((x) => t - x < TRY_WINDOW_MS);
    if (recent.length >= TRY_LIMIT) { tries.set(userId, recent); return true; }
    recent.push(t); tries.set(userId, recent); return false;
  }
  async function detect(address) {
    const domain = String(address || '').split('@')[1] || '';
    let mx = [];
    try { mx = domain ? await (smtp.resolver || emailSetup.makeResolver()).mx(domain) : []; } catch (_) { mx = []; }
    return emailSetup.detectProvider(mx);
  }

  // Can this server hold app passwords at all? The screen shows the "add with an app password" button only when it can.
  router.get('/smtp/enabled', auth, (req, res) => res.json({ enabled: smtp.secret.isConfigured() }));

  router.get('/smtp/info/:userEmailId', auth, async (req, res) => {
    try {
      const slot = await ownedSlot(req, req.params.userEmailId);
      if (!slot) return res.status(404).json({ error: 'Not found' });
      const enabled = smtp.secret.isConfigured();
      const prov = await detect(slot.email_address);
      res.json({
        enabled,
        reason: enabled ? null : 'This server cannot store mailbox passwords yet (MAILBOX_SECRET_KEY is not set), so app-password mailboxes are not available.',
        email: slot.email_address,
        provider: { key: prov.key, label: prov.label, region: prov.region || null },
        servers_known: presets.candidatesFor({ provider: prov.key, region: prov.region }).length > 0,
        guide: presets.guideFor(prov.key),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/smtp/connect/:userEmailId', auth, async (req, res) => {
    try {
      if (!smtp.secret.isConfigured()) return res.status(503).json({ error: 'not_configured', message: 'This server cannot store mailbox passwords yet, so app-password mailboxes are not available.' });
      const slot = await ownedSlot(req, req.params.userEmailId);
      if (!slot) return res.status(404).json({ error: 'Not found' });
      const b = req.body || {};
      const password = String(b.password || '');
      if (!password || password.length > 256) return res.status(400).json({ error: 'bad_password', message: 'Type the app password.' });
      if (tooManyTries(req.user.id)) return res.status(429).json({ error: 'too_many_tries', message: 'Too many tries — wait a few minutes, then try again.' });

      const username = String(b.username || slot.email_address).trim().slice(0, 254);
      const creds = { user: username, pass: password };
      const prov = await detect(slot.email_address);
      const cands = presets.candidatesFor({ provider: prov.key, region: prov.region, typed: b });
      const steps = [];
      const done = (ok, extra) => res.json(Object.assign({ ok, steps, provider: { key: prov.key, label: prov.label } }, extra || {}));

      if (!cands.length) {
        steps.push({ id: 'servers', ok: false, label: 'Mail servers', message: 'PACE does not know ' + prov.label + '\'s mail servers. Type the outgoing (SMTP) and incoming (IMAP) server names below — they are on its "set up an email client" help page.', needs_servers: true });
        return done(false);
      }
      for (const c of cands) { const pb = presets.portProblem(c); if (pb) { steps.push({ id: 'servers', ok: false, label: 'Mail servers', message: pb, needs_servers: true }); return done(false); } }

      // 1+2: the outgoing server — the first candidate that signs in is the one kept
      let chosen = null, lastSmtp = null;
      for (const c of cands) {
        const r = await smtp.mailbox.verifySmtp(c, creds);
        if (r.ok) { chosen = c; break; }
        lastSmtp = r;
        if (r.kind === 'host' || r.kind === 'unreachable' || r.kind === 'tls') continue;      // try the next server name
        if (r.kind === 'auth' && cands.length > 1) continue;                                     // a business account is refused by the personal server and vice versa
        break;
      }
      if (!chosen) {
        steps.push({ id: 'smtp', ok: false, label: 'Signed in to send', message: (lastSmtp && lastSmtp.message) || 'Could not sign in to the outgoing server.', kind: lastSmtp && lastSmtp.kind });
        return done(false);
      }
      steps.push({ id: 'servers', ok: true, label: 'Found your mail servers', message: chosen.label + ' — ' + chosen.smtp.host });
      steps.push({ id: 'smtp', ok: true, label: 'Signed in to send', message: 'The outgoing server accepted the app password.' });

      // 3: the incoming server
      const im = await smtp.mailbox.verifyImap(chosen, creds);
      steps.push({ id: 'imap', ok: !!im.ok, label: 'Signed in to read replies', message: im.ok ? 'The incoming server accepted it and the inbox opens.' : im.message, kind: im.kind });
      if (!im.ok) return done(false);

      // 4: prove both directions — a message to yourself, found in your own inbox (soft: a slow delivery does not undo the connection)
      const marker = crypto.randomBytes(8).toString('hex');
      let testOk = true, testMsg = 'A test email reached your inbox.';
      try {
        await smtp.mailbox.sendMail(chosen, creds, {
          from: slot.display_name ? { name: slot.display_name, address: slot.email_address } : slot.email_address, to: slot.email_address,
          subject: 'PACE connection test', text: 'This is a test PACE sent to confirm this mailbox is connected. You can delete it.',
          headers: { 'X-PACE-Test': marker },
        });
        const f = await smtp.mailbox.findMarker(chosen, creds, marker, smtp.findOptions);
        if (!f.found) { testMsg = 'The test email was sent but has not appeared in your inbox yet. Check your inbox and spam — the connection is saved either way.'; }
        else if (f.folder !== 'INBOX') testMsg = 'The test email arrived, but in "' + f.folder + '" — mark it as not spam so replies reach you.';
      } catch (e) { testOk = false; testMsg = 'Signed in, but the test email could not be sent: ' + String((e && e.message) || e).split(password).join('•••').slice(0, 140); }
      steps.push({ id: 'test', ok: testOk, label: 'Test email', message: testMsg });
      if (!testOk) return done(false);

      // everything that matters worked: keep it (encrypted) and switch the mailbox over
      await smtp.store.save({ userEmailId: slot.id, orgId: slot.org_id || orgIdFor(req), userId: slot.user_id, email: slot.email_address, username, password, cfg: chosen, provider: prov.key });
      // The mailbox keeps whatever daily limit it already has — the one the admin allowed. An app-password mailbox is just another kind
      // of mailbox (owner, 12 Oct): it is not given a limit of its own.
      await updateSlot(slot, { platform: 'SMTP', is_active: true });
      return done(true, { daily_send_limit: slot.daily_send_limit || null });
    } catch (err) { res.status(500).json({ error: 'failed', message: 'Something went wrong while connecting. Nothing was saved.' }); }
  });

  router.get('/smtp/status/:userEmailId', auth, async (req, res) => {
    try {
      const slot = await ownedSlot(req, req.params.userEmailId);
      if (!slot) return res.json({ connected: false, configured: smtp.secret.isConfigured() });
      const row = await smtp.store.get(slot.id);
      if (!row) return res.json({ connected: false, configured: smtp.secret.isConfigured() });
      res.json({ connected: true, configured: smtp.secret.isConfigured(), email_address: slot.email_address, expired: !!(row.error || (row.row && row.row.refresh_failed)) });
    } catch (_) { res.json({ connected: false, configured: smtp.secret.isConfigured() }); }
  });

  router.delete('/smtp/:userEmailId', auth, async (req, res) => {
    try {
      const slot = await ownedSlot(req, req.params.userEmailId);
      if (!slot) return res.status(404).json({ error: 'Not found' });
      await smtp.store.remove(slot.id);
      await updateSlot(slot, { is_active: false });
      const reassignment = await reassignJobsOffMailbox(supabase, slot.id, slot.user_id);
      res.json({ success: true, reassignment });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
