// D-0034 / C-0027 — GET /emails, /emails/sender-summary, /emails/pending-summary,
// DELETE /emails/:id, POST /admin/emails/purge-pending, POST /emails (mark-sent),
// GET/DELETE /suppression, /analytics/templates, /admin/deliverability and the
// warm-up mailbox/thread endpoints, through the REAL routers, the REAL models/
// layer and an in-memory two-organisation database.
//
// Adapted from harbour's C-0023/C-0015 scratch proof (kept verbatim where
// possible — the fixture and every stub trick here cost real debugging time to
// find, per CLAUDE.md's rule for the candidate-outreach drip test). Originally
// run with real router paths as CLI overrides so it could be pointed at a
// scratch mutated copy; that plumbing is kept below because
// `test/scope-*-mutations` reuses it the same way.
//
// Usage: node scope-emails-warmup-smoke.mjs [emailsRouterPath] [delivRouterPath] [warmupRouterPath]
import { createRequire } from 'node:module';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const express = require(ROOT + '/node_modules/express');
const { createDb } = require(ROOT + '/models');
const createAuthorize = require(ROOT + '/middleware/authorize.js');

const EMAILS = process.argv[2] || ROOT + '/routes/emails.js';
const DELIV = process.argv[3] || ROOT + '/routes/deliverability.js';
const WARMUP = process.argv[4] || ROOT + '/routes/warmup.js';

const A = 'org-A', B = 'org-B';
const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();

function fixture() {
  return {
    users: [
      { id: 'aA', org_id: A, name: 'Admin A', roles: ['admin'] },
      { id: 'rl', org_id: A, name: 'RA Lead', roles: ['ra_lead'] },
      { id: 'ra1', org_id: A, name: 'RA One', roles: ['ra'], manager_id: 'rl' },
      { id: 'bl', org_id: A, name: 'BD Lead', roles: ['bd_lead'] },
      { id: 'b1', org_id: A, name: 'BD One', roles: ['bd'], manager_id: 'bl' },
      { id: 'b2', org_id: A, name: 'BD Two', roles: ['bd'] },
      { id: 'bA', org_id: B, name: 'Admin B', roles: ['admin'] },
      { id: 'bB', org_id: B, name: 'BD B', roles: ['bd'] },
    ],
    jobs: [
      { id: 'jA1', org_id: A, position: 'PM', assigned_to_bd: 'b1', created_by: 'ra1', timezone: 'EST' },
      { id: 'jA2', org_id: A, position: 'Estimator', assigned_to_bd: 'b2', created_by: 'ra1', timezone: 'EST' },
      { id: 'jA3', org_id: A, position: 'Super', assigned_to_bd: 'bl', created_by: 'rl', timezone: 'CST' },
      { id: 'jA4', org_id: A, position: 'Recycled', assigned_to_bd: 'b1', created_by: 'ra1', timezone: 'EST' },
      { id: 'jB1', org_id: B, position: 'Foreign', assigned_to_bd: 'bB', created_by: 'bB', timezone: 'PST' },
    ],
    contacts: [
      { id: 'cA1', org_id: A, job_id: 'jA1', first_name: 'Ann', email_status: 'valid', replied_at: iso(10) },
      { id: 'cA2', org_id: A, job_id: 'jA2', first_name: 'Bob', email_status: 'invalid' },
      { id: 'cB1', org_id: B, job_id: 'jB1', first_name: 'Zed', email_status: 'invalid', replied_at: iso(5) },
    ],
    emails: [
      { id: 'e1', org_id: A, sent_by: 'b1', job_id: 'jA1', contact_id: 'cA1', status: 'pending', to_email: 'ann@x.test', subject: 'Hi {{sender}}', body: "I'm {{sender}}", followup_type: 'initial', created_at: iso(1) },
      { id: 'e2', org_id: A, sent_by: 'b2', job_id: 'jA2', contact_id: 'cA2', status: 'sent', to_email: 'bob@x.test', subject: 'S2', body: 'B2 body', from_email: 'b2@a.test', template_variant: 'v1', created_at: iso(2) },
      { id: 'e3', org_id: A, sent_by: 'bl', job_id: 'jA3', status: 'failed', fail_kind: 'temporary', to_email: 'c@x.test', subject: 'S3', body: 'B3', created_at: iso(3) },
      { id: 'e4', org_id: A, sent_by: 'b2', job_id: 'jA4', status: 'sent', to_email: 'd@x.test', subject: 'S4', body: 'B4 by b2 on a lead b1 now owns', from_email: 'b2@a.test', template_variant: 'v1', created_at: iso(4) },
      { id: 'e5', org_id: B, sent_by: 'bB', job_id: 'jB1', contact_id: 'cB1', status: 'pending', to_email: 'zed@x.test', subject: 'FOREIGN', body: 'FOREIGN BODY', followup_type: 'initial', created_at: iso(5) },
      { id: 'e6', org_id: A, sent_by: 'b1', job_id: 'jA1', status: 'failed', fail_kind: 'temporary', to_email: 'e@x.test', subject: 'S6', body: 'B6', created_at: iso(6) },
      { id: 'e7', org_id: B, sent_by: 'bB', job_id: 'jB1', status: 'sent', to_email: 'zz@x.test', subject: 'FOREIGN SENT', body: 'FOREIGN SENT BODY', template_variant: 'v1', from_email: 'bb@b.test', created_at: iso(7) },
    ],
    suppression_list: [
      { id: 'sA', org_id: A, email: 'optout-a@x.test', created_at: iso(1) },
      { id: 'sB', org_id: B, email: 'optout-b@x.test', created_at: iso(2) },
    ],
    user_emails: [
      { id: 'mbA1', org_id: A, user_id: 'b1', email_address: 'b1@a.test', display_name: 'BD One', platform: 'Microsoft', is_active: true, warmup_status: null },
      { id: 'mbA2', org_id: A, user_id: 'b2', email_address: 'b2@a.test', display_name: 'BD Two', platform: 'Microsoft', is_active: true, warmup_status: 'warming' },
      { id: 'mbB1', org_id: B, user_id: 'bB', email_address: 'bb@b.test', display_name: 'BD B', platform: 'Microsoft', is_active: true, warmup_status: 'warming' },
    ],
    warmup_threads: [
      { id: 't1', org_id: A, from_mailbox_id: 'mbA2', to_mailbox_id: 'mbB1', subject: 'cross', created_at: iso(1) },
      { id: 't2', org_id: A, from_mailbox_id: 'mbA2', to_mailbox_id: 'mbA1', subject: 'same', created_at: iso(2) },
    ],
    microsoft_tokens: [], warmup_send_log: [], app_settings: [], activity_log: [],
  };
}

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

// ── Boot the three routers on one app ──
async function boot() {
  const T = fixture();
  const supabase = memSupabase(T);
  const { hasRole, canTouchJob } = createAuthorize({ supabase });
  const auth = (req, res, next) => {
    const u = T.users.find(x => x.id === req.headers['x-user']);
    if (!u) return res.status(401).json({ error: 'no user' });
    req.user = { id: u.id, org_id: u.org_id, roles: u.roles, role: u.roles[0] };
    req.orgId = u.org_id; next();
  };
  const ctx = {
    supabase, db: createDb(supabase), auth, hasRole, canTouchJob,
    orgIdFor: (req) => (req && req.user && req.user.org_id) || null,
    today: () => '2026-09-23', logActivity: async () => {},
    getSendWindowHours: async () => ({ start: 8, end: 16 }), isInLeadSendWindow: () => true,
    getMinutesUntilWindowOpens: () => 0, formatWindowOpensLabel: () => '', padHour: (h) => String(h),
    sendProgressCache: new Map(), addToSuppression: async () => {}, warmupLimit: () => null,
  };
  const app = express(); app.use(express.json());
  app.use(require(EMAILS)(ctx));
  app.use(require(DELIV)(ctx));
  // warmup is mounted with its own small ctx in index.js — mirror that (no db).
  app.use(require(WARMUP)({ supabase, auth, hasRole, engine: { healthScore: async () => null, tick: async () => ({}) }, emit: () => {}, EVENTS: {} }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (who, method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const rq = http.request(base + path, { method, headers: { 'x-user': who, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let out = ''; res.on('data', d => { out += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(out || 'null'); } catch (_) { json = out; } resolve({ status: res.statusCode, json }); });
    });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
  return { T, call, close: () => server.close() };
}

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const ids = (r) => (Array.isArray(r.json) ? r.json.map(e => e.id).sort().join(',') : 'ERR:' + r.status + ':' + JSON.stringify(r.json));

try {
  // ── GET /emails ─────────────────────────────────────────────────────────
  { const { call, close } = await boot();
    const bl = await call('bl', 'GET', '/emails');
    ok('bd_lead sees own + chain (b1) + mail on leads the chain OWNS (e4, sent by b2) — not b2\'s own lead, not org B', ids(bl) === 'e1,e3,e4,e6', ids(bl));
    const b1 = await call('b1', 'GET', '/emails');
    ok('bd sees what they sent + a recycled lead\'s history they now own', ids(b1) === 'e1,e4,e6', ids(b1));
    const b2 = await call('b2', 'GET', '/emails');
    ok('bd sees what they sent, even on a lead since given to someone else', ids(b2) === 'e2,e4', ids(b2));
    const rl = await call('rl', 'GET', '/emails');
    ok('RA Lead reads NO BD\'s messages (D4)', ids(rl) === '', ids(rl));
    const aA = await call('aA', 'GET', '/emails');
    ok('admin sees the whole organisation and nothing of org B', ids(aA) === 'e1,e2,e3,e4,e6', ids(aA));
    ok('...and no foreign body leaks', !JSON.stringify(aA.json).includes('FOREIGN'));
    const bA = await call('bA', 'GET', '/emails');
    ok('org B admin sees only org B', ids(bA) === 'e5,e7', ids(bA));
    const mine = await call('bl', 'GET', '/emails?mine=1');
    ok('?mine=1 narrows to the caller\'s own queue', ids(mine) === 'e3', ids(mine));
    const blPending = await call('bl', 'GET', '/emails?status=pending');
    ok('status filter still applies inside the view', ids(blPending) === 'e1', ids(blPending));
    const rows = Object.fromEntries(bl.json.map(e => [e.id, e]));
    ok('is_mine marks the caller\'s own row', rows.e3.is_mine === true && rows.e6.is_mine === false);
    ok('can_retry is false on a report\'s failure (the retry route would 404)', rows.e6.can_retry === false && rows.e3.can_retry === true, `e6=${rows.e6.can_retry} e3=${rows.e3.can_retry}`);
    ok('a stored body is still rendered (no raw {{sender}})', !JSON.stringify(bl.json).includes('{{sender}}'));
    ok('the Session-29 fields are still on every row', bl.json.every(e => 'retry_note' in e && 'can_retry' in e && 'ai_written' in e && 'ai_will_write' in e));
    const adminRows = Object.fromEntries(aA.json.map(e => [e.id, e]));
    ok('an admin may still retry anyone\'s failure in their org', adminRows.e6.can_retry === true);
    close(); }

  // ── GET /emails/sender-summary ──────────────────────────────────────────
  { const { call, close } = await boot();
    const rl = await call('rl', 'GET', '/emails/sender-summary');
    const by = Object.fromEntries((rl.json?.senders || []).map(s => [s.id, s]));
    ok('RA Lead gets per-BD COUNTS for the whole org', rl.status === 200 && rl.json.scope === 'org' && by.b1?.pending === 1 && by.b1?.failed === 1 && by.b2?.sent === 2 && by.bl?.failed === 1, JSON.stringify(rl.json));
    ok('...never another org\'s sender', !by.bB);
    ok('...and never a message, subject or address', !/subject|body|to_email|@/.test(JSON.stringify(rl.json)));
    ok('...with names', by.b1?.name === 'BD One');
    const b1 = await call('b1', 'GET', '/emails/sender-summary');
    ok('a BD gets only their own view', (b1.json?.senders || []).map(s => s.id).join(',') === 'b1' && b1.json.scope === 'own', JSON.stringify(b1.json));
    const bl = await call('bl', 'GET', '/emails/sender-summary');
    ok('a BD Lead gets their chain', (bl.json?.senders || []).map(s => s.id).sort().join(',') === 'b1,bl' && bl.json.scope === 'team', JSON.stringify(bl.json));
    const bA = await call('bA', 'GET', '/emails/sender-summary');
    ok('org B admin gets org B only', (bA.json?.senders || []).map(s => s.id).join(',') === 'bB');
    close(); }

  // ── pending-summary ─────────────────────────────────────────────────────
  { const { call, close } = await boot();
    const rl = await call('rl', 'GET', '/emails/pending-summary');
    ok('pending-summary (RA Lead, no manager) counts only this org\'s queue', rl.json?.total_pending === 1, JSON.stringify(rl.json?.total_pending));
    const rlB = await call('rl', 'GET', '/emails/pending-summary?manager_id=bB');
    ok('pending-summary for a foreign manager counts nothing', rlB.json?.total_pending === 0);
    close(); }

  // ── DELETE /emails/:id ──────────────────────────────────────────────────
  { const { T, call, close } = await boot();
    const foreignAdmin = await call('bA', 'DELETE', '/emails/e1');
    ok('another org\'s admin deleting an email → 404, row kept', foreignAdmin.status === 404 && T.emails.some(e => e.id === 'e1'), String(foreignAdmin.status));
    const mgr = await call('bl', 'DELETE', '/emails/e1');
    ok('a manager who can SEE a report\'s email is refused (403), row kept', mgr.status === 403 && T.emails.some(e => e.id === 'e1'), String(mgr.status));
    const stranger = await call('b2', 'DELETE', '/emails/e1');
    ok('a colleague who cannot see it gets 404', stranger.status === 404);
    const owner = await call('b1', 'DELETE', '/emails/e1');
    ok('the sender deletes their own pending email', owner.status === 200 && !T.emails.some(e => e.id === 'e1'), String(owner.status));
    close(); }

  // ── purge-pending ───────────────────────────────────────────────────────
  { const { T, call, close } = await boot();
    const dry = await call('aA', 'POST', '/admin/emails/purge-pending', { all_managers: true, types: ['outreach', 'fu1', 'fu2'], dry_run: true });
    ok('purge dry run counts THIS org\'s queue only (1, not org B\'s too)', dry.status === 200 && dry.json.count === 1, JSON.stringify(dry.json));
    const r = await call('aA', 'POST', '/admin/emails/purge-pending', { all_managers: true, types: ['outreach', 'fu1', 'fu2'] });
    ok('purge all_managers empties THIS org\'s queue only', r.status === 200 && r.json.deleted === 1 && !T.emails.some(e => e.id === 'e1') && T.emails.some(e => e.id === 'e5'), JSON.stringify(r.json));
    const f = await call('aA', 'POST', '/admin/emails/purge-pending', { manager_id: 'bB', types: ['outreach'] });
    ok('purge naming a foreign manager → 404, nothing deleted', f.status === 404 && T.emails.some(e => e.id === 'e5'), String(f.status));
    close(); }

  // ── POST /emails ────────────────────────────────────────────────────────
  { const { T, call, close } = await boot();
    const f = await call('b1', 'POST', '/emails', { to_email: 'x@y.test', job_id: 'jB1' });
    ok('mark-sent on a foreign lead → 404', f.status === 404);
    const fc = await call('b1', 'POST', '/emails', { to_email: 'x@y.test', contact_id: 'cB1' });
    ok('mark-sent touching a foreign contact → 404, contact untouched', fc.status === 404 && !T.contacts.find(c => c.id === 'cB1').email_sent_at);
    const g = await call('b1', 'POST', '/emails', { to_email: 'x@y.test', job_id: 'jA1', contact_id: 'cA1' });
    const row = T.emails.find(e => e.id === g.json?.id);
    ok('mark-sent on an own lead is stamped with the caller\'s org', g.status === 201 && row && row.org_id === A, JSON.stringify(row));
    close(); }

  // ── suppression ─────────────────────────────────────────────────────────
  { const { T, call, close } = await boot();
    const list = await call('aA', 'GET', '/suppression');
    ok('GET /suppression lists this org\'s opt-outs only', ids(list) === 'sA', ids(list));
    const foreign = await call('aA', 'DELETE', '/suppression/sB');
    ok('DELETE another customer\'s opt-out → 404 and it is STILL there', foreign.status === 404 && T.suppression_list.some(s => s.id === 'sB'), String(foreign.status));
    const missing = await call('aA', 'DELETE', '/suppression/nope');
    ok('DELETE a missing opt-out → 404, never a false "success"', missing.status === 404);
    const mineDel = await call('aA', 'DELETE', '/suppression/sA');
    ok('DELETE own org\'s opt-out works', mineDel.status === 200 && !T.suppression_list.some(s => s.id === 'sA'));
    close(); }

  // ── analytics / deliverability ──────────────────────────────────────────
  { const { call, close } = await boot();
    const aA = await call('aA', 'GET', '/analytics/templates');
    const v1 = (aA.json || []).find(r => r.variant === 'v1');
    ok('template counts are this org\'s (2 sent v1, not org B\'s)', v1 && v1.sent === 2, JSON.stringify(aA.json));
    ok('...and the admin sample is an own-org email, rendered', v1 && v1.sample && !/FOREIGN/.test(JSON.stringify(v1.sample)));
    const rl = await call('rl', 'GET', '/analytics/templates');
    const rv1 = (rl.json || []).find(r => r.variant === 'v1');
    ok('RA Lead gets the numbers but no BD\'s letter as a sample', rv1 && rv1.sent === 2 && rv1.sample === null, JSON.stringify(rl.json));
    const d = await call('aA', 'GET', '/admin/deliverability?view=org');
    ok('deliverability figures are this org\'s', d.json?.sent === 2 && d.json?.failed === 2 && d.json?.bounced_contacts === 1 && d.json?.replied_contacts === 1 && d.json?.suppression_count === 1, JSON.stringify(d.json));
    ok('deliverability lists this org\'s mailboxes only', (d.json?.mailboxes || []).map(m => m.id).sort().join(',') === 'mbA1,mbA2');
    close(); }

  // ── warm-up ─────────────────────────────────────────────────────────────
  { const { T, call, close } = await boot();
    const start = await call('aA', 'POST', '/warmup/mbB1/start', {});
    ok('an admin cannot start warm-up on another org\'s mailbox (404)', start.status === 404);
    const pause = await call('aA', 'POST', '/warmup/mbB1/pause', {});
    ok('...nor pause it (404), and it is unchanged', pause.status === 404 && T.user_emails.find(m => m.id === 'mbB1').warmup_status === 'warming');
    const ownPause = await call('aA', 'POST', '/warmup/mbA2/pause', {});
    ok('an admin still manages their own org\'s mailbox', ownPause.status === 200);
    const list = await call('bl', 'GET', '/warmup/mailboxes');
    ok('a BD Lead sees their chain\'s mailboxes only', (list.json?.mailboxes || []).map(m => m.id).join(',') === 'mbA1', JSON.stringify((list.json?.mailboxes || []).map(m => m.id)));
    const admin = await call('aA', 'GET', '/warmup/mailboxes');
    ok('an admin sees the org\'s mailboxes, not org B\'s', (admin.json?.mailboxes || []).map(m => m.id).sort().join(',') === 'mbA1,mbA2');
    const th = await call('bl', 'GET', '/warmup/mbA2/threads');
    ok('a BD Lead cannot read threads of a mailbox outside their chain (404)', th.status === 404);
    const thB = await call('aA', 'GET', '/warmup/mbB1/threads');
    ok('an admin cannot read another org\'s threads (404)', thB.status === 404);
    const thA = await call('aA', 'GET', '/warmup/mbA2/threads');
    const cross = (thA.json || []).find(t => t.id === 't1');
    ok('a historic cross-org partner address is withheld', thA.status === 200 && cross && cross.to === null && (thA.json || []).find(t => t.id === 't2').to.email_address === 'b1@a.test', JSON.stringify(thA.json));
    close(); }
} catch (e) {
  ok('harness completed', false, String(e && e.stack || e));
}
const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
