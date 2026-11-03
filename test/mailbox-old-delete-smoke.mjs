// THE OLD "DELETE A MAILBOX" BUTTON TELLS THE TRUTH (R-358, owner 3 Nov 2026: "solve this issue").
// Manager Users → Email IDs used to answer "removed" when the database had refused (a mailbox that ever sent mail is tied to those emails).
//   • a mailbox with mail on record → 409, the row is KEPT, and the sentence says to Deactivate;
//   • the same count rule as the Deliverability panel (one shared function, services/mailbox-delete.js): the larger of by-address and by-id;
//   • a mailbox with no mail → really deleted, and the answer says so;
//   • another company's mailbox, or an unknown one → 404, nothing deleted.
// Usage: node test/mailbox-old-delete-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-old-delete';
const express = require('express');
const jwt = require('jsonwebtoken');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const fake = createFakeDb({ tables: {
  organizations: [{ id: 'o1', name: 'One', plan: 'internal' }, { id: 'o2', name: 'Two', plan: 'internal' }],
  users: [{ id: 'adm', org_id: 'o1', roles: ['admin'], role: 'admin', is_active: true, deleted_at: null }, { id: 'bd1', org_id: 'o1', roles: ['bd'], role: 'bd', is_active: true, deleted_at: null }, { id: 'y2', org_id: 'o2', roles: ['bd'], role: 'bd', is_active: true, deleted_at: null }],
  user_emails: [
    { id: 'sent', org_id: 'o1', user_id: 'bd1', email_address: 'Sent.Mail@box.test', is_active: true },
    { id: 'byid', org_id: 'o1', user_id: 'bd1', email_address: 'byid@box.test', is_active: true },
    { id: 'clean', org_id: 'o1', user_id: 'bd1', email_address: 'clean@box.test', is_active: true },
    { id: 'theirs', org_id: 'o2', user_id: 'y2', email_address: 'theirs@box.test', is_active: true },
  ],
  emails: [
    { id: 'e1', org_id: 'o1', from_email: 'sent.mail@box.test', status: 'sent' },
    { id: 'e2', org_id: 'o1', from_email: 'other@box.test', sending_email_id: 'byid', status: 'sent' },
  ],
  jobs: [], app_settings: [], record_history: [], activity_log: [], microsoft_tokens: [], gmail_tokens: [],
} });
const db = fake.supabase;
const hasRole = (req, ...r) => ((req.user && req.user.roles) || []).some((x) => r.includes(x));
const auth = (req, res, next) => { try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET); req.orgId = req.user.org_id; next(); } catch { res.status(401).json({ error: 'Invalid token' }); } };
const ctx = { supabase: db, auth, hasRole, orgIdFor: (req) => req.orgId || null, loadMailboxSignatures: async () => ({}), today: () => '2026-11-03' };
const app = express(); app.use(express.json()); app.use(require('../routes/auth.js')(ctx));
const server = http.createServer(app);
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const tok = (id, org, roles) => jwt.sign({ id, org_id: org, roles, role: roles[0] }, process.env.JWT_SECRET);
const del = async (user, eid, t) => { const r = await fetch(`http://127.0.0.1:${port}/users/${user}/emails/${eid}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }); let j = null; try { j = await r.json(); } catch (_) { /* none */ } return { code: r.status, out: j }; };
const stillThere = (id) => !!fake.tables.user_emails.find((m) => m.id === id);
const admin = tok('adm', 'o1', ['admin']);

let r = await del('bd1', 'sent', admin);
step('a mailbox that sent mail is refused with 409', r.code === 409, JSON.stringify(r.out));
step('…and its row is KEPT (the old button said "removed")', stillThere('sent'));
step('…and the sentence says to Deactivate and how many emails', /Deactivate/.test(r.out.error) && /1 email /.test(r.out.error), r.out && r.out.error);
r = await del('bd1', 'byid', admin);
step('a mailbox tied only by sending_email_id is refused too (the larger count wins)', r.code === 409 && stillThere('byid'));
r = await del('bd1', 'clean', admin);
step('a mailbox with no mail is really deleted', r.code === 200 && r.out.success === true && !stillThere('clean'));
r = await del('bd1', 'theirs', admin);
step("another company's mailbox: 404 and nothing deleted", [403, 404].includes(r.code) && stillThere('theirs'), String(r.code));
r = await del('bd1', 'nope', admin);
step('an unknown mailbox: 404', r.code === 404);
server.close();
const ok = results.every(Boolean);
console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length}`); process.exit(ok ? 0 : 1);
