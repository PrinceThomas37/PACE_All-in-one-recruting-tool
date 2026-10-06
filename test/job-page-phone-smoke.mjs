// THE JOB PAGE ON A PHONE (R-120, found 5 Oct): the header's Candidates / Board / Edit job buttons were one
// unbreakable row — on a phone "Edit job" was cut off and could not be reached. They now wrap under the title.
//   * at phone width every header button is fully on screen and big enough to hit
//   * the page does not scroll sideways, and the facts grid is two across (not three squeezed)
//   * on a desktop the buttons still sit on the right of the title (one row), nothing moved
//   * the Applicants table keeps its own scroll box (it may be wide, the PAGE may not be)
// Usage: node test/job-page-phone-smoke.mjs   (CP_SHOT_DIR=… keeps screenshots)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`; const SHOTS=process.env.CP_SHOT_DIR||'';
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:390,height:800}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{
    window.apiGet=(u)=>Promise.resolve(/submissions$|pipeline$/.test(u)?[]:[]);
    STATE.bd=STATE.bd||{}; STATE.bd.jobOrders=[{id:'jo1',job_code:'JO-1',job_title:'Senior Project Manager — Commercial Construction',client:'Acme Building Group',city:'Greenville',state:'SC',status:'Open',pay_rate:'$90/hr',job_type:'Contract',work_auth:'US Citizen',primary_skills:'Procore, Bluebeam, scheduling, estimating, subcontractor management'}];
    STATE.bd.view=STATE.bd.view||{}; bdOpenJobOrder('jo1');
  });
  await page.waitForSelector('.jo-head',{timeout:6000});
  await page.waitForTimeout(500);
  const m=()=>ev(()=>{ const vw=innerWidth; const btns=[...document.querySelectorAll('.jo-head-actions .btn')].map(b=>{const r=b.getBoundingClientRect();return {t:b.textContent.trim(),left:Math.round(r.left),right:Math.round(r.right),h:Math.round(r.height),top:Math.round(r.top)};});
    const c=document.getElementById('content'); const facts=document.querySelector('.jo-facts'); const cols=facts?getComputedStyle(facts).gridTemplateColumns.split(' ').length:0;
    const head=document.querySelector('.jo-head').getBoundingClientRect(); const main=document.querySelector('.jo-head-main').getBoundingClientRect();
    return {vw,btns,over:c.scrollWidth-c.clientWidth,cols,headRight:Math.round(head.right),mainRight:Math.round(main.right),mainTop:Math.round(main.top)}; });
  let r=await m();
  step('the three header buttons are all there (Candidates, Board, Edit job)', r.btns.length>=3 && ['Candidates','Board','Edit job'].every(t=>r.btns.some(b=>b.t===t)), JSON.stringify(r.btns.map(b=>b.t)));
  step('phone: every header button is fully on screen (none cut off)', r.btns.every(b=>b.left>=0&&b.right<=r.vw), JSON.stringify(r.btns));
  step('phone: they are big enough to hit (>= 28px high)', r.btns.every(b=>b.h>=28), JSON.stringify(r.btns.map(b=>b.h)));
  step('phone: the page does not scroll sideways', r.over<=1, 'over='+r.over);
  step('phone: the facts grid is two across', r.cols===2, 'cols='+r.cols);
  step('phone: the header stays inside the card (nothing past the screen edge)', r.headRight<=r.vw && r.mainRight<=r.vw, JSON.stringify({h:r.headRight,m:r.mainRight}));
  if(SHOTS) await page.screenshot({path:path.join(SHOTS,'job-page-phone.png')});
  // the Applicants table may be wide — but inside its own scroll box
  const tbl=await ev(()=>{ const t=document.querySelector('.card table'); if(!t) return null; let w=t.parentElement; while(w && !/auto|scroll/.test(getComputedStyle(w).overflowX)) w=w.parentElement; return {scrolls:!!w&&w.id!=='content'&&w.tagName!=='BODY', wrap:w?w.className:''}; });
  step('the Applicants table (if drawn) scrolls inside its own box, not the page', tbl===null || tbl.scrolls, JSON.stringify(tbl));
  // desktop: unchanged — one row, buttons on the right
  await page.setViewportSize({width:1280,height:860}); await page.waitForTimeout(400);
  r=await m();
  step('desktop: the buttons still sit on the right of the title, on the same row', r.btns.every(b=>Math.abs(b.top-r.btns[0].top)<4) && r.btns[0].left>r.mainRight-40 && r.btns.every(b=>b.top<r.mainTop+60), JSON.stringify({btns:r.btns,mainRight:r.mainRight,mainTop:r.mainTop}));
  step('desktop: the facts grid is three across', r.cols===3, 'cols='+r.cols);
  step('No page errors', errs.length===0, errs.join('|').slice(0,300));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
