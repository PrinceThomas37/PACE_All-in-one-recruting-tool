// Resume parsing: what it extracts, and what it says when it cannot.
//
// THE BUG THIS EXISTS FOR (Session 19)
// Two resumes failed to parse with `Parse failed: Invalid PDF structure`; a
// third went through. Both fixtures here are the two that failed, kept as real
// bytes because the reason is in the bytes:
//
//   pdf.js only throws "Invalid PDF structure" from its RECOVERY pass, which
//   runs after the normal read has already failed — and that pass can only
//   rescue a file carrying an old-style `trailer` dictionary. A modern PDF
//   (1.5+) stores its index as a compressed cross-reference STREAM instead, so
//   the SAME damage a 2010-era PDF shrugs off is fatal to a 2024 one. Measured:
//   losing 0.1% of either fixture produces exactly that error, while the
//   classic-trailer resume survived the same loss.
//
// Two things follow, and both are asserted below:
//   1. The sentence a recruiter sees must name the situation and a way out.
//      "Invalid PDF structure" names neither, and sent a whole session hunting
//      the wrong thing.
//   2. The upload must CHECK ITSELF. The browser knows how many bytes it read;
//      it now says so, and the server compares. Upload damage then reports
//      itself in bytes instead of being diagnosed from a library's internals.
//
// Usage: node test/resume-parse-smoke.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseResume, extractResumeText, describePdfFailure } = require(join(ROOT, 'resume-parser.js'));

const results = [];
const step = (name, ok, detail = '') => {
  results.push(ok);
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
};

const FIX = join(ROOT, 'test/fixtures/resumes');
const pdfs = {
  pm: join(FIX, 'xref-stream.pdf'),
  swe: join(FIX, 'xref-stream-2.pdf'),
};
step('the two resumes that failed are kept as fixtures',
  Object.values(pdfs).every(existsSync));

const bytes = { pm: readFileSync(pdfs.pm), swe: readFileSync(pdfs.swe) };

// ── 1. WHY THESE TWO ─────────────────────────────────────────────────────────
// If a future fixture had a classic trailer it would be robust to the damage
// that broke these, and the regression would stop being reproduced at all.
for (const [k, buf] of Object.entries(bytes)) {
  const text = buf.toString('latin1');
  step(`${k}: is a modern PDF with a cross-reference stream, not a classic trailer`,
    text.includes('%PDF-') && !/\btrailer\b/.test(text),
    'this is what makes it unrecoverable once damaged');
}

// ── 2. INTACT FILES PARSE, AND YIELD THE RIGHT FIELDS ────────────────────────
// A parser that never throws but returns nothing useful is not working either.
{
  const { fields, used_ai } = await parseResume(bytes.pm, 'resume.pdf', null, null);
  step('an intact resume parses with no AI configured', !used_ai && !!fields);
  step('…the name is picked out of the header', fields.full_name === 'Sarah Jenkins', fields.full_name);
  step('…the email is found', fields.email === 'sarah.jenkins@email.com', fields.email);
  step('…the phone is found', /555/.test(fields.phone || ''), fields.phone);
  step('…the LinkedIn profile is found', /sjenkins-pm/.test(fields.linkedin_url || ''), fields.linkedin_url);
}
{
  const { fields } = await parseResume(bytes.swe, 'resume.pdf', null, null);
  step('the second resume parses too', /alex\.morgan@email\.com/.test(fields.email || ''), fields.email);
  step('…and its skills come back from the dictionary',
    String(fields.skills || '').split(',').length >= 3, fields.skills);
}

// ── 2b. THE READER MUST BE ONE THAT WORKS ON THE NODE WE DEPLOY ─────────────
// The whole fault was here. `pdf-parse` bundles pdf.js **v1.10.100 from 2018**;
// Render runs **Node 26**. On Node 26 that build misreads a compressed
// cross-reference stream — it hits plain text where it expects zlib
// (`Unknown compression method in flate stream: 111, 32`, those bytes being
// the characters "o "), falls into recovery, and recovery only rescues a PDF
// with a classic `trailer`. Measured on these exact files:
//
//                          Node 22 (dev)   Node 26 (Render)
//   both fixtures               ok              FAIL
//   the classic-trailer resume  ok              ok
//
// That is why it looked intermittent and why the sandbox could never
// reproduce it. So a maintained reader leads, and pdf-parse is only a
// fallback.
{
  const src = readFileSync(join(ROOT, 'resume-parser.js'), 'utf8');
  step('a maintained reader is tried FIRST', /pdfTextViaModernReader\(buffer\)/.test(src) &&
    src.indexOf('pdfTextViaModernReader(buffer)') < src.indexOf("tryRequire('pdf-parse')"));
  step('…and the 2018 one is kept only as a second chance',
    /keep the first reason/.test(src));
  step('the buffer is COPIED before being handed over', /new Uint8Array\(buffer\)/.test(src),
    'pdf.js takes ownership, and a Node Buffer can be a window onto a shared pool');
  step('the reader is imported lazily, off the boot path',
    /await import\('unpdf'\)/.test(src));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  step('the dependency is declared', !!pkg.dependencies.unpdf, pkg.dependencies.unpdf);
  // 37MB of pdfjs-dist plus optional native canvas binaries buys only page
  // RENDERING, which nothing here does — and every megabyte is paid for again
  // on each free-tier cold start.
  step('…and it is the light one, since this never renders a page to an image',
    !pkg.dependencies['pdfjs-dist']);
}

// ── 3. THE SENTENCE A RECRUITER SEES ─────────────────────────────────────────
const INVALID = new Error('Invalid PDF structure');

step('an empty upload says so plainly',
  /arrived empty/i.test(describePdfFailure(Buffer.alloc(0), INVALID)));

step('a file that is not a PDF inside is named as such, whatever its extension',
  /not a PDF inside/i.test(describePdfFailure(Buffer.from('PK a zip really'), INVALID)),
  'a renamed .docx is the common case');

// The one cause the person can actually fix by retrying, so it must be
// distinguished from a bad document.
for (const [k, buf] of Object.entries(bytes)) {
  const cut = buf.subarray(0, buf.length - 300);
  step(`${k}: a truncated upload is reported as upload damage, not a bad file`,
    /cut short/i.test(describePdfFailure(cut, INVALID)));
}

step('a password-protected PDF is named, not guessed at',
  /password-protected/i.test(describePdfFailure(
    Buffer.from('%PDF-1.7\n...\n/Encrypt 5 0 R\n%%EOF'), INVALID)));

{
  // Intact bytes, library still refused. The FIRST version of this sentence
  // said "damaged in transit" — and the failure record then proved the file
  // arrived byte-perfect (14,241 declared, 14,241 received, %%EOF present) and
  // the READER was at fault. A confident wrong diagnosis sends someone off
  // re-uploading a good file, so this branch must never blame the upload.
  const msg = describePdfFailure(bytes.pm, INVALID);
  step('an intact file that still fails does NOT blame the upload',
    !/damaged|transit|cut short|try attaching it again/i.test(msg), msg.slice(0, 70));
  step('…it says the file itself is fine', /file itself is fine/i.test(msg));
  step('…and suggests re-saving it', /re-sav/i.test(msg));
  step('…and says the form can still be filled in by hand', /by hand/i.test(msg));
  step('…and never repeats the library\'s own jargon at the user',
    !/invalid pdf structure|xref|startxref|flate/i.test(msg));
}

step('an unrecognised library error still quotes it rather than swallowing it',
  /something quite unexpected/.test(describePdfFailure(bytes.pm, new Error('something quite unexpected'))));

// ── 4. THE FAILURE PATH KEEPS THE LIBRARY'S WORDS FOR THE RECORD ─────────────
{
  const cut = bytes.pm.subarray(0, bytes.pm.length - 300);
  let thrown = null;
  try { await extractResumeText(cut, 'resume.pdf'); } catch (e) { thrown = e; }
  step('a damaged PDF throws the friendly sentence', thrown && /cut short/i.test(thrown.message));
  step('…with the library\'s own message kept on `cause` for diagnosis',
    thrown && thrown.cause && /invalid pdf structure/i.test(thrown.cause.message),
    thrown && thrown.cause && thrown.cause.message);
}

// ── 5. A SCAN IS A DIFFERENT ANSWER ──────────────────────────────────────────
{
  let thrown = null;
  try { await parseResume(Buffer.from('short'), 'notes.txt', null, null); } catch (e) { thrown = e; }
  step('a file with no readable text explains a scan rather than reporting a fault',
    thrown && /scan or a\s+photo/i.test(thrown.message), thrown && thrown.message.slice(0, 60));
}

// ── 6. THE UPLOAD CHECKS ITSELF ──────────────────────────────────────────────
// Source-level, because the value of this is that it is wired end to end: the
// browser has to SEND the size for the server's comparison to mean anything.
const route = readFileSync(join(ROOT, 'routes/recruiting/lookups.js'), 'utf8');
const applicants = readFileSync(join(ROOT, 'public/js/27-page-applicants.js'), 'utf8');
const formatter = readFileSync(join(ROOT, 'public/js/36-resume-format.js'), 'utf8');

step('the browser sends the byte count it read', /size:\s*f\.size/.test(applicants) && /size:\s*file\.size/.test(formatter));
step('…and carries it through the stash a re-render would otherwise lose', /size:stash\.size/.test(applicants));
step('the server compares it with what actually arrived', /declared !== buffer\.length/.test(route));
step('…and reports the shortfall in bytes', /bytes arrived/.test(route));
step('a client that sends no size still works', /Number\.isFinite\(declared\)/.test(route),
  'an older cached page must not start failing');
step('a failure is recorded where it can be read back later',
  /resume_parse_last_error/.test(route) && /recordResumeFailure/.test(route));
step('the record keeps what the LIBRARY said, not the friendly sentence',
  /err\.cause && err\.cause\.message/.test(route));
step('recording can never be the reason an upload fails',
  /catch \(_\) \{ \/\* never let the record break the upload \*\/ \}/.test(route));

// The data-URL prefix strip must not be able to eat into the payload itself.
step('the data-URL prefix strip cannot run past the first comma',
  /\^data:\[\^,\]\*;base64,/.test(route), 'a greedy .* would be a silent corruption of its own');

const failed = results.filter(r => !r).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
