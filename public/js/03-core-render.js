// ════════════════════════════════════════════════
// RENDER ENGINE
// ════════════════════════════════════════════════
var toastTimer={};
// Patch only the toast container instead of rebuilding the whole page —
// a full render() here would wipe unsaved inputs in any open modal.
function updateToastsDOM(){
  var html=renderToasts();
  var w=document.querySelector('.toast-wrap');
  if(w){w.outerHTML=html;}
  else if(html){
    var app=document.getElementById('app');
    if(app){var d=document.createElement('div');d.innerHTML=html;if(d.firstChild)app.appendChild(d.firstChild);}
  }
}
function showToast(msg,type){
  type=type||"info";
  var id=Date.now();
  STATE.toasts.push({id:id,msg:msg,type:type});
  toastTimer[id]=setTimeout(function(){
    STATE.toasts=STATE.toasts.filter(function(t){return t.id!==id});
    updateToastsDOM();
  },3000);
  updateToastsDOM();
}

var clockTimer=null;
function startClock(){
  if(clockTimer)clearInterval(clockTimer);
  clockTimer=setInterval(function(){
    var n=new Date();
    var dt=document.getElementById("dash-clock-time");
    var dd=document.getElementById("dash-clock-date");
    if(dt)dt.textContent=n.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true});
    if(dd)dd.textContent=n.toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"});
  },1000);
}

function render(){
  var root=document.getElementById("app");
  if(!root)return;
  if(!STATE.user){root.innerHTML=renderLogin();bindLogin();return;}
  if(STATE.loading){
    root.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:14px;background:var(--bg)">'+
      '<div style="width:36px;height:36px;border:3px solid var(--border2);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite"></div>'+
      '<div style="font-size:13.5px;color:var(--text3)">Loading your data...</div>'+
      '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>'+
    '</div>';
    return;
  }
  // Save focus/cursor state so we can restore it after DOM rebuild
  var _ae=document.activeElement;
  var _focusId=_ae&&_ae.id||'';
  var _focusPh=_ae&&_ae.placeholder||'';
  var _focusTag=_ae&&_ae.tagName||'';
  var _selStart=_ae&&typeof _ae.selectionStart==='number'?_ae.selectionStart:-1;
  var _selEnd=_ae&&typeof _ae.selectionEnd==='number'?_ae.selectionEnd:-1;
  // Save all scroll positions before re-render
  var content=document.getElementById("content");
  var scrollTop=content?content.scrollTop:0;
  var pageEl=content?content.querySelector(".page"):null;
  var pageScroll=pageEl?pageEl.scrollTop:0;
  var winScroll=window.scrollY||0;
  // Signal to blur handlers that this blur is from a DOM rebuild, not user action
  STATE._rendering=true;
  root.innerHTML=renderApp();
  STATE._rendering=false;
  bindApp();
  startClock();
  // Restore scroll positions after re-render
  var newContent=document.getElementById("content");
  if(newContent){
    if(scrollTop)newContent.scrollTop=scrollTop;
    var newPage=newContent.querySelector(".page");
    if(newPage&&pageScroll)newPage.scrollTop=pageScroll;
  }
  if(winScroll)window.scrollTo(0,winScroll);
  // Restore focus and cursor position so typing isn't interrupted by DOM rebuild
  var _restored=null;
  if(_focusId)_restored=document.getElementById(_focusId);
  if(!_restored&&_focusPh&&_focusTag){
    var _els=document.querySelectorAll(_focusTag.toLowerCase()+'[placeholder]');
    for(var _i=0;_i<_els.length;_i++){if(_els[_i].placeholder===_focusPh){_restored=_els[_i];break;}}
  }
  if(_restored&&document.body.contains(_restored)){
    _restored.focus();
    if(_selStart>=0&&_restored.setSelectionRange){try{_restored.setSelectionRange(_selStart,_selEnd);}catch(e){}}
  }
}

// Debounced render — collapses multiple rapid async render() calls into one.
// Use scheduleRender() in background/API callbacks; use render() for direct user interactions.
var _scheduleRenderTimer=null;
function scheduleRender(){
  if(_scheduleRenderTimer)return;
  _scheduleRenderTimer=setTimeout(function(){
    _scheduleRenderTimer=null;
    // Skip background DOM rebuild whenever a modal or detail panel is open.
    // A full render replaces root.innerHTML which destroys all open forms and
    // wipes any unsaved input — even if the user has just switched windows and
    // the input has temporarily lost focus.
    var modalOpen=!!(STATE.modal||(document.getElementById('modal-overlay')&&document.getElementById('modal-overlay').style.display!=='none'));
    if(modalOpen||STATE.detailLead)return;
    render();
  },16);
}

// ════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════
function av(user,size){
  var nm=user.name||'';var parts=nm.trim().split(/\s+/);
  var initials=user.av||(((parts[0]||'')[0]||'')+((parts[1]||'')[0]||'')).toUpperCase()||'?';
  var roleMap={admin:'av-admin',bd:'av-bd',ra:'av-ra',ra_lead:'av-admin',bd_lead:'av-bd'};
  var cls=user.avc||(roleMap[user.role]||'av-ra');
  return '<div class="av av-'+size+' '+cls+'">'+initials+'</div>';
}
function avById(id,size){
  var u=STATE.users.find(function(x){return x.id===id});
  return u?av(u,size):'<div class="av av-'+size+' av-ra">?</div>';
}
function icon(name){
  var icons={
    dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
    leads:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    email:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    admin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    profile:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    dl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    send:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    google:'<svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>',
    star:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    reports:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  };
  return icons[name]||'<svg viewBox="0 0 24 24"></svg>';
}
function ico(name,size){
  size=size||15;
  return '<span style="width:'+size+'px;height:'+size+'px;display:inline-flex;flex-shrink:0">'+icon(name)+'</span>';
}

function getMyLeads(user){
  return STATE.leads.filter(function(l){
    if(l.del)return false;
    if(user.role==="ra")return l.aid===user.id;
    if(user.role==="bd")return l.bid===user.id;
    return true;
  });
}
// A user's team = their direct reports on the flexible reporting hierarchy
// (users.manager_id, migration 026). This is the single source of truth for
// "team" across the app — the old role-based `bdm` branches keyed off a field
// that only ever existed in seed/demo data (normaliseUser() hardcodes bdm:null
// for real users), so in production every non-recruiter silently fell through
// to "show the whole org". Direct reports only here (the glanceable dashboard
// card); the full transitive subtree lives on the My Team page.
function getTeam(user){
  if(!user)return[];
  return STATE.users.filter(function(u){return u.id!==user.id&&u.managerId===user.id;});
}
// Direct reports of a user id (one level down the manager_id tree).
function directReportsOf(userId){
  return (STATE.users||[]).filter(function(u){return u.managerId===userId;});
}
// Full subtree under a user id (every direct + transitive report, excluding the
// root). Cycle-guarded. This is the client mirror of reportingChainIds() on the
// backend — the single client-side definition of "everyone under me".
function reportingSubtree(userId){
  var out=[];var seen={};seen[userId]=true;var queue=[userId];
  while(queue.length){
    var pid=queue.shift();
    directReportsOf(pid).forEach(function(u){
      if(seen[u.id])return;seen[u.id]=true;out.push(u);queue.push(u.id);
    });
  }
  return out;
}
// Recursive org-chart node. Renders a user and, nested + indented, their reports.
// opts.click: 'viewas' → click a node to view that user's dashboard (admin/BD);
//             'admin'  → click to open the admin user-detail page;
//             null/other → not clickable.
// opts.rootId is the top of the tree (kept out of cycle re-entry). Depth caps at
// 6 to guard against any accidental loop in the data.
function renderOrgSubtree(userId,opts,depth,seen){
  opts=opts||{};depth=depth||0;seen=seen||{};
  var user=(STATE.users||[]).find(function(x){return x.id===userId;});
  if(!user||seen[userId]||depth>6)return'';
  seen[userId]=true;
  var reports=directReportsOf(userId).slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  var subCount=reportingSubtree(userId).length;
  var click='',cursor='default',hover='';
  if(opts.click==='viewas'){click=' onclick="event.stopPropagation();viewAs(\''+userId+'\')"';cursor='pointer';}
  else if(opts.click==='admin'){click=' onclick="event.stopPropagation();STATE.adminSelectedUser=\''+userId+'\';loadUserEmails(\''+userId+'\');render()"';cursor='pointer';}
  else if(opts.click==='activity'){click=' onclick="event.stopPropagation();openTeamActivity(\''+userId+'\')"';cursor='pointer';}
  if(cursor==='pointer')hover=' onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'transparent\'"';
  var meDot=(STATE.user&&STATE.user.id===userId)?'<span style="font-size:9px;font-weight:700;color:var(--accent);background:var(--accent-l);padding:1px 6px;border-radius:6px;margin-left:6px">YOU</span>':'';
  var subChip=reports.length?'<span style="font-size:10.5px;color:var(--green);background:var(--green-l);padding:2px 7px;border-radius:8px;white-space:nowrap">'+subCount+' in team</span>':'';
  var node='<div'+click+hover+' style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:9px;cursor:'+cursor+';transition:background .1s">'+
      av(user,'32')+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+htmlEsc(user.name||'')+meDot+'</div>'+
        '<div style="font-size:11.5px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+htmlEsc(roleLabel(user.role))+(user.empId?' · '+htmlEsc(user.empId):'')+'</div>'+
      '</div>'+
      subChip+
      (opts.click&&opts.click!=='none'?'<span style="color:var(--text3);font-size:14px">›</span>':'')+
    '</div>';
  if(opts.flat)return '<div>'+node+'</div>';
  var childHtml=reports.map(function(r){return renderOrgSubtree(r.id,opts,depth+1,seen);}).join('');
  var childWrap=reports.length?'<div style="margin-left:19px;padding-left:12px;border-left:2px solid var(--border)">'+childHtml+'</div>':'';
  return '<div>'+node+childWrap+'</div>';
}

// Per-user recruiting stats from the cached report (for org-chart hover cards).
function orgStatFor(id){
  var d=STATE.reports&&STATE.reports.data; if(!d||!d.by_user)return null;
  for(var i=0;i<d.by_user.length;i++)if(d.by_user[i].user_id===id)return d.by_user[i];
  return null;
}
// Horizontal org chart: each node sits above a row of its reports, with a
// connector. Hovering a node reveals a stats card; clicking opens that person's
// activity feed. Same depth cap + cycle guard as renderOrgSubtree.
function renderOrgNodeH(userId,depth,seen){
  seen=seen||{};
  var user=(STATE.users||[]).find(function(x){return x.id===userId;});
  if(!user||seen[userId]||depth>6)return'';
  seen[userId]=true;
  var reports=directReportsOf(userId).slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  var me=(STATE.user&&STATE.user.id===userId);
  var st=orgStatFor(userId);
  var statLine=st?
    '<div style="display:flex;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">'+
      '<div style="text-align:center"><div style="font-weight:700;font-size:14px">'+st.total+'</div><div style="font-size:9.5px;color:var(--text3)">subs</div></div>'+
      '<div style="text-align:center"><div style="font-weight:700;font-size:14px;color:#2563eb">'+st.interviews+'</div><div style="font-size:9.5px;color:var(--text3)">intv</div></div>'+
      '<div style="text-align:center"><div style="font-weight:700;font-size:14px;color:var(--green)">'+st.placements+'</div><div style="font-size:9.5px;color:var(--text3)">placed</div></div>'+
    '</div>'
    :'<div style="margin-top:6px;font-size:10.5px;color:var(--text3)">No recruiting activity</div>';
  var popup='<div class="ochover" style="display:none;position:absolute;top:100%;left:50%;transform:translateX(-50%);z-index:60;margin-top:6px;width:200px;background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15);padding:12px;text-align:left">'+
    '<div style="display:flex;align-items:center;gap:9px">'+av(user,'32')+'<div style="min-width:0"><div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+htmlEsc(user.name||'')+'</div>'+
      '<div style="font-size:11px;color:var(--text3)">'+htmlEsc(roleLabel(user.role))+(user.empId?' · '+htmlEsc(user.empId):'')+'</div></div></div>'+
    statLine+
    '<div style="margin-top:8px;font-size:11px;color:var(--accent);font-weight:600">Click to see activity ›</div>'+
  '</div>';
  var box='<div onclick="openTeamActivity(\''+userId+'\')" onmouseenter="var p=this.parentNode.querySelector(\'.ochover\');if(p)p.style.display=\'block\'" onmouseleave="var p=this.parentNode.querySelector(\'.ochover\');if(p)p.style.display=\'none\'" '+
    'style="cursor:pointer;background:var(--card);border:1px solid '+(me?'var(--accent)':'var(--border)')+';border-radius:10px;padding:9px 12px;min-width:150px;max-width:190px;text-align:center;transition:box-shadow .1s" '+
    'onmousedown="event.stopPropagation()">'+
    '<div style="display:flex;align-items:center;gap:8px;justify-content:center">'+av(user,'28')+'<div style="min-width:0;text-align:left"><div style="font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px">'+htmlEsc((user.name||'').split(' ')[0])+(me?' <span style="font-size:8px;font-weight:700;color:var(--accent)">YOU</span>':'')+'</div>'+
      '<div style="font-size:10px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px">'+htmlEsc(roleLabel(user.role))+'</div></div></div>'+
  '</div>';
  var nodeWrap='<div style="position:relative;display:inline-block">'+box+popup+'</div>';
  if(!reports.length) return '<div style="display:flex;flex-direction:column;align-items:center">'+nodeWrap+'</div>';
  var childCols=reports.map(function(r){return '<div style="display:flex;flex-direction:column;align-items:center;padding:0 8px">'+renderOrgNodeH(r.id,depth+1,seen)+'</div>';}).join('');
  return '<div style="display:flex;flex-direction:column;align-items:center">'+
    nodeWrap+
    '<div style="width:2px;height:14px;background:var(--border)"></div>'+
    '<div style="display:flex;align-items:flex-start;border-top:2px solid var(--border);padding-top:14px">'+childCols+'</div>'+
  '</div>';
}
function renderOrgChartH(rootId){
  return '<div style="overflow-x:auto;padding:10px 4px"><div style="display:inline-block;min-width:100%">'+renderOrgNodeH(rootId,0,{})+'</div></div>';
}
function filterLeads(leads){
  var f=STATE.leadsFilter;
  var today=todayIST();
  return leads.filter(function(l){
    if(f.date==="today"&&l.date!==today)return false;
    if(f.date==="week"){var w=new Date();w.setDate(w.getDate()-7);if(new Date(l.date)<w)return false;}
    if(f.date==="month"){var n=new Date();if(new Date(l.date).getMonth()!==n.getMonth())return false;}
    if(f.stage!=="all"&&l.stage!==f.stage)return false;
    if(f.ind!=="all"){var co=STATE.companies.find(function(c){return c.id===l.coid});if(!co||co.ind!==f.ind)return false;}
    if(f.search){
      var q=f.search.toLowerCase();
      var co2=STATE.companies.find(function(c){return c.id===l.coid});
      var vals=[l.email,l.fn,l.ln,co2?co2.name:"",l.pos,l.desig];
      if(!vals.some(function(v){return(v||"").toLowerCase().includes(q)}))return false;
    }
    return true;
  });
}
function periodLeads(user){
  var all=getMyLeads(user);
  var p=STATE.period;
  var now=new Date();
  return all.filter(function(l){
    var d=new Date(l.date);
    if(p==="daily")return l.date===todayIST();
    if(p==="weekly"){var w=new Date(now);w.setDate(w.getDate()-7);return d>=w;}
    if(p==="monthly")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
    if(p==="quarterly"){var q=new Date(now);q.setMonth(q.getMonth()-3);return d>=q;}
    return true;
  });
}
function formatSkillsLineClient(skills){
  var list=(skills||[]).filter(Boolean).slice(0,3);
  if(!list.length)return"";
  if(list.length===1)return" with experience in "+list[0];
  if(list.length===2)return" with experience in "+list[0]+" and "+list[1];
  return" with experience in "+list.slice(0,-1).join(", ")+", and "+list[list.length-1];
}
function formatJobRespClient(skills){
  var list=(skills||[]).filter(Boolean).slice(0,3);
  if(!list.length)return"the key requirements";
  if(list.length===1)return list[0];
  if(list.length===2)return list[0]+" and "+list[1];
  return list.slice(0,-1).join(", ")+", and "+list[list.length-1];
}
function formatCompanyServiceClient(industry){
  var val=String(industry||"").trim();
  return val||"relevant";
}
function findJobForLead(l,co){
  if(!l||!STATE.jobs)return null;
  if(l.job_id)return STATE.jobs.find(function(j){return j.id===l.job_id;})||null;
  return STATE.jobs.find(function(j){
    return (j.position===l.pos||j.position===l.position)&&
      ((j.company&&j.company.name)===(co&&co.name)||j.company_name===(co&&co.name));
  })||null;
}
function buildClientEmailVars(l,co,sender){
  var job=findJobForLead(l,co);
  var req=(job&&job.research&&job.research.requirements)||{};
  var skills=Array.isArray(req.skills)?req.skills:[];
  if(req.skill_1)skills[0]=req.skill_1;
  if(req.skill_2)skills[1]=req.skill_2;
  if(req.skill_3)skills[2]=req.skill_3;
  skills=skills.filter(Boolean).slice(0,3);
  var companyExpertise=(job&&job.research&&job.research.company&&job.research.company.expertise)||"";
  var loc=(job&&job.location)||(co?co.loc:"")||req.location||"";
  var city=req.city||(loc.indexOf(",")>-1?loc.split(",")[0].trim():loc);
  var salary=req.salary_display||(job&&job.salary_range)||"";
  var localHint=req.local_hint||"";
  var localLine=localHint?(" Must be local to "+localHint+"."):(req.local_required&&city?(" Local to "+city+" preferred."):"");
  return{
    fn:l.fn,ln:l.ln,company:co?co.name:"",ind:co?co.ind:"",pos:l.pos||l.position,desig:l.desig,
    loc:loc,sender:sender||STATE.user.name,
    skill_1:skills[0]||"",skill_2:skills[1]||"",skill_3:skills[2]||"",
    skills_line:formatSkillsLineClient(skills),
    job_resp:formatJobRespClient(skills),
    company_service:formatCompanyServiceClient(companyExpertise||(co&&co.ind)||(job&&job.industry)||""),
    salary_range:salary,salary_line:salary?(" ("+salary+")"):"",
    local_line:localLine,city:city
  };
}
function fillEmail(tmpl,l,co,sender){
  var map=buildClientEmailVars(l,co,sender);
  return normalizeSenderTitle(tmpl.replace(/{{(\w+)}}/g,function(m,k){
    return map[k]!==undefined?map[k]:m;
  }));
}

// Reminder (OOO-return) follow-up templates — only offered when composing from a reminder.
var REMINDER_TEMPLATES=[
  {name:'Welcome back',subject:"Following up on {{pos}} now that you're back",body:"Hi {{fn}},\n\nHope you had a good time away. I wanted to circle back on the {{pos}} opening at {{company}}. We have candidates ready whenever you'd like to take a look.\n\nWould a quick call this week work?\n\nBest,\n{{sender}}"},
  {name:'Quick check-in',subject:"Re-connecting on {{pos}} at {{company}}",body:"Hi {{fn}},\n\nWelcome back! I wanted to pick up where we left off on your {{pos}} search. Happy to share a few profiles that fit the key requirements.\n\nShould I send them over?\n\nThanks,\n{{sender}}"},
  {name:'Candidates ready',subject:"Candidates ready for your {{pos}} role",body:"Hi {{fn}},\n\nNow that you're back in the office, I'd love to help move your {{pos}} search forward at {{company}}. We've shortlisted strong candidates experienced in {{ind}}.\n\nOpen to a 15-minute call?\n\nWarm regards,\n{{sender}}"}
];
window.composeReminderEmail=function(reminderId,cid){
  var rem=(STATE.reminders||[]).find(function(r){return r.id===reminderId;});
  STATE.composeContext='reminder';
  STATE.composeReminderId=reminderId;
  STATE.manualEmail=null;STATE.genEmail=null;STATE.emailTab='compose';STATE.showAIPanel=false;
  STATE.composeSubj='';STATE.composeBody='';
  var c=cid?STATE.contacts.find(function(x){return x.id===cid;}):null;
  var contactId=cid||(rem&&rem.contact_id)||'';
  var jobId=(c&&c.job_id)||(rem&&(rem.job_id||(rem.job&&rem.job.id)))||'';
  STATE.composeContactId=contactId?(contactId+'|'+jobId):null;
  STATE.composeCompanyId=(c?(jobById(c.job_id)||{}).company_id:null)||null;
  STATE.page='email';STATE.modal=null;
  showToast('Pick a reminder template, then Send','info');render();
};
window.applyReminderTemplate=function(i){
  var t=REMINDER_TEMPLATES[i];if(!t)return;
  var recip=resolveComposeRecipient();
  var lead=recip&&recip.lead,co=recip&&recip.co;
  var fromEm=STATE.composeFromEmailId?((STATE.userEmailsCache[STATE.user.id]||[]).find(function(e){return e.id===STATE.composeFromEmailId;})):null;
  var senderName=(fromEm&&fromEm.display_name)||STATE.user.name||'';
  STATE.composeSubj=lead?fillEmail(t.subject,lead,co,senderName):t.subject;
  STATE.composeBody=lead?fillEmail(t.body,lead,co,senderName):t.body;
  render();
};
window.sendReminderViaEngine=function(){
  var subjEl=document.getElementById('email-subj'),bodyEl=document.getElementById('email-body');
  var subject=(subjEl&&subjEl.value)||STATE.composeSubj||'';
  var body=(bodyEl&&bodyEl.value)||STATE.composeBody||'';
  if(!subject.trim()){showToast('Add a subject line','warning');return;}
  if(!body.trim()){showToast('Write a message','warning');return;}
  var rem=STATE.composeReminderId?((STATE.reminders||[]).find(function(r){return r.id===STATE.composeReminderId;})):null;
  var parts=(STATE.composeContactId||'').split('|');
  var contactId=parts[0]||(rem&&rem.contact_id)||null;
  var jobId=parts[1]||(rem&&(rem.job_id||(rem.job&&rem.job.id)))||null;
  var c=contactId?STATE.contacts.find(function(x){return x.id===contactId;}):null;
  var to=(c&&c.email)||(rem&&rem.email)||null;
  if(!to){showToast('No recipient email on record','warning');return;}
  if(!jobId){showToast('This reminder is not linked to a job, so it cannot send through the engine','warning');return;}
  apiPost('/emails/reminder-send',{reminder_id:STATE.composeReminderId,contact_id:contactId,job_id:jobId,to_email:to,subject:subject,body:body}).then(function(){
    showToast('Reminder queued — the engine will send it shortly','success');
    var rid=STATE.composeReminderId;
    if(rid)STATE.reminders=(STATE.reminders||[]).map(function(r){return r.id===rid?Object.assign({},r,{status:'sent'}):r;});
    STATE.composeContext=null;STATE.composeReminderId=null;STATE.composeSubj='';STATE.composeBody='';STATE.composeContactId=null;STATE.composeCompanyId=null;STATE.genEmail=null;
    STATE.page='reminders';render();
  }).catch(function(e){showToast('Send failed: '+(e&&e.message||e),'error');});
};

// Five matched outreach styles — each with its own O1, FU1, and FU2 (keep in sync with email-vars.js)
var OUTREACH_STYLE_PRESETS={
  v1:{
    label:'Introduction',
    hint:'Classic introduction, candidates + fit',
    o1:{subj:'Candidates for your {{pos}} role in {{loc}}',body:"Hi {{fn}},\n\nI'm {{sender}} with Fute Global LLC. I came across your {{pos}} opening in {{loc}} and read through the requirements, and we have several people with {{job_resp}} experience on {{company_service}} work who look like a strong fit. They're open to direct hire and haven't been screened for your role yet.\n\nWould you like to review their resumes?\n\nLooking forward to your thoughts."},
    fu1:{subj:'Re: Candidates for your {{pos}} role in {{loc}}',body:"Hi {{fn}},\n\nCircling back on your {{pos}} role in {{loc}}. Those candidates with {{job_resp}} experience on {{company_service}} projects are still available.\n\nWant me to send their resumes over?\n\nLooking forward to your thoughts."},
    fu2:{subj:'Re: Candidates for your {{pos}} role in {{loc}}',body:"Hi {{fn}},\n\nI'll keep this short. Still holding a few screened-ready candidates with {{job_resp}} backgrounds for your {{pos}} opening in {{loc}} whenever the timing suits.\n\nShall I share their resumes?\n\nLooking forward to your thoughts."}
  },
  v2:{
    label:'Candidates first',
    hint:'Leads with the candidates, short and direct',
    o1:{subj:'{{pos}} in {{loc}}: a few resumes worth a look',body:"Hi {{fn}},\n\nA few direct-hire candidates with strong {{job_resp}} experience on {{company_service}} projects just became available, and they line up well with your {{pos}} opening in {{loc}}.\n\nShould I send their resumes across?\n\nHappy to share whenever you're ready."},
    fu1:{subj:'Re: {{pos}} in {{loc}}: a few resumes worth a look',body:"Hi {{fn}},\n\nQuick nudge on this. The {{job_resp}} candidates I mentioned for your {{pos}} role in {{loc}} are still on the market.\n\nShould I pass along their resumes?\n\nHappy to share whenever you're ready."},
    fu2:{subj:'Re: {{pos}} in {{loc}}: a few resumes worth a look',body:"Hi {{fn}},\n\nLast note from me on the {{pos}} opening in {{loc}}. Happy to forward those {{company_service}} candidates' resumes if it's useful.\n\nHappy to share whenever you're ready."}
  },
  v3:{
    label:'Question opener',
    hint:'Opens with a question about the role',
    o1:{subj:'A question about your {{pos}} opening in {{loc}}',body:"Hi {{fn}},\n\nIs your {{pos}} role in {{loc}} still open? I ask because I'm {{sender}} at Fute Global LLC, and after reading the job description I have a shortlist of people with {{job_resp}} experience on {{company_service}} projects who fit it well. They're direct-hire ready and haven't been put in front of you yet.\n\nOpen to a quick look at a couple of profiles?\n\nNo rush at all. Just let me know."},
    fu1:{subj:'Re: A question about your {{pos}} opening in {{loc}}',body:"Hi {{fn}},\n\nFollowing up in case my earlier note slipped by. I still have those {{job_resp}} candidates lined up for your {{pos}} role in {{loc}}.\n\nWorth a quick look at a couple of profiles?\n\nNo rush at all. Just let me know."},
    fu2:{subj:'Re: A question about your {{pos}} opening in {{loc}}',body:"Hi {{fn}},\n\nOne final check-in on the {{pos}} role in {{loc}}. If it's still active, I'd be glad to share a couple of {{company_service}} profiles for your review.\n\nNo rush at all. Just let me know."}
  },
  v4:{
    label:'Concise',
    hint:'Shortest version, straight to the point',
    o1:{subj:'{{pos}} ({{loc}}): direct-hire candidates available',body:"Hi {{fn}},\n\nSaw your {{pos}} opening in {{loc}}. We've got candidates with hands-on {{job_resp}} experience on {{company_service}} work, ready for direct hire and your screening, no obligation to proceed.\n\nWant me to forward a few resumes?\n\nAppreciate you taking a look."},
    fu1:{subj:'Re: {{pos}} ({{loc}}): direct-hire candidates available',body:"Hi {{fn}},\n\nFollowing up. The {{job_resp}} candidates for your {{pos}} role in {{loc}} are still available for review.\n\nWant me to forward a few resumes?\n\nAppreciate you taking a look."},
    fu2:{subj:'Re: {{pos}} ({{loc}}): direct-hire candidates available',body:"Hi {{fn}},\n\nFinal follow-up on {{pos}} in {{loc}}. Happy to forward those resumes whenever you'd like to take a look.\n\nAppreciate you taking a look."}
  },
  v5:{
    label:'Direct value',
    hint:'Direct-hire focus, clear value proposition',
    o1:{subj:'Direct-hire talent for your {{pos}} need in {{loc}}',body:"Hi {{fn}},\n\nI'm {{sender}}, and at Fute Global LLC we place direct-hire talent. Your {{pos}} opening in {{loc}} stood out, and we currently have candidates with solid {{job_resp}} experience on {{company_service}} projects who match what the role calls for, available for your screening at no cost or commitment.\n\nIs it worth sharing their resumes with you?\n\nI'll keep an eye out for your reply."},
    fu1:{subj:'Re: Direct-hire talent for your {{pos}} need in {{loc}}',body:"Hi {{fn}},\n\nWanted to resurface this. The candidates with {{job_resp}} experience on {{company_service}} work are still available for your {{pos}} role in {{loc}}.\n\nIs it worth sharing their resumes?\n\nI'll keep an eye out for your reply."},
    fu2:{subj:'Re: Direct-hire talent for your {{pos}} need in {{loc}}',body:"Hi {{fn}},\n\nI'll leave it here for now, but the {{job_resp}} candidates remain ready whenever your {{pos}} search in {{loc}} calls for them.\n\nGlad to share resumes at any point."}
  }
};
var MERGE_VAR_GROUPS=[
  {label:'Contact',chips:[
    ['{{fn}}','First name','Contact\'s first name'],
    ['{{ln}}','Last name','Contact\'s last name'],
    ['{{desig}}','Their job title','Contact\'s designation']
  ]},
  {label:'Job & company',chips:[
    ['{{pos}}','Job title','Open role you\'re hiring for'],
    ['{{company}}','Company name','Company name'],
    ['{{loc}}','Location','Job location'],
    ['{{city}}','City','City from job location'],
    ['{{ind}}','Industry','Company industry'],
    ['{{skills_line}}','Skills phrase','Auto phrase from job skills, e.g. " with experience in HVAC"'],
    ['{{job_resp}}','Job responsibility','Top skills from the JD, e.g. "Sage and communication"'],
    ['{{company_service}}','Project / industry','Company industry for project context, e.g. "Healthcare"'],
    ['{{local_line}}','Local requirement','Local/on-site requirement if set']
  ]},
  {label:'Compensation',chips:[
    ['{{salary_line}}','Salary','Salary in parentheses if available'],
    ['{{salary_range}}','Salary range','Raw salary range text']
  ]},
  {label:'Your details',chips:[
    ['{{sender}}','Your name','Your display name on the sending email']
  ]}
];
var MERGE_VAR_MORE=[
  ['{{skill_1}}','Skill 1','First matched skill'],
  ['{{skill_2}}','Skill 2','Second matched skill'],
  ['{{skill_3}}','Skill 3','Third matched skill']
];
function outreachTmplApiKey(tabKey){return tabKey==='outreach'?'o1':tabKey;}
function renderSendingEmailCard(userId,myEmails,selectedId,onSelectFn){
  if(!myEmails.length){
    return '<div class="card cp mb3"><div class="fw6 mb2" style="font-size:13px">Sending from</div>'+
      '<div style="font-size:12px;color:var(--amber);padding:4px 0">No active email IDs yet. Ask your admin to add one under your profile.</div></div>';
  }
  var selId=selectedId||(myEmails.find(function(e){return e.is_primary;})||myEmails[0]).id;
  var opts=myEmails.map(function(e){
    return '<option value="'+e.id+'"'+(e.id===selId?' selected':'')+'>'+htmlEsc(e.display_name||e.email_address)+' &lt;'+htmlEsc(e.email_address)+'&gt;</option>';
  }).join('');
  return '<div class="card cp mb3">'+
    '<div class="fw6 mb1" style="font-size:13px">Sending from</div>'+
    '<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px">Emails go out from this address. Signature uses this ID too.</div>'+
    '<select class="sel" onchange="'+onSelectFn+'(this.value)">'+opts+'</select>'+
  '</div>';
}
function mergeVarFriendlyLabel(token){
  var i,g,c;
  for(i=0;i<MERGE_VAR_GROUPS.length;i++){
    for(c=0;c<MERGE_VAR_GROUPS[i].chips.length;c++){
      if(MERGE_VAR_GROUPS[i].chips[c][0]===token)return MERGE_VAR_GROUPS[i].chips[c][1];
    }
  }
  for(i=0;i<MERGE_VAR_MORE.length;i++){
    if(MERGE_VAR_MORE[i][0]===token)return MERGE_VAR_MORE[i][1];
  }
  return 'Field';
}
function renderVarChipBtn(token,label,hint,subjId,bodyId){
  return '<button type="button" title="'+htmlEsc(hint||label)+'" onclick="insertVarChip(\''+token+'\',\''+subjId+'\',\''+bodyId+'\')" '+
    'style="font-size:12px;padding:6px 12px;border-radius:20px;border:1px solid var(--border2);background:#fff;color:var(--text);cursor:pointer;white-space:nowrap;font-weight:500" '+
    'onmouseover="this.style.borderColor=\'var(--accent)\';this.style.background=\'var(--accent-l)\';this.style.color=\'var(--accent)\'" '+
    'onmouseout="this.style.borderColor=\'var(--border2)\';this.style.background=\'#fff\';this.style.color=\'var(--text)\'">'+htmlEsc(label)+'</button>';
}
function renderVarChipBar(subjId,bodyId){
  var target=STATE.varInsertTarget||'body';
  var groupHtml=MERGE_VAR_GROUPS.map(function(g){
    var chips=g.chips.map(function(v){return renderVarChipBtn(v[0],v[1],v[2],subjId,bodyId);}).join('');
    return '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">'+htmlEsc(g.label)+'</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px">'+chips+'</div></div>';
  }).join('');
  var moreHtml='';
  if(STATE.showMoreVarChips){
    moreHtml='<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Individual skills</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px">'+
      MERGE_VAR_MORE.map(function(v){return renderVarChipBtn(v[0],v[1],v[2],subjId,bodyId);}).join('')+
      '</div></div>';
  }
  return '<div style="padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r2);margin-top:8px">'+
    '<div style="font-weight:600;font-size:13px;color:var(--text);margin-bottom:4px">Personalize your message</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">Step 1 — choose where to add &nbsp;·&nbsp; Step 2 — click a field below</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">'+
      '<button type="button" onclick="setVarInsertTarget(\'subject\')" style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:2px solid '+(target==='subject'?'var(--accent)':'var(--border)')+';background:'+(target==='subject'?'var(--accent)':'#fff')+';color:'+(target==='subject'?'#fff':'var(--text2)')+'">① Subject line</button>'+
      '<button type="button" onclick="setVarInsertTarget(\'body\')" style="padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:2px solid '+(target==='body'?'var(--accent)':'var(--border)')+';background:'+(target==='body'?'var(--accent)':'#fff')+';color:'+(target==='body'?'#fff':'var(--text2)')+'">② Email body</button>'+
      '<span style="font-size:11px;color:var(--text3);align-self:center">Adding to: <strong style="color:var(--accent)">'+(target==='subject'?'Subject line':'Email body')+'</strong></span>'+
    '</div>'+
    groupHtml+moreHtml+
    '<button type="button" onclick="STATE.showMoreVarChips=!STATE.showMoreVarChips;render()" style="font-size:11px;padding:4px 0;border:0;background:transparent;color:var(--accent);cursor:pointer;font-weight:600">'+
      (STATE.showMoreVarChips?'▲ Hide individual skills':'▼ Show individual skills (Skill 1, 2, 3)')+
    '</button>'+
  '</div>';
}


// The signed-in customer's own name. PACE is the product; the organisation is
// whoever is using it — Fute Global is one customer among others. The Admin
// header used to hard-code "Fute Global LLC", which was fine when there was one
// tenant and is wrong now.
function orgDisplayName(){
  return (STATE.org&&STATE.org.name)
    ||(STATE.user&&(STATE.user.org_name||STATE.user.orgName))
    ||'Your organisation';
}
