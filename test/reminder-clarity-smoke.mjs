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
  // Gated on an address (and, since D-0018, on the send being allowed) — never
  // on whether the browser happened to have the contact cached.
  assert.ok(/toEmail&&cmp\.can_send!==false\?'<button class="btn btn-sm"/.test(cards), 'Compose must be gated on an address, not on a cache hit');
  assert.ok(/No email on record/.test(cards), 'a reminder with no address must say so');
});

t('the due card states why it exists', () => {
  const page = readFileSync(join(root, 'public/js/10-page-modals.js'), 'utf8');
  const cards = page.slice(page.indexOf('var dueCards=due.map'), page.indexOf('var upcomingRows='));
  assert.ok(/reminderWhy\(r\)/.test(cards), 'the card must render its source');
  assert.ok(/reminderDue\(r\)/.test(cards), 'the card must render its real due state');
});

// ── 6. A TASK NOBODY CAN DO, AND A SEND THAT WILL BE REFUSED ────────────────
// Owner's decisions, 2026-09-15 (DECISIONS.md D-0017 / D-0018), from seven live
// tasks that all read "Call the POC about this role and connect on LinkedIn"
// for contacts holding no phone and no LinkedIn — while the same sequence went
// on to send follow-up 2 that morning and complete.
console.log('\nA call task must be doable, and a blocked send must not be offered');

const { describeOutreach, sendIsBlocked, canBeContactedDirectly, callTaskSkipReason } = require('../services/outreach-dedup.js');
const TODAY = '2026-09-15';

t('D-0017: no phone and no LinkedIn means the call cannot be made', () => {
  assert.equal(canBeContactedDirectly({ phone: null, linkedin: null }), false);
  assert.equal(canBeContactedDirectly({ phone: '', linkedin: '   ' }), false);
  assert.equal(canBeContactedDirectly({ phone: '+1 555 0100' }), true);
  assert.equal(canBeContactedDirectly({ linkedin: 'https://linkedin.com/in/x' }), true);
});

t('D-0017: THE BUG — a call task is not created when there is no way to call', () => {
  // The seven live rows, exactly: a bd_touch step against a contact with
  // neither field set.
  assert.equal(callTaskSkipReason({ channel: 'bd_touch' }, { phone: null, linkedin: null }), 'no_phone_or_linkedin');
});

t('D-0017: a contact who CAN be reached still gets the task', () => {
  assert.equal(callTaskSkipReason({ channel: 'bd_touch' }, { phone: '+1 555 0100' }), null);
  assert.equal(callTaskSkipReason({ channel: 'bd_touch' }, { linkedin: 'https://linkedin.com/in/x' }), null);
});

t('the generic `reminder` channel is NOT gated — only the call step is', () => {
  // A bare reachability check would silently kill every generic task too.
  assert.equal(callTaskSkipReason({ channel: 'reminder' }, { phone: null, linkedin: null }), null);
  assert.equal(callTaskSkipReason({}, { phone: null, linkedin: null }), null);
});

// WHAT THIS PAIR DOES AND DOES NOT PROVE. The rule itself is exercised for real
// above. The call site can only be GREPPED, because wfReminderExecutor is a
// closure inside index.js that needs a live Supabase to run — so a call site
// left in place but neutered (`false && callTaskSkipReason(...)`) would still
// pass. That was measured, not assumed. It is accepted because the realistic
// regressions — changing the rule, dropping the call, renaming the reason — are
// all caught; a deliberately dead call site is not a shape anybody writes by
// accident. If the executor ever becomes reachable from a test, close this gap.
t('the executor calls that function and records the reason as SKIPPED', () => {
  const src = readFileSync(join(root, 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function wfReminderExecutor'), src.indexOf('wfEngine.registerChannel(\'bd_touch\''));
  assert.ok(/callTaskSkipReason\(step, contact\)/.test(fn), 'the executor must use the shared decision');
  assert.ok(/outcome: 'skipped', detail: \{ reason: skipReason/.test(fn), 'skipped with the reason, never failed and never silent');
});

t('THE BUG: fu2 sent today blocks another send, and says which reason', () => {
  // Jesus Montes, Iron Horse: fu1 sent 12 Sep, fu2 sent 15 Sep. Composing on the
  // 15th got "Send failed" only AFTER the email was written.
  const rows = [
    { followup_type: 'fu1', status: 'sent', sent_at: '2026-09-12' },
    { followup_type: 'fu2', status: 'sent', sent_at: '2026-09-15' }
  ];
  const o = describeOutreach(rows, TODAY);
  assert.equal(o.blocked, true);
  assert.equal(o.block_reason, 'sent_today');
  assert.match(o.block_sentence, /already went to this contact today/);
  assert.equal(o.sent_count, 2);
  assert.equal(o.last_sent_at, '2026-09-15');
});

t('a queued follow-up blocks for a DIFFERENT, separately-worded reason', () => {
  const o = describeOutreach([{ followup_type: 'fu2', status: 'pending', sent_at: null }], TODAY);
  assert.equal(o.blocked, true);
  assert.equal(o.block_reason, 'queued');
  assert.match(o.block_sentence, /waiting in the send queue/);
});

t('yesterday\'s send does not block — one touch per day, not one ever', () => {
  const o = describeOutreach([{ followup_type: 'fu2', status: 'sent', sent_at: '2026-09-14' }], TODAY);
  assert.equal(o.blocked, false);
  assert.equal(o.sent_count, 1);
});

t('the INITIAL outreach never blocks a follow-up', () => {
  // The cold email is the thing a follow-up follows.
  const rows = [{ followup_type: null, status: 'sent', sent_at: TODAY }];
  assert.equal(sendIsBlocked(rows, TODAY), false);
  assert.equal(describeOutreach(rows, TODAY).sent_count, 1, 'but it still counts in the trail');
});

t('the trail is ordered oldest first and dated', () => {
  const o = describeOutreach([
    { followup_type: 'fu2', status: 'sent', sent_at: '2026-09-15' },
    { followup_type: null, status: 'sent', sent_at: '2026-09-10' },
    { followup_type: 'fu1', status: 'sent', sent_at: '2026-09-12' }
  ], TODAY);
  assert.deepEqual(o.trail.map(x => x.type), ['initial', 'fu1', 'fu2']);
  assert.deepEqual(o.trail.map(x => x.sent_at), ['2026-09-10', '2026-09-12', '2026-09-15']);
});

t('index.js and the page share ONE copy of the rule', () => {
  const src = readFileSync(join(root, 'index.js'), 'utf8');
  assert.ok(/require\('\.\/services\/outreach-dedup'\)/.test(src), 'index.js must import the shared rule');
  // The old local definition must be gone, not shadowed by a second copy.
  assert.ok(!/^const FOLLOWUP_EMAIL_TYPES = \['fu1'/m.test(src), 'a second copy of the type list is how these drift apart');
});

t('D-0018: GET /reminders reports the trail and refuses the send up front', () => {
  const route = readFileSync(join(root, 'routes/reminders.js'), 'utf8');
  assert.ok(/describeOutreach\(mailByPair\[pairKey\] \|\| \[\], t\)/.test(route), 'the read must describe the outreach');
  assert.ok(/can_send: [^\n]*&& !outreach\.blocked/.test(route), 'can_send must honour the block');
  assert.ok(/blocked_sentence: outreach\.blocked/.test(route), 'and must carry the reason to the page');
});

t('D-0018: the task survives the sequence finishing', () => {
  // The owner chose "stays open, shows what has happened since". Nothing may
  // close a reminder because its sequence completed.
  const route = readFileSync(join(root, 'routes/reminders.js'), 'utf8');
  assert.ok(!/status: 'sent'[\s\S]{0,200}completed/.test(route), 'the read must not close tasks');
  const page = readFileSync(join(root, 'public/js/10-page-modals.js'), 'utf8');
  assert.ok(/reminderOutreachLine\(r\)/.test(page), 'the card must show what has happened since');
});

t('the card hides the Send it cannot make, and the composer refuses early', () => {
  const page = readFileSync(join(root, 'public/js/10-page-modals.js'), 'utf8');
  const cards = page.slice(page.indexOf('var dueCards=due.map'), page.indexOf('var upcomingRows='));
  assert.ok(/cmp\.can_send!==false\?'<button/.test(cards), 'a blocked send must not be offered as a button');
  const core = readFileSync(join(root, 'public/js/03-core-render.js'), 'utf8');
  assert.ok(/blocked_sentence[\s\S]{0,160}showToast\(blocked/.test(core), 'composing must refuse with the server\'s own sentence');
});

t('a call task with contact details shows them; without, it says so', () => {
  const page = readFileSync(join(root, 'public/js/10-page-modals.js'), 'utf8');
  assert.ok(/function reminderReachLine\(r\)/.test(page));
  assert.ok(/re\.reachable/.test(page), 'must branch on whether the call can be made');
});

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
