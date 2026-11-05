// OUTREACH INSIGHTS SWITCH (R-398), in a real browser: Me / My team / a person, owner shown in the by-sequence table, and a manager
// switching off a team member's sequence behind a confirmation that names the people inside.
// Usage: node test/outreach-team-switch-ui-smoke.mjs
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
const day=(n)=>{ const d=new Date(); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); };
const ME='u-mgr', R1='u-r1';
const asked=[]; const offCalls=[]; let seqs=[
  { id:'sR1', name:'Rita seq', people:20, emailed:50, opened_rate:null, replied:2, replied_rate:4, interested:1, bounced_rate:0, candidates:false, owner_id:R1, owner_name:'Rita Report', status:'active', can_switch_off:true, people_now:12 },
  { id:'sGone', name:'Old seq', people:5, emailed:9, opened_rate:null, replied:0, replied_rate:0, interested:0, bounced_rate:0, candidates:false, owner_id:R1, owner_name:'Rita Report', status:'deleted', can_switch_off:false }];
const out=(who)=>({ from:day(29), to:day(0), bucket:'day', totals:{ people:25, emailed:59, opened_rate:null, replied:2, replied_rate:3, interested:1, bounced_rate:0 },
  series:[0].map(()=>({ key:day(0), emailed:59, opened:0, replied:2 })), sequences: who==='me'?[]:seqs,
  choices:[{id:'all',name:'All sequences'}], scope:{ who, me:ME, people:[{id:R1,name:'Rita Report'}] } });
const rep=(r,b)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1300,height:1600}});
  await ctx.route('**',r=>{ const u=new URL(r.request().url()); if(r.request().url().startsWith(BASE)) return r.continue(); if(r.request().url().startsWith(API)){ const p=u.pathname;
    if(p==='/insights/outreach'){ asked.push(u.searchParams.get('who')); return rep(r,out(u.searchParams.get('who')||'me')); }
    if(p==='/insights/outreach/sequence/sR1/switch-off'){ offCalls.push(p); seqs=seqs.map(s=>s.id==='sR1'?Object.assign({},s,{status:'archived',can_switch_off:false}):s); return rep(r,{ok:true,name:'Rita seq',stopped:12}); }
    return rep(r,r.request().method()==='GET'?[]:{}); } return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,{id:ME,name:'Mona Manager',role:'bd_lead',roles:['bd_lead']});
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{ STATE.page='bdinsights'; STATE.bdInsightsData=null; render(); });
  await page.waitForSelector('[data-oi-who]',{timeout:8000});
  step('the screen opens on "Me" and asked the server for me', await ev(()=>document.querySelector('[data-oi-who]').value==='me') && asked[0]==='me', JSON.stringify(asked));
  step('the switch offers Me, My team and the person on the line', await ev(()=>[...document.querySelectorAll('[data-oi-who] option')].map(o=>o.textContent).join('|')==='Me|My team|Rita Report'));
  step('on "Me" there is no switch-off button (nothing to switch off)', await ev(()=>!document.querySelector('[data-oi-off]')));
  await page.selectOption('[data-oi-who]','team');
  await page.waitForSelector('[data-oi-off]',{timeout:8000});
  step('"My team" asks the server for the team', asked[asked.length-1]==='team', JSON.stringify(asked));
  step('…and the table names whose each sequence is', await ev(()=>/Rita seq\s*·\s*Rita Report/.test(document.querySelector('[data-oi-table]').innerText)));
  step('…a deleted sequence keeps its past numbers and says it is deleted, with no button', await ev(()=>/Old seq[\s\S]*\(deleted\)/.test(document.querySelector('[data-oi-table]').innerText)) && await ev(()=>document.querySelectorAll('[data-oi-off]').length===1));
  await page.click('[data-oi-off="sR1"]');
  await page.waitForSelector('[data-wf-confirm]');
  step('Switch off asks first, names the owner and the 12 people inside', await ev(()=>{ const t=document.querySelector('[data-wf-confirm]').innerText; return /Rita Report/.test(t) && /12 people are in it now/.test(t) && /already waiting to go out still go/.test(t); }));
  step('…asking changed nothing yet', offCalls.length===0);
  await page.click('[data-wf-confirm-go]');
  await page.waitForFunction(()=>!document.querySelector('[data-oi-off]'),null,{timeout:8000});
  step('confirming sends the switch-off once, and the row now reads (off)', offCalls.length===1 && await ev(()=>/Rita seq[\s\S]*\(off\)/.test(document.querySelector('[data-oi-table]').innerText)));
  await page.selectOption('[data-oi-who]',R1);
  await page.waitForFunction(()=>true); await page.waitForTimeout(200);
  step('picking one person asks the server for that person', asked[asked.length-1]===R1, JSON.stringify(asked));
  step('No page errors', errs.length===0, errs.join('|'));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\n'+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
