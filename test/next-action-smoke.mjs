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
const { buildNextActions, summarize, KIND } = require('../next-action.js');

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
  const quiet = thread({ entity_id: 'quiet', name: 'Quiet', messages: [m('outbound', 9, 'Hi there')] });
  const items = buildNextActions({ threads: [fresh, stale, quiet], now: NOW });

  const idx = (id) => items.findIndex(i => i.entity_id === id);
  ok('a longer-ignored reply outranks a newer one', idx('stale') < idx('fresh'), JSON.stringify(items.map(i => i.entity_id)));
  ok('someone waiting on us outranks a silent nudge', idx('fresh') < idx('quiet'), JSON.stringify(items.map(i => i.entity_id)));
  ok('the silent one is a nudge, not a reply_due',
    items.find(i => i.entity_id === 'quiet').kind === KIND.NUDGE);
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

// ── 6b. Stage suggestion — candidate threads only, advisory not automatic ──
{
  const candidate = thread({
    entity_type: 'candidate', entity_id: 'cand1', name: 'Grace Hopper', stage: 'Screening',
    messages: [m('outbound', 5, 'Hi, are you open to a new role?'), m('inbound', 1, 'Yes, sounds good — happy to chat.')],
  });
  const items = buildNextActions({ threads: [candidate], now: NOW });
  const suggestion = items.find(i => i.kind === KIND.STAGE_SUGGESTED);
  ok('a positive-intent candidate reply produces a stage suggestion', !!suggestion, JSON.stringify(items));
  ok('...naming the current stage', /Screening/.test(suggestion.reason), suggestion.reason);
  ok('...tagged to the candidate entity', suggestion.entity_type === 'candidate' && suggestion.entity_id === 'cand1');
}
{
  // Same positive reply, but on a contact (BD lead) thread — no ATS stage
  // exists for a lead, so no stage suggestion should ever fire there.
  const lead = thread({ entity_id: 'lead1', messages: [m('outbound', 5, 'Hi'), m('inbound', 1, 'Sounds good, let\'s set up a call.')] });
  const items = buildNextActions({ threads: [lead], now: NOW });
  ok('a contact/lead thread never produces a stage suggestion', !items.some(i => i.kind === KIND.STAGE_SUGGESTED), JSON.stringify(items));
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

// ── 6c. Signal verification — low-confidence AI extractions, dark today ────
{
  const sig = { entity_type: 'candidate', entity_id: 'cand9', name: 'Ada', company: 'Acme',
    job_id: 'j1', owner_id: 'u1', field: 'next_step', value: 'call back Friday', confidence: 42 };
  const items = buildNextActions({ signals: [sig], now: NOW });
  ok('a low-confidence signal produces a signal_verify action', items.length === 1, JSON.stringify(items));
  const item = items[0];
  ok('...naming the extracted value and confidence', /call back Friday/.test(item.reason) && /42%/.test(item.reason), item.reason);
  ok('...tagged to the right entity', item.entity_type === 'candidate' && item.entity_id === 'cand9');
  ok('...kind is signal_verify', item.kind === KIND.SIGNAL_VERIFY);
}
{
  // No signals passed (the default — no funded ANTHROPIC_API_KEY means this
  // is always [] in production today) must not affect anything else.
  const items = buildNextActions({ threads: [thread()], now: NOW });
  ok('omitting signals entirely is safe and unrelated to other kinds',
    items.length === 1 && items[0].kind === KIND.REPLY_DUE, JSON.stringify(items));
}

// ── 7. Summary for the dashboard card ───────────────────────────────────────
{
  const items = buildNextActions({
    threads: [thread(), thread({ entity_id: 'q', name: 'Quiet', messages: [m('outbound', 9, 'Hi')] })],
    reminders: [{ id: 'r', user_id: 'u1', return_date: ago(1), note: 'x', status: 'pending' }],
    now: NOW,
  });
  const s = summarize(items);
  ok('summary counts the total', s.total === items.length, JSON.stringify(s));
  ok('...breaks down by kind', s.by_kind.reply_due === 1 && s.by_kind.nudge === 1 && s.by_kind.reminder_due === 1, JSON.stringify(s.by_kind));
  ok('...and exposes the top item', s.top && s.top.priority === items[0].priority);
  ok('summary of an empty queue is safe', summarize([]).total === 0 && summarize([]).top === null);
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
