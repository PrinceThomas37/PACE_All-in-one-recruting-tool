// LEAD EMAILS — the email timeline + summary inside a lead's row on the Leads
// list (Session 31: "Just this lead list … let me see what it works with
// current data"), in a real browser against a stub API.
//   * switched OFF: the row opens exactly as before — nothing new drawn;
//   * ON: the free "where things stand" card, the emails, open one;
//   * the button → a saved AI summary → "Up to date";
//   * not the owner: told whose lead it is, no email text (D-0040);
//   * opening the row never calls render() (06-page-leads.js rule 2).
// SHOTS=<dir> writes screenshots for the owner.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if (p==='/') p='/index.html';
  fs.readFile(path.join(PUBLIC_DIR,p),(err,data)=>{
    if(err){res.writeHead(404);return res.end('nf');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});res.end(data);
  });
});
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const API = 'https://fute-lms-backend.onrender.com';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results=[];
const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){
  if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b=process.env.PLAYWRIGHT_BROWSERS_PATH;
  if(b && fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium');
  return 'chromium';
}

let mode='off';   // 'off' | 'owner' | 'other'
let summarised=false;
const DAY=86400000, now=Date.now();
const iso=(d)=>new Date(now-d*DAY).toISOString();
const TIMELINE=[
  { id:'in:1', direction:'inbound', sent_at:iso(3), from:'dana@northwind.test', person:'Dana Ruiz', subject:'Re: Project Manager role',
    text:'Thanks for reaching out. We are still looking. Can you send two profiles by Thursday?', can_open_full:true },
  { id:'out:1', direction:'outbound', sent_at:iso(9), from:'bd@ours.test', to:'dana@northwind.test', subject:'Project Manager role',
    text:'Hi Dana, I saw the Project Manager opening at Northwind. We place construction PMs — want to see resumes?' },
];
const SUMMARY={ summary:'Dana Ruiz at Northwind said on the 22nd they are still hiring the Project Manager and asked for two profiles by Thursday. We have not sent them yet.',
  next_steps:[{ id:'send_profiles', label:'Send candidate profiles', why:'Dana asked for two by Thursday.' }],
  engine:'ai', covers_until:iso(3), message_count:2, updated_at:new Date().toISOString() };

function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
const calls=[];
async function api(route){
  const u=new URL(route.request().url()), p=decodeURIComponent(u.pathname), m=route.request().method();
  calls.push(m+' '+p);
  if (m==='GET' && p==='/leads/j1/intel') {
    if (mode==='off') return reply(route,{ enabled:false });
    if (mode==='other') return reply(route,{ enabled:true, owner:false, owner_name:'Priya Shah' });
    return reply(route,{ enabled:true, owner:true,
      facts:{ summary:'They asked a question 3 days ago. You haven\'t replied. 2 emails: 1 from us, 1 from them.', next_steps:[{ id:'reply', label:'Reply to their last email', why:'They asked a question and are waiting on you.' }] },
      summary: summarised?SUMMARY:null,
      status: summarised?{ state:'up_to_date', new_count:0 }:{ state:'none', new_count:2 },
      ai:{ enabled:true, per_user_limit:15, used_today:summarised?1:0, left_today:summarised?14:15 },
      timeline:TIMELINE, total_messages:2 });
  }
  if (m==='GET' && p==='/leads/j1/intel/messages/in:1/full') return reply(route,{ text:'Thanks for reaching out. We are still looking. Can you send two profiles by Thursday?\n\n> Hi Dana, I saw the Project Manager opening…' });
  if (m==='POST' && p==='/leads/j1/summary') { summarised=true; return reply(route,{ saved:true, tokens:900, summary:SUMMARY, status:{ state:'up_to_date', new_count:0 } }); }
  return reply(route, m==='GET'?[]:{});
}

const SEED=()=>{
  const now=Date.now();
  window.STATE.companies=[{id:'co1',name:'Northwind Builders'}];
  window.STATE.contacts=[{id:'ct1',job_id:'j1',company_id:'co1',first_name:'Dana',last_name:'Ruiz',email:'dana@northwind.test',designation:'HR Manager',is_primary:true,email_status:'valid'}];
  window.STATE.jobs=[{id:'j1',position:'Project Manager',pos:'Project Manager',company_id:'co1',company_name:'Northwind Builders',company:{name:'Northwind Builders'},
    location:'Austin, TX',loc:'Austin, TX',stage:'Connected',industry:'Construction',date:new Date(now).toISOString().slice(0,10),
    created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString(),assigned_to_bd:'test-bd',assigned_bd_name:'BD Lead 1',
    assigned_at:new Date(now).toISOString(),contacts:[{id:'ct1',email:'dana@northwind.test',first_name:'Dana'}]}];
  window.STATE.leads=window.STATE.jobs; window.STATE.leadIntel={};
  window.STATE.page='leads'; window.render();
};

let browser; const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)) return api(r); return r.abort(); });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd');
  const shot=async(n)=>{ if(SHOTS) await page.screenshot({ path:path.join(SHOTS,n+'.png') }); };
  const intel=()=>page.evaluate(()=>{ const el=document.getElementById('lx-intel-j1'); return el?{ hidden:el.hidden, text:el.innerText }:null; });
  const openRow=async()=>{
    await page.evaluate(()=>{ document.querySelectorAll('#content tr.lead-exp').forEach(r=>r.remove()); document.querySelectorAll('#content tr.is-open').forEach(r=>r.classList.remove('is-open')); });
    await page.evaluate(SEED); await page.waitForTimeout(300);
    await page.click('#content tr[data-row-id="j1"]'); await page.waitForTimeout(400);
  };

  // OFF
  await openRow();
  let t=await intel();
  step('switched off: the lead row opens exactly as before (no email block)', t && t.hidden===true && !t.text, JSON.stringify(t));

  // ON, owner
  mode='owner';
  await openRow();
  t=await intel();
  step('on: the free "where things stand" card, no AI used', t && !t.hidden && /Where things stand/i.test(t.text) && /from the emails, no AI/.test(t.text), (t&&t.text||'').slice(0,120));
  step('on: the lead\'s emails are listed', /Re: Project Manager role/.test(t.text) && /Project Manager role/.test(t.text));
  step('on: the button says what it will cost', /Generate AI summary/.test(t.text) && /Uses 1 of your 15 today/.test(t.text));
  await page.evaluate(()=>leadIntelToggle('j1','in:1')); await page.waitForTimeout(150);
  t=await intel();
  step('opening an email shows its text', /two profiles by Thursday/.test(t.text));
  await shot('21-lead-emails-before');
  await page.evaluate(()=>leadIntelFull('j1','in:1')); await page.waitForTimeout(300);
  t=await intel();
  step('"Open the full email" fetches it from the mailbox', /straight from your mailbox/.test(t.text) && /> Hi Dana/.test(t.text));

  // press it — and the page must not re-render the whole list
  const renders=await page.evaluate(async()=>{
    let n=0; const orig=window.render; window.render=function(){ n++; return orig.apply(this,arguments); };
    leadIntelSummarise('j1',false); await new Promise(r=>setTimeout(r,500));
    window.render=orig; return n;
  });
  t=await intel();
  step('the button makes one request', calls.filter(c=>c==='POST /leads/j1/summary').length===1);
  step('the saved AI summary and its next step show', /AI summary to/.test(t.text) && /two profiles by Thursday/.test(t.text) && /Send candidate profiles/.test(t.text));
  step('afterwards it says "Up to date" (pressing again costs nothing)', /Up to date/.test(t.text) && /costs nothing/.test(t.text));
  step('none of this re-renders the page (the row stays open)', renders===0 && await page.evaluate(()=>document.querySelectorAll('#content tr.lead-exp').length===1), 'renders='+renders);
  await shot('22-lead-emails-summary');

  // not the owner
  mode='other'; summarised=false;
  await openRow();
  t=await intel();
  step('not the owner: told whose lead it is, and no email text', /Only Priya Shah can read/.test(t.text) && !/two profiles/.test(t.text));

  step('no page errors', pageErrors.length===0, pageErrors.join(' | '));
} catch(e){ step('suite ran', false, e && e.stack || String(e)); }
finally { if(browser) await browser.close(); server.close(); }
const failed=results.filter(x=>!x).length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
