// ============================================================================
// {{sendercompany}} — THE COMPANY THE SENDING EMAIL ID WRITES FOR (owner, 8 Oct: "your company name section, so it can be added easily
// for different email IDs"). Like {{sender}} it is resolved at SEND time from the mailbox that actually sends, because the same wording
// can go out from two email IDs that write for two different companies. The company is the one said on that mailbox ("sends as",
// `ue_<id>_sends_as`, set in My Setup or on the Outreach Plan).
//
//   * a stored email keeps the token; every reader that has the mailbox fills it (renderStoredEmail via `sends_as_company`);
//   * the send REFUSES an email whose mailbox has no company (never blanks it — "I'm Ash with ." is worse than a held email); it
//     lands in "Didn't send" with the reason, fixable by saying the company and pressing Retry;
//   * once an email is SENT the company is written into the stored text, so history and quoted replies never show the token.
// ============================================================================
'use strict';
const { sendsAsKey, cleanSendsAs } = require('../email-signature');

const TOKEN = /{{sendercompany}}/g;

/** Does this text still carry the token? (fresh regex each call: a /g test() keeps state) */
const hasToken = (text) => /{{sendercompany}}/.test(String(text == null ? '' : text));

/** Fill ONLY this token — nothing else in the text is touched. */
const fillCompany = (text, company) => String(text == null ? '' : text).replace(TOKEN, String(company || ''));

/** { mailboxId: company } for these mailboxes ('' when none has said one). A read that fails is "not said", never a crash. */
async function companiesFor(supabase, mailboxIds) {
  const ids = [...new Set((mailboxIds || []).filter(Boolean))];
  const out = {};
  ids.forEach((id) => { out[id] = ''; });
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 60) {
    try {
      const chunk = ids.slice(i, i + 60);
      const { data } = await supabase.from('app_settings').select('key,value').in('key', chunk.map(sendsAsKey));
      (data || []).forEach((r) => {
        const id = String(r.key).replace(/^ue_/, '').replace(/_sends_as$/, '');
        try { out[id] = cleanSendsAs(JSON.parse(r.value || 'null')).company || ''; } catch (_) { /* unreadable = not said */ }
      });
    } catch (_) { /* not said */ }
  }
  return out;
}

/** The mailbox row with its company attached (null stays null). */
const withCompany = (mailbox, map) => (mailbox ? { ...mailbox, sends_as_company: (map && map[mailbox.id]) || '' } : mailbox);

/**
 * The send-time gate for one outbound email. → { needs:false } when its text has no {{sendercompany}};
 *   { needs:true, company, mailbox }  the mailbox to send with (its company attached), or
 *   { needs:true, error }             no company said for that mailbox — the caller HOLDS the email, never sends it with a hole.
 */
async function prepareForSend(supabase, email, mailbox, mailboxId) {
  const needs = hasToken(email && email.subject) || hasToken(email && email.body);
  if (!needs) return { needs: false };
  const id = (mailbox && mailbox.id) || mailboxId;
  const company = (await companiesFor(supabase, [id]))[id] || '';
  const who = (mailbox && mailbox.email_address) || (email && email.from_email) || 'this email ID';
  if (!company) return { needs: true, error: `No sending email configured for a company yet — say which company ${who} writes for (Outreach Plan → Your company, or My Setup), then press Retry.` };
  return { needs: true, company, mailbox: withCompany(mailbox || { id }, { [id]: company }) };
}

module.exports = { hasToken, fillCompany, companiesFor, withCompany, prepareForSend };
