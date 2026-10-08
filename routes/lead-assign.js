// ============================================================================
// A MANAGER HANDS UNASSIGNED LEADS OUT — to themselves or to their own team (D-0110, R-175)
// ----------------------------------------------------------------------------
// The owner (8 Oct): an import now lands Unassigned, and "options to be given to assign the leads to themselves or any manager
// assigned under them as an assign button in the leads tab" — and the person chooses HOW MANY of the lot go from each of the
// assignee's email IDs ("can a user choose how many of the lot should go from each ID?").
//
//   GET  /leads/assign/people                 who I may hand leads to: me + everyone under me (an admin: the whole company)
//   GET  /leads/assign/mailboxes?user_id=     that person's connected email IDs and today's room on each
//   POST /leads/assign { job_ids, to_user_id, allocation? }
//        hands those Unassigned leads to that person, from their email IDs: `allocation` = [{mailbox_id,count}] (must add up to
//        the number of leads) or, left out, the same automatic spread Assign Leads / Take leads use.
//
// Rules, each a thing a person could otherwise get wrong:
//   * only a BD, a BD lead, an RA lead or an admin; only people in MY reporting chain (an admin: anyone in the company), never
//     anyone outside it, and never a person who has no connected email ID (a lead nobody can send for is not handed out);
//   * only leads that are still UNOWNED and that I may see (services/ownership.js canSeeLead) — each is claimed with the pool
//     conditions ON the update, so two people acting together never both get the same lead (the loser is told, not overwritten);
//   * a lead that already has an owner is never reassigned here — that is a request (D-0036–38), not a manager's instant move;
//   * owning is not sending: nothing is sent, and a mailbox whose room today is used up is allowed (the emails go on a later day) —
//     the window says so instead of refusing;
//   * every hand-over is written in the lead's own activity log, saying who gave it to whom.
// ============================================================================
const express = require('express');
const dist = require('../services/lead-distribution');
const leadClaim = require('../services/lead-claim');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, today, withOrg, orgIdFor, reportingChainIds, ownership, logActivity } = ctx;
  const ROLES = ['admin', 'ra_lead', 'bd', 'bd_lead'];

  async function chainFor(req) {
    if (hasRole(req, 'admin')) return null;   // the whole company
    return reportingChainIds(req.user.id, orgIdFor(req));
  }

  async function peopleIn(req, chain) {
    let q = supabase.from('users').select('id,name,role,roles').is('deleted_at', null);
    q = chain ? q.in('id', chain) : withOrg(q, req);
    const { data } = await q;
    return (data || []).filter(u => u && u.id);
  }

  async function roomToday(accounts) {
    const { data: logs } = await supabase.from('email_send_log').select('user_email_id,emails_sent').eq('send_date', today());
    const sent = {}; (logs || []).forEach(l => { sent[l.user_email_id] = l.emails_sent; });
    return accounts.map(a => ({ id: a.id, email: a.email_address, name: a.display_name || '', limit: a.daily_send_limit || 150, room: Math.max(0, (a.daily_send_limit || 150) - (sent[a.id] || 0)) }));
  }

  router.get('/leads/assign/people', auth, async (req, res) => {
    try {
      if (!hasRole(req, ...ROLES)) return res.status(403).json({ error: 'Not allowed' });
      const people = await peopleIn(req, await chainFor(req));
      const ids = people.map(p => p.id);
      const { data: boxes } = ids.length ? await withOrg(supabase.from('user_emails').select('user_id').eq('is_active', true).in('user_id', ids), req) : { data: [] };
      const count = {}; (boxes || []).forEach(b => { count[b.user_id] = (count[b.user_id] || 0) + 1; });
      res.json({
        people: people.map(p => ({ id: p.id, name: p.name || '', role: p.role || '', is_me: p.id === req.user.id, mailboxes: count[p.id] || 0 }))
          .sort((a, b) => (b.is_me - a.is_me) || a.name.localeCompare(b.name)),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/leads/assign/mailboxes', auth, async (req, res) => {
    try {
      if (!hasRole(req, ...ROLES)) return res.status(403).json({ error: 'Not allowed' });
      const uid = String(req.query.user_id || '');
      const chain = await chainFor(req);
      if (chain && !chain.includes(uid)) return res.status(404).json({ error: 'Not found' });
      const mb = await dist.connectedMailboxesFor({ supabase, withOrg: (q) => withOrg(q, req), userId: uid, todayStr: today(), who: 'They', ignoreRoom: true });
      if (mb.error) return res.json({ mailboxes: [], error: mb.error });
      res.json({ mailboxes: await roomToday(mb.accounts) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/leads/assign', auth, async (req, res) => {
    try {
      if (!hasRole(req, ...ROLES)) return res.status(403).json({ error: 'Not allowed' });
      const b = req.body || {};
      const wanted = [...new Set((Array.isArray(b.job_ids) ? b.job_ids : []).map(String))].slice(0, 500);
      if (!wanted.length) return res.status(400).json({ error: 'Pick the leads to hand out.' });
      const toId = String(b.to_user_id || '');
      const chain = await chainFor(req);
      if (!toId || (chain && !chain.includes(toId))) return res.status(403).json({ error: 'You can hand leads to yourself or to someone who reports to you — not to anyone else.' });
      const people = await peopleIn(req, chain || [toId]);
      const to = people.find(p => p.id === toId);
      if (!to) return res.status(404).json({ error: 'That person was not found in your company.' });

      // The leads: still unowned, in this company, not deleted, not a flagged duplicate, and ones I may see.
      const { data: rows, error: jErr } = await withOrg(supabase.from('jobs').select('id,created_by,assigned_to,assigned_to_bd,stage,is_duplicate').in('id', wanted).is('deleted_at', null), req);
      if (jErr) throw jErr;
      const scope = ownership.viewScope({ role: req.user.role, roles: req.user.roles, userId: req.user.id, chainIds: chain });
      const eligible = (rows || []).filter(j => leadClaim.isUnowned(j) && !j.is_duplicate && ownership.canSeeLead(j, scope));
      if (!eligible.length) return res.status(400).json({ error: 'None of those leads can be handed out — they already have an owner, or you cannot see them.' });

      const mb = await dist.connectedMailboxesFor({ supabase, withOrg: (q) => withOrg(q, req), userId: toId, todayStr: today(), who: to.name || 'That person', ignoreRoom: true });
      if (mb.error) return res.status(400).json({ error: mb.error + ' (Nothing was assigned.)' });

      let queue;
      if (Array.isArray(b.allocation) && b.allocation.length) {
        const a = dist.allocationQueue(b.allocation, mb.accounts, eligible.length);
        if (a.error) return res.status(400).json({ error: a.error + ' (Nothing was assigned.)' });
        queue = a.queue;
      } else {
        queue = dist.assignmentQueue(mb.accounts, eligible.length);
        while (queue.length < eligible.length) queue.push(mb.accounts[0].id);
      }

      const now = new Date();
      const done = [], lost = [], by = {};
      for (let i = 0; i < eligible.length; i++) {
        const { data: got, error } = await withOrg(supabase.from('jobs').update(leadClaim.ownerFields(toId, queue[i], now))
          .eq('id', eligible[i].id).is('assigned_to_bd', null).select('id'), req);
        if (!error && got && got.length) { done.push(eligible[i].id); by[queue[i]] = (by[queue[i]] || 0) + 1; } else lost.push(eligible[i].id);
      }
      const who = req.user.id === toId ? 'themselves' : (to.name || 'a team member');
      for (const id of done) {
        try { await logActivity(id, null, req.user.id, 'assigned', `Handed out by ${req.user.name || 'a manager'} to ${who}`, null, { assigned_to_bd: toId }); } catch (_) { /* the log is a record, never the point */ }
      }
      const emailOf = {}; mb.accounts.forEach(a => { emailOf[a.id] = a.email_address; });
      res.json({
        assigned: done.length, requested: wanted.length, job_ids: done,
        skipped: wanted.length - eligible.length, lost: lost.length,
        to: { id: toId, name: to.name || '' },
        by_mailbox: Object.keys(by).map(id => ({ mailbox_id: id, email: emailOf[id] || '', count: by[id] })),
        message: (done.length < wanted.length)
          ? `${done.length} of ${wanted.length} were handed out${wanted.length - eligible.length ? ` — ${wanted.length - eligible.length} already had an owner or could not be seen` : ''}${lost.length ? `; ${lost.length} was handed to someone else a moment ago` : ''}.`
          : null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
