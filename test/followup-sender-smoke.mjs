// A FOLLOW-UP COMES FROM THE MAILBOX THAT SENT THE FIRST EMAIL (R-070, D-0067; owner 2026-10-01: "R-070 — yes").
// A lead handed from Daniel to Spencer used to send its follow-up from Spencer's mailbox with Daniel's first email
// quoted underneath — it read as a colleague chasing. The follow-up now leaves from the mailbox that started the
// conversation, when that mailbox is still active AND connected; otherwise from the lead's current one, as before.
//   * the first email's sender is the EARLIEST first email actually sent (a follow-up or a failed row never counts);
//   * pinned only when active and connected; already-the-right-one needs no change;
//   * an explicit per-email choice (sequence rotation) is never overridden; first emails and reminders are untouched;
//   * a read that fails pins nothing — every follow-up still goes, from the lead's own mailbox.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('../services/followup-sender');
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const R = (contact, from, type, status, sent) => ({ contact_id: contact, from_email: from, followup_type: type, status: status || 'sent', sent_at: sent });
step('the first sender is the EARLIEST first email that was actually sent', fs.firstSenderAddress([
  R('c', 'spencer@x.com', 'fu1', 'sent', '2026-09-20'), R('c', 'daniel@x.com', null, 'sent', '2026-09-01'), R('c', 'someone@x.com', null, 'failed', '2026-08-01'), R('c', 'late@x.com', 'initial', 'sent', '2026-09-10')]) === 'daniel@x.com');
step('no first email sent yet → nothing to pin to', fs.firstSenderAddress([R('c', 'a@x.com', 'fu1', 'sent', '2026-09-20')]) === '');
step('a follow-up is fu1/fu2…, never a first email or a reminder', fs.isFollowup({ followup_type: 'fu1' }) && fs.isFollowup({ followup_type: 'fu2' }) && !fs.isFollowup({ followup_type: null }) && !fs.isFollowup({ followup_type: 'initial' }) && !fs.isFollowup({ followup_type: 'reminder' }));
const MB = { id: 'mbD', email_address: 'daniel@x.com', is_active: true };
const by = { 'daniel@x.com': MB };
step('pure: active + connected + different from the lead\'s current → pinned', fs.pickFollowupMailbox({ firstFrom: 'daniel@x.com', byAddress: by, connectedIds: new Set(['mbD']), currentMailboxId: 'mbS' }) === MB);
step('pure: not connected → null', fs.pickFollowupMailbox({ firstFrom: 'daniel@x.com', byAddress: by, connectedIds: new Set(), currentMailboxId: 'mbS' }) === null);
step('pure: switched off → null', fs.pickFollowupMailbox({ firstFrom: 'daniel@x.com', byAddress: { 'daniel@x.com': Object.assign({}, MB, { is_active: false }) }, connectedIds: new Set(['mbD']), currentMailboxId: 'mbS' }) === null);
step('pure: already the lead\'s own mailbox → null (nothing to change)', fs.pickFollowupMailbox({ firstFrom: 'daniel@x.com', byAddress: by, connectedIds: new Set(['mbD']), currentMailboxId: 'mbD' }) === null);

// a fake database that understands the reads
const D = {
  emails: [
    R('c1', 'daniel@x.com', null, 'sent', '2026-09-01'), R('c2', 'ghost@x.com', null, 'sent', '2026-09-01'), R('c3', 'daniel@x.com', null, 'sent', '2026-09-01'),
    R('c4', 'erin@x.com', null, 'sent', '2026-09-01'), R('c5', 'off@x.com', null, 'sent', '2026-09-01'), R('c6', 'daniel@x.com', null, 'sent', '2026-09-01'), R('c7', 'daniel@x.com', 'fu1', 'sent', '2026-09-05')],
  user_emails: [{ id: 'mbD', email_address: 'daniel@x.com', is_active: true }, { id: 'mbE', email_address: 'erin@x.com', is_active: true }, { id: 'mbX', email_address: 'off@x.com', is_active: false }],
  microsoft_tokens: [{ user_email_id: 'mbD' }, { user_email_id: 'mbX' }], gmail_tokens: [{ user_email_id: 'mbE' }],
};
let failRead = false;
const supabase = { from: (t) => { const f = []; const api = { select() { return api; }, in(k, v) { f.push(r => v.includes(r[k])); return api; }, eq(k, v) { f.push(r => r[k] === v); return api; },
  then(a, b) { if (failRead) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(a, b); return Promise.resolve({ data: D[t].filter(r => f.every(x => x(r))), error: null }).then(a, b); } }; return api; } };
const FU = (id, contact, mailbox, type) => ({ id, contact_id: contact, followup_type: type === undefined ? 'fu1' : type, job: { sending_email_id: mailbox } });
const pending = [
  FU('e1', 'c1', 'mbS'),                 // Daniel started it, lead is now Spencer's → pinned to Daniel
  FU('e2', 'c2', 'mbS'),                 // first sender's mailbox no longer exists → stays
  FU('e3', 'c3', 'mbD'),                 // already Daniel's → stays
  FU('e4', 'c4', 'mbS'),                 // Erin's is a Gmail mailbox and connected → pinned
  FU('e5', 'c5', 'mbS'),                 // switched-off mailbox → stays
  FU('e6', 'c6', 'mbS'),                 // has an explicit rotation choice → untouched
  FU('e7', 'c1', 'mbS', null),           // a FIRST email → untouched
  FU('e8', 'c1', 'mbS', 'reminder'),     // a reminder → untouched
  FU('e9', 'c7', 'mbS'),                 // only a follow-up has been sent so far → no first sender → stays
];
const pins = await fs.resolveFollowupPins(supabase, pending, { e6: 'mbRot' });
step('a follow-up on a lead handed to a colleague leaves from the mailbox that started it', pins.e1 && pins.e1.id === 'mbD', JSON.stringify(Object.keys(pins)));
step('…including a Gmail mailbox', pins.e4 && pins.e4.id === 'mbE');
step('first sender\'s mailbox gone / switched off / already the lead\'s own → no change', !pins.e2 && !pins.e5 && !pins.e3);
step('an explicit per-email choice is never overridden', !pins.e6);
step('first emails and reminders are never re-pointed', !pins.e7 && !pins.e8);
step('only a follow-up sent so far (no first email on record) → no change', !pins.e9);
failRead = true;
const none = await fs.resolveFollowupPins(supabase, pending, {});
step('a failed read pins nothing and does not throw — every follow-up still goes from the lead\'s mailbox', JSON.stringify(none) === '{}');
failRead = false;
const many = Array.from({ length: 450 }, (_, i) => FU('m' + i, 'c1', 'mbS'));
const big = await fs.resolveFollowupPins(supabase, many, {});
step('450 follow-ups across more than one page of contacts all resolve', Object.keys(big).length === 450);
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed'); process.exit(results.every(Boolean) ? 0 : 1);
