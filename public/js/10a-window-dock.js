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
//    while parked. The mailbox paints only a window that is on screen (a parked one is
//    redrawn from its own draft when it comes back — see onPark below). Dock.updateParked
//    is the older way for a window with no draft object: html straight to the chip.
//  * Not parkable: an alert dialog (role="alertdialog" — a question that needs an
//    answer), anything marked data-nowin, and modals held as objects
//    (jobDetail/addJob/addContact) rather than a string.
//  * Drawers (a candidate or client record) are parked by REOPENING: the chip
//    remembers which record and opens it again — a record is data, not a form.
//
//  * SEVERAL WINDOWS OF ONE KIND (two new messages, replies to different emails) need one draft each. A kind
//    registers Dock.onPark(kind, { take, put, render, title }): on minimise `take()` hands the window's OWN draft
//    object to the chip (and empties the page's single slot); on bring-back `put(ctx)` puts it back and `render(ctx)`
//    draws the window afresh from it — so what comes back is what was typed, never a copy drawn before the typing.
//  * The tray sits bottom-right; a chip drags ANYWHERE on screen and a drag never opens it (R-240).
//
// Nothing here talks to the server, so nothing here can lose or send anything.
(function () {
  var MAX_PARKED = 6;
  var D = STATE.dock = STATE.dock || { items: [], max: false, seq: 0 };
  var hooks = { discard: {}, drawer: {}, park: {} };

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

  function short(t){ t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 42 ? t.slice(0, 41) + '…' : (t || 'Window'); }

  // What is typed into the live window, in document order. Nothing else holds it.
  function snapshot(){
    var box = document.querySelector('#layer .modal'); if (!box) return { fields: [], edits: [], scroll: 0 };
    var out = [];
    box.querySelectorAll('input,textarea,select').forEach(function(el){
      var type = (el.type || '').toLowerCase();
      if (type === 'file' || type === 'button' || type === 'submit') { out.push(null); return; }
      out.push({ v: el.value, c: !!el.checked });
    });
    // A rich-text box (the message body) is not an input: its words live only in the DOM, and the html parked
    // with the window was drawn BEFORE they were typed. Without this the body comes back blank.
    var edits = [];
    box.querySelectorAll('[contenteditable="true"]').forEach(function(el){ edits.push(el.innerHTML); });
    return { fields: out, edits: edits, scroll: box.scrollTop };
  }
  function applySnapshot(snap){
    var box = document.querySelector('#layer .modal'); if (!box || !snap) return;
    var eds = box.querySelectorAll('[contenteditable="true"]');
    if (snap.edits && eds.length === snap.edits.length) {
      eds.forEach(function(el, i){
        el.innerHTML = snap.edits[i];
        el.classList.toggle('is-empty', !String(el.textContent || '').replace(/\u00a0/g, ' ').trim());
      });
    }
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
        var placed = typeof it.x === 'number' && typeof it.y === 'number';
        return '<div class="win-chip' + (placed ? ' win-chip-x' : '') + '" data-id="' + it.id + '" role="button" tabindex="0" title="Open ' + esc(it.title) + '"' +
          (placed ? ' style="--chip-x:' + it.x + 'px;--chip-y:' + it.y + 'px"' : '') +
          ' onclick="Dock.restore(\'' + it.id + '\')">' +
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
      var snap = snapshot(), html = STATE.modal, kind = kindOf(html), h = hooks.park[kind];
      var ctx = h && h.take ? h.take() : undefined;     // the window's own draft goes with its chip
      var title = (h && h.title && ctx && h.title(ctx)) || titleOf(html);
      D.items.push({ id: 'w' + (++D.seq), kind: kind, title: short(title), html: html, ctx: ctx, fields: snap.fields, edits: snap.edits, scroll: snap.scroll, max: D.max });
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
      var it = D.items.splice(i, 1)[0], ph = it.kind && hooks.park[it.kind];
      if (ph && it.ctx) {
        ph.put(it.ctx);
        var fresh = ph.render ? ph.render(it.ctx) : '';
        if (fresh) { it.html = fresh; it.fields = []; it.edits = []; }   // drawn from the draft itself: nothing stale to re-fill
      }
      STATE.modal = it.html; D.max = !!it.max; render();
      applySnapshot({ fields: it.fields, edits: it.edits, scroll: it.scroll });
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
    // Discard a parked window by its kind (a send finished while its window was minimised).
    discardKind: function(kind){
      var it = D.items.filter(function(x){ return x.kind === kind; })[0];
      if (it) Dock.discard(it.id);
    },
    onDiscard: function(kind, fn){ hooks.discard[kind] = fn; },
    onPark: function(kind, h){ hooks.park[kind] = h; },
    // The parked windows of one kind, each with the draft it holds.
    parked: function(kind){ return D.items.filter(function(x){ return x.kind === kind; }).map(function(x){ return { id: x.id, ctx: x.ctx, title: x.title }; }); },
    // A window finished (its send went through) while it sat on the tray: take that chip away, whichever it is.
    discardCtx: function(ctx){
      var i = D.items.findIndex(function(x){ return ctx && x.ctx === ctx; }); if (i < 0) return false;
      D.items.splice(i, 1); render(); return true;
    },
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
      it.html = html; it.title = titleOf(html); it.fields = []; it.edits = []; render();
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

  // Drag a parked chip ANYWHERE on screen (R-240). A drag does not open it. The spot is remembered until reload
  // (it lives on the chip, not in storage). A phone (860px and under) keeps the scrolling row — no free drag.
  var drag = null;
  function phoneTray(){ return window.matchMedia && window.matchMedia('(max-width: 860px)').matches; }
  document.addEventListener('pointerdown', function(e){
    D.suppressClick = false;
    if (phoneTray() || e.button) return;
    var chip = e.target.closest && e.target.closest('#win-tray .win-chip');
    if (!chip || (e.target.closest && e.target.closest('.wx'))) return;
    var id = chip.getAttribute('data-id');
    var it = D.items.filter(function(x){ return x.id === id; })[0];
    if (!it) return;
    var r = chip.getBoundingClientRect();
    drag = { id: id, startX: e.clientX, startY: e.clientY, left: r.left, top: r.top, w: r.width, h: r.height, moved: false, pointer: e.pointerId, chip: chip };
    try { chip.setPointerCapture(e.pointerId); } catch (_) {}
  });
  document.addEventListener('pointermove', function(e){
    if (!drag || e.pointerId !== drag.pointer) return;
    var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    drag.moved = true;
    e.preventDefault();
    var x = Math.round(Math.max(0, Math.min(window.innerWidth - drag.w, drag.left + dx)));
    var y = Math.round(Math.max(0, Math.min(window.innerHeight - drag.h, drag.top + dy)));
    var it = D.items.filter(function(i){ return i.id === drag.id; })[0];
    if (it) { it.x = x; it.y = y; }
    drag.chip.classList.add('win-chip-x', 'is-drag');
    drag.chip.style.setProperty('--chip-x', x + 'px');
    drag.chip.style.setProperty('--chip-y', y + 'px');
  });
  function endDrag(e){
    if (!drag || (e && e.pointerId !== drag.pointer)) return;
    var moved = drag.moved;
    if (drag.chip) drag.chip.classList.remove('is-drag');
    drag = null;
    if (moved) D.suppressClick = true;
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // A drawer chip reopens by record; a modal chip restores its html.
  var _restore = Dock.restore;
  Dock.restore = function(id){
    // A drag along the bottom ends in a click. That click must not open the window.
    if (D.suppressClick) { D.suppressClick = false; return false; }
    var it = D.items.filter(function(x){ return x.id === id; })[0];
    if (it && it.drawer) return Dock.restoreDrawer(id);
    return _restore(id);
  };
})();
