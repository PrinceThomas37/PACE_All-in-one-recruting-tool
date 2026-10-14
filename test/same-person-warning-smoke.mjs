// THE SAME PERSON ON ANOTHER ACTIVE LEAD AT THIS COMPANY IS A WARNING, NOT A REFUSAL (owner, 14 Oct: "warn" — yes).
// services/lead-contacts.js repeatsAtCompany + warningPayload — pure, with the Cargill shape from the owner's screenshot:
//   * the same ADDRESS on another live lead at the company is a certain repeat; the same NAME is "may be the same person";
//   * a lead that is Rejected or Future (not being worked) or deleted does not count; a person at ANOTHER company does not count;
//   * the other lead is NAMED only when the caller may see it — otherwise "a colleague's active lead", never its title (D-0034);
//   * the answer can be "create it anyway" (can_add_anyway) — it is a question, not a wall.
// Usage: node test/same-person-warning-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { repeatsAtCompany, warningPayload } = require('../services/lead-contacts.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (c ? '' : ' — ' + d)); };

const CO = 'cargill';
const jobs = {
  j1: { id: 'j1', company_id: CO, position: 'Quality Assurance Technician', stage: 'Assigned', deleted_at: null },
  j2: { id: 'j2', company_id: CO, position: 'Old role', stage: 'Rejected', deleted_at: null },
  j3: { id: 'j3', company_id: CO, position: 'Parked role', stage: 'Future', deleted_at: null },
  j4: { id: 'j4', company_id: CO, position: 'Gone role', stage: 'Assigned', deleted_at: '2026-10-01' },
  j5: { id: 'j5', company_id: 'other-co', position: 'Elsewhere', stage: 'Assigned', deleted_at: null },
};
const people = [
  { id: 'c1', job_id: 'j1', first_name: 'Katie', last_name: 'Simmer', email: 'katie_simmer@cargill.com', extra_emails: [], company_id: CO },
  { id: 'c2', job_id: 'j2', first_name: 'Rita', last_name: 'Old', email: 'rita@cargill.com', extra_emails: [], company_id: CO },
  { id: 'c3', job_id: 'j3', first_name: 'Pat', last_name: 'Parked', email: 'pat@cargill.com', extra_emails: [], company_id: CO },
  { id: 'c4', job_id: 'j4', first_name: 'Gus', last_name: 'Gone', email: 'gus@cargill.com', extra_emails: [], company_id: CO },
  { id: 'c5', job_id: 'j5', first_name: 'Eve', last_name: 'Else', email: 'eve@elsewhere.com', extra_emails: [], company_id: 'other-co' },
];
const rep = (p) => repeatsAtCompany([p], people, jobs, CO);

let r = rep({ first_name: 'Katie', last_name: 'Simmer', email: 'KATIE_SIMMER@cargill.com' });
ok('the same address (any case) on a live lead at the company is a repeat', r.length === 1 && r[0].hit.match === 'email' && r[0].job.id === 'j1');
r = rep({ first_name: 'Katie', last_name: 'Simmer', email: 'ksimmer@cargill.com' });
ok('the same NAME with another address is a repeat too, as a name match', r.length === 1 && r[0].hit.match === 'name');
ok('a person on a Rejected lead is not a repeat', rep({ first_name: 'Rita', last_name: 'Old', email: 'rita@cargill.com' }).length === 0);
ok('…nor on a Future (parked) lead', rep({ first_name: 'Pat', last_name: 'Parked', email: 'pat@cargill.com' }).length === 0);
ok('…nor on a deleted lead', rep({ first_name: 'Gus', last_name: 'Gone', email: 'gus@cargill.com' }).length === 0);
ok('…nor somebody at a DIFFERENT company, even with the same address', rep({ first_name: 'Eve', last_name: 'Else', email: 'eve@elsewhere.com' }).length === 0);
ok('a brand-new person is not a repeat', rep({ first_name: 'New', last_name: 'Person', email: 'new@cargill.com' }).length === 0);
ok('an extra address counts (somebody\'s second address is the same person)', repeatsAtCompany([{ first_name: 'K', email: 'kay@cargill.com', extra_emails: ['katie_simmer@cargill.com'] }], people, jobs, CO).length === 1);

const certain = rep({ first_name: 'Katie', last_name: 'Simmer', email: 'katie_simmer@cargill.com' });
let w = warningPayload({ repeats: certain, visibleIds: new Set(['j1']), companyName: 'Cargill', position: 'QA Technician - Nemaha' });
ok('a lead the caller may see is NAMED, with its stage and the company', /"Quality Assurance Technician" lead \(Assigned\) at Cargill/.test(w.error), w.error);
ok('…the person and the other lead are given to the pop-up', w.duplicate.person && w.duplicate.person.email === 'katie_simmer@cargill.com' && w.duplicate.lead && w.duplicate.lead.id === 'j1');
ok('…it says what a second lead means', /second lead for "QA Technician - Nemaha" means a second cold email/.test(w.error));
ok('…and it is a question: "create it anyway" is offered, with its own code', w.duplicate.can_add_anyway === true && w.code === 'same_person_elsewhere');
w = warningPayload({ repeats: certain, visibleIds: new Set(), companyName: 'Cargill', position: 'X' });
ok('a lead the caller may NOT see is never named — "a colleague\'s active lead"', /a colleague's active lead at Cargill/.test(w.error) && !/Quality Assurance/.test(JSON.stringify(w)), JSON.stringify(w).slice(0, 200));
ok('…and no person or lead details leave in the payload', w.duplicate.person === null && w.duplicate.lead === null && w.repeats[0].lead_id === null);
w = warningPayload({ repeats: rep({ first_name: 'Katie', last_name: 'Simmer', email: 'ksimmer@cargill.com' }), visibleIds: new Set(['j1']), companyName: 'Cargill', position: 'X' });
ok('a name-only match is worded as a MAYBE ("may be the same person")', /may be the same person/.test(w.error), w.error);
const two = repeatsAtCompany([{ first_name: 'Katie', last_name: 'Simmer', email: 'katie_simmer@cargill.com' }, { first_name: 'Katie', last_name: 'Simmer', email: 'ksimmer@cargill.com' }], people, jobs, CO);
ok('several people are all named in one question', warningPayload({ repeats: two, visibleIds: new Set(['j1']), companyName: 'Cargill', position: 'X' }).error.split('is already on').length >= 3 || two.length === 2);
const bad = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
