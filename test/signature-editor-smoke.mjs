// THE SIGNATURE EDITOR SHOWS THE SIGNATURE, NOT ITS CODE (owner, 7 Oct: "Edit signature does not allow to edit in the
// edit window, some random codes are shown which makes no sense to anyone, not user friendly"). In a real browser:
//   * opening the editor shows the signature as it will look — no HTML tags, no {{sender}} codes on screen;
//   * the name / email are chips that show the real values, and "+ My name" / "+ My email" add them;
//   * typing + bold work, and Save stores the SAME template format as before ({{sender}} back in place, no chip markup);
//   * what is saved can never carry a script or an on-event handler (pasted content is cleaned);
//   * the preset buttons fill the editor.
// Usage: node test/signature-editor-smoke.mjs   (SHOTS=dir keeps a screenshot)
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
    const u=STATE.user.id; window.__put=[];
    window.apiPut=(p,b)=>{ window.__put.push([p,b]); return Promise.resolve({success:true}); };
    STATE.userEmailsCache=STATE.userEmailsCache||{};
    STATE.userEmailsCache[u]=[{id:'m1',email_address:'prince.thomas@futeglobal.com',display_name:'Prince Thomas',is_active:true,is_primary:true}];
    STATE.emailSignaturesCache={m1:'<div style="font-family:Arial"><p style="margin:0"><strong>{{sender}}</strong></p><p style="margin:0">Recruitment Manager | <a href="mailto:{{senderemail}}">{{senderemail}}</a></p></div>'};
    STATE.myOutreachPlan={}; STATE.planFromEmailId=null; STATE.sigEmailId='m1'; STATE.activeTmpl='outreach'; STATE.emailTab='outreachplan'; STATE.page='email'; STATE.sigEditing=false; render();
  });
  await page.waitForSelector('text=Edit signature',{timeout:8000});
  await ev(()=>sigEditToggle());
  await page.waitForSelector('#sig-editor',{timeout:5000});
  const shown=await ev(()=>({ text:document.getElementById('sig-editor').innerText, raw:document.getElementById('sig-editor').innerHTML, area:!!document.getElementById('sig-html-input'), ed:document.getElementById('sig-editor').isContentEditable, chips:[...document.querySelectorAll('#sig-editor .sig-ph')].map(c=>c.dataset.ph+'='+c.textContent) }));
  step('opening the editor shows the signature itself — and no code box', shown.ed && !shown.area && /Prince Thomas/.test(shown.text) && /Recruitment Manager/.test(shown.text), JSON.stringify(shown.text));
  step('…no {{sender}} codes and no HTML tags in what the person reads', !/\{\{|\}\}|<div|<p |<strong/.test(shown.text), shown.text);
  step('…the name and email are chips with the REAL values', shown.chips.includes('sender=Prince Thomas') && shown.chips.includes('senderemail=prince.thomas@futeglobal.com'), shown.chips.join(' | '));
  if(SHOTS) await page.screenshot({path:path.join(SHOTS,'signature-editor.png')});

  // type, bold, add a chip
  await page.click('#sig-editor'); await page.keyboard.press('Control+End');
  await page.keyboard.type(' Dallas office');
  await page.keyboard.press('Control+a'); await ev(()=>sigCmd('bold'));
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
  await ev(()=>sigInsert('sender'));
  const added=await ev(()=>document.querySelectorAll('#sig-editor .sig-ph[data-ph="sender"]').length);
  step('"+ My name" adds a name chip', added===2, String(added));
  await ev(()=>sigCmd('removeFormat'));

  // save: same template format
  await ev(()=>saveSig()); await page.waitForTimeout(150);
  const put=await ev(()=>window.__put[0]);
  const saved=put&&put[1]&&put[1].signature_html||'';
  step('Save stores the signature on that mailbox', !!put && /\/emails\/m1\/signature$/.test(put[0]), JSON.stringify(put&&put[0]));
  step('…as the same TEMPLATE format as before: {{sender}} / {{senderemail}} back in place, no chip markup', /\{\{sender\}\}/.test(saved) && /\{\{senderemail\}\}/.test(saved) && !/data-ph|sig-ph/.test(saved), saved.slice(0,200));
  step('…and the typed words are in it', /Dallas office/.test(saved), saved.slice(0,200));

  // opening and saving without touching anything changes nothing (no drift in what is stored)
  await ev(()=>{ STATE.sigEditing=false; STATE.emailSignaturesCache.m1='<div style="font-family:Arial"><p style="margin:0"><strong>{{sender}}</strong></p><p style="margin:0">Recruitment Manager | <a href="mailto:{{senderemail}}">{{senderemail}}</a></p></div>'; sigEditToggle(); });
  await page.waitForSelector('#sig-editor');
  await ev(()=>{ window.__put=[]; saveSig(); }); await page.waitForTimeout(150);
  step('opening and saving without a change stores the identical signature', await ev(()=>window.__put[0]&&window.__put[0][1].signature_html==='<div style="font-family:Arial"><p style="margin:0"><strong>{{sender}}</strong></p><p style="margin:0">Recruitment Manager | <a href="mailto:{{senderemail}}">{{senderemail}}</a></p></div>'), await ev(()=>window.__put[0]&&window.__put[0][1].signature_html));

  // pasted/unsafe content never reaches what is saved
  await ev(()=>{ STATE.sigEditing=false; sigEditToggle(); });
  await page.waitForSelector('#sig-editor');
  await ev(()=>{ window.__put=[]; document.getElementById('sig-editor').innerHTML='<p>Hi <img src="x" onerror="alert(1)"> <a href="javascript:alert(2)">bad</a></p><script>alert(3)<\/script><iframe src="https://evil.test"></iframe>'; saveSig(); });
  await page.waitForTimeout(150);
  const bad=await ev(()=>window.__put[0]&&window.__put[0][1].signature_html||'');
  step('what is saved carries no script, no on-event handler, no javascript: link, no iframe', bad.length>0 && !/<script|onerror|javascript:|<iframe/i.test(bad), bad);

  // an empty editor saves as "no signature"
  await ev(()=>{ STATE.sigEditing=false; sigEditToggle(); });
  await page.waitForSelector('#sig-editor');
  await ev(()=>{ window.__put=[]; document.getElementById('sig-editor').innerHTML=''; saveSig(); });
  await page.waitForTimeout(150);
  step('an emptied editor saves as an empty signature (not stray markup)', await ev(()=>window.__put[0]&&window.__put[0][1].signature_html==='' ));

  // presets
  await ev(()=>{ STATE.sigEditing=false; sigEditToggle(); });
  await page.waitForSelector('#sig-editor');
  await ev(()=>applySigPreset('minimal')); await page.waitForSelector('#sig-editor');
  step('a preset fills the editor (visually — still no codes)', await ev(()=>/Prince Thomas/.test(document.getElementById('sig-editor').innerText) && !/\{\{/.test(document.getElementById('sig-editor').innerText)));
  step('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
}catch(e){ step('suite ran', false, e&&e.stack||String(e)); }
finally{ if(browser) await browser.close(); server.close(); }
const failed=results.filter(x=>!x).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
