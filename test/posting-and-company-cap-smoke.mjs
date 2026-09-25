// D-0046: (a) R-056 — the job posting the AI writes from, pasted on the lead
// row; (b) at most N first emails to one company per day.
//   * the screen's "the AI has the posting" uses the AI's own thin rule;
//   * pasting keeps every other research field and the Title line;
//   * POST /jobs/:id/posting — the assigned BD may, an unrelated BD may not,
//     another org's lead is 404 (real handler, in-memory db);
//   * the company cap: first emails only, per company, 0 = off, counts what
//     already went today (any sender) — the loader RUN against fake tables;
//   * the send loop consults it after the window check and before the claim,
//     and counts each successful first email (source check: the loop itself
//     cannot run offline).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const lp = require('../services/lead-posting.js');
const engineDraft = require('../services/engine-draft.js');
const cap = require('../services/company-daily-cap.js');

// ── (a) posting, pure ──────────────────────────────────────────────────────
const posting = 'We are hiring a Commercial HVAC Lead Installer to run a crew of four on rooftop units and VRF systems. EPA 608 Universal required, OSHA 30 preferred. ' +
  'You will read mechanical drawings, coordinate with the GC and sign off start-ups. Pay $32-38/hr plus overtime, company truck. Monday to Friday, 6am starts.';
let st = lp.postingState({ position: 'HVAC Lead Installer', research: { jd_raw: 'Title: HVAC Lead Installer' } });
step('title only → "the AI only knows the title"', st.has_posting === false && st.chars === 0);
const r1 = lp.withPosting({ jd_raw: 'Title: HVAC Lead Installer', company: { notes: 'keep me' }, suggested_skills: ['EPA'] }, 'HVAC Lead Installer', posting);
st = lp.postingState({ position: 'HVAC Lead Installer', research: r1 });
step('a pasted posting → "the AI has the posting"', st.has_posting === true && st.words > 30, JSON.stringify(st));
step('…agreeing with the AI writer\'s own thin rule', engineDraft.engineInput({ job: { position: 'HVAC Lead Installer', research: r1, company: { name: 'Miller' } }, contact: { first_name: 'Ben' }, sender: {} }).thin_posting === false);
step('pasting keeps every other research field', r1.company.notes === 'keep me' && r1.suggested_skills[0] === 'EPA');
step('…and the Title line first, as the importer writes it', /^Title: HVAC Lead Installer\n\nWe are hiring/.test(r1.jd_raw));
step('a research value stored as a JSON string is read, not lost', lp.postingState({ position: 'X', research: JSON.stringify(r1) }).has_posting === true);
step('a very long paste is cut at the cap, never refused', lp.withPosting({}, 'X', 'a'.repeat(20000)).jd_raw.length <= lp.POSTING_MAX_CHARS + 20);
step('clearing it goes back to title-only', lp.withPosting(r1, 'HVAC Lead Installer', '  ').jd_raw === 'Title: HVAC Lead Installer');

// ── (a) the route ─────────────────────────────────────────────────────────
const T = { jobs: [
  { id: 'j1', org_id: 'o1', position: 'HVAC Lead Installer', research: { jd_raw: 'Title: HVAC Lead Installer' }, created_by: 'u-ra', assigned_to: null, assigned_to_bd: 'u-bd', deleted_at: null },
  { id: 'j2', org_id: 'o2', position: 'Other org', research: null, created_by: 'x', assigned_to_bd: 'u-bd', deleted_at: null },
] };
function q(table) {
  const f = []; let upd = null;
  const api = {
    select() { return api; }, eq(k, v) { f.push(r => r[k] === v); return api; }, is(k, v) { f.push(r => (r[k] == null) === (v == null)); return api; },
    update(p) { upd = p; return api; },
    async maybeSingle() { const rows = T[table].filter(r => f.every(fn => fn(r))); if (upd) rows.forEach(r => Object.assign(r, upd)); return { data: rows[0] || null, error: null }; },
    async single() { return api.maybeSingle(); },
  };
  return api;
}
const supabase = { from: q };
const { hasRole, canTouchJob } = require('../middleware/authorize.js')({ supabase });
const router = require('../routes/jobs.js')({
  supabase, auth: (_a, _b, n) => n(), hasRole, canTouchJob, withOrg: (query, req) => query.eq('org_id', req.orgId),
  orgIdFor: (req) => req.orgId, orgStamp: () => ({}), today: () => '2026-09-25', logActivity: () => {}, loadAllJobs: async () => [],
  JOB_SELECT: '*', getTimezoneFromLocation: () => 'EST', persistLearnedSkills: () => {},
});
const layer = router.stack.find(l => l.route && l.route.path === '/jobs/:id/posting' && l.route.methods.post);
step('POST /jobs/:id/posting exists', !!layer);
const h = layer.route.stack.slice(-1)[0].handle;
const call = async (id, user, text) => { let status = 200, out; const res = { status(s) { status = s; return res; }, json(j) { out = j; return res; } }; await h({ params: { id }, body: { text }, user, orgId: 'o1' }, res); return { status, out }; };
let r = await call('j1', { id: 'u-other', roles: ['bd'] }, posting);
step('a BD who does not work this lead cannot change its posting', r.status === 403 && /Title: HVAC Lead Installer$/.test(T.jobs[0].research.jd_raw));
r = await call('j1', { id: 'u-bd', roles: ['bd'] }, posting);
step('the assigned BD can paste it (the person whose email it is)', r.status === 200 && r.out.posting.has_posting === true && /EPA 608/.test(T.jobs[0].research.jd_raw));
r = await call('j2', { id: 'u-bd', roles: ['bd'] }, posting);
step('another company\'s lead reads as 404', r.status === 404 && T.jobs[1].research === null);
r = await call('j1', { id: 'u-rl', roles: ['ra_lead'] }, 'short');
step('an RA Lead may too', r.status === 200 && r.out.posting.has_posting === false);

// ── (b) the company cap, pure ──────────────────────────────────────────────
const first = { followup_type: null }, fu = { followup_type: 'fu1' };
step('under the cap → goes', cap.capCheck({ email: first, companyId: 'c1', counts: { c1: 1 }, cap: 2 }).blocked === false);
step('at the cap → a third contact waits', cap.capCheck({ email: first, companyId: 'c1', counts: { c1: 2 }, cap: 2 }).blocked === true);
step('follow-ups are never held by it', cap.capCheck({ email: fu, companyId: 'c1', counts: { c1: 9 }, cap: 2 }).blocked === false);
step('0 turns it off', cap.capCheck({ email: first, companyId: 'c1', counts: { c1: 9 }, cap: 0 }).blocked === false);
step('no company on the lead → never held', cap.capCheck({ email: first, companyId: null, counts: {}, cap: 2 }).blocked === false);
step('the wait says why, in words', /2 people at this company already emailed today — goes tomorrow/.test(cap.waitSentence(2)));

// ── (b) the loader, run against fake tables ────────────────────────────────
const F = {
  jobs: [{ id: 'a1', company_id: 'c1' }, { id: 'a2', company_id: 'c1' }, { id: 'b1', company_id: 'c2' }],
  emails: [
    { job_id: 'a1', status: 'sent', sent_at: '2026-09-25', followup_type: null },
    { job_id: 'a2', status: 'sent', sent_at: '2026-09-25', followup_type: 'initial' },   // other lead, same company
    { job_id: 'a1', status: 'sent', sent_at: '2026-09-25', followup_type: 'fu1' },       // follow-up: not counted
    { job_id: 'a1', status: 'sent', sent_at: '2026-09-24', followup_type: null },        // yesterday: not counted
    { job_id: 'b1', status: 'pending', sent_at: null, followup_type: null },             // not sent
  ],
};
const fake = { from(t) { const f = []; const api = { select() { return api; }, eq(k, v) { f.push(r => r[k] === v); return api; }, in(k, vs) { f.push(r => vs.includes(r[k])); return api; }, then(a, b) { return Promise.resolve({ data: F[t].filter(r => f.every(fn => fn(r))) }).then(a, b); } }; return api; } };
const counts = await cap.loadSentToday(fake, ['c1', 'c2', null], '2026-09-25');
step('counts today\'s first emails per COMPANY, across its leads', counts.c1 === 2, JSON.stringify(counts));
step('…not follow-ups, not yesterday, not unsent', !counts.c2 && counts.c1 === 2);

// ── (b) wired into the send loop ───────────────────────────────────────────
const SRC = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const loop = SRC.slice(SRC.indexOf('async function processPendingEmailSends'), SRC.indexOf('async function processPendingEmailSends') + 16000);
const iWin = loop.indexOf('if (!isInLeadSendWindow(leadTz, new Date(), sendWindow))');
const iCap = loop.indexOf('companyDailyCap.capCheck(');
const iClaim = loop.indexOf(".update({ status: 'sending' })");
const iBump = loop.indexOf('companySentToday[email.job.company_id] = ');
const iSent = loop.indexOf("update({ status: 'sent', sent_at: today() })");
step('the send loop asks the rule after the window check and before claiming', iWin > 0 && iCap > iWin && iClaim > iCap, [iWin, iCap, iClaim].join(','));
step('…and counts a first email only after it was really sent', iBump > iSent && iSent > 0);
step('the pending lists carry the lead\'s company', (SRC.match(/job:jobs\(timezone, company_id, sending_email_id/g) || []).length >= 2);

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
