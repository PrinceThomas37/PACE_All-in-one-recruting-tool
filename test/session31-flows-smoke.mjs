// SESSION 31 — the owner's list, driven in a real browser against a stub API.
//
// Every assertion here reproduces a sentence the owner wrote, not a theory:
//   1. "remove this Connected Lead to Convert bar … the main column itself can
//      just show only the connected list … sorted on created date", and
//      "when that lead is getting converted, the background page kind of
//      changes to a job tab … I don't want that to happen";
//   2. "the job posting or the JD link should be shown … the AI writing button
//      … if there are no AI tokens, a small pop-up … 'Subscribe AI to rewrite'";
//   3. "multiple selections … tagged to a job in 1, 2, 3 clicks";
//   4. "Remove the ownership option … It just shows who the owner is";
//   5. "those do not show up on the first page of the job" + "there is no option
//      to send the emails to those candidates regarding the job";
//   6. "When I scroll down and click something, it just goes up again" and "I
//      don't have the option to select the email ID";
//   7. "Once those emails are queued, they don't show up in Pending";
//   8. "multiple document upload in a single turn … a progress bar … a window
//      that previews all of those candidates … 'Add candidates'".
//
// Each probe that cannot take its measurement FAILS (a missing node is never a
// pass) — the vacuous-guard lesson this repo has paid for seven times.
//
// SHOTS=<dir> also writes screenshots of each screen for the owner.
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

// ── the stub API ─────────────────────────────────────────────────────────────
const calls = [];
let aiMode = 'off';     // 'off' → not_configured, 'on' → rewrites
const JOB = { id:'jo1', job_code:'JOB-00001', job_title:'HVAC Service Technician', client:'Griffith Energy',
  city:'Westminster', state:'Maryland', status:'Active', bd_manager:{id:'test-bdl'}, poc_visible:true,
  source_lead_id:null, recruiters:[] };
const CANDS = Array.from({length:30},(_,i)=>({ id:'c'+i, candidate_code:'CN-'+String(i+1).padStart(5,'0'),
  full_name:'Candidate '+i, email:'cand'+i+'@example.test', current_title:'HVAC Tech', city:'Baltimore', state:'MD',
  applicant_status:'New lead', owner:{name:'Test BD Lead'}, created_at:new Date().toISOString() }));
function reply(route, body, status=200){
  return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) });
}
async function api(route){
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname, m = req.method();
  let body = null; try { body = req.postDataJSON(); } catch(_) {}
  calls.push({ m, p, q:url.search, body });
  if (m==='GET' && p==='/job-orders') return reply(route,[JOB]);
  if (m==='GET' && p==='/job-orders/jo1') return reply(route,JOB);
  if (m==='GET' && p==='/job-orders/jo1/submissions') return reply(route,[
    { id:'s1', job_order_id:'jo1', candidate_id:'c0', stage:'Sourced', candidate:CANDS[0] }]);
  if (m==='GET' && p==='/job-orders/jo1/pipeline') return reply(route,[
    { id:'p1', job_order_id:'jo1', candidate_id:'c0', candidate:CANDS[0], submission_id:'s1' },
    { id:'p2', job_order_id:'jo1', candidate_id:'c1', candidate:CANDS[1], submission_id:null },
    { id:'p3', job_order_id:'jo1', candidate_id:'c2', candidate:CANDS[2], submission_id:null }]);
  if (m==='POST' && p==='/job-orders/rewrite-jd') return reply(route, aiMode==='on'
    ? { used_ai:true, text:'Overview\n- Service and repair HVAC systems.' }
    : { used_ai:false, reason:'not_configured' });
  if (m==='GET' && p==='/candidates') return reply(route,{ rows:CANDS.slice(0,25), data:CANDS.slice(0,25), total:30 });
  if (m==='GET' && p==='/candidates/status-counts') return reply(route,{ counts:{}, total:30 });
  if (m==='POST' && p==='/pipeline/bulk') return reply(route,{ added:(body.candidate_ids||[]).length, already:0, not_found:0, failed:0, errors:[] });
  if (m==='GET' && p==='/candidate-outreach/sender') return reply(route,{ company_name:'Fute Global', ai:false,
    mailbox:{ id:'mb1', email:'lisa@example.test', display_name:'Lisa' },
    mailboxes:[{ id:'mb1', email:'lisa@example.test', display_name:'Lisa' },{ id:'mb2', email:'neil@example.test', display_name:'Neil' }],
    signature_html:'', window:{ enabled:false, sentence:'Candidates are emailed at any hour.' } });
  if (m==='GET' && p==='/candidate-outreach/jobs') return reply(route,[{ id:'jo1', job_title:JOB.job_title, client:JOB.client, status:'Active', place:'Westminster, Maryland' }]);
  if (m==='GET' && p==='/candidate-outreach/jobs/jo1/candidates') return reply(route,{ scoreable:true, pool_size:30,
    results:CANDS.map(c=>({ candidate_id:c.id, name:c.full_name, title:c.current_title, location:'Baltimore, MD', score:70, band:'good', reasons:['title 100%'], emailable:true })) });
  if (m==='GET' && p==='/candidate-outreach/jobs/jo1/brief') return reply(route,{ hook:'A service role.', detail:'', engine:'rules' });
  if (m==='POST' && p==='/candidate-outreach/preview') return reply(route,{ candidate:{ id:body.candidate_id, name:'Candidate' }, sends_as:body.mailbox_id==='mb2'?'neil@example.test':'lisa@example.test',
    variants:[{ id:'direct', label:'Direct', words:80, subject:'HVAC role', email:'Hi there', preview_subject:'HVAC role', preview_email:'Hi there', preview_prose:'Hi there', quality:{ ok:true } }], signature_html:'', buttons_html:'' });
  if (m==='GET' && p==='/candidate-outreach/queue') return reply(route,[
    { id:'q1', name:'Candidate 3', to_email:'cand3@example.test', subject:'HVAC role', status:'pending', send_after:new Date(Date.now()+90000).toISOString(), wait:{ reason:'queued', text:'Waiting for its turn in the drip.' } }]);
  if (m==='POST' && p==='/candidates/parse-resume') {
    const n = (body.filename||'').replace(/\D/g,'') || '0';
    if (body.filename==='broken.pdf') return reply(route,{ error:'No text could be read from this file.' },400);
    return reply(route,{ fields:{ full_name:'Resume Person '+n, email:'r'+n+'@example.test', current_title:'Technician' }, used_ai:false, resume_text:'text' });
  }
  if (m==='POST' && p==='/candidates') return reply(route,{ id:'new-'+calls.length, full_name:body.full_name },201);
  if (m==='POST' && /^\/candidates\/[^/]+\/documents$/.test(p)) return reply(route,{ ok:true },201);
  if (m==='POST' && p==='/pipeline') return reply(route,{ id:'p-new' },201);
  // Everything else: an empty, successful answer.
  return reply(route, m==='GET' ? [] : {});
}

let browser;
const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  await ctx.route('**',r=>{
    const u=r.request().url();
    if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)) return api(r);
    return r.abort();
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd_lead');
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name+'.png') }); };

  // ── 1. LEADS: no convert bar; Connected filters the table ─────────────────
  await page.evaluate(()=>{
    const now=Date.now(), D=86400000;
    STATE.companies=[]; STATE.contacts=[]; STATE.jobs=[];
    const stages=['Connected','Assigned','Connected','Connected','Assigned'];
    stages.forEach((st,i)=>{
      STATE.companies.push({id:'co'+i,name:'Company '+i});
      STATE.contacts.push({id:'ct'+i,job_id:'j'+i,company_id:'co'+i,first_name:'First'+i,last_name:'L',email:'c'+i+'@example.test',is_primary:true});
      // Created out of order on purpose, so "newest first" is a real claim.
      const age=[3,0,1,5,2][i];
      STATE.jobs.push({id:'j'+i,position:'Position '+i,company_id:'co'+i,company_name:'Company '+i,location:'Austin, TX',
        stage:st,created_at:new Date(now-age*D).toISOString(),assigned_to_bd:'test-bdl',assigned_bd_name:'Test BD Lead',
        job_url:'https://jobs.example.test/'+i,research:{requirements:{skills:['title','HVAC','EPA']}}});
    });
    STATE.leads=STATE.jobs; STATE.page='leads'; render();
  });
  await page.waitForTimeout(400);
  step('the "connected leads to convert" bar is gone',
    await page.evaluate(()=>!document.querySelector('[data-bd-taskbar],[data-bd-leadpick]') && !/Select connected leads to convert/.test(document.body.innerText)));
  const connCell = await page.evaluate(()=>{
    const cells=[...document.querySelectorAll('#content *')].filter(n=>n.children.length===0 && /^Connected$/.test((n.textContent||'').trim()));
    const strip=cells.find(n=>n.closest('.strip,.ui-strip,[class*=strip]'));
    return !!strip;
  });
  step('Connected is on the strip as a plain filter (no ▸ drawer marker)', connCell && !(await page.evaluate(()=>/Connected ▸/.test(document.body.innerText))));
  await page.evaluate(()=>{ STATE.jobsFilter.stages=['Connected']; STATE.leadsPage=0; render(); });
  await page.waitForTimeout(200);
  const order = await page.evaluate(()=>[...document.querySelectorAll('#content tbody tr[data-row-id]')].map(tr=>tr.getAttribute('data-row-id')));
  step('Connected shows only connected leads, newest first', JSON.stringify(order)===JSON.stringify(['j2','j0','j3']), JSON.stringify(order));
  const convBtns = await page.evaluate(()=>[...document.querySelectorAll('#content tbody button')].filter(b=>/Convert/.test(b.textContent)).length);
  step('every connected row carries its own Convert button', convBtns===3, String(convBtns));
  await shot('01-leads-connected');
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#content tbody button')].find(x=>/Convert/.test(x.textContent)); b && b.click(); });
  await page.waitForTimeout(300);
  const conv = await page.evaluate(()=>({ page:STATE.page, modal:!!(STATE.modal&&String(STATE.modal).indexOf('New Job')>-1),
    link:!!document.querySelector('#layer a[href^="https://jobs.example.test/"]'), jd:!!document.getElementById('bd-jd'),
    skills:(STATE.bd.form||{}).primary_skills }));
  step('Convert opens the New Job form ON the Leads page', conv.page==='leads' && conv.modal, JSON.stringify(conv));
  step('the form shows the lead\'s job posting link beside the description box', conv.link && conv.jd);
  step('skills found at import are pre-filled, minus the "title" noise', conv.skills==='HVAC, EPA', conv.skills);
  // ── 2. AI rewrite: no AI → the subscribe pop-up; AI → the box is rewritten
  await page.fill('#bd-jd','Line one of a pasted job posting that is long enough to rewrite properly, with duties.');
  await page.evaluate(()=>{ document.getElementById('bd-jd').dispatchEvent(new Event('input')); bdRewriteJd(); });
  await page.waitForTimeout(400);
  step('no AI → "Subscribe to AI to rewrite" pop-up', await page.evaluate(()=>{ const p=document.getElementById('ai-sub-pop'); return !!p && /Subscribe to AI to rewrite/.test(p.textContent); }));
  const popBg = await page.evaluate(()=>{ const p=document.getElementById('ai-sub-pop'); return p?getComputedStyle(p).backgroundColor:''; });
  step('the pop-up is opaque (a float is never glass)', /^rgb\(/.test(popBg), popBg);
  await shot('02-convert-subscribe-popup');
  aiMode='on';
  await page.evaluate(()=>{ const p=document.getElementById('ai-sub-pop'); p&&p.remove(); bdRewriteJd(); });
  await page.waitForTimeout(400);
  step('with AI → the description is replaced, and Undo is offered',
    await page.evaluate(()=>/Service and repair HVAC/.test(document.getElementById('bd-jd').value) && /Undo rewrite/.test(document.getElementById('layer').innerText)));
  await shot('03-convert-ai-rewritten');
  await page.evaluate(()=>bdCancelNewJob()); await page.waitForTimeout(150);
  step('Cancel leaves you on Leads', await page.evaluate(()=>STATE.page==='leads' && !STATE.modal));

  // ── 3 + 4. CANDIDATES: bulk add to job; owner is shown, not chosen ────────
  await page.evaluate(()=>goPage('applicants')); await page.waitForTimeout(500);
  await page.evaluate(()=>{ atsToggleSel('c0'); atsToggleSel('c1'); atsToggleSel('c2'); });
  await page.waitForTimeout(150);
  step('a selection offers "Add to job"', await page.evaluate(()=>[...document.querySelectorAll('#content button')].some(b=>/Add to job/.test(b.textContent))));
  await shot('04-candidates-selected');
  await page.evaluate(()=>atsAddSelectedToJob()); await page.waitForTimeout(300);
  step('the job picker names the selection', await page.evaluate(()=>/Add 3 candidates to a Job/.test(document.getElementById('layer').innerText)));
  await page.evaluate(()=>atsDoAddManyToJob('jo1')); await page.waitForTimeout(300);
  const bulk = calls.filter(c=>c.p==='/pipeline/bulk').pop();
  step('ONE request adds all three', bulk && bulk.body.job_order_id==='jo1' && (bulk.body.candidate_ids||[]).length===3, JSON.stringify(bulk&&bulk.body));
  await page.evaluate(()=>atsOpenNew()); await page.waitForTimeout(200);
  const own = await page.evaluate(()=>{ const L=document.getElementById('layer'); return { select:[...L.querySelectorAll('select')].some(s=>/owner/i.test(s.getAttribute('onchange')||'')), shown:/Owner/.test(L.innerText)&&/\(you\)/.test(L.innerText) }; });
  step('New Candidate shows the owner and offers no picker', own.shown && !own.select, JSON.stringify(own));
  await shot('05-new-candidate-owner');
  // Even a form that somehow carries an owner must not send one.
  await page.evaluate(()=>{ STATE.ats.form={ full_name:'Single Add', owner_id:'somebody-else' }; atsSaveApplicant(false); });
  await page.waitForTimeout(300);
  const single = calls.filter(c=>c.m==='POST'&&c.p==='/candidates').pop();
  step('saving a new candidate never sends an owner', single && single.body.full_name==='Single Add' && !('owner_id' in single.body), JSON.stringify(single&&single.body));
  await page.evaluate(()=>closeModal());

  // ── 8. BULK RESUME UPLOAD ────────────────────────────────────────────────
  await page.evaluate(()=>atsOpenBulkUpload()); await page.waitForTimeout(150);
  const files=[1,2,3].map(i=>({ name:'resume'+i+'.pdf', mimeType:'application/pdf', buffer:Buffer.from('%PDF-1.4 fake '+i) }))
    .concat([{ name:'broken.pdf', mimeType:'application/pdf', buffer:Buffer.from('%PDF-1.4 x') }]);
  const input = await page.$('#br-files');
  step('the upload window takes many files at once', !!input && await page.evaluate(()=>document.getElementById('br-files').multiple));
  if (input) await input.setInputFiles(files);
  await page.waitForFunction(()=>STATE.bulkResume&&STATE.bulkResume.phase==='review',null,{timeout:8000}).catch(()=>{});
  const rev = await page.evaluate(()=>({ phase:STATE.bulkResume&&STATE.bulkResume.phase, rows:(STATE.bulkResume&&STATE.bulkResume.rows||[]).map(r=>r.status),
    parses:0 }));
  step('every file is read, one at a time, and a failure is kept on its row', rev.phase==='review' && JSON.stringify(rev.rows)==='["read","read","read","error"]', JSON.stringify(rev));
  step('the reader was called once per file', calls.filter(c=>c.p==='/candidates/parse-resume').length===4);
  await shot('06-bulk-resume-review');
  // Edit a name in the preview, untick one, then add.
  await page.evaluate(()=>{ const r=STATE.bulkResume.rows[0]; bulkResumeSet(r.key,'full_name','Edited Name'); bulkResumeInclude(STATE.bulkResume.rows[2].key,false); });
  const label = await page.evaluate(()=>(document.getElementById('br-add')||{}).textContent);
  step('the Add button counts what is ticked', label==='Add 2 candidates', label);
  await page.evaluate(()=>bulkResumeAdd());
  await page.waitForFunction(()=>STATE.bulkResume&&STATE.bulkResume.phase==='done',null,{timeout:8000}).catch(()=>{});
  const created = calls.filter(c=>c.m==='POST'&&c.p==='/candidates'&&c.body.full_name!=='Single Add');
  step('two people added, the edited name as typed, no owner sent', created.length===2 && created[0].body.full_name==='Edited Name' && !('owner_id' in created[0].body), JSON.stringify(created.map(c=>c.body.full_name)));
  step('each resume file is attached to its new record', calls.filter(c=>/\/documents$/.test(c.p)).length===2);
  step('the window says how many were added', await page.evaluate(()=>/2 candidates added/.test(document.getElementById('layer').innerText)));
  await shot('07-bulk-resume-done');
  await page.evaluate(()=>bulkResumeCancel());

  // ── 5. JOB PAGE: everyone on the job, and "Email about this job" ─────────
  await page.evaluate((job)=>{ STATE.bd.jobOrders=[job]; bdOpenJobOrder('jo1'); }, JOB);
  await page.waitForTimeout(700);
  const roster = await page.evaluate(()=>{ const t=document.getElementById('content').innerText; return { head:(t.match(/Candidates on this job \((\d+)\)/)||[])[1], tagged:(t.match(/Tagged/g)||[]).length }; });
  step('the job page lists the submission AND the two tagged-only candidates', roster.head==='3' && roster.tagged===2, JSON.stringify(roster));
  await page.evaluate(()=>{ bdToggleCandSel('c0'); bdToggleCandSel('c1'); });
  await page.waitForTimeout(150);
  await shot('08-job-candidates');
  await page.evaluate(()=>bdEmailSelected('jo1')); await page.waitForTimeout(600);
  const em = await page.evaluate(()=>({ page:STATE.page, tab:STATE.emailTab, side:STATE.composeSide, step:STATE.candOutreach.step,
    picked:Object.keys(STATE.candOutreach.picked).sort() }));
  step('"Email about this job" opens the ONE candidate-email screen, job and people picked',
    em.page==='email' && em.tab==='compose' && em.side==='candidates' && em.step===3 && JSON.stringify(em.picked)==='["c0","c1"]', JSON.stringify(em));
  await shot('09-email-from-job');

  // ── 6. the From picker, and the list keeps its scroll ────────────────────
  const fromSel = await page.evaluate(()=>[...document.querySelectorAll('#content select')].find(s=>/candOutreachSetMailbox/.test(s.getAttribute('onchange')||''))?.options.length||0);
  step('with two mailboxes, a From picker is offered', fromSel===2, String(fromSel));
  await page.evaluate(()=>candOutreachSetMailbox('mb2')); await page.waitForTimeout(300);
  const prev = calls.filter(c=>c.p==='/candidate-outreach/preview').pop();
  step('changing From rebuilds the preview from that mailbox', prev && prev.body.mailbox_id==='mb2', JSON.stringify(prev&&prev.body));
  await page.evaluate(()=>candOutreachBackTo(2)); await page.waitForTimeout(500);
  const scroll = await page.evaluate(()=>{
    const box=document.querySelector('[data-keep-scroll="co-pool"]'); if(!box) return { missing:true };
    box.scrollTop=400; const before=box.scrollTop;
    candOutreachToggle('c20');
    const after=document.querySelector('[data-keep-scroll="co-pool"]');
    return { before, after:after?after.scrollTop:-1, replaced:after!==box };
  });
  step('ticking a candidate does NOT throw the list back to the top', !scroll.missing && scroll.before>0 && scroll.after===scroll.before, JSON.stringify(scroll));

  // ── 7. Pending shows candidate emails ────────────────────────────────────
  await page.evaluate(()=>setEmailTab('pending')); await page.waitForTimeout(600);
  step('Email → Pending lists candidate emails waiting to go', await page.evaluate(()=>/Candidate emails waiting to go \(1\)/.test(document.getElementById('content').innerText)));
  await shot('10-pending-candidates');

  step('no page errors', pageErrors.length===0, pageErrors.join(' | '));
} catch(e){
  step('suite ran', false, e && e.stack || String(e));
} finally {
  if(browser) await browser.close();
  server.close();
}
const failed=results.filter(x=>!x).length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
