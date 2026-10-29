// ASSIGNING LEADS, 29 Oct 2026 (owner): choose the email IDs the new leads go out from, seeing each one's queue; assign the
// next set without waiting; two assignments back to back never share a lead; the numbers update by themselves.
import fs from 'node:fs';
const results = [];
const step = (n, ok) => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n); };
const idx = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const exec = idx.slice(idx.indexOf("app.post('/distribute/execute'"), idx.indexOf('// /distribute/pool-stats + /distribute/today-summary'));
const dist = fs.readFileSync(new URL('../routes/distribution.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../public/js/19-distribution.js', import.meta.url), 'utf8');
const assign = fs.readFileSync(new URL('../public/js/21-assign-leads.js', import.meta.url), 'utf8');

step('a lead is taken only while it is still unassigned', /\.eq\('stage', 'Unassigned'\)\.is\('assigned_to_bd', null\)\.select\('id'\)/.test(exec));
step('one write per email ID, not one per lead', /for \(const emailId of Object\.keys\(byBox\)\)/.test(exec) && !/\.eq\('id', job\.id\);\n\s*assignedLeads\.push/.test(exec));
step('only the leads really taken get follow-ups and the send', /if \(!takenIds\.has\(selected\[i\]\.id\)\) selected\.splice\(i, 1\)/.test(exec));
step('the chosen email IDs limit where the leads go', /req\.body\.email_ids[\s\S]{0,300}accounts = accounts\.filter/.test(exec));
step('GET /distribute/mailboxes answers room, queue and due-today per email ID', /router\.get\('\/distribute\/mailboxes'/.test(dist) && /due_today_not_queued/.test(dist) && /free_today/.test(dist));
step('…only for a manager in the caller\'s company', /withOrg\(supabase\.from\('users'\)\.select\('id'\)\.eq\('id', managerId\), req\)\.maybeSingle\(\);\s*if \(!who\) return res\.status\(404\)/.test(dist));
step('the window lists them with a tick each', /function paintAssignBoxes\(\)/.test(page) && /toggleAssignBox/.test(page));
step('the window does not jump to the Email page after assigning', !/STATE\.page='email'; \/\/ go to email page/.test(page));
step('the pool refreshes itself on Assign Leads', /function startAssignPoolPoll\(\)/.test(page) && /startAssignPoolPoll\(\);/.test(assign));

const failed = results.filter(x => !x).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
