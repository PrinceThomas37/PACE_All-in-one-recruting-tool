// ============================================================================
// PLAN & BILLING ROUTES
//
//   GET  /org/plan                 what this org is on, what it is using
//   GET  /plans                    the tiers, for a pricing/upgrade screen
//   POST /org/billing/checkout     start a Stripe Checkout session
//   POST /webhooks/stripe          the ONLY thing that may change a plan
//
// The webhook is deliberately the only writer. A checkout session says what
// somebody INTENDED to buy; the webhook is Stripe telling us what happened, and
// it is signed. If the browser's success redirect could set the plan, anyone
// who can read their own URL bar could upgrade themselves for free.
// ============================================================================
const express = require('express');
const plans = require('../services/plans');
const entitlements = require('../services/entitlements');
const billing = require('../services/billing');

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, auth, hasRole, orgIdFor } = ctx;

  // What this organisation is on, and how much of it is used. Any signed-in
  // user may read it — a recruiter who hits a limit needs to understand why,
  // and none of it is sensitive.
  router.get('/org/plan', auth, async (req, res) => {
    try {
      const summary = await entitlements.summaryFor(supabase, orgIdFor(req));
      res.json({
        ...summary,
        billing_enabled: billing.isConfigured(),
        can_manage: hasRole(req, 'admin'),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // The tiers themselves. `purchasable` is what can actually be bought right
  // now — a plan with no configured Stripe price is shown but not buyable,
  // which is the honest state while pricing is undecided.
  router.get('/plans', auth, async (_req, res) => {
    const buyable = new Set(billing.purchasable().map(p => p.id));
    res.json({
      plans: plans.purchasablePlans().map(p => ({ ...p, purchasable: buyable.has(p.id) })),
      billing_enabled: billing.isConfigured(),
      pricing_set: plans.purchasablePlans().some(p => p.price !== null),
    });
  });

  router.post('/org/billing/checkout', auth, async (req, res) => {
    try {
      if (!hasRole(req, 'admin')) return res.status(403).json({ error: 'Admin only' });
      const planId = String(req.body?.plan || '').toLowerCase();
      const target = plans.PLANS[planId];
      if (!target || target.internal || planId === 'free') {
        return res.status(400).json({ error: 'bad_plan', message: 'Choose a paid plan.' });
      }

      const org = await entitlements.loadOrg(supabase, orgIdFor(req));
      if (!org) return res.status(400).json({ error: 'No organisation context.' });

      const base = `${req.protocol}://${req.get('host')}`;
      const out = await billing.createCheckout({
        org, planId, email: req.user?.email,
        successUrl: `${base}/?billing=success`,
        cancelUrl: `${base}/?billing=cancelled`,
      });
      if (!out.ok) {
        return res.status(out.reason === 'not_configured' || out.reason === 'no_price' ? 503 : 502)
          .json({ error: out.reason, message: out.message });
      }
      res.json({ url: out.url });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Unauthenticated by design — Stripe cannot hold a session. The signature IS
  // the authentication, so an unverified body is refused before it is read as
  // anything but bytes.
  router.post('/webhooks/stripe', async (req, res) => {
    try {
      const verified = billing.verifyWebhook(req.rawBody, req.headers['stripe-signature']);
      if (!verified.ok) {
        // 400, not 500: a bad signature is the caller's problem, and Stripe
        // should not retry it forever.
        if (verified.reason !== 'not_configured') {
          console.warn('[billing] rejected webhook:', verified.reason);
        }
        return res.status(400).json({ error: verified.reason });
      }

      const change = billing.planChangeFor(verified.event);
      // Acknowledge events we do not act on. Anything other than a 2xx makes
      // Stripe retry, and retrying an event we deliberately ignore is noise
      // forever.
      if (!change) return res.json({ received: true, applied: false });

      const { error } = await supabase.from('organizations')
        .update({ ...change.patch, updated_at: new Date() }).eq('id', change.orgId);
      if (error) {
        // Do NOT 200 here: the plan genuinely did not change, and Stripe's
        // retry is the only thing that will fix it.
        console.error('[billing] could not apply plan change:', error.message);
        return res.status(500).json({ error: 'apply_failed' });
      }
      console.log(`[billing] ${verified.event.type} → org ${change.orgId} now ${change.patch.plan}`);
      res.json({ received: true, applied: true });
    } catch (err) {
      console.error('[billing] webhook threw:', err.message);
      res.status(500).json({ error: 'webhook_failed' });
    }
  });

  return router;
};
