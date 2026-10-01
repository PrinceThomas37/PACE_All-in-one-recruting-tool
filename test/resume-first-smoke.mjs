// A CANDIDATE OPENS ON THE RESUME, AND THE RESUME ACTUALLY SHOWS (R-091, owner 2026-09-30).
// "First thing to preview and then the activity… multiple refresh is needed for resume to get
// downloaded… no resume preview… when the candidate is clicked, their resume should be the first thing."
//   * the file is read through PACE (GET /candidates/:id/documents/:docId/file), asking the bucket
//     up to three times, instead of from a signed link that came back empty on a bad second;
//   * only a PDF is ever sent inline — an uploaded .html is a download, never run from PACE's address;
//   * the profile opens on the Resume tab (and it is the first tab) when there is a resume;
//   * a hiccup loading the document list is retried and, if it still fails, says so with Try again;
//   * a failed file shows a sentence and Try again, then works on the second press.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { enterApp, waitForLogin } from './helpers/enter-app.mjs';
const require = createRequire(import.meta.url);
const results=[]; const step=(n,ok,d='')=>{results.push(!!ok);console.log((ok?'[PASS] ':'[FAIL] ')+n+(d?' — '+d:''));};

// ── 1. the patient reader ────────────────────────────────────────────────────
const { fetchStored, docContentType } = require('../services/doc-fetch');
const noWait = () => Promise.resolve();
{
  let calls = 0;
  const flaky = { from: () => ({ download: async () => (++calls < 3 ? { data: null, error: { message: 'fetch failed' } } : { data: Buffer.from('%PDF-1.4 ok'), error: null }) }) };
  const r = await fetchStored(flaky, 'b', 'p', { wait: noWait });
  step('a bucket that fails twice and then answers still gives the file', r.ok && calls === 3 && String(r.buffer).startsWith('%PDF'), 'calls=' + calls);
  let c2 = 0;
  const gone = { from: () => ({ download: async () => { c2++; return { data: null, error: { message: 'Object not found' } }; } }) };
  const g = await fetchStored(gone, 'b', 'p', { wait: noWait });
  step('"no such file" is reported as missing and is not retried', !g.ok && g.missing && c2 === 1, 'calls=' + c2);
  let c3 = 0;
  const down = { from: () => ({ download: async () => { c3++; return { data: null, error: { message: 'timeout' } }; } }) };
  const d = await fetchStored(down, 'b', 'p', { wait: noWait });
  step('a bucket that stays down is reported as temporary after three tries', !d.ok && !d.missing && c3 === 3, 'calls=' + c3);
  step('content type falls back to the extension', docContentType({ filename: 'A.PDF' }) === 'application/pdf' && docContentType({ filename: 'a.docx', content_type: 'application/octet-stream' }).includes('wordprocessingml'));
}

// ── 2. the endpoint ──────────────────────────────────────────────────────────
const express = require('express');
function chain(result) { const o = {}; ['select', 'eq', 'is', 'order'].forEach(k => { o[k] = () => o; }); o.maybeSingle = async () => result; o.single = async () => result; return o; }
const DOCS = {
  pdf:  { id: 'd1', filename: 'Sarah.pdf',  content_type: 'application/pdf', storage_path: 'c1/a.pdf', doc_type: 'resume' },
  html: { id: 'd2', filename: 'evil.html',  content_type: 'text/html',       storage_path: 'c1/b.html', doc_type: 'resume' },
  gone: { id: 'd3', filename: 'old.pdf',    content_type: 'application/pdf', storage_path: 'c1/c.pdf', doc_type: 'resume' },
};
let downloadFails = 0;
const supabase = {
  from: (t) => t === 'candidates' ? chain({ data: { id: 'c1', org_id: 'o1' }, error: null })
    : chain({ data: null, error: null, __t: t }),
  storage: { from: () => ({ download: async (p) => {
    if (p === 'c1/c.pdf') return { data: null, error: { message: 'Object not found' } };
    if (downloadFails > 0) { downloadFails--; return { data: null, error: { message: 'fetch failed' } }; }
    return { data: Buffer.from(p.endsWith('.html') ? '<script>alert(1)</script>' : '%PDF-1.4 hello'), error: null };
  } }) },
};
// the document row lookup returns whichever doc the URL asks for
supabase.from = ((orig) => (t) => {
  if (t !== 'candidate_documents') return orig(t);
  const o = {}; let id = null;
  ['select', 'is'].forEach(k => { o[k] = () => o; });
  o.eq = (col, v) => { if (col === 'id') id = v; return o; };
  o.maybeSingle = async () => ({ data: Object.values(DOCS).find(d => d.id === id) || null, error: null });
  return o;
})(supabase.from);
const app = express();
const auth = (req, res, next) => { req.user = { id: 'u1', org_id: 'o1' }; next(); };
const core = { supabase, auth, orgIdFor: () => 'o1', orgStamp: () => ({}), withOrg: (q) => q, db: {}, hasRole: () => true };
// the module destructures a long list of helpers; undefined ones are fine for this route
try { require('../routes/recruiting/candidates')(app, new Proxy(core, { get: (t, k) => (k in t ? t[k] : (k === 'STAGES' ? [] : undefined)) })); }
catch (e) { step('candidates routes mount in the test harness', false, e.message); }
const srv = await new Promise(r => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
const API = 'http://127.0.0.1:' + srv.address().port;
{
  const r = await fetch(API + '/candidates/c1/documents/d1/file');
  const t = Buffer.from(await r.arrayBuffer()).toString();
  step('a PDF comes back as an inline PDF', r.status === 200 && /application\/pdf/.test(r.headers.get('content-type')) && /^inline/.test(r.headers.get('content-disposition')) && t.startsWith('%PDF'), r.status + ' ' + r.headers.get('content-disposition'));
  downloadFails = 2;
  const r2 = await fetch(API + '/candidates/c1/documents/d1/file');
  step('two bad seconds from storage are absorbed — still 200, no refresh needed', r2.status === 200, String(r2.status));
  downloadFails = 99;
  const r3 = await fetch(API + '/candidates/c1/documents/d1/file'); downloadFails = 0;
  step('storage down for good → 503 with a "try again" sentence', r3.status === 503 && /try again/i.test((await r3.json()).error), String(r3.status));
  const r4 = await fetch(API + '/candidates/c1/documents/d3/file');
  step('a file missing from storage → 404 saying so', r4.status === 404 && /no longer in storage/i.test((await r4.json()).error), String(r4.status));
  const r5 = await fetch(API + '/candidates/c1/documents/nope/file');
  step('an unknown document id → 404', r5.status === 404, String(r5.status));
  const r6 = await fetch(API + '/candidates/c1/documents/d2/file');
  step('an uploaded .html is a download, never shown inline', r6.status === 200 && /^attachment/.test(r6.headers.get('content-disposition')) && !/html/.test(r6.headers.get('content-type')), r6.headers.get('content-type') + ' | ' + r6.headers.get('content-disposition'));
}
srv.close();

// ── 3. the screen ────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.resolve(new URL('../public', import.meta.url).pathname);
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(PUBLIC_DIR,p),(e,d)=>{ if(e){res.writeHead(404);return res.end('nf');} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d); }); });
const PORT = await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const BASE=`http://127.0.0.1:${PORT}`;
function findChromium(){ if(process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM; const b=process.env.PLAYWRIGHT_BROWSERS_PATH; if(b&&fs.existsSync(path.join(b,'chromium'))) return path.join(b,'chromium'); return 'chromium'; }
let browser; const errs=[];
try{
  browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext(); await ctx.route('**',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  const page=await ctx.newPage(); page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/'); await waitForLogin(page); await enterApp(page,'bd');
  const ev=(f,a)=>page.evaluate(f,a);
  // Open a candidate through the real opener with a fake API.
  const open = (opts) => ev(async (o) => {
    let fileTries = 0, docTries = 0;
    window.apiGet = (u) => {
      if (/\/documents$/.test(u)) { docTries++; if (o.docsFailTimes >= docTries) return Promise.reject(new Error('boom')); return Promise.resolve(o.docs); }
      if (/\/history$/.test(u)) return Promise.resolve({ pipeline: [], submissions: [], activity: [] });
      if (/\/(notes|email-activity)$/.test(u)) return Promise.resolve([]);
      return Promise.resolve({ id: 'c1', full_name: 'Sarah Chen', resume_text: o.text || null });
    };
    window.fetch = (u) => { fileTries++; if (fileTries <= o.fileFailTimes) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: 'The file could not be read just now. Please try again.' }) });
      return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['%PDF-1.4 x'], { type: 'application/pdf' })) }); };
    STATE.bd = STATE.bd || {}; STATE.bd.jobOrders = STATE.bd.jobOrders || [];
    bdOpenCandidate('c1');
    await new Promise(r => setTimeout(r, 1500));
    return { fileTries, docTries };
  }, opts);
  const snap = () => ev(() => {
    const tabs = [...document.querySelectorAll('[data-cptab]')].map(e => e.getAttribute('data-cptab'));
    const on = (document.querySelector('[data-cptab].on') || {}).getAttribute && document.querySelector('[data-cptab].on').getAttribute('data-cptab');
    const panel = document.querySelector('[data-cppanel="resume"]');
    const card = document.querySelector('[data-cpresume]');
    const frame = document.querySelector('[data-cpresume-frame]');
    return { tabs, on, resumeVisible: !!panel && !panel.hidden, frame: !!frame, frameSrc: frame ? frame.src : '', dl: !!document.querySelector('[data-cpresume-dl]'), cardText: card ? card.textContent : null };
  });

  await open({ docs: [{ id: 'd1', doc_type: 'resume', filename: 'Sarah.pdf', content_type: 'application/pdf' }], fileFailTimes: 0, docsFailTimes: 0 });
  let s = await snap();
  step('the Resume tab is the first tab', s.tabs[0] === 'resume', JSON.stringify(s.tabs));
  step('the profile opens ON the Resume tab, showing it', s.on === 'resume' && s.resumeVisible, s.on);
  step('the PDF preview is on screen and has a Download', s.frame && /^blob:/.test(s.frameSrc) && s.dl, JSON.stringify(s));

  await open({ docs: [{ id: 'd1', doc_type: 'resume', filename: 'Sarah.pdf', content_type: 'application/pdf' }], fileFailTimes: 1, docsFailTimes: 0 });
  s = await snap();
  step('a failed file says so and offers Try again — no preview yet', !s.frame && /Try again/.test(s.cardText || ''), s.cardText);
  await ev(async () => { cpLoadResume(true); await new Promise(r => setTimeout(r, 600)); });
  s = await snap();
  step('pressing Try again brings the preview, without reloading the page', s.frame && s.dl);

  await open({ docs: [{ id: 'd1', doc_type: 'resume', filename: 'Sarah.pdf', content_type: 'application/pdf' }], fileFailTimes: 0, docsFailTimes: 1 });
  s = await snap();
  step('one failed document-list call is retried — the resume still appears', s.frame, JSON.stringify(s));

  await open({ docs: [], fileFailTimes: 0, docsFailTimes: 2 });
  s = await snap();
  step('if the list keeps failing the Resume card says so, with Try again', /documents could not be loaded/i.test(s.cardText || '') && /Try again/.test(s.cardText || ''), s.cardText);

  await open({ docs: [{ id: 'd9', doc_type: 'resume', filename: 'Sarah.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }], text: 'Sarah Chen — 8 years estimating', fileFailTimes: 0, docsFailTimes: 0 });
  s = await snap();
  step('a Word résumé shows its text and offers Download', !s.frame && /8 years estimating/.test(s.cardText || '') && s.dl);

  await open({ docs: [], fileFailTimes: 0, docsFailTimes: 0 });
  s = await snap();
  step('no résumé at all → opens on Activity as before', s.on === 'activity', s.on);
  step('No page errors', errs.length===0, errs.join('|'));
}catch(e){ console.log('[FAIL] crashed — '+(e&&e.stack||e)); results.push(false); }
finally{ if(browser) await browser.close(); server.close(); }
const pass=results.filter(Boolean).length; console.log('\nSUMMARY: '+pass+'/'+results.length+' passed'); process.exit(pass===results.length&&results.length>0?0:1);
