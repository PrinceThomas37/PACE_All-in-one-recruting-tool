// WHY EMAILS SIT IN PENDING, AND WHY SOME NEVER SEND (Session 33, 2026-09-28).
// The owner: "some emails are in pending and a couple of them are not getting
// send after retry". Read off the live queue, three separate faults:
//   1. A Gmail follow-up replies inside the lead's earlier Gmail thread. When
//      the lead's sending mailbox was switched after its first email, that
//      thread lives in ANOTHER mailbox: Gmail answers 404 "Requested entity
//      was not found." on every try, and Retry only restarts the same four
//      tries. 14 live follow-ups. It now goes out fresh with the first email
//      quoted underneath (what Outlook always did) — ONLY on a definite
//      not-found, never after a timeout, which may mean it WAS sent.
//   2. A row claimed for sending by a process that then died stays at
//      'sending' — on no screen, never picked up again. 1 live email. Boot now
//      moves it to "Didn't send" as "may have gone out".
//   3. The Pending screen counted emails waiting out a retry and emails held
//      by the per-company daily limit (D-0046) as "ready now". 16 live emails.
//      Each pending email is now in exactly one bucket, and a held row says so.
// Parts 1-3 run the REAL modules and the REAL router; part 4 is a real browser.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

const gd = require(ROOT + '/services/gmail-delivery.js');
const sendRetry = require(ROOT + '/services/send-retry.js');
const { releaseInterruptedSends } = require(ROOT + '/services/interrupted-sends.js');
const { createGmailProvider } = require(ROOT + '/gmail-provider.js');
const INDEX = fs.readFileSync(ROOT + '/index.js', 'utf8');

// ════════════════════════════════════════════════════════════════════════════
// 1. A GMAIL FOLLOW-UP WHOSE THREAD IS IN ANOTHER MAILBOX
// ════════════════════════════════════════════════════════════════════════════
function fakeGmail({ threadError } = {}) {
  const calls = [];
  return {
    calls,
    async sendNewMessage(uid, opts) { calls.push({ kind: 'new', uid, ...opts }); return { messageId: 'm-new', threadId: 't-new' }; },
    async sendThreadReply(uid, opts) { calls.push({ kind: 'reply', uid, ...opts }); if (threadError) throw threadError; return { messageId: 'm-reply', threadId: opts.threadId }; },
  };
}
// The one read the module makes: the lead's earlier thread id.
function threadDb(row) {
  const asked = [];
  return {
    asked,
    from(table) {
      const q = { table, eq: {}, notNull: [] };
      const b = {
        select() { return b; },
        eq(c, v) { q.eq[c] = v; return b; },
        not(c, op, v) { if (op === 'is' && v === null) q.notNull.push(c); return b; },
        order() { return b; }, limit() { return b; },
        async maybeSingle() { asked.push(q); return { data: row || null, error: null }; },
      };
      return b;
    },
  };
}
const notFound = () => Object.assign(new Error('Requested entity was not found.'), { status: 404 });
const FU = { id: 'fu-1', job_id: 'job-1', contact_id: 'con-1', to_email: 'nicole@peak.test', subject: 'Re: Candidates for your Structural Engineer role', followup_type: 'fu1', from_email: 'spencer@fute.test' };
const MBX = { email_address: 'spencer@fute.test', platform: 'Gmail' };
const QUOTE = '<div class="q">From: daniel &lt;daniel@fute.test&gt; — the first email</div>';
const BODY = '<p>Circling back on your Structural Engineer role.</p>';
// A throw must FAIL a check, never crash the suite (a crashed mutant is not a
// caught one — harbour memory).
const attempt = async (fn) => { try { return { r: await fn(), err: null }; } catch (e) { return { r: undefined, err: e }; } };
const delivery = (gmail, db, buildQuote) => gd.createGmailDelivery({ supabase: db, gmailProvider: gmail, buildQuote: buildQuote || (async () => QUOTE) });

{ // the thread is in this mailbox → a true reply, nothing else
  const g = fakeGmail(); const db = threadDb({ conversation_id: 't-own' });
  const { r = {}, err } = await attempt(() => delivery(g, db).deliver(FU, 'mbx-s', BODY, MBX));
  ok('1a0. a follow-up into its own thread does not throw', !err, err && err.message);
  ok('1a. thread in this mailbox → one reply into it, subject untouched', g.calls.length === 1 && g.calls[0].kind === 'reply' && g.calls[0].threadId === 't-own' && g.calls[0].subject === FU.subject, JSON.stringify(g.calls));
  ok('1b. …and the thread id is what gets stored for the next follow-up', r.conversationId === 't-own' && r.graphMessageId === 'm-reply');
  ok('1c. the lookup asks for THIS lead and THIS person, with a thread', db.asked[0] && db.asked[0].eq.job_id === 'job-1' && db.asked[0].eq.contact_id === 'con-1' && db.asked[0].notNull.includes('conversation_id'), JSON.stringify(db.asked));
}
{ // the live case: Gmail refuses the thread → a fresh email, original quoted
  const g = fakeGmail({ threadError: notFound() });
  const got = await attempt(() => delivery(g, threadDb({ conversation_id: 't-daniel' })).deliver(FU, 'mbx-s', BODY, MBX));
  const r = got.r || {};
  const fresh = g.calls.find(c => c.kind === 'new');
  ok('1d0. a refused thread does not fail the send', !got.err, got.err && got.err.message);
  ok('1d. thread refused (404) → the follow-up still goes: one fresh email after the refused reply', g.calls.length === 2 && g.calls[0].kind === 'reply' && !!fresh, JSON.stringify(g.calls.map(c => c.kind)));
  ok('1e. …with "Re:" removed (no thread behind it)', fresh && fresh.subject === 'Candidates for your Structural Engineer role', fresh && fresh.subject);
  ok('1f. …the first email quoted underneath the follow-up', fresh && fresh.htmlBody === BODY + '<br><br>' + QUOTE);
  ok('1g. …from the mailbox that sends it, to the same person', fresh && fresh.fromAddress === 'spencer@fute.test' && fresh.to === 'nicole@peak.test');
  ok('1h. …and the NEW thread is stored, never the other mailbox\'s', r.conversationId === 't-new' && r.graphMessageId === 'm-new', JSON.stringify(r));
}
{ // Google's words alone are enough
  const g = fakeGmail({ threadError: new Error('Requested entity was not found.') });
  await attempt(() => delivery(g, threadDb({ conversation_id: 't-daniel' })).deliver(FU, 'mbx-s', BODY, MBX));
  ok('1i. refused with only Google\'s wording (no status) → still goes fresh', g.calls.map(c => c.kind).join(',') === 'reply,new');
}
{ // a timeout may mean it WAS sent — never a second copy
  const g = fakeGmail({ threadError: new Error('The operation was aborted due to timeout') });
  let threw = null;
  try { await delivery(g, threadDb({ conversation_id: 't-own' })).deliver(FU, 'mbx-s', BODY, MBX); } catch (e) { threw = e; }
  ok('1j. a timeout mid-reply is rethrown and NOTHING else is sent (it may have gone out)', !!threw && g.calls.length === 1 && g.calls[0].kind === 'reply', JSON.stringify(g.calls.map(c => c.kind)));
  ok('1k. …and the retry rules call that uncertain, never auto-retried', threw && sendRetry.classifyFailure(threw.message) === sendRetry.KIND.UNCERTAIN);
}
{ // a dead sign-in is not a missing thread
  const g = fakeGmail({ threadError: Object.assign(new Error('Invalid Credentials'), { status: 401 }) });
  let threw = null;
  try { await delivery(g, threadDb({ conversation_id: 't-own' })).deliver(FU, 'mbx-s', BODY, MBX); } catch (e) { threw = e; }
  ok('1l. a refused sign-in (401) is rethrown, no fresh email', !!threw && g.calls.length === 1);
}
{ // no earlier thread at all
  const g = fakeGmail();
  await attempt(() => delivery(g, threadDb(null)).deliver(FU, 'mbx-s', BODY, MBX));
  ok('1m. no earlier thread → fresh with the quote, "Re:" removed, no reply attempted', g.calls.length === 1 && g.calls[0].kind === 'new' && g.calls[0].subject === 'Candidates for your Structural Engineer role' && g.calls[0].htmlBody.endsWith(QUOTE));
}
{ // the quote can never be the reason a follow-up does not go
  const g = fakeGmail({ threadError: notFound() });
  await attempt(() => delivery(g, threadDb({ conversation_id: 't-daniel' }), async () => { throw new Error('db down'); }).deliver(FU, 'mbx-s', BODY, MBX));
  const fresh = g.calls.find(c => c.kind === 'new');
  ok('1n. the quote cannot be built → the follow-up still goes, without it', !!fresh && fresh.htmlBody === BODY);
}
{ // a first email is untouched by all of this
  const g = fakeGmail(); const db = threadDb({ conversation_id: 't-own' });
  const first = { ...FU, followup_type: null, subject: 'Re: looks like a reply but is a first email' };
  await attempt(() => delivery(g, db).deliver(first, 'mbx-s', BODY, MBX));
  ok('1o. a first email: one new message, subject and body exactly as queued, no thread lookup', g.calls.length === 1 && g.calls[0].kind === 'new' && g.calls[0].subject === first.subject && g.calls[0].htmlBody === BODY && db.asked.length === 0);
}
ok('1p. freshFollowup strips every leading "Re:" and nothing else', gd.freshFollowup({ subject: 'Re: RE: Re: Hiring re: plans', htmlBody: 'x' }).subject === 'Hiring re: plans');
ok('1q. isGmailNotFound: 404 yes, 401 no, a timeout no, nothing no', gd.isGmailNotFound({ status: 404 }) && gd.isGmailNotFound({ status: '404' }) && !gd.isGmailNotFound({ status: 401, message: 'x' }) && !gd.isGmailNotFound(new Error('timeout')) && !gd.isGmailNotFound(null));

// The REAL Gmail adapter, against a fake Google: the error it throws carries
// the status, and the whole path sends exactly one fresh email.
{
  const tokenDb = { from() { const b = { select() { return b; }, eq() { return b; }, async single() { return { data: { access_token: 'tok', expires_at: new Date(Date.now() + 3600e3).toISOString() }, error: null }; } }; return b; } };
  const provider = createGmailProvider({ supabase: tokenDb, google: { clientId: 'id', clientSecret: 'secret' } });
  const posts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body || '{}');
    posts.push({ url: String(url), body });
    if (body.threadId === 't-daniel') {
      return new Response(JSON.stringify({ error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ id: 'm-fresh', threadId: 't-fresh' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    let err = null;
    try { await provider.sendThreadReply('mbx-s', { to: 'nicole@peak.test', subject: FU.subject, htmlBody: BODY, threadId: 't-daniel' }); } catch (e) { err = e; }
    ok('1r. the real adapter\'s 404 carries its status, and reads as not-found', err && err.status === 404 && gd.isGmailNotFound(err), err && (err.status + ' ' + err.message));
    posts.length = 0;
    const real = gd.createGmailDelivery({ supabase: threadDb({ conversation_id: 't-daniel' }), gmailProvider: provider, buildQuote: async () => QUOTE });
    const { r = {} } = await attempt(() => real.deliver(FU, 'mbx-s', BODY, MBX));
    const raw = posts[1] ? Buffer.from(posts[1].body.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
    ok('1s. end to end: two calls to Google — the refused reply, then ONE fresh send with no thread', posts.length === 2 && posts[0].body.threadId === 't-daniel' && posts[1].body.threadId === undefined, JSON.stringify(posts.map(p => p.body.threadId)));
    ok('1t. …the message Google receives: no "Re:", the follow-up, then the first email', /\r\nSubject: Candidates for your Structural Engineer role\r\n/.test(raw) && raw.indexOf(BODY) > 0 && raw.indexOf(QUOTE) > raw.indexOf(BODY), raw.slice(0, 200).replace(/\r\n/g, ' | '));
    ok('1u. …and the fresh thread is what PACE stores', r.conversationId === 't-fresh');
  } finally { globalThis.fetch = realFetch; }
}

// The live path uses this module — and nothing else replies into a Gmail thread.
{
  const fn = (INDEX.match(/async function deliverViaGmail\([^)]*\) \{[\s\S]*?\n\}/) || [''])[0];
  ok('1v. index.js hands Gmail delivery to services/gmail-delivery.js — and returns ITS answer', /createGmailDelivery\(\{[^}]*buildQuote: buildQuotedChainFromDb/.test(fn) && /return gmailDelivery\.deliver\(email, userEmailId, htmlBody, sendingEmail\);/.test(fn) && (fn.match(/\breturn\b/g) || []).length === 1, fn.slice(0, 120));
}
ok('1w. index.js never replies into a Gmail thread itself (one place decides)', !/gmailProvider\.sendThreadReply\(/.test(INDEX));
ok('1x. the Outlook fresh follow-up is built by the same freshFollowup', /async function sendFollowupFreshWithQuote[\s\S]{0,700}freshFollowup\(/.test(INDEX));

// ════════════════════════════════════════════════════════════════════════════
// 2. A SEND CUT OFF MID-FLIGHT
// ════════════════════════════════════════════════════════════════════════════
{
  const u = sendRetry.interruptedUpdate({ attempt_count: 0 });
  ok('2a. an interrupted send is a FAILED, UNCERTAIN row with no next try', u.status === 'failed' && u.fail_kind === 'uncertain' && u.next_attempt_at === null && u.attempt_count === 1, JSON.stringify(u));
  ok('2b. …its reason says it may or may not have gone out', /may or may not have gone out/.test(u.fail_reason));
  const shown = { ...u, status: 'failed' };
  ok('2c. …the Email page tells the person to check Sent first', /may have gone out/.test(sendRetry.describeRetry(shown)) && /Check Sent/.test(sendRetry.describeRetry(shown)), sendRetry.describeRetry(shown));
  ok('2d. …and a person may still press Retry once they have checked', sendRetry.canRetryByHand(shown) === true);
  ok('2e. the attempt it cut off is counted', sendRetry.interruptedUpdate({ attempt_count: 2 }).attempt_count === 3);
}
function memEmails(rows, { beforeUpdate, selectError } = {}) {
  const T = rows.map(r => ({ ...r }));
  const writes = [];
  return {
    T, writes,
    from() {
      const st = { op: 'select', f: [], payload: null, limit: null };
      const b = {
        select() { return b; },
        update(p) { st.op = 'update'; st.payload = p; return b; },
        eq(c, v) { st.f.push([c, v]); return b; },
        order() { return b; },
        limit(n) { st.limit = n; return b; },
        then(res, rej) { return run().then(res, rej); },
      };
      async function run() {
        if (st.op === 'select' && selectError) return { data: null, error: { message: 'boom' } };
        const match = T.filter(r => st.f.every(([c, v]) => r[c] === v));
        if (st.op === 'select') {
          if (beforeUpdate) beforeUpdate(T);
          return { data: match.slice(0, st.limit || match.length).map(r => ({ id: r.id, attempt_count: r.attempt_count })), error: null };
        }
        writes.push({ filters: st.f.map(x => x.join('=')), payload: st.payload });
        match.forEach(r => Object.assign(r, st.payload));
        return { data: match.map(r => ({ id: r.id })), error: null };
      }
      return b;
    },
  };
}
{
  const db = memEmails([
    { id: 's1', status: 'sending', attempt_count: 0 },
    { id: 's2', status: 'sending', attempt_count: 2 },
    { id: 'p1', status: 'pending', attempt_count: 0 },
    { id: 'x1', status: 'sent', attempt_count: 1 },
    { id: 'f1', status: 'failed', attempt_count: 4, fail_kind: 'temporary', fail_reason: 'kept' },
  ]);
  const n = await releaseInterruptedSends(db);
  const by = Object.fromEntries(db.T.map(r => [r.id, r]));
  ok('2f. boot moves every row left at "sending", and says how many', n === 2 && by.s1.status === 'failed' && by.s1.fail_kind === 'uncertain' && by.s2.status === 'failed' && by.s2.attempt_count === 3, JSON.stringify(db.T));
  ok('2g. …and touches nothing else (pending, sent and failed rows unchanged)', by.p1.status === 'pending' && by.x1.status === 'sent' && by.f1.fail_reason === 'kept' && !by.p1.fail_kind);
  ok('2h. …every write is conditional on the row STILL being "sending"', db.writes.length === 2 && db.writes.every(w => w.filters.includes('status=sending')), JSON.stringify(db.writes.map(w => w.filters)));
}
{ // the old process finishes between our read and our write: its answer stands
  const db = memEmails([{ id: 's3', status: 'sending', attempt_count: 0 }], { beforeUpdate: (T) => { T[0].status = 'sent'; } });
  const n = await releaseInterruptedSends(db);
  ok('2i. a send that finished in the meantime keeps "sent" and is not counted', n === 0 && db.T[0].status === 'sent' && !db.T[0].fail_kind, JSON.stringify(db.T));
}
{
  let threw = false, n = -1;
  try { n = await releaseInterruptedSends(memEmails([], { selectError: true })); } catch (_) { threw = true; }
  ok('2j. a database error never stops the server starting (0, no throw)', !threw && n === 0);
}
ok('2k. index.js runs the recovery at boot', /\nreleaseInterruptedSends\(supabase\)/.test(INDEX));

// ════════════════════════════════════════════════════════════════════════════
// 3. THE PENDING SUMMARY — through the REAL router and models/ layer
// ════════════════════════════════════════════════════════════════════════════
const express = require(ROOT + '/node_modules/express');
const { createDb } = require(ROOT + '/models');
const createAuthorize = require(ROOT + '/middleware/authorize.js');
const TODAY = '2026-09-28';
const A = 'org-A', B = 'org-B';
const future = new Date(Date.now() + 3600e3).toISOString();
const past = new Date(Date.now() - 3600e3).toISOString();
function fixture() {
  return {
    users: [
      { id: 'b1', org_id: A, name: 'BD One', roles: ['bd'] },
      { id: 'rl', org_id: A, name: 'RA Lead', roles: ['ra_lead'] },
      { id: 'aA', org_id: A, name: 'Admin A', roles: ['admin'] },
    ],
    jobs: [
      { id: 'jA', org_id: A, company_id: 'co1', timezone: 'EST', assigned_to_bd: 'b1' },
      { id: 'jA2', org_id: A, company_id: 'co1', timezone: 'EST', assigned_to_bd: 'b1' },
      { id: 'jB', org_id: A, company_id: 'co2', timezone: 'EST', assigned_to_bd: 'b1' },
      { id: 'jC', org_id: A, company_id: 'co3', timezone: 'PST', assigned_to_bd: 'b1' },
      // Another organisation, same company id: its sends must never hold ours.
      { id: 'jX', org_id: B, company_id: 'co2', timezone: 'EST', assigned_to_bd: 'bB' },
    ],
    contacts: [],
    emails: [
      // co1 already had its two first emails today (one with no followup_type at all)
      { id: 's1', org_id: A, sent_by: 'b1', job_id: 'jA2', status: 'sent', followup_type: 'initial', sent_at: TODAY },
      { id: 's2', org_id: A, sent_by: 'b1', job_id: 'jA2', status: 'sent', followup_type: null, sent_at: TODAY },
      { id: 's3', org_id: A, sent_by: 'b1', job_id: 'jA', status: 'sent', followup_type: 'fu1', sent_at: TODAY },
      // co2: one today, one yesterday — under the limit
      { id: 's4', org_id: A, sent_by: 'b1', job_id: 'jB', status: 'sent', followup_type: 'initial', sent_at: TODAY },
      { id: 's5', org_id: A, sent_by: 'b1', job_id: 'jB', status: 'sent', followup_type: 'initial', sent_at: '2026-09-27' },
      { id: 'xB1', org_id: B, sent_by: 'bB', job_id: 'jX', status: 'sent', followup_type: 'initial', sent_at: TODAY },
      { id: 'xB2', org_id: B, sent_by: 'bB', job_id: 'jX', status: 'sent', followup_type: 'initial', sent_at: TODAY },
      // the queue
      { id: 'p1', org_id: A, sent_by: 'b1', job_id: 'jA', status: 'pending', followup_type: 'initial', attempt_count: 0, next_attempt_at: null, created_at: '1' },
      { id: 'p2', org_id: A, sent_by: 'b1', job_id: 'jB', status: 'pending', followup_type: 'initial', attempt_count: 0, next_attempt_at: null, created_at: '2' },
      { id: 'p3', org_id: A, sent_by: 'b1', job_id: 'jA', status: 'pending', followup_type: 'fu1', attempt_count: 0, next_attempt_at: null, created_at: '3' },
      { id: 'p4', org_id: A, sent_by: 'b1', job_id: 'jB', status: 'pending', followup_type: 'initial', attempt_count: 2, next_attempt_at: future, created_at: '4' },
      { id: 'p5', org_id: A, sent_by: 'b1', job_id: 'jC', status: 'pending', followup_type: 'initial', attempt_count: 1, next_attempt_at: past, created_at: '5' },
      { id: 'p6', org_id: A, sent_by: 'b1', job_id: 'jC', status: 'pending', followup_type: 'initial', attempt_count: 0, next_attempt_at: null, created_at: '6' },
    ],
    app_settings: [],
  };
}
function memSupabase(T) {
  const byId = (t, id) => (T[t] || []).find(r => r.id === id) || null;
  function from(table) {
    const st = { f: [], orders: [], range: null, limit: null };
    const b = {
      select() { return b; },
      eq(c, v) { st.f.push(r => (r[c] === undefined ? null : r[c]) === v); return b; },
      in(c, vs) { st.f.push(r => vs.includes(r[c])); return b; },
      not(c, op, v) { if (op === 'is' && v === null) st.f.push(r => r[c] != null); return b; },
      order(c, o) { st.orders.push([c, !(o && o.ascending === false)]); return b; },
      range(a, z) { st.range = [a, z]; return b; },
      limit(n) { st.limit = n; return b; },
      maybeSingle() { st.one = true; return run(); },
      then(res, rej) { return run().then(res, rej); },
    };
    async function run() {
      let rows = (T[table] || []).filter(r => st.f.every(fn => fn(r)));
      for (const [c, asc] of [...st.orders].reverse()) rows = [...rows].sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (asc ? 1 : -1));
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (st.limit != null) rows = rows.slice(0, st.limit);
      if (table === 'emails') rows = rows.map(r => ({ ...r, job: byId('jobs', r.job_id) }));
      if (st.one) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    return b;
  }
  return { from };
}
async function bootEmails(T) {
  // Fresh copies, so a stored limit is read rather than a cached default.
  for (const m of ['/config/settings.js', '/routes/emails.js']) delete require.cache[require.resolve(ROOT + m)];
  const supabase = memSupabase(T);
  const { hasRole } = createAuthorize({ supabase });
  const auth = (req, res, next) => {
    const u = T.users.find(x => x.id === req.headers['x-user']);
    if (!u) return res.status(401).json({ error: 'no user' });
    req.user = { id: u.id, org_id: u.org_id, roles: u.roles, role: u.roles[0] }; req.orgId = u.org_id; next();
  };
  const ctx = {
    supabase, db: createDb(supabase), auth, hasRole,
    orgIdFor: (req) => (req && req.user && req.user.org_id) || null,
    today: () => TODAY, logActivity: async () => {},
    getSendWindowHours: async () => ({ start: 8, end: 16 }),
    isInLeadSendWindow: (tz) => tz !== 'PST',
    getMinutesUntilWindowOpens: () => 60, formatWindowOpensLabel: () => 'Tomorrow, 8:00 AM', padHour: (h) => String(h),
    sendProgressCache: new Map(),
  };
  const app = express(); app.use(express.json());
  app.use(require(ROOT + '/routes/emails.js')(ctx));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  const get = (who, p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { 'x-user': who } }, (res) => {
      let out = ''; res.on('data', d => { out += d; }); res.on('end', () => { try { resolve(JSON.parse(out)); } catch (_) { resolve(out); } });
    }).on('error', reject);
  });
  return { get, close: () => server.close() };
}
{
  const { get, close } = await bootEmails(fixture());
  const s = await get('b1', '/emails/pending-summary');
  ok('3a. the summary rendered (six pending emails in this queue)', s && s.total_pending === 6, JSON.stringify(s));
  ok('3b. an email waiting out a retry is "waiting to retry", not "ready now"', s.waiting_retry === 1, JSON.stringify(s));
  ok('3c. the third first email to a company already emailed twice today is "held until tomorrow"', s.held_company === 1 && JSON.stringify(s.held_ids) === '["p1"]', JSON.stringify(s.held_ids));
  ok('3d. "ready now" is only what the next run will really try (the under-limit first email + the follow-up)', s.ready_now === 2, 'ready_now=' + s.ready_now);
  ok('3e. outside the lead\'s send window is still "waiting for the send window" (incl. a retry that is due)', s.waiting_window === 2, 'waiting_window=' + s.waiting_window);
  ok('3f. every pending email is in exactly one bucket', s.ready_now + s.waiting_window + s.waiting_retry + s.held_company === s.total_pending);
  ok('3g. the limit in force is reported with it', s.company_daily_cap === 2);
  ok('3h. another organisation\'s emails to the "same" company never hold ours', !(s.held_ids || []).includes('p2'));
  const rl = await get('rl', '/emails/pending-summary');
  ok('3i. an RA Lead gets the counts but never the row ids (D4)', rl.held_company === 1 && !('held_ids' in rl), JSON.stringify(rl));
  const aA = await get('aA', '/emails/pending-summary');
  ok('3j. an admin gets the held rows for the whole organisation', JSON.stringify(aA.held_ids) === '["p1"]');
  close();
}
{
  const T = fixture();
  T.app_settings.push({ id: 'set', key: 'sys_company_daily_first_emails', value: '0' });
  const { get, close } = await bootEmails(T);
  const s = await get('b1', '/emails/pending-summary');
  ok('3k. limit set to 0 (off) → nothing is held, the email is ready', s.held_company === 0 && s.ready_now === 3 && s.company_daily_cap === 0, JSON.stringify(s));
  close();
}

// ════════════════════════════════════════════════════════════════════════════
// 4. THE PENDING TAB, IN A BROWSER
// ════════════════════════════════════════════════════════════════════════════
const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUBLIC_DIR, p), (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
});
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;
const API = 'https://fute-lms-backend.onrender.com';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const b = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (b && fs.existsSync(path.join(b, 'chromium'))) return path.join(b, 'chromium');
  return 'chromium';
}
const row = (id, to, extra) => ({ id, to_email: to, subject: 'Candidates for your Project Manager role', body: 'Hi', status: 'pending', followup_type: 'initial', attempt_count: 0, is_mine: true, job: { position: 'Project Manager', timezone: 'EST', company: { name: 'Acme Builders' } }, contact: { first_name: 'Pat', last_name: 'Lee' }, ...extra });
const PENDING = [
  row('p1', 'held@acme.test'),
  row('p2', 'ready@beta.test', { job: { position: 'Estimator', timezone: 'EST', company: { name: 'Beta Co' } } }),
  row('p4', 'retry@beta.test', { attempt_count: 2, next_attempt_at: future, retry_note: 'Retry 2 of 3 in about 1 h' }),
];
const SUMMARY = { total_pending: 3, ready_now: 1, waiting_window: 0, waiting_retry: 1, held_company: 1, held_ids: ['p1'], company_daily_cap: 2, by_timezone: [{ timezone: 'EST', pending: 3, ready_now: 1, waiting_window: 0, resumes_label: '' }], send_window: { start: 8, end: 16 }, send_window_label: '8:00 AM – 4:00 PM lead local time' };
async function api(route) {
  const u = new URL(route.request().url()), p = u.pathname, meth = route.request().method();
  const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (meth === 'GET' && p === '/emails' && u.searchParams.get('status') === 'pending') return json(PENDING);
  if (meth === 'GET' && p === '/emails/pending-summary') return json(SUMMARY);
  return json(meth === 'GET' ? [] : {});
}
let browser; const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await bctx.route('**', r => { const u = r.request().url(); if (u.startsWith(BASE)) return r.continue(); if (u.startsWith(API)) return api(r); return r.abort(); });
  const page = await bctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForLogin(page); await enterApp(page, 'bd');
  await page.evaluate(() => { goPage('email'); setEmailTab('pending'); });
  await page.waitForFunction(() => (document.getElementById('content') || {}).innerText && document.getElementById('content').innerText.includes('held@acme.test'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const text = await page.evaluate(() => (document.getElementById('content') || {}).innerText || '');
  const rowText = (addr) => page.evaluate((a) => { const td = [...document.querySelectorAll('#content tr')].find(tr => tr.innerText.includes(a)); return td ? td.innerText : ''; }, addr);
  ok('4a. the Pending tab rendered its three rows (proven before judging them)', ['held@acme.test', 'ready@beta.test', 'retry@beta.test'].every(a => text.includes(a)), text.slice(0, 160));
  ok('4b. the line under the tab names all four states', /1 ready now · 0 waiting for the send window · 1 waiting to retry · 1 held until tomorrow/.test(text));
  ok('4b2. the count above the list says "pending", never that all of them are "ready"', /3 pending emails · page 1 of 1/.test(text) && !/emails ready/.test(text));
  const held = await rowText('held@acme.test');
  ok('4c. the held row says "Held · goes tomorrow" — and not "Ready now"', /Held · goes tomorrow/.test(held) && !/Ready now/.test(held), held.replace(/\s+/g, ' '));
  const heldTip = await page.evaluate(() => { const c = document.querySelector('#content .held-chip'); return c ? c.getAttribute('title') : ''; });
  ok('4d. …and its tooltip says why', /2 people at this company already got a first email today/.test(heldTip || ''), heldTip);
  ok('4e. the row the next run will send still says "Ready now"', /Ready now/.test(await rowText('ready@beta.test')));
  ok('4f. the retrying row keeps its own retry note', /Retry 2 of 3 in about 1 h/.test(await rowText('retry@beta.test')));
  // R-141: the separate "Pending send schedule" panel is gone (owner: "i miss the simplicity"). Its two explanations live on the
  // one-line summary's hover text instead — still in words, one hover away, never lost.
  const lineTip = await page.evaluate(() => { const l = [...document.querySelectorAll('#content span[title]')].find(e => /held until tomorrow/.test(e.textContent)); return l ? l.getAttribute('title') : ''; });
  ok('4g. the summary line explains the hold in words (hover)', /Held until tomorrow: the company already got its 2 first emails? today/.test(lineTip), lineTip);
  ok('4h. …and the retry', /Waiting to retry: a send failed and PACE tries again by itself/.test(lineTip), lineTip);
  ok('4i. the panel itself is gone', !/Pending send schedule/.test(text));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'pending-explained.png'), fullPage: false });
  ok('4i. no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) { ok('4. browser part ran', false, e && e.stack || String(e)); }
finally { if (browser) await browser.close(); server.close(); }

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
