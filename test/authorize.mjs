// Unit test for middleware/authorize.js — verifies the extracted authorization
// helpers behave exactly as the previous inline implementations.
// Usage: node test/authorize.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const createAuthorize = require('../middleware/authorize.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// Minimal Supabase stub: from(...).select(...).eq(...).single() → { data }.
// Ignores filter values entirely — fine for the pre-existing tests below, which
// never need the row to depend on WHICH filters were applied. Kept as-is.
const mockSupabase = (jobRow) => ({
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: jobRow }) }) }) }),
});

// An org-aware stub: `.eq(col, val)` is recorded and `.single()` only returns
// the row if EVERY recorded filter matches the row's own fields — the same
// behaviour a real Postgres query has. Needed to prove the fix, because the
// bug being pinned here is specifically about what the QUERY FILTERS ON, not
// just what canTouchJob does with a row it was handed.
const mockSupabaseOrgAware = (jobRow) => ({
  from: () => {
    const filters = {};
    const chain = {
      select: () => chain,
      eq: (col, val) => { filters[col] = val; return chain; },
      single: async () => {
        if (!jobRow) return { data: null };
        for (const [col, val] of Object.entries(filters)) {
          if (jobRow[col] !== val) return { data: null };
        }
        return { data: jobRow };
      },
    };
    return chain;
  },
});

const req = (user) => ({ user });

// hasRole
{
  const { hasRole } = createAuthorize({ supabase: mockSupabase(null) });
  ok('hasRole: no user → false', hasRole(req(null), 'admin') === false);
  ok('hasRole: roles array match', hasRole(req({ roles: ['bd', 'ra'] }), 'ra') === true);
  ok('hasRole: roles array no match', hasRole(req({ roles: ['ra'] }), 'admin') === false);
  ok('hasRole: legacy single role match', hasRole(req({ role: 'admin' }), 'admin', 'bd') === true);
  ok('hasRole: legacy single role no match', hasRole(req({ role: 'ra' }), 'admin') === false);
}

// There is no guest guard any more, and that is the assertion: the "guest"
// token used to grant read-only access to the DEFAULT org — a real customer's
// live data — and both the door and the notGuest guard that softened it are
// gone. A helper that no longer exists cannot be reintroduced by accident
// without this failing.
{
  const helpers = createAuthorize({ supabase: mockSupabase(null) });
  ok('notGuest no longer exists', helpers.notGuest === undefined);
  ok('the surviving helpers are hasRole / canTouchJob / requireRole',
    Object.keys(helpers).sort().join(',') === 'canTouchJob,hasRole,requireRole',
    Object.keys(helpers).sort().join(','));
}

// requireRole middleware
{
  const { requireRole } = createAuthorize({ supabase: mockSupabase(null) });
  let nextCalled = false, sent = null;
  const res = { status: (c) => ({ json: (b) => { sent = { c, b }; } }) };
  requireRole('admin')(req({ roles: ['admin'] }), res, () => { nextCalled = true; });
  ok('requireRole: allowed → next()', nextCalled === true && sent === null);
  nextCalled = false; sent = null;
  requireRole('admin')(req({ roles: ['ra'] }), res, () => { nextCalled = true; });
  ok('requireRole: denied → 403, no next', nextCalled === false && sent && sent.c === 403);
}

// canTouchJob
//
// The defect this whole block is guarding: the admin bypass used to return
// true BEFORE the row was ever read, so an admin of company B could touch any
// job in company A just by pasting its id. The fix reads the row first (with
// req.orgId applied as a filter when present) and only THEN applies the admin
// bypass — so every assertion below drives the query through the org-aware
// stub, never the row-only one, because the class of bug is "authorised before
// confirming the row belongs to the caller's org", not "returned the wrong
// boolean for a row it already had".
{
  const admin = req({ id: 'a', roles: ['admin'] });
  admin.orgId = 'org-A'; // canTouchJob reads req.orgId, not req.user.orgId

  const mk = (row) => createAuthorize({ supabase: mockSupabaseOrgAware(row) }).canTouchJob;

  // No such job at all (id doesn't match under any admin's own org filter).
  ok('canTouchJob: admin, no such job → false', (await mk(null)(admin, 'j1')) === false);

  // The row exists, but the ADMIN'S OWN QUERY excludes it because it belongs
  // to a different org — this is the exact shape of the original defect:
  // before the fix, this same call returned true without ever looking at
  // org_id. If canTouchJob regresses to "admin bypasses before the org filter
  // is applied", this is the assertion that goes red.
  ok('canTouchJob: admin, job in ANOTHER org → false',
    (await mk({ id: 'j', created_by: 'x', assigned_to: 'y', assigned_to_bd: 'z', org_id: 'org-B' })(admin, 'j')) === false);

  // The row exists and belongs to the admin's own org — the bypass must still
  // work; the fix is not just a blanket denial.
  ok('canTouchJob: admin, job in own org → true',
    (await mk({ id: 'j', created_by: 'x', assigned_to: 'y', assigned_to_bd: 'z', org_id: 'org-A' })(admin, 'j')) === true);

  // No req.orgId here deliberately — mockSupabase (unlike mockSupabaseOrgAware)
  // only supports a single .eq() in its chain, matching what these pre-existing
  // assertions always exercised. The org-filtered behaviour is covered above.
  const owner = req({ id: 'u1', roles: ['bd'] });
  const mkPlain = (row) => createAuthorize({ supabase: mockSupabase(row) }).canTouchJob;
  ok('canTouchJob: created_by owner → true', (await mkPlain({ created_by: 'u1', assigned_to: 'x', assigned_to_bd: 'y' })(owner, 'j')) === true);
  ok('canTouchJob: assigned_to → true', (await mkPlain({ created_by: 'x', assigned_to: 'u1', assigned_to_bd: 'y' })(owner, 'j')) === true);
  ok('canTouchJob: assigned_to_bd → true', (await mkPlain({ created_by: 'x', assigned_to: 'y', assigned_to_bd: 'u1' })(owner, 'j')) === true);
  ok('canTouchJob: unrelated → false', (await mkPlain({ created_by: 'x', assigned_to: 'y', assigned_to_bd: 'z' })(owner, 'j')) === false);
  ok('canTouchJob: no job row → false', (await mkPlain(null)(owner, 'j')) === false);
}

console.log('\n=== AUTHORIZE TEST ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
