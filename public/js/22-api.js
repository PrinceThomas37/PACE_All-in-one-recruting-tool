// ════════════════════════════════════════════════
// BOOT (standalone) — disabled, API layer below boots instead
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
// API LAYER — Drop B2 (Jobs wired to backend)
// ════════════════════════════════════════════════
var IS_FILE=window.location.protocol==='file:';
var API_URL=(function(){var h=window.location.hostname;if(h===''||h==='localhost'||h.indexOf('127.')===0)return'https://fute-lms-backend.onrender.com';return'';})();
// An expired sign-in (R-118). The server answers 401 with one of these three sentences when the session token is
// missing, expired or from before multi-tenancy; ANY other 401 (a wrong password, "Current password incorrect") is
// a different thing and must reach the screen that asked, so the match is on the sentence, not on the status alone,
// and only when we actually HAD a session to lose (the login call itself has none).
var SESSION_EXPIRED_MSG='Your session expired — please sign in again.';
function isExpiredAnswer(status,msg){return status===401&&/^(Invalid token|No token|Your session is out of date)/i.test(String(msg||''));}
// Moves on every deliberate end of a session (sign out, a new sign-in) — see apiFetch.
var _sessGen=0;
window.endSessionCalls=function(){_sessGen++;_jobsTag=null;};   // R-302: a new session never reuses the last one's "not changed" tag
var NOT_JSON_MSG='PACE did not answer properly — the server may be waking up (it sleeps when nobody has used it for a while). Please try again in a few seconds.';
function apiFetch(method,path,body,retried,opts){opts=opts||{};var headers={'Content-Type':'application/json'};if(STATE.token)headers['Authorization']='Bearer '+STATE.token;if(opts.ifTag)headers['If-None-Match']=opts.ifTag;var hadSession=!!STATE.token,sentGen=_sessGen;var init={method:method,headers:headers,body:body?JSON.stringify(body):undefined};if(opts.ifTag||opts.onTag)init.cache='no-store';return fetch(API_URL+path,init).then(function(r){
  // AN ANSWER FOR A SESSION THAT WAS ENDED ON PURPOSE IS NEVER DELIVERED. Somebody signed out, or signed in as a different person
  // (`_sessGen` moves on both), while this call was in flight: its .then() would repaint the login screen over what the next
  // person is typing, write the LAST person's data into the new session, and a late 401 would sign the NEW person out. The call
  // simply never answers. A session that merely RAN OUT is not this: every call that failed with it still gets the plain sentence.
  if(sentGen!==_sessGen)return new Promise(function(){});
  // R-302: "not changed since your last load" — only ever for a call that sent its tag (apiGetJobsList); there is no body to read.
  if(r.status===304&&opts.ifTag)return {__notModified:true};
  if(opts.onTag&&r.ok)opts.onTag(r.headers.get('ETag'));
  // AN ANSWER THAT IS NOT JSON IS NOT A BROKEN SCREEN (20 Oct, owner: opening a "Needs you today" card showed the browser's own
  // "Failed to execute 'json' on 'Response': Unexpected end of JSON input"). The free server sleeps when idle; a request that
  // lands while it wakes, restarts or drops the connection comes back EMPTY (or as a gateway page). A read (GET) is safe to ask
  // again, so it is asked once more after a short wait; if the answer is still not JSON the person is told, in words, what
  // happened and what to do — never the parser's sentence.
  return r.text().then(function(raw){
    var d,parsed=false;
    if(raw){try{d=JSON.parse(raw);parsed=true;}catch(_){}}
    if(!parsed){
      if(method==='GET'&&!retried){
        return new Promise(function(res){setTimeout(res,3000);}).then(function(){
          if(sentGen!==_sessGen)return new Promise(function(){});     // the session ended while we waited: same rule as above
          return apiFetch(method,path,body,true,opts);
        });
      }
      var u=new Error(NOT_JSON_MSG);u.status=r.status;u.unreachable=true;throw u;
    }
    if(!r.ok){if(hadSession&&isExpiredAnswer(r.status,d&&d.error)&&window.sessionExpired){window.sessionExpired();var x=new Error(SESSION_EXPIRED_MSG);x.status=401;x.expired=true;x.body=d;throw x;}var e=new Error((d&&d.error)||('HTTP '+r.status));e.status=r.status;e.body=d;throw e;}
    return d;
  });
});}
function apiGet(p){return apiFetch('GET',p);}
// THE LEAD LIST, ASKED "HAS ANYTHING CHANGED?" (R-302). The server tags each answer (services/list-tag.js); the tag is sent back
// only while STATE.jobs is still exactly the list that tag came with, for the same person — so a sign-out, another person, or any
// code that replaced the list always gets the full answer. Resolves null when nothing changed (keep what is on screen, no redraw),
// else {data, keep} — call keep() once STATE.jobs holds the new list.
var _jobsTag=null;
function apiGetJobsList(){
  var me=STATE.user&&STATE.user.id;
  var send=(_jobsTag&&me&&_jobsTag.user===me&&_jobsTag.jobs===STATE.jobs&&STATE.jobs&&STATE.jobs.length)?_jobsTag.tag:null;
  var got=null;
  return apiFetch('GET','/jobs',undefined,false,{ifTag:send,onTag:function(t){got=t;}}).then(function(res){
    if(res&&res.__notModified)return null;
    return {data:res,keep:function(){_jobsTag=got?{tag:got,user:me,jobs:STATE.jobs}:null;}};
  });
}
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
    research:(function(){var r=listResearch(j);return Object.keys(r).length?r:null;})(),
    posting:j.posting||null,
    auto_replied_at:j.auto_replied_at||null,
    created_date:j.created_date,created_at:j.created_at};
}
// THE LEAD LIST CARRIES NO POSTING TEXT (R-301): the server sends `research.jd_raw_omitted` and a `posting` summary instead of the
// pasted job description. The text is loaded for ONE lead when a screen needs it (loadLeadPosting) and kept here, so the
// 3-minute list refresh does not take it away again. A copy whose length no longer matches the server's summary is dropped
// (someone else changed the posting) and loads fresh next time.
function jobPostings(){return STATE.jobPostings||(STATE.jobPostings={});}
function postingBodyLen(text){return String(text||'').trim().replace(/^Title:[^\n]*\n*/i,'').trim().length;}
function listResearch(j){
  var r=parseResearchObject(j.research);
  if(!r.jd_raw_omitted)return r;
  var kept=jobPostings()[j.id];
  if(kept===undefined)return r;
  if(j.posting&&postingBodyLen(kept)!==j.posting.chars){delete jobPostings()[j.id];return r;}
  var out=Object.assign({},r,{jd_raw:kept});delete out.jd_raw_omitted;return out;
}
window.leadPostingLoaded=function(j){var r=j&&parseResearchObject(j.research);return !(r&&r.jd_raw_omitted);};
window.leadPostingKeep=function(id,text){jobPostings()[id]=String(text||'');};
window.loadLeadPosting=function(id){
  var j=(STATE.jobs||[]).find(function(x){return x.id===id;});
  if(j&&leadPostingLoaded(j))return Promise.resolve(j);
  return apiGet('/jobs/'+encodeURIComponent(id)).then(function(full){
    var text=parseResearchObject(full&&full.research).jd_raw||'';
    jobPostings()[id]=text;
    var cur=(STATE.jobs||[]).find(function(x){return x.id===id;});
    if(cur){var r=Object.assign({},parseResearchObject(cur.research),{jd_raw:text});delete r.jd_raw_omitted;cur.research=r;}
    return cur;
  });
};
function flattenContacts(jobs){var out=[];jobs.forEach(function(j){(j.contacts||[]).forEach(function(c){out.push({id:c.id,job_id:c.job_id,first_name:c.first_name,last_name:c.last_name||'',designation:c.designation||'',email:c.email||'',phone:c.phone||'',extra_emails:Array.isArray(c.extra_emails)?c.extra_emails:[],extra_phones:Array.isArray(c.extra_phones)?c.extra_phones:[],linkedin:c.linkedin||'',is_primary:!!c.is_primary,email_status:c.email_status||'valid',ooo_until:c.ooo_until||null});});});return out;}

function loadAppData(opts){
  opts=opts||{};
  STATE.loadFailed=null;
  STATE.loading=true;render();
  _jobsTag=null;   // a full load: never answered "not changed"
  var calls=[apiGet('/users'),apiGetJobsList(),apiGet('/companies'),apiGet('/reminders'),apiGet('/industries')];
  var u=STATE.user;
  var isBD=(u&&(u.role==='bd'||u.role==='bd_lead'||u.role==='admin'||u.role==='ra_lead'));
  if(isBD)calls.push(apiGet('/emails?status=pending'));
  if(isBD)calls.push(apiGet('/emails?status=queued'));
  return Promise.all(calls).then(function(r){
    STATE.users=r[0].map(normaliseUser);
    var jl=r[1]||{data:[],keep:function(){}};
    STATE.jobs=(jl.data||[]).map(normaliseJob);
    STATE.contacts=flattenContacts(jl.data||[]);
    jl.keep();
    STATE.companies=r[2].map(function(c){return{id:c.id,name:c.name,web:c.website,ind:c.industry,loc:c.location};});
    STATE.reminders=r[3]||[];
    STATE.industriesList=r[4]||[];
    STATE.emailAccounts=[];
    // Load pool stats for ra_lead/admin
    if(STATE.user&&(STATE.user.role==='ra_lead'||STATE.user.role==='admin')){
      apiGet('/distribute/pool-stats').then(function(d){STATE.distributePoolStats=d;scheduleRender();}).catch(function(){});
    }
    if(isBD){
      STATE.pendingEmails=(r[5]||[]);
      STATE.emails=(r[6]||[]);
      // R-302: every SENT email was downloaded here (4,421 with bodies) and no screen read it — the Sent tab became All mail
      // (50-all-mail.js, its own 90-day view). Not asked for any more.
    }
    // Load app settings (global send times)
    apiGet('/app-settings').then(function(s){
      STATE.appSettings=s||{};
      render();
    }).catch(function(){});
    // Load current user's own email IDs for compose From selector — asked ONCE; the outreach-plan block below reuses the same answer
    // (it used to ask a second time, R-298).
    var myMailboxes=STATE.user?apiGet('/users/'+STATE.user.id+'/emails'):null;
    if(myMailboxes){
      myMailboxes.then(function(emails){
        STATE.userEmailsCache=STATE.userEmailsCache||{};
        STATE.userEmailsCache[STATE.user.id]=emails||[];
        render();
        // PACE puts the person's first tasks on their own list (a mailbox, a sequence) — once per sign-in, and it closes what is done.
        if(window.mySetupSync&&!STATE._setupSynced){ STATE._setupSynced=true; mySetupSync(); }
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
        // R-176: what each of my email IDs says of its own (only used when I chose "a wording for each email ID").
        apiGet('/outreach-plan/mailboxes').then(function(r){ STATE.mailboxWording=(r&&r.mailboxes)||{}; render(); }).catch(function(){});
        if(plan['compose_style_preset'])STATE.outreachStylePreset=plan['compose_style_preset'];
        render();
      }).catch(function(){});
      if(myMailboxes) myMailboxes.then(function(emails){
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
      // Pre-load every colleague's email IDs (lead distribution, the users screen) in ONE request. It used to fetch /users again and
      // then ask /users/:id/emails once per person, all in the same second — ten requests queueing the whole app behind them (R-298).
      apiGet('/users-emails').then(function(byUser){
        STATE.userEmailsCache=STATE.userEmailsCache||{};
        Object.keys(byUser||{}).forEach(function(id){ STATE.userEmailsCache[id]=byUser[id]||[]; });
        scheduleRender();
      }).catch(function(){});
    }
    STATE.loading=false;STATE.loadNote=null;render();
    // Somebody whose sign-in ran out comes back to the place they were in (R-118, 23-auth.js).
    if(window.resumeWhereLeftOff)resumeWhereLeftOff();
    // Auto-start progress poll for BD/BD_Lead so bar appears without any button click
    if(STATE.user&&userHasAnyRole(STATE.user,'bd','bd_lead','admin')){startProgressPoll();}
    // Start background polling to keep UI in sync (every 30s)
    startBackgroundPoll();
  }).catch(function(err){
    // A FIRST LOAD THAT FAILS NEVER THROWS AWAY A GOOD SIGN-IN (R-323, 26 Oct: Ash pressed Log In and landed back on the login
    // page; another browser worked). The password was right — what failed was one of the calls above, on a server busy enough
    // that the lead list took 30 seconds. This used to sign the person out and say why in a toast that vanished, so it looked
    // like the password had been refused. Now: a sign-in that really ran out goes through sessionExpired as before; anything
    // else keeps the session, tries once more on its own, and then says plainly what happened with Try again / Sign out.
    if(err&&err.expired)return;
    if(!STATE.token)return;
    if(!opts.retried){
      STATE.loadNote='PACE is busy — trying again…';render();
      return new Promise(function(res){setTimeout(res,LOAD_RETRY_MS);}).then(function(){
        if(!STATE.token)return;   // signed out while we waited
        return loadAppData({retried:true});
      });
    }
    STATE.loading=false;STATE.loadNote=null;
    STATE.loadFailed='Your sign-in worked, but PACE could not load your data'+(err&&err.message?' ('+err.message+')':'')+'. This is usually the server being busy — press Try again in a moment.';
    render();
  });
}
var LOAD_RETRY_MS=4000;
window.loadAppDataRetry=function(){STATE.loadFailed=null;loadAppData();};
function applyJobsList(jl){
  if(!jl)return false;   // R-302: nothing changed — what is on screen stays, and nothing is redrawn
  var raw=jl.data||[],p=STATE._pendingStageChanges||{};
  STATE.jobs=raw.map(normaliseJob).map(function(j){if(p[j.id])j.stage=p[j.id];return j;});
  STATE.contacts=flattenContacts(raw);
  jl.keep();
  scheduleRender();
  return true;
}
function refreshJobs(){return apiGetJobsList().then(applyJobsList);}

// ── Background polling — keeps UI in sync ──────
var _bgPollTimer=null;
function startBackgroundPoll(){
  if(_bgPollTimer)return;
  _bgPollTimer=setInterval(backgroundPollTick,180000); // 3 min — this poll ships the full jobs list, so cadence is the main egress lever
}
function backgroundPollTick(){
    if(!STATE.user||!STATE.token)return;
    if(document.hidden)return; // no point refreshing a tab nobody is looking at
    var pg=STATE.page;
    // Always refresh jobs (stage changes, new leads, assignments)
    apiGetJobsList().then(applyJobsList).catch(function(){});
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
}
// Coming BACK to a tab that sat hidden (R-118): the poll above never runs for a hidden tab, so what is on screen
// can be hours old. If the sign-in has run out meanwhile, say so now (and keep the place) instead of letting the
// first click fail; otherwise, after a real absence, refresh what the poll refreshes. Never on a quick tab switch.
var _hiddenAt=0, AWAY_REFRESH_MS=5*60*1000;
function tokenExpired(tok){
  try{var p=JSON.parse(atob(String(tok).split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return !!(p&&p.exp&&p.exp*1000<=Date.now());}
  catch(e){return false;}   // not a token we can read — the server decides, as before
}
document.addEventListener('visibilitychange',function(){
  if(document.hidden){_hiddenAt=Date.now();return;}
  if(!STATE.user||!STATE.token)return;
  if(tokenExpired(STATE.token)){if(window.sessionExpired)sessionExpired();return;}
  if(_hiddenAt&&Date.now()-_hiddenAt>=AWAY_REFRESH_MS)backgroundPollTick();
  _hiddenAt=0;
});
function stopBackgroundPoll(){
  if(_bgPollTimer){clearInterval(_bgPollTimer);_bgPollTimer=null;}
}

