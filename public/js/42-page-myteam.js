// ===== MY TEAM PAGE (additive) =====
// For any user with at least one direct report on the flexible reporting
// hierarchy (users.manager_id) — the gate is DATA-DRIVEN (having reports), not
// role-based, matching the "flexible, not a fixed ladder" design. A BD Lead
// with reports sees it; a BD Lead with none doesn't; an RA given a report by an
// admin does. Shows the full reporting subtree rooted at the viewer plus their
// team's real, hierarchy-scoped recruiting snapshot (GET /recruiting-dashboard,
// which the backend already scopes to the caller's reporting chain).
//
// Reparenting stays admin-only (Admin → user → Reporting Hierarchy). This page
// is a read view of a manager's own team; it deliberately has no write action.

(function () {
  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  // Data-driven gate: does anyone report to this user?
  function leadsATeam(u){ return !!(u && window.directReportsOf && directReportsOf(u.id).length); }

  // ── nav + routing (wrap, like the reports/clients modules) ───────────────────
  // Drawn by the shell (UI.registerPage below) — no second repaint per render.
  // (The "My Team" nav item is now built by the sidebar in 04-shell-login.js —
  // same data-driven gate: shown to anyone with at least one direct report.)
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p==='myteam'){ STATE.page='myteam'; STATE.modal=null; render(); if(window.recDashboardLoad) recDashboardLoad(); ensureReports(); return; }
    // Team Insights and Reports are now tabs inside My Team. For anyone who leads
    // a team, redirect their legacy routes into the hub so every old "Full
    // reports →" / "Team Insights" link keeps working. Users WITHOUT a team keep
    // the standalone pages (they have no My Team hub).
    if (p==='reports' && leadsATeam(STATE.user)){ STATE.page='myteam'; STATE.myteamTab='reports'; STATE.modal=null; render(); if(window.recDashboardLoad) recDashboardLoad(); ensureReports(); return; }
    if (p==='bdleadinsights' && leadsATeam(STATE.user)){ STATE.page='myteam'; STATE.myteamTab='insights'; STATE.modal=null; render(); if(window.recDashboardLoad) recDashboardLoad(); return; }
    return _prevGoPage.apply(this, arguments);
  };
  function paint(){ if(STATE.page!=='myteam')return; paintPageContent(); }
  UI.registerPage('myteam', function(){ return renderMyTeam(); });

  // Tab switch within the hub. The Reports tab lazy-loads /reports/recruiting.
  window.myteamTab = function(t){ STATE.myteamTab=t; if(t==='reports') ensureReports(); paint(); };

  // Fetch the recruiting report once for the Reports tab (mirrors 39's loader
  // but repaints THIS page). STATE.reports is created by 39-page-reports.js.
  function ensureReports(){
    if(!window.renderReportsBody) return;
    STATE.reports = STATE.reports || { loading:false, data:null };
    if(STATE.reports.data || STATE.reports.loading) return;
    STATE.reports.loading = true;
    apiGet('/reports/recruiting').then(function(d){ STATE.reports.data=d||null; STATE.reports.loading=false; if(STATE.page==='myteam') paint(); })
      .catch(function(){ STATE.reports.loading=false; if(STATE.page==='myteam') paint(); });
  }

  function snapshotCard(){
    var d=STATE._recDash||{};
    var bs=d.by_stage||{};
    var interviews=(bs['Interview Scheduled']||0)+(bs['Interview Completed']||0);
    var loading=!d._at&&!d.empty;
    function tile(label,value,color){
      return '<div class="dash-tile">'+
        '<div style="font-size:24px;font-weight:700;color:'+(color||'var(--text)')+'">'+(value||0)+'</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:2px;white-space:nowrap">'+esc(label)+'</div>'+
      '</div>';
    }
    var stagePills=Object.keys(bs).map(function(s){
      var cnt=bs[s]; if(!cnt)return'';
      var color=(window.recStageColor?recStageColor(s):'var(--text)');
      return '<div style="text-align:center;padding:10px 14px;background:var(--bg);border-radius:var(--r2);min-width:74px">'+
        '<div style="font-family:var(--display);font-size:20px;font-weight:700;color:'+color+'">'+cnt+'</div>'+
        '<div style="font-size:10.5px;color:var(--text3);margin-top:2px">'+esc(s)+'</div>'+
      '</div>';
    }).join('');
    return '<div class="card cp mb4">'+
      '<div class="flex jb aic mb3"><div><div class="fw6">Your team’s work</div>'+
        '<div class="f12 text3">Live recruiting numbers across everyone in your reporting line</div></div>'+
        '<button class="btn btn-outline btn-sm" onclick="myteamTab(\'reports\')">Full reports →</button></div>'+
      (loading?'<div style="text-align:center;color:var(--text3);font-size:13px;padding:8px 0">Loading…</div>':
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">'+
          tile('Subs this week',d.submissions_week,'var(--accent)')+
          tile('Subs this month',d.submissions_month,'var(--accent)')+
          tile('In interview',interviews,'#2563eb')+
          tile('Awaiting approval',d.awaiting_approval,'var(--amber)')+
          tile('Placements',bs['Placement'],'var(--green)')+
        '</div>'+
        '<div class="flex gap2 flex-wrap">'+(stagePills||'<div class="text3 f13">No submissions across your team yet.</div>')+'</div>')+
    '</div>';
  }

  // Tab bar for the hub. Reports is a tab only when the reports module is loaded.
  function tabBar(active){
    var tabs=[['overview','Overview'],['insights','Team Insights']];
    if(window.renderReportsBody) tabs.push(['reports','Reports']);
    return '<div style="display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--border);flex-wrap:wrap">'+
      tabs.map(function(t){
        var on=active===t[0];
        return '<button onclick="myteamTab(\''+t[0]+'\')" style="background:none;border:0;border-bottom:2px solid '+(on?'var(--accent)':'transparent')+';color:'+(on?'var(--text)':'var(--text3)')+';font-weight:'+(on?700:500)+';font-size:13.5px;padding:8px 12px;cursor:pointer;margin-bottom:-1px">'+t[1]+'</button>';
      }).join('')+
    '</div>';
  }

  window.myteamChartView = function(m){ STATE.myteamChart=m; paint(); };
  function overviewBody(u){
    var mode=STATE.myteamChart||'list';
    var toggle='<div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:3px">'+
      [['list','List'],['chart','Org chart']].map(function(t){var on=mode===t[0];return '<button onclick="myteamChartView(\''+t[0]+'\')" style="border:0;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;background:'+(on?'var(--accent)':'transparent')+';color:'+(on?'#fff':'var(--text2)')+'">'+t[1]+'</button>';}).join('')+'</div>';
    var struct=mode==='chart'?renderOrgChartH(u.id):renderOrgSubtree(u.id,{click:'activity'});
    return snapshotCard()+
      '<div class="card cp">'+
        '<div class="flex jb aic mb3"><div><div class="fw6">Reporting structure</div>'+
          '<div class="f12 text3">Everyone under you. Click a person to see their recent activity.</div></div>'+toggle+'</div>'+
        struct+
      '</div>';
  }

  // Per-member activity slide-in (from GET /team/activity).
  window.openTeamActivity = function(userId){
    STATE.myteamActivity={ userId:userId, loading:true, data:null };
    if(STATE.page!=='myteam'){ STATE.page='myteam'; render(); } else paint();
    apiGet('/team/activity?user_id='+encodeURIComponent(userId)+'&limit=60')
      .then(function(d){ STATE.myteamActivity={userId:userId,loading:false,data:(d&&d.activity)||[]}; if(STATE.page==='myteam')paint(); })
      .catch(function(){ STATE.myteamActivity={userId:userId,loading:false,data:[]}; if(STATE.page==='myteam')paint(); });
  };
  window.closeTeamActivity = function(){ STATE.myteamActivity=null; paint(); };
  function activityPanel(){
    var a=STATE.myteamActivity; if(!a||!a.userId)return'';
    var user=(STATE.users||[]).find(function(x){return x.id===a.userId;});
    var rows = a.loading ? '<div style="padding:34px;text-align:center;color:var(--text3);font-size:13px">Loading activity…</div>'
      : (!a.data||!a.data.length) ? '<div style="padding:34px;text-align:center;color:var(--text3);font-size:13px">No recent activity recorded.</div>'
      : a.data.map(function(ev){
          var when=''; try{ var x=new Date(ev.at); when=x.toLocaleDateString('en-IN',{day:'numeric',month:'short'})+' · '+x.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }catch(e){}
          var dot=ev.kind==='submission'?'var(--accent)':'#2563eb';
          return '<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">'+
            '<div style="width:7px;height:7px;border-radius:50%;background:'+dot+';margin-top:6px;flex-shrink:0"></div>'+
            '<div style="flex:1;min-width:0"><div style="font-size:13px">'+esc(ev.detail||'')+(ev.candidate?' — <b>'+esc(ev.candidate)+'</b>':'')+'</div>'+
              '<div style="font-size:11px;color:var(--text3)">'+esc(when)+(ev.job?' · '+esc(ev.job):'')+'</div>'+
              (ev.note?'<div style="font-size:11.5px;color:var(--text2);margin-top:2px">'+esc(ev.note)+'</div>':'')+'</div>'+
          '</div>';
        }).join('');
    return '<div onclick="closeTeamActivity()" style="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100"></div>'+
      '<div style="position:fixed;top:0;right:0;bottom:0;width:min(440px,92vw);background:var(--card);border-left:1px solid var(--border);z-index:101;box-shadow:-8px 0 24px rgba(0,0,0,.14);display:flex;flex-direction:column">'+
        '<div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'+
          '<div><div style="font-weight:700;font-size:15px">'+esc(user?user.name:'Activity')+'</div><div style="font-size:12px;color:var(--text3)">Recent activity</div></div>'+
          '<button onclick="closeTeamActivity()" style="border:0;background:none;font-size:24px;cursor:pointer;color:var(--text3);line-height:1">×</button>'+
        '</div>'+
        '<div style="flex:1;overflow:auto;padding:6px 18px 18px">'+rows+'</div>'+
      '</div>';
  }

  window.renderMyTeam = function(){
    var u=STATE.user;
    if(!leadsATeam(u)) return '<div class="page"><div style="font-size:18px;font-weight:700;margin-bottom:6px">My Team</div>'+
      '<div style="text-align:center;padding:50px;color:var(--text3)">No one reports to you yet.</div></div>';
    var directCount=directReportsOf(u.id).length;
    var totalCount=reportingSubtree(u.id).length;
    var tab=STATE.myteamTab||'overview';
    if(tab==='reports'&&!window.renderReportsBody) tab='overview';
    var body;
    if(tab==='insights') body=(window.renderTeamInsightsBody?renderTeamInsightsBody():'');
    else if(tab==='reports') body=(window.renderReportsBody?renderReportsBody():'');
    else body=overviewBody(u);
    return '<div class="page">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
        '<div><div style="font-size:18px;font-weight:700">My Team</div>'+
          '<div style="font-size:12.5px;color:var(--text3)">'+directCount+' direct report'+(directCount===1?'':'s')+' · '+totalCount+' in your reporting line</div></div>'+
      '</div>'+
      tabBar(tab)+
      body+
    '</div>'+activityPanel();
  };
})();
