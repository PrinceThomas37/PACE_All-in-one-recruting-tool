// ============================================================================
// OUTREACH GENERATOR — the API behind the Email page's "Generator" tab.
//
//   POST /outreach/generate   posting + contact  →  {subject, diagnosis, email}
//   POST /outreach/send       that draft         →  sent, tracked, logged
//   GET  /outreach/sender     which mailbox will actually send, and as whom
//
// Two things this file deliberately does NOT do:
//
//   • It does not open a second send path. The send goes through the same
//     sendMailboxNewMessage() the outreach engine and the candidate/client
//     emails use — passed in, not re-implemented — so Gmail vs Graph, the
//     compliance footer, the signature and the tracking pixel all behave the
//     way they do everywhere else.
//   • It does not require an API key. Drafting falls back to the rules engine
//     in services/outreach-generator.js, which is the whole feature minus the
//     prose polish. A deployment with no ANTHROPIC_API_KEY still gets emails.
//
// The sending address is NOT a user choice: it is the outreach mailbox already
// assigned to the caller (recruiterSendingMailbox). Letting the page name a
// From address would let anyone send as anyone.
// ============================================================================

const express = require('express');
const { fetchWithTimeout } = require('../http-client');
const { emailSyntaxValid } = require('../email-validation');
const { newToken: newTrackToken, injectPixel: injectTrackPixel } = require('../email-tracking');
const gen = require('../services/outreach-generator');

// Drafting is slower than a normal API call but the browser is waiting on it.
const AI_TIMEOUT_MS = 30000;
const AI_MODEL = process.env.OUTREACH_AI_MODEL || 'claude-sonnet-5';

function aiConfigured() {
  const k = process.env.ANTHROPIC_API_KEY;
  return !!k && k !== 'your_anthropic_api_key_here';
}

module.exports = (ctx) => {
  const router = express.Router();
  const {
    supabase, auth, today, buildHtmlEmailBody, getMailboxSignature,
    loadSuppressedSet, recruiterSendingMailbox, sendMailboxNewMessage,
  } = ctx;

  // The org's own name — this text goes out under the CUSTOMER's identity, so
  // it is looked up per request rather than baked in. "Fute Global LLC" is one
  // org's name, not the product's.
  async function orgCompanyName(req) {
    try {
      if (!req.orgId) return gen.DEFAULT_COMPANY;
      const { data } = await supabase.from('organizations').select('name').eq('id', req.orgId).maybeSingle();
      return (data && data.name) || gen.DEFAULT_COMPANY;
    } catch (_) { return gen.DEFAULT_COMPANY; }
  }

  // The caller's job title. Not on the JWT (claims carry id/email/roles/name
  // only), so it is read from `users` — a missing one is an empty string, never
  // a guess.
  async function senderTitle(req) {
    try {
      const { data } = await supabase.from('users').select('designation').eq('id', req.user.id).maybeSingle();
      return (data && data.designation) || '';
    } catch (_) { return ''; }
  }

  // Everything the page needs to say "this will send as ...", including the
  // honest answer when nothing is connected (the page then points at setup
  // instead of letting someone write an email they cannot send).
  router.get('/outreach/sender', auth, async (req, res) => {
    try {
      const [mailbox, companyName, title] = await Promise.all([
        recruiterSendingMailbox(req.user.id),
        orgCompanyName(req),
        senderTitle(req)
      ]);
      res.json({
        company_name: companyName,
        ai: aiConfigured(),
        mailbox: mailbox ? {
          id: mailbox.id,
          email: mailbox.email_address,
          display_name: mailbox.display_name || null,
          platform: mailbox.platform || 'Microsoft'
        } : null,
        sender: { name: req.user.name || '', title }
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/outreach/generate', auth, async (req, res) => {
    try {
      const input = req.body || {};
      const check = gen.validateInput(input);
      if (!check.ok) return res.status(400).json({ error: 'Fill in: ' + check.missing.join(', ') + '.' });

      const [companyName, defaultTitle] = await Promise.all([orgCompanyName(req), senderTitle(req)]);
      // The sender identity is the caller's, never whatever the page posted —
      // the same rule the send path follows.
      const withSender = {
        ...input,
        sender: {
          name: req.user.name || '',
          title: String((input.sender && input.sender.title) || defaultTitle || '').trim(),
          email: req.user.email || ''
        }
      };

      if (!aiConfigured()) {
        return res.json({ ...gen.rulesDraft(withSender, { companyName }), ai_available: false });
      }

      try {
        const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: AI_MODEL,
            max_tokens: 1000,
            system: gen.buildSystemPrompt(companyName),
            messages: [{ role: 'user', content: gen.buildUserPayload(withSender) }]
          })
        }, { timeoutMs: AI_TIMEOUT_MS });
        if (!response.ok) throw new Error('ai_http_' + response.status);
        const data = await response.json();
        const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        const parsed = gen.parseAiDraft(text);
        if (!parsed) throw new Error('ai_unparseable');
        const usage = data.usage || {};
        return res.json({
          ...parsed, mode: 'ai', ai_available: true,
          usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 }
        });
      } catch (aiErr) {
        // A drafting failure is not a dead end — the rules engine writes the
        // same shape. The page says which engine produced what it is showing.
        return res.json({
          ...gen.rulesDraft(withSender, { companyName }),
          ai_available: true,
          ai_error: aiErr.message
        });
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/outreach/send', auth, async (req, res) => {
    try {
      const b = req.body || {};
      const to = String(b.to || '').trim();
      const subject = String(b.subject || '').trim();
      const bodyText = String(b.body || '');
      if (!to || !emailSyntaxValid(to)) return res.status(400).json({ error: 'A valid recipient email is required.' });
      if (!subject) return res.status(400).json({ error: 'Subject is required.' });
      if (!bodyText.trim()) return res.status(400).json({ error: 'The email body is empty.' });

      const mailbox = await recruiterSendingMailbox(req.user.id);
      if (!mailbox) return res.status(409).json({ error: 'no_connected_mailbox' });

      const suppressed = await loadSuppressedSet([to]);
      if (suppressed.has(to.toLowerCase())) {
        return res.status(409).json({ error: 'This address has opted out of email from us.' });
      }

      const signature = await getMailboxSignature(mailbox.id, req.user.id).catch(() => '');
      const token = newTrackToken();
      const htmlBody = injectTrackPixel(buildHtmlEmailBody(bodyText, signature), token);
      await sendMailboxNewMessage(mailbox, { to, subject, htmlBody });

      const orgId = req.orgId || null;
      await supabase.from('email_tracking').insert({
        token, channel: 'outreach', to_email: to, subject,
        sent_by: req.user.id, mailbox_email: mailbox.email_address || null,
        ...(orgId ? { org_id: orgId } : {})
      });
      const { data: sendLog } = await supabase.from('email_send_log')
        .select('id,emails_sent').eq('send_date', today()).eq('user_email_id', mailbox.id).maybeSingle();
      await supabase.from('email_send_log').upsert(
        { user_email_id: mailbox.id, send_date: today(), emails_sent: (sendLog?.emails_sent || 0) + 1 },
        { onConflict: 'user_email_id,send_date' }
      );

      res.json({ sent: true, mailbox: mailbox.email_address });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
