// A SIGN-IN THAT RAN OUT (R-118, owner 6 Oct): "refresh the page when it times out … when the user visits the page
// again, open it where the user left off."
//   * the server's "Invalid token" (expired/missing/out-of-date session) is turned into ONE plain sentence on the login
//     screen, never a red error inside whatever page was open — and many calls failing together answer once
//   * a wrong password, or a wrong CURRENT password, is NOT an expired session (it must reach the screen that asked)
//   * coming back to a tab whose token is past its time says so at once; after a real absence the data is refreshed;
//     a quick tab switch does neither
//   * signing in again puts the person back on their page, job and candidate — once, for the same person only,
//     within 12 hours; an explicit sign-out forgets the place
// Usage: node test/session-expiry-resume-smoke.mjs   (CP_SHOT_DIR=… keeps screenshots)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`; const SHOTS=process.env.CP_SHOT_DIR||'';
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
const USER = { id:'test-bd', name:'Test BD', email:'bd@example.test', role:'bd', roles:['bd'], employee_id:'E1', designation:'BD Manager' };
let mode = 'expired';     // what the stubbed server says to an authenticated call
const seen = [];
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1280,height:860}});
  await ctx.route('**',route=>{
    const u=route.request().url(), m=route.request().method();
    if(u.startsWith(BASE)) return route.continue();
    if(u.includes('fute-lms-backend.onrender.com')){
      const p=new URL(u).pathname; seen.push(m+' '+p);
      const json=(code,body)=>route.fulfill({status:code,contentType:'application/json',body:JSON.stringify(body)});
      if(p==='/auth/login') return json(200,{token:'x.y.z',user:USER});
      if(p==='/auth/change-password') return json(401,{error:'Current password incorrect'});
      if(mode==='expired') return json(401,{error:'Invalid token'});
      if(mode==='outofdate') return json(401,{error:'Your session is out of date. Please sign in again.'});
      if(/app-settings|outreach-plan|today-summary|pool-stats/.test(p)) return json(200,{});
      return json(200,[]);
    }
    return route.abort();
  });
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page);
  const ev=(f,a)=>page.evaluate(f,a);
  const onLogin=()=>ev(()=>STATE.page==='login'&&!!document.querySelector('.login-card'));
  const notice=()=>ev(()=>{const n=document.querySelector('.login-card [role=status]');return n?n.textContent:'';});
  // ---------- a wrong password is not an expired session
  await ev(()=>{ document.getElementById('login-email').value='a@b.test'; document.getElementById('login-pass').value='nope'; });
  mode='ok'; seen.length=0;
  const wrong = await ev(()=>apiPost('/auth/login',{email:'a@b.test',password:'x'}).then(()=>'ok',e=>e.message+'|'+!!e.expired));
  step('the login call is never mistaken for an expired session', wrong==='ok' || !/expired/i.test(wrong), wrong);

  // ---------- set up: signed in, deep in a job's candidate
  await enterApp(page,'bd');
  await ev(()=>{ STATE.page='bd_jodetail'; STATE.nav={stack:[{k:'root',page:'bd_joborders'},{k:'jodetail',jid:'jo1'},{k:'candidate',cid:'c9'}]}; });
  const wrongCur = await ev(()=>apiPost('/auth/change-password',{}).then(()=>'ok',e=>e.message+'|'+!!e.expired));
  step('"Current password incorrect" (a 401 about something else) reaches the screen that asked', wrongCur==='Current password incorrect|false' && await ev(()=>!!STATE.token), wrongCur);

  // ---------- the session runs out: several calls fail together
  mode='expired';
  const outs = await ev(()=>Promise.all([apiGet('/jobs'),apiGet('/users'),apiGet('/reminders'),apiGet('/companies')].map(p=>p.then(()=>'ok',e=>e.message+'|'+e.expired))));
  step('every failed call carries the plain sentence, not "Invalid token"', outs.every(o=>o==='Your session expired — please sign in again.|true'), JSON.stringify(outs));
  step('the login screen is up', await onLogin());
  step('…with one calm sentence saying why', /Your session expired\. Sign in again and PACE will take you back to where you were\./.test(await notice()), await notice());
  step('…the token and the person are gone from the tab', await ev(()=>!STATE.token&&!STATE.user&&!sessionStorage.getItem('fg_token')));
  const saved = await ev(()=>JSON.parse(sessionStorage.getItem('fg_resume')||'null'));
  step('where they were is kept: the page and the job and candidate trail', saved && saved.uid==='test-bd' && saved.page==='bd_jodetail' && saved.stack.length===3 && saved.stack[2].cid==='c9', JSON.stringify(saved));
  if(SHOTS) await page.screenshot({path:path.join(SHOTS,'session-expired-login.png')});

  // ---------- sign in again: back where they were
  await ev(()=>{ window.__opened=[]; window.bdOpenJobOrder=function(id){ __opened.push('job:'+id+'@'+STATE.page); }; window.bdOpenCandidate=function(id){ __opened.push('cand:'+id); }; });
  mode='ok';
  await ev(()=>{ document.getElementById('login-email').value='bd@example.test'; document.getElementById('login-pass').value='pw'; doLogin(); });
  await page.waitForFunction(()=>window.__opened&&window.__opened.length>=2,null,{timeout:6000}).catch(()=>{});
  const opened=await ev(()=>({o:window.__opened,page:STATE.page,toast:(document.getElementById('toast')||document.body).innerText.includes('Welcome back')}));
  step('signing in again opens the list, then the job, then the candidate — in that order', JSON.stringify(opened.o)==='["job:jo1@bd_joborders","cand:c9"]', JSON.stringify(opened));
  step('the saved place is used ONCE', await ev(()=>sessionStorage.getItem('fg_resume')===null));
  step('the person is told, briefly', opened.toast || await ev(()=>/Welcome back/.test(document.body.innerText)));
  step('the sign-in notice is gone once they are in', await ev(()=>STATE.loginNotice==null||!document.querySelector('.login-card')));

  // ---------- only the same person, only recently
  async function trySignIn(savedObj, label){
    await ev(()=>{ STATE.token=null; STATE.user=null; STATE.page='login'; render(); });
    await ev((o)=>{ sessionStorage.setItem('fg_resume',JSON.stringify(o)); window.__opened=[]; }, savedObj);
    await page.waitForSelector('#login-email');
    await ev(()=>{ document.getElementById('login-email').value='bd@example.test'; document.getElementById('login-pass').value='pw'; doLogin(); });
    await page.waitForFunction(()=>STATE.page!=='login'&&!STATE.loading,null,{timeout:6000}).catch(()=>{});
    await page.waitForTimeout(900);
    return ev(()=>({opened:window.__opened,page:STATE.page,left:sessionStorage.getItem('fg_resume')}));
  }
  const other=await trySignIn({uid:'someone-else',page:'bd_jodetail',stack:[{k:'root',page:'bd_joborders'},{k:'jodetail',jid:'jo1'}],at:Date.now()});
  step('a DIFFERENT person signing in at the same desk is not taken to the last person\'s place', other.opened.length===0 && other.page==='dashboard' && other.left===null, JSON.stringify(other));
  const old=await trySignIn({uid:'test-bd',page:'bd_jodetail',stack:[{k:'root',page:'bd_joborders'},{k:'jodetail',jid:'jo1'}],at:Date.now()-13*3600*1000});
  step('a place older than 12 hours is forgotten', old.opened.length===0 && old.page==='dashboard', JSON.stringify(old));
  const pageOnly=await trySignIn({uid:'test-bd',page:'applicants',stack:[],at:Date.now()-1000});
  step('a plain page (no job open) comes back too', pageOnly.page==='applicants', JSON.stringify(pageOnly));

  // ---------- an explicit sign-out forgets the place
  await ev(()=>{ sessionStorage.setItem('fg_resume','{"uid":"test-bd","page":"applicants","stack":[],"at":'+Date.now()+'}'); doLogout(); });
  step('signing out on purpose throws the saved place away', await ev(()=>sessionStorage.getItem('fg_resume')===null && !STATE.loginNotice));

  // ---------- the other server sentence
  await enterApp(page,'bd'); mode='outofdate';
  await ev(()=>apiGet('/jobs').catch(()=>0)); await page.waitForTimeout(100);
  step('"Your session is out of date" is handled the same way', await onLogin() && /expired/.test(await notice()));

  // ---------- coming back to a tab
  await enterApp(page,'bd'); mode='ok'; seen.length=0;
  await ev(()=>{ const b64=s=>btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); STATE.token=b64('{"alg":"HS256"}')+'.'+b64(JSON.stringify({id:'test-bd',exp:Math.floor(Date.now()/1000)-60}))+'.sig'; Object.defineProperty(document,'hidden',{configurable:true,get:()=>false}); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(150);
  step('coming back to a tab whose sign-in has run out says so at once (no failed click needed)', await onLogin() && /expired/.test(await notice()));
  step('…and that took no request at all', seen.filter(s=>/\/jobs|\/users/.test(s)).length===0, seen.join(','));
  await enterApp(page,'bd'); await ev(()=>{ window.__polls=0; window.apiGet=function(u){ if(u==='/jobs') window.__polls++; return Promise.resolve([]); }; });
  await ev(()=>{ window._hiddenAt=Date.now()-60*1000; document.dispatchEvent(new Event('visibilitychange')); });
  const quick=await ev(()=>window.__polls);
  await ev(()=>{ window._hiddenAt=Date.now()-6*60*1000; document.dispatchEvent(new Event('visibilitychange')); });
  const away=await ev(()=>window.__polls);
  step('a quick tab switch refreshes nothing; a 6-minute absence refreshes the data once', quick===0 && away===1, 'quick='+quick+' away='+away);
  step('No page errors', errs.length===0, errs.join('|').slice(0,300));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
