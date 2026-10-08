// THE OUTREACH PLAN EDITOR KEEPS WHAT YOU TYPE (owner, 8 Oct, with a screen recording: "I cannot change the subject line and then
// select the variables, the subject line is getting reset"). Cause: focusing a box (and the chip's own focus call) repainted the whole
// page, which wrote the SAVED text back over the typed text — so a typed subject, and the merge field just added to it, vanished.
//   * type in the subject, click a merge-field chip: the typed text AND the field are there
//   * type in the body, click into the subject: the body keeps what was typed
//   * type, then show the individual-skill chips (a button that repaints): nothing is lost
//   * a repaint from elsewhere (a signature arriving, a toast) loses nothing either
//   * Save puts the typed text away for good, and a second email ID keeps its OWN unsaved text apart
// Usage: node test/plan-editor-keeps-typing-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':(MIME[path.extname(p)]||'application/octet-stream')+'; charset=utf-8'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{
    window.__posts=[]; window.apiPost=function(p,b){ window.__posts.push([p,b]); return Promise.resolve({success:true}); };
    const u=STATE.user.id;
    STATE.userEmailsCache=STATE.userEmailsCache||{};
    STATE.userEmailsCache[u]=[{id:'m1',email_address:'amy@co-a.test',display_name:'Amy A',is_active:true,is_primary:true},{id:'m2',email_address:'amy@co-b.test',display_name:'Amy B',is_active:true}];
    STATE.emailSignaturesCache={m1:'<b>{{sender}}</b>',m2:'<b>{{sender}}</b>'};
    STATE.myOutreachPlan={tmpl_o1_subject:'Saved subject',tmpl_o1_body:'Saved body that the person wrote earlier for everyone.'};
    STATE.mailboxWording={};
    STATE.planFromEmailId='m1'; STATE.sigEmailId='m1'; STATE.activeTmpl='outreach'; STATE.emailTab='outreachplan'; STATE.page='email'; render();
  });
  await page.waitForSelector('#tmpl-o1-subj',{timeout:8000});
  const val=(id)=>ev((i)=>document.getElementById(i).value,id);
  const chip=(label)=>page.locator('button.var-chip',{hasText:new RegExp('^'+label+'$')}).first();

  // the exact thing in the recording
  await page.click('#tmpl-o1-subj'); await page.keyboard.press('End'); await page.keyboard.type(' for hiring');
  step('typing in the subject shows it', (await val('tmpl-o1-subj'))==='Saved subject for hiring');
  await chip('Job title').click(); await page.waitForTimeout(250);
  const s1=await val('tmpl-o1-subj');
  step('clicking a merge field keeps the typed text AND adds the field', /^Saved subject for hiring\{\{pos\}\}$/.test(s1) || (/Saved subject for hiring/.test(s1) && /\{\{pos\}\}/.test(s1)), JSON.stringify(s1));
  await chip('Company name').click(); await page.waitForTimeout(150);
  const s2=await val('tmpl-o1-subj');
  step('…and a second field is added too (nothing reset in between)', /Saved subject for hiring/.test(s2) && /\{\{pos\}\}/.test(s2) && /\{\{company\}\}/.test(s2), JSON.stringify(s2));
  step('the preview follows what is typed', /Saved subject for hiring/.test(await ev(()=>document.getElementById('plan-mail').innerText)));
  step('the chip bar says it is adding to the subject line', /Adding to:\s*Subject line/i.test(await ev(()=>document.querySelector('.cmp-edit').innerText)));

  // body typed, then clicking the subject
  await page.click('#tmpl-o1-body'); await page.keyboard.press('Control+End'); await page.keyboard.type(' EXTRA BODY');
  await page.click('#tmpl-o1-subj'); await page.waitForTimeout(200);
  step('typing in the body and then clicking the subject loses nothing in the body', /EXTRA BODY$/.test(await val('tmpl-o1-body')), JSON.stringify((await val('tmpl-o1-body')).slice(-30)));
  step('…and the subject is still what was typed', /Saved subject for hiring/.test(await val('tmpl-o1-subj')));
  step('…and the chip bar now says it adds to the subject', /Adding to:\s*Subject line/i.test(await ev(()=>document.querySelector('.cmp-edit').innerText)));
  await page.click('#tmpl-o1-body'); await page.waitForTimeout(150);
  step('…and moves to the body when the body is clicked', /Adding to:\s*Email body/i.test(await ev(()=>document.querySelector('.cmp-edit').innerText)));
  await page.keyboard.press('Control+End');
  await chip('First name').click(); await page.waitForTimeout(150);
  step('a field clicked while the body is the target goes into the BODY at the caret, nothing lost', /EXTRA BODY\{\{fn\}\}$/.test(await val('tmpl-o1-body')) && /Saved subject for hiring/.test(await val('tmpl-o1-subj')), JSON.stringify((await val('tmpl-o1-body')).slice(-30)));

  // the buttons of the chip bar itself
  await page.locator('button.seg-btn',{hasText:'Subject line'}).click(); await page.waitForTimeout(150);
  step('the "Subject line" button switches the target without losing the typing', /Saved subject for hiring/.test(await val('tmpl-o1-subj')) && /EXTRA BODY/.test(await val('tmpl-o1-body')));
  await page.locator('button',{hasText:'Show individual skills'}).click(); await page.waitForTimeout(150);
  step('showing the individual-skill chips (a repaint) loses nothing', /Saved subject for hiring/.test(await val('tmpl-o1-subj')) && /EXTRA BODY/.test(await val('tmpl-o1-body')) && (await page.locator('button.var-chip',{hasText:'Skill 1'}).count())>0);

  // a repaint from elsewhere
  await ev(()=>{ render(); }); await page.waitForTimeout(150);
  step('a repaint triggered from elsewhere (a signature arriving, anything) loses nothing', /Saved subject for hiring/.test(await val('tmpl-o1-subj')) && /EXTRA BODY/.test(await val('tmpl-o1-body')));

  // save, then the saved text is what shows
  await ev(()=>{ window.__posts=[]; saveOutreachTemplate('outreach','tmpl-o1-subj','tmpl-o1-body'); }); await page.waitForTimeout(250);
  step('Save sends exactly what was typed', await ev(()=>window.__posts.some(p=>p[1].key==='tmpl_o1_subject'&&/Saved subject for hiring/.test(p[1].value))&&window.__posts.some(p=>p[1].key==='tmpl_o1_body'&&/EXTRA BODY/.test(p[1].value))));
  await ev(()=>{ render(); }); await page.waitForTimeout(150);
  step('after Save the box shows the saved text (the unsaved copy is gone, not stuck)', /Saved subject for hiring/.test(await val('tmpl-o1-subj')));
  await ev(()=>{ STATE.myOutreachPlan.tmpl_o1_subject='Changed elsewhere'; render(); }); await page.waitForTimeout(150);
  step('…and a later change to the saved text shows (an old unsaved copy never overrides it)', (await val('tmpl-o1-subj'))==='Changed elsewhere');

  // a second email ID keeps its own unsaved text
  await ev(()=>{ STATE.myOutreachPlan.tmpl_scope='each'; render(); });
  await page.click('#tmpl-o1-subj'); await page.keyboard.press('End'); await page.keyboard.type(' [A]');
  await ev(()=>selectPlanFromEmail('m2')); await page.waitForTimeout(200);
  await page.click('#tmpl-o1-subj'); await page.keyboard.press('End'); await page.keyboard.type(' [B]');
  step('with a wording per email ID, each email ID keeps its OWN unsaved typing apart', /\[B\]$/.test(await val('tmpl-o1-subj')) && !/\[A\]/.test(await val('tmpl-o1-subj')));
  await ev(()=>selectPlanFromEmail('m1')); await page.waitForTimeout(200);
  step('…switching back brings the first one\'s typing back', /\[A\]$/.test(await val('tmpl-o1-subj')) && !/\[B\]/.test(await val('tmpl-o1-subj')), await val('tmpl-o1-subj'));
  step('no page errors', errs.length===0, errs.join('|').slice(0,300));
} catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
