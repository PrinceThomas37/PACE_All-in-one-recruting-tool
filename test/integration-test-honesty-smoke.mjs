// R-030 — an integration card must say WHICH key its Test result is about.
// On 23 Sep the OpenRouter card read "✓ Key valid · 50 credits remaining"
// beside a "Not configured" badge: Test checks the key TYPED in the box, and
// that key had not been saved. Both halves were true; together they read as a
// contradiction. Real browser, stub API. Asserts the note appears for a typed,
// unsaved key, disappears after Save, and never appears when the SAVED key is
// the one tested.
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

let saved=false;
const item=()=>({ id:'openrouter', category:'AI', label:'OpenRouter (free tier)', description:'x', docs:'https://openrouter.ai/keys', verifier:false, ai:true, has_test:true,
  configured:saved, active_ai:false,
  fields:[{ key:'api_key', label:'API key', placeholder:'sk-or-…', configured:saved, hint:saved?'sk-o…abcd':null, value:null, secret:true, from_env:false },
          { key:'model', label:'Model (optional)', placeholder:'m', configured:false, hint:null, value:null, secret:false, optional:true, from_env:false }] });
const payload=()=>({ categories:[{ category:'AI', items:[item()] }], active_verifier:null, active_ai:null });
let lastTestBody=null;
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
async function api(route){
  const u=new URL(route.request().url()), p=decodeURIComponent(u.pathname), m=route.request().method();
  if (m==='GET' && p==='/admin/integrations') return reply(route, payload());
  // Budget card is not what this test is about; a failed load leaves it undrawn.
  if (m==='GET' && p==='/admin/ai-budget') return reply(route, { error:'not in this test' }, 500);
  if (m==='POST' && p==='/admin/integrations/openrouter/test') { lastTestBody=JSON.parse(route.request().postData()||'{}'); return reply(route, { ok:true, detail:'Key valid · 50 credits remaining' }); }
  if (m==='POST' && p==='/admin/integrations/openrouter') { saved=true; return reply(route, payload()); }
  return reply(route, m==='GET'?[]:{});
}
let browser; const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)) return api(r); return r.abort(); });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'admin');
  await page.evaluate(()=>openIntegrationsModal()); await page.waitForTimeout(500);
  // The OpenRouter card only: climb from its input to the nearest ancestor that
  // also holds its Test button (not a fixed nesting depth).
  const card = () => page.evaluate(()=>{ let c=document.getElementById('intg-openrouter-api_key'); while(c&&!(c.querySelector&&c.querySelector('[onclick*="testIntegration(\'openrouter\')"]')))c=c.parentElement; return c?c.innerText:null; });
  let t=await card();
  step('the OpenRouter card rendered (so the checks below mean something)', t && /OpenRouter/.test(t), String(t).slice(0,60));
  step('before saving, the badge says Not configured', /Not configured/.test(t));

  await page.fill('#intg-openrouter-api_key','sk-or-typed-but-not-saved');
  await page.evaluate(()=>testIntegration('openrouter')); await page.waitForTimeout(400);
  t=await card();
  const boxAfter = await page.inputValue('#intg-openrouter-api_key');
  step('the typed key is STILL in the box after Test (so Save can save it)', boxAfter==='sk-or-typed-but-not-saved', JSON.stringify(boxAfter));
  step('Test really sent the typed key', lastTestBody && lastTestBody.api_key==='sk-or-typed-but-not-saved');
  step('the result still says the key is valid', /Key valid/.test(t));
  step('…and says it is NOT SAVED YET, with what to do', /not saved yet/.test(t) && /Press Save to start using it/.test(t), t.replace(/\s+/g,' ').slice(0,200));
  if (SHOTS) { const el=await page.$('.modal'); if(el) await el.screenshot({ path: path.join(SHOTS,'44-intg-unsaved.png') }); }

  await page.evaluate(()=>saveIntegration('openrouter')); await page.waitForTimeout(400);
  t=await card();
  step('after Save the badge says Connected', /Connected/.test(t) && !/Not configured/.test(t));
  step('after Save the "not saved yet" note is gone', !/not saved yet/.test(t));

  // Testing the SAVED key (box empty) must never claim it is unsaved.
  await page.evaluate(()=>{ STATE._intgTest={}; renderIntegrationsModal(); });
  await page.fill('#intg-openrouter-api_key','');
  await page.evaluate(()=>testIntegration('openrouter')); await page.waitForTimeout(400);
  t=await card();
  step('testing the saved key sends no key from the page', lastTestBody && !lastTestBody.api_key);
  step('testing the saved key shows no "not saved" note', /Key valid/.test(t) && !/not saved yet/.test(t));

  // A DIFFERENT typed key while one is saved: say the saved one is still in use.
  await page.fill('#intg-openrouter-api_key','sk-or-another');
  await page.evaluate(()=>testIntegration('openrouter')); await page.waitForTimeout(400);
  t=await card();
  step('a new typed key beside a saved one says PACE still uses the saved one', /still using the saved one/.test(t));
  step('no page errors', pageErrors.length===0, pageErrors.join(' | '));
} catch(e){ step('test ran without throwing', false, String(e&&e.stack||e)); }
finally{ if(browser) await browser.close(); server.close(); }
const failed=results.filter(x=>!x).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
