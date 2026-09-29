// ===== WINDOWS: minimise, bring back, maximise, close (R-078 / R-079, D-0058) =====
// The owner, 29 Sep: "I was composing email to send to client and there was no
// minimize button for compose window … go and look from the details to copy
// paste within PACE itself and then come and paste it on the given window. Like
// it is in Gmail or Outlook." — and, generalised: "windows open up for emails or
// messages or reminders or client details or anything … minimize, maximise or
// close at anytime."  (D-0058: compose first, other windows too.)
//
// HOW IT WORKS, so the next person does not have to re-derive it:
//  * PACE has ONE modal slot (STATE.modal, an html string) and drawers. This file
//    does not change either. It DECORATES what renderModal() returns: a slim title
//    bar with three buttons inside the modal, and the tray of parked windows.
//  * MINIMISE = park: the modal's html, everything typed into it (read from the
//    DOM — typed text lives nowhere else) and its scroll are stored on a chip in
//    the tray, and the slot is cleared. Bring it back and it is put back exactly
//    as left. Several can be parked at once.
//  * MAXIMISE is a CLASS toggled on the live element, never a render(): a
//    render() would rebuild the modal and empty everything typed into it. The
//    same state is also written into the html the next render produces (D.max),
//    so a later repaint agrees and writes nothing.
//  * The tray is part of the `#layer` html string, so it is a patched region like
//    the modal: it repaints only when it changed.
//  * A window that paints itself asynchronously (the mailbox composer paints when a
//    signature or an attachment finishes loading) must NOT pop open over the page
//    while parked. It calls Dock.updateParked(kind, html) first; if that answers
//    true the html went to the chip and nothing opened.
//  * Not parkable: an alert dialog (role="alertdialog" — a question that needs an
//    answer), anything marked data-nowin, and modals held as objects
//    (jobDetail/addJob/addContact) rather than a string.
//  * Drawers (a candidate or client record) are parked by REOPENING: the chip
//    remembers which record and opens it again — a record is data, not a form.
//
// Nothing here talks to the server, so nothing here can lose or send anything.
(function () {
  var MAX_PARKED = 6;
  var D = STATE.dock = STATE.dock || { items: [], max: false, seq: 0 };
  var hooks = { discard: {}, drawer: {} };

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function parkable(html){
    return typeof html === 'string' && html.length > 0 &&
      html.indexOf('role="alertdialog"') < 0 && html.indexOf('data-nowin') < 0;
  }
  function kindOf(html){ var m = /data-win="([A-Za-z0-9_-]+)"/.exec(html || ''); return m ? m[1] : ''; }

  // A short name for the chip, read from the window's own heading.
  function titleOf(html){
    try {
      var d = document.createElement('div'); d.innerHTML = html;
      var el = d.querySelector('.mhd,.mt,.stg-res-t,.stg-hd > div,h1,h2,h3');
      var t = el && el.textContent ? el.textContent.trim() : '';
      if (!t) { var any = d.querySelector('[style*="font-weight:700"],[style*="font-weight:600"]'); t = any && any.textContent ? any.textContent.trim() : ''; }
      if (!t) t = (d.textContent || '').trim().split(/\n+/)[0] || '';
      t = t.replace(/\s+/g, ' ');
      return t.length > 42 ? t.slice(0, 41) + '…' : (t || 'Window');
    } catch (_) { return 'Window'; }
  }

  // What is typed into the live window, in document order. Nothing else holds it.
  function snapshot(){
    var box = document.querySelector('#layer .modal'); if (!box) return { fields: [], scroll: 0 };
    var out = [];
    box.querySelectorAll('input,textarea,select').forEach(function(el){
      var type = (el.type || '').toLowerCase();
      if (type === 'file' || type === 'button' || type === 'submit') { out.push(null); return; }
      out.push({ v: el.value, c: !!el.checked });
    });
    return { fields: out, scroll: box.scrollTop };
  }
  function applySnapshot(snap){
    var box = document.querySelector('#layer .modal'); if (!box || !snap) return;
    var els = box.querySelectorAll('input,textarea,select');
    // Only when the window has the same shape as when it was parked; a different
    // one (it was rebuilt while parked) keeps its own values rather than being
    // scrambled by stale ones.
    if (els.length !== snap.fields.length) return;
    els.forEach(function(el, i){
      var f = snap.fields[i]; if (!f) return;
      var type = (el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') el.checked = f.c; else el.value = f.v;
    });
    box.scrollTop = snap.scroll || 0;
  }

  function trayHtml(){
    if (!D.items.length) return '';
    return '<div id="win-tray" role="toolbar" aria-label="Minimised windows">' +
      D.items.map(function(it){
        return '<div class="win-chip" role="button" tabindex="0" title="Open ' + esc(it.title) + '" onclick="Dock.restore(\'' + it.id + '\')">' +
          '<span class="wt">' + esc(it.title) + '</span>' +
          '<button type="button" class="wx" aria-label="Close ' + esc(it.title) + '" title="Close (discards it)" onclick="event.stopPropagation();Dock.discard(\'' + it.id + '\')">×</button>' +
        '</div>';
      }).join('') + '</div>';
  }

  function barHtml(html){
    var title = titleOf(html);
    return '<div class="win-bar"><span class="win-t">' + esc(title) + '</span><span class="win-b">' +
      '<button type="button" aria-label="Minimise" title="Minimise — keep it, look around" onclick="event.stopPropagation();Dock.minimise()">–</button>' +
      '<button type="button" aria-label="Full screen" title="Full screen" onclick="event.stopPropagation();Dock.toggleMax()">▢</button>' +
      '<button type="button" aria-label="Close" title="Close" onclick="event.stopPropagation();Dock.close()">×</button>' +
    '</span></div>';
  }

  // Decorate what renderModal() drew: the title bar inside the first modal, the
  // maximise class on its overlay, and the tray after it.
  var _renderModal = window.renderModal;
  window.renderModal = function(){
    var h = _renderModal.apply(this, arguments) || '';
    if (!STATE.modal) D.max = false;
    if (h && typeof STATE.modal === 'string' && parkable(STATE.modal) && h.indexOf('<div class="overlay"') === 0) {
      h = h.replace('<div class="overlay"', '<div class="overlay' + (D.max ? ' win-max' : '') + '"');
      h = h.replace(/<div class="modal/, '<div class="winbar modal').replace(/(<div class="winbar modal[^>]*>)/, '$1' + barHtml(STATE.modal));
    }
    return h + trayHtml();
  };

  var Dock = window.Dock = {
    parkable: function(){ return parkable(STATE.modal); },
    count: function(){ return D.items.length; },
    parkedKinds: function(){ return D.items.map(function(i){ return i.kind; }); },

    minimise: function(){
      if (!parkable(STATE.modal)) return false;
      if (D.items.length >= MAX_PARKED) { showToast('Close one of the minimised windows first (' + MAX_PARKED + ' at most)', 'error'); return false; }
      var snap = snapshot(), html = STATE.modal;
      D.items.push({ id: 'w' + (++D.seq), kind: kindOf(html), title: titleOf(html), html: html, fields: snap.fields, scroll: snap.scroll, max: D.max });
      STATE.modal = null; D.max = false; render();
      return true;
    },
    // Bring a parked window back exactly as it was left. If another window is on
    // screen it is parked first (swap) — nothing on screen is thrown away.
    restore: function(id){
      var i = D.items.findIndex(function(x){ return x.id === id; }); if (i < 0) return false;
      if (STATE.modal) {
        if (!parkable(STATE.modal)) { showToast('Finish the open question first', 'info'); return false; }
        if (!Dock.minimise()) return false;
        i = D.items.findIndex(function(x){ return x.id === id; });
      }
      var it = D.items.splice(i, 1)[0];
      STATE.modal = it.html; D.max = !!it.max; render();
      applySnapshot({ fields: it.fields, scroll: it.scroll });
      return true;
    },
    restoreKind: function(kind){
      var it = D.items.filter(function(x){ return x.kind === kind; })[0];
      return it ? Dock.restore(it.id) : false;
    },
    // Close a parked window for good (the chip's ×). A window that keeps state
    // elsewhere registers a hook so that state goes too.
    discard: function(id){
      var i = D.items.findIndex(function(x){ return x.id === id; }); if (i < 0) return;
      var it = D.items.splice(i, 1)[0];
      try { if (it.kind && hooks.discard[it.kind]) hooks.discard[it.kind](it); } catch (_) {}
      render();
    },
    onDiscard: function(kind, fn){ hooks.discard[kind] = fn; },
    // The window on screen, closed.
    close: function(){ D.max = false; closeModal(); },
    // Live-element class toggle — see the header: never a render().
    toggleMax: function(){
      var ov = document.querySelector('#layer .overlay'); if (!ov) return;
      D.max = !D.max; ov.classList.toggle('win-max', D.max);
    },
    // A parked window that repaints itself must not open. True = the html went to
    // its chip and the caller must stop.
    updateParked: function(kind, html){
      var it = D.items.filter(function(x){ return x.kind === kind; })[0]; if (!it) return false;
      it.html = html; it.title = titleOf(html); it.fields = []; render();
      return true;
    },

    // ── drawers (a candidate or client record) — parked by reopening ──────────
    registerDrawer: function(kind, h){ hooks.drawer[kind] = h; },
    parkDrawer: function(kind){
      var h = hooks.drawer[kind]; if (!h) return;
      var rec = h.current(); if (!rec || !rec.id) return;
      if (D.items.length >= MAX_PARKED) { showToast('Close one of the minimised windows first (' + MAX_PARKED + ' at most)', 'error'); return; }
      D.items = D.items.filter(function(x){ return !(x.kind === 'drawer:' + kind && x.key === rec.id); });
      D.items.push({ id: 'w' + (++D.seq), kind: 'drawer:' + kind, key: rec.id, title: rec.title || 'Record', html: '', fields: [], scroll: 0, drawer: kind });
      h.close();   // closes the drawer and repaints
    },
    restoreDrawer: function(id){
      var i = D.items.findIndex(function(x){ return x.id === id; }); if (i < 0) return;
      var it = D.items.splice(i, 1)[0], h = hooks.drawer[it.drawer];
      if (h) h.open(it.key); else render();
    }
  };

  // The two record drawers. Their functions are looked up when used (they load
  // after this file), so nothing here needs them to exist yet.
  Dock.registerDrawer('candidate', {
    current: function(){
      var p = STATE.bd && STATE.bd.profileOpen && STATE.bd.profile; if (!p) return null;
      return { id: p.id, title: (p.candidate && p.candidate.full_name) || 'Candidate' };
    },
    close: function(){ window.cpClose(); },
    open: function(id){ window.bdOpenCandidate(id); }
  });
  Dock.registerDrawer('client', {
    current: function(){
      var id = STATE.page === 'clients' && STATE.clients && STATE.clients.selectedId; if (!id) return null;
      var row = ((STATE.clients && STATE.clients.list) || []).filter(function(c){ return c.id === id; })[0] || {};
      return { id: id, title: row.name || 'Client' };
    },
    close: function(){ window.clientsBack(); },
    open: function(id){ if (STATE.page !== 'clients') goPage('clients'); window.clientsOpen(id); }
  });

  // A drawer chip reopens by record; a modal chip restores its html.
  var _restore = Dock.restore;
  Dock.restore = function(id){
    var it = D.items.filter(function(x){ return x.id === id; })[0];
    if (it && it.drawer) return Dock.restoreDrawer(id);
    return _restore(id);
  };
})();
