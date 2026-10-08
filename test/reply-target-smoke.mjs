// WHICH EMAIL "REPLY" ANSWERS (services/reply-target.js, 8 Oct): the newest message the person can answer from their OWN mailbox,
// and the newest one THEY wrote. Pure rule, no database.
// Usage: node test/reply-target-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { pickReplyTargets } = require('../services/reply-target.js');
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const MINE = [{ id: 'm1', email_address: 'Bd@Fute.test' }, { id: 'm2', email_address: 'bd.two@fute.test' }];
const IN = { direction: 'inbound', from: 'Steve Moskowitz <Steve@rr.com>', to: 'bd@fute.test', person: 'Steve Moskowitz', subject: 'Automatic reply', message_key: 'AAMk-in1' };
const OUT = { direction: 'outbound', from: 'bd@fute.test', to: 'steve@rr.com', subject: 'Following up', message_id: 'AAMk-out1' };

let r = pickReplyTargets([OUT, IN], MINE);
step('they wrote last-but-one, we wrote last: "last" is OUR email (a follow-up answers it), "last_inbound" is theirs', r.last.message_id === 'AAMk-out1' && r.last.direction === 'outbound' && r.last_inbound.message_id === 'AAMk-in1');
step('the other side is the person on the far end, as a bare lower-case address, with their name', r.last.other_email === 'steve@rr.com' && r.last_inbound.other_email === 'steve@rr.com' && r.last_inbound.other_name === 'Steve Moskowitz');
step('the mailbox is the one the message sits in (matched ignoring case): inbound → where it arrived, outbound → where it left', r.last_inbound.mailbox_id === 'm1' && r.last.mailbox_id === 'm1');
r = pickReplyTargets([IN, OUT], MINE);
step('they wrote last: "last" and "last_inbound" are the same email', r.last.message_id === 'AAMk-in1' && r.last_inbound.message_id === 'AAMk-in1');
r = pickReplyTargets([{ ...IN, to: 'someone.else@fute.test' }, OUT], MINE);
step('an email that arrived in a TEAMMATE\'s mailbox is never offered (the in-app mailbox only opens your own)', r.last_inbound === null && r.last.message_id === 'AAMk-out1');
r = pickReplyTargets([{ ...IN, message_key: null }, OUT], MINE);
step('an email with no provider id cannot be opened, so it is skipped, not guessed at', r.last_inbound === null);
r = pickReplyTargets([{ ...OUT, from: 'bd.two@fute.test' }], MINE);
step('a second mailbox of the same person is matched to its own id', r.last.mailbox_id === 'm2');
r = pickReplyTargets([{ ...IN, from: 'Other <other@x.com>', message_key: 'k2' }, IN], MINE, { email: 'steve@rr.com' });
step('"only this person" skips a newer email from somebody else on the same lead', r.last_inbound.message_id === 'AAMk-in1');
step('nothing to answer → both are null, never a made-up target', JSON.stringify(pickReplyTargets([], MINE)) === '{"last":null,"last_inbound":null}' && JSON.stringify(pickReplyTargets(null, null)) === '{"last":null,"last_inbound":null}');
r = pickReplyTargets([{ direction: 'outbound', from: 'bd@fute.test', to: 'a@x.com; b@x.com', message_id: 'o9' }], MINE);
step('an email sent to several people answers the first of them', r.last.other_email === 'a@x.com');
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed'); process.exit(results.every(Boolean) ? 0 : 1);
