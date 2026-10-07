// ============================================================================
// CAN THIS COMPANY BE ADDED? — one rule, used wherever a lead is offered or created.
// ----------------------------------------------------------------------------
// The owner's rule for adding a lead (7 Oct 2026, D-0085/D-0090):
//
//   1. Is this company already in your organisation? Matched by its WEBSITE, its
//      LINKEDIN page or its NAME — any one is enough. (Until now only an exact
//      company id or an exact name was compared, so "Acme, Inc." and "ACME Inc"
//      with the same website were two companies and both could be added.)
//   2. If it is: say who has it. A company with an ACTIVE lead (any stage except
//      Rejected and Future) or an open (Active) job order cannot be added again.
//   3. Otherwise the company cooldown applies — `company_cooldown_days`, the time
//      since the most recent lead on it was created, whatever stage it is in.
//   4. Otherwise it is free.
//
// This is the cooldown rule of services/company-cooldown.js with the owner's two
// additions (the active-job rule and the website/LinkedIn match). It lives in ONE
// place because the cooldown had already been written three times and the copies
// disagreed (see that file) — a rule that decides whether an action is allowed
// belongs where the action is OFFERED, not only where it is taken (CLAUDE.md).
//
// PURE: no database, no clock, no request. The caller loads the rows
// (services/lead-check.js) and supplies `now`, because every sentence here is a
// claim about elapsed time and a test must be able to say what day it is.
// ============================================================================
const { cooldownState, cooldownSentence } = require('./company-cooldown');

// A lead in one of these stages is not being worked. (Rejected = the company said
// no; Future = parked for later.) Everything else — Unassigned, Assigned,
// Connected, In Discussion — is a live lead somebody may be working or about to.
const INACTIVE_LEAD_STAGES = ['Rejected', 'Future'];

// Addresses that identify a PLATFORM, never a company: matching on them would make
// every company that posts on LinkedIn "the same company".
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'aol.com', 'msn.com', 'proton.me', 'protonmail.com',
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'simplyhired.com', 'monster.com', 'dice.com', 'careerbuilder.com',
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'google.com', 'bing.com', 'wikipedia.org',
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com', 'recruitee.com', 'myworkdayjobs.com', 'icims.com', 'taleo.net',
  'wixsite.com', 'wordpress.com', 'squarespace.com', 'weebly.com', 'blogspot.com', 'github.io', 'onrender.com', 'vercel.app', 'netlify.app',
]);
// "acme.co.uk" is the company, "co.uk" is not: these two-part endings keep a third label.
const TWO_PART_ENDINGS = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in', 'org.in', 'co.nz', 'co.za', 'com.br', 'com.mx', 'co.jp', 'com.sg', 'com.hk', 'co.il']);

const txt = (v) => String(v == null ? '' : v).trim();

// "https://www.Acme.com/careers?x=1", "jobs@acme.com" or "acme.com" → "acme.com".
// '' when there is nothing to match on (empty, no dot, or a platform address).
function normalizeDomain(v) {
  let s = txt(v).toLowerCase();
  if (!s) return '';
  if (s.indexOf('@') >= 0 && s.indexOf('/') < 0) s = s.split('@').pop();       // an email address
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]*@/, '');         // scheme, credentials
  s = s.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.+$/, '');
  if (!s || s.indexOf('.') < 0 || /\s/.test(s)) return '';
  const labels = s.split('.').filter(Boolean);
  if (labels.length < 2) return '';
  const last2 = labels.slice(-2).join('.');
  const host = (labels.length >= 3 && TWO_PART_ENDINGS.has(last2)) ? labels.slice(-3).join('.') : last2;
  return GENERIC_DOMAINS.has(host) ? '' : host;
}

// "https://www.linkedin.com/company/Acme-Corp/about/?x=1" → "company/acme-corp".
function normalizeLinkedIn(v) {
  const m = txt(v).toLowerCase().match(/linkedin\.com\/(company|school)\/([^/?#\s]+)/);
  return m ? m[1] + '/' + decodeURIComponentSafe(m[2]) : '';
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }

const LEGAL_ENDINGS = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'llp', 'lp', 'corp', 'corporation', 'co', 'company', 'plc', 'pllc', 'pc', 'gmbh', 'pvt', 'private']);
// "Acme, Inc." and "ACME Inc" and "Acme" are one name.
function normalizeName(v) {
  const base = txt(v).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return '';
  const words = base.split(' ');
  while (words.length > 1 && LEGAL_ENDINGS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

// Why this company row is the candidate (any one is enough). [] = not the same company.
function reasonsFor(candidate, company) {
  const reasons = [];
  if (candidate.company_id && company.id === candidate.company_id) reasons.push('same_record');
  const dom = normalizeDomain(candidate.website);
  if (dom && normalizeDomain(company.website) === dom) reasons.push('website');
  const li = normalizeLinkedIn(candidate.linkedin);
  if (li && normalizeLinkedIn(company.linkedin_url) === li) reasons.push('linkedin');
  const nm = normalizeName(candidate.name);
  if (nm && normalizeName(company.name) === nm) reasons.push('name');
  return reasons;
}

const WHY = { website: 'website', linkedin: 'LinkedIn page', name: 'company name', same_record: 'same company record' };
function matchedText(reasons) {
  const list = reasons.filter((r) => r !== 'same_record').map((r) => WHY[r]);
  return list.length ? list.join(' and ') : '';
}

/**
 * Decide. Inputs (all plain data):
 *   candidate  { company_id?, name, website?, linkedin? }
 *   companies  every company row that might be the same ({ id, name, website, linkedin_url? })
 *   leads      the live leads on those companies ({ company_id, position, stage, created_at, created_by, assigned_to_bd, assigned_to })
 *   jobOrders  the job orders on those companies ({ company_id, job_title, status, bd_manager_id })
 *   nameOf(id) a person's name, or ''
 *   now, cooldownDays
 * Returns { state: 'free'|'active_job'|'cooldown', blocked, company_id, company_name, matched_on, matched_text,
 *           owner_name, position, days_left, days_ago, sentence }.
 */
function decide({ candidate, companies, leads, jobOrders, nameOf, now, cooldownDays }) {
  const cand = candidate || {};
  const who = typeof nameOf === 'function' ? nameOf : () => '';
  const found = (companies || []).map((c) => ({ company: c, reasons: reasonsFor(cand, c) })).filter((m) => m.reasons.length);
  const free = { state: 'free', blocked: false, company_id: null, company_name: cand.name || null, matched_on: [], matched_text: '', owner_name: null, position: null, days_left: null, days_ago: null, sentence: '', picked_found: false };
  if (!found.length) return free;

  const ids = new Set(found.map((m) => m.company.id));
  const reasons = Array.from(new Set(found.reduce((a, m) => a.concat(m.reasons), [])));
  const first = found[0].company;
  const base = Object.assign({}, free, {
    company_id: first.id, company_name: first.name || cand.name || null,
    matched_on: reasons.filter((r) => r !== 'same_record'), matched_text: matchedText(reasons),
    picked_found: reasons.includes('same_record'),    // the company_id the caller named exists in THIS organisation
  });
  const coName = first.name || cand.name || 'This company';
  // Said when the company was found by something other than the exact record the person picked.
  const via = base.matched_text && !reasons.includes('same_record') ? ' Matched on its ' + base.matched_text + '.' : '';

  const myLeads = (leads || []).filter((l) => ids.has(l.company_id)).slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const ownerOf = (l) => who(l.assigned_to_bd) || who(l.assigned_to) || who(l.created_by) || '';

  // 1. an open job order — the client is already being worked
  const order = (jobOrders || []).filter((o) => ids.has(o.company_id) && String(o.status || '') === 'Active')[0];
  if (order) {
    const owner = who(order.bd_manager_id) || '';
    return Object.assign(base, {
      state: 'active_job', blocked: true, owner_name: owner || null, position: order.job_title || null,
      sentence: `${coName} has an open job order${order.job_title ? ' (' + order.job_title + ')' : ''}${owner ? ' run by ' + owner : ''}. A company with an active job cannot be added again${owner ? ' — speak to ' + owner : ''}.${via}`,
    });
  }
  // 2. a live lead
  const active = myLeads.filter((l) => !INACTIVE_LEAD_STAGES.includes(String(l.stage || '')))[0];
  if (active) {
    const owner = ownerOf(active);
    return Object.assign(base, {
      state: 'active_job', blocked: true, owner_name: owner || null, position: active.position || null,
      sentence: `${coName} already has an active lead${active.position ? ' (' + active.position + ')' : ''}${owner ? ', owned by ' + owner : ''}. A company with an active lead cannot be added again${owner ? ' — speak to ' + owner : ''}.${via}`,
    });
  }
  // 3. the cooldown, from the most recent lead of any stage
  const last = myLeads[0];
  const state = cooldownState({ lastLeadAt: last && last.created_at, now, days: cooldownDays });
  if (state) {
    const owner = ownerOf(last);
    return Object.assign(base, {
      state: 'cooldown', blocked: true, owner_name: owner || null, position: last.position || null,
      days_left: state.daysLeft, days_ago: state.daysAgo,
      sentence: cooldownSentence(state, { company: coName, position: last.position, addedBy: owner }) + via,
    });
  }
  // 4. the company is known and free again
  return Object.assign(base, { state: 'free', blocked: false });
}

module.exports = { INACTIVE_LEAD_STAGES, GENERIC_DOMAINS, normalizeDomain, normalizeLinkedIn, normalizeName, reasonsFor, decide };
