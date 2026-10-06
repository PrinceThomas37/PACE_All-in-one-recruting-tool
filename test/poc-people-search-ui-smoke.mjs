// "FIND ANYONE AT <COMPANY>" — the POC finder's title search and Uncover
// (R-068, D-0055), and the Apollo card's daily limit (R-066, D-0054), in a
// real browser against a stub API whose "already added" answer is built by the
// SERVER's own duplicatePayload, and whose slots come from the REAL rules.
//
// Owner, 2026-09-28: "a search bar to search for title or similar title and
// that will search in the employee list from apollo and show us, and we can
// click on to see and select which contact we want to uncover" — and "give the
// admin to set what's the number of credit that can be used per day for all
// users".
//
// Pins:
//   * the search box is drawn only when the server would search (Apollo
//     connected, the caller works the lead); typing a title and pressing ENTER
//     searches for exactly that title; results say who is on file, who is free
//     to uncover and what uncovering costs;
//   * Uncover sends the ONE person picked; they then wait in the block with
//     Accept, the row reads "Waiting below", and the typed title survives the
//     repaint;
//   * somebody already in PACE → the "Already added" pop-up, and the row reads
//     "On file"; a used-up day → the server's sentence, in red;
//   * somebody outside the four roles waits under "Other people you picked";
//   * the Apollo card shows today's use beside the limit, saves the limit
//     through System Settings' own write, refuses a number out of range, and
//     reloads what it shows from the server;
//   * the text follows the theme (light ink in dark), and the block fits a
//     390px phone with the list scrolling in its own box.
// SHOTS=<dir> writes screenshots.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const poc = require('../services/poc-targets.js');
const { duplicatePayload } = require('../services/lead-contacts.js');

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

// ── the stub's world: a law firm, so the REAL rules put an attorney in a
//    hiring-manager slot (R-063) ────────────────────────────────────────────
const NOW = Date.now(), D = 86400000;
const company = { id:'co1', name:'Lakeview Law', website:'lakeviewlaw.com', industry:'Law Practice', size_band:null };
const job = { id:'j1', company_id:'co1', position:'Litigation Paralegal', industry:'Law Practice', stage:'Assigned', assigned_to_bd:'test-bd', created_at:new Date(NOW-D).toISOString() };
const contacts = [
  { id:'c1', job_id:'j1', first_name:'Rita', last_name:'Moss', designation:'Office Manager', email:'rmoss@lakeviewlaw.com', is_primary:true, email_status:'valid' },
];
const suggs = [];
const credits = { used: 6, limit: 20 };
const PEOPLE = [
  { ref:'ap-att1', first_name:'Omar', last_name:'Ch***n', last_masked:true, title:'Senior Litigation Attorney', linkedin_url:null, on_file:false, state:null, free:false },
  { ref:'ap-rita', first_name:'Rita', last_name:'Moss', last_masked:false, title:'Office Manager', linkedin_url:null, on_file:true, state:null, free:false },
  { ref:'ap-dave', first_name:'Dave', last_name:'Re***d', last_masked:true, title:'Director', linkedin_url:'https://www.linkedin.com/in/dreed', on_file:false, state:null, free:true },
  { ref:'ap-clerk', first_name:'Pat', last_name:'Nguyen', last_masked:false, title:'Docketing Clerk', linkedin_url:null, on_file:false, state:null, free:false },
];
function pocPayload(){
  const cs = contacts.filter(c => c.job_id === 'j1');
  const t = poc.pocTargets({ position:job.position, industry:job.industry }, company.size_band);
  const f = poc.fillSlots(t, cs), fmt = poc.learnFormat(cs, company.website);
  return { lead_id:'j1', company_id:'co1', company_name:company.name, size:t.size, size_known:t.size_known, sizes:poc.SIZE_BANDS,
    function:t.function, slots:f.slots.map(s => ({ key:s.key, kind:s.kind, label:s.label, titles:s.titles, contact_id:s.contact_id })),
    others:f.others, found:f.slots.filter(s => s.contact_id).length,
    format:{ domain:fmt.domain, pattern:fmt.pattern, learned_from:fmt.learned_from, example:fmt.pattern ? poc.emailFor('Jane','Smith',fmt) : null },
    size_source:null, employee_count:null, size_checked_at:null,
    suggestions: suggs.slice(), finder:{ apollo:true, credits:{ used:credits.used, limit:credits.limit }, is_admin:false }, can_edit:true };
}
function rawJobs(){
  return [{ id:job.id, company_id:'co1', company:{ name:company.name, industry:job.industry, website:company.website }, position:job.position,
    location:'Austin, TX', stage:job.stage, assigned_to_bd:job.assigned_to_bd, bd_assignee:{ name:'Test BD' }, assigned_at:job.created_at,
    created_at:job.created_at, industry:job.industry, contacts:contacts.slice() }];
}
const calls = [];
let usedUp = false;
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
async function api(route){
  const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
  let body = null; try { body = req.postDataJSON(); } catch(_) {}
  calls.push({ m, p, body });
  if (m==='GET' && p==='/jobs') return reply(route, rawJobs());
  if (m==='GET' && p==='/jobs/j1/poc') return reply(route, pocPayload());
  if (m==='POST' && p==='/jobs/j1/poc/people') {
    const title = String(body && body.title || '');
    return reply(route, { title, people: PEOPLE.map(x => Object.assign({}, x)), total: 17,
      message: `4 of 17 people at Lakeview Law with a title like “${title}”.`, credits:{ used:credits.used, limit:credits.limit } });
  }
  if (m==='POST' && p==='/jobs/j1/poc/people/uncover') {
    const ref = body && body.ref;
    if (usedUp) return reply(route, { error:"Today's 20 Apollo credits are used up. An admin can raise the daily limit." }, 409);
    if (ref === 'ap-dave') {
      return reply(route, duplicatePayload({ match:'email', where:'elsewhere', contact:{ first_name:'Dave', last_name:'Reed', email:'dave.reed@acmebuild.com', designation:'Director of Estimating', job_id:'jB' } },
        { visible:true, lead:{ id:'jB', position:'Junior Estimator', company:'Acme Builders' } }), 409);
    }
    if (ref === 'ap-att1') {
      credits.used++;
      suggs.push({ id:'s-omar', slot_key:'mgr1', first_name:'Omar', last_name:'Chen', title:'Senior Litigation Attorney', email:'omar.chen@lakeviewlaw.com',
        email_confidence:'confirmed', email_source:'apollo', source:'apollo', linkedin_url:null });
      return reply(route, Object.assign(pocPayload(), { result:{ message:'Uncovered Omar Chen with an email Apollo verified — 1 credit. Accept to add them to this lead.', credits:{ used:credits.used, limit:credits.limit } } }));
    }
    if (ref === 'ap-clerk') {
      credits.used++;
      suggs.push({ id:'s-pat', slot_key:'other', first_name:'Pat', last_name:'Nguyen', title:'Docketing Clerk', email:'pnguyen@lakeviewlaw.com',
        email_confidence:'likely', email_source:'format', source:'apollo', linkedin_url:null });
      return reply(route, Object.assign(pocPayload(), { result:{ message:'Uncovered Pat Nguyen with an email built from the company’s format (likely) — 1 credit. Accept to add them to this lead.', credits:{ used:credits.used, limit:credits.limit } } }));
    }
    return reply(route, { error:'Not found' }, 404);
  }
  // Admin → Integrations
  if (m==='GET' && p==='/admin/integrations') {
    return reply(route, { categories:[{ category:'Contact database', items:[{ id:'apollo', category:'Contact database', label:'Apollo.io',
      description:'Finds the people to reach on a lead.', docs:'https://docs.apollo.io/docs/create-api-key', verifier:false, ai:false, has_test:true,
      fields:[{ key:'api_key', label:'API key', configured:true, hint:'••••••9f8e', value:null, secret:true, from_env:false }], configured:true }] }] });
  }
  if (m==='GET' && p==='/admin/apollo/usage') return reply(route, { used:credits.used, limit:credits.limit, min:0, max:10000, default:20 });
  if (m==='POST' && p==='/admin/settings/numbers') {
    const v = body && body.values && body.values.poc_apollo_daily_credits;
    if (Number.isInteger(v)) credits.limit = v;
    return reply(route, { success:true, settings:[] });
  }
  return reply(route, m==='GET' ? {} : {});
}

let browser; const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)) return api(r); return r.abort(); });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd');
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name+'.png') }); };
  await page.evaluate((raw)=>{ STATE.jobs=raw.map(normaliseJob); STATE.contacts=flattenContacts(raw); STATE.leads=STATE.jobs; STATE.page='leads'; render(); }, rawJobs());
  await page.waitForTimeout(300);
  await page.evaluate(()=>{ const td=document.querySelector('#content tr[data-row-id="j1"] td:nth-child(3)'); td && td.click(); });
  await page.waitForSelector('#lx-poc-j1 .lxc', { timeout:5000 });

  const block = () => page.evaluate(()=>{ const b=document.querySelector('#lx-poc-j1 .lxc-ppl'); return b ? { text:b.innerText, html:b.innerHTML } : null; });
  const realClick = async (sel) => {
    const box = await page.evaluate((sel)=>{ const el=document.querySelector(sel); if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; }, sel);
    if (!box) return false; await page.mouse.click(box.x, box.y); return true;
  };
  const b0 = await block();
  step('the search box is on the lead: "Find anyone at Lakeview Law"', !!b0 && /Find anyone at Lakeview Law/i.test(b0.text) && /#lxc-ppl-q-j1|lxc-ppl-q-j1/.test(b0.html), b0 && b0.text.slice(0, 80));
  step('…and says what it costs before anything is pressed', b0 && /Searching is free/.test(b0.text) && /one credit/.test(b0.text));

  // Type a title and press ENTER, like a person.
  await realClick('#lxc-ppl-q-j1');
  await page.keyboard.type('Attorney');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const sent = calls.filter(c => c.p === '/jobs/j1/poc/people').pop();
  step('pressing Enter searches for exactly what was typed', sent && sent.body && sent.body.title === 'Attorney', JSON.stringify(sent && sent.body));
  const rows = await page.evaluate(()=>Array.from(document.querySelectorAll('#lx-poc-j1 .lxc-ppl-row')).map(r => r.innerText.replace(/\s+/g,' ').trim()));
  step('the results list every person Apollo returned', rows.length === 4, JSON.stringify(rows));
  step('a hidden surname shows Apollo\'s hint, with what uncovering costs', rows.some(r => /Omar Ch\*\*\*n/.test(r) && /Senior Litigation Attorney/.test(r) && /Uncover · 1 credit/.test(r)), JSON.stringify(rows[0]));
  step('somebody on file says so, with no button', rows.some(r => /Rita Moss/.test(r) && /On file/.test(r) && !/Uncover/.test(r)));
  step('somebody looked up before is free to uncover', rows.some(r => /Dave/.test(r) && /Uncover · free/.test(r)));
  const msg0 = await page.evaluate(()=>{ const m=document.querySelector('#lx-poc-j1 .lxc-ppl .lxc-msg'); return m ? m.innerText : null; });
  step('the server\'s count is on screen', /4 of 17 people at Lakeview Law/.test(msg0 || ''), msg0);
  await shot('people-search-results');

  // Uncover Omar with a real click.
  const uncoverSel = (ref) => `#lx-poc-j1 .lxc-uncover[onclick*="'${ref}'"]`;
  await realClick(uncoverSel('ap-att1'));
  await page.waitForTimeout(600);
  const un = calls.filter(c => c.p === '/jobs/j1/poc/people/uncover').pop();
  step('Uncover sends the ONE person picked', un && un.body && un.body.ref === 'ap-att1', JSON.stringify(un && un.body));
  const after = await page.evaluate(()=>{
    const b=document.getElementById('lx-poc-j1'), q=document.getElementById('lxc-ppl-q-j1');
    const found = Array.from(b.querySelectorAll('.lxc-slot.is-found')).map(x => x.innerText.replace(/\s+/g,' '));
    const row = Array.from(b.querySelectorAll('.lxc-ppl-row')).find(r => /Omar/.test(r.innerText));
    return { found, row: row ? row.innerText.replace(/\s+/g,' ') : null, q: q ? q.value : null, msg: (b.querySelector('.lxc-ppl .lxc-msg')||{}).innerText || '' };
  });
  step('…Omar now waits in the block with Accept (an attorney at a law firm: a hiring manager)', after.found.some(f => /Omar Chen/.test(f) && /Accept/.test(f) && /Confirmed/.test(f)), JSON.stringify(after.found));
  step('…his result row reads "Waiting below"', /Waiting below/.test(after.row || ''), after.row);
  step('…the typed title survived the repaint', after.q === 'Attorney', after.q);
  step('…and the page says what it cost', /1 credit/.test(after.msg), after.msg);

  // Somebody outside the four roles.
  await realClick(uncoverSel('ap-clerk'));
  await page.waitForTimeout(600);
  const other = await page.evaluate(()=>{ const b=document.getElementById('lx-poc-j1'); return { text: b.innerText, found: Array.from(b.querySelectorAll('.lxc-slot.is-found')).length }; });
  step('somebody outside the four roles waits under "Other people you picked"', /Other people you picked/i.test(other.text) && /Pat Nguyen/.test(other.text) && other.found === 2, other.found + ' found');

  // Somebody already in PACE.
  await realClick(uncoverSel('ap-dave'));
  await page.waitForTimeout(600);
  const pop = await page.evaluate(()=>{ const m=document.querySelector('#layer .dup-modal'); if(!m) return null;
    return { title:(m.querySelector('.mt')||{}).textContent, msg:(m.querySelector('.dup-msg')||{}).textContent }; });
  step('uncovering somebody already in PACE shows the "Already added" pop-up', pop && pop.title === 'Already added' && /the Junior Estimator lead at Acme Builders/.test(pop.msg), JSON.stringify(pop));
  await shot('people-search-already-added');
  await page.evaluate(()=>{ if (window.dupClose) dupClose(); });
  await page.waitForTimeout(250);
  const daveRow = await page.evaluate(()=>{ const r=Array.from(document.querySelectorAll('#lx-poc-j1 .lxc-ppl-row')).find(x=>/Dave/.test(x.innerText)); return r ? r.innerText.replace(/\s+/g,' ') : null; });
  step('…and his row now reads "On file"', /On file/.test(daveRow || '') && !/Uncover/.test(daveRow || ''), daveRow);

  // A used-up day.
  usedUp = true;
  PEOPLE.push({ ref:'ap-att3', first_name:'Ava', last_name:'Lee', last_masked:false, title:'Attorney', linkedin_url:null, on_file:false, state:null, free:false });
  await page.evaluate(()=>{ leadPocPeople('j1'); });
  await page.waitForTimeout(500);
  await realClick(uncoverSel('ap-att3'));
  await page.waitForTimeout(500);
  const red = await page.evaluate(()=>{ const m=document.querySelector('#lx-poc-j1 .lxc-ppl .lxc-msg'); return m ? { text:m.innerText, err:m.classList.contains('is-err') } : null; });
  step('past the day\'s limit the server\'s sentence shows, in red', red && red.err && /used up/.test(red.text) && /admin can raise/.test(red.text), JSON.stringify(red));
  usedUp = false;

  // The text follows the theme — no hard-coded ink. R-122: night keeps cream
  // paper with dark ink (the owner's design), so "light in dark" is no longer
  // the test of following the theme; being the --text TOKEN in both is.
  const ink = async () => page.evaluate(()=>{
    const el=document.querySelector('#lx-poc-j1 .lxc-ppl-name'); if(!el) return null;
    const probe=document.createElement('span'); probe.style.color='var(--text)'; el.parentElement.appendChild(probe);
    const tok=getComputedStyle(probe).color; probe.remove();
    return { own:getComputedStyle(el).color, tok };
  });
  await page.evaluate(()=>applyTheme('dark')); await page.waitForTimeout(150);
  const inkDark = await ink();
  await shot('people-search-dark');
  await page.evaluate(()=>applyTheme('light')); await page.waitForTimeout(150);
  const inkLight = await ink();
  step('names are drawn in the theme\'s ink token in both modes (never a fixed colour)', inkDark && inkLight && inkDark.own===inkDark.tok && inkLight.own===inkLight.tok, JSON.stringify({inkDark,inkLight}));

  // Clear.
  await realClick('#lx-poc-j1 .lxc-ppl-bar button[onclick*="leadPocPeopleClear"]');
  await page.waitForTimeout(250);
  const cleared = await page.evaluate(()=>({ rows: document.querySelectorAll('#lx-poc-j1 .lxc-ppl-row').length, q: (document.getElementById('lxc-ppl-q-j1')||{}).value }));
  step('Clear empties the results and the box', cleared.rows === 0 && cleared.q === '', JSON.stringify(cleared));

  // Phone.
  await page.evaluate(()=>{ leadPocPeople('j1'); });
  await page.waitForTimeout(400);
  await page.setViewportSize({ width:390, height:844 });
  await page.waitForTimeout(400);
  const phone = await page.evaluate(()=>{
    const box=document.querySelector('#lx-poc-j1 .lxc-ppl'); if(!box) return null;
    const content=document.getElementById('content').getBoundingClientRect();
    const wide=Array.from(box.querySelectorAll('*')).filter(el=>{ const r=el.getBoundingClientRect(); if(!r.width) return false;
      if (el.closest('.lxc-ppl-list') && el !== box.querySelector('.lxc-ppl-list')) return false;   // scrolls in its own box
      return r.right > content.right + 1; }).map(el=>el.className);
    const list=box.querySelector('.lxc-ppl-list'), cs=list?getComputedStyle(list):null;
    const btn=box.querySelector('.lxc-uncover'), br=btn?btn.getBoundingClientRect():null;
    return { wide, listScrolls: !!(cs && cs.overflowY==='auto'), btnFull: !!(br && br.width > 250) };
  });
  step('on a 390px phone nothing in the search runs past the screen', phone && phone.wide.length === 0, JSON.stringify(phone && phone.wide));
  step('…the results scroll in their own box, and Uncover is a full-width button', phone && phone.listScrolls && phone.btnFull, JSON.stringify(phone));
  await shot('people-search-phone');
  await page.setViewportSize({ width:1440, height:1000 });

  // ── the Apollo card: the daily limit (R-066) ──────────────────────────────
  await page.evaluate(()=>{ STATE.user = Object.assign({}, STATE.user, { role:'admin', roles:['admin'] }); openIntegrationsModal(); });
  await page.waitForSelector('#intg-apollo-limit', { timeout:5000 });
  await page.waitForTimeout(400);
  const card = await page.evaluate(()=>{ const el=document.querySelector('#layer .intg-apollo-limit'); return el ? { text:el.innerText.replace(/\s+/g,' '), value:(document.getElementById('intg-apollo-limit')||{}).value } : null; });
  step('the Apollo card shows the daily limit for everyone, and today\'s use beside it', card && /Credits a day, for everyone/.test(card.text) && card.value === '20' && new RegExp('Used today: ' + credits.used + ' of 20 ').test(card.text), JSON.stringify(card));
  await shot('apollo-card-limit');
  const posts0 = calls.filter(c => c.p === '/admin/settings/numbers').length;
  await page.fill('#intg-apollo-limit', '20000');
  await page.evaluate(()=>saveApolloLimit());
  await page.waitForTimeout(300);
  step('a number over 10,000 is refused before anything is sent', calls.filter(c => c.p === '/admin/settings/numbers').length === posts0);
  await page.fill('#intg-apollo-limit', '200');
  const save = await page.evaluate(()=>{ const b=Array.from(document.querySelectorAll('#layer .intg-apollo-limit button')).find(x=>/Save limit/.test(x.textContent)); if(!b) return false; b.click(); return true; });
  await page.waitForTimeout(600);
  const sentLimit = calls.filter(c => c.p === '/admin/settings/numbers').pop();
  step('Save limit writes the number through System Settings\' own write', save && sentLimit && sentLimit.body && sentLimit.body.values && sentLimit.body.values.poc_apollo_daily_credits === 200, JSON.stringify(sentLimit && sentLimit.body));
  const card2 = await page.evaluate(()=>{ const el=document.querySelector('#layer .intg-apollo-limit'); return el ? el.innerText.replace(/\s+/g,' ') : null; });
  step('…and the card then shows what the server says (' + credits.used + ' of 200)', new RegExp('Used today: ' + credits.used + ' of 200 ').test(card2 || ''), card2);
  step('nothing threw', pageErrors.length === 0, pageErrors.slice(0,2).join(' | '));
} catch (e) {
  step('the run reached its end', false, String(e && e.stack || e).slice(0, 300));
} finally {
  if (browser) await browser.close();
  server.close();
}
const failed=results.filter(r=>!r).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
