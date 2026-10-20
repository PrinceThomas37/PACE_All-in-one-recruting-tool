// "NEEDS YOU TODAY" IN THE OWNER'S ORDER (R-297, D-0168, 20 Oct). The owner's order, by GROUP, before any urgency:
//   1 a client replied positively, still unanswered   2 a candidate replied positively, still unanswered
//   3 any other client reply owed                     4 any other candidate reply owed
//   5 an interview or submission needs a step         6 a reminder came due, or a promise date passed
//   7 a lead went quiet
// Before this, urgency alone decided: a reminder 5 days late (95 points) sat above a client's interested reply (80).
// Also pinned: a POSITIVE reply is owed after 2 days (the admin's number), an ordinary one after 4; the owner's three pipeline
// steps (interview today/tomorrow on the VIEWER's day · interview passed with no outcome · client silent on a submission);
// and the numbers are admin settings (D-0123), not typed into the code.
// Usage: node test/needs-you-order-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildNextActions, pipelineSteps, TIER } = require('../next-action.js');
const dismissals = require('../services/next-action-dismissals.js');
const settings = require('../config/settings.js');
const bd = require('../services/bd-insights.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };

const DAY = 864e5;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const ago = (d, h = 0) => new Date(NOW - d * DAY - h * 3600e3).toISOString();
// A thread: we wrote first, then they wrote `days` ago with `text`.
const thread = (id, type, text, days, extra = {}) => Object.assign({
  entity_type: type, entity_id: id, name: id, email: id + '@x.com', job_id: 'j-' + id, owner_id: 'me', stage: type === 'contact' ? 'Connected' : 'Screening',
  messages: [{ direction: 'outbound', sent_at: ago(days + 5), body: 'Hello — a role for you.' }, { direction: 'inbound', sent_at: ago(days), body: text }],
}, extra);
const HOT = 'Yes, I am interested — can we set up a call this week?';
const PLAIN = 'Thanks for this. Who else is on the team?';

// ── The groups ──────────────────────────────────────────────────────────────
const threads = [
  thread('quiet-lead', 'contact', null, 0, { messages: [{ direction: 'outbound', sent_at: ago(10), body: 'Following up' }] }),
  thread('cand-plain', 'candidate', PLAIN, 6),
  thread('client-plain', 'contact', PLAIN, 6),
  thread('cand-hot', 'candidate', HOT, 2),
  thread('client-hot', 'contact', HOT, 2),
];
const reminders = [{ id: 'rem1', user_id: 'me', return_date: ago(5).slice(0, 10), note: 'Call them back', contact_name: 'Late reminder', status: 'pending' }];
const pipeline = [{ submission_id: 's1', candidate_id: 'c-iv', name: 'Interview today', email: 'iv@x.com', job_title: 'HVAC Tech', company: 'Acme',
  job_order_id: 'jo1', owner_id: 'me', stage: 'Interview Scheduled', interview_at: new Date(NOW + 2 * 3600e3).toISOString() }];
const items = buildNextActions({ threads, reminders, pipeline, now: NOW });
// (A positive CANDIDATE reply also carries its existing "Replied — interested: move them forward?" row, group 5 — left out of this order check.)
const order = items.filter(i => i.kind !== 'stage_suggested').map(i => i.title || i.entity_id);
ok('the "move them forward?" row of a positive candidate reply sits in group 5', items.some(i => i.kind === 'stage_suggested' && i.tier === TIER.pipeline));
ok('every item carries its group', items.every(i => Number.isFinite(i.tier)), JSON.stringify(items.map(i => [i.title, i.tier])));
const pos = (t) => order.indexOf(t);
ok('1 → 2 → 3 → 4 → 5 → 6 → 7: hot client, hot candidate, client reply, candidate reply, interview, reminder, quiet lead',
  pos('client-hot') === 0 && pos('cand-hot') === 1 && pos('client-plain') === 2 && pos('cand-plain') === 3
  && pos('Interview today') === 4 && pos('Late reminder') === 5 && pos('quiet-lead') > 5, JSON.stringify(order));
ok('a reminder 5 days late no longer outranks a client\'s positive reply (it scores more points, and still ranks below)',
  items.find(i => i.title === 'Late reminder').priority > items.find(i => i.title === 'client-hot').priority && pos('Late reminder') > pos('client-hot'));
ok('a positive reply is marked hot', items.find(i => i.title === 'client-hot').hot === true && items.find(i => i.title === 'client-plain').hot === false);

// ── When a reply is owed ────────────────────────────────────────────────────
const at = (text, days) => buildNextActions({ threads: [thread('p', 'contact', text, days)], now: NOW });
ok('a positive reply 1 day old is NOT listed yet — counted, not dropped', at(HOT, 1).length === 0 && at(HOT, 1).reply_not_due_yet === 1);
ok('a positive reply unanswered for 2 days IS listed, at the top group', at(HOT, 2).length === 1 && at(HOT, 2)[0].tier === TIER.client_hot);
ok('an ordinary reply 3 days old is not listed yet; at 4 days it is', at(PLAIN, 3).length === 0 && at(PLAIN, 4).length === 1);
const custom = buildNextActions({ threads: [thread('p', 'contact', HOT, 1)], now: NOW, positiveReplyDueAfterDays: 1 });
ok('the admin\'s own number is the one used (positive after 1 day)', custom.length === 1);
const answered = buildNextActions({ threads: [thread('p', 'contact', HOT, 3, { messages: [
  { direction: 'inbound', sent_at: ago(3), body: HOT }, { direction: 'outbound', sent_at: ago(2), body: 'Great — Tuesday?' }] })], now: NOW });
ok('a positive reply we answered is not on the list', !answered.some(i => i.kind === 'reply_due'));

// ── The three pipeline steps ────────────────────────────────────────────────
const tz = 'Asia/Kolkata';
const opts = { now: NOW, todayKey: bd.dayKey(NOW, 0, tz), tomorrowKey: bd.dayKey(NOW, -1, tz), dayKeyOf: (ms) => bd.localDay(ms, tz) };
const row = (id, stage, extra) => Object.assign({ submission_id: id, candidate_id: 'c-' + id, name: id, stage, owner_id: 'me', job_order_id: 'jo' }, extra);
const steps = pipelineSteps([
  row('iv-today', 'Interview Scheduled', { interview_at: new Date(NOW + 3 * 3600e3).toISOString() }),          // 20 Oct 20:30 IST
  row('iv-tomorrow', 'Interview Scheduled', { interview_at: new Date(NOW + 24 * 3600e3).toISOString() }),
  row('iv-next-week', 'Interview Scheduled', { interview_at: new Date(NOW + 6 * DAY).toISOString() }),
  row('iv-passed', 'Interview Scheduled', { interview_at: ago(2) }),
  row('iv-done-stale', 'Interview Completed', { stage_updated_at: ago(3) }),
  row('iv-done-fresh', 'Interview Completed', { stage_updated_at: ago(0, 3) }),
  row('client-silent', 'Submitted to Client', { stage_updated_at: ago(4) }),
  row('client-fresh', 'Submitted to Client', { stage_updated_at: ago(2) }),
  row('screening', 'Screening', { stage_updated_at: ago(30) }),
], opts);
const st = Object.fromEntries(steps.map(s => [s.submission_id, s]));
ok('an interview TODAY is a step', st['iv-today'] && st['iv-today'].step === 'interview_soon' && /today/.test(st['iv-today'].reason), JSON.stringify(st['iv-today']));
ok('an interview TOMORROW is a step', st['iv-tomorrow'] && /tomorrow/.test(st['iv-tomorrow'].reason));
ok('an interview next week is not (yet)', !st['iv-next-week']);
ok('an interview 2 days ago still at "Interview Scheduled" asks for the outcome', st['iv-passed'] && st['iv-passed'].step === 'interview_no_outcome');
ok('"Interview Completed" for 3 days with no outcome asks for it; a fresh one does not', st['iv-done-stale'] && !st['iv-done-fresh']);
ok('a submission with the client for 4 days with no movement → chase the client; 2 days → not yet', st['client-silent'] && st['client-silent'].step === 'client_silent' && !st['client-fresh']);
ok('other stages make no step', !st['screening']);
ok('each step is group 5, a candidate row, carrying its submission', steps.every(s => s.tier === TIER.pipeline && s.entity_type === 'candidate' && s.submission_id));
// The viewer's day: 20:00 UTC on 20 Oct is already 21 Oct (tomorrow) in Kolkata, still today in Los Angeles.
const late = row('iv-late', 'Interview Scheduled', { interview_at: '2026-10-20T20:00:00Z' });
const inIndia = pipelineSteps([late], opts)[0];
const la = 'America/Los_Angeles';
const inLA = pipelineSteps([late], { now: NOW, todayKey: bd.dayKey(NOW, 0, la), tomorrowKey: bd.dayKey(NOW, -1, la), dayKeyOf: (ms) => bd.localDay(ms, la) })[0];
ok('"today / tomorrow" is the VIEWER\'s calendar: tomorrow in Kolkata, today in Los Angeles', /tomorrow/.test(inIndia.reason) && /today/.test(inLA.reason), inIndia.reason + ' | ' + inLA.reason);
const fewer = pipelineSteps([row('cs', 'Submitted to Client', { stage_updated_at: ago(4) })], { ...opts, clientSilentAfterDays: 7 });
ok('the admin\'s number is the one used (chase after 7 days → 4 days is not yet)', fewer.length === 0);

// ── Snoozing a step is per submission and per step ──────────────────────────
const k1 = dismissals.itemKey(st['iv-today']), k2 = dismissals.itemKey(Object.assign({}, st['iv-today'], { submission_id: 'other' }));
ok('"Not today" on one submission does not hide the same candidate\'s other job', k1 !== k2 && /^pipeline_step:iv-today:/.test(k1), k1 + ' / ' + k2);

// ── The numbers are the admin's ─────────────────────────────────────────────
const byKey = Object.fromEntries(settings.SETTINGS_SCHEMA.map(s => [s.key, s]));
ok('positive-reply, client-silent and interview-outcome days are admin settings, defaults 2 / 3 / 1 (D-0123)',
  byKey.needs_reply_positive_after_days && byKey.needs_reply_positive_after_days.default === 2
  && byKey.pipeline_client_silent_days && byKey.pipeline_client_silent_days.default === 3
  && byKey.pipeline_interview_outcome_days && byKey.pipeline_interview_outcome_days.default === 1);

const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
