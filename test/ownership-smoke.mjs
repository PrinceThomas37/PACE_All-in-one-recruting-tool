// Whose work is this, and what may somebody else do about it?
//
// The owner, on seeing their own dashboard (2026-09-15):
//   "reminders information is not just for one user who is responsible for it,
//    its been showed to everyone and every user as a manager can interact with
//    it… Maybe we can define what ownership or responsibility means."
//
// It had never been defined. Three things were true at once:
//   1. `/next-actions` scoped by the REPORTING CHAIN, so a manager's own daily
//      list carried every report's reminders, unlabelled;
//   2. each of those rows drew a Done button while the endpoint behind it
//      refused to close a reminder the caller does not own — reporting success
//      and changing nothing;
//   3. the morning briefing reported the whole ORGANISATION's numbers to every
//      user, so a recruiter was told the size of the BD lead pool.
//
// D-0020, D-0021 and D-0022 are the answers. This suite pins them.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const own = require('../services/ownership.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }

const ME = 'u-me', THEM = 'u-them', ALSO = 'u-also';

// ── 1. THE DEFINITION ───────────────────────────────────────────────────────
console.log('\nOwnership');

t('an item belongs to its owner_id', () => {
  assert.equal(own.ownerOf({ owner_id: THEM }, ME), THEM);
  assert.equal(own.isMine({ owner_id: THEM }, ME), false);
  assert.equal(own.isMine({ owner_id: ME }, ME), true);
});

t('an UNOWNED item is treated as the viewer\'s, not as nobody\'s', () => {
  // The alternative is a row nobody can ever see or close.
  assert.equal(own.ownerOf({ owner_id: null }, ME), ME);
  assert.equal(own.isMine({ owner_id: null }, ME), true);
});

t('THE BUG: a manager\'s list is their own work, not their team\'s', () => {
  const items = [
    { owner_id: ME, title: 'Mine' },
    { owner_id: THEM, title: 'Recruiter 1\'s' },
    { owner_id: THEM, title: 'Recruiter 1\'s again' },
    { owner_id: ME, title: 'Also mine' },
  ];
  const { mine, team } = own.splitByOwner(items, ME);
  assert.deepEqual(mine.map(i => i.title), ['Mine', 'Also mine']);
  assert.equal(team.length, 2, 'the rest is counted, never listed on the daily list');
});

t('you can ACT on your own and only PROMPT on somebody else\'s', () => {
  assert.deepEqual(own.actionsFor({ owner_id: ME }, ME), { can_act: true, can_prompt: false, verb: 'act' });
  assert.deepEqual(own.actionsFor({ owner_id: THEM }, ME), { can_act: false, can_prompt: true, verb: 'prompt' });
});

// ── 2. THE TEAM COUNT ───────────────────────────────────────────────────────
console.log('\nThe count a manager gets instead');

t('a count with nobody named is useless, so it names them', () => {
  const s = own.teamSummary(
    [{ owner_id: THEM }, { owner_id: THEM }, { owner_id: ALSO }],
    { [THEM]: 'Recruiter 1', [ALSO]: 'Recruiter 5' }
  );
  assert.equal(s.total, 3);
  assert.match(s.label, /3 open across your team/);
  assert.match(s.sentence, /Recruiter 1 \(2\)/);
  assert.match(s.sentence, /Recruiter 5 \(1\)/);
});

t('naming everybody is a list again, so it names three and counts the rest', () => {
  const items = [], names = {};
  for (let i = 0; i < 6; i++) { items.push({ owner_id: 'u' + i }); names['u' + i] = 'Person ' + i; }
  const s = own.teamSummary(items, names);
  assert.equal(s.total, 6);
  assert.match(s.sentence, /and 3 others\./);
});

t('an empty team produces no line at all', () => {
  const s = own.teamSummary([], {});
  assert.equal(s.total, 0);
  assert.equal(s.label, '');
});

t('busiest person first, so the count points somewhere', () => {
  const s = own.teamSummary(
    [{ owner_id: ALSO }, { owner_id: THEM }, { owner_id: THEM }],
    { [THEM]: 'Busy', [ALSO]: 'Quiet' }
  );
  assert.equal(s.people[0].name, 'Busy');
});

t('an unknown owner is "Someone", never a raw id', () => {
  const s = own.teamSummary([{ owner_id: 'u-ghost' }], {});
  assert.match(s.sentence, /Someone/);
  assert.ok(!/u-ghost/.test(s.sentence), 'a user id must never reach a human');
});

// ── 3. THE PROMPT ───────────────────────────────────────────────────────────
console.log('\nAsking the owner to pick it up');

t('a prompt always names who asked', () => {
  const n = own.promptNote({ fromName: 'BD 2', title: 'Clare Duffin', subtitle: 'KB Home' });
  assert.match(n, /BD 2 asked you to pick this up/);
  assert.match(n, /Clare Duffin · KB Home/);
});

t('an anonymous prompt is impossible — it degrades to a role, never to nothing', () => {
  const n = own.promptNote({ fromName: '', title: 'X' });
  assert.match(n, /Your manager asked you to pick this up/);
});

// ── 4. THE ENDPOINTS HONOUR IT ──────────────────────────────────────────────
console.log('\nThe endpoints');

const naRoute = readFileSync(join(root, 'routes/next-actions.js'), 'utf8');

t('THE BUG: the daily list is split by owner before it is returned', () => {
  assert.ok(/ownership\.splitByOwner\(after\.items, req\.user\.id\)/.test(naRoute), 'the list must be scoped to the caller');
  assert.ok(/items: mine/.test(naRoute), 'and it must return the caller\'s half');
});

t('the team is returned as a COUNT, not as rows on the list', () => {
  assert.ok(/team: teamBlock/.test(naRoute));
  assert.ok(/ownership\.teamSummary\(team/.test(naRoute));
});

t('THE BUG: Done on somebody else\'s reminder is REFUSED, not silently ignored', () => {
  // It used to scope the UPDATE by user_id and answer {success:true} whatever
  // happened — zero rows matched, the toast said "Marked done", and the row
  // came back on the next load. The RULE is exercised for real here.
  assert.equal(own.closeRefusal({ user_id: ME }, ME), null, 'your own closes');
  const refusal = own.closeRefusal({ user_id: THEM }, ME);
  assert.ok(refusal, 'somebody else\'s must be refused');
  assert.match(refusal, /not yours to close/);
  assert.match(refusal, /ask them to pick it up/i, 'a refusal must name what you CAN do');
});

t('an ownerless record is closable — nobody is being overruled', () => {
  assert.equal(own.closeRefusal({ user_id: null }, ME), null);
});

// WHAT THIS PAIR DOES AND DOES NOT PROVE — measured, not assumed. The rule above
// runs for real. The CALL SITE can only be grepped, because the handler is a
// closure in routes/next-actions.js that needs a live Supabase to reach, and the
// test harness boots the server against a dead one. A call site left in place
// but neutered (`if (false && …)`) would still pass — that exact shape was tried
// here and slipped through, which is why the rule moved into a function at all.
// Accepted because the realistic regressions (changing the rule, dropping the
// call, softening the message) are all caught.
t('the route uses that rule rather than its own copy of it', () => {
  const done = naRoute.slice(naRoute.indexOf("/:reminderId/done'"), naRoute.indexOf("router.get('/next-actions/team'"));
  assert.ok(/ownership\.closeRefusal\(row, req\.user\.id\)/.test(done), 'must call the shared rule');
  assert.ok(/status\(403\)/.test(done), 'and refuse out loud');
  assert.ok(/can_prompt: true/.test(done), 'and point at what they CAN do');
});

t('a prompt writes to the OWNER\'s list and never touches the task', () => {
  const p = naRoute.slice(naRoute.indexOf("/:reminderId/prompt'"));
  assert.ok(/user_id: row\.user_id/.test(p), 'the note belongs to the owner');
  assert.ok(/reminder_type: 'manager_prompt'/.test(p), 'and is typed so it can be explained');
  assert.ok(!/status: 'sent'/.test(p), 'a prompt must never close the task');
});

t('only somebody the owner reports to may prompt them', () => {
  const p = naRoute.slice(naRoute.indexOf("/:reminderId/prompt'"));
  assert.ok(/reportingChainIds/.test(p) && /status\(403\)/.test(p),
    'without this any colleague could drop tasks on anyone\'s morning');
});

t('the new reminder type is explained like every other one', () => {
  const { describeReminder } = require('../services/reminder-source.js');
  const d = describeReminder({ reminder_type: 'manager_prompt' });
  assert.match(d.label, /manager/i);
  assert.ok(d.why.length > 20);
  assert.ok(!/manager_prompt/.test(d.why + d.label), 'never leak the internal name');
});

// ── 5. THE DASHBOARD QUEUE RENDERS ITS NOTES ────────────────────────────────
console.log('\nThe merge fields I missed');

t('THE BUG: the daily queue renders the stored note', () => {
  // GET /reminders was fixed to render on read; this path was missed, which is
  // why "Hi {{first_name}}" was still on the dashboard in all three of the
  // owner's screenshots.
  assert.ok(/fillTemplate\(r\.note, vars\)/.test(naRoute), 'the queue must render the note');
  assert.ok(/buildEmailVars\(\{ job: r\.job, contact: r\.contact/.test(naRoute),
    'from the reminder\'s own job and contact');
});

t('so does the team review screen', () => {
  const team = naRoute.slice(naRoute.indexOf("router.get('/next-actions/team'"));
  assert.ok(/fillTemplate\(r\.note, vars\)/.test(team));
});

// ── 6. THE BRIEFING IS ABOUT YOUR DESK ──────────────────────────────────────
console.log('\nThe briefing');

const aiRoute = readFileSync(join(root, 'routes/ai.js'), 'utf8');

t('D-0021: the briefing narrows to the reader\'s own leads', () => {
  assert.ok(/const ownedJobIds = async \(req\)/.test(aiRoute), 'it must resolve what the reader owns');
  assert.ok(/assigned_to_bd', req\.user\.id/.test(aiRoute), 'by the lead\'s owner column');
  assert.ok(/facts\.scope = mine === null \? 'org' : 'own'/.test(aiRoute), 'and say which it did');
});

t('admin still sees the organisation — the whole company IS their desk', () => {
  assert.ok(/if \(isAdmin\) return null/.test(aiRoute));
});

t('THE BUG: the unassigned pool is only told to whoever distributes it', () => {
  // A recruiter being told the BD pool size was the clearest symptom of the
  // briefing not knowing who it was talking to.
  const pool = aiRoute.slice(aiRoute.indexOf('THE UNASSIGNED POOL'), aiRoute.indexOf('const cands'));
  assert.ok(/ra_lead|bd_lead/.test(pool) && /admin/.test(pool), 'gated to the distributing roles');
});

t('owning no leads means no replies, not everybody\'s replies', () => {
  assert.ok(/facts\.replies = \{ inbound: 0/.test(aiRoute),
    'the honest answer for an empty desk is zero, not the org total');
});

// ── 7. THE THEME FOLLOWS THE PERSON ─────────────────────────────────────────
console.log('\nThe theme');

const settings = readFileSync(join(root, 'routes/settings.js'), 'utf8');
const shell = readFileSync(join(root, 'public/js/04-shell-login.js'), 'utf8');
const auth = readFileSync(join(root, 'public/js/23-auth.js'), 'utf8');

t('D-0022: the choice is stored against the USER', () => {
  assert.ok(/PREF_KEY = \(userId\) => `pref_\$\{userId\}`/.test(settings), 'keyed per user');
  assert.ok(/router\.put\('\/me\/preferences'/.test(settings));
});

t('and only named values are accepted', () => {
  // This row goes straight back out to every one of that user's browsers.
  assert.ok(/ALLOWED_PREFS = \{ theme: \['light', 'dark', 'system'\] \}/.test(settings));
  assert.ok(/status\(400\)/.test(settings));
});

t('no migration — it rides app_settings like the other per-user stores', () => {
  assert.ok(/from\('app_settings'\)/.test(settings.slice(settings.indexOf('PREF_KEY'))));
});

t('the toggle saves to the account, and still applies instantly', () => {
  const tg = shell.slice(shell.indexOf('window.toggleTheme='), shell.indexOf('window.loadThemePreference='));
  assert.ok(/applyTheme\(next\)/.test(tg), 'applies on screen first');
  assert.ok(/'\/me\/preferences',\{theme:next\}/.test(tg), 'then syncs to the person');
  assert.ok(/catch\(function\(\)\{\}\)/.test(tg), 'a failed sync must not cost the interaction');
});

t('THE BUG: signing out drops the cached theme', () => {
  // Otherwise the next person at a shared desk inherits the last one's choice —
  // which is exactly what the owner saw.
  const lo = auth.slice(auth.indexOf('window.doLogout='));
  assert.ok(/localStorage\.removeItem\('pace-theme'\)/.test(lo));
});

t('every way into the app loads the person\'s own theme', () => {
  const boot = readFileSync(join(root, 'public/js/26-boot.js'), 'utf8');
  assert.ok(/loadThemePreference\(\)/.test(auth), 'password sign-in');
  assert.ok(/loadThemePreference\(\)/.test(boot), 'restored session');
  assert.ok(/loadThemePreference\(\)/.test(shell), 'SSO');
});

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
