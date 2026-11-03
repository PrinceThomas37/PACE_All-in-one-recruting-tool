// A REAL POSTGRES FOR TESTS (R-349 A). A fake database cannot run SQL, and the lead list's rules now live in SQL (migrations/073), so the tests
// start a throw-away cluster in a temp folder, talk to it with the `psql` command line (no driver to install), and delete it afterwards.
// It needs the PostgreSQL server programs (this sandbox has 16). A machine without them FAILS the test loudly: a probe that cannot measure must not pass.
// Usage: const pg = await startPostgres(); pg.createDb('x'); pg.exec('x', 'create table ...'); pg.rows('x', 'select ...'); pg.stop();
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

function findBin() {
  const root = '/usr/lib/postgresql';
  if (!fs.existsSync(root)) return null;
  const v = fs.readdirSync(root).filter((d) => /^\d+$/.test(d)).sort((a, b) => Number(b) - Number(a))[0];
  return v ? path.join(root, v, 'bin') : null;
}

export async function startPostgres() {
  const bin = findBin();
  if (!bin || !fs.existsSync(path.join(bin, 'initdb')) || !fs.existsSync('/usr/bin/psql')) {
    throw new Error('A real PostgreSQL server is needed for this test (initdb/pg_ctl/psql) and was not found under /usr/lib/postgresql. Install it; the test cannot be skipped.');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-pg-'));
  const data = path.join(dir, 'data'), sock = path.join(dir, 'sock');
  fs.mkdirSync(data); fs.mkdirSync(sock);
  const root = process.getuid && process.getuid() === 0;
  if (root) { for (const d of [dir, data, sock]) execFileSync('chown', ['postgres:postgres', d]); }   // the server refuses to run as root
  const as = (cmd, args) => (root ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { encoding: 'utf8' }) : spawnSync(cmd, args, { encoding: 'utf8' }));
  let r = as(path.join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres']);
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout));
  const port = String(40000 + Math.floor(Math.random() * 20000));
  r = as(path.join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${sock} -c listen_addresses=`, '-l', path.join(dir, 'log'), '-w', 'start']);
  if (r.status !== 0) throw new Error('pg_ctl start failed: ' + (r.stderr || r.stdout) + fs.readFileSync(path.join(dir, 'log'), 'utf8'));
  const psql = (db, args, input) => spawnSync('/usr/bin/psql', ['-h', sock, '-p', port, '-U', 'postgres', '-d', db, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  const api = {
    createDb(name) { const x = psql('postgres', ['-c', `CREATE DATABASE ${name}`]); if (x.status !== 0) throw new Error(x.stderr); },
    exec(db, sql) { const x = psql(db, [], sql); if (x.status !== 0) throw new Error((x.stderr || x.stdout).slice(0, 2000)); return x.stdout; },
    execFile(db, file) { const x = psql(db, ['-f', file]); if (x.status !== 0) throw new Error((x.stderr || x.stdout).slice(0, 2000)); return x.stdout; },
    /** rows of a SELECT as an array of objects (through json_agg: no driver needed) */
    rows(db, sql) { const x = psql(db, [], `SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql.replace(/;\s*$/, '')}) t;`); if (x.status !== 0) throw new Error((x.stderr || x.stdout).slice(0, 2000)); return JSON.parse(x.stdout.trim() || '[]'); },
    stop() { try { as(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']); } finally { fs.rmSync(dir, { recursive: true, force: true }); } },
  };
  return api;
}
// SQL string literal / uuid-array helpers for building test data
export const lit = (v) => (v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'");
export const uuidArr = (a) => `ARRAY[${(a || []).map((x) => lit(x) + '::uuid').join(',')}]::uuid[]`;
export const txtArr = (a) => (a && a.length ? `ARRAY[${a.map(lit).join(',')}]::text[]` : 'NULL::text[]');
