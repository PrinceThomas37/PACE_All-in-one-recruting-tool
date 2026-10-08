// THE FOLLOW-UP CHAIN STARTS WHEN THE FIRST EMAIL IS SENT; ONLY WHAT THE PERSON TURNED ON, ONLY THEIR OWN WORDS (owner, 8 Oct, D-0114)
//   "every new user … will first set up the sequence … those leads will run through the sequence being set by the user … the user has to
//    enable follow-up 1, 2, 3, 4 — how many they want. If no follow-up is enabled then no follow-up email is triggered."
// Usage: node test/followup-chain-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../services/followup-chain.js');
const W = require('../services/wording-scope.js');
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// a tiny fake database: tables are arrays; select().eq().limit() / in() / insert()
function fake(tables) {
  const q = (name) => {
    let rows = tables[name] || [], filters = [];
    const api = {
      select() { return api; },
      eq(c, v) { filters.push(r => r[c] === v); return api; },
      in(c, vs) { filters.push(r => vs.includes(r[c])); return api; },
      limit() { return api; },
      insert(row) { (tables[name] = tables[name] || []).push(row); return Promise.resolve({ error: null }); },
      then(res) { res({ data: (tables[name] || []).filter(r => filters.every(f => f(r))), error: null }); },
    };
    return api;
  };
  return { from: q };
}
const first = { job_id: 'j1', contact_id: 'c1', sent_by: 'bd', followup_type: null };
const job = { assigned_to_bd: 'bd', sending_email_id: 'm1' };

let t = { app_settings: [{ key: 'u_bd_fu_count', value: '3' }, { key: 'u_bd_fu2_day', value: '9' }], follow_ups: [], workflow_enrollments: [] };
let r = await C.scheduleAfterFirstSend(fake(t), { email: first, job, sentOn: '2026-10-08' });
const row = t.follow_ups[0] || {};
step('a person who turned on 3 follow-ups: sending the first email makes their chain', r.created === true && t.follow_ups.length === 1);
step('…dated from the day it was SENT, on the days they chose (3, 9, 14), nothing for 4 and 5', row.followup1_due_date === '2026-10-11' && row.followup2_due_date === '2026-10-17' && row.followup3_due_date === '2026-10-22' && row.followup4_due_date === null && row.followup5_due_date === null, JSON.stringify(row));
step('…marked as made under the new rules, from the mailbox the lead sends from', row.chain_rules === 'own' && row.user_email_id === 'm1' && row.status === 'active');

t = { app_settings: [], follow_ups: [], workflow_enrollments: [] };
r = await C.scheduleAfterFirstSend(fake(t), { email: first, job, sentOn: '2026-10-08' });
step('a person who never turned any on: no chain, no follow-up email will ever be triggered', r.created === false && r.reason === 'none-chosen' && t.follow_ups.length === 0);
t = { app_settings: [{ key: 'u_bd_fu_count', value: '0' }], follow_ups: [], workflow_enrollments: [] };
r = await C.scheduleAfterFirstSend(fake(t), { email: first, job, sentOn: '2026-10-08' });
step('"none" chosen on purpose: the same', r.created === false && t.follow_ups.length === 0);

t = { app_settings: [{ key: 'u_bd_fu_count', value: '2' }], follow_ups: [{ job_id: 'j1', contact_id: 'c1', status: 'completed' }], workflow_enrollments: [] };
r = await C.scheduleAfterFirstSend(fake(t), { email: first, job, sentOn: '2026-10-08' });
step('a lead that already has a chain (even a finished one) is never given a second', r.created === false && r.reason === 'has-chain' && t.follow_ups.length === 1);
t = { app_settings: [{ key: 'u_bd_fu_count', value: '2' }], follow_ups: [], workflow_enrollments: [{ contact_id: 'c1', status: 'active' }] };
r = await C.scheduleAfterFirstSend(fake(t), { email: first, job, sentOn: '2026-10-08' });
step('a contact running through a Sequence is left to the sequence engine', r.created === false && r.reason === 'in-sequence');
t = { app_settings: [{ key: 'u_bd_fu_count', value: '2' }], follow_ups: [], workflow_enrollments: [] };
r = await C.scheduleAfterFirstSend(fake(t), { email: { ...first, followup_type: 'fu1' }, job, sentOn: '2026-10-08' });
step('a follow-up being sent never starts a chain', r.created === false && r.reason === 'not-first' && t.follow_ups.length === 0);
r = await C.scheduleAfterFirstSend({ from() { throw new Error('db down'); } }, { email: first, job, sentOn: '2026-10-08' });
step('a database failure is reported, never thrown (the send itself must stand)', r.created === false && /^error:/.test(r.reason));
t = { app_settings: [{ key: 'u_bd_fu_count', value: '2' }], follow_ups: [], workflow_enrollments: [] };
r = await C.scheduleAfterFirstSend(fake(t), { email: first, job: null, sentOn: '2026-10-08' });
step('with no lead row to read, the person who wrote the email is the owner', r.created === true && t.follow_ups.length === 1);

// strict wording: only what the person wrote
const S = { u_bd_tmpl_fu1_body: 'Hello again {{fn}}', u_bd_tmpl_fu1_subject: 'Quick one', template_fu2_body: 'ORG wording', template_fu2_subject: 'ORG subject' };
const resolve = (v, k) => (String(v || '').trim() || 'STOCK ' + k);
let ft = W.followupTexts(S, { userId: 'bd', mailboxId: 'm1', step: 'fu1', resolve, defaults: {}, strict: true });
step('strict: the person\'s own wording is used', ft.subject === 'Quick one' && ft.body === 'Hello again {{fn}}');
ft = W.followupTexts(S, { userId: 'bd', mailboxId: 'm1', step: 'fu2', resolve, defaults: { fu2_body: 'STOCK' }, strict: true });
step('strict: nothing written means NOTHING — not the organisation\'s text, not PACE\'s standard (so the engine sends nothing)', ft.subject === '' && ft.body === '');
ft = W.followupTexts(S, { userId: 'bd', mailboxId: 'm1', step: 'fu2', resolve, defaults: { fu2_body: 'STOCK' } });
step('an older chain (not strict) keeps the old fallback, exactly as before', ft.body === 'ORG wording');
const E = { u_bd_tmpl_scope: 'each', ue_m1_tmpl_fu1_body: 'Alpha follow-up', ue_m1_tmpl_fu1_subject: 'A', u_bd_tmpl_fu1_body: 'Mine', u_bd_tmpl_fu1_subject: 'M' };
ft = W.followupTexts(E, { userId: 'bd', mailboxId: 'm1', step: 'fu1', strict: true });
step('strict still honours the wording of the email ID it goes out from', ft.body === 'Alpha follow-up' && ft.own === true);

console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
