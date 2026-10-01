// "NEEDS YOU TODAY" SHOWS TODAY'S THINGS — ON THE USER'S OWN CLOCK (R-097, D-0065).
// Owner: "the Need you today should show the things for that day, not the full thing", and "today" is
// "that date according to the system of the user".
//   * an item dated today (a reminder due today, a message that arrived today) is on the list;
//   * anything older is NOT in the list, is counted ("N older items still open") and a button shows it;
//   * nothing is deleted — Show older brings every row back;
//   * the day is the VIEWER'S: the same instant is "today" in one time zone and "yesterday" in another;
//   * an item with no readable date is kept (never hide what cannot be dated);
//   * the chips count what is shown.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
const NOW = Date.parse('2026-10-01T19:00:00Z');   // 12:00 in Los Angeles · 00:30 on 2 Oct in Kolkata
const it = (id, kind, extra) => Object.assign({ kind, entity_type:'contact', entity_id:id, title:'P-'+id, subtitle:'Co', reason:'r', priority:50 }, extra);
const ITEMS = [
  it('rem-today', 'reminder_due',   { reminder_id:'r1', due_at:'2026-10-01' }),
  it('rem-old',   'reminder_due',   { reminder_id:'r2', due_at:'2026-09-27' }),
  it('reply-now', 'reply_due',      { last_activity_at:'2026-10-01T17:30:00Z' }),
  it('reply-old', 'reply_due',      { last_activity_at:'2026-09-25T10:00:00Z' }),
  it('nudge-old', 'nudge',          { last_activity_at:'2026-08-20T10:00:00Z' }),
  it('undated',   'reply_due',      {}),
];
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  async function run(tz){
    const ctx=await browser.newContext({ timezoneId: tz }); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
    const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
    await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
    const out = await page.evaluate(({items,now})=>{
      const sp = naSplitToday(items, now);
      STATE.naShowOlder=false; STATE.viewingUser=null;
      STATE.nextActions={ items, summary:{by_kind:{}} };
      const html1 = renderNextActionsCard();
      STATE.naShowOlder=true;
      const html2 = renderNextActionsCard();
      STATE.naShowOlder=false;
      STATE.nextActions={ items: items.filter(i=>/old/.test(i.entity_id)), summary:{by_kind:{}} };
      const html3 = renderNextActionsCard();
      return { today: sp.today.map(i=>i.entity_id), older: sp.older.map(i=>i.entity_id), html1, html2, html3 };
    }, {items:ITEMS, now:NOW});
    await ctx.close(); return out;
  }
  const la = await run('America/Los_Angeles');
  step('Los Angeles: today = the reminder due today, the reply from this morning, and the undated one',
    JSON.stringify(la.today)==='["rem-today","reply-now","undated"]', JSON.stringify(la.today));
  step('Los Angeles: the old reminder, old reply and old nudge are set aside', JSON.stringify(la.older)==='["rem-old","reply-old","nudge-old"]', JSON.stringify(la.older));
  step('the card lists today\'s three rows and none of the old ones', ['P-rem-today','P-reply-now','P-undated'].every(n=>la.html1.includes(n)) && !/P-rem-old|P-reply-old|P-nudge-old/.test(la.html1));
  step('it says how many are older, and offers them', /3 older items still open/.test(la.html1) && /Show older/.test(la.html1));
  step('Show older brings every row back — nothing was deleted', ['P-rem-old','P-reply-old','P-nudge-old','P-rem-today'].every(n=>la.html2.includes(n)) && /Hide older/.test(la.html2));
  step('chips count what is shown (2 to reply · 1 reminder), not the whole pile', /2 to reply/.test(la.html1) && /1 reminder/.test(la.html1) && !/to chase/.test(la.html1));
  step('only old things left → says nothing is new today, still offers them', /Nothing new for today/.test(la.html3) && /Show older/.test(la.html3), la.html3.slice(0,300));
  const ist = await run('Asia/Kolkata');
  step('Kolkata (already 2 Oct): the same instant is a different day — "reply from this morning" is now older',
    !ist.today.includes('reply-now') && ist.older.includes('reply-now') && !ist.today.includes('rem-today'), JSON.stringify(ist.today));
  step('No page errors', errs.length===0, errs.join('|'));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
