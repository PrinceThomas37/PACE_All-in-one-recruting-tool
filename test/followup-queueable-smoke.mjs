// R-379 — the Assign screen counts only the follow-ups the engine will REALLY queue. Pure: services/followup-queueable.js, driven with the live
// situation of 4 Nov (132 follow-ups "due", 129 of them for leads with NO first email on record; the run logged `skipped_no_initial: 129`).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const q = require('../services/followup-queueable.js');
const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

const TODAY = '2026-11-04';
const eligible = (c) => !!c && !!c.email && c.email_status !== 'blocked' && c.email_status !== 'invalid';
let n = 0;
// a follow_ups row as the Assign screen reads it: stored due dates already passed, nothing sent yet
const row = (o = {}) => { n++; return { id: 'f' + n, job_id: 'j' + n, contact_id: 'c' + n, user_email_id: 'mbA', status: 'active',
  followup1_due_date: '2026-10-10', followup1_sent_at: null, followup2_due_date: '2026-10-14', followup2_sent_at: null,
  job: { id: 'j' + n, stage: 'Assigned', assigned_to_bd: 'bd1' }, contact: { id: 'c' + n, email: 'p' + n + '@x.test', email_status: 'valid' }, ...o }; };
const firstSent = (r, sentAt) => ({ job_id: r.job_id, contact_id: r.contact_id, sent_at: sentAt });
const count = (rows, firsts, settings = {}) => q.dueNowByMailbox(rows, { todayDate: TODAY, settings, initialSent: q.initialSentMap(firsts), isEligibleContact: eligible });
const total = (m) => Object.values(m).reduce((a, d) => a + d.fu1 + d.fu2 + d.later, 0);

// ── the live case ───────────────────────────────────────────────────────────
const noFirst = Array.from({ length: 129 }, () => row());
const recent = Array.from({ length: 3 }, () => row());
const firsts = recent.map(r => firstSent(r, '2026-11-03'));
ok('4 Nov: 132 follow-ups past their stored date, 129 with no first email, 3 whose first email went yesterday → the screen shows NO number (was 132)', total(count([...noFirst, ...recent], firsts)) === 0, JSON.stringify(count([...noFirst, ...recent], firsts)));

// ── each rule, one at a time ────────────────────────────────────────────────
const a = row();
ok('a follow-up with NO first email on record is not counted', total(count([a], [])) === 0);
ok('a first email sent long ago → the follow-up IS counted, under its mailbox', (() => { const b = row(); const m = count([b], [firstSent(b, '2026-10-20')]); return m.mbA && m.mbA.fu1 === 1 && total(m) === 1; })());
const c = row();
ok('a first email sent yesterday → NOT counted yet (due counts from the REAL send date, not the assignment date)', total(count([c], [firstSent(c, '2026-11-03')])) === 0);
const d = row({ job: { id: 'jx', stage: 'Contacted', assigned_to_bd: 'bd1' } });
ok('a lead that is no longer Assigned is not counted', total(count([d], [firstSent(d, '2026-10-20')])) === 0);
const e = row(); e.contact.email_status = 'blocked';
ok('a contact who may not be emailed is not counted', total(count([e], [firstSent(e, '2026-10-20')])) === 0);
const f = row({ followup1_sent_at: '2026-10-20' });
ok('the SECOND follow-up is counted as fu2 once the first has gone and its day has come', (() => { const m = count([f], [firstSent(f, '2026-10-01')]); return m.mbA && m.mbA.fu2 === 1 && m.mbA.fu1 === 0; })());
const g = row();
ok('the person\'s own day offset is honoured: a 30-day fu1 is not due 15 days after the first email', total(count([g], [firstSent(g, '2026-10-20')], { u_bd1_fu1_day: '30' })) === 0 && total(count([g], [firstSent(g, '2026-10-20')], {})) === 1);
const h1 = row({ user_email_id: 'mbA' }), h2 = row({ user_email_id: 'mbB' }), h3 = row({ user_email_id: 'mbB' });
const hm = count([h1, h2, h3], [h1, h2, h3].map(r => firstSent(r, '2026-10-01')));
ok('counted per email ID', hm.mbA.fu1 === 1 && hm.mbB.fu1 === 2, JSON.stringify(hm));

// ── the shared pieces ──────────────────────────────────────────────────────
const m = q.initialSentMap([{ job_id: 'j', contact_id: 'c', sent_at: '2026-10-05' }, { job_id: 'j', contact_id: 'c', sent_at: '2026-10-02' }, { job_id: 'j', contact_id: 'z', sent_at: null }]);
ok('the first-send map keeps the EARLIEST real send per lead and contact', m.get('j:c') === '2026-10-02');
ok('a send with no time counts as none', !m.get('j:z'));
ok('isDueFromSend: gap not yet elapsed / elapsed / junk', q.isDueFromSend('2026-11-03', 3, TODAY) === false && q.isDueFromSend('2026-10-20', 3, TODAY) === true && q.isDueFromSend('nope', 3, TODAY) === false);

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
