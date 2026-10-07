// The sequence builder's email step (D-0077), in a real browser, API stubbed:
//   * a step is EITHER a saved template (Outreach 1 / Follow-up 1 / Follow-up 2)
//     OR its own subject + body; nothing extra is stored on the step;
//   * one-click merge-field chips insert at the caret of the field in use;
//   * a live preview fills the fields for an example person and MARKS one PACE
//     cannot fill — and saving is refused for it (a send would be);
//   * "Write with AI" puts a draft in, says where it came from, can be undone;
//     "Start from an example" works with no AI; an empty instruction is not sent;
//   * "Edit a copy for this step" brings the saved template's words in;
//   * the names the browser knows are exactly the names the server can fill.
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
  await page.goto(BASE + '/'); await waitForLogin(page); await enterApp(page, 'admin');
  await page.evaluate(() => {
    window.__posts = []; window.__toasts = []; window.__draft = null;
    window.apiPost = (p, b) => { __posts.push([p, JSON.parse(JSON.stringify(b))]);
      if (p === '/wf/draft-email') return __draft ? Promise.resolve(__draft(b)) : Promise.reject(new Error('down'));
      return Promise.resolve({ id: 'wf-1' }); };
    window.apiPut = (p, b) => { __posts.push(['PUT ' + p, JSON.parse(JSON.stringify(b))]); return Promise.resolve({ id: 'wf-1' }); };
    window.showToast = (m, t) => __toasts.push([m, t]);
    window.loadWorkflows = () => {};
    STATE.emailSubj = 'Outreach one for {{pos}}'; STATE.emailBody = 'Hi {{fn}}, my own Outreach 1 words.';
    STATE.fu1Subj = 'Re: {{pos}}'; STATE.fu1Body = 'Hi {{fn}}, my follow-up words.';
    STATE.page = 'email'; STATE.emailTab = 'sequence';
    wfOpenBuilder();
  });
  await page.waitForSelector('.seq-modal');
  const sel = (q) => page.evaluate((s) => !!document.querySelector(s), q);
  const val = (id) => page.evaluate((i) => document.getElementById(i).value, id);

  step('the names the browser accepts are EXACTLY the names the server can fill', JSON.stringify((await page.evaluate(() => WF_VARS.slice().sort()))) === JSON.stringify(SERVER_VARS));

  step('the window sits ABOVE the sidebar (its left edge is not hidden under the menu)', await page.evaluate(() => { const m = document.querySelector('.seq-modal').getBoundingClientRect(); const el = document.elementFromPoint(m.left + 6, 300); return !!(el && el.closest('.overlay')); }));

  // 1. saved template mode
  const saved = await page.evaluate(() => ({ seg: [...document.querySelectorAll('.seq-seg')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')), opts: [...document.querySelectorAll('.seq-body select')].map(s => [...s.options].map(o => o.textContent)).filter(o => /Outreach 1/.test(o.join())).flat() }));
  step('a step starts on "Use a saved template", offering Outreach 1 / Follow-up 1 / Follow-up 2 by name (not initial/fu1/fu2)', saved.seg.join() === 'Use a saved template*,Write it for this step' && saved.opts.join() === 'Outreach 1 — your first email,Follow-up 1,Follow-up 2', JSON.stringify(saved));
  step('…it says where those templates are edited (Email → Sequence → My wording — Outreach Plan lives inside Sequence now)', await page.evaluate(() => /My wording/.test(document.querySelector('.seq-body').textContent) && !/Outreach Plan/.test(document.querySelector('.seq-body').textContent)));
  step('…and offers "Edit my wording" beside it (R-146)', await page.evaluate(() => [...document.querySelectorAll('.seq-body button')].some(x => /Edit my wording/.test(x.textContent))));

  // 2. copy a saved template into the step
  await page.evaluate(() => [...document.querySelectorAll('.seq-body .btn')].find(b => /Edit a copy/.test(b.textContent)).click());
  step('"Edit a copy for this step" brings the person\'s OWN template words in, and says it is a copy', await val('wf-subj-0') === 'Outreach one for {{pos}}' && /my own Outreach 1 words/.test(await val('wf-body-0')) && await page.evaluate(() => /a copy of your template/.test(document.querySelector('.seq-note').textContent)));

  // 3. chips insert at the caret of the field in use
  await page.evaluate(() => { const b = document.getElementById('wf-body-0'); b.value = 'Hi , about the role'; b.focus(); b.setSelectionRange(3, 3); b.dispatchEvent(new Event('focus')); b.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => [...document.querySelectorAll('.seq-chip')].find(b => b.textContent === 'First name').click());
  step('a chip inserts the merge field AT THE CARET of the body', await val('wf-body-0') === 'Hi {{fn}}, about the role');
  await page.evaluate(() => { const s = document.getElementById('wf-subj-0'); s.focus(); s.dispatchEvent(new Event('focus')); s.setSelectionRange(s.value.length, s.value.length); });
  await page.evaluate(() => [...document.querySelectorAll('.seq-chip')].find(b => b.textContent === 'Company').click());
  step('…and into the SUBJECT when that is the field in use', (await val('wf-subj-0')).endsWith('{{company}}'));
  step('the step stored the words (state, not just the box)', await page.evaluate(() => STATE.wfBuilder.steps[0].config.body === 'Hi {{fn}}, about the role'));

  // 4. preview
  const prev = await page.evaluate(() => document.getElementById('wf-prev-0').innerText);
  step('the preview fills the fields for an example person (Dana Fox at Acme)', /Hi Dana, about the role/.test(prev) && /Acme Construction/.test(prev) && !/\{\{fn\}\}/.test(prev), prev.slice(0, 120));
  await page.evaluate(() => { const b = document.getElementById('wf-body-0'); b.value = 'Hi {{fn}}, your {{salary}} range?'; b.dispatchEvent(new Event('input', { bubbles: true })); });
  const bad = await page.evaluate(() => ({ marks: [...document.querySelectorAll('#wf-prev-0 .seq-bad')].map(m => m.textContent), warn: (document.querySelector('#wf-prev-0 .seq-prev-warn') || {}).textContent || '' }));
  step('a field PACE cannot fill is MARKED in the preview, never blanked, and the person is told', bad.marks.join() === '{{salary}}' && /cannot fill \{\{salary\}\}/.test(bad.warn), JSON.stringify(bad));
  await page.evaluate(() => { __posts.length = 0; __toasts.length = 0; document.querySelector('.seq-modal input.inp').value = 'My sequence'; wfBuilderField('name', 'My sequence'); wfSaveDefinition(); });
  step('saving is REFUSED while a step uses a field PACE cannot fill — a send would be refused too', await page.evaluate(() => __posts.length === 0 && /cannot fill \{\{salary\}\}/.test(__toasts.map(t => t[0]).join())));

  // 5. the AI writer
  await page.evaluate(() => { const b = document.getElementById('wf-body-0'); b.value = 'Hi {{fn}}, a plain body that is long enough.'; b.dispatchEvent(new Event('input', { bubbles: true })); __toasts.length = 0; });
  await page.evaluate(() => [...document.querySelectorAll('.seq-ai .btn')].find(b => /Write with AI/.test(b.textContent)).click());
  step('an EMPTY instruction is not sent — the person is told what to do', await page.evaluate(() => !__posts.some(p => p[0] === '/wf/draft-email') && /Say in a few words/.test(__toasts.map(t => t[0]).join())));
  await page.evaluate(() => { __draft = (b) => ({ subject: 'Estimators for {{company}}', body: 'Hi {{fn}},\n\nA written-by-AI body.\n\nWould you like their resumes?', source: 'ai', note: 'Written by AI from your instruction — read it before you save.', purpose: b.purpose }); });
  await page.fill('#wf-ai-0', 'offer two estimators');
  await page.evaluate(() => [...document.querySelectorAll('.seq-ai .btn')].find(b => /Write with AI/.test(b.textContent)).click());
  await page.waitForTimeout(200);
  const asked = await page.evaluate(() => __posts.filter(p => p[0] === '/wf/draft-email').map(p => p[1]));
  step('"Write with AI" sends the instruction with the step\'s purpose (step 1 = a first email)', asked.length === 1 && asked[0].prompt === 'offer two estimators' && asked[0].purpose === 'first', JSON.stringify(asked));
  step('…the draft lands in the boxes, says it is AI-written, and the instruction is kept', await val('wf-subj-0') === 'Estimators for {{company}}' && /A written-by-AI body/.test(await val('wf-body-0')) && await page.evaluate(() => /Written by AI/.test(document.querySelector('.seq-note').textContent)) && await val('wf-ai-0') === 'offer two estimators');
  await page.evaluate(() => [...document.querySelectorAll('.seq-ai .btn')].find(b => /Undo/.test(b.textContent)).click());
  step('Undo puts back exactly what was there before', (await val('wf-body-0')).startsWith('Hi {{fn}}, a plain body that is long enough.'));
  await page.evaluate(() => { __draft = (b) => ({ subject: 'Candidates for your {{pos}} role in {{loc}}', body: 'Hi {{fn}},\n\nStarter body.', source: 'starter', note: 'The AI writer is not available right now, so here is a ready-made starter to edit.' }); });
  await page.evaluate(() => [...document.querySelectorAll('.seq-ai .btn')].find(b => /Start from an example/.test(b.textContent)).click());
  await page.waitForTimeout(200);
  step('"Start from an example" works with no instruction, and a starter SAYS it is a starter', await page.evaluate(() => __posts.filter(p => p[0] === '/wf/draft-email').pop()[1].prompt === '') && await page.evaluate(() => /ready-made starter/.test(document.querySelector('.seq-note').textContent)));
  await page.evaluate(() => { __draft = null; });
  await page.evaluate(() => [...document.querySelectorAll('.seq-ai .btn')].find(b => /Write with AI/.test(b.textContent)).click());
  await page.waitForTimeout(200);
  step('if the writer cannot be reached the person is told, and nothing they wrote is lost', await page.evaluate(() => /Could not reach the writer/.test(document.querySelector('.seq-note').textContent)) && (await val('wf-body-0')).includes('Starter body'));
  if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, 'sequence-builder-own.png') }); }

  // 6. a second step is a follow-up; the last is the final one
  await page.evaluate(() => { wfAddStep(); wfAddStep(); wfEmailMode(2, true); __posts.length = 0; __draft = (b) => ({ subject: 'Re: x {{pos}}', body: 'Hi {{fn}}, short note here for you.', source: 'ai', note: 'ok' }); wfAiPrompt(2, 'a gentle last nudge'); wfDraftAi(2, true); });
  await page.waitForTimeout(200);
  step('the LAST step asks for a last follow-up; a middle one a follow-up', await page.evaluate(() => __posts.pop()[1].purpose === 'final'));

  // 7. saving stores only subject + body + template_key + thread (nothing screen-only)
  await page.evaluate(() => { __posts.length = 0; __toasts.length = 0; wfEmailMode(1, true); });
  await page.evaluate(() => { const s = STATE.wfBuilder.steps; s[1].config.subject = 'Only a subject'; s[1].config.body = ''; wfSaveDefinition(); });
  step('an own-text step with only ONE of subject/body is refused (both, or switch back)', await page.evaluate(() => __posts.length === 0 && /Step 2: write both/.test(__toasts.map(t => t[0]).join())), await page.evaluate(() => __toasts.map(t => t[0]).join()));
  await page.evaluate(() => { const s = STATE.wfBuilder.steps; s[0].config.subject = 'Hello {{fn}}'; s[0].config.body = 'Hi {{fn}}, a complete email body here.'; s[1].config.subject = 'Re: {{pos}}'; s[1].config.body = 'Hi {{fn}}, a complete follow-up body.'; s[2].config.subject = 'Last {{pos}}'; s[2].config.body = 'Hi {{fn}}, a complete last note.'; __posts.length = 0; __toasts.length = 0; wfSaveDefinition(); });
  await page.waitForTimeout(150);
  const saved2 = await page.evaluate(() => __posts.find(p => p[0] === '/wf/definitions' || /wf\/definitions/.test(p[0])));
  const cfgs = saved2 ? saved2[1].steps.map(s => Object.keys(s.config).sort().join()) : [];
  step('what is saved is the step\'s subject, body, template_key and thread — nothing screen-only leaks in', saved2 && cfgs.every(k => /^(body,subject,template_key,thread|body,subject,template_key)$/.test(k)) && !JSON.stringify(saved2[1]).includes('prompt') && !JSON.stringify(saved2[1]).includes('undo'), JSON.stringify(cfgs));

  // 8. switching back to a saved template drops the words — but undo keeps them
  await page.evaluate(() => { wfOpenBuilder(); wfEmailMode(0, true); wfOwnText(0, 'subject', 'Kept {{pos}}'); wfOwnText(0, 'body', 'Hi {{fn}}, words I would not like to lose.'); wfEmailMode(0, false); });
  step('switching back to a saved template removes the own words from the step…', await page.evaluate(() => !('subject' in STATE.wfBuilder.steps[0].config) && !('body' in STATE.wfBuilder.steps[0].config)));
  await page.evaluate(() => wfEmailMode(0, true));
  step('…and a blank own-text step saved untouched goes back to the saved template (never an empty email)', await page.evaluate(() => { const st = STATE.wfBuilder.steps[0]; st.config.subject = ''; st.config.body = ''; STATE.wfBuilder.name = 'x'; __posts.length = 0; wfSaveDefinition(); const sent = __posts[0]; return sent && !('subject' in sent[1].steps[0].config) && sent[1].steps[0].config.template_key; }));
  // 9. A SEQUENCE WITH PEOPLE IN IT cannot have its steps changed (the server says 409). The editor says so
  //    BEFORE anything is written, with the number, and offers "Save as a new sequence" (owner, 6 Oct: they
  //    wrote a whole email and was only told on Save).
  await page.evaluate(() => {
    STATE.wf = { stats: { by_workflow: { 'wf-live': { active: 3 }, 'wf-idle': { active: 0 } } }, defs: [
      { id: 'wf-live', name: 'Client intro', description: '', domain: 'sales', entity_type: 'contact', status: 'active', steps: [{ name: 'Email', channel: 'email', delay_days: 0, config: { template: 'initial' } }] },
      { id: 'wf-idle', name: 'Idle one', description: '', domain: 'sales', entity_type: 'contact', status: 'active', steps: [{ name: 'Email', channel: 'email', delay_days: 0, config: { template: 'initial' } }] }] };
    __posts.length = 0; __toasts.length = 0; wfOpenBuilder('wf-live');
  });
  await page.waitForSelector('.seq-modal');
  step('a sequence with 3 people in it says so AT THE TOP, with the number', await page.evaluate(() => { const b = document.querySelector('.wf-lock'); return !!b && /3 people are in this sequence/.test(b.innerText) && b.compareDocumentPosition(document.querySelector('.seq')) & Node.DOCUMENT_POSITION_FOLLOWING; }));
  step('…Save is switched off and "Save as a new sequence" is the button offered', await page.evaluate(() => { const f = document.querySelector('.seq-modal .mf'); const save = [...f.querySelectorAll('button')].find(x => x.textContent.trim() === 'Save'); return !!save && save.disabled && !!f.querySelector('.wf-save-new'); }));
  await page.evaluate(() => { wfEmailMode(0, true); wfOwnText(0, 'subject', 'New words for {{pos}}'); wfOwnText(0, 'body', 'Hi {{fn}}, this is what I wrote while people were still in the old one.'); __posts.length = 0; wfSaveAsNew(); });
  await page.waitForTimeout(200);
  const asNew = await page.evaluate(() => ({ posts: __posts.map(p => p[0]), body: (__posts.find(p => p[0] === '/wf/definitions') || [null, {}])[1], toasts: __toasts.map(t => t[0]).join('|') }));
  step('Save as a new sequence CREATES one (POST) — it never edits the old one (no PUT)', asNew.posts.length === 1 && asNew.posts[0] === '/wf/definitions', JSON.stringify(asNew.posts));
  step('…the new one has the person\'s writing, and a name that is not the same as the old one', asNew.body && asNew.body.steps[0].config.subject === 'New words for {{pos}}' && asNew.body.name !== 'Client intro' && /Client intro/.test(asNew.body.name), JSON.stringify(asNew.body && asNew.body.name));
  step('…and the toast says the old one carries on unchanged', /old one carries on/.test(asNew.toasts), asNew.toasts);
  await page.evaluate(() => { __posts.length = 0; wfOpenBuilder('wf-idle'); });
  await page.waitForSelector('.seq-modal');
  step('a sequence with nobody in it has no warning and a normal Save', await page.evaluate(() => !document.querySelector('.wf-lock') && !document.querySelector('.wf-save-new') && [...document.querySelectorAll('.seq-modal .mf button')].some(x => x.textContent.trim() === 'Save' && !x.disabled)));
  // last, because it closes the window: Edit my wording opens that wording, with its live preview (R-146)
  step('"Edit my wording" closes the window and opens that wording with its live preview (R-146)', await page.evaluate(() => {
    const b = [...document.querySelectorAll('.seq-body button')].find(x => /Edit my wording/.test(x.textContent)); if (!b) return false;
    b.click();
    return !STATE.wfBuilder && STATE.emailTab === 'sequence' && STATE.seqView === 'wording' && !!STATE.activeTmpl;
  }));
  step('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} catch (e) { step('suite ran', false, e && e.stack || String(e)); }
finally { await browser.close(); server.close(); }
const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
