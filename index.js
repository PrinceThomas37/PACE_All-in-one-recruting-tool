require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { parseJobDescription, buildResearchFromLeadData, normalizeIndustry, normalizeJobTitle, titleSimilarity } = require('./jd-parser');
const { learnSkillsForIndustry } = require('./learned-skills');
const { fetchWithRetry, fetchWithTimeout } = require('./http-client');
const { createRateLimiter, clientIp } = require('./middleware/rate-limit');
const { createDb } = require('./models');
const conversationIntel = require('./conversation-intel');

// Outbound call budgets. Graph and the token endpoint sit on the critical path
// of the background sweeps, which run in the single web process — an untimed
// call there stalls every other job behind it.
const GRAPH_TIMEOUT_MS = 20000;
const OAUTH_TIMEOUT_MS = 15000;
const AI_TIMEOUT_MS = 30000;

function persistLearnedSkills(industry, research) {
  if (!research || !research.requirements) return;
  const key = normalizeIndustry(industry);
  if (!key) return;
  const req = research.requirements;
  const skills = [req.skill_1, req.skill_2, req.skill_3, ...(req.skills || []), ...(req.suggested_skills || [])].filter(Boolean);
  learnSkillsForIndustry(key, skills);
}
const {
  DEFAULT_TEMPLATES,
  buildEmailVars,
  fillTemplate,
  resolveTemplate,
  DEFER_SENDER,
  senderIdentityFor,
  renderStoredEmail,
  buildRotatingTemplateDeck,
  isRandomTemplateMode,
  getVariantById
} = require('./email-vars');
const {
  DEFAULT_SIGNATURE_HTML,
  mailboxSignatureKey,
  legacyUserSignatureKey,
  fillSignatureHtml,
  resolveSignatureHtml
} = require('./email-signature');
const {
  emailSyntaxValid,
  emailDomain,
  classifyEmailDeliverability,
  annotateContactEmailStatus
} = require('./email-validation');
const { EVENTS, emit, on } = require('./events');
const registerSubscribers = require('./subscribers');
const { scoreEmailContent, deliverabilityFlags, isOptOutReply } = require('./deliverability');
const { loadConfig } = require('./config/env');
const settingsConfig = require('./config/settings');
const { createWarmupEngine, WARMUP_HEADER } = require('./warmup-engine');
const { createGmailProvider } = require('./gmail-provider');
const { orderPendingForSend } = require('./send-queue-order');
const { newToken: newTrackToken, injectPixel: injectTrackPixel } = require('./email-tracking');
const { recordRefreshOutcome } = require('./mailbox-health');
const { createEngineRunner } = require('./engine-runs');

// Validate environment and centralize config at startup (fails fast with a
// clear message if a required secret is missing).
const config = loadConfig();

const app = express();
const PORT = config.port;

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

// Org-scoped data access. Through `db` you cannot query a tenant table without
// declaring which org it is for — the alternative is remembering withOrg() on
// every one of ~574 hand-written queries, which is how four cross-org leaks
// reached the codebase in a single session. See models/index.js.
// Migration is incremental and per-module: `supabase` stays available, so an
// unconverted call site keeps working exactly as before.
const db = createDb(supabase);

// Every recurring background job registers here instead of owning a bare
// setInterval. Due-ness is persisted in the DB, so an external pinger (needed
// because Render's free tier sleeps this process) and the in-process intervals
// can both drive the same work without ever double-running it. Jobs are
// registered further down, next to the functions they call.
const engineRunner = createEngineRunner({ supabase });

// ── MIDDLEWARE ─────────────────────────────────────────────────
// Render terminates TLS at its own proxy and forwards, so without this every
// request reports the proxy's address as req.ip and the rate limiters below
// would count the entire internet as one client. Trust exactly ONE hop — the
// platform's — so a client cannot spoof its way past a limit by sending its
// own X-Forwarded-For.
app.set('trust proxy', 1);
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
// `verify` keeps the raw bytes on the request. Stripe signs the exact body it
// sent, so a re-serialised object cannot be verified — see routes/plans.js.
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// ── Rate limits on the unauthenticated surface ─────────────────
// Everything else sits behind `auth`. These three are reachable by anyone, and
// each of them costs the single web process real work per hit.
//
// Login gets TWO limiters because they stop different attacks: per-IP stops one
// host spraying many accounts; per-email stops a distributed guess at one
// account. Both are far above what a human mistyping a password will hit.
const loginIpLimiter = createRateLimiter({
  name: 'login-ip', windowMs: 15 * 60 * 1000, max: 30,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
  onLimit: (req) => console.warn(`[rate-limit] login blocked for ip ${clientIp(req)}`),
});
const loginEmailLimiter = createRateLimiter({
  name: 'login-email', windowMs: 15 * 60 * 1000, max: 10,
  keyFn: (req) => String(req.body?.email || '').toLowerCase().trim() || null,
  message: 'Too many sign-in attempts for this account. Please wait a few minutes and try again.',
  onLimit: (req) => console.warn(`[rate-limit] login blocked for account ${String(req.body?.email || '').toLowerCase().trim()}`),
});
app.use('/auth/login', loginIpLimiter, loginEmailLimiter);

// The heartbeat is key-gated, but the key check runs after the request is
// accepted, so unbounded probing is still free work. Generous: a legitimate
// pinger runs a few times an hour, and the endpoint is deliberately safe to
// call often.
app.use('/cron/tick', createRateLimiter({ name: 'cron', windowMs: 60 * 1000, max: 60 }));

// Signup requests and the org-domain lookup are unauthenticated too. The domain
// lookup in particular answers "do you know this company", so an unbounded one
// is a free enumeration oracle.
app.use('/auth/signup-request', createRateLimiter({ name: 'signup', windowMs: 60 * 60 * 1000, max: 10 }));
app.use('/auth/sso/for-domain', createRateLimiter({ name: 'sso-domain', windowMs: 15 * 60 * 1000, max: 60 }));

// The pixel is NOT given a 429 — see routes/tracking.js. A mail client that
// gets an error instead of an image shows a broken-image box to the recipient,
// which is a worse outcome than an uncounted open. The limiter is passed in and
// used to skip the DB write instead.
const pixelLimiter = createRateLimiter({ name: 'pixel', windowMs: 60 * 1000, max: 120 });

// ── Multi-tenant context ───────────────────────────────────────
// Every request carries an org context (req.orgId). Until every user record and
// token carries an org_id, we fall back to the platform's default (first) org so
// single-tenant behaviour is unchanged. DEFAULT_ORG_ID is resolved once at boot.
let DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || null;
// Is more than one organisation possible on this deployment? That question
// changes what "no org on the session" MEANS. With one org it is a harmless
// legacy token and defaulting is right; with several it is a session we cannot
// scope, and defaulting would hand it the first org's data — a real customer's.
let MULTI_ORG = require('./services/provisioning').selfServeEnabled();
const { isRecyclable } = require('./services/lead-recycle');
// One door to every AI provider (Anthropic, Groq, OpenRouter, self-hosted
// Ollama). Returns null when none is usable, and every caller has a rules
// fallback behind that null.
const aiProvider = require('./services/ai-provider');
async function resolveDefaultOrg() {
  try {
    const { data } = await supabase.from('organizations').select('id')
      .order('created_at', { ascending: true }).limit(2);
    if (Array.isArray(data)) {
      if (!DEFAULT_ORG_ID && data[0]) DEFAULT_ORG_ID = data[0].id;
      if (data.length > 1) MULTI_ORG = true;
    }
  } catch (_) { /* organizations table absent — leave null, column defaults cover it */ }
  return DEFAULT_ORG_ID;
}
resolveDefaultOrg();
// Exposed so route modules can stamp/scope by the caller's org.
//
// The DEFAULT_ORG_ID fallback stays exactly as it was, deliberately: background
// sweeps and cron ticks call withOrg() with no user, and returning null there
// would turn a scoped query into an unscoped one — the opposite of a fix. What
// closes the hole is auth() below, which refuses an org-less USER SESSION
// outright once more than one organisation can exist, so no request that
// carries a person ever reaches this fallback.
function orgIdFor(req) { return (req && req.user && req.user.org_id) || DEFAULT_ORG_ID || null; }
// Same withOrg/orgStamp pattern as bd_recruiter_routes.js, for the leads/email
// engine's own queries (jobs/companies/contacts live here, not in that module).
function withOrg(query, req) { const o = orgIdFor(req); return o ? query.eq('org_id', o) : query; }
function orgStamp(req) { const o = orgIdFor(req); return o ? { org_id: o } : {}; }

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.replace('Bearer ', '');
  // There is deliberately no unauthenticated bypass here any more. A "guest"
  // token used to hand anyone read-only access to the DEFAULT org — which is a
  // real customer's live data. That was defensible while PACE was one company's
  // internal tool and is not once strangers can sign up. If a product tour comes
  // back it must be served from its own seeded org, never from this one.
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
  // A session with no organisation on it cannot be scoped. While there is only
  // one org that is harmless (it defaults there anyway), but the moment a
  // second exists, "no org" would silently mean "the first org" — i.e. somebody
  // else's candidates, leads and mailboxes. Every token minted since
  // multi-tenancy landed carries org_id, so this only ever catches a stale one,
  // and the fix for a stale token is to sign in again.
  if (MULTI_ORG && !claims.org_id) {
    return res.status(401).json({ error: 'Your session is out of date. Please sign in again.' });
  }
  req.user = claims;
  req.orgId = orgIdFor(req);
  next();
}

// Authorization helpers (hasRole, canTouchJob, requireRole) live in
// middleware/authorize.js. canTouchJob needs the Supabase client, so the module
// is a factory. Behaviour is identical to the previous inline definitions.
const { hasRole, canTouchJob, requireRole } = require('./middleware/authorize')({ supabase });

const today = () => new Date().toISOString().split('T')[0];

const US_TZ_MAP = {
  ny: 'EST', nj: 'EST', fl: 'EST', ma: 'EST', pa: 'EST', ga: 'EST', nc: 'EST', sc: 'EST', va: 'EST',
  ct: 'EST', me: 'EST', nh: 'EST', vt: 'EST', ri: 'EST', de: 'EST', md: 'EST', dc: 'EST', oh: 'EST',
  mi: 'EST', in: 'EST', ky: 'EST', wv: 'EST', tn: 'EST',
  tx: 'CST', il: 'CST', mn: 'CST', wi: 'CST', mo: 'CST', ia: 'CST', ks: 'CST', ne: 'CST', sd: 'CST',
  nd: 'CST', ok: 'CST', la: 'CST', ar: 'CST', ms: 'CST', al: 'CST',
  co: 'MST', az: 'MST', nm: 'MST', ut: 'MST', wy: 'MST', mt: 'MST', id: 'MST',
  ca: 'PST', wa: 'PST', or: 'PST', nv: 'PST', ak: 'PST', hi: 'PST'
};
const LEAD_TZ_IANA = {
  EST: 'America/New_York', EDT: 'America/New_York',
  CST: 'America/Chicago', CDT: 'America/Chicago',
  MST: 'America/Denver', MDT: 'America/Denver',
  PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  Unknown: 'America/New_York'
};
const PENDING_EMAIL_JOB_SELECT = 'id, to_email, subject, body, contact_id, job_id, from_email, followup_type, follow_up_id, job:jobs(timezone, sending_email_id, sending_email:user_emails!sending_email_id(id,email_address,display_name,platform,daily_send_limit,is_active))';

function getTimezoneFromLocation(location) {
  if (!location) return 'EST';
  const loc = String(location).toLowerCase();
  for (const [state, tz] of Object.entries(US_TZ_MAP)) {
    if (loc.includes(state)) return tz;
  }
  return 'EST';
}

let sendWindowCache = { start: 8, end: 16, loadedAt: 0 };
async function getSendWindowHours() {
  if (Date.now() - sendWindowCache.loadedAt < 60000) {
    return { start: sendWindowCache.start, end: sendWindowCache.end };
  }
  let start = 8;
  let end = 16;
  try {
    const { data } = await supabase.from('app_settings').select('key,value').in('key', ['send_window_start_hour', 'send_window_end_hour']);
    (data || []).forEach(r => {
      const n = parseInt(r.value, 10);
      if (r.key === 'send_window_start_hour' && !Number.isNaN(n) && n >= 0 && n <= 23) start = n;
      if (r.key === 'send_window_end_hour' && !Number.isNaN(n) && n >= 1 && n <= 24) end = n;
    });
  } catch (_) {}
  sendWindowCache = { start, end, loadedAt: Date.now() };
  return { start, end };
}

function getLocalMinutesInLeadZone(tz, date = new Date()) {
  const iana = LEAD_TZ_IANA[tz] || LEAD_TZ_IANA.EST;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: iana, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return hour * 60 + minute;
}

function isInLeadSendWindow(tz, date = new Date(), window = { start: 8, end: 16 }) {
  const mins = getLocalMinutesInLeadZone(tz || 'EST', date);
  return mins >= window.start * 60 && mins < window.end * 60;
}

function getMinutesUntilWindowOpens(tz, date = new Date(), window = { start: 8, end: 16 }) {
  if (isInLeadSendWindow(tz, date, window)) return 0;
  const mins = getLocalMinutesInLeadZone(tz || 'EST', date);
  const startMins = window.start * 60;
  if (mins < startMins) return startMins - mins;
  return (24 * 60 - mins) + startMins;
}

function formatWindowOpensLabel(tz, window, date = new Date()) {
  const minsUntil = getMinutesUntilWindowOpens(tz, date, window);
  if (minsUntil <= 0) return 'Now';
  const iana = LEAD_TZ_IANA[tz] || LEAD_TZ_IANA.EST;
  const openAt = new Date(date.getTime() + minsUntil * 60000);
  const fmtDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: iana, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const dayWord = fmtDay(openAt) === fmtDay(date) ? 'Today' : 'Tomorrow';
  const timeStr = new Intl.DateTimeFormat('en-US', { timeZone: iana, hour: 'numeric', minute: '2-digit', hour12: true }).format(openAt);
  return `${dayWord} ${timeStr} ${tz || 'EST'}`;
}

function padHour(h) {
  const hr = h % 12 || 12;
  const ap = h < 12 ? 'AM' : 'PM';
  return `${hr}:00 ${ap}`;
}

let bulkSendSettingsCache = { loadedAt: 0, delayMin: 30, delayMax: 60, domainMaxPerHour: 8, defaultDailyLimit: 300, maxPerRun: 0 };

async function getBulkSendSettings() {
  if (Date.now() - bulkSendSettingsCache.loadedAt < 60000) return bulkSendSettingsCache;
  let delayMin = 30, delayMax = 60, domainMaxPerHour = 8, defaultDailyLimit = 300, maxPerRun = 0;
  try {
    const { data } = await supabase.from('app_settings').select('key,value').in('key', [
      'send_delay_min_sec', 'send_delay_max_sec', 'domain_max_per_hour',
      'default_daily_send_limit', 'bulk_send_max_per_run'
    ]);
    (data || []).forEach(r => {
      const n = parseInt(r.value, 10);
      if (r.key === 'send_delay_min_sec' && !Number.isNaN(n) && n >= 1 && n <= 300) delayMin = n;
      if (r.key === 'send_delay_max_sec' && !Number.isNaN(n) && n >= 1 && n <= 600) delayMax = n;
      if (r.key === 'domain_max_per_hour' && !Number.isNaN(n) && n >= 1 && n <= 100) domainMaxPerHour = n;
      if (r.key === 'default_daily_send_limit' && !Number.isNaN(n) && n >= 1) defaultDailyLimit = n;
      if (r.key === 'bulk_send_max_per_run' && !Number.isNaN(n) && n >= 0) maxPerRun = n;
    });
  } catch (_) {}
  if (delayMax < delayMin) delayMax = delayMin;
  bulkSendSettingsCache = { loadedAt: Date.now(), delayMin, delayMax, domainMaxPerHour, defaultDailyLimit, maxPerRun };
  return bulkSendSettingsCache;
}

async function getMailboxDelayBounds(userEmailId, settings) {
  let min = settings.delayMin, max = settings.delayMax;
  try {
    const { data } = await supabase.from('app_settings').select('key,value').in('key', [
      `ue_${userEmailId}_send_delay_min`, `ue_${userEmailId}_send_delay_max`
    ]);
    (data || []).forEach(r => {
      const n = parseInt(r.value, 10);
      if (r.key.endsWith('_min') && !Number.isNaN(n) && n >= 1 && n <= 300) min = n;
      if (r.key.endsWith('_max') && !Number.isNaN(n) && n >= 1 && n <= 600) max = n;
    });
  } catch (_) {}
  if (max < min) max = min;
  return { min, max };
}

async function loadMailboxQuotaState(mailboxIds) {
  const settings = await getBulkSendSettings();
  const limits = {}, sentToday = {}, delays = {};
  const ids = [...new Set(mailboxIds.filter(Boolean))];
  if (ids.length) {
    const { data: accounts } = await supabase.from('user_emails').select('id,daily_send_limit').in('id', ids);
    (accounts || []).forEach(a => { limits[a.id] = a.daily_send_limit || settings.defaultDailyLimit; });
    const { data: logs } = await supabase.from('email_send_log').select('user_email_id,emails_sent').eq('send_date', today()).in('user_email_id', ids);
    (logs || []).forEach(l => { sentToday[l.user_email_id] = l.emails_sent || 0; });
    for (const id of ids) {
      delays[id] = await getMailboxDelayBounds(id, settings);
      if (!limits[id]) limits[id] = settings.defaultDailyLimit;
    }
  }
  return { limits, sentToday, delays, settings };
}

async function loadMailboxSignatures(mailboxIds, userId) {
  const ids = [...new Set(mailboxIds.filter(Boolean))];
  const map = {};
  if (!ids.length) return map;

  const keys = ids.map(mailboxSignatureKey);
  const { data: rows } = await supabase.from('app_settings').select('key,value').in('key', keys);
  (rows || []).forEach(r => {
    const id = r.key.replace(/^ue_/, '').replace(/_signature_html$/, '');
    map[id] = r.value;
  });

  let legacyUserSig = '';
  if (userId) {
    const { data: leg } = await supabase.from('app_settings').select('value').eq('key', legacyUserSignatureKey(userId)).maybeSingle();
    legacyUserSig = leg?.value || '';
  }

  const migrations = [];
  for (const id of ids) {
    if (!map[id] && legacyUserSig) {
      map[id] = legacyUserSig;
      migrations.push({ key: mailboxSignatureKey(id), value: legacyUserSig, updated_at: new Date() });
    }
    if (!map[id]) map[id] = DEFAULT_SIGNATURE_HTML;
  }
  if (migrations.length) {
    await supabase.from('app_settings').upsert(migrations, { onConflict: 'key' });
  }
  return map;
}

async function getMailboxSignature(userEmailId, userId) {
  const map = await loadMailboxSignatures([userEmailId], userId);
  return resolveSignatureHtml(map[userEmailId]);
}

function domainSendsInLastHour(domainTimestamps, domain) {
  const cutoff = Date.now() - 3600000;
  return (domainTimestamps[domain] || []).filter(t => t > cutoff).length;
}

async function waitForMailboxSlot(mailboxId, lastSendAtByMailbox, delays) {
  if (!mailboxId || !lastSendAtByMailbox[mailboxId]) return;
  const bounds = delays[mailboxId] || { min: 30, max: 60 };
  const waitSec = Math.floor(Math.random() * (bounds.max - bounds.min + 1) + bounds.min);
  const elapsed = (Date.now() - lastSendAtByMailbox[mailboxId]) / 1000;
  const remaining = waitSec - elapsed;
  if (remaining > 0) await new Promise(r => setTimeout(r, remaining * 1000));
}

function buildDeferredNote({ skippedWindow, skippedQuota, skippedDomain, sendWindow }) {
  const parts = [];
  if (skippedWindow) parts.push(`${skippedWindow} waiting for send window (${sendWindow.start}:00–${sendWindow.end}:00 lead local)`);
  if (skippedQuota) parts.push(`${skippedQuota} waiting for mailbox daily limit (resumes tomorrow)`);
  if (skippedDomain) parts.push(`${skippedDomain} waiting for domain send spacing (retry soon)`);
  return parts.length ? parts.join(' · ') : undefined;
}

const activeSendByUser = new Set();

// ── Emergency stop ── a global switch that halts ALL outbound sending. Mirrored
// to app_settings so it survives restarts/redeploys; the in-memory copy keeps
// the check inside the send loop instant.
let sendingPaused = false;
function isSendingPaused() { return sendingPaused; }
async function loadSendingPaused() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'sending_paused').maybeSingle();
    sendingPaused = data?.value === 'true';
    if (sendingPaused) console.log('[EmergencyStop] Loaded persisted state: sending is PAUSED');
  } catch (e) { console.error('[EmergencyStop] load failed:', e.message); }
}
async function setSendingPaused(paused, actorUserId) {
  sendingPaused = !!paused;
  try {
    await supabase.from('app_settings').upsert({ key: 'sending_paused', value: paused ? 'true' : 'false', updated_at: new Date() }, { onConflict: 'key' });
  } catch (e) { console.error('[EmergencyStop] persist failed:', e.message); }
  emit(paused ? EVENTS.SENDING_PAUSED : EVENTS.SENDING_RESUMED, { scope: 'global', actorUserId: actorUserId || null });
}

// Per-manager pause — an RA lead (or admin) can stop emailing for one specific
// BD manager (e.g. a batch they just assigned) without affecting anyone else.
// Durable in app_settings as a JSON array; mirrored to an in-memory Set.
let pausedManagers = new Set();
function isManagerPaused(id) { return !!id && pausedManagers.has(id); }
async function loadPausedManagers() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'sending_paused_managers').maybeSingle();
    const arr = data?.value ? JSON.parse(data.value) : [];
    pausedManagers = new Set(Array.isArray(arr) ? arr : []);
    if (pausedManagers.size) console.log(`[EmergencyStop] Loaded ${pausedManagers.size} paused manager(s)`);
  } catch (e) { console.error('[EmergencyStop] load managers failed:', e.message); }
}
async function setManagerPaused(managerId, paused, actorUserId) {
  if (paused) pausedManagers.add(managerId); else pausedManagers.delete(managerId);
  try {
    await supabase.from('app_settings').upsert({ key: 'sending_paused_managers', value: JSON.stringify([...pausedManagers]), updated_at: new Date() }, { onConflict: 'key' });
  } catch (e) { console.error('[EmergencyStop] persist managers failed:', e.message); }
  emit(paused ? EVENTS.SENDING_PAUSED : EVENTS.SENDING_RESUMED, { scope: 'manager', managerId, actorUserId: actorUserId || null });
}

// ── Deliverability: suppression list, warm-up ramp, mailbox auto-pause ───────
// All best-effort and additive: a missing table/column resolves to "off", so
// none of this changes behaviour until migration 006 is applied and data flows.
async function loadSuppressedSet(emails) {
  const set = new Set();
  if (!emails || !emails.length) return set;
  try {
    const { data } = await supabase.from('suppression_list').select('email').in('email', emails);
    (data || []).forEach(r => set.add(String(r.email).toLowerCase()));
  } catch (_) {}
  return set;
}
async function addToSuppression(email, reason, source, createdBy, note) {
  if (!email) return;
  await supabase.from('suppression_list')
    .insert({ email: String(email).toLowerCase(), reason: reason || 'manual', source: source || 'admin', created_by: createdBy || null, note: note || null });
  // A duplicate (already suppressed) or absent table returns an error we ignore.
}
async function loadMailboxDelivState(ids) {
  const map = {};
  if (!ids || !ids.length) return map;
  try {
    const { data } = await supabase.from('user_emails').select('id,warmup_start_date,auto_paused_at').in('id', ids);
    (data || []).forEach(r => { map[r.id] = r; });
  } catch (_) {}
  return map;
}
// Warm-up: effective daily cap ramps from a small number; null = no ramp.
// start/step are admin-editable (config/settings.js: mailbox_warmup_start,
// mailbox_warmup_step) — callers fetch them once per batch and pass them in;
// the literals here are only a last-resort fallback if a caller omits them.
function warmupLimit(mailboxRow, start, step) {
  if (!mailboxRow || !mailboxRow.warmup_start_date) return null;
  const startDate = new Date(mailboxRow.warmup_start_date);
  if (isNaN(startDate.getTime())) return null;
  const days = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 86400000));
  const warmupStart = start != null ? start : 20;
  const warmupStep = step != null ? step : 5;
  return warmupStart + warmupStep * days;
}
async function setMailboxAutoPaused(userEmailId, paused, reason) {
  try { await supabase.from('user_emails').update({ auto_paused_at: paused ? new Date() : null }).eq('id', userEmailId); } catch (_) {}
  if (paused) {
    console.log(`[Deliverability] Mailbox ${userEmailId} AUTO-PAUSED: ${reason}`);
    emit(EVENTS.MAILBOX_AUTOPAUSED, { userEmailId, reason });
  }
}

async function logActivity(job_id, contact_id, user_id, action_type, description, old_value, new_value) {
  try {
    await supabase.from('activity_log').insert({
      job_id: job_id || null, contact_id: contact_id || null, user_id: user_id || null,
      action_type, description: description || null,
      old_value: old_value || null, new_value: new_value || null
    });
  } catch (e) { console.error('activity_log insert failed:', e.message); }
}

// ── INDUSTRY NORMALIZATION (shared across routes) ──────────────
const INDUSTRIES = ["Accounting & Finance","Advertising & Public Relations","Agriculture","Airline, Aviation & Transportation","Architecture, Construction & Building Materials","Art, Photography & Journalism","Automotive & Motor Vehicles","Banking & Financial Services","Biotechnology & Pharmaceutical","Broadcasting, Media & Printing","Chemical & Industrial","Computer Hardware & Software","Consulting & Consulting Engineering","Consumer Products & Retail","Credit, Loan, Mortgage & Collections","Defense, Military & Aerospace","Education, Training & Library Science","Electronics & Semiconductor","Employment, Recruiting & Staffing","Energy, Utilities, Oil & Petroleum","Entertainment & Recreation","Environmental","Fashion, Apparel & Textile","Food & Restaurant","Funeral & Cemetery","Government & Civil Service","Healthcare & Health Services","Homebuilding & Real Estate","Hospitality, Hotel & Resort","HVAC","Import & Export","Insurance & Managed Care","Internet & ECommerce","Landscaping","Law Enforcement, Legal & Security","Manufacturing & Manufacturing Engineering","Medical Equipment","Not for Profit & Social Services","Office Supplies & Equipment","Packaging","Sales & Marketing","Securities","Social Media & Wireless Telecommunications","Travel"];
function normInd(raw) {
  if (!raw) return 'Unknown';
  if (INDUSTRIES.includes(raw)) return raw; // already a known value
  const r = raw.toLowerCase();
  if (r.includes('account')||r.includes('cpa')||r.includes('bookkeep')) return 'Accounting & Finance';
  if (r.includes('advertis')||r.includes('public relation')) return 'Advertising & Public Relations';
  if (r.includes('agricultur')||r.includes('farm')) return 'Agriculture';
  if (r.includes('airline')||r.includes('aviation')||r.includes('transport')||r.includes('logistics')||r.includes('freight')) return 'Airline, Aviation & Transportation';
  if (r.includes('architect')||r.includes('construction')||r.includes('building material')) return 'Architecture, Construction & Building Materials';
  if (r.includes('photo')||r.includes('journalism')||r.includes('creative')) return 'Art, Photography & Journalism';
  if (r.includes('automotive')||r.includes('motor vehicle')||r.includes('automobile')) return 'Automotive & Motor Vehicles';
  if (r.includes('banking')||r.includes('bank ')||r.includes('financial service')) return 'Banking & Financial Services';
  if (r.includes('biotech')||r.includes('pharma')||r.includes('life science')) return 'Biotechnology & Pharmaceutical';
  if (r.includes('broadcast')||r.includes('media')||r.includes('print')||r.includes('publish')||r.includes('television')) return 'Broadcasting, Media & Printing';
  if (r.includes('chemical')||r.includes('industrial')||r.includes('petrochemical')) return 'Chemical & Industrial';
  if (r.includes('software')||r.includes('computer')||r.includes('hardware')||r.includes('technology')||r.includes(' tech')||r.includes(' it ')||r.includes('information tech')||r.includes('saas')||r.includes('cloud')) return 'Computer Hardware & Software';
  if (r.includes('consult')||r.includes('advisory')) return 'Consulting & Consulting Engineering';
  if (r.includes('consumer')||r.includes('retail')||r.includes('ecommerce')) return 'Consumer Products & Retail';
  if (r.includes('credit')||r.includes('loan')||r.includes('mortgage')||r.includes('collection')) return 'Credit, Loan, Mortgage & Collections';
  if (r.includes('defense')||r.includes('military')||r.includes('aerospace')) return 'Defense, Military & Aerospace';
  if (r.includes('education')||r.includes('training')||r.includes('school')||r.includes('university')||r.includes('college')||r.includes('library')) return 'Education, Training & Library Science';
  if (r.includes('electronic')||r.includes('semiconductor')||r.includes('chip')) return 'Electronics & Semiconductor';
  if (r.includes('employ')||r.includes('recruit')||r.includes('staffing')||r.includes('human resource')) return 'Employment, Recruiting & Staffing';
  if (r.includes('energy')||r.includes('utilities')||r.includes('oil ')||r.includes('gas ')||r.includes('petroleum')||r.includes('solar')||r.includes('renewable')) return 'Energy, Utilities, Oil & Petroleum';
  if (r.includes('entertainment')||r.includes('recreation')||r.includes('gaming')||r.includes('sport')) return 'Entertainment & Recreation';
  if (r.includes('environment')||r.includes('sustainability')||r.includes('waste')||r.includes('recycl')) return 'Environmental';
  if (r.includes('fashion')||r.includes('apparel')||r.includes('textile')||r.includes('clothing')) return 'Fashion, Apparel & Textile';
  if (r.includes('food')||r.includes('restaurant')||r.includes('beverage')||r.includes('catering')) return 'Food & Restaurant';
  if (r.includes('funeral')||r.includes('cemetery')||r.includes('mortuary')) return 'Funeral & Cemetery';
  if (r.includes('government')||r.includes('civil service')||r.includes('public sector')||r.includes('municipal')) return 'Government & Civil Service';
  if (r.includes('health')||r.includes('medical')||r.includes('hospital')||r.includes('clinic')||r.includes('wellness')||r.includes('dental')) return 'Healthcare & Health Services';
  if (r.includes('real estate')||r.includes('homebuilding')||r.includes('property')||r.includes('realty')) return 'Homebuilding & Real Estate';
  if (r.includes('hotel')||r.includes('resort')||r.includes('hospitality')||r.includes('lodging')) return 'Hospitality, Hotel & Resort';
  if (r.includes('hvac')||r.includes('heating')||r.includes('cooling')||r.includes('air condition')) return 'HVAC';
  if (r.includes('import')||r.includes('export')) return 'Import & Export';
  if (r.includes('insurance')||r.includes('managed care')) return 'Insurance & Managed Care';
  if (r.includes('internet')||r.includes('online')||r.includes('digital')||r.includes('web ')) return 'Internet & ECommerce';
  if (r.includes('landscap')||r.includes('lawn')||r.includes('garden')) return 'Landscaping';
  if (r.includes('legal')||r.includes('law')||r.includes('attorney')||r.includes('compliance')||r.includes('litigation')||r.includes('law enforce')) return 'Law Enforcement, Legal & Security';
  if (r.includes('manufactur')||r.includes('engineering')||r.includes('mechanical')||r.includes('production')) return 'Manufacturing & Manufacturing Engineering';
  if (r.includes('medical equip')||r.includes('medical device')||r.includes('surgical')) return 'Medical Equipment';
  if (r.includes('nonprofit')||r.includes('not for profit')||r.includes('social service')||r.includes('charity')||r.includes('ngo')) return 'Not for Profit & Social Services';
  if (r.includes('office suppl')||r.includes('stationery')) return 'Office Supplies & Equipment';
  if (r.includes('packag')||r.includes('container')) return 'Packaging';
  if (r.includes('sales')||r.includes('marketing')) return 'Sales & Marketing';
  if (r.includes('securit')||r.includes('investment')||r.includes('hedge fund')||r.includes('private equity')) return 'Securities';
  if (r.includes('social media')||r.includes('wireless')||r.includes('telecom')||r.includes('mobile')) return 'Social Media & Wireless Telecommunications';
  if (r.includes('travel')||r.includes('tourism')) return 'Travel';
  return raw; // keep original if no match
}

// ── HEALTH ─────────────────────────────────────────────────────
app.use(express.static('public', {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
// Any successful write may change jobs/contacts, so drop the /jobs cache — this
// is what keeps the cache invisible to users (their own edits show up on the
// very next poll). Internal mutations (send loop, sweeps) are covered by the TTL.
app.use(function(req, res, next) {
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    res.on('finish', () => { if (res.statusCode < 400) invalidateJobsCache(); });
  }
  next();
});
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/version', (req, res) => res.json({
  ok: true,
  version: '3.0.0',
  commit: process.env.RENDER_GIT_COMMIT || null,
  branch: process.env.RENDER_GIT_BRANCH || null,
  deployedAt: process.env.RENDER || 'local'
}));
// /industries, /lookup/zipcode, /contacts/check-email → extracted to
// routes/lookups.js (mounted below).

// ══════════════════════════════════════════════════════════════
// JOBS
// ══════════════════════════════════════════════════════════════
const JOB_SELECT = `*, research, company:companies(id,name,website,industry,location), contacts(id,job_id,first_name,last_name,designation,email,phone,linkedin,is_primary,email_status,ooo_until,email_sent_at,email_platform), creator:users!created_by(id,name,employee_id), assignee:users!assigned_to(id,name,employee_id), bd_assignee:users!assigned_to_bd(id,name,employee_id), sending_email:user_emails!sending_email_id(id,email_address,display_name)`;

// The jobs list is by far the largest recurring payload (all jobs + nested
// contacts, polled by every open tab), so it dominated Supabase egress. Cache
// the full list in memory for a short TTL and serve role-filtered slices from
// it — Supabase is hit at most once per TTL no matter how many tabs are open.
// Any successful write invalidates the cache (middleware above), so users
// always see their own changes immediately.
// Keyed per org_id so one tenant's leads are never served out of another
// tenant's cache entry once a second org exists.
let jobsCacheByOrg = new Map();
const JOBS_CACHE_TTL_MS = 60 * 1000;
function invalidateJobsCache() { jobsCacheByOrg.clear(); }

async function loadAllJobs(orgId) {
  const key = orgId || '__all__';
  const cached = jobsCacheByOrg.get(key);
  if (cached && (Date.now() - cached.at) < JOBS_CACHE_TTL_MS) return cached.data;
  let query = supabase.from('jobs').select(JOB_SELECT).is('deleted_at', null);
  if (orgId) query = query.eq('org_id', orgId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  jobsCacheByOrg.set(key, { data: rows, at: Date.now() });
  return rows;
}

// Jobs routes (list/detail/create/bulk/update/delete/export, JD parsing,
// research, /jobs/:job_id/contacts) → extracted to routes/jobs.js (mounted
// below). The jobs cache (JOB_SELECT/loadAllJobs/invalidateJobsCache) stays above.

// Contact write endpoints (POST/PUT/DELETE /contacts, PATCH email-status)
// → extracted to routes/contacts.js (mounted below).

// ══════════════════════════════════════════════════════════════
// EMAILS
// ══════════════════════════════════════════════════════════════
// GET /emails, /emails/pending-count, /emails/pending-summary → extracted to
// routes/emails.js (mounted below). Send-pipeline POST routes stay inline.

app.post('/emails/retry-pending-window', auth, async (req, res) => {
  try {
    let managerId = req.user.id;
    if (hasRole(req, 'admin', 'ra_lead') && req.body?.manager_id) managerId = req.body.manager_id;
    if (activeSendByUser.has(managerId)) {
      return res.json({ started: false, message: 'Send already in progress for this manager' });
    }
    res.json({ started: true, message: 'Retrying in-window pending emails' });
    emit(EVENTS.OUTREACH_QUEUED, { managerId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /emails (manual mark-sent) → extracted to routes/emails.js (mounted below).

// Send a reminder follow-up through the Graph engine (fresh, non-threaded), like outreach.
app.post('/emails/reminder-send', auth, async (req, res) => {
  try {
    const { reminder_id, contact_id, job_id, to_email, subject, body } = req.body;
    if (!to_email || !emailSyntaxValid(to_email)) return res.status(400).json({ error: 'Valid recipient email required' });
    if (!subject || !subject.trim() || !body || !body.trim()) return res.status(400).json({ error: 'Subject and body required' });
    if (!job_id) return res.status(400).json({ error: 'Reminder must be linked to a job to send through the engine' });

    // The engine resolves the sending mailbox from the job, so make sure it has one.
    const { data: job } = await supabase
      .from('jobs')
      .select('sending_email_id, sending_email:user_emails!sending_email_id(email_address)')
      .eq('id', job_id).single();
    let sendingAddr = job?.sending_email?.email_address || null;
    if (!job?.sending_email_id) {
      const { data: ue } = await supabase.from('user_emails')
        .select('id,email_address,is_primary').eq('user_id', req.user.id).eq('is_active', true)
        .order('is_primary', { ascending: false }).limit(1);
      if (!ue || !ue.length) return res.status(400).json({ error: 'No active sending mailbox available' });
      await supabase.from('jobs').update({ sending_email_id: ue[0].id }).eq('id', job_id);
      sendingAddr = ue[0].email_address;
    }

    // Double-send guard: if a follow-up or reminder to this contact is already
    // queued or was sent today, skip to avoid emailing them twice in one day.
    if (await hasLiveOutreachEmail(job_id, contact_id)) {
      return res.status(409).json({ error: 'A follow-up to this contact is already queued or was sent today — skipped to avoid a duplicate email.' });
    }

    // Queue as a fresh send (followup_type 'reminder' is not a thread reply) so the engine delivers it.
    const { data: row, error } = await supabase.from('emails').insert({
      contact_id: contact_id || null, job_id, to_email, subject, body,
      platform: 'Outlook', sent_by: req.user.id, from_email: sendingAddr,
      status: 'pending', followup_type: 'reminder'
    }).select().single();
    if (error) throw error;

    if (reminder_id) await supabase.from('reminders').update({ status: 'sent' }).eq('id', reminder_id).eq('user_id', req.user.id);
    await logActivity(job_id, contact_id || null, req.user.id, 'reminder_email_queued', `Reminder follow-up queued: ${subject}`, null, null);

    res.status(201).json({ success: true, email_id: row.id });
    emit(EVENTS.OUTREACH_QUEUED, { managerId: req.user.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Returns a Set of "jobId:contactId" keys that already have a live initial
// outreach email (sent, or pending/sending). Used to make initial-outreach
// generation idempotent: a POC must never receive a second cold intro for the
// same job just because that job was re-assigned / re-distributed / re-generated.
async function fetchInitialOutreachedPairs(jobIds) {
  const pairs = new Set();
  const ids = [...new Set((jobIds || []).filter(Boolean))];
  if (!ids.length) return pairs;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase.from('emails')
      .select('job_id,contact_id,status,followup_type')
      .in('job_id', chunk)
      .or('followup_type.is.null,followup_type.eq.initial');
    if (error) { console.error('[GenerateEmails] outreach-dedup lookup failed:', error.message); continue; }
    (data || []).forEach(r => {
      // A failed/cancelled prior attempt may legitimately be re-sent; anything
      // that went out or is queued blocks a duplicate.
      if (r.contact_id && r.status !== 'failed' && r.status !== 'cancelled') {
        pairs.add(`${r.job_id}:${r.contact_id}`);
      }
    });
  }
  return pairs;
}

function buildPendingEmailsFromJobs(jobs, callerUserId, bdMap, bdPrimaryEmailMap, tmplSettings, alreadyOutreached) {
  const tasksByBd = {};
  let contactsSkipped = 0;
  let alreadyOutreachedSkipped = 0;
  const outreachedSet = alreadyOutreached instanceof Set ? alreadyOutreached : new Set();

  for (const job of jobs) {
    const bd = bdMap[job.assigned_to_bd] || { id: callerUserId, name: '', email: '' };
    let contacts = (job.contacts || []).filter(c => emailSyntaxValid(c.email));
    // Skip contacts already sent (or queued) an initial outreach for this job —
    // prevents duplicate cold emails to the same POC on re-generation.
    contacts = contacts.filter(c => {
      if (outreachedSet.has(`${job.id}:${c.id}`)) { alreadyOutreachedSkipped++; return false; }
      return true;
    });
    if (!contacts.length) {
      contactsSkipped++;
      continue;
    }
    if (!tasksByBd[bd.id]) tasksByBd[bd.id] = [];
    for (const contact of contacts) {
      tasksByBd[bd.id].push({ job, contact, bd });
    }
  }

  const emailsToInsert = [];
  for (const bdId of Object.keys(tasksByBd)) {
    const tasks = tasksByBd[bdId];
    const useRandom = isRandomTemplateMode(tmplSettings[`u_${bdId}_random_template_mode`]);
    const deck = useRandom ? buildRotatingTemplateDeck(tasks.length) : null;
    if (useRandom) {
      console.log(`[GenerateEmails] Random template rotation for BD ${bdId}: ${tasks.length} emails across ${deck.length} slots`);
    }

    tasks.forEach((task, idx) => {
      const { job, contact, bd } = task;
      try {
        const variant = deck ? deck[idx] : null;
        const subjTmpl = variant
          ? variant.o1.subject
          : resolveTemplate(tmplSettings[`u_${bd.id}_tmpl_o1_subject`], 'o1_subject');
        const bodyTmpl = variant
          ? variant.o1.body
          : resolveTemplate(tmplSettings[`u_${bd.id}_tmpl_o1_body`], 'o1_body');
        // Leave {{sender}} in the queued text. Which mailbox sends this row is
        // decided at SEND time (the lead's mailbox can change, or a sequence can
        // rotate it), and the signature is filled from that same mailbox — so
        // baking a name here is how the body and the signature end up naming two
        // different people.
        const vars = buildEmailVars({ job, contact, senderDisplayName: DEFER_SENDER });
        const subject = fillTemplate(subjTmpl, vars);
        const body = fillTemplate(bodyTmpl, vars);
        const resolvedSendingEmail = job.sending_email || bdPrimaryEmailMap[bd.id];
        const sendingEmailAddress = resolvedSendingEmail?.email_address || '';
        const row = {
          contact_id: contact.id,
          job_id: job.id,
          to_email: contact.email,
          subject,
          body,
          platform: 'Outlook',
          sent_by: bd.id,
          from_email: sendingEmailAddress,
          status: 'pending'
        };
        if (variant?.id) row.template_variant = variant.id;
        emailsToInsert.push(row);
      } catch (e) {
        console.error(`[GenerateEmails] contact error (${contact.email}):`, e.message);
      }
    });
  }

  return { emailsToInsert, contactsSkipped, alreadyOutreachedSkipped };
}

// Standalone generation function — called directly by autoSendForManager (no HTTP)
async function generateEmailsForJobs(job_ids, callerUserId) {
  // Batch fetch jobs in chunks to avoid Supabase URL length limits on .in()
  const BATCH_SIZE = 50;
  let jobs = [];
  for (let i = 0; i < job_ids.length; i += BATCH_SIZE) {
    const chunk = job_ids.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase.from('jobs').select('id, position, location, salary_range, research, industry, assigned_to_bd, sending_email_id, sending_email:user_emails!sending_email_id(id,email_address,display_name), company:companies(name,industry,location), contacts(*)').in('id', chunk);
    if (error) {
      console.error(`[GenerateEmails] Failed to fetch jobs batch ${i}-${i + chunk.length}:`, error.message);
      throw error;
    }
    jobs = jobs.concat(data || []);
  }
  if (!jobs.length) {
    console.log(`[GenerateEmails] No jobs found for IDs: ${job_ids.slice(0, 5).join(',')}...`);
    return 0;
  }
  console.log(`[GenerateEmails] Fetched ${jobs.length} jobs (requested ${job_ids.length})`);
  const bdIds = [...new Set(jobs.map(j => j.assigned_to_bd).filter(Boolean))];
  const { data: bdUsers } = bdIds.length ? await supabase.from('users').select('id,name,email').in('id', bdIds) : { data: [] };
  const bdMap = {};
  (bdUsers || []).forEach(u => { bdMap[u.id] = u; });
  const allBdIds = [...new Set([callerUserId, ...bdIds])];
  const { data: bdEmailRows } = allBdIds.length
    ? await supabase.from('user_emails').select('id,user_id,email_address,display_name,is_primary,created_at').in('user_id', allBdIds)
        .eq('is_active', true)
        .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
    : { data: [] };
  const bdPrimaryEmailMap = {};
  (bdEmailRows || []).forEach(e => { if (!bdPrimaryEmailMap[e.user_id]) bdPrimaryEmailMap[e.user_id] = e; });
  const tmplKeys = allBdIds.flatMap(id => [
    `u_${id}_tmpl_o1_subject`, `u_${id}_tmpl_o1_body`, `u_${id}_random_template_mode`
  ]);
  const { data: tmplRows } = await supabase.from('app_settings').select('key,value').in('key', tmplKeys);
  const tmplSettings = {};
  (tmplRows || []).forEach(r => { tmplSettings[r.key] = r.value; });

  const alreadyOutreached = await fetchInitialOutreachedPairs(jobs.map(j => j.id));
  const { emailsToInsert, contactsSkipped, alreadyOutreachedSkipped } = buildPendingEmailsFromJobs(
    jobs, callerUserId, bdMap, bdPrimaryEmailMap, tmplSettings, alreadyOutreached
  );
  if (contactsSkipped) console.log(`[GenerateEmails] ${contactsSkipped} jobs had no valid contacts — skipped`);
  if (alreadyOutreachedSkipped) console.log(`[GenerateEmails] ${alreadyOutreachedSkipped} contacts already had an initial outreach for their job — skipped to avoid duplicate cold emails`);
  // Insert emails in batches of 500 to avoid Supabase payload limits
  const INSERT_BATCH = 500;
  let totalInserted = 0;
  for (let i = 0; i < emailsToInsert.length; i += INSERT_BATCH) {
    const batch = emailsToInsert.slice(i, i + INSERT_BATCH);
    const { error: insErr } = await supabase.from('emails').insert(batch);
    if (insErr) {
      console.error(`[GenerateEmails] Insert batch ${i}-${i + batch.length} failed:`, insErr.message);
      throw insErr;
    }
    totalInserted += batch.length;
  }
  console.log(`[GenerateEmails] Inserted ${totalInserted} emails for ${jobs.length} jobs (${job_ids.length} requested)`);
  return totalInserted;
}

app.post('/emails/generate', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead', 'bd', 'bd_lead')) return res.status(403).json({ error: 'Not allowed' });
    const { job_ids } = req.body;
    if (!Array.isArray(job_ids) || !job_ids.length) return res.status(400).json({ error: 'job_ids required' });
    const { data: jobs, error: jErr } = await supabase.from('jobs').select('id, position, location, salary_range, research, industry, assigned_to_bd, sending_email_id, sending_email:user_emails!sending_email_id(id,email_address,display_name), company:companies(name,industry,location), contacts(*)').in('id', job_ids);
    if (jErr) throw jErr;
    const bdIds = [...new Set(jobs.map(j => j.assigned_to_bd).filter(Boolean))];
    const { data: bdUsers } = bdIds.length ? await supabase.from('users').select('id,name,email').in('id', bdIds) : { data: [] };
    const bdMap = {};
    (bdUsers || []).forEach(u => { bdMap[u.id] = u; });

    // Pre-fetch primary sending email for each BD (used as fallback if job.sending_email_id is null)
    const allBdIds = [...new Set([req.user.id, ...bdIds])];
    const { data: bdEmailRows } = allBdIds.length
      ? await supabase.from('user_emails').select('id,user_id,email_address,display_name,is_primary,created_at').in('user_id', allBdIds)
        .eq('is_active', true)
        .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
      : { data: [] };
    // First row wins: is_primary first, then oldest. Without BOTH an is_active
    // filter and a deterministic tie-break this picked an arbitrary mailbox —
    // including a DEACTIVATED one — whenever a user had several and none was
    // flagged primary.
    const bdPrimaryEmailMap = {};
    (bdEmailRows || []).forEach(e => {
      if (!bdPrimaryEmailMap[e.user_id]) bdPrimaryEmailMap[e.user_id] = e;
    });

    const tmplKeys = allBdIds.flatMap(id => [
      `u_${id}_tmpl_o1_subject`, `u_${id}_tmpl_o1_body`, `u_${id}_random_template_mode`
    ]);
    const { data: tmplRows } = await supabase.from('app_settings').select('key,value').in('key', tmplKeys);
    const tmplSettings = {};
    (tmplRows || []).forEach(r => { tmplSettings[r.key] = r.value; });

    const alreadyOutreached = await fetchInitialOutreachedPairs(jobs.map(j => j.id));
    const { emailsToInsert, alreadyOutreachedSkipped } = buildPendingEmailsFromJobs(
      jobs, req.user.id, bdMap, bdPrimaryEmailMap, tmplSettings, alreadyOutreached
    );
    if (emailsToInsert.length) {
      const { error: insErr } = await supabase.from('emails').insert(emailsToInsert);
      if (insErr) throw insErr;
    }
    res.json({
      generated: emailsToInsert.length,
      skipped_already_outreached: alreadyOutreachedSkipped || 0,
      failed: 0,
      failDetails: []
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/emails/send-selected', auth, async (req, res) => {
  try {
    if (isSendingPaused()) return res.status(409).json({ error: 'Sending is paused (emergency stop is on). Resume sending first.' });
    if (isManagerPaused(req.user.id)) return res.status(409).json({ error: 'Your sending is paused by your team lead/admin — it will resume when they turn it back on.' });
    const { email_ids } = req.body;
    if (!Array.isArray(email_ids) || !email_ids.length) return res.status(400).json({ error: 'email_ids required' });

    const { data: pendingEmails, error: fetchErr } = await supabase
      .from('emails')
      .select('id, to_email, subject, body, contact_id, job_id, from_email, followup_type, follow_up_id, job:jobs(timezone, sending_email_id, sending_email:user_emails!sending_email_id(id,email_address,display_name,platform,daily_send_limit,is_active))')
      .eq('sent_by', req.user.id)
      .eq('status', 'pending')
      .in('id', email_ids);
    if (fetchErr) throw fetchErr;
    if (!pendingEmails || !pendingEmails.length) return res.json({ success: true, sent: 0, failed: 0 });

    const totalCount = pendingEmails.length;
    const userId = req.user.id;
    res.json({ success: true, queued: totalCount });
    await setSendProgress(userId, { active: true, total: totalCount, sent: 0, failed: 0, current: '', failDetails: [], startedAt: new Date().toISOString() });

    console.log(`[SendSelected] Starting ${totalCount} emails, userId=${userId}`);
    const { sent, failed, skippedWindow, skippedQuota, skippedDomain, failDetails, sentContactIds, sentJobIds, sendWindow } = await processPendingEmailSends(userId, pendingEmails, { autoSend: false });
    const uniqueContactIds = [...new Set(sentContactIds.filter(Boolean))];
    if (uniqueContactIds.length) await supabase.from('contacts').update({ email_sent_at: today() }).in('id', uniqueContactIds);
    const uniqueJobIds = [...new Set(sentJobIds.filter(Boolean))];
    for (const jid of uniqueJobIds) await logActivity(jid, null, userId, 'emails_sent', `${sent} email(s) sent via Microsoft`, null, null);
    const deferredTotal = skippedWindow + skippedQuota + skippedDomain;
    await setSendProgress(userId, {
      active: false, done: true, total: totalCount, sent, failed, deferred: deferredTotal,
      deferredWindow: skippedWindow, deferredQuota: skippedQuota, deferredDomain: skippedDomain,
      failDetails,
      deferredNote: buildDeferredNote({ skippedWindow, skippedQuota, skippedDomain, sendWindow }),
      completedAt: new Date().toISOString()
    });
    setTimeout(() => clearSendProgress(userId), 60000);
    console.log(`[SendSelected] Completed: ${sent} sent, ${failed} failed, deferred window=${skippedWindow} quota=${skippedQuota} domain=${skippedDomain}`);
  } catch (err) { console.error('[SendSelected] Error:', err.message); }
});

// GET /emails/send-progress → extracted to routes/emails.js (mounted below).

app.post('/emails/queue-all', auth, async (req, res) => {
  try {
    if (isSendingPaused()) return res.status(409).json({ error: 'Sending is paused (emergency stop is on). Resume sending first.' });
    if (isManagerPaused(req.user.id)) return res.status(409).json({ error: 'Your sending is paused by your team lead/admin — it will resume when they turn it back on.' });
    // Fetch all pending emails for this user, joining job -> sending_email_id + platform
    const pendingEmails = await fetchPendingEmailsForUser(req.user.id);
    if (!pendingEmails.length) return res.json({ success: true, sent: 0, failed: 0, queued: 0 });

    // Respond immediately so browser doesn't time out — send loop runs in background
    const totalCount = pendingEmails.length;
    const userId = req.user.id;
    res.json({ success: true, queued: totalCount });

    // Concurrency guard: never run two send loops for the same user at once
    // (a double-click, or this manual send-all overlapping the auto-send/retry
    // loop). Without this the same pending rows were dispatched twice. The
    // per-email atomic claim in processPendingEmailSends is the hard guarantee;
    // this just avoids starting redundant work. If a send is already running,
    // those pending emails will be handled by that run (or the deferred retry).
    if (activeSendByUser.has(userId)) {
      console.log(`[SendAll] A send is already in progress for user ${userId} — skipping duplicate loop`);
      return;
    }
    activeSendByUser.add(userId);
    try {
      await setSendProgress(userId, { active: true, total: totalCount, sent: 0, failed: 0, current: '', failDetails: [], startedAt: new Date().toISOString() });

      console.log(`[SendAll] Starting loop for ${totalCount} emails, userId=${userId}`);
      const { sent, failed, skippedWindow, skippedQuota, skippedDomain, failDetails, sentContactIds, sentJobIds, sendWindow } = await processPendingEmailSends(userId, pendingEmails, { autoSend: false });
      const uniqueContactIds = [...new Set(sentContactIds.filter(Boolean))];
      if (uniqueContactIds.length) await supabase.from('contacts').update({ email_sent_at: today() }).in('id', uniqueContactIds);
      const uniqueJobIds = [...new Set(sentJobIds.filter(Boolean))];
      for (const jid of uniqueJobIds) await logActivity(jid, null, userId, 'emails_sent', `${sent} email(s) sent via Microsoft`, null, null);
      const deferredTotal = skippedWindow + skippedQuota + skippedDomain;
      await setSendProgress(userId, {
        active: false, done: true, total: totalCount, sent, failed, deferred: deferredTotal,
        deferredWindow: skippedWindow, deferredQuota: skippedQuota, deferredDomain: skippedDomain,
        failDetails,
        deferredNote: buildDeferredNote({ skippedWindow, skippedQuota, skippedDomain, sendWindow }),
        completedAt: new Date().toISOString()
      });
      setTimeout(() => clearSendProgress(userId), 300000);
      console.log(`[SendAll] Completed: ${sent} sent, ${failed} failed, deferred window=${skippedWindow} quota=${skippedQuota} domain=${skippedDomain}`); console.log(`[SendAll] FailDetails:`, JSON.stringify(failDetails.slice(0,3)));
    } finally {
      activeSendByUser.delete(userId);
    }
  } catch (err) { console.error('[SendAll] Error:', err.message); }
});

// DELETE/PATCH /emails/:id → extracted to routes/emails.js (mounted below).

// ══════════════════════════════════════════════════════════════
// REMINDERS
// ══════════════════════════════════════════════════════════════
// Reminders CRUD → extracted to routes/reminders.js (mounted below).

// ══════════════════════════════════════════════════════════════
// INSIGHTS
// ══════════════════════════════════════════════════════════════

// ── BD Manager Insights ────────────────────────────────────────

// ══════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ══════════════════════════════════════════════════════════════
app.get('/jobs/:job_id/activity', auth, async (req, res) => {
  try {
    if (!(await canTouchJob(req, req.params.job_id))) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await supabase.from('activity_log').select(`*, user:users(id,name,employee_id)`).eq('job_id', req.params.job_id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// DISTRIBUTION
// ══════════════════════════════════════════════════════════════
function buildAutoRatio(pool_stats, capacity) {
  const total = Math.min(pool_stats?.total || 0, capacity);
  function evenSplit(obj) { const keys = Object.keys(obj).filter(k => obj[k] > 0); if (!keys.length) return {}; const base = Math.floor(100 / keys.length); const result = {}; let rem = 100; keys.forEach((k, i) => { result[k] = i === keys.length - 1 ? rem : base; rem -= base; }); return result; }
  return { total_to_send: total, by_freshness: evenSplit(pool_stats?.by_freshness || {}), by_industry: evenSplit(pool_stats?.by_industry || {}), by_timezone: evenSplit(pool_stats?.by_timezone || {}), exclude_duplicates: false, summary: `Auto-balanced distribution of ${total} leads.` };
}

app.post('/distribute/generate-ratio', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'RA Lead only' });
    const { priority_text, pool_stats, manager_id } = req.body;
    const { data: manager } = await supabase.from('users').select('id,name').eq('id', manager_id).single();
    const capacity = pool_stats.capacity || 150;
    // No provider configured (or every one of them failing) falls through to
    // buildAutoRatio below — the rules split, which is what runs today.
    // Build dynamic industry keys from what's actually in the pool
    const poolIndustries = Object.keys(pool_stats.by_industry || {}).filter(Boolean);
    const industryKeys = poolIndustries.length ? poolIndustries.reduce((o,k) => { o[k]='<pct>'; return o; }, {}) : {'Other':'<pct>'};
    const prompt = `You are a lead distribution engine for Fute Global LLC.\nPool: ${JSON.stringify(pool_stats)}\nManager: ${manager?.name}\nCapacity: ${capacity}\nInstructions: "${priority_text}"\nRespond ONLY with valid JSON:\n{"total_to_send":<number>,"by_freshness":{"New":<pct>,"Normal":<pct>,"Old":<pct>},"by_industry":${JSON.stringify(industryKeys)},"by_timezone":{"EST":<pct>,"CST":<pct>,"MST":<pct>,"PST":<pct>},"exclude_duplicates":<bool>,"summary":"<text>"}`;
    const out = await aiProvider.complete(supabase, { prompt, maxTokens: 400 });
    if (!out) return res.json(buildAutoRatio(pool_stats, capacity));
    const ratio = JSON.parse(out.text.replace(/```json|```/g, '').trim());
    res.json(ratio);
  } catch (err) { res.json(buildAutoRatio(req.body.pool_stats, req.body.pool_stats?.capacity || 150)); }
});

// ── Microsoft Graph threaded send (follow-ups quote prior emails like Gmail/Outlook) ──
async function graphMailRequest(accessToken, path, options = {}) {
  // Timeout + retry via http-client: a hung Graph socket used to hang its caller
  // forever, and these callers are the background sweeps. Retries apply to reads
  // only (fetchWithRetry's default) so a POST /sendMail is never duplicated.
  const res = await fetchWithRetry(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      // Mutable Graph ids change when a message moves folders (Drafts -> Sent
      // Items on send), which strands stored ids used for follow-up threading.
      // Immutable ids survive folder moves.
      Prefer: 'IdType="ImmutableId"',
      ...(options.headers || {})
    }
  }, {
    timeoutMs: GRAPH_TIMEOUT_MS,
    onRetry: ({ attempt, delayMs, reason }) =>
      console.warn(`[graph] ${reason} on ${path} — retry ${attempt} in ${delayMs}ms`),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Graph API ${res.status}`);
  return data;
}

// Graph's "the item moved / id no longer resolves" family of errors.
function isGraphItemNotFound(err) {
  return /not found in the store|ErrorItemNotFound|ItemNotFound|ErrorInvalidIdMalformed/i.test(String(err?.message || ''));
}

// After a send, the durable message id lives on the Sent Items copy. The draft id we created
// the message with can go stale once it moves out of Drafts, stranding follow-up threading.
// Look the real sent message up by its (stable) conversationId and return its durable id so the
// stored thread parent survives the Drafts->Sent move. Best-effort: falls back to the draft id.
async function resolveSentMessageId(accessToken, { conversationId, toEmail, fallbackId }) {
  if (!conversationId) return { id: fallbackId, conversationId: conversationId || null };
  try {
    const params = new URLSearchParams({
      '$filter': `conversationId eq '${conversationId}'`,
      '$select': 'id,conversationId,toRecipients,sentDateTime,isDraft',
      '$orderby': 'sentDateTime desc',
      '$top': '10'
    });
    const data = await graphMailRequest(accessToken, `/me/messages?${params}`);
    const to = (toEmail || '').toLowerCase().trim();
    const sent = (data.value || []).filter(m => m.isDraft === false);
    const match = sent.find(m => (m.toRecipients || []).some(r => (r.emailAddress?.address || '').toLowerCase() === to)) || sent[0];
    if (match?.id) return { id: match.id, conversationId: match.conversationId || conversationId };
  } catch (_) {}
  return { id: fallbackId, conversationId };
}

async function sendMicrosoftNewMessage(userEmailId, { to, subject, htmlBody, attachments, cc }) {
  const accessToken = await getMicrosoftToken(userEmailId);
  const msg = await graphMailRequest(accessToken, '/me/messages', {
    method: 'POST',
    body: JSON.stringify({
      subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients: [{ emailAddress: { address: to } }],
      // cc arrived with the in-app mailbox (a person writing a real email
      // expects a Cc field). Every outreach caller omits it and is unchanged.
      ...((cc && cc.length) ? { ccRecipients: cc.map(a => ({ emailAddress: { address: a } })) } : {}),
      ...((attachments && attachments.length) ? { attachments: attachments.map(a => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.filename, contentType: a.contentType || 'application/octet-stream', contentBytes: a.base64
      })) } : {})
    })
  });
  await graphMailRequest(accessToken, `/me/messages/${msg.id}/send`, { method: 'POST' });
  // msg.id is the DRAFT id; once sent, the durable id lives on the Sent Items copy. Re-fetch it
  // so follow-up threading has a parent that survives the Drafts->Sent move.
  const real = await resolveSentMessageId(accessToken, { conversationId: msg.conversationId, toEmail: to, fallbackId: msg.id });
  return { graphMessageId: real.id, conversationId: real.conversationId || msg.conversationId || null, inReplyTo: null };
}

async function sendMicrosoftThreadReply(userEmailId, parentGraphMessageId, { htmlBody, subject, to }) {
  const accessToken = await getMicrosoftToken(userEmailId);
  const draft = await graphMailRequest(accessToken, `/me/messages/${parentGraphMessageId}/createReply`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  const full = await graphMailRequest(accessToken, `/me/messages/${draft.id}?$select=body,subject,conversationId`);
  const quotedPart = full.body?.content || '';
  const combinedHtml = quotedPart ? `${htmlBody}<br><br>${quotedPart}` : htmlBody;
  const patch = { body: { contentType: 'HTML', content: combinedHtml } };
  if (subject) patch.subject = subject;
  // CRITICAL: createReply addresses the draft to the parent message's SENDER.
  // The parent is a message WE sent (it lives in our Sent Items), so the sender
  // is us — without this override the follow-up is addressed back to ourselves.
  // Force the recipient to the actual prospect.
  if (to) patch.toRecipients = [{ emailAddress: { address: to } }];
  await graphMailRequest(accessToken, `/me/messages/${draft.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  await graphMailRequest(accessToken, `/me/messages/${draft.id}/send`, { method: 'POST' });
  // Same as the new-message path: store the durable Sent Items id, not the reply draft's id.
  const real = await resolveSentMessageId(accessToken, { conversationId: full.conversationId || draft.conversationId, toEmail: to, fallbackId: draft.id });
  return { graphMessageId: real.id, conversationId: real.conversationId || full.conversationId || draft.conversationId || null, inReplyTo: parentGraphMessageId };
}

async function findSentMessageInMailbox(accessToken, { toEmail, subjectHint, minDate, conversationId }) {  const params = new URLSearchParams({ '$select': 'id,subject,toRecipients,sentDateTime,conversationId', '$orderby': 'sentDateTime desc', '$top': '75' });
  if (minDate) params.set('$filter', `sentDateTime ge ${minDate}T00:00:00Z`);
  const data = await graphMailRequest(accessToken, `/me/mailFolders/sentitems/messages?${params}`);
  const to = toEmail.toLowerCase().trim();
  const hint = (subjectHint || '').toLowerCase().replace(/^re:\s*/i, '').trim();
  for (const m of (data.value || [])) {
    const recipients = (m.toRecipients || []).map(r => (r.emailAddress?.address || '').toLowerCase());
    if (!recipients.includes(to)) continue;
    if (conversationId && m.conversationId && m.conversationId !== conversationId) continue;
    if (hint && m.subject) {
      const sub = m.subject.toLowerCase().replace(/^re:\s*/i, '').trim();
      if (!sub.includes(hint) && !hint.includes(sub.slice(0, 20))) continue;
    }
    return m.id;
  }
  return null;
}

// Locate a live message we sent in this conversation, by conversationId. This
// finds the parent no matter how old or how deep in Sent Items it is (the
// recency-limited sentitems scan misses originals for high-volume mailboxes).
async function findThreadMessageByConversation(accessToken, { conversationId, toEmail }) {
  if (!conversationId) return null;
  const params = new URLSearchParams({
    '$filter': `conversationId eq '${conversationId}'`,
    '$select': 'id,subject,toRecipients,sentDateTime',
    '$orderby': 'sentDateTime desc',
    '$top': '50'
  });
  let data;
  try { data = await graphMailRequest(accessToken, `/me/messages?${params}`); }
  catch (_) { return null; }
  const to = (toEmail || '').toLowerCase().trim();
  const msgs = data.value || [];
  // Prefer a message WE sent to this recipient (reply threads from our side).
  for (const m of msgs) {
    const recipients = (m.toRecipients || []).map(r => (r.emailAddress?.address || '').toLowerCase());
    if (recipients.includes(to)) return m.id;
  }
  return msgs[0]?.id || null;
}

async function loadSentEmailRecord({ jobId, contactId, followupType }) {
  if (followupType === 'fu2') {
    const { data: fu1 } = await supabase.from('emails').select('id,graph_message_id,conversation_id,subject,body,sent_at,from_email')
      .eq('job_id', jobId).eq('contact_id', contactId).eq('status', 'sent').eq('followup_type', 'fu1')
      .order('sent_at', { ascending: false }).limit(1);
    if (fu1?.[0]) return fu1[0];
  }
  const { data } = await supabase.from('emails').select('id,graph_message_id,conversation_id,subject,body,sent_at,from_email,followup_type')
    .eq('job_id', jobId).eq('contact_id', contactId).eq('status', 'sent').order('sent_at', { ascending: true });
  const rows = data || [];
  return rows.find(r => !r.followup_type || r.followup_type === 'initial') || rows[0] || null;
}

async function resolveThreadParentMessageId({ jobId, contactId, followupType, userEmailId, toEmail, subjectHint }) {
  const prior = await loadSentEmailRecord({ jobId, contactId, followupType });
  if (prior?.graph_message_id) return { parentId: prior.graph_message_id, priorSubject: prior.subject, conversationId: prior.conversation_id, priorEmailRowId: prior.id, priorSentAt: prior.sent_at, storedId: true };
  const accessToken = await getMicrosoftToken(userEmailId);
  let parentId = await findThreadMessageByConversation(accessToken, {
    conversationId: prior?.conversation_id, toEmail
  });
  if (!parentId) parentId = await findSentMessageInMailbox(accessToken, {
    toEmail, subjectHint: subjectHint || prior?.subject, minDate: prior?.sent_at, conversationId: prior?.conversation_id
  });
  if (!parentId) return null;
  return { parentId, priorSubject: prior?.subject || subjectHint, conversationId: prior?.conversation_id, priorEmailRowId: prior?.id, priorSentAt: prior?.sent_at, storedId: false };
}

function formatQuoteDate(sentAt) {
  if (!sentAt) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(sentAt));
  } catch (_) { return String(sentAt); }
}

function buildOutlookQuoteBlock({ fromName, fromEmail, sentAt, subject, body }) {
  const bodyHtml = (body || '').includes('<')
    ? body
    : buildHtmlEmailBody(body, '', false);
  const dateStr = formatQuoteDate(sentAt);
  return `<div style="border:none;border-top:solid #B5C4DF 1.0pt;padding:3.0pt 0in 0in 0in;margin-top:12pt">` +
    `<p style="font-size:11pt;font-family:Calibri,sans-serif;margin:0 0 8pt 0">` +
    `<b>From:</b> ${fromName || 'Sender'}${fromEmail ? ` &lt;${fromEmail}&gt;` : ''}<br>` +
    (dateStr ? `<b>Sent:</b> ${dateStr}<br>` : '') +
    `<b>Subject:</b> ${subject || ''}</p></div>${bodyHtml}`;
}

async function buildQuotedChainFromDb({ jobId, contactId, followupType }) {
  const quoteFrom = async (filterFn) => {
    const { data } = await supabase.from('emails').select('subject,body,sent_at,from_email,followup_type')
      .eq('job_id', jobId).eq('contact_id', contactId).eq('status', 'sent')
      .order('sent_at', { ascending: false }).limit(5);
    const row = (data || []).find(filterFn);
    if (!row) return '';
    // The stored body still carries {{sender}} — quoting it raw would show the
    // token to the recipient inside their own previous message.
    const rendered = renderStoredEmail(row, null);
    return buildOutlookQuoteBlock({
      fromName: row.from_email?.split('@')[0] || 'Sender',
      fromEmail: row.from_email,
      sentAt: row.sent_at,
      subject: rendered.subject,
      body: rendered.body
    });
  };
  if (followupType === 'fu2') {
    const fu1Quote = await quoteFrom(r => r.followup_type === 'fu1');
    if (fu1Quote) return fu1Quote;
  }
  return quoteFrom(r => !r.followup_type || r.followup_type === 'initial');
}

async function persistGraphIds(emailId, graph) {
  if (!emailId || !graph?.graphMessageId) return;
  const { error } = await supabase.from('emails').update({
    graph_message_id: graph.graphMessageId,
    conversation_id: graph.conversationId || null,
    in_reply_to_graph_message_id: graph.inReplyTo || null
  }).eq('id', emailId);
  if (error?.message?.includes('column') || error?.code === '42703') {
    console.warn('[GraphMail] Run migrations/001_email_threading.sql to store message ids for threading');
  }
}

// Gmail delivery — the provider counterpart to the Microsoft path below. Only
// reached for platform=Gmail mailboxes (dispatched in deliverOutboundEmail).
// Gmail threads by threadId, which we stash in the same conversation_id column
// the Graph path uses, so persistGraphIds + later follow-ups thread naturally.
async function deliverViaGmail(email, userEmailId, htmlBody, sendingEmail) {
  const fromAddress = sendingEmail?.email_address || email.from_email || undefined;
  const isFollowup = email.followup_type === 'fu1' || email.followup_type === 'fu2';
  let threadId = null;
  if (isFollowup) {
    const { data: prior } = await supabase.from('emails')
      .select('conversation_id').eq('job_id', email.job_id).eq('contact_id', email.contact_id)
      .not('conversation_id', 'is', null).order('sent_at', { ascending: false }).limit(1).maybeSingle();
    threadId = prior?.conversation_id || null;
  }
  if (isFollowup && threadId) {
    const r = await gmailProvider.sendThreadReply(userEmailId, { to: email.to_email, subject: email.subject, htmlBody, fromAddress, threadId });
    return { graphMessageId: r.messageId, conversationId: r.threadId || threadId, inReplyTo: null };
  }
  const r = await gmailProvider.sendNewMessage(userEmailId, { to: email.to_email, subject: email.subject, htmlBody, fromAddress });
  return { graphMessageId: r.messageId, conversationId: r.threadId || null, inReplyTo: null };
}

async function deliverOutboundEmail(email, userEmailId, signatureHtml, sendingEmail) {
  // ONE identity for the whole message. The body, the subject and the signature
  // are all filled from the mailbox this send actually authenticates with, so
  // "I'm <name>" in the body can never disagree with the name in the signature
  // or with the From address the recipient sees.
  const senderIdentity = senderIdentityFor(sendingEmail, email.from_email);
  const filledSig = fillSignatureHtml(signatureHtml, senderIdentity);
  email = { ...email, ...renderStoredEmail(email, sendingEmail) };
  const subject = email.subject;
  const htmlBody = buildHtmlEmailBody(email.body, filledSig);
  // Provider dispatch: Gmail mailboxes go through the Gmail adapter; everything
  // else keeps the exact Microsoft Graph path unchanged.
  const platform = (sendingEmail?.platform || 'Microsoft').toLowerCase();
  if (platform === 'gmail' || platform === 'google') {
    return deliverViaGmail(email, userEmailId, htmlBody, sendingEmail);
  }
  const isFollowup = email.followup_type === 'fu1' || email.followup_type === 'fu2';
  if (!isFollowup) {
    return sendMicrosoftNewMessage(userEmailId, { to: email.to_email, subject: email.subject, htmlBody });
  }
  const thread = await resolveThreadParentMessageId({
    jobId: email.job_id, contactId: email.contact_id, followupType: email.followup_type,
    userEmailId, toEmail: email.to_email, subjectHint: email.subject
  });
  if (thread?.parentId) {
    try {
      const graph = await sendMicrosoftThreadReply(userEmailId, thread.parentId, { htmlBody, subject: email.subject, to: email.to_email });
      // Self-heal: if the parent was located via mailbox lookup (no id stored on the original),
      // backfill it so later follow-ups in this thread resolve instantly instead of re-scanning.
      if (thread.priorEmailRowId && thread.storedId === false) {
        try { await supabase.from('emails').update({ graph_message_id: thread.parentId }).eq('id', thread.priorEmailRowId); } catch (_) {}
      }
      return graph;
    } catch (e) {
      if (!isGraphItemNotFound(e)) throw e;
      // The stored parent id is stale: ids saved before immutable ids were
      // requested point at the pre-send Drafts copy, and mutable ids die when
      // the message moves to Sent Items. Re-find the real sent message and
      // heal the stored id so FU2 doesn't hit this again.
      const accessToken = await getMicrosoftToken(userEmailId);
      // Look up by conversationId first — reliable regardless of how old/buried
      // the original is — then fall back to the recency-limited Sent Items scan.
      let freshId = await findThreadMessageByConversation(accessToken, {
        conversationId: thread.conversationId, toEmail: email.to_email
      });
      if (!freshId) freshId = await findSentMessageInMailbox(accessToken, {
        toEmail: email.to_email,
        subjectHint: thread.priorSubject || email.subject,
        minDate: thread.priorSentAt,
        conversationId: thread.conversationId
      });
      if (freshId && freshId !== thread.parentId) {
        const graph = await sendMicrosoftThreadReply(userEmailId, freshId, { htmlBody, subject: email.subject, to: email.to_email });
        if (thread.priorEmailRowId) {
          try { await supabase.from('emails').update({ graph_message_id: freshId }).eq('id', thread.priorEmailRowId); } catch (_) {}
        }
        return graph;
      }
      return await sendFollowupFreshWithQuote(email, userEmailId, htmlBody);
    }
  }
  return await sendFollowupFreshWithQuote(email, userEmailId, htmlBody);
}

// Kept for the processPendingEmailSends deferral path, but the live send path no longer defers
// follow-ups forever — see sendFollowupFreshWithQuote below.
function throwDeferFollowup() {
  const deferErr = new Error('Follow-up deferred: original thread message not found yet.');
  deferErr.deferFollowup = true;
  throw deferErr;
}

// When threading can't resolve a real parent in the mailbox (e.g. a stale draft-era id on an old
// original), send the follow-up as a fresh message with the original quoted underneath — built
// from the DB — so the "original below the follow-up" design still holds and the email actually
// goes out instead of getting stuck. The "Re:" is stripped so it reads as a clean message rather
// than a fake-threaded "Re:" that carries no In-Reply-To/References headers.
async function sendFollowupFreshWithQuote(email, userEmailId, htmlBody) {
  let quote = '';
  try {
    quote = await buildQuotedChainFromDb({ jobId: email.job_id, contactId: email.contact_id, followupType: email.followup_type });
  } catch (_) {}
  const combinedHtml = quote ? `${htmlBody}<br><br>${quote}` : htmlBody;
  const subject = (email.subject || '').replace(/^(Re:\s*)+/i, '');
  return sendMicrosoftNewMessage(userEmailId, { to: email.to_email, subject, htmlBody: combinedHtml });
}

// Auto-send all pending emails for a specific BD manager (called after assignment)
async function fetchPendingEmailsForUser(userId) {
  let pendingEmails = [], from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('emails')
      .select(PENDING_EMAIL_JOB_SELECT)
      .eq('sent_by', userId)
      .eq('status', 'pending')
      // Ordered for two reasons: .range() pagination without an ORDER BY can
      // repeat or skip rows between pages, and the send loop wants the oldest
      // email first within a priority band.
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || !data.length) break;
    pendingEmails = pendingEmails.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return pendingEmails;
}

// Translate noisy provider/Graph errors into something a BD user can act on.
function friendlySendError(msg) {
  const m = String(msg || '').trim();
  if (!m) return 'Send failed (unknown error)';
  const low = m.toLowerCase();
  if (low.includes('not found in the store') || low.includes('failed to get the correct properties'))
    return "Outlook couldn't process this message (mailbox sync issue). Try resending; if it keeps failing, reconnect the sending mailbox.";
  if (low.includes('no microsoft token') || low.includes('please reconnect') || low.includes('token refresh failed') || low.includes('invalidauthenticationtoken'))
    return 'Sending mailbox sign-in expired — reconnect it under Settings → Email IDs.';
  if (low.includes('inactivemailbox') || low.includes('mailboxnotenabledforrestapi'))
    return 'Sending mailbox is inactive or unlicensed — check the Microsoft 365 account.';
  if (low.includes('throttl') || low.includes('429') || low.includes('too many requests') || low.includes('quota'))
    return 'Microsoft rate limit reached — wait and resend.';
  if (low.includes('restricted') || low.includes('submission') && low.includes('block'))
    return 'Microsoft has restricted this mailbox from sending — check Defender → Restricted users.';
  if (low.includes('recipient') && (low.includes('invalid') || low.includes('reject')))
    return 'Recipient address was rejected by the mail server.';
  return m;
}

async function processPendingEmailSends(userId, pendingEmails, opts = {}) {
  const { autoSend = false } = opts;
  const sendWindow = await getSendWindowHours();
  const totalCount = pendingEmails.length;
  let sent = 0, failed = 0, skippedWindow = 0, skippedQuota = 0, skippedDomain = 0, skippedContactStatus = 0, skippedThread = 0, skippedInactive = 0, skippedSuppressed = 0;
  const failDetails = [], sentContactIds = [], sentJobIds = [];
  const startedAt = new Date().toISOString();

  // Load delivery status for every pending recipient (not just follow-ups) so we can
  // skip known-bad addresses on initial outreach too — hard bounces to invalid/deactivated
  // mailboxes are a primary driver of sender-reputation damage and "compromised account" flags.
  const statusContactIds = [...new Set(pendingEmails.map(e => e.contact_id).filter(Boolean))];
  const contactStatusById = {};
  if (statusContactIds.length) {
    const { data: statusContacts } = await supabase.from('contacts').select('id,email,email_status').in('id', statusContactIds);
    (statusContacts || []).forEach(c => { contactStatusById[c.id] = c; });
  }

  // Opt-out / suppression set + per-mailbox warm-up/auto-pause state. Both are
  // best-effort: absent table/columns => empty => no behaviour change.
  const suppressed = await loadSuppressedSet([...new Set(pendingEmails.map(e => (e.to_email || '').toLowerCase()).filter(Boolean))]);

  // Per-email sending-mailbox override (sequence "from"-mailbox rotation).
  // Best-effort: a NULL/absent column (migration 008 not applied) => no
  // overrides => every email uses its job's sending mailbox, exactly as before.
  const overrideByEmailId = {};
  try {
    const emailIds = pendingEmails.map(e => e.id);
    if (emailIds.length) {
      const { data: ovr } = await supabase.from('emails').select('id,sending_email_id').in('id', emailIds);
      (ovr || []).forEach(r => { if (r.sending_email_id) overrideByEmailId[r.id] = r.sending_email_id; });
    }
  } catch (_) { /* column absent -> no overrides */ }
  const overrideMailboxIds = [...new Set(Object.values(overrideByEmailId))];
  const overrideMailboxes = {};
  if (overrideMailboxIds.length) {
    try {
      const { data: mbs } = await supabase.from('user_emails')
        .select('id,email_address,display_name,platform,daily_send_limit,is_active').in('id', overrideMailboxIds);
      (mbs || []).forEach(m => { overrideMailboxes[m.id] = m; });
    } catch (_) {}
  }

  const mailboxIds = [...new Set([
    ...pendingEmails.map(e => e.job?.sending_email_id),
    ...overrideMailboxIds
  ].filter(Boolean))];
  const [mailboxSignatures, quotaState, mailboxDeliv, warmupStart, warmupStep] = await Promise.all([
    loadMailboxSignatures(mailboxIds, userId),
    loadMailboxQuotaState(mailboxIds),
    loadMailboxDelivState(mailboxIds),
    settingsConfig.getSetting(supabase, 'mailbox_warmup_start'),
    settingsConfig.getSetting(supabase, 'mailbox_warmup_step'),
  ]);
  const { limits, sentToday, delays, settings } = quotaState;
  const lastSendAtByMailbox = {};
  const domainTimestamps = {};
  let sendAttempts = 0;
  const maxPerRun = settings.maxPerRun || 0;

  const inWindow = [], outWindow = [];
  for (const email of pendingEmails) {
    const leadTz = email.job?.timezone || 'EST';
    if (isInLeadSendWindow(leadTz, new Date(), sendWindow)) inWindow.push(email);
    else outWindow.push(email);
  }
  const ordered = orderPendingForSend(inWindow).concat(orderPendingForSend(outWindow));

  for (const email of ordered) {
    if (isSendingPaused() || isManagerPaused(userId)) {
      console.log(`[EmergencyStop] Sending paused (global or manager ${userId}) mid-run — halting; remaining emails stay pending`);
      break;
    }
    const leadTz = email.job?.timezone || 'EST';
    // Rotation: a per-email override mailbox wins over the job's default. All
    // downstream logic (quota, warm-up, threading, delivery) keys off these two.
    const overrideId = overrideByEmailId[email.id];
    const userEmailId = overrideId || email.job?.sending_email_id;
    const sendingEmail = (overrideId && overrideMailboxes[overrideId]) || email.job?.sending_email;
    const platform = (sendingEmail?.platform || 'Microsoft').toLowerCase();

    const progressBase = {
      active: true, total: totalCount, sent, failed,
      deferred: skippedWindow + skippedQuota + skippedDomain + skippedContactStatus + skippedThread + skippedInactive,
      deferredWindow: skippedWindow, deferredQuota: skippedQuota, deferredDomain: skippedDomain,
      deferredThread: skippedThread, deferredInactive: skippedInactive,
      skippedContactStatus,
      failDetails, startedAt, autoSend
    };

    if (sendingEmail && sendingEmail.is_active === false) {
      skippedInactive++;
      await setSendProgress(userId, { ...progressBase, current: `${email.to_email} (sending mailbox disabled — skipped)` });
      continue;
    }

    if (userEmailId && mailboxDeliv[userEmailId] && mailboxDeliv[userEmailId].auto_paused_at) {
      skippedInactive++;
      await setSendProgress(userId, { ...progressBase, current: `${email.to_email} (mailbox auto-paused: high bounce rate)` });
      continue;
    }

    if (suppressed.has((email.to_email || '').toLowerCase())) {
      skippedSuppressed++;
      failDetails.push({ id: email.id, job_id: email.job_id, contact_id: email.contact_id, to: email.to_email, from: sendingEmail?.email_address || email.from_email || '—', error: 'Recipient is on the opt-out / suppression list — not sent' });
      try { await supabase.from('emails').update({ status: 'failed' }).eq('id', email.id); } catch (_) {}
      await setSendProgress(userId, { ...progressBase, current: `${email.to_email} (suppressed — opted out)` });
      continue;
    }

    if (!isInLeadSendWindow(leadTz, new Date(), sendWindow)) {
      skippedWindow++;
      await setSendProgress(userId, { ...progressBase, current: `${email.to_email} (waiting ${leadTz} send window)` });
      continue;
    }

    if (maxPerRun > 0 && sendAttempts >= maxPerRun) break;

    if (!userEmailId) {
      sendAttempts++;
      failed++;
      failDetails.push({ id: email.id, job_id: email.job_id, contact_id: email.contact_id, to: email.to_email, from: email.from_email || '—', error: 'No sending email configured for this job' });
      try { await supabase.from('emails').update({ status: 'failed' }).eq('id', email.id); } catch (_) {}
      await setSendProgress(userId, { ...progressBase, current: email.to_email });
      continue;
    }

    const baseLimit = limits[userEmailId] || sendingEmail?.daily_send_limit || settings.defaultDailyLimit;
    const wl = warmupLimit(mailboxDeliv[userEmailId], warmupStart, warmupStep);
    const limit = wl != null ? Math.min(baseLimit, wl) : baseLimit;
    if ((sentToday[userEmailId] || 0) >= limit) {
      skippedQuota++;
      await setSendProgress(userId, { ...progressBase, current: `${email.to_email} (mailbox daily limit ${limit} reached)` });
      continue;
    }

    const domain = emailDomain(email.to_email);
    if (domain && domainSendsInLastHour(domainTimestamps, domain) >= settings.domainMaxPerHour) {
      skippedDomain++;
      await setSendProgress(userId, { ...progressBase, current: `${email.to_email} (domain ${domain} throttled)` });
      continue;
    }

    // Gmail sends now dispatch through the Gmail adapter in deliverOutboundEmail.
    // Only hard-fail here when Gmail isn't configured on the server at all; a
    // configured-but-not-connected mailbox falls through and surfaces a clear
    // "reconnect" error from the provider via the normal catch below.
    if ((platform === 'gmail' || platform === 'google') && !gmailProvider.isConfigured()) {
      sendAttempts++;
      failed++;
      failDetails.push({ id: email.id, job_id: email.job_id, contact_id: email.contact_id, to: email.to_email, from: sendingEmail?.email_address || '—', error: 'Gmail sending is not configured on the server yet' });
      try { await supabase.from('emails').update({ status: 'failed' }).eq('id', email.id); } catch (_) {}
      await setSendProgress(userId, { ...progressBase, current: email.to_email });
      continue;
    }
    if (!emailSyntaxValid(email.to_email)) {
      sendAttempts++;
      failed++;
      failDetails.push({ id: email.id, job_id: email.job_id, contact_id: email.contact_id, to: email.to_email || '(empty)', from: sendingEmail?.email_address || email.from_email || '—', error: `Invalid recipient address: "${email.to_email}" — not an email` });
      try { await supabase.from('emails').update({ status: 'failed' }).eq('id', email.id); } catch (_) {}
      await setSendProgress(userId, { ...progressBase, current: email.to_email });
      continue;
    }

    const isFollowup = email.followup_type === 'fu1' || email.followup_type === 'fu2';

    // Skip recipients flagged as permanently undeliverable (invalid/deactivated) for ALL
    // email types. Sending to addresses we already know bounce damages domain reputation.
    if (email.contact_id) {
      const contact = contactStatusById[email.contact_id];
      if (contact && isPermanentFollowupBlock(contact.email_status)) {
        skippedContactStatus++;
        if (isFollowup) {
          await cancelBlockedFollowupSend(email, contact.email_status);
        } else {
          try { await supabase.from('emails').update({ status: 'failed' }).eq('id', email.id); } catch (_) {}
        }
        await setSendProgress(userId, { ...progressBase, current: `${email.to_email} (skipped: ${contactEmailStatus(contact)} address)` });
        continue;
      }
    }

    if (isFollowup && email.contact_id) {
      const contact = contactStatusById[email.contact_id];
      if (contact && !isFollowupEligibleContact(contact)) {
        skippedContactStatus++;
        await cancelBlockedFollowupSend(email, contact.email_status);
        await setSendProgress(userId, { ...progressBase, current: `${email.to_email} (follow-up skipped: ${contactEmailStatus(contact)})` });
        continue;
      }
    }

    await waitForMailboxSlot(userEmailId, lastSendAtByMailbox, delays);
    await setSendProgress(userId, { ...progressBase, current: email.to_email });

    try {
      sendAttempts++;
      // ── ATOMIC CLAIM (prevents duplicate sends) ───────────────────────────
      // Flip pending→sending in ONE conditional update. If any other run
      // (a second /emails/queue-all from a double-click, the 20-min deferred
      // retry, or auto-send after lead assignment) already claimed this row,
      // zero rows come back and we skip — so a single email row can never be
      // dispatched to the provider twice. Status is only marked 'sent' after a
      // successful send; a genuine failure sets 'failed' below, and a deferred
      // follow-up is released back to 'pending' in the catch.
      const { data: claimedRows, error: claimErr } = await supabase
        .from('emails').update({ status: 'sending' })
        .eq('id', email.id).eq('status', 'pending').select('id');
      if (claimErr) throw claimErr;
      if (!claimedRows || !claimedRows.length) {
        console.log(`[SendGuard] email ${email.id} (${email.to_email}) already claimed by another run — skipping to avoid a duplicate send`);
        continue;
      }
      const sigTemplate = resolveSignatureHtml(email._sigHtml || mailboxSignatures[userEmailId]);
      const graph = await deliverOutboundEmail(email, userEmailId, sigTemplate, sendingEmail);
      await supabase.from('emails').update({ status: 'sent', sent_at: today() }).eq('id', email.id);
      await persistGraphIds(email.id, graph);
      emit(EVENTS.EMAIL_SENT, { emailId: email.id, jobId: email.job_id, contactId: email.contact_id, managerId: userId, followupType: email.followup_type || 'initial', toEmail: email.to_email });
      const todayDate = today();
      sentToday[userEmailId] = (sentToday[userEmailId] || 0) + 1;
      await supabase.from('email_send_log').upsert(
        { user_email_id: userEmailId, send_date: todayDate, emails_sent: sentToday[userEmailId] },
        { onConflict: 'user_email_id,send_date' }
      );
      lastSendAtByMailbox[userEmailId] = Date.now();
      if (domain) {
        if (!domainTimestamps[domain]) domainTimestamps[domain] = [];
        domainTimestamps[domain].push(Date.now());
      }
      if (email.contact_id) sentContactIds.push(email.contact_id);
      if (email.job_id) sentJobIds.push(email.job_id);
      sent++;
      await setSendProgress(userId, { ...progressBase, sent, current: email.to_email });
    } catch (e) {
      if (e && e.deferFollowup) {
        // Thread parent not resolvable yet — release the claim back to pending
        // so a later run can send it as a true reply (it was NOT dispatched).
        try { await supabase.from('emails').update({ status: 'pending' }).eq('id', email.id).eq('status', 'sending'); } catch (_) {}
        skippedThread++;
        await setSendProgress(userId, { ...progressBase, current: `${email.to_email} (follow-up waiting for thread)` });
        continue;
      }
      failed++;
      failDetails.push({ id: email.id, job_id: email.job_id, contact_id: email.contact_id, to: email.to_email, from: sendingEmail?.email_address || email.from_email || '—', error: friendlySendError(e.message) });
      try { await supabase.from('emails').update({ status: 'failed' }).eq('id', email.id); } catch (_) {}
      lastSendAtByMailbox[userEmailId] = Date.now();
      await setSendProgress(userId, { ...progressBase, failed, current: email.to_email });
    }
  }

  return { sent, failed, skippedWindow, skippedQuota, skippedDomain, skippedContactStatus, skippedThread, skippedInactive, skippedSuppressed, failDetails, sentContactIds, sentJobIds, totalCount, sendWindow };
}

async function retryDeferredPendingSends() {
  try {
    const { data, error } = await supabase.from('emails').select('sent_by').eq('status', 'pending');
    if (error) throw error;
    const userIds = [...new Set((data || []).map(r => r.sent_by).filter(Boolean))];
    for (const uid of userIds) await autoSendForManager(uid);
  } catch (e) {
    console.error('[SendWindowRetry] Error:', e.message);
  }
}

async function autoSendForManager(managerId) {
  if (isSendingPaused() || isManagerPaused(managerId)) {
    console.log(`[EmergencyStop] Sending paused (global or manager) — not starting auto-send for manager ${managerId}`);
    return;
  }
  if (activeSendByUser.has(managerId)) {
    console.log(`[AutoSend] Already running for manager ${managerId}, skipping`);
    return;
  }
  activeSendByUser.add(managerId);
  try {
    let pendingEmails = await fetchPendingEmailsForUser(managerId);
    if (!pendingEmails.length) {
      console.log(`[AutoSend] No pending emails yet for manager ${managerId}, retrying in 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      pendingEmails = await fetchPendingEmailsForUser(managerId);
      if (!pendingEmails.length) {
        console.log(`[AutoSend] Still no pending emails for manager ${managerId} after retry — aborting`);
        return;
      }
    }
    const totalCount = pendingEmails.length;
    console.log(`[AutoSend] Starting auto-send of ${totalCount} emails for manager ${managerId}`);
    await setSendProgress(managerId, { active: true, total: totalCount, sent: 0, failed: 0, deferred: 0, current: '', failDetails: [], startedAt: new Date().toISOString(), autoSend: true });

    const { sent, failed, skippedWindow, skippedQuota, skippedDomain, failDetails, sentContactIds, sentJobIds, sendWindow } = await processPendingEmailSends(managerId, pendingEmails, { autoSend: true });

    const uniqueContactIds = [...new Set(sentContactIds.filter(Boolean))];
    if (uniqueContactIds.length) await supabase.from('contacts').update({ email_sent_at: today() }).in('id', uniqueContactIds);
    const uniqueJobIds = [...new Set(sentJobIds.filter(Boolean))];
    for (const jid of uniqueJobIds) await logActivity(jid, null, managerId, 'emails_sent', `${sent} email(s) auto-sent via Microsoft`, null, null);

    const deferredTotal = skippedWindow + skippedQuota + skippedDomain;
    await setSendProgress(managerId, {
      active: false, done: true, total: totalCount, sent, failed, deferred: deferredTotal,
      deferredWindow: skippedWindow, deferredQuota: skippedQuota, deferredDomain: skippedDomain,
      failDetails,
      deferredNote: buildDeferredNote({ skippedWindow, skippedQuota, skippedDomain, sendWindow }),
      completedAt: new Date().toISOString(), autoSend: true
    });
    setTimeout(() => clearSendProgress(managerId), 300000);
    console.log(`[AutoSend] Completed for manager ${managerId}: ${sent} sent, ${failed} failed, ${skippedWindow} quota=${skippedQuota} domain=${skippedDomain}`);
  } catch (err) {
    console.error(`[AutoSend] Error for manager ${managerId}:`, err.message);
  } finally {
    activeSendByUser.delete(managerId);
  }
}


// Per-BD-manager RA automation mode: 'auto' (default — leads auto-enroll and the
// outreach sequence sends itself) or 'manual' (leads are assigned but the BD
// generates and sends outreach themselves). Read at assignment time.
async function getManagerRaMode(bdId) {
  if (!bdId) return 'auto';
  const { data } = await supabase.from('app_settings').select('value').eq('key', `u_${bdId}_ra_mode`).limit(1);
  return (data && data[0] && data[0].value === 'manual') ? 'manual' : 'auto';
}

// Admin/leads read the RA mode for one or all BD managers.
// /admin/manager-ra-modes + /admin/manager-ra-mode → extracted to
// routes/distribution.js (mounted below).

app.post('/distribute/execute', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'RA Lead only' });
    const { manager_id, ratio } = req.body;
    if (!manager_id || !ratio) return res.status(400).json({ error: 'manager_id and ratio required' });

    // Get manager's active email accounts that have a working, connected token
    // (Microsoft or Gmail — leads used to only ever go to Microsoft mailboxes,
    // silently starving Gmail accounts and any mailbox whose token had gone
    // bad, since a stale/broken token row still counted as "connected").
    const { data: allUserEmails } = await supabase.from('user_emails')
      .select('id,email_address,display_name,daily_send_limit').eq('user_id', manager_id).eq('is_active', true);
    if (!allUserEmails?.length) return res.status(400).json({ error: 'Manager has no active email IDs configured' });
    const emailIds = allUserEmails.map(e => e.id);
    const [{ data: msTokens }, { data: gmailTokens }] = await Promise.all([
      supabase.from('microsoft_tokens').select('user_email_id,refresh_failed').in('user_email_id', emailIds),
      supabase.from('gmail_tokens').select('user_email_id,refresh_failed').in('user_email_id', emailIds),
    ]);
    const connectedIds = new Set(
      [...(msTokens || []), ...(gmailTokens || [])]
        .filter(t => !t.refresh_failed)
        .map(t => t.user_email_id)
    );
    const userEmails = allUserEmails.filter(e => connectedIds.has(e.id));
    if (!userEmails?.length) return res.status(400).json({ error: 'Manager has no connected, working email accounts — please connect or reconnect one under Email IDs' });

    const todayDate = today();
    const { data: sendLogs } = await supabase.from('email_send_log').select('user_email_id,emails_sent').eq('send_date', todayDate);
    const sentToday = {};
    (sendLogs || []).forEach(l => { sentToday[l.user_email_id] = l.emails_sent; });

    const accounts = userEmails.map(a => ({ ...a, remaining: (a.daily_send_limit || 150) - (sentToday[a.id] || 0) })).filter(a => a.remaining > 0);
    if (!accounts.length) return res.status(400).json({ error: 'All email IDs have reached daily limit' });

    const totalCapacity = accounts.reduce((s, a) => s + a.remaining, 0);
    const totalToSend = Math.min(ratio.total_to_send || 50, totalCapacity);

    // Fetch all unassigned leads — use range to bypass Supabase 1000 row default limit
    let pool = [], from = 0;
    while (true) {
      let q = withOrg(supabase.from('jobs').select('id,position,freshness,industry,timezone,is_duplicate').is('deleted_at', null).eq('stage', 'Unassigned').is('assigned_to_bd', null).range(from, from + 999), req);
      if (ratio.exclude_duplicates) q = q.eq('is_duplicate', false);
      const { data } = await q;
      if (!data || !data.length) break;
      pool = pool.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    if (!pool?.length) return res.status(400).json({ error: 'No unassigned leads in pool' });

    const freshnessOrder = { 'Old': 0, 'Normal': 1, 'New': 2, '': 3 };
    const sorted = [...pool].sort((a, b) => (freshnessOrder[a.freshness] ?? 3) - (freshnessOrder[b.freshness] ?? 3));
    const selected = [];
    const used = { freshness: {}, industry: {}, timezone: {} };
    for (const job of sorted) {
      if (selected.length >= totalToSend) break;
      selected.push(job);
      used.freshness[job.freshness] = (used.freshness[job.freshness] || 0) + 1;
      used.industry[job.industry] = (used.industry[job.industry] || 0) + 1;
      used.timezone[job.timezone] = (used.timezone[job.timezone] || 0) + 1;
    }
    if (!selected.length) return res.status(400).json({ error: 'No leads matched distribution criteria' });

    const assignedLeads = [];
    const now = new Date();

    // Build a flat assignment queue — fill each account's slot count proportionally,
    // then shuffle the whole queue so jobs are interleaved randomly
    const totalToAssign = selected.length;
    const totalCap = accounts.reduce((s, a) => s + a.remaining, 0);
    const assignmentQueue = [];
    for (const account of accounts) {
      // How many of the totalToAssign does this account get, proportional to its remaining capacity
      const share = Math.round((account.remaining / totalCap) * totalToAssign);
      for (let i = 0; i < share; i++) assignmentQueue.push(account.id);
    }
    // If rounding left us short or over, pad/trim to exactly totalToAssign
    while (assignmentQueue.length < totalToAssign) assignmentQueue.push(accounts[assignmentQueue.length % accounts.length].id);
    while (assignmentQueue.length > totalToAssign) assignmentQueue.pop();
    // Fisher-Yates shuffle so assignment order is random, not blocks
    for (let i = assignmentQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [assignmentQueue[i], assignmentQueue[j]] = [assignmentQueue[j], assignmentQueue[i]];
    }

    console.log(`[Distribute] Accounts in pool: ${accounts.map(a => a.email_address).join(', ')}`);
    console.log(`[Distribute] Assignment queue breakdown:`, assignmentQueue.reduce((m, id) => { m[id] = (m[id]||0)+1; return m; }, {}));

    for (let i = 0; i < selected.length; i++) {
      const job = selected[i];
      const emailId = assignmentQueue[i];
      await supabase.from('jobs').update({ assigned_to_bd: manager_id, sending_email_id: emailId, stage: 'Assigned', assigned_at: now, updated_at: now }).eq('id', job.id);
      assignedLeads.push({ job_id: job.id, user_email_id: emailId });
    }

    // Daily send quota is charged on actual delivery (see processPendingEmailSends), not at
    // assignment time. Pre-charging here made the auto-sender read a phantom "full" quota and
    // defer every queued email, so nothing actually left the mailbox.

    // Respect the manager's RA mode: 'manual' assigns the leads but leaves
    // outreach to the BD (no auto follow-up schedule, no auto generate+send).
    const raMode = await getManagerRaMode(manager_id);
    const autoSend = raMode !== 'manual';

    // Create follow-up rows
    const jobIds = selected.map(j => j.id);
    const outreachDateStr = now.toISOString().split('T')[0];
    const { data: bdSettings } = await supabase.from('app_settings').select('key,value').in('key', [`u_${manager_id}_fu1_day`, `u_${manager_id}_fu2_day`]);
    const bdSettingsMap = {};
    (bdSettings || []).forEach(r => { bdSettingsMap[r.key] = r.value; });
    const fu1Day = parseInt(bdSettingsMap[`u_${manager_id}_fu1_day`] || '3', 10);
    const fu2Day = parseInt(bdSettingsMap[`u_${manager_id}_fu2_day`] || '7', 10);
    const fu1Date = new Date(now); fu1Date.setDate(fu1Date.getDate() + fu1Day);
    const fu2Date = new Date(now); fu2Date.setDate(fu2Date.getDate() + fu2Day);
    const fu1Str = fu1Date.toISOString().split('T')[0];
    const fu2Str = fu2Date.toISOString().split('T')[0];
    const { data: assignedJobs } = await supabase.from('jobs').select('id,sending_email_id,contacts(id,email,email_status)').in('id', jobIds);
    const followUpRows = [];
    for (const aj of (assignedJobs || [])) {
      const contacts = (aj.contacts || []).filter(c => emailSyntaxValid(c.email) && isFollowupEligibleContact(c));
      for (const c of contacts) {
        followUpRows.push({ job_id: aj.id, contact_id: c.id, user_email_id: aj.sending_email_id, outreach_sent_at: outreachDateStr, followup1_due_date: fu1Str, followup2_due_date: fu2Str, status: 'active' });
      }
    }
    // In manual mode, skip the automatic follow-up schedule — the BD drives
    // outreach (and its follow-ups) by hand.
    if (autoSend && followUpRows.length) await supabase.from('follow_ups').insert(followUpRows);

    // Announce the assignment. In auto mode the lead.assigned subscriber
    // generates the emails and triggers the send; in manual mode it records the
    // assignment for audit but does not auto-send (autoSend:false).
    emit(EVENTS.LEAD_ASSIGNED, { jobIds, managerId: manager_id, actorUserId: req.user.id, autoSend });

    res.json({ success: true, total_assigned: selected.length, manager_id, by_freshness: used.freshness, by_industry: used.industry, by_timezone: used.timezone, email_accounts_used: new Set(assignedLeads.map(l => l.user_email_id)).size, ratio_summary: ratio.summary || '', assigned_at: now.toISOString(), auto_send: autoSend, ra_mode: raMode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// /distribute/pool-stats + /distribute/today-summary → extracted to
// routes/distribution.js (mounted below).




// /ai/generate-email + /ai/generate-summary → extracted to routes/ai.js (mounted below).

// app-settings + outreach-plan → extracted to routes/settings.js (mounted below).

// ══════════════════════════════════════════════════════════════
// FOLLOW-UPS
// ══════════════════════════════════════════════════════════════
app.get('/follow-ups', auth, async (req, res) => {
  try {
    let query = supabase.from('follow_ups').select(`*, contact:contacts(id,first_name,last_name,email,designation), job:jobs(id,position,stage,company:companies(name))`).order('followup1_due_date', { ascending: true });
    if (hasRole(req, 'bd') && !hasRole(req, 'admin', 'ra_lead', 'bd_lead')) {
      const { data: myJobs } = await supabase.from('jobs').select('id').eq('assigned_to_bd', req.user.id).is('deleted_at', null);
      const myJobIds = (myJobs || []).map(j => j.id);
      if (!myJobIds.length) return res.json([]);
      query = query.in('job_id', myJobIds);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/follow-ups/run', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead')) return res.status(403).json({ error: 'Admin only' });
    const result = await runFollowupEngine();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function runFollowupEngine() {
  const todayDate = today();
  const log = { checked: 0, fu1_queued: 0, fu2_queued: 0, skipped_quota: 0, skipped_stage: 0, skipped_contact_status: 0, skipped_inactive_mailbox: 0, skipped_duplicate: 0 };
  // Apply any bounces that arrived since the last 30-min sweep BEFORE deciding
  // who to follow up — so a contact whose earlier email just bounced is already
  // marked invalid and gets skipped here instead of receiving another send.
  try { await runBounceSweep(); } catch (e) { console.error('[Followup] pre-run bounce sweep failed:', e.message); }
  try {
    const { data: dueFu, error: fuErr } = await supabase.from('follow_ups')
      .select(`*, contact:contacts(id,first_name,last_name,email,designation,email_status,ooo_until), job:jobs(id,position,location,salary_range,research,industry,stage,timezone,assigned_to_bd,company:companies(name,industry,location),sending_email:user_emails!sending_email_id(id,email_address,display_name,is_active))`)
      .eq('status', 'active');
    if (fuErr) throw fuErr;
    log.checked = (dueFu || []).length;

    const { data: settingsRows } = await supabase.from('app_settings').select('key,value');
    const settings = {};
    (settingsRows || []).forEach(r => { settings[r.key] = r.value; });

    function getBDTemplate(bdId, key, globalKey, fallback) {
      const shortKey = key.replace('tmpl_', '');
      const saved = settings[`u_${bdId}_${key}`] || settings[globalKey] || '';
      return resolveTemplate(saved, shortKey) || fallback;
    }
    const { data: sendLogs } = await supabase.from('email_send_log').select('user_email_id,emails_sent').eq('send_date', todayDate);
    const sentToday = {};
    (sendLogs || []).forEach(l => { sentToday[l.user_email_id] = l.emails_sent || 0; });

    const { data: allEmails } = await supabase.from('user_emails').select('id,daily_send_limit').eq('is_active', true);
    const limitMap = {};
    (allEmails || []).forEach(a => { limitMap[a.id] = a.daily_send_limit || 150; });

    const bdIdSet = [...new Set((dueFu || []).map(f => f.job?.assigned_to_bd).filter(Boolean))];
    let bdMap = {};
    if (bdIdSet.length) {
      const { data: bdUsers } = await supabase.from('users').select('id,name').in('id', bdIdSet);
      (bdUsers || []).forEach(u => { bdMap[u.id] = u.name; });
    }

    const emailsToInsert = [];
    const fu1Updates = [];
    const fu2Updates = [];
    const acCountDelta = {};

    const fu1Due = (dueFu || []).filter(f => !f.followup1_sent_at && f.followup1_due_date <= todayDate);
    const fu2Due = (dueFu || []).filter(f => f.followup1_sent_at && !f.followup2_sent_at && f.followup2_due_date <= todayDate);

    const fuJobIds = [...new Set((dueFu || []).map(f => f.job_id).filter(Boolean))];
    const variantByPair = {};
    if (fuJobIds.length) {
      const { data: o1Sent } = await supabase.from('emails')
        .select('job_id, contact_id, template_variant, sent_at')
        .in('job_id', fuJobIds)
        .eq('status', 'sent')
        .is('followup_type', null)
        .order('sent_at', { ascending: false });
      (o1Sent || []).forEach(row => {
        const key = `${row.job_id}:${row.contact_id}`;
        if (!variantByPair[key] && row.template_variant) variantByPair[key] = row.template_variant;
      });
    }

    // Double-send guard: skip queueing an automatic follow-up to any contact that
    // already has a reminder or follow-up email pending or sent today (e.g. a
    // manual reminder the BD just sent). Deferred follow-ups retry on the next run.
    const dueContactIds = [...new Set([...fu1Due, ...fu2Due].map(f => f.contact_id).filter(Boolean))];
    const liveOutreachPairs = new Set();
    if (dueContactIds.length) {
      const { data: liveRows } = await supabase.from('emails')
        .select('job_id, contact_id, status, sent_at, followup_type')
        .in('contact_id', dueContactIds)
        .in('followup_type', FOLLOWUP_EMAIL_TYPES);
      (liveRows || []).forEach(r => { if (isLiveOutreachRow(r)) liveOutreachPairs.add(`${r.job_id}:${r.contact_id}`); });
    }

    for (const fuList of [fu1Due, fu2Due]) {
      const isFu2 = fuList === fu2Due;
      for (const fu of fuList) {
        const job = fu.job;
        if (!job || job.stage !== 'Assigned') {
          await supabase.from('follow_ups').update({ status: 'skipped' }).eq('id', fu.id);
          log.skipped_stage++; continue;
        }
        const acId = job.sending_email?.id;
        if (!acId) continue;
        // Don't queue follow-ups from a disabled mailbox — disabling must actually stop sends.
        if (job.sending_email?.is_active === false) { log.skipped_inactive_mailbox++; continue; }
        const rem = (limitMap[acId] || 150) - (sentToday[acId] || 0) - (acCountDelta[acId] || 0);
        if (rem <= 0) { log.skipped_quota++; continue; }
        const contact = fu.contact;
        if (!contact?.email) continue;
        if (!isFollowupEligibleContact(contact)) {
          log.skipped_contact_status++;
          if (isPermanentFollowupBlock(contactEmailStatus(contact))) {
            await supabase.from('follow_ups').update({ status: 'skipped' }).eq('id', fu.id);
          }
          continue;
        }
        const dupKey = `${fu.job_id}:${fu.contact_id}`;
        if (liveOutreachPairs.has(dupKey)) { log.skipped_duplicate = (log.skipped_duplicate || 0) + 1; continue; }
        const bdId = job.assigned_to_bd;
        // Deferred to send time so the name always matches the mailbox that
        // actually sends (and therefore the signature).
        const vars = buildEmailVars({ job, contact, senderDisplayName: DEFER_SENDER });
        const useRandomFu = isRandomTemplateMode(settings[`u_${bdId}_random_template_mode`]);
        let subjTmpl, bodyTmpl, variantId;
        if (useRandomFu) {
          const pairKey = `${fu.job_id}:${fu.contact_id}`;
          variantId = variantByPair[pairKey] || settings[`u_${bdId}_compose_style_preset`] || 'v1';
          const variant = getVariantById(variantId);
          const fuTmpl = isFu2 ? variant.fu2 : variant.fu1;
          subjTmpl = fuTmpl.subject;
          bodyTmpl = fuTmpl.body;
        } else {
          subjTmpl = isFu2
            ? getBDTemplate(bdId, 'tmpl_fu2_subject', 'template_fu2_subject', DEFAULT_TEMPLATES.fu2_subject)
            : getBDTemplate(bdId, 'tmpl_fu1_subject', 'template_fu1_subject', DEFAULT_TEMPLATES.fu1_subject);
          bodyTmpl = isFu2
            ? getBDTemplate(bdId, 'tmpl_fu2_body', 'template_fu2_body', DEFAULT_TEMPLATES.fu2_body)
            : getBDTemplate(bdId, 'tmpl_fu1_body', 'template_fu1_body', DEFAULT_TEMPLATES.fu1_body);
        }
        const fuRow = {
          contact_id: fu.contact_id,
          job_id: fu.job_id,
          to_email: contact.email,
          from_email: job.sending_email?.email_address || null,
          subject: fillTemplate(subjTmpl, vars),
          body: fillTemplate(bodyTmpl, vars),
          platform: 'Outlook',
          sent_by: bdId,
          status: 'pending',
          followup_type: isFu2 ? 'fu2' : 'fu1',
          follow_up_id: fu.id
        };
        if (variantId) fuRow.template_variant = variantId;
        emailsToInsert.push(fuRow);
        liveOutreachPairs.add(dupKey); // prevent a second same-run follow-up to this contact
        if (isFu2) { fu2Updates.push(fu.id); log.fu2_queued++; } else { fu1Updates.push(fu.id); log.fu1_queued++; }
        acCountDelta[acId] = (acCountDelta[acId] || 0) + 1;
      }
    }

    if (emailsToInsert.length) {
      await supabase.from('emails').insert(emailsToInsert);
      const fuBdIds = [...new Set(emailsToInsert.map(e => e.sent_by).filter(Boolean))];
      emit(EVENTS.FOLLOWUP_QUEUED, { bdIds: fuBdIds });
    }
    const nowTs = new Date().toISOString();
    if (fu1Updates.length) await supabase.from('follow_ups').update({ followup1_sent_at: nowTs }).in('id', fu1Updates);
    if (fu2Updates.length) { await supabase.from('follow_ups').update({ followup2_sent_at: nowTs, status: 'completed' }).in('id', fu2Updates); }
    // Quota is charged on actual delivery (processPendingEmailSends), not at queue time.
    // Pre-charging the day's quota here marked it "used" before anything sent, which made the
    // auto-sender defer every just-queued follow-up on phantom quota — so they never left.
    console.log(`[FollowupEngine] FU1: ${log.fu1_queued}, FU2: ${log.fu2_queued}, skipped_quota: ${log.skipped_quota}, skipped_stage: ${log.skipped_stage}, skipped_contact_status: ${log.skipped_contact_status}, skipped_duplicate: ${log.skipped_duplicate}`);
    return log;
  } catch (err) { console.error('[FollowupEngine] Error:', err.message); return { ...log, error: err.message }; }
}

// ══════════════════════════════════════════════════════════════
// LEAD RECYCLING — 'Assigned' leads with no reply for too long, returned to
// Unassigned for redistribution instead of sitting there forever. See
// services/lead-recycle.js for the (pure, tested) decision logic; this is
// just the I/O wrapper, mirroring runFollowupEngine's shape.
// ══════════════════════════════════════════════════════════════
async function runLeadRecycleSweep() {
  const log = { checked: 0, recycled: 0 };
  try {
    const { data: settingRow } = await supabase.from('app_settings').select('value').eq('key', 'lead_recycle_days').maybeSingle();
    const thresholdDays = parseInt(settingRow?.value || '30', 10) || 30;
    const cutoffIso = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: candidates, error } = await supabase.from('jobs')
      .select('id,stage,assigned_at,recycled_count,contacts(replied_at)')
      .eq('stage', 'Assigned').is('deleted_at', null).lte('assigned_at', cutoffIso);
    if (error) throw error;
    log.checked = (candidates || []).length;

    const now = Date.now();
    for (const job of (candidates || [])) {
      if (!isRecyclable(job, job.contacts, now, thresholdDays)) continue;
      const nowTs = new Date();
      await supabase.from('jobs').update({
        stage: 'Unassigned', assigned_to_bd: null, assigned_at: null, sending_email_id: null,
        freshness: 'Old', recycled_count: (job.recycled_count || 0) + 1, last_recycled_at: nowTs, updated_at: nowTs,
      }).eq('id', job.id);
      await supabase.from('follow_ups').update({ status: 'expired' }).eq('job_id', job.id).eq('status', 'active');
      await logActivity(job.id, null, null, 'lead_recycled', `Recycled to Unassigned pool after ${thresholdDays} days with no reply`);
      log.recycled++;
    }
    console.log(`[LeadRecycle] Checked: ${log.checked}, recycled: ${log.recycled} (threshold ${thresholdDays}d)`);
    return log;
  } catch (err) { console.error('[LeadRecycle] Error:', err.message); return { ...log, error: err.message }; }
}

app.post('/leads/recycle/run', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'ra_lead')) return res.status(403).json({ error: 'Admin only' });
    const result = await runLeadRecycleSweep();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function toIST(date) { const utc = date.getTime() + date.getTimezoneOffset() * 60000; return new Date(utc + 5.5 * 3600000); }

async function getLastFollowupRun() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'last_followup_run').single();
    return data?.value || null;
  } catch { return null; }
}
async function setLastFollowupRun(dateStr) {
  try {
    await supabase.from('app_settings').upsert({ key: 'last_followup_run', value: dateStr }, { onConflict: 'key' });
  } catch (e) { console.error('[Cron] Failed to persist last_followup_run:', e.message); }
}

// (The old run-follow-ups-on-startup block lived here. It existed to paper over
// the process sleeping through the one minute the wall-clock check tested for,
// but it fired the day's follow-ups immediately on boot at ANY hour — a redeploy
// at 2am sent them at 2am, ignoring the configured send time. The registered
// `followup` job below replaces it: the boot tick still catches a missed day,
// but only once the configured send time has actually passed.)

// The daily follow-up run. Registered as a job rather than a bare interval so
// an external ping can drive it too.
//
// Note the guard changed from "the clock reads exactly the send time" to "the
// clock is at or past the send time and we haven't run today". The old form
// only fired if the process happened to be awake during that one minute — on
// Render's free tier, a sleeping service missed the whole day's follow-ups and
// nothing said so. At-or-past is self-healing: whenever the service next wakes,
// the day's run still happens.
engineRunner.register('followup', {
  everyMs: 5 * 60 * 1000,
  quiet: true,               // polled often, fires once a day — don't log the no-ops
  description: 'Queue fu1/fu2 follow-up emails (once daily, at the configured IST time)',
  run: async () => {
    const now = toIST(new Date());
    const dateStr = now.toISOString().split('T')[0];
    const { data: settingsRows } = await supabase.from('app_settings').select('key,value')
      .in('key', ['last_followup_run', 'followup_send_time']);
    const settings = {};
    (settingsRows || []).forEach(r => { settings[r.key] = r.value; });

    if (settings['last_followup_run'] === dateStr) return { skipped: 'already_ran_today' };

    const [sendH, sendM] = String(settings['followup_send_time'] || '08:30').split(':').map(Number);
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    if (minutesNow < ((sendH || 0) * 60 + (sendM || 0))) return { skipped: 'before_send_time' };

    // Claim the day before doing the work, so a concurrent tick can't double-send.
    await setLastFollowupRun(dateStr);
    console.log(`[Cron] Follow-up engine triggered (IST ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')})`);
    return await runFollowupEngine();
  }
});

// ══════════════════════════════════════════════════════════════
// BOUNCE / NDR FEEDBACK LOOP
// Reads non-delivery reports from each connected Microsoft mailbox and marks
// the matching contact email_status='invalid', so addresses that actually
// bounce stop getting mailed (and their follow-ups are cancelled). This is the
// mailbox-level counterpart to the domain-level MX check done at entry.
// ══════════════════════════════════════════════════════════════
function isNdrMessage(msg) {
  const from = (msg.from?.emailAddress?.address || '').toLowerCase();
  const fromName = (msg.from?.emailAddress?.name || '').toLowerCase();
  const subj = (msg.subject || '').toLowerCase();
  // Bounces always come from a mail-delivery daemon; match those senders across
  // providers (Exchange postmaster / MicrosoftExchange…, Gmail mailer-daemon +
  // "Mail Delivery Subsystem", generic postmaster).
  const senderNdr = from.includes('postmaster') || from.includes('mailer-daemon')
    || from.includes('mail-daemon') || from.includes('microsoftexchange')
    || fromName.includes('mail delivery');
  // Unambiguous NDR subject phrases (a backup for when sender parsing misses).
  const subjectNdr = /undeliverable|delivery (has )?failed|delivery status notification|returned mail|delivery failure|failure notice|mail delivery failed|undelivered mail|message not delivered|couldn'?t be delivered|could not be delivered|delivery incomplete/i.test(subj);
  return senderNdr || subjectNdr;
}

// Warm-up pool traffic carries an X-Fute-Warmup header; the outreach reply and
// bounce sweeps must never treat it as a prospect reply or a bounce.
function isWarmupMessage(msg) {
  return (msg.internetMessageHeaders || []).some(h => (h.name || '').toLowerCase() === WARMUP_HEADER.toLowerCase());
}

// Pull every email address out of NDR text, dropping our own mailboxes and the
// postmaster/daemon senders — what remains is the failed recipient(s).
function extractBounceRecipients(text, ownAddresses) {
  if (!text) return [];
  const out = new Set();
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const addr = m[0].toLowerCase();
    if (ownAddresses.has(addr)) continue;
    if (addr.startsWith('postmaster@') || addr.startsWith('mailer-daemon@')) continue;
    out.add(addr);
  }
  return [...out];
}

// If a mailbox's bounces-today / sent-today exceeds the threshold (with a
// minimum sample), auto-pause it to protect domain reputation. Counts live in
// app_settings so this needs no schema change; the pause uses
// user_emails.auto_paused_at (a no-op until migration 006 is applied).
// Threshold + min-sample are admin-editable — config/settings.js.
async function maybeAutoPauseMailboxOnBounces(userEmailId, newBounces) {
  if (!userEmailId || !newBounces) return;
  const bkey = `bounce_count_${userEmailId}_${today()}`;
  const { data: bRow } = await supabase.from('app_settings').select('value').eq('key', bkey).maybeSingle();
  const bouncesToday = (parseInt(bRow?.value, 10) || 0) + newBounces;
  await supabase.from('app_settings').upsert({ key: bkey, value: String(bouncesToday), updated_at: new Date() }, { onConflict: 'key' });
  const { data: sRow } = await supabase.from('email_send_log').select('emails_sent').eq('user_email_id', userEmailId).eq('send_date', today()).maybeSingle();
  const sentToday = sRow?.emails_sent || 0;
  const [thresholdPct, minSample] = await Promise.all([
    settingsConfig.getSetting(supabase, 'bounce_rate_threshold_pct'),
    settingsConfig.getSetting(supabase, 'bounce_min_sample'),
  ]);
  if (sentToday >= minSample && bouncesToday / sentToday > thresholdPct / 100) {
    await setMailboxAutoPaused(userEmailId, true, `bounce rate ${(bouncesToday / sentToday * 100).toFixed(1)}% (${bouncesToday}/${sentToday} today)`);
  }
}

async function sweepMailboxBounces(tokenRow, ownAddresses) {
  let accessToken;
  try { accessToken = await getMicrosoftToken(tokenRow.user_email_id); }
  catch (e) { console.error(`[BounceSweep] token for ${tokenRow.email_address}: ${e.message}`); return 0; }

  const sinceKey = `bounce_sweep_since_${tokenRow.user_email_id}`;
  const { data: sinceRow } = await supabase.from('app_settings').select('value').eq('key', sinceKey).maybeSingle();
  const since = sinceRow?.value || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const filter = encodeURIComponent(`receivedDateTime ge ${since}`);

  let marked = 0, newest = since;
  // NDRs normally land in Inbox, but aggressive spam filtering can drop them in
  // Junk — scan both so a bounce isn't missed just because it was filtered.
  for (const folder of ['Inbox', 'JunkEmail']) {
    const path = `/me/mailFolders/${folder}/messages?$top=50&$orderby=receivedDateTime desc`
      + `&$select=id,subject,from,bodyPreview,body,receivedDateTime,internetMessageHeaders&$filter=${filter}`;
    let data;
    try { data = await graphMailRequest(accessToken, path); }
    catch (e) { console.error(`[BounceSweep] ${folder} list for ${tokenRow.email_address}: ${e.message}`); continue; }
    for (const msg of (data.value || [])) {
      if (msg.receivedDateTime && msg.receivedDateTime > newest) newest = msg.receivedDateTime;
      if (isWarmupMessage(msg)) continue; // warm-up pool traffic — never a bounce
      if (!isNdrMessage(msg)) continue;
      const text = `${msg.body?.content || ''} ${msg.bodyPreview || ''}`;
      for (const addr of extractBounceRecipients(text, ownAddresses)) {
        const { data: matches } = await supabase.from('contacts')
          .select('id,email_status,job_id').ilike('email', addr).limit(10);
        for (const c of (matches || [])) {
          if (c.email_status === 'invalid' || c.email_status === 'deactivated') continue;
          await supabase.from('contacts').update({ email_status: 'invalid', updated_at: new Date() }).eq('id', c.id);
          emit(EVENTS.EMAIL_BOUNCED, { contactId: c.id, jobId: c.job_id, address: addr, mailbox: tokenRow.email_address });
          emit(EVENTS.CONTACT_INVALIDATED, { contactId: c.id, jobId: c.job_id, reason: 'bounce' });
          await logActivity(c.job_id, c.id, null, 'email_bounced',
            `Auto-marked invalid — bounce/NDR received for ${addr}`, null,
            { source: 'ndr', mailbox: tokenRow.email_address, folder });
          marked++;
        }
      }
    }
  }
  await supabase.from('app_settings').upsert({ key: sinceKey, value: newest, updated_at: new Date() }, { onConflict: 'key' });

  // Auto-pause this mailbox if its recent bounce rate is too high.
  try { await maybeAutoPauseMailboxOnBounces(tokenRow.user_email_id, marked); } catch (_) {}

  return marked;
}

async function runBounceSweep() {
  try {
    const { data: tokens } = await supabase.from('microsoft_tokens').select('user_email_id,email_address');
    if (!tokens || !tokens.length) return 0;
    const { data: ue } = await supabase.from('user_emails').select('email_address');
    const ownAddresses = new Set((ue || []).map(u => (u.email_address || '').toLowerCase()).filter(Boolean));
    tokens.forEach(t => { if (t.email_address) ownAddresses.add(t.email_address.toLowerCase()); });
    let total = 0;
    for (const t of tokens) {
      try { total += await sweepMailboxBounces(t, ownAddresses); }
      catch (e) { console.error(`[BounceSweep] ${t.email_address}: ${e.message}`); }
    }
    if (total) console.log(`[BounceSweep] marked ${total} contact(s) invalid from NDRs`);
    return total;
  } catch (e) { console.error('[BounceSweep] error:', e.message); return 0; }
}

// ══════════════════════════════════════════════════════════════
// REPLY DETECTION
// A genuine inbound reply from a prospect STOPS the sequence (the biggest
// reply-rate leak in cold outreach is following up on people who already
// replied). Reuses the same Graph inbox machinery as the bounce sweep.
// Best-effort: if the reply columns aren't present yet the contact select
// returns nothing, so this safely no-ops until migration 006 is applied.
// ══════════════════════════════════════════════════════════════
async function sweepMailboxReplies(tokenRow, ownAddresses) {
  let accessToken;
  try { accessToken = await getMicrosoftToken(tokenRow.user_email_id); }
  catch (e) { console.error(`[ReplySweep] token for ${tokenRow.email_address}: ${e.message}`); return 0; }

  const sinceKey = `reply_sweep_since_${tokenRow.user_email_id}`;
  const { data: sinceRow } = await supabase.from('app_settings').select('value').eq('key', sinceKey).maybeSingle();
  const since = sinceRow?.value || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
  const path = `/me/mailFolders/Inbox/messages?$top=50&$orderby=receivedDateTime desc`
    + `&$select=id,subject,from,bodyPreview,body,receivedDateTime,internetMessageHeaders&$filter=${filter}`;
  let data;
  try { data = await graphMailRequest(accessToken, path); }
  catch (e) { console.error(`[ReplySweep] list for ${tokenRow.email_address}: ${e.message}`); return 0; }

  const messages = data.value || [];
  const { detected, newest } = await processInboundMessages(messages, ownAddresses, tokenRow, since);
  await supabase.from('app_settings').upsert({ key: sinceKey, value: newest, updated_at: new Date() }, { onConflict: 'key' });
  return detected;
}

// Persist one message of a conversation, quote-stripped and trimmed.
//
// Best-effort by design, and guarded twice over:
//   * migration 037 may not be applied yet — a missing table must not break the
//     reply sweep, which is doing load-bearing work (stopping sequences);
//   * the sweep deliberately re-reads an overlapping window, so the SAME message
//     is offered repeatedly. The unique index on (provider, message_key) makes
//     that a no-op, and a conflict here is success, not an error.
//
// If the table is missing we stop trying for the rest of the process rather than
// throwing a caught error per message per sweep.
let _convStoreDisabled = false;
async function storeConversationMessage(msg, { direction, from, tokenRow, contactId, candidateId, jobId }) {
  if (_convStoreDisabled) return;
  try {
    const raw = msg.body?.content || msg.bodyPreview || '';
    const body = conversationIntel.cleanForStorage(raw);
    const intent = conversationIntel.classifyIntent(body);
    const { error } = await supabase.from('conversation_messages').insert({
      contact_id: contactId || null,
      candidate_id: candidateId || null,
      job_id: jobId || null,
      provider: msg._provider === 'gmail' ? 'gmail' : 'microsoft',
      thread_key: msg.conversationId || msg.threadId || null,
      message_key: msg.id || null,
      direction,
      from_email: from || null,
      to_email: tokenRow?.email_address || null,
      subject: (msg.subject || '').slice(0, 500),
      body,
      sent_at: msg.receivedDateTime || new Date().toISOString(),
      intent: intent ? intent.id : null,
      has_question: conversationIntel.hasQuestion(body),
    });
    if (error) {
      // 23505 = unique violation = we already have this message. Expected.
      if (error.code === '23505') return;
      if (/relation .*conversation_messages.* does not exist/i.test(error.message || '')) {
        console.warn('[conversation] migration 037 not applied yet — not storing message bodies');
        _convStoreDisabled = true;
        return;
      }
      throw error;
    }
  } catch (err) {
    if (/does not exist/i.test(String(err.message || ''))) { _convStoreDisabled = true; return; }
    console.error('[conversation] store failed:', err.message);
  }
}

// The reply-handling brain, shared by the Microsoft and Gmail sweeps. Gmail
// messages are reshaped into Graph's shape by gmailProvider.normalizeMessage,
// so exactly one set of matching rules runs over both providers — the
// alternative is two copies that drift, which is how the stage vocabulary ended
// up hand-synced across six files.
async function processInboundMessages(messages, ownAddresses, tokenRow, since) {
  let detected = 0, newest = since;
  for (const msg of messages) {
    if (msg.receivedDateTime && msg.receivedDateTime > newest) newest = msg.receivedDateTime;
    if (isWarmupMessage(msg)) continue; // warm-up pool traffic — never a prospect reply
    if (isNdrMessage(msg)) continue; // bounces are the bounce sweep's job
    const from = (msg.from?.emailAddress?.address || '').toLowerCase();
    if (!from || ownAddresses.has(from)) continue; // ignore internal / our own mail
    const { data: matches } = await supabase.from('contacts')
      .select('id,job_id,replied_at,email').ilike('email', from).limit(10);

    // Candidate-side match, looked up here (not just further down) so the one
    // conversation_messages row for this physical email can carry both a
    // contact_id and a candidate_id: the table is keyed one row per
    // (provider, message_key), not one row per matched entity, so a second
    // insert below for the same message would just silently lose to that
    // unique index instead of actually recording the candidate side.
    let candTrk = [];
    try {
      const { data } = await supabase.from('email_tracking')
        .select('id,candidate_id,job_order_id').ilike('to_email', from).is('replied_at', null).limit(20);
      candTrk = data || [];
    } catch (_) { /* best-effort */ }

    // Keep the actual message (Step 4). Before this, the only trace of an
    // inbound reply was contacts.reply_snippet — 280 characters of the FIRST
    // reply and nothing else, which is not enough to say who owes whom a reply.
    // Stored regardless of whether the address matches anyone, since an
    // unmatched reply is still part of the conversation.
    await storeConversationMessage(msg, {
      direction: 'inbound', from, tokenRow,
      contactId: matches?.[0]?.id || null,
      candidateId: candTrk?.[0]?.candidate_id || null,
      jobId: matches?.[0]?.job_id || candTrk?.[0]?.job_order_id || null,
    });

    for (const c of (matches || [])) {
      if (c.replied_at) continue; // already recorded
      const snippet = (msg.bodyPreview || '').slice(0, 280);
      try { await supabase.from('contacts').update({ replied_at: new Date(), reply_snippet: snippet }).eq('id', c.id); } catch (_) {}
      // Stop the sequence: move the lead off "Assigned" and cancel active follow-ups.
      try { await supabase.from('jobs').update({ stage: 'Connected' }).eq('id', c.job_id).eq('stage', 'Assigned'); } catch (_) {}
      await skipActiveFollowUpsForContact(c.id);
      await logActivity(c.job_id, c.id, null, 'reply_received', `Reply received from ${from} — follow-ups stopped`, null, { source: 'inbox', mailbox: tokenRow.email_address });
      emit(EVENTS.CONTACT_REPLIED, { contactId: c.id, jobId: c.job_id, from, mailbox: tokenRow.email_address });
      if (isOptOutReply(snippet) || isOptOutReply(msg.body?.content || '')) {
        await addToSuppression(from, 'unsubscribe', 'reply', null);
        emit(EVENTS.CONTACT_UNSUBSCRIBED, { contactId: c.id, jobId: c.job_id, email: from });
      }
      detected++;
    }
    // Candidate email tracking: a reply from this address answers any tracked
    // candidate/interview email we sent it — mark those rows replied. Reuses the
    // candTrk lookup from above (no extra query, no extra Graph calls).
    // Best-effort; never breaks the sweep.
    try {
      // isOptOutReply takes TEXT, not a message — check the same two fields the
      // contact path checks, since the preview alone often truncates before the
      // "unsubscribe" line.
      const replyText = (msg.bodyPreview || '').slice(0, 280);
      const optedOut = isOptOutReply(replyText) || isOptOutReply(msg.body?.content || '');
      const candidateIds = new Set();
      for (const r of candTrk) {
        await supabase.from('email_tracking').update({ replied_at: msg.receivedDateTime || new Date() }).eq('id', r.id);
        if (r.candidate_id) candidateIds.add(r.candidate_id);
        detected++;
      }
      // A candidate who answers must stop receiving the rest of their sequence.
      // Previously this loop stamped replied_at and emitted nothing, so nurture
      // sequences kept mailing people who had already written back — the single
      // most damaging thing an automated recruiting sequence can do.
      for (const candidateId of candidateIds) {
        try {
          await supabase.from('candidates')
            .update({ last_reply_at: msg.receivedDateTime || new Date() }).eq('id', candidateId);
        } catch (_) { /* the column arrives with migration 036 */ }
        emit(EVENTS.CANDIDATE_REPLIED, { candidateId, from, at: msg.receivedDateTime || new Date() });
        if (optedOut) {
          await addToSuppression(from, 'unsubscribe', 'candidate_reply');
          emit(EVENTS.CANDIDATE_UNSUBSCRIBED, { candidateId, from });
        }
      }
    } catch (_) { /* best-effort */ }
  }
  return { detected, newest };
}

// Gmail counterpart of sweepMailboxReplies. Until this existed, a Gmail-only
// mailbox got NO reply detection at all — gmail-provider's listMessages and
// getMessage were written and nothing ever called them. The consequence was the
// worst kind: a nurture sequence sent from a Gmail mailbox kept emailing people
// who had already written back, because nothing could see the reply.
async function sweepGmailReplies(tokenRow, ownAddresses) {
  if (!gmailProvider.isConfigured()) return 0;

  const sinceKey = `reply_sweep_since_${tokenRow.user_email_id}`;
  const { data: sinceRow } = await supabase.from('app_settings').select('value').eq('key', sinceKey).maybeSingle();
  const since = sinceRow?.value || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  // Gmail's search takes whole days, so this over-fetches slightly rather than
  // risking a miss at the boundary; the `since` comparison below is exact and
  // per-message dedup is handled by replied_at/last_reply_at already being set.
  const afterDay = new Date(Math.max(0, Date.parse(since) - 24 * 3600 * 1000))
    .toISOString().slice(0, 10).replace(/-/g, '/');
  let heads;
  try {
    heads = await gmailProvider.listMessages(tokenRow.user_email_id, {
      labelIds: ['INBOX'], q: `after:${afterDay}`, maxResults: 50,
    });
  } catch (e) { console.error(`[ReplySweep/gmail] list for ${tokenRow.email_address}: ${e.message}`); return 0; }

  const messages = [];
  for (const h of (heads || [])) {
    try {
      const raw = await gmailProvider.getMessage(tokenRow.user_email_id, h.id, { format: 'full' });
      const norm = gmailProvider.normalizeMessage(raw);
      // Re-apply the exact `since` bound the day-granular query could not.
      if (norm && (!since || norm.receivedDateTime > since)) messages.push(norm);
    } catch (_) { /* one unreadable message must not end the sweep */ }
  }

  const { detected, newest } = await processInboundMessages(messages, ownAddresses, tokenRow, since);
  await supabase.from('app_settings').upsert({ key: sinceKey, value: newest, updated_at: new Date() }, { onConflict: 'key' });
  return detected;
}

async function runReplySweep() {
  try {
    const { data: msTokens } = await supabase.from('microsoft_tokens').select('user_email_id,email_address');
    const { data: gmTokens } = await supabase.from('gmail_tokens').select('user_email_id,email_address');
    const ms = msTokens || [], gm = gmTokens || [];
    if (!ms.length && !gm.length) return 0;

    const { data: ue } = await supabase.from('user_emails').select('email_address');
    const ownAddresses = new Set((ue || []).map(u => (u.email_address || '').toLowerCase()).filter(Boolean));
    [...ms, ...gm].forEach(t => { if (t.email_address) ownAddresses.add(t.email_address.toLowerCase()); });

    let total = 0;
    for (const t of ms) {
      try { total += await sweepMailboxReplies(t, ownAddresses); }
      catch (e) { console.error(`[ReplySweep] ${t.email_address}: ${e.message}`); }
    }
    for (const t of gm) {
      try { total += await sweepGmailReplies(t, ownAddresses); }
      catch (e) { console.error(`[ReplySweep/gmail] ${t.email_address}: ${e.message}`); }
    }
    if (total) console.log(`[ReplySweep] detected ${total} repl(ies) — sequences stopped`);
    return total;
  } catch (e) { console.error('[ReplySweep] error:', e.message); return 0; }
}

// Manual trigger (admin) — useful for verifying the loop without waiting for cron.
app.post('/admin/bounce-sweep', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead')) return res.status(403).json({ error: 'Admin only' });
    const marked = await runBounceSweep();
    res.json({ success: true, marked });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual reply-sweep trigger (admin).
app.post('/admin/reply-sweep', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead')) return res.status(403).json({ error: 'Admin only' });
    const detected = await runReplySweep();
    res.json({ success: true, detected });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Suppression list, spam pre-check, template reply-rate analytics, and the
// deliverability health overview → extracted to routes/deliverability.js
// (mounted below). The sending-control routes below stay inline for now.

// Clear a mailbox's auto-pause (admin/lead).
app.post('/admin/mailbox/:id/resume', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead')) return res.status(403).json({ error: 'Forbidden' });
    await setMailboxAutoPaused(req.params.id, false, 'manual resume');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Emergency stop ── global pause/resume for ALL outbound sending. The pause
// halts any in-progress run before the next email (already-sent mail can't be
// recalled) and blocks new runs from starting; not-yet-sent emails stay pending
// and resume on the next trigger once unpaused.
app.get('/admin/sending/status', auth, (req, res) => {
  if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
  res.json({ paused: isSendingPaused(), pausedManagers: [...pausedManagers] });
});
// Any user can check whether THEIR OWN sending is paused (global or per-manager) —
// used to show a paused banner on the BD's own Email page.
app.get('/sending/my-status', auth, (req, res) => {
  const global = isSendingPaused();
  const mine = isManagerPaused(req.user.id);
  res.json({ paused: global || mine, global, manager: mine });
});
// Pass `manager_id` to pause/resume one BD manager's sending; omit it for the
// global switch. Per-manager control is available to admins and leads.
app.post('/admin/sending/pause', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const managerId = req.body && req.body.manager_id;
    if (managerId) {
      await setManagerPaused(managerId, true, req.user.id);
      console.log(`[EmergencyStop] Manager ${managerId} PAUSED by user ${req.user.id}`);
      return res.json({ paused: true, manager_id: managerId });
    }
    await setSendingPaused(true, req.user.id);
    console.log(`[EmergencyStop] GLOBAL PAUSED by user ${req.user.id}`);
    res.json({ paused: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/admin/sending/resume', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd_lead', 'ra_lead')) return res.status(403).json({ error: 'Forbidden' });
    const managerId = req.body && req.body.manager_id;
    if (managerId) {
      await setManagerPaused(managerId, false, req.user.id);
      console.log(`[EmergencyStop] Manager ${managerId} RESUMED by user ${req.user.id}`);
      return res.json({ paused: false, manager_id: managerId });
    }
    await setSendingPaused(false, req.user.id);
    console.log(`[EmergencyStop] GLOBAL RESUMED by user ${req.user.id}`);
    res.json({ paused: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// The mailbox sweeps and the deferred-send retry. Cadences are unchanged; what
// changed is that due-ness is persisted, so these keep their schedule across a
// sleep/restart instead of resetting their timers every time the process boots.
engineRunner.register('bounce_sweep', {
  everyMs: 30 * 60 * 1000,
  description: 'Read NDRs from connected mailboxes and mark bounced addresses invalid',
  run: () => runBounceSweep()
});

engineRunner.register('reply_sweep', {
  everyMs: 30 * 60 * 1000,
  description: 'Detect prospect replies and opt-outs, and stop their sequences',
  run: () => runReplySweep()
});

engineRunner.register('lead_recycle', {
  everyMs: 24 * 60 * 60 * 1000,
  description: 'Return Assigned leads with no reply after the configured threshold (default 30 days) to Unassigned for redistribution',
  run: () => runLeadRecycleSweep()
});

engineRunner.register('pending_retry', {
  everyMs: 20 * 60 * 1000,
  description: 'Retry pending emails whose lead has entered its local send window',
  run: () => retryDeferredPendingSends()
});

// Restore the emergency-stop state on boot so a pause survives a redeploy.
loadSendingPaused();
loadPausedManagers();

// ══════════════════════════════════════════════════════════════
// MICROSOFT OAUTH
// ══════════════════════════════════════════════════════════════
// Sourced from config/env.js. MS_REDIRECT now reads MICROSOFT_REDIRECT_URI from
// the environment, falling back to the previously hardcoded value so behaviour
// is unchanged until that env var is set.
const MS_TENANT   = config.microsoft.tenantId;
const MS_CLIENT   = config.microsoft.clientId;
const MS_SECRET   = config.microsoft.clientSecret;
const MS_REDIRECT = config.microsoft.redirectUri;
const MS_SCOPES   = config.microsoft.scopes;

// Gmail / Google Workspace provider — inert until GOOGLE_CLIENT_ID/SECRET are
// set (see config/env.js). Microsoft path is unaffected.
const gmailProvider = createGmailProvider({ supabase, google: config.google });



// Random delay between emails to avoid domain flagging (1–120 seconds)
// Recipient validity (emailSyntaxValid) and domain extraction (emailDomain) are
// shared from ./email-validation — single source of truth for both.
const BLOCKED_FOLLOWUP_STATUSES = new Set(['invalid', 'deactivated', 'out_of_office']);

function contactEmailStatus(contact) {
  return String(contact?.email_status || 'valid').toLowerCase();
}

function isFollowupEligibleContact(contact) {
  if (!contact || !emailSyntaxValid(contact.email)) return false;
  return !BLOCKED_FOLLOWUP_STATUSES.has(contactEmailStatus(contact));
}

function isPermanentFollowupBlock(status) {
  const s = String(status || '').toLowerCase();
  return s === 'invalid' || s === 'deactivated';
}

// Outreach-class email types (the initial outreach is intentionally excluded).
// Used by the double-send guard below.
const FOLLOWUP_EMAIL_TYPES = ['fu1', 'fu2', 'reminder'];

// A follow-up/reminder email row is "live" if it is still queued (pending) or
// was already delivered today — either way, sending another one now would be a
// same-day duplicate to that contact.
function isLiveOutreachRow(r) {
  return !!r && (r.status === 'pending' || (r.sent_at && String(r.sent_at).slice(0, 10) === today()));
}

// True if a reminder or follow-up to this contact (optionally scoped to a job)
// is already queued or was sent today — used to prevent the scheduled follow-up
// engine and a manual reminder from both emailing the same contact in one day.
async function hasLiveOutreachEmail(jobId, contactId) {
  if (!contactId) return false;
  let q = supabase.from('emails')
    .select('id,status,sent_at,followup_type')
    .eq('contact_id', contactId)
    .in('followup_type', FOLLOWUP_EMAIL_TYPES);
  if (jobId) q = q.eq('job_id', jobId);
  const { data } = await q;
  return (data || []).some(isLiveOutreachRow);
}

async function skipActiveFollowUpsForContact(contactId) {
  if (!contactId) return;
  await supabase.from('follow_ups').update({ status: 'skipped' }).eq('contact_id', contactId).eq('status', 'active');
}

async function cancelBlockedFollowupSend(email, contactStatus) {
  if (!email?.id) return;
  try { await supabase.from('emails').delete().eq('id', email.id); } catch (_) {}
  if (!email.follow_up_id) return;
  const status = String(contactStatus || '').toLowerCase();
  if (email.followup_type === 'fu1') {
    await supabase.from('follow_ups').update({ followup1_sent_at: null }).eq('id', email.follow_up_id);
  } else if (email.followup_type === 'fu2') {
    await supabase.from('follow_ups').update({ followup2_sent_at: null, status: 'active' }).eq('id', email.follow_up_id);
  }
  if (isPermanentFollowupBlock(status)) {
    await supabase.from('follow_ups').update({ status: 'skipped' }).eq('id', email.follow_up_id);
  }
}

function randomDelay(minSec = 1, maxSec = 120) {
  const ms = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send progress tracking — stored in app_settings keyed per user
// In-memory mirror of send progress, keyed by user id. The DB row stays the
// source of truth across restarts; the mirror exists so the high-frequency
// GET /emails/send-progress poll never touches the DB. undefined = not yet
// loaded (cold after restart), null = known-empty.
const sendProgressCache = new Map();
async function setSendProgress(userId, data) {
  const key = `send_progress_${userId}`;
  sendProgressCache.set(userId, data);
  try { await supabase.from('app_settings').upsert({ key, value: JSON.stringify(data) }, { onConflict: 'key' }); } catch(_) {}
}
async function clearSendProgress(userId) {
  const key = `send_progress_${userId}`;
  sendProgressCache.set(userId, null);
  try { await supabase.from('app_settings').delete().eq('key', key); } catch(_) {}
}

async function getMicrosoftToken(userEmailId) {
  const { data: tokenRow, error } = await supabase.from('microsoft_tokens').select('*').eq('user_email_id', userEmailId).single();
  if (error || !tokenRow) throw new Error('No Microsoft token found. Please reconnect.');
  const now = new Date();
  if (new Date(tokenRow.expires_at).getTime() - now.getTime() > 5 * 60 * 1000) return tokenRow.access_token;
  // retryUnsafe: a token refresh is idempotent — replaying it costs nothing and
  // a transient failure here takes the whole mailbox offline until the next sweep.
  const refreshRes = await fetchWithRetry(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: MS_CLIENT, client_secret: MS_SECRET, refresh_token: tokenRow.refresh_token, grant_type: 'refresh_token', scope: MS_SCOPES }) }, { timeoutMs: OAUTH_TIMEOUT_MS, retryUnsafe: true, retries: 2 });
  const refreshed = await refreshRes.json();
  if (refreshed.error) {
    // Capture the EXACT Microsoft error (e.g. AADSTS7000215 invalid client
    // secret vs AADSTS700082/50173 revoked refresh token) so a mailbox-wide
    // outage is diagnosable at a glance instead of a silent, generic failure.
    const detail = [refreshed.error, refreshed.error_description].filter(Boolean).join(': ');
    console.error(`[ms-token] refresh failed for ${tokenRow.email_address || userEmailId}: ${detail}`);
    await recordRefreshOutcome(supabase, 'microsoft_tokens', userEmailId, false, detail);
    throw new Error('Token refresh failed: ' + (refreshed.error_description || refreshed.error));
  }
  await supabase.from('microsoft_tokens').update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || tokenRow.refresh_token, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), updated_at: new Date() }).eq('user_email_id', userEmailId);
  await recordRefreshOutcome(supabase, 'microsoft_tokens', userEmailId, true, null);
  return refreshed.access_token;
}

// Build an HTML email body from plain text + optional HTML signature.
// Plain text is escaped and wrapped in <p> tags with <br> for line breaks.
// The signature (already HTML) is appended after a ruled separator.
// CAN-SPAM compliance footer: a clear opt-out on every message we originate.
// Giving recipients an easy "no thanks" route diverts them from the spam button —
// spam complaints are the single most damaging sender-reputation signal.
// (The required physical postal address lives in the signature — see
// ensureSignatureAddress in email-signature.js — so it is not repeated here.)
const COMPLIANCE_FOOTER_HTML =
  '<div style="margin-top:20px;font-size:11px;line-height:1.5;color:#94A3B8;font-family:Arial,sans-serif">'
  + 'If you\'d prefer not to hear from me, just reply "unsubscribe" and I\'ll remove you from my list.'
  + '</div>';

function buildHtmlEmailBody(plainText, signatureHtml, includeFooter = true) {
  const escaped = (plainText || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const htmlBody = '<p>' + escaped.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  const sig = signatureHtml && signatureHtml.trim()
    ? '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">' + signatureHtml
    : '';
  const footer = includeFooter ? COMPLIANCE_FOOTER_HTML : '';
  return '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0F172A">' + htmlBody + sig + footer + '</div>';
}






// Event timeline (read-only domain-event stream) → extracted to routes/events.js (mounted below).

// ── BD MANAGER / RECRUITER WORKFLOW (branch: bd-manager-recruiter-workflow) ──
// Additive module — registers new routes only; nothing above is modified.
// ── Modularized route groups (extracted from index.js) ──────────────────────
// Shared helpers/middleware stay defined above; routers receive them via ctx so
// their closures and behaviour are identical to the original inline routes.
const routeCtx = {
  supabase, db, auth, hasRole, today, orgIdFor, withOrg, orgStamp,
  loadMailboxSignatures, getMailboxSignature, getMicrosoftToken, buildHtmlEmailBody,
  MS_TENANT, MS_CLIENT, MS_SECRET, MS_REDIRECT, MS_SCOPES,
  logActivity, INDUSTRIES, normInd,
  canTouchJob, isPermanentFollowupBlock, requireRole,
  addToSuppression, warmupLimit,
  loadAllJobs, JOB_SELECT, getTimezoneFromLocation, persistLearnedSkills,
  getSendWindowHours, isInLeadSendWindow, getMinutesUntilWindowOpens,
  formatWindowOpensLabel, padHour, sendProgressCache,
  pixelLimiter,
  // The in-app mailbox (routes/mailbox.js) reads and writes real mailboxes
  // through the SAME provider calls the outreach engine sends with — there is
  // deliberately no second send path.
  graphMailRequest, gmailProvider, sendMicrosoftNewMessage,
};
app.use(require('./routes/auth')(routeCtx));
app.use(require('./routes/microsoft')(routeCtx));
app.use(require('./routes/gmail')({ supabase, auth, hasRole, provider: gmailProvider }));
app.use(require('./routes/workflows')(routeCtx));
app.use(require('./routes/companies')(routeCtx));
app.use(require('./routes/reminders')(routeCtx));
app.use(require('./routes/contacts')(routeCtx));
app.use(require('./routes/settings')(routeCtx));
app.use(require('./routes/integrations')(routeCtx));
app.use(require('./routes/deliverability')(routeCtx));
app.use(require('./routes/ai')(routeCtx));
app.use(require('./routes/events')(routeCtx));
app.use(require('./routes/jobs')(routeCtx));
app.use(require('./routes/emails')(routeCtx));
app.use(require('./routes/lookups')(routeCtx));
app.use(require('./routes/distribution')(routeCtx));
app.use(require('./routes/tracking')(routeCtx));
app.use(require('./routes/lead-sources')(routeCtx));
app.use(require('./routes/next-actions')(routeCtx));
app.use(require('./routes/mailbox')(routeCtx));
// SSO sign-in. Mounted with gmailProvider + config so it can report which
// providers are actually configured; the callbacks live in the microsoft/gmail
// route modules, which already own each provider's registered redirect URI.
app.use(require('./routes/sso')({ ...routeCtx, gmailProvider, config }));
app.use(require('./routes/org-domains')(routeCtx));
app.use(require('./routes/plans')(routeCtx));

require('./bd_recruiter_routes')(app, { supabase, auth, hasRole, today, orgIdFor });

// ── Event-bus subscribers (the "react" half of the spherical structure) ─────
// Registered after the work functions above exist; emitters elsewhere just
// announce events and these reactions run.
registerSubscribers({
  supabase,
  skipActiveFollowUpsForContact,
  autoSendForManager,
  generateEmailsForJobs,
  setSendProgress,
  clearSendProgress,
});

// ── WORKFLOW ENGINE (migrations/007) ─────────────────────────────────────────
// Declarative cadences: definitions + steps are data, the engine advances
// enrollments, channels below plug the engine into the existing machinery.
// Additive and off by default — nothing enrolls automatically; until a
// POST /wf/enroll happens (and migration 007 is applied) this is inert.
const { createWorkflowEngine } = require('./workflow-engine');
const wfEngine = createWorkflowEngine({ supabase, emit, EVENTS });

// Context loader: a 'contact' enrollment executes with its contact + job.
wfEngine.registerContextLoader('contact', async (enrollment) => {
  const { data: contact } = await supabase.from('contacts').select('*').eq('id', enrollment.entity_id).maybeSingle();
  if (!contact) return null;
  let job = null;
  const jobId = enrollment.job_id || contact.job_id;
  if (jobId) {
    const { data } = await supabase.from('jobs')
      .select('id,position,location,salary_range,research,industry,stage,timezone,assigned_to_bd,company:companies(name,industry,location),sending_email:user_emails!sending_email_id(id,email_address,display_name,is_active,daily_send_limit)')
      .eq('id', jobId).is('deleted_at', null).maybeSingle();
    job = data || null;
  }
  return { contact, job };
});

// email channel — queues through the same pending-emails pipeline as the rest
// of the system, so windows, throttling, threading, and quota charging apply.
wfEngine.registerChannel('email', async ({ step, enrollment, context }) => {
  const { contact, job } = context;
  const cfg = step.config || {};
  if (!job) return { outcome: 'skipped', detail: { reason: 'no_job_context' } };
  if (!contact?.email) return { outcome: 'skipped', detail: { reason: 'no_email' } };
  if (!isFollowupEligibleContact(contact)) return { outcome: 'skipped', detail: { reason: 'contact_status', status: contactEmailStatus(contact) } };
  // Stage guard: a hand-picked lead from any group is a deliberate act, so an
  // enrollment created with any_stage bypasses the "must be Assigned" gate.
  const meta = enrollment.metadata || {};
  const allowAnyStage = cfg.any_stage || meta.any_stage;
  if (!allowAnyStage && job.stage !== 'Assigned') return { outcome: 'skipped', detail: { reason: 'stage', stage: job.stage } };
  const suppressed = await loadSuppressedSet([contact.email]);
  if (suppressed.has(String(contact.email).toLowerCase())) return { outcome: 'skipped', detail: { reason: 'suppressed' } };

  // Rotation: prefer this enrollment's assigned "from" mailbox over the job's
  // default. Falls back to the job mailbox when none was chosen / it's gone.
  let mailbox = job.sending_email;
  if (meta.from_mailbox_id) {
    const { data: mb } = await supabase.from('user_emails')
      .select('id,email_address,display_name,platform,daily_send_limit,is_active').eq('id', meta.from_mailbox_id).maybeSingle();
    if (mb) mailbox = mb;
  }
  if (!mailbox?.id) return { outcome: 'skipped', detail: { reason: 'no_sending_mailbox' } };
  if (mailbox.is_active === false) return { outcome: 'defer', detail: { reason: 'mailbox_inactive' } };
  const delivState = await loadMailboxDelivState([mailbox.id]);
  if (delivState[mailbox.id]?.auto_paused_at) return { outcome: 'defer', detail: { reason: 'mailbox_autopaused' } };
  const { data: sendLog } = await supabase.from('email_send_log').select('emails_sent').eq('send_date', today()).eq('user_email_id', mailbox.id).maybeSingle();
  const base = mailbox.daily_send_limit || 150;
  const [warmupStart, warmupStep] = await Promise.all([
    settingsConfig.getSetting(supabase, 'mailbox_warmup_start'),
    settingsConfig.getSetting(supabase, 'mailbox_warmup_step'),
  ]);
  const wl = warmupLimit(delivState[mailbox.id], warmupStart, warmupStep);
  const cap = wl ? Math.min(base, wl) : base;
  if ((sendLog?.emails_sent || 0) >= cap) return { outcome: 'defer', detail: { reason: 'quota' } };

  // Same-pair double-send guard as the legacy follow-up engine.
  const { data: liveRows } = await supabase.from('emails')
    .select('job_id,contact_id,status,sent_at,followup_type').eq('job_id', job.id).eq('contact_id', contact.id)
    .in('followup_type', FOLLOWUP_EMAIL_TYPES);
  if ((liveRows || []).some(r => isLiveOutreachRow(r))) return { outcome: 'defer', detail: { reason: 'duplicate_guard' } };

  const bdId = job.assigned_to_bd || enrollment.enrolled_by;
  // Deferred like the other queue paths: this row may be pinned to `mailbox`,
  // but the send path is the single place the sender identity is resolved.
  const vars = buildEmailVars({ job, contact, senderDisplayName: DEFER_SENDER });
  const key = cfg.template_key || 'initial';
  let subjTmpl = cfg.subject, bodyTmpl = cfg.body;
  if (!subjTmpl || !bodyTmpl) {
    const { data: settingsRows } = await supabase.from('app_settings').select('key,value')
      .in('key', [`u_${bdId}_tmpl_${key}_subject`, `u_${bdId}_tmpl_${key}_body`, `template_${key}_subject`, `template_${key}_body`]);
    const s = {}; (settingsRows || []).forEach(r => { s[r.key] = r.value; });
    subjTmpl = subjTmpl || resolveTemplate(s[`u_${bdId}_tmpl_${key}_subject`] || s[`template_${key}_subject`] || '', `${key}_subject`) || DEFAULT_TEMPLATES[`${key}_subject`];
    bodyTmpl = bodyTmpl || resolveTemplate(s[`u_${bdId}_tmpl_${key}_body`] || s[`template_${key}_body`] || '', `${key}_body`) || DEFAULT_TEMPLATES[`${key}_body`];
  }
  if (!subjTmpl || !bodyTmpl) return { outcome: 'failed', detail: { error: `No template for key "${key}"` } };

  // fu1/fu2 thread as replies in the send path; anything else goes out fresh.
  const followupType = cfg.thread && (key === 'fu1' || key === 'fu2') ? key : (key === 'initial' ? null : 'reminder');
  const row = {
    contact_id: contact.id, job_id: job.id, to_email: contact.email,
    from_email: mailbox.email_address || null,
    subject: fillTemplate(subjTmpl, vars), body: fillTemplate(bodyTmpl, vars),
    platform: 'Outlook', sent_by: bdId, status: 'pending', followup_type: followupType
  };
  // Pin this send to the rotated mailbox so the live send loop authenticates
  // with it (not the job default). Only set when a mailbox was chosen — leaves
  // existing enrollments byte-identical and independent of migration 008.
  const pinMailbox = meta.from_mailbox_id && mailbox.id === meta.from_mailbox_id;
  if (pinMailbox) row.sending_email_id = mailbox.id;
  let { data: emailRow, error } = await supabase.from('emails').insert(row).select('id').single();
  if (error && pinMailbox && /sending_email_id/.test(error.message || '')) {
    // migration 008 not applied yet — queue without the pin (sends from the
    // job default) rather than failing the step.
    delete row.sending_email_id;
    ({ data: emailRow, error } = await supabase.from('emails').insert(row).select('id').single());
  }
  if (error) return { outcome: 'failed', detail: { error: error.message } };
  if (bdId) emit(EVENTS.FOLLOWUP_QUEUED, { bdIds: [bdId] });
  return { outcome: 'done', detail: { email_id: emailRow.id, followup_type: followupType || 'initial' } };
}, { entity_types: ['contact'], label: 'Email the POC', domains: ['sales'] });

// bd_touch / reminder channels — create a dated task for the BD (call +
// LinkedIn touch with the profile link and a prefilled message) or a generic
// reminder; the human sends the LinkedIn message, the system prepares it.
async function wfReminderExecutor({ step, enrollment, context }) {
  const { contact, job } = context;
  const cfg = step.config || {};
  const assignee = cfg.assignee_user_id || job?.assigned_to_bd || enrollment.enrolled_by;
  if (!assignee) return { outcome: 'skipped', detail: { reason: 'no_assignee' } };
  const contactName = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'POC';
  const vars = job ? buildEmailVars({ job, contact, senderDisplayName: '' }) : {};
  const parts = [cfg.note || step.name];
  if (contact?.linkedin) parts.push(`LinkedIn: ${contact.linkedin}`);
  if (cfg.message) parts.push(`Suggested message: ${fillTemplate(cfg.message, vars)}`);
  const { error } = await supabase.from('reminders').insert({
    job_id: job?.id || enrollment.job_id || null, user_id: assignee,
    contact_name: contactName, company_name: job?.company?.name || '',
    email: contact?.email || null, return_date: today(), reminder_time: cfg.time || '09:00',
    note: parts.join('\n'), status: 'pending', reminder_type: step.channel, contact_id: contact?.id || null
  });
  if (error) return { outcome: 'failed', detail: { error: error.message } };
  if (job?.id) await logActivity(job.id, contact?.id || null, assignee, 'workflow_task_created', `${step.name} (workflow)`, null, null);
  return { outcome: 'done', detail: { assignee } };
}
wfEngine.registerChannel('bd_touch', wfReminderExecutor, { entity_types: ['contact'], label: 'BD call + LinkedIn touch', domains: ['sales'] });
wfEngine.registerChannel('reminder', wfReminderExecutor, { entity_types: ['contact'], label: 'Reminder / task', domains: ['sales'] });

// stage_move channel — a workflow step can advance the pipeline itself.
wfEngine.registerChannel('stage_move', async ({ step, enrollment, context }) => {
  const toStage = (step.config || {}).to_stage;
  const job = context.job;
  if (!toStage) return { outcome: 'failed', detail: { error: 'config.to_stage required' } };
  if (!job) return { outcome: 'skipped', detail: { reason: 'no_job_context' } };
  if (job.stage === toStage) return { outcome: 'skipped', detail: { reason: 'already_in_stage' } };
  const { error } = await supabase.from('jobs').update({ stage: toStage, updated_at: new Date().toISOString() }).eq('id', job.id);
  if (error) return { outcome: 'failed', detail: { error: error.message } };
  await logActivity(job.id, null, enrollment.enrolled_by, 'workflow_stage_move', `Stage → ${toStage} (workflow)`, job.stage, toStage);
  return { outcome: 'done', detail: { from: job.stage, to: toStage } };
}, { entity_types: ['contact'], label: 'Move job stage', domains: ['sales'] });

// ── Recruiting domain: sequences that act on a SUBMISSION (a candidate for a
// specific job order). Reuses the same engine — new context loader + channels,
// zero engine edits. entity_type 'submission'; entity_id = submissions.id.
// ── Recruiting outreach ────────────────────────────────────────────────────
// The recruiting workflow channels, candidate/client email and interview
// endpoints. Mounted here, not required at the top of the file, because it
// needs wfEngine and the send helpers to already exist (same reason the wf /
// warmup / cron mounts sit where they do).
const recruitingOutreach = require('./routes/recruiting/outreach')(app, {
  supabase, auth, hasRole, today, wfEngine, gmailProvider, config, settingsConfig,
  graphMailRequest, sendMicrosoftNewMessage, buildHtmlEmailBody,
  getMailboxSignature, getMicrosoftToken, warmupLimit,
  isSendingPaused, isManagerPaused, loadMailboxDelivState, loadSuppressedSet,
  friendlySendError,
});

// ── Outreach generator (the Email page's "Generator" tab) ──────────────────
// Mounted here, after the block above, because it sends through that block's
// mailbox helpers rather than its own copy of them.
app.use(require('./routes/outreach-generator')({
  ...routeCtx, loadSuppressedSet,
  recruiterSendingMailbox: recruitingOutreach.recruiterSendingMailbox,
  sendMailboxNewMessage: recruitingOutreach.sendMailboxNewMessage,
}));

app.use(require('./routes/wf')({ supabase, auth, hasRole, engine: wfEngine, logActivity }));

// Advance due enrollments hourly.
engineRunner.register('wf_tick', {
  everyMs: 60 * 60 * 1000,
  description: 'Advance due workflow enrollments to their next step',
  run: () => wfEngine.tick()
});

// ── Warm-up pool engine — real Graph sends between our own connected mailboxes.
// OFF by default: a mailbox only participates once an admin starts warm-up
// (warmup_status='warming') or opts it in as a receiver. Spread across a couple
// of ticks a day so the traffic looks organic; offset from the other sweeps.
const warmupEngine = createWarmupEngine({ supabase, graphMailRequest, getMicrosoftToken, gmail: gmailProvider, emit, EVENTS });
app.use(require('./routes/warmup')({ supabase, auth, hasRole, engine: warmupEngine, emit, EVENTS }));
engineRunner.register('warmup_tick', {
  everyMs: 2 * 60 * 60 * 1000,
  description: 'Warm-up pool: graduate mailboxes, rescue from spam, send the next wave',
  run: () => warmupEngine.tick()
});

// ── Automatic lead sourcing (Step 2) ───────────────────────────────────────
// Checks hourly, but each configured board has its own cadence (default daily),
// so this mostly finds nothing to do. Postings land in the review queue and are
// inert until a human approves them — nothing here can email anyone.
engineRunner.register('lead_sourcing', {
  everyMs: 60 * 60 * 1000,
  quiet: true,          // usually nothing is due; don't fill the log with no-ops
  description: 'Pull new postings from configured employer job boards into the review queue',
  run: () => require('./lead-ingest').runDueSources({ supabase })
});

// ── THE HEARTBEAT ──────────────────────────────────────────────
// Two things drive the same registered jobs, and neither can double-run one
// because engine-runs.js persists due-ness:
//   1. This in-process interval — works whenever the service happens to be awake.
//   2. GET /cron/tick?key=… — an external pinger (free: GitHub Actions or
//      cron-job.org, see .github/workflows/heartbeat.yml). This is the one that
//      matters on Render's free tier, where the service sleeps on idle and every
//      in-process timer stops with it.
app.use(require('./routes/cron')({ runner: engineRunner, auth, hasRole }));

// Check every 2 minutes; each job still only runs on its own cadence.
setInterval(() => {
  engineRunner.runDue({ triggeredBy: 'interval' })
    .catch(err => console.error('[engine] tick failed:', err.message));
}, 2 * 60 * 1000);

// A first pass shortly after boot, so a redeploy immediately picks up anything
// that fell due while the service was down.
setTimeout(() => {
  engineRunner.runDue({ triggeredBy: 'boot' })
    .catch(err => console.error('[engine] boot tick failed:', err.message));
}, 60 * 1000);

// ── START ──────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`PACE API v3.0.0 running on port ${PORT}`));
module.exports = app;
