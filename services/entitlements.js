// ============================================================================
// ENTITLEMENTS — the I/O half of plans.
//
// services/plans.js holds the rules and is pure. This counts what an
// organisation is actually using and turns "may I add one more?" into something
// a route can call in one line:
//
//     const gate = await entitlements.gate(supabase, req, 'job_orders');
//     if (gate.blocked) return res.status(gate.status).json(gate.body);
//
// WHY COUNTS ARE NOT CACHED
// A stale count is a limit that is wrong in one of two ways: it lets somebody
// past a limit they have hit, or it refuses somebody who has room. Both are
// worse than one indexed COUNT per create. These are `head: true` counts — the
// rows never leave the database — and they run only on CREATE, not on reads.
//
// EVERY COUNT IS INDIVIDUALLY GUARDED. A missing table or a failed count must
// never block a create: the failure mode of "we could not count" is to ALLOW.
// Refusing to let a paying customer add a candidate because a count query
// timed out is a far worse outcome than one row over a limit.
// ============================================================================

const plans = require('./plans');

/** The organizations row, or null. Never throws. */
async function loadOrg(supabase, orgId) {
  if (!orgId) return null;
  try {
    const { data } = await supabase.from('organizations').select('*').eq('id', orgId).maybeSingle();
    return data || null;
  } catch (_) {
    return null;
  }
}

/** One guarded count. Returns null when it could not be determined. */
async function countOrNull(query) {
  try {
    const { count, error } = await query;
    if (error) return null;
    return typeof count === 'number' ? count : null;
  } catch (_) {
    return null;
  }
}

const firstOfThisMonth = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

/**
 * How much of each limit this org is using.
 * A count that could not be determined comes back as null and is treated as
 * "no evidence they are over", i.e. allowed.
 */
async function countUsage(supabase, orgId, { now } = {}) {
  if (!orgId) return {};
  const head = { count: 'exact', head: true };

  const [seats, job_orders, candidates, mailboxes] = await Promise.all([
    countOrNull(supabase.from('users').select('id', head)
      .eq('org_id', orgId).eq('is_active', true).is('deleted_at', null)),
    countOrNull(supabase.from('job_orders').select('id', head)
      .eq('org_id', orgId).is('deleted_at', null)),
    countOrNull(supabase.from('candidates').select('id', head)
      .eq('org_id', orgId)),
    countOrNull(supabase.from('user_emails').select('id', head)
      .eq('org_id', orgId).eq('is_active', true)),
  ]);

  // email_send_log is one row per mailbox per day carrying a count, so this is
  // a sum rather than a row count.
  let emails_per_month = null;
  try {
    const { data, error } = await supabase.from('email_send_log')
      .select('emails_sent').eq('org_id', orgId).gte('send_date', firstOfThisMonth(now));
    if (!error && Array.isArray(data)) {
      emails_per_month = data.reduce((n, r) => n + (Number(r.emails_sent) || 0), 0);
    }
  } catch (_) { /* leave null */ }

  return { seats, job_orders, candidates, mailboxes, emails_per_month };
}

/**
 * The full picture for GET /org/plan.
 * Counts that came back null are reported as 0 rather than invented.
 */
async function summaryFor(supabase, orgId, { now } = {}) {
  const org = await loadOrg(supabase, orgId);
  const usage = await countUsage(supabase, orgId, { now });
  const clean = {};
  for (const k of plans.LIMIT_KINDS) clean[k] = usage[k] == null ? 0 : usage[k];
  return plans.summarize(org || {}, clean);
}

/**
 * The one-liner routes call before creating something.
 *
 * Returns { blocked:false } when it is fine to proceed, or
 * { blocked:true, status, body } to hand straight back to the client.
 */
async function gate(supabase, req, kind, { adding = 1, orgIdFor } = {}) {
  const orgId = (orgIdFor ? orgIdFor(req) : (req && req.orgId)) || null;
  if (!orgId) return { blocked: false };            // no org context → not our call to make

  const org = await loadOrg(supabase, orgId);
  if (!org) return { blocked: false };              // cannot tell → allow (see header)

  const usage = await countUsage(supabase, orgId);
  const used = usage[kind];
  if (used == null) return { blocked: false };      // count failed → allow

  const verdict = plans.checkLimit(org, kind, used, adding);
  if (verdict.allowed) return { blocked: false, ...verdict };

  return {
    blocked: true,
    status: 402,                                    // Payment Required — this is a billing wall, not a permission error
    body: {
      error: 'plan_limit',
      limit_kind: kind,
      limit: verdict.limit,
      used: verdict.used,
      plan: plans.planFor(org.plan).id,
      message: verdict.message,
    },
  };
}

/**
 * Feature gate — for whole capabilities rather than counts.
 * Same shape as `gate` so routes read the same either way.
 */
async function featureGate(supabase, req, feature, { orgIdFor } = {}) {
  const orgId = (orgIdFor ? orgIdFor(req) : (req && req.orgId)) || null;
  if (!orgId) return { blocked: false };
  const org = await loadOrg(supabase, orgId);
  if (!org) return { blocked: false };
  if (plans.featureEnabled(org, feature)) return { blocked: false };

  const plan = plans.planFor(org.plan);
  return {
    blocked: true,
    status: 402,
    body: {
      error: 'plan_feature',
      feature,
      plan: plan.id,
      message: `${plans.FEATURE_LABELS[feature] || feature} is not included in the ${plan.name} plan. Upgrade to switch it on.`,
    },
  };
}

module.exports = { loadOrg, countUsage, summaryFor, gate, featureGate, firstOfThisMonth };
