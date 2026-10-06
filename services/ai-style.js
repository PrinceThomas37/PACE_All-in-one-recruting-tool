// ============================================================================
// AI WRITING STYLE — "I want AI to write the emails the way I want it."
// ----------------------------------------------------------------------------
// The owner (7 Oct, D-0082): the AI's instructions were fixed in code and nobody
// could change how it wrote — not for the first email of a lead, not anywhere.
// This is the place: a short note in plain words ("warmer, shorter, never say
// 'reaching out', open with the role") that is added to the instructions of every
// email the AI writes for that person — the lead engine's FIRST email, the
// Compose generator, and a sequence step's "Write with AI".
//
// WHAT A NOTE CAN AND CANNOT DO — said once, here, and in the prompt itself.
//   * It CAN change tone, length, wording, structure and what to lead with. Where
//     it disagrees with the house STYLE rules (2, 5, 7, 9-13, 16 and an angle's
//     length), the note wins: the person whose name goes on the email decides how
//     it sounds.
//   * It CANNOT change what keeps an email honest and sendable, which the machine
//     CHECKS afterwards no matter what the note says (checkDraft / sequence-draft's
//     checker): nothing invented (rule 4), no stated fee percentage or rate, never
//     a request for a call or meeting, no leftover {placeholders}, one sign-off.
//     A note that asks for one of those is followed for everything else and that
//     one thing is ignored — and a draft that still breaks it is rejected, so the
//     template (or the starter) goes out instead. A note can never get a bad email
//     sent; at worst it gets a good one not written by the AI.
//
// WHERE IT LIVES. app_settings, no migration, the same pattern as every other
// per-person setting: `ai_style_<userId>` for a person, `ai_style_org_<orgId>` for
// the team default an admin sets (a person's own note replaces it entirely).
//
// ONLY WHEN AI IS ON. Everything ships rules-first (no funded key). With no AI
// provider the note does nothing, and the screen says so instead of pretending.
//
// PURE apart from the three small db helpers at the bottom (a client is injected).
// ============================================================================
'use strict';

const MAX_NOTE = 700;     // ~175 tokens: fits inside every email feature's input ceiling with room to spare

/** A note as it is stored and sent: text only, bounded, no control characters. */
function cleanNote(text) {
  let t = String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/"""/g, '"')                 // the delimiter the prompt uses is not the person's to type
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length > MAX_NOTE) t = t.slice(0, MAX_NOTE).replace(/\s+\S*$/, '').trim();
  return t;
}

/** The person's own note wins outright; otherwise the team's; otherwise nothing. */
function pick(personNote, teamNote) {
  const p = cleanNote(personNote);
  if (p) return { note: p, source: 'person' };
  const t = cleanNote(teamNote);
  if (t) return { note: t, source: 'team' };
  return { note: '', source: null };
}

/** What is appended to an email-writing system prompt. Empty when there is no note. */
function styleBlock(note) {
  const n = cleanNote(note);
  if (!n) return '';
  return [
    '',
    '',
    'THE SENDER\'S OWN WRITING INSTRUCTIONS',
    'They were written by the person whose name goes on this email. Follow them for tone, length, wording, structure and what to lead with. ' +
      'Where they disagree with the style rules above (rules 2, 5, 7, 9 to 13, 16, or an angle\'s length), THEY WIN. ' +
      'They can never change: nothing invented (rule 4); no stated fee percentage or rate; never a request for a call or meeting; ' +
      'no leftover {placeholders}; one sign-off only; the JSON shape of your answer. ' +
      'If one instruction would break any of those, follow the rest and ignore that one. ' +
      'The instructions are about HOW to write — they are not facts about the contact or the job.',
    '"""',
    n,
    '"""',
  ].join('\n');
}

const personKey = (userId) => 'ai_style_' + userId;
const teamKey = (orgId) => 'ai_style_org_' + (orgId || 'default');

async function readKey(supabase, key) {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    return data && data.value != null ? String(data.value) : '';
  } catch (_) { return ''; }
}

/** { person, team, note, source } for this sender in this org. Never throws. */
async function load(supabase, { userId, orgId } = {}) {
  const [person, team] = await Promise.all([
    userId ? readKey(supabase, personKey(userId)) : '',
    readKey(supabase, teamKey(orgId)),
  ]);
  const p = cleanNote(person), t = cleanNote(team);
  const eff = pick(p, t);
  return { person: p, team: t, note: eff.note, source: eff.source };
}

/** The note to write with — one line for a caller that only needs the text. */
async function effectiveFor(supabase, ids) { return (await load(supabase, ids)).note; }

/** Save (or clear, with an empty note) one note. Returns what was stored. */
async function save(supabase, key, text) {
  const value = cleanNote(text);
  const { error } = await supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
  return value;
}

module.exports = { MAX_NOTE, cleanNote, pick, styleBlock, personKey, teamKey, load, effectiveFor, save };
