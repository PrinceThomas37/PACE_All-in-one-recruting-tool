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
  for (const bdId of Object.keys(tasksByBd)) {
    const tasks = tasksByBd[bdId];
    if (!sequenceStarter.hasOwnSequence(tmplSettings, bdId)) {
      needsSequence.push({ user_id: bdId, name: (bdMap[bdId] && bdMap[bdId].name) || '', leads: new Set(tasks.map(t => t.job.id)).size });
      continue;
    }
    const useRandom = isRandomTemplateMode(tmplSettings[`u_${bdId}_random_template_mode`]);
    const deck = useRandom ? buildRotatingTemplateDeck(tasks.length) : null;
    if (useRandom) {
      console.log(`[GenerateEmails] Random template rotation for BD ${bdId}: ${tasks.length} emails across ${deck.length} slots`);
    }

    tasks.forEach((task, idx) => {
      const { job, contact, bd } = task;
      try {
        const variant = deck ? deck[idx] : null;
        const subjTmpl = variant
          ? variant.o1.subject
          : resolveTemplate(tmplSettings[`u_${bd.id}_tmpl_o1_subject`], 'o1_subject');
        const bodyTmpl = variant
          ? variant.o1.body
          : resolveTemplate(tmplSettings[`u_${bd.id}_tmpl_o1_body`], 'o1_body');
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
