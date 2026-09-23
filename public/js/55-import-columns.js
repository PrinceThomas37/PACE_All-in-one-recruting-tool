// ============================================================================
// IMPORT COLUMNS — which spreadsheet column is which lead field.
// ----------------------------------------------------------------------------
// PURE, and loadable by Node for tests (module.exports at the bottom).
//
// The old matcher (14-mailmerge-engine.js, COL_MAP) matched a column when its
// name merely CONTAINED a short word, and that misfiled real data. Found on
// the live database, 2026-09-23:
//   * "Email ID" contains "li", so every contact's LinkedIn field held their
//     email address.
//   * "Job URL" contains "url", so a job link could land in the company's
//     WEBSITE — and there was no job-link field at all, so a "Job Link"
//     column was silently dropped. The owner opened a lead that had replied
//     and could not find the posting.
//   * Any column the matcher did not know was thrown away.
// Now: an exact name always wins; a partial match is only allowed on
// distinctive words (never "li", "url", "web", "site", "title"...); the job
// link is its own field; and every column not recognised is KEPT, as-is, as
// "other details" on the lead.
// ============================================================================
(function (root) {
  // [field, exact names, distinctive words a longer name may contain]
  // ORDER MATTERS for partial matches only: more specific fields come first
  // ("Job URL" is a job link before it is anything else).
  var FIELDS = [
    ['jobUrl', ['joburl', 'joblink', 'jobpostingurl', 'jobpostinglink', 'postingurl', 'postinglink', 'applyurl',
      'applylink', 'applicationurl', 'applicationlink', 'jdurl', 'jdlink', 'listingurl', 'listinglink', 'joblisting', 'jobad', 'link', 'url'],
      ['joburl', 'joblink', 'postingurl', 'postinglink', 'applyurl', 'applylink', 'applicationurl', 'applicationlink',
        'jdurl', 'jdlink', 'listingurl', 'listinglink']],
    ['website', ['website', 'web', 'site', 'companywebsite', 'companyurl', 'companysite', 'domain', 'companydomain', 'homepage'],
      ['website', 'companyurl', 'companysite', 'companydomain', 'homepage']],
    ['company', ['company', 'companyname', 'firm', 'organisation', 'organization', 'employer', 'account', 'accountname', 'client'],
      ['companyname', 'organisation', 'organization', 'employer']],
    ['position', ['position', 'role', 'jobtitle', 'jobrole', 'openrole', 'vacancy', 'opening', 'job', 'jobname', 'positiontitle'],
      ['jobtitle', 'jobrole', 'openrole', 'vacancy', 'positiontitle']],
    ['industry', ['industry', 'sector', 'vertical'], ['industry']],
    ['location', ['location', 'city', 'place', 'region', 'joblocation', 'citystate'], ['location']],
    ['firstName', ['firstname', 'fname', 'first', 'givenname'], ['firstname', 'givenname']],
    ['lastName', ['lastname', 'lname', 'last', 'surname', 'familyname'], ['lastname', 'surname', 'familyname']],
    ['designation', ['designation', 'title', 'contacttitle', 'currenttitle', 'pocdesignation', 'poctitle'],
      ['designation', 'contacttitle', 'currenttitle']],
    ['email', ['email', 'emailid', 'emailaddress', 'mail', 'pocemail', 'contactemail', 'workemail'], ['email']],
    ['phone', ['phone', 'mobile', 'phonenumber', 'contactno', 'contactnumber', 'contact', 'cell', 'telephone', 'pocphone'],
      ['phone', 'mobile', 'contactno', 'contactnumber', 'telephone']],
    ['linkedin', ['linkedin', 'linkedinurl', 'linkedinprofile', 'li', 'poclinkedin'], ['linkedin']],
    ['source', ['source', 'leadsource', 'foundon', 'platform', 'jobboard', 'jobsource'], ['leadsource', 'jobboard', 'jobsource']],
    ['date', ['date', 'leaddate', 'dateadded', 'createdon'], ['leaddate', 'dateadded']],
    ['notes', ['notes', 'note', 'comments', 'comment', 'remarks'], ['notes', 'comments', 'remarks']],
    ['jdText', ['jobdescription', 'jobdesc', 'jd', 'description', 'requirements', 'jobdetails', 'jobposting', 'posting'],
      ['jobdescription', 'jobdesc', 'jobdetails', 'requirements']],
    ['analystName', ['analystname', 'analyst', 'raname', 'researchanalyst', 'ra'], ['analystname', 'researchanalyst']],
    ['bdmAssigned', ['bdmassigned', 'bdm', 'bdmanager', 'managername', 'assignedto'], ['bdmassigned', 'bdmanager']],
    ['salaryRange', ['salaryrange', 'salary', 'compensation', 'pay', 'salaryband', 'payrange'], ['salary', 'compensation', 'payrange']],
    ['jobCreatedDate', ['jobcreateddate', 'jobcreated', 'datecreated', 'createdate', 'dateposted', 'posteddate', 'postedon', 'jobposteddate'],
      ['jobcreated', 'dateposted', 'posteddate', 'postedon']],
  ];

  function normKey(k) { return String(k == null ? '' : k).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // Which field is this column? null = not recognised (kept as an extra).
  function fieldFor(columnName) {
    var k = normKey(columnName);
    if (!k) return null;
    var i;
    for (i = 0; i < FIELDS.length; i++) if (FIELDS[i][1].indexOf(k) > -1) return FIELDS[i][0];
    // A company's LinkedIn page is not the contact's profile.
    if (k.indexOf('company') > -1 && k.indexOf('linkedin') > -1) return null;
    for (i = 0; i < FIELDS.length; i++) {
      var words = FIELDS[i][2];
      for (var w = 0; w < words.length; w++) if (k.indexOf(words[w]) > -1) return FIELDS[i][0];
    }
    return null;
  }

  // One spreadsheet row → { <field>: value, ..., _extra: { <Column as written>: value } }.
  // The first non-empty column for a field wins; a second one goes to _extra
  // rather than being lost.
  function mapRow(row) {
    var out = { _extra: {} };
    Object.keys(row || {}).forEach(function (col) {
      var val = String(row[col] == null ? '' : row[col]).trim();
      if (!val) return;
      var f = fieldFor(col);
      if (f && !out[f]) out[f] = val;
      else out._extra[String(col).trim().slice(0, 80)] = val.slice(0, 500);
    });
    return out;
  }

  var api = { FIELDS: FIELDS, normKey: normKey, fieldFor: fieldFor, mapRow: mapRow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImportColumns = api;
})(typeof window !== 'undefined' ? window : this);
