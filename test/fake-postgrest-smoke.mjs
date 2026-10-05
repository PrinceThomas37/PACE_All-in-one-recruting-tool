// THE SHARED FAKE (test/helpers/fake-postgrest.mjs) — a guard for a guard.
//
// Every suite that uses it is only as honest as it is. It exists because five
// earlier fakes were each too kind in a different way, so what it refuses to be
// kind about is pinned HERE, by name, one behaviour at a time:
//   projection · SQL three-valued logic · PostgREST's own errors as RESULTS ·
//   schema validation on every place a column can be named · unsupported
//   methods that THROW instead of matching everything · clones, not references.
import { createFakeDb, uid, parseSelect } from './helpers/fake-postgrest.mjs';
import { wrap, foldMigrations } from './helpers/schema-from-migrations.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const J = (x) => JSON.stringify(x);

// a tiny schema: widgets are validated, parts are not
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-fake-'));
fs.writeFileSync(path.join(dir, '001.sql'), `
  CREATE TABLE widgets (id uuid, org_id uuid, name text, kind text, qty int, owner_id uuid, note text, deleted_at timestamptz, made_at timestamptz, meta jsonb);
  CREATE TABLE owners (id uuid, name text);
`);
const schema = wrap(foldMigrations(dir));
fs.rmSync(dir, { recursive: true, force: true });

const A = uid(), B = uid(), O1 = uid(), O2 = uid();
function make(extra = {}) {
  return createFakeDb({
    tables: {
      widgets: [
        { id: A, org_id: 'o1', name: 'Alpha', kind: 'x', qty: 3, owner_id: O1, note: null, deleted_at: null, made_at: '2026-09-01T00:00:00Z', meta: { tags: ['a'] } },
        { id: B, org_id: 'o1', name: 'a_b%c', kind: 'y', qty: 10, owner_id: null, note: 'hello', deleted_at: null, made_at: '2026-09-03T00:00:00Z' },
        { id: 'w3', org_id: 'o2', name: 'Gamma', kind: null, qty: 7, owner_id: O2, note: 'hi', deleted_at: '2026-09-02T00:00:00Z', made_at: null },
      ],
      owners: [{ id: O1, name: 'Olga' }, { id: O2, name: 'Omar' }],
      parts: [{ id: 'p1', widget_id: A, label: 'bolt' }, { id: 'p2', widget_id: A, label: 'nut' }, { id: 'p3', widget_id: 'w3', label: 'gear' }],
    },
    schema, validate: ['widgets', 'owners'],
    relations: {
      widgets: { owner: { table: 'owners', fk: 'owner_id' }, parts: { table: 'parts', fk: 'widget_id', many: true } },
      parts: { widget: { table: 'widgets', fk: 'widget_id' } },
    },
    defaults: { widgets: () => ({ org_id: 'o-default', deleted_at: null }) },
    unique: { widgets: [{ cols: ['name', 'kind'], where: r => !r.deleted_at, name: 'widgets_name_kind_live' }] },
    notNull: { widgets: ['name'] },
    ...extra,
  });
}
// A section that THROWS is a failing step with a name, not a bare stack trace: a
// broken fake must fail by rule, and a crash prints no FAIL line for anyone to read.
async function section(name, fn) {
  try { await fn(); } catch (e) { step('SECTION CRASHED — ' + name, false, (e && e.stack || String(e)).split('\n').slice(0, 2).join(' ')); }
}

// ── projection ─────────────────────────────────────────────────────────────
await section('projection', async () => {
  const db = make(); const sb = db.supabase;
  const r = await sb.from('widgets').select('id,name').eq('id', A).maybeSingle();
  step('select(list) returns ONLY the listed columns', J(Object.keys(r.data)) === '["id","name"]', J(r.data));
  step('…so a column the route reads but did not select is undefined — the apply_count bug', r.data.qty === undefined && r.data.org_id === undefined);
  const star = await sb.from('widgets').select('*').eq('id', A).maybeSingle();
  step('select("*") returns every column of the row', 'org_id' in star.data && 'note' in star.data);
  const blank = await sb.from('widgets').select('id,note').eq('id', A).maybeSingle();
  step('a selected column the row holds as null comes back as null, not absent', blank.data.note === null && 'note' in blank.data);
  const items = parseSelect('id, owner:owners!owner_fk(id,name), parts(id,label)');
  step('parseSelect understands aliases, !hints and to-many embeds', items.length === 3 && items[1].alias === 'owner' && items[1].table === 'owners' && items[2].table === 'parts');
});

// ── embeds ─────────────────────────────────────────────────────────────────
await section('embeds', async () => {
  const sb = make().supabase;
  const r = await sb.from('widgets').select('id,owner:owners(name),parts(label)').eq('id', A).maybeSingle();
  step('a to-one embed resolves through its foreign key', r.data.owner && r.data.owner.name === 'Olga', J(r.data));
  step('a to-many embed lists the child rows', J(r.data.parts.map(p => p.label).sort()) === '["bolt","nut"]', J(r.data.parts));
  const none = await sb.from('widgets').select('id,owner:owners(name)').eq('id', B).maybeSingle();
  step('an embed with a null foreign key is null', none.data.owner === null);
  let threw = null; try { await sb.from('widgets').select('id,mystery:nowhere(id)'); } catch (e) { threw = e.message; }
  step('an embed with no declared relation THROWS (a missing declaration must not read as "no related row")', /no relation declared/.test(threw || ''), threw);
});

// ── SQL three-valued logic ─────────────────────────────────────────────────
await section('SQL three-valued logic', async () => {
  const sb = make().supabase;
  const ids = async (q) => J((await q).data.map(r => r.name).sort());
  step('neq drops a NULL — SQL `<>` is unknown on NULL (R-071: a fake that kept it listed an ownerless reminder)',
    await ids(sb.from('widgets').select('name').neq('owner_id', O1)) === '["Gamma"]', await ids(sb.from('widgets').select('name').neq('owner_id', O1)));
  step('eq never matches a NULL', await ids(sb.from('widgets').select('name').eq('kind', null)) === '[]');
  step('is(null) matches NULL, not(is, null) matches non-NULL', await ids(sb.from('widgets').select('name').is('owner_id', null)) === '["a_b%c"]'
    && await ids(sb.from('widgets').select('name').not('owner_id', 'is', null)) === '["Alpha","Gamma"]');
  step('not(eq) also drops NULL', await ids(sb.from('widgets').select('name').not('kind', 'eq', 'x')) === '["a_b%c"]');
  step('in() compares as strings', await ids(sb.from('widgets').select('name').in('qty', ['3', 7])) === '["Alpha","Gamma"]');
  step('in() never matches a NULL (even against the literal text "null")', await ids(sb.from('widgets').select('name').in('owner_id', ['null', O1])) === '["Alpha"]');
  step('gt/lte compare numbers as numbers (10 > 9, not "10" < "9")', await ids(sb.from('widgets').select('name').gt('qty', 9)) === '["a_b%c"]'
    && await ids(sb.from('widgets').select('name').lte('qty', 3)) === '["Alpha"]');
  step('a NULL date never satisfies a comparison', await ids(sb.from('widgets').select('name').gte('made_at', '2000-01-01')) === '["Alpha","a_b%c"]');
});

// ── LIKE ───────────────────────────────────────────────────────────────────
await section('LIKE', async () => {
  const sb = make().supabase;
  const ids = async (q) => J((await q).data.map(r => r.name).sort());
  step('ilike is case-insensitive with % and _ wildcards', await ids(sb.from('widgets').select('name').ilike('name', 'ALPH_')) === '["Alpha"]'
    && await ids(sb.from('widgets').select('name').ilike('name', '%MM%')) === '["Gamma"]');
  step('like is case-SENSITIVE', await ids(sb.from('widgets').select('name').like('name', 'alpha')) === '[]');
  step('a backslash-escaped _ and % are literal characters', await ids(sb.from('widgets').select('name').ilike('name', 'a\\_b\\%c')) === '["a_b%c"]');
  step('an UNescaped _ is a wildcard (so a typed "_" matches other characters — the layer-two hazard)',
    await ids(sb.from('widgets').select('name').ilike('name', 'a_b_c')) === '["a_b%c"]');
});

// ── .or() and the methods it refuses ───────────────────────────────────────
await section('.or() and the methods it refuses', async () => {
  const sb = make().supabase;
  const ids = async (q) => J((await q).data.map(r => r.name).sort());
  step('or() understands eq / is / in conditions', await ids(sb.from('widgets').select('name').or('kind.eq.x,owner_id.is.null')) === '["Alpha","a_b%c"]');
  let threw = null; try { await sb.from('widgets').select('name').or('and(a.eq.1,b.eq.2)'); } catch (e) { threw = e.message; }
  step('an .or() it cannot parse THROWS — never a silent no-op that returns every row', /unsupported \.or\(\)/.test(threw || ''), threw);
  threw = null; try { sb.from('widgets').select('name').textSearch('name', 'x'); } catch (e) { threw = e.message; }
  step('an unmodelled method (textSearch) THROWS', /not modelled/.test(threw || ''), threw);
  threw = null; try { sb.from('widgets').select('name').eq('id', A).textSearch('name', 'x'); } catch (e) { threw = e.message; }
  step('…also when it comes AFTER other chained calls (every method returns the guarded builder)', /not modelled/.test(threw || ''), threw);
  threw = null; try { sb.from('widgets').select('name').catch(() => {}); } catch (e) { threw = e; }
  step('.catch() on a builder is a TypeError, as it is in production (a builder is PromiseLike: only .then)', threw instanceof TypeError, String(threw));
});

// ── PostgREST's own errors, as RESULTS ─────────────────────────────────────
await section("PostgREST's own errors, as RESULTS", async () => {
  const sb = make().supabase;
  const bad = await sb.from('widgets').select('id,owner_id_typo').eq('id', A).maybeSingle();
  step('an unknown column in the SELECT LIST is a 42703 RESULT with data null (not a throw)',
    bad.data === null && bad.error && bad.error.code === '42703' && bad.error.message === 'column widgets.owner_id_typo does not exist', J(bad));
  const f = await sb.from('widgets').select('id').eq('nope', 1);
  step('an unknown column in a FILTER is 42703', f.error && f.error.code === '42703' && /widgets\.nope/.test(f.error.message));
  const ilk = await sb.from('widgets').select('id').ilike('nope', 'x');
  step('…in ilike', ilk.error && ilk.error.code === '42703');
  const iss = await sb.from('widgets').select('id').is('nope', null);
  step('…in is()', iss.error && iss.error.code === '42703');
  const ord = await sb.from('widgets').select('id').order('nope');
  step('…in order()', ord.error && ord.error.code === '42703');
  const dbI = make();
  const ins = await dbI.supabase.from('widgets').insert({ name: 'Z', nope: 1 }).select('id').single();
  step('an unknown column in an INSERT row is refused (42703) and NOTHING is written',
    ins.error && ins.error.code === '42703' && ins.data === null && !dbI.T('widgets').some(r => r.name === 'Z') && dbI.log.length === 0, J(ins.error));
  const db2 = make();
  const upd = await db2.supabase.from('widgets').update({ nope: 1 }).eq('id', A);
  step('an unknown column in an UPDATE payload is refused (42703) and nothing changes', upd.error && upd.error.code === '42703' && !('nope' in db2.T('widgets')[0]));
  const ups = await make().supabase.from('widgets').upsert({ id: A, nope: 1 }, { onConflict: 'id' });
  step('…and in an UPSERT payload', ups.error && ups.error.code === '42703');
  const emb = await sb.from('widgets').select('id,owner:owners(id,nope)').eq('id', A);
  step('an unknown column inside an EMBEDDED select list is caught too (owners is validated)', emb.error && emb.error.code === '42703' && /owners\.nope/.test(emb.error.message), J(emb.error));
  const parts = await sb.from('parts').select('id,whatever_we_like').eq('id', 'p1').maybeSingle();
  step('a table that is NOT in `validate` answers normally for any name (only whole-DDL tables are checked)', !parts.error && parts.data.whatever_we_like === null);
  const star = await sb.from('widgets').select('*').eq('id', A).maybeSingle();
  step('`*` is never an unknown column', !star.error);
  const s1 = await sb.from('widgets').select('id').eq('id', A).single();
  step('a valid query is unaffected by validation', s1.data && s1.data.id === A);
});

// ── single / maybeSingle / count ───────────────────────────────────────────
await section('single / maybeSingle / count', async () => {
  const sb = make().supabase;
  const none = await sb.from('widgets').select('id').eq('id', 'zzz').single();
  step('single() with no row: PGRST116 as a result', none.data === null && !!none.error && none.error.code === 'PGRST116');
  const many = await sb.from('widgets').select('id').eq('org_id', 'o1').single();
  step('single() with several rows: PGRST116', many.error && many.error.code === 'PGRST116');
  const mn = await sb.from('widgets').select('id').eq('id', 'zzz').maybeSingle();
  step('maybeSingle() with no row: data null and NO error', mn.data === null && mn.error === null);
  const mm = await sb.from('widgets').select('id').eq('org_id', 'o1').maybeSingle();
  step('maybeSingle() with several rows is still an error', mm.error && mm.error.code === 'PGRST116');
  const c = await sb.from('widgets').select('*', { count: 'exact', head: true }).eq('org_id', 'o1');
  step('count + head returns the count and no rows', c.count === 2 && c.data === null);
});

// ── writes ─────────────────────────────────────────────────────────────────
await section('writes', async () => {
  const db = make(); const sb = db.supabase;
  const r = await sb.from('widgets').insert({ name: 'New', kind: 'z' }).select('id,org_id,deleted_at').single();
  step('insert applies the table defaults UNDER the row (a forgotten org_id files under the default org — visibly)', r.data.org_id === 'o-default' && r.data.deleted_at === null, J(r.data));
  const bare = await sb.from('widgets').insert({ name: 'Bare', kind: 'z2' });
  step('insert without .select() answers data:null (like supabase-js)', bare.data === null && bare.error === null);
  const dup = await sb.from('widgets').insert({ name: 'New', kind: 'z' });
  step('a partial unique index answers 23505 for a live duplicate', dup.error && dup.error.code === '23505' && /widgets_name_kind_live/.test(dup.error.message), J(dup.error));
  db.T('widgets').find(w => w.name === 'New').deleted_at = '2026-09-01T00:00:00Z';
  const again = await sb.from('widgets').insert({ name: 'New', kind: 'z' });
  step('…and lets the row back in once the old one is soft-deleted (the index is PARTIAL)', !again.error);
  const nn = await sb.from('widgets').insert({ kind: 'q' });
  step('a NOT NULL column left out answers 23502', nn.error && nn.error.code === '23502');
  const nWrites = db.log.length;
  await sb.from('widgets').insert({ name: 'Dup2', kind: 'x' }).select('id').single();
  step('every write is logged with the row that landed', db.log.length === nWrites + 1 && db.log[db.log.length - 1].row.name === 'Dup2');

  const u = await sb.from('widgets').update({ qty: 99 }).eq('id', A).select('id,qty');
  step('update().select() returns the changed rows, projected', J(u.data) === J([{ id: A, qty: 99 }]), J(u.data));
  const u0 = await sb.from('widgets').update({ qty: 5 }).eq('id', 'nothing-here').select('id');
  step('an update matching NOTHING returns an empty list — how a "Marked done" that closed nothing shows up', Array.isArray(u0.data) && u0.data.length === 0 && !u0.error);

  const up = await sb.from('widgets').upsert({ id: A, note: 'merged' }, { onConflict: 'id' }).select('id,note,name');
  step('upsert merges into an existing row by its conflict key', !!up.data && !!up.data[0] && up.data[0].note === 'merged' && up.data[0].name === 'Alpha', J(up));
  const up2 = await sb.from('owners').upsert({ id: 'fresh', name: 'Fay' }, { onConflict: 'id' });
  step('…and inserts when there is no such row', !up2.error && db.T('owners').some(o => o.id === 'fresh'));

  step('every upsert is logged, whether it merged or inserted (the apply page\'s error record is read from this log)',
    db.log.filter(l => l.table === 'widgets' && l.op === 'upsert').length === 1 && db.log.filter(l => l.table === 'owners' && l.op === 'upsert').length === 1,
    J(db.log.filter(l => l.op === 'upsert').map(l => [l.table, l.op])));

  const del = await sb.from('owners').delete().eq('id', 'fresh').select('id');
  step('delete removes the matched rows and can return them', J(del.data) === J([{ id: 'fresh' }]) && !db.T('owners').some(o => o.id === 'fresh'));
});

// ── clones, not references ─────────────────────────────────────────────────
await section('clones, not references', async () => {
  const db = make(); const sb = db.supabase;
  const r = await sb.from('widgets').select('id,name,meta').eq('id', A).maybeSingle();
  r.data.name = 'MUTATED BY THE CALLER';
  r.data.meta.tags.push('MUTATED');
  step('a returned row is a COPY — a route mutating it (even a nested jsonb value) does not change the table, as over HTTP',
    db.T('widgets')[0].name === 'Alpha' && J(db.T('widgets')[0].meta) === '{"tags":["a"]}', J(db.T('widgets')[0].meta));
  const when = new Date('2026-09-29T10:00:00Z');
  await sb.from('widgets').update({ made_at: when }).eq('id', A);
  step('a Date written is stored as its ISO string (what JSON puts on the wire)', db.T('widgets')[0].made_at === '2026-09-29T10:00:00.000Z', String(db.T('widgets')[0].made_at));
  await sb.from('widgets').update({ note: undefined, qty: 1 }).eq('id', A);
  step('an undefined key is never sent (JSON drops it) — it does not blank the column', db.T('widgets')[0].note === null && db.T('widgets')[0].qty === 1);
});

// ── ordering ───────────────────────────────────────────────────────────────
await section('ordering', async () => {
  const sb = make().supabase;
  const asc = (await sb.from('widgets').select('name,made_at').order('made_at')).data.map(r => r.name);
  const desc = (await sb.from('widgets').select('name,made_at').order('made_at', { ascending: false })).data.map(r => r.name);
  step('ASC puts NULLs last, DESC puts them first (Postgres)', J(asc) === '["Alpha","a_b%c","Gamma"]' && J(desc) === '["Gamma","a_b%c","Alpha"]', J([asc, desc]));
  const lim = (await sb.from('widgets').select('name').order('qty').limit(2)).data.map(r => r.name);
  const rng = (await sb.from('widgets').select('name').order('qty').range(1, 2)).data.map(r => r.name);
  step('limit and range apply AFTER the order', J(lim) === '["Alpha","Gamma"]' && J(rng) === '["Gamma","a_b%c"]', J([lim, rng]));
});

// ── uuid columns, rpc, failure injection ───────────────────────────────────
await section('uuid columns, rpc, failure injection', async () => {
  const db = make({ uuidColumns: new Set(['id', 'owner_id']) });
  const bad = await db.supabase.from('widgets').select('id').eq('id', 'not-a-uuid');
  step('a malformed uuid in a uuid-column filter is 22P02 (the live behaviour that sinks a whole .in() chunk)', bad.error && bad.error.code === '22P02');
  const badIn = await db.supabase.from('widgets').select('id').in('id', [A, 'nope']);
  step('…also inside in() — ONE bad id refuses the whole chunk', badIn.error && badIn.error.code === '22P02');
  const okIn = await db.supabase.from('widgets').select('id').in('id', [A, B]);
  step('…and good ids still work', okIn.data.length === 2);

  const d2 = make({ rpcs: { next_id: (a) => a.p_prefix + '-0001' } });
  const rp = await d2.supabase.rpc('next_id', { p_prefix: 'SB' });
  const unk = await d2.supabase.rpc('nope', {});
  step('rpc answers through its handler, and an unknown function is an error RESULT', rp.data === 'SB-0001' && unk.error);

  const d3 = make();
  d3.onQuery = (q) => (q.table === 'widgets' && q.eq.id === A) ? { data: null, error: { code: 'XX000', message: 'connection terminated' } } : undefined;
  const inj = await d3.supabase.from('widgets').select('id').eq('id', A).maybeSingle();
  const pass = await d3.supabase.from('widgets').select('id').eq('id', B).maybeSingle();
  step('onQuery can answer with an error RESULT for one query and leave the others alone', inj.error && inj.error.code === 'XX000' && pass.data && pass.data.id === B);
  d3.onQuery = () => { throw new Error('socket hang up'); };
  let rej = null; try { await d3.supabase.from('widgets').select('id'); } catch (e) { rej = e.message; }
  step('onQuery can make a query REJECT', rej === 'socket hang up');
  d3.onQuery = () => new Promise(() => {});
  const raced = await Promise.race([d3.supabase.from('widgets').select('id').then(() => 'answered'), new Promise(r => setTimeout(() => r('still waiting'), 120))]);
  step('onQuery can make a query HANG (it never settles)', raced === 'still waiting', raced);
});

// ── jsonb containment (.contains) — added for R-114's "this address is somebody's EXTRA" lookups ──
await section('contains', async () => {
  const db = createFakeDb({ tables: { people: [
    { id: 'p1', extra_emails: ['a@x.com', 'b@x.com'] }, { id: 'p2', extra_emails: ['b@x.com'] }, { id: 'p3', extra_emails: [] }, { id: 'p4', extra_emails: null },
  ] } });
  const ids = async (v) => ((await db.supabase.from('people').select('id').contains('extra_emails', v)).data || []).map(r => r.id).sort().join(',');
  step('contains: rows whose list holds the value', await ids(['b@x.com']) === 'p1,p2');
  step('contains: every value asked for must be held', await ids(['a@x.com', 'b@x.com']) === 'p1');
  step('contains: an empty list and NULL never match', await ids(['zzz@x.com']) === '');
});

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
