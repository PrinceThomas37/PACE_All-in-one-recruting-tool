// ============================================================================
// FIRST-EMAIL REPLY RATE, AI-WRITTEN vs TEMPLATE, WEEK BY WEEK (R-343 step C, owner 3 Nov 2026, D-0188 / D-0195).
// ----------------------------------------------------------------------------
// The owner chose templates + versions over AI-written first emails knowing the October numbers (AI 1.23 % vs template 0.54 %
// replies, 1–29 Oct). This is the report that says whether replies dropped after the switch: every first email SENT in the range,
// by week, split by how it was written (template_variant 'ai' = AI-written; anything else = the person's template or a version),
// with replies counted the way Outreach Insights counts them (contacts.replied_at at or after the send).
// PURE: rows in, table out. A rate with nothing under it is null ("—"), never 0 %.
// ============================================================================
'use strict';

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 10000) / 100 : null);
function weekOf(iso) {
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z'), dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 864e5).toISOString().slice(0, 10);
}
const blank = () => ({ sent: 0, replied: 0, ai_sent: 0, ai_replied: 0, tpl_sent: 0, tpl_replied: 0 });
function finish(x) {
  return Object.assign(x, { rate: pct(x.replied, x.sent), ai_rate: pct(x.ai_replied, x.ai_sent), tpl_rate: pct(x.tpl_replied, x.tpl_sent) });
}

/** rows: [{ sent_at, template_variant, replied_at }] → { weeks: [...], total, switched_on } */
function report(rows, switchedOn) {
  const weeks = new Map(), total = blank();
  (rows || []).forEach((r) => {
    if (!r || !r.sent_at) return;
    const wk = weekOf(r.sent_at);
    if (!weeks.has(wk)) weeks.set(wk, blank());
    const ai = r.template_variant === 'ai';
    const replied = !!(r.replied_at && Date.parse(r.replied_at) >= Date.parse(r.sent_at));
    [weeks.get(wk), total].forEach((x) => {
      x.sent++; if (replied) x.replied++;
      if (ai) { x.ai_sent++; if (replied) x.ai_replied++; } else { x.tpl_sent++; if (replied) x.tpl_replied++; }
    });
  });
  const list = [...weeks.keys()].sort().map((wk) => finish(Object.assign({ week: wk, after_switch: !!(switchedOn && wk >= weekOf(switchedOn)) }, weeks.get(wk))));
  // Before / after the switch to templates + versions (the day it went live), when known.
  const side = (after) => finish(list.filter((w) => w.after_switch === after).reduce((a, w) => { Object.keys(blank()).forEach((k) => { a[k] += w[k]; }); return a; }, blank()));
  return { weeks: list, total: finish(total), switched_on: switchedOn || null, before: switchedOn ? side(false) : null, after: switchedOn ? side(true) : null };
}

module.exports = { report, weekOf };
