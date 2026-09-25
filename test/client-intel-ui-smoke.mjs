// CLIENT INTELLIGENCE — the Emails tab in a real browser, against a stub API.
//   * switched OFF: the tab is exactly the old list (nothing new drawn);
//   * ON: the free "where things stand" card, the timeline, and the button;
//   * the button → a saved AI summary → "Up to date";
//   * a non-owner sees who owns it and no email text (D-0040).
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

let mode = 'off';   // 'off' | 'owner' | 'other'
let summarised = false;
const DAY = 86400000, now = Date.now();
const iso = (d) => new Date(now - d*DAY).toISOString();
const TIMELINE = [
  { id:'in:1', source:'reply', direction:'inbound', sent_at:iso(6), from:'maria@acme-hvac.com', person:'Maria Lopez', subject:'Re: HVAC technicians',
    text:'18% is higher than our other agency. Can you do 15%? Please send the profiles by Friday, I will review them with Tom next week.' },
  { id:'out:1', source:'outreach', direction:'outbound', sent_at:iso(28), from:'priya@ours.com', to:'maria@acme-hvac.com', subject:'HVAC technicians',
    text:'Thanks Maria. Our standard fee is 18% of first-year salary. I can send profiles this week.' },
  { id:'in:2', source:'reply', direction:'inbound', sent_at:iso(30), from:'maria@acme-hvac.com', person:'Maria Lopez', subject:'HVAC technicians',
    text:'Yes — we need two Service Technicians in Westminster. What are your rates for a direct hire?' },
];
const SUMMARY = { summary:'Maria Lopez at Acme HVAC asked on 19 Sep whether we can lower our fee from 18% to 15%, and wants profiles by Friday to review with Tom, their Operations Director. We have not answered that email yet.',
  next_steps:[{ id:'reply', label:'Reply to their last email', why:'Answer the 15% request.' },{ id:'send_profiles', label:'Send candidate profiles', why:'They asked for profiles by Friday.' }],
  engine:'ai', covers_until:iso(6), message_count:310, updated_at:new Date().toISOString() };

function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
const calls=[];
async function api(route){
  const u=new URL(route.request().url()), p=u.pathname, m=route.request().method();
  calls.push(m+' '+p);
  if (m==='GET' && p==='/clients') return reply(route,[{ id:'co1', name:'Acme HVAC', industry:'Construction', location:'Westminster, MD', open_job_order_count:1, job_order_count:1 }]);
  if (m==='GET' && p==='/companies/co1/email-activity') return reply(route,[{ id:'t1', to_email:'maria@acme-hvac.com', subject:'Old-list email', sent_at:iso(40), body:'x', body_visible:true }]);
  if (m==='GET' && p==='/clients/co1/intel') {
    if (mode==='off') return reply(route,{ enabled:false });
    if (mode==='other') return reply(route,{ enabled:true, owner:false, owner_name:'Priya Shah' });
    return reply(route,{ enabled:true, owner:true, client:{ id:'co1', name:'Acme HVAC' },
      facts:{ summary:'They asked a question 6 days ago. You haven\'t replied. 310 emails since 2024-09-30: 155 from us, 155 from them. Most in touch: Maria Lopez.', next_steps:[{ id:'reply', label:'Reply to their last email', why:'They asked a question and are waiting on you.' }] },
      summary: summarised ? SUMMARY : null,
      status: summarised ? { state:'up_to_date', new_count:0 } : { state:'none', new_count:310 },
      ai:{ enabled:true, per_user_limit:15, used_today: summarised?1:0, left_today: summarised?14:15 },
      timeline:TIMELINE, total_messages:310 });
  }
  if (m==='POST' && p==='/clients/co1/summary') { summarised=true; return reply(route,{ saved:true, tokens:1040, summary:SUMMARY, status:{ state:'up_to_date', new_count:0 } }); }
  return reply(route, m==='GET' ? [] : {});
}

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
  const openEmails=async()=>{
    await page.evaluate(()=>{ goPage('clients'); }); await page.waitForTimeout(400);
    await page.evaluate(()=>{ clientsOpen('co1'); }); await page.waitForTimeout(500);
    await page.evaluate(()=>{ clientsTab('emails'); }); await page.waitForTimeout(150);
  };
  const panelText=()=>page.evaluate(()=>{ const el=document.querySelector('[data-clpanel="emails"]'); return el?el.innerText:null; });

  // OFF
  await openEmails();
  let t=await panelText();
  step('switched off: the Emails tab is the old list, unchanged', t!==null && /Old-list email/.test(t) && !/Where things stand|Generate AI summary/.test(t), (t||'').slice(0,80));

  // ON, owner, before any summary
  mode='owner'; await openEmails();
  t=await panelText();
  step('on: the free "where things stand" card shows, no AI used', t!==null && /Where things stand/.test(t) && /from the emails, no AI/.test(t));
  step('on: every email with the client, newest first', /Every email with Acme HVAC/.test(t) && /310 in total/.test(t));
  step('on: the button says what it will cost', /Generate AI summary/.test(t) && /Uses 1 of your 15 today/.test(t));
  await shot('11-client-emails-before');
  await page.evaluate(()=>clientsToggleEmail('in:1')); await page.waitForTimeout(150);
  step('opening an email shows its text', /Can you do 15%/.test(await panelText()));

  // press it
  await page.evaluate(()=>clientsSummarise(false)); await page.waitForTimeout(500);
  t=await panelText();
  step('the button makes one request', calls.filter(c=>c==='POST /clients/co1/summary').length===1);
  step('the saved AI summary and its next steps show', /AI summary to/.test(t) && /lower our fee/.test(t) && /Send candidate profiles/.test(t));
  step('afterwards it says "Up to date" (pressing again costs nothing)', /Up to date/.test(t) && /costs nothing/.test(t));
  await shot('12-client-emails-summary');

  // not the owner
  mode='other'; summarised=false; await openEmails();
  t=await panelText();
  step('not the owner: told whose client it is, and no email text', /Only Priya Shah can read/.test(t) && !/Can you do 15%/.test(t));

  step('no page errors', pageErrors.length===0, pageErrors.join(' | '));
} catch(e){ step('suite ran', false, e && e.stack || String(e)); }
finally { if(browser) await browser.close(); server.close(); }
const failed=results.filter(x=>!x).length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
