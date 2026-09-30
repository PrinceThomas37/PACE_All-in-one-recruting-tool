// CHANGE MANY PEOPLE'S STAGE AT ONCE — the screens (R-077, C-0032, D-0057).
//
// The owner: change several candidates' stage in one go; and inside a job
// nobody is "Tagged" — everybody starts at Sourced. The server side is pinned
// elsewhere; this pins what a person SEES and what the browser SENDS, in a real
// browser, on the three screens that can start a group move:
//   1. the job's own page (roster)          2. its Pipeline tab
//   3. the Candidates page (which asks WHICH JOB first)
//
// What is asserted:
//   * ticking several people and choosing a stage sends ONE POST
//     /submissions/bulk-stage carrying every ticked submission id — never N PATCHes;
//   * every ticked person is accounted for — moved, refused (with the server's
//     sentence) or "can't be moved yet" (with the button that fixes it) — never
//     dropped;
//   * a legacy person (on the job, no stage recorded) is added properly through
//     POST /pipeline/bulk, then moves, and the roster never draws the word "Tagged";
//   * a recruiter cannot group-submit to the BD manager (option greyed, with why);
//   * the Candidates page asks which job when the ticked people are on several,
//     and names the ticked people who are not on the chosen one.
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

// ── the stub API ─────────────────────────────────────────────────────────────
const JOB = { id:'jo1', job_code:'JOB-00001', job_title:'HVAC Service Technician', client:'Griffith Energy', city:'Westminster',
  state:'Maryland', status:'Active', bd_manager:{ id:'test-bdl', name:'Test BD Lead' }, poc_visible:true, recruiters:[] };
const JOB2 = { id:'jo3', job_code:'JOB-00003', job_title:'Estimator', client:'Griffith Energy', city:'Baltimore', state:'Maryland',
  status:'Active', bd_manager:{ id:'test-bdl', name:'Test BD Lead' }, poc_visible:true, recruiters:[] };
const person = (i) => ({ id:'c'+i, candidate_code:'CN-0000'+i, full_name:'Person '+i, email:'p'+i+'@example.test',
  current_title:'HVAC Tech', city:'Baltimore', state:'MD', applicant_status:'Active', experience_years:5, skills:'HVAC',
  owner:{ name:'Test BD Lead' }, created_at:new Date().toISOString() });
const CANDS = [0,1,2,3].map(person);
const state = { legacyFixed:false, refuseId:null, subStage:{ s1:'Sourced', s2:'Sourced', s3:'Screening' } };
const subs = () => {
  const rows = [
    { id:'s1', job_order_id:'jo1', candidate_id:'c0', stage:state.subStage.s1, candidate:CANDS[0] },
    { id:'s2', job_order_id:'jo1', candidate_id:'c1', stage:state.subStage.s2, candidate:CANDS[1] },
    { id:'s3', job_order_id:'jo1', candidate_id:'c2', stage:state.subStage.s3, candidate:CANDS[2] }];
  if (state.legacyFixed) rows.push({ id:'s4', job_order_id:'jo1', candidate_id:'c3', stage:'Sourced', candidate:CANDS[3] });
  return rows;
};
const pipelineRows = () => {
  const rows = subs().map((s,i)=>({ id:'p'+(i+1), pipeline_code:'PL-0000'+(i+1), candidate_id:s.candidate_id, job_order_id:'jo1',
    submission_id:s.id, stage:s.stage, submission:{ id:s.id, stage:s.stage, sub_stage:null }, candidate:s.candidate, tagged_at:new Date().toISOString() }));
  // The legacy person: on the job's list, no stage recorded (until fixed).
  if (!state.legacyFixed) rows.push({ id:'p9', pipeline_code:'PL-00009', candidate_id:'c3', job_order_id:'jo1', submission_id:null,
    stage:'Sourced', submission:null, candidate:CANDS[3], tagged_at:new Date().toISOString() });
  return rows;
};
const calls = [];
const called = (m, re) => calls.filter(c => c.m===m && re.test(c.p));
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
async function api(route){
  const req = route.request(); const url = new URL(req.url());
  const p = url.pathname, m = req.method();
  let body = null; try { body = req.postDataJSON(); } catch(_) {}
  calls.push({ m, p, body, q:url.search });
  if (m==='GET' && p==='/job-orders') return reply(route, [JOB, JOB2]);
  if (m==='GET' && p==='/job-orders/jo1') return reply(route, JOB);
  if (m==='GET' && p==='/job-orders/jo1/submissions') return reply(route, subs());
  if (m==='GET' && p==='/job-orders/jo1/pipeline') return reply(route, pipelineRows());
  if (m==='GET' && p==='/candidates') return reply(route, { data:CANDS, total:CANDS.length, page:1, limit:25 });
  if (m==='GET' && p==='/candidates/status-counts') return reply(route, { counts:{ Active:4 }, total:4 });
  if (m==='GET' && p==='/submissions') return reply(route, { submissions:[
    { id:'s1', candidate_id:'c0', job_order_id:'jo1', stage:'Sourced', sub_stage:null, job:JOB },
    { id:'s2', candidate_id:'c1', job_order_id:'jo1', stage:'Sourced', sub_stage:null, job:JOB },
    { id:'s8', candidate_id:'c1', job_order_id:'jo3', stage:'Screening', sub_stage:null, job:JOB2 }] });
  if (m==='POST' && p==='/submissions/bulk-stage') {
    const ids = (body && body.ids) || [];
    const refused = state.refuseId && ids.includes(state.refuseId)
      ? [{ id:state.refuseId, reason:'This person is with the BD team now, so only a BD Manager can change their stage.' }] : [];
    const moved = ids.filter(id => !refused.some(r => r.id===id));
    moved.forEach(id => { state.subStage[id] = body.stage; });
    return reply(route, { moved, refused, stage:body.stage });
  }
  if (m==='POST' && p==='/pipeline/bulk') { state.legacyFixed = true; return reply(route, { added:0, already:0, linked:1, failed:0, not_found:0 }); }
  if (m==='PATCH' && /^\/submissions\/[^/]+\/stage$/.test(p)) return reply(route, { id:p.split('/')[2], stage:body&&body.stage });
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
  const text = (sel) => page.evaluate((sel)=>{ const el=document.querySelector(sel); return el?el.innerText:null; }, sel);
  const modalText = () => page.evaluate(()=>{ const el=document.querySelector('#layer .modal'); return el?el.innerText:null; });
  const closeModal = async () => { await page.evaluate(()=>{ try{ closeModal(); }catch(_){} }); await page.waitForTimeout(150); };
  const pickStage = async (stage) => { await page.selectOption('select.stg-pick', stage); await page.waitForTimeout(400); };
  const doMove = async (note) => {
    await page.fill('#stg-note', note); await page.click('#stg-go'); await page.waitForTimeout(500);
  };

  // ═══ 1. THE JOB'S OWN PAGE ═══════════════════════════════════════════════
  await page.evaluate(()=>goPage('bd_joborders'));
  await page.waitForTimeout(600);
  await page.evaluate(()=>bdOpenJobOrder('jo1'));
  await page.waitForSelector('text=Candidates on this job', { timeout:8000 }).catch(()=>{});
  await page.waitForTimeout(500);
  const roster = await page.evaluate(()=>{ const c=[...document.querySelectorAll('#content .card')].find(x=>/Candidates on this job/.test(x.innerText)); return c?c.innerText:null; });
  step('Job page: the roster draws', !!roster, roster ? roster.split('\n')[0] : 'not drawn');
  step('Job page: everybody reads a real stage — the word "Tagged" is never drawn (D-0057)', !!roster && !/Tagged/.test(roster));
  step('Job page: no group control until somebody is ticked', (await page.$$('select.stg-pick')).length===0);

  await page.evaluate(()=>{ bdToggleCandSel('c0'); bdToggleCandSel('c1'); bdToggleCandSel('c2'); });
  await page.waitForTimeout(300);
  step('Job page: ticking people draws ONE "Change stage…" control', (await page.$$('select.stg-pick')).length===1);
  await pickStage('Screening');
  const mt = await modalText();
  step('Job page: the window names the group and the job', !!mt && /Move 3 candidates/.test(mt) && /HVAC Service Technician/.test(mt), (mt||'no window').replace(/\s+/g,' ').slice(0,120));
  await doMove('Phone screens done');
  const bulk1 = called('POST', /^\/submissions\/bulk-stage$/);
  step('Job page: ONE request, carrying all three submission ids', bulk1.length===1 && JSON.stringify((bulk1[0].body.ids||[]).slice().sort())==='["s1","s2","s3"]', JSON.stringify(bulk1.map(c=>c.body&&c.body.ids)));
  step('Job page: it is NOT three separate PATCHes', called('PATCH', /\/stage$/).length===0);
  step('Job page: the note and stage travel with it', bulk1.length===1 && bulk1[0].body.stage==='Screening' && bulk1[0].body.note==='Phone screens done');
  const res1 = await modalText();
  step('Job page: the answer says everybody moved', !!res1 && /Moved all 3 to Screening/.test(res1), (res1||'').replace(/\s+/g,' ').slice(0,120));
  await closeModal();

  // A refusal is named, never dropped, and never spoils the rest.
  state.refuseId = 's2';
  await pickStage('Offer');
  await doMove('Client asked for an offer');
  const res2 = await modalText();
  step('Job page: a refused person is named with the server\'s own sentence',
    !!res2 && /Moved 2 of 3 to Offer/.test(res2) && /Not moved \(1\)/i.test(res2) && /Person 1/.test(res2) && /BD team now/.test(res2), (res2||'').replace(/\s+/g,' ').slice(0,200));
  state.refuseId = null;
  await closeModal();

  // ═══ 2. A PERSON WITH NO STAGE YET (added before a stage was recorded) ═══
  await page.evaluate(()=>{ STATE.bd.candSel={}; render(); });
  await page.waitForTimeout(200);
  await page.evaluate(()=>{ bdToggleCandSel('c0'); bdToggleCandSel('c3'); });
  await page.waitForTimeout(300);
  const legacyRow = await page.evaluate(()=>{ const c=[...document.querySelectorAll('#content .card')].find(x=>/Candidates on this job/.test(x.innerText)); return c?c.innerText:''; });
  step('Legacy person: reads Sourced on the roster, never Tagged', /Person 3/.test(legacyRow) && !/Tagged/.test(legacyRow));
  await pickStage('Screening');
  const leg = await modalText();
  step('Legacy person: the window says one of the two can\'t be moved yet, and offers the fix',
    !!leg && /1 of the 2 you ticked can.t be moved yet/.test(leg) && /Person 3/.test(leg) && /Add them to the job again/.test(leg), (leg||'').replace(/\s+/g,' ').slice(0,200));
  const before = called('POST', /^\/submissions\/bulk-stage$/).length;
  await page.click('#stg-fix-btn'); await page.waitForTimeout(900);
  const addCalls = called('POST', /^\/pipeline\/bulk$/);
  step('Legacy person: the fix is the ONE add path (POST /pipeline/bulk) for just that person',
    addCalls.length===1 && JSON.stringify(addCalls[0].body.candidate_ids)==='["c3"]' && addCalls[0].body.job_order_id==='jo1');
  const after = await modalText();
  step('Legacy person: then the move opens again with BOTH people in it', !!after && /Move 2 candidates/.test(after), (after||'').replace(/\s+/g,' ').slice(0,100));
  await doMove('Both screened');
  const bulk3 = called('POST', /^\/submissions\/bulk-stage$/);
  step('Legacy person: both ids go in one request', bulk3.length===before+1 && JSON.stringify((bulk3[bulk3.length-1].body.ids||[]).slice().sort())==='["s1","s4"]', JSON.stringify(bulk3.map(c=>c.body.ids)));
  await closeModal();

  // ═══ 3. THE PIPELINE TAB ═════════════════════════════════════════════════
  await page.evaluate(()=>{ STATE.bd.plSel={}; bdOpenPipeline('jo1'); });
  await page.waitForSelector('#pl-chk-all', { timeout:8000 }).catch(()=>{});
  await page.waitForTimeout(400);
  const head = await page.evaluate(()=>{ const t=document.querySelector('#content table'); return t?t.querySelector('thead').innerText:null; });
  step('Pipeline tab: the columns say who ADDED a person, not who "tagged" them', !!head && /Added By/i.test(head) && !/Tagged/i.test(head), (head||'').replace(/\s+/g,' ').slice(-60));
  await page.evaluate(()=>{ plToggleSel('p1'); plToggleSel('p2'); });
  await page.waitForTimeout(300);
  step('Pipeline tab: ticking rows draws the group control in the bulk bar', (await page.$$('#pl-bulkbar select.stg-pick')).length===1);
  const n0 = called('POST', /^\/submissions\/bulk-stage$/).length;
  await pickStage('Interview Scheduled');
  const ivm = await modalText();
  step('Pipeline tab: an interview move asks for the interview details once, for everybody', !!ivm && /INTERVIEW DETAILS/i.test(ivm) && /every person you move/.test(ivm));
  await page.fill('#stg-iv-at', '2026-10-05T10:00');
  await doMove('Interview booked');
  const bulk4 = called('POST', /^\/submissions\/bulk-stage$/);
  step('Pipeline tab: one request for the two ticked rows, with the interview details',
    bulk4.length===n0+1 && JSON.stringify((bulk4[bulk4.length-1].body.ids||[]).slice().sort())==='["s1","s2"]' && !!bulk4[bulk4.length-1].body.interview_at);
  await closeModal();

  // ═══ 4. THE CANDIDATES PAGE ═════════════════════════════════════════════
  await page.evaluate(()=>{ STATE.ats.sel={}; goPage('applicants'); });
  await page.waitForSelector('#content', { timeout:8000 });
  await page.waitForTimeout(800);
  await page.evaluate(()=>{ atsToggleSel('c0'); atsToggleSel('c1'); atsToggleSel('c2'); });
  await page.waitForTimeout(300);
  step('Candidates page: ticking people draws the group control beside "Add to job"', (await page.$$('select.stg-pick')).length===1);
  await pickStage('Screening');
  await page.waitForTimeout(400);
  const lookup = called('GET', /^\/submissions$/);
  step('Candidates page: it asks the server which jobs the ticked people are on (one lookup)', lookup.length===1 && /candidate_ids=/.test(lookup[0].q||''), JSON.stringify(lookup.map(c=>c.q)));
  const which = await modalText();
  step('Candidates page: the people are on two jobs, so it asks WHICH JOB', !!which && /Which job\?/.test(which) && /HVAC Service Technician/.test(which) && /Estimator/.test(which), (which||'').replace(/\s+/g,' ').slice(0,140));
  await page.evaluate(()=>atsMoveOnJob('jo1'));
  await page.waitForTimeout(300);
  const chosen = await modalText();
  step('Candidates page: on the chosen job, the ticked person who is not on it is named, not dropped',
    !!chosen && /Move 2 candidates/.test(chosen) && /1 of the 3 you ticked have no stage on this job/.test(chosen) && /Person 2/.test(chosen), (chosen||'').replace(/\s+/g,' ').slice(0,220));
  const n1 = called('POST', /^\/submissions\/bulk-stage$/).length;
  await doMove('Screening call');
  const bulk5 = called('POST', /^\/submissions\/bulk-stage$/);
  step('Candidates page: only that job\'s submission ids are sent',
    bulk5.length===n1+1 && JSON.stringify((bulk5[bulk5.length-1].body.ids||[]).slice().sort())==='["s1","s2"]', JSON.stringify(bulk5[bulk5.length-1].body.ids));
  const res5 = await modalText();
  step('Candidates page: the answer still lists the one who was left out', !!res5 && /Not included \(1\)/i.test(res5) && /Person 2/.test(res5));
  await closeModal();

  // ═══ 5. A RECRUITER CANNOT GROUP-SUBMIT TO THE BD MANAGER ═══════════════
  await enterApp(page,'recruiter');
  await page.evaluate(()=>{ STATE.ats.sel={}; goPage('applicants'); });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ atsToggleSel('c0'); atsToggleSel('c1'); });
  await page.waitForTimeout(300);
  const opts = await page.evaluate(()=>[...document.querySelectorAll('select.stg-pick option')].map(o=>({ v:o.value, d:o.disabled, t:o.textContent })));
  const bdm = opts.find(o=>o.v==='Submitted to BDM'), offer = opts.find(o=>o.v==='Offer'), scr = opts.find(o=>o.v==='Screening');
  step('Recruiter: "Submitted to BDM" is offered greyed, saying "one at a time"', !!bdm && bdm.d && /one at a time/.test(bdm.t), bdm && bdm.t);
  step('Recruiter: a BD-only stage is greyed, saying so', !!offer && offer.d && /BD team only/.test(offer.t), offer && offer.t);
  step('Recruiter: a stage a recruiter may use is on offer', !!scr && !scr.d);

  step('No page errors', pageErrors.length===0, pageErrors.slice(0,2).join(' | '));
}catch(e){
  console.log('[FAIL] run crashed — '+(e&&e.stack||e)); results.push(false);
}finally{
  if(browser) await browser.close();
  server.close();
}
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass===results.length && results.length>0 ? 0 : 1);
