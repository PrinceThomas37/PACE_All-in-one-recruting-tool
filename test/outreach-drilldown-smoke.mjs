// OUTREACH INSIGHTS: WHO IS BEHIND EACH NUMBER (R-316, owner 26 Oct: "click Bounced / Replied / Interested / Opened → the email IDs and
// leads behind it, with a date filter, Excel download, and by industry and time zone").
//   · the list behind a tile has EXACTLY as many people as the tile counts (the same rules, services/outreach-insights.js);
//   · by industry / by time zone add up to the leads emailed; an unknown one is "Not known", not dropped;
//   · the Excel file: every row, a header, quotes where needed, and a value starting like a formula is kept as text;
//   · the screen: a tile opens its list (the same tile closes it), the list is asked for with the page's dates and sequence,
//     the download button gives the file, and the industry / time zone tables show.
// Usage: node test/outreach-drilldown-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };
const OI = require('../services/outreach-insights.js');

// the same fixture the counting test uses, with who each person is
const leadSends = [
  { id: 'e1', day: '2026-10-05', contact_id: 'c1', seq: null }, { id: 'e2', day: '2026-10-06', contact_id: 'c1', seq: null },
  { id: 'e3', day: '2026-10-06', contact_id: 'c2', seq: null }, { id: 'e4', day: '2026-10-12', contact_id: 'c3', seq: 'wfA' },
  { id: 'e5', day: '2026-10-13', contact_id: 'c4', seq: 'wfA' }, { id: 'e9', day: '2026-09-01', contact_id: 'c5', seq: null },
];
const tracking = [{ email_id: 'e1', open_count: 2 }, { email_id: 'e2', open_count: 0 }, { email_id: 'e4', open_count: 1 }];
const contacts = {
  c1: { email_status: 'valid', replied_day: '2026-10-07', stage: 'Connected', name: 'Ann Lee', email: 'ann@acme.com', company: 'Acme', position: 'Welder', industry: 'Construction', timezone: 'EST' },
  c2: { email_status: 'invalid', replied_day: null, stage: 'Assigned', name: 'Bob Roy', email: 'bob@bad.com', company: 'Bad Co', position: 'Driver', industry: 'construction', timezone: 'CST' },
  c3: { email_status: 'valid', replied_day: '2026-10-01', stage: 'Assigned', name: 'Cy Fox', email: '=HYPERLINK("x")', company: 'Fox, Inc', position: 'Clerk', industry: 'Accounting', timezone: 'EST' },
  c4: { email_status: 'valid', replied_day: null, stage: 'In Discussion', name: 'Di Ng', email: 'di@ng.com', company: 'Ng', position: 'Nurse', industry: '', timezone: 'PST' },
  c6: { email_status: 'blocked', replied_day: null, stage: 'Assigned', name: 'Eli Bo', email: 'eli@walled.com', company: 'Walled', position: 'Guard', industry: 'Security', timezone: 'EST' },
};
leadSends.push({ id: 'e6', day: '2026-10-15', contact_id: 'c6', seq: null });
const candSends = [{ id: 't1', day: '2026-10-14', candidate_id: 'p1', seq: 'wfC', open_count: 1, replied_day: '2026-10-15' }];
const candidates = { p1: { name: 'Pat Kim', email: 'pat@kim.io', position: 'Site Engineer' } };
const seqNames = { wfA: 'Accountants — Ohio', wfC: 'Site engineers — Houston' };
const base = { from: '2026-10-01', to: '2026-10-19', leadSends, tracking, contacts, candSends, candidates, seqNames };

const t = OI.summarise(base).totals;
const n = (k) => OI.peopleBehind(base, k).length;
step('the list behind "People emailed" has exactly the people the tile counts', n('emailed') === t.people, n('emailed') + ' vs ' + t.people);
step('…behind "Replied" exactly the people who replied after we wrote (Ann, Pat — not Cy, who wrote first)', n('replied') === t.replied && OI.peopleBehind(base, 'replied').map((r) => r.name).sort().join() === 'Ann Lee,Pat Kim');
step('…behind "Interested" the Connected / In Discussion leads', n('interested') === t.interested && OI.peopleBehind(base, 'interested').map((r) => r.name).sort().join() === 'Ann Lee,Di Ng');
const bl = OI.peopleBehind(base, 'bounced');
step('…behind "Bounced" both kinds: Bob (invalid address) and Eli (blocked — their side rejects our mail)', bl.map((r) => r.name).sort().join() === 'Bob Roy,Eli Bo' && bl.find((r) => r.name === 'Eli Bo').bounce_kind === 'blocked' && bl.find((r) => r.name === 'Bob Roy').bounce_kind === 'invalid', JSON.stringify(bl.map((r) => [r.name, r.bounce_kind])));
step('…and the tile says how many of each (1 invalid · 1 blocked, 2 of 5 leads = 40%)', t.bounced_invalid === 1 && t.bounced_blocked === 1 && t.bounced === 2 && t.bounced_rate === 40, JSON.stringify([t.bounced_invalid, t.bounced_blocked, t.bounced_rate]));
step('…behind "Opened" the people with an opened email (Ann, Cy, Pat)', OI.peopleBehind(base, 'opened').map((r) => r.name).sort().join() === 'Ann Lee,Cy Fox,Pat Kim');
const ann = OI.peopleBehind(base, 'emailed').find((r) => r.name === 'Ann Lee');
step('a person\'s row: two emails, first and last day, their sequence, company, industry, time zone', ann.emails === 2 && ann.first_day === '2026-10-05' && ann.last_day === '2026-10-06' && ann.sequences.join() === 'Your outreach' && ann.company === 'Acme' && ann.timezone === 'EST', JSON.stringify(ann));
const only = OI.peopleBehind(Object.assign({}, base, { only: 'wfA' }), 'emailed');
step('narrowed to one sequence, the list narrows with it', only.map((r) => r.name).sort().join() === 'Cy Fox,Di Ng');
step('a date range with nothing in it → nobody', OI.peopleBehind(Object.assign({}, base, { from: '2026-11-01', to: '2026-11-05' }), 'emailed').length === 0);
const byInd = OI.breakdown(base, 'industry');
step('by industry: "Construction" and "construction " are one industry (Ann + Bob), sorted biggest first', byInd[0].name === 'Construction' && byInd[0].people === 2 && byInd[0].bounced === 1 && byInd[0].replied === 1, JSON.stringify(byInd));
step('…an industry not recorded is "Not known", not dropped — and the groups add up to the leads emailed', byInd.some((g) => g.name === 'Not known' && g.people === 1) && byInd.reduce((s, g) => s + g.people, 0) === 5);
const byTz = OI.breakdown(base, 'timezone');
step('by time zone: EST has Ann, Cy and Eli', byTz.find((g) => g.name === 'EST').people === 3 && byTz.reduce((s, g) => s + g.people, 0) === 5, JSON.stringify(byTz));

// ── the screen ──
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(PUBLIC_DIR, p), (e, d) => { if (e) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; if (fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); const d = fs.existsSync(b) ? fs.readdirSync(b).find((x) => /^chromium-/.test(x)) : null; return d ? path.join(b, d, 'chrome-linux', 'chrome') : undefined; }
const SUMMARY = Object.assign(OI.summarise(base), { by_industry: byInd, by_timezone: byTz, choices: [{ id: 'all', name: 'All sequences' }], tz: 'UTC' });
const asked = [];
let browser; const errs = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.route('**', (rt) => {
    const u = new URL(rt.request().url());
    if (u.origin === BASE && /\.(html|js|css|woff2?)$|^\/$/.test(u.pathname)) return rt.continue();
    const json = (b) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/insights/outreach') return json(SUMMARY);
    if (u.pathname === '/insights/outreach/people') { asked.push(u.search); const k = u.searchParams.get('kind'); return json({ from: base.from, to: base.to, kind: k, people: OI.peopleBehind(base, k) }); }
    return json([]);
  });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await waitForLogin(page);
  await enterApp(page, 'bd');
  const ev = (f, a) => page.evaluate(f, a);
  await ev(() => { STATE.oi = { from: '2026-10-01', to: '2026-10-19', bucket: 'day', seq: 'all', data: null, loading: false, err: '' }; goPage('bdinsights'); });
  await page.waitForSelector('.oi-tile-btn:not([disabled])', { timeout: 8000 });
  step('the screen: the five numbers are buttons', (await page.$$('.oi-tile-btn')).length === 5);
  // A button takes its text colour from somewhere: it once took the PAGE's (cream, in the dark theme) and drew cream on a cream tile.
  const contrast = () => ev(() => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const n = document.querySelector('.oi-tile-btn .oi-n'), tile = n.closest('.oi-tile-btn');
    const a = lum(rgb(getComputedStyle(n).color)), b = lum(rgb(getComputedStyle(tile).backgroundColor));
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10;
  });
  for (const theme of ['light', 'dark']) {
    await ev((t) => { document.documentElement.setAttribute('data-theme', t); }, theme); await page.waitForTimeout(50);
    const c = await contrast();
    step('the big numbers can be READ on their tiles (' + theme + ' theme, contrast ≥ 4.5)', c >= 4.5, 'contrast ' + c);
  }
  step('…and the page shows BY INDUSTRY and BY TIME ZONE', await ev(() => /BY INDUSTRY/.test(document.body.innerText) && /BY TIME ZONE/.test(document.body.innerText) && /Not known/.test(document.body.innerText)));
  await page.click('.oi-tile-btn[onclick*="replied"]');
  await page.waitForSelector('[data-oi-drill] table', { timeout: 5000 });
  const drill = await ev(() => document.querySelector('[data-oi-drill]').innerText);
  step('clicking Replied lists the 2 people behind it', /REPLIED · 2 people/.test(drill) && /Ann Lee/.test(drill) && /Pat Kim/.test(drill) && !/Bob Roy/.test(drill), drill.slice(0, 200));
  step('…asked for with the page\'s own dates and sequence', asked.some((q) => /kind=replied/.test(q) && /from=2026-10-01/.test(q) && /to=2026-10-19/.test(q) && /seq=all/.test(q)), JSON.stringify(asked));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('[data-oi-drill] button:has-text("Download for Excel")')]);
  const file = fs.readFileSync(await dl.path(), 'utf8');
  step('Download for Excel gives a file named for what it is, with a header and both people', dl.suggestedFilename() === 'outreach-replied-2026-10-01-to-2026-10-19.csv' && /^﻿Name,Email,Company/.test(file) && /Ann Lee/.test(file) && /Pat Kim/.test(file), dl.suggestedFilename());
  await page.click('.oi-tile-btn[onclick*="replied"]'); await page.waitForTimeout(100);
  step('clicking the same number again closes the list', await ev(() => !document.querySelector('[data-oi-drill]')));
  const csv = await ev(() => oiCsv([{ name: 'Cy Fox', email: '=HYPERLINK("x")', company: 'Fox, Inc', opened: true, sequences: ['A', 'B'] }]));
  step('the file keeps a value that starts like a formula as text, and quotes commas', /'=HYPERLINK\(""x""\)/.test(csv) && /"Fox, Inc"/.test(csv) && /,Yes,/.test(csv) && /A; B/.test(csv), csv.split('\r\n')[1]);
  await page.setViewportSize({ width: 390, height: 800 }); await ev(() => render()); await page.waitForTimeout(150);
  step('on a phone nothing on the page is wider than the screen', await ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await ev(() => document.documentElement.scrollWidth));
  step('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { step('the screen suite ran', false, e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
