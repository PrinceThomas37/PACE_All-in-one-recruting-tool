// ============================================================================
// Gmail / Google Workspace provider — the counterpart to the Microsoft Graph
// send/read machinery in index.js, so a Gmail mailbox can send, reply, read its
// inbox, and move mail out of spam (warm-up rescue) the same way an Outlook one
// does. Raw REST via fetch, mirroring graphMailRequest — no extra dependency.
//
// SCAFFOLD: fully implemented, but inert until an admin sets GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET and Google approves the restricted scopes (gmail.send /
// gmail.modify). `isConfigured()` gates every entry point; the Microsoft path is
// untouched. The final step — dispatching the send loop + warm-up engine to
// this provider by mailbox platform — is intentionally left as its own change
// (see docs), since it can only be tested once a real Gmail mailbox connects.
//
//   ctx = { supabase, google: { clientId, clientSecret, redirectUri, scopes } }
// ============================================================================

const { fetchWithRetry } = require('./http-client');

const GMAIL_TIMEOUT_MS = 20000;
const OAUTH_TIMEOUT_MS = 15000;

function createGmailProvider(ctx) {
  const { supabase, google } = ctx;
  const cfg = google || {};

  const isConfigured = () => !!(cfg.clientId && cfg.clientSecret);
  function requireConfigured() {
    if (!isConfigured()) throw new Error('Gmail is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  }

  // ── OAuth ──────────────────────────────────────────────────────────────────
  function authorizeUrl(state) {
    requireConfigured();
    const p = new URLSearchParams({
      client_id: cfg.clientId, response_type: 'code', redirect_uri: cfg.redirectUri,
      scope: cfg.scopes, access_type: 'offline', prompt: 'consent',
      include_granted_scopes: 'true', state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  // SIGN-IN ONLY. Deliberately NOT authorizeUrl above.
  //
  // authorizeUrl requests gmail.send + gmail.modify, which are Google
  // RESTRICTED scopes: they require Google's security review before anyone
  // outside a small test list can consent, and they show the user a consent
  // screen asking to "read, compose and send email" — an absurd thing to demand
  // from someone who only wants to log in.
  //
  // Signing in needs identity and nothing else, and openid/email/profile are
  // ORDINARY scopes: no review, and an honest consent screen ("see your name
  // and email"). Reusing the mailbox URL here would have silently made Google
  // sign-in depend on the very approval process it is supposed to sidestep.
  const SIGNIN_SCOPES = 'openid email profile';
  function signInAuthorizeUrl(state) {
    requireConfigured();
    const p = new URLSearchParams({
      client_id: cfg.clientId, response_type: 'code', redirect_uri: cfg.redirectUri,
      scope: SIGNIN_SCOPES, state,
      // No offline access: sign-in needs no refresh token, so don't ask for one.
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }
  async function oauthToken(params) {
    // retryUnsafe: a token exchange/refresh is idempotent, and a transient
    // failure here takes the whole mailbox offline until the next sweep.
    const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }, { timeoutMs: OAUTH_TIMEOUT_MS, retryUnsafe: true, retries: 2 });
    return res.json();
  }
  async function exchangeCode(code) {
    requireConfigured();
    return oauthToken({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' });
  }

  // ── Token (with refresh), mirroring getMicrosoftToken ───────────────────────
  async function getToken(userEmailId) {
    requireConfigured();
    const { data: row, error } = await supabase.from('gmail_tokens').select('*').eq('user_email_id', userEmailId).single();
    if (error || !row) throw new Error('No Gmail token found. Please reconnect this mailbox.');
    if (new Date(row.expires_at).getTime() - Date.now() > 5 * 60 * 1000) return row.access_token;
    const refreshed = await oauthToken({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: row.refresh_token, grant_type: 'refresh_token' });
    if (refreshed.error) throw new Error('Gmail token refresh failed: ' + (refreshed.error_description || refreshed.error));
    await supabase.from('gmail_tokens').update({
      access_token: refreshed.access_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      updated_at: new Date(),
    }).eq('user_email_id', userEmailId);
    return refreshed.access_token;
  }

  async function api(token, path, options = {}) {
    // Reads retry (fetchWithRetry's default); a send POST gets the timeout only,
    // so a slow-but-delivered message is never sent twice.
    const res = await fetchWithRetry(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    }, {
      timeoutMs: GMAIL_TIMEOUT_MS,
      onRetry: ({ attempt, delayMs, reason }) =>
        console.warn(`[gmail] ${reason} on ${path} — retry ${attempt} in ${delayMs}ms`),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Gmail API ${res.status}`);
    return data;
  }

  async function getProfileEmail(token) {
    const r = await api(token, '/profile');
    return r.emailAddress || '';
  }

  // ── MIME builder → base64url `raw` for messages.send ────────────────────────
  function base64url(str) {
    return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function buildRaw({ from, to, subject, htmlBody, headers, inReplyTo, references, attachments }) {
    const head = [];
    if (from) head.push(`From: ${from}`);
    head.push(`To: ${to}`);
    head.push(`Subject: ${subject || ''}`);
    head.push('MIME-Version: 1.0');
    if (inReplyTo) head.push(`In-Reply-To: ${inReplyTo}`);
    if (references) head.push(`References: ${references}`);
    for (const [k, v] of Object.entries(headers || {})) head.push(`${k}: ${v}`);

    if (!attachments || !attachments.length) {
      head.push('Content-Type: text/html; charset="UTF-8"');
      head.push('');
      head.push(htmlBody || '');
      return base64url(head.join('\r\n'));
    }

    // multipart/mixed: the HTML body, then one attachment part per file.
    const boundary = 'fute_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    head.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    head.push('');
    const parts = [`--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', '', htmlBody || ''];
    attachments.forEach((a) => {
      const b64 = String(a.base64 || '').match(/.{1,76}/g) || [];
      parts.push(`--${boundary}`,
        `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${a.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${a.filename}"`,
        '', ...b64);
    });
    parts.push(`--${boundary}--`);
    return base64url(head.join('\r\n') + '\r\n' + parts.join('\r\n'));
  }

  // ── Send (fresh) ────────────────────────────────────────────────────────────
  async function sendNewMessage(userEmailId, { to, subject, htmlBody, headers, fromAddress, attachments }) {
    const token = await getToken(userEmailId);
    const raw = buildRaw({ from: fromAddress, to, subject, htmlBody, headers, attachments });
    const r = await api(token, '/messages/send', { method: 'POST', body: JSON.stringify({ raw }) });
    return { messageId: r.id, threadId: r.threadId };
  }

  // ── Send (threaded reply) — pass the parent's Message-ID for proper threading ─
  async function sendThreadReply(userEmailId, { to, subject, htmlBody, headers, fromAddress, threadId, inReplyTo, references }) {
    const token = await getToken(userEmailId);
    const raw = buildRaw({ from: fromAddress, to, subject, htmlBody, headers, inReplyTo, references });
    const body = { raw }; if (threadId) body.threadId = threadId;
    const r = await api(token, '/messages/send', { method: 'POST', body: JSON.stringify(body) });
    return { messageId: r.id, threadId: r.threadId };
  }

  // ── Read ─────────────────────────────────────────────────────────────────────
  async function listMessages(userEmailId, { labelIds, q, maxResults } = {}) {
    const token = await getToken(userEmailId);
    const p = new URLSearchParams();
    (labelIds || []).forEach((l) => p.append('labelIds', l));
    if (q) p.set('q', q);
    p.set('maxResults', String(maxResults || 25));
    const r = await api(token, `/messages?${p}`);
    return r.messages || [];
  }
  async function getMessage(userEmailId, id, { format = 'metadata', metadataHeaders } = {}) {
    const token = await getToken(userEmailId);
    const p = new URLSearchParams({ format });
    (metadataHeaders || []).forEach((h) => p.append('metadataHeaders', h));
    return api(token, `/messages/${id}?${p}`);
  }

  // Reshape a Gmail message into the SAME shape Microsoft Graph returns, so the
  // reply sweep can run one set of matching rules over both providers instead of
  // growing a second copy. Two copies of that logic is exactly how the stage
  // vocabulary ended up hand-synced across six files.
  //
  // Gmail nests the body in a MIME part tree and puts everything else in
  // headers; Graph gives flat fields. This flattens Gmail to Graph's shape.
  function normalizeMessage(raw) {
    if (!raw) return null;
    const headers = {};
    for (const h of (raw.payload?.headers || [])) headers[String(h.name || '').toLowerCase()] = h.value;

    // Walk the MIME tree, preferring text/plain (already quote-light) and
    // falling back to text/html.
    function pickBody(part, want) {
      if (!part) return '';
      if (part.mimeType === want && part.body?.data) return decodeB64Url(part.body.data);
      for (const p of (part.parts || [])) {
        const found = pickBody(p, want);
        if (found) return found;
      }
      return '';
    }
    const text = pickBody(raw.payload, 'text/plain');
    const html = pickBody(raw.payload, 'text/html');
    const content = text || html || raw.snippet || '';

    // Gmail's internalDate is epoch millis as a string.
    const received = raw.internalDate
      ? new Date(Number(raw.internalDate)).toISOString()
      : (headers.date ? new Date(headers.date).toISOString() : new Date().toISOString());

    // "Ada Lovelace <ada@x.com>" -> ada@x.com
    const fromRaw = headers.from || '';
    const addr = (/<([^>]+)>/.exec(fromRaw) || [null, fromRaw])[1].trim().toLowerCase();

    return {
      id: raw.id,
      threadId: raw.threadId,
      subject: headers.subject || '',
      from: { emailAddress: { address: addr, name: fromRaw.replace(/<[^>]*>/, '').trim() } },
      receivedDateTime: received,
      bodyPreview: (raw.snippet || content).slice(0, 500),
      body: { contentType: text ? 'text' : 'html', content },
      internetMessageHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
      _provider: 'gmail',
    };
  }

  function decodeB64Url(data) {
    try { return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
    catch (_) { return ''; }
  }

  // ── Spam rescue / labels — remove SPAM, add INBOX ───────────────────────────
  async function modifyLabels(userEmailId, id, { add, remove } = {}) {
    const token = await getToken(userEmailId);
    return api(token, `/messages/${id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: add || [], removeLabelIds: remove || [] }),
    });
  }

  return {
    isConfigured, authorizeUrl, exchangeCode, getToken, getProfileEmail,
    sendNewMessage, sendThreadReply, listMessages, getMessage, modifyLabels,
    normalizeMessage, signInAuthorizeUrl, SIGNIN_SCOPES,
  };
}

module.exports = { createGmailProvider };
