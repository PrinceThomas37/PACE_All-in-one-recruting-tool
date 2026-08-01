// Unit test for match-engine.js — the server side of candidate ↔ job relevance.
//
// The property that matters most: the score the SERVER sorts a pool by and the
// score the BROWSER shows in the grid must be the same number. They are supposed
// to be the same code (one file, two runtimes) — this proves it stayed that way,
// because a silent divergence would show recruiters one ranking and act on
// another.
//
// Usage: node test/match-engine-smoke.mjs   (needs playwright-core for the
//        browser half; the Node half runs without it)

import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const engine = require('../match-engine.js');
const scorer = require('../public/js/38-match-score.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── fixtures ─────────────────────────────────────────────────────────────────
const JOB = {
  id: 'j1', job_title: 'Senior Frontend Engineer',
  primary_skills: 'React, Node.js, TypeScript', secondary_skills: 'AWS',
  exp_min: 5, exp_max: 10, work_auth: 'US Citizen', state: 'TX', remote: 'No'
};
const STRONG = { id: 'c1', full_name: 'Strong Fit', skills: 'React, Node.js, TypeScript, AWS', experience_years: 7, work_authorization: 'US Citizen', current_title: 'Senior Frontend Engineer', state: 'TX' };
const MID    = { id: 'c2', full_name: 'Mid Fit',    skills: 'React, JavaScript', experience_years: 4, work_authorization: 'US Citizen', current_title: 'Frontend Developer', state: 'TX' };
const WEAK   = { id: 'c3', full_name: 'Weak Fit',   skills: 'COBOL', experience_years: 1, work_authorization: 'H1B', current_title: 'Operator', state: 'NY' };
const BLANK  = { id: 'c4', full_name: 'No Detail' };

// ── 1. ranking ───────────────────────────────────────────────────────────────
{
  const ranked = engine.rankCandidates([WEAK, BLANK, STRONG, MID], JOB);
  ok('every candidate is returned, none dropped', ranked.length === 4, `got ${ranked.length}`);
  ok('best fit ranks first', ranked[0].candidate_id === 'c1', ranked.map(r => r.candidate_id).join(','));
  ok('ranking is strictly descending',
    ranked.slice(0, 3).every((r, i) => i === 0 || r.score <= ranked[i - 1].score),
    ranked.map(r => r.score).join(','));
  // Note "unscoreable" is a property of the JOB, not the candidate: signals fire
  // off the job's fields, so a candidate with no detail still scores (low)
  // whenever the job lists requirements. A job with nothing to match on is what
  // produces null — and then nobody is ranked above anybody.
  const blankRow = ranked.find(r => r.candidate_id === 'c4');
  ok('a candidate with no detail scores low rather than vanishing',
    blankRow && blankRow.score != null && blankRow.score < 25, JSON.stringify(blankRow && blankRow.score));
  ok('a candidate with no detail never outranks a real match',
    ranked.findIndex(r => r.candidate_id === 'c4') > ranked.findIndex(r => r.candidate_id === 'c1'),
    ranked.map(r => `${r.candidate_id}:${r.score}`).join(','));

  const bareJob = { id: 'j2', job_title: '', primary_skills: '', secondary_skills: '' };
  const bareRanked = engine.rankCandidates([STRONG, WEAK], bareJob);
  ok('a job with nothing to match on scores null for everyone (renders "—")',
    bareRanked.every(r => r.score === null), bareRanked.map(r => r.score).join(','));
  ok('null-scoring candidates sort after scored ones',
    engine.rankCandidates([BLANK, STRONG], JOB)[0].candidate_id === 'c1');
  ok('each result carries its plain-English reasons',
    Array.isArray(ranked[0].reasons) && ranked[0].reasons.length >= 4, JSON.stringify(ranked[0].reasons));

  const top2 = engine.rankCandidates([WEAK, BLANK, STRONG, MID], JOB, { limit: 2 });
  ok('limit trims to the top N', top2.length === 2 && top2[0].candidate_id === 'c1');

  const shortlist = engine.rankCandidates([WEAK, BLANK, STRONG, MID], JOB, { minScore: 50 });
  ok('minScore filters out weak and unscoreable',
    shortlist.every(r => r.score >= 50) && !shortlist.some(r => r.candidate_id === 'c4'),
    shortlist.map(r => `${r.candidate_id}:${r.score}`).join(','));

  // Equal scores must not shuffle between reads, or the grid reorders randomly.
  const twin = Object.assign({}, STRONG, { id: 'c5', full_name: 'Aaa Twin' });
  const a = engine.rankCandidates([STRONG, twin], JOB).map(r => r.candidate_id).join(',');
  const b = engine.rankCandidates([twin, STRONG], JOB).map(r => r.candidate_id).join(',');
  ok('equal scores keep a stable order regardless of input order', a === b, `${a} vs ${b}`);

  ok('empty pool is handled', engine.rankCandidates([], JOB).length === 0);
  ok('null pool is handled', engine.rankCandidates(null, JOB).length === 0);
}

// ── 2. experience extraction ─────────────────────────────────────────────────
// Deliberately conservative: a wrong exp_min silently penalises good candidates
// (experience is 20% of the score), so "no idea" must win over "a guess".
{
  const cases = [
    ['7+ years of Java',                       7,    null],
    ['3-7 years of experience',                3,    7   ],
    ['3 to 7 years',                           3,    7   ],
    ['minimum of 8 years',                     8,    null],
    ['at least 6 years',                       6,    null],
    ['7–10 years',                             7,    10  ],  // en dash
    ['no numbers at all here',                 null, null],
    ['99 years',                               null, null],  // parse artefact
    ['',                                       null, null]
  ];
  for (const [text, wantMin, wantMax] of cases) {
    const r = engine.extractExperienceRange(text);
    ok(`experience: "${text.slice(0, 28)}" → ${wantMin}/${wantMax}`,
      r.min === wantMin && r.max === wantMax, `got ${r.min}/${r.max}`);
  }
  const rev = engine.extractExperienceRange('10-3 years');
  ok('a reversed range is corrected, not stored backwards', rev.min === 3 && rev.max === 10, `${rev.min}/${rev.max}`);
}

// ── 3. deriving skills from a JD ─────────────────────────────────────────────
{
  const JD = [
    'Senior Java Developer', '',
    'Required Skills:',
    '- 7+ years of Java and Spring Boot',
    '- Strong experience with AWS and Kubernetes', '',
    'Preferred:', '- Kafka', '- Terraform'
  ].join('\n');

  const derived = engine.deriveJobSkills({ job_description: JD, industry: 'IT' });
  ok('primary skills are derived from the JD', String(derived.primary_skills || '').length > 0, derived.primary_skills);
  ok('Java is found as a leading skill', /java/i.test(derived.primary_skills || ''), derived.primary_skills);
  ok('experience minimum is derived', derived.exp_min === 7, String(derived.exp_min));
  ok('the source is recorded so it is distinguishable from typed input',
    derived.skills_source === 'jd_parser', derived.skills_source);

  // The whole point: a human's typed skills must survive.
  const typed = engine.deriveJobSkills({ job_description: JD, primary_skills: 'Only What I Typed', industry: 'IT' });
  ok('hand-typed primary skills are never overwritten',
    typed.primary_skills === undefined, String(typed.primary_skills));
  const typedExp = engine.deriveJobSkills({ job_description: JD, exp_min: 2, exp_max: 4, industry: 'IT' });
  ok('hand-typed experience is never overwritten',
    typedExp.exp_min === undefined && typedExp.exp_max === undefined, `${typedExp.exp_min}/${typedExp.exp_max}`);

  ok('no description yields nothing rather than throwing',
    Object.keys(engine.deriveJobSkills({})).length === 0);
  ok('a null job order is handled', Object.keys(engine.deriveJobSkills(null)).length === 0);
  // Junk must not throw: the parser is ~1100 lines of regex over pasted text.
  let threw = false;
  try { engine.deriveJobSkills({ job_description: '<<<>>>   ][{}(' .repeat(50) }); } catch { threw = true; }
  ok('malformed description does not throw (a job order must always save)', !threw);
}

// ── 4. the requirement object ────────────────────────────────────────────────
// This is the shape both sourcing branches will search against, so its contract
// matters more than it looks.
{
  const req = engine.buildRequirement({
    job_title: 'Senior Java Developer', primary_skills: 'Java, Spring Boot',
    secondary_skills: 'AWS, Kafka', exp_min: 7, exp_max: 10,
    city: 'Dallas', state: 'TX', country: 'USA', remote: 'No',
    work_auth: 'US Citizen', industry: 'IT', pay_cur: 'USD', pay_min: 60, pay_max: 80
  });
  ok('skills are split into primary/secondary lists',
    req.skills.primary.length === 2 && req.skills.secondary.length === 2, JSON.stringify(req.skills));
  ok('experience is numeric, not string', req.experience.min === 7 && req.experience.max === 10);
  ok('normalized_title is a string, not the parser\'s object',
    req.normalized_title === null || typeof req.normalized_title === 'string', JSON.stringify(req.normalized_title));
  ok('remote is reduced to a boolean', req.location.remote === false, String(req.location.remote));
  ok('free-text remote values are understood',
    engine.buildRequirement({ remote: '100% Remote' }).location.remote === true);
  ok('rate is numeric', req.rate.min === 60 && req.rate.currency === 'USD');
  ok('the requirement is stamped with the engine version', req.version === engine.VERSION);
  ok('an empty job order still produces a valid shape',
    engine.buildRequirement({}).skills.primary.length === 0);
  ok('a null job order does not throw', Boolean(engine.buildRequirement(null)));
  // It goes into JSONB, so it has to survive a round trip.
  let serialisable = true;
  try { JSON.parse(JSON.stringify(req)); } catch { serialisable = false; }
  ok('the requirement serialises cleanly for JSONB', serialisable);
}

// ── 5. THE IMPORTANT ONE: server and browser agree exactly ───────────────────
// Both must load the same file and produce identical numbers. If this fails,
// the grid is showing recruiters a different ranking from the one the server
// sorted by.
let browserChecked = false;
try {
  const { chromium } = await import('playwright-core');
  const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
  const server = http.createServer((req, res) => {
    const file = path.join(PUBLIC_DIR, 'js', '38-match-score.js');
    if (req.url.startsWith('/js/38-match-score.js') && fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><script src="/js/38-match-score.js"></script></body></html>');
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  // Same chromium resolution the rest of the suite uses — the bundled browser
  // version rarely matches whatever playwright-core resolves to.
  const findChromium = () => {
    if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (base && fs.existsSync(path.join(base, 'chromium'))) return path.join(base, 'chromium');
    return 'chromium';
  };
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);

  const cands = [STRONG, MID, WEAK, BLANK];
  const browserScores = await page.evaluate(([cs, job]) =>
    cs.map(c => { const r = window.matchScore(c, job); return { id: c.id, score: r.score, band: r.band, reasons: r.reasons }; }),
  [cands, JOB]);

  const nodeScores = cands.map(c => {
    const r = engine.scoreCandidate(c, JOB);
    return { id: c.id, score: r.score, band: r.band, reasons: r.reasons };
  });

  ok('server and browser produce IDENTICAL scores, bands and reasons',
    JSON.stringify(browserScores) === JSON.stringify(nodeScores),
    `browser=${JSON.stringify(browserScores.map(s => s.score))} node=${JSON.stringify(nodeScores.map(s => s.score))}`);
  ok('the browser globals the pages call still exist',
    await page.evaluate(() => typeof window.matchScore === 'function'
      && typeof window.matchBadge === 'function'
      && typeof window.matchScoreValue === 'function'));
  ok('the shared module reports the same version to both runtimes',
    (await page.evaluate(() => window.MATCH_ENGINE_VERSION)) === scorer.VERSION);

  await browser.close();
  server.close();
  browserChecked = true;
} catch (e) {
  ok('server/browser parity check ran', false, 'playwright unavailable: ' + e.message);
}

console.log('\n=== MATCH ENGINE SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
if (!browserChecked) console.log('\nNOTE: the browser parity check did not run.');
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
