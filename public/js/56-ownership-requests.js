// ── "ASK TO TAKE OVER" (R-047, D-0036/D-0037/D-0038) ─────────────────────────
// One implementation, four doors: the client page, the job-order detail, the
// lead drawer, and the duplicate-warning note (both the mailmerge import and
// the new-contact "already exists" check). Every door calls the same handful
// of functions in this file — never a second copy of the request/approve flow.
//
// THE SESSION 24 RULE APPLIES HERE TOO: never draw a button that will refuse.
// `otSlot()` draws NOTHING until `GET /ownership-requests/can-request` answers,
// and draws nothing at all if the answer is "no" — not a disabled button, not
// an explanation, just an empty box. The three real outcomes are: nothing (not
// eligible), "Ask to take over" + "<name> decides" (eligible), or "Requested ·
// waiting on <name>" + Withdraw (already asked). A caller never has to know
// which one it is — it hands over a kind + a record id and gets back a string.
//
// PATCHES ITS OWN ELEMENT, NEVER ITS BLOCK — same rule as the POC duplicate-
// email check (52-poc-block.js): the answer arrives from the network, after
// the page has already been read, so it may only ever replace the one <div>
// it owns. And once resolved it is CACHED per (kind, record, via_email), so a
// tab switch or an unrelated repaint that calls otSlot() again renders the
// cached answer synchronously — no flicker, no repeat network call — until
// something invalidates it (submitting or withdrawing a request).

(function(){

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var OT_KIND_LABEL = { lead:'lead', client:'client', job_order:'job order' };

  // ── the slot: nothing → button, or nothing → "requested" ───────────────────
  var _otCache = {};   // key -> {can, mine}
  var _otPending = {}; // key -> true while a fetch is in flight

  function otKey(kind, recordId, viaEmail){ return kind+':'+recordId+':'+(viaEmail||''); }

  // Every value that must reach a click handler travels as a `data-*`
  // attribute, read back with `this.dataset`, NEVER interpolated into the
  // `onclick="…('…')"` JS-string literal. HTML-escaping (`esc`) only protects
  // the ATTRIBUTE — the browser decodes it before the JS string boundary is
  // even parsed, so an escaped `'` still closes the string. A name like
  // "O'Brien" broke the button this way, and a contact email such as
  // `x');fetch('//evil');//@a.co` (which still matches EMAIL_RE) was stored
  // XSS. `data-*` + `dataset` never re-enters JS parsing at all.
  function otSlotInner(id, kind, recordId, viaEmail, can, mine){
    var inner = '';
    if (mine) {
      inner = '<div class="ot-pending">' +
        '<span class="ot-pending-lbl">Requested · waiting on ' + esc((mine.approver && mine.approver.name) || 'a manager') + '</span>' +
        '<button class="btn btn-sm btn-outline" data-req-id="' + esc(mine.id) + '" data-slot-id="' + esc(id) + '" data-kind="' + esc(kind) + '" data-record-id="' + esc(recordId) + '" data-via-email="' + esc(viaEmail || '') + '" onclick="otWithdrawFromEl(this)">Withdraw</button>' +
      '</div>';
    } else if (can && can.ok) {
      var approverName = (can.approver && can.approver.name) || 'Your manager';
      inner = '<div class="ot-ask">' +
        '<button class="btn btn-sm btn-outline" data-kind="' + esc(kind) + '" data-record-id="' + esc(recordId) + '" data-via-email="' + esc(viaEmail || '') + '" data-slot-id="' + esc(id) + '" data-approver-name="' + esc(approverName) + '" onclick="otOpenFromEl(this)">Ask to take over</button>' +
        '<div class="ot-decides">' + esc(approverName) + ' decides.</div>' +
      '</div>';
    }
    // Not ok, no pending request: draw nothing. This is the "never a button
    // that will refuse" branch — there is no third state to show.
    return '<div id="' + id + '" class="ot-slot">' + inner + '</div>';
  }

  // Read straight off the element's own dataset — never off a JS-string arg
  // that was built by concatenating a server-supplied value into markup.
  window.otOpenFromEl = function(el){
    var d = el.dataset || {};
    otOpen(d.kind, d.recordId, d.viaEmail || '', d.slotId || '', d.approverName || null);
  };
  window.otWithdrawFromEl = function(el){
    var d = el.dataset || {};
    otWithdraw(d.reqId, d.slotId || '', d.kind, d.recordId, d.viaEmail || '');
  };

  function otFetch(kind, recordId, viaEmail, key, id){
    // POST, not a query string — a query string would put a prospect's email
    // address in server access logs (rampart L3).
    var body = { kind: kind, record_id: recordId };
    if (viaEmail) body.via_email = viaEmail;
    Promise.all([
      apiPost('/ownership-requests/can-request', body).catch(function(){ return null; }),
      apiGet('/ownership-requests?box=record&kind=' + encodeURIComponent(kind) + '&record_id=' + encodeURIComponent(recordId)).catch(function(){ return null; })
    ]).then(function(r){
      var can = r[0];
      var list = (r[1] && r[1].requests) || [];
      var mine = list.filter(function(x){ return x.status === 'pending' && x.can_cancel; })[0] || null;
      _otCache[key] = { can: can, mine: mine };
      delete _otPending[key];
      var el = document.getElementById(id);
      if (el) el.outerHTML = otSlotInner(id, kind, recordId, viaEmail, can, mine);
    }).catch(function(){ delete _otPending[key]; });
  }

  function otInvalidate(kind, recordId, viaEmail){ delete _otCache[otKey(kind, recordId, viaEmail)]; }

  // The one thing a page emits: `otSlot('client', c.id)`. Nothing else needed.
  window.otSlot = function(kind, recordId, viaEmail){
    var id = 'ot-slot-' + kind + '-' + recordId;
    var key = otKey(kind, recordId, viaEmail);
    if (_otCache[key]) {
      var c = _otCache[key];
      return otSlotInner(id, kind, recordId, viaEmail, c.can, c.mine);
    }
    if (!_otPending[key]) { _otPending[key] = true; otFetch(kind, recordId, viaEmail, key, id); }
    return '<div id="' + id + '" class="ot-slot"></div>';
  };

  window.otWithdraw = function(reqId, slotId, kind, recordId, viaEmail){
    apiPost('/ownership-requests/' + encodeURIComponent(reqId) + '/cancel', {}).then(function(){
      showToast('Withdrawn', 'success');
      otInvalidate(kind, recordId, viaEmail);
      if (slotId) otFetch(kind, recordId, viaEmail, otKey(kind, recordId, viaEmail), slotId);
      loadOwnershipMine(true);
    }).catch(function(e){ showToast('Could not withdraw: ' + ((e && e.message) || e), 'error'); });
  };

  // ── the ask modal ────────────────────────────────────────────────────────
  // Reuses the app's plain STATE.modal idiom (the same one clientsOpenEmail /
  // bdOpenAssign / the duplicate-warning modal all use) rather than a second
  // overlay mechanism.
  window.otOpen = function(kind, recordId, viaEmail, slotId, approverName){
    STATE._otModalState = {
      kind: kind, recordId: recordId, viaEmail: viaEmail || '', slotId: slotId || '',
      note: '', busy: false, approverName: approverName || null,
      checking: !approverName, blocked: null
    };
    STATE.modal = otModalHtml(STATE._otModalState);
    render();
    // Duplicate-warning links open this without a pre-fetched approver — check
    // (and re-confirm) eligibility now, so Send can never fire against a
    // record that was never actually eligible.
    if (!approverName) otCheckForModal();
  };

  function otCheckForModal(){
    var m = STATE._otModalState; if (!m) return;
    // POST, not a query string — same reason as otFetch: no email in logs.
    var body = { kind: m.kind };
    if (m.recordId) body.record_id = m.recordId;
    if (m.viaEmail) body.via_email = m.viaEmail;
    apiPost('/ownership-requests/can-request', body).then(function(can){
      var cur = STATE._otModalState; if (!cur) return; // closed already
      cur.checking = false;
      if (can && can.ok) cur.approverName = (can.approver && can.approver.name) || 'Your manager';
      // The server's refusal field is `reason`, not `why` — `can.why` is
      // always null/undefined here, which used to swallow every real refusal
      // sentence and show only the generic fallback.
      else cur.blocked = (can && can.reason) || 'This can’t be requested right now.';
      STATE.modal = otModalHtml(cur); render();
    }).catch(function(){
      var cur = STATE._otModalState; if (!cur) return;
      cur.checking = false; cur.blocked = 'Could not check who approves this.';
      STATE.modal = otModalHtml(cur); render();
    });
  }

  window.otCloseAskModal = function(){ STATE._otModalState = null; closeModal(); };
  window.otSetNote = function(v){ if (STATE._otModalState) STATE._otModalState.note = v; };

  window.otSubmit = function(){
    var m = STATE._otModalState;
    if (!m || m.busy || m.checking || m.blocked) return;
    m.busy = true; STATE.modal = otModalHtml(m); render();
    apiPost('/ownership-requests', { kind: m.kind, record_id: m.recordId, note: m.note || undefined, via_email: m.viaEmail || undefined })
      .then(function(){
        showToast('Request sent — ' + (m.approverName || 'your manager') + ' will see it.', 'success');
        var slotId = m.slotId, kind = m.kind, recordId = m.recordId, viaEmail = m.viaEmail;
        STATE._otModalState = null; closeModal();
        otInvalidate(kind, recordId, viaEmail);
        if (slotId) otFetch(kind, recordId, viaEmail, otKey(kind, recordId, viaEmail), slotId);
        loadOwnershipMine(true);
      }).catch(function(e){
        m.busy = false;
        showToast('Could not send that request: ' + ((e && e.message) || e), 'error');
        STATE.modal = otModalHtml(m); render();
      });
  };

  function otModalHtml(m){
    var label = OT_KIND_LABEL[m.kind] || 'record';
    var body;
    if (m.checking) body = '<div class="ot-check">Checking who approves this…</div>';
    else if (m.blocked) body = '<div class="ot-check ot-blocked">' + esc(m.blocked) + '</div>';
    else body =
      '<div class="ot-decides-line">' + esc(m.approverName || 'Your manager') + ' decides.</div>' +
      '<label class="ot-label">Reason (optional)</label>' +
      '<textarea class="sel" rows="3" placeholder="Why are you asking to take this over?" oninput="otSetNote(this.value)">' + esc(m.note || '') + '</textarea>';
    return '<div class="modal modal-w480 ot-modal" onclick="event.stopPropagation()">' +
      '<div class="mh"><div class="mt">Ask to take over this ' + label + '</div>' +
        '<button class="btn-icon" onclick="otCloseAskModal()">' + (typeof ico === 'function' ? ico('x', 14) : '×') + '</button></div>' +
      '<div class="mb_">' + body + '</div>' +
      '<div class="mf">' +
        '<button class="btn btn-outline" onclick="otCloseAskModal()">Cancel</button>' +
        (!m.checking && !m.blocked
          ? '<button class="btn btn-primary" ' + (m.busy ? 'disabled' : '') + ' onclick="otSubmit()">' + (m.busy ? 'Sending…' : 'Send') + '</button>'
          : '') +
      '</div>' +
    '</div>';
  }

  // ── waiting-on-you + my-requests summary and panel ──────────────────────────
  // Lives next to "Needs you today" — the app already established that a
  // manager reviews their team's open work there (naTeamLine / naOpenTeam,
  // Session 24, D-0020), and a take-over request is exactly that kind of
  // review. Loaded once per dashboard visit, like next-actions and the
  // morning briefing — nothing here polls on a timer.
  function loadOwnershipWaiting(force){
    if (STATE._otWaitLoading) return;
    if (STATE.otWaiting !== undefined && !force) return;
    STATE._otWaitLoading = true;
    apiGet('/ownership-requests?box=waiting').then(function(r){
      STATE.otWaiting = r || { requests: [], waiting_count: 0 };
      STATE._otWaitLoading = false;
      scheduleRender();
    }).catch(function(){
      STATE.otWaiting = { requests: [], waiting_count: 0, _error: true };
      STATE._otWaitLoading = false;
      scheduleRender();
    });
  }
  function loadOwnershipMine(force){
    if (STATE._otMineLoading) return;
    if (STATE.otMine !== undefined && !force) return;
    STATE._otMineLoading = true;
    apiGet('/ownership-requests?box=mine').then(function(r){
      STATE.otMine = r || { requests: [] };
      STATE._otMineLoading = false;
      scheduleRender();
    }).catch(function(){
      STATE.otMine = { requests: [], _error: true };
      STATE._otMineLoading = false;
      scheduleRender();
    });
  }
  window.loadOwnershipWaiting = loadOwnershipWaiting;
  window.loadOwnershipMine = loadOwnershipMine;

  // A quiet standalone card, same shape as the morning briefing / next-actions
  // cards on the dashboard — rendered only when there is something to say.
  // D-0019: no red, one chip, roughly nothing when there is nothing waiting.
  window.renderOwnershipSummaryCard = function(){
    var w = STATE.otWaiting, m = STATE.otMine;
    if (w === undefined || m === undefined) return ''; // still loading — say nothing yet
    var wc = (w && w.waiting_count) || 0;
    var mc = (m && m.requests) ? m.requests.length : 0;
    if (!wc && !mc) return '';
    var bits = [];
    if (wc) bits.push('<button class="na-act" onclick="otOpenPanel(\'waiting\')" title="Review requests to take over a lead, client or job order">' +
      wc + ' take-over request' + (wc === 1 ? '' : 's') + ' waiting on you</button>');
    if (mc) bits.push('<button class="na-act na-act-quiet" onclick="otOpenPanel(\'mine\')" title="See your own take-over requests">My requests (' + mc + ')</button>');
    return '<div class="card cp mb4 ot-summary"><div class="na-hidden" style="border-top:0;background:transparent;padding:0">' + bits.join('') + '</div></div>';
  };

  window.otOpenPanel = function(tab){
    STATE.otPanel = { tab: tab || 'waiting', declining: null, declineNote: '' };
    loadOwnershipWaiting(true);
    loadOwnershipMine(true);
    STATE.modal = renderOwnershipPanel();
    render();
  };
  window.otClosePanel = function(){ STATE.otPanel = null; closeModal(); };
  window.otPanelTab = function(t){
    if (STATE.otPanel) { STATE.otPanel.tab = t; STATE.otPanel.declining = null; }
    STATE.modal = renderOwnershipPanel(); render();
  };

  window.otStartDecline = function(id){
    if (STATE.otPanel) { STATE.otPanel.declining = id; STATE.otPanel.declineNote = ''; }
    STATE.modal = renderOwnershipPanel(); render();
  };
  window.otCancelDecline = function(){
    if (STATE.otPanel) STATE.otPanel.declining = null;
    STATE.modal = renderOwnershipPanel(); render();
  };
  window.otSetDeclineNote = function(v){ if (STATE.otPanel) STATE.otPanel.declineNote = v; };

  window.otApprove = function(id){ otDecide(id, 'approve', ''); };
  window.otConfirmDecline = function(id){ otDecide(id, 'decline', (STATE.otPanel && STATE.otPanel.declineNote) || ''); };

  function otDecide(id, action, note){
    apiPost('/ownership-requests/' + encodeURIComponent(id) + '/' + action, note ? { note: note } : {})
      .then(function(){
        showToast(action === 'approve' ? 'Approved — reassigned' : 'Declined', 'success');
        if (STATE.otPanel) STATE.otPanel.declining = null;
        // The record just changed hands (or didn't) — every list that shows
        // ownership needs to know. Named globals, called directly: by the time
        // a person can click Approve, every page module has already loaded.
        refreshJobs();
        if (typeof window.clientsReload === 'function') window.clientsReload();
        if (typeof window.bdReloadJobOrders === 'function') window.bdReloadJobOrders();
        loadOwnershipWaiting(true);
        loadOwnershipMine(true);
        STATE.modal = renderOwnershipPanel(); render();
      }).catch(function(e){
        showToast('Could not ' + action + ': ' + ((e && e.message) || e), 'error');
      });
  }

  function otStatusChip(status){
    // The stored status is `cancelled`, never `withdrawn` — `withdrawn` was
    // never a value the server writes, so this mapping always fell through
    // to the raw word and showed "cancelled" instead of the plain-English
    // "Withdrawn" the panel means to say.
    var lbl = { pending:'Pending', approved:'Approved', declined:'Declined', cancelled:'Withdrawn' }[status] || status;
    return '<span class="ot-chip ' + esc(status || '') + '">' + esc(lbl) + '</span>';
  }
  function otAge(iso){
    if (!iso) return '';
    try {
      var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
      if (days <= 0) return 'today';
      return days + ' day' + (days === 1 ? '' : 's') + ' ago';
    } catch (e) { return ''; }
  }

  function renderWaitingRows(){
    var w = STATE.otWaiting;
    if (!w) return '<div class="ot-empty">Loading…</div>';
    if (w._error) return '<div class="ot-empty">Could not load these.</div>';
    var list = w.requests || [];
    if (!list.length) return '<div class="ot-empty">Nothing waiting on you right now.</div>';
    var declining = STATE.otPanel && STATE.otPanel.declining;
    return list.map(function(r){
      return '<div class="ot-row st-' + esc(r.status || 'pending') + '">' +
        '<div class="ot-row-t">' + esc(r.record_label || (OT_KIND_LABEL[r.kind] || 'record')) + otStatusChip(r.status) + '</div>' +
        '<div class="ot-row-sub">' + esc((r.requester && r.requester.name) || 'Someone') + ' is asking' +
          (r.current_owner ? ' to take this over from ' + esc(r.current_owner.name) : '') +
          ' · ' + otAge(r.created_at) + '</div>' +
        (r.note ? '<div class="ot-row-note">“' + esc(r.note) + '”</div>' : '') +
        (r.can_decide ? (
          declining === r.id
            ? '<div class="ot-decline-box">' +
                '<textarea class="sel" rows="2" placeholder="Optional note for declining" oninput="otSetDeclineNote(this.value)"></textarea>' +
                '<div class="ot-row-acts">' +
                  '<button class="btn btn-sm btn-primary" onclick="otConfirmDecline(\'' + r.id + '\')">Confirm decline</button>' +
                  '<button class="btn btn-sm btn-outline" onclick="otCancelDecline()">Cancel</button>' +
                '</div>' +
              '</div>'
            : '<div class="ot-row-acts">' +
                '<button class="btn btn-sm btn-primary" onclick="otApprove(\'' + r.id + '\')">Approve</button>' +
                '<button class="btn btn-sm btn-outline" onclick="otStartDecline(\'' + r.id + '\')">Decline</button>' +
              '</div>'
        ) : '') +
      '</div>';
    }).join('');
  }

  function renderMineRows(){
    var m = STATE.otMine;
    if (!m) return '<div class="ot-empty">Loading…</div>';
    if (m._error) return '<div class="ot-empty">Could not load these.</div>';
    var list = m.requests || [];
    if (!list.length) return '<div class="ot-empty">You haven’t asked to take over anything.</div>';
    return list.map(function(r){
      return '<div class="ot-row st-' + esc(r.status || 'pending') + '">' +
        '<div class="ot-row-t">' + esc(r.record_label || (OT_KIND_LABEL[r.kind] || 'record')) + otStatusChip(r.status) + '</div>' +
        '<div class="ot-row-sub">' +
          (r.status === 'pending' ? 'Waiting on ' + esc((r.approver && r.approver.name) || 'a manager')
            : r.status === 'approved' ? 'Approved by ' + esc((r.decided_by && r.decided_by.name) || (r.approver && r.approver.name) || 'a manager')
            : r.status === 'declined' ? 'Declined by ' + esc((r.decided_by && r.decided_by.name) || (r.approver && r.approver.name) || 'a manager')
            : 'Withdrawn') +
          ' · ' + otAge(r.decided_at || r.created_at) +
        '</div>' +
        (r.decision_note ? '<div class="ot-row-note">“' + esc(r.decision_note) + '”</div>' : '') +
        (r.status === 'pending' && r.can_cancel
          ? '<div class="ot-row-acts"><button class="btn btn-sm btn-outline" onclick="otWithdrawFromPanel(\'' + r.id + '\',\'' + r.kind + '\',\'' + r.record_id + '\')">Withdraw</button></div>'
          : '') +
      '</div>';
    }).join('');
  }
  // Withdrawing from the panel does not know a page slot id — it only needs to
  // refresh the two lists this panel itself shows.
  window.otWithdrawFromPanel = function(reqId, kind, recordId){
    apiPost('/ownership-requests/' + encodeURIComponent(reqId) + '/cancel', {}).then(function(){
      showToast('Withdrawn', 'success');
      otInvalidate(kind, recordId, '');
      loadOwnershipMine(true); loadOwnershipWaiting(true);
      STATE.modal = renderOwnershipPanel(); render();
    }).catch(function(e){ showToast('Could not withdraw: ' + ((e && e.message) || e), 'error'); });
  };

  function renderOwnershipPanel(){
    var p = STATE.otPanel; if (!p) return '';
    var tab = p.tab || 'waiting';
    var wc = (STATE.otWaiting && STATE.otWaiting.waiting_count) || 0;
    var mc = (STATE.otMine && STATE.otMine.requests) ? STATE.otMine.requests.length : 0;
    return '<div class="modal modal-w640 ot-panel" onclick="event.stopPropagation()">' +
      '<div class="mh"><div class="mt">Take-over requests</div>' +
        '<button class="btn-icon" onclick="otClosePanel()">' + (typeof ico === 'function' ? ico('x', 14) : '×') + '</button></div>' +
      '<div class="ot-tabs">' +
        '<div class="ot-tab' + (tab === 'waiting' ? ' on' : '') + '" onclick="otPanelTab(\'waiting\')">Waiting on you' + (wc ? ' (' + wc + ')' : '') + '</div>' +
        '<div class="ot-tab' + (tab === 'mine' ? ' on' : '') + '" onclick="otPanelTab(\'mine\')">My requests' + (mc ? ' (' + mc + ')' : '') + '</div>' +
      '</div>' +
      '<div class="ot-body">' + (tab === 'waiting' ? renderWaitingRows() : renderMineRows()) + '</div>' +
    '</div>';
  }

})();
