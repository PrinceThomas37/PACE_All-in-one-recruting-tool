// "ALREADY ADDED" ON SCREEN (owner, 2026-09-28: "If the person or the email id
// already added. A pop-up should come like that they are already added kinda.")
//
// In a real browser, against a stub API whose 409 answers are built by the
// REAL server function (services/lead-contacts.js duplicatePayload) — never a
// hand-typed shape the page could agree with while the server says otherwise.
//
// Pins, on all three ways a person is added:
//   * Add contact (the lead's modal): a repeated ADDRESS shows the pop-up with
//     who and where and ONE button (OK) — no way to add them anyway — and OK
//     goes back to the lead; a repeated NAME asks, and "Add anyway" re-sends
//     the same person with allow_same_name and adds them;
//   * the POC finder's "Add by hand": the same pop-up; "Don't add" leaves the
//     typed form in place underneath; "Add anyway" adds;
//   * the finder's Accept: a person already in PACE elsewhere → the pop-up
//     (not a red line in the block); a person already on this lead → the
//     pop-up saying nothing new was added (not "Added to the lead");
//   * the pop-up is really OVER the page (geometry, not state), its panel is
//     opaque, its text is readable in light AND dark, and it fits a 390px phone
//     with thumb-sized buttons.
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

// ── the stub's world ────────────────────────────────────────────────────────
const NOW = Date.now(), D = 86400000;
const company = { id:'co1', name:'Acme Builders', website:'acmebuild.com', industry:'Construction', size_band:null };
const job = { id:'j1', company_id:'co1', position:'Junior Estimator', industry:'Construction', stage:'Assigned', assigned_to_bd:'test-bd', created_at:new Date(NOW-D).toISOString() };
const contacts = [
  { id:'c1', job_id:'j1', first_name:'Maria', last_name:'Lopez', designation:'HR Manager', email:'mlopez@acmebuild.com', is_primary:true, email_status:'valid' },
  { id:'c2', job_id:'j1', first_name:'John', last_name:'Carter', designation:'President', email:'jcarter@acmebuild.com', is_primary:false, email_status:'valid' },
];
// Somebody on a lead at ANOTHER company (the admin-visible kind of answer).
const elsewhere = { id:'cB', first_name:'Robin', last_name:'Vale', designation:'CFO', email:'robin.vale@acmebuild.com', job_id:'jB', company_id:'co2' };
const suggs = [
  { id:'s-robin', job_id:'j1', slot_key:'hr2', first_name:'Robin', last_name:'Vale', title:'HR Generalist', email:'robin.vale@acmebuild.com', email_confidence:'confirmed', email_source:'apollo', source:'apollo', linkedin_url:null, status:'suggested' },
  { id:'s-maria', job_id:'j1', slot_key:'hr2', first_name:'Maria', last_name:'Lopez', title:'HR Manager', email:null, email_confidence:null, email_source:null, source:'apollo', linkedin_url:null, status:'suggested' },
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
    suggestions: suggs.filter(x => x.status === 'suggested').map(x => Object.assign({}, x)),
    finder:{ apollo:true, credits:{ used:0, limit:20 }, is_admin:false }, can_edit:true };
}
function rawJobs(){
  return [{ id:job.id, company_id:'co1', company:{ name:company.name, industry:job.industry, website:company.website }, position:job.position,
    location:'Austin, TX', stage:job.stage, assigned_to_bd:job.assigned_to_bd, bd_assignee:{ name:'Test BD' }, assigned_at:job.created_at,
    created_at:job.created_at, industry:job.industry, contacts:contacts.filter(c => c.job_id === 'j1') }];
}
const posts = [];
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
const norm = (s) => String(s || '').trim().toLowerCase();
async function api(route){
  const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
  let body = null; try { body = req.postDataJSON(); } catch(_) {}
  let hit;
  if (m==='GET' && p==='/jobs') return reply(route, rawJobs());
  if (m==='GET' && /^\/jobs\/j1\/poc$/.test(p)) return reply(route, pocPayload());
  if (m==='POST' && p==='/contacts') {
    posts.push(body);
    // The server's rule, applied to this little world by the server's own words.
    const same = contacts.find(c => body.email && norm(c.email) === norm(body.email));
    if (same) return reply(route, duplicatePayload({ match:'email', where:'this_lead', contact:same }), 409);
    const named = contacts.find(c => body.last_name && norm(c.first_name) === norm(body.first_name) && norm(c.last_name) === norm(body.last_name));
    if (named && body.allow_same_name !== true) return reply(route, duplicatePayload({ match:'name', where:'this_lead', contact:named }), 409);
    const c = Object.assign({ id:'new'+posts.length, email_status:'valid' }, body); delete c.allow_same_name; contacts.push(c);
    return reply(route, c, 201);
  }
  if (m==='POST' && (hit = p.match(/^\/jobs\/j1\/poc\/suggestions\/([^/]+)\/accept$/))) {
    const sg = suggs.find(x => x.id === hit[1]);
    if (sg.id === 's-robin') { sg.status = 'rejected';
      return reply(route, duplicatePayload({ match:'email', where:'elsewhere', contact:elsewhere }, { visible:true, lead:{ id:'jB', position:'Controller', company:'Beta Corp' } }), 409); }
    sg.status = 'accepted';
    const d = duplicatePayload({ match:'name', where:'this_lead', contact:contacts[0] }).duplicate;
    return reply(route, Object.assign(pocPayload(), { contact:{ id:'c1' }, already_on_lead:true,
      duplicate:Object.assign(d, { title:'Already added', can_add_anyway:false, message:'Maria Lopez is already on this lead, so nothing new was added.' }) }));
  }
  return reply(route, m==='GET' ? [] : {});
}

// Contrast of two opaque colours (WCAG).
function lum(rgb){ const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; }
function ratio(a, b){ const L1 = lum(a), L2 = lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); }

let browser; const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:950}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue(); if(u.startsWith(API)) return api(r); return r.abort(); });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd');
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name+'.png') }); };
  await page.evaluate((raw)=>{ STATE.jobs=raw.map(normaliseJob); STATE.contacts=flattenContacts(raw); STATE.leads=STATE.jobs; STATE.page='leads'; render(); }, rawJobs());
  await page.waitForTimeout(300);

  // What the pop-up is, measured — never "is STATE.modal set".
  const popup = () => page.evaluate(()=>{
    const m = document.querySelector('#layer .dup-modal'); if (!m) return { shown:false };
    const ov = m.closest('.overlay'), r = ov ? ov.getBoundingClientRect() : null, mr = m.getBoundingClientRect();
    const hit = document.elementFromPoint(mr.left + mr.width/2, mr.top + 20);
    return { shown:true,
      covers: !!(r && r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight),
      onTop: !!(hit && m.contains(hit)),
      title: (m.querySelector('.mt')||{}).textContent || '', msg: (m.querySelector('.dup-msg')||{}).textContent || '',
      person: (m.querySelector('.dup-person')||{}).innerText || '', where: (m.querySelector('.dup-where')||{}).textContent || '',
      buttons: Array.from(m.querySelectorAll('.mf button')).map(b => b.textContent.trim()) };
  });
  const clickText = async (label) => {   // a REAL click on the pop-up's button
    const box = await page.evaluate((label)=>{ const b = Array.from(document.querySelectorAll('#layer .dup-modal .mf button')).find(x => x.textContent.trim() === label);
      if (!b) return null; const r = b.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; }, label);
    if (!box) return false; await page.mouse.click(box.x, box.y); return true;
  };

  // ── 1. Add contact (the lead's modal): a repeated ADDRESS ────────────────
  await page.evaluate(()=>{ STATE.modal={ type:'addContact', job_id:'j1' }; render(); });
  await page.waitForTimeout(150);
  await page.fill('#ac-fn', 'Maria'); await page.fill('#ac-ln', 'L'); await page.fill('#ac-email', 'MLopez@acmebuild.com');
  await page.evaluate(()=>{ const b = Array.from(document.querySelectorAll('#layer button')).find(x => /submitAddContact/.test(x.getAttribute('onclick')||'')); b.click(); });
  await page.waitForTimeout(400);
  const p1 = await popup();
  step('Add contact with an address already on the lead shows the pop-up', p1.shown && p1.title === 'Already added', JSON.stringify(p1));
  step('…really OVER the page (it covers the screen and is what a click hits)', p1.covers && p1.onTop, JSON.stringify({ covers:p1.covers, onTop:p1.onTop }));
  step('…saying who, with their title and address', /Maria Lopez \(mlopez@acmebuild\.com\) is already on this lead/.test(p1.msg) && /HR Manager/.test(p1.person) && /mlopez@acmebuild\.com/.test(p1.person), p1.msg + ' | ' + p1.person);
  step('…and ONE button, OK — a repeated address cannot be added anyway', JSON.stringify(p1.buttons) === '["OK"]', JSON.stringify(p1.buttons));
  step('…nothing was added', contacts.length === 2);
  await shot('already-added-email');
  await clickText('OK');
  await page.waitForTimeout(200);
  const back = await page.evaluate(()=>({ modal: STATE.modal && STATE.modal.type, popup: !!document.querySelector('#layer .dup-modal') }));
  step('OK goes back to the lead, where the person already is', back.modal === 'jobDetail' && !back.popup, JSON.stringify(back));

  // ── 2. Add contact: a repeated NAME is asked ─────────────────────────────
  await page.evaluate(()=>{ STATE.modal={ type:'addContact', job_id:'j1' }; render(); });
  await page.waitForTimeout(150);
  await page.fill('#ac-fn', 'Maria'); await page.fill('#ac-ln', 'Lopez'); await page.fill('#ac-email', 'maria.lopez@gmail.com');
  await page.evaluate(()=>{ const b = Array.from(document.querySelectorAll('#layer button')).find(x => /submitAddContact/.test(x.getAttribute('onclick')||'')); b.click(); });
  await page.waitForTimeout(400);
  const p2 = await popup();
  step('the same NAME is asked, not refused: "Already added?" with Don\'t add / Add anyway',
    p2.shown && p2.title === 'Already added?' && /Is this the same person\?/.test(p2.msg) && JSON.stringify(p2.buttons) === '["Don\'t add","Add anyway"]', JSON.stringify(p2));
  await shot('already-added-name');
  const nPosts = posts.length;
  await clickText('Add anyway');
  await page.waitForTimeout(500);
  const resent = posts[nPosts];
  step('"Add anyway" sends the SAME person again, with allow_same_name', resent && resent.allow_same_name === true && resent.first_name === 'Maria' && resent.email === 'maria.lopez@gmail.com', JSON.stringify(resent));
  step('…and they are added', contacts.some(c => c.email === 'maria.lopez@gmail.com') && !(await popup()).shown);

  // ── 3. The finder's "Add by hand" ────────────────────────────────────────
  await page.evaluate(()=>{ STATE.modal=null; render(); });
  await page.evaluate(()=>{ const td = document.querySelector('#content tr[data-row-id="j1"] td:nth-child(3)'); td && td.click(); });
  await page.waitForSelector('#lx-poc-j1 .lxc', { timeout: 5000 });
  await page.evaluate(()=>{ const b = Array.from(document.querySelectorAll('#lx-poc-j1 button')).find(x => /leadPocAdd\(/.test(x.getAttribute('onclick')||'') && /Add by hand/.test(x.textContent)); b && b.click(); });
  await page.waitForSelector('#lxc-name-j1', { timeout: 3000 });
  await page.fill('#lxc-name-j1', 'John Carter');
  await page.fill('#lxc-email-j1', 'jc@othermail.com');
  await page.evaluate(()=>{ const b = Array.from(document.querySelectorAll('#lx-poc-j1 button')).find(x => /leadPocSave\(/.test(x.getAttribute('onclick')||'')); b.click(); });
  await page.waitForTimeout(400);
  const p3 = await popup();
  step('the finder\'s Add by hand shows the same pop-up', p3.shown && p3.title === 'Already added?' && /John Carter/.test(p3.msg), JSON.stringify(p3));
  await clickText("Don't add");
  await page.waitForTimeout(250);
  const kept = await page.evaluate(()=>{ const n = document.getElementById('lxc-name-j1'); return { value: n ? n.value : null, popup: !!document.querySelector('#layer .dup-modal') }; });
  step('"Don\'t add" closes it and leaves what was typed in the form', kept.value === 'John Carter' && !kept.popup, JSON.stringify(kept));
  const nP = posts.length;
  await page.evaluate(()=>{ const b = Array.from(document.querySelectorAll('#lx-poc-j1 button')).find(x => /leadPocSave\(/.test(x.getAttribute('onclick')||'')); b.click(); });
  await page.waitForTimeout(400);
  await clickText('Add anyway');
  await page.waitForTimeout(600);
  step('…and "Add anyway" there adds them with allow_same_name', posts.slice(nP).some(b => b.allow_same_name === true && b.email === 'jc@othermail.com') && contacts.some(c => c.email === 'jc@othermail.com'),
    JSON.stringify(posts.slice(nP)));

  // ── 4. The finder's Accept ───────────────────────────────────────────────
  await page.waitForSelector('#lx-poc-j1 .lxc', { timeout: 5000 });
  const clickAccept = (sid) => page.evaluate((sid)=>{ const b = Array.from(document.querySelectorAll('#lx-poc-j1 button')).find(x => (x.getAttribute('onclick')||'').indexOf("leadPocAccept('j1','"+sid+"')") >= 0); if (!b) return false; b.click(); return true; }, sid);
  step('(Robin is waiting to be accepted)', await clickAccept('s-robin'));
  await page.waitForTimeout(500);
  const p4 = await popup();
  step('Accepting somebody already in PACE elsewhere shows the pop-up, naming where',
    p4.shown && p4.title === 'Already added' && /robin\.vale@acmebuild\.com is already in PACE, on the Controller lead at Beta Corp/.test(p4.msg) && /On the Controller lead at Beta Corp/.test(p4.where), JSON.stringify(p4));
  const redLine = await page.evaluate(()=>{ const b = document.getElementById('lx-poc-j1'); return b ? /already in PACE/.test(b.innerText) : null; });
  step('…instead of a red line inside the block', redLine === false, String(redLine));
  await shot('already-added-accept');
  await clickText('OK');
  await page.waitForTimeout(400);
  await page.waitForSelector('#lx-poc-j1 .lxc', { timeout: 5000 });
  const toasts0 = await page.evaluate(()=>(STATE.toasts||[]).map(t => t.msg));
  step('(Maria is waiting to be accepted)', await clickAccept('s-maria'));
  await page.waitForTimeout(500);
  const p5 = await popup();
  const toasts1 = await page.evaluate(()=>(STATE.toasts||[]).map(t => t.msg));
  step('Accepting somebody already ON this lead says nothing new was added — in the pop-up',
    p5.shown && /Maria Lopez is already on this lead, so nothing new was added/.test(p5.msg) && JSON.stringify(p5.buttons) === '["OK"]', JSON.stringify(p5));
  step('…and never "Added to the lead"', !toasts1.slice(toasts0.length).some(t => /Added to the lead/.test(t)), JSON.stringify(toasts1.slice(toasts0.length)));

  // ── 5. Readable in both themes; opaque; fits a phone ─────────────────────
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t)=>applyTheme(t), theme);
    await page.waitForTimeout(150);
    const c = await page.evaluate(()=>{
      const m = document.querySelector('#layer .dup-modal'); if (!m) return null;
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const bg = rgb(getComputedStyle(m).backgroundColor);
      return { bg, msg: rgb(getComputedStyle(m.querySelector('.dup-msg')).color), sub: rgb(getComputedStyle(m.querySelector('.dup-sub') || m.querySelector('.dup-msg')).color),
        theme: document.documentElement.getAttribute('data-theme') };
    });
    const opaque = c && (c.bg.length === 3 || c.bg[3] === 1);
    step(`${theme}: the pop-up's panel is opaque (a float must be)`, c && c.theme === theme && opaque, JSON.stringify(c && c.bg));
    const r1 = c && opaque ? ratio(c.msg.slice(0,3), c.bg.slice(0,3)) : 0, r2 = c && opaque ? ratio(c.sub.slice(0,3), c.bg.slice(0,3)) : 0;
    step(`${theme}: its sentence and details are readable (≥ 4.5:1)`, r1 >= 4.5 && r2 >= 4.5, `msg ${r1.toFixed(2)}:1, details ${r2.toFixed(2)}:1`);
    if (theme === 'dark') await shot('already-added-dark');
  }
  await page.evaluate(()=>applyTheme('light'));
  await page.setViewportSize({ width:390, height:844 });
  await page.waitForTimeout(250);
  const phone = await page.evaluate(()=>{
    const m = document.querySelector('#layer .dup-modal'); if (!m) return null;
    const r = m.getBoundingClientRect();
    const btns = Array.from(m.querySelectorAll('.mf button')).map(b => Math.round(b.getBoundingClientRect().height));
    const wide = Array.from(m.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > innerWidth + 1).length;
    return { left:r.left, right:r.right, vw:innerWidth, btns, wide };
  });
  step('on a 390px phone the pop-up fits the screen', phone && phone.left >= 0 && phone.right <= phone.vw + 1 && phone.wide === 0, JSON.stringify(phone));
  step('…with thumb-sized buttons (≥ 40px)', phone && phone.btns.length && phone.btns.every(h => h >= 40), JSON.stringify(phone && phone.btns));
  await shot('already-added-phone');
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
