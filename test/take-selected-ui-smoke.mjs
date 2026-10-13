// "TAKE LEAD" ON THE LEADS PAGE (owner, 14 Oct: "when the lead is selected, take lead option should be enabled if the lead is unassigned").
//   * a BD / BD lead who ticks leads gets "Take lead" in the selection bar — ON when at least one ticked lead is still Unassigned and
//     unowned (it says how many), OFF (with the reason) when none is; an admin / recruiter does not get it (admins use Assign)
//   * it offers only the ticked leads that are still Unassigned, says how many the day allows, and sends exactly those ids
//   * an opened lead row has "Take this lead" only while the lead is Unassigned, and only for a BD / BD lead
//   * after a take the ticks are cleared and the window offers "Write the first emails"
// Usage: node test/take-selected-ui-smoke.mjs
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
let status={ enabled:true, cap:25, taken_today:0, remaining_today:25, can_take:25, reason:null, message:null, mailboxes:[{id:'b1',email:'bo@x.test',remaining:100}] };
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)){ const U=new URL(u), p=U.pathname, m=r.request().method(); calls.push(m+' '+p+' '+(r.request().postData()||''));
      if(p==='/leads/take/status') return rep(r,status);
      if(p==='/leads/take'&&m==='POST'){ const b=JSON.parse(r.request().postData()||'{}'); const ids=b.job_ids||[]; return rep(r,{ taken:ids.length, requested:ids.length, job_ids:ids, skipped:0, remaining_today:status.remaining_today-ids.length, message:null }); }
      return rep(r,m==='GET'?[]:{}); }
    return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  const seed=()=>ev(()=>{ STATE.jobs=Array.from({length:6},(_,i)=>({id:'u'+i,stage:'Unassigned',assigned_to_bd:null,position:'Role '+i,company_name:'Co '+i})).concat([{id:'own1',stage:'Assigned',assigned_to_bd:'amy',position:'Owned',company_name:'Co X'}]); STATE.leadSeqSel={}; });
  const toLeads=async(user)=>{ await seed(); await ev((u)=>{ if(u) STATE.user=Object.assign({},STATE.user,u); STATE.page='leads'; STATE.modal=null; STATE.takeLeads=undefined; render(); },user||null); await page.waitForTimeout(300); };
  const tick=async(ids)=>{ await ev((x)=>{ STATE.leadSeqSel={}; x.forEach(i=>{ STATE.leadSeqSel[i]=true; }); render(); },ids); await page.waitForTimeout(250); };
  const bar=()=>ev(()=>{ const b=[...document.querySelectorAll('#content button')].find(x=>/^Take (lead|\d+ leads)$/.test(x.textContent.trim())); return b?{text:b.textContent.trim(),disabled:b.disabled,title:b.title}:null; });
  const modalText=()=>ev(()=>document.querySelector('.modal').innerText.replace(/\s+/g,' '));
  const btn=(re)=>ev((s)=>[...document.querySelectorAll('button')].some(b=>new RegExp(s).test(b.textContent)),re);

  await toLeads({id:'boss',role:'bd_lead',roles:['bd_lead']});
  step('nothing ticked: no selection bar, so no Take lead in it (the toolbar\'s "Take leads" is still there)', (await bar())===null && await btn('^Take leads$'));
  await tick(['own1']);
  let b=await bar();
  step('only an owned lead ticked: Take lead is there but OFF, and says why', b && b.disabled && /Unassigned/.test(b.title), JSON.stringify(b));
  await tick(['u0','u1','own1']);
  b=await bar();
  step('two Unassigned leads and an owned one ticked: "Take 2 leads" is ON', b && !b.disabled && b.text==='Take 2 leads', JSON.stringify(b));
  await tick(['u3']);
  b=await bar();
  step('one Unassigned lead ticked: "Take lead" is ON', b && !b.disabled && b.text==='Take lead', JSON.stringify(b));
  await tick(['u0','u1','own1']); calls.length=0;
  if(process.env.SHOTS) await page.screenshot({path:process.env.SHOTS+'/leads-take-lead-bar.png'});
  await ev(()=>document.querySelector('#content .btn-primary[onclick="leadTakeSelected()"]').click());
  await page.waitForFunction(()=>/You picked/.test((document.querySelector('.modal')||{innerText:''}).innerText),null,{timeout:6000});
  let t=await modalText();
  if(process.env.SHOTS) await page.screenshot({path:process.env.SHOTS+'/leads-take-lead-window.png'});
  step('the window says what is being taken — 2 leads, the owned one dropped — and what the day allows', /You picked 2 leads that are still Unassigned/.test(t) && /up to 25 more today/.test(t) && /bo@x\.test/.test(t) && !(await ev(()=>!!document.getElementById('take-n'))), t.slice(0,220));
  step('its button says exactly how many it will take', await btn('^Take 2 leads$'));
  await ev(()=>[...document.querySelectorAll('.modal button')].find(x=>/^Take 2 leads$/.test(x.textContent)).click());
  await page.waitForFunction(()=>/You now own 2 leads/.test((document.querySelector('.modal')||{innerText:''}).innerText),null,{timeout:6000});
  const post=calls.filter(c=>/^POST \/leads\/take /.test(c)).map(c=>JSON.parse(c.replace(/^POST \/leads\/take /,'')));
  step('it sends exactly the two Unassigned leads picked (and no "count")', post.length===1 && post[0].job_ids.join()==='u0,u1' && !('count' in post[0]), JSON.stringify(post));
  step('the ticks are cleared, and the result offers "Write the first emails"', await ev(()=>Object.keys(STATE.leadSeqSel||{}).filter(k=>STATE.leadSeqSel[k]).length===0) && await btn('Write the first emails'));

  // a day that allows fewer than were picked
  status={ ...status, cap:25, taken_today:24, remaining_today:1, can_take:1 };
  await toLeads({id:'boss',role:'bd_lead',roles:['bd_lead']}); await tick(['u0','u1','u2']); calls.length=0;
  await ev(()=>leadTakeSelected()); await page.waitForFunction(()=>/You picked/.test((document.querySelector('.modal')||{innerText:''}).innerText),null,{timeout:6000});
  t=await modalText();
  step('with one left today and three picked it says so and offers to take the first one', /You picked 3 leads/.test(t) && /may take 1 more today/.test(t) && /first 1 will be taken/.test(t) && await btn('^Take 1 lead$'), t.slice(0,240));
  await ev(()=>[...document.querySelectorAll('.modal button')].find(x=>/^Take 1 lead$/.test(x.textContent)).click());
  await page.waitForFunction(()=>/You now own 1 lead/.test((document.querySelector('.modal')||{innerText:''}).innerText),null,{timeout:6000});
  const post2=calls.filter(c=>/^POST \/leads\/take /.test(c)).map(c=>JSON.parse(c.replace(/^POST \/leads\/take /,'')));
  step('…and sends only that one', post2.length===1 && post2[0].job_ids.join()==='u0', JSON.stringify(post2));

  // switched off / not for this person
  status={ enabled:false, cap:0, taken_today:0, remaining_today:0, can_take:0, reason:'off', message:null, mailboxes:[] };
  await toLeads({id:'boss',role:'bd_lead',roles:['bd_lead']}); await tick(['u0']);
  await ev(()=>leadTakeSelected()); await page.waitForFunction(()=>/switched off/.test((document.querySelector('.modal')||{innerText:''}).innerText),null,{timeout:6000});
  step('when an admin has switched taking off, the window says so and offers no Take button', /switched off/.test(await modalText()) && !(await btn('^Take \\d+ leads?$')));
  await ev(()=>closeModal());
  status={ enabled:true, cap:25, taken_today:0, remaining_today:25, can_take:25, reason:null, message:null, mailboxes:[{id:'b1',email:'bo@x.test',remaining:100}] };
  await toLeads({id:'adm',role:'admin',roles:['admin']}); await tick(['u0','u1']);
  step('an admin does not get Take lead in the selection bar (admins use Assign)', (await bar())===null && await btn('^Assign selected$'));
  await toLeads({id:'rec',role:'recruiter',roles:['recruiter']});
  step('a recruiter gets neither', (await bar())===null && !(await btn('^Take leads$')));

  // the lead's own panel
  await toLeads({id:'boss',role:'bd_lead',roles:['bd_lead']});
  step('an opened Unassigned lead has "Take this lead" (BD lead)', await ev(()=>leadExpandHtml(STATE.jobs.find(j=>j.id==='u0')).includes('Take this lead')));
  step('…an owned lead does not', await ev(()=>!leadExpandHtml(STATE.jobs.find(j=>j.id==='own1')).includes('Take this lead')));
  await ev(()=>{ STATE.user=Object.assign({},STATE.user,{role:'admin',roles:['admin']}); });
  step('…and an admin does not see it either', await ev(()=>!leadExpandHtml(STATE.jobs.find(j=>j.id==='u0')).includes('Take this lead')));
  await ev(()=>{ STATE.user=Object.assign({},STATE.user,{id:'boss',role:'bd_lead',roles:['bd_lead']}); });
  calls.length=0;
  await ev(()=>{ document.body.insertAdjacentHTML('beforeend','<div id="__host">'+leadExpandHtml(STATE.jobs.find(j=>j.id==='u2'))+'</div>'); });
  await ev(()=>[...document.querySelectorAll('#__host button')].find(x=>/Take this lead/.test(x.textContent)).click());
  await page.waitForFunction(()=>/You picked 1 lead that is still Unassigned/.test((document.querySelector('.modal')||{innerText:''}).innerText),null,{timeout:6000});
  step('"Take this lead" on a lead\'s own panel opens the same window for just that lead', /You picked 1 lead that is still Unassigned/.test(await modalText()) && await btn('^Take 1 lead$'));
  step('no page errors', errs.length===0, errs.join('|').slice(0,300));
} catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
