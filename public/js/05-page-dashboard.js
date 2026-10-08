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
// hierarchy-scoped team dashboard, built on /recruiting-dashboard.
function isManagerRole(u){
  return userHasAnyRole(u,'admin','bd','bd_lead','associate_director','director','ra_lead');
}

function renderDashboard(){
  // Support "view as" — admin/BD can click a team member to see their dashboard.
  var u=STATE.viewingUser||STATE.user;
  var isViewingOther=STATE.viewingUser&&STATE.viewingUser.id!==STATE.user.id;

  // "What needs you today" — loaded once per dashboard visit. A "view as"
  // preview must not fetch the viewer's own queue and label it someone else's.
  if(!isViewingOther&&STATE.nextActions===undefined)loadNextActions();
  // A dead mailbox sign-in (R-037): per-user, never for a "view as" preview.
  if(!isViewingOther&&STATE.mailboxAlerts===undefined&&window.loadMailboxAlerts)loadMailboxAlerts();
  // Client conversations + the manager's facts-only team roll-up (D-0040/D-0043).
  if(!isViewingOther&&STATE.clientDigest===undefined&&window.loadClientDigest)loadClientDigest();
  // The morning briefing is ORG-WIDE, not per-user — unlike next-actions it
  // reads the same for the viewer and the viewed person, so it must load even
  // while "view as" is open. Gating it on isViewingOther left the card stuck
  // on "Working out what came in today…" forever whenever a manager opened
  // "view as" before ever loading their own dashboard this session (C-0008).
  if(STATE.briefing===undefined)loadMorningBriefing();
  // Take-over requests (R-047) — per-user, like next-actions: a "view as"
  // preview must not fetch the viewer's own waiting/mine lists and label them
  // as someone else's.
  if(!isViewingOther&&typeof loadOwnershipWaiting==='function'&&STATE.otWaiting===undefined)loadOwnershipWaiting();
  if(!isViewingOther&&typeof loadOwnershipMine==='function'&&STATE.otMine===undefined)loadOwnershipMine();

  // Recruiters live in the recruiting workflow (jobs, candidates, interviews) —
  // lead-gen widgets are someone else's desk. Give them their own dashboard.
  if(isPureRecruiter(u))return withDashReports(renderRecruiterDashboard(u),isViewingOther);

  // Managers get the team dashboard (team roster + the team's recruiting desk,
  // from the live hierarchy-scoped endpoint). Data-driven: a plain "ra"/"bd"
  // who has been given reports also qualifies, not just the manager-ish roles.
  // Not for a "view as" preview — that endpoint answers for whoever is holding
  // the session, so it would show the viewer's numbers under someone else's name.
  if(!isViewingOther&&(isManagerRole(u)||getTeam(u).length))return withDashReports(renderManagerDashboard(u),isViewingOther);

  // Everyone else — and every "view as" preview — gets the individual
  // dashboard, which is built on STATE.jobs and filters by the user it is
  // handed, so previewing somebody else's desk shows THEIR jobs.
  //
  // There used to be a fourth branch here: a ~150-line lead-gen dashboard
  // reading STATE.leads. That collection was only ever filled by the guest
  // demo's generated data, so for every real login it rendered a wall of
  // zeroes. It went with the demo data.
  return withDashReports(renderIndividualDashboard(u),isViewingOther);
}

// ── REPORTS, ON THE DASHBOARD (R-006) ─────────────────────────────────────
// The owner asked for reports to be part of the Dashboard itself rather than a
// separate screen. This is the SAME report the Reports page and My Team's tab
// draw (renderReportsBody, 39-page-reports.js; GET /reports/recruiting, already
// scoped own / team / org) — one implementation, placed at the foot of every
// dashboard. Loaded once per session, like the page it replaces. Not for a
// "view as" preview: that endpoint answers for whoever holds the session.
function withDashReports(html,isViewingOther){
  var u=STATE.user;
  if(isViewingOther||!window.renderReportsBody||!userHasAnyRole(u,'admin','bd','bd_lead','ra_lead','recruiter'))return html;
  STATE.reports=STATE.reports||{loading:false,data:null};
  if(!STATE.reports.data&&!STATE.reports.loading&&!STATE.reports._dashTried&&window.reportsLoadQuiet){ STATE.reports._dashTried=true; setTimeout(reportsLoadQuiet,0); }
  // A fault in the report must never take the whole Dashboard down with it.
  var body;
  try{ body=renderReportsBody({noPeople:true}); }
  catch(e){ body='<div class="dt-empty">The reports could not be drawn just now.</div>'; }
  // The per-person table is not on Today (owner, 6 Oct) — a team lead is pointed to where it is.
  var leads=!!(window.directReportsOf&&directReportsOf(u.id).length);
  var pointer=leads?'<div class="dash-rep-more"><a onclick="goPage(\'reports\')">Numbers by person are in My Team \u2192 Reports \u2192</a></div>':'';
  var section='<div id="dash-reports" class="card cp mt4 dash-reports">'+
    '<div class="fw6 mb3">Reports</div>'+body+pointer+'</div>';
  // Inside the page's own wrapper, so it takes the page's width and padding.
  return html.replace(/<\/div>\s*$/, section+'</div>');
}
window.dashScrollToReports=function(){
  var go=function(){ var el=document.getElementById('dash-reports'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); };
  if(STATE.page!=='dashboard'){ goPage('dashboard'); setTimeout(go,150); } else go();
};

// ── NO REMINDERS BOX ON TODAY (R-122 step 3) ─────────────────────────────────
// The dashboards used to carry a second "Reminders" card under "Needs you today".
// Every due reminder is ALREADY a row in "Needs you today" (a "Reminder" row with
// its own Write / Done), so the same task showed up twice and the page read as
// crowded. The owner had the card removed. Reminders still live on the Reminders
// page (the bell, the sidebar), and "N PAST DUE" in the header still links there.

// ── RECRUITER DASHBOARD ────────────────────────────────────────────────
// A recruiter's day is jobs, candidates and interviews — not lead-gen. This
// view is built from GET /recruiting-dashboard (same cache the "my desk"
// strip uses, so no duplicate fetches) plus the shared reminders widget.
function recDashboardLoad(){
  if(STATE._recDashLoading)return;
  var fresh=STATE._recDash&&(Date.now()-STATE._recDash._at<60000);
  if(fresh)return;
  STATE._recDashLoading=true;
  apiGet(withTz('/recruiting-dashboard')).then(function(d){
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
      '<div class="fs-20 c-accent" style="font-family:var(--display);font-weight:700">'+(value||0)+'</div>'+
      '<div class="fs-10_5 c-text3" style="margin-top:2px;white-space:nowrap">'+label+'</div>'+
    '</div>';
  }

  var rows=top.map(function(j){
    var loc=[j.city,j.state].filter(Boolean).join(', ');
    var hot=j.team_subs_14d>0;
    var pr=j.priority&&j.priority!=='Normal'?'<span class="fs-10 c-red" style="font-weight:700;background:var(--red-l);padding:2px 7px;border-radius:8px;margin-left:6px">'+htmlEsc(j.priority)+'</span>':'';
    return '<div onclick="bdOpenSubmissions(\''+j.id+'\')" onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'transparent\'" style="display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s">'+
      '<div style="flex:1;min-width:0">'+
        '<div class="fs-13_5" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(j.job_title||'')+pr+'</div>'+
        '<div class="f12 text3" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(j.job_code||'')+(j.client?' · '+htmlEsc(j.client):'')+(loc?' · '+htmlEsc(loc):'')+'</div>'+
      '</div>'+
      '<div style="text-align:center;width:88px;flex-shrink:0">'+
        '<div class="fs-16" style="font-family:var(--display);font-weight:700;color:'+(hot?'var(--green)':'var(--text3)')+'">'+(j.team_subs_14d||0)+'</div>'+
        '<div class="fs-10 c-text3">team · 14d</div>'+
      '</div>'+
      '<div style="text-align:center;width:70px;flex-shrink:0">'+
        '<div class="fs-16 c-accent" style="font-family:var(--display);font-weight:700">'+(j.my_subs||0)+'</div>'+
        '<div class="fs-10 c-text3">my subs</div>'+
      '</div>'+
      '<div class="c-text3 fs-13" style="width:16px;text-align:center;flex-shrink:0">›</div>'+
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
      '<div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Most active — team submissions, last 14 days</div>'+rows
    :'<div class="fs-13 c-text3" style="padding:12px 0;text-align:center">No jobs on your desk yet — your BD manager assigns them to you.</div>')+
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
        '<span class="fs-13" style="font-weight:600">'+htmlEsc(r.candidate||'Candidate')+'</span>'+
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
      '<div class="fs-22" style="font-family:var(--display);font-weight:700;color:'+recStageColor(s)+'">'+cnt+'</div>'+
      '<div class="fs-11 c-text3" style="margin-top:2px">'+s+'</div>'+
    '</div>';
  }).join("");

  var upcomingRows=(d.upcoming_interviews||[]).map(function(iv){
    var dt;try{var x=new Date(iv.interview_at);dt=x.toLocaleDateString("en-IN",{day:"numeric",month:"short"})+' · '+x.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true});}catch(e){dt='';}
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">'+
      '<div style="width:7px;height:7px;border-radius:50%;background:#2563eb;flex-shrink:0"></div>'+
      '<div style="flex:1;min-width:0">'+
        '<div class="fs-13_5" style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(iv.candidate||'Candidate')+'</div>'+
        '<div class="f12 text3">'+htmlEsc(dt)+(iv.interview_location?' · '+htmlEsc(iv.interview_location):'')+'</div>'+
      '</div>'+
    '</div>';
  }).join("");

  function tile(label,value,color){
    return '<div class="dash-tile">'+
      '<div class="dash-tile-v" style="color:'+(color||'var(--text)')+'">'+value+'</div>'+
      '<div class="dash-tile-l">'+label+'</div>'+
    '</div>';
  }

  return '<div class="page">'+
    '<div class="banner">'+
      '<div class="banner-clock">'+
        '<div id="dash-clock-time" class="bclock-time">'+new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})+'</div>'+
        '<div id="dash-clock-date" class="bclock-date">'+new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})+'</div>'+
      '</div>'+
      '<div class="banner-name">'+greet+', '+u.name.split(" ")[0]+' 👋</div>'+
      '<div class="banner-sub">'+roleLabel(u.role)+'</div>'+
      '<div class="banner-stats">'+
        '<div><div class="bstat-val">'+(d.submissions_week||0)+'</div><div class="bstat-lbl">To BDM this week</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+(d.submissions_month||0)+'</div><div class="bstat-lbl">To BDM this month</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+interviews+'</div><div class="bstat-lbl">In interview</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+(bs['Placement']||0)+'</div><div class="bstat-lbl">Placements</div></div>'+
      '</div>'+
    '</div>'+

    renderMorningBriefingCard()+

    (window.renderMailboxAlerts?renderMailboxAlerts():'')+
    (window.renderMySetupCard?renderMySetupCard():'')+
    renderNextActionsCard()+
    (window.renderClientDigest?renderClientDigest():'')+
    (typeof renderOwnershipSummaryCard==='function'?renderOwnershipSummaryCard():'')+

    (loading?'<div class="card cp mb4 c-text3 fs-13" style="text-align:center">Loading your desk…</div>':'')+

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
      (upcomingRows||'<div class="fs-13 c-text3" style="padding:16px 0;text-align:center">No interviews scheduled. Move a candidate to "Interview Scheduled" to see it here.</div>')+
    '</div>'+


  '</div>';
}

// ── MANAGER / TEAM DASHBOARD ───────────────────────────────────────────
// For anyone who leads a desk or people (isManagerRole). Built on the real,
// now hierarchy-scoped /recruiting-dashboard endpoint. Replaces the legacy
// lead-gen dashboard for these roles, which read the dead STATE.leads seed
// data. The team roster is NOT drawn here — it is the My Team page (R-072).
var SCOPE_LABEL={own:'Your desk',team:"Your team's desk",org:'Org-wide · all desks'};
function renderManagerDashboard(u){
  recDashboardLoad();
  var d=STATE._recDash||{};
  var bs=d.by_stage||{};
  var interviews=(bs['Interview Scheduled']||0)+(bs['Interview Completed']||0);
  var loading=!d._at&&!d.empty;
  var scope=d.scope||'team';

  var hour=new Date().getHours();
  var greet=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";

  // There used to be a "Your team" card here — the org-tree roster with "Open
  // team view →", or "No one reports to you yet". The owner asked for it gone
  // (R-072, D-0056/D-0059): the team view lives on the My Team page, which has
  // its own nav item. Nothing else on this dashboard changed.

  var upcomingRows=(d.upcoming_interviews||[]).map(function(iv){
    var dt;try{var x=new Date(iv.interview_at);dt=x.toLocaleDateString("en-IN",{day:"numeric",month:"short"})+' · '+x.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true});}catch(e){dt='';}
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">'+
      '<div style="width:7px;height:7px;border-radius:50%;background:#2563eb;flex-shrink:0"></div>'+
      '<div style="flex:1;min-width:0">'+
        '<div class="fs-13_5" style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(iv.candidate||'Candidate')+'</div>'+
        '<div class="f12 text3">'+htmlEsc(dt)+(iv.interview_location?' · '+htmlEsc(iv.interview_location):'')+'</div>'+
      '</div>'+
    '</div>';
  }).join("");

  function tile(label,value,color){
    return '<div class="dash-tile">'+
      '<div class="dash-tile-v" style="color:'+(color||'var(--text)')+'">'+value+'</div>'+
      '<div class="dash-tile-l">'+label+'</div>'+
    '</div>';
  }

  var scopeBadge='<span class="banner-chip">'+(SCOPE_LABEL[scope]||'Your team')+(scope==='team'&&d.team_size?' · '+d.team_size+' people':'')+'</span>';

  return '<div class="page">'+
    '<div class="banner">'+
      '<div class="banner-clock">'+
        '<div id="dash-clock-time" class="bclock-time">'+new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})+'</div>'+
        '<div id="dash-clock-date" class="bclock-date">'+new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})+'</div>'+
      '</div>'+
      '<div class="banner-name">'+greet+', '+u.name.split(" ")[0]+' 👋</div>'+
      '<div class="banner-sub" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+roleLabel(u.role)+scopeBadge+'</div>'+
      '<div class="banner-stats">'+
        '<div><div class="bstat-val">'+(d.submissions_week||0)+'</div><div class="bstat-lbl">To BDM this week</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+(d.submissions_month||0)+'</div><div class="bstat-lbl">To BDM this month</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+interviews+'</div><div class="bstat-lbl">In interview</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+(bs['Placement']||0)+'</div><div class="bstat-lbl">Placements</div></div>'+
      '</div>'+
    '</div>'+

    renderMorningBriefingCard()+

    (window.renderMailboxAlerts?renderMailboxAlerts():'')+
    (window.renderMySetupCard?renderMySetupCard():'')+
    renderNextActionsCard()+
    (window.renderClientDigest?renderClientDigest():'')+
    (typeof renderOwnershipSummaryCard==='function'?renderOwnershipSummaryCard():'')+

    (loading?'<div class="card cp mb4 c-text3 fs-13" style="text-align:center">Loading your team\'s desk…</div>':'')+

    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
      tile('Jobs',(d.jobs&&d.jobs.total)||0,'var(--accent)')+
      tile('Awaiting approval',d.awaiting_approval||0,'var(--amber)')+
      tile('At Client',bs['Submitted to Client']||0,'var(--accent)')+
      tile('In Interview',interviews,'#2563eb')+
      tile('Offers',bs['Offer']||0,'#7c3aed')+
      tile('Placements',bs['Placement']||0,'var(--green)')+
    '</div>'+

    // No "team's pipeline" card (D-0077): it showed the same stage counts as the
    // Reports funnel below (and counted Sourced/Screening, which is inventory, as
    // if it were the team's output). One place says it: the funnel, in Reports.
    '<div class="card cp mb4">'+
      '<div class="flex jb aic mb3">'+
        '<div><div class="fw6">Upcoming interviews</div><div class="f12 text3">'+((d.upcoming_interviews||[]).length||'No')+' scheduled</div></div>'+
      '</div>'+
      (upcomingRows||'<div class="fs-13 c-text3" style="padding:16px 0;text-align:center">No interviews scheduled across your team yet.</div>')+
    '</div>'+


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
// R-106 (D-0065): every figure on this card — the banner, the industry bars, the stage pills — comes
// from the server's ONE RA calculation (GET /insights/ra/:id → `periods`, services/ra-insights.js), cut
// at the viewer's own midnight. This screen used to add up whatever jobs the page happened to hold, in a
// different time zone and with an eight-day "week". It only draws now; a list of recent leads below is
// still the browser's, because a list is not a number.
function raDashFor(u){
  var c=STATE._raDash=STATE._raDash||{};
  var e=c[u.id];
  var stale=e&&e.data&&!e.loading&&(Date.now()-e.at>60000);
  if(!e||stale){
    c[u.id]=Object.assign({},e||{},{loading:true});
    apiGet(withTz('/insights/ra/'+encodeURIComponent(u.id))).then(function(d){c[u.id]={data:d,at:Date.now()};scheduleRender();})
      .catch(function(err){c[u.id]={error:(err&&err.message)||'Could not load',at:Date.now()};scheduleRender();});
  }
  return c[u.id];
}
function renderIndividualDashboard(u){
  var period=STATE.period||'weekly';
  var myJobs=getMyJobs(u);
  var rd=raDashFor(u);
  var P=rd&&rd.data&&rd.data.periods&&rd.data.periods[period];
  var ready=!!P;
  P=P||{total:0,dups:0,converted:0,convRate:0,by_stage:{},by_industry:{}};
  var total=P.total,dups=P.dups,converted=P.converted,convRate=P.convRate;
  var shown=function(v,suffix){return ready?(v+(suffix||'')):(rd&&rd.error?'\u2014':'\u2026');};

  var hour=new Date().getHours();
  var greet=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";

  var periods=["daily","weekly","monthly","quarterly"];
  var pickers=periods.map(function(p){
    return '<button class="fc'+(period===p?" on":"") + '" onclick="setPeriod(\''+p+'\')" style="text-transform:capitalize">'+p+'</button>';
  }).join("");

  // industry breakdown — real job.industry field, same one the Leads page uses
  var indArr=Object.entries(P.by_industry||{}).sort(function(a,b){return b[1]-a[1]}).slice(0,7);
  var maxI=indArr.length?indArr[0][1]:1;
  var indRows=indArr.map(function(e){
    var pct=Math.round(e[1]/maxI*100);
    return '<div class="ind-row">'+
      '<div class="fs-13" style="min-width:110px">'+htmlEsc(e[0])+'</div>'+
      '<div class="ind-bg"><div class="ind-fill" style="width:'+pct+'%;background:var(--accent)"></div></div>'+
      '<div class="fs-12 c-text3" style="font-family:var(--mono);min-width:22px;text-align:right">'+e[1]+'</div>'+
    '</div>';
  }).join("");

  // stage pills — real lead stages
  var stagePills=Object.keys(LEAD_STAGE_COLORS).map(function(s){
    var cnt=(P.by_stage||{})[s]||0;
    if(!cnt)return"";
    return '<div style="text-align:center;padding:12px 16px;background:var(--bg);border-radius:var(--r2);min-width:76px">'+
      '<div class="fs-22" style="font-family:var(--display);font-weight:700;color:'+LEAD_STAGE_COLORS[s]+'">'+cnt+'</div>'+
      '<div class="fs-11 c-text3" style="margin-top:2px">'+s+'</div>'+
    '</div>';
  }).join("");

  // recent leads — quick jump to the Leads page for detail
  var recentRows=myJobs.slice().sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);}).slice(0,6).map(function(j){
    return '<div onclick="goPage(\'leads\')" onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'transparent\'" style="display:flex;align-items:center;gap:12px;padding:9px 4px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s">'+
      '<div style="flex:1;min-width:0">'+
        '<div class="fs-13" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+htmlEsc(j.position||'')+'</div>'+
        '<div class="f12 text3" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+htmlEsc(j.company_name||'')+(j.location?' · '+htmlEsc(j.location):'')+'</div>'+
      '</div>'+
      '<span class="fs-10_5" style="font-weight:700;padding:2px 8px;border-radius:8px;background:'+(LEAD_STAGE_COLORS[j.stage]||'var(--text3)')+'1a;color:'+(LEAD_STAGE_COLORS[j.stage]||'var(--text3)')+'">'+htmlEsc(j.stage||'')+'</span>'+
    '</div>';
  }).join("");

  return '<div class="page">'+
    '<div class="banner">'+
      '<div class="banner-clock">'+
        '<div id="dash-clock-time" class="bclock-time">'+new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})+'</div>'+
        '<div id="dash-clock-date" class="bclock-date">'+new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})+'</div>'+
      '</div>'+
      '<div class="banner-name">'+greet+', '+u.name.split(" ")[0]+' 👋</div>'+
      '<div class="banner-sub">'+roleLabel(u.role)+'</div>'+
      '<div class="banner-stats">'+
        '<div><div class="bstat-val">'+shown(total)+'</div><div class="bstat-lbl">Leads this period</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+shown(converted)+'</div><div class="bstat-lbl">Connected</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+shown(convRate,'%')+'</div><div class="bstat-lbl">Conversion rate</div></div>'+
        '<div style="width:1px;background:rgba(255,255,255,.25);align-self:stretch"></div>'+
        '<div><div class="bstat-val">'+shown(dups)+'</div><div class="bstat-lbl">Duplicates</div></div>'+
      '</div>'+
    '</div>'+

    renderMorningBriefingCard()+

    (window.renderMailboxAlerts?renderMailboxAlerts():'')+
    (window.renderMySetupCard?renderMySetupCard():'')+
    renderNextActionsCard()+
    (window.renderClientDigest?renderClientDigest():'')+
    (typeof renderOwnershipSummaryCard==='function'?renderOwnershipSummaryCard():'')+

    '<div class="flex gap2 mb4 flex-wrap">'+pickers+'</div>'+

    '<div class="g2 mb4">'+
      '<div class="card cp"><div class="flex jb aic mb3"><div class="fw6">Recent leads</div><button class="btn btn-outline btn-sm" onclick="goPage(\'leads\')">All leads →</button></div>'+(recentRows||'<div class="text3 f13" style="padding:8px 0">No leads yet — add one from the Leads page.</div>')+'</div>'+
      '<div class="card cp"><div class="fw6 mb3">Industry breakdown</div>'+(indRows||'<div class="text3 f13">No leads yet</div>')+'</div>'+
    '</div>'+

    '<div class="card cp"><div class="flex jb aic mb3"><div class="fw6">Pipeline overview</div><div class="f12 text3">'+period+'</div></div><div class="flex gap2 flex-wrap">'+(stagePills||'<div class="text3 f13">No leads in this period yet.</div>')+'</div></div>'+


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

