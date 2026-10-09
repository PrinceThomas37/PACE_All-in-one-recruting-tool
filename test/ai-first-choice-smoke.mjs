// D-0117 / R-177 — a person's own "AI writes first emails".
// Same as the company, on for me, or off. Per email ID only when wording is
// per email ID. Follow-ups never qualify. A missing row is "same as the company".
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../services/ai-first-choice.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const base = { companyOn: true, aiReady: true, settings: {}, userId: 'bd', mailboxId: 'm1', each: false, isFirst: true, alreadyAi: false };
step('company on, nothing saved: the first email is written by AI, as it is today', A.shouldWriteFirst(base) === true);
step('company off, nothing saved: it is not', A.shouldWriteFirst({ ...base, companyOn: false }) === false);
step('off for me wins over a company that is on', A.shouldWriteFirst({ ...base, settings: { u_bd_ai_first: 'off' } }) === false);
step('on for me wins over a company that is off', A.shouldWriteFirst({ ...base, companyOn: false, settings: { u_bd_ai_first: 'on' } }) === true);
step('a follow-up is never rewritten, even when they turned AI on', A.shouldWriteFirst({ ...base, isFirst: false, settings: { u_bd_ai_first: 'on' } }) === false);
step('a draft already written is not written again', A.shouldWriteFirst({ ...base, alreadyAi: true }) === false);
step('no provider: nothing is written, even "on for me"', A.shouldWriteFirst({ ...base, aiReady: false, companyOn: false, settings: { u_bd_ai_first: 'on' } }) === false);
step('an odd value is "same as the company"', A.normalize('banana') === 'company' && A.normalize('off') === 'off' && A.normalize('1') === 'on');

const each = { ...base, each: true, settings: { u_bd_tmpl_scope: 'each', u_bd_ai_first: 'off', ue_m1_ai_first: 'on', ue_m2_ai_first: 'off' } };
step('when wording is per email ID, that email ID\'s choice is the one that counts', A.shouldWriteFirst(each) === true && A.resolveChoice(each.settings, { userId: 'bd', mailboxId: 'm1', each: true }) === 'on');
step('…a different email ID can be off while the person\'s own switch says off too', A.shouldWriteFirst({ ...each, mailboxId: 'm2' }) === false);
step('…with "all", the email ID\'s switch is dormant and the person\'s is used', A.shouldWriteFirst({ ...each, each: false }) === false);
step('an email ID with no choice of its own follows the company, not the person\'s other switch', A.resolveChoice({ u_bd_ai_first: 'off' }, { userId: 'bd', mailboxId: 'm9', each: true }) === 'company');

// The routes store the choice on the person, and on an email ID only when asked.
const store = { app_settings: [], user_emails: [{ id: 'm1', user_id: 'bd', email_address: 'a@x.test', is_active: true }, { id: 'zz', user_id: 'other', email_address: 'z@x.test', is_active: true }] };
const fake = { from(name) { const f = []; let mode = 'select', row = null;
  const q = { select() { return q; }, eq(c, v) { f.push(r => r[c] === v); return q; }, in(c, l) { f.push(r => l.includes(r[c])); return q; }, delete() { mode = 'delete'; return q; },
    upsert(r) { mode = 'upsert'; row = r; return q; },
    maybeSingle: async () => ({ data: (store[name] || []).filter(r => f.every(x => x(r)))[0] || null, error: null }),
    then(res, rej) { let out; if (mode === 'upsert') { const i = store[name].findIndex(x => x.key === row.key); if (i >= 0) Object.assign(store[name][i], row); else store[name].push({ ...row }); out = { data: null, error: null }; }
      else if (mode === 'delete') { store[name] = store[name].filter(r => !f.every(x => x(r))); out = { data: null, error: null }; }
      else out = { data: (store[name] || []).filter(r => f.every(x => x(r))), error: null }; return Promise.resolve(out).then(res, rej); } }; return q; } };
const router = require('../routes/settings.js')({ supabase: fake, auth: (_a, _b, n) => n(), hasRole: (req, ...roles) => roles.includes(req.user.role) });
const handler = (p, m) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const call = async (p, m, body, user) => { let out, code = 200; const res = { status(x) { code = x; return res; }, json(x) { out = x; return res; } }; await handler(p, m)({ user: Object.assign({ id: 'bd', role: 'bd' }, user), body: body || {}, query: {} }, res); return { code, out }; };

let r = await call('/outreach-plan', 'post', { key: 'ai_first', value: 'off' });
step('a person can turn AI first emails off for themselves', r.code === 200 && store.app_settings.some(x => x.key === 'u_bd_ai_first' && x.value === 'off'));
r = await call('/outreach-plan', 'post', { key: 'ai_first', value: 'sometimes' });
step('…and only company, on or off is stored', r.code === 400);
r = await call('/outreach-plan', 'get');
step('the plan reads the choice back', r.out.ai_first === 'off');
r = await call('/outreach-plan/mailbox', 'post', { mailbox_id: 'm1', key: 'ai_first', value: 'on' });
step('an email ID can have its own choice', r.code === 200 && store.app_settings.some(x => x.key === 'ue_m1_ai_first' && x.value === 'on'));
r = await call('/outreach-plan/mailbox', 'post', { mailbox_id: 'zz', key: 'ai_first', value: 'off' });
step('…never on someone else\'s email ID', r.code === 404 && !store.app_settings.some(x => x.key === 'ue_zz_ai_first'));
r = await call('/outreach-plan/mailboxes', 'get');
step('the email ID\'s choice is readable with its wording', r.out.mailboxes.m1.ai_first === 'on');

const failed = results.filter(v => !v).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
