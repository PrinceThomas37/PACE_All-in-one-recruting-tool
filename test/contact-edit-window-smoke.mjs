// AN RA LEAD MAY EDIT THE PEOPLE ON A LEAD THEIR TEAM MADE — INSIDE THE WINDOW THE ADMIN SETS (owner, 14 Oct: "within 24 hours, which the
// admin set up in the admin panel").
//   1. the rule (services/contact-edit-window.js), pure: who, for which leads, until when;
//   2. the REAL gate every contact write goes through (middleware/authorize.js canTouchJob), over an in-memory database — including the
//      admin changing the window in System settings and the new number being what counts;
//   3. GET /jobs/:id/edit-rights (what the Edit lead window offers) answers with the SAME rule, and a lead the caller cannot see is a 404.
// Nothing else changed: an RA who is not an RA lead gets nothing new; a BD gets nothing new; an admin and an owner keep what they had.
// Usage: node test/contact-edit-window-smoke.mjs
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const { contactEditRights } = require(path.join(ROOT, 'services/contact-edit-window.js'));
const NOW = new Date('2026-10-14T12:00:00Z'), H = 3600000;
const made = (hoursAgo) => new Date(NOW.getTime() - hoursAgo * H).toISOString();

// ── 1. the rule ──
const r = (o) => contactEditRights(Object.assign({ isAdmin: false, isRaLead: true, userId: 'ral', job: { created_by: 'ra1', created_at: made(2) }, teamIds: ['ral', 'ra1'], windowHours: 24, now: NOW }, o));
step('an RA lead may edit the people on a lead their team made, inside the window', r().allowed && r().via === 'ra_lead_window');
step('…and is told when the window closes', r().until === new Date(NOW.getTime() - 2 * H + 24 * H).toISOString(), r().until);
step('after the window: no — and the closing time is still given, so the screen can say when it closed', !r({ job: { created_by: 'ra1', created_at: made(30) } }).allowed && !!r({ job: { created_by: 'ra1', created_at: made(30) } }).until);
step('a lead made by somebody OUTSIDE their team: no', !r({ job: { created_by: 'stranger', created_at: made(2) } }).allowed);
step('the window is the admin\'s number: 48 hours makes a 30-hour-old lead editable', r({ job: { created_by: 'ra1', created_at: made(30) }, windowHours: 48 }).allowed);
step('no window set (0 / missing) or no creation time: no edit, never a default invented here', !r({ windowHours: 0 }).allowed && !r({ windowHours: undefined }).allowed && !r({ job: { created_by: 'ra1' } }).allowed);
step('an admin always may; an owner (creator / assignee / BD owner) always may — as before', r({ isAdmin: true, isRaLead: false, userId: 'adm' }).via === 'admin' && contactEditRights({ userId: 'bd1', job: { assigned_to_bd: 'bd1' }, now: NOW }).via === 'own' && contactEditRights({ userId: 'ra1', job: { created_by: 'ra1' }, now: NOW }).via === 'own');
step('somebody who is none of these gets nothing (a BD on another BD\'s lead, an RA on a teammate\'s)', !contactEditRights({ userId: 'bd2', job: { assigned_to_bd: 'bd1', created_by: 'ra1', created_at: made(1) }, now: NOW }).allowed && !contactEditRights({ isRaLead: false, userId: 'ra2', job: { created_by: 'ra1', created_at: made(1) }, teamIds: ['ra1', 'ra2'], windowHours: 24, now: NOW }).allowed);

// ── 2 + 3. the real gate and the real endpoint ──
const O = 'org-a', OTHER = 'org-b';
const users = [
  { id: 'adm', role: 'admin', manager_id: null }, { id: 'ral', role: 'ra_lead', manager_id: null }, { id: 'ral2', role: 'ra_lead', manager_id: null },
  { id: 'ra1', role: 'ra', manager_id: 'ral' }, { id: 'ra2', role: 'ra', manager_id: 'ral2' }, { id: 'bd1', role: 'bd', manager_id: null }, { id: 'bd2', role: 'bd', manager_id: null },
].map(u => ({ ...u, org_id: O, deleted_at: null }));
const realNow = Date.now(), ago = (h) => new Date(realNow - h * H).toISOString();
const job = (id, over) => Object.assign({ id, org_id: O, company_id: null, position: 'P', stage: 'Unassigned', created_by: 'ra1', assigned_to: null, assigned_to_bd: null, created_at: ago(2), deleted_at: null }, over || {});
const fake = createFakeDb({ tables: { users, app_settings: [], jobs: [job('fresh'), job('old', { created_at: ago(30) }), job('theirs', { created_by: 'ra2' }), job('owned', { created_by: 'ra2', assigned_to_bd: 'bd1' }), job('foreign', { org_id: OTHER, created_by: 'ra1' })], contacts: [] } });
const supabase = fake.supabase;
const { hasRole, canTouchJob } = require(path.join(ROOT, 'middleware/authorize.js'))({ supabase });
const settings = require(path.join(ROOT, 'config/settings.js'));
const asUser = (id) => { const u = users.find(x => x.id === id); return { user: { id: u.id, org_id: O, role: u.role, roles: [u.role] }, orgId: O }; };

step('GATE: an RA lead may touch the people on a fresh lead made by their own RA', await canTouchJob(asUser('ral'), 'fresh') === true);
step('GATE: …not after the window (30 h old, default 24)', await canTouchJob(asUser('ral'), 'old') === false);
step('GATE: …not a lead made by another RA lead\'s team', await canTouchJob(asUser('ral'), 'theirs') === false);
step('GATE: …not a lead in another organisation, whatever its age', await canTouchJob(asUser('ral'), 'foreign') === false);
step('GATE: a BD who does not own it, and an RA on a teammate\'s lead, are still refused', await canTouchJob(asUser('bd2'), 'fresh') === false && await canTouchJob(asUser('ra2'), 'fresh') === false);
step('GATE: the creator, the BD owner and an admin still may (nothing taken away)', await canTouchJob(asUser('ra1'), 'old') === true && await canTouchJob(asUser('bd1'), 'owned') === true && await canTouchJob(asUser('adm'), 'old') === true);
await settings.setSettings(supabase, { ra_edit_window_hours: 48 });   // what the admin's System settings page does
step('GATE: the admin raises the window to 48 hours → the 30-hour-old lead is now editable by the RA lead', await canTouchJob(asUser('ral'), 'old') === true);
await settings.setSettings(supabase, { ra_edit_window_hours: 1 });
step('GATE: …and lowers it to 1 hour → the 2-hour-old lead is closed', await canTouchJob(asUser('ral'), 'fresh') === false);
await settings.setSettings(supabase, { ra_edit_window_hours: 24 });

const ctx = { supabase, auth: (req, res, next) => { const u = users.find(x => x.id === req.headers['x-user']); if (!u) return res.status(401).json({ error: 'no user' }); Object.assign(req, asUser(u.id)); next(); },
  hasRole, today: () => '2026-10-14', logActivity: async () => {}, canTouchJob, loadAllJobs: async () => [], JOB_SELECT: '*', getTimezoneFromLocation: () => 'EST', persistLearnedSkills: async () => {},
  orgIdFor: (req) => O, withOrg: (q) => q, orgStamp: () => ({ org_id: O }), userOrgId: async () => O, mailboxOrgId: async () => O };
const app = express(); app.use(express.json()); app.use(require(path.join(ROOT, 'routes/jobs.js'))(ctx));
const server = app.listen(0, '127.0.0.1'); await new Promise(res => server.once('listening', res));
const get = (who, p) => new Promise((resolve, reject) => { http.get(`http://127.0.0.1:${server.address().port}${p}`, { headers: { 'x-user': who } }, (res) => { let out = ''; res.on('data', d => { out += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(out); } catch (_) { j = out; } resolve({ status: res.statusCode, json: j }); }); }).on('error', reject); });
let g = await get('ral', '/jobs/fresh/edit-rights');
step('ENDPOINT: the RA lead is offered the People section on a fresh team lead, with the window length and closing time', g.status === 200 && g.json.contacts === true && g.json.via === 'ra_lead_window' && g.json.window_hours === 24 && !!g.json.contacts_until, JSON.stringify(g.json));
g = await get('ral', '/jobs/old/edit-rights');
step('ENDPOINT: after the window it says no, and when it closed', g.status === 200 && g.json.contacts === false && !!g.json.contacts_until, JSON.stringify(g.json));
g = await get('adm', '/jobs/old/edit-rights');
step('ENDPOINT: an admin is always offered it', g.json.contacts === true && g.json.via === 'admin');
g = await get('bd1', '/jobs/owned/edit-rights');
step('ENDPOINT: the BD who owns the lead is offered it', g.json.contacts === true && g.json.via === 'own');
g = await get('ral', '/jobs/foreign/edit-rights');
step('ENDPOINT: a lead in another organisation does not exist for them (404, never 403)', g.status === 404);
server.close();
const bad = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
