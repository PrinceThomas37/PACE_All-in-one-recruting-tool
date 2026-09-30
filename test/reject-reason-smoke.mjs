// REJECT A CANDIDATE ON A JOB, WITH A REASON — NOT "REMOVE" (R-082, owner 2026-09-30).
// "Give an option to reject the candidate to a user in a job, not remove them. Sub options like
// out of budget, travel issue, did not like the company, skills do not match, over qualified,
// not interested, other with type column."
//   * the Pipeline tab's ✕ (which half-removed people) is gone; BD gets "Reject";
//   * Reject opens the stage window on Not Accepted with a fixed list of seven reasons;
//   * a reason must be picked; "Other" must be typed;
//   * the reason travels at the front of rejection_reason (so it can be counted); a recruiter is not offered it.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin, switchRole } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext(); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{ STATE.bd=STATE.bd||{}; STATE.bd.jobOrders=[{id:'job1',job_code:'JO-1',job_title:'Estimator',client:'Acme'}]; STATE.bd.view={pipelineJoId:'job1'};
    STATE.bd.submissions=[{id:'s1',job_order_id:'job1',stage:'Screening',candidate:{id:'c1',full_name:'Sarah Chen'}}];
    STATE.bd.pipeline=[{id:'pl1',job_order_id:'job1',pipeline_code:'PL-1',submission_id:'s1',submission:{id:'s1',stage:'Screening'},candidate:{id:'c1',full_name:'Sarah Chen',candidate_code:'CN-1'}}]; });
  const html = await ev(()=>renderPipelinePage());
  step('the ✕ that half-removed people is gone', !/>✕</.test(html) && !/plRemove/.test(html));
  step('BD is offered "Reject" on the row', />Reject</.test(html) && /Not Accepted/.test(html));
  await ev(()=>plMove('pl1','s1','Not Accepted'));
  const win = await ev(()=>({ opts:[...document.querySelectorAll('#stg-reject-type option')].map(o=>o.value) }));
  step('Reject opens the stage window with exactly the seven reasons', JSON.stringify(win.opts)==='["","Out of budget","Travel issue","Did not like the company","Skills do not match","Over qualified","Not interested","Other"]', JSON.stringify(win.opts));
  const tries = await ev(async()=>{ const msgs=[]; const o=window.showToast; window.showToast=(m)=>msgs.push(m);
    let patch=null; window.apiPatch=(u,b)=>{patch={u,b}; return Promise.resolve({id:'s1',stage:'Not Accepted'});};
    document.getElementById('stg-note').value='Call summary';
    stgApply(); const none=msgs.slice();
    document.getElementById('stg-reject-type').value='Other'; stgApply(); const other=msgs.slice(none.length);
    document.getElementById('stg-reject').value='Wants to relocate'; stgApply(); await new Promise(r=>setTimeout(r,150));
    window.showToast=o; return { none, other, patch }; });
  step('no reason picked: refused, and says to pick one', tries.none.some(m=>/pick why/i.test(m)));
  step('"Other" with nothing typed: refused', tries.other.some(m=>/type the reason/i.test(m)));
  step('"Other" with words: saved as "Other: …" on the Not Accepted move', !!tries.patch && tries.patch.b.stage==='Not Accepted' && tries.patch.b.rejection_reason==='Other: Wants to relocate', JSON.stringify(tries.patch&&tries.patch.b));
  await ev(()=>closeModal());
  await ev(()=>openStageModal('s1','Not Accepted',null));
  const one = await ev(async()=>{ let patch=null; window.apiPatch=(u,b)=>{patch=b; return Promise.resolve({id:'s1'});};
    document.getElementById('stg-note').value='n'; document.getElementById('stg-reject-type').value='Over qualified'; stgApply(); await new Promise(r=>setTimeout(r,150)); return patch; });
  step('a listed reason is stored as it is, so it can be counted', !!one && one.rejection_reason==='Over qualified', JSON.stringify(one));
  await switchRole(page,'recruiter');
  const rec = await ev(()=>renderPipelinePage());
  step('a recruiter is not offered Reject (BD owns that stage)', !/>Reject</.test(rec));
  step('No page errors', errs.length===0, errs.join('|'));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\n'+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
