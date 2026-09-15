// CAN YOU ACTUALLY READ IT? (Session 23, D-0015)
//
// The theme re-skins the app by redefining CSS variables, which works for
// everything that READS those variables — and silently fails for everything
// that hard-codes a colour instead. Two ways that already bit, both invisible
// to every other test and both found only by looking at a screenshot:
//
//   * the dashboard clock and the "Your team's desk" chip carried white in an
//     INLINE style, because the banner used to be a dark green slab. On a light
//     banner they became white-on-white;
//   * ui.css carries its OWN palette (--ink / --ink2 / --line / --hover),
//     separate from styles.css's --text / --border. Overriding only --text left
//     the whole Leads table drawing #0F172A ink on dark glass.
//
// A theme has to reach EVERY palette in the app, not the one it found first.
// So this measures the thing that actually matters — the contrast between text
// and whatever is really painted behind it — on every page, in both themes.
//
// Usage: node test/theme-contrast-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin, switchRole } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const step = (n, ok, d='') => { results.push(ok); console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:'')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

// Below this, text is not "low contrast by choice" — it is unreadable. Real
// muted text in this app sits around 4; dark-ink-on-dark-ground measures ~1.2.
// 2.2 catches the breakage without arguing about deliberate hierarchy.
const MIN_RATIO = 2.2;

const CONTRAST_PROBE = ({ minRatio, scope }) => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s.trim()));
    return { r:p[0], g:p[1], b:p[2], a:p.length>3?p[3]:1 };
  };
  const lin = (v) => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  const lum = (c) => 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
  const over = (fg, bg) => ({ r:fg.r*fg.a+bg.r*(1-fg.a), g:fg.g*fg.a+bg.g*(1-fg.a), b:fg.b*fg.a+bg.b*(1-fg.a), a:1 });
  // What is REALLY behind this element: composite every translucent ancestor
  // down onto the page ground. A single getComputedStyle cannot tell you this,
  // which is exactly why glass hides the bug.
  const effectiveBg = (el) => {
    const stack = [];
    let painted = null;                 // an ancestor we cannot measure
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      // A GRADIENT (or image) reports backgroundColor rgba(0,0,0,0), so a naive
      // walk sails straight past it to whatever is behind — which is how the
      // login header's green slab read as the pale green page behind it and
      // produced a false failure. We cannot resolve a gradient to one colour,
      // so we decline to judge rather than judging wrongly.
      if (cs.backgroundImage && cs.backgroundImage !== 'none') { painted = 'image'; break; }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
    }
    if (painted) return null;
    let base = parse(getComputedStyle(document.documentElement).backgroundColor) || { r:255,g:255,b:255,a:1 };
    if (base.a === 0) base = { r:255,g:255,b:255,a:1 };
    let acc = base;
    for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
    return acc;
  };

  const bad = [];
  const els = document.querySelectorAll(scope);
  for (const el of els) {
    if (el.children.length) continue;                     // leaf text only
    const txt = (el.textContent || '').trim();
    if (txt.length < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.35) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const fg = parse(cs.color); if (!fg || fg.a < 0.35) continue;
    const bg = effectiveBg(el);
    if (!bg) continue;                  // sits on a gradient/image — not judged
    const composited = over(fg, bg);
    const l1 = lum(composited), l2 = lum(bg);
    const ratio = (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
    if (ratio < minRatio) {
      bad.push({ txt: txt.slice(0,28), cls: String(el.className||'').slice(0,26),
                 color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
                 ratio: Math.round(ratio*100)/100 });
    }
  }
  return bad.sort((a,b)=>a.ratio-b.ratio).slice(0,6);
};

// A page is not one screen. Setting STATE.page alone renders every multi-tab
// page as its DEFAULT tab, so Email's Sent and Outreach Plan were never drawn
// once — and both shipped with unreadable text the owner found on their phone.
// Each entry is [page, subState] where subState is merged into STATE.
const SCREENS = [
  ['dashboard'], ['leads'], ['applicants'], ['reports'], ['myteam'],
  ['bd_joborders'], ['clients'], ['sourced'], ['insights'], ['reminders'], ['admin'],
  ['email', { emailTab:'pending' }],
  ['email', { emailTab:'compose' }],
  ['email', { emailTab:'sent' }],
  ['email', { emailTab:'allmail' }],
  ['email', { emailTab:'outreachplan' }],
  ['email', { emailTab:'sequence' }],
];
const ROLES = ['admin','bd','recruiter'];

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });

  for (const theme of ['dark','light']) {
    const ctx = await browser.newContext({ viewport:{width:1440,height:950} });
    await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    await ctx.addInitScript((t)=>{ try{ localStorage.setItem('pace-theme', t); }catch(e){} }, theme);
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil:'domcontentloaded' });
    await waitForLogin(page);
    await enterApp(page, 'admin');

    // The theme must actually be on, or this whole suite proves nothing.
    const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    step(`the ${theme} theme is really applied`, applied === theme, `data-theme=${applied}`);

    const offenders = [];
    let screens = 0;
    for (const role of ROLES) {
      await switchRole(page, role);
      for (const [p, sub] of SCREENS) {
        await page.evaluate(({pp, ss})=>{
          window.STATE.page = pp;
          if (ss) Object.assign(window.STATE, ss);
          window.render();
        }, { pp:p, ss:sub || null });
        await page.waitForTimeout(110);
        screens++;
        const label = sub ? `${p}:${Object.values(sub).join('/')}` : p;
        const bad = await page.evaluate(CONTRAST_PROBE, { minRatio: MIN_RATIO, scope: '#content *, #topbar *, #sidebar *' });
        for (const b of bad) offenders.push(`${theme}/${role}/${label}: "${b.txt}" ${b.color} on ${b.bg} = ${b.ratio}:1`);
      }
    }
    step(`every screen is readable in ${theme} (${screens} screens)`,
      offenders.length === 0, offenders.slice(0,5).join(' | '));

    // INTERACTIVE STATES. Everything above renders a screen AT REST, so the
    // hover palette and the open-row palette were never drawn once — and
    // `tr:hover td{background:#FAFBFC}` (a literal in styles.css, set on the
    // CELL, which paints over its row) made every detail of a hovered or
    // opened Leads row white-on-white in dark. The owner found it; six screens
    // x three roles x two themes did not, because a colour that only exists
    // under the pointer is invisible to a screenshot of the page at rest.
    // A palette has states. Drive them.
    await switchRole(page, 'bd');
    const rows = await page.evaluate(()=>{
      const t = new Date().toISOString();
      window.STATE.companies = [{ id:'co0', name:'Contrast Co' }];
      window.STATE.contacts  = [{ id:'ct0', job_id:'j0', company_id:'co0', first_name:'Ada',
        last_name:'Byron', email:'ada@contrast.co', designation:'Head of Ops',
        is_primary:true, email_status:'valid' }];
      window.STATE.jobs = [{ id:'j0', position:'Payroll Specialist', pos:'Payroll Specialist',
        company_id:'co0', company_name:'Contrast Co', company:{ name:'Contrast Co' },
        location:'Oklahoma City, OK', loc:'Oklahoma City, OK', stage:'Assigned',
        industry:'Truck Transportation', date:t.slice(0,10), created_at:t,
        assigned_to_bd:'test-bd', assigned_bd_name:'BD Lead 2', assigned_at:t, contacts:[] }];
      window.STATE.leads = window.STATE.jobs;
      window.STATE.page = 'leads';
      window.render();
      return document.querySelectorAll('#content tr[data-row-id]').length;
    });
    await page.waitForTimeout(150);
    // A state test with nothing to put in that state passes vacuously. Two
    // guards died that way this session; this one says so out loud.
    step(`the state pass has a row to drive in ${theme}`, rows > 0, `${rows} rows`);

    const stateBad = [];
    if (rows > 0) {
      await page.hover('#content tr[data-row-id="j0"]');
      await page.waitForTimeout(120);
      for (const b of await page.evaluate(CONTRAST_PROBE, { minRatio: MIN_RATIO, scope: '#content tr[data-row-id] *' }))
        stateBad.push(`hover: "${b.txt}" ${b.color} on ${b.bg} = ${b.ratio}:1`);
      // ...and opened, which is both `.is-open` AND still hovered.
      await page.click('#content tr[data-row-id="j0"]');
      await page.waitForTimeout(220);
      for (const b of await page.evaluate(CONTRAST_PROBE, { minRatio: MIN_RATIO, scope: '#content tr[data-row-id] *, #content .lead-expand *' }))
        stateBad.push(`open: "${b.txt}" ${b.color} on ${b.bg} = ${b.ratio}:1`);
    }
    step(`a hovered and an opened row stay readable in ${theme}`,
      stateBad.length === 0, stateBad.slice(0,5).join(' | '));

    // THE LOGGED-OUT SCREEN. enterApp() signs in, so this suite never rendered
    // the login page once — and it shipped with invisible SSO buttons and
    // invisible field labels. It is the FIRST thing anyone sees.
    await page.evaluate(()=>{
      window.STATE.user = null; window.STATE.token = null; window.render();
    });
    await page.waitForTimeout(250);
    // The login screen lives outside the app shell, so it needs the whole body.
    const loginBad = await page.evaluate(CONTRAST_PROBE, { minRatio: MIN_RATIO, scope: 'body *' });
    step(`the login screen is readable in ${theme}`, loginBad.length === 0,
      loginBad.slice(0,4).map(b=>`"${b.txt}" ${b.color} on ${b.bg} = ${b.ratio}:1`).join(' | '));

    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r=>!r).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
