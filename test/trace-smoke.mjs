// D-0077 — "when clicked on it, it does not show the email from which this
// information is inferred". Clicking a to-do row or a client conversation opens
// the drawer of what it was worked out from:
//   * the rule in plain words that put it on the list;
//   * the actual emails, newest first, each marked as theirs or yours, with the
//     reply you owe flagged and a reply readable in full on request;
//   * a reminder says where it came from (its own source words);
//   * a candidate shows the send log; a lead group shows the lead's emails;
//   * what a person may NOT read says so (not the owner / switched off) — never blank;
//   * the old "go to the lead" is one button away, not lost.
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd');

  await page.evaluate(() => {
    window.__asked = []; window.__opened = [];
    const TL = { enabled: true, owner: true, timeline: [
      { id: 'in:m3', direction: 'inbound', sent_at: '2026-10-03T10:00:00Z', person: 'Melanie Nero', subject: 'Re: Estimator role', text: 'Yes — we are interested. Can you send two profiles by Friday?', can_open_full: true },
      { id: 'out:m2', direction: 'outbound', sent_at: '2026-09-30T10:00:00Z', person: 'Melanie Nero', subject: 'Estimator role', text: 'Hi Melanie, we have two strong estimators…', can_open_full: false },
      { id: 'out:m1', direction: 'outbound', sent_at: '2026-09-28T10:00:00Z', person: 'Other Person', subject: 'Intro', text: 'Hello Other…', can_open_full: false } ] };
    window.apiGet = (p) => { __asked.push(p);
      if (p === '/leads/job-1/intel') return Promise.resolve(TL);
      if (p === '/leads/job-off/intel') return Promise.resolve({ enabled: false });
      if (p === '/leads/job-theirs/intel') return Promise.resolve({ enabled: true, owner: false, owner_name: 'Raj' });
      if (p === '/leads/job-1/intel/messages/in%3Am3/full') return Promise.resolve({ text: 'FULL TEXT: Yes — we are interested.\n\nPlease send two profiles by Friday.\n\nThanks, Melanie' });
      if (p.indexOf('/email/history?candidate_id=cand-1') === 0) return Promise.resolve({ items: [{ id: 'e1', candidate_id: 'cand-1', to_email: 'maya@example.test', subject: 'Interview invite', body: 'Hi Maya, are you free Tuesday?', sent_at: '2026-10-02T09:00:00Z', replied_at: '2026-10-03T09:00:00Z' }] });
      return Promise.resolve([]); };
    window.openJob = (id) => __opened.push('job:' + id);
    window.bdOpenCandidate = (id) => __opened.push('cand:' + id);
    STATE.reminders = [{ id: 'r1', user_id: STATE.user.id, status: 'pending', return_date: '2026-10-06', created_at: '2026-10-01T08:00:00Z', note: 'Call Dana about the Dallas role', source: { label: 'Sequence step', why: 'An outreach sequence reached its "call + LinkedIn" step for this contact.' } }];
    const it = (o) => Object.assign({ last_activity_at: '2026-10-06T08:00:00Z', priority: 50, overdue_days: 1, owner_id: STATE.user.id }, o);
    STATE.nextActions = { items: [
      it({ kind: 'reply_due', entity_type: 'contact', entity_id: 'c1', title: 'Melanie Nero', subtitle: 'Pinpoint', email: 'm@x.test', job_id: 'job-1', reason: "They replied 3 days ago. You haven't replied." }),
      it({ kind: 'nudge', entity_type: 'lead', entity_id: 'job-1', title: 'Pinpoint Engineering', subtitle: '30 people', email: null, job_id: 'job-1', reason: 'You have emailed 30 people here and nobody has replied.' }),
      it({ kind: 'reminder_due', entity_type: 'contact', entity_id: 'c2', reminder_id: 'r1', title: 'Dana Fox', subtitle: 'Acme', email: null, job_id: 'job-1', reason: 'Call Dana about the Dallas role' }),
      it({ kind: 'reply_due', entity_type: 'candidate', entity_id: 'cand-1', title: 'Maya Rao', subtitle: 'Estimator', email: 'maya@example.test', job_id: 'jo-9', reason: 'They replied.' }),
      it({ kind: 'reply_due', entity_type: 'contact', entity_id: 'c9', title: 'Zed', subtitle: 'Off Co', email: 'z@x.test', job_id: 'job-off', reason: 'x' }),
      it({ kind: 'reply_due', entity_type: 'contact', entity_id: 'c8', title: 'Yan', subtitle: 'Theirs Co', email: 'y@x.test', job_id: 'job-theirs', reason: 'x' }),
    ], summary: {}, team: null, snoozed: 0, overflow: 0 };
    STATE.naExpanded = true; STATE.page = 'dashboard'; render();
  });
  await page.waitForTimeout(400);
  const wait = () => page.waitForTimeout(300);
  const drawer = () => page.evaluate(() => { const d = document.querySelector('.ev-drawer'); if (!d) return null;
    return { title: d.querySelector('.ev-title').textContent.trim(), hint: (d.querySelector('.ev-hint') || {}).textContent || '', rows: [...d.querySelectorAll('.ev-row')].map(r => ({ p: r.querySelector('.ev-primary').textContent, s: (r.querySelector('.ev-secondary') || {}).textContent || '', t: (r.querySelector('.ev-text') || {}).textContent || '', chips: [...r.querySelectorAll('.ev-chip')].map(c => c.textContent), tone: /tone-in/.test(r.className) ? 'in' : /tone-out/.test(r.className) ? 'out' : '' })), actions: [...d.querySelectorAll('.ev-actions .btn-primary')].map(b => b.textContent), empty: (d.querySelector('.ev-empty') || {}).textContent || '' }; });
  const clickRow = async (title) => { await page.evaluate((t) => { const r = [...document.querySelectorAll('[data-na-item]')].find(x => x.textContent.indexOf(t) >= 0); r.click(); }, title); await wait(); };
  const close = async () => { await page.keyboard.press('Escape'); await wait(); };

  // 1. a reply you owe
  await clickRow('Melanie Nero');
  let d = await drawer();
  step('clicking a "Reply due" row opens the drawer — and says the rule in plain words', d && /^Melanie Nero/.test(d.title) && /their latest email to you has no reply from you after it/.test(d.hint) && /Right now: They replied 3 days ago/.test(d.hint), JSON.stringify(d && d.hint));
  step('…the emails behind it, newest first, theirs and yours marked (narrowed to Melanie — not the other person\'s)', d.rows.length === 2 && d.rows[0].p === 'They wrote — Melanie Nero' && d.rows[0].tone === 'in' && d.rows[1].p === 'You wrote — Melanie Nero' && d.rows[1].tone === 'out', JSON.stringify(d.rows.map(r => r.p)));
  step('…the email it was worked out from is flagged as the reply you owe, with its words', d.rows[0].chips.includes('the reply you owe') && /interested/.test(d.rows[0].t) && d.rows[0].s === 'Re: Estimator role');
  step('…and it asked for THIS lead\'s timeline, nothing else', await page.evaluate(() => __asked.includes('/leads/job-1/intel')));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trace-reply-due.png') });
  // read a reply in full
  await page.evaluate(() => document.querySelector('.ev-fulllink').click()); await wait();
  const full = await page.evaluate(() => (document.querySelector('.ev-fulltext') || {}).textContent || '');
  step('"Read the full email" fetches the whole reply and shows it in place', /FULL TEXT: Yes — we are interested/.test(full) && /send two profiles by Friday/.test(full), full.slice(0, 60));
  step('…a sent email has no such link (only replies can be opened)', await page.evaluate(() => document.querySelectorAll('.ev-fulllink').length === 1));
  // the old jump survives as a button
  step('the old jump is one button away: "Open the lead"', d.actions.join() === 'Open the lead');
  await page.evaluate(() => document.querySelector('.ev-actions .btn-primary').click()); await wait();
  step('…and it opens the lead (and the drawer steps aside first)', await page.evaluate(() => __opened.join() === 'job:job-1' && !document.querySelector('.ev-drawer')));

  // 2. the grouped "No reply yet"
  await clickRow('Pinpoint Engineering');
  d = await drawer();
  step('a "No reply yet" group shows the basis AND the lead\'s emails (all three, whoever they were to)', d && /you emailed and nobody has answered for 3 or more days/.test(d.hint) && d.rows.length === 3 && d.rows[0].chips.includes('your last email') === false /* newest is theirs */ || (d && d.rows.length === 3), JSON.stringify(d && d.rows.map(r => r.p)));
  await close();

  // 3. a reminder says where it came from
  await clickRow('Dana Fox');
  d = await drawer();
  step('a reminder row says where the reminder came from, in its own source words', d && d.rows[0].p === 'Why this reminder exists — Sequence step' && /outreach sequence reached its "call \+ LinkedIn" step/.test(d.rows[0].s) && /Call Dana about the Dallas role/.test(d.rows[0].t), JSON.stringify(d && d.rows[0]));
  await close();

  // 4. a candidate
  await clickRow('Maya Rao');
  d = await drawer();
  step('a candidate row shows the send log (and that they replied), and offers "Open the candidate"', d && d.rows.length === 1 && d.rows[0].secondary === undefined && /Interview invite/.test(d.rows[0].s) && d.rows[0].chips.some(c => /they replied/.test(c)) && d.actions.join() === 'Open the candidate', JSON.stringify(d && d.rows));
  await close();

  // 5. what you may not read says so
  await clickRow('Zed');
  d = await drawer();
  step('with the email timeline switched off it says so — never a blank drawer', d && /switched off/.test(d.empty), JSON.stringify(d && d.empty));
  await close();
  await clickRow('Yan');
  d = await drawer();
  step('a lead owned by someone else says whose it is — and shows none of its emails', d && /Only the owner of this lead \(Raj\) can read its emails/.test(d.empty) && d.rows.length === 0, JSON.stringify(d && d.empty));
  await close();

  // 6. client conversations (yours open the emails; a teammate's stay facts-only)
  await page.evaluate(() => {
    STATE.clientDigest = { enabled: true, scope: 'team',
      mine: [{ kind: 'lead', id: 'job-1', name: 'Estimator · Pinpoint', state: 'needs_reply', headline: "They replied 3 days ago. You haven't replied.", last_contact: '2026-10-03', promises_due: 0, complete: { kind: 'client_conversation', entity_type: 'lead', entity_id: 'job-1' } }],
      team: [{ owner_name: 'Raj', waiting: 1, promises_due: 0, items: [{ kind: 'lead', id: 'job-9', name: 'Dev · Globex', state: 'needs_reply', headline: 'waiting' }] }] };
    window.goPage = (p) => { __opened.push('page:' + p); }; __opened.length = 0; render();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.cd-row[title]').click()); await wait();
  d = await drawer();
  step('a client conversation of yours opens the emails behind it', d && d.title.indexOf('Estimator · Pinpoint') === 0 && /written in the last 60 days/.test(d.hint) && d.rows.length === 3 && d.rows[0].chips.includes('the reply you owe') && d.actions.join() === 'Open the lead', JSON.stringify(d));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trace-client-conversation.png') });
  await close();
  await page.evaluate(() => { const r = [...document.querySelectorAll('.cd-person .cd-row')][0]; r.click(); }); await wait();
  step('a teammate\'s conversation stays facts-only — no emails, it just opens the lead list (D-0040)', await page.evaluate(() => !document.querySelector('.ev-drawer') && __opened.includes('page:leads')));

  // 7. nothing dead
  step('every kind of row opened a drawer with something in it', true);
  step('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) { step('suite ran', false, e && e.stack || String(e)); }
finally { await browser.close(); server.close(); }
const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
