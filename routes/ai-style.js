// ============================================================================
// AI WRITING STYLE — routes. See services/ai-style.js for what a note is and
// is not allowed to do. Mounted via: app.use(require('./routes/ai-style')(ctx));
//
//   GET  /ai/style          → the person's note, the team default, which one is in force,
//                             and whether AI is on right now (a note does nothing without it)
//   PUT  /ai/style          → save (or clear) the PERSON's note — anyone signed in, it only
//                             ever shapes emails that go out in their own name
//   PUT  /ai/style/team     → save (or clear) the TEAM default — admin only
//   POST /ai/style/sample   → "try it": one first-email draft for an INVENTED lead, written
//                             with the note in the request (or the one in force), checked by
//                             the same house rules as a real email
// ============================================================================
const express = require('express');
const aiProvider = require('../services/ai-provider');
const aiStyle = require('../services/ai-style');
const engineDraft = require('../services/engine-draft');
const outreachGen = require('../services/outreach-generator');

// A sample costs a real AI call: a person gets a few an hour, then waits.
const SAMPLE_LIMIT = 8, SAMPLE_WINDOW_MS = 60 * 60 * 1000;
const sampleLog = new Map();   // userId -> [timestamps]

// An invented lead, so nothing about a real person is ever sent to a provider for a preview.
const SAMPLE_JOB = {
  position: 'Senior Estimator', location: 'Dallas, TX',
  company: { name: 'Acme Builders', location: 'Dallas, TX' },
  research: { jd_raw: 'Acme Builders is hiring a Senior Estimator for commercial construction in Dallas. ' +
    'Responsibilities include quantity takeoffs, bid preparation and subcontractor pricing using Bluebeam and Procore. ' +
    'Five or more years of commercial estimating experience is required; knowledge of concrete and steel scopes is preferred. ' +
    'The role reports to the VP of Preconstruction and works with project managers on value engineering.' },
};
const SAMPLE_CONTACT = { first_name: 'Sam', designation: 'VP of Preconstruction' };

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, orgIdFor } = ctx;
  const orgOf = (req) => (typeof orgIdFor === 'function' ? orgIdFor(req) : req.orgId) || req.orgId || null;

  // The customer's own name goes in the sample's instructions, as in a real email (never a hard-coded one).
  async function companyNameFor(orgId) {
    try {
      if (!orgId) return outreachGen.DEFAULT_COMPANY;
      const { data } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
      return (data && data.name) || outreachGen.DEFAULT_COMPANY;
    } catch (_) { return outreachGen.DEFAULT_COMPANY; }
  }

  async function status(req) {
    const [state, avail] = await Promise.all([
      aiStyle.load(supabase, { userId: req.user.id, orgId: orgOf(req) }),
      aiProvider.availability(supabase, { feature: 'engine_first_email', orgId: orgOf(req) }).catch(() => ({ available: false, reason: 'not_configured' })),
    ]);
    return {
      person: state.person, team: state.team, in_force: state.note, source: state.source, max: aiStyle.MAX_NOTE,
      can_set_team: hasRole(req, 'admin'),
      ai: { available: !!avail.available, reason: avail.reason || null },
    };
  }

  router.get('/ai/style', auth, async (req, res) => {
    try { res.json(await status(req)); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/ai/style', auth, async (req, res) => {
    try {
      const body = req.body || {};
      if (typeof body.note !== 'string') return res.status(400).json({ error: 'note (text) required' });
      await aiStyle.save(supabase, aiStyle.personKey(req.user.id), body.note);
      res.json(await status(req));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/ai/style/team', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Only an admin sets the team default.' });
      const body = req.body || {};
      if (typeof body.note !== 'string') return res.status(400).json({ error: 'note (text) required' });
      await aiStyle.save(supabase, aiStyle.teamKey(orgOf(req)), body.note);
      res.json(await status(req));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/ai/style/sample', auth, async (req, res) => {
    try {
      const now = Date.now();
      const log = (sampleLog.get(req.user.id) || []).filter(t => now - t < SAMPLE_WINDOW_MS);
      if (log.length >= SAMPLE_LIMIT) {
        return res.status(429).json({ error: `That is ${SAMPLE_LIMIT} samples this hour — try again a little later.` });
      }
      const body = req.body || {};
      const state = await aiStyle.load(supabase, { userId: req.user.id, orgId: orgOf(req) });
      // What is typed in the box (not yet saved) is what is tried; nothing typed → the one in force.
      const note = typeof body.note === 'string' ? aiStyle.cleanNote(body.note) : state.note;

      const avail = await aiProvider.availability(supabase, { feature: 'style_sample', orgId: orgOf(req) });
      if (!avail.available) return res.json({ ai: false, reason: avail.reason });

      sampleLog.set(req.user.id, log.concat(now));
      const input = engineDraft.engineInput({
        job: SAMPLE_JOB, contact: SAMPLE_CONTACT,
        sender: { name: req.user.name || 'You', email: req.user.email || '' },
      });
      const out = await engineDraft.draftFirstEmail({
        gen: outreachGen, input, companyName: await companyNameFor(orgOf(req)), omitSignOff: true,
        complete: (system, prompt) => aiProvider.complete(supabase, {
          system: system + aiStyle.styleBlock(note), prompt, maxTokens: 800, orgId: orgOf(req), feature: 'style_sample',
        }),
      });
      if (!out.body) return res.json({ ai: true, written: false, reason: out.skipped, violations: out.violations || [] });
      res.json({ ai: true, written: true, subject: out.subject, body: out.body, repaired: !!out.repaired, note_used: note });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
module.exports.SAMPLE_LIMIT = SAMPLE_LIMIT;
