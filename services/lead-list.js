'use strict';
// THE LEAD LIST, READ IN PAGES, WITHOUT POSTING TEXT (R-301, 21 Oct).
//
// GET /jobs is the whole company's leads, re-read by every open tab every 3 minutes. Each lead used to arrive with its pasted
// job description (`research.jd_raw`): 7.7 MB of the 8.7 MB of research text on 1,479 leads, and the memory watcher saw one
// load grow the free server by 65-110 MB. Now the rows are read a page at a time and each page is cut down
// (services/lead-posting.js forList) before the next is read, so the full text is never in memory at once and never sent.
// Ordered newest first with the id as a tie-breaker, so a page boundary cannot repeat or skip a lead.
const leadPosting = require('./lead-posting');

async function loadLeadList({ supabase, select, orgId, pageSize = 500 }) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from('jobs').select(select).is('deleted_at', null);
    if (orgId) query = query.eq('org_id', orgId);
    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of (data || [])) rows.push(leadPosting.forList(row));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

module.exports = { loadLeadList };
