// Pins the fix for the screen glitch the owner recorded (Session 16).
//
// The app used to rebuild EVERYTHING for every change — `#app.innerHTML =
// renderApp()`. Two things followed from that, and both are asserted here:
//
//   1. Nine pages (Inbox, Clients, Candidates, Reports, My Team, Sourced
//      Leads, the BD job pages) were missing from renderPage()'s switch, so
//      the shell wrote "Page not found" into #content and the page module
//      overwrote it a beat later. Every repaint was two writes, the first
//      wrong.
//   2. An email body lives in a sandboxed <iframe>. Re-creating that element
//      reloads it: the reading pane blanks and the reader's scroll position is
//      thrown away. Marking a message read ticks the unread badge, which
//      triggered a rebuild — so READING an email was what wiped it.
//
// The test therefore asserts NODE IDENTITY, not pixels: if the same iframe
// element is still on the page after a repaint, it was never reloaded.
//
// Usage: node test/screen-stability-smoke.mjs

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
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const pageErrors = [];
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'bd');

  // ── a mailbox with two messages in one thread ────────────────────────────
  await page.evaluate(() => {
    window.__unread = 2;
    window.__threadCalls = 0;
    const msg = (id, subject, body) => ({
      id, subject, thread_id: 't1', unread: id === 'm1',
      from: { name: 'Ali Hashmi', email: 'ali@example.test' },
      to: [{ name: 'Prince', email: 'prince@example.test' }], cc: [],
      date: '2026-09-01T10:00:00Z', preview: subject,
      body_html: body, has_remote_images: false, attachments: []
    });
    window.__messages = [msg('m1', 'Right to Represent', '<p>' + 'body line<br>'.repeat(80) + '</p>'),
                         msg('m2', 'Re: Right to Represent', '<p>second</p>')];
    // A conversation of ONE — the common case, and the one that gets a single
    // scrollbar. m1/m2 share thread t1 and stay the multi-message case.
    window.__solo = msg('m3', 'A conversation of one', '<p>' + 'line<br>'.repeat(60) + '</p>');
    window.__solo.thread_id = 't3';
    window.apiGet = function (p) {
      if (/\/mailbox\/unread-count/.test(p)) return Promise.resolve({ unread: window.__unread });
      if (/\/mailbox\/accounts/.test(p)) return Promise.resolve([
        { id: 'mb1', email_address: 'prince@example.test', platform: 'Gmail', readable: true, is_active: true }
      ]);
      if (/\/folders$/.test(p)) return Promise.resolve([{ id: 'INBOX', name: 'Inbox', kind: 'inbox', unread: 2 }]);
      if (/\/threads\/t3/.test(p)) return Promise.resolve([window.__solo]);
      if (/\/threads\//.test(p)) { window.__threadCalls++; return Promise.resolve(window.__messages); }
      const one = /\/messages\/([^?/]+)/.exec(p);
      if (one) return Promise.resolve(window.__messages.concat([window.__solo]).find(m => m.id === one[1]));
      if (/\/messages/.test(p)) return Promise.resolve({ messages: window.__messages.concat([window.__solo]), next_cursor: null, crm: {} });
      return Promise.resolve({});
    };
    window.apiPatch = function () { return Promise.resolve({}); };
    window.apiPost = function () { return Promise.resolve({}); };
  });

  // ── 1. no page draws "Page not found", ever ──────────────────────────────
  const PAGES = ['mailbox', 'clients', 'applicants', 'reports', 'myteam', 'sourced',
                 'job_board', 'bd_joborders', 'bd_myjobs', 'bd_kanban', 'bd_pipeline'];
  const notFound = await page.evaluate((pages) => {
    const bad = [];
    for (const p of pages) {
      window.STATE.page = p;
      const html = window.renderPageContent() || '';
      if (/Page not found/.test(html)) bad.push(p);
    }
    return bad;
  }, PAGES);
  step('No page falls through to "Page not found"', notFound.length === 0, notFound.join(', '));

  // Every one of them is registered, so the shell draws the real page first time.
  const unregistered = await page.evaluate((pages) => pages.filter(p => !window.UI.hasPage(p)), PAGES);
  step('All nine self-drawing pages are registered with the shell', unregistered.length === 0, unregistered.join(', '));

  // ── 2. open a message and mark the iframe ────────────────────────────────
  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForSelector('#mb-list .mb-row', { timeout: 8000 });
  await page.evaluate(() => window.mbOpen('m1'));
  await page.waitForFunction(() => (STATE.mailbox.message || {}).id === 'm1' && !STATE.mailbox.msgLoading, { timeout: 8000 });
  await page.waitForSelector('#mb-open .mb-body iframe', { timeout: 8000 });

  // A property on the DOM node itself: it cannot survive the element being
  // re-created, which is exactly what we are testing for.
  await page.evaluate(() => { document.querySelector('#mb-open .mb-body iframe').__pinned = 'yes'; });
  const stillThere = () => page.evaluate(() => {
    const f = document.querySelector('#mb-open .mb-body iframe');
    return !!(f && f.__pinned === 'yes');
  });

  step('The message body is on screen before we disturb it', await stillThere());

  // The exact trigger from the recording: the unread badge ticks down.
  await page.evaluate(() => {
    window.__unread = 1;
    window.refreshUnread(true);
  });
  await page.waitForFunction(() => STATE.mailbox.unread === 1, { timeout: 8000 });
  await page.waitForTimeout(120);
  step('Reading an email does not destroy the email you are reading',
    await stillThere(), 'the unread badge changing used to rebuild the whole app');
  const badgeShown = await page.evaluate(() =>
    /class="nav-badge"[^>]*>1</.test(document.getElementById('sidebar').innerHTML));
  step('…and the rail badge still updated', badgeShown);

  // A plain full render(): same page, nothing else changed.
  await page.evaluate(() => window.render());
  await page.waitForTimeout(80);
  step('A full render() leaves the reading pane standing', await stillThere());

  // A background refresh (the 3-minute poll's debounced repaint).
  await page.evaluate(() => window.scheduleRender());
  await page.waitForTimeout(120);
  step('A background refresh leaves the reading pane standing', await stillThere());

  // A toast — anything at all happening on screen.
  await page.evaluate(() => window.showToast('Something happened', 'info'));
  await page.waitForTimeout(80);
  step('A toast leaves the reading pane standing', await stillThere());

  // The rest of the conversation arriving, late, as it does in real life.
  await page.evaluate(() => {
    STATE.mailbox.thread = window.__messages;
    window.STATE.mailbox.threadId = 't1';
    document.querySelector('#content') && window.UI.paintPage('mailbox');
  });
  await page.waitForTimeout(80);
  const threadShown = await page.evaluate(() => /2 messages/.test(document.getElementById('mb-head').innerHTML));
  step('The rest of the thread arriving leaves the reading pane standing', await stillThere());
  step('…and the thread is actually shown', threadShown);
  const shortApplied = await page.evaluate(() => {
    const b = document.querySelector('#mb-open .mb-body');
    return !!(b && b.classList.contains('short'));
  });
  step('…with the in-thread body size applied as a class, not a rebuild', shortApplied);

  // Opening the reply box.
  await page.evaluate(() => window.mbReply(false));
  await page.waitForTimeout(80);
  const composerOpen = await page.evaluate(() => !!document.getElementById('mb-comp-body'));
  step('Opening a reply leaves the message you are replying to standing', await stillThere());
  step('…and the composer did open', composerOpen);

  // ── 3. an unchanged screen is not rewritten at all ───────────────────────
  const untouched = await page.evaluate(() => {
    const before = document.getElementById('mb-list');
    before.__pinned = 'yes';
    window.render(); window.render();
    const after = document.getElementById('mb-list');
    return !!(after && after.__pinned === 'yes');
  });
  step('Repainting an unchanged screen writes nothing', untouched);

  // ── 4. a modal does not replay its entry animation on every repaint ──────
  const modalKept = await page.evaluate(() => {
    STATE.modal = '<div class="modal modal-w480" id="test-modal">hello</div>';
    window.render();
    const el = document.getElementById('test-modal');
    if (!el) return 'no modal';
    el.__pinned = 'yes';
    window.showToast('again', 'info');
    window.render();
    const after = document.getElementById('test-modal');
    return after && after.__pinned === 'yes' ? true : 'modal was re-created';
  });
  step('An open modal is not re-created (so it does not re-animate) on a repaint',
    modalKept === true, modalKept === true ? '' : String(modalKept));
  await page.evaluate(() => { STATE.modal = null; window.render(); });

  // ── 5. switching page still redraws properly ─────────────────────────────
  await page.evaluate(() => window.goPage('clients'));
  await page.waitForTimeout(150);
  const clientsDrawn = await page.evaluate(() => {
    const h = document.getElementById('content').innerHTML;
    return !/Page not found/.test(h) && !/mb-root/.test(h);
  });
  step('Switching pages still redraws the screen', clientsDrawn);
  await page.evaluate(() => window.goPage('mailbox'));
  await page.waitForSelector('#mb-root', { timeout: 8000 });
  step('…and coming back rebuilds the Inbox', true);

  // ── 6. an idle repaint must not touch the DOM AT ALL ─────────────────────
  // Surviving as the same element is not enough. Writing an attribute — even
  // the same class back onto the same node — invalidates style on an ancestor
  // of the message body, and an out-of-process sandboxed iframe answers that by
  // re-rastering itself. On screen that is a white flash, with the content
  // returning identical and at the same scroll position. So the invariant is
  // stricter than "not rebuilt": a repaint that changes nothing must WRITE
  // nothing.
  await page.evaluate(() => {
    STATE.mailbox.thread = null; STATE.mailbox.threadId = null; STATE.mailbox.composer = null;
    window.mbOpen('m1');
  });
  await page.waitForSelector('#mb-open .mb-body iframe', { timeout: 8000 });
  await page.waitForTimeout(300);
  const idleMutations = await page.evaluate(async () => {
    const seen = [];
    const obs = new MutationObserver(ms => ms.forEach(m => seen.push(
      m.type + ':' + (m.target.id || m.target.className || m.target.nodeName) +
      (m.type === 'attributes' ? '[' + m.attributeName + ']' : ''))));
    obs.observe(document.getElementById('main'),
      { subtree: true, childList: true, attributes: true, characterData: true });
    window.render(); window.render();
    window.scheduleRender();
    await new Promise(r => setTimeout(r, 250));
    obs.disconnect();
    return seen;
  });
  step('A repaint that changes nothing writes nothing to the DOM',
    idleMutations.length === 0, idleMutations.slice(0, 6).join(' | '));

  // ── 7. a send in flight must not disturb the message being read ──────────
  // The send-progress poll runs every 2 SECONDS while a send is running, and
  // used to call scheduleRender() on every tick regardless of whether anything
  // had changed — a repaint under the reader twice a minute at rest and every
  // 2s mid-send. That is the cadence in the owner's recording.
  const pollMutations = await page.evaluate(async () => {
    const prevGet = window.apiGet;
    window.apiGet = function (p) {
      if (/send-progress/.test(p)) return Promise.resolve({ active: true, sent: 3, total: 10 });
      return prevGet(p);
    };
    const seen = [];
    const obs = new MutationObserver(ms => ms.forEach(m => seen.push(m.type)));
    obs.observe(document.getElementById('mb-read'),
      { subtree: true, childList: true, attributes: true, characterData: true });
    window.stopProgressPoll(); window.STATE._progressSig = null;
    window.startProgressPoll();
    await new Promise(r => setTimeout(r, 5200));   // three polls
    window.stopProgressPoll();
    obs.disconnect();
    window.apiGet = prevGet;
    return seen;
  });
  step('A send running in the background never touches the open message',
    pollMutations.length <= 1, pollMutations.length + ' mutations over three 2s polls');

  // ── 8. one message, one scrollbar ────────────────────────────────────────
  // Two nested scrollers (the pane AND the 420px body) meant a wheel over the
  // message scrolled the text, hit its end, then jerked the whole pane — and
  // every pane scroll moved the iframe.
  await page.evaluate(() => window.mbOpen('m3'));
  await page.waitForFunction(() => (STATE.mailbox.message || {}).id === 'm3' &&
    (STATE.mailbox.thread || []).length === 1, { timeout: 8000 });
  await page.waitForTimeout(150);
  const scrollers = await page.evaluate(() => {
    const t = document.getElementById('mb-thread');
    return { solo: t.className.indexOf('solo') > -1, scrollH: t.scrollHeight, clientH: t.clientHeight };
  });
  step('A single message gives the reading pane one scrollbar, not two',
    scrollers.solo && scrollers.scrollH <= scrollers.clientH + 1, JSON.stringify(scrollers));

  // With a real thread the pane has to scroll, so `solo` must come back off.
  await page.evaluate(() => {
    STATE.mailbox.thread = window.__messages.concat([]); STATE.mailbox.threadId = 't1';
    STATE.mailbox.message = window.__messages[0]; STATE.mailbox.selectedId = 'm1';
    window.UI.paintPage('mailbox');
  });
  await page.waitForTimeout(120);
  const threadScroll = await page.evaluate(() =>
    document.getElementById('mb-thread').className.indexOf('solo') > -1);
  step('…and a multi-message thread still scrolls as one pane', !threadScroll);

  // ── 9. the test can tell the difference ──────────────────────────────────
  // Everything above is a claim that a DOM node SURVIVED. That claim is only
  // worth anything if this test would notice the node being replaced — which
  // is what the old whole-app rebuild did on every change. So do the old thing
  // deliberately, once, and check the marker is gone.
  await page.evaluate(() => window.mbOpen('m1'));
  await page.waitForSelector('#mb-open .mb-body iframe', { timeout: 8000 });
  const detects = await page.evaluate(() => {
    document.querySelector('#mb-open .mb-body iframe').__pinned = 'yes';
    document.getElementById('content').innerHTML = document.getElementById('content').innerHTML;
    const f = document.querySelector('#mb-open .mb-body iframe');
    return !(f && f.__pinned === 'yes');
  });
  step('A rebuilt reading pane IS detected by this test', detects,
    'otherwise every assertion above passes for free');

  step('No uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  step('Test harness ran', false, String(e && e.message || e));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length}`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
