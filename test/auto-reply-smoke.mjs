// AN AUTOMATIC REPLY IS NOT AN ANSWER (owner, 14 Oct: leads that only sent an out-of-office were being marked Connected).
// services/auto-reply.js is the one rule. Pinned with real wording — what must be caught AND what must not:
//   * Outlook's "Automatic reply:" subject, Gmail's vacation responder header, an out-of-office body, a ticket system's
//     "we received your message" are all automatic;
//   * a person's real reply is never automatic — including one that merely MENTIONS being away, a short "yes", a request
//     to be removed, and a reply with an auto-reply quoted underneath it.
// Usage: node test/auto-reply-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyAutoReply, isAutoReply } = require('../services/auto-reply.js');
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
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
