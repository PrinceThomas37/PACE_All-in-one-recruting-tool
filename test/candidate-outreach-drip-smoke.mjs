// The candidate send-window switch (2026-09-09) removed the ONLY gate that
// was pacing a backlog release — up to that point, "8 rows overdue at once"
// and "the window just opened" were the same event, so nothing had ever
// exercised what happens when they are not. This is the one guard for that:
// run the REAL drainDueOutreach() over 8 overdue rows and prove the drip
// (DRAIN_PER_TICK cap + the 75-105s pause between real sends) still runs when
// the window is off, still works when the window is on, and that a settings
// table `drainDueOutreach()` cannot read stays OFF rather than silently
// re-imposing the barricade the owner asked removed.
//
// Every other line of the drain is the shipped one — only setTimeout is
// swapped so the pauses are OBSERVED (recorded, then fired immediately)
// rather than actually waited out. See docs/territories/_contracts.md C-0012.
//
// Usage: node test/candidate-outreach-drip-smoke.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail: String(detail) });

// A US timezone location and a fixed "now" that lands well outside the old
// 17:00-21:00 weekday window (16:45 America/New_York) — the exact shape of
// the 8 live rows this fix was written for.
const NOW_ISO = '2026-09-09T20:45:00Z';
const CAND_LOCATION = 'Broomall, PA';

// windowSetting: null → key absent (shipped default) · 'true' → switched on ·
// 'throw' → the settings query itself fails (must still mean OFF).
function buildRows() {
  const past = new Date(new Date(NOW_ISO).getTime() - 3600e3).toISOString();
  return Array.from({ length: 8 }, (_, i) => ({
    id: 'row' + i, candidate_id: 'c' + i, job_order_id: 'j1', to_email: `c${i}@example.com`,
    subject: 'Interested?', body: 'Hi, I am {{sender}}.', status: 'pending',
    send_after: past, mailbox_id: 'mb1', sent_by: 'u1', track_token: null, org_id: 'org1',
  }));
}

function runDrain(windowSetting) {
  const realSetTimeout = global.setTimeout;
  const pauses = [];
  global.setTimeout = (fn, ms) => {
    if (ms >= 1000) pauses.push(ms);
    return realSetTimeout(fn, 0);
  };

  const rows = buildRows();
  const cand = { id: 'c', current_location: CAND_LOCATION };
  const sent = [];
  const updates = [];

  function q(result) {
    const o = {};
    for (const m of ['select', 'eq', 'lte', 'gte', 'order', 'limit', 'in', 'update', 'insert', 'upsert', 'neq', 'is']) o[m] = () => o;
    o.maybeSingle = async () => result;
    o.single = async () => result;
    o.then = (res, rej) => Promise.resolve(result).then(res, rej);
    return o;
  }

  const supabase = {
    from(table) {
      if (table === 'candidate_outreach') {
        let lim = 100;
        const o = q({ data: rows, error: null });
        // The 6-per-tick cap depends on .limit() actually being honoured by
        // the fake — without this the cap looks broken even when it is not.
        o.limit = (n) => { lim = n; return o; };
        o.then = (res, rej) => Promise.resolve({ data: rows.slice(0, lim), error: null }).then(res, rej);
        o.update = (patch) => { updates.push(patch); return q({ data: null, error: null }); };
        return o;
      }
      if (table === 'candidates') return q({ data: cand, error: null });
      if (table === 'app_settings') {
        if (windowSetting === 'throw') { const bad = q({}); bad.maybeSingle = async () => { throw new Error('settings table unreadable'); }; return bad; }
        return q({ data: windowSetting === 'true' ? { value: 'true' } : null, error: null });
      }
      // .upsert() must exist on email_send_log — without it every send counts
      // as failed AFTER the mail has already gone out.
      if (table === 'email_send_log') return q({ data: { emails_sent: 0 }, error: null });
      return q({ data: null, error: null });
    },
  };

  const mod = require(path.join(ROOT, 'routes/candidate-outreach.js'));
  const { drainDueOutreach } = mod({
    supabase,
    auth: (req, res, next) => next(),
    today: () => NOW_ISO.slice(0, 10),
    withOrg: (qq) => qq, orgStamp: (o) => o,
    buildHtmlEmailBody: (b, extra) => `<html>${b}${extra || ''}</html>`,
    getMailboxSignature: async () => '',
    loadSuppressedSet: async () => new Set(),
    recruiterSendingMailbox: async () => null,
    sendMailboxNewMessage: async (mb, msg) => { sent.push({ at: Date.now(), to: msg.to }); },
    connectedMailboxById: async () => ({
      id: 'mb1', email_address: 'me@pace.test', display_name: 'Me',
      platform: 'Microsoft', is_active: true, daily_send_limit: 150,
    }),
    loadMailboxDelivState: async () => ({}),
    warmupLimit: () => null,
    settingsConfig: { getSetting: async () => 20 },
    isSendingPaused: () => false, isManagerPaused: () => false,
    getTimezoneFromLocation: () => 'EST', LEAD_TZ_IANA: { EST: 'America/New_York' },
    friendlySendError: (e) => e.message, logActivity: async () => {},
    addToSuppression: async () => {}, pixelLimiter: (req, res, next) => next(),
  });

  return drainDueOutreach().then((out) => {
    global.setTimeout = realSetTimeout;
    return { out, pauses, sent, updates };
  }).catch((err) => {
    global.setTimeout = realSetTimeout;
    throw err;
  });
}

const DRAIN_PER_TICK = 6;

(async () => {
  // ── 1. Window OFF (the shipped default: the key is absent) ───────────────
  {
    const { out, pauses, sent } = await runDrain(null);
    ok('8 overdue rows do NOT all go out in one tick', sent.length === DRAIN_PER_TICK, `${sent.length} sent`);
    ok('the tick is capped at DRAIN_PER_TICK', out.sent === DRAIN_PER_TICK, JSON.stringify(out));
    ok('nothing is deferred for the send window while it is off', !out.deferred, JSON.stringify(out));
    ok('there is a pause between every pair of real sends', pauses.length === sent.length - 1,
      `${pauses.length} pauses for ${sent.length} sends`);
    ok('every pause is 75-105 seconds — the drip, not a burst', pauses.length > 0 && pauses.every(p => p >= 75000 && p <= 105000),
      JSON.stringify(pauses));
  }

  // ── 2. Window explicitly ON — the switch must still WORK, or it is not one ──
  {
    const { out } = await runDrain('true');
    ok('with the window ON, all 8 out-of-hours candidates are deferred, none sent',
      out.sent === 0 && out.deferred === 6, JSON.stringify(out));
  }

  // ── 3. Settings table unreadable — must mean OFF, never a re-imposed barricade ──
  {
    const { out, sent } = await runDrain('throw');
    ok('an unreadable app_settings table still drains as if the window were off',
      sent.length === DRAIN_PER_TICK && out.sent === DRAIN_PER_TICK && !out.deferred,
      JSON.stringify(out));
  }

  // ── 4. The lead engine's window is a DIFFERENT function and stays untouched.
  // Not re-proven here (index.js boots a real server and cannot be required
  // standalone) — this asserts the existing static cross-check still exists
  // and still means something, per foundry's review of C-0012.
  {
    const { readFileSync } = await import('node:fs');
    const routeSrc = readFileSync(path.join(ROOT, 'routes/candidate-outreach.js'), 'utf8');
    ok('candidate outreach never calls the leads engine\'s window functions',
      !/isInLeadSendWindow|getSendWindowHours|formatWindowOpensLabel/.test(routeSrc));
    ok('index.js still defines the leads engine\'s window gate (untouched by this change)',
      /function\s+isInLeadSendWindow|isInLeadSendWindow\s*=/.test(readFileSync(path.join(ROOT, 'index.js'), 'utf8')) &&
      /function\s+getSendWindowHours|getSendWindowHours\s*=/.test(readFileSync(path.join(ROOT, 'index.js'), 'utf8')));
  }
})().catch((err) => {
  throw err;
}).finally(() => {
  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.detail ? ' — ' + r.detail : ''));
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
});
