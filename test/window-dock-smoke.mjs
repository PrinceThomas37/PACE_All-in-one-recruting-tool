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
  // Type the way a person does: into the visible editor (D-0118 — #mb-c-body is only the store behind it, and nothing listens to it).
  const typeInEditor = async (t) => { await page.click('#mb-c-editor'); await page.keyboard.press('Control+A'); await page.keyboard.insertText(t); };
  await typeInEditor('Hi Sam, two roles open — details below.');

  // ═══ 2. MINIMISE KEEPS EVERYTHING; THE PAGE BEHIND IS USABLE ═════════════
  await click('#layer .win-bar button[aria-label="Minimise"]');
  step('Minimise: the window leaves the screen', !(await modalOpen()));
  const chips = await tray();
  step('Minimise: it parks on a tray chip named for the window (and what it is about)', chips.length===1 && /^New: Openings at Griffith/.test(chips[0]), JSON.stringify(chips));
  // R-240 (owner, 14 Oct): "the default position of the minimised window is left bottom, I want that in right bottom".
  const corner = await ev(()=>{ const r=document.querySelector('#win-tray .win-chip').getBoundingClientRect(); return { fromRight:Math.round(innerWidth-r.right), fromBottom:Math.round(innerHeight-r.bottom), vw:innerWidth }; });
  step('Minimise: the chip sits in the bottom-RIGHT corner', corner.fromRight<=24 && corner.fromBottom<=24, JSON.stringify(corner));
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
  // The box a person SEES, not the hidden store behind it — a guard on the store alone passed while the screen came back blank.
  const seen = await ev(()=>(document.getElementById('mb-c-editor')||{}).textContent);
  step('Restore: the message box a person sees still shows what was typed', /two roles open/.test(seen||''), JSON.stringify(seen));

  // ═══ 5. FULL SCREEN NEVER REBUILDS THE WINDOW ════════════════════════════
  await typeInEditor('Typed AFTER restoring — must survive full screen.');
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
  const kept = await ev(()=>Dock.parked('mailCompose').length===1 && !!Dock.parked('mailCompose')[0].ctx);   // the chip holds the window's own draft
  await click('#win-tray .win-chip .wx');
  const gone = await ev(()=>({ chips:document.querySelectorAll('#win-tray .win-chip').length, draft:Dock.parked('mailCompose').length>0 || !!STATE.mailbox.compose, modal:!!document.querySelector('#layer .modal') }));
  step('Close (parked): the draft was kept while parked', kept);
  step('Close (parked): closing the chip discards the window AND its draft — no ghost', gone.chips===0 && !gone.draft && !gone.modal, JSON.stringify(gone));

  // ═══ 7. THE BAR'S CLOSE BUTTON, AND COMPOSING AGAIN ══════════════════════
  await ev(()=>mbCompose('a@b.test'));
  await click('#layer .win-bar button[aria-label="Close"]');
  step('Close: the bar\'s × closes the window', !(await modalOpen()) && (await tray()).length===0);

  // ═══ 8. SEVERAL NEW MESSAGES AT ONCE (R-240) ═══════════════════════════
  // Owner, 14 Oct: "i cannot open multiple compose or reply window at one time". Each window keeps its OWN draft.
  const typeIn = async (t) => { await page.click('#mb-c-editor'); await page.keyboard.press('Control+A'); await page.keyboard.insertText(t); };
  const seenNow = () => ev(()=>({ subject:(document.getElementById('mb-c-subject')||{}).value, to:(document.getElementById('mb-c-to')||{}).value, text:(document.getElementById('mb-c-editor')||{}).textContent,
    chips:[...document.querySelectorAll('#win-tray .win-chip .wt')].map(x=>x.textContent) }));
  await ev(()=>mbCompose('first@example.test'));
  await page.fill('#mb-c-subject', 'First draft'); await typeIn('Body of the FIRST message');
  await ev(()=>mbCompose('second@example.test'));          // does NOT replace or recall the first: it opens a new one
  await page.waitForTimeout(300);
  const two = await seenNow();
  step('Second New message: opens a NEW blank window and parks the first on the tray', two.to==='second@example.test' && two.subject==='' && two.chips.length===1 && /First draft/.test(two.chips[0]), JSON.stringify(two));
  await page.fill('#mb-c-subject', 'Second draft'); await typeIn('Body of the SECOND message');
  await ev(()=>mbCompose('third@example.test')); await page.waitForTimeout(250);
  const three = await seenNow();
  step('Third New message: three windows at once (one open, two on the tray)', three.chips.length===2, JSON.stringify(three));
  await click('#layer .win-bar button[aria-label="Close"]');
  const chipClick = async (re) => ev((src)=>{ const c=[...document.querySelectorAll('#win-tray .win-chip')].find(x=>new RegExp(src).test(x.textContent)); if(!c) return false; c.click(); return true; }, re);
  await chipClick('First draft'); await page.waitForTimeout(300);
  const f1 = await seenNow();
  step('Bring the FIRST back: its own subject, address and words — not the other draft\'s', f1.subject==='First draft' && f1.to==='first@example.test' && f1.text==='Body of the FIRST message', JSON.stringify(f1));
  step('…and the second one is on the tray, untouched', f1.chips.length===1 && /Second draft/.test(f1.chips[0]), JSON.stringify(f1.chips));
  await chipClick('Second draft'); await page.waitForTimeout(300);
  const f2 = await seenNow();
  step('Bring the SECOND back: its own words, and the first is parked again', f2.text==='Body of the SECOND message' && f2.subject==='Second draft' && f2.chips.length===1 && /First draft/.test(f2.chips[0]), JSON.stringify(f2));
  await click('#layer .win-bar button[aria-label="Close"]');
  await click('#win-tray .win-chip .wx');
  step('…and everything can be closed', !(await modalOpen()) && (await tray()).length===0);

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

  // ═══ 11b. DRAG THE CHIP ANYWHERE — A DRAG DOES NOT OPEN IT (R-240) ══════
  await page.setViewportSize({ width:1440, height:900 });
  await ev(()=>mbCompose('drag@example.test'));
  await page.waitForTimeout(250);
  await click('#layer .win-bar button[aria-label="Minimise"]');
  const before = await ev(()=>{ const c=document.querySelector('#win-tray .win-chip'); const r=c.getBoundingClientRect(); return { left:r.left, top:r.top, open:!!document.querySelector('#layer .modal') }; });
  await ev(()=>{
    const chip=document.querySelector('#win-tray .win-chip');
    const r=chip.getBoundingClientRect();
    const fire=(type,x,y)=>chip.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,button:0}));
    fire('pointerdown', r.left+12, r.top+8);
    fire('pointermove', r.left-300, r.top-250);      // left AND up — not just along the bottom
    fire('pointerup', r.left-300, r.top-250);
    chip.click();
  });
  const dragged = await ev(()=>{
    const c=document.querySelector('#win-tray .win-chip'); const r=c.getBoundingClientRect();
    const it=(STATE.dock&&STATE.dock.items||[])[0];
    return { left:Math.round(r.left), top:Math.round(r.top), x:it&&it.x, y:it&&it.y, open:!!document.querySelector('#layer .modal') };
  });
  step('Drag: the chip moves anywhere (left and up) and the window stays closed', !before.open && !dragged.open && dragged.left < before.left - 200 && dragged.top < before.top - 150 && typeof dragged.x==='number' && typeof dragged.y==='number', JSON.stringify({ before, dragged }));
  await ev(()=>{ goPage('dashboard'); }); await page.waitForTimeout(300);
  const stays = await ev(()=>{ const r=document.querySelector('#win-tray .win-chip').getBoundingClientRect(); return { left:Math.round(r.left), top:Math.round(r.top) }; });
  step('Drag: the chip stays where it was put when the page changes', Math.abs(stays.left-dragged.left)<=2 && Math.abs(stays.top-dragged.top)<=2, JSON.stringify({ dragged, stays }));
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
  const phRight = await ev(()=>{ const c=document.querySelector('#win-tray .win-chip').getBoundingClientRect(); return { fromRight:Math.round(innerWidth-c.right), fromLeft:Math.round(c.left) }; });
  step('Narrow layout: the chip hugs the bottom-RIGHT, not the left', phRight.fromRight<=24 && phRight.fromLeft>phRight.fromRight, JSON.stringify(phRight));
  // a desktop window zoomed in or narrowed to the same layout (860px and under) must do the same
  await page.setViewportSize({ width:800, height:700 }); await page.waitForTimeout(200);
  const narrowDesk = await ev(()=>{ const c=document.querySelector('#win-tray .win-chip').getBoundingClientRect(); return { fromRight:Math.round(innerWidth-c.right), fromLeft:Math.round(c.left), vw:innerWidth }; });
  step('Narrow desktop window (800px): the chip is still in the bottom-right corner', narrowDesk.fromRight<=24 && narrowDesk.fromLeft>narrowDesk.fromRight, JSON.stringify(narrowDesk));
  await page.setViewportSize({ width:390, height:800 }); await page.waitForTimeout(200);
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
