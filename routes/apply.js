'use strict';
// ============================================================================
// THE PUBLIC APPLY PAGE — the front door for candidates.
//
// WHAT THIS IS FOR. Until now every candidate in PACE was one somebody typed
// in or imported from a spreadsheet. That makes the candidate database cost
// money or labour to grow, forever. This is the one source that does neither:
// a job order can be published, which mints a link, and anyone with that link
// can apply. The resume is parsed on arrival and the person lands in the same
// review queue as a CSV import.
//
// FOUR RULES THIS FILE OBEYS, ALL OF THEM BORROWED FROM /i/:token — the other
// public page in this app, which learned them the hard way.
//
//  1. A PUBLIC PAGE MAY NEVER HANG ON THE DATABASE. supabase-js retries a
//     refused connection for SEVEN SECONDS. That is a spinner on a stranger's
//     phone on the one screen where we are asking them for something. Every
//     query here is bounded and falls through to an honest page.
//
//  2. A WRITE THAT DID NOT HAPPEN IS NEVER REPORTED AS SAVED. An applicant
//     told "thanks, we have it" when the insert timed out has been lied to,
//     and they will not apply twice. They get told the truth and an email
//     address that works.
//
//  3. UNKNOWN, UNPUBLISHED AND MALFORMED TOKENS ANSWER IDENTICALLY. The token
//     is the secret that stops someone walking a customer's whole req list, so
//     a scanner must learn nothing from the difference.
//
//  4. THE CLIENT'S NAME IS NEVER ON THIS PAGE. A staffing desk does not
//     publish who its client is — that is the relationship it is paid for. The
//     page is presented as the RECRUITING ORG hiring, which is also the honest
//     thing to say, since the recruiter is who the applicant will hear from.
//
// A FIFTH RULE, LEARNED HERE (R-076): A FAILED QUERY IS NOT A MISS.
//  5. Rule 3 makes every miss answer identically — which is exactly what let a
//     BROKEN lookup pass for "this role is closed" for a week: the select named
//     a column job_orders does not have (owner_id), PostgREST refused the whole
//     query, `data` came back null like any miss, and a published, active job
//     read as dead while nothing anywhere said why. The public answer stays the
//     same; the failure is recorded under app_settings `apply_last_error` (see
//     describeFailure / noteFailure) where an operator can read it.
//
// NOTHING HERE REACHES THE REAL CANDIDATE DATABASE. Applicants land in
// `sourcing_candidates`, inert, exactly like a CSV row. A recruiter reviews and
// imports. That is deliberate: a public form that wrote straight into the ATS
// would be a spam vector aimed at the most valuable table in the product.
// ============================================================================

const express = require('express');
const gen = require('../services/candidate-outreach');       // escapeHtml only
const { parseResume } = require('../resume-parser');
const { emailSyntaxValid } = require('../email-validation');
const { scrubJobDescription, clientNames } = require('../services/jd-scrub');
const { clientIp } = require('../middleware/rate-limit');

const DOC_BUCKET = 'candidate-docs';

// express.json caps the body at 5MB and base64 inflates by about a third, so a
// 3MB file is the largest that can arrive intact. The refusal is checked in the
// browser first (so the applicant is told before a slow upload) and again here,
// because a browser check is a courtesy and never a guarantee.
const MAX_RESUME_BYTES = 3 * 1024 * 1024;

const DB_TIMEOUT_MS = 4000;
const notify = require('../services/applicant-notify');

// One row, overwritten: "why did the last thing on this page fail", not a
// history. Same key shape and reasoning as resume_parse_last_error / ai_last_error.
const LAST_ERROR_KEY = 'apply_last_error';
const RECORD_TIMEOUT_MS = 1500;

// ── WHAT A SETTLED QUERY ACTUALLY SAID ───────────────────────────────────────
// withTimeout() (inside the router) flattens three different outcomes into
// things a caller is inclined to read as "no row": a supabase result carrying an
// `error` has `data: null` — identical to a clean miss; a promise that REJECTED
// comes back as null; one that TIMED OUT comes back as undefined. R-076 was
// exactly the first: the job lookup named a column job_orders does not have,
// PostgREST refused the whole query (42703), `data` was null, and the page said
// "This role is no longer open" about a job that was published and active.
//
// PURE. null = the query ran (whatever it found, including nothing); otherwise
// the reason, as {code, message}.
function queryFailure(r, ms) {
  if (r === undefined) return { code: 'timeout', message: 'no answer within ' + (ms || DB_TIMEOUT_MS) + 'ms' };
  if (r === null) return { code: 'rejected', message: 'the query threw instead of answering' };
  if (r.error) return r.error;
  return null;
}

// The record, PURE and deliberately narrow — exactly {at, code, message, where}:
//   * THE TOKEN IS THE SECRET, so nothing token-shaped is ever written. The scrub
//     is by SHAPE (the 16-64 hex loadJob accepts), not by remembering to pass the
//     token in, and it runs BEFORE the length clip so a token straddling the cut
//     cannot leave a readable half behind.
//   * `code` and `message` only. PostgREST's `details` echoes the failing ROW
//     (an applicant's name, email and phone) and has no place in a settings row.
//   * `where` is always a literal from this file, never anything from the request.
const TOKEN_SHAPED = /[a-f0-9]{16,64}/gi;
function describeFailure(where, err, now) {
  const e = err && typeof err === 'object' ? err : { message: err };
  const clean = (v, n) => String(v == null ? '' : v)
    .replace(TOKEN_SHAPED, '[token]').replace(/\s+/g, ' ').trim().slice(0, n);
  const code = e.code != null && e.code !== '' ? e.code
    : (e.name && e.name !== 'Error' ? e.name : 'unknown');
  return {
    at: (now instanceof Date ? now : new Date()).toISOString(),
    code: clean(code, 40) || 'unknown',
    message: clean(e.message, 300),
    where: String(where),
  };
}

module.exports = (ctx) => {
  const router = express.Router();
  const { supabase, applyLimiter } = ctx;
  const esc = gen.escapeHtml;

  function withTimeout(promise, ms) {
    return Promise.race([
      Promise.resolve(promise).catch(() => null),
      new Promise(resolve => setTimeout(() => resolve(undefined), ms || DB_TIMEOUT_MS)),
    ]);
  }

  const txt = (v) => String(v == null ? '' : v).trim();

  // Records a failure where an operator can read it (describeFailure() says what
  // is, and is not, kept). FIRE-AND-FORGET: bounded at 1.5s and never awaited,
  // because recording must not be the reason a stranger's request fails or slows.
  // During a database outage the record is itself a write to the failing
  // database, so at most ONE is in flight at a time — a burst of failing
  // requests must not become a burst of writes.
  let recording = false;
  function noteFailure(where, err) {
    if (recording) return;
    try {
      recording = true;
      const done = () => { recording = false; };
      withTimeout(supabase.from('app_settings').upsert({
        key: LAST_ERROR_KEY,
        value: JSON.stringify(describeFailure(where, err)),
        updated_at: new Date(),
      }, { onConflict: 'key' }), RECORD_TIMEOUT_MS).then(done, done);
    } catch (_) { recording = false; }   // even a broken client must not reach the caller
  }

  // Sends the two messages an application should produce. Fire-and-forget:
  // every await inside is bounded and every failure is swallowed, because the
  // caller has already answered the applicant.
  //
  // THE SENDING MAILBOX IS THE JOB OWNER'S. A public page cannot be allowed to
  // choose a From address, and there is no logged-in user here — so it is the
  // person who owns the job, or nobody. No mailbox means no email, quietly.
  async function notifyOnApplication(job, staged, applicantEmail) {
    const resolveMailbox = ctx.recruiterSendingMailbox;
    const send = ctx.sendMailboxNewMessage;
    if (typeof resolveMailbox !== 'function' || typeof send !== 'function') return;

    // A job order's owner is its bd_manager_id (D-0035, services/job-order-
    // visibility.js); created_by is only who typed it in, the fallback for a job
    // nobody owns yet. There is NO job_orders.owner_id — that name exists on
    // `candidates` alone, and selecting it here (R-076) took down every apply link.
    const ownerId = job.bd_manager_id || job.created_by;
    if (!ownerId) return;

    let mailbox = null;
    try { mailbox = await withTimeout(resolveMailbox(ownerId), DB_TIMEOUT_MS); } catch (_) { return; }
    if (!mailbox) return;

    // The CUSTOMER's own name, never the end client's — this goes to a stranger.
    let orgName = '';
    try {
      const o = await withTimeout(supabase.from('organizations')
        .select('name').eq('id', job.org_id).maybeSingle(), DB_TIMEOUT_MS);
      orgName = (o && o.data && o.data.name) || '';
    } catch (_) { /* a missing name costs a sign-off, not the email */ }

    // 1. the receipt
    if (applicantEmail) {
      const msg = notify.applicantReceipt({
        applicantName: staged.full_name, jobTitle: job.job_title, company: orgName,
      });
      try { await send(mailbox, applicantEmail, msg.subject, msg.html); } catch (_) { /* silent */ }
    }

    // 2. the nudge
    let ownerEmail = '';
    try {
      const u = await withTimeout(supabase.from('users')
        .select('email').eq('id', ownerId).maybeSingle(), DB_TIMEOUT_MS);
      ownerEmail = (u && u.data && u.data.email) || '';
    } catch (_) { /* no address, no nudge */ }
    if (!ownerEmail) return;

    const alert = notify.recruiterAlert({
      applicantName: staged.full_name, jobTitle: job.job_title, jobCode: job.job_code,
      client: job.client, email: staged.email, phone: staged.phone, location: staged.location,
      appUrl: process.env.APP_URL || '',
    });
    try { await send(mailbox, ownerEmail, alert.subject, alert.html); } catch (_) { /* silent */ }
  }



  // ── the page shell ────────────────────────────────────────────────────────
  // No external stylesheet, no external font, no framework. This is opened on a
  // phone over a bad connection as often as not, and an asset that fails to
  // load must not be able to make it unreadable or unusable.
  function shell({ title, lead, body, tone, noindex }) {
    const bar = tone === 'good' ? '#166534' : tone === 'quiet' ? '#64748b' : '#0f172a';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      (noindex ? '<meta name="robots" content="noindex,nofollow">' : '') +
      '<title>' + esc(title) + '</title></head>' +
      '<body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#0f172a">' +
      '<div style="max-width:620px;margin:0 auto;padding:32px 18px">' +
      '<div style="background:#fff;border-radius:14px;padding:26px 24px;box-shadow:0 1px 3px rgba(15,23,42,.12)">' +
        '<div style="height:4px;width:44px;border-radius:99px;background:' + bar + ';margin-bottom:18px"></div>' +
        '<h1 style="margin:0 0 10px;font-size:22px;line-height:1.3">' + esc(title) + '</h1>' +
        (lead ? '<div style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#475569">' + lead + '</div>' : '') +
        body +
      '</div>' +
      '<p style="margin:16px 4px 0;font-size:12px;color:#94a3b8">Your details go to the recruiting team handling this role. We do not sell or share them.</p>' +
      '</div></body></html>';
  }

  const sendPage = (res, status, html) => {
    res.status(status);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.end(html);
  };

  // Deliberately identical for a malformed token, an unknown one, a job that
  // was never published and one that was taken down. See rule 3 above.
  const gonePage = (res) => sendPage(res, 404, shell({
    title: 'This role is no longer open',
    lead: 'The link may have expired, or the position may already be filled. If someone sent you here directly, reply to them and they will point you at the current opening.',
    body: '', tone: 'quiet', noindex: true,
  }));

  const unsurePage = (res, email) => sendPage(res, 200, shell({
    title: 'We could not save that just now',
    lead: 'Something on our end is having a moment — and we would rather tell you than pretend it went through.' +
      (email ? ' Email your resume to <strong>' + esc(email) + '</strong> and it will reach the same team.'
             : ' Please try again in a minute.'),
    body: '', tone: 'quiet', noindex: true,
  }));

  // ── loading the job ───────────────────────────────────────────────────────

  async function loadJob(token) {
    // A malformed token is rejected before any query, so a scanner walking the
    // URL space costs us nothing at all.
    if (!/^[a-f0-9]{16,64}$/i.test(txt(token))) return null;
    // EVERY NAME IN THIS LIST MUST EXIST ON job_orders — one that does not fails
    // the WHOLE query (PostgREST 42703), not just that field. R-076: this used to
    // ask for `owner_id`, which job_orders never had; the owner is `bd_manager_id`.
    // Every field the handlers READ must also be asked for here: a field that is
    // not selected is not an error, it is `undefined` — which is how the applicant
    // counter (`apply_count`) was going to write "1" for every application.
    const r = await withTimeout(supabase.from('job_orders')
      .select('id,org_id,job_code,job_title,city,state,country,remote,job_type,' +
              'job_description,posting_description,client,end_client,client_manager,' +
              'primary_skills,secondary_skills,exp_min,exp_max,' +
              'pay_cur,pay_min,pay_max,status,apply_enabled,apply_token,apply_count,' +
              'bd_manager_id,created_by')
      .eq('apply_token', token).maybeSingle());
    // A FAILED query and "no such row" both leave `data` null, and the public
    // must not be able to tell either from any other miss (rule 3) — so the
    // answer below is the same null. The difference is kept for whoever has to
    // find out why a published job reads as closed (rule 5).
    const failed = queryFailure(r);
    if (failed) { noteFailure('job lookup', failed); return null; }
    const job = r.data;
    if (!job) return null;
    // Unpublished or closed reads exactly like "never existed".
    if (!job.apply_enabled) return null;
    if (job.status && !/^(active|open)$/i.test(String(job.status))) return null;
    return job;
  }

  async function orgName(orgId) {
    if (!orgId) return '';
    const r = await withTimeout(supabase.from('organizations').select('name').eq('id', orgId).maybeSingle());
    return (r && r.data && r.data.name) || '';
  }

  // The facts worth showing, each omitted when we do not have it. An empty
  // field printed as a label with nothing after it reads as a broken page.
  function jobFacts(job) {
    const out = [];
    const place = [job.city, job.state].filter(Boolean).join(', ');
    const remote = /^(yes|true|remote)$/i.test(txt(job.remote)) ? 'Remote'
                 : /hybrid/i.test(txt(job.remote)) ? 'Hybrid' : '';
    const where = [place, remote].filter(Boolean).join(' · ');
    if (where) out.push(['Location', where]);
    if (txt(job.job_type)) out.push(['Type', txt(job.job_type)]);
    const exp = [txt(job.exp_min), txt(job.exp_max)].filter(Boolean);
    if (exp.length) out.push(['Experience', exp.join('–') + ' years']);
    const skills = txt(job.primary_skills);
    if (skills) out.push(['Skills', skills]);
    return out;
  }

  // ── GET /apply/:token ─────────────────────────────────────────────────────

  router.get('/apply/:token', async (req, res) => {
    try {
      if (applyLimiter && !applyLimiter.consume(`apply-view:${clientIp(req)}`).allowed) {
        return sendPage(res, 429, shell({
          title: 'One moment',
          lead: 'Too many requests from this connection just now. Wait a few seconds and reload.',
          body: '', tone: 'quiet', noindex: true,
        }));
      }

      const job = await loadJob(txt(req.params.token));
      if (!job) return gonePage(res);

      const who = await orgName(job.org_id);
      const t = esc(txt(req.params.token));
      const facts = jobFacts(job);

      const factRows = facts.length
        ? '<table style="border-collapse:collapse;margin:0 0 20px;width:100%">' + facts.map(([k, v]) =>
            '<tr>' +
            '<td style="padding:6px 14px 6px 0;font-size:13px;color:#64748b;vertical-align:top;white-space:nowrap">' + esc(k) + '</td>' +
            '<td style="padding:6px 0;font-size:14px;color:#0f172a">' + esc(v) + '</td></tr>').join('') +
          '</table>'
        : '';

      // WHICH DESCRIPTION GOES ON A PUBLIC PAGE.
      //
      // `posting_description` is the version a recruiter wrote and read for
      // exactly this purpose, so it wins whenever it exists. Otherwise the
      // internal JD is run through the shared scrubber — the same one behind
      // the "re-write job description" button — because the internal text
      // routinely names the client, and this page publishes with nobody
      // checking the result first.
      //
      // A test caught this: the client's name was not in any FIELD we render,
      // it was in the middle of the description, and the page published it.
      const desc = txt(job.posting_description) ||
        scrubJobDescription(txt(job.job_description), clientNames(job));
      // Rendered as TEXT, never as the stored HTML. It is customer-entered and
      // this page is public; rendering it as markup would let whoever typed the
      // job description write the page.
      const descBlock = desc
        ? '<div style="margin:0 0 22px;padding-top:18px;border-top:1px solid #e2e8f0">' +
          '<div style="font-size:13px;font-weight:600;color:#475569;margin-bottom:8px">About the role</div>' +
          '<div style="font-size:14px;line-height:1.6;color:#334155;white-space:pre-wrap">' +
            esc(desc.slice(0, 6000)) + '</div></div>'
        : '';

      const field = (name, label, type, required, placeholder) =>
        '<label style="display:block;margin:0 0 14px">' +
          '<span style="display:block;font-size:13px;font-weight:600;color:#334155;margin-bottom:5px">' +
            esc(label) + (required ? '' : ' <span style="font-weight:400;color:#94a3b8">(optional)</span>') + '</span>' +
          '<input name="' + esc(name) + '" type="' + esc(type) + '"' + (required ? ' required' : '') +
            (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') +
            // 16px so iOS does not zoom the page on focus and never zoom back.
            ' style="width:100%;box-sizing:border-box;font-family:inherit;font-size:16px;padding:11px 12px;' +
            'border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#0f172a">' +
        '</label>';

      const form =
        '<form id="af" style="margin:0">' +
          field('full_name', 'Your name', 'text', true, '') +
          field('email', 'Email', 'email', true, '') +
          field('phone', 'Phone', 'tel', false, '') +
          field('location', 'Where are you based?', 'text', false, 'City, State') +
          '<label style="display:block;margin:0 0 14px">' +
            '<span style="display:block;font-size:13px;font-weight:600;color:#334155;margin-bottom:5px">Your resume</span>' +
            '<input id="af-file" name="resume" type="file" required accept=".pdf,.doc,.docx,.txt,.rtf" ' +
              'style="width:100%;box-sizing:border-box;font-family:inherit;font-size:14px;padding:10px;' +
              'border:1px dashed #cbd5e1;border-radius:9px;background:#f8fafc;color:#334155">' +
            '<span style="display:block;font-size:12px;color:#94a3b8;margin-top:5px">PDF or Word, up to 3 MB.</span>' +
          '</label>' +
          '<label style="display:block;margin:0 0 18px">' +
            '<span style="display:block;font-size:13px;font-weight:600;color:#334155;margin-bottom:5px">' +
              'Anything you want us to know <span style="font-weight:400;color:#94a3b8">(optional)</span></span>' +
            '<textarea name="note" rows="3" style="width:100%;box-sizing:border-box;font-family:inherit;font-size:16px;' +
              'padding:11px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#0f172a;resize:vertical"></textarea>' +
          '</label>' +
          '<div id="af-err" style="display:none;margin:0 0 14px;padding:11px 13px;background:#fef2f2;border-radius:9px;' +
            'font-size:14px;color:#991b1b"></div>' +
          '<button id="af-go" type="submit" style="width:100%;cursor:pointer;font-family:inherit;font-size:16px;' +
            'font-weight:600;padding:14px 22px;border-radius:9px;border:1px solid #166534;background:#166534;color:#fff">' +
            'Send my application</button>' +
          '<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#94a3b8">' +
            'By applying you agree that we may keep your details on file and contact you about this and similar roles. ' +
            'You can ask us to remove them at any time.</p>' +
        '</form>';

      // The only script on the page: read the file, post JSON, show the answer.
      // Written plainly because a build step does not exist in this project and
      // this page must work standalone.
      const script =
        '<script>(function(){' +
        'var f=document.getElementById("af"),b=document.getElementById("af-go"),e=document.getElementById("af-err");' +
        'function fail(m){e.textContent=m;e.style.display="block";b.disabled=false;b.textContent="Send my application";}' +
        'f.addEventListener("submit",function(ev){ev.preventDefault();e.style.display="none";' +
        'var file=document.getElementById("af-file").files[0];' +
        'if(!file){return fail("Please attach your resume.");}' +
        'if(file.size>' + MAX_RESUME_BYTES + '){return fail("That file is larger than 3 MB. Please attach a smaller one.");}' +
        'b.disabled=true;b.textContent="Sending…";' +
        'var r=new FileReader();' +
        'r.onerror=function(){fail("We could not read that file. Try a different one.");};' +
        'r.onload=function(){' +
        'var d=new FormData(f),p={};d.forEach(function(v,k){if(k!=="resume")p[k]=v;});' +
        'p.filename=file.name;p.content_type=file.type||"application/octet-stream";' +
        'p.data_base64=String(r.result).split(",").pop();' +
        'fetch("/apply/' + t + '",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)})' +
        '.then(function(x){return x.json().then(function(j){return{ok:x.ok,j:j};});})' +
        '.then(function(o){if(o.ok&&o.j&&o.j.received){document.body.innerHTML=o.j.html;}' +
        'else{fail((o.j&&o.j.error)||"We could not save that just now. Please try again in a minute.");}})' +
        '.catch(function(){fail("We could not reach our server. Check your connection and try again.");});' +
        '};r.readAsDataURL(file);});' +
        '})();</script>';

      const place = [job.city, job.state].filter(Boolean).join(', ');
      sendPage(res, 200, shell({
        title: txt(job.job_title) || 'Open role',
        // Rule 4: the ORG is named as the one hiring. The client never is.
        lead: (who ? '<strong style="color:#0f172a">' + esc(who) + '</strong>' : 'We are') +
              ' hiring' + (place ? ' in ' + esc(place) : '') + '.',
        tone: 'good',
        body: factRows + descBlock +
          '<div style="padding-top:18px;border-top:1px solid #e2e8f0">' +
          '<div style="font-size:15px;font-weight:600;margin:0 0 14px">Apply</div>' + form + '</div>' + script,
      }));
    } catch (err) {
      // Same answer as any miss — but an exception while DRAWING a published
      // job's page is a bug, not a closed role, and must not vanish (rule 5).
      noteFailure('GET /apply/:token', err);
      gonePage(res);
    }
  });

  // ── POST /apply/:token ────────────────────────────────────────────────────

  router.post('/apply/:token', async (req, res) => {
    const fail = (status, error) => res.status(status).json({ error });
    try {
      // Tighter than the page view: one person applying is a handful of
      // requests, and this endpoint writes to storage and parses a PDF.
      if (applyLimiter && !applyLimiter.consume(`apply-post:${clientIp(req)}`).allowed) {
        return fail(429, 'Too many applications from this connection just now. Please wait a minute and try again.');
      }

      const token = txt(req.params.token);
      const job = await loadJob(token);
      if (!job) return fail(404, 'This role is no longer open.');

      const b = req.body || {};
      const fullName = txt(b.full_name).slice(0, 120);
      const email = txt(b.email).slice(0, 160).toLowerCase();
      if (!fullName) return fail(400, 'Please tell us your name.');
      if (!emailSyntaxValid(email)) return fail(400, 'That email address does not look right.');

      const raw = txt(b.data_base64).replace(/^data:[^,]*;base64,/, '');
      if (!raw) return fail(400, 'Please attach your resume.');
      let buffer;
      try { buffer = Buffer.from(raw, 'base64'); } catch (_) { buffer = null; }
      if (!buffer || !buffer.length) return fail(400, 'We could not read that file. Try a different one.');
      if (buffer.length > MAX_RESUME_BYTES) return fail(413, 'That file is larger than 3 MB. Please attach a smaller one.');

      const filename = txt(b.filename).slice(0, 160) || 'resume';
      const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
      const path = 'apply/' + token + '/' + Date.now() + '-' + safe;

      // The resume is stored BEFORE anything else, because it is the one part
      // of an application we cannot ask the person to produce again. A parse
      // failure must never cost us the file.
      const up = await withTimeout(supabase.storage.from(DOC_BUCKET)
        .upload(path, buffer, { contentType: txt(b.content_type) || 'application/octet-stream', upsert: false }), 8000);
      // queryFailure(), not `up === undefined || up.error`: an upload that THREW
      // comes back as null, which that condition read as success — an
      // application staged against a file that was never stored (rule 2).
      const upFailed = queryFailure(up, 8000);
      if (upFailed) {
        noteFailure('resume upload', upFailed);
        return fail(503, 'We could not save your resume just now. Please try again in a minute.');
      }

      // Parsing is a BONUS, never a gate. A resume this reader cannot open is
      // still a real person applying for a real job, and a recruiter can open
      // the file by hand. Failing the application over it would be absurd.
      let parsed = null;
      try {
        const p = await Promise.race([
          parseResume(buffer, filename, supabase, job.org_id).catch(() => null),
          new Promise(r => setTimeout(() => r(null), 12000)),
        ]);
        parsed = p && typeof p === 'object' ? p : null;
      } catch (_) { parsed = null; }

      const pick = (...keys) => {
        for (const k of keys) { const v = parsed && txt(parsed[k]); if (v) return v; }
        return '';
      };
      const phone = txt(b.phone).slice(0, 60) || pick('phone');
      const location = txt(b.location).slice(0, 160) || pick('location', 'city');

      // Flag an existing candidate rather than blocking the application. Someone
      // already in the database applying again is INFORMATION — usually that
      // they are newly available — and turning them away at the door would be
      // the worst possible use of it. Org-scoped: an applicant to one customer
      // must never be matched against another customer's people.
      let dupId = null;
      try {
        const d = await withTimeout(supabase.from('candidates')
          .select('id').eq('org_id', job.org_id).is('deleted_at', null)
          .ilike('email', email).limit(1).maybeSingle());
        if (d && d.data) dupId = d.data.id;
      } catch (_) { /* a missed flag costs a duplicate, not an application */ }

      const row = {
        org_id: job.org_id,
        provider: 'apply',
        external_id: null,
        full_name: fullName,
        email,
        phone: phone || null,
        location: location || null,
        current_title: pick('current_title', 'title') || null,
        current_employer: pick('current_employer', 'employer') || null,
        skills: pick('skills') || null,
        experience_years: parsed && isFinite(parseFloat(parsed.experience_years))
          ? parseFloat(parsed.experience_years) : null,
        resume_url: path,
        status: 'new',
        dup_candidate_id: dupId,
        created_by: null,
        raw: {
          applied_to_job_order_id: job.id,
          applied_to_job_code: job.job_code || null,
          applied_to_job_title: job.job_title || null,
          note: txt(b.note).slice(0, 2000) || null,
          resume_filename: filename,
          resume_bytes: buffer.length,
          resume_parsed: !!parsed,
          applied_at: new Date().toISOString(),
        },
      };

      const ins = await withTimeout(supabase.from('sourcing_candidates').insert(row).select('id').single());
      // RULE 2. If the row did not land, say so. An applicant who is told
      // "thanks, we have it" when we do not will never apply again.
      // (Recorded too, rule 5: the first real application is the first time this
      // insert has ever run against production, so a schema fault would otherwise
      // read to the applicant, and to us, as nothing more than "try again".)
      const insFailed = queryFailure(ins) ||
        (ins.data ? null : { code: 'no_row', message: 'the insert answered without a row' });
      if (insFailed) {
        noteFailure('application insert', insFailed);
        return res.status(200).json({ received: false, error: 'We could not save that just now. Please try again in a minute.' });
      }

      // Best-effort counter for the recruiter's "12 applicants" badge. It must
      // never be the reason an application fails, so it is fire-and-forget.
      // (Read-modify-write off the count loadJob fetched, so two applicants in the
      // same instant can both write N+1. Accepted: it is a badge, not a ledger.)
      try {
        const bumped = await withTimeout(supabase.from('job_orders')
          .update({ apply_count: (job.apply_count || 0) + 1 }).eq('id', job.id), 1500);
        const bumpFailed = queryFailure(bumped, 1500);
        if (bumpFailed) noteFailure('apply_count update', bumpFailed);
      } catch (_) { /* a wrong badge is not worth a failed application */ }

      const who = await orgName(job.org_id);
      // ── tell the applicant, and tell the recruiter ────────────────────
      // BEST-EFFORT AND NEVER AWAITED. A stranger's application must not be
      // held open — or worse, reported as failed — because a mailbox is
      // disconnected or a provider is slow. The row is already saved; this is
      // courtesy on top of it, and it is allowed to fail silently.
      //
      // It runs AFTER the insert succeeded, deliberately: an email saying "we
      // have your application" when we do not is the same lie as a success
      // page over a failed write.
      try { notifyOnApplication(job, row, txt(b.email)); } catch (_) { /* never blocks */ }

      return res.status(201).json({
        received: true,
        html: '<div style="max-width:620px;margin:0 auto;padding:32px 18px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif">' +
          '<div style="background:#fff;border-radius:14px;padding:26px 24px;box-shadow:0 1px 3px rgba(15,23,42,.12)">' +
          '<div style="height:4px;width:44px;border-radius:99px;background:#166534;margin-bottom:18px"></div>' +
          '<h1 style="margin:0 0 10px;font-size:22px;color:#0f172a">Thanks — we have your application</h1>' +
          '<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#475569">' +
            'A recruiter' + (who ? ' at ' + esc(who) : '') + ' will read it and get back to you if it looks like a fit. ' +
            'We have your resume and your email — you do not need to send it again.</p>' +
          '<p style="margin:0;font-size:14px;color:#64748b">You can close this page.</p>' +
          '</div></div>',
      });
    } catch (err) {
      // The applicant is told the truth (rule 2); the operator is told why (rule 5).
      noteFailure('POST /apply/:token', err);
      return res.status(200).json({ received: false, error: 'We could not save that just now. Please try again in a minute.' });
    }
  });

  return router;
};

// The two pure rules are callable, so a test can pin them directly rather than
// by grepping this file for text (which cannot tell a live rule from a dead one).
module.exports.queryFailure = queryFailure;
module.exports.describeFailure = describeFailure;
