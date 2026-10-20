// "Needs you today" — the owner's rules of 20 Oct 2026 (R-290), proven on the real ranking (next-action.js) and the real route.
//
//   Reply due      a reply is OWED once their email is `needs_reply_after_days` old (default 4); fresher ones are counted, not listed
//   Promise due    unchanged            Reminder due   unchanged
//   Chase          GONE (D-0169, owner 20 Oct): silence after OUR email makes no tile at all; sequence-made reminders make none either
//   Opt-outs / a clear "no": never shown
//
// Usage: node test/needs-you-rules-smoke.mjs

import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const { buildNextActions, KIND, REPLY_DUE_AFTER_DAYS } = require('../next-action.js');
const settings = require('../config/settings');

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };

const NOW = Date.parse('2026-10-20T12:00:00Z');
const DAY = 86400000;
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const msg = (direction, daysAgo, body) => ({ direction, sent_at: at(daysAgo), body });
const lead = (id, messages, extra = {}) => ({ entity_type: 'contact', entity_id: id, name: 'Person ' + id, company: 'Co ' + id, stage: 'Connected', job_id: 'job-' + id, owner_id: 'u1', messages, ...extra });
const replyThread = (id, theirDaysAgo) => lead(id, [msg('outbound', theirDaysAgo + 3, 'Hello, we have candidates'), msg('inbound', theirDaysAgo, 'Thanks for this. Who else is on the team?')]);   // an ORDINARY reply (a positive one is owed after 2 days — R-297, needs-you-order-smoke)
const run = (threads, o = {}) => buildNextActions(Object.assign({ threads, now: NOW }, o));

// ── Reply due: owed after 4 days ────────────────────────────────────────────
ok('the default is 4 days', REPLY_DUE_AFTER_DAYS === 4);
{
  const items = run([replyThread('a', 1), replyThread('b', 3), replyThread('c', 4), replyThread('d', 10)]);
  const owed = items.filter((i) => i.kind === KIND.REPLY_DUE).map((i) => i.entity_id).sort().join();
  ok('a reply 1 or 3 days old is NOT listed yet; 4 and 10 days old are', owed === 'c,d', owed);
  ok('the ones not yet due are COUNTED, never silently dropped', items.reply_not_due_yet === 2, String(items.reply_not_due_yet));
}
{
  const items = run([replyThread('a', 1)], { replyDueAfterDays: 0 });
  ok('with the number set to 0 a reply shows at once', items.some((i) => i.kind === KIND.REPLY_DUE));
  const lax = run([replyThread('a', 8)], { replyDueAfterDays: 10 });
  ok('the admin\'s own number is the one used (10 days: an 8-day-old reply is not yet due)', !lax.some((i) => i.kind === KIND.REPLY_DUE) && lax.reply_not_due_yet === 1);
}
{
  const t = lead('p', [msg('outbound', 9, 'Hello'), msg('inbound', 1, 'Interested — I will come back to you in a few days')]);   // a positive reply is owed at 2 days (D-0168)
  const items = run([t]);
  ok('a fresh reply that is not yet due makes no tile of any kind yet', !items.some((i) => i.entity_id === 'p'), JSON.stringify(items.map((i) => i.kind)));
}

// ── Promise due and Reminder due: unchanged ─────────────────────────────────
{
  const promise = lead('pr', [msg('outbound', 20, 'Hi'), msg('inbound', 12, 'Let me check and get back to you next week.'), msg('outbound', 11, 'Great, thanks.')]);
  const items = run([promise]);
  ok('a promise that has come due is still listed', items.some((i) => i.kind === KIND.COMMITMENT_DUE), JSON.stringify(items.map((i) => i.kind)));
  const rem = run([], { reminders: [{ id: 'r1', user_id: 'u1', return_date: '2026-10-19', note: 'Call back', status: 'pending', contact_name: 'Sam' }] });
  ok('a reminder that came due is still listed', rem.some((i) => i.kind === KIND.REMINDER_DUE));
}

// ── Silence after OUR email is not a tile (D-0169) ──────────────────────────
const silent = (id, days, extra) => lead(id, [msg('outbound', days, 'Following up')], extra);
{
  const items = run([silent('s10', 10), silent('s46', 46), silent('s91', 91), silent('g1', 60, { job_id: 'J' }), silent('g2', 70, { job_id: 'J' })]);
  ok('we wrote and nobody answered (10, 46, 91 days; one person or a whole company) → no tile', items.length === 0, JSON.stringify(items.map((i) => [i.entity_id, i.kind])));
  const owed = run([replyThread('o', 6), silent('q', 91)]);
  ok('…while a reply we owe is still listed', owed.length === 1 && owed[0].kind === KIND.REPLY_DUE && owed[0].entity_id === 'o');
  const seq = run([], { reminders: [
    { id: 'r-seq', user_id: 'u1', return_date: '2026-10-19', note: 'Call + LinkedIn', status: 'pending', contact_name: 'Seq', reminder_type: 'bd_touch' },
    { id: 'r-task', user_id: 'u1', return_date: '2026-10-19', note: 'Candidate task', status: 'pending', contact_name: 'Task', reminder_type: 'recruiter_task' },
    { id: 'r-me', user_id: 'u1', return_date: '2026-10-19', note: 'Call back', status: 'pending', contact_name: 'Mine', reminder_type: 'manual' },
    { id: 'r-mgr', user_id: 'u1', return_date: '2026-10-19', note: 'Reconnect your mailbox', status: 'pending', contact_name: 'Manager', reminder_type: 'manager_prompt' },
  ] });
  ok('a reminder a SEQUENCE made is not a tile; one a person set (or a manager asked) is', seq.map((i) => i.reminder_id).sort().join() === 'r-me,r-mgr', JSON.stringify(seq.map((i) => i.reminder_id)));
}

// ── Opt-outs and a clear "no": never shown ──────────────────────────────────
{
  const optOut = lead('x', [msg('outbound', 20, 'Hello'), msg('inbound', 10, 'Please remove me from your list, unsubscribe')]);
  const no = lead('y', [msg('outbound', 20, 'Hello'), msg('inbound', 10, 'No thank you, we are not interested')]);
  const items = run([optOut, no]);
  ok('an opt-out and a clear "no" are never shown', items.length === 0, JSON.stringify(items.map((i) => [i.entity_id, i.kind])));
}

// ── the admin's numbers exist, with the owner's defaults ────────────────────
{
  const sch = settings.SETTINGS_SCHEMA.filter((s) => s.group === 'Needs you today');
  const byKey = Object.fromEntries(sch.map((s) => [s.key, s]));
  ok('the reply numbers are admin settings, not typed into the code (D-0123)', byKey.needs_reply_after_days && byKey.needs_reply_positive_after_days);
  ok('…defaults 4 and 2, the owner\'s own', byKey.needs_reply_after_days.default === 4 && byKey.needs_reply_positive_after_days.default === 2);
  ok('…and the quiet-nudge setting is gone with the no-reply tiles (no setting that does nothing)', !byKey.nudge_quiet_after_days);
  const db = createFakeDb({ tables: { app_settings: [] } });
  ok('…and the app reads them from there (default when the admin has not chosen)', await settings.getSetting(db.supabase, 'needs_reply_after_days', 'org-1') === 4 && await settings.getSetting(db.supabase, 'needs_reply_positive_after_days', 'org-1') === 2);
  const db2 = createFakeDb({ tables: { app_settings: [] } });
  const saved = await settings.setSettings(db2.supabase, { needs_reply_after_days: 2 }, 'org-2');
  ok('…an admin\'s own choice is saved and is the one used, for their company only', !saved.error && await settings.getSetting(db2.supabase, 'needs_reply_after_days', 'org-2') === 2 && await settings.getSetting(db2.supabase, 'needs_reply_after_days', 'org-3') === 4, JSON.stringify(saved));
}

const failed = results.filter((r) => !r).length;
// ── A reply from a lead already marked Rejected is still owed, but labelled (owner, 20 Oct) ──
{
  const items = run([lead('rj', [msg('outbound', 14, 'Hello'), msg('inbound', 6, 'Actually, can we talk?')], { stage: 'Rejected' }), replyThread('ok', 6)]);
  const rj = items.find((i) => i.entity_id === 'rj'), ok2 = items.find((i) => i.entity_id === 'ok');
  ok('a reply from a Rejected lead is still listed (it may be a second chance)', !!rj && rj.kind === KIND.REPLY_DUE);
  ok('…and the row says "rejected lead"', rj && rj.rejected_lead === true);
  ok('an ordinary lead\'s reply carries no such label', ok2 && ok2.rejected_lead === false);
}

console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
