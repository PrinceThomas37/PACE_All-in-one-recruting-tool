// {{sendercompany}} — "Your company", filled per email ID at SEND time (owner, 8 Oct: "your company name section, so it can be added
// easily for different email IDs"). Proven here:
//   * the token survives queueing (fillTemplate defers it like {{sender}}), is not a "hole" to refuse, and its aliases normalise
//   * a reader that knows the mailbox's company fills it; one that does not leaves it VISIBLE (never blank)
//   * the send gate: an email carrying the token goes out from the mailbox's company — two email IDs, two companies, the same wording —
//     and an email ID with no company is HELD with a reason that sends the person to fix it, never sent with a hole
//   * a failed hold is classified "needs a fix" (no automatic retry loop), and the sent text has the company written into it
// Usage: node test/sender-company-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const V = require('../email-vars.js');
const C = require('../services/sender-company.js');
const retry = require('../services/send-retry.js');

const T = "Hi {{fn}}, I'm {{sender}} with {{sendercompany}}.";
const vars = V.buildEmailVars({ job: { position: 'Estimator', company: { name: 'Acme' } }, contact: { first_name: 'Sam' }, senderDisplayName: V.DEFER_SENDER });
const queued = V.fillTemplate(T, vars);
step('queueing fills the job and contact but leaves {{sender}} AND {{sendercompany}} for the send', queued === "Hi Sam, I'm {{sender}} with {{sendercompany}}.", queued);
step('an alias ({{your_company}} is not one; {{yourcompany}} / {{sender_company}} / {{mycompany}} are) is normalised to the name the send fills', ['{{yourcompany}}', '{{sender_company}}', '{{mycompany}}'].every(a => V.fillTemplate(a, vars) === '{{sendercompany}}'));
step('the token is NOT a hole: the "merge fields PACE could not fill" check lets it through', V.unresolvedVars(queued).length === 0 && V.unresolvedVars('Hi {{nonsense}}').join() === 'nonsense');
const row = { subject: 'About {{sendercompany}}', body: queued, from_email: 'ash@vhc.test' };
let r = V.renderStoredEmail(row, { email_address: 'ash@vhc.test', display_name: 'Ash', sends_as_company: 'VHC Staffing' });
step('a reader that knows the mailbox\'s company fills subject and body', r.subject === 'About VHC Staffing' && r.body === "Hi Sam, I'm Ash with VHC Staffing.", JSON.stringify(r));
r = V.renderStoredEmail(row, { email_address: 'ash@vhc.test', display_name: 'Ash' });
step('one that does not know it leaves the token visible — never a blank like "with ."', /{{sendercompany}}/.test(r.body) && !/with \.$/.test(r.body), r.body);
step('the same wording from two email IDs reads as two companies', V.renderStoredEmail(row, { display_name: 'A', email_address: 'a@x', sends_as_company: 'Alpha Staffing' }).body.endsWith('Alpha Staffing.') && V.renderStoredEmail(row, { display_name: 'B', email_address: 'b@x', sends_as_company: 'Beta Recruiters' }).body.endsWith('Beta Recruiters.'));

// ── the send gate ───────────────────────────────────────────────────────────
const store = [{ key: 'ue_m1_sends_as', value: JSON.stringify({ company: 'VHC Staffing', title: 'Manager', address: '1 Main Street, Dallas TX' }) }, { key: 'ue_m2_sends_as', value: JSON.stringify({ title: 'Manager', address: '1 Main Street, Dallas TX' }) }];
const fake = { from() { let keys = []; const q = { select() { return q; }, in(c, l) { keys = l; return q; }, then(res, rej) { return Promise.resolve({ data: store.filter(x => keys.includes(x.key)), error: null }).then(res, rej); } }; return q; } };
const none = { subject: 'Plain', body: 'No company token here', from_email: 'a@x' };
let g = await C.prepareForSend(fake, none, { id: 'm1', email_address: 'ash@vhc.test' }, 'm1');
step('an email without the token is not touched by the gate (no lookup needed)', g.needs === false);
g = await C.prepareForSend(fake, row, { id: 'm1', email_address: 'ash@vhc.test' }, 'm1');
step('with the token and a company on the mailbox the gate hands back the mailbox WITH its company', g.needs && !g.error && g.company === 'VHC Staffing' && g.mailbox.sends_as_company === 'VHC Staffing' && g.mailbox.id === 'm1');
g = await C.prepareForSend(fake, row, { id: 'm2', email_address: 'ash@other.test' }, 'm2');
step('an email ID with NO company is HELD, with words that name the email ID and say where to fix it', g.needs && /ash@other\.test/.test(g.error) && /Your company/.test(g.error) && !g.mailbox, g.error);
g = await C.prepareForSend(fake, row, { id: 'm9', email_address: 'new@x' }, 'm9');
step('an email ID that has said nothing at all is held too (an unreadable or missing setting is "not said")', !!g.error);
step('…and that hold is a "needs a fix" failure: no automatic retry loop, a person says the company and presses Retry', retry.classifyFailure(g.error) === 'needs_fix', retry.classifyFailure(g.error));
step('a sent email gets the company written into its stored text (history and quoted replies never show the token)', C.fillCompany(row.body, 'VHC Staffing') === "Hi Sam, I'm {{sender}} with VHC Staffing." && C.fillCompany(row.subject, 'VHC Staffing') === 'About VHC Staffing');
step('filling touches ONLY that token', C.fillCompany('{{sender}} {{fn}} {{sendercompany}}', 'X') === '{{sender}} {{fn}} X');
const m = await C.companiesFor(fake, ['m1', 'm2', 'nope']);
step('companies are read per email ID; none said = empty', m.m1 === 'VHC Staffing' && m.m2 === '' && m.nope === '');

console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
