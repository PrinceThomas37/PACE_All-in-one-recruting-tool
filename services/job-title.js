// ARE THESE TWO JOB TITLES THE SAME JOB? (owner, 14 Oct: two Cargill leads, "Quality Assurance Technician. Job in Johnson Fifty
// States-Jobs" and "Quality Assurance Technician. Job in Nemaha Gecko Jobs", both made by the Lead Finder.)
//
// "Email another job" refuses a second lead for a job the company already has a lead for — but compared the titles letter for letter,
// and job boards tack their own words onto a posting's title ("… Job in <town> - <Board> Jobs", "… - Norfolk, NE"). The same posting
// seen on two boards therefore became two leads, and the same person was written to twice about the same role.
//
// jobTitleKey() reduces a title to the role it names, and sameJob() compares those. Deliberately NARROW: it removes only the board's
// own wrapper (a trailing "Job in …", "Jobs in …", "- Jobs", "at <board>"), never a word of the role — "Quality Assurance Lab
// Technician" and "Quality Assurance Technician" stay two jobs. A false "same" costs a lead the person wanted; a false "different" is
// the old behaviour, so when unsure it says different.
// PURE.

const txt = (v) => String(v == null ? '' : v).trim();

function jobTitleKey(title) {
  let t = txt(title).toLowerCase();
  if (!t) return '';
  // "<role>. Job in <place> …", "<role> - Jobs in <place>", "<role> | job in <place>": everything from the wrapper on
  t = t.replace(/\s*[.\-–—|:,]?\s*\bjobs?\s+(?:in|at|near|for)\b.*$/i, '');
  // a trailing "- <Board> Jobs" / "- jobs"
  t = t.replace(/\s*[-–—|]\s*(?:[\w&'. ]{0,40}\s)?jobs?\s*$/i, '');
  // "<role> - City, ST" (a place after a dash, the board's habit)
  t = t.replace(/\s*[-–—|]\s*[a-z .'’]{2,30},\s*[a-z]{2}\s*$/i, '');
  return t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sameJob(a, b) {
  const x = jobTitleKey(a), y = jobTitleKey(b);
  return !!x && x === y;
}

module.exports = { jobTitleKey, sameJob };
