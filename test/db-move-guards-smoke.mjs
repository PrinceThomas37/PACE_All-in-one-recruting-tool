// The database-move tool (R-292, D-0166) must be unable to hurt the live database or leak data, however it is run.
// Pinned: it refuses to run when the "old" secret is not the real project, when old and new are the same, when the new one is
// not in Ohio, when a final copy has not been confirmed, when given a connection string it cannot read; the workflow can only be
// started by hand, uploads nothing (the repository and its logs are public), and the script never writes to the OLD database.
//
// Usage: node test/db-move-guards-smoke.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };

const script = path.join(root, 'scripts/db-move/db-move.sh');
const OLD = 'postgresql://postgres.teiqievahzhllojvgsku:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
const NEW = 'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres';
const run = (mode, env) => {
  const r = spawnSync('bash', [script, mode], { env: { PATH: process.env.PATH, SRC_SERVICE_KEY: 'x', DST_SERVICE_KEY: 'y', LOG_DIR: fs.mkdtempSync('/tmp/dbmove-'), ...env }, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

ok('the script parses', (() => { try { execFileSync('bash', ['-n', script]); return true; } catch (_) { return false; } })());
let r = run('rehearsal', { SRC_DB_URL: OLD, DST_DB_URL: OLD });
ok('old and new being the SAME project is refused', r.code === 2 && /same project/.test(r.out), r.out);
r = run('rehearsal', { SRC_DB_URL: OLD, DST_DB_URL: 'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' });
ok('a new database that is not in US East (Ohio) is refused', r.code === 2 && /not in US East/.test(r.out), r.out);
r = run('rehearsal', { SRC_DB_URL: NEW, DST_DB_URL: OLD });
ok('an "old" secret that is not the real project is refused (copying the wrong way round can never start)', r.code === 2 && /expected teiqievahzhllojvgsku/.test(r.out), r.out);
r = run('final', { SRC_DB_URL: OLD, DST_DB_URL: NEW });
ok('the FINAL copy is refused until it is confirmed that sending is stopped', r.code === 2 && /CONFIRM_STOPPED/.test(r.out), r.out);
r = run('final', { SRC_DB_URL: OLD, DST_DB_URL: NEW, CONFIRM_STOPPED: 'maybe' });
ok('…and only the exact word YES confirms it', r.code === 2 && /CONFIRM_STOPPED/.test(r.out), r.out);
r = run('rehearsal', { SRC_DB_URL: 'postgresql://postgres:pw@db.teiqievahzhllojvgsku.supabase.co:5432/postgres', DST_DB_URL: NEW });
ok('a connection string it cannot read the project from is refused with a plain instruction', r.code === 2 && /Session pooler/.test(r.out), r.out);
r = run('bogus', { SRC_DB_URL: OLD, DST_DB_URL: NEW });
ok('an unknown mode is refused', r.code === 2 && /Usage/.test(r.out), r.out);
r = run('rehearsal', { SRC_DB_URL: OLD });
ok('a missing secret is named', r.code === 2 && /Missing secret DST_DB_URL/.test(r.out), r.out);

const src = fs.readFileSync(script, 'utf8');
const writesToOld = src.split('\n').filter((l) => /\$SRC_DB_URL/.test(l) && /\b(insert|update|delete|drop|truncate|create|alter|pg_restore)\b/i.test(l) && !/^\s*#/.test(l));
ok('the script never writes to the OLD database (every use of it is a read)', writesToOld.length === 0, writesToOld.join(' | '));
ok('the restore goes only to the NEW database', /pg_restore[^\n]*-d "\$DST_DB_URL"/.test(src));
ok('error lines printed in the (public) logs are cut short and never include a row\'s data', /cut -c1-200/.test(src) && /Command was/.test(src));

const wf = fs.readFileSync(path.join(root, '.github/workflows/db-move.yml'), 'utf8');
ok('the workflow starts only BY HAND (no schedule, no push trigger)', /workflow_dispatch:/.test(wf) && !/^\s*(schedule|push|pull_request)\s*:/m.test(wf));
ok('the workflow uploads nothing (the repository is public — a dump would be public)', !/upload-artifact/.test(wf));
ok('the workflow has read-only access to the repository', /permissions:\s*\n\s*contents: read/.test(wf));

const store = fs.readFileSync(path.join(root, 'scripts/db-move/copy-storage.mjs'), 'utf8');
ok('the storage copy never deletes anything', !/\.remove\(|\.emptyBucket\(|\.deleteBucket\(/.test(store));

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
