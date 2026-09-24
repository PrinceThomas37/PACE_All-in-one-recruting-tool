// ============================================================================
// MICROSOFT OAUTH · OUTLOOK / GRAPH SEND
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/microsoft')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ============================================================================
const express = require('express');
const jwt = require('jsonwebtoken');
const { resolveSignatureHtml, fillSignatureHtml } = require('../email-signature');
const { fetchWithTimeout, fetchWithRetry } = require('../http-client');
const sso = require('../services/sso');
const { reassignJobsOffMailbox } = require('../services/mailbox-reassign');

const OAUTH_TIMEOUT_MS = 15000;

// Rampart review item #6: every value handed to the OAuth popup used to be
// hand-interpolated into an inline <script> string — `userEmailId` straight
// off the (forgeable) `state`, plus error text from Microsoft or our own DB.
// One builder, JSON.stringify-ing the WHOLE payload at once, so nothing here
// can ever again be a bare `'${x}'`. `</script>` inside a value cannot close
// the tag early either (the `<` is escaped), which JSON.stringify alone does
// not protect against.
function popupMessage(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<script>window.opener&&window.opener.postMessage(${json},'*');window.close();</script>`;
}

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, today, getMailboxSignature, getMicrosoftToken, buildHtmlEmailBody, orgIdFor, MS_TENANT, MS_CLIENT, MS_SECRET, MS_REDIRECT, MS_SCOPES } = ctx;

  // C-0016: is this userEmailId slot in the caller's own org? A miss is
  // treated as "not found", never a 403 — a 403 would confirm the slot exists
  // in some other org, which is exactly the oracle rampart flagged (#4/#5 in
  // the ledger). Returns the slot row (with org_id) or null.
  async function ownedMailboxSlot(orgId, userEmailId) {
    if (!userEmailId) return null;
    const { data } = await supabase.from('user_emails').select('id,user_id,email_address,org_id').eq('id', userEmailId).maybeSingle();
    if (!data) return null;
    if (orgId && data.org_id && data.org_id !== orgId) return null;
    return data;
  }

router.get('/auth/microsoft/connect', async (req, res) => {
  try {
    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).send('Unauthorized');
    let reqUser;
    try { reqUser = jwt.verify(token, process.env.JWT_SECRET); } catch { return res.status(401).send('Invalid token'); }
    if (!reqUser.roles?.includes('admin') && reqUser.role !== 'admin') return res.status(403).send('Admin only');
    const { userEmailId } = req.query;
    if (!userEmailId) return res.status(400).send('userEmailId required');
    // C-0016 #3: userEmailId used to go straight into the OAuth `state` with no
    // org check — an admin of org B could point their own connect flow at org
    // A's mailbox slot id. No state is minted for a foreign slot now.
    const orgId = orgIdFor({ user: reqUser });
    const slot = await ownedMailboxSlot(orgId, userEmailId);
    if (!slot) return res.status(404).send('Not found');
    // Rampart review item #6 (pre-existing, HIGH): `state` used to be plain
    // base64 — readable AND FORGEABLE — and the callback wrote `userEmailId`
    // straight from it into an inline <script>, so a hand-crafted state was a
    // reflected-XSS payload on this origin. Signed the same way sso.js already
    // signs its own OAuth state (JWT_SECRET, the one secret this app already
    // requires at startup — no new env var). A forged state now fails
    // verification before any of its fields are ever read, closing both the
    // XSS and the "org check trusts a forgeable value" gap the same finding
    // named.
    // R5 (rampart round 2): `p:'mailbox'` marks what this token is FOR. A
    // session token and this OAuth state are both JWTs signed with the same
    // JWT_SECRET; without a purpose claim, a leaked/logged mailbox-connect
    // state would verify cleanly as a session in auth(). The claim is checked
    // on the way back below, and auth() rejects any token carrying `p` at all.
    const state = jwt.sign({ userEmailId, userId: reqUser.id, p: 'mailbox' }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const url = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize?client_id=${MS_CLIENT}&response_type=code&redirect_uri=${encodeURIComponent(MS_REDIRECT)}&scope=${encodeURIComponent(MS_SCOPES)}&state=${encodeURIComponent(state)}&prompt=select_account`;
    res.redirect(url);
  } catch (err) { res.status(500).send(err.message); }
});

router.get('/auth/microsoft/callback', async (req, res) => {
  let userEmailId = '';
  try {
    const { code, state, error: msError } = req.query;
    // SIGN-IN vs MAILBOX-CONNECT. Both arrive at this one registered redirect
    // URI; the state says which. Doing it this way means enabling "Sign in with
    // Microsoft" needed no change to the Azure app registration. The state is a
    // signed JWT, so this branch cannot be entered by forging a query string.
    const signIn = sso.readSignInState(state);
    if (signIn) {
      if (msError) return res.status(400).send(sso.failurePage(String(msError)));
      if (!code) return res.status(400).send(sso.failurePage('Microsoft did not return an authorization code.'));
      try {
        const tRes = await fetchWithTimeout(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: MS_CLIENT, client_secret: MS_SECRET, code, redirect_uri: MS_REDIRECT, grant_type: 'authorization_code', scope: MS_SCOPES }),
        }, { timeoutMs: OAUTH_TIMEOUT_MS });
        const t = await tRes.json();
        if (t.error) return res.status(400).send(sso.failurePage(t.error_description || t.error));

        const pRes = await fetchWithRetry('https://graph.microsoft.com/v1.0/me',
          { headers: { Authorization: `Bearer ${t.access_token}` } }, { timeoutMs: OAUTH_TIMEOUT_MS });
        const profile = await pRes.json();
        // Entra guarantees userPrincipalName; `mail` is only set when a mailbox
        // exists, so it is preferred but cannot be relied on alone.
        const email = profile.mail || profile.userPrincipalName || '';

        // displayName is only used if an account is being created for the first
        // time (self-serve signup). Matching is always on the verified address.
        const out = await sso.sessionForEmail(supabase, email, { provider: 'microsoft', name: profile.displayName });
        if (!out.ok) return res.status(403).send(sso.failurePage(out.message));
        return res.send(sso.completionPage(out.token, signIn.redirect || '/'));
      } catch (err) {
        console.error('[sso/microsoft] callback failed:', err.message);
        return res.status(500).send(sso.failurePage('Sign-in failed. Please try again.'));
      }
    }

    if (msError) return res.send(popupMessage({ type: 'ms_oauth_error', error: String(msError) }));
    if (!code || !state) return res.status(400).send('Missing code or state');
    // Rampart review item #6: `state` is now a signed JWT (see /connect above),
    // not plain base64 — a forged or tampered state fails verification here,
    // before any of its fields are ever read or echoed back.
    let mailboxState;
    try {
      mailboxState = jwt.verify(state, process.env.JWT_SECRET);
      if (mailboxState.p !== 'mailbox') throw new Error('wrong purpose');
    } catch {
      return res.send(popupMessage({ type: 'ms_oauth_error', error: 'This connection request is no longer valid. Please try again.' }));
    }
    const userId = mailboxState.userId;
    userEmailId = mailboxState.userEmailId;
    // C-0016 #3/#4 defence in depth: checked again here rather than trusting
    // that /connect already refused a foreign slot. A mismatch gets the SAME
    // generic sentence as any other failure — never the "this slot is for
    // <email>" oracle below, which is fine to disclose once we already know
    // userId legitimately owns the slot.
    const { data: stateUser } = await supabase.from('users').select('org_id').eq('id', userId).maybeSingle();
    const { data: slotForOrgCheck } = await supabase.from('user_emails').select('org_id').eq('id', userEmailId).maybeSingle();
    if (!slotForOrgCheck || (stateUser && slotForOrgCheck.org_id && stateUser.org_id && slotForOrgCheck.org_id !== stateUser.org_id)) {
      return res.send(popupMessage({ type: 'ms_oauth_error', userEmailId, error: 'This connection request is no longer valid. Please try again.' }));
    }
    // No retry on the code exchange: an OAuth authorization code is single-use,
    // so a replay fails with invalid_grant and buries the real error.
    const tokenRes = await fetchWithTimeout(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: MS_CLIENT, client_secret: MS_SECRET, code, redirect_uri: MS_REDIRECT, grant_type: 'authorization_code', scope: MS_SCOPES }) }, { timeoutMs: OAUTH_TIMEOUT_MS });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.send(popupMessage({ type: 'ms_oauth_error', userEmailId, error: tokens.error_description || tokens.error }));
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const profileRes = await fetchWithRetry('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } }, { timeoutMs: OAUTH_TIMEOUT_MS });
    const profile = await profileRes.json();
    const emailAddress = profile.mail || profile.userPrincipalName || '';

    // ── VALIDATE FIRST before touching the DB ──────────────────
    const { data: userEmailRow } = await supabase.from('user_emails').select('email_address').eq('id', userEmailId).single();
    const expectedEmail = (userEmailRow?.email_address || '').toLowerCase().trim();
    const actualEmail = emailAddress.toLowerCase().trim();
    if (expectedEmail && actualEmail && expectedEmail !== actualEmail) {
      const errMsg = `Wrong account: you logged in as ${emailAddress} but this slot is for ${userEmailRow.email_address}. Please sign out of Microsoft and try again with the correct account.`;
      return res.send(popupMessage({ type: 'ms_oauth_error', userEmailId, error: errMsg }));
    }

    // Validation passed — now safe to delete old token and save new one
    await supabase.from('microsoft_tokens').delete().eq('user_email_id', userEmailId);
    const { error: insertErr } = await supabase.from('microsoft_tokens').insert(
      { user_email_id: userEmailId, user_id: userId, email_address: emailAddress, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: expiresAt, updated_at: new Date() }
    );
    if (insertErr) {
      console.error('microsoft_tokens insert error:', insertErr);
      return res.send(popupMessage({ type: 'ms_oauth_error', userEmailId, error: 'DB save failed: ' + insertErr.message }));
    }
    await supabase.from('user_emails').update({ platform: 'Microsoft', is_active: true }).eq('id', userEmailId);
    res.send(popupMessage({ type: 'ms_oauth_success', userEmailId, email: emailAddress }));
  } catch (err) {
    console.error('Microsoft OAuth callback error:', err);
    res.send(popupMessage({ type: 'ms_oauth_error', userEmailId: userEmailId || '', error: err.message }));
  }
});

// NOTE: the legacy POST /emails/send-microsoft route was removed here. It sent
// straight through Graph /me/sendMail, bypassing the send-window, per-mailbox
// daily quota, domain throttling, bounce-skipping and follow-up threading that
// processPendingEmailSends() enforces in index.js. It was unused by the app
// (the frontend sends via /emails/queue-all and /emails/reminder-send). All
// outbound mail now goes through the single safe engine.

router.get('/auth/microsoft/status/:userEmailId', auth, async (req, res) => {
  try {
    // C-0016 #5: this answered for ANY slot id in the deployment — no auth,
    // no org. A foreign slot now reads exactly like a disconnected one; the
    // route's own vocabulary has no "not found" state to add one without
    // changing its shape for every existing caller.
    const slot = await ownedMailboxSlot(orgIdFor(req), req.params.userEmailId);
    if (!slot) return res.json({ connected: false });
    const { data } = await supabase.from('microsoft_tokens').select('email_address,expires_at').eq('user_email_id', req.params.userEmailId).single();
    if (!data) return res.json({ connected: false });
    res.json({ connected: true, email_address: data.email_address, expired: new Date(data.expires_at) < new Date() });
  } catch { res.json({ connected: false }); }
});

router.get('/auth/microsoft/schema-check', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    // Check what columns microsoft_tokens actually has by trying a select
    const { data, error } = await supabase.from('microsoft_tokens').select('*').eq('user_id', req.user.id);
    if (error) return res.json({ error: error.message, hint: error.hint, details: error.details });
    res.json({ rows: data, count: (data||[]).length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/auth/microsoft/debug', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
    // All user_emails for this user
    const { data: userEmails } = await supabase.from('user_emails').select('id,email_address,display_name,platform,is_active').eq('user_id', req.user.id);
    // All microsoft_tokens for this user
    const { data: tokens } = await supabase.from('microsoft_tokens').select('user_email_id,email_address,expires_at').eq('user_id', req.user.id);
    // Jobs assigned to this user with their sending_email_id
    const { data: jobs } = await supabase.from('jobs').select('id,position,sending_email_id,sending_email:user_emails!sending_email_id(id,email_address,platform)').eq('assigned_to_bd', req.user.id).is('deleted_at', null);
    // Cross-reference: which job sending_email_ids have tokens
    const tokenIds = new Set((tokens||[]).map(t => t.user_email_id));
    const jobSummary = (jobs||[]).map(j => ({
      job_id: j.id, position: j.position,
      sending_email_id: j.sending_email_id,
      sending_email: j.sending_email?.email_address,
      platform: j.sending_email?.platform,
      has_token: j.sending_email_id ? tokenIds.has(j.sending_email_id) : false
    }));
    res.json({ user_emails: userEmails, tokens: (tokens||[]).map(t => ({ ...t, expired: new Date(t.expires_at) < new Date() })), jobs: jobSummary });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/auth/microsoft/:userEmailId', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead')) return res.status(403).json({ error: 'Admin only' });
    // C-0016 #1 (critical): gated on ROLE only — an admin/bd_lead of org B
    // could disconnect org A's mailbox by id, which also rewrites org A's
    // leads onto a different sending mailbox (reassignJobsOffMailbox below).
    // 404, never 403 — a 403 would confirm the slot exists in another org.
    const mailbox = await ownedMailboxSlot(orgIdFor(req), req.params.userEmailId);
    if (!mailbox) return res.status(404).json({ error: 'Not found' });
    await supabase.from('microsoft_tokens').delete().eq('user_email_id', req.params.userEmailId);
    await supabase.from('user_emails').update({ is_active: false }).eq('id', req.params.userEmailId);
    // Move any leads still pointed at this mailbox before it went dead, so
    // they don't silently sit in "pending" forever — see mailbox-reassign.js.
    const reassignment = mailbox ? await reassignJobsOffMailbox(supabase, req.params.userEmailId, mailbox.user_id) : null;
    res.json({ success: true, reassignment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
