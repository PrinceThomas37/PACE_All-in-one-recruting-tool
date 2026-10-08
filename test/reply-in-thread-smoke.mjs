// "REPLY" OPENS THAT EMAIL, AND A FOLLOW-UP GOES AS A REPLY IN THE SAME CONVERSATION (owner, 8 Oct), in a real browser:
//   * "Reply in the mailbox" (the conversation window, and the Needs-you-today row) opens THE email they wrote, in the mailbox it
//     arrived in, with the reply window already open and addressed to them — not the mailbox searched to their name
//   * "Write the email" when WE wrote last opens OUR last email with the reply window addressed to who we wrote to (not to ourselves),
//     so the follow-up lands in the same thread — it never silently drops the person on the lead
//   * when the exact email cannot be found or opened the person is told in words and lands somewhere useful
// The mailbox itself is stubbed at window.apiGet/apiPost; which email a button answers is the server's call (reply-target-smoke).
// Usage: node test/reply-in-thread-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
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

  const T_IN  = { message_id:'AAMk-in1',  mailbox_id:'mb1', direction:'inbound',  other_email:'steve@rr.com', other_name:'Steve Moskowitz', subject:'Automatic reply' };
  const T_OUT = { message_id:'AAMk-out1', mailbox_id:'mb1', direction:'outbound', other_email:'steve@rr.com', other_name:'Steve Moskowitz', subject:'Following up' };
  const MSG = {
    'AAMk-in1':  { id:'AAMk-in1',  thread_id:'t1', subject:'Automatic reply: Estimator role', from:{name:'Steve Moskowitz',email:'steve@rr.com'}, to:[{email:'priya@futeglobal.com'}], cc:[], date:new Date().toISOString(), unread:false, body_html:'<p>I am out of the office.</p>', attachments:[] },
    'AAMk-out1': { id:'AAMk-out1', thread_id:'t1', subject:'Following up', from:{name:'Priya',email:'priya@futeglobal.com'}, to:[{name:'Steve Moskowitz',email:'steve@rr.com'}], cc:[], date:new Date().toISOString(), unread:false, body_html:'<p>Hope you had a good time away.</p>', attachments:[] },
  };
  await ev(([T_IN,T_OUT,MSG])=>{
    window.__calls=[]; window.__intel={ reply_target:{ last:T_OUT, last_inbound:T_IN }, timeline:[
      { id:'out:1', direction:'outbound', sent_at:'2026-10-04T10:00:00Z', from:'priya@futeglobal.com', to:'steve@rr.com', subject:'Following up', text:'Hope you had a good time away.' },
      { id:'in:2', direction:'inbound', sent_at:'2026-09-28T10:00:00Z', from:'Steve Moskowitz <steve@rr.com>', to:'priya@futeglobal.com', person:'Steve Moskowitz', subject:'Automatic reply', text:'I am out of the office.' } ] };
    window.__msgFail=false;
    window.apiGet=(p)=>{ window.__calls.push(['GET',p]);
      if(/^\/leads\/J1\/intel/.test(p)) return Promise.resolve(Object.assign({enabled:true,owner:true},window.__intel));
      if(/^\/mailbox\/accounts/.test(p)) return Promise.resolve([{ id:'mb1', email_address:'priya@futeglobal.com', display_name:'Priya', platform:'Microsoft', is_primary:true, is_active:true, readable:true, connection:{connected:true,status:'ok'} }]);
      if(/^\/mailbox\/unread-count/.test(p)) return Promise.resolve({unread:0,mailboxes:1});
      if(/\/signature$/.test(p)) return Promise.resolve({html:'<div>Priya</div>'});
      if(/\/folders$/.test(p)) return Promise.resolve([{id:'f-inbox',name:'Inbox',kind:'inbox',unread:0,total:3}]);
      if(/\/messages\?/.test(p)) return Promise.resolve({messages:[],next_cursor:null,crm:{}});
      if(/\/threads\//.test(p)) return Promise.resolve({messages:[]});
      var m=p.match(/\/mailbox\/mb1\/messages\/([^?/]+)/);
      if(m){ if(window.__msgFail) return Promise.reject(new Error('Message not found')); return Promise.resolve(JSON.parse(JSON.stringify(MSG_[m[1]]||{}))); }
      return Promise.resolve([]); };
    window.MSG_=MSG;
    window.apiPost=(p,b)=>{ window.__calls.push(['POST',p,b]); return Promise.resolve({success:true}); };
    STATE.clientDigest={enabled:true,mine:[{id:'J1',name:'Estimator · R&R Fabrication',state:'needs_reply',headline:'They wrote last',next_step:{id:'reply',label:'Reply to their last email',why:'They wrote last and are waiting on you.'}}]};
  },[T_IN,T_OUT,MSG]);
  const calls=()=>ev(()=>window.__calls);
  const reset=()=>ev(()=>{ window.__calls.length=0; window.__msgFail=false; STATE.toasts=[]; STATE.mailbox.composer=null; STATE.mailbox.selectedId=null; STATE.mailbox.message=null; STATE.page='dashboard'; STATE.modal=null; try{ if(window.Dock) Dock.close(); }catch(e){} });
  const click=(label)=>ev((l)=>{ const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===l); if(b) b.click(); return !!b; },label);
  const state=()=>ev(()=>({ page:STATE.page, tab:STATE.emailTab, acct:STATE.mailbox.activeId, sel:STATE.mailbox.selectedId, q:STATE.mailbox.q, comp:STATE.mailbox.composer&&{ to:STATE.mailbox.composer.to, subject:STATE.mailbox.composer.subject, msgId:STATE.mailbox.composer.msgId }, toasts:(STATE.toasts||[]).map(t=>t.msg) }));

  console.log('\nReply: THEIR email opens, with the reply window ready');
  await reset();
  await ev(()=>clientDigestTrace(0)); await page.waitForTimeout(500);
  step('the conversation window offers "Reply in the mailbox"', await click('Reply in the mailbox'));
  await page.waitForTimeout(900);
  let s=await state(); let cs=await calls();
  step('the mailbox opens on the mailbox it arrived in, with THEIR email selected (not a search)', s.page==='mailbox' && s.acct==='mb1' && s.sel==='AAMk-in1' && !s.q, JSON.stringify(s));
  step('…and the reply window is already open, addressed to them, "Re:" their subject, answering THAT message', !!s.comp && s.comp.to==='steve@rr.com' && /^Re: /.test(s.comp.subject) && s.comp.msgId==='AAMk-in1', JSON.stringify(s.comp));
  step('nothing is sent by opening it', !cs.some(c=>c[0]==='POST' && /reply|send/.test(c[1])));

  console.log('\nFollow-up: "Write the email" answers the newest email, even when it is ours');
  await reset();
  await ev(()=>{ STATE.clientDigest.mine[0]={id:'J1',name:'Estimator · R&R Fabrication',state:'waiting',headline:'You replied 3 days ago',next_step:{id:'check_promise',label:'Check on what they promised',why:'They promised something.'}}; clientDigestTrace(0); });
  await page.waitForTimeout(500);
  step('the window offers "Write the email"', await click('Write the email'));
  await page.waitForTimeout(900);
  s=await state();
  step('it opens OUR last email in the mailbox it left from, with the reply window ready', s.page==='mailbox' && s.sel==='AAMk-out1' && !!s.comp && s.comp.msgId==='AAMk-out1', JSON.stringify(s));
  step('…addressed to the person we wrote to — NOT back to ourselves', s.comp && s.comp.to==='steve@rr.com', JSON.stringify(s.comp));
  step('…and it did not drop the person on the lead', s.page!=='leads');

  console.log('\nNeeds you today: the same exact-email behaviour');
  await reset();
  await ev(()=>naActItem({ kind:'reply_due', entity_type:'contact', entity_id:'c1', job_id:'J1', email:'steve@rr.com', title:'Steve Moskowitz', subtitle:'R&R' })); await page.waitForTimeout(900);
  s=await state(); cs=await calls();
  step('a reply owed on the dashboard opens THEIR email with the reply window, asking the server about this person only', s.sel==='AAMk-in1' && !!s.comp && s.comp.to==='steve@rr.com' && cs.some(c=>/leads\/J1\/intel\?email=steve%40rr\.com/.test(c[1])), JSON.stringify(cs.filter(c=>/intel/.test(c[1]))));

  console.log('\nWhen the exact email cannot be found or opened, the person is told');
  await reset();
  await ev(()=>{ window.__msgFail=true; window.__intel.reply_target.last_inbound=Object.assign({},window.__intel.reply_target.last_inbound,{message_id:'AAMk-gone'}); naActItem({ kind:'reply_due', entity_type:'contact', entity_id:'c1', job_id:'J1', email:'steve@rr.com', title:'Steve Moskowitz', subtitle:'R&R' }); }); await page.waitForTimeout(900);
  s=await state(); cs=await calls();
  step('an email that cannot be opened says so in words and shows their messages in the mailbox', s.page==='mailbox' && s.q==='steve@rr.com' && s.toasts.some(t=>/could not be opened/.test(t)), JSON.stringify(s));
  await reset();
  await ev(()=>{ window.__intel={ reply_target:{ last:null, last_inbound:null }, timeline:window.__intel.timeline }; STATE.clientDigest.mine[0]={id:'J1',name:'Estimator · R&R Fabrication',state:'waiting',headline:'x',next_step:{id:'check_promise',label:'Check',why:'x'}}; clientDigestTrace(0); });
  await page.waitForTimeout(500); await click('Write the email'); await page.waitForTimeout(700);
  s=await state();
  step('with no email of ours to answer, "Write the email" opens the addressed composer — not the lead', s.page==='email' && s.tab==='compose', JSON.stringify(s));
  step('no script errors', errs.length===0, errs.join(' | ').slice(0,300));
} catch(e){ console.error(e); step('ran to the end',false,String(e).slice(0,300)); }
finally{ if(browser) await browser.close(); server.close(); }
console.log('\nSUMMARY: '+results.filter(Boolean).length+'/'+results.length+' passed'); process.exit(results.every(Boolean)?0:1);
