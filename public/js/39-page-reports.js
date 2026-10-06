// ===== RECRUITING REPORTS / ANALYTICS PAGE (additive) =====
// The team's WORK, not the size of the database (D-0077): candidates sent to the
// BD manager, sent to the client, interviews and placements, each counted on the
// day it happened (services/report-work.js). A funnel with its time-in-stage
// folded into the same rows, an 8-week trend of what was SENT, per-person work,
// hot jobs and top clients — from the one org-scoped GET /reports/recruiting.
// Managers see the whole desk; recruiters see only their own numbers.
// EVERY figure here opens the drawer of the people behind it
// (GET /reports/recruiting/rows → evidenceOpen, 64-evidence-drawer.js).

(function () {
  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function canUse(u){ return u && window.userHasAnyRole && userHasAnyRole(u,'admin','bd','bd_lead','ra_lead','recruiter'); }
  function money(n){ n = Number(n)||0; return '$'+n.toLocaleString('en-US'); }

  if (!STATE.reports) STATE.reports = { loading:false, data:null };
  STATE.reports.filters = STATE.reports.filters || { from:'', to:'', role:'', preset:'all' };
  STATE.reports.sel = STATE.reports.sel || {};
  STATE.reports.expanded = STATE.reports.expanded || {};

  function reportsQS(extra){
    var f = STATE.reports.filters||{}, p=[];
    if(extra) Object.keys(extra).forEach(function(k){ if(extra[k]!==undefined&&extra[k]!==null&&extra[k]!=='') p.push(k+'='+encodeURIComponent(extra[k])); });
    if(f.from)p.push('from='+encodeURIComponent(f.from));
    if(f.to)p.push('to='+encodeURIComponent(f.to));
    if(f.role)p.push('role='+encodeURIComponent(f.role));
    return p.length?('?'+p.join('&')):'';
  }
  // Reports can be shown either standalone (page 'reports') or as a tab in the
  // My Team hub — a full render() repaints whichever is on screen.
  function repaintReports(){ if(STATE.page==='reports'||STATE.page==='myteam'||STATE.page==='dashboard'){ if(window.render) render(); else paint(); } }
  // `quiet`: the Dashboard loads this in the background; a failure there shows
  // in the section ("No data yet") instead of a red toast on every visit.
  function loadReport(quiet){
    STATE.reports.loading = true; repaintReports();
    // Only a report-shaped answer is kept: anything else (an error body, an
    // empty list from a misrouted request) would crash the drawing — and the
    // report now sits inside the Dashboard, where a crash takes the page down.
    apiGet(withTz('/reports/recruiting'+reportsQS())).then(function(d){ STATE.reports.data = (d && !Array.isArray(d) && typeof d==='object' && Array.isArray(d.stages)) ? d : null; STATE.reports.loading = false; repaintReports(); })
      .catch(function(e){ STATE.reports.loading = false; if(quiet!==true) showToast('Failed to load reports: '+e.message,'error'); repaintReports(); });
  }
  window.reportsReload = function(){ loadReport(false); };
  window.reportsLoadQuiet = function(){ loadReport(true); };

  function ymd(d){ return d.toISOString().slice(0,10); }
  window.reportsPreset = function(preset){
    var f=STATE.reports.filters; f.preset=preset;
    if(preset==='all'){ f.from=''; f.to=''; }
    else { var days=preset==='7'?7:preset==='30'?30:90; var to=new Date(); var from=new Date(to.getTime()-days*86400000); f.from=ymd(from); f.to=ymd(to); }
    loadReport();
  };
  window.reportsDate = function(which, val){ var f=STATE.reports.filters; f[which]=val; f.preset='custom'; loadReport(); };
  window.reportsRole = function(role){ STATE.reports.filters.role=role; loadReport(); };
  window.reportsToggleSel = function(id){ if(STATE.reports.sel[id]) delete STATE.reports.sel[id]; else STATE.reports.sel[id]=true; repaintReports(); };
  window.reportsClearSel = function(){ STATE.reports.sel={}; repaintReports(); };
  window.reportsToggleExpand = function(id){ if(STATE.reports.expanded[id]) delete STATE.reports.expanded[id]; else STATE.reports.expanded[id]=true; repaintReports(); };

  // ── nav + routing (wrap, like the job-board module) ──────────────────────────
  // Drawn by the shell (UI.registerPage below) — no second repaint per render.
  // (The "Reports" nav item is now built by the sidebar in 04-shell-login.js —
  // shown standalone only to users who don't have the "My Team" hub, which
  // carries Reports as a tab. paint() sets the page title.)
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    // R-006: Reports now live ON the Dashboard. An old link to the standalone
    // page lands there instead — one place to read them, not two.
    if (p === 'reports'){ STATE.modal=null; if(window.dashScrollToReports){ dashScrollToReports(); return; } STATE.page='reports'; render(); loadReport(); return; }
    return _prevGoPage.apply(this, arguments);
  };
  function paint(){ if(STATE.page!=='reports') return; paintPageContent(); }
  UI.registerPage('reports', function(){ return renderReports(); });

  // THE RETRO CHARTS (R-122 step 3). Every bar is a square paper track with a
  // hard outline and a segmented fill (the 90s level meter), coloured by what
  // the stage MEANS rather than by the old blue ramp: purple = with the BD manager,
  // blue = sent to the client, amber = in interviews, green = won, red =
  // lost, grey = parked. The looks are classes (retro.css .rep-*); only the
  // number-driven size is inline. An unknown stage draws purple, never nothing.
  var STAGE_TONE = {
    'Sourced':'brand', 'Screening':'brand',
    'Submitted to BDM':'brand', 'Submitted to Client':'info',
    'Interview Scheduled':'wait', 'Interview Completed':'wait',
    'Offer':'go', 'Joining':'go', 'Placement':'go',
    'Not Accepted':'stop', 'On Hold':'muted'
  };
  function toneOf(stage){ return STAGE_TONE[stage] || 'brand'; }

  // ── DRILL-DOWN: every number opens the people behind it (D-0077) ─────────────
  // The owner: "when we hover over the data points or click them nothing
  // happens, it does not show the data from which this is drawn". The list comes
  // from GET /reports/recruiting/rows, which asks the SAME rule the count does
  // (services/report-work.js members()), so the two cannot disagree.
  var METRIC_INFO = {
    to_bdm:     { t:'Sent to the BD manager', h:'Candidates a recruiter sent to the BD manager, counted on the day they were sent.' },
    to_client:  { t:'Sent to the client',     h:'Candidates sent to the client, counted on the day they were sent.' },
    interviews: { t:'Interviews',             h:'Candidates who got an interview scheduled, counted on that day.' },
    placements: { t:'Placements',             h:'Candidates placed, counted on the day of the placement.' },
    stalled:    { t:'Waiting on the BD manager', h:'Sent to the BD manager and not yet sent to the client — as of today.' }
  };
  function periodText(){ var f=STATE.reports.filters||{}; if(f.from&&f.to) return f.from+' to '+f.to; if(f.from) return 'from '+f.from; if(f.to) return 'until '+f.to; return 'all time'; }
  function metricInfo(m){
    if(METRIC_INFO[m]) return METRIC_INFO[m];
    var d=(STATE.reports.data||{}), sd=d.stuck_days||14, k=m.indexOf(':'), st=m.slice(k+1);
    if(m.indexOf('reached:')===0) return { t:st, h:'Candidates who reached "'+st+'", counted on the day they first got there.' };
    if(m.indexOf('parked:')===0)  return { t:st, h:'Candidates now at "'+st+'", counted on the day they were moved there.' };
    if(m.indexOf('now:')===0)     return { t:st+' — right now', h:'Candidates sitting at "'+st+'" today.' };
    if(m.indexOf('stuck:')===0)   return { t:st+' — stuck', h:'Candidates who have sat at "'+st+'" for '+sd+' days or more, as of today.' };
    return { t:'Candidates', h:'' };
  }
  function isNow(m){ return m==='stalled'||m.indexOf('now:')===0||m.indexOf('stuck:')===0; }
  function dayLabel(iso){ var d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
  function drillRow(r){
    return {
      primary:r.candidate,
      secondary:[r.job_title?(r.job_title+(r.job_code?' ('+r.job_code+')':'')):'',r.client||''].filter(Boolean).join(' · '),
      chips:[r.stage].filter(Boolean),
      when:dayLabel(r.at)+(r.recruiter?' · '+r.recruiter:''),
      pick:(r.candidate_id&&window.bdOpenCandidate)?function(){ bdOpenCandidate(r.candidate_id); }:undefined
    };
  }
  function drill(title,hint,extra){
    if(!window.evidenceOpen) return;
    evidenceOpen({ title:title, hint:hint, load:function(){
      return apiGet(withTz('/reports/recruiting/rows'+reportsQS(extra))).then(function(d){
        return { items:((d&&d.rows)||[]).map(drillRow), total:d&&d.total, more:d&&d.more };
      });
    }});
  }
  window.reportsDrillM = function(m, extra){
    var i=metricInfo(m);
    drill(i.t, i.h+(isNow(m)?'':' Period: '+periodText()+'.'), Object.assign({ metric:m }, extra||{}));
  };
  window.reportsDrillUser = function(uid, m){
    var u=((STATE.reports.data||{}).by_user||[]).filter(function(x){ return x.user_id===uid; })[0], i=metricInfo(m);
    drill((u?u.recruiter+' — ':'')+i.t, i.h+(isNow(m)?'':' Period: '+periodText()+'.'), { metric:m, user_id:uid });
  };
  window.reportsDrillWeek = function(kind, ago){
    var t=((STATE.reports.data||{}).trend||[]).filter(function(x){ return x.ago===ago; })[0], i=METRIC_INFO[kind];
    drill(i.t+' — '+(t?t.week:''), i.h+' One of the last eight weeks, whatever period is chosen above.', { kind:kind, ago:ago });
  };
  window.reportsDrillClient = function(idx){
    var c=((STATE.reports.data||{}).top_clients||[])[idx]; if(!c) return;
    drill(c.client+' — sent to the client', METRIC_INFO.to_client.h+' Period: '+periodText()+'.', { metric:'to_client', client:c.client });
  };
  window.reportsDrillJob = function(idx){
    var j=((STATE.reports.data||{}).hot_jobs||[])[idx]; if(!j) return;
    drill((j.job_title||'Job')+' — sent', METRIC_INFO.to_bdm.h+' Period: '+periodText()+'.', { metric:'to_bdm', job_order_id:j.job_order_id });
  };

  // THE FUNNEL, WITH TIME IN STAGE FOLDED IN (D-0077). It used to be three
  // screens saying the same thing (a pipeline card, this funnel, and a separate
  // time-in-stage table). One row now says: who reached the stage, how long
  // people typically stay, and how many are stuck.
  function funnelCard(d){
    var funnel=d.funnel||{}, stages=d.stages||[], tis={};
    (d.stage_time||[]).forEach(function(x){ tis[x.stage]=x; });
    var max = Math.max(1, Math.max.apply(null, stages.map(function(s){ return funnel[s]||0; })));
    var parked = reportsParkedSet();
    var rows = stages.map(function(s){
      var n = funnel[s]||0, w = Math.round((n/max)*100), t = tis[s]||{}, m = (parked[s]?'parked:':'reached:')+s;
      var meta = '';
      if(t.typical_days!=null && !t.final) meta += '<span class="rep-tis" title="Typical time people spend at this stage">typ. '+t.typical_days+'d</span>';
      if(t.stuck) meta += '<span class="rep-stuckchip" onclick="event.stopPropagation();reportsDrillM(\'stuck:'+esc(s)+'\')" title="Who has sat here '+(d.stuck_days||14)+' days or more">'+t.stuck+' stuck</span>';
      return '<div class="rep-row is-click" onclick="reportsDrillM(\''+m+'\')" title="'+esc(s)+': '+n+' — click to see who">'+
        '<div class="rep-lbl">'+esc(s)+'</div>'+
        '<div class="rep-track"><div class="rep-fill tone-'+toneOf(s)+(n?'':' is-empty')+'" style="width:'+w+'%"></div></div>'+
        '<div class="rep-num'+(n?'':' is-zero')+'">'+n+'</div>'+
        '<div class="rep-meta">'+meta+'</div>'+
      '</div>';
    }).join('');
    return '<div class="card rep-card"><div class="rep-ttl">Work funnel</div>'+
      '<div class="rep-sub">Candidates who reached each stage in the period. Click a bar to see who.</div>'+rows+'</div>';
  }
  function reportsParkedSet(){ return { 'Not Accepted':1, 'On Hold':1 }; }

  // WHAT WAS SENT, WEEK BY WEEK: two columns per week — sent to the BD manager
  // and sent to the client — never "candidates added to a job" (D-0029, D-0077).
  function trendCard(trend){
    var max = Math.max(1, Math.max.apply(null, trend.map(function(t){ return Math.max(t.to_bdm||0, t.to_client||0); })));
    function bar(t, key, tone, lbl){
      var n = t[key]||0, h = n ? Math.max(8, Math.round((n/max)*96)) : 0;
      return '<div class="rep-bar1'+(n?' is-click':'')+'"'+(n?' onclick="reportsDrillWeek(\''+key+'\','+t.ago+')"':'')+' title="'+esc(lbl)+', '+esc(t.week)+': '+n+(n?' — click to see who':'')+'">'+
        '<div class="rep-colv'+(n?'':' is-zero')+'">'+n+'</div>'+
        '<div class="rep-colbar tone-'+tone+(n?'':' is-zero')+'"'+(n?' style="height:'+h+'px"':'')+'></div>'+
      '</div>';
    }
    var cols = trend.map(function(t){ return '<div class="rep-col"><div class="rep-pair">'+bar(t,'to_bdm','brand','Sent to the BD manager')+bar(t,'to_client','info','Sent to the client')+'</div></div>'; }).join('');
    var weeks = trend.map(function(t){ return '<div class="rep-colw">'+esc(t.week)+'</div>'; }).join('');
    return '<div class="card rep-card"><div class="rep-ttl">Sent &mdash; last 8 weeks</div>'+
      '<div class="rep-legend"><span><i class="rep-key tone-brand"></i>Sent to the BD manager</span><span><i class="rep-key tone-info"></i>Sent to the client</span></div>'+
      '<div class="rep-cols">'+cols+'</div><div class="rep-weeks">'+weeks+'</div></div>';
  }

  function clientsCard(rows){
    if (!rows.length) return '';
    var max = Math.max(1, Math.max.apply(null, rows.map(function(r){ return r.count; })));
    var body = rows.map(function(r, i){
      var w = Math.round((r.count/max)*100);
      return '<div class="rep-row is-click" onclick="reportsDrillClient('+i+')" title="'+esc(r.client)+': '+r.count+' sent to the client — click to see who">'+
        '<div class="rep-lbl is-name">'+esc(r.client)+'</div>'+
        '<div class="rep-track"><div class="rep-fill tone-brand" style="width:'+w+'%"></div></div>'+
        '<div class="rep-num">'+r.count+'</div>'+
      '</div>';
    }).join('');
    return '<div class="card rep-card"><div class="rep-ttl">Top clients &mdash; sent to the client</div>'+body+'</div>';
  }

  function filterBar(d){
    var f = STATE.reports.filters||{};
    function pill(active,label,onclick){
      return '<button onclick="'+onclick+'" class="rep-pill'+(active?' on':'')+'">'+label+'</button>';
    }
    var presetBtns=[['7','7d'],['30','30d'],['90','90d'],['all','All']].map(function(p){ return pill((f.preset||'all')===p[0],p[1],"reportsPreset('"+p[0]+"')"); }).join('');
    var roleBtns=[['','All'],['bd','BDs'],['recruiter','Recruiters']].map(function(r){ return pill((f.role||'')===r[0],r[1],"reportsRole('"+r[0]+"')"); }).join('');
    return '<div class="card rep-filters">'+
      '<div class="rep-fgroup"><span class="rep-flbl">Period</span>'+presetBtns+
        '<input type="date" class="rep-date" value="'+esc(f.from||'')+'" onchange="reportsDate(\'from\',this.value)"/>'+
        '<span class="rep-fto">to</span>'+
        '<input type="date" class="rep-date" value="'+esc(f.to||'')+'" onchange="reportsDate(\'to\',this.value)"/>'+
      '</div>'+
      '<div class="rep-fgroup"><span class="rep-flbl">Who</span>'+roleBtns+'</div>'+
    '</div>';
  }

  function hotJobsCard(rows){
    if(!rows||!rows.length) return '';
    var max=Math.max(1,Math.max.apply(null,rows.map(function(r){return r.score;})));
    var body=rows.map(function(j,i){
      var w=Math.round((j.score/max)*100);
      // Classes, not inline widths (R-006): 190px + a bar + 200px cannot fit a
      // phone, and an inline width is out of any stylesheet's reach.
      return '<div class="rep-hot is-click" onclick="reportsDrillJob('+i+')" title="Click to see who was sent on this job">'+
        '<div class="rep-hot-t"><div class="fs-12_5" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(j.job_title||'—')+'</div>'+
          '<div class="fs-11 c-text3" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(j.job_code||'')+(j.client?' · '+esc(j.client):'')+'</div></div>'+
        '<div class="rep-hot-bar rep-track"><div class="rep-fill tone-brand" style="width:'+w+'%"></div></div>'+
        '<div class="rep-hot-s"><b>'+j.submissions+'</b> to BDM · <b>'+(j.client_submissions||0)+'</b> to client · <b>'+j.interviews+'</b> intv</div>'+
      '</div>';
    }).join('');
    return '<div class="card rep-card" style="margin-bottom:14px"><div class="rep-ttl" style="margin-bottom:6px">Hot jobs</div>'+
      '<div class="rep-sub">Active jobs ranked by candidates sent and interviews in the period. Click a job to see who.</div>'+body+'</div>';
  }

  function miniFunnel(f, stages){
    var work=stages.filter(function(s){ return !({ 'Not Accepted':1, 'On Hold':1 })[s]; });
    var present=work.filter(function(s){return (f[s]||0)>0;});
    if(!present.length) return '<div class="rep-mini is-empty">Nothing sent in this period.</div>';
    var max=Math.max(1,Math.max.apply(null,present.map(function(s){return f[s]||0;})));
    return '<div class="rep-mini">'+present.map(function(s){
      var n=f[s]||0,w=Math.round(n/max*100);
      return '<div class="rep-row is-mini"><div class="rep-lbl">'+esc(s)+'</div>'+
        '<div class="rep-track"><div class="rep-fill tone-'+toneOf(s)+'" style="width:'+w+'%"></div></div>'+
        '<div class="rep-num">'+n+'</div></div>';
    }).join('')+'</div>';
  }

  // THE TEAM'S WORK, PERSON BY PERSON — everyone in the team, so someone who has
  // sent nothing shows 0 rather than being missing. Every number opens its
  // people. (The old "Total" column counted candidates put on jobs — data
  // entered, not work done — and "Fill %" was measured against it.)
  function byUserCard(rows, funnels, stages){
    if(!rows.length) return '';
    var sel=STATE.reports.sel||{}, exp=STATE.reports.expanded||{};
    var head=['','','Who','Role','Sent to BDM','Sent to client','Interviews','Placements','Placed %','Revenue']
      .map(function(h){return '<th class="rep-th">'+h+'</th>';}).join('');
    function num(uid,m,n){ return n?'<button class="rep-numbtn" onclick="reportsDrillUser(\''+uid+'\',\''+m+'\')" title="Click to see who">'+n+'</button>':'<span class="rep-zero">0</span>'; }
    var body=rows.map(function(r){
      var open=exp[r.user_id];
      var rowHtml='<tr class="rep-tr">'+
        '<td class="rep-td"><input type="checkbox" '+(sel[r.user_id]?'checked':'')+' onclick="reportsToggleSel(\''+r.user_id+'\')"/></td>'+
        '<td class="rep-td"><button class="rep-exp" onclick="reportsToggleExpand(\''+r.user_id+'\')">'+(open?'▾':'▸')+'</button></td>'+
        '<td class="rep-td rep-who">'+esc(r.recruiter)+'</td>'+
        '<td class="rep-td"><span class="rep-role '+(r.role_label==='BD'?'is-bd':'')+'">'+esc(r.role_label||'Recruiter')+'</span></td>'+
        '<td class="rep-td">'+num(r.user_id,'to_bdm',r.to_bdm)+'</td>'+
        '<td class="rep-td">'+num(r.user_id,'to_client',r.to_client)+'</td>'+
        '<td class="rep-td">'+num(r.user_id,'interviews',r.interviews)+'</td>'+
        '<td class="rep-td">'+num(r.user_id,'placements',r.placements)+'</td>'+
        '<td class="rep-td">'+(r.fill_rate==null?'<span class="rep-zero">—</span>':r.fill_rate+'%')+'</td>'+
        '<td class="rep-td">'+money(r.revenue)+'</td>'+
      '</tr>';
      if(open) rowHtml+='<tr><td colspan="10" style="padding:0">'+miniFunnel(funnels[r.user_id]||{}, stages)+'</td></tr>';
      return rowHtml;
    }).join('');
    var selIds=Object.keys(sel).filter(function(id){return sel[id];});
    var combined='';
    if(selIds.length){
      var chosen=rows.filter(function(r){return sel[r.user_id];});
      var sum=chosen.reduce(function(a,r){return {to_bdm:a.to_bdm+r.to_bdm,to_client:a.to_client+r.to_client,interviews:a.interviews+r.interviews,placements:a.placements+r.placements,revenue:a.revenue+r.revenue};},{to_bdm:0,to_client:0,interviews:0,placements:0,revenue:0});
      combined='<tr class="rep-tr is-combined">'+
        '<td colspan="2" class="rep-td"></td>'+
        '<td class="rep-td rep-who">Combined ('+chosen.length+')</td><td class="rep-td"></td>'+
        '<td class="rep-td">'+sum.to_bdm+'</td><td class="rep-td">'+sum.to_client+'</td><td class="rep-td">'+sum.interviews+'</td>'+
        '<td class="rep-td">'+sum.placements+'</td>'+
        '<td class="rep-td">'+(sum.to_client?Math.round(sum.placements/sum.to_client*100)+'%':'—')+'</td>'+
        '<td class="rep-td">'+money(sum.revenue)+'</td>'+
      '</tr>';
    }
    return '<div class="card rep-card rep-tablecard" style="margin-bottom:14px">'+
      '<div class="rep-tablehead">'+
        '<span><span class="rep-ttl" style="margin:0">Work by person</span> <span class="fs-11 c-text3" style="font-weight:400">numbers open the people · tick people to combine · ▸ opens their funnel</span></span>'+
        (selIds.length?'<button class="btn btn-sm btn-outline" onclick="reportsClearSel()">Clear ('+selIds.length+')</button>':'')+
      '</div>'+
      '<div class="rep-tablewrap"><table class="rep-table"><thead><tr>'+head+'</tr></thead><tbody>'+body+combined+'</tbody></table></div></div>';
  }

  // renderReportsBody() returns the inner content (no .page wrapper) so it can be
  // embedded as the "Reports" tab inside the My Team hub. renderReports() keeps
  // the standalone page for users who reach Reports as its own nav item.
  // The reports content, split into its three bands so the standalone page can
  // hang them off the kit's frame while the My Team hub still gets one blob it
  // can drop into a tab.
  function reportsParts(){
    var r = STATE.reports;
    if (!r.data) return null;
    var d = r.data, t = d.totals || {};
    var ttf = d.avg_time_to_fill != null ? d.avg_time_to_fill + ' days' : '—';

    // THE TEAM'S WORK (D-0029, D-0077): what was sent, interviewed and placed in
    // the period — never how many candidates or jobs were typed into the system.
    // Every tile opens the people it counts.
    var strip = UI.strip([
      { v:(t.submissions||0),        label:'Sent to BDM',    icon:'send',  onclick:"reportsDrillM('to_bdm')",     title:'Candidates sent to the BD manager — click to see who' },
      { v:(t.client_submissions||0), label:'Sent to client', icon:'send',  onclick:"reportsDrillM('to_client')",  title:'Candidates sent to the client — click to see who' },
      { v:(t.interviews||0),         label:'Interviews',     icon:'cal',   onclick:"reportsDrillM('interviews')", title:'Interviews scheduled — click to see who' },
      { v:(t.placements||0),         label:'Placements',     icon:'check', onclick:"reportsDrillM('placements')", title:'Placements — click to see who' },
      { sep:true },
      { v:(t.stalled_at_bdm||0),     label:'Waiting on BDM', icon:'clock', onclick:"reportsDrillM('stalled')",    title:'Sent to the BD manager, not yet to the client — click to see who' },
      { v:ttf,                       label:'Avg time-to-fill', icon:'clock', onclick:"reportsDrillM('placements')", title:'Placements behind this average — click to see them' },
      { v:money(t.revenue),          label:'Revenue',        icon:'dollar', onclick:"reportsDrillM('placements')", title:'Placements behind this revenue — click to see them' }
    ]);

    var people = d.by_user || [];

    var body =
      (r.loading?'<div class="fs-12 c-ink3" style="margin-bottom:10px">Updating…</div>':'')+
      // A class, not an inline grid: an inline grid cannot reflow on a phone,
      // and this one pushed the report ~200px past a 390px screen (R-006).
      '<div class="rep-2col">'+funnelCard(d)+trendCard(d.trend||[])+'</div>'+
      hotJobsCard(d.hot_jobs||[])+
      byUserCard(people, d.per_user_funnels||{}, d.stages||[])+
      clientsCard(d.top_clients||[]);

    return { strip:strip, filters:filterBar(d), body:body, scope:d.scope, team_size:d.team_size };
  }

  // Embedded form — used as the "Reports" tab inside the My Team hub, where the
  // page frame belongs to that page, not to this one.
  window.renderReportsBody = function(){
    var p = reportsParts();
    if (!p) return '<div class="dt-empty">'+(STATE.reports.loading?'Loading reports…':'No data yet.')+'</div>';
    return '<div style="margin:-16px -18px 14px">'+p.strip+'</div>'+p.filters+p.body;
  };

  // Standalone page. The "Reports" heading it used to draw is gone — the top bar
  // already says Reports, and two identical headings on one screen is noise.
  window.renderReports = function(){
    var p = reportsParts();
    if (!p) return UI.page({ body:'<div class="dt-empty">'+(STATE.reports.loading?'Loading reports…':'No data yet.')+'</div>' });
    var scopeLine = p.scope==='org' ? 'Whole-desk recruiting analytics'
      : (p.scope==='team' ? 'Your numbers plus your team’s ('+(p.team_size-1)+' report'+(p.team_size!==2?'s':'')+')'
                          : 'Your recruiting numbers');
    return UI.page({
      strip: p.strip,
      toolbar: UI.toolbar({
        icons:[{ icon:'refresh', title:'Reload', onclick:'reportsReload()' }],
        right:'<span class="fs-12_5 c-ink3">'+esc(scopeLine)+'</span>'
      }),
      body: p.filters + p.body
    });
  };
})();
