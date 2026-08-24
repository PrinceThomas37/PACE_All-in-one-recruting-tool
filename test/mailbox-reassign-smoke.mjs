// Unit checks for mailbox-reassign.js — when a mailbox is deactivated, its
// still-open leads should move to another active, connected mailbox for the
// same user (or be reported as stranded if there isn't one).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { reassignJobsOffMailbox } = require('../services/mailbox-reassign.js');

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// Minimal fluent mock of the subset of the Supabase query builder this
// module actually uses: .select/.eq/.neq/.in/.is chains that resolve to
// {data,error} when awaited, and .update(patch).eq/.is that applies the
// patch to matching rows in the fake table.
function makeSupabase(tables) {
  function builder(tableName, mode, patch) {
    const filters = [];
    const api = {
      select: () => api,
      eq: (k, v) => { filters.push(r => r[k] === v); return api; },
      neq: (k, v) => { filters.push(r => r[k] !== v); return api; },
      in: (k, arr) => { filters.push(r => arr.includes(r[k])); return api; },
      is: (k, v) => { filters.push(r => (r[k] ?? null) === v); return api; },
      then: (resolve) => {
        const rows = (tables[tableName] || []).filter(r => filters.every(f => f(r)));
        if (mode === 'update') {
          rows.forEach(r => Object.assign(r, patch));
          return resolve({ error: null });
        }
        return resolve({ data: rows.map(r => ({ ...r })), error: null });
      },
    };
    return api;
  }
  return {
    from: (tableName) => ({
      select: () => builder(tableName, 'select'),
      update: (patch) => builder(tableName, 'update', patch),
    }),
  };
}

async function run() {
  // Case 1: mailbox A is being deactivated; user has an active, connected
  // fallback mailbox B (Gmail). Jobs on A should move to B.
  {
    const tables = {
      user_emails: [
        { id: 'A', user_id: 'u1', is_active: true, is_primary: false },
        { id: 'B', user_id: 'u1', is_active: true, is_primary: false },
      ],
      microsoft_tokens: [],
      gmail_tokens: [{ user_email_id: 'B', refresh_failed: false }],
      jobs: [
        { id: 'j1', sending_email_id: 'A', deleted_at: null },
        { id: 'j2', sending_email_id: 'A', deleted_at: null },
        { id: 'j3', sending_email_id: 'X', deleted_at: null }, // unrelated
      ],
    };
    const sb = makeSupabase(tables);
    const result = await reassignJobsOffMailbox(sb, 'A', 'u1');
    step('reassigns affected jobs to the working fallback mailbox',
      result.reassigned === 2 && result.fallback_email_id === 'B' && result.stranded === 0,
      JSON.stringify(result));
    step('jobs actually moved in the data', tables.jobs[0].sending_email_id === 'B' && tables.jobs[1].sending_email_id === 'B');
    step('unrelated job untouched', tables.jobs[2].sending_email_id === 'X');
  }

  // Case 2: no other active mailbox at all — nothing to reassign to.
  {
    const tables = {
      user_emails: [{ id: 'A', user_id: 'u1', is_active: true, is_primary: false }],
      microsoft_tokens: [], gmail_tokens: [],
      jobs: [{ id: 'j1', sending_email_id: 'A', deleted_at: null }],
    };
    const sb = makeSupabase(tables);
    const result = await reassignJobsOffMailbox(sb, 'A', 'u1');
    step('reports stranded when no fallback mailbox exists', result.reassigned === 0 && result.stranded === 1, JSON.stringify(result));
    step('job left untouched when stranded', tables.jobs[0].sending_email_id === 'A');
  }

  // Case 3: another mailbox exists but its token is broken (refresh_failed) —
  // must not be treated as a usable fallback.
  {
    const tables = {
      user_emails: [
        { id: 'A', user_id: 'u1', is_active: true, is_primary: false },
        { id: 'B', user_id: 'u1', is_active: true, is_primary: false },
      ],
      microsoft_tokens: [{ user_email_id: 'B', refresh_failed: true }],
      gmail_tokens: [],
      jobs: [{ id: 'j1', sending_email_id: 'A', deleted_at: null }],
    };
    const sb = makeSupabase(tables);
    const result = await reassignJobsOffMailbox(sb, 'A', 'u1');
    step('a mailbox with a broken token is not used as a fallback', result.stranded === 1 && result.reassigned === 0, JSON.stringify(result));
  }

  // Case 4: two candidate fallbacks — the primary one should be preferred.
  {
    const tables = {
      user_emails: [
        { id: 'A', user_id: 'u1', is_active: true, is_primary: false },
        { id: 'B', user_id: 'u1', is_active: true, is_primary: false },
        { id: 'C', user_id: 'u1', is_active: true, is_primary: true },
      ],
      microsoft_tokens: [{ user_email_id: 'B', refresh_failed: false }, { user_email_id: 'C', refresh_failed: false }],
      gmail_tokens: [],
      jobs: [{ id: 'j1', sending_email_id: 'A', deleted_at: null }],
    };
    const sb = makeSupabase(tables);
    const result = await reassignJobsOffMailbox(sb, 'A', 'u1');
    step('prefers the primary mailbox as fallback', result.fallback_email_id === 'C', JSON.stringify(result));
  }

  // Case 5: no jobs were on the mailbox at all — a true no-op.
  {
    const tables = {
      user_emails: [{ id: 'A', user_id: 'u1', is_active: true, is_primary: false }],
      microsoft_tokens: [], gmail_tokens: [], jobs: [],
    };
    const sb = makeSupabase(tables);
    const result = await reassignJobsOffMailbox(sb, 'A', 'u1');
    step('no-op when the mailbox has no jobs on it', result.reassigned === 0 && result.stranded === 0 && result.fallback_email_id === null);
  }

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

run();
