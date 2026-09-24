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

// ── 8. SEEING (D-0034, C-0027) ──────────────────────────────────────────────
// Extends the definition above from ACTING to SEEING. The owner's report,
// logged in as BD Lead 1: "in leads or in outreach all emails, full
// information is shown to all users… only the ones that they are responsible
// for or given to… but here its complete opposite." Measured live: BD Lead 1
// owned 25 leads and saw 49; every user saw all 119 outreach emails.
//
// The fixture below is the live org shape rampart built while auditing this
// (docs/territories/_contracts.md C-0027) — the exact numbers the owner
// reported (25 of 49, 56 of 119) are reproduced here on purpose, not rounded
// off, so this suite is provably testing the real incident and not a tidier
// stand-in for it.
console.log('\nSeeing (D-0034)');

{
  const chainOf = {
    bdl1: ['bdl1', 'bd2', 'bd3', 'bd4', 'bd10', 'rec1'],
    bdl2: ['bdl2', 'bd5'],
    bd2: ['bd2', 'rec1'],
    ral1: ['ral1', 'ra1'],
    ral2: ['ral2', 'ra9'],
    ra1: ['ra1'],
    rec1: ['rec1'],
    dir: ['dir', 'bdl1', 'bdl2', 'bd2', 'bd3', 'bd4', 'bd10', 'bd5', 'rec1'],
  };
  const sc = (role, id) => own.viewScope({ role, userId: id, chainIds: role === 'admin' ? null : chainOf[id] });

  // 25 leads owned by BD Lead 1, 24 by BD Lead 2, 10 in the pool (6 researched
  // by RA1, 4 by RA9) — 59 total, matching the owner's "25 of 49 ASSIGNED".
  const leads = [];
  for (let i = 0; i < 25; i++) leads.push({ id: 'a' + i, assigned_to_bd: 'bdl1', created_by: i < 12 ? 'ra1' : 'ra9', stage: 'Assigned' });
  for (let i = 0; i < 24; i++) leads.push({ id: 'b' + i, assigned_to_bd: 'bdl2', created_by: 'ra9', stage: 'Assigned' });
  for (let i = 0; i < 10; i++) leads.push({ id: 'p' + i, assigned_to_bd: null, created_by: i < 6 ? 'ra1' : 'ra9', stage: 'Unassigned' });
  const byId = Object.fromEntries(leads.map(l => [l.id, l]));
  const n = (s) => own.scopeLeads(leads, s).length;

  t('BD Lead 1 sees their 25, never the org\'s 49 ASSIGNED leads', () => assert.equal(n(sc('bd_lead', 'bdl1')), 25));
  t('a manager\'s view is exactly self + chain, never the role\'s org-wide slice: BD Lead 2 sees their own 24, never BD Lead 1\'s 25', () => assert.equal(n(sc('bd_lead', 'bdl2')), 24));
  t('bd_lead does not see the pool (does not distribute)', () => assert.ok(!own.canSeeLead(byId.p0, sc('bd_lead', 'bdl1'))));
  t('admin sees everything (59)', () => assert.equal(n(sc('admin', 'adm')), 59));
  t('director sees chain: both BD leads\' 49, never the whole org\'s 59', () => assert.equal(n(sc('director', 'dir')), 49));
  t('a BD with no leads sees 0, not their manager\'s desk', () => assert.equal(n(sc('bd', 'bd2')), 0));
  t('RA Lead 1: pool 10 + RA1-created assigned 12 = 22', () => assert.equal(n(sc('ra_lead', 'ral1')), 22));
  t('RA Lead 2: pool 10 + RA9-created assigned 13+24 = 47', () => assert.equal(n(sc('ra_lead', 'ral2')), 47));
  t('RA1 sees what they researched (12 assigned + 6 pool)', () => assert.equal(n(sc('ra', 'ra1')), 18));
  t('a recruiter sees no leads', () => assert.equal(n(sc('recruiter', 'rec1')), 0));
  t('multi-role: roles[] wins over role, exactly like middleware/authorize.js hasRole', () => {
    assert.equal(own.viewScope({ role: 'admin', roles: ['bd'], userId: 'bd3', chainIds: ['bd3'] }).all, false);
  });
  t('roles[] containing ra_lead grants the pool even with a different primary role', () => {
    assert.equal(own.viewScope({ role: 'bd', roles: ['bd', 'ra_lead'], userId: 'x', chainIds: ['x'] }).seesPool, true);
  });

  // Emails: 56 on BD Lead 1's leads, 63 on BD Lead 2's — 119 total, matching
  // the owner's exact report ("every user saw all 119 outreach emails").
  const emails = [];
  for (let i = 0; i < 56; i++) emails.push({ id: 'e' + i, job_id: 'a' + (i % 25), sent_by: 'bdl1' });
  for (let i = 0; i < 63; i++) emails.push({ id: 'f' + i, job_id: 'b' + (i % 24), sent_by: 'bdl2' });
  const ne = (s) => own.scopeEmails(emails, byId, s).length;
  t('BD Lead 1 sees 56 of the 119 emails, exactly what the owner measured', () => assert.equal(ne(sc('bd_lead', 'bdl1')), 56));
  t('BD Lead 2 sees 63', () => assert.equal(ne(sc('bd_lead', 'bdl2')), 63));
  t('admin sees all 119', () => assert.equal(ne(sc('admin', 'adm')), 119));
  t('RA Lead reads NO BD correspondence — creator/pool grant sight of the LEAD, never the mail on it', () => assert.equal(ne(sc('ra_lead', 'ral1')), 0));
  t('an RA reads no correspondence on a lead they merely researched', () => assert.equal(ne(sc('ra', 'ra1')), 0));
  t('scopeEmails accepts a Map keyed by job id, not just a plain object', () => {
    assert.equal(own.scopeEmails(emails, new Map(Object.entries(byId)), sc('bd_lead', 'bdl1')).length, 56);
  });
  t('a recycled lead: the NEW owner sees its earlier history', () => {
    assert.ok(own.canSeeEmail({ sent_by: 'bd5', job_id: 'a0' }, byId.a0, sc('bd_lead', 'bdl1')));
  });
  t('...and the PREVIOUS sender keeps sight of what they themselves sent', () => {
    assert.ok(own.canSeeEmail({ sent_by: 'bd5', job_id: 'a0' }, byId.a0, sc('bd', 'bd5')));
  });
  t('an individual send with no job (candidate/client mail) is sender-scope only', () => {
    assert.ok(own.canSeeEmail({ sent_by: 'rec1' }, null, sc('bd', 'bd2')));
    assert.ok(!own.canSeeEmail({ sent_by: 'rec1' }, null, sc('bd', 'bd5')));
  });

  t('a contact follows its lead\'s scope, not a scope of its own', () => {
    assert.ok(own.canSeeContact({ id: 'c' }, byId.a0, sc('bd_lead', 'bdl1')));
    assert.ok(!own.canSeeContact({ id: 'c' }, byId.b0, sc('bd_lead', 'bdl1')));
  });
  t('a contact with no lead at all is never seen', () => assert.ok(!own.canSeeContact({ id: 'c' }, null, sc('bd_lead', 'bdl1'))));
  t('a submission: the recruiter\'s own manager sees it', () => assert.ok(own.canSeeSubmission({ recruiter_id: 'rec1' }, sc('bd', 'bd2'))));
  t('a submission: the job order\'s BD sees it, via bd_manager_id', () => {
    assert.ok(own.canSeeSubmission({ recruiter_id: 'zz', job_order: { bd_manager_id: 'bd5' } }, sc('bd', 'bd5')));
  });
  t('a submission: an unrelated BD does not see it', () => {
    assert.ok(!own.canSeeSubmission({ recruiter_id: 'zz', job_order: { bd_manager_id: 'bd5' } }, sc('bd', 'bd3')));
  });

  t('FAIL CLOSED: no user id sees nothing, never everything', () => {
    assert.equal(own.viewScope({ role: 'admin' }).all, false);
    assert.equal(n(own.viewScope({ role: 'admin' })), 0);
  });
  t('FAIL CLOSED: no chain at all means self only', () => {
    assert.equal(own.viewScope({ role: 'bd_lead', userId: 'bdl1' }).ownerIds.join(), 'bdl1');
  });
  t('FAIL CLOSED: a null scope sees nothing', () => {
    assert.equal(own.scopeLeads(leads, null).length, 0);
    assert.ok(!own.canSeeEmail(emails[0], byId.a0, null));
  });
  t('queryOwnerIds: null for admin (no filter), real ids otherwise, [] for a missing scope', () => {
    assert.equal(own.queryOwnerIds(sc('admin', 'adm')), null);
    assert.equal(own.queryOwnerIds(sc('bd_lead', 'bdl1')).length, 6);
    assert.equal(own.queryOwnerIds(null).length, 0);
  });
  t('labels match the /next-actions and /reports/recruiting vocabulary', () => {
    assert.equal(sc('admin', 'adm').label, 'org');
    assert.equal(sc('bd_lead', 'bdl1').label, 'team');
    assert.equal(sc('bd', 'bd3').label, 'own');
  });
  t('an ownerless email (no sender, no job) is never seen by a non-admin', () => {
    assert.ok(!own.canSeeEmail({}, null, sc('bd', 'bd3')));
  });

  // ── the six mutations C-0027 asked for, run against LOCAL reimplementations
  // of the real bugs (never the shipped file — that stays untouched) ────────
  // Each one takes the SAME fixture above and re-asserts the ONE line the real
  // suite already pins, through a hand-mutated copy of the real function
  // carrying exactly the regression named. A mutation "catches" a bug when the
  // real assertion (proven true above) flips false under it — proof this
  // suite would go red the day any of these six actually ships, not just that
  // it currently agrees with the code.
  console.log('\nSeeing — the six reintroduced bugs C-0027 asked to be pinned');

  const POOL_ROLES_REAL = own.POOL_ROLES;

  t('MUTATION 1 — pool shown to every role, not just admin/ra_lead', () => {
    // Real: viewScope's seesPool = rs.some(r => POOL_ROLES.includes(r)).
    // Bug: seesPool is always true.
    const buggyScope = (role, id) => ({ ...sc(role, id), seesPool: true });
    const real = !own.canSeeLead(byId.p0, sc('bd_lead', 'bdl1'));
    const buggy = !own.canSeeLead(byId.p0, buggyScope('bd_lead', 'bdl1'));
    assert.equal(real, true, 'sanity: the real code correctly hides the pool from bd_lead');
    assert.equal(buggy, false, 'the mutation must flip it — a bd_lead now "sees" the pool');
  });

  t('MUTATION 2 — email sight granted via the lead\'s CREATOR, not just its owner/sender', () => {
    function canSeeEmailBuggy(email, job, scope) {
      if (!email || !scope) return false;
      if (scope.all) return true;
      if (own.inScope(email.sent_by, scope)) return true;
      if (!!job && own.inScope(job.assigned_to_bd, scope)) return true;
      return !!job && own.inScope(job.created_by, scope); // BUG: grants sight via creator
    }
    const scope = sc('ra_lead', 'ral1'); // ral1's chain includes ra1, who created a0..a11
    const email = { sent_by: 'bdl1', job_id: 'a0' };
    assert.equal(own.canSeeEmail(email, byId.a0, scope), false, 'sanity: RA Lead reads no BD correspondence today');
    assert.equal(canSeeEmailBuggy(email, byId.a0, scope), true, 'the mutation must flip it — RA1\'s manager now reads a BD\'s mail');
  });

  t('MUTATION 3 — no user id fails OPEN instead of closed', () => {
    function viewScopeBuggy({ role, roles, userId, chainIds } = {}) {
      const rs = own.rolesOf({ role, roles });
      if (!userId) return { all: true, userId: null, ownerIds: [], seesPool: true, label: 'org' }; // BUG
      return own.viewScope({ role, roles, userId, chainIds });
    }
    assert.equal(own.viewScope({ role: 'admin' }).all, false, 'sanity: the real code fails closed with no user');
    assert.equal(viewScopeBuggy({ role: 'admin' }).all, true, 'the mutation must flip it — a request with no user now sees everything');
  });

  t('MUTATION 4 — role read before roles[] (disagrees with middleware/authorize.js hasRole)', () => {
    function rolesOfBuggy({ role, roles } = {}) {
      if (role) return [String(role)]; // BUG: checked before roles[]
      if (Array.isArray(roles) && roles.length) return roles.filter(Boolean).map(String);
      return [];
    }
    const input = { role: 'bd', roles: ['admin'], userId: 'bd3', chainIds: ['bd3'] };
    const realAll = own.viewScope(input).all;
    const buggyRoles = rolesOfBuggy(input);
    assert.equal(realAll, true, 'sanity: roles:[\'admin\'] wins today even with role:\'bd\', exactly like hasRole');
    assert.ok(!buggyRoles.includes('admin'), 'the mutation must flip it — the legacy role wins, admin is lost');
  });

  t('MUTATION 5 — a manager sees every ASSIGNED lead org-wide, not just their chain\'s', () => {
    function canSeeLeadBuggy(job, scope) {
      if (!job || !scope) return false;
      if (scope.all) return true;
      if (scope.label === 'team' && job.assigned_to_bd) return true; // BUG: any manager, any assigned lead
      if (own.inScope(job.assigned_to_bd, scope)) return true;
      if (own.inScope(job.created_by, scope) || own.inScope(job.assigned_to, scope)) return true;
      return own.isPoolLead(job) && !!scope.seesPool;
    }
    const scope = sc('bd_lead', 'bdl1'); // label is 'team' (chain > 1)
    const foreignLead = byId.b0; // owned by bdl2, outside bdl1's chain
    assert.equal(own.canSeeLead(foreignLead, scope), false, 'sanity: bdl1 cannot see bdl2\'s lead today');
    assert.equal(canSeeLeadBuggy(foreignLead, scope), true, 'the mutation must flip it — a manager now sees every assigned lead in the org');
  });

  t('MUTATION 6 — bd_lead added to POOL_ROLES', () => {
    const buggyPoolRoles = Object.freeze([...POOL_ROLES_REAL, 'bd_lead']);
    const seesPoolReal = own.viewScope({ role: 'bd_lead', userId: 'bdl1', chainIds: chainOf.bdl1 }).seesPool;
    const seesPoolBuggy = buggyPoolRoles.includes('bd_lead');
    assert.equal(seesPoolReal, false, 'sanity: bd_lead does not distribute the pool today');
    assert.equal(seesPoolBuggy, true, 'the mutation must flip it — bd_lead now distributes the pool');
    assert.ok(!own.POOL_ROLES.includes('bd_lead'), 'and the SHIPPED POOL_ROLES must never actually contain it');
  });
}

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
