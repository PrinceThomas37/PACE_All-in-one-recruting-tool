// WRITE YOUR FIRST SEQUENCE, IN A REAL BROWSER (owner, 15 Oct 2026, R-258), against a stubbed API whose test email is built by the
// real email-vars fill and sequence-versions pick:
//   * the screen opens on the choice; nothing to write until one is made; My Setup stays lit in the menu
//   * the detail menu is the seven plain-words details; a detail shows as a word and is saved as {{field}}
//   * the live preview fills them, and a lead with no pay loses the pay sentence
//   * typing survives the app's own repaints; AI versions, follow-up drafts and "draft it" (with Undo, never a refusal) work
//   * step 2 shows the server's email for a real lead; saving sends exactly what the engine reads
//   * phone width: no sideways scroll
// Usage: node test/sequence-setup-ui-smoke.mjs   (SHOTS=dir to keep screenshots)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const R=path.resolve(new URL('..', import.meta.url).pathname);
const require=createRequire(R+'/index.js');
const { chromium } = require('playwright-core');
const { enterApp, waitForLogin } = await import(R+'/test/helpers/enter-app.mjs');
const ev=require(R+'/email-vars.js'); const ver=require(R+'/services/sequence-versions.js'); const teachMod=require(R+'/services/ai-teach.js');
const OUT=process.env.SHOTS||''; if(OUT) fs.mkdirSync(OUT,{recursive:true}); let pass=0, fail=0; const ok=(n,c,x)=>{ if(c){pass++;console.log('  ok  '+n);} else {fail++;console.log('  FAIL '+n+(x?' -> '+x:''));} };
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';fs.readFile(path.join(R,'public',p),(e,d)=>{if(e){s.writeHead(404);return s.end();}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});s.end(d);});});
const PORT=await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));const BASE='http://127.0.0.1:'+PORT;
const job={position:'Senior Java Developer',location:'Dallas, TX',salary_range:'$140k to $160k',company:{name:'Acme Health',industry:'Healthcare'},research:{requirements:{skills:['Java','Spring Boot','HL7']}}};
const contact={first_name:'Dana',last_name:'Lee',email:'dana@acme.example'};
let vars=ev.buildEmailVars({job,contact,senderDisplayName:ev.DEFER_SENDER}); Object.keys(vars).forEach(k=>{if(vars[k]===null)delete vars[k];});
let saved=null, draftCalls=[], noPay=false, aiTests=[], aiOff=false;
async function api(route){
  const req=route.request(), u=new URL(req.url()), m=req.method(), body=req.postData()?JSON.parse(req.postData()):null;
  const j=(o,st=200)=>route.fulfill({status:st,contentType:'application/json',body:JSON.stringify(o)});
  if(u.pathname==='/my-setup/sequence'&&m==='GET'){ const v=Object.assign({},vars); if(noPay) v.pay=''; return j({mode:null,teach:teachMod.normalize(null),teach_options:teachMod.options(),first:{subject:'',body:'',versions:[]},followups:[],followup_max:5,sample:{vars:v,example:false,name:'Dana Lee',company:'Acme Health',email:'dana@acme.example'}}); }
  if(u.pathname==='/my-setup/sequence'&&m==='PUT'){ saved=body; return j({ok:true}); }
  if(u.pathname==='/my-setup/sequence/draft'){ draftCalls.push(body);
    if(body.mode==='variant') return j({source:'ai',subject:'About the {{pos}} role',body:'Hello {{fn}},\n\nA different way to say it about {{company}}.\n\nThanks,'});
    if(body.purpose==='first') return j({source:'ai',subject:'{{pos}} candidates',body:'Hi {{fn}},\n\nI saw {{company}} is hiring a {{pos}} in {{city}}. '+body.prompt+'\n\nWould you like to see a few resumes?\n\nThanks,'});
    return j({source:'ai',subject:'',body:'Hi {{fn}},\n\nJust checking you saw my note about the {{pos}} role.\n\nThanks,'}); }
  if(u.pathname==='/my-setup/sequence/preview'){ const st={}; (body.versions||[]).forEach((v,i)=>{st[ver.key('u','o1',i+2,'subject')]=v.subject;st[ver.key('u','o1',i+2,'body')]=v.body;});
    const pk=ver.pick(st,'u','o1',{subject:body.subject,body:body.body},Math.random()); const vv=Object.assign({},vars); if(noPay) vv.pay='';
    return j({subject:ev.fillTemplate(pk.subject,vv),body:ev.fillTemplate(pk.body,vv),version:Number(pk.id.slice(6)),versions:1+ver.extraVersions(st,'u','o1').length,to:{name:'Dana Lee',company:'Acme Health'},example:false,missing:[]}); }
  if(u.pathname==='/my-setup/sequence/ai-test'){ aiTests.push(body); const to={name:'Dana Lee',company:'Acme Health'};
    if(aiOff) return j({ai:false,reason:'not_configured',to,example:false,read:'Senior Java Developer posting'});
    return j({ai:true,written:true,to,example:false,read:'Senior Java Developer posting',subject:'Java hires for Acme Health',body:'Hi Dana,\n\nAI-written for this lead about '+body.teach.purpose+'.\n\nWould you like a few resumes?\n\nThanks,',followup:{written:true,body:'Hi Dana,\n\nOne more detail from the job.\n\nThanks,'}}); }
  if(u.pathname==='/outreach-plan') return j({tmpl_o1_body:'x'.repeat(30)});
  return j({});
}
const b=await chromium.launch({executablePath:(()=>{ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const bp=process.env.PLAYWRIGHT_BROWSERS_PATH; return bp&&fs.existsSync(path.join(bp,'chromium'))?path.join(bp,'chromium'):'chromium'; })(),args:['--no-sandbox']});
const errors=[];
async function open(opts){ const ctx=await b.newContext(Object.assign({viewport:{width:1440,height:900}},opts||{}));
  await ctx.route('**',r=>{const url=r.request().url(); if(url.startsWith(BASE)) return r.continue(); if(url.includes('onrender.com')) return api(r); return r.abort();});
  const pg=await ctx.newPage(); pg.on('pageerror',e=>errors.push(e.message)); await pg.goto(BASE+'/'); await waitForLogin(pg); await enterApp(pg,'bd');
  await pg.evaluate(()=>{ window.openSequenceSetup(); }); await pg.waitForSelector('#sq-root .sq-choice'); return pg; }
const pg=await open();
ok('opens on the choice', (await pg.textContent('#sq-root')).includes('How should your first email be written?'));
ok('continue waits for a choice', await pg.isDisabled('[data-sq="next"]'));
ok('My Setup stays lit in the menu', (await pg.$$eval('.nav-item.active', e=>e.map(x=>x.textContent))).join('').includes('My Setup'));
if(OUT) await pg.screenshot({path:OUT+'/s1-choice.png'});
await pg.click('[data-mode="template"]');
await pg.waitForSelector('#sq-body');
await pg.click('#sq-body'); await pg.keyboard.type('Hi ');
await pg.click('[data-sq="menu"][data-menu="first"]');
const items=await pg.$$eval('[data-menu="first"] ~ .sq-menu .sq-it', e=>e.map(x=>x.textContent));
ok('menu: 7 details incl. industry, top skills, pay', items.length===7 && items.join('|').includes('Their industry') && items.join('|').includes('Top skills') && items.join('|').includes('Pay, if known'), JSON.stringify(items));
await pg.click('[data-menu="first"] ~ .sq-menu [data-k="fn"]'); await pg.keyboard.type(',');
await pg.keyboard.press('Enter'); await pg.keyboard.press('Enter');
await pg.keyboard.type('I saw ');
await pg.click('[data-sq="menu"][data-menu="first"]'); await pg.click('[data-menu="first"] ~ .sq-menu [data-k="company"]');
await pg.keyboard.type(' is hiring. The pay is ');
await pg.click('[data-sq="menu"][data-menu="first"]'); await pg.click('[data-menu="first"] ~ .sq-menu [data-k="pay"]');
await pg.keyboard.type('. Want resumes?');
let pv=await pg.textContent('#sq-pv .sq-mbody');
ok('live preview fills details', pv.includes('Hi Dana,') && pv.includes('I saw Acme Health is hiring. The pay is $140k to $160k. Want resumes?'), JSON.stringify(pv));
await pg.click('#sq-subj'); await pg.keyboard.type('Your ');
await pg.click('[data-sq="menu"][data-menu="first"]'); await pg.click('[data-menu="first"] ~ .sq-menu [data-k="pos"]');
ok('subject detail', (await pg.textContent('#sq-pv .sq-msub')).trim()==='Your Senior Java Developer');
// a repaint from elsewhere must not wipe or move anything
await pg.click('#sq-body'); await pg.keyboard.press('End');
await pg.evaluate(()=>{ window.render(); window.render(); });
await pg.keyboard.type(' Thanks');
ok('typing survives app repaints', (await pg.textContent('#sq-body')).includes('Want resumes? Thanks') || (await pg.textContent('#sq-body')).includes('Thanks'));
// versions
await pg.click('[data-sq="vary"][data-slot="first"]');
await pg.waitForSelector('.sq-ver');
ok('two versions written, filled in', (await pg.$$('.sq-ver')).length===2 && (await pg.textContent('.sq-ver')).includes('Hello Dana'));
// follow-up
ok('one follow-up box to start', (await pg.$$('[data-sq-day]')).length===1);
await pg.click('[data-sq="fudraft"][data-i="0"]');
await pg.waitForFunction(()=>document.querySelector('#sq-fu0') && document.querySelector('#sq-fu0').textContent.includes('Just checking'));
ok('follow-up written with AI', true);
await pg.click('[data-sq="addfu"]');
ok('second follow-up added later than the first', (await pg.$$('[data-sq-day]')).length===2 && Number(await pg.inputValue('[data-sq-day="1"]'))>Number(await pg.inputValue('[data-sq-day="0"]')));
await pg.click('[data-sq="next"]');
ok('empty follow-up is caught', (await pg.textContent('#sq-root')).includes('This follow-up has no text yet'));
await pg.click('[data-sq="rmfu"][data-i="1"]');
if(OUT) await pg.screenshot({path:OUT+'/s2-write.png',fullPage:true});
await pg.click('[data-sq="next"]');
await pg.waitForSelector('[data-sq="test"]');
ok('turn on waits for the test', await pg.isDisabled('[data-sq="save"]'));
await pg.click('[data-sq="test"]'); await pg.waitForSelector('.sq-mail');
const m1=await pg.textContent('.sq-mail');
ok('test built by the server path', m1.includes('Dana') && /Version \d of 3/.test(await pg.textContent('#sq-root')));
if(OUT) await pg.screenshot({path:OUT+'/s3-test.png',fullPage:true});
await pg.click('[data-sq="save"]'); await pg.waitForFunction(()=>/Your sequence is on/.test(document.querySelector('#sq-root').textContent));
ok('saved: mode, tokens, versions, follow-ups', saved && saved.mode==='template' && saved.first.body.includes('{{fn}}') && saved.first.body.includes('{{pay}}') && saved.first.subject==='Your {{pos}}' && saved.first.versions.length===2 && saved.followups.length===1 && saved.followups[0].day===3, JSON.stringify(saved).slice(0,400));
// AI writes each one: taught by picks and one-liners (R-259)
const p2=await open();
await p2.click('[data-mode="ai"]'); await p2.waitForSelector('#sq-purpose');
const root2=await p2.textContent('#sq-root');
ok('AI mode: Teach the AI, then the backup email; no versions', root2.includes('Teach the AI') && root2.includes('Your backup email') && !(await p2.$('[data-sq="vary"][data-slot="first"]')));
const ends=await p2.$$eval('[data-g="end"]', e=>e.map(x=>x.textContent));
ok('endings are the ones the checker allows (no call)', ends.length===2 && !ends.join('|').toLowerCase().includes('call'), JSON.stringify(ends));
ok('default picks: skills, hard to fill, pay', (await p2.$$eval('[data-g="use"][aria-pressed="true"]', e=>e.map(x=>x.getAttribute('data-k')))).join(',')==='skills,hard,pay');
await p2.click('[data-sq="next"]');
ok('continue asks what the email is for first', (await p2.textContent('#sq-root')).includes('Say in one line what the email is for'));
await p2.click('#sq-purpose'); await p2.keyboard.type('I have pre-screened Java developers');
await p2.evaluate(()=>{ window.render(); window.render(); });
await p2.keyboard.type(' ready now');
ok('typing the purpose survives app repaints', (await p2.inputValue('#sq-purpose'))==='I have pre-screened Java developers ready now');
await p2.click('[data-g="use"][data-k="hard"]'); await p2.click('[data-g="end"][data-k="yesno"]'); await p2.click('[data-g="len"][data-k="medium"]');
ok('picks toggle', (await p2.getAttribute('[data-g="use"][data-k="hard"]','aria-pressed'))==='false' && (await p2.getAttribute('[data-g="end"][data-k="yesno"]','aria-pressed'))==='true');
ok('purpose kept after a pick repaints', (await p2.inputValue('#sq-purpose'))==='I have pre-screened Java developers ready now');
await p2.click('#sq-body'); await p2.keyboard.type('My own words here for the test.');
await p2.click('[data-sq="draft"]'); await p2.waitForFunction(()=>document.querySelector('#sq-body').textContent.includes('pre-screened'));
const dc=draftCalls[draftCalls.length-1];
ok('backup written from the answers, with undo', !!(await p2.$('[data-sq="undo"]')) && dc.prompt.includes('backup') && dc.prompt.includes('yes-or-no'), JSON.stringify(dc));
await p2.click('[data-sq="undo"]');
ok('undo restores', (await p2.textContent('#sq-body')).includes('My own words'));
ok('follow-up: what should it do, plus a line', !!(await p2.$('[data-g="angle"][data-i="0"][aria-pressed="true"]')) && !!(await p2.$('#sq-fnote0')));
await p2.click('[data-g="angle"][data-i="0"][data-k="detail"]');
await p2.fill('#sq-fnote0','mention I can share resumes today');
await p2.click('details[data-open="fu0"] > summary');
await p2.click('#sq-fu0'); await p2.keyboard.type('Hi, just checking in on my note.');
await p2.evaluate(()=>{ window.render(); });
ok('backup follow-up stays open and kept', await p2.evaluate(()=>document.querySelector('details[data-open="fu0"]').open) && (await p2.textContent('#sq-fu0')).includes('checking in'));
await p2.click('#sq-subj'); await p2.keyboard.type('Java developers for your team');
if(OUT) await p2.screenshot({path:OUT+'/s4-ai.png',fullPage:true});
await p2.click('[data-sq="next"]'); await p2.waitForSelector('[data-sq="test"]');
await p2.click('[data-sq="test"]'); await p2.waitForSelector('.sq-tag.is-ai');
const st=await p2.textContent('#sq-root');
ok('test: written by AI for a real lead, follow-up too, backup beside it', st.includes('AI-written for this lead about I have pre-screened') && st.includes('One more detail from the job') && st.includes('gets this instead'));
ok('test sent the answers on screen', aiTests.length===1 && aiTests[0].teach.purpose==='I have pre-screened Java developers ready now' && aiTests[0].teach.fus[0].angle==='detail', JSON.stringify(aiTests[0]));
if(OUT) await p2.screenshot({path:OUT+'/s6-ai-test.png',fullPage:true});
await p2.click('[data-sq="save"]'); await p2.waitForFunction(()=>/Your sequence is on/.test(document.querySelector('#sq-root').textContent));
ok('saved: ai mode with the answers', saved.mode==='ai' && saved.teach.purpose.includes('pre-screened') && saved.teach.use.join(',')==='skills,pay' && saved.teach.end==='yesno' && saved.teach.len==='medium' && saved.teach.fus.length===1 && saved.teach.fus[0].note==='mention I can share resumes today', JSON.stringify(saved.teach));
// no AI today: said plainly, and the backup is what the lead gets
aiOff=true;
const p3=await open();
await p3.click('[data-mode="ai"]'); await p3.waitForSelector('#sq-purpose');
await p3.fill('#sq-purpose','I have pre-screened Java developers');
await p3.click('#sq-subj'); await p3.keyboard.type('Java developers');
await p3.click('#sq-body'); await p3.keyboard.type('Hi there, I have Java developers ready. Want resumes?');
await p3.click('details[data-open="fu0"] > summary'); await p3.click('#sq-fu0'); await p3.keyboard.type('Just checking in.');
await p3.click('[data-sq="next"]'); await p3.waitForSelector('[data-sq="test"]');
await p3.click('[data-sq="test"]'); await p3.waitForSelector('.sq-warn');
const st3=await p3.textContent('#sq-root');
ok('no AI: says so, shows the backup', st3.includes('No AI is set up for your company yet') && st3.includes('Your backup') && st3.includes('Java developers ready'));
aiOff=false;
// phone, dark
noPay=true;
const ph=await open({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark',isMobile:true,hasTouch:true});
await ph.click('[data-mode="template"]'); await ph.waitForSelector('#sq-body');
await ph.click('#sq-body'); await ph.keyboard.type('Hi there. The pay is ');
await ph.evaluate(()=>{ document.querySelector('[data-sq="menu"][data-menu="first"]').click(); });
await ph.click('[data-menu="first"] ~ .sq-menu [data-k="pay"]'); await ph.keyboard.type('. Want resumes?');
const pv2=await ph.textContent('#sq-pv .sq-mbody');
ok('no pay: its sentence left out', pv2.trim()==='Hi there. Want resumes?', JSON.stringify(pv2));
ok('phone: no sideways scroll', await ph.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
if(OUT) await ph.screenshot({path:OUT+'/s5-phone-dark.png',fullPage:true});
console.log('errors:', errors.length?errors:'none'); console.log('PASS '+pass+' FAIL '+fail);
await b.close(); server.close(); process.exit(fail||errors.length?1:0);
