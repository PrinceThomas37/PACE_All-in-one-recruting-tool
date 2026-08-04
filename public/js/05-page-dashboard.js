// ════════════════════════════════════════════════
// RENDER PAGES
// ════════════════════════════════════════════════
function renderPage(){
  if(STATE.page==="dashboard")return renderDashboard();
  if(STATE.page==="leads"){var html=renderJobs();setTimeout(bindJobsControls,0);return html;}
  if(STATE.page==="assign"){return renderAssignLeads();}
  if(STATE.page==="emailaccounts"||STATE.page==="managerusers"){return renderManagerUsers();}
  if(STATE.page==="insights"){if(STATE.user&&STATE.user.role==='ra'&&!STATE.insightsData){loadMyInsights();}return renderInsights();}
  if(STATE.page==="bdinsights"){if(STATE.user&&!STATE.bdInsightsData){loadBDInsights();}return renderBDInsights();}
  if(STATE.page==="bdleadinsights"){return renderBDLeadInsights();}
  if(STATE.page==="email")return renderEmail();
  if(STATE.page==="reminders")return renderReminders();
  if(STATE.page==="admin")return renderAdmin();
  if(STATE.page==="deliverability")return renderDeliverability();
  if(STATE.page==="workflows"){STATE.page="email";STATE.emailTab="sequence";return renderEmail();}
  if(STATE.page==="profile")return renderProfile();
  return "<div class='page'>Page not found</div>";
}

// ── DASHBOARD ──────────────────────────────────
function isPureRecruiter(u){
  return userHasRole(u,'recruiter')&&!userHasAnyRole(u,'admin','bd','bd_lead','ra_lead');
}
// A "manager" for dashboard purposes = anyone who runs a desk / leads people:
// admin, BD, BD Lead, Associate Director, Director, RA Lead. They get the real,
// hierarchy-scoped team dashboard (built on /recruiting-dashboard) instead of
// the legacy lead-gen dashboard, which reads STATE.leads — dead seed data that
// is empty for every real login.
function isManagerRole(u){
  return userHasAnyRole(u,'admin','bd','bd_lead','associate_director','director','ra_lead');
}

function renderDashboard(){
  // Support "view as" — admin/BD can click a team member to see their dashboard
  var u=STATE.viewingUser||STATE.user;
  var isViewingOther=STATE.viewingUser&&STATE.viewingUser.id!==STATE.user.id;

  // "What needs you today" — loaded once per dashboard visit. Guests have no
  // backend behind this, and a "view as" preview must not fetch the viewer's
  // own queue and label it someone else's.
  if(!u.isGuest&&!isViewingOther&&STATE.nextActions===undefined)loadNextActions();

  // Recruiters live in the recruiting workflow (jobs, candidates, interviews) —
  // lead-gen widgets are someone else's desk. Give them their own dashboard.
  if(!isViewingOther&&isPureRecruiter(u))return renderRecruiterDashboard(u);
  // Managers on a real login get the team dashboard (team roster + team's
  // recruiting desk, from the live hierarchy-scoped endpoint). Data-driven: a
  // plain "ra"/"bd" who's been given reports via the flexible hierarchy also
  // qualifies, not just the fixed manager-ish roles. The guest/demo session
  // stays on the legacy lead dashboard below — it has seeded STATE.leads and no
  // backend to serve /recruiting-dashboard, so it's the better showcase.
  if(!isViewingOther&&!u.isGuest&&(isManagerRole(u)||getTeam(u).length))return renderManagerDashboard(u);
  // Everyone else on a real login (typically a plain "ra" with no reports) gets
  // the real individual dashboard, built on STATE.jobs — the same data the Leads
  // page already uses (GET /jobs is scoped server-side to what this user owns).
  // The legacy tail below reads STATE.leads, which is dead seed data for every
  // real login; it stays only for the guest demo and the "view as" preview.
  if(!isViewingOther&&!u.isGuest)return renderIndividualDashboard(u);
  var pl=periodLeads(u);
  var total=pl.length;
  var emailed=pl.filter(function(l){return l.sent}).length;
  var pos=pl.filter(function(l){return l.stage==="Positive"||l.stage==="Connected"}).length;
  var pend=pl.filter(function(l){return l.stage==="Active"}).length;
  var rr=total?Math.round(emailed/total*100):0;

  var hour=new Date().getHours();
  var greet=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";

  // period picker
  var periods=["daily","weekly","monthly","quarterly"];
  var pickers=periods.map(function(p){
    return '<button class="fc'+(STATE.period===p?" on":"") + '" onclick="setPeriod(\''+p+'\')" style="text-transform:capitalize">'+p+'</button>';
  }).join("");

  // team card — only show for actual logged-in user (not when viewing someone else).
  // Recruiters don't work leads, so their all-zero rows are excluded from this table.
  var team=(isViewingOther?[]:getTeam(u)).filter(function(t){return !isPureRecruiter(t);});
  var canClickTeam=(STATE.user.role==="admin"||STATE.user.role==="bd");
  var teamRows=team.map(function(t){
    var tl=getMyLeads(t);
    var tlp=filterPeriod(tl,STATE.period);
    var pos_=tlp.filter(function(l){return l.stage==="Positive"||l.stage==="Connected"}).length;
    var neg_=tlp.filter(function(l){return l.stage==="Negative"}).length;
    var resp_=tlp.filter(function(l){return l.sent}).length;
    var rr_=tlp.length?Math.round(resp_/tlp.length*100):0;
    var rrColor=rr_>50?"var(--green)":rr_>25?"var(--amber)":"var(--text3)";
    var clickStyle=canClickTeam?'cursor:pointer':'cursor:default';
    var hoverStyle=canClickTeam?' onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'transparent\'"':"";
    var clickAttr=canClickTeam?' onclick="viewAs(\''+t.id+'\')"':"";
    return '<div'+clickAttr+hoverStyle+' style="'+clickStyle+';display:flex;flex-direction:row;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);transition:background .1s;background:transparent">'+
      '<div class="av av-36 '+t.avc+'" style="flex-shrink:0">'+t.av+'</div>'+
      '<div style="flex:1;min-width:0;overflow:hidden">'+
        '<div style="font-weight:500;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)">'+t.name+'</div>'+
        '<div style="font-size:11.5px;color:var(--text3);white-space:nowrap">'+roleLabel(t.role)+(t.empId?' · '+t.empId:'')+'</div>'+
      '</div>'+
      '<div style="display:flex;flex-direction:row;gap:0;align-items:center;flex-shrink:0">'+
        '<div style="text-align:center;width:72px">'+
          '<div style="font-family:var(--display);font-weight:700;font-size:17px;color:var(--accent);line-height:1.2">'+tlp.length+'</div>'+
          '<div style="font-size:10px;color:var(--text3)">leads</div>'+
        '</div>'+
        '<div style="text-align:center;width:80px">'+
          '<div style="font-family:var(--display);font-weight:700;font-size:17px;color:'+rrColor+';line-height:1.2">'+rr_+'%</div>'+
          '<div style="font-size:10px;color:var(--text3)">response</div>'+
        '</div>'+
        '<div style="text-align:center;width:60px">'+
          '<div style="font-family:var(--display);font-weight:700;font-size:17px;color:var(--green);line-height:1.2">'+pos_+'</div>'+
          '<div style="font-size:10px;color:var(--text3)">positive</div>'+
        '</div>'+
        '<div style="text-align:center;width:60px">'+
          '<div style="font-family:var(--display);font-weight:700;font-size:17px;color:var(--red);line-height:1.2">'+neg_+'</div>'+
          '<div style="font-size:10px;color:var(--text3)">negative</div>'+
        '</div>'+
        (canClickTeam?'<div style="width:20px;text-align:center;color:var(--text3);font-size:13px">›</div>':'')+
      '</div>'+
    '</div>';
  }).join("");

  // industry breakdown
  var indMap={};
  var allMy=getMyLeads(u);
  allMy.forEach(function(l){var co=STATE.companies.find(function(c){return c.id===l.coid});if(co)indMap[co.ind]=(indMap[co.ind]||0)+1;});
  var indArr=Object.entries(indMap).sort(function(a,b){return b[1]-a[1]}).slice(0,7);
  var maxI=indArr.length?indArr[0][1]:1;
  var indRows=indArr.map(function(e){
    var pct=Math.round(e[1]/maxI*100);
    return '<div class="ind-row">'+
      '<div style="font-size:13px;min-width:110px">'+e[0]+'</div>'+
      '<div class="ind-bg"><div class="ind-fill" style="width:'+pct+'%;background:var(--accent)"></div></div>'+
      '<div style="font-size:12px;font-family:var(--mono);color:var(--text3);min-width:22px;text-align:right">'+e[1]+'</div>'+
    '</div>';
  }).join("");

  // response rate bars (last 4 weeks)
  var bars=[3,2,1,0].map(function(w){
    var wEnd=new Date();wEnd.setDate(wEnd.getDate()-w*7);
    var wStart=new Date(wEnd);wStart.setDate(wStart.getDate()-7);
    var wl=allMy.filter(function(l){var d=new Date(l.date);return d>=wStart&&d<=wEnd;});
    var we=wl.filter(function(l){return l.sent}).length;
    var rate=wl.length?Math.round(we/wl.length*100):0;
    var bg=rate>60?"var(--green)":rate>30?"var(--amber)":"var(--accent)";
    return '<div class="bar-col"><div class="bar-fill" style="height:'+Math.max(4,rate)+'%;background:'+bg+'"></div><div class="bar-lbl">W'+(4-w)+'</div></div>';
  }).join("");

  // stage pills
  var stagePills=STAGES.map(function(s){
    var cnt=pl.filter(function(l){return l.stage===s}).length;
    if(!cnt)return"";
    var c=s==="Positive"?"var(--green)":s==="Negative"?"var(--red)":s==="Connected"?"var(--accent)":"var(--text)";
    return '<div style="text-align:center;padding:12px 16px;background:var(--bg);border-radius:var(--r2);min-width:76px">'+
      '<div style="font-family:var(--display);font-size:22px;font-weight:700;color:'+c+'">'+cnt+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+s+'</div>'+
    '</div>';
  }).join("");

  return '<div class="page">'+
    (isViewingOther?
      '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--amber-l);border:1px solid rgba(217,119,6,.25);border-radius:var(--r2);margin-bottom:14px;font-size:13px">'+
        '<span style="font-size:16px">👁</span>'+
        '<span>You are viewing <strong>'+u.name+'</strong>\'s dashboard as an observer.</span>'+
        '<button class="btn btn-outline btn-sm" style="margin-left:auto;font-size:12px" onclick="stopViewing()">← Back to mine</button>'+
      '</div>'
    :"")+
    '<div class="banner">'+
      '<div style="position:absolute;top:16px;right:20px;background:rgba(255,255,255,.18);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.3);border-radius:var(--r2);padding:10px 16px;text-align:right">'+
        '<div id="dash-clock-time" style="font-family:var(--display);font-size:13px;font-weight:500;letter-spacing:.01em;line-height:1;color:rgba(255,255,255,.85)">'+new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})+'</div>'+
        '<div id="dash-clock-date" style="font-size:22px;font-weight:700;margin-top:5px;color:#fff;font-family:var(--display)">'+new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})+'</div>'+
      '</div>'+
      '<div class="banner-name">'+(isViewingOther?u.name+"'s Dashboard":greet+', '+u.name.split(" ")[0]+' 👋')+'</div>'+
      '<div class="banner-sub">'+roleLabel(u.role)+'</div>'+
      '<div class="banner-stats">'+
        '<div><div class="bstat-val">'+total+'</div><div class="bstat-lbl">Leads this period</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+emailed+'</div><div class="bstat-lbl">Emails sent</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+rr+'%</div><div class="bstat-lbl">Response rate</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+pos+'</div><div class="bstat-lbl">Positive</div></div>'+
      '</div>'+
    '</div>'+

    '<div class="flex gap2 mb4 flex-wrap">'+pickers+'</div>'+

    (team.length?
      '<div class="card mb4">'+
        '<div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">'+
          '<div>'+
            '<div class="fw6">'+(u.role==="ra"?"Your BD Manager":"Your Team")+'</div>'+
            (canClickTeam&&!isViewingOther?'<div style="font-size:11px;color:var(--text3);margin-top:2px">Click any member to view their dashboard</div>':'')+
          '</div>'+
          '<div style="display:flex;flex-direction:row;align-items:center;flex-shrink:0">'+
            '<div style="text-align:center;width:72px;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Leads</div>'+
            '<div style="text-align:center;width:80px;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Response</div>'+
            '<div style="text-align:center;width:60px;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Pos</div>'+
            '<div style="text-align:center;width:60px;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Neg</div>'+
            (canClickTeam?'<div style="width:20px"></div>':'')+
          '</div>'+
        '</div>'+
        '<div>'+teamRows+'</div>'+
        '<div style="padding:8px 14px;background:var(--bg);border-top:1px solid var(--border);border-radius:0 0 var(--r3) var(--r3);font-size:11.5px;color:var(--text3)">Showing stats for: <strong style="color:var(--text)">'+STATE.period+'</strong></div>'+
      '</div>'
    :"")+

    '<div class="g2 mb4">'+
      '<div class="card cp"><div class="flex jb aic mb3"><div><div class="fw6">Response rate trend</div><div class="f12 text3">Last 4 weeks</div></div><span class="bdg bdg-blue">'+rr+'% avg</span></div><div class="bar-chart">'+bars+'</div></div>'+
      '<div class="card cp"><div class="fw6 mb3">Industry breakdown</div>'+(indRows||'<div class="text3 f13">No leads yet</div>')+'</div>'+
    '</div>'+

    '<div class="card cp"><div class="flex jb aic mb3"><div class="fw6">Pipeline overview</div><div class="f12 text3">'+STATE.period+'</div></div><div class="flex gap2 flex-wrap">'+stagePills+'</div></div>'+

    renderRemindersWidget()+

  '</div>';
}

// ── REMINDERS WIDGET (shared: BD + recruiter dashboards) ──────────────
function renderRemindersWidget(){
      var today=todayIST();
      var myR=STATE.reminders.filter(function(r){return r.user_id===STATE.user.id&&r.status==="pending";});
      var due=myR.filter(function(r){return r.return_date<=today;});
      var upcoming=myR.filter(function(r){return r.return_date>today;}).slice(0,4);
      if(!myR.length)return '<div class="card cp mt4">'+
        '<div class="flex jb aic mb3">'+
          '<div><div class="fw6">Reminders</div><div class="f12 text3">No reminders set</div></div>'+
          '<button class="btn btn-outline btn-sm" onclick="goPage(\'reminders\')">Go to Reminders</button>'+
        '</div>'+
        '<div style="padding:16px 0;text-align:center;font-size:13px;color:var(--text3)">Set reminders to follow up with contacts at the right time.</div>'+
      '</div>';

      var dueRows=due.map(function(r){
        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">'+
          '<div style="width:7px;height:7px;border-radius:50%;background:var(--amber);flex-shrink:0"></div>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:13.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(r.name)+'</div>'+
            '<div class="f12 text3">'+htmlEsc(r.company||r.email||"")+'</div>'+
          '</div>'+
          '<span style="font-size:11px;padding:2px 7px;background:var(--amber);color:#fff;border-radius:10px;white-space:nowrap">Due today</span>'+
          '<button class="btn btn-sm" style="background:var(--amber);color:#fff;white-space:nowrap" onclick="sendReminderEmail(\''+r.id+'\')">'+ico("send",12)+' Send</button>'+
        '</div>';
      }).join("");

      var upcomingRows=upcoming.map(function(r){
        var days=Math.ceil((new Date(r.return_date)-new Date(today))/86400000);
        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">'+
          '<div style="width:7px;height:7px;border-radius:50%;background:var(--accent);flex-shrink:0"></div>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:13.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(r.name)+'</div>'+
            '<div class="f12 text3">'+htmlEsc(r.return_date||'')+(r.reminder_time?' · '+r.reminder_time+' IST':'')+(r.note?' · '+htmlEsc(r.note):'')+'</div>'+
          '</div>'+
          '<span style="font-size:11px;padding:2px 8px;background:'+(days<=3?"var(--red-l)":"var(--accent-l)")+';color:'+(days<=3?"var(--red)":"var(--accent)")+';border-radius:10px;white-space:nowrap">'+days+' day'+(days!==1?"s":"")+'</span>'+
        '</div>';
      }).join("");

      return '<div class="card cp mt4">'+
        '<div class="flex jb aic mb3">'+
          '<div>'+
            '<div class="fw6">Reminders</div>'+
            '<div class="f12 text3">'+due.length+' due · '+upcoming.length+' upcoming</div>'+
          '</div>'+
          '<div class="flex gap2">'+
            (due.length?'<button class="btn btn-sm" style="background:var(--amber);color:#fff" onclick="sendAllDue()">Send all due ('+due.length+')</button>':"")+
            '<button class="btn btn-outline btn-sm" onclick="goPage(\'reminders\')">View all</button>'+
          '</div>'+
        '</div>'+
        (due.length?'<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--amber);text-transform:uppercase;letter-spacing:.05em">⏰ Due now</div>':"")+
        dueRows+
        (upcoming.length?'<div style="margin:'+(due.length?"12px":"0")+'px 0 8px;font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Upcoming</div>':"")+
        upcomingRows+
        (myR.length>5?'<div style="padding-top:10px;text-align:center"><button class="btn btn-outline btn-sm" onclick="goPage(\'reminders\')">View all '+myR.length+' reminders</button></div>':"")+
      '</div>';
}

// ── RECRUITER DASHBOARD ────────────────────────────────────────────────
// A recruiter's day is jobs, candidates and interviews — not lead-gen. This
// view is built from GET /recruiting-dashboard (same cache the "my desk"
// strip uses, so no duplicate fetches) plus the shared reminders widget.
function recDashboardLoad(){
  if(STATE._recDashLoading)return;
  var fresh=STATE._recDash&&(Date.now()-STATE._recDash._at<60000);
  if(fresh)return;
  STATE._recDashLoading=true;
  apiGet('/recruiting-dashboard').then(function(d){
    d=d||{};d._at=Date.now();
    STATE._recDash=d;STATE._recDashLoading=false;
    if(STATE.page==='dashboard')render();
  }).catch(function(){STATE._recDashLoading=false;STATE._recDash={_at:Date.now(),empty:true};});
}

function recStageColor(s){
  if(s==='Placement'||s==='Joining'||s==='Confirmation')return"var(--green)";
  if(s==='Not Accepted'||s==='Rejected'||s==='Not Joined')return"var(--red)";
  if(s==='Offer')return"#7c3aed";
  if(s==='Interview Scheduled'||s==='Interview Completed')return"#2563eb";
  if(s==='On Hold')return"var(--amber)";
  return"var(--text)";
}

// "My jobs" card: how many jobs landed on my desk per timeline, the five the
// team is most active on right now, and a jump to the full list (newest first).
function renderRecruiterJobsCard(d){
  var ja=d.jobs_assigned||{};
  var top=d.top_jobs||[];

  function stat(label,value){
    return '<div style="text-align:center;padding:10px 14px;background:var(--bg);border-radius:var(--r2);min-width:88px;flex:1">'+
      '<div style="font-family:var(--display);font-size:20px;font-weight:700;color:var(--accent)">'+(value||0)+'</div>'+
      '<div style="font-size:10.5px;color:var(--text3);margin-top:2px;white-space:nowrap">'+label+'</div>'+
    '</div>';
  }

  var rows=top.map(function(j){
    var loc=[j.city,j.state].filter(Boolean).join(', ');
    var hot=j.team_subs_14d>0;
    var pr=j.priority&&j.priority!=='Normal'?'<span style="font-size:10px;font-weight:700;color:var(--red);background:var(--red-l);padding:2px 7px;border-radius:8px;margin-left:6px">'+htmlEsc(j.priority)+'</span>':'';
    return '<div onclick="bdOpenSubmissions(\''+j.id+'\')" onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'transparent\'" style="display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(j.job_title||'')+pr+'</div>'+
        '<div class="f12 text3" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(j.job_code||'')+(j.client?' · '+htmlEsc(j.client):'')+(loc?' · '+htmlEsc(loc):'')+'</div>'+
      '</div>'+
      '<div style="text-align:center;width:88px;flex-shrink:0">'+
        '<div style="font-family:var(--display);font-weight:700;font-size:16px;color:'+(hot?'var(--green)':'var(--text3)')+'">'+(j.team_subs_14d||0)+'</div>'+
        '<div style="font-size:10px;color:var(--text3)">team · 14d</div>'+
      '</div>'+
      '<div style="text-align:center;width:70px;flex-shrink:0">'+
        '<div style="font-family:var(--display);font-weight:700;font-size:16px;color:var(--accent)">'+(j.my_subs||0)+'</div>'+
        '<div style="font-size:10px;color:var(--text3)">my subs</div>'+
      '</div>'+
      '<div style="width:16px;text-align:center;color:var(--text3);font-size:13px;flex-shrink:0">›</div>'+
    '</div>';
  }).join("");

  return '<div class="card cp mb4">'+
    '<div class="flex jb aic mb3">'+
      '<div><div class="fw6">My jobs</div><div class="f12 text3">'+(ja.total||0)+' assigned to me</div></div>'+
      '<button class="btn btn-outline btn-sm" onclick="goPage(\'bd_myjobs\')">All my jobs →</button>'+
    '</div>'+
    '<div class="flex gap2 flex-wrap mb3">'+
      stat('Assigned this week',ja.week)+
      stat('This month',ja.month)+
      stat('This quarter',ja.quarter)+
      stat('All time',ja.total)+
    '</div>'+
    (top.length?
      '<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Most active — team submissions, last 14 days</div>'+rows
    :'<div style="padding:12px 0;text-align:center;font-size:13px;color:var(--text3)">No jobs on your desk yet — your BD manager assigns them to you.</div>')+
  '</div>';
}

// Rejections shown as context next to the period's stats — not a scorecard.
// The reason (BD's duty to record) explains WHY, so a run of rejections reads
// as "client wanted X" rather than as a mark against the recruiter.
function renderRecentRejections(d){
  var rows=d.recent_rejections||[];
  if(!rows.length)return'';
  var items=rows.map(function(r){
    var when;try{when=new Date(r.at).toLocaleDateString("en-IN",{day:"numeric",month:"short"});}catch(e){when='';}
    return '<div style="padding:9px 0;border-bottom:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;gap:10px">'+
        '<span style="font-size:13px;font-weight:600">'+htmlEsc(r.candidate||'Candidate')+'</span>'+
        '<span class="f12 text3" style="white-space:nowrap">'+htmlEsc(when)+'</span>'+
      '</div>'+
      '<div class="f12 text3" style="margin-top:2px">'+(r.reason?htmlEsc(r.reason):'No reason recorded yet')+'</div>'+
    '</div>';
  }).join("");
  return '<div class="card cp mb4">'+
    '<div class="fw6" style="margin-bottom:2px">Recent rejections</div>'+
    '<div class="f12 text3 mb3">For context, not a scorecard — reasons are logged by the BD team</div>'+
    items+
  '</div>';
}

function renderRecruiterDashboard(u){
  recDashboardLoad();
  var d=STATE._recDash||{};
  var bs=d.by_stage||{};
  var interviews=(bs['Interview Scheduled']||0)+(bs['Interview Completed']||0);
  var loading=!d._at&&!d.empty;

  var hour=new Date().getHours();
  var greet=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";

  // stage pills — backend sends by_stage keys in workflow order
  var stagePills=Object.keys(bs).map(function(s){
    var cnt=bs[s];
    if(!cnt)return"";
    return '<div style="text-align:center;padding:12px 16px;background:var(--bg);border-radius:var(--r2);min-width:76px">'+
      '<div style="font-family:var(--display);font-size:22px;font-weight:700;color:'+recStageColor(s)+'">'+cnt+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+s+'</div>'+
    '</div>';
  }).join("");

  var upcomingRows=(d.upcoming_interviews||[]).map(function(iv){
    var dt;try{var x=new Date(iv.interview_at);dt=x.toLocaleDateString("en-IN",{day:"numeric",month:"short"})+' · '+x.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true});}catch(e){dt='';}
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">'+
      '<div style="width:7px;height:7px;border-radius:50%;background:#2563eb;flex-shrink:0"></div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(iv.candidate||'Candidate')+'</div>'+
        '<div class="f12 text3">'+htmlEsc(dt)+(iv.interview_location?' · '+htmlEsc(iv.interview_location):'')+'</div>'+
      '</div>'+
    '</div>';
  }).join("");

  function tile(label,value,color){
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;text-align:center;min-width:105px;flex:1">'+
      '<div style="font-size:24px;font-weight:700;color:'+(color||'var(--text)')+'">'+value+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:2px;white-space:nowrap">'+label+'</div>'+
    '</div>';
  }

  return '<div class="page">'+
    '<div class="banner">'+
      '<div style="position:absolute;top:16px;right:20px;background:rgba(255,255,255,.18);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.3);border-radius:var(--r2);padding:10px 16px;text-align:right">'+
        '<div id="dash-clock-time" style="font-family:var(--display);font-size:13px;font-weight:500;letter-spacing:.01em;line-height:1;color:rgba(255,255,255,.85)">'+new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})+'</div>'+
        '<div id="dash-clock-date" style="font-size:22px;font-weight:700;margin-top:5px;color:#fff;font-family:var(--display)">'+new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})+'</div>'+
      '</div>'+
      '<div class="banner-name">'+greet+', '+u.name.split(" ")[0]+' 👋</div>'+
      '<div class="banner-sub">'+roleLabel(u.role)+'</div>'+
      '<div class="banner-stats">'+
        '<div><div class="bstat-val">'+(d.submissions_week||0)+'</div><div class="bstat-lbl">Subs this week</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+(d.submissions_month||0)+'</div><div class="bstat-lbl">Subs this month</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+interviews+'</div><div class="bstat-lbl">In interview</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+(bs['Placement']||0)+'</div><div class="bstat-lbl">Placements</div></div>'+
      '</div>'+
    '</div>'+

    renderNextActionsCard()+

    (loading?'<div class="card cp mb4" style="text-align:center;color:var(--text3);font-size:13px">Loading your desk…</div>':'')+

    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
      tile('My Jobs',(d.jobs&&d.jobs.total)||0,'var(--accent)')+
      tile('In Interview',interviews,'#2563eb')+
      tile('Offers',bs['Offer']||0,'#7c3aed')+
      tile('Placements',bs['Placement']||0,'var(--green)')+
      tile('Rejected',bs['Rejected']||0,'var(--red)')+
    '</div>'+

    renderRecruiterJobsCard(d)+

    '<div class="card cp mb4">'+
      '<div class="flex jb aic mb3">'+
        '<div><div class="fw6">My candidate pipeline</div><div class="f12 text3">All my submissions by stage</div></div>'+
      '</div>'+
      '<div class="flex gap2 flex-wrap">'+(stagePills||'<div class="text3 f13">No candidates in your pipeline yet — open My Jobs to start submitting.</div>')+'</div>'+
    '</div>'+

    renderRecentRejections(d)+

    '<div class="card cp">'+
      '<div class="flex jb aic mb3">'+
        '<div><div class="fw6">Upcoming interviews</div><div class="f12 text3">'+((d.upcoming_interviews||[]).length||'No')+' scheduled</div></div>'+
      '</div>'+
      (upcomingRows||'<div style="padding:16px 0;text-align:center;font-size:13px;color:var(--text3)">No interviews scheduled. Move a candidate to "Interview Scheduled" to see it here.</div>')+
    '</div>'+

    renderRemindersWidget()+

  '</div>';
}

// ── MANAGER / TEAM DASHBOARD ───────────────────────────────────────────
// For anyone who leads a desk or people (isManagerRole). Built on the real,
// now hierarchy-scoped /recruiting-dashboard endpoint plus the corrected team
// roster (direct reports on users.manager_id). Replaces the legacy lead-gen
// dashboard for these roles, which read the dead STATE.leads seed data.
var SCOPE_LABEL={own:'Your desk',team:"Your team's desk",org:'Org-wide · all desks'};
function renderManagerDashboard(u){
  recDashboardLoad();
  var d=STATE._recDash||{};
  var bs=d.by_stage||{};
  var interviews=(bs['Interview Scheduled']||0)+(bs['Interview Completed']||0);
  var loading=!d._at&&!d.empty;
  var scope=d.scope||'team';
  var team=getTeam(u); // direct reports
  var subtreeSize=reportingSubtree(u.id).length;

  var hour=new Date().getHours();
  var greet=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";

  // Team roster — the full reporting subtree (direct + transitive), rendered as
  // the nested org tree so a lead sees everyone under them, not just first-level
  // reports. Scrolls if it's tall. The team's real work numbers live below and on
  // the My Team page.
  var teamRows='<div style="max-height:320px;overflow:auto">'+
    team.slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');})
      .map(function(t){return renderOrgSubtree(t.id,{click:'none'});}).join('')+
    '</div>';
  var teamCard=team.length?
    '<div class="card cp mb4">'+
      '<div class="flex jb aic mb3">'+
        '<div><div class="fw6">Your team</div><div class="f12 text3">'+team.length+' direct report'+(team.length===1?'':'s')+' · '+subtreeSize+' in your reporting line</div></div>'+
        '<button class="btn btn-outline btn-sm" onclick="goPage(\'myteam\')">Open team view →</button>'+
      '</div>'+
      teamRows+
    '</div>'
  :'<div class="card cp mb4">'+
      '<div class="fw6" style="margin-bottom:2px">Your team</div>'+
      '<div class="f13 text3" style="padding:8px 0">No one reports to you yet. An admin sets reporting lines on the Admin → user page.</div>'+
    '</div>';

  var stagePills=Object.keys(bs).map(function(s){
    var cnt=bs[s];if(!cnt)return"";
    return '<div style="text-align:center;padding:12px 16px;background:var(--bg);border-radius:var(--r2);min-width:76px">'+
      '<div style="font-family:var(--display);font-size:22px;font-weight:700;color:'+recStageColor(s)+'">'+cnt+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+s+'</div>'+
    '</div>';
  }).join("");

  var upcomingRows=(d.upcoming_interviews||[]).map(function(iv){
    var dt;try{var x=new Date(iv.interview_at);dt=x.toLocaleDateString("en-IN",{day:"numeric",month:"short"})+' · '+x.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true});}catch(e){dt='';}
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">'+
      '<div style="width:7px;height:7px;border-radius:50%;background:#2563eb;flex-shrink:0"></div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(iv.candidate||'Candidate')+'</div>'+
        '<div class="f12 text3">'+htmlEsc(dt)+(iv.interview_location?' · '+htmlEsc(iv.interview_location):'')+'</div>'+
      '</div>'+
    '</div>';
  }).join("");

  function tile(label,value,color){
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;text-align:center;min-width:105px;flex:1">'+
      '<div style="font-size:24px;font-weight:700;color:'+(color||'var(--text)')+'">'+value+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:2px;white-space:nowrap">'+label+'</div>'+
    '</div>';
  }

  var scopeBadge='<span style="font-size:11px;font-weight:600;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);color:#fff;padding:3px 10px;border-radius:8px">'+(SCOPE_LABEL[scope]||'Your team')+(scope==='team'&&d.team_size?' · '+d.team_size+' people':'')+'</span>';

  return '<div class="page">'+
    '<div class="banner">'+
      '<div style="position:absolute;top:16px;right:20px;background:rgba(255,255,255,.18);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.3);border-radius:var(--r2);padding:10px 16px;text-align:right">'+
        '<div id="dash-clock-time" style="font-family:var(--display);font-size:13px;font-weight:500;letter-spacing:.01em;line-height:1;color:rgba(255,255,255,.85)">'+new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})+'</div>'+
        '<div id="dash-clock-date" style="font-size:22px;font-weight:700;margin-top:5px;color:#fff;font-family:var(--display)">'+new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})+'</div>'+
      '</div>'+
      '<div class="banner-name">'+greet+', '+u.name.split(" ")[0]+' 👋</div>'+
      '<div class="banner-sub" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+roleLabel(u.role)+scopeBadge+'</div>'+
      '<div class="banner-stats">'+
        '<div><div class="bstat-val">'+(d.submissions_week||0)+'</div><div class="bstat-lbl">Subs this week</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+(d.submissions_month||0)+'</div><div class="bstat-lbl">Subs this month</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+interviews+'</div><div class="bstat-lbl">In interview</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+(bs['Placement']||0)+'</div><div class="bstat-lbl">Placements</div></div>'+
      '</div>'+
    '</div>'+

    renderNextActionsCard()+

    (loading?'<div class="card cp mb4" style="text-align:center;color:var(--text3);font-size:13px">Loading your team\'s desk…</div>':'')+

    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
      tile('Jobs',(d.jobs&&d.jobs.total)||0,'var(--accent)')+
      tile('Awaiting approval',d.awaiting_approval||0,'var(--amber)')+
      tile('At Client',bs['Submitted to Client']||0,'var(--accent)')+
      tile('In Interview',interviews,'#2563eb')+
      tile('Offers',bs['Offer']||0,'#7c3aed')+
      tile('Placements',bs['Placement']||0,'var(--green)')+
    '</div>'+

    '<div class="card cp mb4">'+
      '<div class="flex jb aic mb3">'+
        '<div><div class="fw6">'+(scope==='org'?'Recruiting pipeline':"Your team's pipeline")+'</div><div class="f12 text3">Submissions by stage'+(scope==='team'?' across your reporting line':'')+'</div></div>'+
        '<button class="btn btn-outline btn-sm" onclick="goPage(\'reports\')">Full reports →</button>'+
      '</div>'+
      '<div class="flex gap2 flex-wrap">'+(stagePills||'<div class="text3 f13">No submissions in this scope yet.</div>')+'</div>'+
    '</div>'+

    teamCard+

    '<div class="card cp mb4">'+
      '<div class="flex jb aic mb3">'+
        '<div><div class="fw6">Upcoming interviews</div><div class="f12 text3">'+((d.upcoming_interviews||[]).length||'No')+' scheduled</div></div>'+
      '</div>'+
      (upcomingRows||'<div style="padding:16px 0;text-align:center;font-size:13px;color:var(--text3)">No interviews scheduled across your team yet.</div>')+
    '</div>'+

    renderRemindersWidget()+

  '</div>';
}

// ── INDIVIDUAL (RA) DASHBOARD ───────────────────────────────────────────
// For a plain "ra" (Research Analyst) with no reports — the last role that
// doesn't get a recruiter or manager/team dashboard. Built entirely from
// STATE.jobs, which GET /jobs already scopes server-side to "created_by me"
// for this role (routes/jobs.js) — the exact same data the Leads page uses.
// Real lead stages (Unassigned/Assigned/Connected/In Discussion/Rejected/
// Future), not the old demo "Positive/Negative" vocabulary from STATE.leads.
var LEAD_STAGE_COLORS=window.LEAD_STAGE_COLORS;
function jobsInPeriod(jobs,p){
  var now=new Date();
  return jobs.filter(function(j){
    var ds=j.created_date||(j.created_at||'').slice(0,10);
    if(!ds)return false;
    var d=new Date(ds);
    if(p==="daily")return ds===todayIST();
    if(p==="weekly"){var w=new Date(now);w.setDate(w.getDate()-7);return d>=w;}
    if(p==="monthly")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
    if(p==="quarterly"){var q=new Date(now);q.setMonth(q.getMonth()-3);return d>=q;}
    return true;
  });
}
function renderIndividualDashboard(u){
  var period=STATE.period||'weekly';
  var myJobs=getMyJobs(u);
  var pl=jobsInPeriod(myJobs,period);
  var total=pl.length;
  var dups=pl.filter(function(j){return j.is_duplicate;}).length;
  var converted=pl.filter(function(j){return j.stage==='Connected'||j.stage==='In Discussion';}).length;
  var convRate=total?Math.round(converted/total*100):0;

  var hour=new Date().getHours();
  var greet=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";

  var periods=["daily","weekly","monthly","quarterly"];
  var pickers=periods.map(function(p){
    return '<button class="fc'+(period===p?" on":"") + '" onclick="setPeriod(\''+p+'\')" style="text-transform:capitalize">'+p+'</button>';
  }).join("");

  // industry breakdown — real job.industry field, same one the Leads page uses
  var indMap={};
  pl.forEach(function(j){var ind=j.industry||j.company_ind||'';if(ind)indMap[ind]=(indMap[ind]||0)+1;});
  var indArr=Object.entries(indMap).sort(function(a,b){return b[1]-a[1]}).slice(0,7);
  var maxI=indArr.length?indArr[0][1]:1;
  var indRows=indArr.map(function(e){
    var pct=Math.round(e[1]/maxI*100);
    return '<div class="ind-row">'+
      '<div style="font-size:13px;min-width:110px">'+htmlEsc(e[0])+'</div>'+
      '<div class="ind-bg"><div class="ind-fill" style="width:'+pct+'%;background:var(--accent)"></div></div>'+
      '<div style="font-size:12px;font-family:var(--mono);color:var(--text3);min-width:22px;text-align:right">'+e[1]+'</div>'+
    '</div>';
  }).join("");

  // stage pills — real lead stages
  var stagePills=Object.keys(LEAD_STAGE_COLORS).map(function(s){
    var cnt=pl.filter(function(j){return j.stage===s;}).length;
    if(!cnt)return"";
    return '<div style="text-align:center;padding:12px 16px;background:var(--bg);border-radius:var(--r2);min-width:76px">'+
      '<div style="font-family:var(--display);font-size:22px;font-weight:700;color:'+LEAD_STAGE_COLORS[s]+'">'+cnt+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+s+'</div>'+
    '</div>';
  }).join("");

  // recent leads — quick jump to the Leads page for detail
  var recentRows=myJobs.slice().sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);}).slice(0,6).map(function(j){
    return '<div onclick="goPage(\'leads\')" onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'transparent\'" style="display:flex;align-items:center;gap:12px;padding:9px 4px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+htmlEsc(j.position||'')+'</div>'+
        '<div class="f12 text3" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+htmlEsc(j.company_name||'')+(j.location?' · '+htmlEsc(j.location):'')+'</div>'+
      '</div>'+
      '<span style="font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:8px;background:'+(LEAD_STAGE_COLORS[j.stage]||'var(--text3)')+'1a;color:'+(LEAD_STAGE_COLORS[j.stage]||'var(--text3)')+'">'+htmlEsc(j.stage||'')+'</span>'+
    '</div>';
  }).join("");

  return '<div class="page">'+
    '<div class="banner">'+
      '<div style="position:absolute;top:16px;right:20px;background:rgba(255,255,255,.18);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.3);border-radius:var(--r2);padding:10px 16px;text-align:right">'+
        '<div id="dash-clock-time" style="font-family:var(--display);font-size:13px;font-weight:500;letter-spacing:.01em;line-height:1;color:rgba(255,255,255,.85)">'+new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})+'</div>'+
        '<div id="dash-clock-date" style="font-size:22px;font-weight:700;margin-top:5px;color:#fff;font-family:var(--display)">'+new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})+'</div>'+
      '</div>'+
      '<div class="banner-name">'+greet+', '+u.name.split(" ")[0]+' 👋</div>'+
      '<div class="banner-sub">'+roleLabel(u.role)+'</div>'+
      '<div class="banner-stats">'+
        '<div><div class="bstat-val">'+total+'</div><div class="bstat-lbl">Leads this period</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+converted+'</div><div class="bstat-lbl">Connected</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+convRate+'%</div><div class="bstat-lbl">Conversion rate</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+dups+'</div><div class="bstat-lbl">Duplicates</div></div>'+
      '</div>'+
    '</div>'+

    renderNextActionsCard()+

    '<div class="flex gap2 mb4 flex-wrap">'+pickers+'</div>'+

    '<div class="g2 mb4">'+
      '<div class="card cp"><div class="flex jb aic mb3"><div class="fw6">Recent leads</div><button class="btn btn-outline btn-sm" onclick="goPage(\'leads\')">All leads →</button></div>'+(recentRows||'<div class="text3 f13" style="padding:8px 0">No leads yet — add one from the Leads page.</div>')+'</div>'+
      '<div class="card cp"><div class="fw6 mb3">Industry breakdown</div>'+(indRows||'<div class="text3 f13">No leads yet</div>')+'</div>'+
    '</div>'+

    '<div class="card cp"><div class="flex jb aic mb3"><div class="fw6">Pipeline overview</div><div class="f12 text3">'+period+'</div></div><div class="flex gap2 flex-wrap">'+(stagePills||'<div class="text3 f13">No leads in this period yet.</div>')+'</div></div>'+

    renderRemindersWidget()+

  '</div>';
}

function filterPeriod(leads,p){
  var now=new Date();
  return leads.filter(function(l){
    var d=new Date(l.date);
    if(p==="daily")return l.date===todayIST();
    if(p==="weekly"){var w=new Date(now);w.setDate(w.getDate()-7);return d>=w;}
    if(p==="monthly")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
    if(p==="quarterly"){var q=new Date(now);q.setMonth(q.getMonth()-3);return d>=q;}
    return true;
  });
}

