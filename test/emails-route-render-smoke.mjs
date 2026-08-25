// GET /emails and PATCH /emails/:id must never hand a raw {{sender}} to a screen.
//
// The queued body keeps {{sender}} in the database until it is sent, so the read
// route is the one place that renders it — once, for every page. This drives the
// real handlers over a stubbed Supabase and asserts on what they return.
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const express = require('express');

const results = [];
const step = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

const JOB_MAILBOX = { id: 'mb-job', email_address: 'prince.thomas@futeglobal.com', display_name: 'Prince Thomas' };
const PINNED_MAILBOX = { id: 'mb-pin', email_address: 'kristy.scott@fute-global.com', display_name: 'Kristy Scott' };
const TOKEN_BODY = "Hi Josue,\n\nI'm {{sender}} at Fute Global LLC. Reply to {{senderemail}}.";

// Two queued rows: one that follows its lead's mailbox, one pinned to a rotated
// mailbox by a sequence — the two ways a send picks who it is from.
const ROWS = [
  {
    id: 'pe-job', to_email: 'a@x.test', status: 'pending', sending_email_id: null,
    from_email: 'stale.person@fute-global.com',
    subject: 'For {{sender}}', body: TOKEN_BODY,
    job: { id: 'job-1', sending_email: JOB_MAILBOX }
  },
  {
    id: 'pe-pinned', to_email: 'b@x.test', status: 'pending', sending_email_id: PINNED_MAILBOX.id,
    from_email: 'stale.person@fute-global.com',
    subject: 'For {{sender}}', body: TOKEN_BODY,
    job: { id: 'job-2', sending_email: JOB_MAILBOX }
  }
];

let updateCalls = [];
function stubSupabase() {
  function builder(table) {
    const q = { table, op: null, payload: null, filters: {} };
    const chain = {};
    const passthrough = ['select', 'order', 'range', 'gte', 'lte', 'is', 'not', 'limit'];
    passthrough.forEach((m) => { chain[m] = () => chain; });
    chain.eq = (c, v) => { q.filters[c] = v; return chain; };
    chain.in = (_c, v) => { q.inValues = v; return chain; };
    chain.update = (payload) => { q.op = 'update'; q.payload = payload; updateCalls.push({ table, payload }); return chain; };
    const rowsFor = () => {
      if (table === 'user_emails') {
        const ids = q.inValues || (q.filters.id ? [q.filters.id] : []);
        return [JOB_MAILBOX, PINNED_MAILBOX].filter(m => ids.includes(m.id));
      }
      if (q.op === 'update') {
        const base = ROWS.find(r => r.id === q.filters.id) || ROWS[0];
        return [{ ...base, ...q.payload }];
      }
      if (q.filters.id) return ROWS.filter(r => r.id === q.filters.id);
      return ROWS;
    };
    chain.single = async () => ({ data: rowsFor()[0] || null, error: null });
    chain.maybeSingle = async () => ({ data: rowsFor()[0] || null, error: null });
    chain.then = (res, rej) => Promise.resolve({ data: rowsFor(), error: null }).then(res, rej);
    return chain;
  }
  return { from: builder };
}

const ctx = {
  supabase: stubSupabase(),
  auth: (req, _res, next) => { req.user = { id: 'u1', org_id: 'org-1', roles: ['admin'] }; req.orgId = 'org-1'; next(); },
  hasRole: () => true,
  today: () => '2026-08-25',
  logActivity: async () => {},
  getSendWindowHours: async () => ({ start: 8, end: 18 }),
  isInLeadSendWindow: () => true,
  getMinutesUntilWindowOpens: () => 0,
  formatWindowOpensLabel: () => '',
  padHour: (h) => String(h).padStart(2, '0'),
  sendProgressCache: new Map(),
};

const app = express();
app.use(express.json());
app.use(require('../routes/emails.js')(ctx));
const server = app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const call = (method, path, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
  }, (res) => {
    let out = ''; res.on('data', d => { out += d; });
    res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(out || 'null') }); } catch (e) { reject(new Error(out)); } });
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

try {
  const list = await call('GET', '/emails?status=pending');
  step('GET /emails answers', list.status === 200 && Array.isArray(list.json), String(list.status));

  const byId = Object.fromEntries((list.json || []).map(e => [e.id, e]));
  const viaJob = byId['pe-job'] || {};
  const viaPin = byId['pe-pinned'] || {};

  step('no row leaves the API with a token in it',
    !JSON.stringify(list.json).includes('{{'),
    (JSON.stringify(list.json).match(/{{\w+}}/g) || []).join(','));
  step('a row follows its lead mailbox',
    viaJob.body?.includes("I'm Prince Thomas") && viaJob.body.includes(JOB_MAILBOX.email_address));
  step('the subject is rendered as well as the body', viaJob.subject === 'For Prince Thomas');
  step('a sequence-pinned row follows the rotated mailbox, not the lead default',
    viaPin.body?.includes("I'm Kristy Scott") && !viaPin.body.includes('Prince Thomas'));
  step('the stale from_email on the row is not what supplies the name',
    !JSON.stringify(list.json).includes('Stale Person'));
  step('the resolved mailbox is attached for the UI',
    viaJob.sending_email?.id === JOB_MAILBOX.id && viaPin.sending_email?.id === PINNED_MAILBOX.id);

  // Opening the editor and saving without typing must not freeze the name in.
  updateCalls = [];
  const noop = await call('PATCH', '/emails/pe-job', { subject: 'For Prince Thomas', body: viaJob.body });
  step('saving the editor unchanged writes nothing', updateCalls.length === 0, JSON.stringify(updateCalls));
  step('...and still answers with the rendered text, not a token',
    noop.status === 200 && !JSON.stringify(noop.json).includes('{{'));

  // A real edit is stored as typed — the human wrote those words.
  updateCalls = [];
  const edited = await call('PATCH', '/emails/pe-job', { body: 'Hi Josue, short version.' });
  step('a real edit is written through',
    updateCalls.length === 1 && updateCalls[0].payload.body === 'Hi Josue, short version.',
    JSON.stringify(updateCalls));
  step('an edit that only touches the body does not rewrite the subject',
    updateCalls[0] && updateCalls[0].payload.subject === undefined);
  step('the edit response carries no token either',
    edited.status === 200 && !JSON.stringify(edited.json).includes('{{'));
} catch (e) {
  step('test harness completed', false, String(e && e.message || e));
} finally {
  server.close();
}

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
