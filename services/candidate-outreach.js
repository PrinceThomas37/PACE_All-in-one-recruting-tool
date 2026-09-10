'use strict';
// ============================================================================
// CANDIDATE OUTREACH — write to the people in our database about the jobs in
// our database, and ask one question: are you interested?
//
// PURE. No supabase, no fetch, no clock, no process.env. Everything is a
// function of its arguments, which is why test/candidate-outreach-smoke.mjs
// can pin every rule below with no network and no database.
//
// ── THE DIRECTION IS REVERSED FROM services/outreach-generator.js ──────────
// That file starts from a job posting PASTED off the internet and finds one
// hiring contact. This one starts from a job order we already OWN and finds
// many candidates. Everything awkward about this feature follows from that:
//
//   • 25 candidates on one job would be 25 AI calls. Groq's free tier is 8,000
//     tokens a minute and one generated email costs ~2,100 — four in quick
//     succession already rate-limits (measured 2026-09-08), and 25 would spend
//     the org's whole daily meter, after which EVERY AI feature in PACE
//     silently falls back to its rules writer for the rest of the day.
//
//     So the AI writes THE JOB BRIEF, once per job order, cached on the job
//     (migration 042). The per-candidate sentence is assembled here, for free,
//     from the match engine's `reasons` — which are read off that person's own
//     resume and are therefore true by construction. 25 candidates cost the
//     same as one.
//
//   • The body keeps {{sender}} / {{senderemail}} UNRENDERED, because these
//     emails are QUEUED and drained later. The mailbox that actually sends is
//     resolved at send time. Baking a name in at queue time is how 152 cold
//     emails went out saying "I'm Jennifer Thomas" over Prince Thomas's From
//     line (Session 14). This is the one rule in the file that is not about
//     prose.
// ============================================================================

const txt = (v) => String(v == null ? '' : v).trim();
const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// The two tokens the send path fills. Everything else inside {{ }} is a bug
// that reaches the recipient verbatim — which is exactly why the checker below
// allows these two by name rather than allowing "{{" generally.
const SENDER_TOKEN = '{{sender}}';
const SENDER_TOKENS = /\{\{\s*(sender|senderemail)\s*\}\}/g;

function firstNameOf(name) {
  const n = txt(name);
  if (!n) return 'there';
  return n.split(/\s+/)[0];
}

// ── WHAT THE JOB ACTUALLY OFFERS ───────────────────────────────────────────
// Read once per job, reused for every candidate on it. Every field is optional
// because a job order filled in by hand usually is: the writer must degrade to
// a shorter, honest email rather than printing a blank.
function jobFacts(jobOrder) {
  const j = jobOrder || {};
  const place = [txt(j.city), txt(j.state)].filter(Boolean).join(', ') ||
                txt(j.location) || txt(j.country);
  const company = txt(j.client) || txt(j.company_name) ||
                  txt(j.company && j.company.name) || '';
  const skills = String(j.primary_skills || '')
    .split(/[,;|]+/).map(s => s.trim()).filter(Boolean).slice(0, 6);

  // PAY IS PRINTED ONLY IF IT IS ON THE JOB ORDER. A number we invented and
  // cannot honour loses a candidate permanently, and it is the single most
  // damaging thing this feature could get wrong — so the writer has no way to
  // produce one, and checkCandidateDraft refuses a draft that contains a
  // figure this function did not return.
  const min = money(j.pay_min), max = money(j.pay_max);
  const cur = txt(j.pay_cur) || 'USD';
  let pay = '';
  if (min && max) pay = `${cur} ${min}-${max}`;
  else if (min) pay = `${cur} ${min}+`;
  else if (max) pay = `up to ${cur} ${max}`;

  // ⚠ `remote` IS A YES/NO FIELD AND MUST NOT BE PRINTED RAW. It came out of
  // the first live batch as "It is Full-time and No." — the job order stores
  // "No", and pushing it into a list of terms made the email say it. A field
  // whose value is an ANSWER needs translating into the thing it answers.
  const terms = [];
  if (txt(j.job_type)) terms.push(txt(j.job_type));
  const rem = remoteTerm(j.remote);
  if (rem) terms.push(rem);
  if (txt(j.duration)) terms.push(txt(j.duration));

  return {
    id: j.id || null,
    title: txt(j.job_title),
    company, place, pay, terms, skills,
    // "USD 25-35" with no period is a shrug. There is no pay-type column on
    // job_orders, so this is inferred — but ONLY from a bound small enough to
    // be unambiguous: no full-time annual salary is a three-digit number, so
    // under 1000 is a rate and nothing else. Above that we say nothing rather
    // than guess, which is the same rule invented_pay enforces on the writer.
    payPeriod: payFigures(min, max).every(n => n > 0 && n < 1000) ? ' an hour' : '',
    payFigures: payFiguresIn(pay),
    description: txt(j.job_description),
    workAuth: txt(j.work_auth),
    clearance: txt(j.clearance),
  };
}

// "No" -> "on site", "Yes" -> "remote", "Hybrid" -> "hybrid". Anything we do
// not recognise is returned as typed (a recruiter writing "2 days in office"
// means it), and an empty value says nothing at all rather than guessing.
function remoteTerm(v) {
  const t = txt(v);
  if (!t) return '';
  const l = t.toLowerCase();
  if (/^(no|false|0|onsite|on-site|on site)$/.test(l)) return 'on site';
  if (/^(yes|true|1|remote|fully remote|100% remote)$/.test(l)) return 'remote';
  if (/^hybrid$/.test(l)) return 'hybrid';
  return t;
}

// "110000" -> "110,000". A bare six-digit run reads as a reference number
// rather than a salary, and the difference matters in the one sentence a
// candidate will look at hardest.
function money(v) {
  const raw = txt(v);
  if (!/^\d+$/.test(raw)) return raw;           // already formatted, or not a plain number
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Every number that legitimately appears in a pay string, so the checker can
// tell "the range from the job order" from "a number the model made up".
// The numeric bounds, for deciding whether a range is a rate or a salary.
function payFigures(min, max) {
  return [min, max].map(v => Number(String(v || '').replace(/[^\d.]/g, '')))
    .filter(n => Number.isFinite(n) && n > 0);
}

function payFiguresIn(pay) {
  return (String(pay || '').match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,.]/g, ''));
}

// ── WHY THIS PERSON ────────────────────────────────────────────────────────
// The match engine already produced these sentences ("Skills overlap: Procore,
// OSHA 30", "8 years experience fits the 5-10 asked for"). They are grounded in
// the candidate's own record, so turning them into a clause costs nothing and
// cannot hallucinate. This is the whole personalisation budget, and it is free.
// ⚠ THE MATCH ENGINE'S `reasons` ARE GRID SHORTHAND, NOT PROSE. They are
// written for a recruiter scanning a table — the real values are "3/4 skills",
// "title 100%", "diff state" — and the first live batch put one straight into an
// email: "I came to you because of your background in 3/4 skills". Read like a
// spreadsheet, because it was one.
//
// So the shared skills are computed HERE, from the two records, rather than
// parsed out of a display string. Same facts, still true by construction, and
// they can actually be named. `reasons` is now only consulted to know WHETHER
// there was an overlap at all.
function sharedSkills(candidate, job) {
  const f = jobFacts(job);
  const theirs = String((candidate || {}).skills || '')
    .split(/[,;|\n]+/).map(t => t.trim()).filter(Boolean);
  if (!f.skills.length || !theirs.length) return [];
  const out = [];
  for (const want of f.skills) {
    const w = want.toLowerCase();
    // A candidate listing "HVAC installation" matches a job asking for "hvac".
    // Substring either way, because neither field is a controlled vocabulary.
    const hit = theirs.find(t => {
      const l = t.toLowerCase();
      return l === w || l.includes(w) || w.includes(l);
    });
    // Print the CANDIDATE's spelling: it is their resume, and it is the one
    // that is capitalised properly more often than a hand-typed job field.
    if (hit) out.push(prettySkill(hit.length <= want.length ? hit : want));
  }
  return out.slice(0, 3);
}

function whyYouClause(reasons, candidate, job) {
  const c = candidate || {};
  const shared = job ? sharedSkills(c, job) : [];
  if (shared.length) return `your background in ${joinList(shared)}`;

  const yrs = Number(c.experience_years);
  if (Number.isFinite(yrs) && yrs > 0) {
    const title = txt(c.current_title);
    return title
      ? `your ${yrs} years as ${indefinite(title)}`
      : `your ${yrs} years in the field`;
  }
  if (txt(c.current_title)) return `your work as ${indefinite(txt(c.current_title))}`;
  // A matcher reason exists but names nothing we can print. Say the vague true
  // thing rather than the precise false one.
  if ((reasons || []).length) return 'what you are doing now';
  return '';
}

// A skills field is typed by hand and comes out as "hvac, epa, boilers".
// "The work centres on hvac, epa and boilers" reads as though nobody looked at
// it. An all-lowercase token of four characters or fewer in a skills list is
// an acronym essentially every time (hvac, epa, sql, aws, css); longer ones are
// ordinary words that are correct in lower case ("boilers", "commercial").
// Anything already carrying a capital is left exactly as the person typed it,
// so "Procore", "OSHA 30" and "AutoCAD" survive untouched.
function prettySkill(token) {
  const t = txt(token);
  if (!t || /[A-Z]/.test(t)) return t;
  return t.length <= 4 ? t.toUpperCase() : t;
}

// "a HVAC Service Technician" is what a vowel-LETTER test produces, and it is
// wrong — the article follows the SOUND, and "aitch" starts with one. It was in
// the first real draft this writer produced.
//
// A LIST, NOT A RULE, DELIBERATELY. The rule ("an all-caps run whose first
// letter-name begins with a vowel") fires on ALL-CAPS ENGLISH: a recruiter
// typing "SALES Manager" or "FIRE Marshal" would get "an SALES Manager", which
// is a new kind of wrong. Missing an acronym only reproduces today's reading,
// so the list is the safe direction to be incomplete in. These are the ones
// this app's own job orders actually carry.
const VOWEL_SOUND_ACRONYM = /^(?:HVAC|RN|LPN|LVN|CNA|MRI|MEP|EPA|EHS|HSE|NDT|HR|IT|SQL|ETL|API|SEO|XML|FAA|OSHA|LNG|RF)\b/;
function indefinite(word) {
  const w = txt(word);
  if (!w) return w;
  const vowelSound = /^[aeiou]/i.test(w) || VOWEL_SOUND_ACRONYM.test(w);
  return (vowelSound ? 'an ' : 'a ') + w;
}

// ── THE JOB DESCRIPTION, AS A PANEL ────────────────────────────────────────
// The owner, 2026-09-10 (DECISIONS.md D-0012): "remove the job description
// sending thing and attach the job description in a formatted window format
// when asking the candidates about their interest to jobs." PACE had two ways
// to email a candidate about a job; the other one could attach the JD as a file
// and is being removed, so this email has to carry it. **No attachments** —
// asked and answered; the block is the whole of it.
//
// FOUR RULES, AND THE FIRST IS WHY THIS IS SHAPED THE WAY IT IS:
//
// 1. THE PLAIN TEXT IS THE ORIGINAL; THE CARD IS A RENDERING OF IT. The panel
//    is written into the STORED body as a fenced text block, and the HTML card
//    is built by reading that text back (`jobBlockHtmlFromText`). So the card
//    cannot carry a fact the text does not, a text-only client loses only the
//    border, and the drain — which holds the stored row and not the job order —
//    needs no second query and cannot disagree with the preview. One renderer,
//    fed from the thing that was actually stored: the same reasoning as
//    `briefFor()` in the router, taken one step further.
//
// 2. A FIELD THAT IS ABSENT IS NOT A ROW. No dash, no "Not specified", no empty
//    cell. A job order is filled in by hand and usually half-empty; a panel of
//    blanks reads as a broken system. A panel that would carry nothing but the
//    title is not printed at all — the subject line already says that much.
//
// 3. IT IS A FACT PANEL, NOT A SECOND PITCH. The prose above it persuades and
//    `checkCandidateDraft` governs that prose. Every row here is a field off the
//    job order, cleaned by the helpers the prose already uses: `remoteTerm` (a
//    `remote` of "No" once shipped as "It is Full-time and No."), `prettySkill`
//    (skills arrive hand-typed and lowercase), the sub-1000 pay-period rule.
//    **Nothing in the panel is written by a model** — which is also why
//    `checkCandidateDraft` does not police it for tone: the description is the
//    client's own words, quoted, not our prose.
//
// 4. IT IS THE LAST THING IN THE BODY, after the sign-off, because
//    `buildHtmlEmailBody(text, extraHtml)` can only append markup AFTER the
//    text. Putting the block anywhere else would render in one order as text
//    and another as HTML, and a preview that disagrees with the outbox is the
//    one failure a preview exists to prevent.
const BLOCK_FENCE = '------------------------------------------';
const BLOCK_MAX_CHARS = 1200;   // ~200 words. The removed flow sent 1,600 raw.
const BLOCK_MAX_LINES = 12;

// Tolerant on purpose: we only ever parse text this file wrote, and a fence
// whose length changes one day must not orphan every queued row.
const isFenceLine = (line) => /^-{10,}$/.test(String(line || '').trim());

const oneLine = (v) => txt(v).replace(/\s+/g, ' ');

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&(?:#39|apos|rsquo|lsquo);/gi, "'")
    .replace(/&(?:rdquo|ldquo);/gi, '"').replace(/&(?:ndash|mdash);/gi, '-')
    .replace(/&bull;/gi, '•')
    .replace(/&#(\d{2,5});/g, (m, n) => {
      const c = Number(n);
      return (c >= 32 && c <= 0x2122) ? String.fromCharCode(c) : ' ';
    })
    // &amp; LAST, or "&amp;lt;" decodes twice and turns into a tag.
    .replace(/&amp;/gi, '&');
}

// The description as a candidate would read it: tags gone, bullets normalised,
// blank runs collapsed, length capped on a boundary that is never mid-word.
//
// ⚠ A LINE OF DASHES IS DROPPED, AND THAT IS WHAT MAKES THE FENCE SAFE. A
// pasted job description very often carries its own rule of dashes; one of
// those inside the block would look exactly like the fence and split the email
// in the wrong place. Dropping every punctuation-only line closes that for good
// — and such a line carries no fact, so nothing is lost.
// ⚠ AND AN "APPLY HERE" LINE IS DROPPED. It is the one thing in a posting
// that is not a fact about the role: it is an instruction that contradicts the
// email carrying it. Our email asks the candidate to answer US; a link handing
// them straight to the client's own form loses the candidate, the submission
// and the fee, and the client gets a duplicate applicant nobody asked for. The
// test is deliberately narrow — an apply/submit/send verb AND a link in the same
// line — because a bare URL in a posting is often a certification or a careers
// page, and cutting sentences out of a quoted description is its own way of
// misquoting it.
const APPLY_INSTRUCTION = /\b(?:appl(?:y|ication)|submit|send|e-?mail|resume|cv)\b[\s\S]*?(?:https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[a-z]{2,})/i;

function cleanDescription(raw) {
  let s = String(raw || '');
  if (!s.trim()) return [];
  // A block-level tag is a line break in both directions — an OPENING <p> after
  // a horizontal rule is what glued "---------------- Pay up to $3,200" onto one
  // line, where the all-punctuation test could no longer see the rule. </li> is
  // dropped rather than broken, because <li> already starts the line and doing
  // both put a blank line between every bullet.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n')
       .replace(/<\s*\/\s*li\s*>/gi, ' ')
       .replace(/<\s*li[^>]*>/gi, '\n• ')
       .replace(/<\s*\/?\s*(?:p|div|tr|h[1-6]|ul|ol|hr|table|section)[^>]*>/gi, '\n')
       .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  const out = [];
  const blank = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };
  for (const rawLine of s.split(/\r?\n/)) {
    let line = rawLine.replace(/[ \t\u00a0]+/g, ' ').trim();
    // A rule of dashes left wrapped around a real heading: "----- Benefits -----".
    line = line.replace(/^[-_=*~]{3,}\s*/, '').replace(/\s*[-_=*~]{3,}$/, '').trim();
    if (!line || /^[-_=*~#.•·‣▪●\s]+$/.test(line)) { blank(); continue; }
    // SENTENCE by sentence, not line by line. "Pay up to $3,200 per week and
    // full benefits. Apply at https://…" is one line carrying a real fact and
    // an instruction we must not pass on; dropping the line loses the rate.
    if (APPLY_INSTRUCTION.test(line)) {
      line = line.split(/(?<=[.!?])\s+/).filter(s => !APPLY_INSTRUCTION.test(s)).join(' ').trim();
      if (!line) { blank(); continue; }
    }
    out.push(line.replace(/^(?:[-*•·‣▪●]|\d{1,2}[.)])\s+/, '• '));
  }
  // A blank line between two bullets is noise a pasted list brings with it.
  for (let i = out.length - 2; i > 0; i--) {
    if (out[i] === '' && /^•/.test(out[i - 1] || '') && /^•/.test(out[i + 1] || '')) out.splice(i, 1);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return capLines(out);
}

function capLines(lines) {
  const out = [];
  let used = 0, kept = 0, dropped = false;
  for (const line of lines) {
    if (line === '') { if (out.length) out.push(''); continue; }
    if (kept >= BLOCK_MAX_LINES) { dropped = true; break; }
    const room = BLOCK_MAX_CHARS - used;
    if (room < 40) { dropped = true; break; }
    if (line.length > room) {
      const cut = cutAt(line, room);
      if (cut) { out.push(cut); kept++; }
      dropped = true; break;
    }
    out.push(line); used += line.length + 1; kept++;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  // Say that it was cut. A panel that stops mid-thought with no mark reads as
  // a fault, and a candidate should know there is more to ask about.
  if (dropped && out.length) {
    const i = out.length - 1;
    if (!/…$/.test(out[i])) out[i] = out[i].replace(/[,;:]$/, '') + ' …';
  }
  return out;
}

// Cut a long paragraph at the end of a sentence when one is close enough,
// otherwise at a word boundary. Never mid-word — a half word reads as
// corruption, and this app has already shipped one diagnosis that sounded more
// certain than its evidence.
function cutAt(line, room) {
  const slice = String(line).slice(0, Math.max(0, room));
  const sentence = slice.match(/^[\s\S]*[.!?](?=\s|$)/);
  if (sentence && sentence[0].length > room * 0.5) return sentence[0].trim();
  const sp = slice.lastIndexOf(' ');
  return (sp > 20 ? slice.slice(0, sp) : slice).trim();
}

// "5-10 years" off exp_min/exp_max. A stored 0 is "not filled in", not a
// requirement of zero years.
function expRange(job) {
  const n = (v) => { const x = txt(v).replace(/[^\d.]/g, ''); return Number(x) > 0 ? x : ''; };
  const lo = n((job || {}).exp_min), hi = n((job || {}).exp_max);
  if (lo && hi) return lo === hi ? `${lo} years` : `${lo}-${hi} years`;
  if (lo) return `${lo}+ years`;
  if (hi) return `up to ${hi} years`;
  return '';
}

// A FILLED-IN FIELD THAT MEANS "NOTHING TO SAY" IS STILL NOTHING TO SAY.
// `clearance: "None"` is the common one — a real value, entered on purpose, and
// "Clearance: None" in a panel a candidate reads is a form dump rather than a
// fact. Absent and "none" get the same treatment: no row.
const EMPTY_ANSWERS = /^(?:none|no|n\/?a|not required|not applicable|nil|any|all|-+|tbd|to be determined)$/i;

// The rows, in the order a candidate reads them: who, where, what shape, what
// it pays, then what it asks for. Absent fields are simply not here.
function jobBlockRows(job) {
  const f = jobFacts(job);
  const rows = [];
  const add = (label, value) => {
    const v = oneLine(value);
    if (v && !EMPTY_ANSWERS.test(v)) rows.push({ label, value: v });
  };
  add('Company', f.company);
  add('Location', f.place);
  add('Employment', f.terms.join(', '));
  add('Pay', f.pay ? f.pay + f.payPeriod : '');
  add('Experience', expRange(job));
  add('Skills', f.skills.map(prettySkill).join(', '));
  add('Work authorisation', f.workAuth);
  add('Clearance', f.clearance);
  return rows;
}

/**
 * The panel for one job order, or null when there is nothing to panel.
 * `text` is canonical and `html` is derived from it — never the other way
 * round, and never two separate builders (rule 1 above).
 */
function jobBlock(job) {
  if (!job) return null;
  const title = oneLine(jobFacts(job).title);
  if (!title) return null;
  const rows = jobBlockRows(job);
  const body = cleanDescription(jobFacts(job).description);
  if (!rows.length && !body.length) return null;
  const lines = [title, ...rows.map(r => r.label + ': ' + r.value)];
  if (body.length) lines.push('', ...body);
  const text = BLOCK_FENCE + '\n' + lines.join('\n') + '\n' + BLOCK_FENCE;
  return { title, rows, body, text, html: jobBlockHtmlFromText(text) };
}

/**
 * Take a stored body apart: our prose, and the panel. Both the preview and the
 * send path call this — the panel is HTML in a mail client and text everywhere
 * else, and the checker reads only the prose.
 * A body with no panel comes back unchanged, so every existing caller and every
 * hand-written draft behaves exactly as before.
 */
function splitJobBlock(body) {
  const s = String(body == null ? '' : body);
  const lines = s.split('\n');
  let first = -1, last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isFenceLine(lines[i])) { if (first < 0) first = i; last = i; }
  }
  if (first < 0 || last <= first) return { prose: s, block: '' };
  const prose = lines.slice(0, first).join('\n').replace(/\s+$/, '');
  const block = lines.slice(first, last + 1).join('\n');
  // Nothing should follow the closing fence, but text is never dropped on the
  // floor just because it turned up in an unexpected place.
  const after = lines.slice(last + 1).join('\n').trim();
  return { prose: after ? prose + '\n\n' + after : prose, block };
}

function parseJobBlockText(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => !isFenceLine(l));
  while (lines.length && lines[0] === '') lines.shift();
  if (!lines.length) return null;
  const title = lines.shift();
  const rows = [];
  let i = 0;
  for (; i < lines.length; i++) {
    if (lines[i] === '') { i++; break; }
    const m = lines[i].match(/^([A-Z][A-Za-z ]{1,24}):\s+(.+)$/);
    if (!m) break;
    rows.push({ label: m[1], value: m[2] });
  }
  const body = lines.slice(i);
  while (body.length && body[0] === '') body.shift();
  while (body.length && body[body.length - 1] === '') body.pop();
  return { title, rows, body };
}

/**
 * The bordered card, built from the block's own text. Tables and inline styles
 * because this is EMAIL: Outlook has no flexbox, no grid, and strips a <style>
 * block — the same constraint `answerButtonsHtml` is written to, and the reason
 * there is not a single `class=` in here.
 * Every word it prints comes out of the text; it adds no label of its own.
 */
function jobBlockHtmlFromText(text) {
  const p = parseJobBlockText(text);
  if (!p) return '';
  const FONT = 'font-family:Arial,sans-serif';
  const lbl = FONT + ';font-size:12.5px;color:#475569;padding:0 14px 5px 0;white-space:nowrap;vertical-align:top';
  const val = FONT + ';font-size:13.5px;color:#0F172A;padding:0 0 5px;vertical-align:top';
  const rows = p.rows.map(r =>
    '<tr><td style="' + lbl + '">' + escapeHtml(r.label) + '</td>' +
    '<td style="' + val + '">' + escapeHtml(r.value) + '</td></tr>').join('');
  const para = p.body.filter(Boolean).map(line =>
    '<div style="' + FONT + ';font-size:13.5px;line-height:1.55;color:#0F172A;margin:6px 0 0' +
      (/^•/.test(line) ? ';padding-left:14px;text-indent:-14px' : '') + '">' +
      escapeHtml(line) + '</div>').join('');
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
      'style="margin:18px 0 4px;border:1px solid #CBD5E1;border-radius:8px;background-color:#F8FAFC">' +
      '<tr><td style="padding:15px 18px">' +
        '<div style="' + FONT + ';font-size:16px;font-weight:bold;line-height:1.3;color:#0F172A;margin:0 0 11px">' +
          escapeHtml(p.title) + '</div>' +
        (rows ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' + rows + '</table>' : '') +
        (para
          ? (rows ? '<div style="border-top:1px solid #E2E8F0;margin:13px 0 2px"></div>' : '') + para
          : '') +
      '</td></tr></table>';
}

// ── THE ANGLES ─────────────────────────────────────────────────────────────
// Same lesson the client generator learned the hard way: without an explicit
// `never`, every angle converges on the strongest available material and the
// picker becomes four paraphrases of one email. Each one here is allowed to do
// something the others may not.
const ANGLE_BRIEF = {
  direct: {
    label: 'Direct',
    blurb: 'The role, why you thought of them, and the question.',
    words: [75, 130],
    must: 'Name the role and where it is, say in one clause why this person specifically came to mind, give the terms that are actually known, and end on the yes/no question.',
    never: 'Do NOT open with pay. Do NOT list every requirement in the posting. Do NOT describe the client company at length.',
  },
  short: {
    label: 'Short',
    blurb: 'Three sentences, for someone who will not read more.',
    words: [35, 75],
    must: 'Three sentences after the greeting, at most. The role, one clause on why them, the question. Nothing else earns its place.',
    never: 'Do NOT explain the company, the terms, the process or the market. Do NOT name more than one credential.',
  },
  specifics: {
    label: 'The terms',
    blurb: 'Leads on pay, location and shape — when those are the draw.',
    words: [70, 120],
    must: 'Lead with what is concretely on offer — pay, location, contract shape, start — because for this role the terms are the reason to read on. Only state terms that are actually given.',
    never: 'Do NOT invent, round, or estimate a pay figure, a start date or a duration. If the pay is not given, do not imply one exists.',
  },
  nurture: {
    label: 'Keeping in touch',
    blurb: 'No specific job — are they open at all?',
    words: [45, 90],
    must: 'Ask whether they are open to hearing about roles at the moment, and make saying "not right now" easy and consequence-free.',
    never: 'Do NOT mention a specific job, client, title, location or pay — there is no job attached to this email, and a job variable printed empty is worse than one omitted.',
  },
};

function angleBrief(id) { return ANGLE_BRIEF[id] || null; }

// ── THE JOB BRIEF ──────────────────────────────────────────────────────────
// Two or three sentences about the role that read like a person describing it,
// written ONCE per job order. The rules version below is what production
// actually runs on when no AI provider is configured — it is the product, not a
// degraded mode, exactly as on the client side.
function rulesJobBrief(job) {
  const f = jobFacts(job);
  const bits = [];
  if (f.title) {
    const at = f.company ? ` with ${f.company}` : '';
    const at2 = f.place ? ` in ${f.place}` : '';
    bits.push(`They are hiring ${indefinite(f.title)}${at}${at2}.`);
  }
  // THE TERMS ARE NOT IN THE BRIEF. `termsLine` prints them, and a brief that
  // also carried them produced "It is Full-time." twice in the same email —
  // caught the first time this writer was run against a real job order.
  return {
    hook: bits.join(' ') || 'A role has come up that may be worth a look.',
    // THROUGH `prettySkill`, NOT RAW. A hand-typed skills field arrives
    // lowercase, and "The work centres on hvac, epa and boilers" is the exact
    // sentence that cleaner was written for — it was applied to the why-you
    // clause and missed here, so the defect was still live in the brief every
    // candidate reads.
    detail: f.skills.length
      ? `The work centres on ${joinList(f.skills.slice(0, 3).map(prettySkill))}.` : '',
    engine: 'rules',
  };
}

function buildBriefSystemPrompt() {
  return [
    'You are helping a recruiter describe one open role to candidates who might want it.',
    'You are given a job order from the recruiter\'s own database. You produce a SHORT description of the role, written to be read by a candidate, not by a client.',
    '',
    'RULES:',
    '1. Two or three plain sentences. This text is dropped into an email that already has a greeting and a sign-off, so write only the middle.',
    '2. Say what the work actually is. A candidate decides on the work, not on adjectives.',
    '3. Use ONLY facts present in the job order. Never invent a pay figure, a start date, a duration, a benefit, a team size or a company detail. If pay is not given, do not mention pay at all.',
    '4. No marketing language (exciting, dynamic, fast-paced, passionate, rockstar, world-class), no exclamation marks, no emoji.',
    '5. Do not greet, do not sign off, do not address the reader by name — that is the surrounding email\'s job.',
    '6. Do not promise anything on the employer\'s behalf: no "great culture", no "excellent benefits", no "room to grow" unless the job order says so in those terms.',
    '7. If the job order is thin, write less. Two honest sentences beat four padded ones.',
    '',
    'Return ONLY valid JSON, no markdown fences, in exactly this shape:',
    '{"hook": "the first sentence or two — what the role is", "detail": "one further sentence of substance, or an empty string if there is nothing real to add"}',
  ].join('\n');
}

function buildBriefPayload(job) {
  const f = jobFacts(job);
  const lines = [];
  lines.push('JOB TITLE: ' + (f.title || '(not given)'));
  lines.push('CLIENT: ' + (f.company || '(not given)'));
  lines.push('LOCATION: ' + (f.place || '(not given)'));
  lines.push('PAY: ' + (f.pay || '(not given — do not mention pay)'));
  lines.push('SHAPE: ' + (f.terms.length ? f.terms.join(', ') : '(not given)'));
  lines.push('SKILLS ON THE ORDER: ' + (f.skills.length ? f.skills.join(', ') : '(not given)'));
  if (f.workAuth) lines.push('WORK AUTHORISATION: ' + f.workAuth);
  if (f.clearance) lines.push('CLEARANCE: ' + f.clearance);
  lines.push('');
  lines.push('JOB DESCRIPTION:');
  lines.push(f.description || '(none on the order — write from the fields above only)');
  return lines.join('\n');
}

function parseBrief(text) {
  const raw = String(text || '').replace(/```json|```/g, '').trim();
  if (!raw) return null;
  const tries = [raw];
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(raw.slice(a, b + 1));
  for (const t of tries) {
    try {
      const p = JSON.parse(t);
      if (p && txt(p.hook)) return { hook: txt(p.hook), detail: txt(p.detail), engine: 'ai' };
    } catch (_) { /* try the next shape */ }
  }
  return null;
}

// A brief is written by a model and then read by every candidate on the job, so
// it is checked once, here, rather than 25 times downstream.
function checkBrief(brief, job) {
  const b = brief || {};
  const f = jobFacts(job);
  const body = [txt(b.hook), txt(b.detail)].filter(Boolean).join(' ');
  const v = [];
  const add = (code, instruction) => v.push({ code, instruction });

  if (!txt(b.hook)) { add('empty', 'Return the role description in the "hook" field.'); return { ok: false, violations: v }; }
  if (/!/.test(body)) add('exclamation', 'Remove every exclamation mark.');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(body)) add('emoji', 'Remove the emoji.');
  const mk = body.match(MARKETING_WORDS);
  if (mk) add('marketing_word', `Remove "${mk[0]}" and any other marketing adjective. Describe the work instead.`);
  if (/\{\{/.test(body)) add('placeholder', 'Remove the {{...}} placeholder and write the real word.');
  const money = unsupportedMoney(body, f.payFigures);
  if (money) add('invented_pay', `The job order does not carry the figure ${money}. Remove every pay number that is not on the order.`);
  if (wordCount(body) > 90) add('too_long', `Two or three sentences. Yours is ${wordCount(body)} words — cut it.`);
  if (/\b(hi|hello|dear)\b[\s,]/i.test(body.slice(0, 12))) add('greeting', 'Do not greet the reader — the surrounding email already does.');

  return { ok: v.length === 0, violations: v };
}

// ── THE EMAIL ──────────────────────────────────────────────────────────────
// One candidate, one job, one angle. The sender's name is a TOKEN, not a value:
// see the header note. `signOff` mirrors the client generator — "Thanks," alone
// when a mailbox signature will be appended, a full close when none will.
function draftParts(input, options) {
  const i = input || {};
  const o = options || {};
  const c = i.candidate || {};
  const f = jobFacts(i.job);
  const brief = i.brief || (i.job ? rulesJobBrief(i.job) : { hook: '', detail: '' });
  const block = (i.outreach_type === 'nurture' || !i.job) ? null : jobBlock(i.job);

  return {
    first: firstNameOf(c.full_name || c.first_name),
    co: txt(o.companyName) || 'our team',
    job: f,
    hook: txt(brief.hook),
    detail: txt(brief.detail),
    why: whyYouClause(i.reasons, c, i.job),
    roleLabel: f.title || 'a role',
    at: f.company ? ` with ${f.company}` : '',
    inPlace: f.place ? ` in ${f.place}` : '',
    payLine: f.pay ? `The range on it is ${f.pay}${f.payPeriod}.` : '',
    termsLine: f.terms.length ? `It is ${joinList(f.terms)}.` : '',
    // The opt-out. With the buttons underneath, "just say so" is redundant and
    // slightly contradicts them, so the sentence gets out of their way and
    // points at them instead. Without them it carries the opt-out alone. Either
    // way it is NOT optional — a mass email to candidates with no way out is
    // not one we should be sending.
    outLine: o.hasButtons
      ? 'If the timing is not right, just tap "Not for me" and I will leave it there.'
      : 'If the timing is not right, just say so and I will leave it there.',
    signOff: o.omitSignOff
      ? '\n\nThanks,'
      : '\n\n' + ['Thanks,', SENDER_TOKEN].join('\n'),
    // The job description panel, appended by `assemble` after the sign-off so
    // the text and the HTML card appear in the SAME order (see rule 4 above).
    // Empty when there is no job, when the job order has nothing to panel, and
    // on the nurture angle — whose entire rule is that it names no job, so a
    // panel there would be the worst possible contradiction of it.
    blockText: block ? '\n\n' + block.text : '',
    hasBlock: !!block,
  };
}

function joinList(items) {
  const a = (items || []).map(txt).filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

// TWO KINDS OF NOTHING, AND CONFLATING THEM COST THE PARAGRAPHS.
//   null  = "this line does not apply" (no why-clause, no pay on the order) — drop it
//   ''    = a deliberate blank line between paragraphs — KEEP it
// Filtering out '' as well collapsed every email to single-spaced sentences,
// which is only visible in a screenshot, never in a word count or a check.
function assemble(p, paras) {
  return paras.filter(x => x !== null && x !== undefined).join('\n') + p.signOff + p.blockText;
}

// What `checkCandidateDraft` and the word bands read: our own writing, with the
// quoted job-order panel taken off the end.
const proseOf = (email) => splitJobBlock(email).prose;

const VARIANTS = [
  {
    id: 'direct',
    subject: (p) => p.job.title + (p.job.place ? ' — ' + p.job.place : ''),
    build: (p) => assemble(p, [
      'Hi ' + p.first + ',', '',
      'This is ' + SENDER_TOKEN + ' at ' + p.co + '. ' + p.hook,
      p.detail || null,
      '',
      (p.why
        ? 'I came to you because of ' + p.why + ', which lines up with what they are asking for.'
        : 'Your profile lines up with what they are asking for.'),
      // ⚠ THE PANEL OWNS THE TERMS ON THIS ANGLE. "The range on it is USD
      // 110,000-130,000. It is Full-time." directly above a panel whose rows
      // read Pay and Employment is the same fact printed twice in one email —
      // the defect that produced "It is Full-time." twice the first time this
      // writer met a real job order. `specifics` keeps the sentence, because
      // there the terms ARE the argument rather than a tabulation.
      (p.hasBlock ? null : ([p.payLine, p.termsLine].filter(Boolean).join(' ') || null)),
      '',
      'Would you be interested in hearing more about it?',
      p.outLine,
    ]),
  },
  {
    id: 'short',
    subject: (p) => p.job.title + ' — worth a look?',
    build: (p) => assemble(p, [
      'Hi ' + p.first + ',', '',
      'This is ' + SENDER_TOKEN + ' at ' + p.co + '. There is ' + indefinite(p.roleLabel) +
        ' open' + p.at + p.inPlace + '.',
      (p.why ? 'It came to mind because of ' + p.why + '.' : null),
      '',
      // THE RULES WRITER MUST NEVER FAIL checkCandidateDraft. The first version
      // of this angle had no way out and the checker rejected our own text —
      // which would have meant the shortest angle silently never shipping. An
      // opt-out is mandatory on every angle, so the short one gets a short one.
      'Interested in hearing more? If not, just say so.',
    ]),
  },
  {
    id: 'specifics',
    subject: (p) => p.job.title + (p.job.pay ? ' — ' + p.job.pay : (p.job.place ? ' — ' + p.job.place : '')),
    build: (p) => assemble(p, [
      'Hi ' + p.first + ',', '',
      'This is ' + SENDER_TOKEN + ' at ' + p.co + '. Quick one on ' + indefinite(p.roleLabel) +
        p.at + p.inPlace + '.',
      '',
      [p.payLine, p.termsLine].filter(Boolean).join(' ') ||
        'The terms are still being confirmed, and I will send them across as soon as I have them.',
      // The DETAIL (what the work is), never the hook — this angle's own opener
      // already named the role, the client and the place, and repeating the
      // hook printed all three twice.
      p.detail || null,
      '',
      (p.why ? 'You came to mind because of ' + p.why + '.' : null),
      'Interested?',
      p.outLine,
    ]),
  },
];

// No job attached. Every job variable would render empty, so this is a
// different email rather than the same one with blanks — the same reasoning
// behind DEFAULT_CANDIDATE_NURTURE_EMAIL in routes/recruiting/outreach.js.
const NURTURE_VARIANT = {
  id: 'nurture',
  subject: () => 'Keeping in touch',
  build: (p) => assemble(p, [
    'Hi ' + p.first + ',', '',
    'This is ' + SENDER_TOKEN + ' at ' + p.co + '. Checking in to see how things are going. Are you open to hearing about new roles at the moment?',
    '',
    'If the timing is not right, just say so and I will leave it a while.',
  ]),
};

function rulesVariants(input, options) {
  const i = input || {};
  const p = draftParts(i, options);
  const set = (i.outreach_type === 'nurture' || !i.job) ? [NURTURE_VARIANT] : VARIANTS;
  return set.map(v => {
    const email = v.build(p);
    const brief = ANGLE_BRIEF[v.id] || {};
    return {
      id: v.id, label: brief.label || v.id, blurb: brief.blurb || '',
      subject: v.subject(p), email,
      // OUR words, not the quoted panel's. The bands exist to keep the four
      // angles from converging; an identical job description appended to all of
      // them would flatten the difference and make every angle read "too long".
      words: wordCount(proseOf(email)), mode: 'rules',
    };
  });
}

/** What the caller must supply before anything can be written. */
function validateInput(input) {
  const i = input || {};
  const c = i.candidate || {};
  const missing = [];
  if (!txt(c.full_name) && !txt(c.first_name)) missing.push('candidate name');
  if (!txt(c.email)) missing.push('candidate email');
  if (i.outreach_type !== 'nurture') {
    if (!i.job) missing.push('job');
    else if (!txt((i.job || {}).job_title)) missing.push('job title');
  }
  return { ok: missing.length === 0, missing };
}

// ── THE HOUSE-STYLE CHECK ──────────────────────────────────────────────────
// A prompt rule is a request; this is the guarantee. Mechanical only — it never
// scores prose. A dull email passes; one that invents a salary, claims
// experience the candidate does not have, or leaves a stray {{token}} does not.
//
// The rules for a CANDIDATE email are not the client rules with the names
// swapped. Fee language is right on a client email and wrong here. An opt-out
// is optional there and mandatory here. And the two facts a candidate cannot
// answer without — what the job is and where it is — must be present.
const MARKETING_WORDS = /\b(exciting|passionate|dynamic|exceptional|fast[- ]paced|cutting[- ]edge|seamless|world[- ]class|rock ?star|synergy|best[- ]in[- ]class|unparalleled|game[- ]chang\w+|once[- ]in[- ]a[- ]lifetime)\b/i;
const FEE_WORDS = /\b(placement fee|our fee|commission|contingency|no charge for reviewing|retainer)\b/i;
const OPT_OUT = /\b(not right|no(?:t)? interested|say so|not the right time|timing is not|leave it|unsubscribe|opt out|let me know and I(?:'| wi)ll)\b/i;

// "your 9 years", "you have 12 years", "with your 8+ years" — a statement about
// the READER's career. Deliberately NOT "the role asks for 2-3 years", which is
// a statement about the job and is exactly what broke the first live batch.
const YEARS_ABOUT_READER = /\b(?:your|you(?:'ve| have| bring)?)\s+(?:[a-z]+\s+){0,2}?(\d{1,2})\+?\s*years?\b/i;

function sentencesOf(body) {
  return String(body || '').split(/(?<=[.?!])\s+|\n+/).map(t => t.trim()).filter(Boolean);
}

// Any money-shaped figure in the text that the job order does not carry. Bare
// years ("8 years") are not money and are handled separately.
//
// FOUR SHAPES, AND MISSING ONE MAKES THE WHOLE CHECK DECORATIVE. The first
// version only looked for a symbol prefix or a number FOLLOWED by a currency
// code — so "USD 200,000", the exact shape jobFacts() itself emits, sailed
// straight through. A checker with a hole in it is worse than none, because it
// reports a clean draft.
const MONEY_SHAPES = [
  // $120,000 · £95k · ₹18,00,000
  /[$£€₹]\s?\d[\d,.]*(?:\s?[kKmM])?/g,
  // USD 110,000  ·  110,000 USD
  /\b(?:USD|INR|EUR|GBP|CAD|AUD)\s?\d[\d,.]*(?:\s?[kKmM])?/gi,
  /\b\d[\d,.]*(?:\s?[kKmM])?\s?(?:USD|INR|EUR|GBP|CAD|AUD)\b/gi,
  // 65 per hour · 120,000 a year
  /\b\d[\d,.]*\s?(?:per|an?)\s?(?:hour|hr|year|yr|annum|month)\b/gi,
  // A bare figure that can only be money: comma-grouped, or five digits and up.
  // Deliberately NOT any bare number — "OSHA 30" and "9 years" must pass, and
  // they do, because both are under the threshold and carry no separator.
  /\b\d{1,3}(?:,\d{3})+\b|\b\d{5,}\b/g,
];

function unsupportedMoney(email, allowed) {
  const ok = new Set(allowed || []);
  const text = String(email || '');
  for (const re of MONEY_SHAPES) {
    re.lastIndex = 0;
    const found = text.match(re) || [];
    for (const f of found) {
      const n = (f.match(/\d[\d,.]*/) || [''])[0].replace(/[,.]/g, '');
      if (!ok.has(n)) return f.trim();
    }
  }
  return null;
}

function checkCandidateDraft(draft, input, opts) {
  const d = draft || {};
  const i = input || {};
  const o = opts || {};
  const c = i.candidate || {};
  const f = jobFacts(i.job);
  const full = txt(d.email);
  // ── WHAT THIS CHECKER IS FOR, AND WHAT IT IS NOT FOR ─────────────────────
  // Everything below reads `email`, which is the PROSE — the job-description
  // panel is taken off the end first. That split is the whole reason the panel
  // is safe to add:
  //   • the panel is a projection of the job_orders row, not a piece of
  //     writing. Nobody invented it, so `invented_pay` has nothing to say about
  //     it, and the client's own posting is allowed to contain a figure, an
  //     exclamation mark or the word "exciting" without killing a batch.
  //   • `invented_experience` read the JOB's stated requirement as a claim
  //     about the reader once already and silently skipped three of four real
  //     candidates. A quoted posting is full of those sentences.
  //   • the word bands police OUR four angles. An identical panel appended to
  //     every one of them would make all four "too long" at once.
  // Three rules still read the whole thing, named at their own call sites
  // below: a leaked {{token}} anywhere is a bug, and the role and the location
  // count as present wherever the candidate can see them.
  const email = proseOf(full);
  const subject = txt(d.subject);
  const v = [];
  const add = (code, instruction) => v.push({ code, instruction });

  if (!email) { add('empty', 'Return the full email body in the "email" field.'); return { ok: false, violations: v }; }

  // {{sender}} AND {{senderemail}} ARE LEGAL HERE AND NOWHERE ELSE IS. The
  // client generator sends immediately and so rejects every {{, but these
  // emails are queued and the sender is resolved at send time — the tokens are
  // load-bearing. Strip exactly those two, then anything still wrapped in
  // braces is a template leak that a candidate would read verbatim.
  // WHOLE EMAIL, PANEL INCLUDED: a {{token}} reaching a candidate is read
  // verbatim, and an imported job description can carry one.
  const residue = full.replace(SENDER_TOKENS, '') + ' ' + subject.replace(SENDER_TOKENS, '');
  if (/\{\{/.test(residue)) {
    add('placeholder', 'Remove the {{...}} placeholder and write the real word. Only {{sender}} and {{senderemail}} may remain.' +
      (/\{\{/.test(splitJobBlock(full).block) ? ' It is in the job description on the job order, not in the email.' : ''));
  }

  const angle = o.angle && ANGLE_BRIEF[o.angle] ? ANGLE_BRIEF[o.angle] : null;
  const words = wordCount(email);
  if (angle) {
    if (words > angle.words[1] + 25) {
      add('too_long', `The "${angle.label}" angle should run ${angle.words[0]}-${angle.words[1]} words. Yours is ${words}. Cut it back.`);
    } else if (words < angle.words[0] - 15 && materialIn(i) >= 3) {
      // A MINIMUM LENGTH IS AN INSTRUCTION TO INVENT WHEN THERE ARE NO FACTS.
      // The lower bound exists to stop a model being lazy with a rich job
      // order — not to demand four sentences about a job order carrying only a
      // title. Enforcing it on thin input would push the writer towards exactly
      // what invented_pay and invented_experience are here to prevent, and it
      // rejected this file's own rules drafts the first time it ran.
      add('too_short', `The "${angle.label}" angle should run ${angle.words[0]}-${angle.words[1]} words. Yours is ${words} — there is not enough there to answer.`);
    }
  }

  if (/!/.test(email)) add('exclamation', 'Remove every exclamation mark. Plain sentences only.');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(email)) add('emoji', 'Remove the emoji.');
  const mk = email.match(MARKETING_WORDS);
  if (mk) add('marketing_word', `Remove the word "${mk[0]}" and any other marketing adjective. Describe the work instead.`);

  // Fee talk is the CLIENT email's vocabulary. Said to a candidate it reads as
  // "you are the product", which is the fastest way to lose one.
  const fee = email.match(FEE_WORDS);
  if (fee) add('fee_language', `Remove "${fee[0]}". Fees are between us and the client and have no place in a candidate email.`);

  // THE ONE THAT MATTERS MOST. A pay figure we invented and cannot honour is
  // not a style problem — the candidate finds out at offer stage and we lose
  // them and their referrals.
  const money = unsupportedMoney(email, f.payFigures);
  if (money) {
    add('invented_pay', f.pay
      ? `The job order says ${f.pay}. Remove "${money}" — quote the range on the order or no figure at all.`
      : `The job order carries no pay information, so remove "${money}" entirely. Never imply a figure we have not been given.`);
  }

  // Claimed experience must match the record — but ONLY where the sentence is
  // about THEM.
  //
  // ⚠ THE JOB'S OWN REQUIREMENT IS NOT A CLAIM ABOUT THE READER. The first
  // version matched any "N years" anywhere in the email, and the first real
  // batch proved how wrong that is: the AI job brief said "2-3 years of field
  // experience", which is a fact about the VACANCY, and the check read it as a
  // statement about the person. Three of four candidates were silently skipped
  // — an 11-year, a 35-year and a 15-year technician — and the one that got
  // through only did so because his 4 years happened to sit within 1 of 3.
  //
  // The rule this check exists to enforce is "never tell someone about their
  // own career". Only a SECOND-PERSON attribution does that, so only that is
  // checked. "The role asks for 2-3 years" is the job talking, and is fine.
  const claimed = email.match(YEARS_ABOUT_READER);
  if (claimed) {
    const n = Number(claimed[1]);
    const yrs = Number(c.experience_years);
    if (!Number.isFinite(yrs) || Math.abs(yrs - n) > 1) {
      add('invented_experience', Number.isFinite(yrs)
        ? `The record says ${yrs} years, not ${n}. Use the real number or drop the claim.`
        : `We do not know how long they have been doing this, so do not say "${claimed[0].trim()}". Never tell someone about their own career.`);
    }
  }

  if (i.outreach_type !== 'nurture') {
    // A candidate cannot answer "are you interested" without knowing what and
    // where. Both are on the job order, so there is no excuse for either being
    // missing — and both count as present wherever the candidate can READ them,
    // which is why these two look at the panel as well as the prose.
    const visible = full + ' ' + subject;
    if (f.title && !new RegExp(escapeRe(f.title), 'i').test(visible)) {
      add('missing_role', `Name the role — "${f.title}" — in the email or the subject. They cannot answer without it.`);
    }
    if (f.place && !new RegExp(escapeRe(f.place.split(',')[0].trim()), 'i').test(visible)) {
      add('missing_location', `Say where the job is (${f.place}). Location decides the answer more often than anything else.`);
    }
  }

  const questions = sentencesOf(email).filter(t => t.includes('?'));
  if (!questions.length) add('no_ask', 'End with a plain question asking whether they are interested.');

  if (!OPT_OUT.test(email) && !o.hasButtons) {
    add('no_optout', 'Give them an explicit, one-line way to say no. A mass email to candidates without a way out is not one we should send.');
  }

  // The mailbox signature is appended after this text. A second sign-off is
  // visible to the recipient, and this app has shipped one before.
  if (o.omitSignOff) {
    const closing = /\n\s*(thanks|best regards|kind regards|warm regards|regards|sincerely|cheers)\s*,?\s*/gi;
    let last = null, m;
    while ((m = closing.exec(email)) !== null) last = m;
    if (last) {
      if (!/^thanks/i.test(last[1])) add('double_signoff', 'Close with "Thanks," and nothing else — a signature is appended automatically.');
      const after = email.slice(last.index + last[0].length).replace(SENDER_TOKENS, '').trim();
      if (after) add('double_signoff_name', `Delete everything after "Thanks," — the appended signature already carries the name and title. Remove: "${after.split(/\n/)[0].slice(0, 40)}"`);
    }
  }

  // A candidate email with no greeting reads as a mailshot, which is exactly
  // what it must not read as. Same failure the client generator hit live.
  const first = firstNameOf(c.full_name || c.first_name);
  const opening = email.split(/\n/).find(l => l.trim()) || '';
  if (first && first !== 'there' && !new RegExp('\\b' + escapeRe(first) + '\\b', 'i').test(opening)) {
    add('no_greeting', `Open with a greeting line addressing them by first name — "Hi ${first}," — before the first sentence.`);
  }

  if (subject.length > 90) add('subject_long', 'Shorten the subject line to something that fits in an inbox list.');

  return { ok: v.length === 0, violations: v };
}

// ── WHEN A CANDIDATE IS ACTUALLY READING ───────────────────────────────────
// The leads engine sends 08:00-16:00 in the prospect's timezone, and that is
// right for a prospect: a hiring manager is at their desk then. It is exactly
// WRONG for a candidate, who is at work then. A technician on a roof at 11am is
// not reading recruiter email; they read it at 7pm on the sofa.
//
// So candidate outreach gets its own window (owner's call, 2026-09-09):
// weekday EVENINGS, and most of the WEEKEND — the hours somebody is off the
// clock and looking at their own phone.
//
// PURE, and the clock is an argument: the caller works out what day and minute
// it is where the CANDIDATE is, and this decides. That is what makes every hour
// of the week testable without waiting for it.
const CANDIDATE_WINDOW = {
  weekday: [17, 21],   // 5pm - 9pm, after work and before bed
  weekend: [9, 20],    // 9am - 8pm, they are not at work
};

// A day whose start is not before its end is CLOSED, which is how "no weekday
// sends at all" is expressed without a separate flag.
function normalizeWindow(cfg) {
  const c = cfg || {};
  const pair = (v, dflt) => {
    const a = Array.isArray(v) ? v : dflt;
    const lo = Number(a[0]), hi = Number(a[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return dflt;
    return [Math.max(0, Math.min(23, lo)), Math.max(0, Math.min(24, hi))];
  };
  return {
    // THE WINDOW IS A SWITCH, AND IT IS OFF BY DEFAULT IN PRODUCTION
    // (owner's call, 2026-09-09, reversing their own call from the same day:
    // "remove the barricade of timezone for candidate emails ... Only the
    // outreach goes within the time zone"). The hours below are kept, tested
    // and re-usable — a decision reversed within a day can be reversed again,
    // and throwing away pure logic to express "not today" is expensive.
    //
    // `enabled` defaults to TRUE **here** because this function's job is only
    // "make sense of a window config"; whether a window exists at all is the
    // CALLER's question, and `routes/candidate-outreach.js` answers it from
    // `app_settings.candidate_send_window_enabled`, which defaults to off.
    enabled: c.enabled === undefined || c.enabled === null ? true : !!c.enabled,
    weekday: pair(c.weekday, CANDIDATE_WINDOW.weekday),
    weekend: pair(c.weekend, CANDIDATE_WINDOW.weekend),
  };
}

// The app_settings key that turns the window on. One string, exported, so the
// reader and anything that ever writes it cannot disagree about spelling.
const CANDIDATE_SEND_WINDOW_KEY = 'candidate_send_window_enabled';

// PURE. Off unless the stored value says on — an unreadable, missing or
// garbled setting must NOT quietly re-impose a barricade the owner removed.
function windowEnabledFromSetting(raw) {
  if (raw === true) return true;
  const s = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'on' || s === 'yes';
}

const isWeekend = (day) => day === 0 || day === 6;
function windowForDay(day, cfg) {
  const w = isWeekend(day) ? cfg.weekend : cfg.weekday;
  return (w[0] < w[1]) ? w : null;      // start >= end means the day is closed
}

/**
 * @param localDay      0 = Sunday .. 6 = Saturday, WHERE THE CANDIDATE IS
 * @param localMinutes  minutes since local midnight
 * @returns { open, opensInMinutes, opensDay, opensMinutes }
 */
function candidateWindowState(localDay, localMinutes, cfg) {
  const c = normalizeWindow(cfg);
  const day = ((Number(localDay) % 7) + 7) % 7;
  const mins = Math.max(0, Math.min(24 * 60 - 1, Number(localMinutes) || 0));

  // Window switched off: every hour is open, and it says so, so a caller can
  // tell "open because it is 7pm there" from "open because there are no hours".
  if (!c.enabled) {
    return { open: true, disabled: true, opensInMinutes: 0, opensDay: day, opensMinutes: mins };
  }

  const today = windowForDay(day, c);
  if (today && mins >= today[0] * 60 && mins < today[1] * 60) {
    return { open: true, opensInMinutes: 0, opensDay: day, opensMinutes: mins };
  }
  // Still to come today.
  if (today && mins < today[0] * 60) {
    return { open: false, opensInMinutes: today[0] * 60 - mins, opensDay: day, opensMinutes: today[0] * 60 };
  }
  // Today is done (or closed) — walk forward to the next day that opens. The
  // loop is bounded at 7 so a config with every day closed returns "never"
  // rather than spinning.
  let carried = 24 * 60 - mins;
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    const w = windowForDay(d, c);
    if (w) return { open: false, opensInMinutes: carried + w[0] * 60, opensDay: d, opensMinutes: w[0] * 60 };
    carried += 24 * 60;
  }
  return { open: false, opensInMinutes: null, opensDay: null, opensMinutes: null };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clockLabel(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

/** "today, 5:00 PM" · "tomorrow, 9:00 AM" · "Saturday, 9:00 AM". */
function describeWindowOpens(state, localDay) {
  if (!state || state.open) return 'now';
  if (state.opensDay === null || state.opensInMinutes === null) return 'when sending hours are set';
  const day = ((Number(localDay) % 7) + 7) % 7;
  const when = clockLabel(state.opensMinutes);
  if (state.opensDay === day) return 'today, ' + when;
  if (state.opensDay === (day + 1) % 7) return 'tomorrow, ' + when;
  return DAY_NAMES[state.opensDay] + ', ' + when;
}

// ── THE ANSWER BUTTONS ─────────────────────────────────────────────────────
// Two links in the email. The whole point of this feature is one question, so
// the cheapest possible way to answer it is not a nicety — a candidate between
// jobs will tap a button and will not compose a reply.
//
// THE LINK MUST NOT RECORD. It opens a PAGE with real buttons on it, and the
// POST from that page is what counts. Corporate mail security (Outlook Safe
// Links, Mimecast, Proofpoint) fetches every URL in an inbound message to check
// it is safe; a GET that recorded would mark candidates interested — or opted
// out — before a human ever opened the email. This is the single most important
// line in the file.
//
// Table layout and inline styles because this is EMAIL: Outlook's renderer has
// no flexbox, no grid, and strips a <style> block. `bgcolor` and the nested
// table are what make a coloured button survive it.
function answerLinkUrl(baseUrl, token) {
  return String(baseUrl || '').replace(/\/+$/, '') + '/i/' + encodeURIComponent(String(token || ''));
}

function answerButtonsHtml(baseUrl, token, opts) {
  const o = opts || {};
  const url = answerLinkUrl(baseUrl, token);
  const yes = escapeHtml(o.yesLabel || 'Yes, tell me more');
  const no = escapeHtml(o.noLabel || 'Not for me');
  const btn = (href, label, bg, fg, border) =>
    '<td style="padding:0 8px 0 0">' +
      '<a href="' + escapeHtml(href) + '" style="display:inline-block;padding:11px 20px;' +
        'font-family:Arial,sans-serif;font-size:14px;font-weight:bold;line-height:1;' +
        'color:' + fg + ';background-color:' + bg + ';border:1px solid ' + border + ';' +
        'border-radius:6px;text-decoration:none">' + label + '</a>' +
    '</td>';
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px"><tr>' +
    btn(url + '?a=yes', yes, '#166534', '#ffffff', '#166534') +
    btn(url + '?a=no', no, '#ffffff', '#334155', '#cbd5e1') +
  '</tr></table>';
}

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeRe(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// How much there actually is to write about. Counts only facts a candidate
// would care about — not fields that happen to be non-null.
function materialIn(input) {
  const i = input || {};
  const f = jobFacts(i.job);
  let n = 0;
  if (f.title) n++;
  if (f.company) n++;
  if (f.place) n++;
  if (f.pay) n++;
  if (f.terms.length) n++;
  if (f.skills.length) n++;
  if (whyYouClause(i.reasons, i.candidate, i.job)) n++;
  return n;
}

module.exports = {
  ANGLE_BRIEF, angleBrief,
  jobFacts, payFiguresIn, payFigures, remoteTerm, whyYouClause, sharedSkills, prettySkill,
  // The job description panel. `text` is canonical; the card is derived from it,
  // which is what stops the preview and the outbox disagreeing.
  jobBlock, jobBlockRows, splitJobBlock, parseJobBlockText, jobBlockHtmlFromText,
  cleanDescription, proseOf, expRange, BLOCK_FENCE, BLOCK_MAX_CHARS, BLOCK_MAX_LINES,
  rulesJobBrief, buildBriefSystemPrompt, buildBriefPayload, parseBrief, checkBrief,
  rulesVariants, draftParts, validateInput, checkCandidateDraft,
  CANDIDATE_WINDOW, CANDIDATE_SEND_WINDOW_KEY, windowEnabledFromSetting,
  normalizeWindow, candidateWindowState, describeWindowOpens, clockLabel,
  answerButtonsHtml, answerLinkUrl, escapeHtml,
  unsupportedMoney, MONEY_SHAPES, materialIn, firstNameOf, wordCount, joinList, indefinite,
  SENDER_TOKENS,
};
