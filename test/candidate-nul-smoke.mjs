// A RESUME WITH AN INVISIBLE NULL CHARACTER CAN STILL BE ADDED (R-267). The owner (19 Oct) uploaded a resume to a job and
// the row said "Not added — unsupported Unicode escape sequence": some PDF makers leave the \u0000 character in the text a
// resume reader pulls out, and the database refuses the whole row. Every candidate write (Add, Edit, the sourcing import)
// picks its fields through pickCandidateFields, so that is where the character is dropped; this pins it.
// Usage: node test/candidate-nul-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + String(d).slice(0, 220) : '')); };
const { pickCandidateFields } = require('../services/candidate-fields.js')({ supabase: null, withOrg: (q) => q });
const NUL = String.fromCharCode(0);
const out = pickCandidateFields({
  full_name: 'James' + NUL + ' Davis', city: 'Houma', email: 'pilesden@hotmail.com', experience_years: 3,
  resume_text: 'Excel, estimating' + NUL + NUL + ', structural', skills: ['Excel' + NUL, 'estimating'],
});
const anyNul = (v) => (typeof v === 'string' ? v.includes(NUL) : Array.isArray(v) ? v.some(anyNul) : false);
step('no field keeps the null character', !Object.values(out).some(anyNul), JSON.stringify(out));
step('the visible text is untouched', out.full_name === 'James Davis' && out.resume_text === 'Excel, estimating, structural', out.full_name + ' | ' + out.resume_text);
step('a list keeps its items', Array.isArray(out.skills) && out.skills.join('|') === 'Excel|estimating', JSON.stringify(out.skills));
step('numbers pass through as they were', out.experience_years === 3);
step('the database form of the row has no \\u0000 escape (what Postgres rejects)', !JSON.stringify(out).includes('\\u0000'));
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
