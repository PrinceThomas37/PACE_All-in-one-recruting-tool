// ONE MAILBOX, ONE PLACE TO ACT — the screen, in a real browser (owner, 3 Nov 2026: "give me a search option … do not show the full list").
//   * nothing is listed until you search or press a count; typing keeps the caret and asks the server once, not per key
//   * choosing a mailbox opens ITS card: state, health, the numbers ("—" where there is nothing under a rate), warm-up
//   * the buttons are exactly the ones the server says are allowed — a blocked mailbox has Unblock and NO Start
//   * Pause/Start/Unblock act at once; Block / Deactivate / Delete ask first; Delete of a mailbox with mail on record explains and offers Deactivate;
//     Delete of a clean one needs the address typed back, and that is what is sent
//   * a phone-width screen does not scroll sideways
// Usage: node test/mailbox-control-ui-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return undefined; }
let browser; const errs=[];
const SHOTS=process.env.MBC_SHOTS||'';   // optional: write screenshots of the screen for the owner to look at
const shot=async(page,name,sel)=>{ if(!SHOTS) return; fs.mkdirSync(SHOTS,{recursive:true}); const el=sel?await page.$(sel):null; await (el||page).screenshot({path:path.join(SHOTS,name)}); };
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:1360,height:900}}); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'admin');
  const ev=(f,a)=>page.evaluate(f,a);
  await ev(()=>{
    // a tiny stand-in for the server: three mailboxes, the rules of services/mailbox-control.js (the real ones are pinned by mailbox-control-routes-smoke)
    const OFFER={active:['pause','block','deactivate','delete'],paused:['start','block','deactivate','delete'],auto_paused:['start','block','deactivate','delete'],blocked:['unblock','deactivate','delete'],deactivated:['start','delete']};
    const LAB={pause:'Pause',start:'Start',block:'Block',unblock:'Unblock',deactivate:'Deactivate',delete:'Delete'};
    const LBL={active:'Active',paused:'Paused',auto_paused:'Auto-paused',blocked:'Blocked',deactivated:'Deactivated'};
    const mbs=[
      {id:'m1',email:'neil.patrick@acme.com',owner:'Neil Patrick',state:'active',sign_in:'ok',email_count:9},
      {id:'m2',email:'sam.wilson@acme.com',owner:'Sam Wilson',state:'auto_paused',sign_in:'ok',email_count:3},
      {id:'m3',email:'fresh.one@acme.com',owner:'Sam Wilson',state:'active',sign_in:'expired',email_count:0},
    ];
    window.__mbs=mbs; window.__calls=[];
    const act=(m)=>OFFER[m.state].map(a=>({action:a,label:LAB[a],danger:['delete','block','deactivate'].includes(a)}));
    window.apiGet=(p)=>{ window.__calls.push(['GET',p]);
      if(/^\/admin\/deliverability/.test(p)) return Promise.resolve({window_days:30,view:'org',can_org:true,sent:1934,failed:1,bounced_contacts:51,replied_contacts:23,suppression_count:10,mailboxes:[{id:'m1',email:'LISTED-ON-OLD-PAGE@x.com',name:'x',connection:{status:'ok'}}]});
      if(/^\/warmup\/mailboxes/.test(p)) return Promise.resolve({mailboxes:[],pool_count:0,readiness:null});
      if(/^\/admin\/domain-health/.test(p)) return Promise.resolve({domains:[],checked:0});
      if(p==='/admin/mailboxes/summary'){ const c={total:3,active:0,paused:0,auto_paused:0,blocked:0,deactivated:0,expired:0}; mbs.forEach(m=>{c[m.state]++; if(m.sign_in==='expired')c.expired++;}); return Promise.resolve(c); }
      let m=p.match(/^\/admin\/mailboxes\/search\?q=([^&]*)(?:&state=(\w+))?/);
      if(m){ const q=decodeURIComponent(m[1]).toLowerCase(), st=m[2]||''; let r=mbs.filter(x=>(!q||x.email.includes(q)||x.owner.toLowerCase().includes(q))&&(!st||(st==='expired'?x.sign_in==='expired':x.state===st)));
        return Promise.resolve({results:r.map(x=>({id:x.id,email:x.email,name:'',owner:x.owner,state:x.state,state_label:LBL[x.state],sign_in:x.sign_in})),more:0}); }
      m=p.match(/^\/admin\/mailboxes\/(\w+)\/detail/);
      if(m){ const x=mbs.find(y=>y.id===m[1]); if(!x) return Promise.reject(new Error('Mailbox not found'));
        return Promise.resolve({id:x.id,email:x.email,name:'',platform:'Gmail',primary:false,owner:{id:'u',name:x.owner},state:x.state,state_label:LBL[x.state],
          state_note:x.state==='blocked'?'Blocked by Prince Thomas on 2026-11-03. Outreach from it is stopped.':null,scope_note:['paused','auto_paused','blocked'].includes(x.state)?'Pause and Block stop OUTREACH from this mailbox (sequences, bulk sends, candidate outreach) and its warm-up. The person can still write emails one by one, reply and hold conversations.':null,sign_in:x.sign_in,connection:{status:x.sign_in,connected:true},
          health:{level:x.state==='active'?'good':'bad',label:x.state==='active'?'Healthy':'Auto-paused',tips:[]},window_days:30,bounce_limit_pct:5,
          stats:x.email_count?{sent:120,failed:1,pending:4,people_emailed:100,bounced:50,replied:12,tracked:80,opened:20,bounce_rate:50,reply_rate:12,open_rate:25,fail_rate:0.8,last_failure:{reason:'mailbox full',kind:'permanent',at:'2026-11-02T10:00:00Z'}}
            :{sent:0,failed:0,pending:0,people_emailed:0,bounced:0,replied:0,tracked:0,opened:0,bounce_rate:null,reply_rate:null,open_rate:null,fail_rate:null,last_failure:null},
          limit:{daily:300,sent_today:60},week:[0,1,2,3,4,5,6].map(i=>({day:'2026-10-2'+i,sent:i*10})),warmup:{status:null},email_count:x.email_count,actions:act(x)}); }
      return Promise.resolve([]); };
    window.apiPost=(p,b)=>{ window.__calls.push(['POST',p,b]);
      const m=p.match(/^\/admin\/mailboxes\/(\w+)\/action/); if(!m) return Promise.resolve({});
      const x=mbs.find(y=>y.id===m[1]); const a=b.action;
      if(a==='pause')x.state='paused'; else if(a==='start')x.state='active'; else if(a==='block')x.state='blocked'; else if(a==='unblock')x.state='paused'; else if(a==='deactivate')x.state='deactivated';
      else if(a==='delete'){ if(String(b.confirm_address).toLowerCase()!==x.email) return Promise.reject(new Error('type the address')); mbs.splice(mbs.indexOf(x),1); return Promise.resolve({success:true,deleted:true}); }
      return Promise.resolve({success:true,state:x.state,actions:act(x)}); };
    STATE.page='deliverability'; STATE.deliv=undefined; render();
  });
  await page.waitForSelector('#mbc-q',{timeout:6000}); await page.waitForTimeout(400);
  const txt=()=>ev(()=>document.getElementById('content').innerText.replace(/\s+/g,' '));
  const calls=()=>ev(()=>window.__calls);
  const btns=()=>ev(()=>[...document.querySelectorAll('.mbc-acts button')].map(b=>b.textContent.trim()));

  console.log('\nNothing is listed until you ask');
  let t=await txt();
  step('the panel shows counts, a search box and an instruction — and no mailbox rows', !!(await page.$('#mbc-q')) && /Type an email address/.test(t) && !(await page.$('.mbc-row')) && !/neil\.patrick/.test(t) && !/LISTED-ON-OLD-PAGE/.test(t), t.slice(0,200));
  const chipTxt=await ev(()=>[...document.querySelectorAll('.mbc-chip')].map(c=>c.innerText.replace(/\s+/g,' ').trim()).join(' | '));
  step('the counts come from the server (2 active, 1 sign-in expired)', /2 Active/.test(chipTxt) && /1 Sign-in expired/.test(chipTxt), chipTxt);

  console.log('\nSearch');
  await page.click('#mbc-q'); await ev(()=>{ window.__calls.length=0; });
  await page.keyboard.type('neil',{delay:40}); await page.waitForSelector('.mbc-row',{timeout:4000});
  const searches=(await calls()).filter(c=>/mailboxes\/search/.test(c[1]));
  step('typing four letters asks the server ONCE (it waits for you to stop), not once per key', searches.length===1, String(searches.length));
  step('the match is listed with its owner and state; the caret and the text are still in the box', /neil\.patrick@acme\.com/.test(await txt()) && (await ev(()=>document.activeElement&&document.activeElement.id))==='mbc-q' && (await page.inputValue('#mbc-q'))==='neil');
  step('only the match is listed, not the other mailboxes', (await page.$$('.mbc-row')).length===1);

  await shot(page,'1-search.png','.mbc');
  console.log('\nOne mailbox opens');
  await page.click('.mbc-row'); await page.waitForSelector('.mbc-detail .mbc-title',{timeout:4000}); await page.waitForTimeout(200);
  t=await txt();
  step('its card names the mailbox, its owner, its state and its health', /neil\.patrick@acme\.com/.test(t) && /Neil Patrick/.test(t) && /Active/.test(t) && /Healthy/.test(t));
  step('the numbers are there: bounce 50%, open 25%, reply 12%', /50%\s*Bounce rate/i.test(t) && /25%\s*Open rate/i.test(t) && /12%\s*Reply rate/i.test(t), t.slice(t.indexOf('Last 30'),t.indexOf('Last 30')+260));
  step('…and the last failure and today\'s sending are shown', /mailbox full/.test(t) && /60 of 300/.test(t));
  step('the buttons are exactly the allowed ones: Pause, Block, Deactivate, Delete', (await btns()).join()==='Pause,Block,Deactivate,Delete', (await btns()).join());

  await shot(page,'2-card-active.png','.mbc');
  console.log('\nActions');
  await ev(()=>{ window.__calls.length=0; }); await page.click('.mbc-acts button:has-text("Pause")'); await page.waitForTimeout(400);
  step('the paused card says in plain words that only OUTREACH is paused — one-by-one emails and replies still go', /OUTREACH from this mailbox/.test(await txt()) && /one by one, reply and hold conversations/.test(await txt()));
  step('Pause acts at once (no dialog) and the card becomes Paused with Start offered', (await calls()).some(c=>c[0]==='POST'&&c[2].action==='pause') && !(await page.$('.modal')) && (await btns()).join()==='Start,Block,Deactivate,Delete', (await btns()).join());
  await ev(()=>{ window.__calls.length=0; }); await page.click('.mbc-acts button:has-text("Block")'); await page.waitForSelector('.modal');
  const bm=await page.textContent('.modal');
  step('Block asks first and says what it does: OUTREACH stops, only an admin can unblock, one-by-one emails and replies still go', /Outreach/.test(bm) && /only an admin can unblock/i.test(bm) && /one by one/.test(bm) && !/Nothing will send/.test(bm) && !(await calls()).some(c=>c[0]==='POST'));
  await page.click('.modal button:has-text("Cancel")'); await page.waitForTimeout(150);
  step('Cancel does nothing', !(await calls()).some(c=>c[0]==='POST') && !(await page.$('.modal')));
  await page.click('.mbc-acts button:has-text("Block")'); await page.waitForSelector('.modal'); await page.click('.modal button:has-text("Block it")'); await page.waitForTimeout(400);
  await shot(page,'3-card-blocked.png','.mbc');
  step('confirming blocks it; the blocked card offers Unblock and NO Start', (await calls()).some(c=>c[0]==='POST'&&c[2].action==='block') && (await btns()).join()==='Unblock,Deactivate,Delete' && /Blocked by Prince Thomas/.test(await txt()), (await btns()).join());
  await page.click('.mbc-acts button:has-text("Unblock")'); await page.waitForTimeout(400);
  step('Unblock becomes a plain pause (Start is offered again, on purpose)', (await btns()).join()==='Start,Block,Deactivate,Delete');

  console.log('\nDelete');
  await page.click('.mbc-acts button:has-text("Delete")'); await page.waitForSelector('.modal');
  const m1=await page.textContent('.modal');
  step('a mailbox with mail on record: it says it cannot be deleted, why, and offers Deactivate instead', /cannot be deleted/.test(m1) && /9 emails/.test(m1) && /Deactivate instead/.test(m1) && !(await page.$('#mbc-del')));
  await page.click('.modal button:has-text("Cancel")');
  // the clean mailbox
  await page.fill('#mbc-q',''); await ev(()=>mbcType('fresh')); await page.waitForFunction(()=>{ const r=[...document.querySelectorAll('.mbc-row')]; return r.length===1&&/fresh\.one/.test(r[0].textContent); },null,{timeout:4000}); await page.click('.mbc-row'); await page.waitForFunction(()=>/fresh\.one@acme\.com/.test((document.querySelector('.mbc-detail .mbc-title')||{}).textContent||''),null,{timeout:4000}); await page.waitForTimeout(200);
  t=await txt();
  step('a mailbox that has sent nothing shows "—" for every rate, not 0%', /—\s*Bounce rate/i.test(t) && /—\s*Open rate/i.test(t) && /—\s*Reply rate/i.test(t) && !/\b0%\s*(Bounce|Open|Reply)/i.test(t), t.slice(t.indexOf('Last 30'),t.indexOf('Last 30')+220));
  await page.click('.mbc-acts button:has-text("Delete")'); await page.waitForSelector('#mbc-del');
  await ev(()=>{ window.__calls.length=0; }); await page.fill('#mbc-del','FRESH.ONE@acme.com'); await page.click('.modal button:has-text("Delete forever")'); await page.waitForTimeout(500);
  const dp=(await calls()).find(c=>c[0]==='POST'&&c[2].action==='delete');
  step('Delete needs the address typed, and that exact text is what is sent', dp && dp[2].confirm_address==='FRESH.ONE@acme.com', JSON.stringify(dp&&dp[2]));
  step('after deleting, the card closes', !(await page.$('.mbc-detail')));

  console.log('\nCounts as filters');
  await ev(()=>{ window.__calls.length=0; }); await page.click('.mbc-chip:has-text("Auto-paused")'); await page.waitForSelector('.mbc-row',{timeout:4000});
  step('pressing a count lists just those mailboxes (state filter sent to the server)', (await calls()).some(c=>/state=auto_paused/.test(c[1])) && /sam\.wilson@acme\.com/.test(await txt()) && (await page.$$('.mbc-row')).length===1);

  console.log('\nPhone');
  await page.setViewportSize({width:390,height:800}); await page.waitForTimeout(200);
  await page.click('.mbc-row'); await page.waitForSelector('.mbc-detail .mbc-title'); await page.waitForTimeout(200);
  const over=await ev(()=>{ const c=document.getElementById('content'); return {sw:c.scrollWidth,cw:c.clientWidth,doc:document.documentElement.scrollWidth,vw:window.innerWidth}; });
  await shot(page,'4-phone.png','.mbc');
  step('at phone width nothing makes the page scroll sideways', over.sw<=over.cw+1 && over.doc<=over.vw+1, JSON.stringify(over));
  step('no script errors', errs.length===0, errs.join(' | ').slice(0,300));
} catch(e){ console.error(e); step('ran to the end',false,String(e).slice(0,300)); }
finally{ if(browser) await browser.close(); server.close(); }
console.log('\nSUMMARY: '+results.filter(Boolean).length+'/'+results.length+' passed'); process.exit(results.every(Boolean)?0:1);
