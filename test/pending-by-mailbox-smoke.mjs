// PENDING, BY EMAIL ID AND STEP (owner, 29 Oct 2026): "how many emails from each email ID, and how many FU1, FU2 and
// first outreach" — instead of the time-zone split.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { byMailbox } = require('../services/pending-by-mailbox.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const rows = [
  { followup_type: null, job: { sending_email_id: 'a' } },
  { followup_type: 'initial', job: { sending_email_id: 'a' } },
  { followup_type: 'fu1', job: { sending_email_id: 'a' } },
  { followup_type: 'fu2', sending_email_id: 'b', job: { sending_email_id: 'a' } },   // its own mailbox wins (rotation)
  { followup_type: 'fu3', job: { sending_email_id: 'b' } },
  { followup_type: 'fu1', job: {} },
];
const out = byMailbox(rows, { a: 'daniel@x.com', b: 'mick@x.com' });
const A = out.find(r => r.id === 'a'), B = out.find(r => r.id === 'b'), N = out.find(r => !r.id);
step('one row per email ID, plus the leads with none', out.length === 3);
step('daniel@: 2 first outreach, 1 FU1', A && A.email === 'daniel@x.com' && A.initial === 2 && A.fu1 === 1 && A.fu2 === 0 && A.pending === 3);
step('an email\'s own mailbox wins over its lead\'s', B && B.fu2 === 1 && B.later === 1 && B.pending === 2);
step('a lead without an email ID is said plainly', N && /No email ID/.test(N.email) && N.fu1 === 1);
step('every pending email is counted once', out.reduce((n, r) => n + r.pending, 0) === rows.length);
step('largest first', out[0].pending >= out[1].pending);

const route = fs.readFileSync(new URL('../routes/emails.js', import.meta.url), 'utf8');
step('pending-summary answers by_mailbox', /by_mailbox,/.test(route) && /pendingByMailbox\.byMailbox\(rows, boxes\)/.test(route));
const page = fs.readFileSync(new URL('../public/js/07-page-email.js', import.meta.url), 'utf8');
step('the RA Lead\'s drill-in shows it and no longer the time-zone split', /var mbTable=pendingMailboxTable\(ps\)/.test(page) && !/Pending, by lead timezone/.test(page));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
