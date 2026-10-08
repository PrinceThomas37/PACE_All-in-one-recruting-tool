// THE JOB-SOURCE KEY LIVES WITH THE OTHER KEYS, AND THE AI STATUS SHOWS ITS DETAIL ONCE (owner, 8 Oct 2026)
//   Two complaints from the same window, Admin → Integrations & API Keys:
//   "the JSearch key is in the wrong place — it should be in API and integrations, under Apollo" and
//   "there is a lot of information, it does not show once and go — it remains forever".
//   * the JSearch card is in that window, directly under Apollo's, with a password box; saving sends the key once, afterwards only
//     "••••1234" shows and the box is empty; Check my key and Disconnect work; an empty box is never sent
//   * a key typed into the box survives the window redrawing (opening the AI detail must not eat it)
//   * the AI status opens as ONE sentence — the models-and-errors lines are behind "Show details" — and a test you just ran opens
//     them once; opening the window again starts folded
// Usage: node test/integrations-jsearch-smoke.mjs   (SHOTS=dir keeps screenshots)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`, API = 'https://fute-lms-backend.onrender.com', SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }

const KEY = 'JS-KEY-ABCDEFGH1234';
let js = { connected:false, hint:null, used:1, limit:6, per_run:3 };
const calls = [];
const apollo = () => ({ id:'apollo', category:'Contact database', label:'Apollo.io', description:'people', docs:'x', verifier:false, ai:false, has_test:true, configured:true,
  fields:[{ key:'api_key', label:'API key', configured:true, hint:'••••••9999', value:null, secret:true, from_env:false }] });
const groq = () => ({ id:'groq', category:'AI', label:'Groq', description:'x', docs:'x', verifier:false, ai:true, has_test:true, configured:true, active_ai:true,
  fields:[{ key:'api_key', label:'API key', configured:true, hint:'••••••1111', value:null, secret:true, from_env:false }] });
const payload = () => ({ categories:[{ category:'AI', items:[groq()] }, { category:'Contact database', items:[apollo()] }], active_verifier:null, active_ai:'groq' });
const FAIL_ATTEMPT = { provider:'groq', model:'openai/gpt-oss-120b', ok:false, tier:'quality', error:'HTTP 429 — Rate limit reached for model', available_models:['llama-3.3-70b','whisper-large-v3'] };
const budget = () => ({ caps:{ tokens:100000, calls:500 }, spent:{ tokens:10, calls:1 }, features:[], provider_limits:[],
  last_test:{ at:'2026-10-07T15:20:00Z', working:false, attempts:[FAIL_ATTEMPT] },
  last_error:{ feature:'engine_first_email', at:'2026-10-07T15:26:00Z', failures:[{ provider:'groq', model:'openai/gpt-oss-120b', error:'HTTP 429 — Rate limit reached' }] } });
const reply = (route, body, status=200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) });
async function api(route){
  const u=new URL(route.request().url()), p=decodeURIComponent(u.pathname), m=route.request().method();
  let body=null; try{ body=JSON.parse(route.request().postData()||'null'); }catch(_){}
  calls.push([m,p,body]);
  if (m==='GET' && p==='/admin/integrations') return reply(route, payload());
  if (m==='GET' && p==='/admin/ai-budget') return reply(route, budget());
  if (m==='GET' && p==='/admin/apollo/usage') return reply(route, { used:3, limit:300, min:0, max:10000 });
  if (m==='GET' && p==='/finder/admin/jobsource') return reply(route, js);
  if (m==='PUT' && p==='/finder/admin/jobsource') { const k=String((body&&body.api_key)||''); js = { connected:!!k, hint:k?'••••••'+k.slice(-4):null, used:js.used, limit:js.limit, per_run:3 }; return reply(route, js); }
  if (m==='POST' && p==='/finder/admin/jobsource/test') { js.used += 1; return reply(route, { ok:true, text:'The key works (1 request used; 3 jobs came back).', used:js.used, limit:js.limit }); }
  if (m==='POST' && p==='/admin/integrations/ai-test') return reply(route, { configured:true, working:false, attempts:[Object.assign({}, FAIL_ATTEMPT, { error:'HTTP 429 — fresh test result' })], providers:[] });
  return reply(route, m==='GET'?[]:{});
}
let browser; const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1280,height:1000}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)) return api(r); return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>pageErrors.push(String(e))); page.on('dialog',d=>d.accept());
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'}); await waitForLogin(page); await enterApp(page,'admin');
  const text = () => page.evaluate(()=>{ const m=window.STATE&&window.STATE.modal; const d=document.createElement('div'); d.innerHTML=String(m||''); return d.innerText||d.textContent||''; });
  const open = async () => { await page.evaluate(()=>openIntegrationsModal()); await page.waitForTimeout(600); };
  await open();

  // ── where the card is
  const order = await page.evaluate(()=>{ const html=String(window.STATE.modal); return { apollo:html.indexOf('Apollo.io'), js:html.indexOf('Free job sources (JSearch)'), groq:html.indexOf('Groq') }; });
  step('the Free job sources card is in Integrations & API Keys, directly AFTER Apollo\'s card', order.apollo > -1 && order.js > order.apollo, JSON.stringify(order));
  const box = await page.evaluate(()=>{ const e=document.getElementById('intg-jsearch-api_key'); return e ? { type:e.type, ac:e.autocomplete, val:e.value } : null; });
  step('its key box is a password box that is never pre-filled', box && box.type==='password' && box.val==='', JSON.stringify(box));
  let t = await text();
  step('it says plainly that the key is the organisation\'s own and finds companies, not people; badge says Not configured', /organisation’s own/.test(t) && /not people/.test(t) && /Not configured/.test(await page.evaluate(()=>document.getElementById('intg-jsearch-card').innerText)));
  step('today\'s requests are shown (1 of 6)', /Used today:\s*1\s*of 6 requests/.test(await page.evaluate(()=>document.getElementById('intg-jsearch-card').innerText)));
  step('there is NO Check/Disconnect before a key exists', !/Check my key/.test(await page.evaluate(()=>document.getElementById('intg-jsearch-card').innerText)));

  // ── saving
  await page.fill('#intg-jsearch-api_key', '   ');
  await page.evaluate(()=>saveJsearchKey()); await page.waitForTimeout(200);
  step('an empty box is not sent', !calls.some(c=>c[0]==='PUT'));
  await page.fill('#intg-jsearch-api_key', KEY);
  await page.evaluate(()=>toggleAiDetail()); await page.waitForTimeout(150);   // a redraw of the whole window
  step('a key typed into the box survives the window redrawing', (await page.inputValue('#intg-jsearch-api_key')) === KEY);
  await page.evaluate(()=>saveJsearchKey()); await page.waitForTimeout(300);
  const put = calls.find(c=>c[0]==='PUT' && c[1]==='/finder/admin/jobsource');
  const cardTxt = await page.evaluate(()=>document.getElementById('intg-jsearch-card').innerText);
  step('Save sends the key once to the organisation\'s own endpoint', put && put[2].api_key===KEY && calls.filter(c=>c[0]==='PUT').length===1);
  step('afterwards the badge says Connected, only the last four characters show, and the box is empty', /Connected/.test(cardTxt) && !/Not configured/.test(cardTxt) && !(await text()).includes('ABCDEFGH') && (await page.inputValue('#intg-jsearch-api_key'))==='' && /1234/.test(await page.getAttribute('#intg-jsearch-api_key','placeholder')));
  step('Check my key and Disconnect now appear', /Check my key \(1 request\)/.test(cardTxt) && /Disconnect/.test(cardTxt));
  await page.evaluate(()=>testJsearchKey()); await page.waitForTimeout(300);
  const afterTest = await page.evaluate(()=>document.getElementById('intg-jsearch-card').innerText);
  step('Check my key calls the test, says in words that it works, and the day\'s count moves to 2', calls.some(c=>c[0]==='POST'&&c[1]==='/finder/admin/jobsource/test') && /The key works/.test(afterTest) && /Used today:\s*2\s*of 6/.test(afterTest), afterTest.replace(/\s+/g,' ').slice(-170));
  if (SHOTS) { const el = await page.$('#intg-jsearch-card'); if (el) await el.screenshot({ path: path.join(SHOTS,'jsearch-card.png') }); }
  await page.evaluate(()=>removeJsearchKey()); await page.waitForTimeout(300);
  const afterRm = await page.evaluate(()=>document.getElementById('intg-jsearch-card').innerText);
  step('Disconnect sends an empty key and the card goes back to Not configured', calls.some(c=>c[0]==='PUT' && c[2] && c[2].api_key==='') && /Not configured/.test(afterRm) && !/Check my key/.test(afterRm));

  // ── the AI status: one sentence, detail on request, shown once
  await open();
  t = await text();
  step('the AI status opens as ONE sentence: "AI IS NOT WORKING"', /AI IS NOT WORKING/.test(t));
  step('…and the long lines (the models on the account, each provider\'s words) are NOT on screen', !/Models on this account/.test(t) && !/Rate limit reached for model/.test(t) && !/Last time a feature actually asked/.test(t), t.length+' chars');
  step('…but a real failure is still named in the sentence (a feature fell back on 2026-10-07 15:26)', /A feature fell back to its built-in version on 2026-10-07 15:26 UTC/.test(t));
  step('…with a "Show details" link', /Show details/.test(t));
  await page.evaluate(()=>toggleAiDetail()); await page.waitForTimeout(150);
  t = await text();
  step('Show details opens the lines: the models that can write text and what the provider said', /Models on this account that can/.test(t) && /Rate limit reached for model/.test(t) && /Last time a feature actually asked/.test(t) && /Hide details/.test(t));
  await page.evaluate(()=>toggleAiDetail()); await page.waitForTimeout(150);
  step('Hide details folds them again', !/Models on this account/.test(await text()));
  await page.evaluate(()=>runAiHealthTest()); await page.waitForTimeout(500);
  t = await text();
  step('a test you just ran opens its detail once (the fresh answer is visible)', /fresh test result/.test(t));
  if (SHOTS) { const el = await page.$('.modal'); if (el) await el.screenshot({ path: path.join(SHOTS,'integrations-ai-open.png') }); }
  await open();
  t = await text();
  step('opening the window again starts folded — the detail does not stay forever', /AI IS NOT WORKING/.test(t) && !/fresh test result/.test(t) && !/Models on this account/.test(t));
  // A green verdict must not bury a real failure: the sentence still names it.
  await page.evaluate(()=>{ STATE.aiHealth={ configured:true, working:true, attempts:[{ provider:'groq', model:'m', ok:true, ms:300, sample:'ok', tier:'fast' }], providers:[] }; STATE._aiOpen=false; renderIntegrationsModal(); });
  await page.waitForTimeout(150);
  t = await text();
  step('even when a test says AI IS WORKING, the sentence still names the last time a real feature fell back', /AI IS WORKING/.test(t) && /A feature fell back to its built-in version on 2026-10-07 15:26 UTC/.test(t));
  step('the AI intro is two sentences, and the per-feature numbers are folded until asked for', /AI is optional: every feature has a built-in version/.test(t) && !/Per request/.test(t) && /Show the per-feature numbers/.test(t) && !/Loading|built-in non-AI version that runs when/.test(t));
  await page.evaluate(()=>toggleAiBudgetDetail()); await page.waitForTimeout(150);
  step('…and open when asked (and folded again on the next visit)', /Per request/.test(await text()) && (await open(), !/Per request/.test(await text())));
  step('no page errors', pageErrors.length===0, pageErrors.join(' | '));
} catch(e){ step('test ran without throwing', false, String(e&&e.stack||e)); }
finally{ if(browser) await browser.close(); server.close(); }
const failed=results.filter(x=>!x).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
