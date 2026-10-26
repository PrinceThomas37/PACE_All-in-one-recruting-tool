// A REMINDER ABOUT SOMEONE PACE DOES NOT KNOW BECOMES A LEAD — AND IT IS YOURS (R-309, D-0178, owner 26 Oct: "show a button of
// add it as new lead and take those information to create the new lead with the user who creates the email as owner").
//   Server (POST /jobs with from_reminder_id, over an in-memory PostgREST):
//     · the lead is the reminder-maker's from the start: owner, Assigned, from their main mailbox — not Unassigned in the pool;
//     · the reminder is tied to the new lead and its contact;
//     · someone else's reminder → 404; a reminder already on a lead → 409; a person already a contact somewhere → 409 naming
//       where; an RA → 403; and none of these writes a lead.
//   Screen: the button shows on a reminder about an unknown person (due card and upcoming row) and nowhere else; it opens the
//     Add Lead window filled in (person, email, company — yours if PACE has it, else a new one) saying whose the lead will be;
//     saving sends from_reminder_id.
// Usage: node test/reminder-add-lead-smoke.mjs
import path from 'node:path'; import http from 'node:http'; import fs from 'node:fs';
import express from 'express';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const O = 'org-a';

// ── the rule ──
const RL = require(path.join(ROOT, 'services/reminder-lead.js'));
step('the rule: a reminder with no lead and an email may become a lead', RL.reminderLeadOffer({ email: 'nathan@fulton.com' }) === null);
step('…not one already on a lead, a setup/reconnect reminder, or one with no email',
  !!RL.reminderLeadOffer({ email: 'a@b.co', job_id: 'L1' }) && !!RL.reminderLeadOffer({ email: 'a@b.co', reminder_type: 'setup' })
  && !!RL.reminderLeadOffer({ email: 'x@y.co', contact_name: 'Reconnect your mailbox' }) && !!RL.reminderLeadOffer({ email: '' }));
step('the main mailbox is the primary one, else the first, else none', RL.mainMailboxId([{ id: 'm1' }, { id: 'm2', is_primary: true }]) === 'm2' && RL.mainMailboxId([{ id: 'm1' }]) === 'm1' && RL.mainMailboxId([]) === null);

// ── the server ──
const users = [{ id: 'martin', role: 'bd' }, { id: 'ra1', role: 'ra' }, { id: 'other', role: 'bd' }].map((u) => ({ ...u, org_id: O, deleted_at: null, manager_id: null }));
const fake = createFakeDb({
  tables: {
    users, app_settings: [], activity_log: [],
    companies: [{ id: 'co-new', org_id: O, name: 'Fulton Technology' }, { id: 'co-old', org_id: O, name: 'Known Co' }],
    jobs: [{ id: 'L-known', org_id: O, company_id: 'co-old', position: 'Plant Manager', stage: 'Assigned', assigned_to_bd: 'other', created_by: 'other', deleted_at: null, created_at: new Date().toISOString() }],
    contacts: [{ id: 'c-known', org_id: O, job_id: 'L-known', first_name: 'Kim', email: 'kim@known.co' }],
    user_emails: [{ id: 'mb-1', org_id: O, user_id: 'martin', is_primary: false }, { id: 'mb-main', org_id: O, user_id: 'martin', is_primary: true }, { id: 'mb-x', org_id: O, user_id: 'other', is_primary: true }],
    reminders: [
      { id: 'R-martin', org_id: O, user_id: 'martin', job_id: null, contact_id: null, contact_name: 'Nathan W', company_name: 'Fulton Technology', email: 'nathan@fultontechnology.com', reminder_type: 'manual' },
      { id: 'R-other', org_id: O, user_id: 'other', job_id: null, contact_id: null, contact_name: 'Pat', company_name: 'Fulton Technology', email: 'pat@fultontechnology.com', reminder_type: 'manual' },
      { id: 'R-linked', org_id: O, user_id: 'martin', job_id: 'L-known', contact_id: 'c-known', contact_name: 'Kim', company_name: 'Known Co', email: 'kim@known.co', reminder_type: 'manual' },
      { id: 'R-dup', org_id: O, user_id: 'martin', job_id: null, contact_id: null, contact_name: 'Kim again', company_name: 'Known Co', email: 'KIM@known.co', reminder_type: 'manual' },
      { id: 'R-ra', org_id: O, user_id: 'ra1', job_id: null, contact_id: null, contact_name: 'Lee', company_name: 'Fulton Technology', email: 'lee@fultontechnology.com', reminder_type: 'manual' },
    ],
  },
  relations: { contacts: { job: { table: 'jobs', fk: 'job_id' } }, jobs: { company: { table: 'companies', fk: 'company_id' } } },
  defaults: { jobs: () => ({ id: 'J' + Math.random().toString(36).slice(2, 8), org_id: O, deleted_at: null, created_at: new Date().toISOString() }), contacts: () => ({ id: 'C' + Math.random().toString(36).slice(2, 8) }) },
});
const hasRole = (req, ...roles) => (req.user.roles || []).some((r) => roles.includes(r));
const ctx = {
  supabase: fake.supabase, auth: (req, res, next) => { const u = users.find((x) => x.id === req.headers['x-user']); req.user = { id: u.id, org_id: O, role: u.role, roles: [u.role] }; req.orgId = O; next(); },
  hasRole, today: () => '2026-10-26', logActivity: async () => {}, canTouchJob: async () => true, loadAllJobs: async () => [], JOB_SELECT: '*',
  getTimezoneFromLocation: () => 'EST', persistLearnedSkills: async () => {}, orgIdFor: () => O, withOrg: (q) => q.eq('org_id', O), orgStamp: () => ({ org_id: O }), userOrgId: async () => O, mailboxOrgId: async () => O,
};
const app = express(); app.use(express.json());
app.use(require(path.join(ROOT, 'routes/jobs.js'))(ctx));
const api = app.listen(0, '127.0.0.1'); await new Promise((r) => api.once('listening', r));
const call = (who, body) => new Promise((resolve, reject) => {
  const rq = http.request(`http://127.0.0.1:${api.address().port}/jobs`, { method: 'POST', headers: { 'x-user': who, 'content-type': 'application/json' } }, (res) => { let out = ''; res.on('data', (d) => { out += d; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(out || 'null') })); });
  rq.on('error', reject); rq.end(JSON.stringify(body));
});
const leadBody = (rid, extra) => Object.assign({ company_id: 'co-new', position: 'Operations Manager', source: 'Other', stage: 'Active', contacts: [{ first_name: 'Nathan', last_name: 'W', email: 'nathan@fultontechnology.com' }], from_reminder_id: rid }, extra || {});
const jobsBefore = () => fake.tables.jobs.length;

let n0 = jobsBefore();
let r = await call('martin', leadBody('R-martin'));
const made = fake.tables.jobs.find((j) => j.position === 'Operations Manager');
step('Martin\'s reminder becomes a lead OWNED by Martin, stage Assigned', r.status === 201 && made && made.assigned_to_bd === 'martin' && made.stage === 'Assigned', JSON.stringify({ s: r.status, j: r.json && r.json.error, made }).slice(0, 220));
step('…sending from his MAIN mailbox (the one marked primary)', made && made.sending_email_id === 'mb-main', made && made.sending_email_id);
const rem = fake.tables.reminders.find((x) => x.id === 'R-martin');
const nathan = fake.tables.contacts.find((c) => c.email === 'nathan@fultontechnology.com');
step('…and the reminder is now tied to that lead and its contact', rem.job_id === (made && made.id) && nathan && rem.contact_id === nathan.id, JSON.stringify(rem));

n0 = jobsBefore();
r = await call('martin', leadBody('R-other', { position: 'Someone else 1' }));
step('someone ELSE\'s reminder → 404, nothing written', r.status === 404 && jobsBefore() === n0, r.status);
r = await call('martin', leadBody('R-linked', { position: 'Someone else 2' }));
step('a reminder already on a lead → 409, nothing written', r.status === 409 && /already about a lead/.test(r.json.error) && jobsBefore() === n0, JSON.stringify(r.json));
r = await call('martin', leadBody('R-dup', { position: 'Someone else 3' }));
step('a person already a contact on a lead (any case) → 409 naming where, nothing written', r.status === 409 && /already a contact on a lead in PACE \(Plant Manager at Known Co\)/.test(r.json.error) && jobsBefore() === n0, JSON.stringify(r.json));
r = await call('ra1', leadBody('R-ra', { position: 'Someone else 4' }));
step('an RA (who does not own leads) → 403, nothing written', r.status === 403 && jobsBefore() === n0, r.status);
r = await call('martin', { company_id: 'co-new', position: 'Plain add', contacts: [{ first_name: 'Q', email: 'q@fultontechnology.com' }] });
const plain = fake.tables.jobs.find((j) => j.position === 'Plain add');
step('an ordinary Add Lead (no reminder) is unchanged: nobody owns it yet', r.status === 201 && plain && !plain.assigned_to_bd, JSON.stringify(plain).slice(0, 160));
api.close();

// ── the screen ──
const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const web = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((ok) => web.listen(0, '127.0.0.1', () => ok(web.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; if (fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); const d = fs.existsSync(b) ? fs.readdirSync(b).find((x) => /^chromium-/.test(x)) : null; return d ? path.join(b, d, 'chrome-linux', 'chrome') : undefined; }
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await bctx.route('**', (rt) => { const u = rt.request().url(); return u.startsWith(BASE + '/') && /\.(html|js|css)$|\/$/.test(new URL(u).pathname) ? rt.continue() : rt.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  const page = await bctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitForLogin(page);
  await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);
  const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await ev(([t, l]) => {
    STATE.companies = [{ id: 'co-new', name: 'Fulton Technology' }];
    STATE.reminders = window.__rems = [
      { id: 'R1', user_id: 'test-bd', job_id: null, contact_id: null, contact_name: 'Nathan W', company_name: 'Fulton Technology', email: 'nathan@fultontechnology.com', reminder_type: 'manual', return_date: t, reminder_time: '09:00', status: 'pending' },
      { id: 'R2', user_id: 'test-bd', job_id: 'L9', contact_id: 'c9', contact_name: 'Known Person', company_name: 'Known Co', email: 'kp@known.co', reminder_type: 'followup', return_date: t, reminder_time: '09:00', status: 'pending' },
      { id: 'R3', user_id: 'test-bd', job_id: null, contact_id: null, contact_name: 'Ava Stone', company_name: 'Brand New Inc', email: 'ava@brandnew.io', reminder_type: 'manual', return_date: l, reminder_time: '10:00', status: 'pending' },
    ];
    window.__posts = []; window.apiPost = (p, b) => { window.__posts.push([p, b]); return Promise.resolve(p === '/companies' ? { id: 'co-made', name: b.name } : { id: 'L-new' }); };
    window.refreshJobs = () => Promise.resolve();
    goPage('reminders');
  }, [today, later]);
  await page.waitForTimeout(250);
  const btns = await ev(() => [...document.querySelectorAll('[onclick^="reminderAddLead("]')].map((b) => b.getAttribute('onclick')));
  step('the screen: "Add as lead" shows on the reminder about someone PACE does not know (due card + upcoming row) …', btns.includes("reminderAddLead('R1')") && btns.includes("reminderAddLead('R3')"), JSON.stringify(btns));
  step('…and NOT on a reminder that is already about a lead', !btns.includes("reminderAddLead('R2')"));
  await ev(() => reminderAddLead('R1')); await page.waitForTimeout(150);
  const form = await ev(() => ({ banner: (document.getElementById('al-from-rem') || {}).innerText || '', a: JSON.parse(JSON.stringify(STATE.addLead)) }));
  step('…it opens Add Lead filled in: Nathan / W / his email, with the company PACE already has (Fulton Technology)',
    form.a.contacts[0].first_name === 'Nathan' && form.a.contacts[0].last_name === 'W' && form.a.contacts[0].email === 'nathan@fultontechnology.com' && form.a.mode === 'existing' && form.a.company && form.a.company.id === 'co-new', JSON.stringify(form.a).slice(0, 240));
  step('…and says where it came from and that the lead will be yours', /From your reminder for Nathan W/.test(form.banner) && /will be yours/.test(form.banner), form.banner);
  await page.fill('#al-pos', 'Operations Manager'); await ev(() => addLeadField('pos', 'Operations Manager'));
  await ev(() => submitAddJob()); await page.waitForTimeout(250);
  const posts = await ev(() => window.__posts);
  const jobPost = posts.find(([p]) => p === '/jobs');
  step('Add lead sends the reminder with it (from_reminder_id), so the server makes it yours', jobPost && jobPost[1].from_reminder_id === 'R1' && jobPost[1].company_id === 'co-new' && jobPost[1].contacts[0].email === 'nathan@fultontechnology.com', JSON.stringify(posts).slice(0, 260));
  step('…and after saving, the reminders are asked for again (so the button goes from the one now on a lead)', await ev(() => Array.isArray(STATE.reminders) && STATE.reminders.length === 0 && window.__rems.length === 3));
  await ev(() => { window.__posts.length = 0; STATE.reminders = window.__rems; reminderAddLead('R3'); }); await page.waitForTimeout(120);
  const a3 = await ev(() => JSON.parse(JSON.stringify(STATE.addLead)));
  step('a company PACE does not have is filled in as a NEW company by its name', a3.mode === 'new' && a3.newCo.name === 'Brand New Inc' && a3.contacts[0].first_name === 'Ava', JSON.stringify(a3).slice(0, 200));
  await ev(() => { closeModal(); openAddJob(); }); await page.waitForTimeout(100);
  step('the ordinary Add Lead window has no reminder banner and sends no reminder', await ev(() => !document.getElementById('al-from-rem') && !STATE.addLead.fromReminder));
  step('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { step('the screen suite ran', false, e.stack || String(e)); }
finally { if (browser) await browser.close(); web.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
