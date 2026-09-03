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
//     prose polish. A deployment with no AI provider still gets emails, and so
//     does one whose free tier ran out mid-afternoon.
//
// The sending address is NOT a user choice: it is the outreach mailbox already
// assigned to the caller (recruiterSendingMailbox). Letting the page name a
// From address would let anyone send as anyone.
// ============================================================================

const express = require('express');
const aiProvider = require('../services/ai-provider');
const { emailSyntaxValid } = require('../email-validation');
const { newToken: newTrackToken, injectPixel: injectTrackPixel } = require('../email-tracking');
const { fillSignatureHtml } = require('../email-signature');
const gen = require('../services/outreach-generator');

// An explicit override for this feature only; otherwise the model comes from
// whichever provider Admin → Integrations has configured.
const AI_MODEL = process.env.OUTREACH_AI_MODEL || null;

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

  const txtOf = (v) => String(v == null ? '' : v).trim();

  // THE SIGNATURE IS A TEMPLATE, AND AN UNFILLED PLACEHOLDER IS VISIBLE TO THE
  // RECIPIENT. Signature HTML holds {{sender}} and {{senderemail}}; this router
  // appended the raw template on its first real send, so a live prospect got an
  // email signed "{{sender}} / Recruitment Manager | Fute Global LLC" with
  // "{{senderemail}}" where the address should be.
  //
  // routes/mailbox.js carries a comment describing this exact bug, from the
  // last time it happened. Anything that composes mail fills the signature —
  // and it fills it from the MAILBOX, so the name in the signature is the name
  // on the From line.
  async function mailboxSignature(mailbox, userId) {
    if (!mailbox) return '';
    try {
      const raw = await getMailboxSignature(mailbox.id, userId);
      return fillSignatureHtml(raw, {
        displayName: mailbox.display_name || mailbox.email_address || '',
        emailAddress: mailbox.email_address || '',
      });
    } catch (_) { return ''; }
  }

  // ── WHO THE EMAIL IS FROM ────────────────────────────────────────────────
  // The name in the sign-off comes from the MAILBOX THAT WILL SEND, not from
  // the logged-in session. This is the Session 14 rule and it is not a detail:
  // a draft signed "BD Lead 1" going out over prince.thomas@futeglobal.com is
  // the same failure that put "I'm Jennifer Thomas" over Prince Thomas's From
  // line on 152 cold emails. The mailbox is the identity; the session is just
  // whoever is typing.
  //
  // Falling back to the session name is only for the case where the mailbox has
  // no display name of its own — never a preference for the session.
  async function senderIdentity(req, mailbox) {
    let title = '';
    try {
      const { data } = await supabase.from('users').select('designation').eq('id', req.user.id).maybeSingle();
      title = (data && data.designation) || '';
    } catch (_) { /* a missing title is an empty string, never a guess */ }
    return {
      name: (mailbox && txtOf(mailbox.display_name)) || txtOf(req.user.name) || '',
      email: (mailbox && mailbox.email_address) || req.user.email || '',
      title,
    };
  }

  // Everything the page needs to say "this will send as ...", including the
  // honest answer when nothing is connected (the page then points at setup
  // instead of letting someone write an email they cannot send).
  router.get('/outreach/sender', auth, async (req, res) => {
    try {
      const [mailbox, companyName] = await Promise.all([
        recruiterSendingMailbox(req.user.id),
        orgCompanyName(req)
      ]);
      const identity = await senderIdentity(req, mailbox);
      res.json({
        company_name: companyName,
        ai: aiConfigured(),
        mailbox: mailbox ? {
          id: mailbox.id,
          email: mailbox.email_address,
          display_name: mailbox.display_name || null,
          platform: mailbox.platform || 'Microsoft'
        } : null,
        sender: identity,
        signature_html: await mailboxSignature(mailbox, req.user.id)
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/outreach/generate', auth, async (req, res) => {
    try {
      const input = req.body || {};
      const check = gen.validateInput(input);
      if (!check.ok) return res.status(400).json({ error: 'Fill in: ' + check.missing.join(', ') + '.' });

      // Resolve the mailbox BEFORE drafting: the draft has to be signed by
      // whoever is going to send it, and the page never gets to say who that is.
      const [companyName, mailbox] = await Promise.all([
        orgCompanyName(req), recruiterSendingMailbox(req.user.id)
      ]);
      const identity = await senderIdentity(req, mailbox);
      // Whether the body signs itself depends on whether a signature will be
      // appended — so the draft on screen is exactly what the recipient gets.
      const signatureHtml = await mailboxSignature(mailbox, req.user.id);
      const draftOpts = { companyName, omitSignOff: !!signatureHtml.trim() };
      const withSender = {
        ...input,
        sender: {
          name: identity.name,
          title: String((input.sender && input.sender.title) || identity.title || '').trim(),
          email: identity.email
        }
      };

      // Every framing at once, so the writer picks instead of regenerating and
      // hoping for a different sentence. The first is the default; the rest sit
      // behind the picker above the preview.
      const built = gen.rulesVariants(withSender, draftOpts);
      const base = {
        variants: built.variants,
        used: built.used,
        company_rejected: built.company_rejected,
        sends_as: mailbox ? mailbox.email_address : null,
        signature_html: signatureHtml
      };

      if (!(await aiProvider.isAvailable(supabase))) {
        return res.json({ ...built.variants[0], ...base, ai_available: false });
      }

      try {
        const out = await aiProvider.complete(supabase, {
          model: AI_MODEL || undefined,
          maxTokens: 1000,
          system: gen.buildSystemPrompt(companyName, { omitSignOff: draftOpts.omitSignOff }),
          prompt: gen.buildUserPayload(withSender),
        });
        if (!out) throw new Error('ai_unavailable');
        const parsed = gen.parseAiDraft(out.text);
        if (!parsed) throw new Error('ai_unparseable');
        const usage = out.usage || {};
        // The AI writes one email; the rules writer's framings stay alongside it
        // so the choice is never lost when a key is configured.
        return res.json({
          ...parsed, mode: 'ai', ai_available: true, ...base,
          engine: out.provider, engine_model: out.model,
          variants: [{ id: 'ai', label: 'AI draft', blurb: 'Written by the AI writer for this posting.',
                       subject: parsed.subject, diagnosis: parsed.diagnosis, email: parsed.email,
                       words: gen.wordCount(parsed.email), mode: 'ai' }].concat(built.variants),
          usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 }
        });
      } catch (aiErr) {
        // A drafting failure is not a dead end — the rules engine writes the
        // same shape. The page says which engine produced what it is showing.
        return res.json({ ...built.variants[0], ...base, ai_available: true, ai_error: aiErr.message });
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

      const signature = await mailboxSignature(mailbox, req.user.id);
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
