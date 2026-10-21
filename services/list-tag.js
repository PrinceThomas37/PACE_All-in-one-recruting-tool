'use strict';
// "HAS ANYTHING CHANGED SINCE MY LAST LOAD?" (R-302, owner 21 Oct: "do this").
//
// Every open tab re-asks for the whole lead list every 3 minutes, and nearly always nothing has changed. The list now carries a
// tag (an HTTP ETag) that names exactly what the caller was sent: the content of the company's list plus who is asking and what
// they may see. The browser sends the tag back; when it still matches, the server answers "not changed" (304) with no body —
// nothing is scoped, serialised or sent, and the screen is not redrawn.
//
// Whole-list, not per-row: a lead's contacts, company name or deletion change what the list shows without always stamping the
// lead itself, so "rows changed since T" would silently miss edits. A tag over the whole content cannot.
const crypto = require('crypto');

const seen = new WeakMap();   // the cached list array -> its content hash (computed once per cache refill, not per request)

function contentHash(rows) {
  if (rows && typeof rows === 'object') {
    const have = seen.get(rows);
    if (have) return have;
  }
  const h = crypto.createHash('sha1').update(JSON.stringify(rows == null ? null : rows)).digest('hex').slice(0, 16);
  if (rows && typeof rows === 'object') seen.set(rows, h);
  return h;
}

/** The tag for one caller's view of a list: same content + same viewer + same scope → same tag. */
function tagFor(rows, viewer) {
  const v = crypto.createHash('sha1').update(JSON.stringify(viewer == null ? null : viewer)).digest('hex').slice(0, 12);
  return 'W/"l-' + contentHash(rows) + '-' + v + '"';
}

/** true when the request already holds this tag (If-None-Match may list several, or be *). */
function stillFresh(req, tag) {
  const h = req && req.headers && req.headers['if-none-match'];
  if (!h || !tag) return false;
  return String(h).split(',').map(s => s.trim()).some(t => t === tag || t === '*');
}

module.exports = { contentHash, tagFor, stillFresh };
