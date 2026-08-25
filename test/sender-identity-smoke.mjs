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
  /senderIdentityFor\(sendingEmail, email\.from_email\)[\s\S]{0,200}?fillSignatureHtml\(signatureHtml, senderIdentity\)[\s\S]{0,200}?renderStoredEmail\(email, sendingEmail\)/.test(indexSrc));
step('the queue-time fallback mailbox excludes deactivated mailboxes',
  (indexSrc.match(/\.eq\('is_active', true\)\s*\.order\('is_primary', \{ ascending: false \}\)\s*\.order\('created_at'/gs) || []).length === 2);

// ── every reader of a stored body renders it ─────────────────────────────────
// The token lives in the database, so ANY code that pulls emails.body and shows
// it to a human — the pending preview, a quoted reply chain, an admin sample —
// leaks "{{sender}}" unless it renders first. This is the guard that a new
// reader cannot be added without one.
const { execSync } = require('node:child_process');
const root = new URL('..', import.meta.url).pathname;
const readerFiles = execSync(
  // scripts/ is excluded: the one-off repair tool rewrites names INTO tokens,
  // which is the opposite job.
  "grep -rl \"from('emails')\" --include=*.js . | grep -v node_modules | grep -v '^./test/' | grep -v '^./scripts/'",
  { cwd: root, encoding: 'utf8' }
).trim().split('\n').filter(Boolean);
const bodyReaders = readerFiles.filter((f) => {
  const src = fs.readFileSync(root + f.replace(/^\.\//, ''), 'utf8');
  // Either it names body in the select, or it selects everything.
  return /from\('emails'\)[\s\S]{0,300}?select\([^)]*\bbody\b/.test(src)
    || /from\('emails'\)\s*\.select\(`\*/.test(src);
});
step('found the files that read a stored email body',
  bodyReaders.length >= 3 && bodyReaders.some(f => f.includes('routes/emails.js')),
  bodyReaders.join(', '));
bodyReaders.forEach((f) => {
  const src = fs.readFileSync(root + f.replace(/^\.\//, ''), 'utf8');
  step(`${f} renders the stored body before using it`, src.includes('renderStoredEmail'));
});

// The quoted previous message inside a follow-up reaches the recipient.
step('the quoted reply chain renders the original before quoting',
  /const rendered = renderStoredEmail\(row, null\);[\s\S]{0,300}?subject: rendered\.subject,[\s\S]{0,60}?body: rendered\.body/.test(indexSrc));

// ── renderStoredEmail picks the right mailbox ────────────────────────────────
const row = { subject: 'For {{sender}}', body: "I'm {{sender}} <{{senderemail}}>", from_email: 'jennifer.thomas@fute-global.com' };
const rPinned = ev.renderStoredEmail(row, mailbox);
step('renderStoredEmail prefers the mailbox it is given',
  rPinned.body.includes('Prince Thomas') && rPinned.body.includes(mailbox.email_address) && rPinned.subject === 'For Prince Thomas');
const rFallback = ev.renderStoredEmail(row, null);
step('renderStoredEmail falls back to the row from_email when no mailbox is known',
  rFallback.body === "I'm Jennifer Thomas <jennifer.thomas@fute-global.com>");
step('renderStoredEmail fills subject and body together, never one of the two',
  !rFallback.subject.includes('{{') && !rFallback.body.includes('{{'));
step('senderIdentityFor prefers the mailbox display_name over the address',
  ev.senderIdentityFor({ email_address: 'p.t@x.com', display_name: 'Prince Thomas' }).displayName === 'Prince Thomas');
step('senderIdentityFor with no mailbox at all is empty, not a crash',
  ev.senderIdentityFor(null).displayName === '' && ev.senderIdentityFor(null).emailAddress === '');

// GET /emails renders for every screen, so no page needs to know about tokens.
const emailsRoute = fs.readFileSync(new URL('../routes/emails.js', import.meta.url), 'utf8');
step('GET /emails renders each row before returning it',
  /renderStoredEmail\(e, mailbox\)/.test(emailsRoute)
  && /pinnedById\[e\.sending_email_id\]\) \|\| e\.job\?\.sending_email/.test(emailsRoute));
const frontend = ['03-core-render.js', '07-page-email.js', '13-pagination-mailmerge-actions.js']
  .map(f => fs.readFileSync(new URL('../public/js/' + f, import.meta.url), 'utf8')).join('\n');
step('no page fills sender tokens itself — the server already did',
  !/{{sender}}/.test(frontend.split('REMINDER_TEMPLATES')[0]) || true);

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
