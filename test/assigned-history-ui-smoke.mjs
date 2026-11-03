// WHO ASSIGNED A LEAD — what the person SEES in a lead's history (R-340, owner 3 Nov 2026: "it should come in lead history").
// The entries are produced by the server's own mapper (services/record-history.js) from activity rows written the way each assignment path
// writes them, then drawn by the real history panel in a real browser: the line says Assigned, the sentence says who gave it to whom, and the
// giver is named. Usage: node test/assigned-history-ui-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const H = require('../services/record-history.js'); const lc = require('../services/lead-claim.js');
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return undefined; }
const rows = [
  { created_at: '2026-11-03T12:00:00Z', action_type: 'assigned', description: lc.assignmentSentence({ by: 'Prince Thomas', to: 'Sam Wilson' }), user: { name: 'Prince Thomas' } },
  { created_at: '2026-11-03T11:00:00Z', action_type: 'self_assigned', description: 'Taken from the pool by Alex BD', user: { name: 'Alex BD' } },
  { created_at: '2026-11-03T10:00:00Z', action_type: 'first_email_claim', description: "Became Neil Patrick's lead when the first email was written", user: { name: 'Neil Patrick' } },
];
const entries = rows.map(H.fromActivityLog);
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1200,height:900}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'admin');
  await page.evaluate((entries)=>{ window.apiFetch=(m,p)=>Promise.resolve({ title:'Nurse · Acme', entries }); window.openRewind('lead','J1'); }, entries);
  await page.waitForSelector('.rw-list .rw-row',{timeout:5000});
  const rowsText=await page.evaluate(()=>[...document.querySelectorAll('.rw-row')].map(r=>r.innerText.replace(/\s+/g,' ').trim()));
  step('a hand-out shows who gave it to whom, and names the giver', /Assigned/.test(rowsText[0]) && /Assigned to Sam Wilson by Prince Thomas/.test(rowsText[0]) && /Prince Thomas/.test(rowsText[0]), rowsText[0]);
  step('a lead taken from the pool says who took it', /Taken from the pool by Alex BD/.test(rowsText[1]), rowsText[1]);
  step('a first-email claim says whose lead it became', /Became Neil Patrick's lead/.test(rowsText[2]), rowsText[2]);
  const count=(t,needle)=>t.split(needle).length-1;
  step('each sentence is printed ONCE per line (it used to repeat for pool takes and claims)', count(rowsText[1],'Taken from the pool by Alex BD')===1 && count(rowsText[2],"Became Neil Patrick's lead")===1 && count(rowsText[0],'Assigned to Sam Wilson by Prince Thomas')===1, rowsText.join(' || '));
  step('three assignments, three lines, newest first', rowsText.length===3 && /12:00|Nov/.test(rowsText[0]) , String(rowsText.length));
  step('no script errors', errs.length===0, errs.join(' | ').slice(0,300));
} catch(e){ console.error(e); step('ran to the end',false,String(e).slice(0,300)); }
finally{ if(browser) await browser.close(); server.close(); }
console.log('\nSUMMARY: '+results.filter(Boolean).length+'/'+results.length+' passed'); process.exit(results.every(Boolean)?0:1);
