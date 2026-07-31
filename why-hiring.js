// why-hiring.js
// Infer WHY a role exists, and turn it into an opening line for outreach.
//
// This is the differentiator in the plan: not "you're hiring a Java developer"
// (which every competitor's email says), but "this req has been open 74 days and
// you've reposted it twice" — which is specific, verifiable, and is the actual
// reason a staffing firm gets a reply.
//
// EVERYTHING HERE IS FREE. No AI key (the app has none), no extra API calls. All
// signals come from data the job feed already handed us:
//   • how long the posting has been up, and whether it has reappeared
//   • how many roles that company has open at once, and in what mix
//   • the language of the description itself, which often states the reason
//     outright ("newly created role", "backfill", "due to growth")
//
// An AI pass could rephrase the headline more naturally later; it would sit
// behind this same interface and is explicitly not required.

// Phrases where the employer simply tells you why. Highest confidence available,
// because it isn't an inference at all — it's a quote.
const STATED = [
  { re: /\bnewly[- ]created (?:role|position)\b/i,           cat: 'new_role',  w: 5, say: 'a newly created role' },
  { re: /\bnew(?:ly)? (?:formed|established) team\b/i,        cat: 'new_team',  w: 5, say: 'a newly formed team' },
  { re: /\bbackfill(?:ing)?\b/i,                             cat: 'backfill',  w: 5, say: 'a backfill' },
  { re: /\breplac(?:e|ing) (?:a |our )?(?:departing|outgoing|former)\b/i, cat: 'backfill', w: 5, say: 'replacing someone who left' },
  { re: /\bdue to (?:rapid )?growth\b/i,                      cat: 'growth',    w: 5, say: 'driven by growth' },
  { re: /\b(?:expanding|growing) (?:our|the) team\b/i,        cat: 'growth',    w: 4, say: 'team expansion' },
  { re: /\bscal(?:e|ing) (?:up|our|the) team\b/i,             cat: 'growth',    w: 4, say: 'the team scaling up' },
  { re: /\bnew (?:office|site|location|market)\b/i,           cat: 'expansion', w: 4, say: 'a new location opening' },
  { re: /\bseries [a-e]\b|\bjust raised\b|\bnewly funded\b/i,  cat: 'funded',    w: 4, say: 'recent funding' },
  { re: /\b(?:new|recent) (?:client win|contract award|project win)\b/i, cat: 'project_win', w: 4, say: 'a new project win' },
  { re: /\burgent(?:ly)?\b|\bimmediate (?:need|start|opening)\b/i, cat: 'urgent', w: 3, say: 'an urgent opening' }
];

function daysBetween(a, b) {
  if (!a || !b) return null;
  const d = Math.round((new Date(b) - new Date(a)) / 86400000);
  return Number.isFinite(d) ? d : null;
}

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

// inferHiringReason(posting, context) → { category, confidence, headline, angle, signals[] }
//
//   posting  — a normalized posting (title, description, posted_at, department)
//   context  — { now, seen_count, first_seen_at, company_open_roles,
//                same_title_count, department_counts }
//
// `headline` is the human sentence. `angle` is the outreach opener, which is
// what actually lands in jobs.research.outreach.angle and gets merged into the
// email template — so it is written in second person, addressed to the client.
function inferHiringReason(posting = {}, context = {}) {
  const now = context.now ? new Date(context.now) : new Date();
  const signals = [];
  const scores = {};                       // category → accumulated weight
  const bump = (cat, w, note) => {
    scores[cat] = (scores[cat] || 0) + w;
    if (note) signals.push(note);
  };

  const text = String(posting.description || '');

  // 1. What the description says outright.
  let stated = null;
  for (const s of STATED) {
    if (s.re.test(text)) {
      bump(s.cat, s.w, `the posting describes ${s.say}`);
      if (!stated) stated = s;
    }
  }

  // 2. Age. The strongest cold-outreach signal there is, because it is a problem
  //    the client already knows they have.
  const age = daysBetween(posting.posted_at, now);
  if (age != null && age >= 0) {
    if (age >= 60) bump('hard_to_fill', 4, `open ${plural(age, 'day')}`);
    else if (age >= 30) bump('hard_to_fill', 2, `open ${plural(age, 'day')}`);
  }

  // 3. Reposting — a genuine relist, detected by the feed's own publish date
  //    moving forward for a posting we already knew about. Deliberately NOT the
  //    same as "we've seen it on many runs": a posting that simply stays up
  //    appears every run and has not been reposted at all. Claiming otherwise in
  //    an outreach email is the kind of detail a prospect checks.
  const reposts = Number(context.repost_count || 0);
  if (reposts >= 2) bump('hard_to_fill', 4, `reposted ${plural(reposts, 'time')}`);
  else if (reposts === 1) bump('hard_to_fill', 2, 'reposted once');

  // 4. Volume. Many roles open at once means a build-out, not a replacement.
  const openRoles = Number(context.company_open_roles || 0);
  if (openRoles >= 20) bump('growth', 4, `${openRoles} roles open across the company`);
  else if (openRoles >= 8) bump('growth', 2, `${openRoles} roles open across the company`);

  // 5. Several copies of the SAME title is a team build, and it is the single
  //    best staffing opportunity on this list — multiple placements, one client.
  const sameTitle = Number(context.same_title_count || 0);
  if (sameTitle >= 3) bump('team_build', 5, `${sameTitle} openings for this same role`);
  else if (sameTitle === 2) bump('team_build', 3, 'two openings for this same role');

  // Pick the winner.
  let category = 'unknown', best = 0;
  for (const [cat, w] of Object.entries(scores)) if (w > best) { best = w; category = cat; }

  const confidence = best >= 5 ? 'high' : best >= 3 ? 'medium' : best > 0 ? 'low' : 'none';

  return {
    category,
    confidence,
    score: best,
    signals,
    headline: buildHeadline(category, signals, posting),
    angle: buildAngle(category, { age, reposts, openRoles, sameTitle, posting })
  };
}

// The internal, factual summary a recruiter reads in the review queue.
function buildHeadline(category, signals, posting) {
  const title = posting.title || 'This role';
  if (!signals.length) return `${title} — no clear signal about why it is open.`;
  const LABEL = {
    growth: 'Growth', team_build: 'Team build-out', backfill: 'Backfill',
    new_role: 'Newly created role', new_team: 'New team', expansion: 'Expansion',
    funded: 'Recently funded', project_win: 'New project win',
    hard_to_fill: 'Hard to fill', urgent: 'Urgent', unknown: 'Unclear'
  };
  return `${LABEL[category] || 'Unclear'} — ${signals.slice(0, 3).join('; ')}.`;
}

// The outreach opener. Written to the client, specific enough to prove we
// actually looked. Deliberately plain: no flattery, no "I hope this finds you
// well" — the fact IS the hook.
function buildAngle(category, d) {
  const title = (d.posting && d.posting.title) || 'the role';

  if (category === 'hard_to_fill') {
    if (d.reposts >= 1 && d.age >= 30) {
      return `Your ${title} opening has been live about ${d.age} days and reposted ${plural(d.reposts, 'time')} — usually a sign the local pipeline is thin.`;
    }
    if (d.age >= 60) return `Your ${title} opening has been live about ${d.age} days.`;
    return `Your ${title} opening has been reposted, which usually means the pipeline has gone quiet.`;
  }
  if (category === 'team_build') {
    return `You have ${d.sameTitle} ${title} openings live at once — that is a team build, not a single hire.`;
  }
  if (category === 'growth') {
    return `You have ${d.openRoles} roles open right now, including ${title} — that pace is hard to staff from one pipeline.`;
  }
  if (category === 'new_team' || category === 'new_role') {
    return `Your ${title} posting reads as a newly created role — those are the hardest to benchmark and the slowest to fill.`;
  }
  if (category === 'backfill') {
    return `Your ${title} posting reads as a backfill, so the seat is already empty and the work is piling up.`;
  }
  if (category === 'expansion') return `You are opening a new location and hiring ${title} into it.`;
  if (category === 'funded')    return `You have raised recently and are hiring ${title} off the back of it.`;
  if (category === 'project_win') return `You have a new project win and are hiring ${title} to deliver it.`;
  if (category === 'urgent')    return `Your ${title} posting is flagged as an urgent opening.`;

  return `You currently have ${title} open.`;
}

module.exports = { inferHiringReason, buildAngle, buildHeadline, STATED };
