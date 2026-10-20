// One company must not read another company's AI diagnostics (R-288a, 20 Oct 2026).
//
// The AI health card shows the last error, the last test and the limits a provider reported. They were three rows for the whole
// deployment, so company B's admin could read the error sentence company A's key had just produced. Each is now kept per company.
//
// The real ai-provider writes and reads against a tiny in-memory app_settings.
//
// Usage: node test/ai-diagnostics-org-smoke.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ai = require('../services/ai-provider.js');

const results = [];
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${cond ? '' : ' — ' + detail}`); };

const rows = new Map();
const supabase = {
  from: (t) => {
    if (t !== 'app_settings') throw new Error('unexpected table ' + t);
    let key = null;
    const q = {
      select: () => q, eq: (_c, v) => { key = v; return q; },
      maybeSingle: async () => ({ data: rows.has(key) ? { value: rows.get(key) } : null, error: null }),
      upsert: async (row) => { rows.set(row.key, row.value); return { error: null }; },
    };
    return q;
  },
};

await ai.recordFailure(supabase, 'outreach_draft', [{ provider: 'groq', model: 'm', error: 'A-only secret sentence' }], 'orgA');
await ai.recordTest(supabase, { configured: true, attempts: [{ ok: false, error: 'A test error' }] }, 'orgA');
await ai.recordLimits(supabase, 'groq', 'm', { 'x-ratelimit-limit-requests': '100', 'x-ratelimit-remaining-requests': '7' }, Date.now(), 'orgA');

const a = { err: await ai.getLastError(supabase, 'orgA'), test: await ai.getLastTest(supabase, 'orgA'), lim: await ai.getProviderLimits(supabase, 'orgA') };
const b = { err: await ai.getLastError(supabase, 'orgB'), test: await ai.getLastTest(supabase, 'orgB'), lim: await ai.getProviderLimits(supabase, 'orgB') };

ok('company A sees its own last error', a.err && JSON.stringify(a.err).includes('A-only secret sentence'));
ok('company A sees its own last test', a.test && a.test.configured === true);
ok('company A sees the limits its provider reported', a.lim.length === 1 && a.lim[0].requests.remaining === 7);
ok('company B sees NONE of A\'s last error', b.err === null, JSON.stringify(b.err));
ok('company B sees NONE of A\'s last test', b.test === null, JSON.stringify(b.test));
ok('company B sees NONE of A\'s provider limits', Array.isArray(b.lim) && b.lim.length === 0, JSON.stringify(b.lim));
ok('nothing is read from the old deployment-wide rows any more', (await ai.getLastError(supabase)) === null);
ok('the records are stored under a per-company key', [...rows.keys()].every((k) => k.endsWith('__org_orgA')), [...rows.keys()].join(','));

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
