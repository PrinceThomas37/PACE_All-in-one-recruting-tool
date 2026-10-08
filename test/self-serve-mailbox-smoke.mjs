// ANY USER SETS UP THEIR OWN OUTREACH MAILBOX, AND SAYS WHO IT WRITES FOR (owner, 8 Oct 2026)
//   "right now only admin can add an outreach mailbox to a user — can the user themselves set it up?" and
//   "a VP connected another company's mailbox and the emails said Fute Global, with the wrong title and signature".
//   * a person adds a mailbox for THEMSELVES (not for anyone else); the daily limit and "primary" stay with admins
//   * a self-serve mailbox must say its company, title and postal address — nothing goes out under another company by default
//   * what it says builds a signature that never gets Fute Global's Dallas address or wording
//   * the mailbox's own person may connect / disconnect it (Microsoft and Gmail sign-in), nobody else's; an admin may any in the org
//   * who may change what: limits admin-only, sends-as by the owner or an admin
// Usage: node test/self-serve-mailbox-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-self-serve';
const express = require('express');
const jwt = require('jsonwebtoken');
const sig = require('../email-signature.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── a small in-memory database ─────────────────────────────────────────────────────────────────────────
const T = {
  organizations: [{ id: 'o1', name: 'Fute Global LLC', plan: 'internal' }, { id: 'o2', name: 'Other Co', plan: 'internal' }],
  users: [{ id: 'adm', org_id: 'o1', roles: ['admin'], designation: 'Director' }, { id: 'ra1', org_id: 'o1', roles: ['ra'], designation: 'Research Analyst' }, { id: 'bd1', org_id: 'o1', roles: ['bd'] }, { id: 'x1', org_id: 'o2', roles: ['admin'] }],
  user_emails: [{ id: 'mAdm', user_id: 'adm', org_id: 'o1', email_address: 'adm@fute.test', is_active: true }, { id: 'mBd', user_id: 'bd1', org_id: 'o1', email_address: 'bd@fute.test', is_active: true }],
  app_settings: [], microsoft_tokens: [], gmail_tokens: [],
};
let uid = 0;
function from(name) {
  let mode = 'select', filters = [], row = null, patch = null, one = false, cols = null, hd = false;
  const rows = () => (T[name] || []).filter((r) => filters.every((f) => f(r)));
  const q = {
    select(c, o) { cols = c; hd = !!(o && o.head); return q; },
    eq(c, v) { filters.push((r) => r[c] === v); return q; },
    in(c, l) { filters.push((r) => l.includes(r[c])); return q; },
    is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
    neq(c, v) { filters.push((r) => r[c] !== v); return q; },
    order() { return q; }, limit() { return q; },
    insert(r) { mode = 'insert'; row = r; return q; },
    update(p) { mode = 'update'; patch = p; return q; },
    upsert(r) { mode = 'upsert'; row = r; return q; },
    delete() { mode = 'delete'; return q; },
    single() { one = 'single'; return q; }, maybeSingle() { one = 'maybe'; return q; },
    then(res, rej) {
      let out;
      T[name] = T[name] || [];
      if (mode === 'insert') { const r = Object.assign({ id: 'new' + (++uid) }, row); T[name].push(r); out = { data: r, error: null }; }
      else if (mode === 'upsert') { for (const r of [].concat(row)) { const i = T[name].findIndex((x) => x.key === r.key); if (i >= 0) Object.assign(T[name][i], r); else T[name].push({ ...r }); } out = { data: null, error: null }; }
      else if (mode === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); out = { data: one ? hit[0] || null : hit, error: null }; }
      else if (mode === 'delete') { const hit = new Set(rows()); T[name] = T[name].filter((r) => !hit.has(r)); out = { data: null, error: null }; }
      else { const d = rows(); out = hd ? { count: d.length, data: null, error: null } : { data: one ? d[0] || null : d, error: null }; }
      return Promise.resolve(out).then(res, rej);
    },
  };
  return q;
}
const supabase = { from };
const roleOf = (req) => (req.user && req.user.roles) || [];
const hasRole = (req, ...r) => roleOf(req).some((x) => r.includes(x));
const orgIdFor = (req) => (req.orgId || (req.user && req.user.org_id)) || null;
const auth = (req, res, next) => {
  const h = (req.headers.authorization || '').replace('Bearer ', '');
  try { const u = jwt.verify(h, process.env.JWT_SECRET); req.user = u; req.orgId = u.org_id; next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
};
const tokenFor = (id) => { const u = T.users.find((x) => x.id === id); return jwt.sign({ id, org_id: u.org_id, roles: u.roles, role: u.roles[0] }, process.env.JWT_SECRET); };

const ctx = { supabase, auth, hasRole, orgIdFor, loadMailboxSignatures: async () => ({}), today: () => '2026-10-08', getMailboxSignature: async (id) => (T.app_settings.find((x) => x.key === 'ue_' + id + '_signature_html') || {}).value || '', getMicrosoftToken: async () => null, buildHtmlEmailBody: (b) => b,
  MS_TENANT: 'common', MS_CLIENT: 'cid', MS_SECRET: 's', MS_REDIRECT: 'http://localhost/cb', MS_SCOPES: 'Mail.Send',
  provider: { isConfigured: () => true, authorizeUrl: (s) => 'https://accounts.google.com/o/oauth2/auth?state=' + s } };
const app = express(); app.use(express.json());
app.use(require('../routes/auth.js')(ctx));
app.use(require('../routes/microsoft.js')(ctx));
app.use(require('../routes/gmail.js')(ctx));
const mbOf = (req, id) => { const l = T.user_emails.filter((m) => m.user_id === req.user.id && m.is_active !== false); return id ? l.find((m) => m.id === id) || null : (l.find((m) => m.is_primary) || l[0] || null); };
app.use(require('../routes/outreach-generator.js')({ ...ctx, loadSuppressedSet: async () => new Set(), recruiterSendingMailbox: async () => null, sendMailboxNewMessage: async () => ({}),
  sendingMailboxFor: async (req, id) => mbOf(req, id), ownSendingMailboxes: async (req) => T.user_emails.filter((m) => m.user_id === req.user.id), withOrg: (q) => q, orgStamp: () => ({}), logActivity: async () => {}, wfEngine: null, canTouchJob: async () => true }));
const server = http.createServer(app);
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const base = `http://127.0.0.1:${port}`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + tokenFor(who) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (_) { /* a redirect or text */ }
  return { code: r.status, out: json, loc: r.headers.get('location') };
};
const SA = { company: 'Acme Talent LLC', title: 'Vice President', address: '12 Market St, Austin, TX 78701', phone: '+1 512 555 0100', website: 'acmetalent.com' };
const setting = (k) => (T.app_settings.find((x) => x.key === k) || {}).value;

console.log('\nA person adds their OWN mailbox');
let r = await call('POST', '/users/ra1/emails', 'ra1', { email_address: 'Ra@Acme.test', display_name: 'Rob Ra', platform: 'Microsoft', daily_send_limit: 500, is_primary: true, sends_as: SA });
const mine = T.user_emails.find((x) => x.email_address === 'ra@acme.test');
step('an ordinary person can add a mailbox for themselves (201)', r.code === 201 && mine && mine.user_id === 'ra1', JSON.stringify(r.out).slice(0, 120));
step('…but the daily limit starts at the default (they asked for 500) and it is not "primary" (admin choices)', mine.daily_send_limit === 150 && mine.is_primary === false);
step('what it writes for is kept with the mailbox', JSON.parse(setting('ue_' + mine.id + '_sends_as')).company === 'Acme Talent LLC');
const built = setting('ue_' + mine.id + '_signature_html');
step('a signature is built from it: their name field, title, company, address — and nothing of Fute Global', /Vice President/.test(built) && /Acme Talent LLC/.test(built) && /Market St/.test(built) && /\{\{sender\}\}/.test(built) && !/Fute|75251|futeglobal|452-6644/.test(built));
step('…and sending resolves that signature untouched (no Fute Global address is added on top, no wording rewritten)', sig.resolveSignatureHtml(built) === built);
const edited = built.replace('<!--pace-own-signature-->', '');
step('…even after an edit that dropped the hidden marker (the postal ZIP in it is the tell)', sig.resolveSignatureHtml(edited) === edited && !/75251/.test(sig.resolveSignatureHtml(edited)));
step('an old signature with no address of its own still gets the organisation\'s, as before (nothing changed for existing mailboxes)', /75251/.test(sig.resolveSignatureHtml('<div>Jo | Fute Global LLC</div>')));
r = await call('POST', '/users/bd1/emails', 'ra1', { email_address: 'x@acme.test', sends_as: SA });
step('they cannot add a mailbox for somebody else (403)', r.code === 403);
r = await call('POST', '/users/ra1/emails', 'ra1', { email_address: 'nosay@acme.test', display_name: 'N' });
step('a self-serve mailbox that does not say who it writes for is refused, in words', r.code === 400 && /company/i.test(r.out.error) && !T.user_emails.some((x) => x.email_address === 'nosay@acme.test'), JSON.stringify(r.out));
r = await call('POST', '/users/ra1/emails', 'ra1', { email_address: 'noaddr@acme.test', sends_as: { company: 'Acme', title: 'VP' } });
step('…and one with no postal address is refused too (every outreach email must carry the sender\'s own)', r.code === 400 && /postal address/.test(r.out.error));
r = await call('POST', '/users/bd1/emails', 'adm', { email_address: 'admin-added@fute.test', display_name: 'BD', daily_send_limit: 300 });
const adminAdded = T.user_emails.find((x) => x.email_address === 'admin-added@fute.test');
step('an admin adding a mailbox for someone still can (no sends-as needed, their limit honoured) — nothing existing broke', r.code === 201 && adminAdded.daily_send_limit === 300);
r = await call('POST', '/users/x1/emails', 'adm', { email_address: 'foreign@x.test', sends_as: SA });
step('nobody can add one in another organisation (404)', r.code === 404);

{ const org = T.organizations[0]; org.plan = 'free';
  const wall = await call('POST', '/users/bd1/emails', 'adm', { email_address: 'wall@fute.test', sends_as: SA });
  step('on a plan with no room for another mailbox the answer is the plan limit, in words (402) — the screen shows that message', wall.code === 402 && /plan/i.test(wall.out.message || wall.out.error || ''), JSON.stringify(wall.out).slice(0, 120));
  org.plan = 'internal'; }

console.log('\nWho may change what');
r = await call('PATCH', `/users/ra1/emails/${mine.id}`, 'ra1', { daily_send_limit: 500 });
step('a person cannot raise their own daily limit (403)', r.code === 403 && T.user_emails.find((x) => x.id === mine.id).daily_send_limit === 150);
r = await call('PATCH', `/users/ra1/emails/${mine.id}`, 'adm', { daily_send_limit: 200 });
step('an admin can (200)', r.code === 200 && T.user_emails.find((x) => x.id === mine.id).daily_send_limit === 200);
r = await call('PATCH', `/users/ra1/emails/${mine.id}`, 'ra1', { display_name: 'Robert Ra' });
step('they can rename their own mailbox\'s display name', r.code === 200 && T.user_emails.find((x) => x.id === mine.id).display_name === 'Robert Ra');
r = await call('PUT', `/users/ra1/emails/${mine.id}/sends-as`, 'bd1', SA);
step('somebody else cannot change what their mailbox says (403)', r.code === 403);
r = await call('PUT', `/users/ra1/emails/${mine.id}/sends-as`, 'ra1', { ...SA, title: 'Managing Director' });
step('the owner can (200); their saved signature is KEPT (it may be hand-edited), the record updates', r.code === 200 && r.out.signature_rebuilt === false && JSON.parse(setting('ue_' + mine.id + '_sends_as')).title === 'Managing Director' && /Vice President/.test(setting('ue_' + mine.id + '_signature_html')));
r = await call('PUT', `/users/ra1/emails/${mine.id}/sends-as`, 'ra1', { ...SA, title: 'Managing Director', rebuild_signature: true });
step('"rebuild the signature from this" rewrites it', r.out.signature_rebuilt === true && /Managing Director/.test(setting('ue_' + mine.id + '_signature_html')));
r = await call('PUT', `/users/ra1/emails/${mine.id}/sends-as`, 'ra1', { company: '' });
step('an incomplete answer is refused in words and changes nothing', r.code === 400 && JSON.parse(setting('ue_' + mine.id + '_sends_as')).company === 'Acme Talent LLC');
r = await call('PUT', `/users/ra1/emails/mBd/sends-as`, 'ra1', SA);
step('a mailbox that is not theirs cannot be reached through their own id (404)', r.code === 404);
r = await call('GET', '/users/ra1/emails', 'ra1');
const listed = Array.isArray(r.out) && r.out.find((x) => x.id === mine.id);
step('the list says who each mailbox writes for and whether it has a signature of its own', listed && listed.sends_as && listed.sends_as.company === 'Acme Talent LLC' && listed.has_own_signature === true, JSON.stringify(listed).slice(0, 160));
step('a mailbox that says nothing is listed as such (not set)', (await call('GET', '/users/adm/emails', 'adm')).out[0].sends_as === null);

console.log('\nWhat the AI writes under');
r = await call('GET', `/outreach/sender?mailbox_id=${mine.id}`, 'ra1');
step('a mailbox that says who it writes for: the AI draft uses ITS company and title (not the organisation\'s and not the profile\'s)', r.code === 200 && r.out.company_name === 'Acme Talent LLC' && r.out.sender.title === 'Managing Director' && r.out.sender.company === 'Acme Talent LLC', JSON.stringify(r.out && { c: r.out.company_name, s: r.out.sender }));
r = await call('GET', '/outreach/sender?mailbox_id=mAdm', 'adm');
step('a mailbox that says nothing behaves exactly as before: the organisation\'s name and the profile\'s title', r.code === 200 && r.out.company_name === 'Fute Global LLC' && r.out.sender.title === 'Director' && !r.out.sender.company, JSON.stringify(r.out && { c: r.out.company_name, s: r.out.sender }));
r = await call('GET', `/outreach/sender?mailbox_id=${mine.id}`, 'ra1');
step('the signature the page shows for it is the one built from what it says — filled with the mailbox\'s own name and address, nothing of Fute Global', /Managing Director/.test(r.out.signature_html || '') && /Robert Ra/.test(r.out.signature_html) && /ra@acme\.test/.test(r.out.signature_html) && !/Fute|75251/.test(r.out.signature_html), (r.out.signature_html || '').slice(0, 120));

console.log('\nConnecting a mailbox (sign-in)');
const q = (id, who) => `/auth/microsoft/connect?userEmailId=${id}&token=${tokenFor(who)}`;
r = await call('GET', q(mine.id, 'ra1'));
step('Microsoft: the mailbox\'s own person is sent on to sign in', r.code === 302 && /login\.microsoftonline\.com/.test(r.loc || ''), r.code + ' ' + (r.loc || ''));
r = await call('GET', q('mBd', 'ra1'));
step('Microsoft: somebody else\'s mailbox is refused (403) and no sign-in state is made', r.code === 403 && !r.loc);
r = await call('GET', q('mBd', 'adm'));
step('Microsoft: an admin can still connect any mailbox in the organisation', r.code === 302);
r = await call('GET', q(mine.id, 'x1'));
step('Microsoft: another organisation\'s admin gets "not found", never the mailbox', r.code === 404);
r = await call('GET', `/auth/google/connect?userEmailId=${mine.id}&token=${tokenFor('ra1')}`);
step('Gmail: the own person is sent on to sign in', r.code === 302 && /accounts\.google\.com/.test(r.loc || ''));
r = await call('GET', `/auth/google/connect?userEmailId=mBd&token=${tokenFor('ra1')}`);
step('Gmail: somebody else\'s is refused (403)', r.code === 403 && !r.loc);
T.microsoft_tokens.push({ user_email_id: mine.id, user_id: 'ra1' });
r = await call('DELETE', `/auth/microsoft/mBd`, 'ra1');
step('a person cannot disconnect somebody else\'s mailbox (403), and its sign-in stays', r.code === 403);
r = await call('DELETE', `/auth/microsoft/${mine.id}`, 'ra1');
step('they can disconnect their own (200) — the sign-in is removed', r.code === 200 && !T.microsoft_tokens.some((x) => x.user_email_id === mine.id));

server.close();
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
