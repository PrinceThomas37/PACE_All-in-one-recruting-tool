// THE EMAIL PAGE HAS NO "SENT" TAB — "ALL EMAIL" SHOWS BOTH WAYS (owner, 6 Oct), in a real browser:
//   * the tab strip is Pending · Compose · All email · …  (no Sent), and an old link to 'sent' lands on All email
//   * All · Received · Sent buttons with honest counts; Received asks the server for direction=in
//   * a received row names the sender and the mailbox it reached; clicking shows the stored copy
//   * "Read the full email" fetches the whole message through the lead's endpoint, shows it in place, toggles
//   * a received row with no way to open it offers no such button
//   * the kind-of-send buttons appear only under Sent
// Usage: node test/all-email-ui-smoke.mjs
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
  const SENT={source:'leads',direction:'out',id:'e1',to_email:'ceo@client.com',from_email:'bd@x.com',subject:'Estimators for your Dallas job',body:'Hi Sam, we have two estimators.',status:'sent',sent_at:new Date().toISOString()};
  const GOT={source:'replies',direction:'in',id:'in:r1',to_email:'bd@x.com',from_email:'ceo@client.com',subject:'Re: Estimators for your Dallas job',body:'Yes please send them over.',status:'received',sent_at:new Date().toISOString(),job_id:'J1',can_open_full:true};
  const GOT2={source:'replies',direction:'in',id:'in:r2',to_email:'bd@x.com',from_email:'cand@gmail.com',subject:'Interested',body:'Call me.',status:'received',sent_at:new Date().toISOString(),job_id:null,can_open_full:false};
  await ev(([SENT,GOT,GOT2])=>{
    window.__calls=[];
    window.apiGet=(u)=>{ window.__calls.push(u);
      if(/^\/email\/history/.test(u)){
        const dir=(u.match(/direction=(\w+)/)||[])[1]||'';
        const items=dir==='in'?[GOT,GOT2]:dir==='out'?[SENT]:[GOT,SENT,GOT2];
        return Promise.resolve({items,counts:{hidden:0},page:0,page_size:25,pages:1,horizon_days:90,by_source:{leads:1,individual:0,candidates:0,replies:2}}); }
      if(/\/intel\/messages\/.*\/full/.test(u)) return Promise.resolve({text:'FULL TEXT of the reply, with the whole thread'});
      return Promise.resolve([]); };
    STATE.allMail=null; STATE.pendingEmails=[]; STATE.page='email'; STATE.emailTab='sent'; render();
  },[SENT,GOT,GOT2]);
  await page.waitForTimeout(500);
  const tabs=()=>ev(()=>[...document.querySelectorAll('#content .pgtab')].map(b=>b.textContent.trim().replace(/\s+/g,' ')));
  const t=await tabs();
  step('there is no "Sent" tab', t.length>0 && !t.some(x=>/^sent\b/i.test(x)), JSON.stringify(t));
  step('an old "sent" tab lands on All email', await ev(()=>STATE.emailTab==='allmail') && await ev(()=>/Received/.test(document.getElementById('content').innerText)));
  const txt=()=>ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  let x=await txt();
  step('All · Received · Sent buttons with counts (All 3, Received 2, Sent 1)', /All\s*3/.test(x) && /Received\s*2/.test(x) && /Sent\s*1/.test(x), x.slice(0,200));
  step('the list has both what went out and what came back', /Estimators for your Dallas job/.test(x) && /Re: Estimators/.test(x));
  step('a received row names the sender and the mailbox it reached', /ceo@client\.com to bd@x\.com/.test(x), '');
  step('the kind-of-send buttons are NOT shown under "All"', !/Every kind/.test(x));

  await ev(()=>amDirection('in')); await page.waitForTimeout(300);
  step('Received asks the server for direction=in and shows only replies', await ev(()=>__calls.some(c=>/direction=in/.test(c))) && !/Estimators for your Dallas job(?! )/.test('') && (await ev(()=>document.querySelectorAll('.am-row').length))===2);
  await ev(()=>amDirection('out')); await page.waitForTimeout(300);
  x=await txt();
  step('Sent shows only what went out, and now offers the kind-of-send buttons', (await ev(()=>document.querySelectorAll('.am-row').length))===1 && /Every kind/.test(x) && /Lead outreach/.test(x));
  await ev(()=>amDirection('in')); await page.waitForTimeout(300);

  await ev(()=>document.querySelector('.am-head').click()); await page.waitForTimeout(150);
  step('opening a received row shows the stored copy', /Yes please send them over/.test(await txt()));
  step('…with a "Read the full email" button', await ev(()=>!!document.querySelector('.am-fulllink')));
  if(SHOTS){ fs.mkdirSync(SHOTS,{recursive:true}); await page.screenshot({path:path.join(SHOTS,'all-email-received.png')}); }
  await ev(()=>document.querySelector('.am-fulllink').click()); await page.waitForTimeout(300);
  step('clicking it fetches the whole message through the lead\'s endpoint (J1, the in:r1 message) and shows it in place', await ev(()=>__calls.some(c=>/\/leads\/J1\/intel\/messages\/in%3Ar1\/full/.test(c))) && /FULL TEXT of the reply/.test(await txt()));
  await ev(()=>document.querySelector('.am-fulllink').click()); await page.waitForTimeout(200);
  step('…and clicking again hides it (no second fetch)', !/FULL TEXT of the reply/.test(await txt()) && (await ev(()=>__calls.filter(c=>/full/.test(c)).length))===1);
  await ev(()=>amToggle('in:r1')); await ev(()=>document.querySelectorAll('.am-head')[1].click()); await page.waitForTimeout(150);
  step('a reply with no way to open it offers no "Read the full email" button', !(await ev(()=>!!document.querySelector('.am-fulllink'))), '');
  step('No page errors', errs.length===0, errs.join('|').slice(0,300));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
