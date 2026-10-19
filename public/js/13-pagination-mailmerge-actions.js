// ── PAGINATION ─────────────────────────────────
window.setLeadsPage=function(p){STATE.leadsPage=Math.max(0,p);render();}
window.toggleJobFilter=function(key,val,checked){
  var arr=(STATE.jobsFilter[key]||[]).slice();
  if(checked){if(arr.indexOf(val)===-1)arr.push(val);}
  else{arr=arr.filter(function(x){return x!==val;});}
  STATE.jobsFilter[key]=arr;STATE.leadsPage=0;render();
};
window.openEditPendingEmail=function(id){
  var pe=(STATE.pendingEmails||[]).find(function(e){return e.id===id;});
  if(!pe)return;
  STATE.modal='<div class="modal modal-w640">'+
    '<div class="mh"><div class="mt">Edit Email \u2014 '+htmlEsc(pe.to_email||'')+'</div><button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_" style="padding:18px 20px">'+
      '<div class="fgrp"><label class="flbl">Subject</label><input class="inp" id="edit-pe-subj" value="'+htmlEsc(pe.subject||'')+'" onfocus="setVarInsertTarget(\'subject\')"/></div>'+
      '<div class="fgrp"><label class="flbl">Body</label><textarea class="txta w100" id="edit-pe-body" style="min-height:300px;line-height:1.7" onfocus="setVarInsertTarget(\'body\')">'+htmlEsc(pe.body||'')+'</textarea></div>'+
      renderVarChipBar('edit-pe-subj','edit-pe-body')+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="savePendingEmailEdit(\''+id+'\')">Save changes</button>'+
    '</div>'+
  '</div>';
  render();
};
window.savePendingEmailEdit=function(id){
  var subj=(document.getElementById('edit-pe-subj')||{}).value||'';
  var body=(document.getElementById('edit-pe-body')||{}).value||'';
  apiFetch('PATCH','/emails/'+id,{subject:subj,body:body}).then(function(updated){
    STATE.pendingEmails=(STATE.pendingEmails||[]).map(function(e){return e.id===id?Object.assign({},e,{subject:updated.subject||subj,body:updated.body||body}):e;});
    closeModal();showToast('Email updated','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};
document.addEventListener('click',function(){
  if(STATE.openDrop!==null){STATE.openDrop=null;render();}
});
// Leads per page — 10 / 20 / 50, the person's own (owner, 19 Oct, R-280). Saved against the ACCOUNT (D-0022), so it follows them
// to another device and never to the next person on a shared one. A failed save still applied on screen.
window.setLeadsPageSize=function(n){
  n=Number(n); if([10,20,50].indexOf(n)<0) return;
  STATE.leadsPageSize=n; STATE.leadsPage=0; render();
  if(STATE.token&&typeof apiFetch==='function') apiFetch('PUT','/me/preferences',{leads_per_page:n}).catch(function(){});
};

// ── MAIL MERGE ─────────────────────────────────
window.openMailMerge=function(ids){
  if(!ids||!ids.length){showToast("No leads selected","warning");return;}
  var leads=ids.map(function(id){return STATE.leads.find(function(l){return l.id===id;});}).filter(function(l){return l&&!l.del;});
  if(!leads.length){showToast("No valid leads","warning");return;}
  STATE.mailMerge={leads:leads,currentIdx:0,emails:{},sent:0,skipped:0};
  // Pre-fill emails for all leads
  leads.forEach(function(l,i){
    var co=STATE.companies.find(function(c){return c.id===l.coid;})||{};
    STATE.mailMerge.emails[i]={subj:fillEmail(STATE.emailSubj,l,co,STATE.user.name),body:fillEmail(STATE.emailBody,l,co,STATE.user.name),sent:false};
  });
  STATE.modal=renderMailMergeModal();
  render();
}

window.closeMailMerge=function(){
  var mm=STATE.mailMerge;
  if(mm&&mm.sent>0)showToast(mm.sent+" email"+(mm.sent>1?"s":"")+" sent via mail merge","success");
  STATE.mailMerge=null;STATE.modal=null;STATE.leadsSelected={};render();
}

window.mailMergeNav=function(dir){
  var mm=STATE.mailMerge;
  if(!mm)return;
  // Save current edits before navigating
  var subjEl=document.getElementById("mm-subj");
  var bodyEl=document.getElementById("mm-body");
  if(subjEl)mm.emails[mm.currentIdx].subj=subjEl.value;
  if(bodyEl)mm.emails[mm.currentIdx].body=bodyEl.value;
  mm.currentIdx=Math.max(0,Math.min(mm.leads.length-1,mm.currentIdx+dir));
  STATE.modal=renderMailMergeModal();render();
}

window.mailMergeEdit=function(field,val){
  if(!STATE.mailMerge)return;
  STATE.mailMerge.emails[STATE.mailMerge.currentIdx][field]=val;
}

window.mailMergeSend=function(){
  var mm=STATE.mailMerge;
  if(!mm)return;
  var idx=mm.currentIdx;
  var l=mm.leads[idx];
  var e=mm.emails[idx];
  if(!l.email){showToast("No email for this lead","warning");return;}
  if(mm.emails[idx].sent){showToast("Already sent to this lead","info");return;}

  // Save edits from textarea
  var subjEl=document.getElementById("mm-subj");
  var bodyEl=document.getElementById("mm-body");
  if(subjEl)e.subj=subjEl.value;
  if(bodyEl)e.body=bodyEl.value;

  var plt=STATE.user.plt||"Gmail";
  // Open in correct Gmail/Outlook account
  var url=plt==="Gmail"
    ?"https://mail.google.com/mail/u/0/?view=cm&to="+encodeURIComponent(l.email)+"&su="+encodeURIComponent(e.subj)+"&body="+encodeURIComponent(e.body)
    :"https://outlook.live.com/mail/0/deeplink/compose?to="+encodeURIComponent(l.email)+"&subject="+encodeURIComponent(e.subj)+"&body="+encodeURIComponent(e.body);
  window.open(url,"_blank");

  // Mark as sent
  mm.emails[idx].sent=true;
  mm.sent=(mm.sent||0)+1;

  // Log
  STATE.emails.push({id:"e"+Date.now(),lid:l.id,by:STATE.user.id,to:l.email,subj:e.subj,body:e.body,plt:plt,dt:todayIST(),status:"sent"});
  STATE.activities.push({id:"a"+Date.now(),lid:l.id,uid:STATE.user.id,type:"email",txt:"Email sent via mail merge ("+plt+")",dt:todayIST()});

  // Auto-advance to next unsent lead
  var next=mm.currentIdx+1;
  while(next<mm.leads.length&&mm.emails[next]&&mm.emails[next].sent)next++;
  if(next<mm.leads.length)mm.currentIdx=next;

  STATE.modal=renderMailMergeModal();render();
}

window.mailMergeSkip=function(){
  var mm=STATE.mailMerge;
  if(!mm)return;
  mm.skipped=(mm.skipped||0)+1;
  mm.currentIdx=Math.min(mm.leads.length-1,mm.currentIdx+1);
  STATE.modal=renderMailMergeModal();render();
}
