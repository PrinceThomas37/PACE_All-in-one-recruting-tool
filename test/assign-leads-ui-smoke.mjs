// "ASSIGN" ON THE LEADS PAGE (D-0110, R-175) — a manager hands Unassigned leads to themselves or their team, and chooses
// how many go from each of the assignee's email IDs (owner, 8 Oct).
//   * the Assign button is there for a BD / BD lead / admin / RA lead; a recruiter does not get it
//   * with nothing ticked it offers every Unassigned lead in the list; with ticks only the ticked Unassigned ones
//   * the window starts on the automatic split and says who gets them; switching person reloads THEIR email IDs
//   * typing a number repaints nothing; the Assign button stays OFF until the numbers add up to exactly the lot, and the
//     sentence under the boxes says the split in plain words
//   * Assign sends the person and the exact split; the result says who got how many from which email ID
// Usage: node test/assign-leads-ui-smoke.mjs
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
const people=[{id:'boss',name:'Bo Manager',role:'bd_lead',is_me:true,mailboxes:1},{id:'amy',name:'Amy Rep',role:'bd',is_me:false,mailboxes:2},{id:'nia',name:'Nia NoMail',role:'bd',is_me:false,mailboxes:0}];
const mbs={ boss:[{id:'b1',email:'bo@x.test',room:100}], amy:[{id:'a1',email:'amy@co-a.test',room:70},{id:'a2',email:'amy@co-b.test',room:50}] };
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)){ const U=new URL(u), p=U.pathname, m=r.request().method(); calls.push(m+' '+p+U.search+' '+(r.request().postData()||''));
      if(p==='/leads/assign/people') return rep(r,{people});
      if(p==='/leads/assign/mailboxes') return rep(r,{mailboxes:mbs[U.searchParams.get('user_id')]||[]});
      if(p==='/leads/assign'&&m==='POST'){ const b=JSON.parse(r.request().postData()||'{}'); return rep(r,{ assigned:b.job_ids.length, requested:b.job_ids.length, job_ids:b.job_ids, skipped:0, lost:0, to:{id:b.to_user_id,name:'Amy Rep'}, by_mailbox:b.allocation.map(x=>({mailbox_id:x.mailbox_id,email:x.mailbox_id==='a1'?'amy@co-a.test':'amy@co-b.test',count:x.count})), message:null }); }
      return rep(r,m==='GET'?[]:{}); }
    return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  const seed=()=>ev(()=>{ STATE.jobs=Array.from({length:12},(_,i)=>({id:'u'+i,stage:'Unassigned',assigned_to_bd:null,position:'Role '+i,company_name:'Co '+i})).concat([{id:'own1',stage:'Assigned',assigned_to_bd:'amy',position:'Owned',company_name:'Co X'}]); STATE.leadSeqSel={}; });
  const toLeads=async(user)=>{ await seed(); await ev((u)=>{ if(u) STATE.user=Object.assign({},STATE.user,u); STATE.page='leads'; STATE.modal=null; STATE.assignWin=undefined; render(); },user||null); await page.waitForTimeout(300); };
  const btn=(re)=>ev((s)=>[...document.querySelectorAll('button')].some(b=>new RegExp(s).test(b.textContent)),re);
  const modalText=()=>ev(()=>document.querySelector('.modal').innerText.replace(/\s+/g,' '));

  await toLeads({role:'bd_lead',roles:['bd_lead']});
  step('a BD lead sees "Assign" on the Leads page', await btn('^Assign$'));
  await toLeads({role:'admin',roles:['admin']});
  step('an admin does too', await btn('^Assign$'));
  await toLeads({role:'recruiter',roles:['recruiter']});
  step('a recruiter does not', !(await btn('^Assign$')));

  await toLeads({id:'boss',role:'bd_lead',roles:['bd_lead']});
  await ev(()=>openAssignLeads()); await page.waitForSelector('.as-row',{timeout:6000});
  let t=await modalText();
  step('with nothing ticked it offers every Unassigned lead in the list (12) — not the one that already has an owner', /Every Unassigned lead you can see: 12/.test(t), t.slice(0,160));
  step('it starts on ME, with my one email ID taking all of them', /Me \(Bo Manager\)/.test(t) && (await ev(()=>document.getElementById('as-n-b1').value))==='12');
  step('a person with no email ID is listed but cannot be picked', await ev(()=>{ const o=[...document.querySelectorAll('.modal select option')].find(x=>/Nia/.test(x.textContent)); return !!o && o.disabled && /no email ID/.test(o.textContent); }));
  await ev(()=>assignPickPerson('amy')); await page.waitForFunction(()=>document.getElementById('as-n-a1'),null,{timeout:6000});
  const auto=await ev(()=>[document.getElementById('as-n-a1').value,document.getElementById('as-n-a2').value]);
  step('switching to a team member loads THEIR email IDs, on the automatic split by room (70:50 of 12 = 7:5)', auto.join()==='7,5' && calls.some(c=>/^GET \/leads\/assign\/mailboxes\?user_id=amy/.test(c)), auto.join());
  await ev(()=>{ window.__r=0; const o=window.render; window.render=function(){ window.__r++; return o.apply(this,arguments); }; });
  await page.fill('#as-n-a1','9');
  step('typing a number repaints nothing', (await ev(()=>window.__r))===0);
  step('numbers that do not add up (9 + 5 of 12) turn the line red and switch Assign OFF', await ev(()=>document.getElementById('as-go').disabled && /Given out: 14 of 12/.test(document.getElementById('as-sum').textContent) && /c-red/.test(document.getElementById('as-sum').className)));
  await page.fill('#as-n-a1','4'); await page.fill('#as-n-a2','8');
  const say=await ev(()=>document.getElementById('as-say').textContent);
  step('numbers that add up switch Assign ON and the sentence says the split in words', await ev(()=>!document.getElementById('as-go').disabled) && /Give 12 leads to Amy Rep — 4 from amy@co-a\.test, 8 from amy@co-b\.test\./.test(say), say);
  await ev(()=>{ window.render=window.render; });
  await ev(()=>document.getElementById('as-go').click());
  await page.waitForFunction(()=>/Handed out 12 leads to Amy Rep/.test(document.querySelector('.modal').innerText),null,{timeout:6000});
  const post=calls.find(c=>/^POST \/leads\/assign /.test(c)); const pb=post&&JSON.parse(post.split(' ').slice(2).join(' '));
  step('Assign sends the person and the EXACT split chosen', pb && pb.to_user_id==='amy' && pb.job_ids.length===12 && pb.allocation.find(x=>x.mailbox_id==='a1').count===4 && pb.allocation.find(x=>x.mailbox_id==='a2').count===8, post);
  t=await modalText();
  step('the result says how many went from each email ID, and that nothing was sent', /amy@co-a\.test — 4/.test(t) && /amy@co-b\.test — 8/.test(t) && /Nothing has been sent/.test(t), t);
  step('handing leads to someone else offers no "Write the first emails" (they write their own)', !(await btn('Write the first emails')));

  // ticked leads only
  calls.length=0; await toLeads({id:'boss',role:'bd_lead',roles:['bd_lead']});
  await ev(()=>{ STATE.leadSeqSel={u0:true,u1:true,own1:true}; render(); }); await page.waitForTimeout(250); await ev(()=>{ openAssignLeads(); }); await page.waitForSelector('.as-row',{timeout:6000});
  t=await modalText();
  step('with leads ticked it offers only the ticked ones that are still Unassigned (the owned one is dropped)', /The leads you ticked that are still Unassigned: 2/.test(t), t.slice(0,160));
  await ev(()=>document.getElementById('as-go').click());
  await page.waitForFunction(()=>/Handed out 2 leads/.test(document.querySelector('.modal').innerText),null,{timeout:6000});
  step('…and to myself it offers "Write the first emails" for exactly those leads', await btn('Write the first emails'));
  step('no page errors', errs.length===0, errs.join('|').slice(0,300));
} catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
