// ════════════════════════════════════════════════
// BOOT (standalone) — disabled, API layer below boots instead
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
// API LAYER — Drop B2 (Jobs wired to backend)
// ════════════════════════════════════════════════
var IS_FILE=window.location.protocol==='file:';
var API_URL=(function(){var h=window.location.hostname;if(h===''||h==='localhost'||h.indexOf('127.')===0)return'https://fute-lms-backend.onrender.com';if(h.indexOf('onrender.com')>=0)return'';return'https://fute-lms-backend.onrender.com';})();
function apiFetch(method,path,body){var headers={'Content-Type':'application/json'};if(STATE.token)headers['Authorization']='Bearer '+STATE.token;return fetch(API_URL+path,{method:method,headers:headers,body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d;});});}
function apiGet(p){return apiFetch('GET',p);}
function apiPost(p,b){return apiFetch('POST',p,b);}
function apiPut(p,b){return apiFetch('PUT',p,b);}
function apiPatch(p,b){return apiFetch('PATCH',p,b);}
function apiDelete(p){return apiFetch('DELETE',p);}

// ── Restore session if present ─────────────────
STATE.token=sessionStorage.getItem('fg_token')||null;
try{var _su=sessionStorage.getItem('fg_user');if(_su){var _parsed=JSON.parse(_su);STATE.user=normaliseUser(_parsed);}}catch(e){}
// Restore outreach template mode from localStorage
try{
  if(STATE.user&&STATE.user.id){
    var _tmpl=localStorage.getItem('fute_outreach_tmpl_mode_'+STATE.user.id)||localStorage.getItem('fute_tmpl_mode_'+STATE.user.id);
    if(_tmpl){var _tm=JSON.parse(_tmpl);if(typeof _tm.random==='boolean')STATE.randomTemplateMode=_tm.random;}
  }
}catch(e){}
// Wipe demo seed data — will be replaced by API on login
STATE.jobs=[];STATE.contacts=[];STATE.users=[];STATE.companies=[];STATE.emails=[];STATE.reminders=[];STATE.activities=[];STATE.leads=[];

function normaliseUser(u){
  var nm=u.name||'';
  var parts=nm.trim().split(/\s+/);
  var initials=((parts[0]||'')[0]||'')+((parts[1]||'')[0]||'');
  var roles=u.roles||(u.role?[u.role]:[]);
  var primaryRole=roles[0]||u.role||'ra';
  var roleAvc={admin:'av-admin',bd:'av-bd',ra:'av-ra',ra_lead:'av-admin',bd_lead:'av-bd'};
  return{id:u.id,name:nm,email:u.email,role:primaryRole,roles:roles,empId:u.employee_id,desig:u.designation,plt:u.platform||'Gmail',ooo:u.ooo_until||null,av:initials.toUpperCase()||'?',avc:roleAvc[primaryRole]||'av-ra',bdm:null,managerId:u.manager_id||null,managerName:(u.manager&&u.manager.name)||''};
}
function userHasRole(u,role){
  if(!u)return false;
  if(Array.isArray(u.roles)&&u.roles.length)return u.roles.indexOf(role)>-1;
  return u.role===role;
}
function userHasAnyRole(u){
  var roles=Array.prototype.slice.call(arguments,1);
  return roles.some(function(r){return userHasRole(u,r);});
}
function normaliseJob(j){
  var co=j.company||{};
  var bd=j.bd_assignee||{};
  var sa=j.sending_account||{};
  return{id:j.id,company_id:j.company_id,company_name:co.name||'',company_ind:co.industry||'',company_web:co.website||'',
    position:j.position,location:j.location||'',source:j.source||'',job_url:j.job_url||'',
    stage:j.stage||'Unassigned',notes:j.notes||'',created_by:j.created_by,assigned_to:j.assigned_to,
    assigned_to_bd:j.assigned_to_bd||null,assigned_bd_name:bd.name||'',assigned_at:j.assigned_at||null,
    is_duplicate:!!j.is_duplicate,duplicate_of:j.duplicate_of||null,
    salary_range:j.salary_range||'',job_created_date:j.job_created_date||'',job_opened_date:j.job_opened_date||'',
    timezone:j.timezone||'',freshness:j.freshness||'',industry:j.industry||'',
    bdm_assigned_name:j.bdm_assigned_name||'',
    sending_email_id:j.sending_email_id||null,sending_email:sa.email_address||'',sending_display:sa.display_name||'',
    research:(function(){var r=parseResearchObject(j.research);return Object.keys(r).length?r:null;})(),
    created_date:j.created_date,created_at:j.created_at};
}
function flattenContacts(jobs){var out=[];jobs.forEach(function(j){(j.contacts||[]).forEach(function(c){out.push({id:c.id,job_id:c.job_id,first_name:c.first_name,last_name:c.last_name||'',designation:c.designation||'',email:c.email||'',phone:c.phone||'',linkedin:c.linkedin||'',is_primary:!!c.is_primary,email_status:c.email_status||'valid',ooo_until:c.ooo_until||null});});});return out;}

function loadAppData(){
  STATE.loading=true;render();
  var calls=[apiGet('/users'),apiGet('/jobs'),apiGet('/companies'),apiGet('/reminders'),apiGet('/industries')];
  var u=STATE.user;
  var isBD=(u&&(u.role==='bd'||u.role==='bd_lead'||u.role==='admin'||u.role==='ra_lead'));
  if(isBD)calls.push(apiGet('/emails?status=pending'));
  if(isBD)calls.push(apiGet('/emails?status=queued'));
  return Promise.all(calls).then(function(r){
    STATE.users=r[0].map(normaliseUser);
    STATE.jobs=r[1].map(normaliseJob);
    STATE.contacts=flattenContacts(r[1]);
    STATE.companies=r[2].map(function(c){return{id:c.id,name:c.name,web:c.website,ind:c.industry,loc:c.location};});
    STATE.reminders=r[3]||[];
    STATE.industriesList=r[4]||[];
    STATE.emailAccounts=[];
    // Load pool stats for ra_lead/admin
    if(STATE.user&&(STATE.user.role==='ra_lead'||STATE.user.role==='admin')){
      apiGet('/distribute/pool-stats').then(function(d){STATE.distributePoolStats=d;scheduleRender();}).catch(function(){});
    }
    // Load today's summary for BD
    if(STATE.user&&(STATE.user.role==='bd'||STATE.user.role==='bd_lead')){
      apiGet('/distribute/today-summary').then(function(d){STATE.todaySummary=d;scheduleRender();}).catch(function(){});
    }
    if(isBD){
      STATE.pendingEmails=(r[5]||[]);
      STATE.emails=(r[6]||[]);
      apiGet('/emails?status=sent').then(function(d){STATE.sentEmails=d||[];render();}).catch(function(){STATE.sentEmails=[];});
    }
    // Load app settings (global send times)
    apiGet('/app-settings').then(function(s){
      STATE.appSettings=s||{};
      render();
    }).catch(function(){});
    // Load current user's own email IDs for compose From selector
    if(STATE.user){
      apiGet('/users/'+STATE.user.id+'/emails').then(function(emails){
        STATE.userEmailsCache=STATE.userEmailsCache||{};
        STATE.userEmailsCache[STATE.user.id]=emails||[];
        render();
      }).catch(function(){});
    }
    // Load this user's personal outreach plan
    if(STATE.user&&userHasAnyRole(STATE.user,'bd','bd_lead','admin')){
      apiGet('/outreach-plan').then(function(plan){
        STATE.myOutreachPlan=plan||{};
        STATE.emailSubj=plan['tmpl_o1_subject']||STATE.emailSubj;
        STATE.emailBody=plan['tmpl_o1_body']||STATE.emailBody;
        STATE.fu1Subj=plan['tmpl_fu1_subject']||STATE.fu1Subj;
        STATE.fu1Body=plan['tmpl_fu1_body']||STATE.fu1Body;
        STATE.fu2Subj=plan['tmpl_fu2_subject']||STATE.fu2Subj;
        STATE.fu2Body=plan['tmpl_fu2_body']||STATE.fu2Body;
        // restore template mode preference
        if(plan['random_template_mode'])STATE.randomTemplateMode=plan['random_template_mode']==='true';
        if(plan['compose_style_preset'])STATE.outreachStylePreset=plan['compose_style_preset'];
        render();
      }).catch(function(){});
      apiGet('/users/'+STATE.user.id+'/emails').then(function(emails){
        STATE.userEmailsCache=STATE.userEmailsCache||{};
        STATE.userEmailsCache[STATE.user.id]=emails||[];
        var primary=(emails||[]).find(function(e){return e.is_primary;})||(emails||[])[0];
        if(primary){
          if(!STATE.sigEmailId)STATE.sigEmailId=primary.id;
          if(!STATE.planFromEmailId)STATE.planFromEmailId=primary.id;
          loadMailboxSignature(STATE.user.id,STATE.sigEmailId||primary.id);
        }
      }).catch(function(){});
    }
    // Load team assignments for admin/bd_lead
    if(STATE.user&&userHasAnyRole(STATE.user,'admin','bd_lead','ra_lead')){
      apiGet('/team-assignments').then(function(d){STATE.teamAssignments=d||[];render();}).catch(function(){});
      // Pre-load email IDs for all users
      apiGet('/users').then(function(users){
        (users||[]).forEach(function(u){
          apiGet('/users/'+u.id+'/emails').then(function(emails){
            STATE.userEmailsCache=STATE.userEmailsCache||{};
            STATE.userEmailsCache[u.id]=emails||[];
          }).catch(function(){});
        });
      }).catch(function(){});
    }
    STATE.loading=false;render();
    // Auto-start progress poll for BD/BD_Lead so bar appears without any button click
    if(STATE.user&&userHasAnyRole(STATE.user,'bd','bd_lead','admin')){startProgressPoll();}
    // Start background polling to keep UI in sync (every 30s)
    startBackgroundPoll();
  }).catch(function(err){
    STATE.loading=false;STATE.user=null;STATE.token=null;
    sessionStorage.removeItem('fg_token');sessionStorage.removeItem('fg_user');
    showToast('Could not connect: '+err.message,'error');render();
  });
}
function refreshJobs(){return apiGet('/jobs').then(function(raw){var p=STATE._pendingStageChanges||{};STATE.jobs=raw.map(normaliseJob).map(function(j){if(p[j.id])j.stage=p[j.id];return j;});STATE.contacts=flattenContacts(raw);scheduleRender();});}

// ── Background polling — keeps UI in sync ──────
var _bgPollTimer=null;
function startBackgroundPoll(){
  if(_bgPollTimer)return;
  _bgPollTimer=setInterval(function(){
    if(!STATE.user||!STATE.token)return;
    if(document.hidden)return; // no point refreshing a tab nobody is looking at
    var pg=STATE.page;
    // Always refresh jobs (stage changes, new leads, assignments)
    apiGet('/jobs').then(function(raw){
      var p=STATE._pendingStageChanges||{};
      STATE.jobs=raw.map(normaliseJob).map(function(j){if(p[j.id])j.stage=p[j.id];return j;});
      STATE.contacts=flattenContacts(raw);
      scheduleRender();
    }).catch(function(){});
    // Always refresh users — STATE.users otherwise only loads once at login, so a
    // name/role change made by someone else (or in another tab) never showed up
    // anywhere that reads from it (avatars, assignee labels, pickers) until a
    // full page reload.
    apiGet('/users').then(function(raw){
      STATE.users=(raw||[]).map(normaliseUser);
      if(STATE.user){
        var me=STATE.users.find(function(u){return u.id===STATE.user.id;});
        if(me){STATE.user.name=me.name;STATE.user.email=me.email;STATE.user.role=me.role;STATE.user.roles=me.roles;}
      }
      scheduleRender();
    }).catch(function(){});
    // Refresh emails when on email page
    if(pg==='email'){loadEmailsForCurrentUser();}
    // Refresh pool stats when on assign page
    if(pg==='assign'&&STATE.user&&userHasAnyRole(STATE.user,'ra_lead','admin')){
      apiGet('/distribute/pool-stats').then(function(d){STATE.distributePoolStats=d;scheduleRender();}).catch(function(){});
    }
    // Refresh reminders when on reminders or dashboard page
    if(pg==='reminders'||pg==='dashboard'){
      apiGet('/reminders').then(function(d){STATE.reminders=d||[];scheduleRender();}).catch(function(){});
    }
  },180000); // 3 min — this poll ships the full jobs list, so cadence is the main egress lever
}
function stopBackgroundPoll(){
  if(_bgPollTimer){clearInterval(_bgPollTimer);_bgPollTimer=null;}
}

