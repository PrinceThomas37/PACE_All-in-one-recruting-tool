// D-0077 — a sequence's email step, server side:
//   * `initial` is the person's Outreach 1 (stored as `o1`): the live "Standard
//     Sales Outreach" step 1 used to look up `initial_*`, which never existed,
//     and ended in `No template for key "initial"`;
//   * a step's OWN subject/body beats every saved template;
//   * the AI writer: a short instruction becomes a template in merge fields,
//     held to a checker; no AI / a draft that breaks a rule → a ready-made
//     starter that SAYS it is one; the rules writer passes its own checker;
//   * POST /wf/draft-email: who may use it, the budget name, the clipping.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const st = require('../services/sequence-templates.js');
const sd = require('../services/sequence-draft.js');
const { DEFAULT_TEMPLATES } = require('../email-vars.js');

// ── 1. which template a step sends ─────────────────────────────────────────
step('"initial" is stored as the person\'s Outreach 1 (o1); fu1/fu2 are themselves', st.slotFor('initial') === 'o1' && st.slotFor('fu1') === 'fu1' && st.slotFor('fu2') === 'fu2' && st.slotFor(undefined) === 'o1');
step('the four settings read for a step use that slot, most specific first',
  st.settingKeys('u9', 'initial').join() === 'u_u9_tmpl_o1_subject,u_u9_tmpl_o1_body,template_o1_subject,template_o1_body');
const pass = (v) => v;
let p = st.pickTemplate({ cfg: { template_key: 'initial' }, bdId: 'u9', settings: {}, defaults: DEFAULT_TEMPLATES, resolve: pass });
step('REGRESSION: with nothing saved, step 1 ("initial") now sends the built-in Outreach 1 — it used to fail with "No template"', p.subject === DEFAULT_TEMPLATES.o1_subject && p.body === DEFAULT_TEMPLATES.o1_body && !p.error, JSON.stringify(p).slice(0, 80));
p = st.pickTemplate({ cfg: { template_key: 'initial' }, bdId: 'u9', settings: { u_u9_tmpl_o1_subject: 'Mine {{pos}}', u_u9_tmpl_o1_body: 'My words {{fn}}', template_o1_subject: 'Org subject', template_o1_body: 'Org body' }, defaults: DEFAULT_TEMPLATES, resolve: pass });
step('the person\'s OWN Outreach 1 beats the organisation\'s and the default', p.subject === 'Mine {{pos}}' && p.body === 'My words {{fn}}');
p = st.pickTemplate({ cfg: { template_key: 'initial' }, bdId: 'u9', settings: { template_o1_subject: 'Org subject', template_o1_body: 'Org body' }, defaults: DEFAULT_TEMPLATES, resolve: pass });
step('…then the organisation\'s global one', p.subject === 'Org subject');
p = st.pickTemplate({ cfg: { template_key: 'fu1', subject: 'Step subject', body: 'Step body' }, bdId: 'u9', settings: { u_u9_tmpl_fu1_subject: 'Saved', u_u9_tmpl_fu1_body: 'Saved' }, defaults: DEFAULT_TEMPLATES, resolve: pass });
step('a step\'s OWN words beat every saved template', p.subject === 'Step subject' && p.body === 'Step body');
p = st.pickTemplate({ cfg: { template_key: 'nope' }, bdId: 'u9', settings: {}, defaults: DEFAULT_TEMPLATES, resolve: pass });
step('an unknown template says what to do, in plain words — not a code', /no template called "nope"/.test(p.error || '') && /Outreach 1/.test(p.error));
step('the dropdown offers exactly Outreach 1, Follow-up 1, Follow-up 2, and each resolves', st.TEMPLATE_CHOICES.length === 3 && st.TEMPLATE_CHOICES.every(c => !st.pickTemplate({ cfg: { template_key: c.key }, bdId: 'x', settings: {}, defaults: DEFAULT_TEMPLATES, resolve: pass }).error));

// ── 2. the checker ─────────────────────────────────────────────────────────
const ok = (subject, body) => sd.checkDraft({ subject, body });
const GOOD = 'Hi {{fn}},\n\nI saw {{company}} is hiring a {{pos}} in {{loc}}. I have a couple of people who could fit.\n\nWould you like their resumes?';
step('a plain draft in known merge fields passes', ok('Candidates for your {{pos}} role', GOOD).ok);
step('a field PACE cannot fill is named and refused (a send would be refused too)', /\{\{salary\}\}, which PACE cannot fill/.test(ok('Hi', GOOD + ' {{salary}}').violations.join()));
step('synonyms PACE does fill are fine ({{first_name}}, {{company_name}})', ok('S', 'Hi {{first_name}}, about {{company_name}} and the {{job_title}} role — would you like to talk this week?').ok);
step('[square-bracket] placeholders are refused', ok('S', GOOD + ' [Your Name]').violations.some(x => /square-bracket/.test(x)));
step('a hard-coded company name is refused (the customer\'s name comes from the signature)', ok('S', GOOD + ' — Fute Global').violations.some(x => /specific company/.test(x)));
step('invented numbers are refused: a percentage, an amount', ok('S', GOOD + ' Our fee is 15% only.').violations.some(x => /percentage/.test(x)) && ok('S', GOOD + ' Save $5000 today.').violations.some(x => /amount of money/.test(x)));
step('empty / far too short / far too long are refused', !ok('', GOOD).ok && !ok('S', 'Hi').ok && !ok('S', 'x'.repeat(1600)).ok);
step('THE RULES WRITER PASSES ITS OWN CHECKER: all three starters', ['first', 'followup', 'final'].every(k => sd.checkDraft(sd.starterFor(k)).ok));
step('…and no starter names a company or signs off', ['first', 'followup', 'final'].every(k => !/fut[eé]|global|sincerely|regards/i.test(JSON.stringify(sd.starterFor(k)))));

// ── 3. reading the AI's answer ─────────────────────────────────────────────
step('JSON is read, even with chatter around it', sd.parseDraft('Sure! {"subject":"Hi {{fn}}","body":"Line one\\n\\nLine two"} hope that helps').body === 'Line one\n\nLine two');
step('"Subject: … Body: …" is read too', sd.parseDraft('Subject: Hello\nBody: Hi there').subject === 'Hello');
step('nonsense is not guessed at', sd.parseDraft('no idea') === null && sd.parseDraft('') === null);

// ── 4. the whole job, with a fake AI ───────────────────────────────────────
const ai = (...texts) => { const calls = []; const f = async (system, prompt) => { calls.push({ system, prompt }); const t = texts[Math.min(calls.length - 1, texts.length - 1)]; return t == null ? null : { text: t }; }; f.calls = calls; return f; };
const j = (subject, body) => JSON.stringify({ subject, body });
let c = ai(); let r = await sd.draft({ complete: c, prompt: '', purpose: 'first' });
step('no instruction → a starter, no AI call at all', r.source === 'starter' && c.calls.length === 0 && /ready-made starter/.test(r.note));
c = ai(null); r = await sd.draft({ complete: c, prompt: 'a friendly intro', purpose: 'first' });
step('AI unavailable (null) → the starter, and it SAYS so', r.source === 'starter' && /not available right now/.test(r.note) && r.subject === sd.starterFor('first').subject);
c = ai(j('Estimators for {{company}}', GOOD)); r = await sd.draft({ complete: c, prompt: 'offer two estimators', purpose: 'first' });
step('a good draft is used as written, labelled AI, with "read it before you save"', r.source === 'ai' && r.subject === 'Estimators for {{company}}' && /read it before you save/.test(r.note) && c.calls.length === 1);
step('the prompt carries the house rules and the person\'s words', /ONLY those fields/.test(c.calls[0].system) && /Do NOT sign off/.test(c.calls[0].system) && /offer two estimators/.test(c.calls[0].prompt) && /first email/.test(c.calls[0].prompt));
c = ai(j('S', GOOD + ' {{salary}}'), j('S', GOOD)); r = await sd.draft({ complete: c, prompt: 'x', purpose: 'followup' });
step('a draft that breaks a rule gets ONE repair turn, naming the rule — and the repaired one is used', r.source === 'ai' && c.calls.length === 2 && /\{\{salary\}\}/.test(c.calls[1].prompt));
c = ai(j('S', GOOD + ' [Name]'), j('S', GOOD + ' [Name] {{salary}}')); r = await sd.draft({ complete: c, prompt: 'x', purpose: 'final' });
step('a draft still broken after the repair is NOT shipped: the starter, with the reason', r.source === 'starter' && /broke a rule/.test(r.note) && /square-bracket/.test(r.note) && c.calls.length === 2);
c = ai('I cannot help with that'); r = await sd.draft({ complete: c, prompt: 'x', purpose: 'first' });
step('an unreadable answer → starter, said plainly', r.source === 'starter' && /could not be read/.test(r.note));
r = await sd.draft({ complete: async () => { throw new Error('boom'); }, prompt: 'x', purpose: 'first' });
step('a provider that throws is the same as none — never an error to the person', r.source === 'starter');
step('an unknown purpose falls back to a first email', sd.purposeOf('whatever') === 'first' && sd.purposeOf('final') === 'final');

// ── 5. THE ENDPOINT ────────────────────────────────────────────────────────
const aiProvider = require('../services/ai-provider.js');
let seen = null, reply = null;
aiProvider.complete = async (_sb, opts) => { seen = opts; return reply; };
const routes = {};
const routerFn = require('../routes/wf.js');
const router = routerFn({ supabase: { from: () => ({ select() { return this; }, eq() { return this; }, then(r) { return Promise.resolve({ data: [], error: null }).then(r); } }) }, auth: (_a, _b, n) => n(), hasRole: (req, ...r) => r.some(x => (req.user.roles || []).includes(x)), engine: {}, logActivity: async () => {} });
const h = router.stack.find(l => l.route && l.route.path === '/wf/draft-email' && l.route.methods.post).route.stack.slice(-1)[0].handle;
const call = async (roles, body) => { let out, code = 200; const res = { status(x) { code = x; return res; }, json(x) { out = x; return res; } }; await h({ user: { id: 'u', roles }, orgId: 'o1', body }, res); return { code, out }; };
let x = await call(['ra'], { prompt: 'hi', purpose: 'first' });
step('a research analyst cannot use it (same gate as designing a sequence)', x.code === 403 && seen === null);
reply = { text: j('Hello {{fn}}', GOOD) };
x = await call(['bd_lead'], { prompt: 'p'.repeat(900), purpose: 'followup' });
step('a BD lead can; it asks the provider under its OWN budget name, for this org, with the instruction clipped to 600', x.code === 200 && seen.feature === 'sequence_draft' && seen.orgId === 'o1' && seen.prompt.length < 800 && /followup|a follow-up/.test(seen.prompt), JSON.stringify({ f: seen.feature, n: seen.prompt.length }));
step('…and answers with the draft, its source and the purpose', x.out.source === 'ai' && x.out.purpose === 'followup' && x.out.subject === 'Hello {{fn}}');
reply = null;
x = await call(['admin'], { prompt: 'something', purpose: 'bogus' });
step('no AI → still 200, a starter, and an honest note (never a 500)', x.code === 200 && x.out.source === 'starter' && /not available/.test(x.out.note) && x.out.purpose === 'first');
step('the budget knows the feature (a named allowance, not the tightest default)', require('../services/ai-budget.js').featureLimits('sequence_draft').label === 'Sequence email drafts');

const failed = results.filter(v => !v).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
