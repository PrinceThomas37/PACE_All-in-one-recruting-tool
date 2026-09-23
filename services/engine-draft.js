// ============================================================================
// ENGINE DRAFT — the leads engine's FIRST email, written by AI (D-0032).
// ----------------------------------------------------------------------------
// Until Session 29 every cold email the engine sent was a filled-in template;
// AI wrote only in the Generator. The owner asked for the engine's first emails
// to be AI-written, follow-ups staying templates.
//
// WHY AT SEND TIME, NOT AT QUEUE TIME. Queueing 100 leads in one request would
// mean 100 AI calls in one burst — Groq's free tier allows ~8,000 tokens a
// minute and one draft is ~2,100-2,400, so a burst is throttled after three.
// The send loop already waits 75-105s between emails; one draft inside that
// wait is ~1,500 tokens a minute, comfortably under the limit. It also means
// the draft is signed by the mailbox that really sends it.
//
// ONE CALL PER LEAD. A batch would write one shared email again, which is the
// sameness problem this exists to fix.
//
// THE TEMPLATE IS THE FALLBACK, ALWAYS. No provider, over budget, unparseable,
// or a draft that still breaks a house rule after one repair → the queued
// template goes out unchanged. A failed draft never delays or blocks a send.
//
// This file is PURE apart from the injected `complete` — no db, no fetch.
// ============================================================================

// Below this many characters the "job description" is just the title line the
// importer writes ("Title: X"), and there is nothing to research.
const THIN_POSTING_CHARS = 300;

function txt(v) { return String(v == null ? '' : v).trim(); }

function postingOf(job) {
  const r = job && job.research;
  let raw = '';
  if (r && typeof r === 'object') raw = txt(r.jd_raw);
  else if (typeof r === 'string') { try { raw = txt(JSON.parse(r).jd_raw); } catch (_) { raw = ''; } }
  return raw || (txt(job && job.position) ? 'Title: ' + txt(job.position) : '');
}

function isFirstEmail(email) {
  const t = email && email.followup_type;
  return !t || t === 'initial';
}

// The Generator's input shape, built from a lead row. Returns null when the
// lead lacks what any email needs (a first name and a company).
function engineInput({ job, contact, sender }) {
  const company = txt(job && job.company && job.company.name);
  const first = txt(contact && contact.first_name);
  if (!company || !first) return null;
  const posting = postingOf(job);
  return {
    contact_first_name: first,
    contact_title: txt(contact && contact.designation),
    company,
    location: txt(job && job.location) || txt(job && job.company && job.company.location),
    job_title: txt(job && job.position),
    job_description: posting,
    thin_posting: posting.length < THIN_POSTING_CHARS,
    outreach_type: 'first',
    sender: { name: txt(sender && sender.name), title: '', email: txt(sender && sender.email) },
  };
}

// The stored body keeps {{sender}}/{{senderemail}} (CLAUDE.md: the sender is
// resolved at send time). The model is given the real name so the checker's
// placeholder rule holds; it is put back into token form before storing.
function deferSender(text, sender) {
  let out = String(text == null ? '' : text);
  const email = txt(sender && sender.email);
  const name = txt(sender && sender.name);
  if (email) out = out.split(email).join('{{senderemail}}');
  if (name && name.length > 2) out = out.split(name).join('{{sender}}');
  return out;
}

// Ask, check, repair once, or give up. Returns { subject, body, repaired,
// usage } or { skipped: reason }. `complete(system, prompt)` resolves to the
// provider's { text, usage } or null.
async function draftFirstEmail({ gen, complete, input, companyName, omitSignOff }) {
  if (!input) return { skipped: 'missing_contact_or_company' };
  const reference = gen.rulesDraft(input, { companyName, omitSignOff });
  const forAi = { ...input, style_reference: reference && reference.email };
  const system = gen.buildSystemPrompt(companyName, { omitSignOff });
  const out = await complete(system, gen.buildUserPayload(forAi));
  if (!out || !out.text) return { skipped: 'ai_unavailable' };
  let parsed = gen.parseAiDraft(out.text);
  if (!parsed) return { skipped: 'ai_unparseable' };
  const opts = { omitSignOff };
  let check = gen.checkDraft(parsed, input, opts);
  let repaired = false;
  let usage = out.usage || {};
  if (!check.ok) {
    const fix = await complete(system, gen.buildRepairPrompt(parsed, check.violations));
    const fixed = fix && gen.parseAiDraft(fix.text);
    if (fixed) {
      const recheck = gen.checkDraft(fixed, input, opts);
      if (recheck.violations.length < check.violations.length) { parsed = fixed; check = recheck; repaired = true; }
    }
  }
  if (!check.ok) return { skipped: 'draft_rejected', violations: check.violations.map(v => v.code) };
  return {
    subject: deferSender(parsed.subject, input.sender),
    body: deferSender(parsed.email, input.sender),
    repaired, usage,
  };
}

module.exports = { THIN_POSTING_CHARS, postingOf, isFirstEmail, engineInput, deferSender, draftFirstEmail };
