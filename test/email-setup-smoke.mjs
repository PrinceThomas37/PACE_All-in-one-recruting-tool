// Verifies the COMPANY EMAIL SETUP checklist (owner, 12 Oct, D-0120, R-200): what a customer's admin and their IT person are
// told to paste, and that each item is CHECKED rather than assumed. The DNS resolver is injected, so every case is an exact
// record set — no network. Also the route's guard: admin only, and only a domain THIS organisation has claimed.
//
// Usage: node test/email-setup-smoke.mjs

import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
process.env.JWT_SECRET = 'test-secret-for-email-setup';
const es = require('../services/email-setup.js');
const express = require('express');

const results = [];
const step = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

// A resolver from plain records: { mx:[hosts], txt:{name:[records]}, cname:{name:[targets]} }
const dnsOf = (z) => ({
  mx: async () => z.mx || [],
  txt: async (n) => (z.txt && z.txt[n]) || [],
  cname: async (n) => (z.cname && z.cname[n]) || [],
});
const ROW = { id: 'd1', domain: 'acme.com', verified_at: '2026-10-01T00:00:00Z', auto_join: true };
const item = (c, id) => c.items.find((i) => i.id === id);

// ── 1. which provider ─────────────────────────────────────────────────────────────────────────────────────────────────
step('Google MX is recognised', es.detectProvider(['aspmx.l.google.com.', 'alt1.aspmx.l.google.com']).key === 'google');
step('Microsoft 365 MX is recognised', es.detectProvider(['acme-com.mail.protection.outlook.com']).key === 'microsoft');
const z = es.detectProvider(['mx.zoho.in', 'mx2.zoho.in']);
step('Zoho is recognised, with its REGION (India answers from zoho.in, not zoho.com)', z.key === 'zoho' && z.region === 'in' && z.spfInclude === 'include:zoho.in');
step('Zoho in Europe follows its region too', es.detectProvider(['mx.zoho.eu']).spfInclude === 'include:zoho.eu');
step('an unknown provider is "other", never guessed; no MX at all is "other" too', es.detectProvider(['mail.example-host.net']).key === 'other' && es.detectProvider([]).key === 'other');
step('a lookalike host is NOT taken for Google or Zoho', es.detectProvider(['google.com.evil.example']).key === 'other' && es.detectProvider(['notzoho.com']).key === 'other');

// ── 2. SPF: one record only ───────────────────────────────────────────────────────────────────────────────────────────
const zoho = es.detectProvider(['mx.zoho.com']);
step('no SPF: a fresh record for the provider is offered', es.checkSpf([], zoho).value === 'v=spf1 include:zoho.com ~all' && !es.checkSpf([], zoho).ok);
const merged = es.checkSpf(['v=spf1 include:sendgrid.net -all'], zoho);
step('an existing SPF is EXTENDED, never duplicated: the provider is added before the closing "all"', !merged.ok && merged.replace === true && merged.value === 'v=spf1 include:sendgrid.net include:zoho.com -all', merged.value);
step('an SPF that already includes the provider is done', es.checkSpf(['v=spf1 include:zoho.com ~all'], zoho).ok);
step('two SPF records are called out (providers treat two as none)', /more than one SPF/.test(es.checkSpf(['v=spf1 include:a.com ~all', 'v=spf1 include:b.com ~all'], zoho).why));
step('a TXT that merely mentions spf is not an SPF record', !es.checkSpf(['google-site-verification=abc', 'my v=spf1 note'], zoho).found);

// ── 3. DMARC: p=none is a real start ──────────────────────────────────────────────────────────────────────────────────
step('no DMARC: the starter record is offered, at p=none (watch only)', es.checkDmarc([], 'acme.com').value === 'v=DMARC1; p=none; rua=mailto:dmarc@acme.com');
step('DMARC at p=none counts as done, and says it is only watching', es.checkDmarc(['v=DMARC1; p=none; rua=mailto:x@acme.com'], 'acme.com').ok && /watching/.test(es.checkDmarc(['v=DMARC1; p=none'], 'acme.com').why));
step('a DMARC record with no policy is not done', !es.checkDmarc(['v=DMARC1; rua=mailto:x@acme.com'], 'acme.com').ok);

// ── 4. DKIM: found at the provider's selector, or a typed one ─────────────────────────────────────────────────────────
const dk = es.PROVIDERS;
step('DKIM found as a TXT at the provider\'s selector', (await es.checkDkim('acme.com', zoho, dnsOf({ txt: { 'zoho._domainkey.acme.com': ['v=DKIM1; k=rsa; p=ABC'] } }))).ok);
step('DKIM found as a CNAME (Microsoft publishes two)', (await es.checkDkim('acme.com', es.detectProvider(['a.mail.protection.outlook.com']), dnsOf({ cname: { 'selector2._domainkey.acme.com': ['selector2-acme-com._domainkey.x.onmicrosoft.com'] } }))).ok);
const custom = await es.checkDkim('acme.com', zoho, dnsOf({ txt: { 'mykey._domainkey.acme.com': ['v=DKIM1; p=XYZ'] } }), 'mykey');
step('a selector the admin types is tried first', custom.ok && custom.selector === 'mykey');
const none = await es.checkDkim('acme.com', zoho, dnsOf({}));
step('DKIM missing: says which selectors were looked at', !none.ok && /"zoho"/.test(none.why));
step('a selector typed with junk in it is not used as a DNS name', (await es.checkDkim('acme.com', zoho, dnsOf({}), 'a b;c')).tried.indexOf('a b;c') < 0);

// ── 5. the whole checklist ────────────────────────────────────────────────────────────────────────────────────────────
const bare = await es.buildChecklist({ domain: 'acme.com', verified_at: null, auto_join: false }, { resolver: dnsOf({ mx: ['mx.zoho.com'] }) });
step('a bare Zoho domain: provider found, ownership, SPF, DKIM, DMARC, staff are all still to do', bare.provider.key === 'zoho' && ['ownership', 'spf', 'dkim', 'dmarc', 'staff'].every((id) => item(bare, id).status === 'todo') && item(bare, 'provider').status === 'done');
step('…1 of 6 is reported honestly (only "where your mail lives" is found; the "how staff connect" line is information, not a task)', bare.done === 1 && bare.total === 6, bare.done + '/' + bare.total);
step('the SPF item carries the exact record; so does DMARC', item(bare, 'spf').record.value === 'v=spf1 include:zoho.com ~all' && item(bare, 'dmarc').record.host === '_dmarc');
step('DKIM carries steps (where to switch it on), never an invented key', !item(bare, 'dkim').record && /Zoho Mail Admin Console/.test(item(bare, 'dkim').steps.join(' ')));
step('a Zoho domain is told plainly that the app-password connection is NOT BUILT yet (a screen must not advertise what does not exist)', /still being built/.test(item(bare, 'connect').summary) && /cannot be connected yet/.test(item(bare, 'connect').summary));
const built = await es.buildChecklist(ROW, { resolver: dnsOf({ mx: ['mx.zoho.com'] }), smtpAvailable: true });
step('…and once it is built, the same line says how it works', /app password/.test(item(built, 'connect').summary) && !/still being built/.test(item(built, 'connect').summary));
const g = await es.buildChecklist(ROW, { resolver: dnsOf({ mx: ['aspmx.l.google.com'] }) });
step('a Google domain connects by sign-in: "nothing to set up here"', /signs in with Google Workspace|sign in with Google Workspace/.test(item(g, 'connect').summary) && /Nothing to set up/.test(item(g, 'connect').summary));
const all = await es.buildChecklist(ROW, { resolver: dnsOf({ mx: ['mx.zoho.com'], txt: { 'acme.com': ['v=spf1 include:zoho.com ~all'], '_dmarc.acme.com': ['v=DMARC1; p=none'], 'zoho._domainkey.acme.com': ['v=DKIM1; p=A'] } }) });
step('everything in place: every task is done, 6 of 6', all.done === 6 && all.total === 6, all.done + '/' + all.total);
step('…and the IT note says there is nothing left to change', /Nothing is left to change/.test(all.it_text));

// ── 6. the note for the IT person ─────────────────────────────────────────────────────────────────────────────────────
step('the IT note lists only what is left, with exact type / host / value', /1\. SPF/.test(bare.it_text) && /Type: TXT/.test(bare.it_text) && /Host\/Name: _dmarc/.test(bare.it_text) && /Value: v=spf1 include:zoho\.com ~all/.test(bare.it_text));
step('…and says an existing SPF is replaced, not added to', /only one SPF record/.test((await es.buildChecklist(ROW, { resolver: dnsOf({ mx: ['mx.zoho.com'], txt: { 'acme.com': ['v=spf1 include:sendgrid.net -all'] } }) })).it_text));
step('…and does not list what is already done', !/DMARC/.test((await es.buildChecklist(ROW, { resolver: dnsOf({ mx: ['mx.zoho.com'], txt: { '_dmarc.acme.com': ['v=DMARC1; p=none'] } }) })).it_text));

// ── 7. the route ──────────────────────────────────────────────────────────────────────────────────────────────────────
const domains = [{ id: 'd1', org_id: 'orgA', domain: 'acme.com', verified_at: '2026-10-01', auto_join: true }];
const fakeSupabase = { from: () => { const q = { _f: {}, select() { return q; }, eq(k, v) { q._f[k] = v; return q; }, maybeSingle() { const r = domains.find((d) => Object.keys(q._f).every((k) => d[k] === q._f[k])); return Promise.resolve({ data: r || null, error: null }); } }; return q; } };
let who = { org: 'orgA', roles: ['admin'] };
const ctx = { supabase: fakeSupabase, auth: (req, res, next) => next(), hasRole: (req, ...r) => who.roles.some((x) => r.includes(x)), orgIdFor: () => who.org, emailSetupResolver: dnsOf({ mx: ['mx.zoho.com'] }) };
const app = express(); app.use(express.json()); app.use(require('../routes/org-domains.js')(ctx));
const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
const get = (p) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : {} })); }));
let r = await get('/org/domains/d1/email-setup');
step('an admin gets the checklist for their own claimed domain', r.status === 200 && r.body.domain === 'acme.com' && r.body.provider.key === 'zoho' && Array.isArray(r.body.items));
who = { org: 'orgB', roles: ['admin'] };
r = await get('/org/domains/d1/email-setup');
step('ANOTHER organisation\'s admin cannot ask about it (404, never the data) — this is not a DNS probe for anyone\'s domain', r.status === 404);
who = { org: 'orgA', roles: ['bd'] };
r = await get('/org/domains/d1/email-setup');
step('a non-admin is refused', r.status === 403);
srv.close();

console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
