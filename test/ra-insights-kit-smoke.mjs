// THE RA / ADMIN INSIGHTS PAGE IS ON THE KIT (R-137, owner 6 Oct: "RA/Admin Insights page … still has the old look.
// Want me to restyle it next? — Yes").
// It was the last page built by hand: a blue gradient "top performer" banner, inline-styled stat boxes and a hand-rolled
// table. It now uses the parts Lead Insights uses — the stat strip, the "top performer" card, the kit table, bar rows,
// column charts and the pill toggle — and the numbers did not change. This drives its three views as an admin and the
// analyst's own page as an analyst, with the API answered by a fake server (the page must draw the SERVER's numbers).
// Usage: node test/ra-insights-kit-smoke.mjs
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
const RA_TEAM={ people:[
  { id:'ra1', name:'Asha Rao',  role:'ra', total:140, today:6, week:31, month:97, dups:4, assigned:120, assignPct:86, conv:12, convPct:9 },
  { id:'ra2', name:'Ben Cole',  role:'ra', total:60,  today:1, week:9,  month:22, dups:1, assigned:40,  assignPct:67, conv:3,  convPct:5 } ] };
const BD_TEAM={ scope:'team', people:[
  { id:'bd1', name:'Cy Dunn', role:'bd', total_all:80, total_today:2, total_week:14, total_month:51, converted:9, positive:7, emails_sent:210, replied:20, reply_rate:25, conv_rate:11 },
  { id:'bd2', name:'Di Fox',  role:'bd', total_all:30, total_today:0, total_week:3,  total_month:8,  converted:1, positive:2, emails_sent:40,  replied:2,  reply_rate:7,  conv_rate:3 } ] };
const RA_ONE={ total_today:6, total_week:31, total_month:97, duplicates:4,
  last_7_days:{[day(6)]:0,[day(5)]:10,[day(4)]:12,[day(3)]:9,[day(2)]:20,[day(1)]:25,[day(0)]:6},
  by_industry:{Construction:60,Logistics:30,Legal:7}, by_timezone:{EST:70,CST:27}, by_freshness:{Fresh:80,Old:17}, by_stage:{Assigned:90,Connected:7} };
const rep=(r,b)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1300,height:1500}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)){ const p=new URL(u).pathname;
      if(p==='/insights/ra-team') return rep(r,RA_TEAM); if(p==='/insights/bd-team') return rep(r,BD_TEAM); if(/^\/insights\/ra\//.test(p)) return rep(r,RA_ONE);
      return rep(r,r.request().method()==='GET'?[]:{}); } return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'admin');
  const ev=(f,a)=>page.evaluate(f,a);
  const text=()=>ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  const html=()=>ev(()=>document.getElementById('content').innerHTML);
  await ev(()=>{ STATE.users=[{id:'ra1',name:'Asha Rao',role:'ra',roles:['ra']},{id:'ra2',name:'Ben Cole',role:'ra',roles:['ra']}]; STATE.insightsTeam='ra'; STATE.insightsSelectedRA=null; STATE.raTeamInsights=null; STATE.bdTeamInsights=null; STATE.page='insights'; render(); });
  await page.waitForFunction(()=>/Asha Rao/.test(document.getElementById('content').innerText),null,{timeout:8000});
  await page.waitForTimeout(200);

  // ── the RA team ──
  let t=await text(), h=await html();
  step('RA team: the server\'s numbers are on the page (97 + 22 = 119 this month, 200 leads)', /200\s*Total leads/.test(t) && /119\s*Last 30 days/.test(t), t.slice(0,200));
  step('RA team: a stat strip, a "top performer" card and the kit table — no hand-built boxes', /class="strip"/.test(h) && /class="iv-top"/.test(h) && /dt-wrap/.test(h) && !/linear-gradient\(135deg,#1a3a6e/.test(h) && !/background:var\(--card\);border:1px solid var\(--border\)/.test(h));
  step('RA team: the top performer is Asha Rao (97 this month)', /top performer this month\s*Asha Rao/i.test(t) && /97\s*leads/.test(t));
  step('RA team: the Team switch is the same pill toggle as Lead Insights', (await ev(()=>[...document.querySelectorAll('#content .rep-fgroup .rep-pill')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')).join('|')))==='RA Team*|BD Team');

  // ── one analyst ──
  await ev(()=>{ [...document.querySelectorAll('#content tr[onclick]')].find(r=>/Ben Cole/.test(r.textContent)) ? 0 : 0; loadRAInsights('ra1'); });
  await page.waitForFunction(()=>/By timezone/.test(document.getElementById('content').innerText),null,{timeout:8000});
  await page.waitForTimeout(200);
  t=await text(); h=await html();
  step('one analyst: the strip says Today 6 · This week 31 · This month 97 · Duplicates 4', /6\s*Today/.test(t) && /31\s*This week/.test(t) && /97\s*This month/.test(t) && /4\s*Duplicates/.test(t), t.slice(0,160));
  step('one analyst: seven columns for the last 7 days, today in green', (await ev(()=>document.querySelectorAll('#content .rep-col').length))===7 && /rep-colbar tone-go/.test(h));
  step('one analyst: the four breakdowns are bar rows on cards (industry, timezone, freshness, stage)', (await ev(()=>document.querySelectorAll('#content .rep-card').length))===5 && (await ev(()=>document.querySelectorAll('#content .rep-row').length))>=8 && /EST/.test(t) && /Fresh/.test(t) && /Connected/.test(t));
  step('one analyst: a Back pill returns to the team', await ev(()=>{ const b=[...document.querySelectorAll('#content .rep-pill')].find(x=>/Team/.test(x.textContent)); if(!b) return false; b.click(); return true; }));
  await page.waitForTimeout(250);
  step('…and the team is back', /Total leads/.test(await text()));

  // ── the BD team (admin) ──
  await ev(()=>{ STATE.insightsTeam='bd'; STATE.insightsSelectedRA=null; render(); });
  await page.waitForFunction(()=>/BD Manager performance/.test(document.getElementById('content').innerText)&&/Cy Dunn/.test(document.getElementById('content').innerText),null,{timeout:8000});
  t=await text(); h=await html();
  step('BD team: totals are the server\'s (110 leads, 250 emails sent) and Cy Dunn tops it', /110\s*Total leads/.test(t) && /250\s*Emails sent/.test(t) && /top performer\s*Cy Dunn/i.test(t), t.slice(0,200));
  step('BD team: kit table and strip, no hand-built gradient banner', /class="strip"/.test(h) && /dt-wrap/.test(h) && !/linear-gradient\(135deg,#1a3a6e/.test(h));

  // ── an analyst on their own page: no team, no Back pill ──
  await ev((one)=>{ STATE.user=Object.assign({},STATE.user,{id:'ra1',role:'ra',roles:['ra']}); STATE.insightsSelectedRA=null; STATE.insightsData=one; STATE.page='insights'; render(); },RA_ONE);
  await page.waitForTimeout(250);
  t=await text();
  step('an analyst sees their OWN insights: "My Insights" or their name, the strip, and no team table or Back pill', /Insights/.test(t) && /97\s*This month/.test(t) && !/RA performance/.test(t) && (await ev(()=>!document.querySelector('#content .ph .rep-pill'))), t.slice(0,120));
} catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
step('No page errors', errs.length===0, errs.join('|').slice(0,300));
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
