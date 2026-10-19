'use strict';
// OUTREACH INSIGHTS — how a person's sequences are doing, each number said ONCE (owner, 19 Oct, D-0160, R-278; drawn at
// https://claude.ai/artifact/DF9nDByMp9grLCrBT2ggCo). The old page showed "emails sent · 30 days" twice, and a funnel and a stage
// breakdown that were the same stage counts; the owner asked for the Saleshandy shape: five numbers, one line chart (emailed /
// opened / replied, by day or by week), and a table per sequence.
//
// The definitions are the ones PACE already uses, never a second copy (services/bd-insights.js):
//   bounced  = a contact whose address is 'invalid'           open rate = opened ÷ TRACKED emails (an untracked one is not "unopened")
//   interested = the lead is Connected or In Discussion        replied   = the person replied after we wrote (contacts.replied_at)
// A rate with nothing under it is null ("—"), never a made-up 0%.
//
// Which sequence sent an email: a sequence's step records the email it queued (workflow_step_runs.detail.email_id; a candidate
// step, its tracking token). Anything else a person sent to a lead is "Your outreach" — the sequence from My Setup.
//
// PURE: no database, no clock. The route (routes/workflows.js GET /insights/outreach) reads the rows and hands them in.

const { CONVERTED } = require('./bd-insights');

const OUTREACH = 'outreach';
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** Every day from `from` to `to`, inclusive (both YYYY-MM-DD). */
function daysBetween(from, to) {
  const out = [];
  if (!isDay(from) || !isDay(to) || from > to) return out;
  for (let t = Date.parse(from + 'T00:00:00Z'), end = Date.parse(to + 'T00:00:00Z'); t <= end && out.length < 400; t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
/** The Monday that starts the week a day is in (weeks are Monday–Sunday). */
function weekOf(day) {
  const t = Date.parse(day + 'T00:00:00Z'), dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 864e5).toISOString().slice(0, 10);
}

/**
 * @param o.from, o.to     the range, YYYY-MM-DD, in the viewer's own days
 * @param o.bucket         'day' | 'week'
 * @param o.leadSends      [{ id, day, contact_id, seq }]                — lead emails SENT in the range (seq: workflow id or null)
 * @param o.tracking       [{ email_id, open_count }]                     — tracking rows for those emails
 * @param o.contacts       { [contact_id]: { email_status, replied_day, stage } }
 * @param o.candSends      [{ id, day, candidate_id, seq, open_count, replied_day }] — candidate sequence emails sent in the range
 * @param o.seqNames       { [workflow_id]: name }
 * @param o.only           'all' | 'outreach' | <workflow id>             — narrow everything to one sequence
 */
function summarise(o) {
  const from = o.from, to = o.to, bucket = o.bucket === 'week' ? 'week' : 'day';
  const only = o.only && o.only !== 'all' ? o.only : null;
  const inRange = (d) => isDay(d) && d >= from && d <= to;
  const keyOf = (s) => (s.seq ? s.seq : OUTREACH);
  const lead = (o.leadSends || []).filter((s) => inRange(s.day) && (!only || keyOf(s) === only));
  const cand = (o.candSends || []).filter((s) => inRange(s.day) && (!only || keyOf(s) === only));
  const contacts = o.contacts || {};
  const opens = {}; (o.tracking || []).forEach((t) => { if (!t || !t.email_id) return; opens[t.email_id] = Math.max(opens[t.email_id] || 0, Number(t.open_count) || 0); });
  const tracked = (s) => Object.prototype.hasOwnProperty.call(opens, s.id);

  // one group per sequence (and one for the whole), so the table and the strip use the SAME counting
  function group(leadRows, candRows) {
    const people = new Set(), replied = new Set(), interested = new Set(), bounced = new Set();
    let trackedN = 0, openedN = 0;
    leadRows.forEach((s) => {
      if (!s.contact_id) return;
      const c = contacts[s.contact_id] || {};
      people.add('c:' + s.contact_id);
      if (tracked(s)) { trackedN++; if (opens[s.id] > 0) openedN++; }
      if (c.replied_day && c.replied_day >= s.day) replied.add('c:' + s.contact_id);
      if (CONVERTED.includes(c.stage)) interested.add('c:' + s.contact_id);
      if (c.email_status === 'invalid') bounced.add('c:' + s.contact_id);
    });
    candRows.forEach((s) => {
      if (!s.candidate_id) return;
      people.add('p:' + s.candidate_id);
      trackedN++; if ((Number(s.open_count) || 0) > 0) openedN++;           // every candidate sequence email carries a pixel
      if (s.replied_day && s.replied_day >= s.day) replied.add('p:' + s.candidate_id);
    });
    const leadPeople = [...people].filter((k) => k.startsWith('c:')).length;
    return {
      people: people.size, emailed: leadRows.length + candRows.length,
      opened_rate: pct(openedN, trackedN), replied: replied.size, replied_rate: pct(replied.size, people.size),
      interested: leadPeople ? interested.size : null, bounced_rate: leadPeople ? pct(bounced.size, leadPeople) : null,
    };
  }

  // the chart: emails out, of them opened, and people whose reply landed that day/week
  const days = daysBetween(from, to);
  const keys = bucket === 'week' ? [...new Set(days.map(weekOf))] : days;
  const at = (d) => (bucket === 'week' ? weekOf(d) : d);
  const series = keys.map((k) => ({ key: k, emailed: 0, opened: 0, replied: 0 }));
  const idx = {}; series.forEach((p, i) => { idx[p.key] = i; });
  const repliedSeen = new Set();
  lead.forEach((s) => {
    const p = series[idx[at(s.day)]]; if (p) { p.emailed++; if (opens[s.id] > 0) p.opened++; }
    const c = contacts[s.contact_id] || {};
    if (c.replied_day && c.replied_day >= s.day && inRange(c.replied_day) && !repliedSeen.has('c:' + s.contact_id)) {
      repliedSeen.add('c:' + s.contact_id); const q = series[idx[at(c.replied_day)]]; if (q) q.replied++;
    }
  });
  cand.forEach((s) => {
    const p = series[idx[at(s.day)]]; if (p) { p.emailed++; if ((Number(s.open_count) || 0) > 0) p.opened++; }
    if (s.replied_day && s.replied_day >= s.day && inRange(s.replied_day) && !repliedSeen.has('p:' + s.candidate_id)) {
      repliedSeen.add('p:' + s.candidate_id); const q = series[idx[at(s.replied_day)]]; if (q) q.replied++;
    }
  });

  // the table: Your outreach first, then every sequence that sent something in the range
  const names = o.seqNames || {};
  const seqKeys = [...new Set(lead.map(keyOf).concat(cand.map(keyOf)))];
  seqKeys.sort((a, b) => (a === OUTREACH ? -1 : b === OUTREACH ? 1 : String(names[a] || '').localeCompare(String(names[b] || ''))));
  const sequences = seqKeys.map((k) => Object.assign({ id: k, name: k === OUTREACH ? 'Your outreach' : (names[k] || 'A sequence'),
    candidates: cand.some((s) => keyOf(s) === k) && !lead.some((s) => keyOf(s) === k) }, group(lead.filter((s) => keyOf(s) === k), cand.filter((s) => keyOf(s) === k))));

  return { from, to, bucket, totals: group(lead, cand), series, sequences };
}

module.exports = { summarise, daysBetween, weekOf, OUTREACH };
