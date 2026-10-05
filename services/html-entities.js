'use strict';
// The ONE place that turns HTML entities back into text (R-111).
//
// Gmail's `snippet` arrives HTML-escaped ("what&#39;s", "&lt;a@b.com&gt;") and
// the screens escape again, so the reader saw the raw codes. Anything that
// takes a PREVIEW line or a short plain-text extract from a provider calls
// this; do not write a second decoder.

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&(?:#39|apos|rsquo|lsquo);/gi, "'")
    .replace(/&(?:rdquo|ldquo);/gi, '"').replace(/&(?:ndash|mdash);/gi, '-')
    .replace(/&bull;/gi, '•')
    .replace(/&#(\d{2,5});/g, (m, n) => {
      const c = Number(n);
      return (c >= 32 && c <= 0x2122) ? String.fromCharCode(c) : ' ';
    })
    // &amp; LAST, or "&amp;lt;" decodes twice and turns into a tag.
    .replace(/&amp;/gi, '&');
}

module.exports = { decodeEntities };
