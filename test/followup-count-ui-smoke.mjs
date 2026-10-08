// HOW MANY FOLLOW-UPS — THE PERSON'S CHOICE, AND A BLANK START (D-0113) — the owner (8 Oct): "the system gives a blank template for a user to
// start with. They decide the templates, emails, counts and all" and "it's the user's choice to select the number of follow-ups, if any needed."
//   * a person who has written nothing sees BLANK boxes (no stock text), and is told an unwritten follow-up is not written yet
//   * the count (0–5, two unless chosen) decides the tabs; a count beyond the open tab moves back to Outreach 1
//   * each follow-up has its own day (must be after the one before), its own same-thread / new-email choice
//   * moving a day pushes later follow-ups after it, saving each
// Usage: node test/followup-count-ui-smoke.mjs
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
    STATE.userEmailsCache[u]=[{id:'m1',email_address:'amy@co-a.test',display_name:'Amy A',is_active:true,is_primary:true}];
    STATE.emailSignaturesCache={m1:'<b>{{sender}}</b>'};
    STATE.myOutreachPlan={};            // a brand-new person
    STATE.mailboxWording={};
    STATE.planFromEmailId='m1'; STATE.sigEmailId='m1'; STATE.activeTmpl='outreach'; STATE.emailTab='outreachplan'; STATE.page='email'; render();
  });
  await page.waitForSelector('#tmpl-o1-subj',{timeout:8000});
  const val=(id)=>ev((i)=>document.getElementById(i).value,id);
  const tabs=()=>ev(()=>[...document.querySelectorAll('.cmp-edit button')].map(b=>b.innerText.trim()).filter(t=>/^(Outreach 1|Follow-up \d)$/.test(t)));
  step('a new person starts BLANK: no stock subject, no stock body', (await val('tmpl-o1-subj'))==='' && (await val('tmpl-o1-body'))==='');
  step('NO follow-ups until the person turns them on (D-0114): the count box says none and only Outreach 1 shows', (await val('fu-count-sel'))==='0' && JSON.stringify(await tabs())===JSON.stringify(['Outreach 1']), JSON.stringify(await tabs()));
  await ev(()=>{ window.__posts=[]; setFollowupCount('2'); }); await page.waitForTimeout(200);
  step('turning on two shows Follow-up 1 and 2', JSON.stringify(await tabs())===JSON.stringify(['Outreach 1','Follow-up 1','Follow-up 2']));
  await ev(()=>planSetTmpl('fu1')); await page.waitForTimeout(150);
  step('Follow-up 1 is blank too, defaults to day 3, and says it has not been written yet', (await val('tmpl-fu1-subj'))==='' && (await val('tmpl-fu1-body'))==='' && (await val('fu1-day-sel'))==='3' && /You have not written this follow-up yet/.test(await ev(()=>document.querySelector('.cmp-edit').innerText)));
  step('…and it says nothing goes out for it until it is written (PACE never sends wording the person did not write)', /nothing goes out for it/.test(await ev(()=>document.querySelector('.cmp-edit').innerText)));
  // count to 4
  await ev(()=>{ window.__posts=[]; setFollowupCount('4'); }); await page.waitForTimeout(200);
  step('choosing 4 saves fu_count = 4', await ev(()=>window.__posts.some(p=>p[0]==='/outreach-plan'&&p[1].key==='fu_count'&&p[1].value==='4')));
  step('…and there are now five tabs', JSON.stringify(await tabs())===JSON.stringify(['Outreach 1','Follow-up 1','Follow-up 2','Follow-up 3','Follow-up 4']), JSON.stringify(await tabs()));
  await ev(()=>planSetTmpl('fu3')); await page.waitForTimeout(150);
  step('Follow-up 3 defaults to day 14 and says that, unwritten, nothing goes out', (await val('fu3-day-sel'))==='14' && /nothing goes out for it/.test(await ev(()=>document.querySelector('.cmp-edit').innerText)));
  step('Follow-up 3 only offers days after Follow-up 2 (day 7)', await ev(()=>[...document.querySelectorAll('#fu3-day-sel option')].filter(o=>o.value).every(o=>Number(o.value)>7)));
  await ev(()=>{ window.__posts=[]; setFollowupThread('fu3_thread','new'); }); await page.waitForTimeout(150);
  step('Follow-up 3 can be sent as a new email (saved under its own key)', await ev(()=>window.__posts.some(p=>p[1].key==='fu3_thread'&&p[1].value==='new')) && await ev(()=>STATE.myOutreachPlan.fu3_thread==='new'));
  await ev(()=>{ window.__posts=[]; document.getElementById('tmpl-fu3-subj').value='Checking in'; document.getElementById('tmpl-fu3-body').value='Hi {{fn}}, one more note from {{sender}}.'; saveOutreachTemplate('fu3','tmpl-fu3-subj','tmpl-fu3-body'); }); await page.waitForTimeout(200);
  step('Follow-up 3 wording is saved under tmpl_fu3_*', await ev(()=>window.__posts.length===2 && window.__posts.every(p=>p[0]==='/outreach-plan'&&/^tmpl_fu3_/.test(p[1].key))));
  step('…and once written the "not written yet" note is gone', !/You have not written this follow-up yet/.test(await ev(()=>document.querySelector('.cmp-edit').innerText)));
  // typing survives a repaint (count change)
  await ev(()=>{ document.getElementById('tmpl-fu3-subj').value='Half typed subject'; });
  await ev(()=>setFollowupCount('5')); await page.waitForTimeout(200);
  step('changing the count does not wipe what was being typed', (await val('tmpl-fu3-subj'))==='Half typed subject');
  // day cascade: set follow-up 1 to day 20 → 2 (7) must move after it, 3 (14) after that, 4 (21 default) after that, 5 (28) stays
  await ev(()=>planSetTmpl('fu1')); await page.waitForTimeout(150);
  await ev(()=>{ window.__posts=[]; saveOutreachDay('fu1_day','20'); }); await page.waitForTimeout(250);
  const days=await ev(()=>({d2:STATE.myOutreachPlan.fu2_day,d3:STATE.myOutreachPlan.fu3_day,d4:STATE.myOutreachPlan.fu4_day,d5:STATE.myOutreachPlan.fu5_day,posts:window.__posts.filter(p=>/_day$/.test(p[1].key)).map(p=>p[1].key+'='+p[1].value)}));
  step('moving Follow-up 1 to day 20 pushes the later ones after it (21, 22, 23, then 28 stays untouched)', days.d2==='21' && days.d3==='22' && days.d4==='23' && days.d5===undefined, JSON.stringify(days));
  step('…each moved day is saved', ['fu1_day=20','fu2_day=21','fu3_day=22','fu4_day=23'].every(x=>days.posts.includes(x)), days.posts.join(','));
  // fewer follow-ups than the open tab
  await ev(()=>planSetTmpl('fu4')); await page.waitForTimeout(100);
  await ev(()=>setFollowupCount('1')); await page.waitForTimeout(200);
  step('lowering the count below the open tab goes back to Outreach 1; two tabs remain', JSON.stringify(await tabs())===JSON.stringify(['Outreach 1','Follow-up 1']) && await ev(()=>STATE.activeTmpl==='outreach'), JSON.stringify(await tabs()));
  await ev(()=>{ window.__posts=[]; setFollowupCount('0'); }); await page.waitForTimeout(200);
  step('none at all: only Outreach 1, and the box says so', JSON.stringify(await tabs())===JSON.stringify(['Outreach 1']) && (await val('fu-count-sel'))==='0');
  step('0 is saved as "0" — a real choice, not an empty one', await ev(()=>window.__posts.some(p=>p[1].key==='fu_count'&&p[1].value==='0')));
  await ev(()=>{ window.__posts=[]; setFollowupCount('9'); setFollowupThread('fu9_thread','same'); });
  step('nonsense is never sent (count 9, a sixth follow-up\'s thread)', await ev(()=>window.__posts.length===0));
  step('no page errors', errs.length===0, errs.join(' | '));
} catch(e){ console.error(e); results.push(false); console.log('[FAIL] crashed — '+e.message); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
