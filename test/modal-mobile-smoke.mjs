// ============================================================================
// EVERY POP-UP FORM, ON A PHONE.
//
// Session 26 found the New Job modal drawing three columns at 390px and pushing
// its whole right column — Client, Work Authorization, City, End Date — 72px
// off-screen, where `#content: overflow-x:hidden` made it unreachable. The
// cause was a grid written into a `style=""` attribute, and an inline style
// cannot be re-laid-out by any stylesheet.
//
// That modal was not special. This is the sweep the owner asked for: open each
// pop-up at 390px and measure what sticks out.
//
// `mobile-layout-smoke.mjs` walks 16 PAGES and has always passed — because it
// never opens a modal. A suite only covers the screens it renders.
//
// ⚠ THE TRAP THIS TEST HAD TO AVOID: an opener that throws, or that needs state
// the stub did not provide, renders nothing — and "nothing" has no overflow, so
// it would PASS while measuring air. Every case therefore asserts the modal
// actually rendered something first, and an opener that fails to open is a
// FAILURE, not a skip.
//
// `12-manager-users.js` is deliberately excluded: CLAUDE.md records that page as
// orphaned and unreachable via nav. Testing its layout would report coverage of
// a screen nobody can open.
// ============================================================================
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
let pass = 0, fail = 0;
const results = [];
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } };

const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => {
    if (e) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(d);
  });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const findChromium = () => process.env.PLAYWRIGHT_CHROMIUM
  || (process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'))
      ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : 'chromium');

// Each case names the pop-up in the owner's words and the call that opens it.
// Anything needing records gets them seeded, because an empty modal measures
// nothing.
const CASES = [
  ['New job',                 "bdOpenNewJob(null)"],
  ['New job — Client & POC',  "bdOpenNewJob(null); STATE.bd.form.company_id='co-1'; STATE.bd.form.client='Treplar Inc'; STATE.bd.form.intake=__INTAKE; bdFormTab('client')"],
  ['New job — Skills',        "bdOpenNewJob(null); bdFormTab('skills')"],
  ['New job — Organizational',"bdOpenNewJob(null); bdFormTab('org')"],
  ['Edit job',                "STATE.bd.jobOrders=[__JOB]; bdOpenEditJob('jo-1')"],
  ['Add a reminder',          "remOpenAdd()"],
  ['System settings',         "openSystemSettingsModal()"],
  ['Integrations',            "openIntegrationsModal()"],
  ['Export leads',            "openExportLeads()"],
  ['Send all — confirm',      "STATE.pendingEmails=[{id:'e1',to_email:'dana@treplar.com'},{id:'e2',to_email:'m@x.com'}]; openSendAllConfirm()"],
  ['Assign leads — confirm',  "STATE.assignSel={'j1':true}; STATE.assignTargetBD='u1'; openAssignConfirm()"],
  ['Distribute to a manager', "STATE._assignManagerId='u1'; STATE._assignRatio={total_to_send:40,per_ra:[]}; STATE.userEmailsCache={u1:[{id:'ea1',email:'asha@x.com',is_active:true,daily_send_limit:300}]}; confirmAssignToManager()"],
  ['ATS lookups manager',     "atsOpenLookupsManager()"],
  ['Out of office',           "changeEmailStatus('c1','out_of_office','dana@treplar.com','Dana Reyes')"],
  ['Email this client',       "STATE.clients={list:[{id:'co-1',name:'Treplar Inc'}],contacts:[{email:'dana@treplar.com',name:'Dana Reyes'}],selDocs:{},docs:[]}; clientsOpenEmail('co-1')"],
  ['Job posting JD',          "STATE.bd.jobOrders=[__JOB]; bdOpenPostingJD('jo-1')"],
  ['Assign recruiters',       "STATE.bd.jobOrders=[__JOB]; bdOpenAssign('jo-1')"],
  ['Candidate stage',         "STATE.bd.submissions=[__SUB]; openStageModal('sub-1','Interview Scheduled')"],
];

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });

  for (const [theme] of [['light'], ['dark']]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    const page = await context.newPage();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitForLogin(page); await enterApp(page);
    await page.waitForSelector('#sidebar', { timeout: 15000 });

    await page.evaluate((th) => {
      document.documentElement.setAttribute('data-theme', th);
      STATE.user.role = 'admin'; STATE.user.roles = ['admin', 'bd_manager', 'recruiter'];
      window.__JOB = { id: 'jo-1', job_code: 'JOB-1', job_title: 'Industrial Electrician', client: 'Treplar Inc',
        city: 'Martinsburg', state: 'West Virginia', country: 'United States', status: 'Active', priority: 'High',
        positions: 2, pay_cur: 'USD', pay_min: '28', pay_max: '35', primary_skills: 'HVAC, EPA', recruiters: [],
        job_description: 'A long job description. '.repeat(30), posting_description: 'Posting text.' };
      window.__SUB = { id: 'sub-1', stage: 'Screening', candidate: { id: 'c1', full_name: 'Dana Reyes' }, job_order_id: 'jo-1' };
      window.__INTAKE = { id: 'co-1', name: 'Treplar Inc', address: { address_line1: '1400 Edwin Miller Blvd', city: 'Martinsburg', state: 'WV', postal_code: '25404', country: 'United States' },
        lead_count: 3, contacts: [{ first_name: 'Dana', last_name: 'Reyes', email: 'dana@treplar.com', designation: 'Ops Manager', phone: '304-555-0142', is_primary: true }],
        cooldown: { blocked: false } };
      STATE.users = [{ id: 'u1', name: 'Asha Rao', role: 'bd_manager', email: 'asha@x.com' },
                     { id: 'u2', name: 'Marcus Hale', role: 'recruiter', email: 'm@x.com' }];
      STATE.companies = [{ id: 'co-1', name: 'Treplar Inc' }];
      STATE.jobs = [{ id: 'j1', position: 'Welder', company_name: 'Treplar Inc', company_id: 'co-1', stage: 'Assigned', contacts: [] }];
      STATE.contacts = { c1: { id: 'c1', first_name: 'Dana', last_name: 'Reyes', email: 'dana@treplar.com', job_id: 'j1' } };
      STATE.clients = [{ id: 'co-1', name: 'Treplar Inc', job_orders: [], documents: [] }];
      STATE.bd = STATE.bd || {}; STATE.bd.jobOrders = [window.__JOB]; STATE.bd.view = {};
      const ok = (v) => Promise.resolve(v);
      window.apiGet = (p) => {
        if (/\/intake/.test(p)) return ok(window.__INTAKE);
        if (/companies\/search/.test(p)) return ok([{ id: 'co-1', name: 'Treplar Inc', job_count: 3 }]);
        if (/settings\/numbers/.test(p)) return ok([{ key: 'company_cooldown_days', label: 'Company re-add cooldown', unit: 'days', group: 'Leads', value: 21, min: 0, max: 365, description: 'How long before an RA can add it again.' }]);
        if (/integrations/.test(p)) return ok([{ id: 'groq', name: 'Groq', fields: [{ key: 'api_key', label: 'API key' }] }]);
        if (/job-orders\/jo-1/.test(p)) return ok(window.__JOB);
        if (/documents|job-orders|contacts|clients|candidates|users|lookups/.test(p)) return ok([]);
        return ok([]);
      };
      window.apiPost = () => ok({}); window.apiPut = () => ok({}); window.apiDelete = () => ok({});
      window.loadJobOrders = () => {};
    }, theme);

    console.log(`\nPop-ups at 390px — ${theme}`);
    for (const [label, call] of CASES) {
      await ta(`${label} (${theme})`, async () => {
        await page.evaluate(() => { closeModal && closeModal(); STATE.modal = null; render(); });
        await page.waitForTimeout(80);
        const opened = await page.evaluate((c) => {
          try { eval(c); } catch (e) { return { err: String(e && e.message || e) }; }
          return { err: null };
        }, call);
        assert.equal(opened.err, null, 'the opener threw: ' + opened.err);
        await page.waitForTimeout(320);
        const m = await page.evaluate(() => {
          const layer = document.getElementById('layer');
          const panel = layer && layer.querySelector('.modal, .drawer, .dw');
          if (!panel) return { drew: false };
          const pr = panel.getBoundingClientRect();

          // ── 1. anything whose right edge is past the viewport ──────────────
          let worst = 0, who = '';
          panel.querySelectorAll('*').forEach(el => {
            const b = el.getBoundingClientRect(); if (!b.width || !b.height) return;
            let p = el.parentElement, boxed = false;
            while (p && p !== panel) {
              const ov = getComputedStyle(p).overflowX;
              if ((ov === 'auto' || ov === 'scroll') && p.scrollWidth > p.clientWidth + 1) { boxed = true; break; }
              p = p.parentElement;
            }
            if (boxed) return;
            const over = b.right - window.innerWidth;
            if (over > worst) { worst = over; who = (el.className || el.tagName) + ''; }
          });

          // ── 2. content hidden INSIDE the pop-up ────────────────────────────
          // The measure that actually catches an inline grid. A 3-column grid at
          // 390px does not push anything past the viewport — it makes the modal
          // body 451px wide inside a 369px box and clips 82px. Nothing's right
          // edge is off-screen, so check 1 sees nothing at all.
          let hidden = 0, hiddenWho = '';
          const boxes = [panel].concat([].slice.call(panel.querySelectorAll('*')));
          boxes.forEach(el => {
            const over = el.scrollWidth - el.clientWidth;
            if (!el.clientWidth) return;
            const ov = getComputedStyle(el).overflowX;
            if (ov === 'auto' || ov === 'scroll') return;   // allowed to scroll in its own box
            if (over > hidden) { hidden = over; hiddenWho = (el.className || el.tagName) + ''; }
          });

          // ── 3. a field crushed too narrow to use ───────────────────────────
          // "Reflow, never shrink" (CLAUDE.md). The inline grid squeezed the Job
          // Title box to 55px rather than stacking — technically on-screen, and
          // useless.
          let narrowest = 9999, narrowWho = '';
          panel.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea').forEach(el => {
            const b = el.getBoundingClientRect();
            if (!b.width || !b.height) return;
            if (b.width < narrowest) { narrowest = Math.round(b.width); narrowWho = (el.placeholder || el.className || el.tagName) + ''; }
          });
          if (narrowest === 9999) { narrowest = -1; }

          const bg = getComputedStyle(panel).backgroundColor;
          const alpha = /rgba?\(([^)]+)\)/.exec(bg);
          const a = alpha ? parseFloat(alpha[1].split(',')[3] ?? '1') : 1;
          return { drew: true, h: Math.round(pr.height), w: Math.round(pr.width),
                   worst: Math.round(worst), who: String(who).slice(0, 46),
                   hidden: Math.round(hidden), hiddenWho: String(hiddenWho).slice(0, 46),
                   narrowest, narrowWho: String(narrowWho).slice(0, 36),
                   bg, alpha: a,
                   scrollW: document.documentElement.scrollWidth, vw: window.innerWidth };
        });
        // An opener that rendered nothing measures nothing and must not pass.
        assert.ok(m.drew, 'no pop-up was drawn — this case measured nothing');
        assert.ok(m.h > 60, 'the pop-up drew only ' + m.h + 'px tall — probably empty');
        results.push({ label, theme, worst: m.worst, who: m.who, hidden: m.hidden, hiddenWho: m.hiddenWho, narrowest: m.narrowest });
        assert.ok(m.worst <= 1, 'off-screen by ' + m.worst + 'px: ' + m.who);
        assert.ok(m.hidden <= 1, 'clips ' + m.hidden + 'px of its own content: ' + m.hiddenWho);
        // 90px fits neither a date nor a sensible amount of typing. The crushed
        // New Job column measured 55px.
        assert.ok(m.narrowest === -1 || m.narrowest >= 90,
          'a field is squeezed to ' + m.narrowest + 'px: ' + m.narrowWho);
        assert.ok(m.alpha >= 0.98, 'the pop-up is see-through (' + m.bg + ') — the page shows through it');
        assert.ok(m.scrollW <= m.vw, 'the page itself scrolls sideways (' + m.scrollW + ' > ' + m.vw + ')');
      });
    }
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

const bad = results.filter(r => r.worst > 1 || r.hidden > 1 || (r.narrowest !== -1 && r.narrowest < 90));
if (bad.length) {
  console.log('\nProblems:');
  bad.forEach(r => console.log(`   ${r.label} (${r.theme}) — off-screen ${r.worst}px, clipped ${r.hidden}px (${r.hiddenWho}), narrowest field ${r.narrowest}px`));
}
console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
