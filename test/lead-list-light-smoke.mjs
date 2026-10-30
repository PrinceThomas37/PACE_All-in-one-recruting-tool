// R-348 (30 Oct) — sign-in took 2+ minutes: GET /jobs (2,751 leads) pulled 12 MB of posting text it then threw away, six pages
// at once, and a page the database cut off failed the whole list. Pins: the light select, its numbers = the old rule, a busy page
// is read again, a missing column falls back to the old read, and the list's column list covers every lead column.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const lp = require('../services/lead-posting.js');
const { loadLeadList } = require('../services/lead-list.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

// ── the numbers from the database give the same answer as the old rule ──
const long = 'Title: Nurse\n\n' + 'word '.repeat(120);
for (const [name, jd, pos] of [['a long posting', long, 'Nurse'], ['title only', 'Title: Nurse', 'Nurse'], ['no posting at all', null, 'Nurse'], ['no position either', null, '']]) {
  const old = lp.forList({ id: 'x', position: pos, research: jd == null ? { requirements: {} } : { jd_raw: jd, requirements: {} } });
  const raw = String(jd == null ? '' : jd).trim();
  const body = raw.replace(/^Title:[^\n]*\n*/i, '').trim();
  const light = lp.forList({ id: 'x', position: pos, research: { requirements: {} }, posting_all_chars: raw.length, posting_chars: body.length, posting_words: body ? body.split(/\s+/).length : 0 });
  step(`${name}: the light row says the same about the posting`, JSON.stringify(light.posting) === JSON.stringify(old.posting), JSON.stringify([light.posting, old.posting]));
  step(`${name}: the helper numbers are not passed on, the "omitted" mark matches`, !('posting_chars' in light) && !!(light.research && light.research.jd_raw_omitted) === !!(old.research && old.research.jd_raw_omitted));
}

// ── the reader ──
function fake({ failFirst = 0, failCode = '57014', missing = false } = {}) {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: 'L' + String(i).padStart(3, '0'), org_id: 'o', deleted_at: null, created_at: String(1000 - i), research: {} }));
  const stats = { reads: 0, selects: [] };
  let fails = failFirst;
  return { stats, supabase: { from: () => { let sel = '', rng = null; const api = {
    select(s) { sel = s; stats.selects.push(s); return api; }, is() { return api; }, eq() { return api; }, order() { return api; }, range(a, b) { rng = [a, b]; return api; },
    then(res, rej) { stats.reads++;
      if (missing && sel === 'LIGHT') return Promise.resolve({ data: null, error: { code: '42703', message: 'column jobs.research_list does not exist' } }).then(res, rej);
      if (fails > 0) { fails--; return Promise.resolve({ data: null, error: { code: failCode, message: failCode === '57014' ? 'canceling statement due to statement timeout' : 'permission denied' } }).then(res, rej); }
      return Promise.resolve({ data: rows.slice(rng[0], rng[1] + 1), error: null, count: rows.length }).then(res, rej); } }; return api; } } };
}
const nowait = async () => {};
let f = fake({ failFirst: 2 });
let got = await loadLeadList({ supabase: f.supabase, select: 'LIGHT', orgId: 'o', pageSize: 10, wait: nowait });
step('a page the busy database cut off is read again — the list still arrives whole', got.length === 30 && f.stats.reads === 6, JSON.stringify(f.stats.reads));
f = fake({ failFirst: 5 });
let threw = null; try { await loadLeadList({ supabase: f.supabase, select: 'LIGHT', orgId: 'o', pageSize: 10, wait: nowait }); } catch (e) { threw = e; }
step('…but not for ever: after three tries the failure is reported', threw && threw.code === '57014');
f = fake({ failFirst: 1, failCode: '42501' });
threw = null; try { await loadLeadList({ supabase: f.supabase, select: 'LIGHT', orgId: 'o', pageSize: 10, wait: nowait }); } catch (e) { threw = e; }
step('a refusal that is not "busy" is not retried', threw && f.stats.reads === 1);
f = fake({ missing: true });
got = await loadLeadList({ supabase: f.supabase, select: 'LIGHT', fallbackSelect: 'FULL', orgId: 'o', pageSize: 10, wait: nowait });
step('light columns missing (migration 070 not applied) → the old read, nothing breaks', got.length === 30 && f.stats.selects.includes('FULL'));

// ── wiring: the list select names every lead column except the posting text ──
const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const cols = (idx.match(/const JOB_LIST_COLUMNS = '([^']+)'/) || [])[1] || '';
const list = new Set(cols.split(','));
const mig = readFileSync(new URL('../migrations/070_lead_list_light.sql', import.meta.url), 'utf8');
step('the lead list reads the light research, not the full one', /research:research_list/.test(idx) && !list.has('research'));
step('…and the posting numbers', ['posting_all_chars', 'posting_chars', 'posting_words'].every((c) => mig.includes(c) && idx.includes(c)));
// Every column a migration ever added to jobs must be in the list (or be one of the 070 helpers / research itself).
const added = new Set();
for (const m of readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').matchAll(/alter\s+table\s+(?:public\.)?jobs\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) added.add(m[1].toLowerCase());
const { readdirSync } = await import('node:fs');
for (const fn of readdirSync(new URL('../migrations/', import.meta.url))) {
  for (const m of readFileSync(new URL('../migrations/' + fn, import.meta.url), 'utf8').matchAll(/alter\s+table\s+(?:public\.)?jobs\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) added.add(m[1].toLowerCase());
}
const skip = new Set(['research', 'research_list', 'posting_all_chars', 'posting_chars', 'posting_words']);
const missingCols = [...added].filter((c) => !skip.has(c) && !list.has(c));
step('every column ever added to leads is in the list read', missingCols.length === 0, missingCols.join(','));
step('the list keeps the same people/company/contacts as the one-lead read', /JOB_SELECT\.slice\(JOB_SELECT\.indexOf\(', company:'\)\)/.test(idx));

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
