// ── NEXT ACTIONS — "what to do today", ranked, with the reason attached ──────
// Step 4. The app already knew a lead had replied six days ago and that a
// reminder had come due; none of it reached the user, so the work sat in tables
// while they guessed what to do next. This is the card that says it out loud.
//
// Every row carries WHY it is there. That is not decoration: a ranked list you
// cannot interrogate is just a different kind of guessing, and the user has to
// be able to disagree with it.
//
// Ranking and thread-reading live server-side (next-action.js /
// conversation-intel.js) so the browser only renders.
function loadNextActions(force){
  if(STATE._naLoading)return;
  if(STATE.nextActions&&!force)return;
  STATE._naLoading=true;
  apiGet('/next-actions').then(function(r){
    STATE.nextActions=r||{items:[]};
    STATE._naLoading=false;
    scheduleRender();
  }).catch(function(){
    // Never let this blank a dashboard — it is an assistive card, not the page.
    STATE.nextActions={_error:true,items:[]};
    STATE._naLoading=false;
    scheduleRender();
  });
}
window.refreshNextActions=function(){STATE.nextActions=null;loadNextActions(true);render();};

window.naDone=function(reminderId,ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  apiPost('/next-actions/'+encodeURIComponent(reminderId)+'/done',{}).then(function(){
    showToast('Marked done','success');
    STATE.nextActions=null;loadNextActions(true);
  }).catch(function(e){showToast('Could not update: '+(e&&e.message||e),'error');});
};

window.naOpen=function(kind,entityType,entityId,jobId){
  // Jump to the thing the action is about. Leads live behind the job, so a
  // contact action opens its job — that is where the reply is answered.
  if(entityType==='contact'&&jobId&&typeof openJob==='function')return openJob(jobId);
  if(entityType==='candidate'&&typeof bdOpenCandidate==='function')return bdOpenCandidate(entityId);
  if(jobId&&typeof openJob==='function')return openJob(jobId);
  goPage('leads');
};

var NA_KIND={
  reply_due:      {lbl:'Reply due',    bg:'#fee2e2', fg:'#b91c1c'},
  commitment_due: {lbl:'They promised',bg:'#fef3c7', fg:'#92400e'},
  reminder_due:   {lbl:'Reminder',     bg:'#e0e7ff', fg:'#3730a3'},
  nudge:          {lbl:'No reply yet', bg:'#f1f5f9', fg:'#475569'},
  stage_suggested:{lbl:'Positive signal', bg:'#dcfce7', fg:'#15803d'}
};

function renderNextActionsCard(){
  var s=STATE.nextActions;
  if(s===undefined||s===null){
    return '<div class="card cp mb4" style="color:var(--text3);font-size:13px">Working out what needs you…</div>';
  }
  if(s._error)return '';                 // silent: the rest of the dashboard is still useful
  var items=s.items||[];
  if(!items.length){
    return '<div class="card cp mb4" style="display:flex;align-items:center;gap:10px">'+
      '<span style="width:9px;height:9px;border-radius:50%;background:var(--green);display:inline-block"></span>'+
      '<div style="font-size:13.5px;font-weight:600">Nothing waiting on you.</div>'+
      '<div style="font-size:12px;color:var(--text3)">No unanswered replies or due reminders.</div>'+
    '</div>';
  }

  var show=STATE.naExpanded?items:items.slice(0,5);
  var rows=show.map(function(it){
    var k=NA_KIND[it.kind]||NA_KIND.nudge;
    var done=it.reminder_id
      ?'<button onclick="naDone(\''+it.reminder_id+'\',event)" title="Mark this reminder done" style="padding:4px 10px;border:1px solid var(--border2);background:var(--card);border-radius:7px;font-size:12px;cursor:pointer;color:var(--text2)">Done</button>'
      :'';
    return '<div onclick="naOpen(\''+it.kind+'\',\''+it.entity_type+'\',\''+it.entity_id+'\','+(it.job_id?'\''+it.job_id+'\'':'null')+')" '+
      'style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--border);cursor:pointer">'+
      '<span style="flex:none;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:7px;background:'+k.bg+';color:'+k.fg+'">'+k.lbl+'</span>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13.5px;font-weight:600">'+htmlEsc(it.title||'')+
          (it.subtitle?' <span style="font-weight:400;color:var(--text3)">· '+htmlEsc(it.subtitle)+'</span>':'')+'</div>'+
        '<div style="font-size:12px;color:var(--text3)">'+htmlEsc(it.reason||'')+'</div>'+
      '</div>'+
      done+
      '<div style="color:var(--text3);font-size:18px">›</div>'+
    '</div>';
  }).join('');

  var sum=s.summary||{by_kind:{}};
  var bk=sum.by_kind||{};
  function chip(n,label,color){
    if(!n)return '';
    return '<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px;background:var(--bg);border:1px solid var(--border);color:'+color+'">'+n+' '+label+'</span>';
  }

  return '<div class="card cp mb4" style="padding:0;overflow:hidden">'+
    '<div style="padding:13px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
      '<div style="flex:1;min-width:200px">'+
        '<div style="font-weight:700;font-size:14px">Needs you today</div>'+
        '<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">'+
          chip(bk.reply_due,'to reply','#b91c1c')+
          chip(bk.commitment_due,'promised','#92400e')+
          chip(bk.reminder_due,'reminders','#3730a3')+
          chip(bk.nudge,'to chase','#475569')+
          chip(bk.stage_suggested,'positive signal','#15803d')+
        '</div>'+
      '</div>'+
      '<button onclick="refreshNextActions()" style="padding:6px 12px;background:var(--card);border:1px solid var(--border2);border-radius:8px;font-size:12.5px;color:var(--text2);cursor:pointer">Refresh</button>'+
      (items.length>5?'<button onclick="STATE.naExpanded='+(STATE.naExpanded?'false':'true')+';render()" style="padding:6px 12px;background:var(--card);border:1px solid var(--border2);border-radius:8px;font-size:12.5px;color:var(--text2);cursor:pointer">'+(STATE.naExpanded?'Show less':'Show all '+items.length)+'</button>':'')+
    '</div>'+
    rows+
  '</div>';
}
