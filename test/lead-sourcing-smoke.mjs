// Tests the automated lead-sourcing pipeline (Step 2): board adapters, the
// staffing-firm filter, the hiring-reason inference, contact inference, and the
// ingest loop that ties them together.
//
// The board feeds are injected as fixtures rather than fetched. That is not only
// for speed — this sandbox's network policy blocks the real endpoints, so the
// adapters cannot be verified against live data here. The fixtures below mirror
// each provider's documented response shape, and `POST /lead-sources/test`
// exists so a real board can be confirmed from the deployed app, where egress
// is open. Adapter parsing is therefore tested; adapter *URLs* are not, and that
// is called out in the plan.
//
// Usage: node test/lead-sourcing-smoke.mjs   (no external dependencies)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const boards = require('../lead-sources/index.js');
const { parseLocation } = require('../lead-sources/location.js');
const { classifyCompany } = require('../company-classifier.js');
const { inferHiringReason } = require('../why-hiring.js');
const enrichment = require('../enrichment.js');
const ingest = require('../lead-ingest.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

// ── 1. adapters parse each provider's documented shape ──────────────────────
{
  const gh = boards.PROVIDERS.greenhouse.parse({
    jobs: [{ id: 12, title: 'Senior Java Developer', location: { name: 'Dallas, TX' },
      content: '&lt;p&gt;Required:&lt;/p&gt;&lt;ul&gt;&lt;li&gt;7+ years of Java&lt;/li&gt;&lt;/ul&gt;',
      absolute_url: 'https://boards.greenhouse.io/x/jobs/12', updated_at: '2026-06-01T00:00:00Z',
      departments: [{ name: 'Engineering' }] }]
  });
  ok('greenhouse: parses a posting', gh.length === 1 && gh[0].title === 'Senior Java Developer');
  ok('greenhouse: splits the location', gh[0].city === 'Dallas' && gh[0].state === 'TX');
  ok('greenhouse: decodes HTML into readable text',
    /7\+ years of Java/.test(gh[0].description) && !/<li>/.test(gh[0].description), gh[0].description);
  ok('greenhouse: keeps the department', gh[0].department === 'Engineering');

  const lever = boards.PROVIDERS.lever.parse([{
    id: 'abc', text: 'Backend Engineer', categories: { location: 'Remote - US', team: 'Platform' },
    descriptionPlain: 'Build things.', lists: [{ text: 'Requirements', content: '<li>5+ years Go</li>' }],
    hostedUrl: 'https://jobs.lever.co/x/abc', createdAt: 1750000000000, workplaceType: 'remote'
  }]);
  ok('lever: parses a bare array', lever.length === 1 && lever[0].title === 'Backend Engineer');
  ok('lever: folds the requirement lists into the description',
    /Requirements/.test(lever[0].description) && /5\+ years Go/.test(lever[0].description), lever[0].description);
  ok('lever: reads the remote flag', lever[0].remote === true);
  ok('lever: converts an epoch timestamp', typeof lever[0].posted_at === 'string' && lever[0].posted_at.includes('20'));

  const ashby = boards.PROVIDERS.ashby.parse({ jobs: [{ id: 'a1', title: 'SRE', location: 'Austin, TX',
    descriptionHtml: '<p>On call.</p>', jobUrl: 'https://jobs.ashbyhq.com/x/a1', publishedAt: '2026-07-01T00:00:00Z', isRemote: false }] });
  ok('ashby: parses a posting', ashby.length === 1 && ashby[0].city === 'Austin');

  const wk = boards.PROVIDERS.workable.parse({ name: 'Acme', jobs: [{ shortcode: 'W1', title: 'QA Engineer',
    city: 'Pune', state: 'Maharashtra', country: 'India', description: '<p>Test.</p>', requirements: '<p>3+ years</p>',
    application_url: 'https://apply.workable.com/acme/j/W1', published_on: '2026-07-10', telecommuting: false }] });
  ok('workable: uses its structured location fields', wk[0].city === 'Pune' && wk[0].country === 'India');
  ok('workable: merges description and requirements', /Test\./.test(wk[0].description) && /3\+ years/.test(wk[0].description));
  ok('workable: picks up the account name as the company', wk[0].company_name === 'Acme');

  const sr = boards.PROVIDERS.smartrecruiters.parse({ content: [{ id: 's1', name: 'Data Engineer',
    location: { city: 'Chicago', region: 'IL', country: 'US', remote: false }, releasedDate: '2026-07-05' }] });
  ok('smartrecruiters: parses a posting', sr[0].title === 'Data Engineer' && sr[0].city === 'Chicago');

  const rec = boards.PROVIDERS.recruitee.parse({ offers: [{ id: 9, title: 'Designer', location: 'Berlin, Germany',
    description: '<p>Design.</p>', careers_url: 'https://x.recruitee.com/o/designer', published_at: '2026-07-02' }] });
  ok('recruitee: parses a posting', rec[0].title === 'Designer');

  // Robustness: a third-party feed WILL send something unexpected eventually.
  ok('a malformed payload yields nothing rather than throwing',
    boards.PROVIDERS.greenhouse.parse({ jobs: 'not an array' }).length === 0);
  ok('a null payload is handled', boards.PROVIDERS.lever.parse(null).length === 0);
  // One bad row must not cost the whole board.
  const mixed = boards.PROVIDERS.greenhouse.parse({ jobs: [ null, { title: '' }, { id: 3, title: 'Good One' } ] });
  ok('one broken posting does not discard the good ones', mixed.length === 1 && mixed[0].title === 'Good One');
  ok('every provider in the list is fetchable', boards.PROVIDER_IDS.every(id => typeof boards.getProvider(id).url('x') === 'string'));
  ok('the provider list never leaks endpoints to the browser',
    boards.providerList().every(p => !('url' in p) && !('parse' in p)));
}

// ── 2. locations ────────────────────────────────────────────────────────────
{
  const cases = [
    ['Dallas, TX', 'Dallas', 'TX', 'USA'],
    ['Remote - Austin, TX', 'Austin', 'TX', 'USA'],
    ['San Francisco, California, United States', 'San Francisco', 'CA', 'USA'],
    ['Hyderabad, Telangana, India', 'Hyderabad', 'TS', 'India'],
    ['Bangalore', 'Bangalore', 'KA', 'India'],
    ['US Remote', null, null, 'USA'],
    ['Remote (US)', null, null, 'USA'],
    ['Remote', null, null, null],
    ['Multiple Locations', null, null, null]
  ];
  for (const [text, city, state, country] of cases) {
    const r = parseLocation(text);
    ok(`location: "${text}"`, r.city === city && r.state === state && r.country === country, JSON.stringify(r));
  }
}

// ── 3. the staffing-firm filter ─────────────────────────────────────────────
// The owner wants end clients. Getting this wrong in the permissive direction
// costs one click; getting it wrong in the strict direction loses a customer
// silently — so the bias is deliberate and worth asserting.
{
  const agency = classifyCompany({ name: 'Thombara, LLC',
    description: 'Our client is seeking a Java developer. C2C welcome.', from_ats_board: true });
  ok('an agency posting "our client" is caught', agency.kind === 'staffing_firm', JSON.stringify(agency));

  ok('an obvious staffing name is caught',
    classifyCompany({ name: 'Apex IT Staffing Solutions Inc', description: 'Great role.', from_ats_board: true }).kind === 'staffing_firm');

  ok('a product company is not flagged',
    classifyCompany({ name: 'Stripe', description: 'Economic infrastructure for the internet.', from_ats_board: true }).kind === 'end_client');
  ok('a company with "Technologies" in the name is not flagged on that alone',
    classifyCompany({ name: 'Toyota Connected Technologies', description: 'Join our mobility team.', from_ats_board: true }).kind !== 'staffing_firm');
  ok('"Solutions" alone is not enough to condemn a company',
    classifyCompany({ name: 'Workforce Software Solutions', description: 'We build scheduling software.', from_ats_board: true }).kind !== 'staffing_firm');

  // Behavioural signal: many unrelated roles across many cities.
  const spread = [];
  const roles = ['Nurse','Welder','Java Developer','Accountant','Driver','Chef','Machinist','Analyst','Teacher','Plumber'];
  roles.forEach((t, i) => spread.push({ title: t, city: `City${i}`, location: `City${i}` }));
  const shaped = classifyCompany({ name: 'Generic Corp', description: '', postings: spread, from_ats_board: true });
  ok('a board of unrelated roles across many cities is flagged', shaped.kind === 'staffing_firm', JSON.stringify(shaped.why));

  // A real employer's board clusters — this must NOT trip the same rule.
  const focused = Array.from({ length: 12 }, (_, i) => ({ title: `Software Engineer ${i}`, city: 'Austin', location: 'Austin, TX' }));
  ok('a focused engineering board is not flagged',
    classifyCompany({ name: 'Acme Corp', description: '', postings: focused, from_ats_board: true }).kind !== 'staffing_firm');
  ok('too small a board makes no behavioural claim',
    classifyCompany({ name: 'Tiny Co', description: '', postings: [{ title: 'A', city: 'X' }], from_ats_board: true }).kind === 'end_client');
}

// ── 4. why the role exists ──────────────────────────────────────────────────
{
  const now = '2026-07-31T00:00:00Z';
  const aged = inferHiringReason({ title: 'Senior Java Developer', description: 'x', posted_at: '2026-05-18T00:00:00Z' },
    { now, repost_count: 2 });
  ok('an old, reposted role is called hard to fill', aged.category === 'hard_to_fill' && aged.confidence === 'high');
  ok('the outreach angle quotes the real numbers',
    /74 days/.test(aged.angle) && /reposted 2 times/.test(aged.angle), aged.angle);

  // The distinction that matters: appearing on many runs is NOT a repost.
  const stillOpen = inferHiringReason({ title: 'SRE', description: 'x', posted_at: '2026-05-18T00:00:00Z' },
    { now, seen_count: 40, repost_count: 0 });
  ok('a posting seen many times is not claimed to be reposted',
    !/repost/i.test(stillOpen.angle), stillOpen.angle);

  const team = inferHiringReason({ title: 'Java Developer', description: 'x', posted_at: now },
    { now, same_title_count: 4, company_open_roles: 12 });
  ok('several copies of one title reads as a team build', team.category === 'team_build');
  ok('the team-build angle states the count', /4 Java Developer openings/.test(team.angle), team.angle);

  const stated = inferHiringReason({ title: 'SRE', description: 'This is a backfill for a departing engineer.', posted_at: now }, { now });
  ok('a stated reason is believed over inference', stated.category === 'backfill' && stated.confidence === 'high');

  const growth = inferHiringReason({ title: 'Data Engineer', description: 'x', posted_at: now }, { now, company_open_roles: 24 });
  ok('many open roles reads as growth', growth.category === 'growth');

  const nothing = inferHiringReason({ title: 'Analyst', description: 'x', posted_at: now }, { now });
  ok('with no signal it says so rather than inventing one',
    nothing.category === 'unknown' && nothing.confidence === 'none', JSON.stringify(nothing.category));
  ok('even then the angle is usable', /Analyst/.test(nothing.angle));
  ok('a missing posting date does not throw', Boolean(inferHiringReason({ title: 'X' }, {}).angle));
}

// ── 5. contact inference ────────────────────────────────────────────────────
{
  ok('a domain is extracted from a URL', enrichment.normalizeDomain('https://www.acme.com/careers') === 'acme.com');
  ok('a domain is extracted from an email', enrichment.normalizeDomain('a@acme.co.uk') === 'acme.co.uk');
  ok('a company name is not mistaken for a domain', enrichment.normalizeDomain('Acme Corp') === null);

  ok('a single-word name yields no guess', enrichment.splitName('Madonna') === null);
  ok('a title is stripped from a name', JSON.stringify(enrichment.splitName('Dr. John Smith')) === '{"first":"john","last":"smith"}');

  const guesses = enrichment.inferEmails('Priya Raman', 'acme.com');
  ok('several patterns are offered', guesses.length >= 4);
  ok('the most common pattern ranks first', guesses[0].email === 'priya.raman@acme.com', guesses[0].email);
  ok('every guess is labelled as inferred', guesses.every(g => g.method === 'pattern_inference'));
  ok('no guess claims high confidence', guesses.every(g => g.confidence < 0.6));

  const known = enrichment.inferEmails('Priya Raman', 'acme.com', 'flast');
  ok('a known pattern collapses to one confident answer',
    known.length === 1 && known[0].email === 'praman@acme.com' && known[0].confidence > 0.8);

  ok('role mailboxes are offered for a company with no named contact',
    enrichment.roleMailboxes('acme.com').some(r => r.email === 'careers@acme.com'));
  ok('role mailboxes are labelled as such, not as a person',
    enrichment.roleMailboxes('acme.com').every(r => r.method === 'role_mailbox'));
}

// ── 6. the ingest loop, end to end ──────────────────────────────────────────
// A fake Supabase and a fake feed, so the whole path runs without a database or
// the network.
{
  function fakeDb() {
    const rows = { sourced_jobs_raw: [], lead_sources: [], companies: [], jobs: [] };
    const api = (table) => {
      const t = rows[table];
      const builder = {
        _filters: [], _payload: null, _mode: null,
        select() { return builder; },
        eq(col, val) { builder._filters.push([col, val]); return builder; },
        ilike(col, val) { builder._filters.push([col, String(val).replace(/%/g, '')]); return builder; },
        is() { return builder; },
        limit() { return builder; },
        order() { return builder; },
        _match(r) { return builder._filters.every(([c, v]) => (v == null ? true : String(r[c]) === String(v))); },
        maybeSingle() { return Promise.resolve({ data: t.filter(r => builder._match(r))[0] || null }); },
        single() { const d = builder._payload; t.push(d); return Promise.resolve({ data: d }); },
        insert(payload) {
          const arr = Array.isArray(payload) ? payload : [payload];
          arr.forEach(p => { p.id = p.id || `id-${t.length + 1}`; });
          builder._payload = arr[0];
          const p = Promise.resolve({ data: arr, error: null });
          p.select = () => ({ single: () => { t.push(...arr); return Promise.resolve({ data: arr[0], error: null }); } });
          arr.forEach(a => t.push(a));
          return p;
        },
        update(patch) {
          builder._payload = patch;
          const p = Promise.resolve({ data: null, error: null });
          p.eq = (c, v) => { t.filter(r => String(r[c]) === String(v)).forEach(r => Object.assign(r, patch)); return Promise.resolve({ data: null, error: null }); };
          return p;
        },
        then(res) { return Promise.resolve({ data: t.filter(r => builder._match(r)), error: null }).then(res); }
      };
      return builder;
    };
    return { rows, client: { from: api } };
  }

  const FEED = {
    jobs: [
      { id: 1, title: 'Senior Java Developer', location: { name: 'Dallas, TX' },
        content: 'Required: 7+ years of Java and Spring Boot.', absolute_url: 'u1', updated_at: '2026-05-18T00:00:00Z' },
      { id: 2, title: 'Senior Java Developer', location: { name: 'Plano, TX' },
        content: 'Required: 7+ years of Java.', absolute_url: 'u2', updated_at: '2026-07-01T00:00:00Z' },
      { id: 3, title: 'Product Designer', location: { name: 'Remote - US' },
        content: 'Design things.', absolute_url: 'u3', updated_at: '2026-07-20T00:00:00Z' }
    ]
  };
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => FEED });

  const db = fakeDb();
  const source = { id: 'src1', org_id: 'org1', provider: 'greenhouse', board_token: 'acme',
    company_name: 'Acme Corp', company_domain: null, filters: null, every_hours: 24 };

  const r1 = await ingest.ingestSource(source, { supabase: db.client, fetchImpl: fakeFetch });
  ok('the ingest finds every posting', r1.found === 3, JSON.stringify(r1));
  ok('new postings are staged', r1.staged === 3, JSON.stringify(r1));

  const staged = db.rows.sourced_jobs_raw;
  ok('nothing was written to jobs — approval is required first', db.rows.jobs.length === 0);
  ok('staged rows start as new', staged.every(s => s.status === 'new'));
  ok('the hiring reason is computed at ingest', staged.every(s => s.hiring_reason && s.hiring_reason.angle));
  ok('two identical titles are recognised as a team build',
    staged.some(s => s.hiring_reason.category === 'team_build'), staged.map(s => s.hiring_reason.category).join(','));
  ok('skills are parsed from the description',
    staged.some(s => s.parsed && (s.parsed.skills || []).some(k => /java/i.test(k))));
  ok('the company verdict is recorded on each row', staged.every(s => s.company_kind));

  // Re-running must not duplicate the queue — the whole point of content_hash.
  const r2 = await ingest.ingestSource(source, { supabase: db.client, fetchImpl: fakeFetch });
  ok('re-running stages nothing new', r2.staged === 0 && r2.updated === 3, JSON.stringify(r2));
  ok('the queue did not grow', db.rows.sourced_jobs_raw.length === 3);
  ok('seeing a posting again is counted', staged.every(s => s.seen_count === 2));
  ok('re-seeing is not miscounted as a repost', staged.every(s => (s.repost_count || 0) === 0));

  // A genuine relist: the feed's publish date moves forward.
  FEED.jobs[0].updated_at = '2026-07-25T00:00:00Z';
  await ingest.ingestSource(source, { supabase: db.client, fetchImpl: fakeFetch });
  const relisted = staged.find(s => s.city === 'Dallas');
  ok('a moved publish date counts as a repost', relisted.repost_count === 1, String(relisted.repost_count));

  // Filters.
  const db2 = fakeDb();
  const filtered = await ingest.ingestSource(
    Object.assign({}, source, { filters: { titles: ['java'] } }),
    { supabase: db2.client, fetchImpl: fakeFetch });
  ok('a title filter narrows what is staged', filtered.staged === 2 && filtered.filtered === 1, JSON.stringify(filtered));

  // A staffing firm's board is skipped wholesale.
  const db3 = fakeDb();
  const agencyFeed = { jobs: FEED.jobs.map(j => Object.assign({}, j, { content: 'Our client is seeking this role. C2C ok.' })) };
  const agencyResult = await ingest.ingestSource(
    Object.assign({}, source, { company_name: 'Apex Staffing Solutions Inc' }),
    { supabase: db3.client, fetchImpl: async () => ({ ok: true, status: 200, json: async () => agencyFeed }) });
  ok('a staffing firm\'s board is skipped entirely', agencyResult.staffing_skipped === 3 && agencyResult.staged === 0, JSON.stringify(agencyResult));
  ok('and nothing of theirs reaches the queue', db3.rows.sourced_jobs_raw.length === 0);

  // A dead board must not throw.
  const db4 = fakeDb();
  const dead = await ingest.ingestSource(source, {
    supabase: db4.client, fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  ok('a missing board reports an error rather than throwing', dead.errors === 1 && /check the board name/i.test(dead.error || ''), JSON.stringify(dead));

  ok('content hash ignores the description so an edit is not a new lead',
    ingest.contentHash({ company_name: 'A', title: 'B', city: 'C', state: 'D' })
    === ingest.contentHash({ company_name: 'A', title: 'B', city: 'C', state: 'D', description: 'changed' }));
  ok('content hash is case- and whitespace-insensitive',
    ingest.contentHash({ company_name: 'Acme  Corp', title: 'Java Dev' })
    === ingest.contentHash({ company_name: 'acme corp', title: 'java dev' }));
  ok('a different city is a different lead',
    ingest.contentHash({ company_name: 'A', title: 'B', city: 'Dallas' })
    !== ingest.contentHash({ company_name: 'A', title: 'B', city: 'Plano' }));
}

console.log('\n=== LEAD SOURCING SMOKE ===');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
}
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
