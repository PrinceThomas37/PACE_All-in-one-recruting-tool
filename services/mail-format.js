// ============================================================================
// MAIL FORMAT — the only formatting a New message or Reply may carry.
// ----------------------------------------------------------------------------
// The owner asked for the Outlook tools a recruiting email actually uses:
// bold, italic, underline, bullets, a numbered list, a link, and clear
// formatting. Not a font, a size, a colour, a highlight, or alignment.
//
// The mailbox send path used to escape the whole body as plain text
// (buildHtmlEmailBody in index.js). That stays the path for anything that
// does not say it was formatted. A formatted body is cleaned HERE before it
// is wrapped: a tag that is not on the list is dropped and its words kept,
// a script is dropped with its contents, and a link that is not http(s) or
// mailto is unwrapped. The browser shows the same list; this function is
// the one a recipient is protected by.
// ============================================================================

const ALLOWED = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript']);

const SHELL_OPEN = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0F172A">';
const SIG_RULE = '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">';

function escapeText(s) {
  return String(s)
    .replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// A link the person typed. javascript:, data:, and anything with a space or a
// quote does not go out. A bare email address becomes mailto:.
function safeHref(raw) {
  let s = String(raw || '').trim();
  if (!s || /[\s<>"']/.test(s)) return '';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) s = 'mailto:' + s;
  if (!/^(https?:\/\/|mailto:)/i.test(s)) return '';
  if (/^(javascript|data|vbscript):/i.test(s)) return '';
  return s;
}

function readHref(tag) {
  const m = String(tag).match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
  if (!m) return '';
  return safeHref(m[1] || m[2] || m[3] || '');
}

function sanitizeMailHtml(input) {
  const src = String(input || '').replace(/\0/g, '');
  let i = 0;
  const out = [];
  const stack = [];

  function closeThrough(name) {
    const at = stack.lastIndexOf(name);
    if (at < 0) return;
    while (stack.length > at) out.push('</' + stack.pop() + '>');
  }

  while (i < src.length) {
    if (src[i] !== '<') {
      const next = src.indexOf('<', i);
      const chunk = next < 0 ? src.slice(i) : src.slice(i, next);
      out.push(escapeText(chunk));
      i = next < 0 ? src.length : next;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    const gt = src.indexOf('>', i + 1);
    if (gt < 0) {
      out.push('&lt;');
      i += 1;
      continue;
    }
    const raw = src.slice(i + 1, gt);
    i = gt + 1;
    const nameMatch = raw.match(/^\/?\s*([a-zA-Z][a-zA-Z0-9]*)/);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();
    const closing = /^\s*\//.test(raw);
    const selfClose = /\/\s*$/.test(raw);

    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !selfClose) {
        const re = new RegExp('<\\/' + name + '\\s*>', 'i');
        const rest = src.slice(i);
        const m = rest.match(re);
        i = m ? i + m.index + m[0].length : src.length;
      }
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      closeThrough(name);
      continue;
    }
    if (name === 'br') {
      out.push('<br>');
      continue;
    }
    if (name === 'a') {
      const href = readHref(raw);
      // No usable address: keep the words, do not leave an empty link.
      if (!href) continue;
      out.push('<a href="' + escapeAttr(href) + '">');
      if (!selfClose) stack.push('a');
      continue;
    }
    out.push('<' + name + '>');
    if (!selfClose) stack.push(name);
  }
  while (stack.length) out.push('</' + stack.pop() + '>');
  return out.join('');
}

function visibleText(html) {
  return sanitizeMailHtml(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Same outer shell as buildHtmlEmailBody, without the plain-text escape and
// without the outreach footer (a personal reply does not carry one).
function formattedEmailHtml(html, signatureHtml) {
  const clean = sanitizeMailHtml(html);
  const inner = clean || '<p></p>';
  const sig = signatureHtml && String(signatureHtml).trim()
    ? SIG_RULE + signatureHtml
    : '';
  return SHELL_OPEN + inner + sig + '</div>';
}

module.exports = {
  sanitizeMailHtml,
  visibleText,
  safeHref,
  formattedEmailHtml,
};
