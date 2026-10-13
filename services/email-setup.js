// ============================================================================
// COMPANY EMAIL SETUP — the checklist a customer's admin (and their IT person) works through before staff connect mailboxes
// (owner, 12 Oct 2026, D-0120, R-200).
// ----------------------------------------------------------------------------
// WHY. A company's mail only reaches inboxes (not spam) when its domain publishes three small DNS records, and which records
// depend on where its mail lives (Google, Microsoft, Zoho, or somewhere else). The records live at the customer's DNS host,
// so PACE cannot add them — it can only say EXACTLY what to add, and CHECK that each one worked. The owner's rule: PACE shows
// the admin a checklist with the exact values to paste and checks each one; their IT person does it.
//
// WHAT IS HONEST HERE.
//   • DKIM keys are made by the mail provider's own console, so PACE cannot print the key. It says where to switch it on, then
//     looks for the record the provider publishes (and takes a selector the admin types when the provider used a custom one).
//   • Only ONE SPF record may exist on a domain. If there is one already, the advice is to ADD a piece to it, never a second.
//   • DMARC starts at p=none (watch only). That is a real, accepted start, so it counts as done.
//   • A way of connecting that is not built yet is SAID not to be built (opts.smtpAvailable) — a screen must not advertise it.
//
// PURE apart from makeResolver(): every lookup goes through an injected resolver { mx, txt, cname }, so a test needs no network.
// ============================================================================
'use strict';

const dns = require('dns').promises;

// ── mail providers, recognised by where the domain's MX records point ─────────────────────────────────────────────────
const ZOHO_MX = /(^|\.)zoho\.(com\.au|com|in|eu|jp|sa|ca)\.?$/i;
const PROVIDERS = {
  google: {
    label: 'Google Workspace', connect: 'oauth', spfInclude: 'include:_spf.google.com', dkimSelectors: ['google'],
    dkimWhere: 'Google Admin console → Apps → Google Workspace → Gmail → Authenticate email → Generate new record, then add the TXT record it shows and press Start authentication.',
  },
  microsoft: {
    label: 'Microsoft 365', connect: 'oauth', spfInclude: 'include:spf.protection.outlook.com', dkimSelectors: ['selector1', 'selector2'],
    dkimWhere: 'Microsoft Defender portal → Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM → pick the domain → Create DKIM keys, then add the two CNAME records it shows.',
  },
  zoho: {
    label: 'Zoho Mail', connect: 'smtp', spfInclude: 'include:zoho.com', dkimSelectors: ['zoho', 'zmail'],
    dkimWhere: 'Zoho Mail Admin Console → Domains → your domain → Email Configuration → DKIM → Add selector, then add the TXT record it shows and press Verify.',
  },
  other: {
    label: 'another mail provider', connect: 'smtp', spfInclude: null, dkimSelectors: [],
    dkimWhere: 'your mail provider\'s admin console (look for "DKIM" or "Email authentication"), then add the record it shows.',
  },
};

function tidyHost(h) { return String(h || '').toLowerCase().replace(/\.$/, '').trim(); }

/**
 * Which provider a domain's mail is on, from its MX hostnames. [] or unknown hosts → 'other'.
 * Zoho runs in several regions; its SPF include follows the region of its MX (zoho.in for India, zoho.eu for Europe…).
 */
function detectProvider(mxHosts) {
  const hosts = (mxHosts || []).map(tidyHost).filter(Boolean);
  const has = (re) => hosts.some((h) => re.test(h));
  if (has(/(^|\.)(google\.com|googlemail\.com)$/)) return { key: 'google', ...PROVIDERS.google, mx: hosts };
  if (has(/\.mail\.protection\.outlook\.com$/) || has(/(^|\.)outlook\.com$/)) return { key: 'microsoft', ...PROVIDERS.microsoft, mx: hosts };
  const z = hosts.map((h) => h.match(ZOHO_MX)).find(Boolean);
  if (z) { const region = z[2].toLowerCase(); return { key: 'zoho', ...PROVIDERS.zoho, spfInclude: 'include:zoho.' + region, region, mx: hosts }; }
  return { key: 'other', ...PROVIDERS.other, mx: hosts };
}

// ── SPF ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The SPF record to publish: a new one, or the person's existing one with the provider's piece added (never a second record). */
function suggestedSpf(existing, provider) {
  const inc = provider && provider.spfInclude;
  if (!existing) return inc ? 'v=spf1 ' + inc + ' ~all' : null;
  if (!inc || existing.indexOf(inc) >= 0) return existing;
  const m = existing.match(/\s([~\-+?]all)\s*$/i);
  return m ? existing.slice(0, m.index) + ' ' + inc + ' ' + m[1] : existing.trim() + ' ' + inc;
}
function checkSpf(records, provider) {
  const spfs = (records || []).filter((r) => /^v=spf1(\s|$)/i.test(String(r).trim()));
  if (!spfs.length) return { ok: false, found: false, why: 'No SPF record yet.', value: suggestedSpf(null, provider), replace: false };
  if (spfs.length > 1) return { ok: false, found: true, why: 'This domain has more than one SPF record. Only one is allowed — mail providers treat two as none. Merge them into one.', value: suggestedSpf(spfs[0], provider), replace: true };
  const have = spfs[0].trim();
  if (provider && provider.spfInclude && have.indexOf(provider.spfInclude) < 0) return { ok: false, found: true, why: 'The SPF record does not include ' + provider.label + '. Change the existing record — do not add a second one.', value: suggestedSpf(have, provider), replace: true };
  return { ok: true, found: true, why: 'SPF is in place.', value: have, replace: false };
}

// ── DMARC ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function dmarcStarter(domain) { return 'v=DMARC1; p=none; rua=mailto:dmarc@' + domain; }
function checkDmarc(records, domain) {
  const rec = (records || []).map((r) => String(r).trim()).find((r) => /^v=DMARC1/i.test(r));
  if (!rec) return { ok: false, found: false, why: 'No DMARC record yet.', value: dmarcStarter(domain) };
  const p = ((rec.match(/;\s*p=(none|quarantine|reject)/i) || [])[1] || '').toLowerCase();
  if (!p) return { ok: false, found: true, why: 'The DMARC record has no policy (p=).', value: dmarcStarter(domain) };
  return { ok: true, found: true, policy: p, why: p === 'none' ? 'DMARC is in place and watching (p=none). That is the right start; tighten it later, once reports look clean.' : 'DMARC is in place (p=' + p + ').', value: rec };
}

// ── DKIM ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function checkDkim(domain, provider, resolver, customSelector) {
  const selectors = []; const add = (s) => { s = String(s || '').trim().toLowerCase(); if (/^[a-z0-9][a-z0-9_-]{0,62}$/.test(s) && selectors.indexOf(s) < 0) selectors.push(s); };
  add(customSelector); (provider.dkimSelectors || []).forEach(add);
  if (!selectors.length) ['default', 'dkim', 'mail', 'k1', 's1', 's2'].forEach(add);       // a provider we do not know: the common ones
  for (const sel of selectors) {
    const name = sel + '._domainkey.' + domain;
    const c = await resolver.cname(name);
    if (c && c.length) return { ok: true, found: true, selector: sel, why: 'DKIM is published (selector "' + sel + '").' };
    const t = await resolver.txt(name);
    if (t && t.some((r) => /v=DKIM1|(^|;)\s*p=/i.test(r))) return { ok: true, found: true, selector: sel, why: 'DKIM is published (selector "' + sel + '").' };
  }
  return { ok: false, found: false, tried: selectors, why: 'No DKIM record found at ' + selectors.map((s) => '"' + s + '"').join(', ') + '.' };
}

// ── the checklist ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The whole checklist for one claimed domain.
 *   row:  { domain, verified_at, auto_join }   (an org_domains row)
 *   opts: { resolver, dkimSelector?, smtpAvailable? }
 * → { domain, provider:{key,label,connect}, items:[{ id, title, status, summary, record?, steps? }], done, total, it_text }
 * status: 'done' | 'todo' | 'info'.
 */
async function buildChecklist(row, opts) {
  const o = opts || {}, resolver = o.resolver, domain = row.domain;
  const [mx, spfTxt, dmarcTxt] = await Promise.all([resolver.mx(domain), resolver.txt(domain), resolver.txt('_dmarc.' + domain)]);
  const provider = detectProvider(mx);
  const dkim = await checkDkim(domain, provider, resolver, o.dkimSelector);
  const spf = checkSpf(spfTxt, provider);
  const dmarc = checkDmarc(dmarcTxt, domain);

  const items = [];
  items.push({ id: 'ownership', title: 'Prove the domain is yours', status: row.verified_at ? 'done' : 'todo',
    summary: row.verified_at ? domain + ' is verified. People with an address here are recognised as yours.' : 'Add the verification record shown above on the domain list, then press Verify.' });

  items.push({ id: 'provider', title: 'Where your mail lives', status: mx.length ? 'done' : 'todo',
    summary: mx.length ? 'Your mail is on ' + provider.label + (provider.key === 'zoho' ? ' (region ' + provider.region + ')' : '') + '. Found from the domain\'s mail records (MX).'
      : 'No mail records (MX) were found for ' + domain + '. If the domain has no mailboxes yet, set them up first.' });

  items.push({ id: 'spf', title: 'SPF — who may send as your domain', status: spf.ok ? 'done' : 'todo', summary: spf.why,
    record: spf.ok ? null : (spf.value ? { type: 'TXT', host: '@', value: spf.value, replaces: spf.replace } : null),
    steps: spf.ok || spf.value ? null : ['Your mail provider is not one PACE knows, so ask them for the exact SPF record for sending from ' + domain + '.'] });

  items.push({ id: 'dkim', title: 'DKIM — a signature that proves the mail is yours', status: dkim.ok ? 'done' : 'todo', summary: dkim.why,
    steps: dkim.ok ? null : ['The key is made by your mail provider, so PACE cannot print it. Switch it on in ' + provider.dkimWhere, 'If your provider used its own selector name, type it below and press Check again.'] });

  items.push({ id: 'dmarc', title: 'DMARC — what to do with mail that fails the checks', status: dmarc.ok ? 'done' : 'todo', summary: dmarc.why,
    record: dmarc.ok ? null : { type: 'TXT', host: '_dmarc', value: dmarc.value, replaces: false } });

  const smtp = provider.connect === 'smtp';
  items.push({ id: 'connect', title: 'How your staff connect their mailboxes', status: 'info',
    summary: smtp
      ? (o.smtpAvailable ? 'Each person connects with an app password from ' + provider.label + '. PACE shows them how.'
        : 'Each person will connect with an app password from ' + provider.label + '. That connection is still being built, so ' + provider.label + ' mailboxes cannot be connected yet.')
      : 'Each person signs in with ' + provider.label + ' and approves PACE. Nothing to set up here.' });

  items.push({ id: 'staff', title: 'Let your people in', status: row.auto_join ? 'done' : 'todo',
    summary: row.auto_join ? 'Anyone who signs in with an address on ' + domain + ' joins automatically.' : 'Switch on "Auto-join" for ' + domain + ' (domain list above), or invite people one by one.' });

  const countable = items.filter((i) => i.status !== 'info');
  const done = countable.filter((i) => i.status === 'done').length;
  const out = { domain, provider: { key: provider.key, label: provider.label, connect: provider.connect, region: provider.region || null }, items, done, total: countable.length };
  out.it_text = itText(out);
  return out;
}

/** A plain note the admin can paste into an email to their IT person: only what is still to do, with the exact records. */
function itText(c) {
  const todo = c.items.filter((i) => i.status === 'todo' && (i.record || i.steps));
  if (!todo.length) return 'Nothing is left to change on ' + c.domain + ' — every record PACE checks is in place.';
  const lines = ['Hello — to let PACE send email for ' + c.domain + ' without it landing in spam, please make these DNS changes at the place the domain is managed:', ''];
  let n = 0;
  todo.forEach((i) => {
    n += 1; lines.push(n + '. ' + i.title);
    if (i.record) {
      lines.push('   Type: ' + i.record.type, '   Host/Name: ' + i.record.host, '   Value: ' + i.record.value);
      if (i.record.replaces) lines.push('   (This replaces the existing record of the same kind — a domain may have only one SPF record.)');
    }
    (i.steps || []).forEach((s) => lines.push('   - ' + s));
    lines.push('');
  });
  lines.push('Once done, the admin presses "Check again" in PACE and each item turns green. Records can take up to an hour to appear.');
  return lines.join('\n');
}

// ── the only impure part: real DNS, every lookup bounded and never throwing ──────────────────────────────────────────
function makeResolver(timeoutMs) {
  const ms = timeoutMs || 4000;
  const guard = (p) => Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
  return {
    mx: async (d) => { const r = await guard(dns.resolveMx(d)); return r ? r.sort((a, b) => a.priority - b.priority).map((x) => x.exchange) : []; },
    txt: async (n) => { const r = await guard(dns.resolveTxt(n)); return r ? r.map((c) => c.join('')) : []; },
    cname: async (n) => { const r = await guard(dns.resolveCname(n)); return r || []; },
  };
}

module.exports = { PROVIDERS, detectProvider, suggestedSpf, checkSpf, checkDmarc, checkDkim, dmarcStarter, buildChecklist, itText, makeResolver };
