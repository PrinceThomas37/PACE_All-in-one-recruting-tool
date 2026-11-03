// ONE MAILBOX, ONE PLACE TO ACT — the rules (services/mailbox-control.js), pure. Owner 3 Nov 2026: Block = locked (only an admin lifts it),
// Start = start SENDING again. A button is OFFERED only when the action is allowed from that state, and the route re-checks with the same function.
// Usage: node test/mailbox-control-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mc = require('../services/mailbox-control.js');
const { bounceKind } = require('../services/bd-insights.js');
const alerts = require('../services/mailbox-alerts.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const labels = (s) => mc.actionsFor(s).map((a) => a.action).join(',');

// states
ok('active mailbox', mc.stateOf({ is_active: true, auto_paused_at: null }, null) === 'active');
ok('deactivated wins over everything', mc.stateOf({ is_active: false, auto_paused_at: '2026-11-03' }, { kind: 'blocked' }) === 'deactivated');
ok('paused with no note = PACE paused it by itself', mc.stateOf({ is_active: true, auto_paused_at: 'x' }, null) === 'auto_paused');
ok('paused with PACE\'s own bounce note = auto-paused', mc.stateOf({ is_active: true, auto_paused_at: 'x' }, { bounces: 3, sent: 20, pct: 15 }) === 'auto_paused');
ok('admin pause note = paused', mc.stateOf({ is_active: true, auto_paused_at: 'x' }, { kind: 'manual' }) === 'paused');
ok('block note = blocked', mc.stateOf({ is_active: true, auto_paused_at: 'x' }, { kind: 'blocked' }) === 'blocked');
ok('a block note with NO pause time is not blocked (the pause is what stops sending)', mc.stateOf({ is_active: true, auto_paused_at: null }, { kind: 'blocked' }) === 'active');

// what is offered
ok('active: pause, block, deactivate, delete', labels('active') === 'pause,block,deactivate,delete', labels('active'));
ok('paused: start, block, deactivate, delete', labels('paused') === 'start,block,deactivate,delete');
ok('blocked: Unblock — and NO Start (unlock first, on purpose)', labels('blocked') === 'unblock,deactivate,delete', labels('blocked'));
ok('deactivated: start, delete', labels('deactivated') === 'start,delete');
ok('destructive buttons are marked', mc.actionsFor('active').filter((a) => a.danger).map((a) => a.action).join() === 'block,deactivate,delete');

// the same function refuses what is not offered
ok('pause an already paused mailbox is refused, in words', !mc.check('pause', 'paused').ok && /already paused/.test(mc.check('pause', 'paused').error));
ok('start a BLOCKED mailbox says unblock first', /Unblock it first/.test(mc.check('start', 'blocked').error));
ok('unblock something not blocked is refused', !mc.check('unblock', 'active').ok);
ok('block a deactivated mailbox is refused', !mc.check('block', 'deactivated').ok);
ok('an unknown action is refused', !mc.check('explode', 'active').ok);
ok('every offered action passes check() for its state (screen and server agree)', mc.STATES.every((s) => mc.actionsFor(s).every((a) => mc.check(a.action, s).ok)));

// delete
ok('delete needs the address typed back', mc.deleteCheck({ emailCount: 0, typedAddress: '', address: 'a@b.com' }).status === 400);
ok('typing it with different case is accepted', mc.deleteCheck({ emailCount: 0, typedAddress: ' A@B.com ', address: 'a@b.com' }).ok);
const d = mc.deleteCheck({ emailCount: 12, typedAddress: 'a@b.com', address: 'a@b.com' });
ok('a mailbox with mail on record is NOT deleted — it says why and offers Deactivate', d.status === 409 && /12 emails/.test(d.error) && /Deactivate/.test(d.error), d.error);
ok('one email is singular', /1 email on record/.test(mc.deleteCheck({ emailCount: 1, typedAddress: 'a@b.com', address: 'a@b.com' }).error));

// sentences: an admin pause must NEVER be blamed on bounces
ok('a block sentence names who and when', /Blocked by Prince on 2026-11-03/.test(mc.noteSentence('blocked', { kind: 'blocked', by: 'Prince', at: '2026-11-03T10:00:00Z' })));
// OWNER, 3 Nov 2026: "Pause means outreach is paused, not individual emailing or conversations."
const sayOutreach = (t) => /[Oo]utreach/.test(t) && /one by one/.test(t) && /replies still go/.test(t) && !/[Nn]othing (sends|will send|can send)/.test(t);
ok('the pause sentence says OUTREACH stops and one-by-one emails and replies still go', sayOutreach(mc.noteSentence('paused', { kind: 'manual', by: 'P', at: '2026-11-03T10:00:00Z' })), mc.noteSentence('paused', { kind: 'manual' }));
ok('…and so does the block sentence', sayOutreach(mc.noteSentence('blocked', { kind: 'blocked', by: 'P', at: '2026-11-03T10:00:00Z' })));
ok('…and PACE\'s own bounce pause', sayOutreach(alerts.pausedSentence({ bounces: 3, sent: 20, pct: 15 })), alerts.pausedSentence({ bounces: 3, sent: 20, pct: 15 }));
ok('the health tip for a paused mailbox says the same', sayOutreach(mc.healthOf({ state: 'paused', connection: { status: 'ok' }, sent: 5 }).tips.join(' ')));
ok('one sentence on the card says what Pause and Block do', /OUTREACH/.test(mc.SCOPE_NOTE) && /one by one/.test(mc.SCOPE_NOTE) && /reply/.test(mc.SCOPE_NOTE));

// THE RULE IS ENFORCED WHERE THE CODE ALREADY ENFORCES IT: only the outreach engines read auto_paused_at to hold a send. If the inbox, a one-off
// send or a reply ever starts reading it, an owner decision is being broken — this fails and says so. (A pin of the list, not proof of behaviour:
// the behaviour is that those engines are the only readers.)
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const readers = [];
const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = d ? d + '/' + e.name : e.name;
  if (e.isDirectory()) { if (!['node_modules', 'test', 'docs', '.git', 'public', 'migrations', 'scripts'].includes(e.name)) walk(rel); }
  else if (e.name.endsWith('.js') && /auto_paused_at/.test(fs.readFileSync(path.join(root, rel), 'utf8'))) readers.push(rel); } };
walk('');
const ALLOWED = ['index.js', 'routes/recruiting/outreach.js', 'routes/candidate-outreach.js',              // the outreach engines: lead sends, sequences, candidate outreach
  'routes/deliverability.js', 'routes/mailbox-alerts.js', 'routes/mailbox-control.js',                    // the screens that SHOW or SET it
  'services/mailbox-control.js', 'services/mailbox-alerts.js'];
const stray = readers.filter((f) => !ALLOWED.includes(f));
ok('only the outreach engines and the screens read auto_paused_at — never the inbox, a one-off send or a reply', stray.length === 0 && readers.length >= 6, 'stray: ' + stray.join(', ') + ' | readers: ' + readers.join(', '));
const inbox = ['routes/mailbox.js', 'services/mailbox-send.js'];
ok('the inbox and the sender are NOT among them (a probe that cannot find the files must fail)', inbox.every((f) => fs.existsSync(path.join(root, f)) && !readers.includes(f)), inbox.join(','));
ok('the mailbox alert for an admin pause does not say "bounced"', !/bounce/i.test(alerts.pausedSentence({ kind: 'manual', by: 'Prince', at: '2026-11-03T10:00:00Z' })));
ok('…and PACE\'s own pause still does', /bounced/.test(alerts.pausedSentence({ bounces: 3, sent: 20, pct: 15 })));

// the numbers: nothing under a rate is null, never 0 %
const empty = mc.statsOf({ sent: [], failed: 0, pending: 0, tracking: [] }, bounceKind);
ok('a mailbox that sent nothing has no rates ("—"), not 0 %', empty.bounce_rate === null && empty.open_rate === null && empty.reply_rate === null && empty.fail_rate === null);
const st = mc.statsOf({
  sent: [{ id: 1, contact_id: 'a', contact: { email_status: 'invalid' } }, { id: 2, contact_id: 'a', contact: { email_status: 'invalid' } }, { id: 3, contact_id: 'b', contact: { email_status: 'valid', replied_at: '2026-11-01' } },
    { id: 4, contact_id: 'c', contact: { email_status: 'blocked' } }, { id: 5, contact_id: 'd', contact: { email_status: 'valid' } }],
  failed: 1, pending: 4, tracking: [{ open_count: 2 }, { open_count: 0 }, { open_count: 0 }, { open_count: 1 }],
}, bounceKind);
ok('bounce rate counts PEOPLE (a, c of 4), not emails', st.people_emailed === 4 && st.bounced === 2 && st.bounce_rate === 50, JSON.stringify(st));
ok('open rate is of TRACKED emails (2 of 4)', st.tracked === 4 && st.opened === 2 && st.open_rate === 50);
ok('reply rate counts people (1 of 4); failed/pending are shown', st.reply_rate === 25 && st.failed === 1 && st.pending === 4 && st.fail_rate === 16.7, String(st.fail_rate));

// health
ok('healthy: signed in, bounces under the company\'s own limit', mc.healthOf({ state: 'active', connection: { status: 'ok' }, bounceRate: 1.2, bounceLimitPct: 5, sent: 90 }).level === 'good');
ok('over the company\'s own bounce limit is bad, and says the number', (() => { const h = mc.healthOf({ state: 'active', connection: { status: 'ok' }, bounceRate: 7, bounceLimitPct: 5, sent: 90 }); return h.level === 'bad' && /7%/.test(h.tips.join()) && /5%/.test(h.tips.join()); })());
ok('an expired sign-in is bad and says who can fix it', (() => { const h = mc.healthOf({ state: 'active', connection: { status: 'expired' }, sent: 5 }); return h.level === 'bad' && /owner can reconnect/.test(h.tips.join()); })());
ok('a blocked mailbox is "off", not "healthy"', mc.healthOf({ state: 'blocked', connection: { status: 'ok' } }).level === 'off');
ok('no bounce limit set → no invented line', !mc.healthOf({ state: 'active', connection: { status: 'ok' }, bounceRate: 40, bounceLimitPct: 0, sent: 90 }).tips.length);

const failed = results.filter((x) => !x).length;
console.log(`SUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
