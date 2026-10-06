// WHAT FILLS AN OPENED JOB ROW (R-134, owner 6 Oct: "interviews this week, quick actions, best-matching candidates").
// The opened row on the Jobs list had a lot of blank space. It now shows, from what the server already knows:
//   * Interviews this week — people on THIS job at "Interview Scheduled" whose time falls today..+6 days (never a
//     past or far-off one, never someone at another stage)
//   * Best matches not on this job yet — the server's own ranking of the pool (the same scorer as the grid), minus
//     everyone already on the job, top three, each with an Add button that adds them and refreshes the row
//   * Quick actions — Add a candidate, Pipeline board, "Review N waiting" — a person who may not add is shown the
//     button GREYED, not removed
// Usage: node test/job-row-panel-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`, API='https://fute-lms-backend.onrender.com';
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
const inDays=(n,h=14)=>{ const d=new Date(); d.setDate(d.getDate()+n); d.setHours(h,0,0,0); return d.toISOString(); };
const cand=(id,name,title)=>({ id, full_name:name, current_title:title, city:'Austin', state:'TX' });
const SUBS=[
  { id:'s1', candidate_id:'c1', stage:'Interview Scheduled', interview_at:inDays(2), interview_location:'Zoom', candidate:cand('c1','Jason Palencia','Project Manager') },
  { id:'s2', candidate_id:'c2', stage:'Interview Scheduled', interview_at:inDays(20), candidate:cand('c2','Far Off','Estimator') },       // beyond the week
  { id:'s3', candidate_id:'c3', stage:'Interview Scheduled', interview_at:inDays(-3), candidate:cand('c3','Long Gone','Estimator') },   // already past
  { id:'s4', candidate_id:'c4', stage:'Screening', interview_at:inDays(1), candidate:cand('c4','Wrong Stage','Estimator') },           // not at the interview stage
  { id:'s5', candidate_id:'c5', stage:'Submitted to BDM', candidate:cand('c5','Waiting One','Estimator') },
];
let matchesFor = { scoreable:true, results:[
  { candidate_id:'c1', score:95, candidate:cand('c1','Jason Palencia','Project Manager') },   // already on the job → must not be offered
  { candidate_id:'m1', score:88, candidate:cand('m1','Taylor Ray','Senior Estimator') },
  { candidate_id:'m2', score:74, candidate:cand('m2','Kevin Back','Superintendent') },
  { candidate_id:'m3', score:61, candidate:cand('m3','Nina Cho','Estimator') },
  { candidate_id:'m4', score:50, candidate:cand('m4','Fourth Place','Estimator') },
  { candidate_id:'m5', score:null, candidate:cand('m5','Unscored','—') } ] };
const calls=[]; const rep=(r,b,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(b)});
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1200}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)){ const p=new URL(u).pathname, m=r.request().method(); calls.push(m+' '+p);
      if(m==='GET'&&p==='/job-orders/jo-1/submissions') return rep(r,SUBS);
      if(m==='GET'&&p==='/job-orders/jo-1/matches') return rep(r,matchesFor);
      // jo-2: a job with no skills listed, so nobody can be ranked
      if(m==='GET'&&p==='/job-orders/jo-2/submissions') return rep(r,[]);
      if(m==='GET'&&p==='/job-orders/jo-2/matches') return rep(r,{scoreable:false,results:[]});
      // jo-3: an unassigned recruiter is answered with the MASKED shape (no interview times)
      if(m==='GET'&&p==='/job-orders/jo-3/submissions') return rep(r,{masked:true,submissions:SUBS.map(({interview_at,...x})=>x)});
      if(m==='GET'&&p==='/job-orders/jo-3/matches') return rep(r,{scoreable:true,results:[]});
      if(m==='POST'&&p==='/pipeline'){ const b=JSON.parse(r.request().postData()||'{}'); SUBS.push({id:'sx'+SUBS.length,candidate_id:b.candidate_id,stage:'Sourced',candidate:cand(b.candidate_id,'Added','—')}); return rep(r,{id:'p9'},201); }
      return rep(r,m==='GET'?[]:{}); }
    return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{ STATE.bd=STATE.bd||{}; STATE.bd.loading=false; STATE.bd.jobOrders=['jo-1','jo-2','jo-3'].map((id,i)=>({id,job_code:'JO-'+(i+1),job_title:['Estimator','Safety Manager','Foreman'][i],client:'Northwind',status:'Active',city:'Hartford',state:'CT',job_type:'Full-time',positions:2,created_at:new Date().toISOString(),poc_visible:true,recruiters:[],apply_count:0})); STATE.page='bd_joborders'; render(); });
  await page.waitForSelector('tr[data-row-id="jo-1"]',{timeout:8000});
  await page.click('tr[data-row-id="jo-1"]');
  await page.waitForFunction(()=>/Taylor Ray/.test((document.querySelector('.lx-job')||{}).innerText||''),null,{timeout:8000});
  const panel=()=>ev(()=>document.querySelector('.lx-job').innerText.replace(/\s+/g,' '));
  const sec=(t,a,b)=>{ const l=t.toLowerCase(), i=l.indexOf(a); if(i<0) return ''; const j=b?l.indexOf(b,i+a.length):-1; return t.slice(i,j<0?undefined:j); };
  let t=await panel();

  step('the opened row has the three new blocks: interviews, best matches, quick actions', /Interviews this week/i.test(t) && /Best matches not on this job yet/i.test(t) && /Quick actions/i.test(t), t.slice(0,160));
  step('Interviews: only the one inside the week, with its time and place (not the far-off, the past, or the wrong stage)', /Jason Palencia · Zoom/.test(t) && !/Far Off/.test(t) && !/Long Gone/.test(t) && !/Wrong Stage/.test(t), t.match(/Interviews this week.{0,140}/i)[0]);
  step('Best matches: the top three of the pool, best first, with their scores', /Taylor Ray.{0,60}88.{0,200}Kevin Back.{0,60}74.{0,200}Nina Cho.{0,60}61/.test(t), t.match(/Best matches.{0,260}/i)[0]);
  const bm=sec(t,'best matches not on this job yet','recruiters');
  step('…never someone already on the job (Jason, score 95), never a fourth, never an unscored one', bm.length>30 && !/Fourth Place/.test(bm) && !/Unscored/.test(bm) && !/Jason/.test(bm) && !/95/.test(bm), bm.slice(0,120));
  step('Quick actions: Add a candidate, Pipeline board and "Review 1 waiting" (one is waiting for approval)', /Add a candidate/.test(t) && /Pipeline board/.test(t) && /Review 1 waiting/.test(t));

  // Add from the list: one POST, the person leaves the suggestions, the row refreshes
  await ev(()=>{ [...document.querySelectorAll('.lx-match .lx-link')][0].click(); });
  await page.waitForTimeout(700);
  t=await panel();
  step('"Add" on Taylor Ray adds them to the job with ONE request (candidate + job)', calls.filter(c=>c==='POST /pipeline').length===1);
  const bm2=sec(t,'best matches not on this job yet','recruiters');
  step('…and they are no longer suggested (the row re-read who is on the job); the next best moves up', !/Taylor Ray/.test(bm2) && /Kevin Back/.test(bm2) && /Fourth Place/.test(bm2), bm2.slice(0,160));
  step('the pool was ranked once per refresh, not once per keystroke or repaint', calls.filter(c=>c==='GET /job-orders/jo-1/matches').length<=2, String(calls.filter(c=>c==='GET /job-orders/jo-1/matches').length));

  // A recruiter who may not add: the button is there, greyed, with the reason
  await ev(()=>{ STATE.user=Object.assign({},STATE.user,{role:'ra',roles:['ra']}); delete window.__x; });
  await ev(()=>{ document.querySelector('tr[data-row-id="jo-1"]').click(); });   // close
  await page.waitForTimeout(200);
  await ev(()=>{ document.querySelector('tr[data-row-id="jo-1"]').click(); });   // open again, as an analyst
  await page.waitForFunction(()=>!!document.querySelector('.lx-job'),null,{timeout:5000});
  await page.waitForTimeout(700);
  const grey=await ev(()=>{ const a=[...document.querySelectorAll('.lx-acts .btn')].find(b=>/Add a candidate/.test(b.textContent)); const m=document.querySelector('.lx-match .lx-link'); return { act:!!a&&a.disabled&&/BD managers/.test(a.title), add:!m||m.disabled }; });
  step('someone who may not add people sees "Add a candidate" and the Add buttons GREYED with the reason — not removed', grey.act && grey.add, JSON.stringify(grey));

  // A job with no skills: say so, do not list nobody
  await ev(()=>{ STATE.user=Object.assign({},STATE.user,{role:'bd',roles:['bd']}); render(); });
  await page.click('tr[data-row-id="jo-2"]');
  await page.waitForFunction(()=>/Add skills to this job/.test(document.body.innerText),null,{timeout:6000}).catch(()=>{});
  step('a job with no skills listed says "Add skills to this job…" instead of an empty list', await ev(()=>/Add skills to this job and the best-fitting people will be listed here/.test(document.body.innerText)));
  // Masked answer (an unassigned recruiter): no crash, no invented "no interviews"
  await page.click('tr[data-row-id="jo-3"]');
  await page.waitForFunction(()=>/Interview times are shown to the people assigned/.test(document.body.innerText),null,{timeout:6000}).catch(()=>{});
  step('a masked answer says interview times belong to the people assigned — it does not claim there are none', await ev(()=>/Interview times are shown to the people assigned to this job/.test(document.body.innerText) && !/No interviews in the next 7 days/.test(document.querySelector('[id="lx-jo-iv-jo-3"]').innerText)));
} catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
step('No page errors', errs.length===0, errs.join('|').slice(0,300));
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
