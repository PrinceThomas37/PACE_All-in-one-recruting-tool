// SAVE A DRAFT INTO GMAIL / OUTLOOK FROM PACE (R-287, owner 20 Oct: "saving a draft you start in PACE into Gmail/Outlook Drafts — yes").
//
// The real mailbox route and the real mail adapters run against scripted Gmail / Graph fakes. Pinned:
//   * a New message or Reply window saves into the mailbox's OWN Drafts (Gmail: drafts API; Outlook: a draft message), and the next
//     save UPDATES that draft instead of making another;
//   * a reply draft keeps its thread (Gmail: thread id + In-Reply-To/References; Outlook: createReply) and its quote;
//   * a Gmail draft that carries attachments PACE did not load is never rebuilt without them (409, nothing written);
//   * a draft already sent or moved is never revived (409);
//   * only your own mailbox (404 otherwise); nothing to save is a 400; no permanent delete anywhere — the draft goes to Trash.
//
// Usage: node test/mailbox-drafts-smoke.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const express = require('express');

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };
const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function build(platform, { owner = 'me' } = {}) {
  const MB = { id: 'mb1', user_id: owner, org_id: 'o', email_address: 'me@x.test', display_name: 'Me', platform, is_active: true };
  const log = { gmail: [], graph: [] };
  const state = { draftHasAttachment: false, draftIsDraft: true, draftBody: '<p>old words</p><div style="border-left:2px solid #ccc;margin:16px 0 0">QUOTED ORIGINAL</div>' };
  const gmailProvider = {
    isConfigured: () => true,
    getMessage: async (_id, msgId) => {
      if (msgId === 'orig') return { id: 'orig', threadId: 'T1', labelIds: ['INBOX'], internalDate: '1700000000000', payload: { mimeType: 'text/html',
        headers: [{ name: 'From', value: 'Ray <ray@client.test>' }, { name: 'To', value: 'me@x.test' }, { name: 'Subject', value: 'Interview' }, { name: 'Message-ID', value: '<m1@client.test>' }],
        body: { data: b64('<p>Can we do Tuesday?</p>') } } };
      return { id: msgId, threadId: 'T9', labelIds: ['DRAFT'], internalDate: '1700000000000', payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'd' }],
        parts: [{ mimeType: 'text/html', body: { data: b64('<p>x</p>') } }].concat(state.draftHasAttachment ? [{ mimeType: 'application/pdf', filename: 'cv.pdf', body: { attachmentId: 'a1', size: 10 } }] : []) } };
    },
    saveDraft: async (_id, a) => { log.gmail.push(['saveDraft', a]); return { draftId: a.draftId || 'D-new', messageId: 'M-' + (a.draftId || 'new'), threadId: a.threadId }; },
    findDraft: async (_id, ref) => { log.gmail.push(['findDraft', ref]); return ref === 'gone' ? null : { draftId: 'D1', messageId: 'M-listed' }; },
    trashMessage: async (_id, mid) => { log.gmail.push(['trash', mid]); return {}; },
  };
  const graphMailRequest = async (_t, path, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    log.graph.push([method, path, opts.body ? JSON.parse(opts.body) : null]);
    if (method === 'POST' && path === '/me/messages') return { id: 'G-new' };
    if (method === 'POST' && /createReply$/.test(path)) return { id: 'G-reply' };
    if (method === 'POST' && /\/move$/.test(path)) return { id: 'G-moved' };
    if (method === 'GET' && /\/me\/messages\/G-reply/.test(path)) return { body: { content: '<div>QUOTED FROM GRAPH</div>' } };
    if (method === 'GET' && /\/me\/messages\/G-old/.test(path)) return { isDraft: state.draftIsDraft, body: { content: state.draftBody } };
    return {};
  };
  const q = (table) => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: table === 'user_emails' ? MB : ((table === 'gmail_tokens' || table === 'microsoft_tokens') ? { user_email_id: 'mb1' } : null), error: null }) }; return c; };
  const app = express(); app.use(express.json({ limit: '5mb' }));
  app.use(require('../routes/mailbox.js')({
    supabase: { from: q }, db: { forRequest: () => ({}) },
    auth: (req, _r, next) => { req.user = { id: 'me', org_id: 'o', roles: ['recruiter'] }; next(); }, orgIdFor: (req) => req.user.org_id,
    graphMailRequest, getMicrosoftToken: async () => 't', gmailProvider,
    sendMicrosoftNewMessage: async () => ({}), buildHtmlEmailBody: (b) => `<div>${b}</div>`, getMailboxSignature: async () => '',
  }));
  return new Promise((res) => {
    const s = app.listen(0, () => {
      const call = async (method, path, body) => {
        const r = await fetch(`http://127.0.0.1:${s.address().port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, json: await r.json().catch(() => ({})) };
      };
      res({ s, log, state, call });
    });
  });
}

// ── Gmail ───────────────────────────────────────────────────────────────────
{
  const g = await build('Gmail');
  let r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'new', to: 'a@x.test', subject: 'Hi', body: '<p>hello</p>', formatted: true });
  const first = g.log.gmail.find((x) => x[0] === 'saveDraft');
  ok('Gmail: a new draft is created in Gmail\'s own Drafts', r.status === 200 && r.json.ref === 'D-new' && first && !first[1].draftId && first[1].to === 'a@x.test' && /hello/.test(first[1].htmlBody), JSON.stringify(r.json));
  g.log.gmail.length = 0;
  r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'new', ref: 'M-listed', to: 'a@x.test', subject: 'Hi', body: '<p>hello again</p>', formatted: true });
  const upd = g.log.gmail.find((x) => x[0] === 'saveDraft');
  ok('Gmail: saving again UPDATES that draft (found from the message id the Drafts folder lists), it does not make another', r.status === 200 && upd && upd[1].draftId === 'D1' && r.json.ref === 'D1', JSON.stringify(g.log.gmail.map((x) => x[0])));
  g.log.gmail.length = 0; g.state.draftHasAttachment = true;
  r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'new', ref: 'M-listed', to: 'a@x.test', body: '<p>x</p>', formatted: true });
  ok('Gmail: a draft that carries attachments PACE did not load is NOT rebuilt without them (409, nothing written)', r.status === 409 && /attachments/.test(r.json.error) && !g.log.gmail.some((x) => x[0] === 'saveDraft'), JSON.stringify(r.json));
  g.state.draftHasAttachment = false; g.log.gmail.length = 0;
  r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'new', ref: 'gone', to: 'a@x.test', body: '<p>x</p>', formatted: true });
  ok('Gmail: a draft already sent or deleted is not revived (409)', r.status === 409 && !g.log.gmail.some((x) => x[0] === 'saveDraft'), JSON.stringify(r.json));
  g.log.gmail.length = 0;
  r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'reply', message_id: 'orig', body: '<p>Tuesday works</p>', formatted: true });
  const rep = g.log.gmail.find((x) => x[0] === 'saveDraft');
  ok('Gmail: a reply draft keeps its THREAD and its headers', rep && rep[1].threadId === 'T1' && rep[1].inReplyTo === '<m1@client.test>' && /Re: Interview/.test(rep[1].subject), JSON.stringify(rep && rep[1]).slice(0, 200));
  ok('…and it is addressed to the sender of the email it answers when no one was typed in', rep && /ray@client\.test/.test(rep[1].to), rep && rep[1].to);
  ok('…and the quoted original rides under the words', rep && /Tuesday works/.test(rep[1].htmlBody) && /Can we do Tuesday\?/.test(rep[1].htmlBody) && /wrote:/.test(rep[1].htmlBody));
  r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'new', body: '', to: '', subject: '' });
  ok('nothing to save is refused (400)', r.status === 400, JSON.stringify(r.json));
  r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'reply', body: '<p>x</p>' });
  ok('a reply draft must say which email it answers (400)', r.status === 400);
  g.log.gmail.length = 0;
  r = await g.call('DELETE', '/mailbox/mb1/drafts/M-listed');
  ok('Gmail: retiring a draft MOVES it to Trash (recoverable) — nothing is destroyed', r.status === 200 && g.log.gmail.some((x) => x[0] === 'trash' && x[1] === 'M-listed') && !g.log.gmail.some((x) => /delete/i.test(x[0])), JSON.stringify(g.log.gmail.map((x) => x[0])));
  r = await g.call('DELETE', '/mailbox/mb1/drafts/gone');
  ok('…a draft that is already gone is not an error', r.status === 200);
  g.s.close();
}
{
  const g = await build('Gmail', { owner: 'someone-else' });
  const r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'new', to: 'a@x.test', body: '<p>x</p>', formatted: true });
  ok('only YOUR own mailbox can hold a draft from you (404 otherwise)', r.status === 404 && !g.log.gmail.some((x) => x[0] === 'saveDraft'), String(r.status));
  g.s.close();
}

// ── Outlook ─────────────────────────────────────────────────────────────────
{
  const g = await build('Microsoft');
  let r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'new', to: 'a@x.test', cc: 'c@x.test', subject: 'Hi', body: '<p>hello</p>', formatted: true });
  let patch = g.log.graph.find((x) => x[0] === 'PATCH');
  ok('Outlook: a new draft is a draft message in Outlook\'s own Drafts', r.status === 200 && r.json.ref === 'G-new' && g.log.graph.some((x) => x[0] === 'POST' && x[1] === '/me/messages') && patch && patch[2].toRecipients[0].emailAddress.address === 'a@x.test' && patch[2].ccRecipients.length === 1 && /hello/.test(patch[2].body.content), JSON.stringify(g.log.graph.map((x) => x[0] + ' ' + x[1])));
  g.log.graph.length = 0;
  r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'reply', ref: 'G-old', message_id: 'orig', to: 'ray@client.test', subject: 'Re: Interview', body: '<p>new words</p>', formatted: true });
  patch = g.log.graph.find((x) => x[0] === 'PATCH');
  ok('Outlook: saving again UPDATES the same draft (no second one is made)', r.status === 200 && r.json.ref === 'G-old' && !g.log.graph.some((x) => x[0] === 'POST'), JSON.stringify(g.log.graph.map((x) => x[0] + ' ' + x[1])));
  ok('…the person\'s words are replaced and the quoted original is KEPT under them', patch && /new words/.test(patch[2].body.content) && /QUOTED ORIGINAL/.test(patch[2].body.content) && !/old words/.test(patch[2].body.content), patch && patch[2].body.content);
  g.log.graph.length = 0;
  r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'reply', message_id: 'orig-ms', to: 'ray@client.test', body: '<p>Tuesday</p>', formatted: true });
  patch = g.log.graph.find((x) => x[0] === 'PATCH');
  ok('Outlook: a new reply draft is made by createReply (so it threads) and carries the quote', r.status === 200 && r.json.ref === 'G-reply' && g.log.graph.some((x) => /createReply$/.test(x[1])) && patch && /Tuesday/.test(patch[2].body.content) && /QUOTED FROM GRAPH/.test(patch[2].body.content), JSON.stringify(g.log.graph.map((x) => x[0] + ' ' + x[1])));
  g.state.draftIsDraft = false; g.log.graph.length = 0;
  r = await g.call('POST', '/mailbox/mb1/drafts', { kind: 'new', ref: 'G-old', to: 'a@x.test', body: '<p>x</p>', formatted: true });
  ok('Outlook: a draft that was already sent is not revived (409)', r.status === 409 && !g.log.graph.some((x) => x[0] === 'PATCH'), String(r.status));
  g.log.graph.length = 0;
  r = await g.call('DELETE', '/mailbox/mb1/drafts/G-old');
  ok('Outlook: retiring a draft MOVES it to Deleted Items — never a permanent delete', r.status === 200 && g.log.graph.some((x) => x[0] === 'POST' && /\/move$/.test(x[1]) && x[2].destinationId === 'deleteditems') && !g.log.graph.some((x) => x[0] === 'DELETE'), JSON.stringify(g.log.graph));
  g.s.close();
}

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
