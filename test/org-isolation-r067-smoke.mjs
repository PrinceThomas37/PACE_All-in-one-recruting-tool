// R-067 / R-049 / R-243 — one company can never use, see, change or stop another company's things.
//
// Proven against an in-memory TWO-organisation database. Every check calls the real rule (config/integrations.js,
// services/ai-provider.js, services/operator.js, services/sending-pause.js, services/bounce-mark.js, the real cron router);
// none greps source text.
//
//   F = the founding company (inherits the keys that existed before keys had owners, and the env-var keys)
//   S = a second company that signed up later
//
// Usage: node test/org-isolation-r067-smoke.mjs

import { createRequire } from 'node:module';
import { createFakeDb } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);

const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };

const F = '11111111-1111-1111-1111-111111111111';
const S = '22222222-2222-2222-2222-222222222222';
const T = '33333333-3333-3333-3333-333333333333';

process.env.ANTHROPIC_API_KEY = 'sk-ant-FOUNDERS-ENV-KEY';
delete process.env.DEFAULT_ORG_ID;
delete process.env.OPERATOR_EMAILS;

const integrations = require('../config/integrations');
const aiProvider = require('../services/ai-provider');

function world(extraApp = []) {
  const db = createFakeDb({
    tables: {
      organizations: [{ id: F, created_at: '2025-01-01T00:00:00Z' }, { id: S, created_at: '2026-06-01T00:00:00Z' }],
      app_settings: [
        { key: 'int_apollo_api_key', value: 'APOLLO-FOUNDERS-LEGACY-KEY' },        // stored before keys had owners
        { key: 'int_groq_api_key', value: 'gsk_FOUNDERS_LEGACY' },
        { key: 'int_ai_active', value: 'groq' },
        ...extraApp,
      ],
    },
  });
  integrations._resetForTests({ id: null, multi: null });
  return db.supabase;
}

// ── 1. Reading ──────────────────────────────────────────────────────────────
{
  const sb = world();
  ok('the founding company still reads the key it had (nothing it relies on breaks)', await integrations.getSecret(sb, 'apollo', 'api_key', F) === 'APOLLO-FOUNDERS-LEGACY-KEY');
  ok('…and its env-var key', await integrations.getSecret(sb, 'anthropic', 'api_key', F) === 'sk-ant-FOUNDERS-ENV-KEY');
  ok('a second company gets NOTHING for Apollo, not the founder\'s key', await integrations.getSecret(sb, 'apollo', 'api_key', S) === null);
  ok('…nor the founder\'s env-var AI key', await integrations.getSecret(sb, 'anthropic', 'api_key', S) === null);
  ok('…and is not told Apollo is connected', await integrations.isConfigured(sb, 'apollo', S) === false);
  ok('…while the founder is', await integrations.isConfigured(sb, 'apollo', F) === true);
  ok('a caller that names no company is refused the keys once there are two companies', await integrations.getSecret(sb, 'apollo', 'api_key', null) === null);
  const all = JSON.stringify(await integrations.getAll(sb, S));
  ok('the second company\'s settings page shows no trace of the founder\'s keys', !/FOUNDERS|LEGACY|2025|••••••(KEY|CY)/.test(all) && !/"configured":true/.test(all), all.slice(0, 200));
  const allF = await integrations.getAll(sb, F);
  const apolloF = allF.categories.flatMap((c) => c.items).find((i) => i.id === 'apollo');
  ok('…and the founder\'s page still shows its Apollo key (masked)', apolloF.configured && /••••••-KEY/.test(apolloF.fields[0].hint) && !JSON.stringify(allF).includes('APOLLO-FOUNDERS'), JSON.stringify(apolloF.fields));
}

// ── 2. Writing ──────────────────────────────────────────────────────────────
{
  const sb = world();
  const w = await integrations.setIntegration(sb, 'apollo', { api_key: 'APOLLO-SECOND-CO' }, S);
  ok('a second company can save its own key', w.success === true, JSON.stringify(w));
  ok('…and reads it back', await integrations.getSecret(sb, 'apollo', 'api_key', S) === 'APOLLO-SECOND-CO');
  ok('…without touching the founder\'s', await integrations.getSecret(sb, 'apollo', 'api_key', F) === 'APOLLO-FOUNDERS-LEGACY-KEY');
  await integrations.clearIntegration(sb, 'apollo', S);
  ok('the second company clearing its key leaves the founder\'s alone', await integrations.getSecret(sb, 'apollo', 'api_key', F) === 'APOLLO-FOUNDERS-LEGACY-KEY' && await integrations.getSecret(sb, 'apollo', 'api_key', S) === null);

  await integrations.setIntegration(sb, 'apollo', { api_key: 'APOLLO-FOUNDERS-NEW' }, F);
  ok('the founder replacing its key wins over the old one', await integrations.getSecret(sb, 'apollo', 'api_key', F) === 'APOLLO-FOUNDERS-NEW');
  ok('…and the second company still has nothing', await integrations.getSecret(sb, 'apollo', 'api_key', S) === null);
  await integrations.clearIntegration(sb, 'apollo', F);
  ok('the founder clearing its key REALLY clears it (the old stored key too)', await integrations.getSecret(sb, 'apollo', 'api_key', F) === null);

  const refused = await integrations.setIntegration(sb, 'apollo', { api_key: 'X' }, null);
  ok('a write that names no company is refused when there are several (it would have no owner)', !!refused.error && !refused.success, JSON.stringify(refused));
  ok('…and wrote nothing', await integrations.getSecret(sb, 'apollo', 'api_key', S) === null);

  await integrations.setActiveAi(sb, 'openrouter', S);
  ok('the AI provider a company chooses is its own choice', await integrations.getActiveAi(sb, S) === 'openrouter' && await integrations.getActiveAi(sb, F) === 'groq');
}

// ── 3. One company on the whole deployment: nothing changes ─────────────────
{
  const db = createFakeDb({ tables: { organizations: [{ id: F, created_at: '2025-01-01T00:00:00Z' }], app_settings: [{ key: 'int_apollo_api_key', value: 'ONLY-ONE' }] } });
  integrations._resetForTests({ id: null, multi: null });
  ok('with a single company, a caller naming no company still gets the key (today\'s behaviour)', await integrations.getSecret(db.supabase, 'apollo', 'api_key', null) === 'ONLY-ONE');
  ok('…and a caller naming that company does too', await integrations.getSecret(db.supabase, 'apollo', 'api_key', F) === 'ONLY-ONE');
  integrations.noteOrgCreated();
  ok('the moment a second company is created, a caller naming none is cut off (no restart needed)', await integrations.getSecret(db.supabase, 'apollo', 'api_key', null) === null);
  ok('…and the founder keeps its key', await integrations.getSecret(db.supabase, 'apollo', 'api_key', F) === 'ONLY-ONE');
}

// ── 4. The AI layer uses the asking company's key and no one else's ─────────
{
  const sb = world();
  ok('AI is available to the founder', await aiProvider.isAvailable(sb, F) === true);
  ok('AI is NOT available to a second company that has no key (it writes with the rules)', await aiProvider.isAvailable(sb, S) === false);
  ok('…the provider chain is empty for it, not the founder\'s', (await aiProvider.resolveChain(sb, S)).length === 0);
  const diag = await aiProvider.diagnose(sb, { orgId: S });
  ok('…and the AI health check for that company says nothing is configured', diag.configured === false && diag.providers.every((p) => !p.key_found), JSON.stringify(diag).slice(0, 200));
  const asked = await aiProvider.complete(sb, { prompt: 'hi', feature: 'engine_first_email', orgId: S });
  ok('a call made for that company returns null without reaching any provider', asked === null);
  await integrations.setIntegration(sb, 'groq', { api_key: 'gsk_SECOND_COMPANY' }, S);
  const chainS = await aiProvider.resolveChain(sb, S);
  const chainF = await aiProvider.resolveChain(sb, F);
  ok('once it saves its own key, its chain holds ITS key only', chainS.length === 1 && chainS[0].key === 'gsk_SECOND_COMPANY');
  ok('…and the founder\'s chain never contains it', !chainF.some((c) => c.key === 'gsk_SECOND_COMPANY'));
}

// ── 5. Apollo / verifier / JSearch callers ──────────────────────────────────
{
  const sb = world([{ key: 'int_zerobounce_api_key', value: 'ZB-FOUNDER' }]);
  const { verifyEmailAddress } = require('../email-verify');
  const r = await verifyEmailAddress(sb, 'someone@example.com', S);
  ok('a second company\'s address check does not use the founder\'s verifier', r.reason === 'not_configured', JSON.stringify(r));
  const v = await integrations.getActiveVerifier(sb, S);
  ok('…and its active verifier is none', v === null);
}

// ── 6. Who is the PACE operator? ────────────────────────────────────────────
{
  const op = require('../services/operator');
  const u = (o) => Object.assign({ email: 'a@x.test', roles: ['admin'], org_id: F }, o);
  ok('with no list, an admin of the founding company is the operator', op.isOperator(u(), { foundingOrgId: F, env: {} }) === true);
  ok('…an admin of another company is NOT', op.isOperator(u({ org_id: S }), { foundingOrgId: F, env: {} }) === false);
  ok('…a non-admin of the founding company is NOT', op.isOperator(u({ roles: ['bd_lead'] }), { foundingOrgId: F, env: {} }) === false);
  ok('…nobody is the operator while the founding company is unknown', op.isOperator(u(), { foundingOrgId: null, env: {} }) === false);
  const env = { OPERATOR_EMAILS: ' Boss@Fute.test , other@x.test ' };
  ok('with OPERATOR_EMAILS set, only a listed ADMIN is (case and spaces ignored)', op.isOperator(u({ email: 'boss@fute.test' }), { foundingOrgId: F, env }) === true);
  ok('…the founder\'s other admins are no longer', op.isOperator(u({ email: 'someone@fute.test' }), { foundingOrgId: F, env }) === false);
  ok('…a listed address that is not an admin is not', op.isOperator(u({ email: 'boss@fute.test', roles: ['ra'] }), { foundingOrgId: F, env }) === false);
  ok('…a legacy single-role session counts too', op.isOperator({ email: 'boss@fute.test', role: 'admin', org_id: S }, { foundingOrgId: F, env }) === true);
  ok('no session, no operator', op.isOperator(null, { foundingOrgId: F, env: {} }) === false);
}

// ── 7. Who is paused? ───────────────────────────────────────────────────────
{
  const pause = require('../services/sending-pause');
  const userOrg = new Map([['f-user', F], ['s-user', S]]);
  const state = (o) => Object.assign({ platform: false, orgs: new Set(), managers: new Set(), userOrg }, o);
  ok('nobody is paused by default', !pause.isUserPaused(state(), 'f-user') && !pause.isUserPaused(state(), 's-user'));
  ok('a company\'s stop pauses its people', pause.isUserPaused(state({ orgs: new Set([S]) }), 's-user') === true);
  ok('…and NOT another company\'s', pause.isUserPaused(state({ orgs: new Set([S]) }), 'f-user') === false);
  ok('the operator\'s platform stop pauses everyone', pause.isUserPaused(state({ platform: true }), 'f-user') && pause.isUserPaused(state({ platform: true }), 's-user'));
  ok('one paused manager does not pause the company', pause.isUserPaused(state({ managers: new Set(['s-user']) }), 'f-user') === false);
  ok('a person nobody has seen is not treated as paused by a company stop', pause.isUserPaused(state({ orgs: new Set([S]) }), 'stranger') === false);
  ok('an organisation check follows the same rule', pause.isOrgPaused({ platform: false, orgs: new Set([S]) }, S) && !pause.isOrgPaused({ platform: false, orgs: new Set([S]) }, F) && pause.isOrgPaused({ platform: true, orgs: new Set() }, F));
}

// ── 8. A bounce marks only the company whose mailbox received it (R-243) ────
{
  const { createDb } = require('../models/index.js');
  const { invalidateBouncedContacts } = require('../services/bounce-mark');
  const rules = require('../services/contact-status');
  const db = createFakeDb({
    tables: {
      contacts: [
        { id: 'c-f', org_id: F, email: 'Pat@Shared.test', email_status: 'valid', job_id: 'j1' },
        { id: 'c-s', org_id: S, email: 'pat@shared.test', email_status: 'valid', job_id: 'j2' },
        { id: 'c-s-blocked', org_id: S, email: 'pat@shared.test', email_status: 'blocked', job_id: 'j3' },
      ],
    },
  });
  const models = createDb(db.supabase);
  const marked = await invalidateBouncedContacts(models.forOrg(S), 'pat@shared.test', { neverEmail: rules.neverEmail });
  const rows = Object.fromEntries(db.tables.contacts.map((c) => [c.id, c.email_status]));
  ok('a bounce read from company S marks S\'s contact Invalid', rows['c-s'] === 'invalid' && marked.length === 1 && marked[0].id === 'c-s', JSON.stringify(rows));
  ok('…and the SAME address held by company F is left alone', rows['c-f'] === 'valid', JSON.stringify(rows));
  ok('…a blocked contact stays Blocked (the older rule still holds)', rows['c-s-blocked'] === 'blocked');
}

// The sweep itself is inside index.js and cannot be called from here, so its wiring is pinned by reading it (a wiring pin only:
// the rule it hands over to is the callable one just above).
{
  const fs = require('node:fs');
  const idx = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const body = idx.slice(idx.indexOf('async function markBouncesFromMessages('), idx.indexOf('async function readSmtpMailbox('));
  ok('the bounce sweep scopes to the mailbox\'s own company before it looks anyone up', /db\.forOrg\(orgId\)/.test(body) && /invalidateBouncedContacts\(scoped,/.test(body) && !/supabase\.from\('contacts'\)/.test(body));
}

// ── 9. The shared engines belong to the operator (R-049), over the real router ──
{
  const express = require('express');
  const makeCron = require('../routes/cron');
  let ran = 0;
  const runner = { runJob: async (n) => { ran++; return { job: n, ran: true, ok: true }; }, status: async () => [], recent: async () => [], names: () => ['sweep'], recordPing: async () => {}, lastPingAt: async () => null };
  const hasRole = (req, ...roles) => roles.some((r) => (req.user.roles || []).includes(r));
  const op = require('../services/operator');
  const serve = async (user) => {
    const app = express(); app.use(express.json());
    app.use(makeCron({ runner, auth: (req, _r, next) => { req.user = user; next(); }, hasRole, isOperator: (req) => op.isOperator(req.user, { foundingOrgId: F, env: {} }) }));
    const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  };
  const other = await serve({ id: 'u2', roles: ['admin'], org_id: S, email: 'admin@second.test' });
  const r1 = await fetch(other.base + '/admin/engine/run/sweep', { method: 'POST' });
  ok('a second company\'s ADMIN cannot run the shared background engines', r1.status === 403 && ran === 0, `status ${r1.status}, ran ${ran}`);
  other.server.close();
  const founder = await serve({ id: 'u1', roles: ['admin'], org_id: F, email: 'admin@founder.test' });
  const r2 = await fetch(founder.base + '/admin/engine/run/sweep', { method: 'POST' });
  ok('the operator can', r2.status === 200 && ran === 1, `status ${r2.status}, ran ${ran}`);
  founder.server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
