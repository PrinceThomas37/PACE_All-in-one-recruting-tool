// ============================================================================
// MAILBOX SIGN-IN WARNING ON THE DASHBOARD (R-037)
// ----------------------------------------------------------------------------
// A mailbox whose sign-in has died sends nothing, and the emails behind it
// wait. This puts that in front of the person who can fix it, on the first
// screen they see — with a Reconnect button for the mailbox's OWNER (only they
// can complete Google's / Microsoft's consent screen) and a plain "ask X to
// reconnect" for a manager or admin looking at someone else's.
//
// Server: GET /mailboxes/alerts (routes/mailbox-alerts.js); what counts and
// what it says is services/mailbox-alerts.js. Loaded once per dashboard visit,
// like the next-actions card — no polling (instance hours are a budget).
// Calm by default (D-0019): one card, an amber stripe, draws NOTHING when all
// mailboxes are fine.
// ============================================================================
(function(){
  'use strict';
  function esc(s){ return htmlEsc(s); }
  function day(s){ try{ return new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}); }catch(e){ return ''; } }

  window.loadMailboxAlerts=function(force){
    if(STATE._mbaLoading) return;
    if(STATE.mailboxAlerts&&!force) return;
    STATE._mbaLoading=true;
    apiGet('/mailboxes/alerts').then(function(r){
      STATE.mailboxAlerts=r||{alerts:[]}; STATE._mbaLoading=false; scheduleRender();
    }).catch(function(){
      STATE.mailboxAlerts={_error:true,alerts:[]}; STATE._mbaLoading=false; scheduleRender();
    });
  };

  window.renderMailboxAlerts=function(){
    var s=STATE.mailboxAlerts;
    var isViewingOther=STATE.viewingUser&&STATE.viewingUser.id!==STATE.user.id;
    if(isViewingOther||!s) return '';
    if(s._error){
      // A warning that could not be checked must not look like "all fine".
      return '<div class="mba-card mba-quiet mb4">Could not check your mailboxes\' sign-ins. '+
        '<a href="#" onclick="loadMailboxAlerts(true);return false;">Try again</a></div>';
    }
    var list=s.alerts||[];
    if(!list.length) return '';
    var rows=list.map(function(a){
      var mine=a.is_owner;
      var who=mine?'':'<span class="mba-owner">'+esc(a.owner_name||'Its owner')+'\'s mailbox · </span>';
      var held=a.held?'<span class="mba-held">'+a.held+' email'+(a.held===1?'':'s')+' waiting behind it</span>':'';
      var since=a.since?'<span class="mba-since">last worked '+esc(day(a.since))+'</span>':'';
      var action=mine
        ? '<button class="btn btn-sm btn-primary" onclick="mailboxAlertReconnect(\''+a.mailbox_id+'\',\''+(a.platform||'')+'\')">Reconnect</button>'
        : '<span class="mba-ask">Ask '+esc(a.owner_name||'its owner')+' to reconnect it</span>';
      return '<div class="mba-row">'+
        '<div class="mba-main">'+
          '<div class="mba-mail">'+who+esc(a.email)+(a.state==='probably_expired'?' <span class="mba-tag">probably</span>':'')+'</div>'+
          '<div class="mba-text">'+esc(a.sentence)+'</div>'+
          ((held||since)?'<div class="mba-meta">'+[held,since].filter(Boolean).join(' · ')+'</div>':'')+
        '</div>'+
        '<div class="mba-act">'+action+'</div>'+
      '</div>';
    }).join('');
    var n=list.length;
    return '<div class="mba-card mb4">'+
      '<div class="mba-head">'+(n===1?'A mailbox can\'t send':n+' mailboxes can\'t send')+'</div>'+
      rows+
    '</div>';
  };

  // Reuses the one reconnect flow Admin uses — never a second OAuth path.
  window.mailboxAlertReconnect=function(mailboxId,platform){
    var uid=STATE.user&&STATE.user.id;
    var done=function(e){
      if(e.data&&(e.data.type==='ms_oauth_success'||e.data.type==='google_oauth_success')){
        window.removeEventListener('message',done);
        loadMailboxAlerts(true);
      }
    };
    window.addEventListener('message',done);
    if(platform==='gmail') connectGmailUserEmail(uid,mailboxId);
    else connectMicrosoftUserEmail(uid,mailboxId);
  };
})();
