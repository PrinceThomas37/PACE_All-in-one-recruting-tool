// ============================================================================
// ORGANISATION DOMAINS — claim, verify, manage.
//
// Admin-only, and org-scoped by construction (models/). The rules that matter
// live in services/org-domains.js; this module is I/O plus authorisation.
//
// Everything here degrades while migration 038 is unapplied: a missing
// org_domains table returns an empty list and a clear "not enabled yet" on
// writes, rather than a 500. The app must run correctly before and after.
// ============================================================================
const express = require('express');
const orgDomains = require('../services/org-domains');

const MISSING_TABLE = /relation .*org_domains.* does not exist|could not find the table/i;

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, orgIdFor } = ctx;

  const notEnabled = (res) => res.status(503).json({
    error: 'domains_not_enabled',
    message: 'Domain claiming is not enabled on this deployment yet (migration 038 has not been applied).',
  });

  router.get('/org/domains', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const org = orgIdFor(req);
      const { data, error } = await supabase.from('org_domains')
        .select('id,domain,verified_at,last_checked_at,last_error,auto_join,auto_join_role,created_at')
        .eq('org_id', org).order('created_at');
      if (error) {
        if (MISSING_TABLE.test(error.message || '')) return res.json({ domains: [], enabled: false });
        throw error;
      }
      res.json({ domains: data || [], enabled: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Claim a domain. Deliberately grants NOTHING on its own — the row is created
  // unverified, and only DNS proof flips it.
  router.post('/org/domains', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const org = orgIdFor(req);
      if (!org) return res.status(400).json({ error: 'No organisation context.' });

      const v = orgDomains.validateDomain(req.body?.domain);
      if (!v.ok) return res.status(400).json({ error: v.reason, message: v.message });

      // Refuse early if someone else already holds a VERIFIED claim. The
      // database enforces this too (partial unique index) — this exists to give
      // a readable answer instead of a constraint violation.
      const { data: taken } = await supabase.from('org_domains')
        .select('org_id').eq('domain', v.domain).not('verified_at', 'is', null).maybeSingle();
      if (taken && taken.org_id !== org) {
        return res.status(409).json({
          error: 'already_claimed',
          message: `${v.domain} has already been verified by another organisation. If that is wrong, contact support.`,
        });
      }

      const token = orgDomains.verificationToken(org, v.domain);
      const { data, error } = await supabase.from('org_domains').insert({
        org_id: org, domain: v.domain, verification_token: token, created_by: req.user.id,
      }).select('id,domain,verified_at,auto_join,auto_join_role').single();

      if (error) {
        if (MISSING_TABLE.test(error.message || '')) return notEnabled(res);
        // Already claimed by THIS org — return the existing row's instructions
        // rather than an error; re-claiming is a normal thing to do.
        if (error.code === '23505') {
          return res.json({ ok: true, already: true, instructions: orgDomains.verificationInstructions(org, v.domain) });
        }
        throw error;
      }

      res.status(201).json({ ok: true, domain: data, instructions: orgDomains.verificationInstructions(org, v.domain) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Check DNS now. Idempotent and safe to hammer — it only reads DNS.
  router.post('/org/domains/:id/verify', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const org = orgIdFor(req);
      const { data: row, error: readErr } = await supabase.from('org_domains')
        .select('id,domain,verified_at').eq('id', req.params.id).eq('org_id', org).maybeSingle();
      if (readErr && MISSING_TABLE.test(readErr.message || '')) return notEnabled(res);
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (row.verified_at) return res.json({ verified: true, domain: row.domain, already: true });

      const result = await orgDomains.checkVerification(org, row.domain);

      // Re-check the race: someone else may have verified this domain between
      // the claim and now. The DB index would reject the update anyway; this
      // turns that into a readable message.
      if (result.verified) {
        const { data: taken } = await supabase.from('org_domains')
          .select('org_id').eq('domain', row.domain).not('verified_at', 'is', null).maybeSingle();
        if (taken && taken.org_id !== org) {
          return res.status(409).json({ verified: false, error: 'already_claimed',
            message: `${row.domain} was verified by another organisation first.` });
        }
      }

      await supabase.from('org_domains').update({
        verified_at: result.verified ? new Date() : null,
        last_checked_at: new Date(),
        last_error: result.verified ? null : (result.message || null),
      }).eq('id', row.id);

      res.json(result.verified
        ? { verified: true, domain: row.domain }
        : { verified: false, reason: result.reason, message: result.message,
            instructions: orgDomains.verificationInstructions(org, row.domain) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // What to paste at the DNS provider — re-readable at any time.
  router.get('/org/domains/:id/instructions', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const org = orgIdFor(req);
      const { data: row } = await supabase.from('org_domains')
        .select('domain').eq('id', req.params.id).eq('org_id', org).maybeSingle();
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(orgDomains.verificationInstructions(org, row.domain));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Auto-join is off by default and is a real decision: turning it on means
  // anyone with an address on this domain who signs in lands in this workspace
  // without an invitation. Fine for a company's own staff, wrong for a domain
  // shared with contractors.
  router.patch('/org/domains/:id', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const org = orgIdFor(req);
      const patch = {};
      if (req.body.auto_join !== undefined) patch.auto_join = !!req.body.auto_join;
      if (req.body.auto_join_role) patch.auto_join_role = String(req.body.auto_join_role);
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

      const { data: row } = await supabase.from('org_domains')
        .select('id,verified_at').eq('id', req.params.id).eq('org_id', org).maybeSingle();
      if (!row) return res.status(404).json({ error: 'Not found' });
      // Auto-join on an UNVERIFIED domain would be the takeover this whole
      // design exists to prevent.
      if (patch.auto_join && !row.verified_at) {
        return res.status(400).json({ error: 'not_verified', message: 'Verify the domain before turning on automatic joining.' });
      }

      const { data, error } = await supabase.from('org_domains').update(patch)
        .eq('id', req.params.id).eq('org_id', org)
        .select('id,domain,verified_at,auto_join,auto_join_role').single();
      if (error) throw error;
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/org/domains/:id', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const org = orgIdFor(req);
      const { error } = await supabase.from('org_domains')
        .delete().eq('id', req.params.id).eq('org_id', org);
      if (error && MISSING_TABLE.test(error.message || '')) return notEnabled(res);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
