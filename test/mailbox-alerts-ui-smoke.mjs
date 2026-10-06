// R-037 — the mailbox sign-in warning on the dashboard, in a real browser at
// desktop and phone width, against a stub API. SHOTS=<dir> writes screenshots.
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


let mode='alerts';
const ALERTS=[
  { mailbox_id:'mb1', email:'bd@example.test', platform:'microsoft', state:'failed', since:new Date(Date.now()-3*86400000).toISOString(), held:12, is_owner:true, owner_name:'Test BD',
    sentence:"Microsoft withdrew PACE's permission to use this mailbox — reconnect it and accept the permission again." },
  { mailbox_id:'mb2', email:'raj@example.test', platform:'gmail', state:'probably_expired', since:new Date(Date.now()-2*86400000).toISOString(), held:0, is_owner:false, owner_name:'Raj',
    sentence:"This mailbox's sign-in has not renewed when it should have — it has probably expired. Reconnect it to be sure." },
];
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
const calls=[];
const hiddenIds=new Set(); const bodies=[];
async function api(route){
  const u=new URL(route.request().url()), p=decodeURIComponent(u.pathname), m=route.request().method();
  calls.push(m+' '+p);
  if (m==='POST') { let b={}; try{ b=route.request().postDataJSON()||{}; }catch(e){} bodies.push({p,b}); }
  if (m==='POST' && p==='/mailboxes/alerts/hide') { hiddenIds.add(bodies[bodies.length-1].b.mailbox_id); return reply(route,{success:true}); }
  if (m==='POST' && p==='/mailboxes/alerts/show') { hiddenIds.clear(); return reply(route,{success:true}); }
  if (m==='GET' && p==='/mailboxes/alerts') {
    if (mode==='error') return reply(route,{error:'x'},500);
    const list = mode==='alerts' ? ALERTS.filter(a=>!hiddenIds.has(a.mailbox_id)) : [];
    return reply(route,{ alerts:list, hidden: mode==='alerts' ? ALERTS.length-list.length : 0, scope:'team' });
  }
  return reply(route, m==='GET'?[]:{});
}
let browser; const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  for (const width of [1440, 390]) {
    const ctx=await browser.newContext({viewport:{width,height:900}});
    await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)) return api(r); return r.abort(); });
    const page=await ctx.newPage();
    page.on('pageerror',e=>pageErrors.push(String(e)));
    await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
    await waitForLogin(page); await enterApp(page,'bd');
    mode='alerts';
    await page.evaluate(()=>{ STATE.mailboxAlerts=undefined; goPage('dashboard'); }); await page.waitForTimeout(700);
    const card=()=>page.evaluate(()=>{ const el=document.querySelector('#content .mba-card'); return el?el.innerText:null; });
    let t=await card();
    step(width+'px: the dashboard warns about the dead mailbox', t && /2 mailboxes can.t send/.test(t) && /bd@example.test/.test(t) && /12 emails waiting/.test(t), (t||'').slice(0,90));
    step(width+'px: the owner gets Reconnect; a manager gets "Remind Raj" (a task on Raj\'s list)', /Reconnect/.test(t) && /Remind Raj/.test(t) && !/Remind Test/.test(t), t.slice(0,300));
    step(width+'px: every warning can be hidden for a week', (t.match(/Hide for a week/g)||[]).length===2);
    step(width+'px: a guess is labelled "probably"', /PROBABLY|probably/.test(t));
    const over=await page.evaluate(()=>{ const c=document.querySelector('#content .mba-card'); return c ? c.getBoundingClientRect().right > document.documentElement.clientWidth + 1 : true; });
    step(width+'px: the card fits the screen', !over);
    if(SHOTS) await page.screenshot({ path:path.join(SHOTS,'41-mailbox-alert-'+width+'.png') });
    if (width===1440) {
      // Hide one: it leaves, is COUNTED, and Show brings it back.
      await page.evaluate(()=>{ document.querySelector('#content .mba-row .btn-outline').click(); }); await page.waitForTimeout(600);
      t=await card();
      step('hiding one warning is a request to the server, for that mailbox', bodies.some(x=>x.p==='/mailboxes/alerts/hide' && x.b.mailbox_id==='mb1'));
      step('a hidden warning leaves the card and is COUNTED', t && !/bd@example.test/.test(t) && /1 mailbox warning hidden for a week/.test(t) && /raj@example.test/.test(t), (t||'').slice(0,200));
      await page.evaluate(()=>{ document.querySelector('#content .mba-hidden a').click(); }); await page.waitForTimeout(600);
      t=await card();
      step('Show brings it back', t && /bd@example.test/.test(t) && !/hidden for a week/.test(t));
      // Remind: a manager puts a task on the OWNER's list.
      await page.evaluate(()=>{ [...document.querySelectorAll('#content .mba-row .btn-primary')].find(b=>/Remind/.test(b.textContent)).click(); }); await page.waitForTimeout(500);
      step('"Remind Raj" asks the server about THAT mailbox', calls.includes('POST /mailboxes/alerts/mb2/ask'));
      // Everything hidden: only the quiet count remains — never a blank gap with no explanation.
      hiddenIds.add('mb1'); hiddenIds.add('mb2');
      await page.evaluate(()=>loadMailboxAlerts(true)); await page.waitForTimeout(500);
      const quiet=await page.evaluate(()=>{ const el=document.querySelector('#content .mba-hidden'); return el?el.innerText:null; });
      step('with everything hidden, one quiet line says how many', quiet && /2 mailbox warnings hidden/.test(quiet), quiet||'');
      hiddenIds.clear();
      await page.evaluate(()=>loadMailboxAlerts(true)); await page.waitForTimeout(400);
      mode='none'; await page.evaluate(()=>loadMailboxAlerts(true)); await page.waitForTimeout(400);
      step('all mailboxes fine → nothing drawn at all', (await card())===null);
      mode='error'; await page.evaluate(()=>loadMailboxAlerts(true)); await page.waitForTimeout(400);
      t=await card();
      step('a failed check says so, never looks like "all fine"', t && /Could not check/.test(t));
      const before=calls.filter(c=>c==='GET /mailboxes/alerts').length;
      await page.evaluate(()=>{ render(); scheduleRender(); }); await page.waitForTimeout(3000);
      step('it is not polled — idle time and repaints fetch nothing more', calls.filter(c=>c==='GET /mailboxes/alerts').length===before, String(before));
    }
    await ctx.close();
  }
  step('no page errors', pageErrors.length===0, pageErrors.join(' | '));
} catch(e){ step('suite ran', false, e && e.stack || String(e)); }
finally { if(browser) await browser.close(); server.close(); }
const failed=results.filter(x=>!x).length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
