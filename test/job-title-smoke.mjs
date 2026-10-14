// "THE SAME JOB" AT A COMPANY IS NOT "ANOTHER" JOB — even when two job boards word the title differently (owner, 14 Oct).
// services/job-title.js: the board's own wrapper is ignored; a word of the role never is.
// Usage: node test/job-title-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { jobTitleKey, sameJob } = require('../services/job-title.js');
const results = [];
const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '[PASS] ' : '[FAIL] ') + n + (c ? '' : ' — ' + d)); };

ok('the owner\'s two Cargill titles are the same job', sameJob('Quality Assurance Technician. Job in Johnson Fifty States-Jobs', 'Quality Assurance Technician. Job in Nemaha Gecko Jobs'), jobTitleKey('Quality Assurance Technician. Job in Johnson Fifty States-Jobs'));
ok('…and either one is the plain title', sameJob('Quality Assurance Technician. Job in Nemaha Gecko Jobs', 'Quality Assurance Technician'));
ok('case and punctuation do not make a different job', sameJob('Project Manager', ' project  manager.'));
ok('"- City, ST" after the role is the board\'s habit', sameJob('Quality Assurance Technician - Norfolk, NE', 'Quality Assurance Technician'));
ok('"Jobs in <town>"', sameJob('Production Operator - Jobs in Maple Grove', 'Production Operator'));
ok('"- Indeed Jobs" tail', sameJob('Controller - Indeed Jobs', 'Controller'));

ok('a LAB technician is not the plain technician', !sameJob('Quality Assurance Lab Technician', 'Quality Assurance Technician'));
ok('a shift is part of the role', !sameJob('Quality Assurance Lab Technician (2nd Shift)', 'Quality Assurance Lab Technician'));
ok('a different level is a different job', !sameJob('Project Manager', 'Senior Project Manager'));
ok('Traffic Engineer / Project Manager is not Project Manager', !sameJob('Traffic Engineer / Project Manager', 'Project Manager'));
ok('empty is never "the same" as empty', !sameJob('', '') && !sameJob(null, undefined));
ok('a role that merely contains "job" in a word is untouched', jobTitleKey('Jobsite Superintendent') === 'jobsite superintendent', jobTitleKey('Jobsite Superintendent'));
const bad = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
