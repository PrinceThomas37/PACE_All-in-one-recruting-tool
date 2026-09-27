// R-032 (Session 33) — leftover resume files. The owner said "Delete them".
// A deletion job over people's resumes must be proven to delete ONLY what it
// should, so each of its three guards is exercised on its own, and the I/O
// runner is driven against a fake bucket and database — including the case
// that matters most: a failed read must delete NOTHING.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const S = require('../services/storage-orphans.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const NOW = Date.parse('2026-09-27T12:00:00Z');
const ago = (d) => new Date(NOW - d * 864e5).toISOString();
const C_GONE = '11111111-1111-1111-1111-111111111111', C_LIVE = '22222222-2222-2222-2222-222222222222';
const CO_GONE = '33333333-3333-3333-3333-333333333333', CO_LIVE = '44444444-4444-4444-4444-444444444444';

// ── the shapes PACE writes ──
step('a candidate upload is recognised', S.classify(`${C_GONE}/1700-Jane_Resume.pdf`).kind === 'candidate');
step('a client document is recognised', S.classify(`client/${CO_GONE}/1700-MSA.pdf`).kind === 'client');
step('an apply-page resume is recognised', S.classify('apply/tok123/1700-cv.pdf').kind === 'apply');
step('a shape PACE never writes is not claimed', S.classify('misc/readme.txt') === null && S.classify('toplevel.pdf') === null);

// ── the three guards, each on its own ──
const live = { candidates: new Set([C_LIVE]), companies: new Set([CO_LIVE]), applyTokens: new Set(['tokLIVE']) };
const pick = (objects, refs = []) => S.pickOrphans({ objects, refs, live, now: NOW });
let r = pick([{ name: `${C_GONE}/1-a.pdf`, created_at: ago(10) }]);
step('owner gone + unreferenced + old → deleted', r.remove.length === 1);
r = pick([{ name: `${C_GONE}/1-a.pdf`, created_at: ago(10) }], [`${C_GONE}/1-a.pdf`]);
step('guard 1: a file some record names is kept', r.remove.length === 0 && r.keep[0].why === 'referenced');
r = pick([{ name: `apply/tokX/1-a.pdf`, created_at: ago(10) }], ['{"resume_url":"apply/tokX/1-a.pdf"}']);
step('guard 1: a path inside a JSON blob (an applicant row) counts as a reference', r.remove.length === 0);
r = pick([{ name: `${C_LIVE}/1-a.pdf`, created_at: ago(10) }]);
step('guard 2: an unreferenced file under a candidate who still exists is kept', r.remove.length === 0 && r.keep[0].why === 'owner_exists');
r = pick([{ name: `client/${CO_LIVE}/1-a.pdf`, created_at: ago(10) }, { name: 'apply/tokLIVE/1-a.pdf', created_at: ago(10) }]);
step('guard 2: same for a live client and a live published job', r.remove.length === 0);
r = pick([{ name: `${C_GONE}/1-a.pdf`, created_at: ago(0.5) }]);
step('guard 3: a file under a day old is kept (its record may still be being written)', r.remove.length === 0 && r.keep[0].why === 'too_new');
r = pick([{ name: `${C_GONE}/1-a.pdf`, created_at: 'garbage' }]);
step('guard 3: an unreadable date is kept, never assumed old', r.remove.length === 0);
r = S.pickOrphans({ objects: [{ name: `${C_GONE}/1-a.pdf`, created_at: ago(10) }], refs: [], live: { companies: new Set(), applyTokens: new Set() }, now: NOW });
step('a missing liveness set keeps the file (never reads as "owner gone")', r.remove.length === 0);

// ── the runner, against a fake bucket + database ──
function fakeStorage(files, { listError = false, removeError = false } = {}) {
  const removed = [];
  const tree = {};
  files.forEach(f => {
    const parts = f.name.split('/');
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/'), isFile = i === parts.length - 1;
      tree[dir] = tree[dir] || new Map();
      if (!tree[dir].has(parts[i])) tree[dir].set(parts[i], isFile ? { name: parts[i], id: 'x', created_at: f.created_at, metadata: { size: f.size || 100 } } : { name: parts[i], id: null });
    }
  });
  return { removed, from: () => ({
    list: async (prefix, { limit, offset }) => listError ? { data: null, error: { message: 'boom' } }
      : { data: [...(tree[prefix] || new Map()).values()].slice(offset, offset + limit), error: null },
    remove: async (names) => removeError ? { error: { message: 'nope' } } : (removed.push(...names), { error: null }),
  }) };
}
function fakeDb(tables, { failTable } = {}) {
  return { crossOrg: (t) => {
    const q = { _from: 0, _to: 999 };
    q.select = () => q; q.order = () => q;
    q.range = (a, b) => { q._from = a; q._to = b; return q; };
    q.then = (res, rej) => Promise.resolve(t === failTable ? { data: null, error: { message: 'timeout' } }
      : { data: (tables[t] || []).slice(q._from, q._to + 1), error: null }).then(res, rej);
    return q;
  } };
}
const FILES = [
  { name: `${C_GONE}/1-Jane_Resume.pdf`, created_at: ago(20), size: 1000 },
  { name: `${C_GONE}/2-Jane_CV.docx`, created_at: ago(20), size: 500 },
  { name: `${C_LIVE}/3-Live_Resume.pdf`, created_at: ago(3) },
  { name: 'apply/deadtok/4-cv.pdf', created_at: ago(5), size: 200 },
  { name: 'apply/livetok/5-cv.pdf', created_at: ago(5) },
];
// 1,200 unrelated candidates, so the live one sits PAST the first page of 1,000 —
// a runner that read only one page would think the live candidate was gone.
const many = Array.from({ length: 1200 }, (_, i) => ({ id: `99999999-0000-0000-0000-${String(i).padStart(12, '0')}` }));
const TABLES = {
  candidate_documents: [{ id: 1, storage_path: `${C_LIVE}/3-Live_Resume.pdf` }],
  client_documents: [], sourcing_candidates: [{ id: 1, resume_url: 'apply/livetok/5-cv.pdf', raw: {} }],
  candidates: many.concat([{ id: C_LIVE, resume_url: null, profile_url: null }]),
  companies: [], job_orders: [{ id: 1, apply_token: 'livetok' }],
};
// The live candidate's own document record is removed here on purpose, so the
// ONLY thing protecting that file is the paged read of `candidates`.
const tablesNoDocRef = { ...TABLES, candidate_documents: [] };

let st = fakeStorage(FILES);
let out = await S.purgeStorageOrphans({ db: fakeDb(tablesNoDocRef), storage: st, now: NOW, dryRun: true });
step('dry run: finds the 3 leftovers and deletes nothing', out.orphans === 3 && out.deleted === 0 && st.removed.length === 0, JSON.stringify(out));
step('the live candidate past row 1,000 is found by the paged read (its file is kept)', out.kept.owner_exists === 1, JSON.stringify(out.kept));

st = fakeStorage(FILES);
out = await S.purgeStorageOrphans({ db: fakeDb(TABLES), storage: st, now: NOW });
step('real run: deletes exactly the three leftovers', out.deleted === 3 && st.removed.length === 3
  && st.removed.every(n => n.startsWith(C_GONE) || n.startsWith('apply/deadtok')), JSON.stringify(st.removed));
step('the result carries counts and bytes, never a file name', !/Jane|Resume|cv\.pdf/.test(JSON.stringify(out)) && out.bytes === 1700, JSON.stringify(out));

st = fakeStorage(FILES);
let threw = null;
try { await S.purgeStorageOrphans({ db: fakeDb(TABLES, { failTable: 'candidate_documents' }), storage: st, now: NOW }); } catch (e) { threw = e; }
step('a failed reference read STOPS the run and deletes nothing', threw && st.removed.length === 0, String(threw && threw.message));
st = fakeStorage(FILES);
threw = null;
try { await S.purgeStorageOrphans({ db: fakeDb(TABLES, { failTable: 'candidates' }), storage: st, now: NOW }); } catch (e) { threw = e; }
step('a failed liveness read STOPS the run and deletes nothing', threw && st.removed.length === 0);
st = fakeStorage(FILES, { listError: true });
threw = null;
try { await S.purgeStorageOrphans({ db: fakeDb(TABLES), storage: st, now: NOW }); } catch (e) { threw = e; }
step('a failed bucket listing STOPS the run', threw && st.removed.length === 0);
st = fakeStorage(FILES, { removeError: true });
threw = null;
try { await S.purgeStorageOrphans({ db: fakeDb(TABLES), storage: st, now: NOW }); } catch (e) { threw = e; }
step('a failed delete throws (so the job is not marked done)', !!threw);

// ── the wiring: one-time, and the done-marker holds counts only ──
const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const wiring = idx.slice(idx.indexOf("engineRunner.register('storage_orphan_cleanup'"), idx.indexOf("engineRunner.register('candidate_outreach_drip'"));
step('the job is registered', wiring.includes('purgeStorageOrphans'));
step('it skips once its done-marker exists (one-time)', /if \(done\) return \{ skipped: 'already_done' \}/.test(wiring));
step('the marker is written only AFTER the purge returns', wiring.indexOf('purgeStorageOrphans') < wiring.indexOf('.upsert('));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
