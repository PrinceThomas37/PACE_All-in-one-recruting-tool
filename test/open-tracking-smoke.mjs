// OPEN TRACKING COUNTS THE RECIPIENT, NOT US (R-110, D-0068).
//
// Owner, 2 Oct: "the email should only be tracked if the to address opens the
// email, not us. Even I can open the sent emails to see how it looks, and I
// think now the system tracks that too." It did: the pixel route counted every
// request for the image.
//
//   part 1 — the rules, pure: sender / machine / early / recipient, and what
//            "opened" and "likely read" mean;
//   part 2 — the database side against a fake: who has tracking on, one
//            tracking row per leads email (reused on a retry), learning the
//            sender's network, and counting an open only when it is the
//            recipient's;
//   part 3 — the pixel route over real HTTP: always an image, never an error,
//            the sender's own request is not an open;
//   part 4 — wiring that cannot be called from here (the send path).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import http from 'node:http';
const require = createRequire(import.meta.url);
const ot = require('../services/open-tracking.js');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const T0 = Date.parse('2026-10-02T14:00:00Z');
const min = (n) => new Date(T0 + n * 60000);

// ═══ part 1 — the rules ═══════════════════════════════════════════════════
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
const GOOGLE = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)';
const base = { sentAt: min(0), ua: BROWSER, ipHash: 'aaaa', senderIpHashes: ['sss1', 'sss2'] };
const cls = (o) => ot.classifyOpen(Object.assign({}, base, { now: min(30) }, o)).kind;
step('THE BUG: a request from the sender\'s own network is the sender, not the recipient', cls({ ipHash: 'sss2' }) === 'sender');
step('…even long after sending, and even with an ordinary browser', cls({ ipHash: 'sss1', now: min(60 * 24) }) === 'sender');
step('a request with no user agent, or a scanner/bot/library, is a machine', cls({ ua: '' }) === 'machine' && cls({ ua: 'python-requests/2.31' }) === 'machine'
  && cls({ ua: 'Mozilla/5.0 (compatible; Proofpoint)' }) === 'machine' && cls({ ua: 'curl/8.0' }) === 'machine' && cls({ ua: 'HeadlessChrome/119' }) === 'machine');
step('inside the first two minutes it is "early" (the sender checking, or a scanner on arrival)', cls({ now: min(1) }) === 'early' && cls({ now: new Date(T0 + 119000) }) === 'early');
step('…and from two minutes on it is the recipient', cls({ now: new Date(T0 + 120000) }) === 'recipient' && cls({}) === 'recipient');
step('Google\'s image proxy is a REAL open (it fetches when somebody opens the message)', cls({ ua: GOOGLE }) === 'recipient');
step('a ordinary browser from an unknown network, later on, is the recipient', cls({ ipHash: 'zzzz', senderIpHashes: [] }) === 'recipient');
step('the sender check wins over everything else', cls({ ipHash: 'sss1', ua: '', now: min(0) }) === 'sender');
step('no send time known: the early rule cannot fire, nothing else changes', ot.classifyOpen({ now: min(0), sentAt: null, ua: BROWSER, ipHash: 'q', senderIpHashes: [] }).kind === 'recipient');

step('hashIp is stable, salted, and never the address itself', ot.hashIp('203.0.113.7', 's1') === ot.hashIp('203.0.113.7', 's1')
  && ot.hashIp('203.0.113.7', 's1') !== ot.hashIp('203.0.113.7', 's2') && !ot.hashIp('203.0.113.7', 's1').includes('203') && ot.hashIp('', 's1') === '');
step('an IPv4-in-IPv6 address and an IPv6 device suffix do not break the match', ot.hashIp('::ffff:203.0.113.7', 's') === ot.hashIp('203.0.113.7', 's')
  && ot.hashIp('2001:db8:1:2:aaaa:bbbb:cccc:1', 's') === ot.hashIp('2001:db8:1:2:dddd:eeee:ffff:9', 's'));

let seen = [];
for (let i = 0; i < 12; i++) seen = ot.mergeSeenIps(seen, 'h' + i, T0 + i);
step('the sender\'s remembered networks are bounded and newest first', seen.length === ot.MAX_SENDER_IPS && seen[0].h === 'h11', seen.map(x => x.h).join(','));
seen = ot.mergeSeenIps(seen, 'h8', T0 + 99);
step('seeing a network again moves it to the front without duplicating it', seen[0].h === 'h8' && seen.filter(x => x.h === 'h8').length === 1);
step('a network not seen for over 30 days is forgotten', ot.mergeSeenIps([{ h: 'old', at: T0 - 31 * 86400000 }], 'new', T0).map(x => x.h).join() === 'new');

const lvl = (o) => ot.readLevel(o);
step('no opens: not opened, not read', !lvl({ open_count: 0 }).opened && !lvl({ open_count: 0 }).likely_read && lvl({}).count === 0);
step('one open: opened, not "likely read"', lvl({ open_count: 1, opened_at: min(5), last_open_at: min(5) }).opened && !lvl({ open_count: 1, opened_at: min(5), last_open_at: min(5) }).likely_read);
step('two opens seconds apart are one look, not "likely read"', !lvl({ open_count: 2, opened_at: min(5), last_open_at: new Date(T0 + 5 * 60000 + 20000) }).likely_read);
step('two opens a minute or more apart: likely read', lvl({ open_count: 2, opened_at: min(5), last_open_at: min(95) }).likely_read === true);
step('who has tracking on: "all", a list, or nobody', ot.enabledFromSetting('all', 'u1') && ot.enabledFromSetting('["u1","u2"]', 'u2') && !ot.enabledFromSetting('["u1"]', 'u3')
  && !ot.enabledFromSetting('', 'u1') && !ot.enabledFromSetting(null, 'u1') && !ot.enabledFromSetting('not json', 'u1') && !ot.enabledFromSetting('all', ''));

// ═══ part 2 — the database side ═══════════════════════════════════════════
function fakeDb(seed) {
  const T = Object.assign({ app_settings: [], email_tracking: [] }, seed || {});
  const calls = { reads: 0, writes: 0, inserts: 0 };
  function q(table) {
    const st = { f: [], op: 'select', payload: null, lim: null };
    const rows = () => { let r = (T[table] = T[table] || []).filter(x => st.f.every(fn => fn(x))); if (st.lim) r = r.slice(0, st.lim); return r; };
    const api = {
      select() { return api; }, eq(k, v) { st.f.push(r => r[k] === v); return api; }, in(k, vs) { st.f.push(r => vs.includes(r[k])); return api; },
      limit(n) { st.lim = n; return api; }, update(p) { st.op = 'update'; st.payload = p; return api; }, insert(p) { st.op = 'insert'; st.payload = p; return api; },
      upsert(p, o) { st.op = 'upsert'; st.payload = p; st.conflict = o && o.onConflict; return api; },
      async maybeSingle() { const r = await run(); return { data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }; },
      then(a, b) { return run().then(a, b); },
    };
    async function run() {
      if (st.op === 'update') { calls.writes++; rows().forEach(r => Object.assign(r, st.payload)); return { data: null, error: null }; }
      if (st.op === 'insert') { calls.inserts++; if (db.failInsert) return { data: null, error: { message: 'nope' } }; (T[table] = T[table] || []).push(Object.assign({ id: 'r' + (T[table].length + 1) }, st.payload)); return { data: null, error: null }; }
      if (st.op === 'upsert') { calls.writes++; const k = st.conflict || 'id'; const ex = (T[table] = T[table] || []).find(r => r[k] === st.payload[k]); if (ex) Object.assign(ex, st.payload); else T[table].push(Object.assign({}, st.payload)); return { data: null, error: null }; }
      calls.reads++; return { data: rows(), error: null };
    }
    return api;
  }
  const db = { T, calls, from: q, failInsert: false };
  return db;
}
let clock = new Date(T0);
const mk = (db) => ot({ supabase: db, secret: 'test-secret', now: () => clock });

{
  const db = fakeDb();
  const svc = mk(db);
  const email = { id: 'e1', job_id: 'j1', contact_id: 'c1', to_email: 'm@x.com', subject: 'Hi', sent_by: 'u-bd1', org_id: 'org1', from_email: 'bd1@ours.com' };
  step('with nothing switched on, a leads email is sent untracked (today\'s behaviour)', (await svc.prepareLeadTracking({ email })) === null && db.T.email_tracking.length === 0);
  db.T.app_settings.push({ key: ot.SETTING_USERS, value: JSON.stringify(['u-bd1']) });
  clock = new Date(T0 + 61000);   // past the one-minute settings cache
  const tok = await svc.prepareLeadTracking({ email, sendingEmail: { email_address: 'bd1@ours.com' } });
  const row = db.T.email_tracking[0];
  step('tracking on for the sender: a token and ONE tracking row tied to the email, lead and person', /^[0-9a-f]{32}$/.test(tok || '') && db.T.email_tracking.length === 1
    && row.email_id === 'e1' && row.lead_id === 'j1' && row.contact_id === 'c1' && row.channel === 'lead_outreach' && row.sent_by === 'u-bd1' && row.org_id === 'org1' && row.mailbox_email === 'bd1@ours.com');
  step('a retry of the same email reuses the row — never a second pixel for one email', (await svc.prepareLeadTracking({ email })) === tok && db.T.email_tracking.length === 1);
  step('someone it is NOT switched on for is untouched', (await svc.prepareLeadTracking({ email: Object.assign({}, email, { id: 'e2', sent_by: 'u-bd2' }) })) === null && db.T.email_tracking.length === 1);
  step('an email with no sender or id is never tracked (and never throws)', (await svc.prepareLeadTracking({ email: { to_email: 'a@b.c' } })) === null && (await svc.prepareLeadTracking({})) === null);
  const bad = fakeDb({ app_settings: [{ key: ot.SETTING_USERS, value: 'all' }] }); bad.failInsert = true;
  step('if the row cannot be saved there is NO pixel — an untracked send beats an uncountable one', (await mk(bad).prepareLeadTracking({ email })) === null);
  step('"all" switches everyone on', (await mk(fakeDb({ app_settings: [{ key: ot.SETTING_USERS, value: 'all' }] })).enabledFor('anyone')) === true);
}

{
  // learning the sender's network, then an open from it is not the recipient's
  clock = new Date(T0);
  const db = fakeDb({ email_tracking: [{ id: 't1', token: 'tok1', sent_at: min(-60), sent_by: 'u-bd1', open_count: 0, opened_at: null, ignored_open_count: 0 }] });
  const svc = mk(db);
  const h0 = db.calls.reads;
  await svc.noteSenderIp('u-bd1', '198.51.100.20');
  const seenRow = db.T.app_settings.find(r => r.key === 'u_u-bd1_seen_ips');
  step('a signed-in person\'s network is remembered, as a hash — never the address', !!seenRow && !/198\.51/.test(seenRow.value) && JSON.parse(seenRow.value).length === 1);
  const reads1 = db.calls.reads, writes1 = db.calls.writes;
  await svc.noteSenderIp('u-bd1', '198.51.100.20');
  step('the same person on the same network a minute later costs nothing (throttled)', db.calls.reads === reads1 && db.calls.writes === writes1);
  clock = new Date(T0 + 11 * 60000);
  await svc.noteSenderIp('u-bd1', '198.51.100.20');
  step('…and ten minutes later it looks but does not write (entry is fresh)', db.calls.reads > reads1 && db.calls.writes === writes1);
  await svc.noteSenderIp('', '1.2.3.4'); await svc.noteSenderIp('u', '');
  step('no person or no address: nothing, and no error', db.T.app_settings.length === 1);

  clock = new Date(T0 + 30 * 60000);
  const own = await svc.recordOpen({ token: 'tok1', ip: '198.51.100.20', ua: BROWSER });
  step('THE BUG: the sender opening their own copy is NOT counted as the recipient opening it', own.kind === 'sender' && db.T.email_tracking[0].open_count === 0 && !db.T.email_tracking[0].opened_at
    && db.T.email_tracking[0].ignored_open_count === 1 && db.T.email_tracking[0].last_ignored_reason === 'sender');
  const theirs = await svc.recordOpen({ token: 'tok1', ip: '203.0.113.50', ua: BROWSER });
  step('the same email opened from a different network IS counted', theirs.kind === 'recipient' && db.T.email_tracking[0].open_count === 1 && !!db.T.email_tracking[0].opened_at);
  clock = new Date(T0 + 95 * 60000);
  await svc.recordOpen({ token: 'tok1', ip: '203.0.113.50', ua: BROWSER });
  const lv = ot.readLevel(db.T.email_tracking[0]);
  step('opened again later: two opens, and the first-open time is kept', db.T.email_tracking[0].open_count === 2 && lv.likely_read === true && lv.count === 2);
  await svc.recordOpen({ token: 'tok1', ip: '203.0.113.51', ua: 'python-requests/2' });
  step('a scanner is tallied as ignored, never as an open', db.T.email_tracking[0].open_count === 2 && db.T.email_tracking[0].ignored_open_count === 2 && db.T.email_tracking[0].last_ignored_reason === 'machine');
  step('an unknown token is nothing — and nothing is revealed', (await svc.recordOpen({ token: 'nope', ip: '1.1.1.1', ua: BROWSER })) === null && (await svc.recordOpen({ token: '', ip: '1.1.1.1' })) === null);
  db.T.email_tracking.push({ id: 't2', token: 'tok2', sent_at: new Date(clock.getTime() - 20000), sent_by: 'u-bd1', open_count: 0, ignored_open_count: 0 });
  step('twenty seconds after sending is too early to be the recipient', (await svc.recordOpen({ token: 'tok2', ip: '203.0.113.9', ua: BROWSER })).kind === 'early' && db.T.email_tracking[1].open_count === 0);
}

// ═══ part 3 — the pixel route over real HTTP ══════════════════════════════
{
  const express = require('express');
  const GIF = require('../email-tracking.js').TRANSPARENT_GIF;
  async function serve(db, ctxExtra) {
    clock = new Date(T0 + 30 * 60000);
    const svc = mk(db);
    const app = express(); app.set('trust proxy', 1);
    app.use(require('../routes/tracking.js')(Object.assign({ supabase: db, db: {}, auth: (_q, _s, n) => n(), orgIdFor: () => null, pixelLimiter: null, openTracking: svc }, ctxExtra || {})));
    const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
    const get = (path, headers) => new Promise((resolve, reject) => http.get({ port: srv.address().port, path, headers }, res => { const b = []; res.on('data', d => b.push(d)); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(b) })); }).on('error', reject));
    return { get, close: () => srv.close(), svc };
  }
  const db = fakeDb({ email_tracking: [{ id: 't1', token: 'tokA', sent_at: min(0), sent_by: 'u-bd1', open_count: 0, opened_at: null, ignored_open_count: 0 }] });
  const s = await serve(db);
  await s.svc.noteSenderIp('u-bd1', '198.51.100.20');
  const mine = await s.get('/o/tokA.gif', { 'user-agent': BROWSER, 'x-forwarded-for': '198.51.100.20' });
  step('the pixel is an image whoever asks, and the SENDER\'s own request is not an open', mine.status === 200 && /image\/gif/.test(mine.type) && mine.body.equals(GIF) && db.T.email_tracking[0].open_count === 0 && db.T.email_tracking[0].ignored_open_count === 1);
  const theirs = await s.get('/o/tokA.gif', { 'user-agent': BROWSER, 'x-forwarded-for': '203.0.113.77' });
  step('…a request from anywhere else, later, is the recipient\'s open', theirs.status === 200 && db.T.email_tracking[0].open_count === 1);
  const unknown = await s.get('/o/not-a-token.gif', { 'user-agent': BROWSER });
  step('an unknown token still gets the image — nothing about our data is revealed', unknown.status === 200 && unknown.body.equals(GIF));
  s.close();
  const broken = Object.assign(fakeDb(), { from() { throw new Error('db down'); } });
  const s2 = await serve(broken);
  const down = await s2.get('/o/tokA.gif', { 'user-agent': BROWSER });
  step('a database failure never breaks the image', down.status === 200 && down.body.equals(GIF));
  s2.close();
}

// ═══ part 4 — wiring ═════════════════════════════════════════════════════
const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
step('a leads email gets the pixel only when a token came back, and only in the SENT copy', /const trackToken = await openTracking\.prepareLeadTracking\(\{ email, sendingEmail \}\);\s*\n\s*if \(trackToken\) htmlBody = injectTrackPixel\(htmlBody, trackToken\);/.test(idx));
step('the sender is on the row the send loop reads (so the switch can see who it is for)', /const PENDING_EMAIL_JOB_SELECT = '[^']*\borg_id, sent_by,/.test(idx));
step('every signed-in request teaches the sender\'s network (not awaited, never throws)', /openTracking\.noteSenderIp\(claims\.id, req\.ip\);/.test(idx) && /pixelLimiter, openTracking,/.test(idx));
const mig = readFileSync(new URL('../migrations/055_open_tracking_recipient_only.sql', import.meta.url), 'utf8');
step('migration 055 adds exactly the columns the code writes', ['email_id', 'contact_id', 'ignored_open_count', 'last_ignored_reason'].every(c => new RegExp('ADD COLUMN IF NOT EXISTS ' + c + '\\b').test(mig)) && !/DROP /i.test(mig));
const trk = readFileSync(new URL('../routes/tracking.js', import.meta.url), 'utf8');
step('the pixel route no longer counts every request itself', !/open_count: \(data\.open_count \|\| 0\) \+ 1/.test(trk) && /openTracking\.recordOpen\(/.test(trk));

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
