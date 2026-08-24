// ============================================================================
// MAIL PROVIDER — one mailbox interface over Microsoft Graph and Gmail.
// ----------------------------------------------------------------------------
// This is what makes an in-app inbox possible without writing the whole thing
// twice. Everything above it (routes/mailbox.js, the Inbox page) speaks ONE
// vocabulary — folders, messages, read/unread, move, trash, reply — and this
// module is the only place that knows Graph returns flat fields while Gmail
// returns a MIME tree and a bag of labels.
//
// THE LOAD-BEARING DECISION: **nothing here is stored.** Every read is a live
// pass-through to the provider, and every write (mark read, move, trash) lands
// on the REAL mailbox. Three reasons, all of which were already constraints on
// this project:
//
//   1. Supabase is on the free tier. Syncing every message body of every
//      connected mailbox is the single most expensive thing we could store,
//      and it buys nothing a live read doesn't already give.
//   2. Render is on the free tier. A sync needs a poller; a poller keeps the
//      service awake and eats the ~750 instance-hour budget (see the heartbeat
//      note in CLAUDE.md). A pass-through needs no schedule at all.
//   3. A mirror drifts. "Why isn't my email showing" and "I deleted this an
//      hour ago" are the two ways a synced inbox loses a user's trust, and
//      both are unfixable-by-design. A live read is never wrong.
//
// conversation_messages (migration 037) is deliberately NOT widened to hold
// this traffic. That table is the intelligence layer's record of the threads
// PACE is actively working — a lead's or candidate's conversation. This is a
// mail client. Same emails sometimes, entirely different job.
//
// SCOPES: this needs no new OAuth consent. Microsoft already grants
// `Mail.ReadWrite` and Gmail already grants `gmail.modify`, both of which
// cover read, folder/label moves and trash. Nobody has to reconnect.
//
//   ctx = { graphMailRequest, getMicrosoftToken, gmailProvider }
// ============================================================================

// ── Canonical folder kinds ──────────────────────────────────────────────────
// The six every mail client has, plus 'custom' for a user's own folders. The UI
// sorts and icons by KIND, never by name, so a mailbox in another language or
// with renamed folders still lands in the right place.
const FOLDER_ORDER = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash', 'custom'];

// Graph exposes wellKnownName on mailFolder, but only sometimes (it is absent
// on user-created folders and on some older tenants), so displayName is the
// fallback. Deliberately case-insensitive and space-insensitive.
const GRAPH_WELL_KNOWN = {
  inbox: 'inbox',
  drafts: 'drafts',
  sentitems: 'sent',
  deleteditems: 'trash',
  junkemail: 'junk',
  archive: 'archive',
  outbox: 'drafts',
};
const GRAPH_DISPLAY_NAMES = {
  'inbox': 'inbox',
  'drafts': 'drafts',
  'draft': 'drafts',
  'sent items': 'sent',
  'sent': 'sent',
  'deleted items': 'trash',
  'trash': 'trash',
  'junk email': 'junk',
  'junk': 'junk',
  'spam': 'junk',
  'archive': 'archive',
  'outbox': 'drafts',
};

function folderKindFromGraph(folder) {
  const wk = String(folder?.wellKnownName || '').toLowerCase().replace(/\s+/g, '');
  if (GRAPH_WELL_KNOWN[wk]) return GRAPH_WELL_KNOWN[wk];
  const dn = String(folder?.displayName || '').toLowerCase().trim();
  return GRAPH_DISPLAY_NAMES[dn] || 'custom';
}

// Gmail's system labels are a fixed, documented set — no guessing needed. A
// label whose type is 'user' is always custom, whatever it happens to be named
// (someone's "Sent to legal" label must not become the Sent folder).
const GMAIL_SYSTEM_KINDS = {
  INBOX: 'inbox',
  SENT: 'sent',
  DRAFT: 'drafts',
  TRASH: 'trash',
  SPAM: 'junk',
};
function folderKindFromGmailLabel(label) {
  if (label?.type === 'user') return 'custom';
  return GMAIL_SYSTEM_KINDS[String(label?.id || '').toUpperCase()] || 'custom';
}

// Gmail's category/system labels that are noise in a folder list — they are
// either implementation detail (UNREAD, STARRED as a folder) or Gmail-tab
// machinery the user never files into.
const GMAIL_HIDDEN_LABELS = new Set([
  'UNREAD', 'STARRED', 'IMPORTANT', 'CHAT',
  'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
]);

function sortFolders(folders) {
  return folders.slice().sort((a, b) => {
    const ka = FOLDER_ORDER.indexOf(a.kind), kb = FOLDER_ORDER.indexOf(b.kind);
    if (ka !== kb) return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

// ── Address parsing ─────────────────────────────────────────────────────────
// "Ada Lovelace <ada@x.com>" -> { name: 'Ada Lovelace', email: 'ada@x.com' }
function parseAddress(raw) {
  const s = String(raw || '').trim();
  if (!s) return { name: '', email: '' };
  const m = /^(.*?)<([^>]+)>\s*$/.exec(s);
  if (m) {
    return {
      name: m[1].trim().replace(/^["']|["']$/g, ''),
      email: m[2].trim().toLowerCase(),
    };
  }
  return { name: '', email: s.toLowerCase() };
}
// A header can carry several addresses; commas inside a quoted display name
// must not split it ("Lovelace, Ada" <ada@x.com>).
function parseAddressList(raw) {
  const s = String(raw || '');
  if (!s.trim()) return [];
  const out = [];
  let buf = '', inQuote = false, inAngle = false;
  for (const ch of s) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '<') inAngle = true;
    else if (ch === '>') inAngle = false;
    if (ch === ',' && !inQuote && !inAngle) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out.map(parseAddress).filter(a => a.email);
}
const graphAddress = (r) => ({
  name: r?.emailAddress?.name || '',
  email: String(r?.emailAddress?.address || '').toLowerCase(),
});

// ── HTML sanitising ─────────────────────────────────────────────────────────
// The reading pane renders in a sandboxed iframe with no script permission, so
// this is defence in depth rather than the only line — but a message body is
// the most hostile input this application handles, and it should never leave
// the server carrying an executable payload.
//
// Remote images are neutralised separately and for a different reason: a
// tracking pixel in an inbound email tells the sender you opened it, the exact
// technique PACE itself uses for outbound tracking. Blocking by default, with a
// "show images" affordance, is what a mail client owes its user.
const REMOVE_ELEMENTS = ['script', 'iframe', 'object', 'embed', 'applet', 'form', 'link', 'base', 'meta', 'noscript'];

function sanitizeEmailHtml(html, { blockRemoteImages = true } = {}) {
  let out = String(html || '');

  // Whole elements, contents included. Handles the unclosed-tag case too, since
  // an unterminated <script> would otherwise leave its body as visible text.
  for (const tag of REMOVE_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
  }

  // Inline event handlers, quoted or bare.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
           .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
           .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // javascript:/vbscript: and data: URLs in any attribute. data: images are the
  // one safe case and are kept — inline logos are extremely common in signatures.
  out = out.replace(/(href|src|action|formaction|background|poster)\s*=\s*(["'])\s*(?:javascript|vbscript|data)\s*:(?![^"']*?image\/)[^"']*\2/gi, '$1="#"');
  out = out.replace(/(href|src|action)\s*=\s*(?:javascript|vbscript):[^\s>]*/gi, '$1="#"');

  // CSS expression()/behavior/@import — legacy IE vectors that still show up in
  // spam and cost nothing to close.
  out = out.replace(/expression\s*\(/gi, 'x-expression(')
           .replace(/@import\b/gi, 'x-import')
           .replace(/behavior\s*:/gi, 'x-behavior:');

  if (blockRemoteImages) {
    // Park the real URL on a data attribute so "show images" is a client-side
    // swap rather than a second fetch of the whole message.
    out = out.replace(/<img\b([^>]*?)\ssrc\s*=\s*(["'])(https?:\/\/[^"']*)\2/gi,
      (_m, pre, q, url) => `<img${pre} data-blocked-src=${q}${url}${q}`);
    // Remote backgrounds are the same pixel wearing a hat.
    out = out.replace(/background-image\s*:\s*url\((["']?)https?:\/\/[^)]*\1\)/gi, 'background-image:none');
  }

  // Every link opens in a new tab; the iframe has no navigation rights anyway,
  // but this makes the intent explicit rather than accidental.
  out = out.replace(/<a\b(?![^>]*\btarget=)/gi, '<a target="_blank" rel="noopener noreferrer nofollow" ');
  return out;
}

// Did the ORIGINAL body carry remote images? The UI only offers "show images"
// when there is something to show. Checked before sanitising, because after
// sanitising there is nothing left to find.
function hasRemoteImages(html) {
  const s = String(html || '');
  return /<img\b[^>]*\ssrc\s*=\s*["']https?:\/\//i.test(s)
      || /background-image\s*:\s*url\(["']?https?:\/\//i.test(s);
}

// Plain-text bodies still need to reach an HTML pane. Escape first, then keep
// the line breaks the sender intended.
function textToHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}

// ── Message normalisation ───────────────────────────────────────────────────
// Both providers collapse to this one shape. Everything above this module
// reads these field names and nothing else.
function normalizeGraphMessage(m, { folderId } = {}) {
  if (!m) return null;
  return {
    id: m.id,
    thread_id: m.conversationId || null,
    folder_id: folderId || m.parentFolderId || null,
    subject: m.subject || '',
    from: graphAddress(m.from || m.sender),
    to: (m.toRecipients || []).map(graphAddress),
    cc: (m.ccRecipients || []).map(graphAddress),
    date: m.receivedDateTime || m.sentDateTime || null,
    preview: (m.bodyPreview || '').slice(0, 300),
    unread: m.isRead === false,
    flagged: m.flag?.flagStatus === 'flagged',
    has_attachments: !!m.hasAttachments,
    is_draft: !!m.isDraft,
    platform: 'Microsoft',
  };
}

// Gmail delivers headers as a list and everything else as labels, so this reads
// more like parsing than mapping. `format=metadata` is enough for a list row;
// `format=full` adds the body, handled by extractGmailBody below.
function normalizeGmailMessage(m, { folderId } = {}) {
  if (!m) return null;
  const h = {};
  for (const x of (m.payload?.headers || [])) h[String(x.name || '').toLowerCase()] = x.value;
  const labels = m.labelIds || [];
  return {
    id: m.id,
    thread_id: m.threadId || null,
    folder_id: folderId || null,
    subject: h.subject || '',
    from: parseAddress(h.from),
    to: parseAddressList(h.to),
    cc: parseAddressList(h.cc),
    // internalDate is epoch millis as a string and is the value Gmail itself
    // sorts by; the Date header is sender-supplied and can be anything.
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString()
        : (h.date ? new Date(h.date).toISOString() : null),
    preview: (m.snippet || '').slice(0, 300),
    unread: labels.includes('UNREAD'),
    flagged: labels.includes('STARRED'),
    has_attachments: gmailHasAttachment(m.payload),
    is_draft: labels.includes('DRAFT'),
    platform: 'Gmail',
    message_id_header: h['message-id'] || null,
    references_header: h.references || null,
  };
}

function gmailHasAttachment(part) {
  if (!part) return false;
  if (part.filename && part.body?.attachmentId) return true;
  return (part.parts || []).some(gmailHasAttachment);
}

// Walk the MIME tree for a renderable body. HTML wins when both exist — this is
// a reading pane, not the reply-quote stripper the sweep uses (which prefers
// text/plain precisely because it wants LESS markup).
function extractGmailBody(payload) {
  const decode = (d) => {
    try { return Buffer.from(String(d).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
    catch (_) { return ''; }
  };
  const find = (part, want) => {
    if (!part) return '';
    // An "attachment" that happens to be text/html is a forwarded file, not the
    // body — skip anything with a filename.
    if (part.mimeType === want && part.body?.data && !part.filename) return decode(part.body.data);
    for (const p of (part.parts || [])) { const f = find(p, want); if (f) return f; }
    return '';
  };
  const html = find(payload, 'text/html');
  if (html) return { html, isHtml: true };
  const text = find(payload, 'text/plain');
  return { html: textToHtml(text), isHtml: false };
}

function gmailAttachments(payload, out = []) {
  if (!payload) return out;
  if (payload.filename && payload.body?.attachmentId) {
    out.push({
      id: payload.body.attachmentId,
      name: payload.filename,
      content_type: payload.mimeType || 'application/octet-stream',
      size: payload.body.size || 0,
      // Gmail marks inline parts with a Content-Id; those are signature logos,
      // not things the user attached.
      inline: (payload.headers || []).some(h => /^content-id$/i.test(h.name || '')),
    });
  }
  (payload.parts || []).forEach(p => gmailAttachments(p, out));
  return out;
}

// ── Reply scaffolding ───────────────────────────────────────────────────────
// Who a reply goes to. Reply-all adds everyone who was on the original except
// the mailbox doing the replying — otherwise every reply-all mails yourself.
function replyRecipients(msg, { replyAll = false, ownAddress = '' } = {}) {
  const own = String(ownAddress || '').toLowerCase();
  const to = [msg.from].filter(a => a && a.email);
  if (!replyAll) return { to, cc: [] };
  const seen = new Set(to.map(a => a.email).concat(own ? [own] : []));
  const cc = [];
  for (const a of [...(msg.to || []), ...(msg.cc || [])]) {
    if (!a?.email || seen.has(a.email)) continue;
    seen.add(a.email);
    cc.push(a);
  }
  return { to, cc };
}

function replySubject(subject) {
  const s = String(subject || '').trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}
function forwardSubject(subject) {
  const s = String(subject || '').trim();
  return /^(fw|fwd):/i.test(s) ? s : `Fwd: ${s}`;
}

// The quoted original, in the shape both Gmail and Outlook produce, so a reply
// from PACE looks like a reply from anywhere else in the recipient's client.
function quoteBlock(msg, bodyHtml) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const when = msg.date ? new Date(msg.date).toUTCString() : '';
  const who = msg.from?.name ? `${msg.from.name} <${msg.from.email}>` : (msg.from?.email || '');
  return `<div style="border-left:2px solid #ccc;margin:16px 0 0;padding-left:12px;color:#555">`
    + `<div style="font-size:12px;color:#777;margin-bottom:8px">On ${esc(when)}, ${esc(who)} wrote:</div>`
    + (bodyHtml || '')
    + `</div>`;
}

// ── The adapter ─────────────────────────────────────────────────────────────
// createMailProvider(ctx).forMailbox(mailboxRow) hands back one object whose
// methods are identical across platforms. `mailbox` is a user_emails row and
// must carry at least { id, email_address, platform }.
function createMailProvider(ctx) {
  const { graphMailRequest, getMicrosoftToken, gmailProvider } = ctx;

  // Gmail needs one HTTP call per message to turn a list of ids into a list of
  // rows. Sequentially that is ~25 round trips and a visibly slow inbox; all at
  // once it is a burst that can trip the per-user rate limit. A small pool is
  // the middle, and it is the only place in this module that fans out.
  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        try { out[i] = await fn(items[i], i); } catch (_) { out[i] = null; }
      }
    });
    await Promise.all(workers);
    return out.filter(Boolean);
  }

  // ── Microsoft ─────────────────────────────────────────────────────────────
  function microsoftAdapter(mailbox) {
    const token = () => getMicrosoftToken(mailbox.id);

    // Graph returns top-level folders only; one level of children covers every
    // real mailbox layout without an unbounded walk. A child is named
    // "Parent / Child" so the list stays flat and still reads correctly.
    async function listFolders() {
      const t = await token();
      const data = await graphMailRequest(t, '/me/mailFolders?$top=60&$expand=childFolders($top=60)');
      const out = [];
      for (const f of (data.value || [])) {
        out.push({
          id: f.id,
          name: f.displayName || '',
          kind: folderKindFromGraph(f),
          unread: f.unreadItemCount || 0,
          total: f.totalItemCount || 0,
        });
        for (const c of (f.childFolders || [])) {
          out.push({
            id: c.id,
            name: `${f.displayName} / ${c.displayName}`,
            kind: folderKindFromGraph(c) === 'custom' ? 'custom' : folderKindFromGraph(c),
            unread: c.unreadItemCount || 0,
            total: c.totalItemCount || 0,
          });
        }
      }
      return sortFolders(out);
    }

    // Graph refuses $orderby together with $search, so a searched list is
    // relevance-ordered and an unsearched one is date-ordered. Cursor is a
    // plain $skip offset — Graph's nextLink would work too, but an integer
    // survives a page reload and a URL does not.
    async function listMessages({ folderId, q, cursor, limit = 25 } = {}) {
      const t = await token();
      const skip = Math.max(0, parseInt(cursor, 10) || 0);
      const select = 'id,conversationId,parentFolderId,subject,from,sender,toRecipients,ccRecipients,'
        + 'receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,isDraft,flag';
      const base = folderId ? `/me/mailFolders/${encodeURIComponent(folderId)}/messages` : '/me/messages';
      let path = `${base}?$top=${limit}&$skip=${skip}&$select=${select}`;
      if (q) path += `&$search=${encodeURIComponent(`"${String(q).replace(/"/g, '')}"`)}`;
      else path += '&$orderby=receivedDateTime desc';
      const data = await graphMailRequest(t, path);
      const messages = (data.value || []).map(m => normalizeGraphMessage(m, { folderId }));
      return {
        messages,
        next_cursor: messages.length === limit ? String(skip + limit) : null,
      };
    }

    async function getMessage(id, { blockRemoteImages = true } = {}) {
      const t = await token();
      const select = 'id,conversationId,parentFolderId,subject,from,sender,toRecipients,ccRecipients,'
        + 'receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,isDraft,flag,body,internetMessageId';
      const m = await graphMailRequest(t, `/me/messages/${encodeURIComponent(id)}?$select=${select}`);
      const raw = m.body?.content || '';
      const isHtml = (m.body?.contentType || '').toLowerCase() === 'html';
      const bodyHtml = isHtml ? raw : textToHtml(raw);
      let attachments = [];
      if (m.hasAttachments) {
        try {
          const a = await graphMailRequest(t, `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`);
          attachments = (a.value || []).map(x => ({
            id: x.id, name: x.name || 'attachment',
            content_type: x.contentType || 'application/octet-stream',
            size: x.size || 0, inline: !!x.isInline,
          }));
        } catch (_) { /* an unreadable attachment list must not hide the message */ }
      }
      return {
        ...normalizeGraphMessage(m),
        body_html: sanitizeEmailHtml(bodyHtml, { blockRemoteImages }),
        has_remote_images: hasRemoteImages(bodyHtml),
        attachments,
      };
    }

    async function getAttachment(messageId, attachmentId) {
      const t = await token();
      const a = await graphMailRequest(t, `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
      return {
        filename: a.name || 'attachment',
        content_type: a.contentType || 'application/octet-stream',
        base64: a.contentBytes || '',
      };
    }

    async function setRead(id, read) {
      const t = await token();
      await graphMailRequest(t, `/me/messages/${encodeURIComponent(id)}`, {
        method: 'PATCH', body: JSON.stringify({ isRead: !!read }),
      });
      return { ok: true };
    }

    async function setFlagged(id, flagged) {
      const t = await token();
      await graphMailRequest(t, `/me/messages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ flag: { flagStatus: flagged ? 'flagged' : 'notFlagged' } }),
      });
      return { ok: true };
    }

    // Graph's move RETURNS A NEW MESSAGE with a different id — the old id stops
    // resolving the moment the message lands in the destination folder. The
    // caller needs the new one or its next action 404s.
    async function move(id, destinationFolderId) {
      const t = await token();
      const m = await graphMailRequest(t, `/me/messages/${encodeURIComponent(id)}/move`, {
        method: 'POST', body: JSON.stringify({ destinationId: destinationFolderId }),
      });
      return { ok: true, id: m?.id || id };
    }

    // Deliberately a MOVE to Deleted Items, never DELETE /me/messages/{id}
    // (which is permanent and unrecoverable). Nothing in this product should be
    // able to destroy a customer's mail from a single click.
    async function trash(id) { return move(id, 'deleteditems'); }

    // Archive is its own verb rather than a move to a folder the caller picks,
    // because the two providers disagree about what archiving IS: Graph has a
    // real Archive folder, Gmail has no such label and archiving means dropping
    // INBOX. One verb, two correct implementations.
    async function archive(id) { return move(id, 'archive'); }

    async function reply(id, { htmlBody, replyAll = false, to, cc }) {
      const t = await token();
      const endpoint = replyAll ? 'createReplyAll' : 'createReply';
      const draft = await graphMailRequest(t, `/me/messages/${encodeURIComponent(id)}/${endpoint}`, {
        method: 'POST', body: JSON.stringify({}),
      });
      const full = await graphMailRequest(t, `/me/messages/${draft.id}?$select=body,subject,conversationId`);
      const quoted = full.body?.content || '';
      const patch = { body: { contentType: 'HTML', content: quoted ? `${htmlBody}<br><br>${quoted}` : htmlBody } };
      // Graph addresses createReply to the original SENDER, which is correct
      // here (unlike the follow-up path, where the "original" is our own sent
      // message and the sender is us). Only override when the caller edited the
      // recipients by hand.
      if (to?.length) patch.toRecipients = to.map(a => ({ emailAddress: { address: a.email || a } }));
      if (cc?.length) patch.ccRecipients = cc.map(a => ({ emailAddress: { address: a.email || a } }));
      await graphMailRequest(t, `/me/messages/${draft.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await graphMailRequest(t, `/me/messages/${draft.id}/send`, { method: 'POST' });
      return { ok: true, thread_id: full.conversationId || null };
    }

    // Every message in one conversation, oldest first — the thread view.
    async function listThread(threadId) {
      const t = await token();
      const select = 'id,conversationId,parentFolderId,subject,from,sender,toRecipients,ccRecipients,'
        + 'receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,isDraft,flag';
      const params = `$filter=conversationId eq '${String(threadId).replace(/'/g, "''")}'`
        + `&$select=${select}&$top=50`;
      const data = await graphMailRequest(t, `/me/messages?${params}`);
      return (data.value || [])
        .map(m => normalizeGraphMessage(m))
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    }

    return {
      platform: 'Microsoft', mailbox,
      listFolders, listMessages, getMessage, getAttachment,
      setRead, setFlagged, move, trash, archive, reply, listThread,
    };
  }

  // ── Gmail ─────────────────────────────────────────────────────────────────
  function gmailAdapter(mailbox) {
    const id = mailbox.id;

    // Gmail's labels.list carries no counts, so each visible label needs its own
    // labels.get. Capped and pooled: an inbox that is slightly wrong about the
    // unread count on a rarely-used label is fine, one that takes ten seconds
    // to open is not.
    async function listFolders() {
      const raw = await gmailProvider.listLabels(id);
      const visible = (raw || []).filter(l => !GMAIL_HIDDEN_LABELS.has(String(l.id || '').toUpperCase()));
      const withCounts = await pool(visible.slice(0, 25), 6, async (l) => {
        try {
          const d = await gmailProvider.getLabel(id, l.id);
          return { ...l, messagesTotal: d.messagesTotal, messagesUnread: d.messagesUnread };
        } catch (_) { return l; }
      });
      const byId = {}; withCounts.forEach(l => { byId[l.id] = l; });
      return sortFolders(visible.map(l => {
        const c = byId[l.id] || l;
        return {
          id: l.id,
          name: l.name || l.id,
          kind: folderKindFromGmailLabel(l),
          unread: c.messagesUnread || 0,
          total: c.messagesTotal || 0,
        };
      }));
    }

    async function listMessages({ folderId, q, cursor, limit = 25 } = {}) {
      const page = await gmailProvider.listMessagePage(id, {
        labelIds: folderId ? [folderId] : undefined,
        q: q || undefined,
        maxResults: limit,
        pageToken: cursor || undefined,
      });
      const heads = page.messages || [];
      // metadata format: headers without bodies, which is all a list row needs
      // and a fraction of the payload of format=full.
      const rows = await pool(heads, 8, async (h) => {
        const raw = await gmailProvider.getMessage(id, h.id, {
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID', 'References'],
        });
        return normalizeGmailMessage(raw, { folderId });
      });
      // The pool preserves order, but a message that failed to fetch drops out —
      // re-sorting keeps the list monotonic rather than gappy.
      rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      return { messages: rows, next_cursor: page.nextPageToken || null };
    }

    async function getMessage(msgId, { blockRemoteImages = true } = {}) {
      const raw = await gmailProvider.getMessage(id, msgId, { format: 'full' });
      const base = normalizeGmailMessage(raw);
      const { html } = extractGmailBody(raw.payload);
      return {
        ...base,
        body_html: sanitizeEmailHtml(html, { blockRemoteImages }),
        has_remote_images: hasRemoteImages(html),
        attachments: gmailAttachments(raw.payload),
      };
    }

    async function getAttachment(messageId, attachmentId) {
      const a = await gmailProvider.getAttachment(id, messageId, attachmentId);
      // Gmail returns base64URL; every consumer here wants standard base64.
      const b64 = String(a.data || '').replace(/-/g, '+').replace(/_/g, '/');
      return { filename: 'attachment', content_type: 'application/octet-stream', base64: b64 };
    }

    async function setRead(msgId, read) {
      await gmailProvider.modifyLabels(id, msgId, read ? { remove: ['UNREAD'] } : { add: ['UNREAD'] });
      return { ok: true };
    }
    async function setFlagged(msgId, flagged) {
      await gmailProvider.modifyLabels(id, msgId, flagged ? { add: ['STARRED'] } : { remove: ['STARRED'] });
      return { ok: true };
    }

    // Gmail has no folders — "moving" is swapping one label for another. The
    // id never changes (unlike Graph), so the caller's id stays valid.
    async function move(msgId, destinationLabelId, { fromLabelId } = {}) {
      const remove = [];
      if (fromLabelId && fromLabelId !== destinationLabelId) remove.push(fromLabelId);
      await gmailProvider.modifyLabels(id, msgId, { add: [destinationLabelId], remove });
      return { ok: true, id: msgId };
    }

    // messages.trash, not messages.delete — recoverable from the Trash label,
    // same guarantee as the Microsoft side.
    async function trash(msgId) {
      await gmailProvider.trashMessage(id, msgId);
      return { ok: true, id: msgId };
    }

    // Gmail has no Archive label. Archiving IS removing INBOX — the message
    // stays in All Mail and stays findable by search, which is exactly what
    // Graph's move-to-Archive does on the other side.
    async function archive(msgId) {
      await gmailProvider.modifyLabels(id, msgId, { remove: ['INBOX'] });
      return { ok: true, id: msgId };
    }

    async function reply(msgId, { htmlBody, replyAll = false, to, cc }) {
      const original = await getMessage(msgId, { blockRemoteImages: false });
      const rec = (to?.length || cc?.length)
        ? { to: (to || []).map(a => ({ email: a.email || a })), cc: (cc || []).map(a => ({ email: a.email || a })) }
        : replyRecipients(original, { replyAll, ownAddress: mailbox.email_address });
      const body = htmlBody + quoteBlock(original, original.body_html);
      const headers = {};
      if (rec.cc?.length) headers.Cc = rec.cc.map(a => a.email).join(', ');
      const r = await gmailProvider.sendThreadReply(id, {
        to: rec.to.map(a => a.email).join(', '),
        subject: replySubject(original.subject),
        htmlBody: body,
        fromAddress: mailbox.email_address,
        threadId: original.thread_id,
        // RFC 5322 threading: without these the reply starts a new thread in
        // the recipient's client even though Gmail groups it correctly on ours.
        inReplyTo: original.message_id_header || undefined,
        references: [original.references_header, original.message_id_header].filter(Boolean).join(' ') || undefined,
        headers,
      });
      return { ok: true, thread_id: r.threadId || original.thread_id || null };
    }

    async function listThread(threadId) {
      const t = await gmailProvider.getThread(id, threadId);
      return (t.messages || [])
        .map(m => normalizeGmailMessage(m))
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    }

    return {
      platform: 'Gmail', mailbox,
      listFolders, listMessages, getMessage, getAttachment,
      setRead, setFlagged, move, trash, archive, reply, listThread,
    };
  }

  function forMailbox(mailbox) {
    if (!mailbox) throw new Error('No mailbox');
    return mailbox.platform === 'Gmail' ? gmailAdapter(mailbox) : microsoftAdapter(mailbox);
  }

  return { forMailbox };
}

module.exports = {
  createMailProvider,
  // Pure helpers — exported so they can be tested without a network, and reused
  // wherever else mail has to be normalised.
  FOLDER_ORDER, GMAIL_HIDDEN_LABELS,
  folderKindFromGraph, folderKindFromGmailLabel, sortFolders,
  parseAddress, parseAddressList,
  sanitizeEmailHtml, hasRemoteImages, textToHtml,
  normalizeGraphMessage, normalizeGmailMessage,
  extractGmailBody, gmailAttachments,
  replyRecipients, replySubject, forwardSubject, quoteBlock,
};
