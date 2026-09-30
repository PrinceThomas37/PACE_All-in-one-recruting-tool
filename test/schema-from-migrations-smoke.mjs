// THE SCHEMA FOLDER (test/helpers/schema-from-migrations.mjs) — a guard for a guard.
//
// The apply-page fake answers PostgREST's 42703 for any column the schema lacks,
// and "the schema" is whatever this helper folds out of migrations/*.sql. If the
// fold is wrong in the GENEROUS direction (a column that does not exist is
// reported as existing) then the R-076 bug — `job_orders.owner_id` — sails
// through the fake exactly as it sailed through the old one. So the fold is
// pinned here on its own, on every construct it must understand, and against a
// second, independent source of truth (models/tables.js, verified against the
// live database).
//
// Two halves:
//   1. SYNTHETIC migrations, one construct at a time — so a construct the fold
//      stops understanding fails by NAME, not as "the apply page suite is red".
//   2. THIS repository's migrations — the facts the apply-page suite leans on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { foldMigrations, loadSchema, wrap } from './helpers/schema-from-migrations.mjs';
const require = createRequire(import.meta.url);

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const has = (s, t, c) => s.columns(t).has(c);
const list = (s, t) => [...s.columns(t)].sort().join(',');

// ── 1. synthetic migrations ────────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-migr-'));
const put = (name, sql) => fs.writeFileSync(path.join(dir, name), sql);
try {
  put('001_create.sql', `
    -- a line comment mentioning ADD COLUMN ghost_line text;
    /* a block comment:  ALTER TABLE widgets ADD COLUMN ghost_block text; */
    CREATE TABLE IF NOT EXISTS public.widgets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      price numeric(10,2) DEFAULT 0,
      kind text CHECK (kind IN ('a','b','c')),
      owner uuid REFERENCES users(id) ON DELETE SET NULL,
      "order" int,
      created_at timestamptz DEFAULT now(),
      CONSTRAINT widgets_name_kind UNIQUE (name, kind),
      PRIMARY KEY (id),
      UNIQUE (price, "order"),
      EXCLUDE USING gist (kind WITH =, during WITH &&),
      CHECK (price >= 0)
    );
    CREATE TABLE gadgets (id serial, label text);
  `);
  put('002_alter.sql', `
    ALTER TABLE widgets ADD COLUMN IF NOT EXISTS color text;
    ALTER TABLE widgets ADD COLUMN IF NOT EXISTS notes text;
    -- multi-clause: two ADDs (one with a parenthesised default holding a comma), one that is NOT a column
    ALTER TABLE public.widgets
      ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '{}'::jsonb,
      ADD COLUMN size numeric(6,2) DEFAULT (1 + 2),
      ADD CONSTRAINT widgets_size_pos CHECK (size > 0),
      ALTER COLUMN name SET DEFAULT 'x';
    ALTER TABLE gadgets ADD bare_add int;
    ALTER TABLE gadgets ADD COLUMN scratch text;
    ALTER TABLE gadgets ADD PRIMARY KEY (id);
    -- a table that only ever gets ALTERed: its CREATE predates the folder, so its columns are only PARTLY known
    ALTER TABLE legacy_base ADD COLUMN IF NOT EXISTS extra int;
  `);
  put('003_drop_rename.sql', `
    ALTER TABLE widgets DROP COLUMN IF EXISTS color;
    ALTER TABLE widgets RENAME COLUMN owner TO owner_user;
    ALTER TABLE gadgets DROP COLUMN label;
    ALTER TABLE gadgets DROP COLUMN scratch, ADD COLUMN caption text;
  `);
  put('004_do_loops.sql', `
    DO $$
    DECLARE t text; tenant_tables text[] := ARRAY['widgets','gadgets'];
    BEGIN
      FOREACH t IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS org_id uuid', t);
        BEGIN
          EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES organizations(id)', t, t||'_org_fk');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
      END LOOP;
    END $$;
    -- A DIFFERENT loop over a DIFFERENT array: it switches row-level security on and adds NO column.
    DO $$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY['settings_like','ledger_like'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      END LOOP;
    END $$;
    CREATE TABLE settings_like (id int, k text);
  `);
  put('005_later_wins.sql', `ALTER TABLE widgets RENAME COLUMN owner_user TO owner_final;`);

  const f = wrap(foldMigrations(dir));
  step('CREATE TABLE: plain columns are read (and IF NOT EXISTS / public. are understood)',
    ['id', 'name', 'price', 'kind', 'created_at'].every(c => has(f, 'widgets', c)), list(f, 'widgets'));
  step('CREATE TABLE: a comma inside parentheses (numeric(10,2); an EXCLUDE (kind WITH =, during WITH &&) list) splits nothing — `during` is not a column',
    has(f, 'widgets', 'price') && !has(f, 'widgets', 'during') && !has(f, 'widgets', '2)'), list(f, 'widgets'));
  step('CREATE TABLE: a CHECK (... IN (...)) on a column does not invent columns',
    has(f, 'widgets', 'kind') && !has(f, 'widgets', "'b'") && !has(f, 'widgets', 'b'), list(f, 'widgets'));
  step('CREATE TABLE: a quoted column ("order") is a column',
    has(f, 'widgets', 'order'));
  step('CREATE TABLE: CONSTRAINT / PRIMARY KEY / UNIQUE / CHECK lines are not columns',
    !has(f, 'widgets', 'constraint') && !has(f, 'widgets', 'primary') && !has(f, 'widgets', 'unique') && !has(f, 'widgets', 'check'), list(f, 'widgets'));
  step('CREATE TABLE: the table is recorded as COMPLETE (its whole DDL is in the folder)', f.isComplete('widgets') && f.isComplete('gadgets'));
  step('a table the folder never CREATEd is not "complete" — validating it would flag real columns',
    !f.isComplete('users') && !f.has('users'));
  step('…and one that is only ever ALTERed is known but NOT complete (its CREATE predates migrations/, so most of its columns are invisible)',
    f.has('legacy_base') && has(f, 'legacy_base', 'extra') && !f.isComplete('legacy_base'));

  step('a commented-out ADD COLUMN (line comment) is not a column', !has(f, 'widgets', 'ghost_line'));
  step('a commented-out ADD COLUMN (block comment) is not a column', !has(f, 'widgets', 'ghost_block'));

  step('ALTER TABLE ... ADD COLUMN IF NOT EXISTS (single clause) adds the column', has(f, 'widgets', 'notes'), list(f, 'widgets'));
  step('ALTER TABLE multi-clause: BOTH comma-separated ADDs land (tags AND size)', has(f, 'widgets', 'tags') && has(f, 'widgets', 'size'), list(f, 'widgets'));
  step('ALTER TABLE multi-clause: a default holding a comma or parentheses does not break the split',
    !has(f, 'widgets', '{}') && !has(f, 'widgets', '2)') && !has(f, 'widgets', 'size_pos'), list(f, 'widgets'));
  step('ALTER TABLE: ADD CONSTRAINT and ALTER COLUMN are not columns',
    !has(f, 'widgets', 'constraint') && !has(f, 'widgets', 'widgets_size_pos') && !has(f, 'widgets', 'column'), list(f, 'widgets'));
  step('ALTER TABLE: ADD without the COLUMN keyword is a column; ADD PRIMARY KEY is not', has(f, 'gadgets', 'bare_add') && !has(f, 'gadgets', 'primary'), list(f, 'gadgets'));

  step('DROP COLUMN removes the column (a later migration undoes an earlier one)', !has(f, 'widgets', 'color'), list(f, 'widgets'));
  step('RENAME COLUMN: the old name is gone and the new one is there (owner -> owner_user -> owner_final)',
    !has(f, 'widgets', 'owner') && has(f, 'widgets', 'owner_final'), list(f, 'widgets'));
  step('a multi-clause ALTER can DROP one column and ADD another in the same statement (DROP COLUMN scratch, ADD COLUMN caption)',
    !has(f, 'gadgets', 'scratch') && has(f, 'gadgets', 'caption'), list(f, 'gadgets'));
  step('files fold in FILENAME order: owner is renamed to owner_user in 003 and on to owner_final in 005, so ONLY owner_final is left',
    has(f, 'widgets', 'owner_final') && !has(f, 'widgets', 'owner_user') && !has(f, 'widgets', 'owner'), list(f, 'widgets'));
  step('the drop of gadgets.label is recorded with the file that made it',
    f.dropped.some(([t, c, file]) => t === 'gadgets' && c === 'label' && file === '003_drop_rename.sql'), JSON.stringify(f.dropped));

  step('DO-loop: `FOREACH t IN ARRAY <array>` + EXECUTE format(... ADD COLUMN ... %I) adds the column to EVERY table in the array',
    has(f, 'widgets', 'org_id') && has(f, 'gadgets', 'org_id'), list(f, 'gadgets'));
  step('DO-loop: `ADD CONSTRAINT` inside the loop does NOT add a column called "constraint"',
    !has(f, 'widgets', 'constraint') && !has(f, 'gadgets', 'constraint'));
  step('DO-loop: a loop that only ENABLES row-level security adds nothing (it lists tables but adds no column)',
    !has(f, 'settings_like', 'org_id') && !f.has('ledger_like'), list(f, 'settings_like'));

  step('unknown(): names a table lacks are returned; `*` and known names are not',
    JSON.stringify(f.unknown('widgets', ['id', '*', 'nope', 'name', 'nope', 'also_nope'])) === '["nope","also_nope"]');
  step('unknown(): a table the fold has never heard of answers [] (nothing to validate against), never "everything is unknown"',
    f.unknown('users', ['id', 'anything']).length === 0);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

// ── 2. THIS repository ─────────────────────────────────────────────────────
const real = loadSchema();
const need = {
  job_orders: ['id', 'org_id', 'job_code', 'job_title', 'client', 'end_client', 'status', 'apply_token', 'apply_enabled', 'apply_count',
    'bd_manager_id', 'created_by', 'posting_description', 'job_description', 'primary_skills', 'exp_min', 'exp_max', 'deleted_at'],
  sourcing_candidates: ['id', 'org_id', 'provider', 'external_id', 'full_name', 'email', 'phone', 'location', 'current_title',
    'current_employer', 'skills', 'experience_years', 'resume_url', 'status', 'dup_candidate_id', 'created_by', 'raw'],
  candidates: ['id', 'org_id', 'email', 'deleted_at', 'owner_id', 'full_name'],
};
for (const [t, cs] of Object.entries(need)) {
  const miss = cs.filter(c => !has(real, t, c));
  step(`the real ${t} carries every column the apply page and its tests rely on`, miss.length === 0, 'missing: ' + miss.join(','));
}
step('the three tables the apply page touches are COMPLETE in the folder (so validating them cannot false-alarm)',
  ['job_orders', 'sourcing_candidates', 'candidates'].every(t => real.isComplete(t)));
// THE R-076 FACT. If a migration ever really adds job_orders.owner_id, this fails
// on purpose: apply-page-smoke's historic-bug tripwire must then point at another
// name, or it stops proving anything.
step('THE R-076 FACT: job_orders has NO owner_id (that name lives on candidates; a job order\'s owner is bd_manager_id)',
  !has(real, 'job_orders', 'owner_id') && has(real, 'candidates', 'owner_id') && has(real, 'job_orders', 'bd_manager_id'),
  'if a migration really added job_orders.owner_id, retarget the tripwire in apply-page-smoke.mjs');
step('no table anywhere folds a column called "constraint" (the DO-loop lookahead)',
  !Object.keys(real.cols).some(t => real.cols[t].has('constraint')));

// A second, independent source: models/tables.js is verified against the LIVE
// database. Every tenant table it lists must fold to having org_id; no global
// table may (org_domains is the one documented exception: it has one, and is
// listed global on purpose because sign-in reads it before any org exists).
const { TENANT_TABLES, GLOBAL_TABLES } = require('../models/tables.js');
const tenantNoOrg = [...TENANT_TABLES].filter(t => !real.has(t) || !has(real, t, 'org_id'));
step('models/tables.js agrees: every TENANT table folds to having an org_id (migration 022\'s loop, and the later ones)',
  tenantNoOrg.length === 0, 'without org_id: ' + tenantNoOrg.join(','));
const globalWithOrg = [...GLOBAL_TABLES].filter(t => real.has(t) && has(real, t, 'org_id') && t !== 'org_domains');
step('models/tables.js agrees: no GLOBAL table folds to having an org_id (039\'s RLS loop must not hand it out)',
  globalWithOrg.length === 0, 'wrongly have org_id: ' + globalWithOrg.join(','));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
