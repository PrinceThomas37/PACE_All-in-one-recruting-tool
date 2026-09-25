// ============================================================================
// AT MOST N FIRST EMAILS TO ONE COMPANY PER DAY (D-0046; owner: "email 2
// contacts per company one day").
//
// Why: on 2026-09-25 two people at the same company got near-identical AI
// first emails the same morning. A lead with three or four contacts had all of
// them emailed at once, which reads as a mail-merge the moment they compare
// notes. So a third contact at the same company WAITS — it is left pending and
// goes the next day. Nothing is dropped and nothing fails.
//
// Scope, deliberately narrow:
//   * FIRST emails only. Follow-ups continue a thread already started with
//     that one person, so they are not "another contact at the company".
//   * Per COMPANY, across every lead and every sender — two leads at one
//     company are still one company to the people reading.
//   * "A day" is the date the send path stamps on `emails.sent_at` (UTC), so
//     the count and the stamp can never disagree. One UTC day covers the whole
//     US working day, where every lead is.
//   * 0 turns the limit off (the setting `company_daily_first_emails`).
//
// The decision is PURE (capCheck); the one loader takes supabase and does two
// plain queries rather than an embedded filter, so it can be exercised offline.
// ============================================================================

const DEFAULT_CAP = 2;

function isFirstEmail(email) {
  const t = email && email.followup_type;
  return !t || t === 'initial';
}

// May this email go now? `counts` is first emails already sent today per
// company (including earlier sends in this same run).
function capCheck({ email, companyId, counts, cap }) {
  if (!isFirstEmail(email)) return { blocked: false };
  if (!companyId || !(Number(cap) > 0)) return { blocked: false };
  const sent = (counts && counts[companyId]) || 0;
  return { blocked: sent >= Number(cap), sent };
}

// The progress line a person reads while it waits.
function waitSentence(cap) {
  const n = Number(cap) || DEFAULT_CAP;
  return `${n} ${n === 1 ? 'person' : 'people'} at this company already emailed today — goes tomorrow`;
}

// First emails already sent today, per company, for the companies in this run.
async function loadSentToday(supabase, companyIds, day) {
  const counts = {};
  const ids = [...new Set((companyIds || []).filter(Boolean))];
  if (!ids.length) return counts;
  const companyByJob = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('jobs').select('id,company_id').in('company_id', ids.slice(i, i + 200));
    (data || []).forEach(j => { companyByJob[j.id] = j.company_id; });
  }
  const jobIds = Object.keys(companyByJob);
  for (let i = 0; i < jobIds.length; i += 200) {
    const { data } = await supabase.from('emails').select('job_id,followup_type')
      .eq('status', 'sent').eq('sent_at', day).in('job_id', jobIds.slice(i, i + 200));
    (data || []).forEach(e => {
      if (!isFirstEmail(e)) return;
      const co = companyByJob[e.job_id];
      if (co) counts[co] = (counts[co] || 0) + 1;
    });
  }
  return counts;
}

module.exports = { DEFAULT_CAP, isFirstEmail, capCheck, waitSentence, loadSentToday };
