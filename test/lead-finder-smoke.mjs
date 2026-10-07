// The Lead Finder's pure rules (services/lead-finder.js): what a saved search may say, how it becomes Apollo's
// filters, how a company is read, who is left out, how cards are ordered, and how the daily meters are keyed.
// No database, no network. The routes that use these are covered by finder-routes-smoke.mjs.
//
// Usage: node test/lead-finder-smoke.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../services/lead-finder.js');

const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const NOW = new Date('2026-10-07T12:00:00Z');

// ── a saved search ─────────────────────────────────────────────────────────
console.log('\nA saved search');
let v = F.normalizeSearch({ name: '  Texas shops  ', titles: 'CNC Machinist, welder ; CNC machinist\nWelder', locations: ['Texas', ' texas ', 'Remote'], sizes: ['mid', 'huge', 'MID'], posted_days: 30, sector: 'manufacturing', domains: 'https://www.Acme.com/about, acme.com' });
step('names, titles and places are tidied: trimmed, split on commas / semicolons / lines, duplicates dropped', v.ok && v.value.name === 'Texas shops' && v.value.titles.join() === 'CNC Machinist,welder' && v.value.locations.join() === 'Texas,Remote', JSON.stringify(v.value));
step('an unknown size is ignored; a known one is kept once', v.value.sizes.join() === 'mid');
step('domains are reduced to the bare website and not repeated', v.value.domains.join() === 'acme.com', v.value.domains.join());
step('a sector that is not one of ours becomes none', F.normalizeSearch({ name: 'x', titles: 'a', locations: 'b', sector: 'astrology' }).value.sector === null);
step('posted-within is 7, 14 or 30 days — anything else becomes 14', F.normalizeSearch({ name: 'x', titles: 'a', locations: 'b', posted_days: 99 }).value.posted_days === 14 && F.normalizeSearch({ name: 'x', titles: 'a', locations: 'b', posted_days: 7 }).value.posted_days === 7);
step('a search with no name is refused, in words', /name/i.test(F.normalizeSearch({ titles: 'a', locations: 'b' }).error));
step('a search with no job title is refused, in words', /job title/i.test(F.normalizeSearch({ name: 'x', locations: 'b' }).error));
step('a search with no place is refused, in words', /place/i.test(F.normalizeSearch({ name: 'x', titles: 'a' }).error));
step('there is a ceiling on titles, so one search cannot become a giant Apollo query', F.normalizeSearch({ name: 'x', locations: 'b', titles: Array.from({ length: 40 }, (_, i) => 'T' + i) }).value.titles.length === F.LIMITS.titles);

// ── turning it into Apollo's filter names ──────────────────────────────────
console.log('\nApollo filters');
const f = F.apolloFilters({ titles: ['CNC Machinist'], locations: ['Texas'], sizes: ['small', 'mid'], posted_days: 14, keywords: ['machining'], domains: ['acme.com'] }, NOW);
step('titles, places and the date go under Apollo\'s own names, the date counted back from today', f.q_organization_job_titles.join() === 'CNC Machinist' && f.organization_job_locations.join() === 'Texas' && f.organization_job_posted_at_range.min === '2026-09-23');
step('sizes become Apollo\'s employee ranges (small 11–50, mid 51–200 and 201–500)', f.organization_num_employees_ranges.join() === '11,50,51,200,201,500');
step('keywords and domains are passed only when there are some', f.q_organization_keyword_tags.join() === 'machining' && f.q_organization_domains_list.join() === 'acme.com' && !('q_organization_keyword_tags' in F.apolloFilters({ titles: ['a'], locations: ['b'] }, NOW)) && !('organization_num_employees_ranges' in F.apolloFilters({ titles: ['a'], locations: ['b'] }, NOW)));

// ── reading a company ──────────────────────────────────────────────────────
console.log('\nReading a company');
const o = F.normalizeOrg({ id: 'acct1', organization_id: '5e66b6381e05b4008c8331b8', modality: 'account', name: ' Brazos Valley Machining ', primary_domain: 'brazosmachining.com', website_url: 'http://www.brazosmachining.com', linkedin_url: 'http://www.linkedin.com/company/brazos', primary_phone: { number: '+1 254-555-0188' }, organization_city: 'Waco', organization_state: 'Texas', estimated_num_employees: 85, organization_headcount_twelve_month_growth: 0.12, sic_codes: [3599] });
step('a "saved account" row is keyed by the COMPANY\'s id, not the account id, and says it was already in Apollo', o.apollo_org_id === '5e66b6381e05b4008c8331b8' && o.saved_in_apollo === true);
step('name, domain, phone, place, size and growth are read; LinkedIn is made https', o.name === 'Brazos Valley Machining' && o.domain === 'brazosmachining.com' && o.phone === '+1 254-555-0188' && o.city === 'Waco' && o.employees === 85 && o.growth12 === 0.12 && /^https:/.test(o.linkedin_url));
const bare = F.normalizeOrg({});
step('an empty row reads as empty, never as undefined text or a crash', bare.name === '' && bare.domain === '' && bare.phone === '' && bare.employees === null && bare.apollo_org_id === null);

// ── who is left out ────────────────────────────────────────────────────────
console.log('\nStaffing firms');
step('a staffing firm is left out by its industry code (7361, 7363, 5613)', F.isStaffingFirm({ name: 'Acme', sic: ['7363'] }) && F.isStaffingFirm({ name: 'Acme', naics: ['561311'] }) && F.isStaffingFirm({ name: 'Acme', sic: ['7361'] }));
step('…or by its name', ['Apex Staffing Group', 'Lone Star Recruiters', 'TalentBridge Workforce Solutions', 'Manpower of Austin', 'Executive Search Partners'].every((n) => F.isStaffingFirm({ name: n })));
step('a real client is not mistaken for one (a machine shop, a dental group, a recruitment-free name)', ['Brazos Valley Machining', 'Lone Star Dental Partners', 'Gulf Coast Property Group'].every((n) => !F.isStaffingFirm({ name: n })));
step('a sic code that merely STARTS like a staffing code (7364) is not one', !F.isStaffingFirm({ name: 'Acme', sic: ['7364'] }));

// ── ordering the cards ─────────────────────────────────────────────────────
console.log('\nOrdering');
const grow = F.scoreOrg({ growth12: 0.2, employees: 85, phone: '1', website: 'x', linkedin_url: 'y' }, { sizes: ['mid'] });
const flat = F.scoreOrg({ employees: 85 }, { sizes: ['mid'] });
const shrink = F.scoreOrg({ growth12: -0.2, employees: 85 }, { sizes: ['mid'] });
step('a growing, reachable company ranks above a plain one, which ranks above a shrinking one', grow.score > flat.score && flat.score > shrink.score, [grow.score, flat.score, shrink.score].join(' > '));
step('the reasons are plain chips a person can read', grow.chips.includes('Headcount +20% in a year') && grow.chips.includes('About 85 staff'));
step('the score stays between 0 and 100 whatever Apollo says', F.scoreOrg({ growth12: 50 }).score <= 100 && F.scoreOrg({ growth12: -50 }).score >= 0);

// ── postings ───────────────────────────────────────────────────────────────
console.log('\nPostings');
const posts = F.normalizePostings([
  { title: 'Welder', url: 'https://www.linkedin.com/jobs/view/1', posted_at: '2026-08-20T00:00:00Z', city: 'Waco', state: 'TX' },
  { title: 'Welder', url: 'https://indeed.com/viewjob?jk=2', posted_at: '2026-09-30T00:00:00Z' },
  { title: 'CNC Machinist', url: 'javascript:alert(1)', posted_at: 'not a date' },
  { title: '   ' },
], NOW);
step('postings are read newest first, a nameless one is dropped, an unreadable date is "unknown" and sorts last', posts.length === 3 && posts[0].age_days === 7 && posts[1].age_days === 48 && posts[2].age_days === null);
step('a link that is not http(s) is never kept (a posting cannot carry a script into the page)', posts[2].url === '');
step('each posting names the board it came from', posts[0].source === 'Indeed' && posts[1].source === 'LinkedIn');
const sig = F.postingSignals(posts);
step('the signals say it in words: how many are open, how old the oldest is, what was posted twice', sig.open_roles === 3 && sig.oldest_days === 48 && sig.chips.includes('3 open roles') && sig.chips.includes('Oldest open 48 days') && sig.chips.includes('Welder posted 2 times'), sig.chips.join(' | '));
step('no postings means no signals, not a crash', F.postingSignals([]).open_roles === 0 && F.postingSignals(null).chips.length === 0);
const facts = F.factsLines({ name: 'Brazos', growth12: 0.12 }, posts);
step('the facts an email may state are only what Apollo said: counts, ages, growth — nothing about duties', facts.length >= 2 && facts.every((l) => !/responsib|duties|you will/i.test(l)) && /3 open roles/.test(facts[0]) && facts.some((l) => /grown 12%/.test(l)), facts.join(' | '));

// ── the meters and the switches ────────────────────────────────────────────
console.log('\nMeters and switches');
step('credit and reveal meters are per organisation / per person / per day', F.creditKey('o1', NOW) === 'finder_credits_o1_2026-10-07' && F.revealKey('u1', NOW) === 'finder_reveals_u1_2026-10-07' && F.creditKey('o1', new Date('2026-10-08T01:00:00Z')) !== F.creditKey('o1', NOW));
step('a person with no switch stored is NOT enabled; garbage is not enabled either', !F.readAccess(null).enabled && !F.readAccess('{oops').enabled && !F.readAccess('"yes"').enabled && !F.readAccess(undefined).enabled);
step('only an explicit true enables (a truthy string does not)', F.readAccess('{"enabled":true}').enabled && !F.readAccess('{"enabled":"true"}').enabled && !F.readAccess({ enabled: 1 }).enabled);
step('a person\'s own daily number beats the organisation\'s; none stored uses the organisation\'s; a bad one is ignored', F.dailyFor(F.readAccess('{"enabled":true,"daily":5}'), 25) === 5 && F.dailyFor(F.readAccess('{"enabled":true}'), 25) === 25 && F.dailyFor(F.readAccess('{"enabled":true,"daily":-3}'), 25) === 25 && F.dailyFor(F.readAccess('{"enabled":true,"daily":0}'), 25) === 0);
step('Wait counts N days forward (at least one), and a card wakes on its day, not before', F.waitUntil(NOW, 14) === '2026-10-21' && F.waitUntil(NOW, 0) === '2026-10-21' && F.waitUntil(NOW, 3) === '2026-10-10' && F.isDue({ status: 'waiting', wait_until: '2026-10-07' }, NOW) && !F.isDue({ status: 'waiting', wait_until: '2026-10-08' }, NOW) && !F.isDue({ status: 'new', wait_until: '2026-10-01' }, NOW));

console.log('\n=== LEAD FINDER RULES SMOKE ===');
const failed = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
