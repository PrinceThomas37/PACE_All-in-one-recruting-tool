// ============================================================================
// LEAD FILL — a re-imported spreadsheet fills in what an existing lead is
// MISSING, and never overwrites anything (Session 29, R-045).
// ----------------------------------------------------------------------------
// PURE. Why it exists: the import had no job-link field until #228, so the 49
// leads imported on 2026-09-23 never stored their job link, and a re-import
// skipped existing leads entirely — there was no way to recover it. The owner
// asked for the re-import to "merge" instead.
//
// THE ONE RULE: a field is written only when the lead's value is EMPTY. A
// recruiter's edit, a stage, a note — anything a person or PACE already put
// there — is never replaced by what a spreadsheet says. A re-import can add;
// it cannot correct, and it cannot undo.
// ============================================================================

const JOB_FIELDS = ['job_url', 'salary_range', 'location', 'industry', 'job_created_date'];
const CONTACT_FIELDS = ['phone', 'linkedin', 'designation', 'last_name'];

function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }
function txt(v) { return blank(v) ? '' : String(v).trim(); }

function asObject(r) {
  if (r && typeof r === 'object' && !Array.isArray(r)) return r;
  if (typeof r === 'string') { try { const o = JSON.parse(r); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
  return {};
}

// existing: { job, company, contacts[] } as stored.  incoming: the import row
// for that lead: { job_url, salary_range, ..., website, import_extra, contacts[] }.
// Returns { job, company, contacts: [{ id, patch }], filled: [names] } — every
// patch contains ONLY fields that were empty.
function fillPatch(existing, incoming) {
  const ex = existing || {}, inc = incoming || {};
  const job = ex.job || {}, company = ex.company || {};
  const out = { job: {}, company: {}, contacts: [], filled: [] };

  for (const f of JOB_FIELDS) {
    if (blank(job[f]) && !blank(inc[f])) { out.job[f] = txt(inc[f]).slice(0, 2000); out.filled.push(f); }
  }
  if (blank(company.website) && !blank(inc.website)) { out.company.website = txt(inc.website).slice(0, 500); out.filled.push('website'); }

  // Extra columns: add the ones the lead does not have yet, keep the rest.
  const extra = inc.import_extra && typeof inc.import_extra === 'object' ? inc.import_extra : null;
  if (extra) {
    const research = asObject(job.research);
    const have = asObject(research.import_extra);
    const add = {};
    for (const [k, v] of Object.entries(extra).slice(0, 40)) {
      const key = String(k).trim().slice(0, 80);
      if (key && blank(have[key]) && !blank(v)) add[key] = txt(v).slice(0, 500);
    }
    if (Object.keys(add).length) {
      out.job.research = { ...research, import_extra: { ...have, ...add } };
      out.filled.push(...Object.keys(add).map(k => 'extra:' + k));
    }
  }

  // Contacts are matched by email only — a name is not an identity.
  const byEmail = {};
  for (const c of ex.contacts || []) if (!blank(c.email)) byEmail[txt(c.email).toLowerCase()] = c;
  for (const ic of inc.contacts || []) {
    const c = byEmail[txt(ic.email).toLowerCase()];
    if (!c) continue;
    const patch = {};
    for (const f of CONTACT_FIELDS) {
      if (!blank(c[f]) || blank(ic[f])) continue;
      // A LinkedIn field holding an email address is the misfile #228 fixed —
      // never write one back.
      if (f === 'linkedin' && txt(ic[f]).includes('@')) continue;
      patch[f] = txt(ic[f]).slice(0, 500);
    }
    if (Object.keys(patch).length) { out.contacts.push({ id: c.id, patch }); out.filled.push(...Object.keys(patch).map(k => 'contact:' + k)); }
  }
  return out;
}

module.exports = { JOB_FIELDS, CONTACT_FIELDS, fillPatch };
