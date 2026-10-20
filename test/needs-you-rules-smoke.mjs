// "Needs you today" — the owner's rules of 20 Oct 2026 (R-290), proven on the real ranking (next-action.js) and the real route.
//
//   Reply due      a reply is OWED once their email is `needs_reply_after_days` old (default 4); fresher ones are counted, not listed
//   Promise due    unchanged            Reminder due   unchanged
//   Chase          up to `nudge_quiet_after_days` (45) an ordinary chase; past it a QUIET nudge — shown, lowest, "chase or drop"
//   Opt-outs / a clear "no": never shown
//
// Usage: node test/needs-you-rules-smoke.mjs

import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const { buildNextActions, KIND, STALE_NUDGE_PRIORITY, REPLY_DUE_AFTER_DAYS } = require('../next-action.js');
const settings = require('../config/settings');

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };

const NOW = Date.parse('2026-10-20T12:00:00Z');
const DAY = 86400000;
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const msg = (direction, daysAgo, body) => ({ direction, sent_at: at(daysAgo), body });
const lead = (id, messages, extra = {}) => ({ entity_type: 'contact', entity_id: id, name: 'Person ' + id, company: 'Co ' + id, stage: 'Connected', job_id: 'job-' + id, owner_id: 'u1', messages, ...extra });
const replyThread = (id, theirDaysAgo) => lead(id, [msg('outbound', theirDaysAgo + 3, 'Hello, we have candidates'), msg('inbound', theirDaysAgo, 'Yes, please send resumes')]);
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
  const t = lead('p', [msg('outbound', 9, 'Hello'), msg('inbound', 2, 'Interested — I will come back to you in a few days')]);
  const items = run([t]);
  ok('a fresh reply that is not yet due is not turned into a chase either', !items.some((i) => i.entity_id === 'p' && i.kind === KIND.NUDGE));
}

// ── Promise due and Reminder due: unchanged ─────────────────────────────────
{
  const promise = lead('pr', [msg('outbound', 20, 'Hi'), msg('inbound', 12, 'Let me check and get back to you next week.'), msg('outbound', 11, 'Great, thanks.')]);
  const items = run([promise]);
  ok('a promise that has come due is still listed', items.some((i) => i.kind === KIND.COMMITMENT_DUE), JSON.stringify(items.map((i) => i.kind)));
  const rem = run([], { reminders: [{ id: 'r1', user_id: 'u1', return_date: '2026-10-19', note: 'Call back', status: 'pending', contact_name: 'Sam' }] });
  ok('a reminder that came due is still listed', rem.some((i) => i.kind === KIND.REMINDER_DUE));
}

// ── Chase: ordinary up to 45 days, then a quiet nudge ───────────────────────
const silent = (id, days, extra) => lead(id, [msg('outbound', days, 'Following up')], extra);
{
  const items = run([silent('s10', 10), silent('s44', 44), silent('s46', 46), silent('s91', 91)]);
  const by = Object.fromEntries(items.filter((i) => i.kind === KIND.NUDGE).map((i) => [i.entity_id, i]));
  ok('10 and 44 days of silence are ordinary chases', by.s10 && !by.s10.stale && by.s44 && !by.s44.stale);
  ok('46 and 91 days are STILL shown (they used to vanish), marked as quiet nudges', by.s46 && by.s46.stale === true && by.s91 && by.s91.stale === true);
  ok('…the reason asks for a decision: chase or drop', /chase them, or drop the lead/i.test(by.s91.reason), by.s91.reason);
  const rank = items.map((i) => i.entity_id);
  ok('…and they sit BELOW every ordinary one', rank.indexOf('s91') > rank.indexOf('s10') && rank.indexOf('s46') > rank.indexOf('s44'), rank.join());
  ok('…with the lowest priority a live row can have', by.s91.priority <= STALE_NUDGE_PRIORITY && by.s10.priority > STALE_NUDGE_PRIORITY);
}
{
  const owed = run([replyThread('o', 6), silent('q', 91)]);
  ok('a quiet nudge never pushes a reply you owe down the list', owed[0].kind === KIND.REPLY_DUE);
  const early = run([silent('e', 91, { stage: 'Assigned' })]);
  ok('a lead that is only Assigned still gets no chase at all (the follow-up engine is chasing it)', !early.some((i) => i.kind === KIND.NUDGE));
  const lead2 = [silent('g1', 60, { job_id: 'J' }), silent('g2', 70, { job_id: 'J' })];
  const grouped = run(lead2).filter((i) => i.kind === KIND.NUDGE);
  ok('several quiet people at one company are ONE quiet row', grouped.length === 1 && grouped[0].stale === true && /Chase them, or drop the lead/.test(grouped[0].reason), JSON.stringify(grouped.map((g) => [g.entity_type, g.stale])));
}

// ── Opt-outs and a clear "no": never shown ──────────────────────────────────
{
  const optOut = lead('x', [msg('outbound', 20, 'Hello'), msg('inbound', 10, 'Please remove me from your list, unsubscribe')]);
  const no = lead('y', [msg('outbound', 20, 'Hello'), msg('inbound', 10, 'No thank you, we are not interested')]);
  const items = run([optOut, no]);
  ok('an opt-out and a clear "no" are never shown', items.length === 0, JSON.stringify(items.map((i) => [i.entity_id, i.kind])));
}

// ── the admin's two numbers exist, with the owner's defaults ────────────────
{
  const sch = settings.SETTINGS_SCHEMA.filter((s) => s.group === 'Needs you today');
  const byKey = Object.fromEntries(sch.map((s) => [s.key, s]));
  ok('both numbers are admin settings, not typed into the code (D-0123)', byKey.needs_reply_after_days && byKey.nudge_quiet_after_days);
  ok('…defaults 4 and 45, the owner\'s own', byKey.needs_reply_after_days.default === 4 && byKey.nudge_quiet_after_days.default === 45);
  const db = createFakeDb({ tables: { app_settings: [] } });
  ok('…and the app reads them from there (default when the admin has not chosen)', await settings.getSetting(db.supabase, 'needs_reply_after_days', 'org-1') === 4 && await settings.getSetting(db.supabase, 'nudge_quiet_after_days', 'org-1') === 45);
  const db2 = createFakeDb({ tables: { app_settings: [] } });
  const saved = await settings.setSettings(db2.supabase, { needs_reply_after_days: 2 }, 'org-2');
  ok('…an admin\'s own choice is saved and is the one used, for their company only', !saved.error && await settings.getSetting(db2.supabase, 'needs_reply_after_days', 'org-2') === 2 && await settings.getSetting(db2.supabase, 'needs_reply_after_days', 'org-3') === 4, JSON.stringify(saved));
}

const failed = results.filter((r) => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
