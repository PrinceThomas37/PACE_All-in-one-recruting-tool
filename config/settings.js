// ============================================================================
// OPERATIONAL SETTINGS — small numeric knobs that used to be hardcoded
// constants in index.js / routes / workflow-engine.js. Values live in
// app_settings (key "sys_<name>") with cached reads and validated writes, so
// admins can tune them from the UI without a code deploy.
//
// Deliberately NOT included here: per-mailbox daily send limits and the global
// send-time schedule (already editable elsewhere), and the jobs list cache TTL
// (an infra/egress-cost tuning knob, not a business rule — see the "Cut
// Supabase egress" history around it in index.js).
// ============================================================================

const { DEFAULT_DAILY_SEND_LIMIT } = require('./limits');

// Each number belongs to an ORGANISATION (D-0124): an admin sets their own company's value; a company that has not chosen gets the
// deployment-wide value (the row that existed before), then the default below. `legacyKey` = the bare app_settings key the number was
// read from before it was editable, so a value already stored keeps applying.
const SETTINGS_SCHEMA = [
  {
    key: 'default_daily_send_limit', legacyKey: 'default_daily_send_limit', label: 'Daily send limit for a new mailbox', unit: 'emails/day', group: 'Email engine',
    description: 'How many emails one mailbox may send in a day when nobody has set a number for that mailbox. New mailboxes start here.',
    default: DEFAULT_DAILY_SEND_LIMIT, min: 1, max: 5000,
  },
  {
    key: 'daily_limit_warn_above', legacyKey: 'daily_limit_warn_above', label: 'Warn when a mailbox limit is above', unit: 'emails/day', group: 'Email engine',
    description: 'A daily limit higher than this still saves, but the screen warns that Gmail / Outlook may slow or flag a mailbox that sends this much.',
    default: 500, min: 1, max: 100000,
  },
  {
    key: 'send_delay_min_sec', legacyKey: 'send_delay_min_sec', label: 'Shortest pause between two emails from one mailbox', unit: 'seconds', group: 'Email engine',
    description: 'Emails from one mailbox are spaced out by a random pause between this and the longest pause.',
    default: 30, min: 1, max: 300,
  },
  {
    key: 'send_delay_max_sec', legacyKey: 'send_delay_max_sec', label: 'Longest pause between two emails from one mailbox', unit: 'seconds', group: 'Email engine',
    description: 'The upper end of the pause above. If it is set below the shortest pause, the shortest pause is used.',
    default: 60, min: 1, max: 600,
  },
  {
    key: 'domain_max_per_hour', legacyKey: 'domain_max_per_hour', label: 'Most emails to one company in an hour', unit: 'emails/hour', group: 'Email engine',
    description: 'How many emails one mailbox may send to the same recipient company (email domain) in one hour.',
    default: 8, min: 1, max: 100,
  },
  {
    key: 'bulk_send_max_per_run', legacyKey: 'bulk_send_max_per_run', label: 'Most emails sent in one sending round', unit: 'emails (0 = no cap)', group: 'Email engine',
    description: 'A cap on how many emails go out in a single round of the send loop, across the organisation. 0 means no cap.',
    default: 0, min: 0, max: 100000,
  },
  {
    key: 'company_cooldown_days', label: 'Company re-add cooldown', unit: 'days', group: 'Leads',
    description: 'How long after a company is added before an RA can add it again.',
    default: 21, min: 0, max: 365,
  },
  {
    key: 'mailbox_recipient_lookback', label: 'Sent emails read for address suggestions', unit: 'emails', group: 'Email engine',
    description: 'When someone types in the To or Cc box of a new message, reply or forward, PACE suggests people they have written to before. This is how many of the most recent emails in that mailbox\'s Sent folder it reads to find them (nothing is stored). A bigger number remembers more people but takes longer the first time.',
    default: 100, min: 20, max: 500,
  },
  {
    key: 'ra_edit_window_hours', label: 'RA self-edit window', unit: 'hours', group: 'Leads',
    description: 'How long an RA can edit a lead they created before the edit window closes. The same window applies to an RA lead editing the people (contacts) on a lead their team made.',
    default: 24, min: 1, max: 720,
  },
  {
    key: 'mailbox_warmup_start', label: 'Mailbox warm-up starting cap', unit: 'emails/day', group: 'Deliverability',
    description: "A new mailbox's daily send cap on day 1 of its warm-up ramp.",
    default: 20, min: 1, max: 1000,
  },
  {
    key: 'mailbox_warmup_step', label: 'Mailbox warm-up daily increase', unit: 'emails/day', group: 'Deliverability',
    description: 'How much the warm-up cap increases each day after day 1.',
    default: 5, min: 0, max: 200,
  },
  {
    key: 'warmup_pool_start', label: 'Warm-up starting emails/day', unit: 'emails/day', group: 'Deliverability',
    description: 'How many warm-up emails a mailbox sends to the pool on day 1 of its warm-up.',
    default: 5, min: 1, max: 200,
  },
  {
    key: 'warmup_pool_step', label: 'Warm-up daily increase', unit: 'emails/day', group: 'Deliverability',
    description: 'How many more warm-up emails per day are sent each day after day 1.',
    default: 3, min: 0, max: 100,
  },
  {
    key: 'warmup_pool_days', label: 'Default warm-up duration', unit: 'days', group: 'Deliverability',
    description: 'Default number of days a mailbox warms up before it graduates to outreach (admin can override per mailbox).',
    default: 25, min: 1, max: 120,
  },
  {
    key: 'warmup_replies_per_thread', label: 'Replies per warm-up conversation', unit: 'messages', group: 'Deliverability',
    description: 'How many back-and-forth messages each warm-up conversation runs before it is considered done.',
    default: 3, min: 0, max: 10,
  },
  {
    key: 'warmup_reply_delay_min', label: 'Warm-up reply delay', unit: 'minutes', group: 'Deliverability',
    description: 'Minimum minutes before a warm-up email is auto-replied to (jittered above this), so exchanges look human.',
    default: 30, min: 1, max: 1440,
  },
  {
    key: 'warmup_daily_hard_cap', label: 'Warm-up daily hard cap', unit: 'emails/day', group: 'Deliverability',
    description: 'Absolute safety ceiling on warm-up emails a single mailbox may send per day, regardless of the ramp.',
    default: 200, min: 1, max: 1000,
  },
  {
    key: 'bounce_rate_threshold_pct', label: 'Bounce-rate auto-pause threshold', unit: '%', group: 'Deliverability',
    description: "A mailbox is auto-paused for the day once its bounce rate exceeds this percentage.",
    default: 5, min: 1, max: 100,
  },
  {
    key: 'bounce_min_sample', label: 'Bounce-rate minimum sample', unit: 'emails sent today', group: 'Deliverability',
    description: 'The bounce-rate check only kicks in once a mailbox has sent at least this many emails today (avoids false alarms on a handful of sends).',
    default: 20, min: 1, max: 10000,
  },
  {
    key: 'wf_max_step_failures', label: 'Workflow step retry limit', unit: 'attempts', group: 'Workflows',
    description: 'A workflow enrollment is marked failed after this many failed attempts on the same step.',
    default: 3, min: 1, max: 20,
  },
  {
    key: 'wf_tick_batch', label: 'Workflow engine batch size', unit: 'enrollments/tick', group: 'Workflows',
    description: 'Maximum number of due enrollments the workflow engine processes per tick.',
    default: 200, min: 10, max: 5000,
  },

  // ── When candidates are emailed ──────────────────────────────────────────
  // NOT the same hours as the leads engine, and that is the point: 08:00-16:00
  // is right for a PROSPECT sitting at their desk and exactly wrong for a
  // CANDIDATE, who is at work then. These are the hours somebody is off the
  // clock and looking at their own phone, in THEIR timezone.
  //
  // A start that is not BEFORE its end closes that day rather than opening it
  // for 24 hours — which is how "weekends only" is expressed without a separate
  // switch. Both descriptions say so, because an admin typing 0 and 0 into a
  // pair of hour boxes deserves to know what it will do.
  {
    key: 'candidate_window_weekday_start', label: 'Weekday evening starts', unit: "hour (candidate's local time)",
    group: 'Candidate outreach',
    description: 'Earliest hour a candidate is emailed Monday to Friday, in their own timezone. Default 17 (5pm) — before that they are usually at work. Set start and end the same to send no weekday emails at all.',
    default: 17, min: 0, max: 23,
  },
  {
    key: 'candidate_window_weekday_end', label: 'Weekday evening ends', unit: "hour (candidate's local time)",
    group: 'Candidate outreach',
    description: 'Latest hour a candidate is emailed Monday to Friday. Default 21 (9pm) — nobody wants a recruiter at bedtime.',
    default: 21, min: 0, max: 24,
  },
  {
    key: 'candidate_window_weekend_start', label: 'Weekend starts', unit: "hour (candidate's local time)",
    group: 'Candidate outreach',
    description: 'Earliest hour a candidate is emailed on Saturday or Sunday. Default 9 (9am) — they are not at work, so the whole day is fair. Set start and end the same to send no weekend emails at all.',
    default: 9, min: 0, max: 23,
  },
  {
    key: 'candidate_window_weekend_end', label: 'Weekend ends', unit: "hour (candidate's local time)",
    group: 'Candidate outreach',
    description: 'Latest hour a candidate is emailed on Saturday or Sunday. Default 20 (8pm).',
    default: 20, min: 0, max: 24,
  },
  // ── Client intelligence (D-0039 … D-0043) — BOTH SWITCHES SHIP OFF ────────
  // The owner: "Don't switch it on till I say." Off means the client page
  // keeps its old Emails list and no summary can be generated by anyone.
  {
    key: 'client_intel_enabled', label: 'Client email timeline', unit: '1 = on, 0 = off', group: 'Client intelligence',
    description: "Shows every email to and from a client's contacts on the client page, with free facts (who is waiting on whom, questions, promises). Only the client's owner sees it. No AI is used.",
    default: 0, min: 0, max: 1,
  },
  {
    key: 'client_intel_ai_enabled', label: 'AI client summary button', unit: '1 = on, 0 = off', group: 'Client intelligence',
    description: 'Adds a "Generate AI summary" button to the timeline. A summary is only ever made when someone presses it, costs at most ~3,400 tokens however long the history, and nothing when there is nothing new.',
    default: 0, min: 0, max: 1,
  },
  // "Needs you today" (R-290, owner 20 Oct): when a reply becomes OWED, and how long a silence runs before it is shown as a quiet nudge.
  {
    key: 'needs_reply_after_days', label: 'A reply becomes "owed" after', unit: 'days', group: 'Needs you today',
    description: 'A client or candidate wrote and nobody has answered. It appears on "Needs you today" once their email is this many days old. 0 shows it at once.',
    default: 4, min: 0, max: 30,
  },
  {
    key: 'nudge_quiet_after_days', label: 'A silence becomes a quiet nudge after', unit: 'days', group: 'Needs you today',
    description: 'We wrote and heard nothing. For this many days it is an ordinary chase; after that it is shown lower down as "chase or drop?". 0 keeps every silence as an ordinary chase.',
    default: 45, min: 0, max: 365,
  },
  {
    key: 'client_intel_ai_per_user_daily', label: 'AI summaries per person per day', unit: 'summaries', group: 'Client intelligence',
    description: "Each person's own daily allowance, so one busy user cannot use up the team's. Set 0 for none. Re-set this after two weeks of real use from what people actually used.",
    default: 15, min: 0, max: 500,
  },
  // The lead engine's sending hours (R-055). These are the hours every screen
  // quotes ("Send window: 8:00 AM – 4:00 PM lead local time") and the ONLY
  // hours the send loop obeys — a first email and a follow-up alike go out
  // only inside them, in the LEAD's own time zone. They used to be read from
  // two app_settings keys nothing ever wrote, while Admin's "Outreach send
  // time" box saved a value nothing ever read.
  {
    key: 'send_window_start_hour', label: 'Lead emails: start sending at', unit: "hour, 0-23 (lead's local time)", group: 'Email engine',
    description: "Emails to leads go out only from this hour, in each LEAD's own time zone (a Texas lead by Texas time). 8 = 8:00 AM.",
    default: 8, min: 0, max: 23,
  },
  {
    key: 'send_window_end_hour', label: 'Lead emails: stop sending at', unit: "hour, 1-24 (lead's local time)", group: 'Email engine',
    description: "No lead email goes out at or after this hour, in the lead's own time zone. 16 = 4:00 PM. Must be later than the start hour.",
    default: 16, min: 1, max: 24,
  },
  {
    key: 'company_daily_first_emails', label: 'First emails per company per day', unit: 'contacts (0 = no limit)', group: 'Email engine',
    description: 'How many different people at ONE company may get a first email on the same day. The rest wait and go the next day — nothing is dropped. Follow-ups are not counted.',
    default: 2, min: 0, max: 20,
  },
  {
    key: 'engine_ai_first_email', label: 'AI writes first emails', unit: '1 = on, 0 = off', group: 'Email engine',
    description: "When on, the lead engine asks AI to write each lead's FIRST email just before it is sent; follow-ups stay templates. If AI is unavailable, over the daily limit, or writes something that breaks a house rule, the template goes out instead.",
    default: 1, min: 0, max: 1,
  },
  // R-148 (D-0082, option A): a BD can take leads from the pool for themselves, up to this many a day.
  {
    key: 'self_assign_daily_cap', label: 'Leads a BD may take for themselves per day', unit: 'leads (0 = switched off)', group: 'Leads',
    description: "Lets a BD or BD lead press \"Take leads\" and be handed pool leads straight into their own connected mailboxes — the same spread an admin's Assign Leads does, marked as self-assigned. They never see the pool itself, only how many they may still take today. 0 switches it off.",
    default: 25, min: 0, max: 500,
  },
  // The POC finder's paid rung (R-053, D-0049). Searching Apollo for names is
  // free; revealing one person's work email costs one credit. An address PACE
  // can build from the company's own learned format costs nothing and is used
  // first, so this ceiling is only ever spent where PACE has no other way.
  {
    key: 'poc_apollo_daily_credits', label: 'Apollo credits a day for the contact finder', unit: 'credits (0 = none)', group: 'Contact finder',
    description: "The most Apollo credits the contact finder may spend in one day, across everyone (Search contact, Uncover, and company size). One credit shows one person's full name and work email, or one company's size; searching is free, and an email PACE can build from the company's own format costs nothing. Also set on the Apollo card in Admin → Integrations. At 0 nothing is spent.",
    // Raised from 1,000 on 2026-09-28 (D-0054: "I want to increase the credit
    // usage of the apollo") — the owner's test account alone holds 183.3k.
    default: 20, min: 0, max: 10000,
  },
  // The Lead Finder (R-157, D-0088/D-0091). The owner's words: the admin sets "n number of leads to be
  // generated per day per user", the wait time on a card, and the Apollo credits the organisation may spend
  // ("they are going to buy it on credit based from us"). The per-person number and who may use the finder
  // at all are set per person on the Find Leads page (app_settings `finder_user_<id>`), not here.
  {
    key: 'finder_cards_per_day', label: 'Lead Finder: cards a day for each person', unit: 'cards (0 = none)', group: 'Lead Finder',
    description: 'How many companies each person sees in Today\'s cards each day, unless an admin has set a different number for that person on the Find Leads page.',
    default: 25, min: 0, max: 500,
  },
  {
    key: 'finder_cards_per_run', label: 'Lead Finder: most cards one "Find leads now" search can bring', unit: 'cards (0 = off)', group: 'Lead Finder',
    description: 'A one-off search (Find leads now) is not part of the daily number above, so it has its own ceiling for each press of Find. It still uses one Apollo credit from the organisation\'s daily limit.',
    default: 25, min: 0, max: 200,
  },
  {
    key: 'finder_wait_days', label: 'Lead Finder: how long a "Wait" lasts', unit: 'days', group: 'Lead Finder',
    description: 'A company someone puts on Wait comes back to their cards after this many days.',
    default: 14, min: 1, max: 180,
  },
  {
    key: 'finder_card_days', label: 'Lead Finder: how long an unreviewed card stays', unit: 'days', group: 'Lead Finder',
    description: 'A card nobody has accepted, waited or rejected disappears after this many days (nothing is saved as a lead until Accept).',
    default: 5, min: 1, max: 30,
  },
  {
    key: 'finder_apollo_daily_credits', label: 'Lead Finder: Apollo credits a day', unit: 'credits (0 = none)', group: 'Lead Finder',
    description: 'The most Apollo credits the Lead Finder may spend in one day across everyone: one per page of companies searched, one per company whose postings are opened, one per email revealed. Searching for people is free.',
    default: 300, min: 0, max: 100000,
  },
  {
    key: 'finder_reveals_per_day', label: 'Lead Finder: emails each person may reveal a day', unit: 'emails (0 = none)', group: 'Lead Finder',
    description: 'How many people\'s work emails one person may reveal (1 Apollo credit each) in a day. This is the number a charge could later attach to.',
    default: 30, min: 0, max: 1000,
  },
  {
    key: 'finder_jsearch_daily_requests', label: 'Lead Finder: free-job-source requests a day (per organisation)', unit: 'requests (0 = none)', group: 'Lead Finder',
    description: 'The most requests the free job sources may make in one day for one organisation. Each is one request on the organisation\'s own job-search plan (the free plan allows 200 a month — about 6 a day), so this stops a busy day using the month. Counted per organisation, not across customers.',
    default: 6, min: 0, max: 10000,
  },
  {
    key: 'followup_max', label: 'Most follow-ups a person may use', unit: 'follow-ups (0 = none)', group: 'Email engine',
    description: 'Each person chooses how many follow-ups to send after the first email. This is the most they may choose. Chains already scheduled keep what they had.',
    default: 5, min: 0, max: 5,
  },
  {
    key: 'finder_max_saved_searches', label: 'Lead Finder: saved searches each person may keep', unit: 'searches', group: 'Lead Finder',
    description: 'How many saved searches one person may have at a time. They are asked to delete one before saving another.',
    default: 20, min: 1, max: 500,
  },
  {
    key: 'finder_max_contacts_per_lead', label: 'Lead Finder: most contacts added to one lead', unit: 'contacts', group: 'Lead Finder',
    description: 'How many people can be added as contacts when a company is accepted as a lead.',
    default: 3, min: 1, max: 20,
  },
  {
    key: 'finder_max_jobs_per_lead', label: 'Lead Finder: most jobs put on one lead or email', unit: 'jobs', group: 'Lead Finder',
    description: 'How many open jobs one lead (or one email to a contact) may carry: the first is the main job, the rest are kept as "also hiring".',
    default: 5, min: 1, max: 25,
  },
  {
    key: 'finder_max_titles', label: 'Lead Finder: most job titles in one search', unit: 'titles', group: 'Lead Finder',
    description: 'How many job titles one saved search may look for.',
    default: 40, min: 1, max: 200,
  },
  {
    key: 'finder_max_places', label: 'Lead Finder: most places in one search', unit: 'places', group: 'Lead Finder',
    description: 'How many cities, states or "remote" entries one saved search may cover.',
    default: 8, min: 1, max: 50,
  },
  {
    key: 'finder_max_companies', label: 'Lead Finder: most named companies in one search', unit: 'companies', group: 'Lead Finder',
    description: 'How many companies, chosen by name or website, one saved search may be limited to.',
    default: 30, min: 1, max: 200,
  },
  {
    key: 'finder_max_sectors', label: 'Lead Finder: most industries in one search', unit: 'industries', group: 'Lead Finder',
    description: 'How many industries one saved search may combine.',
    default: 8, min: 1, max: 30,
  },
  {
    key: 'finder_max_keywords', label: 'Lead Finder: most keywords in one search', unit: 'keywords', group: 'Lead Finder',
    description: 'How many extra keywords one saved search may carry.',
    default: 8, min: 1, max: 50,
  },
  {
    key: 'finder_jsearch_requests_per_run', label: 'Lead Finder: most free-source requests one search run may make', unit: 'requests (0 = off)', group: 'Lead Finder',
    description: 'One request looks up one job title in one place and brings up to 10 jobs. A search with more titles or places than this is covered over several daily runs (a one-off search takes the first ones).',
    default: 3, min: 0, max: 50,
  },
  {
    key: 'smtp_connect_tries', label: 'App-password mailbox: connection tries per person', unit: 'tries', group: 'Email engine',
    description: 'How many times one person may try to connect an app-password mailbox inside the time window below, before they are asked to wait. It stops guessing at passwords.',
    default: 6, min: 1, max: 100,
  },
  {
    key: 'smtp_connect_window_minutes', label: 'App-password mailbox: window for those tries', unit: 'minutes', group: 'Email engine',
    description: 'The length of the window the tries above are counted in.',
    default: 10, min: 1, max: 1440,
  },
  {
    key: 'smtp_sweep_batch', label: 'App-password mailbox: messages read per check', unit: 'messages', group: 'Email engine',
    description: 'The most messages read from one app-password mailbox folder each time PACE looks for replies and bounces. A busier inbox is caught up over the next checks.',
    default: 50, min: 1, max: 200,
  },
  {
    key: 'send_selected_max', label: 'Most emails sent or retried in one click', unit: 'emails', group: 'Email engine',
    description: 'The most emails "Send selected" or "Retry" will take in a single click. Anything beyond it is left for the next click.',
    default: 500, min: 1, max: 5000,
  },
];

const SCHEMA_BY_KEY = new Map(SETTINGS_SCHEMA.map((s) => [s.key, s]));
const APP_SETTINGS_PREFIX = 'sys_';
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // "key|org" -> { value, source, loadedAt }

function clampToDefault(def, value) {
  if (!Number.isFinite(value) || value < def.min || value > def.max) return def.default;
  return value;
}

const orgKey = (key, orgId) => APP_SETTINGS_PREFIX + key + '@' + orgId;
const okNumber = (def, raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= def.min && n <= def.max ? n : null;
};

// The effective value and where it came from: this organisation's own choice, else the deployment-wide value, else the built-in default.
async function resolveSetting(supabase, key, orgId) {
  const def = SCHEMA_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting "${key}"`);
  const ck = key + '|' + (orgId || '');
  const cached = cache.get(ck);
  if (cached && (Date.now() - cached.loadedAt) < CACHE_TTL_MS) return cached;
  let out = { value: def.default, source: 'default' };
  try {
    const keys = [APP_SETTINGS_PREFIX + key];
    if (def.legacyKey) keys.push(def.legacyKey);
    if (orgId) keys.push(orgKey(key, orgId));
    const { data } = await supabase.from('app_settings').select('key,value').in('key', keys);
    const by = {}; (data || []).forEach((r) => { by[r.key] = r.value; });
    const own = orgId ? okNumber(def, by[orgKey(key, orgId)]) : null;
    const shared = okNumber(def, by[APP_SETTINGS_PREFIX + key]);
    const legacy = def.legacyKey ? okNumber(def, by[def.legacyKey]) : null;
    if (own !== null) out = { value: own, source: 'organisation' };
    else if (shared !== null) out = { value: shared, source: 'deployment' };
    else if (legacy !== null) out = { value: legacy, source: 'deployment' };
  } catch (e) {
    console.warn(`[settings] failed to load "${key}", using default ${def.default}:`, e.message);
  }
  const rec = { ...out, loadedAt: Date.now() };
  cache.set(ck, rec);
  return rec;
}

// Cached read of one numeric setting for an organisation (orgId omitted = the deployment-wide value). Falls back to the schema
// default if unset, invalid, or the DB is unreachable — this must never be the thing that breaks the send pipeline.
async function getSetting(supabase, key, orgId) {
  return (await resolveSetting(supabase, key, orgId)).value;
}

// For the admin panel: schema + the effective value for this organisation, where it came from, and what it would be without its
// own choice (so the screen can say "using the shared value, 30").
async function getAllSettings(supabase, orgId) {
  return Promise.all(SETTINGS_SCHEMA.map(async (def) => {
    const r = await resolveSetting(supabase, def.key, orgId);
    const base = orgId ? await resolveSetting(supabase, def.key, null) : r;
    return { ...def, value: r.value, source: r.source, shared_value: base.value };
  }));
}

function validate(key, rawValue) {
  const def = SCHEMA_BY_KEY.get(key);
  if (!def) return { error: `Unknown setting "${key}"` };
  const value = Number.parseFloat(rawValue);
  if (!Number.isFinite(value)) return { error: `"${def.label}" must be a number` };
  if (value < def.min || value > def.max) return { error: `"${def.label}" must be between ${def.min} and ${def.max}` };
  return { value };
}

// All-or-nothing bulk write: { key: rawValue, ... }. Validates every entry before writing any of them, so a bad field never leaves
// settings half-saved. With an orgId the values are THAT organisation's own (and '' / null removes its choice, going back to the
// shared value); without one they are the deployment-wide values.
async function setSettings(supabase, updates, orgId) {
  const keys = Object.keys(updates || {});
  if (!keys.length) return { error: 'No settings to update' };
  const rows = [], clears = [];
  for (const key of keys) {
    if (orgId && (updates[key] === '' || updates[key] === null)) {
      if (!SCHEMA_BY_KEY.has(key)) return { error: `Unknown setting "${key}"`, key };
      clears.push(orgKey(key, orgId));
      continue;
    }
    const result = validate(key, updates[key]);
    if (result.error) return { error: result.error, key };
    rows.push({ key: orgId ? orgKey(key, orgId) : APP_SETTINGS_PREFIX + key, value: String(result.value), updated_at: new Date() });
  }
  if (rows.length) {
    const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
    if (error) throw error;
  }
  if (clears.length) {
    const { error } = await supabase.from('app_settings').delete().in('key', clears);
    if (error) throw error;
  }
  cache.clear();
  return { success: true };
}

module.exports = { SETTINGS_SCHEMA, getSetting, getAllSettings, setSettings };
