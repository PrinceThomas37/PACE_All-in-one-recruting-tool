// FOLLOW-UPS STOPPED 30 OCT – 2 NOV (R-352, owner 3 Nov 2026: "why are the follow ups paused"). The engine's check "did the
// first email really go out?" asked about ~1,000 contacts in one request; the request failed; the error was ignored; every
// follow-up was skipped as "no first email" (982 on 2 Nov). This pins the fix with a fake database that behaves like the real
// one: a request naming too many ids FAILS, and one request returns at most 1,000 rows.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const br = require('../services/batched-read.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// 2,500 sent first emails, one per contact
const ROWS = Array.from({ length: 2500 }, (_, i) => ({ contact_id: 'c' + i, job_id: 'j' + i, status: 'sent', followup_type: null }));
let requests = 0, maxIds = 0;
function fakeDb({ tooManyIds = 150, failAll = false } = {}) {
  return { from: () => {
    let ids = null, eqs = [];
    const q = {
      select() { return q; }, in(col, v) { ids = { col, v }; return q; }, eq(c, v) { eqs.push([c, v]); return q; }, is() { return q; }, order() { return q; },
      async range(a, b) {
        requests++;
        if (failAll) return { data: null, error: { message: 'canceling statement due to statement timeout' } };
        if (ids && ids.v.length > tooManyIds) return { data: null, error: { message: 'URI too long' } };   // the 30 Oct failure
        maxIds = Math.max(maxIds, ids ? ids.v.length : 0);
        let rows = ROWS.filter((r) => !ids || ids.v.includes(r[ids.col]));
        eqs.forEach(([c, v]) => { rows = rows.filter((r) => r[c] === v); });
        return { data: rows.slice(a, Math.min(b + 1, a + 1000)), error: null };
      },
    };
    return q;
  } };
}

const ids = ROWS.slice(0, 982).map((r) => r.contact_id);
const got = await br.readByIds(fakeDb(), 'emails', '*', 'contact_id', ids, (q) => q.eq('status', 'sent'));
step('all 982 first emails are found (the 2 Nov run found none)', got.length === 982, String(got.length));
step('no request names more than 100 ids', maxIds <= 100, String(maxIds));

// the old way, for the record: one request with every id → the database refuses
const old = await fakeDb().from('emails').select('*').in('contact_id', ids).range(0, 999);
step('(the fake is honest: one request with 982 ids fails, like the real one did)', !!old.error);

let threw = null;
try { await br.readByIds(fakeDb({ failAll: true }), 'emails', '*', 'contact_id', ids); } catch (e) { threw = e.message; }
step('a failed read THROWS — never an empty answer that means "nothing was sent"', /emails lookup failed/.test(threw || ''), threw);

const all = await br.readAllPages(() => fakeDb().from('follow_ups').select('*'));
step('a list longer than 1,000 is read to the end (2,500, not 1,000)', all.length === 2500, String(all.length));

// the engine uses it for every list lookup, reads the light research, and gives a failed day back
const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const eng = src.slice(src.indexOf('async function runFollowupEngine'), src.indexOf('async function setLastFollowupRun'));
step('the engine no longer asks emails with a raw .in(contact_id/job_id) list', !/from\('emails'\)[\s\S]{0,120}\.in\('(contact_id|job_id)', (dueContactIds|fuJobIds)\)/.test(eng));
step('…its three emails lookups go through readByIds', (eng.match(/readByIds\('emails'/g) || []).length === 3);
step('…the waiting list is read page by page, without the posting text', /readAllPages\(\(\) => supabase\.from\('follow_ups'\)/.test(eng) && /research:research_list/.test(eng));
step('a run that failed gives the day back (it retries at the next tick)', /if \(out && out\.error\) \{ await setLastFollowupRun\(/.test(src));

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
