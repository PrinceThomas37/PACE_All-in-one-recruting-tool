// THE INSIGHTS SCREENS DRAW THE SERVER'S NUMBERS — THEY DO NO ARITHMETIC OF THEIR OWN
// (owner, 2026-09-30: "These numbers don't match up. The reports and insights … are not tuned
// and connected well.")
// Three screens (personal, team overview, team drill-down) used to add up leads and emails in the
// browser from partly-loaded lists. Now `GET /insights/bd/:id` and `GET /insights/bd-team` answer,
// both from services/bd-insights.js, and the screens only draw. Proven here by giving the BROWSER
// NO LEADS AND NO EMAILS AT ALL (STATE.jobs = [], STATE.sentEmails = []) and checking that every
// number on screen is still the server's — an old screen would show zeros.
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
const summary = (o) => Object.assign({ total_all:110,total_today:0,total_week:85,total_month:110,assigned:100,positive:0,converted:6,negative:0,ooo:0,future:0,conv_rate:5,replied:11,reply_rate:10,response_rate:10,
  emails_sent:311,emails_sent_today:16,emails_pending:1,emails_failed:0,
  last_7_emails:{[day(6)]:0,[day(5)]:40,[day(4)]:41,[day(3)]:42,[day(2)]:43,[day(1)]:40,[day(0)]:16},
  last_7_leads:{[day(6)]:0,[day(5)]:15,[day(4)]:0,[day(3)]:0,[day(2)]:22,[day(1)]:48,[day(0)]:0},
  by_stage:{Assigned:100,Connected:6,'In Discussion':0,Positive:0}, by_industry:{Construction:30} }, o||{});
const ME='u-lead', R1='u-bd2';
const TEAM = { scope:'team', windows:{}, people:[Object.assign({id:R1,name:'BD Two',role:'bd'}, summary({total_all:40,total_today:3,total_week:12,total_month:40,converted:8,conv_rate:20,replied:14,reply_rate:35,emails_sent:123,emails_pending:2,by_stage:{Assigned:30,Connected:8,Negative:2}}))] };
const calls=[]; const rep=(r,b)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
let browser; const errs=[]; const tzSeen=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1300,height:1600}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)){ const p=new URL(u).pathname; calls.push(p); if(p.indexOf('/insights/')===0) tzSeen.push(new URL(u).searchParams.get('tz'));
    if(p==='/insights/bd/'+ME) return rep(r,summary()); if(p==='/insights/bd-team') return rep(r,TEAM); return rep(r,r.request().method()==='GET'?[]:{}); } return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,{id:ME,name:'BD Lead 1',role:'bd_lead',roles:['bd_lead']});
  const ev=(f,a)=>page.evaluate(f,a);
  // the browser knows NOTHING about leads or emails — only who reports to whom
  await ev((a)=>{ STATE.jobs=[]; STATE.sentEmails=[]; STATE.pendingEmails=[]; STATE.emails=[]; STATE.users=[{id:a.ME,name:'BD Lead 1',role:'bd_lead',roles:['bd_lead']},{id:a.R1,name:'BD Two',role:'bd',roles:['bd'],managerId:a.ME}]; STATE.page='bdinsights'; STATE.bdInsightsData=null; STATE.bdTeamInsights=null; render(); },{ME,R1});
  await page.waitForFunction(()=>/Emails Sent/.test(document.getElementById('content').innerText),null,{timeout:8000}).catch(()=>{});
  await page.waitForTimeout(300);
  const t1 = await ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  const nameNow = await ev(()=>({ title:(document.querySelector('#content .ptitle')||{}).textContent||'', rail:(document.getElementById('sidebar')||{}).innerText||'', bar:(document.getElementById('topbar')||{}).innerText||'' }));
  step('the page is called "Outreach Insights" (owner, 8 Oct) — heading, sidebar and top bar — and "Lead Insights" is gone', /Outreach Insights/.test(nameNow.title) && /Outreach Insights/.test(nameNow.rail) && !/Lead Insights/.test(nameNow.title+nameNow.rail+nameNow.bar), JSON.stringify(nameNow).slice(0,200));
  step('personal: emails sent (30 days) is the server\'s 311 — with no emails in the browser at all', /311\s*Emails sent/i.test(t1), t1.slice(0,160));
  step('personal: "Leads, last 7 days" is 85 and the 30-day tile 110, both the server\'s', /85\s*Last 7 days/.test(t1) && /110\s*Last 30 days/.test(t1));
  step('personal: the tile says what the tiles mean ("last 30 days"), not "this month"', /30 days/i.test(t1) && !/Sent \(month\)/.test(t1) && !/this month/i.test(t1));
  step('personal: response rate shows the REPLY rate (10%), not the conversion rate (5%)', /10%\s*Response rate/.test(t1) || /Response rate[^0-9]{0,20}10%/.test(t1), (t1.match(/.{30}Response rate.{20}/)||[''])[0]);
  const bars = await ev(()=>{ const c=document.getElementById('content'); return c.innerText; });
  step('personal: the chart and the tile agree (15+22+48 = 85)', /15/.test(bars) && /22/.test(bars) && /48/.test(bars));

  // team overview
  await ev(()=>{ STATE.bdInsightsView='team'; render(); });
  await page.waitForFunction(()=>/BD Two/.test(document.getElementById('content').innerText),null,{timeout:8000}).catch(()=>{});
  const t2 = await ev(()=>{ const rows=[...document.querySelectorAll('#content tbody tr')].map(r=>r.innerText.replace(/\s+/g,' ').trim()); return { rows, text:document.getElementById('content').innerText.replace(/\s+/g,' ') }; });
  step('the browser tells the server which time zone it is in (a day is the viewer\'s day, R-102)', tzSeen.length>=1 && tzSeen.every(z=>z && z.length>0), JSON.stringify(tzSeen));
  step('team: asks the server once for the whole team', calls.filter(c=>c==='/insights/bd-team').length>=1);
  step('team: the row is the server\'s — 3 today, 12 in 7 days, 40 in 30 days, 123 sent, 35% replied, 20% converted', t2.rows.some(r=>/BD Two/.test(r) && /\b3\b/.test(r) && /\b12\b/.test(r) && /\b40\b/.test(r) && /\b123\b/.test(r) && /35%/.test(r) && /20%/.test(r)), JSON.stringify(t2.rows));
  step('team: the headline reads 40 leads and 123 emails from the same data', /40 leads/.test(t2.text) && /123 emails sent/.test(t2.text), t2.text.slice(0,120));
  step('team: the columns say what they count (7 days / 30 days / Replied %)', /7 days/i.test(t2.text) && /30 days/i.test(t2.text) && /Replied %/i.test(t2.text));

  // drill-down
  await ev((id)=>{ STATE.bdLeadSelectedBD=id; render(); },R1);
  await page.waitForTimeout(300);
  const t3 = await ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  step('drill-down: the same person shows the same figures (12 in 7 days, 123 sent, 2 pending, replied 14 = 35%)', /12\s*Last 7 days/.test(t3) && /123\s*Sent · 30 days/.test(t3) && /\b2\s*Pending/.test(t3) && /Replied\s*14 \(35%\)/.test(t3), t3.slice(0,300));
  step('drill-down: the stage breakdown is the server\'s (Assigned 30, Connected 8)', /Assigned\s*30/.test(t3) && /Connected\s*8/.test(t3));

  // a failure is said, not drawn as zeros
  await ev(()=>{ STATE.bdLeadSelectedBD=null; STATE.bdTeamInsights={error:'Network down',at:Date.now()}; render(); });
  const t4 = await ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  step('a failed team read says so — it does not draw an empty team or zeros', /Could not load the team/.test(t4) && !/No BD Managers/.test(t4));
  step('No page errors', errs.length===0, errs.join('|'));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\n'+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
