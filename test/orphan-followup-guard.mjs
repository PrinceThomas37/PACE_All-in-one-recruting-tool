// Guard test for the orphan-follow-up incident of 2026-09-10 (index.js).
//
// Root cause: `follow_ups` rows are created at ASSIGNMENT time
// (POST /distribute/execute) and stamped `outreach_sent_at: today` — a column
// name asserting something that has not happened. The initial cold emails are
// queued asynchronously and drain at one per ~75-105s inside an 8-hour window,
// so a large assignment leaves most unsent for days. The fu1 clock, however,
// started for all of them at assignment.
//
// Result, measured live: 215 fu1 emails queued from one mailbox in a single
// instant, across 95 jobs, to 214 real prospects — every one a follow-up to a
// cold email that had NEVER been sent ("just following up on my note below",
// quoting nothing). Not one of the 215 pairs had any initial email row at all.
// The only volume brake was that mailbox's 300/day cap, which sits above the
// backlog size, so nothing stopped it and nothing on screen said so.
//
// This pins both halves of the fix so neither can be silently removed:
//   1. a follow-up is queued only when the initial email is PROVEN sent;
//   2. the fu1/fu2 clock is re-anchored on that real send date, so an initial
//      that sends late is not followed up the same day it goes out.
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(new URL('../index.js', import.meta.url).pathname), 'utf8');
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };

// ── 1. The gate exists and is sourced from the emails table ────────────────
step('Initial-sent pairs are read from emails with followup_type null + status sent',
  /initialSentPairs[\s\S]{0,600}\.eq\('status',\s*'sent'\)[\s\S]{0,120}\.is\('followup_type',\s*null\)/.test(SRC));

step('A follow-up with no proven initial send is skipped, not queued',
  /const initialSentAt = initialSentPairs\.get\(dupKey\);[\s\S]{0,160}if \(!initialSentAt\)[\s\S]{0,80}continue;/.test(SRC));

// The gate must sit BEFORE the row is pushed for insert.
const gateIdx = SRC.indexOf('if (!initialSentAt)');
const pushIdx = SRC.indexOf('emailsToInsert.push(fuRow)');
step('Gate precedes the queue insert', gateIdx > 0 && pushIdx > gateIdx);

// It must NOT mark the schedule dead — a late initial send makes it legitimate.
const gateBlock = SRC.slice(gateIdx, gateIdx + 200);
step('Gate leaves the schedule active (no status:skipped on this path)',
  !/status:\s*'skipped'/.test(gateBlock));

// ── 2. The clock is re-anchored on the real send date ──────────────────────
step('Due-ness is recomputed from the initial send date',
  /isFollowupDueFromSend\(initialSentAt,\s*dayGap,\s*todayDate\)/.test(SRC));

step('fu1/fu2 day offsets are read per-BD for the re-anchor',
  /u_\$\{bdId\}_fu2_day[\s\S]{0,200}u_\$\{bdId\}_fu1_day/.test(SRC));

// ── 3. The pure helper's date maths, extracted from source ─────────────────
const fnMatch = SRC.match(/function isFollowupDueFromSend\([\s\S]*?\n\}/);
step('isFollowupDueFromSend is present and pure-extractable', !!fnMatch);

if (fnMatch) {
  const isFollowupDueFromSend = new Function(`${fnMatch[0]}; return isFollowupDueFromSend;`)();

  step('Not due before the gap elapses', isFollowupDueFromSend('2026-09-07', 3, '2026-09-09') === false);
  step('Due exactly on the gap day',    isFollowupDueFromSend('2026-09-07', 3, '2026-09-10') === true);
  step('Due after the gap day',         isFollowupDueFromSend('2026-09-07', 3, '2026-09-30') === true);
  step('fu2 gap of 7 respected',        isFollowupDueFromSend('2026-09-07', 7, '2026-09-13') === false);
  step('Month boundary is real date maths, not string maths',
    isFollowupDueFromSend('2026-08-30', 3, '2026-09-02') === true &&
    isFollowupDueFromSend('2026-08-30', 3, '2026-09-01') === false);
  step('A timestamp is accepted as well as a date', isFollowupDueFromSend('2026-09-07T10:00:00Z', 3, '2026-09-10') === true);
  // The whole point of the incident: no send date means never due.
  step('Missing send date is never due', isFollowupDueFromSend(null, 3, '2026-09-10') === false);
  step('Empty send date is never due',  isFollowupDueFromSend('', 0, '2026-09-10') === false);
  step('Unparseable send date is never due', isFollowupDueFromSend('not-a-date', 0, '2026-09-10') === false);
  step('Unparseable gap is never due',  isFollowupDueFromSend('2026-09-07', 'x', '2026-09-10') === false);
  step('Zero gap is due same day',      isFollowupDueFromSend('2026-09-10', 0, '2026-09-10') === true);
}

// ── 4. Observability: the skips must be countable ──────────────────────────
step('Skips are logged so a silent suppression is visible',
  /skipped_no_initial: \$\{log\.skipped_no_initial\}/.test(SRC) && /skipped_not_due_yet: \$\{log\.skipped_not_due_yet\}/.test(SRC));

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
