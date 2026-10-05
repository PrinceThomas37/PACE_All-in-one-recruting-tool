// GMAIL PREVIEWS SHOW REAL TEXT, NOT HTML CODES (R-111).
//
// Owner's screenshot, 1 Oct: in the in-app Mailbox the one-line previews of a
// thread read "&lt;neil.patrick@futeglobal.com&gt;" and "what&#39;s". Cause:
// Gmail's `snippet` is HTML-escaped by Google; PACE used it raw and the screen
// escaped it a second time. Microsoft's bodyPreview is plain text (untouched).
//
//   part 1 — the one decoder (services/html-entities.js), incl. the order trap;
//   part 2 — the Mailbox row (normalizeGmailMessage) with the owner's two strings;
//   part 3 — the reply-sweep message (Gmail provider normalizeMessage), which is
//            what gets STORED as a reply snippet and read for opt-out wording
//            ("please don&#39;t email me" must read as "don't").
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { decodeEntities } = require('../services/html-entities.js');
const mp = require('../services/mail-provider.js');
const { createGmailProvider } = require('../gmail-provider.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// part 1
step('apostrophe', decodeEntities('what&#39;s') === "what's");
step('angle brackets around an address', decodeEntities('&lt;neil.patrick@futeglobal.com&gt;') === '<neil.patrick@futeglobal.com>');
step('ampersand and quote', decodeEntities('Q&amp;A &quot;now&quot;') === 'Q&A "now"');
step('a decimal code for a curly apostrophe', decodeEntities('don&#8217;t') === 'don’t');
step('an escaped entity is decoded ONCE (&amp;lt; -> &lt;, never a tag)', decodeEntities('&amp;lt;b&amp;gt;') === '&lt;b&gt;');
step('plain text with a real ampersand is untouched', decodeEntities('R&D at AT&T') === 'R&D at AT&T');
step('empty / missing is an empty string', decodeEntities('') === '' && decodeEntities(null) === '' && decodeEntities(undefined) === '');

// part 2 — a Gmail message as the Gmail API returns it
const gm = {
  id: 'm1', threadId: 't1', labelIds: ['INBOX'], internalDate: String(Date.UTC(2026, 9, 1, 12)),
  snippet: 'Hi &lt;neil.patrick@futeglobal.com&gt; &mdash; what&#39;s the status? Q&amp;A',
  payload: { headers: [{ name: 'Subject', value: 'Re: Senior Project Manager' }, { name: 'From', value: 'A <a@x.com>' }] },
};
const row = mp.normalizeGmailMessage(gm, { folderId: 'INBOX' });
step('Mailbox row preview reads as text', row.preview === "Hi <neil.patrick@futeglobal.com> - what's the status? Q&A", row.preview);
step('Mailbox row preview is still capped at 300', mp.normalizeGmailMessage({ ...gm, snippet: 'a'.repeat(900) }).preview.length === 300);
const ms = mp.normalizeGraphMessage({ id: 'g1', subject: 's', bodyPreview: 'Tom &amp; Jerry', from: { emailAddress: { address: 'a@x.com' } }, receivedDateTime: '2026-10-01T12:00:00Z' }, { folderId: 'inbox' });
step('a Microsoft preview is left exactly as Microsoft sent it', ms && ms.preview === 'Tom &amp; Jerry', ms && ms.preview);

// part 3
const provider = createGmailProvider({});
const swept = provider.normalizeMessage({
  id: 'm2', threadId: 't2', internalDate: String(Date.UTC(2026, 9, 1, 12)),
  snippet: 'please don&#39;t email me again',
  payload: { headers: [{ name: 'From', value: 'B <b@x.com>' }, { name: 'Subject', value: 's' }], mimeType: 'text/plain', body: { data: '' } },
});
step('reply-sweep preview reads "don\'t", not "don&#39;t"', swept.bodyPreview === "please don't email me again", swept.bodyPreview);
const noSnippet = provider.normalizeMessage({
  id: 'm3', threadId: 't3', internalDate: String(Date.UTC(2026, 9, 1, 12)),
  payload: { headers: [{ name: 'From', value: 'C <c@x.com>' }, { name: 'Subject', value: 's' }], mimeType: 'text/plain', body: { data: Buffer.from('plain body text').toString('base64url') } },
});
step('no snippet: falls back to the body, unchanged', noSnippet.bodyPreview === 'plain body text', noSnippet.bodyPreview);

const ok = results.every(Boolean);
console.log(`\nSUMMARY: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(ok ? 0 : 1);
