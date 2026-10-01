// OUT OF OFFICE ENDS ON THE RETURN DATE (R-080, D-0066, owner 2026-10-01: "yes it should change back").
//   * a contact out of office until a date that has ARRIVED (today or earlier) is set back to Valid and the date cleared;
//   * a future return date is left alone; a contact with no readable date is left alone;
//   * invalid / deactivated / valid contacts are never touched (a bounced address is not fixed by a holiday ending);
//   * the update re-checks the status, so a contact marked invalid after the read stays invalid;
//   * each switch is written to the activity log; a failed read is reported, not turned into "nothing to do";
//   * more than one page of contacts is all handled.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isBackFromOoo, backFromOooUpdate, runOooReturnSweep } = require('../services/ooo-return');
const results = []; const step = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); };
const NOW = new Date('2026-10-05T09:00:00Z');
const C = (id, status, until) => ({ id, job_id: 'j' + id, first_name: 'P' + id, last_name: 'X', email_status: status, ooo_until: until });

step('return date today → back', isBackFromOoo(C(1, 'out_of_office', '2026-10-05'), '2026-10-05'));
step('return date in the past → back', isBackFromOoo(C(1, 'out_of_office', '2026-09-20'), '2026-10-05'));
step('return date tomorrow → still away', !isBackFromOoo(C(1, 'out_of_office', '2026-10-06'), '2026-10-05'));
step('an ISO timestamp date is read by its day', isBackFromOoo(C(1, 'out_of_office', '2026-10-05T00:00:00Z'), '2026-10-05'));
step('no date / unreadable date → left alone', !isBackFromOoo(C(1, 'out_of_office', null), '2026-10-05') && !isBackFromOoo(C(1, 'out_of_office', 'soon'), '2026-10-05') && !isBackFromOoo(C(1, 'out_of_office', '2026-10-05'), ''));
step('invalid / deactivated / valid are never switched', ['invalid', 'deactivated', 'valid', null].every(s => !isBackFromOoo(C(1, s, '2020-01-01'), '2026-10-05')));
const u = backFromOooUpdate(NOW);
step('the update is Valid with the date cleared', u.email_status === 'valid' && u.ooo_until === null);

// a fake contacts table that understands the sweep's query
function fakeContacts(rows, opts) {
  opts = opts || {};
  const q = () => {
    const f = []; let kind = 'select', patch = null, range = null;
    const api = {
      select() { kind = 'select'; return api; },
      update(p) { kind = 'update'; patch = p; return api; },
      eq(c, v) { f.push(r => r[c] === v); return api; },
      not(c, op, v) { f.push(r => (r[c] == null) === (v == null) ? false : true); return api; },
      lte(c, v) { f.push(r => r[c] != null && String(r[c]).slice(0, 10) <= v); return api; },
      order() { return api; },
      range(a, b) { range = [a, b]; return api; },
      then(res, rej) {
        if (kind === 'select' && opts.failRead) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
        if (kind === 'update' && opts.beforeUpdate) opts.beforeUpdate(rows);
        const hit = rows.filter(r => f.every(x => x(r)));
        if (kind === 'update') { hit.forEach(r => Object.assign(r, patch)); return Promise.resolve({ error: null }).then(res, rej); }
        return Promise.resolve({ data: range ? hit.slice(range[0], range[1] + 1) : hit, error: null }).then(res, rej);
      },
    };
    return api;
  };
  return q;
}
const logs = []; const logActivity = async (...a) => { logs.push(a); };
const rows = [C(1, 'out_of_office', '2026-10-05'), C(2, 'out_of_office', '2026-09-01'), C(3, 'out_of_office', '2026-10-09'), C(4, 'invalid', '2026-09-01'), C(5, 'out_of_office', null), C(6, 'valid', null)];
let r = await runOooReturnSweep({ contacts: fakeContacts(rows), logActivity, now: NOW });
const by = (id) => rows.find(x => x.id === id);
step('the two contacts whose date has arrived are switched back to Valid', by(1).email_status === 'valid' && by(2).email_status === 'valid' && r.switched === 2, JSON.stringify(r));
step('their return date is cleared', by(1).ooo_until === null && by(2).ooo_until === null);
step('a future date, an invalid contact, a dateless one and a valid one are untouched', by(3).email_status === 'out_of_office' && by(4).email_status === 'invalid' && by(5).email_status === 'out_of_office' && by(6).email_status === 'valid');
step('each switch is written to the activity log', logs.length === 2 && logs.every(l => l[3] === 'ooo_returned'), JSON.stringify(logs.map(l => l[4])));
logs.length = 0;
r = await runOooReturnSweep({ contacts: fakeContacts(rows), logActivity, now: NOW });
step('running it again changes nothing (safe to run as often as it is asked)', r.switched === 0 && logs.length === 0);
// marked invalid between the read and the write
const racy = [C(7, 'out_of_office', '2026-09-01')];
r = await runOooReturnSweep({ contacts: fakeContacts(racy, { beforeUpdate: (rs) => { rs[0].email_status = 'invalid'; } }), logActivity, now: NOW });
step('a contact marked invalid after the read stays invalid (the update re-checks the status)', racy[0].email_status === 'invalid');
r = await runOooReturnSweep({ contacts: fakeContacts([], { failRead: true }), logActivity, now: NOW });
step('a failed read is reported as an error, not "nothing to do"', !!r.error && r.switched === 0, JSON.stringify(r));
const many = Array.from({ length: 1234 }, (_, i) => C(100 + i, 'out_of_office', '2026-09-01'));
r = await runOooReturnSweep({ contacts: fakeContacts(many), logActivity, now: NOW });
step('more than one page of contacts: all 1,234 are handled (none skipped as the pages shift)', r.switched === 1234 && many.every(c => c.email_status === 'valid'), JSON.stringify(r));
console.log('\nSUMMARY: ' + results.filter(Boolean).length + '/' + results.length + ' passed'); process.exit(results.every(Boolean) ? 0 : 1);
