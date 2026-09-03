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

module.exports = (ctx) => {
  const router = express.Router();
  const { auth, hasRole, supabase } = ctx;

router.post('/ai/generate-email', auth, async (req, res) => {
  try {
    const { lead, contact, company, template } = req.body;
    const c = contact || lead || {};
    const vars = { fn: c.first_name, ln: c.last_name, company: company?.name, ind: company?.industry, pos: c.position || req.body.position, desig: c.designation, loc: company?.location, sender: req.user.name };
    const fill = (s) => (s || '').replace(/{{(\w+)}}/g, (m, k) => vars[k] || m);
    const fallback = () => res.json({ subject: fill(template?.subject || 'Opportunity at {{company}}'), body: fill(template?.body || 'Hi {{fn}},') });
    const prompt = `Write a hyper-personalized cold outreach email for a business development executive at Fute Global LLC.\nContact: ${vars.fn} ${vars.ln || ''}, ${vars.desig || ''} at ${vars.company} (${vars.ind || ''}, ${vars.loc || ''})\nPosition: ${vars.pos || ''}\nFormat:\nSubject: [subject line]\n\n[email body]`;
    const out = await ai.complete(supabase, { prompt, maxTokens: 600 });
    if (!out) return fallback();
    const text = out.text || '';
    const subjectMatch = text.match(/Subject:\s*(.+)/i);
    res.json({ subject: subjectMatch ? subjectMatch[1].trim() : `Opportunity at ${vars.company}`, body: text.replace(/^Subject:.+\n*/im, '').trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai/generate-summary', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'Not allowed' });
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'data required' });

    // Build top industries string
    const indEntries = Object.entries(data.byIndustry || {}).sort((a,b) => b[1]-a[1]);
    const topInds = indEntries.slice(0,4).map(([k,v]) => `${k} (${v})`).join(', ');
    const freshEntries = Object.entries(data.byFreshness || {});
    const freshStr = freshEntries.map(([k,v]) => `${v} ${k}`).join(', ');
    const tzEntries = Object.entries(data.byTimezone || {}).sort((a,b) => b[1]-a[1]);
    const topTz = tzEntries.slice(0,3).map(([k,v]) => `${k} (${v})`).join(', ');

    const prompt = `You are writing a daily lead import briefing for the BD (Business Development) team at Fute Global LLC, a staffing/recruitment firm. Write a warm, professional 3-4 sentence summary in plain prose — no bullet points, no headers, no lists. Make it feel like a helpful manager giving context to the team before they start their day.

Cover these points naturally:
- Total leads imported today (${data.total}) with ${data.clean} clean and ${data.duplicates > 0 ? data.duplicates + ' flagged as duplicates' : 'no duplicates'}
- Top industries: ${topInds || 'mixed industries'}
- Freshness mix: ${freshStr || 'normal'}
- Timezone spread: ${topTz || 'EST'}
- Top positions being hired: ${(data.topPositions || []).slice(0,3).join(', ')}
- Total unassigned pool now has ${data.poolSize} leads ready to work

Keep it concise, informative and actionable. End with one sentence about what the team should focus on today based on the data.`;

    const out = await ai.complete(supabase, { prompt, maxTokens: 400 });
    if (!out) return res.json({ summary: 'AI summary unavailable — no AI provider configured (Admin → Integrations).' });
    res.json({ summary: out.text, provider: out.provider });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
