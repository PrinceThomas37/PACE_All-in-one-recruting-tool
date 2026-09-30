// A CANDIDATE'S EMAIL ADDRESS OPENS PACE, NOT THE COMPUTER'S MAIL PROGRAM (owner, 2026-09-30).
// The address on a candidate row (job Pipeline tab) and on the candidate's record was a
// mailto: link, so clicking it left PACE for whatever mail app the computer had. It now
// opens PACE's own New message window, addressed, from the person's own mailbox.
//   * no mailto: link is drawn for a candidate on either screen;
//   * clicking the address opens the New message window with that address in "To";
//   * an address with an apostrophe (o'brien@…) survives the click;
//   * with no mailbox connected it says so instead of doing nothing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`, API = 'https://fute-lms-backend.onrender.com';
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
const CAND = { id:'c1', full_name:"Pat O'Brien", email:"pat.o'brien@example.test", candidate_code:'CN-00001', current_title:'HVAC Tech' };
let accounts = [{ id:'mb1', email_address:'me@ours.com', readable:true }];
const rep=(r,b)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
let browser; const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)){ const p=new URL(u).pathname,m=r.request().method();
    if(p==='/mailbox/accounts') return rep(r,accounts); if(p==='/candidates/c1') return rep(r,CAND); if(p==='/candidates/c1/history') return rep(r,{submissions:[],pipeline:[],activity:[]});
    return rep(r,m==='GET'?[]:{}); } return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'}); await waitForLogin(page); await enterApp(page,'bd_lead');
  const ev=(f,a)=>page.evaluate(f,a);

  // Pipeline row
  await ev((c)=>{ STATE.bd=STATE.bd||{}; STATE.bd.jobOrders=[{id:'job1',job_code:'JO-1',job_title:'Estimator',client:'Acme'}]; STATE.bd.view={pipelineJoId:'job1'};
    STATE.bd.pipeline=[{id:'pl1',job_order_id:'job1',pipeline_code:'PL-1',submission_id:null,submission:null,candidate:c}]; }, CAND);
  const row = await ev(()=>renderPipelinePage());
  step('the job Pipeline tab draws no mailto: link for a candidate', !/mailto:/.test(row) && /mbComposeTo\(/.test(row));

  // Candidate record
  await ev(()=>bdOpenCandidate('c1')); await page.waitForSelector('.dwr',{timeout:6000}).catch(()=>{});
  await page.waitForTimeout(300);
  const drawer = await ev(()=>{ const d=document.querySelector('.dwr'); return d?d.innerHTML:''; });
  step('the candidate record draws no mailto: link either', !!drawer && !/mailto:/.test(drawer) && /mbComposeTo\(/.test(drawer));
  await ev(()=>{ const a=[...document.querySelectorAll('.dwr a')].find(x=>/mbComposeTo/.test(x.getAttribute('onclick')||'')); if(a) a.click(); });
  await page.waitForSelector('#mb-c-to',{timeout:5000}).catch(()=>{});
  const w = await ev(()=>({ to:(document.getElementById('mb-c-to')||{}).value, title:(document.querySelector('#layer .modal .win-t')||{}).textContent }));
  step('clicking it opens PACE\'s New message window, addressed — an apostrophe survives', w.to==="pat.o'brien@example.test" && /New message/.test(w.title||''), JSON.stringify(w));
  await ev(()=>{ Dock.discard && 0; STATE.mailbox.compose=null; closeModal(); });

  // no mailbox
  await ev(()=>{ STATE.mailbox.activeId=null; STATE.mailbox.accounts=null; STATE.toasts=[]; }); accounts=[];
  await ev(()=>mbComposeTo('x@y.test')); await page.waitForTimeout(400);
  const none = await ev(()=>({ modal:!!document.querySelector('#layer .modal'), toast:(STATE.toasts||[]).map(t=>t.msg).join('|') }));
  step('with no mailbox connected it says so, and does not pretend to open', !none.modal && /Connect a mailbox/i.test(none.toast), JSON.stringify(none));
  step('No page errors', pageErrors.length===0, pageErrors.slice(0,2).join(' | '));
}catch(e){ console.log('[FAIL] run crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\n'+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
