// WORDING PER EMAIL ID ON THE OUTREACH PLAN (R-176, D-0111) — the owner (8 Oct): "the outreach template that goes out is not particular
// for from email ID, just the signature is … an option to select one email for all from email ID outreach or individual."
//   * a "Wording for your email IDs" card: one wording for all (the default, nothing changes) or a different wording for each
//   * choosing "each" is saved, and the card then says which email IDs have their own wording and which send the main one
//   * with "each" the editor follows the Sending email: an email ID with none shows the person's wording as its starting point;
//     Save writes to THAT email ID (never the person's), and the person's own wording is left alone
//   * "Use my main wording again" takes an email ID's wording away; with "all" the email ID's stored text is not even shown
// Usage: node test/wording-scope-ui-smoke.mjs
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
    window.__posts=[]; window.apiPost=function(p,b){ window.__posts.push([p,b]); return Promise.resolve({success:true}); }; window.confirm=function(){ return true; };
    const u=STATE.user.id;
    STATE.userEmailsCache=STATE.userEmailsCache||{};
    STATE.userEmailsCache[u]=[{id:'m1',email_address:'amy@co-a.test',display_name:'Amy A',is_active:true,is_primary:true},{id:'m2',email_address:'amy@co-b.test',display_name:'Amy B',is_active:true}];
    STATE.emailSignaturesCache={m1:'<b>{{sender}}</b>',m2:'<b>{{sender}}</b>'};
    STATE.myOutreachPlan={tmpl_o1_subject:'MAIN subject',tmpl_o1_body:'MAIN body written by the person for every email ID.',tmpl_fu1_subject:'MAIN fu1',tmpl_fu1_body:'MAIN fu1 body text here'};
    STATE.mailboxWording={m1:{},m2:{tmpl_o1_subject:'STORED B subject',tmpl_o1_body:'STORED B body that is dormant until each is chosen'}};
    STATE.planFromEmailId='m2'; STATE.sigEmailId='m2'; STATE.activeTmpl='outreach'; STATE.emailTab='outreachplan'; STATE.page='email'; render();
  });
  await page.waitForSelector('#tmpl-o1-subj',{timeout:8000});
  const val=(id)=>ev((i)=>document.getElementById(i).value,id);
  const card=()=>ev(()=>{ const c=[...document.querySelectorAll('.card')].find(x=>/Wording for your email IDs/.test(x.innerText)); return c?c.innerText.replace(/\s+/g,' '):''; });
  let c=await card();
  step('the card is there, offering one wording for all (chosen) or one for each', /One wording for all my email IDs/.test(c) && /A different wording for each email ID/.test(c) && await ev(()=>document.querySelector('input[name=wscope]:checked').parentElement.innerText.indexOf('One wording for all')>=0), c.slice(0,200));
  step('with "all" no per-email-ID list is shown, and the editor shows the person\'s wording — an email ID\'s stored text is dormant', !/What each of your email IDs sends/.test(c) && (await val('tmpl-o1-subj'))==='MAIN subject');
  await ev(()=>{ window.__posts=[]; setWordingScope('each'); }); await page.waitForTimeout(200);
  step('choosing "each" is saved as tmpl_scope = each', await ev(()=>window.__posts.some(p=>p[0]==='/outreach-plan'&&p[1].key==='tmpl_scope'&&p[1].value==='each')));
  c=await card();
  step('…and the card then says what each email ID sends: the one with text of its own, and the one that sends the main wording', /amy@co-b\.test.*its own wording/.test(c) && /amy@co-a\.test.*your main wording/.test(c) && /Use my main wording again/.test(c) && /Start its own from my main wording/.test(c), c);
  step('the editor now follows the Sending email (email ID 2): its own wording is shown', (await val('tmpl-o1-subj'))==='STORED B subject' && (await val('tmpl-o1-body'))==='STORED B body that is dormant until each is chosen');
  await ev(()=>selectPlanFromEmail('m1')); await page.waitForTimeout(200);
  step('switching to email ID 1 (none of its own) shows the main wording as its starting point', (await val('tmpl-o1-subj'))==='MAIN subject');
  await ev(()=>{ window.__posts=[]; document.getElementById('tmpl-o1-subj').value='ALPHA subject'; document.getElementById('tmpl-o1-body').value='ALPHA body for the first company only.'; saveOutreachTemplate('outreach','tmpl-o1-subj','tmpl-o1-body'); }); await page.waitForTimeout(250);
  const posts=await ev(()=>window.__posts);
  step('Save writes to THAT email ID (never the person\'s wording)', posts.length===2 && posts.every(p=>p[0]==='/outreach-plan/mailbox'&&p[1].mailbox_id==='m1') && posts.some(p=>p[1].key==='tmpl_o1_subject'&&p[1].value==='ALPHA subject') && posts.some(p=>p[1].key==='tmpl_o1_body'&&/ALPHA body/.test(p[1].value)), JSON.stringify(posts));
  step('…the person\'s own wording is untouched', await ev(()=>STATE.myOutreachPlan.tmpl_o1_subject==='MAIN subject' && STATE.myOutreachPlan.tmpl_o1_body.indexOf('MAIN body')===0));
  c=await card();
  step('…and the card now lists email ID 1 as having its own wording too', /amy@co-a\.test.*its own wording/.test(c));
  await ev(()=>selectPlanFromEmail('m2')); await page.waitForTimeout(150);
  step('each email ID keeps its own text (email ID 2 still has the other one)', (await val('tmpl-o1-subj'))==='STORED B subject');
  await ev(()=>{ window.__posts=[]; wordingUseMine('m2'); }); await page.waitForTimeout(250);
  const clears=await ev(()=>window.__posts);
  step('"Use my main wording again" takes that email ID\'s two texts away (saved empty)', clears.length===2 && clears.every(p=>p[0]==='/outreach-plan/mailbox'&&p[1].mailbox_id==='m2'&&p[1].value===''), JSON.stringify(clears));
  step('…and the editor shows the main wording for it again', (await val('tmpl-o1-subj'))==='MAIN subject');
  await ev(()=>{ window.__posts=[]; wordingStartFromMine('m2'); }); await page.waitForTimeout(250);
  const copies=await ev(()=>window.__posts);
  step('"Start its own from my main wording" copies the person\'s wording onto that email ID to edit', copies.length>=4 && copies.every(p=>p[0]==='/outreach-plan/mailbox'&&p[1].mailbox_id==='m2'&&p[1].value) && copies.some(p=>p[1].key==='tmpl_o1_body'&&/MAIN body/.test(p[1].value)));
  await ev(()=>{ window.__posts=[]; setWordingScope('all'); }); await page.waitForTimeout(200);
  step('back to "all": the editor shows the person\'s wording whatever an email ID has stored', (await val('tmpl-o1-subj'))==='MAIN subject' && !/What each of your email IDs sends/.test(await card()));
  await ev(()=>{ window.__posts=[]; document.getElementById('tmpl-o1-subj').value='MAIN v2'; document.getElementById('tmpl-o1-body').value='MAIN body v2 for every email ID.'; saveOutreachTemplate('outreach','tmpl-o1-subj','tmpl-o1-body'); }); await page.waitForTimeout(200);
  step('…and Save goes to the person\'s own keys, exactly as before', await ev(()=>window.__posts.length===2 && window.__posts.every(p=>p[0]==='/outreach-plan'&&/^tmpl_o1_/.test(p[1].key))));
  step('no page errors', errs.length===0, errs.join('|').slice(0,300));
} catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
