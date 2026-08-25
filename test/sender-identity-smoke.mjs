// The name in the body must always be the person whose mailbox actually sends.
//
// Production regression (2026-08-25): a cold email went out from
// prince.thomas@futeglobal.com, signed "Prince Thomas", whose body opened with
// "I'm Jennifer Thomas at Fute Global LLC". The body name was baked in when the
// email was QUEUED (from a stale/deactivated fallback mailbox) while the From
// address and the signature were resolved when it was SENT, three minutes after
// the lead's sending mailbox had been changed.
//
// These checks pin the fix: queue time leaves {{sender}} alone, send time fills
// body, subject and signature from ONE mailbox row.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ev = require('../email-vars.js');
const sig = require('../email-signature.js');

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── queue time: the token survives ───────────────────────────────────────────
const job = { position: 'HVAC Service Manager', location: 'Las Vegas, NV', company: { name: 'Lees Air' } };
const contact = { first_name: 'Josue' };

const deferred = ev.fillTemplate(
  ev.DEFAULT_TEMPLATES.o1_body,
  ev.buildEmailVars({ job, contact, senderDisplayName: ev.DEFER_SENDER })
);
step('DEFER_SENDER leaves {{sender}} in the queued body', deferred.includes('{{sender}}'));
step('every other variable is still filled at queue time',
  deferred.includes('Josue') && deferred.includes('HVAC Service Manager') && !/{{(?!sender|senderemail)\w+}}/.test(deferred),
  deferred.match(/{{\w+}}/g)?.join(',') || 'none');

const eager = ev.fillTemplate(ev.DEFAULT_TEMPLATES.o1_body, ev.buildEmailVars({ job, contact, senderDisplayName: 'Prince Thomas' }));
step('an explicit name still fills immediately (other callers unchanged)',
  eager.includes("I'm Prince Thomas") && !eager.includes('{{sender}}'));

const blank = ev.buildEmailVars({ job, contact, senderDisplayName: '' });
step("'' still means an empty name, not a deferral", blank.sender === '');
step('omitting senderDisplayName still means an empty name',
  ev.buildEmailVars({ job, contact }).sender === '');

// ── send time: body, subject and signature agree ─────────────────────────────
const mailbox = { email_address: 'prince.thomas@futeglobal.com', display_name: 'Prince Thomas' };
const identity = { displayName: mailbox.display_name, emailAddress: mailbox.email_address };

const sentBody = ev.applySenderIdentity(deferred, identity);
const sentSig = sig.fillSignatureHtml(sig.DEFAULT_SIGNATURE_HTML, identity);
step('send fills the body from the sending mailbox', sentBody.includes("I'm Prince Thomas") && !sentBody.includes('{{'));
step('body name and signature name are the same person',
  sentBody.includes('Prince Thomas') && sentSig.includes('Prince Thomas')
  && !sentBody.includes('Jennifer') && !sentSig.includes('Jennifer'));
step('signature carries the same address the body was filled from',
  sentSig.includes(mailbox.email_address));

// The exact production scenario: queued when the lead pointed at Jennifer's
// mailbox, sent after it was switched to Prince's.
const queuedWhenJennifer = ev.fillTemplate(
  ev.DEFAULT_TEMPLATES.o1_body,
  ev.buildEmailVars({ job, contact, senderDisplayName: ev.DEFER_SENDER })
);
const sentAsPrince = ev.applySenderIdentity(queuedWhenJennifer, identity);
step('a mailbox change between queue and send cannot strand the old name',
  !sentAsPrince.includes('Jennifer') && sentAsPrince.includes('Prince Thomas'));

// ── fallbacks ────────────────────────────────────────────────────────────────
step('a mailbox with no display_name falls back to the address, never a raw token',
  ev.applySenderIdentity("I'm {{sender}}.", { emailAddress: 'jennifer.thomas@fute-global.com' }) === "I'm Jennifer Thomas.");
step('displayNameFromAddress handles dots, underscores and hyphens',
  ev.displayNameFromAddress('mary-jane_watson@x.com') === 'Mary Jane Watson');
step('displayNameFromAddress on an empty address is empty', ev.displayNameFromAddress('') === '');

// Already-filled text (legacy rows, hand-edited drafts) must pass through.
const legacy = "Hi Josue,\n\nI'm Jennifer Thomas at Fute Global LLC.";
step('text without tokens is returned untouched', ev.applySenderIdentity(legacy, identity) === legacy);
step('null/undefined body does not throw', ev.applySenderIdentity(null, identity) === '');

// ── the queue paths really do defer ──────────────────────────────────────────
const fs = require('node:fs');
const indexSrc = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const senderArgs = [...indexSrc.matchAll(/senderDisplayName:\s*([^,}\n]+)/g)].map(m => m[1].trim());
step('no queue path bakes a sender name into emails.body',
  senderArgs.length > 0 && senderArgs.every(a => a === 'DEFER_SENDER' || a === "''"),
  senderArgs.join(' | ') || 'none');
step('deliverOutboundEmail resolves one identity for body, subject and signature',
  /const senderIdentity = \{[\s\S]{0,200}?\};[\s\S]{0,400}?fillSignatureHtml\(signatureHtml, senderIdentity\)/.test(indexSrc)
  && /applySenderIdentity\(email\.subject, senderIdentity\)/.test(indexSrc)
  && /body: applySenderIdentity\(email\.body, senderIdentity\)/.test(indexSrc));
step('the queue-time fallback mailbox excludes deactivated mailboxes',
  (indexSrc.match(/\.eq\('is_active', true\)\s*\.order\('is_primary', \{ ascending: false \}\)\s*\.order\('created_at'/gs) || []).length === 2);

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
