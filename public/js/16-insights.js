// ════════════════════════════════════════════════
// INSIGHTS TAB — RA activity + RA Lead team view
// ════════════════════════════════════════════════
function renderInsights(){
  var u=STATE.user;
  var isRALead=(u.role==='ra_lead'||u.role==='admin');
  var selectedRA=STATE.insightsSelectedRA;
  var data=STATE.insightsData;

  // Admin: show RA/BD team switcher
  var isAdmin=userHasRole(u,'admin');
  var insightsTeam=STATE.insightsTeam||'ra';

  // Admin BD Team view
  if(isAdmin&&insightsTeam==='bd'&&!selectedRA){
    var allBDs=STATE.users.filter(function(x){return userHasRole(x,'bd')||userHasRole(x,'bd_lead');});
    var allJobs=STATE.jobs;
    function jAtBD(j){return j.assigned_at?new Date(j.assigned_at).toISOString().slice(0,10):'';}
    var nowBD=new Date();var todayStrBD=todayIST();
    function dAgoBD(n){var d=new Date(nowBD.getTime()+5.5*3600000);d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);}
    var weekAgoBD=dAgoBD(7),monthAgoBD=dAgoBD(30);

    var bdStats=allBDs.map(function(bd){
      var bdJobs=allJobs.filter(function(j){return j.assigned_to_bd===bd.id;});
      var convJ=bdJobs.filter(function(j){return j.stage==='Connected'||j.stage==='In Discussion';});
      var posJ=bdJobs.filter(function(j){return j.stage==='Positive';});
      // C-0026 #4: `emails` has no `assigned_to` column (only `sent_by`) — this
      // always counted zero. `STATE.emails` was also always empty (fetched as
      // `?status=queued`, a status this app never writes); `STATE.sentEmails`
      // (`?status=sent`) is the array that actually holds sent rows.
      var sentE=(STATE.sentEmails||[]).filter(function(e){return e.sent_by===bd.id;});
      var todayJ=bdJobs.filter(function(j){return jAtBD(j)===todayStrBD;});
      var weekJ=bdJobs.filter(function(j){return jAtBD(j)>=weekAgoBD;});
      var monthJ=bdJobs.filter(function(j){return jAtBD(j)>=monthAgoBD;});
      var convRate=bdJobs.length?Math.round(convJ.length/bdJobs.length*100):0;
      return{bd:bd,total:bdJobs.length,today:todayJ.length,week:weekJ.length,month:monthJ.length,conv:convJ.length,pos:posJ.length,sent:sentE.length,convRate:convRate};
    }).sort(function(a,b){return b.convRate-a.convRate;});

    var leaderBD=bdStats.find(function(r){return r.total>0&&r.convRate>0;})||(bdStats.find(function(r){return r.total>0;})||null);
    var leaderBannerBD=leaderBD?
      '<div style="background:linear-gradient(135deg,#1a3a6e,#2563eb);border-radius:var(--r2);padding:20px 24px;margin-bottom:16px;display:flex;align-items:center;gap:20px;color:#fff">'+
        '<div style="font-size:32px">\uD83C\uDFC6</div><div style="flex:1">'+
          '<div style="font-size:11px;font-weight:700;letter-spacing:.1em;opacity:.75;text-transform:uppercase;margin-bottom:4px">Top Performer</div>'+
          '<div style="font-size:20px;font-weight:700;font-family:var(--display)">'+htmlEsc(leaderBD.bd.name)+'</div>'+
          '<div style="font-size:12px;opacity:.82;margin-top:2px">'+leaderBD.convRate+'% conversion \u00b7 '+leaderBD.month+' leads this month</div></div>'+
        '<div style="text-align:right"><div style="font-size:36px;font-weight:700;font-family:var(--display);line-height:1">'+leaderBD.convRate+'%</div><div style="font-size:11px;opacity:.78">conversion</div></div>'+
      '</div>':'';

    var teamTotalBD=bdStats.reduce(function(s,r){return s+r.total;},0);
    var teamSentBD=bdStats.reduce(function(s,r){return s+r.sent;},0);
    var teamConvBD=bdStats.reduce(function(s,r){return s+r.conv;},0);
    var teamConvRateBD=teamTotalBD?Math.round(teamConvBD/teamTotalBD*100):0;

    var lbRowsBD=bdStats.map(function(r,i){
      return '<tr style="cursor:default" onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'\'">'+
        '<td style="padding:10px 14px;font-weight:500;font-size:13px"><div style="display:flex;align-items:center;gap:9px"><span style="font-size:11px;font-weight:700;color:var(--text3);min-width:16px">'+(i+1)+'</span>'+av(r.bd,'28')+'<span>'+htmlEsc(r.bd.name)+'</span></div></td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;font-weight:600;color:var(--accent)">'+r.today+'</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px">'+r.week+'</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;font-weight:600">'+r.month+'</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;color:var(--teal)">'+r.sent+'</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;color:var(--green)">'+r.pos+'</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;font-weight:600;color:var(--green)">'+r.convRate+'%</td>'+
      '</tr>';
    }).join('');

    var switcherBD='<div style="display:inline-flex;background:var(--bg);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:16px">'+
      '<button onclick="STATE.insightsTeam=\'ra\';STATE.insightsSelectedRA=null;render()" style="padding:8px 20px;font-size:13px;font-weight:600;border:0;cursor:pointer;background:transparent;color:var(--text3)">RA Team</button>'+
      '<button style="padding:8px 20px;font-size:13px;font-weight:600;border:0;cursor:pointer;background:var(--accent);color:#fff;border-radius:6px">BD Team</button>'+
    '</div>';

    return '<div class="page">'+
      '<div class="ph"><div class="flex jb aic">'+
        '<div><div class="ptitle">Insights</div><div class="psub">'+allBDs.length+' BD Manager'+(allBDs.length!==1?'s':'')+' \u00b7 '+teamTotalBD+' leads \u00b7 '+teamSentBD+' emails sent</div></div>'+
      '</div></div>'+
      switcherBD+
      leaderBannerBD+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">'+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--accent)">'+teamTotalBD+'</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Total leads</div></div>'+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--teal)">'+teamSentBD+'</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Emails sent</div></div>'+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--green)">'+teamConvRateBD+'%</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Team conv. rate</div></div>'+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:14px">'+
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px">BD Manager performance</div>'+
        (allBDs.length?
          '<div class="tbl-wrap"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg)">'+
            '<th style="padding:9px 14px;text-align:left;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">BD Manager</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Today</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Week</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Month</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Sent</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Positive</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Conv %</th>'+
          '</tr></thead><tbody>'+lbRowsBD+'</tbody></table></div>':
          '<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px">No BD Managers in the system yet.</div>')+
      '</div></div>';
  }

  // If RA Lead and no RA selected, show RA team overview (mirrors BD Lead layout)
  if(isRALead&&!selectedRA){
    var ras=STATE.users.filter(function(x){return x.role==='ra';});
    var now=new Date();
    var todayStr=todayIST();
    function raDaysAgo(n){var d=new Date(now.getTime()+5.5*3600000);d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);}
    var weekAgo=raDaysAgo(7),monthAgo=raDaysAgo(30);

    var raStats=ras.map(function(ra){
      var raJobs=STATE.jobs.filter(function(j){return j.created_by===ra.id;});
      var todayJ=raJobs.filter(function(j){return j.created_date===todayStr;});
      var weekJ=raJobs.filter(function(j){return j.created_date>=weekAgo;});
      var monthJ=raJobs.filter(function(j){return j.created_date>=monthAgo;});
      var dups=raJobs.filter(function(j){return j.is_duplicate;}).length;
      var assigned=raJobs.filter(function(j){return j.stage!=='Unassigned';}).length;
      var conv=raJobs.filter(function(j){return j.stage==='Connected'||j.stage==='In Discussion';}).length;
      var assignPct=raJobs.length?Math.round(assigned/raJobs.length*100):0;
      var convPct=raJobs.length?Math.round(conv/raJobs.length*100):0;
      return{ra:ra,total:raJobs.length,today:todayJ.length,week:weekJ.length,month:monthJ.length,dups:dups,assigned:assigned,assignPct:assignPct,conv:conv,convPct:convPct};
    }).sort(function(a,b){return b.month-a.month;});

    var leader=raStats.find(function(r){return r.month>0;})||null;
    var leaderBanner=leader?
      '<div style="background:linear-gradient(135deg,#1a3a6e,#2563eb);border-radius:var(--r2);padding:20px 24px;margin-bottom:16px;display:flex;align-items:center;gap:20px;color:#fff">'+
        '<div style="font-size:32px">\uD83C\uDFC6</div><div style="flex:1">'+
          '<div style="font-size:11px;font-weight:700;letter-spacing:.1em;opacity:.75;text-transform:uppercase;margin-bottom:4px">Top Performer this month</div>'+
          '<div style="font-size:20px;font-weight:700;font-family:var(--display)">'+htmlEsc(leader.ra.name)+'</div>'+
          '<div style="font-size:12px;opacity:.82;margin-top:2px">'+leader.month+' leads this month \u00b7 '+leader.assignPct+'% assigned</div></div>'+
        '<div style="text-align:right"><div style="font-size:36px;font-weight:700;font-family:var(--display);line-height:1">'+leader.month+'</div><div style="font-size:11px;opacity:.78">leads</div></div>'+
      '</div>':'';

    var teamTotal=raStats.reduce(function(s,r){return s+r.total;},0);
    var teamMonth=raStats.reduce(function(s,r){return s+r.month;},0);
    var teamAssigned=raStats.reduce(function(s,r){return s+r.assigned;},0);
    var teamAssignPct=teamTotal?Math.round(teamAssigned/teamTotal*100):0;
    var teamDups=raStats.reduce(function(s,r){return s+r.dups;},0);

    var lbRows=raStats.map(function(r,i){
      return '<tr onclick="loadRAInsights(\''+r.ra.id+'\')" style="cursor:pointer" onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'\'">'+
        '<td style="padding:10px 14px;font-weight:500;font-size:13px"><div style="display:flex;align-items:center;gap:9px"><span style="font-size:11px;font-weight:700;color:var(--text3);min-width:16px">'+(i+1)+'</span>'+av(r.ra,'28')+'<span>'+htmlEsc(r.ra.name)+'</span></div></td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;font-weight:600;color:var(--accent)">'+r.today+'</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px">'+r.week+'</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;font-weight:600">'+r.month+'</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;color:var(--amber)">'+r.dups+'</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;color:var(--teal)">'+r.assignPct+'%</td>'+
        '<td style="padding:10px 8px;text-align:center;font-size:13px;font-weight:600;color:var(--green)">'+r.convPct+'%</td>'+
      '</tr>';
    }).join('');

    var switcherRA=isAdmin?'<div style="display:inline-flex;background:var(--bg);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:16px">'+
      '<button style="padding:8px 20px;font-size:13px;font-weight:600;border:0;cursor:pointer;background:var(--accent);color:#fff;border-radius:6px">RA Team</button>'+
      '<button onclick="STATE.insightsTeam=\'bd\';STATE.insightsSelectedRA=null;render()" style="padding:8px 20px;font-size:13px;font-weight:600;border:0;cursor:pointer;background:transparent;color:var(--text3)">BD Team</button>'+
    '</div>':'';

    return '<div class="page">'+
      '<div class="ph"><div class="flex jb aic">'+
        '<div><div class="ptitle">Insights</div><div class="psub">'+ras.length+' Research Analyst'+(ras.length!==1?'s':'')+' \u00b7 '+teamTotal+' leads \u00b7 '+teamAssignPct+'% assigned</div></div>'+
      '</div></div>'+
      switcherRA+
      leaderBanner+
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">'+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--accent)">'+teamTotal+'</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Total leads</div></div>'+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--teal)">'+teamMonth+'</div><div style="font-size:12px;color:var(--text3);margin-top:3px">This month</div></div>'+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--green)">'+teamAssignPct+'%</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Assign rate</div></div>'+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--amber)">'+teamDups+'</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Duplicates</div></div>'+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:14px">'+
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px">RA performance <span style="font-size:11px;font-weight:400;color:var(--text3)">click a row for detail</span></div>'+
        (ras.length?
          '<div class="tbl-wrap"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg)">'+
            '<th style="padding:9px 14px;text-align:left;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Research Analyst</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Today</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Week</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Month</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Dups</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Assign %</th>'+
            '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Conv %</th>'+
          '</tr></thead><tbody>'+lbRows+'</tbody></table></div>':
          '<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px">No Research Analysts in the system yet.</div>')+
      '</div></div>';
  }

  // Show individual RA insights
  var raUser=isRALead?STATE.users.find(function(x){return x.id===selectedRA;}):u;
  var d=data||{total_month:0,total_week:0,total_today:0,duplicates:0,last_7_days:{},by_industry:{},by_timezone:{},by_freshness:{},by_stage:{}};

  // Bar chart for last 7 days
  var l7=d.last_7_days||{};
  var l7keys=Object.keys(l7);
  var l7max=Math.max(1,Math.max.apply(null,l7keys.map(function(k){return l7[k];})));
  var barChart=l7keys.map(function(k){
    var val=l7[k];
    var pct=Math.round(val/l7max*100);
    var day=new Date(k).toLocaleDateString('en-US',{weekday:'short'});
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">'+
      '<div style="font-size:11px;font-weight:600;color:var(--accent)">'+val+'</div>'+
      '<div style="width:100%;background:var(--border);border-radius:4px;height:48px;display:flex;align-items:flex-end">'+
        '<div style="width:100%;background:var(--accent);border-radius:4px;height:'+pct+'%;min-height:'+(val>0?'4px':'0')+'"></div>'+
      '</div>'+
      '<div style="font-size:10px;color:var(--text3)">'+day+'</div>'+
    '</div>';
  }).join('');

  function categoryRows(obj,isIndustry){
    var src=isIndustry?normalizeIndustryMap(obj):obj;
    var entries=Object.keys(src).map(function(k){return{k:k,v:src[k]};}).sort(function(a,b){return b.v-a.v;});
    var total=entries.reduce(function(s,e){return s+e.v;},0)||1;
    return entries.map(function(e){
      var pct=Math.round(e.v/total*100);
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'+
        '<div style="width:90px;font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+htmlEsc(e.k)+'</div>'+
        '<div style="flex:1;background:var(--border);border-radius:99px;height:6px">'+
          '<div style="width:'+pct+'%;background:var(--accent);border-radius:99px;height:6px"></div>'+
        '</div>'+
        '<div style="width:36px;text-align:right;font-size:12px;font-weight:600">'+e.v+'</div>'+
      '</div>';
    }).join('');
  }

  return '<div class="page">'+
    '<div class="ph"><div class="flex aic gap3">'+
      (isRALead?'<button onclick="STATE.insightsSelectedRA=null;STATE.insightsData=null;render()" style="background:transparent;border:0;color:var(--text3);font-size:22px;cursor:pointer">\u2190</button>':'')+
      (raUser?av(raUser,'40'):'')+
      '<div><div class="ptitle" style="margin:0">'+(raUser?htmlEsc(raUser.name):'My')+' Insights</div>'+
        '<div class="psub" style="margin:0">Last 30 days activity</div></div>'+
    '</div></div>'+

    // ── Top stats ──
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:18px">'+
      [['Today',d.total_today,'var(--accent)'],['This Week',d.total_week,'var(--teal)'],['This Month',d.total_month,'var(--purple)'],['Duplicates',d.duplicates,'var(--amber)']].map(function(s){
        return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center">'+
          '<div style="font-size:28px;font-weight:700;color:'+s[2]+'">'+s[1]+'</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-top:3px">'+s[0]+'</div>'+
        '</div>';
      }).join('')+
    '</div>'+

    // ── Last 7 days bar chart ──
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px;margin-bottom:14px">'+
      '<div style="font-weight:600;font-size:13px;margin-bottom:12px">Last 7 days</div>'+
      '<div style="display:flex;gap:6px;align-items:flex-end">'+barChart+'</div>'+
    '</div>'+

    // ── Category breakdowns ──
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px">'+
        '<div style="font-weight:600;font-size:13px;margin-bottom:10px">By Industry</div>'+
        categoryRows(d.by_industry,true)+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px">'+
        '<div style="font-weight:600;font-size:13px;margin-bottom:10px">By Timezone</div>'+
        categoryRows(d.by_timezone)+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px">'+
        '<div style="font-weight:600;font-size:13px;margin-bottom:10px">By Freshness</div>'+
        categoryRows(d.by_freshness)+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px">'+
        '<div style="font-weight:600;font-size:13px;margin-bottom:10px">By Stage</div>'+
        categoryRows(d.by_stage)+
      '</div>'+
    '</div>'+
  '</div>';
}

window.loadRAInsights=function(raId){
  STATE.insightsSelectedRA=raId;
  STATE.insightsData=null;
  render();
  apiGet('/insights/ra/'+raId).then(function(d){
    STATE.insightsData=d;render();
  }).catch(function(e){showToast('Could not load insights: '+e.message,'error');});
};

// Auto-load insights for RA on page visit
function loadMyInsights(){
  var u=STATE.user;
  if(u&&u.role==='ra'){
    apiGet('/insights/ra/'+u.id).then(function(d){STATE.insightsData=d;render();}).catch(function(){});
  }
}

// ── BD Manager: load own insights ──────────────────────────────
function loadBDInsights(){
  var u=STATE.user;
  if(!u)return;
  apiGet('/insights/bd/'+u.id).then(function(d){STATE.bdInsightsData=d;render();}).catch(function(){});
}
// Personal | Team toggle on the Lead Insights page.
window.switchLeadInsights=function(view){STATE.bdInsightsView=view;render();};

// ════════════════════════════════════════════════════════════════
// BD MANAGER — OWN INSIGHTS PAGE
// Metrics: email pipeline, conversion funnel, stage breakdown,
//          7-day email chart, 7-day leads chart, industry breakdown
// ════════════════════════════════════════════════════════════════
function renderBDInsights(){
  var u=STATE.user;
  var d=STATE.bdInsightsData;

  // Personal | Team toggle \u2014 shown only to a user who actually leads a lead-gen
  // team (has at least one BD/BD Lead anywhere in their reporting subtree). The
  // Team view reuses the shared team lead-gen body so it stays consistent with
  // the My Team \u2192 Team Insights tab.
  var canTeam=window.reportingSubtree&&reportingSubtree(u.id).some(function(x){return userHasAnyRole(x,'bd','bd_lead');});
  var view=(canTeam&&STATE.bdInsightsView==='team')?'team':'personal';
  var toggle=canTeam?
    '<div style="display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:3px;margin-bottom:14px">'+
      [['personal','My leads'],['team','Team']].map(function(t){
        var on=view===t[0];
        return '<button onclick="switchLeadInsights(\''+t[0]+'\')" style="border:0;border-radius:7px;padding:5px 14px;font-size:12.5px;font-weight:600;cursor:pointer;background:'+(on?'var(--accent)':'transparent')+';color:'+(on?'#fff':'var(--text2)')+'">'+t[1]+'</button>';
      }).join('')+
    '</div>':'';
  if(view==='team') return '<div class="page">'+toggle+renderTeamInsightsBody()+'</div>';

  if(!d){
    return '<div class="page">'+toggle+'<div class="ph"><div class="ptitle">Lead Insights</div><div class="psub">Loading your performance data\u2026</div></div>'+
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">'+
        ['Emails Sent','Leads','Converted','Conv Rate'].map(function(l){
          return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--border)">—</div><div style="font-size:12px;color:var(--text3);margin-top:3px">'+l+'</div></div>';
        }).join('')+
      '</div></div>';
  }

  // ── Conversion funnel bar ──────────────────────────────────
  var funnelTotal=d.total_all||1;
  function fBar(label,val,color){
    var pct=Math.round(val/funnelTotal*100);
    return '<div style="margin-bottom:10px">'+
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px">'+
        '<span style="font-size:12px;color:var(--text2)">'+label+'</span>'+
        '<span style="font-size:12px;font-weight:700;color:'+color+'">'+val+' <span style="font-weight:400;color:var(--text3)">('+pct+'%)</span></span>'+
      '</div>'+
      '<div style="background:var(--border);border-radius:99px;height:7px;overflow:hidden">'+
        '<div style="width:'+Math.max(pct,val?2:0)+'%;background:'+color+';height:100%;border-radius:99px;transition:width .4s"></div>'+
      '</div>'+
    '</div>';
  }

  var funnel=
    fBar('Assigned (in queue)',d.assigned,'var(--text3)')+
    fBar('Positive (interested)',d.positive,'var(--teal)')+
    fBar('Connected / In Discussion',d.converted,'var(--green)')+
    fBar('No Response / Negative',d.negative,'var(--red)')+
    fBar('Out of Office',d.ooo,'var(--amber)')+
    fBar('Future follow-up',d.future,'var(--purple)');

  // ── 7-day email chart ──────────────────────────────────────
  var e7=d.last_7_emails||{};
  var e7keys=Object.keys(e7).sort();
  var e7max=Math.max(1,Math.max.apply(null,e7keys.map(function(k){return e7[k];})));
  var todayStr=todayIST();
  var emailChart=e7keys.map(function(k){
    var val=e7[k]; var pct=Math.round(val/e7max*100);
    var isT=k===todayStr;
    var lbl=new Date(k+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'});
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1">'+
      '<div style="font-size:11px;font-weight:600;color:'+(isT?'var(--green)':'var(--teal)')+'">'+val+'</div>'+
      '<div style="width:100%;background:var(--border);border-radius:4px;height:64px;display:flex;align-items:flex-end">'+
        '<div style="width:100%;background:'+(isT?'var(--green)':'var(--teal)')+';border-radius:4px;height:'+Math.max(pct,val?4:0)+'%;opacity:'+(isT?'1':'.7')+'"></div>'+
      '</div>'+
      '<div style="font-size:10px;color:'+(isT?'var(--green)':'var(--text3)')+';font-weight:'+(isT?700:400)+'">'+lbl+'</div>'+
    '</div>';
  }).join('');

  // ── 7-day leads assigned chart ─────────────────────────────
  var l7=d.last_7_leads||{};
  var l7keys=Object.keys(l7).sort();
  var l7max=Math.max(1,Math.max.apply(null,l7keys.map(function(k){return l7[k];})));
  var leadsChart=l7keys.map(function(k){
    var val=l7[k]; var pct=Math.round(val/l7max*100);
    var isT=k===todayStr;
    var lbl=new Date(k+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'});
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1">'+
      '<div style="font-size:11px;font-weight:600;color:'+(isT?'var(--green)':'var(--accent)')+'">'+val+'</div>'+
      '<div style="width:100%;background:var(--border);border-radius:4px;height:64px;display:flex;align-items:flex-end">'+
        '<div style="width:100%;background:'+(isT?'var(--green)':'var(--accent)')+';border-radius:4px;height:'+Math.max(pct,val?4:0)+'%;opacity:'+(isT?'1':'.65')+'"></div>'+
      '</div>'+
      '<div style="font-size:10px;color:'+(isT?'var(--green)':'var(--text3)')+';font-weight:'+(isT?700:400)+'">'+lbl+'</div>'+
    '</div>';
  }).join('');

  // ── Industry breakdown ─────────────────────────────────────
  var ind=d.by_industry||{};
  var indEntries=Object.keys(ind).map(function(k){return{k:k,v:ind[k]};}).sort(function(a,b){return b.v-a.v;}).slice(0,8);
  var indTotal=indEntries.reduce(function(s,e){return s+e.v;},0)||1;
  var indRows=indEntries.map(function(e){
    var pct=Math.round(e.v/indTotal*100);
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">'+
      '<div style="width:110px;font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0">'+htmlEsc(e.k)+'</div>'+
      '<div style="flex:1;background:var(--border);border-radius:99px;height:6px"><div style="width:'+pct+'%;background:var(--accent);border-radius:99px;height:6px"></div></div>'+
      '<div style="width:28px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0">'+e.v+'</div>'+
    '</div>';
  }).join('');

  // ── Stage breakdown ────────────────────────────────────────
  var stg=d.by_stage||{};
  var stgOrder=['Connected','In Discussion','Positive','Assigned','No Response','Negative','Future','Out of Office'];
  var stgColors={Connected:'var(--green)','In Discussion':'var(--accent)',Positive:'var(--teal)',Assigned:'var(--text3)','No Response':'var(--amber)',Negative:'var(--red)',Future:'var(--purple)','Out of Office':'var(--amber)'};
  var stgRows=stgOrder.filter(function(s){return stg[s]>0;}).map(function(s){
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border2)">'+
      '<div style="display:flex;align-items:center;gap:8px">'+
        '<div style="width:8px;height:8px;border-radius:50%;background:'+(stgColors[s]||'var(--text3)')+'"></div>'+
        '<span style="font-size:13px;color:var(--text2)">'+s+'</span>'+
      '</div>'+
      '<span style="font-size:13px;font-weight:700;color:'+(stgColors[s]||'var(--text)')+'">'+stg[s]+'</span>'+
    '</div>';
  }).join('');

  return '<div class="page">'+toggle+
    '<div class="ph"><div class="flex aic gap2">'+
      av(u,'40')+
      '<div><div class="ptitle" style="margin:0">Lead Insights</div><div class="psub" style="margin:0">Your personal lead-gen performance</div></div>'+
    '</div></div>'+

    // ── Top 4 stat cards ──
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">'+
      [
        ['Emails Sent',d.emails_sent,'var(--teal)','this month'],
        ['Leads Assigned',d.total_all,'var(--accent)','total'],
        ['Converted',d.converted,'var(--green)','Connected + In Discussion'],
        ['Conv Rate',d.conv_rate+'%','var(--green)','of total leads']
      ].map(function(s){
        return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px;text-align:center">'+
          '<div style="font-size:30px;font-weight:700;color:'+s[2]+';font-family:var(--display)">'+s[1]+'</div>'+
          '<div style="font-size:12px;font-weight:600;color:var(--text2);margin-top:2px">'+s[0]+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:1px">'+s[3]+'</div>'+
        '</div>';
      }).join('')+
    '</div>'+

    // ── Email pipeline (today focus) ──
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px;margin-bottom:14px">'+
      '<div style="font-weight:700;font-size:13px;margin-bottom:12px">Email pipeline</div>'+
      '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">'+
        [
          ['Sent today',d.emails_sent_today,'var(--green)'],
          ['Sent (month)',d.emails_sent,'var(--teal)'],
          ['Pending',d.emails_pending,'var(--amber)'],
          ['Failed',d.emails_failed,'var(--red)'],
          ['Response rate',d.response_rate+'%','var(--accent)']
        ].map(function(s){
          return '<div style="text-align:center;padding:10px;background:var(--bg);border-radius:var(--r2)">'+
            '<div style="font-size:22px;font-weight:700;color:'+s[2]+'">'+s[1]+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:3px">'+s[0]+'</div>'+
          '</div>';
        }).join('')+
      '</div>'+
    '</div>'+

    // ── This month at a glance ──
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center">'+
        '<div style="font-size:24px;font-weight:700;color:var(--accent)">'+d.total_today+'</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:2px">Leads today</div>'+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center">'+
        '<div style="font-size:24px;font-weight:700;color:var(--teal)">'+d.total_week+'</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:2px">Leads this week</div>'+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center">'+
        '<div style="font-size:24px;font-weight:700;color:var(--purple)">'+d.total_month+'</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:2px">Leads this month</div>'+
      '</div>'+
    '</div>'+

    // ── Charts row ──
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px">'+
        '<div style="font-weight:600;font-size:13px;margin-bottom:12px">Emails sent — last 7 days <span style="font-size:11px;color:var(--green)">\u25cf today</span></div>'+
        '<div style="display:flex;gap:5px;align-items:flex-end">'+(emailChart||'<div style="font-size:12px;color:var(--text3)">No data</div>')+'</div>'+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px">'+
        '<div style="font-weight:600;font-size:13px;margin-bottom:12px">Leads assigned — last 7 days</div>'+
        '<div style="display:flex;gap:5px;align-items:flex-end">'+(leadsChart||'<div style="font-size:12px;color:var(--text3)">No data</div>')+'</div>'+
      '</div>'+
    '</div>'+

    // ── Funnel + Stage + Industry ──
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px">'+
        '<div style="font-weight:700;font-size:13px;margin-bottom:12px">Conversion funnel <span style="font-size:11px;font-weight:400;color:var(--text3)">% of '+d.total_all+' leads</span></div>'+
        funnel+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px">'+
        '<div style="font-weight:700;font-size:13px;margin-bottom:10px">Stage breakdown</div>'+
        (stgRows||'<div style="font-size:13px;color:var(--text3)">No leads yet.</div>')+
      '</div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px">'+
        '<div style="font-weight:700;font-size:13px;margin-bottom:12px">By industry</div>'+
        (indRows||'<div style="font-size:13px;color:var(--text3)">No leads yet.</div>')+
      '</div>'+
    '</div>'+

  '</div>';
}

// ════════════════════════════════════════════════════════════════
// TEAM INSIGHTS — lead-gen performance across the reporting line.
// renderTeamInsightsBody() returns the inner content (no .page wrapper) so it
// can be embedded as a tab inside the "My Team" hub. renderBDLeadInsights()
// keeps the standalone page for the legacy `bdleadinsights` route.
// ════════════════════════════════════════════════════════════════
function renderBDLeadInsights(){ return '<div class="page">'+renderTeamInsightsBody()+'</div>'; }
function renderTeamInsightsBody(){
  var u=STATE.user;
  var selectedBD=STATE.bdLeadSelectedBD||null;
  var allJobs=STATE.jobs;
  function jAt(j){return j.assigned_at?new Date(j.assigned_at).toISOString().slice(0,10):'';}
  var now=new Date(); var todayStr=todayIST();
  function dAgo(n){var d=new Date(now.getTime()+5.5*3600000);d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);}
  var weekAgo=dAgo(7),monthAgo=dAgo(30);

  // ── Drill-down: individual BD Manager ──
  if(selectedBD){
    var bdUser=STATE.users.find(function(x){return x.id===selectedBD;});
    if(!bdUser)return'<div style="padding:40px;text-align:center;color:var(--text3)">Not found</div>';
    var bdJobs=allJobs.filter(function(j){return j.assigned_to_bd===selectedBD;});
    var convJ=bdJobs.filter(function(j){return j.stage==='Connected'||j.stage==='In Discussion';});
    var posJ=bdJobs.filter(function(j){return j.stage==='Positive';});
    var negJ=bdJobs.filter(function(j){return j.stage==='Negative'||j.stage==='No Response';});
    var todayJ=bdJobs.filter(function(j){return jAt(j)===todayStr;});
    var weekJ=bdJobs.filter(function(j){return jAt(j)>=weekAgo;});
    var monthJ=bdJobs.filter(function(j){return jAt(j)>=monthAgo;});
    // C-0026 #4: same fix as the admin BD-team view above — `sent_by`, not the
    // nonexistent `assigned_to`, and the arrays that are actually populated.
    var sentE=(STATE.sentEmails||[]).filter(function(e){return e.sent_by===selectedBD;});
    var pendE=(STATE.pendingEmails||[]).filter(function(e){return e.sent_by===selectedBD;});
    var stgColors={Connected:'var(--green)','In Discussion':'var(--accent)',Positive:'var(--teal)',Assigned:'var(--text3)','No Response':'var(--amber)',Negative:'var(--red)',Future:'var(--purple)','Out of Office':'var(--amber)'};
    var stgRows=['Connected','In Discussion','Positive','Assigned','No Response','Negative','Future','Out of Office'].map(function(s){
      var cnt=bdJobs.filter(function(j){return j.stage===s;}).length; if(!cnt)return'';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border2)">'+
        '<div style="display:flex;align-items:center;gap:8px"><div style="width:8px;height:8px;border-radius:50%;background:'+(stgColors[s]||'var(--text3)')+'"></div><span style="font-size:13px;color:var(--text2)">'+s+'</span></div>'+
        '<span style="font-size:13px;font-weight:700;color:'+(stgColors[s]||'var(--text)')+'">'+cnt+'</span></div>';
    }).join('');
    return ''+
      '<div class="ph"><div class="flex aic gap3">'+
        '<button onclick="STATE.bdLeadSelectedBD=null;render()" style="background:transparent;border:0;color:var(--text3);font-size:22px;cursor:pointer">\u2190</button>'+
        av(bdUser,'40')+
        '<div><div class="ptitle" style="margin:0">'+htmlEsc(bdUser.name)+'</div><div class="psub" style="margin:0">BD Manager performance</div></div>'+
      '</div></div>'+
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">'+
        [['Today',todayJ.length,'var(--accent)'],['This Week',weekJ.length,'var(--teal)'],['This Month',monthJ.length,'var(--purple)'],['Converted',convJ.length,'var(--green)']].map(function(s){
          return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:'+s[2]+'">'+s[1]+'</div><div style="font-size:12px;color:var(--text3);margin-top:3px">'+s[0]+'</div></div>';
        }).join('')+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px">'+
          '<div style="font-weight:700;font-size:13px;margin-bottom:10px">Email pipeline</div>'+
          '<div style="display:flex;gap:10px;margin-bottom:10px">'+
            '<div style="flex:1;text-align:center;padding:10px;background:var(--bg);border-radius:var(--r2)"><div style="font-size:22px;font-weight:700;color:var(--green)">'+sentE.length+'</div><div style="font-size:11px;color:var(--text3)">Sent</div></div>'+
            '<div style="flex:1;text-align:center;padding:10px;background:var(--bg);border-radius:var(--r2)"><div style="font-size:22px;font-weight:700;color:var(--amber)">'+pendE.length+'</div><div style="font-size:11px;color:var(--text3)">Pending</div></div>'+
          '</div>'+
          '<div style="font-size:12px;color:var(--text3)">Conv: <strong style="color:var(--green)">'+(bdJobs.length?Math.round(convJ.length/bdJobs.length*100):0)+'%</strong> \u00b7 Positive: <strong style="color:var(--teal)">'+posJ.length+'</strong> \u00b7 Negative: <strong style="color:var(--red)">'+negJ.length+'</strong></div>'+
        '</div>'+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:16px">'+
          '<div style="font-weight:700;font-size:13px;margin-bottom:10px">Stage breakdown</div>'+
          (stgRows||'<div style="font-size:13px;color:var(--text3)">No leads.</div>')+
        '</div>'+
      '</div>';
  }

  // ── Team overview ──
  // Membership is the FULL reporting subtree (users.manager_id, direct +
  // transitive) filtered to BD/BD Lead — so a lead sees everyone under them, not
  // just their first-level reports. Reparenting is admin-only (Admin → user →
  // Reporting Hierarchy); this is a read-only performance view.
  var myBDs=reportingSubtree(u.id).filter(function(x){return userHasAnyRole(x,'bd','bd_lead');});
  var bdStats=myBDs.map(function(bd){
    var bdJobs=allJobs.filter(function(j){return j.assigned_to_bd===bd.id;});
    var convJ=bdJobs.filter(function(j){return j.stage==='Connected'||j.stage==='In Discussion';});
    var posJ=bdJobs.filter(function(j){return j.stage==='Positive';});
    // C-0026 #4: same fix as above — `sent_by`, not the nonexistent
    // `assigned_to`, and `STATE.sentEmails` rather than the always-empty
    // `STATE.emails` (fetched as `?status=queued`, a status never written).
    var sentE=(STATE.sentEmails||[]).filter(function(e){return e.sent_by===bd.id;});
    var todayJ=bdJobs.filter(function(j){return jAt(j)===todayStr;});
    var weekJ=bdJobs.filter(function(j){return jAt(j)>=weekAgo;});
    var monthJ=bdJobs.filter(function(j){return jAt(j)>=monthAgo;});
    var convRate=bdJobs.length?Math.round(convJ.length/bdJobs.length*100):0;
    return{bd:bd,total:bdJobs.length,today:todayJ.length,week:weekJ.length,month:monthJ.length,conv:convJ.length,pos:posJ.length,sent:sentE.length,convRate:convRate};
  }).sort(function(a,b){return b.convRate-a.convRate;});
  var leader=bdStats.find(function(r){return r.total>0&&r.convRate>0;})||(bdStats.find(function(r){return r.total>0;})||null);
  var leaderBanner=leader?
    '<div style="background:linear-gradient(135deg,#1a3a6e,#2563eb);border-radius:var(--r2);padding:20px 24px;margin-bottom:16px;display:flex;align-items:center;gap:20px;color:#fff">'+
      '<div style="font-size:32px">\uD83C\uDFC6</div><div style="flex:1">'+
        '<div style="font-size:11px;font-weight:700;letter-spacing:.1em;opacity:.75;text-transform:uppercase;margin-bottom:4px">Top Performer</div>'+
        '<div style="font-size:20px;font-weight:700;font-family:var(--display)">'+htmlEsc(leader.bd.name)+'</div>'+
        '<div style="font-size:12px;opacity:.82;margin-top:2px">'+leader.convRate+'% conversion \u00b7 '+leader.month+' leads this month</div></div>'+
      '<div style="text-align:right"><div style="font-size:36px;font-weight:700;font-family:var(--display);line-height:1">'+leader.convRate+'%</div><div style="font-size:11px;opacity:.78">conversion</div></div>'+
    '</div>':'';
  var teamTotal=bdStats.reduce(function(s,r){return s+r.total;},0);
  var teamSent=bdStats.reduce(function(s,r){return s+r.sent;},0);
  var teamConv=bdStats.reduce(function(s,r){return s+r.conv;},0);
  var teamConvRate=teamTotal?Math.round(teamConv/teamTotal*100):0;
  var lbRows=bdStats.map(function(r,i){
    return '<tr onclick="STATE.bdLeadSelectedBD=\''+r.bd.id+'\';render()" style="cursor:pointer" onmouseenter="this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.background=\'\'">'+
      '<td style="padding:10px 14px;font-weight:500;font-size:13px"><div style="display:flex;align-items:center;gap:9px"><span style="font-size:11px;font-weight:700;color:var(--text3);min-width:16px">'+(i+1)+'</span>'+av(r.bd,'28')+'<span>'+htmlEsc(r.bd.name)+'</span></div></td>'+
      '<td style="padding:10px 8px;text-align:center;font-size:13px;font-weight:600;color:var(--accent)">'+r.today+'</td>'+
      '<td style="padding:10px 8px;text-align:center;font-size:13px">'+r.week+'</td>'+
      '<td style="padding:10px 8px;text-align:center;font-size:13px;font-weight:600">'+r.month+'</td>'+
      '<td style="padding:10px 8px;text-align:center;font-size:13px;color:var(--teal)">'+r.sent+'</td>'+
      '<td style="padding:10px 8px;text-align:center;font-size:13px;color:var(--green)">'+r.pos+'</td>'+
      '<td style="padding:10px 8px;text-align:center;font-size:13px;font-weight:600;color:var(--green)">'+r.convRate+'%</td>'+
    '</tr>';
  }).join('');
  return ''+
    '<div class="ph"><div class="flex jb aic">'+
      '<div><div class="ptitle">Team Insights</div><div class="psub">'+myBDs.length+' BD Manager'+(myBDs.length!==1?'s':'')+' \u00b7 '+teamTotal+' leads \u00b7 '+teamSent+' emails sent</div></div>'+
    '</div></div>'+
    leaderBanner+
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--accent)">'+teamTotal+'</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Total leads</div></div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--teal)">'+teamSent+'</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Emails sent</div></div>'+
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--green)">'+teamConvRate+'%</div><div style="font-size:12px;color:var(--text3);margin-top:3px">Team conv. rate</div></div>'+
    '</div>'+
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:14px">'+
      '<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px">BD Manager performance <span style="font-size:11px;font-weight:400;color:var(--text3)">click a row for detail</span></div>'+
      (myBDs.length?
        '<div class="tbl-wrap"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg)">'+
          '<th style="padding:9px 14px;text-align:left;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">BD Manager</th>'+
          '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Today</th>'+
          '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Week</th>'+
          '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Month</th>'+
          '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Sent</th>'+
          '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Positive</th>'+
          '<th style="padding:9px 8px;text-align:center;font-size:10.5px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Conv %</th>'+
        '</tr></thead><tbody>'+lbRows+'</tbody></table></div>':
        '<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px">No BD Managers report to you yet.<br><br>An admin sets reporting lines on the Admin → user page.</div>')+
    '</div>';
}

