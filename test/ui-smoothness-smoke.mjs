// SMOOTHNESS IS A BUDGET, NOT A FEELING (Session 23, round 3).
//
// The owner: "theres small glitche in the UI and the screens, like a lag or
// sometimes early animations and all. Its not smooth."
//
// The honest problem with a smoothness test is that THIS SANDBOX CANNOT
// MEASURE SMOOTHNESS. Headless Chromium composites in software: a scroll over
// 25 blur layers and a scroll over none both report exactly 17ms per frame.
// A timing assertion here would pass whatever happened — the third vacuous
// guard of the session, and the most convincing one, because it would print a
// real-looking number.
//
// So this pins the things that ARE countable and that actually caused it:
//
//   1. the number of backdrop-filter layers on a phone screen (each is a
//      compositing layer the browser re-blurs when anything behind it moves);
//   2. that no rule uses `transition: all` — which animates WIDTH, HEIGHT and
//      PADDING as well as colour, so a button whose label changes animates its
//      own size. That is the "early animation", and it is a side effect of
//      naming no properties rather than anything anyone asked for;
//   3. that a repaint still starts no animations — the Session 16 guarantee,
//      re-checked here because breaking it would look exactly like this bug.
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
    if (err){ res.writeHead(404); return res.end('nf'); }
    res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(data);
  });
});
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const step = (n, ok, d='') => { results.push(ok); console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:'')); };
function findChromium(){
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const direct = path.join(root,'chromium');
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  for (const d of (fs.existsSync(root)?fs.readdirSync(root):[])) {
    for (const c of ['chrome-linux/chrome','chrome-linux/headless_shell']) {
      const f = path.join(root,d,c); if (fs.existsSync(f)) return f;
    }
  }
  return direct;
}

// ── 1. NO RULE MAY SAY `transition: all` ────────────────────────────────────
// A stylesheet grep, deliberately: this is a property of the SOURCE, and it
// must fail even for a page no browser test happens to render.
const sheets = ['styles.css','ui.css','theme.css','mobile.css'];
const allOffenders = [];
for (const f of sheets) {
  const full = path.join(PUBLIC_DIR, f);
  if (!fs.existsSync(full)) continue;
  // Strip /* … */ first: this file's own comment says the words "transition:
  // all" while explaining why they are banned, and a naive grep flags it.
  const src = fs.readFileSync(full,'utf8');
  let inC = false;
  src.split('\n').forEach((raw,i)=>{
    let line = '';
    for (let k=0;k<raw.length;k++){
      if (!inC && raw[k]==='/' && raw[k+1]==='*'){ inC=true; k++; continue; }
      if (inC && raw[k]==='*' && raw[k+1]==='/'){ inC=false; k++; continue; }
      if (!inC) line += raw[k];
    }
    if (/transition\s*:\s*all\b/.test(line)) allOffenders.push(`${f}:${i+1}`);
  });
}
step('no stylesheet uses `transition: all` (it animates layout, not just colour)',
  allOffenders.length === 0, allOffenders.join(', '));

// The budget. It is a ceiling on COMPOSITING LAYERS, not on taste: glass on the
// rail, the bar, cards, drawers and scrims is the design and is welcome. Glass
// on 25 buttons and inputs was not a decision, it was a copied declaration.
const BLUR_BUDGET = 12;

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport:{width:420,height:860}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  await ctx.addInitScript(()=>{ try{ localStorage.setItem('pace-theme','dark'); }catch(e){} });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE+'/', { waitUntil:'domcontentloaded' });
  await waitForLogin(page);
  await enterApp(page, 'admin');

  // ── 2. THE BLUR BUDGET, PER SCREEN ───────────────────────────────────────
  // A budget measured on empty screens is a budget measured on no controls.
  // The 25 layers that started this were on a Leads list with rows in it.
  await page.evaluate(()=>{
    const t = new Date().toISOString(); const jobs=[];
    window.STATE.companies=[]; window.STATE.contacts=[];
    for (let i=0;i<40;i++){
      window.STATE.companies.push({ id:'co'+i, name:'Company '+i+' Holdings' });
      window.STATE.contacts.push({ id:'ct'+i, job_id:'j'+i, company_id:'co'+i, first_name:'First'+i,
        last_name:'Last'+i, email:'p'+i+'@x.com', designation:'Head of Ops', is_primary:true, email_status:'valid' });
      jobs.push({ id:'j'+i, position:'Payroll Specialist '+i, pos:'Payroll Specialist '+i, company_id:'co'+i,
        company_name:'Company '+i+' Holdings', company:{ name:'Company '+i }, location:'Oklahoma City, OK',
        loc:'Oklahoma City, OK', stage:'Assigned', industry:'Truck', date:t.slice(0,10), created_at:t,
        assigned_to_bd:'test-bd', assigned_bd_name:'BD Lead 2', assigned_at:t, contacts:[] });
    }
    window.STATE.jobs=jobs; window.STATE.leads=jobs;
  });
  const SCREENS = ['dashboard','leads','applicants','email','admin','reports','clients','bd_joborders'];
  const over = [];
  let worst = { page:'—', n:-1 }, drawn = 0;
  for (const p of SCREENS) {
    const n = await page.evaluate((pp)=>{
      window.STATE.page = pp; window.render();
      let c = 0;
      for (const el of document.querySelectorAll('#content *, #topbar *, #sidebar *')) {
        const cs = getComputedStyle(el);
        const f = cs.backdropFilter || cs.webkitBackdropFilter;
        if (f && f !== 'none') c++;
      }
      return { blur:c, nodes: document.querySelectorAll('#content *').length };
    }, p);
    drawn += n.nodes;
    if (n.blur > worst.n) worst = { page:p, n:n.blur };
    if (n.blur > BLUR_BUDGET) over.push(`${p}: ${n.blur}`);
  }
  // A budget test with nothing on screen passes for the wrong reason.
  step('the screens actually drew something to count', drawn > 200, `${drawn} content nodes over ${SCREENS.length} screens`);
  step(`no screen exceeds ${BLUR_BUDGET} blur layers on a phone`, over.length === 0,
    over.length ? over.join(' | ') : `worst: ${worst.page} at ${worst.n}`);

  // ── 3. A REPAINT STILL STARTS NOTHING ────────────────────────────────────
  // Session 16's guarantee. If it ever breaks, the symptom is precisely the
  // sentence this file is named after, so it is re-checked here rather than
  // assumed.
  const repaint = await page.evaluate(async ()=>{
    const running = ()=>document.getAnimations().filter(a=>a.playState==='running').length;
    window.STATE.page='leads'; window.render();
    await new Promise(r=>setTimeout(r,400));
    const before = running();
    window.render();                                   // idle: nothing changed
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const idle = running();
    window.STATE._tick = (window.STATE._tick||0)+1;     // a poll ticking a value
    window.render();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return { before, idle, afterTick: running() };
  });
  step('an idle repaint starts no animation', repaint.idle === 0, `${repaint.idle} running`);
  step('a data-changed repaint starts no animation', repaint.afterTick === 0, `${repaint.afterTick} running`);

  // ── 4. REDUCED MOTION IS HONOURED ────────────────────────────────────────
  // Someone who has told their phone to stop animating things has asked once,
  // for every app. Answering it is not a preference.
  //
  // The first version of this check read one element's transition-duration
  // under reduced motion and passed if it was small — and an element with NO
  // transition reads 0s, so it passed with the rule deleted. It now finds an
  // element that genuinely transitions with motion ON, and asserts THAT SAME
  // element collapses when motion is off. A control group, because "it is
  // already zero" and "we set it to zero" are not the same fact.
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.evaluate(()=>{ window.STATE.page='leads'; window.render(); });
  await page.waitForTimeout(120);
  const pick = await page.evaluate(()=>{
    const els = document.querySelectorAll('#content *, #sidebar *, #topbar *');
    for (let i=0;i<els.length;i++){
      const cs = getComputedStyle(els[i]);
      if (parseFloat(cs.transitionDuration) > 0.05){ els[i].setAttribute('data-rm-probe','1');
        return { sel:'[data-rm-probe]', on: cs.transitionDuration }; }
    }
    return null;
  });
  step('an element that really transitions was found to test against',
    !!pick, pick ? `duration with motion on = ${pick.on}` : 'none had a transition');

  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.waitForTimeout(120);
  const off = pick ? await page.evaluate(()=>{
    const el = document.querySelector('[data-rm-probe]');
    return el ? getComputedStyle(el).transitionDuration : null;
  }) : null;
  step('prefers-reduced-motion collapses that element\'s transition',
    !!off && parseFloat(off) < 0.005 && !!pick && parseFloat(pick.on) > 0.05,
    pick ? `${pick.on} → ${off}` : 'no probe element');

  step('nothing threw', pageErrors.length === 0, pageErrors.slice(0,2).join(' | '));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r=>!r).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
