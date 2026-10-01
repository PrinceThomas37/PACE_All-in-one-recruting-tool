// RESEARCH-ANALYST INSIGHTS — ONE CALCULATION (R-100, owner 2026-09-30).
//
// The RA Team table in Lead Insights was added up in the BROWSER from whatever jobs the page held,
// with a hard-coded India offset, while the personal RA report was added up on the server with a
// different "week". Same cure as the BD views (services/bd-insights.js): the definitions live here,
// the server runs them, the browser only draws.
//
//   a lead belongs to the RA who created it (jobs.created_by)
//   created day  = the day `created_at` falls on in the VIEWER's zone (a plain `created_date` is already a day)
//   today / 7 days / 30 days = created today / in the last 7 / 30 days INCLUDING today (the viewer's days)
//   total        = every lead the RA ever created
//   assigned     = leads no longer 'Unassigned';  assigned % = assigned / total
//   converted    = Connected + In Discussion;      converted % = converted / total
//   duplicates   = leads flagged is_duplicate
//   periods      = the Dashboard's daily / weekly / monthly (calendar) / quarterly (90 days) cuts of the same rows (R-106)

const bd = require('./bd-insights');
const CONVERTED = ['Connected', 'In Discussion'];
const pct = (n, d) => (d ? Math.round(n / d * 100) : 0);

function summarise({ jobs, now, tz }) {
  const z = bd.validZone(tz);
  const w = bd.windows(now, z);
  const all = jobs || [];
  const day = (j) => bd.dayOf(j.created_at || j.created_date, z);
  const last7 = {};
  w.last7.forEach(k => { last7[k] = all.filter(j => day(j) === k).length; });
  // The Dashboard's period picker (R-106): the same rows, cut four ways, every figure on the card
  // from here — the browser no longer adds up leads. daily = today; weekly = 7 calendar days including
  // today; monthly = the calendar month so far; quarterly = the last 90 days (all the viewer's days).
  const monthStart = w.today.slice(0, 8) + '01';
  const quarterFrom = bd.dayKey(now, 89, z);
  const inPeriod = {
    daily: d => d === w.today, weekly: d => d >= w.weekFrom, monthly: d => d >= monthStart, quarterly: d => d >= quarterFrom,
  };
  const periods = {};
  Object.keys(inPeriod).forEach(p => {
    const rows = all.filter(j => { const d = day(j); return d && inPeriod[p](d); });
    const conv = rows.filter(j => CONVERTED.includes(j.stage)).length;
    const by_stage = {}, by_industry = {};
    rows.forEach(j => {
      by_stage[j.stage || 'Unknown'] = (by_stage[j.stage || 'Unknown'] || 0) + 1;
      const ind = String(j.industry || (j.company && j.company.industry) || '').trim();
      if (ind) by_industry[ind] = (by_industry[ind] || 0) + 1;
    });
    periods[p] = { total: rows.length, dups: rows.filter(j => j.is_duplicate).length, converted: conv, convRate: pct(conv, rows.length), by_stage, by_industry };
  });
  const assigned = all.filter(j => j.stage && j.stage !== 'Unassigned').length;
  const converted = all.filter(j => CONVERTED.includes(j.stage)).length;
  return {
    total: all.length,
    today: all.filter(j => day(j) === w.today).length,
    week: all.filter(j => day(j) >= w.weekFrom).length,
    month: all.filter(j => day(j) >= w.monthFrom).length,
    dups: all.filter(j => j.is_duplicate).length,
    assigned, assignPct: pct(assigned, all.length),
    conv: converted, convPct: pct(converted, all.length),
    last_7: last7,
    periods,
  };
}

module.exports = { summarise, CONVERTED };
