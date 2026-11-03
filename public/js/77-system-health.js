// ============================================================================
// THE SYSTEM-HEALTH BANNER ON THE ADMIN'S DASHBOARD (R-367, owner 3 Nov 2026).
// What is broken, since when, and a button for what the admin can DO about it. Server: GET /admin/system-health (routes/system-health.js); what counts, what it
// says and WHICH buttons are offered is services/system-health.js — this only draws what it is given. Calm by default: nothing is drawn on a healthy day.
// A button that changes something asks first, in the sentence the server wrote, and the press is logged server-side by the endpoint it calls.
// Loaded once per dashboard visit (no polling: instance hours are a budget) and again right after a button is pressed.
// Reuses the mailbox warning card's classes (.mba-*) so every theme already knows how to draw it.
// ============================================================================
(function(){
  'use strict';
  function esc(s){ return htmlEsc(s); }
  function isAdmin(){ return !!(STATE.user&&userHasRole(STATE.user,'admin')); }

  window.loadSystemHealth=function(force){
    if(STATE._shLoading||!isAdmin())return;
    if(STATE.systemHealth&&!force)return;
    STATE._shLoading=true;
    apiGet('/admin/system-health').then(function(r){
      STATE.systemHealth=r||{issues:[]}; STATE._shLoading=false; scheduleRender();
    }).catch(function(){
      STATE.systemHealth={_error:true,issues:[]}; STATE._shLoading=false; scheduleRender();
    });
  };

  window.renderSystemHealth=function(){
    var s=STATE.systemHealth;
    var viewingOther=STATE.viewingUser&&STATE.user&&STATE.viewingUser.id!==STATE.user.id;
    if(!s||viewingOther||!isAdmin())return '';
    // a check that could not run must never look like "all fine"
    if(s._error)return '<div class="mba-card mba-quiet mb4" id="sh-banner">Could not check the system\'s health. <a href="#" onclick="loadSystemHealth(true);return false;">Try again</a></div>';
    var list=s.issues||[];
    if(!list.length)return '';
    var rows=list.map(function(it){
      var acts=(it.actions||[]).map(function(a){
        return '<button class="btn btn-sm '+(a.go?'btn-outline':'btn-primary')+'" data-sh-issue="'+esc(it.id)+'" data-sh-action="'+esc(a.id)+'" onclick="systemHealthAct(\''+esc(it.id)+'\',\''+esc(a.id)+'\',this)"'+(a.confirm?' title="'+esc(a.confirm)+'"':'')+'>'+esc(a.label)+'</button>';
      }).join(' ');
      return '<div class="mba-row" data-sh-id="'+esc(it.id)+'">'+
        '<div class="mba-main">'+
          '<div class="mba-mail">'+esc(it.title)+(it.level==='bad'?' <span class="mba-tag">needs you</span>':'')+'</div>'+
          '<div class="mba-text">'+esc(it.sentence)+'</div>'+
          (it.since?'<div class="mba-meta"><span class="mba-since">since '+esc(String(it.since).slice(0,10))+'</span></div>':'')+
        '</div>'+
        '<div class="mba-act">'+acts+'</div>'+
      '</div>';
    }).join('');
    return '<div class="mba-card mb4" id="sh-banner"><div class="mba-head">System health &middot; '+list.length+' thing'+(list.length===1?'':'s')+' to look at</div>'+rows+'</div>';
  };

  window.systemHealthAct=function(issueId,actionId,btn){
    var s=STATE.systemHealth||{}, it=(s.issues||[]).filter(function(x){return x.id===issueId;})[0];
    var a=it&&(it.actions||[]).filter(function(x){return x.id===actionId;})[0];
    if(!a)return;
    if(a.go){ if(a.go==='deliverability'&&window.openDeliverability)openDeliverability(); return; }
    if(!a.path||a.path.charAt(0)!=='/')return;                    // only this app's own endpoints, whatever the answer said
    if(a.confirm&&!window.confirm(a.confirm))return;
    if(btn){ btn.disabled=true; btn.textContent='Working…'; }
    (a.method==='POST'?apiPost(a.path,a.body||{}):apiGet(a.path)).then(function(r){
      var n=r&&(r.fu1_queued!=null?(Number(r.fu1_queued||0)+Number(r.fu2_queued||0)):null);
      showToast(n!=null?('Done — '+n+' follow-up'+(n===1?'':'s')+' queued'):'Done','success');
      loadSystemHealth(true);
    }).catch(function(e){
      showToast('Could not do that: '+((e&&e.message)||e),'error');
      if(btn){ btn.disabled=false; btn.textContent=a.label; }
    });
  };
})();
