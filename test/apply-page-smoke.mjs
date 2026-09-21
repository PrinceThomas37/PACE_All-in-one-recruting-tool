// THE PUBLIC APPLY PAGE — routes/apply.js
//
// This is the second unauthenticated surface in the product and the first one
// that WRITES. Everything pinned here is something that is either silent when
// it breaks, or unrecoverable once it has broken:
//
//  1. THE TOKEN IS THE SECRET. It is what stops a stranger enumerating every
//     role a customer is working. Unknown, malformed, unpublished and closed
//     must be indistinguishable — and a malformed one must not even reach the
//     database, or the page becomes a free way to make us do work.
//  2. THE CLIENT'S NAME IS NEVER PUBLISHED. A staffing desk's client list is
//     the thing it is paid for. This is asserted on the rendered bytes,
//     because a comment saying "we don't show it" is not a guarantee.
//  3. A WRITE THAT DID NOT HAPPEN IS NEVER REPORTED AS SAVED. An applicant who
//     is thanked for an application we dropped does not apply twice.
//  4. AN APPLICANT NEVER LANDS IN `candidates`. They land in the inert staging
//     table, like every other source. A public form writing into the ATS would
//     be a spam vector aimed at the most valuable table in the product.
//
// Usage: node test/apply-page-smoke.mjs   (needs express, no browser)

import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const express = require('express');
const scrub = require('../services/jd-scrub.js');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const LIVE = 'a1b2c3d4e5f60718a1b2c3d4e5f60718';       // published + active
const OFFLINE = 'b1b2c3d4e5f60718a1b2c3d4e5f60718';    // token exists, not published
const CLOSED = 'c1b2c3d4e5f60718a1b2c3d4e5f60718';     // published but filled
const POSTED = 'd1b2c3d4e5f60718a1b2c3d4e5f60718';     // has a human-written posting JD

const CLIENT_NAME = 'Northwind Construction LLC';

const JOBS = {
  [LIVE]: {
    id: 'jo-1', org_id: ORG, job_code: 'JO-0041', job_title: 'HVAC Service Technician',
    client: CLIENT_NAME, end_client: CLIENT_NAME,
    city: 'New Britain', state: 'CT', remote: 'No', job_type: 'Full-time',
    // Hostile on purpose: this field is customer-entered and the page is public.
    job_description: 'Great role <script>alert(1)</script> at ' + CLIENT_NAME + '.',
    primary_skills: 'HVAC, EPA', exp_min: '3', exp_max: '8',
    status: 'Active', apply_enabled: true, apply_token: LIVE, apply_count: 4,
  },
  [OFFLINE]: {
    id: 'jo-2', org_id: ORG, job_title: 'Estimator', status: 'Active',
    apply_enabled: false, apply_token: OFFLINE, apply_count: 0,
  },
  [POSTED]: {
    id: 'jo-4', org_id: ORG, job_title: 'Project Manager', client: CLIENT_NAME,
    job_description: 'Internal notes naming ' + CLIENT_NAME + ' and bob@northwind.com.',
    posting_description: 'Our client is hiring a Project Manager. Five years commercial.',
    status: 'Active', apply_enabled: true, apply_token: POSTED, apply_count: 0,
  },
  [CLOSED]: {
    id: 'jo-3', org_id: OTHER_ORG, job_title: 'Superintendent', status: 'Filled',
    apply_enabled: true, apply_token: CLOSED, apply_count: 0,
  },
};

let queries = 0;          // every table read/write goes through here
let inserted = [];        // rows written to sourcing_candidates
let candidateWrites = 0;  // MUST stay zero — rule 4
let insertShouldFail = false;
let uploads = [];

function fakeSupabase() {
  function builder(table) {
    const f = {};
    let pending = null;
    const chain = {
      select: () => chain,
      eq: (c, v) => { f[c] = v; return chain; },
      ilike: (c, v) => { f[c] = String(v).toLowerCase(); return chain; },
      is: () => chain,
      limit: () => chain,
      update: (vals) => { queries++; if (table === 'candidates') candidateWrites++; pending = { op: 'update', vals }; return chain; },
      insert: (row) => {
        queries++;
        if (table === 'candidates') candidateWrites++;
        pending = { op: 'insert', row };
        return chain;
      },
      maybeSingle: async () => {
        queries++;
        if (pending && pending.op === 'insert') {
          if (insertShouldFail) return { data: null, error: { message: 'boom' } };
          inserted.push(pending.row); return { data: { id: 'sc-1' }, error: null };
        }
        if (table === 'job_orders') return { data: JOBS[f.apply_token] || null, error: null };
        if (table === 'organizations') return { data: { name: 'Fute Global' }, error: null };
        if (table === 'candidates') return { data: null, error: null };
        return { data: null, error: null };
      },
      single: async () => chain.maybeSingle(),
      then: (res) => chain.maybeSingle().then(res),
    };
    return chain;
  }
  return {
    from: builder,
    storage: {
      from: () => ({
        upload: async (path, buf) => { uploads.push({ path, bytes: buf.length }); return { data: { path }, error: null }; },
      }),
    },
  };
}

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(require('../routes/apply.js')({ supabase: fakeSupabase(), applyLimiter: null }));
const server = http.createServer(app);
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const get = (p) => fetch(base + p);
const post = (p, b) => fetch(base + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
});

// A tiny text "resume" — real enough for the parser, small enough to be fast.
const resumeB64 = Buffer.from(
  'Jane Doe\njane@example.com\n555-0100\nHVAC Service Technician at Acme\n11 years experience\nSkills: HVAC, EPA, boilers\n'
).toString('base64');

// ════════════════════════════════════════════════════════════════════════════
// 1. The token is the secret
// ════════════════════════════════════════════════════════════════════════════
{
  queries = 0;
  const bad = await get('/apply/not-a-token');
  ok('a malformed token → 404', bad.status === 404, 'got ' + bad.status);
  ok('a malformed token never reaches the database', queries === 0, 'queries=' + queries);

  const unknown = await get('/apply/' + 'f'.repeat(32));
  const offline = await get('/apply/' + OFFLINE);
  const closed = await get('/apply/' + CLOSED);
  ok('an unknown token → 404', unknown.status === 404, 'got ' + unknown.status);
  ok('an UNPUBLISHED job → 404', offline.status === 404, 'got ' + offline.status);
  ok('a FILLED job → 404', closed.status === 404, 'got ' + closed.status);

  const [a, b, c] = await Promise.all([unknown.text(), offline.text(), closed.text()]);
  // Identical bytes, so a scanner learns nothing from the difference between
  // "wrong", "never published" and "already filled".
  ok('unknown / unpublished / filled are byte-identical', a === b && b === c);
  ok('...and none of them names the job', !/Estimator|Superintendent/.test(a + b + c));
}

// ════════════════════════════════════════════════════════════════════════════
// 2. The published page
// ════════════════════════════════════════════════════════════════════════════
{
  const r = await get('/apply/' + LIVE);
  const html = await r.text();
  ok('a published, active job renders', r.status === 200, 'got ' + r.status);
  ok('the job title is on the page', html.includes('HVAC Service Technician'));
  ok('the location is on the page', html.includes('New Britain, CT'));
  ok('the ORG is named as the employer', html.includes('Fute Global'));

  // RULE 2 — the one that costs a client relationship.
  ok("the CLIENT's name is never on the public page", !html.includes(CLIENT_NAME), 'leaked the client');

  // The description is customer-entered and this page is public.
  ok('a <script> in the job description is escaped, not rendered',
    !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));

  ok('the form posts to this token', html.includes('/apply/' + LIVE));
  ok('inputs are 16px so iOS does not zoom on focus', /font-size:16px/.test(html));
  ok('the consent line is present', /keep your details on file/i.test(html));

  // The scrubber ran: the name is replaced rather than merely dropped, so the
  // sentence still reads.
  ok('the client is replaced with "our client"', /our client/i.test(html));
}

// ════════════════════════════════════════════════════════════════════════════
// 2b. A human-written posting description wins over the internal one
// ════════════════════════════════════════════════════════════════════════════
{
  const html = await (await get('/apply/' + POSTED)).text();
  ok('posting_description is used when present', html.includes('Five years commercial'));
  ok('...and the internal JD is not published', !/Internal notes/.test(html));
  ok('...and neither is the client it names', !html.includes(CLIENT_NAME));
  ok('...nor an email address out of it', !/bob@northwind\.com/.test(html));
}

// ════════════════════════════════════════════════════════════════════════════
// 2c. The shared scrubber (services/jd-scrub.js)
//
// Shared with the recruiter's "re-write job description" button. Every case
// below came off a real rendered page — none of them is hypothetical.
// ════════════════════════════════════════════════════════════════════════════
{
  const S = (jd, names) => scrub.scrubJobDescription(jd, names || ['Northwind Construction LLC']);

  ok('the client name is replaced, not deleted', S('Northwind Construction LLC is hiring.') === 'Our client is hiring.',
    S('Northwind Construction LLC is hiring.'));
  ok('a bare name without its suffix is caught too', /our client/i.test(S('Come work at Northwind today.')));
  ok('a replacement at the start of a sentence is capitalised',
    /^Our client/.test(S('Northwind Construction LLC is hiring.')));
  ok('mid-sentence it stays lower case',
    /join our client in/.test(S('Come join Northwind Construction LLC in Hartford.')),
    S('Come join Northwind Construction LLC in Hartford.'));

  // THE ONE A SCREENSHOT CAUGHT. Removing just the address leaves a sentence
  // that reads as a broken page.
  const q = S('Questions? Email careers@northwind.com or call 860-555-0142.');
  ok('a gutted contact sentence is removed whole, not left dangling', q === '', JSON.stringify(q));
  ok('...so no orphan punctuation survives', !/\s\.|Email or call/.test(q), JSON.stringify(q));

  // An email and a URL both contain full stops. Splitting into sentences
  // before masking chops them in half and publishes the halves.
  const u = S('Apply at www.northwind.com/jobs today.');
  ok('a URL does not survive the sentence split in pieces', !/northwind|www\.|com\//i.test(u), JSON.stringify(u));
  const e = S('Send your resume to bob@northwind.com now.');
  ok('an email does not survive in pieces', !/northwind|@/.test(e), JSON.stringify(e));

  // A bullet is one thought.
  const b = S('What you get:\n- Company van\n- Email hr@northwind.com to ask\n- Paid training');
  ok('a bullet carrying contact details is dropped whole',
    !/hr@|northwind/i.test(b) && /Company van/.test(b) && /Paid training/.test(b), JSON.stringify(b));
  ok('...and the other bullets keep their shape', (b.match(/^- /gm) || []).length === 2, JSON.stringify(b));

  // Capitalising must not shout at acronyms or ordinary words.
  ok('acronyms are untouched', /EPA and OSHA/.test(S('We use EPA and OSHA standards.')));
  ok('mid-sentence words are not capitalised', S('We fix boilers and units.') === 'We fix boilers and units.',
    S('We fix boilers and units.'));

  // THE ORDERING BUG. A client's name is usually also its mail domain, so
  // scrubbing names BEFORE masking contacts rewrites careers@northwind.com
  // into "careers@our client.com" — which no longer matches the contact
  // pattern, so the address stays on the page looking scrubbed.
  const ord = S('Questions? Email careers@northwind.com or call us.');
  ok('a client-domain email is removed, not half-rewritten',
    !/@|northwind|\.com/i.test(ord), JSON.stringify(ord));
  const ord2 = S('See www.northwind.com/careers for more.');
  ok('a client-domain URL is removed, not half-rewritten',
    !/www|northwind|\.com/i.test(ord2), JSON.stringify(ord2));

  ok('a generic first word is NOT scrubbed (it would shred the text)',
    /precision welding/i.test(scrub.scrubJobDescription('Precision welding required.', ['Precision Systems Inc'])),
    scrub.scrubJobDescription('Precision welding required.', ['Precision Systems Inc']));
  ok('a distinctive first word IS scrubbed',
    /our client/i.test(S('Come work at Northwind today.')));

  ok('empty input is safe', S('') === '' && S(null) === '');
  ok('a name under 3 characters is ignored rather than shredding the text',
    scrub.scrubJobDescription('We fix AC units at scale.', ['AC']) === 'We fix AC units at scale.');
  ok('clientNames gathers every alias',
    JSON.stringify(scrub.clientNames({ client: 'A', end_client: 'B', company: { name: 'C' } })) === '["A","B","C"]');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Applying
// ════════════════════════════════════════════════════════════════════════════
{
  inserted = []; candidateWrites = 0; uploads = [];
  const r = await post('/apply/' + LIVE, {
    full_name: 'Jane Doe', email: 'Jane@Example.com', phone: '555-0100',
    location: 'New Britain, CT', note: 'Available immediately',
    filename: 'jane.txt', content_type: 'text/plain', data_base64: resumeB64,
  });
  const body = await r.json();
  ok('a complete application is accepted', r.status === 201 && body.received === true, JSON.stringify(body).slice(0, 160));
  ok('the applicant is told it landed', /have your application/i.test(body.html || ''));

  const row = inserted[0] || {};
  ok('exactly one staging row was written', inserted.length === 1, 'wrote ' + inserted.length);
  ok("it is tagged provider='apply'", row.provider === 'apply', row.provider);
  ok('it carries the JOB ORDER\'s org, not a default', row.org_id === ORG, row.org_id);
  ok('it is inert (status=new)', row.status === 'new', row.status);
  ok('the email is normalised to lower case', row.email === 'jane@example.com', row.email);
  ok('the job applied to is recorded', row.raw && row.raw.applied_to_job_order_id === 'jo-1');
  ok('the note survives', row.raw && /Available immediately/.test(row.raw.note || ''));
  ok('the resume is stored and referenced', uploads.length === 1 && row.resume_url === uploads[0].path);
  ok('the resume path is namespaced by token', /^apply\//.test(row.resume_url || ''));

  // RULE 4 — the whole reason staging exists.
  ok('NOTHING was written to `candidates`', candidateWrites === 0, 'writes=' + candidateWrites);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Refusals — each one says which, and none of them is silent
// ════════════════════════════════════════════════════════════════════════════
{
  const cases = [
    ['no name', { email: 'a@b.co', data_base64: resumeB64, filename: 'r.txt' }, 400],
    ['a bad email', { full_name: 'X', email: 'not-an-email', data_base64: resumeB64, filename: 'r.txt' }, 400],
    ['no resume', { full_name: 'X', email: 'a@b.co' }, 400],
  ];
  for (const [label, payload, want] of cases) {
    const r = await post('/apply/' + LIVE, payload);
    const j = await r.json().catch(() => ({}));
    ok(`${label} → ${want}`, r.status === want, 'got ' + r.status);
    ok(`...and says why (${label})`, !!(j.error && j.error.length > 8), j.error || '');
  }

  // Over the cap. 3MB of base64 is ~4MB on the wire, still under express's 5MB
  // limit — so this really does reach the handler rather than being bounced by
  // the body parser, which is the case worth testing.
  const big = Buffer.alloc(3 * 1024 * 1024 + 2048, 0x41).toString('base64');
  const r = await post('/apply/' + LIVE, {
    full_name: 'X', email: 'a@b.co', filename: 'big.txt', data_base64: big,
  });
  ok('an oversized resume → 413', r.status === 413, 'got ' + r.status);
  ok('...and names the size', /3 MB/.test(JSON.stringify(await r.json())));

  // Applying to an unpublished job must fail the same way as a bad token.
  const off = await post('/apply/' + OFFLINE, {
    full_name: 'X', email: 'a@b.co', filename: 'r.txt', data_base64: resumeB64,
  });
  ok('applying to an UNPUBLISHED job → 404', off.status === 404, 'got ' + off.status);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. RULE 3 — a failed write is never reported as saved
// ════════════════════════════════════════════════════════════════════════════
{
  insertShouldFail = true;
  inserted = [];
  const r = await post('/apply/' + LIVE, {
    full_name: 'Jane Doe', email: 'jane@example.com',
    filename: 'jane.txt', data_base64: resumeB64,
  });
  const j = await r.json();
  ok('a failed insert is NOT reported as received', j.received !== true, JSON.stringify(j).slice(0, 120));
  ok('...and the applicant is given an honest sentence', /could not save/i.test(j.error || ''));
  ok('...and no success page is returned', !j.html);
  insertShouldFail = false;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. The rate limiter is actually consulted
// ════════════════════════════════════════════════════════════════════════════
{
  let consulted = 0;
  const limited = express();
  limited.use(express.json());
  limited.use(require('../routes/apply.js')({
    supabase: fakeSupabase(),
    applyLimiter: { consume: () => { consulted++; return { allowed: false }; } },
  }));
  const s2 = http.createServer(limited);
  await new Promise(r => s2.listen(0, r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;

  const g = await fetch(b2 + '/apply/' + LIVE);
  ok('the page honours the limiter (429)', g.status === 429, 'got ' + g.status);
  const p = await fetch(b2 + '/apply/' + LIVE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'X', email: 'a@b.co', filename: 'r.txt', data_base64: resumeB64 }),
  });
  ok('the POST honours the limiter (429)', p.status === 429, 'got ' + p.status);
  ok('both routes consulted it', consulted === 2, 'consulted=' + consulted);
  s2.close();
}

server.close();

// ── report ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail && !r.ok ? '  — ' + r.detail : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
