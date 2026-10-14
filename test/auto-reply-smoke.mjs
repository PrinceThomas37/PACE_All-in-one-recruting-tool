// AN AUTOMATIC REPLY IS NOT AN ANSWER (owner, 14 Oct: leads that only sent an out-of-office were being marked Connected).
// services/auto-reply.js is the one rule. Pinned with real wording — what must be caught AND what must not:
//   * Outlook's "Automatic reply:" subject, Gmail's vacation responder header, an out-of-office body, a ticket system's
//     "we received your message" are all automatic;
//   * a person's real reply is never automatic — including one that merely MENTIONS being away, a short "yes", a request
//     to be removed, and a reply with an auto-reply quoted underneath it.
// Usage: node test/auto-reply-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyAutoReply, isAutoReply, returnDate } = require('../services/auto-reply.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (c ? '' : ' — ' + d)); };
const msg = (subject, body, headers, type) => ({ subject, body: { contentType: type || 'text', content: body }, bodyPreview: String(body).slice(0, 300),
  internetMessageHeaders: Object.entries(headers || {}).map(([name, value]) => ({ name, value })) });

// ── caught ──
const owner = msg('Automatic reply: Commercial Electrical Superintendent - candidates ready',
  'I am currently out of the office, returning Monday, October 12th, 2026.\n\nIf your matter is urgent, please contact Nicole Rocklin, nrocklin@thomaselectricalinc.com\n\nI will respond to your message as soon as possible upon my return.');
ok('the owner\'s own example (Outlook out-of-office) is automatic', isAutoReply(owner));
ok('…and reads as an out-of-office', classifyAutoReply(owner).kind === 'out_of_office');
ok('a Gmail vacation responder is caught by its header alone', classifyAutoReply(msg('Re: Quick intro', 'Thanks!', { 'Auto-Submitted': 'auto-replied' })).why === 'header');
ok('X-Autoreply header', isAutoReply(msg('Re: Intro', 'Hello', { 'X-Autoreply': 'yes' })));
ok('Precedence: auto_reply', isAutoReply(msg('Re: Intro', 'Hello', { Precedence: 'auto_reply' })));
ok('Auto-Submitted: no is NOT automatic (that is how a person\'s mail says it)', !isAutoReply(msg('Re: Intro', 'Sounds good, send resumes.', { 'Auto-Submitted': 'no' })));
ok('subject "Out of Office"', isAutoReply(msg('Out of Office', 'Back soon.')));
ok('subject "Auto: …"', isAutoReply(msg('Auto: Re: your candidates', 'x')));
ok('an HTML out-of-office body, no useful subject', isAutoReply(msg('Re: Candidates ready', '<html><body><p>Thank you for your email.</p><p>I am out of the office until Monday 19 Oct and will respond upon my return.</p></body></html>', {}, 'html')));
ok('a "we received your message" acknowledgement', isAutoReply(msg('Re: Hiring', 'Thank you for contacting us. We have received your message and will get back to you within 2 business days.')));
ok('"this is an automated response"', isAutoReply(msg('Re: Hiring', 'This is an automated response. Please do not reply to this email.')));

// ── not caught: people ──
const people = {
  'a real "yes, send profiles"': msg('Re: Candidates for Foreman', 'Yes, please send over a few profiles. We are hiring two foremen.'),
  'Sara\'s request to be removed (screenshot 1)': msg('Re: Residential Construction Controller – candidate pool challenge', 'Thank you for reaching out. Please remove me from your list. We are not hiring.'),
  'a reply that mentions being away': msg('Re: Foreman role', 'I\'m out of the office Friday, can you call me Monday morning about the terms?'),
  'a short "interested"': msg('Re: Foreman role', 'Interested. What are your fees?'),
  'a human "I will get back to you"': msg('Re: Foreman role', 'Thanks for this. Let me review with my partner and I will get back to you.'),
  'a reply with an auto-reply QUOTED below it': msg('Re: Candidates', 'Great, I would like to see them. Call me at 555-0100.\n\n> I am currently out of the office, returning Monday and will respond upon my return.'),
  'empty message': msg('', ''),
};
for (const [name, m] of Object.entries(people)) ok('a person is not automatic: ' + name, !isAutoReply(m), JSON.stringify(classifyAutoReply(m)));
ok('null is not automatic and does not throw', !isAutoReply(null));
// ── a read receipt is a machine too (found on the live data: "Read: No Hire No Fee…" had made a lead Connected) ──
const receipt = msg('Read: No Hire No Fee | Physician Assistant in South San Francisco, CA', 'Your message\n\n To: James Hu\n Subject: No Hire No Fee | Physician Assistant\n Sent: Thursday, October 8, 2026 12:26:33 PM\n\n was read on Thursday, October 8, 2026 2:56:00 PM (UTC-08:00).');
ok('a read receipt is automatic, and says so', classifyAutoReply(receipt).auto && classifyAutoReply(receipt).kind === 'receipt');
ok('a person whose reply merely begins with "Read:" is not a receipt', !isAutoReply(msg('Read: the candidate list', 'I read it. Send me two more profiles please.')));

// ── WHEN THEY ARE BACK (the live out-of-offices, run for real) ──
const at = (body, recv) => ({ subject: '', receivedDateTime: recv, body: { contentType: 'text', content: body } });
const rd = (b, r) => { const x = returnDate(at(b, r)); return x && x.date; };
ok('Thomas Electrical: "returning Monday, October 12th, 2026" → 2026-10-12', rd('I am currently out of the office, returning Monday, October 12th, 2026. If your matter is urgent, please contact Nicole.', '2026-10-09T15:41:00Z') === '2026-10-12');
ok('Venture Visionary: "returning Tuesday, October 13th" (no year) → 2026-10-13', rd('Please know that I am currently out of the office, returning Tuesday, October 13th.', '2026-10-05T14:03:00Z') === '2026-10-13');
ok('Rand: "once I return on Oct 7th" → 2026-10-07', rd('I will be out of the office Oct 5th and 6th. I\'ll respond to emails once I return on Oct 7th.', '2026-10-05T14:03:00Z') === '2026-10-07');
ok('Target Machine: the "back in office" date, not the "closed" date → 2026-10-13', rd('We will be closed on Monday 10/12/2026 for Columbus Day. We will be back in office on Tuesday 10/13/2026.', '2026-10-12T16:57:00Z') === '2026-10-13');
ok('"back Monday" read on a Wednesday → the NEXT Monday', rd('I am away until I am back Monday.', '2026-10-14T10:00:00Z') === '2026-10-19');
ok('"back Monday" read on a Monday → a week later, never today', rd('I am away and back Monday.', '2026-10-12T10:00:00Z') === '2026-10-19');
ok('a month/day well behind us means next year ("return January 5" read in December)', rd('I am away. I return January 5.', '2026-12-20T10:00:00Z') === '2027-01-05');
ok('Envita: a return date that is ALREADY past ("September 10th" on 9 Oct) pauses nothing', rd('I am currently out of office without access to phone or email. I will return September 10th, 2026', '2026-10-09T14:39:00Z') === null);
ok('3 Tier Alaska: "no longer with the company" has no return date', rd('Emily Banks is no longer with 3 Tier Alaska. Please direct any inquiries to accounting@3tieralaska.com.', '2026-09-29T16:31:00Z') === null);
ok('a date with no return word before it is not a return date ("Meeting on October 20th")', rd('I am out of the office. Our meeting is on October 20th.', '2026-10-14T10:00:00Z') === null);
ok('a date more than four months away is not believed', rd('Out of office, returning March 3rd.', '2026-10-14T10:00:00Z') === null);
ok('no message and no text do not throw', returnDate(null) === null && returnDate(at('', '2026-10-14T10:00:00Z')) === null);
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
