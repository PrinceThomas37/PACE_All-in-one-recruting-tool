// WORDING PER EMAIL ID (R-176, D-0111) — the owner (8 Oct): "the outreach template that goes out is not particular for from email ID,
// just the signature is … can we differentiate that part too", and "an option to select one email for all … or individual".
// Proven here, pure and through the real builders / routes:
//   * services/wording-scope.js — precedence (email ID's own → person's → global), dormant unless the person chose "each",
//     a blank never wins, the bar for "has a first email of its own"
//   * services/lead-outreach-queue.js — each lead's FIRST email is written in the wording of the email ID it goes out from;
//     with "all" nothing changes; an email ID with none falls back to the person's; with no wording anywhere it is reported
//   * services/sequence-templates.js — a sequence step picks by the rotated email ID, the step's own text still wins
//   * POST/GET /outreach-plan(/mailbox(es)) — only my own email IDs, only the six texts, "" clears, scope is "all" or "each"
// Usage: node test/wording-scope-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const W = require('../services/wording-scope.js');
const { buildPendingEmailsFromJobs } = require('../services/lead-outreach-queue.js');
const seqT = require('../services/sequence-templates.js');
const FT = require('../services/followup-thread.js');

const A = 'Hello {{fn}}, this is the COMPANY-A pitch for the {{pos}} role — we at Alpha Staffing would love to help you hire quickly.';
const B = 'Hi {{fn}}, Beta Recruiters here about your {{pos}} opening — a completely different pitch from a different company altogether.';
const P = 'Dear {{fn}}, the PERSON-LEVEL wording about {{pos}} that every email ID shares when nothing more specific exists.';
const base = { 'u_bd_tmpl_o1_subject': 'Person subject', 'u_bd_tmpl_o1_body': P };
const each = { ...base, 'u_bd_tmpl_scope': 'each', 'ue_m1_tmpl_o1_subject': 'Alpha subject', 'ue_m1_tmpl_o1_body': A, 'ue_m2_tmpl_o1_subject': 'Beta subject', 'ue_m2_tmpl_o1_body': B };

// ── 1. the pure rules ───────────────────────────────────────────────────────
step('with "all" (the default) an email ID\'s own text is dormant — the person\'s wording is used, as it always was', W.pickRaw({ ...each, 'u_bd_tmpl_scope': 'all' }, { userId: 'bd', mailboxId: 'm1', field: 'tmpl_o1_body' }) === P && W.pickRaw(base, { userId: 'bd', mailboxId: 'm1', field: 'tmpl_o1_body' }) === P);
step('with "each" an email ID uses ITS wording', W.pickRaw(each, { userId: 'bd', mailboxId: 'm1', field: 'tmpl_o1_body' }) === A && W.pickRaw(each, { userId: 'bd', mailboxId: 'm2', field: 'tmpl_o1_body' }) === B);
step('…an email ID with none (or only blanks) falls back to the person\'s — never a blank page', W.pickRaw(each, { userId: 'bd', mailboxId: 'm3', field: 'tmpl_o1_body' }) === P && W.pickRaw({ ...each, 'ue_m1_tmpl_o1_body': '   ' }, { userId: 'bd', mailboxId: 'm1', field: 'tmpl_o1_body' }) === P);
step('…and with nothing of the person\'s either, the organisation\'s text is next', W.pickRaw({ 'u_bd_tmpl_scope': 'each', template_o1_body: 'ORG' }, { userId: 'bd', mailboxId: 'm1', field: 'tmpl_o1_body', globalKey: 'template_o1_body' }) === 'ORG');
step('another person\'s choice never leaks: "each" is read per person', W.pickRaw({ ...each, 'u_other_tmpl_scope': 'all' }, { userId: 'other', mailboxId: 'm1', field: 'tmpl_o1_body' }) === '');
step('an email ID counts as having a first email of its own only when "each" is chosen AND it is a real text', W.mailboxHasOwnSequence(each, 'bd', 'm1') === true && W.mailboxHasOwnSequence({ ...each, 'u_bd_tmpl_scope': 'all' }, 'bd', 'm1') === false && W.mailboxHasOwnSequence({ ...each, 'ue_m1_tmpl_o1_body': 'short' }, 'bd', 'm1') === false);
step('the keys a reader must load: the scope flag and the twelve texts of each email ID (first email + up to five follow-ups)', W.neededKeys(['bd'], ['m1']).length === 13 && W.neededKeys(['bd'], ['m1']).includes('u_bd_tmpl_scope') && W.neededKeys(['bd'], ['m1']).includes('ue_m1_tmpl_fu2_body'));

// ── 2. the first email, by the email ID it goes out from ─────────────────────
const mkJob = (id, mb) => ({ id, position: 'Estimator', location: 'Dallas, TX', company: { name: 'Acme ' + id, industry: 'Construction', location: 'Dallas, TX' }, assigned_to_bd: 'bd', sending_email_id: mb, sending_email: { id: mb, email_address: mb + '@x.test', display_name: 'Bea' }, contacts: [{ id: 'c' + id, first_name: 'Sam', last_name: 'R', email: 'sam' + id + '@acme.example', is_primary: true }] });
const bdMap = { bd: { id: 'bd', name: 'Bea BD', email: 'bea@x.test' } };
const prim = { bd: { id: 'm1', email_address: 'm1@x.test' } };
let out = buildPendingEmailsFromJobs([mkJob('j1', 'm1'), mkJob('j2', 'm2')], 'bd', bdMap, prim, each, new Set());
const bySub = (o, j) => o.emailsToInsert.find(e => e.job_id === j);
step('"each": the lead on email ID 1 is written in ITS wording, the lead on email ID 2 in ITS own', bySub(out, 'j1').subject === 'Alpha subject' && /Alpha Staffing/.test(bySub(out, 'j1').body) && bySub(out, 'j2').subject === 'Beta subject' && /Beta Recruiters/.test(bySub(out, 'j2').body), JSON.stringify(out.emailsToInsert.map(e => e.subject)));
out = buildPendingEmailsFromJobs([mkJob('j1', 'm1'), mkJob('j2', 'm2')], 'bd', bdMap, prim, { ...each, 'u_bd_tmpl_scope': 'all' }, new Set());
step('"all": both leads use the person\'s wording, exactly as before', out.emailsToInsert.length === 2 && out.emailsToInsert.every(e => e.subject === 'Person subject'));
out = buildPendingEmailsFromJobs([mkJob('j1', 'm1'), mkJob('j3', 'm3')], 'bd', bdMap, prim, each, new Set());
step('"each", but an email ID with no wording of its own: its lead falls back to the person\'s wording', bySub(out, 'j1').subject === 'Alpha subject' && bySub(out, 'j3').subject === 'Person subject' && out.needsSequence.length === 0);
const noPerson = { 'u_bd_tmpl_scope': 'each', 'ue_m1_tmpl_o1_subject': 'Alpha subject', 'ue_m1_tmpl_o1_body': A };
out = buildPendingEmailsFromJobs([mkJob('j1', 'm1'), mkJob('j3', 'm3')], 'bd', bdMap, prim, noPerson, new Set());
step('a person with NO wording of their own but one written for email ID 1: that email ID may start; the other is reported as needing a sequence (and no email is invented)', out.emailsToInsert.length === 1 && bySub(out, 'j1') && !bySub(out, 'j3') && out.needsSequence.length === 1 && out.needsSequence[0].leads === 1, JSON.stringify(out.needsSequence));
out = buildPendingEmailsFromJobs([mkJob('j1', 'm1')], 'bd', bdMap, prim, { 'u_bd_tmpl_scope': 'all', 'ue_m1_tmpl_o1_body': A }, new Set());
step('"all" with only an email ID\'s text stored (dormant): nothing is written and the person is told they need a sequence', out.emailsToInsert.length === 0 && out.needsSequence.length === 1);
out = buildPendingEmailsFromJobs([mkJob('j1', 'm1'), mkJob('j2', 'm2'), mkJob('j3', 'm3'), mkJob('j4', 'm3')], 'bd', bdMap, prim, { ...each, 'u_bd_random_template_mode': 'true' }, new Set());
step('random rotation leaves an email ID that has its own wording alone (its text is what it sends)', bySub(out, 'j1').subject === 'Alpha subject' && bySub(out, 'j2').subject === 'Beta subject' && out.emailsToInsert.length === 4);

// ── 3. a sequence step ───────────────────────────────────────────────────────
const D = { o1_subject: 'DEFAULT S', o1_body: 'DEFAULT B' };
const res = (v) => v;
let pk = seqT.pickTemplate({ cfg: { template_key: 'initial' }, bdId: 'bd', mailboxId: 'm2', settings: each, defaults: D, resolve: res });
step('a sequence\'s first step goes out in the wording of the email ID it rotates to', pk.subject === 'Beta subject' && pk.body === B, JSON.stringify(pk));
pk = seqT.pickTemplate({ cfg: { template_key: 'initial', subject: 'STEP S', body: 'STEP B' }, bdId: 'bd', mailboxId: 'm2', settings: each, defaults: D, resolve: res });
step('…the step\'s own text still beats everything', pk.subject === 'STEP S' && pk.body === 'STEP B');
pk = seqT.pickTemplate({ cfg: { template_key: 'initial' }, bdId: 'bd', mailboxId: 'm2', settings: { ...each, 'u_bd_tmpl_scope': 'all' }, defaults: D, resolve: res });
step('…with "all" it is the person\'s wording again', pk.body === P);
step('the lookup asks for the scope flag and that email ID\'s two texts', seqT.settingKeys('bd', 'initial', 'm2').includes('u_bd_tmpl_scope') && seqT.settingKeys('bd', 'initial', 'm2').includes('ue_m2_tmpl_o1_body') && seqT.settingKeys('bd', 'initial').length === 4);

// ── 3b. a follow-up goes out in the wording of the email ID it goes out from ──
const FU = { ...each, 'ue_m1_tmpl_fu1_subject': 'Alpha nudge', 'ue_m1_tmpl_fu1_body': 'ALPHA FOLLOW-UP body text that is long enough', 'u_bd_tmpl_fu1_subject': 'Person nudge', 'u_bd_tmpl_fu1_body': 'PERSON FOLLOW-UP body', template_fu2_subject: 'ORG fu2 s', template_fu2_body: 'ORG fu2 b' };
const dflt = { fu1_subject: 'D s1', fu1_body: 'D b1', fu2_subject: 'D s2', fu2_body: 'D b2' };
let ft = W.followupTexts(FU, { userId: 'bd', mailboxId: 'm1', step: 'fu1', resolve: res, defaults: dflt });
step('a follow-up from an email ID with its own follow-up wording uses it — and says so (so a random rotation leaves it alone)', ft.subject === 'Alpha nudge' && /ALPHA FOLLOW-UP/.test(ft.body) && ft.own === true);
ft = W.followupTexts(FU, { userId: 'bd', mailboxId: 'm2', step: 'fu1', resolve: res, defaults: dflt });
step('…from an email ID with none it uses the person\'s', ft.subject === 'Person nudge' && ft.body === 'PERSON FOLLOW-UP body' && ft.own === false);
ft = W.followupTexts({ ...FU, 'u_bd_tmpl_scope': 'all' }, { userId: 'bd', mailboxId: 'm1', step: 'fu1', resolve: res, defaults: dflt });
step('…with "all" the email ID\'s text is dormant', ft.subject === 'Person nudge' && ft.own === false);
ft = W.followupTexts(FU, { userId: 'bd', mailboxId: 'm1', step: 'fu2', resolve: res, defaults: dflt });
step('…follow-up 2 with nothing of their own falls to the organisation\'s, then the built-in text', ft.subject === 'ORG fu2 s' && W.followupTexts({}, { userId: 'bd', mailboxId: 'm1', step: 'fu2', resolve: res, defaults: dflt }).body === 'D b2');

// ── 4. the routes ───────────────────────────────────────────────────────────
const store = { app_settings: [], user_emails: [{ id: 'm1', user_id: 'bd', email_address: 'a@x.test', is_active: true }, { id: 'm2', user_id: 'bd', email_address: 'b@x.test', is_active: true }, { id: 'zz', user_id: 'other', email_address: 'z@x.test', is_active: true }] };
const fake = { from(name) { const f = []; let mode = 'select', row = null;
  const q = { select() { return q; }, eq(c, v) { f.push(r => r[c] === v); return q; }, in(c, l) { f.push(r => l.includes(r[c])); return q; }, delete() { mode = 'delete'; return q; },
    upsert(r) { mode = 'upsert'; row = r; return q; },
    maybeSingle: async () => ({ data: store[name].filter(r => f.every(x => x(r)))[0] || null, error: null }),
    then(res, rej) { let out; if (mode === 'upsert') { const i = store[name].findIndex(x => x.key === row.key); if (i >= 0) Object.assign(store[name][i], row); else store[name].push({ ...row }); out = { data: null, error: null }; }
      else if (mode === 'delete') { store[name] = store[name].filter(r => !f.every(x => x(r))); out = { data: null, error: null }; }
      else out = { data: store[name].filter(r => f.every(x => x(r))), error: null }; return Promise.resolve(out).then(res, rej); } }; return q; } };
const ctx = { supabase: fake, auth: (_a, _b, n) => n(), hasRole: (req, ...roles) => roles.includes(req.user.role) };
const router = require('../routes/settings.js')(ctx);
const handler = (p, m) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const call = async (p, m, body, user) => { let out, code = 200; const res2 = { status(x) { code = x; return res2; }, json(x) { out = x; return res2; } }; await handler(p, m)({ user: Object.assign({ id: 'bd', role: 'bd' }, user), body: body || {}, query: {} }, res2); return { code, out }; };
let r = await call('/outreach-plan', 'post', { key: 'tmpl_scope', value: 'each' });
step('a person can choose a wording for each email ID', r.code === 200 && store.app_settings.some(x => x.key === 'u_bd_tmpl_scope' && x.value === 'each'));
r = await call('/outreach-plan', 'post', { key: 'tmpl_scope', value: 'everyone' });
step('…but nothing other than "all" or "each" is stored', r.code === 400);
r = await call('/outreach-plan/mailbox', 'post', { mailbox_id: 'm2', key: 'tmpl_o1_body', value: B });
step('wording is saved for one of MY email IDs', r.code === 200 && store.app_settings.some(x => x.key === 'ue_m2_tmpl_o1_body' && x.value === B));
r = await call('/outreach-plan/mailbox', 'post', { mailbox_id: 'zz', key: 'tmpl_o1_body', value: 'hijack' });
step('…never for someone else\'s (404, nothing written)', r.code === 404 && !store.app_settings.some(x => x.key === 'ue_zz_tmpl_o1_body'));
r = await call('/outreach-plan/mailbox', 'post', { mailbox_id: 'm2', key: 'signature_html', value: 'x' });
step('…and only the six wording fields are accepted', r.code === 400);
r = await call('/outreach-plan/mailbox', 'post', { mailbox_id: 'm2', key: 'tmpl_o1_subject', value: 'Beta subject' });
r = await call('/outreach-plan/mailboxes', 'get');
step('the person can read back what each of their email IDs says', r.out.mailboxes.m2.tmpl_o1_body === B && r.out.mailboxes.m2.tmpl_o1_subject === 'Beta subject' && Object.keys(r.out.mailboxes).sort().join() === 'm1,m2' && !JSON.stringify(r.out).includes('hijack'), JSON.stringify(r.out));
r = await call('/outreach-plan/mailbox', 'post', { mailbox_id: 'm2', key: 'tmpl_o1_body', value: '  ' });
r = await call('/outreach-plan/mailboxes', 'get');
step('saving it empty takes the text away, so that email ID falls back to the person\'s wording', r.out.mailboxes.m2.tmpl_o1_body === undefined && !store.app_settings.some(x => x.key === 'ue_m2_tmpl_o1_body'));
r = await call('/outreach-plan/mailboxes', 'get', {}, { role: 'recruiter' });
step('a recruiter has none of this', r.code === 403);

// ── 5. same thread or a new email, per follow-up (owner, 8 Oct) ──
const fu = { followup_type: 'fu1', sent_by: 'bd', subject: 'S' };
step('by default a follow-up is a reply in the thread, exactly as it has always been', FT.forDelivery(fu, {}) === fu && FT.forDelivery(fu, { u_bd_fu1_thread: 'same' }) === fu && FT.forDelivery(fu, { u_bd_fu1_thread: 'banana' }) === fu);
const nu = FT.forDelivery(fu, { u_bd_fu1_thread: 'new' });
step('"a new email" hands the delivery a plain email (not fu1/fu2) so it goes out with its own subject — the stored row is untouched', nu.followup_type === 'reminder' && fu.followup_type === 'fu1');
step('the choice is per follow-up and per person', FT.forDelivery({ ...fu, followup_type: 'fu2' }, { u_bd_fu1_thread: 'new' }).followup_type === 'fu2' && FT.forDelivery(fu, { u_other_fu1_thread: 'new' }) === fu);
step('a first email is never affected', FT.forDelivery({ followup_type: null, sent_by: 'bd' }, { u_bd_fu1_thread: 'new' }).followup_type === null);
r = await call('/outreach-plan', 'post', { key: 'fu2_thread', value: 'new' });
step('the choice is saved for Follow-up 2', r.code === 200 && store.app_settings.some(x => x.key === 'u_bd_fu2_thread' && x.value === 'new'));
r = await call('/outreach-plan', 'post', { key: 'fu1_thread', value: 'maybe' });
step('…and only "same" or "new" is accepted', r.code === 400);
// How many follow-ups, and when (D-0113)
r = await call('/outreach-plan', 'post', { key: 'fu_count', value: 0 });
step('"no follow-ups" (0) is a real choice and is saved as "0"', r.code === 200 && store.app_settings.some(x => x.key === 'u_bd_fu_count' && x.value === '0'));
r = await call('/outreach-plan', 'post', { key: 'fu_count', value: 5 });
step('up to five follow-ups can be chosen', r.code === 200 && store.app_settings.some(x => x.key === 'u_bd_fu_count' && x.value === '5'));
step('…but not six, a negative, or a fraction', (await call('/outreach-plan', 'post', { key: 'fu_count', value: 6 })).code === 400 && (await call('/outreach-plan', 'post', { key: 'fu_count', value: -1 })).code === 400 && (await call('/outreach-plan', 'post', { key: 'fu_count', value: 1.5 })).code === 400);
r = await call('/outreach-plan', 'post', { key: 'fu5_day', value: 35 });
step('each follow-up has its own day (1–90), including the fifth', r.code === 200 && store.app_settings.some(x => x.key === 'u_bd_fu5_day' && x.value === '35'));
step('…and 0 days, 91 days or a word is refused', (await call('/outreach-plan', 'post', { key: 'fu3_day', value: 0 })).code === 400 && (await call('/outreach-plan', 'post', { key: 'fu3_day', value: 91 })).code === 400 && (await call('/outreach-plan', 'post', { key: 'fu3_day', value: 'soon' })).code === 400);
r = await call('/outreach-plan', 'post', { key: 'fu4_thread', value: 'new' });
step('same thread / new email can be chosen for follow-ups 3 to 5 too', r.code === 200 && store.app_settings.some(x => x.key === 'u_bd_fu4_thread' && x.value === 'new') && (await call('/outreach-plan', 'post', { key: 'fu5_thread', value: 'maybe' })).code === 400);
r = await call('/outreach-plan', 'post', { key: 'tmpl_fu5_body', value: 'Last note, {{fn}}.' });
step('follow-ups 3 to 5 have their own wording', r.code === 200 && store.app_settings.some(x => x.key === 'u_bd_tmpl_fu5_body'));
r = await call('/outreach-plan', 'post', { key: 'fu6_day', value: 40 });
step('…and there is no sixth', r.code === 400);
r = await call('/outreach-plan/mailbox', 'post', { mailbox_id: 'm2', key: 'tmpl_fu4_body', value: 'Email-ID wording for the fourth follow-up.' });
step('an email ID can have its own wording for follow-ups 3 to 5 as well', r.code === 200 && store.app_settings.some(x => x.key === 'ue_m2_tmpl_fu4_body'));
r = await call('/outreach-plan', 'get');
step('the plan hands back the count, the days, the thread choices and the new wording', r.out.fu_count === '5' && r.out.fu5_day === '35' && r.out.fu4_thread === 'new' && /Last note/.test(r.out.tmpl_fu5_body || ''), JSON.stringify(Object.keys(r.out)));

console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
