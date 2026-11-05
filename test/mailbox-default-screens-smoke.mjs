// THE SCREENS NEVER PRE-SELECT A MAILBOX WHOSE SIGN-IN EXPIRED (R-399, owner 5 Nov 2026). Four screens (five lines of code) used
// "the primary one, else the first" to pre-select a mailbox: Email → Compose "From", the Sequence tab's "Sending from" card (My wording),
// the signature editor's mailbox, and the sequence-builder preview. Ash's older mailbox (expired) won all of them. Now a mailbox whose
// connection.status is 'expired' is still SHOWN (marked) but never pre-selected while a working one exists — and Compose, which SENDS,
// will not let it be picked.
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
const step = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}
const box = (id, email, extra) => Object.assign({ id, email_address: email, display_name: 'Ash Sayyad', platform: 'Gmail', is_active: true, is_primary: false, connection: { connected: true, status: 'ok' } }, extra);
const EXPIRED = { connection: { connected: true, status: 'expired' } };

let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'bd');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const seed = (boxes) => ev((b) => { const S = window.STATE, me = S.user.id; S.userEmailsCache = S.userEmailsCache || {}; S.userEmailsCache[me] = b;
    S.composeFromEmailId = null; S.planFromEmailId = null; S.sigEmailId = null; S.wfPrevMbId = null; }, boxes);

  // Ash's case: neither primary, the OLDER one expired
  const ash = [box('old', 'ash@futeglobal.com', EXPIRED), box('new', 'ash@vhcstaffing.com')];
  step('helper: the first WORKING mailbox, not the expired one', await ev((b) => firstWorkingMailbox(b).id, ash) === 'new');
  step('helper: a rejected PRIMARY loses to a healthy non-primary', await ev((b) => firstWorkingMailbox(b).id, [box('p', 'p@x.test', Object.assign({ is_primary: true }, EXPIRED)), box('q', 'q@x.test')]) === 'q');
  step('helper: all expired → still returns one (a screen cannot select nothing)', !!(await ev((b) => firstWorkingMailbox(b), [box('p', 'p@x.test', Object.assign({ is_primary: true }, EXPIRED))])));

  await seed(ash);
  await ev(() => { STATE.page = 'email'; STATE.emailTab = 'compose'; STATE.composeContext = 'reminder'; render(); }); await page.waitForTimeout(500);
  const comp = await ev(() => ({ from: STATE.composeFromEmailId, opts: [...document.querySelectorAll('#content select option')].map(o => ({ v: o.value, t: o.textContent, d: o.disabled, s: o.selected })).filter(o => o.v === 'old' || o.v === 'new') }));
  step('Compose "From" (this one SENDS): pre-selects the working mailbox', comp.from === 'new' && comp.opts.some(o => o.v === 'new' && o.s), JSON.stringify(comp));
  step('…the expired one is shown, marked "sign-in expired", and cannot be picked', comp.opts.some(o => o.v === 'old' && /sign-in expired/.test(o.t) && o.d), JSON.stringify(comp.opts));

  await seed(ash);
  await ev(() => { STATE.page = 'email'; STATE.emailTab = 'sequence'; STATE.seqView = 'wording'; render(); }); await page.waitForTimeout(500);
  const plan = await ev(() => ({ plan: STATE.planFromEmailId, sig: STATE.sigEmailId }));
  step('Sequence tab (My wording): pre-selects the working mailbox for "Sending from", and the signature editor follows it', plan.plan === 'new' && plan.sig === 'new', JSON.stringify(plan));
  // the "Sending from" card itself (drawn deep inside the wording editor, so its renderer is called directly)
  const card = await ev((b) => { const d = document.createElement('div'); d.innerHTML = renderSendingEmailCard('u', b, undefined, 'x'); return [...d.querySelectorAll('option')].map(o => ({ v: o.value, t: o.textContent, s: o.selected })); }, ash);
  step('"Sending from" card: with nothing chosen it selects the working mailbox; the expired one is still listed and marked (its wording can still be edited)', card.some(o => o.v === 'new' && o.s) && card.some(o => o.v === 'old' && !o.s && /sign-in expired/.test(o.t)), JSON.stringify(card));

  await seed(ash);
  step('Sequence-builder preview mailbox: the working one', await ev(() => wfPreviewMailbox().id) === 'new');
  await seed(ash); await ev(() => { STATE.sigEmailId = null; });
  step('Signature editor default (no mailbox chosen yet): the working one', await ev((b) => (firstWorkingMailbox(b) || {}).id, ash) === 'new');

  // nothing broke for the common case: one healthy primary
  await seed([box('a', 'a@x.test', { is_primary: true }), box('b', 'b@x.test')]);
  await ev(() => { STATE.page = 'email'; STATE.emailTab = 'compose'; STATE.composeContext = 'reminder'; render(); }); await page.waitForTimeout(400);
  step('unchanged for the common case: all healthy → the primary', await ev(() => STATE.composeFromEmailId) === 'a');
} catch (e) {
  step('run crashed — ' + String(e.message || e).split('\n')[0], false);
} finally {
  if (browser) await browser.close();
  server.close();
}
step('No page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
