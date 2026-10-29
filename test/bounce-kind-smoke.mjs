// Blocked vs invalid bounces (owner, 29 Oct 2026): "the email ID is blocked but it was marked as invalid".
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { bounceKind, refusalKind } = require('../services/bounce-kind.js');
const { invalidateBouncedContacts } = require('../services/bounce-mark.js');
let fails = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fails++; };

// The owner's own notice (Gmail, 29 Oct): "Message blocked … 550 permanent failure for one or more recipients (x@y.com:blocked)"
ok('Gmail "Message blocked … :blocked" is Blocked', bounceKind('Message blocked Your message to mrichardson@fortedesignbuild.com has been blocked. 550 permanent failure for one or more recipients (mrichardson@fortedesignbuild.com:blocked)') === 'blocked');
ok('Gmail "Address not found … does not exist" is Invalid', bounceKind("Address not found. Your message wasn't delivered because the address couldn't be found. The email account that you tried to reach does not exist. 550 5.1.1") === 'invalid');
ok('Outlook 5.7.1 policy rejection is Blocked', bounceKind('Delivery has failed. Remote server returned 550 5.7.1 Message rejected due to content restrictions') === 'blocked');
ok('Outlook 5.1.10 recipient not found is Invalid', bounceKind('550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup') === 'invalid');
ok('"does not exist" wins over "blocked" in one notice', bounceKind('blocked: user does not exist') === 'invalid');
ok('a notice that says neither stays Invalid (the old, safe answer)', bounceKind('Undeliverable: hello') === 'invalid');
ok('a refused send for a recipient reason is classified', refusalKind('550 5.7.1 recipient blocked by policy') === 'blocked');
ok('a sign-in failure says nothing about the address', refusalKind('401 Unauthorized — token refresh failed') === null);
ok('throttling says nothing about the address', refusalKind('550 too many messages, rate limit') === null);

// The writer stores the kind it is given, and never touches an already-dead contact.
const rows = [{ id: 'c1', email_status: 'valid', job_id: 'j1' }, { id: 'c2', email_status: 'blocked', job_id: 'j2' }];
const writes = [];
const scoped = { from: () => ({
  select: () => ({ ilike: () => ({ limit: async () => ({ data: rows }) }) }),
  update: (u) => ({ eq: async (_k, id) => { writes.push({ id, ...u }); return {}; } }),
}) };
const neverEmail = (s) => ['invalid', 'deactivated', 'blocked'].includes(s);
const marked = await invalidateBouncedContacts(scoped, 'x@y.com', { neverEmail, status: 'blocked' });
ok('a blocked bounce writes Blocked', writes.length === 1 && writes[0].email_status === 'blocked' && marked[0].status === 'blocked');
writes.length = 0; rows[0].email_status = 'valid';
await invalidateBouncedContacts(scoped, 'x@y.com', { neverEmail });
ok('no kind given → Invalid, as before', writes.length === 1 && writes[0].email_status === 'invalid');

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall passed');
