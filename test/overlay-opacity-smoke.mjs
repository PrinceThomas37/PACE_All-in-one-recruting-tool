// ============================================================================
// A FLOAT MUST BE OPAQUE, AND A PHONE'S TYPE SCALE MUST INCLUDE ITS INPUTS
// ----------------------------------------------------------------------------
// Both faults came off the owner's phone on the same morning, and neither was
// visible to any existing suite.
//
// 1 · TRANSPARENCY. `--card` is GLASS in the themed skin — 62% in light, 5.5%
//     in dark. `.modal,.drawer,.dw` are repainted with `--card-solid` by
//     theme.css, but a hand-rolled panel with an inline `background:var(--card)`
//     and no class never meets that rule. Twelve of them were see-through: the
//     Connected-leads drawer, the leads filter dropdowns, every zip/company
//     autocomplete. The page behind showed through and the two sets of text
//     overlapped, which is what the owner photographed.
//     **An inline colour cannot be re-themed** — CLAUDE.md already says so about
//     literals; a token can be inline and still be the WRONG token.
//
// 2 · TYPE SCALE. A phone raises inputs to 16px so iOS does not zoom on focus.
//     That is right and must not be weakened. But it was applied to inputs
//     ALONE, so in the Edit Job modal at 390px the value you type was 16px
//     while its own label was 11.5px — the thing you type became the largest
//     body text on screen, larger than the headings organising it. Measured,
//     not guessed: the same modal on a desktop spans 11.5→13.5px and reads
//     correctly.
//
// Both are measured through a real browser at a real width. A grep cannot see
// either one.
//
// KNOWN LIMIT, stated so its presence is not mistaken for coverage:
// styles.css also declares `--card-solid`, beside the `--card` it already owns.
// theme.css is loaded unconditionally with an unscoped `:root`, so that base
// declaration never decides anything today and DELETING IT FAILS NOTHING HERE —
// verified by deleting it. It is kept as defence in depth (a sheet that defines
// one half of a pair should define the other), not because this suite proves it.
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const results = [];
const step = (name, pass, detail) => results.push({ name, ok: !!pass, detail: detail == null ? '' : String(detail) });
const alphaOf = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const p = m[1].split(',').map(s => parseFloat(s)); return p.length < 4 ? 1 : p[3]; };

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

  async function open(theme, width = 390) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitForLogin(page); await enterApp(page);
    await page.waitForSelector('#sidebar', { timeout: 15000 });
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    return page;
  }

  // ── 1 · no float is painted with the glass token ──────────────────────────
  // Source-level, because it is the rule a future edit will break: a NEW panel
  // written with `background:var(--card)` is the fault coming back.
  {
    const files = fs.readdirSync(path.join(PUBLIC_DIR, 'js')).filter(f => f.endsWith('.js'));
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(PUBLIC_DIR, 'js', f), 'utf8');
      const re = /position:(?:fixed|absolute)[^"']*?background:var\(--card\)(?!-solid)/g;
      let m; while ((m = re.exec(src))) offenders.push(f + ': …' + m[0].slice(-60));
    }
    step('no floating panel is painted with the glass --card token', offenders.length === 0, offenders.join(' || '));
  }

  // ── 2 · the drawer really is opaque, in both themes ───────────────────────
  for (const theme of ['dark', 'light']) {
    const page = await open(theme);
    const bg = await page.evaluate(() => {
      STATE.jobs = []; STATE.contacts = {};
      STATE.page = 'leads'; STATE.leadsConnectedOpen = true; render();
      // The drawer is the fixed panel that is not the scrim.
      const panels = [...document.querySelectorAll('div')].filter(d => {
        const cs = getComputedStyle(d);
        return cs.position === 'fixed' && d.getBoundingClientRect().width > 200 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      });
      const p = panels[panels.length - 1];
      return p ? getComputedStyle(p).backgroundColor : null;
    });
    step(`the Connected-leads drawer has an opaque ground in ${theme}`, bg && alphaOf(bg) === 1, bg);
    await page.close();
  }

  // ── 3 · the phone type scale includes its own inputs ──────────────────────
  const measure = async (width) => {
    const page = await open('light', width);
    const sizes = await page.evaluate(() => {
      STATE.bd = STATE.bd || {};
      STATE.bd.jobOrders = [{ id: 'j1', job_code: 'JO-1', job_title: 'HVAC Service Technician', client: 'Griffith',
        city: 'Westminster', state: 'Maryland', primary_skills: 'hvac, epa', exp_min: 3, exp_max: 5, job_type: 'Full-time' }];
      window.bdOpenEditJob('j1'); render();
      const root = document.querySelector('#layer') || document.body;
      const px = el => parseFloat(getComputedStyle(el).fontSize);
      const ctl = [...root.querySelectorAll('input.sel,select.sel,textarea.sel')].filter(e => e.getBoundingClientRect().width);
      const lbl = [...root.querySelectorAll('label')].filter(e => e.getBoundingClientRect().width);
      const hd  = root.querySelector('.mhd');
      const fams = new Set([...root.querySelectorAll('*')]
        .filter(e => e.getBoundingClientRect().width)
        .map(e => getComputedStyle(e).fontFamily));
      return {
        input: ctl.length ? Math.max(...ctl.map(px)) : null,
        label: lbl.length ? Math.min(...lbl.map(px)) : null,
        heading: hd ? px(hd) : null,
        families: [...fams].length
      };
    });
    await page.close();
    return sizes;
  };

  const phone = await measure(390);
  const desk = await measure(1280);

  step('the phone still raises inputs to 16px (iOS will not zoom)', phone.input === 16, phone.input);
  step('the input is NOT the largest text in the modal on a phone',
    phone.heading > phone.input, `heading ${phone.heading} vs input ${phone.input}`);
  step('a label is within 4px of the field it labels on a phone',
    phone.input - phone.label <= 4, `input ${phone.input}, label ${phone.label}`);
  step('one font family throughout the modal', phone.families === 1, phone.families + ' families');

  // Desktop must be untouched by any of this.
  step('desktop input size is unchanged (13.5px)', desk.input === 13.5, desk.input);
  step('desktop label size is unchanged (11.5px)', desk.label === 11.5, desk.label);
  step('desktop heading size is unchanged (16px)', desk.heading === 16, desk.heading);
} catch (e) {
  step('harness completed', false, e && e.message);
} finally {
  if (browser) await browser.close();
  server.close();
}

let failed = 0;
console.log('\n=== OVERLAY OPACITY & PHONE TYPE SCALE ===');
for (const r of results) { if (!r.ok) failed++; console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`); }
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
