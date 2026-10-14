// A CLIENT WHO SAYS NO IS REJECTED, NOT CONNECTED (owner, 14 Oct: "emails in which clients say not interested or unsubscribe are being changed
// to Connected — those should be Rejected").
//
// The reply sweep moved a lead from Assigned to Connected on ANY answer from a contact, so "No thank you, we hire via Indeed" and
// "UNSUBSCRIBE" both read as interest (four such leads had to be moved by hand). This decides, from the NEW text of a reply, whether it
// is a clear NO. It is deliberately cautious, because a wrong "no" files a live prospect away:
//   * UNSUBSCRIBE / "remove me" / "stop contacting" is absolute — they asked us to stop; it is a no whatever else is said;
//   * a plain "not interested", "no thanks", "we don't use agencies", "we're all set", "not hiring" is a no — UNLESS the same reply
//     also asks for something ("send me", "what are your fees", "call me", a resume or profiles…) or puts it off ("for now", "next
//     quarter", "keep us in mind") — a mixed or soft reply is left for a person (it stays Connected, as before);
//   * quoted text is never read (the quote of our own email says "no charge"), only what the person wrote.
// PURE. `classifyDecline(msg)` → { decline, why: 'unsubscribe' | 'declined' | null }.

const { plainStart } = require('./auto-reply');

const UNSUBSCRIBE = /\b(?:unsubscribe|opt[\s-]?out|remove me|take me off|stop (?:emailing|contacting|sending|messaging)|do not (?:contact|email) (?:me|us)|don'?t (?:contact|email) (?:me|us)|please do not (?:contact|email))\b/i;
const NO = /\b(?:not interested|no longer interested|no,? thank(?:s| you)|we(?:'re| are) (?:all )?(?:good|set|fine|covered)|we do(?: not|n'?t) (?:use|work with|need|accept) (?:any )?(?:outside |external |third[\s-]party )?(?:agenc|recruit|staffing|vendor|resume)|(?:do not|don'?t) need (?:any )?(?:outside )?(?:help|agenc|recruit|staffing)|not (?:currently )?(?:hiring|looking|accepting)|pass on this|not a fit|we hire (?:only )?(?:via|through|directly|internally|from)|no (?:open|current) (?:position|role|opening)s?)\b/i;
const ASKS = /\b(?:send (?:me|us|over)|what(?:'s| is| are) (?:your|the) (?:fee|rate|charge|cost|price)s?|how much|call me|give me a call|let'?s (?:talk|chat|connect|set up|schedule)|schedule|set up a (?:call|time|meeting)|resumes?|profiles?|candidates? (?:you|that)|interested in (?:seeing|reviewing|learning|talking|hearing)|tell me more|more (?:info|information|details))\b/i;
const SOFT = /\b(?:for now|right now|at the moment|at this time|for the time being|later|next (?:quarter|month|year|week)|in the future|keep (?:us|me) in mind|circle back|revisit|check back|reach out (?:again )?(?:in|later))\b/i;

function classifyDecline(msg) {
  const text = plainStart(msg);
  if (!text) return { decline: false, why: null };
  if (UNSUBSCRIBE.test(text)) return { decline: true, why: 'unsubscribe' };
  if (NO.test(text) && !ASKS.test(text) && !SOFT.test(text)) return { decline: true, why: 'declined' };
  return { decline: false, why: null };
}

module.exports = { classifyDecline };
