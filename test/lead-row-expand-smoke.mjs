// THE ROW REVEALS ITSELF (Session 23, D-0014).
//
// The owner: "those lead row or the job rows and all and not interactive they
// don't show anything, like earlier … we were able to change the email stage,
// to valid or invalid and all. Now those things and all are not there."
//
// Nothing had been removed — probed in a real browser, the control existed,
// worked, and was visible in the drawer. It was a row click, then a drawer,
// then hunting for a contact card, with nothing on the row hinting at it.
// A feature you cannot see is a feature you do not have.
//
// What this pins is the THREE THINGS THAT MAKE THE FIX SAFE, each of which
// would quietly undo a rule this codebase already paid for:
//
//   1. the panel is built ON DEMAND, one at a time — rendering a hidden panel
//      per row turns a 400-row list into 400 panels, the exact unbounded
//      growth ageing-layout-smoke exists to catch;
//   2. it does NOT re-render — inserting one <tr> keeps the page's scroll,
//      where a render() would throw you back to the top of a long list;
//   3. STATE.page is untouched — expanding is not navigation.
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

const results=[];
const step=(n,ok,d='')=>{results.push(ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){
  if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b=process.env.PLAYWRIGHT_BROWSERS_PATH;
  if(b && fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium');
  return 'chromium';
}

const SEED = (n) => {
  const now=Date.now(), D=86400000;
  window.STATE.companies=[]; window.STATE.contacts=[]; window.STATE.jobs=[];
  for(let i=0;i<n;i++){
    window.STATE.companies.push({id:'co'+i,name:'Company '+i});
    window.STATE.contacts.push({id:'ct'+i,job_id:'j'+i,company_id:'co'+i,first_name:'First'+i,last_name:'Last'+i,
      email:'c'+i+'@example.test',designation:'Manager',is_primary:true,email_status:'valid'});
    window.STATE.jobs.push({id:'j'+i,position:'Position '+i,pos:'Position '+i,company_id:'co'+i,
      company_name:'Company '+i,company:{name:'Company '+i},location:'City, TX',loc:'City, TX',
      stage:'Connected',industry:'Construction',date:new Date(now-i*D).toISOString().slice(0,10),
      created_at:new Date(now-i*D).toISOString(),updated_at:new Date(now-i*D).toISOString(),
      assigned_to_bd:'test-bd',assigned_bd_name:'BD Lead 1',assigned_at:new Date(now-i*D).toISOString(),
      contacts:[{id:'ct'+i,email:'c'+i+'@example.test',first_name:'First'+i}]});
  }
  window.STATE.leads=window.STATE.jobs;
  window.STATE.page='leads'; window.render();
};

let browser;
const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd');
  await page.evaluate(SEED, 12);
  await page.waitForTimeout(350);

  // ── 1. QUIET BY DEFAULT ────────────────────────────────────────────────
  const before = await page.evaluate(()=>({
    panels: document.querySelectorAll('#content tr.lead-exp').length,
    statusControls: document.querySelectorAll('#content select.lx-sel').length,
    rows: document.querySelectorAll('#content tr[data-row-id]').length,
  }));
  step('a list draws no panels at all until asked', before.panels===0 && before.statusControls===0);
  step('the rows are there and carry ids', before.rows===12, `${before.rows} rows`);

  // ── 2. ONE CLICK REACHES THE CONTROL ───────────────────────────────────
  // This is the whole complaint: it used to be a row click, a drawer, and a
  // hunt. One click, or the fix did not land.
  await page.click('#content tr[data-row-id="j3"]');
  await page.waitForTimeout(250);
  const opened = await page.evaluate(()=>{
    const sel=document.querySelector('#content select.lx-sel');
    return {
      panels: document.querySelectorAll('#content tr.lead-exp').length,
      hasControl: !!sel,
      visible: sel ? sel.getBoundingClientRect().width>0 && sel.getBoundingClientRect().height>0 : false,
      options: sel ? [...sel.options].map(o=>o.value) : [],
      handler: sel ? (sel.getAttribute('onchange')||'') : '',
      rightAfterItsRow: (()=>{
        const tr=document.querySelector('#content tr[data-row-id="j3"]');
        return !!tr && !!tr.nextElementSibling && tr.nextElementSibling.classList.contains('lead-exp');
      })(),
      page: window.STATE.page,
      modal: window.STATE.modal,
    };
  });
  step('one click opens a panel', opened.panels===1);
  step('…directly beneath the row that was clicked', opened.rightAfterItsRow);
  step('the email-status control is THERE and visible', opened.hasControl && opened.visible);
  step('it offers the four real statuses',
    ['valid','invalid','deactivated','out_of_office'].every(v=>opened.options.includes(v)),
    opened.options.join(','));
  // It must call the SAME handler the drawer calls — one implementation.
  step('it calls the same changeEmailStatus the drawer uses',
    /changeEmailStatus\(/.test(opened.handler));
  step('expanding is NOT navigation — STATE.page untouched', opened.page==='leads');
  step('…and it did not open the drawer either', !opened.modal);

  // ── 3. ONE AT A TIME (the ageing rule) ─────────────────────────────────
  await page.click('#content tr[data-row-id="j7"]');
  await page.waitForTimeout(250);
  const second = await page.evaluate(()=>({
    panels: document.querySelectorAll('#content tr.lead-exp').length,
    afterJ7: (()=>{ const tr=document.querySelector('#content tr[data-row-id="j7"]');
      return !!tr && !!tr.nextElementSibling && tr.nextElementSibling.classList.contains('lead-exp'); })(),
    openRows: document.querySelectorAll('#content tr.is-open').length,
  }));
  step('opening another row closes the first — only ever ONE panel', second.panels===1);
  step('…and the new panel is under the new row', second.afterJ7);
  step('only one row is marked open', second.openRows===1);

  // ── 4. CLICKING AGAIN CLOSES ───────────────────────────────────────────
  await page.click('#content tr[data-row-id="j7"]');
  await page.waitForTimeout(250);
  const closed = await page.evaluate(()=>({
    panels: document.querySelectorAll('#content tr.lead-exp').length,
    openRows: document.querySelectorAll('#content tr.is-open').length,
  }));
  step('a second click closes it — a control, not a trap', closed.panels===0 && closed.openRows===0);

  // ── 5. IT DOES NOT RE-RENDER ───────────────────────────────────────────
  // Why this matters: a render() rewrites #content, which resets its scroll —
  // so expanding a row halfway down a long list would throw you back to the
  // top. That is the rule; this is how it is proved.
  //
  // NOT by asserting scrollTop. The Leads list paginates at 20, so the page
  // does not actually scroll at any viewport this test can set — and a scroll
  // assertion on a page that cannot scroll passes while measuring NOTHING.
  // (The first version of this did exactly that and reported "0 → 0" as a
  // pass.) Node identity is the direct proof and cannot be faked: if the table
  // is the same DOM node afterwards, nothing rewrote #content.
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.evaluate(SEED, 60);
  await page.waitForTimeout(350);
  const noRerender = await page.evaluate(async ()=>{
    const tbl = document.querySelector('#content table');
    const wrap = document.querySelector('#content .dt-wrap');
    const rows = [...document.querySelectorAll('#content tr[data-row-id]')];
    const tr = rows[Math.min(rows.length-1, 12)];
    if (!tr) return { noRow:true };
    const firstRow = rows[0];
    tr.click();
    await new Promise(r=>setTimeout(r,180));
    return {
      sameTable: document.querySelector('#content table') === tbl,
      sameWrap:  document.querySelector('#content .dt-wrap') === wrap,
      sameFirstRow: document.querySelector('#content tr[data-row-id]') === firstRow,
      opened: document.querySelectorAll('#content tr.lead-exp').length,
    };
  });
  step('a deep row exists to test against', !noRerender.noRow);
  step('it opened', noRerender.opened === 1);
  step('the TABLE was never rebuilt — so #content was never rewritten',
    noRerender.sameTable);
  step('…nor its scroll container', noRerender.sameWrap);
  step('…nor any existing row', noRerender.sameFirstRow);

  // ── 6. GROWTH STAYS FLAT ───────────────────────────────────────────────
  // The reason for "one at a time, built on demand". 5x the rows must not mean
  // 5x the panels — it must mean exactly one, same as always.
  const growth = await page.evaluate(async ()=>{
    const count=()=>document.querySelectorAll('#content tr.lead-exp, #content select.lx-sel').length;
    const open=document.querySelector('#content tr.lead-exp');
    return { withOneOpen: count(), hasOne: !!open };
  });
  step('60 rows with one open costs the same as 12 with one open',
    growth.withOneOpen <= 3, `${growth.withOneOpen} panel nodes`);

  // ── 7. THE PANEL'S EXIT ACTUALLY OPENS SOMETHING ───────────────────────
  // "that button do not work" — and it didn't, but `openJob` was innocent: it
  // set STATE.modal and re-rendered correctly every single time. What was
  // missing was one wrapper. A modal PANEL is only a panel; `.overlay`
  // (position:fixed, inset:0, z-index:100) is what puts it over the page, and
  // renderModal() returned three renderers RAW — jobDetail, addJob and
  // addContact — so all three landed in normal flow BELOW the entire page,
  // out of sight, with the button reading as dead.
  //
  // Nothing in the app said so: STATE was right, #layer had 6.7KB of correct
  // html in it, no error was thrown. Only geometry told the truth. So this
  // asserts GEOMETRY, not state: whatever goes into #layer must cover the
  // viewport's origin.
  const overlaid = await page.evaluate(()=>{
    const out = {};
    for (const t of ['jobDetail','addJob','addContact']) {
      window.STATE.modal = (t === 'jobDetail') ? { type:t, id:'j0' } : { type:t };
      window.render();
      const kid = document.querySelector('#layer > *');
      if (!kid) { out[t] = { missing:true }; continue; }
      const cs = getComputedStyle(kid), r = kid.getBoundingClientRect();
      out[t] = { position: cs.position, top: Math.round(r.top), left: Math.round(r.left),
                 coversOrigin: r.top <= 0 && r.left <= 0 && r.bottom >= window.innerHeight - 1 };
    }
    window.STATE.modal = null; window.render();
    return out;
  });
  for (const t of ['jobDetail','addJob','addContact']) {
    const o = overlaid[t] || { missing:true };
    step(`the ${t} modal renders OVER the page, not below it`,
      !o.missing && o.position === 'fixed' && o.coversOrigin,
      o.missing ? '#layer was empty' : `position:${o.position} top:${o.top} left:${o.left}`);
  }

  step('nothing threw', pageErrors.length===0, pageErrors.slice(0,2).join(' | '));
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed=results.filter(r=>!r).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
