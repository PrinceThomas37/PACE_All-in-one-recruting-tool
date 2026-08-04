// Unit test for the Gmail side of the reply sweep (Step 4).
//
// THE GAP THIS CLOSES: gmail-provider's listMessages/getMessage were written and
// NOTHING EVER CALLED THEM, so a Gmail-only mailbox got no reply detection at
// all. The consequence was the worst kind an outreach tool can have — a nurture
// sequence sent from a Gmail mailbox kept emailing people who had already
// written back, because nothing could see the reply.
//
// The fix reshapes Gmail messages into the SAME shape Microsoft Graph returns,
// so one set of matching rules serves both providers. That normalizer is what
// this file tests: if it drops the sender, the date, or the body, the shared
// sweep silently stops matching replies for Gmail — and silence is exactly the
// failure mode we are trying to end.
//
// Usage: node test/gmail-sweep-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createGmailProvider } = require('../gmail-provider.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const provider = createGmailProvider({
  supabase: null,
  google: { clientId: 'x', clientSecret: 'y', redirectUri: 'z', scopes: 's' },
});

const SENT = Date.parse('2026-08-01T09:30:00Z');

// A realistic Gmail `format=full` payload: multipart, headers as a list, body
// base64url-encoded in a nested part, date as epoch-millis string.
const gmailMsg = {
  id: 'msg-1',
  threadId: 'thread-9',
  internalDate: String(SENT),
  snippet: 'Thanks — what are your rates for this role?',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'Ada Lovelace <ada@client.com>' },
      { name: 'To', value: 'bd@futeglobal.com' },
      { name: 'Subject', value: 'Re: Java opening' },
      { name: 'Date', value: 'Sat, 1 Aug 2026 09:30:00 +0000' },
    ],
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('Thanks — what are your rates for this role?\n\nOn Fri someone wrote:\n> hello') } },
      { mimeType: 'text/html', body: { data: b64url('<div>Thanks — what are your rates?</div>') } },
    ],
  },
};

// ── 1. The normalizer produces Graph's shape ────────────────────────────────
{
  const n = provider.normalizeMessage(gmailMsg);
  ok('returns a message object', !!n);
  // These four field paths are exactly what the shared sweep reads. If any one
  // of them is wrong, Gmail replies stop being detected — silently.
  ok('from.emailAddress.address matches Graph\'s shape', n.from?.emailAddress?.address === 'ada@client.com', JSON.stringify(n.from));
  ok('...and is lowercased for matching', n.from.emailAddress.address === n.from.emailAddress.address.toLowerCase());
  ok('...with the display name kept separately', n.from.emailAddress.name === 'Ada Lovelace', n.from.emailAddress.name);
  ok('receivedDateTime is an ISO string, not epoch millis',
    n.receivedDateTime === new Date(SENT).toISOString(), n.receivedDateTime);
  ok('subject is carried across', n.subject === 'Re: Java opening', n.subject);
  ok('body.content is populated', !!n.body?.content && /rates/.test(n.body.content), n.body?.content);
  ok('bodyPreview is populated (the sweep reads it for opt-out text)', /rates/.test(n.bodyPreview || ''));
  ok('threadId is preserved for threading', n.threadId === 'thread-9');
  ok('the message id is preserved (dedup key)', n.id === 'msg-1');
  ok('it is tagged as gmail so storage records the right provider', n._provider === 'gmail');
  ok('headers are exposed in Graph\'s list shape (warm-up/NDR detection reads them)',
    Array.isArray(n.internetMessageHeaders) && n.internetMessageHeaders.some(h => h.name === 'subject'),
    JSON.stringify(n.internetMessageHeaders || []).slice(0, 120));
}

// ── 2. Body extraction details ──────────────────────────────────────────────
{
  const n = provider.normalizeMessage(gmailMsg);
  ok('prefers text/plain over text/html', /On Fri someone wrote/.test(n.body.content), n.body.content.slice(0, 80));
  ok('...and marks the contentType accordingly', n.body.contentType === 'text', n.body.contentType);

  const htmlOnly = { ...gmailMsg, payload: { ...gmailMsg.payload, parts: [gmailMsg.payload.parts[1]] } };
  const hn = provider.normalizeMessage(htmlOnly);
  ok('falls back to text/html when there is no plain part', /rates/.test(hn.body.content), hn.body.content);
  ok('...and says so', hn.body.contentType === 'html');

  // Single-part message: body hangs off payload directly, no `parts`.
  const flat = {
    id: 'm2', internalDate: String(SENT), snippet: 'ok',
    payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'z@x.com' }], body: { data: b64url('Plain single part') } },
  };
  ok('handles a single-part message with no parts array',
    provider.normalizeMessage(flat).body.content === 'Plain single part',
    provider.normalizeMessage(flat).body.content);

  // Deeply nested multipart/mixed → multipart/alternative → text/plain.
  const nested = {
    id: 'm3', internalDate: String(SENT),
    payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'z@x.com' }],
      parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64url('Deep body') } }] }] },
  };
  ok('walks a nested MIME tree', provider.normalizeMessage(nested).body.content === 'Deep body');
}

// ── 3. Degradation — a malformed message must not end the sweep ─────────────
{
  ok('null input returns null, not a throw', provider.normalizeMessage(null) === null);
  const bare = provider.normalizeMessage({ id: 'x' });
  ok('a message with no payload still normalizes', !!bare && bare.id === 'x');
  ok('...with an empty sender rather than undefined', bare.from.emailAddress.address === '');
  ok('...and a usable timestamp', !Number.isNaN(Date.parse(bare.receivedDateTime)), bare.receivedDateTime);

  const badB64 = { id: 'y', internalDate: String(SENT),
    payload: { mimeType: 'text/plain', headers: [], body: { data: '!!!not base64!!!' } } };
  ok('undecodable body does not throw', typeof provider.normalizeMessage(badB64).body.content === 'string');

  // No internalDate — must fall back to the Date header.
  const noInternal = { id: 'z', payload: { headers: [{ name: 'Date', value: 'Sat, 1 Aug 2026 09:30:00 +0000' }] } };
  ok('falls back to the Date header when internalDate is absent',
    provider.normalizeMessage(noInternal).receivedDateTime === new Date(SENT).toISOString(),
    provider.normalizeMessage(noInternal).receivedDateTime);
}

// ── 4. A bare address (no display name) still parses ────────────────────────
{
  const bareFrom = { id: 'b', internalDate: String(SENT),
    payload: { headers: [{ name: 'From', value: 'plain@x.com' }] } };
  ok('a From with no angle brackets still yields the address',
    provider.normalizeMessage(bareFrom).from.emailAddress.address === 'plain@x.com');

  const upper = { id: 'c', internalDate: String(SENT),
    payload: { headers: [{ name: 'From', value: 'Loud <LOUD@X.COM>' }] } };
  ok('an uppercase address is lowercased (matching is case-sensitive downstream)',
    provider.normalizeMessage(upper).from.emailAddress.address === 'loud@x.com');
}

// ── 5. End-to-end with the analyzer ─────────────────────────────────────────
{
  // The whole point: a Gmail reply must flow into conversation-intel and produce
  // the same verdict a Graph reply would.
  const ci = require('../conversation-intel.js');
  const n = provider.normalizeMessage(gmailMsg);
  const body = ci.cleanForStorage(n.body.content);
  ok('the quoted chain is stripped before storage', !/someone wrote/.test(body), body);
  ok('intent survives the round trip', ci.classifyIntent(body)?.id === 'rates', JSON.stringify(ci.classifyIntent(body)));
  const verdict = ci.analyzeThread([
    { direction: 'outbound', sent_at: '2026-07-28T09:00:00Z', body: 'Hi, we have a Java role.' },
    { direction: 'inbound', sent_at: n.receivedDateTime, body },
  ], { now: Date.parse('2026-08-04T09:30:00Z') });
  ok('a Gmail reply produces a needs_reply verdict', verdict.state === 'needs_reply', verdict.state);
  ok('...with the delay counted from the Gmail timestamp', verdict.days_since_inbound === 3, String(verdict.days_since_inbound));
}

// ── 6. isConfigured still gates everything ──────────────────────────────────
{
  const unconfigured = createGmailProvider({ supabase: null, google: {} });
  ok('an unconfigured provider reports so (the sweep skips it)', unconfigured.isConfigured() === false);
  ok('a configured provider reports so', provider.isConfigured() === true);
  ok('normalizeMessage is exported', typeof provider.normalizeMessage === 'function');
}

console.log('\n=== GMAIL SWEEP SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
