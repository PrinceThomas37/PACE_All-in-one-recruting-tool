// The formatting a New message or a Reply is allowed to carry (R-192).
// Bold, italic, underline, bullets, a numbered list, and a link stay.
// A font, a size, a colour, a highlight, alignment, and a script do not.
// Fails if the cleaner is removed: the script and the colour would still be there.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sanitizeMailHtml, visibleText, formattedEmailHtml } = require('../services/mail-format.js');

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
};

const kept = sanitizeMailHtml('<b>B</b><i>I</i><u>U</u><strong>S</strong><em>E</em><ul><li>one</li></ul><ol><li>two</li></ol>');
step('bold, italic, underline, bullets, and a numbered list stay',
  kept === '<b>B</b><i>I</i><u>U</u><strong>S</strong><em>E</em><ul><li>one</li></ul><ol><li>two</li></ol>', kept);

const link = sanitizeMailHtml('<a href="https://example.com/roles" style="color:red" onclick="alert(1)">the role</a>');
step('a normal link stays, without its colour or its click handler',
  link === '<a href="https://example.com/roles">the role</a>', link);

const bad = sanitizeMailHtml('<a href="javascript:alert(1)">click</a>');
step('a javascript link is unwrapped to its words', bad === 'click', bad);
step('the javascript address itself is gone', !/javascript/i.test(bad));

const messy = sanitizeMailHtml('<font color="red" face="Georgia" size="6"><span style="background:yellow">Kept</span></font><p align="center" style="color:blue">Line</p>');
step('font, size, colour, highlight, and alignment are dropped and the words stay',
  messy === 'Kept<p>Line</p>', messy);

const hostile = sanitizeMailHtml('<b>Hi</b><script>alert(1)</script><style>body{color:red}</style>');
step('a script and a style are removed with what is inside them',
  hostile === '<b>Hi</b>' && !/alert/.test(hostile) && !/color/.test(hostile), hostile);

step('an empty formatted box has no words', visibleText('<div><br></div>') === '' && visibleText('<p>&nbsp;</p>') === '');
step('words inside the formatting still count', visibleText('<b>Hello</b> team') === 'Hello team');

const wrapped = formattedEmailHtml('<u>Hello</u><script>alert(1)</script>', '<b>Sig</b>');
step('what goes out keeps the underline and the signature, and not the script',
  /<u>Hello<\/u>/.test(wrapped) && /<b>Sig<\/b>/.test(wrapped) && !/alert/.test(wrapped), wrapped);
step('a formatted message uses the same typeface shell as a plain one',
  wrapped.startsWith('<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0F172A">'));

const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
