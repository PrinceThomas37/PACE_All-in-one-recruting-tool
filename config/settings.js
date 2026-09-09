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

const SETTINGS_SCHEMA = [
  {
    key: 'company_cooldown_days', label: 'Company re-add cooldown', unit: 'days', group: 'Leads',
    description: 'How long after a company is added before an RA can add it again.',
    default: 21, min: 0, max: 365,
  },
  {
    key: 'ra_edit_window_hours', label: 'RA self-edit window', unit: 'hours', group: 'Leads',
    description: 'How long an RA can edit a lead they created before the edit window closes.',
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
];

const SCHEMA_BY_KEY = new Map(SETTINGS_SCHEMA.map((s) => [s.key, s]));
const APP_SETTINGS_PREFIX = 'sys_';
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // key -> { value, loadedAt }

function clampToDefault(def, value) {
  if (!Number.isFinite(value) || value < def.min || value > def.max) return def.default;
  return value;
}

// Cached read of one numeric setting. Falls back to the schema default (the
// previous hardcoded behaviour) if unset, invalid, or the DB is unreachable —
// this must never be the thing that breaks the send pipeline.
async function getSetting(supabase, key) {
  const def = SCHEMA_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting "${key}"`);
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.loadedAt) < CACHE_TTL_MS) return cached.value;
  let value = def.default;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', APP_SETTINGS_PREFIX + key).maybeSingle();
    if (data && data.value !== undefined && data.value !== null && data.value !== '') {
      value = clampToDefault(def, Number.parseFloat(data.value));
    }
  } catch (e) {
    console.warn(`[settings] failed to load "${key}", using default ${def.default}:`, e.message);
  }
  cache.set(key, { value, loadedAt: Date.now() });
  return value;
}

// For the admin panel: schema + current effective value for every setting.
async function getAllSettings(supabase) {
  return Promise.all(SETTINGS_SCHEMA.map(async (def) => ({ ...def, value: await getSetting(supabase, def.key) })));
}

function validate(key, rawValue) {
  const def = SCHEMA_BY_KEY.get(key);
  if (!def) return { error: `Unknown setting "${key}"` };
  const value = Number.parseFloat(rawValue);
  if (!Number.isFinite(value)) return { error: `"${def.label}" must be a number` };
  if (value < def.min || value > def.max) return { error: `"${def.label}" must be between ${def.min} and ${def.max}` };
  return { value };
}

// All-or-nothing bulk write: { key: rawValue, ... }. Validates every entry
// before writing any of them, so a bad field never leaves settings half-saved.
async function setSettings(supabase, updates) {
  const keys = Object.keys(updates || {});
  if (!keys.length) return { error: 'No settings to update' };
  const rows = [];
  for (const key of keys) {
    const result = validate(key, updates[key]);
    if (result.error) return { error: result.error, key };
    rows.push({ key: APP_SETTINGS_PREFIX + key, value: String(result.value), updated_at: new Date() });
  }
  const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
  keys.forEach((k) => cache.delete(k));
  return { success: true };
}

module.exports = { SETTINGS_SCHEMA, getSetting, getAllSettings, setSettings };
