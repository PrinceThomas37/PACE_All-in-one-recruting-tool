// ONE GESTURE ON EVERY LIST (R-012, D-0014 carried to every list by D-0048).
//
// The owner, 10 Sep: "those lead row or the job rows and all and not
// interactive they don't show anything" … "why not just minimilistically
// reduce elements on screen and shows things when clicked". The Leads list was
// fixed on 11 Sep (lead-row-expand-smoke). Until this change the SAME CLICK did
// three different things on the other record lists:
//   * Jobs        → LEFT THE PAGE for the full job;
//   * Candidates  → the name opened a side drawer, the rest of the row did
//                   nothing, and every row carried its own "Add to Job" button;
//   * Clients     → opened a side drawer.
// Now a row click opens a panel DIRECTLY BENEATH the row with what the record
// is and the few things done to it; the full record is one explicit button.
//
// What this pins, per list: quiet by default · one click opens a panel under
// THAT row · it is not navigation and not the drawer · only the actions the
// server will allow are drawn · the panel's exit really opens the full record.
// And for the shared mechanism: one panel at a time, a list refresh does NOT
// snap an open panel shut, and leaving the page forgets it.
//
// Every probe that cannot take its measurement FAILS — a missing node is never
// a pass (the vacuous-guard lesson this repo has paid for repeatedly).
//
// SHOTS=<dir> writes screenshots (desktop + phone, light + dark) for the owner.
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
const D = 86400000, NOW = Date.now();
const JOBS = [
  // Owned by the signed-in BD lead (poc_visible:true) — may change status, apply link live.
  { id:'jo1', job_code:'JOB-00001', job_title:'HVAC Service Technician', client:'Griffith Energy',
    city:'Westminster', state:'Maryland', status:'Active', priority:'High', positions:2, job_type:'Full-time', remote:'No',
    pay_min:28, pay_max:36, pay_cur:'USD', bd_manager:{ id:'test-bdl', name:'Test BD Lead' }, poc_visible:true,
    apply_enabled:true, apply_token:'tok123', apply_count:3,
    recruiters:[{ recruiter_id:'r1', recruiter:{ id:'r1', name:'Lisa Anderson' } }],
    created_at:new Date(NOW-12*D).toISOString() },
  // Somebody else's job (poc_visible:false) — sees, never touches.
  { id:'jo2', job_code:'JOB-00002', job_title:'Office Manager', client:'Kaiker Homes',
    city:'Austin', state:'Texas', status:'Active', priority:'Normal', positions:1,
    bd_manager:{ id:'other', name:'Neil Patrick' }, poc_visible:false, apply_enabled:false, recruiters:[],
    created_at:new Date(NOW-3*D).toISOString() },
  { id:'jo3', job_code:'JOB-00003', job_title:'Estimator', client:'Griffith Energy',
    city:'Baltimore', state:'Maryland', status:'On Hold', bd_manager:{ id:'test-bdl', name:'Test BD Lead' }, poc_visible:true,
    apply_enabled:false, recruiters:[], created_at:new Date(NOW-30*D).toISOString() },
];
const CANDS = Array.from({length:6},(_,i)=>({ id:'c'+i, candidate_code:'CN-'+String(i+1).padStart(5,'0'),
  full_name:'Candidate '+i, email:'cand'+i+'@example.test', current_title:'HVAC Tech', city:'Baltimore', state:'MD',
  applicant_status:'Active', phone:'555-010'+i, source:'Referral', work_authorization:'US Citizen',
  skills:'HVAC, EPA 608, Boilers, Refrigeration', experience_years:6+i, availability:'2 weeks',
  pay_rate:32, pay_currency:'USD', pay_type:'Hourly', current_employer:'Acme Mechanical',
  resume_filename:i%2?'cv.pdf':null, owner:{name:'Test BD Lead'}, created_at:new Date(NOW-i*D).toISOString() }));
const CLIENTS = [
  { id:'co1', name:'Griffith Energy', industry:'Construction', location:'Maryland', website:'griffith.example.test',
    job_order_count:3, open_job_order_count:2, can_edit:true },
  { id:'co2', name:'Kaiker Homes', industry:'Real estate', location:'Texas', website:'',
    job_order_count:1, open_job_order_count:1, can_edit:false },
];
const calls = [];
function reply(route, body, status=200){
  return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) });
}
async function api(route){
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname, m = req.method();
  let body = null; try { body = req.postDataJSON(); } catch(_) {}
  calls.push({ m, p, body });
  if (m==='GET' && p==='/job-orders') return reply(route, JOBS);
  if (m==='GET' && p==='/job-orders/jo1/submissions') return reply(route, [
    { id:'s1', job_order_id:'jo1', stage:'Sourced', candidate:{ full_name:'Candidate 0' } },
    { id:'s2', job_order_id:'jo1', stage:'Sourced', candidate:{ full_name:'Candidate 1' } },
    { id:'s3', job_order_id:'jo1', stage:'Submitted to BDM', candidate:{ full_name:'Candidate 2' } },
    { id:'s4', job_order_id:'jo1', stage:'Interview Scheduled', candidate:{ full_name:'Candidate 3' } }]);
  if (m==='PUT' && p==='/job-orders/jo1') return reply(route, Object.assign({}, JOBS[0], body||{}));
  if (m==='GET' && p==='/candidates') return reply(route, { data:CANDS, total:CANDS.length, page:1, limit:25 });
  if (m==='GET' && p==='/candidates/status-counts') return reply(route, { counts:{ Active:6 }, total:6 });
  if (m==='GET' && p==='/candidates/c0/history') return reply(route, {
    submissions:[{ id:'s3', job_order_id:'jo1', stage:'Submitted to BDM', created_at:new Date(NOW-D).toISOString(),
      job:{ id:'jo1', job_title:'HVAC Service Technician', client:'Griffith Energy' } }],
    pipeline:[
      { id:'p1', job_order_id:'jo1', tagged_at:new Date(NOW-2*D).toISOString(), job:{ id:'jo1', job_title:'HVAC Service Technician', client:'Griffith Energy' } },
      { id:'p9', job_order_id:'jo3', tagged_at:new Date(NOW-9*D).toISOString(), job:{ id:'jo3', job_title:'Estimator', client:'Griffith Energy' } }],
    activity:[] });
  if (m==='GET' && p==='/candidates/c0') return reply(route, CANDS[0]);
  if (m==='GET' && p==='/clients') return reply(route, CLIENTS);
  if (m==='GET' && p==='/companies/co1/job-orders') return reply(route, [
    { id:'jo3', job_title:'Estimator', status:'Closed', created_at:new Date(NOW-30*D).toISOString(), bd_manager:{ name:'Test BD Lead' } },
    { id:'jo1', job_title:'HVAC Service Technician', status:'Active', created_at:new Date(NOW-12*D).toISOString(), bd_manager:{ name:'Test BD Lead' } }]);
  if (m==='GET' && p==='/companies/co2/job-orders') return reply(route, [
    { id:'jo2', job_title:'Office Manager', status:'Active', created_at:new Date(NOW-3*D).toISOString(), bd_manager:{ name:'Neil Patrick' } }]);
  if (m==='GET' && /^\/clients\/[^/]+\/intel$/.test(p)) return reply(route, { enabled:false });
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
  // A click on something that is not there must FAIL the steps that follow,
  // never crash the run — a crash reports one failure and hides the rest.
  const clickEl = (sel) => page.evaluate((sel)=>{ const el=document.querySelector(sel); if(!el) return false; el.click(); return true; }, sel);
  const panelInfo = (id) => page.evaluate((id)=>{
    const tr=document.querySelector('#content tr[data-row-id="'+id+'"]');
    const nx=tr&&tr.nextElementSibling;
    return {
      rowFound: !!tr,
      panels: document.querySelectorAll('#content tr.row-exp').length,
      underIt: !!(nx&&nx.classList.contains('row-exp')),
      text: nx&&nx.classList.contains('row-exp') ? nx.innerText : '',
      html: nx&&nx.classList.contains('row-exp') ? nx.innerHTML : '',
      page: window.STATE.page,
    };
  }, id);

  // ════════════════════════════════════════════════════════════════════════
  // 1. JOBS — the row used to LEAVE the page
  // ════════════════════════════════════════════════════════════════════════
  await page.evaluate(()=>goPage('bd_joborders'));
  await page.waitForSelector('#content tr[data-row-id="jo1"]', { timeout:8000 }).catch(()=>{});
  const jQuiet = await page.evaluate(()=>({
    rows: document.querySelectorAll('#content tr[data-row-id]').length,
    panels: document.querySelectorAll('#content tr.row-exp').length,
  }));
  step('Jobs: rows carry ids', jQuiet.rows===3, jQuiet.rows+' rows');
  step('Jobs: quiet by default — no panel until asked', jQuiet.panels===0);

  await clickEl('#content tr[data-row-id="jo1"] td:nth-child(3)');
  await page.waitForTimeout(400);
  let j1 = await panelInfo('jo1');
  step('Jobs: one click opens ONE panel directly under that row', j1.panels===1 && j1.underIt);
  // Paired with the panel check: "still on the list" must not pass just
  // because the click found nothing to do.
  step('Jobs: it is NOT navigation — still on the Jobs list (it used to leave for the full job)',
    j1.underIt && j1.page==='bd_joborders', 'page='+j1.page);
  step('Jobs: who is on the job, by stage, arrives from the server',
    /2\s*Sourced/.test(j1.text) && /1\s*Submitted to BDM/.test(j1.text) && /1\s*Interview Scheduled/.test(j1.text), j1.text.replace(/\s+/g,' ').slice(0,160));
  step('Jobs: the owner is told what waits for their approval', /1 waiting for approval/.test(j1.text));
  step('Jobs: recruiters and the live apply page are stated', /Lisa Anderson/.test(j1.text) && /Live/.test(j1.text) && /3 applicants/.test(j1.text));
  const j1ctl = await page.evaluate(()=>{
    const p=document.querySelector('#content tr.row-exp');
    const sel=p&&p.querySelector('select[aria-label="Status"]');
    return { hasSel:!!sel, val:sel?sel.value:null,
      copy:!!(p&&[...p.querySelectorAll('button')].some(b=>/Copy link/.test(b.textContent))),
      open:!!(p&&[...p.querySelectorAll('button')].some(b=>/Open full job/.test(b.textContent))) };
  });
  step('Jobs: the owner gets the status control, showing the current status', j1ctl.hasSel && j1ctl.val==='Active', String(j1ctl.val));
  step('Jobs: the owner can copy the live apply link from the row', j1ctl.copy);
  step('Jobs: the full job is one explicit button away', j1ctl.open);
  await shot('jobs-desktop-light');

  // A job somebody else owns: seen, never touched — no control the server would refuse.
  await clickEl('#content tr[data-row-id="jo2"] td:nth-child(3)');
  await page.waitForTimeout(300);
  const j2 = await panelInfo('jo2');
  const j2ctl = await page.evaluate(()=>{
    const p=document.querySelector('#content tr.row-exp');
    return { sel:!!(p&&p.querySelector('select')),
      publish:!!(p&&[...p.querySelectorAll('button')].some(b=>/Publish|Copy link/.test(b.textContent))) };
  });
  step('Jobs: opening another row closes the first — only ever one panel', j2.panels===1 && j2.underIt);
  step("Jobs: someone else's job shows no status control and no publish/copy button",
    j2.rowFound && !j2ctl.sel && !j2ctl.publish);

  // Change a status from the panel: the row's badge moves AND the panel stays open.
  await clickEl('#content tr[data-row-id="jo1"] td:nth-child(3)');
  await page.waitForTimeout(300);
  await page.evaluate(()=>{ const sel=document.querySelector('#content tr.row-exp select[aria-label="Status"]');
    if(sel){ sel.value='On Hold'; sel.dispatchEvent(new Event('change',{bubbles:true})); } });
  await page.waitForTimeout(500);
  const put = calls.filter(c=>c.m==='PUT' && c.p==='/job-orders/jo1').pop();
  const afterPut = await panelInfo('jo1');
  const badge = await page.evaluate(()=>{ const tr=document.querySelector('#content tr[data-row-id="jo1"]'); return tr?tr.innerText:''; });
  step('Jobs: changing the status saves it (one PUT with the new status)', !!put && put.body && put.body.status==='On Hold');
  step("Jobs: the row's own status now reads On Hold", /On Hold/.test(badge));
  step('Jobs: …and the panel did NOT snap shut when the list redrew', afterPut.panels===1 && afterPut.underIt);

  // Second click on the same row closes it (and it must have been open).
  const wasOpen = (await panelInfo('jo1')).underIt;
  await clickEl('#content tr[data-row-id="jo1"] td:nth-child(3)');
  await page.waitForTimeout(250);
  step('Jobs: a second click closes it', wasOpen && (await panelInfo('jo1')).panels===0);

  // The exit: "Open full job" really opens the full job.
  await clickEl('#content tr[data-row-id="jo1"] td:nth-child(3)');
  await page.waitForTimeout(300);
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#content tr.row-exp button')].find(x=>/Open full job/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(700);
  const onDetail = await page.evaluate(()=>({ page:STATE.page, txt:(document.getElementById('content')||{}).innerText||'' }));
  step('Jobs: "Open full job" opens the full job page', onDetail.page==='bd_jodetail' && /HVAC Service Technician/.test(onDetail.txt), onDetail.page);

  // Leaving and coming back must not pop the old panel open again.
  await page.evaluate(()=>goPage('bd_joborders'));
  await page.waitForTimeout(600);
  await page.evaluate(()=>{ STATE.bd.jobOrders=STATE.bd.jobOrders.slice(); STATE.bd.jobOrders[2]=Object.assign({},STATE.bd.jobOrders[2],{job_title:'Estimator II'}); render(); });
  await page.waitForTimeout(200);
  step('Jobs: coming back to the list later does not pop an old panel open',
    await page.evaluate(()=>document.querySelectorAll('#content tr.row-exp').length===0));

  // ════════════════════════════════════════════════════════════════════════
  // 2. CANDIDATES — the name opened a drawer, every row carried a button
  // ════════════════════════════════════════════════════════════════════════
  await page.evaluate(()=>goPage('applicants'));
  await page.waitForSelector('#content tr[data-row-id="c0"]', { timeout:8000 }).catch(()=>{});
  const cQuiet = await page.evaluate(()=>{
    const body=document.querySelector('#content table.dt tbody');
    return {
      rows: document.querySelectorAll('#content tr[data-row-id]').length,
      rowButtons: body ? [...body.querySelectorAll('button')].filter(b=>/Add to Job/i.test(b.textContent)).length : -1,
      panels: document.querySelectorAll('#content tr.row-exp').length,
    };
  });
  step('Candidates: rows carry ids', cQuiet.rows===6, cQuiet.rows+' rows');
  step('Candidates: no "Add to Job" button on every row any more (it lives in the panel)', cQuiet.rowButtons===0, String(cQuiet.rowButtons));
  step('Candidates: quiet by default', cQuiet.panels===0);

  // Ticking a box selects — it must not open (or close) a panel.
  await clickEl('#content tr[data-row-id="c1"] input.ck');
  await page.waitForTimeout(250);
  const ticked = await page.evaluate(()=>({ sel:!!(STATE.ats.sel&&STATE.ats.sel.c1), panels:document.querySelectorAll('#content tr.row-exp').length }));
  step('Candidates: ticking the checkbox selects and opens nothing', ticked.sel && ticked.panels===0);

  // Clicking the NAME — it used to open the drawer — now opens the panel like the rest of the row.
  await clickEl('#content tr[data-row-id="c0"] .cell-id b');
  await page.waitForTimeout(500);
  const c0 = await panelInfo('c0');
  const drawerOpen = await page.evaluate(()=>!!(STATE.bd&&STATE.bd.profileOpen));
  step('Candidates: one click opens a panel under that row', c0.panels===1 && c0.underIt);
  step('Candidates: …not the drawer, and not navigation', c0.underIt && !drawerOpen && c0.page==='applicants');
  step('Candidates: the jobs they are on, with the stage', /HVAC Service Technician/.test(c0.text) && /Submitted to BDM/.test(c0.text), c0.text.replace(/\s+/g,' ').slice(0,200));
  // D-0057: inside a job everybody starts at Sourced — a person added before a stage was recorded reads Sourced, never "Tagged".
  step('Candidates: an added-only job reads Sourced (never Tagged), and a job is listed once', /Estimator/.test(c0.text) && /Sourced/.test(c0.text) && !/Tagged/.test(c0.text) && (c0.text.match(/HVAC Service Technician/g)||[]).length===1);
  step('Candidates: skills and the facts the columns do not already show', /EPA 608/.test(c0.text) && /6 yrs/.test(c0.text) && /2 weeks/.test(c0.text) && /USD 32/.test(c0.text));
  const cBtns = await page.evaluate(()=>[...document.querySelectorAll('#content tr.row-exp button')].map(b=>b.textContent.trim()));
  step('Candidates: "Add to job" and "Open full record" are in the panel',
    cBtns.some(t=>/Add to job/i.test(t)) && cBtns.some(t=>/Open full record/.test(t)), cBtns.join(' | '));
  await shot('candidates-desktop-light');
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#content tr.row-exp button')].find(x=>/Open full record/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(700);
  step('Candidates: "Open full record" opens the drawer', await page.evaluate(()=>!!(STATE.bd&&STATE.bd.profileOpen)));
  await page.evaluate(()=>{ if(window.cpClose) cpClose(); });
  await page.waitForTimeout(200);

  // ════════════════════════════════════════════════════════════════════════
  // 3. CLIENTS — the row opened a drawer
  // ════════════════════════════════════════════════════════════════════════
  await page.evaluate(()=>goPage('clients'));
  await page.waitForSelector('#content tr[data-row-id="co1"]', { timeout:8000 }).catch(()=>{});
  await clickEl('#content tr[data-row-id="co1"]');
  await page.waitForTimeout(500);
  const co1 = await panelInfo('co1');
  const co1Drawer = await page.evaluate(()=>!!STATE.clients.selectedId);
  step('Clients: one click opens a panel under that row', co1.panels===1 && co1.underIt);
  step('Clients: …not the drawer, and not navigation', co1.underIt && !co1Drawer && co1.page==='clients');
  step('Clients: its job orders, open ones first', /HVAC Service Technician[\s\S]*Estimator/.test(co1.text), co1.text.replace(/\s+/g,' ').slice(0,200));
  step("Clients: the owner is offered \"Email this client\"", /Email this client/.test(co1.text));
  await shot('clients-desktop-light');

  // A LIST REFRESH MUST NOT SNAP AN OPEN ROW SHUT — the rule the shared mechanism adds.
  await page.evaluate(()=>{ STATE.clients.list=STATE.clients.list.map(c=>c.id==='co2'?Object.assign({},c,{name:'Kaiker Homes Ltd'}):c); paintPageContent(); });
  await page.waitForTimeout(200);
  const refreshed = await page.evaluate(()=>({
    renamed: /Kaiker Homes Ltd/.test(document.getElementById('content').innerText),
    under: (()=>{ const tr=document.querySelector('#content tr[data-row-id="co1"]'); const nx=tr&&tr.nextElementSibling; return !!(nx&&nx.classList.contains('row-exp')); })(),
    panels: document.querySelectorAll('#content tr.row-exp').length,
  }));
  step('Clients: the list really redrew (the refresh is real)', refreshed.renamed);
  step('Clients: …and the open panel is back under its row, one of it', refreshed.under && refreshed.panels===1);

  // Not the owner: no "Email this client" — in the panel OR the drawer (the server refuses it).
  await clickEl('#content tr[data-row-id="co2"]');
  await page.waitForTimeout(400);
  const co2 = await panelInfo('co2');
  step("Clients: someone else's client is not offered \"Email this client\" in the panel", co2.underIt && !/Email this client/.test(co2.text));
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#content tr.row-exp button')].find(x=>/Open full record/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(600);
  const co2Drawer = await page.evaluate(()=>{
    const acts=[...document.querySelectorAll('#layer .dwr-act')].map(a=>a.getAttribute('title')||'');
    return { open: STATE.clients.selectedId==='co2', acts };
  });
  step('Clients: "Open full record" opens the drawer', co2Drawer.open);
  step("Clients: …whose actions no longer include an email the server would refuse",
    co2Drawer.acts.length>0 && !co2Drawer.acts.some(t=>/Email this client/.test(t)), co2Drawer.acts.join(' | '));
  await page.evaluate(()=>{ if(window.clientsBack) clientsBack(); });
  await page.waitForTimeout(200);

  // ════════════════════════════════════════════════════════════════════════
  // 4. PHONE — the panel must be readable without scrolling the table sideways
  // ════════════════════════════════════════════════════════════════════════
  await page.setViewportSize({ width:390, height:844 });
  for (const [pg, id, name] of [['bd_joborders','jo1','jobs'],['applicants','c0','candidates'],['clients','co1','clients']]) {
    await page.evaluate((pg)=>goPage(pg), pg);
    await page.waitForSelector('#content tr[data-row-id="'+id+'"]', { timeout:8000 }).catch(()=>{});
    await page.evaluate((id)=>{ const tr=document.querySelector('#content tr[data-row-id="'+id+'"]'); if(tr) tr.click(); }, id);
    await page.waitForTimeout(500);
    const fit = await page.evaluate(()=>{
      const p=document.querySelector('#content tr.row-exp .lx');
      if(!p) return { missing:true };
      const r=p.getBoundingClientRect();
      const btn=[...p.querySelectorAll('button')].find(b=>/Open full/.test(b.textContent));
      const br=btn?btn.getBoundingClientRect():null;
      return { left:Math.round(r.left), right:Math.round(r.right), vw:window.innerWidth,
               btnRight: br?Math.round(br.right):null };
    });
    step(`Phone (${name}): the panel fits the screen — nothing to scroll sideways for`,
      !fit.missing && fit.left>=0 && fit.right<=fit.vw, fit.missing?'panel missing':`${fit.left}→${fit.right} of ${fit.vw}`);
    step(`Phone (${name}): its "Open full …" button is on screen`,
      !fit.missing && fit.btnRight!=null && fit.btnRight<=fit.vw, String(fit.btnRight));
    await shot(name+'-phone-light');
  }
  if (SHOTS) {
    await page.evaluate(()=>{ if(window.toggleTheme) toggleTheme(); });
    await page.waitForTimeout(300);
    await shot('clients-phone-dark');
    await page.setViewportSize({ width:1440, height:900 });
    await page.evaluate(()=>goPage('bd_joborders'));
    await page.waitForSelector('#content tr[data-row-id="jo1"]', { timeout:8000 }).catch(()=>{});
    await page.evaluate(()=>{ const tr=document.querySelector('#content tr[data-row-id="jo1"]'); if(tr) tr.click(); });
    await page.waitForTimeout(500);
    await shot('jobs-desktop-dark');
    await page.evaluate(()=>{ if(window.toggleTheme) toggleTheme(); });
  }

  step('nothing threw', pageErrors.length===0, pageErrors.slice(0,2).join(' | '));
} catch (e) {
  step('the run reached its end', false, String(e && e.message || e).slice(0,200));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed=results.filter(r=>!r).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
