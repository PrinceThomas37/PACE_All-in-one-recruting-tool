// ============================================================================
// CANDIDATE FIELD SHAPE + DUPLICATE DETECTION
//
// Extracted from the old bd_recruiter_routes closure because TWO route modules
// need it: the candidates CRUD, and sourcing (which runs the same duplicate
// rule before importing a staged person). Leaving it in candidates.js would
// have made sourcing require the route module for its helpers.
//
// Logic is unchanged from the original closure.
// ============================================================================

module.exports = function createCandidateFields(core) {
  const { supabase, withOrg } = core;

  // Writable candidate fields (matches migration 012 + the Applicants form).
  const CANDIDATE_FIELDS = [
    'full_name','first_name','last_name','email','phone','alt_phone','linkedin_url',
    'current_location','city','state','country','zip',
    'current_title','headline','skills','experience_years',
    'work_authorization','clearance','current_employer',
    'availability','notice_period','current_ctc','expected_ctc',
    'bill_rate','pay_rate','pay_type','pay_currency',
    'applicant_status','source','resume_url','resume_filename','resume_text'
  ];
  const CANDIDATE_SELECT =
    'id,candidate_code,full_name,first_name,last_name,email,phone,alt_phone,linkedin_url,' +
    'current_location,city,state,country,zip,current_title,headline,skills,experience_years,' +
    'work_authorization,clearance,current_employer,availability,notice_period,current_ctc,expected_ctc,' +
    'bill_rate,pay_rate,pay_type,pay_currency,applicant_status,source,resume_url,resume_filename,resume_text,' +
    'tags,owner_id,created_by,created_at,updated_at,' +
    'owner:users!owner_id(id,name,employee_id),creator:users!created_by(id,name,employee_id)';

  function pickCandidateFields(src) {
    const out = {};
    src = src || {};
    CANDIDATE_FIELDS.forEach(function (k) {
      if (src[k] === undefined) return;
      const v = src[k];
      if (k === 'experience_years') { out[k] = (v === '' || v === null) ? null : v; return; }
      out[k] = (v === '') ? null : v;
    });
    return out;
  }

  // Normalizers — mirror the generated columns created in migration 012.
  function normName(s) { return String(s || '').toLowerCase().trim().replace(/\s+/g, ' '); }
  function normEmail(s) { return String(s || '').toLowerCase().trim(); }
  function normPhone(s) { return (String(s || '').match(/\d/g) || []).join('').slice(-10); }

  // Duplicate rule (owner's spec): same normalized full name AND (email OR phone
  // matches). Returns the matching non-deleted candidates ([] = no duplicate).
  async function findCandidateDuplicates({ full_name, email, phone, excludeId, profile_url, source, source_external_id, req }) {
    const n = normName(full_name), e = normEmail(email), p = normPhone(phone);
    const scope = (q) => (req ? withOrg(q, req) : q);

    // Provenance match, tried first. The name+contact rule below cannot see an
    // externally sourced person who has neither an email nor a phone — which is
    // most of them — so the same profile would be re-imported endlessly. A
    // profile URL identifies one human unambiguously.
    const sel = 'id,candidate_code,full_name,email,phone,current_title,applicant_status,owner_id';
    if (profile_url || (source && source_external_id)) {
      try {
        let pq = scope(supabase.from('candidates').select(sel).is('deleted_at', null).limit(10));
        pq = profile_url
          ? pq.eq('profile_url', profile_url)
          : pq.eq('source', source).eq('source_external_id', source_external_id);
        if (excludeId) pq = pq.neq('id', excludeId);
        const { data, error } = await pq;
        // A missing column (migration 036 not yet applied) is expected, not fatal
        // — fall through to the name+contact rule below.
        if (!error && data && data.length) return data;
      } catch (_) { /* fall through */ }
    }

    if (!n) return [];
    if (!e && !p) return [];                 // need at least one of email / phone to match on
    let q = scope(supabase.from('candidates').select(sel)
      .is('deleted_at', null).eq('name_norm', n).limit(25));
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).filter(function (c) {
      const ce = normEmail(c.email), cp = normPhone(c.phone);
      return (e && ce && ce === e) || (p && cp && cp === p);
    });
  }

  return { CANDIDATE_FIELDS, CANDIDATE_SELECT, pickCandidateFields, normName, normEmail, normPhone, findCandidateDuplicates };
};
