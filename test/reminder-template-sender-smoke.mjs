// A REMINDER TEMPLATE NEVER WRITES A NAME INTO THE EMAIL (R-189; owner 8 Oct, "the profile name instead of the email ID name … correct that also")
//   Picking a reminder template in Compose used to write the From email ID's name — or, with none, the PROFILE name — into the text on the spot.
//   Now "{{sender}}" stays in the text and the send fills it from the mailbox that really sends.
// Usage: node test/reminder-template-sender-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const SERVER_VARS = [...require('../services/sequence-draft.js').ALLOWED_VARS].sort();

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
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });

const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');
  const out = await page.evaluate(() => {
    STATE.user.name = 'BD Lead 1';                       // the PROFILE name
    STATE.userEmailsCache = STATE.userEmailsCache || {};
    STATE.userEmailsCache[STATE.user.id] = [{ id: 'm1', email_address: 'amy@alpha.test', display_name: 'Amy Alpha', is_active: true, is_primary: true }, { id: 'm2', email_address: 'x@beta.test', display_name: '', is_active: true }];
    STATE.reminders = [{ id: 'r1', contact_name: 'Dana Fox', compose: { to_email: 'dana@acme.test', to_name: 'Dana Fox' } }];
    const res = {};
    for (const mb of ['m1', 'm2']) {
      STATE.composeReminderId = 'r1'; STATE.composeFromEmailId = mb; STATE.composeSubj = ''; STATE.composeBody = '';
      applyReminderTemplate(0);
      res[mb] = { subj: STATE.composeSubj, body: STATE.composeBody };
    }
    res.fill = fillEmail('I am {{sender}} about {{pos}}', { fn: 'Dana', ln: 'Fox', pos: 'Estimator' }, { name: 'Acme' });
    return res;
  });
  step('a reminder template keeps {{sender}} in the text (from an email ID that has a name)', /\{\{sender\}\}/.test(out.m1.body) && !/Amy Alpha/.test(out.m1.body), out.m1.body.slice(0, 160));
  step('…and from an email ID with NO display name — never the profile name', /\{\{sender\}\}/.test(out.m2.body) && !/BD Lead 1/.test(out.m2.body));
  step('…the template itself is still filled for the person (Dana)', /Hi Dana/.test(out.m1.body));
  step('fillEmail with no sender given leaves the token, never the profile name', /I am \{\{sender\}\} about Estimator/.test(out.fill), out.fill);
  step('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { console.error(e); results.push(false); console.log('[FAIL] crashed — ' + e.message); }
finally { await browser.close(); server.close(); }
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length && results.length > 0 ? 0 : 1);
