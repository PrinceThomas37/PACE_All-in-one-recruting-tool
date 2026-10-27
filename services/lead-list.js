'use strict';
// THE LEAD LIST, READ IN PAGES, WITHOUT POSTING TEXT (R-301, 21 Oct).
//
// GET /jobs is the whole company's leads, re-read by every open tab every 3 minutes. Each lead used to arrive with its pasted
// job description (`research.jd_raw`): 7.7 MB of the 8.7 MB of research text on 1,479 leads, and the memory watcher saw one
// load grow the free server by 65-110 MB. Now the rows are read a page at a time and each page is cut down
// (services/lead-posting.js forList) before the next is read, so the full text is never in memory at once and never sent.
// Ordered newest first with the id as a tie-breaker, so a page boundary cannot repeat or skip a lead.
const leadPosting = require('./lead-posting');

// R-324: the pages used to be read ONE AFTER ANOTHER — three trips to the database in Seoul, back to back, before the list could be
// answered (R-304 measured GET /jobs going from 7-10 s to 13-20 s after R-301). Now the first page also asks how many leads there
// are, and the rest are read AT THE SAME TIME: two waits, however big the list grows. Each page is still cut down
// (forList) as it arrives. A lead added or removed between the reads could shift a page boundary, so the pages are joined in
// order and a lead seen twice is kept once. If the count does not come back, it falls back to reading page after page.
async function loadLeadList({ supabase, select, orgId, pageSize = 500 }) {
  const page = (from, withCount) => {
    let query = supabase.from('jobs').select(select, withCount ? { count: 'exact' } : undefined).is('deleted_at', null);
    if (orgId) query = query.eq('org_id', orgId);
    return query.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, from + pageSize - 1);
  };
  const first = await page(0, true);
  if (first.error) throw first.error;
  const pages = [(first.data || []).map(leadPosting.forList)];
  const full = (first.data || []).length === pageSize;
  if (full && Number.isFinite(first.count)) {
    const rest = [];
    for (let from = pageSize; from < first.count; from += pageSize) {
      rest.push(page(from, false).then(({ data, error }) => { if (error) throw error; return (data || []).map(leadPosting.forList); }));
    }
    pages.push(...(await Promise.all(rest)));
    // The count is from a moment ago: a lead added since could push one more page. Read on until a short page, as before.
    let from = pageSize * pages.length;
    while (pages[pages.length - 1].length === pageSize) {
      const { data, error } = await page(from, false);
      if (error) throw error;
      pages.push((data || []).map(leadPosting.forList));
      from += pageSize;
    }
  } else if (full) {
    for (let from = pageSize; ; from += pageSize) {
      const { data, error } = await page(from, false);
      if (error) throw error;
      pages.push((data || []).map(leadPosting.forList));
      if (!data || data.length < pageSize) break;
    }
  }
  const seenIds = new Set(), rows = [];
  for (const pg of pages) for (const row of pg) {
    if (row && row.id != null) { if (seenIds.has(row.id)) continue; seenIds.add(row.id); }
    rows.push(row);
  }
  return rows;
}

module.exports = { loadLeadList };
