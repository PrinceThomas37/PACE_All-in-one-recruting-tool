// THE OUTREACH PLAN TAB HAS A LIVE PREVIEW (owner, 6 Oct: "a lot of blank space here" on the right of the
// template editor). In a real browser:
//   * a preview sits to the right of the editor, filled in for an EXAMPLE person (and says it is one)
//   * {{sender}} / {{senderemail}} come from the sending mailbox picked above — not the session user
//   * typing in the subject or body updates the preview without repainting the page (the caret stays)
//   * a field PACE cannot fill is left visible and marked, never blanked
//   * the preview follows the tab (Outreach 1 → Follow-up 1) and the merge chips
//   * it is beside the editor at desktop width, and below it on a phone, with nothing poking out
// Usage: node test/plan-preview-smoke.mjs   (SHOTS=dir keeps a screenshot)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':(MIME[path.extname(p)]||'application/octet-stream')+'; charset=utf-8'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`; const SHOTS=process.env.SHOTS||'';
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:900}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{
    const u=STATE.user.id;
    STATE.userEmailsCache=STATE.userEmailsCache||{};
    STATE.userEmailsCache[u]=[{id:'m1',email_address:'prince.thomas@futeglobal.com',display_name:'Prince Thomas',is_active:true,is_primary:true},{id:'m2',email_address:'kristy@fute-global.com',display_name:'Kristy Scott',is_active:true}];
    STATE.emailSignaturesCache={m1:'<b>{{sender}}</b><br>Fute Global',m2:'<b>{{sender}}</b><br>Other'};
    STATE.myOutreachPlan={fu_count:'2',tmpl_o1_subject:'Candidates for your {{pos}} role in {{loc}}',tmpl_o1_body:'Hi {{fn}},\n\nI\'m {{sender}} ({{senderemail}}). {{bogus_field}} {{company}}.',tmpl_fu1_subject:'Following up: {{pos}}',tmpl_fu1_body:'Hi {{fn}}, checking in.'};
    STATE.planFromEmailId=null; STATE.activeTmpl='outreach'; STATE.emailTab='outreachplan'; STATE.page='email'; render();
  });
  await page.waitForSelector('#plan-mail',{timeout:8000});
  const mail=()=>ev(()=>document.getElementById('plan-mail').innerText.replace(/\s+/g,' ').trim());
  let m=await mail();
  step('a preview is on the page, beside the editor', await ev(()=>{ const a=document.querySelector('.cmp-edit').getBoundingClientRect(), b=document.querySelector('.cmp-prev').getBoundingClientRect(); return b.left>=a.right-1 && Math.abs(a.top-b.top)<40; }));
  step('it is filled in for the example person (Sam, Senior…, Dallas)', /Candidates for your .* role in Dallas, TX/.test(m) && /Hi Sam,/.test(m), m.slice(0,140));
  step('it says it is an example', /example person/i.test(await ev(()=>document.querySelector('.cmp-prev').innerText)));
  step('{{sender}} and {{senderemail}} come from the picked mailbox, not the session user', /I'm Prince Thomas \(prince\.thomas@futeglobal\.com\)/.test(m), m);
  step('a field PACE cannot fill stays visible and marked', await ev(()=>!!document.querySelector('#plan-mail .cmp-unset') && /\{\{bogus_field\}\}/.test(document.getElementById('plan-mail').innerText)));
  step('the signature of that mailbox is shown', /Fute Global/.test(m));

  // typing updates the preview, not the page
  await ev(()=>{ window.__renders=0; const r=window.render; window.render=function(){ window.__renders++; return r.apply(this,arguments); }; });
  const subj=page.locator('#tmpl-o1-subj'); await subj.click(); await page.waitForTimeout(150);
  await ev(()=>{ window.__renders=0; });   // focusing a box re-points the chip bar (an existing, deliberate render) — typing is what must not render
  await subj.fill('Hello {{fn}} about {{company}}');
  step('typing in the subject updates the preview', /Hello Sam about Acme Builders/.test(await mail()), await mail());
  step('…without repainting the page (no render())', (await ev(()=>window.__renders))===0);
  step('…and the caret/focus stays in the box', await ev(()=>document.activeElement&&document.activeElement.id==='tmpl-o1-subj'));
  const body=page.locator('#tmpl-o1-body'); await body.click(); await body.fill('Line one {{loc}}');
  step('typing in the body updates the preview', /Line one Dallas, TX/.test(await mail()));

  // switching the sending mailbox changes the sender in the preview
  await ev(()=>{ STATE.planFromEmailId='m2'; STATE.sigEmailId='m2'; render(); });
  await body.fill('From {{sender}}');
  step('picking another sending mailbox changes who the preview is from', /From Kristy Scott/.test(await mail()) && /kristy@fute-global\.com/.test(await ev(()=>document.querySelector('.cmp-prev').innerText)));

  // the tab
  await ev(()=>{ STATE.activeTmpl='fu1'; render(); }); await page.waitForTimeout(100);
  step('the preview follows the tab (Follow-up 1)', /Following up: Senior Estimator/.test(await mail()) && /How Follow-up 1 reads/.test(await ev(()=>document.querySelector('.cmp-prev-h').innerText)));

  if(SHOTS){ fs.mkdirSync(SHOTS,{recursive:true}); await ev(()=>{ STATE.activeTmpl='outreach'; STATE.planFromEmailId='m1'; render(); }); await page.waitForTimeout(300); await page.screenshot({path:path.join(SHOTS,'plan-preview-desktop.png')}); }

  // R-144 (owner): "1 - overlapping, 2nd is blank space … align this preview to the middle
  // in between the space, so it is equal on both sides." The pair (editor + preview) must be
  // CENTRED at every screen width, never overlap, and when stacked be one width.
  await ev(()=>{ STATE.planFromEmailId=null; STATE.activeTmpl='outreach'; render(); });
  const geo=()=>ev(()=>{
    const body=document.querySelector('#content .pg-body').getBoundingClientRect(), e=document.querySelector('.cmp-edit').getBoundingClientRect(), p=document.querySelector('.cmp-prev').getBoundingClientRect();
    const hit=!(e.right<=p.left+0.5||p.right<=e.left+0.5||e.bottom<=p.top+0.5||p.bottom<=e.top+0.5);
    const left=Math.min(e.left,p.left)-body.left, right=body.right-Math.max(e.right,p.right);
    return { vw:window.innerWidth, left:Math.round(left), right:Math.round(right), overlap:hit, sameWidth:Math.abs(e.width-p.width)<2, sideBySide:p.left>=e.right-1 };
  });
  const bad=[]; let wide=0;
  for(const w of [1920,1728,1536,1440,1280,1180,1100,1000]){
    await page.setViewportSize({width:w,height:900}); await page.waitForTimeout(250);
    const g=await geo();
    if(g.overlap) bad.push(w+': the two overlap');
    if(Math.abs(g.left-g.right)>2) bad.push(w+': unequal sides '+g.left+' vs '+g.right);
    if(!g.sideBySide && !g.sameWidth) bad.push(w+': stacked at different widths');
    if(g.sideBySide && g.left>40) wide++;
  }
  step('the editor + preview pair is centred (equal sides), never overlaps, and stacks at one width, from 1000px to 1920px', bad.length===0, bad.join(' | '));
  step('…the wide-screen check really had room to centre (the probe can measure)', wide>=2, wide+' widths with room');

  // phone
  await page.setViewportSize({width:390,height:800}); await page.waitForTimeout(400);
  const ph=await ev(()=>{ const e=document.querySelector('.cmp-edit').getBoundingClientRect(), p=document.querySelector('.cmp-prev').getBoundingClientRect(); const c=document.getElementById('content'); return {below:p.top>=e.bottom-2, over:c.scrollWidth-c.clientWidth, pw:Math.round(p.width), vw:innerWidth}; });
  step('phone: the preview sits BELOW the editor and nothing pokes out sideways', ph.below && ph.over<=1 && ph.pw<=ph.vw, JSON.stringify(ph));
  step('No page errors', errs.length===0, errs.join('|').slice(0,300));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
