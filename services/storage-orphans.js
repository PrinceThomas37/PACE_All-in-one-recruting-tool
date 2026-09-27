// ============================================================================
// LEFTOVER FILES IN THE `candidate-docs` BUCKET (R-032, Session 33).
// ----------------------------------------------------------------------------
// The 23 Sep production reset deleted candidate and document RECORDS with SQL,
// which never touches storage — so 38 resumes (real people's names, contact
// details and work history) stayed in the private bucket with nothing pointing
// at them. The owner said "Delete them". SQL cannot do it (storage.objects has
// a `protect_delete` trigger, rightly: a row delete would orphan the bytes),
// so it has to be the Storage API with the server's key — i.e. on the server.
//
// PACE writes to this bucket in exactly three shapes, and each has a record
// that points back at the file:
//   <candidate_id>/<ts>-<name>        candidate_documents.storage_path
//                                     (+ candidates.resume_url when copied)
//   client/<company_id>/<ts>-<name>   client_documents.storage_path
//   apply/<apply_token>/<ts>-<name>   sourcing_candidates.resume_url
//                                     (+ candidates.resume_url once imported)
//
// A FILE IS DELETED ONLY WHEN ALL THREE ARE TRUE — each is an independent
// guard, so one bad read cannot turn into deleting a live person's resume:
//   1. no record anywhere names its path;
//   2. the thing it was filed under (candidate / company / published job) no
//      longer exists AT ALL — a soft-deleted record still counts as existing;
//   3. it is older than MIN_AGE_DAYS, so an upload whose record is still
//      being written can never be caught mid-flight.
// Anything of a shape PACE does not write is KEPT: we only delete what we can
// explain.
//
// `pickOrphans` is PURE (no db, no clock); `purgeStorageOrphans` does the I/O.
// ============================================================================
'use strict';

const BUCKET = 'candidate-docs';
const MIN_AGE_DAYS = 1;
const DAY = 86400000;
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which record a stored path belongs to, or null when PACE never writes that shape. */
function classify(name) {
  const parts = String(name || '').split('/');
  if (parts.length === 2 && UUIDISH.test(parts[0]) && parts[1]) return { kind: 'candidate', owner: parts[0] };
  if (parts.length === 3 && parts[0] === 'client' && UUIDISH.test(parts[1]) && parts[2]) return { kind: 'client', owner: parts[1] };
  if (parts.length === 3 && parts[0] === 'apply' && parts[1] && parts[2]) return { kind: 'apply', owner: parts[1] };
  return null;
}

/**
 * objects: [{ name, created_at, size }]
 * refs:    strings that may CONTAIN a path (a storage_path, a URL, a JSON blob)
 * live:    { candidates:Set, companies:Set, applyTokens:Set } — every one that exists
 * → { remove: [objects], keep: [{ name, why }] }
 */
function pickOrphans({ objects, refs, live, now, minAgeDays = MIN_AGE_DAYS }) {
  const hay = (refs || []).filter(Boolean).map(String);
  const referenced = (name) => hay.some(r => r === name || r.includes(name));
  const remove = [], keep = [];
  for (const o of objects || []) {
    const c = classify(o && o.name);
    if (!c) { keep.push({ name: o && o.name, why: 'unknown_shape' }); continue; }
    if (referenced(o.name)) { keep.push({ name: o.name, why: 'referenced' }); continue; }
    const set = c.kind === 'candidate' ? live.candidates : c.kind === 'client' ? live.companies : live.applyTokens;
    if (!set || set.has(c.owner)) { keep.push({ name: o.name, why: 'owner_exists' }); continue; }
    const t = Date.parse(o.created_at);
    if (!Number.isFinite(t) || now - t < minAgeDays * DAY) { keep.push({ name: o.name, why: 'too_new' }); continue; }
    remove.push(o);
  }
  return { remove, keep };
}

// ── I/O ─────────────────────────────────────────────────────────────────────

// Every row of a column, paged — the default 1,000-row cap would silently
// drop references and make live files look orphaned. Any error THROWS: a read
// that failed must stop the run, never read as "nothing references this".
async function allValues(db, table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.crossOrg(table).select(cols).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    (data || []).forEach(r => cols.split(',').forEach(c => {
      const v = r[c.trim()];
      if (v != null) out.push(typeof v === 'string' ? v : JSON.stringify(v));
    }));
    if (!data || data.length < 1000) return out;
  }
}

// The bucket, walked folder by folder (the Storage API lists one level at a
// time; a folder entry has no id). Depth-capped: PACE nests at most three deep.
async function listAll(storage, prefix = '', depth = 0, out = []) {
  if (depth > 3) return out;
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.from(BUCKET).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    for (const e of data || []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id == null) await listAll(storage, path, depth + 1, out);
      else out.push({ name: path, created_at: e.created_at, size: (e.metadata && e.metadata.size) || 0 });
    }
    if (!data || data.length < 100) return out;
  }
}

/**
 * Find (and unless dryRun, delete) leftover files. Returns counts only — the
 * file names are people's resumes and are never written to a log or a row.
 */
async function purgeStorageOrphans({ db, storage, now = Date.now(), dryRun = false }) {
  const objects = await listAll(storage);
  const [docs, clientDocs, cands, staged, candIds, companyIds, tokens] = await Promise.all([
    allValues(db, 'candidate_documents', 'storage_path'),
    allValues(db, 'client_documents', 'storage_path'),
    allValues(db, 'candidates', 'resume_url,profile_url'),
    allValues(db, 'sourcing_candidates', 'resume_url,raw'),
    allValues(db, 'candidates', 'id'),
    allValues(db, 'companies', 'id'),
    allValues(db, 'job_orders', 'apply_token'),
  ]);
  const live = { candidates: new Set(candIds), companies: new Set(companyIds), applyTokens: new Set(tokens) };
  const { remove, keep } = pickOrphans({ objects, refs: docs.concat(clientDocs, cands, staged), live, now });
  const kept = {};
  keep.forEach(k => { kept[k.why] = (kept[k.why] || 0) + 1; });
  let deleted = 0;
  if (!dryRun) {
    for (let i = 0; i < remove.length; i += 50) {
      const batch = remove.slice(i, i + 50).map(o => o.name);
      const { error } = await storage.from(BUCKET).remove(batch);
      if (error) throw new Error(`remove: ${error.message} (after ${deleted} deleted)`);
      deleted += batch.length;
    }
  }
  return {
    scanned: objects.length, orphans: remove.length, deleted,
    bytes: remove.reduce((n, o) => n + (Number(o.size) || 0), 0), kept, dry_run: !!dryRun,
  };
}

module.exports = { BUCKET, MIN_AGE_DAYS, classify, pickOrphans, purgeStorageOrphans };
