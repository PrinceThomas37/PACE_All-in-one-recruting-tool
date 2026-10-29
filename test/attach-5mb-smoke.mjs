// 5 MB attachments (owner, 29 Oct 2026: "I am not able to attach a file more than 3.5 MB — increase the limit to 5 MB").
// Outlook takes a file in one call only under 3 MB; a bigger one must go through an upload session, in pieces, WITHOUT the
// sign-in header. Gmail refuses a JSON body over 5 MB; a big message must go to its upload address.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const ga = require('../services/graph-attach.js');
const { readAttachments, MAX_ATTACH_BYTES } = require('../services/mailbox-send.js');
let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

const file = (mb) => ({ filename: 'f.pdf', contentType: 'application/pdf', base64: Buffer.alloc(Math.round(mb * 1048576), 7).toString('base64') });

ok('the limit is 5 MB', MAX_ATTACH_BYTES === 5 * 1048576);
ok('a 4.9 MB file is accepted', !readAttachments({ attachments: [file(4.9)] }).error);
ok('5.2 MB is refused with a plain sentence', /limit is 5\.0 MB/.test(readAttachments({ attachments: [file(5.2)] }).error?.body?.error || ''));

// Outlook: small → one POST; big → createUploadSession + PUTs that cover every byte, no Authorization header.
const calls = []; const puts = [];
const graph = async (_t, path, o) => { calls.push({ path, body: o && JSON.parse(o.body || '{}') }); return path.endsWith('createUploadSession') ? { uploadUrl: 'https://up.example/x' } : {}; };
const fetchFn = async (url, o) => { puts.push({ url, headers: o.headers, len: o.body.length }); return { ok: true, status: 200 }; };
await ga.addAttachment(graph, 'tok', 'm1', file(1), { fetchFn });
ok('a 1 MB file goes in one call', calls.length === 1 && /\/attachments$/.test(calls[0].path) && puts.length === 0);
calls.length = 0;
await ga.addAttachment(graph, 'tok', 'm1', file(4.5), { fetchFn });
const total = puts.reduce((n, p) => n + p.len, 0);
ok('a 4.5 MB file opens an upload session', calls.length === 1 && /createUploadSession$/.test(calls[0].path) && calls[0].body.AttachmentItem.size === Math.round(4.5 * 1048576));
ok('its pieces cover every byte', total === Math.round(4.5 * 1048576) && puts.length === 2);
ok('each piece is a multiple of 320 KiB except the last', puts.slice(0, -1).every(p => p.len % (320 * 1024) === 0));
ok('the pieces carry no sign-in header', puts.every(p => !('Authorization' in p.headers)));
ok('Content-Range is right', puts[0].headers['Content-Range'] === `bytes 0-${ga.CHUNK - 1}/${total}`);
ok('allSmall: two 1 MB files ride inline, one 4 MB does not', ga.allSmall([file(1), file(1)]) && !ga.allSmall([file(4)]));

// Gmail: a big message goes to the upload address.
const src = fs.readFileSync(new URL('../gmail-provider.js', import.meta.url), 'utf8');
ok('Gmail big messages use the upload address', /upload\/gmail\/v1\/users\/me\$\{path\}\?uploadType=multipart/.test(src) && /sendMime\(token, '\/messages\/send'/.test(src));
ok('the app accepts an 8 MB JSON body', /express\.json\(\{ limit: '8mb'/.test(fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')));

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall passed');
