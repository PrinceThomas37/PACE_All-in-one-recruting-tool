// A FINISHED SEND IS ONE QUIET LINE, NOT A PANEL (owner, 6 Oct):
// "the system should not show this every time after the outreach has completed … once it's done this
//  information is on the dashboard anyway — or just a small summary, that's it."
//   * while sending: the full panel (progress, chips) stays
//   * finished cleanly: ONE line ("Send finished at … — 0 sent, 1 waiting"), no progress bar, no chips
//   * finished with failures: the full panel stays (a person has to look) — and says how many
//   * a clean run from over an hour ago is not shown at all
//   * the × on the line dismisses it and the next poll does NOT bring it back
//   * the assignment summary draws no empty column
// Usage: node test/send-summary-line-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':(MIME[path.extname(p)]||'application/octet-stream')+'; charset=utf-8'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  const show=(sp)=>ev((sp)=>{ STATE.pendingEmails=[]; STATE.emailTab='pending'; STATE.page='email'; STATE.sendProgress=sp; render(); },sp);
  const txt=()=>ev(()=>document.getElementById('content').innerText);
  const has=(q)=>ev((q)=>!!document.querySelector('#content '+q),q);
  const now=new Date().toISOString();

  await show({active:true,done:false,total:10,sent:3,failed:0,current:'a@b.test'});
  step('while sending: the full panel (a "Sending emails…" heading and the chips)', /Sending emails/.test(await txt()) && !(await has('.sp-line')));

  await show({active:false,done:true,total:1,sent:0,failed:0,deferred:1,deferredNote:'1 waiting until tomorrow (company already had its first emails today)',completedAt:now});
  const t=await txt();
  step('finished cleanly: ONE line, "Send finished at … — 0 sent, 1 waiting"', await has('.sp-line') && /Send finished at .+ — 0 sent, 1 waiting/.test(t), t.slice(0,160));
  step('…the reason it waited is on that same line', /waiting until tomorrow/.test(await ev(()=>document.querySelector('.sp-line').innerText)));
  step('…and there is no "Send complete" panel, no progress bar, no stat chips', !/Send complete/.test(t) && !/Completed at/.test(t) && !/\bTOTAL\b/i.test(await ev(()=>document.querySelector('.sp-line').parentElement.innerText.split('\n').slice(0,3).join(' '))));

  await show({active:false,done:true,total:4,sent:3,failed:1,failDetails:[{to:'x@y.test',error:'Mailbox full'}],completedAt:now});
  step('finished WITH a failure: the full panel stays, and says how many need attention', /Send complete — 1 need attention/.test(await txt()) && !(await has('.sp-line')));

  await show({active:false,done:true,total:3,sent:3,failed:0,completedAt:new Date(Date.now()-3*3600*1000).toISOString()});
  step('a clean run from 3 hours ago is not shown at all', !(await has('.sp-line')) && !/Send (complete|finished)/.test(await txt()));

  await show({active:false,done:true,total:3,sent:3,failed:0,completedAt:now});
  await ev(()=>document.querySelector('.sp-line-x').click()); await page.waitForTimeout(250);
  step('the × removes the line', !(await has('.sp-line')));
  // the poll hands the SAME finished run back — it must stay dismissed
  await ev(()=>{ window.apiGet=(u)=>/send-progress/.test(u)?Promise.resolve({active:false,done:true,total:3,sent:3,failed:0,completedAt:new Date().toISOString()}):Promise.resolve([]); STATE._progressPollTimer=null; startProgressPoll(); });
  await page.waitForTimeout(2600);
  step('…and the next poll of the server does not bring it back', !(await has('.sp-line')) && ((await ev(()=>STATE.sendProgress))===null));

  // R-141 (owner: "i miss the simplicity in the UI"): the Email page no longer carries the
  // upcoming-OOO box, the "Today's assignment summary" card or the "Pending send schedule"
  // panel. Seed everything that used to draw them and demand all three are gone.
  await ev(()=>{
    const today=new Date().toISOString().slice(0,10), later=new Date(Date.now()+5*864e5).toISOString().slice(0,10);
    STATE.user=Object.assign({},STATE.user,{role:'bd',roles:['bd']});
    STATE.reminders=[{id:'r9',reminder_type:'ooo_return',status:'pending',contact_name:'Dana Ortiz',company_name:'Acme',return_date:later}];
    STATE.todaySummary={total:33,by_freshness:{Fresh:5},by_industry:{Engineering:24},by_timezone:{EST:19}};
    STATE.pendingSummary={total_pending:12,ready_now:4,waiting_window:8,waiting_retry:0,held_company:0,by_timezone:[{timezone:'PST',waiting_window:8,resumes_label:'tomorrow 8:00'}]};
    STATE.page='email'; STATE.emailTab='pending'; STATE.sendProgress=null; render();
  });
  await page.waitForTimeout(200);
  const pageText=await ev(()=>document.getElementById('content').innerText);
  step('the Email page does not show "Upcoming OOO Returns"', !/Upcoming OOO/i.test(pageText));
  step('…nor "Today\'s assignment summary"', !/assignment summary/i.test(pageText));
  step('…nor the "Pending send schedule" panel', !/Pending send schedule/i.test(pageText));
  step('…but the one-line summary and its retry link are there', /4 ready now/.test(pageText) && /Try the waiting ones now/.test(pageText), pageText.slice(0,160).replace(/\n/g,' '));
  step('No page errors', errs.length===0, errs.join('|').slice(0,300));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
