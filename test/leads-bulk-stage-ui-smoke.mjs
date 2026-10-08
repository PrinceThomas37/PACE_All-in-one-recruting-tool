// SELECT SEVERAL LEADS AND CHANGE THEIR STAGE; ADMIN SEES LEADS PER PERSON AND PER TIME RANGE (owner, 8 Oct: "the user or admin is not able to
// change the stage of the leads while multiselect … for the admin they should be able to see or view leads per user assigned and then select
// what time range (today, yesterday, or calendar) to do these changes").
//   * every lead can be ticked (before, a lead with no contact email could not be) by admin, RA lead, BD and BD lead
//   * the bar over the list offers "Change stage to…": an admin / RA lead may also release leads to Unassigned; a BD may not
//   * an "Assigned to" filter (admin / leads) lists each person with their count, plus "Nobody"; it narrows the list, and "select all"
//     then ticks only what is on screen — together with the existing Today / Yesterday / calendar range
//   * Apply asks first, then sends ONLY the ticked leads that are on screen; ones ticked earlier but filtered away are left alone
// Usage: node test/leads-bulk-stage-ui-smoke.mjs
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
const rep=(r,b,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(b)});
const calls=[];
let browser; const errs=[];
const today=new Date().toISOString(), old='2026-08-01T10:00:00Z';
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)){ const U=new URL(u), p=U.pathname, m=r.request().method(); calls.push(m+' '+p+' '+(r.request().postData()||''));
      if(p==='/jobs/bulk-stage'&&m==='POST'){ const b=JSON.parse(r.request().postData()||'{}'); return rep(r,{success:true,updated:b.job_ids.length,stage:b.stage}); }
      return rep(r,m==='GET'?[]:{}); }
    return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'admin');
  const ev=(f,a)=>page.evaluate(f,a);
  const seed=(role)=>ev((r)=>{
    STATE.user=Object.assign({},STATE.user,{role:r,roles:[r]});
    const mk=(id,owner,name,created,stage)=>({id,position:'Role '+id,company_name:'Co '+id,stage:stage||'Assigned',assigned_to_bd:owner,assigned_bd_name:name,created_at:created,industry:'Construction'});
    STATE.jobs=[mk('a1','ash','Ash Sayyad','TODAY'),mk('a2','ash','Ash Sayyad','TODAY'),mk('a3','ash','Ash Sayyad','OLD'),mk('b1','bea','Bea BD','TODAY'),mk('b2','bea','Bea BD','OLD'),mk('n1',null,'', 'TODAY','Unassigned')];
    STATE.jobs.forEach(j=>{ j.created_at=j.created_at==='TODAY'?window.__today:window.__old; });
    STATE.contacts=[{id:'c-a1',job_id:'a1',first_name:'Sam',last_name:'R',email:'sam@x.test',is_primary:true}];   // only a1 has a contact email
    STATE.leadSeqSel={}; STATE.jobsFilter={search:'',stages:[],industries:[],assignee:'',dateRange:'all',dateFrom:'',dateTo:''};
    STATE.page='leads'; STATE.modal=null; window.confirm=function(){ return true; }; window.refreshJobs=function(){ return Promise.resolve(); }; render();
  },role);
  await ev(([t,o])=>{ window.__today=t; window.__old=o; },[today,old]);
  const rowsText=()=>ev(()=>[...document.querySelectorAll('#content tbody tr')].map(r=>r.innerText.replace(/\s+/g,' ')).join(' | '));
  const boxes=()=>page.locator('#content tbody input.ck');

  await seed('admin'); await page.waitForTimeout(300);
  step('an admin can tick EVERY lead — also the five that have no contact email', (await boxes().count())===6, String(await boxes().count()));
  await boxes().nth(0).click(); await boxes().nth(2).click(); await page.waitForTimeout(150);
  let bar=await ev(()=>{ const b=document.getElementById('bulk-stage-sel'); return b?[...b.options].map(o=>o.textContent):null; });
  step('ticking shows a bar with "Change stage to…" — for an admin including the release to Unassigned', bar && bar[0]==='Change stage to…' && bar.some(t=>/^Unassigned \(release to the pool\)/.test(t)) && bar.includes('Connected') && bar.includes('Rejected') && !bar.includes('Assigned'), JSON.stringify(bar));
  step('…and says how many are ticked', /2 leads selected/.test(await ev(()=>document.getElementById('content').innerText)));
  await ev(()=>{ document.getElementById('bulk-stage-sel').value='Connected'; leadBulkStage(); }); await page.waitForTimeout(250);
  let post=calls.filter(c=>/POST \/jobs\/bulk-stage/.test(c)).pop(); let pb=post&&JSON.parse(post.split(' ').slice(2).join(' '));
  step('Apply sends the two ticked leads and the chosen stage in one call', pb && pb.stage==='Connected' && pb.job_ids.sort().join()==='a1,a3', post);
  step('…and the ticks are cleared afterwards', (await ev(()=>Object.keys(STATE.leadSeqSel||{}).filter(k=>STATE.leadSeqSel[k]).length))===0);

  // per person
  await seed('admin'); await page.waitForTimeout(250);
  const opts=await ev(()=>{ const s=[...document.querySelectorAll('#content select')].find(x=>/Nobody/.test(x.innerText)); return s?[...s.options].map(o=>o.textContent):null; });
  step('the admin has an "Assigned to" filter: everyone, nobody, and each person with how many leads they own', opts && opts[0]==='Everyone (6)' && opts.includes('Nobody — Unassigned (1)') && opts.includes('Ash Sayyad (3)') && opts.includes('Bea BD (2)'), JSON.stringify(opts));
  await ev(()=>{ STATE.jobsFilter.assignee='ash'; render(); }); await page.waitForTimeout(200);
  step('picking a person shows just their leads', (await boxes().count())===3 && /Role a1/.test(await rowsText()) && !/Role b1/.test(await rowsText()));
  await ev(()=>{ STATE.jobsFilter.dateRange='today'; render(); }); await page.waitForTimeout(200);
  step('…and with the Today range, just their leads added today', (await boxes().count())===2, await rowsText());
  await page.locator('#content thead input.ck').click(); await page.waitForTimeout(150);
  step('"select all" ticks only what is on screen (2 of Ash\'s, not Bea\'s, not the older one)', /2 leads selected/.test(await ev(()=>document.getElementById('content').innerText)));
  await ev(()=>{ STATE.jobsFilter.assignee='bea'; STATE.jobsFilter.dateRange='all'; render(); }); await page.waitForTimeout(200);
  await boxes().nth(0).click(); await page.waitForTimeout(150);
  const barTxt=await ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  step('ticks made under another filter are not counted, and the bar says they are left alone', /1 lead selected/.test(barTxt) && /\+2 hidden by the filters, left alone/.test(barTxt), barTxt.slice(0,300));
  calls.length=0;
  await ev(()=>{ document.getElementById('bulk-stage-sel').value='Unassigned'; leadBulkStage(); }); await page.waitForTimeout(250);
  post=calls.filter(c=>/POST \/jobs\/bulk-stage/.test(c)).pop(); pb=post&&JSON.parse(post.split(' ').slice(2).join(' '));
  step('Apply sends ONLY the ticked lead that is on screen (the two hidden ones are not touched)', pb && pb.stage==='Unassigned' && pb.job_ids.length===1 && /^b/.test(pb.job_ids[0]), post);
  await ev(()=>{ STATE.jobsFilter.assignee='none'; render(); }); await page.waitForTimeout(200);
  step('"Nobody" shows the Unassigned leads', (await boxes().count())===1 && /Role n1/.test(await rowsText()));

  // a refused confirm changes nothing
  await seed('admin'); await page.waitForTimeout(200);
  await boxes().nth(0).click(); calls.length=0;
  await ev(()=>{ window.confirm=function(){ return false; }; document.getElementById('bulk-stage-sel').value='Unassigned'; leadBulkStage(); }); await page.waitForTimeout(200);
  step('saying "no" to the question changes nothing and sends nothing', !calls.some(c=>/bulk-stage/.test(c)));
  await ev(()=>{ window.confirm=function(){ return true; }; document.getElementById('bulk-stage-sel').value=''; leadBulkStage(); }); await page.waitForTimeout(150);
  step('pressing Apply with no stage chosen asks for one instead of sending', !calls.some(c=>/bulk-stage/.test(c)));

  // BD
  await seed('bd'); await page.waitForTimeout(250);
  await boxes().nth(0).click(); await page.waitForTimeout(150);
  bar=await ev(()=>{ const b=document.getElementById('bulk-stage-sel'); return b?[...b.options].map(o=>o.textContent):null; });
  step('a BD can tick and change stage too — but is not offered Unassigned (the server refuses it as well)', bar && bar.includes('Connected') && !bar.some(t=>/Unassigned/.test(t)), JSON.stringify(bar));
  step('…and has no "Assigned to" filter (they only ever see their own)', !(await ev(()=>[...document.querySelectorAll('#content select')].some(x=>/Nobody/.test(x.innerText)))));
  await seed('recruiter'); await page.waitForTimeout(250);
  step('a recruiter gets no tick boxes on the lead list', (await boxes().count())===0);
  step('no page errors', errs.length===0, errs.join('|').slice(0,300));
} catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
