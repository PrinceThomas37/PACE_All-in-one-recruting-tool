// THE POC FINDER ON THE LEAD ROW (R-053, D-0049) — 62-poc-finder.js in a real
// browser, against a stub API whose answers are built by the REAL rules
// (services/poc-targets.js), never hand-typed.
//
// Pins:
//   * the plain contact list shows first and stays if the server never
//     answers; the four slots then take its place IN THE SAME ELEMENT, with no
//     render() (the table and the list survive as the same DOM nodes);
//   * every person on the lead is on screen, each with the valid/invalid email
//     control the owner once could not find;
//   * the size pick sends the size and redraws from the answer;
//   * Add by hand fills the email from the company's LEARNED format as a name is
//     typed — and when no format is learned it leaves the email empty and says
//     it will not guess (D-0049);
//   * `pocEmailFor` in the page is a checked copy of poc-targets.emailFor;
//   * someone who can see but not work the lead gets no controls;
//   * the block fits a 390px phone.
//   * SLICE 2: "Find the rest" is drawn ONLY when the server would do it
//     (Apollo connected, a slot open with nobody waiting, the caller works the
//     lead); found people show in their slot with how sure the email is
//     (Confirmed / Likely / none — never a guess); Accept puts them on the lead
//     as an ordinary contact with the email control; Not this person takes
//     them off and they do not come back; a LinkedIn link is only ever a real
//     https linkedin.com address; only an admin is told how to connect Apollo.
// SHOTS=<dir> writes screenshots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const poc = require('../services/poc-targets.js');

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

// ── the stub's world ────────────────────────────────────────────────────────
const NOW = Date.now(), D = 86400000;
const companies = {
  co1: { id:'co1', name:'Acme Builders', website:'https://www.acmebuild.com', industry:'Construction', size_band:null },
  co2: { id:'co2', name:'Newco Mechanical', website:'newcomech.com', industry:'Construction', size_band:null },
  co3: { id:'co3', name:'Viewonly Inc', website:'viewonly.com', industry:'Construction', size_band:null },
};
const jobs = [
  { id:'j1', company_id:'co1', position:'Junior Estimator', industry:'Construction', stage:'Assigned', assigned_to_bd:'test-bd', created_at:new Date(NOW-D).toISOString() },
  { id:'j2', company_id:'co2', position:'HVAC Service Technician', industry:'Construction', stage:'Assigned', assigned_to_bd:'test-bd', created_at:new Date(NOW-2*D).toISOString() },
  { id:'j3', company_id:'co3', position:'Project Manager', industry:'Construction', stage:'Assigned', assigned_to_bd:'someone-else', created_at:new Date(NOW-3*D).toISOString() },
];
const contacts = [
  { id:'c1', job_id:'j1', first_name:'Maria', last_name:'Lopez', designation:'HR Manager', email:'mlopez@acmebuild.com', is_primary:true, email_status:'valid' },
  { id:'c2', job_id:'j1', first_name:'John', last_name:'Carter', designation:'President', email:'jcarter@acmebuild.com', is_primary:false, email_status:'valid' },
  { id:'c3', job_id:'j1', first_name:'Amy', last_name:'Stone', designation:'Attorney', email:'astone@acmebuild.com', is_primary:false, email_status:'valid' },
  // Newco: one person on a FREE-MAIL address → no company format can be learned.
  { id:'c4', job_id:'j2', first_name:'Ann', last_name:'Wells', designation:'Owner', email:'annwells@gmail.com', is_primary:true, email_status:'valid' },
  { id:'c5', job_id:'j3', first_name:'Raj', last_name:'Patel', designation:'Operations Manager', email:'rpatel@viewonly.com', is_primary:true, email_status:'valid' },
];
const CAN_EDIT = { j1:true, j2:true, j3:false };
// Slice 2: the fake Apollo, and the people it has already found.
const FINDER = { apollo:false, is_admin:false, used:0, limit:20 };
const APOLLO = {
  co2: [
    { id:'ap-grace', first_name:'Grace', last_name:'Hill', title:'HR Manager', verified:'grace.hill@newcomech.com' },
    // Apollo holds only a guess for him → no email; and a link that is not a link
    { id:'ap-omar', first_name:'Omar', last_name:'Diaz', title:'Office Manager', verified:null, linkedin_url:'javascript:alert(1)' },
    { id:'ap-tom', first_name:'Tom', last_name:'Reyes', title:'Service Manager', verified:'treyes@newcomech.com', linkedin_url:'https://www.linkedin.com/in/tomreyes' },
  ],
  co1: [ { id:'ap-kim', first_name:'Kim', last_name:'Park', title:'Co-Owner', verified:null } ],
};
// One found earlier on the lead this user may only look at.
const suggs = [
  { id:'s-ro', job_id:'j3', slot_key:'hr1', first_name:'Rita', last_name:'Viewer', title:'HR Manager', email:null, email_confidence:null, email_source:null,
    source:'apollo', source_ref:'ap-rita', linkedin_url:null, status:'suggested' },
];
let findDelay = 0;
// "Find the rest", the way routes/poc.js decides it: the REAL pickPeople picks
// who goes in which empty slot; a Likely address only from a learned format;
// otherwise Apollo's verified one; otherwise none.
function stubFind(id){
  const j = jobs.find(x => x.id === id), co = companies[j.company_id];
  const cs = contacts.filter(c => c.job_id === id);
  const sameCo = contacts.filter(c => jobs.find(x => x.id === c.job_id).company_id === j.company_id);
  const t = poc.pocTargets({ position:j.position, industry:j.industry }, co.size_band);
  const f = poc.fillSlots(t, cs), fmt = poc.learnFormat(sameCo, co.website);
  const mine = suggs.filter(x => x.job_id === id);
  const picks = poc.pickPeople(f.slots, APOLLO[co.id] || [],
    { ids: mine.map(x => x.source_ref), names: sameCo.map(c => c.first_name+' '+c.last_name) }, t.size,
    mine.filter(x => x.status === 'suggested').map(x => x.slot_key));
  picks.forEach(({ slot_key, person }) => {
    let email = poc.emailFor(person.first_name, person.last_name, fmt), conf = email ? 'likely' : null, src = email ? 'format' : null;
    if (!email && person.verified) { email = person.verified; conf = 'confirmed'; src = 'apollo'; FINDER.used++; }
    suggs.push({ id:'s-'+person.id, job_id:id, slot_key, first_name:person.first_name, last_name:person.last_name, title:person.title,
      email, email_confidence:conf, email_source:src, source:'apollo', source_ref:person.id, linkedin_url:person.linkedin_url||null, status:'suggested' });
  });
  return { added:picks.length, message: picks.length ? `Found ${picks.length} ${picks.length===1?'person':'people'} — accept the ones you want on this lead.` : 'Nobody new to suggest.' };
}
// The payload GET /jobs/:id/poc returns — assembled with the REAL rules, the
// same way routes/poc.js does (that file's own test pins the route itself).
function pocPayload(id){
  const j = jobs.find(x => x.id === id), co = companies[j.company_id];
  const cs = contacts.filter(c => c.job_id === id);
  const sameCo = contacts.filter(c => jobs.find(x => x.id === c.job_id).company_id === j.company_id);
  const t = poc.pocTargets({ position:j.position, industry:j.industry }, co.size_band);
  const f = poc.fillSlots(t, cs);
  const fmt = poc.learnFormat(sameCo, co.website);
  return { lead_id:id, company_id:co.id, company_name:co.name, size:t.size, size_known:t.size_known, sizes:poc.SIZE_BANDS,
    function:t.function, slots:f.slots.map(s => ({ key:s.key, kind:s.kind, label:s.label, titles:s.titles, contact_id:s.contact_id })),
    others:f.others, found:f.slots.filter(s => s.contact_id).length,
    format:{ domain:fmt.domain, pattern:fmt.pattern, learned_from:fmt.learned_from, example:fmt.pattern ? poc.emailFor('Jane','Smith',fmt) : null },
    suggestions: suggs.filter(x => x.job_id === id && x.status === 'suggested').map(x => ({ id:x.id, slot_key:x.slot_key, first_name:x.first_name,
      last_name:x.last_name, title:x.title, email:x.email, email_confidence:x.email_confidence, email_source:x.email_source, source:x.source, linkedin_url:x.linkedin_url })),
    finder:{ apollo:FINDER.apollo, credits:{ used:FINDER.used, limit:FINDER.limit }, is_admin:FINDER.is_admin },
    can_edit:CAN_EDIT[id] };
}
function rawJobs(){
  return jobs.map(j => ({ id:j.id, company_id:j.company_id, company:{ name:companies[j.company_id].name, industry:j.industry, website:companies[j.company_id].website },
    position:j.position, location:'Austin, TX', stage:j.stage, assigned_to_bd:j.assigned_to_bd, bd_assignee:{ name:'Test BD' },
    assigned_at:j.created_at, created_at:j.created_at, industry:j.industry, contacts:contacts.filter(c => c.job_id === j.id) }));
}
const calls = [];
let pocDelay = 600;
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
async function api(route){
  const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
  let body = null; try { body = req.postDataJSON(); } catch(_) {}
  calls.push({ m, p, body });
  let hit;
  if (m==='GET' && (hit = p.match(/^\/jobs\/([^/]+)\/poc$/))) {
    await new Promise(r => setTimeout(r, pocDelay));
    return reply(route, pocPayload(hit[1]));
  }
  if (m==='PUT' && (hit = p.match(/^\/jobs\/([^/]+)\/company-size$/))) {
    const j = jobs.find(x => x.id === hit[1]); companies[j.company_id].size_band = body.size || null;
    return reply(route, pocPayload(hit[1]));
  }
  if (m==='POST' && (hit = p.match(/^\/jobs\/([^/]+)\/poc\/find$/))) {
    await new Promise(r => setTimeout(r, findDelay));
    const result = stubFind(hit[1]);
    return reply(route, Object.assign(pocPayload(hit[1]), { result }));
  }
  if (m==='POST' && (hit = p.match(/^\/jobs\/([^/]+)\/poc\/suggestions\/([^/]+)\/(accept|reject)$/))) {
    const sg = suggs.find(x => x.id === hit[2] && x.job_id === hit[1]);
    if (!sg || sg.status !== 'suggested') return reply(route, { error:'Somebody has already decided on this person.' }, 409);
    if (hit[3] === 'reject') { sg.status = 'rejected'; return reply(route, pocPayload(hit[1])); }
    const c = { id:'c-'+sg.source_ref, job_id:hit[1], first_name:sg.first_name, last_name:sg.last_name, designation:sg.title, email:sg.email, is_primary:false, email_status:'valid' };
    contacts.push(c); sg.status = 'accepted';
    return reply(route, Object.assign(pocPayload(hit[1]), { contact:{ id:c.id }, already_on_lead:false }));
  }
  if (m==='POST' && p==='/contacts') {
    const c = Object.assign({ id:'new'+calls.length, email_status:'valid' }, body); contacts.push(c);
    return reply(route, c, 201);
  }
  if (m==='GET' && p==='/jobs') return reply(route, rawJobs());
  return reply(route, m==='GET' ? [] : {});
}

let browser;
const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**',r=>{ const u=r.request().url();
    if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)) return api(r); return r.abort(); });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd');
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name+'.png') }); };
  const clickEl = (sel) => page.evaluate((sel)=>{ const el=document.querySelector(sel); if(!el) return false; el.click(); return true; }, sel);
  await page.evaluate((raw)=>{
    STATE.jobs=raw.map(normaliseJob); STATE.contacts=flattenContacts(raw); STATE.leads=STATE.jobs;
    STATE.page='leads'; render();
  }, rawJobs());
  await page.waitForTimeout(300);

  // ── 1. plain list first, slots in the same place, no render() ───────────
  const tbl = await page.evaluateHandle(()=>document.querySelector('#content table'));
  await clickEl('#content tr[data-row-id="j1"] td:nth-child(3)');
  await page.waitForTimeout(150);
  const early = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j1');
    return { exists:!!b, plain: !!(b && /contacts/i.test(b.innerText) && b.querySelector('select.lx-sel')), slots: !!(b && b.querySelector('.lxc')) }; });
  step('the block is on the opened row', early.exists);
  step('until the server answers, the plain contact list shows (with its email control)', early.plain && !early.slots, JSON.stringify(early));
  await page.waitForTimeout(900);
  const slots = await page.evaluate((tbl)=>{
    const b=document.getElementById('lx-poc-j1'); if(!b) return { missing:true };
    return { missing:false, lxc: !!b.querySelector('.lxc'), text: b.innerText,
      filled: b.querySelectorAll('.lxc-slot.is-filled').length, empty: b.querySelectorAll('.lxc-slot.is-empty').length,
      selects: b.querySelectorAll('.lxc-slot.is-filled select.lx-sel').length,
      sameTable: document.querySelector('#content table') === tbl };
  }, tbl);
  step('then the four slots take its place', !slots.missing && slots.lxc, slots.missing?'missing':'');
  // Headings are drawn in capitals, and innerText reports them that way.
  step('HR and hiring-manager groups, "2 of 4 found"', /\bHR\b/.test(slots.text) && /hiring managers/i.test(slots.text) && /2 of 4 found/i.test(slots.text));
  step('the two empty slots say which title is being looked for', slots.empty === 2 && /Looking for:/.test(slots.text));
  step('EVERY person on the lead is on screen — the attorney too, under "Also on this lead"',
    /Maria Lopez/.test(slots.text) && /John Carter/.test(slots.text) && /Amy Stone/.test(slots.text) && /also on this lead/i.test(slots.text));
  step('each person keeps the valid/invalid email control', slots.selects === 3, String(slots.selects));
  step('the slots arrived without a render() — the table is the same node', slots.sameTable === true);
  step('the size is shown as not set, and why it matters', /company size/i.test(slots.text) && /Assuming 20–50/.test(slots.text));
  step('with Apollo not connected there is NO "Find the rest" — never a button the server would refuse', !/Find the rest/.test(slots.text));
  step('…and a non-admin is not told to connect it (they cannot)', !/Connect Apollo/.test(slots.text));
  await shot('poc-slots-desktop');

  // ── 2. the size pick ────────────────────────────────────────────────────
  await page.evaluate(()=>{ const s=document.querySelector('#lx-poc-j1 select.lxc-size'); if(s){ s.value='1-20'; s.dispatchEvent(new Event('change',{bubbles:true})); } });
  await page.waitForTimeout(500);
  const put = calls.filter(c => c.m==='PUT').pop();
  const afterSize = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j1'); return b?b.innerText:''; });
  step('picking a size sends it', !!put && put.p==='/jobs/j1/company-size' && put.body && put.body.size==='1-20', put && JSON.stringify(put.body));
  step('…and the slots redraw from the answer (under 20: looking at the owner side)', /company size/i.test(afterSize) && !/Assuming 20–50/.test(afterSize));

  // ── 3. Add by hand, with a learned format ───────────────────────────────
  const opened = await page.evaluate(()=>{ const b=[...document.querySelectorAll('#lx-poc-j1 .lxc-slot.is-empty button')].find(x=>/Add by hand/.test(x.textContent)); if(!b) return false; b.click(); return true; });
  await page.waitForTimeout(200);
  step('an empty slot offers Add by hand', opened);
  await page.fill('#lxc-name-j1', 'Dave Reed').catch(()=>{});
  await page.waitForTimeout(150);
  const filledEmail = await page.evaluate(()=>{ const e=document.getElementById('lxc-email-j1'); return e?e.value:null; });
  const serverSays = poc.emailFor('Dave','Reed', poc.learnFormat(contacts.filter(c=>c.job_id==='j1'), companies.co1.website));
  step('typing a name fills the email from the company\'s LEARNED format', filledEmail === 'dreed@acmebuild.com' && filledEmail === serverSays, String(filledEmail));
  const note = await page.evaluate(()=>{ const n=document.querySelector('#lx-poc-j1 .lxc-note'); return n?n.innerText:''; });
  step('…and says where it came from', /learned from 3 real addresses at acmebuild\.com/.test(note), note);
  await shot('poc-add-by-hand');
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#lx-poc-j1 .lxc-form button')].find(x=>/Add to this lead/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(1500);
  const post = calls.filter(c => c.m==='POST' && c.p==='/contacts').pop();
  step('saving sends the person with that exact email to the existing contact endpoint',
    !!post && post.body.job_id==='j1' && post.body.first_name==='Dave' && post.body.last_name==='Reed' && post.body.email==='dreed@acmebuild.com',
    post && JSON.stringify(post.body));
  step('…with the slot\'s title filled in', !!post && typeof post.body.designation==='string' && post.body.designation.length>2, post && post.body.designation);
  const afterAdd = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j1'); return b?b.innerText:''; });
  step('the new person is on the lead\'s row after the list reloads', /Dave Reed/.test(afterAdd), afterAdd.slice(0,80));

  // ── 4. no learned format → no guess (D-0049) ────────────────────────────
  await clickEl('#content tr[data-row-id="j2"] td:nth-child(3)');
  await page.waitForTimeout(1000);
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#lx-poc-j2 .lxc-slot.is-empty button')].find(x=>/Add by hand/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(200);
  await page.fill('#lxc-name-j2', 'Bob Marsh').catch(()=>{});
  await page.waitForTimeout(150);
  const noGuess = await page.evaluate(()=>{ const e=document.getElementById('lxc-email-j2'), n=document.querySelector('#lx-poc-j2 .lxc-note');
    return { form: !!e, email: e ? e.value : null, note: n ? n.innerText : '' }; });
  step('with no format learned (only a gmail address on file), NO email is filled in',
    noGuess.form && noGuess.email === '', JSON.stringify(noGuess.email));
  step('…and the form says PACE will not guess one', /will not guess/.test(noGuess.note), noGuess.note);

  // ── 5. the checked copy ─────────────────────────────────────────────────
  const CASES = [['Dave','Reed','flast'],['Zoë',"O'Brien",'first.last'],['Mary','Smith-Jones','firstlast'],['Li','Wu','firstl'],
    ['José','Núñez','first_last'],['Ann','Lee','f.last'],['Bo','Ray','last'],['Cher','','first'],['Cher','','flast'],['Tom','Hardy',null]];
  const inPage = await page.evaluate((cases)=>cases.map(c=>window.pocEmailFor(c[0],c[1],{domain:'x.com',pattern:c[2]})), CASES);
  const inNode = CASES.map(c => poc.emailFor(c[0], c[1], { domain:'x.com', pattern:c[2] }));
  step('the page\'s pocEmailFor agrees with the server\'s emailFor on every case',
    JSON.stringify(inPage) === JSON.stringify(inNode), JSON.stringify(inPage));

  // ── 6. someone who can see but not work the lead ────────────────────────
  await clickEl('#content tr[data-row-id="j3"] td:nth-child(3)');
  await page.waitForTimeout(1000);
  const ro = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j3'); if(!b) return { missing:true };
    return { missing:false, lxc: !!b.querySelector('.lxc'), size: !!b.querySelector('select.lxc-size'),
      add: [...b.querySelectorAll('button')].some(x=>/Add by hand/.test(x.textContent)),
      found: /Rita Viewer/.test(b.innerText),
      answer: [...b.querySelectorAll('button')].some(x=>/Accept|Not this person|Find the rest/.test(x.textContent)) }; });
  step('a viewer who does not work the lead sees the slots', !ro.missing && ro.lxc);
  step('…but no size pick and no Add by hand', !ro.missing && !ro.size && !ro.add, JSON.stringify(ro));
  step('…sees a person found for it, but cannot accept or turn them down', !ro.missing && ro.found && !ro.answer, JSON.stringify(ro));

  // ── 6b. slice 2: Find the rest, Accept, Not this person ─────────────────
  FINDER.apollo = true;
  pocDelay = 50; findDelay = 500;
  await page.evaluate(()=>{ STATE.leadPoc = {}; });
  await clickEl('#content tr[data-row-id="j2"] td:nth-child(3)');
  await page.waitForTimeout(400);
  const btn0 = await page.evaluate(()=>{ const b=[...document.querySelectorAll('#lx-poc-j2 button')].find(x=>/Find the rest/.test(x.textContent)); return !!b; });
  step('with Apollo connected and slots open, "Find the rest" is offered', btn0);
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#lx-poc-j2 button')].find(x=>/Find the rest/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(150);
  const busy = await page.evaluate(()=>{ const b=document.querySelector('#lx-poc-j2 .lxc-find'); return b ? { text:b.textContent, disabled:b.disabled } : null; });
  step('while it looks, the button says so and cannot be pressed twice', !!busy && /Looking/.test(busy.text) && busy.disabled === true, JSON.stringify(busy));
  await page.waitForTimeout(700);
  const findCall = calls.filter(c => c.m==='POST' && /\/poc\/find$/.test(c.p)).pop();
  step('it asks the server for THIS lead', !!findCall && findCall.p === '/jobs/j2/poc/find');
  const fnd = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j2'); if(!b) return { missing:true };
    const cards=[...b.querySelectorAll('.lxc-slot.is-found')];
    return { missing:false, text:b.innerText, cards:cards.length,
      confirmed:b.querySelectorAll('.lxc-conf.is-confirmed').length, likely:b.querySelectorAll('.lxc-conf.is-likely').length,
      noEmail:cards.filter(c=>/No email/.test(c.innerText)).length,
      find:[...b.querySelectorAll('button')].some(x=>/Find the rest/.test(x.textContent)),
      links:[...b.querySelectorAll('.lxc-found-src a')].map(a=>({ href:a.getAttribute('href'), rel:a.getAttribute('rel'), target:a.getAttribute('target') })),
      jsLink: !!b.querySelector('a[href^="javascript"]'),
      accept:[...b.querySelectorAll('.lxc-found-acts button')].filter(x=>/Accept/.test(x.textContent)).length }; });
  step('three people found, each in the slot they were found for', !fnd.missing && fnd.cards === 3, String(fnd.cards));
  step('the answer is said in a sentence, and the count reads "3 to review"', /Found 3 people/.test(fnd.text) && /3 to review/i.test(fnd.text));
  step('each email says how sure it is: 2 Confirmed, 1 with no email (Apollo only had a guess)', fnd.confirmed === 2 && fnd.noEmail === 1 && fnd.likely === 0, JSON.stringify(fnd));
  step('the guess itself never reaches the page', !/omar\.diaz@|odiaz@/i.test(fnd.text));
  step('every slot now has somebody or somebody waiting, so the button is gone', fnd.find === false);
  step('a real LinkedIn address becomes a safe link; a "javascript:" one never becomes a link',
    fnd.links.length === 1 && fnd.links[0].href === 'https://www.linkedin.com/in/tomreyes' && /noopener/.test(fnd.links[0].rel) && fnd.links[0].target === '_blank' && !fnd.jsLink, JSON.stringify(fnd.links));
  step('each can be accepted', fnd.accept === 3, String(fnd.accept));
  step('the credits line shows what today has cost', /Apollo: 2 of 20 credits used today/.test(fnd.text), (fnd.text.match(/Apollo:[^\n]*/)||[''])[0]);
  if (SHOTS) { await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j2'); if(b) b.scrollIntoView({block:'start'}); }); await page.waitForTimeout(150); }
  await shot('poc-found-desktop');
  // A found person exists only after "Find the rest", so the app-wide theme
  // suite never draws one (CLAUDE.md: a palette has states). Measured here, in
  // both themes, the way that suite does it: every translucent ground under
  // the text composited down to what the eye really sees.
  for (const theme of ['light', 'dark']) {
    const bad = await page.evaluate((theme)=>{
      document.documentElement.setAttribute('data-theme', theme);
      const parse=(c)=>{ const m=String(c).match(/rgba?\(([^)]+)\)/); if(!m) return null; const p=m[1].split(',').map(x=>parseFloat(x.trim())); return { r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1 }; };
      const lin=(v)=>{ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
      const lum=(c)=>0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
      const over=(f,b)=>({ r:f.r*f.a+b.r*(1-f.a), g:f.g*f.a+b.g*(1-f.a), b:f.b*f.a+b.b*(1-f.a), a:1 });
      const ground=(el)=>{ const st=[]; for(let n=el;n&&n!==document.documentElement;n=n.parentElement){ const cs=getComputedStyle(n);
          if(cs.backgroundImage&&cs.backgroundImage!=='none') return null; const c=parse(cs.backgroundColor); if(c&&c.a>0){ st.push(c); if(c.a===1) break; } }
        let acc=parse(getComputedStyle(document.documentElement).backgroundColor)||{r:255,g:255,b:255,a:1}; if(acc.a===0) acc={r:255,g:255,b:255,a:1};
        for(let i=st.length-1;i>=0;i--) acc=over(st[i],acc); return acc; };
      const out=[]; let judged=0;
      document.querySelectorAll('#lx-poc-j2 .lxc-slot.is-found *, #lx-poc-j2 .lxc-msg, #lx-poc-j2 .lxc-credits').forEach(el=>{
        // The element's OWN text — a name shares its element with the title
        // span, and judging leaves only would never measure the name.
        const t=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim(); if(t.length<2) return;
        const cs=getComputedStyle(el), fg=parse(cs.color), bg=ground(el); if(!fg||!bg) return; judged++;
        const c=over(fg,bg), a=lum(c), b=lum(bg), r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
        if(r<2.2) out.push(t.slice(0,24)+' '+Math.round(r*100)/100);
      });
      return { judged, out };
    }, theme);
    step(`found-person cards are readable in ${theme} (every text ≥ 2.2:1, ${bad.judged} measured)`, bad.judged >= 12 && bad.out.length === 0, bad.out.join(' | '));
  }
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));

  // Accept Grace.
  await page.evaluate(()=>{ const card=[...document.querySelectorAll('#lx-poc-j2 .lxc-slot.is-found')].find(c=>/Grace Hill/.test(c.innerText));
    const b=card && [...card.querySelectorAll('button')].find(x=>/Accept/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(1200);
  const accCall = calls.filter(c => c.m==='POST' && /\/accept$/.test(c.p)).pop();
  step('Accept asks the server to add THAT person to THIS lead', !!accCall && accCall.p === '/jobs/j2/poc/suggestions/s-ap-grace/accept', accCall && accCall.p);
  const acc = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j2'); if(!b) return { missing:true };
    const filled=[...b.querySelectorAll('.lxc-slot.is-filled')].find(c=>/Grace Hill/.test(c.innerText));
    return { missing:false, text:b.innerText, filled:!!filled, control: !!(filled && filled.querySelector('select.lx-sel')),
      stillCard: [...b.querySelectorAll('.lxc-slot.is-found')].some(c=>/Grace Hill/.test(c.innerText)) }; });
  step('she is now on the lead as an ordinary contact — with the email control', acc.filled && acc.control && !acc.stillCard, JSON.stringify({ filled:acc.filled, control:acc.control, stillCard:acc.stillCard }));
  step('"2 of 4 found · 2 to review"', /2 of 4 found/i.test(acc.text) && /2 to review/i.test(acc.text), (acc.text.match(/\d of 4 found[^\n]*/i)||[''])[0]);

  // Not this person: Omar.
  await page.evaluate(()=>{ const card=[...document.querySelectorAll('#lx-poc-j2 .lxc-slot.is-found')].find(c=>/Omar Diaz/.test(c.innerText));
    const b=card && [...card.querySelectorAll('button')].find(x=>/Not this person/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(500);
  const rej = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j2'); return b ? { text:b.innerText,
    find:[...b.querySelectorAll('button')].some(x=>/Find the rest/.test(x.textContent)) } : null; });
  step('"Not this person" takes him off, and his slot is open again', !!rej && !/Omar Diaz/.test(rej.text) && /Looking for:/.test(rej.text));
  step('…so "Find the rest" is offered again', !!rej && rej.find === true);
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#lx-poc-j2 button')].find(x=>/Find the rest/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(900);
  const again = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j2'); return b ? b.innerText : ''; });
  step('asked again, the person turned down does not come back', !/Omar Diaz/.test(again) && /Nobody new/.test(again), (again.match(/Nobody new[^\n]*/)||[''])[0]);

  // A Likely address, from the company's own format.
  await clickEl('#content tr[data-row-id="j1"] td:nth-child(3)');
  await page.waitForTimeout(400);
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#lx-poc-j1 button')].find(x=>/Find the rest/.test(x.textContent)); if(b) b.click(); });
  await page.waitForTimeout(900);
  const lk = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j1'); if(!b) return { missing:true };
    const card=[...b.querySelectorAll('.lxc-slot.is-found')].find(c=>/Kim Park/.test(c.innerText));
    return { missing:false, card: card ? card.innerText : '', likely: !!(card && card.querySelector('.lxc-conf.is-likely')) }; });
  step('an address built from the company\'s own format is marked Likely, and says so',
    lk.likely && /kpark@acmebuild\.com/.test(lk.card) && /built from their format \(first initial \+ surname\)/.test(lk.card), lk.card);

  // Only an admin is told how to connect Apollo.
  FINDER.apollo = false; FINDER.is_admin = true;
  await page.evaluate(()=>{ STATE.leadPoc = {}; });
  await clickEl('#content tr[data-row-id="j2"] td:nth-child(3)');
  await page.waitForTimeout(400);
  const adm = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j2'); return b ? b.innerText : ''; });
  step('an admin with Apollo not connected is told where to connect it', /Connect Apollo in Admin → Integrations/.test(adm));
  FINDER.apollo = true; FINDER.is_admin = false;
  await page.evaluate(()=>{ STATE.leadPoc = {}; });

  // ── 7. phone ────────────────────────────────────────────────────────────
  await page.setViewportSize({ width:390, height:900 });
  await clickEl('#content tr[data-row-id="j1"] td:nth-child(3)');
  await page.waitForTimeout(900);
  const fit = await page.evaluate(()=>{ const b=document.querySelector('#lx-poc-j1 .lxc'); if(!b) return { missing:true };
    const r=b.getBoundingClientRect(); return { missing:false, left:Math.round(r.left), right:Math.round(r.right), vw:window.innerWidth }; });
  step('on a 390px phone the block fits the screen', !fit.missing && fit.left>=0 && fit.right<=fit.vw, fit.missing?'missing':`${fit.left}→${fit.right} of ${fit.vw}`);
  const acts = await page.evaluate(()=>{ const bs=[...document.querySelectorAll('#lx-poc-j1 .lxc-found-acts button')];
    return { n:bs.length, worst: Math.max(0, ...bs.map(b=>Math.round(b.getBoundingClientRect().right))), vw:window.innerWidth }; });
  step('…and so do Accept / Not this person on a found person\'s card', acts.n === 2 && acts.worst <= acts.vw, JSON.stringify(acts));
  if (SHOTS) { await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j1'); if(b) b.scrollIntoView({block:'start'}); }); await page.waitForTimeout(150); }
  await shot('poc-slots-phone');

  // ── 8. the server never answers → the plain list stays ──────────────────
  pocDelay = 60000;
  await page.setViewportSize({ width:1440, height:1000 });
  await page.evaluate(()=>{ STATE.leadPoc = {}; });
  await clickEl('#content tr[data-row-id="j2"] td:nth-child(3)');
  await page.waitForTimeout(400);
  const stuck = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j2'); return { plain: !!(b && b.querySelector('select.lx-sel')), text: b ? b.innerText : '' }; });
  step('if the server never answers, the plain list stays — never a blank block', stuck.plain && /Ann Wells/.test(stuck.text));

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
