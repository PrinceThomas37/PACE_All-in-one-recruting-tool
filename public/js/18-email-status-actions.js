// ════════════════════════════════════════════════
// DROP G — Email status + OOO + Reminder actions
// ════════════════════════════════════════════════
window.changeEmailStatus=function(cid, newStatus, email, contactName){
  if(newStatus==='out_of_office'){
    // Show OOO date picker modal
    STATE.modal='<div class="modal modal-w480">'+
      '<div class="mh"><div class="mt">Out of Office — '+htmlEsc(contactName)+'</div>'+
      '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
      '<div class="mb_">'+
        '<div class="fs-13 c-text2" style="margin-bottom:14px">'+
          htmlEsc(contactName)+' ('+htmlEsc(email)+') will be marked as Out of Office.<br>'+
          'A reminder will be created for their return date and shown on your dashboard.'+
        '</div>'+
        '<div class="fgrp"><label class="flbl">Out of office until <span class="c-red">*</span></label>'+
          '<input type="date" class="inp" id="ooo-date-inp" style="font-size:13px" min="'+todayIST()+'"/>'+
        '</div>'+
      '</div>'+
      '<div class="mf">'+
        '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-primary" onclick="submitOOO(\''+cid+'\',\''+htmlEsc(contactName)+'\')">Set OOO & Create Reminder</button>'+
      '</div>'+
    '</div>';
    render();
  } else {
    // Directly update status
    apiFetch('PATCH','/contacts/'+cid+'/email-status',{email_status:newStatus}).then(function(){
      showToast(htmlEsc(contactName)+' marked as '+(CONTACT_STATUS_LABELS[newStatus]||newStatus),'success');
      return refreshJobs();
    }).catch(function(e){showToast('Failed: '+e.message,'error'); if(typeof refreshJobs==='function')refreshJobs();});   // the menu goes back to what is really saved
  }
};

window.submitOOO=function(cid, contactName){
  var dateEl=document.getElementById('ooo-date-inp');
  if(!dateEl||!dateEl.value){showToast('Please pick a return date','warning');return;}
  var oooUntil=dateEl.value;
  closeModal();
  apiFetch('PATCH','/contacts/'+cid+'/email-status',{email_status:'out_of_office',ooo_until:oooUntil}).then(function(){
    showToast(htmlEsc(contactName)+' marked OOO until '+oooUntil+' \u2014 reminder created','success');
    return Promise.all([refreshJobs(), loadReminders()]);
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

function loadReminders(){
  return apiGet('/reminders').then(function(d){
    STATE.reminders=d;render();
  }).catch(function(){});
}

// ════════════════════════════════════════════════
// EMAIL ACTIONS — Drop F
// ════════════════════════════════════════════════
window.previewPendingEmail=function(id){STATE.previewPendingId=id;render();};

// ── SEND SELECTED, and "Review & send" for ONE lead (owner, 12 Oct) ───────────────────────────────────────────────────
// The Pending tab used to offer exactly one send button — everything in the queue — and Find Leads' "Review & send" only
// switched to that tab, so a person who meant to send one lead's email landed on all of them. The rule lives HERE, once:
//   • a FOCUS (STATE.pendingFocus = { jobId, label }) narrows the list to one lead's pending emails;
//   • with a focus, the person's own rows in it start TICKED (they came to send that lead's email); without one, nothing is;
//   • a tick is stored as true/false in STATE.pendingSel; "not stored" means the default above.
// Only the caller's own rows can be ticked or sent (a lead's team rows are shown, never sent from here — D-0034).
function pendingRowJobId(e){ return e.job_id || (e.job && e.job.id) || null; }
window.pendingView=function(){
  var all=STATE.pendingEmails||[], focus=STATE.pendingFocus||null, sel=STATE.pendingSel||{};
  var list=focus?all.filter(function(e){return pendingRowJobId(e)===focus.jobId;}):all;
  function ticked(e){ return e.is_mine!==false && (sel[e.id]===undefined?!!focus:!!sel[e.id]); }
  var chosen=list.filter(ticked);
  return { all:all, list:list, focus:focus, chosen:chosen, ids:chosen.map(function(e){return e.id;}),
    mineAll:all.filter(function(e){return e.is_mine!==false;}).length,
    mineInList:list.filter(function(e){return e.is_mine!==false;}),
    isTicked:ticked };
};
window.togglePendingSel=function(id){
  var v=pendingView(), row=v.list.find(function(e){return e.id===id;}); if(!row||row.is_mine===false) return;
  STATE.pendingSel=STATE.pendingSel||{}; STATE.pendingSel[id]=!v.isTicked(row); render();
};
// The header box: tick every one of the person's own rows in the list, or — when they all are already — untick them.
window.togglePendingSelAll=function(){
  var v=pendingView(), mine=v.mineInList; if(!mine.length) return;
  var allOn=mine.every(v.isTicked);
  STATE.pendingSel=STATE.pendingSel||{};
  mine.forEach(function(e){ STATE.pendingSel[e.id]=!allOn; });
  render();
};
window.clearPendingFocus=function(){ STATE.pendingFocus=null; STATE.pendingSel={}; STATE.pendingEmailPage=0; render(); };
// Another page, or another tab of this one, drops the narrowing: it was for one visit, and a list that is quietly filtered the
// next day is a list that hides mail.
(function(){
  var prev=window.goPage;
  window.goPage=function(p){ if(p!=='email'){ STATE.pendingFocus=null; STATE.pendingSel={}; } return prev.apply(this,arguments); };
})();

window.openSendSelectedConfirm=function(){
  var v=pendingView();
  if(!v.chosen.length){showToast('Tick the emails you want to send','warning');return;}
  var to=v.chosen.slice(0,8).map(function(e){
    var co=e.job&&e.job.company&&e.job.company.name;
    return '<div class="fs-12_5 c-text2">'+htmlEsc(e.to_email||'')+(co?' <span class="c-text3">· '+htmlEsc(co)+'</span>':'')+'</div>';
  }).join('')+(v.chosen.length>8?'<div class="fs-12 c-text3">…and '+(v.chosen.length-8)+' more</div>':'');
  var n=v.chosen.length;
  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Confirm: Send '+(n===1?'this email':n+' selected emails')+'</div></div>'+
    '<div class="mb_">'+
      '<div class="fs-13 c-text2" style="margin-bottom:10px">These go out now, one after another, from the email IDs they were written for. Everything you did not tick stays in Pending.</div>'+
      '<div class="card cp">'+to+'</div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitSendSelected()">Send '+(n===1?'it':'these '+n)+'</button>'+
    '</div>'+
  '</div>';
  render();
};
window.submitSendSelected=function(){
  var ids=pendingView().ids;
  closeModal();
  if(!ids.length) return;
  var gone={}; ids.forEach(function(i){gone[i]=true;});
  // Same hand-off as Send all: the card shows at once, the rows leave the list, and the real run takes over from the poll.
  STATE.sendProgress={active:true,total:ids.length,sent:0,failed:0,current:'Initiating send...',failDetails:[],startedAt:new Date().toISOString()};
  STATE.pendingEmails=(STATE.pendingEmails||[]).filter(function(e){return !gone[e.id];});
  STATE.pendingSel={};
  render();
  stopProgressPoll(); startProgressPoll();
  apiPost('/emails/send-selected',{email_ids:ids}).then(function(res){
    if(!res||!res.queued){
      STATE.sendProgress=null; loadEmailsForCurrentUser();
      showToast('None of those could go out right now — one may be waiting to retry, or was already sent. Nothing was lost.','info');
      return;
    }
    showToast(res.queued+' email'+(res.queued===1?'':'s')+' queued for sending','success');
  }).catch(function(e){
    STATE.sendProgress=null; loadEmailsForCurrentUser();
    showToast('Failed: '+e.message,'error');
  });
};

window.openSendAllConfirm=function(){
  // D-0034: a bd_lead's Pending tab now includes their team's rows too, but
  // /emails/queue-all only ever queues the CALLER's own (server-scoped by
  // sent_by) — so the count shown here must be the caller's own, never the
  // team total, or the number promised would not match the number sent.
  var pending=(STATE.pendingEmails||[]).filter(function(e){return e.is_mine!==false;});
  if(!pending.length){showToast('No pending emails','warning');return;}
  var now=new Date();
  var dateStr=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  var timeStr=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Confirm: Send all pending</div></div>'+
    '<div class="mb_">'+
      '<div style="padding:16px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:12px">'+
        '<div class="fs-22 c-accent" style="font-weight:700;margin-bottom:4px">'+pending.length+' emails</div>'+
        '<div class="fs-14 c-text2">→ '+pending.length+' recipients</div>'+
        '<div class="fs-12 c-text3" style="margin-top:6px">'+dateStr+' · '+timeStr+'</div>'+
      '</div>'+
      '<div class="fs-13 c-text2">Emails will be marked as <strong>queued</strong> and sent automatically once your Outlook account is connected. Each email is unique — generated by AI for each contact.</div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitSendAll()">Confirm & Queue</button>'+
    '</div>'+
  '</div>';
  render();
};

window.submitSendAll=function(){
  // Only the caller's own rows are queued (see openSendAllConfirm) — a
  // teammate's row shown on a bd_lead's Pending tab must not disappear from
  // under them because a leader clicked Send.
  var mine=(STATE.pendingEmails||[]).filter(function(e){return e.is_mine!==false;});
  closeModal();
  // Show progress bar immediately — don't wait for first poll
  STATE.sendProgress={active:true,total:mine.length,sent:0,failed:0,current:'Initiating send...',failDetails:[],startedAt:new Date().toISOString()};
  STATE.pendingEmails=(STATE.pendingEmails||[]).filter(function(e){return e.is_mine===false;});
  render(); // bar is visible right now
  stopProgressPoll(); // clear any stale timer from previous send
  startProgressPoll(); // start polling for real backend updates
  apiPost('/emails/queue-all',{}).then(function(res){
    // The server says plainly when a send for this person is ALREADY running (it will not start a second one). The
    // card then follows that real run; nothing is "queued" by this click.
    if(res&&res.already_running){
      showToast('A send is already running. It works through the list it started with — when it finishes, press Send all pending again for anything new.','info');
      loadEmailsForCurrentUser();   // this click had already taken the rows off the list on screen — put them back
      return;
    }
    showToast(res.queued+' emails queued for sending','success');
  }).catch(function(e){
    STATE.sendProgress=null;
    loadEmailsForCurrentUser();
    showToast('Failed: '+e.message,'error');
  });
};

window.saveEmailEdit=function(id){
  var el=document.getElementById('edit-email-body-'+id);
  if(!el)return;
  apiPut='/emails/'+id; // using apiPatch
  apiFetch('PATCH','/emails/'+id,{body:el.value}).then(function(updated){
    STATE.pendingEmails=(STATE.pendingEmails||[]).map(function(e){return e.id===id?Object.assign({},e,{body:updated.body}):e;});
    showToast('Email updated','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

function normalizeIndustryMap(obj){
  var out={};
  Object.keys(obj).forEach(function(k){
    var norm=normalizeIndustry(k);
    out[norm]=(out[norm]||0)+obj[k];
  });
  return out;
}

