// ============================================================================
// PLANS & ENTITLEMENTS — what an organisation is allowed to do.
//
// Step 4 of self-serve signup. Steps 1-3 got a stranger into a workspace of
// their own; this decides what that workspace can hold.
//
// TWO RULES THIS FILE EXISTS TO KEEP
//
// 1. A LIMIT THAT IS NOT ENFORCED IS NOT A LIMIT, IT IS A CLAIM. Every number
//    below is checked at the point of creation (adding a user, opening a job
//    order, adding a candidate, connecting a mailbox) and refused with a
//    readable message naming the limit and the plan. A pricing page whose
//    numbers the product does not honour is worse than no pricing page.
//
// 2. RAISING A LIMIT MUST NEVER BREAK ANYONE ALREADY OVER IT. Enforcement is on
//    CREATE only. An org that lands above its limit — because it downgraded, or
//    because we changed a number — keeps everything it has and simply cannot
//    add more. Nothing is deleted, hidden, or locked, ever. Data loss as a
//    billing mechanism is not something we do.
//
// PURE. No I/O, no database, no clock. Usage counts are passed in by the caller
// (routes/plans.js) so the rules can be tested exhaustively without a database
// and so the same rules can answer "may I?" and "what am I using?" identically.
//
// PRICING IS NOT SET. `price` is deliberately null on every paid tier: what
// PACE costs is the owner's decision, not an implementation detail, and an
// invented number would end up on a screen looking decided. The billing page
// says "pricing not set yet" until these are filled in. When they are, this is
// the ONE place to change them.
// ============================================================================

// `null` means unlimited, everywhere in this file.
const UNLIMITED = null;

const PLANS = {
  // What a stranger gets by signing themselves up. Deliberately a real trial —
  // enough to run one live search end to end and see whether PACE works for
  // them — and deliberately not enough to run a desk on forever.
  free: {
    id: 'free',
    name: 'Free',
    blurb: 'Try PACE with a real search, at no cost.',
    price: null,
    order: 1,
    limits: { seats: 2, job_orders: 3, candidates: 50, mailboxes: 1, emails_per_month: 200 },
    features: { reports: true, conversation_intel: false, sourcing: false, domain_claim: false, api: false },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    blurb: 'For a small recruiting team running live roles.',
    price: null,
    order: 2,
    limits: { seats: 5, job_orders: 25, candidates: 1000, mailboxes: 3, emails_per_month: 3000 },
    features: { reports: true, conversation_intel: true, sourcing: false, domain_claim: true, api: false },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    blurb: 'The full engine — including PACE finding its own leads and candidates.',
    price: null,
    order: 3,
    limits: { seats: 20, job_orders: UNLIMITED, candidates: 10000, mailboxes: 10, emails_per_month: 20000 },
    features: { reports: true, conversation_intel: true, sourcing: true, domain_claim: true, api: true },
  },
  business: {
    id: 'business',
    name: 'Business',
    blurb: 'Unlimited, for an agency running multiple desks.',
    price: null,
    order: 4,
    limits: { seats: UNLIMITED, job_orders: UNLIMITED, candidates: UNLIMITED, mailboxes: UNLIMITED, emails_per_month: UNLIMITED },
    features: { reports: true, conversation_intel: true, sourcing: true, domain_claim: true, api: true },
  },
  // Ours, not a purchasable tier. The default organisation is on this, which is
  // why none of the above changes anything for the existing deployment.
  internal: {
    id: 'internal',
    name: 'Internal',
    blurb: 'The PACE team’s own workspace.',
    price: null,
    order: 99,
    internal: true,
    limits: { seats: UNLIMITED, job_orders: UNLIMITED, candidates: UNLIMITED, mailboxes: UNLIMITED, emails_per_month: UNLIMITED },
    features: { reports: true, conversation_intel: true, sourcing: true, domain_claim: true, api: true },
  },
};

const DEFAULT_PLAN = 'free';

// The things that can run out. Kept as one list so a new limit cannot be added
// to a plan and then quietly go unenforced — routes/plans.js iterates this.
const LIMIT_KINDS = ['seats', 'job_orders', 'candidates', 'mailboxes', 'emails_per_month'];

const LIMIT_LABELS = {
  seats: 'team members',
  job_orders: 'job orders',
  candidates: 'candidates',
  mailboxes: 'connected mailboxes',
  emails_per_month: 'emails a month',
};

const FEATURE_LABELS = {
  reports: 'Reports',
  conversation_intel: 'Conversation intelligence',
  sourcing: 'Automatic lead & candidate sourcing',
  domain_claim: 'Claim your email domain',
  api: 'API access',
};

/** The plan record for an id. An unknown id falls back to Free, never to unlimited. */
function planFor(planId) {
  const id = String(planId || '').trim().toLowerCase();
  return PLANS[id] || PLANS[DEFAULT_PLAN];
}

/**
 * The limits actually in force for an organisation.
 *
 * `organizations.seats_limit` overrides the plan's seat count — that is how a
 * one-off deal ("they need 30 seats on Pro") is honoured without inventing a
 * bespoke plan. An override of null means "use the plan".
 */
function limitsFor(org) {
  const plan = planFor(org && org.plan);
  const limits = { ...plan.limits };
  if (org && org.seats_limit !== undefined && org.seats_limit !== null && Number.isFinite(Number(org.seats_limit))) {
    limits.seats = Number(org.seats_limit);
  }
  return limits;
}

/** Is a feature switched on for this org? Unknown features are OFF, not on. */
function featureEnabled(org, feature) {
  const plan = planFor(org && org.plan);
  return plan.features[feature] === true;
}

/**
 * May this org add one more of `kind`?  PURE.
 *
 * @param {object} org    the organizations row (plan, seats_limit)
 * @param {string} kind   one of LIMIT_KINDS
 * @param {number} used   how many they already have
 * @param {number} adding how many they are trying to add (default 1)
 * @returns {{allowed:boolean, limit:number|null, used:number, remaining:number|null,
 *            reason?:string, message?:string}}
 */
function checkLimit(org, kind, used, adding = 1) {
  const plan = planFor(org && org.plan);
  const limit = limitsFor(org)[kind];
  const have = Number.isFinite(Number(used)) ? Number(used) : 0;
  const want = Number.isFinite(Number(adding)) ? Number(adding) : 1;

  if (limit === UNLIMITED || limit === undefined) {
    return { allowed: true, limit: UNLIMITED, used: have, remaining: UNLIMITED };
  }
  if (have + want > limit) {
    const label = LIMIT_LABELS[kind] || kind;
    return {
      allowed: false, limit, used: have, remaining: Math.max(0, limit - have),
      reason: 'plan_limit',
      message: `Your ${plan.name} plan includes ${limit} ${label} and you are using ${have}. Upgrade to add more.`,
    };
  }
  return { allowed: true, limit, used: have, remaining: limit - have - want };
}

/**
 * The whole entitlement picture for one org, given its usage counts.
 * This is what GET /org/plan returns and what the billing screen renders.
 */
function summarize(org, usage = {}) {
  const plan = planFor(org && org.plan);
  const limits = limitsFor(org);
  const kinds = {};
  for (const kind of LIMIT_KINDS) {
    const used = Number(usage[kind] || 0);
    const limit = limits[kind];
    kinds[kind] = {
      label: LIMIT_LABELS[kind],
      used,
      limit: limit === UNLIMITED ? null : limit,
      // A downgrade can leave an org above a limit. Say so plainly rather than
      // showing a progress bar past 100% — and remember nothing gets taken away.
      over: limit !== UNLIMITED && used > limit,
      remaining: limit === UNLIMITED ? null : Math.max(0, limit - used),
    };
  }
  return {
    plan: {
      id: plan.id, name: plan.name, blurb: plan.blurb, price: plan.price,
      internal: !!plan.internal,
    },
    status: (org && org.status) || 'active',
    trial_ends_at: (org && org.trial_ends_at) || null,
    usage: kinds,
    features: Object.keys(FEATURE_LABELS).reduce((acc, f) => {
      acc[f] = { label: FEATURE_LABELS[f], enabled: featureEnabled(org, f) };
      return acc;
    }, {}),
  };
}

/** The tiers a customer can actually buy, in display order. */
function purchasablePlans() {
  return Object.values(PLANS).filter(p => !p.internal).sort((a, b) => a.order - b.order)
    .map(p => ({
      id: p.id, name: p.name, blurb: p.blurb, price: p.price,
      limits: p.limits, features: p.features,
    }));
}

module.exports = {
  PLANS, DEFAULT_PLAN, UNLIMITED, LIMIT_KINDS, LIMIT_LABELS, FEATURE_LABELS,
  planFor, limitsFor, featureEnabled, checkLimit, summarize, purchasablePlans,
};
