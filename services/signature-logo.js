// ============================================================================
// A SIGNATURE LOGO — what may be uploaded, and where it lives (owner, 8 Oct 2026, D-0104).
// PURE: checks the bytes and names the file. The logo is shown in outgoing mail by ADDRESS (an <img> pointing at PACE's own public
// logo bucket) — never embedded in the email: mail clients drop pasted images, and putting one in every message would mean changing
// every send path. The bucket is public on purpose (a recipient's mail client must be able to fetch it) and holds nothing else.
// ============================================================================
const crypto = require('crypto');
const BUCKET = 'signature-logos';
const MAX_BYTES = 200 * 1024;

/** Look at the first bytes, never at what the sender claims the file is. */
function sniff(buf) {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 6 && buf.slice(0, 3).toString('latin1') === 'GIF') return { ext: 'gif', type: 'image/gif' };
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

/** base64 text (with or without a data: prefix) → { buf, ext, type, version } or { error } in words. */
function check(base64) {
  const raw = String(base64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!raw) return { error: 'Choose an image first.' };
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) return { error: 'That is not an image file.' };
  const buf = Buffer.from(raw, 'base64');
  if (buf.length > MAX_BYTES) return { error: `That logo is ${Math.round(buf.length / 1024)} KB — the most is ${MAX_BYTES / 1024} KB. Use a smaller picture.` };
  const kind = sniff(buf);
  if (!kind) return { error: 'The logo must be a PNG, JPEG, GIF or WEBP picture.' };
  return { buf, ext: kind.ext, type: kind.type, version: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8) };
}

/** Where a mailbox's logo lives in the bucket. One file per mailbox per type, under its organisation. */
const pathFor = (orgId, mailboxId, ext) => `${orgId || 'org'}/${mailboxId}.${ext}`;

module.exports = { BUCKET, MAX_BYTES, check, pathFor, sniff };
