// EVERY EMAIL LOOKS THE SAME IN GMAIL AND OUTLOOK, WHOEVER WROTE IT — body and signature (R-397, owner 4–5 Nov 2026).
// Measured on the real sent mail: 97% had blank-line paragraphs; 283 of 9,340 had only single line breaks (they rendered as tight
// stacked lines with no paragraph gap); 2 were one continuous line; and 1 of 17 saved signatures (Ash's) was pasted from Word with its
// hidden markup. The body is laid out in ONE place (services/email-html.js) and the signature is cleaned in ONE place (email-signature.js).
//   * the same letter written three ways → the SAME html
//   * every paragraph carries its own margin and font (Gmail and Outlook default them differently)
//   * a Word paste loses only Word's markup; a clean signature is untouched byte for byte
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 260) : '')); };
const H = require('../services/email-html.js');
const S = require('../email-signature.js');
const paras = (html) => (html.match(/<p style="/g) || []).length;

// ── the body ──
const LETTER = ['Hi Aaron,', 'This is Ash Sayyad at Vital Health Care. I noticed the Project Manager role needs 5-7 years of experience.', 'We have two vetted candidates ready.', 'Can I send their resumes over?'];
const blank = LETTER.join('\n\n'), single = LETTER.join('\n'), crlf = LETTER.join('\r\n\r\n');
const hBlank = H.bodyHtml(blank);
step('blank-line paragraphs: one paragraph each (the 97% that were already right)', paras(hBlank) === 4 && !/<br>/.test(hBlank), hBlank.slice(0, 120));
step('the SAME letter written with single line breaks (the 283) comes out IDENTICAL — every line its own paragraph', H.bodyHtml(single) === hBlank);
step('…and with Windows line endings (CRLF) too', H.bodyHtml(crlf) === hBlank && !/\r/.test(H.bodyHtml(crlf)));
step('every paragraph carries its OWN margin and font inline — nothing left to each mail program\'s default', (hBlank.match(/<p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0F172A">/g) || []).length === 4);
const sign = H.bodyHtml('Hi Kelly,\n\nThe note.\n\nThanks,\nAsh');
step('a sign-off inside a blank-line letter keeps its single line break (it is one paragraph, not split)', paras(sign) === 3 && /Thanks,<br>Ash/.test(sign), sign.slice(-120));
step('a two-line text is not torn apart ("Thanks,⏎Ash" stays together)', paras(H.bodyHtml('Thanks,\nAsh')) === 1 && /Thanks,<br>Ash/.test(H.bodyHtml('Thanks,\nAsh')));
const cont = H.bodyHtml('Hi David, I wanted to check if you had a chance to see my previous message about candidates ready to be hired.');
step('one continuous line that opens "Hi Name," → the greeting is its own paragraph', paras(cont) === 2 && /^<p [^>]*>Hi David,<\/p>/.test(cont), cont.slice(0, 140));
step('trailing spaces and runs of blank lines are tidied', H.bodyHtml('Hi,  \n\n\n\n\nBye   ') === H.bodyHtml('Hi,\n\nBye'));
step('text is escaped — nothing typed can become markup', /&lt;script&gt;/.test(H.bodyHtml('<script>x</script> & more')) && /&amp; more/.test(H.bodyHtml('<script>x</script> & more')) && !/<script/.test(H.bodyHtml('<script>x</script>')));
step('empty or missing text makes no paragraphs, and the builder still answers', paras(H.bodyHtml('')) === 0 && paras(H.bodyHtml(null)) === 0 && /^<div/.test(H.buildHtmlEmailBody('', '')));
const full = H.buildHtmlEmailBody(single, '<div id="sig">SIG</div>');
step('the signature follows after a rule, then the opt-out footer; the footer can be left out', full.indexOf('<hr') > full.indexOf('Can I send') && full.indexOf('id="sig"') > full.indexOf('<hr') && full.includes('reply "unsubscribe"') && !H.buildHtmlEmailBody(single, '', false).includes('unsubscribe'));
step('index.js builds every body through this module (no second copy to drift)', require('fs').readFileSync(new URL('../index.js', import.meta.url), 'utf8').includes("require('./services/email-html')") && !/function buildHtmlEmailBody/.test(require('fs').readFileSync(new URL('../index.js', import.meta.url), 'utf8')));

// ── the signature ──
const WORD = '<!--pace-own-signature--><div style="font-family:Arial"><p class="MsoNormal" style="margin-bottom:0in;mso-fareast-font-family:Times"><b><span style="font-size:11.0pt;color:#1F3864;mso-bidi-font-size:10pt">Ash Sayyad</span></b><o:p></o:p></p>'
  + '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->'
  + '<p class="MsoNormal"><o:p>&nbsp;</o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p>'
  + '<p class="MsoNormal" style="color:#444">Vital Health Care · <a href="https://vhcstaffing.com">vhcstaffing.com</a><o:p></o:p></p><p class="MsoNormal"><img src="https://x.test/logo.png" width="90"><o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p></div>';
const cleaned = S.cleanWordMarkup(WORD);
step('a Word paste loses ONLY Word\'s markup: no Mso class, mso- rule, <o:p>, conditional comment or 0in', !/Mso|mso-|<o:p|\[if|<xml|\b0in\b/i.test(cleaned), cleaned.slice(0, 200));
step('…it keeps what the person made: text, bold, colour, link, logo image — and our own-signature mark', /<b><span style="font-size:11.0pt;color:#1F3864;">Ash Sayyad<\/span><\/b>/.test(cleaned) && /<a href="https:\/\/vhcstaffing.com">/.test(cleaned) && /<img src="https:\/\/x.test\/logo.png"/.test(cleaned) && cleaned.startsWith('<!--pace-own-signature-->'));
step('…a run of empty lines becomes one, and none are left at the start or end', (cleaned.match(/<p style="margin:0 0 3px 0">&nbsp;<\/p>/g) || []).length === 1 && !/<p[^>]*>&nbsp;<\/p><\/div>$/.test(cleaned));
step('…every paragraph has a margin of its own, so Gmail and Outlook space it alike', !/<p(?![^>]*margin)[^>]*>/.test(cleaned));
step('cleaning twice changes nothing', S.cleanWordMarkup(cleaned) === cleaned);
const built = S.signatureFromSendsAs({ company: 'Acme Staffing', title: 'Business Development Manager', address: '1 Main Street, Nashville TN 37201', phone: '615-555-0100', website: 'acme.test' });
step('a signature PACE built, and the built-in default, come out byte for byte the same (the 16 clean ones are untouched)', S.cleanWordMarkup(built) === built && S.cleanWordMarkup(S.DEFAULT_SIGNATURE_HTML) === S.DEFAULT_SIGNATURE_HTML);
const hand = '<div style="font-family:Verdana"><p>Plain hand-written <b>signature</b></p></div>';
step('a hand-written signature with no Word markup is untouched', S.cleanWordMarkup(hand) === hand);
const resolved = S.resolveSignatureHtml(WORD);
step('the signature actually SENT and previewed is the cleaned one (read time — Ash\'s already-saved paste is fixed without him saving again)', !/Mso|mso-|<o:p/i.test(resolved) && /Ash Sayyad/.test(resolved), resolved.slice(0, 100));

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
