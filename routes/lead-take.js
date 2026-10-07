// ============================================================================
// A BD TAKES LEADS FOR THEMSELVES (R-148, option A, D-0082)
// ----------------------------------------------------------------------------
// The owner: "A, because today I thought of importing a list of leads directly into BD user
// profile. But did not find a way to send the outreach."  Assigning used to be admin / RA lead
// only (Assign Leads, POST /distribute/execute). This is the same thing from the BD's own side:
//
//   GET  /leads/take/status   what may I take today? (never how big the pool is — D-0034: a BD does
//                             not see the pool, only what they are handed)
//   POST /leads/take {count}  hand me `count` pool leads, spread over MY connected mailboxes by the
//                             same rule the admin path uses (services/lead-distribution.js)
//
// Rules, each of which is a thing a person could otherwise get wrong:
//   * only a BD / BD lead (an admin or RA lead has Assign Leads);
//   * a per-day cap an admin sets (`self_assign_daily_cap`, default 25, 0 = switched off) — counted in
//     the person's own tally for TODAY, so it cannot be dodged by pressing twice;
//   * only into MY mailboxes that are connected and have room today — never somebody else's;
//   * each lead is claimed with the pool conditions ON the update (still Unassigned, still unowned), so
//     two people pressing together can never both get the same lead;
//   * it does NOT send anything. Taking is "these are mine"; the next step is the explicit "Write the
//     first emails" (POST /emails/generate), which puts them in Pending for the person to look at.
// ============================================================================
const express = require('express');
const { getSetting } = require('../config/settings');
const dist = require('../services/lead-distribution');

const tallyKey = (userId, day) => `self_take_${userId}_${day}`;

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, today, withOrg, logActivity } = ctx;

  async function readTally(userId, day) {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', tallyKey(userId, day)).maybeSingle();
      return Number(data && data.value) || 0;
    } catch (_) { return 0; }
  }

  async function state(req) {
    const day = today();
    const cap = Number(await getSetting(supabase, 'self_assign_daily_cap')) || 0;
    const taken = await readTally(req.user.id, day);
    const remainingCap = dist.dayRemaining(cap, taken);
    const mb = await dist.connectedMailboxesFor({ supabase, withOrg: (q) => withOrg(q, req), userId: req.user.id, todayStr: day, who: 'You' });
    const capacity = mb.accounts ? mb.accounts.reduce((s, a) => s + a.remaining, 0) : 0;
    return { day, cap, taken, remainingCap, mb, capacity };
  }

  router.get('/leads/take/status', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'bd', 'bd_lead')) return res.status(403).json({ error: 'This is for BD managers — admins and RA leads use Assign Leads.' });
      const st = await state(req);
      const can = Math.min(st.remainingCap, st.capacity);
      let reason = null;
      if (st.cap <= 0) reason = 'off';
      else if (st.mb.error) reason = 'no_mailbox';
      else if (st.remainingCap <= 0) reason = 'cap_reached';
      res.json({
        enabled: st.cap > 0, cap: st.cap, taken_today: st.taken, remaining_today: st.remainingCap,
        can_take: can, reason, message: st.mb.error || null,
        mailboxes: (st.mb.accounts || []).map(a => ({ id: a.id, email: a.email_address, remaining: a.remaining })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/leads/take', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'bd', 'bd_lead')) return res.status(403).json({ error: 'This is for BD managers — admins and RA leads use Assign Leads.' });
      const want = Math.floor(Number(req.body && req.body.count));
      if (!(want >= 1)) return res.status(400).json({ error: 'Say how many leads you want to take (1 or more).' });
      const st = await state(req);
      if (st.cap <= 0) return res.status(403).json({ error: 'Taking leads yourself is switched off. Ask an admin (Admin → System Settings → Leads).' });
      if (st.mb.error) return res.status(400).json({ error: st.mb.error });
      if (st.remainingCap <= 0) return res.status(400).json({ error: `You have taken your ${st.cap} for today — more tomorrow.` });
      const n = Math.min(want, st.remainingCap, st.capacity);
      if (n <= 0) return res.status(400).json({ error: 'None of your mailboxes has room to send today.' });

      // The pool, the same pool Assign Leads draws from: unowned, Unassigned, not a flagged duplicate.
      const { data: pool, error: pErr } = await withOrg(supabase.from('jobs')
        .select('id,position,freshness,industry,timezone')
        .is('deleted_at', null).eq('stage', 'Unassigned').is('assigned_to_bd', null).eq('is_duplicate', false).limit(1000), req);
      if (pErr) throw pErr;
      if (!pool || !pool.length) return res.json({ taken: 0, requested: want, empty: true, remaining_today: st.remainingCap, job_ids: [], message: 'There are no unassigned leads in the pool right now.' });

      const chosen = dist.orderPool(pool).slice(0, n);
      const queue = dist.assignmentQueue(st.mb.accounts, chosen.length);
      const now = new Date();
      const taken = [];
      for (let i = 0; i < chosen.length; i++) {
        // The pool conditions go ON the update: somebody else may have been handed this lead a moment ago.
        const { data: got, error } = await withOrg(supabase.from('jobs')
          .update({ assigned_to_bd: req.user.id, assigned_to: req.user.id, sending_email_id: queue[i], stage: 'Assigned', assigned_at: now, updated_at: now })
          .eq('id', chosen[i].id).eq('stage', 'Unassigned').is('assigned_to_bd', null).select('id'), req);
        if (!error && got && got.length) taken.push(chosen[i].id);
      }
      if (taken.length) {
        await supabase.from('app_settings').upsert({ key: tallyKey(req.user.id, st.day), value: String(st.taken + taken.length) }, { onConflict: 'key' });
        for (const id of taken) {
          try { await logActivity(id, null, req.user.id, 'self_assigned', `Taken from the pool by ${req.user.name || 'a BD'}`, null, { self_assigned: true }); } catch (_) { /* the log is a record, never the point */ }
        }
      }
      res.json({
        taken: taken.length, requested: want, job_ids: taken,
        remaining_today: dist.dayRemaining(st.cap, st.taken + taken.length),
        message: taken.length < want ? (taken.length ? `Took ${taken.length} of the ${want} you asked for (${n < want ? 'your daily limit or mailbox room' : 'someone else got the rest first'}).` : 'Someone else was handed those leads a moment ago — try again.') : null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
