'use strict';
// ============================================================================
// BOUNCES THAT LAND IN A GMAIL MAILBOX (R-314, 26 Oct).
//
// The owner's colleague asked: "when a blocked or undelivered email reaches the mailbox or spam, can the email status
// change automatically?" For Outlook it already did (index.js sweepMailboxBounces: Inbox + Junk every 30 minutes), and
// for app-password mailboxes too (INBOX / Junk / Spam). A GMAIL mailbox was never read for bounces at all — the reply
// sweep skips a bounce notice on purpose ("the bounce sweep's job") and the bounce sweep only opened Outlook and IMAP.
// So an address that bounced from Gmail stayed "valid" and kept getting follow-ups, which is what damages a domain.
//
// This reads the same notices from Gmail, Spam included, and hands each to the SAME rule every provider uses
// (index.js markBouncesFromMessages → services/bounce-mark.js, scoped to the mailbox's own company).
//
// Light on purpose (the free server's memory, see sweepGmailReplies): Gmail is asked only for messages that LOOK like a
// bounce and are newer than the last visit, and each is downloaded, handled and let go one at a time.
// ============================================================================

// What a bounce looks like to Gmail's search. The NDR rule itself (isNdrMessage) still decides; this only keeps the
// download small. Gmail's own bounces come from mailer-daemon@googlemail.com ("Mail Delivery Subsystem").
const NDR_QUERY = '(from:mailer-daemon OR from:postmaster OR subject:undeliverable OR subject:"delivery status notification"'
  + ' OR subject:"failure notice" OR subject:"returned mail" OR subject:"delivery failure" OR subject:"undelivered mail"'
  + ' OR subject:"mail delivery failed" OR subject:"message not delivered")';

const DAY_MS = 86400000;

async function sweepGmailBounces({ gmailProvider, supabase, tokenRow, ownAddresses, markBouncesFromMessages, now = () => new Date(), maxResults = 50 }) {
  if (!gmailProvider || !gmailProvider.isConfigured()) return { marked: 0, read: 0 };
  const sinceKey = `bounce_sweep_since_${tokenRow.user_email_id}`;
  const { data: sinceRow } = await supabase.from('app_settings').select('value').eq('key', sinceKey).maybeSingle();
  const since = (sinceRow && sinceRow.value) || new Date(now().getTime() - 7 * DAY_MS).toISOString();
  const afterSec = Math.max(0, Math.floor(Date.parse(since) / 1000) || 0);

  const page = await gmailProvider.listMessagePage(tokenRow.user_email_id, {
    q: `after:${afterSec} ${NDR_QUERY}`, includeSpamTrash: true, maxResults,
  });

  let marked = 0, read = 0, newest = since;
  for (const h of (page.messages || [])) {
    let norm = null;
    try { norm = gmailProvider.normalizeMessage(await gmailProvider.getMessage(tokenRow.user_email_id, h.id, { format: 'full' })); }
    catch (_) { continue; }                                   // one unreadable message must not end the sweep
    if (!norm || !(norm.receivedDateTime > since)) continue;  // the exact bound (Gmail's after: is whole seconds)
    read++;
    const r = await markBouncesFromMessages([norm], ownAddresses, tokenRow, 'gmail', newest);
    marked += r.marked;
    if (r.newest > newest) newest = r.newest;
  }
  await supabase.from('app_settings').upsert({ key: sinceKey, value: newest, updated_at: now() }, { onConflict: 'key' });
  return { marked, read };
}

module.exports = { sweepGmailBounces, NDR_QUERY };
