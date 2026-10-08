// DELIVERABILITY IS THE ADMIN'S, AND THE SPAM CHECK LIVES WHERE THE WORDING IS WRITTEN (owner, 8 Oct), in a real browser:
//   * the Deliverability tab is in the menu for an admin only — not a BD Lead, an RA Lead or a BD — and the page refuses them
//   * the page no longer carries "Reply rate by template" or the stand-alone spam checker, nor the Personal / My team toggle
//   * Email → Sequence → My wording has "Check for spam triggers": it checks the subject and body AS TYPED (saved or not), shows the
//     answer in its own box without repainting the editor, and says "write the email first" instead of checking nothing
// Usage: node test/deliverability-admin-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, switchRole, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':(MIME[path.extname(p)]||'application/octet-stream')+'; charset=utf-8'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1360,height:900}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{
    window.__calls=[];
    window.apiGet=(p)=>{ window.__calls.push(['GET',p]);
      if(/^\/admin\/deliverability/.test(p)) return Promise.resolve({ window_days:30, view:'org', can_org:true, sent:1934, failed:1, bounced_contacts:51, replied_contacts:23, suppression_count:10, mailboxes:[{ id:'m1', email:'a@x.test', name:'A', daily_limit:300, auto_paused:false, connection:{connected:true,status:'ok'}, warmup:null }] });
      if(/^\/warmup\/mailboxes/.test(p)) return Promise.resolve({ mailboxes:[], pool_count:0, readiness:null });
      if(/^\/admin\/domain-health/.test(p)) return Promise.resolve({ domains:[], checked:0 });
      return Promise.resolve([]); };
    window.apiPost=(p,b)=>{ window.__calls.push(['POST',p,b]);
      if(/spam-check/.test(p)) return Promise.resolve({ score:42, level:'warn', warnings:['Spam-trigger words: free, guarantee'] });
      return Promise.resolve({}); };
  });
  const nav=()=>ev(()=>[...document.querySelectorAll('#sidebar .nav-item')].map(e=>e.textContent.trim()));
  console.log('\nWho sees it');
  for (const role of ['bd','bd_lead','ra_lead','recruiter']) {
    await switchRole(page, role); await page.waitForTimeout(150);
    step(role+': no Deliverability in the menu', !(await nav()).some(n=>/Deliverability/.test(n)));
  }
  await ev(()=>{ STATE.page='deliverability'; render(); });
  step('…and if they get to the page anyway, it refuses them', /Forbidden/.test(await ev(()=>document.getElementById('content').innerText)));
  await switchRole(page,'admin'); await page.waitForTimeout(200);
  step('an admin has it in the menu', (await nav()).some(n=>/Deliverability/.test(n)));
  await ev(()=>{ STATE.page='deliverability'; STATE.deliv=undefined; render(); }); await page.waitForTimeout(500);
  const t=await ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  step('the admin sees the counters, mailbox health, warm-up and domain checks', /1934/.test(t) && /Mailbox health/i.test(t) && /Warm-up pool/i.test(t) && /Domain authentication/i.test(t), t.slice(0,160));
  step('…but no "Reply rate by template", no stand-alone spam checker, no Personal / My team toggle', !/Reply rate by template/i.test(t) && !/Spam-content checker/i.test(t) && !/My team/.test(t) && !/Personal/.test(t));
  step('…and the "Bounced" tile is honest: it counts invalid addresses', /Invalid addresses/i.test(t) && !/\bBounced\b/.test(t));
  step('the page does not ask for the template numbers any more', !(await ev(()=>window.__calls)).some(c=>/analytics\/templates/.test(c[1])));

  console.log('\nThe spam check, where the wording is written');
  await switchRole(page,'bd'); 
  await ev(()=>{ STATE.emailTab='sequence'; STATE.seqView='wording'; STATE.page='email'; render(); }); await page.waitForTimeout(500);
  step('"My wording" has a "Check for spam triggers" button', !!(await ev(()=>[...document.querySelectorAll('#content button')].find(b=>/Check for spam triggers/.test(b.textContent)))));
  await ev(()=>{ const s=document.querySelector('#content input[id*="subj" i]'), b=document.querySelector('#content textarea[id*="body" i]'); if(s) s.value=''; if(b) b.value=''; window.__calls.length=0; STATE.toasts=[]; [...document.querySelectorAll('#content button')].find(b=>/Check for spam triggers/.test(b.textContent)).click(); });
  await page.waitForTimeout(250);
  step('with nothing written it says to write the email first and asks the server nothing', !(await ev(()=>window.__calls)).some(c=>/spam-check/.test(c[1])) && (await ev(()=>STATE.toasts.map(t=>t.msg))).some(m=>/Write the email first/.test(m)));
  await ev(()=>{ const s=document.querySelector('#content input.inp[id*="subj" i], #content input[id*="subj" i]'); const b=document.querySelector('#content textarea[id*="body" i]'); if(s) s.value='FREE guarantee — act now'; if(b) b.value='Hi {{firstname}}, this is a free guarantee, unsaved yet.'; });
  await ev(()=>{ window.__calls.length=0; [...document.querySelectorAll('#content button')].find(b=>/Check for spam triggers/.test(b.textContent)).click(); });
  await page.waitForTimeout(400);
  const call=(await ev(()=>window.__calls)).find(c=>c[0]==='POST'&&/spam-check/.test(c[1]));
  step('it checks the subject and body AS TYPED (not the saved copy)', call && /FREE guarantee/.test(call[2].subject) && /unsaved yet/.test(call[2].body), JSON.stringify(call&&call[2]).slice(0,120));
  const box=await ev(()=>{ const e=document.querySelector('#seq-spam .seq-spam-box'); return e?e.innerText.replace(/\s+/g,' '):null; });
  step('the answer shows in its own box — score, level and the reasons', box && /42\/100/.test(box) && /warn/.test(box) && /free, guarantee/.test(box), box);
  step('…and the editor was not repainted (what was typed is still there)', /unsaved yet/.test(await ev(()=>document.querySelector('#content textarea[id*="body" i]').value)));
  step('no script errors', errs.length===0, errs.join(' | ').slice(0,300));
} catch(e){ console.error(e); step('ran to the end',false,String(e).slice(0,300)); }
finally{ if(browser) await browser.close(); server.close(); }
console.log('\nSUMMARY: '+results.filter(Boolean).length+'/'+results.length+' passed'); process.exit(results.every(Boolean)?0:1);
