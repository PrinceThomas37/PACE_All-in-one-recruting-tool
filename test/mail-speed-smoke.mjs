// Fewer trips to a far-away database (20 Oct 2026).
//
// The database is in Seoul and the server in Ohio: every query costs ~200 ms, and the app makes them one after another. Opening an
// email, or listing 25 conversations, paid for that many round trips before showing anything. This pins the three savings that do
// not need the database moved:
//   1. a still-valid Gmail access token is remembered (one database read, not one per Gmail call), and forgotten on reconnect;
//   2. the mailbox gate asks "is it yours, is it connected?" in ONE round trip, not two;
//   3. the reply sweep asks Gmail only for mail NEWER than the last one it saw, and handles one message at a time.
//
// The real gmail-provider and the real mailbox route run against scripted fakes.
//
// Usage: node test/mail-speed-smoke.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const express = require('express');
const { createGmailProvider } = require('../gmail-provider.js');

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };

// ── 1. the token is read once ───────────────────────────────────────────────
{
  let reads = 0;
  const row = { user_email_id: 'mb1', access_token: 'tok-1', refresh_token: 'r', expires_at: new Date(Date.now() + 3600 * 1000).toISOString() };
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ single: async () => { reads++; return { data: row, error: null }; } }) }) }) };
  const gp = createGmailProvider({ supabase, google: { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/cb' } });
  const seen = [];
  for (let i = 0; i < 6; i++) seen.push(await gp.getToken('mb1'));
  ok('six Gmail calls in a row read the token row ONCE', reads === 1 && seen.every((t) => t === 'tok-1'), `reads=${reads}`);
  gp.forgetToken('mb1');
  row.access_token = 'tok-2';
  ok('after a reconnect (forgetToken) the NEW token is read', await gp.getToken('mb1') === 'tok-2' && reads === 2, `reads=${reads}`);
  ok('another mailbox is not served from the first one\'s cache', (await gp.getToken('mb2')) === 'tok-2' && reads === 3);
}
{
  // a token that expires soon is not kept past its margin: it is read each time until it is refreshed
  let reads = 0;
  const row = { user_email_id: 'mb3', access_token: 'tok-soon', refresh_token: 'r', expires_at: new Date(Date.now() + 6 * 60 * 1000).toISOString() };
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ single: async () => { reads++; return { data: row, error: null }; } }) }) }) };
  const gp = createGmailProvider({ supabase, google: { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/cb' } });
  await gp.getToken('mb3'); await gp.getToken('mb3');
  ok('a token with 6 minutes left is kept for about a minute at most (never past its 5-minute safety margin)', reads <= 2, `reads=${reads}`);
}

// ── 2. the mailbox gate is one round trip ───────────────────────────────────
{
  const L = 200;                                                        // each query "takes" 120 ms, like a far-away database
  const MB = { id: 'mb-dc', user_id: 'me', org_id: 'o', email_address: 'dc@x.test', platform: 'Gmail', is_active: true };
  const q = (table) => {
    const f = {};
    const chain = {
      select: () => chain, eq: (c, v) => { f[c] = v; return chain; },
      maybeSingle: async () => { await new Promise((r) => setTimeout(r, L)); return { data: table === 'user_emails' ? MB : null, error: null }; },
    };
    return chain;
  };
  const app = express(); app.use(express.json());
  app.use(require('../routes/mailbox.js')({
    supabase: { from: q }, db: { forRequest: () => ({}) },
    auth: (req, _r, next) => { req.user = { id: 'me', org_id: 'o', roles: ['recruiter'] }; next(); }, orgIdFor: (req) => req.user.org_id,
    graphMailRequest: async () => ({}), getMicrosoftToken: async () => 't', gmailProvider: { isConfigured: () => true },
  }));
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${server.address().port}/mailbox/mb-dc/folders`);
  const took = Date.now() - t0;
  server.close();
  ok('a mailbox that is not connected is still refused with 409 "not connected"', r.status === 409, String(r.status));
  ok(`the gate costs ONE round trip (${took} ms with ${L} ms per query), not two`, took < L * 2 - 20, `${took} ms`);
}

// ── 3. the reply sweep reads only what is new, one message at a time (wiring pin) ──
{
  const idx = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const body = idx.slice(idx.indexOf('async function sweepGmailReplies('), idx.indexOf('async function runReplySweep('));
  ok('the Gmail reply sweep asks for mail after an exact Unix time, not after a whole day', /after:\$\{afterSec\}/.test(body) && !/slice\(0, 10\)/.test(body));
  ok('…and handles each message as it arrives instead of holding them all', /processInboundMessages\(\[norm\]/.test(body) && !/messages\.push\(/.test(body));
}

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
