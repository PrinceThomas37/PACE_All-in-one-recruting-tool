// ============================================================================
// SMTP DELIVERY — how one outbound email leaves through a mailbox connected with an app password (D-0120, R-200 step b).
// The counterpart of services/gmail-delivery.js, and it answers the send loop in the same terms.
// ----------------------------------------------------------------------------
// THREADING. Gmail and Outlook thread by an id the provider hands back. Here PACE makes the message's own Message-ID, stores it
// (emails.graph_message_id), and a follow-up carries In-Reply-To (the email it answers) and References (the thread's root, then
// that email) — the headers every mail program threads by. The ROOT is stored as emails.conversation_id, the same column the
// other providers use, so a reply to ours is recognised as belonging to a thread PACE started (the reply sweep reads the same).
// The earlier email is quoted underneath the follow-up, as it is on the other providers. With no earlier sent email to answer,
// the follow-up goes out fresh, "Re:" removed, with the quote under it — never a "Re:" that pretends to be a reply.
//
// ONE ATTEMPT. A send is tried once; a failure is turned into a message the send loop's rules (services/send-retry.js) already
// understand:
//   • the sign-in was refused           → "sign-in expired" (temporary for the email, and the mailbox is set aside for the run)
//   • the server rejected the RECIPIENT → "recipient rejected" (permanent — a fact about them, never retried)
//   • the server refused the MESSAGE    → "restricted mailbox" (needs a person — waiting will not fix it)
//   • a 4xx answer                      → temporary (busy / rate-limited)
//   • the connection DIED after the message began → "timed out" (UNCERTAIN: it may have been accepted; never retried by itself)
//   • the connection never opened       → temporary, and said plainly that nothing was sent
// An error with no usable detail is treated as UNCERTAIN — the safe side of "email somebody twice".
// ============================================================================
'use strict';

const crypto = require('crypto');
const { decodeEntities } = require('./html-entities');
const { freshFollowup, isFollowup } = require('./gmail-delivery');

function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, h, t) => (String(t).replace(/<[^>]+>/g, '').trim() === h ? h : t.replace(/<[^>]+>/g, '') + ' (' + h + ')'))
    .replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The Error the send loop gets for a failed SMTP send — see the vocabulary above. `err` is nodemailer's error. */
function toSendError(err, recipient) {
  const code = String((err && err.code) || ''), cmd = String((err && err.command) || ''), rc = Number(err && err.responseCode) || 0;
  const detail = String((err && (err.response || err.message)) || '').replace(/\s+/g, ' ').slice(0, 160);
  const mk = (text, extra) => Object.assign(new Error(text), extra || {});
  if (code === 'EAUTH' || rc === 535 || rc === 534 || /invalid login|authentication (failed|unsuccessful)/i.test(detail))
    return mk('Sending mailbox sign-in expired — the mail server refused the app password. Reconnect this mailbox with a new one.', { smtpAuth: true });
  if (rc >= 500 && /^RCPT TO/i.test(cmd)) return mk('Recipient rejected by the mail server' + (recipient ? ' (' + recipient + ')' : '') + ': ' + detail);
  if (rc >= 500) return mk('The mail server refused this message — a restricted mailbox or blocked content: ' + detail);
  if (rc >= 400) return mk('The mail server is busy or rate-limiting this mailbox — it will try again later: ' + detail);
  // ONLY errors that can happen before any conversation with the server count as "nothing was sent". nodemailer labels a connection
  // that died MID-MESSAGE as command "CONN" too (measured against a local server that cut the line during DATA), so the command
  // cannot be trusted to say how far it got — every other dropped connection is UNCERTAIN, the safe side of emailing someone twice.
  const neverStarted = /^(ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EDNS|ETLS)$/.test(code) || /^(connection timeout|greeting never received|connect |getaddrinfo )/i.test(String((err && err.message) || '')) || /^(connect|getaddrinfo)$/.test(String((err && err.syscall) || ''));   // an OS error from opening the connection ("connect ECONNREFUSED …")
  if (neverStarted) return mk('Could not reach the mail server — the connection failed before anything was sent, so it will try again later.');   // no raw detail: its wording ("timeout") would read as "may have been sent"
  return mk('The connection timed out while the message was being sent — it may or may not have gone out: ' + (detail || 'no detail given'));
}

/**
 * supabase:   reads the earlier email of this lead's thread (emails.graph_message_id / conversation_id)
 * store:      services/smtp-store.js          mailbox: services/smtp-mailbox.js
 * buildQuote: ({ jobId, contactId, followupType }) → the earlier email as a quote block, '' when none (index.js buildQuotedChainFromDb)
 */
function createSmtpDelivery({ supabase, store, mailbox, buildQuote, makeId }) {
  const newId = makeId || (() => crypto.randomBytes(16).toString('hex'));

  // The most recent email already SENT to this person about this lead — what a follow-up answers.
  async function priorSent(email) {
    const { data } = await supabase.from('emails')
      .select('graph_message_id,conversation_id,subject')
      .eq('job_id', email.job_id).eq('contact_id', email.contact_id).eq('status', 'sent')
      .not('graph_message_id', 'is', null).order('sent_at', { ascending: false }).limit(1).maybeSingle();
    return data && data.graph_message_id ? data : null;
  }

  async function deliver(email, userEmailId, htmlBody, sendingEmail) {
    const loaded = await store.get(userEmailId);
    if (!loaded) throw new Error('No app-password sign-in for this mailbox — sign-in expired, reconnect it under My Setup.');
    if (loaded.error) throw new Error('This mailbox\'s saved password can no longer be read — sign-in expired, reconnect it under My Setup.');

    const fromAddress = (sendingEmail && sendingEmail.email_address) || email.from_email || loaded.row.email_address;
    const fromName = (sendingEmail && sendingEmail.display_name) || '';
    const domain = String(fromAddress).split('@')[1] || 'localhost';
    const messageId = '<' + newId() + '@' + domain + '>';

    let subject = email.subject, html = htmlBody, headers = {}, root = messageId, parent = null;
    if (isFollowup(email)) {
      const prior = await priorSent(email);
      let quote = '';
      try { quote = await buildQuote({ jobId: email.job_id, contactId: email.contact_id, followupType: email.followup_type }); } catch (_) { quote = ''; }
      if (prior) {
        parent = prior.graph_message_id; root = prior.conversation_id || parent;
        headers['In-Reply-To'] = parent;
        headers.References = root === parent ? parent : root + ' ' + parent;
        html = quote ? htmlBody + '<br><br>' + quote : htmlBody;
      } else {
        const fresh = freshFollowup({ subject, htmlBody, quote });
        subject = fresh.subject; html = fresh.htmlBody;
      }
    }

    const message = {
      from: fromName ? { name: fromName, address: fromAddress } : fromAddress,
      to: email.to_email, subject, html, text: htmlToText(html), messageId, headers,
    };
    let info;
    try { info = await mailbox.sendMail(loaded.cfg, loaded.creds, message); }
    catch (e) {
      const out = toSendError(e, email.to_email);
      if (out.smtpAuth) await store.outcome(userEmailId, false, 'The mail server refused the app password');
      throw out;
    }
    const rejected = (info && info.rejected) || [];
    if (rejected.length && !((info.accepted || []).length)) throw new Error('Recipient rejected by the mail server (' + rejected.join(', ') + ')');
    await store.outcome(userEmailId, true);
    return { graphMessageId: messageId, conversationId: root, inReplyTo: parent };
  }

  // A fresh message from a mailbox row — the recruiter / candidate / client emails, which have no earlier email to answer. Same
  // identity, same Message-ID and the same failure vocabulary as deliver(). `attachments`: [{ filename, contentType, base64 }].
  async function sendNew(mailboxRow, { to, cc, subject, htmlBody, attachments }) {
    const loaded = await store.get(mailboxRow.id);
    if (!loaded) throw new Error('No app-password sign-in for this mailbox — sign-in expired, reconnect it under My Setup.');
    if (loaded.error) throw new Error('This mailbox\'s saved password can no longer be read — sign-in expired, reconnect it under My Setup.');
    const fromAddress = mailboxRow.email_address || loaded.row.email_address;
    const messageId = '<' + newId() + '@' + (String(fromAddress).split('@')[1] || 'localhost') + '>';
    const message = {
      from: mailboxRow.display_name ? { name: mailboxRow.display_name, address: fromAddress } : fromAddress,
      to, subject, html: htmlBody, text: htmlToText(htmlBody), messageId,
    };
    if (cc && cc.length) message.cc = cc;
    if (attachments && attachments.length) message.attachments = attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(String(a.base64 || ''), 'base64') }));
    try { await mailbox.sendMail(loaded.cfg, loaded.creds, message); }
    catch (e) {
      const out = toSendError(e, to);
      if (out.smtpAuth) await store.outcome(mailboxRow.id, false, 'The mail server refused the app password');
      throw out;
    }
    await store.outcome(mailboxRow.id, true);
    return { graphMessageId: messageId, conversationId: messageId, inReplyTo: null };
  }

  return { deliver, priorSent, sendNew };
}

module.exports = { createSmtpDelivery, toSendError, htmlToText };
