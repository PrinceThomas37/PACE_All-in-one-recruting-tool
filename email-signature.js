/**
 * Per-mailbox HTML signatures (stored in app_settings as ue_{userEmailId}_signature_html).
 * Variables: {{sender}} = display name, {{senderemail}} = mailbox address.
 */

const SIGNATURE_POSTAL_ADDRESS = '8111 Lyndon B. Johnson Freeway, Suite 1340, Dallas, TX 75251';
const SIGNATURE_ADDRESS_HTML = `<p style="margin:0 0 3px;color:#555;font-size:12px">${SIGNATURE_POSTAL_ADDRESS}</p>`;

const DEFAULT_SIGNATURE_HTML = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;line-height:1.45"><p style="margin:0 0 3px"><strong>{{sender}}</strong></p><p style="margin:0 0 3px;color:#333">Recruitment Manager | <strong>Fute Global LLC</strong></p><p style="margin:0 0 3px;color:#333"><a href="mailto:{{senderemail}}" style="color:#1E7A3C;text-decoration:none">{{senderemail}}</a> | +1 (972)-452-6644 | <a href="https://www.futeglobal.com/" style="color:#1E7A3C;text-decoration:none">www.futeglobal.com</a></p>${SIGNATURE_ADDRESS_HTML}<p style="margin:0;color:#555;font-size:12px;font-style:italic">Making Recruitment Easier with Future Tech</p></div>`;

function mailboxSignatureKey(userEmailId) {
  return `ue_${userEmailId}_signature_html`;
}

function legacyUserSignatureKey(userId) {
  return `u_${userId}_signature_html`;
}

const SIGNATURE_TAGLINE = 'Making Recruitment Easier with Future Tech';
const LEGACY_SIGNATURE_TAGLINES = [
  'Staffing solutions for healthcare & enterprise',
  'Staffing solutions for healthcare &amp; enterprise'
];

function isLegacyBlockSignature(signatureHtml) {
  const html = String(signatureHtml || '');
  return /&#128231;|&#128222;|&#127760;|&#128205;/.test(html)
    || /border-right:3px solid #1E7A3C/.test(html);
}

function upgradeSignatureTagline(signatureHtml) {
  let html = String(signatureHtml || '');
  LEGACY_SIGNATURE_TAGLINES.forEach((oldTagline) => {
    html = html.split(oldTagline).join(SIGNATURE_TAGLINE);
  });
  return html.replace(
    /Staffing solutions for healthcare(?:\s*(?:&amp;|&)\s*)?enterprise/gi,
    SIGNATURE_TAGLINE
  );
}

function upgradeSignatureTitle(signatureHtml) {
  return String(signatureHtml || '')
    .replace(/BD Manager at Fute Global LLC/gi, 'Recruitment Manager at Fute Global LLC')
    .replace(/BD Manager \|/gi, 'Recruitment Manager |');
}

// The company postal address must appear in every outgoing email (CAN-SPAM).
// It lives in the signature — inject it into any saved signature that lacks it,
// just before the closing wrapper so it sits under the contact lines.
function ensureSignatureAddress(signatureHtml) {
  const html = String(signatureHtml || '');
  if (!html.trim()) return html;
  if (html.includes('75251')) return html; // address already present
  // A signature that already carries ANY postal address of its own (a built "sends as" signature, or one edited since — a
  // 5-digit ZIP is the tell) is never given Fute Global's Dallas address on top.
  if (html.includes(OWN_SIGNATURE_MARK) || /(?:^|[^\d])\d{5}(?:-\d{4})?(?:[^\d]|$)/.test(html.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\+?\d[\d\s().-]{8,}\d/g, ' '))) return html;
  const lastClose = html.lastIndexOf('</div>');
  if (lastClose !== -1) {
    return html.slice(0, lastClose) + SIGNATURE_ADDRESS_HTML + html.slice(lastClose);
  }
  return html + SIGNATURE_ADDRESS_HTML;
}

function fillSignatureHtml(signatureHtml, { displayName, emailAddress }) {
  const sender = displayName || '';
  const senderEmail = emailAddress || '';
  return String(signatureHtml || '')
    .replace(/{{sender}}/g, sender)
    .replace(/{{senderemail}}/g, senderEmail);
}

function resolveSignatureHtml(savedHtml) {
  const val = String(savedHtml || '').trim();
  if (!val) return DEFAULT_SIGNATURE_HTML;
  // A signature built from a mailbox's own "sends as" carries ITS company's address — never add Fute Global's (or rewrite its words).
  if (val.includes(OWN_SIGNATURE_MARK)) return val;
  if (isLegacyBlockSignature(val)) return DEFAULT_SIGNATURE_HTML;
  return ensureSignatureAddress(upgradeSignatureTitle(upgradeSignatureTagline(val)));
}

// ── "SENDS AS": who a MAILBOX writes for (owner, 8 Oct: a VP connected another company's mailbox and the emails said Fute Global) ──
// One small record per mailbox — the company it writes for, the title under the name, its postal address (the anti-spam law
// requires the sender's own), and optionally a phone and a website. Stored as JSON under ue_<id>_sends_as, beside the signature.
// A signature built from it carries OWN_SIGNATURE_MARK so nothing re-adds Fute Global's address or wording to it.
const OWN_SIGNATURE_MARK = '<!--pace-own-signature-->';
const sendsAsKey = (userEmailId) => `ue_${userEmailId}_sends_as`;
const SENDS_AS_LIMITS = { company: 80, title: 80, address: 200, phone: 40, website: 120 };
function cleanSendsAs(v) {
  const o = {};
  const src = v && typeof v === 'object' ? v : {};
  for (const k of Object.keys(SENDS_AS_LIMITS)) {
    const t = String(src[k] == null ? '' : src[k]).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SENDS_AS_LIMITS[k]);
    if (t) o[k] = t;
  }
  return o;
}
// What is missing, in words — company, title and address are required; phone and website are not.
function sendsAsProblem(s) {
  const c = cleanSendsAs(s);
  if (!c.company || c.company.length < 2) return 'Say which company this mailbox writes for.';
  if (!c.title) return 'Add the job title that goes under the name.';
  if (!c.address || c.address.length < 8) return 'Add the company\'s postal address — every outreach email must carry the sender\'s own.';
  return null;
}
const escHtml = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function siteHref(w) { const t = String(w || '').trim(); if (!t) return ''; return /^https?:\/\//i.test(t) ? t : 'https://' + t; }
// {{sender}} and {{senderemail}} stay merge fields (filled from the mailbox that sends, at send time, like every signature).
function signatureFromSendsAs(v) {
  const s = cleanSendsAs(v);
  const line = (html, last) => `<p style="margin:0 0 ${last ? 0 : 3}px;color:#333">${html}</p>`;
  const contact = [`<a href="mailto:{{senderemail}}" style="color:#1E7A3C;text-decoration:none">{{senderemail}}</a>`]
    .concat(s.phone ? [escHtml(s.phone)] : [])
    .concat(s.website ? [`<a href="${escHtml(siteHref(s.website))}" style="color:#1E7A3C;text-decoration:none">${escHtml(String(s.website).replace(/^https?:\/\//i, ''))}</a>`] : []);
  return `${OWN_SIGNATURE_MARK}<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;line-height:1.45">`
    + `<p style="margin:0 0 3px"><strong>{{sender}}</strong></p>`
    + line(`${escHtml(s.title || '')}${s.title && s.company ? ' | ' : ''}<strong>${escHtml(s.company || '')}</strong>`)
    + line(contact.join(' | '))
    + `<p style="margin:0;color:#555;font-size:12px">${escHtml(s.address || '')}</p></div>`;
}

module.exports = {
  OWN_SIGNATURE_MARK, sendsAsKey, SENDS_AS_LIMITS, cleanSendsAs, sendsAsProblem, signatureFromSendsAs,
  DEFAULT_SIGNATURE_HTML,
  SIGNATURE_POSTAL_ADDRESS,
  SIGNATURE_ADDRESS_HTML,
  mailboxSignatureKey,
  legacyUserSignatureKey,
  SIGNATURE_TAGLINE,
  isLegacyBlockSignature,
  upgradeSignatureTagline,
  upgradeSignatureTitle,
  ensureSignatureAddress,
  fillSignatureHtml,
  resolveSignatureHtml
};
