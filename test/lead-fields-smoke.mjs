// A VALUE IN THE WRONG FIELD IS MOVED, NOT PRINTED (owner, 14 Oct: a company description in "Found by").
// services/lead-fields.js — the one rule for every way a lead is made or changed. Proven with the owner's real case, with the
// legitimate values that must NEVER move, and with the promise that nothing is lost.
// Usage: node test/lead-fields-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { tidyLeadFields, movedSentence } = require('../services/lead-fields.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (c ? '' : ' — ' + d)); };

const DESC = 'Company Description Venture Visionary Partners is a registered independent wealth management firm that advises affluent families, individuals, business owners, and entrepreneurs on how to be strategically smarter with their wealth. Based in Ohio, the firm brings together experienced wealth managers.';
let r = tidyLeadFields({ source: DESC, notes: '' });
ok('the owner\'s case: a company description in Found by leaves Found by', r.fields.source === '', JSON.stringify(r.fields.source));
ok('…and is kept, word for word, in the lead\'s Notes with where it came from', r.fields.notes.includes(DESC) && /Moved from "Found by"/.test(r.fields.notes));
ok('…and the move is reported', r.moved.length === 1 && r.moved[0].field === 'source' && r.moved[0].to === 'notes');
ok('…in a sentence a person can read', /from Found by to Notes/.test(movedSentence(r.moved)) && /wrong place/.test(movedSentence(r.moved)), movedSentence(r.moved));
r = tidyLeadFields({ source: DESC, notes: 'Called twice.' });
ok('existing notes are kept, the moved text is added after them', r.fields.notes.startsWith('Called twice.') && r.fields.notes.includes(DESC));

// ── values that belong where they are never move ──
for (const s of ['LinkedIn', 'Indeed', 'Company Website', 'Referral', 'Zip recruiter', 'Lead Finder', 'Finder · Apollo', 'Dice', 'Cold call - Ohio expo']) {
  r = tidyLeadFields({ source: s });
  ok('a real source stays: "' + s + '"', r.fields.source === s && r.moved.length === 0, JSON.stringify(r));
}
r = tidyLeadFields({ salary_range: '$22 - $26 per hour', location: 'Maple Grove, MN', job_url: 'https://www.indeed.com/viewjob?jk=abc', position: 'Production Operator - 3rd Shift' });
ok('a normal pay, place, link and title are untouched', r.moved.length === 0 && r.fields.salary_range === '$22 - $26 per hour' && r.fields.job_url.startsWith('https://') && r.fields.position === 'Production Operator - 3rd Shift');
ok('a key that was not passed is not returned (an edit that never mentioned Found by does not touch it)', !('source' in tidyLeadFields({ notes: 'x' }).fields));

// ── other mistakes ──
r = tidyLeadFields({ source: 'https://www.indeed.com/viewjob?jk=abc' });
ok('a web address typed in Found by moves to the job link (it was empty)', r.fields.job_url === 'https://www.indeed.com/viewjob?jk=abc' && r.fields.source === '' && r.moved[0].to === 'job_url');
r = tidyLeadFields({ source: 'www.indeed.com/job/1', job_url: 'https://other.example/x' });
ok('…but never over a link that is already there (kept in Notes instead)', r.fields.job_url === 'https://other.example/x' && /www\.indeed\.com/.test(r.fields.notes));
r = tidyLeadFields({ source: 'neil@acme.com' });
ok('an email address in Found by goes to Notes', r.fields.source === '' && /neil@acme\.com/.test(r.fields.notes));
r = tidyLeadFields({ job_url: 'Senior estimator needed, apply with resume' });
ok('words in the job link box go to Notes, the link is emptied', r.fields.job_url === null && /Senior estimator/.test(r.fields.notes));
r = tidyLeadFields({ salary_range: 'Competitive salary and benefits including health insurance, 401k matching, paid time off and a generous bonus plan for all staff.' });
ok('a paragraph in Pay goes to Notes', r.fields.salary_range === null && /Competitive salary/.test(r.fields.notes));
r = tidyLeadFields({ position: 'Estimator\nResponsibilities: prepare bids, review plans, meet clients.' });
ok('a pasted block in the title keeps its first line as the title, the whole text in Notes', r.fields.position === 'Estimator' && /Responsibilities/.test(r.fields.notes));
ok('two moves are both reported', tidyLeadFields({ source: DESC, job_url: 'not a link at all' }).moved.length === 2);
ok('nothing is ever lost: every moved text is findable in the notes', (() => { const t = tidyLeadFields({ source: DESC, job_url: 'some words here', salary_range: 'x '.repeat(60) }); return t.moved.every(m => t.fields.notes.includes(m.text.replace(/…$/, ''))); })());
ok('empty and null values are left alone', tidyLeadFields({ source: '', job_url: null, salary_range: undefined }).moved.length === 0);
ok('no input does not throw', tidyLeadFields().moved.length === 0 && movedSentence([]) === '');
const bad = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
