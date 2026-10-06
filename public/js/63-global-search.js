// ── SEARCH EVERYTHING (R-123) ────────────────────────────────────────────────
// The box in the sky header. Type two letters and it asks GET /search, which
// answers candidates, leads, jobs and clients — each narrowed by the SAME rule
// as the list it comes from (routes/search.js), so nothing appears here that
// the person could not already open. Enter or a click opens the record with
// the action that page already uses; ⌘K / Ctrl+K jumps into the box.
//
// WHY THE TEXT LIVES IN STATE. The top bar is a render region and repaints
// when its html moves (the date line, a count). The box is drawn from
// STATE.gsearch, so a repaint draws exactly what was typed, and putRegion()
// puts focus and the caret back (by the input's id).
(function(){
  STATE.gsearch = STATE.gsearch || { q:'', res:null, open:false, loading:false, sel:0 };
  var timer = null, seq = 0;
  var KINDS = [
    { key:'candidates', label:'Candidates' },
    { key:'leads',      label:'Leads' },
    { key:'jobs',       label:'Jobs' },
    { key:'clients',    label:'Clients' }
  ];

  // The shortcut hint names the key the person actually has: ⌘ on a Mac and an
  // iPad/iPhone, Ctrl everywhere else. (Either key already works — see the
  // keydown listener below — this only decides what we SAY.)
  function isMac(){
    try{
      var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
      return /mac|iphone|ipad|ipod/i.test(p);
    }catch(e){ return false; }
  }
  window.paceIsMac = isMac;

  function flat(res){
    var out = [];
    if (!res) return out;
    KINDS.forEach(function(k){ (res[k.key] || []).forEach(function(r){ out.push({ kind:k.key, r:r }); }); });
    return out;
  }

  function panel(){
    var g = STATE.gsearch;
    if (!g.open || String(g.q).trim().length < 2) return '';
    if (g.loading && !g.res) return '<div class="gs-panel"><div class="gs-note">Searching…</div></div>';
    var res = g.res || {}, rows = flat(res), i = 0;
    var body = KINDS.map(function(k){
      var list = res[k.key] || [];
      if (!list.length) return '';
      return '<div class="gs-group">' + k.label + '</div>' + list.map(function(r){
        var idx = i++;
        return '<div class="gs-row' + (idx === g.sel ? ' on' : '') + '" onmousedown="gsearchPick(event,' + idx + ')">' +
          '<span class="gs-title">' + htmlEsc(r.title || '') + '</span>' +
          (r.sub ? '<span class="gs-sub">' + htmlEsc(r.sub) + '</span>' : '') + '</div>';
      }).join('');
    }).join('');
    var failed = (res.failed || []).map(function(f){ return f.charAt(0).toUpperCase() + f.slice(1); });
    var note = failed.length ? '<div class="gs-note is-err">Could not search ' + htmlEsc(failed.join(', ').toLowerCase()) + ' just now — try again.</div>' : '';
    if (!rows.length) body = '<div class="gs-note">Nothing found for “' + htmlEsc(g.q.trim()) + '”.</div>';
    return '<div class="gs-panel">' + body + note + '</div>';
  }

  // Drawn by renderTopbar() (04-shell-login.js).
  window.paceSearchBox = function(){
    if (!STATE.user) return '';
    var g = STATE.gsearch;
    return '<div class="tb-search' + (g.open ? ' is-open' : '') + '">' +
      '<span class="gs-ic">' + UI.ic('search') + '</span>' +
      '<input id="gsearch-in" type="search" autocomplete="off" spellcheck="false" ' +
        'placeholder="Search candidates, leads, jobs, clients…" aria-label="Search everything" ' +
        'value="' + htmlEsc(g.q) + '" oninput="gsearchInput(this.value)" onkeydown="gsearchKey(event)" ' +
        'onfocus="gsearchFocus()" onblur="gsearchBlur()">' +
      '<kbd class="gs-kbd" title="Press ' + (isMac() ? '⌘K' : 'Ctrl+K') + ' to search from anywhere">' + (isMac() ? '⌘K' : 'Ctrl K') + '</kbd>' + panel() +
    '</div>';
  };

  window.gsearchInput = function(v){
    var g = STATE.gsearch;
    g.q = v; g.open = true; g.sel = 0;
    if (timer) clearTimeout(timer);
    if (String(v).trim().length < 2) { g.res = null; g.loading = false; render(); return; }
    timer = setTimeout(function(){
      var mine = ++seq, q = String(g.q).trim();
      g.loading = true;
      apiGet('/search?q=' + encodeURIComponent(q)).then(function(r){
        if (mine !== seq) return;                 // a later keystroke owns the box
        g.res = r || null; g.loading = false; render();
      }).catch(function(){
        if (mine !== seq) return;
        g.res = { failed:['candidates','leads','jobs','clients'] }; g.loading = false; render();
      });
    }, 220);
  };
  window.gsearchFocus = function(){ if (STATE._rendering) return; /* focus put back by a repaint, not a click */ var g = STATE.gsearch; if (!g.open && String(g.q).trim().length >= 2) { g.open = true; render(); } };
  window.gsearchBlur = function(){
    if (STATE._rendering) return;                 // a repaint, not the person leaving
    setTimeout(function(){
      var el = document.getElementById('gsearch-in');
      if (el && document.activeElement === el) return;
      if (STATE.gsearch.open) { STATE.gsearch.open = false; render(); }
    }, 120);
  };
  window.gsearchKey = function(ev){
    var g = STATE.gsearch, rows = flat(g.res);
    if (ev.key === 'Escape') { ev.preventDefault(); ev.target.blur(); g.open = false; render(); return; }
    if (!rows.length) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); g.sel = (g.sel + 1) % rows.length; render(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); g.sel = (g.sel - 1 + rows.length) % rows.length; render(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); open(rows[Math.min(g.sel, rows.length - 1)]); }
  };
  window.gsearchPick = function(ev, idx){
    ev.preventDefault();                          // keep focus; the pick closes the box
    var row = flat(STATE.gsearch.res)[idx];
    if (row) open(row);
  };

  // Each kind opens the way its own page already does.
  function open(row){
    var g = STATE.gsearch;
    g.open = false; g.q = ''; g.res = null; g.sel = 0;
    var el = document.getElementById('gsearch-in'); if (el) el.blur();
    render();                                     // the box closes first — whatever opens next
    var id = row.r.id;
    if (row.kind === 'candidates' && window.bdOpenCandidate) return bdOpenCandidate(id);
    if (row.kind === 'jobs' && window.bdOpenJobOrder) return bdOpenJobOrder(id);
    if (row.kind === 'clients') { goPage('clients'); if (window.clientsOpen) clientsOpen(id); return; }
    if (row.kind === 'leads' && typeof openJob === 'function') {
      if (typeof jobById === 'function' && jobById(id)) return openJob(id);
      // Not in the loaded list yet (a lead assigned a minute ago): read it, then open.
      var go = function(){ if (jobById(id)) openJob(id); else showToast('That lead could not be opened — refresh and try again.', 'error'); };
      if (typeof refreshJobs === 'function') return Promise.resolve(refreshJobs()).then(go, go);
      return go();
    }
  }

  // ⌘K / Ctrl+K from anywhere.
  document.addEventListener('keydown', function(ev){
    if ((ev.metaKey || ev.ctrlKey) && String(ev.key).toLowerCase() === 'k') {
      var el = document.getElementById('gsearch-in');
      if (el) { ev.preventDefault(); el.focus(); el.select(); }
    }
  });
})();
