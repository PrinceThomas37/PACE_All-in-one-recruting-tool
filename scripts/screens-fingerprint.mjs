#!/usr/bin/env node
// A BEFORE/AFTER LOOK AT THE REAL APP — for invisible work (R-013) that must change nothing on screen.
// Renders every page (and the sub-tabs, a few popups) as several roles, at desktop and phone width, in the default,
// light and dark palettes, with the same seeded data, and writes a fingerprint of EVERY element's computed look
// (font size, colour, weight, line height, display) and its size/position. Run it on two checkouts and diff the files:
//   node scripts/screens-fingerprint.mjs --root=/path/to/checkout --out=/tmp/before.json
//   node scripts/screens-fingerprint.mjs --out=/tmp/after.json
//   node scripts/screens-fingerprint.mjs --diff /tmp/before.json /tmp/after.json
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const HERE = path.resolve(new URL('..', import.meta.url).pathname);
const arg = (k, d) => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').split('=').slice(1).join('=') || d;
if (process.argv.includes('--diff')) {
  const [a, b] = process.argv.slice(process.argv.indexOf('--diff') + 1).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  let n = 0, same = 0, onlyA = 0, onlyB = 0; const ex = [];
  for (const k of Object.keys(a)) { if (!(k in b)) { onlyA++; continue; } if (a[k] === b[k]) same++; else { n++; if (ex.length < 12) ex.push(k + '\n   before ' + a[k] + '\n   after  ' + b[k]); } }
  for (const k of Object.keys(b)) if (!(k in a)) onlyB++;
  console.log(JSON.stringify({ elementsCompared: same + n, identical: same, different: n, onlyBefore: onlyA, onlyAfter: onlyB }));
  ex.forEach(e => console.log(e)); process.exit(n || onlyA || onlyB ? 1 : 0);
}
const ROOT = path.resolve(arg('root', HERE)); const OUT = arg('out', '/tmp/fingerprint.json');
const { chromium } = require(path.join(HERE, 'node_modules/playwright-core'));
const { enterApp, switchRole, waitForLogin } = await import(path.join(HERE, 'test/helpers/enter-app.mjs'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(ROOT, 'public', p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const bpath = process.env.PLAYWRIGHT_BROWSERS_PATH;
const exe = process.env.PLAYWRIGHT_CHROMIUM || (bpath && fs.existsSync(path.join(bpath, 'chromium')) ? path.join(bpath, 'chromium') : 'chromium');
const SCREENS = [['dashboard'], ['leads'], ['email'], ['myteam'], ['bd_joborders'], ['bd_myjobs'], ['bd_jodetail'], ['bd_pipeline'], ['bd_kanban'], ['clients'], ['sourced'], ['insights'], ['reminders'], ['job_board'], ['admin'], ['assign'], ['workflows'], ['mailbox'],
  ['applicants', { ats: { view: 'grid' } }], ['applicants', { ats: { view: 'applied' } }], ['applicants', { ats: { view: 'sourcing' } }]];
const ROLES = ['admin', 'bd', 'recruiter', 'ra'];
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const out = {}; let screens = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage(); page.on('pageerror', () => {});
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  const seed = () => page.evaluate(() => {
    const S = window.STATE, now = new Date('2026-10-01T12:00:00Z').toISOString();
    S.bd = S.bd || {}; S.bd.view = Object.assign({}, S.bd.view, { joId: 'jo-1', pipelineJoId: 'jo-1', kanbanJoId: 'jo-1' });
    S.bd.jobOrders = [1, 2, 3].map(i => ({ id: 'jo-' + i, job_code: 'JO-' + i, job_title: ['HVAC Technician', 'Estimator', 'Project Manager'][i - 1], client: 'Northwind ' + i, status: i === 3 ? 'On Hold' : 'Open', city: 'Hartford', state: 'CT', job_type: 'Full-time', pay_rate: '$80/hr', primary_skills: 'Procore, Bluebeam', job_description: 'Service and repair commercial HVAC systems.', created_at: now, apply_enabled: i === 1, apply_token: 'a'.repeat(32), apply_count: 3 }));
    const cands = [['Jason Palencia', 'Project Manager'], ['Taylor Ray', 'Estimator'], ['Kevin Back', 'Superintendent'], ['Charles Hudson', 'Core Proficiencies']].map((p, i) => ({ id: 'c' + i, candidate_code: 'CN-0' + i, full_name: p[0], current_title: p[1], email: 'p' + i + '@mail.test', phone: '864-555-010' + i, city: 'Austin', state: 'TX', skills: ['hvac', 'sql'], extra_emails: [], extra_phones: [] }));
    S.bd.pipeline = cands.map((c, i) => ({ id: 'pl' + i, job_order_id: 'jo-1', pipeline_code: 'PL-' + i, candidate: c, submission: { id: 's' + i, stage: ['Sourced', 'Screening', 'Submitted to BDM', 'Interview Scheduled'][i] } }));
    S.bd.jobPipeline = S.bd.pipeline;
    S.bd.submissions = cands.map((c, i) => ({ id: 's' + i, job_order_id: 'jo-1', stage: ['Sourced', 'Screening', 'Submitted to BDM', 'Interview Scheduled'][i], candidate_id: c.id, candidate: c, created_at: now }));
    S.jobs = [1, 2, 3, 4].map(i => ({ id: 'l-' + i, position: ['Estimator', 'Site Superintendent', 'Project Engineer', 'Safety Manager'][i - 1], company_name: 'Acme ' + i, stage: ['Unassigned', 'Assigned', 'Contacted', 'Replied'][i - 1], location: 'Dallas, TX', created_at: now, assigned_to_bd: S.user && S.user.id, created_by: S.user && S.user.id, industry: 'Construction' }));
    S.contacts = [1, 2, 3, 4].map(i => ({ id: 'ct' + i, job_id: 'l-' + i, first_name: 'Maria', last_name: 'Lopez ' + i, designation: 'HR Director', email: 'm' + i + '@acme.test', phone: '(555) 111-222' + i, extra_emails: ['x' + i + '@acme.test'], extra_phones: [], linkedin: '', is_primary: i === 1, email_status: i === 3 ? 'invalid' : 'valid' }));
    S.leads = S.jobs; S.companies = [{ id: 'co1', name: 'Acme 1', web: 'acme.test', ind: 'Construction', loc: 'Dallas' }];
    S.reminders = [{ id: 'r1', title: 'Call Maria', due_date: '2026-10-01', status: 'pending', type: 'follow_up' }];
    S.candidates = cands; S.users = S.users || [];
  });
  const grab = (label) => page.evaluate((label) => {
    const o = {}; const roots = ['#sidebar', '#content', '#layer', '#topbar', 'header'];
    for (const sel of roots) { const r = document.querySelector(sel); if (!r) continue;
      const all = [r, ...r.querySelectorAll('*')]; const idx = new Map();
      for (const el of all) { const par = el.parentElement; const key = (par ? (idx.get(par) || sel) : sel); const n = (idx.get(key + '|c') || 0); idx.set(key + '|c', n + 1);
        const id = key + '>' + el.tagName.toLowerCase() + '[' + n + ']'; idx.set(el, id);
        const cs = getComputedStyle(el), rc = el.getBoundingClientRect();
        o[label + '|' + id] = [cs.fontSize, cs.color, cs.fontWeight, cs.lineHeight, cs.display, Math.round(rc.width), Math.round(rc.height), Math.round(rc.left), Math.round(rc.top)].join(' '); } }
    return o; }, label);
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 800 }]) {
    await page.setViewportSize(vp);
    for (const theme of [null, 'dark']) {
      await page.evaluate(t => { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }, theme);
      for (const role of ROLES) {
        await switchRole(page, role); await seed();
        for (const sc of SCREENS) {
          try {
            await page.evaluate(([p, sub]) => { const S = window.STATE; if (sub) for (const k of Object.keys(sub)) S[k] = Object.assign({}, S[k], sub[k]); S.modal = null; S.page = p; window.render(); }, sc);
            await page.waitForTimeout(40);
            Object.assign(out, await grab(vp.width + '|' + (theme || 'def') + '|' + role + '|' + sc[0] + (sc[1] ? JSON.stringify(sc[1]) : ''))); screens++;
          } catch (e) { /* the same pages fail the same way on both sides */ }
        }
      }
    }
  }
} finally { await browser.close(); server.close(); }
fs.writeFileSync(OUT, JSON.stringify(out)); console.log('screens: ' + screens + ', elements fingerprinted: ' + Object.keys(out).length + ' → ' + OUT);
