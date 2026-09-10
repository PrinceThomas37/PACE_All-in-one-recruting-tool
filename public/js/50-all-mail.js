// ════════════════════════════════════════════════════════════════════════════
// ALL EMAIL — one window onto three pipelines. Item 5 of
// docs/AGEING_UI_PLAN.md, served by routes/email-history.js.
//
// The owner, Session 23: "I cannot see the email preview of the sent emails to
// clients, also when I send individual emails it doesn't come in the pending
// section, like I feel the pipeline is different, also the pending emails to
// the candidates do not come in the pending tab."
//
// All of it was true. Three pipelines existed and each screen showed one:
//   Pending / Sent  →  `emails`             (leads engine, queued + drip-sent)
//   nowhere         →  `email_tracking`     (client + one-off sends, immediate)
//   its own page    →  `candidate_outreach` (candidate batches, own queue)
//
// So "did we email this company, and what did we say" was three questions with
// three answers in three places. This is one question with one answer.
// ════════════════════════════════════════════════════════════════════════════

var AM_SOURCES = {
  leads:      { lbl: 'Lead outreach',   hint: 'Cold emails and follow-ups, drip-sent from the queue', fg: '#3730a3', bg: '#e0e7ff' },
  individual: { lbl: 'One-off',         hint: 'Sent immediately — client emails, interview invites',  fg: '#0369a1', bg: '#e0f2fe' },
  candidates: { lbl: 'Candidate batch', hint: 'Queued to candidates, evenings and weekends',          fg: '#9a3412', bg: '#ffedd5' },
};

function amState() {
  if (!STATE.allMail) {
    STATE.allMail = { data: null, loading: false, error: null, q: '', page: 0, source: '', open: null, showAll: false };
  }
  return STATE.allMail;
}

window.loadAllMail = function (force) {
  var a = amState();
  if (a.loading) return;
  if (a.data && !force) return;
  a.loading = true; a.error = null;
  var qs = [];
  if (a.q) qs.push('q=' + encodeURIComponent(a.q));
  if (a.source) qs.push('source=' + encodeURIComponent(a.source));
  if (a.page) qs.push('page=' + a.page);
  if (a.showAll) qs.push('days=0');
  apiGet('/email/history' + (qs.length ? '?' + qs.join('&') : '')).then(function (d) {
    a.data = d || null; a.loading = false; scheduleRender();
  }).catch(function (e) {
    // A failed fetch says so on screen. It must never leave a blank panel that
    // looks like "you have never emailed anyone".
    a.loading = false; a.error = (e && e.message) || String(e); scheduleRender();
  });
};

window.amSearch = function (v) { var a = amState(); a.q = v; a.page = 0; a.data = null; loadAllMail(true); };
window.amGoPage = function (i) { var a = amState(); a.page = i; a.data = null; loadAllMail(true); };
window.amSource = function (s) { var a = amState(); a.source = s; a.page = 0; a.data = null; loadAllMail(true); };
window.amShowAll = function () { var a = amState(); a.showAll = true; a.page = 0; a.data = null; loadAllMail(true); };
window.amToggle = function (id) {
  var a = amState(); a.open = (a.open === id ? null : id); scheduleRender();
};

window.renderAllMailBody = function () {
  var a = amState();
  if (!a.data && !a.loading && !a.error) loadAllMail();

  if (a.error) {
    return '<div class="card" style="padding:22px">' +
      '<div style="font-weight:600;margin-bottom:6px">Could not load the email history.</div>' +
      '<div style="font-size:12.5px;color:var(--text3);margin-bottom:12px">' + htmlEsc(a.error) + '</div>' +
      '<button class="hz-btn" onclick="loadAllMail(true)">Try again</button></div>';
  }
  if (!a.data) {
    return '<div class="card" style="padding:40px;text-align:center;color:var(--text3)">Loading email history…</div>';
  }

  var d = a.data;
  var items = d.items || [];
  var bs = d.by_source || {};

  // The source filter doubles as the explanation of what the three pipelines
  // ARE — the owner had to ask, which means the app never said.
  function srcBtn(key, label, n) {
    var on = a.source === key;
    return '<button class="am-src' + (on ? ' is-on' : '') + '"' +
      ' title="' + htmlEsc(key && AM_SOURCES[key] ? AM_SOURCES[key].hint : 'Everything, all three pipelines') + '"' +
      ' onclick="amSource(\'' + key + '\')">' + htmlEsc(label) +
      (n === null || n === undefined ? '' : ' <b>' + n + '</b>') + '</button>';
  }

  var total = (bs.leads || 0) + (bs.individual || 0) + (bs.candidates || 0);
  var filters = '<div class="am-srcs">' +
    srcBtn('', 'All', total) +
    srcBtn('leads', AM_SOURCES.leads.lbl, bs.leads || 0) +
    srcBtn('individual', AM_SOURCES.individual.lbl, bs.individual || 0) +
    srcBtn('candidates', AM_SOURCES.candidates.lbl, bs.candidates || 0) +
  '</div>';

  var rows = items.map(function (it) {
    var s = AM_SOURCES[it.source] || AM_SOURCES.leads;
    var open = a.open === it.id;
    var when = it.sent_at ? fmtWhen(it.sent_at) : '—';
    // A pending row must say it is pending, not pretend it was sent — that
    // conflation is what made three pipelines feel like one broken one.
    var stat = it.status === 'pending'
      ? '<span class="am-stat am-pending">Queued' + (it.due_at ? ' · due ' + fmtWhen(it.due_at) : '') + '</span>'
      : it.status === 'failed'
        ? '<span class="am-stat am-failed" title="' + htmlEsc(it.fail_reason || '') + '">Failed</span>'
        : it.replied_at
          ? '<span class="am-stat am-replied">↩ Replied</span>'
          : it.opened_at
            ? '<span class="am-stat am-opened">✓ Opened' + (it.open_count > 1 ? ' ·' + it.open_count + '×' : '') + '</span>'
            : '<span class="am-stat">Sent</span>';

    return '<div class="am-row' + (open ? ' is-open' : '') + '">' +
      '<div class="am-head" onclick="amToggle(\'' + htmlEsc(String(it.id)) + '\')">' +
        '<span class="am-tag" style="background:' + s.bg + ';color:' + s.fg + '" title="' + htmlEsc(s.hint) + '">' + htmlEsc(s.lbl) + '</span>' +
        '<div class="am-main">' +
          '<div class="am-subj">' + htmlEsc(it.subject || '(no subject)') + '</div>' +
          '<div class="am-to">' + htmlEsc(it.to_email || '') +
            (it.from_email ? ' <span class="am-dim">from ' + htmlEsc(it.from_email) + '</span>' : '') + '</div>' +
        '</div>' +
        stat +
        '<span class="am-when">' + htmlEsc(when) + '</span>' +
        '<span class="am-chev">' + (open ? '⌄' : '›') + '</span>' +
      '</div>' +
      // THE PREVIEW THE OWNER COULD NOT FIND. The text was stored the whole
      // time; nothing read it back. Plain text in a pre-wrap block, not an
      // iframe: this is our own outbound copy, not untrusted inbound mail.
      (open ? '<div class="am-body">' +
        (it.body
          ? '<div class="am-text">' + htmlEsc(it.body) + '</div>'
          : '<div class="am-dim">No copy of this message was stored.</div>') +
        (it.angle ? '<div class="am-meta">Angle: ' + htmlEsc(it.angle) + (it.engine ? ' · written by ' + htmlEsc(it.engine) : '') + '</div>' : '') +
        (it.fail_reason ? '<div class="am-meta am-failed">' + htmlEsc(it.fail_reason) + '</div>' : '') +
      '</div>' : '') +
    '</div>';
  }).join('');

  if (!rows) {
    rows = '<div class="am-empty">' +
      (a.q ? 'Nothing matches “' + htmlEsc(a.q) + '”.'
           : 'No email in the last ' + (d.horizon_days || 90) + ' days.') + '</div>';
  }

  var hidden = (d.counts && d.counts.hidden)
    ? UI.horizonBar(d.counts, { horizonDays: d.horizon_days, onShowAll: 'amShowAll()', noun: 'emails' })
    : '';

  // Partial results are named as partial. "Nothing was sent" and "one of the
  // three could not be read" must never look the same.
  var warn = d.partial
    ? '<div class="am-warn">Some of this could not be read: ' + htmlEsc((d.source_errors || []).join('; ')) +
      '. What you see below is incomplete.</div>'
    : '';

  return '<div>' +
    '<div class="am-top">' + filters +
      UI.searchBox(a.q, 'amSearch(this.value)', 'Search subject or recipient…') +
    '</div>' +
    warn + hidden +
    '<div class="card am-list">' + rows + '</div>' +
    UI.pager((d.pages || 1) * (d.page_size || 25), d.page || 0, 'amGoPage(%d)', d.page_size || 25) +
  '</div>';
};

// Short, human, and never a bare ISO string in front of a recruiter.
function fmtWhen(iso) {
  try {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return String(iso).slice(0, 10);
    var days = Math.floor((Date.now() - t.getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 0) return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (days < 30) return days + 'd ago';
    return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: t.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  } catch (e) { return String(iso || '').slice(0, 10); }
}
