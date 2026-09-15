// ALL EMAIL — one window onto three pipelines (Session 23).
//
// The owner could not find a client email anywhere: the Sent tab reads only
// `emails` (the leads engine), while client and one-off sends live in
// `email_tracking` and candidate batches in `candidate_outreach`. The bodies
// were stored the whole time and nothing read them back.
//
// Source-level invariants, because the merge itself is I/O over three tables
// and the risks are all in what it must NOT do.
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const SRC = fs.readFileSync(path.join(root, 'routes/email-history.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(root, 'public/js/50-all-mail.js'), 'utf8');
const IDX = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const EMAILPAGE = fs.readFileSync(path.join(root, 'public/js/07-page-email.js'), 'utf8');
const HTML = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? ' — ' + detail : '')); }
};

// ── all three pipelines, or it does not answer the question ────────────────
ok('reads the leads engine', /from\('emails'\)/.test(SRC));
ok('reads individual sends', /from\('email_tracking'\)/.test(SRC));
ok('reads candidate batches', /from\('candidate_outreach'\)/.test(SRC));

// ── READ-ONLY. This is the load-bearing one. ──────────────────────────────
// Merging three pipelines for display is safe; merging them for sending is how
// you break the one that already works.
ok('never inserts', !/\.insert\(/.test(SRC));
ok('never updates', !/\.update\(/.test(SRC));
ok('never deletes', !/\.delete\(/.test(SRC));
ok('never upserts', !/\.upsert\(/.test(SRC));
ok('touches no send path', !/sendMailboxNewMessage|deliverOutboundEmail|sendMicrosoftNewMessage/.test(SRC));

// ── stored bodies are rendered ────────────────────────────────────────────
// emails.body and candidate_outreach.body keep {{sender}} unrendered because
// the sending mailbox is resolved at send time. A reader that forgets shows a
// recruiter a raw token — or worse, quotes one back to a prospect.
ok('renders stored bodies', /renderStoredEmail/.test(SRC));
const renderCalls = (SRC.match(/renderStoredEmail\(/g) || []).length;
ok('renders in every one of the three branches', renderCalls >= 3, `found ${renderCalls}`);

// ── org scoping: three new reads are three new ways to leak ───────────────
const withOrgCalls = (SRC.match(/withOrg\(/g) || []).length;
ok('every source query is org-scoped', withOrgCalls >= 3, `withOrg used ${withOrgCalls}x`);
ok('no unscoped bare supabase read slips through',
  !/(?<!withOrg\()supabase\s*\.from\('(emails|email_tracking|candidate_outreach)'\)/.test(SRC));

// ── bounded: this must not become the bug it was written to cure ─────────
ok('each source is capped', /PER_SOURCE\s*=\s*\d+/.test(SRC));
ok('the cap is actually applied', (SRC.match(/\.limit\(PER_SOURCE\)/g) || []).length >= 3);
ok('results are paginated', /page_size/.test(SRC) && /slice\(start, start \+ PAGE\)/.test(SRC));
ok('a horizon is applied', /partitionForView/.test(SRC));
ok('a typed search reaches all of history, not just the window',
  /const days = q \? 0/.test(SRC));

// ── one source failing must not empty the view ───────────────────────────
// candidate_outreach arrives with migration 042; this has to work before and
// after it, and must never report "nothing sent" when it means "could not read".
ok('each source is caught separately', (SRC.match(/sourceErrors\.push/g) || []).length >= 3);
ok('partial results are named as partial', /partial: sourceErrors\.length > 0/.test(SRC));
ok('the screen says so when they are', /d\.partial/.test(PAGE) && /incomplete/.test(PAGE));

// ── wiring ────────────────────────────────────────────────────────────────
ok('router is mounted', /routes\/email-history/.test(IDX));
ok('the page script is loaded', /50-all-mail\.js/.test(HTML));
ok('the Email page has the tab', /'allmail'/.test(EMAILPAGE));
ok('the tab is labelled for a human', /allmail:'All email'/.test(EMAILPAGE));
ok('the tab renders the body', /renderAllMailBody\(\)/.test(EMAILPAGE));
ok('the renderer exists', /window\.renderAllMailBody\s*=/.test(PAGE));

// ── the screen answers the original complaints ───────────────────────────
ok('the body preview is actually drawn — the thing that was missing',
  /am-text/.test(PAGE) && /it\.body/.test(PAGE));
ok('a queued row says queued rather than pretending it was sent',
  /am-pending/.test(PAGE) && /Queued/.test(PAGE));
ok('each pipeline is labelled, since the app never explained them',
  /Lead outreach/.test(PAGE) && /One-off/.test(PAGE) && /Candidate batch/.test(PAGE));
ok('a failed fetch says so instead of looking like an empty history',
  /Could not load the email history/.test(PAGE));
// Our own outbound copy is plain text; an iframe is for untrusted INBOUND mail.
ok('the preview does not build an iframe', !/<iframe/.test(PAGE));
ok('the body is escaped', /htmlEsc\(it\.body\)/.test(PAGE));

console.log(`\nSUMMARY: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
