'use strict';
// ============================================================================
// WHAT WENT OUT, BY STEP, FOR A DATE RANGE (R-315, owner 26 Oct).
//
// "My colleague was using the email Sent button to see the outreach and follow-ups that went out today and yesterday,
// but couldn't get clarity. The screenshot shows 400 sent. It does not show how many were today's outreach, FU1, FU2…
// by dates." The 400 was the list's own page limit (routes/email-history.js PER_SOURCE), not a count of anything.
//
// This is the count: every SENT email of the leads engine in the range, by sequence step (emails.followup_type: empty =
// the first email, fu1…fuN, reminder), plus the one-off sends (email_tracking) and candidate batches (candidate_outreach).
// PURE: the route loads the rows (already narrowed to what the viewer may see); this only buckets them.
// ============================================================================

// "fu1" → 1, "FU2" → 2; anything else is not a numbered follow-up.
function followUpNumber(t) {
  const m = /^fu(\d{1,2})$/i.exec(String(t || '').trim());
  return m ? Number(m[1]) : null;
}

// The step one email is: 'first' | 'fu1' … | 'reminder' | 'other'.
function stepOf(followupType) {
  const t = String(followupType == null ? '' : followupType).trim().toLowerCase();
  if (!t) return 'first';
  const n = followUpNumber(t);
  if (n) return 'fu' + n;
  if (t === 'reminder') return 'reminder';
  return 'other';
}

// The words on screen for a step.
function stepLabel(step) {
  if (step === 'first') return 'First email';
  const n = followUpNumber(step);
  if (n) return 'Follow-up ' + n;
  if (step === 'reminder') return 'Reminder';
  if (step === 'oneoff') return 'One-off';
  if (step === 'candidates') return 'Candidate batch';
  return 'Other';
}

// rows: [{ followup_type }] (lead emails, sent, in range); oneOff / candidates: plain counts.
// → { total, steps: [{ step, label, count }] } — first email, then follow-ups in order, then the rest; empty steps left out.
function summarize(rows, { oneOff = 0, candidates = 0 } = {}) {
  const counts = {};
  for (const r of (rows || [])) { const s = stepOf(r && r.followup_type); counts[s] = (counts[s] || 0) + 1; }
  if (oneOff) counts.oneoff = oneOff;
  if (candidates) counts.candidates = candidates;
  const rank = (s) => (s === 'first' ? 0 : followUpNumber(s) ? followUpNumber(s) : s === 'reminder' ? 100 : s === 'oneoff' ? 101 : s === 'candidates' ? 102 : 103);
  const steps = Object.keys(counts).sort((a, b) => rank(a) - rank(b)).map((s) => ({ step: s, label: stepLabel(s), count: counts[s] }));
  return { total: steps.reduce((n, s) => n + s.count, 0), steps };
}

// A date range from the screen: two instants (the viewer's own midnight, sent as ISO). Refused in words when unusable.
function readRange(q, now = new Date()) {
  const from = new Date(String((q && q.from) || ''));
  const to = new Date(String((q && q.to) || ''));
  if (isNaN(from) || isNaN(to)) return { error: 'Give a date range (from and to).' };
  if (to <= from) return { error: 'The end of the range must be after its start.' };
  if (from > now) return { error: 'That range has not started yet.' };
  return { from: from.toISOString(), to: to.toISOString() };
}

module.exports = { stepOf, stepLabel, summarize, readRange, followUpNumber };
