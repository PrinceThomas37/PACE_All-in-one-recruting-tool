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
const { fillSignatureHtml } = require('../email-signature');
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
    withOrg, orgStamp, logActivity,
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

      if (!aiConfigured()) {
        return res.json({ ...built.variants[0], ...base, ai_available: false });
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
            system: gen.buildSystemPrompt(companyName, { omitSignOff: draftOpts.omitSignOff }),
            messages: [{ role: 'user', content: gen.buildUserPayload(withSender) }]
          })
        }, { timeoutMs: AI_TIMEOUT_MS });
        if (!response.ok) throw new Error('ai_http_' + response.status);
        const data = await response.json();
        const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        const parsed = gen.parseAiDraft(text);
        if (!parsed) throw new Error('ai_unparseable');
        const usage = data.usage || {};
        // The AI writes one email; the rules writer's framings stay alongside it
        // so the choice is never lost when a key is configured.
        return res.json({
          ...parsed, mode: 'ai', ai_available: true, ...base,
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

  // ── WHO THIS IS GOING TO ────────────────────────────────────────────────
  // The composer takes a recipient two ways: someone already in the database,
  // or someone typed in from scratch. This is the first. Contacts and companies
  // are searched together because a person looking for "Berks" does not know or
  // care which table the answer is in.
  router.get('/outreach/recipients', auth, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return res.json({ contacts: [], companies: [] });
      const like = `%${q}%`;
      const [contacts, companies] = await Promise.all([
        withOrg(supabase.from('contacts')
          .select('id,first_name,last_name,email,designation,job_id,jobs(position,company_id,companies(name))')
          .or(`email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`)
          .not('email', 'is', null).limit(8), req),
        withOrg(supabase.from('companies')
          .select('id,name,industry,location').ilike('name', like).is('deleted_at', null).limit(6), req),
      ]);
      res.json({
        contacts: (contacts.data || []).map(c => ({
          id: c.id, email: c.email,
          name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim(),
          title: c.designation || '',
          company: (c.jobs && c.jobs.companies && c.jobs.companies.name) || '',
          position: (c.jobs && c.jobs.position) || '',
          job_id: c.job_id || null,
        })),
        companies: (companies.data || []).map(co => ({
          id: co.id, name: co.name, industry: co.industry || '', location: co.location || ''
        })),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Contacts on one company, so picking a company then a person is two clicks
  // rather than a second search.
  router.get('/outreach/company-contacts/:id', auth, async (req, res) => {
    try {
      const { data: rows } = await withOrg(supabase.from('contacts')
        .select('id,first_name,last_name,email,designation,job_id,jobs!inner(position,company_id)')
        .eq('jobs.company_id', req.params.id).not('email', 'is', null).limit(25), req);
      res.json((rows || []).map(c => ({
        id: c.id, email: c.email,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim(),
        title: c.designation || '', position: (c.jobs && c.jobs.position) || '', job_id: c.job_id || null
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── WHAT HAPPENED TO WHAT YOU SENT ──────────────────────────────────────
  // Generator sends are not attached to a lead, by design for now — so this is
  // the only place they can be seen. Opens and replies come from the tracking
  // row the send writes; the reply timestamp is stamped by the same 30-minute
  // inbox sweep that watches every other tracked send.
  router.get('/outreach/sent', auth, async (req, res) => {
    try {
      const { data } = await withOrg(supabase.from('email_tracking')
        .select('token,to_email,subject,sent_at,opened_at,open_count,replied_at,lead_id')
        .eq('channel', 'outreach').eq('sent_by', req.user.id)
        .order('sent_at', { ascending: false }).limit(40), req);
      res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── A REPLY BECOMES A LEAD ──────────────────────────────────────────────
  // Someone who wrote back is, by definition, a live conversation — and until
  // it is a lead it is invisible to the pipeline, the follow-up engine, the
  // "needs you today" queue and every report. This is the one action that moves
  // it across, and it is deliberately a DECISION rather than something the send
  // path does on its own: not every reply is worth tracking as a lead.
  //
  // Nothing here needs a migration — email_tracking has carried an unused
  // lead_id column since 024, which is exactly what it was for.
  router.post('/outreach/convert-lead', auth, async (req, res) => {
    try {
      const b = req.body || {};
      const token = String(b.token || '').trim();
      const email = String(b.email || '').trim().toLowerCase();
      if (!token && !email) return res.status(400).json({ error: 'token or email required' });

      let trk = null;
      if (token) {
        const { data } = await withOrg(supabase.from('email_tracking')
          .select('id,token,to_email,subject,lead_id').eq('token', token), req).maybeSingle();
        if (!data) return res.status(404).json({ error: 'Not found' });
        if (data.lead_id) return res.status(409).json({ error: 'already_converted', job_id: data.lead_id });
        trk = data;
      }
      const toEmail = (trk && trk.to_email) || email;
      if (!toEmail) return res.status(400).json({ error: 'No recipient address on that send.' });

      // Already in the database? Then this is not a new lead, and saying so
      // beats silently creating a duplicate of a lead somebody is working.
      const { data: existing } = await withOrg(supabase.from('contacts')
        .select('id,job_id').ilike('email', toEmail).limit(1), req);
      if (existing && existing.length && existing[0].job_id) {
        if (trk) await supabase.from('email_tracking').update({ lead_id: existing[0].job_id }).eq('id', trk.id);
        return res.status(409).json({ error: 'contact_exists', job_id: existing[0].job_id });
      }

      const org = orgStamp(req);
      const companyName = String(b.company || '').trim();
      let companyId = null;
      if (companyName) {
        const { data: found } = await withOrg(supabase.from('companies')
          .select('id').ilike('name', companyName).limit(1), req);
        companyId = (found && found[0] && found[0].id) || null;
        if (!companyId) {
          const { data: made, error: cErr } = await supabase.from('companies').insert(Object.assign({
            name: companyName, location: String(b.location || '') || null, created_by: req.user.id
          }, org)).select('id').single();
          if (cErr) throw cErr;
          companyId = made.id;
        }
      }

      const { data: job, error: jErr } = await supabase.from('jobs').insert(Object.assign({
        company_id: companyId,
        position: String(b.position || b.subject || 'Outreach reply').slice(0, 200),
        location: String(b.location || '') || null,
        source: 'Outreach generator',
        stage: 'Connected',          // they replied — that is what Connected means
        notes: String(b.notes || 'Created from a reply to a generated outreach email.'),
        created_by: req.user.id,
        assigned_to: req.user.id,
        created_date: new Date().toISOString().split('T')[0]
      }, org)).select('id').single();
      if (jErr) throw jErr;

      const name = String(b.name || '').trim();
      await supabase.from('contacts').insert(Object.assign({
        job_id: job.id,
        first_name: name.split(/\s+/)[0] || '',
        last_name: name.split(/\s+/).slice(1).join(' ') || '',
        designation: String(b.title || '') || null,
        email: toEmail,
        is_primary: true,
        replied_at: new Date()
      }, org));

      if (trk) await supabase.from('email_tracking').update({ lead_id: job.id }).eq('id', trk.id);
      try {
        if (logActivity) await logActivity(job.id, null, req.user.id, 'lead_created',
          `Converted from an outreach reply (${toEmail})`);
      } catch (_) { /* audit is best-effort */ }

      res.status(201).json({ job_id: job.id, company_id: companyId });
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
