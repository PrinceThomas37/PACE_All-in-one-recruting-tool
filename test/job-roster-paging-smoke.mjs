// THE JOB PAGE'S CANDIDATE LIST SHOWS TEN PEOPLE AT A TIME (owner, 6 Oct):
// "the candidate list inside a job keeps on scrolling down, I only need 10 candidates at once and then next page".
//   * 27 people on a job → ten rows, "Page 1 of 3", Next/Prev work, the last page has seven
//   * the heading still counts everyone (27), the pager is a real button not a dead one
//   * a search starts again at page 1 and pages its own matches; clearing it brings the pages back
//   * "This page" ticks only the ten shown; a tick on page 1 survives a visit to page 2
//   * a job with 10 or fewer people has no pager (a control that cannot do anything is noise)
//   * the other job-page suites (search, updates, phone) keep passing — paging must not change their rows
// Usage: node test/job-roster-paging-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':(MIME[path.extname(p)]||'application/octet-stream')+'; charset=utf-8'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
const N=27;
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  const open=(n)=>ev((n)=>{
    const pad=(i)=>String(i).padStart(2,'0');
    const subs=Array.from({length:n},(_,i)=>({id:'s'+i,job_order_id:'jo1',stage:'Screening',sub_stage:null,candidate_id:'c'+i,
      candidate:{id:'c'+i,candidate_code:'CN-'+pad(i),full_name:'Person '+pad(i+1)+(i%9===0?' Zed':''),current_title:'Estimator',email:'p'+i+'@x.test',phone:null,extra_emails:[],extra_phones:[]}}));
    window.apiGet=(u)=>{ if(/\/job-orders\/jo1\/submissions$/.test(u)) return Promise.resolve(JSON.parse(JSON.stringify(subs)));
      if(/\/job-orders\/jo1\/pipeline$/.test(u)) return Promise.resolve([]); return Promise.reject(new Error('not stubbed: '+u)); };
    STATE.bd=STATE.bd||{}; STATE.bd.jobOrders=[{id:'jo1',job_code:'JO-1',job_title:'Project Manager',client:'Acme',status:'Open'}];
    STATE.bd.view=STATE.bd.view||{}; STATE.bd.candSel={}; STATE.bd.rosterQ=''; STATE.bd.rosterPage=0; bdOpenJobOrder('jo1');
  }, n);
  const names=()=>ev(()=>[...document.querySelectorAll('#jr-rows span[onclick^="bdOpenCandidate"]')].map(a=>a.textContent.trim()));
  const pager=()=>ev(()=>{ const p=document.querySelector('#jr-pager .hz-pager'); return p?p.innerText.replace(/\s+/g,' ').trim():''; });
  await open(N); await page.waitForSelector('#jr-q',{timeout:6000});

  let n=await names();
  step('27 people → only TEN rows are on the page', n.length===10 && n[0]==='Person 01 Zed' && n[9]==='Person 10 Zed', JSON.stringify(n.slice(0,2))+' … '+n.length);
  step('the pager says "Page 1 of 3"', /Page 1 of 3/.test(await pager()), await pager());
  step('Prev is off on the first page', await ev(()=>{ const b=[...document.querySelectorAll('#jr-pager .hz-pg')]; return b[0].disabled&&!b[1].disabled; }));
  step('the heading still counts everyone (27)', await ev(()=>/Candidates on this job \(27\)/.test(document.getElementById('content').innerText)));

  await ev(()=>[...document.querySelectorAll('#jr-pager .hz-pg')].find(b=>/Next/.test(b.textContent)).click());
  await page.waitForTimeout(150); n=await names();
  step('Next shows people 11–20', n.length===10 && n[0]==='Person 11' && n[9]==='Person 20', JSON.stringify([n[0],n[n.length-1]]));
  step('…and the pager says "Page 2 of 3"', /Page 2 of 3/.test(await pager()));
  await ev(()=>[...document.querySelectorAll('#jr-pager .hz-pg')].find(b=>/Next/.test(b.textContent)).click());
  await page.waitForTimeout(150); n=await names();
  step('the last page has the remaining seven and Next is off', n.length===7 && n[6]==='Person 27' && await ev(()=>[...document.querySelectorAll('#jr-pager .hz-pg')].find(b=>/Next/.test(b.textContent)).disabled), JSON.stringify([n.length,n[n.length-1]]));

  // selection survives paging; "This page" ticks only what is shown
  await ev(()=>bdRosterGoPage(0)); await page.waitForTimeout(150);
  step('the tick-all box says "This page" when there is more than one page', await ev(()=>/This page/.test(document.querySelector('#content').innerText)));
  await ev(()=>bdToggleCandSelAll('jo1')); await page.waitForTimeout(150);
  let picked=await ev(()=>Object.keys(STATE.bd.candSel).filter(k=>STATE.bd.candSel[k]));
  step('"This page" ticks the ten shown — not all 27', picked.length===10, String(picked.length));
  await ev(()=>bdRosterGoPage(1)); await page.waitForTimeout(150);
  picked=await ev(()=>Object.keys(STATE.bd.candSel).filter(k=>STATE.bd.candSel[k]));
  step('going to page 2 keeps the ten ticks (and the email button counts them)', picked.length===10 && await ev(()=>/Email about this job \(10\)/.test(document.getElementById('content').innerText)));

  // search starts at page 1, pages its own matches
  const q=page.locator('#jr-q'); await q.click(); await q.type('zed');
  n=await names();
  step('a search starts again at page 1 (3 "Zed" people: 01, 10, 19)', n.length===3 && /Page/.test(await pager())===false, JSON.stringify(n));
  step('…its count says "Showing 3 of 27", and a search with ≤10 matches has no pager', /Showing 3 of 27/.test(await ev(()=>document.getElementById('jr-qcount').textContent)));
  await q.fill(''); await q.type('person');
  step('a search matching everyone is paged again (10 shown, 3 pages)', (await names()).length===10 && /Page 1 of 3/.test(await pager()));
  await ev(()=>bdRosterSearchClear()); await page.waitForTimeout(100);
  step('clearing the search brings the pages back at page 1', (await names())[0]==='Person 01 Zed' && /Page 1 of 3/.test(await pager()));

  // a small job has no pager
  await open(8); await page.waitForSelector('#jr-q',{timeout:6000}).catch(()=>{});
  step('a job with 8 people shows all 8 and NO pager', (await names()).length===8 && (await pager())==='');
  await open(10); await page.waitForTimeout(200);
  step('exactly 10 people: all shown, no pager', (await names()).length===10 && (await pager())==='');
  await open(11); await page.waitForTimeout(200);
  step('11 people: ten + a pager with two pages', (await names()).length===10 && /Page 1 of 2/.test(await pager()));
  step('No page errors', errs.length===0, errs.join('|').slice(0,300));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
