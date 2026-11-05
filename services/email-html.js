// HOW AN OUTGOING EMAIL BODY IS LAID OUT — one place, for every email PACE sends (R-397, owner 4–5 Nov 2026).
//
// Owner: "the email layout is off during the sending … when opened in Outlook and Gmail … some have proper spaces and paras, some are
// continuous sentences with no para formation." Measured on the real sent mail (30 days, 9,340 lead emails): 97% were written with blank-
// line paragraphs and look right; 283 were written with SINGLE line breaks only ("Hi Aaron,⏎This is …⏎I noticed …") and rendered as
// lines stacked tightly with no paragraph spacing; 2 were one continuous line. The old builder only knew "blank line = paragraph".
// And it left paragraph spacing to each mail program's own default, which Gmail and Outlook (Word's engine) do not agree on.
//
// So, for ANY text, whoever wrote it:
//   * line endings are tidied (Windows CRLF, trailing spaces, runs of blank lines);
//   * blank lines make paragraphs, as before — inside a paragraph a single line break stays a line break (a "Thanks,⏎Ash" sign-off);
//   * text with NO blank line at all and three or more lines (the single-break writers) → every line is its own paragraph;
//   * one continuous line that opens "Hi Name," → the greeting is its own paragraph;
//   * every paragraph carries its OWN margin and font inline, so Gmail and Outlook draw the same gap.
// Pure: no database, no request.
const COMPLIANCE_FOOTER_HTML =
  '<div style="margin-top:20px;font-size:11px;line-height:1.5;color:#94A3B8;font-family:Arial,sans-serif">'
  + 'If you\'d prefer not to hear from me, just reply "unsubscribe" and I\'ll remove you from my list.'
  + '</div>';

const FONT = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0F172A';
const P_STYLE = 'margin:0 0 14px 0;' + FONT;
const GREETING = /^((?:Hi|Hello|Hey|Dear)\s+[^,\n]{1,40},)[ \t]+(\S[\s\S]*)$/;

const escapeHtml = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function normaliseText(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .split('\n').map((l) => l.replace(/[ \t ]+$/, '')).join('\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

// → an array of paragraphs, each an array of lines
function paragraphsOf(text) {
  const t = normaliseText(text);
  if (!t) return [];
  let blocks = t.split(/\n{2,}/).map((b) => b.split('\n'));
  if (blocks.length === 1) {
    const lines = blocks[0];
    if (lines.length >= 3) blocks = lines.map((l) => [l]);
    else if (lines.length === 1) { const m = GREETING.exec(lines[0]); if (m) blocks = [[m[1]], [m[2]]]; }
  }
  return blocks;
}

function bodyHtml(text) {
  return paragraphsOf(text).map((lines) => '<p style="' + P_STYLE + '">' + lines.map(escapeHtml).join('<br>') + '</p>').join('');
}

// Plain text + an optional HTML signature (appended after a ruled separator) + the opt-out footer.
function buildHtmlEmailBody(plainText, signatureHtml, includeFooter = true) {
  const sig = signatureHtml && String(signatureHtml).trim()
    ? '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">' + signatureHtml
    : '';
  const footer = includeFooter ? COMPLIANCE_FOOTER_HTML : '';
  return '<div style="' + FONT + '">' + bodyHtml(plainText) + sig + footer + '</div>';
}

module.exports = { buildHtmlEmailBody, bodyHtml, paragraphsOf, normaliseText, COMPLIANCE_FOOTER_HTML, P_STYLE };
