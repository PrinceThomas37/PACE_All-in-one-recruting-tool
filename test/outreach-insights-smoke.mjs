// OUTREACH INSIGHTS — sequence analytics, each number once (R-278, D-0160). Pins the counting rules with no database:
//   * people, emails, opened (of TRACKED emails), replied (people who replied after we wrote), interested, bounced;
//   * the chart by day and by week; the table per sequence ("Your outreach" first) adds up to the strip;
//   * a rate with nothing under it is null ("—"), never 0%; narrowing to one sequence narrows everything.
// Usage: node test/outreach-insights-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };
const OI = require('../services/outreach-insights.js');

const leadSends = [
  { id: 'e1', day: '2026-10-05', contact_id: 'c1', seq: null },          // Your outreach
  { id: 'e2', day: '2026-10-06', contact_id: 'c1', seq: null },          //   follow-up to the same person
  { id: 'e3', day: '2026-10-06', contact_id: 'c2', seq: null },
  { id: 'e4', day: '2026-10-12', contact_id: 'c3', seq: 'wfA' },         // Accountants — Ohio
  { id: 'e5', day: '2026-10-13', contact_id: 'c4', seq: 'wfA' },
  { id: 'e9', day: '2026-09-01', contact_id: 'c5', seq: null },          // outside the range
];
const tracking = [{ email_id: 'e1', open_count: 2 }, { email_id: 'e2', open_count: 0 }, { email_id: 'e4', open_count: 1 }];   // e3, e5 untracked
const contacts = {
  c1: { email_status: 'valid', replied_day: '2026-10-07', stage: 'Connected' },
  c2: { email_status: 'invalid', replied_day: null, stage: 'Assigned' },
  c3: { email_status: 'valid', replied_day: '2026-10-01', stage: 'Assigned' },   // replied BEFORE we wrote — not a reply to this
  c4: { email_status: 'valid', replied_day: null, stage: 'In Discussion' },
};
const candSends = [{ id: 't1', day: '2026-10-14', candidate_id: 'p1', seq: 'wfC', open_count: 1, replied_day: '2026-10-15' }];
const seqNames = { wfA: 'Accountants — Ohio', wfC: 'Site engineers — Houston' };
const base = { from: '2026-10-01', to: '2026-10-19', leadSends, tracking, contacts, candSends, seqNames };

let r = OI.summarise(Object.assign({ bucket: 'day' }, base));
const t = r.totals;
step('people emailed counts each person once (5 people, 6 emails in the range; the September one is out)', t.people === 5 && t.emailed === 6, JSON.stringify(t));
step('opened is out of TRACKED emails only (e1 opened, e2 not, e4 opened, t1 opened → 3 of 4 = 75%)', t.opened_rate === 75, t.opened_rate);
step('replied = people who replied AFTER we wrote (c1, p1 — not c3, who wrote first) → 2 of 5 = 40%', t.replied === 2 && t.replied_rate === 40, JSON.stringify([t.replied, t.replied_rate]));
step('interested = Connected or In Discussion (c1, c4)', t.interested === 2);
step('bounced = an invalid address, of the LEADS emailed (c2 of 4 = 25%)', t.bounced_rate === 25, t.bounced_rate);
step('the chart has one point per day of the range (19)', r.series.length === 19 && r.series[0].key === '2026-10-01' && r.series[18].key === '2026-10-19');
const p6 = r.series.find((p) => p.key === '2026-10-06'), p7 = r.series.find((p) => p.key === '2026-10-07');
step('…emailed on the day it went out, opened with it, replied on the day the reply came', p6.emailed === 2 && p6.opened === 0 && p7.replied === 1 && r.series.find((p) => p.key === '2026-10-05').opened === 1, JSON.stringify([p6, p7]));
step('…the chart\'s totals match the strip (no second definition)', r.series.reduce((a, p) => a + p.emailed, 0) === t.emailed && r.series.reduce((a, p) => a + p.replied, 0) === t.replied);
const names = r.sequences.map((x) => x.name);
step('the table: "Your outreach" first, then each sequence that sent something', names[0] === 'Your outreach' && names.includes('Accountants — Ohio') && names.includes('Site engineers — Houston') && names.length === 3, names.join(' | '));
step('…the rows add up to the strip', r.sequences.reduce((a, x) => a + x.emailed, 0) === t.emailed && r.sequences.reduce((a, x) => a + x.people, 0) === t.people);
const cRow = r.sequences.find((x) => x.id === 'wfC');
step('a candidate sequence says so, and has no "interested" or "bounced" (those are about leads) — shown as —, not 0', cRow.candidates === true && cRow.interested === null && cRow.bounced_rate === null);
r = OI.summarise(Object.assign({ bucket: 'week' }, base));
step('weekly: one point per Monday-started week (19 Oct is a Monday → 4), the same totals', r.series.length === 4 && r.series[0].key === '2026-09-28' && r.series[3].key === '2026-10-19' && r.series.reduce((a, p) => a + p.emailed, 0) === 6, JSON.stringify(r.series.map((p) => p.key)));
r = OI.summarise(Object.assign({ bucket: 'day', only: 'wfA' }, base));
step('narrowed to one sequence: everything is that sequence\'s only', r.totals.people === 2 && r.totals.emailed === 2 && r.sequences.length === 1 && r.sequences[0].id === 'wfA');
r = OI.summarise(Object.assign({ bucket: 'day', only: 'outreach' }, base));
step('narrowed to "Your outreach": the sends no sequence recorded', r.totals.emailed === 3 && r.sequences[0].name === 'Your outreach');
r = OI.summarise({ from: '2026-10-01', to: '2026-10-03', bucket: 'day', leadSends: [], tracking: [], contacts: {}, candSends: [], seqNames: {} });
step('nothing sent: rates are null ("—"), never 0%', r.totals.opened_rate === null && r.totals.replied_rate === null && r.totals.bounced_rate === null && r.totals.people === 0);

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
