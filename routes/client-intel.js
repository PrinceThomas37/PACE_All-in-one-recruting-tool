'use strict';
// ============================================================================
// CLIENT INTELLIGENCE — the client page's Emails tab: every email to and from
// a client's contacts, the free facts, and the "Generate AI summary" button.
// Design: docs/CLIENT_INTEL_DESIGN.md. Owner decisions:
//   D-0039  build it, but OFF until the owner says; tokens and storage designed first
//   D-0040  the email text and the AI summary are the client OWNER's alone
//   D-0041  the AI allowance is per person per day
//   D-0042  a summary is made only when the button is pressed, capped per click
//   D-0043  the Emails tab is timeline + button; saved summaries feed the daily update
//
// Everything that DECIDES something lives in services/client-intel.js (pure).
// This file only reads the rows and writes the saved summary.
//
// OFF means off: with `client_intel_enabled` at 0 every endpoint answers
// { enabled:false } and reads nothing; with `client_intel_ai_enabled` at 0 the
// summary endpoint refuses before any AI call.
// ============================================================================

const express = require('express');
const ci = require('../services/client-intel');
const own = require('../services/ownership');
const aiProvider = require('../services/ai-provider');
const settingsConfig = require('../config/settings');
const { renderStoredEmail } = require('../email-vars');
const { createMailProvider } = require('../services/mail-provider');

// What the page may show when a person opens one email. The AI still sees at
// most ci.CAPS.RECENT_MSG_CHARS of it; this is only the reading view.
const FULL_TEXT_CHARS = 30000;

// Bounded reads: a client's timeline never pulls more than this per source.
// The fact sheet summarises everything we fetched; the AI sees ≤8 of it.
const PER_SOURCE_LIMIT = 500;
const TIMELINE_SHOWN = 200;

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, withOrg, orgStamp, graphMailRequest, getMicrosoftToken, gmailProvider } = ctx;
  const mail = createMailProvider({ graphMailRequest, getMicrosoftToken, gmailProvider });

  const on = async (key) => Number(await settingsConfig.getSetting(supabase, key)) === 1;

  // The same ladder as routes/companies.js clientOwnerId — the rule itself is
  // own.clientOwnerFrom (services/ownership.js); these are just its inputs.
  async function clientOwnerId(req, companyId) {
    const { data: co } = await withOrg(supabase.from('companies')
      .select('id,created_by').eq('id', companyId), req).maybeSingle();
    if (!co) return null;
    const { data: jos } = await withOrg(supabase.from('job_orders')
      .select('bd_manager_id,created_at,company_id,deleted_at').eq('company_id', companyId)
      .is('deleted_at', null).not('bd_manager_id', 'is', null)
      .order('created_at', { ascending: false }).limit(1), req);
    const { data: leads } = await withOrg(supabase.from('jobs')
      .select('assigned_to_bd,created_at,company_id,deleted_at').eq('company_id', companyId)
      .is('deleted_at', null).not('assigned_to_bd', 'is', null)
      .order('created_at', { ascending: false }).limit(1), req);
    return own.clientOwnerFrom({ company: co, jobOrders: jos || [], leads: leads || [] });
  }

  // D-0040: the OWNER reads the email text. Nobody else — not their manager.
  // A client nobody owns yet is readable by an admin, so it is never invisible.
  async function readAccess(req, companyId) {
    const { data: co } = await withOrg(supabase.from('companies')
      .select('id,name').eq('id', companyId).is('deleted_at', null), req).maybeSingle();
    if (!co) return { status: 404 };
    const ownerId = await clientOwnerId(req, companyId);
    if (ownerId && ownerId === req.user.id) return { status: 200, company: co, ownerId };
    if (!ownerId && hasRole(req, 'admin')) return { status: 200, company: co, ownerId: null };
    let ownerName = null;
    if (ownerId) {
      const { data: u } = await supabase.from('users').select('name').eq('id', ownerId).maybeSingle();
      ownerName = u && u.name;
    }
    return { status: 403, company: co, ownerName };
  }

  // Every email with this client, from the three places PACE keeps mail, as
  // one list in one shape. Read-only; nothing here sends.
  async function loadClientMessages(req, companyId) {
    const { data: leads } = await withOrg(supabase.from('jobs')
      .select('id').eq('company_id', companyId).is('deleted_at', null), req);
    const leadIds = (leads || []).map(l => l.id);
    let contacts = [];
    if (leadIds.length) {
      const { data } = await withOrg(supabase.from('contacts')
        .select('id,first_name,last_name,email,designation,job_id').in('job_id', leadIds), req);
      contacts = data || [];
    }
    const contactIds = contacts.map(c => c.id);
    const nameByEmail = {};
    contacts.forEach(c => { if (c.email) nameByEmail[ci.normEmail(c.email)] = ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || null; });

    // Inbound — filed to this client, or from one of its contacts (rows stored
    // before migration 048 carry no company_id yet).
    const inSel = 'id,from_email,to_email,subject,body,sent_at,direction,facts,contact_id,message_key';
    const inboundRows = [];
    const addIn = (rows) => (rows || []).forEach(r => { if (!inboundRows.some(x => x.id === r.id)) inboundRows.push(r); });
    try {
      const { data, error } = await withOrg(supabase.from('conversation_messages').select(inSel)
        .eq('company_id', companyId).order('sent_at', { ascending: false }).limit(PER_SOURCE_LIMIT), req);
      if (!error) addIn(data);
    } catch (_) { /* column not there before 048 */ }
    if (contactIds.length) {
      let { data, error } = await withOrg(supabase.from('conversation_messages').select(inSel)
        .in('contact_id', contactIds).order('sent_at', { ascending: false }).limit(PER_SOURCE_LIMIT), req);
      if (error && /facts/.test(error.message || '')) {
        ({ data } = await withOrg(supabase.from('conversation_messages')
          .select('id,from_email,to_email,subject,body,sent_at,direction,contact_id,message_key')
          .in('contact_id', contactIds).order('sent_at', { ascending: false }).limit(PER_SOURCE_LIMIT), req));
      }
      addIn(data);
    }

    // Outbound, leads engine — stored with {{sender}} unrendered, so every body
    // is rendered from the mailbox that sent it (CLAUDE.md: every reader of a
    // stored body calls renderStoredEmail).
    let sentRows = [];
    if (contactIds.length) {
      const { data } = await withOrg(supabase.from('emails')
        .select('id,to_email,subject,body,sent_at,status,sending_email_id,from_email,contact_id')
        .in('contact_id', contactIds).eq('status', 'sent')
        .order('sent_at', { ascending: false }).limit(PER_SOURCE_LIMIT), req);
      sentRows = data || [];
    }
    const mbIds = [...new Set(sentRows.map(r => r.sending_email_id).filter(Boolean))];
    const mailboxes = {};
    if (mbIds.length) {
      const { data } = await supabase.from('user_emails').select('id,email_address,display_name').in('id', mbIds);
      (data || []).forEach(m => { mailboxes[m.id] = m; });
    }
    // Outbound, one-off client emails sent from the client page.
    const { data: tracked } = await withOrg(supabase.from('email_tracking')
      .select('id,to_email,subject,body,sent_at,mailbox_email')
      .eq('company_id', companyId).order('sent_at', { ascending: false }).limit(PER_SOURCE_LIMIT), req);

    const toText = (html) => ci.trimStoredText(String(html || ''));
    // Our OWN sent emails are kept in full already, so the reading view shows
    // all of it (the owner asked, 2026-09-25). Only the AI's copy is trimmed.
    const fullText = (html) => ci.fullEmailText(html, FULL_TEXT_CHARS);
    const messages = [];
    inboundRows.forEach(r => messages.push({
      id: 'in:' + r.id, source: 'reply', direction: r.direction || 'inbound', sent_at: r.sent_at,
      from: r.from_email, to: r.to_email, subject: r.subject, text: r.body || '',
      facts: r.facts || ci.factsForMessage(r.body || '', r.sent_at),
      person: nameByEmail[ci.normEmail(r.from_email)] || null,
      // A reply is stored trimmed; its full original can be fetched from the
      // mailbox that received it, on request, and is never stored.
      can_open_full: !!r.message_key,
    }));
    sentRows.forEach(r => {
      if (!r.sent_at) return;
      const rendered = renderStoredEmail(r, mailboxes[r.sending_email_id] || null);
      messages.push({
        id: 'out:' + r.id, source: 'outreach', direction: 'outbound', sent_at: r.sent_at,
        from: (mailboxes[r.sending_email_id] || {}).email_address || r.from_email, to: r.to_email,
        subject: rendered.subject, text: toText(rendered.body), full: fullText(rendered.body), facts: null, person: null,
      });
    });
    (tracked || []).forEach(r => {
      if (!r.sent_at) return;
      messages.push({
        id: 'trk:' + r.id, source: 'client_email', direction: 'outbound', sent_at: r.sent_at,
        from: r.mailbox_email, to: r.to_email, subject: r.subject, text: toText(r.body), full: fullText(r.body), facts: null, person: null,
      });
    });
    messages.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
    return { messages, contacts };
  }

  async function savedSummary(req, companyId) {
    try {
      const { data, error } = await withOrg(supabase.from('client_summaries')
        .select('summary,next_steps,engine,model,covers_until,message_count,tokens_used,forced_at,updated_at,created_by')
        .eq('company_id', companyId), req).maybeSingle();
      if (error) return null;
      return data || null;
    } catch (_) { return null; }
  }

  // Per person, per day — D-0041. A meter in app_settings, like the AI budget:
  // no migration, expires by never being read again.
  const usageKey = (userId) => `cis_used_${userId}_${new Date().toISOString().slice(0, 10)}`;
  async function usedToday(userId) {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', usageKey(userId)).maybeSingle();
      return data ? Number(data.value) || 0 : 0;
    } catch (_) { return 0; }
  }
  async function countUse(userId) {
    try {
      const n = (await usedToday(userId)) + 1;
      await supabase.from('app_settings').upsert({ key: usageKey(userId), value: String(n), updated_at: new Date() }, { onConflict: 'key' });
    } catch (_) { /* a meter is not worth an outage */ }
  }

  // ── GET the Emails tab ────────────────────────────────────────────────────
  router.get('/clients/:id/intel', auth, async (req, res) => {
    try {
      if (!(await on('client_intel_enabled'))) return res.json({ enabled: false });
      const acc = await readAccess(req, req.params.id);
      if (acc.status === 404) return res.status(404).json({ error: 'Not found' });
      if (acc.status === 403) {
        // Not an error the page shows as one: it says whose client this is.
        return res.json({ enabled: true, owner: false, owner_name: acc.ownerName || null });
      }
      const { messages } = await loadClientMessages(req, req.params.id);
      const ledger = ci.buildLedger(messages);
      const saved = await savedSummary(req, req.params.id);
      const status = ci.summaryStatus(saved, messages);
      const aiOn = await on('client_intel_ai_enabled');
      const limit = Number(await settingsConfig.getSetting(supabase, 'client_intel_ai_per_user_daily'));
      const used = aiOn ? await usedToday(req.user.id) : 0;
      const pb = ci.playbookFor('recruiting');
      res.json({
        enabled: true, owner: true,
        client: { id: acc.company.id, name: acc.company.name },
        facts: ci.rulesSummary(ledger, pb),
        ledger,
        summary: saved ? Object.assign({}, saved, { next_steps: ci.labelSteps(saved.next_steps, pb) }) : null,
        status,
        ai: { enabled: aiOn, per_user_limit: limit, used_today: used, left_today: Math.max(0, limit - used) },
        timeline: messages.slice(0, TIMELINE_SHOWN).map(m => ({
          id: m.id, source: m.source, direction: m.direction, sent_at: m.sent_at,
          from: m.from, to: m.to, person: m.person, subject: m.subject, text: m.full || m.text,
          can_open_full: !!m.can_open_full,
          intent: m.facts && m.facts.intent || null,
        })),
        total_messages: messages.length,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── One reply, in full, fetched live from the mailbox (never stored) ──────
  // The owner asked for it (2026-09-25). Same doors as the tab — switched on,
  // the client's owner — plus two more: the email must belong to THIS client,
  // and the mailbox it arrived in must be the viewer's own (the in-app Inbox
  // rule: your own mailboxes only). Returned as plain text, so nothing from
  // the sender's HTML ever runs on the page.
  router.get('/clients/:id/intel/messages/:mid/full', auth, async (req, res) => {
    try {
      if (!(await on('client_intel_enabled'))) return res.status(404).json({ error: 'Not found' });
      const acc = await readAccess(req, req.params.id);
      if (acc.status !== 200) return res.status(acc.status === 404 ? 404 : 403).json({ error: 'Only the client\'s owner can read its emails.' });
      const rowId = String(req.params.mid || '').replace(/^in:/, '');
      const { data: row } = await withOrg(supabase.from('conversation_messages')
        .select('id,company_id,contact_id,to_email,message_key,provider,subject,sent_at').eq('id', rowId), req).maybeSingle();
      if (!row || !row.message_key) return res.status(404).json({ error: 'Not found' });
      let belongs = row.company_id === req.params.id;
      if (!belongs && row.contact_id) {
        const { data: ct } = await withOrg(supabase.from('contacts').select('job_id').eq('id', row.contact_id), req).maybeSingle();
        if (ct && ct.job_id) {
          const { data: j } = await withOrg(supabase.from('jobs').select('company_id').eq('id', ct.job_id), req).maybeSingle();
          belongs = !!(j && j.company_id === req.params.id);
        }
      }
      if (!belongs) return res.status(404).json({ error: 'Not found' });
      const { data: mbs } = await supabase.from('user_emails')
        .select('id,user_id,email_address,display_name,platform,is_active')
        .eq('user_id', req.user.id).ilike('email_address', String(row.to_email || ''));
      const mb = (mbs || []).find(m => m.is_active !== false);
      if (!mb) {
        return res.status(409).json({ code: 'not_your_mailbox', mailbox: row.to_email || null,
          error: 'This reply arrived in ' + (row.to_email || 'another mailbox') + ', which is not one of yours, so it cannot be opened from here.' });
      }
      let msg;
      try { msg = await mail.forMailbox(mb).getMessage(row.message_key, { blockRemoteImages: true }); }
      catch (e) {
        const m = String(e && e.message || '');
        if (/404|not ?found|ErrorItemNotFound/i.test(m)) return res.status(410).json({ code: 'gone', error: 'This email is no longer in the mailbox (it may have been deleted).' });
        return res.status(409).json({ code: 'mailbox_error', error: 'The mailbox could not be reached — it may need reconnecting.' });
      }
      res.json({
        subject: msg.subject || row.subject || '', date: msg.date || row.sent_at,
        from: msg.from || null,
        text: ci.fullEmailText(msg.body_html || '', FULL_TEXT_CHARS),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── POST the button ───────────────────────────────────────────────────────
  router.post('/clients/:id/summary', auth, async (req, res) => {
    try {
      if (!(await on('client_intel_enabled')) || !(await on('client_intel_ai_enabled'))) {
        return res.status(409).json({ error: 'AI client summaries are switched off.', code: 'switched_off' });
      }
      const acc = await readAccess(req, req.params.id);
      if (acc.status === 404) return res.status(404).json({ error: 'Not found' });
      if (acc.status === 403) {
        return res.status(403).json({ error: acc.ownerName
          ? `This client belongs to ${acc.ownerName}. Only the owner can summarise its emails.`
          : 'Only the client\'s owner can summarise its emails.' });
      }
      const force = !!(req.body && req.body.force);
      const { messages } = await loadClientMessages(req, req.params.id);
      const saved = await savedSummary(req, req.params.id);
      const status = ci.summaryStatus(saved, messages);
      const pb = ci.playbookFor('recruiting');
      const limit = Number(await settingsConfig.getSetting(supabase, 'client_intel_ai_per_user_daily'));
      const used = await usedToday(req.user.id);
      const gate = ci.canGenerate({ status, usedToday: used, perUserLimit: limit, lastForcedAt: saved && saved.forced_at, force });
      if (!gate.allowed) {
        // up_to_date is an answer, not a failure: the saved summary, 0 tokens.
        if (gate.reason === 'up_to_date' && saved) {
          return res.json({ reused: true, tokens: 0, summary: Object.assign({}, saved, { next_steps: ci.labelSteps(saved.next_steps, pb) }), status });
        }
        return res.status(409).json({ error: gate.reason, code: gate.reason, used_today: used, per_user_limit: limit });
      }

      const ledger = ci.buildLedger(messages);
      const request = ci.buildSummaryRequest({ playbook: pb, clientName: acc.company.name, ledger, messages, saved });
      const availability = await aiProvider.availability(supabase, { feature: 'client_summary', orgId: req.orgId });
      if (!availability.available) {
        // 'ai_' prefixed so it cannot be confused with the PERSON's own daily
        // allowance ('daily_limit') — two different limits, two sentences.
        return res.status(409).json({ error: 'ai_' + availability.reason, code: 'ai_' + availability.reason, facts: ci.rulesSummary(ledger, pb) });
      }
      const out = await aiProvider.complete(supabase, {
        system: request.system, prompt: request.prompt, maxTokens: 450,
        feature: 'client_summary', orgId: req.orgId,
      });
      if (!out || !out.text) {
        return res.status(409).json({ error: 'no_answer', code: 'no_answer', facts: ci.rulesSummary(ledger, pb) });
      }
      // The call happened, so it counts against this person's allowance
      // whether or not the answer survives the check.
      await countUse(req.user.id);
      const tokens = (out.usage && (out.usage.total_tokens || ((out.usage.input_tokens || out.usage.prompt_tokens || 0) + (out.usage.output_tokens || out.usage.completion_tokens || 0)))) || request.estimated_tokens;
      const parsed = ci.parseSummary(out.text);
      const check = ci.checkSummary(parsed, { sourceText: request.system + '\n' + request.prompt, playbook: pb });
      if (!check.ok) {
        // CHECKED, NOT TRUSTED: a summary that invented something is thrown
        // away and the free one shown. Nothing is saved.
        return res.json({ rejected: true, violations: check.violations, tokens, facts: ci.rulesSummary(ledger, pb) });
      }
      const row = Object.assign({
        company_id: req.params.id,
        summary: parsed.summary.slice(0, ci.CAPS.SUMMARY_MAX_CHARS),
        next_steps: parsed.next_steps.slice(0, ci.CAPS.MAX_NEXT_STEPS),
        engine: 'ai', model: out.model || null,
        covers_until: ci.coversUntil(messages), message_count: messages.length,
        tokens_used: tokens, forced_at: force ? new Date().toISOString() : (saved && saved.forced_at) || null,
        created_by: req.user.id, updated_at: new Date().toISOString(),
      }, orgStamp(req));
      const { error } = await supabase.from('client_summaries').upsert(row, { onConflict: 'company_id' });
      if (error) {
        // A summary we could not save is still shown — once — and said so.
        return res.json({ saved: false, save_error: error.message, tokens,
          summary: Object.assign({}, row, { next_steps: ci.labelSteps(row.next_steps, pb) }) });
      }
      res.json({ saved: true, tokens, used_messages: request.used_messages,
        summary: Object.assign({}, row, { next_steps: ci.labelSteps(row.next_steps, pb) }),
        status: { state: 'up_to_date', new_count: 0 } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
