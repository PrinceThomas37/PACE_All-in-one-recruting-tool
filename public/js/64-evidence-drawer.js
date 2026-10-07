// ── "WHERE THIS COMES FROM" — ONE DRAWER FOR THE EVIDENCE BEHIND ANYTHING ───────
// The owner's rule (Session 40, D-0077): a number, a bar or a to-do that cannot
// show what it is made of is a claim, not information. "When we hover over the
// data points or click them nothing happens … it does not show the data from
// which this table is drawn." So every figure that can be traced opens THIS
// drawer: a title, one plain sentence saying what is being counted, and the
// rows themselves — each one a person or message the person can open.
//
// It knows nothing about reports or reminders. A caller gives it a title, a
// hint, optional `actions:[{label, fn}]` (buttons beside Close) and a `load()`
// that answers { items, total, more }; an item is
//   { primary, secondary, body, tone:'in'|'out', chips:[], when,
//     pick:function, full:{label, load:function→Promise<string>} }   — all optional but `primary`.
// `body` is the text itself (an email's words), clipped; `full` is a link that
// fetches the whole thing on demand and shows it in place.
// The drawer sits over whatever page is open (STATE.page is never touched) and
// closes with Esc, the Close button or a click outside it.
(function(){
  var cur=null;    // the open request: {cfg, title, hint, loading, error, items, total, more}

  window.evidenceOpen=function(cfg){
    cur={cfg:cfg,title:cfg.title||'',hint:cfg.hint||'',loading:true,error:null,items:[],total:0,more:0,showAll:false};
    render();
    var mine=cur;
    Promise.resolve().then(function(){return cfg.load();}).then(function(r){
      if(cur!==mine)return;                     // a later open (or a close) owns the drawer
      cur.loading=false; cur.items=(r&&r.items)||[]; cur.total=(r&&r.total!=null)?r.total:cur.items.length; cur.more=(r&&r.more)||0;
      render();
    }).catch(function(e){
      if(cur!==mine)return;
      cur.loading=false; cur.error=(e&&e.message)||'Could not load this'; render();
    });
  };
  window.evidenceClose=function(){ if(!cur)return; cur=null; render(); };
  window.evidenceAction=function(i){
    var a=cur&&cur.cfg.actions&&cur.cfg.actions[i]; if(!a||typeof a.fn!=='function')return;
    cur=null; render(); a.fn();                  // the drawer steps aside before the action opens its own thing
  };
  // "Read the full email": fetched when asked, shown in place, never fetched twice.
  window.evidenceFull=function(i,ev){
    if(ev&&ev.stopPropagation)ev.stopPropagation();
    var it=cur&&cur.items[i]; if(!it||!it.full)return;
    if(it._full&&it._full.text!=null){ it._full.open=!it._full.open; render(); return; }
    it._full={loading:true,open:true}; render();
    var mine=cur;
    Promise.resolve().then(function(){return it.full.load();}).then(function(t){
      if(cur!==mine)return; it._full={text:String(t==null?'':t),open:true}; render();
    }).catch(function(e){
      if(cur!==mine)return; it._full={text:null,error:(e&&e.message)||'Could not open it',open:true}; render();
    });
  };
  // THE TASK BAND (7 Oct, owner: "the user can see information but cant do anything about it").
  // A caller may give cfg.task = { text, buttons:[{label, fn, primary}], stages:{suggest, options, fn(stage)} }:
  // the one thing to do about what is shown, as buttons. The drawer steps aside first, like an action.
  window.evidenceTask=function(i){
    var b=cur&&cur.cfg.task&&cur.cfg.task.buttons&&cur.cfg.task.buttons[i]; if(!b||typeof b.fn!=='function')return;
    cur=null; render(); b.fn();
  };
  window.evidenceStage=function(stage){
    var t=cur&&cur.cfg.task&&cur.cfg.task.stages; if(!t||!stage||typeof t.fn!=='function')return;
    cur=null; render(); t.fn(stage);
  };
  window.evidenceShowAll=function(){ if(!cur)return; cur.showAll=true; render(); };

  function taskBand(){
    var t=cur&&cur.cfg.task; if(!t)return '';
    var btns=(t.buttons||[]).map(function(b,i){
      return '<button class="btn '+(b.primary?'btn-primary':(b.quiet?'btn-ghost':'btn-outline'))+' btn-sm" onclick="evidenceTask('+i+')">'+htmlEsc(b.label)+'</button>';
    }).join('');
    var st=t.stages, stageHtml='';
    if(st&&st.options&&st.options.length){
      stageHtml=(st.suggest?'<button class="btn btn-primary btn-sm" onclick="evidenceStage(\''+escAttr(st.suggest)+'\')">Move to '+htmlEsc(st.suggest)+'</button>':'')+
        '<select class="sel" aria-label="Move to another stage" onchange="evidenceStage(this.value)"><option value="">'+(st.suggest?'Another stage…':'Move to…')+'</option>'+
          st.options.map(function(o){return '<option value="'+escAttr(o)+'">'+htmlEsc(o)+'</option>';}).join('')+'</select>';
    }
    return '<div class="ev-task"><div class="ev-task-lbl">What to do</div>'+
      '<div class="ev-task-text">'+htmlEsc(t.text||'')+'</div>'+
      '<div class="ev-task-acts">'+stageHtml+btns+'</div></div>';
  }

  window.evidencePick=function(i){
    var it=cur&&cur.items[i]; if(!it||typeof it.pick!=='function')return;
    cur=null; render();                          // the drawer goes first, whatever the pick opens
    it.pick();
  };

  function row(it,i){
    var clickable=typeof it.pick==='function';
    var f=it._full, full='';
    if(it.full){
      full='<button class="ev-fulllink" onclick="evidenceFull('+i+',event)">'+(f&&f.loading?'Opening…':(f&&f.open&&f.text!=null?'Hide the full email':htmlEsc(it.full.label||'Read in full')))+'</button>'+
        (f&&f.open&&f.error?'<div class="ev-fullerr">'+htmlEsc(f.error)+'</div>':'')+
        (f&&f.open&&f.text!=null?'<div class="ev-fulltext">'+htmlEsc(f.text)+'</div>':'');
    }
    return '<div class="ev-row'+(clickable?' is-click':'')+(it.tone?' tone-'+it.tone:'')+'"'+(clickable?' onclick="evidencePick('+i+')" role="button" tabindex="0"':'')+'>'+
      '<div class="ev-main">'+
        '<div class="ev-primary">'+htmlEsc(it.primary||'')+'</div>'+
        (it.secondary?'<div class="ev-secondary">'+htmlEsc(it.secondary)+'</div>':'')+
        (it.body?'<div class="ev-text">'+htmlEsc(it.body)+'</div>':'')+
        full+
      '</div>'+
      '<div class="ev-side">'+
        (it.chips||[]).map(function(c){return '<span class="ev-chip">'+htmlEsc(c)+'</span>';}).join('')+
        (it.when?'<span class="ev-when">'+htmlEsc(it.when)+'</span>':'')+
      '</div>'+
    '</div>';
  }

  function draw(){
    if(!cur)return '';
    var body;
    if(cur.loading)body='<div class="ev-empty">Loading…</div>';
    else if(cur.error)body='<div class="ev-empty">'+htmlEsc(cur.error)+'</div>';
    else if(!cur.items.length)body='<div class="ev-empty">Nothing here — the number is 0.</div>';
    else {
      // `initial` = show only the newest few (the ones the suggestion was worked out from);
      // the rest is one click away, never silently dropped.
      var lim=cur.cfg.initial, hid=0, shown=cur.items;
      if(lim&&!cur.showAll&&cur.items.length>lim){ hid=cur.items.length-lim; shown=cur.items.slice(0,lim); }
      body=shown.map(row).join('')+
        (hid?'<button class="ev-fulllink ev-showall" onclick="evidenceShowAll()">Show '+hid+' earlier email'+(hid===1?'':'s')+'</button>':'')+
        (cur.more&&(!hid)?'<div class="ev-more">… and '+cur.more+' more not shown</div>':'');
    }
    return '<div class="overlay" onclick="evidenceClose()">'+
      '<div class="modal ev-drawer" role="dialog" aria-label="'+escAttr(cur.title)+'" onclick="event.stopPropagation()">'+
        '<div class="ev-head">'+
          '<div><div class="ev-title">'+htmlEsc(cur.title)+(!cur.loading&&!cur.error?' <span class="ev-count">'+cur.total+'</span>':'')+'</div>'+
            (cur.hint?'<div class="ev-hint">'+htmlEsc(cur.hint)+'</div>':'')+'</div>'+
          '<div class="ev-actions">'+((cur.cfg.actions||[]).map(function(a,i){return '<button class="btn '+(cur.cfg.task?'btn-outline':'btn-primary')+' btn-sm" onclick="evidenceAction('+i+')">'+htmlEsc(a.label)+'</button>';}).join(''))+
            '<button class="btn btn-outline btn-sm" onclick="evidenceClose()">Close</button></div>'+
        '</div>'+
        taskBand()+
        '<div class="ev-body">'+body+'</div>'+
      '</div>'+
    '</div>';
  }
  UI.registerOverlay('evidence',draw);
  document.addEventListener('keydown',function(ev){ if(ev.key==='Escape'&&cur)evidenceClose(); });
})();
