// EVERY NEW SEQUENCE IS MADE IN THE NEW BUILDER (owner, 19 Oct, R-269/R-270, D-0158/D-0159). In a real browser:
//   * Email → Sequence lists "Your outreach" and every named sequence; the old window's ones say they keep running as they are;
//   * "+ New sequence" opens the NEW builder (never the old window), with a name, for leads or candidates;
//   * a lead sequence saves as a named workflow (first email + follow-ups as days-after-the-step-before), switched on;
//   * ticking candidates on a job → "Build a new sequence" opens the new builder FOR CANDIDATES, with the AI switch, and
//     "Save and start for N" saves it and starts it for exactly those candidates;
//   * Edit on a new-builder sequence opens it in the new builder; Edit on an old one opens the old window (it may hold steps
//     the new builder does not draw) — and that window can no longer save a NEW sequence.
// SHOTS=dir saves pictures.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin, switchRole } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS || '';
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };
function findChromium() { const b = process.env.PLAYWRIGHT_BROWSERS_PATH; if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium'); return 'chromium'; }
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'bd_lead');
  await page.evaluate(() => {
    const v2 = (o) => Object.assign({ builder: 'v2' }, o);
    window.__defs = [
      { id: 'old1', name: 'Standard Sales Outreach', entity_type: 'contact', status: 'active', created_by: 'test-bdl', steps: [
        { step_order: 1, name: 'Initial', channel: 'email', delay_days: 0, config: { template_key: 'initial' } },
        { step_order: 2, name: 'Call', channel: 'bd_touch', delay_days: 3, config: {} } ] },
      { id: 'new1', name: 'Java devs — health', entity_type: 'contact', status: 'active', created_by: 'test-bdl', steps: [
        { step_order: 1, name: 'First email', channel: 'email', delay_days: 0, config: v2({ subject: '{{pos}} at {{company}}', body: 'Hi {{fn}}, two Java developers are ready for {{company}}.', template_key: 'initial' }) },
        { step_order: 2, name: 'Follow-up 1', channel: 'email', delay_days: 4, config: v2({ subject: 'Re: x', body: 'Following up, {{fn}}.', template_key: 'fu1', thread: true }) },
        { step_order: 3, name: 'Follow-up 2', channel: 'email', delay_days: 6, config: v2({ subject: 'Re: x', body: 'Last note from me.', template_key: 'fu2', thread: true }) } ] },
    ];
    window.__calls = [];
    window.apiFetch = (m, p, b) => { __calls.push([m, p, b ? JSON.parse(JSON.stringify(b)) : null]);
      if (m === 'GET' && p === '/wf/definitions') return Promise.resolve(__defs);
      if (m === 'GET' && p === '/wf/stats') return Promise.resolve({ by_workflow: {} });
      if (m === 'GET' && p === '/wf/channels') return Promise.resolve({ channels: ['email', 'bd_touch', 'candidate_email'], catalogue: [] });
      if (m === 'GET' && p === '/wf/sending-mailboxes') return Promise.resolve([{ id: 'mb1', email_address: 'me@ours.test', connected: true, owner_id: 'test-bdl' }]);
      if (m === 'GET' && p === '/my-setup/sequence') return Promise.resolve({ sample: { vars: { fn: 'Dana', company: 'Acme Health', pos: 'Senior Java Developer', city: 'Dallas' }, name: 'Dana Lee', company: 'Acme Health', example: false }, followup_max: 5 });
      if (m === 'POST' && p === '/wf/definitions') return Promise.resolve({ id: 'created1', name: b.name, steps: b.steps });
      if (m === 'GET') return Promise.resolve(/enrollments|primary/.test(p) ? (/primary/.test(p) ? {} : []) : []);
      return Promise.resolve({ ok: true, enrolled: 2 }); };
    STATE.page = 'email'; STATE.emailTab = 'sequence'; STATE.seqView = 'sequences'; render();
  });
  await page.waitForTimeout(500);
  const content = () => page.evaluate(() => document.getElementById('content').innerText.replace(/\s+/g, ' '));
  let t = await content();
  step('Sequence tab: "Your outreach" first, then the named sequences', /Your outreach/.test(t) && /Java devs — health/.test(t) && /Standard Sales Outreach/.test(t), t.slice(0, 200));
  step('…an old-window sequence says it keeps running as it is; a new-builder one does not', /Standard Sales Outreach[^]*made in the old window — it keeps running as it is/.test(t) && !/Java devs — health[^]*?old window[^]*Standard/.test(t));
  step('…the long old intro text is gone', !/initial email → follow-ups → LinkedIn touch/.test(t));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'b3-sequence-list.png') });

  // + New sequence → the NEW builder (bd_lead does both leads and candidates → asked who it is for)
  await page.click('[data-wf-new]'); await page.waitForTimeout(250);
  step('"+ New sequence" asks who it is for (leads or candidates on a job)', await page.evaluate(() => !!document.querySelector('[data-wf-who]')));
  await page.evaluate(() => [...document.querySelectorAll('[data-wf-who] button')].find(b => b.textContent === 'Leads').click());
  await page.waitForTimeout(400);
  const inNew = await page.evaluate(() => ({ page: STATE.page, h1: (document.querySelector('.sq-h1') || {}).textContent || '', name: !!document.getElementById('sq-name'), old: !!document.querySelector('.seq-modal') }));
  step('…and opens the NEW builder for leads, with a name box — never the old window', inNew.page === 'seqsetup' && /New sequence — leads/.test(inNew.h1) && inNew.name && !inNew.old, JSON.stringify(inNew));
  step('…a lead sequence has no "I write it / AI" choice (AI for leads lives in Your outreach)', await page.evaluate(() => !document.querySelector('.sq-choices')));
  // write it
  await page.fill('#sq-name', 'Accountants — Ohio');
  await page.evaluate(() => { const s = document.getElementById('sq-subj'), b = document.getElementById('sq-body');
    s.innerHTML = 'Accountants for your team'; s.dispatchEvent(new Event('input', { bubbles: true }));
    b.innerHTML = 'Hi there, I have two pre-screened accountants who could start soon. Worth a look?'; b.dispatchEvent(new Event('input', { bubbles: true }));
    const f = document.getElementById('sq-fu0'); f.innerHTML = 'Just checking you saw my note.'; f.dispatchEvent(new Event('input', { bubbles: true })); });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'b3-new-lead-sequence.png'), fullPage: false });
  await page.click('[data-sq="addfu"]'); await page.waitForTimeout(150);
  await page.evaluate(() => { const f = document.getElementById('sq-fu1'); f.innerHTML = 'Last note from me on this.'; f.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-sq="next"]'); await page.waitForTimeout(250);
  t = await content();
  step('step 2 shows what a lead gets and the follow-up days', /What a lead gets/.test(t) && /follow-up on day 3/.test(t) && /day 7/.test(t), t.slice(0, 260));
  await page.click('[data-sq="save"]'); await page.waitForTimeout(500);
  const posted = await page.evaluate(() => __calls.find(c => c[0] === 'POST' && c[1] === '/wf/definitions'));
  const pb = posted && posted[2];
  step('saved as a named lead workflow', pb && pb.name === 'Accountants — Ohio' && pb.entity_type === 'contact' && pb.domain === 'sales', JSON.stringify(pb).slice(0, 200));
  step('…first email + 2 follow-ups, each marked as written in the new builder', pb && pb.steps.length === 3 && pb.steps.every(s => s.channel === 'email' && s.config.builder === 'v2'));
  step('…follow-up days become days after the step before (day 3 → +3, day 7 → +4), threaded as replies', pb && pb.steps[0].delay_days === 0 && pb.steps[1].delay_days === 3 && pb.steps[2].delay_days === 4 && pb.steps[1].config.template_key === 'fu1' && pb.steps[2].config.thread === true, JSON.stringify(pb && pb.steps.map(s => [s.delay_days, s.config.template_key])));
  step('…and switched on', await page.evaluate(() => __calls.some(c => c[0] === 'POST' && c[1] === '/wf/definitions/created1/status' && c[2].status === 'active')));
  step('the screen says it is saved and on', /Accountants — Ohio is saved and on/.test(await content()));

  // Ticked candidates on a job → Build a new sequence → the new builder for candidates
  await page.evaluate(() => { STATE.page = 'email'; render(); wfStartSequence('submission', [{ entity_id: 'sub1' }, { entity_id: 'sub2' }], { anyStage: true }); });
  await page.waitForTimeout(400);
  await page.evaluate(() => wfStartBuildNew()); await page.waitForTimeout(400);
  const cand = await page.evaluate(() => ({ page: STATE.page, h1: (document.querySelector('.sq-h1') || {}).textContent || '', choices: [...document.querySelectorAll('.sq-choice b')].map(b => b.textContent), menu: [...document.querySelectorAll('.sq-it span')].map(s => s.firstChild && s.firstChild.textContent).join('|') }));
  step('ticked candidates → "Build a new sequence" opens the NEW builder for candidates (not the old window)', cand.page === 'seqsetup' && /New sequence — candidates/.test(cand.h1), JSON.stringify(cand));
  step('…with the AI switch: "I write it" or "AI writes each one"', cand.choices.join('|') === 'I write it|AI writes each one', cand.choices.join('|'));
  await page.evaluate(() => document.querySelector('[data-sq="mode"][data-mode="ai"]').click()); await page.waitForTimeout(150);
  await page.fill('#sq-name', 'Site engineers — Houston');
  await page.evaluate(() => { const s = document.getElementById('sq-subj'), b = document.getElementById('sq-body');
    s.innerHTML = 'A role near you'; s.dispatchEvent(new Event('input', { bubbles: true }));
    b.innerHTML = 'Hi, a site role came up that fits your background. Interested?'; b.dispatchEvent(new Event('input', { bubbles: true }));
    const f = document.getElementById('sq-fu0'); f.innerHTML = 'Any thoughts on the role?'; f.dispatchEvent(new Event('input', { bubbles: true })); });
  const candT = await content();
  step('…AI on for candidates: no "Teach the AI" card, the written email is called the backup, no lead-only AI buttons', !/Teach the AI/.test(candT) && /Your backup email/.test(candT) && !/Stuck\? Draft it with AI/.test(candT) && !/Write one with AI from my first email/.test(candT), candT.slice(0, 200));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'b3-new-candidate-sequence.png') });
  await page.click('[data-sq="next"]'); await page.waitForTimeout(250);
  const saveTxt = await page.evaluate(() => (document.querySelector('[data-sq="save"]') || {}).textContent || '');
  step('step 2: "Save and start for 2 candidates"', /Save and start for 2 candidates/.test(saveTxt), saveTxt);
  await page.evaluate(() => { __calls.length = 0; }); await page.click('[data-sq="save"]'); await page.waitForTimeout(600);
  const cb = await page.evaluate(() => (__calls.find(c => c[0] === 'POST' && c[1] === '/wf/definitions') || [])[2]);
  step('…saved as a candidate workflow with the AI switch on the first email only', cb && cb.entity_type === 'submission' && cb.domain === 'recruiting' && cb.steps[0].channel === 'candidate_email' && cb.steps[0].config.ai === true && !cb.steps[1].config.ai, JSON.stringify(cb).slice(0, 220));
  const enr = await page.evaluate(() => (__calls.find(c => c[1] === '/wf/enroll-bulk') || [])[2]);
  step('…and started for exactly the 2 ticked candidates', enr && enr.workflow_id === 'created1' && enr.entity_type === 'submission' && (enr.items || []).length === 2, JSON.stringify(enr).slice(0, 200));

  // Edit: new-builder one → new builder (with its days back); old one → old window, which cannot save a NEW one
  await page.evaluate(() => { STATE.page = 'email'; STATE.emailTab = 'sequence'; STATE.wf = undefined; render(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => wfOpenBuilder('new1')); await page.waitForTimeout(400);
  const ed = await page.evaluate(() => ({ page: STATE.page, h1: (document.querySelector('.sq-h1') || {}).textContent || '', name: (document.getElementById('sq-name') || {}).value, days: [...document.querySelectorAll('[data-sq-day]')].map(s => s.value).join(',') }));
  step('Edit on a new-builder sequence opens it in the new builder, name and days back (+4, +6 → day 4, day 10)', ed.page === 'seqsetup' && /Edit sequence — leads/.test(ed.h1) && ed.name === 'Java devs — health' && ed.days === '4,10', JSON.stringify(ed));
  await page.evaluate(() => { STATE.page = 'email'; render(); wfOpenBuilder('old1'); }); await page.waitForTimeout(400);
  const old = await page.evaluate(() => ({ modal: !!document.querySelector('.seq-modal'), saveNew: [...document.querySelectorAll('.modal button')].map(b => b.textContent).join('|') }));
  step('Edit on an OLD sequence opens the old window (its steps are kept as they are)', old.modal, JSON.stringify(old));
  step('…and the old window offers no "Save as a new sequence"', !/Save as a new sequence/.test(old.saveNew), old.saveNew);
  step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { step('suite ran', false, e && e.stack || String(e)); }
finally { await browser.close(); server.close(); }
const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
