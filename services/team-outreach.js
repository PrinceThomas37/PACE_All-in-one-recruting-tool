'use strict';
// ============================================================================
// THE TEAM'S OUTREACH — for the RA Lead (and an admin): how the leads they hand out are doing (owner, 29 Oct 2026).
//
// "The RA lead should have outreach insights of all the team, or all the leads assigned by them to the users or managers:
// what's the connect ratio, what's the block ratio — similar to the BD manager's outreach insights — by total leads, and
// also per user and per email ID."
// Every number uses the definitions PACE already has (services/bd-insights.js, services/outreach-insights.js), never a
// second copy:
//   people      = the contacts written to in the dates          emailed    = emails sent in the dates
//   replied     = people who replied after we wrote              connected  = their lead is Connected or In Discussion
//   bounced     = the address is Invalid or Blocked (and how many of each — blocked: their side refuses our mail)
// A rate with nothing under it is null ("—"), never a made-up 0%. A person counts under the user and the email ID that
// wrote to them FIRST in the dates (one person, one row — so the rows add up to the total).
// PURE: no database, no clock.
// ============================================================================
const { CONVERTED } = require('./bd-insights');

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function blank(key, name) { return { key, name, people: 0, emailed: 0, replied: 0, connected: 0, bounced: 0, blocked: 0, invalid: 0 }; }
function rates(r) {
  return Object.assign(r, { replied_rate: pct(r.replied, r.people), connect_rate: pct(r.connected, r.people),
    bounce_rate: pct(r.bounced, r.people), block_rate: pct(r.blocked, r.people) });
}

/**
 * @param o.sends     [{ id, day, contact_id, sent_by, from_email }]  — lead emails SENT in the dates, oldest first
 * @param o.contacts  { [contact_id]: { email_status, replied_day, stage } }
 * @param o.people    { [user_id]: name }
 */
function summarise(o) {
  const sends = (o.sends || []).slice().sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.id).localeCompare(String(b.id)));
  const total = blank('all', 'Everyone'), byUser = {}, byBox = {}, firstOf = {};
  for (const s of sends) {
    const uk = s.sent_by || 'unknown', bk = String(s.from_email || '').toLowerCase() || 'unknown';
    const u = byUser[uk] = byUser[uk] || blank(uk, (o.people && o.people[uk]) || 'Someone');
    const b = byBox[bk] = byBox[bk] || blank(bk, bk === 'unknown' ? 'Email ID not recorded' : bk);
    total.emailed++; u.emailed++; b.emailed++;
    if (!s.contact_id || firstOf[s.contact_id]) continue;
    firstOf[s.contact_id] = true;
    const c = (o.contacts && o.contacts[s.contact_id]) || {};
    const st = String(c.email_status || '').toLowerCase();
    const add = (r) => {
      r.people++;
      if (c.replied_day && c.replied_day >= s.day) r.replied++;
      if (CONVERTED.includes(c.stage)) r.connected++;
      if (st === 'blocked') { r.bounced++; r.blocked++; } else if (st === 'invalid') { r.bounced++; r.invalid++; }
    };
    add(total); add(u); add(b);
  }
  const order = (a, b) => b.people - a.people || b.emailed - a.emailed || String(a.name).localeCompare(String(b.name));
  return {
    total: rates(total),
    by_user: Object.values(byUser).map(rates).sort(order),
    by_mailbox: Object.values(byBox).map(rates).sort(order),
  };
}

module.exports = { summarise };
