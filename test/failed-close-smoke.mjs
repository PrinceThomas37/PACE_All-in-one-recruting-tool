// "DIDN'T SEND" CAN BE CLOSED (owner, 8 Oct): a failure that needs a person used to sit on the Pending page for ever. Each of the
// person's OWN failed emails now has Close (and Retry when the server says it may be retried), the header has "Close all", and a
// teammate's failed row — which a manager can SEE — has neither (acting is the sender's, D-0020). Closing deletes only the failed row
// (the server refuses anything else), sends nothing, and when the list is empty the whole panel is gone.
// Usage: node test/failed-close-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':(MIME[path.extname(p)]||'application/octet-stream')+'; charset=utf-8'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`; const SHOTS=process.env.SHOTS||'';
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  const ROWS=[
    { id:'f1', status:'failed', to_email:'rguy@joenguyco.co', fail_reason:'Not sent — this address is marked invalid.', retry_note:'Will not be retried — the address cannot receive this email', can_retry:false, is_mine:true, job:{ position:'Construction Superintendent', company:{ name:'Joe N. Guy Company, Inc.' } } },
    { id:'f2', status:'failed', to_email:'sam@x.com', fail_reason:'The mail service was busy.', can_retry:true, is_mine:true },
    { id:'f3', status:'failed', to_email:'team@x.com', fail_reason:'Mailbox signed out.', can_retry:true, is_mine:false, sender:{ name:'Bea' } },
  ];
  await ev((ROWS)=>{
    window.__calls=[]; window.__server=JSON.parse(JSON.stringify(ROWS));
    window.apiDelete=(u)=>{ window.__calls.push(['DELETE',u]); const id=u.split('/').pop(); window.__server=window.__server.filter(r=>r.id!==id); return Promise.resolve({success:true}); };
    window.apiPost=(u,b)=>{ window.__calls.push(['POST',u,b]); return Promise.resolve({}); };
    window.apiGet=(u)=>{ window.__calls.push(['GET',u]);
      if(/status=failed/.test(u)) return Promise.resolve(JSON.parse(JSON.stringify(window.__server)));
      if(/^\/emails(\?|$)/.test(u)) return Promise.resolve([]);
      return Promise.resolve([]); };
    STATE.pendingEmails=[]; STATE.failedEmails=JSON.parse(JSON.stringify(window.__server)); STATE.page='email'; STATE.emailTab='pending'; render();
  },ROWS);
  await page.waitForTimeout(500);
  const panel=()=>ev(()=>{ const p=document.querySelector('.failed-panel'); return p?p.innerText.replace(/\s+/g,' '):null; });
  const rows=()=>ev(()=>[...document.querySelectorAll('.failed-row')].map(r=>({ to:(r.querySelector('.failed-to')||{}).innerText||'', btns:[...r.querySelectorAll('button')].map(b=>b.textContent.trim()) })));
  let rs=await rows();
  step('three failed rows are listed', rs.length===3, JSON.stringify(rs));
  step('the invalid-address row (cannot be retried) offers Close only — the person can always close it', JSON.stringify(rs[0].btns)==='["Close"]', JSON.stringify(rs[0].btns));
  step('a retryable row of their own offers Retry and Close', JSON.stringify(rs[1].btns)==='["Retry","Close"]', JSON.stringify(rs[1].btns));
  step('a teammate\'s row (visible to a manager) offers neither — acting is the sender\'s', rs[2].btns.length===0, JSON.stringify(rs[2].btns));
  step('the header offers Retry all (1) and Close all', /Retry all \(1\)/.test(await panel()) && /Close all/.test(await panel()));
  if (SHOTS) { const el=await page.$('.failed-panel'); if(el) await el.screenshot({ path: path.join(SHOTS,'failed-close.png') }); }

  await ev(()=>{ window.__calls.length=0; [...document.querySelectorAll('.failed-row')][0].querySelector('button').click(); });
  await page.waitForTimeout(400);
  rs=await rows();
  step('Close on one row deletes THAT email (and nothing else is sent) and the row leaves the list', (await ev(()=>window.__calls)).some(c=>c[0]==='DELETE'&&c[1]==='/emails/f1') && !(await ev(()=>window.__calls)).some(c=>c[0]==='POST') && rs.length===2 && !rs.some(r=>/rguy@/.test(r.to)));
  await ev(()=>{ window.__calls.length=0; [...document.querySelectorAll('.failed-acts button')].find(b=>/Close all/.test(b.textContent)).click(); });
  await page.waitForTimeout(500);
  const dels=(await ev(()=>window.__calls)).filter(c=>c[0]==='DELETE').map(c=>c[1]);
  step('Close all closes only the person\'s OWN rows (never the teammate\'s)', JSON.stringify(dels)==='["/emails/f2"]', JSON.stringify(dels));
  rs=await rows();
  step('the teammate\'s row stays, with the panel', rs.length===1 && /team@x\.com/.test(rs[0].to) && !!(await panel()));
  await ev(()=>{ window.__server=[]; STATE.failedEmails=[]; render(); }); await page.waitForTimeout(200);
  step('when nothing is left to close the whole panel is gone', (await panel())===null);
  step('no script errors', errs.length===0, errs.join(' | ').slice(0,200));
} catch(e){ console.error(e); step('ran to the end',false,String(e).slice(0,300)); }
finally{ if(browser) await browser.close(); server.close(); }
console.log('\nSUMMARY: '+results.filter(Boolean).length+'/'+results.length+' passed'); process.exit(results.every(Boolean)?0:1);
