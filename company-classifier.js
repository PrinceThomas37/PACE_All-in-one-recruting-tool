// company-classifier.js
// Is this company an END CLIENT hiring for itself, or a staffing/consulting firm
// hiring on someone else's behalf?
//
// WHY THIS MATTERS. The owner's target is end clients hiring directly — the
// company that actually has the role. Staffing firms are competitors, not
// prospects, and a lead list full of them wastes a recruiter's day. A sample
// job-board search during planning came back almost entirely staffing firms,
// which is what prompted this filter existing at all.
//
// The free employer ATS boards we source from are already mostly end clients
// (a staffing firm rarely runs its client's reqs through its own public
// Greenhouse board), so this is cheap insurance rather than heavy lifting.
//
// HOW IT DECIDES. Rule-based, no AI key, no network. Evidence accumulates into a
// score; a confident verdict needs more than one weak signal, because a single
// keyword is not proof — "Solutions" appears in plenty of legitimate product
// companies, and "Technologies" is in half the S&P 500.
//
// It is deliberately biased toward NOT excluding: a staffing firm that slips
// into the review queue costs one click to reject, while a wrongly-excluded end
// client is a lost customer nobody ever sees. When in doubt it returns
// 'unknown', which still reaches the queue.

// Words that, on their own, mean very little — but combined with a corporate
// suffix or another signal, start to mean something.
const WEAK_NAME_HINTS = [
  'solutions', 'technologies', 'systems', 'services', 'consulting', 'consultants',
  'group', 'associates', 'partners', 'global', 'infotech', 'softech', 'tek', 'tech inc'
];

// Words that are strong evidence on their own — few end clients put these in
// their legal name.
const STRONG_NAME_HINTS = [
  'staffing', 'recruiting', 'recruitment', 'talent solutions', 'talent acquisition',
  'manpower', 'placements', 'placement services', 'headhunt', 'staffing solutions',
  'it staffing', 'workforce solutions', 'resourcing', 'talent group', 'hr solutions',
  'employment agency', 'search partners', 'executive search'
];

// Description language that gives it away regardless of the name. These are the
// phrases staffing firms use when posting a role they are filling for a client.
const DESCRIPTION_TELLS = [
  { re: /\bour client\b/i,                       w: 3, why: 'the description says "our client"' },
  { re: /\bclient(?:'s)? (?:site|location|office)\b/i, w: 2, why: 'refers to a client site' },
  { re: /\b(?:c2c|corp[ -]?to[ -]?corp)\b/i,     w: 3, why: 'mentions corp-to-corp' },
  { re: /\bw2\b.{0,20}\b(?:only|contract)\b/i,   w: 2, why: 'mentions W2 contract terms' },
  { re: /\b(?:third[ -]party|1099)\s+(?:vendors?|candidates?)\b/i, w: 2, why: 'refers to third-party vendors' },
  { re: /\bsubmit(?:ting)?\s+(?:your\s+)?(?:resume|profile)\s+to\s+(?:the\s+)?client\b/i, w: 3, why: 'submits resumes to a client' },
  { re: /\bimplementation partner\b/i,           w: 2, why: 'describes itself as an implementation partner' },
  { re: /\bbench\b.{0,15}\b(?:sales|consultants?)\b/i, w: 3, why: 'mentions bench sales' },
  { re: /\bstaffing (?:agency|firm|company)\b/i, w: 3, why: 'describes itself as a staffing firm' },
  { re: /\bwe are (?:a|an)\s+(?:leading\s+)?(?:it\s+)?(?:staffing|recruiting|consulting)\b/i, w: 3, why: 'self-describes as staffing/recruiting' },
  { re: /\brate\s*:\s*\$?\d+\s*(?:-|to)\s*\$?\d+\s*\/?\s*(?:hr|hour)\b/i, w: 1, why: 'quotes an hourly bill rate' }
];

const CORP_SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|pvt|private limited|llp)\b\.?/i;

function norm(s) { return String(s == null ? '' : s).toLowerCase(); }

// Behavioural signal: staffing firms post many unrelated titles across many
// cities, because they're filling other people's reqs. A product company's board
// clusters — lots of engineering in one or two hubs. This is the signal that
// catches firms whose name and copy give nothing away, so it's weighted
// accordingly, but it needs a decent sample before it means anything.
function boardShapeSignal(postings) {
  const list = Array.isArray(postings) ? postings : [];
  if (list.length < 8) return null;             // too few to infer anything

  const titles = new Set();
  const cities = new Set();
  for (const p of list) {
    const t = norm(p.title).replace(/[^a-z ]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !['senior','junior','lead','staff','principal','engineer','developer'].includes(w))
      .slice(0, 3).join(' ');
    if (t) titles.add(t);
    const c = norm(p.city || p.location);
    if (c) cities.add(c);
  }

  const titleSpread = titles.size / list.length;   // 1.0 = every posting is a different role
  const citySpread = cities.size / list.length;

  if (titleSpread > 0.85 && cities.size >= 6) {
    return { w: 3, why: `${titles.size} distinct roles across ${cities.size} cities — looks like agency posting` };
  }
  if (titleSpread > 0.75 && citySpread > 0.6) {
    return { w: 2, why: 'wide spread of unrelated roles and locations' };
  }
  return null;
}

// classify({ name, description, postings, domain }) → verdict
//
// Returns { kind: 'end_client' | 'staffing_firm' | 'unknown', score, confidence, why[] }
function classifyCompany(input = {}) {
  const name = norm(input.name);
  const description = norm(input.description);
  const why = [];
  let score = 0;
  // Tracked separately because the ATS-board discount below must only offset
  // name-based suspicion, never evidence of actual behaviour.
  let hardEvidence = 0;

  for (const hint of STRONG_NAME_HINTS) {
    if (name.includes(hint)) { score += 3; why.push(`name contains "${hint}"`); break; }
  }

  // Weak name hints only count when paired with a corporate suffix — "Acme
  // Solutions Inc" is a different signal from a product called "Solutions".
  if (CORP_SUFFIX.test(name)) {
    for (const hint of WEAK_NAME_HINTS) {
      if (name.includes(hint)) { score += 1; why.push(`name pattern "${hint}" with a corporate suffix`); break; }
    }
  }

  for (const tell of DESCRIPTION_TELLS) {
    if (tell.re.test(description)) { score += tell.w; hardEvidence += tell.w; why.push(tell.why); }
  }

  const shape = boardShapeSignal(input.postings);
  if (shape) { score += shape.w; hardEvidence += shape.w; why.push(shape.why); }

  // A free public ATS board is weak evidence FOR an end client: staffing firms
  // overwhelmingly post to aggregators, not their own Greenhouse.
  //
  // But it only offsets NAME-based suspicion. If the description says "our
  // client", or the board is fifty unrelated roles across thirty cities, that is
  // observed behaviour actively contradicting the assumption this discount rests
  // on — discounting it there would let the weakest signal veto the strongest.
  if (input.from_ats_board && score > 0 && hardEvidence === 0) {
    score -= 1;
    why.push('publishes its own ATS board (typical of a direct employer)');
  }

  let kind = 'unknown';
  if (score >= 3) kind = 'staffing_firm';
  else if (score <= 0) kind = 'end_client';

  return {
    kind,
    score,
    // Confidence is about how sure we are, not which way it went.
    confidence: score >= 5 ? 'high' : (score >= 3 || score <= -1) ? 'medium' : 'low',
    why
  };
}

module.exports = { classifyCompany, STRONG_NAME_HINTS, DESCRIPTION_TELLS };
