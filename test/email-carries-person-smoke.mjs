// "EMAIL" ON A PERSON OPENS THE COMPOSER ALREADY ADDRESSED TO THEM (R-084, R-083).
//
// Owner, 29 Sep: "The Compose email opens up … But there is no way [to carry] the
// information of the email ID as clicked. Details of information is missing and I
// think it's prevalent overall in the system, like in some place it's there, but
// mostly it's missing."  And: "When a [POC] is added, there is no option of sending
// an outreach email to the POC."
//
// What was wrong: the lead drawer's Email button set a field the composer (the
// Generator, Email → Compose) never reads, so it landed on an empty "Send to". And
// a person added to a lead had NO email action at all.
//
// Pinned in a real browser:
//   * every contact row with an address has a "Write" button — the same row the POC
//     finder's slots use, so a person just added can be written to at once;
//   * a contact with no address has none (a button that cannot work is worse than none);
//   * clicking it opens Email → Compose with the address, name, title, company and
//     the role already filled, and the recipient card naming them;
//   * a second click on somebody else starts a fresh draft — the first person's
//     address and subject never follow the click;
//   * a contact with no address does not move the page (it says so).
//
// Every probe that cannot take its measurement FAILS — a missing node is never a pass.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if (p==='/') p='/index.html';
  fs.readFile(path.join(PUBLIC_DIR,p),(err,data)=>{
    if(err){res.writeHead(404);return res.end('nf');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});res.end(data);
  });
});
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const API = 'https://fute-lms-backend.onrender.com';

const results=[];
const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){
  if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b=process.env.PLAYWRIGHT_BROWSERS_PATH;
  if(b && fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium');
  return 'chromium';
}
function reply(route, body, status=200){ return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) }); }
async function api(route){ const m=route.request().method(); return reply(route, m==='GET' ? [] : {}); }

let browser;
const pageErrors=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  await ctx.route('**',r=>{
    const u=r.request().url();
    if(u.startsWith(BASE)) return r.continue();
    if(u.startsWith(API)) return api(r);
    return r.abort();
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await waitForLogin(page); await enterApp(page,'bd_lead');
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await ev(()=>{
    STATE.jobs=[{ id:'j1', position:'Estimator', company_name:'Acme Builders', location:'Austin, TX' },
                { id:'j2', position:'Site Superintendent', company_name:'Northwind', location:'Denver, CO' }];
    STATE.contacts=[
      { id:'c1', job_id:'j1', first_name:'Sam', last_name:'Lee', email:'sam@acme.test', designation:'HR Manager' },
      { id:'c2', job_id:'j2', first_name:'Dana', last_name:'Cruz', email:'dana@northwind.test', designation:'Hiring Manager' },
      { id:'c3', job_id:'j1', first_name:'No', last_name:'Address', email:'', designation:'Controller' }];
  });

  // ═══ the row every contact is drawn with (lead row AND the POC finder's slots) ═══
  const rows = await ev(()=>({
    withMail: leadContactRowHtml(STATE.contacts[0]),
    noMail:   leadContactRowHtml(STATE.contacts[2]) }));
  step('A contact with an address has a Write button on its row (so a person just added can be written to at once)',
    /lx-mailbtn/.test(rows.withMail) && /sendEmailToContact\('c1'\)/.test(rows.withMail));
  step('A contact with no address has no Write button (a button that cannot work is worse than none)', !/lx-mailbtn/.test(rows.noMail) && /No email/.test(rows.noMail));

  // ═══ click Write on Sam ═══════════════════════════════════════════════════
  await ev(()=>sendEmailToContact('c1'));
  await page.waitForTimeout(500);
  const a = await ev(()=>({ page:STATE.page, tab:STATE.emailTab, to:(document.getElementById('og-to')||{}).value,
    card:(document.querySelector('#content .card')||{}).innerText||'', text:document.getElementById('content').innerText,
    form:STATE.outreachGen&&STATE.outreachGen.form }));
  step('Email → Compose opens', a.page==='email' && a.tab==='compose', a.page+' / '+a.tab);
  step('The address is already in "Send to"', a.to==='sam@acme.test', String(a.to));
  step('The recipient is named on screen with their title, address and company', /Sam/.test(a.text) && /HR Manager/.test(a.text) && /sam@acme\.test/.test(a.text) && /Acme Builders/.test(a.text));
  step('It is marked as a person already in PACE', /in PACE/.test(a.text));
  step('The role and company reach the form too', !!a.form && a.form.company==='Acme Builders' && a.form.job_title==='Estimator' && a.form.pickedContactId==='c1' && a.form.pickedJobId==='j1', JSON.stringify(a.form&&{c:a.form.company,j:a.form.job_title}));

  // ═══ a second person starts a fresh draft ═════════════════════════════════
  await ev(()=>{ STATE.outreachGen.form.notes='notes about Sam'; STATE.outreachGen.draft={ subject:'Hi Sam', email:'body about Sam', variants:[] }; });
  await ev(()=>sendEmailToContact('c2'));
  await page.waitForTimeout(400);
  const b = await ev(()=>({ to:(document.getElementById('og-to')||{}).value, form:STATE.outreachGen.form, draft:STATE.outreachGen.draft }));
  step('A second click addresses the second person', b.to==='dana@northwind.test' && b.form.contact_first_name==='Dana' && b.form.company==='Northwind', String(b.to));
  step('…and the first person\'s draft and notes do not follow the click', !b.draft && !b.form.notes);

  // ═══ no address: says so, and does not move ═══════════════════════════════
  await ev(()=>{ STATE.page='dashboard'; render(); });
  await ev(()=>sendEmailToContact('c3'));
  await page.waitForTimeout(200);
  const c = await ev(()=>({ page:STATE.page, toast:(STATE.toasts||[]).map(t=>t.msg).join('|') }));
  step('A contact with no address does not open the composer, and says why', c.page==='dashboard' && /no email address/i.test(c.toast), JSON.stringify(c));

  step('No page errors', pageErrors.length===0, pageErrors.slice(0,2).join(' | '));
}catch(e){
  console.log('[FAIL] run crashed — '+(e&&e.stack||e)); results.push(false);
}finally{
  if(browser) await browser.close();
  server.close();
}
const pass = results.filter(Boolean).length;
console.log('\n'+pass+'/'+results.length+' passed');
process.exit(pass===results.length && results.length>0 ? 0 : 1);
