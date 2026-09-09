// THE PREVIEW SHOWED ONE PERSON'S EMAIL AND THE QUEUE SHOWED NONE.
//
// Two faults the owner hit on the candidate side of Compose:
//   1. The preview was hardcoded to the FIRST candidate picked. Queue thirty
//      people and you could read one of the thirty emails; the rest went out
//      unseen. `previewIdx` + the ‹ › stepper walk the picked list.
//   2. `candidate_outreach.body` — the exact text each person got — has always
//      been stored and was never returned by the queue endpoint, so "what did
//      we actually send them?" meant opening the mailbox's Sent folder.
//
// This drives the real page with three picked candidates and a stubbed backend.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const exe = process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,'chromium') : 'chromium';
const b = await chromium.launch({ executablePath: exe, headless: true, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport:{width:1280,height:1000} });
await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(BASE+'/',{waitUntil:'domcontentloaded'}); await waitForLogin(page); await enterApp(page,'recruiter');

// Drive the page with three picked candidates and a fake preview/queue, so the
// stepper and the sent-email panel can be exercised without a backend.
const out = await page.evaluate(async () => {
  window.STATE.page = 'email';
  window.STATE.emailTab = 'compose';
  window.STATE.composeSide = 'candidates';
  const s = window.candOutreachState();
  s.step = 3;
  s.job = { id:'j1', job_title:'Site Superintendent', client:'Berks' };
  s.picked = { c1:true, c2:true, c3:true };
  s.sender = { mailbox:{ email_address:'p@x.com' } };
  const mk = (n) => ({ candidate:{name:n}, variants:[{id:'direct',label:'Direct',blurb:'b',words:70,
      subject:'Role for '+n, email:'Hi '+n+', we have a role.', preview_subject:'Role for '+n, preview_email:'Hi '+n+', we have a role.'}] });
  const NAMES = { c1:'Alice', c2:'Bob', c3:'Carla' };
  // stub the network the page uses
  const realPost = window.apiPost;
  window.apiPost = (url, body) => url === '/candidate-outreach/preview'
    ? Promise.resolve(mk(NAMES[body.candidate_id])) : realPost(url, body);
  window.apiGet = (url) => url.startsWith('/candidate-outreach/queue')
    ? Promise.resolve([{ id:'q1', name:'Alice', to_email:'a@x.com', subject:'Role for Alice',
        body:'Hi Alice,\n\nThis is the exact text she received.', status:'sent',
        sent_at:new Date().toISOString(), angle:'direct', engine:'groq' }])
    : Promise.resolve({});
  window.render();
  window.candOutreachPreview();
  await new Promise(r => setTimeout(r, 150));
  const first = document.body.innerText;
  window.candOutreachPreviewStep(1);
  await new Promise(r => setTimeout(r, 120));
  const second = document.body.innerText;
  window.candOutreachPreviewStep(-1);
  await new Promise(r => setTimeout(r, 120));
  const back = document.body.innerText;
  // open a sent email
  window.candOutreachLoadQueue(true);
  await new Promise(r => setTimeout(r, 120));
  const closed = document.body.innerText;
  window.candOutreachToggleQueue('q1');
  await new Promise(r => setTimeout(r, 80));
  const opened = document.body.innerText;
  return {
    firstShowsAlice: /1 of 3/.test(first) && /Alice/.test(first),
    secondShowsBob: /2 of 3/.test(second) && /Bob/.test(second),
    wrapsBack: /1 of 3/.test(back) && /Alice/.test(back),
    bodyHiddenWhenClosed: !/exact text she received/.test(closed),
    bodyShownWhenOpen: /exact text she received/.test(opened),
  };
});
const results = [];
const step = (name, ok, detail = '') => {
  results.push(ok);
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
};

step('the preview opens on the first picked candidate, labelled 1 of 3', out.firstShowsAlice);
step('the next arrow moves to the second candidate\'s own email', out.secondShowsBob);
step('the previous arrow comes back to the first', out.wrapsBack);
step('a sent email is collapsed until you open it', out.bodyHiddenWhenClosed);
step('opening one shows the exact text that person received', out.bodyShownWhenOpen);
step('no page errors', errs.length === 0, errs.join(' | '));

const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${passed}/${results.length} passed`);
console.log('RESULT: ' + (passed === results.length ? 'PASS' : 'FAIL'));
await b.close(); server.close();
process.exit(passed === results.length ? 0 : 1);
