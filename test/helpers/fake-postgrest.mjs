// AN IN-MEMORY POSTGREST, strict in the ways the real one is.
//
// WHY A SHARED ONE. Five fakes in this repo returned WHOLE ROWS whatever the
// route asked for, ignored a filter they did not know, or answered success for a
// column the table does not have — and each of those was a real bug that a
// green suite stood beside:
//   * apply-page-smoke's `select: () => chain` threw the column list away, so
//     `job_orders.owner_id` (a column that table never had) never failed and every
//     apply link was dead for a week (R-076);
//   * a fake whose `neq` KEPT a NULL owner (SQL's `<>` drops it) listed a
//     reminder nobody could act on (R-071);
//   * a fake that treated `.or()` as a no-op would have made a broken filter read
//     as an empty, perfectly plausible list.
// So this one PROJECTS every row to the route's own select list, follows SQL's
// three-valued logic, answers PostgREST's own errors (42703 unknown column,
// 23505 unique, 22P02 malformed uuid, PGRST116 single-row) as a RESULT — never a
// throw — and REFUSES what it cannot do (an unsupported filter throws, it does
// not quietly match everything).
//
// Options
//   tables      { name: [rows] }     seed data
//   schema      a helper from schema-from-migrations.mjs (wrap()/loadSchema())
//   validate    [table, ...]         tables whose every NAMED column (select list,
//                                    filters, order, insert/update/upsert keys,
//                                    embedded select lists) is checked against
//                                    the schema. Only tables whose whole DDL is in
//                                    migrations/ (schema.isComplete) belong here.
//   relations   { table: { alias: { table, fk, many? } } }   for embeds
//   defaults    { table: (row) => extra }   applied UNDER the inserted row (id,
//                                    org_id defaults, created_at ...)
//   unique      { table: [{ cols:[..], name?, where?: row=>bool }] }
//   notNull     { table: [cols] }
//   uuidColumns Set of column names holding uuids (22P02 on a junk value)
//   rpcs        { name: (args, db) => data }
//   onQuery     (q) => undefined | result | Promise   — failure injection: return
//                                    a {data,error} result to answer with it,
//                                    throw to REJECT, or return a promise that
//                                    never settles to HANG.
import crypto from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uid = () => crypto.randomUUID();

const isNil = (v) => v === null || v === undefined;
const S = (v) => (v instanceof Date ? v.toISOString() : String(v));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));   // what travels over HTTP

function cmp(a, b) {
  const na = typeof a === 'number' || (a !== '' && !isNaN(Number(a)) && typeof a !== 'object');
  const nb = typeof b === 'number' || (b !== '' && !isNaN(Number(b)) && typeof b !== 'object');
  if (na && nb) return Number(a) - Number(b);
  return S(a) < S(b) ? -1 : S(a) > S(b) ? 1 : 0;
}

// SQL LIKE → RegExp. `%` any run, `_` any one character, backslash escapes.
function likeToRe(pat, ci) {
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '\\' && i + 1 < pat.length) { re += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (ch === '%') re += '[\\s\\S]*';
    else if (ch === '_') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', ci ? 'i' : '');
}

// One condition, SQL-style: NULL never satisfies a comparison.
function test(row, f) {
  const a = row[f.col];
  switch (f.op) {
    case 'eq': return !isNil(a) && !isNil(f.val) && S(a) === S(f.val);
    case 'neq': return !isNil(a) && !isNil(f.val) && S(a) !== S(f.val);
    case 'gt': return !isNil(a) && !isNil(f.val) && cmp(a, f.val) > 0;
    case 'gte': return !isNil(a) && !isNil(f.val) && cmp(a, f.val) >= 0;
    case 'lt': return !isNil(a) && !isNil(f.val) && cmp(a, f.val) < 0;
    case 'lte': return !isNil(a) && !isNil(f.val) && cmp(a, f.val) <= 0;
    case 'is': return f.val === null ? isNil(a) : a === f.val;
    case 'in': return !isNil(a) && (f.val || []).some(v => !isNil(v) && S(v) === S(a));
    case 'like': return !isNil(a) && likeToRe(String(f.val), false).test(String(a));
    case 'ilike': return !isNil(a) && likeToRe(String(f.val), true).test(String(a));
    default: throw new Error('fake-postgrest: unsupported filter operator "' + f.op + '"');
  }
}
function evalFilter(row, f) {
  if (f.op === 'not') {
    const inner = { col: f.col, op: f.inner, val: f.val };
    // NOT of a comparison on NULL is still NULL (excluded) — except IS, which is two-valued.
    if (f.inner === 'is') return !test(row, inner);
    return !isNil(row[f.col]) && !test(row, inner);
  }
  if (f.op === 'or') return f.alts.some(alt => evalFilter(row, alt));
  if (f.op === 'match') return Object.entries(f.val).every(([k, v]) => evalFilter(row, { col: k, op: 'eq', val: v }));
  return test(row, f);
}

// "a.eq.1,b.is.null,c.in.(x,y)" -> alternatives. Anything richer THROWS: a
// silent no-op is how a broken filter reads as a plausible empty list.
function parseOr(str) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of String(str)) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map(p => {
    const m = p.match(/^([\w.]+?)\.(eq|neq|gt|gte|lt|lte|is|in|like|ilike)\.(.*)$/);
    if (!m) throw new Error('fake-postgrest: unsupported .or() condition "' + p + '"');
    let val = m[3];
    if (m[2] === 'is') val = val === 'null' ? null : val === 'true' ? true : val === 'false' ? false : val;
    if (m[2] === 'in') val = val.replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    return { col: m[1], op: m[2], val };
  });
}

// select list -> items. Handles `a, b, alias:table!hint(inner...), *`.
function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(s)) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export function parseSelect(cols) {
  return splitTop(cols == null || cols === '' ? '*' : cols).map(p => {
    const m = p.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\(([\s\S]*)\)$/);
    if (m) return { embed: true, alias: m[1] || m[2], table: m[2], items: parseSelect(m[3]) };
    if (p === '*') return { star: true };
    // `col::text`, `col->>key` and friends are not modelled here — refuse rather than guess
    if (!/^"?[A-Za-z_]\w*"?$/.test(p)) throw new Error('fake-postgrest: unsupported select item "' + p + '"');
    return { col: p.replace(/"/g, '') };
  });
}

export function createFakeDb(opts = {}) {
  const tables = {};
  for (const [k, v] of Object.entries(opts.tables || {})) tables[k] = v;
  const schema = opts.schema || null;
  const validate = new Set(opts.validate || []);
  const relations = opts.relations || {};
  const defaults = opts.defaults || {};
  const unique = opts.unique || {};
  const notNull = opts.notNull || {};
  const uuidCols = opts.uuidColumns || null;
  const rpcs = opts.rpcs || {};

  const T = (name) => (tables[name] = tables[name] || []);
  const db = { tables, T, log: [], calls: [], onQuery: opts.onQuery || null };

  // ── validation ───────────────────────────────────────────────────────────
  const unknownFor = (table, names) => (validate.has(table) && schema) ? schema.unknown(table, names) : [];
  function namesInSelect(table, items, out = []) {
    for (const it of items) {
      if (it.col) out.push([table, it.col]);
      else if (it.embed) {
        const rel = (relations[table] || {})[it.alias] || (relations[table] || {})[it.table];
        namesInSelect(rel ? rel.table : it.table, it.items, out);
      }
    }
    return out;
  }
  const colErr = (table, col) => ({ code: '42703', details: null, hint: null, message: `column ${table}.${col} does not exist` });
  const payloadErr = (table, col) => ({ code: '42703', details: null, hint: null, message: `column "${col}" of relation "${table}" does not exist` });

  // ── projection (with embeds) ─────────────────────────────────────────────
  function project(table, row, items) {
    const out = {};
    for (const it of items) {
      if (it.star) { Object.assign(out, row); continue; }
      if (it.col) { out[it.col] = row[it.col] === undefined ? null : row[it.col]; continue; }
      const rel = (relations[table] || {})[it.alias] || (relations[table] || {})[it.table];
      if (!rel) throw new Error(`fake-postgrest: no relation declared for embed "${it.alias}" on ${table} — declare it in relations`);
      if (rel.many) {
        const key = rel.pk || 'id';
        out[it.alias] = T(rel.table).filter(r => !isNil(row[key]) && S(r[rel.fk]) === S(row[key])).map(r => project(rel.table, r, it.items));
      } else {
        const t = isNil(row[rel.fk]) ? null : T(rel.table).find(r => S(r[rel.pk || 'id']) === S(row[rel.fk]));
        out[it.alias] = t ? project(rel.table, t, it.items) : null;
      }
    }
    return clone(out);
  }

  function from(table) {
    const q = { table, op: 'select', cols: null, items: null, filters: [], order: [], limit: null, range: null,
      payload: null, onConflict: null, returning: false, single: false, maybe: false, count: null, head: false, eq: {} };
    const rowsNow = () => T(table).filter(r => q.filters.every(f => evalFilter(r, f)));
    let guarded;   // every method returns THIS, so an unmodelled method throws wherever it is chained
    const add = (f) => { q.filters.push(f); if (f.op === 'eq') q.eq[f.col] = f.val; return guarded; };

    const chain = {
      select(cols, o) {
        q.cols = cols == null ? '*' : cols;
        if (q.op !== 'select') q.returning = true;
        if (o && o.count) q.count = o.count;
        if (o && o.head) q.head = true;
        return guarded;
      },
      eq: (c, v) => add({ col: c, op: 'eq', val: v }), neq: (c, v) => add({ col: c, op: 'neq', val: v }),
      gt: (c, v) => add({ col: c, op: 'gt', val: v }), gte: (c, v) => add({ col: c, op: 'gte', val: v }),
      lt: (c, v) => add({ col: c, op: 'lt', val: v }), lte: (c, v) => add({ col: c, op: 'lte', val: v }),
      is: (c, v) => add({ col: c, op: 'is', val: v }),
      in: (c, vs) => add({ col: c, op: 'in', val: Array.isArray(vs) ? vs : [vs] }),
      like: (c, v) => add({ col: c, op: 'like', val: v }), ilike: (c, v) => add({ col: c, op: 'ilike', val: v }),
      not: (c, op, v) => {
        let val = v;
        if (op === 'in' && typeof v === 'string') val = v.replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, ''));
        return add({ col: c, op: 'not', inner: op, val });
      },
      or: (str) => add({ op: 'or', alts: parseOr(str) }),
      match: (obj) => add({ op: 'match', val: obj }),
      order(col, o) { q.order.push({ col, asc: !(o && o.ascending === false) }); return guarded; },
      limit(n) { q.limit = n; return guarded; },
      range(a, b) { q.range = [a, b]; return guarded; },
      insert(p) { q.op = 'insert'; q.payload = p; return guarded; },
      update(p) { q.op = 'update'; q.payload = p; return guarded; },
      upsert(p, o) { q.op = 'upsert'; q.payload = p; q.onConflict = (o && o.onConflict) || 'id'; return guarded; },
      delete() { q.op = 'delete'; return guarded; },
      single() { q.single = true; return guarded; },
      maybeSingle() { q.single = true; q.maybe = true; return guarded; },
      then(res, rej) { return run().then(res, rej); },
    };
    // Anything else is not modelled: THROW, never quietly match everything. A real
    // supabase-js builder is PromiseLike — `then` and nothing else — so `.catch()`
    // straight on one is a TypeError in production too, and is reported as such.
    guarded = new Proxy(chain, { get: (t, k) => {
      if (k in t || typeof k === 'symbol') return t[k];
      if (k === 'catch' || k === 'finally') return () => { throw new TypeError('builder.' + k + ' is not a function — a supabase builder is PromiseLike (only .then); wrap it in Promise.resolve()'); };
      return () => { throw new Error('fake-postgrest: .' + String(k) + '() is not modelled — extend the fake, do not skip it'); };
    } });

    async function run() {
      // FAILURE INJECTION first: it stands for "the database/network did this".
      if (db.onQuery) {
        const inj = await db.onQuery(Object.assign({}, q, { count: q.count }));
        if (inj !== undefined) return inj;
      }
      q.items = parseSelect(q.cols);
      db.calls.push({ table, op: q.op, cols: q.cols, filters: q.filters.map(f => ({ ...f })), eq: { ...q.eq } });

      // ── validate every name the caller used ──
      if (validate.has(table) && schema) {
        const named = [];
        if (q.op === 'select' || q.returning) namesInSelect(table, q.items).forEach(([t, c]) => named.push([t, c]));
        q.filters.forEach(f => { if (f.col) named.push([table, f.col]); (f.alts || []).forEach(a => named.push([table, a.col])); if (f.op === 'match') Object.keys(f.val).forEach(k => named.push([table, k])); });
        q.order.forEach(o => named.push([table, o.col]));
        for (const [t, c] of named) { const bad = unknownFor(t, [c]); if (bad.length) return { data: null, error: colErr(t, bad[0]), status: 400 }; }
        if (q.op === 'insert' || q.op === 'update' || q.op === 'upsert') {
          for (const r of [].concat(q.payload || [])) {
            const bad = unknownFor(table, Object.keys(r || {}));
            if (bad.length) return { data: null, error: payloadErr(table, bad[0]), status: 400 };
          }
        }
      } else if (q.op === 'select' || q.returning) {
        // embedded tables that ARE validated still get their inner lists checked
        for (const [t, c] of namesInSelect(table, q.items)) {
          if (t === table) continue;
          const bad = unknownFor(t, [c]); if (bad.length) return { data: null, error: colErr(t, bad[0]), status: 400 };
        }
      }
      if (uuidCols) {
        for (const f of q.filters) {
          if (!f.col || !uuidCols.has(f.col)) continue;
          for (const v of (f.op === 'in' ? f.val : [f.val])) {
            if (!isNil(v) && !UUID.test(String(v)) && (f.op === 'eq' || f.op === 'in' || f.op === 'neq')) {
              return { data: null, error: { code: '22P02', details: null, hint: null, message: `invalid input syntax for type uuid: "${v}"` }, status: 400 };
            }
          }
        }
      }

      let out = [];
      const wasWrite = q.op !== 'select';
      if (q.op === 'insert' || q.op === 'upsert') {
        const list = [].concat(clone(q.payload) || []);
        const made = [];
        for (const p of list) {
          const base = Object.assign({ id: uid() }, defaults[table] ? defaults[table](p) : {}, p);
          if (q.op === 'upsert') {
            const keys = String(q.onConflict).split(',').map(s => s.trim());
            const ex = T(table).find(r => keys.every(k => !isNil(base[k]) && S(r[k]) === S(base[k])));
            if (ex) { Object.assign(ex, p); made.push(ex); continue; }
          }
          for (const c of (notNull[table] || [])) {
            if (isNil(base[c])) return { data: null, error: { code: '23502', details: null, hint: null, message: `null value in column "${c}" of relation "${table}" violates not-null constraint` }, status: 400 };
          }
          for (const u of (unique[table] || [])) {
            const live = (r) => (u.where ? u.where(r) : true);
            if (live(base) && T(table).some(r => live(r) && u.cols.every(k => !isNil(base[k]) && S(r[k]) === S(base[k])))) {
              return { data: null, error: { code: '23505', details: null, hint: null, message: `duplicate key value violates unique constraint "${u.name || (table + '_' + u.cols.join('_') + '_key')}"` }, status: 409 };
            }
          }
          made.push(base);
        }
        made.forEach(r => { if (!T(table).includes(r)) T(table).push(r); });
        made.forEach(r => db.log.push({ table, op: q.op, row: clone(r) }));
        out = made;
      } else if (q.op === 'update') {
        const patch = clone(q.payload) || {};
        out = rowsNow();
        out.forEach(r => Object.assign(r, patch));
        db.log.push({ table, op: 'update', patch, ids: out.map(r => r.id) });
      } else if (q.op === 'delete') {
        out = rowsNow();
        tables[table] = T(table).filter(r => !out.includes(r));
        db.log.push({ table, op: 'delete', ids: out.map(r => r.id) });
      } else {
        out = rowsNow();
      }

      let total = out.length;
      if (!wasWrite) {
        for (const o of q.order.slice().reverse()) {
          // Postgres: ASC puts NULLs last, DESC puts them first.
          out = out.slice().sort((a, b) => {
            const x = a[o.col], y = b[o.col];
            if (isNil(x) && isNil(y)) return 0;
            if (isNil(x)) return o.asc ? 1 : -1;
            if (isNil(y)) return o.asc ? -1 : 1;
            return (o.asc ? 1 : -1) * cmp(x, y);
          });
        }
        if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
        if (q.limit != null) out = out.slice(0, q.limit);
      }

      if (wasWrite && !q.returning) return { data: null, error: null, status: 201 };
      if (q.head) return { data: null, error: null, count: total, status: 200 };
      const shaped = out.map(r => project(table, r, q.items));
      const extra = q.count ? { count: total } : {};
      if (q.single) {
        if (shaped.length === 1) return { data: shaped[0], error: null, status: 200, ...extra };
        if (shaped.length === 0 && q.maybe) return { data: null, error: null, status: 200, ...extra };
        return { data: null, error: { code: 'PGRST116', details: `The result contains ${shaped.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 };
      }
      return { data: shaped, error: null, status: 200, ...extra };
    }
    return guarded;
  }

  db.supabase = {
    from,
    async rpc(name, args) {
      if (!rpcs[name]) return { data: null, error: { code: '42883', message: `function ${name} does not exist` } };
      return { data: await rpcs[name](args, db), error: null };
    },
  };
  return db;
}
