// ============================================================================
// THE IN-APP MAILBOX — read and work a connected mailbox without leaving PACE.
// ----------------------------------------------------------------------------
// Until this existed, PACE could SEND through a user's mailbox and could sweep
// it in the background for replies, but nobody could open it. Working a desk
// meant alt-tabbing to Outlook or Gmail, which is where the context lives, so
// that is where the work drifted.
//
// Every route here is a live pass-through to the provider via
// services/mail-provider.js — nothing is mirrored into Postgres. The reasoning
// (free-tier storage, free-tier instance hours, and a mirror's unfixable drift)
// is written out at the top of that module.
//
// AUTHORISATION, and why it is stricter than the rest of the app:
// a mailbox is the single most sensitive thing a user connects. So the rule
// here is **your own mailboxes only** — not "yours plus admin's", not "anyone
// in your reporting chain". An admin in this product can already reassign
// leads, read every candidate and change anyone's role; letting them silently
// read a colleague's personal mail is a different kind of power and should be
// an explicit, audited feature if it is ever wanted, never a side effect of the
// admin flag. `ownedMailbox()` below is the only door in.
//
// Mounted via: app.use(require('./routes/mailbox')(ctx));
// ============================================================================
const express = require('express');
const { createMailProvider, approxBytes } = require('../services/mail-provider');
const { mailboxConnections } = require('../mailbox-health');
const { fillSignatureHtml } = require('../email-signature');

// express.json() is capped at 5mb for the whole app, and base64 inflates a file
// by about a third — so this is the real ceiling, set below the body limit with
// room for the rest of the payload. Enforced with a plain-English message,
// because the alternative is an opaque 413 the user cannot act on.
const MAX_ATTACH_BYTES = 3.5 * 1024 * 1024;

// The nav badge asks for an unread count on every render. That is one provider
// call per mailbox per render, which is both slow and rude to the API — so the
// answer is cached briefly, per user. 60s is short enough that a read message
// clears within a normal attention span and long enough that clicking around
// the app costs nothing.
const UNREAD_TTL_MS = 60 * 1000;
const unreadCache = new Map(); // userId -> { at, value }

module.exports = (ctx) => {
  const router = express.Router();
  const {
    supabase, db, auth, orgIdFor,
    graphMailRequest, getMicrosoftToken, gmailProvider,
    sendMicrosoftNewMessage, buildHtmlEmailBody, getMailboxSignature,
  } = ctx;

  const mail = createMailProvider({ graphMailRequest, getMicrosoftToken, gmailProvider });

  // THE SIGNATURE, AND THE BUG THIS FIXES.
  //
  // Signature templates hold {{sender}} and {{senderemail}} placeholders that
  // the outreach path fills via fillSignatureHtml (index.js). The first version
  // of this router appended the RAW template, so real replies went out reading
  // "{{sender}} / Recruitment Manager | Fute Global LLC". Filling it is not
  // optional — an unfilled placeholder is visible to the recipient.
  //
  // And it is now OFF unless asked for. A signature belongs on outreach; on a
  // reply to a conversation already in flight it is noise, and repeating a
  // postal address in every message of a thread reads like a mail-merge.
  async function signatureFor(mailbox, userId, include) {
    if (!include) return '';
    try {
      const raw = await getMailboxSignature(mailbox.id, userId);
      return fillSignatureHtml(raw, {
        displayName: mailbox.display_name || mailbox.email_address || '',
        emailAddress: mailbox.email_address || '',
      });
    } catch (_) { return ''; }
  }

  // Attachments arrive as [{ filename, content_type, base64 }]. Validated
  // before anything is sent: a send that fails halfway through a 6MB upload has
  // already cost the user their message.
  function readAttachments(body) {
    const list = Array.isArray(body.attachments) ? body.attachments : [];
    if (!list.length) return { attachments: [] };
    let total = 0;
    const out = [];
    for (const a of list.slice(0, 20)) {
      const base64 = String(a.base64 || '').replace(/^data:[^;]*;base64,/, '');
      if (!base64) continue;
      total += approxBytes(base64);
      out.push({
        filename: String(a.filename || 'attachment').slice(0, 200),
        contentType: a.content_type || a.contentType || 'application/octet-stream',
        base64,
      });
    }
    if (total > MAX_ATTACH_BYTES) {
      return { error: {
        status: 413,
        body: {
          error: `Attachments total ${(total / 1048576).toFixed(1)} MB — the limit is ${(MAX_ATTACH_BYTES / 1048576).toFixed(1)} MB per message. Send the larger files as a link instead.`,
          code: 'attachments_too_large',
        },
      } };
    }
    return { attachments: out };
  }

  function parseAddressField(v) {
    if (Array.isArray(v)) return v.map(x => ({ email: String(x.email || x).trim() })).filter(a => a.email);
    return String(v || '').split(/[,;]/).map(x => ({ email: x.trim() })).filter(a => a.email);
  }

  // ── The only door in ───────────────────────────────────────────────────────
  // Resolves a mailbox id to a row ONLY if it belongs to the caller, is active,
  // and actually has a live OAuth connection. Returns a { status, body } refusal
  // instead of throwing so each handler can answer with the right code:
  //   404 — not yours, or does not exist (deliberately indistinguishable, so
  //         this cannot be used to probe which mailbox ids are real)
  //   409 — yours, but disconnected; the UI turns this into "Reconnect", which
  //         is a fixable state and must not read as an error
  async function ownedMailbox(req, mailboxId) {
    if (!mailboxId) return { error: { status: 400, body: { error: 'mailbox id required' } } };
    const { data: mb } = await supabase.from('user_emails')
      .select('id,user_id,org_id,email_address,display_name,platform,is_active,is_primary')
      .eq('id', mailboxId).maybeSingle();
    if (!mb || mb.user_id !== req.user.id) {
      return { error: { status: 404, body: { error: 'Mailbox not found' } } };
    }
    // user_emails is a tenant table. A user cannot normally hold a mailbox in
    // another org, but "cannot normally" is not a guarantee worth relying on
    // for mail access.
    const org = orgIdFor(req);
    if (org && mb.org_id && mb.org_id !== org) {
      return { error: { status: 404, body: { error: 'Mailbox not found' } } };
    }
    if (mb.is_active === false) {
      return { error: { status: 409, body: { error: 'This mailbox is switched off', code: 'mailbox_inactive' } } };
    }
    const tokenTable = mb.platform === 'Gmail' ? 'gmail_tokens' : 'microsoft_tokens';
    const { data: tok } = await supabase.from(tokenTable)
      .select('user_email_id').eq('user_email_id', mb.id).maybeSingle();
    if (!tok) {
      return { error: { status: 409, body: { error: 'This mailbox is not connected', code: 'not_connected' } } };
    }
    return { mailbox: mb };
  }

  // Turn a provider failure into something a person can act on. A raw Graph or
  // Gmail error string in a toast is noise; "your sign-in expired, reconnect" is
  // an instruction.
  function providerError(res, err) {
    const msg = String(err?.message || 'Mailbox error');
    if (/token|refresh|reconnect|invalid_grant|unauthor|401/i.test(msg)) {
      return res.status(409).json({ error: 'Mailbox sign-in expired — reconnect this mailbox', code: 'reconnect_required', detail: msg });
    }
    if (/quota|rate|429|too many/i.test(msg)) {
      return res.status(429).json({ error: 'The mail provider is rate-limiting us — try again shortly', code: 'rate_limited', detail: msg });
    }
    return res.status(502).json({ error: msg, code: 'provider_error' });
  }

  // ── CRM cross-links ────────────────────────────────────────────────────────
  // The whole reason to read mail inside an ATS rather than in Gmail: this
  // message is FROM someone we already know. One query per entity type per page
  // of messages, scoped to the caller's org, matched on address alone.
  async function crmLinksFor(req, emails) {
    const uniq = [...new Set(emails.filter(Boolean).map(e => String(e).toLowerCase()))].slice(0, 60);
    if (!uniq.length) return {};
    const out = {};
    const scoped = db.forRequest(req);
    try {
      const { data } = await scoped.from('contacts')
        .select('id,first_name,last_name,email,job_id').in('email', uniq).limit(120);
      for (const c of (data || [])) {
        const key = String(c.email || '').toLowerCase();
        if (!key || out[key]) continue;
        out[key] = {
          type: 'contact', id: c.id, job_id: c.job_id || null,
          name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
        };
      }
    } catch (_) { /* a cross-link is a nicety; never fail the inbox for it */ }
    try {
      const { data } = await scoped.from('candidates')
        .select('id,full_name,email').in('email', uniq).is('deleted_at', null).limit(120);
      for (const c of (data || [])) {
        const key = String(c.email || '').toLowerCase();
        // A contact match wins: a BD conversation is the more actionable link,
        // and the same address being both is rare enough not to need a UI for.
        if (!key || out[key]) continue;
        out[key] = { type: 'candidate', id: c.id, name: c.full_name || c.email };
      }
    } catch (_) { /* same */ }
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACCOUNTS
  // ══════════════════════════════════════════════════════════════════════════
  router.get('/mailbox/accounts', auth, async (req, res) => {
    try {
      const { data: rows } = await supabase.from('user_emails')
        .select('id,email_address,display_name,platform,is_primary,is_active')
        .eq('user_id', req.user.id).order('is_primary', { ascending: false });
      const list = rows || [];
      const ids = list.map(m => m.id);
      const conns = await mailboxConnections(supabase, ids);
      res.json(list.map(m => ({
        ...m,
        connection: conns[m.id] || { connected: false, status: 'none' },
        // Only a mailbox that is both switched on and holding a live token can
        // be opened; the UI uses this to decide between "open" and "reconnect".
        readable: m.is_active !== false && !!(conns[m.id] && conns[m.id].connected),
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // What the signature actually looks like, filled. The composer shows this
  // under its "Signature" picker so "My signature" is an informed choice rather
  // than a gamble — which is how the unfilled-placeholder bug stayed invisible.
  router.get('/mailbox/:mid/signature', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      res.json({ html: await signatureFor(mailbox, req.user.id, true) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Nav badge. Deliberately one number and one cheap call per mailbox — the
  // inbox unread count only, not a per-folder breakdown.
  router.get('/mailbox/unread-count', auth, async (req, res) => {
    try {
      const hit = unreadCache.get(req.user.id);
      if (hit && Date.now() - hit.at < UNREAD_TTL_MS) return res.json(hit.value);

      const { data: rows } = await supabase.from('user_emails')
        .select('id,email_address,platform,is_active').eq('user_id', req.user.id).eq('is_active', true);
      let unread = 0, mailboxes = 0;
      for (const mb of (rows || [])) {
        try {
          const adapter = mail.forMailbox(mb);
          const folders = await adapter.listFolders();
          const inbox = folders.find(f => f.kind === 'inbox');
          if (inbox) { unread += inbox.unread || 0; mailboxes++; }
        } catch (_) { /* a disconnected mailbox contributes nothing, silently */ }
      }
      const value = { unread, mailboxes };
      unreadCache.set(req.user.id, { at: Date.now(), value });
      res.json(value);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FOLDERS / LABELS
  // ══════════════════════════════════════════════════════════════════════════
  router.get('/mailbox/:mid/folders', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      res.json(await mail.forMailbox(mailbox).listFolders());
    } catch (err) { providerError(res, err); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // MESSAGES
  // ══════════════════════════════════════════════════════════════════════════
  router.get('/mailbox/:mid/messages', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 25));
      const page = await mail.forMailbox(mailbox).listMessages({
        folderId: req.query.folder || null,
        q: req.query.q || null,
        cursor: req.query.cursor || null,
        limit,
      });
      // In Sent, the interesting party is the recipient, not us.
      const addresses = [];
      for (const m of page.messages) {
        if (m.from?.email) addresses.push(m.from.email);
        for (const t of (m.to || [])) if (t.email) addresses.push(t.email);
      }
      const crm = await crmLinksFor(req, addresses);
      res.json({ ...page, crm });
    } catch (err) { providerError(res, err); }
  });

  router.get('/mailbox/:mid/messages/:id', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      // Images stay blocked unless the reader asks for them, message by
      // message — an inbound tracking pixel is exactly the technique PACE uses
      // on its own outbound mail, and the user should get to decide.
      const msg = await mail.forMailbox(mailbox).getMessage(req.params.id, {
        blockRemoteImages: req.query.images !== 'show',
      });
      const crm = await crmLinksFor(req, [msg.from?.email, ...(msg.to || []).map(t => t.email)]);
      res.json({ ...msg, crm });
    } catch (err) { providerError(res, err); }
  });

  router.get('/mailbox/:mid/messages/:id/attachments/:aid', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      const a = await mail.forMailbox(mailbox).getAttachment(req.params.id, req.params.aid);
      const buf = Buffer.from(a.base64 || '', 'base64');
      // Content-Disposition: attachment, always. An HTML attachment rendered
      // inline would run on this origin with the user's session.
      const name = String(req.query.name || a.filename || 'attachment').replace(/[^\w.\- ]+/g, '_');
      res.setHeader('Content-Type', a.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Length', String(buf.length));
      res.send(buf);
    } catch (err) { providerError(res, err); }
  });

  // Read / unread / flagged.
  router.patch('/mailbox/:mid/messages/:id', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      const adapter = mail.forMailbox(mailbox);
      if (req.body.read !== undefined) await adapter.setRead(req.params.id, !!req.body.read);
      if (req.body.flagged !== undefined) await adapter.setFlagged(req.params.id, !!req.body.flagged);
      unreadCache.delete(req.user.id);
      res.json({ success: true });
    } catch (err) { providerError(res, err); }
  });

  // Move. Graph hands back a NEW id (the old one stops resolving once the
  // message lands elsewhere); Gmail keeps the id. Both are returned as `id` so
  // the client can just take what it is given.
  router.post('/mailbox/:mid/messages/:id/move', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    if (!req.body.folder_id) return res.status(400).json({ error: 'folder_id required' });
    try {
      const r = await mail.forMailbox(mailbox).move(req.params.id, req.body.folder_id, {
        fromLabelId: req.body.from_folder_id || null,
      });
      unreadCache.delete(req.user.id);
      res.json(r);
    } catch (err) { providerError(res, err); }
  });

  router.post('/mailbox/:mid/messages/:id/archive', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      const r = await mail.forMailbox(mailbox).archive(req.params.id);
      unreadCache.delete(req.user.id);
      res.json(r);
    } catch (err) { providerError(res, err); }
  });

  // Trash — a MOVE to the provider's Trash/Deleted Items, never a permanent
  // delete. The user can always get it back from Outlook or Gmail. See the
  // adapter: neither platform's hard-delete call is reachable from this app.
  router.delete('/mailbox/:mid/messages/:id', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      const r = await mail.forMailbox(mailbox).trash(req.params.id);
      unreadCache.delete(req.user.id);
      res.json(r);
    } catch (err) { providerError(res, err); }
  });

  router.get('/mailbox/:mid/threads/:tid', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      res.json(await mail.forMailbox(mailbox).listThread(req.params.tid));
    } catch (err) { providerError(res, err); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SENDING
  // ══════════════════════════════════════════════════════════════════════════
  // Both of these go through the SAME provider send calls the outreach engine
  // uses. There is no second send path — that was the one thing worth getting
  // right before writing a line of the UI, because a second sender is how you
  // end up with mail that threads correctly in one half of the app and not the
  // other.
  //
  // What they deliberately do NOT do: inject the open-tracking pixel, or write
  // an email_tracking row. Tracking belongs to outreach — measuring whether a
  // campaign landed. Pixel-tracking a personal reply to a colleague is a
  // different thing entirely, and not one this product should do silently.
  router.post('/mailbox/:mid/messages/:id/reply', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    const text = String(req.body.body || '').trim();
    if (!text) return res.status(400).json({ error: 'Message body is empty' });
    const att = readAttachments(req.body);
    if (att.error) return res.status(att.error.status).json(att.error.body);
    try {
      const signature = await signatureFor(mailbox, req.user.id, req.body.include_signature);
      const htmlBody = buildHtmlEmailBody(text, signature, false);
      const r = await mail.forMailbox(mailbox).reply(req.params.id, {
        htmlBody,
        replyAll: !!req.body.reply_all,
        to: req.body.to ? parseAddressField(req.body.to) : null,
        cc: req.body.cc ? parseAddressField(req.body.cc) : null,
        subject: req.body.subject ? String(req.body.subject) : null,
        attachments: att.attachments,
      });
      res.json({ success: true, ...r });
    } catch (err) { providerError(res, err); }
  });

  // Forward. Graph's createForward carries the original's attachments across
  // for us; the Gmail adapter re-downloads and re-attaches them, because a
  // forward that silently drops the resume it was forwarding is worse than no
  // forward at all.
  router.post('/mailbox/:mid/messages/:id/forward', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    const to = parseAddressField(req.body.to);
    if (!to.length) return res.status(400).json({ error: 'Who are you forwarding this to?' });
    const att = readAttachments(req.body);
    if (att.error) return res.status(att.error.status).json(att.error.body);
    try {
      const signature = await signatureFor(mailbox, req.user.id, req.body.include_signature);
      // A forward with no note is normal — unlike a reply, the content is the
      // forwarded message itself, so an empty body is not an empty email.
      const htmlBody = buildHtmlEmailBody(String(req.body.body || ''), signature, false);
      const r = await mail.forMailbox(mailbox).forward(req.params.id, {
        htmlBody, to,
        cc: req.body.cc ? parseAddressField(req.body.cc) : null,
        subject: req.body.subject ? String(req.body.subject) : null,
        attachments: att.attachments,
        maxAttachBytes: MAX_ATTACH_BYTES,
      });
      res.json({ success: true, ...r });
    } catch (err) { providerError(res, err); }
  });

  router.post('/mailbox/:mid/send', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    const to = String(req.body.to || '').trim();
    const text = String(req.body.body || '').trim();
    if (!to) return res.status(400).json({ error: 'A recipient is required' });
    if (!text) return res.status(400).json({ error: 'Message body is empty' });
    const att = readAttachments(req.body);
    if (att.error) return res.status(att.error.status).json(att.error.body);
    try {
      const signature = await signatureFor(mailbox, req.user.id, req.body.include_signature);
      const htmlBody = buildHtmlEmailBody(text, signature, false);
      const subject = String(req.body.subject || '(no subject)');
      const cc = String(req.body.cc || '').trim();
      if (mailbox.platform === 'Gmail') {
        await gmailProvider.sendNewMessage(mailbox.id, {
          to, cc: cc || undefined, subject, htmlBody,
          fromAddress: mailbox.email_address, attachments: att.attachments,
        });
      } else {
        await sendMicrosoftNewMessage(mailbox.id, {
          to, subject, htmlBody,
          cc: cc ? cc.split(/[,;]/).map(x => x.trim()).filter(Boolean) : undefined,
          attachments: att.attachments,
        });
      }
      res.json({ success: true });
    } catch (err) { providerError(res, err); }
  });

  return router;
};
