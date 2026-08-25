#!/usr/bin/env node
/**
 * One-time repair for emails queued BEFORE the sender-identity fix.
 *
 * Those rows have a sender name baked into the body — the display name of
 * whichever mailbox was resolved at queue time. If the lead's sending mailbox
 * has changed since, that name is now a different person from the one the
 * recipient will see in the From address and the signature.
 *
 * This rewrites the stale name back to the {{sender}} token, so the send path
 * fills it from the mailbox that actually sends. It only ever touches:
 *   - rows with status = 'pending' (nothing already delivered is rewritten), and
 *   - rows whose baked name belongs to a DIFFERENT mailbox than the one that
 *     will send them.
 * It is idempotent, and prints what it would do unless --apply is passed.
 *
 *   node scripts/repair-pending-sender-names.js            # dry run
 *   node scripts/repair-pending-sender-names.js --apply    # write
 */
const { createClient } = require('@supabase/supabase-js');
const { loadConfig } = require('../config/env');

const APPLY = process.argv.includes('--apply');

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const cfg = loadConfig();
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey);

  const { data: mailboxes, error: mbErr } = await supabase
    .from('user_emails').select('id,email_address,display_name');
  if (mbErr) throw mbErr;
  const byId = {};
  const byAddress = {};
  (mailboxes || []).forEach((m) => {
    byId[m.id] = m;
    if (m.email_address) byAddress[m.email_address.toLowerCase()] = m;
  });

  const { data: rows, error } = await supabase
    .from('emails')
    .select('id,subject,body,from_email,to_email,sending_email_id,job:jobs(sending_email_id)')
    .eq('status', 'pending');
  if (error) throw error;

  let repaired = 0, alreadyOk = 0, unknown = 0;
  for (const row of rows || []) {
    const sendingId = row.sending_email_id || row.job?.sending_email_id || null;
    const willSendFrom = sendingId ? byId[sendingId] : null;
    const bakedFrom = byAddress[String(row.from_email || '').toLowerCase()] || null;

    // Nothing baked (already tokenised) — the send path handles it.
    if (String(row.body || '').includes('{{sender}}')) { alreadyOk++; continue; }
    if (!willSendFrom || !bakedFrom) { unknown++; continue; }
    if (!bakedFrom.display_name) { unknown++; continue; }
    if (bakedFrom.id === willSendFrom.id) { alreadyOk++; continue; }

    const stale = new RegExp(escapeRegExp(bakedFrom.display_name), 'g');
    if (!stale.test(row.body || '')) { alreadyOk++; continue; }

    const body = String(row.body).replace(stale, '{{sender}}');
    const subject = String(row.subject || '').replace(
      new RegExp(escapeRegExp(bakedFrom.display_name), 'g'), '{{sender}}'
    );
    console.log(`${APPLY ? 'FIX ' : 'WOULD FIX '} ${row.id} → ${row.to_email}: `
      + `"${bakedFrom.display_name}" (${bakedFrom.email_address}) `
      + `→ {{sender}} (will send as ${willSendFrom.display_name} <${willSendFrom.email_address}>)`);
    if (APPLY) {
      const { error: upErr } = await supabase.from('emails')
        .update({ body, subject, from_email: willSendFrom.email_address })
        .eq('id', row.id).eq('status', 'pending');
      if (upErr) { console.error(`  ! ${row.id}: ${upErr.message}`); continue; }
    }
    repaired++;
  }

  console.log(`\n${APPLY ? 'Repaired' : 'Would repair'}: ${repaired} · already correct: ${alreadyOk} `
    + `· skipped (mailbox unknown): ${unknown} · pending scanned: ${(rows || []).length}`);
  if (!APPLY && repaired) console.log('Re-run with --apply to write these changes.');
}

main().catch((e) => { console.error(e); process.exit(1); });
