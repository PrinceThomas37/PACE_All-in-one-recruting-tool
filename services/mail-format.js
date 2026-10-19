// ============================================================================
// MAIL FORMAT — the only formatting a New message or Reply may carry.
// ----------------------------------------------------------------------------
// The owner asked for the Outlook tools a recruiting email actually uses:
// bold, italic, underline, bullets, a numbered list, a link, and clear
// formatting. 19 Oct (owner, comparing with Saleshandy, R-273): the full bar —
// font, size, text colour, highlight, alignment, indent, and an image by its
// web address. Each of those is a STYLE, and a style is the other way hostile
// HTML gets in, so only a short list survives: the property names below, each
// with a value that matches its own pattern. Anything else is dropped and the
// words are kept.
//
// The mailbox send path used to escape the whole body as plain text
// (buildHtmlEmailBody in index.js). That stays the path for anything that
// does not say it was formatted. A formatted body is cleaned HERE before it
// is wrapped: a tag that is not on the list is dropped and its words kept,
// a script is dropped with its contents, and a link that is not http(s) or
// mailto is unwrapped. The browser shows the same list; this function is
// the one a recipient is protected by.
// ============================================================================

const ALLOWED = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'span', 'blockquote', 'img']);

// ── the styles that may go out ───────────────────────────────────────────────
const FONTS = ['arial', 'helvetica', 'georgia', 'times new roman', 'times', 'verdana', 'tahoma', 'trebuchet ms',
  'courier new', 'courier', 'sans-serif', 'serif', 'monospace'];
const SIZE_WORDS = ['x-small', 'small', 'medium', 'large', 'x-large', 'xx-large'];
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|transparent)$/i;
const STYLE_RULES = {
  'font-family': (v) => v.split(',').map(f => f.trim().replace(/^["']|["']$/g, '').toLowerCase()).every(f => FONTS.includes(f)),
  'font-size': (v) => SIZE_WORDS.includes(v.toLowerCase()) || (/^\d{1,2}(\.\d)?px$/.test(v) && parseFloat(v) >= 9 && parseFloat(v) <= 40),
  color: (v) => COLOUR.test(v),
  'background-color': (v) => COLOUR.test(v),
  'text-align': (v) => ['left', 'center', 'right', 'justify'].includes(v.toLowerCase()),
};
// Which tag may carry which of them: the words (span) carry font and colour; a line (p, div, li) carries its alignment.
const STYLE_ON = {
  span: ['font-family', 'font-size', 'color', 'background-color'],
  p: ['text-align'], div: ['text-align'], li: ['text-align'],
};
function cleanStyle(tag, raw) {
  const m = String(raw).match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (!m) return '';
  const allowed = STYLE_ON[tag] || [];
  const kept = [];
  for (const decl of String(m[1] != null ? m[1] : m[2]).replace(/&quot;/g, '"').replace(/&#39;/g, "'").split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const val = decl.slice(at + 1).trim().replace(/\s*!important$/i, '');
    if (!allowed.includes(prop) || /[<>\\]|url\s*\(|expression/i.test(val) || !STYLE_RULES[prop](val)) continue;
    kept.push(prop + ':' + val);
  }
  return kept.join(';');
}
// An image goes out by its web address only (https) — nothing pasted in as data, nothing from a script.
function readSrc(tag) {
  const m = String(tag).match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
  const s = m ? String(m[1] || m[2] || m[3] || '').trim() : '';
  return /^https:\/\/[^\s<>"']+$/i.test(s) ? s : '';
}
function readAlt(tag) {
  const m = String(tag).match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return m ? String(m[1] || m[2] || '').slice(0, 200) : '';
}
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

  // A span that carried nothing is on the stack as 'span:none' — it is closed without writing anything.
  function closeThrough(name) {
    let at = -1;
    for (let k = stack.length - 1; k >= 0; k--) { if (stack[k] === name || stack[k] === name + ':none') { at = k; break; } }
    if (at < 0) return;
    while (stack.length > at) { const t = stack.pop(); if (!/:none$/.test(t)) out.push('</' + t + '>'); }
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
    if (name === 'img') {
      const src = readSrc(raw);
      if (src) out.push('<img src="' + escapeAttr(src) + '" alt="' + escapeAttr(readAlt(raw)) + '" style="max-width:100%;height:auto">');
      continue;
    }
    if (name === 'blockquote') {
      // Indent. One fixed look, whatever the browser wrote.
      out.push('<blockquote style="margin:0 0 0 40px;border:none;padding:0">');
      if (!selfClose) stack.push('blockquote');
      continue;
    }
    if (STYLE_ON[name]) {
      const st = cleanStyle(name, raw);
      // A span with nothing left to say is not kept (its words are).
      if (name === 'span' && !st) { if (!selfClose) stack.push('span:none'); continue; }
      out.push('<' + name + (st ? ' style="' + escapeAttr(st) + '"' : '') + '>');
      if (!selfClose) stack.push(name);
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
  while (stack.length) { const t = stack.pop(); if (!/:none$/.test(t)) out.push('</' + t + '>'); }
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
