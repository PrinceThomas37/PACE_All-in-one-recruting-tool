// ============================================================================
// AI GENERATION — cold-email drafting + daily import summary.
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/ai')(ctx));
//
// The provider is NOT chosen here. Both handlers ask services/ai-provider for
// text and fall back to the same template/placeholder output they always had
// when it returns null — which is what an unconfigured deployment, a spent
// free tier and an unreachable local model all look like from in here.
// ============================================================================
const express = require('express');
const ai = require('../services/ai-provider');
const briefing = require('../services/morning-briefing');

module.exports = (ctx) => {
  const router = express.Router();
  const { auth, hasRole, supabase, withOrg, today } = ctx;

router.post('/ai/generate-email', auth, async (req, res) => {
  try {
    const { lead, contact, company, template } = req.body;
    const c = contact || lead || {};
    const vars = { fn: c.first_name, ln: c.last_name, company: company?.name, ind: company?.industry, pos: c.position || req.body.position, desig: c.designation, loc: company?.location, sender: req.user.name };
    const fill = (s) => (s || '').replace(/{{(\w+)}}/g, (m, k) => vars[k] || m);
    const fallback = () => res.json({ subject: fill(template?.subject || 'Opportunity at {{company}}'), body: fill(template?.body || 'Hi {{fn}},') });
    const prompt = `Write a hyper-personalized cold outreach email for a business development executive at Fute Global LLC.\nContact: ${vars.fn} ${vars.ln || ''}, ${vars.desig || ''} at ${vars.company} (${vars.ind || ''}, ${vars.loc || ''})\nPosition: ${vars.pos || ''}\nFormat:\nSubject: [subject line]\n\n[email body]`;
    const out = await ai.complete(supabase, { prompt, maxTokens: 600, feature: 'cold_email', orgId: req.orgId });
    if (!out) return fallback();
    const text = out.text || '';
    const subjectMatch = text.match(/Subject:\s*(.+)/i);
    res.json({ subject: subjectMatch ? subjectMatch[1].trim() : `Opportunity at ${vars.company}`, body: text.replace(/^Subject:.+\n*/im, '').trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── THE MORNING BRIEFING ────────────────────────────────────────────────────
// One or two sentences saying what actually came in today, for the top of the
// dashboard. The words are written by services/morning-briefing.js (PURE); this
// handler's only job is to go and count things.
//
// IT ALWAYS ANSWERS, AND IT ALWAYS ANSWERS IN SENTENCES. There is no funded AI
// key, so the rules writer is what ships: `complete()` returning null is the
// normal case, not a failure, and it must never produce an apology or a 500.
//
// Counting rules, stated once so the numbers cannot drift:
//   * "today" is the server day (the same `today()` /jobs/today-summary uses),
//     so the two can never disagree about what a morning contained;
//   * every count is org-scoped through withOrg(), by construction;
//   * a count that fails is simply ABSENT from the facts, and an absent fact is
//     never mentioned — a briefing missing a clause stays true, a briefing
//     asserting 0 leads because a query errored does not.
//   * and since D-0021 every count is also scoped to the READER. `ownerColumn`
//     names the column that says whose record it is; pass null (or be an admin)
//     to count the whole org.
const countToday = async (req, table, day, ownerColumn) => {
  try {
    let q = withOrg(
      supabase.from(table).select('id', { count: 'exact', head: true })
        .gte('created_at', day + 'T00:00:00Z'), req);
    if (ownerColumn) q = q.eq(ownerColumn, req.user.id);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  } catch { return null; }
};

// ── WHOSE NUMBERS IS THIS BRIEFING ABOUT? (Session 24, D-0021) ──────────────
// Until now: the ORGANISATION's. `withOrg` was the only filter, so every user —
// recruiter, BD, lead — opened their dashboard to the same sentence, "Two
// replies came in today, and the unassigned lead pool stands at 79." That pool
// is a BD-side number a recruiter has no part in working, presented as if it
// were their morning.
//
// Now it reports the READER's own desk. Admin is the exception the app already
// makes in /reports/recruiting and /next-actions: the whole company IS their
// desk, so they still see the org.
//
// Returns null for admin (meaning "do not narrow"), or the list of job ids the
// caller owns. An EMPTY array is meaningful and must not be treated as null —
// it means "you own no leads", and the honest briefing for that is about
// nothing rather than about everything.
const ownedJobIds = async (req) => {
  const isAdmin = (req.user.roles || []).includes('admin') || req.user.role === 'admin';
  if (isAdmin) return null;
  const { data } = await withOrg(
    supabase.from('jobs').select('id').eq('assigned_to_bd', req.user.id).is('deleted_at', null),
    req
  ).limit(2000);
  return (data || []).map(j => j.id);
};

const gatherFacts = async (req, day) => {
  const facts = { date: day };
  const mine = await ownedJobIds(req);
  facts.scope = mine === null ? 'org' : 'own';

  // Leads: one row read rather than three counts, because the industry and
  // position mixes come out of the same rows for free.
  try {
    let q = withOrg(supabase.from('jobs')
      .select('id, position, industry, is_duplicate, company:companies(industry)')
      .gte('created_at', day + 'T00:00:00Z')
      .is('deleted_at', null), req);
    if (mine !== null) q = q.eq('assigned_to_bd', req.user.id);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    const tally = (list, key) => {
      const m = {};
      list.forEach((r) => { const k = key(r); if (k) m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count).slice(0, 5);
    };
    facts.leads = {
      new: rows.length,
      duplicates: rows.filter((r) => r.is_duplicate).length,
      topIndustries: tally(rows, (r) => r.industry || (r.company && r.company.industry)),
      topPositions: tally(rows, (r) => r.position),
    };
  } catch { /* absent, not zero */ }

  // THE UNASSIGNED POOL IS NOT ANYBODY'S OWN WORK — by definition nobody owns
  // it yet. It is reported only to the people whose job is to distribute it
  // (admin and the RA/BD leads), which is who /distribute is gated to. A
  // recruiter being told the pool size was the clearest single symptom of the
  // briefing not knowing who it was talking to.
  try {
    const roles = req.user.roles || [req.user.role];
    const distributes = roles.some(r => r === 'admin' || r === 'ra_lead' || r === 'bd_lead');
    if (distributes) {
      const { count } = await withOrg(supabase.from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('stage', 'Unassigned').is('deleted_at', null), req);
      if (count) facts.leads = Object.assign({}, facts.leads, { pool: count });
    }
  } catch { /* absent */ }

  // A recruiter's own candidates and submissions; the whole org for an admin.
  const ownCol = mine === null ? null : 'created_by';
  const cands = await countToday(req, 'candidates', day, ownCol);
  if (cands !== null) facts.candidates = { new: cands };
  const subs = await countToday(req, 'submissions', day, mine === null ? null : 'recruiter_id');
  if (subs !== null) facts.submissions = { new: subs };

  // Replies that landed today. `conversation_messages` is the intelligence
  // layer's record of threads PACE is working, so an inbound row here is a
  // real person answering us — which is why it leads the second sentence.
  try {
    // Scoped to the caller's own threads: a reply is "yours" when it landed on
    // a contact hanging off a lead you own. With no leads of your own there is
    // nothing to narrow to, and the honest answer is no replies rather than
    // everybody's.
    let contactIds = null;
    if (mine !== null) {
      const { data: cs } = mine.length
        ? await withOrg(supabase.from('contacts').select('id').in('job_id', mine), req).limit(2000)
        : { data: [] };
      contactIds = (cs || []).map(c => c.id);
    }
    // Own no leads → own no threads → no replies. Stated as zero rather than
    // falling through to the org's number, which is the whole point of D-0021.
    if (contactIds !== null && !contactIds.length) {
      facts.replies = { inbound: 0, from_candidates: 0, from_contacts: 0 };
    } else {
      let mq = withOrg(supabase.from('conversation_messages')
        .select('candidate_id, contact_id')
        .eq('direction', 'inbound')
        .gte('sent_at', day + 'T00:00:00Z'), req);
      if (contactIds !== null) mq = mq.in('contact_id', contactIds);
      const { data, error } = await mq;
      if (error) throw error;
      const rows = data || [];
      facts.replies = {
        inbound: rows.length,
        from_candidates: rows.filter((r) => r.candidate_id).length,
        from_contacts: rows.filter((r) => r.contact_id).length,
      };
    }
  } catch { /* absent */ }

  return facts;
};

router.get('/ai/morning-briefing', auth, async (req, res) => {
  const day = today();
  let facts;
  try {
    facts = await gatherFacts(req, day);
  } catch (err) {
    // The database, not the AI. Say so honestly and let the card hide itself;
    // never guess at a number to fill the sentence.
    return res.json({
      date: day, summary: "Today's activity could not be read just now.",
      engine: 'rules', quiet: true, degraded: true, provider: null,
      facts: { date: day }, generated_at: new Date().toISOString(),
    });
  }

  let out = null;
  try {
    out = await ai.complete(supabase, {
      system: briefing.buildSystemPrompt(),
      prompt: briefing.buildUserPayload(facts),
      maxTokens: 400,
      feature: 'import_briefing',
      orgId: req.orgId,
    });
  } catch { out = null; }   // complete() should never throw; if it does, rules.

  const chosen = briefing.chooseBriefing(out && out.text, facts);
  res.json({
    date: day,
    summary: chosen.summary,
    engine: chosen.engine,
    quiet: chosen.quiet,
    degraded: false,
    provider: chosen.engine === 'ai' && out ? out.provider : null,
    ai_rejected: chosen.ai_rejected || null,
    facts,
    generated_at: new Date().toISOString(),
  });
});

// The older import-briefing endpoint, kept because /jobs/today-summary's payload
// is exactly what it consumes. It now degrades to the SAME rules writer instead
// of answering "AI summary unavailable" — Admin -> Integrations promises the
// daily briefing has a built-in non-AI version, and until now that was untrue.
router.post('/ai/generate-summary', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'Not allowed' });
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'data required' });

    const entries = (obj) => Object.entries(obj || {}).map(([name, count]) => ({ name, count }));
    // topPositions arrives as ["Estimator (3)"] strings from /jobs/today-summary.
    const positions = (data.topPositions || []).map((s) => {
      const m = String(s).match(/^(.*?)\s*\((\d+)\)\s*$/);
      return m ? { name: m[1], count: Number(m[2]) } : { name: String(s), count: 1 };
    });
    const facts = {
      date: data.date || today(),
      leads: {
        new: data.total || 0,
        duplicates: data.duplicates || 0,
        pool: data.poolSize || 0,
        topIndustries: entries(data.byIndustry),
        topPositions: positions,
      },
    };

    const out = await ai.complete(supabase, {
      system: briefing.buildSystemPrompt(),
      prompt: briefing.buildUserPayload(facts),
      maxTokens: 400, feature: 'import_briefing', orgId: req.orgId,
    });
    const chosen = briefing.chooseBriefing(out && out.text, facts);
    res.json({
      summary: chosen.summary, engine: chosen.engine,
      provider: chosen.engine === 'ai' && out ? out.provider : null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
