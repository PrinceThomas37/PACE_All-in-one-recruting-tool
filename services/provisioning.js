// ============================================================================
// SIGN-IN ROUTING — where does a person who has no account end up?
//
// This is step 3 of self-serve signup. Steps 1-2 gave organisations a plan and
// a kind, and gave them a way to CLAIM a domain and PROVE they own it. This is
// the step that finally uses that proof: someone signs in with Microsoft or
// Google, PACE has never seen the address, and something has to decide between
//
//   • join an existing customer's workspace          (their domain is verified)
//   • hand them a private workspace of their own     (nobody owns their domain)
//   • refuse and tell them who to ask                (owned, but invite-only)
//
// WHY THE DECISION IS A PURE FUNCTION
// Getting this wrong is not a bug, it is a breach: route alice@acme.com into
// the wrong org and she is inside another company's candidate database. So the
// decision (`decide`) does no I/O and is exhaustively tested, and the part that
// writes rows (`provision`) does no deciding. Every refusal is a deliberate,
// named outcome rather than a fallthrough.
//
// THE RULES, and why each one exists
//
//   1. ONLY A VERIFIED CLAIM ROUTES ANYONE. An unverified claim is an
//      account-takeover primitive (claim microsoft.com, harvest every Microsoft
//      employee who signs in). `verified_at IS NULL` is treated exactly like no
//      claim at all — see services/org-domains.js.
//   2. A VERIFIED CLAIM STILL HAS TO OPT IN. `auto_join` defaults to false, so
//      the default for a claimed domain is "an admin invites you". Verification
//      proves ownership; it is not by itself a decision to let every mailbox on
//      the domain walk in.
//   3. AN UNCLAIMED COMPANY DOMAIN GETS A *PRIVATE* WORKSPACE, NOT A SHARED
//      ONE. bob@acme.com does not join alice@acme.com's workspace just because
//      they share a domain — that is the unverified auto-join we just refused,
//      wearing a friendlier hat. Whoever proves ownership of acme.com owns it;
//      until then, everyone is alone.
//   4. A FREE-MAIL ADDRESS IS ALWAYS A PRIVATE WORKSPACE. Nobody's organisation
//      is gmail.com.
//   5. NOTHING HAPPENS UNLESS SELF-SERVE IS SWITCHED ON. Off, this module
//      returns precisely today's behaviour ("no account exists, ask your
//      administrator"), so the code can ship and deploy long before the front
//      door is opened. See `selfServeEnabled`.
//
// ONE EMAIL = ONE ACCOUNT. `users.email` is globally unique, so a person
// belongs to exactly one organisation. That is a real product limit (no
// contractor sitting in two customers' workspaces) and it is also what makes
// the race below resolvable: two simultaneous first sign-ins cannot both win.
// ============================================================================

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const orgDomains = require('./org-domains');

// The front door stays shut until this is explicitly set to 'on'.
//
// Deliberately an env var and not a database setting: opening self-serve signup
// is a decision about the whole deployment, it needs migrations 038/039 applied
// first, and it should not be reachable from inside the app by anyone who
// happens to be an admin of some org.
const SELF_SERVE_ENV = 'SELF_SERVE_SIGNUP';
function selfServeEnabled(env = process.env) {
  return String(env[SELF_SERVE_ENV] || '').trim().toLowerCase() === 'on';
}

// Roles the `users.role` CHECK constraint accepts. A claimed domain's
// auto_join_role comes out of a database row an org admin controls, so it is
// validated here rather than trusted — otherwise "auto_join_role = 'admin'"
// would be a way to mint admins of your own org, and a typo would be a 500 at
// the moment somebody is trying to log in.
const ASSIGNABLE_JOIN_ROLES = new Set(['ra', 'ra_lead', 'bd', 'bd_lead', 'recruiter', 'associate_director', 'director']);
const DEFAULT_JOIN_ROLE = 'recruiter';

// ── The decision ────────────────────────────────────────────────────────────
/**
 * Decide what should happen for a sign-in. PURE — no I/O, no clock, no env.
 *
 * @param {object}  input
 * @param {string}  input.email      the verified address the provider returned
 * @param {object?} input.user       existing `users` row, or null
 * @param {object?} input.claim      VERIFIED `org_domains` row for the domain, or null
 * @param {object?} input.org        the `organizations` row the claim points at
 * @param {number?} input.seatsUsed  active users already in that org
 * @param {boolean} input.selfServe  is self-serve provisioning switched on
 * @returns {{action:string, reason:string, message?:string, role?:string, orgId?:string}}
 *          action ∈ sign_in | join_org | create_workspace | refuse
 */
function decide({ email, user, claim, org, seatsUsed = 0, selfServe = false } = {}) {
  const addr = String(email || '').toLowerCase().trim();
  if (!addr || addr.indexOf('@') < 1) {
    return { action: 'refuse', reason: 'no_email', message: 'Your identity provider did not return an email address.' };
  }
  const domain = orgDomains.normalizeDomain(addr);

  // An existing account signs in, exactly as it always has. The one new gate:
  // a suspended or cancelled workspace stops letting people in. Its data is
  // untouched — this is a billing state, not a deletion.
  if (user) {
    if (org && org.status && org.status !== 'active') {
      return {
        action: 'refuse', reason: 'org_suspended',
        message: `Your PACE workspace is ${org.status}. Ask your administrator to reactivate it.`,
      };
    }
    return { action: 'sign_in', reason: 'existing_user' };
  }

  // Self-serve off → today's answer, unchanged. This is the safe default and
  // the state the deployment ships in.
  if (!selfServe) {
    return {
      action: 'refuse', reason: 'no_account',
      message: `No PACE account exists for ${addr}. Ask your administrator to add you, then sign in again.`,
    };
  }

  // A verified claim is the only thing that can put a stranger inside somebody
  // else's workspace, and even then only if that workspace asked for it.
  if (claim && claim.verified_at) {
    if (org && org.status && org.status !== 'active') {
      return {
        action: 'refuse', reason: 'org_suspended',
        message: `The PACE workspace for ${domain} is ${org.status}. Ask your administrator to reactivate it.`,
      };
    }
    if (!claim.auto_join) {
      return {
        action: 'refuse', reason: 'invite_only',
        message: `${domain} is set up on PACE, but new accounts are added by an administrator. Ask yours to invite ${addr}.`,
      };
    }
    // Seats are the plan's promise. Silently exceeding them would make the
    // limit meaningless; failing loudly at sign-in is what makes it real.
    if (org && Number.isFinite(org.seats_limit) && org.seats_limit !== null && seatsUsed >= org.seats_limit) {
      return {
        action: 'refuse', reason: 'seats_full',
        message: `${domain} has used all ${org.seats_limit} of its PACE seats. Ask your administrator to free one or upgrade.`,
      };
    }
    const role = ASSIGNABLE_JOIN_ROLES.has(claim.auto_join_role) ? claim.auto_join_role : DEFAULT_JOIN_ROLE;
    return { action: 'join_org', reason: 'verified_domain', orgId: claim.org_id, role };
  }

  // Nobody has proved they own this domain (or it is a personal mailbox), so
  // the only safe destination is a workspace of their own.
  return {
    action: 'create_workspace', reason: orgDomains.isFreeMailDomain(domain) ? 'free_mail' : 'unclaimed_domain',
    role: 'admin',   // it is their workspace; somebody has to be able to set it up
  };
}

// ── Lookups (I/O, no decisions) ─────────────────────────────────────────────

// org_domains / the new organizations columns arrive with migration 038. Until
// it is applied every one of these reads must behave as "nothing claimed"
// rather than throwing, so the app is correct before and after.
const MISSING_TABLE = /relation .*(org_domains|organizations).* does not exist|could not find the table|does not exist/i;

/** The VERIFIED claim on this email's domain, or null. Never throws. */
async function verifiedClaimFor(supabase, email) {
  const domain = orgDomains.normalizeDomain(email);
  if (!domain || domain.indexOf('.') < 0) return null;
  // A free-mail domain can never hold a claim (org-domains refuses to create
  // one), so skip the query entirely rather than trusting the data.
  if (orgDomains.isFreeMailDomain(domain)) return null;
  try {
    const { data, error } = await supabase.from('org_domains')
      .select('org_id,domain,verified_at,auto_join,auto_join_role')
      .eq('domain', domain).not('verified_at', 'is', null).maybeSingle();
    if (error) return null;
    return data || null;
  } catch (_) {
    return null;   // migration 038 not applied
  }
}

/** The organisation row, or null. Never throws. */
async function loadOrg(supabase, orgId) {
  if (!orgId) return null;
  try {
    const { data } = await supabase.from('organizations').select('*').eq('id', orgId).maybeSingle();
    return data || null;
  } catch (_) {
    return null;
  }
}

/** How many active people are already in an org (seat accounting). */
async function seatsUsedIn(supabase, orgId) {
  if (!orgId) return 0;
  try {
    const { count } = await supabase.from('users')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('is_active', true).is('deleted_at', null);
    return count || 0;
  } catch (_) {
    return 0;
  }
}

// ── Writing it down ─────────────────────────────────────────────────────────

/** A person's display name, from the provider's profile or their address. */
function displayNameFor(email, providedName) {
  const given = String(providedName || '').trim();
  if (given) return given.slice(0, 120);
  const local = String(email || '').split('@')[0] || 'New user';
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 120);
}

/** What to call somebody's private workspace. */
function workspaceNameFor(email, providedName) {
  return `${displayNameFor(email, providedName)}'s workspace`.slice(0, 160);
}

/**
 * A slug that will not collide. The random suffix is not decoration: slug is
 * UNIQUE, and two people called Alex signing up minutes apart must both succeed.
 */
function workspaceSlug(email) {
  const local = String(email || '').split('@')[0] || 'workspace';
  const base = local.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'workspace';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * An SSO account has no password, and must not have a guessable one.
 *
 * The column is NOT NULL with a DEFAULT of the literal string 'change_me',
 * which is not a bcrypt hash — but relying on "that happens not to compare
 * equal" is not a security property. A random hash is.
 */
async function unusablePasswordHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 10);
}

/**
 * Create the organisation for a private workspace.
 * Returns the row, or throws (the caller turns that into a refusal).
 */
async function createWorkspace(supabase, { email, name }) {
  const { data, error } = await supabase.from('organizations').insert({
    name: workspaceNameFor(email, name),
    slug: workspaceSlug(email),
    kind: 'individual',
    plan: 'free',
    status: 'active',
  }).select('*').single();
  if (error) throw error;
  return data;
}

/** Create the user row. */
async function createUser(supabase, { email, name, orgId, role }) {
  const { data, error } = await supabase.from('users').insert({
    name: displayNameFor(email, name),
    email: String(email).toLowerCase().trim(),
    password_hash: await unusablePasswordHash(),
    role,
    roles: [role],
    org_id: orgId,
    is_active: true,
  }).select('*').single();
  if (error) throw error;
  return data;
}

/**
 * Execute a decision. Returns { ok:true, user, created } or { ok:false, … }.
 *
 * THE RACE: two browser tabs, one brand-new address, two sign-ins at once.
 * `users.email` is UNIQUE, so exactly one insert wins and the loser gets a
 * duplicate-key error. That is not a failure — the account it was trying to
 * create now exists, so we read it back and sign that person in. The orphaned
 * organisation the loser had already created is deleted best-effort; leaving an
 * empty org behind is untidy but harmless, so it never fails the sign-in.
 */
async function provision(supabase, decision, { email, name }) {
  let orgId = decision.orgId || null;
  let createdOrg = null;

  try {
    if (decision.action === 'create_workspace') {
      createdOrg = await createWorkspace(supabase, { email, name });
      orgId = createdOrg.id;
    }
    const user = await createUser(supabase, { email, name, orgId, role: decision.role });

    // The workspace's first member is its owner. Best-effort: `created_by`
    // arrives with migration 038 and is bookkeeping, never a permission.
    if (createdOrg) {
      try { await supabase.from('organizations').update({ created_by: user.id }).eq('id', createdOrg.id); } catch (_) {}
    }
    return { ok: true, user, created: true, orgId };
  } catch (err) {
    const msg = String(err && err.message || '');

    // Lost the race — the account exists now. Sign them into it.
    if (/duplicate key|already exists|23505/i.test(msg)) {
      if (createdOrg) {
        try { await supabase.from('organizations').delete().eq('id', createdOrg.id); } catch (_) {}
      }
      const { data: existing } = await supabase.from('users').select('*')
        .eq('email', String(email).toLowerCase().trim()).eq('is_active', true).is('deleted_at', null).maybeSingle();
      if (existing) return { ok: true, user: existing, created: false, orgId: existing.org_id };
    }

    // The most likely cause by far: migration 038 has not been applied, so
    // `organizations.kind` does not exist. Say that plainly instead of leaking
    // a Postgres error onto the sign-in screen.
    if (createdOrg) {
      try { await supabase.from('organizations').delete().eq('id', createdOrg.id); } catch (_) {}
    }
    console.error('[provisioning] failed for', String(email).toLowerCase().trim(), '-', msg);
    if (MISSING_TABLE.test(msg) || /column .* does not exist/i.test(msg)) {
      return {
        ok: false, reason: 'not_enabled',
        message: 'Self-serve signup is not finished being set up on this deployment yet. Ask your administrator to add you.',
      };
    }
    return { ok: false, reason: 'provisioning_failed', message: 'We could not create your workspace. Please try again.' };
  }
}

/**
 * The whole thing: given a verified email with no matching account, work out
 * where it belongs and put it there.
 *
 * Returns { ok:true, user, created } or { ok:false, reason, message }.
 */
async function routeNewSignIn(supabase, { email, name, selfServe = selfServeEnabled() } = {}) {
  const claim = selfServe ? await verifiedClaimFor(supabase, email) : null;
  const org = claim ? await loadOrg(supabase, claim.org_id) : null;
  const seatsUsed = (org && org.seats_limit != null) ? await seatsUsedIn(supabase, claim.org_id) : 0;

  const decision = decide({ email, user: null, claim, org, seatsUsed, selfServe });
  if (decision.action === 'refuse') {
    return { ok: false, reason: decision.reason, message: decision.message };
  }
  const out = await provision(supabase, decision, { email, name });
  return out.ok ? { ...out, reason: decision.reason } : out;
}

module.exports = {
  decide, provision, routeNewSignIn,
  verifiedClaimFor, loadOrg, seatsUsedIn,
  selfServeEnabled, displayNameFor, workspaceNameFor, workspaceSlug,
  SELF_SERVE_ENV, ASSIGNABLE_JOIN_ROLES, DEFAULT_JOIN_ROLE,
};
