// SEARCH ON THE JOB PAGE'S OWN CANDIDATE LIST ("Candidates on this job (N)") — the owner, 5 Oct:
// "the candidate search bar inside job … where user can search by first name, full name, email ID or phone number.
//  I think we did have this in our list but it's not reflected."
//
// R-094 put the box on the PIPELINE page; its test only ever opened that page, so the job page's list — the one the
// owner actually works from — had none. This suite opens THAT list.
//   * a search box sits in the card, above the people, and says nothing until you type
//   * first name, full name, e-mail (also a person's EXTRA address) and phone (typed any way) each find the person
//   * typing narrows only the rows — the box keeps its cursor and what was typed; the count says "Showing X of N"
//   * a miss says so with a way out; clearing brings everybody back
//   * "All" ticks only the people shown (never somebody hidden by the search); the heading still counts everyone
//   * the phone is shown on the row, a phone does not overflow sideways
// Usage: node test/job-page-candidate-search-smoke.mjs   (CP_SHOT_DIR=… keeps screenshots)
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
// name, title, email, phone, extra emails, extra phones, stage
const PEOPLE = [
  ['Jason Palencia','Project Manager','palencia.j@gmail.test','(864) 555-0101',[],[],'Submitted to Client'],
  ['Taylor Ray','Estimator','taylorjames23@gmail.test','864-555-0102',[],[],'Interview Completed'],
  ['Kevin Back','Superintendent','kevback@mac.test','',[],[],'Screening'],
  ['Charles Hudson','Core Proficiencies','robb131@msn.test','+1 864 555 0104',['chudson.work@acme.test'],['(864) 555-0199'],'Screening'],
  ['Sean O\'Connor','Associate Engineer','seanoconnor@gmail.test','8645550105',[],[],'Screening'],
  ['Paul Horn','Lead Superintendent','phorn1967@outlook.test','864.555.0106',[],[],'Screening'],
];
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev((people)=>{
    const subs=people.slice(0,5).map((p,i)=>({id:'s'+i,job_order_id:'jo1',stage:p[6],sub_stage:null,candidate_id:'c'+i,
      candidate:{id:'c'+i,candidate_code:'CN-0'+i,full_name:p[0],current_title:p[1],email:p[2],phone:p[3]||null,extra_emails:p[4],extra_phones:p[5]}}));
    const tags=people.slice(5).map((p,i)=>({id:'t'+i,job_order_id:'jo1',candidate_id:'c5',candidate:{id:'c5',candidate_code:'CN-05',full_name:p[0],current_title:p[1],email:p[2],phone:p[3],extra_emails:p[4],extra_phones:p[5]}}));
    window.apiGet=(u)=>{ if(/\/job-orders\/jo1\/submissions$/.test(u)) return Promise.resolve(JSON.parse(JSON.stringify(subs)));
      if(/\/job-orders\/jo1\/pipeline$/.test(u)) return Promise.resolve(JSON.parse(JSON.stringify(tags))); return Promise.reject(new Error('not stubbed: '+u)); };
    STATE.bd=STATE.bd||{}; STATE.bd.jobOrders=[{id:'jo1',job_code:'JO-1',job_title:'Project Manager',client:'Acme',status:'Open'}];
    STATE.bd.view=STATE.bd.view||{}; STATE.bd.candSel={}; bdOpenJobOrder('jo1');
  }, PEOPLE);
  await page.waitForSelector('#jr-q',{timeout:6000}).catch(()=>{});
  const names=()=>ev(()=>[...document.querySelectorAll('#jr-rows > div')].map(r=>{const a=r.querySelector('span[onclick^="bdOpenCandidate"]');return a?a.textContent.trim():'';}).filter(Boolean));
  const shown=()=>ev(()=>(document.getElementById('jr-qcount')||{}).textContent||'');
  step('a search box is in the job page\'s candidate card, everyone showing to begin with', await ev(()=>!!document.getElementById('jr-q')) && (await names()).length===6, JSON.stringify(await names()));
  step('…and it says nothing until you type', (await shown())==='');
  step('the heading counts everyone', await ev(()=>/Candidates on this job \(6\)/.test(document.getElementById('content').innerText)));
  step('the phone is shown on the row', await ev(()=>/\(864\) 555-0101/.test(document.getElementById('jr-rows').innerText)));
  if(SHOTS){ await page.waitForTimeout(200); await page.screenshot({path:path.join(SHOTS,'job-roster-search-desktop.png')}); }
  const q=page.locator('#jr-q'); await q.click();
  await q.type('jason');
  step('FIRST NAME finds the person', JSON.stringify(await names())==='["Jason Palencia"]', JSON.stringify(await names()));
  step('typing keeps the cursor in the box and what was typed', await ev(()=>document.activeElement&&document.activeElement.id==='jr-q'&&document.activeElement.value==='jason'));
  step('the count says "Showing 1 of 6 on this job"', /Showing 1 of 6 on this job/.test(await shown()), await shown());
  await q.fill(''); await q.type('Taylor Ray');
  step('FULL NAME finds the person', JSON.stringify(await names())==='["Taylor Ray"]');
  await q.fill(''); await q.type('KEVBACK@MAC');
  step('EMAIL finds the person (any case, part of an address)', JSON.stringify(await names())==='["Kevin Back"]', JSON.stringify(await names()));
  await q.fill(''); await q.type('chudson.work');
  step('a person\'s EXTRA email finds them too', JSON.stringify(await names())==='["Charles Hudson"]', JSON.stringify(await names()));
  await q.fill(''); await q.type('8645550105');
  step('PHONE typed as digits finds a number stored as digits', JSON.stringify(await names())==='["Sean O\'Connor"]', JSON.stringify(await names()));
  await q.fill(''); await q.type('864 555 0106');
  step('…a number typed with spaces finds one stored with dots', JSON.stringify(await names())==='["Paul Horn"]', JSON.stringify(await names()));
  await q.fill(''); await q.type('8645550106');
  step('…plain digits find a number STORED with dots (864.555.0106) — the punctuation is ignored', JSON.stringify(await names())==='["Paul Horn"]', JSON.stringify(await names()));
  await q.fill(''); await q.type('8645550104');
  step('…and one stored as "+1 864 555 0104"', JSON.stringify(await names())==='["Charles Hudson"]', JSON.stringify(await names()));
  await q.fill(''); await q.type('(864) 555-0199');
  step('…and a person\'s EXTRA number finds them', JSON.stringify(await names())==='["Charles Hudson"]', JSON.stringify(await names()));
  await q.fill(''); await q.type('555-0102');
  step('…a part of a number, with the dash typed, finds a number stored the same way', JSON.stringify(await names())==='["Taylor Ray"]', JSON.stringify(await names()));
  await q.fill(''); await q.type('screening');
  step('the stage is searchable too (3 on Screening)', (await names()).length===3, JSON.stringify(await names()));
  await q.fill(''); await q.type('zzzz');
  const miss=await ev(()=>document.getElementById('jr-rows').textContent);
  step('no match says so and offers a way out', /matches “zzzz”/.test(miss) && /Clear the search/.test(miss), miss.slice(0,120));
  step('…and the heading and the empty-list wording are not confused (the job still has 6)', !/No candidates on this job yet/.test(miss));
  await ev(()=>bdRosterSearchClear());
  step('clearing brings all six back and empties the box', (await names()).length===6 && await ev(()=>document.getElementById('jr-q').value===''));
  // "All" only touches what is shown
  await q.type('screening');
  await ev(()=>bdToggleCandSelAll('jo1')); await page.waitForTimeout(150);
  const picked=await ev(()=>Object.keys(STATE.bd.candSel).filter(k=>STATE.bd.candSel[k]).sort());
  step('"All" while searching ticks only the people shown (not Jason or Taylor)', JSON.stringify(picked)==='["c2","c3","c4"]', JSON.stringify(picked));
  step('the heading still counts EVERYONE on the job while a search is active (6, not the 3 shown)', await ev(()=>/Candidates on this job \(6\)/.test(document.getElementById('content').innerText)));
  step('the search survives the repaint a tick causes (box and rows agree)', await ev(()=>document.getElementById('jr-q').value==='screening') && (await names()).length===3);
  if(SHOTS){ await page.screenshot({path:path.join(SHOTS,'job-roster-search-filtered.png')}); }
  await ev(()=>bdRosterSearchClear());
  // opening another job starts with a clean box
  await ev(()=>{ STATE.bd.rosterQ='xyz'; STATE.bd.view.joId='jo1'; });
  // phone layout
  await page.setViewportSize({width:390,height:780}); await page.waitForTimeout(500);
  const ph=await ev(()=>{ const rows=document.getElementById('jr-rows'), card=rows.parentElement; const i=document.getElementById('jr-q').getBoundingClientRect(); const wide=[...card.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).length; return {cardOver:card.scrollWidth-card.clientWidth,wide:wide,inputRight:Math.round(i.right),vw:innerWidth,inputH:Math.round(i.height)}; });
  step('phone: this list and its box fit the screen (nothing in the card pokes out sideways)', ph.cardOver<=1 && ph.wide===0 && ph.inputRight<=ph.vw, JSON.stringify(ph));
  if(SHOTS){ await ev(()=>{ STATE.bd.rosterQ=''; render(); }); await page.waitForTimeout(300); await page.screenshot({path:path.join(SHOTS,'job-roster-search-phone.png')}); }
  step('No page errors', errs.length===0, errs.join('|').slice(0,300));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
