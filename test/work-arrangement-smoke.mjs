// WORK ARRANGEMENT (D-0197, owner 2 Nov 2026): "fully on-site (Dallas, TX)" / "100% remote" / "hybrid (3 days in office)", read
// from the posting by rules; a posting that does not say → the sentence holding it is LEFT OUT and the email still goes.
// The cases marked "live" are sentences from real postings that read wrong on the first try (2 Nov) — they must stay right.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const wa = require('../services/work-arrangement.js');
const ev = require('../email-vars.js');
const draft = require('../services/sequence-draft.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const ph = (t, p) => wa.read(t, p).phrase;

step('100% remote', ph('This is a 100% remote position for a Java developer with Spring.') === '100% remote');
step('a remote role', ph('We are hiring for a remote role supporting our US clients.') === 'remote');
step('hybrid with days in office', ph('Hybrid schedule: 3 days per week in office in Austin. Great team.') === 'hybrid (3 days in office)');
step('hybrid in words', ph('This role is hybrid, two days in the office each week.') === 'hybrid (2 days in office)');
step('on-site, with the job\'s place', ph('This is a full-time, on-site role located in Palos Hills, IL.', 'Palos Hills, IL') === 'fully on-site (Palos Hills, IL)');
step('"Work Location: In person" = on-site', ph('Benefits: 401k. Work Location: In person', 'Memphis, TN') === 'fully on-site (Memphis, TN)');
step('no work-from-home = on-site', ph('Duties take place on site with no work from home options available.', 'Boone, IA') === 'fully on-site (Boone, IA)');
step('live: "on-site lunch program" alone says nothing', ph('Benefits include employer-funded health care, on-site lunch program, 401K contribution.') === '');
step('live: "monitor the on-site performance of subs" alone says nothing', ph('Monitor the on-site performance of subs, suppliers, labor, and equipment daily.') === '');
step('live: "work from home negotiable after training" is not "remote"', ph('Monday through Friday, work from home negotiable after training period.') === '');
step('live: a 100% on-site drone maker is not "hybrid"', ph('Flying Fox UAV | Purcellville, VA | 100% On-Site | Full-Time. We build hybrid VTOL drones.', 'Purcellville, VA') === 'fully on-site (Purcellville, VA)');
step('hybrid cloud is not a work arrangement', ph('We build hybrid cloud solutions for banks. Great benefits for all.') === '');
step('a posting that says nothing → nothing', ph('Competitive pay, health benefits and a great team culture here.') === '');

// in an email
const job = { position: 'Java Developer', location: 'Dallas, TX', company: { name: 'Acme' }, research: { jd_raw: 'This is a full-time, on-site role based in Dallas, TX.', requirements: {} } };
const v = ev.buildEmailVars({ job, contact: { first_name: 'Dana' }, senderDisplayName: 'Me' });
const T = 'Hi {{fn}},\n\nI have people ready for your {{work_arrangement}} {{pos}} role. Want resumes?\n\nThanks';
step('the email gets the phrase', ev.fillTemplate(T, v).includes('your fully on-site (Dallas, TX) Java Developer role'), ev.fillTemplate(T, v));
const v2 = ev.buildEmailVars({ job: Object.assign({}, job, { research: { jd_raw: 'Great pay and benefits for the right person.', requirements: {} } }), contact: { first_name: 'Dana' }, senderDisplayName: 'Me' });
const out2 = ev.fillTemplate(T, v2);
step('not said → that sentence is left out, the rest goes (owner: "A")', !out2.includes('ready for your') && out2.includes('Want resumes?') && !out2.includes('{{'), JSON.stringify(out2));
step('a reading stored on the lead wins', ev.buildEmailVars({ job: Object.assign({}, job, { research: { jd_raw: 'x'.repeat(40), requirements: { work_arrangement: 'hybrid' } } }), contact: {}, senderDisplayName: 'Me' }).work_arrangement === 'hybrid');
step('the sequence screen may use it (an allowed detail)', draft.ALLOWED_VARS.has('work_arrangement'));

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
