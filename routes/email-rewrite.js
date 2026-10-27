// ============================================================================
// "REWRITE WITH AI" ON ONE WAITING FIRST EMAIL (R-319, owner's 28 notes)
// ----------------------------------------------------------------------------
// A lead with several people gets the same template text for each. The person can ask for ONE of them to be written for that
// person (their job title, the posting) — the same writer and the same house checker the send loop uses (`aiDraftFirstEmail`,
// injected from index.js), so nothing here is trusted that the send would not trust.
//
//   POST /emails/:id/rewrite-ai              { }                  → { ai, written, email, previous } | { ai, written:false, reason }
//   POST /emails/:id/rewrite-ai              { restore: previous } → { email, restored:true }   (Undo)
//
// Only the SENDER'S OWN email that is still waiting (404 otherwise: a manager reviews and prompts, never reaches in — D-0020), and
// only a lead's FIRST email. No AI today, no allowance left, or a draft that breaks a house rule: the wording stays exactly as it
// was and the answer says why, in words — never an error. Every write is conditional on status 'pending', so a send that has just
// claimed the row is never overwritten.
// ============================================================================
const express = require('express');
const engineDraft = require('../services/engine-draft');
const senderCompany = require('../services/sender-company');
const { renderStoredEmail } = require('../email-vars');
const { resolveSignatureHtml } = require('../email-signature');

const REWRITE_WHY = {
  ai_unavailable: 'The AI did not answer just now (it may be switched off, or today\'s allowance is used up), so your wording was kept.',
  ai_unparseable: 'The AI\'s answer could not be read, so your wording was kept. Try once more.',
  draft_rejected: 'The AI\'s draft broke one of the house rules (for example, it stated something it was not told), so your wording was kept. Try once more.',
  missing_contact_or_company: 'This email has no contact or company to write about, so your wording was kept.',
};
module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, db, auth, hasRole, loadMailboxSignatures, aiDraftFirstEmail } = ctx;
  const aiProvider = ctx.aiProvider || require('../services/ai-provider');   // injectable so a test decides whether the AI is available

  router.post('/emails/:id/rewrite-ai', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin', 'ra_lead', 'bd', 'bd_lead')) return res.status(403).json({ error: 'Not allowed' });
      const { data: email, error: eErr } = await db.forRequest(req).from('emails')
        .select('id,org_id,status,subject,body,job_id,contact_id,sent_by,from_email,to_email,followup_type,template_variant,sending_email_id,job:jobs(sending_email_id,sending_email:user_emails!sending_email_id(id,email_address,display_name))')
        .eq('id', req.params.id).eq('sent_by', req.user.id).maybeSingle();
      if (eErr) throw eErr;
      if (!email) return res.status(404).json({ error: 'Email not found' });
      if (email.status !== 'pending') return res.status(409).json({ error: 'That email is no longer waiting to be sent, so it cannot be rewritten.' });
      if (!engineDraft.isFirstEmail(email)) return res.status(400).json({ error: 'Rewrite with AI is for a lead\'s first email. Edit a follow-up by hand.' });

      let sendingEmail = email.job && email.job.sending_email || null;
      if (email.sending_email_id) {
        const { data: pinned } = await supabase.from('user_emails').select('id,email_address,display_name').eq('id', email.sending_email_id).maybeSingle();
        if (pinned) sendingEmail = pinned;
      }
      const sendingForRender = senderCompany.withCompany(sendingEmail, await senderCompany.companiesFor(supabase, [sendingEmail && sendingEmail.id]));
      const answer = (row, extra) => res.json(Object.assign({ email: Object.assign({}, row, renderStoredEmail(row, sendingForRender)) }, extra || {}));

      // Undo: put back exactly what was there. Conditional on 'pending' so a send that has just claimed the row is never overwritten.
      const back = req.body && req.body.restore;
      if (back && typeof back === 'object') {
        const upd = { subject: String(back.subject == null ? '' : back.subject).slice(0, 998), body: String(back.body == null ? '' : back.body).slice(0, 200000), template_variant: back.template_variant || null };
        const { data: done, error: uErr } = await db.forRequest(req).from('emails').update(upd).eq('id', email.id).eq('sent_by', req.user.id).eq('status', 'pending').select('id,subject,body,template_variant').maybeSingle();
        if (uErr) throw uErr;
        if (!done) return res.status(409).json({ error: 'That email is no longer waiting to be sent, so it could not be restored.' });
        return answer(Object.assign({}, email, done), { restored: true });
      }

      const avail = await aiProvider.availability(supabase, { feature: 'engine_first_email', orgId: email.org_id });
      if (!avail.available) return res.json({ ai: false, written: false, reason: REWRITE_WHY.ai_unavailable });

      const mailboxId = sendingEmail && sendingEmail.id;
      const sigMap = mailboxId ? await loadMailboxSignatures([mailboxId], req.user.id) : {};
      const sigTemplate = resolveSignatureHtml(sigMap[mailboxId]);
      const { res: draft } = await aiDraftFirstEmail(email, sendingEmail, sigTemplate);
      if (!draft.body) return res.json({ ai: true, written: false, reason: REWRITE_WHY[draft.skipped] || REWRITE_WHY.ai_unparseable });

      const upd = { subject: draft.subject, body: draft.body, template_variant: 'ai' };
      const { data: done, error: uErr } = await db.forRequest(req).from('emails').update(upd).eq('id', email.id).eq('sent_by', req.user.id).eq('status', 'pending').select('id').maybeSingle();
      if (uErr) throw uErr;
      if (!done) return res.status(409).json({ error: 'That email just went out (or was removed), so it was not changed.' });
      answer(Object.assign({}, email, upd), { ai: true, written: true, repaired: !!draft.repaired, previous: { subject: email.subject, body: email.body, template_variant: email.template_variant || null } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
module.exports.REWRITE_WHY = REWRITE_WHY;
