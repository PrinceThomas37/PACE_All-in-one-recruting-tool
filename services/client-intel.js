'use strict';
// ============================================================================
// CLIENT INTELLIGENCE — the rules behind a client's email timeline and its
// "Generate AI summary" button. docs/CLIENT_INTEL_DESIGN.md; the owner's
// decisions D-0039 (off until they say, token/storage designed first),
// D-0040 (owner-only), D-0041 (per-user allowance), D-0042 (a BUTTON, capped
// per click however long the history), D-0043 (Emails tab + daily update).
//
// PURE. No database, no network, no clock unless one is passed in. Every rule
// that decides what is kept, what the AI is shown and what it may say lives
// here, so each is a function a test can call — a rule that lives only inside
// a route can be switched off with `if (false && …)` and a grep-based test
// will go on passing (CLAUDE.md, Session 24).
//
// THE FOUR LAYERS, and which function owns each:
//   1. GATE    — gateMessage / isNoiseSender: keep only mail that belongs to a
//                lead; job-board alerts, account mail and strangers are never
//                stored.
//   2. FILE    — trimStoredText: the new text only, ≤1,500 characters.
//   3. FACTS   — factsForMessage (per message, on arrival) and buildLedger
//                (the whole history, folded into a fixed-size fact sheet).
//   4. SUMMARY — buildSummaryRequest (hard-capped input), parseSummary,
//                checkSummary (never trusted), rulesSummary (the free answer).
// ============================================================================

const intel = require('../conversation-intel');

const DAY_MS = 24 * 60 * 60 * 1000;

// ── the caps (D-0042) — the whole point of the design ──────────────────────
// ~4 characters per token. These are CHARACTER budgets so they can be checked
// without a tokenizer; the provider layer's own budget check still runs.
const CAPS = Object.freeze({
  STORED_TEXT_CHARS: 1500,     // per kept message (layer 2)
  LEDGER_CHARS: 3200,          // ≈ 800 tokens, the whole history as facts
  RECENT_MESSAGES: 8,          // latest messages sent to the AI as text
  RECENT_MSG_CHARS: 1000,      // ≈ 250 tokens each
  PREVIOUS_SUMMARY_CHARS: 900, // ≈ 220 tokens
  PROMPT_CHARS: 13600,         // ≈ 3,400 tokens — the hard ceiling per click
  SUMMARY_MAX_CHARS: 1200,
  MAX_NEXT_STEPS: 3,
});
const estimateTokens = (s) => Math.ceil(String(s || '').length / 4);

// ── 1. THE GATE ─────────────────────────────────────────────────────────────
// Senders that are never a client talking to us. Checked before anything else.
// Measured on the live database (2026-09-24): of 77 stored inbound messages,
// 3 were from a lead's contact; the rest were ZipRecruiter, Glassdoor, Google
// account mail, our own domain and strangers.
const NOISE_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounce[s]?|news(letter)?|marketing|updates?|support|info-noreply|jobs-noreply|calendar-notification|accounts?)([+._-].*)?$/i;
const NOISE_DOMAINS = [
  'ziprecruiter.com', 'glassdoor.com', 'indeed.com', 'indeedemail.com', 'linkedin.com',
  'accounts.google.com', 'google.com', 'microsoft.com', 'microsoftonline.com',
  'contactout.net', 'mailchimp.com', 'hubspot.com', 'sendgrid.net', 'zoom.us',
  'calendly.com', 'docusign.net', 'monster.com', 'dice.com', 'careerbuilder.com',
];
// Never a "company domain": everybody's personal mail lives here, so sharing
// one says nothing about being colleagues.
const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com', 'rediffmail.com',
]);

function normEmail(v) { return String(v || '').trim().toLowerCase(); }
function domainOf(addr) {
  const s = normEmail(addr);
  const at = s.lastIndexOf('@');
  return at > -1 ? s.slice(at + 1) : '';
}
function isPublicDomain(domain) { return PUBLIC_DOMAINS.has(String(domain || '').toLowerCase()); }

function isNoiseSender(addr) {
  const s = normEmail(addr);
  if (!s || s.indexOf('@') < 0) return true;
  const local = s.slice(0, s.lastIndexOf('@'));
  const dom = domainOf(s);
  if (NOISE_LOCAL.test(local)) return true;
  return NOISE_DOMAINS.some(d => dom === d || dom.endsWith('.' + d));
}

/**
 * Should the reply sweep keep this inbound message?
 *
 *   contactMatched   — the sender is a contact on a lead/client
 *   candidateMatched — the sender is a candidate we emailed
 *   threadKnown      — it replies to a thread PACE itself started
 *   ownDomains       — our own company's domains (a colleague is never a client)
 *
 * Returns { keep, reason }. A known contact always wins, even from a public or
 * "noisy-looking" address: a real person replying from gmail.com is exactly who
 * we want. Everything else must pass the noise check AND belong to a thread of
 * ours; a stranger is dropped, never filed.
 */
function gateMessage({ from, contactMatched, candidateMatched, threadKnown, ownDomains } = {}) {
  if (contactMatched) return { keep: true, reason: 'contact' };
  if (candidateMatched) return { keep: true, reason: 'candidate' };
  const dom = domainOf(from);
  if ((ownDomains || []).map(d => String(d).toLowerCase()).includes(dom)) return { keep: false, reason: 'own_domain' };
  if (isNoiseSender(from)) return { keep: false, reason: 'noise' };
  if (threadKnown) return { keep: true, reason: 'our_thread' };
  return { keep: false, reason: 'unknown_sender' };
}

// ── 2. FILE ─────────────────────────────────────────────────────────────────
function trimStoredText(raw) {
  return intel.cleanForStorage(raw, CAPS.STORED_TEXT_CHARS);
}

// ── 3. FACTS ────────────────────────────────────────────────────────────────
// Per message, computed ONCE when it is filed and stored beside it (~300
// bytes). Nothing here is ever re-derived from the inbox.
function factsForMessage(text, sentAt) {
  const body = String(text || '');
  const t = sentAt ? new Date(sentAt).getTime() : Date.now();
  const intent = intel.classifyIntent(body);
  const q = intel.hasQuestion(body) ? firstQuestion(body) : null;
  // The extractor returns the date PHRASE ("next week"); the fact needs the
  // sentence it sits in, or "next week" on its own says nothing.
  const sentences = intel.stripQuotedText(body).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const commitments = intel.extractCommitments(body, Number.isFinite(t) ? t : Date.now())
    .slice(0, 3).map(c => {
      const s = sentences.find(x => c.phrase && x.toLowerCase().indexOf(String(c.phrase).toLowerCase()) > -1);
      return { text: String(s || c.phrase || '').trim().slice(0, 140), due: c.due || null };
    });
  return {
    intent: intent ? intent.id : null,
    question: q,
    commitments,
  };
}
function firstQuestion(body) {
  const parts = String(body || '').replace(/\s+/g, ' ').split(/(?<=[?.!])\s+/);
  const q = parts.find(p => /\?\s*$/.test(p));
  return q ? q.slice(0, 160) : null;
}

/**
 * The whole history, folded into a FIXED-SIZE fact sheet. This is what lets a
 * client with two years of email cost the same as one with five: old history
 * reaches the AI as these facts, never as the emails themselves.
 *
 * messages: [{ id, direction:'inbound'|'outbound', sent_at, from, to, subject,
 *              text, facts, person }]
 */
function buildLedger(messages, opts = {}) {
  const now = opts.now || Date.now();
  const list = (messages || [])
    .filter(m => m && m.sent_at && Number.isFinite(new Date(m.sent_at).getTime()))
    .slice().sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
  if (!list.length) return { empty: true, message_count: 0 };

  const inbound = list.filter(m => m.direction === 'inbound');
  const outbound = list.filter(m => m.direction === 'outbound');
  const thread = intel.analyzeThread(list.map(m => ({ direction: m.direction, sent_at: m.sent_at, body: m.text || '' })), { now });

  const people = {};
  inbound.forEach(m => {
    const k = normEmail(m.from);
    if (!k) return;
    people[k] = people[k] || { email: k, name: m.person || null, messages: 0, last: null };
    people[k].messages++; people[k].last = m.sent_at;
    if (m.person && !people[k].name) people[k].name = m.person;
  });

  // Open questions: asked by them and not followed by any message from us.
  const lastOutT = outbound.length ? new Date(outbound[outbound.length - 1].sent_at).getTime() : 0;
  const openQuestions = inbound
    .filter(m => new Date(m.sent_at).getTime() > lastOutT && m.facts && m.facts.question)
    .map(m => ({ on: day(m.sent_at), text: m.facts.question })).slice(-3);

  // Promises still ahead of us or overdue, newest first, at most three.
  const promises = [];
  inbound.forEach(m => (m.facts && m.facts.commitments || []).forEach(c => promises.push({ on: day(m.sent_at), text: c.text, due: c.due })));

  // Key moments, at most five: first contact, first reply, intent changes, last message.
  const events = [];
  events.push({ on: day(list[0].sent_at), what: (list[0].direction === 'outbound' ? 'We first wrote' : 'They first wrote') });
  if (inbound.length) events.push({ on: day(inbound[0].sent_at), what: 'First reply from them' });
  let lastIntent = null;
  inbound.forEach(m => {
    const it = m.facts && m.facts.intent;
    if (it && it !== lastIntent) { events.push({ on: day(m.sent_at), what: 'They signalled: ' + it.replace(/_/g, ' ') }); lastIntent = it; }
  });
  const last = list[list.length - 1];
  events.push({ on: day(last.sent_at), what: (last.direction === 'outbound' ? 'Our last email' : 'Their last email') });
  const keyEvents = dedupeEvents(events).slice(-5);

  return {
    empty: false,
    message_count: list.length,
    sent_by_us: outbound.length,
    from_them: inbound.length,
    first_contact: day(list[0].sent_at),
    last_contact: day(last.sent_at),
    days_since_last: Math.floor((now - new Date(last.sent_at).getTime()) / DAY_MS),
    state: thread.state,
    headline: thread.headline,
    waiting_on: thread.waiting_on,
    people: Object.values(people).sort((a, b) => b.messages - a.messages).slice(0, 5),
    open_questions: openQuestions,
    promises: promises.slice(-3),
    key_events: keyEvents,
  };
}
function day(v) { try { return new Date(v).toISOString().slice(0, 10); } catch (_) { return null; } }
function dedupeEvents(ev) {
  const seen = new Set();
  return ev.filter(e => { const k = e.on + '|' + e.what; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The ledger as the short text the AI reads. Never longer than LEDGER_CHARS. */
function ledgerText(ledger) {
  if (!ledger || ledger.empty) return 'No emails with this client yet.';
  const lines = [
    `Emails: ${ledger.message_count} (${ledger.sent_by_us} from us, ${ledger.from_them} from them), ${ledger.first_contact} to ${ledger.last_contact}.`,
    `Now: ${ledger.headline}`,
  ];
  if (ledger.people.length) lines.push('People who wrote to us: ' + ledger.people.map(p => (p.name ? p.name + ' <' + p.email + '>' : p.email) + ' ×' + p.messages).join('; ') + '.');
  if (ledger.open_questions.length) lines.push('Unanswered questions: ' + ledger.open_questions.map(q => `(${q.on}) "${q.text}"`).join(' '));
  if (ledger.promises.length) lines.push('Promises they made: ' + ledger.promises.map(p => `(${p.on}) "${p.text}"${p.due ? ' due ' + String(p.due).slice(0, 10) : ''}`).join(' '));
  if (ledger.key_events.length) lines.push('Key moments: ' + ledger.key_events.map(e => `${e.on} ${e.what}`).join('; ') + '.');
  let out = lines.join('\n');
  if (out.length > CAPS.LEDGER_CHARS) out = out.slice(0, CAPS.LEDGER_CHARS - 1) + '…';
  return out;
}

// ── 4. THE SUMMARY ──────────────────────────────────────────────────────────

/** Where the saved summary stands against the messages we now hold. */
function summaryStatus(saved, messages) {
  const list = (messages || []).filter(m => m && m.sent_at);
  if (!saved || !saved.summary) return { state: list.length ? 'none' : 'no_emails', new_count: list.length };
  const cut = saved.covers_until ? new Date(saved.covers_until).getTime() : 0;
  const newer = list.filter(m => new Date(m.sent_at).getTime() > cut);
  return { state: newer.length ? 'new' : 'up_to_date', new_count: newer.length };
}

/**
 * May this person press the button right now? Pure, so the rule is testable.
 *   force   — "Rewrite anyway": once per client per day, so a double click never
 *             doubles the bill.
 */
function canGenerate({ status, usedToday, perUserLimit, lastForcedAt, force, now } = {}) {
  const t = now || Date.now();
  if (status && status.state === 'no_emails') return { allowed: false, reason: 'no_emails' };
  if (status && status.state === 'up_to_date' && !force) return { allowed: false, reason: 'up_to_date' };
  if (force && lastForcedAt && (t - new Date(lastForcedAt).getTime()) < DAY_MS) return { allowed: false, reason: 'rewrite_used_today' };
  const limit = Number.isFinite(Number(perUserLimit)) ? Number(perUserLimit) : 15;
  if (limit <= 0) return { allowed: false, reason: 'no_allowance' };
  if ((usedToday || 0) >= limit) return { allowed: false, reason: 'daily_limit' };
  return { allowed: true, reason: null, left_after: limit - (usedToday || 0) - 1 };
}

/**
 * The latest messages to show the AI as text: only those newer than the saved
 * summary when there is one, newest first, at most RECENT_MESSAGES, each cut
 * to RECENT_MSG_CHARS.
 */
function selectRecent(messages, saved) {
  const cut = saved && saved.covers_until ? new Date(saved.covers_until).getTime() : 0;
  return (messages || [])
    .filter(m => m && m.sent_at && new Date(m.sent_at).getTime() > cut)
    .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))
    .slice(0, CAPS.RECENT_MESSAGES)
    .map(m => ({
      on: day(m.sent_at), direction: m.direction,
      who: m.direction === 'outbound' ? 'Us' : (m.person || m.from || 'Them'),
      subject: String(m.subject || '').slice(0, 120),
      text: String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, CAPS.RECENT_MSG_CHARS),
    }));
}

/**
 * Build the one AI request. The ceiling holds whatever the history: if the
 * pieces add up past PROMPT_CHARS, the OLDEST recent messages are dropped
 * first, then the rest are shortened — the ledger and the rules never are.
 */
function buildSummaryRequest({ playbook, clientName, ledger, messages, saved, now } = {}) {
  const pb = playbook || PLAYBOOKS.recruiting;
  const steps = pb.next_steps.map(s => `- ${s.id}: ${s.label}`).join('\n');
  const system =
    `You summarise a client relationship for a ${pb.name} team. They call the client a "${pb.terms.client}" and a sales opportunity a "${pb.terms.lead}".\n` +
    'Rules:\n' +
    '1. Use ONLY the facts and emails given. Never invent a date, a number, a price, a name or a promise.\n' +
    '2. Write 3 to 5 short plain sentences: where things stand, who is engaged, what is open, what was promised.\n' +
    `3. Then pick at most ${CAPS.MAX_NEXT_STEPS} next steps ONLY from this list, by id, each with a short reason tied to a fact:\n${steps}\n` +
    '4. Reply with ONLY a JSON object: {"summary": "...", "next_steps": [{"id": "...", "why": "..."}]}. No markdown.';
  const recent = selectRecent(messages, saved);
  const prev = saved && saved.summary ? String(saved.summary).slice(0, CAPS.PREVIOUS_SUMMARY_CHARS) : '';
  const head =
    `CLIENT: ${String(clientName || '').slice(0, 120)}\n` +
    `TODAY: ${day(now || Date.now())}\n\n` +
    `FACT SHEET (whole history):\n${ledgerText(ledger)}\n\n` +
    (prev ? `PREVIOUS SUMMARY (${saved.covers_until ? day(saved.covers_until) : 'earlier'}):\n${prev}\n\n` : '');
  const render = (items) => items.map(m => `[${m.on}] ${m.who}${m.subject ? ' — ' + m.subject : ''}: ${m.text}`).join('\n');
  let items = recent.slice();
  const label = prev ? 'NEW EMAILS SINCE THE PREVIOUS SUMMARY (newest first):\n' : 'LATEST EMAILS (newest first):\n';
  let prompt = head + label + render(items);
  const budget = CAPS.PROMPT_CHARS - system.length;
  while (prompt.length > budget && items.length > 1) { items = items.slice(0, -1); prompt = head + label + render(items); }
  if (prompt.length > budget) prompt = prompt.slice(0, budget);
  return {
    system, prompt,
    used_messages: items.length,
    estimated_tokens: estimateTokens(system) + estimateTokens(prompt),
  };
}

function parseSummary(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    if (!p || typeof p.summary !== 'string') return null;
    const steps = Array.isArray(p.next_steps) ? p.next_steps : [];
    return {
      summary: p.summary.trim(),
      next_steps: steps.map(s => (typeof s === 'string' ? { id: s, why: '' } : { id: String(s && s.id || ''), why: String(s && s.why || '').trim() })),
    };
  } catch (_) { return null; }
}

/**
 * CHECKED, NOT TRUSTED — the same rule as the email writer. Returns
 * { ok, violations[] }. A summary that fails is thrown away and the free rules
 * summary is shown instead; it is never "mostly fine".
 *   * next steps must come from the playbook's list;
 *   * no money figure, percentage or email address that is not in the source;
 *   * a sane length.
 */
function checkSummary(parsed, { sourceText, playbook } = {}) {
  const v = [];
  const pb = playbook || PLAYBOOKS.recruiting;
  if (!parsed || !parsed.summary) return { ok: false, violations: [{ code: 'unparseable' }] };
  const s = parsed.summary;
  if (s.length < 20) v.push({ code: 'too_short' });
  if (s.length > CAPS.SUMMARY_MAX_CHARS) v.push({ code: 'too_long' });
  const src = String(sourceText || '');
  const allowed = new Set(pb.next_steps.map(x => x.id));
  (parsed.next_steps || []).forEach(st => { if (!allowed.has(st.id)) v.push({ code: 'step_not_in_playbook', id: st.id }); });
  if ((parsed.next_steps || []).length > CAPS.MAX_NEXT_STEPS) v.push({ code: 'too_many_steps' });
  const all = [s].concat((parsed.next_steps || []).map(x => x.why)).join(' ');
  const figures = all.match(/(?:[$£€₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:k|K|%|USD|INR|dollars))/g) || [];
  figures.forEach(f => { if (src.indexOf(f.replace(/\s/g, '')) < 0 && src.indexOf(f) < 0) v.push({ code: 'invented_figure', text: f }); });
  const emails = all.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  emails.forEach(e => { if (src.toLowerCase().indexOf(e.toLowerCase()) < 0) v.push({ code: 'invented_email', text: e }); });
  return { ok: v.length === 0, violations: v };
}

/**
 * The FREE summary: what shows when AI is off, over the allowance, or wrote
 * something that failed the check. Built from the ledger alone.
 */
function rulesSummary(ledger, playbook) {
  const pb = playbook || PLAYBOOKS.recruiting;
  if (!ledger || ledger.empty) return { summary: 'No emails with this client yet.', next_steps: [], engine: 'rules' };
  const parts = [ledger.headline];
  parts.push(`${ledger.message_count} email${ledger.message_count === 1 ? '' : 's'} since ${ledger.first_contact}: ${ledger.sent_by_us} from us, ${ledger.from_them} from them.`);
  if (ledger.people.length) parts.push('Most in touch: ' + (ledger.people[0].name || ledger.people[0].email) + '.');
  if (ledger.open_questions.length) parts.push(`They asked: "${ledger.open_questions[ledger.open_questions.length - 1].text}"`);
  if (ledger.promises.length) parts.push(`They said: "${ledger.promises[ledger.promises.length - 1].text}"`);
  const pick = (id, why) => { const s = pb.next_steps.find(x => x.id === id); return s ? { id, label: s.label, why } : null; };
  const steps = [];
  if (ledger.state === 'needs_reply') steps.push(pick('reply', ledger.open_questions.length ? 'They asked a question and are waiting on you.' : 'They wrote last and are waiting on you.'));
  else if (ledger.state === 'awaiting_first_reply' && ledger.days_since_last >= 5) steps.push(pick('follow_up', `No reply in ${ledger.days_since_last} days.`));
  else if (ledger.state === 'awaiting_them' && ledger.days_since_last >= 7) steps.push(pick('follow_up', `Quiet for ${ledger.days_since_last} days.`));
  if (ledger.promises.length && ledger.state !== 'needs_reply') steps.push(pick('check_promise', 'They promised something — check whether it happened.'));
  if (ledger.state === 'opted_out' || ledger.state === 'closed_lost') steps.length = 0;
  return { summary: parts.join(' '), next_steps: steps.filter(Boolean).slice(0, CAPS.MAX_NEXT_STEPS), engine: 'rules' };
}

/** Attach each step's label from the playbook (the AI returns ids). */
function labelSteps(steps, playbook) {
  const pb = playbook || PLAYBOOKS.recruiting;
  return (steps || []).map(s => {
    const def = pb.next_steps.find(x => x.id === s.id);
    return def ? { id: s.id, label: def.label, why: s.why || '' } : null;
  }).filter(Boolean);
}

/** A stable marker of what a summary covered: the newest message it saw. */
function coversUntil(messages) {
  const ts = (messages || []).map(m => new Date(m.sent_at).getTime()).filter(Number.isFinite);
  return ts.length ? new Date(Math.max.apply(null, ts)).toISOString() : null;
}

// ── PLAYBOOKS (D-0039 / R-054) ──────────────────────────────────────────────
// What makes the engine RIGHT for a company is data, not code: its words, and
// the next steps it may suggest. Recruiting is preset #1 and matches today's
// product; the others are starting points an admin edits.
const COMMON_STEPS = [
  { id: 'reply', label: 'Reply to their last email' },
  { id: 'follow_up', label: 'Send a follow-up' },
  { id: 'check_promise', label: 'Check on what they promised' },
  { id: 'book_call', label: 'Book a call' },
  { id: 'loop_in_other', label: 'Bring in another person at the client' },
  { id: 'pause', label: 'Leave it for now' },
];
const PLAYBOOKS = {
  recruiting: {
    id: 'recruiting', name: 'recruiting and staffing',
    terms: { client: 'client', lead: 'lead', deal: 'job order' },
    next_steps: COMMON_STEPS.concat([
      { id: 'ask_for_jd', label: 'Ask for the job description' },
      { id: 'send_profiles', label: 'Send candidate profiles' },
      { id: 'book_intake', label: 'Book an intake call for the role' },
      { id: 'discuss_terms', label: 'Agree fee and terms' },
      { id: 'convert_to_job', label: 'Turn this into a job order' },
    ]),
  },
  services: {
    id: 'services', name: 'B2B services',
    terms: { client: 'account', lead: 'lead', deal: 'quote' },
    next_steps: COMMON_STEPS.concat([
      { id: 'book_site_visit', label: 'Book a site visit' },
      { id: 'send_quote', label: 'Send a quote' },
      { id: 'follow_quote', label: 'Follow up on the quote' },
      { id: 'send_contract', label: 'Send the contract' },
    ]),
  },
  software: {
    id: 'software', name: 'B2B software',
    terms: { client: 'account', lead: 'lead', deal: 'opportunity' },
    next_steps: COMMON_STEPS.concat([
      { id: 'book_demo', label: 'Book a demo' },
      { id: 'start_trial', label: 'Start a trial' },
      { id: 'send_proposal', label: 'Send a proposal' },
      { id: 'loop_in_finance', label: 'Bring in their finance / decision maker' },
    ]),
  },
};
function playbookFor(id) { return PLAYBOOKS[id] || PLAYBOOKS.recruiting; }

module.exports = {
  CAPS, PLAYBOOKS, NOISE_DOMAINS, PUBLIC_DOMAINS,
  estimateTokens, normEmail, domainOf, isPublicDomain, isNoiseSender,
  gateMessage, trimStoredText, factsForMessage, buildLedger, ledgerText,
  summaryStatus, canGenerate, selectRecent, buildSummaryRequest,
  parseSummary, checkSummary, rulesSummary, labelSteps, coversUntil, playbookFor,
};
