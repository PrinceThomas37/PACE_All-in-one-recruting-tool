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
      conv:p.converted,pos:p.positive,sent:p.emails_sent,replied:p.replied,replyRate:p.reply_rate,convRate:p.conv_rate,bounceRate:p.bounce_rate,openRate:p.open_rate,_p:p};
  }).sort(function(a,b){return b.convRate-a.convRate;});
}
// A rate that could not be measured reads "—", never 0% (a person with no tracked emails has no open rate, not a zero one).
function ivRate(v){ return v==null?'\u2014':v+'%'; }
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
      cols:['BD Manager','Today','7 days','30 days','Sent (30d)','Positive','Replied %','Bounced %','Opened %','Conv %'],
      rows:bdStats.map(function(r,i){ return {cells:[ivWho(i,r.bd),r.today,r.week,r.month,r.sent,r.pos,r.replyRate+'%',ivRate(r.bounceRate),ivRate(r.openRate),r.convRate+'%']}; }),
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
  // Personal: how your SEQUENCES are doing — each number once (owner, 19 Oct, D-0160, R-278). The funnel, stage breakdown and
  // industry bars below repeated the same stage counts; leads by stage now live on Today ("Your pipeline") and in Reports.
  return renderOutreachInsights(toggle);

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
      {v:d.response_rate+'%',label:'Response rate'},
      {v:ivRate(d.bounce_rate),label:'Bounced · of people emailed'},
      {v:ivRate(d.open_rate),label:'Opened · of tracked emails'}
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
          ivKpis([{v:P.emails_sent,label:'Sent · 30 days'},{v:P.emails_pending,label:'Pending'},{v:ivRate(P.bounce_rate),label:'Bounced'},{v:ivRate(P.open_rate),label:'Opened'}])+
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
    cols:['BD Manager','Today','7 days','30 days','Sent (30d)','Positive','Replied %','Bounced %','Opened %','Conv %'],
    rows:bdStats.map(function(r,i){
      return {onclick:"STATE.bdLeadSelectedBD='"+r.bd.id+"';render()", cells:[
        '<div style="display:flex;align-items:center;gap:9px"><span class="fs-11 c-text3" style="font-weight:700;min-width:16px">'+(i+1)+'</span>'+av(r.bd,'28')+'<span style="font-weight:600">'+htmlEsc(r.bd.name)+'</span></div>',
        r.today,r.week,r.month,r.sent,r.pos,r.replyRate+'%',ivRate(r.bounceRate),ivRate(r.openRate),r.convRate+'%'
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

// ════════════════════════════════════════════════════════════════
// OUTREACH INSIGHTS — sequence analytics (R-278, D-0160; drawn at https://claude.ai/artifact/DF9nDByMp9grLCrBT2ggCo)
// Five numbers once, one line chart (emailed / opened / replied, by day or week), one row per sequence. The server counts
// (GET /insights/outreach → services/outreach-insights.js); this page only draws.
// ════════════════════════════════════════════════════════════════
function oiState(){ return STATE.oi||(STATE.oi={ from:'', to:'', bucket:'day', seq:'all', data:null, loading:false, err:'' }); }
function loadOutreachInsights(){
  var o=oiState(); o.loading=true; o.err='';
  var tz=(insightsTzQ()||'').replace(/^\?/,'');
  var q=['bucket='+encodeURIComponent(o.bucket),'seq='+encodeURIComponent(o.seq)];
  if(o.from) q.push('from='+o.from); if(o.to) q.push('to='+o.to); if(tz) q.push(tz);
  apiGet('/insights/outreach?'+q.join('&')).then(function(d){ o.data=d; o.zoom=null; o.loading=false; if(!o.from){ o.from=d.from; o.to=d.to; } if(STATE.page==='bdinsights') render(); })
    .catch(function(e){ o.loading=false; o.err=(e&&e.message)||'Could not load'; if(STATE.page==='bdinsights') render(); });
}
window.oiSet=function(k,v){ var o=oiState(); o[k]=v; loadOutreachInsights(); if(o.drill) oiLoadDrill(); render(); };
// R-316 (owner 26 Oct: "click Bounced / Replied / Interested / Opened → the email IDs and leads behind it … download to Excel … by
// industry and time zone"). A tile opens the people behind its number, counted by the server with the SAME rules as the tile
// (GET /insights/outreach/people → services/outreach-insights.js peopleBehind), for the same dates and sequence.
var OI_KINDS={emailed:'People emailed',opened:'Opened',replied:'Replied',interested:'Interested',bounced:'Bounced'};
function oiQuery(extra){
  var o=oiState(), tz=(insightsTzQ()||'').replace(/^\?/,'');
  var q=['seq='+encodeURIComponent(o.seq)];
  if(o.from) q.push('from='+o.from); if(o.to) q.push('to='+o.to); if(tz) q.push(tz);
  return q.concat(extra||[]).join('&');
}
function oiLoadDrill(){
  var o=oiState(), d=o.drill; if(!d) return;
  d.loading=true; d.err=''; var asked=d.kind+'|'+oiQuery();
  d.asked=asked;
  apiGet('/insights/outreach/people?'+oiQuery(['kind='+encodeURIComponent(d.kind)])).then(function(r){
    if(!o.drill||o.drill.asked!==asked) return;   // another tile or filter was picked meanwhile
    d.rows=(r&&r.people)||[]; d.from=r&&r.from; d.to=r&&r.to; d.loading=false; if(STATE.page==='bdinsights') render();
  }).catch(function(e){ if(!o.drill||o.drill.asked!==asked) return; d.loading=false; d.err=(e&&e.message)||'Could not load'; if(STATE.page==='bdinsights') render(); });
}
window.oiOpen=function(kind){
  var o=oiState();
  if(o.drill&&o.drill.kind===kind){ o.drill=null; render(); return; }   // the same tile again closes it
  o.drill={kind:kind,rows:null,loading:true,err:''}; oiLoadDrill(); render();
};
window.oiCloseDrill=function(){ oiState().drill=null; render(); };
// The list as a file Excel opens (comma-separated, with the mark Excel needs to read accents and non-English names correctly).
function oiCsv(rows){
  var cols=[['Name','name'],['Email','email'],['Company','company'],['Position','position'],['Industry','industry'],['Time zone','timezone'],['Type','type'],
    ['Emails sent','emails'],['First sent','first_day'],['Last sent','last_day'],['Opened','opened'],['Replied on','replied_day'],['Stage','stage'],['Bounced','bounce_kind'],['Sequences','sequences']];
  var cell=function(v){ if(v===true) v='Yes'; else if(v===false) v='No'; else if(Array.isArray(v)) v=v.join('; '); v=(v==null?'':String(v));
    if(/^[=+\-@]/.test(v)) v="'"+v;   // a value starting like a formula is shown as text, never run by the spreadsheet
    return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  return '\ufeff'+[cols.map(function(c){return c[0];}).join(',')].concat((rows||[]).map(function(r){ return cols.map(function(c){ return cell(r[c[1]]); }).join(','); })).join('\r\n');
}
window.oiCsv=oiCsv;
window.oiDownload=function(){
  var o=oiState(), d=o.drill; if(!d||!d.rows) return;
  var name='outreach-'+d.kind+'-'+(d.from||o.from)+'-to-'+(d.to||o.to)+'.csv';
  var blob=new Blob([oiCsv(d.rows)],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },500);
};
function oiDrillCard(){
  var o=oiState(), d=o.drill; if(!d) return '';
  var label=OI_KINDS[d.kind]||'People';
  var n=d.rows?d.rows.length:null;
  var head='<div class="oi-drill-h"><div><div class="td-h" style="margin:0">'+htmlEsc(label.toUpperCase())+(n!=null?' · '+n.toLocaleString('en-US')+' '+(n===1?'person':'people'):'')+'</div>'+
    '<div class="fs-12 c-text3">'+htmlEsc((d.from||o.from)+' to '+(d.to||o.to))+' · the same people the number counts</div></div>'+
    '<div class="oi-drill-acts">'+(d.rows&&d.rows.length?'<button class="btn btn-outline btn-sm" onclick="oiDownload()">'+ico('download',12)+' Download for Excel</button>':'')+
    '<button class="btn-icon" onclick="oiCloseDrill()" aria-label="Close">'+ico('x',14)+'</button></div></div>';
  var body;
  if(d.err) body='<div class="fs-13 c-red">Could not load: '+htmlEsc(d.err)+'</div>';
  else if(!d.rows) body='<div class="fs-13 c-text3">Loading…</div>';
  else if(!d.rows.length) body='<div class="fs-13 c-text3">Nobody in these dates.</div>';
  else body='<div class="td-scroll"><table class="td-table oi-table oi-drill-table"><thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Position</th><th>Industry</th><th>Time zone</th><th>Emails</th><th>Last sent</th><th>Opened</th><th>Replied</th><th>Stage</th></tr></thead><tbody>'+
    d.rows.map(function(r){ return '<tr><td class="fw6">'+htmlEsc(r.name||'—')+(r.type==='candidate'?' <span class="c-text3">(candidate)</span>':'')+'</td><td>'+htmlEsc(r.email||'')+'</td><td>'+htmlEsc(r.company||'')+'</td><td>'+htmlEsc(r.position||'')+'</td><td>'+htmlEsc(r.industry||'')+'</td><td>'+htmlEsc(r.timezone||'')+'</td><td>'+r.emails+'</td><td>'+htmlEsc(r.last_day||'')+'</td><td>'+(r.opened?'Yes':(r.tracked?'No':'—'))+'</td><td>'+htmlEsc(r.replied_day||'')+'</td><td>'+(r.bounced?'<span class="c-red">'+(r.bounce_kind==='blocked'?'Blocked — their side rejects our mail':'Invalid address')+'</span>':htmlEsc(r.stage||''))+'</td></tr>'; }).join('')+
    '</tbody></table></div>';
  return '<div class="card oi-card oi-drill" data-oi-drill>'+head+body+'</div>';
}
function oiSplitCard(title,list){
  var rows=(list||[]).map(function(g){ return '<tr><td class="fw6">'+htmlEsc(g.name)+'</td><td>'+oiNum(g.people)+'</td><td>'+oiNum(g.emailed)+'</td><td>'+oiNum(g.replied_rate,'%')+'</td><td>'+oiNum(g.interested)+'</td><td>'+oiNum(g.bounced_rate,'%')+'</td></tr>'; }).join('');
  return '<div class="card oi-card"><div class="td-h">'+title+'</div>'+(rows?'<div class="td-scroll"><table class="td-table oi-table"><thead><tr><th>'+(title==='BY INDUSTRY'?'Industry':'Time zone')+'</th><th>People</th><th>Emailed</th><th>Replied</th><th>Interested</th><th>Bounced</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    :'<div class="fs-13 c-text3">Nothing to split in these dates.</div>')+'</div>';
}
function oiNum(v,suffix){ return v==null?'—':(typeof v==='number'?v.toLocaleString('en-US'):v)+(v==null?'':(suffix||'')); }
// ZOOM (R-319, owner's 28 notes: "graph zoom by scroll / pinch"). A window onto the days: o.zoom = { a, b } (first and last day shown),
// null = all of them. The rule is oiZoomWindow (pure, below); oiChartBlock draws the chart and its small zoom bar.
function oiChart(series,bucket,zoom){
  var all=series.length, sub=(zoom&&zoom.b-zoom.a+1<all)?series.slice(zoom.a,zoom.b+1):series; series=sub;
  var W=1140,H=300,L=44,R=1130,T=20,B=260;
  var max=Math.max(1,series.reduce(function(m,p){ return Math.max(m,p.emailed,p.opened,p.replied); },0));
  var step=series.length>1?(R-L)/(series.length-1):0;
  var x=function(i){ return L+i*step; }, y=function(v){ return B-(v/max)*(B-T); };
  function line(k,cls){ return '<polyline class="oi-line '+cls+'" fill="none" points="'+series.map(function(p,i){ return x(i).toFixed(1)+','+y(p[k]).toFixed(1); }).join(' ')+'"></polyline>'; }
  var grid=[0,0.25,0.5,0.75,1].map(function(f){ var v=Math.round(max*f), yy=y(v); return '<line class="oi-grid" x1="'+L+'" y1="'+yy+'" x2="'+R+'" y2="'+yy+'"></line><text class="oi-ax" x="'+(L-6)+'" y="'+(yy+4)+'" text-anchor="end">'+v+'</text>'; }).join('');
  var every=Math.max(1,Math.ceil(series.length/8));
  var labels=series.map(function(p,i){ if(i%every&&i!==series.length-1) return ''; var d=new Date(p.key+'T00:00:00Z'); return '<text class="oi-ax" x="'+x(i)+'" y="'+(B+20)+'" text-anchor="'+(i===series.length-1&&series.length>1?'end':(i===0?'start':'middle'))+'">'+(bucket==='week'?'wk ':'')+d.toLocaleDateString('en-US',{day:'numeric',month:'short',timeZone:'UTC'})+'</text>'; }).join('');
  // a point per day with its counts in a tooltip — hovering a day shows that day's numbers
  var hits=series.map(function(p,i){ return '<circle class="oi-hit" cx="'+x(i)+'" cy="'+y(p.emailed)+'" r="6"><title>'+p.key+': '+p.emailed+' emailed, '+p.opened+' opened, '+p.replied+' replied</title></circle>'; }).join('');
  return '<svg class="oi-chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Emailed, opened and replied '+(bucket==='week'?'each week':'each day')+'">'+grid+
    '<line class="oi-axis" x1="'+L+'" y1="'+B+'" x2="'+R+'" y2="'+B+'"></line>'+labels+line('emailed','oi-emailed')+line('opened','oi-opened')+line('replied','oi-replied')+hits+'</svg>';
}
var OI_MIN_DAYS=3;
// The window after a zoom. n = how many days there are; win = {a,b} or null (all); at = where the pointer is across the plot, 0..1;
// factor > 1 shows MORE days (zoom out), < 1 FEWER (zoom in). The day under the pointer stays under the pointer. Returns null when the
// result is "all of them", so the chart is in its plain state again.
window.oiZoomWindow=function(n,win,at,factor){
  if(!(n>1)) return null;
  var a=win?win.a:0, b=win?win.b:n-1, size=b-a+1;
  var minSize=Math.min(OI_MIN_DAYS,n);
  var next=Math.max(minSize,Math.min(n,Math.round(size*factor)));
  if(next===size&&factor!==1) next=factor<1?Math.max(minSize,size-1):Math.min(n,size+1);   // a small nudge still moves by a whole day
  if(next>=n) return null;
  var f=Math.max(0,Math.min(1,at==null?0.5:at)), anchor=a+f*(size-1);
  var na=Math.round(anchor-f*(next-1));
  na=Math.max(0,Math.min(n-next,na));
  return { a:na, b:na+next-1 };
};
// Dragging moves the window along by whole days (dx = the drag as a share of the plot's width; right = earlier days).
window.oiPanWindow=function(n,win,dxShare){
  if(!win||!(n>1)) return win||null;
  var size=win.b-win.a+1, shift=Math.round(-dxShare*(size-1));
  var na=Math.max(0,Math.min(n-size,win.a+shift));
  return { a:na, b:na+size-1 };
};
function oiChartBlock(d,o){
  if(!d||!d.series||!d.series.length) return '';
  var n=d.series.length, z=o.zoom&&o.zoom.b-o.zoom.a+1<n?o.zoom:null;
  var canIn=n>OI_MIN_DAYS&&(!z||z.b-z.a+1>OI_MIN_DAYS);
  var bar='<div class="oi-zoombar">'+
    (n>OI_MIN_DAYS?'<button type="button" class="oi-zbtn" aria-label="Zoom in" title="Zoom in" onclick="oiZoomBy(0.5)"'+(canIn?'':' disabled')+'>+</button>'+
      '<button type="button" class="oi-zbtn" aria-label="Zoom out" title="Zoom out" onclick="oiZoomBy(2)"'+(z?'':' disabled')+'>−</button>'+
      (z?'<button type="button" class="oi-zbtn oi-zreset" onclick="oiZoomReset()">Show all</button>':'')+
      '<span class="oi-zhint">'+(z?(d.series[z.a].key+' → '+d.series[z.b].key+' · drag to move'):'Scroll or pinch the chart to zoom')+'</span>':'')+
    '</div>';
  return oiChart(d.series,d.bucket,z)+bar;
}
// Only the chart is redrawn while zooming (a page repaint per wheel tick would rebuild the tiles and tables too), at most once a frame.
// o.zoom is the state, so any later full repaint draws the same thing.
var oiRaf=0;
function oiPaintChart(){
  if(oiRaf) return;
  oiRaf=(window.requestAnimationFrame||function(f){ return setTimeout(f,16); })(function(){
    oiRaf=0;
    var o=oiState(), box=document.querySelector('[data-oi-chart]');
    if(box&&o.data) box.innerHTML=oiChartBlock(o.data,o);
  });
}
function oiSetZoom(win){ var o=oiState(); o.zoom=win; oiPaintChart(); }
window.oiZoomBy=function(factor){ var o=oiState(); if(!o.data||!o.data.series) return; oiSetZoom(oiZoomWindow(o.data.series.length,o.zoom,0.5,factor)); };
window.oiZoomReset=function(){ oiSetZoom(null); };
// The gestures, bound once to the page (the chart is redrawn, so listeners on it would be lost): wheel / trackpad pinch (a pinch arrives
// as a wheel with ctrlKey), two fingers on a screen, and a drag to move along. A wheel that would only zoom OUT of the full chart is left
// alone, so scrolling the page past the chart never gets stuck on it.
(function(){
  if(window.__oiGestures) return; window.__oiGestures=true;
  function plot(svg,clientX){ var r=svg.getBoundingClientRect(); if(!r.width) return 0.5; var vx=(clientX-r.left)/r.width*1140; return Math.max(0,Math.min(1,(vx-44)/(1130-44))); }
  function chartAt(t){ return t&&t.closest?t.closest('svg.oi-chart'):null; }
  function liveSvg(){ return document.querySelector('svg.oi-chart'); }   // the chart is redrawn while a gesture goes on: never keep the old element
  document.addEventListener('wheel',function(e){
    var svg=chartAt(e.target); if(!svg) return;
    var o=oiState(); if(!o.data||!o.data.series||o.data.series.length<=OI_MIN_DAYS) return;
    var out=e.deltaY>0; if(out&&!o.zoom) return;
    e.preventDefault();
    var k=e.ctrlKey?0.012:0.0025, f=Math.exp(e.deltaY*k);
    oiSetZoom(oiZoomWindow(o.data.series.length,o.zoom,plot(svg,e.clientX),f));
  },{passive:false});
  var ptrs={}, last=null;
  function count(){ return Object.keys(ptrs).length; }
  document.addEventListener('pointerdown',function(e){
    var svg=chartAt(e.target); if(!svg||e.pointerType==='mouse'&&e.button!==0) return;
    ptrs[e.pointerId]={x:e.clientX,y:e.clientY}; last={svg:svg,x:e.clientX,d:0};
    if(count()===2){ var p=Object.keys(ptrs).map(function(k){ return ptrs[k]; }); last.d=Math.abs(p[0].x-p[1].x)||1; }
    try{ svg.setPointerCapture(e.pointerId); }catch(_){}
  });
  document.addEventListener('pointermove',function(e){
    if(!ptrs[e.pointerId]||!last) return;
    var o=oiState(); if(!o.data||!o.data.series) return; var n=o.data.series.length;
    ptrs[e.pointerId]={x:e.clientX,y:e.clientY};
    if(count()===2){
      var p=Object.keys(ptrs).map(function(k){ return ptrs[k]; }), dist=Math.abs(p[0].x-p[1].x)||1;
      if(last.d){ var sv=liveSvg(); if(sv) oiSetZoom(oiZoomWindow(n,o.zoom,plot(sv,(p[0].x+p[1].x)/2),last.d/dist)); }
      last.d=dist; return;
    }
    if(count()===1&&o.zoom){
      var sv2=liveSvg(); if(!sv2) return; var r=sv2.getBoundingClientRect(), share=(e.clientX-last.x)/(r.width*(1086/1140)||1);
      var w=oiPanWindow(n,o.zoom,share);
      if(w&&(w.a!==o.zoom.a)){ last.x=e.clientX; oiSetZoom(w); }
    }
  });
  function up(e){ delete ptrs[e.pointerId]; if(!count()) last=null; else if(last){ last.d=0; } }
  document.addEventListener('pointerup',up); document.addEventListener('pointercancel',up);
})();
function renderOutreachInsights(toggle){
  var o=oiState();
  if(!o.data&&!o.loading&&!o.err) loadOutreachInsights();
  var d=o.data, t=(d&&d.totals)||{};
  var choices=(d&&d.choices)||[{id:'all',name:'All sequences'}];
  var controls='<div class="oi-controls">'+
    '<label class="oi-f"><span>Sequence</span><select class="sel" onchange="oiSet(\'seq\',this.value)">'+choices.map(function(c){ return '<option value="'+escAttr(c.id)+'"'+(o.seq===c.id?' selected':'')+'>'+htmlEsc(c.name)+'</option>'; }).join('')+'</select></label>'+
    '<label class="oi-f"><span>From</span><input type="date" class="inp" value="'+escAttr(o.from)+'" onchange="oiSet(\'from\',this.value)"></label>'+
    '<label class="oi-f"><span>To</span><input type="date" class="inp" value="'+escAttr(o.to)+'" onchange="oiSet(\'to\',this.value)"></label></div>';
  var head='<div class="oi-head"><div><div class="ptitle">Outreach Insights</div><div class="psub">How your sequences are doing. Each number appears once on this page.</div></div>'+controls+'</div>';
  if(o.err&&!d) return '<div class="page">'+toggle+head+'<div class="card cp c-red fs-13">Could not load: '+htmlEsc(o.err)+'</div></div>';
  // R-316: each tile opens the people behind it (click again to close)
  var tiles=[
    ['emailed',oiNum(t.people),'People emailed',(t.emailed!=null?oiNum(t.emailed)+' emails':'')],
    ['opened',oiNum(t.opened_rate,'%'),'Opened','of tracked emails'],
    ['replied',oiNum(t.replied_rate,'%'),'Replied',(t.replied!=null?oiNum(t.replied)+' people':'')],
    ['interested',oiNum(t.interested),'Interested','Connected or In discussion'],
    ['bounced',oiNum(t.bounced_rate,'%'),'Bounced',(t.bounced_invalid!=null?oiNum(t.bounced_invalid)+' invalid · '+oiNum(t.bounced_blocked)+' blocked':'bad or blocked addresses')]
  ].map(function(x){ var on=o.drill&&o.drill.kind===x[0];
    return '<button type="button" class="oi-tile oi-tile-btn'+(on?' on':'')+'" aria-pressed="'+(on?'true':'false')+'" title="See who" onclick="oiOpen(\''+x[0]+'\')"'+(d?'':' disabled')+'><span class="oi-n">'+(d?x[1]:'—')+'</span><span class="oi-l">'+x[2]+'</span><span class="oi-s">'+(d?x[3]:'')+'</span></button>'; }).join('');
  var legend='<div class="oi-legend"><span><i class="oi-key oi-emailed"></i>Emailed</span><span><i class="oi-key oi-opened"></i>Opened</span><span><i class="oi-key oi-replied"></i>Replied</span></div>';
  var buckets='<div class="oi-seg" role="group" aria-label="By day or week">'+[['day','Daily'],['week','Weekly']].map(function(b){ return '<button type="button" class="oi-segb'+(o.bucket===b[0]?' on':'')+'" aria-pressed="'+(o.bucket===b[0])+'" onclick="oiSet(\'bucket\',\''+b[0]+'\')">'+b[1]+'</button>'; }).join('')+'</div>';
  var chart='<div class="card oi-card"><div class="oi-chart-head">'+legend+buckets+'</div>'+
    (d?(d.series&&d.series.length?'<div class="oi-chart-wrap" data-oi-chart>'+oiChartBlock(d,o)+'</div>':'<div class="fs-13 c-text3">Nothing was sent in these dates.</div>'):'<div class="fs-13 c-text3">Loading…</div>')+'</div>';
  var rows=((d&&d.sequences)||[]).map(function(r){
    return '<tr><td class="fw6">'+htmlEsc(r.name)+(r.candidates?' <span class="c-text3">(candidates)</span>':'')+'</td><td>'+oiNum(r.people)+'</td><td>'+oiNum(r.emailed)+'</td><td>'+oiNum(r.opened_rate,'%')+'</td><td>'+oiNum(r.replied_rate,'%')+'</td><td>'+oiNum(r.interested)+'</td><td>'+oiNum(r.bounced_rate,'%')+'</td></tr>';
  }).join('');
  var table='<div class="card oi-card" data-oi-table><div class="td-h">BY SEQUENCE</div>'+(rows?'<div class="td-scroll"><table class="td-table oi-table"><thead><tr><th>Sequence</th><th>People</th><th>Emailed</th><th>Opened</th><th>Replied</th><th>Interested</th><th>Bounced</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    :'<div class="fs-13 c-text3">'+(d?'No sequence sent anything in these dates.':'Loading…')+'</div>')+'</div>';
  var splits=d?'<div class="oi-splits">'+oiSplitCard('BY INDUSTRY',d.by_industry)+oiSplitCard('BY TIME ZONE',d.by_timezone)+'</div>':'';
  return '<div class="page oi">'+toggle+head+'<div class="oi-tiles" data-oi-tiles>'+tiles+'</div>'+oiDrillCard()+chart+table+splits+'</div>';
}
