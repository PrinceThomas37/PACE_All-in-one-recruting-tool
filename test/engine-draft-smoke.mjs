// The engine's FIRST email is AI-written at send time (D-0032), checked like
// the Generator's, stored with {{sender}} tokens, and the template is the
// fallback for every way that can go wrong. A stand-in `complete` replaces the
// provider, so this runs offline.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../services/engine-draft.js');
const gen = require('../services/outreach-generator.js');
const budget = require('../services/ai-budget.js');
const settings = require('../config/settings.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }

const job = { position: 'Assistant Facilities Maintenance Technician', location: 'Birmingham, AL',
  research: { jd_raw: 'Title: Assistant Facilities Maintenance Technician' }, company: { name: 'CSF Co' } };
const contact = { first_name: 'Bruce', designation: 'Facilities Manager' };
const sender = { name: 'Prince Thomas', email: 'prince.thomas@futeglobal.com' };
const input = D.engineInput({ job, contact, sender });

const GOOD = {
  subject: 'Maintenance technician for CSF Co',
  email: 'Hi Bruce,\n\nThis is Prince Thomas at Fute Global. I saw CSF Co is hiring an Assistant Facilities Maintenance Technician in Birmingham.\n\nWe work with maintenance technicians in the area who are open to a move, and I can send a few resumes over for you to look at. There is nothing to set up on your side.\n\nWould it help to see a few resumes?\n\nThere is no charge for reviewing resumes. We only charge a fee on a successful placement.\n\nThanks,',
  diagnosis: 'Title only; kept it plain.'
};
const reply = (o) => ({ text: JSON.stringify(o), usage: { input_tokens: 1700, output_tokens: 230 } });
const run = (answers) => { let i = 0; const calls = []; return {
  calls, complete: async (system, prompt) => { calls.push(prompt); const a = answers[i++]; return typeof a === 'function' ? a() : a; } }; };

console.log('\nEngine draft — input');
await t('a title-only lead is marked thin, and carries the reader and role', () => {
  assert.equal(input.thin_posting, true);
  assert.equal(input.job_title, job.position);
  assert.equal(input.contact_title, 'Facilities Manager');
  assert.equal(input.company, 'CSF Co');
});
await t('a real posting is not thin', () => {
  const rich = D.engineInput({ job: { ...job, research: { jd_raw: 'x'.repeat(400) } }, contact, sender });
  assert.equal(rich.thin_posting, false);
});
await t('no first name or no company → no AI call at all', async () => {
  assert.equal(D.engineInput({ job, contact: {}, sender }), null);
  const r = run([reply(GOOD)]);
  const out = await D.draftFirstEmail({ gen, complete: r.complete, input: null, companyName: 'Fute Global', omitSignOff: true });
  assert.equal(out.skipped, 'missing_contact_or_company'); assert.equal(r.calls.length, 0);
});
await t('only first emails qualify; follow-ups stay templates', () => {
  assert.equal(D.isFirstEmail({ followup_type: null }), true);
  assert.equal(D.isFirstEmail({ followup_type: 'initial' }), true);
  assert.equal(D.isFirstEmail({ followup_type: 'fu1' }), false);
  assert.equal(D.isFirstEmail({ followup_type: 'fu2' }), false);
});
await t('the prompt tells the model the posting is only a title', () => {
  assert.match(gen.buildUserPayload(input), /ONLY THE JOB TITLE IS KNOWN/);
  assert.doesNotMatch(gen.buildUserPayload({ ...input, thin_posting: false }), /ONLY THE JOB TITLE IS KNOWN/);
});

console.log('\nEngine draft — outcomes');
await t('a good draft is returned with the sender put back into {{tokens}}', async () => {
  const r = run([reply(GOOD)]);
  const out = await D.draftFirstEmail({ gen, complete: r.complete, input, companyName: 'Fute Global', omitSignOff: true });
  assert.ok(out.body, JSON.stringify(out));
  assert.match(out.body, /This is \{\{sender\}\} at Fute Global/);
  assert.doesNotMatch(out.body, /Prince Thomas/);
  assert.equal(r.calls.length, 1);
});
await t('a title-only draft is not rejected for being short (no demand to invent)', () => {
  const SHORT = { ...GOOD, email: 'Hi Bruce,\n\nThis is Prince Thomas at Fute Global. I saw CSF Co is hiring an Assistant Facilities Maintenance Technician in Birmingham.\n\nWould it help to see a few resumes?\n\nThere is no charge for reviewing resumes. We only charge a fee on a successful placement.\n\nThanks,' };
  const words = gen.wordCount(SHORT.email);
  assert.ok(words >= 35 && words < 60, 'sample must sit between the two floors, got ' + words);
  assert.equal(gen.checkDraft(SHORT, input, { omitSignOff: true }).violations.some(v => v.code === 'too_short'), false);
  assert.equal(gen.checkDraft(SHORT, { ...input, thin_posting: false }, { omitSignOff: true }).violations.some(v => v.code === 'too_short'), true);
});
await t('AI unavailable → template (skipped), never an error', async () => {
  const out = await D.draftFirstEmail({ gen, complete: run([null]).complete, input, companyName: 'X', omitSignOff: true });
  assert.equal(out.skipped, 'ai_unavailable');
});
await t('unparseable answer → template', async () => {
  const out = await D.draftFirstEmail({ gen, complete: run([{ text: 'sorry, no' }]).complete, input, companyName: 'X', omitSignOff: true });
  assert.equal(out.skipped, 'ai_unparseable');
});
await t('a rule-breaking draft gets ONE repair, then the template wins', async () => {
  const bad = { ...GOOD, email: GOOD.email.replace('Would it help to see a few resumes?', 'Can we set up a quick call this week? Our fee is 20%!') };
  const r = run([reply(bad), reply(bad)]);
  const out = await D.draftFirstEmail({ gen, complete: r.complete, input, companyName: 'Fute Global', omitSignOff: true });
  assert.equal(out.skipped, 'draft_rejected'); assert.equal(r.calls.length, 2);
});
await t('a repair that fixes the draft is taken', async () => {
  const bad = { ...GOOD, email: GOOD.email + '\n\nPrince Thomas' };
  const r = run([reply(bad), reply(GOOD)]);
  const out = await D.draftFirstEmail({ gen, complete: r.complete, input, companyName: 'Fute Global', omitSignOff: true });
  assert.ok(out.body, JSON.stringify(out)); assert.equal(out.repaired, true);
});

console.log('\nEngine draft — wiring');
const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
await t('the send loop asks AI only for first emails not already AI-written, when switched on', () => {
  assert.match(idx, /aiFirstEmailOn && engineDraft\.isFirstEmail\(email\) && email\.template_variant !== 'ai'/);
  assert.match(idx, /for \(let email of ordered\)/, 'loop variable must be reassignable');
});
await t('the draft is stored before it is sent, and unstored text is never sent', () => {
  const fn = idx.slice(idx.indexOf('async function aiWriteFirstEmail'), idx.indexOf('function retryNote'));
  assert.match(fn, /update\(upd\)\.eq\('id', email\.id\)[\s\S]*if \(error\) return email;/);
  assert.match(fn, /feature: 'engine_first_email'/);
});
await t('the draft happens after the claim and before delivery', () => {
  const claim = idx.indexOf("from('emails').update({ status: 'sending' })");
  const draft = idx.indexOf('email = await aiWriteFirstEmail(');
  const send = idx.indexOf('const graph = await deliverOutboundEmail(email, userEmailId');
  assert.ok(claim > 0 && draft > claim && send > draft);
});
await t('budget feature and on/off setting exist, setting defaults ON', () => {
  assert.ok(budget.FEATURES ? budget.FEATURES.engine_first_email : readFileSync(new URL('../services/ai-budget.js', import.meta.url), 'utf8').includes('engine_first_email:'));
  const def = settings.SETTINGS_SCHEMA.find(s => s.key === 'engine_ai_first_email');
  assert.ok(def); assert.equal(def.default, 1); assert.equal(def.max, 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
