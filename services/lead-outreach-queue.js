// ============================================================================
// THE LEAD ENGINE'S FIRST EMAILS — which pending emails to write for which leads (moved out of index.js, 8 Oct, D-0104,
// unchanged except the sequence rule below, so a test can reach it).
//
// A person STARTS outreach only with a sequence of their own: a lead whose owner has none gets no email written, and is
// reported back (needsSequence). Mail already queued is untouched, a follow-up is not "starting", and individual emails do
// not come through here at all.
// ============================================================================
const { emailSyntaxValid } = require('../email-validation');
const { buildEmailVars, fillTemplate, resolveTemplate, DEFER_SENDER, buildRotatingTemplateDeck, isRandomTemplateMode } = require('../email-vars');
const sequenceStarter = require('./sequence-starter');
const wording = require('./wording-scope');

function buildPendingEmailsFromJobs(jobs, callerUserId, bdMap, bdPrimaryEmailMap, tmplSettings, alreadyOutreached) {
  const tasksByBd = {};
  let contactsSkipped = 0;
  let alreadyOutreachedSkipped = 0;
  const outreachedSet = alreadyOutreached instanceof Set ? alreadyOutreached : new Set();

  for (const job of jobs) {
    const bd = bdMap[job.assigned_to_bd] || { id: callerUserId, name: '', email: '' };
    let contacts = (job.contacts || []).filter(c => emailSyntaxValid(c.email));
    // Skip contacts already sent (or queued) an initial outreach for this job —
    // prevents duplicate cold emails to the same POC on re-generation.
    contacts = contacts.filter(c => {
      if (outreachedSet.has(`${job.id}:${c.id}`)) { alreadyOutreachedSkipped++; return false; }
      return true;
    });
    if (!contacts.length) {
      contactsSkipped++;
      continue;
    }
    if (!tasksByBd[bd.id]) tasksByBd[bd.id] = [];
    for (const contact of contacts) {
      tasksByBd[bd.id].push({ job, contact, bd });
    }
  }

  const emailsToInsert = [];
  // A person starts outreach only with a sequence of their OWN (owner, 8 Oct, D-0104). Without one, nothing is written for their
  // leads and the caller is told whose they are — this is the place BOTH ways of starting outreach go through. Mail already queued
  // is untouched (it was written before), individual emails never come through here, and a follow-up is not "starting".
  const needsSequence = [];
  // Which email ID a task goes out from — the lead's own, else the person's primary (the same choice the row's from_email makes below).
  const mailboxIdOf = (task) => (task.job.sending_email && task.job.sending_email.id) || task.job.sending_email_id || (bdPrimaryEmailMap[task.bd.id] && bdPrimaryEmailMap[task.bd.id].id) || '';
  for (const bdId of Object.keys(tasksByBd)) {
    const allTasks = tasksByBd[bdId];
    // R-176 (D-0111): a person who chose "a wording for each email ID" may start outreach from an email ID that has a first email of its
    // own even with no sequence of their own; every other email ID of theirs falls back to their wording, or is reported as needing one.
    const personOk = sequenceStarter.hasOwnSequence(tmplSettings, bdId);
    const tasks = allTasks.filter(t => personOk || wording.mailboxHasOwnSequence(tmplSettings, bdId, mailboxIdOf(t)));
    if (tasks.length < allTasks.length) {
      const stuck = allTasks.filter(t => !tasks.includes(t));
      needsSequence.push({ user_id: bdId, name: (bdMap[bdId] && bdMap[bdId].name) || '', leads: new Set(stuck.map(t => t.job.id)).size });
    }
    if (!tasks.length) continue;
    const useRandom = isRandomTemplateMode(tmplSettings[`u_${bdId}_random_template_mode`]);
    // An email ID with wording of its own does not take part in the random rotation — its own text is what it sends.
    const rotating = useRandom ? tasks.filter(t => !wording.mailboxHasOwnSequence(tmplSettings, bdId, mailboxIdOf(t))) : [];
    const deck = useRandom ? buildRotatingTemplateDeck(rotating.length) : null;
    if (useRandom) {
      console.log(`[GenerateEmails] Random template rotation for BD ${bdId}: ${rotating.length} emails across ${deck.length} slots`);
    }

    tasks.forEach((task) => {
      const { job, contact, bd } = task;
      try {
        const mbId = mailboxIdOf(task);
        const ownWording = wording.mailboxHasOwnSequence(tmplSettings, bd.id, mbId);
        const rIdx = rotating.indexOf(task);
        const variant = deck && rIdx >= 0 ? deck[rIdx] : null;
        const subjTmpl = variant
          ? variant.o1.subject
          : resolveTemplate(ownWording ? wording.mailboxOwn(tmplSettings, bd.id, mbId, 'tmpl_o1_subject') : tmplSettings[`u_${bd.id}_tmpl_o1_subject`], 'o1_subject');
        const bodyTmpl = variant
          ? variant.o1.body
          : resolveTemplate(ownWording ? wording.mailboxOwn(tmplSettings, bd.id, mbId, 'tmpl_o1_body') : tmplSettings[`u_${bd.id}_tmpl_o1_body`], 'o1_body');
        // Leave {{sender}} in the queued text. Which mailbox sends this row is
        // decided at SEND time (the lead's mailbox can change, or a sequence can
        // rotate it), and the signature is filled from that same mailbox — so
        // baking a name here is how the body and the signature end up naming two
        // different people.
        const vars = buildEmailVars({ job, contact, senderDisplayName: DEFER_SENDER });
        const subject = fillTemplate(subjTmpl, vars);
        const body = fillTemplate(bodyTmpl, vars);
        const resolvedSendingEmail = job.sending_email || bdPrimaryEmailMap[bd.id];
        const sendingEmailAddress = resolvedSendingEmail?.email_address || '';
        const row = {
          contact_id: contact.id,
          job_id: job.id,
          to_email: contact.email,
          subject,
          body,
          platform: 'Outlook',
          sent_by: bd.id,
          from_email: sendingEmailAddress,
          status: 'pending'
        };
        if (variant?.id) row.template_variant = variant.id;
        emailsToInsert.push(row);
      } catch (e) {
        console.error(`[GenerateEmails] contact error (${contact.email}):`, e.message);
      }
    });
  }

  return { emailsToInsert, contactsSkipped, alreadyOutreachedSkipped, needsSequence };
}

module.exports = { buildPendingEmailsFromJobs };
