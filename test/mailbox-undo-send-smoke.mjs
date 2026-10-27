// THE MAILBOX: UNDO SEND, STAR, POP OUT, RESIZE (R-318, owner 26 Oct: "5-second Undo after Send from compose · pop the reading window
// out (long emails) · drag panel widths like Gmail · star emails as important (synced to Gmail star / Outlook flag)").
//   · Send holds the email: nothing is posted while "Undo · sending in Ns" shows; Undo puts the window back as it was; a held send
//     posts exactly once when the time is up;
//   · Star asks the server to set the provider's own star / flag; a failure puts it back and says so;
//   · Pop out opens the email in its own window: escaped header, the body in a frame that can run nothing;
//   · the line between the list and the message drags the list wider, is remembered, double-click resets, and is not on a phone.
// Usage: node test/mailbox-undo-send-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 220) : '')); };
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; if (fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); const d = fs.existsSync(b) ? fs.readdirSync(b).find((x) => /^chromium-/.test(x)) : null; return d ? path.join(b, d, 'chrome-linux', 'chrome') : undefined; }

const F = {
  accounts: [{ id: 'mb1', email_address: 'me@pace.test', display_name: 'Me', platform: 'Gmail', is_primary: true, is_active: true, readable: true, connection: { connected: true, status: 'ok' } }],
  folders: [{ id: 'f-inbox', name: 'Inbox', kind: 'inbox', unread: 1, total: 1 }],
  messages: { messages: [{ id: 'm1', thread_id: 't1', subject: 'Long contract <review>', from: { name: 'Ada Okafor', email: 'ada@client.test' }, to: [{ email: 'me@pace.test' }], cc: [], date: new Date().toISOString(), preview: 'Please read', unread: false, flagged: false, platform: 'Gmail' }], next_cursor: null, crm: {} },
  message: { id: 'm1', thread_id: 't1', subject: 'Long contract <review>', from: { name: 'Ada Okafor', email: 'ada@client.test' }, to: [{ name: 'Me', email: 'me@pace.test' }], cc: [], date: new Date().toISOString(), unread: false, flagged: false,
    body_html: '<p>Clause one.</p><script>window.parent.__pwned=1</script>', attachments: [], crm: {} },
};
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitForLogin(page);
  await enterApp(page, 'recruiter');
  const ev = (f, a) => page.evaluate(f, a);
  await ev((F) => {
    STATE.mailView = 'messages'; window.__calls = []; window.__patchFails = false;
    window.apiGet = (p) => { if (/^\/mailbox\/accounts/.test(p)) return Promise.resolve(F.accounts); if (/unread-count/.test(p)) return Promise.resolve({ unread: 0, per_mailbox: [] });
      if (/\/signature$/.test(p)) return Promise.resolve({ html: '' }); if (/\/folders$/.test(p)) return Promise.resolve(F.folders);
      if (/\/messages\?/.test(p)) return Promise.resolve(F.messages); if (/\/messages\/m1/.test(p)) return Promise.resolve(JSON.parse(JSON.stringify(F.message))); if (/\/threads\//.test(p)) return Promise.resolve([JSON.parse(JSON.stringify(F.message))]); return Promise.resolve({}); };
    window.apiPost = (p, b) => { window.__calls.push(['POST', p, b]); return Promise.resolve({ success: true }); };
    window.apiPatch = (p, b) => { window.__calls.push(['PATCH', p, b]); return window.__patchFails ? Promise.reject(new Error('Gmail said no')) : Promise.resolve({ success: true }); };
    window.apiDelete = () => Promise.resolve({});
    goPage('mailbox');
  }, F);
  await page.waitForFunction(() => (STATE.mailbox.messages || []).length > 0, { timeout: 8000 });
  await ev(() => mbOpen('m1')); await page.waitForSelector('#mb-star', { timeout: 8000 });

  // ── star ──
  await page.click('#mb-star'); await page.waitForTimeout(80);
  let patch = await ev(() => window.__calls.filter((c) => c[0] === 'PATCH').pop());
  step('Star asks the server to star it (the provider\'s own star / flag)', patch && /\/mailbox\/mb1\/messages\/m1$/.test(patch[1]) && patch[2].flagged === true, JSON.stringify(patch));
  step('…and the button says Starred', /Starred/.test(await ev(() => document.getElementById('mb-star').textContent)));
  await ev(() => { window.__patchFails = true; }); await page.click('#mb-star'); await page.waitForTimeout(120);
  step('a star the provider refuses is put back, not left pretending', /Starred/.test(await ev(() => document.getElementById('mb-star').textContent)) && await ev(() => STATE.mailbox.message.flagged === true));
  await ev(() => { window.__patchFails = false; });

  // ── pop out ──
  const [pop] = await Promise.all([page.waitForEvent('popup', { timeout: 5000 }), page.click('button:has-text("Pop out")')]);
  await pop.waitForLoadState('domcontentloaded');
  const ph = await pop.evaluate(() => ({ title: document.title, head: document.querySelector('.h').innerHTML, sb: document.querySelector('iframe').getAttribute('sandbox'), doc: document.querySelector('iframe').getAttribute('srcdoc') }));
  step('Pop out opens the email in its own window, titled by its subject', ph.title === 'Long contract <review>', ph.title);
  step('…the header is text, not markup (the subject\'s <review> is shown, not run)', /Long contract &lt;review&gt;/.test(ph.head) && /Ada Okafor &lt;ada@client\.test&gt;/.test(ph.head), ph.head);
  step('…the body sits in a frame that can run nothing and reach nothing', /Clause one/.test(ph.doc) && !/allow-scripts/.test(ph.sb) && !/allow-same-origin/.test(ph.sb), ph.sb);
  await pop.waitForTimeout(150);
  step('…and the email\'s own script did not run anywhere', !(await pop.evaluate(() => window.__pwned)) && !(await ev(() => window.__pwned)));
  await pop.close();

  // ── resize ──
  const before = await ev(() => document.getElementById('mb-list').getBoundingClientRect().width);
  const bar = await page.$('#mb-resize'); const bb = await bar.boundingBox();
  await page.mouse.move(bb.x + 3, bb.y + 200); await page.mouse.down(); await page.mouse.move(bb.x + 203, bb.y + 200, { steps: 5 }); await page.mouse.up();
  const after = await ev(() => document.getElementById('mb-list').getBoundingClientRect().width);
  step('dragging the line makes the list wider', after > before + 150, before + ' → ' + after);
  step('…and it is remembered in this browser', Number(await ev(() => localStorage.getItem('pace-mb-list-w'))) === Math.round(after));
  await ev(() => { goPage('dashboard'); goPage('mailbox'); }); await page.waitForSelector('#mb-list'); await page.waitForTimeout(150);
  step('…coming back to the mailbox keeps the width', Math.abs((await ev(() => document.getElementById('mb-list').getBoundingClientRect().width)) - after) < 2);
  await page.dblclick('#mb-resize'); await page.waitForTimeout(80);
  step('double-click puts it back', Math.abs((await ev(() => document.getElementById('mb-list').getBoundingClientRect().width)) - before) < 2);

  // ── undo send ──
  await ev(() => { window.MB_UNDO_MS = 1500; window.__calls.length = 0; mbCompose('x@client.test'); });
  await page.waitForSelector('#mb-c-subject');
  await ev(() => { document.getElementById('mb-c-subject').value = 'Hello'; mbComposeField('subject', 'Hello'); document.getElementById('mb-c-body').value = 'The body'; mbComposeField('body', 'The body'); mbSendCompose(); });
  await page.waitForTimeout(300);
  step('Send holds it: the button is "Undo · sending in …" and nothing has been posted', /Undo · sending in/.test(await ev(() => document.getElementById('mb-c-send').textContent)) && (await ev(() => window.__calls.filter((c) => c[0] === 'POST').length)) === 0);
  await page.click('#mb-c-send'); await page.waitForTimeout(1600);
  step('Undo: nothing is ever posted, and the window is back with what was written', (await ev(() => window.__calls.filter((c) => c[0] === 'POST').length)) === 0 && (await ev(() => document.getElementById('mb-c-send').textContent)) === 'Send' && (await ev(() => document.getElementById('mb-c-body').value)) === 'The body');
  await ev(() => mbSendCompose()); await page.waitForTimeout(1800);
  const posts = await ev(() => window.__calls.filter((c) => c[0] === 'POST'));
  step('Send again and let it go: posted exactly once, when the time is up', posts.length === 1 && /\/mailbox\/mb1\/send$/.test(posts[0][1]) && posts[0][2].body === 'The body', JSON.stringify(posts.map((p) => p[1])));

  // ── phone ──
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(100);
  step('on a phone there is no drag line (one pane at a time)', await ev(() => { const r = document.getElementById('mb-resize'); return !r || getComputedStyle(r).display === 'none'; }));
  step('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { step('the suite ran', false, e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
