// ════════════════════════════════════════════════
// ASSIGN LEADS — RA Team Lead bulk assign UI (Drop E)
// ════════════════════════════════════════════════
function renderAssignLeads(){
  var u=STATE.user;
  if(STATE.pausedManagers===undefined){loadSendingStatus();}
  // Use API pool stats if loaded, otherwise count from STATE.jobs directly
  var poolStats=STATE.distributePoolStats||{total:0,by_industry:{},by_timezone:{},duplicates:0};
  if(!STATE.distributePoolStats){
    // Fallback: count unassigned from STATE.jobs while API loads
    var _unassigned=STATE.jobs.filter(function(j){return j.stage==='Unassigned'&&!j.assigned_to_bd;});
    poolStats={total:_unassigned.length,by_industry:{},by_timezone:{},duplicates:_unassigned.filter(function(j){return j.is_duplicate;}).length};
  }
  var managers=STATE.users.filter(function(x){return x.role==='bd'||x.role==='bd_lead';});

  // Show manager cards
  var pausedMgrs=STATE.pausedManagers||[];
  var managerCards=managers.map(function(m){
    var emailAccounts=(STATE.userEmailsCache[m.id]||[]).filter(function(a){return a.is_active;});
    var capacity=emailAccounts.reduce(function(s,a){return s+(a.daily_send_limit||300);},0);
    var hasCapacity=emailAccounts.length>0;
    var mPaused=pausedMgrs.indexOf(m.id)>-1;
    var assignBtn=(hasCapacity&&poolStats.total>0?
        '<button onclick="openAssignToManager(\''+m.id+'\')" style="background:var(--accent);color:#fff;border:0;padding:10px 20px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap">Assign leads</button>':
        '<span class="fs-12 c-text3" style="padding:8px 12px">'+(!hasCapacity?'No email IDs':'No leads')+'</span>');
    var pauseCtl=mPaused
      ?'<button onclick="toggleManagerSending(\''+m.id+'\',false)" style="background:var(--green);color:#fff;border:0;padding:8px 14px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;white-space:nowrap">Resume emailing</button>'
      :'<button onclick="toggleManagerSending(\''+m.id+'\',true)" style="background:transparent;color:#dc2626;border:1px solid #fca5a5;padding:8px 14px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;white-space:nowrap">\u23f8 Stop emailing</button>';
    return '<div style="background:'+(mPaused?'#fef2f2':'var(--card)')+';border:1px solid '+(mPaused?'#fca5a5':'var(--border)')+';border-radius:var(--r2);padding:16px;display:flex;align-items:center;gap:14px;margin-bottom:12px">'+
      av(m,'40')+
      '<div style="flex:1;min-width:0">'+
        '<div class="fs-14" style="font-weight:600">'+htmlEsc(m.name)+(mPaused?' <span class="fs-11" style="padding:2px 8px;background:#fee2e2;color:#b91c1c;border-radius:6px;font-weight:700;vertical-align:middle">Emailing paused</span>':'')+'</div>'+
        '<div class="fs-12 c-text3" style="margin-top:3px">'+
          emailAccounts.length+' email ID'+(emailAccounts.length!==1?'s':'')+
          ' \u00b7 '+capacity+' emails/day capacity'+
        '</div>'+
        (emailAccounts.length?
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'+
            emailAccounts.map(function(a){
              return '<span class="fs-11 c-accent" style="padding:2px 8px;background:var(--accent-l);border-radius:6px">'+htmlEsc(a.display_name)+'</span>';
            }).join('')+
          '</div>':
          '<div class="fs-12 c-red" style="margin-top:4px">No email IDs assigned</div>')+
      '</div>'+
      '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">'+assignBtn+pauseCtl+'</div>'+
    '</div>';
  }).join('');

  // Pool summary bar
  var poolBar='';
  if(poolStats.total>0){
    var bf=poolStats.by_freshness||{};
    var bi=poolStats.by_industry||{};
    var btz=poolStats.by_timezone||{};
    poolBar='<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px 16px;margin-bottom:18px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
        '<div class="fs-13" style="font-weight:600">Unassigned lead pool</div>'+
        '<div class="fs-22 c-accent" style="font-weight:700">'+poolStats.total+'</div>'+
      '</div>'+
      '<div class="fs-12" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">'+
        '<div>'+
          '<div class="fs-11 c-text3" style="text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Freshness</div>'+
          Object.keys(bf).map(function(k){
            var col=k==='Old'?'var(--red)':k==='New'?'var(--green)':'var(--accent)';
            return '<div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:'+col+';font-weight:500">'+k+'</span><span>'+bf[k]+'</span></div>';
          }).join('')+
        '</div>'+
        '<div>'+
          '<div class="fs-11 c-text3" style="text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Industry</div>'+
          Object.keys(bi).slice(0,5).map(function(k){
            return '<div style="display:flex;justify-content:space-between;padding:2px 0"><span>'+htmlEsc(k)+'</span><span>'+bi[k]+'</span></div>';
          }).join('')+
        '</div>'+
        '<div>'+
          '<div class="fs-11 c-text3" style="text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Timezone</div>'+
          Object.keys(btz).map(function(k){
            return '<div style="display:flex;justify-content:space-between;padding:2px 0"><span>'+htmlEsc(k)+'</span><span>'+btz[k]+'</span></div>';
          }).join('')+
        '</div>'+
      '</div>'+
      (poolStats.duplicates?'<div class="fs-12 c-amber" style="margin-top:8px">\u26a0 '+poolStats.duplicates+' duplicate leads in pool</div>':'')+
    '</div>';
  } else {
    poolBar='<div class="fs-13 c-green" style="background:var(--green-l);border:1px solid var(--green);border-radius:var(--r2);padding:14px 16px;margin-bottom:18px;font-weight:600">\u2713 No unassigned leads — pool is clear for today.</div>';
  }

  return '<div class="page">'+
    '<div class="ph"><div class="flex jb aic">'+
      '<div><div class="ptitle">Assign Leads</div>'+
        '<div class="psub">'+poolStats.total+' unassigned leads in pool \u00b7 '+managers.length+' managers</div></div>'+
      '<button onclick="refreshPoolStats()" class="c-text2 fs-12" style="background:transparent;border:1px solid var(--border);padding:7px 13px;border-radius:8px;cursor:pointer">\u21bb Refresh pool</button>'+
    '</div></div>'+
    poolBar+
    '<div class="fs-13 c-text2" style="font-weight:600;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Managers</div>'+
    managerCards+
  '</div>';
}

window.toggleAssignSel=function(id,v){
  if(!STATE.assignSel)STATE.assignSel={};
  STATE.assignSel[id]=v;render();
};
window.toggleAllAssign=function(v){
  if(!STATE.assignSel)STATE.assignSel={};
  var f=STATE.assignFilter||{ra:'',dup:'all'};
  STATE.jobs.filter(function(j){
    if(j.stage!=='Unassigned')return false;
    if(f.ra&&j.created_by!==f.ra)return false;
    if(f.dup==='dup'&&!j.is_duplicate)return false;
    if(f.dup==='clean'&&j.is_duplicate)return false;
    return true;
  }).forEach(function(j){STATE.assignSel[j.id]=v;});
  render();
};
window.setAssignFilter=function(k,v){
  if(!STATE.assignFilter)STATE.assignFilter={ra:'',dup:'all'};
  STATE.assignFilter[k]=v;
  STATE.assignSel={};render();
};
window.openAssignConfirm=function(){
  var sel=STATE.assignSel||{};
  var selIds=Object.keys(sel).filter(function(k){return sel[k];});
  var bdId=STATE.assignTargetBD;
  if(!selIds.length||!bdId){showToast('Select leads and a BD first','warning');return;}
  var bd=STATE.users.find(function(u){return u.id===bdId;})||{name:'Unknown'};
  var now=new Date();
  var dateStr=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  var timeStr=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Confirm Assignment</div></div>'+
    '<div class="mb_">'+
      '<div style="padding:16px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:12px">'+
        '<div class="fs-22 c-accent" style="font-weight:700;margin-bottom:4px">'+selIds.length+' leads</div>'+
        '<div class="fs-14 c-text2">\u2192 <strong>'+htmlEsc(bd.name)+'</strong></div>'+
        '<div class="fs-12 c-text3" style="margin-top:6px">'+dateStr+' \u00b7 '+timeStr+'</div>'+
      '</div>'+
      '<div class="fs-13 c-text2">Once confirmed, these leads will be marked <strong>Assigned</strong> and the email engine will begin sending outreach emails over the next 2\u20133 minutes.</div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitBulkAssign()">Confirm & Assign</button>'+
    '</div>'+
  '</div>';
  render();
};
window.submitBulkAssign=function(){
  var sel=STATE.assignSel||{};
  var selIds=Object.keys(sel).filter(function(k){return sel[k];});
  var bdId=STATE.assignTargetBD;
  if(!selIds.length||!bdId)return;
  closeModal();
  apiPost('/jobs/bulk-assign',{job_ids:selIds,assigned_to_bd:bdId}).then(function(res){
    showToast(res.assigned+' leads assigned to '+res.bd_name,'success');
    STATE.assignSel={};STATE.assignTargetBD='';
    // Generate AI emails in background
    return apiPost('/emails/generate',{job_ids:selIds}).then(function(genRes){
      showToast('Generating '+genRes.generated+' emails for '+res.bd_name+'...','info');
      return refreshJobs();
    });
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

