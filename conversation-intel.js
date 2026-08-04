// ============================================================================
// CONVERSATION INTELLIGENCE — read a thread, say what is going on and who owes
// whom a reply. Step 4 of docs/AUTONOMOUS_ENGINE_PLAN.md.
//
// RULES-FIRST, AND DELIBERATELY SO
// There is no funded ANTHROPIC_API_KEY, and per the plan nothing here may
// depend on one. That is less of a compromise than it sounds, because the
// highest-value signals in a recruiting thread are timing and direction, not
// language nuance:
//
//   "They asked about rates on the 12th. You haven't replied in 6 days."
//
// That sentence needs a clock and a question mark, not a language model. The AI
// seam (richer summaries, subtle objection detection) plugs in behind
// `analyzeThread`'s output shape and changes nothing about its callers.
//
// EVERYTHING HERE IS PURE. No database, no network, no `new Date()` without an
// injectable override — so the whole engine is testable against fixed clocks,
// which matters when every headline it writes is a claim about elapsed time.
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

// Storage growth is the real risk on free Supabase (the plan says so
// explicitly), and a quoted reply chain doubles in size with every message. So
// bodies are quote-stripped and trimmed before they are ever stored.
const MAX_STORED_BODY = 4000;

// ── Quote stripping ─────────────────────────────────────────────────────────
// Removes the quoted history, so "what did they actually say this time" is what
// gets stored and analysed. Without this, intent keywords match against text
// from three messages ago and every thread looks like it mentions everything.
const QUOTE_MARKERS = [
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*_{5,}\s*$/m,                                  // Outlook's divider
  /^\s*From:\s.+\n\s*Sent:\s.+$/im,                  // Outlook header block
  /^\s*On .{5,120}\bwrote:\s*$/im,                   // Gmail/Apple "On <date> X wrote:"
  /^\s*On .{5,120},\s.+\bwrote:\s*$/im,
  /^\s*El .{5,120}\bescribió:\s*$/im,
  /^\s*Le .{5,120}\ba écrit\s*:\s*$/im,
  /^\s*>{1,}\s?.*$/m,                                // plain-text quoting
];

// Sign-offs that are noise for intent detection. Kept conservative: cutting too
// eagerly loses real content, and a stray signature is far cheaper than that.
const SIGNATURE_MARKERS = [
  /^\s*--\s*$/m,
  /^\s*Sent from my (iPhone|iPad|Android|Samsung|mobile)\b.*$/im,
  /^\s*Get Outlook for (iOS|Android)\b.*$/im,
  /^\s*This email and any attachments are confidential\b/im,
  /^\s*CONFIDENTIALITY NOTICE\b/im,
];

function htmlToText(input) {
  if (!input) return '';
  let s = String(input);
  if (!/<[a-z!/][\s\S]*>/i.test(s)) return s;   // already plain text
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  // Gmail and Outlook both wrap the quoted chain in a marked container — drop
  // it wholesale before flattening, which is far more reliable than matching
  // the "On ... wrote:" line inside the resulting soup.
  s = s.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ');
  s = s.replace(/<div[^>]*(gmail_quote|OutlookMessageHeader|moz-cite-prefix)[^>]*>[\s\S]*$/i, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  return s;
}

function stripQuotedText(body) {
  let text = htmlToText(body || '');
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  text = text.slice(0, cut);
  for (const re of SIGNATURE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index > 0) text = text.slice(0, m.index);
  }
  return text
    .replace(/\r/g, '')
    // Flattening inline tags (<b>, <span>) leaves runs of spaces and a gap
    // before punctuation. Collapse them: the result is what gets stored AND
    // what the intent regexes run against, so "rate ," must read as "rate,".
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Quote-strip + trim, ready to store. */
function cleanForStorage(body, maxLen = MAX_STORED_BODY) {
  const t = stripQuotedText(body);
  return t.length > maxLen ? t.slice(0, maxLen - 1) + '…' : t;
}

// ── Signals ─────────────────────────────────────────────────────────────────

// A question mark inside a quoted chain or a URL is not a question TO US, so
// this runs on quote-stripped text only.
function hasQuestion(text) {
  const t = stripQuotedText(text);
  if (/\?/.test(t.replace(/https?:\/\/\S+/g, ''))) return true;
  // Polite indirect asks that carry no question mark — common in recruiting.
  return /\b(could you|can you|would you|let me know|please (send|share|confirm|advise)|any update|when can|what (is|are) the)\b/i.test(t);
}

// Intent floor. Ordered: the first match wins, so the most consequential
// (someone withdrawing) is checked before the merely informative.
const INTENTS = [
  { id: 'unsubscribe',  label: 'Asked to stop contact', tone: 'bad',
    re: /\b(unsubscribe|opt.?out|remove me|stop (emailing|contacting)|take me off)\b/i },
  { id: 'not_interested', label: 'Not interested', tone: 'bad',
    re: /\b(not interested|no longer interested|we'?re good|pass on this|not a fit|no thanks|not looking)\b/i },
  { id: 'out_of_office', label: 'Out of office', tone: 'neutral',
    re: /\b(out of (the )?office|on (annual |holiday )?leave|on vacation|away from my desk|maternity|paternity)\b/i },
  { id: 'wrong_person', label: 'Wrong person — asked to redirect', tone: 'neutral',
    re: /\b(wrong person|not the right person|i don'?t handle|you (should|may want to) (contact|reach|speak)|forwarded (this )?to)\b/i },
  { id: 'defer',        label: 'Asked to circle back later', tone: 'neutral',
    re: /\b(circle back|next quarter|next month|later in the year|not (right )?now|revisit|reach out (again )?in|check back)\b/i },
  { id: 'meeting',      label: 'Wants to talk', tone: 'good',
    re: /\b(schedule a call|set up a (call|meeting)|book a (call|time)|calendly|hop on a call|happy to chat|let'?s (talk|connect)|available (for|to) (a )?(call|chat))\b/i },
  { id: 'rates',        label: 'Asked about rates or budget', tone: 'good',
    re: /\b(rate|rates|budget|pricing|price|cost|bill rate|pay rate|compensation|salary|ctc)\b/i },
  { id: 'send_info',    label: 'Asked us to send something', tone: 'good',
    re: /\b(send (me|us|over)|share (the|your)|forward (me|the)|can you provide|resume|cv|jd|job description|profiles?)\b/i },
  { id: 'interested',   label: 'Interested', tone: 'good',
    re: /\b(interested|sounds good|keen|works for me|yes(,| ) please|go ahead|looks good|let'?s do it)\b/i },
];

function classifyIntent(text) {
  const t = stripQuotedText(text);
  for (const i of INTENTS) if (i.re.test(t)) return { id: i.id, label: i.label, tone: i.tone };
  return null;
}

// Commitment / promised-date extraction. Feeds overdue detection: "you said
// you'd follow up after the 15th, and it is the 20th."
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
function extractCommitments(text, now = Date.now()) {
  const t = stripQuotedText(text);
  const out = [];
  const base = new Date(now);

  const rel = [
    { re: /\bnext week\b/i,        days: 7,  label: 'next week' },
    { re: /\bnext month\b/i,       days: 30, label: 'next month' },
    { re: /\bin (a|1) week\b/i,    days: 7,  label: 'in a week' },
    { re: /\bin (\d{1,2}) days?\b/i, label: 'in N days' },
    { re: /\bin (\d{1,2}) weeks?\b/i, label: 'in N weeks', weeks: true },
    { re: /\btomorrow\b/i,         days: 1,  label: 'tomorrow' },
    { re: /\bend of (the )?week\b/i, days: 5, label: 'end of week' },
    { re: /\bend of (the )?month\b/i, days: 21, label: 'end of month' },
  ];
  for (const r of rel) {
    const m = r.re.exec(t);
    if (!m) continue;
    let days = r.days;
    if (r.label === 'in N days') days = parseInt(m[1], 10);
    if (r.weeks) days = parseInt(m[1], 10) * 7;
    if (!Number.isFinite(days)) continue;
    out.push({ kind: 'relative', phrase: m[0], due: new Date(base.getTime() + days * DAY_MS).toISOString() });
  }

  // "after the 15th" / "on the 3rd" — day-of-month, resolved to the next
  // occurrence so a date already past this month means next month.
  const dom = /\b(?:after|on|by)\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/i.exec(t);
  if (dom) {
    const day = parseInt(dom[1], 10);
    if (day >= 1 && day <= 31) {
      const d = new Date(base.getFullYear(), base.getMonth(), day);
      if (d.getTime() < base.getTime()) d.setMonth(d.getMonth() + 1);
      out.push({ kind: 'day_of_month', phrase: dom[0], due: d.toISOString() });
    }
  }

  // "March 14", "14 March", "Mar 14th"
  const named = new RegExp(`\\b(?:(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2})|(\\d{1,2})\\s+(${MONTHS})[a-z]*)\\b`, 'i').exec(t);
  if (named) {
    const monthStr = (named[1] || named[4] || '').toLowerCase().slice(0, 3);
    const dayStr = named[2] || named[3];
    const mi = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(monthStr);
    const day = parseInt(dayStr, 10);
    if (mi > -1 && day >= 1 && day <= 31) {
      const d = new Date(base.getFullYear(), mi, day);
      if (d.getTime() < base.getTime() - 2 * DAY_MS) d.setFullYear(d.getFullYear() + 1);
      out.push({ kind: 'named_date', phrase: named[0], due: d.toISOString() });
    }
  }
  return out;
}

// ── The thread reader ───────────────────────────────────────────────────────

const fmtDays = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

/**
 * Read a whole thread and say what state it is in.
 *
 * messages: [{ direction: 'inbound'|'outbound', sent_at, body, from }]
 *           order does not matter — they are sorted here.
 *
 * Returns a stable shape; `headline` is the plain-English line the UI shows.
 */
function analyzeThread(messages, opts = {}) {
  const now = opts.now || Date.now();
  const list = (messages || [])
    .filter(m => m && m.sent_at)
    .map(m => ({ ...m, _t: new Date(m.sent_at).getTime() }))
    .filter(m => Number.isFinite(m._t))
    .sort((a, b) => a._t - b._t);

  if (!list.length) {
    return {
      state: 'no_contact', waiting_on: null, headline: 'No messages yet.',
      needs_reply: false, question_pending: false, intent: null, commitments: [],
      days_since_inbound: null, days_since_outbound: null, message_count: 0,
      last_direction: null, ever_replied: false, priority: 0,
    };
  }

  const inbound = list.filter(m => m.direction === 'inbound');
  const outbound = list.filter(m => m.direction === 'outbound');
  const last = list[list.length - 1];
  const lastIn = inbound[inbound.length - 1] || null;
  const lastOut = outbound[outbound.length - 1] || null;
  const daysSince = (m) => (m ? Math.floor((now - m._t) / DAY_MS) : null);
  const daysSinceInbound = daysSince(lastIn);
  const daysSinceOutbound = daysSince(lastOut);

  const questionPending = !!lastIn && last.direction === 'inbound' && hasQuestion(lastIn.body || '');
  const intent = lastIn ? classifyIntent(lastIn.body || '') : null;
  // Commitments resolve against WHEN THE MESSAGE WAS SENT, not now. "next week"
  // said twelve days ago came due five days ago; resolving it against the
  // current clock would push it perpetually into the future and no promise
  // would ever be flagged as overdue.
  const commitments = lastIn ? extractCommitments(lastIn.body || '', lastIn._t) : [];

  // State is deliberately coarse. These are the distinctions that change what
  // the user should DO; finer shades would be noise on a daily queue.
  let state, waitingOn, headline;
  if (!inbound.length) {
    state = 'awaiting_first_reply';
    waitingOn = 'them';
    headline = `Sent ${fmtDays(daysSinceOutbound)} ago · no reply yet.`;
  } else if (last.direction === 'inbound') {
    waitingOn = 'you';
    if (intent && intent.id === 'unsubscribe') {
      state = 'opted_out';
      headline = 'They asked to stop being contacted. Do not email again.';
    } else if (intent && intent.id === 'not_interested') {
      state = 'closed_lost';
      headline = `They said no ${fmtDays(daysSinceInbound)} ago.`;
    } else {
      state = 'needs_reply';
      const what = questionPending ? 'They asked a question'
        : intent ? intent.label
        : 'They replied';
      headline = daysSinceInbound === 0
        ? `${what} today. You haven't replied.`
        : `${what} ${fmtDays(daysSinceInbound)} ago. You haven't replied.`;
    }
  } else {
    // We spoke last and they had replied before — the ball is with them.
    state = 'awaiting_them';
    waitingOn = 'them';
    headline = `You replied ${fmtDays(daysSinceOutbound)} ago · waiting on them.`;
  }

  const needsReply = state === 'needs_reply';

  // Priority drives the daily queue's ordering. Deliberately simple and
  // explainable — every point is defensible out loud, which matters because the
  // UI shows the reason next to the item.
  let priority = 0;
  if (needsReply) {
    priority = 60
      + Math.min(30, (daysSinceInbound || 0) * 5)   // staleness, capped
      + (questionPending ? 10 : 0)
      + (intent && intent.tone === 'good' ? 10 : 0);
  } else if (state === 'awaiting_them' || state === 'awaiting_first_reply') {
    const idle = state === 'awaiting_them' ? daysSinceOutbound : daysSinceOutbound;
    priority = idle >= 3 ? Math.min(45, 10 + idle * 3) : 0;  // nudge-worthy only after 3 days
  }
  if (state === 'opted_out' || state === 'closed_lost') priority = 0;

  return {
    state, waiting_on: waitingOn, headline,
    needs_reply: needsReply,
    question_pending: questionPending,
    intent, commitments,
    days_since_inbound: daysSinceInbound,
    days_since_outbound: daysSinceOutbound,
    message_count: list.length,
    last_direction: last.direction,
    ever_replied: inbound.length > 0,
    priority: Math.round(priority),
  };
}

module.exports = {
  stripQuotedText, htmlToText, cleanForStorage,
  hasQuestion, classifyIntent, extractCommitments,
  analyzeThread,
  INTENTS, MAX_STORED_BODY, DAY_MS,
};
