// ============================================================================
// The data-access layer — org scoping you cannot forget.
//
// WHY THIS EXISTS
// There are ~574 raw `supabase.from(...)` calls across 31 files. Org scoping is
// applied by remembering to wrap each one in `withOrg()`. In a single session
// FOUR cross-org leaks were found, every one the same shape: a hand-written
// query that forgot the wrapper. The shared in-memory jobs cache was worse —
// one cache for every org, so org #2 would have seen org #1's entire lead list.
//
// Reviewing 574 call sites for a missing `.eq('org_id', …)` does not scale, and
// the failure is SILENT: a forgotten filter returns more rows, never an error.
// So the fix is structural rather than diligent — through this layer you cannot
// build a query against a tenant table without saying which org it is for:
//
//     db.forRequest(req).from('candidates').select('*')   // scoped, always
//     db.global.from('app_settings').select('*')          // no org_id column
//     db.crossOrg('candidates').select('*')               // deliberate, named
//
// Anything else throws. Getting it wrong is now a startup/test-time error
// instead of a data leak nobody notices.
//
// WHAT IT IS NOT
// Not an ORM. Every method returns the real Supabase query builder, so all the
// existing chaining (.eq/.in/.order/.limit/.single/.maybeSingle/joins) keeps
// working unchanged. That is what makes migrating call sites mechanical and
// low-risk — the only thing that changes is where the builder comes from.
//
// TRANSITIONAL SEMANTICS (matches the withOrg() it replaces)
// When no org can be resolved, scoping is a no-op rather than an error. Every
// org_id column has a DEFAULT of the platform's default org, so single-tenant
// behaviour is preserved exactly. Tighten this once a second org is onboarded.
//
// KNOWN GAP, recorded not fixed: microsoft_tokens and gmail_tokens have no
// org_id. They are only ever reached via user_emails (which is org-scoped), so
// this is not a live leak — but it is the thing to close before onboarding a
// second org, alongside RLS (growth bet 1, slice 3b).
// ============================================================================

const { isTenantTable, isGlobalTable, isKnownTable, TENANT_TABLES } = require('./tables');

class TenancyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenancyError';
  }
}

function assertKnown(table) {
  if (!isKnownTable(table)) {
    throw new TenancyError(
      `Unknown table "${table}". Add it to models/tables.js — TENANT_TABLES if it ` +
      `has an org_id column, GLOBAL_TABLES if it deliberately does not.`
    );
  }
}

function createDb(supabase) {
  if (!supabase) throw new TenancyError('createDb(supabase) requires a Supabase client');

  // ── The scoped accessor ────────────────────────────────────────────────────
  // Reads and mutations get `.eq('org_id', orgId)`; inserts/upserts get org_id
  // stamped onto every row. orgId === null keeps the transitional no-op.
  function accessorFor(orgId, { allowGlobal = false, label = 'scoped' } = {}) {
    return {
      orgId,
      from(table) {
        assertKnown(table);
        if (isGlobalTable(table) && !allowGlobal) {
          throw new TenancyError(
            `"${table}" has no org_id column — use db.global.from('${table}') instead of a ${label} accessor.`
          );
        }
        const scope = isTenantTable(table) && orgId != null;
        const base = () => supabase.from(table);

        // Stamp org_id onto a row (or every row of an array), without ever
        // overwriting one a caller set deliberately.
        const stamp = (rows) => {
          if (!scope) return rows;
          const one = (r) => (r && typeof r === 'object' && r.org_id === undefined ? { ...r, org_id: orgId } : r);
          return Array.isArray(rows) ? rows.map(one) : one(rows);
        };
        const filter = (q) => (scope ? q.eq('org_id', orgId) : q);

        return {
          // `.eq('org_id')` must come AFTER `.select()`, so it is applied here
          // and the caller keeps chaining onto a normal builder.
          select: (cols = '*', opts) => filter(opts ? base().select(cols, opts) : base().select(cols)),
          insert: (rows, opts) => (opts ? base().insert(stamp(rows), opts) : base().insert(stamp(rows))),
          upsert: (rows, opts) => (opts ? base().upsert(stamp(rows), opts) : base().upsert(stamp(rows))),
          update: (patch, opts) => filter(opts ? base().update(patch, opts) : base().update(patch)),
          delete: (opts) => filter(opts ? base().delete(opts) : base().delete()),

          // Convenience for the single-record long tail — the shape behind
          // several past leaks, where a cross-org id returned the record
          // instead of a 404. Resolves to null when the row is another org's.
          async byId(id, cols = '*', idColumn = 'id') {
            const { data, error } = await filter(base().select(cols)).eq(idColumn, id).maybeSingle();
            if (error) throw error;
            return data || null;
          },
        };
      },
    };
  }

  const db = {
    /** Scope every query to the caller's org. The default for request handlers. */
    forRequest(req) {
      const orgId = (req && (req.orgId || (req.user && req.user.org_id))) || null;
      return accessorFor(orgId, { label: 'request-scoped' });
    },

    /** Scope to an explicit org — for background jobs, which have no request. */
    forOrg(orgId) {
      return accessorFor(orgId || null, { label: 'org-scoped' });
    },

    /** Tables with no org_id. Throws if used on a tenant table. */
    global: {
      from(table) {
        assertKnown(table);
        if (isTenantTable(table)) {
          throw new TenancyError(
            `"${table}" is tenant data — use db.forRequest(req).from('${table}'), ` +
            `or db.crossOrg('${table}') if you genuinely mean every org.`
          );
        }
        return supabase.from(table);
      },
    },

    /**
     * Deliberately unscoped access to a tenant table. Named so it is visible in
     * review and greppable — legitimate for platform-wide background sweeps
     * (e.g. the send loop walking every org's queue).
     */
    crossOrg(table) {
      assertKnown(table);
      return supabase.from(table);
    },

    /** The raw client, for the few things this layer does not model (rpc, storage). */
    raw: supabase,

    /**
     * Check the registry against the live schema. Not called at boot — it costs
     * a query and the app must start without the DB. Use it from a test or a
     * one-off script after a migration.
     */
    async verifyRegistry() {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id'",
      }).catch(() => ({ data: null, error: new Error('no exec_sql rpc') }));
      if (error || !data) return { checked: false, reason: 'schema introspection unavailable' };
      const live = new Set(data.map((r) => r.table_name));
      return {
        checked: true,
        missingFromRegistry: [...live].filter((t) => !TENANT_TABLES.has(t)),
        staleInRegistry: [...TENANT_TABLES].filter((t) => !live.has(t)),
      };
    },
  };

  return db;
}

module.exports = { createDb, TenancyError };
