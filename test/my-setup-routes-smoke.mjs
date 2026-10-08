// MY SETUP, SERVER SIDE (owner, 8 Oct 2026, D-0104)
//   * a person STARTS outreach only with a sequence of their own — no email is written for a lead whose owner has none, and
//     the caller is told whose leads were left; mail already queued, and individual emails, are not touched
//   * the starter sequence: their company's name in it, saved as THEIR text (never Fute Global's, never silently)
//   * first-login tasks: PACE puts "set up your mailbox" and "write your first sequence" on the person's own list, once, and they
//     close themselves; nobody gets a task they cannot do
//   * sending days and hours: a person narrows the organisation's window, never widens it; the lead's local day is respected
// Usage: node test/my-setup-routes-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-my-setup';
const express = require('express');
const jwt = require('jsonwebtoken');
const starter = require('../services/sequence-starter.js');
const win = require('../services/send-window.js');
const { buildPendingEmailsFromJobs } = require('../services/lead-outreach-queue.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

console.log('\nStarting outreach needs a sequence of your own');
const job = (id, owner, n) => ({ id, position: 'Welder', location: 'Austin, TX', industry: 'Manufacturing', company: { name: 'Acme ' + id, industry: 'Manufacturing' }, assigned_to_bd: owner,
  contacts: Array.from({ length: n || 1 }, (_, i) => ({ id: id + 'c' + i, email: `p${i}@${id}.example.com`, first_name: 'Pat', designation: 'HR Manager' })), research: {} });
const OWN = starter.starterFor('Acme Talent LLC');
const settings = { 'u_bdA_tmpl_o1_body': OWN.tmpl_o1_body, 'u_bdA_tmpl_o1_subject': OWN.tmpl_o1_subject };
const bdMap = { bdA: { id: 'bdA', name: 'Ann A' }, bdB: { id: 'bdB', name: 'Bo B' } };
const jobs = [job('j1', 'bdA', 2), job('j2', 'bdB', 1), job('j3', 'bdB', 1), job('j4', null, 1)];
const built = buildPendingEmailsFromJobs(jobs, 'adm', bdMap, {}, settings, new Set());
step('emails are written for the person who HAS a sequence (their two contacts)', built.emailsToInsert.length === 2 && built.emailsToInsert.every((e) => e.sent_by === 'bdA'));
step('…and none for the person who has not, nor for the lead that falls to the caller who has not either', !built.emailsToInsert.some((e) => e.sent_by === 'bdB' || e.sent_by === 'adm'));
step('the caller is told WHOSE leads were left, and how many leads', built.needsSequence.length === 2 && built.needsSequence.find((n) => n.user_id === 'bdB').leads === 2 && built.needsSequence.find((n) => n.user_id === 'bdB').name === 'Bo B' && built.needsSequence.find((n) => n.user_id === 'adm').leads === 1, JSON.stringify(built.needsSequence));
step('the written email uses THEIR wording — their company, never Fute Global', /Acme Talent LLC/.test(built.emailsToInsert[0].body) && !/Fute/.test(built.emailsToInsert[0].body));
const none = buildPendingEmailsFromJobs(jobs, 'adm', bdMap, {}, {}, new Set());
step('with nobody having one, nothing is written at all (and everyone is listed)', none.emailsToInsert.length === 0 && none.needsSequence.length === 3);
const stale = buildPendingEmailsFromJobs([job('j9', 'bdA', 1)], 'adm', bdMap, {}, { 'u_bdA_tmpl_o1_body': 'Hi {{fn}}, At Fute Global we place people into roles all over the country' }, new Set());
step('an old saved text from the retired stock wording does not count as "their own"', stale.emailsToInsert.length === 0 && stale.needsSequence.length === 1);

console.log('\nThe starter');
step('the starter is the standard wording with the person\'s company and nothing of Fute Global; follow-ups after 3 and 7 days', !/Fute/.test(JSON.stringify(OWN)) && /Acme Talent LLC/.test(OWN.tmpl_o1_body) && /Acme Talent LLC/.test(OWN.tmpl_fu2_body + OWN.tmpl_fu1_body + OWN.tmpl_o1_body) && OWN.fu1_day === '3' && OWN.fu2_day === '7');
step('no company said = no starter (it is never made up)', starter.starterFor('') === null && starter.starterFor('   ') === null);

// ── the routes, over an in-memory database ──────────────────────────────────────────────────────────
const T = {
  users: [{ id: 'adm', org_id: 'o1', roles: ['admin'] }, { id: 'bd1', org_id: 'o1', roles: ['bd'] }, { id: 'ra1', org_id: 'o1', roles: ['ra'] }, { id: 'rec1', org_id: 'o1', roles: ['recruiter'] }],
  user_emails: [{ id: 'mBd', user_id: 'bd1', org_id: 'o1', is_primary: true, is_active: true, created_at: '2026-10-01' }, { id: 'mRec', user_id: 'rec1', org_id: 'o1', is_primary: true, is_active: true, created_at: '2026-10-01' }],
  app_settings: [], reminders: [], microsoft_tokens: [], gmail_tokens: [],
};
let uid = 0;
function from(name) {
  let mode = 'select', filters = [], row = null, patch = null, one = false;
  const rows = () => (T[name] || []).filter((r) => filters.every((f) => f(r)));
  const q = {
    select() { return q; }, order() { return q; }, limit() { return q; },
    eq(c, v) { filters.push((r) => r[c] === v); return q; }, in(c, l) { filters.push((r) => l.includes(r[c])); return q; },
    insert(r) { mode = 'insert'; row = r; return q; }, update(p) { mode = 'update'; patch = p; return q; },
    upsert(r) { mode = 'upsert'; row = r; return q; }, delete() { mode = 'delete'; return q; },
    single() { one = true; return q; }, maybeSingle() { one = true; return q; },
    then(res, rej) {
      let out; T[name] = T[name] || [];
      if (mode === 'insert') { const r = Object.assign({ id: 'new' + (++uid), created_at: new Date().toISOString() }, row); T[name].push(r); out = { data: r, error: null }; }
      else if (mode === 'upsert') { for (const r of [].concat(row)) { const i = T[name].findIndex((x) => x.key === r.key); if (i >= 0) Object.assign(T[name][i], r); else T[name].push({ ...r }); } out = { data: null, error: null }; }
      else if (mode === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); out = { data: one ? hit[0] || null : hit, error: null }; }
      else if (mode === 'delete') { const hit = new Set(rows()); T[name] = T[name].filter((r) => !hit.has(r)); out = { data: null, error: null }; }
      else { const d = rows(); out = { data: one ? d[0] || null : d, error: null }; }
      return Promise.resolve(out).then(res, rej);
    },
  };
  return q;
}
const supabase = { from };
const db = { forRequest: () => ({ from }) };
const hasRole = (req, ...r) => (req.user.roles || []).some((x) => r.includes(x));
const auth = (req, res, next) => { try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET); req.orgId = req.user.org_id; next(); } catch { res.status(401).json({ error: 'Invalid token' }); } };
const tokenFor = (id) => { const u = T.users.find((x) => x.id === id); return jwt.sign({ id, org_id: u.org_id, roles: u.roles, role: u.roles[0] }, process.env.JWT_SECRET); };
const app = express(); app.use(express.json());
app.use(require('../routes/my-setup.js')({ supabase, db, auth, hasRole, today: () => '2026-10-08', getSendWindowHours: async () => ({ start: 8, end: 16 }) }));
const server = http.createServer(app);
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const call = async (method, p, who, body) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + tokenFor(who) } : {}) }, body: body ? JSON.stringify(body) : undefined }); let out = null; try { out = await r.json(); } catch (_) { /* none */ } return { code: r.status, out }; };
const val = (k) => (T.app_settings.find((x) => x.key === k) || {}).value;

console.log('\nThe starter route');
let r = await call('POST', '/my-setup/sequence/starter', 'ra1');
step('an analyst (no sequence of their own to write) is refused (403)', r.code === 403);
r = await call('POST', '/my-setup/sequence/starter', 'bd1');
step('no company said on any mailbox yet: refused in words, nothing saved, and it says what to do first', r.code === 400 && r.out.needs === 'sends_as' && /Say which company/.test(r.out.error) && !T.app_settings.some((x) => /^u_bd1_/.test(x.key)), JSON.stringify(r.out));
T.app_settings.push({ key: 'ue_mBd_sends_as', value: JSON.stringify({ company: 'Acme Talent LLC', title: 'VP', address: '12 Market St, Austin, TX 78701' }) });
r = await call('POST', '/my-setup/sequence/starter', 'bd1');
step('with a company said, the starter is saved as THEIR text (201) — wording, subject, follow-ups and days', r.code === 201 && r.out.company === 'Acme Talent LLC' && /Acme Talent LLC/.test(val('u_bd1_tmpl_o1_body')) && !/Fute/.test(val('u_bd1_tmpl_o1_body')) && val('u_bd1_fu1_day') === '3' && val('u_bd1_fu2_day') === '7' && !!val('u_bd1_tmpl_fu2_subject'));
const savedSettings = {}; T.app_settings.forEach((x) => { savedSettings[x.key] = x.value; });
step('…and that is what counts as having their own — outreach for their leads now starts', starter.hasOwnSequence(savedSettings, 'bd1') && buildPendingEmailsFromJobs([job('jx', 'bd1', 1)], 'adm', { bd1: { id: 'bd1', name: 'B' } }, {}, savedSettings, new Set()).emailsToInsert.length === 1);
r = await call('POST', '/my-setup/sequence/starter', 'bd1');
step('asking again does not overwrite what they have (409), unless they ask to replace it', r.code === 409 && r.out.has_own === true);
T.app_settings.find((x) => x.key === 'u_bd1_tmpl_o1_body').value = 'My own words — Hi {{fn}}, I help companies hire welders across Texas.';
r = await call('POST', '/my-setup/sequence/starter', 'bd1', { replace: true });
step('"replace" puts the starter back over their edits', r.code === 201 && /Acme Talent LLC/.test(val('u_bd1_tmpl_o1_body')));

console.log('\nFirst-login tasks');
T.app_settings = T.app_settings.filter((x) => !/^u_bd1_/.test(x.key));
r = await call('POST', '/my-setup/sync', 'bd1');
const mine = () => T.reminders.filter((x) => x.user_id === 'bd1' && x.reminder_type === 'setup');
step('a manager with no connected mailbox and no sequence gets BOTH tasks, on their own list, dated today, saying where to go', r.code === 200 && r.out.owed.join() === 'mailbox,sequence' && mine().length === 2 && mine().every((x) => x.status === 'pending' && x.return_date === '2026-10-08' && /My Setup/.test(x.note + x.company_name)));
r = await call('POST', '/my-setup/sync', 'bd1');
step('asking again changes nothing (no duplicates)', r.out.created.length === 0 && mine().length === 2);
T.microsoft_tokens.push({ user_email_id: 'mBd', user_id: 'bd1', expires_at: new Date(Date.now() + 3600e3).toISOString() });
r = await call('POST', '/my-setup/sync', 'bd1');
step('once the mailbox is connected its task closes by itself; the sequence one stays', mine().find((x) => /mailbox/i.test(x.contact_name)).status === 'sent' && mine().find((x) => /sequence/i.test(x.contact_name)).status === 'pending', JSON.stringify(r.out));
T.app_settings.push({ key: 'ue_mBd_sends_as', value: JSON.stringify({ company: 'Acme Talent LLC', title: 'VP', address: '12 Market St, Austin, TX 78701' }) });
await call('POST', '/my-setup/sequence/starter', 'bd1'); await call('POST', '/my-setup/sync', 'bd1');
step('once they have their sequence that task closes too — nothing is owed', mine().every((x) => x.status === 'sent'));
r = await call('POST', '/my-setup/sync', 'rec1');
const rec = T.reminders.filter((x) => x.user_id === 'rec1');
step('a recruiter (sends outreach, has no sequence of this kind) gets the mailbox task only — never a task they cannot do', rec.length === 1 && /mailbox/i.test(rec[0].contact_name) && r.out.owed.join() === 'mailbox', JSON.stringify(r.out));
r = await call('POST', '/my-setup/sync', 'ra1');
step('an analyst gets no setup task at all', r.out.owed.length === 0 && !T.reminders.some((x) => x.user_id === 'ra1'));
rec[0].status = 'sent'; rec[0].created_at = new Date().toISOString();
await call('POST', '/my-setup/sync', 'rec1');
step('marked done without doing it: not asked again straight away (no nagging loop)', T.reminders.filter((x) => x.user_id === 'rec1').length === 1);
rec[0].created_at = new Date(Date.now() - 5 * 86400000).toISOString();
await call('POST', '/my-setup/sync', 'rec1');
step('…but asked again after a few days if still not done', T.reminders.filter((x) => x.user_id === 'rec1' && x.status === 'pending').length === 1);

console.log('\nSending days and hours');
r = await call('GET', '/my-setup/send-window', 'bd1');
step('before choosing: the organisation\'s window (8–16), no days restriction', r.out.org.start === 8 && r.out.org.end === 16 && r.out.effective.days === null && r.out.effective.narrowed === false);
r = await call('PUT', '/my-setup/send-window', 'bd1', { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: 9, end: 15 });
step('a person narrows it: Mon–Fri, 9–15', r.code === 200 && r.out.effective.start === 9 && r.out.effective.end === 15 && r.out.effective.days.join() === 'mon,tue,wed,thu,fri' && val('u_bd1_send_days') === 'mon,tue,wed,thu,fri');
r = await call('PUT', '/my-setup/send-window', 'bd1', { days: ['mon'], start: 6, end: 15 });
step('…but cannot WIDEN it beyond the organisation\'s hours (400, in words)', r.code === 400 && /organisation/.test(r.out.error) && val('u_bd1_send_start_hour') === '9');
r = await call('PUT', '/my-setup/send-window', 'bd1', { days: ['mon'], start: 9, end: 20 });
step('…not later either', r.code === 400);
r = await call('PUT', '/my-setup/send-window', 'bd1', { days: [], start: 9, end: 15 });
step('at least one day is required', r.code === 400 && /one day/.test(r.out.error));
r = await call('PUT', '/my-setup/send-window', 'bd1', { days: ['mon'], start: 15, end: 9 });
step('a start after the stop is refused', r.code === 400);
r = await call('GET', '/my-setup/send-window', 'adm');
step('somebody else\'s choice does not apply to me (the admin still has the organisation\'s window)', r.out.effective.days === null && r.out.effective.start === 8);
r = await call('PUT', '/my-setup/send-window', 'bd1', { reset: true });
step('"back to the organisation\'s hours" removes the choice', r.code === 200 && r.out.effective.narrowed === false && !val('u_bd1_send_days'));
const sat = new Date('2026-10-10T15:00:00Z');   // Saturday 10:00 in Chicago
const ow = { start: 8, end: 16 };
step('the window honours the LEAD\'s weekday: a Saturday 10:00 lead is closed to a Mon–Fri sender and open to an everyday one', win.isOpen('America/Chicago', sat, win.effectiveWindow(ow, win.readPrefs({ days: 'mon,tue,wed,thu,fri' }))) === false && win.isOpen('America/Chicago', sat, win.effectiveWindow(ow, win.readPrefs({}))) === true);
step('…and the narrowed hours: 8:30 is outside a 9–15 sender\'s window but inside the organisation\'s', win.isOpen('America/Chicago', new Date('2026-10-09T13:30:00Z'), win.effectiveWindow(ow, win.readPrefs({ start: 9, end: 15 }))) === false && win.isOpen('America/Chicago', new Date('2026-10-09T13:30:00Z'), win.effectiveWindow(ow, win.readPrefs({}))) === true);

server.close();
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
