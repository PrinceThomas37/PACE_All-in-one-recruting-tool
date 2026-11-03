// THE SYSTEM-HEALTH RULES (services/system-health.js, pure): what counts as broken, the sentence, and WHICH buttons are offered (R-367, owner 3 Nov 2026).
// Usage: node test/system-health-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const h = require('../services/system-health.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };
const ids = (f) => h.evaluate(f).map((i) => i.id);
const calm = { followups: { checked: true, alert: null, lastRunDate: '2026-11-03', todayIst: '2026-11-03', sendTime: '08:30', istMinutes: 14 * 60 }, mailboxes: { checked: true, expired: [], autoPaused: [], blocked: [] },
  engine: { checked: true, heartbeat: { state: 'healthy', minutes_since_ping: 20 }, jobs: [{ job: 'reply_sweep', overdue: false }], lastRuns: [{ job_name: 'reply_sweep', status: 'ok' }] }, server: { uptimeMin: 600, rssMb: 200, rssLimitMb: 512 }, isOperator: true };

ok('a healthy day draws NOTHING', h.evaluate(calm).length === 0, JSON.stringify(ids(calm)));
ok('no facts at all draws nothing (and does not throw)', h.evaluate(undefined).length === 0 && h.evaluate({}).length === 0);

// follow-ups: the thing that broke for four days
const fu = (o) => ({ ...calm, followups: { ...calm.followups, ...o } });
ok('follow-ups not run today, two hours after the send time → "needs you" with a Run button', (() => { const i = h.evaluate(fu({ lastRunDate: '2026-10-29', istMinutes: 10 * 60 + 31 }))[0]; return i && i.id === 'followups_missed' && i.level === 'bad' && i.actions[0].id === 'run_followups' && i.actions[0].path === '/follow-ups/run' && /2026-10-29/.test(i.sentence); })());
ok('…but not BEFORE two hours have passed (the run is retried every 5 minutes)', !ids(fu({ lastRunDate: '2026-10-29', istMinutes: 10 * 60 + 29 })).includes('followups_missed'));
ok('…and not at all when it ran today', !ids(fu({ lastRunDate: '2026-11-03', istMinutes: 20 * 60 })).includes('followups_missed'));
ok('a run that failed three times today is its own issue with the reason', (() => { const i = h.evaluate(fu({ alert: { date: '2026-11-03', reason: 'the database timed out' } }))[0]; return i.id === 'followups_failed' && /timed out/.test(i.sentence) && i.actions[0].id === 'run_followups'; })());
ok('"no record of it ever running" is said plainly, not as a date', /no record/.test(h.evaluate(fu({ lastRunDate: null, istMinutes: 15 * 60 }))[0].sentence));
ok('if the follow-up record cannot be read, that is an issue — never "all fine"', ids({ followups: { checked: false } }).includes('followups_unchecked'));

// every button that changes data carries the sentence the person must agree to; a screen-opening button carries `go`
const all = h.evaluate({ ...calm, followups: { ...calm.followups, lastRunDate: null, istMinutes: 15 * 60 }, mailboxes: { checked: true, expired: ['a@x.com'], autoPaused: [], blocked: [] }, engine: { checked: true, heartbeat: { state: 'healthy' }, jobs: [{ job: 'reply_sweep', overdue: true, last_run_at: '2026-11-03T01:00:00Z' }], lastRuns: [] } });
const acts = all.flatMap((i) => i.actions);
ok('every data-changing button has a confirm sentence, a method and a path', acts.filter((a) => !a.go).every((a) => a.confirm && a.confirm.length > 20 && a.method === 'POST' && a.path.startsWith('/')), JSON.stringify(acts.filter((a) => !a.go && !a.confirm)));
ok('every opening button names a screen', acts.filter((a) => a.go).every((a) => typeof a.go === 'string'));

// engines: the operator's
const en = (o) => ({ ...calm, engine: { ...calm.engine, ...o } });
ok('an overdue background job offers "Run … now" for THAT job', (() => { const i = h.evaluate(en({ jobs: [{ job: 'reply_sweep', overdue: true, last_run_at: '2026-11-03T01:00:00Z' }] }))[0]; return i.id === 'jobs_unhealthy' && i.actions[0].path === '/admin/engine/run/reply_sweep' && /Run reply sweep now/.test(i.actions[0].label); })());
ok('a job whose last run failed is "needs you" and quotes the error', (() => { const i = h.evaluate(en({ lastRuns: [{ job_name: 'bounce_sweep', status: 'error', error: 'invalid_grant', started_at: '2026-11-03T02:00:00Z' }] }))[0]; return i.level === 'bad' && /invalid_grant/.test(i.sentence); })());
ok('only the LAST run of a job counts (an old failure under a newer success is not shown)', !ids(en({ lastRuns: [{ job_name: 'bounce_sweep', status: 'ok' }, { job_name: 'bounce_sweep', status: 'error', error: 'old' }] })).includes('jobs_unhealthy'));
ok('a silent heartbeat is "needs you" with no button (nothing safe to press) and says what to check', (() => { const i = h.evaluate(en({ heartbeat: { state: 'silent', minutes_since_ping: 600 } }))[0]; return i.id === 'heartbeat_silent' && i.actions.length === 0 && /GitHub/.test(i.sentence); })());
ok('a LATE heartbeat is normal on the free server and says nothing (measured 4 Sep)', h.evaluate(en({ heartbeat: { state: 'late', minutes_since_ping: 200 } })).length === 0);
ok('engine and server issues are the OPERATOR\'s: an admin of another company never sees them', h.evaluate({ ...en({ heartbeat: { state: 'silent' }, jobs: [{ job: 'x', overdue: true }] }), server: { uptimeMin: 1, rssMb: 500, rssLimitMb: 512 }, isOperator: false }).length === 0);
ok('engine records that cannot be read are an issue for the operator', ids(en({ checked: false })).includes('engine_unchecked'));

// mailboxes
const mbx = (o) => ({ ...calm, mailboxes: { checked: true, expired: [], autoPaused: [], blocked: [], ...o } });
ok('an expired sign-in: named, says only the owner can reconnect, opens the mailbox panel', (() => { const i = h.evaluate(mbx({ expired: ['bd@acme.com'] }))[0]; return i.id === 'mailboxes_attention' && /bd@acme.com/.test(i.sentence) && /owner/.test(i.sentence) && i.actions[0].go === 'deliverability' && i.level === 'bad'; })());
ok('a block alone is a warning, not an alarm (an admin did it on purpose)', (() => { const i = h.evaluate(mbx({ blocked: ['b@acme.com'] }))[0]; return i.level === 'warn' && /blocked by an admin/.test(i.sentence); })());
ok('a long list is shortened ("and 3 more"), never a wall', /and 3 more/.test(h.evaluate(mbx({ expired: ['1@x', '2@x', '3@x', '4@x', '5@x', '6@x', '7@x'] }))[0].sentence));
ok('mailboxes that cannot be read are an issue', ids({ mailboxes: { checked: false } }).includes('mailboxes_unchecked'));

// server
ok('a server up for 3 minutes says it just restarted; one near its memory limit is "needs you"; both report only', (() => { const r = h.evaluate({ ...calm, server: { uptimeMin: 3, rssMb: 460, rssLimitMb: 512 } }); return r.some((i) => i.id === 'server_restarted') && r.find((i) => i.id === 'server_memory').level === 'bad' && r.every((i) => i.actions.length === 0); })());
ok('worst first: "needs you" before warnings', (() => { const r = h.evaluate({ ...calm, mailboxes: { checked: true, expired: [], autoPaused: [], blocked: ['b@x'] }, server: { uptimeMin: 600, rssMb: 480, rssLimitMb: 512 } }); return r[0].level === 'bad' && r[r.length - 1].level === 'warn'; })());

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
