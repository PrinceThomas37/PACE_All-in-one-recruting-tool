'use strict';
// ============================================================================
// THE SYSTEM-HEALTH BANNER — WHAT IS BROKEN, SINCE WHEN, AND WHAT AN ADMIN CAN DO ABOUT IT (R-367, owner 3 Nov 2026).
//
// Why it exists: follow-ups stopped for four days (30 Oct – 2 Nov) and nobody was told. The owner: "the banner should be in admin, and the admin
// should be able to DO something about it, not just see the message".
//
// PURE (no database, no clock): the route (routes/system-health.js) reads the facts, this decides what is wrong, in plain words, and WHICH BUTTONS to offer.
// A rule that decides whether an action is allowed lives where the action is OFFERED (CLAUDE.md): the screen draws only the buttons returned here, and the
// route behind each button re-checks with its own role rule — the operator-only engine run stays operator-only.
//
// Every issue: { id, level:'bad'|'warn', title, sentence, since, who:'admin'|'operator', actions:[{ id, label, confirm, method, path, body? } | { id, label, go }] }
//   · `confirm` is the sentence the person is asked to agree to BEFORE the button does anything (no button changes data without one).
//   · `go` is a screen to open (no data changes).
// Calm by default: no issue → nothing is drawn. An issue that could not be CHECKED is itself an issue ("could not check"), never "all fine".
//
// WHAT IT CHECKS TODAY (each from a source that exists and was read):
//   follow-ups did not run / failed after three tries · background jobs overdue or last run failed · the heartbeat gone silent · mailboxes whose sign-in expired,
//   that PACE auto-paused, or that an admin blocked · the server restarted recently or is near its memory limit.
// NOT YET (no data to read — said here, not hidden): emails stuck at "sending" (no claim timestamp on the row), a mailbox at its daily limit with a queue behind
//   it, a company-wide bounce trend. Each is a ROADMAP row (R-370).
// ============================================================================

const LEVEL_RANK = { bad: 0, warn: 1 };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const names = (list, max = 4) => list.slice(0, max).join(', ') + (list.length > max ? ` and ${list.length - max} more` : '');

/**
 * @param f the facts:
 *   now (ms), isOperator (bool),
 *   followups: { alert:{date,reason?,error?,tries?}|null, lastRunDate:'YYYY-MM-DD'|null, todayIst:'YYYY-MM-DD', sendTime:'HH:MM', istMinutes:number, checked:boolean }
 *   engine: { checked:boolean, heartbeat:{state,minutes_since_ping}, jobs:[{job,overdue,last_run_at,every_ms}], lastRuns:[{job_name,status,error,started_at}] }
 *   mailboxes: { checked:boolean, expired:[email], autoPaused:[email], blocked:[email], closed:number }   (closed = warnings this admin closed; they are left out of the lists, R-382)
 *   server: { uptimeMin, rssMb, rssLimitMb }
 * @returns issues sorted worst first
 */
function evaluate(f) {
  f = f || {};
  const out = [];
  const fu = f.followups;

  // ── follow-ups ──
  if (fu) {
    if (!fu.checked) {
      out.push({ id: 'followups_unchecked', level: 'warn', who: 'admin', title: 'Could not check the follow-ups', sentence: 'PACE could not read when follow-ups last ran, so it cannot say they are fine.', since: null, actions: [] });
    } else if (fu.alert) {
      out.push({
        id: 'followups_failed', level: 'bad', who: 'admin', title: 'Today\'s follow-ups could not run',
        sentence: `The daily follow-up run tried three times today and could not finish${fu.alert.reason ? ': ' + fu.alert.reason : ''}. No follow-ups went out from it.`,
        since: fu.alert.date || null,
        actions: [runFollowups('Run follow-ups now')],
      });
    } else {
      const [h, m] = String(fu.sendTime || '08:30').split(':').map(Number);
      const due = (h || 0) * 60 + (m || 0) + 120;                // two hours after the send time: the run has had its chances (it is retried every 5 minutes)
      if (fu.lastRunDate !== fu.todayIst && fu.istMinutes >= due) {
        out.push({
          id: 'followups_missed', level: 'bad', who: 'admin', title: 'Today\'s follow-ups have not run',
          sentence: `The daily follow-up run is set for ${fu.sendTime || '08:30'} (India time) and it has not run today. ${fu.lastRunDate ? 'It last ran on ' + fu.lastRunDate + '.' : 'PACE has no record of it ever running.'}`,
          since: fu.lastRunDate || null,
          actions: [runFollowups('Run follow-ups now')],
        });
      }
    }
  }

  // ── background jobs and the heartbeat (the PACE operator's concern: they run for every company) ──
  const en = f.engine;
  if (en && f.isOperator) {
    if (!en.checked) {
      out.push({ id: 'engine_unchecked', level: 'warn', who: 'operator', title: 'Could not check the background jobs', sentence: 'PACE could not read the background-job records, so it cannot say they are fine.', since: null, actions: [] });
    } else {
      if (en.heartbeat && en.heartbeat.state === 'silent') {
        out.push({
          id: 'heartbeat_silent', level: 'bad', who: 'operator', title: 'Nothing has woken the server for hours',
          sentence: `The outside timer that wakes the free server has not been heard from${en.heartbeat.minutes_since_ping != null ? ' for ' + Math.round(en.heartbeat.minutes_since_ping / 60) + ' hours' : ''}. Background jobs only run while someone is using the app until it comes back. Check that the GitHub timer is on and its key matches the server's.`,
          since: null, actions: [],
        });
      }
      const failedLast = new Map();
      (en.lastRuns || []).forEach((r) => { if (!failedLast.has(r.job_name)) failedLast.set(r.job_name, r); });   // newest first: the first seen per job is its last run
      const failed = [...failedLast.values()].filter((r) => r.status && r.status !== 'ok' && r.status !== 'success');
      const overdue = (en.jobs || []).filter((j) => j.overdue);
      const jobIds = [...new Set([...failed.map((r) => r.job_name), ...overdue.map((j) => j.job)])];
      if (jobIds.length) {
        const why = [];
        if (failed.length) why.push(`${plural(failed.length, 'job')} failed on the last run (${names(failed.map((r) => r.job_name))}${failed[0].error ? ': ' + String(failed[0].error).slice(0, 140) : ''})`);
        if (overdue.length) why.push(`${plural(overdue.length, 'job')} overdue (${names(overdue.map((j) => j.job))})`);
        out.push({
          id: 'jobs_unhealthy', level: failed.length ? 'bad' : 'warn', who: 'operator', title: 'Background jobs need attention',
          sentence: why.join('; ') + '. These read replies and bounces, retry waiting emails and bring follow-ups back.',
          since: (overdue[0] && overdue[0].last_run_at) || (failed[0] && failed[0].started_at) || null,
          actions: jobIds.slice(0, 4).map((j) => ({ id: 'run_job:' + j, label: 'Run ' + j.replace(/_/g, ' ') + ' now', confirm: `Run the "${j.replace(/_/g, ' ')}" job now? It does its normal work once, for every company, and does not change its schedule.`, method: 'POST', path: '/admin/engine/run/' + encodeURIComponent(j) })),
        });
      }
    }
  }

  // ── mailboxes (this company's) ──
  const mb = f.mailboxes;
  if (mb) {
    if (!mb.checked) {
      out.push({ id: 'mailboxes_unchecked', level: 'warn', who: 'admin', title: 'Could not check the mailboxes', sentence: 'PACE could not read the mailboxes, so it cannot say they are fine.', since: null, actions: [] });
    } else {
      const bits = [];
      if (mb.expired.length) bits.push(`${plural(mb.expired.length, 'sign-in')} expired (${names(mb.expired)}) — only each mailbox's owner can reconnect it`);
      if (mb.autoPaused.length) bits.push(`${plural(mb.autoPaused.length, 'mailbox', 'mailboxes')} paused by PACE for bounces (${names(mb.autoPaused)})`);
      if (mb.blocked.length) bits.push(`${plural(mb.blocked.length, 'mailbox', 'mailboxes')} blocked by an admin (${names(mb.blocked)})`);
      if (bits.length) {
        out.push({
          id: 'mailboxes_attention', level: (mb.expired.length || mb.autoPaused.length) ? 'bad' : 'warn', who: 'admin', title: 'Some mailboxes are not sending',
          sentence: bits.join('; ') + '. Nothing is sent from them until they are fixed.' + (mb.closed ? ` (${plural(mb.closed, 'more warning')} closed by you.)` : ''),
          since: null,
          actions: [{ id: 'go_mailboxes', label: 'Open the mailbox panel', go: 'deliverability' }],
        });
      }
    }
  }

  // ── the server itself (operator; report only — there is no safe button) ──
  const sv = f.server;
  if (sv && f.isOperator) {
    if (sv.uptimeMin != null && sv.uptimeMin < 15) {
      out.push({ id: 'server_restarted', level: 'warn', who: 'operator', title: 'The server just restarted', sentence: `It has been up for ${sv.uptimeMin} minute${sv.uptimeMin === 1 ? '' : 's'}. A deploy or the free tier waking up does this; if it keeps happening, memory is the usual cause.`, since: null, actions: [] });
    }
    if (sv.rssMb != null && sv.rssLimitMb && sv.rssMb >= sv.rssLimitMb * 0.85) {
      out.push({ id: 'server_memory', level: 'bad', who: 'operator', title: 'The server is close to its memory limit', sentence: `It is using ${sv.rssMb} MB of about ${sv.rssLimitMb} MB. Past the limit the free server restarts and drops what it was doing.`, since: null, actions: [] });
    }
  }

  return out.sort((a, b) => (LEVEL_RANK[a.level] - LEVEL_RANK[b.level]) || a.id.localeCompare(b.id));
}

function runFollowups(label) {
  return { id: 'run_followups', label, confirm: 'Run today\'s follow-ups now? Every follow-up that is due is queued for sending, exactly as the daily run does it.', method: 'POST', path: '/follow-ups/run' };
}

module.exports = { evaluate };
