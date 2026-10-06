// ── A BD TAKES LEADS FOR THEMSELVES, AND STARTS THE OUTREACH (R-148, D-0082) ──────────
// The owner: "today I thought of importing a list of leads directly into BD user profile.
// But did not find a way to send the outreach." Two gaps, one screen's worth of fix:
//   1. "Take leads" (Leads page) — hand me N leads from the pool, into MY connected mailboxes, up to
//      a daily limit an admin sets. I never see the pool, only how many I may still take today.
//   2. "Write the first emails" — the missing next step. Owning leads does not send anything; this puts a
//      first email for each lead into Pending, where I look at it and send it. It is offered right after a
//      take and right after an import (the old "Done" button looked for leads that cannot exist).
// Typing in the box never repaints the window; only a button does.
(function(){
  'use strict';
  var T=function(){ return STATE.takeLeads||(STATE.takeLeads={ st:null, loading:false, count:'', busy:false, result:null, err:'' }); };
  var esc=function(t){ return htmlEsc(t==null?'':t); };

  // The explicit next step, shared by Take and Import. Goes to Pending when the emails are ready.
  window.writeFirstEmails=function(jobIds){
    var ids=(jobIds||[]).slice();
    if(!ids.length){ showToast('Nothing to write emails for','warning'); return; }
    showToast('Writing the first emails for '+ids.length+' lead'+(ids.length===1?'':'s')+'…','info');
    apiPost('/emails/generate',{job_ids:ids}).then(function(r){
      var n=(r&&r.generated)||0;
      showToast(n?(n+' first email'+(n===1?'':'s')+' ready — look them over in Pending, then send'):'No emails could be written (a lead may have no valid contact address)',n?'success':'warning');
      STATE.modal=null; STATE.takeLeads=undefined;
      STATE.emailTab='pending'; goPage('email');
      if(typeof loadEmailsForCurrentUser==='function') loadEmailsForCurrentUser();
    }).catch(function(e){ showToast('Could not write the emails: '+((e&&e.message)||e),'error'); });
  };

  window.openTakeLeads=function(){
    STATE.takeLeads=undefined; var t=T(); t.loading=true; STATE.modal=drawModal(); render();
    apiGet('/leads/take/status').then(function(st){
      t.st=st; t.loading=false; t.count=String(Math.max(1,Math.min(10,st.can_take||1)));
      STATE.modal=drawModal(); render();
    }).catch(function(e){ t.loading=false; t.err=(e&&e.message)||'Could not load'; STATE.modal=drawModal(); render(); });
  };
  window.takeLeadsCount=function(el){ T().count=el.value; };
  window.takeLeadsGo=function(){
    var t=T(); if(t.busy) return;
    var n=Math.floor(Number(t.count)); if(!(n>=1)){ showToast('Say how many (1 or more)','warning'); return; }
    t.busy=true; STATE.modal=drawModal(); render();
    apiPost('/leads/take',{count:n}).then(function(r){
      t.busy=false; t.result=r; STATE.modal=drawModal(); render();
      if(typeof refreshJobs==='function') refreshJobs();
    }).catch(function(e){ t.busy=false; t.err=(e&&e.message)||'Could not take them'; STATE.modal=drawModal(); render(); });
  };
  window.takeLeadsClose=function(){ STATE.takeLeads=undefined; closeModal(); };

  var WHY={
    off:'Taking leads yourself is switched off. An admin turns it on in Admin → System Settings → Leads.',
    cap_reached:'You have taken all you may for today — more tomorrow.',
    no_mailbox:'You need a connected email ID first (Email IDs).'
  };

  function drawModal(){
    var t=T(), st=t.st, body, foot;
    if(t.loading){ body='<div class="c-text3 fs-13">Checking what you may take today…</div>'; foot=''; }
    else if(t.result){
      var r=t.result;
      body='<div class="fs-14" style="font-weight:700;margin-bottom:6px">'+(r.taken?('You now own '+r.taken+' lead'+(r.taken===1?'':'s')+'.'):'Nothing was taken.')+'</div>'+
        '<div class="fs-13 c-text2">'+esc(r.message||(r.empty?'':'They are spread over your connected mailboxes. Nothing has been sent — the next step is to write the first emails.'))+'</div>'+
        (r.taken?'<div class="fs-12 c-text3" style="margin-top:8px">You may take '+(r.remaining_today||0)+' more today.</div>':'');
      foot='<button class="btn btn-outline" onclick="takeLeadsClose()">Not now</button>'+
        (r.taken?'<button class="btn btn-primary" onclick="writeFirstEmails('+esc(JSON.stringify(r.job_ids)).replace(/"/g,'&quot;')+')">Write the first emails</button>':'');
    } else if(t.err||!st){
      body='<div class="c-red fs-13">'+esc(t.err||'Could not load')+'</div>'; foot='<button class="btn btn-outline" onclick="takeLeadsClose()">Close</button>';
    } else {
      var can=st.can_take||0, blocked=!st.enabled||!!st.reason||can<=0;
      var mbs=(st.mailboxes||[]).map(function(m){ return '<div class="fs-12 c-text2">✉ '+esc(m.email)+' <span class="c-text3">— room to send '+m.remaining+' today</span></div>'; }).join('');
      body=(blocked
        ? '<div class="fs-13" style="padding:10px 12px;border:2px dashed var(--glass-brd)">'+esc(WHY[st.reason]||st.message||'You cannot take leads right now.')+(st.message&&st.reason==='no_mailbox'?'<div class="fs-12 c-text3" style="margin-top:4px">'+esc(st.message)+'</div>':'')+'</div>'
        : '<div class="fs-13 c-text2" style="margin-bottom:10px">You may take up to <b>'+can+'</b> more today (your limit is '+st.cap+' a day; you have taken '+st.taken_today+'). They are handed to you from the pool, oldest first, and spread over your connected mailboxes:</div>'+
          '<div style="margin-bottom:12px">'+mbs+'</div>'+
          '<label class="fs-12_5 c-text2" for="take-n">How many?</label> <input id="take-n" class="inp" type="number" min="1" max="'+can+'" value="'+esc(t.count)+'" oninput="takeLeadsCount(this)" style="width:90px;margin-left:8px">'+
          '<div class="fs-12 c-text3" style="margin-top:10px">Taking only makes them yours. Nothing is sent until you write the first emails and send them.</div>');
      foot='<button class="btn btn-outline" onclick="takeLeadsClose()">Cancel</button>'+
        (blocked?'':'<button class="btn btn-primary" '+(t.busy?'disabled ':'')+'onclick="takeLeadsGo()">'+(t.busy?'Taking…':'Take leads')+'</button>');
    }
    return '<div class="modal modal-w480"><div class="mh"><div class="mt">Take leads</div></div><div class="mb_">'+body+'</div><div class="mf">'+foot+'</div></div>';
  }
})();
