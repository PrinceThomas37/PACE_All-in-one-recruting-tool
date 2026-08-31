// Queue order decides who actually goes out today.
//
// The send loop drains at one email every 75-105 seconds inside an 8-hour
// window in the lead's own timezone, so whatever sits at the back of the queue
// may not be sent at all before the cutoff. On 2026-08-31 a morning batch of 36
// follow-ups sat in front of 20 leads assigned that afternoon; the follow-ups
// had to be deleted by hand for the new outreach to make the window.
//
// These checks pin: fresh outreach goes first, mailbox interleaving survives,
// and ordering never adds, drops or duplicates an email.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { orderPendingForSend, interleaveByMailbox, isInitialOutreach } = require('../send-queue-order.js');

const results = [];
const step = (n, ok, d = '') => { results.push(ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const mk = (id, followup_type, mailbox = 'mb-1') => ({ id, followup_type, job: { sending_email_id: mailbox } });
const ids = (list) => list.map(e => e.id).join(',');

// ── fresh outreach first ─────────────────────────────────────────────────────
const morningBatch = [mk('fu-1', 'fu2'), mk('fu-2', 'fu2'), mk('fu-3', 'fu1')];
const assignedLater = [mk('new-1', null), mk('new-2', null)];
const arrivalOrder = [...morningBatch, ...assignedLater];

const ordered = orderPendingForSend(arrivalOrder);
step('the leads assigned later go out first', ids(ordered) === 'new-1,new-2,fu-1,fu-2,fu-3', ids(ordered));
step('both follow-up types queue behind initial outreach',
  ordered.findIndex(e => e.id === 'new-2') < ordered.findIndex(e => e.id === 'fu-3'));

// The production shape that caused this: many follow-ups, a few new leads.
const real = [
  ...Array.from({ length: 36 }, (_, i) => mk('fu-' + i, 'fu2')),
  ...Array.from({ length: 20 }, (_, i) => mk('new-' + i, null))
];
const realOrdered = orderPendingForSend(real);
step('20 new leads all precede 36 follow-ups',
  realOrdered.slice(0, 20).every(e => e.followup_type === null)
  && realOrdered.slice(20).every(e => e.followup_type === 'fu2'));

// ── nothing is lost ──────────────────────────────────────────────────────────
step('ordering neither drops nor duplicates an email',
  realOrdered.length === real.length && new Set(realOrdered.map(e => e.id)).size === real.length);
step('an empty queue is empty, not a crash', orderPendingForSend([]).length === 0);
step('a null queue is empty, not a crash', orderPendingForSend(null).length === 0);

// ── mailbox interleaving still applies inside each band ──────────────────────
// It exists so one mailbox's long queue cannot starve another's for the whole
// window; priority must not quietly undo it.
const twoBoxes = [
  mk('a1', null, 'mb-a'), mk('a2', null, 'mb-a'), mk('a3', null, 'mb-a'),
  mk('b1', null, 'mb-b'), mk('b2', null, 'mb-b')
];
step('two mailboxes alternate within the initial band',
  ids(orderPendingForSend(twoBoxes)) === 'a1,b1,a2,b2,a3', ids(orderPendingForSend(twoBoxes)));

const mixed = [
  mk('a-fu', 'fu2', 'mb-a'), mk('b-fu', 'fu2', 'mb-b'),
  mk('a-new', null, 'mb-a'), mk('b-new', null, 'mb-b')
];
step('interleaving applies inside the follow-up band too, after the new band',
  ids(orderPendingForSend(mixed)) === 'a-new,b-new,a-fu,b-fu', ids(orderPendingForSend(mixed)));

// ── arrival order is preserved inside a band ─────────────────────────────────
// The caller fetches oldest-first; priority must not reshuffle within a band,
// or the oldest lead loses its place.
const sameBand = [mk('first', null), mk('second', null), mk('third', null)];
step('oldest-first survives inside a band', ids(orderPendingForSend(sameBand)) === 'first,second,third');

// ── what counts as a first touch ─────────────────────────────────────────────
step('null followup_type is initial outreach', isInitialOutreach({ followup_type: null }) === true);
step("'initial' is also initial outreach", isInitialOutreach({ followup_type: 'initial' }) === true);
step('fu1 and fu2 are not', !isInitialOutreach({ followup_type: 'fu1' }) && !isInitialOutreach({ followup_type: 'fu2' }));
step('a reminder is not treated as fresh outreach', isInitialOutreach({ followup_type: 'reminder' }) === false);
step('a missing email does not throw', isInitialOutreach(undefined) === true);

// An email with no job/mailbox still queues rather than vanishing.
step('an email with no sending mailbox is still ordered, not dropped',
  orderPendingForSend([{ id: 'orphan', followup_type: null }]).length === 1);

// ── the send loop actually uses it, on both sides of the window split ────────
const fs = require('node:fs');
const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
step('index.js orders both the in-window and out-of-window queues',
  /const ordered = orderPendingForSend\(inWindow\)\.concat\(orderPendingForSend\(outWindow\)\)/.test(src));
step('index.js has no second copy of the ordering logic',
  !/function interleaveByMailbox/.test(src) && src.includes("require('./send-queue-order')"));
// Without an ORDER BY, .range() pagination can repeat or skip rows between
// pages — and "oldest first" inside a band depends on it.
step('the pending fetch is ordered, so pagination is stable',
  /\.eq\('status', 'pending'\)[\s\S]{0,400}?\.order\('created_at', \{ ascending: true \}\)[\s\S]{0,120}?\.range\(from/.test(src));

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
