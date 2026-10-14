// A VALUE IN THE WRONG FIELD IS NOTICED AND MOVED (owner, 14 Oct: "if the RA has added wrong information in a wrong field, like the JD in
// the Found by column … can the system understand that and map the details to the right fields?").
//
// The lead's own short fields — Found by (source), job link, pay, place, title — are labels and addresses, not paragraphs. When a
// paragraph, a web address or an email lands in one of them (a pasted company description in Found by; a link typed in Found by; a
// sentence in the job link box), the SYSTEM moves it to where it belongs and says so, instead of printing a page of prose in a
// one-line column. Nothing is thrown away: whatever cannot be placed goes to the lead's Notes, word for word, with a line saying where
// it came from. And nothing is ever moved onto a value that is already there.
//
// PURE: no database. Used by every way a lead is made or changed (POST /jobs, POST /jobs/bulk, PUT /jobs/:id), so a sheet import, the
// RA form and an edit all get the same answer. A rule only for the form would leave the import — which is where this happens — unchecked.
//
// tidyLeadFields({ source, job_url, salary_range, location, position, notes }) →
//   { fields: { ...same keys, corrected }, moved: [{ field, to, text, why }] }
// A key that was not passed is not returned (an edit that never mentioned Found by does not touch it).

const txt = (v) => String(v == null ? '' : v).trim();
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;
const DOMAINISH_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isUrl = (s) => URL_RE.test(s) || (DOMAINISH_RE.test(s) && !EMAIL_RE.test(s));

const words = (s) => (s.match(/\S+/g) || []).length;
// Prose, not a label: long, or many words, or more than one sentence, or more than one line.
function isProse(s, maxChars, maxWords) {
  if (!s) return false;
  if (/\r|\n/.test(s)) return true;
  if (s.length > maxChars || words(s) > maxWords) return true;
  return /[.!?]["')]?\s+[A-Z]/.test(s);
}

const NOTE_CAP = 2000;
const short = (s) => (s.length > 60 ? s.slice(0, 57).trimEnd() + '…' : s);

function tidyLeadFields(input) {
  const fields = Object.assign({}, input || {});
  const moved = [];
  let notes = has(fields, 'notes') ? txt(fields.notes) : '';
  let notesTouched = false;
  const toNotes = (field, label, text, why) => {
    const line = 'Moved from "' + label + '": ' + text.slice(0, NOTE_CAP);
    notes = notes ? notes + '\n\n' + line : line;
    notesTouched = true;
    moved.push({ field, to: 'notes', text: short(text), why });
  };

  // Found by
  if (has(fields, 'source')) {
    const s = txt(fields.source);
    if (s && EMAIL_RE.test(s)) {
      toNotes('source', 'Found by', s, 'an email address is not where a lead was found'); fields.source = '';
    } else if (s && isUrl(s)) {
      const free = !has(fields, 'job_url') ? true : !txt(fields.job_url);
      if (free) { fields.job_url = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s; moved.push({ field: 'source', to: 'job_url', text: short(s), why: 'a web address belongs in the job link' }); }
      else toNotes('source', 'Found by', s, 'a web address belongs in the job link, which already has one');
      fields.source = '';
    } else if (isProse(s, 60, 8)) {
      toNotes('source', 'Found by', s, 'a paragraph is not where a lead was found'); fields.source = '';
    }
  }
  // Job link
  if (has(fields, 'job_url')) {
    const u = txt(fields.job_url);
    if (u && !isUrl(u)) { toNotes('job_url', 'Job link', u, 'not a web address'); fields.job_url = null; }
  }
  // Pay
  if (has(fields, 'salary_range')) {
    const p = txt(fields.salary_range);
    if (p && (isProse(p, 80, 14) || (p.length > 30 && !/\d/.test(p)))) { toNotes('salary_range', 'Pay', p, 'a paragraph is not a pay range'); fields.salary_range = null; }
  }
  // Place
  if (has(fields, 'location')) {
    const l = txt(fields.location);
    if (l && (l.length > 100 || EMAIL_RE.test(l) || /\r|\n/.test(l))) { toNotes('location', 'Location', l, 'not a place'); fields.location = null; }
  }
  // Title: a title is a line. A pasted block keeps its first line as the title and the whole text goes to the notes.
  if (has(fields, 'position')) {
    const t = txt(fields.position);
    if (t && (/\r|\n/.test(t) || t.length > 160)) {
      const first = txt(t.split(/\r?\n/)[0]);
      const cut = first.length > 120 ? first.slice(0, 120).replace(/\s+\S*$/, '').trim() : first;
      if (cut) { toNotes('position', 'Job title', t, 'a title is one line'); fields.position = cut; }
    }
  }
  if (notesTouched) fields.notes = notes;
  return { fields, moved };
}

// The one sentence said to the person after a save that moved something.
function movedSentence(moved) {
  if (!moved || !moved.length) return '';
  const label = { source: 'Found by', job_url: 'the job link', salary_range: 'Pay', location: 'Location', position: 'the job title' };
  const where = { notes: 'Notes', job_url: 'the job link' };
  const one = (m) => '"' + m.text + '" from ' + (label[m.field] || m.field) + ' to ' + (where[m.to] || m.to);
  return 'Moved ' + moved.slice(0, 2).map(one).join('; ') + (moved.length > 2 ? ' and ' + (moved.length - 2) + ' more' : '') + ' — it was in the wrong place.';
}

module.exports = { tidyLeadFields, movedSentence, isProse, isUrl };
