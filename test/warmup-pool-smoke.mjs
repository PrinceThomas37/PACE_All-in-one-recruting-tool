// R-375 / R-376 — the warm-up screen and the warm-up engine agree about who is in the pool.
//   R-375: a Gmail mailbox with a live sign-in counts as connected (it used to read "not connected" because only Microsoft was looked at, so the pool
//          showed 0), and Start refuses a Gmail mailbox that has no sign-in.
//   R-376: a paused / auto-paused / blocked mailbox (all one column, user_emails.auto_paused_at — services/mailbox-control.js) is out of the pool: it
//          neither sends nor receives warm-up mail, and the screen does not count it.
// Real routes/warmup.js and warmup-engine.js; the in-memory PostgREST is the one scope-emails-warmup-smoke.mjs uses.
import { createRequire } from 'node:module';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const express = require(ROOT + '/node_modules/express');
const { createDb } = require(ROOT + '/models');
const createAuthorize = require(ROOT + '/middleware/authorize.js');
const { createWarmupEngine } = require(ROOT + '/warmup-engine.js');
const A = 'org-A';

// ── A tiny PostgREST over arrays: enough of the builder for these routers ──
function memSupabase(T) {
  const byId = (t, id) => (T[t] || []).find(r => r.id === id) || null;
  const embed = (table, row) => {
    const r = { ...row };
    if (table === 'emails') {
      const j = byId('jobs', row.job_id);
      r.job = j ? { ...j, sending_email: null, company: null } : null;
      r.contact = byId('contacts', row.contact_id);
      const s = byId('users', row.sent_by); r.sender = s ? { id: s.id, name: s.name } : null;
    }
    if (table === 'user_emails') { const o = byId('users', row.user_id); r.owner = o ? { name: o.name } : null; }
    if (table === 'warmup_threads') { const t = byId('user_emails', row.to_mailbox_id); r.to = t ? { email_address: t.email_address, org_id: t.org_id } : null; }
    return r;
  };
  function from(table) {
    const st = { op: 'select', f: [], orders: [], range: null, limit: null, head: false, returning: false, payload: null };
    const b = {
      select(cols, opts) { if (st.op === 'select') { if (opts && opts.head) st.head = true; } else st.returning = true; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(c, v) { st.f.push(r => r[c] === v); return b; },
      in(c, vs) { st.f.push(r => vs.includes(r[c])); return b; },
      is(c, v) { st.f.push(r => (r[c] === undefined ? null : r[c]) === v); return b; },
      not(c, op, v) { if (op === 'is' && v === null) st.f.push(r => r[c] != null); return b; },
      gte(c, v) { st.f.push(r => String(r[c]) >= String(v)); return b; },
      ilike(c, p) { const s = p.replace(/%/g, '').toLowerCase(); st.f.push(r => String(r[c] || '').toLowerCase().includes(s)); return b; },
      order(c, o) { st.orders.push([c, !(o && o.ascending === false)]); return b; },
      range(a, z) { st.range = [a, z]; return b; },
      limit(n) { st.limit = n; return b; },
      single() { st.one = 'single'; return run(); },
      maybeSingle() { st.one = 'maybe'; return run(); },
      then(res, rej) { return run().then(res, rej); },
    };
    async function run() {
      T[table] = T[table] || [];
      if (st.op === 'insert' || st.op === 'upsert') {
        const rows = (Array.isArray(st.payload) ? st.payload : [st.payload]).map(r => ({ id: 'new-' + Math.random().toString(36).slice(2), ...r }));
        T[table].push(...rows);
        return { data: st.one ? rows[0] : rows, error: null };
      }
      let rows = T[table].filter(r => st.f.every(fn => fn(r)));
      if (st.op === 'delete') { T[table] = T[table].filter(r => !rows.includes(r)); return { data: st.returning ? rows.map(r => ({ id: r.id })) : null, error: null }; }
      if (st.op === 'update') { rows.forEach(r => Object.assign(r, st.payload)); return { data: st.one ? rows[0] || null : rows, error: null }; }
      if (st.head) return { data: null, count: rows.length, error: null };
      for (const [c, asc] of [...st.orders].reverse()) rows = [...rows].sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (asc ? 1 : -1));
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (st.limit != null) rows = rows.slice(0, st.limit);
      rows = rows.map(r => embed(table, r));
      if (st.one) {
        if (st.one === 'single' && rows.length !== 1) return { data: null, error: { message: 'not one row' } };
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    }
    return b;
  }
  return { from };
}


function fixture() {
  return {
    users: [{ id: 'aA', org_id: A, name: 'Admin A', roles: ['admin'] }],
    user_emails: [
      // in the pool: a Gmail mailbox with a sign-in, warming; a Microsoft mailbox with a sign-in, receiving only
      { id: 'gm1', org_id: A, user_id: 'aA', email_address: 'gm1@a.test', display_name: 'gm1', platform: 'Gmail', is_active: true, warmup_status: 'warming', warmup_pool_opt_in: true, auto_paused_at: null },
      { id: 'ms1', org_id: A, user_id: 'aA', email_address: 'ms1@a.test', display_name: 'ms1', platform: 'Microsoft', is_active: true, warmup_status: null, warmup_pool_opt_in: true, auto_paused_at: null },
      // PAUSED by PACE for bounces, warming and signed in — must be OUT
      { id: 'gm2', org_id: A, user_id: 'aA', email_address: 'gm2@a.test', display_name: 'gm2', platform: 'Gmail', is_active: true, warmup_status: 'warming', warmup_pool_opt_in: true, auto_paused_at: '2026-11-03T20:55:00Z' },
      // BLOCKED by an admin, receiving only, signed in — must be OUT
      { id: 'gm5', org_id: A, user_id: 'aA', email_address: 'gm5@a.test', display_name: 'gm5', platform: 'Gmail', is_active: true, warmup_status: null, warmup_pool_opt_in: true, auto_paused_at: '2026-11-03T21:00:00Z' },
      // Gmail, warming, NO sign-in — not connected
      { id: 'gm3', org_id: A, user_id: 'aA', email_address: 'gm3@a.test', display_name: 'gm3', platform: 'Gmail', is_active: true, warmup_status: 'warming', warmup_pool_opt_in: false, auto_paused_at: null },
      // Gmail, not warming yet, signed in — Start must be accepted
      { id: 'gm4', org_id: A, user_id: 'aA', email_address: 'gm4@a.test', display_name: 'gm4', platform: 'Gmail', is_active: true, warmup_status: null, warmup_pool_opt_in: false, auto_paused_at: null },
    ],
    gmail_tokens: [{ user_email_id: 'gm1' }, { user_email_id: 'gm2' }, { user_email_id: 'gm4' }, { user_email_id: 'gm5' }],
    microsoft_tokens: [{ user_email_id: 'ms1' }],
    warmup_threads: [], warmup_send_log: [], app_settings: [], activity_log: [],
  };
}

async function boot() {
  const T = fixture();
  const supabase = memSupabase(T);
  const { hasRole } = createAuthorize({ supabase });
  const auth = (req, res, next) => { req.user = { id: 'aA', org_id: A, roles: ['admin'], role: 'admin' }; req.orgId = A; next(); };
  const app = express(); app.use(express.json());
  app.use(require(ROOT + '/routes/warmup.js')({ supabase, auth, hasRole, engine: { healthScore: async () => null, tick: async () => ({}) }, emit: () => {}, EVENTS: {} }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const rq = http.request(base + p, { method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let out = ''; res.on('data', d => { out += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(out || 'null'); } catch (_) { json = out; } resolve({ status: res.statusCode, json }); });
    });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
  return { T, supabase, call, close: () => server.close() };
}
const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

try {
  const { T, supabase, call, close } = await boot();
  const list = await call('GET', '/warmup/mailboxes');
  const row = (id) => ((list.json && list.json.mailboxes) || []).find(m => m.id === id) || {};
  ok('the list answers', list.status === 200, String(list.status));
  ok('R-375: a Gmail mailbox with a sign-in reads connected', row('gm1').connected === true);
  ok('R-375: a Gmail mailbox with NO sign-in reads not connected', row('gm3').connected === false);
  ok('a Microsoft mailbox with a sign-in still reads connected', row('ms1').connected === true);
  ok('R-376: the paused (and the blocked) mailbox says it is out', row('gm2').outreach_paused === true && row('gm5').outreach_paused === true && row('gm1').outreach_paused === false);
  ok('the pool the screen counts is gm1 + ms1 only (paused/blocked/no-sign-in left out)', list.json && list.json.pool_count === 2, JSON.stringify(list.json && list.json.pool_count));

  const eng = createWarmupEngine({ supabase, graphMailRequest: async () => ({}), getMicrosoftToken: async () => 't', gmail: { isConfigured: () => true }, emit: () => {}, EVENTS: {} });
  const pool = (await eng.poolMailboxes()).map(m => m.id).sort().join(',');
  ok('R-376: the engine\'s pool is the same two — a paused or blocked mailbox neither sends nor receives', pool === 'gm1,ms1', pool);

  const noSignIn = await call('POST', '/warmup/gm3/start', {});
  ok('R-375: Start refuses a Gmail mailbox with no sign-in (400)', noSignIn.status === 400, String(noSignIn.status));
  const signedIn = await call('POST', '/warmup/gm4/start', {});
  ok('R-375: Start accepts a Gmail mailbox that is signed in', signedIn.status === 200 && T.user_emails.find(m => m.id === 'gm4').warmup_status === 'warming', String(signedIn.status));
  close();
} catch (e) { ok('suite ran to the end', false, e.stack || e.message); }
const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
