// ============================================================================
// OUTLOOK ATTACHMENTS OVER 3 MB (owner, 29 Oct 2026: "increase the limit to 5 MB").
//
// Microsoft Graph takes an attachment in one call only while it is under 3 MB. A bigger file must go through an upload
// session: ask Graph for an upload address, then PUT the bytes in pieces (each a multiple of 320 KiB). The upload address
// carries its own authorisation, so the PUTs are sent WITHOUT the sign-in header (Graph refuses them if it is there).
// Every file is attached to the DRAFT before the draft is sent, the same as the small path always did.
// ============================================================================
'use strict';
const { fetchWithTimeout } = require('../http-client');

const SIMPLE_MAX = 3 * 1024 * 1024 - 64 * 1024;      // a little under Graph's 3 MB, for the JSON around the bytes
const CHUNK = 320 * 1024 * 10;                         // 3.125 MiB — Graph wants multiples of 320 KiB

function bytesOf(a) { return Buffer.from(String(a.base64 || ''), 'base64'); }

async function addAttachment(graphMailRequest, token, messageId, a, { fetchFn = fetchWithTimeout } = {}) {
  const buf = bytesOf(a);
  const name = a.filename || 'attachment';
  const contentType = a.contentType || 'application/octet-stream';
  if (buf.length <= SIMPLE_MAX) {
    return graphMailRequest(token, `/me/messages/${messageId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ '@odata.type': '#microsoft.graph.fileAttachment', name, contentType, contentBytes: buf.toString('base64') }),
    });
  }
  const s = await graphMailRequest(token, `/me/messages/${messageId}/attachments/createUploadSession`, {
    method: 'POST',
    body: JSON.stringify({ AttachmentItem: { attachmentType: 'file', name, size: buf.length, contentType } }),
  });
  if (!s || !s.uploadUrl) throw new Error('Outlook did not open an upload for the attachment');
  for (let start = 0; start < buf.length; start += CHUNK) {
    const piece = buf.subarray(start, Math.min(start + CHUNK, buf.length));
    const res = await fetchFn(s.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(piece.length),
        'Content-Range': `bytes ${start}-${start + piece.length - 1}/${buf.length}` },
      body: piece,
    }, { timeoutMs: 60000 });
    if (!res.ok) throw new Error(`Outlook refused the attachment upload (${res.status})`);
  }
  return { ok: true };
}

async function addAttachments(graphMailRequest, token, messageId, attachments, opts) {
  for (const a of (attachments || [])) await addAttachment(graphMailRequest, token, messageId, a, opts);
}

// Small enough to ride inside the message itself (the create call)?
const allSmall = (attachments) => (attachments || []).every(a => bytesOf(a).length <= SIMPLE_MAX)
  && (attachments || []).reduce((n, a) => n + bytesOf(a).length, 0) <= SIMPLE_MAX;

module.exports = { addAttachment, addAttachments, allSmall, SIMPLE_MAX, CHUNK };
