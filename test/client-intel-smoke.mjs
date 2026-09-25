// CLIENT INTELLIGENCE — the rules that keep the email timeline cheap and the
// AI summary honest (D-0039…D-0043). Pure functions, fixed clock, no network.
//
// The assertion that matters most is the owner's own sentence: "a bd clicks to
// generate summary till day on a client with 2 years of email data, it should
// not over eat the tokens and still work fine." So a 900-email, two-year
// history is built and the request is measured against the hard ceiling.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ci = require('../services/client-intel.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const NOW = Date.parse('2026-09-25T12:00:00Z');
const DAY = 86400000;

// ── 1. the gate ────────────────────────────────────────────────────────────
const g = (o) => ci.gateMessage(Object.assign({ ownDomains: ['futeglobal.com'] }, o)).reason;
step('a lead contact is kept, even from gmail', g({ from: 'ann@gmail.com', contactMatched: true }) === 'contact');
step('a candidate we emailed is kept', g({ from: 'bob@x.com', candidateMatched: true }) === 'candidate');
step('ZipRecruiter is dropped', g({ from: 'alerts@ziprecruiter.com' }) === 'noise');
step('Glassdoor is dropped even on "our" thread', g({ from: 'noreply@glassdoor.com', threadKnown: true }) === 'noise');
step('a Google account alert is dropped', g({ from: 'no-reply@accounts.google.com' }) === 'noise');
step('our own colleague is dropped', g({ from: 'lisa@futeglobal.com', threadKnown: true }) === 'own_domain');
step('a stranger is dropped', g({ from: 'someone@randomco.com' }) === 'unknown_sender');
step('a stranger replying on OUR thread is kept', g({ from: 'cc@acme.com', threadKnown: true }) === 'our_thread');
step('gmail.com is never a company domain', ci.isPublicDomain('gmail.com') && !ci.isPublicDomain('acme.com'));

// ── 2. filing is small ─────────────────────────────────────────────────────
const long = 'Hello there. '.repeat(400) + '\nOn Mon, Sep 1, 2026 at 9:00 AM Lisa wrote:\n> old quoted text';
const stored = ci.trimStoredText(long);
step('stored text is capped at 1,500 characters', stored.length <= 1500, String(stored.length));
step('quoted history is not stored', !/old quoted text/.test(ci.trimStoredText('Thanks!\nOn Mon, Sep 1, 2026 at 9:00 AM Lisa wrote:\n> old quoted text')));

// ── 3. facts ───────────────────────────────────────────────────────────────
const f = ci.factsForMessage('Thanks for the profiles. What are your rates for this role? I will get back to you next week with feedback.', '2026-09-20T10:00:00Z');
step('facts catch the question', /rates/.test(f.question || ''), f.question);
step('facts catch the promise, with its sentence', f.commitments.length && /get back to you next week/.test(f.commitments[0].text), JSON.stringify(f.commitments));
step('facts catch the intent', f.intent === 'rates', f.intent);

// A two-year client: 900 emails, alternating, long bodies.
const start = NOW - 730 * DAY;
const big = [];
for (let i = 0; i < 900; i++) {
  const inbound = i % 3 === 0;
  const text = (inbound ? 'Can you send more profiles? ' : 'Here are three more candidates for the role. ') + 'Lorem ipsum dolor sit amet. '.repeat(60);
  big.push({ id: 'm' + i, direction: inbound ? 'inbound' : 'outbound', sent_at: new Date(start + i * (730 * DAY / 900)).toISOString(),
    from: inbound ? 'maria@acme.com' : 'lisa@futeglobal.com', person: inbound ? 'Maria' : null, subject: 'Re: roles',
    text: ci.trimStoredText(text), facts: inbound ? ci.factsForMessage(text, start + i * (730 * DAY / 900)) : null });
}
const ledger = ci.buildLedger(big, { now: NOW });
const lt = ci.ledgerText(ledger);
step('the fact sheet for 2 years fits its fixed size (≤3,200 chars ≈ 800 tokens)', lt.length <= ci.CAPS.LEDGER_CHARS, String(lt.length));
step('…and still says who, how many and when', /900/.test(lt) && /Maria/.test(lt) && /2024-09/.test(lt), lt.slice(0, 120));

// ── 4. the capped request ──────────────────────────────────────────────────
const pb = ci.playbookFor('recruiting');
const req = ci.buildSummaryRequest({ playbook: pb, clientName: 'Acme', ledger, messages: big, saved: null, now: NOW });
step('a 2-year, 900-email client stays under the per-click ceiling (~3,400 tokens)', req.estimated_tokens <= 3400, req.estimated_tokens + ' tokens');
step('…by sending at most 8 emails as text', req.used_messages <= 8, String(req.used_messages));
const small = big.slice(-5);
const reqSmall = ci.buildSummaryRequest({ playbook: pb, clientName: 'Acme', ledger: ci.buildLedger(small, { now: NOW }), messages: small, now: NOW });
step('a 5-email client costs about the same or less', reqSmall.estimated_tokens <= req.estimated_tokens);
step('the prompt tells the AI to invent nothing and pick steps by id', /Never invent/.test(req.system) && /send_profiles/.test(req.system));

// Incremental: after a saved summary, only newer emails go in.
const saved = { summary: 'Earlier summary.', covers_until: big[895].sent_at };
const req2 = ci.buildSummaryRequest({ playbook: pb, clientName: 'Acme', ledger, messages: big, saved, now: NOW });
step('an update sends only the emails newer than the saved summary', req2.used_messages === 4, String(req2.used_messages));
step('…and includes the previous summary', /PREVIOUS SUMMARY/.test(req2.prompt));

// ── status and the allowance ───────────────────────────────────────────────
step('nothing new → "up to date"', ci.summaryStatus({ summary: 'x', covers_until: big[899].sent_at }, big).state === 'up_to_date');
step('3 new → "new" with a count', (() => { const s = ci.summaryStatus({ summary: 'x', covers_until: big[896].sent_at }, big); return s.state === 'new' && s.new_count === 3; })());
step('pressing it when up to date costs nothing (refused)', ci.canGenerate({ status: { state: 'up_to_date' }, usedToday: 0, perUserLimit: 15 }).reason === 'up_to_date');
step('the per-person daily allowance is enforced', ci.canGenerate({ status: { state: 'new' }, usedToday: 15, perUserLimit: 15 }).reason === 'daily_limit');
step('"rewrite anyway" works once a day per client', ci.canGenerate({ status: { state: 'up_to_date' }, usedToday: 1, perUserLimit: 15, force: true, lastForcedAt: new Date(NOW - 3600000).toISOString(), now: NOW }).reason === 'rewrite_used_today'
  && ci.canGenerate({ status: { state: 'up_to_date' }, usedToday: 1, perUserLimit: 15, force: true, lastForcedAt: new Date(NOW - 2 * DAY).toISOString(), now: NOW }).allowed);
step('an allowance of 0 means no AI summaries', ci.canGenerate({ status: { state: 'new' }, usedToday: 0, perUserLimit: 0 }).reason === 'no_allowance');

// ── checked, not trusted ───────────────────────────────────────────────────
const src = req.system + '\n' + req.prompt;
const good = ci.parseSummary('{"summary":"Maria at Acme keeps asking for more profiles. We sent candidates regularly for two years.","next_steps":[{"id":"send_profiles","why":"She asked for more."}]}');
step('a grounded summary passes', ci.checkSummary(good, { sourceText: src, playbook: pb }).ok);
const bad1 = ci.parseSummary('{"summary":"Maria agreed to a fee of $25,000 for the next two roles, which is great news.","next_steps":[]}');
step('an invented price is rejected', ci.checkSummary(bad1, { sourceText: src, playbook: pb }).violations.some(v => v.code === 'invented_figure'));
const bad2 = ci.parseSummary('{"summary":"Things are moving along well with this client overall.","next_steps":[{"id":"send_invoice","why":"x"}]}');
step('a next step outside the playbook is rejected', ci.checkSummary(bad2, { sourceText: src, playbook: pb }).violations.some(v => v.code === 'step_not_in_playbook'));
step('unparseable output is rejected, not shown', !ci.checkSummary(ci.parseSummary('Sure! Here is a summary.'), { sourceText: src }).ok);

// ── the free summary ───────────────────────────────────────────────────────
const waiting = [
  { id: 'a', direction: 'outbound', sent_at: '2026-09-10T10:00:00Z', text: 'Here are two profiles.' },
  { id: 'b', direction: 'inbound', sent_at: '2026-09-20T10:00:00Z', from: 'maria@acme.com', person: 'Maria', text: 'What are your rates?', facts: ci.factsForMessage('What are your rates?', '2026-09-20T10:00:00Z') },
];
const rs = ci.rulesSummary(ci.buildLedger(waiting, { now: NOW }), pb);
step('the free summary says they are waiting on you', /haven't replied/.test(rs.summary) && rs.next_steps[0] && rs.next_steps[0].id === 'reply', rs.summary);
step('an industry playbook changes the allowed steps', ci.playbookFor('services').next_steps.some(s => s.id === 'send_quote') && !ci.playbookFor('services').next_steps.some(s => s.id === 'send_profiles'));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
