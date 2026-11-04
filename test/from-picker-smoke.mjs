// "FROM" ON EVERY WINDOW THAT SENDS, AND THE INTERVIEW CONFIRMATION DEFAULT (R-087, R-086).
//
// Owner: "For any email that goes out there should be an option to choose from
// email ID." and "the interview confirmation email should go with job details" —
// even for a phone interview. The server rules are in from-mailbox-smoke; this is
// the SCREEN half, in a real browser:
//   * the client email window, the interview block of the stage window and the
//     generator's sender card each offer the caller's own mailboxes;
//   * choosing one sends `mailbox_id`; leaving the default sends the default's id
//     too — what is shown is what sends (owner, 2 Nov 2026: "random email ID");
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
let badSenderId = null;      // R-394: which mailbox the server says has an expired sign-in
const calls=[];
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
async function api(route){
  const req=route.request(); const u=new URL(req.url()); const p=u.pathname, m=req.method();
  let body=null; try{ body=req.postDataJSON(); }catch(_){}
  calls.push({ m, p, q:u.search, body });
  if (m==='GET' && p==='/me/sending-mailboxes') return reply(route, mailboxAnswer);
  if (m==='GET' && p==='/clients') return reply(route, [{ id:'co1', name:'Griffith Energy', industry:'Construction', job_order_count:1, open_job_order_count:1, can_edit:true }]);
  if (m==='GET' && p==='/outreach/sender') return reply(route, { mailboxes:TWO.mailboxes.map(x=>Object.assign({}, x, { needs_reconnect: x.id===badSenderId })), company_name:'Acme Staffing', ai:false,
    mailbox: u.searchParams.get('mailbox_id')==='mb2' ? TWO.mailboxes[1] : TWO.mailboxes[0], sender:{ name:u.searchParams.get('mailbox_id')==='mb2'?'Me Two':'Me One' },
    signature_html: u.searchParams.get('mailbox_id')==='mb2' ? '' : '<p>Warm regards,<br>Me One</p>' });
  if (m==='GET' && /^\/users\/[^/]+\/emails$/.test(p)) return reply(route, [{ id:'mb1', email_address:'me@ours.com', display_name:'Me One', platform:'Microsoft', is_active:true, connection:{ connected:true }, has_own_signature:true, sends_as:{ company:'Acme', title:'BD', address:'1 Main Street 12345', phone:'', website:'' } }]);
  if (m==='POST' && p==='/submissions/s1/interview-invite') return reply(route, { sent:1 });
  if (m==='PATCH' && /\/stage$/.test(p)) return reply(route, { id:'s1', stage:'Interview Scheduled' });
  // R-388: the email window asks the server for THIS client's contacts (it no longer reads the open record's list)
  if (m==='GET' && p==='/companies/co1/email-contacts') return reply(route, { contacts:[{ name:'Sam', email:'sam@griffith.test', designation:'Buyer' }], attach_job_id:'j1' });
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
  await ev(()=>{ STATE.clients=STATE.clients||{}; STATE.clients.list=[{ id:'co1', name:'Griffith Energy' }]; STATE.clients.contacts=null; goPage('clients'); });
  await page.waitForTimeout(500);
  await ev(()=>clientsOpenEmail('co1'));
  await page.waitForSelector('#client-em-from-sel',{timeout:5000}).catch(()=>{});
  const opts = await ev(()=>[...document.querySelectorAll('#client-em-from-sel option')].map(o=>({ v:o.value, sel:o.selected, t:o.textContent })));
  step('Client email: the To picker lists the client\'s contacts from the server, even with no record open', await ev(()=>[...document.querySelectorAll('#client-em-poc option')].some(o=>o.value==='sam@griffith.test')) && await ev(()=>document.getElementById('client-em-to').value)==='sam@griffith.test');
  step('Client email: a From picker lists my two mailboxes, the default selected', opts.length===2 && opts[0].v==='mb1' && opts[0].sel && /Me Two/.test(opts[1].t) && /Gmail/.test(opts[1].t), JSON.stringify(opts.map(o=>o.v)));
  await page.selectOption('#client-em-from-sel','mb2');
  await ev(()=>clientsSendEmail());
  await page.waitForTimeout(300);
  let sent = last('POST',/^\/companies\/co1\/email$/);
  step('Client email: choosing a mailbox sends its id (the server checks it is mine)', !!sent && sent.body.mailbox_id==='mb2', JSON.stringify(sent&&sent.body));
  await ev(()=>clientsOpenEmail('co1')); await page.waitForSelector('#client-em-from-sel',{timeout:5000}).catch(()=>{});
  await ev(()=>clientsSendEmail()); await page.waitForTimeout(300);
  sent = last('POST',/^\/companies\/co1\/email$/);
  // Owner, 2 Nov 2026: interview mail went "from a random email ID". Sending nothing for the shown default let the server
  // choose again (with no primary, in the database's own order) — so what is SHOWN is now what is SENT.
  step('Client email: leaving the default sends THAT mailbox\'s id (what is shown is what sends)', !!sent && sent.body.mailbox_id==='mb1', JSON.stringify(sent&&sent.body));
  // R-388: a person who is not in the list — the email goes to the typed address, THEN they are saved on the client's lead
  await ev(()=>clientsOpenEmail('co1')); await page.waitForSelector('#client-em-newname',{timeout:5000}).catch(()=>{});
  const nc0 = calls.length;
  await page.fill('#client-em-newname','Pat Quinn'); await page.fill('#client-em-newemail','pat@griffith.test');
  await ev(()=>clientsSendEmail()); await page.waitForTimeout(500);
  const after = calls.slice(nc0);
  const iMail = after.findIndex(c=>c.m==='POST'&&c.p==='/companies/co1/email'), iSave = after.findIndex(c=>c.m==='POST'&&c.p==='/contacts');
  step('Client email: a new contact is emailed at the typed address and then saved on the client\'s lead', iMail>=0 && after[iMail].body.to==='pat@griffith.test' && iSave>iMail && after[iSave].body.job_id==='j1' && after[iSave].body.first_name==='Pat' && after[iSave].body.last_name==='Quinn' && after[iSave].body.email==='pat@griffith.test', JSON.stringify(after.map(c=>c.m+' '+c.p)));
  await ev(()=>clientsOpenEmail('co1')); await page.waitForSelector('#client-em-newname',{timeout:5000}).catch(()=>{});
  const nc1 = calls.length;
  await page.fill('#client-em-newemail','x@griffith.test'); await ev(()=>clientsSendEmail()); await page.waitForTimeout(300);
  step('Client email: a new email without a name is refused, nothing is sent', !calls.slice(nc1).some(c=>c.m==='POST'));

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
  // The same window, the default left alone: the shown mailbox's id still goes (owner, 2 Nov 2026).
  await ev(()=>{ STATE.bd.submissions=[{ id:'s1', stage:'Submitted to Client', job_order_id:'j1', candidate:{ id:'c1', full_name:'Sarah Chen', email:'sarah@x.test' } }]; openStageModal('s1','Interview Scheduled',null); });
  await page.waitForSelector('#stg-iv-from-sel',{timeout:5000}).catch(()=>{});
  const ivShown = await ev(()=>(document.getElementById('stg-iv-from-sel')||{}).value);
  await page.fill('#stg-iv-at','2026-10-05T10:00'); await page.fill('#stg-note','Booked');
  const before = calls.length;
  await ev(()=>stgApply()); await page.waitForTimeout(500);
  const inv2 = calls.slice(before).filter(c=>c.m==='POST' && /^\/submissions\/s1\/interview-invite$/.test(c.p)).pop();
  step('Interview: leaving the shown mailbox sends ITS id, never "let the server choose"', ivShown==='mb1' && !!inv2 && inv2.body.mailbox_id==='mb1', JSON.stringify({ shown:ivShown, body:inv2&&inv2.body }));

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
  // ── R-394: the BATCH ("N emails / Send all") used to name no mailbox, so the server chose — and chose one Google had rejected ──
  await ev(()=>{ window.__batch = () => { const g=STATE.outreachGen; g.batch=[{ person:{ email:'kev@x.test', first_name:'Kev', title:'TA' }, status:'ready', subject:'Hi Kev', email:'Hello', error:null }]; render(); }; });
  await ev(()=>{ STATE.outreachGen.form.mailbox_id='mb2'; window.__batch(); });
  const nb0 = calls.length; await ev(()=>ogcSend(0)); await page.waitForTimeout(500);
  const bsend = calls.slice(nb0).find(c=>c.m==='POST'&&c.p==='/outreach/send');
  step('Batch: Send names the mailbox chosen in the From box (it used to name none)', !!bsend && bsend.body.mailbox_id==='mb2', JSON.stringify(bsend&&bsend.body));
  await ev(()=>{ window.__batch(); });
  await page.selectOption('#og-from','mb1'); await page.waitForTimeout(500);
  const bclr = await ev(()=>({ batch:STATE.outreachGen.batch, err:STATE.outreachGen.error }));
  step('Batch: changing who it sends as clears the written emails (each names its sender) and says why', bclr.batch===null && /cleared/.test(bclr.err||''), JSON.stringify(bclr));
  // an expired sign-in is shown, marked, and cannot be picked
  badSenderId = 'mb2';
  await ev(()=>{ STATE.outreachGen=null; STATE.composeSide='clients'; STATE.emailTab='compose'; STATE.page='email'; render(); });
  await page.waitForSelector('#og-from',{timeout:6000}).catch(()=>{});
  const exp = await ev(()=>[...document.querySelectorAll('#og-from option')].map(o=>({ v:o.value, t:o.textContent, d:o.disabled, s:o.selected })));
  step('Expired mailbox: shown with "sign-in expired", disabled, and the default is the working one', exp.length===2 && exp.find(o=>o.v==='mb2').d===true && /sign-in expired/.test(exp.find(o=>o.v==='mb2').t) && exp.find(o=>o.v==='mb1').s===true && !exp.find(o=>o.v==='mb1').d, JSON.stringify(exp));
  badSenderId = null;
  // ── R-396: create the lead by default (a box), and the signature preview with a way to edit it ──
  await ev(()=>{ STATE.outreachGen=null; STATE.composeSide='clients'; STATE.emailTab='compose'; STATE.page='email'; render(); });
  await page.waitForSelector('#og-from',{timeout:6000}).catch(()=>{});
  await ev(()=>{ const g=STATE.outreachGen; g.recipMode='company'; g.sequences=[{ id:'q1', name:'My seq', steps:3 }]; g.sequenceId=''; g.form.job_description='The posting'; g.form.company='Acme Co';
    STATE.outreachGen.co=STATE.outreachGen.co||{}; window.__batch(); });
  await page.waitForTimeout(400);
  const box = await ev(()=>{ const c=document.querySelector('.ogc-lead input'); return { has:!!c, on:!!(c&&c.checked) }; });
  step('Lead box: there is a box, TICKED by default ("create the lead for that user by default")', box.has && box.on, JSON.stringify(box));
  const nl0 = calls.length; await ev(()=>ogcSend(0)); await page.waitForTimeout(500);
  const ls = calls.slice(nl0).find(c=>c.m==='POST'&&c.p==='/outreach/send');
  step('…the send carries create_lead:true and the posting', !!ls && ls.body.create_lead===true && ls.body.job_description==='The posting', JSON.stringify(ls&&ls.body));
  await ev(()=>{ window.__batch(); });
  await page.uncheck('.ogc-lead input'); await page.waitForTimeout(200);
  const nl1 = calls.length; await ev(()=>ogcSend(0)); await page.waitForTimeout(500);
  const ls2 = calls.slice(nl1).find(c=>c.m==='POST'&&c.p==='/outreach/send');
  step('…unticked, the send says create_lead:false (the person is in control)', !!ls2 && ls2.body.create_lead===false, JSON.stringify(ls2&&ls2.body.create_lead));
  await ev(()=>{ STATE.outreachGen.sequenceId='q1'; window.__batch(); });
  step('…with a sequence chosen there is no box (the sequence always creates the lead) — nothing that changes nothing', (await ev(()=>!document.querySelector('.ogc-lead input') && /created as part of the sequence/.test(document.querySelector('#content').textContent))));
  await ev(()=>{ STATE.outreachGen.sequenceId=''; render(); });
  // signature preview
  const sg = await ev(()=>({ prev:(document.querySelector('.ogc-sig-prev')||{}).textContent||'', btn:(document.querySelector('.ogc-sigbox button')||{}).textContent||'' }));
  step('Signature: the batch shows the signature the chosen mailbox will add, with an Edit button', /Warm regards/.test(sg.prev) && /Edit signature/.test(sg.btn), JSON.stringify(sg));
  await page.selectOption('#og-from','mb2'); await page.waitForTimeout(500);
  await ev(()=>{ STATE.outreachGen.recipMode='company'; window.__batch(); }); await page.waitForTimeout(300);
  const sg2 = await ev(()=>({ prev:!!document.querySelector('.ogc-sig-prev'), txt:(document.querySelector('.ogc-sigbox')||{}).textContent||'' }));
  step('…choosing a mailbox with NO signature says so and offers "Set up signature" (not an empty gap)', !sg2.prev && /no signature yet/.test(sg2.txt) && /Set up signature/.test(sg2.txt), JSON.stringify(sg2));
  await page.selectOption('#og-from','mb1'); await page.waitForTimeout(500);
  await ev(()=>{ window.__batch(); }); await page.waitForTimeout(300);
  const ne = calls.length; await ev(()=>outreachGenEditSignature()); await page.waitForTimeout(600);
  const ed = await ev(()=>({ modal:!!STATE.modal }));
  step('Signature: Edit opens the editor (after asking for the person\'s mailboxes)', ed.modal && calls.slice(ne).some(c=>c.m==='GET'&&/^\/users\/[^/]+\/emails$/.test(c.p)), JSON.stringify(ed));
  // the REAL editor's Save (My Setup's), not a direct call: the two files must really be connected
  const ns = calls.length; await ev(()=>mySetupSave()); await page.waitForTimeout(700);
  const afterSave = calls.slice(ns);
  step('…saving in the editor stores it, and the Compose preview is then asked for again (the two screens are connected)', afterSave.some(c=>c.m==='PUT'&&/\/sends-as$/.test(c.p)) && afterSave.some(c=>c.m==='GET'&&c.p==='/outreach/sender'), JSON.stringify(afterSave.map(c=>c.m+' '+c.p)));
  // ── R-395: with no sequence of your own, the batch SAYS so and offers to create one (it used to show nothing) ──
  await ev(()=>{ STATE.outreachGen.recipMode='company'; window.__batch(); STATE.outreachGen.sequences=[]; render(); });
  const noSeq = await ev(()=>({ txt:(document.querySelector('.ogc-draft-h')||{}).parentElement ? document.querySelector('#content').textContent : '', btn:!!document.querySelector('button[onclick="outreachCreateSequence()"]') }));
  step('No sequence of your own: the batch says so and offers "Create your first sequence"', /no sequence of your own yet/.test(noSeq.txt) && noSeq.btn, JSON.stringify({ btn:noSeq.btn }));
  await ev(()=>{ STATE.outreachGen.sequences=undefined; render(); });
  step('…and while the list has not loaded it says nothing (no false "you have none")', !(await ev(()=>/no sequence of your own yet/.test(document.querySelector('#content').textContent))));
  await ev(()=>{ STATE.outreachGen.sequences=[]; render(); });
  await page.click('button[onclick="outreachCreateSequence()"]'); await page.waitForTimeout(300);
  step('…the button takes you to Email → Sequence to make it', (await ev(()=>({ p:STATE.page, t:STATE.emailTab }))).t==='sequence');

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
