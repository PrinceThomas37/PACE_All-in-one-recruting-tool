// THE INSIGHTS SCREENS DRAW THE SERVER'S NUMBERS — THEY DO NO ARITHMETIC OF THEIR OWN
// (owner, 2026-09-30: "These numbers don't match up. The reports and insights … are not tuned
// and connected well.")
// Three screens (personal, team overview, team drill-down) used to add up leads and emails in the
// browser from partly-loaded lists. Now `GET /insights/bd/:id` and `GET /insights/bd-team` answer,
// both from services/bd-insights.js, and the screens only draw. Proven here by giving the BROWSER
// NO LEADS AND NO EMAILS AT ALL (STATE.jobs = [], STATE.sentEmails = []) and checking that every
// number on screen is still the server's — an old screen would show zeros.
// Since 19 Oct (D-0160, R-278) the PERSONAL view is sequence analytics from `GET /insights/outreach` (services/outreach-insights.js):
// five numbers said once, one chart, a row per sequence — the same rule holds: the browser draws the server's numbers only.
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
const summary = (o) => Object.assign({ total_all:110,total_today:0,total_week:85,total_month:110,assigned:100,positive:0,converted:6,negative:0,ooo:0,future:0,conv_rate:5,replied:11,reply_rate:10,response_rate:10,bounced:3,contacts_emailed:115,bounce_rate:2.6,open_tracked:0,opened:0,open_rate:null,
  emails_sent:311,emails_sent_today:16,emails_pending:1,emails_failed:0,
  last_7_emails:{[day(6)]:0,[day(5)]:40,[day(4)]:41,[day(3)]:42,[day(2)]:43,[day(1)]:40,[day(0)]:16},
  last_7_leads:{[day(6)]:0,[day(5)]:15,[day(4)]:0,[day(3)]:0,[day(2)]:22,[day(1)]:48,[day(0)]:0},
  by_stage:{Assigned:100,Connected:6,'In Discussion':0,Positive:0}, by_industry:{Construction:30} }, o||{});
const ME='u-lead', R1='u-bd2';
const TEAM = { scope:'team', windows:{}, people:[Object.assign({id:R1,name:'BD Two',role:'bd'}, summary({bounce_rate:5.5,open_rate:41.2,open_tracked:50,opened:20,total_all:40,total_today:3,total_week:12,total_month:40,converted:8,conv_rate:20,replied:14,reply_rate:35,emails_sent:123,emails_pending:2,by_stage:{Assigned:30,Connected:8,Negative:2}}))] };
const OUTREACH = { from:day(29), to:day(0), bucket:'day',
  totals:{ people:115, emailed:311, opened_rate:null, replied:11, replied_rate:9.6, interested:6, bounced_rate:2.6 },
  series:[6,5,4,3,2,1,0].map(n=>({ key:day(n), emailed:[0,40,41,42,43,40,16][6-n], opened:0, replied:[0,1,0,2,0,3,0][6-n] })),
  sequences:[{ id:'outreach', name:'Your outreach', people:115, emailed:311, opened_rate:null, replied:11, replied_rate:9.6, interested:6, bounced_rate:2.6, candidates:false }],
  choices:[{id:'all',name:'All sequences'},{id:'outreach',name:'Your outreach'}] };
const calls=[]; const rep=(r,b)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
let browser; const errs=[]; const tzSeen=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1300,height:1600}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)){ const p=new URL(u).pathname; calls.push(p); if(p.indexOf('/insights/')===0) tzSeen.push(new URL(u).searchParams.get('tz'));
    if(p==='/insights/bd/'+ME) return rep(r,summary()); if(p==='/insights/bd-team') return rep(r,TEAM); if(p==='/insights/outreach') return rep(r,OUTREACH); return rep(r,r.request().method()==='GET'?[]:{}); } return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,{id:ME,name:'BD Lead 1',role:'bd_lead',roles:['bd_lead']});
  const ev=(f,a)=>page.evaluate(f,a);
  // the browser knows NOTHING about leads or emails — only who reports to whom
  await ev((a)=>{ STATE.jobs=[]; STATE.sentEmails=[]; STATE.pendingEmails=[]; STATE.emails=[]; STATE.users=[{id:a.ME,name:'BD Lead 1',role:'bd_lead',roles:['bd_lead']},{id:a.R1,name:'BD Two',role:'bd',roles:['bd'],managerId:a.ME}]; STATE.page='bdinsights'; STATE.bdInsightsData=null; STATE.bdTeamInsights=null; render(); },{ME,R1});
  await page.waitForFunction(()=>/People emailed/.test(document.getElementById('content').innerText) && !/^—/.test(((document.querySelector('[data-oi-tiles] .oi-n')||{}).textContent)||'—'),null,{timeout:8000}).catch(()=>{});
  await page.waitForTimeout(300);
  const t1 = await ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  const nameNow = await ev(()=>({ title:(document.querySelector('#content .ptitle')||{}).textContent||'', rail:(document.getElementById('sidebar')||{}).innerText||'', bar:(document.getElementById('topbar')||{}).innerText||'' }));
  step('the page is called "Outreach Insights" (owner, 8 Oct) — heading, sidebar and top bar — and "Lead Insights" is gone', /Outreach Insights/.test(nameNow.title) && /Outreach Insights/.test(nameNow.rail) && !/Lead Insights/.test(nameNow.title+nameNow.rail+nameNow.bar), JSON.stringify(nameNow).slice(0,200));
  step('personal: people emailed is the server\'s 115 (311 emails) — with no emails in the browser at all', /115\s*People emailed\s*311 emails/i.test(t1), t1.slice(0,200));
  step('personal: replied is the REPLY rate (9.6%, 11 people), bounced to one decimal (2.6%)', /9\.6%\s*Replied\s*11 people/.test(t1) && /2\.6%\s*Bounced/.test(t1), (t1.match(/.{20}Replied.{30}/)||[''])[0]);
  step('personal: an open rate that could not be measured reads "—", never 0%', /\u2014\s*Opened/.test(t1) && !/\b0%\s*Opened/.test(t1));
  step('personal: the old repeated tiles are gone (no "Last 7 days", no "Response rate")', !/Last 7 days/.test(t1) && !/Response rate/.test(t1));
  step('personal: the chart and the table are the same answer (the 7 days drawn; Your outreach 311 emailed)', await ev(()=>document.querySelectorAll('svg.oi-chart .oi-hit').length===7) && /Your outreach\s*115\s*311/.test(t1));
  step('personal: it asked the server once for the whole page', calls.filter(c=>c==='/insights/outreach').length===1, JSON.stringify(calls.filter(c=>/insights/.test(c))));

  // ── R-319 (owner's 28 notes): zoom the Outreach chart by scroll / pinch / buttons, drag to move ──
  const zw = await ev(()=>({ in1:oiZoomWindow(30,null,0.5,0.5), left:oiZoomWindow(30,null,0,0.5), right:oiZoomWindow(30,null,1,0.5), keep:oiZoomWindow(30,{a:10,b:19},0.5,0.5), out:oiZoomWindow(30,{a:10,b:19},0.5,4), min:oiZoomWindow(30,{a:13,b:15},0.5,0.1), tiny:oiZoomWindow(30,{a:4,b:20},0.5,0.999), one:oiZoomWindow(1,null,0.5,0.5), pan:oiPanWindow(30,{a:10,b:19},0.5), panEnd:oiPanWindow(30,{a:1,b:10},0.9), panFar:oiPanWindow(30,{a:20,b:29},-0.9), panNone:oiPanWindow(30,null,0.5) }));
  step('zoom rule: half the days, centred on the middle; anchored on the left edge it stays at the start; on the right edge it stays at the end', zw.in1.b-zw.in1.a+1===15 && zw.left.a===0 && zw.right.b===29, JSON.stringify([zw.in1,zw.left,zw.right]));
  step('zoom rule: the day under the pointer stays inside the window; never fewer than 3 days; zooming all the way out is "no window" (null)', zw.keep.a<=14&&zw.keep.b>=14&&zw.keep.b-zw.keep.a+1===5 && zw.min.b-zw.min.a+1===3 && zw.out===null && zw.tiny.b-zw.tiny.a+1===16 && zw.one===null, JSON.stringify(zw));
  step('drag rule: dragging right shows EARLIER days, by whole days, and stops at either end of the data', zw.pan.a===6 && zw.pan.b===15 && zw.panEnd.a===0 && zw.panFar.b===29 && zw.panNone===null, JSON.stringify([zw.pan,zw.panEnd,zw.panFar]));
  step('zoom: at first the whole chart is drawn (7 points) with no "Show all" and the scroll-or-pinch hint', await ev(()=>document.querySelectorAll('svg.oi-chart .oi-hit').length===7 && !document.querySelector('.oi-zreset') && /Scroll or pinch the chart to zoom/.test(document.querySelector('.oi-zoombar').textContent)));
  await ev(()=>{ window.__oiTilesMark=document.querySelector('[data-oi-tiles]'); window.__oiTilesMark.__mark='same'; });
  const box = await ev(()=>{ const r=document.querySelector('svg.oi-chart').getBoundingClientRect(); return { x:r.left+r.width*0.5, y:r.top+r.height*0.5, w:r.width }; });
  await ev(()=>{ document.querySelector('svg.oi-chart').scrollIntoView({block:'center'}); });
  const box2 = await ev(()=>{ const r=document.querySelector('svg.oi-chart').getBoundingClientRect(); return { x:r.left+r.width*0.5, y:r.top+r.height*0.5, w:r.width }; });
  await page.mouse.move(box2.x, box2.y); await page.mouse.wheel(0,-240); await page.waitForTimeout(150);
  step('zoom: scrolling up over the chart zooms IN — fewer points, a "Show all" button, and the range named', await ev(()=>{ const n=document.querySelectorAll('svg.oi-chart .oi-hit').length; return n>=3 && n<7 && !!document.querySelector('.oi-zreset') && /→/.test(document.querySelector('.oi-zoombar').textContent); }));
  step('zoom: only the chart was redrawn — the tiles above it are the very same elements (no page repaint per wheel tick)', await ev(()=>document.querySelector('[data-oi-tiles]')===window.__oiTilesMark && window.__oiTilesMark.__mark==='same'));
  const zA = await ev(()=>STATE.oi.zoom.a);
  await page.mouse.down(); await page.mouse.move(box2.x+ box2.w*0.25, box2.y, {steps:6}); await page.mouse.up(); await page.waitForTimeout(150);
  const zB = await ev(()=>STATE.oi.zoom.a);
  step('zoom: dragging the chart to the right moves along to EARLIER days (window start '+zA+' → '+zB+')', zB<zA || zA===0);
  await ev(()=>{ render(); });
  step('zoom: a full page repaint keeps the zoom (the state is held, not just the picture)', await ev(()=>document.querySelectorAll('svg.oi-chart .oi-hit').length<7 && !!STATE.oi.zoom));
  const prevented = await ev(()=>{ const svg=document.querySelector('svg.oi-chart'); const e=new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true,clientX:svg.getBoundingClientRect().left+300,clientY:svg.getBoundingClientRect().top+100}); svg.dispatchEvent(e); return e.defaultPrevented; });
  step('zoom: a wheel that zooms is handled by the chart (the page does not scroll with it)', prevented === true);
  await ev(()=>{ oiZoomReset(); }); await page.waitForTimeout(100);
  const passThrough = await ev(()=>{ const svg=document.querySelector('svg.oi-chart'); const e=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true,clientX:svg.getBoundingClientRect().left+300,clientY:svg.getBoundingClientRect().top+100}); svg.dispatchEvent(e); return { prevented:e.defaultPrevented, zoom:STATE.oi.zoom }; });
  step('zoom: scrolling DOWN over the full chart does nothing to it and leaves the scroll to the page (it never traps the cursor)', passThrough.prevented === false && !passThrough.zoom);
  step('zoom: "Show all" brings back every point', await ev(()=>document.querySelectorAll('svg.oi-chart .oi-hit').length===7 && !document.querySelector('.oi-zreset')));
  await ev(()=>{ document.querySelector('.oi-zbtn[aria-label="Zoom in"]').click(); }); await page.waitForTimeout(120);
  const afterPlus = await ev(()=>document.querySelectorAll('svg.oi-chart .oi-hit').length);
  await ev(()=>{ document.querySelector('.oi-zbtn[aria-label="Zoom out"]').click(); }); await page.waitForTimeout(120);
  // a two-finger pinch on a touch screen (pointer events with two ids): fingers spreading apart zoom IN, coming together zoom OUT
  const pinch = await ev(()=>{
    oiZoomReset();
    return new Promise(res=>setTimeout(()=>{
      const r=document.querySelector('svg.oi-chart').getBoundingClientRect(), cy=r.top+r.height/2, cx=r.left+r.width/2;
      const fire=(type,id,x)=>document.querySelector('svg.oi-chart').dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',isPrimary:id===1,clientX:x,clientY:cy,bubbles:true,cancelable:true}));
      fire('pointerdown',1,cx-40); fire('pointerdown',2,cx+40);
      fire('pointermove',1,cx-200); fire('pointermove',2,cx+200);
      setTimeout(()=>{ const spread=STATE.oi.zoom?STATE.oi.zoom.b-STATE.oi.zoom.a+1:7;
        fire('pointermove',1,cx-30); fire('pointermove',2,cx+30);
        setTimeout(()=>{ const back=STATE.oi.zoom?STATE.oi.zoom.b-STATE.oi.zoom.a+1:7; fire('pointerup',1,cx); fire('pointerup',2,cx); res({spread,back}); },60);
      },60);
    },60));
  });
  step('zoom: a two-finger pinch — fingers apart zoom IN ('+pinch.spread+' days), fingers together zoom back OUT ('+pinch.back+' days)', pinch.spread<7 && pinch.back>pinch.spread);
  step('zoom: the + button zooms in and the − button back out, for people without a wheel or a pinch', afterPlus<7 && await ev(()=>document.querySelectorAll('svg.oi-chart .oi-hit').length===7));

  // team overview
  await ev(()=>{ STATE.bdInsightsView='team'; render(); });
  await page.waitForFunction(()=>/BD Two/.test(document.getElementById('content').innerText),null,{timeout:8000}).catch(()=>{});
  const t2 = await ev(()=>{ const rows=[...document.querySelectorAll('#content tbody tr')].map(r=>r.innerText.replace(/\s+/g,' ').trim()); return { rows, text:document.getElementById('content').innerText.replace(/\s+/g,' ') }; });
  step('the browser tells the server which time zone it is in (a day is the viewer\'s day, R-102)', tzSeen.length>=1 && tzSeen.every(z=>z && z.length>0), JSON.stringify(tzSeen));
  step('team: asks the server once for the whole team', calls.filter(c=>c==='/insights/bd-team').length>=1);
  step('team: the row is the server\'s — 3 today, 12 in 7 days, 40 in 30 days, 123 sent, 35% replied, 20% converted', t2.rows.some(r=>/BD Two/.test(r) && /\b3\b/.test(r) && /\b12\b/.test(r) && /\b40\b/.test(r) && /\b123\b/.test(r) && /35%/.test(r) && /20%/.test(r)), JSON.stringify(t2.rows));
  step('team: the table carries each person\'s bounce rate and open rate (5.5% and 41.2%) from the server', /Bounced %/.test(t2.text) && /Opened %/.test(t2.text) && t2.rows.some(r=>/BD Two/.test(r) && /5\.5%/.test(r) && /41\.2%/.test(r)), t2.rows[0]);
  step('team: the headline reads 40 leads and 123 emails from the same data', /40 leads/.test(t2.text) && /123 emails sent/.test(t2.text), t2.text.slice(0,120));
  step('team: the columns say what they count (7 days / 30 days / Replied %)', /7 days/i.test(t2.text) && /30 days/i.test(t2.text) && /Replied %/i.test(t2.text));

  // drill-down
  await ev((id)=>{ STATE.bdLeadSelectedBD=id; render(); },R1);
  await page.waitForTimeout(300);
  const t3 = await ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  step('drill-down: the same person shows the same figures (12 in 7 days, 123 sent, 2 pending, replied 14 = 35%)', /12\s*Last 7 days/.test(t3) && /123\s*Sent · 30 days/.test(t3) && /\b2\s*Pending/.test(t3) && /Replied\s*14 \(35%\)/.test(t3), t3.slice(0,300));
  step('drill-down: the same person shows 5.5% bounced and 41.2% opened', /5\.5%\s*Bounced/.test(t3) && /41\.2%\s*Opened/.test(t3), (t3.match(/.{20}Bounced.{40}/)||[''])[0]);
  step('drill-down: the stage breakdown is the server\'s (Assigned 30, Connected 8)', /Assigned\s*30/.test(t3) && /Connected\s*8/.test(t3));

  // a failure is said, not drawn as zeros
  await ev(()=>{ STATE.bdLeadSelectedBD=null; STATE.bdTeamInsights={error:'Network down',at:Date.now()}; render(); });
  const t4 = await ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  step('a failed team read says so — it does not draw an empty team or zeros', /Could not load the team/.test(t4) && !/No BD Managers/.test(t4));
  step('No page errors', errs.length===0, errs.join('|'));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\n'+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
