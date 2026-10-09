// D-0117 — the Outreach Plan shows the personal AI switch and the two rewrite buttons.
// The switch is one choice for the person, and per email ID only when wording is per email ID.
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
    window.__posts=[]; window.apiPost=function(p,b){ window.__posts.push([p,b]);
      if(p==='/wf/draft-email' && b.mode==='rewrite') return Promise.resolve({ source:'ai', subject:b.subject, body:b.body+' rewritten', note:'Rewritten from your email — every {{variable}} is still there. Read it before you save.' });
      if(p==='/wf/draft-email' && b.mode==='variant') return Promise.resolve({ source:'kept', subject:b.subject, body:b.body, note:'The rewrite could not keep your {{variables}} and your topic, so your text is unchanged.' });
      return Promise.resolve({ success:true });
    };
    const u=STATE.user.id;
    STATE.userEmailsCache=STATE.userEmailsCache||{};
    STATE.userEmailsCache[u]=[{id:'m1',email_address:'amy@co-a.test',display_name:'Amy A',is_active:true,is_primary:true,sends_as:{company:'Alpha',title:'Manager',address:'1 Main'}},{id:'m2',email_address:'amy@co-b.test',display_name:'Amy B',is_active:true}];
    STATE.emailSignaturesCache={m1:'',m2:''};
    STATE.myOutreachPlan={fu_count:'0',tmpl_o1_subject:'Hello {{fn}}',tmpl_o1_body:'Hi {{fn}}, about the {{pos}} at {{company}}.'};
    STATE.mailboxWording={m1:{},m2:{}};
    STATE.planFromEmailId='m1'; STATE.activeTmpl='outreach'; STATE.emailTab='outreachplan'; STATE.page='email'; render();
  });
  await page.waitForSelector('#ai-first-card',{timeout:8000});
  const card=()=>ev(()=>document.getElementById('ai-first-card').innerText.replace(/\s+/g,' '));
  step('the switch offers same as the company, on for me, and off', /Same as the company/.test(await card()) && /On for you/.test(await card()) && /Off for you/.test(await card()) && /Follow-ups always stay the wording you wrote/.test(await card()));
  step('nothing saved: same as the company is the one selected', await ev(()=>document.querySelector('#ai-first-card input[name=aifirst]:checked').parentElement.innerText.indexOf('Same as the company')>=0));
  await ev(()=>{ window.__posts=[]; setAiFirst('off'); }); await page.waitForTimeout(150);
  step('Off for me is saved on the person', await ev(()=>window.__posts.some(p=>p[0]==='/outreach-plan'&&p[1].key==='ai_first'&&p[1].value==='off')));
  await ev(()=>{ window.__posts=[]; setWordingScope('each'); }); await page.waitForTimeout(150);
  step('with a wording per email ID the switch is for this email ID', /this email ID/.test(await card()) && /On for this email ID/.test(await card()));
  await ev(()=>{ window.__posts=[]; setAiFirst('on'); }); await page.waitForTimeout(150);
  step('…and that choice is saved on the email ID, not on the person', await ev(()=>window.__posts.some(p=>p[0]==='/outreach-plan/mailbox'&&p[1].mailbox_id==='m1'&&p[1].key==='ai_first'&&p[1].value==='on') && !window.__posts.some(p=>p[0]==='/outreach-plan'&&p[1].key==='ai_first')));
  step('Rewrite with AI and Write a variant are on the wording', await ev(()=>/Rewrite with AI/.test(document.body.innerText) && /Write a variant/.test(document.body.innerText)));
  await ev(()=>{ window.__posts=[]; document.getElementById('tmpl-o1-body').value='Hi {{fn}}, about the {{pos}}.'; planDraftAi('rewrite'); });
  await page.waitForTimeout(200);
  step('Rewrite sends the email as it is and keeps the field', await ev(()=>{ const p=window.__posts.filter(x=>x[0]==='/wf/draft-email').pop(); return p && p[1].mode==='rewrite' && /\{\{fn\}\}/.test(p[1].body) && /\{\{pos\}\}/.test(document.getElementById('tmpl-o1-body').value); }));
  await ev(()=>{ window.__posts=[]; const before=document.getElementById('tmpl-o1-body').value; planDraftAi('variant'); window.__before=before; });
  await page.waitForTimeout(200);
  step('a variant that cannot keep the fields leaves the person\'s text in the box', await ev(()=>document.getElementById('tmpl-o1-body').value===window.__before && /unchanged/.test(document.getElementById('plan-ai-note').textContent)));
  step('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
}catch(e){
  console.log('[FAIL] run crashed — '+(e&&e.stack||e)); results.push(false);
}finally{
  if(browser) await browser.close();
  server.close();
}
const pass=results.filter(Boolean).length;
console.log('\nSUMMARY: '+pass+'/'+results.length+' passed');
process.exit(pass===results.length && results.length>0 ? 0 : 1);
