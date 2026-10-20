// "NEEDS YOU TODAY" LETS YOU DO THE TASK, NOT ONLY READ ABOUT IT (R-073).
//
// Owner, 29 Sep: "In needs you today section, no option to do the task. Like send
// email once they are back from office or follow up or any other task. Just
// information is mentioned now."  A row could be opened, marked done or snoozed —
// nothing on it did the work.
//
// Pinned in a real browser, one row per kind:
//   reply_due     → Reply       opens the in-app mailbox already searched to that person
//   commitment_due→ Chase       the addressed composer, as a FOLLOW-UP
//   reminder_due  → Write       the reminder's own composer (its guard and template stay in charge)
//   pipeline_step → Open        opens the candidate (an interview / submission step, R-297)
// (No "No reply yet" or "Replied — interested" rows any more — D-0169: the card holds only what is owed; the stage move is in
// the reply row's window, pinned in trace-smoke.)
//   a candidate's thread        answered in the mailbox, never the client composer
//   a row with no address       says so and goes nowhere (never a dead button)
// And nothing is SENT by pressing any of them.
//
// Every probe that cannot take its measurement FAILS — a missing node is never a pass.
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

const results=[];
const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){
  if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b=process.env.PLAYWRIGHT_BROWSERS_PATH;
  if(b && fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium');
  return 'chromium';
}
// "Needs you today" lists what is dated today (R-097), so these rows are dated now.
const NOW_ISO = new Date().toISOString();
const ITEMS = [
  { kind:'reply_due', entity_type:'contact', entity_id:'c1', title:'Sam Lee', subtitle:'Acme Builders', email:'sam@acme.test', job_id:'j1', reason:'Sam wrote 2 days ago and is waiting on you.', priority:90, overdue_days:2, last_activity_at:NOW_ISO },
  { kind:'pipeline_step', step:'interview_soon', submission_id:'sub-7', entity_type:'candidate', entity_id:'cand7', title:'Dana Cruz', subtitle:'Estimator · Northwind', email:'dana@example.test', job_id:'jo7', stage:'Interview Scheduled', reason:'Interview tomorrow — confirm the time with them and prepare them.', priority:85, overdue_days:0, last_activity_at:NOW_ISO },
  { kind:'commitment_due', entity_type:'contact', entity_id:'c4', title:'Pat Wu', subtitle:'Globex', email:'pat@globex.test', job_id:'j4', reason:'Pat said "next week" — that was 6 days ago.', priority:60, overdue_days:6, last_activity_at:NOW_ISO },
  { kind:'reminder_due', entity_type:'contact', entity_id:'c3', reminder_id:'r1', title:'Lee Ann', subtitle:'Initech', email:'leeann@initech.test', job_id:'j3', reason:'Welcome back — follow up.', priority:75, overdue_days:1, last_activity_at:null },
  { kind:'reply_due', entity_type:'candidate', entity_id:'cand2', title:'Maya Ito', subtitle:'Foreman', email:'maya@example.test', job_id:'jo8', reason:'Maya replied and is waiting.', priority:80, overdue_days:1, last_activity_at:NOW_ISO },
  { kind:'commitment_due', entity_type:'contact', entity_id:'c9', title:'No Address', subtitle:'Hooli', email:null, job_id:'j9', reason:'They said "Friday".', priority:30, overdue_days:10, last_activity_at:NOW_ISO },
];
const calls=[];
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
async function api(route){
  const req=route.request(); const p=new URL(req.url()).pathname, m=req.method();
  calls.push({ m, p });
  if (m==='GET' && p==='/next-actions') return reply(route, { items:ITEMS, summary:{ by_kind:{ reply_due:2, commitment_due:2, reminder_due:1, pipeline_step:1 } }, team:{ total:0 } });
  if (m==='GET' && p==='/submissions') return reply(route, { submissions:[{ id:'sub9', candidate_id:'cand1', job_order_id:'jo9', stage:'Screening', sub_stage:null, job:{ id:'jo9', job_title:'Estimator' } }] });
  return reply(route, m==='GET' ? [] : {});
}

let browser;
const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1400}});
  await ctx.route('**',r=>{
    const u=r.request().url();
    if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)) return api(r);
    return r.abort();
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd_lead');
  const ev=(fn,arg)=>page.evaluate(fn,arg);
  const toDash = async () => { await ev(()=>{ STATE.mailbox=STATE.mailbox||{}; STATE.mailbox.q=''; STATE.modal=null; goPage('dashboard'); STATE.naExpanded=true; render(); }); await page.waitForSelector('[data-na-item]',{timeout:8000}).catch(()=>{}); await page.waitForTimeout(300); };
  await toDash();
  await ev(()=>{ STATE.reminders=[{ id:'r1', contact_id:'c3', job_id:'j3', contact_name:'Lee Ann', company_name:'Initech', note:'Welcome back', compose:{ email:'leeann@initech.test', can_send:true } }]; });

  const rowFor = (title) => `[data-na-item] >> text=${title}`;
  const btnIn = (title, label) => ev(({title,label})=>{ const rows=[...document.querySelectorAll('[data-na-item]')]; const r=rows.find(x=>x.innerText.indexOf(title)>=0); if(!r) return null; const b=[...r.querySelectorAll('button')].find(x=>x.textContent.trim()===label); return b?true:false; }, {title,label});
  const press = (title,label) => ev(({title,label})=>{ const rows=[...document.querySelectorAll('[data-na-item]')]; const r=rows.find(x=>x.innerText.indexOf(title)>=0); if(!r) return false; const b=[...r.querySelectorAll('button')].find(x=>x.textContent.trim()===label); if(!b) return false; b.click(); return true; }, {title,label});

  // Every row shows the button for its kind.
  step('Reply due: the row has a Reply button', await btnIn('Sam Lee','Reply')===true);
  step('An interview step: the row has an Open button', await btnIn('Dana Cruz','Open')===true);
  step('They promised: the row has a Chase button', await btnIn('Pat Wu','Chase')===true);
  step('A reminder: the row has a Write button', await btnIn('Lee Ann','Write')===true);
  // The row carries what its buttons need: an interview / submission step is snoozed per SUBMISSION and step (R-297) — the row's
  // own copy of the item used to drop these, so "Not today" on one job hid the candidate's other jobs too.
  const carried = await ev(()=>{ const r=[...document.querySelectorAll('[data-na-item]')].find(x=>x.innerText.indexOf('Dana Cruz')>=0); return r?JSON.parse(decodeURIComponent(r.getAttribute('data-na-item'))):null; });
  step('an interview row carries its submission and step (so a snooze hides that job only)', carried && carried.submission_id==='sub-7' && carried.step==='interview_soon', JSON.stringify(carried));

  // Reply → the mailbox, searched to that person.
  await press('Sam Lee','Reply'); await page.waitForTimeout(300);
  let s1 = await ev(()=>({ page:STATE.page, q:STATE.mailbox&&STATE.mailbox.q }));
  step('Reply opens the mailbox already searched to that person', s1.page==='mailbox' && s1.q==='sam@acme.test', JSON.stringify(s1));
  await toDash();

  // Open on an interview step → the candidate.
  await ev(()=>{ window.__openedCand=null; window.bdOpenCandidate=(id)=>{ window.__openedCand=id; }; });
  await press('Dana Cruz','Open'); await page.waitForTimeout(300);
  step('Open on an interview step opens that candidate', await ev(()=>window.__openedCand)==='cand7');
  await toDash();

  await press('Pat Wu','Chase'); await page.waitForTimeout(400);
  let s3 = await ev(()=>({ page:STATE.page, tab:STATE.emailTab, to:(document.getElementById('og-to')||{}).value, type:STATE.outreachGen&&STATE.outreachGen.form.outreach_type, company:STATE.outreachGen&&STATE.outreachGen.form.company }));
  step('Chase opens Email → Compose addressed to them', s3.page==='email' && s3.tab==='compose' && s3.to==='pat@globex.test', JSON.stringify(s3));
  step('…as a follow-up, not a first email', s3.type==='followup' && s3.company==='Globex');
  await toDash();

  // Reminder → the reminder's own composer.
  await ev(()=>{ STATE.reminders=[{ id:'r1', contact_id:'c3', job_id:'j3', contact_name:'Lee Ann', company_name:'Initech', note:'Welcome back', compose:{ email:'leeann@initech.test', can_send:true } }]; });
  await press('Lee Ann','Write'); await page.waitForTimeout(400);
  let s4 = await ev(()=>({ page:STATE.page, ctx:STATE.composeContext, rid:STATE.composeReminderId }));
  step('Write on a reminder opens the reminder\'s own composer (its guard and template stay in charge)', s4.page==='email' && s4.ctx==='reminder' && s4.rid==='r1', JSON.stringify(s4));
  await toDash();

  // A candidate's thread is answered in the mailbox.
  await press('Maya Ito','Reply'); await page.waitForTimeout(300);
  let s5 = await ev(()=>({ page:STATE.page, q:STATE.mailbox&&STATE.mailbox.q }));
  step('A candidate\'s reply is answered in the mailbox, never the client composer', s5.page==='mailbox' && s5.q==='maya@example.test', JSON.stringify(s5));
  await toDash();

  // No address → says so, goes nowhere.
  await toDash();
  await ev(()=>{ STATE.toasts=[]; });
  await press('No Address','Chase'); await page.waitForTimeout(250);
  let s7 = await ev(()=>({ page:STATE.page, toast:(STATE.toasts||[]).map(t=>t.msg).join('|') }));
  step('A row with no address says so and goes nowhere', s7.page==='dashboard' && /no email address/i.test(s7.toast), JSON.stringify(s7));

  step('Nothing was sent by pressing any of them', !calls.some(c=>c.m==='POST' && /(send|email)/i.test(c.p)));
  step('No page errors', pageErrors.length===0, pageErrors.slice(0,2).join(' | '));
}catch(e){
  console.log('[FAIL] run crashed — '+(e&&e.stack||e)); results.push(false);
}finally{
  if(browser) await browser.close();
  server.close();
}
const pass=results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass===results.length && results.length>0 ? 0 : 1);
