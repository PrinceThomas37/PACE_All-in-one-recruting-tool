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

const OAUTH_TIMEOUT_MS = 15000;

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, today, getMailboxSignature, getMicrosoftToken, buildHtmlEmailBody, MS_TENANT, MS_CLIENT, MS_SECRET, MS_REDIRECT, MS_SCOPES } = ctx;

router.get('/auth/microsoft/connect', async (req, res) => {
  try {
    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).send('Unauthorized');
    let reqUser;
    try { reqUser = jwt.verify(token, process.env.JWT_SECRET); } catch { return res.status(401).send('Invalid token'); }
    if (!reqUser.roles?.includes('admin') && reqUser.role !== 'admin') return res.status(403).send('Admin only');
    const { userEmailId } = req.query;
    if (!userEmailId) return res.status(400).send('userEmailId required');
    const state = Buffer.from(JSON.stringify({ userEmailId, userId: reqUser.id })).toString('base64');
    const url = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize?client_id=${MS_CLIENT}&response_type=code&redirect_uri=${encodeURIComponent(MS_REDIRECT)}&scope=${encodeURIComponent(MS_SCOPES)}&state=${encodeURIComponent(state)}&prompt=select_account`;
    res.redirect(url);
  } catch (err) { res.status(500).send(err.message); }
});

router.get('/auth/microsoft/callback', async (req, res) => {
  try {
    const { code, state, error: msError } = req.query;
    if (msError) return res.send(`<script>window.opener&&window.opener.postMessage({type:'ms_oauth_error',error:'${msError}'},'*');window.close();</script>`);
    if (!code || !state) return res.status(400).send('Missing code or state');
    const { userEmailId, userId } = JSON.parse(Buffer.from(decodeURIComponent(state), 'base64').toString());
    // No retry on the code exchange: an OAuth authorization code is single-use,
    // so a replay fails with invalid_grant and buries the real error.
    const tokenRes = await fetchWithTimeout(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: MS_CLIENT, client_secret: MS_SECRET, code, redirect_uri: MS_REDIRECT, grant_type: 'authorization_code', scope: MS_SCOPES }) }, { timeoutMs: OAUTH_TIMEOUT_MS });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.send(`<scr`+`ipt>window.opener&&window.opener.postMessage({type:'ms_oauth_error',userEmailId:'${userEmailId}',error:'${tokens.error_description}'},'*');window.close();</scr`+`ipt>`);
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
      return res.send(`<scr`+`ipt>window.opener&&window.opener.postMessage({type:'ms_oauth_error',userEmailId:'${userEmailId}',error:${JSON.stringify(errMsg)}},'*');window.close();</scr`+`ipt>`);
    }

    // Validation passed — now safe to delete old token and save new one
    await supabase.from('microsoft_tokens').delete().eq('user_email_id', userEmailId);
    const { error: insertErr } = await supabase.from('microsoft_tokens').insert(
      { user_email_id: userEmailId, user_id: userId, email_address: emailAddress, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: expiresAt, updated_at: new Date() }
    );
    if (insertErr) {
      console.error('microsoft_tokens insert error:', insertErr);
      return res.send(`<scr`+`ipt>window.opener&&window.opener.postMessage({type:'ms_oauth_error',userEmailId:'${userEmailId}',error:'DB save failed: ${insertErr.message}'},'*');window.close();</scr`+`ipt>`);
    }
    await supabase.from('user_emails').update({ platform: 'Microsoft', is_active: true }).eq('id', userEmailId);
    res.send(`<scr`+`ipt>window.opener&&window.opener.postMessage({type:'ms_oauth_success',userEmailId:'${userEmailId}',email:'${emailAddress}'},'*');window.close();</scr`+`ipt>`);
  } catch (err) {
    console.error('Microsoft OAuth callback error:', err);
    res.send(`<scr`+`ipt>window.opener&&window.opener.postMessage({type:'ms_oauth_error',userEmailId:'${userEmailId||''}',error:'${err.message}'},'*');window.close();</scr`+`ipt>`);
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
    await supabase.from('microsoft_tokens').delete().eq('user_email_id', req.params.userEmailId);
    await supabase.from('user_emails').update({ is_active: false }).eq('id', req.params.userEmailId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
