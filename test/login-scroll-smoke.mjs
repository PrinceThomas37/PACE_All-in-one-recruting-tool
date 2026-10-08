// THE LOGIN CARD MUST ALWAYS BE REACHABLE (owner, 8 Oct 2026): "in a 13-inch laptop the login page opened like this, not able
// to scroll down to add password and login — I had to decrease the screen zoom."
//   The login wrapper was a fixed-height box with its overflow hidden, centred; a window shorter than the card (a small laptop
//   at 150% display scaling is ~590 CSS px tall) cut off the password box and the Log In button with no way to scroll to them.
//   * in a window shorter than the card the wrapper scrolls, and the Log In button can be brought into view
//   * in a tall window the card is still centred (nothing moved for people it already worked for)
//   * the card's top is never cut off (a centred box that overflows loses its top first)
//   * the sign-up tab is reachable the same way
// Usage: node test/login-scroll-smoke.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless:true, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  async function open(w, h) {
    const ctx = await browser.newContext({ viewport:{ width:w, height:h } });
    await ctx.route('**', r => r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort());
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:'+PORT+'/'); await page.waitForSelector('.login-card');
    return { ctx, page };
  }
  const where = () => {
    const c = document.querySelector('.login-card').getBoundingClientRect();
    const btn = [...document.querySelectorAll('.login-card button')].find(b => /^Log In$/.test(b.textContent.trim()) && b.className.includes('btn-primary'));
    const pw = document.getElementById('login-pass').getBoundingClientRect();
    return { cardTop: Math.round(c.top), cardBottom: Math.round(c.bottom), cardH: Math.round(c.height), btnBottom: Math.round(btn.getBoundingClientRect().bottom), pwBottom: Math.round(pw.bottom), innerH: innerHeight };
  };

  // a window clearly shorter than the card
  let { ctx, page } = await open(966, 420);
  let m = await page.evaluate(where);
  step('the test window really is shorter than the card (otherwise this proves nothing)', m.cardH > m.innerH, JSON.stringify(m));
  await page.mouse.move(480, 200); await page.mouse.wheel(0, 2000); await page.waitForTimeout(250);
  let after = await page.evaluate(where);
  step('wheel-scrolling brings the Log In button into view', after.btnBottom <= after.innerH, JSON.stringify(after));
  step('and the password box too', after.pwBottom <= after.innerH);
  await page.evaluate(() => document.querySelector('.login-wrap').scrollTo(0, 0)); await page.waitForTimeout(100);
  m = await page.evaluate(where);
  step('scrolled back up, the top of the card is whole (not cut off above the window)', m.cardTop >= 0, JSON.stringify(m));
  await ctx.close();

  // the Sign Up tab is longer — same promise
  ({ ctx, page } = await open(966, 420));
  await page.evaluate(() => { const t = [...document.querySelectorAll('.login-tab')].find(b => /Sign Up/.test(b.textContent)); if (t) t.click(); });
  await page.waitForTimeout(250);
  const reach = await page.evaluate(() => { const w = document.querySelector('.login-wrap'); return { canScroll: w.scrollHeight > w.clientHeight, ov: getComputedStyle(w).overflowY }; });
  step('the sign-up tab scrolls too when it is taller than the window', reach.canScroll && /auto|scroll/.test(reach.ov), JSON.stringify(reach));
  await ctx.close();

  // a tall window: still centred
  ({ ctx, page } = await open(1280, 1000));
  m = await page.evaluate(where);
  const gapTop = m.cardTop, gapBottom = m.innerH - m.cardBottom;
  step('in a tall window the card stays centred (top and bottom space within 2px)', Math.abs(gapTop - gapBottom) <= 2, 'top ' + gapTop + ' bottom ' + gapBottom);
  await ctx.close();
} finally { if (browser) await browser.close(); server.close(); }
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
