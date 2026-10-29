// THE TEAM'S OUTREACH for the RA Lead (owner, 29 Oct 2026): connect ratio, block ratio — in total, per user, per email ID.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { summarise } = require('../services/team-outreach.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const sends = [
  { id: 1, day: '2026-10-20', contact_id: 'c1', sent_by: 'u1', from_email: 'Daniel@x.com' },
  { id: 2, day: '2026-10-23', contact_id: 'c1', sent_by: 'u1', from_email: 'daniel@x.com' },    // a follow-up: an email, not a new person
  { id: 3, day: '2026-10-20', contact_id: 'c2', sent_by: 'u1', from_email: 'spencer@x.com' },
  { id: 4, day: '2026-10-21', contact_id: 'c3', sent_by: 'u2', from_email: 'mick@x.com' },
  { id: 5, day: '2026-10-21', contact_id: 'c4', sent_by: 'u2', from_email: 'mick@x.com' },
];
const contacts = {
  c1: { email_status: 'valid', replied_day: '2026-10-22', stage: 'Connected' },
  c2: { email_status: 'blocked', stage: 'Assigned' },
  c3: { email_status: 'invalid', stage: 'Assigned' },
  c4: { email_status: 'valid', replied_day: '2026-10-01', stage: 'In Discussion' },          // replied BEFORE we wrote: not a reply to us
};
const out = summarise({ sends, contacts, people: { u1: 'Martin', u2: 'Ash' } });
const T = out.total;
step('total: 4 people, 5 emails', T.people === 4 && T.emailed === 5);
step('connected = Connected or In Discussion', T.connected === 2 && T.connect_rate === 50);
step('a reply before we wrote does not count', T.replied === 1);
step('blocked and invalid are told apart', T.blocked === 1 && T.invalid === 1 && T.bounced === 2 && T.block_rate === 25);
const m = out.by_user.find(x => x.key === 'u1'), a = out.by_user.find(x => x.key === 'u2');
step('per user, named', m.name === 'Martin' && m.people === 2 && m.emailed === 3 && a.people === 2);
step('per email ID, case does not split one address', out.by_mailbox.find(x => x.key === 'daniel@x.com').emailed === 2);
step('the rows add up to the total', out.by_user.reduce((n, x) => n + x.people, 0) === T.people && out.by_mailbox.reduce((n, x) => n + x.people, 0) === T.people);
step('nothing sent → rates are "—", not 0%', summarise({ sends: [] }).total.connect_rate === null);
const route = fs.readFileSync(new URL('../routes/workflows.js', import.meta.url), 'utf8');
step('the route is for an RA Lead or admin only', /router\.get\('\/insights\/outreach-team'[\s\S]{0,120}hasRole\(req, 'admin', 'ra_lead'\)\) return res\.status\(403\)/.test(route));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
