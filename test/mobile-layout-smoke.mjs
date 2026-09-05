// The app has to be usable on a phone. This pins the three things that were
// actually broken when the owner opened it on one (Session 19), plus the one
// rule that keeps the fix honest.
//
// WHAT IT LOOKED LIKE
//   1. The rail showed "WORK", "RECOR…", "OUTRE…", "INSIGH…" sliced down the
//      left edge with nav text overlapping the icons. A touch browser fires
//      :hover on tap and LEAVES IT STUCK, so tapping a nav item faded every
//      label in — inside a rail still 60px wide, because the old fix reset the
//      WIDTH on small screens and forgot the opacity. And with no hover there
//      was no way to read the menu at all: fourteen unlabelled icons.
//   2. Pages scrolled sideways. #content is overflow-x:auto, so one toolbar
//      wider than the screen dragged the WHOLE page — half a form off the
//      right edge, reachable only by swiping everything.
//   3. The dashboard greeting ran underneath the clock, which is absolutely
//      positioned over it and has no idea the text got taller.
//
// THE RULE THAT KEEPS IT FIXED
// #content is now overflow-x:hidden on a phone, which means a page that
// overflows no longer drags — it CLIPS, and clipped content is worse than
// content you can swipe to. So the overflow assertion below is not a nicety:
// it is the thing that makes hiding the overflow safe. It walks every element
// on every page for every role and fails on anything reaching past the content
// box that is not inside its own horizontal scroller.
//
// Usage: node test/mobile-layout-smoke.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin, switchRole } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
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
const step = (name, ok, detail = '') => {
  results.push(ok);
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
};
const pageErrors = [];
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

// Anything reaching past the right edge of #content, unless an ancestor is a
// horizontal scroller — a wide table inside .dt-wrap is correct; a toolbar
// hanging off the page is not.
const OVERFLOW_PROBE = () => {
  const c = document.getElementById('content');
  if (!c) return [{ tag: 'missing', cls: '#content', right: 0 }];
  const limit = c.getBoundingClientRect().right;
  const out = [];
  c.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (r.right <= limit + 1) return;
    for (let n = el.parentElement; n && n !== c; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return;
    }
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 30),
      right: Math.round(r.right),
      txt: (el.textContent || '').trim().slice(0, 24),
    });
  });
  return out.sort((a, b) => b.right - a.right).slice(0, 3);
};

let browser;
try {
  browser = await chromium.launch({
    executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  // ── A. A PHONE ────────────────────────────────────────────────────────────
  // isMobile + hasTouch is what makes Chromium report (hover:none)/(pointer:coarse),
  // which is the media query the rail fix is keyed on. Without it this test
  // would run as a narrow desktop and prove nothing about the actual bug.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  });
  await phone.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await phone.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'admin');

  const media = await page.evaluate(() => ({
    hover: matchMedia('(hover:none)').matches, coarse: matchMedia('(pointer:coarse)').matches,
  }));
  step('the emulated phone really reports a touch pointer', media.hover && media.coarse,
    'without this the rail assertions below are meaningless');

  // ── 1. THE RAIL ──────────────────────────────────────────────────────────
  const closed = await page.evaluate(() => {
    const sb = document.getElementById('sidebar');
    return {
      offscreen: sb.getBoundingClientRect().right <= 1,
      mainLeft: Math.round(document.getElementById('main').getBoundingClientRect().left),
      burger: !!document.querySelector('.tb-burger') &&
              getComputedStyle(document.querySelector('.tb-burger')).display !== 'none',
    };
  });
  step('the rail is off screen until it is asked for', closed.offscreen);
  step('the page gets the whole width, with nothing reserved for a rail', closed.mainLeft === 0,
    `#main starts at ${closed.mainLeft}px`);
  step('there is a visible way into the menu', closed.burger);

  // The original fault, reproduced exactly: a tap leaves :hover stuck on the
  // rail. The labels must NOT appear, because the rail is still narrow.
  await page.evaluate(() => {
    const el = document.querySelector('#sidebar .nav-item');
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const stuck = await page.evaluate(() => {
    const sb = document.getElementById('sidebar');
    return {
      width: Math.round(sb.getBoundingClientRect().width),
      lbl: getComputedStyle(document.querySelector('.sb-lbl')).opacity,
      open: document.body.classList.contains('nav-open'),
    };
  });
  step('a stuck :hover on a touch screen does not reveal the rail', !stuck.open,
    'this is what put "WORK / RECOR… / OUTRE…" down the left edge');

  // ── 2. THE DRAWER ────────────────────────────────────────────────────────
  await page.click('.tb-burger');
  await page.waitForTimeout(300);
  const open = await page.evaluate(() => {
    const sb = document.getElementById('sidebar');
    const r = sb.getBoundingClientRect();
    const txt = document.querySelector('.nav-txt');
    return {
      onScreen: r.left >= -1 && r.width > 180,
      width: Math.round(r.width),
      // A label is only readable if it is BOTH visible and inside the rail.
      labelVisible: getComputedStyle(txt).opacity === '1',
      labelInside: txt.getBoundingClientRect().right <= r.right + 1,
      scrim: (() => { const s = document.getElementById('nav-scrim'); return s && getComputedStyle(s).visibility === 'visible'; })(),
      bodyLocked: getComputedStyle(document.body).overflow === 'hidden',
    };
  });
  step('the hamburger opens the drawer', open.onScreen, `${open.width}px wide`);
  step('open, the menu labels are visible', open.labelVisible);
  step('…and they FIT — never clipped by a rail too narrow for them', open.labelInside,
    'the original symptom was a visible label inside a 60px slot');
  step('a scrim covers the page behind it', open.scrim);
  step('the page cannot scroll behind an open drawer', open.bodyLocked);

  // Opening the menu must not repaint the app. The render engine's rule is
  // that a repaint changing nothing must write nothing — a menu that
  // re-rendered the shell to open itself would throw away the page's scroll
  // position and reload any iframe on it every time somebody looked at the nav.
  const sameNodes = await page.evaluate(() => {
    const c = document.getElementById('content');
    window.__c = c;
    window.closeNav(); window.openNav(); window.toggleNav(); window.toggleNav();
    return window.__c === document.getElementById('content');
  });
  step('opening and closing the menu never rebuilds the page', sameNodes);

  // Every route out of the drawer.
  await page.evaluate(() => window.openNav());
  // The scrim spans the viewport, so its centre sits UNDER the open drawer.
  // Tap the strip beside the drawer — which is the part a thumb can reach and
  // the only part that is really "the scrim" to the person using it.
  await page.click('#nav-scrim', { position: { x: 340, y: 420 } });
  await page.waitForTimeout(250);
  step('tapping the page beside the drawer closes it', !(await page.evaluate(() => document.body.classList.contains('nav-open'))));

  await page.evaluate(() => window.openNav());
  await page.evaluate(() => window.goPage('leads'));
  await page.waitForTimeout(250);
  step('choosing a destination closes it', !(await page.evaluate(() => document.body.classList.contains('nav-open'))),
    'a drawer still covering the page you just chose is the classic phone-nav bug');

  await page.evaluate(() => window.openNav());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  step('Escape closes it, like every other overlay', !(await page.evaluate(() => document.body.classList.contains('nav-open'))));

  // Rotate/resize across the breakpoint with it open: above 860px `nav-open`
  // would mean a locked body scroll and no visible drawer to explain it.
  await page.evaluate(() => window.openNav());
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(300);
  step('crossing the breakpoint with it open does not leave the page locked',
    !(await page.evaluate(() => document.body.classList.contains('nav-open'))));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);

  // ── 3. NOTHING RUNS OFF THE SIDE, ANYWHERE ───────────────────────────────
  const PAGES = ['dashboard', 'leads', 'applicants', 'admin', 'email', 'reports', 'myteam',
                 'bd_joborders', 'clients', 'sourced', 'insights', 'mailbox', 'reminders',
                 'deliverability', 'profile', 'assign'];
  const ROLES = ['admin', 'bd', 'recruiter', 'ra', 'ra_lead'];
  const spills = [];
  let screens = 0;
  for (const role of ROLES) {
    await switchRole(page, role);
    for (const p of PAGES) {
      await page.evaluate((pp) => { window.STATE.page = pp; window.render(); }, p);
      await page.waitForTimeout(140);
      screens++;
      const bad = await page.evaluate(OVERFLOW_PROBE);
      if (bad.length) spills.push(`${role}/${p}: ` + bad.map(b => `${b.tag}.${b.cls}@${b.right}px "${b.txt}"`).join(', '));
    }
  }
  step(`no page runs off the side of a 390px screen (${screens} screens)`, spills.length === 0,
    spills.slice(0, 4).join(' | '));

  // ── 4. THE DASHBOARD BANNER ──────────────────────────────────────────────
  await switchRole(page, 'admin');
  await page.evaluate(() => { window.STATE.page = 'dashboard'; window.render(); });
  await page.waitForTimeout(300);
  const banner = await page.evaluate(() => {
    const clock = document.querySelector('.banner-clock');
    const name = document.querySelector('.banner-name');
    if (!clock || !name) return null;
    const a = clock.getBoundingClientRect(), b = name.getBoundingClientRect();
    return {
      overlaps: !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top),
      inFlow: getComputedStyle(clock).position === 'static',
      clockWidth: Math.round(a.width), bannerWidth: Math.round(clock.parentElement.getBoundingClientRect().width),
    };
  });
  step('the dashboard clock and the greeting exist as measurable elements', !!banner);
  step('the greeting is not underneath the clock', banner && !banner.overlaps,
    'they used to overlap: "Good morning" ran under the date');
  step('the clock is back in the flow rather than positioned over the text', banner && banner.inFlow);
  step('the clock stays a chip, not a full-width bar', banner && banner.clockWidth < banner.bannerWidth - 20,
    banner ? `${banner.clockWidth} of ${banner.bannerWidth}px` : '');

  // ── 5. MODALS AND TYPING ─────────────────────────────────────────────────
  await page.evaluate(() => {
    window.STATE.modal = '<div class="modal modal-w480">' +
      '<div class="mh"><div class="mt">A dialog</div></div>' +
      '<div class="mb_"><div class="fgrp"><label class="flbl">Name</label><input class="inp" id="m-in"></div></div>' +
      '<div class="mf"><button class="btn btn-outline">Cancel</button><button class="btn btn-primary">Save</button></div></div>';
    window.render();
  });
  await page.waitForTimeout(250);
  const modal = await page.evaluate(() => {
    const m = document.querySelector('.modal'); const r = m.getBoundingClientRect();
    const foot = document.querySelector('.mf');
    return {
      fits: r.left >= -1 && r.right <= window.innerWidth + 1,
      // A 16px input is what stops iOS zooming the page on focus and never
      // zooming back — the most common way a mobile web app ends up "broken"
      // after typing one search term.
      inputPx: parseFloat(getComputedStyle(document.getElementById('m-in')).fontSize),
      footerSticky: foot && getComputedStyle(foot).position === 'sticky',
    };
  });
  step('a dialog fits the screen instead of being cropped', modal.fits);
  step('typing in it will not zoom the page (16px inputs)', modal.inputPx >= 16, modal.inputPx + 'px');
  step('the dialog\'s Save/Cancel row stays put while the body scrolls', modal.footerSticky);
  await page.evaluate(() => { window.STATE.modal = null; window.render(); });

  step('nothing threw while doing any of that', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  await phone.close();

  // ── B. THE DESKTOP IS UNTOUCHED ──────────────────────────────────────────
  // Every rule in mobile.css sits inside a media query for exactly this reason.
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await desk.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const dpage = await desk.newPage();
  dpage.on('pageerror', e => pageErrors.push('desktop: ' + e));
  await dpage.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(dpage);
  await enterApp(dpage, 'admin');

  const deskState = await dpage.evaluate(() => {
    const sb = document.getElementById('sidebar');
    return {
      railWidth: Math.round(sb.getBoundingClientRect().width),
      mainLeft: Math.round(document.getElementById('main').getBoundingClientRect().left),
      burgerHidden: getComputedStyle(document.querySelector('.tb-burger')).display === 'none',
      scrimHidden: getComputedStyle(document.getElementById('nav-scrim')).display === 'none',
      label: getComputedStyle(document.querySelector('.sb-lbl')).opacity,
    };
  });
  step('the desktop still gets the slim icon rail', deskState.railWidth <= 70, deskState.railWidth + 'px');
  step('…with the content still offset by it', deskState.mainLeft >= 55);
  step('the hamburger is not shown on a desktop', deskState.burgerHidden);
  step('the scrim is not in the way on a desktop', deskState.scrimHidden);
  step('the rail is collapsed until hovered', deskState.label === '0');

  // The hover rail must still work where there IS a pointer — that is the half
  // of the fix it would be easy to break by simply deleting the hover rules.
  await dpage.hover('#sidebar .nav-item');
  await dpage.waitForTimeout(320);
  const hovered = await dpage.evaluate(() => ({
    width: Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
    label: getComputedStyle(document.querySelector('.sb-lbl')).opacity,
    txtInside: (() => {
      const t = document.querySelector('.nav-txt');
      return t.getBoundingClientRect().right <= document.getElementById('sidebar').getBoundingClientRect().right + 1;
    })(),
  }));
  step('a real pointer still expands the rail on hover', hovered.width > 180, hovered.width + 'px');
  step('…and its labels fit inside it', hovered.label === '1' && hovered.txtInside);

  step('nothing threw on the desktop either', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  await desk.close();
} catch (err) {
  step('the suite ran to completion', false, String(err && err.stack || err));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
