// THE INBOX SHOWS CONVERSATIONS (R-271) AND ALL INBOXES (R-272) — the server half.
// Owner, 19 Oct: "even if we reply back, that doesn't end up in the email thread … it gets shown in the sent. In Gmail or in
// Outlook, if we select show as thread, that particular email has all the thread, in and out emails, and gets updated."
// Their teammate: "an all inbox option like Gmail … but the system must show which email is for which email ID."
//   1. summariseConversation: the row is the NEWEST message either way (ours included), counts every message, names who wrote
//      ("me, Ray"), ignores Trash/Junk and drafts, and says which messages sit in the folder being read;
//   2. Gmail: conversations come from threads.list; Outlook: a folder page grouped by conversation, each read whole, and the
//      newest Sent mail brings a conversation we just answered to the top — but only one that is also in the folder;
//   3. the routes: /mailbox/:mid/conversations keeps the "your own mailboxes only" door; /mailbox-all/inbox merges every
//      mailbox the caller can open, labels each row with its address, names a mailbox it could not read, never another
//      person's mailbox, and pages each mailbox on its own.
// Usage: node test/mailbox-threads-smoke.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const express = require('express');
const mp = require('../services/mail-provider.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const me = { name: 'Prince Thomas', email: 'prince@futeglobal.com' }, ray = { name: 'Ray Credeur', email: 'rcredeur33@yahoo.com' };
const msg = (id, from, date, extra = {}) => ({ id, thread_id: 't1', folder_id: 'INBOX', subject: 'Re: Interview scheduled', from, to: [], cc: [], date, preview: id, unread: false, has_attachments: false, is_draft: false, label_ids: [], ...extra });

// ── 1. one conversation as one row ──
{
  const s = mp.summariseConversation([
    msg('m3', ray, '2026-10-19T13:04:00Z', { unread: true, folder_id: 'INBOX' }),
    msg('m1', me, '2026-10-19T12:59:00Z', { folder_id: 'SENT', subject: 'Interview scheduled', to: [ray] }),
    msg('m2', me, '2026-10-19T13:03:00Z', { folder_id: 'SENT', to: [ray] }),
  ], { own: 'Prince@FuteGlobal.com', folderId: 'INBOX' });
  step('the row is the conversation\'s NEWEST message', s.latest_id === 'm3' && s.id === 'm3', s.latest_id);
  step('it counts every message, ours included ("3")', s.count === 3);
  step('who wrote it, in the order they spoke: "me, Ray"', JSON.stringify(s.participants) === '["me","Ray"]', JSON.stringify(s.participants));
  step('it is named by how it began (no Re: stacking)', s.subject === 'Interview scheduled', s.subject);
  step('unread when any message is unread; the unread ones are listed', s.unread === true && JSON.stringify(s.unread_ids) === '["m3"]');
  step('which messages sit in the folder being read (what Archive acts on)', JSON.stringify(s.in_folder) === '["m3"]');
  step('the party is the newest person who is not us', s.party && s.party.email === ray.email);

  const ours = mp.summariseConversation([
    msg('a', ray, '2026-10-18T09:00:00Z'), msg('b', me, '2026-10-19T09:00:00Z', { folder_id: 'SENT', to: [ray] }),
  ], { own: me.email, folderId: 'INBOX' });
  step('when WE answered last, our reply is the row (the conversation moves, it does not stay on their email)', ours.latest_id === 'b' && ours.latest_mine === true && ours.preview === 'b');

  const onlyUs = mp.summariseConversation([msg('x', me, '2026-10-19T09:00:00Z', { to: [ray] })], { own: me.email });
  step('when only we have written, the party is who we wrote to', onlyUs.party.email === ray.email);

  const trashed = mp.summariseConversation([
    msg('k', ray, '2026-10-18T09:00:00Z'), msg('t', ray, '2026-10-19T09:00:00Z', { folder_id: 'TRASH' }),
    msg('d', me, '2026-10-19T10:00:00Z', { is_draft: true, folder_id: 'DRAFT' }),
  ], { own: me.email, hidden: ['TRASH', 'SPAM'], folderId: 'INBOX' });
  step('a message in Trash is not part of the conversation on screen', trashed.count === 1 && trashed.latest_id === 'k');
  step('a draft is never the newest message nor counted — but it is noted', trashed.has_draft === true && !trashed.message_ids.includes('d'));
  step('nothing left → no row', mp.summariseConversation([msg('t', ray, '2026-10-19T09:00:00Z', { folder_id: 'TRASH' })], { hidden: ['TRASH'] }) === null);
  const many = mp.summariseConversation(['A b', 'C d', 'E f', 'G h'].map((n, i) => msg('p' + i, { name: n, email: i + '@x.com' }, '2026-10-1' + i + 'T09:00:00Z')), {});
  step('at most three names, and how many more', many.participants.length === 3 && many.more_participants === 1);
}

// ── 2. the providers ──
{
  const asked = [];
  const header = (n, v) => ({ name: n, value: v });
  const gmMsg = (id, from, ms, labels) => ({ id, threadId: 'T-' + id[0], labelIds: labels, internalDate: String(ms), snippet: id,
    payload: { headers: [header('From', from), header('Subject', 'Hello'), header('To', 'x@y.z')] } });
  const gmailProvider = {
    listThreadPage: async (_id, o) => { asked.push(o); return { threads: [{ id: 'T-a' }, { id: 'T-b' }], nextPageToken: 'NEXT' }; },
    getThread: async (_id, tid) => ({ messages: tid === 'T-a'
      ? [gmMsg('a1', 'Ray <r@y.com>', 1000, ['INBOX']), gmMsg('a2', 'Me <me@g.com>', 3000, ['SENT'])]
      : [gmMsg('b1', 'Zoe <z@y.com>', 2000, ['INBOX', 'UNREAD'])] }),
  };
  const gm = mp.createMailProvider({ graphMailRequest: async () => ({}), getMicrosoftToken: async () => 't', gmailProvider })
    .forMailbox({ id: 'g', platform: 'Gmail', email_address: 'me@g.com' });
  const g = await gm.listConversations({ folderId: 'INBOX', limit: 25, hidden: ['TRASH', 'SPAM'] });
  step('Gmail: conversations come from threads.list on the folder\'s label', JSON.stringify(asked[0].labelIds) === '["INBOX"]' && asked[0].maxResults === 25);
  step('Gmail: newest activity first — the one we just answered leads', g.conversations[0].latest_id === 'a2' && g.conversations[1].latest_id === 'b1', g.conversations.map(c => c.latest_id).join());
  step('Gmail: our reply counts, and "me" is named', g.conversations[0].count === 2 && g.conversations[0].participants.includes('me'));
  step('Gmail: the next page is Gmail\'s own token', g.next_cursor === 'NEXT');

  const paths = [];
  const gm2 = (id, conv, folder, from, date, extra = {}) => ({ id, conversationId: conv, parentFolderId: folder, subject: 'S ' + conv,
    from: { emailAddress: { name: from.split('@')[0], address: from } }, toRecipients: [], receivedDateTime: date, sentDateTime: date, isRead: true, ...extra });
  const THREADS = {
    c1: [gm2('i1', 'c1', 'F-IN', 'ray@y.com', '2026-10-18T09:00:00Z'), gm2('s1', 'c1', 'F-SENT', 'me@o.com', '2026-10-19T12:00:00Z')],
    c2: [gm2('i2', 'c2', 'F-IN', 'zoe@y.com', '2026-10-19T08:00:00Z', { isRead: false })],
    c3: [gm2('s3', 'c3', 'F-SENT', 'me@o.com', '2026-10-19T11:00:00Z')],     // only in Sent: not an inbox conversation
  };
  const graphMailRequest = async (_t, p) => {
    paths.push(p);
    if (/conversationId eq '([^']+)'/.test(decodeURIComponent(p))) return { value: THREADS[decodeURIComponent(p).match(/conversationId eq '([^']+)'/)[1]] || [] };
    if (/mailFolders\/F-IN\/messages/.test(p)) return { value: [THREADS.c1[0], THREADS.c2[0]] };
    if (/mailFolders\/F-SENT\/messages/.test(p)) return { value: [THREADS.c1[1], THREADS.c3[0]] };
    return { value: [] };
  };
  const ms = mp.createMailProvider({ graphMailRequest, getMicrosoftToken: async () => 't', gmailProvider: {} })
    .forMailbox({ id: 'o', platform: 'Microsoft', email_address: 'me@o.com' });
  const o = await ms.listConversations({ folderId: 'F-IN', limit: 2, hidden: ['F-TRASH'], sentId: 'F-SENT' });
  const ids = o.conversations.map(c => c.thread_id);
  step('Outlook: the folder page is grouped by conversation and each is read whole', ids.includes('c1') && ids.includes('c2'));
  step('Outlook: the conversation we answered is led by OUR reply, and comes first', o.conversations[0].thread_id === 'c1' && o.conversations[0].latest_id === 's1', JSON.stringify(o.conversations.map(c => [c.thread_id, c.latest_id])));
  step('Outlook: a conversation that lives only in Sent is NOT shown in the Inbox', !ids.includes('c3'), ids.join());
  step('Outlook: the newest Sent mail is read on the first page only', paths.some(p => /F-SENT/.test(p)));
  step('Outlook: a full page gives a next cursor', o.next_cursor === '2');
  paths.length = 0;
  await ms.listConversations({ folderId: 'F-IN', cursor: '2', limit: 2, sentId: 'F-SENT' });
  step('Outlook: a later page does not read Sent again', !paths.some(p => /mailFolders\/F-SENT/.test(p)));
}

// ── 3. the routes ──
{
  const ME = 'u-me', ORG = 'org-a';
  const MB = {
    'mb-g': { id: 'mb-g', user_id: ME, org_id: ORG, email_address: 'me@gmail.test', platform: 'Gmail', is_active: true, is_primary: true },
    'mb-o': { id: 'mb-o', user_id: ME, org_id: ORG, email_address: 'me@outlook.test', platform: 'Microsoft', is_active: true },
    'mb-dc': { id: 'mb-dc', user_id: ME, org_id: ORG, email_address: 'dc@outlook.test', platform: 'Microsoft', is_active: true },
    'mb-theirs': { id: 'mb-theirs', user_id: 'u-other', org_id: ORG, email_address: 'them@x.test', platform: 'Gmail', is_active: true },
  };
  const TOKENS = new Set(['mb-g', 'mb-o', 'mb-theirs']);
  const supabase = { from: (table) => {
    const f = {};
    const chain = {
      select: () => chain, order: () => chain, in: () => chain, is: () => chain, limit: () => chain,
      eq: (c, v) => { f[c] = v; return chain; },
      maybeSingle: async () => {
        if (table === 'user_emails') return { data: MB[f.id] || null };
        return { data: TOKENS.has(f.user_email_id) ? { user_email_id: f.user_email_id } : null };
      },
      then: (res) => Promise.resolve({ data: table === 'user_emails' ? Object.values(MB).filter(m => m.user_id === f.user_id && m.is_active === f.is_active) : [] }).then(res),
    };
    return chain;
  } };
  const gReads = [];
  const gmailProvider = {
    listLabels: async (id) => { gReads.push(id); return [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'SENT', name: 'SENT', type: 'system' }, { id: 'TRASH', name: 'TRASH', type: 'system' }]; },
    getLabel: async (_id, l) => ({ id: l, messagesTotal: 1, messagesUnread: 0 }),
    listThreadPage: async (id, o) => { gReads.push(id + ':' + (o.pageToken || 'first')); return { threads: o.pageToken ? [{ id: 'G2' }] : [{ id: 'G1' }], nextPageToken: o.pageToken ? null : 'gp2' }; },
    listMessagePage: async () => ({ messages: [{ id: 'gm1' }], nextPageToken: null }),
    getMessage: async (_id, mid) => ({ id: mid, threadId: 'G1', labelIds: ['INBOX'], internalDate: String(Date.parse('2026-10-19T10:00:00Z')), snippet: 'g', payload: { headers: [{ name: 'From', value: 'Ray <r@y.com>' }] } }),
    getThread: async (_id, tid) => ({ messages: [{ id: tid + 'm', threadId: tid, labelIds: ['INBOX'], internalDate: String(tid === 'G1' ? Date.parse('2026-10-19T10:00:00Z') : Date.parse('2026-10-10T10:00:00Z')), snippet: 'g', payload: { headers: [{ name: 'From', value: 'Ray <r@y.com>' }, { name: 'Subject', value: 'G' }] } }] }),
  };
  const graphMailRequest = async (_t, p) => {
    if (/^\/me\/mailFolders\?/.test(p)) return { value: [{ id: 'O-IN', displayName: 'Inbox', wellKnownName: 'inbox' }, { id: 'O-SENT', displayName: 'Sent Items' }, { id: 'O-DEL', displayName: 'Deleted Items' }] };
    if (/conversationId/.test(decodeURIComponent(p))) return { value: [{ id: 'om', conversationId: 'oc', parentFolderId: 'O-IN', subject: 'O', from: { emailAddress: { name: 'Zoe', address: 'z@y.com' } }, receivedDateTime: '2026-10-19T11:00:00Z', isRead: true }] };
    if (/O-IN\/messages/.test(p)) return { value: [{ id: 'om', conversationId: 'oc', parentFolderId: 'O-IN', subject: 'O', receivedDateTime: '2026-10-19T11:00:00Z' }] };
    return { value: [] };
  };
  const app = express();
  app.use(express.json());
  app.use(require('../routes/mailbox.js')({
    supabase,
    db: { forRequest: () => ({ from: () => ({ select: () => ({ in: () => ({ limit: async () => ({ data: [] }), is: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }) },
    auth: (req, _res, next) => { req.user = { id: ME, org_id: ORG, roles: ['recruiter'] }; next(); },
    orgIdFor: (req) => req.user.org_id,
    graphMailRequest, getMicrosoftToken: async () => 't', gmailProvider,
    sendMicrosoftNewMessage: async () => ({}), buildHtmlEmailBody: (t) => t, getMailboxSignature: async () => '',
  }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let r = await fetch(base + '/mailbox/mb-g/conversations?folder=INBOX');
    let j = await r.json();
    step('GET /mailbox/:mid/conversations answers with conversations', r.status === 200 && j.conversations.length === 1 && j.conversations[0].count === 1, JSON.stringify(j).slice(0, 200));
    r = await fetch(base + '/mailbox/mb-theirs/conversations?folder=INBOX');
    step('…another person\'s mailbox → 404 (the same door as every other mailbox read)', r.status === 404);

    gReads.length = 0;
    r = await fetch(base + '/mailbox-all/inbox');
    j = await r.json();
    const boxes = [...new Set(j.conversations.map(c => c.mailbox_email))].sort();
    step('All inboxes merges every mailbox the person can open', r.status === 200 && JSON.stringify(boxes) === '["me@gmail.test","me@outlook.test"]', JSON.stringify(boxes));
    step('…each row says which email ID it belongs to (address and id)', j.conversations.every(c => c.mailbox_id && c.mailbox_email && c.list_folder_id));
    step('…newest first across mailboxes', j.conversations[0].mailbox_email === 'me@outlook.test', j.conversations.map(c => c.date).join());
    step('…never another person\'s mailbox', !gReads.some(x => /mb-theirs/.test(x)) && !j.conversations.some(c => c.mailbox_id === 'mb-theirs'));
    step('…a mailbox it could not open is named, not silently missing', (j.skipped || []).length === 1 && j.skipped[0].email === 'dc@outlook.test', JSON.stringify(j.skipped));
    step('…and there is a next page (Gmail has one)', !!j.next_cursor);
    gReads.length = 0;
    r = await fetch(base + '/mailbox-all/inbox?cursor=' + encodeURIComponent(j.next_cursor));
    const j2 = await r.json();
    step('the next page asks only the mailbox that had more, at its own place', r.status === 200 && gReads.includes('mb-g:gp2') && j2.conversations.length === 1 && j2.conversations[0].mailbox_id === 'mb-g' && j2.next_cursor === null, JSON.stringify(gReads));
    r = await fetch(base + '/mailbox-all/inbox?cursor=%%%');
    step('a broken page marker is refused in words, not a crash', r.status === 400);
    r = await fetch(base + '/mailbox-all/inbox?view=messages');
    j = await r.json();
    step('single-email view of All inboxes lists messages, each labelled too', Array.isArray(j.messages) && j.messages.length >= 2 && j.messages.every(m => m.mailbox_email));
  } finally { server.close(); }
}

const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad || !results.length ? 1 : 0);
