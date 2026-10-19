// ATTACHMENTS SENT FROM A PHONE ARE LISTED (R-274). The owner (19 Oct): Ray Credeur's resume — "Sent from Yahoo Mail for
// iPhone" — showed as an attachment in Gmail and not in PACE. PACE hid every part carrying a Content-ID, taking it for a
// signature logo; phone mail apps put a Content-ID on real attachments too. Now a part is hidden only when it is an image the
// email's own HTML shows. Driven through the real Gmail and Outlook adapters with fake providers.
// Usage: node test/mail-attachments-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 240) : '')); };
const { createMailProvider } = require('../services/mail-provider.js');
const b64 = (s) => Buffer.from(s).toString('base64url');

// The shape iPhone mail sends: the text, then the Word file — with a Content-ID on it.
const phonePayload = { mimeType: 'multipart/mixed', headers: [], parts: [
  { mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/plain', body: { data: b64('Thank you for sending over the job opportunity.') } },
    { mimeType: 'text/html', body: { data: b64('<div>Thank you for sending over the job opportunity.</div><p>Regards, Ray</p>') } } ] },
  { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'Ray Credeur 2026.docx',
    headers: [{ name: 'Content-Disposition', value: 'attachment; filename="Ray Credeur 2026.docx"' }, { name: 'Content-Id', value: '<f_mgt1x2y30>' }],
    body: { attachmentId: 'att-docx', size: 24000 } },
] };
// A company signature: a logo the body SHOWS by cid, plus a PDF.
const sigPayload = { mimeType: 'multipart/related', headers: [], parts: [
  { mimeType: 'text/html', body: { data: b64('<p>Thanks</p><img src="cid:logo001@acme"> Acme') } },
  { mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo001@acme>' }], body: { attachmentId: 'att-logo', size: 900 } },
  { mimeType: 'image/jpeg', filename: 'site-photo.jpg', headers: [{ name: 'Content-ID', value: '<photo9@phone>' }], body: { attachmentId: 'att-photo', size: 90000 } },
  { mimeType: 'application/pdf', filename: 'rates.pdf', headers: [], body: { attachmentId: 'att-pdf', size: 5000 } },
] };
let gmailPayload = phonePayload;
const mail = createMailProvider({
  gmailProvider: { getMessage: async () => ({ id: 'g1', threadId: 't1', labelIds: ['INBOX'], payload: Object.assign({ headers: [{ name: 'Subject', value: 'Ray Credeur (Resume)' }, { name: 'From', value: 'Ray <rcredeur33@yahoo.com>' }] }, gmailPayload) }) },
  getMicrosoftToken: async () => 'tok',
  graphMailRequest: async (_t, path) => {
    if (/\/attachments/.test(path)) return { value: [
      { id: 'o-docx', name: 'Ray Credeur 2026.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 24000, isInline: true },
      { id: 'o-logo', name: 'image001.png', contentType: 'image/png', size: 900, isInline: true },
    ] };
    return { id: 'm1', subject: 'Ray Credeur (Resume)', hasAttachments: true, body: { contentType: 'html', content: '<p>Resume attached</p><img src="cid:image001.png@01DB">' },
      from: { emailAddress: { address: 'rcredeur33@yahoo.com' } }, toRecipients: [] };
  },
});
const shown = (atts) => atts.filter(a => !a.inline).map(a => a.name);

const g = await mail.forMailbox({ id: 'mb1', email_address: 'me@x.test', platform: 'Gmail' }).getMessage('g1');
step('Gmail: the Word resume sent from a phone (with a Content-ID) is LISTED', shown(g.attachments).includes('Ray Credeur 2026.docx'), JSON.stringify(g.attachments));
gmailPayload = sigPayload;
const g2 = await mail.forMailbox({ id: 'mb1', email_address: 'me@x.test', platform: 'Gmail' }).getMessage('g1');
step('Gmail: a logo the body shows by cid stays hidden (it is part of the signature)', !shown(g2.attachments).includes('logo.png'), JSON.stringify(shown(g2.attachments)));
step('Gmail: a photo with a Content-ID that the body does NOT show is listed', shown(g2.attachments).includes('site-photo.jpg'));
step('Gmail: an ordinary PDF is listed', shown(g2.attachments).includes('rates.pdf'));
const o = await mail.forMailbox({ id: 'mb2', email_address: 'me@x.test', platform: 'Microsoft' }).getMessage('m1');
step('Outlook: a document marked inline by the phone app is LISTED', shown(o.attachments).includes('Ray Credeur 2026.docx'), JSON.stringify(o.attachments));
step('Outlook: an inline image in a body that shows embedded images stays hidden', !shown(o.attachments).includes('image001.png'));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
