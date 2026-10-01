// THE VIEWER'S OWN CLOCK, FOR DASHBOARDS AND REPORTS (R-103/R-105, D-0065).
//
// Lead Insights already cuts its days at the viewer's midnight (services/bd-insights.js). The
// Dashboard cards, the recruiting dashboard, the Reports page and /stats cut theirs on the SERVER's
// clock (UTC on Render) with a 7×24 h "week" that reaches back eight calendar days. This is the one
// place that says what a window is, in the viewer's zone (`?tz=<IANA zone>`; none/unknown = UTC):
//
//   today        the viewer's calendar day
//   week         the last 7 calendar days INCLUDING today
//   month        the CALENDAR month so far (1st of this month … today)   [Insights says "30 days": its own, labelled word]
//   quarter      the last 90 calendar days including today
//
// The owner's open question was whether "month" is the rolling 30 days or the calendar month. The
// Dashboard and Reports have always said "this month" meaning the calendar month, and Lead Insights
// labels its window "30 days", so the two do not collide in words; each keeps its meaning and only
// the cut (viewer's midnight, 7-day week) changes. Reversible: it is one line, `monthStart`.

const bd = require('./bd-insights');

function windowsFor(now, tz) {
  const z = bd.validZone(tz);
  const today = bd.dayKey(now, 0, z);
  return {
    tz: z,
    today,
    weekFrom: bd.dayKey(now, 6, z),
    monthStart: today.slice(0, 8) + '01',
    quarterFrom: bd.dayKey(now, 89, z),
  };
}

// Minutes east of UTC that `zone` is at the instant `ms` (a whole number of seconds).
function offsetMin(zone, ms) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second) - ms) / 60000);
}
// 'YYYY-MM-DD' + h/m/s read in `tz` → epoch ms (null when the date is unreadable).
function zonedMs(dateStr, h, m, s, tz) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || '')); if (!d) return null;
  const z = bd.validZone(tz);
  const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], h, m, s);
  const o1 = offsetMin(z, guess); let t = guess - o1 * 60000; const o2 = offsetMin(z, t);
  if (o2 !== o1) t = guess - o2 * 60000;
  return t;
}
const dayStartMs = (dateStr, tz) => zonedMs(dateStr, 0, 0, 0, tz);
const dayEndMs = (dateStr, tz) => zonedMs(dateStr, 23, 59, 59, tz);

module.exports = { windowsFor, dayStartMs, dayEndMs };
