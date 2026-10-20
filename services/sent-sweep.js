'use strict';
// OUR REPLIES, LEARNED IN THE BACKGROUND (R-296, owner 20 Oct, D-0167).
//
// Why it exists: "Needs you today" and "Your client conversations" must know when WE answered — from Gmail, Outlook or PACE's
// own mailbox, on the same thread or a new one. R-268 found that out by asking every mailbox LIVE on every page load; that
// burst of searches is what ran the free server out of memory and restarted it mid-use (R-291). The owner: "Solve the issue."
//
// So the answer is learned where the mail is already being read: the reply sweep, which visits every mailbox in the
// background, now also reads that mailbox's Sent folder since its last visit. A sent email is kept ONLY when it went to a
// person who has written to us before (a stored reply, a contact marked replied, a candidate who answered) — that is a
// conversation; cold outreach is not kept here (it is in `emails` already, and PACE's own engine sends are skipped by id).
// It is kept like the replies people send us: one conversation_messages row, direction 'outbound', the provider's short
// preview (≤ BODY_CHARS), filed to that person's contact / candidate / lead. Matching is by PERSON, not by thread, so a
// reply sent on a different thread still counts (owner's question 3). The lists then read only PACE's own records.
//
// PURE of I/O: listing, lookups and the store are handed in, so every branch is testable without a network.

const FIRST_LOOKBACK_DAYS = 30;   // a mailbox's first visit reaches back this far, so recent answers are not missed
const MAX_IDS = 500;              // sent ids looked at per visit (ids are cheap: one listing call returns them)
const MAX_FETCH = 200;            // headers read per visit, one at a time — each is one small provider call
const BODY_CHARS = 500;           // the short copy kept (the provider's own preview is shorter still)
// OLDER MAIL, A SLICE AT A TIME (R-297, owner 20 Oct: 90 days "if it won't burden the server when 100+ users are added"). After the
// forward pass, each visit reads a little further back until BACKFILL_DAYS are covered — at most BACKFILL_FETCH headers per visit,
// one at a time, so memory stays flat however many people are added and the extra time is a few seconds per mailbox, once.
const BACKFILL_DAYS = 90;
const BACKFILL_FETCH = 40;

const norm = (s) => String(s || '').trim().toLowerCase();
const ADDR_RE = /[^\s<>,;:"'()\[\]]+@[^\s<>,;:"'()\[\]]+\.[^\s<>,;:"'()\[\]]+/g;

// Every address in a header value like `"Laura K" <laura@x.com>, bob@y.com` — lower-cased, in order, no repeats.
function addressesIn(value) {
  const out = [];
  for (const a of String(value || '').match(ADDR_RE) || []) { const n = norm(a); if (!out.includes(n)) out.push(n); }
  return out;
}

function sinceFor(stored, now) {
  const t = Date.parse(stored || '');
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(now - FIRST_LOOKBACK_DAYS * 864e5).toISOString();
}

// Pure: one sent message + who it reached → the row to store, or null. `msg` = { id, thread_key, to:[], cc:[], subject, date,
// preview }; `known` = Map(address -> { contact_id, candidate_id, job_id, company_id }).
function rowFor(msg, known, mailbox) {
  if (!msg || !msg.id || !msg.date) return null;
  const who = [...(msg.to || []), ...(msg.cc || [])].map(norm).find(a => known.has(a));
  if (!who) return null;
  const k = known.get(who);
  const row = {
    contact_id: k.contact_id || null, candidate_id: k.candidate_id || null, job_id: k.job_id || null,
    provider: mailbox.provider, thread_key: msg.thread_key || null, message_key: String(msg.id),
    direction: 'outbound', from_email: norm(mailbox.email_address) || null, to_email: who,
    subject: String(msg.subject || '').slice(0, 500), body: String(msg.preview || '').replace(/\s+/g, ' ').trim().slice(0, BODY_CHARS),
    sent_at: msg.date, intent: null, has_question: false,
  };
  if (k.company_id) row.company_id = k.company_id;
  if (mailbox.org_id) row.org_id = mailbox.org_id;
  return row;
}

/**
 * One mailbox's Sent folder since its last visit.
 * @param {object}   o
 * @param {object}   o.mailbox      { user_email_id, email_address, org_id, provider: 'gmail'|'microsoft' }
 * @param {string}   o.since        the stored bound (ISO) or null on a first visit
 * @param {function} o.listIds      (sinceIso, max) -> { ids:[...newest first], more:boolean }
 * @param {function} o.paceIds      (ids) -> Set of ids PACE's own engine sent (skipped — already stored as `emails`)
 * @param {function} o.readHeaders  (id) -> { id, thread_key, to, cc, subject, date, preview } (headers + preview only)
 * @param {function} o.knownPeople  (addresses) -> Map(address -> { contact_id, candidate_id, job_id, company_id })
 * @param {function} o.store        (row) -> Promise (a duplicate is success)
 * @param {Set}      o.own          our own addresses (mail between colleagues is never a conversation)
 * @returns {Promise<{ stored:number, read:number, newest:string, capped:boolean }>}
 */
async function sweepSent({ mailbox, since, listIds, paceIds, readHeaders, knownPeople, store, own = new Set(), now = Date.now() }) {
  const from = sinceFor(since, now);
  const { ids, more } = await listIds(from, MAX_IDS);
  const { msgs, stored, todo } = await keep(ids, MAX_FETCH, { mailbox, paceIds, readHeaders, knownPeople, store, own });
  let newest = from;
  for (const m of msgs) if (m.date > newest) newest = m.date;
  // `oldest` = how far back this visit really reached: the bound the backfill continues from.
  const oldest = (!!more || todo.length > MAX_FETCH) && msgs.length ? msgs.reduce((o, m) => (m.date < o ? m.date : o), msgs[0].date) : from;
  return { stored, read: msgs.length, newest, oldest, capped: !!more || todo.length > MAX_FETCH };
}

/**
 * One slice of OLDER sent mail: [floor, back) newest first, at most BACKFILL_FETCH headers. `listIds(fromIso, max, toIso)`.
 * Returns the new `back` (how far back is now covered) and `done` once the floor is reached.
 */
async function sweepSentBack({ mailbox, back, listIds, paceIds, readHeaders, knownPeople, store, own = new Set(), now = Date.now() }) {
  const floor = new Date(now - BACKFILL_DAYS * 864e5).toISOString();
  const upto = back || sinceFor(null, now);
  if (upto <= floor) return { stored: 0, read: 0, back: floor, done: true };
  const { ids, more } = await listIds(floor, MAX_IDS, upto);
  const { msgs, stored, todo } = await keep(ids, BACKFILL_FETCH, { mailbox, paceIds, readHeaders, knownPeople, store, own });
  const partial = !!more || todo.length > BACKFILL_FETCH;
  // Not finished: continue next visit from the oldest email read (a message in that same second is offered again and ignored).
  const nextBack = partial && msgs.length ? msgs.reduce((o, m) => (m.date < o ? m.date : o), msgs[0].date) : floor;
  return { stored, read: msgs.length, back: nextBack, done: nextBack <= floor };
}

// The shared middle: drop PACE's own sends by id, read headers ONE at a time (never a body), keep what went to a known person.
async function keep(ids, max, { mailbox, paceIds, readHeaders, knownPeople, store, own }) {
  const engine = ids.length ? await paceIds(ids) : new Set();
  const todo = ids.filter(id => !engine.has(String(id)));
  const msgs = [];
  for (const id of todo.slice(0, max)) {
    try { const m = await readHeaders(id); if (m && m.date) msgs.push(m); } catch (_) { /* one unreadable message never ends the visit */ }
  }
  const outside = (a) => a && !own.has(a);
  const addrs = [...new Set([].concat(...msgs.map(m => [...(m.to || []), ...(m.cc || [])].map(norm))).filter(outside))];
  const known = addrs.length ? await knownPeople(addrs) : new Map();
  let stored = 0;
  for (const m of msgs) {
    const row = rowFor(m, known, mailbox);
    if (!row) continue;
    try { await store(row); stored++; } catch (_) { /* best-effort, like the replies we keep */ }
  }
  return { msgs, stored, todo };
}

// Who has written to us before, among these addresses — newest record wins. Three sources, in order: a stored reply
// (conversation_messages inbound), a lead contact marked replied, a candidate who answered. Scoped to the mailbox's company.
async function lookupKnownPeople(supabase, orgId, addresses) {
  const addrs = [...new Set((addresses || []).map(norm).filter(Boolean))];
  const known = new Map();
  if (!addrs.length) return known;
  const scoped = (q) => (orgId ? q.eq('org_id', orgId) : q);
  try {
    const { data } = await scoped(supabase.from('conversation_messages')
      .select('from_email,contact_id,candidate_id,job_id,company_id,sent_at').eq('direction', 'inbound').in('from_email', addrs))
      .order('sent_at', { ascending: false }).limit(1000);
    for (const r of data || []) {
      const a = norm(r.from_email);
      if (!known.has(a) && (r.contact_id || r.candidate_id)) {
        known.set(a, { contact_id: r.contact_id, candidate_id: r.candidate_id, job_id: r.job_id, company_id: r.company_id || null });
      }
    }
  } catch (_) { /* table or column not there — the other two sources still answer */ }
  const left = addrs.filter(a => !known.has(a));
  if (left.length) {
    try {
      const { data: cs } = await scoped(supabase.from('contacts').select('id,job_id,email,replied_at')
        .in('email', left).not('replied_at', 'is', null)).limit(500);
      const jobIds = [...new Set((cs || []).map(c => c.job_id).filter(Boolean))];
      const companyOf = {};
      if (jobIds.length) {
        const { data: js } = await supabase.from('jobs').select('id,company_id').in('id', jobIds);
        (js || []).forEach(j => { companyOf[j.id] = j.company_id || null; });
      }
      for (const c of cs || []) {
        const a = norm(c.email);
        if (!known.has(a)) known.set(a, { contact_id: c.id, candidate_id: null, job_id: c.job_id, company_id: companyOf[c.job_id] || null });
      }
    } catch (_) { /* best-effort */ }
  }
  const left2 = addrs.filter(a => !known.has(a));
  if (left2.length) {
    try {
      const { data: cands } = await scoped(supabase.from('candidates').select('id,email,last_reply_at')
        .in('email', left2).not('last_reply_at', 'is', null)).limit(500);
      for (const c of cands || []) {
        const a = norm(c.email);
        if (!known.has(a)) known.set(a, { contact_id: null, candidate_id: c.id, job_id: null, company_id: null });
      }
    } catch (_) { /* the column arrives with migration 036 */ }
  }
  return known;
}

module.exports = { sweepSent, sweepSentBack, BACKFILL_DAYS, BACKFILL_FETCH, rowFor, addressesIn, sinceFor, lookupKnownPeople, FIRST_LOOKBACK_DAYS, MAX_IDS, MAX_FETCH, BODY_CHARS };
