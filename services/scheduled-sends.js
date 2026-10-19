// ============================================================================
// SCHEDULED SENDS — "send this at 7:00 tomorrow" from the in-app mailbox (owner, 19 Oct 2026, R-273, D-0162, D-0163).
// ----------------------------------------------------------------------------
// The window's Schedule button stores the email (migration 067, scheduled_sends) instead of sending it; the engine sends the due
// ones through the SAME path as Send (services/mailbox-send.js) from the mailbox that was chosen. Rules, each from an incident
// elsewhere in PACE:
//   * an email is checked when it is SCHEDULED (empty body, no recipient, files too big) — the person is there to fix it then;
//   * a row is CLAIMED ('scheduled' → 'sending', conditional on still being 'scheduled') before it is sent, so two ticks can
//     never send one email twice;
//   * a send that fails is 'failed' with the reason in words and is NOT retried by itself — whether a failed send left the
//     building cannot always be known, and an email sent twice to a client is worse than one the person re-sends;
//   * a row left at 'sending' by a process that died mid-send is moved to 'failed' at boot, never re-sent (recoverStuck);
//   * the mailbox must still be the scheduler's own, switched on, when the time comes — otherwise it does not send;
//   * once sent or cancelled, the attachments are taken out of the row (nothing kept that is no longer needed).
// TIMING (D-0163): the engine wakes when PACE is in use or the heartbeat arrives. On the free server that can be hours late;
// the screen says so. The owner will move to a paid always-on server before other customers use PACE.
// ============================================================================

const STUCK_MESSAGE = 'PACE restarted while this was being sent, so it may or may not have gone. Check your Sent folder before sending it again.';

function nowIso(now) { return (now ? new Date(now) : new Date()).toISOString(); }

// The provider's message, said for a person.
function failureWords(err) {
  const msg = String((err && err.message) || err || 'the mail provider refused it');
  if (/token|refresh|reconnect|invalid_grant|unauthor|401/i.test(msg)) return 'The email ID\'s sign-in had expired — reconnect it, then send this again.';
  if (/quota|rate|429|too many/i.test(msg)) return 'The mail provider was busy (rate limit) — send this again.';
  return 'The mail provider refused it: ' + msg.slice(0, 240);
}

function withoutAttachments(payload) {
  const p = Object.assign({}, payload || {});
  if (Array.isArray(p.attachments) && p.attachments.length) {
    p.attachment_names = p.attachments.map(a => a && a.filename).filter(Boolean);
  }
  delete p.attachments;
  return p;
}

/**
 * @param ctx.table   () => a query builder on scheduled_sends, across every org (db.crossOrg('scheduled_sends'))
 * @param ctx.mailboxes () => a query builder on user_emails, across every org
 * @param ctx.sender  createMailboxSender(...) — { check, send }
 */
function createScheduledSends(ctx) {
  const { table, mailboxes, sender } = ctx;

  async function claim(row, now) {
    const { data, error } = await table().update({ status: 'sending', updated_at: nowIso(now) })
      .eq('id', row.id).eq('status', 'scheduled').select('id');
    if (error) throw new Error(error.message || 'could not claim');
    return Array.isArray(data) && data.length === 1;
  }
  async function finish(row, upd, now) {
    await table().update(Object.assign({ updated_at: nowIso(now) }, upd)).eq('id', row.id);
  }

  /** Send everything that is due. Returns counts for the engine log — or { skipped } when nothing was due (the engine's
   *  "checked, nothing to do", which a quiet job does not write to the run log). */
  async function runDue({ now, limit = 25 } = {}) {
    const at = nowIso(now);
    const { data: due, error } = await table().select('*').eq('status', 'scheduled').lte('send_at', at)
      .order('send_at', { ascending: true }).limit(limit);
    if (error) throw new Error(error.message || 'could not read scheduled emails');
    if (!(due || []).length) return { skipped: 'nothing_due' };
    const counts = { due: due.length, sent: 0, failed: 0, taken_elsewhere: 0 };
    for (const row of (due || [])) {
      let mine;
      try { mine = await claim(row, now); } catch (_) { counts.taken_elsewhere++; continue; }
      if (!mine) { counts.taken_elsewhere++; continue; }    // another tick has it
      // The mailbox, as it is NOW: still this person's, still switched on.
      let mb = null;
      try {
        const { data } = await mailboxes().select('id,user_id,org_id,email_address,display_name,platform,is_active')
          .eq('id', row.mailbox_id).maybeSingle();
        mb = data || null;
      } catch (_) { mb = null; }
      let refusal = null;
      if (!mb || mb.user_id !== row.user_id || (row.org_id && mb.org_id && mb.org_id !== row.org_id)) refusal = 'That email ID is no longer yours, so this was not sent.';
      else if (mb.is_active === false) refusal = 'That email ID is switched off, so this was not sent. Switch it on, then send this again.';
      else {
        const bad = sender.check(row.kind, row.payload || {});
        if (bad) refusal = (bad.body && bad.body.error) || 'It could not be sent as it was.';
      }
      if (refusal) {
        await finish(row, { status: 'failed', error: refusal }, now); counts.failed++;
        continue;
      }
      try {
        const r = await sender.send(mb, row.user_id, row.kind, row.message_id || null, row.payload || {});
        await finish(row, { status: 'sent', sent_at: nowIso(now), error: r && r.label_error ? 'Sent, but the label could not be added: ' + r.label_error : null,
          payload: withoutAttachments(row.payload) }, now);
        counts.sent++;
      } catch (err) {
        await finish(row, { status: 'failed', error: failureWords(err) }, now); counts.failed++;
      }
    }
    return counts;
  }

  /** At boot: a row a dead process left at 'sending' is told plainly, never re-sent. */
  async function recoverStuck({ now } = {}) {
    const { data, error } = await table().update({ status: 'failed', error: STUCK_MESSAGE, updated_at: nowIso(now) })
      .eq('status', 'sending').select('id');
    if (error) throw new Error(error.message || 'could not recover');
    return { recovered: (data || []).length };
  }

  return { runDue, recoverStuck };
}

module.exports = { createScheduledSends, withoutAttachments, failureWords, STUCK_MESSAGE };
