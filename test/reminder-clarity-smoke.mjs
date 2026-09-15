// A reminder must say where it came from, name its recipient, and never send a
// merge field to a prospect.
//
// Three failures shipped together and the owner found all three in one sitting
// (2026-09-15):
//   1. five tasks on screen with nothing saying what created them;
//   2. Compose opened with an EMPTY "To" box for a lead the browser had not
//      cached, while Send stayed enabled;
//   3. the email that went out read "Hi {{fn}}, ... the {{pos}} opening at
//      {{company}}" over a real recruiter's signature.
//
// This suite pins the parts that can be pinned offline: the provenance and
// due-state sentences, the merge-field vocabulary that made (3) possible, and
// the guard that now refuses (3) at the send path.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { describeReminder, dueState, dueLabel, dueHeadline } = require('../services/reminder-source.js');
const { fillTemplate, buildEmailVars, unresolvedVars, DEFER_SENDER } = require('../email-vars.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }

// ── 1. WHY DOES THIS REMINDER EXIST ─────────────────────────────────────────
console.log('\nReminder provenance');

t('a bd_touch reminder is explained as a sequence step, never as "bd_touch"', () => {
  const d = describeReminder({ reminder_type: 'bd_touch' });
  assert.equal(d.label, 'Sequence step');
  assert.ok(d.why.length > 20, 'needs a real sentence');
  assert.ok(!/bd_touch/.test(d.why + d.label), 'must not leak the channel name at a recruiter');
});

t('with the sequence resolved it names the sequence and the step', () => {
  const d = describeReminder({ reminder_type: 'bd_touch' }, {
    name: 'Standard Sales Outreach', stepOrder: 3, stepName: 'BD call + LinkedIn touch', totalSteps: 4
  });
  assert.match(d.why, /Step 3 of 4/);
  assert.match(d.why, /Standard Sales Outreach/);
  assert.match(d.why, /BD call \+ LinkedIn touch/);
  assert.equal(d.sequence.step_order, 3);
});

t('an unresolved sequence degrades to the generic sentence, never a guess', () => {
  const d = describeReminder({ reminder_type: 'bd_touch' }, null);
  assert.ok(!d.sequence, 'must not invent a sequence');
  assert.ok(!/Step \d/.test(d.why), 'must not claim a step number it did not find');
});

t('every reminder_type PACE actually writes has an explanation', () => {
  // The four writers: index.js wfReminderExecutor (bd_touch|reminder),
  // routes/recruiting/outreach.js (recruiter_task), routes/contacts.js
  // (ooo_return), 10-page-modals.js (manual|meeting).
  for (const type of ['bd_touch', 'reminder', 'recruiter_task', 'ooo_return', 'manual', 'meeting']) {
    const d = describeReminder({ reminder_type: type });
    assert.ok(d.why && d.why.length > 20, `${type} has no sentence`);
  }
});

t('an unknown type says it cannot say, rather than claiming you added it', () => {
  const d = describeReminder({ reminder_type: 'something_new' });
  assert.match(d.why, /cannot say/);
});

// ── 2. "DUE TODAY" IS ONLY SAID ABOUT TODAY ─────────────────────────────────
console.log('\nDue state');

t('THE BUG: a two-day-old reminder is overdue, not "due today"', () => {
  // The five live rows were dated 2026-09-13 and the page announced them as
  // due today on the 15th.
  assert.equal(dueState('2026-09-13', '2026-09-15').state, 'overdue');
  assert.equal(dueLabel('2026-09-13', '2026-09-15'), 'Overdue by 2 days');
});

t('today is due today, tomorrow is tomorrow', () => {
  assert.equal(dueLabel('2026-09-15', '2026-09-15'), 'Due today');
  assert.equal(dueLabel('2026-09-16', '2026-09-15'), 'Due tomorrow');
  assert.equal(dueLabel('2026-09-22', '2026-09-15'), 'Due in 7 days');
  assert.equal(dueLabel('2026-09-14', '2026-09-15'), 'Overdue by 1 day');
});

t('a timestamp-shaped date still compares by day', () => {
  assert.equal(dueState('2026-09-15T00:00:00.000Z', '2026-09-15').state, 'due_today');
});

t('the headline counts the two states separately', () => {
  const rows = [
    { return_date: '2026-09-15' }, { return_date: '2026-09-13' }, { return_date: '2026-09-13' }
  ];
  const h = dueHeadline(rows, '2026-09-15');
  assert.match(h, /3 reminders waiting/);
  assert.match(h, /1 due today/);
  assert.match(h, /2 overdue/);
});

t('month and year boundaries do not move the answer', () => {
  assert.equal(dueLabel('2026-12-31', '2027-01-01'), 'Overdue by 1 day');
  assert.equal(dueLabel('2026-03-01', '2026-02-28'), 'Due tomorrow');
});

// ── 3. ONE TEMPLATE VOCABULARY ──────────────────────────────────────────────
console.log('\nMerge-field vocabulary');

const JOB = { position: 'Superintendent', location: 'Dallas, TX', company: { name: 'KB Home', industry: 'Homebuilding' } };
const CONTACT = { first_name: 'Clare', last_name: 'Duffin', designation: 'Talent Acquisition Manager' };

t('THE BUG: the seeded sequence message fills completely', () => {
  // Verbatim from migration 007, the text behind every one of those five
  // reminders. It filled only {{company}} before, because the sales builder
  // publishes fn/pos and this was written in the recruiting vocabulary.
  const seeded = 'Hi {{first_name}}, I emailed you about the {{position}} role at {{company}} — would love to connect and discuss how we can help fill it.';
  const out = fillTemplate(seeded, buildEmailVars({ job: JOB, contact: CONTACT, senderDisplayName: 'Daniel James' }));
  assert.equal(out, 'Hi Clare, I emailed you about the Superintendent role at KB Home — would love to connect and discuss how we can help fill it.');
  assert.deepEqual(unresolvedVars(out), []);
});

t('the sales vocabulary still fills, unchanged', () => {
  const out = fillTemplate('Hi {{fn}}, about {{pos}} at {{company}} in {{loc}}', buildEmailVars({ job: JOB, contact: CONTACT, senderDisplayName: 'Daniel James' }));
  assert.equal(out, 'Hi Clare, about Superintendent at KB Home in Dallas, TX');
});

t('a sales template fills against the recruiting vocabulary too', () => {
  // buildCandidateVars' shape (routes/recruiting/outreach.js) — the same names
  // seen from the other side.
  const candVars = { first_name: 'Ravi', position: 'HVAC Technician', client: 'Iron Horse', company: 'Iron Horse', location: 'New Britain, CT' };
  assert.equal(fillTemplate('Hi {{fn}} — {{pos}} in {{loc}}', candVars), 'Hi Ravi — HVAC Technician in New Britain, CT');
});

t('a DIRECT hit always beats an alias', () => {
  // company and client mean different things on the recruiting side; aliasing
  // must never overwrite a name the builder actually defines.
  const vars = { company: 'Iron Horse Companies LLC', client: 'Iron Horse' };
  assert.equal(fillTemplate('{{company}} / {{client}}', vars), 'Iron Horse Companies LLC / Iron Horse');
});

t('an aliased sender token is normalised to the name the send path fills', () => {
  // {{sender}} is deliberately left in storage and filled from the mailbox that
  // actually sends. An alias that survived as {{sender_name}} would never be
  // filled by anything — it would ship raw.
  const vars = buildEmailVars({ job: JOB, contact: CONTACT, senderDisplayName: DEFER_SENDER });
  assert.equal(fillTemplate('Thanks, {{sender_name}} ({{sender_email}})', vars), 'Thanks, {{sender}} ({{senderemail}})');
});

t('an unknown variable stays visible rather than being blanked', () => {
  // Blanking sends "Hi ," and looks like nothing went wrong.
  assert.equal(fillTemplate('Hi {{nonsense}}', { fn: 'Clare' }), 'Hi {{nonsense}}');
});

// ── 4. THE SEND GUARD ───────────────────────────────────────────────────────
console.log('\nUnfilled merge fields never ship');

t('unresolvedVars finds the holes and ignores the send-time tokens', () => {
  assert.deepEqual(unresolvedVars('Hi {{fn}}, the {{pos}} role'), ['fn', 'pos']);
  assert.deepEqual(unresolvedVars('Thanks,\n{{sender}}\n{{senderemail}}'), []);
  assert.deepEqual(unresolvedVars('Hi Clare, the Superintendent role'), []);
});

t('each hole is reported once, in the order it appears', () => {
  assert.deepEqual(unresolvedVars('{{pos}} … {{fn}} … {{pos}}'), ['pos', 'fn']);
});

const indexJs = readFileSync(join(root, 'index.js'), 'utf8');
const rsStart = indexJs.indexOf("app.post('/emails/reminder-send'");
const reminderSend = indexJs.slice(rsStart, indexJs.indexOf('emit(EVENTS.OUTREACH_QUEUED, { managerId: req.user.id });', rsStart));

t('the reminder send path fills merge fields SERVER-side', () => {
  // The browser filled from its own cache of leads; when the lead was not in
  // it, the template went through verbatim. The server has the job and the
  // contact the reminder is attached to, and those cannot be stale.
  assert.ok(/buildEmailVars\(\{\s*job,\s*contact: reminderContact/.test(reminderSend), 'must build vars from the reminder\'s own job + contact');
  assert.ok(/filledSubject = fillTemplate\(subject/.test(reminderSend), 'must fill the subject');
  assert.ok(/filledBody = fillTemplate\(body/.test(reminderSend), 'must fill the body');
});

t('...and then REFUSES anything still holding a merge field', () => {
  assert.ok(/unresolvedVars\(filledSubject\)/.test(reminderSend) && /unresolvedVars\(filledBody\)/.test(reminderSend), 'must check both');
  assert.ok(/holes\.length[\s\S]{0,200}status\(400\)/.test(reminderSend), 'must refuse, not blank the token');
});

t('the row inserted is the FILLED text, not what the browser sent', () => {
  assert.ok(/subject: filledSubject, body: filledBody/.test(reminderSend), 'the queued email must carry the filled text');
});

t('DEFER_SENDER is preserved — the sender is still resolved at send time', () => {
  assert.ok(/senderDisplayName: DEFER_SENDER/.test(reminderSend), 'baking a name at queue time is the Session 14 bug');
});

// ── 5. THE COMPOSER KNOWS ITS RECIPIENT ─────────────────────────────────────
console.log('\nCompose from a reminder');

const remindersRoute = readFileSync(join(root, 'routes/reminders.js'), 'utf8');
const coreRender = readFileSync(join(root, 'public/js/03-core-render.js'), 'utf8');
const emailPage = readFileSync(join(root, 'public/js/07-page-email.js'), 'utf8');

t('GET /reminders returns the address, the role and the company', () => {
  assert.ok(/compose: \{/.test(remindersRoute), 'no compose payload');
  for (const field of ['to_email', 'to_name', 'company', 'position', 'job_id', 'contact_id']) {
    assert.ok(new RegExp(`${field}:`).test(remindersRoute), `compose payload missing ${field}`);
  }
});

t('GET /reminders explains every row', () => {
  assert.ok(/source: describeReminder\(r, seq\)/.test(remindersRoute), 'rows must carry their source');
});

t('GET /reminders RENDERS the stored note', () => {
  // The five live rows hold "{{first_name}}" in the database. Rendering on read
  // is how the vocabulary fix reaches rows already written.
  assert.ok(/note: r\.note \? fillTemplate\(r\.note, vars\)/.test(remindersRoute), 'the note must be rendered');
  assert.ok(/note_raw: r\.note/.test(remindersRoute), 'the stored text must survive for editing');
});

t('the composer prefers the reminder over the browser cache', () => {
  assert.ok(/function reminderCompose\(rem\)/.test(coreRender), 'reminderCompose() missing');
  assert.ok(/STATE\.composeReminderTo=rc\.email\?/.test(coreRender), 'the recipient must be handed to the composer');
});

t('the "To" line falls back to the reminder when the lead is not cached', () => {
  assert.ok(/if\(!toEmail&&STATE\.composeReminderTo\)/.test(emailPage), 'compose still resolves only out of STATE.contacts');
});

t('the template fills from the reminder, not from an empty lead', () => {
  const fn = coreRender.slice(coreRender.indexOf('window.applyReminderTemplate'), coreRender.indexOf('window.sendReminderViaEngine'));
  assert.ok(/reminderCompose\(rem\)/.test(fn), 'applyReminderTemplate must read the reminder');
});

t('the browser refuses to send a draft that still has merge fields', () => {
  const fn = coreRender.slice(coreRender.indexOf('window.sendReminderViaEngine'), coreRender.indexOf('window.sendReminderViaEngine') + 2000);
  assert.ok(/holes\.length/.test(fn) && /return;/.test(fn), 'no client-side guard');
});

t('a reminder with an email but no cached contact still offers Compose', () => {
  // The button used to be drawn only when r.contact resolved, so a reminder
  // carrying a perfectly good address had no way to act on it.
  const page = readFileSync(join(root, 'public/js/10-page-modals.js'), 'utf8');
  const cards = page.slice(page.indexOf('var dueCards=due.map'), page.indexOf('var upcomingRows='));
  assert.ok(/toEmail\?'<button class="btn btn-sm"/.test(cards), 'Compose must be gated on an address, not on a cache hit');
  assert.ok(/No email on record/.test(cards), 'a reminder with no address must say so');
});

t('the due card states why it exists', () => {
  const page = readFileSync(join(root, 'public/js/10-page-modals.js'), 'utf8');
  const cards = page.slice(page.indexOf('var dueCards=due.map'), page.indexOf('var upcomingRows='));
  assert.ok(/reminderWhy\(r\)/.test(cards), 'the card must render its source');
  assert.ok(/reminderDue\(r\)/.test(cards), 'the card must render its real due state');
});

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
