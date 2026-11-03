// FIRST-EMAIL REPLY RATE, AI vs TEMPLATE, BEFORE/AFTER (R-343 step C, owner 3 Nov 2026). The report that says whether replies
// dropped after the switch (October: AI 1.23 % vs template 0.54 %). Pure counting, plus the route's wiring and scope.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const f = require('../services/first-email-replies.js');
const results = [];
const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };

const rows = [
  { sent_at: '2026-10-26T10:00:00Z', template_variant: 'ai', replied_at: '2026-10-27T00:00:00Z' },
  { sent_at: '2026-10-26T11:00:00Z', template_variant: 'ai' },
  { sent_at: '2026-10-27T11:00:00Z', template_variant: null },
  { sent_at: '2026-11-04T11:00:00Z', template_variant: 'own_v2', replied_at: '2026-11-05T00:00:00Z' },
  { sent_at: '2026-11-04T12:00:00Z', template_variant: null, replied_at: '2026-10-01T00:00:00Z' },   // replied BEFORE this email
];
const o = f.report(rows, '2026-11-04');
const w1 = o.weeks.find((w) => w.week === '2026-10-26');
step('a week counts first emails, replies, and splits AI-written from template', w1 && w1.sent === 3 && w1.ai_sent === 2 && w1.ai_replied === 1 && w1.tpl_sent === 1 && w1.tpl_replied === 0, JSON.stringify(w1));
step('a reply from before the email is not a reply to it', o.weeks.find((w) => w.week === '2026-11-02').replied === 1);
step('a version (own_v2) counts as template, not AI', o.after.tpl_sent === 2 && o.after.ai_sent === 0);
step('before / after the switch date', o.before.sent === 3 && o.after.sent === 2 && o.before.ai_rate === 50 && o.after.rate === 50, JSON.stringify({ b: o.before, a: o.after }));
step('nothing under a rate → null ("—"), never 0 %', o.after.ai_rate === null && f.report([], null).total.rate === null);
step('no switch date yet → no before/after (never a made-up split)', f.report(rows, null).before === null);

const src = fs.readFileSync(new URL('../routes/workflows.js', import.meta.url), 'utf8');
const route = src.slice(src.indexOf("router.get('/insights/first-email-replies'"), src.indexOf("// R-316: the people behind one number"));
step('the route counts only SENT FIRST emails, every page, in this company', /eq\('status', 'sent'\)\.is\('followup_type', null\)/.test(route) && /fetchAll\(/.test(route) && /eq\('org_id', req\.orgId\)/.test(route));
step('…an admin sees the company, anyone else their own and their team\'s (D-0034)', /hasRole\(req, 'admin'\) \? null : \[req\.user\.id\]\.concat\(await reportingChainIds/.test(route) && /in\('sent_by', who\)/.test(route));
const ui = fs.readFileSync(new URL('../public/js/16-insights.js', import.meta.url), 'utf8');
step('the card is on Outreach Insights', /firstReplyCard\(\)\+'<\/div>';/.test(ui) && /first-email-replies\?days=90/.test(ui));

const pass = results.filter(Boolean).length;
console.log(`\nSUMMARY: ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
