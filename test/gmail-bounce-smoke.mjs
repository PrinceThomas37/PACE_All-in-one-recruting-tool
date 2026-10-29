// BOUNCES THAT LAND IN A GMAIL MAILBOX MARK THE ADDRESS INVALID (R-314, 26 Oct).
//
// The colleague's question: "when an undelivered email reaches the mailbox or spam, can the email status change
// automatically?" Outlook and app-password mailboxes already did; Gmail was never read for bounces. Here the REAL rule
// (index.js isNdrMessage / extractBounceRecipients / markBouncesFromMessages, lifted out of the source) is run over a
// Gmail bounce shaped by the REAL gmail-provider normalizeMessage, through services/gmail-bounce.js:
//   · Gmail is asked for bounce-looking mail newer than the last visit, Spam included;
//   · the bounced address's contact becomes Invalid — only in THIS mailbox's company;
//   · an ordinary reply that slips through the search marks nothing; an unreadable message does not end the sweep;
//   · the "last visit" moves to the newest message read.
// Usage: node test/gmail-bounce-smoke.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createFakeDb, uid } from './helpers/fake-postgrest.mjs';
const require = createRequire(import.meta.url);
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const pick = (re) => { const m = src.match(re); return m ? m[0] : null; };
const parts = [
  pick(/function isNdrMessage\([\s\S]*?\n\}\n/),
  pick(/function isWarmupMessage\([\s\S]*?\n\}\n/),
  pick(/function extractBounceRecipients\([\s\S]*?\n\}\n/),
  pick(/async function markBouncesFromMessages\([\s\S]*?\n\}\n/),
];
step('index.js still defines the bounce rule the Gmail sweep hands to', parts.every(Boolean));
step('index.js runs the Gmail bounce sweep inside runBounceSweep', /async function runBounceSweep\(\)[\s\S]*?gmailBounce\.sweepGmailBounces\(/.test(src));

const ORG = 'org-a', OTHER = 'org-b';
const tables = {
  contacts: [
    { id: uid(), org_id: ORG, job_id: 'job-1', email: 'gone@deadco.com', email_status: 'valid' },
    { id: uid(), org_id: OTHER, job_id: 'job-9', email: 'gone@deadco.com', email_status: 'valid' },   // another company's
    { id: uid(), org_id: ORG, job_id: 'job-2', email: 'alive@liveco.com', email_status: 'valid' },
  ],
  app_settings: [],
};
const fake = createFakeDb({ tables });
const forOrg = (orgId) => ({ from: (t) => {
  const q = fake.supabase.from(t);
  const select = q.select.bind(q), update = q.update.bind(q);
  q.select = (...a) => select(...a).eq('org_id', orgId);
  q.update = (p) => update(p).eq('org_id', orgId);
  return q;
} });
const log = { activity: [], emitted: [] };
const deps = {
  WARMUP_HEADER: 'X-Fute-Warmup', DEFAULT_ORG_ID: null, db: { forOrg },
  bounceMark: require('../services/bounce-mark.js'), bounceKind: require('../services/bounce-kind.js'), contactStatusRules: require('../services/contact-status.js'),
  emit: (e) => log.emitted.push(e), EVENTS: { EMAIL_BOUNCED: 'EMAIL_BOUNCED', CONTACT_INVALIDATED: 'CONTACT_INVALIDATED' },
  logActivity: async (job, contact, user, type, text) => log.activity.push({ job, type, text }),
};
const names = Object.keys(deps);
const markBouncesFromMessages = new Function(...names, parts.join('\n') + '\nreturn markBouncesFromMessages;')(...names.map((k) => deps[k]));

// A Gmail bounce as Gmail's API returns it, normalised by the real provider code.
const { createGmailProvider } = require('../gmail-provider.js');
const real = createGmailProvider({ supabase: null, google: {} });
const b64 = (t) => Buffer.from(t).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const raw = (id, ms, from, subject, text) => ({ id, threadId: 't' + id, internalDate: String(ms), snippet: text.slice(0, 80),
  payload: { mimeType: 'multipart/report', headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }],
    parts: [{ mimeType: 'text/plain', body: { data: b64(text) } }] } });
const T0 = Date.parse('2026-10-26T08:00:00Z');
const MAIL = {
  m1: raw('m1', T0 + 60000, 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', 'Delivery Status Notification (Failure)',
    "** Address not found **\n\nYour message wasn't delivered to gone@deadco.com because the address couldn't be found.\n\nFrom: prince.thomas@futeglobal.com"),
  m2: raw('m2', T0 + 120000, 'Dana Reyes <alive@liveco.com>', 'Re: returned mail question', 'Thanks — send the profiles.'),
  bad: null,
};
const asked = [];
const gmailProvider = {
  isConfigured: () => true,
  listMessagePage: async (id, opts) => { asked.push(opts); return { messages: [{ id: 'm1' }, { id: 'bad' }, { id: 'm2' }] }; },
  getMessage: async (id, mid) => { if (!MAIL[mid]) throw new Error('404'); return MAIL[mid]; },
  normalizeMessage: real.normalizeMessage,
};
tables.app_settings.push({ key: 'bounce_sweep_since_ue-1', value: new Date(T0).toISOString() });

const { sweepGmailBounces, NDR_QUERY } = require('../services/gmail-bounce.js');
const tokenRow = { user_email_id: 'ue-1', email_address: 'prince.thomas@futeglobal.com', org_id: ORG };
const own = new Set(['prince.thomas@futeglobal.com']);
const r = await sweepGmailBounces({ gmailProvider, supabase: fake.supabase, tokenRow, ownAddresses: own, markBouncesFromMessages, now: () => new Date(T0 + 3600000) });

step('Gmail is asked only for bounce-looking mail newer than the last visit — Spam included', asked.length === 1 && asked[0].includeSpamTrash === true
  && asked[0].q.startsWith(`after:${Math.floor(T0 / 1000)} `) && asked[0].q.includes(NDR_QUERY) && /mailer-daemon/.test(NDR_QUERY), JSON.stringify(asked[0]));
const st = (email, org) => tables.contacts.find((c) => c.email === email && c.org_id === org).email_status;
step('the bounced address is now Invalid for this mailbox\'s company', st('gone@deadco.com', ORG) === 'invalid' && r.marked === 1, 'marked=' + r.marked);
step('…and NOT in another company that holds the same address (R-243)', st('gone@deadco.com', OTHER) === 'valid');
step('an ordinary reply that matched the search marks nothing', st('alive@liveco.com', ORG) === 'valid');
step('our own address in the quoted original is never marked', !tables.contacts.some((c) => c.email === 'prince.thomas@futeglobal.com'));
step('the history says why (bounce read from the Gmail mailbox)', log.activity.some((a) => a.type === 'email_bounced' && /gone@deadco\.com/.test(a.text)) && log.emitted.includes('EMAIL_BOUNCED'));
step('an unreadable message did not end the sweep (the one after it was still read)', r.read === 2);
const since = tables.app_settings.find((x) => x.key === 'bounce_sweep_since_ue-1').value;
step('the last visit moves to the newest message read', since === new Date(T0 + 120000).toISOString(), since);

// A second pass over the same mail changes nothing (everything is older than the last visit now).
const r2 = await sweepGmailBounces({ gmailProvider, supabase: fake.supabase, tokenRow, ownAddresses: own, markBouncesFromMessages });
step('a second pass over the same mail marks nothing again', r2.marked === 0 && r2.read === 0);
const off = await sweepGmailBounces({ gmailProvider: { isConfigured: () => false }, supabase: fake.supabase, tokenRow, ownAddresses: own, markBouncesFromMessages });
step('with Google not configured the sweep does nothing (and does not throw)', off.marked === 0);

const failed = results.filter((x) => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
