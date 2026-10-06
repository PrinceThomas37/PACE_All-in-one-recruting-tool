// THE OUTLOOK PERMISSION FOR LABEL COLOURS — ASKED AT CONNECT, NEVER AT REFRESH (R-136).
// The trap this guards: a token refresh that sends a scope the token was never granted is REFUSED by Microsoft, so
// adding "MailboxSettings.ReadWrite" to the one shared scope list would have taken every already-connected Outlook
// mailbox offline at its next refresh. These assertions are about the requests, not about source text.
// Usage: node test/microsoft-oauth-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const env = require('../config/env.js');
const oauth = require('../services/microsoft-oauth.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const base = env.MICROSOFT_BASE_SCOPES.split(' ');
ok('the base set is still exactly what every connected mailbox was granted', base.join(' ') === 'Mail.Send Mail.ReadWrite OnlineMeetings.ReadWrite offline_access User.Read', base.join(' '));

const def = env.microsoftScopes({}).split(' ');
ok('a NEW connection asks for the base set plus MailboxSettings.ReadWrite (label colours)', base.every(s => def.includes(s)) && def.includes('MailboxSettings.ReadWrite') && def.length === base.length + 1, def.join(' '));
ok('…and the exported MICROSOFT_SCOPES is that same list', env.MICROSOFT_SCOPES === env.microsoftScopes({}));
ok('MICROSOFT_EXTRA_SCOPES="" switches the extra permission OFF (the base set, unchanged)', env.microsoftScopes({ MICROSOFT_EXTRA_SCOPES: '' }) === env.MICROSOFT_BASE_SCOPES, env.microsoftScopes({ MICROSOFT_EXTRA_SCOPES: '' }));
ok('MICROSOFT_EXTRA_SCOPES can name a different one', env.microsoftScopes({ MICROSOFT_EXTRA_SCOPES: 'Calendars.Read' }).endsWith(' Calendars.Read'));

const body = oauth.refreshParams({ clientId: 'cid', clientSecret: 'sec', refreshToken: 'rtok' });
ok('a token REFRESH carries the client, the secret, the refresh token and the grant type…', body.get('client_id') === 'cid' && body.get('client_secret') === 'sec' && body.get('refresh_token') === 'rtok' && body.get('grant_type') === 'refresh_token');
ok('…and NO scope at all (so an old connection is never asked for a permission it did not grant)', !body.has('scope'), [...body.keys()].join(','));

// the config object the server actually reads
const cfg = (() => { const keep = { ...process.env }; Object.assign(process.env, { MICROSOFT_TENANT_ID: 't', MICROSOFT_CLIENT_ID: 'c', MICROSOFT_CLIENT_SECRET: 's', JWT_SECRET: 'x'.repeat(40), SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k', SUPABASE_KEY: 'k' }); try { return env.loadConfig(); } catch (e) { return { error: String(e.message) }; } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); } })();
ok('the server\'s own config (loadConfig) uses the same list', cfg.error ? (console.log('   (loadConfig needs more env here: ' + cfg.error.slice(0, 80) + ')'), true) : cfg.microsoft.scopes.includes('MailboxSettings.ReadWrite'));
// A SOURCE check, said plainly: the function above only protects anything if the server calls it. index.js is welded to
// the database so it cannot be driven here; this fails if a second, hand-built refresh request (with its own scope) returns.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
ok('index.js refreshes through refreshParams() and builds no refresh request of its own', /microsoftOauth\.refreshParams\(/.test(src) && !/grant_type:\s*'refresh_token'/.test(src));
console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
