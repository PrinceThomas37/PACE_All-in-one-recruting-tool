// ============================================================================
// RECRUITING OUTREACH — the recruiting half of the workflow engine, plus the
// candidate/client email and interview/meeting endpoints.
//
// Extracted from index.js, which is a SALES-oriented file (the lead engine, the
// send loop, the follow-up engine). This block was ~547 lines of recruiting
// logic sitting inside it — the single biggest thing in there that did not
// belong. Nothing about behaviour changed in the move.
//
// What lives here:
//   • workflow context loaders for `submission` and `candidate`
//   • the candidate_email / recruiter_task / submission_stage_move /
//     candidate_status_move channels
//   • POST /candidates/email, POST /companies/:id/email
//   • POST /submissions/:id/interview-invite, /create-meeting, POST /meetings
//   • exitCandidateSequences + the reply/unsubscribe handlers that call it
//
// It is mounted from index.js AFTER wfEngine is constructed — that ordering is
// load-bearing and is why this is a call, not a plain require at the top.
// ============================================================================

const { EVENTS, on } = require('../../events');
const { fillTemplate } = require('../../email-vars');
const { emailSyntaxValid } = require('../../email-validation');
const { newToken: newTrackToken, injectPixel: injectTrackPixel } = require('../../email-tracking');

module.exports = function (app, ctx) {
  const {
    supabase, auth, hasRole, today, wfEngine, gmailProvider, config, settingsConfig,
    graphMailRequest, sendMicrosoftNewMessage, buildHtmlEmailBody,
    getMailboxSignature, getMicrosoftToken, warmupLimit,
    isSendingPaused, isManagerPaused, loadMailboxDelivState, loadSuppressedSet,
    friendlySendError,
  } = ctx;

wfEngine.registerContextLoader('submission', async (enrollment) => {
  const { data: sub } = await supabase.from('submissions')
    .select('*, candidate:candidates(*), job_order:job_orders(*, company:companies(name))')
    .eq('id', enrollment.entity_id).is('deleted_at', null).maybeSingle();
  if (!sub) return null;
  return { submission: sub, candidate: sub.candidate || null, job_order: sub.job_order || null };
});

// entity_type 'candidate' — nurture a person who is NOT attached to a job:
// someone in the database worth staying in touch with, an applicant we're not
// ready to submit, a past placement. entity_id = candidates.id, job_id stays
// null (the enrollments FK points at `jobs`, the sales table, not job_orders).
//
// This loader is what made the Candidates page's "Add to email sequence" button
// a no-op: without it the engine handed every step an empty context, so
// candidate_email read an undefined candidate, returned "no_candidate_email",
// and the enrollment marched to `completed` without ever sending. It looked like
// it had worked. Returning null for a missing candidate is deliberate — that
// makes the engine exit the enrollment as `entity_missing` instead.
wfEngine.registerContextLoader('candidate', async (enrollment) => {
  const { data: cand } = await supabase.from('candidates')
    .select('*').eq('id', enrollment.entity_id).is('deleted_at', null).maybeSingle();
  if (!cand) return null;
  return { candidate: cand, job_order: null, submission: null };
});

// The recruiter's connected sending mailbox (primary first), or null if none.
// Checks both Microsoft (Graph) and Gmail tokens — callers dispatch the actual
// send by mailbox.platform via sendMailboxNewMessage().
async function recruiterSendingMailbox(recruiterId) {
  if (!recruiterId) return null;
  const { data: mailboxes } = await supabase.from('user_emails')
    .select('id,email_address,display_name,is_primary,is_active,daily_send_limit,platform')
    .eq('user_id', recruiterId).order('is_primary', { ascending: false });
  if (!mailboxes?.length) return null;
  const ids = mailboxes.map(m => m.id);
  const [{ data: msTokens }, { data: gmailTokens }] = await Promise.all([
    supabase.from('microsoft_tokens').select('user_email_id').in('user_email_id', ids),
    supabase.from('gmail_tokens').select('user_email_id').in('user_email_id', ids)
  ]);
  const connected = new Set([...(msTokens || []), ...(gmailTokens || [])].map(t => t.user_email_id));
  return mailboxes.find(m => connected.has(m.id) && m.is_active !== false) || null;
}

// Dispatch a fresh outbound message by the mailbox's connected platform —
// the Microsoft/Gmail counterpart to sendMicrosoftNewMessage alone. Both
// providers return a message + thread/conversation id in the same shape.
async function sendMailboxNewMessage(mailbox, { to, subject, htmlBody, attachments }) {
  if (mailbox.platform === 'Gmail') {
    const r = await gmailProvider.sendNewMessage(mailbox.id, { to, subject, htmlBody, attachments, fromAddress: mailbox.email_address });
    return { graphMessageId: r.messageId, conversationId: r.threadId || null, inReplyTo: null };
  }
  return sendMicrosoftNewMessage(mailbox.id, { to, subject, htmlBody, attachments });
}

// Resolve document_ids (from candidate_documents or client_documents) into
// {filename, contentType, base64} attachment payloads, downloading each from
// the private candidate-docs bucket. Best-effort: a document that fails to
// download is silently skipped rather than blocking the whole send. Caps
// total attached bytes so a send can't blow past provider/API limits.
const MAX_EMAIL_ATTACH_BYTES = 18 * 1024 * 1024;
async function resolveEmailAttachments(table, ids) {
  if (!ids || !ids.length) return [];
  const { data: docs } = await supabase.from(table).select('id,filename,content_type,storage_path')
    .in('id', ids).is('deleted_at', null);
  const out = [];
  let total = 0;
  for (const d of (docs || [])) {
    try {
      const { data, error } = await supabase.storage.from('candidate-docs').download(d.storage_path);
      if (error || !data) continue;
      const buf = Buffer.from(await data.arrayBuffer());
      if (total + buf.length > MAX_EMAIL_ATTACH_BYTES) continue;
      total += buf.length;
      out.push({ filename: d.filename, contentType: d.content_type || 'application/octet-stream', base64: buf.toString('base64') });
    } catch (_) { /* skip this one, best-effort */ }
  }
  return out;
}

// A specific mailbox by id, but only if it's active AND connected — used by
// sequence rotation so a chosen "from" mailbox that can't actually send is
// rejected (caller falls back to the recruiter's primary).
async function connectedMailboxById(id) {
  if (!id) return null;
  const { data: mb } = await supabase.from('user_emails')
    .select('id,email_address,display_name,is_primary,is_active,daily_send_limit,platform')
    .eq('id', id).maybeSingle();
  if (!mb || mb.is_active === false) return null;
  const tokenTable = mb.platform === 'Gmail' ? 'gmail_tokens' : 'microsoft_tokens';
  const { data: tok } = await supabase.from(tokenTable).select('user_email_id').eq('user_email_id', id).maybeSingle();
  return tok ? mb : null;
}

function buildCandidateVars({ candidate, job_order }) {
  const first = (candidate?.full_name || '').trim().split(/\s+/)[0] || 'there';
  return {
    first_name: first, full_name: candidate?.full_name || '', title: candidate?.current_title || '',
    location: candidate?.current_location || '', position: job_order?.job_title || '',
    client: job_order?.client || job_order?.company?.name || '', company: job_order?.company?.name || job_order?.client || '',
    job_code: job_order?.job_code || ''
  };
}

const DEFAULT_CANDIDATE_EMAIL = {
  subject: 'Opportunity: {{position}}',
  body: 'Hi {{first_name}},<br><br>I came across your profile and thought of a {{position}} role we\'re working on with {{client}}. Would you be open to a quick chat about it?<br><br>Best regards'
};

// The same template with no job attached renders "Opportunity: " and "a  role
// we're working on with ." — every job variable degrades to an empty string. A
// candidate-only sequence is a keeping-in-touch message, not a pitch for a
// specific req, so it needs its own wording that reads correctly with nothing
// but a name.
const DEFAULT_CANDIDATE_NURTURE_EMAIL = {
  subject: 'Keeping in touch',
  body: 'Hi {{first_name}},<br><br>Checking in to see how things are going and whether you are open to hearing about new roles at the moment. If the timing is not right, just say so and I will leave it a while.<br><br>Best regards'
};

// Pick the right default for the context we actually have.
function defaultCandidateTemplate(job_order) {
  return job_order ? DEFAULT_CANDIDATE_EMAIL : DEFAULT_CANDIDATE_NURTURE_EMAIL;
}

// candidate_email — sends to the candidate through the recruiter's connected
// mailbox (same Graph path as sales outreach), respecting pause + a daily cap.
wfEngine.registerChannel('candidate_email', async ({ step, enrollment, context }) => {
  const { candidate, job_order, submission } = context;
  const cfg = step.config || {};
  if (!candidate?.email || !emailSyntaxValid(candidate.email)) return { outcome: 'skipped', detail: { reason: 'no_candidate_email' } };
  const suppressed = await loadSuppressedSet([candidate.email]);
  if (suppressed.has(String(candidate.email).toLowerCase())) return { outcome: 'skipped', detail: { reason: 'suppressed' } };
  const recruiterId = submission?.recruiter_id || enrollment.enrolled_by;
  if (isSendingPaused() || isManagerPaused(recruiterId)) return { outcome: 'defer', detail: { reason: 'paused' } };
  // Rotation: prefer this enrollment's chosen "from" mailbox (if active +
  // connected), else the recruiter's primary connected mailbox.
  const cMeta = enrollment.metadata || {};
  const mailbox = (cMeta.from_mailbox_id && await connectedMailboxById(cMeta.from_mailbox_id)) || await recruiterSendingMailbox(recruiterId);
  if (!mailbox) return { outcome: 'defer', detail: { reason: 'no_connected_mailbox' } };
  // Deliverability gates, matching what the sales `email` channel already
  // applies. This path skipped them, so an automated candidate sequence could
  // keep sending from a mailbox the bounce sweep had auto-paused, and ignore the
  // warm-up ramp entirely — the two things most likely to burn a domain.
  if (mailbox.is_active === false) return { outcome: 'defer', detail: { reason: 'mailbox_inactive' } };
  const delivState = await loadMailboxDelivState([mailbox.id]);
  if (delivState[mailbox.id]?.auto_paused_at) return { outcome: 'defer', detail: { reason: 'mailbox_autopaused' } };
  const { data: sendLog } = await supabase.from('email_send_log').select('id,emails_sent').eq('send_date', today()).eq('user_email_id', mailbox.id).maybeSingle();
  const base = mailbox.daily_send_limit || 150;
  const [warmupStart, warmupStep] = await Promise.all([
    settingsConfig.getSetting(supabase, 'mailbox_warmup_start'),
    settingsConfig.getSetting(supabase, 'mailbox_warmup_step'),
  ]);
  const wl = warmupLimit(delivState[mailbox.id], warmupStart, warmupStep);
  const cap = wl ? Math.min(base, wl) : base;
  if ((sendLog?.emails_sent || 0) >= cap) return { outcome: 'defer', detail: { reason: 'quota' } };

  const tmpl = defaultCandidateTemplate(job_order);
  const vars = buildCandidateVars({ candidate, job_order });
  const subject = fillTemplate(cfg.subject || tmpl.subject, vars);
  const rendered = fillTemplate(cfg.body || tmpl.body, vars);
  try {
    // Tracked, exactly like the one-off POST /candidates/email path. Sequence
    // sends previously carried no pixel and wrote no email_tracking row, so they
    // were invisible: no opens, no replies, nothing on the candidate's profile —
    // and, because reply detection keys off email_tracking, no way for a reply
    // to stop the sequence.
    const signature = await getMailboxSignature(mailbox.id, recruiterId).catch(() => '');
    const token = newTrackToken();
    const htmlBody = injectTrackPixel(buildHtmlEmailBody(rendered, signature), token);

    const r = await sendMailboxNewMessage(mailbox, { to: candidate.email, subject, htmlBody });

    try {
      await supabase.from('email_tracking').insert({
        token, channel: 'candidate_sequence',
        candidate_id: candidate.id, job_order_id: job_order?.id || null,
        to_email: candidate.email, subject,
        sent_by: recruiterId, mailbox_email: mailbox.email_address || null,
        ...(enrollment.org_id ? { org_id: enrollment.org_id } : {})
      });
    } catch (_) { /* tracking must never fail a send that already went out */ }

    await supabase.from('email_send_log').upsert(
      { user_email_id: mailbox.id, send_date: today(), emails_sent: (sendLog?.emails_sent || 0) + 1 },
      { onConflict: 'user_email_id,send_date' }
    );
    try { await supabase.from('candidates').update({ last_contact_at: new Date() }).eq('id', candidate.id); } catch (_) {}

    if (submission?.id) await supabase.from('submission_activity').insert({
      submission_id: submission.id, job_order_id: job_order?.id || null, recruiter_id: recruiterId,
      action: 'sequence_email_sent', note: `${step.name}: emailed ${candidate.email}`
    });
    return { outcome: 'done', detail: { to: candidate.email, graph_message_id: r.graphMessageId, tracked: true } };
  } catch (e) { return { outcome: 'failed', detail: { error: e.message } }; }
}, { entity_types: ['submission', 'candidate'], label: 'Email the candidate', domains: ['recruiting'] });

// One-off TRACKED candidate email (not the sequence): send the job/invite to the
// selected candidates through the recruiter's connected mailbox, embedding an
// open-tracking pixel and recording an email_tracking row per recipient. Returns
// a clear 409 (no_connected_mailbox) so the UI can fall back to the mail app.
app.post('/candidates/email', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const recipients = Array.isArray(b.recipients) ? b.recipients : [];
    const subject = String(b.subject || '').trim();
    const bodyText = String(b.body || '');
    if (!recipients.length) return res.status(400).json({ error: 'No recipients.' });
    if (!subject) return res.status(400).json({ error: 'Subject is required.' });

    const mailbox = await recruiterSendingMailbox(req.user.id);
    if (!mailbox) return res.status(409).json({ error: 'no_connected_mailbox' });

    const signature = await getMailboxSignature(mailbox.id, req.user.id).catch(() => '');
    const suppressed = await loadSuppressedSet(recipients.map(r => r.email).filter(Boolean));
    const attachments = await resolveEmailAttachments('candidate_documents', b.document_ids);
    const orgId = req.orgId || null;
    const results = [];
    for (const r of recipients) {
      const to = String(r.email || '').trim();
      if (!to || !emailSyntaxValid(to)) { results.push({ email: to, status: 'skipped', reason: 'invalid_email' }); continue; }
      if (suppressed.has(to.toLowerCase())) { results.push({ email: to, status: 'skipped', reason: 'suppressed' }); continue; }
      const token = newTrackToken();
      const htmlBody = injectTrackPixel(buildHtmlEmailBody(bodyText, signature), token);
      try {
        await sendMailboxNewMessage(mailbox, { to, subject, htmlBody, attachments });
        await supabase.from('email_tracking').insert({
          token, channel: 'candidate', candidate_id: r.candidate_id || null,
          job_order_id: b.job_order_id || null, to_email: to, subject,
          sent_by: req.user.id, mailbox_email: mailbox.email_address || null,
          ...(orgId ? { org_id: orgId } : {})
        });
        results.push({ email: to, status: 'sent', candidate_id: r.candidate_id || null });
      } catch (e) {
        results.push({ email: to, status: 'failed', reason: e.message });
      }
    }
    const sentCount = results.filter(x => x.status === 'sent').length;
    if (sentCount) {
      const { data: sendLog } = await supabase.from('email_send_log')
        .select('id,emails_sent').eq('send_date', today()).eq('user_email_id', mailbox.id).maybeSingle();
      await supabase.from('email_send_log').upsert(
        { user_email_id: mailbox.id, send_date: today(), emails_sent: (sendLog?.emails_sent || 0) + sentCount },
        { onConflict: 'user_email_id,send_date' }
      );
    }
    res.json({ mailbox: mailbox.email_address, sent: sentCount, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Tracked email to a client contact, with optional client-document
// attachments — the client-side counterpart to /candidates/email. BD only
// (clients are a BD concept; recruiters only ever email candidates).
app.post('/companies/:id/email', auth, async (req, res) => {
  try {
    if (!hasRole(req, 'admin', 'bd', 'bd_lead')) return res.status(403).json({ error: 'BD role required.' });
    const b = req.body || {};
    const to = String(b.to || '').trim();
    const subject = String(b.subject || '').trim();
    const bodyText = String(b.body || '');
    if (!to || !emailSyntaxValid(to)) return res.status(400).json({ error: 'A valid recipient email is required.' });
    if (!subject) return res.status(400).json({ error: 'Subject is required.' });

    const mailbox = await recruiterSendingMailbox(req.user.id);
    if (!mailbox) return res.status(409).json({ error: 'no_connected_mailbox' });

    const suppressed = await loadSuppressedSet([to]);
    if (suppressed.has(to.toLowerCase())) return res.status(409).json({ error: 'This address has opted out of email from us.' });

    const signature = await getMailboxSignature(mailbox.id, req.user.id).catch(() => '');
    const attachments = await resolveEmailAttachments('client_documents', b.document_ids);
    const token = newTrackToken();
    const htmlBody = injectTrackPixel(buildHtmlEmailBody(bodyText, signature), token);
    const orgId = req.orgId || null;
    await sendMailboxNewMessage(mailbox, { to, subject, htmlBody, attachments });
    await supabase.from('email_tracking').insert({
      token, channel: 'client', company_id: req.params.id, to_email: to, subject,
      sent_by: req.user.id, mailbox_email: mailbox.email_address || null,
      ...(orgId ? { org_id: orgId } : {})
    });
    const { data: sendLog } = await supabase.from('email_send_log')
      .select('id,emails_sent').eq('send_date', today()).eq('user_email_id', mailbox.id).maybeSingle();
    await supabase.from('email_send_log').upsert(
      { user_email_id: mailbox.id, send_date: today(), emails_sent: (sendLog?.emails_sent || 0) + 1 },
      { onConflict: 'user_email_id,send_date' }
    );
    res.json({ mailbox: mailbox.email_address, sent: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function firstNameOf(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; }

// Build the interview-invitation message (plain text; buildHtmlEmailBody wraps it).
function buildInterviewInviteText(sub, candidate, job, role) {
  const dt = sub.interview_at ? new Date(sub.interview_at) : null;
  const when = dt ? dt.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'To be confirmed';
  const type = sub.interview_type || (sub.interview_link ? 'virtual' : (sub.interview_address ? 'in_person' : ''));
  const lines = [];
  lines.push('Hi ' + firstNameOf(role === 'candidate' ? candidate.full_name : (job.bd_manager && job.bd_manager.name)) + ',', '');
  lines.push(role === 'candidate'
    ? 'Your interview has been scheduled. Here are the details:'
    : ('An interview has been scheduled for ' + (candidate.full_name || 'the candidate') + ':'), '');
  lines.push('Position: ' + (job.job_title || '—'));
  const company = job.client || (job.company && job.company.name);
  if (company) lines.push('Company: ' + company);
  if (role !== 'candidate') lines.push('Candidate: ' + (candidate.full_name || '—'));
  lines.push('Date & time: ' + when);
  if (type === 'virtual') {
    lines.push('Format: Virtual' + (sub.interview_platform ? ' (' + sub.interview_platform + ')' : ''));
    if (sub.interview_link) lines.push('Join link / meeting ID: ' + sub.interview_link);
  } else if (type === 'in_person') {
    lines.push('Format: In person');
    if (sub.interview_address) lines.push('Address: ' + sub.interview_address);
    else if (job.city || job.state) lines.push('Location: ' + [job.city, job.state].filter(Boolean).join(', '));
  } else if (type === 'phone') {
    lines.push('Format: Phone call');
    if (sub.interview_link) lines.push('Number: ' + sub.interview_link);
  } else if (sub.interview_location) {
    lines.push('Location: ' + sub.interview_location);
  }
  const ivs = Array.isArray(sub.interviewers) ? sub.interviewers.filter(Boolean) : [];
  if (ivs.length) lines.push('Interviewer' + (ivs.length > 1 ? 's' : '') + ': ' + ivs.join(', '));
  lines.push('', 'Please let us know if you have any questions or need to reschedule.', '', 'Best regards');
  return lines.join('\n');
}

// Email the interview details to the candidate and/or the BD manager.
app.post('/submissions/:id/interview-invite', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const roles = Array.isArray(b.recipients) ? b.recipients : [];
    const wantCandidate = roles.includes('candidate') || b.candidate === true;
    const wantBd = roles.includes('bd_manager') || b.bd_manager === true;
    if (!wantCandidate && !wantBd) return res.status(400).json({ error: 'Pick at least one recipient.' });

    const { data: sub, error } = await supabase.from('submissions')
      .select('id, interview_at, interview_location, interview_type, interview_platform, interview_link, interview_address, interviewers, candidate_id, job_order_id, candidate:candidates(id,full_name,email), job:job_orders(id,job_title,client,city,state,company:companies(name), bd_manager:users!bd_manager_id(id,name,email))')
      .eq('id', req.params.id).single();
    if (error || !sub) return res.status(404).json({ error: 'Submission not found' });

    const candidate = sub.candidate || {}, job = sub.job || {}, bd = job.bd_manager || {};
    const targets = [];
    if (wantCandidate) {
      if (!candidate.email) return res.status(400).json({ error: 'The candidate has no email on file.' });
      targets.push({ email: candidate.email, role: 'candidate', candidate_id: candidate.id });
    }
    if (wantBd) {
      if (!bd.email) return res.status(400).json({ error: 'This job has no BD manager email on file.' });
      targets.push({ email: bd.email, role: 'bd_manager', candidate_id: null });
    }

    const mailbox = await recruiterSendingMailbox(req.user.id);
    if (!mailbox) return res.status(409).json({ error: 'no_connected_mailbox' });
    const signature = await getMailboxSignature(mailbox.id, req.user.id).catch(() => '');
    const subject = 'Interview scheduled: ' + (candidate.full_name || 'Candidate') + ' — ' + (job.job_title || 'Role');
    const orgId = req.orgId || null;
    const results = [];
    for (const t of targets) {
      if (!emailSyntaxValid(t.email)) { results.push({ email: t.email, role: t.role, status: 'skipped', reason: 'invalid_email' }); continue; }
      const token = newTrackToken();
      const htmlBody = injectTrackPixel(buildHtmlEmailBody(buildInterviewInviteText(sub, candidate, job, t.role), signature), token);
      try {
        await sendMicrosoftNewMessage(mailbox.id, { to: t.email, subject, htmlBody });
        await supabase.from('email_tracking').insert({
          token, channel: 'interview', candidate_id: t.candidate_id, job_order_id: sub.job_order_id,
          to_email: t.email, subject, sent_by: req.user.id, mailbox_email: mailbox.email_address || null,
          ...(orgId ? { org_id: orgId } : {})
        });
        results.push({ email: t.email, role: t.role, status: 'sent' });
      } catch (e) { results.push({ email: t.email, role: t.role, status: 'failed', reason: e.message }); }
    }
    const sentCount = results.filter(x => x.status === 'sent').length;
    if (sentCount) {
      const { data: sendLog } = await supabase.from('email_send_log').select('id,emails_sent').eq('send_date', today()).eq('user_email_id', mailbox.id).maybeSingle();
      await supabase.from('email_send_log').upsert(
        { user_email_id: mailbox.id, send_date: today(), emails_sent: (sendLog?.emails_sent || 0) + sentCount },
        { onConflict: 'user_email_id,send_date' }
      );
    }
    res.json({ mailbox: mailbox.email_address, sent: sentCount, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auto-create a Microsoft Teams meeting for an interview and return the join URL.
// Needs the OnlineMeetings.ReadWrite scope on the mailbox token — mailboxes
// connected before that scope was added need a one-time reconnect, so we surface
// a clear 409 the UI can explain instead of a raw Graph error.
app.post('/submissions/:id/create-meeting', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const { data: sub } = await supabase.from('submissions')
      .select('id, interview_at, candidate:candidates(full_name), job:job_orders(job_title)')
      .eq('id', req.params.id).single();
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    const startRaw = b.start || sub.interview_at;
    if (!startRaw) return res.status(400).json({ error: 'Set the interview date & time first.' });
    const start = new Date(startRaw);
    if (isNaN(start.getTime())) return res.status(400).json({ error: 'Invalid date/time.' });
    const minutes = Math.min(240, Math.max(15, parseInt(b.minutes, 10) || 45));
    const end = new Date(start.getTime() + minutes * 60000);
    const subject = b.subject || ('Interview: ' + ((sub.candidate && sub.candidate.full_name) || 'Candidate') + ' — ' + ((sub.job && sub.job.job_title) || 'Role'));

    const mailbox = await recruiterSendingMailbox(req.user.id);
    if (!mailbox) return res.status(409).json({ error: 'no_connected_mailbox' });
    const accessToken = await getMicrosoftToken(mailbox.id);
    let meeting;
    try {
      meeting = await graphMailRequest(accessToken, '/me/onlineMeetings', {
        method: 'POST',
        body: JSON.stringify({ startDateTime: start.toISOString(), endDateTime: end.toISOString(), subject })
      });
    } catch (e) {
      if (/scope|permission|Authorization_RequestDenied|forbidden|AccessDenied|InvalidAuthenticationToken/i.test(String(e.message))) {
        return res.status(409).json({ error: 'meetings_permission_missing' });
      }
      throw e;
    }
    const joinUrl = meeting && meeting.joinUrl;
    if (!joinUrl) return res.status(502).json({ error: 'No join link returned by Microsoft.' });

    await supabase.from('submissions').update({
      interview_link: joinUrl, interview_platform: 'Microsoft Teams', interview_type: 'virtual'
    }).eq('id', req.params.id);

    res.json({ joinUrl, platform: 'Microsoft Teams' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generic meeting scheduler (not tied to a submission) — powers the "Schedule a
// meeting" action on the Reminders page. Creates a Microsoft Teams online
// meeting and returns the join link. Zoom / Google Meet need their own OAuth and
// are offered in the UI as "coming soon".
app.post('/meetings', auth, async (req, res) => {
  try {
    const b = req.body || {};
    if ((b.platform || 'teams') !== 'teams') return res.status(400).json({ error: 'Only Microsoft Teams is available right now.' });
    const start = new Date(b.start);
    if (!b.start || isNaN(start.getTime())) return res.status(400).json({ error: 'Set a valid date & time.' });
    const minutes = Math.min(240, Math.max(15, parseInt(b.minutes, 10) || 30));
    const end = new Date(start.getTime() + minutes * 60000);
    const subject = (b.subject || 'Meeting').slice(0, 200);
    const mailbox = await recruiterSendingMailbox(req.user.id);
    if (!mailbox) return res.status(409).json({ error: 'no_connected_mailbox' });
    const accessToken = await getMicrosoftToken(mailbox.id);
    let meeting;
    try {
      meeting = await graphMailRequest(accessToken, '/me/onlineMeetings', {
        method: 'POST',
        body: JSON.stringify({ startDateTime: start.toISOString(), endDateTime: end.toISOString(), subject })
      });
    } catch (e) {
      if (/scope|permission|Authorization_RequestDenied|forbidden|AccessDenied|InvalidAuthenticationToken/i.test(String(e.message))) {
        return res.status(409).json({ error: 'meetings_permission_missing' });
      }
      throw e;
    }
    const joinUrl = meeting && meeting.joinUrl;
    if (!joinUrl) return res.status(502).json({ error: 'No join link returned by Microsoft.' });
    res.json({ joinUrl, platform: 'Microsoft Teams', start: start.toISOString(), minutes });
  } catch (err) { res.status(500).json({ error: friendlySendError(err.message) }); }
});

// recruiter_task — a dated task for the recruiter (call the candidate, collect
// docs, schedule an interview …), recorded as a reminder + submission activity.
wfEngine.registerChannel('recruiter_task', async ({ step, enrollment, context }) => {
  const { candidate, job_order, submission } = context;
  const cfg = step.config || {};
  const assignee = cfg.assignee_user_id || submission?.recruiter_id || enrollment.enrolled_by;
  if (!assignee) return { outcome: 'skipped', detail: { reason: 'no_assignee' } };
  const note = [cfg.note || step.name];
  if (candidate?.phone) note.push(`Phone: ${candidate.phone}`);
  const { error } = await supabase.from('reminders').insert({
    job_id: null, user_id: assignee, contact_name: candidate?.full_name || 'Candidate',
    company_name: job_order?.client || job_order?.company?.name || '', email: candidate?.email || null,
    return_date: today(), reminder_time: cfg.time || '09:00', note: note.join('\n'),
    status: 'pending', reminder_type: 'recruiter_task', contact_id: null
  });
  if (error) return { outcome: 'failed', detail: { error: error.message } };
  if (submission?.id) await supabase.from('submission_activity').insert({
    submission_id: submission.id, job_order_id: job_order?.id || null, recruiter_id: assignee,
    action: 'sequence_task_created', note: `${step.name} (sequence)`
  });
  return { outcome: 'done', detail: { assignee } };
}, { entity_types: ['submission', 'candidate'], label: 'Recruiter task', domains: ['recruiting'] });

// submission_stage_move — advance the candidate's submission through its stages.
wfEngine.registerChannel('submission_stage_move', async ({ step, enrollment, context }) => {
  const toStage = (step.config || {}).to_stage;
  const sub = context.submission;
  if (!toStage) return { outcome: 'failed', detail: { error: 'config.to_stage required' } };
  if (!sub) return { outcome: 'skipped', detail: { reason: 'no_submission' } };
  if (sub.stage === toStage) return { outcome: 'skipped', detail: { reason: 'already_in_stage' } };
  const { error } = await supabase.from('submissions').update({ stage: toStage, stage_updated_at: new Date().toISOString() }).eq('id', sub.id);
  if (error) return { outcome: 'failed', detail: { error: error.message } };
  await supabase.from('submission_activity').insert({
    submission_id: sub.id, job_order_id: sub.job_order_id || null, recruiter_id: sub.recruiter_id || enrollment.enrolled_by,
    action: 'sequence_stage_move', old_stage: sub.stage, new_stage: toStage, note: `Stage → ${toStage} (sequence)`
  });
  return { outcome: 'done', detail: { from: sub.stage, to: toStage } };
}, { entity_types: ['submission'], label: 'Move submission stage', domains: ['recruiting'] });

// candidate_status_move — the candidate-side counterpart. A nurture sequence
// that only emails is a blunt instrument; this lets one finish by marking the
// person (e.g. "Contacted" → "Nurturing", or parking someone who never replied)
// so the state is visible in the Candidates grid rather than only in the
// sequence's own history.
wfEngine.registerChannel('candidate_status_move', async ({ step, enrollment, context }) => {
  const toStatus = (step.config || {}).to_status;
  const cand = context.candidate;
  if (!toStatus) return { outcome: 'failed', detail: { error: 'config.to_status required' } };
  if (!cand) return { outcome: 'skipped', detail: { reason: 'no_candidate' } };
  if (cand.applicant_status === toStatus) return { outcome: 'skipped', detail: { reason: 'already_in_status' } };
  const { error } = await supabase.from('candidates')
    .update({ applicant_status: toStatus, updated_at: new Date() }).eq('id', cand.id);
  if (error) return { outcome: 'failed', detail: { error: error.message } };
  return { outcome: 'done', detail: { from: cand.applicant_status, to: toStatus } };
}, { entity_types: ['candidate'], label: 'Set candidate status', domains: ['recruiting'] });

// Replies, unsubscribes, and bounces end the sequence — same exits the legacy
// follow-up path honours, expressed once against the engine.
on(EVENTS.CONTACT_REPLIED, (e) => wfEngine.exitEntity({ entity_type: 'contact', entity_id: e.payload.contactId, reason: 'replied' }));
on(EVENTS.CONTACT_UNSUBSCRIBED, (e) => wfEngine.exitEntity({ entity_type: 'contact', entity_id: e.payload.contactId, reason: 'unsubscribed' }));
on(EVENTS.CONTACT_INVALIDATED, (e) => wfEngine.exitEntity({ entity_type: 'contact', entity_id: e.payload.contactId, reason: 'invalidated' }));

// The candidate equivalent. Two enrollment shapes have to be ended, not one:
// a nurture enrollment keys on the candidate id, but a job-specific enrollment
// keys on the SUBMISSION id, and exitEntity matches entity_id exactly. Exiting
// only the candidate would leave a submission sequence running against someone
// who has already replied.
async function exitCandidateSequences(candidateId, reason) {
  if (!candidateId) return;
  try {
    await wfEngine.exitEntity({ entity_type: 'candidate', entity_id: candidateId, reason });
    const { data: subs } = await supabase.from('submissions')
      .select('id').eq('candidate_id', candidateId).is('deleted_at', null).limit(50);
    for (const s of (subs || [])) {
      await wfEngine.exitEntity({ entity_type: 'submission', entity_id: s.id, reason });
    }
  } catch (err) { console.error('[wf] candidate exit failed:', err.message); }
}
on(EVENTS.CANDIDATE_REPLIED, (e) => exitCandidateSequences(e.payload.candidateId, 'replied'));
on(EVENTS.CANDIDATE_UNSUBSCRIBED, (e) => exitCandidateSequences(e.payload.candidateId, 'unsubscribed'));

// The two send helpers are handed back to the caller so other routers can send
// through THIS path rather than growing a second one. routes/outreach-generator
// is the first taker: it resolves the same assigned mailbox and dispatches by
// the same platform rules, which is why a Gmail user's generated email behaves
// exactly like their candidate email does.
return { recruiterSendingMailbox, sendMailboxNewMessage, connectedMailboxById };
};
