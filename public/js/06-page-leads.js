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
  // CONNECTED, NEWEST FIRST (Session 31). The owner: "just show those
  // connected based on the created date". Looking at Connected is looking for
  // the lead that just replied, and that is the newest one.
  var connOnly=f.stages&&f.stages.length===1&&f.stages[0]==='Connected';
  if(connOnly){
    jobs=jobs.slice().sort(function(a,b){
      return String(b.created_at||b.created_date||'').localeCompare(String(a.created_at||a.created_date||''));
    });
  }
  if(f.industries&&f.industries.length)jobs=jobs.filter(function(j){return f.industries.indexOf(j.industry||j.company_ind||"")>-1;});
  // "Assigned to" — one person's leads, or the ones nobody owns (owner, 8 Oct: the admin should see leads per assigned user).
  if(f.assignee)jobs=jobs.filter(function(j){return f.assignee==='none'?!j.assigned_to_bd:j.assigned_to_bd===f.assignee;});
  if(f.dateRange&&f.dateRange!=="all"&&f.dateRange!=="custom"){var _now=new Date();var _today=todayIST();var _cut=null;if(f.dateRange==="today")_cut=_today;else if(f.dateRange==="yesterday"){var _yy=new Date(_now);_yy.setDate(_yy.getDate()-1);_cut=_yy.toISOString().slice(0,10);}else if(f.dateRange==="week"){var _ww=new Date(_now);_ww.setDate(_ww.getDate()-7);_cut=_ww.toISOString().slice(0,10);}if(_cut){if(f.dateRange==="today"||f.dateRange==="yesterday")jobs=jobs.filter(function(j){return (j.created_at||"").slice(0,10)===_cut;});else jobs=jobs.filter(function(j){return (j.created_at||"").slice(0,10)>=_cut;});}}
  if(f.dateRange==="custom"){if(f.dateFrom)jobs=jobs.filter(function(j){return (j.created_at||"").slice(0,10)>=f.dateFrom;});if(f.dateTo)jobs=jobs.filter(function(j){return (j.created_at||"").slice(0,10)<=f.dateTo;});}

  var stages=["Unassigned","Assigned","Connected","Rejected","Future","Qualified"];
  var stageOpts=stages.map(function(st){return '<option value="'+st+'"'+(f.stage===st?" selected":"")+'>'+st+'</option>';}).join("");

  var canChangeStageInline=userHasAnyRole(u,'admin','bd','bd_lead');
  // Converting is a BD action on a Connected lead. The job list is fetched
  // once so a lead that already became a job says so instead of offering a
  // button the server would refuse.
  var canConvert=canChangeStageInline;
  if(canConvert&&window.bdEnsureJobOrdersForLeads)bdEnsureJobOrdersForLeads();
  // Cross-group sequencing: BD / BD Lead / Admin can multi-select leads across
  // any stage group and start one sequence for the lot (rotating "from" mailboxes).
  var canSequence=userHasAnyRole(u,'admin','bd','bd_lead');
  // Ticking leads is for everyone who may act on several at once (owner, 8 Oct: "the user or admin is not able to change the stage of the
  // leads while multiselect"): sequencing, handing out and changing the stage all start from the same ticks.
  var canSelect=userHasAnyRole(u,'admin','bd','bd_lead','ra_lead');
  var leadSel=STATE.leadSeqSel||{};
  // Selectable = every lead in the current filter (all pages). Sequencing skips the ones with no contact email and says so; changing the
  // stage and handing leads out do not need one.
  var leadSelectable=jobs.slice();
  STATE._leadSelectableIds=leadSelectable.map(function(j){return j.id;});
  // Only ticked leads that are in the CURRENT filter count — an action never reaches a lead the person can no longer see on screen.
  var leadSelIds=leadSelectable.filter(function(j){return leadSel[j.id];}).map(function(j){return j.id;});
  var leadSelCount=leadSelIds.length;
  var leadSelHidden=Object.keys(leadSel).filter(function(k){return leadSel[k];}).length-leadSelCount;
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
        'class="sel sel-sm sel-state" style="--sc:'+stageColor+'">'+
        ['Unassigned','Assigned','Connected','Rejected','Future','In Discussion'].map(function(st){
          return '<option value="'+st+'"'+(j.stage===st?' selected':'')+'>'+st+'</option>';
        }).join('')+'</select>'
      : '<span class="pill" style="background:'+stageColor+'14;color:'+stageColor+'"><i></i>'+escHtml(j.stage)+'</span>';
    if(canConvert&&j.stage==='Connected')stageCell='<span style="display:inline-flex;align-items:center;gap:6px">'+stageCell+leadConvertBtn(j,true)+'</span>';

    var cells=[];
    if(canSelect) cells.push({ cls:'tight', html:
      '<span onclick="event.stopPropagation()">'+
        '<input type="checkbox" class="ck" '+(leadSel[j.id]?'checked':'')+' onclick="event.stopPropagation();leadToggleSel(\''+j.id+'\')" title="Select this lead">'+
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
      : '<span class="c-ink3">—</span>' });
    cells.push({ cls:'tight', html: '<span class="c-ink3">'+
      escHtml(j.created_date||(j.created_at?new Date(j.created_at).toISOString().slice(0,10):''))+'</span>' });

    // D-0014: the row REVEALS, it does not navigate away. Clicking opens a
    // panel beneath this row with the things you actually came to do — the
    // email status per contact above all, which used to be a row click, a
    // drawer, and then hunting for a contact card. The drawer is still there
    // for the whole record; it is just no longer the only door.
    return { id: j.id, cells: cells, onclick: "leadRowToggle('"+j.id+"',event)" };
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
      { cls:'tight', html: '<span class="c-ink3">'+
          escHtml(j.created_date||(j.created_at?new Date(j.created_at).toISOString().slice(0,10):''))+'</span>' },
      { cls:'tight', html: '<span onclick="event.stopPropagation()">'+(canRAEdit
          ? '<button class="btn btn-sm btn-outline" onclick="raFormEdit(\''+j.id+'\')">Edit</button>'
          : '<span class="fs-11_5 c-ink3">Locked</span>')+'</span>' }
    ]};
  });

  if(isRA){
    return UI.page({
      toolbar: UI.toolbar({
        search:{ value:f.search||'', placeholder:'Search your leads…',
                 oninput:'STATE.jobsFilter.search=this.value;STATE.leadsPage=0;scheduleRender()' },
        icons:[{ icon:'refresh', title:'Refresh leads', onclick:'leadsRefreshNow()' }],
        right:'<span class="fs-12_5 c-ink3">'+jobs.length+' lead'+(jobs.length===1?'':'s')+' submitted by you</span>'
      }),
      body:
        renderRALeadForm()+
        '<div class="fs-14" style="margin:20px 0 10px;font-weight:600">Your submitted leads</div>'+
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
  var assigneeActive=!!f.assignee;
  var anyActive=stageActive||indActive||dateActive||assigneeActive;
  // "Assigned to" — who owns the leads on screen, with how many each (admin / leads see several people's; a BD sees only their own so it stays out of their way).
  var ownerCount={}, ownerName={}, nobody=0, everyLead=getMyJobs(u);
  everyLead.forEach(function(j){ if(j.assigned_to_bd){ ownerCount[j.assigned_to_bd]=(ownerCount[j.assigned_to_bd]||0)+1; ownerName[j.assigned_to_bd]=j.assigned_bd_name||'Someone'; } else nobody++; });
  var ownerIds=Object.keys(ownerCount).sort(function(a,b){ return String(ownerName[a]).localeCompare(String(ownerName[b])); });
  var assigneeSel=(userHasAnyRole(u,'admin','ra_lead','bd_lead')&&(ownerIds.length>1||nobody>0))
    ? '<select class="sel sel-sm" aria-label="Show leads assigned to" onchange="STATE.jobsFilter.assignee=this.value;STATE.leadsPage=0;render()">'+
        '<option value="">Everyone ('+everyLead.length+')</option>'+
        '<option value="none"'+(f.assignee==='none'?' selected':'')+'>Nobody — Unassigned ('+nobody+')</option>'+
        ownerIds.map(function(id){ return '<option value="'+escAttr(id)+'"'+(f.assignee===id?' selected':'')+'>'+escHtml(ownerName[id])+' ('+ownerCount[id]+')</option>'; }).join('')+
      '</select>' : '';
  function mkChkDrop(name,key,items,selected,active){
    var btn='<button class="btn btn-sm btn-outline flt-btn'+(active?' is-on':'')+'" onclick="event.stopPropagation();STATE.openDrop=STATE.openDrop===\''+name+'\' ?null:\''+name+'\';render()">'+(active?name+' ('+selected.length+')':name)+' <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>';
    var panel='';
    if(STATE.openDrop===name){
      panel='<div class="flt-panel" style="min-width:190px;padding:6px 0" onclick="event.stopPropagation()">'+
        items.map(function(v){var on=selected.indexOf(v)>-1;return '<label class="fs-13" style="display:flex;align-items:center;gap:9px;padding:7px 14px;cursor:pointer;background:'+(on?'var(--accent-l)':'transparent')+';color:'+(on?'var(--accent)':'var(--text)')+'"><input type="checkbox" '+(on?'checked':'')+' onchange="toggleJobFilter(\''+key+'\',\''+v+'\',this.checked)" style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer"/>'+v+'</label>';}).join('')+
        (selected.length?'<div style="border-top:1px solid var(--border);padding:6px 14px;margin-top:2px"><button onclick="STATE.jobsFilter.'+key+'=[];STATE.leadsPage=0;render()" class="fs-11_5 c-red" style="background:none;border:none;cursor:pointer;padding:0">Clear</button></div>':'')+
      '</div>';
    }
    return '<div style="position:relative">'+btn+panel+'</div>';
  }
  var dateLabel=f.dateRange==='today'?'Today':f.dateRange==='yesterday'?'Yesterday':f.dateRange==='week'?'This week':f.dateRange==='custom'&&(f.dateFrom||f.dateTo)?((f.dateFrom||'…')+' → '+(f.dateTo||'…')):'Date';
  var dateBtn='<div style="position:relative">'+
    '<button class="btn btn-sm btn-outline flt-btn'+(dateActive?' is-on':'')+'" onclick="event.stopPropagation();STATE.openDrop=STATE.openDrop===\'date\' ?null:\'date\';render()">'+dateLabel+' <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>'+
    (STATE.openDrop==='date'?
      '<div class="flt-panel" style="padding:12px 14px;min-width:240px" onclick="event.stopPropagation()">'+
        // Preset chips
        '<div style="display:flex;flex-direction:column;gap:2px;margin-bottom:8px">'+
          ['today','yesterday','week'].map(function(val){var lbl=val==='today'?'Today':val==='yesterday'?'Yesterday':'This week';var on=f.dateRange===val;return '<button onclick="STATE.jobsFilter.dateRange=STATE.jobsFilter.dateRange===\''+val+'\' ?\'all\':\''+val+'\';STATE.jobsFilter.dateFrom=\'\';STATE.jobsFilter.dateTo=\'\';STATE.leadsPage=0;render()" style="padding:7px 12px;border-radius:7px;font-size:13px;cursor:pointer;text-align:left;border:1px solid '+(on?'var(--accent)':'var(--border)')+';background:'+(on?'var(--accent-l)':'transparent')+';color:'+(on?'var(--accent)':'var(--text)')+';font-weight:'+(on?'600':'400')+'">'+lbl+'</button>';}).join('')+
        '</div>'+
        // Custom separator
        '<div style="border-top:1px solid var(--border);margin:8px 0 10px"></div>'+
        '<div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Custom range</div>'+
        '<div style="display:flex;flex-direction:column;gap:8px">'+
          '<div style="display:flex;align-items:center;gap:8px"><span class="fs-12 c-text2" style="width:28px">From</span><input type="date" value="'+escAttr(f.dateFrom||'')+'" onchange="STATE.jobsFilter.dateRange=\'custom\';STATE.jobsFilter.dateFrom=this.value;STATE.leadsPage=0;render()" style="flex:1;padding:6px 10px;border:1px solid var(--border2);border-radius:7px;font-size:13px;background:var(--card);color:var(--text)"/></div>'+
          '<div style="display:flex;align-items:center;gap:8px"><span class="fs-12 c-text2" style="width:28px">To</span><input type="date" value="'+escAttr(f.dateTo||'')+'" onchange="STATE.jobsFilter.dateRange=\'custom\';STATE.jobsFilter.dateTo=this.value;STATE.leadsPage=0;render()" style="flex:1;padding:6px 10px;border:1px solid var(--border2);border-radius:7px;font-size:13px;background:var(--card);color:var(--text)"/></div>'+
        '</div>'+
        (dateActive?'<button onclick="STATE.jobsFilter.dateRange=\'all\';STATE.jobsFilter.dateFrom=\'\';STATE.jobsFilter.dateTo=\'\';STATE.leadsPage=0;render()" style="margin-top:10px;font-size:12px;color:var(--red);background:none;border:none;cursor:pointer;padding:0">Clear</button>':'')+
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
    // Every stage FILTERS THE TABLE, Connected included (Session 31). Connected
    // used to open a side panel instead; the owner asked for the main list to
    // show just the connected leads, where the Convert button now lives.
    stripItems.push({
      v:stageCounts[st],
      label:st,
      on:!!(f.stages&&f.stages.length===1&&f.stages[0]===st),
      onclick:"STATE.jobsFilter.stages=['"+st+"'];STATE.leadsPage=0;render()"
    });
  });
  var stageSummary=UI.strip(stripItems);

  // The × beside the search box clears the SEARCH too. It used to clear only
  // stage/industry/date and was drawn switched off (pointer-events:none) when a
  // search was the only thing active — so with a search typed, or one filled
  // in by the client-conversations card, the × did nothing at all (owner,
  // 2026-09-28: "The cross button do not work").
  var clearFilters="STATE.jobsFilter.search='';STATE.jobsFilter.stages=[];STATE.jobsFilter.industries=[];STATE.jobsFilter.assignee='';"+
    "STATE.jobsFilter.dateRange='all';STATE.jobsFilter.dateFrom='';STATE.jobsFilter.dateTo='';"+
    "STATE.openDrop=null;STATE.leadsPage=0;render()";

  // The bulk bar only exists when something is selected, so it sits in the body
  // rather than the toolbar — a permanently-reserved empty strip is worse.
  // What a person may move a lead to in one go (the same rule the server enforces on POST /jobs/bulk-stage): an admin or RA lead may also
  // send leads back to Unassigned ("release to the pool" — nobody owns them, their waiting emails go, follow-ups stop); a BD / BD lead may move
  // the leads they own forward. "Assigned" is not here on purpose: it means a person and a mailbox — that is the Assign button.
  var canRelease=userHasAnyRole(u,'admin','ra_lead');
  var bulkStages=(canRelease?['Unassigned']:[]).concat(['Connected','In Discussion','Future','Rejected']);
  STATE._leadSelVisibleIds=leadSelIds;
  var bulkBar=(canSelect&&leadSelCount)?
    '<div class="card" style="padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span class="fs-13" style="font-weight:600">'+leadSelCount+' lead'+(leadSelCount>1?'s':'')+' selected</span>'+
      (leadSelHidden>0?'<span class="fs-11_5 c-ink3" title="Ticked earlier, but not in the list you are looking at — nothing here touches them">(+'+leadSelHidden+' hidden by the filters, left alone)</span>':'')+
      '<span style="display:inline-flex;align-items:center;gap:6px"><select id="bulk-stage-sel" class="sel sel-sm" aria-label="Change stage to">'+
        '<option value="">Change stage to…</option>'+bulkStages.map(function(st){return '<option value="'+st+'">'+(st==='Unassigned'?'Unassigned (release to the pool)':st)+'</option>';}).join('')+
      '</select><button class="btn btn-sm btn-outline" onclick="leadBulkStage()">Apply</button></span>'+
      '<button class="btn btn-sm btn-outline" onclick="openAssignLeads()" title="Give the ticked Unassigned leads to yourself or someone on your team">Assign selected</button>'+
      (canSequence?'<button class="btn btn-sm btn-primary" onclick="leadStartSequence()">'+UI.ic('send')+'Sequence selected</button>':'')+
      '<button class="btn btn-sm btn-outline" onclick="leadClearSel()">Clear</button>'+
    '</div>':'';

  var cols=[];
  if(canSelect) cols.push({ w:'34px', raw:
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
        { icon:'x', title:'Clear search and filters', onclick:clearFilters, off:!(anyActive||f.search) },
        { sep:true },
        { icon:'refresh', title:'Refresh leads', onclick:'leadsRefreshNow()' }
      ],
      right:
        assigneeSel+
        mkChkDrop('Stage','stages',allStagesList,f.stages||[],stageActive)+
        mkChkDrop('Industry','industries',allIndustriesList,f.industries||[],indActive)+
        dateBtn+
        (userHasAnyRole(u,'ra_lead','admin')
          ? '<button class="btn btn-sm btn-outline" onclick="openExportLeads()">'+UI.ic('dl')+'Export</button>':'')+
        (userHasAnyRole(u,'admin','ra_lead','bd','bd_lead')?'<button class="btn btn-sm btn-outline" onclick="openAssignLeads()" title="Give Unassigned leads to yourself or someone on your team — and choose how many go from each email ID">Assign</button>':'')+
        (userHasAnyRole(u,'bd','bd_lead')?'<button class="btn btn-sm btn-outline" onclick="openTakeLeads()" title="Be handed leads from the pool, into your own mailboxes">Take leads</button>':'')+
        '<button class="btn btn-sm btn-outline" onclick="triggerImport()">Import Excel</button>'+
        (u.role!=='ra'?'<button class="btn btn-sm btn-primary" onclick="openAddJob()">'+UI.ic('plus')+'Add Lead</button>':'')+
        '<input type="file" id="xl-import" accept=".xlsx,.xls" style="display:none" onchange="importXL(this)"/>'
    }),
    body:
      bulkBar+
      UI.table({
        cols:cols, rows:rows, minWidth:'1020px',
        empty: anyActive||f.search
          ? 'No leads match these filters. <span class="c-accent" style="cursor:pointer" onclick="'+escAttr(clearFilters)+'">Clear them &rarr;</span>'
          : 'No leads yet.'
      })+
      '<div class="fs-12_5 c-ink3" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'+
        '<div>'+jobs.length+' lead'+(jobs.length===1?'':'s')+'</div>'+
        (_tp>1?'<div style="display:flex;gap:6px;align-items:center">'+
          '<button class="btn btn-sm btn-outline" onclick="setLeadsPage('+(_pg-1)+')"'+(_pg===0?' disabled style="opacity:.5"':'')+'>&lsaquo; Prev</button>'+
          '<span>Page '+(_pg+1)+' / '+_tp+'</span>'+
          '<button class="btn btn-sm btn-outline" onclick="setLeadsPage('+(_pg+1)+')"'+(_pg>=_tp-1?' disabled style="opacity:.5"':'')+'>Next &rsaquo;</button>'+
        '</div>':'')+
      '</div>'
  });
}
// The Connected side panel is gone (Session 31); anything still calling this
// gets the same thing the strip now does — the table, filtered to Connected.
window.leadsShowConnected=function(){STATE.jobsFilter.stages=['Connected'];STATE.leadsPage=0;render();};
window.leadsCloseConnected=function(){};

// One Convert button, drawn on the row and in the expanded panel. A lead that
// already became a job names the job instead.
function leadConvertBtn(j,compact){
  var done=window.bdConvertedJobFor?bdConvertedJobFor(j.id):null;
  if(done)return '<span class="fs-11 c-ink3" style="white-space:nowrap" title="Already converted">✓ '+escHtml(done.job_code||'Job')+'</span>';
  return '<button class="btn btn-sm '+(compact?'btn-outline':'btn-primary')+'" style="white-space:nowrap'+(compact?';padding:3px 9px;font-size:12px':'')+'" '+
    'onclick="event.stopPropagation();bdConvertLead(\''+j.id+'\')">'+(compact?'Convert':'Convert to job')+'</button>';
}

// Bind search/filter inputs (called from render() after DOM replace)
// The search box and the stage <select> this used to wire up are now built by
// UI.toolbar with their handlers inline, and render() restores focus and caret
// by placeholder after a rebuild — so there is nothing left to bind. Kept as a
// no-op because 05-page-dashboard.js calls it on every leads render; deleting
// it there and here in one go is a separate, unrelated change.
function bindJobsControls(){}

// ══════════════════════════════════════════════════════════════════════════
// THE ROW REVEALS ITSELF (D-0014)
// --------------------------------------------------------------------------
// The owner: "those lead row or the job rows and all and not interactive they
// don't show anything, like earlier … we were able to change the email stage,
// to valid or invalid and all. Now those things and all are not there."
//
// Nothing had been removed — probed in a real browser, the control existed,
// worked, and was visible. It was just a row click, then a drawer, then
// hunting for a contact card, with NOTHING on the row hinting it was possible.
// A feature you cannot see is a feature you do not have.
//
// So: click a row and it opens IN PLACE, showing what the lead is and the two
// or three things you actually do to it. The drawer stays for the whole
// record — it is no longer the only door.
//
// THREE RULES THIS MUST KEEP:
//
//  1. ONE ROW OPEN AT A TIME, AND THE PANEL IS BUILT ON DEMAND. It is never
//     part of the table's html. Rendering a hidden panel per row would turn a
//     400-row list into 400 panels — precisely the unbounded growth
//     ageing-layout-smoke exists to catch. Open one, the previous one is gone.
//
//  2. NO render(). This inserts and removes ONE <tr> directly, like
//     toggleNav()/toggleRail()/toggleTheme(). Re-rendering #content to open a
//     row would reset the page's scroll — so expanding a row halfway down a
//     list would throw you back to the top, which is exactly the sort of thing
//     that makes a screen feel broken.
//
//  3. STATE.page IS NOT TOUCHED. Expanding is not navigation.
// ══════════════════════════════════════════════════════════════════════════
var LEAD_ES_LABELS={valid:'Valid',invalid:'Invalid',deactivated:'Deactivated',out_of_office:'Out of office'};

// ONE person on a lead, as a row with the email-status control. Shared by the
// plain contact list below and the POC finder's slots (62-poc-finder.js), so a
// person looks — and is marked valid/invalid — the same way in both.
// Several emails / phone numbers on a lead's contact (R-114 stage 2, D-0070): the same control as the
// candidate header — a LIVE place, each gesture saved at once through PUT /contacts/:id, the list reloaded.
// One scope per contact, registered once; the contact is looked up fresh each time.
window.leadContactCp=function(c, kind){
  if(!window.CP||!c||!c.id) return '';
  var scope='lc'+String(c.id).replace(/[^a-zA-Z0-9]/g,'');
  if(!CP.has(scope)) CP.register(scope,{
    model:function(){ return (STATE.contacts||[]).find(function(x){return x.id===c.id;})||null; },
    rerender:function(){ if(window.rowRevealRefresh) rowRevealRefresh(); else render(); },
    save:function(patch){
      apiPut('/contacts/'+c.id, patch)
        .then(function(){ showToast('Saved','success'); })
        .catch(function(e){ showToast((e&&e.message)||'Could not save','error'); })
        .then(function(){ return refreshJobs(); })
        // the open panel is NOT rebuilt by the list reload when it is already on screen — rebuild it from the fresh data
        .then(function(){ if(window.rowRevealRefresh) rowRevealRefresh(); });
    }
  });
  return CP.extras(scope, kind);
};

window.leadContactRowHtml=function(c){
  var esOpts=function(sel){
    return ['valid','invalid','deactivated','out_of_office'].map(function(k){
      return '<option value="'+k+'"'+(sel===k?' selected':'')+'>'+LEAD_ES_LABELS[k]+'</option>';
    }).join('');
  };
  var nm=((c.first_name||'')+' '+(c.last_name||'')).trim()||'—';
  var es=c.email_status||'valid';
  return '<div class="lx-contact">'+
    '<div class="lx-who">'+
      '<div class="lx-nm">'+escHtml(nm)+(c.is_primary?'<span class="lx-primary">Primary</span>':'')+'</div>'+
      '<div class="lx-sub">'+escHtml(c.designation||'—')+
        (c.email?' · <span class="lx-mail">'+escHtml(c.email)+'</span>':'')+
        (c.phone?' · <span class="lx-tel">\u260e '+escHtml(c.phone)+'</span>':'')+'</div>'+
      // more emails / numbers for this person — extras under the main, "Make main", "+ add another"
      '<div class="lx-cp" onclick="event.stopPropagation()">'+leadContactCp(c,'email')+leadContactCp(c,'phone')+'</div>'+
    '</div>'+
    // THE CONTROL THE OWNER COULD NOT FIND. Same handler the drawer uses —
    // one implementation, two places to reach it, never two copies.
    (c.email
      ? '<label class="lx-es"><span>Email</span>'+
          '<select class="lx-sel" onchange="event.stopPropagation();changeEmailStatus(\''+c.id+'\',this.value,\''+escHtml(c.email||'')+'\',\''+escHtml(nm)+'\')">'+
            esOpts(es)+
          '</select>'+
        '</label>'
      : '<span class="lx-noemail">No email</span>')+
    // Write to them from the row itself — the finder adds people and until now
    // there was nothing to do with one once added (R-083). Opens the composer
    // addressed to this person (sendEmailToContact -> outreachComposeTo).
    (c.email?'<button type="button" class="btn btn-sm btn-outline lx-mailbtn" onclick="event.stopPropagation();sendEmailToContact(\''+c.id+'\')" title="Write an email to '+escHtml(nm)+'">✉ Write</button>':'')+
  '</div>';
};

function leadExpandHtml(j){
  var cs=(typeof jobContacts==='function'?jobContacts(j.id):[])||[];
  var contactRows=cs.length?cs.map(leadContactRowHtml).join(''):'<div class="lx-empty">No contacts on this lead yet.</div>';

  var when=j.assigned_at?new Date(j.assigned_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):null;
  var facts=[
    ['Stage', j.stage||'—'],
    ['Industry', j.industry||j.company_ind||'—'],
    ['Assigned to', j.assigned_bd_name||'Unassigned'],
    ['Assigned', when||'—']
  ].map(function(f){
    return '<div class="lx-kv"><span>'+escHtml(f[0])+'</span><b>'+escHtml(f[1])+'</b></div>';
  }).join('');

  return '<div class="lx">'+
    '<div class="lx-main">'+
      // The POC finder's four slots (62-poc-finder.js, R-053). Until its answer
      // arrives — or if it never does — the plain contact list is what shows,
      // exactly as before; the slots then take its place in the same element.
      (window.leadPocSlot
        ? leadPocSlot(j, '<div class="lx-head">Contacts</div>'+contactRows)
        : '<div class="lx-head">Contacts</div>'+contactRows)+
      // The job posting the AI writes from (59-lead-posting.js, R-056).
      (window.leadPostingSlot?leadPostingSlot(j):'')+
      // The lead's emails + AI summary (58-lead-intel.js). Draws nothing while
      // it is switched off, and only the lead's owner sees the email text.
      (window.leadIntelSlot?leadIntelSlot(j):'')+
    '</div>'+
    '<div class="lx-side">'+
      '<div class="lx-facts">'+facts+'</div>'+
      // The job link and website used to live only in the Connected side
      // panel, which is gone; they belong with the lead wherever it opens.
      ((leadSafeUrl(j.job_url)||leadSafeUrl(j.company_web))?'<div class="fs-12" style="margin:0 0 8px;display:flex;gap:12px;flex-wrap:wrap">'+
        (leadSafeUrl(j.job_url)?'<a class="ld-link" href="'+escAttr(leadSafeUrl(j.job_url))+'" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Job posting ↗</a>':'')+
        (leadSafeUrl(j.company_web)?'<a class="ld-link" href="'+escAttr(leadSafeUrl(j.company_web))+'" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Website ↗</a>':'')+
      '</div>':'')+
      ((j.stage==='Connected'&&userHasAnyRole(STATE.user,'admin','bd','bd_lead'))?'<div style="margin-bottom:8px">'+leadConvertBtn(j,false)+'</div>':'')+
      '<button class="btn btn-outline btn-sm lx-open" onclick="event.stopPropagation();openJob(\''+j.id+'\')">Open full record</button>'+
    '</div>'+
  '</div>';
}

// The mechanism is shared by every list (rowReveal, 03-core-render.js, D-0048);
// this supplies only what a LEAD's panel shows. It looks the lead up afresh
// each time it is built, so a panel put back after a refresh shows current data.
window.leadRowToggle=function(id,ev){
  rowReveal(id, ev, function(){
    var j=(STATE.jobs||[]).find(function(x){return x.id===id;});
    return j?leadExpandHtml(j):null;
  }, 'lead-exp');
};

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
// Change the stage of every ticked lead that is in the list on screen (one call; the server applies its own rules per role and per owner).
window.leadBulkStage=function(){
  var sel=document.getElementById('bulk-stage-sel'), stage=sel?sel.value:'';
  var ids=(STATE._leadSelVisibleIds||[]).slice();
  if(!ids.length){ showToast('Tick the leads first','warning'); return; }
  if(!stage){ showToast('Choose the stage to move them to','warning'); return; }
  var warn=stage==='Unassigned'
    ? 'Release '+ids.length+' lead'+(ids.length===1?'':'s')+' to the Unassigned pool?\n\nNobody will own them any more. Emails written for them that have not been sent are removed, and their follow-ups stop. Nothing already sent is touched.'
    : 'Move '+ids.length+' lead'+(ids.length===1?'':'s')+' to "'+stage+'"?';
  if(!confirm(warn)) return;
  apiPost('/jobs/bulk-stage',{job_ids:ids,stage:stage}).then(function(r){
    var n=(r&&r.updated)||0;
    showToast(n?(n+' lead'+(n===1?'':'s')+' moved to '+stage+(n<ids.length?' ('+(ids.length-n)+' could not be changed by you)':'')):'None of them could be changed by you',n?'success':'warning');
    STATE.leadSeqSel={};
    if(typeof refreshJobs==='function') refreshJobs(); else render();
  }).catch(function(e){ showToast('Could not change the stage: '+((e&&e.message)||e),'error'); });
};
window.leadStartSequence=function(){
  var sel=STATE.leadSeqSel||{};
  var vis=STATE._leadSelVisibleIds||null;
  var ids=Object.keys(sel).filter(function(k){return sel[k]&&(!vis||vis.indexOf(k)>-1);});
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
function openAddJob(){ STATE.addLead=window.addLeadFresh(); STATE.modal={type:"addJob"}; render(); }

// ── JOB DETAIL MODAL ──────────────────────────────
// ── LEAD DETAILS (Session 29) ─────────────────────────────────────────────
// Everything the lead came in with. The browser already had the company's
// website, the job link, industry and salary; this window simply never drew
// them, so an owner opening a lead that had just replied could not find the
// posting or the company's site. Columns the import did not recognise are
// kept on the lead (research.import_extra) and listed here as written.
function leadSafeUrl(v){
  var s=String(v||'').trim(); if(!s)return '';
  if(!/^https?:\/\//i.test(s)){ if(/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s))s='https://'+s; else return ''; }
  return s;
}
function leadLinkOrText(v){
  var u=leadSafeUrl(v);
  return u?'<a href="'+escAttr(u)+'" target="_blank" rel="noopener noreferrer" class="ld-link">'+escHtml(String(v).replace(/^https?:\/\//i,'').replace(/\/$/,''))+'</a>':escHtml(v);
}
function leadDetailsBlock(j){
  var r=j.research||{};
  var rows=[
    ['Company',j.company_name],
    ['Company website',j.company_web,true],
    ['Job link',j.job_url,true],
    ['Industry',j.industry||j.company_ind],
    ['Location',j.location],
    ['Salary',j.salary_range],
    ['Job posted',j.job_created_date],
    ['Source',j.source]
  ].filter(function(x){return x[1];});
  var extra=r.import_extra&&typeof r.import_extra==='object'?r.import_extra:{};
  // The spreadsheet's own row number ("S,no") is not a lead detail — PACE
  // numbers records itself. Already-imported leads may still carry the key
  // (D-0035); skip it here too, sharing the one list rather than a second copy.
  var extraKeys=Object.keys(extra).filter(function(k){return extra[k]&&!(window.ImportColumns&&window.ImportColumns.isSerialColumn(k));});
  var cell=function(label,val,isLink){
    return '<div class="ld-row"><div class="ld-k">'+escHtml(label)+'</div><div class="ld-v">'+(isLink?leadLinkOrText(val):(leadSafeUrl(val)&&/^https?:/i.test(String(val))?leadLinkOrText(val):escHtml(val)))+'</div></div>';
  };
  return '<div class="ld">'+
    '<div class="ld-h">Lead details</div>'+
    rows.map(function(x){return cell(x[0],x[1],x[2]);}).join('')+
    (j.job_url?'':'<div class="ld-row"><div class="ld-k">Job link</div><div class="ld-v ld-none">Not in the import</div></div>')+
    (extraKeys.length?'<div class="ld-h ld-h2">Other details from the import</div>'+extraKeys.map(function(k){return cell(k,extra[k]);}).join(''):'')+
  '</div>';
}

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
    var emailStatusBadge='<span class="fs-10" style="padding:2px 7px;border-radius:6px;font-weight:600;background:'+esColor+'22;color:'+esColor+'">'+esLabel+'</span>';
    var emailStatusSel=canChangeEmailStatus?
      '<select onchange="changeEmailStatus(\''+c.id+'\',this.value,\''+escHtml(c.email||'')+'\',\''+escHtml((c.first_name||'')+' '+(c.last_name||''))+'\')" class="sel sel-sm sel-inline" style="margin-top:4px">'+
        ['valid','invalid','deactivated','out_of_office'].map(function(s){
          return '<option value="'+s+'"'+(es===s?' selected':'')+'>'+emailStatusLabels[s]+'</option>';
        }).join('')+
      '</select>':'';
    var selectable=c.email&&!wfContactEnrollment(j.id,c.id);
    return '<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:12px;margin-bottom:8px">'+
      '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px">'+
        (selectable?'<input type="checkbox" '+(seqSel.indexOf(c.id)>-1?'checked':'')+' onclick="jobToggleSeqSel(\''+c.id+'\')" style="margin-top:3px;cursor:pointer" title="Select for Start sequence">':'')+
        '<div style="flex:1">'+
          '<div class="c-text" style="font-weight:600">'+escHtml((c.first_name||"")+" "+(c.last_name||""))+(c.is_primary?' <span class="fs-10" style="background:var(--green-l);color:var(--green);padding:2px 7px;border-radius:8px;margin-left:4px">PRIMARY</span>':'')+'</div>'+
          '<div class="fs-12 c-text3" style="margin-top:2px">'+escHtml(c.designation||"—")+'</div>'+
          '<div class="fs-12 c-text2" style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
            '\ud83d\udce7 '+escHtml(c.email||"—")+' '+emailStatusBadge+
          '</div>'+
          (canChangeEmailStatus?'<div style="margin-top:5px">'+emailStatusSel+(c.ooo_until&&es==='out_of_office'?'<span class="fs-11 c-amber" style="margin-left:8px">until '+escHtml(c.ooo_until)+'</span>':'')+'</div>':'')+
          (c.phone?'<div class="fs-12 c-text2" style="margin-top:4px">\ud83d\udcde '+escHtml(c.phone)+'</div>':'')+
          (c.linkedin?'<div class="fs-12 c-text2" style="margin-top:2px">\ud83d\udd17 '+escHtml(c.linkedin)+'</div>':'')+
          wfContactChip(j.id,c)+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:4px">'+
          (c.email?'<button onclick="sendEmailToContact(\''+c.id+'\')" style="background:var(--accent);color:#fff;border:0;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer">Email</button>':'')+
          (c.email&&!wfContactEnrollment(j.id,c.id)?'<button onclick="wfEnrollContact(\''+c.id+'\',\''+j.id+'\')" style="background:transparent;color:var(--accent);border:1px solid var(--accent);padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer">Enroll</button>':'')+
          (canEdit?'<button onclick="deleteContact(\''+c.id+'\')" style="background:transparent;color:var(--red);border:1px solid var(--red);padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer">Delete</button>':'')+
        '</div>'+
      '</div>'+
    '</div>';
  }).join("");
  if(!contactRows)contactRows='<div class="c-text3 fs-12" style="padding:12px;text-align:center">No contacts yet.</div>';

  return '<div style="background:var(--card);border-radius:14px;width:min(720px,94vw);max-height:90vh;overflow-y:auto;border:1px solid var(--border)">'+
    '<div style="padding:20px 24px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:start;gap:12px">'+
      '<div><div class="fs-18 c-text" style="font-weight:700">'+escHtml(j.position)+'</div><div class="fs-13 c-text3" style="margin-top:3px">'+escHtml(j.company_name)+(j.location?" · "+escHtml(j.location):"")+'</div></div>'+
      // The rewind clock, beside the close. A lead ALREADY had a full trail in
      // activity_log — every stage change, dated — and nothing had ever shown
      // it to anybody. This is the read, not a new recording.
      '<div style="display:flex;align-items:center;gap:10px">'+
        (window.rewindBtn?rewindBtn('lead',j.id):'')+
        '<button onclick="closeModal()" class="c-text3 fs-22" style="background:transparent;border:0;cursor:pointer;line-height:1">×</button>'+
      '</div>'+
    '</div>'+
    '<div style="padding:20px 24px">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">'+
        '<div><label class="fs-11 c-text3" style="text-transform:uppercase;letter-spacing:.5px">Stage</label>'+
          (canChangeStage?'<select id="job-stage-sel" onchange="changeJobStage(\''+j.id+'\',this.value)" class="sel sel-state" style="margin-top:5px;--sc:'+leadStageColor(j.stage)+'">'+stageOpts+'</select>':'<div class="fs-13" style="margin-top:5px;font-weight:600;color:'+leadStageColor(j.stage)+'">'+j.stage+'</div>')+
        '</div>'+
        '<div><label class="fs-11 c-text3" style="text-transform:uppercase;letter-spacing:.5px">Source</label><div class="fs-13 c-text" style="margin-top:5px">'+escHtml(j.source||"—")+'</div></div>'+
      '</div>'+
      // D-0038: a manager viewing a report's lead (or anyone else who is not
      // its owner) sees "Ask to take over" once the server confirms it —
      // never a button that will refuse. `canEdit` already IS the ownership
      // check for a lead, so this is exactly its inverse.
      (canEdit?'':'<div style="margin-bottom:16px">'+(window.otSlot?otSlot('lead',j.id):'')+'</div>')+
      leadDetailsBlock(j)+
      '<div style="margin-bottom:18px"><label class="fs-11 c-text3" style="text-transform:uppercase;letter-spacing:.5px">Notes</label>'+
        (canEdit?'<textarea id="job-notes" onblur="saveJobNotes(\''+j.id+'\',this.value)" style="width:100%;margin-top:5px;padding:9px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;min-height:64px;resize:vertical;font-family:inherit">'+escHtml(j.notes||"")+'</textarea>':'<div class="fs-13 c-text" style="margin-top:5px">'+escHtml(j.notes||"—")+'</div>')+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div class="fs-13 c-text" style="font-weight:600">Contacts ('+cs.length+')</div>'+
        '<div style="display:flex;gap:6px">'+
          (seqSel.length?'<button onclick="jobStartSequence(\''+j.id+'\')" style="background:var(--accent);color:#fff;border:0;padding:6px 12px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer">▶ Start sequence ('+seqSel.length+')</button>':'')+
          (canEdit?'<button onclick="openAddContact(\''+j.id+'\')" style="background:var(--accent);color:#fff;border:0;padding:6px 12px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer">+ Add Contact</button>':'')+
        '</div>'+
      '</div>'+
      contactRows+
      renderResearchSection(j, canEditResearch(u,j))+
      (canEdit?'<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border2);display:flex;justify-content:flex-end;gap:8px"><button onclick="deleteJob(\''+j.id+'\')" style="background:transparent;color:var(--red);border:1px solid var(--red);padding:7px 14px;border-radius:7px;font-size:12px;cursor:pointer">Delete Job</button></div>':'')+
    '</div>'+
  '</div>';
}

// ── ADD LEAD (R-124 follow-up, D-0077) ───────────────────────────────────────
// The owner: "the add lead page looks like old theme … there is no option of
// adding a new company name, no option to add another POC for that lead, no
// address bar of the company." So: the shared form kit (it takes the retro
// look with the rest of the app), a company that is EITHER found among yours OR
// added right here (name, website, industry, address, city — checked against
// yours first so it is never added twice), the job opening, and as many
// contacts as the person has — the first is the main one.
// Everything typed lives in STATE.addLead, so adding a contact or switching
// company mode redraws the window without losing a letter.
window.addLeadFresh=function(){
  return { mode:'existing', company:null, coText:'',
    newCo:{ name:'', website:'', industry:'', address_line1:'', address_line2:'', city:'', state:'', postal_code:'', country:'' },
    pos:'', loc:'', src:'LinkedIn', url:'', busy:false,
    contacts:[ window.addLeadBlankContact() ] };
};
window.addLeadBlankContact=function(){ return { first_name:'', last_name:'', designation:'', email:'', phone:'', linkedin:'' }; };

function renderAddJobModal(){
  var a=STATE.addLead||(STATE.addLead=window.addLeadFresh());
  var inds=(typeof getIndustriesList==='function'&&getIndustriesList().length?getIndustriesList():(window.INDUSTRIES||[]));
  var indOpts='<option value="">— Industry —</option>'+inds.map(function(i){return '<option'+(a.newCo.industry===i?' selected':'')+'>'+htmlEsc(i)+'</option>';}).join('');
  var srcOpts=SOURCES.map(function(x){return '<option'+(a.src===x?' selected':'')+'>'+htmlEsc(x)+'</option>';}).join('');

  var company;
  if(a.mode==='new'){
    company='<div class="g2">'+
        '<div class="fgrp"><label class="flbl">Company name <span class="c-red">*</span></label><input class="inp" id="al-conew" value="'+htmlEsc(a.newCo.name)+'" placeholder="e.g. Acme Corp" oninput="addLeadCo(\'name\',this.value)"/></div>'+
        '<div class="fgrp"><label class="flbl">Website</label><input class="inp" value="'+htmlEsc(a.newCo.website)+'" placeholder="acme.com" oninput="addLeadCo(\'website\',this.value)"/></div>'+
      '</div>'+
      '<div class="fgrp"><label class="flbl">Street address</label><input class="inp" value="'+htmlEsc(a.newCo.address_line1)+'" placeholder="e.g. 1400 Edwin Miller Blvd" oninput="addLeadCo(\'address_line1\',this.value)"/></div>'+
      '<div class="fgrp"><label class="flbl">Suite / floor / unit</label><input class="inp" value="'+htmlEsc(a.newCo.address_line2)+'" placeholder="Optional" oninput="addLeadCo(\'address_line2\',this.value)"/></div>'+
      '<div class="g3">'+
        '<div class="fgrp"><label class="flbl">City</label><input class="inp" value="'+htmlEsc(a.newCo.city)+'" oninput="addLeadCo(\'city\',this.value)"/></div>'+
        '<div class="fgrp"><label class="flbl">State / region</label><input class="inp" value="'+htmlEsc(a.newCo.state)+'" oninput="addLeadCo(\'state\',this.value)"/></div>'+
        '<div class="fgrp"><label class="flbl">ZIP / postal code</label><input class="inp" value="'+htmlEsc(a.newCo.postal_code)+'" oninput="addLeadCo(\'postal_code\',this.value)"/></div>'+
      '</div>'+
      '<div class="g2">'+
        '<div class="fgrp"><label class="flbl">Country</label><input class="inp" value="'+htmlEsc(a.newCo.country)+'" placeholder="e.g. United States" oninput="addLeadCo(\'country\',this.value)"/></div>'+
        '<div class="fgrp"><label class="flbl">Industry</label><select class="sel" onchange="addLeadCo(\'industry\',this.value)">'+indOpts+'</select></div>'+
      '</div>'+
      '<div class="fs-12 c-text3">We check the name against your companies first, so it is never added twice.</div>';
  } else if(a.company){
    company='<div class="al-picked"><div><div class="al-picked-n">'+htmlEsc(a.company.name)+'</div>'+
      '<div class="fs-12 c-text3">'+htmlEsc([a.company.industry,a.company.location].filter(Boolean).join(' · ')||'Already in your companies')+'</div></div>'+
      '<button class="btn btn-outline btn-sm" onclick="addLeadChangeCo()">Change</button></div>';
  } else {
    company=companyAcHTML('al-co',a.coText,'addLeadPickCo','addLeadTypeCo','Search your companies…')+
      '<div class="fs-12 c-text3" style="margin-top:6px">Not there? <a href="#" class="c-accent" onclick="addLeadMode(\'new\');return false;">Add it as a new company</a></div>';
  }

  var contacts=a.contacts.map(function(c,i){
    function f(k,ph,type){ return '<input class="inp" '+(type?'type="'+type+'" ':'')+'placeholder="'+ph+'" value="'+htmlEsc(c[k])+'" oninput="addLeadContact('+i+',\''+k+'\',this.value)"/>'; }
    return '<div class="al-contact">'+
      '<div class="al-contact-h"><span class="al-contact-t">'+(i===0?'Main contact':'Contact '+(i+1))+'</span>'+
        (i>0?'<button class="btn btn-outline btn-sm" onclick="addLeadRemoveContact('+i+')">Remove</button>':'')+'</div>'+
      '<div class="g3"><div class="fgrp">'+f('first_name','First name *')+'</div><div class="fgrp">'+f('last_name','Last name')+'</div><div class="fgrp">'+f('designation','Designation')+'</div></div>'+
      '<div class="g3"><div class="fgrp">'+f('email','Email','email')+'</div><div class="fgrp">'+f('phone','Phone','tel')+'</div><div class="fgrp">'+f('linkedin','LinkedIn URL')+'</div></div>'+
    '</div>';
  }).join('');

  return '<div class="modal modal-w860">'+
    '<div class="mh"><div class="mt">Add lead</div><button class="btn-icon" onclick="closeModal()" aria-label="Close">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div class="al-sec"><div class="al-h"><span class="al-ht">Company</span>'+
        '<div class="al-tabs"><button class="fc'+(a.mode==='existing'?' on':'')+'" onclick="addLeadMode(\'existing\')">Existing company</button>'+
        '<button class="fc'+(a.mode==='new'?' on':'')+'" onclick="addLeadMode(\'new\')">New company</button></div></div>'+company+'</div>'+
      '<div class="al-sec"><div class="al-h"><span class="al-ht">Job opening</span></div>'+
        '<div class="g3"><div class="fgrp span2"><label class="flbl">Position <span class="c-red">*</span></label><input class="inp" id="al-pos" value="'+htmlEsc(a.pos)+'" placeholder="e.g. Senior Software Engineer" oninput="addLeadField(\'pos\',this.value)"/></div>'+
          '<div class="fgrp"><label class="flbl">Source</label><select class="sel" onchange="addLeadField(\'src\',this.value)">'+srcOpts+'</select></div></div>'+
        '<div class="g2"><div class="fgrp"><label class="flbl">Location</label><input class="inp" value="'+htmlEsc(a.loc)+'" placeholder="City, State" oninput="addLeadField(\'loc\',this.value)"/></div>'+
          '<div class="fgrp"><label class="flbl">Job URL (optional)</label><input class="inp" value="'+htmlEsc(a.url)+'" oninput="addLeadField(\'url\',this.value)"/></div></div></div>'+
      '<div class="al-sec"><div class="al-h"><span class="al-ht">People at the company</span><span class="fs-12 c-text3">the first is the main contact — you can add more later too</span></div>'+
        contacts+
        '<button class="btn btn-outline btn-sm" onclick="addLeadAddContact()">'+ico('plus',12)+' Add another contact</button></div>'+
    '</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitAddJob()"'+(a.busy?' disabled':'')+'>'+(a.busy?'Adding…':'Add lead')+'</button></div>'+
  '</div>';
}

// ── ADD CONTACT MODAL ─────────────────────────────
function renderAddContactModal(){
  var jid=STATE.modal.job_id;
  return '<div class="modal modal-w640">'+
    '<div class="mh"><div class="mt">Add contact</div><button class="btn-icon" onclick="backToJob(\''+jid+'\')" aria-label="Back to the lead">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div class="g2"><div class="fgrp"><label class="flbl">First name <span class="c-red">*</span></label><input class="inp" id="ac-fn"/></div>'+
        '<div class="fgrp"><label class="flbl">Last name</label><input class="inp" id="ac-ln"/></div></div>'+
      '<div class="fgrp"><label class="flbl">Designation</label><input class="inp" id="ac-desig" placeholder="e.g. CTO"/></div>'+
      '<div class="g2"><div class="fgrp"><label class="flbl">Email</label><input class="inp" id="ac-email" type="email"/></div>'+
        '<div class="fgrp"><label class="flbl">Phone</label><input class="inp" id="ac-phone" type="tel"/></div></div>'+
      '<div class="fgrp"><label class="flbl">LinkedIn URL</label><input class="inp" id="ac-linkedin" placeholder="linkedin.com/in/…"/></div>'+
    '</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="backToJob(\''+jid+'\')">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitAddContact(\''+jid+'\')">Add contact</button></div>'+
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
// The ONE "Email this person" entry for a lead's contacts (R-084/R-083): the
// lead drawer's button, the lead row's contact list and the POC finder's slots
// all come here. It opens the composer ALREADY ADDRESSED — name, address, title,
// company, the role — through outreachComposeTo (48-page-outreach-gen.js).
function sendEmailToContact(cid){
  var c=(STATE.contacts||[]).find(function(x){return x.id===cid;}); if(!c) return;
  if(!c.email){ showToast("This contact has no email address yet","warning"); return; }
  var j=jobById(c.job_id)||{};
  if(!window.outreachComposeTo){ showToast("The email screen is not loaded yet — try again in a moment","error"); return; }
  outreachComposeTo({ id:c.id, name:((c.first_name||"")+" "+(c.last_name||"")).trim(), email:c.email,
    title:c.designation||"", company:j.company_name||"", location:j.location||"", job_id:j.id||c.job_id||null, job_title:j.position||"" });
}
window.sendEmailToContact=sendEmailToContact;
function closeModal(){ STATE.modal=null; render(); }

// The Leads page's refresh button (the same idea as the Inbox's): leads that changed elsewhere — one the Lead Finder
// just made, a colleague's assignment — appear without reloading the browser.
window.leadsRefreshNow=function(){
  showToast('Refreshing leads…','info');
  refreshJobs().then(function(){ showToast('Leads are up to date','success'); })
    .catch(function(e){ showToast('Could not refresh: '+((e&&e.message)||e),'error'); });
};
