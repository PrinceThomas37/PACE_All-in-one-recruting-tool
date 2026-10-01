// SEARCH INSIDE A JOB'S CANDIDATES (R-094, owner 2026-09-30).
// "There should be an option to search candidate when a job is opened … the user has to scroll a lot."
//   * a search box sits above the job's candidate table;
//   * every typed word must match somewhere on the row (name, title, skill, place, email…), any case;
//   * typing repaints only the table — the box keeps focus and what you typed;
//   * the count says "Showing X of N", and a miss says so with a way out;
//   * "select all" and the bulk bar only touch the people shown;
//   * clearing brings everyone back.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
const PEOPLE = [
  ['Sarah Chen','Estimator','Austin','TX','python sql'], ['Rahul Mehta','Site Engineer','Pune','MH','autocad'],
  ['Maria Gomez','Project Manager','Austin','TX','primavera'], ['John Smith','Estimator','Denver','CO','bluebeam'],
  ['Priya Nair','Planner','Kochi','KL','primavera msp'],
];
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext(); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev((people)=>{ STATE.bd=STATE.bd||{}; STATE.bd.jobOrders=[{id:'job1',job_code:'JO-1',job_title:'Estimator',client:'Acme'}]; STATE.bd.view={pipelineJoId:'job1'}; STATE.bd.plQ=''; STATE.bd.plSel={};
    STATE.bd.pipeline=people.map((p,i)=>({id:'pl'+i,job_order_id:'job1',pipeline_code:'PL-'+i,candidate:{id:'c'+i,full_name:p[0],candidate_code:'CN-'+i,current_title:p[1],city:p[2],state:p[3],skills:p[4],email:p[0].split(' ')[0].toLowerCase()+'@mail.test'}}));
    goPage('bd_pipeline'); render(); }, PEOPLE);
  const names = () => ev(()=>[...document.querySelectorAll('#pl-table tbody tr')].map(r=>(r.children[2]||{}).textContent||'').map(t=>t.trim().split(' CN-')[0]));
  step('a search box is on the job page, and everyone shows to begin with', await ev(()=>!!document.getElementById('pl-q')) && (await names()).length===5);
  const q = page.locator('#pl-q'); await q.click(); await q.type('estimator');
  step('"estimator" finds both estimators', JSON.stringify((await names()).sort())==='["John Smith","Sarah Chen"]', JSON.stringify(await names()));
  step('typing keeps focus in the box (only the table repaints)', await ev(()=>document.activeElement&&document.activeElement.id==='pl-q'));
  step('it says how many are shown', /Showing 2 of 5/.test(await ev(()=>document.getElementById('pl-qcount').textContent)));
  await q.fill(''); await q.type('AUSTIN tx');
  step('any case, and every word must match (Austin + TX → Sarah and Maria)', JSON.stringify((await names()).sort())==='["Maria Gomez","Sarah Chen"]', JSON.stringify(await names()));
  await q.fill(''); await q.type('primavera');
  step('it searches skills, not only names', JSON.stringify((await names()).sort())==='["Maria Gomez","Priya Nair"]');
  await q.fill(''); await q.type('rahul@mail');
  step('it searches email', JSON.stringify(await names())==='["Rahul Mehta"]');
  await q.fill(''); await q.type('zzzz');
  const miss = await ev(()=>document.querySelector('#pl-table').textContent);
  step('no match says so and offers to clear', /matches “zzzz”/.test(miss) && /Clear the search/.test(miss));
  await ev(()=>plSearchClear());
  step('clearing brings all five back and empties the box', (await names()).length===5 && await ev(()=>document.getElementById('pl-q').value==='' ));
  // bulk only touches what is shown
  await q.type('estimator');
  await ev(()=>plToggleSelAll());
  const picked = await ev(()=>Object.keys(STATE.bd.plSel).filter(k=>STATE.bd.plSel[k]).length);
  step('"select all" while searching ticks only the people shown', picked===2, String(picked));
  await ev(()=>plSearchClear());
  step('the tab still counts everyone on the job', /Candidates \(5\)/.test(await ev(()=>document.body.textContent)));
  step('No page errors', errs.length===0, errs.join('|'));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
