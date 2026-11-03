'use strict';
// How many emails does the database hold for this mailbox? One home for the answer, used by BOTH delete buttons
// (the Deliverability panel and Manager Users → Email IDs), so they can never disagree (R-358, 3 Nov 2026).
// A mail is tied to its mailbox two ways: by the sender address (nearly all rows) and, on a few, by sending_email_id — the larger count wins.
// `db` is any Supabase-style client the CALLER has already scoped to the company (db.forRequest(req) or the guarded global one).
const exactCi = (a) => String(a || '').replace(/[\\%_]/g, '\\$&');

async function mailOnRecord(db, mb) {
  const one = async (build) => { const { count, error } = await build(db.from('emails').select('id', { count: 'exact', head: true })); if (error) throw error; return count || 0; };
  const byAddress = await one((q) => q.ilike('from_email', exactCi(mb.email_address)));
  const byId = await one((q) => q.eq('sending_email_id', mb.id));
  return Math.max(byAddress, byId);
}

module.exports = { mailOnRecord, exactCi };
