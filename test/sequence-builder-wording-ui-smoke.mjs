// THE BUILDER HOLDS EVERYTHING THE OLD "MY WORDING" TAB DID (D-0161 "nothing existing is lost"; R-285, R-286), in a real browser.
// It replaces four suites that drove the removed tab (ai-wording-ui, followup-count-ui, plan-editor-keeps-typing, wording-scope-ui):
//   * the doors: My Setup's "Open it" / "Open my writing style" and a step's "Edit my wording" open the builder (not the gone tab);
//     "Open my writing style" opens it with "How the AI writes for you" already open;
//   * one email for all email IDs, or one each (R-176 → R-285): the choice, a tab per email ID showing its own wording, the
//     main wording untouched when an email ID's is edited, and each saved through the endpoints the old tab used;
//   * per follow-up: in the same thread or as a new email — saved at once — and a new email gets its own subject (R-286);
//   * "Rewrite with AI" on a written email, with Undo, and "Check for spam triggers" (R-286);
//   * how many follow-ups is the person's choice (add / remove), and typing survives the app's repaints.
// Usage: node test/sequence-builder-wording-ui-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const R = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(R + '/index.js');
const { chromium } = require('playwright-core');
const { enterApp, waitForLogin } = await import(R + '/test/helpers/enter-app.mjs');
const ev = require(R + '/email-vars.js'); const teachMod = require(R + '/services/ai-teach.js');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? ' -> ' + x : '')); } };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(R, 'public', p), (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(d); }); });
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))); const BASE = 'http://127.0.0.1:' + PORT;
const job = { position: 'Senior Java Developer', location: 'Dallas, TX', company: { name: 'Acme Health', industry: 'Healthcare' } };
const vars = ev.buildEmailVars({ job, contact: { first_name: 'Dana', last_name: 'Lee', email: 'dana@acme.example' }, senderDisplayName: ev.DEFER_SENDER });
Object.keys(vars).forEach(k => { if (vars[k] === null) delete vars[k]; });
let saved = null; const posts = []; const drafts = []; const spam = [];
async function api(route) {
  const req = route.request(), u = new URL(req.url()), m = req.method(), body = req.postData() ? JSON.parse(req.postData()) : null;
  const j = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/my-setup/sequence' && m === 'GET') return j({ mode: 'template', teach: teachMod.normalize(null), teach_options: teachMod.options(),
    first: { subject: 'About {{company}}', body: 'Hi {{fn}},\n\nMain wording here.\n\nThanks,\n{{sender}}', versions: [] },
    followups: [{ day: 3, subject: '', body: 'Just checking you saw my note.', thread: 'same', versions: [] }], followup_max: 5,
    sample: { vars, example: false, name: 'Dana Lee', company: 'Acme Health', email: 'dana@acme.example' } });
  if (u.pathname === '/my-setup/sequence' && m === 'PUT') { saved = body; return j({ ok: true }); }
  if (u.pathname === '/my-setup/sequence/draft') { drafts.push(body); return j({ source: 'ai', subject: 'Rewritten {{pos}}', body: 'Hello {{fn}},\n\nRewritten by AI.\n\nThanks,', note: 'Rewritten.' }); }
  if (u.pathname === '/my-setup/sequence/preview') return j({ subject: ev.fillTemplate(body.subject, vars), body: ev.fillTemplate(body.body, vars), version: 1, versions: 1, to: { name: 'Dana Lee', company: 'Acme Health' }, example: false, missing: [] });
  if (u.pathname === '/emails/spam-check') { spam.push(body); return j({ score: 12, level: 'ok', warnings: [] }); }
  if (u.pathname === '/outreach-plan' && m === 'GET') return j({ tmpl_scope: 'all' });
  if (u.pathname === '/outreach-plan/mailboxes') return j({ emails: [{ id: 'mb1', email: 'prince@futeglobal.com' }, { id: 'mb2', email: 'prince@vhcstaffing.com' }],
    mailboxes: { mb2: { tmpl_o1_subject: 'VHC subject', tmpl_o1_body: 'VHC wording for {{fn}}\n{{sender}}' } } });
  if (u.pathname === '/mailbox/accounts') return j([{ id: 'mb1', email_address: 'prince@futeglobal.com', display_name: 'Prince at Fute', is_primary: true, is_active: true },
    { id: 'mb2', email_address: 'prince@vhcstaffing.com', display_name: 'Prince at VHC', is_primary: false, is_active: true }]);
  if (m === 'POST') { posts.push([u.pathname, body]); return j({ ok: true }); }
  return j({});
}
const b = await chromium.launch({ executablePath: (() => { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const bp = process.env.PLAYWRIGHT_BROWSERS_PATH; return bp && fs.existsSync(path.join(bp, 'chromium')) ? path.join(bp, 'chromium') : 'chromium'; })(), args: ['--no-sandbox'] });
const errors = [];
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => { const url = r.request().url(); if (url.startsWith(BASE)) return r.continue(); if (url.includes('onrender.com')) return api(r); return r.abort(); });
  const pg = await ctx.newPage(); pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(BASE + '/'); await waitForLogin(pg); await enterApp(pg, 'bd');

  // ── the doors ──
  await pg.evaluate(() => window.mySetupOpenStyle());
  await pg.waitForSelector('#sq-root #sq-body');
  ok('My Setup → "Open my writing style" opens the builder, with "How the AI writes for you" open', await pg.evaluate(() => STATE.page === 'seqsetup' && !!document.querySelector('details[data-open="aistyle"][open]')));
  await pg.evaluate(() => { STATE.wfBuilder = { steps: [{ config: { template_key: 'fu1' } }] }; window.wfEditMyWording(0); });
  await pg.waitForSelector('#sq-root #sq-body');
  ok('a step\'s "Edit my wording" opens the builder (not the removed Email → My wording tab)', await pg.evaluate(() => STATE.page === 'seqsetup'));
  await pg.evaluate(() => window.mySetupOpenSequence());
  await pg.waitForSelector('#sq-root #sq-body');
  await pg.waitForSelector('[data-sq="scope"]');
  ok('My Setup → "Open it" opens the builder with the person\'s wording', (await pg.textContent('#sq-body')).includes('Main wording here'));
  await pg.waitForFunction(() => /Prince at Fute/.test((document.querySelector('#sq-pv') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
  const pv1 = await pg.textContent('#sq-pv');
  ok('the preview signs as the email ID that sends (the primary one), never the profile name', /Prince at Fute/.test(pv1) && !(await pg.evaluate((t) => t.includes(STATE.user.name), pv1)), pv1.slice(-120));

  // ── R-286: same thread / new email, per follow-up ──
  ok('each follow-up offers "same thread" (the default) or "a new email"', await pg.evaluate(() => document.querySelector('[data-sq="futhread"][data-thr="same"]').getAttribute('aria-checked') === 'true' && !document.getElementById('sq-fusubj0')));
  await pg.click('[data-sq="futhread"][data-thr="new"]');
  await pg.waitForSelector('#sq-fusubj0');
  ok('choosing "a new email" is saved at once', posts.some(p => p[0] === '/outreach-plan' && p[1].key === 'fu1_thread' && p[1].value === 'new'), JSON.stringify(posts));
  ok('…and the follow-up gets a subject of its own', !!(await pg.$('#sq-fusubj0')));
  if (process.env.SHOTS) { await pg.evaluate(() => document.querySelector('[data-sq="futhread"]').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(200); await pg.screenshot({ path: process.env.SHOTS + '/r286-followup-thread.png' }); }
  await pg.click('#sq-fusubj0'); await pg.keyboard.type('A fresh note about ');
  await pg.click('[data-sq="menu"][data-menu="fu0"]'); await pg.click('[data-menu="fu0"] ~ .sq-menu [data-k="pos"]');
  ok('a detail from the menu goes into the follow-up\'s subject when that is where the cursor is', (await pg.innerHTML('#sq-fusubj0')).includes('data-k="pos"'), await pg.innerHTML('#sq-fusubj0'));

  // ── R-286: Rewrite with AI, Undo, spam check ──
  await pg.click('[data-sq="rewrite"][data-slot="first"]');
  await pg.waitForFunction(() => document.querySelector('#sq-body').textContent.includes('Rewritten by AI'));
  ok('"Rewrite with AI" rewrites the email that is written, through the builder\'s own writer', drafts.length === 1 && drafts[0].mode === 'rewrite' && drafts[0].purpose === 'first' && /Main wording here/.test(drafts[0].body), JSON.stringify(drafts[0]));
  await pg.click('[data-sq="rwundo"][data-slot="first"]');
  ok('…and Undo puts the person\'s words back', (await pg.textContent('#sq-body')).includes('Main wording here') && !(await pg.textContent('#sq-body')).includes('Rewritten'));
  await pg.click('[data-sq="spam"][data-slot="0"]');
  await pg.waitForSelector('.seq-spam-box');
  ok('"Check for spam triggers" checks that email and says the score', spam.length === 1 && /Just checking/.test(spam[0].body) && (await pg.textContent('.seq-spam-box')).includes('Spam score 12/100'), JSON.stringify(spam));

  // typing survives the app's own repaints
  await pg.click('#sq-body'); await pg.keyboard.press('End');
  await pg.evaluate(() => { window.render(); window.render(); });
  await pg.keyboard.type(' Kept.');
  ok('typing survives app repaints', (await pg.textContent('#sq-body')).includes('Kept.'));

  // how many follow-ups: the person's choice
  await pg.click('[data-sq="addfu"]');
  ok('a follow-up can be added (the count is the person\'s)', (await pg.$$('[data-sq-day]')).length === 2);
  await pg.click('[data-sq="rmfu"][data-i="1"]');
  ok('…and removed', (await pg.$$('[data-sq-day]')).length === 1);

  // ── R-285: one wording for all email IDs, or one each ──
  ok('"Your email IDs": the same email from all, or a different one for each', (await pg.textContent('#sq-root')).includes('Same email from all my email IDs') && (await pg.textContent('#sq-root')).includes('A different one for each'));
  await pg.click('[data-sq="scope"][data-scope="each"]');
  await pg.waitForSelector('[data-sq="mbtab"][data-mb="mb2"]');
  ok('"a different one for each" shows a tab per email ID, plus the main wording', (await pg.$$('[data-sq="mbtab"]')).length === 3);
  await pg.click('[data-sq="mbtab"][data-mb="mb2"]');
  await pg.waitForFunction(() => document.querySelector('#sq-body').textContent.includes('VHC wording'));
  ok('an email ID\'s tab shows ITS wording', (await pg.textContent('#sq-subj')).includes('VHC subject'));
  ok('…and its preview signs as THAT email ID', /Prince at VHC/.test(await pg.textContent('#sq-pv')));
  await pg.click('[data-sq="mbtab"][data-mb="mb1"]');
  await pg.waitForFunction(() => !document.querySelector('#sq-body').textContent.includes('VHC wording'));
  ok('an email ID with none of its own says it uses the main wording', (await pg.textContent('#sq-root')).includes('Leave an email empty and it uses the main wording'));
  await pg.click('#sq-body'); await pg.keyboard.type('Futeglobal only wording.');
  await pg.click('[data-sq="mbtab"][data-mb="person"]');
  await pg.waitForFunction(() => document.querySelector('#sq-body').textContent.includes('Main wording here'));
  ok('the main wording is untouched by an email ID\'s edit', !(await pg.textContent('#sq-body')).includes('Futeglobal only'));

  // save: the person's wording to /my-setup/sequence, each email ID's to /outreach-plan/mailbox, the choice to tmpl_scope
  await pg.click('[data-sq="next"]'); await pg.waitForSelector('[data-sq="test"]');
  await pg.click('[data-sq="test"]'); await pg.waitForSelector('.sq-mail');
  await pg.click('[data-sq="save"]'); await pg.waitForFunction(() => /Your sequence is on/.test(document.querySelector('#sq-root').textContent));
  ok('saved: the person\'s own wording (with what they typed), not an email ID\'s', saved && /Main wording here/.test(saved.first.body) && /Kept\./.test(saved.first.body) && !/Futeglobal only/.test(saved.first.body), JSON.stringify(saved && saved.first));
  ok('saved: the follow-up\'s own subject, with its detail as a {{field}}', saved && saved.followups.length === 1 && saved.followups[0].subject === 'A fresh note about {{pos}}', JSON.stringify(saved && saved.followups));
  ok('saved: "one each" through the same setting the old tab used', posts.some(p => p[0] === '/outreach-plan' && p[1].key === 'tmpl_scope' && p[1].value === 'each'));
  ok('saved: the email ID\'s own wording through the same endpoint the old tab used', posts.some(p => p[0] === '/outreach-plan/mailbox' && p[1].mailbox_id === 'mb1' && p[1].key === 'tmpl_o1_body' && /Futeglobal only wording/.test(p[1].value)), JSON.stringify(posts.filter(p => p[0] === '/outreach-plan/mailbox')));
  ok('…and an email ID nobody touched is not written', !posts.some(p => p[0] === '/outreach-plan/mailbox' && p[1].mailbox_id === 'mb2'));
  ok('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  ok('ran to the end', false, String(e && e.stack || e));
} finally { await b.close(); server.close(); }
console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail || !pass ? 1 : 0);
