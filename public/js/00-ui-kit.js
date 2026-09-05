// ════════════════════════════════════════════════════════════════════════════
// UI KIT — the shared vocabulary every page draws with.
//
// Loads FIRST and defines nothing but pure string builders, so it is safe at
// the head of the load order: no state, no DOM, no side effects. Pages call
// these instead of hand-rolling another table/badge/toolbar, which is how the
// app stops looking like eleven different products stitched together.
//
// Everything here returns an HTML STRING, matching the rest of the frontend's
// render-to-string convention. No component framework, no build step.
// ════════════════════════════════════════════════════════════════════════════

window.UI = (function () {

  function esc(s){
    return String(s==null?'':s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  // For an inline onclick="…" attribute. Single quotes are the killer.
  function attr(s){ return esc(s).replace(/&#39;/g,'\\&#39;'); }

  // ── Icons ────────────────────────────────────────────────────────────────
  // One stroked family at 1.7 so they sit at the same visual weight whatever
  // the slot. Kept separate from the older icon() in 03-core-render.js, which
  // is still used by pages that haven't moved over.
  var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
  var ICONS = {
    grid:      S+'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
    send:      S+'<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>',
    check:     S+'<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    inbox:     S+'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>',
    search:    S+'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    users:     S+'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    user:      S+'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    shield:    S+'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
    mail:      S+'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
    mailopen:  S+'<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"/><path d="m22 10-8.97 5.7a2 2 0 0 1-2.06 0L2 10"/></svg>',
    doc:       S+'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h6"/></svg>',
    chart:     S+'<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12.5" y="7" width="3" height="11"/><rect x="18" y="10" width="3" height="8"/></svg>',
    wallet:    S+'<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M18 12h.01"/></svg>',
    more:      S+'<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></svg>',
    dots:      S+'<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/></svg>',
    cog:       S+'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
    bell:      S+'<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    bolt:      S+'<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>',
    filter:    S+'<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z"/></svg>',
    sliders:   S+'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
    refresh:   S+'<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>',
    unlink:    S+'<path d="M18.84 12.25l1.72-1.71a4.24 4.24 0 0 0-6-6l-1.71 1.72"/><path d="M5.17 11.75l-1.71 1.71a4.24 4.24 0 0 0 6 6l1.71-1.71"/><path d="M8 2v3M2 8h3M16 19v3M19 16h3"/></svg>',
    trash:     S+'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    tag:       S+'<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.8 8.8a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8Z"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/></svg>',
    dl:        S+'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
    plus:      S+'<path d="M12 5v14M5 12h14"/></svg>',
    x:         S+'<path d="M18 6 6 18M6 6l12 12"/></svg>',
    menu:      S+'<path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    left:      S+'<path d="m15 18-6-6 6-6"/></svg>',
    up:        S+'<path d="m18 15-6-6-6 6"/></svg>',
    down:      S+'<path d="m6 9 6 6 6-6"/></svg>',
    right:     S+'<path d="m9 18 6-6-6-6"/></svg>',
    eye:       S+'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    reply:     S+'<path d="M9 17l-5-5 5-5"/><path d="M4 12h11a5 5 0 0 1 5 5v2"/></svg>',
    click:     S+'<path d="m9 9 5 12 1.8-5.2L21 14 9 9Z"/><path d="M7.2 2.2 8 5M2.2 7.2 5 8M5.9 4.6 4 6.5"/></svg>',
    thumb:     S+'<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
    note:      S+'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/></svg>',
    phone:     S+'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>',
    cal:       S+'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    dollar:    S+'<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    building:  S+'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/></svg>',
    flame:     S+'<path d="M12 2c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 1.5 1 2 1.5 2C11.5 7 12 4 12 2Z"/></svg>',
    star:      S+'<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21l1.2-6.9-5-4.9 6.9-1L12 2Z"/></svg>',
    pause:     S+'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    play:      S+'<path d="M6 3v18l15-9L6 3Z"/></svg>',
    ban:       S+'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
    flag:      S+'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z"/><path d="M4 22v-7"/></svg>',
    chat:      S+'<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 4 11.5a8.4 8.4 0 0 1 8.5-8.4 8.4 8.4 0 0 1 8.5 8.4Z"/></svg>',
    feedback:  S+'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    verified:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>'
  };
  function ic(name){ return ICONS[name] || ICONS.grid; }

  // ── Page tabs ────────────────────────────────────────────────────────────
  // tabs([{id,label,n,onclick}], activeId, rightHtml)
  function tabs(items, active, right){
    var t = (items||[]).map(function(i){
      var on = i.id === active;
      var n  = (i.n===0||i.n) ? '<span class="pgtab-n">'+esc(i.n)+'</span>' : '';
      var ico= i.icon ? ic(i.icon) : '';
      return '<div class="pgtab'+(on?' on':'')+'"'+(i.onclick?' onclick="'+i.onclick+'"':'')+'>'+
        ico+esc(i.label)+n+'</div>';
    }).join('');
    return '<div class="pgtabs">'+t+(right?'<div class="pgtabs-right">'+right+'</div>':'')+'</div>';
  }

  // ── Stat strip ───────────────────────────────────────────────────────────
  // strip([{v,label,icon,onclick,on,sub}]) — a "-" for a value that is genuinely
  // zero-because-nothing-happened reads better than a 0, so pass it explicitly.
  function strip(items){
    return '<div class="strip">'+(items||[]).map(function(i){
      if (i.sep) return '<div class="strip-sep"></div>';
      return '<div class="strip-i'+(i.onclick?' click':'')+(i.on?' on':'')+'"'+
        (i.onclick?' onclick="'+i.onclick+'"':'')+'>'+
        '<div class="strip-v">'+esc(i.v)+'</div>'+
        '<div class="strip-l">'+(i.icon?ic(i.icon):'')+esc(i.label)+'</div>'+
      '</div>';
    }).join('')+'</div>';
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────
  // toolbar({search:{value,placeholder,oninput,onkeydown}, icons:[…], right:html})
  function toolbar(o){
    o = o || {};
    var h = '';
    if (o.search){
      var s = o.search;
      h += '<div class="tbar-search">'+ic('search')+
        '<input placeholder="'+esc(s.placeholder||'Search')+'" value="'+esc(s.value||'')+'"'+
        (s.oninput?' oninput="'+s.oninput+'"':'')+
        (s.onkeydown?' onkeydown="'+s.onkeydown+'"':'')+'>'+
      '</div>';
    }
    h += (o.icons||[]).map(function(i){
      if (i.sep) return '<div class="tbar-sep"></div>';
      return '<div class="tbar-ico'+(i.on?' on':'')+(i.off?' off':'')+'"'+
        (i.onclick?' onclick="'+i.onclick+'"':'')+
        ' title="'+esc(i.title||'')+'">'+ic(i.icon)+'</div>';
    }).join('');
    if (o.right) h += '<div class="tbar-right">'+o.right+'</div>';
    return '<div class="tbar">'+h+'</div>';
  }

  // ── Table ────────────────────────────────────────────────────────────────
  // table({cols:[{label,icon,cls,w}], rows:[[cell,…]], empty:html, minWidth})
  // Cells are raw HTML — callers build them with the parts below.
  function table(o){
    o = o || {};
    var head = (o.cols||[]).map(function(c){
      if (typeof c === 'string') c = {label:c};
      return '<th'+(c.cls?' class="'+c.cls+'"':'')+(c.w?' style="width:'+c.w+'"':'')+'>'+
        '<span class="th-i">'+(c.icon?ic(c.icon):'')+(c.raw||esc(c.label||''))+'</span></th>';
    }).join('');
    var body = (o.rows||[]).length
      ? o.rows.map(function(r){
          var tr = Array.isArray(r) ? r : r.cells;
          var at = (!Array.isArray(r) && r.onclick) ? ' onclick="'+r.onclick+'" style="cursor:pointer"' : '';
          return '<tr'+at+'>'+tr.map(function(c){
            if (c && typeof c === 'object') return '<td'+(c.cls?' class="'+c.cls+'"':'')+'>'+(c.html||'')+'</td>';
            return '<td>'+(c==null?'':c)+'</td>';
          }).join('')+'</tr>';
        }).join('')
      : '<tr><td colspan="'+((o.cols||[]).length||1)+'"><div class="dt-empty">'+(o.empty||'Nothing here yet.')+'</div></td></tr>';
    return '<div class="dt-wrap"><table class="dt"'+(o.minWidth?' style="min-width:'+o.minWidth+'"':'')+'>'+
      '<thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
  }

  // ── Cells and small parts ────────────────────────────────────────────────
  // The primary column of any list: a bold name that opens the record, with a
  // quiet second line (email, code, company) underneath.
  function idCell(name, sub, onclick, opts){
    opts = opts || {};
    return '<div class="cell-id">'+
      '<b'+(onclick?' onclick="'+onclick+'"':'')+'>'+esc(name||'—')+
        (opts.badge?' '+opts.badge:'')+'</b>'+
      (sub!=null&&sub!==''?'<small>'+esc(sub)+
        (opts.verified?'<span class="verified">'+ic('verified')+'</span>':'')+'</small>':'')+
    '</div>';
  }
  function pill(text, tone, dot){
    tone = tone || 'mute';
    return '<span class="pill '+tone+'">'+(dot?'<i></i>':'')+esc(text)+'</span>';
  }
  function ring(n, tone){
    if (n==null||n==='') return '<span style="color:var(--ink3)">—</span>';
    return '<span class="ring '+(tone||'ok')+'">'+esc(n)+'</span>';
  }
  function toggle(on, onclick){
    return '<span class="sw'+(on?' on':'')+'"'+(onclick?' onclick="'+onclick+'"':'')+'></span>';
  }
  function kebab(onclick){ return '<span class="kebab"'+(onclick?' onclick="'+onclick+'"':'')+'>'+ic('dots')+'</span>'; }
  function check(on, onclick){
    return '<input type="checkbox" class="ck"'+(on?' checked':'')+(onclick?' onclick="'+onclick+'"':'')+'>';
  }
  function dash(v){ return (v==null||v===''||v===0) ? '<span style="color:var(--ink3)">-</span>' : esc(v); }

  function notice(o){
    o = o || {};
    return '<div class="notice">'+
      '<div class="notice-ic">'+ic(o.icon||'flame')+'</div>'+
      '<div><h4>'+esc(o.title||'')+'</h4><p>'+esc(o.body||'')+'</p></div>'+
      (o.action?'<button class="btn btn-outline btn-sm" onclick="'+o.action.onclick+'">'+esc(o.action.label)+'</button>':'')+
    '</div>';
  }

  // ── Key/value list, for the drawer's left pane ───────────────────────────
  function kv(k, v, opts){
    opts = opts || {};
    var empty = (v==null||v===''||v==='—');
    return '<div class="kv"><div class="kv-k">'+esc(k)+'</div>'+
      '<div class="kv-v'+(empty?' empty':'')+'"'+(opts.onclick?' style="cursor:pointer" onclick="'+opts.onclick+'"':'')+'>'+
      (empty ? esc(opts.placeholder||'—') : (opts.html ? v : esc(v)))+'</div></div>';
  }

  // ── Detail drawer ────────────────────────────────────────────────────────
  // drawer({name, sub, acts:[{icon,title,onclick}], stats:[{v,label,icon}],
  //         fields:html, tabs:html, body:html, onclose, onprev, onnext})
  // The scrim closes on a click that started AND ended on the scrim itself, so
  // a text selection dragged out of the panel never dismisses the record.
  function drawer(o){
    o = o || {};
    var acts = (o.acts||[]).map(function(a){
      return '<div class="dwr-act" title="'+esc(a.title||'')+'"'+(a.onclick?' onclick="'+a.onclick+'"':'')+'>'+ic(a.icon)+'</div>';
    }).join('');
    var stats = (o.stats||[]).map(function(s){
      return '<div class="dwr-stat"><b>'+esc(s.v)+'</b><span>'+(s.icon?ic(s.icon):'')+esc(s.label)+'</span></div>';
    }).join('');
    var nav = '<div class="dwr-nav">'+
      '<div title="Close"'+(o.onclose?' onclick="'+o.onclose+'"':'')+'>'+ic('x')+'</div>'+
      (o.onprev?'<div title="Previous" onclick="'+o.onprev+'">'+ic('left')+'</div>':'')+
      (o.onnext?'<div title="Next" onclick="'+o.onnext+'">'+ic('right')+'</div>':'')+
    '</div>';
    return '<div class="dwr-scrim" onmousedown="UI._scrimDown(event)" onclick="UI._scrimUp(event,\''+(o.onclose||'')+'\')">'+
      '<div class="dwr" onmousedown="event.stopPropagation()">'+
        nav+
        '<div class="dwr-pane dwr-left">'+
          '<div class="dwr-head">'+
            '<div style="display:flex;align-items:flex-start;gap:14px">'+
              (o.avatar||'')+
              '<div style="flex:1;min-width:0">'+
                '<div class="dwr-name">'+esc(o.name||'')+'</div>'+
                (o.sub?'<div class="dwr-sub">'+esc(o.sub)+'</div>':'')+
              '</div>'+
              kebab(o.onmenu||'')+
            '</div>'+
            (acts?'<div class="dwr-acts">'+acts+'</div>':'')+
          '</div>'+
          (stats?'<div class="dwr-stats">'+stats+'</div>':'')+
          '<div class="dwr-fields">'+(o.fields||'')+'</div>'+
        '</div>'+
        '<div class="dwr-pane dwr-right">'+(o.tabs||'')+(o.body||'')+'</div>'+
      '</div>'+
    '</div>';
  }
  var _downOnScrim = false;
  function _scrimDown(e){ _downOnScrim = (e.target && e.target.classList.contains('dwr-scrim')); }
  function _scrimUp(e, handler){
    if (!_downOnScrim) return;
    if (!e.target || !e.target.classList.contains('dwr-scrim')) return;
    _downOnScrim = false;
    if (handler) { try { (new Function(handler))(); } catch(err){} }
  }

  // ── Activity feed ────────────────────────────────────────────────────────
  // feed([{day}|{icon,text,time}]) — `text` is trusted HTML so an entry can
  // link the thing it happened to.
  function feed(items){
    if (!items || !items.length) return '<div class="dt-empty">No activity yet.</div>';
    return '<div class="feed">'+items.map(function(i){
      if (i.day) return '<div class="feed-day">'+esc(i.day)+'</div>';
      return '<div class="feed-row">'+
        '<div class="feed-ic">'+ic(i.icon||'bolt')+'</div>'+
        '<div class="feed-tx">'+(i.text||'')+'</div>'+
        '<div class="feed-tm">'+esc(i.time||'')+'</div>'+
      '</div>';
    }).join('')+'</div>';
  }

  // ── Page frame ───────────────────────────────────────────────────────────
  // page({tabs, strip, toolbar, body}) — assembles the standard vertical
  // rhythm so no page has to remember it.
  function page(o){
    o = o || {};
    return '<div class="pg">'+(o.tabs||'')+(o.strip||'')+(o.toolbar||'')+
      '<div class="pg-body">'+(o.body||'')+'</div></div>';
  }

  // ── Overlays ─────────────────────────────────────────────────────────────
  // A drawer has to render ON TOP of whatever page is underneath, which means
  // it cannot live inside #content — that is the page. Modules register a
  // renderer here and the shell calls renderOverlays() once, after the page.
  //
  // Registration is by NAME and idempotent, because module files are evaluated
  // once but wrap render() repeatedly; pushing blindly would stack duplicate
  // drawers on top of each other.
  var _overlays = {};
  var _overlayOrder = [];
  function registerOverlay(name, fn){
    if (!_overlays[name]) _overlayOrder.push(name);
    _overlays[name] = fn;
  }
  function renderOverlays(){
    return _overlayOrder.map(function(n){
      try { return _overlays[n]() || ''; } catch (e) { return ''; }
    }).join('');
  }
  // Is any overlay currently showing? The shell asks before letting a
  // background refresh rebuild the DOM — a rebuild under an open drawer wipes
  // whatever the user was half-way through typing into it.
  function anyOverlayOpen(){ return renderOverlays() !== ''; }

  // ── Pages ────────────────────────────────────────────────────────────────
  // A page module registers the function that DRAWS its screen, so the shell
  // can draw it in the first pass.
  //
  // Before this registry, nine pages (Inbox, Clients, Candidates, Reports, My
  // Team, Sourced Leads, the BD job pages) were missing from renderPage()'s
  // switch: the shell wrote "Page not found" into #content and the module
  // overwrote it a moment later. Every repaint was therefore two writes, the
  // first of them wrong — a visible flash, and on the Inbox a destroyed and
  // reloaded message-body iframe.
  //
  // `paint` is optional. A page that gives one is repainted through it (the
  // Inbox does, so it can update a region at a time and leave the body iframe
  // standing); a page without one is repainted by the shell, which writes the
  // whole page string only when it differs from what is already on screen.
  var _pages = {};
  function registerPage(name, renderFn, paintFn){
    _pages[name] = { render:renderFn, paint:paintFn||null };
  }
  function hasPage(name){ return !!_pages[name]; }
  function hasPagePaint(name){ return !!(_pages[name] && _pages[name].paint); }
  function pageHtml(name){
    var p=_pages[name]; if(!p) return null;
    try { return p.render()||''; }
    catch(e){
      return '<div class="pg"><div class="pg-body"><div class="dt-empty" style="color:var(--red)">'+
        'Could not draw this page: '+esc(e&&e.message||e)+'</div></div></div>';
    }
  }
  function paintPage(name){
    var p=_pages[name]; if(!p||!p.paint) return false;
    p.paint(); return true;
  }

  return {
    esc:esc, attr:attr, ic:ic, ICONS:ICONS,
    registerOverlay:registerOverlay, renderOverlays:renderOverlays, anyOverlayOpen:anyOverlayOpen,
    registerPage:registerPage, hasPage:hasPage, hasPagePaint:hasPagePaint,
    pageHtml:pageHtml, paintPage:paintPage,
    tabs:tabs, strip:strip, toolbar:toolbar, table:table, page:page,
    idCell:idCell, pill:pill, ring:ring, toggle:toggle, kebab:kebab,
    check:check, dash:dash, notice:notice, kv:kv, drawer:drawer, feed:feed,
    _scrimDown:_scrimDown, _scrimUp:_scrimUp
  };
})();
