// ============================================================================
// The tenancy registry — which tables carry org_id and which do not.
//
// Verified against the LIVE database (project teiqievahzhllojvgsku), not
// inferred from the migration files: migration 022 created 33 tenant tables,
// but 024/027/034/035 added five more, so the migration list alone is already
// wrong. Read from information_schema, so this is what actually exists.
//
// This registry is what makes models/ able to fail loudly. A table that is in
// neither list is a typo; a tenant table reached without org intent is a
// scoping bug. Both throw instead of quietly returning the wrong rows.
//
// KEEP THIS IN SYNC: a migration that adds a table with org_id must add it to
// TENANT_TABLES. models/index.js can verify the registry against the live
// schema (verifyRegistry) if you ever want to check rather than trust.
// ============================================================================

// Every table with an org_id column. Queries against these MUST declare org
// intent — scoped to a request/org, or explicitly cross-org.
const TENANT_TABLES = new Set([
  'activity_log',
  'assignment_requests',
  'candidate_documents',
  'candidate_notes',
  'candidate_pipeline',
  'candidates',
  'client_documents',
  'companies',
  'contacts',
  // Added by migration 037 (conversation intelligence), applied 2026-08-05.
  'conversation_messages',
  'email_send_log',
  'email_templates',
  'email_tracking',
  'emails',
  'follow_ups',
  // Added by migration 039 (the isolation batch), applied 2026-08-05. These hold
  // OAuth refresh tokens for customers' real mailboxes, so they moved out of
  // GLOBAL_TABLES the moment a second tenant became possible. Reached today by
  // raw `supabase.from(...)` keyed on user_email_id, which is unaffected.
  'gmail_tokens',
  'job_orders',
  'jobs',
  'lead_sources',
  'match_scores',
  'microsoft_tokens',   // see gmail_tokens above — migration 039
  'recruiter_assignments',
  'recruiting_lookups',
  'reminders',
  'reports',
  'reviews',
  'sourced_jobs_raw',
  'sourcing_candidates',
  'submission_activity',
  'submissions',
  'suppression_list',
  'team_assignments',
  'user_emails',
  'users',
  'warmup_messages',
  'warmup_send_log',
  'warmup_threads',
  'workflow_definitions',
  'workflow_enrollments',
  'workflow_step_runs',
  'workflow_steps',
]);

// Tables with no org_id, and why — so nobody "fixes" one by adding it to the
// tenant list without thinking about what that would mean.
const GLOBAL_TABLES = new Set([
  'app_settings',      // platform configuration, not tenant data
  'domain_events',     // append-only event log; org lives inside the payload
  'engine_runs',       // scheduler bookkeeping — one scheduler per deployment
  'enrichment_cache',  // a shared cache of PUBLIC company data; scoping it per
                       // org would just make every org pay to re-fetch the same
                       // public facts. Deliberate.
  'id_sequences',      // human-readable id counters
  'organizations',     // the tenant table itself
  // org_domains HAS an org_id, but is listed here on purpose: sign-in looks it
  // up BY DOMAIN before any org context exists, so a request-scoped accessor
  // could never read it. It is reached via the raw client with an explicit
  // .eq('org_id', …) in the admin routes, and by domain (no org filter) in the
  // sign-in lookup — which is the one query that legitimately spans orgs.
  'org_domains',
]);

const isTenantTable = (t) => TENANT_TABLES.has(t);
const isGlobalTable = (t) => GLOBAL_TABLES.has(t);
const isKnownTable = (t) => isTenantTable(t) || isGlobalTable(t);

module.exports = { TENANT_TABLES, GLOBAL_TABLES, isTenantTable, isGlobalTable, isKnownTable };
