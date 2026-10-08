// ============================================================================
// THE LEAD FINDER — the rules, with no database and no network (R-157, D-0087…D-0091).
// ----------------------------------------------------------------------------
// A person saves a SEARCH (job titles, where the jobs are, company size, how recent). Each night — or when they
// press "Run now" — PACE asks Apollo for companies hiring for those titles and turns the best into CARDS. Nothing
// is saved as a lead until the person presses Accept (the owner: "if every search result is added then the storage
// build will be humongous"), so a card is a short-lived suggestion, not a record.
//
// This file holds only the decisions that need no I/O:
//   * the sector presets (the owner's list) and the size bands (small 11–50, mid 51–500, large 501+);
//   * validating a saved search, and turning it into Apollo's filter names;
//   * reading an Apollo company row (either bucket) into one shape;
//   * leaving staffing firms out (a competitor, not a client) and ranking the rest;
//   * reading a company's postings (title, link, where, when) and the plain-words signals in them;
//   * the keys the daily meters and the per-person switches live under.
// routes/finder.js owns the database and the Apollo calls; services/people-apollo.js is the only caller of Apollo.
// ============================================================================
const rule = require('./lead-decision');

// The owner's sectors. First list (7 Oct 2026): "IT … medical, manufacturing, construction, legal, accounting, property
// management, engineering and all; big, small and medium companies". Widened on 8 Oct after first live use ("we have very
// limited industry … the kind of leads that are created are very limited"): about forty. A sector is a SHORTCUT, not a filter
// — it offers typical job titles to tick (the search itself runs on the titles, where, size and keywords). A person can pick
// several sectors, tick any of their titles or all of them, and type titles that are on no list.
const SECTORS = {
  it: { label: 'IT & software', titles: ['Software Engineer', 'Data Analyst', 'Systems Administrator', 'QA Engineer', 'Network Engineer', 'DevOps Engineer', 'Help Desk Technician', 'IT Support Specialist', 'Database Administrator', 'Cybersecurity Analyst', 'Business Analyst', 'Project Manager', 'Web Developer', 'Cloud Engineer'] },
  medical: { label: 'Medical & healthcare', titles: ['Registered Nurse', 'Medical Assistant', 'Medical Billing Specialist', 'Dental Hygienist', 'Physical Therapist', 'Patient Care Coordinator', 'Licensed Practical Nurse', 'Nurse Practitioner', 'Medical Receptionist', 'Radiology Technician', 'Phlebotomist', 'Medical Coder', 'Respiratory Therapist', 'Surgical Technologist'] },
  manufacturing: { label: 'Manufacturing', titles: ['CNC Machinist', 'Production Supervisor', 'Quality Inspector', 'Maintenance Technician', 'Welder', 'Industrial Engineer', 'Machine Operator', 'Assembler', 'Production Manager', 'Quality Engineer', 'Plant Manager', 'Tool and Die Maker', 'Process Engineer', 'Manufacturing Engineer'] },
  construction: { label: 'Construction', titles: ['Project Manager', 'Site Superintendent', 'Estimator', 'Safety Coordinator', 'Project Engineer', 'Construction Manager', 'Foreman', 'Carpenter', 'Heavy Equipment Operator', 'Project Coordinator', 'Civil Inspector', 'Scheduler', 'Laborer'] },
  legal: { label: 'Legal', titles: ['Paralegal', 'Legal Assistant', 'Contracts Administrator', 'Legal Secretary', 'Compliance Specialist', 'Litigation Support', 'Associate Attorney', 'Legal Counsel', 'Court Clerk', 'Legal Nurse Consultant', 'Law Clerk', 'Contract Manager'] },
  accounting: { label: 'Accounting', titles: ['Staff Accountant', 'Accounts Payable Clerk', 'Controller', 'Payroll Specialist', 'Accounts Receivable Specialist', 'Senior Accountant', 'Bookkeeper', 'Tax Accountant', 'Cost Accountant', 'Auditor', 'Accounting Manager', 'Billing Specialist', 'Financial Analyst'] },
  property: { label: 'Property management', titles: ['Property Manager', 'Leasing Agent', 'Maintenance Supervisor', 'Assistant Property Manager', 'Community Manager', 'Leasing Consultant', 'Maintenance Technician', 'Regional Property Manager', 'Resident Services Coordinator', 'Facilities Manager', 'Property Accountant'] },
  engineering: { label: 'Engineering', titles: ['Mechanical Engineer', 'Civil Engineer', 'Electrical Engineer', 'Project Engineer', 'Design Engineer', 'Manufacturing Engineer', 'Structural Engineer', 'Controls Engineer', 'CAD Designer', 'Field Engineer', 'Environmental Engineer', 'Systems Engineer', 'Test Engineer'] },
  banking: { label: 'Banking & lending', titles: ['Bank Teller', 'Loan Officer', 'Loan Processor', 'Mortgage Underwriter', 'Credit Analyst', 'Branch Manager', 'Relationship Manager', 'Personal Banker', 'Collections Specialist', 'Financial Advisor', 'Compliance Analyst', 'Fraud Analyst'] },
  insurance: { label: 'Insurance', titles: ['Claims Adjuster', 'Underwriter', 'Insurance Agent', 'Account Manager', 'Claims Examiner', 'Customer Service Representative', 'Policy Processor', 'Risk Analyst', 'Actuarial Analyst', 'Benefits Specialist', 'Insurance Sales Representative'] },
  realestate: { label: 'Real estate & mortgage', titles: ['Real Estate Agent', 'Loan Officer', 'Mortgage Processor', 'Closer', 'Title Examiner', 'Transaction Coordinator', 'Escrow Officer', 'Appraiser', 'Leasing Manager', 'Real Estate Analyst', 'Acquisitions Associate'] },
  retail: { label: 'Retail & e-commerce', titles: ['Store Manager', 'Assistant Store Manager', 'Sales Associate', 'Merchandiser', 'Visual Merchandiser', 'Buyer', 'Inventory Specialist', 'Cashier', 'Department Manager', 'E-commerce Manager', 'Loss Prevention Specialist', 'District Manager'] },
  hospitality: { label: 'Hotels & restaurants', titles: ['General Manager', 'Restaurant Manager', 'Chef', 'Line Cook', 'Front Desk Agent', 'Housekeeping Supervisor', 'Banquet Manager', 'Food and Beverage Manager', 'Event Coordinator', 'Server', 'Sous Chef', 'Revenue Manager'] },
  logistics: { label: 'Transportation & logistics', titles: ['Dispatcher', 'CDL Truck Driver', 'Logistics Coordinator', 'Freight Broker', 'Fleet Manager', 'Transportation Manager', 'Supply Chain Analyst', 'Customs Broker', 'Route Planner', 'Operations Manager', 'Procurement Specialist', 'Delivery Driver'] },
  warehouse: { label: 'Warehouse & distribution', titles: ['Warehouse Associate', 'Forklift Operator', 'Warehouse Supervisor', 'Shipping and Receiving Clerk', 'Inventory Control Specialist', 'Order Picker', 'Distribution Manager', 'Material Handler', 'Logistics Supervisor', 'Warehouse Manager', 'Packer'] },
  energy: { label: 'Energy & utilities', titles: ['Power Plant Operator', 'Lineman', 'Electrical Technician', 'Energy Analyst', 'Utility Locator', 'Solar Installer', 'Field Technician', 'Substation Technician', 'Project Manager', 'Meter Technician', 'Wind Turbine Technician', 'Reliability Engineer'] },
  oilgas: { label: 'Oil & gas', titles: ['Roustabout', 'Drilling Engineer', 'Petroleum Engineer', 'Pipeline Technician', 'Field Operator', 'HSE Coordinator', 'Production Operator', 'Wireline Operator', 'Completions Engineer', 'Landman', 'Reservoir Engineer', 'Mud Engineer'] },
  education: { label: 'Education', titles: ['Teacher', 'Substitute Teacher', 'Teaching Assistant', 'School Counselor', 'Special Education Teacher', 'Admissions Counselor', 'Instructional Designer', 'Registrar', 'Academic Advisor', 'Principal', 'Tutor', 'Curriculum Coordinator'] },
  government: { label: 'Government & nonprofit', titles: ['Program Manager', 'Grants Manager', 'Case Manager', 'Development Coordinator', 'Policy Analyst', 'Administrative Assistant', 'Community Outreach Coordinator', 'Social Worker', 'Executive Director', 'Volunteer Coordinator', 'Fundraiser', 'Contracts Specialist'] },
  telecom: { label: 'Telecommunications', titles: ['Network Technician', 'Cable Installer', 'Telecom Engineer', 'Field Technician', 'RF Engineer', 'Fiber Splicer', 'Network Operations Analyst', 'Tower Climber', 'Sales Engineer', 'Customer Support Representative', 'Project Coordinator'] },
  automotive: { label: 'Automotive', titles: ['Automotive Technician', 'Service Advisor', 'Service Manager', 'Parts Specialist', 'Body Repair Technician', 'Sales Consultant', 'Diesel Mechanic', 'Painter', 'Detailer', 'Finance Manager', 'Shop Foreman', 'Collision Estimator'] },
  aerospace: { label: 'Aerospace & defense', titles: ['Aircraft Mechanic', 'Avionics Technician', 'Aerospace Engineer', 'Quality Assurance Inspector', 'Systems Engineer', 'Program Manager', 'Sheet Metal Mechanic', 'Composite Technician', 'Test Technician', 'Supply Chain Specialist', 'Security Analyst'] },
  pharma: { label: 'Pharma & biotech', titles: ['Clinical Research Associate', 'Laboratory Technician', 'Quality Control Analyst', 'Regulatory Affairs Specialist', 'Research Scientist', 'Process Development Scientist', 'Manufacturing Associate', 'Clinical Data Manager', 'Pharmacist', 'Pharmacy Technician', 'Validation Engineer', 'Quality Assurance Specialist'] },
  food: { label: 'Food & beverage production', titles: ['Production Worker', 'Food Safety Technician', 'Quality Assurance Technician', 'Packaging Operator', 'Plant Supervisor', 'Maintenance Mechanic', 'Food Scientist', 'Line Lead', 'Sanitation Worker', 'Batch Operator', 'Production Planner'] },
  agriculture: { label: 'Agriculture', titles: ['Farm Manager', 'Agronomist', 'Equipment Operator', 'Irrigation Technician', 'Crop Advisor', 'Livestock Technician', 'Greenhouse Grower', 'Farm Laborer', 'Agricultural Technician', 'Grain Handler'] },
  marketing: { label: 'Marketing & advertising', titles: ['Marketing Manager', 'Digital Marketing Specialist', 'Content Writer', 'Graphic Designer', 'Social Media Manager', 'SEO Specialist', 'Account Executive', 'Brand Manager', 'Copywriter', 'Marketing Coordinator', 'Media Buyer', 'Email Marketing Specialist'] },
  admin: { label: 'Office & administration', titles: ['Administrative Assistant', 'Executive Assistant', 'Receptionist', 'Office Manager', 'Data Entry Clerk', 'Office Coordinator', 'Scheduler', 'Records Clerk', 'Operations Coordinator', 'Document Controller', 'Mail Clerk'] },
  hr: { label: 'Human resources', titles: ['HR Generalist', 'HR Manager', 'Recruiter', 'Talent Acquisition Specialist', 'Benefits Administrator', 'HR Coordinator', 'Payroll Administrator', 'Employee Relations Specialist', 'Training Coordinator', 'HR Business Partner', 'Onboarding Specialist'] },
  customer: { label: 'Customer service', titles: ['Customer Service Representative', 'Call Center Agent', 'Customer Success Manager', 'Technical Support Specialist', 'Client Services Coordinator', 'Support Team Lead', 'Inside Sales Representative', 'Order Entry Clerk', 'Customer Care Specialist', 'Call Center Supervisor'] },
  sales: { label: 'Sales & business development', titles: ['Sales Representative', 'Account Executive', 'Business Development Manager', 'Outside Sales Representative', 'Inside Sales Representative', 'Sales Manager', 'Territory Manager', 'Sales Engineer', 'Account Manager', 'Regional Sales Manager', 'Lead Generation Specialist'] },
  security: { label: 'Security services', titles: ['Security Officer', 'Security Guard', 'Loss Prevention Officer', 'Security Supervisor', 'Patrol Officer', 'Dispatcher', 'Alarm Technician', 'Security Manager', 'Surveillance Operator', 'Event Security Officer'] },
  environmental: { label: 'Environmental services', titles: ['Environmental Scientist', 'Environmental Health and Safety Specialist', 'Field Technician', 'Hazardous Waste Technician', 'Wastewater Operator', 'Remediation Technician', 'Geologist', 'Compliance Specialist', 'Water Treatment Operator', 'Industrial Hygienist'] },
  trades: { label: 'Skilled trades', titles: ['Electrician', 'Plumber', 'HVAC Technician', 'Pipefitter', 'Journeyman Electrician', 'Welder', 'Carpenter', 'Millwright', 'Sheet Metal Worker', 'Mason', 'Roofer', 'Painter', 'Apprentice Electrician', 'Service Technician'] },
  media: { label: 'Media & publishing', titles: ['Editor', 'Reporter', 'Producer', 'Video Editor', 'Graphic Designer', 'Content Strategist', 'Photographer', 'Production Assistant', 'Copy Editor', 'Social Media Producer', 'Broadcast Engineer'] },
  homecare: { label: 'Home health & senior care', titles: ['Home Health Aide', 'Certified Nursing Assistant', 'Caregiver', 'Personal Care Aide', 'Registered Nurse', 'Care Coordinator', 'Activities Director', 'Licensed Practical Nurse', 'Hospice Nurse', 'Administrator', 'Medication Aide', 'Physical Therapy Assistant'] },
  dental: { label: 'Dental & vision', titles: ['Dental Assistant', 'Dental Hygienist', 'Dental Receptionist', 'Dentist', 'Optician', 'Optometric Technician', 'Dental Office Manager', 'Treatment Coordinator', 'Orthodontic Assistant', 'Dental Biller'] },
  veterinary: { label: 'Veterinary & animal care', titles: ['Veterinary Technician', 'Veterinary Assistant', 'Veterinarian', 'Kennel Attendant', 'Veterinary Receptionist', 'Practice Manager', 'Groomer', 'Animal Care Technician', 'Client Service Representative'] },
  facilities: { label: 'Cleaning & facilities', titles: ['Janitor', 'Custodian', 'Facilities Technician', 'Building Maintenance Worker', 'Housekeeper', 'Groundskeeper', 'Facilities Manager', 'Porter', 'Cleaning Supervisor', 'Landscaper', 'Maintenance Mechanic'] },
  consulting: { label: 'Consulting & professional services', titles: ['Management Consultant', 'Business Analyst', 'Project Manager', 'Senior Consultant', 'Operations Analyst', 'Strategy Analyst', 'Associate Consultant', 'Program Manager', 'Implementation Consultant', 'Research Analyst'] },
};

// Size bands as Apollo spells them (employee ranges).
const SIZE_BANDS = [
  { id: 'small', label: 'Small 11–50', ranges: ['11,50'] },
  { id: 'mid', label: 'Mid 51–500', ranges: ['51,200', '201,500'] },
  { id: 'large', label: 'Large 501+', ranges: ['501,1000', '1001,2000', '2001,5000', '5001,10000'] },
];
// How recent the postings must be: any whole number of days from 0 (today) to 30 (the owner's slider, 8 Oct 2026).
const POSTED_RANGE = { min: 0, max: 30, def: 14 };
// Where a search looks: Apollo (company database, spends the organisation's Apollo credits), the free job sources (a job-search
// service the organisation has its own key for; no company data, no people), or both.
const SOURCES = ['apollo', 'free', 'both'];
const LIMITS = { name: 80, titles: 40, title: 80, locations: 8, location: 80, keywords: 8, keyword: 40, domains: 30, sectors: 8 };

const txt = (v) => String(v == null ? '' : v).trim();
function uniqueList(v, max, each) {
  const seen = new Set(), out = [];
  (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[\n,;]+/)).forEach((x) => {
    const s = txt(x).slice(0, each);
    const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); out.push(s); }
  });
  return out.slice(0, max);
}
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);

/** Days back for the posted-within slider. 0 is a real answer ("today only"), so it is never read as "not given". */
function postedDays(v) {
  const n = Number(v);
  return v !== '' && v != null && Number.isInteger(n) && n >= POSTED_RANGE.min && n <= POSTED_RANGE.max ? n : POSTED_RANGE.def;
}

/**
 * The companies a person asked for by name, in one shape: { name, domain, city, state }. Accepts objects, or bare
 * websites; the website is what Apollo is searched by, so an entry without a usable one is dropped. Any website that
 * arrives only in `domains` (an older saved search, a caller that sends websites alone) gets an entry too, so the two
 * lists never disagree.
 */
function normalizeCompanies(companies, domains) {
  const out = [], seen = new Set();
  const add = (name, domain, city, state) => {
    const d = rule.normalizeDomain(domain);
    if (!d || seen.has(d) || out.length >= LIMITS.domains) return;
    seen.add(d);
    out.push({ name: txt(name).slice(0, 120) || d, domain: d, city: txt(city).slice(0, 60), state: txt(state).slice(0, 60) });
  };
  (Array.isArray(companies) ? companies : []).forEach((c) => {
    if (c && typeof c === 'object') add(c.name, c.domain || c.website, c.city, c.state);
    else add('', c, '', '');
  });
  uniqueList(domains, LIMITS.domains, 120).forEach((d) => add('', d, '', ''));
  return out;
}

/** A saved search, checked. { ok:true, value } or { ok:false, error } in the person's words. */
function normalizeSearch(input) {
  const i = input || {};
  const name = txt(i.name).slice(0, LIMITS.name);
  if (!name) return { ok: false, error: 'Give the search a name, so you can find it in your list later.' };
  const titles = uniqueList(i.titles, LIMITS.titles, LIMITS.title);
  if (!titles.length) return { ok: false, error: 'Add at least one job title to look for.' };
  const locations = uniqueList(i.locations, LIMITS.locations, LIMITS.location);
  if (!locations.length) return { ok: false, error: 'Add at least one place where the job is (a city, a state, or "remote").' };
  const sizes = uniqueList(i.sizes, 3, 10).map((s) => s.toLowerCase()).filter((s) => SIZE_BANDS.some((b) => b.id === s));
  // Several industries may be picked; `sector` (the first) stays for anything that still reads the one-industry column.
  const known = (id) => Object.prototype.hasOwnProperty.call(SECTORS, id);
  const sectors = uniqueList(i.sectors, LIMITS.sectors, 30).filter(known);
  if (!sectors.length && known(i.sector)) sectors.push(i.sector);
  const companies = normalizeCompanies(i.companies, i.domains);
  return {
    ok: true,
    value: {
      name, sector: sectors[0] || null, sectors, titles, locations, sizes,
      source: SOURCES.includes(i.source) ? i.source : 'apollo',
      posted_days: postedDays(i.posted_days),
      keywords: uniqueList(i.keywords, LIMITS.keywords, LIMITS.keyword),
      companies, domains: companies.map((c) => c.domain),
      active: i.active !== false,
    },
  };
}

/** Apollo's own filter names for a saved search (docs.apollo.io "Organization Search"). */
function apolloFilters(search, now) {
  const s = search || {};
  const f = {
    q_organization_job_titles: s.titles || [],
    organization_job_locations: s.locations || [],
    organization_job_posted_at_range: { min: isoDate(new Date(new Date(now).getTime() - (s.posted_days == null ? POSTED_RANGE.def : s.posted_days) * 86400000)) },
  };
  const ranges = (s.sizes || []).reduce((a, id) => a.concat((SIZE_BANDS.find((b) => b.id === id) || { ranges: [] }).ranges), []);
  if (ranges.length) f.organization_num_employees_ranges = ranges;
  if ((s.keywords || []).length) f.q_organization_keyword_tags = s.keywords;
  if ((s.domains || []).length) f.q_organization_domains_list = s.domains;
  return f;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** One Apollo company row (either bucket) in one shape. */
function normalizeOrg(o) {
  const r = o || {};
  const domain = rule.normalizeDomain(r.primary_domain || r.domain || r.website_url);
  const phone = (r.primary_phone && (r.primary_phone.number || r.primary_phone.sanitized_number)) || r.phone || r.sanitized_phone || null;
  const city = txt(r.organization_city || r.city), state = txt(r.organization_state || r.state), country = txt(r.organization_country || r.country);
  return {
    // The "saved accounts" bucket carries the company's own id as organization_id and an ACCOUNT id as id.
    apollo_org_id: txt(r.organization_id || r.id) || null,
    saved_in_apollo: r.modality === 'account' || !!r.organization_id,
    name: txt(r.name),
    domain,
    website: txt(r.website_url) || (domain ? 'https://' + domain : ''),
    linkedin_url: rule.normalizeLinkedIn(r.linkedin_url) ? txt(r.linkedin_url).replace(/^http:/, 'https:') : '',
    phone: phone ? txt(phone) : '',
    address: txt(r.organization_raw_address || r.raw_address || r.street_address),
    city, state, country,
    employees: num(r.estimated_num_employees),
    revenue: txt(r.organization_revenue_printed),
    growth6: num(r.organization_headcount_six_month_growth),
    growth12: num(r.organization_headcount_twelve_month_growth),
    industry: txt(r.industry),
    sic: Array.isArray(r.sic_codes) ? r.sic_codes.map(String) : [],
    naics: Array.isArray(r.naics_codes) ? r.naics_codes.map(String) : [],
    founded_year: num(r.founded_year),
  };
}

/** Did the person type a website (acme.com, https://www.acme.com/careers) rather than a company name? Then no lookup is needed. */
function websiteFrom(text) {
  const t = txt(text);
  if (!t || /\s/.test(t) || !/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(t)) return '';
  return rule.normalizeDomain(t);
}

/** Apollo's filter for "which company is this called?" (partial name match; docs.apollo.io "Organization Search"). */
function companyNameFilters(name) { return { q_organization_name: txt(name).slice(0, 80) }; }

const nameKey = (v) => txt(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Apollo's answer to "which company is called …?" turned into a short pick-list: the company's own name, where it is,
 * its website, roughly how big. Best match first (the exact name, then names that start with what was typed, then the
 * rest; a company with a known place before one without). A company with no website is left out — the website is what
 * the search is narrowed by, so it could not be used. Nothing is guessed: every field is Apollo's own.
 */
function rankCompanySuggestions(rows, typed, max = 6) {
  const q = nameKey(typed), seen = new Set();
  const list = [];
  (Array.isArray(rows) ? rows : []).forEach((raw) => {
    const o = normalizeOrg(raw);
    if (!o.name || !o.domain || seen.has(o.domain)) return;
    seen.add(o.domain);
    const k = nameKey(o.name);
    const tier = k === q ? 0 : (k.startsWith(q) ? 1 : (k.includes(q) ? 2 : 3));
    list.push({ tier, hasPlace: o.city || o.state ? 0 : 1, o });
  });
  list.sort((a, b) => a.tier - b.tier || a.hasPlace - b.hasPlace || (b.o.employees || 0) - (a.o.employees || 0));
  return list.slice(0, max).map(({ o }) => ({ name: o.name, domain: o.domain, city: o.city, state: o.state, country: o.country, employees: o.employees, industry: o.industry, apollo_org_id: o.apollo_org_id }));
}

// ═══ THE FREE JOB SOURCES (R-164, D-0099) — job-search results turned into the same company cards ══════════════════
// A job-search service answers "who is hiring a welder in Texas" with JOBS, each naming its employer. A card is a COMPANY, so
// the jobs are grouped by employer, and the jobs themselves ride on the card (the Accept window offers them with no further
// request). Everything here is a pure function: the route owns the key, the meter and the call.

const JOB_BOARD_HOST = /(linkedin|indeed|glassdoor|ziprecruiter|simplyhired|monster|dice|careerbuilder|jooble|adzuna|talent|jobrapido|learn4good|google)\./i;
const INDIA = /\b(india|bengaluru|bangalore|hyderabad|chennai|mumbai|pune|delhi|noida|gurgaon|gurugram|kolkata|ahmedabad)\b/i;

/** The service's country code for a search's places (PACE serves the US and India). */
const countryFor = (locations) => ((locations || []).some((l) => INDIA.test(l)) ? 'in' : 'us');

/** The service only knows today / 3 days / a week / a month; the exact number of days is applied afterwards (jobsToOrgs). */
const datePostedFor = (days) => { const d = postedDays(days); return d === 0 ? 'today' : d <= 3 ? '3days' : d <= 7 ? 'week' : 'month'; };

/**
 * The searches one run asks the service, and how many of the person's choices they cover. Each request costs one credit on
 * the organisation's own plan, so a run asks for at most `max` of them: a title in a place ("Welder jobs in Texas"), or — when
 * companies were chosen by name — "Acme Mfg jobs in Texas". A daily run rotates through the choices by the day number, so a
 * long list is covered over several mornings; a one-off search starts at the first.
 */
function jsearchPlan(search, now, { max = 3, rotate = false } = {}) {
  const s = search || {};
  const places = (s.locations || []).slice(0, LIMITS.locations);
  const subjects = (s.companies && s.companies.length) ? s.companies.map((c) => c.name || c.domain) : (s.titles || []);
  const pairs = [];
  subjects.forEach((t) => places.forEach((l) => pairs.push((t + ' jobs in ' + l).trim())));
  const total = pairs.length, n = Math.max(0, Math.min(Number(max) || 0, total));
  const start = rotate && total ? (Math.floor(new Date(now).getTime() / 86400000) * n) % total : 0;
  const picked = [];
  for (let k = 0; k < n; k++) picked.push(pairs[(start + k) % total]);
  const country = countryFor(places), date_posted = datePostedFor(s.posted_days);
  return { queries: picked.map((query) => ({ query, country, date_posted })), total, covered: n, byCompany: !!(s.companies && s.companies.length) };
}

/** One job as the service sends it, in one shape. A job-board website is not the employer's website, so it is dropped. */
function normalizeJob(j) {
  const r = j || {};
  const site = rule.normalizeDomain(r.employer_website);
  const domain = site && !JOB_BOARD_HOST.test(site) ? site : '';
  const at = r.job_posted_at_datetime_utc ? new Date(r.job_posted_at_datetime_utc) : null;
  const t = at && !isNaN(at.getTime()) ? at.getTime() : null;
  const link = txt(r.job_apply_link);
  return {
    title: txt(r.job_title).slice(0, 200), employer: txt(r.employer_name).slice(0, 300), domain,
    website: domain ? 'https://' + domain : '',
    city: txt(r.job_city), state: txt(r.job_state), country: txt(r.job_country),
    url: /^https?:\/\//i.test(link) ? link.slice(0, 600) : '',
    publisher: txt(r.job_publisher).slice(0, 80), posted_at: t ? new Date(t).toISOString() : null, remote: r.job_is_remote === true,
  };
}

/** Does a job's title fit one of the titles the person chose? Either contains the other, ignoring case and punctuation. */
function titleMatches(jobTitle, titles) {
  const norm = (v) => txt(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const j = norm(jobTitle);
  if (!j) return false;
  return (titles || []).some((t) => { const k = norm(t); return k && (j.includes(k) || k.includes(j)); });
}

/**
 * Jobs → companies. Keeps only jobs inside the posted-within window (the service cannot count exact days; a job with no date
 * is kept — the service did not say it was old); when companies were chosen by name keeps only theirs, and of those only jobs
 * that fit a chosen title; groups by employer's website (else its name); drops an employer with no name.
 */
function jobsToOrgs(rawJobs, search, now) {
  const s = search || {}, at = new Date(now).getTime();
  const oldest = (s.posted_days == null ? POSTED_RANGE.def : s.posted_days);
  const cutoff = isoDate(new Date(at - oldest * 86400000));
  const wantCo = (s.companies || []).map((c) => ({ domain: c.domain, key: nameKey(c.name) })).filter((c) => c.domain || c.key);
  const groups = new Map();
  (Array.isArray(rawJobs) ? rawJobs : []).forEach((raw) => {
    const j = normalizeJob(raw);
    if (!j.title || !j.employer) return;
    if (j.posted_at && j.posted_at.slice(0, 10) < cutoff) return;
    if (wantCo.length) {
      const ek = nameKey(j.employer);
      if (!wantCo.some((c) => (c.domain && c.domain === j.domain) || (c.key && (ek === c.key || ek.startsWith(c.key + ' ') || c.key.startsWith(ek + ' '))))) return;
      if ((s.titles || []).length && !titleMatches(j.title, s.titles)) return;
    }
    const key = j.domain || ('n:' + nameKey(j.employer)).slice(0, 300);
    if (!groups.has(key)) groups.set(key, { key, name: j.employer, domain: j.domain, website: j.website, city: '', state: '', country: '', jobs: [], seen: new Set() });
    const g = groups.get(key);
    if (!g.city && (j.city || j.state)) { g.city = j.city; g.state = j.state; g.country = j.country; }
    const dup = (j.title + '|' + j.city + '|' + j.state).toLowerCase();
    if (g.seen.has(dup)) return;
    g.seen.add(dup);
    g.jobs.push(j);
  });
  return Array.from(groups.values()).map((g) => {
    const postings = g.jobs.map((j) => {
      const t = j.posted_at ? new Date(j.posted_at).getTime() : null;
      return { title: j.title, url: j.url, city: j.city, state: j.state, country: j.country, posted_at: j.posted_at, age_days: t ? Math.max(0, Math.floor((at - t) / 86400000)) : null, source: j.publisher || sourceOf(j.url) };
    }).sort((a, b) => (a.age_days == null ? 9e9 : a.age_days) - (b.age_days == null ? 9e9 : b.age_days)).slice(0, 25);
    return {
      apollo_org_id: null, saved_in_apollo: false, name: g.name, domain: g.domain, website: g.website, linkedin_url: '', phone: '', address: '',
      city: g.city, state: g.state, country: g.country, employees: null, revenue: '', growth6: null, growth12: null, industry: '', sic: [], naics: [], founded_year: null,
      source: 'free', company_key: g.key, postings,
    };
  });
}

/**
 * Ranking and the "why" chips for a company found through the free sources. It has no size or growth (that is company data),
 * so it is ordered by what the search itself saw: how many matching jobs, how fresh, whether its own website is known.
 */
function scoreFreeOrg(org) {
  const posts = (org && org.postings) || [];
  const chips = [];
  let score = 50 + Math.min(posts.length, 5) * 4;
  const ages = posts.map((p) => p.age_days).filter((d) => d != null);
  if (ages.length) {
    const newest = Math.min.apply(null, ages);
    chips.push(newest === 0 ? 'Newest posted today' : 'Newest posted ' + newest + ' day' + (newest === 1 ? '' : 's') + ' ago');
    score += newest <= 3 ? 8 : newest <= 7 ? 5 : newest <= 14 ? 2 : 0;
  }
  const via = Array.from(new Set(posts.map((p) => p.source).filter(Boolean))).slice(0, 3);
  if (via.length) chips.push('Seen on ' + via.join(', '));
  if (org && org.website) score += 3;
  return { score: Math.round(clamp(score, 0, 100) * 10) / 10, chips };
}

/**
 * Two lists of companies (Apollo's and the free sources') into one, a company only once. A company in both keeps Apollo's
 * record (it has size, phone, growth) and takes the free source's jobs, so its card shows the jobs without a credit.
 */
function mergeSources(apolloOrgs, freeOrgs) {
  const out = (apolloOrgs || []).slice();
  const byDomain = new Map(); out.forEach((o) => { if (o.domain) byDomain.set(o.domain, o); });
  const names = new Set(out.map((o) => nameKey(o.name)));
  (freeOrgs || []).forEach((f) => {
    const hit = f.domain && byDomain.get(f.domain);
    if (hit) { hit.postings = f.postings; hit.also_free = true; return; }
    if (names.has(nameKey(f.name))) return;
    out.push(f);
  });
  return out;
}

// A staffing or recruiting firm is a competitor, not a client (the owner's choice, and lead-ingest.js says the same).
// SIC 7361 employment agencies and 7363 help supply, NAICS 5613xx employment services, then the name.
const STAFFING_NAME = /\b(staffing|recruit(ing|ers?|ment)?|talent (solutions|acquisition|partners)|workforce|personnel|headhunt\w*|employment (agency|services)|temp (agency|services)|manpower|search (firm|partners))\b/i;
function isStaffingFirm(org) {
  const o = org || {};
  if ((o.sic || []).some((c) => /^736[123]/.test(c))) return true;
  if ((o.naics || []).some((c) => /^5613/.test(c))) return true;
  return STAFFING_NAME.test(String(o.name || ''));
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (f) => Math.round(f * 100);

/**
 * The cheap ranking, from what the company search already says (opening a company's postings costs a credit, so
 * posting signals come later, when a card is opened). Growth is the main signal; a company that cannot be reached
 * (no phone, no LinkedIn, no website) sorts lower. The score only orders cards — it is never shown as a number.
 */
function scoreOrg(org, search) {
  const o = org || {};
  let score = 50;
  const chips = [];
  if (o.growth12 != null) {
    score += clamp(o.growth12 * 100, -20, 40) * 0.75;
    if (o.growth12 >= 0.05) chips.push('Headcount +' + pct(o.growth12) + '% in a year');
    else if (o.growth12 <= -0.05) chips.push('Headcount ' + pct(o.growth12) + '% in a year');
  }
  const band = (search && search.sizes && search.sizes.length === 1) ? SIZE_BANDS.find((b) => b.id === search.sizes[0]) : null;
  if (o.employees != null) {
    chips.push('About ' + o.employees.toLocaleString('en-US') + ' staff');
    if (band) {
      const [lo, hi] = [band.ranges[0], band.ranges[band.ranges.length - 1]].map((r, k) => Number(r.split(',')[k]));
      if (o.employees >= lo && o.employees <= hi) score += 10;
    }
  }
  if (o.phone) score += 4;
  if (o.linkedin_url) score += 3;
  if (o.website) score += 3;
  if (o.revenue) chips.push('Revenue ' + o.revenue);
  if (o.saved_in_apollo) chips.push('Already saved in your Apollo');
  return { score: Math.round(clamp(score, 0, 100) * 10) / 10, chips };
}

const BOARD_HOSTS = [[/linkedin\.com/i, 'LinkedIn'], [/indeed\.com/i, 'Indeed'], [/glassdoor\.com/i, 'Glassdoor'], [/ziprecruiter\.com/i, 'ZipRecruiter'], [/simplyhired\.com/i, 'SimplyHired'], [/monster\.com/i, 'Monster'], [/dice\.com/i, 'Dice']];
function sourceOf(url) {
  const u = txt(url);
  if (!u) return '';
  const hit = BOARD_HOSTS.find(([re]) => re.test(u));
  if (hit) return hit[1];
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

/** Apollo's postings, as the card shows them, newest first. */
function normalizePostings(list, now) {
  const at = new Date(now).getTime();
  return (Array.isArray(list) ? list : []).map((p) => {
    const posted = p && (p.posted_at || p.last_seen_at) ? new Date(p.posted_at || p.last_seen_at) : null;
    const t = posted && !isNaN(posted.getTime()) ? posted.getTime() : null;
    return {
      title: txt(p && p.title).slice(0, 200),
      url: /^https?:\/\//i.test(txt(p && p.url)) ? txt(p.url).slice(0, 600) : '',
      city: txt(p && p.city), state: txt(p && p.state), country: txt(p && p.country),
      posted_at: t ? new Date(t).toISOString() : null,
      age_days: t ? Math.max(0, Math.floor((at - t) / 86400000)) : null,
      source: sourceOf(p && p.url),
    };
  }).filter((p) => p.title).sort((a, b) => (a.age_days == null ? 9e9 : a.age_days) - (b.age_days == null ? 9e9 : b.age_days));
}

/** What the postings say about the company, in plain words (these are the "hard to fill / team build" signals). */
function postingSignals(postings) {
  const list = postings || [];
  if (!list.length) return { open_roles: 0, oldest_days: null, repeated: [], chips: [] };
  const ages = list.map((p) => p.age_days).filter((d) => d != null);
  const oldest = ages.length ? Math.max.apply(null, ages) : null;
  const counts = {};
  list.forEach((p) => { const k = p.title.toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
  const repeated = Object.keys(counts).filter((k) => counts[k] > 1).map((k) => ({ title: list.find((p) => p.title.toLowerCase() === k).title, times: counts[k] }));
  const chips = [list.length + ' open role' + (list.length === 1 ? '' : 's')];
  if (oldest != null && oldest >= 30) chips.push('Oldest open ' + oldest + ' days');
  repeated.forEach((r) => chips.push(r.title + ' posted ' + r.times + ' times'));
  return { open_roles: list.length, oldest_days: oldest, repeated, chips };
}

/** The facts an email can state truthfully when the posting TEXT cannot be read (never invented). */
function factsLines(org, postings) {
  const o = org || {}, sig = postingSignals(postings);
  const lines = [];
  if (sig.open_roles) lines.push(o.name + ' has ' + sig.open_roles + ' open role' + (sig.open_roles === 1 ? '' : 's') + (sig.oldest_days != null && sig.oldest_days >= 14 ? ', the oldest posted ' + sig.oldest_days + ' days ago' : '') + '.');
  if (o.growth12 != null && Math.abs(o.growth12) >= 0.05) lines.push('Headcount has ' + (o.growth12 > 0 ? 'grown ' : 'changed ') + pct(o.growth12) + '% in the last year.');
  sig.repeated.forEach((r) => lines.push('The ' + r.title + ' role has been posted ' + r.times + ' times.'));
  return lines;
}

// ── the meters and the switches (all in app_settings; none needs a migration) ──
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const creditKey = (orgId, now) => 'finder_credits_' + (orgId || 'default') + '_' + dayOf(now);
const jsearchKey = (orgId, now) => 'finder_jsearch_' + (orgId || 'default') + '_' + dayOf(now);
const revealKey = (userId, now) => 'finder_reveals_' + userId + '_' + dayOf(now);
const accessKey = (userId) => 'finder_user_' + userId;
/** { enabled, daily } from the stored JSON; anything unreadable is "not enabled". */
function readAccess(value) {
  let v = null;
  try { v = typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { v = null; }
  if (!v || typeof v !== 'object') return { enabled: false, daily: null };
  const d = Number(v.daily);
  return { enabled: v.enabled === true, daily: Number.isFinite(d) && d >= 0 ? Math.floor(d) : null };
}
const dailyFor = (access, orgDefault) => (access && access.daily != null ? access.daily : Math.max(0, Number(orgDefault) || 0));

/** A card on Wait comes back when its date arrives. */
const waitUntil = (now, days) => dayOf(new Date(new Date(now).getTime() + Math.max(1, Number(days) || 14) * 86400000));
const isDue = (card, now) => !!card && card.status === 'waiting' && !!card.wait_until && String(card.wait_until) <= dayOf(now);

/**
 * Which of a person's mailboxes a lead should default to: the one that has sent the FEWEST emails today (so a person
 * with several mailboxes rotates through them instead of every lead landing on the first), then the larger daily
 * limit, then the address (so the answer never depends on the order the database happens to return rows in).
 * `sentToday` is { mailboxId: n }. Returns an id, or null when there is none.
 */
function suggestMailbox(accounts, sentToday) {
  const list = (accounts || []).filter((a) => a && a.id);
  if (!list.length) return null;
  const sent = (a) => Number((sentToday || {})[a.id]) || 0;
  const limit = (a) => Number(a.daily_send_limit) || 150;
  return list.slice().sort((a, b) => sent(a) - sent(b) || limit(b) - limit(a) || String(a.email_address || '').localeCompare(String(b.email_address || '')))[0].id;
}

module.exports = {
  SECTORS, SIZE_BANDS, POSTED_RANGE, LIMITS, SOURCES,
  countryFor, datePostedFor, jsearchPlan, normalizeJob, titleMatches, jobsToOrgs, scoreFreeOrg, mergeSources, jsearchKey,
  normalizeSearch, normalizeCompanies, postedDays, apolloFilters, websiteFrom, companyNameFilters, rankCompanySuggestions, normalizeOrg, isStaffingFirm, scoreOrg,
  normalizePostings, postingSignals, factsLines, sourceOf,
  dayOf, creditKey, revealKey, accessKey, readAccess, dailyFor, waitUntil, isDue, suggestMailbox,
};
