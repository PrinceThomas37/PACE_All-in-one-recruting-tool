// THE SOURCING PAGE MUST NOT ADVERTISE WHAT DOES NOT EXIST.
//
// It listed Apollo, Indeed, Monster, CareerBuilder, Dice and LinkedIn as cards
// with a "NEEDS CREDS" badge and a Details button, next to the one source that
// actually worked. There is no adapter behind any of them — `POST
// /sourcing/search` answers 501 for every one — so the badge was telling the
// owner that a key would switch them on. It would not. They looked like
// features for five sessions, and the owner found it by asking which were free
// and where to get the keys.
//
// This is the same failure as the team-Done button in Session 24: **a thing you
// can see, appear to act on, and not actually change is worse than either
// showing it plainly or not showing it.** So the rule is measurable —
// an unbuilt provider renders NO action, and says what it would really take.
//
// Usage: node test/sourcing-honesty-smoke.mjs   (needs express + a browser)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp } from './helpers/enter-app.mjs';

const require = createRequire(import.meta.url);
const express = require('express');
const sourcingCfg = require('../config/sourcing.js');

const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail && !cond ? ' — ' + detail : '')); };

// ════════════════════════════════════════════════════════════════════════════
// 1. The registry tells the truth
// ════════════════════════════════════════════════════════════════════════════
const list = sourcingCfg.providerList();

ok('every provider declares built', list.every(p => typeof p.built === 'boolean'));
ok('available means built, and nothing else', list.every(p => p.available === p.built),
  list.filter(p => p.available !== p.built).map(p => p.id).join(','));
ok('an unbuilt provider says what it would really take',
  list.filter(p => !p.built).every(p => p.blocker && p.blocker.length > 20),
  list.filter(p => !p.built && !p.blocker).map(p => p.id).join(','));
ok('a built provider needs no blocker', list.filter(p => p.built).every(p => !p.blocker));

// The exact word that caused this. "Needs credentials" means "add a key and it
// works" — for every one of these that is false.
const asText = JSON.stringify(list);
ok('nothing claims it merely "needs_credentials"', !/needs_credentials/i.test(asText));

ok('the apply page and CSV are the built sources',
  list.filter(p => p.built).map(p => p.id).sort().join(',') === 'apply,csv',
  list.filter(p => p.built).map(p => p.id).join(','));
ok('the boards the owner asked about are all present and unbuilt',
  ['careerbuilder', 'resume_library', 'linkedin'].every(id => {
    const p = list.find(x => x.id === id); return p && !p.built;
  }));
ok('LinkedIn does not describe itself as a people search',
  /no API|not a search/i.test(list.find(p => p.id === 'linkedin').note));

// Existing staged rows carry a provider string; dropping an id would orphan
// them in the review grid with a blank Source column.
for (const id of ['csv', 'apollo', 'indeed', 'monster', 'careerbuilder', 'dice', 'linkedin']) {
  ok(`the historic provider id "${id}" still resolves`, sourcingCfg.PROVIDER_IDS.includes(id));
}

// ════════════════════════════════════════════════════════════════════════════
// 2. The endpoint refuses honestly
// ════════════════════════════════════════════════════════════════════════════
{
  const app = express();
  app.use(express.json());
  const core = {
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
    db: {}, auth: (req, _r, next) => { req.user = { id: 'u1', role: 'recruiter' }; req.orgId = 'o1'; next(); },
    hasRole: () => true, today: () => '2026-09-21',
    orgIdFor: () => 'o1', orgStamp: () => ({ org_id: 'o1' }), withOrg: (q) => q,
    isBDM: () => false, isRecruiter: () => true,
    recruiterCanTouchJob: async () => true, assignedJobOrderIds: async () => [],
    reportingChainIds: async () => [], nextId: async () => 'X-1',
    normalizeStage: (s) => s, STAGES: [], STAGE_ALIASES: {},
    logSubmissionActivity: async () => {}, invalidateJobScores: () => {},
    persistScores: async () => {}, applyDerivedJobFields: () => {},
    hasRequirementColumns: async () => false, pickJobFields: () => ({}),
    JOB_ORDER_SELECT: '*', JOB_FIELDS: [], JOB_DATE_FIELDS: [],
  };
  require('../routes/recruiting/sourcing.js')(app, core);

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const search = (provider) => fetch(base + '/sourcing/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });

  const cb = await search('careerbuilder');
  const cbBody = await cb.json();
  ok('an unbuilt provider is refused 501', cb.status === 501, 'got ' + cb.status);
  ok('...as not_built, not as a missing key', cbBody.error === 'not_built', cbBody.error);
  ok('...and names what it would really take', /paid CareerBuilder/i.test(cbBody.message || ''), cbBody.message);
  ok('...and points at the route that works today', /CSV import/i.test(cbBody.message || ''), cbBody.message);

  const li = await search('linkedin');
  ok('LinkedIn is refused the same way', li.status === 501);
  ok('...and never blames a missing credential',
    !/needs_credentials|add credentials/i.test(JSON.stringify(await li.json())));

  const unknown = await search('monster.com');
  ok('an unknown provider is a 400, not a 501', unknown.status === 400, 'got ' + unknown.status);

  const ap = await search('apply');
  ok('the apply page is not searchable — applicants arrive on their own', ap.status === 400);

  server.close();
}

// ════════════════════════════════════════════════════════════════════════════
// 3. THE SCREEN. An unbuilt provider renders no action.
//    This is the assertion that matters: the fault was never in the data, it
//    was that the page drew a button next to every one of them.
// ════════════════════════════════════════════════════════════════════════════
{
  const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => {
      if (err) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data);
    });
  });
  const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

  const exe = process.env.PLAYWRIGHT_CHROMIUM ||
    (process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'))
      ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : 'chromium');
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await enterApp(page, 'admin');
  await page.evaluate((provs) => {
    STATE.sourcing = Object.assign({ sel: {}, staged: [], jobs: [] }, STATE.sourcing || {},
      { providers: provs, staged: [], sel: {} });
    STATE.ats = STATE.ats || {}; STATE.ats.view = 'sourcing';
    STATE.page = 'applicants';
    render();
  }, list);
  await page.waitForTimeout(250);

  const seen = await page.evaluate(() => document.getElementById('content').innerText);
  const unbuilt = list.filter(p => !p.built);

  ok('the page renders the Sourcing screen', /Sourcing/.test(seen));
  ok('every unbuilt provider is still listed (a roadmap, not a deletion)',
    unbuilt.every(p => seen.includes(p.label)),
    unbuilt.filter(p => !seen.includes(p.label)).map(p => p.label).join(','));
  ok('the page says plainly that they are not connected', /Not connected/i.test(seen));
  ok('...and that none of them is free', /none of them is free/i.test(seen));

  // THE RULE, measured: no unbuilt provider sits inside a panel that offers an
  // action. `.card` is the unit, because that is what reads as "a thing you can
  // use" — the broken version gave every provider its own card with a button;
  // the fixed one puts them all in ONE card that contains no controls at all.
  //
  // ⚠ THE FIRST VERSION OF THIS PROBE WAS VACUOUS AND PASSED 30/30 WITH THE BUG
  // FULLY REINTRODUCED. Two reasons, and both are the general lesson:
  //   1. it did `if (!node) continue` — a label it could not find was silently
  //      counted as fine. A probe that cannot measure must FAIL, never pass.
  //   2. it looked at `node.parentElement` only, and the button sat one level
  //      further up. Checking a hand-picked ancestor is a guess about layout;
  //      `closest('.card')` asks the question the rule is actually about.
  const probe = await page.evaluate((labels) => {
    const bad = [], missing = [];
    for (const label of labels) {
      const node = [...document.querySelectorAll('#content *')]
        .find(el => el.children.length === 0 && el.textContent.trim() === label);
      if (!node) { missing.push(label); continue; }
      const card = node.closest('.card');
      if (!card) { missing.push(label + ' (no card ancestor)'); continue; }
      if (card.querySelector('button, input, select, textarea, a[href], [onclick]')) bad.push(label);
    }
    return { bad, missing };
  }, unbuilt.map(p => p.label));

  // A measurement that could not be taken is a FAILURE, not a pass.
  ok('every unbuilt provider was actually found on the page and measured',
    probe.missing.length === 0, 'could not measure: ' + probe.missing.join(','));
  ok('NO unbuilt provider sits in a panel offering an action',
    probe.bad.length === 0, probe.bad.join(','));

  // The built ones must still be usable, or this went too far the other way.
  const hasImport = await page.evaluate(() =>
    !!document.querySelector('#content input[type=file]'));
  ok('the CSV import control is still there', hasImport);

  ok('no stale "NEEDS CREDS" badge survives anywhere', !/NEEDS CREDS/i.test(seen));

  await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
