// "TAKE LEADS" AND "WRITE THE FIRST EMAILS" ON SCREEN (R-148, D-0082) — the BD's side of the owner's gap:
// "importing a list of leads directly into BD user profile. But did not find a way to send the outreach."
//   * a BD (and BD lead) sees a Take leads button on Leads; an admin / RA does not (they have Assign Leads)
//   * the window says how many may be taken TODAY and from which of MY mailboxes — never how big the pool is
//   * Take sends the count; the result says how many are now mine and offers the next step, "Write the first emails",
//     which asks for emails for exactly those leads and lands on Pending
//   * off / cap reached / no mailbox are said in words, with no Take button
//   * after an import that made the leads mine, the finish step is "Write the first emails" — not the dead "Done"
// Usage: node test/take-leads-ui-smoke.mjs
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
let status={ enabled:true, cap:25, taken_today:5, remaining_today:20, can_take:20, reason:null, message:null, mailboxes:[{id:'m1',email:'bd1@x.test',remaining:100},{id:'m2',email:'bd1b@x.test',remaining:40}] };
const calls=[];
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)){ const p=new URL(u).pathname, m=r.request().method(); calls.push(m+' '+p+' '+(r.request().postData()||''));
      if(p==='/leads/take/status') return rep(r,status);
      if(p==='/leads/take'&&m==='POST'){ const b=JSON.parse(r.request().postData()||'{}'); return rep(r,{ taken:b.count, requested:b.count, job_ids:Array.from({length:b.count},(_,i)=>'p'+i), remaining_today:20-b.count, message:null }); }
      if(p==='/emails/generate'&&m==='POST'){ const b=JSON.parse(r.request().postData()||'{}'); return rep(r,{ generated:b.job_ids.length }); }
      return rep(r,m==='GET'?[]:{}); }
    return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  const toLeads=async(user)=>{ await ev((u)=>{ if(u) STATE.user=Object.assign({},STATE.user,u); STATE.page='leads'; STATE.modal=null; STATE.takeLeads=undefined; render(); },user||null); await page.waitForTimeout(300); };
  const btn=(re)=>ev((s)=>[...document.querySelectorAll('button')].some(b=>new RegExp(s).test(b.textContent)),re);

  await toLeads();
  step('a BD sees "Take leads" on the Leads page', await btn('^Take leads$'));
  await toLeads({role:'admin',roles:['admin']});
  step('an admin does not (Assign Leads is theirs)', !(await btn('^Take leads$')));
  await toLeads({role:'bd',roles:['bd']});
  await ev(()=>openTakeLeads()); await page.waitForSelector('#take-n',{timeout:6000});
  const t=await ev(()=>document.querySelector('.modal').innerText.replace(/\s+/g,' '));
  step('the window says how many may be taken today, the limit, and what has been taken', /up to 20 more today/.test(t) && /25 a day/.test(t) && /taken 5/.test(t), t.slice(0,200));
  step('…and lists MY mailboxes with their room — nothing about the pool', /bd1@x\.test/.test(t) && /bd1b@x\.test/.test(t) && !/pool/i.test(t.replace(/handed to you from the pool/,'')), t);
  step('…the box starts at 10', (await ev(()=>document.getElementById('take-n').value))==='10');
  await ev(()=>{ window.__r=0; const o=window.render; window.render=function(){ window.__r++; return o.apply(this,arguments); }; });
  await page.fill('#take-n','7');
  step('typing a number repaints nothing', (await ev(()=>window.__r))===0 && (await ev(()=>STATE.takeLeads.count))==='7');
  await ev(()=>[...document.querySelectorAll('.modal .mf button')].find(b=>/^Take leads$/.test(b.textContent)).click());
  await page.waitForFunction(()=>/You now own 7 leads/.test(document.querySelector('.modal').innerText),null,{timeout:6000});
  step('Take sends exactly that count to POST /leads/take', calls.includes('POST /leads/take {"count":7}'), calls.filter(c=>/take/.test(c)).join(' | '));
  const res=await ev(()=>document.querySelector('.modal').innerText.replace(/\s+/g,' '));
  step('the result says they are mine, nothing was sent yet, and how many I may still take', /You now own 7 leads/.test(res) && /Nothing has been sent/.test(res) && /13 more today/.test(res), res);
  await ev(()=>[...document.querySelectorAll('.modal .mf button')].find(b=>/Write the first emails/.test(b.textContent)).click());
  await page.waitForTimeout(500);
  const gen=calls.find(c=>/^POST \/emails\/generate/.test(c));
  step('"Write the first emails" asks for emails for EXACTLY those 7 leads', gen && JSON.parse(gen.split(' ').slice(2).join(' ')).job_ids.join()==='p0,p1,p2,p3,p4,p5,p6', gen);
  step('…and lands on the Pending tab with the window gone', await ev(()=>STATE.page==='email' && STATE.emailTab==='pending' && !STATE.modal));

  // the "no" states
  for (const [label, st, re] of [
    ['switched off', {enabled:false,cap:0,reason:'off',can_take:0,remaining_today:0,mailboxes:[]}, /switched off/],
    ['limit reached', {reason:'cap_reached',remaining_today:0,can_take:0}, /taken all you may for today/],
    ['no connected mailbox', {reason:'no_mailbox',can_take:0,mailboxes:[],message:'None of your email IDs is connected and working — connect or reconnect one under Email IDs first.'}, /connected email ID/]]) {
    status={ ...status, enabled:true, cap:25, ...st };
    await toLeads(); await ev(()=>openTakeLeads()); await page.waitForTimeout(400);
    const m=await ev(()=>({ txt:document.querySelector('.modal').innerText.replace(/\s+/g,' '), take:[...document.querySelectorAll('.modal .mf button')].some(b=>/^Take leads$/.test(b.textContent)) }));
    step(`${label}: said in words, and there is no Take button`, re.test(m.txt) && !m.take, m.txt.slice(0,140));
  }

  // after an IMPORT that made the leads mine
  const fin=await ev(()=>{ const h=renderImportProgressModal(3,3,['done'],true,'3 jobs imported.',['j1','j2','j3']); return h; });
  step('an import that made the leads mine finishes with "Write the first emails" (and a "Not now"), not the dead "Done"', /Write the first emails/.test(fin) && /Not now/.test(fin) && !/Done<\/button>/.test(fin));
  const legacy=await ev(()=>renderImportProgressModal(3,3,['done'],true,'3 jobs imported.'));
  step('an import into the pool (RA / admin) still finishes with Done', /Done/.test(legacy) && !/Write the first emails/.test(legacy));
  calls.length=0;
  await ev((h)=>{ STATE.modal=h; render(); },fin); await page.waitForTimeout(200);
  await ev(()=>[...document.querySelectorAll('.modal .mf button')].find(b=>/Write the first emails/.test(b.textContent)).click());
  await page.waitForTimeout(500);
  step('…and that button writes the emails for exactly the imported leads', calls.some(c=>/^POST \/emails\/generate/.test(c) && /"job_ids":\["j1","j2","j3"\]/.test(c)), calls.join(' | '));
  step('no page errors', errs.length===0, errs.join('|').slice(0,300));
} catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
