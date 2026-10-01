// OUT OF OFFICE ENDS ON THE RETURN DATE (R-080, D-0066).
//
// A person marks a contact "Out of office until <date>" (PATCH /contacts/:id/email-status). Until
// now nothing ever lifted that: the contact stayed out of office for ever and PACE's automatic
// follow-ups to them stayed stopped until somebody set them back to Valid by hand. The owner's
// answer (D-0066): switch them back by themselves, so the follow-ups resume.
//
// PURE: no database, no clock of its own. The daily sweep (index.js `runOooReturnSweep`) reads,
// asks this, writes.
//
// "Back" means the return date has ARRIVED — return date <= today — and the contact is still
// out of office. A contact somebody has since marked invalid or deactivated stays that way: a
// bounced address does not become good because a holiday ended. Nothing that was skipped while
// they were away is sent late; only what falls due AFTER the switch goes out.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/;

// today: 'YYYY-MM-DD'
function isBackFromOoo(contact, today) {
  if (!contact || String(contact.email_status || '').toLowerCase() !== 'out_of_office') return false;
  const until = contact.ooo_until ? String(contact.ooo_until).slice(0, 10) : '';
  if (!DATE_ONLY.test(until) || !DATE_ONLY.test(String(today || ''))) return false;   // no readable date → leave them alone
  return until <= String(today).slice(0, 10);
}

// The row update that switches them back.
function backFromOooUpdate(now) {
  return { email_status: 'valid', ooo_until: null, updated_at: now || new Date() };
}

// The sweep, with its I/O injected so a test can run the real thing against a fake.
//   contacts()    → a query builder on the contacts table (index.js passes db.crossOrg('contacts'))
//   logActivity   → the activity-log writer
//   now           → a Date (defaults to the real one)
// A failed read is reported, never swallowed into "nothing to do".
async function runOooReturnSweep({ contacts, logActivity, now }) {
  const log = { checked: 0, switched: 0 };
  const at = now || new Date();
  const todayStr = at.toISOString().slice(0, 10);
  try {
    // Every row we switch leaves the set we are reading, so the next page is ALWAYS the first
    // page again (paging forward would skip the rows that slid up). Stop when a pass switches
    // nothing — that also ends the loop if a write keeps failing.
    for (let pass = 0; pass < 200; pass++) {
      const { data, error } = await contacts()
        .select('id,job_id,first_name,last_name,email_status,ooo_until')
        .eq('email_status', 'out_of_office').not('ooo_until', 'is', null).lte('ooo_until', todayStr)
        .order('id').range(0, 499);
      if (error) throw error;
      const rows = data || [];
      if (pass === 0) log.checked = rows.length;
      let switchedThisPass = 0;
      for (const c of rows) {
        if (!isBackFromOoo(c, todayStr)) continue;
        const until = c.ooo_until;
        // the status is part of the match: a contact marked invalid since the read stays invalid
        const { error: upErr } = await contacts().update(backFromOooUpdate(at)).eq('id', c.id).eq('email_status', 'out_of_office');
        if (upErr) continue;
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'The contact';
        await logActivity(c.job_id, c.id, null, 'ooo_returned', `${name} is back from out of office (${String(until).slice(0, 10)}) — set back to Valid; automatic follow-ups can resume`);
        log.switched++; switchedThisPass++;
      }
      if (rows.length < 500 || !switchedThisPass) break;
    }
    return log;
  } catch (err) { return { ...log, error: err.message }; }
}

module.exports = { isBackFromOoo, backFromOooUpdate, runOooReturnSweep };
