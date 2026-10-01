'use strict';
// LEAD INSIGHTS — ONE DEFINITION OF EVERY NUMBER (owner, 2026-09-30).
//
// The owner found Lead Insights saying "0 emails sent" beside 311 on the Email page, and a
// "this week" tile that disagreed with its own chart. The cause under both was that the same
// question — "how is this BD doing?" — was answered by THREE separate calculations (the server's
// personal report, the browser's Team overview and the browser's Team drill-down), in two time
// zones, over a list the page had only partly loaded. This file is the ONE calculation. The
// personal report and the team report both call `summarise()`; no screen does arithmetic on leads
// or emails any more, it draws what the server says.
//
// PURE: no database, no clock of its own (`now` is passed), so every window is testable.
//
// DEFINITIONS (say them in the UI exactly this way):
//   last 7 days  = today and the six days before it — exactly the seven bars of the chart
//   last 30 days = today and the 29 before
//   days         = UTC calendar days (one clock, server side; see TZ note in the route)
//   converted    = the lead's stage is Connected or In Discussion
//   replied      = at least one contact on the lead has a reply recorded (`contacts.replied_at`)
//   reply rate   = replied leads / leads assigned. NOT "moved to Connected": a reply that has not
//                  yet moved the stage still counts, and a stage moved by hand is not a reply.

const CONVERTED = ['Connected', 'In Discussion'];
const POSITIVE = ['Positive'];
const NEGATIVE = ['Negative', 'No Response'];
const OOO = ['Out of Office'];

// A DAY IS THE VIEWER'S OWN DAY (R-102, D-0065). The browser sends its IANA zone
// (`?tz=Asia/Kolkata`); an absent or unknown zone is UTC, which is what every figure used before.
// "Today", "this week" and the 7-day chart all cut at that person's midnight, so a recruiter in
// India and a manager in California looking at the same lead each see their own calendar.
function validZone(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return 'UTC';
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz; } catch (_) { return 'UTC'; }
}
function localDay(t, tz) {
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: validZone(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
// A column holding a plain date ("2026-10-01") is already a day; a timestamp is cut at the viewer's midnight.
const dayOf = (v, tz) => (!v ? '' : (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : localDay(v, tz)));
function dayKey(now, n, tz) {
  const [y, m, d] = localDay(now, tz).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

// The windows, derived once.
function windows(now, tz) {
  const z = validZone(tz);
  return {
    tz: z,
    today: dayKey(now, 0, z),
    weekFrom: dayKey(now, 6, z),
    monthFrom: dayKey(now, 29, z),
    last7: [6, 5, 4, 3, 2, 1, 0].map(n => dayKey(now, n, z)),
  };
}
const pct = (n, d) => (d ? Math.round(n / d * 100) : 0);

/**
 * @param {object}   o
 * @param {object[]} o.jobs         the BD's leads: { id, stage, industry, assigned_at, company?:{industry}, replied?:boolean }
 * @param {object[]} o.emails       the BD's emails (sent_by = them) from the last 30 days: { status, created_at, sent_at }
 * @param {Date|number} o.now
 * @param {string}   [o.tz]         the viewer's IANA time zone; absent/unknown = UTC
 */
function summarise({ jobs, emails, now, tz }) {
  const z = validZone(tz);
  const w = windows(now, z);
  const all = jobs || [];
  const at = (j) => dayOf(j.assigned_at, z);
  const inStages = (list) => all.filter(j => list.includes(j.stage));

  const converted = inStages(CONVERTED);
  const positive = inStages(POSITIVE);
  const replied = all.filter(j => j.replied);

  // The caller reads a little extra either side of the month; the window itself is the viewer's last 30 days.
  const mail = (emails || []).filter(e => dayOf(e.created_at || e.sent_at, z) >= w.monthFrom);
  const sent = mail.filter(e => e.status === 'sent');
  const sentDay = (e) => dayOf(e.sent_at || e.created_at, z);
  const sentInMonth = sent.filter(e => sentDay(e) >= w.monthFrom);

  const last7emails = {}, last7leads = {};
  w.last7.forEach(k => {
    last7emails[k] = sent.filter(e => sentDay(e) === k).length;
    last7leads[k] = all.filter(j => at(j) === k).length;
  });

  const byStage = {}, byIndustry = {};
  all.forEach(j => {
    byStage[j.stage || 'Unknown'] = (byStage[j.stage || 'Unknown'] || 0) + 1;
    const ind = (j.company && j.company.industry) || j.industry || 'Unknown';
    byIndustry[ind] = (byIndustry[ind] || 0) + 1;
  });

  return {
    // volume
    total_all: all.length,
    total_today: all.filter(j => at(j) === w.today).length,
    total_week: all.filter(j => at(j) >= w.weekFrom).length,
    total_month: all.filter(j => at(j) >= w.monthFrom).length,
    // funnel
    assigned: all.filter(j => j.stage === 'Assigned').length,
    positive: positive.length,
    converted: converted.length,
    negative: inStages(NEGATIVE).length,
    ooo: inStages(OOO).length,
    future: all.filter(j => j.stage === 'Future').length,
    conv_rate: pct(converted.length, all.length),
    // replies — the real thing (see the header). `response_rate` is kept as the key the
    // page already reads, and now means exactly this.
    replied: replied.length,
    reply_rate: pct(replied.length, all.length),
    response_rate: pct(replied.length, all.length),
    // emails (last 30 days)
    emails_sent: sentInMonth.length,
    emails_sent_today: sent.filter(e => sentDay(e) === w.today).length,
    emails_pending: mail.filter(e => e.status === 'pending').length,
    emails_failed: mail.filter(e => e.status === 'failed').length,
    // charts
    last_7_emails: last7emails,
    last_7_leads: last7leads,
    // breakdowns
    by_stage: byStage,
    by_industry: byIndustry,
  };
}

module.exports = { summarise, windows, dayKey, validZone, localDay, dayOf, CONVERTED, POSITIVE, NEGATIVE, OOO };
