// "FROM" ON EVERY WINDOW THAT SENDS, AND THE INTERVIEW CONFIRMATION DEFAULT (R-087, R-086).
//
// Owner: "For any email that goes out there should be an option to choose from
// email ID." and "the interview confirmation email should go with job details" —
// even for a phone interview. The server rules are in from-mailbox-smoke; this is
// the SCREEN half, in a real browser:
//   * the client email window, the interview block of the stage window and the
//     generator's sender card each offer the caller's own mailboxes;
//   * choosing one sends `mailbox_id`; leaving the default sends none (so the
//     server keeps its own default);
//   * one mailbox is a plain "From x" (one option is not a choice), none says to
//     connect one;
//   * an interview move ticks "Candidate" by default, so the confirmation goes
//     unless somebody unticks it — phone interviews included;
//   * changing who the generator sends as clears its draft (the wording names the
//     sender — the Session 14 bug where a body named one person over another's From).
//
// Every probe that cannot take its measurement FAILS — a missing node is never a pass.
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
const TWO = { mailboxes:[{ id:'mb1', email:'me@ours.com', display_name:'Me One', platform:'Microsoft', is_primary:true }, { id:'mb2', email:'me@gmail.test', display_name:'Me Two', platform:'Gmail', is_primary:false }], default_id:'mb1' };
let mailboxAnswer = TWO;
const calls=[];
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
async function api(route){
  const req=route.request(); const u=new URL(req.url()); const p=u.pathname, m=req.method();
  let body=null; try{ body=req.postDataJSON(); }catch(_){}
  calls.push({ m, p, q:u.search, body });
  if (m==='GET' && p==='/me/sending-mailboxes') return reply(route, mailboxAnswer);
  if (m==='GET' && p==='/clients') return reply(route, [{ id:'co1', name:'Griffith Energy', industry:'Construction', job_order_count:1, open_job_order_count:1, can_edit:true }]);
  if (m==='GET' && p==='/outreach/sender') return reply(route, { mailboxes:TWO.mailboxes, company_name:'Acme Staffing', ai:false,
    mailbox: u.searchParams.get('mailbox_id')==='mb2' ? TWO.mailboxes[1] : TWO.mailboxes[0], sender:{ name:u.searchParams.get('mailbox_id')==='mb2'?'Me Two':'Me One' }, signature_html:'' });
  if (m==='POST' && p==='/submissions/s1/interview-invite') return reply(route, { sent:1 });
  if (m==='PATCH' && /\/stage$/.test(p)) return reply(route, { id:'s1', stage:'Interview Scheduled' });
  if (m==='POST' && p==='/companies/co1/email') return reply(route, { sent:true });
  return reply(route, m==='GET' ? [] : {});
}

let browser;
const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)) return api(r); return r.abort(); });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd_lead');
  const ev=(fn,arg)=>page.evaluate(fn,arg);
  const last = (m,re) => calls.filter(c=>c.m===m && re.test(c.p)).slice(-1)[0];
  const resetFrom = async (answer) => { mailboxAnswer=answer; await ev(()=>{ STATE.sendingMailboxes={ loaded:false, loading:false, list:[], default_id:null, error:false }; FromPick.refresh(); }); };

  // ═══ 1. the client email window ═════════════════════════════════════════
  await ev(()=>{ STATE.clients=STATE.clients||{}; STATE.clients.list=[{ id:'co1', name:'Griffith Energy' }]; STATE.clients.contacts=[{ name:'Sam', email:'sam@griffith.test' }]; goPage('clients'); });
  await page.waitForTimeout(500);
  await ev(()=>clientsOpenEmail('co1'));
  await page.waitForSelector('#client-em-from-sel',{timeout:5000}).catch(()=>{});
  const opts = await ev(()=>[...document.querySelectorAll('#client-em-from-sel option')].map(o=>({ v:o.value, sel:o.selected, t:o.textContent })));
  step('Client email: a From picker lists my two mailboxes, the default selected', opts.length===2 && opts[0].v==='mb1' && opts[0].sel && /Me Two/.test(opts[1].t) && /Gmail/.test(opts[1].t), JSON.stringify(opts.map(o=>o.v)));
  await page.selectOption('#client-em-from-sel','mb2');
  await ev(()=>clientsSendEmail());
  await page.waitForTimeout(300);
  let sent = last('POST',/^\/companies\/co1\/email$/);
  step('Client email: choosing a mailbox sends its id (the server checks it is mine)', !!sent && sent.body.mailbox_id==='mb2', JSON.stringify(sent&&sent.body));
  await ev(()=>clientsOpenEmail('co1')); await page.waitForSelector('#client-em-from-sel',{timeout:5000}).catch(()=>{});
  await ev(()=>clientsSendEmail()); await page.waitForTimeout(300);
  sent = last('POST',/^\/companies\/co1\/email$/);
  step('Client email: leaving the default sends NO mailbox id (the server keeps its own default)', !!sent && sent.body.mailbox_id===undefined, JSON.stringify(sent&&sent.body));

  // one mailbox, none
  await resetFrom({ mailboxes:[TWO.mailboxes[0]], default_id:'mb1' });
  await ev(()=>clientsOpenEmail('co1')); await page.waitForSelector('.from-one',{timeout:5000}).catch(()=>{});
  const one = await ev(()=>({ text:(document.getElementById('client-em-from')||{}).innerText, sel:!!document.getElementById('client-em-from-sel') }));
  step('One mailbox is shown plainly, not as a choice', /From\s+me@ours\.com/.test(one.text||'') && !one.sel, JSON.stringify(one));
  await resetFrom({ mailboxes:[], default_id:null });
  await ev(()=>clientsOpenEmail('co1')); await page.waitForSelector('.from-none',{timeout:5000}).catch(()=>{});
  const none = await ev(()=>(document.getElementById('client-em-from')||{}).innerText);
  step('No mailbox connected says so, before anything is written', /No mailbox connected/.test(none||''), none);
  await ev(()=>closeModal());

  // ═══ 2. the interview block of the stage window ══════════════════════════
  await resetFrom(TWO);
  await ev(()=>{ STATE.user.role='bd'; STATE.user.roles=['bd']; STATE.bd=STATE.bd||{}; STATE.bd.submissions=[{ id:'s1', stage:'Submitted to Client', job_order_id:'j1', candidate:{ id:'c1', full_name:'Sarah Chen', email:'sarah@x.test' } }]; openStageModal('s1','Interview Scheduled',null); });
  await page.waitForSelector('#stg-iv-from-sel',{timeout:5000}).catch(()=>{});
  const iv = await ev(()=>({ cand:document.getElementById('stg-iv-notify-cand').checked, bd:document.getElementById('stg-iv-notify-bd').checked, opts:[...document.querySelectorAll('#stg-iv-from-sel option')].map(o=>o.value) }));
  step('Interview: "Candidate" is ticked by default — the confirmation goes unless somebody unticks it', iv.cand===true && iv.bd===false);
  step('Interview: the block offers a From picker', iv.opts.length===2, JSON.stringify(iv.opts));
  await page.selectOption('#stg-iv-type','phone');
  await ev(()=>stgIvTypeToggle());
  await page.fill('#stg-iv-at','2026-10-05T10:00'); await page.fill('#stg-iv-phone-num','+1 555 010 0000');
  await page.selectOption('#stg-iv-from-sel','mb2');
  await page.fill('#stg-note','Phone screen booked');
  await ev(()=>stgApply()); await page.waitForTimeout(500);
  const inv = last('POST',/^\/submissions\/s1\/interview-invite$/);
  step('Interview (PHONE): the candidate is emailed, from the chosen mailbox', !!inv && inv.body.recipients.includes('candidate') && inv.body.mailbox_id==='mb2', JSON.stringify(inv&&inv.body));

  // ═══ 3. the generator ═══════════════════════════════════════════════════
  await ev(()=>{ STATE.outreachGen=null; STATE.composeSide='clients'; STATE.emailTab='compose'; STATE.page='email'; render(); });
  await page.waitForSelector('#og-from',{timeout:6000}).catch(()=>{});
  const og0 = await ev(()=>({ has:!!document.getElementById('og-from'), val:(document.getElementById('og-from')||{}).value }));
  step('Generator: the sender card offers the choice, on my default', og0.has && og0.val==='mb1', JSON.stringify(og0));
  await ev(()=>{ STATE.outreachGen.draft={ subject:'Hi', email:'Hello, I am Me One.', variants:[] }; render(); });
  await page.selectOption('#og-from','mb2'); await page.waitForTimeout(500);
  const og1 = await ev(()=>({ draft:!!STATE.outreachGen.draft, err:STATE.outreachGen.error, mb:STATE.outreachGen.form.mailbox_id, name:(STATE.outreachGen.sender&&STATE.outreachGen.sender.sender&&STATE.outreachGen.sender.sender.name)||'' }));
  step('Generator: changing who it sends as clears the draft (its wording names the sender) and says why', !og1.draft && /cleared/.test(og1.err||'') && og1.mb==='mb2', JSON.stringify(og1));
  step('Generator: the sender identity is re-read for THAT mailbox', !!calls.find(c=>c.m==='GET'&&c.p==='/outreach/sender'&&/mailbox_id=mb2/.test(c.q)) && og1.name==='Me Two');

  step('No page errors', pageErrors.length===0, pageErrors.slice(0,2).join(' | '));
}catch(e){
  console.log('[FAIL] run crashed — '+(e&&e.stack||e)); results.push(false);
}finally{
  if(browser) await browser.close();
  server.close();
}
const pass=results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass===results.length && results.length>0 ? 0 : 1);
