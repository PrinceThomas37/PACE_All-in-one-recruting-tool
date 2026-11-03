// ============================================================================
// ONE MAILBOX, ONE PLACE TO ACT — Deliverability (admin). Owner, 3 Nov 2026:
//   "I need email ID search and an option to pause, start, block, deactivate, delete — not different sections … do not show the full list,
//    give me a search option and I will search for individual email when required."
// What this draws: a search box and a few "needs attention" chips (counts, never the list). Type, or press a chip, and a short list of matches
// appears; choose one and ITS card opens: state, health, the numbers, warm-up, and the actions. The rules (which buttons exist for which state)
// are the SERVER's (services/mailbox-control.js → detail.actions); this file draws only what it is told — a button the server would refuse is
// never drawn. Routes: GET /admin/mailboxes/summary | search | :id/detail, POST /admin/mailboxes/:id/action (routes/mailbox-control.js).
// Block = locked (only an admin lifts it); Start = start SENDING again; warm-up is its own switch inside the card.
// ============================================================================
(function(){
  'use strict';
  function esc(s){ return htmlEsc(s); }
  function M(){ return STATE.mbc||(STATE.mbc={q:'',state:'',results:null,more:0,selId:null,detail:null,summary:null,busy:false,err:'',token:0}); }
  function days(){ return STATE.delivDays||30; }
  function fail(e){ showToast((e&&e.message)||String(e||'Something went wrong'),'error'); }

  // ── loading ──────────────────────────────────────────────────────────────
  window.mbcLoadSummary=function(force){
    var m=M(); if(m.summaryLoading||(m.summary&&!force)) return;
    m.summaryLoading=true;
    apiGet('/admin/mailboxes/summary').then(function(r){ m.summary=r||{}; m.summaryLoading=false; scheduleRender(); })
      .catch(function(){ m.summary={_error:true}; m.summaryLoading=false; scheduleRender(); });
  };
  function runSearch(){
    var m=M(), tok=++m.token;
    if(!m.q.trim()&&!m.state){ m.results=null; m.more=0; scheduleRender(); return; }
    m.searching=true; scheduleRender();
    apiGet('/admin/mailboxes/search?q='+encodeURIComponent(m.q.trim())+(m.state?'&state='+encodeURIComponent(m.state):'')).then(function(r){
      if(tok!==m.token) return;                       // a newer search is already on its way: this answer is stale
      m.results=(r&&r.results)||[]; m.more=(r&&r.more)||0; m.searching=false; m.err=''; scheduleRender();
    }).catch(function(e){ if(tok!==m.token) return; m.searching=false; m.results=[]; m.err=(e&&e.message)||'Search failed'; scheduleRender(); });
  }
  var _t=null;
  window.mbcType=function(v){ var m=M(); m.q=v; clearTimeout(_t); _t=setTimeout(runSearch,250); };
  // A count means "show me just these": it replaces whatever was typed (a leftover word would silently narrow the list to nothing).
  window.mbcChip=function(state){ var m=M(); m.state=(m.state===state?'':state); m.q=''; clearTimeout(_t); runSearch(); };
  window.mbcClear=function(){ var m=M(); m.q=''; m.state=''; m.results=null; m.more=0; m.selId=null; m.detail=null; clearTimeout(_t); m.token++; scheduleRender(); };
  window.mbcOpen=function(id){
    var m=M(); m.selId=id; m.detail=null; m.detailLoading=true; scheduleRender();
    loadDetail(id);
  };
  function loadDetail(id){
    var m=M();
    apiGet('/admin/mailboxes/'+encodeURIComponent(id)+'/detail?days='+days()).then(function(r){
      if(m.selId!==id) return; m.detail=r; m.detailLoading=false; scheduleRender();
    }).catch(function(e){ if(m.selId!==id) return; m.detailLoading=false; m.detail={_error:(e&&e.message)||'Could not load this mailbox'}; scheduleRender(); });
  }
  // The page's 7 / 30 / 90 day switch also moves an open mailbox's numbers.
  window.mbcReload=function(){ var m=M(); if(m.selId){ m.detail=null; m.detailLoading=true; loadDetail(m.selId); } };
  function refreshAll(){ var m=M(); mbcLoadSummary(true); if(m.q.trim()||m.state) runSearch(); if(m.selId) loadDetail(m.selId); }

  // ── actions ──────────────────────────────────────────────────────────────
  var VERB={pause:'paused',start:'started',block:'blocked',unblock:'unblocked',deactivate:'deactivated',delete:'deleted'};
  function post(id,action,extra){
    var m=M(); if(m.busy) return; m.busy=true; scheduleRender();
    var body={action:action}; for(var k in (extra||{})) body[k]=extra[k];
    return apiPost('/admin/mailboxes/'+encodeURIComponent(id)+'/action',body).then(function(r){
      m.busy=false;
      var note=(r&&r.reassignment&&r.reassignment.stranded)?' — '+r.reassignment.stranded+' lead(s) could not be moved (no other connected mailbox for that person).':
        (r&&r.reassignment&&r.reassignment.reassigned)?' — '+r.reassignment.reassigned+' lead(s) moved to another mailbox.':'';
      showToast('Mailbox '+VERB[action]+note,'success');
      if(action==='delete'){ m.selId=null; m.detail=null; }
      STATE.modal=null; refreshAll(); render();
    }).catch(function(e){ m.busy=false; STATE.modal=null; fail(e); refreshAll(); render(); });
  }
  function modal(title,body,okLabel,okCall,danger){
    STATE.modal='<div class="modal modal-w480"><div class="mh"><div class="mt">'+esc(title)+'</div></div><div class="mb_">'+body+'</div>'+
      '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      (okLabel?'<button class="btn '+(danger?'btn-danger':'btn-primary')+'" onclick="'+okCall+'">'+esc(okLabel)+'</button>':'')+'</div></div>';
    render();
  }
  window.mbcAct=function(action){
    var m=M(), d=m.detail; if(!d||d._error) return;
    var who=esc(d.email);
    if(action==='pause'||action==='start'||action==='unblock') return post(d.id,action);
    if(action==='block') return modal('Block '+d.email+'?','<p class="fs-13 c-text2"><b>Outreach</b> from <b>'+who+'</b> stops (sequences, bulk sends, candidate outreach) and it leaves warm-up. <b>Only an admin can unblock it.</b> Outreach emails already waiting stay waiting. The person can still write emails one by one and reply to conversations.</p>','Block it',"mbcDo('block')",true);
    if(action==='deactivate') return modal('Deactivate '+d.email+'?','<p class="fs-13 c-text2"><b>'+who+'</b> stops being used and leaves warm-up. Its leads are moved to another connected mailbox of the same person when there is one; the emails already sent stay on record. You can start it again later.</p>','Deactivate',"mbcDo('deactivate')",true);
    if(action==='delete'){
      if(d.email_count>0) return modal('This mailbox cannot be deleted','<p class="fs-13 c-text2"><b>'+who+'</b> has <b>'+d.email_count+' email'+(d.email_count===1?'':'s')+'</b> on record (sent or waiting). Deleting it would erase that history, so it is kept.</p><p class="fs-13 c-text2">Deactivate it instead: it stops being used and stays in the records.</p>','Deactivate instead',"mbcDo('deactivate')",true);
      return modal('Delete '+d.email+'?','<p class="fs-13 c-text2">This is permanent. To confirm, type the address:</p><input id="mbc-del" class="inp" type="text" autocomplete="off" placeholder="'+esc(d.email)+'" oninput="mbcDelTyped(this.value)">','Delete forever',"mbcDo('delete')",true);
    }
  };
  window.mbcDelTyped=function(v){ M().delTyped=v; };
  window.mbcDo=function(action){
    var m=M(), d=m.detail; if(!d||d._error) return;
    post(d.id,action,action==='delete'?{confirm_address:m.delTyped||''}:null);
    m.delTyped='';
  };
  // Warm-up is its own switch inside the card (the old separate pool list is gone). Same endpoints as before.
  window.mbcWarm=function(action){
    var m=M(), d=m.detail; if(!d||d._error) return;
    if(action==='start'){
      STATE.warmup=STATE.warmup||{mailboxes:[]};
      if(!(STATE.warmup.mailboxes||[]).some(function(x){return x.id===d.id;})) STATE.warmup.mailboxes=(STATE.warmup.mailboxes||[]).concat([{id:d.id,email:d.email}]);
      return openWarmupStart(d.id);
    }
    apiPost('/warmup/'+d.id+'/'+action,{}).then(function(){ showToast('Warm-up '+action+'d','success'); loadDetail(d.id); }).catch(fail);
  };
  // After a warm-up is started from the dialog, the card must show it.
  var _loadWarmup=window.loadWarmup;
  if(typeof _loadWarmup==='function'){ window.loadWarmup=function(){ _loadWarmup.apply(this,arguments); var m=M(); if(m.selId) loadDetail(m.selId); }; }

  // ── drawing ──────────────────────────────────────────────────────────────
  var TONE={active:'ok',paused:'warn',auto_paused:'bad',blocked:'bad',deactivated:'mute'};
  var HEALTH={good:'ok',watch:'warn',bad:'bad',off:'mute'};
  function pct(v){ return v==null?'—':v+'%'; }
  function chips(){
    var m=M(), s=m.summary;
    if(!s) return '<div class="fs-12 c-text3">Loading…</div>';
    if(s._error) return '<div class="fs-12 c-red">Could not load the counts.</div>';
    var defs=[['expired','Sign-in expired',s.expired,'bad'],['auto_paused','Auto-paused',s.auto_paused,'bad'],['paused','Paused',s.paused,'warn'],['blocked','Blocked',s.blocked,'bad'],['deactivated','Deactivated',s.deactivated,'mute'],['active','Active',s.active,'ok']];
    return defs.map(function(d){
      var on=m.state===d[0], n=d[2]||0;
      return '<button type="button" class="mbc-chip'+(on?' on':'')+(n?'':' zero')+' '+d[3]+'" '+(n?'onclick="mbcChip(\''+d[0]+'\')"':'disabled')+' aria-pressed="'+on+'"><b>'+n+'</b> '+esc(d[1])+'</button>';
    }).join('');
  }
  function resultRows(){
    var m=M();
    if(m.searching&&!m.results) return '<div class="fs-13 c-text3 mbc-pad">Searching…</div>';
    if(m.err) return '<div class="fs-13 c-red mbc-pad">'+esc(m.err)+'</div>';
    if(!m.results) return '<div class="fs-13 c-text3 mbc-pad">Type an email address, a name or a person to find a mailbox — or press one of the counts above to see just those.</div>';
    if(!m.results.length) return '<div class="fs-13 c-text3 mbc-pad">No mailbox matches.</div>';
    return m.results.map(function(r){
      return '<button type="button" class="mbc-row'+(m.selId===r.id?' on':'')+'" onclick="mbcOpen(\''+r.id+'\')">'+
        '<span class="mbc-who"><span class="fs-13 mbc-em">'+esc(r.email)+'</span><span class="fs-12 c-text3">'+esc(r.owner||r.name||'')+'</span></span>'+
        (r.sign_in==='expired'&&r.state!=='deactivated'?UI.pill('Sign-in expired','bad'):'')+UI.pill(r.state_label,TONE[r.state]||'mute',true)+'</button>';
    }).join('')+(m.more?'<div class="fs-12 c-text3 mbc-pad">…and '+m.more+' more. Type more of the address to narrow it.</div>':'');
  }
  function actionButtons(d){
    return (d.actions||[]).map(function(a){
      var cls=a.danger?'btn btn-sm btn-outline mbc-danger':'btn btn-sm btn-primary';
      var tip=a.action==='pause'?' title="Stops outreach from this mailbox. Emails written one by one and replies still go."':'';
      return '<button type="button" class="'+cls+'" '+(M().busy?'disabled':'')+tip+' onclick="mbcAct(\''+a.action+'\')">'+esc(a.label)+'</button>';
    }).join('');
  }
  function warmupBlock(d){
    var w=d.warmup||{}, off=(d.state==='blocked'||d.state==='deactivated');
    var line, btns='';
    if(w.status==='warming'){ line='Warming up since '+esc(w.started||'')+(w.days?' · '+w.days+' days':''); btns='<button type="button" class="btn btn-sm btn-outline" onclick="mbcWarm(\'pause\')">Pause warm-up</button><button type="button" class="btn btn-sm btn-outline" onclick="mbcWarm(\'stop\')">Finish early</button>'; }
    else if(w.status==='paused'){ line='Warm-up is paused'; btns=off?'':'<button type="button" class="btn btn-sm btn-outline" onclick="mbcWarm(\'resume\')">Resume warm-up</button>'; }
    else if(w.status==='warmed'){ line='Warmed up'+(w.graduated_at?' on '+esc(String(w.graduated_at).slice(0,10)):'')+' — ready for outreach'; }
    else { line='Not warming'; btns=off?'':'<button type="button" class="btn btn-sm btn-outline" onclick="mbcWarm(\'start\')">Start warm-up</button>'; }
    return '<div class="mbc-sec"><div class="mbc-h">Warm-up</div><div class="mbc-line"><span class="fs-13">'+line+(off?' <span class="c-text3">(a '+esc(d.state_label.toLowerCase())+' mailbox is out of warm-up)</span>':'')+'</span><span class="mbc-btns">'+btns+'</span></div></div>';
  }
  function detailCard(){
    var m=M();
    if(!m.selId) return '';
    if(m.detailLoading&&!m.detail) return '<div class="mbc-detail"><div class="fs-13 c-text3 mbc-pad">Loading this mailbox…</div></div>';
    var d=m.detail; if(!d) return '';
    if(d._error) return '<div class="mbc-detail"><div class="fs-13 c-red mbc-pad">'+esc(d._error)+'</div></div>';
    var s=d.stats||{}, h=d.health||{};
    var capPct=d.limit&&d.limit.daily?Math.min(100,Math.round(d.limit.sent_today/d.limit.daily*100)):0;
    var max=Math.max.apply(null,(d.week||[]).map(function(x){return x.sent;}).concat([1]));
    var week=(d.week||[]).map(function(x){ return '<span class="mbc-bar" title="'+esc(x.day)+': '+x.sent+' sent"><i class="mbc-fill" style="height:'+Math.round(x.sent/max*100)+'%"></i></span>'; }).join('');
    var tips=(h.tips||[]).map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('');
    var stripItems=[
      {v:s.sent,label:'Sent ('+d.window_days+'d)'},{sep:true},
      {v:pct(s.bounce_rate),label:'Bounce rate',title:s.people_emailed?s.bounced+' of '+s.people_emailed+' people emailed bounced'+(d.bounce_limit_pct?' · your limit is '+d.bounce_limit_pct+'%':''):'Nobody emailed yet'},
      {v:pct(s.open_rate),label:'Open rate',title:s.tracked?s.opened+' of '+s.tracked+' tracked emails were opened':'No emails with open tracking in this window'},
      {v:pct(s.reply_rate),label:'Reply rate',title:s.people_emailed?s.replied+' of '+s.people_emailed+' people replied':'Nobody emailed yet'},{sep:true},
      {v:s.failed,label:'Failed'},{v:s.pending,label:'Waiting to send'}
    ];
    var lf=s.last_failure;
    return '<div class="mbc-detail">'+
      '<div class="mbc-top"><div class="mbc-id"><div class="mbc-title">'+esc(d.email)+'</div>'+
        '<div class="fs-12 c-text3">'+esc(d.owner&&d.owner.name||'')+(d.platform?' · '+esc(d.platform):'')+(d.primary?' · primary':'')+'</div></div>'+
        '<div class="mbc-pills">'+UI.pill(d.state_label,TONE[d.state]||'mute',true)+UI.pill(h.label||'',HEALTH[h.level]||'mute')+'</div></div>'+
      (d.state_note?'<div class="mbc-note fs-13">'+esc(d.state_note)+'</div>':'')+
      (d.scope_note?'<div class="fs-12 c-text3 mbc-fine">'+esc(d.scope_note)+'</div>':'')+
      (tips?'<ul class="mbc-tips fs-13">'+tips+'</ul>':'')+
      '<div class="mbc-acts">'+actionButtons(d)+'</div>'+
      '<div class="mbc-sec"><div class="mbc-h">Last '+d.window_days+' days</div>'+UI.strip(stripItems)+
        '<div class="fs-12 c-text3 mbc-fine">Rates count people, not emails. A rate with nothing under it shows “—”, not 0%. Open tracking covers only the emails that carry it.</div></div>'+
      '<div class="mbc-sec"><div class="mbc-h">Sending today</div><div class="mbc-line"><span class="fs-13">'+d.limit.sent_today+' of '+(d.limit.daily||'—')+' a day</span><span class="mbc-meter"><i class="mbc-meter-fill" style="width:'+capPct+'%"></i></span><span class="mbc-week" title="Emails sent per day, last 7 days">'+week+'</span></div></div>'+
      warmupBlock(d)+
      (lf?'<div class="mbc-sec"><div class="mbc-h">Last failure</div><div class="fs-13">'+esc(lf.reason||'No reason recorded')+' <span class="c-text3">· '+esc(lf.kind||'')+' · '+esc(String(lf.at||'').slice(0,10))+'</span></div></div>':'')+
    '</div>';
  }

  window.mailboxControlCard=function(){
    var m=M(); mbcLoadSummary(false);
    var warm=STATE.warmup, rd=warm&&warm.readiness;
    var warmLine=rd?'<div class="fs-12 c-text3 mbc-fine">Warm-up pool: '+(warm.pool_count||0)+' mailbox'+((warm.pool_count||0)===1?'':'es')+' · '+(warm.pool_domains||0)+' domain'+((warm.pool_domains||0)===1?'':'s')+' — '+esc(rd.note||'')+'</div>':'';
    return '<div class="mbc"><div class="mbc-head"><div><div class="mbc-cap">Mailboxes</div>'+
      '<div class="fs-12 c-text3">Find one mailbox to see its health and act on it. The long lists are gone.</div></div>'+
      (STATE.isOperator!==false?'<button type="button" class="btn btn-sm btn-outline" onclick="runWarmupTick()">'+(STATE.warmupTick==='running'?'Running…':'▶ Run warm-up now')+'</button>':'')+'</div>'+
      '<div class="mbc-chips">'+chips()+'</div>'+
      '<div class="mbc-find"><input id="mbc-q" class="hz-search" type="search" autocomplete="off" value="'+esc(m.q)+'" placeholder="Search an email address, a name or an owner…" oninput="mbcType(this.value)">'+
        ((m.q||m.state||m.selId)?'<button type="button" class="btn btn-sm btn-outline" onclick="mbcClear()">Clear</button>':'')+'</div>'+
      '<div class="mbc-results">'+resultRows()+'</div>'+detailCard()+warmLine+'</div>';
  };
})();
