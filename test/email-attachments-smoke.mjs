// Rampart review finding #1 (Session 30): the C-0022 org-scoping edit deleted
// `MAX_EMAIL_ATTACH_BYTES` while `resolveEmailAttachments` in
// routes/recruiting/outreach.js still read it inside a try/catch — every
// document lookup threw a ReferenceError, was swallowed per-document, and
// every attachment silently vanished from candidate/client emails. 105/105
// passed with the bug fully present, because no suite drove a real attachment
// through the real function.
//
// This drives the REAL `POST /candidates/email` handler (not a reimplemented
// copy of resolveEmailAttachments) through a real express app + a real
// @supabase/supabase-js client answered by a tiny in-memory PostgREST
// interpreter, with `supabase.storage.from().download()` stubbed to return
// real bytes. Asserts an actual attachment object (filename + base64 content)
// reaches the send call, and that another org's document never comes back.
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const express = require(path.join(ROOT, 'node_modules/express'));
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'));

const O1 = 'org1';
const O2 = 'org2';

const candidate_documents = [
  { id: 'doc1', org_id: O1, filename: 'resume.pdf', content_type: 'application/pdf', storage_path: 'candidate/c1/resume.pdf', deleted_at: null },
  // A different org's document, named so a caller in O1 could plausibly guess
  // the id — must never come back, and must be indistinguishable from a
  // document that simply does not exist.
  { id: 'doc2', org_id: O2, filename: 'secret-contract.pdf', content_type: 'application/pdf', storage_path: 'candidate/c2/secret.pdf', deleted_at: null },
];
const client_documents = [];
const user_emails = [
  { id: 'mb1', user_id: 'REC1', email_address: 'rec1@acme.com', display_name: 'Rec One', is_primary: true, is_active: true, daily_send_limit: 150, platform: 'Microsoft' },
];
const microsoft_tokens = [{ user_email_id: 'mb1' }];
const gmail_tokens = [];
const email_tracking = [];
const email_send_log = [];

const DB = { candidate_documents, client_documents, user_emails, microsoft_tokens, gmail_tokens, email_tracking, email_send_log };
let nextId = 1;

function test(row, col, expr) {
  const v = row ? row[col] : undefined;
  const [op, ...rest] = expr.split('.'); const arg = rest.join('.');
  if (op === 'eq') return String(v) === arg;
  if (op === 'is') return arg === 'null' ? v == null : false;
  if (op === 'not') { const [op2, ...r2] = arg.split('.'); return !test(row, col, op2 + '.' + r2.join('.')); }
  if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').includes(String(v));
  throw new Error('op ' + op);
}

async function fakeFetch(u, init = {}) {
  const url = new URL(String(u));
  const table = url.pathname.split('/').pop();
  const method = (init.method || 'GET').toUpperCase();
  const hdr = init.headers || {};
  const get = (k) => (typeof hdr.get === 'function' ? hdr.get(k) : hdr[k] || hdr[k.toLowerCase()]);
  const wantObj = /vnd\.pgrst\.object/.test(get('Accept') || '');
  const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: r.id || ('new' + nextId++), ...r }));
    (DB[table] = DB[table] || []).push(...rows);
    return wantObj ? J(rows[0], 201) : J(rows, 201);
  }
  if (method === 'PATCH') return J([], 200);
  let rows = (DB[table] || []).slice();
  for (const [k, v] of url.searchParams) {
    if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
    rows = rows.filter(r => test(r, k, v));
  }
  const lim = url.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim);
  if (wantObj) return rows.length === 1 ? J(rows[0]) : J({ code: 'PGRST116', message: 'no rows' }, 406);
  return J(rows);
}

const supabase = createClient('http://db.local', 'k', { global: { fetch: fakeFetch }, auth: { persistSession: false } });

// Real bytes, so a corrupted/empty payload downstream would be visible too.
const FILE_BYTES = Buffer.from('%PDF-1.4 fake resume bytes for the smoke test');
supabase.storage = {
  from: () => ({
    download: async (storagePath) => {
      const doc = candidate_documents.find(d => d.storage_path === storagePath) || client_documents.find(d => d.storage_path === storagePath);
      if (!doc) return { data: null, error: { message: 'not found' } };
      return { data: { arrayBuffer: async () => FILE_BYTES.buffer.slice(FILE_BYTES.byteOffset, FILE_BYTES.byteOffset + FILE_BYTES.byteLength) }, error: null };
    },
  }),
};

const sentCalls = [];
const ctx = {
  supabase,
  auth: (req, res, next) => { req.user = { id: 'REC1', role: 'recruiter', roles: ['recruiter'], org_id: O1 }; req.orgId = O1; next(); },
  hasRole: () => false,
  today: () => '2026-09-24',
  wfEngine: { registerContextLoader: () => {}, registerChannel: () => {}, exitEntity: async () => {} },
  gmailProvider: { sendNewMessage: async () => ({ messageId: 'g1', threadId: 't1' }) },
  config: {}, settingsConfig: { getSetting: async () => null },
  graphMailRequest: async () => ({}),
  sendMicrosoftNewMessage: async (mailboxId, opts) => { sentCalls.push(opts); return { graphMessageId: 'm1', conversationId: 'c1', inReplyTo: null }; },
  buildHtmlEmailBody: (t) => '<p>' + t + '</p>',
  getMailboxSignature: async () => '',
  getMicrosoftToken: async () => 'tok',
  warmupLimit: () => null,
  isSendingPaused: () => false,
  isManagerPaused: () => false,
  loadMailboxDelivState: async () => ({}),
  loadSuppressedSet: async () => new Set(),
  friendlySendError: (e) => String(e && e.message || e),
};

const app = express();
app.use(express.json());
require(path.join(ROOT, 'routes/recruiting/outreach.js'))(app, ctx);
const server = app.listen(0);
const PORT = server.address().port;

function call(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { 'content-type': 'application/json', ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const results = [];
const ok = (n, c, d) => results.push({ n, c: !!c, d });

(async () => {
  const r = await call('POST', '/candidates/email', {
    recipients: [{ email: 'candidate@example.com', candidate_id: 'CAND1' }],
    subject: 'Opportunity',
    body: 'Hello there',
    document_ids: ['doc1', 'doc2'], // doc2 belongs to O2 — must never come back
  });

  ok('request succeeded', r.status === 200, JSON.stringify(r.body));
  ok('one send was attempted', sentCalls.length === 1, sentCalls.length);

  const sent = sentCalls[0] || {};
  const attachments = sent.attachments || [];

  // The measurement itself must be possible — a probe that cannot take its
  // reading must fail, never pass silently.
  ok('CANNOT-MEASURE GUARD: send call captured', !!sent.to, 'no send call was recorded at all');

  ok('exactly one real attachment reached the send call', attachments.length === 1, JSON.stringify(attachments.map(a => a && a.filename)));
  const att = attachments[0] || {};
  ok('attachment carries the real filename', att.filename === 'resume.pdf', att.filename);
  ok('attachment carries real, non-empty content', typeof att.base64 === 'string' && att.base64.length > 0, att.base64 && att.base64.length);
  ok('attachment content round-trips to the real bytes', Buffer.from(att.base64 || '', 'base64').equals(FILE_BYTES), 'content mismatch');

  // The other org's document must never surface — not as an attachment, and
  // not even by name (a leaked filename would be almost as bad as the bytes).
  ok('the foreign-org document never came back', !attachments.some(a => a.filename === 'secret-contract.pdf'), attachments);

  const failed = results.filter(x => !x.c);
  for (const r2 of results) console.log((r2.c ? 'PASS' : 'FAIL') + ' - ' + r2.n + (r2.c ? '' : ' :: ' + JSON.stringify(r2.d)));
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
