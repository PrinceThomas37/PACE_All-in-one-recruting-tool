// A SEQUENCE WITH PEOPLE INSIDE (D-0217, R-383): the new builder says what may change, wording saves in place (PUT), and when the
// server answers 409 needs_copy the screen offers "Save as a new copy" which CREATES a second sequence and leaves the first alone.
// Usage: node test/sequence-inside-edit-ui-smoke.mjs
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
let putCalls = []; const posts = [];
const def = { id: 'wf-live', name: 'Client intro', status: 'active', entity_type: 'contact', domain: 'sales', people_now: 3, created_by: 'x',
  steps: [{ step_order: 1, name: 'First email', channel: 'email', delay_days: 0, config: { builder: 'v2', subject: 'Hello', body: 'Hi {{fn}}', versions: [], template_key: 'initial' } },
          { step_order: 2, name: 'Follow-up 1', channel: 'email', delay_days: 3, config: { builder: 'v2', subject: 'Re: Hello', body: 'Checking in', versions: [], template_key: 'fu1', thread: true } }] };
async function api(route) {
  const req = route.request(), u = new URL(req.url()), m = req.method(), body = req.postData() ? JSON.parse(req.postData()) : null;
  const j = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/my-setup/sequence' && m === 'GET') return j({ mode: 'template', followup_max: 5, sample: { vars: {}, example: true, name: 'Dana Lee', company: 'Acme' } });
  if (u.pathname === '/wf/definitions/wf-live' && m === 'PUT') { putCalls.push(body); return j({ code: 'needs_copy', people: 3, error: '3 people are in this sequence, and this change the number of steps changed.' }, 409); }
  if (u.pathname === '/wf/definitions' && m === 'POST') { posts.push([u.pathname, body]); return j({ id: 'wf-copy' }); }
  if (m === 'POST') { posts.push([u.pathname, body]); return j({ ok: true }); }
  if (u.pathname === '/outreach-plan/mailboxes') return j({ emails: [], mailboxes: {} });
  if (u.pathname === '/mailbox/accounts') return j([]);
  return j({});
}
const b = await chromium.launch({ executablePath: (() => { if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const bp = process.env.PLAYWRIGHT_BROWSERS_PATH; return bp && fs.existsSync(path.join(bp, 'chromium')) ? path.join(bp, 'chromium') : 'chromium'; })(), args: ['--no-sandbox'] });
const errors = [];
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**', r => { const url = r.request().url(); if (url.startsWith(BASE)) return r.continue(); if (url.includes('onrender.com')) return api(r); return r.abort(); });
  const pg = await ctx.newPage(); pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(BASE + '/'); await waitForLogin(pg); await enterApp(pg, 'bd');
  await pg.evaluate((d) => { STATE.wf = { defs: [d], stats: { by_workflow: {} } }; openSequenceBuilder({ id: 'wf-live', entity_type: 'contact', back: 'email' }); }, def);
  await pg.waitForSelector('#sq-root #sq-body');
  await pg.waitForFunction(() => STATE.seqSetup && STATE.seqSetup.loaded);
  ok('the builder says 3 people are inside and that wording may change', await pg.evaluate(() => { const n = document.querySelector('[data-sq-inside]'); return !!n && /3 people are in it now/.test(n.innerText) && /change the wording/.test(n.innerText); }));
  ok('…and that adding/removing an email or changing days makes a copy', await pg.evaluate(() => /new copy/.test(document.querySelector('[data-sq-inside]').innerText)));
  ok('no copy button before the server has said anything', await pg.evaluate(() => !document.querySelector('[data-sq="savecopy"]')));
  await pg.evaluate(() => { STATE.seqSetup.step = 2; render(); });
  await pg.waitForSelector('[data-sq="save"]');
  await pg.click('[data-sq="save"]');
  await pg.waitForSelector('[data-sq="savecopy"]');
  ok('the save went out as an edit of the SAME sequence (PUT)', putCalls.length === 1);
  ok('the server\'s explanation is shown', await pg.evaluate(() => /3 people are in this sequence/.test(document.body.innerText)));
  await pg.click('[data-sq="savecopy"]');
  await pg.waitForFunction(() => STATE.seqSetup && STATE.seqSetup.saved);
  const created = posts.find(p => p[0] === '/wf/definitions');
  ok('"Save as a new copy" CREATES a second sequence (POST) named as a copy', !!created && /Client intro \(copy\)/.test(created[1].name), JSON.stringify(created && created[1].name));
  ok('…the old one got no second edit', putCalls.length === 1);
  ok('…and the copy carries both emails', !!created && created[1].steps.length === 2);
  ok('no page errors', errors.length === 0, errors.join('|'));
} finally { await b.close(); server.close(); }
console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + ' passed'); process.exit(fail ? 1 : 0);
