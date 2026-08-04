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
  // Added by migration 037 (conversation intelligence). Listed here ahead of the
  // migration being applied to the live DB, deliberately: the registry states
  // what the table IS, and the code that writes it degrades safely while the
  // table is still missing.
  'conversation_messages',
  'email_send_log',
  'email_templates',
  'email_tracking',
  'emails',
  'follow_ups',
  'job_orders',
  'jobs',
  'lead_sources',
  'match_scores',
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
  'gmail_tokens',      // reached only via user_emails, which IS org-scoped.
  'microsoft_tokens',  // same. See the note in models/index.js about this.
  'id_sequences',      // human-readable id counters
  'organizations',     // the tenant table itself
]);

const isTenantTable = (t) => TENANT_TABLES.has(t);
const isGlobalTable = (t) => GLOBAL_TABLES.has(t);
const isKnownTable = (t) => isTenantTable(t) || isGlobalTable(t);

module.exports = { TENANT_TABLES, GLOBAL_TABLES, isTenantTable, isGlobalTable, isKnownTable };
