// ============================================================================
// RESUME PARSER — file text extraction + field parsing
// ----------------------------------------------------------------------------
// Turns an uploaded resume (PDF / DOCX / TXT / RTF) into candidate fields.
// Two tiers, mirroring the app's other AI features:
//   1. AI parse when an AI provider is configured (Admin → Integrations;
//      Anthropic, Groq, OpenRouter or a self-hosted Ollama) — accurate
//      structured extraction.
//   2. Rule-based fallback — regex for email/phone/LinkedIn, a name heuristic,
//      experience-years detection, and skills matched against the same
//      SKILL_DICTIONARIES the JD parser uses. Works with no key at all.
// Nothing here writes to the database — callers get fields back and decide.
// ============================================================================

const { SKILL_DICTIONARIES } = require('./skill-dictionaries');
const aiProvider = require('./services/ai-provider');

// Lazy requires so a missing optional dep degrades to "unsupported file type"
// instead of crashing boot.
function tryRequire(name) { try { return require(name); } catch (_) { return null; } }

const MAX_TEXT_CHARS = 20000;   // plenty for any resume; caps AI cost

// ── text extraction ─────────────────────────────────────────────────────────
async function extractResumeText(buffer, filename) {
  const name = String(filename || '').toLowerCase();
  if (name.endsWith('.pdf')) {
    const pdfParse = tryRequire('pdf-parse');
    if (!pdfParse) throw new Error('PDF support not installed on the server.');
    const out = await pdfParse(buffer);
    return String(out.text || '');
  }
  if (name.endsWith('.docx')) {
    const mammoth = tryRequire('mammoth');
    if (!mammoth) throw new Error('DOCX support not installed on the server.');
    const out = await mammoth.extractRawText({ buffer });
    return String(out.value || '');
  }
  // txt / rtf / unknown — treat as text (RTF keeps enough words to parse)
  return buffer.toString('utf8').replace(/\\[a-z]+\d* ?|[{}]/g, ' ');
}

// ── rule-based parse (always available) ─────────────────────────────────────
const US_STATES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };
const STATE_NAMES = Object.values(US_STATES);

function parseResumeRules(text) {
  const t = String(text || '').slice(0, MAX_TEXT_CHARS);
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const out = {};

  const email = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) out.email = email[0];

  const phone = t.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phone) out.phone = phone[0].trim();

  const li = t.match(/linkedin\.com\/in\/[A-Za-z0-9_-]+/i);
  if (li) out.linkedin_url = 'https://www.' + li[0].replace(/^www\./i, '');

  // Name: the first short line near the top that isn't contact info / a heading.
  for (const line of lines.slice(0, 8)) {
    if (/@|\d{3}[\s.-]?\d{4}|linkedin|resume|curriculum|http/i.test(line)) continue;
    const words = line.replace(/[,|•·].*$/, '').trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Za-z.'-]+$/.test(w))) {
      out.full_name = words.join(' ');
      break;
    }
  }

  // City, State — "Denver, CO" or "Denver, Colorado"
  const cityState = t.match(new RegExp('([A-Z][A-Za-z .-]{2,25}),\\s*(' + Object.keys(US_STATES).join('|') + ')\\b')) ||
                    t.match(new RegExp('([A-Z][A-Za-z .-]{2,25}),\\s*(' + STATE_NAMES.join('|') + ')\\b'));
  if (cityState) {
    out.city = cityState[1].trim();
    out.state = US_STATES[cityState[2]] || cityState[2];
  }

  // Experience — "12 years", "12+ years of experience"
  const exp = t.match(/(\d{1,2})(?:\.\d)?\s*\+?\s*years?/i);
  if (exp) out.experience_years = parseInt(exp[1], 10);

  // Title: line after the name that looks like a role, or the most recent bolded role line.
  const nameIdx = out.full_name ? lines.findIndex(l => l.indexOf(out.full_name) > -1) : -1;
  for (const line of lines.slice(Math.max(0, nameIdx + 1), nameIdx + 5)) {
    if (/@|\d{3}[\s.-]?\d{4}|linkedin|http|^(summary|objective|profile)/i.test(line)) continue;
    if (line.length > 4 && line.length < 70 && /^[A-Za-z][A-Za-z0-9 /&,.'()-]+$/.test(line)) { out.current_title = line; break; }
  }

  // Skills: match every dictionary term on word boundaries, dedup, cap at 30.
  const found = new Set();
  const lower = t.toLowerCase();
  Object.values(SKILL_DICTIONARIES).forEach(list => {
    list.forEach(skill => {
      if (found.size >= 30) return;
      const re = new RegExp('\\b' + skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (re.test(lower)) found.add(skill);
    });
  });
  if (found.size) out.skills = [...found].join(', ');

  return out;
}

// ── AI parse (graceful null when unconfigured/failed) ───────────────────────
// `store` is the supabase client, needed only to look up which provider is
// configured. Without it (or without a provider) this returns null and the
// rules parser is the whole answer, exactly as before.
async function parseResumeAI(text, store, orgId) {
  if (!store) return null;
  try {
    const prompt = `Extract candidate fields from this resume. Reply with ONLY a JSON object (no markdown, no commentary) with these keys (omit any you cannot find): full_name, email, phone, linkedin_url, current_title, current_employer, city, state, country, experience_years (number), skills (comma-separated string, max 25), work_authorization, summary (2 sentences max).

RESUME:
${String(text || '').slice(0, MAX_TEXT_CHARS)}`;
    const completion = await aiProvider.complete(store, { prompt, maxTokens: 700, feature: 'resume_parse', orgId });
    if (!completion) return null;
    const raw = completion.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    // keep only expected keys with sane types
    const allow = ['full_name','email','phone','linkedin_url','current_title','current_employer','city','state','country','experience_years','skills','work_authorization','summary'];
    const out = {};
    allow.forEach(k => {
      if (parsed[k] === undefined || parsed[k] === null || parsed[k] === '') return;
      out[k] = k === 'experience_years' ? parseFloat(parsed[k]) : String(parsed[k]);
    });
    if (out.experience_years !== undefined && !isFinite(out.experience_years)) delete out.experience_years;
    return Object.keys(out).length ? out : null;
  } catch (_) { return null; }
}

// ── entry point ─────────────────────────────────────────────────────────────
async function parseResume(buffer, filename, store, orgId) {
  const text = (await extractResumeText(buffer, filename)).replace(/\r/g, '').trim();
  if (!text || text.length < 40) throw new Error('Could not read any text from this file.');
  const ai = await parseResumeAI(text, store, orgId);
  const rules = parseResumeRules(text);
  // AI wins where it answered; rules fill the gaps (and are the whole answer without a key)
  const fields = Object.assign({}, rules, ai || {});
  return { fields, used_ai: !!ai, text: text.slice(0, MAX_TEXT_CHARS) };
}

module.exports = { parseResume, parseResumeRules, extractResumeText };
