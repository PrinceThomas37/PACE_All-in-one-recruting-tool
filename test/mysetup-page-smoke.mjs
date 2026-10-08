// MY SETUP — any person sets up their OWN outreach (owner, 8 Oct 2026, D-0103 / D-0104)
//   * "My Setup" is in everybody's Setup menu; a card on Today asks until the steps are done, then draws nothing; PACE's setup
//     tasks show on Reminders and "Needs you today" with a button to this page
//   * add a mailbox: who it writes for (company, title, postal address required), a signature you can FORMAT (font, size, colour,
//     bold, italic, underline, link, alignment) and an optional LOGO; it follows the typed details until you format it by hand
//   * the starter sequence is one click, saved as the person's own; sending days and hours can be narrowed
//   * starting outreach without a sequence says so and where to fix it (the Lead Finder's first-email box, and what the generator answers)
// The server rules are in self-serve-mailbox-smoke.mjs and my-setup-routes-smoke.mjs; HERE is what the person sees and asks for.
// Usage: node test/mysetup-page-smoke.mjs   (SHOTS=dir keeps screenshots)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const serverSig = require('../email-signature.js');
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
  const ctx=await browser.newContext({viewport:{width:1200,height:1000}});
  await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e))); page.on('dialog',d=>d.accept());
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'}); await waitForLogin(page);
  await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{
    window.__calls=[]; window.__opened=[]; window.__fail=null; window.__logo=null; window.__starter=null;
    window.__boxes=[{ id:'m1', user_id:'test-bd', email_address:'bd@fute.test', display_name:'Test BD', platform:'Microsoft', is_active:true, daily_send_limit:150, connection:{connected:true,status:'ok'}, sends_as:null, has_own_signature:false }];
    window.__win={ org:{start:8,end:16}, prefs:{days:null,start:null,end:null}, effective:{start:8,end:16,days:null,narrowed:false}, days:['sun','mon','tue','wed','thu','fri','sat'] };
    window.open=function(u){ window.__opened.push(u); return {}; };
    const rec=(m,p,b)=>window.__calls.push([m,p,b]);
    window.apiGet=function(p){ rec('GET',p);
      if(/\/users\/test-bd\/emails$/.test(p)) return Promise.resolve(JSON.parse(JSON.stringify(window.__boxes)));
      if(p==='/my-setup/send-window') return Promise.resolve(JSON.parse(JSON.stringify(window.__win)));
      if(p==='/outreach-plan') return Promise.resolve(window.__plan||{});
      if(p==='/reminders') return Promise.resolve(window.__reminders||[]);
      return Promise.resolve({}); };
    window.apiPost=function(p,b){ rec('POST',p,b);
      if(/\/users\/test-bd\/emails$/.test(p)){ if(window.__fail) return Promise.reject(new Error(window.__fail)); const e={ id:'m2', user_id:'test-bd', email_address:b.email_address, display_name:b.display_name, platform:b.platform, is_active:true, daily_send_limit:150 }; window.__boxes.push(Object.assign({}, e, { connection:{connected:false,status:'none'}, sends_as:b.sends_as, has_own_signature:true })); return Promise.resolve(Object.assign({}, e, { sends_as:b.sends_as })); }
      if(/signature-logo$/.test(p)){ if(window.__logo==='503') return Promise.reject(new Error('Logo upload is not switched on yet. Ask an admin to turn it on.')); return Promise.resolve({ url:'https://proj.supabase.co/storage/v1/object/public/signature-logos/o1/m2.png?v=abcd1234' }); }
      if(p==='/my-setup/sequence/starter'){ if(window.__starter==='nocompany') return Promise.reject(new Error('Say which company your mailbox writes for first (My Setup, step 2) — the starter uses your company\'s name.')); window.__plan={ tmpl_o1_subject:'S', tmpl_o1_body:'Hi {{fn}}, I\'m {{sender}} with Acme Talent LLC. Starter text goes here for the test.', fu1_day:'3', fu2_day:'7' }; return Promise.resolve({ company:'Acme Talent LLC', plan:window.__plan }); }
      if(p==='/my-setup/sync') return Promise.resolve({ owed:['mailbox'], created:['mailbox'], closed:0 });
      return Promise.resolve({}); };
    window.apiPut=function(p,b){ rec('PUT',p,b);
      if(/sends-as$/.test(p)){ const id=p.split('/')[4]; const m=window.__boxes.find(x=>x.id===id); m.sends_as={company:b.company,title:b.title,address:b.address,phone:b.phone,website:b.website,logo:b.logo,accent:b.accent}; if(b.rebuild_signature||b.signature_html) m.has_own_signature=true; return Promise.resolve({ sends_as:m.sends_as, signature_rebuilt:!!(b.rebuild_signature||b.signature_html) }); }
      if(p==='/my-setup/send-window'){ if(b.reset){ window.__win.effective={start:8,end:16,days:null,narrowed:false}; window.__win.prefs={days:null,start:null,end:null}; } else { window.__win.prefs={days:b.days,start:b.start,end:b.end}; window.__win.effective={start:b.start,end:b.end,days:b.days.length<7?b.days:null,narrowed:true}; } return Promise.resolve(JSON.parse(JSON.stringify(window.__win))); }
      return Promise.resolve({}); };
    window.apiDelete=function(p){ rec('DELETE',p); window.__boxes=window.__boxes.filter(x=>p.indexOf(x.id)<0); return Promise.resolve({}); };
    STATE.userEmailsCache={ 'test-bd': JSON.parse(JSON.stringify(window.__boxes)) }; STATE.myOutreachPlan={}; STATE.page='dashboard'; render();
  });
  await page.waitForTimeout(300);
  const nav=()=>ev(()=>document.getElementById('sidebar').innerText);
  const txt=()=>ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  const calls=()=>ev(()=>window.__calls);
  const modalTxt=()=>ev(()=>(STATE.modal||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));

  console.log('\nWhere it is');
  step('"My Setup" is in the Setup menu', /My Setup/.test(await nav()) || await ev(()=>/My Setup/.test(document.getElementById('sidebar').innerHTML)));
  let t=await txt();
  step('Today carries one calm card: "Finish setting up your outreach · 1 of 3 done" naming the next step with an Open button', /Finish setting up your outreach · 1 of 3 done/.test(t) && /Say who each mailbox writes for/.test(t) && /Open My Setup/.test(t), t.slice(0,160));
  await ev(()=>{ STATE.userEmailsCache={}; render(); }); await page.waitForTimeout(150);
  step('…and nothing before the mailboxes have loaded (no flash of an alarm)', !/Finish setting up/.test(await txt()));
  await ev(()=>{ STATE.userEmailsCache={ 'test-bd': JSON.parse(JSON.stringify(window.__boxes)) }; render(); });

  console.log('\nThe page');
  await ev(()=>goPage('mysetup')); await page.waitForTimeout(500);
  t=await txt();
  step('three steps — connect ✓, say who each writes for, write your first sequence — and the sequence says what it gates (leads outreach, the Finder\'s first email) and what it does not (individual emails)', /Your outreach setup · 1 of 3 done/.test(t) && /Connect your mailbox/.test(t) && /1 mailbox connected/.test(t) && /will not start outreach for your leads/.test(t) && /Individual emails are not affected/.test(t));
  step('the sequence step offers the starter (one click) or writing your own', /Use the starter/.test(t) && /Write my own/.test(t));
  step('each mailbox is listed with its state, who it writes for ("not said yet" says what that means), and the daily limit is shown as the admin\'s', /bd@fute\.test/.test(t) && /Connected/.test(t) && /Writes for: not said yet/.test(t) && /standard name, title and signature/.test(t) && /set by an admin/.test(t));
  step('sending days and hours are on the page, with the organisation\'s window and the line that the daily number stays with the admin', /Sending days and hours/.test(t) && /8 AM – 4 PM/.test(t) && /narrow that, not widen it/.test(t) && /stays with your admin/.test(t));
  step('the AI writing-style note is one click away', /How the AI writes for you/.test(t) && /Open my writing style/.test(t));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS,'mysetup-page.png'), fullPage:true });

  console.log('\nThe starter sequence');
  await ev(()=>{ window.__starter='nocompany'; });
  await ev(()=>mySetupStarter()); await page.waitForTimeout(250);
  step('with no company said, the starter says why and nothing changes', (await calls()).some(c=>c[1]==='/my-setup/sequence/starter') && /2 of 3|1 of 3/.test(await txt()) && !(await ev(()=>!!STATE.myOutreachPlan.tmpl_o1_body)));
  await ev(()=>{ window.__starter=null; window.__calls.length=0; });
  await ev(()=>mySetupStarter()); await page.waitForTimeout(400);
  t=await txt();
  step('with one, the starter is saved as their own: the step is done, the plan is in the Email page\'s editor fields, and the tasks are re-checked', /Your own wording is saved/.test(t) && await ev(()=>/Acme Talent LLC/.test(STATE.emailBody||'')) && (await calls()).some(c=>c[1]==='/my-setup/sync'));
  step('…and Today\'s card, the Finder box and the generator no longer say a sequence is missing', await ev(()=>mySetupNeedsSequence()===false));
  await ev(()=>{ STATE.myOutreachPlan={}; window.__plan={}; });

  console.log('\nAdd a mailbox, format its signature, add a logo');
  await ev(()=>mySetupAdd('Microsoft')); await page.waitForTimeout(300);
  step('the window asks for the address, the name and WHO IT WRITES FOR, shows a toolbar (font, size, colour, bold, italic, underline, strike, alignment, link, clear) and an editable signature', /Email address/.test(await modalTxt()) && /Company it writes for/.test(await modalTxt()) && /Company postal address/.test(await modalTxt()) && await ev(()=>!!document.getElementById('ms-font') && !!document.getElementById('ms-size') && !!document.getElementById('ms-colour') && document.querySelectorAll('.ms-toolbar .ms-tb').length>=8 && document.getElementById('sig-editor').getAttribute('contenteditable')==='true'));
  await page.fill('#ms-email','vp@acmetalent.com'); await page.fill('#ms-name','Vic President'); await page.fill('#ms-company','Acme Talent LLC'); await page.fill('#ms-title','Vice President');
  await page.fill('#ms-address','12 Market St, Austin, TX 78701'); await page.fill('#ms-website','acmetalent.com');
  const prev=()=>ev(()=>document.getElementById('sig-editor').innerText.replace(/\s+/g,' '));
  let p1=await prev();
  step('the signature shows as it is typed: name, title | company, email | website, address — nothing of Fute Global', /Vic President/.test(p1) && /Vice President \| Acme Talent LLC/.test(p1) && /vp@acmetalent\.com \| acmetalent\.com/.test(p1) && /12 Market St/.test(p1) && !/Fute/.test(p1), p1);
  const SAMPLE={ company:'Acme & <Co>', title:'VP', address:'1 Main St, Austin TX 78701', phone:'+1 555', website:'acme.com', accent:'#336699', logo:'https://proj.supabase.co/storage/v1/object/public/signature-logos/o1/m1.png?v=ab' };
  const clientBuilt=await ev((s)=>mySetupBuildSig(s),SAMPLE);
  step('the signature built here is the SAME words the server builds (so what is previewed is what is saved when nothing is edited)', clientBuilt===serverSig.signatureFromSendsAs(SAMPLE).replace(serverSig.OWN_SIGNATURE_MARK,''));
  step('…also without a logo or colour', (await ev((s)=>mySetupBuildSig(s),{company:'A',title:'T',address:'x'}))===serverSig.signatureFromSendsAs({company:'A',title:'T',address:'x'}).replace(serverSig.OWN_SIGNATURE_MARK,''));
  // formatting: select the company words and change size, font, colour, bold
  const selectText=(needle)=>ev((n)=>{ const el=document.getElementById('sig-editor'); const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); let node; while((node=w.nextNode())){ const i=node.nodeValue.indexOf(n); if(i>=0){ const r=document.createRange(); r.setStart(node,i); r.setEnd(node,i+n.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r); mySetupRemember(); return true; } } return false; },needle);
  step('(found the words to format)', await selectText('Vice President'));
  await ev(()=>mySetupSize('20')); await page.waitForTimeout(100);
  let html=await ev(()=>document.getElementById('sig-editor').innerHTML);
  step('SIZE: the selected words get an inline font-size of 20px', /<span[^>]*style="[^"]*font-size:\s*20px[^"]*"[^>]*>Vice President<\/span>/.test(html), html.slice(0,200));
  step('…and the signature is now the person\'s own: editing the fields above no longer overwrites it, and it says so', await ev(()=>STATE.mySetup.form.sigEdited===true) && /formatted this by hand/.test(await ev(()=>document.querySelector('.ms-sig-note').innerText)));
  await selectText('Acme Talent LLC'); await ev(()=>mySetupFont('Georgia'));
  await selectText('Vic President'); await ev(()=>mySetupColour('#b00020'));
  await selectText('Vic President'); await ev(()=>mySetupCmd('italic')); await ev(()=>mySetupCmd('underline'));
  html=await ev(()=>document.getElementById('sig-editor').innerHTML);
  step('FONT and COLOUR become inline styles on the words (not the browser\'s <font> tags)', /font-family:\s*Georgia/i.test(html) && /color:\s*rgb\(176,\s*0,\s*32\)|color:\s*#b00020/i.test(html) && !/<font/i.test(html));
  step('ITALIC and UNDERLINE apply too — also to the NAME, which is a locked chip (the formatting goes around the whole chip)', /<(i|em)[ >]|font-style:\s*italic/i.test(html) && /<u[ >]|text-decoration:\s*underline/i.test(html));
  const saved=await ev(()=>sigFromEditor());
  step('what is SAVED keeps the formatting on the name AND the {{sender}} field (formatting inside a chip would be thrown away)', /\{\{sender\}\}/.test(saved) && /<span[^>]*rgb\(176,\s*0,\s*32\)[^>]*>[^<]*(<[^>]+>)*\{\{sender\}\}/.test(saved) && /<(i|em)[ >]|italic/.test(saved) && !/sig-ph/.test(saved), saved.slice(0,400));
  await page.fill('#ms-title','Chief Executive');
  step('with the signature formatted by hand, typing in the details above does not overwrite it', /font-size:\s*20px/.test(await ev(()=>document.getElementById('sig-editor').innerHTML)) );
  await ev(()=>mySetupRebuildSig()); await page.waitForTimeout(150);
  p1=await prev();
  step('"Rebuild it from the details above" brings the plain signature back, with the new title', /Chief Executive \| Acme Talent LLC/.test(p1) && !/font-size:\s*20px/.test(await ev(()=>document.getElementById('sig-editor').innerHTML)) && /follows the details above/.test(await ev(()=>document.querySelector('.ms-sig-note').innerText)));
  await page.fill('#ms-title','Vice President');
  // the logo
  const png=await ev(()=>{ const c=document.createElement('canvas'); c.width=200; c.height=80; const x=c.getContext('2d'); x.fillStyle='#c0392b'; x.fillRect(0,0,200,80); x.fillStyle='#fff'; x.fillRect(20,20,60,40); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#ms-logo-file',{ name:'logo.png', mimeType:'image/png', buffer:Buffer.from(png,'base64') });
  await page.waitForFunction(()=>STATE.mySetup.form&&STATE.mySetup.form.logoData,null,{timeout:5000}).catch(()=>{});
  await page.waitForTimeout(300);
  const lf=await ev(()=>({ data:!!STATE.mySetup.form.logoData, accent:STATE.mySetup.form.accent, imgs:document.querySelectorAll('#sig-editor img').length, thumb:!!document.querySelector('.ms-logo-thumb'), colours:!!document.getElementById('ms-logo-colours') }));
  step('adding a logo shows it in the signature (beside the words) and as a thumbnail, and offers to use the logo\'s colour — taken from the picture (a red one gives a red)', lf.data && lf.imgs===1 && lf.thumb && lf.colours && /^#[0-9a-f]{6}$/i.test(lf.accent||'') && parseInt(lf.accent.slice(1,3),16)>150, JSON.stringify(lf));
  step('…and the name and links in the signature take that colour', (await ev(()=>document.getElementById('sig-editor').innerHTML)).toLowerCase().includes((lf.accent||'zz').toLowerCase()));
  if (SHOTS) { const el=await page.$('.modal'); if(el) await el.screenshot({ path: path.join(SHOTS,'mysetup-add.png') }); }
  await ev(()=>{ window.__calls.length=0; });
  await ev(()=>mySetupSave()); await page.waitForTimeout(500);
  let cs=await calls();
  const post=cs.find(c=>c[0]==='POST'&&/\/users\/test-bd\/emails$/.test(c[1]));
  step('Save: the mailbox is asked for with what it writes for — and no daily limit, no "primary", no picture inside the request', post && post[2].sends_as.company==='Acme Talent LLC' && !('daily_send_limit' in post[2]) && !('is_primary' in post[2]) && !JSON.stringify(post[2]).includes('data:image'));
  const up=cs.find(c=>/signature-logo$/.test(c[1]));
  step('…then the logo is uploaded for THAT mailbox (as base64, not a data: address)', up && /\/users\/test-bd\/emails\/m2\/signature-logo$/.test(up[1]) && !/^data:/.test(up[2].data_base64) && up[2].data_base64.length>100);
  const put=cs.find(c=>c[0]==='PUT'&&/m2\/sends-as$/.test(c[1]));
  step('…then who it writes for is saved WITH the logo\'s public address and colour, and asks for the signature to be rebuilt from them (nothing hand-formatted)', put && /signature-logos\/o1\/m2\.png\?v=abcd1234/.test(put[2].logo) && /^#[0-9a-f]{6}$/i.test(put[2].accent||'') && put[2].rebuild_signature===true && !put[2].signature_html, JSON.stringify(put&&put[2]).slice(0,200));
  step('the Microsoft sign-in opens for that new mailbox (m2)', (await ev(()=>window.__opened)).length===1 && /\/auth\/microsoft\/connect\?userEmailId=m2/.test((await ev(()=>window.__opened))[0]));
  step('…and the PACE task list is re-checked (the mailbox task)', cs.some(c=>c[1]==='/my-setup/sync'));

  console.log('\nA formatted signature is saved as formatted, and a missing logo store is explained');
  await ev(()=>{ window.__calls.length=0; window.__logo='503'; });
  await ev(()=>mySetupAdd('Gmail')); await page.waitForTimeout(250);
  step('a second mailbox starts from the first one\'s company, address and logo (not blank, not Fute Global)', await ev(()=>document.getElementById('ms-company').value)==='Acme Talent LLC' && (await ev(()=>document.getElementById('ms-address').value)).includes('Market St') && (await ev(()=>document.querySelectorAll('#sig-editor img').length))===1);
  await page.fill('#ms-email','vp.second@gmail.com');
  // the first mailbox's logo is inherited as an address (nothing to upload); choosing a NEW picture is what reaches the logo store
  await ev(()=>mySetupLogoRemove()); await page.waitForTimeout(100);
  await page.setInputFiles('#ms-logo-file',{ name:'logo2.png', mimeType:'image/png', buffer:Buffer.from(png,'base64') });
  await page.waitForFunction(()=>STATE.mySetup.form&&STATE.mySetup.form.logoData,null,{timeout:5000}).catch(()=>{});
  await page.waitForTimeout(300);
  await selectText('Vice President'); await ev(()=>mySetupCmd('bold'));
  await ev(()=>mySetupSave()); await page.waitForTimeout(500);
  cs=await calls();
  const put2=cs.find(c=>c[0]==='PUT'&&/sends-as$/.test(c[1]));
  step('a hand-formatted signature is what is SAVED (sent as signature_html, with the bold, the merge fields kept as {{sender}}), not the plain built one', put2 && /<b>Vice President<\/b>|<strong>Vice President<\/strong>|font-weight/.test(put2[2].signature_html||'') && /\{\{sender\}\}/.test(put2[2].signature_html||'') && !/data-ms-logo|<script/.test(put2[2].signature_html||''), (put2&&put2[2].signature_html||'').slice(0,160));
  step('Gmail opens Google\'s sign-in for its mailbox, not Microsoft\'s', (await ev(()=>window.__opened)).some(u=>/\/auth\/google\/connect\?userEmailId=m2/.test(u)));
  const upTry=cs.find(c=>/signature-logo$/.test(c[1]));
  step('with the logo store not switched on, the upload is tried, the mailbox is still saved WITHOUT a logo (no picture left in the signature), and the person is told in words', !!upTry && !(put2&&put2[2].logo) && !/<img/.test((put2&&put2[2].signature_html)||'') && /not switched on/.test(await ev(()=>STATE.toasts.map(t=>t.msg).join(' '))), JSON.stringify(put2&&put2[2]).slice(0,160));
  await ev(()=>{ window.__logo=null; });

  console.log('\nRefused, and changed, and removed');
  await ev(()=>mySetupAdd('Microsoft')); await page.waitForTimeout(200);
  await page.fill('#ms-email','x@y.test'); await page.fill('#ms-company','Acme'); await page.fill('#ms-title','VP'); await page.fill('#ms-address','Austin');
  await ev(()=>{ window.__calls.length=0; }); await ev(()=>mySetupSave()); await page.waitForTimeout(200);
  step('an incomplete form is refused in words, in the window, and nothing is sent', /postal address/.test(await modalTxt()) && !(await calls()).some(c=>c[0]==='POST'));
  await page.fill('#ms-address','12 Market St, Austin, TX 78701');
  await ev(()=>{ window.__fail='Your Free plan includes 1 connected mailbox. Upgrade to add more.'; });
  await ev(()=>mySetupSave()); await page.waitForTimeout(250);
  step('when the plan has no room, the plan\'s own sentence is shown in the window', /Your Free plan includes 1 connected mailbox/.test(await modalTxt()) && await ev(()=>!!STATE.modal));
  await ev(()=>{ window.__fail=null; mySetupClose(); });
  await ev(()=>mySetupEdit('m1')); await page.waitForTimeout(200);
  step('editing a mailbox with no signature of its own offers to replace it with the one in the window (ticked)', await ev(()=>document.getElementById('ms-rebuild').checked));
  await page.fill('#ms-company','Fute Global LLC'); await page.fill('#ms-title','Recruitment Manager'); await page.fill('#ms-address','8111 LBJ Freeway, Dallas, TX 75251');
  await ev(()=>{ window.__calls.length=0; }); await ev(()=>mySetupSave()); await page.waitForTimeout(300);
  const put3=(await calls()).find(c=>c[0]==='PUT');
  step('Save sends it to that mailbox\'s own endpoint, with the rebuild choice', put3 && /\/users\/test-bd\/emails\/m1\/sends-as$/.test(put3[1]) && put3[2].company==='Fute Global LLC' && put3[2].rebuild_signature===true);
  step('the page says who m1 writes for and that it has its own signature', /Recruitment Manager · Fute Global LLC/.test(await txt()) && /Has its own signature/.test(await txt()));
  await ev(()=>{ window.__calls.length=0; mySetupRemove('m2'); }); await page.waitForTimeout(250);
  step('Remove (after the confirmation) deletes THAT mailbox for them and it leaves the list', (await calls()).some(c=>c[0]==='DELETE'&&/\/users\/test-bd\/emails\/m2$/.test(c[1])) && !/vp@acmetalent\.com/.test(await txt()));

  console.log('\nSending days and hours');
  step('the card shows every day ticked and 8 AM – 4 PM before any choice', await ev(()=>[...document.querySelectorAll('#content input[type=checkbox]')].filter(c=>/mySetupWinDay/.test(c.getAttribute('onclick')||'')).every(c=>c.checked)));
  await ev(()=>{ window.__calls.length=0; mySetupWinDay('sat'); mySetupWinDay('sun'); document.getElementById('ms-win-start').value='9'; document.getElementById('ms-win-end').value='15'; });
  await ev(()=>mySetupWinSave()); await page.waitForTimeout(300);
  const wput=(await calls()).find(c=>c[0]==='PUT'&&c[1]==='/my-setup/send-window');
  step('narrowing sends the days and hours chosen (Mon–Fri, 9–15)', wput && wput[2].days.slice().sort().join()==='fri,mon,thu,tue,wed' && wput[2].start===9 && wput[2].end===15, JSON.stringify(wput&&wput[2]));
  t=await txt();
  step('…and the page says it plainly, with a way back to the organisation\'s hours', /goes out Mon, Tue, Wed, Thu, Fri, 9 AM – 3 PM/.test(t) && /Use my organisation's hours/.test(t));
  await ev(()=>mySetupWinReset()); await page.waitForTimeout(250);
  step('going back removes the choice', /every day, 8 AM – 4 PM/.test(await txt()) && !/Use my organisation's hours/.test(await txt()));

  console.log('\nTasks PACE put on the list, and starting outreach without a sequence');
  await ev(()=>{ window.__reminders=[{ id:'r1', user_id:'test-bd', reminder_type:'setup', contact_name:'Set up your outreach mailbox', company_name:'My Setup', note:'Connect the Outlook or Gmail mailbox…', status:'pending', return_date:new Date().toISOString().slice(0,10), reminder_time:'09:00', source:{ type:'setup', label:'Getting started', why:'PACE added this to get you started: your outreach cannot go out until it is done. It closes by itself once you have done it.' } }]; window.__calls.length=0; });
  await ev(()=>mySetupSync()); await page.waitForTimeout(400);
  step('the sync asks the server, and when it created something the reminders are reloaded', (await calls()).some(c=>c[1]==='/my-setup/sync') && (await calls()).some(c=>c[0]==='GET'&&c[1]==='/reminders') && await ev(()=>(STATE.reminders||[]).some(r=>r.id==='r1')));
  await ev(()=>goPage('reminders')); await page.waitForTimeout(400);
  const rem=await txt();
  step('on Reminders the task says who asked ("Getting started") and has an Open My Setup button', /Set up your outreach mailbox/.test(rem) && /Getting started/.test(rem) && await ev(()=>[...document.querySelectorAll('#content button')].some(b=>/Open My Setup/.test(b.textContent))));
  await ev(()=>{ STATE.myOutreachPlan={}; STATE.modal=null; });
  await ev(()=>noteNeedsSequence({ needs_sequence:[{ user_id:'test-bd', name:'Test BD', leads:2 }, { user_id:'other', name:'Bo B', leads:1 }] })); await page.waitForTimeout(200);
  let m=await modalTxt();
  step('when the generator says some leads got no email, the window names whose and how many, offers Open My Setup only for your own, and says what is NOT affected', /you have not written your sequence yet/.test(m) && /Bo B \(1 lead\)/.test(m) && /Open My Setup/.test(m) && /already waiting to go out are not affected/.test(m), m.slice(0,300));
  await ev(()=>{ STATE.modal=null; render(); noteNeedsSequence({ needs_sequence:[{ user_id:'other', name:'Bo B', leads:3 }] }); });
  m=await modalTxt();
  step('…for somebody else\'s leads alone there is no button to a page that cannot fix it', /Bo B \(3 leads\)/.test(m) && !/Open My Setup/.test(m) && !/you have not written your sequence/.test(m));
  await ev(()=>{ STATE.modal=null; render(); });
  step('no page errors', errs.length===0, errs.join(' | '));
} catch(e){ step('test ran without throwing', false, String(e&&e.stack||e)); }
finally{ if(browser) await browser.close(); server.close(); }
const failed=results.filter(x=>!x).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed?1:0);
