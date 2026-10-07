// ============================================================================
// "YOUR CLIENT CONVERSATIONS" + "YOUR TEAM'S" ON THE DASHBOARD (D-0040, D-0043)
// ----------------------------------------------------------------------------
// The daily update's client section: where each live conversation stands, the
// first line of the owner's saved AI summary, and the next step — re-used,
// never re-read: no AI call happens to draw this. A manager also sees their
// reports' conversations as FACTS ONLY (who is waiting on whom, for how long),
// never what an email said and never the owner's summary (D-0040).
//
// It is a STATUS view, not a to-do list: replies owed are also in "Needs you
// today", which stays the one to-do list. Server: GET /client-intel/digest.
// Loaded once per dashboard visit, never polled; draws nothing when there is
// nothing to show or the feature is switched off.
// ============================================================================
(function(){
  'use strict';
  function esc(s){ return htmlEsc(s); }
  var LIMIT=3;   // the top three, then "See all" (D-0066)

  window.loadClientDigest=function(force){
    if(STATE._cdLoading) return;
    if(STATE.clientDigest&&!force) return;
    STATE._cdLoading=true;
    apiGet('/client-intel/digest').then(function(r){
      STATE.clientDigest=r||{enabled:false}; STATE._cdLoading=false; scheduleRender();
    }).catch(function(){
      STATE.clientDigest={_error:true}; STATE._cdLoading=false; scheduleRender();
    });
  };

  // Open the lead on the Leads list, searched to its company.
  window.clientDigestOpen=function(name){
    var co=String(name||'').split(' · ').pop();
    STATE.jobsFilter=STATE.jobsFilter||{};
    STATE.jobsFilter.search=co; STATE.leadsPage=0;
    goPage('leads');
  };

  // Click a conversation of yours = the emails it is worked out from (65-trace.js) AND the step to take
  // (7 Oct, owner: "the email task or the call task or the stage change task is not mentioned … the user can
  // see information but cant do anything about it"). The step is the one the digest already names
  // (it.next_step); the buttons do it, using the person who wrote last (found when the emails load).
  var EMAIL_STEPS={follow_up:1,check_promise:1,loop_in_other:1,ask_for_jd:1,send_profiles:1,discuss_terms:1,send_quote:1,follow_quote:1,send_contract:1,send_proposal:1,loop_in_finance:1};
  var CALL_STEPS={book_call:1,book_intake:1,book_site_visit:1,book_demo:1,start_trial:1};
  function firstName(n){ return String(n||'').trim().split(/\s+/)[0]||'them'; }
  function taskFor(it, meta){
    var step=it.next_step||(it.state==='needs_reply'?{id:'reply',label:'Reply to their last email',why:'They wrote last and are waiting on you.'}:null);
    var who=function(){ return (meta.lastInbound&&meta.lastInbound.name)||''; };
    var openLead=function(){ clientDigestOpen(it.name); };
    var replyInMailbox=function(){
      var em=meta.lastInbound&&meta.lastInbound.email;
      if(!em){ openLead(); return; }
      STATE.mailbox=STATE.mailbox||{}; STATE.mailbox.q=em; goPage('mailbox');
    };
    var writeTo=function(){
      var li=meta.lastInbound;
      if(!li||!li.email||!window.outreachComposeTo){ openLead(); return; }
      outreachComposeTo({id:null,name:li.name||it.name,email:li.email,company:it.name,job_id:it.id,outreach_type:'followup'});
    };
    var b=[], text;
    if(!step){
      text='Nothing is owed right now. If you want to keep the conversation moving, open the lead.';
      b.push({label:'Open the lead',primary:true,fn:openLead});
    }else{
      text=step.label+(step.why?' — '+String(step.why).replace(/[.\s]+$/,''):'')+'.';
      if(step.id==='reply') b.push({label:'Reply in the mailbox',primary:true,fn:replyInMailbox});
      else if(EMAIL_STEPS[step.id]) b.push({label:'Write the email',primary:true,fn:writeTo});
      else if(CALL_STEPS[step.id]) b.push({label:'Open the lead to call them',primary:true,fn:openLead});
      else if(step.id==='convert_to_job') b.push({label:'Open the lead to add the job',primary:true,fn:openLead});
      else b.push({label:'Open the lead',primary:true,fn:openLead});
      if(step.id!=='reply'&&it.state==='needs_reply') b.push({label:'Reply in the mailbox',fn:replyInMailbox});
    }
    // THE STAGE STEP (owner, 7 Oct): somebody who wrote back is not an "Assigned" lead any more. Offered only when the lead is
    // loaded here and this person may change stages (the same rule as the Leads list) — never a control that cannot act.
    var stages=null, lj=window.jobById?jobById(it.id):null;
    if(lj&&window.changeJobStage&&userHasAnyRole(STATE.user,'admin','bd','bd_lead')){
      var ALL=['Unassigned','Assigned','Connected','In Discussion','Future','Rejected'];
      var sug={'Unassigned':'Connected','Assigned':'Connected','Connected':'In Discussion'}[lj.stage]||'';
      stages={suggest:sug,options:ALL.filter(function(x){return x!==lj.stage;}),fn:function(st){ changeJobStage(it.id,st); }};
      text+=' The lead is at "'+lj.stage+'".';
    }
    if(it.complete) b.push({label:'Mark completed',quiet:true,fn:function(){
      apiPost('/next-actions/dismiss',{item:it.complete,scope:'drop'}).then(function(){
        showToast('Marked completed — it comes back only if they write again','success'); loadClientDigest(true);
      }).catch(function(e){ showToast('Could not mark that completed: '+((e&&e.message)||e),'error'); });
    }});
    return {text:text,buttons:b,stages:stages};
  }
  window.clientDigestTrace=function(idx){
    var it=((STATE.clientDigest||{}).mine||[])[idx]; if(!it||!window.traceOpen) return;
    var meta={};
    traceOpen({
      title:it.name,
      hint:'Listed because the other side has written in the last 60 days. Right now: '+String(it.headline||'a live conversation').replace(/[.\s]+$/,'')+'.',
      leadId:it.id, firstChip:it.state==='needs_reply'?'the reply you owe':'latest', meta:meta,
      task:taskFor(it,meta),
      open:{label:'Open the lead',fn:function(){ clientDigestOpen(it.name); }}
    });
  };

  // The checkbox: this conversation is dealt with. It is a snooze that returns when they write again
  // (the same store as "Needs you today"), never a delete. The item recorded against is the server's.
  window.clientDigestComplete=function(chk, idx, ev){
    if(ev&&ev.stopPropagation) ev.stopPropagation();
    var it=((STATE.clientDigest||{}).mine||[])[idx];
    if(!it||!it.complete){ chk.checked=false; return; }
    chk.disabled=true;
    var rowEl=chk.closest?chk.closest('.cd-row'):null; if(rowEl) rowEl.style.opacity='.45';
    apiPost('/next-actions/dismiss',{item:it.complete,scope:'drop'}).then(function(){
      showToast('Marked completed — it comes back only if they write again','success');
      loadClientDigest(true);
    }).catch(function(e){
      chk.checked=false; chk.disabled=false; if(rowEl) rowEl.style.opacity='';
      showToast('Could not mark that completed: '+((e&&e.message)||e),'error');
    });
  };

  function row(it, mine, idx){
    var badge=it.state==='needs_reply'?'<span class="cd-chip">waiting on '+(mine?'you':'reply')+'</span>'
      :(it.promises_due?'<span class="cd-chip">promise due</span>':'');
    var tick=(mine&&it.complete)
      ?'<label class="cd-tick" onclick="event.stopPropagation()" title="Completed — hides this until they write again"><input type="checkbox" onclick="clientDigestComplete(this,'+idx+',event)" aria-label="Mark completed"></label>':'';
    // Yours: click shows the emails behind it. A teammate's is facts only (D-0040) — it still just opens the lead.
    return '<div class="cd-row" '+(mine?'onclick="clientDigestTrace('+idx+')" title="Click to see the emails behind this"':'onclick="clientDigestOpen(\''+esc(it.name).replace(/'/g,'&#39;')+'\')"')+'>'+
      '<div class="cd-name">'+tick+esc(it.name)+badge+'</div>'+
      '<div class="cd-line">'+esc(it.headline||'')+'</div>'+
      (mine&&it.summary_line?'<div class="cd-sum">'+esc(it.summary_line)+'</div>':'')+
      (mine&&it.next_step?'<div class="cd-next">Next: <b>'+esc(it.next_step.label)+'</b></div>':'')+
    '</div>';
  }

  window.renderClientDigest=function(){
    var s=STATE.clientDigest;
    var isViewingOther=STATE.viewingUser&&STATE.viewingUser.id!==STATE.user.id;
    if(isViewingOther||!s||s.enabled===false) return '';
    if(s._error) return '';   // a status card, not a warning: the to-do list still says what is owed
    var mine=s.mine||[], team=s.team||[];
    if(!mine.length&&!team.length) return '';
    var out='';
    if(mine.length){
      var open=!!STATE._cdAllMine, shown=open?mine:mine.slice(0,LIMIT);
      out+='<div class="cd-sec"><div class="cd-head">Your client conversations <span>'+mine.length+'</span></div>'+
        shown.map(function(it,i){ return row(it,true,i); }).join('')+
        (mine.length>LIMIT?'<button type="button" class="lxi-link" onclick="STATE._cdAllMine='+(open?'false':'true')+';scheduleRender()">'+(open?'Show the top '+LIMIT:'See all '+mine.length)+'</button>':'')+
      '</div>';
    }
    if(team.length){
      out+='<div class="cd-sec"><div class="cd-head">Your team\'s conversations <span>facts only — what each email said stays with its owner</span></div>'+
        team.map(function(g){
          var sub=[g.waiting?g.waiting+' waiting on '+esc(g.owner_name||'them'):'', g.promises_due?g.promises_due+' promise'+(g.promises_due===1?'':'s')+' due':''].filter(Boolean).join(' · ');
          return '<div class="cd-person"><div class="cd-pname">'+esc(g.owner_name||'Unassigned')+(sub?' <span>'+sub+'</span>':'')+'</div>'+
            g.items.slice(0,4).map(function(it){ return row(it,false); }).join('')+
            (g.items.length>4?'<div class="cd-more">+ '+(g.items.length-4)+' more</div>':'')+
          '</div>';
        }).join('')+
      '</div>';
    }
    return '<div class="card cp mb4 cd-card">'+out+'</div>';
  };
})();
