// THE × BESIDE THE LEADS SEARCH BOX CLEARS THE SEARCH (owner, 2026-09-28:
// "The cross button do not work").
//
// It was "Clear all filters": it cleared stage/industry/date but not the typed
// search, and it was drawn switched off (.off → pointer-events:none) whenever a
// search was the only thing active. So with a search typed — or one filled in
// by the "Your client conversations" card — the × did nothing.
//
// Clicked with a REAL mouse (page.mouse at the element's centre). An
// element.click() from script ignores pointer-events:none and would pass on the
// broken code — the exact vacuous guard this repo keeps finding.
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

const NOW = Date.now(), D = 86400000;
const raw = [
  ['j1','Cost Manager','Saylor Consulting Group','Michael','Mills','mmills@saylorconsulting.com'],
  ['j2','Project Engineer','Northwind Builders','Dana','Ruiz','dana@northwind.test'],
  ['j3','Estimator','Acme Builders','John','Carter','jcarter@acmebuild.com'],
].map(([id,pos,co,fn,ln,em],i)=>({ id, position:pos, company:{ name:co, industry:'Construction' }, company_id:'co'+i,
  location:'Austin, TX', stage:'Assigned', assigned_to_bd:'test-bd', bd_assignee:{ name:'Test BD' }, industry:'Construction',
  created_at:new Date(NOW-(i+1)*D).toISOString(), assigned_at:new Date(NOW-(i+1)*D).toISOString(),
  contacts:[{ id:'c'+i, job_id:id, first_name:fn, last_name:ln, email:em, designation:'Director', is_primary:true, email_status:'valid' }] }));

let browser; const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  await ctx.route('**',r=>{ const u=r.request().url();
    if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)) { const p=new URL(u).pathname; return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(p==='/jobs'?raw:(r.request().method()==='GET'?[]:{})) }); }
    return r.abort(); });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd');
  await page.evaluate((raw)=>{ STATE.jobs=raw.map(normaliseJob); STATE.contacts=flattenContacts(raw); STATE.leads=STATE.jobs; STATE.page='leads'; render(); }, raw);
  await page.waitForTimeout(300);

  const rowsShown = () => page.evaluate(()=>document.querySelectorAll('#content tr[data-row-id]').length);
  const X = '#content .tbar-ico[title="Clear search and filters"]';
  // A real click: move the mouse to the ×'s centre and press. Returns what the
  // browser says is under the pointer there, so a switched-off × is visible.
  async function realClick(sel){
    const box = await page.evaluate((sel)=>{ const el=document.querySelector(sel); if(!el) return null;
      const r=el.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; }, sel);
    if (!box) return { found:false };
    const hit = await page.evaluate(({x,y,sel})=>{ const t=document.elementFromPoint(x,y), el=document.querySelector(sel); return !!(t && el && (t===el || el.contains(t))); }, { x:box.x, y:box.y, sel });
    await page.mouse.click(box.x, box.y);
    return { found:true, hit };
  }

  step('all three leads show to begin with', await rowsShown() === 3, String(await rowsShown()));
  // Type a search the way a person does.
  await page.click('#content .tbar-search input');
  await page.keyboard.type('mmills@saylorconsulting.com');
  await page.waitForTimeout(400);
  step('typing a search narrows the list to one lead', await rowsShown() === 1, String(await rowsShown()));
  const xOff = await page.evaluate((X)=>{ const el=document.querySelector(X); return el ? el.classList.contains('off') : null; }, X);
  step('with only a search typed, the × is switched ON', xOff === false, String(xOff));
  const c1 = await realClick(X);
  await page.waitForTimeout(400);
  step('a real mouse click reaches the ×', c1.found && c1.hit, JSON.stringify(c1));
  const after = await page.evaluate(()=>{ const i=document.querySelector('#content .tbar-search input'); return { value: i ? i.value : null, state: STATE.jobsFilter.search }; });
  step('the click clears the search box', after.value === '' && after.state === '', JSON.stringify(after));
  step('…and every lead is back', await rowsShown() === 3, String(await rowsShown()));
  const offAgain = await page.evaluate((X)=>{ const el=document.querySelector(X); return el ? el.classList.contains('off') : null; }, X);
  step('with nothing to clear, the × goes quiet again', offAgain === true, String(offAgain));

  // The "Your client conversations" card fills the search in for you.
  await page.evaluate(()=>{ STATE.jobsFilter.search='Northwind'; STATE.leadsPage=0; render(); });
  await page.waitForTimeout(300);
  step('a search filled in by another screen narrows the list too', await rowsShown() === 1, String(await rowsShown()));
  const c2 = await realClick(X);
  await page.waitForTimeout(400);
  step('…and the × clears that one as well', c2.hit && await rowsShown() === 3, JSON.stringify(c2) + ' rows=' + await rowsShown());

  // Filters and a search together: one click clears both.
  await page.evaluate(()=>{ STATE.jobsFilter.search='Acme'; STATE.jobsFilter.stages=['Assigned']; STATE.leadsPage=0; render(); });
  await page.waitForTimeout(300);
  await realClick(X);
  await page.waitForTimeout(400);
  const both = await page.evaluate(()=>({ q: STATE.jobsFilter.search, stages: (STATE.jobsFilter.stages||[]).length }));
  step('with a filter and a search, one click clears both', both.q === '' && both.stages === 0 && await rowsShown() === 3, JSON.stringify(both));
  step('nothing threw', pageErrors.length===0, pageErrors.slice(0,2).join(' | '));
} catch (e) {
  step('the run reached its end', false, String(e && e.message || e).slice(0,200));
} finally {
  if (browser) await browser.close();
  server.close();
}
const failed=results.filter(r=>!r).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
