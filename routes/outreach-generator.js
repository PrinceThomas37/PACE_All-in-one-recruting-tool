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
    withOrg, orgStamp, logActivity, wfEngine,
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

  // Why the AI did not write this one. complete() records the provider's own
  // sentence under ai_last_error; "the AI writer was unavailable" is not a
  // diagnosis anybody can act on.
  async function lastAiError(sb) {
    try {
      const { data } = await sb.from('app_settings').select('value').eq('key', 'ai_last_error').maybeSingle();
      const rec = data && JSON.parse(data.value);
      const f = rec && rec.feature === 'outreach_draft' && (rec.failures || [])[0];
      return f ? `${f.provider}/${f.model}: ${f.error}` : null;
    } catch (_) { return null; }   // a diagnosis is a bonus, never the reason a draft fails
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
        // Whether an AI writer is configured is the provider's question now, not
        // this file's. Two branches merged cleanly into a break here: #159
        // replaced the local aiConfigured() helper with services/ai-provider,
        // and #160 added a NEW call to the helper in this handler. Git had no
        // reason to see a conflict — the helper was deleted in one region and
        // called in another — so main shipped with the call and without the
        // function, and every load of the Compose tab got a 500.
        ai: await aiProvider.isAvailable(supabase),
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

      // ── DRAFTING ONE ANGLE ────────────────────────────────────────────
      // Four angles, written on demand: the one on screen now, and the others
      // when their chip is clicked (POST /outreach/generate-angle). Writing all
      // four up front costs four calls a Generate — about six generations
      // against the daily budget, after which every feature in the app silently
      // falls back to its rules. The picker is worth one call at a time.
      const draftAngle = async (angleId) => {
        const variant = built.variants.find(v => v.id === angleId) || built.variants[0];
        const forAi = {
          ...withSender,
          // The posting is PASTED, so its length is whatever a job page happened
          // to contain — the one genuinely uncapped input in the app. Trim it
          // here rather than letting the budget trim the whole payload, so the
          // fields after it (the regeneration adjustment especially) survive.
          // The rules engine still reads the full text; only the AI's copy is cut.
          job_description: aiProvider.budget.trimToTokens(withSender.job_description, 2200),
          // Show the model how this team writes instead of describing it — and
          // show it THIS angle's rules draft, so the reference matches the brief.
          style_reference: variant && variant.email,
        };
        const angle = gen.angleBrief(variant && variant.id) ? variant.id : null;
        const system = gen.buildSystemPrompt(companyName, { omitSignOff: draftOpts.omitSignOff, angle });
        const askAi = (prompt) => aiProvider.complete(supabase, {
          model: AI_MODEL || undefined,
          maxTokens: 1000, feature: 'outreach_draft', orgId: req.orgId,
          system, prompt,
        });

        const out = await askAi(gen.buildUserPayload(forAi));
        if (!out) throw new Error('ai_unavailable');
        let parsed = gen.parseAiDraft(out.text);
        if (!parsed) throw new Error('ai_unparseable');

        // A PROMPT RULE IS A REQUEST; A CHECK IS A GUARANTEE. The model is told
        // the house rules and then held to the ones a machine can actually
        // verify — a stated fee percentage, a "quick call?" ask, a leftover
        // {{placeholder}}, a second sign-off above the signature, this angle's
        // own length, and never naming the reader's job back at them. One
        // repair turn, then the rules draft wins. Never ship a draft that broke
        // a rule just because an AI wrote it.
        const checkOpts = { omitSignOff: draftOpts.omitSignOff, angle };
        let check = gen.checkDraft(parsed, withSender, checkOpts);
        let repaired = false;
        if (!check.ok) {
          const fix = await askAi(gen.buildRepairPrompt(parsed, check.violations));
          const fixed = fix && gen.parseAiDraft(fix.text);
          if (fixed) {
            const recheck = gen.checkDraft(fixed, withSender, checkOpts);
            // Take the repair when it is genuinely better, not merely different.
            if (recheck.violations.length < check.violations.length) {
              parsed = fixed; check = recheck; repaired = true;
            }
          }
        }
        const usage = out.usage || {};
        return { parsed, check, repaired, out, usage, variant };
      };
      try {
        const first = built.variants[0];
        const r = await draftAngle(first.id);
        if (!r.check.ok) {
          // It still breaks a rule we can name. The rules draft is on screen
          // instead, and the page says exactly which rule and why.
          return res.json({
            ...first, ...base, ai_available: true,
            ai_error: 'draft_rejected',
            quality: { ok: false, repaired: r.repaired, violations: r.check.violations },
          });
        }
        // The AI rewrites the angle you are looking at; the other three keep
        // their rules text until you click them.
        const variants = built.variants.map(v => v.id === first.id
          ? { ...v, subject: r.parsed.subject, diagnosis: r.parsed.diagnosis, email: r.parsed.email,
              words: gen.wordCount(r.parsed.email), mode: 'ai' }
          : v);
        return res.json({
          ...r.parsed, mode: 'ai', ai_available: true, ...base, variants,
          engine: r.out.provider, engine_model: r.out.model,
          quality: { ok: true, repaired: r.repaired, violations: [] },
          usage: { input_tokens: r.usage.input_tokens || 0, output_tokens: r.usage.output_tokens || 0 }
        });
      } catch (aiErr) {
        // A drafting failure is not a dead end — the rules engine writes the
        // same shape. But "the AI writer was unavailable" is not a diagnosis:
        // from outside, a missing model, a spent free tier and a timeout look
        // identical. complete() already recorded WHY under ai_last_error, so
        // read it back and put the provider's own sentence on the page.
        return res.json({ ...built.variants[0], ...base, ai_available: true,
          ai_error: aiErr.message, ai_error_detail: await lastAiError(supabase) });
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── ONE MORE ANGLE, ON DEMAND ───────────────────────────────────────────
  // Same inputs, same checks, one angle. Called when a chip that still holds
  // its rules text is clicked.
  router.post('/outreach/generate-angle', auth, async (req, res) => {
    try {
      const input = req.body || {};
      const angleId = String(input.angle || '').trim();
      if (!gen.angleBrief(angleId)) return res.status(400).json({ error: 'Unknown angle.' });
      const check = gen.validateInput(input);
      if (!check.ok) return res.status(400).json({ error: 'Fill in: ' + check.missing.join(', ') + '.' });
      if (!(await aiProvider.isAvailable(supabase))) return res.status(409).json({ error: 'ai_unavailable' });

      const [companyName, mailbox] = await Promise.all([
        orgCompanyName(req), recruiterSendingMailbox(req.user.id)
      ]);
      const identity = await senderIdentity(req, mailbox);
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
      const built = gen.rulesVariants(withSender, draftOpts);
      const variant = built.variants.find(v => v.id === angleId);
      if (!variant) return res.status(400).json({ error: 'That angle does not apply to this email.' });

      const forAi = {
        ...withSender,
        job_description: aiProvider.budget.trimToTokens(withSender.job_description, 2200),
        style_reference: variant.email,
      };
      const system = gen.buildSystemPrompt(companyName, { omitSignOff: draftOpts.omitSignOff, angle: angleId });
      const askAi = (prompt) => aiProvider.complete(supabase, {
        model: AI_MODEL || undefined,
        maxTokens: 1000, feature: 'outreach_draft', orgId: req.orgId, system, prompt,
      });

      const out = await askAi(gen.buildUserPayload(forAi));
      if (!out) return res.json({ ...variant, mode: 'rules', ai_error: 'ai_unavailable', ai_error_detail: await lastAiError(supabase) });
      let parsed = gen.parseAiDraft(out.text);
      if (!parsed) return res.json({ ...variant, mode: 'rules', ai_error: 'ai_unparseable' });

      const checkOpts = { omitSignOff: draftOpts.omitSignOff, angle: angleId };
      let q = gen.checkDraft(parsed, withSender, checkOpts);
      let repaired = false;
      if (!q.ok) {
        const fix = await askAi(gen.buildRepairPrompt(parsed, q.violations));
        const fixed = fix && gen.parseAiDraft(fix.text);
        if (fixed) {
          const recheck = gen.checkDraft(fixed, withSender, checkOpts);
          if (recheck.violations.length < q.violations.length) { parsed = fixed; q = recheck; repaired = true; }
        }
      }
      if (!q.ok) {
        return res.json({ ...variant, mode: 'rules', ai_error: 'draft_rejected',
          quality: { ok: false, repaired, violations: q.violations } });
      }
      res.json({
        id: variant.id, label: variant.label, blurb: variant.blurb,
        subject: parsed.subject, diagnosis: parsed.diagnosis, email: parsed.email,
        words: gen.wordCount(parsed.email), mode: 'ai',
        engine: out.provider, engine_model: out.model,
        quality: { ok: true, repaired, violations: [] }
      });
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
  // ── ONE OUTREACH BECOMES A LEAD ─────────────────────────────────────────
  // Shared by the "they replied" conversion and by sending with a sequence
  // attached. Returns { job_id, company_id, existing } — `existing` when the
  // address is already somebody's lead, because silently creating a duplicate
  // of a lead a colleague is working is worse than doing nothing.
  //
  // STAGE IS NOT A FREE CHOICE. `Connected` means THEY REPLIED — it drives the
  // funnel, the reports and the 30-day recycler. A lead created because we sent
  // an email is `Assigned`.
  async function createLeadFromOutreach(req, b, stage) {
    const toEmail = String(b.email || '').trim().toLowerCase();
    if (!toEmail) return { error: 'No recipient address on that send.' };

    const { data: existing } = await withOrg(supabase.from('contacts')
      .select('id,job_id').ilike('email', toEmail).limit(1), req);
    if (existing && existing.length && existing[0].job_id) {
      return { job_id: existing[0].job_id, contact_id: existing[0].id, existing: true };
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
      position: String(b.position || b.subject || 'Outreach').slice(0, 200),
      location: String(b.location || '') || null,
      source: 'Outreach generator',
      stage,
      notes: String(b.notes || ''),
      created_by: req.user.id,
      assigned_to: req.user.id,
      created_date: new Date().toISOString().split('T')[0]
    }, org)).select('id').single();
    if (jErr) throw jErr;

    const name = String(b.name || '').trim();
    const contactRow = Object.assign({
      job_id: job.id,
      first_name: name.split(/\s+/)[0] || '',
      last_name: name.split(/\s+/).slice(1).join(' ') || '',
      designation: String(b.title || '') || null,
      email: toEmail,
      is_primary: true,
    }, org);
    if (b.replied) contactRow.replied_at = new Date();
    if (b.emailed) contactRow.email_sent_at = today();
    const { data: contact } = await supabase.from('contacts').insert(contactRow).select('id').single();

    return { job_id: job.id, company_id: companyId, contact_id: contact && contact.id, existing: false };
  }

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

      // They replied, so this one is Connected — that is exactly what the stage
      // means, and it is the only path that may set it.
      const made = await createLeadFromOutreach(req, {
        email: toEmail, company: b.company, location: b.location,
        position: b.position || (trk && trk.subject), name: b.name, title: b.title,
        notes: b.notes || 'Created from a reply to a generated outreach email.',
        replied: true,
      }, 'Connected');
      if (made.error) return res.status(400).json({ error: made.error });
      if (made.existing) {
        if (trk) await supabase.from('email_tracking').update({ lead_id: made.job_id }).eq('id', trk.id);
        return res.status(409).json({ error: 'contact_exists', job_id: made.job_id });
      }

      if (trk) await supabase.from('email_tracking').update({ lead_id: made.job_id }).eq('id', trk.id);
      try {
        if (logActivity) await logActivity(made.job_id, null, req.user.id, 'lead_created',
          `Converted from an outreach reply (${toEmail})`);
      } catch (_) { /* audit is best-effort */ }

      res.status(201).json({ job_id: made.job_id, company_id: made.company_id });
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

      // ── ADD IT TO A SEQUENCE ────────────────────────────────────────────
      // The email that just went out is the FIRST outreach for a lead — the same
      // shape the send loop produces when a lead is assigned. Choosing a
      // sequence is what makes that official: it creates the company, the lead
      // and the contact, and enrolls them so the follow-ups run on their own.
      // Sending WITHOUT choosing a sequence deliberately creates nothing, so a
      // one-off draft does not land in somebody's pipeline.
      //
      // The enrollment starts AFTER step 1. This email is step 1; a sequence
      // whose first step is `email(+0 days)` would otherwise be due today and
      // send the same person a second email on the next tick.
      let sequence = null;
      const sequenceId = String(b.sequence_id || '').trim();
      if (sequenceId) {
        try {
          const made = await createLeadFromOutreach(req, {
            email: to, company: b.company, location: b.location,
            position: b.position || b.job_title || subject, name: b.name, title: b.title,
            notes: 'Created from the outreach generator when the first email was sent.',
            emailed: true,
          }, 'Assigned');
          if (made.error) throw new Error(made.error);
          await supabase.from('email_tracking').update({ lead_id: made.job_id }).eq('token', token);

          const enrollment = await wfEngine.enroll({
            workflow_id: sequenceId,
            entity_type: 'contact',
            entity_id: made.contact_id,
            contact_id: made.contact_id,
            job_id: made.job_id,
            org_id: req.orgId || null,
            enrolled_by: req.user.id,
            start_after_step: 1,
            metadata: { from_mailbox_id: mailbox.id, from_mailbox_email: mailbox.email_address, source: 'outreach_generator' },
          });
          try {
            if (logActivity) await logActivity(made.job_id, made.contact_id, req.user.id, 'workflow_enrolled',
              'Outreach sent and added to a sequence (first step already sent)');
          } catch (_) { /* audit is best-effort */ }
          sequence = { job_id: made.job_id, contact_id: made.contact_id, enrollment_id: enrollment.id,
                       existing_lead: made.existing, next_due: enrollment.next_step_due_date };
        } catch (seqErr) {
          // THE EMAIL HAS ALREADY GONE. Failing the request now would tell the
          // user their send failed when it did not, and they would send again.
          sequence = { error: seqErr.message };
        }
      }

      res.json({ sent: true, mailbox: mailbox.email_address, sequence });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // The sequences this send can be added to: active definitions for contacts,
  // newest last. `first_step` is shown so it is obvious what happens next and
  // when — a picker that just lists names hides the only thing that matters.
  router.get('/outreach/sequences', auth, async (req, res) => {
    try {
      const { data } = await withOrg(supabase.from('workflow_definitions')
        .select('id,name,domain,entity_type,status,workflow_steps(step_order,name,channel,delay_days)')
        .eq('status', 'active').eq('entity_type', 'contact'), req);
      const rows = (data || []).map(d => {
        const steps = (d.workflow_steps || []).slice().sort((a, b) => a.step_order - b.step_order);
        const next = steps[1] || null;   // step 1 is the email we just sent
        return {
          id: d.id, name: d.name, domain: d.domain || null, steps: steps.length,
          next_step: next ? { name: next.name, channel: next.channel, delay_days: next.delay_days } : null,
          shape: steps.map(x => x.channel + (x.delay_days ? ' +' + x.delay_days + 'd' : '')).join(' → '),
        };
      }).filter(r => r.steps > 1);   // a one-step sequence has nothing left to run
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
