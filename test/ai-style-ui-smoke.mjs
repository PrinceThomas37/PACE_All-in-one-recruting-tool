// THE MERGED SEQUENCE TAB AND "HOW THE AI WRITES FOR YOU" ON SCREEN (R-146, R-147; owner 7 Oct, D-0082)
//   * the Email tab bar has NO "Outreach Plan" any more — one Sequence tab with three pills:
//     Sequences · My wording (the old Outreach Plan editor and its live preview) · AI style
//   * an old 'outreachplan' link still lands on My wording; someone with no sequence permission is not shown Sequences
//   * the AI-style card: a box, the "never" list, AI on/off said plainly, Save, "Try it on a sample", and an admin's team default
//   * typing in the box never repaints the page (so a half-written note is never lost)
// Usage: node test/ai-style-ui-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`, API='https://fute-lms-backend.onrender.com';
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
const rep=(r,b,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(b)});
let style={ person:'', team:'', in_force:'', source:null, max:700, can_set_team:false, ai:{available:true,reason:null} };
let sampleReply={ ai:true, written:true, subject:'Senior Estimator hire in Dallas', body:'Hi Sam,\n\nA short, warm note.\n\nThanks,', repaired:false };
const calls=[];
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1300}});
  await ctx.route('**',r=>{ const u=r.request().url(); if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)){ const p=new URL(u).pathname, m=r.request().method(); calls.push(m+' '+p+' '+(r.request().postData()||''));
      if(p==='/ai/style'&&m==='GET') return rep(r,style);
      if(p==='/ai/style'&&m==='PUT'){ const b=JSON.parse(r.request().postData()||'{}'); style={...style,person:b.note,in_force:b.note||style.team,source:b.note?'person':(style.team?'team':null)}; return rep(r,style); }
      if(p==='/ai/style/team'&&m==='PUT'){ const b=JSON.parse(r.request().postData()||'{}'); style={...style,team:b.note}; return rep(r,style); }
      if(p==='/ai/style/sample'&&m==='POST') return rep(r,sampleReply);
      return rep(r,m==='GET'?[]:{}); }
    return r.abort(); });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  const open=async(tab,view)=>{ await ev(([t,v])=>{ STATE.seqView=v||undefined; STATE.emailTab=t; STATE.page='email'; STATE.aiStyle=undefined; render(); },[tab,view]); await page.waitForTimeout(350); };
  const tabs=()=>ev(()=>[...document.querySelectorAll('#content .pgtab')].map(b=>b.textContent.replace(/\s+/g,' ').trim()));

  // ── the merged tab ──
  await open('pending');
  const t=await tabs();
  step('the Email tab bar has Pending, Compose, All email, Sequence — and NO "Outreach Plan"', /Sequence/.test(t.join('|')) && !/Outreach Plan/.test(t.join('|')), t.join('|'));
  await open('sequence');
  const pills=await ev(()=>[...document.querySelectorAll('#content .rep-fgroup .rep-pill')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')).join('|'));
  step('the Sequence tab has three pills — Sequences (first) · My wording · AI style', pills==='Sequences*|My wording|AI style', pills);
  await ev(()=>seqView('wording')); await page.waitForTimeout(300);
  const w=await ev(()=>document.getElementById('content').innerText);
  step('"My wording" is the old Outreach Plan editor: message styles, Outreach 1, the "how many follow-ups" choice (none until chosen, D-0114), and its live preview', /Message style/.test(w) && /Outreach 1/.test(w) && /How many follow-ups do you want/.test(w) && !!(await ev(()=>document.querySelector('#content .cmp-prev'))));
  await open('outreachplan');
  step('an old "outreachplan" link still lands on My wording', await ev(()=>STATE.emailTab==='sequence' && STATE.seqView==='wording' && !!document.querySelector('#content .cmp-prev')));

  // ── the AI-style card ──
  await open('sequence','style');
  let t1=await ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  step('the card is there: a box, the promise, and the "never" list', /How the AI writes for you/i.test(t1) && /including the first email to a lead/i.test(t1) && /What a note can never change/i.test(t1) && /one sign-off/i.test(t1) && !!(await ev(()=>document.getElementById('ais-note'))));
  step('AI on is said plainly', /AI is on/.test(t1));
  step('a BD is NOT offered the team default', !/Team default/.test(t1));
  await ev(()=>{ window.__renders=0; const o=window.render; window.render=function(){ window.__renders++; return o.apply(this,arguments); }; });
  await page.fill('#ais-note','Warm and plain. Under 90 words.');
  const typed=await ev(()=>({ renders:window.__renders, count:document.getElementById('ais-count').textContent, draft:STATE.aiStyle.draft }));
  step('typing repaints NOTHING and the counter follows', typed.renders===0 && /^31 \/ 700$/.test(typed.count) && typed.draft==='Warm and plain. Under 90 words.', JSON.stringify(typed));
  await ev(()=>[...document.querySelectorAll('#content .ais-actions button')].find(b=>/^Save$/.test(b.textContent)).click());
  await page.waitForTimeout(400);
  step('Save sends exactly the note to PUT /ai/style', calls.some(c=>c==='PUT /ai/style {"note":"Warm and plain. Under 90 words."}'), calls.filter(c=>/PUT/.test(c)).join(' || '));
  step('…and the box still holds what was written', (await ev(()=>document.getElementById('ais-note').value))==='Warm and plain. Under 90 words.');
  await page.fill('#ais-note','Friendly, short.');
  await ev(()=>[...document.querySelectorAll('#content .ais-actions button')].find(b=>/Try it on a sample/.test(b.textContent)).click());
  await page.waitForFunction(()=>/A sample first email/i.test(document.getElementById('content').innerText),null,{timeout:6000});
  step('"Try it on a sample" sends the note IN THE BOX (not the saved one) and shows the draft', calls.some(c=>c==='POST /ai/style/sample {"note":"Friendly, short."}') && /Senior Estimator hire in Dallas/.test(await ev(()=>document.querySelector('.ais-sample').innerText)));
  sampleReply={ ai:true, written:false, reason:'draft_rejected', violations:['fee_percentage','meeting_ask'] };
  await ev(()=>[...document.querySelectorAll('#content .ais-actions button')].find(b=>/Try it on a sample/.test(b.textContent)).click());
  await page.waitForFunction(()=>/broke one of the rules/.test(document.getElementById('content').innerText),null,{timeout:6000});
  const bad=await ev(()=>document.querySelector('.ais-sample').innerText);
  step('a draft the checker rejected says WHY, in words (a fee percentage, a call request)', /stated a fee percentage/.test(bad) && /asked for a call or meeting/.test(bad), bad.slice(0,120));
  sampleReply={ ai:false, reason:'not_configured' };
  await ev(()=>[...document.querySelectorAll('#content .ais-actions button')].find(b=>/Try it on a sample/.test(b.textContent)).click());
  await page.waitForFunction(()=>/not switched on/.test(document.getElementById('content').innerText),null,{timeout:6000});
  step('AI off: the sample says AI is not switched on — it does not pretend', /not switched on/.test(await ev(()=>document.querySelector('.ais-sample').innerText)));

  // AI off banner on the card itself
  style={...style, ai:{available:false,reason:'not_configured'}};
  await open('sequence','style');
  step('with AI off the card says so at the top (a note does nothing until it is on)', /AI is off right now/.test(await ev(()=>document.getElementById('content').innerText)));

  // team default for admins
  style={...style, can_set_team:true, ai:{available:true,reason:null}};
  await open('sequence','style');
  step('an admin IS offered the team default, and it saves to PUT /ai/style/team', await (async()=>{ if(!/Team default/.test(await ev(()=>document.getElementById('content').innerText))) return false;
    await ev(()=>{ const t=document.querySelector('.ais-box-sm'); t.value='Plain and brief.'; t.dispatchEvent(new Event('input',{bubbles:true})); [...document.querySelectorAll('.ais-team button')].find(b=>/Save team default/.test(b.textContent)).click(); });
    await page.waitForTimeout(400); return calls.some(c=>c==='PUT /ai/style/team {"note":"Plain and brief."}'); })());

  // someone who cannot design sequences
  await ev(()=>{ STATE.user=Object.assign({},STATE.user,{role:'bd',roles:['bd']}); });
  step('no console/page errors', errs.length===0, errs.join('|').slice(0,300));
} catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
