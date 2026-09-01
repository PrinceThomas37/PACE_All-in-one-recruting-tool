// ── LEADS ──────────────────────────────────────
function renderJobs(){
  var u=STATE.user;
  var jobs=getMyJobs(u);
  var f=STATE.jobsFilter;
  if(f.search){
    var q=f.search.toLowerCase();
    jobs=jobs.filter(function(j){
      if((j.position||"").toLowerCase().indexOf(q)>-1)return true;
      if((j.company_name||"").toLowerCase().indexOf(q)>-1)return true;
      if((j.location||"").toLowerCase().indexOf(q)>-1)return true;
      var cs=jobContacts(j.id);
      for(var i=0;i<cs.length;i++){
        var c=cs[i];
        if(((c.first_name||"")+" "+(c.last_name||"")).toLowerCase().indexOf(q)>-1)return true;
        if((c.email||"").toLowerCase().indexOf(q)>-1)return true;
      }
      return false;
    });
  }
  if(f.stages&&f.stages.length)jobs=jobs.filter(function(j){return f.stages.indexOf(j.stage)>-1;});
  if(f.industries&&f.industries.length)jobs=jobs.filter(function(j){return f.industries.indexOf(j.industry||j.company_ind||"")>-1;});
  if(f.dateRange&&f.dateRange!=="all"&&f.dateRange!=="custom"){var _now=new Date();var _today=todayIST();var _cut=null;if(f.dateRange==="today")_cut=_today;else if(f.dateRange==="yesterday"){var _yy=new Date(_now);_yy.setDate(_yy.getDate()-1);_cut=_yy.toISOString().slice(0,10);}else if(f.dateRange==="week"){var _ww=new Date(_now);_ww.setDate(_ww.getDate()-7);_cut=_ww.toISOString().slice(0,10);}if(_cut){if(f.dateRange==="today"||f.dateRange==="yesterday")jobs=jobs.filter(function(j){return (j.created_at||"").slice(0,10)===_cut;});else jobs=jobs.filter(function(j){return (j.created_at||"").slice(0,10)>=_cut;});}}
  if(f.dateRange==="custom"){if(f.dateFrom)jobs=jobs.filter(function(j){return (j.created_at||"").slice(0,10)>=f.dateFrom;});if(f.dateTo)jobs=jobs.filter(function(j){return (j.created_at||"").slice(0,10)<=f.dateTo;});}

  var stages=["Unassigned","Assigned","Connected","Rejected","Future","Qualified"];
  var stageOpts=stages.map(function(st){return '<option value="'+st+'"'+(f.stage===st?" selected":"")+'>'+st+'</option>';}).join("");

  var canChangeStageInline=userHasAnyRole(u,'admin','bd','bd_lead');
  // Cross-group sequencing: BD / BD Lead / Admin can multi-select leads across
  // any stage group and start one sequence for the lot (rotating "from" mailboxes).
  var canSequence=userHasAnyRole(u,'admin','bd','bd_lead');
  var leadSel=STATE.leadSeqSel||{};
  // Selectable = filtered leads (all pages) whose primary contact has an email.
  var leadSelectable=jobs.filter(function(j){var cs=jobContacts(j.id);return (cs.find(function(c){return c.is_primary;})||cs[0]||{}).email;});
  STATE._leadSelectableIds=leadSelectable.map(function(j){return j.id;});
  var leadSelCount=Object.keys(leadSel).filter(function(k){return leadSel[k];}).length;
  var _tp=Math.max(1,Math.ceil(jobs.length/20));
  var _pg=Math.min(STATE.leadsPage||0,_tp-1);
  // Rows for UI.table — arrays of cells, so the column list below is the only
  // place that decides what a lead row shows.
  var rows=jobs.slice(_pg*20,(_pg+1)*20).map(function(j){
    var cs=jobContacts(j.id);
    var primary=cs[0]||{};
    var hasEmail=(cs.find(function(c){return c.is_primary;})||cs[0]||{}).email;
    var stageColor=leadStageColor(j.stage);

    // Freshness/duplicate markers, as pills rather than three hand-rolled spans.
    var marks=(j.is_duplicate?UI.pill('DUP','warn'):'')+
      (j.freshness==='Old'?UI.pill('OLD','bad'):'')+
      (j.freshness==='New'?UI.pill('NEW','ok'):'');

    var stageCell=canChangeStageInline
      ? '<select onchange="changeJobStage(\''+j.id+'\',this.value);event.stopPropagation()" onclick="event.stopPropagation()" '+
        'style="font-size:12px;padding:4px 8px;border:1px solid '+stageColor+'55;border-radius:7px;background:'+stageColor+'14;color:'+stageColor+';font-weight:600;cursor:pointer">'+
        ['Unassigned','Assigned','Connected','Rejected','Future','In Discussion'].map(function(st){
          return '<option value="'+st+'"'+(j.stage===st?' selected':'')+'>'+st+'</option>';
        }).join('')+'</select>'
      : '<span class="pill" style="background:'+stageColor+'14;color:'+stageColor+'"><i></i>'+escHtml(j.stage)+'</span>';

    var cells=[];
    if(canSequence) cells.push({ cls:'tight', html:
      '<span onclick="event.stopPropagation()">'+
        (hasEmail
          ? '<input type="checkbox" class="ck" '+(leadSel[j.id]?'checked':'')+' onclick="event.stopPropagation();leadToggleSel(\''+j.id+'\')" title="Select for sequence">'
          : '<span title="No contact email" style="color:var(--ink3)">·</span>')+
      '</span>' });
    cells.push({ html: UI.idCell(j.position||'—', j.location||'', null, { badge: marks }) });
    cells.push({ html: escHtml(j.company_name||'—') });
    cells.push({ html: UI.idCell(((primary.first_name||'')+' '+(primary.last_name||'')).trim()||'—', primary.email||'', null,
                   { verified: !!primary.email }) });
    cells.push({ cls:'tight', html: UI.pill(String(cs.length),'info') });
    cells.push({ cls:'tight', html: stageCell });
    cells.push({ cls:'tight', html: j.assigned_bd_name
      ? UI.idCell(j.assigned_bd_name, j.assigned_at
          ? new Date(j.assigned_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})
          : '', null)
      : '<span style="color:var(--ink3)">—</span>' });
    cells.push({ cls:'tight', html: '<span style="color:var(--ink3)">'+
      escHtml(j.created_date||(j.created_at?new Date(j.created_at).toISOString().slice(0,10):''))+'</span>' });

    return { cells: cells, onclick: "openJob('"+j.id+"')" };
  });

  // RA sees form at top + their leads below; others see search/filter + table
  var isRA=(u.role==='ra');

  // Build RA-specific rows with 24hr edit button
  var now24=new Date();
  var raRows=jobs.map(function(j){
    var cs=jobContacts(j.id);
    var primary=cs[0]||{};
    var stageColor=leadStageColor(j.stage);
    // An RA may correct their own lead for 24 hours; after that it is locked,
    // and saying "Locked" is kinder than hiding the button with no explanation.
    var canRAEdit=(now24-new Date(j.created_at))/3600000<=24;
    return { onclick:"openJob('"+j.id+"')", cells:[
      { html: UI.idCell(j.position||'—', '', null) },
      { html: UI.idCell(j.company_name||'—', j.company_ind||j.industry||'', null) },
      { html: UI.idCell(((primary.first_name||'')+' '+(primary.last_name||'')).trim()||'—', primary.email||'', null,
               { verified: !!primary.email }) },
      { cls:'tight', html: UI.pill(String(cs.length),'info') },
      { cls:'tight', html: '<span class="pill" style="background:'+stageColor+'14;color:'+stageColor+'"><i></i>'+escHtml(j.stage)+'</span>' },
      { cls:'tight', html: '<span style="color:var(--ink3)">'+
          escHtml(j.created_date||(j.created_at?new Date(j.created_at).toISOString().slice(0,10):''))+'</span>' },
      { cls:'tight', html: '<span onclick="event.stopPropagation()">'+(canRAEdit
          ? '<button class="btn btn-sm btn-outline" onclick="raFormEdit(\''+j.id+'\')">Edit</button>'
          : '<span style="font-size:11.5px;color:var(--ink3)">Locked</span>')+'</span>' }
    ]};
  });

  if(isRA){
    return UI.page({
      toolbar: UI.toolbar({
        search:{ value:f.search||'', placeholder:'Search your leads…',
                 oninput:'STATE.jobsFilter.search=this.value;STATE.leadsPage=0;scheduleRender()' },
        right:'<span style="font-size:12.5px;color:var(--ink3)">'+jobs.length+' lead'+(jobs.length===1?'':'s')+' submitted by you</span>'
      }),
      body:
        renderRALeadForm()+
        '<div style="margin:20px 0 10px;font-weight:600;font-size:14px">Your submitted leads</div>'+
        UI.table({
          cols:['Position','Company','Primary contact','Contacts','Stage','Created',{label:'',w:'90px'}],
          rows:raRows, minWidth:'820px',
          empty:'No leads submitted yet. Use the form above to add your first one.'
        })
    });
  }

  var allStagesList=['Unassigned','Assigned','Connected','Rejected','Future','In Discussion'];
  var allIndustriesList=getIndustriesList();
  var stageActive=f.stages&&f.stages.length>0;
  var indActive=f.industries&&f.industries.length>0;
  var dateActive=f.dateRange&&f.dateRange!=='all';
  var anyActive=stageActive||indActive||dateActive;
  function mkChkDrop(name,key,items,selected,active){
    var btn='<button onclick="event.stopPropagation();STATE.openDrop=STATE.openDrop===\''+name+'\' ?null:\''+name+'\';render()" style="padding:9px 13px;border:'+(active?'1.5px solid var(--accent)':'1px solid var(--border)')+';border-radius:8px;background:'+(active?'var(--accent-l)':'var(--bg2)')+';color:'+(active?'var(--accent)':'var(--text)')+';font-size:13px;font-weight:'+(active?'600':'400')+';cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap">'+(active?name+' ('+selected.length+')':name)+' <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>';
    var panel='';
    if(STATE.openDrop===name){
      panel='<div style="position:absolute;top:calc(100% + 4px);left:0;z-index:9000;background:var(--card);border:1px solid var(--border2);border-radius:var(--r2);box-shadow:var(--sh2);min-width:190px;padding:6px 0" onclick="event.stopPropagation()">'+
        items.map(function(v){var on=selected.indexOf(v)>-1;return '<label style="display:flex;align-items:center;gap:9px;padding:7px 14px;cursor:pointer;font-size:13px;background:'+(on?'var(--accent-l)':'transparent')+';color:'+(on?'var(--accent)':'var(--text)')+'"><input type="checkbox" '+(on?'checked':'')+' onchange="toggleJobFilter(\''+key+'\',\''+v+'\',this.checked)" style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer"/>'+v+'</label>';}).join('')+
        (selected.length?'<div style="border-top:1px solid var(--border);padding:6px 14px;margin-top:2px"><button onclick="STATE.jobsFilter.'+key+'=[];STATE.leadsPage=0;render()" style="font-size:11.5px;color:var(--red);background:none;border:none;cursor:pointer;padding:0">Clear</button></div>':'')+
      '</div>';
    }
    return '<div style="position:relative">'+btn+panel+'</div>';
  }
  var dateLabel=f.dateRange==='today'?'Today':f.dateRange==='yesterday'?'Yesterday':f.dateRange==='week'?'This week':f.dateRange==='custom'&&(f.dateFrom||f.dateTo)?((f.dateFrom||'…')+' → '+(f.dateTo||'…')):'Date';
  var dateBtn='<div style="position:relative">'+
    '<button onclick="event.stopPropagation();STATE.openDrop=STATE.openDrop===\'date\' ?null:\'date\';render()" style="padding:9px 13px;border:'+(dateActive?'1.5px solid var(--accent)':'1px solid var(--border)')+';border-radius:8px;background:'+(dateActive?'var(--accent-l)':'var(--bg2)')+';color:'+(dateActive?'var(--accent)':'var(--text)')+';font-size:13px;font-weight:'+(dateActive?'600':'400')+';cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap">'+dateLabel+' <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>'+
    (STATE.openDrop==='date'?
      '<div style="position:absolute;top:calc(100% + 4px);left:0;z-index:9000;background:var(--card);border:1px solid var(--border2);border-radius:var(--r2);box-shadow:var(--sh2);padding:12px 14px;min-width:240px" onclick="event.stopPropagation()">'+
        // Preset chips
        '<div style="display:flex;flex-direction:column;gap:2px;margin-bottom:8px">'+
          ['today','yesterday','week'].map(function(val){var lbl=val==='today'?'Today':val==='yesterday'?'Yesterday':'This week';var on=f.dateRange===val;return '<button onclick="STATE.jobsFilter.dateRange=STATE.jobsFilter.dateRange===\''+val+'\' ?\'all\':\''+val+'\';STATE.jobsFilter.dateFrom=\'\';STATE.jobsFilter.dateTo=\'\';STATE.leadsPage=0;render()" style="padding:7px 12px;border-radius:7px;font-size:13px;cursor:pointer;text-align:left;border:1px solid '+(on?'var(--accent)':'var(--border)')+';background:'+(on?'var(--accent-l)':'transparent')+';color:'+(on?'var(--accent)':'var(--text)')+';font-weight:'+(on?'600':'400')+'">'+lbl+'</button>';}).join('')+
        '</div>'+
        // Custom separator
        '<div style="border-top:1px solid var(--border);margin:8px 0 10px"></div>'+
        '<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Custom range</div>'+
        '<div style="display:flex;flex-direction:column;gap:8px">'+
          '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--text2);width:28px">From</span><input type="date" value="'+escAttr(f.dateFrom||'')+'" onchange="STATE.jobsFilter.dateRange=\'custom\';STATE.jobsFilter.dateFrom=this.value;STATE.leadsPage=0;render()" style="flex:1;padding:6px 10px;border:1px solid var(--border2);border-radius:7px;font-size:13px;background:var(--card);color:var(--text)"/></div>'+
          '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--text2);width:28px">To</span><input type="date" value="'+escAttr(f.dateTo||'')+'" onchange="STATE.jobsFilter.dateRange=\'custom\';STATE.jobsFilter.dateTo=this.value;STATE.leadsPage=0;render()" style="flex:1;padding:6px 10px;border:1px solid var(--border2);border-radius:7px;font-size:13px;background:var(--card);color:var(--text)"/></div>'+
        '</div>'+
        (dateActive?'<button onclick="STATE.jobsFilter.dateRange=\'all\';STATE.jobsFilter.dateFrom=\'\';STATE.jobsFilter.dateTo=\'\';STATE.leadsPage=0;render()" style="margin-top:10px;font-size:11.5px;color:var(--red);background:none;border:none;cursor:pointer;padding:0">Clear</button>':'')+
      '</div>':'')  +
  '</div>';

  // ── the stat strip ────────────────────────────────────────────────────
  // Counts come from ALL of this user's leads, never the filtered set: the
  // strip is the denominator you filter against, so filtering must not move it.
  //
  // These used to be number-and-colour chips with the name only on hover — a
  // workaround for having nowhere to put the label. The strip has room, so the
  // name is back and the stage colour stays as the dot. Clicking a stage
  // filters to it; clicking Total clears the stage filter.
  var allJobs=getMyJobs(u);
  var stageCounts={};
  var stageList=['Unassigned','Assigned','Connected','In Discussion','Future','Rejected'];
  stageList.forEach(function(st){stageCounts[st]=allJobs.filter(function(j){return j.stage===st;}).length;});

  var stripItems=[{
    v:allJobs.length, label:'Total leads',
    on:!(f.stages&&f.stages.length),
    onclick:"STATE.jobsFilter.stages=[];STATE.leadsPage=0;render()"
  },{ sep:true }];
  stageList.filter(function(st){return stageCounts[st]>0;}).forEach(function(st){
    // "Connected" keeps its drill-down: the panel shows each connected lead's
    // email, phone and LinkedIn, which the table does not. Deliberate, and the
    // chevron says the click does something different.
    var isConn=(st==='Connected');
    stripItems.push({
      v:stageCounts[st],
      label:st+(isConn?' ▸':''),
      on:!isConn&&!!(f.stages&&f.stages.length===1&&f.stages[0]===st),
      onclick:isConn?'leadsShowConnected()'
                    :"STATE.jobsFilter.stages=['"+st+"'];STATE.leadsPage=0;render()"
    });
  });
  var stageSummary=UI.strip(stripItems);

  // Connected-leads drill-down (item 7): a panel listing the connected leads with
  // their basic contact details, opened from the green "Connected" chip.
  var connectedOverlay='';
  if(STATE.leadsConnectedOpen){
    var connList=allJobs.filter(function(j){return j.stage==='Connected';});
    var connRows=connList.length?connList.map(function(j){
      var cs=jobContacts(j.id);var pc=(cs.find(function(c){return c.is_primary;})||cs[0]||{});
      return '<div onclick="STATE.leadsConnectedOpen=false;openJob(\''+j.id+'\')" style="display:flex;gap:12px;padding:12px 4px;border-bottom:1px solid var(--border);cursor:pointer" onmouseenter="this.style.background=\'var(--bg)\'" onmouseleave="this.style.background=\'transparent\'">'+
        '<div style="width:9px;height:9px;border-radius:50%;background:'+leadStageColor('Connected')+';margin-top:5px;flex-shrink:0"></div>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13.5px;font-weight:600">'+escHtml(j.position||'—')+' <span style="font-weight:400;color:var(--text3)">· '+escHtml(j.company_name||'')+'</span></div>'+
          '<div style="font-size:12px;color:var(--text2);margin-top:2px">'+escHtml(((pc.first_name||'')+' '+(pc.last_name||'')).trim()||'—')+(pc.designation?' · '+escHtml(pc.designation):'')+'</div>'+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:1px">'+[pc.email,pc.phone,(pc.linkedin?'LinkedIn':'')].filter(Boolean).map(escHtml).join(' · ')+'</div>'+
        '</div>'+
        '<span style="color:var(--text3);font-size:14px">›</span>'+
      '</div>';
    }).join(''):'<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px">No connected leads yet.</div>';
    connectedOverlay='<div onclick="leadsCloseConnected()" style="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100"></div>'+
      '<div style="position:fixed;top:0;right:0;bottom:0;width:min(460px,94vw);background:var(--card);border-left:1px solid var(--border);z-index:101;box-shadow:-8px 0 24px rgba(0,0,0,.14);display:flex;flex-direction:column">'+
        '<div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'+
          '<div><div style="font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:'+leadStageColor('Connected')+'"></span>Connected leads</div>'+
            '<div style="font-size:12px;color:var(--text3)">'+connList.length+' lead'+(connList.length===1?'':'s')+' · click one to open it</div></div>'+
          '<button onclick="leadsCloseConnected()" style="border:0;background:none;font-size:24px;cursor:pointer;color:var(--text3);line-height:1">×</button>'+
        '</div>'+
        '<div style="flex:1;overflow:auto;padding:6px 18px 18px">'+connRows+'</div>'+
      '</div>';
  }

  var clearFilters="STATE.jobsFilter.stages=[];STATE.jobsFilter.industries=[];"+
    "STATE.jobsFilter.dateRange='all';STATE.jobsFilter.dateFrom='';STATE.jobsFilter.dateTo='';"+
    "STATE.openDrop=null;STATE.leadsPage=0;render()";

  // The bulk bar only exists when something is selected, so it sits in the body
  // rather than the toolbar — a permanently-reserved empty strip is worse.
  var bulkBar=(canSequence&&leadSelCount)?
    '<div class="card" style="padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
      '<span style="font-size:13px;font-weight:600">'+leadSelCount+' lead'+(leadSelCount>1?'s':'')+' selected</span>'+
      '<button class="btn btn-sm btn-primary" onclick="leadStartSequence()">'+UI.ic('send')+'Sequence selected</button>'+
      '<button class="btn btn-sm btn-outline" onclick="leadClearSel()">Clear</button>'+
      '<span style="font-size:11.5px;color:var(--ink3);margin-left:auto">You pick the "from" mailboxes next — sends rotate across them, whatever the stage.</span>'+
    '</div>':'';

  var cols=[];
  if(canSequence) cols.push({ w:'34px', raw:
    '<input type="checkbox" class="ck" '+
    (leadSelectable.length&&leadSelectable.every(function(j){return leadSel[j.id];})?'checked':'')+
    ' onclick="leadToggleSelAll()" title="Select every lead matching these filters">' });
  cols=cols.concat([
    { label:'Position', icon:'doc' },
    { label:'Company' },
    { label:'Primary contact', icon:'user' },
    { label:'Contacts' },
    { label:'Stage' },
    { label:'Assigned BD' },
    { label:'Created' }
  ]);

  return UI.page({
    strip: stageSummary,
    toolbar: UI.toolbar({
      search:{ value:f.search||'', placeholder:'Search leads, companies, contacts…',
               oninput:'STATE.jobsFilter.search=this.value;STATE.leadsPage=0;scheduleRender()' },
      icons:[
        { icon:'x', title:'Clear all filters', onclick:clearFilters, off:!anyActive }
      ],
      right:
        mkChkDrop('Stage','stages',allStagesList,f.stages||[],stageActive)+
        mkChkDrop('Industry','industries',allIndustriesList,f.industries||[],indActive)+
        dateBtn+
        (userHasAnyRole(u,'ra_lead','admin')
          ? '<button class="btn btn-sm btn-outline" onclick="openExportLeads()">'+UI.ic('dl')+'Export</button>':'')+
        '<button class="btn btn-sm btn-outline" onclick="triggerImport()">Import Excel</button>'+
        (u.role!=='ra'?'<button class="btn btn-sm btn-primary" onclick="openAddJob()">'+UI.ic('plus')+'Add Lead</button>':'')+
        '<input type="file" id="xl-import" accept=".xlsx,.xls" style="display:none" onchange="importXL(this)"/>'
    }),
    body:
      bulkBar+
      UI.table({
        cols:cols, rows:rows, minWidth:'1020px',
        empty: anyActive||f.search
          ? 'No leads match these filters. <span style="color:var(--accent);cursor:pointer" onclick="'+escAttr(clearFilters)+'">Clear them &rarr;</span>'
          : 'No leads yet.'
      })+
      '<div style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12.5px;color:var(--ink3)">'+
        '<div>'+jobs.length+' lead'+(jobs.length===1?'':'s')+'</div>'+
        (_tp>1?'<div style="display:flex;gap:6px;align-items:center">'+
          '<button class="btn btn-sm btn-outline" onclick="setLeadsPage('+(_pg-1)+')"'+(_pg===0?' disabled style="opacity:.5"':'')+'>&lsaquo; Prev</button>'+
          '<span>Page '+(_pg+1)+' / '+_tp+'</span>'+
          '<button class="btn btn-sm btn-outline" onclick="setLeadsPage('+(_pg+1)+')"'+(_pg>=_tp-1?' disabled style="opacity:.5"':'')+'>Next &rsaquo;</button>'+
        '</div>':'')+
      '</div>'+
      connectedOverlay
  });
}
window.leadsShowConnected=function(){STATE.leadsConnectedOpen=true;render();};
window.leadsCloseConnected=function(){STATE.leadsConnectedOpen=false;render();};

// Bind search/filter inputs (called from render() after DOM replace)
// The search box and the stage <select> this used to wire up are now built by
// UI.toolbar with their handlers inline, and render() restores focus and caret
// by placeholder after a rebuild — so there is nothing left to bind. Kept as a
// no-op because 05-page-dashboard.js calls it on every leads render; deleting
// it there and here in one go is a separate, unrelated change.
function bindJobsControls(){}

function openJob(id){ STATE.detailJob=id; STATE.jobSeqSel=[]; STATE.modal={type:"jobDetail",id:id}; render(); if(typeof loadJobEnrollments==='function')loadJobEnrollments(id); }
window.jobToggleSeqSel=function(cid){ STATE.jobSeqSel=STATE.jobSeqSel||[]; var i=STATE.jobSeqSel.indexOf(cid); if(i>-1)STATE.jobSeqSel.splice(i,1); else STATE.jobSeqSel.push(cid); render(); };
window.jobStartSequence=function(jobId){
  var sel=STATE.jobSeqSel||[]; if(!sel.length)return;
  var items=sel.map(function(cid){ var c=STATE.contacts.find(function(x){return x.id===cid;})||{}; return {entity_id:cid,job_id:jobId,contact_id:cid,label:((c.first_name||'')+' '+(c.last_name||'')).trim()||'Contact'}; });
  wfStartSequence('contact',items);
};
// ── Cross-group lead selection → bulk sequence (any stage) ──
window.leadToggleSel=function(jid){ STATE.leadSeqSel=STATE.leadSeqSel||{}; STATE.leadSeqSel[jid]=!STATE.leadSeqSel[jid]; render(); };
window.leadToggleSelAll=function(){
  var ids=STATE._leadSelectableIds||[]; var sel=STATE.leadSeqSel||{};
  var allOn=ids.length&&ids.every(function(id){return sel[id];});
  ids.forEach(function(id){ sel[id]=!allOn; });
  STATE.leadSeqSel=sel; render();
};
window.leadClearSel=function(){ STATE.leadSeqSel={}; render(); };
window.leadStartSequence=function(){
  var sel=STATE.leadSeqSel||{};
  var ids=Object.keys(sel).filter(function(k){return sel[k];});
  if(!ids.length){ showToast('Select at least one lead','warning'); return; }
  var items=[], skipped=0;
  ids.forEach(function(jid){
    var cs=jobContacts(jid); var primary=cs.find(function(c){return c.is_primary;})||cs[0];
    if(primary&&primary.email)items.push({entity_id:primary.id,job_id:jid,contact_id:primary.id,label:((primary.first_name||'')+' '+(primary.last_name||'')).trim()||'Contact'});
    else skipped++;
  });
  if(!items.length){ showToast('None of the selected leads have a contact email','warning'); return; }
  if(skipped)showToast(skipped+' selected lead'+(skipped>1?'s':'')+' had no contact email — skipped','info');
  wfStartSequence('contact',items,{anyStage:true});
};
// From the send-results panel: open the failed lead's detail.
function closeAndOpenLead(jobId){ if(jobId){ openJob(jobId); } }
// Manually dismiss the send-results panel (stays put until dismissed when there are failures).
function dismissSendProgress(){ STATE._progressDismissed=true; STATE.sendProgress=null; scheduleRender(); }
function openAddJob(){ STATE.modal={type:"addJob"}; render(); }

// ── JOB DETAIL MODAL ──────────────────────────────
function renderJobDetailModal(){
  var j=jobById(STATE.modal.id); if(!j) return "";
  var u=STATE.user;
  var canChangeStage=userHasAnyRole(u,'admin','bd','bd_lead');
  var canEdit=userHasRole(u,'admin')||j.created_by===u.id||j.assigned_to===u.id||j.assigned_to_bd===u.id;
  var bdStages=['Connected','Rejected','Future','In Discussion'];
  var allStages=['Unassigned','Assigned','Connected','Rejected','Future','In Discussion'];
  var cs=jobContacts(j.id);
  var stageOpts=allStages.map(function(st){return '<option value="'+st+'"'+(j.stage===st?" selected":"")+'>'+st+'</option>';}).join("");

  var emailStatusColors={valid:'var(--green)',invalid:'var(--red)',deactivated:'var(--text3)',out_of_office:'var(--amber)'};
  var emailStatusLabels={valid:'Valid',invalid:'Invalid',deactivated:'Deactivated',out_of_office:'Out of Office'};
  var canChangeEmailStatus=userHasAnyRole(u,'admin','bd','bd_lead');

  var seqSel=STATE.jobSeqSel||[];
  var contactRows=cs.map(function(c){
    var es=c.email_status||'valid';
    var esColor=emailStatusColors[es]||'var(--text3)';
    var esLabel=emailStatusLabels[es]||es;
    var emailStatusBadge='<span style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:600;background:'+esColor+'22;color:'+esColor+'">'+esLabel+'</span>';
    var emailStatusSel=canChangeEmailStatus?
      '<select onchange="changeEmailStatus(\''+c.id+'\',this.value,\''+escHtml(c.email||'')+'\',\''+escHtml((c.first_name||'')+' '+(c.last_name||''))+'\')" style="font-size:11px;padding:3px 7px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);margin-top:4px">'+
        ['valid','invalid','deactivated','out_of_office'].map(function(s){
          return '<option value="'+s+'"'+(es===s?' selected':'')+'>'+emailStatusLabels[s]+'</option>';
        }).join('')+
      '</select>':'';
    var selectable=c.email&&!wfContactEnrollment(j.id,c.id);
    return '<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:12px;margin-bottom:8px">'+
      '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px">'+
        (selectable?'<input type="checkbox" '+(seqSel.indexOf(c.id)>-1?'checked':'')+' onclick="jobToggleSeqSel(\''+c.id+'\')" style="margin-top:3px;cursor:pointer" title="Select for Start sequence">':'')+
        '<div style="flex:1">'+
          '<div style="font-weight:600;color:var(--text)">'+escHtml((c.first_name||"")+" "+(c.last_name||""))+(c.is_primary?' <span style="background:rgba(16,185,129,.15);color:#10b981;padding:2px 7px;border-radius:8px;font-size:10px;margin-left:4px">PRIMARY</span>':'')+'</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+escHtml(c.designation||"—")+'</div>'+
          '<div style="font-size:12px;color:var(--text2);margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
            '\ud83d\udce7 '+escHtml(c.email||"—")+' '+emailStatusBadge+
          '</div>'+
          (canChangeEmailStatus?'<div style="margin-top:5px">'+emailStatusSel+(c.ooo_until&&es==='out_of_office'?'<span style="font-size:11px;color:var(--amber);margin-left:8px">until '+escHtml(c.ooo_until)+'</span>':'')+'</div>':'')+
          (c.phone?'<div style="font-size:12px;color:var(--text2);margin-top:4px">\ud83d\udcde '+escHtml(c.phone)+'</div>':'')+
          (c.linkedin?'<div style="font-size:12px;color:var(--text2);margin-top:2px">\ud83d\udd17 '+escHtml(c.linkedin)+'</div>':'')+
          wfContactChip(j.id,c)+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:4px">'+
          (c.email?'<button onclick="sendEmailToContact(\''+c.id+'\')" style="background:var(--accent);color:#fff;border:0;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer">Email</button>':'')+
          (c.email&&!wfContactEnrollment(j.id,c.id)?'<button onclick="wfEnrollContact(\''+c.id+'\',\''+j.id+'\')" style="background:transparent;color:var(--accent);border:1px solid var(--accent);padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer">Enroll</button>':'')+
          (canEdit?'<button onclick="deleteContact(\''+c.id+'\')" style="background:transparent;color:#ef4444;border:1px solid #ef4444;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer">Delete</button>':'')+
        '</div>'+
      '</div>'+
    '</div>';
  }).join("");
  if(!contactRows)contactRows='<div style="color:var(--text3);font-size:12px;padding:12px;text-align:center">No contacts yet.</div>';

  return '<div style="background:var(--bg2);border-radius:14px;width:min(720px,94vw);max-height:90vh;overflow-y:auto;border:1px solid var(--border)">'+
    '<div style="padding:20px 24px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:start;gap:12px">'+
      '<div><div style="font-size:18px;font-weight:700;color:var(--text)">'+escHtml(j.position)+'</div><div style="font-size:13px;color:var(--text3);margin-top:3px">'+escHtml(j.company_name)+(j.location?" · "+escHtml(j.location):"")+'</div></div>'+
      '<button onclick="closeModal()" style="background:transparent;border:0;color:var(--text3);font-size:22px;cursor:pointer;line-height:1">×</button>'+
    '</div>'+
    '<div style="padding:20px 24px">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">'+
        '<div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Stage</label>'+
          (canChangeStage?'<select id="job-stage-sel" onchange="changeJobStage(\''+j.id+'\',this.value)" style="width:100%;margin-top:5px;padding:8px;background:'+leadStageBg(j.stage)+';border:1.5px solid '+leadStageColor(j.stage)+';border-radius:7px;color:'+leadStageColor(j.stage)+';font-weight:600;font-size:13px">'+stageOpts+'</select>':'<div style="margin-top:5px;font-size:13px;font-weight:600;color:'+leadStageColor(j.stage)+'">'+j.stage+'</div>')+
        '</div>'+
        '<div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Source</label><div style="margin-top:5px;font-size:13px;color:var(--text)">'+escHtml(j.source||"—")+'</div></div>'+
      '</div>'+
      '<div style="margin-bottom:18px"><label style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Notes</label>'+
        (canEdit?'<textarea id="job-notes" onblur="saveJobNotes(\''+j.id+'\',this.value)" style="width:100%;margin-top:5px;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;min-height:64px;resize:vertical;font-family:inherit">'+escHtml(j.notes||"")+'</textarea>':'<div style="margin-top:5px;font-size:13px;color:var(--text)">'+escHtml(j.notes||"—")+'</div>')+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-size:13px;font-weight:600;color:var(--text)">Contacts ('+cs.length+')</div>'+
        '<div style="display:flex;gap:6px">'+
          (seqSel.length?'<button onclick="jobStartSequence(\''+j.id+'\')" style="background:var(--accent);color:#fff;border:0;padding:6px 12px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer">▶ Start sequence ('+seqSel.length+')</button>':'')+
          (canEdit?'<button onclick="openAddContact(\''+j.id+'\')" style="background:var(--accent);color:#fff;border:0;padding:6px 12px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer">+ Add Contact</button>':'')+
        '</div>'+
      '</div>'+
      contactRows+
      renderResearchSection(j, canEditResearch(u,j))+
      (canEdit?'<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border2);display:flex;justify-content:flex-end;gap:8px"><button onclick="deleteJob(\''+j.id+'\')" style="background:transparent;color:#ef4444;border:1px solid #ef4444;padding:7px 14px;border-radius:7px;font-size:12px;cursor:pointer">Delete Job</button></div>':'')+
    '</div>'+
  '</div>';
}

// ── ADD JOB MODAL ─────────────────────────────────
function renderAddJobModal(){
  var u=STATE.user;
  var coOpts=STATE.companies.map(function(c){return '<option value="'+c.id+'">'+escHtml(c.name)+'</option>';}).join("");
  return '<div style="background:var(--bg2);border-radius:14px;width:min(560px,94vw);max-height:90vh;overflow-y:auto;border:1px solid var(--border)">'+
    '<div style="padding:18px 22px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between"><div style="font-size:16px;font-weight:700;color:var(--text)">Add Lead</div><button onclick="closeModal()" style="background:transparent;border:0;color:var(--text3);font-size:22px;cursor:pointer;line-height:1">×</button></div>'+
    '<div style="padding:20px 22px">'+
      '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text3)">Company</label><select id="aj-co" style="width:100%;margin-top:4px;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px">'+coOpts+'</select></div>'+
      '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text3)">Position</label><input id="aj-pos" placeholder="e.g. Senior Software Engineer" style="width:100%;margin-top:4px;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
        '<div><label style="font-size:11px;color:var(--text3)">Location</label><input id="aj-loc" style="width:100%;margin-top:4px;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/></div>'+
        '<div><label style="font-size:11px;color:var(--text3)">Source</label><input id="aj-src" placeholder="LinkedIn, Indeed..." style="width:100%;margin-top:4px;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/></div>'+
      '</div>'+
      '<div style="margin-bottom:14px"><label style="font-size:11px;color:var(--text3)">Job URL (optional)</label><input id="aj-url" style="width:100%;margin-top:4px;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/></div>'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:8px;padding-top:6px;border-top:1px solid var(--border2);padding-top:12px">First contact (you can add more after creating)</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
        '<input id="aj-fn" placeholder="First name *" style="padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/>'+
        '<input id="aj-ln" placeholder="Last name" style="padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/>'+
      '</div>'+
      '<input id="aj-desig" placeholder="Designation" style="width:100%;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;margin-bottom:10px"/>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">'+
        '<input id="aj-email" placeholder="Email" style="padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/>'+
        '<input id="aj-phone" placeholder="Phone" style="padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/>'+
      '</div>'+
      '<div style="display:flex;justify-content:flex-end;gap:8px"><button onclick="closeModal()" style="background:transparent;color:var(--text3);border:1px solid var(--border);padding:9px 16px;border-radius:7px;cursor:pointer;font-size:13px">Cancel</button><button onclick="submitAddJob()" style="background:var(--accent);color:#fff;border:0;padding:9px 18px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:600">Add Lead</button></div>'+
    '</div>'+
  '</div>';
}

// ── ADD CONTACT MODAL ─────────────────────────────
function renderAddContactModal(){
  var jid=STATE.modal.job_id;
  return '<div style="background:var(--bg2);border-radius:14px;width:min(480px,94vw);border:1px solid var(--border)">'+
    '<div style="padding:18px 22px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between"><div style="font-size:16px;font-weight:700;color:var(--text)">Add Contact</div><button onclick="backToJob(\''+jid+'\')" style="background:transparent;border:0;color:var(--text3);font-size:22px;cursor:pointer;line-height:1">×</button></div>'+
    '<div style="padding:20px 22px">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
        '<input id="ac-fn" placeholder="First name *" style="padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/>'+
        '<input id="ac-ln" placeholder="Last name" style="padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px"/>'+
      '</div>'+
      '<input id="ac-desig" placeholder="Designation" style="width:100%;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;margin-bottom:10px"/>'+
      '<input id="ac-email" placeholder="Email" style="width:100%;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;margin-bottom:10px"/>'+
      '<input id="ac-phone" placeholder="Phone" style="width:100%;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;margin-bottom:10px"/>'+
      '<input id="ac-linkedin" placeholder="LinkedIn URL" style="width:100%;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;margin-bottom:14px"/>'+
      '<div style="display:flex;justify-content:flex-end;gap:8px"><button onclick="backToJob(\''+jid+'\')" style="background:transparent;color:var(--text3);border:1px solid var(--border);padding:9px 16px;border-radius:7px;cursor:pointer;font-size:13px">Cancel</button><button onclick="submitAddContact(\''+jid+'\')" style="background:var(--accent);color:#fff;border:0;padding:9px 18px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:600">Add Contact</button></div>'+
    '</div>'+
  '</div>';
}

// ── JOB/CONTACT ACTIONS ──
function saveJobNotes(jid, val){
  var j=jobById(jid); if(!j) return;
  if (j.notes===val) return;
  j.notes=val; showToast("Notes saved","success");
}
function deleteJob(jid){
  if(!confirm("Delete this job and all its contacts?")) return;
  STATE.jobs=STATE.jobs.filter(function(j){return j.id!==jid;});
  STATE.contacts=STATE.contacts.filter(function(c){return c.job_id!==jid;});
  STATE.modal=null; STATE.detailJob=null;
  showToast("Job deleted","success"); render();
}
function submitAddJob(){
  var co=document.getElementById("aj-co").value;
  var pos=document.getElementById("aj-pos").value.trim();
  var fn=document.getElementById("aj-fn").value.trim();
  if(!pos){showToast("Position is required","error");return;}
  if(!fn){showToast("First contact name is required","error");return;}
  apiPost('/jobs',{
    company_id:co,
    position:pos,
    location:document.getElementById("aj-loc").value.trim()||null,
    source:document.getElementById("aj-src").value.trim()||"LinkedIn",
    job_url:document.getElementById("aj-url").value.trim()||null,
    contacts:[{
      first_name:fn,
      last_name:document.getElementById("aj-ln").value.trim(),
      designation:document.getElementById("aj-desig").value.trim()||null,
      email:document.getElementById("aj-email").value.trim()||null,
      phone:document.getElementById("aj-phone").value.trim()||null
    }]
  }).then(function(){
    STATE.modal=null;
    showToast("Lead created","success");
    return refreshJobs();
  }).catch(function(e){
    showToast("Failed to create lead: "+e.message,"error");
  });
}
function openAddContact(jid){ STATE.modal={type:"addContact",job_id:jid}; render(); }
function backToJob(jid){ STATE.modal={type:"jobDetail",id:jid}; render(); }
function submitAddContact(jid){
  var fn=document.getElementById("ac-fn").value.trim();
  if(!fn){showToast("First name is required","error");return;}
  var existing=jobContacts(jid);
  apiPost('/contacts',{
    job_id:jid,
    first_name:fn,
    last_name:document.getElementById("ac-ln").value.trim(),
    designation:document.getElementById("ac-desig").value.trim()||null,
    email:document.getElementById("ac-email").value.trim()||null,
    phone:document.getElementById("ac-phone").value.trim()||null,
    linkedin:document.getElementById("ac-linkedin").value.trim()||null,
    is_primary:existing.length===0
  }).then(function(){
    showToast("Contact added","success");
    return refreshJobs();
  }).then(function(){
    STATE.modal={type:"jobDetail",id:jid}; render();
  }).catch(function(e){
    showToast("Failed to add contact: "+e.message,"error");
  });
}
function deleteContact(cid){
  if(!confirm("Delete this contact?")) return;
  var c=STATE.contacts.find(function(x){return x.id===cid;}); if(!c) return;
  apiDelete('/contacts/'+cid).then(function(){
    showToast("Contact deleted","success");
    return refreshJobs();
  }).catch(function(e){
    showToast("Failed to delete contact: "+e.message,"error");
  });
}
function sendEmailToContact(cid){
  var c=STATE.contacts.find(function(x){return x.id===cid;}); if(!c) return;
  var j=jobById(c.job_id)||{};
  STATE.composeContactId=cid+'|'+(j.id||'');
  STATE.composeCompanyId=j.company_id||null;
  STATE.composeContext=null;STATE.composeReminderId=null;
  STATE.manualEmail=null;STATE.genEmail=null;STATE.emailTab='compose';STATE.showAIPanel=false;
  STATE.page="email"; STATE.modal=null; showToast("Compose email to "+c.first_name,"info"); render();
}
function closeModal(){ STATE.modal=null; render(); }

