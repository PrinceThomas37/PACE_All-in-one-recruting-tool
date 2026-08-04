// Unit test for services/sso.js — "Sign in with Microsoft / Google".
//
// This is the FRONT DOOR, so the bar is higher than for the mailbox-connect
// flow it shares a redirect URI with (that one is admin-gated and starts from an
// already-authenticated session). Four properties matter, and all four are the
// difference between a login and a way in:
//
//   1. The `state` must be UNFORGEABLE. Both providers hand the callback back to
//      one registered redirect URI, and the state is what says "this is a
//      sign-in, not a mailbox connect". If a plain base64 blob could enter that
//      branch, anyone could drive the sign-in path with a crafted URL.
//   2. State must EXPIRE, so a captured link is not a permanent skeleton key.
//   3. Only an EXISTING, ACTIVE, non-deleted user gets a session. SSO must not
//      quietly create accounts, and must not resurrect disabled ones.
//   4. The session token never reaches the server in a query string — it is
//      handed back in the URL FRAGMENT, which is not sent to servers and so
//      stays out of access logs and Referer headers.
//
// Usage: node test/sso-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-for-sso';
const sso = require('../services/sso.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── A Supabase double: one active user, one inactive, one soft-deleted ──────
const USERS = [
  { id: 'u1', email: 'ada@client.com', name: 'Ada', role: 'bd', roles: ['bd'], org_id: 'org-1', is_active: true, deleted_at: null, password_hash: 'x' },
  { id: 'u2', email: 'gone@client.com', name: 'Gone', role: 'bd', roles: ['bd'], org_id: 'org-1', is_active: false, deleted_at: null, password_hash: 'x' },
  { id: 'u3', email: 'deleted@client.com', name: 'Del', role: 'bd', roles: ['bd'], org_id: 'org-1', is_active: true, deleted_at: '2026-01-01', password_hash: 'x' },
];
function fakeSupabase() {
  const updates = [];
  return {
    updates,
    from(table) {
      const q = { _eq: {}, _is: {} };
      const chain = {
        select: () => chain,
        eq: (c, v) => { q._eq[c] = v; return chain; },
        is: (c, v) => { q._is[c] = v; return chain; },
        update: (patch) => { updates.push({ table, patch }); return chain; },
        maybeSingle: async () => {
          const row = USERS.find(u =>
            u.email === q._eq.email &&
            (q._eq.is_active === undefined || u.is_active === q._eq.is_active) &&
            (q._is.deleted_at === undefined || u.deleted_at === null));
          return { data: row || null, error: null };
        },
        then: (res) => Promise.resolve({ data: null, error: null }).then(res),
      };
      return chain;
    },
  };
}

// ── 1. State signing / verification ─────────────────────────────────────────
{
  const state = sso.signState({ provider: 'microsoft', redirect: '/' });
  const back = sso.readSignInState(state);
  ok('a signed state round-trips', !!back && back.provider === 'microsoft', JSON.stringify(back));
  ok('...and is marked as a sign-in', back.p === 'signin');
  ok('...carrying the redirect', back.redirect === '/');
  ok('a url-encoded state still verifies', !!sso.readSignInState(encodeURIComponent(state)));
}
{
  // THE important one: the mailbox flow's plain-base64 state must NOT be able to
  // enter the sign-in branch, and neither must anything hand-made.
  const mailboxState = Buffer.from(JSON.stringify({ userEmailId: 'e1', userId: 'u1' })).toString('base64');
  ok('a mailbox-connect state is NOT read as a sign-in', sso.readSignInState(mailboxState) === null);

  const forged = Buffer.from(JSON.stringify({ p: 'signin', provider: 'microsoft' })).toString('base64');
  ok('a forged base64 "signin" state is rejected', sso.readSignInState(forged) === null);

  const wrongKey = jwt.sign({ p: 'signin', provider: 'microsoft' }, 'not-the-secret');
  ok('a state signed with the WRONG key is rejected', sso.readSignInState(wrongKey) === null);

  ok('garbage is rejected without throwing', sso.readSignInState('!!!not-a-token!!!') === null);
  ok('an empty state is rejected', sso.readSignInState('') === null && sso.readSignInState(undefined) === null);

  // A validly-signed token that isn't a sign-in state must not qualify either —
  // e.g. somebody's actual session token pasted into the state parameter.
  const sessionToken = jwt.sign({ id: 'u1', email: 'ada@client.com' }, process.env.JWT_SECRET);
  ok('a valid SESSION token is not accepted as a sign-in state', sso.readSignInState(sessionToken) === null);
}
{
  const expired = jwt.sign({ p: 'signin', provider: 'microsoft' }, process.env.JWT_SECRET, { expiresIn: -10 });
  ok('an expired state is rejected (a captured link is not a skeleton key)', sso.readSignInState(expired) === null);
  ok('the state lifetime is short', sso.STATE_TTL_SECONDS <= 900, String(sso.STATE_TTL_SECONDS));
}

// ── 2. Only a real, active user gets a session ──────────────────────────────
{
  const sb = fakeSupabase();
  const out = await sso.sessionForEmail(sb, 'ada@client.com', { provider: 'microsoft' });
  ok('a known active user gets a session', out.ok === true, JSON.stringify(out));
  ok('...with a token', typeof out.token === 'string' && out.token.length > 20);
  const claims = jwt.verify(out.token, process.env.JWT_SECRET);
  ok('...carrying the user id', claims.id === 'u1');
  ok('...carrying roles', Array.isArray(claims.roles) && claims.roles[0] === 'bd', JSON.stringify(claims.roles));
  ok('...carrying org_id (multi-tenant scoping depends on it)', claims.org_id === 'org-1', String(claims.org_id));
  ok('...and the password hash is never returned', out.user && out.user.password_hash === undefined);
  ok('the sign-in is recorded', sb.updates.some(u => u.table === 'users' && u.patch.last_login_method === 'microsoft'), JSON.stringify(sb.updates));
}
{
  const out = await sso.sessionForEmail(fakeSupabase(), 'nobody@client.com', { provider: 'microsoft' });
  ok('an unknown email gets NO session', out.ok === false && out.reason === 'no_account', JSON.stringify(out));
  ok('...and is told what to do about it', /administrator/i.test(out.message), out.message);
  ok('...and SSO did not create an account', out.token === undefined);
}
{
  const out = await sso.sessionForEmail(fakeSupabase(), 'gone@client.com', { provider: 'microsoft' });
  ok('a DEACTIVATED user cannot sign in via SSO', out.ok === false, JSON.stringify(out));
}
{
  const out = await sso.sessionForEmail(fakeSupabase(), 'deleted@client.com', { provider: 'microsoft' });
  ok('a soft-DELETED user cannot sign in via SSO', out.ok === false, JSON.stringify(out));
}
{
  const out = await sso.sessionForEmail(fakeSupabase(), '', { provider: 'google' });
  ok('a missing email is refused', out.ok === false && out.reason === 'no_email', JSON.stringify(out));
  const mixed = await sso.sessionForEmail(fakeSupabase(), '  Ada@Client.com  ', { provider: 'google' });
  ok('the email is normalised (case + whitespace) before matching', mixed.ok === true, JSON.stringify(mixed));
}

// ── 3. The token goes back in the FRAGMENT, not the query ───────────────────
{
  const page = sso.completionPage('TOKEN123', '/');
  ok("the completion page uses a '#sso=' fragment", /#sso=/.test(page), page.slice(0, 200));
  ok('...and never puts the token in a query string', !/\?sso=/.test(page));
  ok('...and replaces history so the token is not left in the address bar', /location\.replace/.test(page));
  // An open redirect here would let a phishing page harvest a real session.
  const evil = sso.completionPage('T', 'https://evil.example.com/steal');
  ok('an absolute redirect target is refused (no open redirect)', !/evil\.example\.com/.test(evil), evil.slice(0, 300));
  ok('...falling back to the app root', /"\/"/.test(evil) || /'\/'/.test(evil));
  const rel = sso.completionPage('T', '/leads');
  ok('a relative redirect target is preserved', /\/leads/.test(rel));
}

// ── 4. Failure pages say enough, and no more ────────────────────────────────
{
  const p = sso.failurePage('Something went wrong');
  ok('the failure page renders the message', /Something went wrong/.test(p));
  ok('...and offers a way back', /href="\/"/.test(p));
  ok('...and strips angle brackets so a provider message cannot inject markup',
    !/<script>/i.test(sso.failurePage('<script>alert(1)</script>')), sso.failurePage('<script>alert(1)</script>').slice(0, 300));
}

// ── 5. Session shape matches the password path ──────────────────────────────
{
  ok('the SSO session TTL matches the password login (8h)', sso.SESSION_TTL === '8h', sso.SESSION_TTL);
}

console.log('\n=== SSO SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
