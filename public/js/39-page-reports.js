// ===== RECRUITING REPORTS / ANALYTICS PAGE (additive) =====
// A "Reports" page: headline totals, the pipeline funnel, an 8-week submission
// trend, per-recruiter productivity, time-to-fill and top clients. Built from the
// single org-scoped GET /reports/recruiting endpoint. Managers see the whole desk;
// recruiters see only their own numbers.

(function () {
  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function canUse(u){ return u && window.userHasAnyRole && userHasAnyRole(u,'admin','bd','bd_lead','ra_lead','recruiter'); }
  function money(n){ n = Number(n)||0; return '$'+n.toLocaleString('en-US'); }

  if (!STATE.reports) STATE.reports = { loading:false, data:null };
  STATE.reports.filters = STATE.reports.filters || { from:'', to:'', role:'', preset:'all' };
  STATE.reports.sel = STATE.reports.sel || {};
  STATE.reports.expanded = STATE.reports.expanded || {};

  function reportsQS(){
    var f = STATE.reports.filters||{}, p=[];
    if(f.from)p.push('from='+encodeURIComponent(f.from));
    if(f.to)p.push('to='+encodeURIComponent(f.to));
    if(f.role)p.push('role='+encodeURIComponent(f.role));
    return p.length?('?'+p.join('&')):'';
  }
  // Reports can be shown either standalone (page 'reports') or as a tab in the
  // My Team hub — a full render() repaints whichever is on screen.
  function repaintReports(){ if(STATE.page==='reports'||STATE.page==='myteam'){ if(window.render) render(); else paint(); } }
  function loadReport(){
    STATE.reports.loading = true; repaintReports();
    apiGet('/reports/recruiting'+reportsQS()).then(function(d){ STATE.reports.data = d||null; STATE.reports.loading = false; repaintReports(); })
      .catch(function(e){ STATE.reports.loading = false; showToast('Failed to load reports: '+e.message,'error'); repaintReports(); });
  }
  window.reportsReload = loadReport;

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
  var _prevRender = window.render;
  window.render = function(){
    _prevRender.apply(this, arguments);
    if (STATE.page === 'reports') paint();
  };
  // (The "Reports" nav item is now built by the sidebar in 04-shell-login.js —
  // shown standalone only to users who don't have the "My Team" hub, which
  // carries Reports as a tab. paint() sets the page title.)
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p === 'reports'){ STATE.page='reports'; STATE.modal=null; render(); loadReport(); return; }
    return _prevGoPage.apply(this, arguments);
  };
  function paint(){ if(STATE.page!=='reports') return; var c=document.getElementById('content'); if(!c) return; c.innerHTML = renderReports(); var t=document.querySelector('.tb-title'); if(t) t.textContent='Reports'; }

  function tile(label, value, sub){
    return '<div class="card" style="padding:14px 16px;flex:1;min-width:130px">'+
      '<div style="font-size:24px;font-weight:800;color:var(--text)">'+esc(value)+'</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+esc(label)+'</div>'+
      (sub?'<div style="font-size:11px;color:var(--text3);margin-top:2px">'+esc(sub)+'</div>':'')+
    '</div>';
  }

  function funnelCard(funnel, stages){
    var colors = window.ATS_STAGE_COLORS || {};
    var max = Math.max(1, Math.max.apply(null, stages.map(function(s){ return funnel[s]||0; })));
    var rows = stages.map(function(s){
      var n = funnel[s]||0; var w = Math.round((n/max)*100);
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'+
        '<div style="width:130px;font-size:12px;color:var(--text2);text-align:right;flex-shrink:0">'+esc(s)+'</div>'+
        '<div style="flex:1;background:var(--bg);border-radius:6px;height:20px;position:relative;overflow:hidden">'+
          '<div style="width:'+w+'%;height:100%;background:'+(colors[s]||'var(--accent)')+';border-radius:6px;min-width:'+(n?'2px':'0')+'"></div>'+
        '</div>'+
        '<div style="width:34px;font-size:12.5px;font-weight:700;color:'+(n?'var(--text)':'var(--text3)')+'">'+n+'</div>'+
      '</div>';
    }).join('');
    return '<div class="card" style="padding:16px"><div style="font-weight:600;font-size:14px;margin-bottom:12px">Pipeline funnel</div>'+rows+'</div>';
  }

  function trendCard(trend){
    var max = Math.max(1, Math.max.apply(null, trend.map(function(t){ return t.count; })));
    var bars = trend.map(function(t){
      var h = t.count ? Math.max(6, Math.round((t.count/max)*90)) : 2;
      return '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:110px">'+
        '<div style="font-size:11px;font-weight:700;color:'+(t.count?'var(--text)':'var(--text3)')+'">'+t.count+'</div>'+
        '<div style="width:60%;height:'+h+'px;background:var(--accent);border-radius:4px 4px 0 0;margin-top:3px"></div>'+
        '<div style="font-size:9.5px;color:var(--text3);margin-top:4px;white-space:nowrap">'+esc(t.week)+'</div>'+
      '</div>';
    }).join('');
    return '<div class="card" style="padding:16px"><div style="font-weight:600;font-size:14px;margin-bottom:10px">Submissions — last 8 weeks</div>'+
      '<div style="display:flex;align-items:flex-end;gap:6px">'+bars+'</div></div>';
  }

  function recruiterCard(rows){
    if (!rows.length) return '';
    var head = ['Recruiter','Total','Submitted','Interviews','Placements','Fill %','Revenue']
      .map(function(h){ return '<th style="text-align:left;padding:8px 10px;font-size:11px;color:var(--text3);font-weight:700;white-space:nowrap">'+h+'</th>'; }).join('');
    var body = rows.map(function(r){
      return '<tr style="border-top:1px solid var(--border)">'+
        '<td style="padding:8px 10px;font-size:12.5px;font-weight:600">'+esc(r.recruiter)+'</td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+r.total+'</td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+r.submitted+'</td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+r.interviews+'</td>'+
        '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;color:var(--green)">'+r.placements+'</td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+r.fill_rate+'%</td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+money(r.revenue)+'</td>'+
      '</tr>';
    }).join('');
    return '<div class="card" style="padding:0;overflow-x:auto"><div style="padding:14px 16px;font-weight:600;font-size:14px;border-bottom:1px solid var(--border)">Recruiter productivity</div>'+
      '<table style="width:100%;border-collapse:collapse;min-width:620px"><thead><tr style="background:var(--bg)">'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
  }

  function clientsCard(rows){
    if (!rows.length) return '';
    var max = Math.max(1, Math.max.apply(null, rows.map(function(r){ return r.count; })));
    var body = rows.map(function(r){
      var w = Math.round((r.count/max)*100);
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">'+
        '<div style="width:130px;font-size:12.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0">'+esc(r.client)+'</div>'+
        '<div style="flex:1;background:var(--bg);border-radius:6px;height:16px"><div style="width:'+w+'%;height:100%;background:var(--accent);border-radius:6px"></div></div>'+
        '<div style="width:26px;font-size:12px;font-weight:700">'+r.count+'</div>'+
      '</div>';
    }).join('');
    return '<div class="card" style="padding:16px"><div style="font-weight:600;font-size:14px;margin-bottom:12px">Top clients by submissions</div>'+body+'</div>';
  }

  function filterBar(d){
    var f = STATE.reports.filters||{};
    function pill(active,label,onclick){
      return '<button onclick="'+onclick+'" style="border:1px solid '+(active?'var(--accent)':'var(--border)')+';background:'+(active?'var(--accent-l)':'var(--card)')+';color:'+(active?'var(--accent)':'var(--text2)')+';border-radius:7px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer">'+label+'</button>';
    }
    var presetBtns=[['7','7d'],['30','30d'],['90','90d'],['all','All']].map(function(p){ return pill((f.preset||'all')===p[0],p[1],"reportsPreset('"+p[0]+"')"); }).join('');
    var roleBtns=[['','All'],['bd','BDs'],['recruiter','Recruiters']].map(function(r){ return pill((f.role||'')===r[0],r[1],"reportsRole('"+r[0]+"')"); }).join('');
    return '<div class="card" style="padding:12px 14px;margin-bottom:14px;display:flex;gap:18px;flex-wrap:wrap;align-items:center">'+
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Period</span>'+presetBtns+
        '<input type="date" value="'+esc(f.from||'')+'" onchange="reportsDate(\'from\',this.value)" style="border:1px solid var(--border);border-radius:7px;padding:4px 8px;font-size:12px;background:var(--card);color:var(--text)"/>'+
        '<span style="color:var(--text3);font-size:12px">to</span>'+
        '<input type="date" value="'+esc(f.to||'')+'" onchange="reportsDate(\'to\',this.value)" style="border:1px solid var(--border);border-radius:7px;padding:4px 8px;font-size:12px;background:var(--card);color:var(--text)"/>'+
      '</div>'+
      '<div style="display:flex;gap:6px;align-items:center"><span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Who</span>'+roleBtns+'</div>'+
    '</div>';
  }

  function hotJobsCard(rows){
    if(!rows||!rows.length) return '';
    var max=Math.max(1,Math.max.apply(null,rows.map(function(r){return r.score;})));
    var body=rows.map(function(j){
      var w=Math.round((j.score/max)*100);
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'+
        '<div style="width:190px;flex-shrink:0"><div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(j.job_title||'—')+'</div>'+
          '<div style="font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(j.job_code||'')+(j.client?' · '+esc(j.client):'')+'</div></div>'+
        '<div style="flex:1;background:var(--bg);border-radius:6px;height:18px;overflow:hidden"><div style="width:'+w+'%;height:100%;background:linear-gradient(90deg,var(--accent),#2563eb);border-radius:6px"></div></div>'+
        '<div style="width:130px;text-align:right;font-size:11.5px;color:var(--text2);flex-shrink:0"><b>'+j.submissions+'</b> subs · <b style="color:#2563eb">'+j.interviews+'</b> intv</div>'+
      '</div>';
    }).join('');
    return '<div class="card" style="padding:16px;margin-bottom:14px"><div style="font-weight:600;font-size:14px;margin-bottom:2px">🔥 Hot jobs</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">Active reqs with the most submissions + interviews this period</div>'+body+'</div>';
  }

  function miniFunnel(f, stages){
    var colors=window.ATS_STAGE_COLORS||{};
    var present=stages.filter(function(s){return (f[s]||0)>0;});
    if(!present.length) return '<div style="padding:8px 44px;background:var(--bg);font-size:11.5px;color:var(--text3)">No submissions in this period.</div>';
    var max=Math.max(1,Math.max.apply(null,present.map(function(s){return f[s]||0;})));
    return '<div style="padding:8px 10px 10px 44px;background:var(--bg)">'+present.map(function(s){
      var n=f[s]||0,w=Math.round(n/max*100);
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><div style="width:130px;font-size:11px;color:var(--text3);text-align:right">'+esc(s)+'</div>'+
        '<div style="flex:1;background:var(--card);border-radius:4px;height:12px;overflow:hidden"><div style="width:'+w+'%;height:100%;background:'+(colors[s]||'var(--accent)')+'"></div></div>'+
        '<div style="width:26px;font-size:11px;font-weight:700">'+n+'</div></div>';
    }).join('')+'</div>';
  }

  function byUserCard(rows, funnels, stages){
    if(!rows.length) return '';
    var sel=STATE.reports.sel||{}, exp=STATE.reports.expanded||{};
    var head=['','','Who','Role','Total','Submitted','Interviews','Placements','Fill %','Revenue']
      .map(function(h){return '<th style="text-align:left;padding:8px 10px;font-size:11px;color:var(--text3);font-weight:700;white-space:nowrap">'+h+'</th>';}).join('');
    var body=rows.map(function(r){
      var open=exp[r.user_id];
      var rowHtml='<tr style="border-top:1px solid var(--border)">'+
        '<td style="padding:8px 6px 8px 10px"><input type="checkbox" '+(sel[r.user_id]?'checked':'')+' onclick="reportsToggleSel(\''+r.user_id+'\')"/></td>'+
        '<td style="padding:8px 4px"><button onclick="reportsToggleExpand(\''+r.user_id+'\')" style="border:0;background:none;cursor:pointer;color:var(--text3);font-size:12px">'+(open?'▾':'▸')+'</button></td>'+
        '<td style="padding:8px 10px;font-size:12.5px;font-weight:600">'+esc(r.recruiter)+'</td>'+
        '<td style="padding:8px 10px;font-size:11.5px"><span style="padding:1px 7px;border-radius:7px;font-weight:600;background:'+(r.role_label==='BD'?'var(--accent-l)':'rgba(37,99,235,.12)')+';color:'+(r.role_label==='BD'?'var(--accent)':'#2563eb')+'">'+esc(r.role_label||'Recruiter')+'</span></td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+r.total+'</td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+r.submitted+'</td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+r.interviews+'</td>'+
        '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;color:var(--green)">'+r.placements+'</td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+r.fill_rate+'%</td>'+
        '<td style="padding:8px 10px;font-size:12.5px">'+money(r.revenue)+'</td>'+
      '</tr>';
      if(open) rowHtml+='<tr><td colspan="10" style="padding:0">'+miniFunnel(funnels[r.user_id]||{}, stages)+'</td></tr>';
      return rowHtml;
    }).join('');
    var selIds=Object.keys(sel).filter(function(id){return sel[id];});
    var combined='';
    if(selIds.length){
      var chosen=rows.filter(function(r){return sel[r.user_id];});
      var sum=chosen.reduce(function(a,r){return {total:a.total+r.total,submitted:a.submitted+r.submitted,interviews:a.interviews+r.interviews,placements:a.placements+r.placements,revenue:a.revenue+r.revenue};},{total:0,submitted:0,interviews:0,placements:0,revenue:0});
      var avgFill=chosen.length?Math.round(chosen.reduce(function(a,r){return a+r.fill_rate;},0)/chosen.length):0;
      combined='<tr style="border-top:2px solid var(--accent);background:var(--accent-l)">'+
        '<td colspan="2" style="padding:9px 10px"></td>'+
        '<td style="padding:9px 10px;font-size:12.5px;font-weight:700">Combined ('+chosen.length+')</td>'+
        '<td style="padding:9px 10px"></td>'+
        '<td style="padding:9px 10px;font-size:12.5px;font-weight:700">'+sum.total+'</td>'+
        '<td style="padding:9px 10px;font-size:12.5px;font-weight:700">'+sum.submitted+'</td>'+
        '<td style="padding:9px 10px;font-size:12.5px;font-weight:700">'+sum.interviews+'</td>'+
        '<td style="padding:9px 10px;font-size:12.5px;font-weight:700;color:var(--green)">'+sum.placements+'</td>'+
        '<td style="padding:9px 10px;font-size:12.5px;font-weight:700">'+avgFill+'% <span style="font-weight:400;color:var(--text3);font-size:10px">avg</span></td>'+
        '<td style="padding:9px 10px;font-size:12.5px;font-weight:700">'+money(sum.revenue)+'</td>'+
      '</tr>';
    }
    return '<div class="card" style="padding:0;overflow-x:auto;margin-bottom:14px">'+
      '<div style="padding:14px 16px;font-weight:600;font-size:14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:10px">'+
        '<span>Per-person productivity <span style="font-size:11px;font-weight:400;color:var(--text3)">tick people to combine · ▸ opens their funnel</span></span>'+
        (selIds.length?'<button class="btn btn-sm btn-outline" onclick="reportsClearSel()">Clear ('+selIds.length+')</button>':'')+
      '</div>'+
      '<table style="width:100%;border-collapse:collapse;min-width:720px"><thead><tr style="background:var(--bg)">'+head+'</tr></thead><tbody>'+body+combined+'</tbody></table></div>';
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

    var strip = UI.strip([
      { v:(t.candidates_added||0), label:'Candidates added', icon:'user' },
      { v:(t.submissions||0),      label:'Submissions',      icon:'send' },
      { v:(t.interviews||0),       label:'Interviews',       icon:'cal' },
      { v:(t.placements||0),       label:'Placements',       icon:'check' },
      { sep:true },
      { v:(t.open_jobs||0),        label:'Open jobs',        icon:'doc' },
      { v:ttf,                     label:'Avg time-to-fill',  icon:'clock' },
      { v:money(t.revenue),        label:'Revenue',          icon:'dollar' }
    ]);

    // by_user is the per-person breakdown (with role); fall back to the older
    // by_recruiter shape if an older backend is answering.
    var people = (d.by_user && d.by_user.length) ? d.by_user
      : (d.by_recruiter||[]).map(function(x,i){ return Object.assign({ user_id:'r'+i, role_label:'Recruiter' }, x); });

    var body =
      (r.loading?'<div style="font-size:12px;color:var(--ink3);margin-bottom:10px">Updating…</div>':'')+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">'+funnelCard(d.funnel,d.stages)+trendCard(d.trend)+'</div>'+
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
        right:'<span style="font-size:12.5px;color:var(--ink3)">'+esc(scopeLine)+'</span>'
      }),
      body: p.filters + p.body
    });
  };
})();
