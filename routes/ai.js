// ============================================================================
// AI GENERATION — cold-email drafting + daily import summary (Anthropic).
// ----------------------------------------------------------------------------
// Extracted from index.js. Mounted via: app.use(require('./routes/ai')(ctx));
// Route paths, handler logic and behaviour are unchanged from the original.
// ANTHROPIC_API_KEY is read from process.env exactly as before (including the
// placeholder check), so behaviour is identical.
// ============================================================================
const express = require('express');
const { fetchWithTimeout } = require('../http-client');

// AI generation is slower than a normal API call but must still be bounded —
// these run inside request handlers the browser is waiting on.
const AI_TIMEOUT_MS = 30000;

module.exports = (ctx) => {
  const router = express.Router();
  const { auth, hasRole } = ctx;

router.post('/ai/generate-email', auth, async (req, res) => {
  try {
    const { lead, contact, company, template } = req.body;
    const c = contact || lead || {};
    const vars = { fn: c.first_name, ln: c.last_name, company: company?.name, ind: company?.industry, pos: c.position || req.body.position, desig: c.designation, loc: company?.location, sender: req.user.name };
    const fill = (s) => (s || '').replace(/{{(\w+)}}/g, (m, k) => vars[k] || m);
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      return res.json({ subject: fill(template?.subject || 'Opportunity at {{company}}'), body: fill(template?.body || 'Hi {{fn}},') });
    }
    const prompt = `Write a hyper-personalized cold outreach email for a business development executive at Fute Global LLC.\nContact: ${vars.fn} ${vars.ln || ''}, ${vars.desig || ''} at ${vars.company} (${vars.ind || ''}, ${vars.loc || ''})\nPosition: ${vars.pos || ''}\nFormat:\nSubject: [subject line]\n\n[email body]`;
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }) }, { timeoutMs: AI_TIMEOUT_MS });
    const aiData = await response.json();
    const text = aiData.content?.[0]?.text || '';
    const subjectMatch = text.match(/Subject:\s*(.+)/i);
    res.json({ subject: subjectMatch ? subjectMatch[1].trim() : `Opportunity at ${vars.company}`, body: text.replace(/^Subject:.+\n*/im, '').trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai/generate-summary', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'Not allowed' });
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'data required' });

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      return res.json({ summary: 'AI summary unavailable — no API key configured.' });
    }

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

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
    }, { timeoutMs: AI_TIMEOUT_MS });
    const aiData = await response.json();
    const summary = aiData.content?.[0]?.text?.trim() || 'Summary unavailable.';
    res.json({ summary });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  return router;
};
