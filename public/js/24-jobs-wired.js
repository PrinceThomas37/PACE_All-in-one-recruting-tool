// ── Jobs (wired) ───────────────────────────────
window.changeJobStage=function(jid,st){
  var j=jobById(jid);if(!j)return;
  if(j.stage===st)return;
  var old=j.stage;j.stage=st;
  if(!STATE._pendingStageChanges)STATE._pendingStageChanges={};
  STATE._pendingStageChanges[jid]=st;
  render();
  apiPut('/jobs/'+jid,{stage:st}).then(function(){
    if(STATE._pendingStageChanges)delete STATE._pendingStageChanges[jid];
    showToast('Stage updated','success');
  }).catch(function(e){
    if(STATE._pendingStageChanges)delete STATE._pendingStageChanges[jid];
    j.stage=old;showToast('Failed: '+e.message,'error');render();
  });
};
window.saveJobNotes=function(jid,val){
  var j=jobById(jid);if(!j||j.notes===val)return;var old=j.notes;j.notes=val;
  apiPut('/jobs/'+jid,{notes:val}).then(function(){showToast('Notes saved','success');}).catch(function(e){j.notes=old;showToast('Failed: '+e.message,'error');render();});
};
window.deleteJob=function(jid){
  if(!confirm('Delete this job and all its contacts?'))return;
  apiDelete('/jobs/'+jid).then(function(){STATE.modal=null;STATE.detailJob=null;showToast('Job deleted','success');return refreshJobs();}).catch(function(e){showToast('Failed: '+e.message,'error');});
};
window.submitAddJob=function(){
  var co=document.getElementById('aj-co').value;
  var pos=document.getElementById('aj-pos').value.trim();
  var fn=document.getElementById('aj-fn').value.trim();
  if(!co){showToast('Pick a company','error');return;}
  if(!pos){showToast('Position is required','error');return;}
  if(!fn){showToast('First contact name is required','error');return;}
  var payload={company_id:co,position:pos,
    location:document.getElementById('aj-loc').value.trim(),
    source:document.getElementById('aj-src').value.trim()||'LinkedIn',
    job_url:document.getElementById('aj-url').value.trim(),
    stage:'Active',notes:'',
    contacts:[{first_name:fn,last_name:document.getElementById('aj-ln').value.trim(),
      designation:document.getElementById('aj-desig').value.trim(),
      email:document.getElementById('aj-email').value.trim(),
      phone:document.getElementById('aj-phone').value.trim(),linkedin:''}]};
  apiPost('/jobs',payload).then(function(){STATE.modal=null;showToast('Job created','success');return refreshJobs();}).catch(function(e){showToast('Failed: '+e.message,'error');});
};
window.submitAddContact=function(jid){
  var fn=document.getElementById('ac-fn').value.trim();
  if(!fn){showToast('First name is required','error');return;}
  var existing=jobContacts(jid);
  apiPost('/contacts',{job_id:jid,first_name:fn,
    last_name:document.getElementById('ac-ln').value.trim(),
    designation:document.getElementById('ac-desig').value.trim(),
    email:document.getElementById('ac-email').value.trim(),
    phone:document.getElementById('ac-phone').value.trim(),
    linkedin:document.getElementById('ac-linkedin').value.trim(),
    is_primary:existing.length===0
  }).then(function(){showToast('Contact added','success');STATE.modal={type:'jobDetail',id:jid};return refreshJobs();}).catch(function(e){showToast('Failed: '+e.message,'error');});
};
window.deleteContact=function(cid){
  if(!confirm('Delete this contact?'))return;
  apiDelete('/contacts/'+cid).then(function(){showToast('Contact deleted','success');return refreshJobs();}).catch(function(e){showToast('Failed: '+e.message,'error');});
};


