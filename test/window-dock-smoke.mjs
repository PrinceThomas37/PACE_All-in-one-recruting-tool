// WINDOWS: MINIMISE, BRING BACK, FULL SCREEN, CLOSE (R-078 / R-079, D-0058).
//
// The owner, composing an email to a client: "there was no minimize button for
// compose window that user can minimize, go and look from the details to copy
// paste within PACE itself and then come and paste it on the given window. Like
// it is in Gmail or Outlook."  Then, generalised: windows for emails, messages,
// reminders, client details "or anything" — minimise, maximise or close at any time.
//
// Pinned in a real browser, on the REAL mailbox composer and the REAL client drawer:
//   * a window has a title bar with Minimise / Full screen / Close;
//   * minimising keeps EVERYTHING typed — and the page behind is usable while it
//     is parked (navigate, look, come back);
//   * bringing it back restores it as left, typed text and all;
//   * FULL SCREEN never rebuilds the window (a rebuild would empty what was typed);
//   * a parked window that repaints itself (a signature finishing loading) must NOT
//     pop open over the page — the bug this design is most exposed to;
//   * closing a parked window discards it AND its state (no ghost draft);
//   * several windows can be parked, and bringing one back parks the one on screen
//     (nothing on screen is ever thrown away);
//   * an alert dialog (a question that needs an answer) is not parkable;
//   * a record drawer parks and reopens;
//   * on a phone the tray sits inside the screen and the buttons are finger-sized.
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
const CLIENTS = [{ id:'co1', name:'Griffith Energy', industry:'Construction', location:'Maryland', website:'griffith.example.test',
  job_order_count:1, open_job_order_count:1, can_edit:true }];
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
async function api(route){
  const req = route.request(); const p = new URL(req.url()).pathname, m = req.method();
  if (m==='GET' && p==='/clients') return reply(route, CLIENTS);
  if (m==='GET' && p==='/clients/co1') return reply(route, CLIENTS[0]);
  if (m==='GET' && /^\/clients\/[^/]+\/intel$/.test(p)) return reply(route, { enabled:false });
  if (m==='GET' && p==='/mailbox/signature') return reply(route, { html:'' });
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
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const tray = () => ev(()=>[...document.querySelectorAll('#win-tray .win-chip')].map(c=>c.querySelector('.wt').textContent));
  const modalOpen = () => ev(()=>!!document.querySelector('#layer .modal'));
  const click = async (sel) => { const ok = await ev((s)=>{ const el=document.querySelector(s); if(!el) return false; el.click(); return true; }, sel); await page.waitForTimeout(150); return ok; };

  // A mailbox to compose from (the composer needs a connected one).
  await ev(()=>{ STATE.mailbox.accounts=[{ id:'mb1', email_address:'me@example.test', readable:true }]; STATE.mailbox.activeId='mb1'; });

  // ═══ 1. THE COMPOSER GETS WINDOW CONTROLS ═════════════════════════════════
  await ev(()=>mbCompose('client@example.test'));
  await page.waitForSelector('#layer .modal', { timeout:5000 }).catch(()=>{});
  const bar = await ev(()=>{ const b=document.querySelector('#layer .modal .win-bar'); return b ? { t:b.querySelector('.win-t').textContent, btns:[...b.querySelectorAll('button')].map(x=>x.getAttribute('aria-label')) } : null; });
  step('Compose: the window has a title bar', !!bar, JSON.stringify(bar));
  step('Compose: it names the window and offers Minimise, Full screen and Close', !!bar && /New message/.test(bar.t) && JSON.stringify(bar.btns)==='["Minimise","Full screen","Close"]');

  await page.fill('#mb-c-subject', 'Openings at Griffith');
  await page.fill('#mb-c-body', 'Hi Sam, two roles open — details below.');

  // ═══ 2. MINIMISE KEEPS EVERYTHING; THE PAGE BEHIND IS USABLE ═════════════
  await click('#layer .win-bar button[aria-label="Minimise"]');
  step('Minimise: the window leaves the screen', !(await modalOpen()));
  const chips = await tray();
  step('Minimise: it parks on a tray chip named for the window', chips.length===1 && /New message/.test(chips[0]), JSON.stringify(chips));
  await ev(()=>goPage('clients')); await page.waitForTimeout(500);
  const pageNow = await ev(()=>({ page:STATE.page, chip:!!document.querySelector('#win-tray .win-chip'), blocked: !!document.querySelector('#layer .overlay') }));
  step('Minimise: you can go and look at anything — the page changes, the chip stays, nothing blocks the screen', pageNow.page==='clients' && pageNow.chip && !pageNow.blocked, JSON.stringify(pageNow));

  // ═══ 3. A PARKED WINDOW THAT REPAINTS ITSELF MUST NOT POP OPEN ═══════════
  await ev(()=>mbComposeSetSig(true));      // the composer repaints itself (signature toggled)
  await page.waitForTimeout(400);
  step('Parked: when the composer repaints itself it does NOT open over the page', !(await modalOpen()));
  step('Parked: …and it is still on the tray', (await tray()).length===1);
  await ev(()=>mbComposeSetSig(false));
  await page.waitForTimeout(200);

  // ═══ 4. BRING IT BACK AS LEFT ════════════════════════════════════════════
  await click('#win-tray .win-chip');
  const back = await ev(()=>({ open:!!document.querySelector('#layer .modal'),
    subject:(document.getElementById('mb-c-subject')||{}).value, body:(document.getElementById('mb-c-body')||{}).value,
    to:(document.getElementById('mb-c-to')||{}).value, tray:document.querySelectorAll('#win-tray .win-chip').length }));
  step('Restore: the window comes back', back.open && back.tray===0, JSON.stringify(back));
  step('Restore: what was typed is still there', back.subject==='Openings at Griffith' && /two roles open/.test(back.body||'') && back.to==='client@example.test');

  // ═══ 5. FULL SCREEN NEVER REBUILDS THE WINDOW ════════════════════════════
  await page.fill('#mb-c-body', 'Typed AFTER restoring — must survive full screen.');
  await click('#layer .win-bar button[aria-label="Full screen"]');
  const full = await ev(()=>{ const m=document.querySelector('#layer .modal'); const r=m.getBoundingClientRect();
    return { max:!!document.querySelector('#layer .overlay.win-max'), w:Math.round(r.width), h:Math.round(r.height), vw:innerWidth, vh:innerHeight,
      body:document.getElementById('mb-c-body').value }; });
  step('Full screen: the window fills the screen', full.max && full.w>=full.vw-2 && full.h>=full.vh-2, JSON.stringify(full));
  step('Full screen: nothing typed was lost (the window was not rebuilt)', /AFTER restoring/.test(full.body));
  await click('#layer .win-bar button[aria-label="Full screen"]');
  const small = await ev(()=>{ const r=document.querySelector('#layer .modal').getBoundingClientRect(); return { max:!!document.querySelector('#layer .overlay.win-max'), w:Math.round(r.width) }; });
  step('Full screen: pressing it again returns to the normal size', !small.max && small.w<900, JSON.stringify(small));

  // ═══ 6. CLOSING A PARKED WINDOW DISCARDS IT AND ITS DRAFT ════════════════
  await click('#layer .win-bar button[aria-label="Minimise"]');
  const kept = await ev(()=>!!STATE.mailbox.compose);
  await click('#win-tray .win-chip .wx');
  const gone = await ev(()=>({ chips:document.querySelectorAll('#win-tray .win-chip').length, draft:!!STATE.mailbox.compose, modal:!!document.querySelector('#layer .modal') }));
  step('Close (parked): the draft was kept while parked', kept);
  step('Close (parked): closing the chip discards the window AND its draft — no ghost', gone.chips===0 && !gone.draft && !gone.modal, JSON.stringify(gone));

  // ═══ 7. THE BAR'S CLOSE BUTTON, AND COMPOSING AGAIN ══════════════════════
  await ev(()=>mbCompose('a@b.test'));
  await click('#layer .win-bar button[aria-label="Close"]');
  step('Close: the bar\'s × closes the window', !(await modalOpen()) && (await tray()).length===0);

  // ═══ 8. ONE NEW MESSAGE AT A TIME: "New message" while one is parked ═════
  await ev(()=>mbCompose('first@example.test'));
  await page.fill('#mb-c-subject', 'First draft');
  await click('#layer .win-bar button[aria-label="Minimise"]');
  await ev(()=>mbCompose('second@example.test'));
  await page.waitForTimeout(300);
  const again = await ev(()=>({ subject:(document.getElementById('mb-c-subject')||{}).value, to:(document.getElementById('mb-c-to')||{}).value, chips:document.querySelectorAll('#win-tray .win-chip').length }));
  step('New message while one is parked: brings the parked draft back instead of silently replacing it',
    again.subject==='First draft' && again.to==='first@example.test' && again.chips===0, JSON.stringify(again));
  await click('#layer .win-bar button[aria-label="Close"]');

  // ═══ 9. SEVERAL AT ONCE, AND SWAP ════════════════════════════════════════
  await ev(()=>mbCompose('swap@example.test'));
  await page.fill('#mb-c-subject', 'Draft A');
  await click('#layer .win-bar button[aria-label="Minimise"]');
  await ev(()=>{ STATE.modal='<div class="modal modal-w480" onclick="event.stopPropagation()"><div class="mhd">Reminder note</div><div style="padding:14px"><textarea id="rem-x" class="sel"></textarea></div></div>'; render(); });
  await page.fill('#rem-x', 'call Sam at 3');
  await ev(()=>{ const chip=document.querySelector('#win-tray .win-chip'); chip.click(); });
  await page.waitForTimeout(300);
  const swap = await ev(()=>({ open:(document.querySelector('#layer .modal .win-t')||{}).textContent, chips:[...document.querySelectorAll('#win-tray .win-chip .wt')].map(x=>x.textContent),
    subject:(document.getElementById('mb-c-subject')||{}).value }));
  step('Swap: bringing one back parks the one on screen — nothing is thrown away',
    /New message/.test(swap.open||'') && swap.chips.length===1 && /Reminder note/.test(swap.chips[0]) && swap.subject==='Draft A', JSON.stringify(swap));
  await ev(()=>{ const chip=document.querySelector('#win-tray .win-chip'); chip.click(); });
  await page.waitForTimeout(300);
  const note = await ev(()=>({ v:(document.getElementById('rem-x')||{}).value, chips:[...document.querySelectorAll('#win-tray .win-chip .wt')].map(x=>x.textContent) }));
  step('Swap: the other window comes back with its text too', note.v==='call Sam at 3' && note.chips.length===1, JSON.stringify(note));
  await click('#layer .win-bar button[aria-label="Close"]');
  await click('#win-tray .win-chip .wx');
  step('Swap: everything can be closed', !(await modalOpen()) && (await tray()).length===0);

  // ═══ 10. AN ALERT DIALOG IS NOT PARKABLE ═════════════════════════════════
  await ev(()=>showAlreadyAdded({ title:'Already added', message:'This person is already on the lead.' }));
  await page.waitForTimeout(200);
  const al = await ev(()=>({ bar:!!document.querySelector('#layer .win-bar'), parkable:Dock.parkable() }));
  step('Alert dialog: a question that needs an answer has no minimise', !al.bar && !al.parkable, JSON.stringify(al));
  await ev(()=>dupClose());

  // ═══ 11. A RECORD DRAWER PARKS AND REOPENS ═══════════════════════════════
  await ev(()=>{ goPage('clients'); }); await page.waitForTimeout(500);
  await ev(()=>clientsOpen('co1')); await page.waitForTimeout(500);
  const drawer = await ev(()=>({ open:!!document.querySelector('.dwr'), min:!!document.querySelector('.dwr-nav [title="Minimise"]') }));
  step('Client record: the drawer offers Minimise', drawer.open && drawer.min, JSON.stringify(drawer));
  await click('.dwr-nav [title="Minimise"]');
  const parked = await ev(()=>({ open:!!document.querySelector('.dwr'), chips:[...document.querySelectorAll('#win-tray .win-chip .wt')].map(x=>x.textContent), page:STATE.page }));
  step('Client record: minimising parks it on a chip named for the client, and you are still on the list',
    !parked.open && parked.chips.length===1 && /Griffith Energy/.test(parked.chips[0]) && parked.page==='clients', JSON.stringify(parked));
  await ev(()=>goPage('dashboard')); await page.waitForTimeout(300);
  await click('#win-tray .win-chip');
  await page.waitForTimeout(500);
  const reopened = await ev(()=>({ open:!!document.querySelector('.dwr'), page:STATE.page, chips:document.querySelectorAll('#win-tray .win-chip').length }));
  step('Client record: from another page, the chip takes you to the record again', reopened.open && reopened.page==='clients' && reopened.chips===0, JSON.stringify(reopened));
  await ev(()=>clientsBack());

  // ═══ 11b. DRAG THE CHIP ALONG THE BOTTOM — A DRAG DOES NOT OPEN IT ═══════
  await page.setViewportSize({ width:1440, height:900 });
  await ev(()=>mbCompose('drag@example.test'));
  await page.waitForTimeout(250);
  await click('#layer .win-bar button[aria-label="Minimise"]');
  const before = await ev(()=>{ const c=document.querySelector('#win-tray .win-chip'); const r=c.getBoundingClientRect(); return { left:r.left, open:!!document.querySelector('#layer .modal') }; });
  await ev(()=>{
    const chip=document.querySelector('#win-tray .win-chip');
    const r=chip.getBoundingClientRect();
    const fire=(type,x)=>chip.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:r.top+8,pointerId:1,button:0}));
    fire('pointerdown', r.left+12);
    fire('pointermove', r.left+220);
    fire('pointerup', r.left+220);
    chip.click();
  });
  const dragged = await ev(()=>{
    const c=document.querySelector('#win-tray .win-chip'); const r=c.getBoundingClientRect();
    const it=(STATE.dock&&STATE.dock.items||[])[0];
    return { left:Math.round(r.left), x:it&&it.x, open:!!document.querySelector('#layer .modal'), wide:document.getElementById('win-tray').classList.contains('win-tray-wide') };
  });
  step('Drag: the chip moves along the bottom and the window stays closed', !before.open && !dragged.open && dragged.left > before.left + 80 && typeof dragged.x === 'number', JSON.stringify({ before, dragged }));
  await click('#win-tray .win-chip');
  step('Drag: a later click still opens it', await modalOpen());
  await click('#layer .win-bar button[aria-label="Minimise"]');
  await click('#win-tray .win-chip .wx');
  step('Drag: the × still closes the parked window', (await tray()).length===0 && !(await modalOpen()));

  // ═══ 12. THE PHONE ═══════════════════════════════════════════════════════
  await page.setViewportSize({ width:390, height:800 });
  await ev(()=>{ mbCompose('phone@example.test'); });
  await page.waitForTimeout(300);
  const btnH = await ev(()=>Math.round(document.querySelector('#layer .win-bar button').getBoundingClientRect().height));
  step('Phone: the window buttons are finger-sized', btnH>=36, btnH+'px');
  await click('#layer .win-bar button[aria-label="Minimise"]');
  const ph = await ev(()=>{ const t=document.getElementById('win-tray'); if(!t) return null; const r=t.getBoundingClientRect(); return { l:Math.round(r.left), r:Math.round(r.right), b:Math.round(r.bottom), vw:innerWidth, vh:innerHeight }; });
  step('Phone: the tray sits inside the screen', !!ph && ph.l>=0 && ph.r<=ph.vw && ph.b<=ph.vh, JSON.stringify(ph));
  const phoneDrag = await ev(()=>{
    const chip=document.querySelector('#win-tray .win-chip');
    const r=chip.getBoundingClientRect();
    const fire=(type,x)=>chip.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:r.top+8,pointerId:1,button:0}));
    fire('pointerdown', r.left+8);
    fire('pointermove', r.left+200);
    fire('pointerup', r.left+200);
    const it=(STATE.dock&&STATE.dock.items||[])[0];
    return { x:it&&it.x, pos:getComputedStyle(chip).position, open:!!document.querySelector('#layer .modal') };
  });
  step('Phone: a sideways drag does not pull the chip free — it stays a scrolling row, and it does not open', phoneDrag.x==null && phoneDrag.pos!=='absolute' && !phoneDrag.open, JSON.stringify(phoneDrag));
  await click('#win-tray .win-chip .wx');

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
