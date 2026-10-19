// The formatting a New message or a Reply is allowed to carry (R-192; widened 19 Oct, R-273).
// Bold, italic, underline, bullets, a numbered list, and a link stay; since R-273 also a font, a size, a text colour, a
// highlight, alignment, an indent and an https image — each only as a style from a short list with a value that fits it.
// A script, an old <font> tag, a style on the wrong tag, and anything clever in a value do not.
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
step('an old <font> tag, a "background:" shorthand and a colour on a paragraph are dropped and the words stay',
  messy === 'Kept<p>Line</p>', messy);

// R-273: the full bar (owner, 19 Oct, comparing with Saleshandy).
const rich = sanitizeMailHtml('<span style="font-family: Georgia; font-size: large; color: rgb(192, 0, 0); background-color: #fff59d;">Hi</span>' +
  '<div style="text-align: center;">Centred</div><blockquote style="margin: 0 0 0 40px; border: none; padding: 0px;">In</blockquote>' +
  '<img src="https://cdn.example.com/logo.png" alt="Logo" onerror="alert(1)">');
step('font, size, text colour and highlight stay on the words',
  /<span style="font-family:Georgia;font-size:large;color:rgb\(192, 0, 0\);background-color:#fff59d">Hi<\/span>/.test(rich), rich);
step('alignment stays on the line', /<div style="text-align:center">Centred<\/div>/.test(rich), rich);
step('an indent goes out with one fixed look', /<blockquote style="margin:0 0 0 40px;border:none;padding:0">In<\/blockquote>/.test(rich), rich);
step('an https image stays, sized to fit, without its script', /<img src="https:\/\/cdn\.example\.com\/logo\.png" alt="Logo" style="max-width:100%;height:auto">/.test(rich) && !/onerror|alert/.test(rich), rich);
const sneaky = sanitizeMailHtml('<span style="font-family: Comic Sans; color: red; background-image: url(https://x.io/t.gif); position: fixed">a</span>' +
  '<span style="color: expression(alert(1))">b</span><img src="http://plain.example.com/x.png"><img src="data:image/png;base64,AAA">' +
  '<span style="font-size: 200px">c</span><div style="color: red">d</div>');
step('anything off the list goes: an unknown font, a background image, positioning, an expression, a 200px size',
  !/Comic|url\(|position|expression|200px/.test(sneaky), sneaky);
step('…a span with nothing allowed left disappears, its words kept', /^a(<span style="color:red">)?b?/.test(sneaky.replace(/<span style="color:red">a<\/span>/, 'a')) && /c/.test(sneaky) && !/<span>/.test(sneaky), sneaky);
step('an image that is not https, or is pasted in as data, does not go out', !/<img/.test(sneaky), sneaky);
step('a colour on a whole paragraph is not a thing the bar makes — dropped', /<div>d<\/div>/.test(sneaky), sneaky);

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
