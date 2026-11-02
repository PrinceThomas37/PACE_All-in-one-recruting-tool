// ============================================================================
// AI ON / OFF PER PERSON (owner, 2 Nov 2026, D-0195).
// ----------------------------------------------------------------------------
// "Where can the admin switch the AI enabler for each user — its not per feature, that's per user based on the payment
// received or not." ON for everyone until the admin turns someone off. OFF = every AI button gone for that person, with one
// line saying why; their templates and versions keep sending.
//
// HOW IT IS ENFORCED — on the server, in ONE place, not per button: `auth` (index.js) runs every request inside
// runAs(userId), and services/ai-provider.js complete() / availability() ask allowed() before any AI request. So a person
// whose AI is off gets the same answer as "no AI today" (null → the rules write it) from every AI feature, existing and
// future, without each route remembering. Work with no person behind it (the engine's timers) is not affected.
// The screen hides the buttons from GET /me/ai-access; that is convenience, the server is the rule.
//
// Stored per person in app_settings: u_<id>_ai_access = 'off'. Absent (or anything else) = on.
// ============================================================================
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();
const CACHE_MS = 30 * 1000;
const cache = new Map();                       // userId -> { on, at }

const key = (userId) => `u_${userId}_ai_access`;

/** Run `fn` as this person's request (auth middleware). */
function runAs(userId, fn) { return als.run({ userId: userId || null }, fn); }
/** The person whose request is being served, or null (engine work, boot). */
function currentUserId() { const s = als.getStore(); return (s && s.userId) || null; }

/** Is AI on for this person? Unknown or unreadable = on (the owner's default; a failed read never takes AI away). */
async function isOn(supabase, userId) {
  if (!userId) return true;
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.on;
  let on = true;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', key(userId)).maybeSingle();
    on = !(data && String(data.value).trim().toLowerCase() === 'off');
  } catch (_) { on = true; }
  cache.set(userId, { on, at: Date.now() });
  return on;
}

/** May an AI request be made now? `userId` given, or the person whose request this is. */
async function allowed(supabase, userId) { return isOn(supabase, userId || currentUserId()); }

/** Turn it on/off for a person (admin). */
async function set(supabase, userId, on) {
  const { error } = await supabase.from('app_settings').upsert({ key: key(userId), value: on ? 'on' : 'off', updated_at: new Date() }, { onConflict: 'key' });
  if (error) throw error;
  cache.set(userId, { on: !!on, at: Date.now() });
}

/** Many people at once (the admin's list): { [userId]: true|false }. */
async function forUsers(supabase, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const out = {}; ids.forEach((id) => { out[id] = true; });
  for (let i = 0; i < ids.length; i += 60) {
    const { data, error } = await supabase.from('app_settings').select('key,value').in('key', ids.slice(i, i + 60).map(key));
    if (error) throw error;
    (data || []).forEach((r) => { const id = r.key.slice(2, -'_ai_access'.length); out[id] = String(r.value).trim().toLowerCase() !== 'off'; });
  }
  return out;
}

const OFF_MESSAGE = 'AI is not switched on for your account. Ask your admin.';

module.exports = { key, runAs, currentUserId, isOn, allowed, set, forUsers, OFF_MESSAGE, _clear: () => cache.clear() };
