// MY SETUP — any person sets up their OWN outreach (owner, 8 Oct 2026)
//   * "My Setup" is in everybody's Setup menu; a card on Today asks until the steps are done, then draws nothing
//   * add a mailbox (Outlook or Gmail): the window asks who it writes for (company, title, postal address required), shows the
//     signature as it is typed, sends sends_as and NO limit/primary, then opens that provider's sign-in for THAT mailbox
//   * each mailbox says who it writes for (or says plainly that it does not yet), can be edited, reconnected, removed
//   * the plan wall's words reach the person; an incomplete form is refused before anything is sent
// The server rules themselves are in self-serve-mailbox-smoke.mjs; what is asserted HERE is what the person sees and asks for.
// Usage: node test/mysetup-page-smoke.mjs   (SHOTS=dir keeps screenshots)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`, SHOTS=process.env.SHOTS||''; if (SHOTS) fs.mkdirSync(SHOTS,{recursive:true});
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1200,height:900}});
  await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e))); page.on('dialog',d=>d.accept());
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'}); await waitForLogin(page);
  await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{
    window.__calls=[]; window.__opened=[]; window.__fail=null;
    window.__boxes=[{ id:'m1', user_id:'test-bd', email_address:'bd@fute.test', display_name:'Test BD', platform:'Microsoft', is_active:true, daily_send_limit:150, connection:{connected:true,status:'ok'}, sends_as:null, has_own_signature:false }];
    window.open=function(u){ window.__opened.push(u); return {}; };
    const rec=(m,p,b)=>window.__calls.push([m,p,b]);
    window.apiGet=function(p){ rec('GET',p); if(/\/users\/test-bd\/emails$/.test(p)) return Promise.resolve(JSON.parse(JSON.stringify(window.__boxes))); if(p==='/outreach-plan') return Promise.resolve({}); return Promise.resolve({}); };
    window.apiPost=function(p,b){ rec('POST',p,b);
      if(/\/users\/test-bd\/emails$/.test(p)){ if(window.__fail) return Promise.reject(new Error(window.__fail)); const e={ id:'m2', user_id:'test-bd', email_address:b.email_address, display_name:b.display_name, platform:b.platform, is_active:true, daily_send_limit:150 }; window.__boxes.push(Object.assign({}, e, { connection:{connected:false,status:'none'}, sends_as:b.sends_as, has_own_signature:true })); return Promise.resolve(Object.assign({}, e, { sends_as:b.sends_as })); }   // the server answers with what it saved
      return Promise.resolve({}); };
    window.apiPut=function(p,b){ rec('PUT',p,b); if(/sends-as$/.test(p)){ const id=p.split('/')[4]; const m=window.__boxes.find(x=>x.id===id); m.sends_as={company:b.company,title:b.title,address:b.address,phone:b.phone,website:b.website}; if(b.rebuild_signature) m.has_own_signature=true; return Promise.resolve({ sends_as:m.sends_as, signature_rebuilt:!!b.rebuild_signature }); } return Promise.resolve({}); };
    window.apiDelete=function(p){ rec('DELETE',p); window.__boxes=window.__boxes.filter(x=>p.indexOf(x.id)<0); return Promise.resolve({}); };
    STATE.userEmailsCache={ 'test-bd': JSON.parse(JSON.stringify(window.__boxes)) }; STATE.myOutreachPlan={}; STATE.page='dashboard'; render();
  });
  await page.waitForTimeout(300);
  const nav=()=>ev(()=>document.getElementById('sidebar').innerText);
  const txt=()=>ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  const calls=()=>ev(()=>window.__calls);

  console.log('\nWhere it is');
  step('"My Setup" is in the Setup menu', /My Setup/.test(await nav()) || await ev(()=>/My Setup/.test(document.getElementById('sidebar').innerHTML)));
  let t=await txt();
  step('Today carries one calm card: "Finish setting up your outreach · 1 of 3 done" naming the next step (say who the mailbox writes for) with an Open button', /Finish setting up your outreach · 1 of 3 done/.test(t) && /Say who each mailbox writes for/.test(t) && /Open My Setup/.test(t), t.slice(0,160));
  await ev(()=>{ STATE.userEmailsCache={}; render(); }); await page.waitForTimeout(150);
  step('…and nothing before the mailboxes have loaded (no flash of an alarm)', !/Finish setting up/.test(await txt()));
  await ev(()=>{ STATE.userEmailsCache={ 'test-bd': JSON.parse(JSON.stringify(window.__boxes)) }; render(); });

  console.log('\nThe page');
  await ev(()=>goPage('mysetup')); await page.waitForTimeout(400);
  t=await txt();
  step('three steps: connect a mailbox ✓, say who each writes for, write your first sequence — with where it stands', /Your outreach setup · 1 of 3 done/.test(t) && /Connect your mailbox/.test(t) && /1 mailbox connected/.test(t) && /Write your first sequence/.test(t) && /standard wording, which names Fute Global LLC/.test(t));
  step('each mailbox is listed with its state, who it writes for ("not said yet" says what that means), and the daily limit is shown as the admin\'s', /bd@fute\.test/.test(t) && /Connected/.test(t) && /Writes for: not said yet/.test(t) && /standard name, title and signature/.test(t) && /set by an admin/.test(t));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS,'mysetup-page.png') });

  console.log('\nAdd a mailbox');
  await ev(()=>mySetupAdd('Microsoft')); await page.waitForTimeout(250);
  const modalTxt=()=>ev(()=>(STATE.modal||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
  step('the window asks for the address, the name, and WHO IT WRITES FOR (company, title, postal address, optional phone and website)', /Email address/.test(await modalTxt()) && /Company it writes for/.test(await modalTxt()) && /Company postal address/.test(await modalTxt()) && /Phone \(optional\)/.test(await modalTxt()) && /Website \(optional\)/.test(await modalTxt()));
  await page.fill('#ms-email','vp@acmetalent.com'); await page.fill('#ms-name','Vic President'); await page.fill('#ms-company','Acme Talent LLC'); await page.fill('#ms-title','Vice President');
  await page.fill('#ms-address','12 Market St, Austin, TX 78701'); await page.fill('#ms-website','acmetalent.com');
  const prev=await ev(()=>document.getElementById('ms-preview').innerText.replace(/\s+/g,' '));
  step('the signature shows as it is typed: name, title | company, email | website, address — and nothing of Fute Global', /Vic President/.test(prev) && /Vice President \| Acme Talent LLC/.test(prev) && /vp@acmetalent\.com \| acmetalent\.com/.test(prev) && /12 Market St/.test(prev) && !/Fute/.test(prev), prev);
  if (SHOTS) { const el=await page.$('.modal'); if(el) await el.screenshot({ path: path.join(SHOTS,'mysetup-add.png') }); }
  await page.fill('#ms-address','Austin');
  await ev(()=>mySetupSave()); await page.waitForTimeout(200);
  step('an incomplete form is refused in words, in the window, and nothing is sent', /postal address/.test(await modalTxt()) && !(await calls()).some(c=>c[0]==='POST'));
  await page.fill('#ms-address','12 Market St, Austin, TX 78701');
  await ev(()=>{ window.__fail='Your Free plan includes 1 connected mailbox. Upgrade to add more.'; });
  await ev(()=>mySetupSave()); await page.waitForTimeout(250);
  step('when the plan has no room, the plan\'s own sentence is shown in the window (not a bare failure)', /Your Free plan includes 1 connected mailbox/.test(await modalTxt()) && await ev(()=>!!STATE.modal));
  await ev(()=>{ window.__fail=null; window.__calls.length=0; });
  await ev(()=>mySetupSave()); await page.waitForTimeout(300);
  const post=(await calls()).find(c=>c[0]==='POST'&&/\/users\/test-bd\/emails$/.test(c[1]));
  step('Save asks for a mailbox for THEMSELVES with what it writes for — and sends no daily limit and no "primary" (those are an admin\'s)', post && post[2].email_address==='vp@acmetalent.com' && post[2].platform==='Microsoft' && post[2].sends_as.company==='Acme Talent LLC' && post[2].sends_as.title==='Vice President' && post[2].sends_as.address.length>8 && !('daily_send_limit' in post[2]) && !('is_primary' in post[2]), JSON.stringify(post&&post[2]));
  const opened=await ev(()=>window.__opened);
  step('then the Microsoft sign-in opens for THAT new mailbox (m2)', opened.length===1 && /\/auth\/microsoft\/connect\?userEmailId=m2/.test(opened[0]), opened.join());
  await page.waitForTimeout(300); t=await txt();
  step('it appears on the page, "Not signed in yet" until they finish, with who it writes for', /vp@acmetalent\.com/.test(t) && /Not signed in yet/.test(t) && /Vice President · Acme Talent LLC/.test(t));
  await ev(()=>mySetupAdd('Gmail')); await page.waitForTimeout(150);
  step('a second mailbox starts from the first one\'s company and address (not blank, not Fute Global)', await ev(()=>document.getElementById('ms-company').value)==='Acme Talent LLC' && (await ev(()=>document.getElementById('ms-address').value)).includes('Market St'));
  await page.fill('#ms-email','vp.second@gmail.com'); await ev(()=>mySetupSave()); await page.waitForTimeout(300);
  step('Gmail opens Google\'s sign-in for its mailbox, not Microsoft\'s', (await ev(()=>window.__opened)).length===2 && /\/auth\/google\/connect\?userEmailId=m2/.test((await ev(()=>window.__opened))[1]));

  console.log('\nChange and remove');
  await ev(()=>mySetupEdit('m1')); await page.waitForTimeout(200);
  step('editing a mailbox that has no signature of its own offers to write one from the details (ticked)', await ev(()=>document.getElementById('ms-rebuild').checked));
  await page.fill('#ms-company','Fute Global LLC'); await page.fill('#ms-title','Recruitment Manager'); await page.fill('#ms-address','8111 LBJ Freeway, Dallas, TX 75251');
  await ev(()=>{ window.__calls.length=0; }); await ev(()=>mySetupSave()); await page.waitForTimeout(250);
  const put=(await calls()).find(c=>c[0]==='PUT');
  step('Save sends it to that mailbox\'s own endpoint, with the rebuild choice', put && /\/users\/test-bd\/emails\/m1\/sends-as$/.test(put[1]) && put[2].company==='Fute Global LLC' && put[2].rebuild_signature===true, JSON.stringify(put));
  t=await txt();
  step('the page now says who m1 writes for and that it has its own signature', /Recruitment Manager · Fute Global LLC/.test(t) && /Has its own signature/.test(t));
  await ev(()=>{ window.__calls.length=0; mySetupRemove('m2'); }); await page.waitForTimeout(250);
  step('Remove (after the confirmation) deletes THAT mailbox for them and it leaves the list', (await calls()).some(c=>c[0]==='DELETE'&&/\/users\/test-bd\/emails\/m2$/.test(c[1])) && !/vp@acmetalent\.com/.test(await txt()));

  console.log('\nThe card goes away when the steps are done');
  await ev(()=>{ STATE.myOutreachPlan={ tmpl_o1_body:'Hi {{fn}}' }; STATE.userEmailsCache['test-bd'].forEach(m=>{ m.sends_as={company:'Acme',title:'VP',address:'12 Market St, Austin TX 78701'}; }); goPage('dashboard'); }); await page.waitForTimeout(300);
  step('with a connected mailbox that says who it writes for and a sequence of their own, Today shows no card', !/Finish setting up/.test(await txt()));
  await ev(()=>{ STATE.user.role='ra'; STATE.user.roles=['ra']; STATE.myOutreachPlan={}; STATE.userEmailsCache['test-bd'][0].sends_as=null; render(); }); await page.waitForTimeout(200);
  step('a person who does not send outreach (an analyst) is not nagged', !/Finish setting up/.test(await txt()));
  step('no page errors', errs.length===0, errs.join(' | '));
} catch(e){ step('test ran without throwing', false, String(e&&e.stack||e)); }
finally{ if(browser) await browser.close(); server.close(); }
const failed=results.filter(x=>!x).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
