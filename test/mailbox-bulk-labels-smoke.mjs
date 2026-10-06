// THE IN-APP MAILBOX: SELECT MANY, LABEL, AND STAY FAST (owner, 6 Oct):
// "there is no multi-select to delete or label emails … the system should let the user label emails" and
// "the load time is very high when switching between emails / folders".
//
//   1. LABELS. Gmail's own labels, Outlook's categories — one adapter surface. Applying a label only touches
//      that label; a message's label ids are the person's OWN labels (never INBOX / UNREAD / STARRED).
//      Outlook needs no new permission: a category goes on by NAME, and an unreadable master list is "no list",
//      not an error.
//   2. BULK. One request does one thing to up to 50 messages, each answered on its own (one failure never hides
//      the others). DELETE IS A MOVE TO TRASH — no permanent delete exists on this path, bulk or not.
//   3. YOUR OWN MAILBOXES ONLY — the new routes hold the same gate as the old ones.
//   4. SPEED. A folder list is held 30s per mailbox and dropped the instant anything in that mailbox changes.
// Usage: node test/mailbox-bulk-labels-smoke.mjs   (needs express, no browser)
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const express = require('express');
const mp = require('../services/mail-provider.js');
const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (cond ? '' : ' — ' + detail)); };

// ── 1. adapters ──────────────────────────────────────────────────────────────
{
  const graph = []; let cats = ['Red category'];
  let masterOk = true;
  const graphMailRequest = async (_t, path, o = {}) => {
    graph.push({ path, method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : null });
    if (/masterCategories/.test(path)) { if (!masterOk) throw new Error('403 ErrorAccessDenied'); return o.method === 'POST' ? {} : { value: [{ displayName: 'Hot', color: 'preset0' }] }; }
    if (/\?\$select=categories$/.test(path)) return { categories: cats };
    if (o.method === 'PATCH') { cats = JSON.parse(o.body).categories; return {}; }
    return { value: [] };
  };
  const gmailCalls = [];
  const gmailProvider = {
    modifyLabels: async (_i, m, opts) => { gmailCalls.push({ fn: 'modifyLabels', m, opts }); return {}; },
    listLabels: async () => [{ id: 'INBOX', type: 'system', name: 'INBOX' }, { id: 'Label_7', type: 'user', name: 'Zed', color: { backgroundColor: '#fff' } }, { id: 'Label_2', type: 'user', name: 'Apple' }],
    createLabel: async (_i, name) => { if (String(name).toLowerCase() === 'apple') { const e = new Error('409 exists'); throw e; } gmailCalls.push({ fn: 'createLabel', name }); return { id: 'Label_99', name }; },
    trashMessage: async () => ({}), getLabel: async () => ({}),
  };
  const provider = mp.createMailProvider({ graphMailRequest, getMicrosoftToken: async () => 'tok', gmailProvider });
  const ms = provider.forMailbox({ id: 'm1', platform: 'Microsoft', email_address: 'a@b.c' });
  const gm = provider.forMailbox({ id: 'm2', platform: 'Gmail', email_address: 'a@g.c' });

  ok('Graph: a message carries its categories as label ids', JSON.stringify(mp.normalizeGraphMessage({ id: 'x', categories: ['Hot', 'Blue category'] }).label_ids) === '["Hot","Blue category"]');
  ok('Graph: no categories → empty list (never undefined)', Array.isArray(mp.normalizeGraphMessage({ id: 'x' }).label_ids));
  ok('Gmail: only the person\'s OWN labels are label ids (INBOX/UNREAD/STARRED are not)', JSON.stringify(mp.normalizeGmailMessage({ id: 'x', labelIds: ['INBOX', 'UNREAD', 'STARRED', 'Label_3'], payload: { headers: [] } }).label_ids) === '["Label_3"]');

  await ms.setLabels('M1', { add: ['Hot'], remove: ['Red category'] });
  const patch = graph.filter(c => c.method === 'PATCH').pop();
  ok('Outlook: adding "Hot" and removing "Red category" PATCHes exactly {Hot}', patch && JSON.stringify(patch.body.categories) === '["Hot"]', JSON.stringify(patch));
  ok('Outlook: a category added to a message already carrying one KEEPS the old one', await (async () => { cats = ['Keep me']; await ms.setLabels('M1', { add: ['New'] }); return JSON.stringify(cats) === '["Keep me","New"]'; })(), JSON.stringify(cats));
  ok('Outlook: the master list is read when permitted', JSON.stringify(await ms.listLabels()) === '[{"id":"Hot","name":"Hot","color":"preset0"}]');
  masterOk = false;
  ok('Outlook: master list NOT permitted → an empty list, not an error (nobody has to reconnect)', JSON.stringify(await ms.listLabels()) === '[]');
  ok('Outlook: creating a label without that permission still returns it, by name', JSON.stringify(await ms.createLabel('Follow up')) === '{"id":"Follow up","name":"Follow up"}');
  ok('Outlook: no DELETE was ever issued', !graph.some(c => c.method === 'DELETE'));

  const gl = await gm.listLabels();
  ok('Gmail: lists the person\'s own labels only, alphabetical, system ones left out', gl.map(l => l.name).join() === 'Apple,Zed', JSON.stringify(gl));
  gmailCalls.length = 0;
  await gm.setLabels('G1', { add: ['Label_7'], remove: ['Label_2'] });
  ok('Gmail: applying a label adds ONLY that label id', gmailCalls[0] && gmailCalls[0].opts.add.join() === 'Label_7' && gmailCalls[0].opts.remove.join() === 'Label_2', JSON.stringify(gmailCalls));
  ok('Gmail: creating a label returns the new id', (await gm.createLabel('Fresh')).id === 'Label_99');
  ok('Gmail: creating one that already exists hands back the existing label', (await gm.createLabel('apple')).id === 'Label_2' ? true : false);
}

// ── 2/3/4. routes ────────────────────────────────────────────────────────────
{
  const ME = 'u-me', OTHER = 'u-other', ORG = 'org-a';
  const MAILBOXES = {
    'mb-ms': { id: 'mb-ms', user_id: ME, org_id: ORG, email_address: 'me@pace.io', platform: 'Microsoft', is_active: true },
    'mb-gm': { id: 'mb-gm', user_id: ME, org_id: ORG, email_address: 'me@gmail.com', platform: 'Gmail', is_active: true },
    'mb-theirs': { id: 'mb-theirs', user_id: OTHER, org_id: ORG, email_address: 'them@pace.io', platform: 'Microsoft', is_active: true },
  };
  const TOKENS = new Set(['mb-ms', 'mb-gm', 'mb-theirs']);
  let providerCalls = 0; const graph = []; const gmail = [];
  let failIds = new Set();
  const supabase = { from: (table) => { const f = {}; const c = {
    select: () => c, order: () => c, in: () => c, is: () => c, limit: () => c, eq: (k, v) => { f[k] = v; return c; },
    maybeSingle: async () => table === 'user_emails' ? { data: MAILBOXES[f.id] || null } : { data: TOKENS.has(f.user_email_id) ? { user_email_id: f.user_email_id } : null },
    then: (r) => Promise.resolve({ data: [], error: null }).then(r) }; return c; } };
  const app = express(); app.use(express.json());
  app.use(require('../routes/mailbox.js')({
    supabase, db: { forRequest: () => ({ from: () => ({ select: () => ({ in: () => ({ limit: async () => ({ data: [] }), is: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }) },
    auth: (req, _r, next) => { req.user = { id: ME, org_id: ORG }; next(); }, orgIdFor: (req) => req.user.org_id,
    graphMailRequest: async (_t, path, o = {}) => { providerCalls++; graph.push({ path, method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : null });
      const id = decodeURIComponent((path.match(/messages\/([^/?]+)/) || [])[1] || '');
      if (failIds.has(id)) throw new Error('boom ' + id);
      if (/\/move$/.test(path)) return { id: 'NEW-' + id };
      if (/\?\$select=categories$/.test(path)) return { categories: [] };
      if (/mailFolders\?/.test(path)) return { value: [{ id: 'f1', displayName: 'Inbox', wellKnownName: 'inbox', unreadItemCount: 2, totalItemCount: 9 }] };
      return { value: [] }; },
    getMicrosoftToken: async () => 'tok',
    gmailProvider: { isConfigured: () => true,
      listLabels: async () => { providerCalls++; return [{ id: 'INBOX', type: 'system', name: 'INBOX' }, { id: 'Label_1', type: 'user', name: 'Clients' }]; },
      getLabel: async () => ({ messagesTotal: 1, messagesUnread: 0 }),
      createLabel: async (_i, n) => { providerCalls++; return { id: 'Label_N', name: n }; },
      modifyLabels: async (_i, m, o) => { providerCalls++; gmail.push({ m, o }); if (failIds.has(m)) throw new Error('boom ' + m); return {}; },
      trashMessage: async (_i, m) => { providerCalls++; gmail.push({ trash: m }); return {}; } },
    sendMicrosoftNewMessage: async () => ({}), buildHtmlEmailBody: (t) => t, getMailboxSignature: async () => '',
  }));
  const server = http.createServer(app); await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: (b && m !== 'GET') ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, body: j }; };

  // gate
  for (const [m, p] of [['GET', '/mailbox/mb-theirs/labels'], ['POST', '/mailbox/mb-theirs/labels'], ['POST', '/mailbox/mb-theirs/messages/x/labels'], ['POST', '/mailbox/mb-theirs/bulk']]) {
    providerCalls = 0; const r = await call(m, p, { name: 'x', ids: ['a'], action: 'trash', add: ['x'] });
    ok(`${m} ${p} on someone else's mailbox → 404 and the provider is never reached`, r.status === 404 && providerCalls === 0, `${r.status} calls=${providerCalls}`);
  }

  // validation
  let r = await call('POST', '/mailbox/mb-ms/bulk', { ids: [], action: 'trash' });
  ok('bulk with nothing picked → 400', r.status === 400);
  r = await call('POST', '/mailbox/mb-ms/bulk', { ids: Array.from({ length: 51 }, (_, i) => 'm' + i), action: 'trash' });
  ok('bulk with 51 messages → 400 (the cap is 50, said plainly)', r.status === 400 && /50/.test(r.body.error), JSON.stringify(r.body));
  r = await call('POST', '/mailbox/mb-ms/bulk', { ids: ['a'], action: 'destroy' });
  ok('bulk with an unknown action → 400 (there is no way to ask for a permanent delete)', r.status === 400);
  r = await call('POST', '/mailbox/mb-ms/bulk', { ids: ['a'], action: 'label' });
  ok('bulk label with no label → 400', r.status === 400);

  // trash = move, results per message, one failure does not hide the rest
  graph.length = 0; failIds = new Set(['m2']);
  r = await call('POST', '/mailbox/mb-ms/bulk', { ids: ['m1', 'm2', 'm3', 'm1'], action: 'trash' });
  ok('bulk trash answers each message: 2 ok, 1 failed, duplicates collapsed', r.status === 200 && r.body.ok === 2 && r.body.failed === 1 && r.body.results.length === 3, JSON.stringify(r.body));
  ok('…the failure is named, the others carry their (new) ids', r.body.results.find(x => x.id === 'm2').ok === false && r.body.results.find(x => x.id === 'm1').new_id === 'NEW-m1', JSON.stringify(r.body.results));
  ok('bulk delete is a MOVE to Deleted Items — never an HTTP DELETE', !graph.some(c => c.method === 'DELETE') && graph.filter(c => /\/move$/.test(c.path)).every(c => c.body.destinationId === 'deleteditems'), JSON.stringify(graph));
  failIds = new Set();

  graph.length = 0;
  r = await call('POST', '/mailbox/mb-ms/bulk', { ids: ['a', 'b'], action: 'read' });
  ok('bulk mark-read sets isRead true on each', r.body.ok === 2 && graph.filter(c => c.method === 'PATCH').every(c => c.body.isRead === true));
  graph.length = 0;
  r = await call('POST', '/mailbox/mb-ms/bulk', { ids: ['a'], action: 'label', label_id: 'Hot' });
  ok('bulk label on Outlook puts the category on', graph.some(c => c.method === 'PATCH' && JSON.stringify(c.body.categories) === '["Hot"]'), JSON.stringify(graph));

  gmail.length = 0;
  r = await call('POST', '/mailbox/mb-gm/bulk', { ids: ['g1', 'g2'], action: 'unlabel', label_id: 'Label_1' });
  ok('bulk unlabel on Gmail removes only that label', r.body.ok === 2 && gmail.every(c => c.o.remove.join() === 'Label_1' && !(c.o.add || []).length), JSON.stringify(gmail));
  gmail.length = 0;
  r = await call('POST', '/mailbox/mb-gm/bulk', { ids: ['g1'], action: 'trash' });
  ok('bulk trash on Gmail is messages.trash (recoverable), never delete', gmail.length === 1 && gmail[0].trash === 'g1');

  // labels
  r = await call('GET', '/mailbox/mb-gm/labels');
  ok('GET labels (Gmail) lists the person\'s own labels', r.status === 200 && JSON.stringify(r.body.map(l => l.name)) === '["Clients"]', JSON.stringify(r.body));
  r = await call('POST', '/mailbox/mb-gm/labels', { name: '   ' });
  ok('a blank label name → 400', r.status === 400);
  r = await call('POST', '/mailbox/mb-gm/labels', { name: 'Hot leads' });
  ok('creating a label returns it', r.status === 200 && r.body.id === 'Label_N' && r.body.name === 'Hot leads');
  gmail.length = 0;
  r = await call('POST', '/mailbox/mb-gm/messages/g9/labels', { add: ['Label_1'], remove: [] });
  ok('one message: add a label', r.status === 200 && gmail[0].m === 'g9' && gmail[0].o.add.join() === 'Label_1');

  // folder cache
  providerCalls = 0; graph.length = 0;
  await call('GET', '/mailbox/mb-ms/folders'); const first = providerCalls;
  await call('GET', '/mailbox/mb-ms/folders'); await call('GET', '/mailbox/mb-ms/folders');
  ok('the folder list is read from the provider ONCE for repeated asks within 30s', first === 1 && providerCalls === 1, `first=${first} total=${providerCalls}`);
  await call('POST', '/mailbox/mb-ms/bulk', { ids: ['z'], action: 'read' });
  const before = providerCalls;
  await call('GET', '/mailbox/mb-ms/folders');
  ok('…and is dropped the moment something in that mailbox changes (counts are never stale after an action)', providerCalls === before + 1, `before=${before} after=${providerCalls}`);
  await call('GET', '/mailbox/mb-gm/folders');
  ok('…per mailbox: another mailbox has its own list', graph.filter(c => /mailFolders\?/.test(c.path)).length === 2);
  server.close();
}
const pass = results.filter(Boolean).length; console.log('\nSUMMARY: ' + pass + '/' + results.length + ' passed'); process.exit(pass === results.length ? 0 : 1);
