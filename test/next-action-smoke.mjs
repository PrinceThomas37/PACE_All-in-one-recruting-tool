// Unit test for next-action.js — the ranked "what to do today" queue (Step 4).
//
// Two things make this queue trustworthy or useless, and both are tested here:
//
//   1. ORDER MEANS SOMETHING. If "most urgent" doesn't hold, the list is just a
//      differently-shaped inbox. Ranking is asserted against fixed inputs on a
//      pinned clock, including tie-breaking, because a queue that reshuffles
//      between refreshes is one nobody trusts.
//
//   2. CLOSED DOORS STAY SHUT. Someone who opted out or said no must NEVER
//      appear as a task. Surfacing them is how automated outreach becomes the
//      thing recipients complain about — and it is a compliance problem, not
//      just a taste one.
//
// Usage: node test/next-action-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const real = require('../next-action.js');
const { summarize, KIND } = real;
// This suite is about the OTHER rules (opt-outs, ownership, grouping, ranking), written with replies from the last few days. The "a reply is
// owed only after N days" rule (R-290) has its own suite (needs-you-rules-smoke), so here it is switched off, explicitly.
const buildNextActions = (o = {}) => real.buildNextActions(Object.assign({ replyDueAfterDays: 0, positiveReplyDueAfterDays: 0 }, o));   // both waits off (R-297 added the positive one)

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-08-02T12:00:00Z');
const ago = (d) => new Date(NOW - d * DAY).toISOString();
const inDays = (d) => new Date(NOW + d * DAY).toISOString();
const m = (direction, days, body) => ({ direction, sent_at: ago(days), body });

const thread = (over) => ({
  entity_type: 'contact', entity_id: 'c1', name: 'Ada Lovelace', company: 'Client Co',
  messages: [m('outbound', 10, 'Hi, we have a Java role.'), m('inbound', 6, 'What are your rates?')],
  ...over,
});

// ── 1. A reply we owe becomes the headline action ───────────────────────────
{
  const items = buildNextActions({ threads: [thread()], now: NOW });
  ok('an unanswered reply produces an action', items.length >= 1, JSON.stringify(items));
  const top = items[0];
  ok('...of kind reply_due', top.kind === KIND.REPLY_DUE, top.kind);
  ok('...naming the person', top.title === 'Ada Lovelace');
  ok('...and their company', top.subtitle === 'Client Co');
  ok('...carrying a human reason', /asked a question/i.test(top.reason) && /6 days/.test(top.reason), top.reason);
  ok('...with the intent attached', top.intent === 'rates', top.intent);
  ok('...and days overdue', top.overdue_days === 6, String(top.overdue_days));
}

// ── 2. Closed doors are never queued ────────────────────────────────────────
{
  const optedOut = thread({ entity_id: 'c2', messages: [m('outbound', 5, 'Hi'), m('inbound', 1, 'Please remove me from this list.')] });
  const said_no = thread({ entity_id: 'c3', messages: [m('outbound', 5, 'Hi'), m('inbound', 1, 'Not interested, thanks.')] });
  const items = buildNextActions({ threads: [optedOut, said_no], now: NOW });
  ok('an opted-out thread produces NO action', !items.some(i => i.entity_id === 'c2'), JSON.stringify(items));
  ok('a "not interested" thread produces NO action', !items.some(i => i.entity_id === 'c3'));
  ok('...so the queue is empty', items.length === 0, JSON.stringify(items));
}

// ── 3. Ranking actually ranks ───────────────────────────────────────────────
{
  const fresh = thread({ entity_id: 'fresh', name: 'Fresh', messages: [m('outbound', 4, 'Hi'), m('inbound', 1, 'What are the rates?')] });
  const stale = thread({ entity_id: 'stale', name: 'Stale', messages: [m('outbound', 20, 'Hi'), m('inbound', 9, 'What are the rates?')] });
  const quiet = thread({ entity_id: 'quiet', name: 'Quiet', stage: 'Connected', messages: [m('outbound', 9, 'Hi there')] });
  const items = buildNextActions({ threads: [fresh, stale, quiet], now: NOW });

  const idx = (id) => items.findIndex(i => i.entity_id === id);
  ok('a longer-ignored reply outranks a newer one', idx('stale') < idx('fresh'), JSON.stringify(items.map(i => i.entity_id)));
  // D-0169 (owner, 20 Oct): silence after OUR email is not a tile — only what is owed.
  ok('a silent thread (we wrote, they did not answer) makes no tile', idx('quiet') === -1, JSON.stringify(items.map(i => i.entity_id)));
  ok('priorities are descending', items.every((it, i) => i === 0 || items[i - 1].priority >= it.priority),
    JSON.stringify(items.map(i => i.priority)));
}
{
  // A recent send is not yet worth chasing — noise suppression matters as much
  // as ranking. A queue full of "you emailed yesterday" is one nobody opens.
  const items = buildNextActions({ threads: [thread({ entity_id: 'new', messages: [m('outbound', 1, 'Hi')] })], now: NOW });
  ok('a send from yesterday is NOT queued', items.length === 0, JSON.stringify(items));
}

// ── 4. Reminders — the feature that never fired ─────────────────────────────
{
  const rems = [
    { id: 'r1', user_id: 'u1', return_date: ago(3), note: 'Ada back from OOO', contact_name: 'Ada', company_name: 'Client Co', contact_id: 'c1', status: 'pending' },
    { id: 'r2', user_id: 'u1', return_date: inDays(5), note: 'Future', contact_name: 'Bob', status: 'pending' },
    { id: 'r3', user_id: 'u1', return_date: ago(1), note: 'Already handled', contact_name: 'Cat', status: 'sent' },
  ];
  const items = buildNextActions({ threads: [], reminders: rems, now: NOW });
  ok('a due reminder becomes an action', items.some(i => i.reminder_id === 'r1'), JSON.stringify(items));
  ok('a FUTURE reminder does not', !items.some(i => i.reminder_id === 'r2'));
  ok('an already-sent reminder does not', !items.some(i => i.reminder_id === 'r3'));
  const r = items.find(i => i.reminder_id === 'r1');
  ok('...kind is reminder_due', r.kind === KIND.REMINDER_DUE);
  ok('...the note is the reason', r.reason === 'Ada back from OOO', r.reason);
  ok('...it links back to the contact, not the reminder row', r.entity_type === 'contact' && r.entity_id === 'c1');
  ok('...and records how overdue it is', r.overdue_days === 3, String(r.overdue_days));
}
{
  // Due TODAY must fire — an off-by-one here means reminders are always a day late.
  const items = buildNextActions({ threads: [], reminders: [
    { id: 'today', user_id: 'u1', return_date: new Date(NOW).toISOString(), note: 'Due now', status: 'pending' },
  ], now: NOW });
  ok('a reminder due today fires today', items.length === 1, JSON.stringify(items));
}

// ── 5. Commitments that came due ────────────────────────────────────────────
{
  const t = thread({ entity_id: 'promise', messages: [
    m('outbound', 20, 'Hi'),
    m('inbound', 12, 'Let me check and get back to you next week.'),
    m('outbound', 11, 'Great, thanks.'),
  ] });
  const items = buildNextActions({ threads: [t], now: NOW });
  const c = items.find(i => i.kind === KIND.COMMITMENT_DUE);
  ok('a passed commitment becomes an action', !!c, JSON.stringify(items));
  ok('...quoting what they actually said', /next week/.test(c.reason), c.reason);
  ok('...and how late it is', /ago/.test(c.reason), c.reason);
}
{
  // A commitment still in the future is not yet actionable.
  const t = thread({ entity_id: 'future', messages: [m('outbound', 3, 'Hi'), m('inbound', 1, 'I will reply next week.')] });
  const items = buildNextActions({ threads: [t], now: NOW });
  ok('a future commitment is not queued as due', !items.some(i => i.kind === KIND.COMMITMENT_DUE), JSON.stringify(items));
}

// ── 6. Stability and limits ─────────────────────────────────────────────────
{
  const a = thread({ entity_id: 'a', name: 'Aaa' });
  const b = thread({ entity_id: 'b', name: 'Bbb' });
  const one = buildNextActions({ threads: [a, b], now: NOW }).map(i => i.entity_id);
  const two = buildNextActions({ threads: [b, a], now: NOW }).map(i => i.entity_id);
  ok('identical-priority items order stably regardless of input order',
    JSON.stringify(one) === JSON.stringify(two), `${one} vs ${two}`);
}
{
  const many = Array.from({ length: 80 }, (_, i) => thread({ entity_id: 'x' + i, name: 'N' + i }));
  ok('the limit is respected', buildNextActions({ threads: many, now: NOW, limit: 10 }).length === 10);
}
{
  ok('no input is safe', buildNextActions({}).length === 0);
  ok('a thread with no messages is skipped', buildNextActions({ threads: [thread({ messages: [] })], now: NOW }).length === 0);
  ok('a malformed reminder date is skipped, not crashed on',
    buildNextActions({ reminders: [{ id: 'bad', return_date: 'nope', status: 'pending' }], now: NOW }).length === 0);
}

// ── 6b. A positive candidate reply is ONE row that carries the stage move (D-0169) ──
// The separate "replied — interested, move them forward?" row is gone: it duplicated the reply row, and it stayed after we had
// answered. The reply row carries the candidate's stage so the stage move is offered right there.
{
  const candidate = thread({
    entity_type: 'candidate', entity_id: 'cand1', name: 'Grace Hopper', stage: 'Screening',
    messages: [m('outbound', 5, 'Hi, are you open to a new role?'), m('inbound', 1, 'Yes, sounds good — happy to chat.')],
  });
  const items = buildNextActions({ threads: [candidate], now: NOW });
  ok('a positive candidate reply is one row — the reply we owe', items.length === 1 && items[0].kind === KIND.REPLY_DUE && items[0].entity_id === 'cand1', JSON.stringify(items));
  ok('...carrying the candidate\'s stage for the stage move', items[0] && items[0].stage === 'Screening');
  const answered = thread({ entity_type: 'candidate', entity_id: 'cand1b', stage: 'Screening',
    messages: [m('outbound', 5, 'Hi'), m('inbound', 3, 'Yes, sounds good — happy to chat.'), m('outbound', 2, 'Great, Tuesday?')] });
  ok('...and once we have answered, nothing is left on the card', buildNextActions({ threads: [answered], now: NOW }).length === 0);
}
{
  const lead = thread({ entity_id: 'lead1', messages: [m('outbound', 5, 'Hi'), m('inbound', 1, 'Sounds good, let\'s set up a call.')] });
  const items = buildNextActions({ threads: [lead], now: NOW });
  ok('a lead\'s reply row carries no candidate stage', items.length === 1 && items[0].stage === undefined, JSON.stringify(items));
}
{
  // A candidate thread with no positive intent (or no stage on record) must
  // not produce a suggestion — this is advisory on signal, not on every reply.
  const candidate = thread({
    entity_type: 'candidate', entity_id: 'cand2', stage: 'Screening',
    messages: [m('outbound', 5, 'Hi'), m('inbound', 1, 'Not interested, thanks.')],
  });
  const items = buildNextActions({ threads: [candidate], now: NOW });
  ok('a "not interested" candidate reply produces no stage suggestion (or any action)',
    !items.some(i => i.entity_id === 'cand2'), JSON.stringify(items));
}

// ── 6c. Silence after our email is never a tile, whatever the stage (D-0169) ──
{
  const silentQuiet = (stage, type) => thread({ entity_type: type || 'contact', entity_id: 'quiet-' + stage, stage, messages: [m('outbound', 9, 'Hi there')] });
  for (const stage of ['Assigned', 'Rejected', 'Unassigned', undefined, 'Connected', 'In Discussion']) {
    ok(`a silent lead in stage "${stage}" makes no tile`, buildNextActions({ threads: [silentQuiet(stage)], now: NOW }).length === 0);
  }
  ok('a silent candidate makes no tile either', buildNextActions({ threads: [silentQuiet('Screening', 'candidate')], now: NOW }).length === 0);
}
{
  // The gate is specifically on the silent NUDGE — an actual unanswered reply
  // from a BD lead must still surface even while the lead is 'Assigned',
  // since that is someone actively waiting on a human, not routine silence.
  const stillAssignedButReplied = thread({ entity_id: 'assigned-reply', stage: 'Assigned' });
  const items = buildNextActions({ threads: [stillAssignedButReplied], now: NOW });
  ok('a reply from a lead still at Assigned IS a tile (someone is waiting on a human)',
    items.length === 1 && items[0].kind === KIND.REPLY_DUE, JSON.stringify(items));
}

// ── 7. Summary for the dashboard card ───────────────────────────────────────
{
  const items = buildNextActions({
    threads: [thread(), thread({ entity_id: 'q', name: 'Quiet', stage: 'Connected', messages: [m('outbound', 9, 'Hi')] })],
    reminders: [{ id: 'r', user_id: 'u1', return_date: ago(1), note: 'x', status: 'pending' }],
    now: NOW,
  });
  const s = summarize(items);
  ok('summary counts the total', s.total === items.length, JSON.stringify(s));
  ok('...breaks down by kind (the silent one is not counted — it is not a tile)', s.by_kind.reply_due === 1 && s.by_kind.reminder_due === 1 && !('nudge' in s.by_kind), JSON.stringify(s.by_kind));
  ok('...and exposes the top item', s.top && s.top.priority === items[0].priority);
  ok('summary of an empty queue is safe', summarize([]).total === 0 && summarize([]).top === null);
}

// ── 6d. A whole company that went quiet is not a tile either; a person there who replied is (D-0169) ──
{
  const silent = (id, days, over = {}) => thread({ entity_id: id, name: 'Person ' + id, company: 'Renewable Energy Partners, Inc.', stage: 'Connected', job_id: 'lead-1', owner_id: 'u-bd', messages: [m('outbound', days, 'Hi')], ...over });
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => silent(x, 6 + (i === 0 ? 0 : 1)));
  ok('six silent contacts of one lead make no tile ("you emailed 6 people and nobody replied" is gone)', buildNextActions({ threads: six, now: NOW }).length === 0);
  const withReply = buildNextActions({ threads: [silent('q1', 5), silent('q2', 5), thread({ entity_id: 'q3', name: 'Replied Person', stage: 'Connected', job_id: 'lead-1', owner_id: 'u-bd', messages: [m('outbound', 8, 'Hi'), m('inbound', 2, 'Yes, call me')] })], now: NOW });
  ok('a person who replied there has their reply_due row — and only that', withReply.length === 1 && withReply[0].kind === KIND.REPLY_DUE && withReply[0].entity_id === 'q3', JSON.stringify(withReply.map(i => [i.entity_id, i.kind])));
}

console.log('\n=== NEXT ACTION SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
