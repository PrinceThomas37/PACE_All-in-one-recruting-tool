// Reading a stored file back out of the private bucket, patiently.
//
// The résumé used to reach the screen as a signed link made while the document
// list loaded; when that one call hiccuped the link came back empty, the list
// showed no résumé, and it took several page refreshes to get one (R-091). The
// bytes are now fetched by an endpoint that asks the bucket up to `attempts`
// times before it gives up, and says plainly which kind of "no" it got.
//
// Returns { ok:true, buffer } or { ok:false, missing:boolean }. `missing` means
// the bucket answered "no such file" (do not retry, do not call it temporary);
// anything else is a temporary failure the caller may report as "try again".

const MISSING = /not.?found|no such|does not exist|404/i;

async function fetchStored(storage, bucket, path, opts) {
  const attempts = Math.max(1, (opts && opts.attempts) || 3);
  const wait = (opts && typeof opts.wait === 'function') ? opts.wait : (ms => new Promise(r => setTimeout(r, ms)));
  let missing = false;
  for (let i = 0; i < attempts; i++) {
    try {
      const { data, error } = await storage.from(bucket).download(path);
      if (!error && data) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(await data.arrayBuffer());
        if (buffer.length) return { ok: true, buffer };
      }
      if (error && MISSING.test(String(error.message || error.statusCode || error.error || ''))) {
        missing = true;
        break;
      }
    } catch (e) {
      if (MISSING.test(String(e && e.message))) { missing = true; break; }
    }
    if (i < attempts - 1) await wait(250 * (i + 1));
  }
  return { ok: false, missing };
}

// Content type for a stored document: what was recorded at upload, else the
// extension, else a download-only default.
function docContentType(doc) {
  const t = doc && doc.content_type;
  if (t && t !== 'application/octet-stream') return t;
  const n = String((doc && doc.filename) || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (n.endsWith('.doc')) return 'application/msword';
  if (n.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

module.exports = { fetchStored, docContentType };
