// Unit tests for services/plans.js, services/entitlements.js and
// services/billing.js — what an organisation is allowed to do, and who is
// allowed to change that.
//
// The properties that matter:
//
//   1. A LIMIT THAT IS NOT ENFORCED IS A CLAIM, NOT A LIMIT. checkLimit has to
//      refuse at the boundary, not one past it.
//   2. BEING OVER A LIMIT NEVER DESTROYS ANYTHING. A downgrade leaves an org
//      above its new limits; it must keep everything and simply be unable to
//      add. `over` is reported, nothing is removed.
//   3. FAILING TO COUNT MUST ALLOW, NOT REFUSE. Blocking a paying customer
//      because a COUNT query failed is worse than being one row over.
//   4. UNLIMITED IS null EVERYWHERE, and an unknown plan falls back to Free —
//      never to unlimited. A typo in a plan id must not hand out Business.
//   5. THE WEBHOOK SIGNATURE IS THE ONLY PROOF OF PAYMENT. A forged, stale, or
//      unsigned body must not change a plan, because the alternative is anyone
//      upgrading themselves for free.
//
// Usage: node test/plans-billing-smoke.mjs   (no network, no database)

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);

const plans = require('../services/plans.js');
const entitlements = require('../services/entitlements.js');
const billing = require('../services/billing.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── 1. Plan lookup ──────────────────────────────────────────────────────────
{
  ok('a known plan resolves', plans.planFor('pro').id === 'pro');
  ok('plan ids are case-insensitive', plans.planFor('PRO').id === 'pro');
  ok('an unknown plan falls back to Free, NOT unlimited', plans.planFor('enterprise-mega').id === 'free');
  ok('no plan at all falls back to Free', plans.planFor(null).id === 'free' && plans.planFor(undefined).id === 'free');
  ok('the internal plan is not purchasable', plans.purchasablePlans().every(p => p.id !== 'internal'));
  ok('free is listed but every tier is present',
    plans.purchasablePlans().map(p => p.id).join(',') === 'free,starter,pro,business',
    plans.purchasablePlans().map(p => p.id).join(','));
  ok('no price is invented on any tier', plans.purchasablePlans().every(p => p.price === null));
}

// ── 2. Limits ───────────────────────────────────────────────────────────────
{
  const free = { plan: 'free' };
  ok('under the limit is allowed', plans.checkLimit(free, 'seats', 1).allowed === true);
  // Free has 2 seats: with 1 used, adding 1 makes 2 — fine. With 2 used it is full.
  ok('exactly at the limit is refused, not allowed', plans.checkLimit(free, 'seats', 2).allowed === false);
  ok('...with a message naming the plan and the number',
    /Free/.test(plans.checkLimit(free, 'seats', 2).message) && /2 team members/.test(plans.checkLimit(free, 'seats', 2).message),
    plans.checkLimit(free, 'seats', 2).message);
  ok('the refusal reports the limit and usage',
    plans.checkLimit(free, 'seats', 5).limit === 2 && plans.checkLimit(free, 'seats', 5).used === 5);
  ok('adding several at once is checked as a batch', plans.checkLimit(free, 'seats', 1, 5).allowed === false);

  const business = { plan: 'business' };
  ok('unlimited allows anything', plans.checkLimit(business, 'candidates', 999999).allowed === true);
  ok('...and reports the limit as null (not 0, not Infinity)',
    plans.checkLimit(business, 'candidates', 5).limit === null);

  const internal = { plan: 'internal' };
  ok('the default org (internal) is unlimited — nothing changes for it',
    plans.LIMIT_KINDS.every(k => plans.checkLimit(internal, k, 100000).allowed));
}

// ── 3. Per-org seat override ────────────────────────────────────────────────
{
  const custom = { plan: 'free', seats_limit: 25 };
  ok('seats_limit overrides the plan', plans.limitsFor(custom).seats === 25);
  ok('...and is what gets enforced', plans.checkLimit(custom, 'seats', 20).allowed === true);
  ok('a null override falls back to the plan', plans.limitsFor({ plan: 'free', seats_limit: null }).seats === 2);
  ok('a non-numeric override is ignored, not treated as unlimited',
    plans.limitsFor({ plan: 'free', seats_limit: 'lots' }).seats === 2);
  ok('an override of 0 is honoured (a suspended-ish state), not treated as falsy',
    plans.limitsFor({ plan: 'free', seats_limit: 0 }).seats === 0);
  ok('the override does NOT leak into other limits', plans.limitsFor(custom).job_orders === 3);
}

// ── 4. Features ─────────────────────────────────────────────────────────────
{
  ok('free does not get sourcing', plans.featureEnabled({ plan: 'free' }, 'sourcing') === false);
  ok('free does not get conversation intelligence', plans.featureEnabled({ plan: 'free' }, 'conversation_intel') === false);
  ok('free DOES get reports', plans.featureEnabled({ plan: 'free' }, 'reports') === true);
  ok('pro gets sourcing', plans.featureEnabled({ plan: 'pro' }, 'sourcing') === true);
  ok('an unknown feature is OFF, not on', plans.featureEnabled({ plan: 'business' }, 'time_travel') === false);
  ok('an unknown plan gets Free’s features', plans.featureEnabled({ plan: 'nonsense' }, 'sourcing') === false);
}

// ── 5. The summary a billing screen renders ─────────────────────────────────
{
  const s = plans.summarize({ plan: 'free', status: 'active' }, { seats: 3, job_orders: 1, candidates: 0, mailboxes: 0, emails_per_month: 0 });
  ok('summary names the plan', s.plan.name === 'Free');
  ok('being OVER a limit is reported', s.usage.seats.over === true, JSON.stringify(s.usage.seats));
  ok('...remaining never goes negative', s.usage.seats.remaining === 0);
  ok('a limit with room reports what is left', s.usage.job_orders.remaining === 2);
  ok('unlimited reports null rather than a number',
    plans.summarize({ plan: 'business' }, {}).usage.candidates.limit === null);
  ok('every limit kind appears in the summary',
    plans.LIMIT_KINDS.every(k => s.usage[k] !== undefined));
  ok('features are labelled for humans', s.features.sourcing.label.length > 3);
}

// ── 6. The gate routes call ─────────────────────────────────────────────────
{
  // A Supabase double: an org on Free with 2 users already.
  function fake({ org, counts = {}, explode = false }) {
    return {
      from(table) {
        if (explode) throw new Error('boom');
        const chain = {
          select: () => chain, eq: () => chain, is: () => chain, gte: () => chain,
          maybeSingle: async () => ({ data: table === 'organizations' ? org : null, error: null }),
          then: (res) => Promise.resolve({
            data: table === 'email_send_log' ? [] : [],
            count: counts[table] === undefined ? 0 : counts[table],
            error: null,
          }).then(res),
        };
        return chain;
      },
    };
  }
  const req = { orgId: 'org-1' };

  const full = await entitlements.gate(fake({ org: { id: 'org-1', plan: 'free' }, counts: { users: 2 } }), req, 'seats');
  ok('the gate blocks at the limit', full.blocked === true, JSON.stringify(full));
  ok('...with 402 Payment Required, not 403', full.status === 402);
  ok('...and a machine-readable reason', full.body.error === 'plan_limit' && full.body.limit_kind === 'seats');

  const room = await entitlements.gate(fake({ org: { id: 'org-1', plan: 'free' }, counts: { users: 0 } }), req, 'seats');
  ok('the gate allows when there is room', room.blocked === false);

  const noOrg = await entitlements.gate(fake({ org: null }), req, 'seats');
  ok('no organisation row → allowed (we cannot judge)', noOrg.blocked === false);

  const broken = await entitlements.gate(fake({ org: { id: 'org-1', plan: 'free' }, explode: true }), req, 'seats');
  ok('a database failure ALLOWS rather than refusing', broken.blocked === false);

  const noCtx = await entitlements.gate(fake({ org: { id: 'org-1', plan: 'free' } }), {}, 'seats');
  ok('no org context → allowed', noCtx.blocked === false);

  const feat = await entitlements.featureGate(fake({ org: { id: 'org-1', plan: 'free' } }), req, 'sourcing');
  ok('the feature gate blocks a feature the plan lacks', feat.blocked === true && feat.body.error === 'plan_feature');
  const featOk = await entitlements.featureGate(fake({ org: { id: 'org-1', plan: 'pro' } }), req, 'sourcing');
  ok('...and allows one it has', featOk.blocked === false);
}

// ── 7. Billing is off until it is configured ────────────────────────────────
{
  ok('billing is off with no key', billing.isConfigured({}) === false);
  ok('billing is on with a key', billing.isConfigured({ STRIPE_SECRET_KEY: 'sk_test_x' }) === true);
  ok('nothing is purchasable while unconfigured', billing.purchasable({}).length === 0);
  ok('a plan with no price id is not purchasable',
    billing.purchasable({ STRIPE_SECRET_KEY: 'sk_test_x' }).length === 0);
  ok('a priced plan IS purchasable',
    billing.purchasable({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_PRO: 'price_1' }).map(p => p.id).join(',') === 'pro');
  ok('free is never purchasable even if priced',
    billing.purchasable({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_FREE: 'price_0' }).every(p => p.id !== 'free'));

  const out = await billing.createCheckout({ org: { id: 'o1' }, planId: 'pro', env: {} });
  ok('checkout refuses cleanly when unconfigured — no network call',
    out.ok === false && out.reason === 'not_configured', JSON.stringify(out));
}

// ── 8. Webhook signature — the only proof of payment ────────────────────────
{
  const SECRET = 'whsec_test';
  const body = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { customer: 'cus_1', subscription: 'sub_1', metadata: { org_id: 'org-9', plan: 'pro' } } },
  });
  const t = 1800000000;                         // fixed clock — a signature check that only passes "now" is untestable
  const now = t * 1000;
  const sign = (payload, secret = SECRET, ts = t) =>
    `t=${ts},v1=` + crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');

  const good = billing.verifyWebhook(body, sign(body), { secret: SECRET, now });
  ok('a correctly signed webhook verifies', good.ok === true, JSON.stringify(good).slice(0, 120));
  ok('...and parses into an event', good.event.type === 'checkout.session.completed');

  ok('a body signed with the WRONG secret is refused',
    billing.verifyWebhook(body, sign(body, 'whsec_attacker'), { secret: SECRET, now }).reason === 'bad_signature');
  ok('a TAMPERED body is refused', (() => {
    const evil = body.replace('"pro"', '"business"');
    return billing.verifyWebhook(evil, sign(body), { secret: SECRET, now }).reason === 'bad_signature';
  })());
  ok('a STALE signature is refused (replay)',
    billing.verifyWebhook(body, sign(body, SECRET, t - 3600), { secret: SECRET, now }).reason === 'stale');
  ok('a signature from the FUTURE is refused too',
    billing.verifyWebhook(body, sign(body, SECRET, t + 3600), { secret: SECRET, now }).reason === 'stale');
  ok('a missing signature header is refused',
    billing.verifyWebhook(body, '', { secret: SECRET, now }).reason === 'missing');
  ok('a malformed header is refused',
    billing.verifyWebhook(body, 'not-a-signature', { secret: SECRET, now }).reason === 'malformed');
  ok('with no webhook secret configured, nothing verifies',
    billing.verifyWebhook(body, sign(body), { secret: '', now }).reason === 'not_configured');
  ok('a signature of the wrong LENGTH does not throw', (() => {
    try { return billing.verifyWebhook(body, `t=${t},v1=abc`, { secret: SECRET, now }).reason === 'bad_signature'; }
    catch (_) { return false; }
  })());
  ok('rotation: several v1 signatures, one correct, verifies', (() => {
    const wrong = crypto.createHmac('sha256', 'other').update(`${t}.${body}`).digest('hex');
    const right = crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
    return billing.verifyWebhook(body, `t=${t},v1=${wrong},v1=${right}`, { secret: SECRET, now }).ok === true;
  })());
}

// ── 9. What a verified event actually changes ───────────────────────────────
{
  const upgrade = billing.planChangeFor({
    type: 'checkout.session.completed',
    data: { object: { customer: 'cus_1', subscription: 'sub_1', metadata: { org_id: 'org-9', plan: 'pro' } } },
  });
  ok('a completed checkout upgrades the named org', upgrade.orgId === 'org-9' && upgrade.patch.plan === 'pro');
  ok('...and records the Stripe ids', upgrade.patch.billing_customer_id === 'cus_1' && upgrade.patch.billing_subscription_id === 'sub_1');

  ok('an event with NO org_id changes nothing', billing.planChangeFor({
    type: 'checkout.session.completed', data: { object: { metadata: {} } } }) === null);
  ok('an event naming an unknown plan changes nothing', billing.planChangeFor({
    type: 'checkout.session.completed', data: { object: { metadata: { org_id: 'o', plan: 'wat' } } } }) === null);
  ok('nobody can buy their way onto the INTERNAL plan', billing.planChangeFor({
    type: 'checkout.session.completed', data: { object: { metadata: { org_id: 'o', plan: 'internal' } } } }) === null);
  ok('an unknown event type is ignored rather than guessed at', billing.planChangeFor({
    type: 'invoice.upcoming', data: { object: { metadata: { org_id: 'o' } } } }) === null);

  const cancel = billing.planChangeFor({
    type: 'customer.subscription.deleted', data: { object: { metadata: { org_id: 'org-9' } } } });
  ok('a cancelled subscription drops to Free', cancel.patch.plan === 'free');
  ok('...and does NOT suspend the workspace or touch its data',
    cancel.patch.status === undefined, JSON.stringify(cancel.patch));
}

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '  ok  ' : '  FAIL'} ${r.name}${r.ok || !r.detail ? '' : `  → ${r.detail}`}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
