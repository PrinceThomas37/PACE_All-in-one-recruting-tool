// ============================================================================
// SMTP / IMAP PRESETS AND TARGET SAFETY — where a mailbox's mail servers are, and which servers PACE will agree to talk to
// (D-0120, R-200 step b).
// ----------------------------------------------------------------------------
// WHAT IT KNOWS. For a provider PACE recognises (the company setup checklist detects it from the MX records), the servers to try.
// Zoho's own help pages list two sets: smtp.zoho.com / imap.zoho.com for personal accounts and smtppro.zoho.com /
// imappro.zoho.com for business ones, and the same names under .in, .eu … for the other data centres — so BOTH are tried, business
// first, and the first one that signs in is the one kept. A provider PACE does not know has no guess: the person types the servers.
//
// WHAT IT REFUSES. A person types a server name, and PACE's server then connects to it. That is a way to make PACE knock on
// doors only PACE can reach (the database host, a cloud metadata address, an office network). So:
//   • only a real host NAME (never an IP address), only the mail ports (SMTP 465 / 587, IMAP 993), only encrypted connections;
//   • the name is looked up and EVERY address it answers with must be a public one;
//   • the connection is then made to that checked address (with the name kept for the certificate), so a name that answers
//     differently a moment later cannot swap in a private one.
//
// PURE apart from safeTarget(), whose DNS lookup is injectable.
// ============================================================================
'use strict';

const dns = require('dns').promises;

const SMTP_PORTS = [465, 587];
const IMAP_PORTS = [993];

// ── what to try ───────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The server pairs to try for a mailbox, best guess first.
 *   opts: { provider: 'zoho'|'google'|'microsoft'|'other', region?: 'com'|'in'|'eu'|…, typed?: { smtp_host, smtp_port, imap_host, imap_port } }
 * → [{ smtp: { host, port, secure }, imap: { host, port }, label }]   ([] = nothing to guess: the person must type the servers)
 */
function candidatesFor(opts) {
  const o = opts || {}, t = o.typed || {};
  if (t.smtp_host || t.imap_host) {
    const sp = Number(t.smtp_port) || 465, ip = Number(t.imap_port) || 993;
    return [{ smtp: { host: String(t.smtp_host || '').trim().toLowerCase(), port: sp, secure: sp === 465 }, imap: { host: String(t.imap_host || '').trim().toLowerCase(), port: ip }, label: 'the servers you typed' }];
  }
  const r = /^[a-z.]{2,8}$/.test(String(o.region || '')) ? o.region : 'com';
  if (o.provider === 'zoho') return [
    { smtp: { host: 'smtppro.zoho.' + r, port: 465, secure: true }, imap: { host: 'imappro.zoho.' + r, port: 993 }, label: 'Zoho (business)' },
    { smtp: { host: 'smtp.zoho.' + r, port: 465, secure: true }, imap: { host: 'imap.zoho.' + r, port: 993 }, label: 'Zoho (personal)' },
  ];
  if (o.provider === 'google') return [
    { smtp: { host: 'smtp.gmail.com', port: 465, secure: true }, imap: { host: 'imap.gmail.com', port: 993 }, label: 'Google' },
  ];
  // Microsoft 365 is NOT offered here: Microsoft is retiring password sign-in for sending, so it connects with its own sign-in.
  return [];
}

/** What the person has to do at their provider to get an app password — plain steps, said gently because menus get renamed. */
function guideFor(provider) {
  if (provider === 'zoho') return {
    title: 'Get an app password from Zoho',
    steps: [
      'Open Zoho Accounts (accounts.zoho.com — or accounts.zoho.in, .eu for your region) and go to Security → App Passwords.',
      'Choose "Generate New Password", name it PACE, and copy the password it shows (it is shown once).',
      'In Zoho Mail, open Settings → Mail Accounts and make sure IMAP Access is switched on for this mailbox.',
    ],
    note: 'App passwords need two-factor sign-in turned on in Zoho. Menu names can differ a little by plan.',
  };
  if (provider === 'google') return {
    title: 'Get an app password from Google',
    steps: [
      'Turn on 2-Step Verification for the Google account (Google Account → Security).',
      'Open Google Account → Security → 2-Step Verification → App passwords, create one named PACE, and copy it.',
    ],
    note: 'Some Google Workspace admins switch app passwords off. If yours has, use "Continue with Google" instead.',
  };
  return {
    title: 'Get an app password from your mail provider',
    steps: [
      'In your mail provider\'s security settings, create an "app password" (some call it an application-specific password) named PACE.',
      'Make sure IMAP access is switched on for the mailbox.',
      'Type the provider\'s mail servers below. They are on its "set up an email client" help page — outgoing (SMTP) and incoming (IMAP).',
    ],
    note: 'Use the app password, not your normal one. If your provider does not offer app passwords, ask them how to connect another app.',
  };
}

// ── target safety ─────────────────────────────────────────────────────────────────────────────────────────────────────
const HOST_OK = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Is this IPv4/IPv6 address one that is NOT public (private, loopback, link-local, carrier-grade NAT, multicast, reserved)? */
function isPrivateAddress(ip) {
  const s = String(ip || '').trim().toLowerCase();
  const m4 = s.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const [a, b] = [Number(m4[1]), Number(m4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && Number(m4[3]) === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (s.indexOf(':') >= 0) return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  return true;                                   // not an address we can read: never "public by default"
}

/** The port rules for a pair, said as a reason or null when fine. */
function portProblem(pair) {
  if (!pair || !pair.smtp || !pair.imap) return 'The mail servers are missing.';
  if (SMTP_PORTS.indexOf(Number(pair.smtp.port)) < 0) return 'Outgoing mail (SMTP) must use port 465 or 587 — PACE only connects over an encrypted link.';
  if (IMAP_PORTS.indexOf(Number(pair.imap.port)) < 0) return 'Incoming mail (IMAP) must use port 993 — PACE only connects over an encrypted link.';
  return null;
}

/**
 * Check a server NAME and resolve it to ONE public address to connect to.
 * `lookup(host) → [{ address, family }]` (injectable; the real one is dns.lookup with all:true).
 * → { ok:true, host, ip } or { ok:false, why }
 */
async function safeTarget(host, lookup) {
  const h = String(host || '').trim().toLowerCase();
  if (!HOST_OK.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return { ok: false, why: 'That is not a mail server name. Use a name like smtp.example.com, not an IP address.' };
  let addrs;
  try { addrs = await (lookup ? lookup(h) : dns.lookup(h, { all: true })); } catch (_) { return { ok: false, why: 'Could not find ' + h + '. Check the spelling.' }; }
  if (!addrs || !addrs.length) return { ok: false, why: 'Could not find ' + h + '. Check the spelling.' };
  if (addrs.some((a) => isPrivateAddress(a.address))) return { ok: false, why: h + ' points to a private address, so PACE will not connect to it.' };
  return { ok: true, host: h, ip: addrs[0].address };
}

module.exports = { SMTP_PORTS, IMAP_PORTS, candidatesFor, guideFor, isPrivateAddress, portProblem, safeTarget, HOST_OK };
