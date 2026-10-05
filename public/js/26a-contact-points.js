// ============================================================================
// SEVERAL EMAILS AND PHONE NUMBERS PER PERSON (R-114, D-0070) — the one small
// control that the Add/Edit Candidate window and the candidate's header share.
//
// A person has ONE main email and ONE main phone (`email`, `phone`, drawn by the
// caller exactly as before) and any number of extras (`extra_emails`,
// `extra_phones`). This file draws the extras UNDER the main and owns the three
// gestures: "+ add another", "Make main" (the tick-or-click the owner asked for),
// and ✕. Every email goes to the MAIN only — the server enforces that and the
// opt-out rule (an address that opted out can never be made main).
//
// Two kinds of place hold a person:
//   • a FORM (Add/Edit Candidate): nothing is saved until Save, so the gestures
//     only change the form's own copy and redraw the window;
//   • a LIVE view (the candidate header): each gesture is saved at once, through
//     the same PUT the form uses, and the profile is reloaded.
// A place registers itself with CP.register(scope, cfg); `cfg.save` present = live.
//
// The swap below is the browser's twin of services/contact-points.js `makeMain`
// (a form that is not saved cannot ask the server). test/contact-points-ui-smoke
// runs both over the same cases so they cannot drift apart.
// ============================================================================
(function(){
  'use strict';

  var KINDS = {
    email: { main:'email', extra:'extra_emails', word:'email address', add:'+ add another email', ph:'another@example.com', type:'email' },
    phone: { main:'phone', extra:'extra_phones', word:'phone number',  add:'+ add another number', ph:'(555) 123-4567', type:'tel' }
  };
  var scopes = {};

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function norm(kind, v){
    v = String(v==null?'':v).trim();
    return kind==='email' ? v.toLowerCase() : v.replace(/\D/g,'').slice(-10);
  }
  function extrasOf(m, kind){ var a = m && m[KINDS[kind].extra]; return Array.isArray(a) ? a : []; }

  // Swap the extra at `idx` into the main spot; the old main takes its place.
  // Returns { main, extras } — or null when there is nothing at idx.
  function swap(m, kind, idx){
    var k = KINDS[kind], extras = extrasOf(m, kind).slice();
    if (idx < 0 || idx >= extras.length) return null;
    var chosen = String(extras[idx]).trim(), old = String(m[k.main]==null?'':m[k.main]).trim();
    if (old) extras[idx] = old; else extras.splice(idx, 1);
    return { main: kind==='email' ? chosen.toLowerCase() : chosen, extras: extras };
  }

  // A FORM is changed in place: only the extras block (and the main box, on Make main) is
  // touched — the window is NOT redrawn. A redraw of a long form throws away the scroll, the
  // cursor and the user's place (the render engine writes only what changed; so do we).
  // The caller marks its main input with data-cp-main="<scope>-<kind>".
  function blockOf(scope, kind){ return document.querySelector('[data-cp="'+scope+'-'+kind+'"]'); }
  function refreshBlock(scope, kind){
    var el = blockOf(scope, kind), m = modelOf(scope);
    if (!el || !m) return false;
    var tmp = document.createElement('div');
    tmp.innerHTML = formHtml(scope, kind, m);
    el.parentNode.replaceChild(tmp.firstChild, el);
    return true;
  }
  function setMainBox(scope, kind, v){
    var i = document.querySelector('[data-cp-main="'+scope+'-'+kind+'"]');
    if (i) i.value = v;
    return !!i;
  }
  function focusId(id){ var el = document.getElementById(id); if (el) el.focus(); }
  // the live header redraws through its own reload; give the page a frame to paint first
  function focusSoon(id){
    var n = 0;
    (function go(){ var el = document.getElementById(id); if (el) { el.focus(); return; } if (++n < 30) requestAnimationFrame(go); })();
  }
  function toast(msg){ if (window.showToast) window.showToast(msg, 'error'); }

  function cfgOf(scope){ return scopes[scope] || null; }
  function modelOf(scope){ var c = cfgOf(scope); return c && c.model ? c.model() : null; }

  // ── drawing ───────────────────────────────────────────────────────────────
  // FORM: each extra is an input with Make main and ✕ beside it.
  function formHtml(scope, kind, m){
    var k = KINDS[kind], rows = extrasOf(m, kind).map(function(v, i){
      return '<div class="cp-row" data-cp-row="'+kind+'-'+i+'">'+
        '<input class="sel" id="cp-'+scope+'-'+kind+'-'+i+'" type="'+k.type+'" value="'+esc(v)+'" placeholder="'+esc(k.ph)+'" '+
          'oninput="CP.set(\''+scope+'\',\''+kind+'\','+i+',this.value)">'+
        '<button type="button" class="cp-link" title="Send emails to this '+k.word+' instead" onclick="CP.makeMain(\''+scope+'\',\''+kind+'\','+i+')">Make main</button>'+
        '<button type="button" class="cp-x" title="Remove" aria-label="Remove this '+k.word+'" onclick="CP.remove(\''+scope+'\',\''+kind+'\','+i+')">✕</button>'+
      '</div>';
    }).join('');
    return '<div class="cp-extras" data-cp="'+scope+'-'+kind+'">'+rows+
      '<button type="button" class="cp-add" onclick="CP.add(\''+scope+'\',\''+kind+'\')">'+k.add+'</button></div>';
  }
  // LIVE: each extra is a line of text with Make main and ✕; adding opens one input.
  function liveHtml(scope, kind, m, cfg){
    var k = KINDS[kind], rows = extrasOf(m, kind).map(function(v, i){
      var shown = kind==='email'
        ? '<a href="#" onclick="event.preventDefault();event.stopPropagation();mbComposeTo(decodeURIComponent(\''+encodeURIComponent(v).replace(/\x27/g,'%27')+'\'))" title="Write to this person in PACE">'+esc(v)+'</a>'
        : '<a href="tel:'+esc(String(v).replace(/[^0-9+]/g,''))+'">'+esc(v)+'</a>';
      return '<div class="cp-row cp-live" data-cp-row="'+kind+'-'+i+'"><span class="cp-val">'+shown+'</span>'+
        '<button type="button" class="cp-link" title="Send emails to this '+k.word+' instead" onclick="CP.makeMain(\''+scope+'\',\''+kind+'\','+i+')">Make main</button>'+
        '<button type="button" class="cp-x" title="Remove" aria-label="Remove this '+k.word+'" onclick="CP.remove(\''+scope+'\',\''+kind+'\','+i+')">✕</button></div>';
    }).join('');
    var adding = cfg.adding === kind;
    var addRow = adding
      ? '<div class="cp-row"><input class="sel" id="cp-'+scope+'-'+kind+'-new" type="'+k.type+'" placeholder="'+esc(k.ph)+'" '+
          'onkeydown="if(event.key===\'Enter\'){event.preventDefault();CP.commitAdd(\''+scope+'\',\''+kind+'\')}else if(event.key===\'Escape\'){CP.cancelAdd(\''+scope+'\')}">'+
          '<button type="button" class="cp-link" onclick="CP.commitAdd(\''+scope+'\',\''+kind+'\')">Add</button>'+
          '<button type="button" class="cp-x" aria-label="Cancel" onclick="CP.cancelAdd(\''+scope+'\')">✕</button></div>'
      : '<button type="button" class="cp-add" onclick="CP.add(\''+scope+'\',\''+kind+'\')">'+k.add+'</button>';
    return '<div class="cp-extras" data-cp="'+scope+'-'+kind+'">'+rows+addRow+'</div>';
  }

  var CP = {
    KINDS: KINDS, swap: swap, norm: norm,

    register: function(scope, cfg){ scopes[scope] = cfg; },
    // a place that is drawn many times (one per contact row) registers ONCE — a repeat would reset its state
    has: function(scope){ return !!scopes[scope]; },

    // The block to place UNDER the main input / value.
    extras: function(scope, kind){
      var cfg = cfgOf(scope), m = modelOf(scope);
      if (!cfg || !m || !KINDS[kind]) return '';
      return cfg.save ? liveHtml(scope, kind, m, cfg) : formHtml(scope, kind, m);
    },

    set: function(scope, kind, idx, v){
      var m = modelOf(scope); if (!m) return;
      var list = extrasOf(m, kind); if (idx < list.length) list[idx] = v;
    },

    add: function(scope, kind){
      var cfg = cfgOf(scope), m = modelOf(scope); if (!cfg || !m) return;
      if (cfg.save){
        cfg.adding = kind;
        cfg.rerender();
        focusSoon('cp-'+scope+'-'+kind+'-new');
        return;
      }
      var key = KINDS[kind].extra;
      if (!Array.isArray(m[key])) m[key] = [];
      m[key].push('');
      var at = m[key].length - 1;
      if (!refreshBlock(scope, kind)) cfg.rerender();
      focusId('cp-'+scope+'-'+kind+'-'+at);
    },

    cancelAdd: function(scope){ var cfg = cfgOf(scope); if (!cfg) return; cfg.adding = null; cfg.rerender(); },

    commitAdd: function(scope, kind){
      var cfg = cfgOf(scope), m = modelOf(scope); if (!cfg || !m) return;
      var el = document.getElementById('cp-'+scope+'-'+kind+'-new');
      var v = el ? String(el.value||'').trim() : '';
      if (!v){ cfg.adding = null; cfg.rerender(); return; }
      var patch = {}; patch[KINDS[kind].extra] = extrasOf(m, kind).concat([v]);
      cfg.adding = null;
      cfg.save(patch);
    },

    remove: function(scope, kind, idx){
      var cfg = cfgOf(scope), m = modelOf(scope); if (!cfg || !m) return;
      var key = KINDS[kind].extra, list = extrasOf(m, kind).slice();
      if (idx >= list.length) return;
      list.splice(idx, 1);
      if (cfg.save){ var patch = {}; patch[key] = list; cfg.save(patch); return; }
      m[key] = list;
      if (!refreshBlock(scope, kind)) cfg.rerender();
    },

    // The tick-or-click: this one becomes the main; the old main goes into the extras.
    makeMain: function(scope, kind, idx){
      var cfg = cfgOf(scope), m = modelOf(scope); if (!cfg || !m) return;
      var s = swap(m, kind, idx); if (!s) return;
      var k = KINDS[kind];
      if (cfg.save){ var patch = {}; patch[k.main] = s.main; patch[k.extra] = s.extras; cfg.save(patch); return; }
      m[k.main] = s.main; m[k.extra] = s.extras;
      // the main box is the caller's: set it in place, and redraw only the extras block
      if (!(setMainBox(scope, kind, s.main) && refreshBlock(scope, kind))) cfg.rerender();
    },

    toast: toast
  };

  window.CP = CP;
})();
