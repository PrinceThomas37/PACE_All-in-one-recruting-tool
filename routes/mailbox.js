const { formatter: dtf, isZone } = require('../services/date-format');   // one formatter per kind, made once (R-298: per-row formatters filled the server's memory)
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
const { createMailProvider } = require('../services/mail-provider');
const { mailboxConnections } = require('../mailbox-health');
// The one send path (Send button and Schedule send): services/mailbox-send.js.
const { createMailboxSender, readAttachments, parseAddressField } = require('../services/mailbox-send');
const recipientSuggest = require('../services/recipient-suggest');
const { getSetting } = require('../config/settings');

// The nav badge asks for an unread count on every render. That is one provider
// call per mailbox per render, which is both slow and rude to the API — so the
// answer is cached briefly, per user. 60s is short enough that a read message
// clears within a normal attention span and long enough that clicking around
// the app costs nothing.
const UNREAD_TTL_MS = 60 * 1000;
const unreadCache = new Map(); // userId -> { at, value }

// Folder lists carry counts and, on Gmail, cost one provider call PER LABEL (up to 26 for one
// mailbox). Switching tabs and accounts asked for them every time. Held briefly, per mailbox,
// and dropped the moment anything in that mailbox changes — so a count is never older than 30s
// and never survives the action that changed it. In memory only; nothing is stored.
const FOLDERS_TTL_MS = 30 * 1000;
const folderCache = new Map(); // mailboxId -> { at, value }

// The people a mailbox has written to (the suggestions under To / Cc). Read from its own Sent folder, held a few minutes in memory,
// per mailbox, never stored (the in-app mailbox mirrors nothing into Postgres).
const RECIPIENTS_TTL_MS = 10 * 60 * 1000;
const recipientCache = new Map(); // mailboxId -> { at, value }

module.exports = (ctx) => {
  const router = express.Router();
  const {
    supabase, db, auth, orgIdFor,
    graphMailRequest, getMicrosoftToken, gmailProvider,
    sendMicrosoftNewMessage, buildHtmlEmailBody, getMailboxSignature,
  } = ctx;

  const mail = createMailProvider({ graphMailRequest, getMicrosoftToken, gmailProvider });

  // THE SIGNATURE (filled from the sending mailbox, off unless asked), the attachment cap, the address lists and the three
  // sends live in services/mailbox-send.js — shared with Schedule send, so there is still only one sender.
  const sender = createMailboxSender({ mail, gmailProvider, sendMicrosoftNewMessage, buildHtmlEmailBody, getMailboxSignature });
  const signatureFor = sender.signatureFor;

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
    // ONE round trip, not two (20 Oct): the database is in Seoul and the server in Ohio, so every sequential query costs ~200 ms.
    // The mailbox row and "is it connected?" are asked together; which token table matters is only known from the row, so BOTH
    // tables are asked and the right one is read afterwards.
    const [{ data: mb }, gTok, mTok] = await Promise.all([
      supabase.from('user_emails')
        .select('id,user_id,org_id,email_address,display_name,platform,is_active,is_primary')
        .eq('id', mailboxId).maybeSingle(),
      supabase.from('gmail_tokens').select('user_email_id').eq('user_email_id', mailboxId).maybeSingle(),
      supabase.from('microsoft_tokens').select('user_email_id').eq('user_email_id', mailboxId).maybeSingle(),
    ]);
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
    // An app-password mailbox (SMTP/IMAP) sends and gets its replies read, but the in-app inbox is not built for it yet. Said plainly —
    // not "reconnect", which would send the person round in circles.
    if (String(mb.platform || '').toLowerCase() === 'smtp') {
      return { error: { status: 409, body: { error: 'The in-app inbox is not available for app-password mailboxes yet. Read this mailbox in its own webmail — PACE still sends from it and notices replies.', code: 'not_supported' } } };
    }
    const tok = (mb.platform === 'Gmail' ? gTok : mTok).data;
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
    // The two lookups do not depend on each other, so they run together — one database
    // round trip of waiting instead of two, on every list and every opened message.
    const [contactRes, candRes] = await Promise.all([
      Promise.resolve(scoped.from('contacts')
        .select('id,first_name,last_name,email,job_id').in('email', uniq).limit(120)).catch(() => ({ data: null })),
      Promise.resolve(scoped.from('candidates')
        .select('id,full_name,email').in('email', uniq).is('deleted_at', null).limit(120)).catch(() => ({ data: null })),
    ]);
    // A cross-link is a nicety; never fail the inbox for it.
    for (const c of ((contactRes && contactRes.data) || [])) {
      const key = String(c.email || '').toLowerCase();
      if (!key || out[key]) continue;
      out[key] = {
        type: 'contact', id: c.id, job_id: c.job_id || null,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
      };
    }
    for (const c of ((candRes && candRes.data) || [])) {
      const key = String(c.email || '').toLowerCase();
      // A contact match wins: a BD conversation is the more actionable link,
      // and the same address being both is rare enough not to need a UI for.
      if (!key || out[key]) continue;
      out[key] = { type: 'candidate', id: c.id, name: c.full_name || c.email };
    }
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
      // 8 Oct (owner: "it does not show which email ID received the new email"): the total is the sum of these,
      // so the screen can say where it came from. A disconnected mailbox is simply absent from the list.
      const perMailbox = [];
      for (const mb of (rows || [])) {
        try {
          const adapter = mail.forMailbox(mb);
          const folders = await adapter.listFolders();
          const inbox = folders.find(f => f.kind === 'inbox');
          if (inbox) { unread += inbox.unread || 0; mailboxes++; perMailbox.push({ id: mb.id, email: mb.email_address, unread: inbox.unread || 0 }); }
        } catch (_) { /* a disconnected mailbox contributes nothing, silently */ }
      }
      const value = { unread, mailboxes, per_mailbox: perMailbox };
      unreadCache.set(req.user.id, { at: Date.now(), value });
      res.json(value);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FOLDERS / LABELS
  // ══════════════════════════════════════════════════════════════════════════
  // WHO YOU HAVE WRITTEN TO (14 Oct, owner): the suggestions under To / Cc. Read from this mailbox's own Sent folder; how many sent
  // emails is the admin's number. Held 10 minutes in memory; a send drops it so the person just written to appears at once.
  router.get('/mailbox/:mid/recipients', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      const hit = recipientCache.get(mailbox.id);
      if (hit && Date.now() - hit.at < RECIPIENTS_TTL_MS) return res.json(hit.value);
      const prov = mail.forMailbox(mailbox);
      let folders = (folderCache.get(mailbox.id) || {}).value;
      if (!folders) { folders = await prov.listFolders(); folderCache.set(mailbox.id, { at: Date.now(), value: folders }); }
      const sent = (folders || []).find(f => f.kind === 'sent');
      const want = Number(await getSetting(supabase, 'mailbox_recipient_lookback', orgIdFor(req))) || 100;
      const read = [];
      let cursor = null;
      while (sent && read.length < want) {
        const page = await prov.listMessages({ folderId: sent.id, cursor, limit: Math.min(50, want - read.length) });
        read.push(...page.messages);
        cursor = page.next_cursor;
        if (!cursor || !page.messages.length) break;
      }
      const value = { recipients: recipientSuggest.collectRecipients(read, [mailbox.email_address]), read: read.length };
      recipientCache.set(mailbox.id, { at: Date.now(), value });
      res.json(value);
    } catch (err) { providerError(res, err); }
  });

  router.get('/mailbox/:mid/folders', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      const hit = folderCache.get(mailbox.id);
      if (hit && Date.now() - hit.at < FOLDERS_TTL_MS) return res.json(hit.value);
      const value = await mail.forMailbox(mailbox).listFolders();
      folderCache.set(mailbox.id, { at: Date.now(), value });
      res.json(value);
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

  // ── CONVERSATIONS (R-271) and ALL INBOXES (R-272) ─────────────────────────
  // The folder list (cached as above) tells a conversation which folders do not count (Trash, Junk — unless that is the
  // folder being read) and where Sent is (Outlook reads it to bring a conversation we just answered to the top).
  async function folderFacts(mailbox, prov, folderId) {
    let folders = (folderCache.get(mailbox.id) || {}).value;
    if (!folders) { folders = await prov.listFolders(); folderCache.set(mailbox.id, { at: Date.now(), value: folders }); }
    const kindOf = (k) => (folders || []).filter(f => f.kind === k);
    return {
      hidden: kindOf('trash').concat(kindOf('junk')).map(f => f.id).filter(id => id !== folderId),
      sentId: (kindOf('sent')[0] || {}).id || null,
      inboxId: (kindOf('inbox')[0] || {}).id || null,
    };
  }
  async function withCrm(req, rows) {
    const addresses = [];
    for (const r of rows) {
      if (r.party && r.party.email) addresses.push(r.party.email);
      if (r.from && r.from.email) addresses.push(r.from.email);
    }
    return crmLinksFor(req, addresses);
  }

  router.get('/mailbox/:mid/conversations', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 25));
      const prov = mail.forMailbox(mailbox);
      const folderId = req.query.q ? null : (req.query.folder || null);
      const facts = await folderFacts(mailbox, prov, folderId);
      const page = await prov.listConversations({
        folderId, q: req.query.q || null, cursor: req.query.cursor || null, limit,
        hidden: facts.hidden, sentId: facts.sentId,
      });
      res.json({ ...page, crm: await withCrm(req, page.conversations) });
    } catch (err) { providerError(res, err); }
  });

  // ALL INBOXES (R-272, the owner's teammate: "all inbox option like we have on Gmail … the system shows which email is for
  // which email ID"). The inbox of every mailbox the caller can open — each through ownedMailbox(), the only door in, so
  // nothing here reaches a mailbox the per-mailbox screen could not — merged newest first, every row carrying the
  // address it belongs to. A mailbox that cannot be read just now is named in `skipped`, never silently missing.
  // The cursor is each mailbox's own next page; a mailbox with nothing more drops out of the next page.
  router.get('/mailbox-all/inbox', auth, async (req, res) => {
    try {
      const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 25));
      const threads = req.query.view !== 'messages';
      let cur = null;
      if (req.query.cursor) {
        try { cur = JSON.parse(Buffer.from(String(req.query.cursor), 'base64').toString('utf8')) || {}; }
        catch (_) { return res.status(400).json({ error: 'That page could not be read — refresh the inbox' }); }
      }
      const { data: rows } = await supabase.from('user_emails')
        .select('id,email_address').eq('user_id', req.user.id).eq('is_active', true)
        .order('is_primary', { ascending: false });
      const skipped = [];
      const pages = await Promise.all((rows || []).map(async (row) => {
        if (cur && !cur[row.id]) return null;                       // that mailbox had nothing more
        const { mailbox, error } = await ownedMailbox(req, row.id);
        if (error) { skipped.push({ id: row.id, email: row.email_address, reason: error.body.error }); return null; }
        try {
          const prov = mail.forMailbox(mailbox);
          const pre = await folderFacts(mailbox, prov, null);
          if (!pre.inboxId) return null;
          const facts = await folderFacts(mailbox, prov, pre.inboxId);
          const cursor = cur ? cur[row.id] : null;
          // A search reaches every folder of every mailbox, as a search in one mailbox does (14 Oct).
          const q = req.query.q ? String(req.query.q) : null;
          const page = threads
            ? await prov.listConversations({ folderId: q ? null : pre.inboxId, q, cursor, limit, hidden: q ? [] : facts.hidden, sentId: facts.sentId })
            : await prov.listMessages({ folderId: q ? null : pre.inboxId, q, cursor, limit });
          const items = (threads ? page.conversations : page.messages).map(x => ({
            ...x, mailbox_id: mailbox.id, mailbox_email: mailbox.email_address, list_folder_id: pre.inboxId,
          }));
          return { id: mailbox.id, items, next: page.next_cursor || null };
        } catch (err) {
          skipped.push({ id: row.id, email: row.email_address, reason: 'could not be read just now — try Refresh' });
          return null;
        }
      }));
      const live = pages.filter(Boolean);
      const items = live.flatMap(p => p.items).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const next = {}; live.forEach(p => { if (p.next) next[p.id] = p.next; });
      res.json({
        [threads ? 'conversations' : 'messages']: items,
        next_cursor: Object.keys(next).length ? Buffer.from(JSON.stringify(next), 'utf8').toString('base64') : null,
        mailboxes: live.length, skipped,
        crm: await withCrm(req, items),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
      unreadCache.delete(req.user.id); folderCache.delete(mailbox.id); recipientCache.delete(mailbox.id);
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
      unreadCache.delete(req.user.id); folderCache.delete(mailbox.id); recipientCache.delete(mailbox.id);
      res.json(r);
    } catch (err) { providerError(res, err); }
  });

  router.post('/mailbox/:mid/messages/:id/archive', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try {
      const r = await mail.forMailbox(mailbox).archive(req.params.id);
      unreadCache.delete(req.user.id); folderCache.delete(mailbox.id); recipientCache.delete(mailbox.id);
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
      unreadCache.delete(req.user.id); folderCache.delete(mailbox.id); recipientCache.delete(mailbox.id);
      res.json(r);
    } catch (err) { providerError(res, err); }
  });

  // ═════════════════════════════════════════════════════════════════
  // LABELS  (Gmail labels / Outlook categories) and BULK ACTIONS
  // ═════════════════════════════════════════════════════════════════
  router.get('/mailbox/:mid/labels', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try { res.json(await mail.forMailbox(mailbox).listLabels()); }
    catch (err) { providerError(res, err); }
  });

  router.post('/mailbox/:mid/labels', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    const name = String(req.body.name || '').trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'Give the label a name' });
    try { res.json(await mail.forMailbox(mailbox).createLabel(name)); }
    catch (err) { providerError(res, err); }
  });

  router.post('/mailbox/:mid/messages/:id/labels', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    const clean = (v) => (Array.isArray(v) ? v : []).map(x => String(x || '').slice(0, 200)).filter(Boolean).slice(0, 20);
    try {
      await mail.forMailbox(mailbox).setLabels(req.params.id, { add: clean(req.body.add), remove: clean(req.body.remove) });
      res.json({ success: true });
    } catch (err) { providerError(res, err); }
  });

  // One request for "do this to all of them" — a hundred round trips from the browser was the
  // slow way to do it. Capped, each message answered on its own (one failure never hides the
  // others), and — as everywhere in this file — Delete is a MOVE to Trash, never destruction.
  const BULK_MAX = 50, BULK_ACTIONS = ['trash', 'archive', 'read', 'unread', 'label', 'unlabel'];
  router.post('/mailbox/:mid/bulk', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(x => String(x || '')).filter(Boolean))] : [];
    const action = String(req.body.action || '');
    if (!ids.length) return res.status(400).json({ error: 'Pick at least one message' });
    if (ids.length > BULK_MAX) return res.status(400).json({ error: `Pick at most ${BULK_MAX} messages at a time`, code: 'too_many' });
    if (!BULK_ACTIONS.includes(action)) return res.status(400).json({ error: 'Unknown action' });
    const labelId = String(req.body.label_id || '').slice(0, 200);
    if ((action === 'label' || action === 'unlabel') && !labelId) return res.status(400).json({ error: 'label_id required' });
    const adapter = mail.forMailbox(mailbox);
    const one = async (id) => {
      if (action === 'trash') return adapter.trash(id);
      if (action === 'archive') return adapter.archive(id);
      if (action === 'read') return adapter.setRead(id, true);
      if (action === 'unread') return adapter.setRead(id, false);
      if (action === 'label') return adapter.setLabels(id, { add: [labelId] });
      return adapter.setLabels(id, { remove: [labelId] });
    };
    const results = new Array(ids.length);
    let next = 0;
    // Four at a time: quick, and under the providers' per-user burst limits.
    await Promise.all(new Array(Math.min(4, ids.length)).fill(0).map(async () => {
      while (true) {
        const i = next++; if (i >= ids.length) return;
        try { const r = await one(ids[i]); results[i] = { id: ids[i], ok: true, new_id: (r && r.id) || ids[i] }; }
        catch (e) { results[i] = { id: ids[i], ok: false, error: String((e && e.message) || 'failed').slice(0, 160) }; }
      }
    }));
    unreadCache.delete(req.user.id); folderCache.delete(mailbox.id); recipientCache.delete(mailbox.id);
    const failed = results.filter(r => !r.ok).length;
    res.json({ ok: results.length - failed, failed, results });
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
  // ONE handler shape for all three: the same check the scheduler makes, then the same send.
  function sendRoute(kind) {
    return async (req, res) => {
      const { mailbox, error } = await ownedMailbox(req, req.params.mid);
      if (error) return res.status(error.status).json(error.body);
      const refused = sender.check(kind, req.body);
      if (refused) return res.status(refused.status).json(refused.body);
      try {
        const r = await sender.send(mailbox, req.user.id, kind, req.params.id || null, req.body);
        recipientCache.delete(mailbox.id);   // the person just written to is a suggestion from now on
        if (ctx.sentSweepSoon) ctx.sentSweepSoon(mailbox.id);   // "we replied" reaches Needs you today in seconds (R-296)
        res.json(r);
      } catch (err) { providerError(res, err); }
    };
  }
  // ── DRAFTS SAVED IN GMAIL / OUTLOOK (R-287, owner 20 Oct) ───────────────────────────────────
  // "Save draft" in the New message and Reply windows puts the words in the mailbox's own Drafts folder (so they follow the person
  // to their phone and to Gmail/Outlook itself). `ref` identifies the draft on the next save. Your own mailboxes only (ownedMailbox).
  // A forward is not saved this way. Nothing here sends anything.
  router.post('/mailbox/:mid/drafts', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    const b = req.body || {};
    const kind = b.kind === 'reply' ? 'reply' : 'new';
    if (kind === 'reply' && !b.message_id) return res.status(400).json({ error: 'Which email is this answering?' });
    if (!String(b.body || '').replace(/<[^>]*>/g, '').trim() && !String(b.to || '').trim() && !String(b.subject || '').trim()) {
      return res.status(400).json({ error: 'There is nothing to save yet' });
    }
    const att = readAttachments(b);
    if (att.error) return res.status(att.error.status).json(att.error.body);
    try {
      const r = await mail.forMailbox(mailbox).saveDraft({
        ref: b.ref ? String(b.ref).slice(0, 300) : null, kind, messageId: b.message_id ? String(b.message_id) : null,
        htmlBody: sender.draftHtml(b.body, b.formatted === true),
        to: b.to ? parseAddressField(b.to) : [], cc: b.cc ? parseAddressField(b.cc) : [],
        subject: b.subject ? String(b.subject) : '', attachments: att.attachments,
      });
      res.json({ success: true, ref: r.ref, saved_at: new Date().toISOString() });
    } catch (err) {
      if (err && err.status === 409) return res.status(409).json({ error: err.message });
      providerError(res, err);
    }
  });
  // The draft is moved to the mailbox's Trash (never destroyed) once its email has been sent from PACE.
  router.delete('/mailbox/:mid/drafts/:ref', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    try { res.json(await mail.forMailbox(mailbox).deleteDraft(req.params.ref)); } catch (err) { providerError(res, err); }
  });

  // ── SCHEDULE SEND (R-273, D-0162/D-0163) ──────────────────────────────────
  // The window's Schedule button: the same check as Send, NOW (so a mistake is fixed while the person is there), then stored
  // for the engine (services/scheduled-sends.js) to send through the same path at the time chosen. The time is an instant;
  // the person's time zone is kept so the screen shows it back the way they picked it.
  const SCHEDULE_FIELDS = ['to', 'cc', 'subject', 'body', 'formatted', 'include_signature', 'reply_all', 'label_ids', 'attachments'];
  function validZone(tz) {
    if (!tz) return null;
    return isZone(String(tz)) ? String(tz).slice(0, 64) : null;
  }
  router.post('/mailbox/:mid/schedule', auth, async (req, res) => {
    const { mailbox, error } = await ownedMailbox(req, req.params.mid);
    if (error) return res.status(error.status).json(error.body);
    const kind = String(req.body.kind || '');
    const refused = sender.check(kind, req.body);
    if (refused) return res.status(refused.status).json(refused.body);
    if ((kind === 'reply' || kind === 'forward') && !req.body.message_id) return res.status(400).json({ error: 'Which email is this answering?' });
    const at = Date.parse(String(req.body.send_at || ''));
    if (!Number.isFinite(at)) return res.status(400).json({ error: 'Pick a date and a time to send it' });
    if (at <= Date.now() + 30 * 1000) return res.status(400).json({ error: 'That time has already passed — pick a later time, or press Send' });
    const payload = {};
    SCHEDULE_FIELDS.forEach((k) => { if (req.body[k] !== undefined) payload[k] = req.body[k]; });
    try {
      const { data, error: dbErr } = await db.forRequest(req).from('scheduled_sends').insert({
        org_id: orgIdFor(req) || mailbox.org_id, user_id: req.user.id, mailbox_id: mailbox.id, kind,
        message_id: req.body.message_id ? String(req.body.message_id).slice(0, 500) : null,
        payload, send_at: new Date(at).toISOString(), timezone: validZone(req.body.timezone), status: 'scheduled',
      }).select('id,send_at,timezone').single();
      if (dbErr) {
        // Before migration 067 is applied the table does not exist: said plainly, the email is NOT lost (the window stays open).
        if (/scheduled_sends|relation|does not exist|schema cache/i.test(dbErr.message || '')) return res.status(503).json({ error: 'Scheduling is not switched on yet — press Send, or try again later', code: 'not_ready' });
        return res.status(500).json({ error: dbErr.message });
      }
      res.json({ success: true, scheduled: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // The Scheduled tab: the person's own scheduled emails — waiting, being sent, and the ones that did not go (with why).
  // Never another person's, never the attachments themselves (only their names).
  router.get('/mailbox-scheduled', auth, async (req, res) => {
    try {
      const { data, error: dbErr } = await db.forRequest(req).from('scheduled_sends')
        .select('id,mailbox_id,kind,message_id,payload,send_at,timezone,status,error,sent_at,created_at')
        .eq('user_id', req.user.id).in('status', ['scheduled', 'sending', 'failed'])
        .order('send_at', { ascending: true }).limit(200);
      if (dbErr) {
        if (/scheduled_sends|relation|does not exist|schema cache/i.test(dbErr.message || '')) return res.json({ items: [], ready: false });
        return res.status(500).json({ error: dbErr.message });
      }
      const ids = [...new Set((data || []).map(r => r.mailbox_id))];
      const emails = {};
      if (ids.length) {
        const { data: mbs } = await supabase.from('user_emails').select('id,email_address').in('id', ids).eq('user_id', req.user.id);
        (mbs || []).forEach((m) => { emails[m.id] = m.email_address; });
      }
      res.json({ ready: true, items: (data || []).map((r) => {
        const p = r.payload || {};
        const words = String(p.body || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        return {
          id: r.id, mailbox_id: r.mailbox_id, mailbox_email: emails[r.mailbox_id] || null, kind: r.kind, message_id: r.message_id,
          to: p.to || '', cc: p.cc || '', subject: p.subject || '', preview: words.slice(0, 160),
          attachments: (Array.isArray(p.attachments) ? p.attachments.map(a => a && a.filename) : (p.attachment_names || [])).filter(Boolean),
          send_at: r.send_at, timezone: r.timezone, status: r.status, error: r.error,
        };
      }) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Cancel (a scheduled or a failed one). Its attachments go with it. Not yours / not there → 404, the same answer.
  router.delete('/mailbox-scheduled/:id', auth, async (req, res) => {
    try {
      const { data: row } = await db.forRequest(req).from('scheduled_sends').select('id,payload,status')
        .eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (row.status !== 'scheduled' && row.status !== 'failed') return res.status(409).json({ error: row.status === 'sending' ? 'It is being sent right now' : 'It has already gone' });
      const p = Object.assign({}, row.payload || {}); delete p.attachments;
      const { data, error: dbErr } = await db.forRequest(req).from('scheduled_sends')
        .update({ status: 'cancelled', payload: p, updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('user_id', req.user.id).in('status', ['scheduled', 'failed']).select('id');
      if (dbErr) return res.status(500).json({ error: dbErr.message });
      if (!data || !data.length) return res.status(409).json({ error: 'It is being sent right now' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Send now (a scheduled one) / Send again (one that did not go — the person has checked their Sent folder). The engine takes
  // it at its next pass, which is within a couple of minutes while PACE is in use.
  router.post('/mailbox-scheduled/:id/send-now', auth, async (req, res) => {
    try {
      const { data, error: dbErr } = await db.forRequest(req).from('scheduled_sends')
        .update({ status: 'scheduled', send_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString() })
        .eq('id', req.params.id).eq('user_id', req.user.id).in('status', ['scheduled', 'failed']).select('id');
      if (dbErr) return res.status(500).json({ error: dbErr.message });
      if (!data || !data.length) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/mailbox/:mid/messages/:id/reply', auth, sendRoute('reply'));
  router.post('/mailbox/:mid/messages/:id/forward', auth, sendRoute('forward'));
  router.post('/mailbox/:mid/send', auth, sendRoute('new'));

  return router;
};
