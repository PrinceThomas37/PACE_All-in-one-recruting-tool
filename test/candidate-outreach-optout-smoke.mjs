// A CANDIDATE WHO OPTED OUT IS NOT EMAILED ON ANY OF THEIR ADDRESSES (R-114, D-0070).
//
// The owner agreed the safety rule: with several addresses per person, "who said stop" is one
// click away from being emailed on the address nobody checked. So every candidate send checks
// ALL of a person's addresses, not just the main one.
//
// routes/candidate-outreach.js mounted for real over an in-memory PostgREST:
//   part 1 — the BATCH QUEUE skips a person whose EXTRA address opted out (the main is fine),
//            still skips one whose main opted out, and queues everyone else
//   part 2 — the DRIP skips a row already queued to the main when the person has since opted
//            out on another address, and leaves a clean candidate's row alone
//   part 3 — the one-off tracked email (routes/recruiting/outreach.js POST /candidates/email)
// (The workflow "Email the candidate" step uses the same helper, firstSuppressed, over
// `candidates(*)`; it is not mounted here — see contact-points-smoke for the rule itself.)
import http from 'node:http';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const express = require('express');

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const ORG = 'org-a', ME = 'u1', MB = 'mb1';
const A = uid(), B = uid(), C = uid(), D = uid();
const db = createFakeDb({
  tables: {
    candidates: [
      // A: the MAIN is fine, an EXTRA opted out
      { id: A, org_id: ORG, full_name: 'Ada Extra', first_name: 'Ada', email: 'ada@ok.com', extra_emails: ['ada@stopped.com'], deleted_at: null },
      // B: nobody opted out, has an extra
      { id: B, org_id: ORG, full_name: 'Ben Clean', first_name: 'Ben', email: 'ben@ok.com', extra_emails: ['ben2@ok.com'], deleted_at: null },
      // C: the MAIN opted out (the case that always worked)
      { id: C, org_id: ORG, full_name: 'Cy Main', first_name: 'Cy', email: 'cy@stopped.com', extra_emails: [], deleted_at: null },
      // D: queued to the main earlier; they have SINCE opted out on an extra (drip case)
      { id: D, org_id: ORG, full_name: 'Di Later', first_name: 'Di', email: 'di@ok.com', extra_emails: ['di@stopped.com'], deleted_at: null },
    ],
    suppression_list: [{ email: 'ada@stopped.com' }, { email: 'cy@stopped.com' }, { email: 'di@stopped.com' }],
    candidate_outreach: [],
    organizations: [{ id: ORG, name: 'Acme Staffing' }],
    user_emails: [{ id: MB, user_id: ME, org_id: ORG, email_address: 'me@ours.com', display_name: 'Me', is_primary: true, is_active: true, platform: 'Microsoft' }],
    microsoft_tokens: [{ user_email_id: MB }],
  },
  defaults: { candidate_outreach: () => ({ id: uid(), created_at: new Date().toISOString() }) },
});
const loadSuppressedSet = async (emails) => {
  const { data } = await db.supabase.from('suppression_list').select('email').in('email', emails);
  return new Set((data || []).map(r => String(r.email).toLowerCase()));
};
const mailbox = { id: MB, email_address: 'me@ours.com', is_active: true };
const sentTo = [];
let paused = true;
const ctx = {
  supabase: db.supabase, today: () => '2026-10-05', withOrg: (q) => q.eq('org_id', ORG), orgStamp: () => ({ org_id: ORG }),
  auth: (req, res, next) => { req.user = { id: ME, role: 'recruiter', org_id: ORG }; req.orgId = ORG; next(); },
  buildHtmlEmailBody: (t) => String(t), getMailboxSignature: async () => '', loadSuppressedSet,
  recruiterSendingMailbox: async () => mailbox, sendMailboxNewMessage: async (mb, m) => { sentTo.push(m.to); },
  connectedMailboxById: async (id) => (id === MB ? mailbox : null), ownSendingMailboxes: async () => [mailbox], sendingMailboxFor: async () => mailbox,
  loadMailboxDelivState: async () => ({}), warmupLimit: () => 100, settingsConfig: { getSetting: async () => null },
  isSendingPaused: () => paused, isManagerPaused: () => false,
  getTimezoneFromLocation: () => null, LEAD_TZ_IANA: {}, friendlySendError: (m) => m, logActivity: async () => {},
  addToSuppression: async () => {}, pixelLimiter: (req, res, next) => next(),
};
const { router, drainDueOutreach } = require('../routes/candidate-outreach')(ctx);
const app = express(); app.use(express.json()); app.use(router);
// the one-off tracked email lives in the recruiting outreach module — mounted on its own app
const app2 = express(); app2.use(express.json());
const wfStub = new Proxy({}, { get: () => () => {} });
require('../routes/recruiting/outreach')(app2, {
  supabase: db.supabase, auth: ctx.auth, hasRole: () => true, today: ctx.today, wfEngine: wfStub, gmailProvider: {}, config: {},
  settingsConfig: ctx.settingsConfig, graphMailRequest: async () => ({}), sendMicrosoftNewMessage: async (id, m) => { sentTo.push(m.to); return { messageId: 'm1' }; },
  buildHtmlEmailBody: (t) => String(t), getMailboxSignature: async () => '', getMicrosoftToken: async () => 't', warmupLimit: () => 100,
  isSendingPaused: () => false, isManagerPaused: () => false, loadMailboxDelivState: async () => ({}), loadSuppressedSet, friendlySendError: (m) => m,
});
const srv2 = await new Promise(r => { const s = http.createServer(app2); s.listen(0, '127.0.0.1', () => r(s)); });
const API2 = 'http://127.0.0.1:' + srv2.address().port;
const srv = await new Promise(r => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
};

try {
  // ── part 1 — the batch queue ──────────────────────────────────────────────
  {
    const r = await call('POST', '/candidate-outreach/queue', { candidate_ids: [A, B, C], angle: 'nurture', mailbox_id: MB });
    step('the queue answers 201', r.status === 201, r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
    const skipped = (r.body && r.body.skipped) || [];
    const why = (id) => (skipped.find(s => s.candidate_id === id) || {}).reason;
    step('SAFETY: a person whose EXTRA address opted out is skipped as opted out — even though their main is fine', why(A) === 'opted_out', JSON.stringify(skipped));
    step('a person whose MAIN opted out is still skipped (unchanged)', why(C) === 'opted_out');
    step('a clean candidate (with an extra) is queued, to the MAIN address only', r.body && r.body.queued === 1 && db.tables.candidate_outreach.some(o => o.candidate_id === B && o.to_email === 'ben@ok.com') && !db.tables.candidate_outreach.some(o => o.to_email === 'ben2@ok.com'));
    step('nothing was queued for the opted-out people', !db.tables.candidate_outreach.some(o => o.candidate_id === A || o.candidate_id === C));
  }

  // ── part 2 — the drip ─────────────────────────────────────────────────────
  {
    db.tables.candidate_outreach.length = 0;
    db.tables.candidate_outreach.push(
      { id: 'o-di', org_id: ORG, candidate_id: D, to_email: 'di@ok.com', status: 'pending', send_after: '2026-10-05T00:00:00Z', sent_by: ME, mailbox_id: MB, subject: 's', body: 'b', angle: 'nurture' },
      { id: 'o-ben', org_id: ORG, candidate_id: B, to_email: 'ben@ok.com', status: 'pending', send_after: '2026-10-05T00:00:00Z', sent_by: ME, mailbox_id: null, subject: 's', body: 'b', angle: 'nurture' },
    );
    paused = false;
    const out = await drainDueOutreach();
    const o = (id) => db.tables.candidate_outreach.find(x => x.id === id);
    step('SAFETY: a row queued to the main is skipped when the person has since opted out on ANOTHER address', o('o-di').status === 'skipped' && /opted out/.test(o('o-di').fail_reason || ''), JSON.stringify(o('o-di')));
    step('…and nothing was sent to them', !sentTo.includes('di@ok.com') && !sentTo.includes('di@stopped.com'));
    step('a clean candidate\'s row is NOT skipped as opted out', o('o-ben').status !== 'skipped', JSON.stringify(out));
  }

  // ── part 3 — the one-off tracked email ────────────────────────────────────
  {
    sentTo.length = 0;
    const r = await fetch(API2 + '/candidates/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      subject: 'A role', body: 'Hello',
      recipients: [{ email: 'ada@ok.com', candidate_id: A, name: 'Ada' }, { email: 'ben@ok.com', candidate_id: B, name: 'Ben' }, { email: 'cold@nowhere.com', name: 'No id' }],
    }) });
    const j = await r.json();
    const st = (e) => (j.results || []).find(x => x.email === e) || {};
    step('the one-off email answers 200', r.status === 200, r.status + ' ' + JSON.stringify(j).slice(0, 160));
    step('SAFETY: the one-off email skips a candidate whose EXTRA address opted out', st('ada@ok.com').status === 'skipped' && st('ada@ok.com').reason === 'suppressed', JSON.stringify(j.results));
    step('…and does not send to them', !sentTo.includes('ada@ok.com'));
    step('a clean candidate is sent to, and so is a plain address with no candidate attached', st('ben@ok.com').status === 'sent' && st('cold@nowhere.com').status === 'sent');
  }
} catch (e) {
  step('suite ran to the end', false, String(e && e.stack || e).slice(0, 400));
}
srv.close(); srv2.close();
const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length} passed`);
process.exit(pass === results.length && results.length > 0 ? 0 : 1);
