// IS THIS INBOUND MESSAGE A PERSON ANSWERING, OR A MACHINE? (owner, 14 Oct: "a lead that gets an automated reply is being marked
// as Connected — Connected is when the client is interested in reviewing profiles or our terms … it happens very frequently.")
//
// The reply sweep (index.js processInboundMessages) treated every message from a contact as an answer: it moved the lead to
// Connected, stamped replied_at and stopped the follow-ups. An out-of-office or "we received your message" reply is none of
// those. This is the ONE place that decides which messages are automatic, so the sweep, and anything that later wants to show
// "auto-replied", ask the same question.
//
// PURE: no database, no clock. Takes the message in Graph's shape (Gmail is reshaped to it by gmail-provider.normalizeMessage).
//
// Three signals, strongest first. A header is the sender's own mail server saying "a machine wrote this" (RFC 3834) — it is
// trusted on its own. A subject that BEGINS with the auto-reply wording ("Automatic reply:") is what Outlook writes — trusted on
// its own. Words in the body are the weakest evidence, so the body must carry TWO things together (an away/received statement
// AND a promise to respond or a return) in its opening lines; one stray phrase in a real reply ("I'm out of the office Friday,
// can you call Monday?") is not enough. A wrong "automatic" verdict costs a real reply being tagged instead of counted, so the
// body test is deliberately narrow; a wrong "human" verdict is the old behaviour.

const FIRST_CHARS = 700;

function headerMap(msg) {
  const out = {};
  for (const h of (msg && msg.internetMessageHeaders) || []) {
    if (h && h.name) out[String(h.name).toLowerCase()] = String(h.value == null ? '' : h.value).toLowerCase();
  }
  return out;
}

// Tags out, entities flattened, whitespace collapsed — enough to read the opening of an HTML email as words.
function plainStart(msg) {
  const raw = (msg && msg.body && msg.body.content) || (msg && msg.bodyPreview) || '';
  const type = String((msg && msg.body && msg.body.contentType) || '').toLowerCase();
  let t = String(raw);
  if (type === 'html' || /<\/?(p|div|br|span|body|html)\b/i.test(t)) {
    t = t.replace(/<(style|script|head|blockquote)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ');
  }
  t = t.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"');
  // Only the NEW text: a person's reply with an out-of-office quoted underneath it is still a person.
  t = t.split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join('\n');
  const cut = t.search(/\n\s*(?:on .{5,120} wrote:|-{2,}\s*original message\s*-{2,}|from:\s.+\n\s*(?:sent|date):)/i);
  if (cut > 0) t = t.slice(0, cut);
  return t.replace(/\s+/g, ' ').trim().slice(0, FIRST_CHARS);
}

// A read receipt ("Read: <subject>", "Your message … was read on …") is a machine saying the email was opened — not a person answering.
const SUBJECT_RECEIPT = /^\s*(?:(?:re|fw|fwd)\s*:\s*)*(?:read|not read)\s*:\s*\S/i;
const BODY_RECEIPT = /^\s*your message\b[\s\S]{0,400}?\bwas (?:read|displayed|deleted without being read)\b/i;
const SUBJECT_AUTO = /^\s*(?:(?:re|fw|fwd)\s*:\s*)*(?:automatic(?:ally)?\s+(?:reply|response|generated)|auto[\s-]?(?:reply|response|generated|submitted)|autoreply|auto:|out of (?:the )?office|out-of-office|\booo\b|away from (?:the )?office|vacation (?:reply|response|auto)|i am (?:currently )?(?:out of|away)|i'?m (?:currently )?(?:out of|away))/i;

const BODY_SAYS_AUTO = /\b(?:this is an?\s+)?(?:automatic|automated|auto)[\s-]?(?:reply|response|message|generated (?:reply|response|message|email))\b|\bthis (?:email|message|mailbox) is (?:automatically|auto)[\s-]?(?:generated|sent|monitored)\b|\bdo not reply to this (?:email|message)\b/i;
const BODY_AWAY = /\b(?:out of (?:the )?office|away from (?:the |my )?(?:office|desk)|on (?:annual |paid |parental |maternity |paternity |medical )?leave|on vacation|on holiday|out of town|travell?ing|(?:will be |am |i'?m )(?:currently )?(?:out|away)\b|limited (?:access|email)|(?:we|i) (?:have |'ve )?received your (?:e-?mail|message|inquiry|enquiry|request|resume|application))/i;
const BODY_PROMISE = /\b(?:return(?:ing|s)?|back (?:on|in|at|by)|until|will (?:respond|reply|get back|be in touch|review|have limited)|respond(?:ing)? (?:upon|when|as soon|to your)|repl(?:y|ying) (?:upon|when|as soon)|get back to you|within \d+ (?:business )?(?:hours?|days?)|if (?:your|this) (?:matter|request|issue) is urgent|for urgent)/i;

// → { auto: boolean, why: 'header' | 'subject' | 'body' | null, kind: 'out_of_office' | 'auto_reply' | null }
function classifyAutoReply(msg) {
  if (!msg) return { auto: false, why: null, kind: null };
  const h = headerMap(msg);
  const submitted = h['auto-submitted'];
  const headerAuto =
    (submitted !== undefined && submitted !== '' && !/^no\b/.test(submitted)) ||   // auto-replied / auto-generated
    h['x-autoreply'] !== undefined || h['x-autorespond'] !== undefined ||
    /\bauto[_-]?reply\b/.test(h['precedence'] || '') ||
    /\b(?:oof|autoreply)\b/.test(h['x-auto-response-suppress'] || '') ||
    (h['x-ms-exchange-generated-message-source'] || '').indexOf('mailbox rules agent') >= 0;
  const subject = String(msg.subject || '');
  const start = plainStart(msg);
  const away = BODY_AWAY.test(start);
  const kindOf = () => (/\bout of (?:the )?office|\booo\b|away from|on (?:\w+ )?leave|vacation|holiday|out of town|travell?ing|returning/i.test(subject + ' ' + start) ? 'out_of_office' : 'auto_reply');

  if (SUBJECT_RECEIPT.test(subject) && BODY_RECEIPT.test(start)) return { auto: true, why: 'receipt', kind: 'receipt' };
  if (headerAuto) return { auto: true, why: 'header', kind: kindOf() };
  if (SUBJECT_AUTO.test(subject)) return { auto: true, why: 'subject', kind: kindOf() };
  if (BODY_SAYS_AUTO.test(start)) return { auto: true, why: 'body', kind: kindOf() };
  if (away && BODY_PROMISE.test(start)) return { auto: true, why: 'body', kind: kindOf() };
  return { auto: false, why: null, kind: null };
}

const isAutoReply = (msg) => classifyAutoReply(msg).auto;

// ── WHEN IS THEY BACK? (owner, 14 Oct: "pause follow-ups until the return date when an auto-reply says when") ──
// Reads "returning Monday, October 12th, 2026", "once I return on Oct 7th", "back in office on Tuesday 10/13/2026", "back Monday".
// Returns { date: 'YYYY-MM-DD', words } or null. Never guesses: a date that is not after the day the message arrived (an auto-reply
// that says "I will return September 10th" on 9 Oct) or is more than MAX_AHEAD_DAYS away, or a sentence with no return word before
// the date, gives null — and then nothing is paused.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MAX_AHEAD_DAYS = 120;
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const KEY = '(?:return(?:ing|s|ed)?|back|until|resum(?:e|es|ing)|re-?open(?:s|ing)?)\\b';
const DATE_A = MON + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?';
const DATE_B = '(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MON + '\\b(?:,?\\s+(\\d{4}))?';
const DATE_C = '(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?';
const dayNum = (d) => Math.floor(d.getTime() / 86400000);
const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

function returnDate(msg) {
  if (!msg) return null;
  const text = plainStart(msg);
  const recv = new Date(msg.receivedDateTime || Date.now());
  if (isNaN(recv)) return null;
  const today = Date.UTC(recv.getUTCFullYear(), recv.getUTCMonth(), recv.getUTCDate());
  let hit = null;
  const tries = [
    [new RegExp(KEY + '[^.]{0,50}?' + DATE_A, 'i'), (m) => ({ mon: MONTHS[m[1].slice(0, 3).toLowerCase()], day: +m[2], year: m[3] ? +m[3] : null })],
    [new RegExp(KEY + '[^.]{0,50}?' + DATE_B, 'i'), (m) => ({ mon: MONTHS[m[2].slice(0, 3).toLowerCase()], day: +m[1], year: m[3] ? +m[3] : null })],
    [new RegExp(KEY + '[^.]{0,50}?' + DATE_C, 'i'), (m) => ({ mon: +m[1] - 1, day: +m[2], year: m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null })],
  ];
  for (const [re, pick] of tries) {
    const m = re.exec(text);
    if (!m) continue;
    const c = pick(m);
    if (!(c.mon >= 0 && c.mon <= 11 && c.day >= 1 && c.day <= 31)) continue;
    let year = c.year == null ? recv.getUTCFullYear() : c.year;
    let when = Date.UTC(year, c.mon, c.day);
    // no year written: a month/day already well behind us means next year ("return January 5" read in December)
    if (c.year == null && when < today - 60 * 86400000) when = Date.UTC(year + 1, c.mon, c.day);
    hit = { when, words: m[0] };
    break;
  }
  if (!hit) {
    const w = new RegExp('(?:return(?:ing|s)?|back)\\b[^.]{0,30}?\\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\\b', 'i').exec(text);
    if (w) {
      const want = WEEKDAYS[w[1].toLowerCase()], have = recv.getUTCDay();
      hit = { when: today + (((want - have + 7) % 7) || 7) * 86400000, words: w[0] };   // the NEXT such day, never today
    }
  }
  if (!hit) return null;
  const ahead = (hit.when - today) / 86400000;
  if (!(ahead > 0 && ahead <= MAX_AHEAD_DAYS)) return null;
  const d = new Date(hit.when);
  return { date: iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), words: hit.words.slice(0, 80) };
}

module.exports = { classifyAutoReply, isAutoReply, plainStart, returnDate };
