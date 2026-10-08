// ── THE TEAM NUMBERS COME FROM THE SERVER (owner, 2026-09-30) ──────────────────────────
// Three screens used to work these out in the browser from whatever lists the page had loaded,
// in a different time zone from the server, and disagreed with the personal report (0 emails
// beside 311). `GET /insights/bd-team` answers for everybody in scope with the SAME calculation
// the personal report uses (services/bd-insights.js); these helpers only fetch it and reshape it.
// Nothing below does arithmetic on leads or emails.
function bdTeamData(){
  var t=STATE.bdTeamInsights;
  var stale=t&&t.data&&!t.loading&&(Date.now()-t.at>60000);
  if(!t||stale){
    STATE.bdTeamInsights=Object.assign({},t||{},{loading:true});
    apiGet('/insights/bd-team'+insightsTzQ()).then(function(d){STATE.bdTeamInsights={data:d,at:Date.now()};render();})
      .catch(function(e){STATE.bdTeamInsights={error:(e&&e.message)||'Could not load',at:Date.now()};render();});
  }
  return STATE.bdTeamInsights;
}
function bdStatsFromServer(t){
  var people=(t&&t.data&&t.data.people)||[];
  return people.map(function(p){
    return {bd:{id:p.id,name:p.name,role:p.role},total:p.total_all,today:p.total_today,week:p.total_week,month:p.total_month,
      conv:p.converted,pos:p.positive,sent:p.emails_sent,replied:p.replied,replyRate:p.reply_rate,convRate:p.conv_rate,_p:p};
  }).sort(function(a,b){return b.convRate-a.convRate;});
}
function bdTeamStatus(t){
  if(!t||t.loading&&!t.data)return '<div class="c-text3 fs-13" style="padding:40px;text-align:center">Loading the team\u2019s numbers\u2026</div>';
  if(t.error&&!t.data)return '<div class="c-red fs-13" style="padding:40px;text-align:center">Could not load the team\u2019s numbers: '+htmlEsc(t.error)+' <a href="#" onclick="STATE.bdTeamInsights=null;render();return false">try again</a></div>';
  return '';
}

// The RA Team table: same arrangement as the BD one (R-100). `GET /insights/ra-team` runs
// services/ra-insights.js for every Research Analyst in scope; this only fetches and reshapes.
function raTeamData(){
  var t=STATE.raTeamInsights;
  var stale=t&&t.data&&!t.loading&&(Date.now()-t.at>60000);
  if(!t||stale){
    STATE.raTeamInsights=Object.assign({},t||{},{loading:true});
    apiGet('/insights/ra-team'+insightsTzQ()).then(function(d){STATE.raTeamInsights={data:d,at:Date.now()};render();})
      .catch(function(e){STATE.raTeamInsights={error:(e&&e.message)||'Could not load',at:Date.now()};render();});
  }
  return STATE.raTeamInsights;
}
function raStatsFromServer(t){
  var people=(t&&t.data&&t.data.people)||[];
  return people.map(function(p){
    var u=(STATE.users||[]).find(function(x){return x.id===p.id;})||{id:p.id,name:p.name,role:p.role};
    return {ra:u,total:p.total,today:p.today,week:p.week,month:p.month,dups:p.dups,assigned:p.assigned,assignPct:p.assignPct,conv:p.conv,convPct:p.convPct};
  }).sort(function(a,b){return b.month-a.month;});
}
function raTeamStatus(t){
  if(!t||t.loading&&!t.data)return '<div class="c-text3 fs-13" style="padding:40px;text-align:center">Loading the team\u2019s numbers\u2026</div>';
  if(t.error&&!t.data)return '<div class="c-red fs-13" style="padding:40px;text-align:center">Could not load the team\u2019s numbers: '+htmlEsc(t.error)+' <a href="#" onclick="STATE.raTeamInsights=null;render();return false">try again</a></div>';
  return '';
}

// ════════════════════════════════════════════════
// INSIGHTS TAB — RA activity + RA Lead team view
// ════════════════════════════════════════════════
// ── RA / Admin Insights, on the shared kit (owner, 6 Oct: "RA/Admin Insights page … still has the old look. Yes, restyle it") ──
// The same parts Lead Insights uses (ivCard, ivRow, ivCols, ivKpis, UI.strip, UI.table, the .rep-pill toggle and the
// .iv-top "top performer" card). The numbers and the three views are unchanged: the BD team (admin only), the RA team,
// and one analyst's own page.
function ivTeamSwitch(active){
  return '<div class="rep-fgroup" style="margin-bottom:14px">'+[['ra','RA Team'],['bd','BD Team']].map(function(t){
    return '<button class="rep-pill'+(active===t[0]?' on':'')+'" onclick="STATE.insightsTeam=\''+t[0]+'\';STATE.insightsSelectedRA=null;render()">'+t[1]+'</button>';
  }).join('')+'</div>';
}
function ivTopCard(label,name,line,big,bigLabel){
  return '<div class="iv-top">'+
    '<div class="iv-top-ico">★</div><div style="flex:1;min-width:0">'+
      '<div class="rep-flbl">'+htmlEsc(label)+'</div>'+
      '<div class="fs-20" style="font-weight:700">'+htmlEsc(name)+'</div>'+
      '<div class="fs-12 c-text3" style="margin-top:2px">'+htmlEsc(line)+'</div></div>'+
    '<div style="text-align:right"><div class="fs-28" style="font-weight:700;line-height:1">'+htmlEsc(String(big))+'</div><div class="fs-11 c-text3">'+htmlEsc(bigLabel)+'</div></div>'+
  '</div>';
}
function ivWho(i,person){
  return '<div style="display:flex;align-items:center;gap:9px"><span class="fs-11 c-text3" style="font-weight:700;min-width:16px">'+(i+1)+'</span>'+av(person,'28')+'<span style="font-weight:600">'+htmlEsc(person.name)+'</span></div>';
}
function ivTableCard(title,hint,body){
  return '<div class="card rep-card rep-tablecard" style="margin-top:14px">'+
    '<div class="rep-tablehead"><div class="rep-ttl" style="margin:0">'+title+'</div>'+(hint?'<span class="rep-sub" style="margin:0">'+hint+'</span>':'')+'</div>'+body+'</div>';
}
// One breakdown (industry, timezone, freshness, stage) as bar rows, biggest first.
function ivBreakdown(obj,isIndustry,tone){
  var src=isIndustry?normalizeIndustryMap(obj||{}):(obj||{});
  var entries=Object.keys(src).map(function(k){return{k:k,v:src[k]};}).sort(function(a,b){return b.v-a.v;}).slice(0,8);
  if(!entries.length) return '<div class="fs-13 c-text3">Nothing yet.</div>';
  var max=Math.max(1,entries[0].v);
  return entries.map(function(e){ return ivRow(e.k,e.v,max,tone||'brand',null,e.k+': '+e.v); }).join('');
}

function renderInsights(){
  var u=STATE.user;
  var isRALead=(u.role==='ra_lead'||u.role==='admin');
  var selectedRA=STATE.insightsSelectedRA;
  var data=STATE.insightsData;
  var isAdmin=userHasRole(u,'admin');
  var insightsTeam=STATE.insightsTeam||'ra';

  // Admin: the BD team
  if(isAdmin&&insightsTeam==='bd'&&!selectedRA){
    var tBD=bdTeamData();
    var bdStats=bdStatsFromServer(tBD);
    var allBDs=bdStats.map(function(r){return r.bd;});
    var leaderBD=bdStats.find(function(r){return r.total>0&&r.convRate>0;})||(bdStats.find(function(r){return r.total>0;})||null);
    var teamTotalBD=bdStats.reduce(function(s,r){return s+r.total;},0);
    var teamSentBD=bdStats.reduce(function(s,r){return s+r.sent;},0);
    var teamConvBD=bdStats.reduce(function(s,r){return s+r.conv;},0);
    var teamConvRateBD=teamTotalBD?Math.round(teamConvBD/teamTotalBD*100):0;
    var boardBD=UI.table({
      cols:['BD Manager','Today','7 days','30 days','Sent (30d)','Positive','Replied %','Conv %'],
      rows:bdStats.map(function(r,i){ return {cells:[ivWho(i,r.bd),r.today,r.week,r.month,r.sent,r.pos,r.replyRate+'%',r.convRate+'%']}; }),
      empty:'No BD Managers in the system yet.'
    });
    return '<div class="page">'+
      '<div class="ph"><div class="ptitle">Insights</div><div class="psub">'+allBDs.length+' BD Manager'+(allBDs.length!==1?'s':'')+' · '+teamTotalBD+' leads · '+teamSentBD+' emails sent</div></div>'+
      ivTeamSwitch('bd')+
      (leaderBD?ivTopCard('Top performer',leaderBD.bd.name,leaderBD.convRate+'% conversion · '+leaderBD.month+' leads in 30 days',leaderBD.convRate+'%','conversion'):'')+
      UI.strip([{v:teamTotalBD,label:'Total leads'},{v:teamSentBD,label:'Emails sent'},{v:teamConvRateBD+'%',label:'Team conversion'}])+
      ivTableCard('BD Manager performance',null,bdTeamStatus(tBD)||boardBD)+
    '</div>';
  }

  // RA Lead / admin, nobody selected: the RA team
  if(isRALead&&!selectedRA){
    var rt=raTeamData();
    var raWait=raTeamStatus(rt);
    if(raWait)return '<div class="page"><div class="ph"><div class="ptitle">Insights</div></div>'+raWait+'</div>';
    var ras=raStatsFromServer(rt);
    var leader=ras.find(function(r){return r.month>0;})||null;
    var teamTotal=ras.reduce(function(s,r){return s+r.total;},0);
    var teamMonth=ras.reduce(function(s,r){return s+r.month;},0);
    var teamAssigned=ras.reduce(function(s,r){return s+r.assigned;},0);
    var teamAssignPct=teamTotal?Math.round(teamAssigned/teamTotal*100):0;
    var teamDups=ras.reduce(function(s,r){return s+r.dups;},0);
    var boardRA=UI.table({
      cols:['Research Analyst','Today','7 days','30 days','Dups','Assign %','Conv %'],
      rows:ras.map(function(r,i){ return {onclick:"loadRAInsights('"+r.ra.id+"')",cells:[ivWho(i,r.ra),r.today,r.week,r.month,r.dups,r.assignPct+'%',r.convPct+'%']}; }),
      empty:'No Research Analysts in the system yet.'
    });
    return '<div class="page">'+
      '<div class="ph"><div class="ptitle">Insights</div><div class="psub">'+ras.length+' Research Analyst'+(ras.length!==1?'s':'')+' · '+teamTotal+' leads · '+teamAssignPct+'% assigned</div></div>'+
      (isAdmin?ivTeamSwitch('ra'):'')+
      (leader?ivTopCard('Top performer this month',leader.ra.name,leader.month+' leads in 30 days · '+leader.assignPct+'% assigned',leader.month,'leads'):'')+
      UI.strip([{v:teamTotal,label:'Total leads'},{v:teamMonth,label:'Last 30 days'},{v:teamAssignPct+'%',label:'Assigned'},{v:teamDups,label:'Duplicates'}])+
      ivTableCard('RA performance','click a row for detail',boardRA)+
    '</div>';
  }

  // One analyst's page (yours, or the one a lead picked)
  var raUser=isRALead?STATE.users.find(function(x){return x.id===selectedRA;}):u;
  var d=data||{total_month:0,total_week:0,total_today:0,duplicates:0,last_7_days:{},by_industry:{},by_timezone:{},by_freshness:{},by_stage:{}};
  return '<div class="page">'+
    '<div class="ph"><div class="flex aic gap3">'+
      (isRALead?'<button onclick="STATE.insightsSelectedRA=null;STATE.insightsData=null;render()" class="rep-pill" title="Back to the team">← Team</button>':'')+
      (raUser?av(raUser,'40'):'')+
      '<div><div class="ptitle" style="margin:0">'+(raUser?htmlEsc(raUser.name):'My')+' Insights</div>'+
        '<div class="psub" style="margin:0">Last 30 days activity</div></div>'+
    '</div></div>'+
    UI.strip([{v:d.total_today,label:'Today'},{v:d.total_week,label:'This week'},{v:d.total_month,label:'This month'},{v:d.duplicates,label:'Duplicates'}])+
    '<div class="rep-grid">'+
      ivCard('Leads — last 7 days','Each column is a day; the green one is today.',ivCols(d.last_7_days,'brand','Leads'))+
      ivCard('By stage',null,ivBreakdown(d.by_stage,false,'info'))+
    '</div>'+
    '<div class="rep-grid rep-grid3">'+
      ivCard('By industry',null,ivBreakdown(d.by_industry,true,'brand'))+
      ivCard('By timezone',null,ivBreakdown(d.by_timezone,false,'info'))+
      ivCard('By freshness',null,ivBreakdown(d.by_freshness,false,'go'))+
    '</div>'+
  '</div>';
}

window.loadRAInsights=function(raId){
  STATE.insightsSelectedRA=raId;
  STATE.insightsData=null;
  render();
  apiGet('/insights/ra/'+raId+insightsTzQ()).then(function(d){
    STATE.insightsData=d;render();
  }).catch(function(e){showToast('Could not load insights: '+e.message,'error');});
};

// Auto-load insights for RA on page visit
function loadMyInsights(){
  var u=STATE.user;
  if(u&&u.role==='ra'){
    apiGet('/insights/ra/'+u.id+insightsTzQ()).then(function(d){STATE.insightsData=d;render();}).catch(function(){});
  }
}

// A day is the viewer's own day (R-102, D-0065): tell the server which zone this browser is in.
function insightsTzQ(){
  try{ var z=Intl.DateTimeFormat().resolvedOptions().timeZone; return z?'?tz='+encodeURIComponent(z):''; }catch(e){ return ''; }
}

// ── BD Manager: load own insights ──────────────────────────────
function loadBDInsights(){
  var u=STATE.user;
  if(!u)return;
  apiGet('/insights/bd/'+u.id+insightsTzQ()).then(function(d){STATE.bdInsightsData=d;render();}).catch(function(){});
}
// Personal | Team toggle on the Lead Insights page.
window.switchLeadInsights=function(view){STATE.bdInsightsView=view;render();};

// ════════════════════════════════════════════════════════════════
// BD MANAGER — OWN INSIGHTS PAGE
// Metrics: email pipeline, conversion funnel, stage breakdown,
//          7-day email chart, 7-day leads chart, industry breakdown
// ════════════════════════════════════════════════════════════════
// ── Lead Insights, on the shared kit (owner, 6 Oct: "has not converted into our theme") ─────────
// Same parts as the Reports page: UI.strip for the tiles, .rep-* rows and columns for the charts,
// one tone vocabulary (brand/info/wait/go/stop/muted). Every bar says what it is on hover.
var IV_TONE={
  Connected:'go','In Discussion':'brand',Positive:'info',Assigned:'muted','No Response':'wait',Negative:'stop',Future:'brand','Out of Office':'wait'
};
function ivCard(title,sub,inner){
  return '<div class="card rep-card"><div class="rep-ttl">'+title+'</div>'+(sub?'<div class="rep-sub">'+sub+'</div>':'')+inner+'</div>';
}
// A horizontal bar: label · bar · number (· share).
function ivRow(label,val,max,tone,pct,tip){
  var w=max?Math.round(val/max*100):0;
  return '<div class="rep-row" title="'+htmlEsc(tip||(label+': '+val))+'">'+
    '<div class="rep-lbl is-name">'+htmlEsc(label)+'</div>'+
    '<div class="rep-track"><div class="rep-fill tone-'+tone+(val?'':' is-empty')+'" style="width:'+w+'%"></div></div>'+
    '<div class="rep-num'+(val?'':' is-zero')+'">'+val+'</div>'+
    (pct==null?'':'<div class="rep-meta is-pct"><span class="rep-tis">'+pct+'%</span></div>')+
  '</div>';
}
// A column chart over days; the last one is today.
function ivCols(map,tone,what){
  var keys=Object.keys(map||{}).sort();
  if(!keys.length) return '<div class="fs-12 c-text3">No data yet.</div>';
  var max=Math.max(1,Math.max.apply(null,keys.map(function(k){return map[k];})));
  var today=keys[keys.length-1];
  var cols=keys.map(function(k){
    var v=map[k], h=v?Math.max(8,Math.round(v/max*96)):0, isT=k===today;
    var day=new Date(k+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'});
    return '<div class="rep-col"><div class="rep-pair"><div class="rep-bar1" title="'+htmlEsc(what+' on '+day+(isT?' (today)':'')+': '+v)+'">'+
      '<div class="rep-colv'+(v?'':' is-zero')+'">'+v+'</div>'+
      '<div class="rep-colbar tone-'+(isT?'go':tone)+(v?'':' is-zero')+'"'+(v?' style="height:'+h+'px"':'')+'></div>'+
    '</div></div></div>';
  }).join('');
  var days=keys.map(function(k){ return '<div class="rep-colw">'+(k===today?'Today':new Date(k+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'}))+'</div>'; }).join('');
  return '<div class="rep-cols">'+cols+'</div><div class="rep-weeks">'+days+'</div>';
}
// Numbers inside a card: a tidy grid of "big number / small label", not a full-width strip.
function ivKpis(items){
  return '<div class="rep-kpis">'+items.map(function(i){
    return '<div class="rep-kpi"><div class="rep-kpi-v">'+htmlEsc(String(i.v))+'</div><div class="rep-kpi-l">'+htmlEsc(i.label)+'</div></div>';
  }).join('')+'</div>';
}
function ivToggle(canTeam,view){
  if(!canTeam) return '';
  return '<div class="rep-fgroup" style="margin-bottom:14px">'+[['personal','My leads'],['team','Team']].map(function(t){
    return '<button class="rep-pill'+(view===t[0]?' on':'')+'" onclick="switchLeadInsights(\''+t[0]+'\')">'+t[1]+'</button>';
  }).join('')+'</div>';
}

function renderBDInsights(){
  var u=STATE.user;
  var d=STATE.bdInsightsData;

  // Personal | Team toggle — shown only to a user who actually leads a lead-gen
  // team (has at least one BD/BD Lead anywhere in their reporting subtree). The
  // Team view reuses the shared team lead-gen body so it stays consistent with
  // the My Team → Team Insights tab.
  var canTeam=window.reportingSubtree&&reportingSubtree(u.id).some(function(x){return userHasAnyRole(x,'bd','bd_lead');});
  var view=(canTeam&&STATE.bdInsightsView==='team')?'team':'personal';
  var toggle=ivToggle(canTeam,view);
  if(view==='team') return '<div class="page">'+toggle+renderTeamInsightsBody()+'</div>';

  if(!d){
    return '<div class="page">'+toggle+'<div class="ph"><div class="ptitle">Outreach Insights</div><div class="psub">Loading your performance data…</div></div>'+
      UI.strip([{v:'—',label:'Emails sent'},{v:'—',label:'Leads assigned'},{v:'—',label:'Converted'},{v:'—',label:'Conv rate'}])+'</div>';
  }

  var total=d.total_all||0, funnelMax=Math.max(1,total);
  function fRow(label,val,tone){ var pct=total?Math.round(val/total*100):0; return ivRow(label,val,funnelMax,tone,pct,label+': '+val+' of '+total+' leads ('+pct+'%)'); }
  var funnel=
    fRow('Assigned (in queue)',d.assigned,'muted')+
    fRow('Positive (interested)',d.positive,'info')+
    fRow('Connected / In Discussion',d.converted,'go')+
    fRow('No Response / Negative',d.negative,'stop')+
    fRow('Out of Office',d.ooo,'wait')+
    fRow('Future follow-up',d.future,'brand');

  var stg=d.by_stage||{};
  var stgOrder=['Connected','In Discussion','Positive','Assigned','No Response','Negative','Future','Out of Office'];
  var stgMax=Math.max(1,Math.max.apply(null,stgOrder.map(function(k){return stg[k]||0;})));
  var stgRows=stgOrder.filter(function(k){return stg[k]>0;}).map(function(k){ return ivRow(k,stg[k],stgMax,IV_TONE[k]||'muted',null,k+': '+stg[k]+' lead'+(stg[k]===1?'':'s')); }).join('');

  var ind=d.by_industry||{};
  var indEntries=Object.keys(ind).map(function(k){return{k:k,v:ind[k]};}).sort(function(a,b){return b.v-a.v;}).slice(0,8);
  var indMax=Math.max(1,indEntries.length?indEntries[0].v:1);
  var indRows=indEntries.map(function(e){ return ivRow(e.k,e.v,indMax,'brand',null,e.k+': '+e.v+' lead'+(e.v===1?'':'s')); }).join('');

  return '<div class="page">'+toggle+
    '<div class="ph"><div class="flex aic gap2">'+
      av(u,'40')+
      '<div><div class="ptitle" style="margin:0">Outreach Insights</div><div class="psub" style="margin:0">Your personal lead-gen performance</div></div>'+
    '</div></div>'+

    UI.strip([
      {v:d.emails_sent,label:'Emails sent · 30 days'},
      {v:d.total_all,label:'Leads assigned · total'},
      {v:d.converted,label:'Converted · connected + in discussion'},
      {v:d.conv_rate+'%',label:'Conv rate · of total leads'}
    ])+

    '<div class="rep-grid">'+
    ivCard('Email pipeline',null,ivKpis([
      {v:d.emails_sent_today,label:'Sent today'},
      {v:d.emails_sent,label:'Sent · 30 days'},
      {v:d.emails_pending,label:'Pending'},
      {v:d.emails_failed,label:'Failed'},
      {v:d.response_rate+'%',label:'Response rate'}
    ]))+
    ivCard('Leads assigned',null,ivKpis([
      {v:d.total_today,label:'Today'},
      {v:d.total_week,label:'Last 7 days'},
      {v:d.total_month,label:'Last 30 days'}
    ]))+
    '</div>'+

    '<div class="rep-grid">'+
      ivCard('Emails sent — last 7 days','Each column is a day; the green one is today.',ivCols(d.last_7_emails,'info','Emails sent'))+
      ivCard('Leads assigned — last 7 days','Each column is a day; the green one is today.',ivCols(d.last_7_leads,'brand','Leads assigned'))+
    '</div>'+

    '<div class="rep-grid rep-grid3">'+
      ivCard('Conversion funnel','Share of your '+total+' leads at each point.',funnel)+
      ivCard('Stage breakdown',null,stgRows||'<div class="fs-13 c-text3">No leads yet.</div>')+
      ivCard('By industry',null,indRows||'<div class="fs-13 c-text3">No leads yet.</div>')+
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

  // ── Drill-down: individual BD Manager ──
  if(selectedBD){
    var tDrill=bdTeamData(); var row=bdStatsFromServer(tDrill).filter(function(r){return r.bd.id===selectedBD;})[0];
    if(!row)return bdTeamStatus(tDrill)||'<div class="c-text3" style="padding:40px;text-align:center">Not in your team</div>';
    var P=row._p;
    var stgOrder=['Connected','In Discussion','Positive','Assigned','No Response','Negative','Future','Out of Office'];
    var stgMax=Math.max(1,Math.max.apply(null,stgOrder.map(function(k){return (P.by_stage||{})[k]||0;})));
    var stgRows=stgOrder.map(function(k){
      var cnt=(P.by_stage||{})[k]||0; if(!cnt)return'';
      return ivRow(k,cnt,stgMax,IV_TONE[k]||'muted',null,k+': '+cnt+' lead'+(cnt===1?'':'s'));
    }).join('');
    return ''+
      '<div class="ph"><div class="flex aic gap3">'+
        '<button onclick="STATE.bdLeadSelectedBD=null;render()" class="rep-pill" title="Back to the team">← Team</button>'+
        av(row.bd,'40')+
        '<div><div class="ptitle" style="margin:0">'+htmlEsc(row.bd.name)+'</div><div class="psub" style="margin:0">BD Manager performance</div></div>'+
      '</div></div>'+
      UI.strip([{v:P.total_today,label:'Today'},{v:P.total_week,label:'Last 7 days'},{v:P.total_month,label:'Last 30 days'},{v:P.converted,label:'Converted'}])+
      '<div class="rep-grid">'+
        ivCard('Email pipeline',null,
          ivKpis([{v:P.emails_sent,label:'Sent · 30 days'},{v:P.emails_pending,label:'Pending'}])+
          '<div class="fs-12 c-text3" style="margin-top:10px">Conversion <strong>'+P.conv_rate+'%</strong> · Replied <strong>'+P.replied+' ('+P.reply_rate+'%)</strong> · Positive <strong>'+P.positive+'</strong> · Negative <strong>'+(P.negative||0)+'</strong></div>')+
        ivCard('Stage breakdown',null,stgRows||'<div class="fs-13 c-text3">No leads.</div>')+
      '</div>';
  }

  // ── Team overview ──
  // Membership is the FULL reporting subtree (users.manager_id, direct +
  // transitive) filtered to BD/BD Lead — so a lead sees everyone under them, not
  // just their first-level reports. Reparenting is admin-only (Admin → user →
  // Reporting Hierarchy); this is a read-only performance view.
  var tTeam=bdTeamData();
  var bdStats=bdStatsFromServer(tTeam);
  var myBDs=bdStats.map(function(r){return r.bd;});
  var leader=bdStats.find(function(r){return r.total>0&&r.convRate>0;})||(bdStats.find(function(r){return r.total>0;})||null);
  var leaderBanner=leader?
    '<div class="iv-top">'+
      '<div class="iv-top-ico">★</div><div style="flex:1;min-width:0">'+
        '<div class="rep-flbl">Top performer</div>'+
        '<div class="fs-20" style="font-weight:700">'+htmlEsc(leader.bd.name)+'</div>'+
        '<div class="fs-12 c-text3" style="margin-top:2px">'+leader.convRate+'% conversion · '+leader.month+' leads in 30 days</div></div>'+
      '<div style="text-align:right"><div class="fs-28" style="font-weight:700;line-height:1">'+leader.convRate+'%</div><div class="fs-11 c-text3">conversion</div></div>'+
    '</div>':'';
  var teamTotal=bdStats.reduce(function(s,r){return s+r.total;},0);
  var teamSent=bdStats.reduce(function(s,r){return s+r.sent;},0);
  var teamConv=bdStats.reduce(function(s,r){return s+r.conv;},0);
  var teamConvRate=teamTotal?Math.round(teamConv/teamTotal*100):0;
  var board=UI.table({
    cols:['BD Manager','Today','7 days','30 days','Sent (30d)','Positive','Replied %','Conv %'],
    rows:bdStats.map(function(r,i){
      return {onclick:"STATE.bdLeadSelectedBD='"+r.bd.id+"';render()", cells:[
        '<div style="display:flex;align-items:center;gap:9px"><span class="fs-11 c-text3" style="font-weight:700;min-width:16px">'+(i+1)+'</span>'+av(r.bd,'28')+'<span style="font-weight:600">'+htmlEsc(r.bd.name)+'</span></div>',
        r.today,r.week,r.month,r.sent,r.pos,r.replyRate+'%',r.convRate+'%'
      ]};
    }),
    empty:'No BD Managers report to you yet.<br><br>An admin sets reporting lines on the Admin → user page.'
  });
  return ''+
    '<div class="ph"><div class="flex jb aic">'+
      '<div><div class="ptitle">Team Insights</div><div class="psub">'+myBDs.length+' BD Manager'+(myBDs.length!==1?'s':'')+' · '+teamTotal+' leads · '+teamSent+' emails sent</div></div>'+
    '</div></div>'+
    leaderBanner+
    UI.strip([{v:teamTotal,label:'Total leads'},{v:teamSent,label:'Emails sent'},{v:teamConvRate+'%',label:'Team conversion'}])+
    '<div class="card rep-card rep-tablecard" style="margin-top:14px">'+
      '<div class="rep-tablehead"><div class="rep-ttl" style="margin:0">BD Manager performance</div><span class="rep-sub" style="margin:0">click a row for detail</span></div>'+
      (bdTeamStatus(tTeam)||board)+
    '</div>';
}
