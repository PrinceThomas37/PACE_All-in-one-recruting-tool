// ============================================================================
// MAILBOX SEND — the ONE way a New message, Reply or Forward leaves the in-app mailbox.
// ----------------------------------------------------------------------------
// Two callers: the Send button (routes/mailbox.js) and Schedule send (services/scheduled-sends.js, R-273, D-0163). Both go
// through check() and then send(), so a scheduled email is refused for exactly the reasons a sent one would be — and refused
// when it is SCHEDULED, not hours later when nobody is looking — and goes out exactly the way the button would send it.
// This is the code that used to sit inside the three route handlers, moved here unchanged in behaviour.
//
// What it deliberately does NOT do: inject the open-tracking pixel or write an email_tracking row. Tracking belongs to outreach;
// pixel-tracking a personal reply is a different thing, and not one this product does silently.
// ============================================================================
const { approxBytes } = require('./mail-provider');
const mailFormat = require('./mail-format');
const { fillSignatureHtml } = require('../email-signature');

// express.json() is capped at 5mb for the whole app, and base64 inflates a file by about a third — so this is the real ceiling.
const MAX_ATTACH_BYTES = 3.5 * 1024 * 1024;
const KINDS = ['new', 'reply', 'forward'];

// Attachments arrive as [{ filename, content_type, base64 }]. Validated before anything is sent.
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

// Labels chosen in the window before Send (R-244): up to 10, trimmed, no repeats.
function readLabelIds(body) {
  const raw = Array.isArray(body && body.label_ids) ? body.label_ids : [];
  const out = [];
  for (const x of raw) {
    const s = String(x == null ? '' : x).trim().slice(0, 200);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 10) break;
  }
  return out;
}

function bodyHasWords(body, formatted) {
  if (formatted) return !!mailFormat.visibleText(body);
  return !!String(body || '').trim();
}

/**
 * Would this email be refused? The same answers the Send button has always given, as { status, body } — or null when it can go.
 * kind: 'new' | 'reply' | 'forward'
 */
function check(kind, body) {
  body = body || {};
  if (!KINDS.includes(kind)) return { status: 400, body: { error: 'Unknown kind of email' } };
  const formatted = body.formatted === true;
  if (kind === 'forward') {
    if (!parseAddressField(body.to).length) return { status: 400, body: { error: 'Who are you forwarding this to?' } };
  } else {
    if (kind === 'new' && !String(body.to || '').trim()) return { status: 400, body: { error: 'A recipient is required' } };
    if (!bodyHasWords(String(body.body || ''), formatted)) return { status: 400, body: { error: 'Message body is empty' } };
  }
  const att = readAttachments(body);
  if (att.error) return att.error;
  return null;
}

function createMailboxSender(ctx) {
  const { mail, gmailProvider, sendMicrosoftNewMessage, buildHtmlEmailBody, getMailboxSignature } = ctx;

  // THE SIGNATURE: filled ({{sender}} / {{senderemail}} from the mailbox that sends), and OFF unless asked for — a signature
  // belongs on outreach; on a reply to a conversation in flight it is noise.
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

  // A formatted body (the window's toolbar) is cleaned to the recruiting set and is not escaped a second time. Anything that
  // does not say it was formatted stays plain text.
  function outboundHtml(body, signature, formatted) {
    if (formatted) return mailFormat.formattedEmailHtml(body, signature);
    return buildHtmlEmailBody(body, signature, false);
  }

  /**
   * Send it. Call check() first. Throws the provider's error (the route turns it into words; the scheduler records it).
   * Returns { success:true, ...provider result, label_error? }.
   */
  async function send(mailbox, userId, kind, messageId, body) {
    body = body || {};
    const formatted = body.formatted === true;
    const { attachments } = readAttachments(body);
    const signature = await signatureFor(mailbox, userId, body.include_signature);
    const prov = mail.forMailbox(mailbox);
    if (kind === 'reply') {
      const r = await prov.reply(messageId, {
        htmlBody: outboundHtml(String(body.body || ''), signature, formatted),
        replyAll: !!body.reply_all,
        to: body.to ? parseAddressField(body.to) : null,
        cc: body.cc ? parseAddressField(body.cc) : null,
        subject: body.subject ? String(body.subject) : null,
        attachments,
        labels: readLabelIds(body),
      });
      return { success: true, ...r };
    }
    if (kind === 'forward') {
      // Graph's createForward carries the original's attachments; the Gmail adapter re-attaches them, because a forward that
      // silently drops the resume it was forwarding is worse than no forward at all. A forward with no note is normal.
      const r = await prov.forward(messageId, {
        htmlBody: outboundHtml(String(body.body || ''), signature, formatted),
        to: parseAddressField(body.to),
        cc: body.cc ? parseAddressField(body.cc) : null,
        subject: body.subject ? String(body.subject) : null,
        attachments,
        maxAttachBytes: MAX_ATTACH_BYTES,
        labels: readLabelIds(body),
      });
      return { success: true, ...r };
    }
    // new
    const to = String(body.to || '').trim();
    const htmlBody = outboundHtml(String(body.body || ''), signature, formatted);
    const subject = String(body.subject || '(no subject)');
    const cc = String(body.cc || '').trim();
    const labels = readLabelIds(body);
    let label_error = null;
    if (mailbox.platform === 'Gmail') {
      const sent = await gmailProvider.sendNewMessage(mailbox.id, {
        to, cc: cc || undefined, subject, htmlBody,
        fromAddress: mailbox.email_address, attachments,
      });
      // Gmail can only label a message that exists: after the send. The mail has gone — a label that fails is reported,
      // never a failed send, and the send is never repeated.
      if (labels.length && sent && sent.messageId) {
        try { await gmailProvider.modifyLabels(mailbox.id, sent.messageId, { add: labels }); }
        catch (e) { label_error = (e && e.message) || 'the label could not be added'; }
      }
    } else {
      await sendMicrosoftNewMessage(mailbox.id, {
        to, subject, htmlBody,
        cc: cc ? cc.split(/[,;]/).map(x => x.trim()).filter(Boolean) : undefined,
        attachments,
        categories: labels,
      });
    }
    return { success: true, ...(label_error ? { label_error } : {}) };
  }

  return { check, send, signatureFor };
}

module.exports = { createMailboxSender, check, readAttachments, parseAddressField, readLabelIds, MAX_ATTACH_BYTES, KINDS };
