// ── Manager Users functions ──────────────────────────────────
window.loadUserEmails=function(userId){
  apiGet('/users/'+userId+'/emails').then(function(d){
    STATE.userEmailsCache=STATE.userEmailsCache||{};
    STATE.userEmailsCache[userId]=d||[];
    render();
  }).catch(function(){});
};

window.toggleUserRole=function(userId,role,checked){
  var usr=STATE.users.find(function(x){return x.id===userId;});
  if(!usr)return;
  var roles=usr.roles?usr.roles.slice():[usr.role];
  if(checked&&roles.indexOf(role)===-1)roles.push(role);
  else if(!checked)roles=roles.filter(function(r){return r!==role;});
  if(!roles.length){showToast('User must have at least one role','warning');return;}
  apiPut('/users/'+userId+'/roles',{roles:roles}).then(function(u){
    STATE.users=STATE.users.map(function(x){return x.id===userId?normaliseUser(u):x;});
    showToast('Roles updated','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.openAddUserEmail=function(userId,platform){
  platform=platform||'Microsoft';
  var isMicrosoft=platform==='Microsoft';
  STATE._addEmailUserId=userId;
  STATE._addEmailPlatform=platform;
  STATE.modal='<div class="modal modal-w420">'
    +'<div class="mh"><div class="mt">Add '+platform+' Email</div><button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'
    +'<div class="mb_">'
    +'<div class="fgrp"><label class="flbl">Email address *</label><input class="inp" id="ue-email" placeholder="e.g. john@futeglobal.com"/></div>'
    +'<div class="fgrp"><label class="flbl">Display name</label><input class="inp" id="ue-name" placeholder="John Smith"/></div>'
    +'<div class="fgrp"><label class="flbl">Daily limit</label><input class="inp" type="number" id="ue-limit" value="300" min="1" max="500" style="width:120px"/></div>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 0">'
    +'<input type="checkbox" id="ue-primary"/> Set as primary email (login email)</label>'
    +'</div>'
    +'<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>'
    +(isMicrosoft
      ?'<button class="btn btn-primary" onclick="submitAddUserEmailMicrosoft(STATE._addEmailUserId)" style="background:#0078d4">Save &amp; Connect Microsoft</button>'
      :'<button class="btn btn-primary" onclick="submitAddUserEmail(STATE._addEmailUserId,STATE._addEmailPlatform)" style="background:#16a34a">Save Gmail</button>')
    +'</div></div>';
  render();
};

window.submitAddUserEmail=function(userId,platform){
  var email=(document.getElementById('ue-email')||{}).value||'';
  var name=(document.getElementById('ue-name')||{}).value||'';
  var limit=parseInt((document.getElementById('ue-limit')||{}).value||'300');
  var isPrimary=(document.getElementById('ue-primary')||{}).checked||false;
  if(!email){showToast('Email address required','warning');return;}
  apiPost('/users/'+userId+'/emails',{email_address:email,display_name:name||email,platform:platform||'Gmail',daily_send_limit:limit,is_primary:isPrimary}).then(function(e){
    STATE.userEmailsCache=STATE.userEmailsCache||{};
    STATE.userEmailsCache[userId]=(STATE.userEmailsCache[userId]||[]).concat([e]);
    closeModal();showToast('Email added','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.submitAddUserEmailMicrosoft=function(userId){
  var email=(document.getElementById('ue-email')||{}).value||'';
  var name=(document.getElementById('ue-name')||{}).value||'';
  var limit=parseInt((document.getElementById('ue-limit')||{}).value||'300');
  var isPrimary=(document.getElementById('ue-primary')||{}).checked||false;
  if(!email){showToast('Email address required','warning');return;}
  apiPost('/users/'+userId+'/emails',{email_address:email,display_name:name||email,platform:'Microsoft',daily_send_limit:limit,is_primary:isPrimary}).then(function(e){
    STATE.userEmailsCache=STATE.userEmailsCache||{};
    STATE.userEmailsCache[userId]=(STATE.userEmailsCache[userId]||[]).concat([e]);
    closeModal();render();
    // Open Microsoft OAuth popup
    var url=API_URL+'/auth/microsoft/connect?userEmailId='+e.id+'&token='+STATE.token;
    window.open(url,'ms_oauth','width=600,height=700,scrollbars=yes');
    showToast('Complete Microsoft login in the popup','info');
    window._msOAuthHandler=function(event){
      if(event.data&&event.data.type==='ms_oauth_success'){
        window.removeEventListener('message',window._msOAuthHandler);
        loadUserEmails(userId);
        showToast('Microsoft connected: '+event.data.email,'success');
      } else if(event.data&&event.data.type==='ms_oauth_error'){
        window.removeEventListener('message',window._msOAuthHandler);
        showToast('Connection failed: '+event.data.error,'error');
      }
    };
    window.addEventListener('message',window._msOAuthHandler);
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.connectMicrosoftUserEmail=function(userId,userEmailId){
  var url=API_URL+'/auth/microsoft/connect?userEmailId='+userEmailId+'&token='+STATE.token;
  window.open(url,'ms_oauth','width=600,height=700,scrollbars=yes');
  showToast('Complete Microsoft login in the popup','info');
  window._msOAuthHandler=function(event){
    if(event.data&&event.data.type==='ms_oauth_success'){
      window.removeEventListener('message',window._msOAuthHandler);
      loadUserEmails(userId);
      showToast('Connected: '+event.data.email,'success');
    } else if(event.data&&event.data.type==='ms_oauth_error'){
      window.removeEventListener('message',window._msOAuthHandler);
      showToast('Failed: '+event.data.error,'error');
    }
  };
  window.addEventListener('message',window._msOAuthHandler);
};

window.connectGmailUserEmail=function(userId,userEmailId){
  var url=API_URL+'/auth/google/connect?userEmailId='+userEmailId+'&token='+STATE.token;
  window.open(url,'google_oauth','width=600,height=700,scrollbars=yes');
  showToast('Complete Google login in the popup','info');
  window._googleOAuthHandler=function(event){
    if(event.data&&event.data.type==='google_oauth_success'){
      window.removeEventListener('message',window._googleOAuthHandler);
      loadUserEmails(userId);
      showToast('Connected: '+event.data.email,'success');
    } else if(event.data&&event.data.type==='google_oauth_error'){
      window.removeEventListener('message',window._googleOAuthHandler);
      showToast('Failed: '+event.data.error,'error');
    }
  };
  window.addEventListener('message',window._googleOAuthHandler);
};

window.toggleUserEmailActive=function(userId,emailId,active){
  apiPatch('/users/'+userId+'/emails/'+emailId,{is_active:active}).then(function(e){
    STATE.userEmailsCache[userId]=(STATE.userEmailsCache[userId]||[]).map(function(x){return x.id===emailId?e:x;});
    var r=e.reassignment;
    if(r&&r.reassigned)showToast('Deactivated — moved '+r.reassigned+' lead'+(r.reassigned!==1?'s':'')+' to another mailbox','success');
    else if(r&&r.stranded)showToast('Deactivated — '+r.stranded+' lead'+(r.stranded!==1?'s':'')+' have no other connected mailbox and will stay pending until you connect one','error');
    else showToast(active?'Activated':'Deactivated','success');
    render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.setPrimaryEmail=function(userId,emailId){
  apiPatch('/users/'+userId+'/emails/'+emailId,{is_primary:true}).then(function(){
    loadUserEmails(userId);
    showToast('Primary email updated','success');
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.deleteUserEmail=function(userId,emailId){
  if(!confirm('Remove this email ID?'))return;
  apiDelete('/users/'+userId+'/emails/'+emailId).then(function(res){
    STATE.userEmailsCache[userId]=(STATE.userEmailsCache[userId]||[]).filter(function(x){return x.id!==emailId;});
    var r=res&&res.reassignment;
    if(r&&r.reassigned)showToast('Removed — moved '+r.reassigned+' lead'+(r.reassigned!==1?'s':'')+' to another mailbox','success');
    else if(r&&r.stranded)showToast('Removed — '+r.stranded+' lead'+(r.stranded!==1?'s':'')+' have no other connected mailbox and will stay pending until you connect one','error');
    else showToast('Email removed','success');
    render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.openAssignToBDLead=function(leadId){
  STATE._assignManagerId=leadId;
  STATE._assignType='bd_to_bdlead';
  var bdManagers=STATE.users.filter(function(x){return userHasRole(x,'bd');});
  var existing=(STATE.teamAssignments||[]).filter(function(a){return a.manager_id===leadId&&a.assignment_type==='bd_to_bdlead';}).map(function(a){return a.member_id;});
  var available=bdManagers.filter(function(x){return existing.indexOf(x.id)===-1;});
  if(!available.length){showToast('All BD Managers already assigned to this lead','info');return;}
  var opts=available.map(function(u){return '<option value="'+u.id+'">'+htmlEsc(u.name)+'</option>';}).join('');
  STATE.modal='<div class="modal modal-w400"><div class="mh"><div class="mt">Assign BD Manager</div><button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'
    +'<div class="mb_"><div class="fgrp"><label class="flbl">Select BD Manager</label><select class="sel" id="assign-member"><option value="">— select —</option>'+opts+'</select></div></div>'
    +'<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAssignment(STATE._assignManagerId,STATE._assignType)">Assign</button></div></div>';
  render();
};

window.openAssignRAToManager=function(managerId){
  STATE._assignManagerId=managerId;
  STATE._assignType='ra_to_bd';
  var raUsers=STATE.users.filter(function(x){return userHasRole(x,'ra');});
  var existing=(STATE.teamAssignments||[]).filter(function(a){return a.manager_id===managerId&&a.assignment_type==='ra_to_bd';}).map(function(a){return a.member_id;});
  var available=raUsers.filter(function(x){return existing.indexOf(x.id)===-1;});
  if(!available.length){showToast('All RAs already assigned to this manager','info');return;}
  var opts=available.map(function(u){return '<option value="'+u.id+'">'+htmlEsc(u.name)+'</option>';}).join('');
  STATE.modal='<div class="modal modal-w400"><div class="mh"><div class="mt">Assign Research Analyst</div><button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'
    +'<div class="mb_"><div class="fgrp"><label class="flbl">Select RA</label><select class="sel" id="assign-member"><option value="">— select —</option>'+opts+'</select></div></div>'
    +'<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAssignment(STATE._assignManagerId,STATE._assignType)">Assign</button></div></div>';
  render();
};

window.submitAssignment=function(managerId,type){
  managerId=managerId||STATE._assignManagerId;
  type=type||STATE._assignType;
  var memberId=(document.getElementById('assign-member')||{}).value||'';
  if(!memberId){showToast('Please select a user','warning');return;}
  apiPost('/team-assignments',{member_id:memberId,manager_id:managerId,assignment_type:type}).then(function(a){
    STATE.teamAssignments=(STATE.teamAssignments||[]).concat([a]);
    closeModal();showToast('Assigned','success');
    apiGet('/team-assignments').then(function(d){STATE.teamAssignments=d||[];render();});
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.removeAssignment=function(event,assignmentId){
  event.stopPropagation();
  if(!confirm('Remove this assignment?'))return;
  apiDelete('/team-assignments/'+assignmentId).then(function(){
    STATE.teamAssignments=(STATE.teamAssignments||[]).filter(function(a){return a.id!==assignmentId;});
    showToast('Removed','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.connectMicrosoftAccount=function(accountId){
  var url=API_URL+'/auth/microsoft/connect?accountId='+accountId;
  var popup=window.open(url,'ms_oauth','width=600,height=700,scrollbars=yes');
  showToast('Complete Microsoft login in the popup window','info');
  window._msOAuthHandler=function(event){
    if(event.data&&event.data.type==='ms_oauth_success'){
      window.removeEventListener('message',window._msOAuthHandler);
      STATE.emailAccounts=STATE.emailAccounts.map(function(x){
        return x.id===event.data.accountId?Object.assign({},x,{platform:'Microsoft',ms_connected:true}):x;
      });
      showToast('Microsoft connected: '+event.data.email,'success');
      render();
    } else if(event.data&&event.data.type==='ms_oauth_error'){
      window.removeEventListener('message',window._msOAuthHandler);
      showToast('Connection failed: '+event.data.error,'error');
    }
  };
  window.addEventListener('message',window._msOAuthHandler);
};

window.selectPlanFromEmail=function(emailId){
  if(!emailId||!STATE.user)return;
  STATE.planFromEmailId=emailId;
  STATE.sigEmailId=emailId;
  loadMailboxSignature(STATE.user.id,emailId);
  render();
};
window.selectComposeFromEmail=function(emailId){
  if(!emailId||!STATE.user)return;
  STATE.composeFromEmailId=emailId;
  loadMailboxSignature(STATE.user.id,emailId);
  render();
};
window.applyOutreachStylePreset=function(presetKey){
  var preset=OUTREACH_STYLE_PRESETS[presetKey];
  if(!preset)return;
  STATE.outreachStylePreset=presetKey;
  STATE.randomTemplateMode=false;
  STATE.emailSubj=preset.o1.subj;STATE.emailBody=preset.o1.body;
  STATE.fu1Subj=preset.fu1.subj;STATE.fu1Body=preset.fu1.body;
  STATE.fu2Subj=preset.fu2.subj;STATE.fu2Body=preset.fu2.body;
  STATE.myOutreachPlan=STATE.myOutreachPlan||{};
  STATE.myOutreachPlan['tmpl_o1_subject']=preset.o1.subj;STATE.myOutreachPlan['tmpl_o1_body']=preset.o1.body;
  STATE.myOutreachPlan['tmpl_fu1_subject']=preset.fu1.subj;STATE.myOutreachPlan['tmpl_fu1_body']=preset.fu1.body;
  STATE.myOutreachPlan['tmpl_fu2_subject']=preset.fu2.subj;STATE.myOutreachPlan['tmpl_fu2_body']=preset.fu2.body;
  STATE.myOutreachPlan['compose_style_preset']=presetKey;
  if(userHasAnyRole(STATE.user,'bd','bd_lead','admin')){
    apiPost('/outreach-plan',{key:'compose_style_preset',value:presetKey}).catch(function(){});
  }
  showToast('Applied "'+preset.label+'" style to outreach + both follow-ups — review each tab and Save','success');
  render();
};
function persistOutreachTemplateMode(){
  var userId=STATE.user&&STATE.user.id;
  if(!userId)return;
  try{localStorage.setItem('fute_outreach_tmpl_mode_'+userId,JSON.stringify({random:STATE.randomTemplateMode}));}catch(e){}
}
window.setTemplateModeSpecific=function(){
  STATE.randomTemplateMode=false;
  persistOutreachTemplateMode();
  if(userHasAnyRole(STATE.user,'bd','bd_lead','admin'))apiPost('/outreach-plan',{key:'random_template_mode',value:'false'}).catch(function(){});
  render();
};
window.setTemplateModeRandom=function(){
  STATE.randomTemplateMode=true;
  persistOutreachTemplateMode();
  if(userHasAnyRole(STATE.user,'bd','bd_lead','admin'))apiPost('/outreach-plan',{key:'random_template_mode',value:'true'}).catch(function(){});
  render();
};
window.saveTemplateModePreference=function(){
  persistOutreachTemplateMode();
  if(userHasAnyRole(STATE.user,'bd','bd_lead','admin')){
    apiPost('/outreach-plan',{key:'random_template_mode',value:STATE.randomTemplateMode?'true':'false'})
      .then(function(){showToast('Outreach template mode saved','success');})
      .catch(function(){showToast('Save failed','error');});
  } else {
    showToast('Outreach template mode saved','success');
  }
};
window.setVarInsertTarget=function(target){
  STATE.varInsertTarget=target||'body';
  render();
};
window.insertVarChip=function(token,subjId,bodyId){
  if(!token)return;
  var targetId=(STATE.varInsertTarget==='subject')?subjId:bodyId;
  var where=(STATE.varInsertTarget==='subject')?'subject line':'email body';
  insertVarFromPicker(token,targetId);
  showToast('Added '+mergeVarFriendlyLabel(token)+' to '+where,'success');
};
window.saveOutreachTemplate=function(key,subjId,bodyId){
  var subj=(document.getElementById(subjId)||{}).value||'';
  var body=(document.getElementById(bodyId)||{}).value||'';
  var apiKey=outreachTmplApiKey(key);
  if(key==='outreach'){STATE.emailSubj=subj;STATE.emailBody=body;}
  else if(key==='fu1'){STATE.fu1Subj=subj;STATE.fu1Body=body;}
  else if(key==='fu2'){STATE.fu2Subj=subj;STATE.fu2Body=body;}
  STATE.myOutreachPlan=STATE.myOutreachPlan||{};
  STATE.myOutreachPlan['tmpl_'+apiKey+'_subject']=subj;
  STATE.myOutreachPlan['tmpl_'+apiKey+'_body']=body;
  Promise.all([
    apiPost('/outreach-plan',{key:'tmpl_'+apiKey+'_subject',value:subj}),
    apiPost('/outreach-plan',{key:'tmpl_'+apiKey+'_body',value:body})
  ]).then(function(){showToast('Template saved','success');}).catch(function(e){showToast('Save failed: '+e.message,'error');});
};

window.saveOutreachDay=function(key,val){
  if(!val)return;
  var day=parseInt(val,10);
  STATE.myOutreachPlan=STATE.myOutreachPlan||{};
  STATE.myOutreachPlan[key]=String(day);
  apiPost('/outreach-plan',{key:key,value:String(day)}).then(function(){
    showToast('Schedule saved — '+key.replace('_day','').toUpperCase()+' set to Day '+day,'success');
    render();
  }).catch(function(e){showToast('Save failed: '+e.message,'error');});
};

window.saveEmailTemplate=function(key,subjId,bodyId){
  var subj=(document.getElementById(subjId)||{}).value||'';
  var body=(document.getElementById(bodyId)||{}).value||'';
  if(key==='outreach'){STATE.emailSubj=subj;STATE.emailBody=body;}
  else if(key==='fu1'){STATE.fu1Subj=subj;STATE.fu1Body=body;}
  else if(key==='fu2'){STATE.fu2Subj=subj;STATE.fu2Body=body;}
  var saves=[
    apiPost('/app-settings',{key:'template_'+key+'_subject',value:subj}),
    apiPost('/app-settings',{key:'template_'+key+'_body',value:body})
  ];
  Promise.all(saves).then(function(){showToast('Template saved','success');}).catch(function(e){showToast('Save failed: '+e.message,'error');});
};

window.openEmailEngineModal=function(){
  var outreachTime=(STATE.appSettings&&STATE.appSettings['outreach_send_time'])||'08:00';
  var followupTime=(STATE.appSettings&&STATE.appSettings['followup_send_time'])||'08:30';
  var tzOpts=[
    {val:'Asia/Kolkata',label:'IST — India (UTC+5:30)'},
    {val:'America/New_York',label:'EST — New York (UTC-5)'},
    {val:'America/Chicago',label:'CST — Chicago (UTC-6)'},
    {val:'America/Denver',label:'MST — Denver (UTC-7)'},
    {val:'America/Los_Angeles',label:'PST — Los Angeles (UTC-8)'}
  ].map(function(tz){
    var sel=tz.val==='Asia/Kolkata';
    return '<option value="'+tz.val+'"'+(sel?' selected':'')+'>'+tz.label+'</option>';
  }).join('');
  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Email Engine Schedule</div><button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div style="font-size:13px;color:var(--text2);margin-bottom:18px">Set the daily send times for outreach and follow-up emails. The engine runs automatically at these times every day.</div>'+
      '<div class="fgrp"><label class="flbl">Timezone</label><select class="sel" id="engine-tz">'+tzOpts+'</select></div>'+
      '<div class="g2">'+
        '<div class="fgrp"><label class="flbl">Outreach send time</label><input class="inp" type="time" id="admin-outreach-time" value="'+outreachTime+'"/></div>'+
        '<div class="fgrp"><label class="flbl">Follow-up send time</label><input class="inp" type="time" id="admin-followup-time" value="'+followupTime+'"/></div>'+
      '</div>'+
      '<div style="padding:10px 12px;background:var(--amber-l);border-radius:var(--r);font-size:12px;color:var(--amber);margin-top:4px">'+
        '<strong>Testing:</strong> Use "Run now" to trigger the follow-up engine immediately without waiting for the scheduled time.'+
      '</div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline btn-sm" onclick="runFollowupEngineNow()" style="color:var(--amber);border-color:var(--amber);margin-right:auto">▶ Run now</button>'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="saveAdminSendTimes()">Save schedule</button>'+
    '</div>'+
  '</div>';
  render();
};

window.saveAdminSendTimes=function(){
  var ot=(document.getElementById('admin-outreach-time')||{}).value||'08:00';
  var ft=(document.getElementById('admin-followup-time')||{}).value||'08:30';
  var saves=[
    apiPost('/app-settings',{key:'outreach_send_time',value:ot}),
    apiPost('/app-settings',{key:'followup_send_time',value:ft})
  ];
  Promise.all(saves).then(function(){
    STATE.appSettings=STATE.appSettings||{};
    STATE.appSettings['outreach_send_time']=ot;
    STATE.appSettings['followup_send_time']=ft;
    closeModal();
    showToast('Send times saved','success');
  }).catch(function(e){showToast('Save failed: '+e.message,'error');});
};

window.generatePendingEmails=function(){
  // Get all assigned job IDs
  var assignedJobs=STATE.jobs.filter(function(j){return j.stage==='Assigned';});
  if(!assignedJobs.length){showToast('No assigned leads found','warning');return;}
  var jobIds=assignedJobs.map(function(j){return j.id;});
  showToast('Generating emails for '+jobIds.length+' leads...','info');
  apiPost('/emails/generate',{job_ids:jobIds}).then(function(r){
    showToast(r.generated+' emails generated','success');
    apiGet('/emails?status=pending').then(function(d){
      STATE.pendingEmails=d||[];render();
    });
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.runFollowupEngineNow=function(){
  showToast('Running follow-up engine...','info');
  apiPost('/follow-ups/run',{}).then(function(r){
    showToast('Done — FU1: '+r.fu1_queued+', FU2: '+r.fu2_queued+', Skipped quota: '+r.skipped_quota,'success');
    apiGet('/emails?status=pending').then(function(d){STATE.pendingEmails=d||[];render();});
  }).catch(function(e){showToast('Error: '+e.message,'error');});
};
window.previewEmail=function(id){
  var e=STATE.emails.find(function(x){return x.id===id;});
  STATE.previewEmail=e||null;
  render();
};
window.setMergeLead=function(id){STATE.mergeLeadId=id;STATE.genEmail=null;render();}
window.setPlatform=function(p){STATE.user.plt=p;render();}

window.openEmailPreviewModal=function(){
  // Build genEmail if not already set (fill template variables from selected lead)
  if(!STATE.genEmail){
    // Use loose equality (==) so UUID strings match even if stored as different types
    var ml=null;
    if(STATE.mergeLeadId){
      ml=STATE.leads.find(function(l){return l.id==STATE.mergeLeadId;});
      if(!ml){console.warn('[preview] mergeLeadId not found in STATE.leads:',STATE.mergeLeadId);}
    }
    if(ml){
      // Prefer flat company fields from normaliseLead; fall back to STATE.companies lookup; final fallback to nested l.company
      var co={
        name:ml.coName||(STATE.companies.find(function(c){return c.id==ml.coid;})||{}).name||(ml.company&&ml.company.name)||'',
        ind:ml.coInd||(STATE.companies.find(function(c){return c.id==ml.coid;})||{}).ind||(ml.company&&ml.company.industry)||'',
        loc:ml.coLoc||(STATE.companies.find(function(c){return c.id==ml.coid;})||{}).loc||(ml.company&&ml.company.location)||''
      };
      STATE.genEmail={to:(ml.fn||'')+' '+(ml.ln||''),email:ml.email,subj:fillEmail(STATE.emailSubj,ml,co,STATE.user.name),body:fillEmail(STATE.emailBody,ml,co,STATE.user.name),lid:ml.id};
    } else if(STATE.manualEmail){
      STATE.genEmail={to:STATE.manualEmail,email:STATE.manualEmail,subj:STATE.emailSubj.replace(/{{[\w]+}}/g,''),body:STATE.emailBody.replace(/{{[\w]+}}/g,''),lid:null};
    } else {
      showToast('Select a recipient first','warning');return;
    }
  }
  var ge=STATE.genEmail;
  STATE.modal='<div class="modal modal-w640">'+
    '<div class="mh">'+
      '<div class="mt">Email Preview</div>'+
      '<button class="btn-icon" onclick="closeModal()">'+ico("x",14)+'</button>'+
    '</div>'+
    '<div class="mb_" style="padding:0">'+
      '<div style="padding:12px 20px;background:var(--accent-l);border-bottom:1px solid rgba(37,99,235,.15)">'+
        '<div class="f12 text3"><strong style="color:var(--text)">To:</strong> '+htmlEsc(ge.to)+' &lt;'+htmlEsc(ge.email)+'&gt;</div>'+
        '<div class="f12 text3 mt1"><strong style="color:var(--text)">Subject:</strong> '+htmlEsc(ge.subj)+'</div>'+
      '</div>'+
      '<div style="padding:18px 20px;font-size:13.5px;line-height:1.8;white-space:pre-wrap;max-height:60vh;overflow-y:auto">'+htmlEsc(ge.body)+'</div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Close</button>'+
      '<button class="btn btn-primary" onclick="closeModal();sendEmail()">'+ico("send",13)+' Send this email</button>'+
    '</div>'+
  '</div>';
  render();
};

window.appendPrompt=function(text){
  STATE.aiPrompt=(STATE.aiPrompt||STATE.aiPromptDefault)+"\n"+text;
  var el=document.getElementById("ai-prompt-inp");
  if(el)el.value=STATE.aiPrompt;
}
window.resetAIPrompt=function(){
  STATE.aiPrompt=STATE.aiPromptDefault;
  var el=document.getElementById("ai-prompt-inp");
  if(el)el.value=STATE.aiPromptDefault;
  showToast("Prompt reset to default","info");
}

window.emailSearchInput=function(v){
  STATE.emailSearch=v;
  if(v){STATE.mergeLeadId=null;STATE.manualEmail=null;STATE.manualEmailName=null;STATE.genEmail=null;}
  render();
  setTimeout(function(){var el=document.getElementById("email-search-inp");if(el){el.focus();el.setSelectionRange(v.length,v.length);}},0);
}
window.selectEmailRecipient=function(lid){
  STATE.mergeLeadId=lid;STATE.manualEmail=null;STATE.manualEmailName=null;
  STATE.emailSearch=null;STATE.genEmail=null;render();
}
window.useManualEmail=function(){
  var email=STATE.emailSearch||"";
  if(!email.includes("@")){showToast("Please enter a valid email address","warning");return;}
  STATE.manualEmail=email;STATE.manualEmailName=email;
  STATE.mergeLeadId=null;STATE.emailSearch=null;STATE.genEmail=null;render();
}

window.generateAI=function(){
  var customInstructions=STATE.aiPrompt||STATE.aiPromptDefault;
  // resolve recipient from composeContactId
  if(STATE.composeContactId&&!STATE.mergeLeadId){
    var parts=STATE.composeContactId.split('|');
    var cc=STATE.contacts.find(function(c){return c.id===parts[0];});
    var cj=STATE.jobs.find(function(j){return j.id===parts[1];});
    if(cc&&cj){
      STATE.mergeLeadId=null;
      STATE.manualEmail=cc.email;
      STATE.manualEmailName=(cc.first_name||'')+' '+(cc.last_name||'');
      // pass contact+company into AI call directly
      STATE.aiGenerating=true;render();
      apiPost('/ai/generate-email',{
        contact:{first_name:cc.first_name,last_name:cc.last_name,designation:cc.designation,position:cj.position},
        company:{name:cj.company_name,industry:cj.company_ind,location:cj.location},
        position:cj.position
      }).then(function(d){
        STATE.genEmail={to:(cc.first_name||'')+' '+(cc.last_name||''),email:cc.email,subj:d.subject,body:d.body,lid:null};
        STATE.aiGenerating=false;render();
      }).catch(function(e){STATE.aiGenerating=false;showToast('AI error: '+e.message,'error');render();});
      return;
    }
  }
  var promptEl=document.getElementById("ai-prompt-inp");
  if(promptEl&&promptEl.value)customInstructions=promptEl.value;

  // Handle manual email — no AI needed
  if(STATE.manualEmail&&!STATE.mergeLeadId){
    var subj=STATE.emailSubj.replace(/{{[\w]+}}/g,"");
    var body=STATE.emailBody.replace(/{{fn}}/g,"").replace(/{{[\w]+}}/g,"");
    STATE.genEmail={to:STATE.manualEmailName||STATE.manualEmail,email:STATE.manualEmail,subj:subj,body:body,lid:null};
    render();return;
  }
  if(!STATE.mergeLeadId){showToast("Select a recipient first","warning");return;}
  var ml=STATE.leads.find(function(l){return l.id==STATE.mergeLeadId;});
  if(!ml){showToast("Selected lead not found","error");return;}
  var co=STATE.companies.find(function(c){return c.id==ml.coid;})||{name:ml.coName,ind:ml.coInd,loc:ml.coLoc};

  // Show spinner — render() preserves scroll
  STATE.aiGenerating=true;render();

  // Helper: build a fallback genEmail from template (no AI)
  function fallbackToTemplate(){
    STATE.genEmail={to:ml.fn+" "+ml.ln,email:ml.email,subj:fillEmail(STATE.emailSubj,ml,co,STATE.user.name),body:fillEmail(STATE.emailBody,ml,co,STATE.user.name),lid:ml.id};
    STATE.aiGenerating=false;render();
  }

  // If running in LIVE (API layer present), call backend proxy. Otherwise fall back to local template fill.
  if(typeof apiPost==="function"){
    apiPost("/ai/generate-email",{
      lead:{first_name:ml.fn,last_name:ml.ln,position:ml.pos,designation:ml.desig,email:ml.email},
      company:{name:co.name,industry:co.ind,location:co.loc},
      template:{subject:STATE.emailSubj,body:STATE.emailBody},
      instructions:customInstructions
    }).then(function(data){
      var subj=data.subject||fillEmail(STATE.emailSubj,ml,co,STATE.user.name);
      var body=data.body||fillEmail(STATE.emailBody,ml,co,STATE.user.name);
      STATE.genEmail={to:ml.fn+" "+ml.ln,email:ml.email,subj:subj,body:body,lid:ml.id};
      STATE.aiGenerating=false;render();
      showToast("Email generated","success");
    }).catch(function(err){
      console.error("[generateAI] backend call failed:",err);
      showToast("AI generation failed — used template instead","warning");
      fallbackToTemplate();
    });
  } else {
    // Standalone offline mode — just use template fill
    fallbackToTemplate();
  }
};

function resolveComposeRecipient(){
  if(STATE.composeContactId){
    var parts=STATE.composeContactId.split('|');
    var cc=STATE.contacts.find(function(c){return c.id===parts[0];});
    var cj=STATE.jobs.find(function(j){return j.id===parts[1];});
    if(cc&&cc.email){
      return{
        to:((cc.first_name||'')+' '+(cc.last_name||'')).trim(),
        email:cc.email,
        lid:parts[1]||null,
        lead:{fn:cc.first_name||'',ln:cc.last_name||'',email:cc.email,desig:cc.designation||'',pos:(cj&&cj.position)||''},
        co:{name:(cj&&cj.company_name)||'',ind:(cj&&cj.industry)||'',loc:(cj&&cj.location)||''}
      };
    }
  }
  if(STATE.manualEmail&&STATE.manualEmail.includes('@')){
    return{to:STATE.manualEmail,email:STATE.manualEmail,lid:null,lead:null,co:null};
  }
  return null;
}
window.sendEmail=function(){
  var ge=STATE.genEmail;
  if(!ge){
    var recip=resolveComposeRecipient();
    if(!recip){showToast('Select a contact or enter an email address','warning');return;}
    var subjEl=document.getElementById('email-subj');
    var bodyEl=document.getElementById('email-body');
    var subj=(subjEl&&subjEl.value)||STATE.composeSubj||'';
    var body=(bodyEl&&bodyEl.value)||STATE.composeBody||'';
    if(!subj.trim()){showToast('Add a subject line','warning');return;}
    if(!body.trim()){showToast('Write a message','warning');return;}
    var fromEmForName=STATE.composeFromEmailId?(STATE.userEmailsCache[STATE.user.id]||[]).find(function(e){return e.id===STATE.composeFromEmailId;}):null;
    var senderName=(fromEmForName&&fromEmForName.display_name)||STATE.user.name||'';
    if(recip.lead){
      subj=fillEmail(subj,recip.lead,recip.co,senderName);
      body=fillEmail(body,recip.lead,recip.co,senderName);
    }
    ge={to:recip.to,email:recip.email,subj:subj,body:body,lid:recip.lid};
  }
  // Attach from email if selected
  var fromEmail=null;
  var fromEmailAddress=null;
  if(STATE.composeFromEmailId){
    var fromEm=(STATE.userEmailsCache[STATE.user.id]||[]).find(function(e){return e.id===STATE.composeFromEmailId;});
    if(fromEm){fromEmail=fromEm.email_address;fromEmailAddress=fromEm.email_address;}
  }
  var plt=STATE.user.plt||"Gmail";
  var gmailFrom=fromEmail||STATE.user.email||'';
  // Build body for sending — HTML with signature for Outlook, plain text for Gmail deeplink
  var sigEmailId=STATE.composeFromEmailId||STATE.sigEmailId;
  var sigHtml=normalizeMailboxSignature((sigEmailId&&STATE.emailSignaturesCache&&STATE.emailSignaturesCache[sigEmailId])||'');
  var fromEmForSig=sigEmailId?(STATE.userEmailsCache[STATE.user.id]||[]).find(function(e){return e.id===sigEmailId;}):null;
  var senderName=(fromEmForSig&&fromEmForSig.display_name)||STATE.user.name||'';
  var senderEmail=(fromEmForSig&&fromEmForSig.email_address)||fromEmailAddress||STATE.user.email||'';
  var plainBody=ge.body||'';
  var sigPlain=sigHtml?htmlSignatureToPlainText(sigHtml,senderName,senderEmail):'';
  var url;
  if(plt==="Gmail"){
    // Gmail deeplink only supports plain text body
    var gmailBody=sigPlain?plainBody+'\n\n-- \n'+sigPlain:plainBody;
    url="https://mail.google.com/mail/?view=cm&to="+encodeURIComponent(ge.email)+"&su="+encodeURIComponent(ge.subj)+"&body="+encodeURIComponent(gmailBody)+(gmailFrom?"&authuser="+encodeURIComponent(gmailFrom):'');
  } else {
    // Outlook deeplink — compose window accepts plain text only in the URL param
    var outlookBody=sigPlain?plainBody+'\n\n'+sigPlain:plainBody;
    url="https://outlook.live.com/mail/0/deeplink/compose?to="+encodeURIComponent(ge.email)+"&subject="+encodeURIComponent(ge.subj)+"&body="+encodeURIComponent(outlookBody);
  }
  window.open(url,"_blank");
  STATE.emails.push({id:"e"+Date.now(),lid:ge.lid,by:STATE.user.id,to:ge.email,from_email:fromEmail||null,subj:ge.subj,body:plainBody,plt:plt,dt:todayIST(),status:"sent"});
  showToast("Email opened in "+plt+(fromEmail?' from '+fromEmail:'')+(sigPlain?' · signature appended':''),"success");
}

window.copyToClip=function(text){
  if(navigator.clipboard){
    navigator.clipboard.writeText(text).then(function(){showToast("Copied: "+text,"success");}).catch(function(){fallbackCopy(text);});
  } else {fallbackCopy(text);}
};
function fallbackCopy(text){
  var el=document.createElement("textarea");
  el.value=text;el.style.position="fixed";el.style.opacity="0";
  document.body.appendChild(el);el.select();
  try{document.execCommand("copy");showToast("Copied: "+text,"success");}catch(e){showToast("Copy failed","error");}
  document.body.removeChild(el);
}

// Insert a merge variable at cursor position in any textarea by element ID
window.insertVarFromPicker=function(v,targetId){
  if(!v)return;
  var el=document.getElementById(targetId);
  if(!el){
    // fallback: insert into the body textarea for the compose tab
    var bodyEl=document.getElementById('email-body');
    if(bodyEl){
      var s=bodyEl.selectionStart!==undefined?bodyEl.selectionStart:bodyEl.value.length;
      var e2=bodyEl.selectionEnd!==undefined?bodyEl.selectionEnd:s;
      bodyEl.value=bodyEl.value.slice(0,s)+v+bodyEl.value.slice(e2);
      bodyEl.selectionStart=bodyEl.selectionEnd=s+v.length;
      STATE.emailBody=bodyEl.value;
    }
    return;
  }
  var start=el.selectionStart!==undefined?el.selectionStart:el.value.length;
  var end2=el.selectionEnd!==undefined?el.selectionEnd:start;
  el.value=el.value.slice(0,start)+v+el.value.slice(end2);
  el.selectionStart=el.selectionEnd=start+v.length;
  el.focus();
  if(el.id==='email-subj')STATE.composeSubj=el.value;
  else if(el.id==='email-body')STATE.composeBody=el.value;
};

// Legacy insertVar (kept for any remaining callers) — inserts into email-body textarea
window.insertVar=function(v){
  var el=document.getElementById('email-body')||document.getElementById('tmpl-o1-body')||document.getElementById('tmpl-fu1-body')||document.getElementById('tmpl-fu2-body');
  if(el){
    var s=el.selectionStart!==undefined?el.selectionStart:el.value.length;
    var e2=el.selectionEnd!==undefined?el.selectionEnd:s;
    el.value=el.value.slice(0,s)+v+el.value.slice(e2);
    el.selectionStart=el.selectionEnd=s+v.length;
    el.focus();
  }
};

// Signature helpers
var SIGNATURE_TAGLINE='Making Recruitment Easier with Future Tech';
var LEGACY_SIGNATURE_TAGLINES=['Staffing solutions for healthcare & enterprise','Staffing solutions for healthcare &amp; enterprise'];
function isLegacyBlockSignature(sigHtml){
  return /&#128231;|&#128222;|&#127760;|&#128205;/.test(sigHtml)||/border-right:3px solid #1E7A3C/.test(sigHtml);
}
function upgradeSignatureTagline(sigHtml){
  var html=String(sigHtml||'');
  LEGACY_SIGNATURE_TAGLINES.forEach(function(oldTagline){
    html=html.split(oldTagline).join(SIGNATURE_TAGLINE);
  });
  return html.replace(/Staffing solutions for healthcare(?:\s*(?:&amp;|&)\s*)?enterprise/gi,SIGNATURE_TAGLINE);
}
function syncMailboxSignatureIfNeeded(userId,emailId,raw,normalized){
  if(!userId||!emailId||!normalized||normalized===raw||STATE.sigMigrated&&STATE.sigMigrated[emailId])return;
  STATE.sigMigrated=STATE.sigMigrated||{};
  STATE.sigMigrated[emailId]=true;
  STATE.emailSignaturesCache=STATE.emailSignaturesCache||{};
  STATE.emailSignaturesCache[emailId]=normalized;
  apiPut('/users/'+userId+'/emails/'+emailId+'/signature',{signature_html:normalized}).catch(function(){});
}
function upgradeSignatureTitle(sigHtml){
  return String(sigHtml||'')
    .replace(/BD Manager at Fute Global LLC/gi,'Recruitment Manager at Fute Global LLC')
    .replace(/BD Manager \|/gi,'Recruitment Manager |');
}
function normalizeMailboxSignature(sigHtml){
  if(!sigHtml||!String(sigHtml).trim())return'';
  if(isLegacyBlockSignature(sigHtml))return(SIG_PRESETS&&SIG_PRESETS.professional)||sigHtml;
  return upgradeSignatureTitle(upgradeSignatureTagline(sigHtml));
}
function normalizeSenderTitle(text){
  return String(text||'')
    .replace(/BD Manager at Fute Global LLC/gi,'Recruitment Manager at Fute Global LLC')
    .replace(/BD Manager \|/gi,'Recruitment Manager |');
}
function fillSignatureHtml(sigHtml,senderName,senderEmail){
  return String(sigHtml||'')
    .replace(/{{sender}}/g,senderName||'')
    .replace(/{{senderemail}}/g,senderEmail||'');
}
function htmlSignatureToPlainText(sigHtml,senderName,senderEmail){
  if(!sigHtml||!String(sigHtml).trim())return'';
  var html=fillSignatureHtml(sigHtml,senderName,senderEmail);
  html=html.replace(/<a[^>]+href=["']mailto:([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,function(_,href,text){
    var label=(text||'').replace(/<[^>]+>/g,'').trim();
    return label||href;
  });
  html=html.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,function(_,href,text){
    var label=(text||'').replace(/<[^>]+>/g,'').trim();
    if(!label)return href.replace(/^https?:\/\//i,'');
    return label.replace(/^https?:\/\//i,'');
  });
  html=html.replace(/<img[^>]*>/gi,'');
  html=html.replace(/<br\s*\/?>/gi,'\n');
  html=html.replace(/<\/p>/gi,'\n');
  html=html.replace(/<\/tr>/gi,'\n');
  html=html.replace(/<\/td>/gi,' ');
  html=html.replace(/<\/div>/gi,'\n');
  html=html.replace(/<[^>]+>/g,'');
  var ta=document.createElement('textarea');
  ta.innerHTML=html;
  var text=ta.value;
  return text.replace(/[ \t]+\n/g,'\n').replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
var SIG_PRESETS={professional:'<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;line-height:1.45"><p style="margin:0 0 3px"><strong>{{sender}}</strong></p><p style="margin:0 0 3px;color:#333">Recruitment Manager | <strong>Fute Global LLC</strong></p><p style="margin:0 0 3px;color:#333"><a href="mailto:{{senderemail}}" style="color:#1E7A3C;text-decoration:none">{{senderemail}}</a> | +1 (972)-452-6644 | <a href="https://www.futeglobal.com/" style="color:#1E7A3C;text-decoration:none">www.futeglobal.com</a></p><p style="margin:0 0 3px;color:#555;font-size:12px">8111 Lyndon B. Johnson Freeway, Suite 1340, Dallas, TX 75251</p><p style="margin:0 0 12px;color:#555;font-size:12px;font-style:italic">Making Recruitment Easier with Future Tech</p><img src="data:image/png;base64,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" alt="Fute Global" style="height:40px;display:block"></div>',minimal:'<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;line-height:1.45"><p style="margin:0 0 3px"><strong>{{sender}}</strong></p><p style="margin:0 0 3px;color:#333">Recruitment Manager | <strong>Fute Global LLC</strong></p><p style="margin:0"><a href="mailto:{{senderemail}}" style="color:#1E7A3C;text-decoration:none">{{senderemail}}</a> | +1 (972)-452-6644 | <a href="https://www.futeglobal.com/" style="color:#1E7A3C;text-decoration:none">www.futeglobal.com</a></p><p style="margin:3px 0 0;color:#555;font-size:12px">8111 Lyndon B. Johnson Freeway, Suite 1340, Dallas, TX 75251</p></div>',withLogo:'<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;line-height:1.45"><p style="margin:0 0 3px"><strong>{{sender}}</strong></p><p style="margin:0 0 3px;color:#333">Recruitment Manager | <strong>Fute Global LLC</strong></p><p style="margin:0 0 3px;color:#333"><a href="mailto:{{senderemail}}" style="color:#1E7A3C;text-decoration:none">{{senderemail}}</a> | +1 (972)-452-6644 | <a href="https://www.futeglobal.com/" style="color:#1E7A3C;text-decoration:none">www.futeglobal.com</a></p><p style="margin:0 0 3px;color:#555;font-size:12px">8111 Lyndon B. Johnson Freeway, Suite 1340, Dallas, TX 75251</p><p style="margin:0 0 12px;color:#555;font-size:12px;font-style:italic">Making Recruitment Easier with Future Tech</p><img src="data:image/png;base64,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" alt="Fute Global" style="height:40px;display:block"></div>'};
window.applySigPreset=function(pk){
  var html=SIG_PRESETS[pk]||'';
  var el=document.getElementById('sig-html-input');
  if(el){el.value=html;updateSigPreview(html);}
};
function getSigPreviewIdentity(){
  var uid=STATE.user&&STATE.user.id;
  var emails=(uid&&STATE.userEmailsCache&&STATE.userEmailsCache[uid])||[];
  var sigEmail=emails.find(function(e){return e.id===STATE.sigEmailId;})||emails.find(function(e){return e.is_primary;})||emails[0];
  return {
    name:(sigEmail&&sigEmail.display_name)||'Your Name',
    email:(sigEmail&&sigEmail.email_address)||'you@fute-global.com'
  };
}
function updateSigPreview(html){
  var prev=document.getElementById('sig-live-preview');
  if(!prev)return;
  var id=getSigPreviewIdentity();
  var filled=html.replace(/{{sender}}/g,id.name).replace(/{{senderemail}}/g,id.email);
  prev.innerHTML=filled||'<em style="color:#94A3B8;font-size:12px">Preview will appear here</em>';
}
window.loadMailboxSignature=function(userId,emailId){
  if(!userId||!emailId)return;
  apiGet('/users/'+userId+'/emails/'+emailId+'/signature').then(function(d){
    var raw=d.signature_html||'';
    var normalized=normalizeMailboxSignature(raw);
    STATE.emailSignaturesCache=STATE.emailSignaturesCache||{};
    STATE.emailSignaturesCache[emailId]=normalized;
    if(normalized&&normalized!==raw){
      apiPut('/users/'+userId+'/emails/'+emailId+'/signature',{signature_html:normalized}).catch(function(){});
    }
    render();
  }).catch(function(){});
};
window.selectSigEmail=function(emailId){
  if(!emailId||!STATE.user)return;
  STATE.sigEmailId=emailId;
  STATE.planFromEmailId=emailId;
  if(STATE.emailSignaturesCache&&STATE.emailSignaturesCache[emailId]!==undefined){render();return;}
  loadMailboxSignature(STATE.user.id,emailId);
};
// Wire live preview on input (called via oninput on the textarea via a delegated approach)
document.addEventListener('input',function(e){
  if(e.target&&e.target.id==='sig-html-input'){updateSigPreview(e.target.value);}
});
window.saveSig=function(){
  var el=document.getElementById('sig-html-input');
  var html=(el&&el.value)||'';
  var emailId=STATE.sigEmailId;
  if(!emailId||!STATE.user){showToast('Select a sending email first','warning');return;}
  STATE.emailSignaturesCache=STATE.emailSignaturesCache||{};
  STATE.emailSignaturesCache[emailId]=html;
  STATE.sigEditing=false;
  apiPut('/users/'+STATE.user.id+'/emails/'+emailId+'/signature',{signature_html:html}).then(function(){
    showToast('Signature saved for this email ID','success');render();
  }).catch(function(e){showToast('Save failed: '+e.message,'error');});
};
window.clearSig=function(){
  var emailId=STATE.sigEmailId;
  if(!emailId||!STATE.user){showToast('Select a sending email first','warning');return;}
  STATE.emailSignaturesCache=STATE.emailSignaturesCache||{};
  STATE.emailSignaturesCache[emailId]='';
  STATE.sigEditing=false;
  apiPut('/users/'+STATE.user.id+'/emails/'+emailId+'/signature',{signature_html:''}).then(function(){
    showToast('Signature cleared — default will be used on send','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

// Build the HTML email body from plain-text template + signature for sending
function buildHtmlEmail(plainBody, sigHtml, senderName, senderEmail){
  // Convert plain-text line breaks to <br> and wrap paragraphs
  var htmlBody=plainBody
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');
  htmlBody='<p>'+htmlBody+'</p>';
  var sig='';
  if(sigHtml&&sigHtml.trim()){
    var filled=sigHtml
      .replace(/{{sender}}/g,htmlEsc(senderName||''))
      .replace(/{{senderemail}}/g,htmlEsc(senderEmail||''));
    sig='<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">'+filled;
  }
  return '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0F172A">'+htmlBody+sig+'</div>';
}

window.toggleBDAssign=function(role){
  var wrap=document.getElementById("u-bd-wrap");
  if(wrap)wrap.style.display=role==="ra"?"":"none";
};
window.openAddUser=function(){
  var managers=STATE.users.filter(function(x){return x.role==='bd'||x.role==='bd_lead'||x.role==='admin';});
  var roleOpts=['ra','ra_lead','bd','bd_lead','associate_director','director','admin','recruiter'].map(function(r){
    var labels={ra:'Research Analyst',ra_lead:'RA Team Lead',bd:'Manager',bd_lead:'BD Team Lead',associate_director:'Associate Director',director:'Director',admin:'Admin',recruiter:'Recruiter'};
    return '<option value="'+r+'">'+labels[r]+'</option>';
  }).join('');
  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Add new user</div><button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div class="g2 mb3">'+
        '<div class="fgrp"><label class="flbl">Full name <span style="color:var(--red)">*</span></label><input class="inp" id="u-name"/></div>'+
        '<div class="fgrp"><label class="flbl">Work email <span style="color:var(--red)">*</span></label><input class="inp" id="u-email" type="email"/></div>'+
      '</div>'+
      '<div class="g2 mb3">'+
        '<div class="fgrp"><label class="flbl">Employee ID</label><input class="inp" id="u-eid"/></div>'+
        '<div class="fgrp"><label class="flbl">Designation</label><input class="inp" id="u-desig"/></div>'+
      '</div>'+
      '<div class="g2 mb3">'+
        '<div class="fgrp"><label class="flbl">Role</label><select class="sel" id="u-role">'+roleOpts+'</select></div>'+
        '<div class="fgrp"><label class="flbl">Platform</label><select class="sel" id="u-plt"><option>Gmail</option><option>Outlook</option></select></div>'+
      '</div>'+
      '<div style="font-size:12px;color:var(--text3);padding:8px 10px;background:var(--bg);border-radius:var(--r);line-height:1.5">'+
        'They sign in with <strong>Continue with Microsoft</strong> or <strong>Google</strong> using this email address — no password is created or shared.'+
      '</div>'+
    '</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="saveUser(null)">Add user</button></div>'+
  '</div>';
  render();
};
window.editUser=function(id){var u=STATE.users.find(function(x){return x.id===id});if(u){STATE.modal=renderUserModal(u);render();}}
window.removeUser=function(id,fromDetail){
  if(id===STATE.user.id){showToast("Cannot remove yourself","warning");return;}
  if(!confirm("Deactivate this user? They will no longer be able to log in."))return;
  apiDelete('/users/'+id).then(function(){
    STATE.users=STATE.users.filter(function(u){return u.id!==id;});
    if(fromDetail){STATE.adminSelectedUser=null;}
    showToast("User deactivated","success");render();
  }).catch(function(e){showToast("Failed: "+e.message,"error");});
};
window.unassignRA=function(id){
  STATE.users=STATE.users.map(function(u){return u.id===id?Object.assign({},u,{bdm:null}):u;});
  showToast("RA unassigned","info");render();
}
window.saveUser=function(existingId){
  var name=(document.getElementById('u-name')||{}).value||'';
  var email=(document.getElementById('u-email')||{}).value||'';
  name=name.trim();email=email.trim();
  if(!name||!email){showToast('Name and email required','warning');return;}
  var role=(document.getElementById('u-role')||{}).value||'ra';
  var eid=(document.getElementById('u-eid')||{}).value||'';
  var desig=(document.getElementById('u-desig')||{}).value||'';
  var plt=(document.getElementById('u-plt')||{}).value||'Gmail';
  var payload={name:name,email:email,role:role,employee_id:eid||undefined,designation:desig||undefined,platform:plt};
  apiPost('/users',payload).then(function(u){
    STATE.users.push(normaliseUser(u));
    closeModal();
    showToast('User added — '+name,'success');
    render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
}

window.saveProfile=function(){
  var name=(document.getElementById("p-name")||{}).value||STATE.user.name;
  var email=(document.getElementById("p-email")||{}).value||STATE.user.email;
  var eid=(document.getElementById("p-eid")||{}).value||STATE.user.empId;
  var desig=(document.getElementById("p-desig")||{}).value||STATE.user.desig;
  STATE.users=STATE.users.map(function(u){return u.id===STATE.user.id?Object.assign({},u,{name:name,email:email,empId:eid,desig:desig}):u;});
  STATE.user=Object.assign({},STATE.user,{name:name,email:email,empId:eid,desig:desig});
  showToast("Profile updated","success");render();
}
window.setProfilePlt=function(p){
  STATE.user=Object.assign({},STATE.user,{plt:p});
  STATE.users=STATE.users.map(function(u){return u.id===STATE.user.id?Object.assign({},u,{plt:p}):u;});
  showToast("Platform set to "+p,"success");render();
}
window.changePassword=function(){
  var n=(document.getElementById("pw-new")||{}).value;
  var c=(document.getElementById("pw-con")||{}).value;
  if(!n||n.length<6){showToast("Password must be at least 6 characters","warning");return;}
  if(n!==c){showToast("Passwords don't match","warning");return;}
  showToast("Password updated","success");
}

window.setAdminView=function(v){STATE.adminView=v;render();}

window.submitUserDetailSave=function(existingId){
  var name=(document.getElementById('ud-name')||{}).value||'';
  var email=(document.getElementById('ud-email')||{}).value||'';
  var eid=(document.getElementById('ud-eid')||{}).value||'';
  var desig=(document.getElementById('ud-desig')||{}).value||'';
  var role=(document.getElementById('ud-role')||{}).value||'ra';
  var plt=(document.getElementById('ud-plt')||{}).value||'Gmail';
  if(!name||!email){showToast('Name and email required','warning');return;}
  apiPut('/users/'+existingId,{name:name,email:email,employee_id:eid,designation:desig,role:role,platform:plt}).then(function(updated){
    STATE.users=STATE.users.map(function(u){return u.id===existingId?normaliseUser(updated):u;});
    showToast('User updated','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.dismissReminder=function(rid){
  apiFetch('PATCH','/reminders/'+rid,{status:'sent'}).then(function(){
    STATE.reminders=(STATE.reminders||[]).map(function(r){return r.id===rid?Object.assign({},r,{status:'sent'}):r;});
    render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.viewAs=function(uid){
  var target=STATE.users.find(function(u){return u.id===uid});
  if(!target)return;
  STATE.viewingUser=target;
  STATE.page="dashboard";
  render();
}
window.stopViewing=function(){
  STATE.viewingUser=null;
  STATE.page="dashboard";
  render();
}

window.reminderSearchInput=function(v){
  STATE.reminderSearch=v;render();
  setTimeout(function(){var el=document.getElementById("rem-search-inp");if(el){el.focus();el.setSelectionRange(v.length,v.length);}},0);
}
window.openNewReminder=function(){STATE.modal=renderSetReminderModal(null,null);render();}
window.openSetReminderFromSearch=function(lid){STATE.reminderSearch=null;STATE.modal=renderSetReminderModal(lid,null);render();}
window.openSetReminderManual=function(email){STATE.reminderSearch=null;STATE.modal=renderSetReminderModal(null,email);render();}
window.openSetReminder=function(lid){STATE.modal=renderSetReminderModal(lid,null);render();}

window.saveReminder=function(lid,manualEmail){
  var lead=lid?STATE.leads.find(function(l){return l.id===lid}):null;
  var co=lead?STATE.companies.find(function(c){return c.id===lead.coid})||{}:{};
  var dt=(document.getElementById("rem-date")||{}).value;
  var tm=(document.getElementById("rem-time")||{}).value||"09:00";
  var note=(document.getElementById("rem-note")||{}).value||"";
  if(!dt){showToast("Please set a date","warning");return;}
  STATE.reminders.push({
    id:"r"+Date.now(),lid:lid||null,uid:STATE.user.id,
    name:lead?(lead.fn+" "+lead.ln):(manualEmail||""),
    company:lead?(co.name||""):"",
    email:lead?lead.email:(manualEmail||""),
    returnDate:dt,reminderTime:tm,note:note,status:"pending",createdAt:todayIST()
  });
  closeModal();STATE.reminderSearch=null;
  showToast("Reminder set for "+fmtDate(dt)+" at "+tm,"success");
  render();
}

window.editReminder=function(rid){
  var r=STATE.reminders.find(function(x){return x.id===rid});
  if(!r)return;
  STATE.modal=renderSetReminderModal(r.lid||null,r.lid?null:r.email);
  render();
}
window.dismissReminder=function(rid){
  STATE.reminders=STATE.reminders.filter(function(r){return r.id!==rid});
  showToast("Reminder removed","info");render();
}
window.sendReminderEmail=function(rid){
  var r=STATE.reminders.find(function(x){return x.id===rid});
  if(!r)return;
  var subj="Following up, hope you're back!";
  var body="Hi "+((r.contact_name||r.name||"").split(" ")[0]||"there")+",\n\nHope you had a great break! I wanted to follow up on my earlier message.\n\nWould you have 15 minutes for a quick call this week?\n\nWarm regards,\n"+STATE.user.name+"\nFute Global LLC";
  var plt=STATE.user.plt||"Gmail";
  window.open(plt==="Gmail"
    ?"https://mail.google.com/mail/?view=cm&to="+encodeURIComponent(r.email)+"&su="+encodeURIComponent(subj)+"&body="+encodeURIComponent(body)
    :"https://outlook.live.com/mail/0/deeplink/compose?to="+encodeURIComponent(r.email)+"&subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(body),"_blank");
  STATE.reminders=STATE.reminders.map(function(x){return x.id===rid?Object.assign({},x,{status:"sent"}):x;});
  showToast("Follow-up email opened","success");render();
}
window.sendAllDue=function(){
  var today=todayIST();
  var due=STATE.reminders.filter(function(r){return r.user_id===STATE.user.id&&r.status==="pending"&&r.return_date<=today});
  due.forEach(function(r){sendReminderEmail(r.id);});
}

