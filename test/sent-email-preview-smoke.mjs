// "I don't have the preview for the sent emails for nor clients for candidates."
//
// `email_tracking` recorded who, what subject, when, opened and replied — and
// never the email itself, so PACE could not answer "what did we actually say to
// this client?". Migration 042 adds `body`, all six send paths write it, and
// these two screens open it.
//
// The candidate profile toggles `hidden` rather than re-rendering: the drawer is
// an overlay and a render() would rebuild it, throwing away a half-typed note —
// the exact thing scheduleRender refuses to do. That mechanism is what this
// suite checks in a real browser, plus the honest message for the rows sent
// before 042, which have no stored copy and never will.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => {
    if (e) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d);
  });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const exe = process.env.PLAYWRIGHT_CHROMIUM
  || (process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : 'chromium');

const results = [];
const step = (name, ok, detail = '') => {
  results.push(ok);
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
};

// ── every send path records the text ───────────────────────────────────────
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SENDERS = [
  ['routes/recruiting/outreach.js', 4],   // candidate_sequence, candidate, client, interview
  ['routes/outreach-generator.js', 1],    // the outreach generator
  ['routes/candidate-outreach.js', 1],    // the candidate drip
];
let bodied = 0;
for (const [file, want] of SENDERS) {
  const s = src(file);
  const inserts = (s.match(/from\('email_tracking'\)\s*\.insert\(\{[\s\S]*?\}\);/g) || []);
  const withBody = inserts.filter(b => /\bbody:/.test(b)).length;
  bodied += withBody;
  step(`${file}: every email_tracking insert records the body`,
    inserts.length === want && withBody === want, `${withBody}/${inserts.length} of an expected ${want}`);
}
step('all six send paths record it', bodied === 6, String(bodied));
step('the client read endpoint returns the body',
  /\.select\('id,to_email,subject,body,/.test(src('routes/companies.js')));
step('migration 042 exists and is additive',
  /add column if not exists body text/i.test(src('migrations/042_email_tracking_body.sql')));

// ── the screens ────────────────────────────────────────────────────────────
let browser;
try {
  browser = await chromium.launch({ executablePath: exe, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'bd');

  const out = await page.evaluate(async () => {
    const SENT = [
      { id: 'e1', to_email: 'ed@berks.test', subject: 'Superintendent', sent_at: new Date().toISOString(),
        body: 'Hi Ed,\n\nThe exact words that were sent.' },
      { id: 'e2', to_email: 'old@berks.test', subject: 'Older one', sent_at: new Date().toISOString(), body: null },
    ];
    window.STATE.bd = window.STATE.bd || {};
    window.STATE.bd.profile = {
      id: 'c1', candidate: { id: 'c1', full_name: 'A Candidate', email: 'a@x.test' },
      history: [], notes: [], documents: [], emailActivity: SENT, selJob: null,
      noteTab: 'applicant_reference', back: null, tab: 'notes',
    };
    // The profile is an OVERLAY gated on profileOpen, not a page.
    window.STATE.bd.profileOpen = true;
    window.STATE.page = 'applicants';
    window.render();
    await new Promise(r => setTimeout(r, 150));

    const panel = () => document.querySelector('[data-cpmail="e1"]');
    const noCopy = () => document.querySelector('[data-cpmail="e2"]');
    const drawn = !!panel();
    const hiddenAtFirst = drawn && panel().hidden;
    window.cpToggleEmail('e1');
    const shownAfterClick = drawn && !panel().hidden;
    const text = drawn ? panel().innerText : '';
    window.cpToggleEmail('e1');
    const hiddenAgain = drawn && panel().hidden;
    // opening one must not disturb the other
    window.cpToggleEmail('e2');
    const otherStillClosed = !!panel() && panel().hidden;
    const oldSaysSo = !!noCopy() && /before PACE kept a copy/.test(noCopy().innerText);
    return { drawn, hiddenAtFirst, shownAfterClick, hasText: /exact words that were sent/.test(text), hiddenAgain, otherStillClosed, oldSaysSo };
  });

  step('the candidate profile draws a panel for each tracked email', out.drawn);
  step('it starts closed', out.hiddenAtFirst);
  step('clicking opens it and shows the text that was sent', out.shownAfterClick && out.hasText);
  step('clicking again closes it', out.hiddenAgain);
  step('opening one email leaves the others closed', out.otherStillClosed);
  step('an email sent before 042 says so instead of showing an empty box', out.oldSaysSo);
  step('no page errors', errs.length === 0, errs.join(' | '));
} catch (err) {
  step('the browser half ran', false, err.message);
} finally {
  if (browser) await browser.close();
  server.close();
}

const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${passed}/${results.length} passed`);
console.log('RESULT: ' + (passed === results.length ? 'PASS' : 'FAIL'));
process.exit(passed === results.length ? 0 : 1);
