// ============================================================================
// BILLING — the Stripe seam.
//
// WHAT THIS IS: the shape Stripe plugs into, built so that turning payments on
// later is setting two environment variables and a price id per plan — not a
// rewrite of how plans work. Plans, limits and enforcement (services/plans.js,
// services/entitlements.js) are already real and already enforced; this file
// only decides who is allowed to CHANGE a plan and how that change is proved.
//
// WHAT THIS IS NOT: a Stripe integration that runs today. With no
// STRIPE_SECRET_KEY set — which is how it ships — every endpoint answers
// "billing is not configured" and nothing pretends otherwise. That matches the
// project's ₹0 rule: a paid dependency is a later switch, never a requirement.
//
// NO `stripe` NPM PACKAGE, DELIBERATELY. Two reasons. The codebase's rule is
// that all outbound HTTP goes through http-client.js (timeouts, safe-method
// retries); an SDK with its own socket handling would be the one exception. And
// a dependency that does nothing until someone signs up for Stripe is weight in
// every install for a feature nobody is using yet. Stripe's REST API over
// fetchWithTimeout is a dozen lines.
//
// THE WEBHOOK IS THE ONLY THING THAT MAY CHANGE A PLAN.
// A checkout session tells you what somebody INTENDED to buy. The webhook is
// what Stripe says actually happened, and it is signed. If the browser's
// "success" redirect were allowed to set the plan, then anyone who can read
// their own URL bar could upgrade themselves to Business for free. So the
// redirect only says "thanks, this may take a moment" and the plan changes when
// `checkout.session.completed` arrives, verified.
// ============================================================================

const crypto = require('crypto');
const { fetchWithTimeout } = require('../http-client');
const plans = require('./plans');

const STRIPE_API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 15000;
// Stripe rejects a signature older than this; so do we. It is what stops a
// captured webhook body being replayed later.
const SIGNATURE_TOLERANCE_S = 300;

const secretKey = (env = process.env) => env.STRIPE_SECRET_KEY || '';
const webhookSecret = (env = process.env) => env.STRIPE_WEBHOOK_SECRET || '';

/** Is billing switched on for this deployment? */
function isConfigured(env = process.env) {
  return Boolean(secretKey(env));
}

/**
 * The Stripe price id for a plan, e.g. STRIPE_PRICE_PRO=price_123.
 * A plan with no configured price cannot be bought — which is also the honest
 * answer while prices have not been decided.
 */
function priceIdFor(planId, env = process.env) {
  return env[`STRIPE_PRICE_${String(planId || '').toUpperCase()}`] || '';
}

/** Which plans can actually be purchased right now (configured + priced). */
function purchasable(env = process.env) {
  if (!isConfigured(env)) return [];
  return plans.purchasablePlans().filter(p => p.id !== 'free' && priceIdFor(p.id, env));
}

/**
 * Verify a Stripe webhook signature. PURE apart from the clock, which is
 * injectable so a test can pin it — a signature check that only passes "now"
 * is untestable, and an untested signature check is decoration.
 *
 * Returns { ok:true, event } or { ok:false, reason }.
 */
function verifyWebhook(rawBody, signatureHeader, { secret, now = Date.now() } = {}) {
  const key = secret || webhookSecret();
  if (!key) return { ok: false, reason: 'not_configured' };
  if (!rawBody || !signatureHeader) return { ok: false, reason: 'missing' };

  // Stripe-Signature: t=1699999999,v1=abc...,v1=def...
  const parts = String(signatureHeader).split(',').map(s => s.trim());
  const t = (parts.find(p => p.startsWith('t=')) || '').slice(2);
  const signatures = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !signatures.length) return { ok: false, reason: 'malformed' };

  const ageSeconds = Math.abs(Math.floor(now / 1000) - Number(t));
  if (!Number.isFinite(ageSeconds) || ageSeconds > SIGNATURE_TOLERANCE_S) {
    return { ok: false, reason: 'stale' };
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', key).update(`${t}.${payload}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, so compare lengths first —
  // and compare against EVERY v1 (Stripe sends more than one while a secret is
  // being rotated).
  const matched = signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
  if (!matched) return { ok: false, reason: 'bad_signature' };

  try {
    return { ok: true, event: JSON.parse(payload) };
  } catch (_) {
    return { ok: false, reason: 'bad_json' };
  }
}

/**
 * What a verified event means for an organisation. PURE.
 *
 * Returns { orgId, patch } — the columns to write — or null when the event is
 * one we do not act on. Unknown event types are ignored rather than guessed at:
 * Stripe sends dozens, and acting on one we do not understand is how a paying
 * customer gets downgraded by a webhook nobody read.
 */
function planChangeFor(event) {
  const type = event && event.type;
  const obj = (event && event.data && event.data.object) || {};
  const orgId = (obj.metadata && (obj.metadata.org_id || obj.metadata.orgId)) || null;
  if (!orgId) return null;

  switch (type) {
    case 'checkout.session.completed': {
      const planId = (obj.metadata && obj.metadata.plan) || null;
      if (!planId || !plans.PLANS[planId] || plans.PLANS[planId].internal) return null;
      return {
        orgId,
        patch: {
          plan: planId,
          status: 'active',
          billing_customer_id: obj.customer || null,
          billing_subscription_id: obj.subscription || null,
        },
      };
    }
    // They cancelled, or payment failed past Stripe's retries. Drop to Free —
    // NOT to suspended, and nothing is deleted. They keep their data and simply
    // cannot add beyond the Free limits (see the note in services/plans.js).
    case 'customer.subscription.deleted':
      return { orgId, patch: { plan: 'free', billing_subscription_id: null } };

    default:
      return null;
  }
}

/**
 * Start a Stripe Checkout session. Network call; returns { ok, url } or
 * { ok:false, reason, message }.
 *
 * org_id and plan travel in `metadata` because that is what comes back on the
 * webhook — it is the only link between "somebody paid" and "which workspace".
 */
async function createCheckout({ org, planId, successUrl, cancelUrl, email, env = process.env }) {
  if (!isConfigured(env)) {
    return { ok: false, reason: 'not_configured', message: 'Payments are not switched on for this deployment yet.' };
  }
  const price = priceIdFor(planId, env);
  if (!price) {
    return { ok: false, reason: 'no_price', message: `No price is configured for the ${planId} plan yet.` };
  }

  const form = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[org_id]': String(org.id),
    'metadata[plan]': String(planId),
    // Repeated on the subscription so later lifecycle events carry it too —
    // customer.subscription.deleted does not inherit the session's metadata.
    'subscription_data[metadata][org_id]': String(org.id),
    'subscription_data[metadata][plan]': String(planId),
  });
  if (email) form.set('customer_email', email);

  try {
    const res = await fetchWithTimeout(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey(env)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    }, { timeoutMs: TIMEOUT_MS });
    const body = await res.json();
    if (body && body.error) {
      console.error('[billing] checkout failed:', body.error.message);
      return { ok: false, reason: 'stripe_error', message: 'Could not start checkout. Please try again.' };
    }
    return { ok: true, url: body.url, id: body.id };
  } catch (err) {
    console.error('[billing] checkout threw:', err.message);
    return { ok: false, reason: 'unreachable', message: 'Could not reach the payment provider. Please try again.' };
  }
}

module.exports = {
  isConfigured, priceIdFor, purchasable, verifyWebhook, planChangeFor, createCheckout,
  SIGNATURE_TOLERANCE_S,
};
