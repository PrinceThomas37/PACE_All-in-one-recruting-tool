// ════════════════════════════════════════════════
// EMAIL ACCOUNTS PAGE — Drop M
// ════════════════════════════════════════════════
function renderManagerUsers(){
  var u=STATE.user;
  // Admin-only (this legacy page is nav-unreachable today, but guard it anyway
  // in case STATE.page is set directly). Non-admins bounce to their dashboard.
  if(!userHasRole(u,'admin')){STATE.page='dashboard';return renderDashboard();}
  var tab=STATE.managerUsersTab||'bd';
  var allUsers=STATE.users||[];
  var assignments=STATE.teamAssignments||[];
  if(STATE.selectedManagerUser){return renderManagerUserDetail(STATE.selectedManagerUser);}
  var tabDefs=[{key:'bd',label:'BD Managers'},{key:'ra',label:'Research Analysts'},{key:'bdteam',label:'BD Team'},{key:'rateam',label:'RA Team'}];
  var tabBar=tabDefs.map(function(t){
    var isActive=tab===t.key;
    return '<button onclick="STATE.managerUsersTab=\''+t.key+'\';render()" style="padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:2px solid '+(isActive?'var(--accent)':'var(--border)')+';background:'+(isActive?'var(--accent)':'var(--card)')+';color:'+(isActive?'#fff':'var(--text2)')+';transition:all .15s">'+t.label+'</button>';
  }).join('');
  var body='';
  if(tab==='bd'){
    var bdUsers=allUsers.filter(function(x){return userHasRole(x,'bd')||userHasRole(x,'bd_lead');});
    var rows=bdUsers.map(function(usr){
      var emailCount=(STATE.userEmailsCache[usr.id]||[]).length;
      var teamCount=assignments.filter(function(a){return a.manager_id===usr.id;}).length;
      return '<div class="user-list-row" onclick="STATE.selectedManagerUser=\''+usr.id+'\';loadUserEmails(\''+usr.id+'\');render()" style="display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer">'+av(usr,'36')+'<div style="flex:1"><div style="font-weight:600;font-size:13.5px">'+htmlEsc(usr.name)+'</div><div style="font-size:11.5px;color:var(--text3)">'+htmlEsc(usr.email)+'</div></div><span style="font-size:11px;padding:2px 8px;background:var(--accent-l);color:var(--accent);border-radius:8px">'+emailCount+' email'+(emailCount!==1?'s':'')+'</span>'+(teamCount?'<span style="font-size:11px;padding:2px 8px;background:var(--green-l);color:var(--green);border-radius:8px">'+teamCount+' member'+(teamCount!==1?'s':'')+'</span>':'')+'<div style="color:var(--text3);font-size:18px">&#8250;</div></div>';
    }).join('');
    body='<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+(rows||'<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px">No BD Managers yet. Add users from the Admin tab.</div>')+'</div>';
  } else if(tab==='ra'){
    var raUsers=allUsers.filter(function(x){return userHasRole(x,'ra')&&!userHasAnyRole(x,'bd','bd_lead','admin');});
    var rows=raUsers.map(function(usr){
      var myManagers=assignments.filter(function(a){return a.member_id===usr.id&&a.assignment_type==='ra_to_bd';}).map(function(a){return a.manager&&a.manager.name||'';}).filter(Boolean);
      return '<div class="user-list-row" onclick="STATE.selectedManagerUser=\''+usr.id+'\';render()" style="display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer">'+av(usr,'36')+'<div style="flex:1"><div style="font-weight:600;font-size:13.5px">'+htmlEsc(usr.name)+'</div><div style="font-size:11.5px;color:var(--text3)">'+htmlEsc(usr.email)+'</div></div>'+(myManagers.length?'<span style="font-size:11px;padding:2px 8px;background:var(--accent-l);color:var(--accent);border-radius:8px">&#8594; '+htmlEsc(myManagers.join(', '))+'</span>':'<span style="font-size:11px;color:var(--text3)">Unassigned</span>')+'<div style="color:var(--text3);font-size:18px">&#8250;</div></div>';
    }).join('');
    body='<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+(rows||'<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px">No Research Analysts yet.</div>')+'</div>';
  } else if(tab==='bdteam'){
    var bdLeads=allUsers.filter(function(x){return userHasRole(x,'bd_lead');});
    body=bdLeads.length?bdLeads.map(function(lead){
      var members=assignments.filter(function(a){return a.manager_id===lead.id&&a.assignment_type==='bd_to_bdlead';});
      var memberRows=members.length?members.map(function(a){var m=a.member;if(!m)return'';return '<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border2)">'+av(m,'30')+'<div style="flex:1"><div style="font-size:13px;font-weight:500">'+htmlEsc(m.name)+'</div><div style="font-size:11px;color:var(--text3)">'+htmlEsc(m.email)+'</div></div><button onclick="removeAssignment(event,\''+a.id+'\')" style="font-size:11px;color:var(--red);background:transparent;border:0;cursor:pointer">Remove</button></div>';}).join(''):'<div style="padding:12px 16px;font-size:12px;color:var(--text3)">No BD Managers assigned yet.</div>';
      return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);margin-bottom:14px;overflow:hidden"><div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><div style="display:flex;align-items:center;gap:10px">'+av(lead,'32')+'<div style="font-weight:700;font-size:13.5px">'+htmlEsc(lead.name)+'</div></div><button onclick="openAssignToBDLead(\''+lead.id+'\')" style="font-size:12px;padding:5px 12px;background:var(--accent);color:#fff;border:0;border-radius:7px;cursor:pointer">+ Assign BD Manager</button></div>'+memberRows+'</div>';
    }).join(''):'<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px;background:var(--card);border:1px solid var(--border);border-radius:var(--r2)">No BD Team Leads yet.</div>';
  } else if(tab==='rateam'){
    var bdManagers=allUsers.filter(function(x){return userHasRole(x,'bd');});
    body=bdManagers.length?bdManagers.map(function(mgr){
      var members=assignments.filter(function(a){return a.manager_id===mgr.id&&a.assignment_type==='ra_to_bd';});
      var memberRows=members.length?members.map(function(a){var m=a.member;if(!m)return'';return '<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border2)">'+av(m,'30')+'<div style="flex:1"><div style="font-size:13px;font-weight:500">'+htmlEsc(m.name)+'</div><div style="font-size:11px;color:var(--text3)">'+htmlEsc(m.email)+'</div></div><button onclick="removeAssignment(event,\''+a.id+'\')" style="font-size:11px;color:var(--red);background:transparent;border:0;cursor:pointer">Remove</button></div>';}).join(''):'<div style="padding:12px 16px;font-size:12px;color:var(--text3)">No RAs assigned yet.</div>';
      return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);margin-bottom:14px;overflow:hidden"><div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><div style="display:flex;align-items:center;gap:10px">'+av(mgr,'32')+'<div style="font-weight:700;font-size:13.5px">'+htmlEsc(mgr.name)+'</div></div><button onclick="openAssignRAToManager(\''+mgr.id+'\')" style="font-size:12px;padding:5px 12px;background:var(--accent);color:#fff;border:0;border-radius:7px;cursor:pointer">+ Assign RA</button></div>'+memberRows+'</div>';
    }).join(''):'<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px;background:var(--card);border:1px solid var(--border);border-radius:var(--r2)">No BD Managers yet.</div>';
  }
  return '<div class="page"><div class="ph"><div class="flex jb aic"><div><div class="ptitle">Manager Users</div><div class="psub">'+allUsers.length+' users</div></div><div style="display:flex;gap:8px">'+(userHasRole(u,'admin')?'<button class="btn btn-sm" onclick="openPurgePending(\'all\')" style="background:transparent;color:var(--red);border:1px solid #fca5a5">Delete pending (all managers)…</button>':'')+'<button class="btn btn-primary btn-sm" onclick="STATE.page=\'admin\';STATE.adminSelectedUser=null;render()">'+ico('plus',13)+' Manage Users</button></div></div></div><div style="display:flex;gap:10px;margin-bottom:20px">'+tabBar+'</div>'+body+'</div>';
}

function renderManagerUserDetail(userId){
  var usr=STATE.users.find(function(x){return x.id===userId;});
  if(!usr)return'';
  var userEmails=STATE.userEmailsCache[userId]||[];
  var assignments=STATE.teamAssignments||[];
  var myManagers=assignments.filter(function(a){return a.member_id===userId;});
  var myMembers=assignments.filter(function(a){return a.manager_id===userId;});
  var rolesAll=['admin','ra_lead','bd_lead','associate_director','director','bd','ra'];
  var roleLabelsMap={admin:'Admin',ra_lead:'RA Team Lead',bd_lead:'BD Team Lead',associate_director:'Associate Director',director:'Director',bd:'BD Manager',ra:'Research Analyst'};
  var userRoles=usr.roles||[usr.role];
  var roleCheckboxes=rolesAll.map(function(r){
    var checked=userRoles.indexOf(r)>-1;
    return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:6px 0"><input type="checkbox" '+(checked?'checked':'')+' onchange="toggleUserRole(\''+userId+'\',\''+r+'\',this.checked)" style="width:15px;height:15px"/>'+roleLabelsMap[r]+'</label>';
  }).join('');
  var emailRows=userEmails.map(function(e){
    var msConnected=e.ms_connected;
    var conn=e.connection||{};
    // Sign-in health: green "Connected", red "Sign-in expired — reconnect" (with
    // the exact Microsoft error on hover), or nothing until a token exists.
    var connBadge=conn.status==='ok'?'<span style="font-size:10px;color:var(--green);font-weight:600">&#10003; Connected</span>'
      :conn.status==='expired'?'<span title="'+htmlEsc(conn.error||'The mailbox sign-in refresh is failing — reconnect this mailbox.')+'" style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:700;background:var(--red-l);color:var(--red)">&#9888; Sign-in expired</span>':'';
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap"><div style="flex:1;min-width:180px"><div style="font-weight:500;font-size:13px">'+htmlEsc(e.display_name||e.email_address)+'</div><div style="font-size:11px;color:var(--text3)">'+htmlEsc(e.email_address)+'</div></div><span style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:600;background:'+(e.platform==='Microsoft'?'#e0f2fe':'#f0fdf4')+';color:'+(e.platform==='Microsoft'?'#0369a1':'#166534')+'">'+e.platform+'</span>'+(e.is_primary?'<span style="font-size:10px;padding:2px 7px;background:var(--amber-l);color:var(--amber);border-radius:6px;font-weight:600">Primary</span>':'')+'<span style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:600;background:'+(e.is_active?'var(--green-l)':'var(--red-l)')+';color:'+(e.is_active?'var(--green)':'var(--red)')+'">'+( e.is_active?'Active':'Inactive')+'</span>'+(e.platform==='Microsoft'&&!msConnected?'<button onclick="connectMicrosoftUserEmail(\''+userId+'\',\''+e.id+'\')" style="font-size:10px;padding:2px 8px;background:#0078d4;color:#fff;border:0;border-radius:6px;cursor:pointer">Connect</button>':(e.platform==='Microsoft'&&msConnected?connBadge+' <button onclick="connectMicrosoftUserEmail(\''+userId+'\',\''+e.id+'\')" style="font-size:10px;padding:2px 8px;background:'+(conn.status==='expired'?'#0078d4':'transparent')+';color:'+(conn.status==='expired'?'#fff':'var(--text3)')+';border:'+(conn.status==='expired'?'0':'1px solid var(--border2)')+';border-radius:6px;cursor:pointer;font-weight:'+(conn.status==='expired'?'700':'400')+'">Reconnect</button>':connBadge))+'<button onclick="toggleUserEmailActive(\''+userId+'\',\''+e.id+'\','+(e.is_active?'false':'true')+')" style="font-size:11px;color:'+(e.is_active?'var(--red)':'var(--green)')+';background:transparent;border:0;cursor:pointer">'+(e.is_active?'Deactivate':'Activate')+'</button>'+(e.is_primary?'':'<button onclick="setPrimaryEmail(\''+userId+'\',\''+e.id+'\')" style="font-size:11px;color:var(--text3);background:transparent;border:0;cursor:pointer">Set Primary</button>')+'<button onclick="deleteUserEmail(\''+userId+'\',\''+e.id+'\')" style="font-size:11px;color:var(--red);background:transparent;border:0;cursor:pointer">&#10005;</button></div>';
  }).join('');
  var isBDMgr=userHasRole(usr,'bd')||userHasRole(usr,'bd_lead');
  var canPurge=userHasRole(STATE.user,'admin')&&isBDMgr;
  var pendingCard=canPurge?'<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:18px;margin-bottom:16px"><div style="font-weight:700;font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Pending emails</div><div style="font-size:12.5px;color:var(--text3);margin-bottom:12px">Delete this manager&#39;s unsent (pending) emails — filter by type (outreach / FU1 / FU2) and time. Sent emails are never affected.</div><button onclick="openPurgePending(\''+userId+'\')" style="font-size:13px;padding:8px 14px;background:transparent;color:var(--red);border:1px solid #fca5a5;border-radius:8px;font-weight:600;cursor:pointer">Delete pending emails…</button></div>':'';
  return '<div class="page"><div class="ph"><div class="flex aic gap3"><button onclick="STATE.selectedManagerUser=null;render()" style="background:transparent;border:0;color:var(--text3);font-size:22px;cursor:pointer">&#8592;</button>'+av(usr,'40')+'<div><div class="ptitle" style="margin:0">'+htmlEsc(usr.name)+'</div><div class="psub" style="margin:0">'+htmlEsc(usr.email)+'</div></div></div></div><div style="max-width:640px"><div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:18px;margin-bottom:16px"><div style="font-weight:700;font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Roles</div>'+roleCheckboxes+'</div><div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:16px"><div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700;font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Email IDs <span style="font-weight:400">('+userEmails.length+' · max 4 active)</span></div><div style="display:flex;gap:6px"><button onclick="openAddUserEmail(\''+userId+'\',\'Microsoft\')" style="font-size:12px;padding:5px 10px;background:#0078d4;color:#fff;border:0;border-radius:7px;cursor:pointer">+ Microsoft</button><button onclick="openAddUserEmail(\''+userId+'\',\'Gmail\')" style="font-size:12px;padding:5px 10px;background:#16a34a;color:#fff;border:0;border-radius:7px;cursor:pointer">+ Gmail</button></div></div>'+(emailRows||'<div style="padding:20px;text-align:center;font-size:13px;color:var(--text3)">No email IDs added yet.</div>')+'</div><div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:18px;margin-bottom:16px"><div style="font-weight:700;font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Team Assignment</div>'+(myManagers.length?'<div style="font-size:13px;margin-bottom:8px">Reports to: '+myManagers.map(function(a){return'<strong>'+(a.manager&&a.manager.name||'')+'</strong>';}).join(', ')+'</div>':'')+(myMembers.length?'<div style="font-size:13px">Members: '+myMembers.map(function(a){return(a.member&&a.member.name)||'';}).filter(Boolean).join(', ')+'</div>':'<div style="font-size:13px;color:var(--text3)">No team members assigned.</div>')+'</div>'+pendingCard+'</div></div>';
}

// ── Admin: delete a manager's pending (unsent) emails, by type + time ──────────
window.openPurgePending=function(managerId){
  var allMode=(!managerId||managerId==='all');
  var m=allMode?null:((STATE.users||[]).find(function(x){return x.id===managerId;})||{name:'this manager'});
  var scopeLabel=allMode?'<strong>ALL managers</strong>':'<strong>'+htmlEsc(m.name)+'</strong>';
  var scopeRow=allMode
    ? '<div style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding:8px 10px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;margin-bottom:12px;color:var(--red)"><input type="checkbox" id="pp-all" checked disabled style="width:15px;height:15px"/> Scope: <strong>ALL managers</strong> — every manager&#39;s pending queue</div>'
    : '<label style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;cursor:pointer"><input type="checkbox" id="pp-all" style="width:15px;height:15px"/> Delete for <strong style="margin:0 3px">ALL managers</strong> instead of just '+htmlEsc(m.name)+'</label>';
  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Delete pending emails</div>'+
      '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div style="font-size:12.5px;color:var(--text3);margin-bottom:12px">Permanently delete <strong>pending (unsent)</strong> emails from '+scopeLabel+'. Already-sent emails are never affected.</div>'+
      scopeRow+
      '<div style="font-weight:700;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Email types</div>'+
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:4px 0;cursor:pointer"><input type="checkbox" id="pp-outreach" checked style="width:15px;height:15px"/> Outreach (initial)</label>'+
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:4px 0;cursor:pointer"><input type="checkbox" id="pp-fu1" checked style="width:15px;height:15px"/> Follow-up 1</label>'+
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:4px 0;cursor:pointer"><input type="checkbox" id="pp-fu2" checked style="width:15px;height:15px"/> Follow-up 2</label>'+
      '<div style="font-weight:700;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 6px">Time filter (optional)</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">'+
        ['24h','3d','7d'].map(function(p){return '<button type="button" onclick="ppSetBefore(\''+p+'\')" style="font-size:12px;padding:5px 10px;border:1px solid var(--border2);border-radius:7px;background:var(--card);cursor:pointer">Older than '+p+'</button>';}).join('')+
        '<button type="button" onclick="ppSetBefore(\'\')" style="font-size:12px;padding:5px 10px;border:1px solid var(--border2);border-radius:7px;background:var(--card);cursor:pointer">All time</button>'+
      '</div>'+
      '<label style="font-size:12px;color:var(--text3)">Delete only emails created before:</label>'+
      '<input class="inp" type="datetime-local" id="pp-before" style="margin-top:4px"/>'+
      '<div id="pp-result" style="margin-top:14px;font-size:13px"></div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-outline" onclick="purgePendingPreview(\''+managerId+'\')">Preview count</button>'+
      '<button class="btn" id="pp-delete-btn" onclick="purgePendingExecute(\''+managerId+'\')" style="background:var(--red);color:#fff">Delete</button>'+
    '</div>'+
  '</div>';
  render();
};

window.ppSetBefore=function(preset){
  var el=document.getElementById('pp-before'); if(!el)return;
  if(!preset){el.value='';return;}
  var ms=preset==='24h'?86400000:preset==='3d'?3*86400000:7*86400000;
  var d=new Date(Date.now()-ms);
  var pad=function(n){return String(n).length<2?'0'+n:''+n;};
  el.value=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
};

function ppReadForm(){
  var types=[];
  if((document.getElementById('pp-outreach')||{}).checked)types.push('outreach');
  if((document.getElementById('pp-fu1')||{}).checked)types.push('fu1');
  if((document.getElementById('pp-fu2')||{}).checked)types.push('fu2');
  var beforeVal=(document.getElementById('pp-before')||{}).value||'';
  var before=beforeVal?new Date(beforeVal).toISOString():null; // datetime-local (local) → ISO/UTC
  var all=!!(document.getElementById('pp-all')||{}).checked;
  return {types:types,before:before,all:all};
}

window.purgePendingPreview=function(managerId){
  var f=ppReadForm();
  if(!f.types.length){showToast('Select at least one email type','warning');return;}
  var body={types:f.types,before:f.before,dry_run:true};
  if(f.all){body.all_managers=true;}else{body.manager_id=managerId;}
  var rd=document.getElementById('pp-result'); if(rd)rd.innerHTML='<span style="color:var(--text3)">Counting…</span>';
  apiPost('/admin/emails/purge-pending',body).then(function(r){
    var rd2=document.getElementById('pp-result');
    if(rd2)rd2.innerHTML='<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px"><strong>'+r.count+'</strong> pending email'+(r.count!==1?'s':'')+' match'+(f.all?' across ALL managers':'')+' — outreach: '+r.by_type.outreach+', FU1: '+r.by_type.fu1+', FU2: '+r.by_type.fu2+'</div>';
  }).catch(function(e){var rd2=document.getElementById('pp-result');if(rd2)rd2.innerHTML='<span style="color:var(--red)">'+htmlEsc(e.message||String(e))+'</span>';});
};

window.purgePendingExecute=function(managerId){
  var f=ppReadForm();
  if(!f.types.length){showToast('Select at least one email type','warning');return;}
  var scope=f.all?'ALL managers':(((STATE.users||[]).find(function(x){return x.id===managerId;})||{name:'this manager'}).name);
  if(!confirm('Permanently delete the matching pending emails from '+scope+'?\n\nThis cannot be undone. Preview the count first if you are unsure.'))return;
  var body={types:f.types,before:f.before,dry_run:false};
  if(f.all){body.all_managers=true;}else{body.manager_id=managerId;}
  var btn=document.getElementById('pp-delete-btn'); if(btn){btn.disabled=true;btn.textContent='Deleting…';}
  apiPost('/admin/emails/purge-pending',body).then(function(r){
    closeModal();
    showToast('Deleted '+r.deleted+' pending email'+(r.deleted!==1?'s':'')+(f.all?' (all managers)':''),'success');
    render();
  }).catch(function(e){
    var btn2=document.getElementById('pp-delete-btn'); if(btn2){btn2.disabled=false;btn2.textContent='Delete';}
    showToast('Failed: '+(e&&e.message||e),'error');
  });
};

window.openAddEmailAccount=function(managerId,fromDetail,platform){
  platform=platform||'Microsoft';
  var managerUser=managerId?STATE.users.find(function(u){return u.id===managerId;}):null;
  var isMicrosoft=platform==='Microsoft';
  var platformBadge=isMicrosoft?
    '<span style="font-size:11px;padding:2px 8px;background:#e0f2fe;color:#0369a1;border-radius:6px;font-weight:600;margin-left:8px">Microsoft / Outlook</span>':
    '<span style="font-size:11px;padding:2px 8px;background:#f0fdf4;color:#166534;border-radius:6px;font-weight:600;margin-left:8px">Gmail</span>';
  STATE.modal='<div class="modal modal-w480">'+'<div class="mh">'+'<div>'+'<div class="mt">Add Email Account'+platformBadge+'</div>'+(managerUser?'<div style="font-size:12px;color:var(--text3);margin-top:3px">Assign to '+htmlEsc(managerUser.name)+'</div>':'')+'</div>'+'<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button>'+'</div>'+'<div class="mb_">'+(isMicrosoft?'<div style="padding:12px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:var(--r2);margin-bottom:16px;font-size:13px;color:#0c4a6e">First enter the email address and display name, then click <strong>Save &amp; Connect Microsoft</strong> to authorise sending via Microsoft OAuth.</div>':'<div style="padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r2);margin-bottom:16px;font-size:13px;color:#14532d">Enter the Gmail address and display name, then connect it under this manager\'s Email IDs (Manager Users) to authorise sending via Google OAuth.</div>')+'<div class="fgrp"><label class="flbl">Email address <span style="color:var(--red)">*</span></label><input class="inp" id="ea-email" placeholder="e.g. john@futeglobal.com" autocomplete="off"/></div>'+'<div class="fgrp"><label class="flbl">Display name <span style="color:var(--red)">*</span></label><input class="inp" id="ea-name" placeholder="John Smith"/></div>'+'<div class="fgrp"><label class="flbl">Daily outreach limit</label><div style="display:flex;align-items:center;gap:10px"><input class="inp" type="number" id="ea-limit" value="300" min="1" max="500" style="width:120px"/><span style="font-size:12px;color:var(--text3)">emails per day</span></div></div>'+'</div>'+'<div class="mf">'+'<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+(isMicrosoft?'<button class="btn btn-primary" onclick="submitCreateEmailAndConnectMicrosoft(\''+managerId+'\')" style="background:#0078d4">Save &amp; Connect Microsoft</button>':'<button class="btn btn-primary" onclick="submitCreateAndAssignEmailAccount(\''+managerId+'\')" style="background:#16a34a">Save Gmail Account</button>')+'</div>'+'</div>';
  render();
};

window.selectEmailAccountToAssign=function(accountId, managerId){
  // Show limit picker before assigning
  var a=STATE.emailAccounts.find(function(x){return x.id===accountId;});
  if(!a)return;
  STATE.modal='<div class="modal modal-w400">'+
    '<div class="mh"><div class="mt">Assign '+htmlEsc(a.display_name)+'</div>'+
    '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div style="padding:12px 14px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:14px">'+
        '<div style="font-weight:600;font-size:13px">'+htmlEsc(a.display_name)+'</div>'+
        '<div style="font-size:12px;color:var(--text3)">'+htmlEsc(a.email_address)+'</div>'+
      '</div>'+
      '<div class="fgrp"><label class="flbl">Daily outreach limit</label>'+
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<input class="inp" type="number" id="ea-assign-limit" value="'+htmlEsc(String(a.daily_send_limit||300))+'" min="1" max="500" style="width:120px"/>'+
          '<span style="font-size:12px;color:var(--text3)">emails per day</span>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitAssignExistingEmailAccount(\''+accountId+'\',\''+managerId+'\')">Assign to Manager</button>'+
    '</div>'+
  '</div>';
  render();
};

window.submitAssignExistingEmailAccount=function(accountId, managerId){
  var limit=parseInt((document.getElementById('ea-assign-limit')||{}).value||'300');
  apiPut('/email-accounts/'+accountId,{assigned_to:managerId,daily_send_limit:limit}).then(function(a){
    STATE.emailAccounts=STATE.emailAccounts.map(function(x){return x.id===accountId?a:x;});
    closeModal();showToast('Email ID assigned','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.emailAccountTypeahead=function(val){
  var sugBox=document.getElementById('ea-suggestions');
  if(!sugBox)return;
  if(!val||val.length<2){sugBox.style.display='none';return;}
  var q=val.toLowerCase();
  var raUsers=(STATE.users||[]).filter(function(u){return u.role==='ra';});
  var matches=raUsers.filter(function(u){
    return (u.email||'').toLowerCase().indexOf(q)>-1||(u.name||'').toLowerCase().indexOf(q)>-1;
  }).slice(0,6);
  if(!matches.length){sugBox.style.display='none';return;}
  var html='';
  matches.forEach(function(u){
    html+='<div class="_ea-sug" data-email="'+htmlEsc(u.email)+'" data-name="'+htmlEsc(u.name)+'" style="padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">'+
      '<div style="flex:1">'+
        '<div style="font-size:13px;font-weight:500">'+htmlEsc(u.name)+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+htmlEsc(u.email)+'</div>'+
      '</div>'+
      '<span style="font-size:11px;padding:2px 6px;background:var(--green-l);color:var(--green);border-radius:6px">RA</span>'+
    '</div>';
  });
  sugBox.innerHTML=html;
  sugBox.style.display='block';
  // bind click and hover on each suggestion
  Array.prototype.forEach.call(sugBox.querySelectorAll('._ea-sug'),function(el){
    el.addEventListener('mouseenter',function(){this.style.background='var(--accent-l)';});
    el.addEventListener('mouseleave',function(){this.style.background='';});
    el.addEventListener('click',function(){
      pickEmailAccountSuggestion(this.getAttribute('data-email'),this.getAttribute('data-name'),300);
    });
  });
};

window.pickEmailAccountSuggestion=function(email,name,limit){
  var emailEl=document.getElementById('ea-email');
  var nameEl=document.getElementById('ea-name');
  var limitEl=document.getElementById('ea-limit');
  var sugBox=document.getElementById('ea-suggestions');
  if(emailEl)emailEl.value=email;
  if(nameEl)nameEl.value=name;
  if(limitEl)limitEl.value=limit||300;
  if(sugBox)sugBox.style.display='none';
};

window.submitCreateEmailAndConnectMicrosoft=function(managerId){
  var email=(document.getElementById('ea-email')||{}).value||'';
  var name=(document.getElementById('ea-name')||{}).value||'';
  var limit=parseInt((document.getElementById('ea-limit')||{}).value||'300');
  if(!email||!name){showToast('Email address and display name required','warning');return;}
  // Sanitise managerId — treat string "null" or empty as no assignment
  var assignTo=(managerId&&managerId!=='null'&&managerId!=='')?managerId:undefined;
  // First create the email account record
  apiPost('/email-accounts',{email_address:email,display_name:name,assigned_to:assignTo,daily_send_limit:limit,platform:'Microsoft'}).then(function(a){
    STATE.emailAccounts.push(a);
    closeModal();
    render();
    // Then open Microsoft OAuth popup
    var url=API_URL+'/auth/microsoft/connect?accountId='+a.id+'&token='+STATE.token;
    var popup=window.open(url,'ms_oauth','width=600,height=700,scrollbars=yes');
    showToast('Account created — complete Microsoft login in the popup','info');
    // Listen for popup callback
    window._msOAuthHandler=function(event){
      if(event.data&&event.data.type==='ms_oauth_success'){
        window.removeEventListener('message',window._msOAuthHandler);
        STATE.emailAccounts=STATE.emailAccounts.map(function(x){
          return x.id===event.data.accountId?Object.assign({},x,{platform:'Microsoft',ms_connected:true}):x;
        });
        showToast('Microsoft account connected: '+event.data.email,'success');
        render();
      } else if(event.data&&event.data.type==='ms_oauth_error'){
        window.removeEventListener('message',window._msOAuthHandler);
        showToast('Microsoft connection failed: '+event.data.error,'error');
      }
    };
    window.addEventListener('message',window._msOAuthHandler);
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.submitCreateAndAssignEmailAccount=function(managerId){
  var email=(document.getElementById('ea-email')||{}).value||'';
  var name=(document.getElementById('ea-name')||{}).value||'';
  var limit=parseInt((document.getElementById('ea-limit')||{}).value||'300');
  if(!email||!name){showToast('Email address and display name required','warning');return;}
  var assignTo=(managerId&&managerId!=='null'&&managerId!=='')?managerId:undefined;
  apiPost('/email-accounts',{email_address:email,display_name:name,assigned_to:assignTo,daily_send_limit:limit}).then(function(a){
    STATE.emailAccounts.push(a);
    closeModal();showToast('Email ID created and assigned','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};;

window.openEditEmailAccount=function(id){
  var a=STATE.emailAccounts.find(function(x){return x.id===id;});
  if(!a)return;
  var managers=STATE.users.filter(function(x){return x.role==='bd'||x.role==='bd_lead'||x.role==='admin';});
  var mOpts='<option value="">— Unassigned —</option>'+managers.map(function(m){
    return '<option value="'+m.id+'"'+(a.assigned_to===m.id?' selected':'')+'>'+htmlEsc(m.name)+'</option>';
  }).join('');
  STATE.modal='<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Edit Email ID</div><button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div class="fgrp"><label class="flbl">Email address</label><input class="inp" id="ea-email" value="'+htmlEsc(a.email_address)+'"/></div>'+
      '<div class="fgrp"><label class="flbl">Display name</label><input class="inp" id="ea-name" value="'+htmlEsc(a.display_name)+'"/></div>'+
      '<div class="fgrp"><label class="flbl">Assign to Manager</label><select class="sel" id="ea-manager">'+mOpts+'</select></div>'+
      '<div class="fgrp"><label class="flbl">Daily send limit</label><input class="inp" type="number" id="ea-limit" value="'+htmlEsc(String(a.daily_send_limit||300))+'" min="1" max="500"/></div>'+
    '</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitEditEmailAccount(\''+id+'\')">Save changes</button></div>'+
  '</div>';
  render();
};

;

window.submitEditEmailAccount=function(id){
  var email=(document.getElementById('ea-email')||{}).value||'';
  var name=(document.getElementById('ea-name')||{}).value||'';
  var manager=(document.getElementById('ea-manager')||{}).value||null;
  var limit=parseInt((document.getElementById('ea-limit')||{}).value||'300');
  apiPut('/email-accounts/'+id,{email_address:email,display_name:name,assigned_to:manager||null,daily_send_limit:limit}).then(function(a){
    STATE.emailAccounts=STATE.emailAccounts.map(function(x){return x.id===id?a:x;});
    closeModal();showToast('Email ID updated','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

window.toggleEmailAccount=function(id,active){
  apiPut('/email-accounts/'+id,{is_active:active}).then(function(a){
    STATE.emailAccounts=STATE.emailAccounts.map(function(x){return x.id===id?a:x;});
    showToast(active?'Email ID activated':'Email ID deactivated','success');render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

