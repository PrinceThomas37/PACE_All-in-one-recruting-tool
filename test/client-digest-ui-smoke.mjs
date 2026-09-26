// D-0040/D-0043 — the client conversations card + the manager's facts-only
// team roll-up on the dashboard, in a real browser against a stub API.
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



let mode='full';
const DIGEST={ enabled:true, scope:'team',
  mine:[
    { kind:'lead', id:'j1', name:'Project Manager · Northwind Builders', state:'needs_reply', headline:"They asked a question 2 days ago. You haven't replied.", needs_you:true, promises_due:0,
      next_step:{ id:'reply', label:'Reply to their last email' }, summary_line:'Dana at Northwind asked for two profiles by Thursday.' },
    { kind:'lead', id:'j2', name:'Estimator · Acme', state:'awaiting_them', headline:'You replied 3 days ago · waiting on them.', needs_you:false, promises_due:0, next_step:null, summary_line:null },
  ],
  team:[ { owner_id:'u-raj', owner_name:'Raj', waiting:1, promises_due:1, items:[
    { kind:'lead', id:'j9', name:'HVAC Tech · Miller HVAC', state:'needs_reply', headline:'They replied today. No reply from us yet.', needs_you:true, promises_due:1 } ] } ] };
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
const calls=[];
async function api(route){
  const u=new URL(route.request().url()), p=decodeURIComponent(u.pathname), m=route.request().method();
  calls.push(m+' '+p);
  if (m==='GET' && p==='/client-intel/digest') return reply(route, mode==='off'?{enabled:false}:DIGEST);
  return reply(route, m==='GET'?[]:{});
}
let browser; const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  for (const width of [1440, 390]) {
    const ctx=await browser.newContext({viewport:{width,height:1100}});
    await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)) return api(r); return r.abort(); });
    const page=await ctx.newPage();
    page.on('pageerror',e=>pageErrors.push(String(e)));
    await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
    await waitForLogin(page); await enterApp(page,'bd');
    mode='full';
    await page.evaluate(()=>{ STATE.clientDigest=undefined; goPage('dashboard'); }); await page.waitForTimeout(700);
    const card=()=>page.evaluate(()=>{ const el=document.querySelector('#content .cd-card'); return el?el.innerText:null; });
    let t=await card();
    step(width+'px: your conversations, with state and next step', t && /Your client conversations/.test(t) && /Northwind/.test(t) && /Reply to their last email/.test(t), (t||'').slice(0,80));
    step(width+'px: your saved summary line shows on your own row', /asked for two profiles/.test(t));
    step(width+'px: the team section says whose and how many, facts only', /Your team.s conversations/.test(t) && /Raj/.test(t) && /1 waiting on Raj/.test(t) && /facts only/.test(t));
    const over=await page.evaluate(()=>{ const c=document.querySelector('#content .cd-card'); return c ? c.getBoundingClientRect().right > document.documentElement.clientWidth + 1 : true; });
    step(width+'px: the card fits the screen', !over);
    if(SHOTS) { const el=await page.$('#content .cd-card'); if(el) await el.screenshot({ path:path.join(SHOTS,'42-client-digest-'+width+'.png') }); }
    if (width===1440) {
      await page.evaluate(()=>clientDigestOpen('Project Manager · Northwind Builders')); await page.waitForTimeout(500);
      const st=await page.evaluate(()=>({ page:STATE.page, q:STATE.jobsFilter&&STATE.jobsFilter.search }));
      step('clicking a row opens Leads searched to that company', st.page==='leads' && st.q==='Northwind Builders', JSON.stringify(st));
      mode='off'; await page.evaluate(()=>{ STATE.clientDigest=undefined; goPage('dashboard'); }); await page.waitForTimeout(600);
      step('switched off → nothing drawn', (await card())===null);
    }
    await ctx.close();
  }
  step('no page errors', pageErrors.length===0, pageErrors.join(' | '));
} catch(e){ step('suite ran', false, e && e.stack || String(e)); }
finally { if(browser) await browser.close(); server.close(); }
const failed=results.filter(x=>!x).length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
