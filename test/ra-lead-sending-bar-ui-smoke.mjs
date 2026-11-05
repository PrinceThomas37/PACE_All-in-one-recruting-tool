// The RA lead's drill-down into one BD manager's Pending window shows a PROGRESS BAR while that manager's send is running
// (owner, 5 Nov 2026: "there is no progress bar for sending in RA lead, pending email window for manager. i need a progress bar").
// Real browser, real public/ files, a mocked API. Proves: the bar appears while active with the right width (sent+failed of total, the
// same number the person's own window shows); a stalled run turns it amber; no bar when nothing is running; the text line is still there.
// Usage: node test/ra-lead-sending-bar-ui-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin, TEST_USERS } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end();} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`, API='https://fute-lms-backend.onrender.com';
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return undefined; }
const BD='u-martin';
let progress={ active:true, sent:1, total:39, failed:0, current:'cjohnson@kaneinnovations.com' };
const rep=(r,b)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1300,height:700},deviceScaleFactor:process.env.SHOT?2:1});
  await ctx.route('**',r=>{ const u=new URL(r.request().url()); if(r.request().url().startsWith(BASE)) return r.continue(); if(r.request().url().startsWith(API)){ const p=u.pathname;
    if(p==='/emails/send-progress') return rep(r,progress);
    if(p==='/emails/sender-summary') return rep(r,{ senders:[{ id:BD, name:'Martin Smith', pending:38, sent:60, failed:0 }] });
    if(p==='/emails/pending-summary') return rep(r,{ total:38, mailboxes:[], by_mailbox:[], rows:[] });
    return rep(r,r.request().method()==='GET'?[]:{}); } return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,TEST_USERS.ra_lead);
  const ev=(f,a)=>page.evaluate(f,a);
  const open=async()=>{ await ev((id)=>{ STATE.users=(STATE.users||[]).filter(u=>u.id!==id).concat([{id:id,name:'Martin Smith',role:'bd',roles:['bd']}]); STATE.emailTab='pending'; STATE.raLeadSelectedBD=id; STATE.watchedProgressFor=null; STATE.watchedProgress=null; goPage('email'); },BD); await page.waitForFunction(()=>/Sending now|Not sending|Sending has stalled|Last run/.test(document.body.innerText),null,{timeout:10000}); };
  await open();
  step('the screen is the manager drill-down (Martin Smith)', await ev(()=>/Back to all BD Managers/.test(document.body.innerText)));
  step('while sending, the text line is still there', await ev(()=>/Sending now\s*—\s*1 sent of 39/.test(document.body.innerText)));
  step('…and there is a progress bar', await ev(()=>!!document.querySelector('.sp-live-bar[role="progressbar"]')));
  step('…its width is sent+failed of total (1 of 39 = 3%)', await ev(()=>{ const b=document.querySelector('.sp-live-bar'); return !!b && b.getAttribute('aria-valuenow')==='3' && b.querySelector('.imp-fill').style.width==='3%'; }));
  step('…and it says the percentage in words', await ev(()=>/3% of this run done/.test(document.body.innerText)));
  step('…the bar is actually visible (has width and height on screen)', await ev(()=>{ const b=document.querySelector('.sp-live-bar'); const r=b&&b.getBoundingClientRect(); return !!r && r.width>50 && r.height>=4; }));
  if(process.env.SHOT) await page.screenshot({path:process.env.SHOT});   // for a human to look at; not part of the pass/fail
  progress={ active:true, sent:30, total:40, failed:2, current:'x@y.test' };
  await ev(()=>{ STATE.watchedProgressFor=null; STATE.watchedProgress=null; render(); });
  await page.waitForFunction(()=>{ const b=document.querySelector('.sp-live-bar'); return b && b.getAttribute('aria-valuenow')==='80'; },null,{timeout:10000});
  step('when it moves on (30 sent + 2 failed of 40) the bar reads 80%', await ev(()=>document.querySelector('.sp-live-bar .imp-fill').style.width==='80%'));
  progress={ active:true, stalled:true, sent:5, total:40, failed:0 };
  await ev(()=>{ STATE.watchedProgressFor=null; STATE.watchedProgress=null; render(); });
  await page.waitForFunction(()=>/Sending has stalled/.test(document.body.innerText)&&document.querySelector('.sp-live-bar'),null,{timeout:10000});
  step('a stalled run keeps the bar, in amber', await ev(()=>{ const f=document.querySelector('.sp-live-stalled .imp-fill'); if(!f) return false; const c=getComputedStyle(f).backgroundColor; const amber=getComputedStyle(document.documentElement).getPropertyValue('--amber').trim(); const probe=document.createElement('i'); probe.style.color=amber; document.body.appendChild(probe); const want=getComputedStyle(probe).color; probe.remove(); return c===want; }));
  progress={ active:false, done:true, sent:39, total:39, failed:0 };
  await ev(()=>{ STATE.watchedProgressFor=null; STATE.watchedProgress=null; render(); });
  await page.waitForFunction(()=>/Last run finished/.test(document.body.innerText),null,{timeout:10000});
  step('a finished run shows no bar (nothing is running)', await ev(()=>!document.querySelector('.sp-live-bar')));
  progress={ active:false };
  await ev(()=>{ STATE.watchedProgressFor=null; STATE.watchedProgress=null; render(); });
  await page.waitForFunction(()=>/Not sending right now/.test(document.body.innerText),null,{timeout:10000});
  step('not sending → no bar either', await ev(()=>!document.querySelector('.sp-live-bar')));
  step('No page errors', errs.length===0, errs.join('|'));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\n'+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
