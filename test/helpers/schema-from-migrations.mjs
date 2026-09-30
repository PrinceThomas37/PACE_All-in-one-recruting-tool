// THE SCHEMA, FOLDED OUT OF migrations/*.sql — never typed by hand.
//
// WHY THIS EXISTS (R-076). routes/apply.js selected `job_orders.owner_id`, a
// column that table has never had. PostgREST refuses the WHOLE query for one
// unknown name (42703), `data` came back null exactly as it does for a clean
// miss, and every apply link answered "This role is no longer open" for a week —
// while test/apply-page-smoke.mjs stayed 67/67 green, because its fake threw the
// select list away and handed back whole rows. A fake that does not know the
// schema cannot fail on a name the schema lacks.
//
// This folds every migration, in filename order, into `table -> Set(column)`:
//   * CREATE TABLE bodies (constraint lines are not columns);
//   * ALTER TABLE ... ADD [COLUMN] / DROP COLUMN / RENAME COLUMN, including the
//     comma-separated multi-clause form (`ADD COLUMN a int, ADD COLUMN b int`);
//   * DO $$ loops that add a column to every table in an array — migration 022
//     gives 33 tables their org_id that way, in one FOREACH over ARRAY[...].
//     Only a block that really ADDS the column counts: 039's loops over an
//     ARRAY[...] to switch row-level security on, and must not hand `org_id` to
//     `app_settings`.
//
// KNOWN LIMIT — say it, do not hide it: tables that predate migrations/ (users,
// jobs, companies, contacts, emails, app_settings...) are only PARTLY known. A
// caller must therefore validate only the tables whose whole DDL is in the
// folder — `isComplete(table)` is the honest question, not `has(table)`. The
// three the apply page touches (job_orders, sourcing_candidates, candidates) are.
//
// Pure: reads files, no database, no clock.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(HERE, '../../migrations');

const norm = (s) => String(s).replace(/^public\./i, '').replace(/"/g, '').trim().toLowerCase();

// Split on commas that are not inside parentheses.
function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const NOT_COLUMNS = /^(primary|unique|foreign|constraint|check|like|exclude)\b/i;

/**
 * Fold a directory of .sql files. `dir` may be any directory (the tests build
 * synthetic ones to prove each construct is understood).
 * Returns { cols: {table: Set}, created: Set, dropped: [[table, col, file]], files }.
 */
export function foldMigrations(dir = MIGRATIONS_DIR) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const cols = {}, created = new Set(), dropped = [];
  const add = (t, c) => { t = norm(t); (cols[t] = cols[t] || new Set()).add(norm(c)); };
  const drop = (t, c, f) => { t = norm(t); if (cols[t]) cols[t].delete(norm(c)); dropped.push([t, norm(c), f]); };

  for (const f of files) {
    let sql = fs.readFileSync(path.join(dir, f), 'utf8');
    sql = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

    // CREATE TABLE [IF NOT EXISTS] name ( body )
    const reC = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi;
    let m;
    while ((m = reC.exec(sql))) {
      let i = reC.lastIndex, depth = 1, body = '';
      while (i < sql.length && depth > 0) {
        const ch = sql[i++];
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (depth === 0) break; }
        body += ch;
      }
      created.add(norm(m[1]));
      (cols[norm(m[1])] = cols[norm(m[1])] || new Set());
      for (const item of splitTop(body)) {
        const t = item.trim();
        if (!t || NOT_COLUMNS.test(t)) continue;
        const mm = t.match(/^"?([a-z_]\w*)"?\s+/i);
        if (mm) add(m[1], mm[1]);
      }
    }

    // ALTER TABLE name <clause>[, <clause>...] ;
    const reA = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+([\s\S]*?);/gi;
    while ((m = reA.exec(sql))) {
      if (/%[IiSs]/.test(m[1])) continue;                 // a format() template, handled below
      for (const clause of splitTop(m[2])) {
        const c = clause.trim();
        let x;
        if ((x = c.match(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_]\w*)"?\s+/i))
            && !/^add\s+(constraint|primary|unique|foreign|check|exclude)\b/i.test(c)) add(m[1], x[1]);
        else if ((x = c.match(/^drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_]\w*)"?/i))) drop(m[1], x[1], f);
        else if ((x = c.match(/^rename\s+column\s+"?([a-z_]\w*)"?\s+to\s+"?([a-z_]\w*)"?/i))) { drop(m[1], x[1], f); add(m[1], x[2]); }
      }
    }

    // DO $$ ... $$ blocks that loop over an array of tables and ADD a column to
    // each through EXECUTE format('ALTER TABLE public.%I ADD COLUMN ...', t).
    const reD = /do\s+\$\$([\s\S]*?)\$\$/gi;
    while ((m = reD.exec(sql))) {
      const block = m[1];
      if (!/foreach\s+\w+\s+in\s+array/i.test(block)) continue;
      const tables = [];
      const arr = /array\s*\[([\s\S]*?)\]/i.exec(block);
      if (arr) (arr[1].match(/'([\w."]+)'/g) || []).forEach(q => tables.push(q.replace(/'/g, '')));
      // (`ADD CONSTRAINT ...` is not a column: without the lookahead the optional
      // COLUMN keyword let "constraint" through as a column name on 33 tables.)
      const reE = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?[\w."]*%[IiSs]\s+add\s+(?!(?:constraint|primary|unique|foreign|check|exclude)\b)(?:column\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_]\w*)"?\s+/gi;
      let e;
      while ((e = reE.exec(block))) tables.forEach(t => add(t, e[1]));
    }
  }
  return { cols, created, dropped, files };
}

let cached = null;
/** The folded schema of this repository's migrations (read once). */
export function loadSchema() {
  if (!cached) cached = wrap(foldMigrations(MIGRATIONS_DIR));
  return cached;
}

/** Wrap a fold in the small API the fakes use. */
export function wrap(fold) {
  return {
    ...fold,
    has: (t) => Object.prototype.hasOwnProperty.call(fold.cols, norm(t)),
    columns: (t) => fold.cols[norm(t)] || new Set(),
    /** Names in `names` that this table does not have. `*` is never unknown. */
    unknown: (t, names) => {
      const have = fold.cols[norm(t)];
      if (!have) return [];
      return [...new Set(names)].filter(n => n && n !== '*' && !have.has(n));
    },
    /** True when the table's CREATE TABLE is in the folder, i.e. its columns are all known. */
    isComplete: (t) => fold.created.has(norm(t)),
  };
}
