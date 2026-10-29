// ============================================================================
// A BOUNCE MARKS ONLY THE COMPANY WHOSE MAILBOX RECEIVED IT (R-243).
//
// The bounce sweep reads a bounce notice from one mailbox and learns an address is dead. It used to look that address up in
// EVERY company's contacts, so a bounce in one account could mark another account's perfectly good contact Invalid. `scoped`
// is a models/ accessor already pinned to the mailbox's organisation (db.forOrg(orgId)); nothing here can reach past it.
// ============================================================================

// Marks every not-yet-dead contact with this address and returns who it marked ({id, job_id, status}). `status` is what the
// notice said (services/bounce-kind.js): 'blocked' when their side refused our mail, else 'invalid' (the old behaviour).
async function invalidateBouncedContacts(scoped, addr, { neverEmail, status = 'invalid', now = () => new Date() } = {}) {
  const st = status === 'blocked' ? 'blocked' : 'invalid';
  const { data: matches } = await scoped.from('contacts').select('id,email_status,job_id').ilike('email', addr).limit(10);
  const marked = [];
  for (const c of (matches || [])) {
    if (neverEmail && neverEmail(c.email_status)) continue;      // already marked (a blocked address that bounces stays Blocked)
    await scoped.from('contacts').update({ email_status: st, updated_at: now() }).eq('id', c.id);
    marked.push({ id: c.id, job_id: c.job_id, status: st });
  }
  return marked;
}

module.exports = { invalidateBouncedContacts };
