// The in-app mailbox: services/mail-provider.js + routes/mailbox.js.
//
// Three things are worth pinning here, in descending order of what they cost if
// they break:
//
//   1. AUTHORISATION. A mailbox is the most sensitive thing a user connects.
//      "Only your own" has to be a tested claim, not a comment — the failure is
//      silent (a 200 with someone else's mail) and unrecoverable once it has
//      happened.
//   2. NOTHING DESTROYS MAIL. Both providers expose a permanent-delete call and
//      neither is reachable from this app; delete means move-to-Trash. A future
//      "simplification" to messages.delete would look tidier and lose a
//      customer's email forever, so the absence of that call is asserted.
//   3. The body sanitiser. It runs over the most hostile input the product
//      handles.
//
// Usage: node test/mailbox-smoke.mjs   (needs express, no browser)

import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const express = require('express');
const mp = require('../services/mail-provider.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ════════════════════════════════════════════════════════════════════════════
// 1. Folder kinds — the UI sorts and icons by KIND, never by name
// ════════════════════════════════════════════════════════════════════════════
{
  ok('Graph wellKnownName wins', mp.folderKindFromGraph({ wellKnownName: 'sentitems', displayName: 'Whatever' }) === 'sent');
  ok('Graph deleteditems → trash', mp.folderKindFromGraph({ wellKnownName: 'deleteditems' }) === 'trash');
  ok('Graph falls back to displayName', mp.folderKindFromGraph({ displayName: 'Deleted Items' }) === 'trash');
  ok('Graph displayName is case-insensitive', mp.folderKindFromGraph({ displayName: 'JUNK EMAIL' }) === 'junk');
  ok('Graph user folder → custom', mp.folderKindFromGraph({ displayName: 'Client escalations' }) === 'custom');

  ok('Gmail INBOX → inbox', mp.folderKindFromGmailLabel({ id: 'INBOX', type: 'system' }) === 'inbox');
  ok('Gmail SPAM → junk', mp.folderKindFromGmailLabel({ id: 'SPAM', type: 'system' }) === 'junk');
  // The one that actually bites: a user label NAMED "Sent" must not become the
  // Sent folder and start showing outbound-style rows.
  ok('a user label named SENT stays custom',
    mp.folderKindFromGmailLabel({ id: 'Label_9', name: 'SENT', type: 'user' }) === 'custom');
  ok('Gmail category labels are hidden', mp.GMAIL_HIDDEN_LABELS.has('CATEGORY_PROMOTIONS'));
  ok('UNREAD is not offered as a folder', mp.GMAIL_HIDDEN_LABELS.has('UNREAD'));

  const sorted = mp.sortFolders([
    { name: 'Zebra', kind: 'custom' }, { name: 'Trash', kind: 'trash' },
    { name: 'Inbox', kind: 'inbox' }, { name: 'Apple', kind: 'custom' }, { name: 'Sent', kind: 'sent' },
  ]).map(f => f.name);
  ok('folders sort inbox-first, custom last, alphabetical within kind',
    JSON.stringify(sorted) === JSON.stringify(['Inbox', 'Sent', 'Trash', 'Apple', 'Zebra']),
    sorted.join(','));
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Address parsing
// ════════════════════════════════════════════════════════════════════════════
{
  const a = mp.parseAddress('Ada Lovelace <Ada@Example.COM>');
  ok('display name + angle address', a.name === 'Ada Lovelace' && a.email === 'ada@example.com', JSON.stringify(a));
  ok('bare address', mp.parseAddress('bob@x.io').email === 'bob@x.io');
  ok('quoted display name is unquoted', mp.parseAddress('"Ada L" <a@x.io>').name === 'Ada L');
  ok('empty is safe', mp.parseAddress('').email === '' && mp.parseAddress(null).name === '');

  // The one that breaks a naive split(','): a comma inside a quoted name.
  const list = mp.parseAddressList('"Lovelace, Ada" <ada@x.io>, bob@y.io');
  ok('a comma inside a quoted display name does not split the list',
    list.length === 2 && list[0].email === 'ada@x.io' && list[1].email === 'bob@y.io',
    JSON.stringify(list));
  ok('empty header → empty list', mp.parseAddressList('').length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. The sanitiser — the most hostile input in the product
// ════════════════════════════════════════════════════════════════════════════
{
  const S = (h, o) => mp.sanitizeEmailHtml(h, o);

  ok('script element and its contents are removed',
    !/alert/i.test(S('<p>hi</p><script>alert(1)</script>')) && !/<script/i.test(S('<script>x</script>')));
  // An unterminated <script> would otherwise leave its payload as visible text.
  ok('an unterminated script tag is still removed', !/<script/i.test(S('<script>alert(1)')));
  ok('iframe is removed', !/<iframe/i.test(S('<iframe src="https://evil.test"></iframe>')));
  ok('object/embed are removed', !/<object|<embed/i.test(S('<object data="x"></object><embed src="y">')));
  ok('form is removed (no credential harvesting in the reading pane)',
    !/<form/i.test(S('<form action="https://evil.test"><input name="pw"></form>')));

  ok('onerror handler is stripped', !/onerror/i.test(S('<img src="x" onerror="alert(1)">')));
  ok('unquoted handler is stripped', !/onclick/i.test(S('<div onclick=alert(1)>x</div>')));
  ok('single-quoted handler is stripped', !/onload/i.test(S("<body onload='x()'>")));

  ok('javascript: href is neutralised', !/javascript:/i.test(S('<a href="javascript:alert(1)">x</a>')));
  ok('unquoted javascript: href is neutralised', !/javascript:/i.test(S('<a href=javascript:alert(1)>x</a>')));
  ok('CSS expression() is defused', !/[^-]expression\(/i.test(S('<div style="width:expression(alert(1))">x</div>')));

  // Remote images are a tracking pixel by default; inline data: images are a
  // signature logo and must survive.
  const blocked = S('<img src="https://track.test/pixel.gif?u=42">');
  ok('remote image src is parked, not loaded', /data-blocked-src/.test(blocked) && !/\ssrc=/.test(blocked), blocked);
  ok('remote background-image is neutralised',
    /background-image:none/.test(S('<div style="background-image:url(https://track.test/p.gif)">x</div>')));
  ok('data: image survives (signature logos)',
    /src="data:image\/png/.test(S('<img src="data:image/png;base64,AAA">')));
  ok('images load when the reader asks',
    /src="https:\/\/ok.test/.test(S('<img src="https://ok.test/a.png">', { blockRemoteImages: false })));

  ok('links get target=_blank + noopener', /target="_blank"/.test(S('<a href="https://x.io">x</a>'))
    && /noopener/.test(S('<a href="https://x.io">x</a>')));
  ok('ordinary formatting survives untouched',
    /<b>bold<\/b>/.test(S('<b>bold</b>')) && /<table/.test(S('<table><tr><td>c</td></tr></table>')));
  ok('empty/null input is safe', S('') === '' && S(null) === '');

  ok('hasRemoteImages sees a pixel', mp.hasRemoteImages('<img src="https://t.test/p.gif">'));
  ok('hasRemoteImages ignores data: images', !mp.hasRemoteImages('<img src="data:image/png;base64,AA">'));
  ok('textToHtml escapes then keeps newlines',
    mp.textToHtml('a<b\nc') === 'a&lt;b<br>c', mp.textToHtml('a<b\nc'));
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Message normalisation — both providers reach the SAME shape
// ════════════════════════════════════════════════════════════════════════════
{
  const g = mp.normalizeGraphMessage({
    id: 'AAM1', conversationId: 'conv1', subject: 'Interview Friday?',
    from: { emailAddress: { name: 'Ada', address: 'Ada@X.io' } },
    toRecipients: [{ emailAddress: { name: 'Me', address: 'me@pace.io' } }],
    ccRecipients: [{ emailAddress: { address: 'cc@x.io' } }],
    receivedDateTime: '2026-08-20T10:00:00Z', bodyPreview: 'Are you free',
    isRead: false, hasAttachments: true, flag: { flagStatus: 'flagged' },
  });
  ok('Graph: id/thread/subject', g.id === 'AAM1' && g.thread_id === 'conv1' && g.subject === 'Interview Friday?');
  ok('Graph: from is lowercased', g.from.email === 'ada@x.io' && g.from.name === 'Ada');
  ok('Graph: isRead:false means unread:true', g.unread === true);
  ok('Graph: cc + attachments + flag', g.cc[0].email === 'cc@x.io' && g.has_attachments === true && g.flagged === true);

  const m = mp.normalizeGmailMessage({
    id: '18f', threadId: 'th1', internalDate: '1755684000000',
    labelIds: ['INBOX', 'UNREAD', 'STARRED'], snippet: 'Are you free',
    payload: { headers: [
      { name: 'From', value: 'Ada <Ada@X.io>' },
      { name: 'To', value: 'me@pace.io' },
      { name: 'Cc', value: 'cc@x.io' },
      { name: 'Subject', value: 'Interview Friday?' },
      { name: 'Message-ID', value: '<abc@mail>' },
    ], parts: [{ filename: 'cv.pdf', body: { attachmentId: 'att1', size: 10 }, mimeType: 'application/pdf' }] },
  });
  ok('Gmail: id/thread/subject', m.id === '18f' && m.thread_id === 'th1' && m.subject === 'Interview Friday?');
  ok('Gmail: from is parsed and lowercased', m.from.email === 'ada@x.io' && m.from.name === 'Ada');
  ok('Gmail: UNREAD label means unread:true', m.unread === true);
  ok('Gmail: STARRED means flagged', m.flagged === true);
  ok('Gmail: attachment detected through the MIME tree', m.has_attachments === true);
  ok('Gmail: Message-ID kept for RFC-5322 threading', m.message_id_header === '<abc@mail>');
  ok('Gmail: internalDate wins over the sender-supplied Date header',
    m.date === new Date(1755684000000).toISOString(), String(m.date));

  // The point of the whole adapter: identical field names either way.
  ok('both providers produce the same keys',
    JSON.stringify(Object.keys(g).sort()) === JSON.stringify(Object.keys(m).filter(k => !/_header$/.test(k)).sort()),
    Object.keys(g).sort().join(',') + ' vs ' + Object.keys(m).sort().join(','));

  const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const body = mp.extractGmailBody({ mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/plain', body: { data: b64('plain version') } },
    { mimeType: 'text/html', body: { data: b64('<p>html version</p>') } },
  ] });
  ok('Gmail body: HTML wins for a reading pane', /html version/.test(body.html) && body.isHtml === true, body.html);
  const textOnly = mp.extractGmailBody({ mimeType: 'text/plain', body: { data: b64('just text\nline2') } });
  ok('Gmail body: text-only is converted to HTML', /just text<br>line2/.test(textOnly.html), textOnly.html);
  // A text/html *attachment* is a forwarded file, not the body.
  const withFile = mp.extractGmailBody({ parts: [
    { mimeType: 'text/html', filename: 'report.html', body: { data: b64('<p>ATTACHED</p>') } },
    { mimeType: 'text/plain', body: { data: b64('real body') } },
  ] });
  ok('a text/html attachment is not mistaken for the body',
    !/ATTACHED/.test(withFile.html) && /real body/.test(withFile.html), withFile.html);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Reply scaffolding
// ════════════════════════════════════════════════════════════════════════════
{
  const msg = {
    from: { email: 'ada@x.io', name: 'Ada' },
    to: [{ email: 'me@pace.io' }, { email: 'bob@y.io' }],
    cc: [{ email: 'carol@z.io' }, { email: 'ADA@x.io' }],
    subject: 'Interview Friday?', date: '2026-08-20T10:00:00Z',
  };
  const r1 = mp.replyRecipients(msg, { replyAll: false, ownAddress: 'me@pace.io' });
  ok('reply goes to the sender only', r1.to.length === 1 && r1.to[0].email === 'ada@x.io' && r1.cc.length === 0);

  const r2 = mp.replyRecipients(msg, { replyAll: true, ownAddress: 'me@pace.io' });
  const ccs = r2.cc.map(a => a.email);
  // The classic reply-all bug: mailing yourself, and mailing the sender twice.
  ok('reply-all never cc:s the replying mailbox', !ccs.includes('me@pace.io'), ccs.join(','));
  ok('reply-all never duplicates the sender', !ccs.includes('ada@x.io'), ccs.join(','));
  ok('reply-all keeps the other participants',
    ccs.includes('bob@y.io') && ccs.includes('carol@z.io'), ccs.join(','));

  ok('Re: is added once', mp.replySubject('Hello') === 'Re: Hello');
  ok('Re: is not stacked', mp.replySubject('Re: Hello') === 'Re: Hello');
  ok('re: is matched case-insensitively', mp.replySubject('RE: Hello') === 'RE: Hello');
  ok('Fwd: is added once', mp.forwardSubject('Hello') === 'Fwd: Hello' && mp.forwardSubject('Fwd: Hello') === 'Fwd: Hello');

  const q = mp.quoteBlock(msg, '<p>original</p>');
  ok('quote block names the sender and keeps the body',
    /ada@x\.io/.test(q) && /original/.test(q) && /wrote:/.test(q));
  ok('quote block escapes a hostile display name',
    !/<script>/.test(mp.quoteBlock({ from: { name: '<script>x</script>', email: 'a@b.c' }, date: null }, '')));
}

// ════════════════════════════════════════════════════════════════════════════
// 5b. RFC 2047 header encoding
//
// A raw UTF-8 byte in a Subject header is not "mostly fine": receiving clients
// guess a charset and the usual wrong guess is Latin-1, which is what turns an
// em-dash into "â€"". This is the fix, and it has two ways to go wrong — not
// encoding at all, and splitting a multi-byte character across two
// encoded-words, which corrupts it differently.
// ════════════════════════════════════════════════════════════════════════════
{
  const { createGmailProvider } = require('../gmail-provider.js');
  const gp = createGmailProvider({ supabase: null, google: { clientId: 'x', clientSecret: 'y' } });

  // Decode encoded-words back, the way a receiving client would.
  const decode = (h) => String(h).split(/\r\n /).map(w => {
    const m = /^=\?UTF-8\?B\?(.*)\?=$/.exec(w);
    return m ? Buffer.from(m[1], 'base64').toString('utf8') : w;
  }).join('');

  const plain = 'Director of Engineering - Site Civil';
  ok('pure-ASCII headers are left completely alone', gp.encodeMimeHeader(plain) === plain);

  const emdash = 'Director of Engineering — Site Civil & Transportation (Leesburg, VA)';
  const enc = gp.encodeMimeHeader(emdash);
  ok('a non-ASCII subject IS encoded', /^=\?UTF-8\?B\?/.test(enc), enc);
  ok('...and round-trips back to the exact original', decode(enc) === emdash, decode(enc));
  // RFC 2047 caps an encoded-word at 75 characters; a longer subject must fold.
  ok('...in encoded-words of at most 75 chars',
    enc.split(/\r\n /).every(w => w.length <= 75), enc.split(/\r\n /).map(w => w.length).join(','));

  // The subtle one: splitting on a byte boundary would cut a 4-byte emoji in
  // half and corrupt it, which is worse than the bug being fixed.
  const wide = '🎯 ' + 'ünïcødé sübjéct '.repeat(6);
  ok('a long multi-byte subject survives folding intact', decode(gp.encodeMimeHeader(wide)) === wide);

  ok('a display name is encoded but the address stays literal',
    gp.encodeAddressHeader('André Müller <andre@x.io>').endsWith('<andre@x.io>')
    && /=\?UTF-8\?B\?/.test(gp.encodeAddressHeader('André Müller <andre@x.io>')),
    gp.encodeAddressHeader('André Müller <andre@x.io>'));
  ok('an ASCII address header is untouched',
    gp.encodeAddressHeader('Ada <ada@x.io>') === 'Ada <ada@x.io>');
}

// ════════════════════════════════════════════════════════════════════════════
// 5c. Forward scaffolding
// ════════════════════════════════════════════════════════════════════════════
{
  const msg = {
    from: { name: 'Ada Okafor', email: 'ada@x.io' },
    to: [{ email: 'me@pace.io' }], cc: [{ email: 'hiring@x.io' }],
    subject: 'Interview Friday?', date: '2026-08-20T10:00:00Z',
  };
  const block = mp.forwardHeaderBlock(msg);
  // A forward without the original envelope is unreadable to whoever gets it.
  ok('the forward block carries From / Subject / To',
    /From:/.test(block) && /ada@x\.io/.test(block) && /Interview Friday\?/.test(block) && /me@pace\.io/.test(block));
  ok('the forward block carries Cc when there was one', /hiring@x\.io/.test(block));
  ok('the forward block is announced as a forward', /Forwarded message/.test(block));
  ok('a hostile display name cannot inject markup into it',
    !/<script>/.test(mp.forwardHeaderBlock({ from: { name: '<script>x</script>', email: 'a@b.c' }, to: [] })));

  ok('approxBytes sizes base64 without decoding it',
    mp.approxBytes(Buffer.from('a'.repeat(3000)).toString('base64')) === 3000,
    String(mp.approxBytes(Buffer.from('a'.repeat(3000)).toString('base64'))));
}

// ════════════════════════════════════════════════════════════════════════════
// 6. The adapter's destructive-action guarantees
// ════════════════════════════════════════════════════════════════════════════
{
  // Record every provider call so we can assert on what was NOT called.
  const graphCalls = [];
  const graphMailRequest = async (_t, path, options = {}) => {
    graphCalls.push({ path, method: options.method || 'GET' });
    if (/\/move$/.test(path)) return { id: 'NEW-ID-AFTER-MOVE' };
    return { value: [], id: 'x' };
  };
  const gmailCalls = [];
  const gmailProvider = {
    modifyLabels: async (_id, m, opts) => { gmailCalls.push({ fn: 'modifyLabels', m, opts }); return {}; },
    trashMessage: async (_id, m) => { gmailCalls.push({ fn: 'trashMessage', m }); return {}; },
    listLabels: async () => [{ id: 'INBOX', type: 'system', name: 'INBOX' }],
    getLabel: async () => ({ messagesTotal: 3, messagesUnread: 1 }),
  };
  const provider = mp.createMailProvider({
    graphMailRequest, getMicrosoftToken: async () => 'tok', gmailProvider,
  });

  const ms = provider.forMailbox({ id: 'mb1', email_address: 'me@pace.io', platform: 'Microsoft' });
  const gm = provider.forMailbox({ id: 'mb2', email_address: 'me@gmail.com', platform: 'Gmail' });
  ok('platform picks the adapter', ms.platform === 'Microsoft' && gm.platform === 'Gmail');

  const t = await ms.trash('AAM1');
  ok('Microsoft trash MOVES to deleteditems', graphCalls.some(c => /\/move$/.test(c.path) && c.method === 'POST'));
  // The whole point: no hard delete anywhere on this path.
  ok('Microsoft trash never issues a DELETE', !graphCalls.some(c => c.method === 'DELETE'),
    JSON.stringify(graphCalls));
  // Graph's move returns a NEW id; a caller that keeps the old one 404s next.
  ok('Microsoft move returns the NEW message id', t.id === 'NEW-ID-AFTER-MOVE', JSON.stringify(t));

  graphCalls.length = 0;
  await ms.archive('AAM1');
  ok('Microsoft archive is a move to the Archive folder',
    graphCalls.some(c => /\/move$/.test(c.path)));

  await gm.trash('18f');
  ok('Gmail trash calls messages.trash', gmailCalls.some(c => c.fn === 'trashMessage'));
  ok('Gmail trash never calls a delete', !gmailCalls.some(c => /delete/i.test(c.fn)), JSON.stringify(gmailCalls));

  gmailCalls.length = 0;
  await gm.archive('18f');
  const arch = gmailCalls.find(c => c.fn === 'modifyLabels');
  ok('Gmail archive removes INBOX and adds nothing',
    arch && arch.opts.remove.includes('INBOX') && !(arch.opts.add || []).length, JSON.stringify(arch));

  gmailCalls.length = 0;
  await gm.setRead('18f', true);
  const rd = gmailCalls.find(c => c.fn === 'modifyLabels');
  ok('Gmail mark-read removes the UNREAD label', rd && rd.opts.remove.includes('UNREAD'));

  const folders = await gm.listFolders();
  ok('Gmail folders carry counts from labels.get',
    folders.length === 1 && folders[0].kind === 'inbox' && folders[0].unread === 1, JSON.stringify(folders));
}

// ════════════════════════════════════════════════════════════════════════════
// 7. AUTHORISATION — your own mailboxes, and nobody else's
// ════════════════════════════════════════════════════════════════════════════
{
  const ME = 'user-me', OTHER = 'user-other', ORG = 'org-a';
  const MAILBOXES = {
    'mb-mine':        { id: 'mb-mine', user_id: ME, org_id: ORG, email_address: 'me@pace.io', display_name: 'Priya Sharma', platform: 'Microsoft', is_active: true },
    'mb-theirs':      { id: 'mb-theirs', user_id: OTHER, org_id: ORG, email_address: 'them@pace.io', platform: 'Microsoft', is_active: true },
    'mb-other-org':   { id: 'mb-other-org', user_id: ME, org_id: 'org-b', email_address: 'me@other.io', platform: 'Microsoft', is_active: true },
    'mb-off':         { id: 'mb-off', user_id: ME, org_id: ORG, email_address: 'off@pace.io', platform: 'Microsoft', is_active: false },
    'mb-disconnected':{ id: 'mb-disconnected', user_id: ME, org_id: ORG, email_address: 'dc@pace.io', platform: 'Microsoft', is_active: true },
  };
  // Every mailbox above has a token EXCEPT mb-disconnected.
  const TOKENS = new Set(['mb-mine', 'mb-theirs', 'mb-other-org', 'mb-off']);

  let providerCalls = 0;
  const graphSent = [];
  const RAW_SIGNATURE = '<div><b>{{sender}}</b><br><a href="mailto:{{senderemail}}">{{senderemail}}</a></div>';
  function fakeSupabase() {
    function builder(table) {
      const filters = {};
      const chain = {
        select: () => chain, order: () => chain, in: () => chain, is: () => chain, limit: () => chain,
        eq: (c, v) => { filters[c] = v; return chain; },
        maybeSingle: async () => {
          if (table === 'user_emails') return { data: MAILBOXES[filters.id] || null, error: null };
          if (table === 'microsoft_tokens' || table === 'gmail_tokens') {
            return { data: TOKENS.has(filters.user_email_id) ? { user_email_id: filters.user_email_id } : null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => chain.maybeSingle(),
        then: (res) => Promise.resolve({ data: [], error: null }).then(res),
      };
      return chain;
    }
    return { from: builder };
  }

  const supabase = fakeSupabase();
  const app = express();
  // Production mounts express.json({ limit: '5mb' }) — matched here, because
  // the attachment cap only means anything relative to the body limit above it.
  app.use(express.json({ limit: '5mb' }));
  app.use(require('../routes/mailbox.js')({
    supabase,
    db: { forRequest: () => ({ from: () => ({ select: () => ({ in: () => ({ limit: async () => ({ data: [] }), is: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }) },
    auth: (req, _res, next) => { req.user = { id: ME, org_id: ORG, roles: ['recruiter'] }; next(); },
    orgIdFor: (req) => req.user.org_id,
    // Reaching the provider at all means the authorisation gate let the request
    // through — so these counters ARE the assertion.
    graphMailRequest: async (_t, path, options = {}) => {
      providerCalls++;
      graphSent.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
      return { value: [], id: 'draft-1', body: { content: '<p>quoted original</p>' }, subject: 'Re: x', conversationId: 'c1' };
    },
    getMicrosoftToken: async () => 'tok',
    gmailProvider: { isConfigured: () => true },
    sendMicrosoftNewMessage: async (id, args) => { providerCalls++; graphSent.push({ path: 'sendNew', body: args }); return {}; },
    // The real buildHtmlEmailBody appends the signature under the body — this
    // keeps that shape so the assertions below see what a recipient would.
    buildHtmlEmailBody: (t, sig) => `<div>${t}</div>${sig || ''}`,
    // The RAW template, exactly as app_settings stores it. If the router does
    // not fill it, {{sender}} reaches a real person — which is the bug.
    getMailboxSignature: async () => RAW_SIGNATURE,
  }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (m, p, b) => fetch(base + p, {
    method: m, headers: { 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  });

  let r = await call('GET', '/mailbox/mb-mine/folders');
  ok('my own connected mailbox is readable', r.status === 200, 'got ' + r.status);

  providerCalls = 0;
  r = await call('GET', '/mailbox/mb-theirs/folders');
  ok("another user's mailbox → 404", r.status === 404, 'got ' + r.status);
  ok("another user's mailbox never reaches the provider", providerCalls === 0, 'calls=' + providerCalls);

  // 404, not 403 — a distinguishable code would let anyone enumerate which
  // mailbox ids exist.
  r = await call('GET', '/mailbox/mb-nonexistent/folders');
  ok('an unknown mailbox id 404s identically to a forbidden one', r.status === 404, 'got ' + r.status);

  providerCalls = 0;
  r = await call('GET', '/mailbox/mb-other-org/folders');
  ok('my mailbox in ANOTHER org → 404', r.status === 404, 'got ' + r.status);
  ok('cross-org mailbox never reaches the provider', providerCalls === 0, 'calls=' + providerCalls);

  r = await call('GET', '/mailbox/mb-off/folders');
  ok('a switched-off mailbox → 409 (fixable, not an error)', r.status === 409, 'got ' + r.status);
  ok('...and says why', /mailbox_inactive/.test(await r.text()));

  r = await call('GET', '/mailbox/mb-disconnected/folders');
  ok('a disconnected mailbox → 409 not_connected', r.status === 409, 'got ' + r.status);
  ok('...and says why', /not_connected/.test(await r.text()));

  // The gate has to hold on the WRITE routes too, not just the reads — that is
  // where a miss would move or delete someone else's mail.
  for (const [m, p] of [
    ['PATCH', '/mailbox/mb-theirs/messages/x'],
    ['POST', '/mailbox/mb-theirs/messages/x/move'],
    ['POST', '/mailbox/mb-theirs/messages/x/archive'],
    ['DELETE', '/mailbox/mb-theirs/messages/x'],
    ['POST', '/mailbox/mb-theirs/messages/x/reply'],
    ['POST', '/mailbox/mb-theirs/send'],
  ]) {
    providerCalls = 0;
    const rr = await call(m, p, { read: true, folder_id: 'f', body: 'hi', to: 'a@b.c' });
    ok(`${m} ${p} → 404 (write gate holds)`, rr.status === 404, 'got ' + rr.status);
    ok(`${m} ${p} never reaches the provider`, providerCalls === 0, 'calls=' + providerCalls);
  }

  // A reply with no body must not reach the provider either — an empty send is
  // a wasted send against a real mailbox's daily limit.
  r = await call('POST', '/mailbox/mb-mine/messages/x/reply', { body: '   ' });
  ok('an empty reply is refused with 400', r.status === 400, 'got ' + r.status);
  r = await call('POST', '/mailbox/mb-mine/send', { body: 'hi' });
  ok('a compose with no recipient is refused with 400', r.status === 400, 'got ' + r.status);

  // ══════════════════════════════════════════════════════════════════════════
  // 8. THE SIGNATURE — the bug that shipped
  //
  // Signature templates hold {{sender}} / {{senderemail}} placeholders. The
  // first version of this router appended the RAW template, so real replies
  // went out reading "{{sender}}". Two claims are pinned here: the signature is
  // OFF unless asked for, and when it IS asked for it is FILLED.
  // ══════════════════════════════════════════════════════════════════════════
  const bodyOf = () => {
    const patch = graphSent.filter(c => c.method === 'PATCH' && c.body && c.body.body).pop();
    return (patch && patch.body.body.content) || '';
  };

  graphSent.length = 0;
  await call('POST', '/mailbox/mb-mine/messages/x/reply', { body: 'Confirmed.' });
  let sentBody = bodyOf();
  ok('a reply carries NO signature by default', !/Priya Sharma/.test(sentBody), sentBody);
  ok('...and certainly no raw placeholder', !/\{\{sender/.test(sentBody), sentBody);
  ok('...but does carry what was typed', /Confirmed\./.test(sentBody), sentBody);

  graphSent.length = 0;
  await call('POST', '/mailbox/mb-mine/messages/x/reply', { body: 'Confirmed.', include_signature: true });
  sentBody = bodyOf();
  ok('asking for a signature attaches one', /Priya Sharma/.test(sentBody), sentBody);
  // THE regression guard. An unfilled placeholder is visible to the recipient.
  ok('the signature is FILLED — no {{sender}} reaches the recipient',
    !/\{\{sender\}\}/.test(sentBody) && !/\{\{senderemail\}\}/.test(sentBody), sentBody);
  ok('the mailbox address is substituted too', /me@pace\.io/.test(sentBody), sentBody);

  // The composer previews the same filled signature, so the choice is informed.
  r = await call('GET', '/mailbox/mb-mine/signature');
  const sigBody = await r.json();
  ok('GET /signature returns the filled signature', r.status === 200
    && /Priya Sharma/.test(sigBody.html) && !/\{\{sender\}\}/.test(sigBody.html), JSON.stringify(sigBody));
  r = await call('GET', '/mailbox/mb-theirs/signature');
  ok("...and not for someone else's mailbox", r.status === 404, 'got ' + r.status);

  // ══════════════════════════════════════════════════════════════════════════
  // 9. Subject, forward and attachments
  // ══════════════════════════════════════════════════════════════════════════
  graphSent.length = 0;
  await call('POST', '/mailbox/mb-mine/messages/x/reply', { body: 'ok', subject: 'Re: my own wording' });
  const subjPatch = graphSent.filter(c => c.method === 'PATCH' && c.body && c.body.subject).pop();
  ok('an edited subject is sent, overriding the provider default',
    !!subjPatch && subjPatch.body.subject === 'Re: my own wording', JSON.stringify(subjPatch && subjPatch.body.subject));

  graphSent.length = 0;
  r = await call('POST', '/mailbox/mb-mine/messages/x/forward', { to: 'colleague@pace.io', body: 'FYI' });
  ok('forward is accepted', r.status === 200, 'got ' + r.status);
  ok('forward uses Graph createForward (which carries the original attachments)',
    graphSent.some(c => /createForward/.test(c.path)), graphSent.map(c => c.path).join(' '));
  const fwPatch = graphSent.filter(c => c.method === 'PATCH').pop();
  ok('forward addresses the recipient the user named',
    !!fwPatch && fwPatch.body.toRecipients[0].emailAddress.address === 'colleague@pace.io');

  providerCalls = 0;
  r = await call('POST', '/mailbox/mb-mine/messages/x/forward', { body: 'FYI' });
  ok('a forward with no recipient is refused with 400', r.status === 400, 'got ' + r.status);
  ok('...before reaching the provider', providerCalls === 0, 'calls=' + providerCalls);

  graphSent.length = 0;
  await call('POST', '/mailbox/mb-mine/messages/x/reply', {
    body: 'CV attached',
    attachments: [{ filename: 'cv.pdf', content_type: 'application/pdf', base64: Buffer.from('pdf-bytes').toString('base64') }],
  });
  const attCall = graphSent.find(c => /\/attachments$/.test(c.path));
  ok('an attachment is posted to the draft before sending', !!attCall, graphSent.map(c => c.path).join(' '));
  ok('...as a Graph fileAttachment with its real name and type',
    !!attCall && attCall.body['@odata.type'] === '#microsoft.graph.fileAttachment'
    && attCall.body.name === 'cv.pdf' && attCall.body.contentType === 'application/pdf');
  // Order matters: attaching AFTER the send would send an empty email.
  const idxAttach = graphSent.findIndex(c => /\/attachments$/.test(c.path));
  const idxSend = graphSent.findIndex(c => /\/send$/.test(c.path));
  ok('attachments are added BEFORE the send, not after',
    idxAttach > -1 && idxSend > -1 && idxAttach < idxSend, `attach@${idxAttach} send@${idxSend}`);

  // A data: URI prefix from the browser's FileReader must not end up in the
  // base64 payload — that would corrupt every attachment silently.
  graphSent.length = 0;
  await call('POST', '/mailbox/mb-mine/messages/x/reply', {
    body: 'x',
    attachments: [{ filename: 'a.txt', content_type: 'text/plain', base64: 'data:text/plain;base64,' + Buffer.from('hi').toString('base64') }],
  });
  const cleaned = graphSent.find(c => /\/attachments$/.test(c.path));
  ok('a data: URI prefix is stripped from the payload',
    !!cleaned && Buffer.from(cleaned.body.contentBytes, 'base64').toString() === 'hi',
    cleaned && cleaned.body.contentBytes);

  // Oversized attachments are refused with something a person can act on.
  //
  // There are TWO guards and they are not the same. This router's cap (3.5MB of
  // decoded attachment) sits deliberately below express.json's 5MB body cap, so
  // that anything a user is realistically going to attach hits THIS check and
  // gets a sentence explaining what to do. A payload so large it exceeds the
  // body limit itself is stopped earlier, by express, and never reaches here —
  // that is the app-wide backstop, asserted below so the difference is on the
  // record rather than a surprise.
  //
  // 5,000,000 base64 chars ≈ 3.6MB decoded: over this router's cap, under
  // express's body limit — the window this message exists for.
  providerCalls = 0;
  r = await call('POST', '/mailbox/mb-mine/messages/x/reply', {
    body: 'big', attachments: [{ filename: 'huge.bin', base64: 'A'.repeat(5000000) }],
  });
  ok('an oversized attachment is refused with 413', r.status === 413, 'got ' + r.status);
  const tooBig = await r.json();
  ok('...naming the limit and what to do instead',
    /limit/i.test(tooBig.error) && /link/i.test(tooBig.error), tooBig.error);
  ok('...without sending anything', providerCalls === 0, 'calls=' + providerCalls);

  // The outer backstop: past express's body limit nothing reaches the router at
  // all. Still a 413, still nothing sent — just not our worded message.
  providerCalls = 0;
  r = await call('POST', '/mailbox/mb-mine/messages/x/reply', {
    body: 'huge', attachments: [{ filename: 'vast.bin', base64: 'A'.repeat(7 * 1024 * 1024) }],
  });
  ok('a body past the express limit is still refused, by express', r.status === 413, 'got ' + r.status);
  ok('...and still sends nothing', providerCalls === 0, 'calls=' + providerCalls);

  await new Promise(r2 => server.close(r2));
}

// ── report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '[PASS]' : '[FAIL]'} ${r.name}${!r.ok && r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
