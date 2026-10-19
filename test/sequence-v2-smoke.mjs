// SEQUENCES MADE IN THE NEW BUILDER (R-269/R-270, D-0158/D-0159). The owner: every new sequence is made in the new builder, a
// person keeps many named ones, candidates on a job get one too, with an AI switch. They are stored as workflow definitions, so the
// engine that already sends them keeps doing so. Pinned here, with the REAL fill / sender / check code:
//   * what a step may contain is checked on save (a hole in an email is refused where it can be fixed);
//   * a version is picked at random per person, and never loses its subject;
//   * a candidate step: the written email, or the AI's when the switch is on and it wrote one, the sender filled from the
//     MAILBOX that sends, every field filled — else refused, never sent;
//   * the old window's sequences are not "new builder" ones, so they are left exactly as they are.
// Usage: node test/sequence-v2-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };
const V2 = require('../services/sequence-v2.js');
const { fillTemplate, renderStoredEmail, unresolvedVars } = require('../email-vars.js');

const lead = (cfg) => ({ channel: 'email', config: Object.assign({ builder: 'v2' }, cfg) });
const cand = (cfg) => ({ channel: 'candidate_email', config: Object.assign({ builder: 'v2' }, cfg) });
const BODY = 'Hi {{fn}}, I saw the {{pos}} opening at {{company}} and have two people ready.';

// ── 1. what may be saved ──
step('a lead sequence with details PACE can fill is accepted', V2.problem([lead({ subject: '{{pos}} at {{company}}', body: BODY }), lead({ body: 'Following up on my note, {{fn}}.' })], 'contact') === null);
step('a detail PACE cannot fill is refused, in words, naming it', /PACE cannot fill \{\{favourite_colour\}\}/.test(V2.problem([lead({ subject: 'Hi', body: BODY + ' {{favourite_colour}}' })], 'contact') || ''));
step('a first email with no subject is refused', /needs a subject/.test(V2.problem([lead({ subject: ' ', body: BODY })], 'contact') || ''));
step('a follow-up with no words is refused', /Follow-up 1 has no text/.test(V2.problem([lead({ subject: 'x', body: BODY }), lead({ body: ' ' })], 'contact') || ''));
step('candidates fill from the candidate menu — a LEAD detail ({{fn}}) is refused there', /\{\{fn\}\}/.test(V2.problem([cand({ subject: 'Role', body: 'Hi {{fn}}, a {{position}} role with {{client}} fits you.' })], 'submission') || ''));
step('…and the candidate details pass', V2.problem([cand({ subject: '{{position}}', body: 'Hi {{first_name}}, a {{position}} role with {{client}} in {{location}}. — {{sender}}' })], 'submission') === null);
step('a lead sequence cannot send through the candidate channel (and the reverse)', /sends with "email"/.test(V2.problem([cand({ subject: 'x', body: BODY })], 'contact') || '') && /sends with "candidate_email"/.test(V2.problem([lead({ subject: 'x', body: 'Hi {{first_name}} long enough' })], 'submission') || ''));
step('only the first email may be AI-written, and only for candidates', /Only the first email/.test(V2.problem([cand({ subject: 'x', body: 'Hi {{first_name}}, long enough text.' }), cand({ body: 'nudge', ai: true })], 'submission') || '') && /Your outreach/.test(V2.problem([lead({ subject: 'x', body: BODY, ai: true })], 'contact') || ''));
step('at most two extra versions', /at most 2/.test(V2.problem([lead({ subject: 'x', body: BODY, versions: [{ body: 'a b c d e' }, { body: 'f g h i' }, { body: 'j k l' }] })], 'contact') || ''));
step('steps from the OLD window are not checked here (they keep working exactly as before)', V2.problem([{ channel: 'email', config: { template_key: 'fu1', thread: true } }, { channel: 'bd_touch', config: {} }], 'contact') === null);
step('isV2: only a sequence whose every step the new builder wrote opens in it', V2.isV2({ steps: [lead({}), lead({})] }) && !V2.isV2({ steps: [lead({}), { config: { template_key: 'fu1' } }] }) && !V2.isV2({ steps: [] }));

// ── 2. versions ──
const cfg = { subject: 'Main subject', body: 'Main body', versions: [{ subject: 'Second subject', body: 'Second body' }, { subject: '', body: 'Third body' }] };
step('a version is picked by the random draw (first / second / third)', V2.pickVersion(cfg, () => 0).body === 'Main body' && V2.pickVersion(cfg, () => 0.5).body === 'Second body' && V2.pickVersion(cfg, () => 0.99).body === 'Third body');
step('a version with no subject keeps the step\'s own subject', V2.pickVersion(cfg, () => 0.99).subject === 'Main subject');
step('no versions → the step\'s own words, always', V2.pickVersion({ subject: 'S', body: 'B' }, () => 0.9).body === 'B');
const seen = new Set(); for (let i = 0; i < 300; i++) seen.add(V2.pickVersion(cfg).body);
step('over many people every version is used (not always the first)', seen.size === 3, [...seen].join(' | '));

// ── 3. a candidate step ──
const mailbox = { id: 'mb1', email_address: 'rita@ours.test', display_name: 'Rita Recruiter' };
const vars = { first_name: 'Jordan', full_name: 'Jordan Reyes', title: 'Site Engineer', location: 'Houston, TX', position: 'Project Engineer', client: 'Acme', company: 'Acme', job_code: '' };
const io = (aiResult) => ({ fill: fillTemplate, unresolved: unresolvedVars, rand: () => 0,
  render: (m) => renderStoredEmail({ subject: m.subject, body: m.body, from_email: mailbox.email_address }, mailbox),
  aiWrite: async () => { io.calls = (io.calls || 0) + 1; if (aiResult instanceof Error) throw aiResult; return aiResult; } });
const written = { builder: 'v2', subject: '{{position}} in {{location}}', body: 'Hi {{first_name}},\nA {{position}} role with {{client}} fits you.\n{{sender}}' };
let r = await V2.composeCandidateStep({ cfg: written, defaults: { subject: 'd', body: 'd' }, vars, hasJob: true }, io(null));
step('switch OFF: the written email, filled for this candidate', r.ok && r.subject === 'Project Engineer in Houston, TX' && /Hi Jordan,/.test(r.body) && /with Acme fits you/.test(r.body) && r.writtenBy === 'written', JSON.stringify(r));
step('…and "{{sender}}" is the name of the MAILBOX that sends (this path never filled it before)', /Rita Recruiter/.test(r.body) && !/\{\{sender\}\}/.test(r.body), r.body);
const aiOk = { subject: 'Project Engineer role in Houston', prose: 'Hi Jordan,\nYour site work fits a Project Engineer role.', panelHtml: '<table>job</table>' };
r = await V2.composeCandidateStep({ cfg: Object.assign({ ai: true }, written), defaults: {}, vars, hasJob: true }, io(aiOk));
step('switch ON and the AI wrote one: the AI\'s email goes, with the job panel', r.ok && r.writtenBy === 'ai' && r.subject === aiOk.subject && /site work/.test(r.body) && r.panelHtml === '<table>job</table>', JSON.stringify(r));
r = await V2.composeCandidateStep({ cfg: Object.assign({ ai: true }, written), defaults: {}, vars, hasJob: true }, io(null));
step('switch ON but the AI could not (no key, no credit, failed the check): the written email goes — never a blank', r.ok && r.writtenBy === 'written' && /Hi Jordan,/.test(r.body));
r = await V2.composeCandidateStep({ cfg: Object.assign({ ai: true }, written), defaults: {}, vars, hasJob: true }, io(new Error('provider down')));
step('…and an AI that throws is the same as one that could not', r.ok && r.writtenBy === 'written');
const before = io.calls;
r = await V2.composeCandidateStep({ cfg: Object.assign({ ai: true }, written), defaults: {}, vars, hasJob: false }, io(aiOk));
step('no job attached: the AI is not asked (it writes about a job)', r.ok && r.writtenBy === 'written' && io.calls === before, 'calls ' + before + '→' + io.calls);
r = await V2.composeCandidateStep({ cfg: { builder: 'v2', subject: 'Hi', body: 'Hi {{first_name}}, about {{shoe_size}}.' }, defaults: {}, vars, hasJob: true }, io(null));
step('a field PACE cannot fill is REFUSED at send, never sent with the hole', !r.ok && /\{\{shoe_size\}\}/.test(r.error), JSON.stringify(r));
r = await V2.composeCandidateStep({ cfg: { builder: 'v2', subject: 'S', body: 'Main for {{first_name}}', versions: [{ subject: '', body: 'Other for {{first_name}}' }] }, defaults: {}, vars, hasJob: true }, Object.assign(io(null), { rand: () => 0.99 }));
step('a candidate gets a version at random too, filled', r.ok && r.body === 'Other for Jordan' && r.subject === 'S', JSON.stringify(r));

// ── 3b. the REAL candidate writer, as a sequence uses it (rules brief — no AI key here) ──
const CB = require('../services/candidate-brief.js');
const match = require('../match-engine.js');
const job = { id: 'jo1', job_title: 'Project Engineer', client: 'Acme Construction', city: 'Houston', state: 'TX', location: 'Houston, TX',
  description: 'Lead site work for commercial builds. Requirements: 5+ years of construction project engineering, AutoCAD, scheduling.', skills: ['AutoCAD', 'scheduling', 'construction'], pay_rate_min: 85000, pay_rate_max: 105000 };
const person = { id: 'c1', full_name: 'Jordan Reyes', first_name: 'Jordan', email: 'jordan@example.test', current_title: 'Site Engineer', city: 'Houston', state: 'TX', skills: ['AutoCAD', 'scheduling'], experience_years: 6 };
const brief = CB.cachedBrief(job);
step('a job with no saved brief gets the rules brief (cached:false — a sequence then writes and caches one)', brief && brief.cached === false && !!String(brief.hook || '').trim(), JSON.stringify(brief).slice(0, 160));
const em = CB.candidateEmailFor({ candidate: person, job, brief, companyName: 'Fute Global', signature: '', rank: match.rankCandidates });
step('the real writer gives this candidate a checked email: subject, words, and the job panel', em && em.subject && /Jordan/.test(em.prose) && em.panelHtml.length > 0, JSON.stringify(em || {}).slice(0, 220));
step('…with no answer buttons (a sequence email is answered by replying)', em && !/interested|not-interested|\/i\//.test(em.panelHtml));
step('a cached AI brief is used as it is', CB.cachedBrief(Object.assign({}, job, { outreach_brief: JSON.stringify({ hook: 'Commercial builds in Houston', detail: 'Site-led role' }), outreach_brief_engine: 'groq' })).engine === 'groq');

// ── 4. the send paths use the rule (and the lead path picks versions) ──
const fs = require('fs');
const idx = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
step('the leads "email" step picks a version when the step has them', /sequenceV2\.pickVersion\(cfg\)/.test(idx));
step('the leads "email" step threads follow-ups 1–5 as replies', /cfg\.thread && \/\^fu\[1-5\]\$\/\.test\(key\)/.test(idx));
const out = fs.readFileSync(new URL('../routes/recruiting/outreach.js', import.meta.url), 'utf8');
step('the candidate step sends what composeCandidateStep decides', /sequenceV2\.composeCandidateStep\(/.test(out));

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
