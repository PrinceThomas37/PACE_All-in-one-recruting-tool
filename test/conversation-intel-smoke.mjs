// Unit test for conversation-intel.js — the rules-first thread reader (Step 4).
//
// Everything this module produces is a CLAIM SHOWN TO THE USER: "they asked a
// question 6 days ago and you haven't replied." If the clock arithmetic or the
// direction logic is wrong, the product confidently lies about who owes whom a
// reply — which is worse than showing nothing. So the clock is injected and
// pinned in every case below; nothing here depends on the real time.
//
// The other thing under test is quote stripping. Without it, intent keywords
// match text from three messages back and every thread looks like it mentions
// rates, meetings and everything else. It is also what keeps stored bodies small
// enough for free Supabase.
//
// Usage: node test/conversation-intel-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ci = require('../conversation-intel.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-08-02T12:00:00Z');
const ago = (d) => new Date(NOW - d * DAY).toISOString();
const msg = (direction, days, body) => ({ direction, sent_at: ago(days), body });

// ── 1. Quote stripping ───────────────────────────────────────────────────────
{
  const gmail = `Sounds good, let's do it.\n\nOn Mon, 28 Jul 2026 at 09:12, Ada <ada@x.com> wrote:\n> What are your rates?\n> Thanks`;
  const s = ci.stripQuotedText(gmail);
  ok('strips a Gmail "On ... wrote:" quote', s === "Sounds good, let's do it.", JSON.stringify(s));

  const outlook = `No thanks.\n\n-----Original Message-----\nFrom: Us\nSent: Monday\nCan we schedule a call?`;
  ok('strips an Outlook original-message block', ci.stripQuotedText(outlook) === 'No thanks.', JSON.stringify(ci.stripQuotedText(outlook)));

  const plain = `Interested!\n\n> can you send the JD?\n> thanks`;
  ok('strips plain-text > quoting', ci.stripQuotedText(plain) === 'Interested!', JSON.stringify(ci.stripQuotedText(plain)));

  const sig = `Happy to chat.\n\n--\nAda Lovelace\nCTO`;
  ok('strips a -- signature', ci.stripQuotedText(sig) === 'Happy to chat.', JSON.stringify(ci.stripQuotedText(sig)));

  ok('strips a mobile sign-off', ci.stripQuotedText('Yes please.\n\nSent from my iPhone') === 'Yes please.');

  const html = `<div>Yes, <b>interested</b>.</div><blockquote>What are your rates?</blockquote>`;
  const hs = ci.stripQuotedText(html);
  ok('drops an HTML blockquote and flattens tags', /Yes, interested\./.test(hs) && !/rates/.test(hs), JSON.stringify(hs));

  const gq = `<div>Confirmed.</div><div class="gmail_quote">On Mon someone wrote: budget?</div>`;
  ok('drops a gmail_quote container', !/budget/.test(ci.stripQuotedText(gq)), ci.stripQuotedText(gq));

  ok('plain text with no quoting is untouched', ci.stripQuotedText('Just a note.') === 'Just a note.');
  ok('handles null/empty safely', ci.stripQuotedText(null) === '' && ci.stripQuotedText('') === '');
  ok('decodes html entities', ci.stripQuotedText('<p>Tom &amp; Jerry</p>').includes('Tom & Jerry'));
}
{
  // Storage growth is the stated risk on free Supabase.
  const long = 'x'.repeat(9000);
  const stored = ci.cleanForStorage(long);
  ok('cleanForStorage trims to the cap', stored.length <= ci.MAX_STORED_BODY, String(stored.length));
  ok('...and marks that it was trimmed', stored.endsWith('…'));
  ok('cleanForStorage also strips quotes', ci.cleanForStorage('Hi.\n\n> old stuff') === 'Hi.');
}

// ── 2. Question detection ────────────────────────────────────────────────────
{
  ok('detects a direct question', ci.hasQuestion('What are your rates?'));
  ok('detects a polite indirect ask', ci.hasQuestion('Could you send the JD.'));
  ok('detects "any update"', ci.hasQuestion('Any update on this'));
  ok('does not fire on a statement', !ci.hasQuestion('Thanks, received.'));
  // A "?" inside a URL is not a question to us.
  ok('ignores a ? inside a URL', !ci.hasQuestion('See https://x.com/a?b=1 for details.'));
  // The key one: a question in the QUOTED part is not a live question.
  ok('ignores a question in the quoted chain',
    !ci.hasQuestion('Thanks, all set.\n\nOn Mon someone wrote:\n> what are your rates?'));
}

// ── 3. Intent ────────────────────────────────────────────────────────────────
{
  const cases = [
    ['Please unsubscribe me', 'unsubscribe', 'bad'],
    ['Not interested, thanks', 'not_interested', 'bad'],
    ['I am out of office until Monday', 'out_of_office', 'neutral'],
    ['Wrong person — you should contact Dana', 'wrong_person', 'neutral'],
    ['Can we circle back next quarter?', 'defer', 'neutral'],
    ["Let's schedule a call this week", 'meeting', 'good'],
    ['What is your bill rate for this role?', 'rates', 'good'],
    ['Send me the profiles', 'send_info', 'good'],
  ];
  for (const [text, id, tone] of cases) {
    const r = ci.classifyIntent(text);
    ok(`intent: "${text.slice(0, 34)}…" → ${id}`, r && r.id === id && r.tone === tone, JSON.stringify(r));
  }
  ok('no intent on neutral chatter', ci.classifyIntent('Got it, thanks.') === null);
  // Ordering matters: withdrawal must beat the merely informative.
  ok('unsubscribe outranks a co-occurring positive word',
    ci.classifyIntent('Interested but please remove me from this list').id === 'unsubscribe');
  ok('intent ignores the quoted chain',
    ci.classifyIntent('Sure.\n\n> not interested\n') === null || ci.classifyIntent('Sure.\n\n> not interested\n').id !== 'not_interested');
}

// ── 4. Commitments ───────────────────────────────────────────────────────────
{
  const c1 = ci.extractCommitments('I will get back to you next week.', NOW);
  ok('extracts "next week"', c1.length === 1 && Math.round((Date.parse(c1[0].due) - NOW) / DAY) === 7, JSON.stringify(c1));

  const c2 = ci.extractCommitments('Ping me in 3 days please.', NOW);
  ok('extracts "in N days"', c2.length && Math.round((Date.parse(c2[0].due) - NOW) / DAY) === 3, JSON.stringify(c2));

  const c3 = ci.extractCommitments('Reach out after the 15th.', NOW);
  ok('extracts a day-of-month', c3.some(c => c.kind === 'day_of_month'), JSON.stringify(c3));
  // NOW is 2 Aug, so "the 15th" is this month, not next.
  ok('...resolved to the coming occurrence', c3.some(c => c.due.startsWith('2026-08-15')), JSON.stringify(c3));

  const c4 = ci.extractCommitments('Let us talk on Sep 10.', NOW);
  ok('extracts a named date', c4.some(c => c.kind === 'named_date' && c.due.startsWith('2026-09-10')), JSON.stringify(c4));

  ok('no commitment in plain text', ci.extractCommitments('Thanks!', NOW).length === 0);
}

// ── 5. analyzeThread — the headline is a factual claim ───────────────────────
{
  const a = ci.analyzeThread([], { now: NOW });
  ok('empty thread → no_contact', a.state === 'no_contact' && a.priority === 0, JSON.stringify(a));
}
{
  // We emailed, silence.
  const a = ci.analyzeThread([msg('outbound', 2, 'Hi, interested in a chat?')], { now: NOW });
  ok('outbound only → awaiting_first_reply', a.state === 'awaiting_first_reply', a.state);
  ok('...waiting on them', a.waiting_on === 'them');
  ok('...headline states the wait', /no reply yet/.test(a.headline), a.headline);
  ok('...not flagged as needing our reply', a.needs_reply === false);
  ok('...low priority at 2 days (not yet nudge-worthy)', a.priority === 0, String(a.priority));
}
{
  const a = ci.analyzeThread([msg('outbound', 9, 'Hi there')], { now: NOW });
  ok('an old unanswered send becomes nudge-worthy', a.priority > 0, String(a.priority));
}
{
  // THE headline case from the plan.
  const a = ci.analyzeThread([
    msg('outbound', 10, 'Hi, we have a Java role.'),
    msg('inbound', 6, 'Thanks — what are your rates for this?'),
  ], { now: NOW });
  ok('they replied last → needs_reply', a.state === 'needs_reply', a.state);
  ok('...waiting on YOU', a.waiting_on === 'you');
  ok('...question detected', a.question_pending === true);
  ok('...intent is rates', a.intent && a.intent.id === 'rates', JSON.stringify(a.intent));
  ok('...headline names the ask and the delay',
    /asked a question/i.test(a.headline) && /6 days/.test(a.headline), a.headline);
  ok('...days since inbound is exact', a.days_since_inbound === 6, String(a.days_since_inbound));
  ok('...high priority', a.priority >= 80, String(a.priority));
}
{
  // We answered — ball back with them.
  const a = ci.analyzeThread([
    msg('outbound', 10, 'Hi'),
    msg('inbound', 6, 'What are your rates?'),
    msg('outbound', 1, 'Our rate is X.'),
  ], { now: NOW });
  ok('after we reply → awaiting_them', a.state === 'awaiting_them', a.state);
  ok('...no longer needs our reply', a.needs_reply === false);
  ok('...headline reflects the wait on them', /waiting on them/.test(a.headline), a.headline);
  ok('...records that they have ever replied', a.ever_replied === true);
}
{
  const a = ci.analyzeThread([
    msg('outbound', 5, 'Hi'), msg('inbound', 1, 'Please remove me from this list.'),
  ], { now: NOW });
  ok('opt-out → opted_out state', a.state === 'opted_out', a.state);
  ok('...headline says do not email again', /do not email again/i.test(a.headline), a.headline);
  ok('...priority ZERO (never queue an opt-out for follow-up)', a.priority === 0, String(a.priority));
}
{
  const a = ci.analyzeThread([
    msg('outbound', 5, 'Hi'), msg('inbound', 2, 'Not interested, thanks.'),
  ], { now: NOW });
  ok('rejection → closed_lost', a.state === 'closed_lost', a.state);
  ok('...priority zero', a.priority === 0, String(a.priority));
}
{
  // Staleness must actually order the queue.
  const fresh = ci.analyzeThread([msg('outbound', 8, 'Hi'), msg('inbound', 1, 'What are the rates?')], { now: NOW });
  const stale = ci.analyzeThread([msg('outbound', 20, 'Hi'), msg('inbound', 9, 'What are the rates?')], { now: NOW });
  ok('an older unanswered reply outranks a newer one', stale.priority > fresh.priority, `${stale.priority} vs ${fresh.priority}`);
}
{
  // Order of the input array must not matter.
  const inOrder = ci.analyzeThread([msg('outbound', 10, 'a'), msg('inbound', 3, 'b?')], { now: NOW });
  const shuffled = ci.analyzeThread([msg('inbound', 3, 'b?'), msg('outbound', 10, 'a')], { now: NOW });
  ok('messages are sorted, so input order is irrelevant',
    JSON.stringify(inOrder) === JSON.stringify(shuffled));
}
{
  const a = ci.analyzeThread([
    msg('outbound', 5, 'Hi'), { direction: 'inbound', sent_at: 'not-a-date', body: 'x' },
  ], { now: NOW });
  ok('an unparseable timestamp is dropped, not crashed on', a.state === 'awaiting_first_reply', a.state);
  ok('null message list is safe', ci.analyzeThread(null, { now: NOW }).state === 'no_contact');
}
{
  const a = ci.analyzeThread([msg('outbound', 4, 'Hi'), msg('inbound', 0, 'Any update?')], { now: NOW });
  ok('a same-day reply reads "today", not "0 days"', /today/.test(a.headline), a.headline);
}

console.log('\n=== CONVERSATION INTEL SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
