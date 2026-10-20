'use strict';
// THE JOB BRIEF FOR CANDIDATE EMAILS — read it, or write it once and keep it (one home since R-270).
//
// A candidate email is assembled from a short brief about the JOB (a hook and a detail) plus the reasons this person fits,
// read off their own resume (services/candidate-outreach.js). The brief is the only part the AI writes, ONCE per job order,
// cached on the job (migration 042), so 25 candidates cost the same as one. Two callers need it: the candidate outreach screen
// (routes/candidate-outreach.js) and a candidate SEQUENCE with "AI writes each one" switched on (routes/recruiting/outreach.js).
// Both read and write it here, so the screen and the sequence can never disagree about what a job's brief is.
//
// complete() returns null instead of throwing (services/ai-provider.js); null, a reply that cannot be read, or a brief that
// fails its check all fall back to the rules brief, which is cached too — never an error.

const gen = require('./candidate-outreach');
const txt = (v) => String(v == null ? '' : v).trim();

/** The brief a job already has: the cached one when it is real, else the rules brief (not cached by reading). */
function cachedBrief(job) {
  if (!job) return null;
  const raw = txt(job.outreach_brief);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && txt(p.hook)) return { hook: p.hook, detail: p.detail, engine: job.outreach_brief_engine || 'rules', cached: true };
    } catch (_) { /* fall through to the rules brief */ }
  }
  return Object.assign(gen.rulesJobBrief(job), { cached: false });
}

/**
 * Write the job's brief with AI (one call), check it, cache it. Returns { brief, ai_available, ai_error?, violations?, model?, provider? }.
 * `brief` is always usable: the AI's when it passed, otherwise the rules brief.
 */
async function writeBrief({ supabase, aiProvider, job, orgId }) {
  const rules = gen.rulesJobBrief(job);
  const store = async (brief) => {
    try {
      await supabase.from('job_orders').update({
        outreach_brief: JSON.stringify({ hook: brief.hook, detail: brief.detail }),
        outreach_brief_at: new Date(),
        outreach_brief_engine: brief.engine,
      }).eq('id', job.id);
    } catch (_) { /* caching is a saving, never the point of the request */ }
  };
  if (!(await aiProvider.isAvailable(supabase, orgId))) { await store(rules); return { brief: rules, ai_available: false }; }
  // The job description is the one uncapped input — trim the AI's copy; the rules writer still reads the fields.
  const payload = aiProvider.budget.trimToTokens(gen.buildBriefPayload(job), 2200);
  const out = await aiProvider.complete(supabase, { maxTokens: 500, feature: 'candidate_brief', orgId, system: gen.buildBriefSystemPrompt(), prompt: payload });
  if (!out) { await store(rules); return { brief: rules, ai_available: true, ai_error: 'ai_unavailable' }; }
  const parsed = gen.parseBrief(out.text);
  if (!parsed) { await store(rules); return { brief: rules, ai_available: true, ai_error: 'ai_unparseable' }; }
  // Checked once here rather than once per candidate. No repair turn: the rules brief is a genuinely good answer.
  const check = gen.checkBrief(parsed, job);
  if (!check.ok) { await store(rules); return { brief: rules, ai_available: true, ai_error: 'brief_rejected', violations: check.violations }; }
  await store(parsed);
  return { brief: parsed, ai_available: true, model: out.model, provider: out.provider };
}

/** The brief a sequence should use: the cached AI one if there is one; otherwise write it now (once — it is then cached). */
async function briefForSequence({ supabase, aiProvider, job, orgId }) {
  const have = cachedBrief(job);
  if (have && have.cached && have.engine && have.engine !== 'rules') return have;
  const w = await writeBrief({ supabase, aiProvider, job, orgId });
  return w.brief;
}

/**
 * ONE candidate's email about one job, from the brief and their own fit — or null. Checked by the house checker
 * (checkCandidateDraft); a draft that fails is null, never sent. No answer buttons: a sequence email is answered by replying.
 * rank = match-engine.rankCandidates (handed in, so this stays free of the engine's weight).
 */
function candidateEmailFor({ candidate, job, brief, companyName, signature, rank }) {
  const ranked = rank ? rank([candidate], job, {}) : [];
  const input = { candidate, job, brief, reasons: (ranked[0] && ranked[0].reasons) || [], outreach_type: 'job' };
  const opts = { companyName: companyName || 'our team', omitSignOff: !!String(signature || '').trim(), hasButtons: false };
  const variant = gen.rulesVariants(input, opts).find((v) => v.id === 'direct');
  if (!variant) return null;
  const q = gen.checkCandidateDraft(variant, input, { angle: 'direct', omitSignOff: opts.omitSignOff, hasButtons: false });
  if (!q.ok) return null;
  const parts = gen.splitJobBlock(variant.email);
  return { subject: variant.subject, prose: parts.prose, panelHtml: gen.jobBlockHtmlFromText(parts.block) };
}

module.exports = { cachedBrief, writeBrief, briefForSequence, candidateEmailFor };
