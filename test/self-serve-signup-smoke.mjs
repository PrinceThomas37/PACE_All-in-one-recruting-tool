// Unit test for services/provisioning.js — WHERE A NEW SIGN-IN ENDS UP.
//
// This is the highest-consequence decision in the product. Route
// alice@acme.com into the wrong organisation and she is looking at another
// company's candidates, leads and mailboxes. There is no error message when it
// goes wrong — it just quietly works, for the wrong person. So the decision is
// a pure function and this file tries hard to break it.
//
// The properties that must hold:
//
//   1. OFF BY DEFAULT. With SELF_SERVE_SIGNUP unset, a stranger gets exactly
//      the answer they got before this feature existed. Shipping the code and
//      opening the door are two separate acts.
//   2. AN UNVERIFIED CLAIM ROUTES NOBODY. verified_at IS NULL must be
//      indistinguishable from no claim at all — otherwise claiming a domain you
//      do not own harvests everyone on it.
//   3. A VERIFIED CLAIM STILL HAS TO OPT IN (auto_join defaults to false).
//   4. SHARING A DOMAIN IS NOT MEMBERSHIP. Two people on an UNCLAIMED domain
//      get two separate private workspaces, never a shared one.
//   5. auto_join_role IS VALIDATED, NOT TRUSTED. It comes from a row an org
//      admin controls; 'admin' or a typo must not become the created role.
//   6. SUSPENDED MEANS SUSPENDED, for existing members as well as new ones.
//   7. SEATS ARE A REAL LIMIT, not a label.
//
// Usage: node test/self-serve-signup-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.JWT_SECRET = 'test-secret-for-provisioning';
delete process.env.SELF_SERVE_SIGNUP;

const provisioning = require('../services/provisioning.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const ACME = { org_id: 'org-acme', domain: 'acme.com', verified_at: '2026-08-01T00:00:00Z', auto_join: true, auto_join_role: 'recruiter' };
const ACTIVE_ORG = { id: 'org-acme', status: 'active', seats_limit: null };

// ── 1. The switch ───────────────────────────────────────────────────────────
{
  ok('self-serve is OFF when the env var is unset', provisioning.selfServeEnabled({}) === false);
  ok('...OFF for "off"', provisioning.selfServeEnabled({ SELF_SERVE_SIGNUP: 'off' }) === false);
  ok('...OFF for "true" (only "on" counts)', provisioning.selfServeEnabled({ SELF_SERVE_SIGNUP: 'true' }) === false);
  ok('...OFF for "1"', provisioning.selfServeEnabled({ SELF_SERVE_SIGNUP: '1' }) === false);
  ok('...ON for "on"', provisioning.selfServeEnabled({ SELF_SERVE_SIGNUP: 'on' }) === true);
  ok('...ON for " ON " (trimmed, case-insensitive)', provisioning.selfServeEnabled({ SELF_SERVE_SIGNUP: ' ON ' }) === true);

  const off = provisioning.decide({ email: 'stranger@acme.com', user: null, claim: ACME, org: ACTIVE_ORG, selfServe: false });
  ok('with self-serve off, even a verified auto-join domain refuses', off.action === 'refuse' && off.reason === 'no_account', JSON.stringify(off));
  ok('...with the pre-existing "ask your administrator" wording', /ask your administrator/i.test(off.message));
}

// ── 2. An unverified claim proves nothing ───────────────────────────────────
{
  const unverified = { ...ACME, verified_at: null };
  const d = provisioning.decide({ email: 'victim@acme.com', user: null, claim: unverified, org: ACTIVE_ORG, selfServe: true });
  ok('an UNVERIFIED claim does not put anyone in that org', d.action === 'create_workspace', JSON.stringify(d));
  ok('...and is treated as an unclaimed domain', d.reason === 'unclaimed_domain');

  // The nastiest version: unverified claim, auto_join deliberately switched on.
  const armed = { ...ACME, verified_at: null, auto_join: true };
  const d2 = provisioning.decide({ email: 'victim@acme.com', user: null, claim: armed, org: ACTIVE_ORG, selfServe: true });
  ok('an unverified claim with auto_join ON still routes nobody', d2.action === 'create_workspace' && !d2.orgId, JSON.stringify(d2));
}

// ── 3. A verified claim has to opt in ───────────────────────────────────────
{
  const inviteOnly = { ...ACME, auto_join: false };
  const d = provisioning.decide({ email: 'new@acme.com', user: null, claim: inviteOnly, org: ACTIVE_ORG, selfServe: true });
  ok('verified but auto_join off → refused, not joined', d.action === 'refuse' && d.reason === 'invite_only', JSON.stringify(d));
  ok('...and the message names who to ask', /administrator/i.test(d.message) && /new@acme\.com/.test(d.message));

  const joined = provisioning.decide({ email: 'new@acme.com', user: null, claim: ACME, org: ACTIVE_ORG, selfServe: true });
  ok('verified + auto_join → joins that org', joined.action === 'join_org' && joined.orgId === 'org-acme', JSON.stringify(joined));
  ok('...with the role the claim specifies', joined.role === 'recruiter');
  ok('...for the right reason', joined.reason === 'verified_domain');
}

// ── 4. Sharing a domain is not membership ───────────────────────────────────
{
  const first = provisioning.decide({ email: 'alice@startup.io', user: null, claim: null, org: null, selfServe: true });
  const second = provisioning.decide({ email: 'bob@startup.io', user: null, claim: null, org: null, selfServe: true });
  ok('an unclaimed company domain gets a private workspace', first.action === 'create_workspace', JSON.stringify(first));
  ok('...and the SECOND person on it gets their own, not the first one\'s',
    second.action === 'create_workspace' && !second.orgId, JSON.stringify(second));
  ok('...as an admin of their own workspace', first.role === 'admin');

  const free = provisioning.decide({ email: 'someone@gmail.com', user: null, claim: null, org: null, selfServe: true });
  ok('a free-mail address gets a private workspace', free.action === 'create_workspace' && free.reason === 'free_mail', JSON.stringify(free));
}

// ── 5. auto_join_role is validated, not trusted ─────────────────────────────
{
  const escalate = { ...ACME, auto_join_role: 'admin' };
  const d = provisioning.decide({ email: 'new@acme.com', user: null, claim: escalate, org: ACTIVE_ORG, selfServe: true });
  ok('auto_join_role cannot mint an admin', d.action === 'join_org' && d.role !== 'admin', JSON.stringify(d));
  ok('...it falls back to the default join role', d.role === provisioning.DEFAULT_JOIN_ROLE);

  const typo = { ...ACME, auto_join_role: 'recruter' };
  ok('a typo in auto_join_role does not become the role',
    provisioning.decide({ email: 'n@acme.com', user: null, claim: typo, org: ACTIVE_ORG, selfServe: true }).role === provisioning.DEFAULT_JOIN_ROLE);

  const missing = { ...ACME, auto_join_role: null };
  ok('a null auto_join_role falls back too',
    provisioning.decide({ email: 'n@acme.com', user: null, claim: missing, org: ACTIVE_ORG, selfServe: true }).role === provisioning.DEFAULT_JOIN_ROLE);

  const legit = { ...ACME, auto_join_role: 'bd' };
  ok('a legitimate role IS honoured',
    provisioning.decide({ email: 'n@acme.com', user: null, claim: legit, org: ACTIVE_ORG, selfServe: true }).role === 'bd');
}

// ── 6. Suspended means suspended ────────────────────────────────────────────
{
  const suspended = { id: 'org-acme', status: 'suspended', seats_limit: null };
  const member = { id: 'u1', email: 'ada@acme.com', org_id: 'org-acme', role: 'bd' };

  const existing = provisioning.decide({ email: 'ada@acme.com', user: member, org: suspended, selfServe: false });
  ok('an EXISTING member of a suspended org is refused', existing.action === 'refuse' && existing.reason === 'org_suspended', JSON.stringify(existing));
  ok('...even with self-serve off (it is not a signup gate)', /suspended/i.test(existing.message));

  const joining = provisioning.decide({ email: 'new@acme.com', user: null, claim: ACME, org: suspended, selfServe: true });
  ok('a NEW person cannot join a suspended org', joining.action === 'refuse' && joining.reason === 'org_suspended', JSON.stringify(joining));

  const cancelled = provisioning.decide({ email: 'ada@acme.com', user: member, org: { id: 'o', status: 'cancelled' }, selfServe: false });
  ok('cancelled is refused the same way', cancelled.action === 'refuse' && cancelled.reason === 'org_suspended');

  const fine = provisioning.decide({ email: 'ada@acme.com', user: member, org: ACTIVE_ORG, selfServe: false });
  ok('an active org signs its members in as always', fine.action === 'sign_in' && fine.reason === 'existing_user');

  // Migration 038 not applied → no status column → org lookup returns null.
  const noOrgRow = provisioning.decide({ email: 'ada@acme.com', user: member, org: null, selfServe: false });
  ok('a missing organizations row does not lock existing users out', noOrgRow.action === 'sign_in', JSON.stringify(noOrgRow));
}

// ── 7. Seats ────────────────────────────────────────────────────────────────
{
  const capped = { id: 'org-acme', status: 'active', seats_limit: 5 };
  const full = provisioning.decide({ email: 'six@acme.com', user: null, claim: ACME, org: capped, seatsUsed: 5, selfServe: true });
  ok('a full plan refuses the next auto-join', full.action === 'refuse' && full.reason === 'seats_full', JSON.stringify(full));
  ok('...and says how many seats there are', /5/.test(full.message));

  const room = provisioning.decide({ email: 'five@acme.com', user: null, claim: ACME, org: capped, seatsUsed: 4, selfServe: true });
  ok('room on the plan still joins', room.action === 'join_org', JSON.stringify(room));

  const uncapped = provisioning.decide({ email: 'n@acme.com', user: null, claim: ACME, org: ACTIVE_ORG, seatsUsed: 9999, selfServe: true });
  ok('seats_limit null means unlimited', uncapped.action === 'join_org', JSON.stringify(uncapped));

  const overFull = provisioning.decide({ email: 'n@acme.com', user: null, claim: ACME, org: capped, seatsUsed: 12, selfServe: true });
  ok('already over the limit also refuses', overFull.reason === 'seats_full');
}

// ── 8. Garbage in ───────────────────────────────────────────────────────────
{
  ok('no email is refused', provisioning.decide({ email: '', selfServe: true }).reason === 'no_email');
  ok('a non-address is refused', provisioning.decide({ email: 'not-an-email', selfServe: true }).reason === 'no_email');
  ok('an empty call is refused, not thrown', provisioning.decide().action === 'refuse');
}

// ── 9. Names and slugs ──────────────────────────────────────────────────────
{
  ok('the provider\'s display name wins', provisioning.displayNameFor('a@b.com', 'Ada Lovelace') === 'Ada Lovelace');
  ok('...falling back to a readable local part',
    provisioning.displayNameFor('ada.lovelace@acme.com', '') === 'Ada Lovelace',
    provisioning.displayNameFor('ada.lovelace@acme.com', ''));
  ok('the workspace is named after them', provisioning.workspaceNameFor('a@b.com', 'Ada') === "Ada's workspace");

  const s1 = provisioning.workspaceSlug('alex@acme.com');
  const s2 = provisioning.workspaceSlug('alex@other.com');
  ok('slugs are url-safe', /^[a-z0-9-]+$/.test(s1), s1);
  ok('...and two identical local parts do NOT collide (slug is UNIQUE)', s1 !== s2, `${s1} vs ${s2}`);
  ok('a hostile local part cannot break the slug', /^[a-z0-9-]+$/.test(provisioning.workspaceSlug('a b/../<script>@x.com')));
}

// ── 10. The lookups degrade instead of throwing ─────────────────────────────
{
  const exploding = { from() { throw new Error('relation "org_domains" does not exist'); } };
  const claim = await provisioning.verifiedClaimFor(exploding, 'a@acme.com');
  ok('a missing org_domains table reads as "no claim"', claim === null);
  ok('a missing organizations row reads as null', (await provisioning.loadOrg(exploding, 'x')) === null);
  ok('seat counting survives a missing table', (await provisioning.seatsUsedIn(exploding, 'x')) === 0);

  // A free-mail domain must never even be looked up — no query, no chance that
  // a bad row in org_domains claims gmail.com.
  let queried = false;
  const spy = { from() { queried = true; throw new Error('should not be reached'); } };
  ok('gmail.com is never looked up as a claimable domain',
    (await provisioning.verifiedClaimFor(spy, 'someone@gmail.com')) === null && queried === false);
}

// ── 11. The race: two first sign-ins at once ────────────────────────────────
{
  // The loser of the race hits users' UNIQUE(email). That is not a failure —
  // the account now exists, so it must sign in rather than error.
  const existing = { id: 'u9', email: 'race@acme.com', org_id: 'org-9', role: 'admin', roles: ['admin'] };
  const deleted = [];
  const supabase = {
    from(table) {
      const chain = {
        _eq: {},
        insert() { return { select: () => ({ single: async () => ({ data: null, error: new Error('duplicate key value violates unique constraint "users_email_key"') }) }) }; },
        select() { return chain; },
        eq(c, v) { chain._eq[c] = v; return chain; },
        is() { return chain; },
        update() { return { eq: async () => ({}) }; },
        delete() { return { eq: async (c, v) => { deleted.push(v); return {}; } }; },
        maybeSingle: async () => ({ data: table === 'users' ? existing : null, error: null }),
        single: async () => ({ data: null, error: null }),
      };
      if (table === 'organizations') {
        chain.insert = () => ({ select: () => ({ single: async () => ({ data: { id: 'orphan-org' }, error: null }) }) });
      }
      return chain;
    },
  };
  const out = await provisioning.provision(supabase, { action: 'create_workspace', role: 'admin' }, { email: 'race@acme.com', name: 'Racer' });
  ok('losing the create race signs into the account that won', out.ok === true && out.user.id === 'u9', JSON.stringify(out));
  ok('...reporting that it did not create it', out.created === false);
  ok('...and cleaning up the organisation it had already made', deleted.includes('orphan-org'), JSON.stringify(deleted));
}

// ── 12. routeNewSignIn end-to-end, self-serve OFF ───────────────────────────
{
  let touched = false;
  const supabase = { from() { touched = true; throw new Error('no DB call expected'); } };
  const out = await provisioning.routeNewSignIn(supabase, { email: 'nobody@acme.com', name: 'N', selfServe: false });
  ok('with self-serve off, routing refuses without touching the database',
    out.ok === false && out.reason === 'no_account' && touched === false, JSON.stringify(out));
}

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '  ok  ' : '  FAIL'} ${r.name}${r.ok || !r.detail ? '' : `  → ${r.detail}`}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
