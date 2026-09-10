#!/usr/bin/env node
/**
 * Regenerates docs/territories/_map.json from the real repository.
 *
 * The island view is only worth looking at if the numbers on it are true, so
 * nothing here is hand-maintained: file counts, line counts and last-touched
 * dates come from disk and from git, and open border requests are counted out
 * of docs/territories/_contracts.md.
 *
 *   node scripts/territory-map.mjs
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------------------------------------- territories
 * `own` entries are matched against a repo-relative path. A string ending in
 * `/` is a directory prefix; anything else is an exact file. `not` wins over
 * `own`, which is how routes/recruiting/ stays with guild and out of gateway.
 */
const TERRITORIES = [
  { id: 'surface', name: 'Surface', role: 'Frontend & UI', terrain: 'the coastal city',
    hue: '#5FA8D3', pos: [30, 8], height: 5.5, spread: 15,
    own: ['public/'], not: [] },

  { id: 'gateway', name: 'Gateway', role: 'Server & API', terrain: 'the citadel',
    hue: '#C08A3E', pos: [0, 0], height: 15, spread: 12,
    own: ['index.js', 'routes/', 'middleware/rate-limit.js', 'http-client.js',
          'events.js', 'subscribers.js', 'config/', 'engine-runs.js'],
    not: ['routes/recruiting/', 'routes/ai.js', 'routes/outreach-generator.js',
          'routes/candidate-outreach.js', 'routes/next-actions.js',
          'routes/mailbox.js', 'routes/emails.js', 'routes/warmup.js',
          'routes/deliverability.js', 'routes/auth.js', 'routes/sso.js',
          'routes/org-domains.js', 'routes/plans.js', 'routes/tracking.js',
          'routes/reminders.js', 'routes/workflows.js', 'routes/wf.js',
          'routes/lookups.js', 'routes/lead-sources.js'] },

  { id: 'deep', name: 'The Deep', role: 'Data & Schema', terrain: 'the mine workings',
    hue: '#7B6CA6', pos: [-26, -6], height: 3, spread: 13,
    own: ['models/', 'migrations/', 'schema.sql', 'scripts/'], not: [] },

  { id: 'harbour', name: 'Harbour', role: 'Mail & Delivery', terrain: 'the port',
    hue: '#4E8A7A', pos: [10, 31], height: 2.5, spread: 15,
    own: ['email-vars.js', 'email-tracking.js', 'email-signature.js',
          'email-validation.js', 'email-verify.js', 'gmail-provider.js',
          'services/mail-provider.js', 'send-queue-order.js',
          'services/outreach-cycle.js', 'services/send-progress.js',
          'services/mailbox-reassign.js', 'services/lead-recycle.js',
          'warmup-engine.js', 'deliverability.js', 'domain-health.js',
          'mailbox-health.js', 'mailmerge', 'routes/mailbox.js',
          'routes/emails.js', 'routes/warmup.js', 'routes/deliverability.js'],
    not: [] },

  { id: 'observatory', name: 'Observatory', role: 'AI & Intelligence', terrain: 'the high peak',
    hue: '#D8CFE8', pos: [-15, -27], height: 22, spread: 12,
    own: ['services/ai-provider.js', 'services/ai-budget.js',
          'services/outreach-generator.js', 'services/candidate-outreach.js', 'services/morning-briefing.js',
          'match-engine.js', 'conversation-intel.js', 'next-action.js',
          'resume-parser.js', 'jd-parser.js', 'why-hiring.js',
          'company-classifier.js', 'enrichment.js', 'skill-dictionaries.js',
          'learned-skills.js', 'routes/ai.js', 'routes/outreach-generator.js',
          'routes/candidate-outreach.js', 'routes/next-actions.js'],
    not: [] },

  { id: 'guild', name: 'The Guild', role: 'Recruiting domain', terrain: 'the township',
    hue: '#D98E5F', pos: [19, -21], height: 8, spread: 13,
    own: ['routes/recruiting/', 'services/recruiting-core.js',
          'services/candidate-fields.js', 'bd_recruiter_routes.js',
          'workflow-engine.js', 'routes/workflows.js', 'routes/wf.js',
          'routes/lookups.js', 'hierarchy.js', 'lead-sources/',
          'routes/lead-sources.js', 'lead-ingest.js'],
    not: [] },

  { id: 'rampart', name: 'The Rampart', role: 'Security & Tenancy', terrain: 'the sea wall',
    hue: '#B4553C', pos: [-3, -35], height: 11, spread: 11,
    own: ['middleware/authorize.js', 'routes/auth.js', 'routes/sso.js',
          'services/sso.js', 'services/provisioning.js', 'services/org-domains.js',
          'routes/org-domains.js', 'config/env.js'],
    not: [] },

  { id: 'foundry', name: 'The Foundry', role: 'Tests & Release', terrain: 'the forge',
    hue: '#8C93A1', pos: [-33, 12], height: 9, spread: 14,
    own: ['test/', '.github/'], not: [] },

  { id: 'ledger', name: 'The Ledger', role: 'Commerce & Consent', terrain: 'the counting house',
    hue: '#C9B458', pos: [-15, 30], height: 4, spread: 12,
    own: ['services/plans.js', 'services/entitlements.js', 'services/billing.js',
          'routes/plans.js', 'routes/tracking.js', 'routes/reminders.js'],
    not: [] },
];

/* Who genuinely depends on whom. `weight` 2 = a hot, everyday path. */
const EDGES = [
  ['surface', 'gateway', 2], ['surface', 'guild', 1], ['surface', 'foundry', 1],
  ['gateway', 'deep', 2], ['gateway', 'rampart', 2], ['gateway', 'harbour', 1],
  ['gateway', 'guild', 2], ['gateway', 'observatory', 1], ['gateway', 'ledger', 1],
  ['deep', 'rampart', 2], ['deep', 'guild', 1], ['deep', 'harbour', 1],
  ['harbour', 'observatory', 2], ['harbour', 'ledger', 2], ['harbour', 'guild', 1],
  ['observatory', 'ledger', 1], ['observatory', 'guild', 1],
  ['foundry', 'gateway', 1], ['foundry', 'harbour', 1], ['foundry', 'rampart', 1],
  ['foundry', 'deep', 1], ['foundry', 'observatory', 1], ['foundry', 'ledger', 1],
  ['foundry', 'guild', 1], ['rampart', 'ledger', 1], ['rampart', 'surface', 1],
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'docs']);
const COUNTABLE = /\.(js|mjs|cjs|sql|css|html|sh|yml|yaml)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (COUNTABLE.test(entry.name)) out.push(relative(ROOT, full));
  }
  return out;
}

const matches = (path, patterns) =>
  patterns.some(p => (p.endsWith('/') ? path.startsWith(p) : path === p));

const lineCount = p => {
  try { return readFileSync(join(ROOT, p), 'utf8').split('\n').length; }
  catch { return 0; }
};

const lastTouched = paths => {
  if (!paths.length) return null;
  try {
    const out = execFileSync('git',
      ['log', '-1', '--format=%cs', '--', ...paths.slice(0, 300)],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    return out || null;
  } catch { return null; }
};

/* Open border requests, counted straight out of the ledger. */
function openContracts() {
  let text = '';
  try { text = readFileSync(join(ROOT, 'docs/territories/_contracts.md'), 'utf8'); }
  catch { return []; }
  const rows = [];
  const re = /^### (C-\d+) · (\w+) → (\w+) · (OPEN|ANSWERED|DECLINED) · (\S+)\s*$/gm;
  for (const m of text.matchAll(re)) {
    const after = text.slice(m.index + m[0].length);
    const asks = (after.match(/\*\*Asks for:\*\*\s*([^\n]*(?:\n(?!\*\*|###)[^\n]*)*)/) || [, ''])[1];
    rows.push({
      id: m[1], from: m[2], to: m[3], status: m[4], date: m[5],
      asks: asks.replace(/\s+/g, ' ').trim(),
    });
  }
  return rows;
}

const all = walk(ROOT);
const claimed = new Set();

const territories = TERRITORIES.map(t => {
  const files = all.filter(p => matches(p, t.own) && !matches(p, t.not));
  files.forEach(f => claimed.add(f));
  const lines = files.reduce((n, f) => n + lineCount(f), 0);
  return {
    id: t.id, name: t.name, role: t.role, terrain: t.terrain, hue: t.hue,
    pos: t.pos, height: t.height, spread: t.spread,
    own: t.own, files: files.length, lines,
    largest: files.map(f => ({ f, n: lineCount(f) }))
                  .sort((a, b) => b.n - a.n).slice(0, 4),
    lastTouched: lastTouched(files),
  };
});

const contracts = openContracts();
for (const t of territories) {
  t.openIn  = contracts.filter(c => c.status === 'OPEN' && c.to === t.id).length;
  t.openOut = contracts.filter(c => c.status === 'OPEN' && c.from === t.id).length;
}

const unclaimed = all.filter(p => !claimed.has(p) &&
  !p.startsWith('test/') && !p.includes('package-lock'));

/* ── Capability drift ──────────────────────────────────────────────────────
 * A register nobody is forced to read is a register that goes stale, and a
 * stale one is worse than none — it reports coverage it does not have.
 * So: every router that COMPOSES MAIL must be named somewhere in
 * CAPABILITIES.md. A new send path that nobody registered is exactly the shape
 * of the duplication the owner found (two candidate-email workflows, ~2,900
 * lines, built months apart by different territories).
 * This cannot prove two capabilities are the same. It can prove a send path
 * was added without anyone declaring what it is for, which is the moment the
 * question should have been asked. */
function capabilityDrift() {
  let reg = '';
  try { reg = readFileSync(join(ROOT, 'docs/territories/CAPABILITIES.md'), 'utf8'); }
  catch { return { checked: 0, unregistered: ['CAPABILITIES.md is missing'] }; }

  const COMPOSES = /sendMailboxNewMessage|sendMicrosoftNewMessage|gmailProvider\.sendNewMessage|deliverOutboundEmail|buildHtmlEmailBody/;
  const senders = all.filter(p =>
    (p.startsWith('routes/') || p === 'index.js') &&
    p.endsWith('.js') &&
    COMPOSES.test(readFileSync(join(ROOT, p), 'utf8')));

  const unregistered = senders.filter(p => !reg.includes(p));
  return { checked: senders.length, unregistered };
}
const drift = capabilityDrift();

const map = {
  generated: new Date().toISOString().slice(0, 10),
  repo: 'PrinceThomas37/PACE_All-in-one-recruting-tool',
  totals: {
    files: all.length,
    lines: territories.reduce((n, t) => n + t.lines, 0),
    territories: territories.length,
    unclaimedFiles: unclaimed.length,
  },
  territories, edges: EDGES, contracts, unclaimed: unclaimed.slice(0, 40),
};

writeFileSync(join(ROOT, 'docs/territories/_map.json'),
  JSON.stringify(map, null, 2) + '\n');

/* The island page carries the map inline — an artifact cannot fetch a local
 * file — so the same run that writes the JSON rewrites the page's data block.
 * That is what keeps the numbers on screen from drifting away from the repo. */
const ISLAND = join(ROOT, 'docs/territories/island.html');
try {
  const html = readFileSync(ISLAND, 'utf8');
  const START = '/*MAP_START*/', END = '/*MAP_END*/';
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a === -1 || b === -1) throw new Error('markers missing');
  writeFileSync(ISLAND,
    html.slice(0, a + START.length) + '\n' + JSON.stringify(map) + '\n' + html.slice(b));
  console.log('island page   → docs/territories/island.html (map block rewritten)');
} catch (err) {
  console.log(`island page   → skipped (${err.message})`);
}

console.log(`territory map → docs/territories/_map.json`);
console.log(`  ${map.totals.territories} territories · ${map.totals.files} files · ` +
            `${map.totals.lines.toLocaleString()} lines · ` +
            `${contracts.filter(c => c.status === 'OPEN').length} open requests`);
for (const t of territories) {
  console.log(`  ${t.id.padEnd(12)} ${String(t.files).padStart(3)} files  ` +
              `${String(t.lines).padStart(6)} lines  ${t.lastTouched || '—'}`);
}
console.log(`\n  capability register: ${drift.checked} mail-composing routers checked`);
if (drift.unregistered.length) {
  console.log(`  ⚠ ${drift.unregistered.length} compose mail but are named in NO capability:`);
  drift.unregistered.forEach(f => console.log(`      ${f}`));
  console.log('      → add them to docs/territories/CAPABILITIES.md, or say which');
  console.log('        existing capability they belong to. A send path nobody');
  console.log('        declared is how one job ends up with two workflows.');
}

if (unclaimed.length) {
  console.log(`\n  ⚠ ${unclaimed.length} files claimed by no territory:`);
  unclaimed.slice(0, 15).forEach(f => console.log(`      ${f}`));
}
