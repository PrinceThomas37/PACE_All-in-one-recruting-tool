// EMAIL: MORE THAN ONE Cc (and To) ADDRESS, AS CHIPS (R-093, owner 2026-09-30).
// "Once one email is added into the CC row in email, there is no option to add another, if there is, how?"
// The box always took a comma list but nothing said so. Now each address is a removable chip:
//   * Enter / comma / semicolon / clicking away adds one; × removes one; Backspace on empty takes the last back;
//   * a pasted list becomes several chips; a repeat is not added twice;
//   * what is typed but not yet committed is still sent (Send flushes it);
//   * the server still gets "a@x.com, b@y.com" (same field names as before);
//   * a malformed address is shown as a warning chip, not silently dropped.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext(); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{ STATE.mailbox=STATE.mailbox||{}; STATE.mailbox.activeId='mb1'; STATE.mailbox.accounts=[{id:'mb1',email_address:'me@pace.test'}];
    window.__sent=null; window.apiPost=(u,b)=>{ window.__sent={u,b}; return Promise.resolve({success:true}); };
    mbCompose('first@a.com'); });
  const chips = (sel) => ev((s)=>[...document.querySelectorAll(s+' .chipf-c')].map(c=>c.getAttribute('data-a')), sel);
  const hidden = (id) => ev((i)=>document.getElementById(i).value, id);
  const ccBox = '[data-k="cc"]';
  step('the To address that was passed in is a chip, not loose text', JSON.stringify(await chips('[data-k="to"]'))==='["first@a.com"]');
  const cc = page.locator(ccBox+' .chipf-in');
  await cc.click(); await cc.type('one@x.com'); await cc.press('Enter');
  await cc.type('two@y.com'); await page.keyboard.type(',');
  await cc.type('three@z.com;');
  step('Enter, comma and semicolon each add a chip — three Cc addresses', JSON.stringify(await chips(ccBox))==='["one@x.com","two@y.com","three@z.com"]', JSON.stringify(await chips(ccBox)));
  step('the form value is the comma list the server expects', await hidden('mb-c-cc')==='one@x.com, two@y.com, three@z.com', await hidden('mb-c-cc'));
  await cc.type('one@x.com'); await cc.press('Enter');
  step('the same address is not added twice', (await chips(ccBox)).length===3);
  await page.locator(ccBox+' .chipf-c[data-a="two@y.com"] button').click();
  step('× removes just that address', JSON.stringify(await chips(ccBox))==='["one@x.com","three@z.com"]');
  await cc.click(); await cc.press('Backspace');
  step('Backspace on an empty box takes the last one back', JSON.stringify(await chips(ccBox))==='["one@x.com"]');
  await cc.fill('p@q.com, r@s.com; t@u.com'); await cc.dispatchEvent('input');
  step('a pasted list becomes separate chips', (await chips(ccBox)).length===4, JSON.stringify(await chips(ccBox)));
  await cc.type('notanemail'); await cc.press('Enter');
  step('a malformed address is shown as a warning chip, not dropped', await ev(()=>!!document.querySelector('[data-k="cc"] .chipf-c.bad')));
  await page.locator(ccBox+' .chipf-c[data-a="notanemail"] button').click();
  // type but do NOT commit, then fill subject/body and press Send
  await cc.type('late@v.com');
  await ev(()=>{ document.getElementById('mb-c-subject').value='Hi'; mbComposeField('subject','Hi'); document.getElementById('mb-c-body').value='Body'; mbComposeField('body','Body'); });
  step('flushing commits what was typed but not yet added', await ev(()=>{ mbChipFlush(); return document.getElementById('mb-c-cc').value.includes('late@v.com'); }));
  await cc.type('last@w.com');
  await ev(()=>{ window.__flushed=0; const f=window.mbChipFlush; window.mbChipFlush=function(){ window.__flushed++; return f.apply(this,arguments); }; });
  await ev(()=>mbSendCompose());
  step('Send flushes the pending address first (a send can never lose a last keystroke)', await ev(()=>window.__flushed>=1));
  await page.waitForTimeout(200);
  const sent = await ev(()=>window.__sent);
  step('Send includes an address that was typed but not yet committed', !!sent && /last@w\.com/.test(sent.b.cc||''), JSON.stringify(sent&&sent.b));
  step('the server gets one comma-separated Cc and the To', !!sent && sent.b.cc==='one@x.com, p@q.com, r@s.com, t@u.com, late@v.com, last@w.com' && /first@a\.com/.test(sent.b.to), JSON.stringify(sent&&sent.b));
  step('No page errors', errs.length===0, errs.join('|'));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
