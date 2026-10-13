// A LEAD FOR SEVERAL JOBS WRITES ONE EMAIL THAT LISTS THEM ALL, AS BULLETS (R-194, owner 13 Oct).
//
// Owner: "they should be able to send emails to the POC about multiple job openings and those should come in the email … in bullet
// points — it should go from the template saved for emailing by the user, a preview of this email should be shown before sending
// and an edit option for the user to edit, and then click send."
//
// Proven here on the real first-email builder (services/lead-outreach-queue.js):
//   * the person's OWN template stays in charge: with {{jobs}} in it the list lands exactly where they put it, and PACE adds nothing
//   * without {{jobs}}, the bulleted list is added once, as its own paragraph right after the one naming the main job
//   * one job → the email is exactly what it was before (no list, no extra words)
//   * the main job comes first, every job once, however it was typed; nothing is left as a {{hole}}
//   * the email is written into Pending (status 'pending'), where it is previewed and edited before anything is sent
// Usage: node test/multi-job-email-smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const { buildPendingEmailsFromJobs } = require('../services/lead-outreach-queue.js');
const ev = require('../email-vars.js');

const OWN = (body) => ({ u_bd1_tmpl_o1_subject: 'Staffing for your {{pos}} role', u_bd1_tmpl_o1_body: body });
const job = (extra) => Object.assign({ id: 'j1', position: 'Welder', location: 'Austin, TX', company: { name: 'Acme Mfg', industry: 'Manufacturing' }, assigned_to_bd: 'bd1',
  research: { finder: { also_hiring: ['CNC Machinist', 'welder', ' Estimator '] } }, sending_email: { id: 'm1', email_address: 'bea@x.test' },
  contacts: [{ id: 'c1', email: 'pat@acme.test', first_name: 'Pat', last_name: 'Lee', designation: 'HR' }] }, extra || {});
const build = (j, settings) => buildPendingEmailsFromJobs([j], 'bd1', { bd1: { id: 'bd1', name: 'Bea', email: 'bea@x.test' } }, {}, settings, new Set());

const PLAIN = 'Hi {{fn}},\n\nI saw your {{pos}} opening at {{company}}. We have people who fit.\n\nWould you like to see them?\n\nThanks,\n{{sender}}';
let out = build(job(), OWN(PLAIN));
let body = out.emailsToInsert[0].body;
step('the email is written into Pending (nothing is sent by writing it)', out.emailsToInsert.length === 1 && out.emailsToInsert[0].status === 'pending');
step('every job is listed, main job first, each ONCE (a repeat typed in another case or with spaces is not a second bullet)', /Open roles:\n• Welder\n• CNC Machinist\n• Estimator\n/.test(body) && (body.match(/• /g) || []).length === 3, body);
step('the list sits right after the paragraph that names the main job, before the question', body.indexOf('I saw your Welder opening') < body.indexOf('Open roles:') && body.indexOf('Open roles:') < body.indexOf('Would you like to see them?'));
step('the person\'s own words are all still there, and nothing is left as a {{hole}} except the send-time sender', body.indexOf('Would you like to see them?') > 0 && ev.unresolvedVars(body).length === 0 && /\{\{sender\}\}/.test(body));

// the person places the list themselves
out = build(job(), OWN('Hi {{fn}},\n\nYou are hiring for:\n{{jobs}}\n\nCan I send you profiles for any of these?\n\n{{sender}}'));
body = out.emailsToInsert[0].body;
step('with {{jobs}} in the person\'s template the list lands exactly there, as bullets', /You are hiring for:\n\n?• Welder\n• CNC Machinist\n• Estimator\n/.test(body), JSON.stringify(body));
step('…and PACE adds no second list of its own', !/Open roles:/.test(body) && (body.match(/• /g) || []).length === 3);
out = build(job(), OWN('Hi {{fn}},\n\nYour {{openings}} are on my desk.\n\n{{sender}}'));
step('the other names for the same field work too ({{openings}})', /• Welder/.test(out.emailsToInsert[0].body) && !/Open roles:/.test(out.emailsToInsert[0].body));

// one job: nothing changes
const single = job({ research: {} });
out = build(single, OWN(PLAIN));
body = out.emailsToInsert[0].body;
step('a lead for ONE job gets exactly the email it always did — no list, no extra words', !/Open roles:|• /.test(body) && body.indexOf('I saw your Welder opening at Acme Mfg.') > 0);
out = build(single, OWN('Hi {{fn}},\n\nHiring for {{jobs}}?\n\n{{sender}}'));
step('{{jobs}} for one job is just that job\'s title, in the sentence', /Hiring for Welder\?/.test(out.emailsToInsert[0].body));

// shapes the builder must survive
out = build(job({ research: null }), OWN(PLAIN));
step('a lead with no research at all still writes its email', out.emailsToInsert.length === 1 && !/• /.test(out.emailsToInsert[0].body));
out = build(job(), OWN('Hi {{fn}}, one block of text about your {{pos}} role with no blank lines. {{sender}}'));
step('a template with no paragraphs still gets the list (at the end), not lost', /Open roles:\n• Welder/.test(out.emailsToInsert[0].body));
const subj = build(job(), OWN(PLAIN)).emailsToInsert[0].subject;
step('the subject is still the person\'s own, naming the main job', subj === 'Staffing for your Welder role', subj);

// the pure helpers
step('jobsOf: main first, others after, each once, trimmed', ev.jobsOf(job()).join('|') === 'Welder|CNC Machinist|Estimator' && ev.jobsOf({ position: 'Welder' }).join('|') === 'Welder' && ev.jobsOf(null).length === 0);
step('ensureJobsListed leaves one job alone', ev.ensureJobsListed('Hi\n\nBody', 'Hi\n\nBody', { position: 'Welder' }) === 'Hi\n\nBody');

const p = results.filter(Boolean).length;
console.log(`SUMMARY: ${p}/${results.length}`);
process.exit(p === results.length ? 0 : 1);
