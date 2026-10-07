// CAN YOU ACTUALLY READ IT? (Session 23, D-0015)
//
// The theme re-skins the app by redefining CSS variables, which works for
// everything that READS those variables — and silently fails for everything
// that hard-codes a colour instead. Two ways that already bit, both invisible
// to every other test and both found only by looking at a screenshot:
//
//   * the dashboard clock and the "Your team's desk" chip carried white in an
//     INLINE style, because the banner used to be a dark green slab. On a light
//     banner they became white-on-white;
//   * ui.css carries its OWN palette (--ink / --ink2 / --line / --hover),
//     separate from styles.css's --text / --border. Overriding only --text left
//     the whole Leads table drawing #0F172A ink on dark glass.
//
// A theme has to reach EVERY palette in the app, not the one it found first.
// So this measures the thing that actually matters — the contrast between text
// and whatever is really painted behind it — on every page, in both themes.
//
// Usage: node test/theme-contrast-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin, switchRole } from './helpers/enter-app.mjs';
import { CONTRAST_PROBE } from './helpers/contrast-probe.mjs';

const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const step = (n, ok, d='') => { results.push(ok); console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:'')); };
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
  return 'chromium';
}

// THE LINE. Dark is the owner's complaint ("the visibility issue is persistent
// across the UI", R-140) and is held to 4:1 — the card/ink pairs the retro look
// is built from sit at 4.4-15, and everything under 4 was either unreadable or
// a pale grey that should be darker. Light is held to 3.5 because brand purple
// on its own 12% tint (a selected chip) measures 3.8-4.2 by design; darkening
// the brand purple is the owner's call, not a test's.
const MIN_FOR = (theme) => theme === 'dark' ? 4.0 : 3.5;

// The measuring function lives in test/helpers/contrast-probe.mjs. It used to
// live here, and it SKIPPED any text over a background image — which includes
// the page ground's grid, i.e. every title and tab bar standing on the dark
// canvas. Nothing measured them, in either theme, for the whole life of the
// test. The self-test below proves that blind spot stays closed.
const probe = (page, minRatio, scope, limit = 6) => page.evaluate(CONTRAST_PROBE, { minRatio, scope, limit });

// A page is not one screen. Setting STATE.page alone renders every multi-tab
// page as its DEFAULT tab, so Email's Sent and Outreach Plan were never drawn
// once — and both shipped with unreadable text the owner found on their phone.
// Each entry is [page, subState] where subState is merged into STATE.
const SCREENS = [
  ['dashboard'], ['leads'], ['applicants'], ['reports'], ['myteam'],
  ['myteam', { myteamTab:'team' }], ['myteam', { myteamTab:'reports' }],
  ['bd_joborders'], ['bd_myjobs'], ['bd_jodetail'], ['bd_pipeline'],
  ['clients'], ['sourced'], ['insights'], ['reminders'], ['admin'], ['assign'], ['workflows'], ['mailbox'],
  ['email', { emailTab:'pending' }],
  ['email', { emailTab:'compose' }],
  ['email', { emailTab:'sent' }],
  ['email', { emailTab:'allmail' }],
  ['email', { emailTab:'outreachplan' }],
  ['email', { emailTab:'sequence' }],
  // R-146/R-147 (D-0082): the merged Sequence tab's other two pills — My wording (the old Outreach Plan) and AI style, with
  // a written sample and an admin's team box on screen so every surface of the card is measured.
  ['email', { emailTab:'sequence', seqView:'wording' }],
  ['email', { emailTab:'sequence', seqView:'style', aiStyle:{ data:{ person:'Warm and plain.', team:'Plain.', in_force:'Warm and plain.', source:'person', max:700, can_set_team:true, ai:{ available:true, reason:null } },
    draft:'Warm and plain.', teamDraft:'Plain.', sample:{ ai:true, written:true, subject:'Senior Estimator hire in Dallas', body:'Hi Sam,\n\nA short, warm note.\n\nThanks,' } } }],
  ['email', { emailTab:'sequence', seqView:'style', aiStyle:{ data:{ person:'', team:'', in_force:'', source:null, max:700, can_set_team:false, ai:{ available:false, reason:'not_configured' } },
    draft:'', teamDraft:'', sample:{ ai:true, written:false, reason:'draft_rejected', violations:['fee_percentage'] } } }],
  ['applicants', { ats:{ view:'grid' } }], ['applicants', { ats:{ view:'applied' } }], ['applicants', { ats:{ view:'sourcing' } }],
];
const ROLES = ['admin','bd','recruiter','ra'];

// A screen with nothing on it is a screen with nothing to measure: an empty
// list has no rows, a team of one has no "5 direct reports" line. The owner's
// unreadable text was ON the populated screens, so they are populated here.
const SEED = () => {
  const S = window.STATE, now = new Date().toISOString();
  S.bd = S.bd || {}; S.bd.view = Object.assign({}, S.bd.view, { joId:'jo-1', pipelineJoId:'jo-1', kanbanJoId:'jo-1' });
  S.bd.jobOrders = [1,2,3].map(i => ({ id:'jo-'+i, job_code:'JO-'+i, job_title:['HVAC Technician','Estimator','Project Manager'][i-1],
    client:'Northwind '+i, status:i===3?'On Hold':'Open', city:'Hartford', state:'CT', job_type:'Full-time', pay_rate:'$80/hr',
    primary_skills:'Procore, Bluebeam', job_description:'Service and repair.', created_at:now, apply_enabled:i===1, apply_token:'a'.repeat(32), apply_count:3 }));
  const cands = [['Jason Palencia','Project Manager'],['Taylor Ray','Estimator'],['Kevin Back','Superintendent'],['Charles Hudson','Core Proficiencies']]
    .map((q,i) => ({ id:'c'+i, candidate_code:'CN-0'+i, full_name:q[0], current_title:q[1], email:'p'+i+'@mail.test', phone:'864-555-010'+i,
      city:'Austin', state:'TX', skills:['hvac','sql'], extra_emails:[], extra_phones:[] }));
  const stages = ['Sourced','Screening','Submitted to BDM','Interview Scheduled'];
  S.bd.pipeline = cands.map((c,i) => ({ id:'pl'+i, job_order_id:'jo-1', pipeline_code:'PL-'+i, candidate:c, submission:{ id:'s'+i, stage:stages[i] } }));
  S.bd.jobPipeline = S.bd.pipeline;
  S.bd.submissions = cands.map((c,i) => ({ id:'s'+i, job_order_id:'jo-1', stage:stages[i], candidate_id:c.id, candidate:c, created_at:now }));
  S.jobs = [1,2,3,4].map(i => ({ id:'l-'+i, position:['Estimator','Site Superintendent','Project Engineer','Safety Manager'][i-1], company_name:'Acme '+i,
    stage:['Unassigned','Assigned','Connected','Rejected'][i-1], location:'Dallas, TX', created_at:now, assigned_to_bd:S.user&&S.user.id,
    created_by:S.user&&S.user.id, industry:'Construction' }));
  S.contacts = [1,2,3,4].map(i => ({ id:'ct'+i, job_id:'l-'+i, first_name:'Maria', last_name:'Lopez '+i, designation:'HR Director',
    email:'m'+i+'@acme.test', phone:'(555) 111-222'+i, extra_emails:[], extra_phones:[], linkedin:'', is_primary:i===1, email_status:i===3?'invalid':'valid' }));
  S.leads = S.jobs; S.companies = [{ id:'co1', name:'Acme 1', web:'acme.test', ind:'Construction', loc:'Dallas' }];
  S.reminders = [{ id:'r1', title:'Call Maria', due_date:'2026-10-01', status:'pending', type:'follow_up' }];
  S.candidates = cands;
  // A small reporting line: "N direct reports · M in your reporting line" is a
  // sentence on the My Team header that only exists when someone reports to you.
  const me = S.user.id;
  S.users = [{ id:me, name:S.user.name, role:S.user.role, managerId:null },
    { id:'u2', name:'Asha Rao', role:'bd', managerId:me, email:'a@x.test' },
    { id:'u3', name:'Ben Cole', role:'recruiter', managerId:me, email:'b@x.test' },
    { id:'u4', name:'Cy Dunn', role:'ra', managerId:'u2', email:'c@x.test' }];
  // A mailbox with a few messages, so the Inbox's list, bar and chips are drawn.
  S.mailbox = Object.assign(S.mailbox || {}, {
    accounts:[{ id:'mb1', email_address:'me@example.test', platform:'Gmail', readable:true }], activeId:'mb1', accountsLoading:false,
    folders:[{ id:'INBOX', name:'Inbox', kind:'inbox', unread:2 },{ id:'SENT', name:'Sent', kind:'sent', unread:0 },{ id:'SPAM', name:'Spam', kind:'spam', unread:0 }],
    folderId:'INBOX', foldersLoading:false, listLoading:false, error:null, labels:{},
    messages:[1,2,3].map(i => ({ id:'m'+i, subject:'Re: Estimator role '+i, from:{ name:'Maria Lopez', email:'m'+i+'@acme.test' }, to:[{ email:'me@example.test' }],
      date:now, unread:i<3, preview:'Thanks for reaching out — can we talk Thursday?', label_ids:[] })),
    sel:{ m1:true },
  });
};

// Overlays and open menus: the drawer that opens over a page, the "+ New" menu,
// the evidence drawer — each paints its OWN paper over the dark scrim.
const OVERLAYS = [
  ['the evidence drawer', () => { window.evidenceOpen({ title:'Sent to client', hint:'Each person counted.', actions:[{ label:'Open the job', fn(){} }],
      load:() => Promise.resolve({ items:[{ primary:'Jason Palencia', secondary:'Estimator · Acme', body:'They wrote: yes, Thursday works.', tone:'in', chips:['replied'], when:'01 Oct 2026' },
        { primary:'Taylor Ray', secondary:'Estimator', tone:'out', chips:[], when:'30 Sep 2026' }], total:2, more:0 }) }); }],
  ['the + New menu', () => { window.STATE.page = 'dashboard'; window.STATE.newMenu = true; window.render(); }],
  ['the job detail modal', () => { window.STATE.page = 'leads'; window.STATE.modal = { type:'jobDetail', id:'l-1' }; window.render(); }],
  ['the add-lead modal', () => { window.STATE.page = 'leads'; window.STATE.modal = { type:'addJob' }; window.render(); }],
  ['the add-contact modal', () => { window.STATE.page = 'leads'; window.STATE.modal = { type:'addContact', job_id:'l-1' }; window.render(); }],
  ['a client record', () => { window.STATE.page = 'clients'; window.STATE.clients = Object.assign(window.STATE.clients || {}, { list:[{ id:'cl1', name:'Northwind 1', status:'Active', created_at:new Date().toISOString() }], selectedId:'cl1', loading:false }); window.render(); }],
];

let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });

  for (const theme of ['dark','light']) {
    const MIN = MIN_FOR(theme);
    const ctx = await browser.newContext({ viewport:{width:1440,height:950} });
    await ctx.route('**', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    await ctx.addInitScript((t)=>{ try{ localStorage.setItem('pace-theme', t); }catch(e){} }, theme);
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil:'domcontentloaded' });
    await waitForLogin(page);
    await enterApp(page, 'admin');

    // The theme must actually be on, or this whole suite proves nothing.
    const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    step(`the ${theme} theme is really applied`, applied === theme, `data-theme=${applied}`);

    // THE PROBE CAN SEE THE PLACE IT WAS BLIND (R-140). Dark ink standing
    // straight on the dark ground is exactly what the owner kept finding. Put
    // some there on purpose, with a literal colour no theme rule can fix, and
    // demand the probe reports it in dark and does not in light. If this step
    // ever goes green by the probe skipping the ground again, the whole suite
    // below is a claim, not a measurement.
    await page.evaluate(() => {
      const d = document.createElement('div'); d.id = '__ground_probe';
      d.setAttribute('style', 'color:#1A1033;padding:8px;font-size:14px');
      d.textContent = 'text straight on the page ground';
      document.getElementById('content').appendChild(d);
    });
    const seen = await probe(page, MIN, '#__ground_probe');
    step(`the probe ${theme === 'dark' ? 'catches' : 'accepts'} dark ink on the ${theme} page ground`,
      theme === 'dark' ? (seen.bad.length === 1 && seen.judged === 1) : (seen.bad.length === 0 && seen.judged === 1),
      `judged ${seen.judged}, flagged ${seen.bad.length}${seen.bad[0] ? ' at ' + seen.bad[0].ratio + ':1' : ''}`);
    await page.evaluate(() => document.getElementById('__ground_probe').remove());

    const offenders = [];
    let screens = 0, judged = 0, declined = 0;
    for (const role of ROLES) {
      await switchRole(page, role);
      await page.evaluate(SEED);
      for (const [p, sub] of SCREENS) {
        await page.evaluate(({pp, ss})=>{
          const S = window.STATE;
          if (ss) for (const k of Object.keys(ss)) S[k] = (ss[k] && typeof ss[k] === 'object') ? Object.assign({}, S[k], ss[k]) : ss[k];
          S.modal = null; S.newMenu = false; S.page = pp;
          window.render();
        }, { pp:p, ss:sub || null });
        await page.waitForTimeout(90);
        screens++;
        const label = sub ? `${p}:${Object.values(sub).map(v => typeof v === 'object' ? Object.values(v).join('/') : v).join('/')}` : p;
        const r = await probe(page, MIN, '#content *, #topbar *, #sidebar *, #layer *');
        judged += r.judged; declined += r.declined;
        for (const b of r.bad) offenders.push(`${theme}/${role}/${label}: "${b.txt}" on ${b.surface} ${b.color}/${b.bg} = ${b.ratio}:1`);
      }
    }
    step(`every screen is readable in ${theme} at ${MIN}:1 (${screens} screens, ${judged} pieces of text)`,
      offenders.length === 0, offenders.slice(0,5).join(' | '));
    // A measurement that declined to measure is not a pass. Gradients and
    // images behind text are the only things it may skip, and there must be few.
    step(`the probe judged almost everything in ${theme} (declined ${declined} of ${judged + declined})`,
      judged > 3000 && declined < judged * 0.02, `judged ${judged}, declined ${declined}`);

    // The seeded mailbox must really have drawn, or the Inbox row above proved nothing.
    await switchRole(page, 'bd');
    await page.evaluate(SEED);
    await page.evaluate(() => { window.STATE.page = 'mailbox'; window.render(); });
    await page.waitForTimeout(150);
    const mbText = await page.evaluate(() => (document.getElementById('content') || {}).innerText || '');
    step(`the seeded Inbox is on screen in ${theme}`, /Re: Estimator role 1/.test(mbText), mbText.slice(0, 60).replace(/\n/g, ' '));

    // OVERLAYS AND MENUS, drawn over the page, in the same theme.
    const overlayBad = [];
    for (const [name, open] of OVERLAYS) {
      await page.evaluate(() => { const S = window.STATE; S.modal = null; S.newMenu = false; S.page = 'dashboard'; window.render(); });
      await page.evaluate(open);
      await page.waitForTimeout(160);
      const r = await probe(page, MIN, '#layer *, #topbar *, #content *');
      const shown = await page.evaluate(() => document.querySelectorAll('#layer *, .tb-newmenu').length);
      if (!shown) overlayBad.push(`${name}: nothing was drawn, so nothing was measured`);
      for (const b of r.bad) overlayBad.push(`${name}: "${b.txt}" on ${b.surface} ${b.color}/${b.bg} = ${b.ratio}:1`);
    }
    await page.evaluate(() => { const S = window.STATE; S.modal = null; S.newMenu = false; if (window.evidenceClose) window.evidenceClose(); });
    step(`every overlay and menu is readable in ${theme} (${OVERLAYS.length} of them)`, overlayBad.length === 0, overlayBad.slice(0, +(process.env.SHOWALL ? 99 : 5)).join(' | '));

    // INTERACTIVE STATES. Everything above renders a screen AT REST, so the
    // hover palette and the open-row palette were never drawn once — and
    // `tr:hover td{background:#FAFBFC}` (a literal in styles.css, set on the
    // CELL, which paints over its row) made every detail of a hovered or
    // opened Leads row white-on-white in dark. The owner found it; six screens
    // x three roles x two themes did not, because a colour that only exists
    // under the pointer is invisible to a screenshot of the page at rest.
    // A palette has states. Drive them.
    await switchRole(page, 'bd');
    const rows = await page.evaluate(()=>{
      const t = new Date().toISOString();
      window.STATE.companies = [{ id:'co0', name:'Contrast Co' }];
      window.STATE.contacts  = [{ id:'ct0', job_id:'j0', company_id:'co0', first_name:'Ada',
        last_name:'Byron', email:'ada@contrast.co', designation:'Head of Ops',
        is_primary:true, email_status:'valid' }];
      window.STATE.jobs = [{ id:'j0', position:'Payroll Specialist', pos:'Payroll Specialist',
        company_id:'co0', company_name:'Contrast Co', company:{ name:'Contrast Co' },
        location:'Oklahoma City, OK', loc:'Oklahoma City, OK', stage:'Assigned',
        industry:'Truck Transportation', date:t.slice(0,10), created_at:t,
        assigned_to_bd:'test-bd', assigned_bd_name:'BD Lead 2', assigned_at:t, contacts:[] }];
      window.STATE.leads = window.STATE.jobs;
      window.STATE.page = 'leads';
      window.render();
      return document.querySelectorAll('#content tr[data-row-id]').length;
    });
    await page.waitForTimeout(150);
    // A state test with nothing to put in that state passes vacuously. Two
    // guards died that way this session; this one says so out loud.
    step(`the state pass has a row to drive in ${theme}`, rows > 0, `${rows} rows`);

    const stateBad = [];
    let panelText = 0;
    if (rows > 0) {
      await page.hover('#content tr[data-row-id="j0"]');
      await page.waitForTimeout(120);
      for (const b of (await probe(page, MIN, '#content tr[data-row-id] *')).bad)
        stateBad.push(`hover: "${b.txt}" ${b.color} on ${b.bg} = ${b.ratio}:1`);
      // ...and opened, which is both `.is-open` AND still hovered.
      await page.click('#content tr[data-row-id="j0"]');
      await page.waitForTimeout(220);
      // THE PANEL IS WHERE AN OPENED ROW'S TEXT IS. This scope used to name
      // `.lead-expand`, a class that exists nowhere in the app — the panel is
      // the `tr.row-exp` every list opens (03-core-render.js, R-012) — so the
      // "opened" pass measured the row's own cells and never once the
      // contacts, facts and buttons beneath it. Found in Session 33, when a
      // deliberate dark ink on a contact's name in that panel passed. It is
      // asserted present below, so the next rename fails instead of going quiet.
      panelText = await page.evaluate(() => {
        const tr = document.querySelector('#content tr[data-row-id="j0"]');
        const nx = tr && tr.nextElementSibling;
        return nx && nx.classList.contains('row-exp') ? nx.textContent.trim().length : 0;
      });
      for (const b of (await probe(page, MIN, '#content tr[data-row-id] *, #content tr.row-exp *')).bad)
        stateBad.push(`open: "${b.txt}" ${b.color} on ${b.bg} = ${b.ratio}:1`);
    }
    step(`the opened row's panel is there to measure in ${theme}`, panelText > 0, `${panelText} chars of text`);
    step(`a hovered and an opened row stay readable in ${theme}`,
      stateBad.length === 0, stateBad.slice(0,5).join(' | '));

    // THE LOGGED-OUT SCREEN. enterApp() signs in, so this suite never rendered
    // the login page once — and it shipped with invisible SSO buttons and
    // invisible field labels. It is the FIRST thing anyone sees.
    await page.evaluate(()=>{
      window.STATE.user = null; window.STATE.token = null; window.render();
    });
    await page.waitForTimeout(250);
    // The login screen lives outside the app shell, so it needs the whole body.
    const loginBad = (await probe(page, MIN, 'body *')).bad;
    step(`the login screen is readable in ${theme}`, loginBad.length === 0,
      loginBad.slice(0,4).map(b=>`"${b.txt}" ${b.color} on ${b.bg} = ${b.ratio}:1`).join(' | '));

    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter(r=>!r).length;
console.log(`\nSUMMARY: ${results.length-failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
