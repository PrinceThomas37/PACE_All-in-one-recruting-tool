// ===== BD MANAGER / RECRUITER WORKFLOW MODULE (additive) =====

(function(){

  // ── US states ─────────────────────────────────────────────────────────────
  var US_STATES=["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];
  var US_STATE_ABBR={AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"};

  // Leads only ever store a combined "City, ST" (or "City, State") free-text
  // location — there's no discrete city/state on the lead. Split it so the New
  // Job form (whose State field is a <select> of full state names) can actually
  // prefill instead of silently sitting blank.
  function parseLeadLocation(loc){
    var out={city:'',state:''};
    if(!loc)return out;
    var parts=String(loc).split(',');
    if(parts.length<2){out.city=parts[0].trim();return out;}
    out.city=parts[0].trim();
    var raw=parts[parts.length-1].trim();
    var abbr=raw.toUpperCase();
    if(US_STATE_ABBR[abbr]){out.state=US_STATE_ABBR[abbr];return out;}
    var full=US_STATES.find(function(s){return s.toLowerCase()===raw.toLowerCase();});
    if(full)out.state=full;
    return out;
  }

  // ── BD namespace on STATE (no demo data, real API only) ───────────────────
  if(!STATE.bd){
    STATE.bd={
      jobOrders:[],
      candidates:[],
      submissions:[],
      assignments:[],
      loading:false,
      view:{joId:null,kanbanJoId:null},
      form:{},
      leadSel:{},
      jobFilter:{state:"",status:"",job_type:"",priority:"",remote:""},
      jobFilterOpen:false,
      jobsView:'all',
      _filterDocBound:false,
      _convertQueue:null
    };
  }

  var BD_STAGES=["Sourced","Screening","Submitted to BDM","Submitted to Client","Interview Scheduled","Interview Completed","Offer","Joining","Placement","Not Accepted","On Hold"];
  // Map any pre-migration stage value (Confirmation/Rejected/Not Joined) to the
  // current vocabulary so bucketing/counts stay correct until the data migration.
  function nStage(x){ return (window.normalizeStage?normalizeStage(x):x); }
  var BDM_GATED="Submitted to Client";
  var STAGE_COLORS={"Sourced":"var(--text3)","Screening":"#6b7280","Submitted to BDM":"var(--amber)","Submitted to Client":"var(--accent)","Interview Scheduled":"#2563eb","Interview Completed":"#1d4ed8","Offer":"#7c3aed","Joining":"#0891b2","Placement":"var(--green)","Not Accepted":"var(--red)","On Hold":"#9ca3af"};
  var JOB_TYPES=["Contract","Full-time","Contract-to-Hire","Part-time","1099","W2"];
  var EMP_LEVELS=["Entry","Associate","Mid-Senior","Director","Executive"];
  var WORK_AUTH=["US Citizen","Green Card","H1B","OPT/CPT","TN","Any"];
  var PRIORITIES=["Low","Normal","High","Urgent"];
  var JOB_STATUSES=["Active","On Hold","Filled","Closed"];
  var REMOTE=["No","Yes","Hybrid"];

  function isBDM(u){return userHasAnyRole(u,'admin','bd','bd_lead');}
  function isRec(u){return userHasRole(u,'recruiter');}
  function uName(id){var x=(STATE.users||[]).find(function(u){return u.id===id;});return x?x.name:"—";}
  function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function code(t){return '<span style="font-family:var(--mono);font-size:10.5px;color:var(--text3);font-weight:600">'+esc(t)+'</span>';}
  function badge(st){var c={Active:"var(--green)","On Hold":"var(--amber)",Filled:"var(--accent)",Closed:"var(--text3)"}[st]||"var(--text3)";return '<span style="font-size:11px;font-weight:700;color:'+c+';background:rgba(0,0,0,.04);padding:2px 8px;border-radius:10px">'+esc(st)+'</span>';}

  // ── API loaders ────────────────────────────────────────────────────────────
  function loadJobOrders(){
    STATE.bd.loading=true;render();
    return apiGet('/job-orders').then(function(d){
      STATE.bd.jobOrders=d||[];STATE.bd.loading=false;render();
    }).catch(function(e){STATE.bd.loading=false;showToast('Failed to load jobs: '+e.message,'error');render();});
  }
  function loadCandidates(q){
    return apiGet('/candidates'+(q?'?q='+encodeURIComponent(q):'')).then(function(d){return d||[];}).catch(function(){return[];});
  }
  function loadSubmissions(joId){
    return apiGet('/job-orders/'+joId+'/submissions').then(function(d){return d||[];}).catch(function(){return[];});
  }

  // ── Converting a lead (Session 31) ─────────────────────────────────────────
  // There used to be a "Select connected leads to convert" bar injected above
  // the Leads table, plus a chip picker. The owner found its Convert button
  // stayed dead until a lead was ticked in BOTH places, and once lit it never
  // went out: the bar was written into the DOM once and the render engine,
  // which only rewrites what changed, never rewrote it. It is gone. A connected
  // lead now carries its own Convert button (on the row and in its expanded
  // panel), and the Connected count on the strip filters the table itself.
  //
  // CONVERTING NEVER LEAVES THE PAGE YOU ARE ON. It used to goPage('bd_joborders')
  // first, so cancelling the form dropped you on Jobs rather than back on Leads.
  window.bdConvertLead=function(leadId){
    var lead=(STATE.jobs||[]).find(function(x){return x.id===leadId;});
    if(!lead){showToast('Lead not found','error');return;}
    if(lead.stage!=='Connected'){showToast('Only a Connected lead can become a job','warning');return;}
    var done=convertedJobFor(leadId);
    if(done){showToast('Already a job — '+(done.job_code||'open it from Jobs'),'info');return;}
    STATE.bd._convertQueue=null;
    bdOpenNewJob(leadId);
  };
  // The job order a lead already became, if the browser knows of one. The
  // server refuses a double conversion regardless; this only decides the label.
  function convertedJobFor(leadId){
    return (STATE.bd.jobOrders||[]).find(function(o){return o.source_lead_id===leadId;})||null;
  }
  window.bdConvertedJobFor=convertedJobFor;
  // The Leads page asks for the job list once, quietly, so a converted lead can
  // say so instead of offering a button the server would refuse.
  window.bdEnsureJobOrdersForLeads=function(){
    if(STATE.bd._joForLeads)return;
    STATE.bd._joForLeads=true;
    apiGet('/job-orders').then(function(d){
      if(!STATE.bd.jobOrders||!STATE.bd.jobOrders.length){STATE.bd.jobOrders=d||[];}
      scheduleRender();
    }).catch(function(){});
  };

  var _origRender=window.render;

  // ── Page routing ───────────────────────────────────────────────────────────
  var BD_PAGES={bd_joborders:1,bd_myjobs:1,bd_jodetail:1,bd_kanban:1};
  window.BD_PAGES=BD_PAGES;
  var _origGoPage=window.goPage;
  window.goPage=function(p){
    if(BD_PAGES[p]){
      STATE.page=p;STATE.modal=null;
      _origRender();
      if(p==='bd_joborders'||p==='bd_myjobs')loadJobOrders();
      else paintBDPage();
      return;
    }
    return _origGoPage.apply(this,arguments);
  };

  UI.registerPage('bd_joborders',function(){ return renderJobOrders(); });
  UI.registerPage('bd_myjobs',   function(){ return renderMyJobs(); });
  UI.registerPage('bd_jodetail', function(){ return renderJobOrderDetail(); });
  UI.registerPage('bd_kanban',   function(){ return renderKanban(); });

  function paintBDPage(){
    if(!BD_PAGES[STATE.page])return;
    paintPageContent();
    if(STATE.page==='bd_joborders'&&STATE.bd.jobFilterOpen&&!STATE.bd._filterDocBound){
      STATE.bd._filterDocBound=true;
      setTimeout(function(){
        var h=function(){STATE.bd.jobFilterOpen=false;STATE.bd._filterDocBound=false;document.removeEventListener('click',h);render();};
        document.addEventListener('click',h);
      },0);
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  function myJobOrders(){
    var u=STATE.user; if(!u)return[];
    if(isBDM(u))return STATE.bd.jobOrders;
    return STATE.bd.jobOrders.filter(function(j){
      return (j.recruiters||[]).some(function(r){return r.recruiter_id===u.id||r.recruiter&&r.recruiter.id===u.id;});
    });
  }
  function joById(id){return STATE.bd.jobOrders.find(function(j){return j.id===id;});}

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE: Jobs list
  // ════════════════════════════════════════════════════════════════════════════
  window.renderJobOrders=function(){
    if(STATE.bd.loading)return '<div class="page"><div style="text-align:center;padding:60px;color:var(--text3)">Loading jobs…</div></div>';
    var f=STATE.bd.jobFilter;
    var all=STATE.bd.jobOrders;
    var mine=all.filter(function(j){return j.bd_manager&&j.bd_manager.id===STATE.user.id;});
    // Team's jobs = jobs managed by anyone on my reporting line (direct +
    // transitive). Shown only to a user who actually leads a team.
    var teamIds=(window.reportingSubtree?reportingSubtree(STATE.user.id):[]).map(function(t){return t.id;});
    var team=teamIds.length?all.filter(function(j){return j.bd_manager&&teamIds.indexOf(j.bd_manager.id)>-1;}):[];
    var view=STATE.bd.jobsView||'all';
    if(view==='team'&&!teamIds.length)view='all';
    var base=view==='mine'?mine:view==='team'?team:all;
    var rows=base.filter(function(j){
      if(f.state&&(j.state||'')!==f.state)return false;
      if(f.status&&(j.status||'')!==f.status)return false;
      if(f.job_type&&(j.job_type||'')!==f.job_type)return false;
      if(f.priority&&(j.priority||'')!==f.priority)return false;
      if(f.remote&&(j.remote||'')!==f.remote)return false;
      return true;
    });
    // ── AGE (Session 23) ────────────────────────────────────────────────────
    // This table used to draw every row it had. Measured with two years of
    // records it went from 326 DOM nodes to 30,026 — 92x — and the browser
    // does that work on every repaint. Search first (a typed query means the
    // user is looking for something specific, so it must reach the whole
    // history, not just the window), then the horizon, then one page.
    var jq=(STATE.bd.jobSearch||'').trim().toLowerCase();
    if(jq){
      rows=rows.filter(function(j){
        return [j.job_title,j.client,j.job_code,j.lead_code,j.city,j.state]
          .some(function(v){return String(v||'').toLowerCase().indexOf(jq)>-1;});
      });
    }
    // A search reaches all of history; an unsearched list gets the horizon.
    var part=UI.partition(rows,{
      showAll:!!jq||!!STATE.bd.jobShowAll,
      closedOf:function(j){return !jq&&(j.status==='Closed'||j.status==='Filled'||j.status==='Cancelled');}
    });
    rows=part.visible;
    var jPg=UI.clampPage(STATE.bd.jobPage,rows.length);
    STATE.bd.jobPage=jPg;
    var jobsHorizon=UI.horizonBar(part.counts,{onShowAll:"bdJobShowAll()",noun:"jobs"});
    var jobsPager=UI.pager(rows.length,jPg,"bdJobGoPage(%d)");
    var rowsPaged=rows.slice(jPg*UI.PAGE_SIZE,(jPg+1)*UI.PAGE_SIZE);
    var activeCount=['state','status','job_type','priority','remote'].filter(function(k){return f[k];}).length;
    var jobTabs=[['mine','My Jobs',mine.length]];
    if(teamIds.length)jobTabs.push(['team',"Team's Jobs",team.length]);
    jobTabs.push(['all','All Jobs',all.length]);
    var jobsTabBar='<div style="display:flex;gap:8px;margin-bottom:12px">'+
      jobTabs.map(function(t){
        var on=view===t[0];
        return '<button onclick="bdSetJobsView(\''+t[0]+'\')" style="padding:7px 14px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid '+(on?'var(--accent)':'var(--border)')+';background:'+(on?'var(--accent)':'var(--card)')+';color:'+(on?'#fff':'var(--text2)')+'">'+t[1]+' ('+t[2]+')</button>';
      }).join('')+
    '</div>';
    // Multi-select (item 24): checkbox column + bulk status change.
    var jsel=STATE.bd.jobSel||(STATE.bd.jobSel={});
    // "Select all shown" must mean the rows on screen, not the rows that exist.
    // With a horizon and a pager those are different sets, and a bulk status
    // change against 2,000 invisible jobs is not what anyone ticked a box for.
    STATE.bd._jobRowIds=rowsPaged.map(function(j){return j.id;});
    var selIds=rowsPaged.filter(function(j){return jsel[j.id];}).map(function(j){return j.id;});
    var allChecked=rowsPaged.length&&rowsPaged.every(function(j){return jsel[j.id];});
    var bulkBar=selIds.length?'<div style="display:flex;align-items:center;gap:12px;background:var(--accent-l);border:1px solid var(--accent);border-radius:10px;padding:10px 14px;margin-bottom:12px;flex-wrap:wrap">'+
      '<span style="font-size:13px;font-weight:700;color:var(--accent)">'+selIds.length+' job'+(selIds.length>1?'s':'')+' selected</span>'+
      '<span style="font-size:12.5px;color:var(--text2)">Set status:</span>'+
      '<select onchange="if(this.value)bdBulkStatus(this.value);this.value=\'\'" class="sel" style="font-size:12.5px;padding:5px 8px"><option value="">Choose…</option>'+JOB_STATUSES.map(function(s){return '<option value="'+esc(s)+'">'+esc(s)+'</option>';}).join('')+'</select>'+
      '<button onclick="bdJobClearSel()" style="margin-left:auto;background:transparent;color:var(--text2);border:1px solid var(--border);padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer">Clear</button>'+
    '</div>':'';
    function fopt(key,all,list){return '<select class="sel" onchange="bdSetJobFilter(\''+key+'\',this.value)"><option value="">'+all+'</option>'+list.map(function(s){return '<option value="'+esc(s)+'"'+(f[key]===s?' selected':'')+'>'+esc(s)+'</option>';}).join("")+'</select>';}
    var body=rowsPaged.map(function(j){
      var recs=j.recruiters||[];
      var recNames=recs.length?recs.map(function(r){return r.recruiter?r.recruiter.name:uName(r.recruiter_id);}).join(', '):'<span style="color:var(--text3)">Unassigned</span>';
      var loc=[j.city,j.state].filter(Boolean).join(', ');
      var pay=(j.pay_min||j.pay_max)?((j.pay_cur||'USD')+' '+(j.pay_min||'?')+'–'+(j.pay_max||'?')):'—';
      return '<tr style="border-top:1px solid var(--border);cursor:pointer" onclick="bdOpenJobOrder(\''+j.id+'\')">'+
        '<td style="padding:11px 12px;width:34px" onclick="event.stopPropagation()"><input type="checkbox" '+(jsel[j.id]?'checked':'')+' onclick="event.stopPropagation();bdJobToggleSel(\''+j.id+'\')" style="cursor:pointer;width:15px;height:15px;accent-color:var(--accent)"/></td>'+
        '<td style="padding:11px 12px">'+code(j.job_code)+'<div style="font-size:10px;color:var(--text3);margin-top:2px">'+esc(j.lead_code||'')+'</div></td>'+
        '<td style="padding:11px 12px"><div style="font-weight:600;font-size:13.5px">'+esc(j.job_title||'')+'</div></td>'+
        '<td style="padding:11px 12px;font-size:12.5px">'+esc(j.client||'—')+'</td>'+
        '<td style="padding:11px 12px;font-size:12.5px">'+esc(loc||'—')+'</td>'+
        '<td style="padding:11px 12px">'+badge(j.status)+'</td>'+
        '<td style="padding:11px 12px;font-size:12.5px">'+esc(pay)+'</td>'+
        '<td style="padding:11px 12px;font-size:12.5px">'+recNames+'</td>'+
      '</tr>';
    }).join("");

    return '<div class="page">'+
      jobsTabBar+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
        '<div style="font-size:13px;color:var(--text3)">'+(view==='mine'?'Jobs you manage.':'Every job in the company.')+' Convert a connected lead from the Leads page, or create one here.</div>'+
        '<div style="display:flex;gap:8px;align-items:center;position:relative">'+
          '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();bdToggleFilter()" title="Filters">'+
            '<span style="display:inline-flex;align-items:center;gap:6px">'+
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>'+
              'Filters'+(activeCount?' ('+activeCount+')':'')+
            '</span>'+
          '</button>'+
          UI.searchBox(STATE.bd.jobSearch,'bdJobSearch(this.value)','Search jobs, clients, codes…')+
          '<button class="btn btn-primary" onclick="bdOpenNewJob(null)">+ New Job</button>'+
          (STATE.bd.jobFilterOpen?
            '<div onclick="event.stopPropagation()" style="position:absolute;top:40px;right:0;z-index:30;width:260px;background:var(--card-solid);border:1px solid var(--border);border-radius:12px;box-shadow:var(--sh3);padding:14px">'+
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-weight:700;font-size:13px">Filters</div>'+(activeCount?'<button onclick="bdClearJobFilter()" style="font-size:11.5px;color:var(--red);background:none;border:none;cursor:pointer">Clear all</button>':'')+'</div>'+
              '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--text3)">State</label>'+fopt('state','All states',US_STATES)+'</div>'+
              '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--text3)">Status</label>'+fopt('status','All statuses',JOB_STATUSES)+'</div>'+
              '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--text3)">Job Type</label>'+fopt('job_type','All types',JOB_TYPES)+'</div>'+
              '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--text3)">Priority</label>'+fopt('priority','All priorities',PRIORITIES)+'</div>'+
              '<div><label style="font-size:11px;color:var(--text3)">Remote</label>'+fopt('remote','Any',REMOTE)+'</div>'+
            '</div>':'')+
        '</div>'+
      '</div>'+
      bulkBar+
      jobsHorizon+
      '<div class="card" style="overflow:auto">'+
        '<table style="width:100%;border-collapse:collapse;font-size:13px;min-width:860px">'+
          '<thead><tr style="background:var(--bg);text-align:left">'+
            '<th style="padding:10px 12px;width:34px"><input type="checkbox" '+(allChecked?'checked':'')+' onclick="bdJobToggleSelAll()" style="cursor:pointer;width:15px;height:15px;accent-color:var(--accent)" title="Select all shown"/></th>'+
            ['JOB CODE','JOB TITLE','CLIENT','LOCATION','STATUS','PAY RATE','RECRUITER'].map(function(h){return '<th style="padding:10px 12px;font-size:11px;color:var(--text3);font-weight:600">'+h+'</th>';}).join("")+
          '</tr></thead>'+
          '<tbody>'+(body||'<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--text3)">'+
            (jq?'No jobs match “'+esc(jq)+'”.':'No jobs yet. Convert a connected lead or create one.')+'</td></tr>')+'</tbody>'+
        '</table>'+
        jobsPager+
      '</div>'+
    '</div>';
  };
  // Typing resets to page 1 — staying on page 7 of a search that has 2 pages
  // is how a filter appears to return nothing.
  window.bdJobSearch=function(v){STATE.bd.jobSearch=v;STATE.bd.jobPage=0;render();};
  window.bdJobGoPage=function(i){STATE.bd.jobPage=i;render();};
  window.bdJobShowAll=function(){STATE.bd.jobShowAll=true;STATE.bd.jobPage=0;render();};
  window.bdSetJobsView=function(v){STATE.bd.jobsView=v;render();};
  window.bdToggleJD=function(){STATE.bd.jdExpanded=!STATE.bd.jdExpanded;render();};
  window.bdTogglePrevJD=function(){STATE.bd.jdShowPrev=!STATE.bd.jdShowPrev;STATE.bd.jdExpanded=false;render();};
  window.bdJobToggleSel=function(id){var s=STATE.bd.jobSel||(STATE.bd.jobSel={});if(s[id])delete s[id];else s[id]=true;render();};
  window.bdJobToggleSelAll=function(){var ids=STATE.bd._jobRowIds||[];var s=STATE.bd.jobSel||(STATE.bd.jobSel={});var allOn=ids.length&&ids.every(function(id){return s[id];});ids.forEach(function(id){if(allOn)delete s[id];else s[id]=true;});render();};
  window.bdJobClearSel=function(){STATE.bd.jobSel={};render();};
  window.bdBulkStatus=function(status){var s=STATE.bd.jobSel||{};var ids=Object.keys(s).filter(function(k){return s[k];});if(!ids.length||!status)return;Promise.all(ids.map(function(id){return apiPut('/job-orders/'+id,{status:status});})).then(function(){showToast(ids.length+' job'+(ids.length>1?'s':'')+' set to '+status,'success');STATE.bd.jobSel={};if(window.loadJobOrders)loadJobOrders();}).catch(function(e){showToast('Bulk update failed: '+(e&&e.message||e),'error');});};
  window.bdSetJobFilter=function(k,v){STATE.bd.jobFilter[k]=v;STATE.bd.jobFilterOpen=true;render();};
  window.bdClearJobFilter=function(){STATE.bd.jobFilter={state:"",status:"",job_type:"",priority:"",remote:""};render();};
  window.bdToggleFilter=function(){STATE.bd.jobFilterOpen=!STATE.bd.jobFilterOpen;render();};

  // ════════════════════════════════════════════════════════════════════════════
  // NEW JOB FORM — tabbed
  // ════════════════════════════════════════════════════════════════════════════
  window.bdOpenNewJob=function(leadId){
    var f={tab:'details',status:'Active',pay_cur:'USD',remote:'No',clearance:'No',
      job_title:'',client:'',client_job_id:'',client_manager:'',end_client:'',
      job_type:'',emp_level:'',work_auth:'',priority:'Normal',
      country:'United States',state:'',city:'',zip:'',
      pay_min:'',pay_max:'',start_date:'',end_date:'',duration:'',
      req_docs:'',placement_fee:'',primary_skills:'',secondary_skills:'',
      exp_min:'',exp_max:'',industry:'',domain:'',degree:'',languages:'',job_category:'',
      positions:'1',job_description:'',comments:'',recruiter_ids:[],
      source_lead_id:null,lead_code:null,
      // The Client box is a NAME; company_id is that name resolved to a real
      // `companies` row. Null just means "not picked from the list yet" — the
      // server find-or-creates from the typed name, so a new client is fine.
      company_id:null,
      // The client's postal address (migration 043) and its POCs. A job order
      // with nobody on it cannot be emailed or followed up, so at least one
      // contact with a name and an email is required (owner's call, Session 26).
      address:{},contacts:[pocNewContact()],
      // What the server knows about a picked client: its cooldown state, the
      // POCs it already has, the address on file. Fetched on pick, not on save.
      intake:null,intakeLoading:false};
    if(leadId){
      var lead=(STATE.jobs||[]).find(function(j){return j.id===leadId;});
      if(lead){
        f.source_lead_id=lead.id;
        f.lead_code=lead.lead_code||lead.lead_code||'';
        f.job_title=lead.position||lead.pos||'';
        f.client=lead.company_name||'';
        f.company_id=lead.company_id||null;
        var loc=parseLeadLocation(lead.location);
        f.city=loc.city; f.state=loc.state;
        // THE POSTING TRAVELS WITH THE LEAD (Session 31). The import keeps the
        // job link; the form now shows it right where the description goes, so
        // converting is "open, copy, paste", not a hunt for the lead record.
        f.job_url=lead.job_url||'';
        var req=(lead.research&&lead.research.requirements)||{};
        var sk=(req.skills||[]).filter(function(x){return x&&String(x).toLowerCase()!=='title';});
        if(sk.length&&!f.primary_skills)f.primary_skills=sk.join(', ');
        if(lead.salary_range&&!f.comments)f.comments='Posted salary: '+lead.salary_range;
      }
    }
    STATE.bd.form=f;
    pocRegister('bd',{get:function(){return (STATE.bd.form||{}).contacts;}});
    if(f.company_id) bdLoadIntake(f.company_id);
    renderNewJobModal();
  };

  // Edit an existing job order — reuses the SAME multi-tab form, populated from
  // the job order. Available to BD managers and assigned recruiters (backend
  // enforces the permission).
  window.bdOpenEditJob=function(jid){
    var j=joById(jid);
    if(!j){
      apiGet('/job-orders/'+jid).then(function(jo){
        STATE.bd.jobOrders=STATE.bd.jobOrders||[];
        if(!STATE.bd.jobOrders.some(function(x){return x.id===jo.id;})) STATE.bd.jobOrders.push(jo);
        bdOpenEditJob(jid);
      }).catch(function(e){ showToast('Failed to load job: '+e.message,'error'); });
      return;
    }
    var f={ tab:'details', _editId:jid, source_lead_id:null, lead_code:j.lead_code||'',
      recruiter_ids:(j.recruiters||[]).map(function(r){ return (r.recruiter&&r.recruiter.id)||r.recruiter_id; }).filter(Boolean) };
    ['job_title','client','client_job_id','client_manager','end_client','status','job_type','emp_level',
     'work_auth','priority','remote','clearance','country','state','city','zip','pay_cur','pay_min','pay_max',
     'start_date','end_date','duration','placement_fee','req_docs','primary_skills','secondary_skills',
     'exp_min','exp_max','industry','domain','degree','languages','job_category','positions',
     'job_description','comments'].forEach(function(k){
      var v=j[k];
      if((k==='start_date'||k==='end_date') && v) v=String(v).slice(0,10);
      f[k]=(v!=null?v:'');
    });
    if(!f.pay_cur) f.pay_cur='USD';
    if(!f.status) f.status='Active';
    STATE.bd.form=f;
    renderNewJobModal();
  };

  function fld(label,inner,req){return '<div style="margin-bottom:12px"><label style="font-size:11.5px;color:var(--text2);display:block;margin-bottom:3px">'+label+(req?' <span style="color:var(--red)">*</span>':'')+'</label>'+inner+'</div>';}
  function inp(key,ph){return '<input class="sel" value="'+esc(STATE.bd.form[key]||'')+'" placeholder="'+(ph||'')+'" oninput="bdFormSet(\''+key+'\',this.value)">';}
  function selF(key,opts){return '<select class="sel" onchange="bdFormSet(\''+key+'\',this.value)">'+opts.map(function(o){return '<option value="'+esc(o)+'"'+(STATE.bd.form[key]===o?' selected':'')+'>'+esc(o||'Select')+'</option>';}).join("")+'</select>';}
  function selBlank(key,opts){return selF(key,[''].concat(opts));}

  window.bdFormSet=function(k,v){STATE.bd.form[k]=v;};
  // Address boxes, like every other box here: record, never re-render. A
  // re-render on a keystroke takes the caret out of the field being typed in.
  window.bdAddrSet=function(k,v){
    var f=STATE.bd.form; if(!f) return;
    f.address=f.address||{}; f.address[k]=v;
  };
  window.bdUseKnownPoc=function(i){
    var f=STATE.bd.form; if(!f||!f.intake) return;
    var p=(f.intake.contacts||[])[i]; if(!p) return;
    pocUse('bd',p);
  };
  window.bdFormTab=function(t){STATE.bd.form.tab=t;renderNewJobModal();};
  // What the Client box will DO when Save is pressed, said before it is pressed.
  // A client that does not exist yet is created — that is not an error, and the
  // form should not leave the person guessing which of the two is happening.
  // A direct create is the one path that resolves a client, collects POCs and
  // creates the underlying lead. Edit and convert-from-lead do none of that.
  function isDirectCreate(f){ return !f._editId && !f.source_lead_id; }

  // Ask the server what it knows about a picked client — cooldown, the POCs it
  // already holds, the address on file — in ONE call, at the moment of picking.
  // The cooldown especially: learning at Save that a client is blocked, after
  // twenty fields are filled, is the failure this whole session is about.
  function bdLoadIntake(companyId){
    var f=STATE.bd.form; if(!f) return;
    f.intakeLoading=true; f.intake=null;
    apiGet('/companies/'+companyId+'/intake').then(function(d){
      var cur=STATE.bd.form;
      if(!cur||cur.company_id!==companyId) return;   // they changed their mind
      cur.intake=d; cur.intakeLoading=false;
      // Pre-fill the address we already hold, so it is EDITED rather than
      // retyped — and so a blank box is never mistaken for "remove this".
      if(d.address&&Object.keys(d.address).length&&!Object.keys(cur.address||{}).length){
        cur.address=Object.assign({},d.address);
      }
      bdPatchClientHint(); renderNewJobModal();
    }).catch(function(){
      var cur=STATE.bd.form; if(cur){cur.intakeLoading=false;bdPatchClientHint();}
    });
  }

  // The cooldown is a BLOCK (the owner's call, Session 26), so it gets weight —
  // but exactly one tinted panel, not a red form. A list is calm; colour is a
  // scarce resource (D-0019).
  function bdCooldownBanner(f){
    var cd=f.intake&&f.intake.cooldown;
    if(!cd||!cd.blocked) return '';
    return '<div id="bd-cooldown" style="margin-top:8px;padding:10px 12px;border-left:3px solid var(--amber,#f59e0b);background:var(--bg);border-radius:6px;font-size:12px;color:var(--text2);line-height:1.5">'+
      '<strong style="color:var(--text)">On cooldown — this job cannot be saved yet.</strong><br>'+esc(cd.sentence)+'</div>';
  }
  function bdCooldownBlocked(f){
    return !!(isDirectCreate(f)&&f.intake&&f.intake.cooldown&&f.intake.cooldown.blocked);
  }

  // The picker is shown ONLY where it does something: a direct create, which is
  // the one path that resolves a client from what was typed.
  //   · EDIT — PUT /job-orders/:id never changes the company (pickJobFields
  //     drops company_id), so offering to pick one would be a lie on screen.
  //   · FROM A LEAD — /job-orders/from-lead/:id inherits the lead's company;
  //     retyping the name here would change nothing.
  // Both keep the plain text box they have always had, which writes the
  // job_orders.client label and nothing else.
  function clientField(f){
    if(f._editId||f.source_lead_id) return inp('client','Client company');
    return companyAcHTML('bd-client',f.client,'bdClientPick','bdClientType','Start typing a client name…')+
      '<div id="bd-client-hint" style="font-size:11px;color:var(--text3);margin-top:3px">'+bdClientHint(f)+'</div>'+
      '<div id="bd-client-block">'+bdCooldownBanner(f)+'</div>';
  }
  function bdClientHint(f){
    var typed=(f.client||'').trim();
    if(!typed) return 'Pick an existing client, or type a new one.';
    if(f.company_id){
      if(f.intakeLoading) return 'Existing client — checking…';
      var n=f.intake&&f.intake.contacts?f.intake.contacts.length:0;
      return 'Existing client.'+(n?' PACE already has '+n+' contact'+(n===1?'':'s')+' here — see the Client &amp; POC tab.':'');
    }
    return 'New client — “'+esc(typed)+'” will be added to your clients.';
  }
  function bdPatchClientHint(){
    var f=STATE.bd.form; if(!f) return;
    var el=document.getElementById('bd-client-hint');
    if(el) el.innerHTML=bdClientHint(f);
    var b=document.getElementById('bd-client-block');
    if(b) b.innerHTML=bdCooldownBanner(f);
  }
  // Typing invalidates any previously picked client. Leaving a stale
  // company_id under freshly typed text is how a job lands on the wrong client.
  window.bdClientType=function(val){
    var f=STATE.bd.form; if(!f) return;
    f.client=val; f.company_id=null;
    // A typed name is a DIFFERENT client until proven otherwise, so everything
    // the server told us about the last one stops applying — including its
    // cooldown. Leaving a stale block up would refuse a company that is free.
    f.intake=null; f.intakeLoading=false;
    bdPatchClientHint();
  };
  // Picking patches the input and the hint DIRECTLY rather than re-rendering —
  // a re-render here would rebuild the modal and take the focus out of the box.
  window.bdClientPick=function(co,inputId){
    var f=STATE.bd.form; if(!f) return;
    f.client=co.name; f.company_id=co.id;
    var el=document.getElementById(inputId||'bd-client');
    if(el) el.value=co.name;
    bdPatchClientHint();
    bdLoadIntake(co.id);
  };
  window.bdZipPick=function(place){
    var f=STATE.bd.form;
    f.zip=place.zip||f.zip; f.city=place.city||f.city; f.state=place.state||f.state;
    renderNewJobModal();
  };

  // ── THE JOB DESCRIPTION BOX (Session 31) ──────────────────────────────────
  // On the first tab, because it is the thing a converted lead is missing and
  // the thing everything downstream (matching, candidate emails, the apply
  // page) reads. It used to sit last, on "Organizational".
  function jdBlockHTML(f){
    var url=leadSafeLink(f.job_url);
    return '<div style="margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">'+
        '<label style="font-size:11.5px;color:var(--text2)">Job Description <span style="color:var(--red)">*</span></label>'+
        '<div style="display:flex;gap:6px;align-items:center">'+
          (f._jdPrev!=null?'<button type="button" class="btn btn-sm btn-outline" onclick="bdUndoJdRewrite()" style="font-size:11.5px">Undo rewrite</button>':'')+
          '<button type="button" id="bd-jd-ai" class="btn btn-sm btn-outline" onclick="bdRewriteJd()" style="font-size:11.5px">'+(f._jdBusy?'Rewriting…':'✨ Rewrite with AI')+'</button>'+
        '</div>'+
      '</div>'+
      (url?'<div style="font-size:12px;color:var(--text2);background:var(--bg);border-radius:8px;padding:8px 10px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
        '<a class="ld-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer" style="font-weight:600">Open the job posting ↗</a>'+
        '<span style="color:var(--text3)">Copy the description there and paste it below — then let AI tidy it up if you like.</span>'+
      '</div>':'')+
      '<textarea id="bd-jd" class="sel" style="min-height:150px;resize:vertical" oninput="bdFormSet(\'job_description\',this.value)" placeholder="Paste the job description here">'+esc(f.job_description)+'</textarea>'+
    '</div>';
  }
  function leadSafeLink(v){
    var s=String(v||'').trim(); if(!s)return '';
    if(!/^https?:\/\//i.test(s)){ if(/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s))s='https://'+s; else return ''; }
    return s;
  }
  window.bdRewriteJd=function(){
    var f=STATE.bd.form; if(!f||f._jdBusy)return;
    var ta=document.getElementById('bd-jd');
    var text=ta?ta.value:(f.job_description||'');
    if(String(text).trim().length<40){showToast('Paste the job description first — then AI can rewrite it.','warning');return;}
    f.job_description=text; f._jdBusy=true; renderNewJobModal();
    apiPost('/job-orders/rewrite-jd',{text:text,job_title:f.job_title,client:f.client}).then(function(r){
      var cur=STATE.bd.form; if(!cur)return; cur._jdBusy=false;
      if(r&&r.used_ai&&r.text){
        cur._jdPrev=text; cur.job_description=r.text;
        showToast('Rewritten by AI — read it through before saving','success');
      } else {
        aiSubscribePopup(r&&r.reason);
      }
      renderNewJobModal();
    }).catch(function(e){
      var cur=STATE.bd.form; if(cur){cur._jdBusy=false;renderNewJobModal();}
      showToast('Could not rewrite: '+e.message,'error');
    });
  };
  window.bdUndoJdRewrite=function(){
    var f=STATE.bd.form; if(!f||f._jdPrev==null)return;
    f.job_description=f._jdPrev; f._jdPrev=null; renderNewJobModal();
  };

  // ── "SUBSCRIBE TO AI TO REWRITE" (Session 31) ─────────────────────────────
  // The owner's words for what should happen when there is no AI to call. A
  // small card in the corner, not a dialog: it must not replace the form the
  // person is filling in (that form IS the modal). Painted on --card-solid —
  // a float is opaque (Session 25). Toggled directly, never through render().
  window.aiSubscribePopup=function(reason){
    var old=document.getElementById('ai-sub-pop'); if(old)old.remove();
    var isAdmin=userHasRole(STATE.user,'admin');
    var line=reason==='daily_limit'
      ? 'Today\'s AI allowance has been used up. Subscribe to AI for a bigger allowance, or try again tomorrow.'
      : reason==='no_answer'
        ? 'AI did not answer this time. Try again in a minute — if it keeps happening, check the AI subscription.'
        : 'AI rewriting is not switched on for your company yet.';
    var el=document.createElement('div');
    el.id='ai-sub-pop'; el.setAttribute('role','status');
    el.style.cssText='position:fixed;right:18px;bottom:18px;z-index:10000;width:min(340px,calc(100vw - 32px));background:var(--card-solid,#fff);color:var(--text);border:1px solid var(--border2);border-radius:12px;box-shadow:var(--sh2,0 8px 24px rgba(0,0,0,.18));padding:14px 16px';
    el.innerHTML='<div style="display:flex;justify-content:space-between;align-items:start;gap:10px">'+
        '<div style="font-weight:700;font-size:14px">✨ Subscribe to AI to rewrite</div>'+
        '<button type="button" aria-label="Close" onclick="this.closest(\'#ai-sub-pop\').remove()" style="border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:var(--text3)">×</button>'+
      '</div>'+
      '<div style="font-size:12.5px;color:var(--text2);margin-top:6px;line-height:1.5">'+esc(line)+'</div>'+
      (isAdmin&&reason!=='no_answer'?'<button type="button" class="btn btn-sm btn-primary" style="margin-top:10px" onclick="document.getElementById(\'ai-sub-pop\').remove();closeModal();goPage(\'admin\')">Set up AI</button>'
        :(reason!=='no_answer'?'<div style="font-size:11.5px;color:var(--text3);margin-top:8px">Ask your admin to turn it on.</div>':''));
    document.body.appendChild(el);
    setTimeout(function(){ var n=document.getElementById('ai-sub-pop'); if(n===el)el.remove(); },12000);
  };

  function renderNewJobModal(){
    var f=STATE.bd.form;
    var tabBtn=function(id,lbl){var on=f.tab===id;return '<button class="mtab" onclick="bdFormTab(\''+id+'\')" style="border-bottom:2px solid '+(on?'var(--accent)':'transparent')+';font-weight:'+(on?'700':'500')+';color:'+(on?'var(--accent)':'var(--text2)')+'">'+lbl+'</button>';};
    var body='';
    if(f.tab==='details'){
      body='<div class="g3">'+
        fld('Job Title',inp('job_title','Required'),true)+
        fld('Job Status',selF('status',JOB_STATUSES),true)+
        fld('Client',clientField(f),true)+
        fld('Client Job ID',inp('client_job_id'))+
        fld('Client Manager',inp('client_manager'))+
        fld('End Client',inp('end_client'))+
        fld('Job Type',selBlank('job_type',JOB_TYPES))+
        fld('Employment Level',selBlank('emp_level',EMP_LEVELS))+
        fld('Work Authorization',selBlank('work_auth',WORK_AUTH))+
        fld('Priority',selF('priority',PRIORITIES))+
        fld('Remote Job',selF('remote',REMOTE))+
        fld('Clearance',selF('clearance',["No","Yes"]))+
        fld('Country',inp('country'))+
        fld('State',selBlank('state',US_STATES))+
        fld('City',inp('city'))+
        fld('Zip',zipAcHTML('bd-zip',f.zip,'bdZipPick'))+
        fld('Start Date','<input type="date" class="sel" value="'+esc(f.start_date)+'" onchange="bdFormSet(\'start_date\',this.value)">')+
        fld('End Date','<input type="date" class="sel" value="'+esc(f.end_date)+'" onchange="bdFormSet(\'end_date\',this.value)">')+
        fld('Duration',inp('duration','e.g. 6 months'))+
        fld('Placement Fee %',inp('placement_fee'))+
        fld('Required Documents',inp('req_docs','e.g. Resume'))+
      '</div>'+
      '<div style="margin-top:6px">'+fld('Pay Rate (Min–Max)',
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><select class="sel" style="max-width:90px;flex:0 0 auto" onchange="bdFormSet(\'pay_cur\',this.value)">'+['USD','CAD','GBP','EUR','INR'].map(function(c){return '<option'+(f.pay_cur===c?' selected':'')+'>'+c+'</option>';}).join("")+'</select>'+
        '<input class="sel" placeholder="Min" value="'+esc(f.pay_min)+'" oninput="bdFormSet(\'pay_min\',this.value)">'+
        '<input class="sel" placeholder="Max" value="'+esc(f.pay_max)+'" oninput="bdFormSet(\'pay_max\',this.value)"></div>')+
      '</div>'+
      jdBlockHTML(f);
    } else if(f.tab==='client'){
      var known=(f.intake&&f.intake.contacts)||[];
      // POCs PACE already holds at this client, offered as a click. Nobody
      // should retype a name the app can already see.
      var knownChips=known.length?
        '<div style="margin-bottom:12px">'+
          '<div style="font-size:11.5px;color:var(--text3);margin-bottom:6px">Already known at '+esc(f.client)+' — click to use:</div>'+
          '<div style="display:flex;flex-wrap:wrap;gap:6px">'+known.map(function(p,i){
            return '<button type="button" class="poc-known" onclick="bdUseKnownPoc('+i+')" style="background:var(--bg);border:1px solid var(--border2);border-radius:14px;padding:5px 11px;font-size:12px;cursor:pointer;color:var(--text)">'+
              esc((p.first_name+' '+p.last_name).trim()||p.email)+
              (p.designation?'<span style="color:var(--text3)"> · '+esc(p.designation)+'</span>':'')+'</button>';
          }).join('')+'</div>'+
        '</div>':'';

      var a=f.address||{};
      var addr=function(key,ph){
        return '<input class="sel" placeholder="'+ph+'" value="'+esc(a[key]||'')+'" oninput="bdAddrSet(\''+key+'\',this.value)">';
      };
      body=
        bdCooldownBanner(f)+
        '<div style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:'+(bdCooldownBlocked(f)?'14px':'0')+' 0 10px">Client address</div>'+
        (f.company_id?'':'<div style="font-size:11.5px;color:var(--text3);margin-bottom:10px">'+
          (f.client?'New client — this is the address '+esc(f.client)+' will be created with.':'Pick or type a client on the Job Details tab first.')+'</div>')+
        fld('Street address',addr('address_line1','e.g. 1400 Edwin Miller Blvd'))+
        fld('Suite / floor / unit',addr('address_line2','Optional'))+
        '<div class="g3">'+
          fld('City',addr('city',''))+
          fld('State / region',addr('state',''))+
          fld('Zip / postal code',addr('postal_code',''))+
        '</div>'+
        fld('Country',addr('country','e.g. United States'))+
        '<div style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:18px 0 10px">Point of contact <span style="color:var(--red)">*</span></div>'+
        '<div style="font-size:11.5px;color:var(--text3);margin-bottom:10px">At least one contact with a name and an email. This is who the lead gets worked through — without it the job cannot be emailed or followed up. Phone and LinkedIn are optional.</div>'+
        knownChips+
        pocBlockHTML('bd');
    } else if(f.tab==='skills'){
      body='<div class="g2">'+
        fld('Primary Skills',inp('primary_skills','Required'),true)+
        fld('Secondary Skills',inp('secondary_skills'))+
        fld('Industry',inp('industry'))+
        fld('Domain',inp('domain'))+
        fld('Degree',inp('degree'))+
        fld('Languages',inp('languages'))+
        fld('Job Category',inp('job_category'))+
      '</div>'+
      '<div style="margin-top:6px">'+fld('Experience (years)',
        '<div style="display:flex;gap:8px;align-items:center">'+
          '<input class="sel" placeholder="Min" value="'+esc(f.exp_min)+'" oninput="bdFormSet(\'exp_min\',this.value)">'+
          '<span style="color:var(--text3)">to</span>'+
          '<input class="sel" placeholder="Max" value="'+esc(f.exp_max)+'" oninput="bdFormSet(\'exp_max\',this.value)">'+
          '<span style="color:var(--text3)">years</span></div>',true)+
      '</div>';
    } else {
      var assigned=(f.recruiter_ids||[]).map(function(rid){
        var u=(STATE.users||[]).find(function(x){return x.id===rid;})||{};
        return '<span style="background:var(--accent-l);border:1px solid rgba(30,122,60,.25);border-radius:14px;padding:3px 8px 3px 4px;font-size:12px;display:inline-flex;align-items:center;gap:5px">'+esc(u.name||rid)+'<span onclick="bdFormRemoveRec(\''+rid+'\')" style="cursor:pointer;color:var(--text3);font-weight:700">×</span></span>';
      }).join(' ');
      body=
        '<div class="g2">'+
          fld('Number of Positions',inp('positions'),true)+
          fld('Comments',inp('comments'))+
        '</div>'+
        fld('Assign Recruiter(s)',
          '<input class="sel" id="bd-rec-search" placeholder="Type 3+ letters of a recruiter\'s name…" oninput="bdRecSearch(this.value)" autocomplete="off">'+
          '<div id="bd-rec-suggest" style="position:relative"></div>'+
          '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">'+(assigned||'<span style="font-size:12px;color:var(--text3)">None assigned yet.</span>')+'</div>');
    }

    var queueNote=STATE.bd._convertQueue&&STATE.bd._convertQueue.length?STATE.bd._convertQueue.length+' more lead(s) queued after this':'';
    STATE.modal='<div class="modal modal-w860" onclick="event.stopPropagation()" style="width:min(900px,95vw)">'+
      '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'+
        '<div class="mhd">'+(f._editId?'Edit Job':'New Job')+(f._editId?'':(f.source_lead_id?' — from lead '+esc(f.lead_code):''))+'</div>'+
      '</div>'+
      '<div style="padding:0 20px;border-bottom:1px solid var(--border);display:flex;gap:4px;flex-wrap:wrap">'+
        tabBtn('details','Job Details')+
        (isDirectCreate(f)?tabBtn('client','Client & POC'):'')+
        tabBtn('skills','Skills')+tabBtn('org','Organizational')+'</div>'+
      '<div style="padding:18px 20px;max-height:62vh;overflow-y:auto">'+body+'</div>'+
      '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-size:11.5px;color:var(--text3)">'+queueNote+'</div>'+
        '<div style="display:flex;gap:8px">'+
          '<button class="btn btn-outline" onclick="bdCancelNewJob()">Cancel</button>'+
          '<button class="btn btn-primary" onclick="bdSaveNewJob()">'+(f._editId?'Save changes':'Save Job')+'</button>'+
        '</div>'+
      '</div>'+
    '</div>';
    render();
  }

  window.bdRecSearch=function(q){
    var box=document.getElementById('bd-rec-suggest'); if(!box)return;
    q=(q||'').trim().toLowerCase();
    if(q.length<3){box.innerHTML='';return;}
    var matches=(STATE.users||[]).filter(function(u){
      return isRec(u)&&u.name.toLowerCase().indexOf(q)>-1&&(STATE.bd.form.recruiter_ids||[]).indexOf(u.id)<0;
    });
    box.innerHTML='<div style="position:absolute;top:2px;left:0;right:0;background:var(--card-solid);border:1px solid var(--border);border-radius:8px;box-shadow:var(--sh);z-index:5;max-height:160px;overflow-y:auto">'+
      (matches.length?matches.map(function(u){
        return '<div onclick="bdFormAddRec(\''+u.id+'\')" style="padding:8px 11px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">'+
          av(u,"22")+'<div><div style="font-weight:600">'+esc(u.name)+'</div><div style="font-size:11px;color:var(--text3)">'+esc(u.desig||u.role||'')+'</div></div></div>';
      }).join(""):'<div style="padding:8px 11px;font-size:12.5px;color:var(--text3)">No matching recruiter</div>')+
    '</div>';
  };
  window.bdFormAddRec=function(rid){if((STATE.bd.form.recruiter_ids||[]).indexOf(rid)<0){STATE.bd.form.recruiter_ids=STATE.bd.form.recruiter_ids||[];STATE.bd.form.recruiter_ids.push(rid);}renderNewJobModal();};
  window.bdFormRemoveRec=function(rid){STATE.bd.form.recruiter_ids=(STATE.bd.form.recruiter_ids||[]).filter(function(x){return x!==rid;});renderNewJobModal();};
  window.bdCancelNewJob=function(){STATE.bd._convertQueue=null;closeModal();};

  window.bdSaveNewJob=function(){
    var f=STATE.bd.form;
    if(!(f.job_title||'').trim()){showToast('Job Title is required','error');STATE.bd.form.tab='details';renderNewJobModal();return;}
    if(!(f.client||'').trim()){showToast('Client is required','error');STATE.bd.form.tab='details';renderNewJobModal();return;}
    if(f._editId){ bdSaveEditJob(f); return; }
    if(isDirectCreate(f)){
      // The same two rules the server enforces, checked here so the answer
      // arrives on the tab that can fix it rather than as a toast over a form
      // the person then has to go hunting through.
      if(bdCooldownBlocked(f)){
        showToast(f.intake.cooldown.sentence,'warning');
        STATE.bd.form.tab='client'; renderNewJobModal(); return;
      }
      var pocErr=pocFirstError(pocPayload('bd'));
      if(pocErr){
        showToast(pocErr,'error');
        STATE.bd.form.tab='client'; renderNewJobModal(); return;
      }
    }
    var body;
    if(f.source_lead_id){
      // convert-from-lead: flat body with job fields
      body=Object.assign({},f,{recruiter_ids:undefined,tab:undefined,source_lead_id:undefined,lead_code:undefined,
        job_url:undefined,_jdPrev:undefined,_jdBusy:undefined});
      apiPost('/job-orders/from-lead/'+f.source_lead_id,body).then(function(jo){
        bdAfterSave(jo,f);
      }).catch(function(e){showToast('Failed to create job: '+e.message,'error');});
    } else {
      // direct create: { lead:{...}, job:{...} }
      // company_name is always sent; company_id only when an existing client was
      // picked from the list. The SERVER resolves the name to a companies row
      // (find-or-create, org-scoped) — this used to send a hard-coded null, so
      // every direct create was refused.
      var loc=((f.city||'')+' '+(f.state||'')).trim();
      var lead={position:f.job_title,company_id:f.company_id||undefined,
        company_name:(f.client||'').trim(),location:loc||undefined,source:'BD Direct',
        address:f.address||{},contacts:pocPayload('bd')};
      var job=Object.assign({},f,{recruiter_ids:undefined,tab:undefined,source_lead_id:undefined,lead_code:undefined,
        job_url:undefined,_jdPrev:undefined,_jdBusy:undefined});
      apiPost('/job-orders',{lead:lead,job:job}).then(function(jo){
        bdAfterSave(jo,f);
      }).catch(function(e){
        var msg=(e&&e.message)||String(e);
        showToast(msg,'error');
        // The server is the authority on both of these, and its answer names
        // the tab to open: a cooldown or a POC problem is fixed on Client & POC.
        if(/cooldown|contact|email address/i.test(msg)&&STATE.bd.form){
          STATE.bd.form.tab='client'; renderNewJobModal();
        }
      });
    }
  };

  function bdSaveEditJob(f){
    var id=f._editId;
    var body=Object.assign({},f);
    delete body.tab; delete body._editId; delete body.recruiter_ids;
    delete body.source_lead_id; delete body.lead_code; delete body._jdPrev; delete body._jdBusy; delete body.job_url;
    apiPut('/job-orders/'+id,body).then(function(jo){
      var arr=STATE.bd.jobOrders=STATE.bd.jobOrders||[];
      var idx=arr.findIndex(function(x){return x.id===id;});
      if(idx>-1)arr[idx]=jo; else arr.push(jo);
      var finish=function(){ closeModal(); showToast('Job updated','success'); render(); };
      // Only BD managers may (re)assign recruiters; recruiters just edit fields.
      if(isBDM(STATE.user)){
        apiPost('/job-orders/'+id+'/recruiters',{recruiter_ids:f.recruiter_ids||[]}).then(function(){
          apiGet('/job-orders/'+id).then(function(j2){
            var i2=arr.findIndex(function(x){return x.id===id;}); if(i2>-1)arr[i2]=j2; finish();
          }).catch(finish);
        }).catch(finish);
      } else finish();
    }).catch(function(e){ showToast('Failed to save job: '+e.message,'error'); });
  }

  function bdAfterSave(jo,f){
    // assign recruiters if any were selected
    var recs=f.recruiter_ids||[];
    var assignPromise=recs.length?
      apiPost('/job-orders/'+jo.id+'/recruiters',{recruiter_ids:recs}).catch(function(){})
      :Promise.resolve();
    assignPromise.then(function(){
      showToast('Job '+jo.job_code+' created','success');
      if(STATE.bd._convertQueue&&STATE.bd._convertQueue.length){
        var nextId=STATE.bd._convertQueue.shift();
        bdOpenNewJob(nextId);return;
      }
      STATE.bd._convertQueue=null;
      closeModal();
      loadJobOrders();
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE: My Jobs (recruiter)
  // ════════════════════════════════════════════════════════════════════════════
  // per-job stage summaries for the My Jobs cards (miniature pipeline view)
  function loadJobStageCounts(jobs){
    if(STATE.bd._jobCountsLoading)return;
    STATE.bd._jobCountsLoading=true;
    Promise.all(jobs.map(function(j){
      return apiGet('/job-orders/'+j.id+'/submissions').then(function(subs){return {id:j.id,subs:subs||[]};}).catch(function(){return {id:j.id,subs:[]};});
    })).then(function(results){
      var m={};
      results.forEach(function(r){
        var counts={},names={};
        r.subs.forEach(function(s){
          var _ns=nStage(s.stage);
          counts[_ns]=(counts[_ns]||0)+1;
          (names[_ns]=names[_ns]||[]).push((s.candidate&&s.candidate.full_name)||'');
        });
        m[r.id]={counts:counts,names:names,total:r.subs.length};
      });
      STATE.bd._jobStageCounts=m; STATE.bd._jobCountsLoading=false; render();
    });
  }
  window.renderMyJobs=function(){
    if(STATE.bd.loading)return '<div class="page"><div style="text-align:center;padding:60px;color:var(--text3)">Loading…</div></div>';
    var jobs=myJobOrders();
    if(!jobs.length)return '<div class="page"><div class="card" style="padding:40px;text-align:center;color:var(--text3)">No jobs assigned to you yet.</div></div>';
    // ── AGE (Session 23) ────────────────────────────────────────────────────
    // A card grid is the worst offender shape there is: every record is a
    // multi-node card, so growth is steeper than a table's. Measured at 162 →
    // 12,042 nodes (74x) across two years. Same treatment as the Jobs table —
    // search reaches all of history, an unsearched grid gets the horizon, and
    // only one page is drawn.
    var mjq=(STATE.bd.myJobSearch||'').trim().toLowerCase();
    if(mjq){
      jobs=jobs.filter(function(j){
        return [j.job_title,j.client,j.job_code,j.city,j.state]
          .some(function(v){return String(v||'').toLowerCase().indexOf(mjq)>-1;});
      });
    }
    var mjPart=UI.partition(jobs,{
      showAll:!!mjq||!!STATE.bd.myJobShowAll,
      closedOf:function(j){return !mjq&&(j.status==='Closed'||j.status==='Filled'||j.status==='Cancelled');}
    });
    jobs=mjPart.visible;
    var mjPg=UI.clampPage(STATE.bd.myJobPage,jobs.length);
    STATE.bd.myJobPage=mjPg;
    var mjShown=jobs.slice(mjPg*UI.PAGE_SIZE,(mjPg+1)*UI.PAGE_SIZE);
    // Stage counts are fetched per job, so ask only for the page on screen —
    // this was requesting counts for every job the user has ever had.
    if(!STATE.bd._jobStageCounts&&!STATE.bd._jobCountsLoading)loadJobStageCounts(mjShown);
    var cards=mjShown.map(function(j){
      var loc=[j.city,j.state].filter(Boolean).join(', ');
      var jc=(STATE.bd._jobStageCounts||{})[j.id];
      var chips=jc?BD_STAGES.filter(function(st){return jc.counts[st];}).map(function(st){
        return '<span title="'+esc((jc.names[st]||[]).join(', '))+'" style="font-size:10px;font-weight:700;color:'+(STAGE_COLORS[st]||'var(--text3)')+';background:var(--bg);padding:2px 7px;border-radius:8px;white-space:nowrap">'+esc(STAGE_ABBR[st]||st)+' '+jc.counts[st]+'</span>';
      }).join(' '):'';
      return '<div class="card" style="padding:16px;cursor:pointer" onclick="bdOpenSubmissions(\''+j.id+'\')">'+
        '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">'+code(j.job_code)+badge(j.status)+'</div>'+
        '<div style="font-weight:600;font-size:15px;margin-bottom:3px">'+esc(j.job_title||'')+'</div>'+
        '<div style="font-size:12.5px;color:var(--text3);margin-bottom:8px">'+esc(j.client||'')+' · '+esc(loc)+'</div>'+
        (jc?'<div style="display:flex;flex-wrap:wrap;gap:4px">'+(chips||'<span style="font-size:10.5px;color:var(--text3)">No candidates yet</span>')+'</div>':'')+
      '</div>';
    }).join("");
    return '<div class="page">'+
      '<div class="mj-top">'+
        UI.searchBox(STATE.bd.myJobSearch,'bdMyJobSearch(this.value)','Search your jobs…')+
      '</div>'+
      UI.horizonBar(mjPart.counts,{onShowAll:"bdMyJobShowAll()",noun:"jobs"})+
      (mjShown.length
        ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">'+cards+'</div>'
        : '<div class="card" style="padding:40px;text-align:center;color:var(--text3)">'+
            (mjq?'No jobs match “'+esc(mjq)+'”.':'Nothing in the last '+UI.HORIZON_DAYS+' days.')+'</div>')+
      UI.pager(jobs.length,mjPg,"bdMyJobGoPage(%d)")+
    '</div>';
  };
  window.bdMyJobSearch=function(v){STATE.bd.myJobSearch=v;STATE.bd.myJobPage=0;render();};
  window.bdMyJobGoPage=function(i){STATE.bd.myJobPage=i;STATE.bd._jobStageCounts=null;render();};
  window.bdMyJobShowAll=function(){STATE.bd.myJobShowAll=true;STATE.bd.myJobPage=0;render();};

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE: Job detail (BD)
  // ════════════════════════════════════════════════════════════════════════════
  window.renderJobOrderDetail=function(){
    var j=joById(STATE.bd.view.joId);
    if(!j)return '<div class="page"><div style="padding:40px;text-align:center;color:var(--text3)">Job not found or still loading.</div></div>';
    var recs=j.recruiters||[];
    var subs=STATE.bd.submissions||[];
    var pending=subs.filter(function(s){return s.job_order_id===j.id&&s.stage==='Submitted to BDM';});
    var loc=[j.city,j.state,j.zip].filter(Boolean).join(', ');
    var pay=(j.pay_min||j.pay_max)?((j.pay_cur||'USD')+' '+(j.pay_min||'?')+'–'+(j.pay_max||'?')):'—';

    var recChips=recs.map(function(r){
      var ru=r.recruiter||{name:uName(r.recruiter_id)};
      return '<span style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:3px 10px 3px 4px;font-size:12px;display:inline-flex;align-items:center;gap:6px">'+
        esc(ru.name||'')+'<span onclick="bdUnassign(\''+j.id+'\',\''+(ru.id||r.recruiter_id)+'\')" style="cursor:pointer;color:var(--text3);font-weight:700">×</span></span>';
    }).join("");

    var approval=pending.length?'<div class="card" style="padding:14px 16px;margin-bottom:16px;background:rgba(210,140,0,.07);border-color:rgba(210,140,0,.3)">'+
      '<div style="font-weight:600;font-size:13px;color:var(--amber);margin-bottom:9px">⚑ Awaiting approval ('+pending.length+')</div>'+
      pending.map(function(s){
        var c=s.candidate||{};
        return '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:6px">'+
          '<div style="cursor:pointer" onclick="bdViewSubmission(\''+s.id+'\')"><b style="color:var(--accent)">'+esc(c.full_name||'')+'</b> '+code(c.candidate_code||'')+'<div style="font-size:11px;color:var(--text3)">Click to review the submission details</div></div>'+
          '<div style="display:flex;gap:6px">'+
            '<button class="btn btn-sm btn-outline" onclick="bdViewSubmission(\''+s.id+'\')">View</button>'+
            '<button class="btn btn-sm btn-primary" onclick="bdApproveSub(\''+s.id+'\')">Approve → Client</button>'+
            '<button class="btn btn-sm btn-outline" onclick="bdSetStage(\''+s.id+'\',\'Rejected\')">Reject</button>'+
          '</div></div>';
      }).join("")+'</div>':'';

    function dr(lbl,val){return val?'<div style="font-size:12.5px;margin-bottom:4px"><span style="color:var(--text3)">'+lbl+': </span>'+esc(val)+'</div>':'';}

    // Job-description block: a short preview with Show more/less, the "Re-write
    // job description" action next to it, and — when a previous version was kept
    // (on replace) — a toggle to view that earlier JD.
    var jdText=j.job_description||'', prevText=j.previous_description||'';
    var jdShowPrev=STATE.bd.jdShowPrev&&prevText;
    var jdDisplay=jdShowPrev?prevText:jdText;
    var jdExpanded=STATE.bd.jdExpanded;
    var jdLong=jdDisplay.length>320;
    var prevWhen=j.previous_description_at?(function(){try{return new Date(j.previous_description_at).toLocaleDateString();}catch(e){return '';}})():'';
    var jdBlock='<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">'+
        '<div style="font-weight:600;font-size:13px">Job description'+(jdShowPrev?' <span style="font-size:11px;color:var(--amber);font-weight:600">· previous version'+(prevWhen?' ('+prevWhen+')':'')+'</span>':'')+'</div>'+
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+
          (jdLong?'<button onclick="bdToggleJD()" style="font-size:11.5px;color:var(--accent);background:none;border:0;cursor:pointer;font-weight:600">'+(jdExpanded?'Show less':'Show more')+'</button>':'')+
          '<button class="btn btn-sm btn-outline" onclick="bdOpenPostingJD(\''+j.id+'\')" style="font-size:11.5px">✏ Re-write job description</button>'+
          (prevText?'<button onclick="bdTogglePrevJD()" title="View the previous job description (kept until the job ends)" style="font-size:11.5px;color:'+(jdShowPrev?'var(--amber)':'var(--text3)')+';background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer">'+(jdShowPrev?'← Current JD':'Previous JD')+'</button>':'')+
        '</div>'+
      '</div>'+
      (jdDisplay?'<div style="font-size:13px;white-space:pre-wrap;overflow:hidden;'+((jdLong&&!jdExpanded)?'max-height:110px;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)':'')+'">'+esc(jdDisplay)+'</div>':'<div style="font-size:12.5px;color:var(--text3)">No job description yet.</div>')+
    '</div>';
    // ── the public apply link ────────────────────────────────────────────
    // Published is a STATE, so the block says which one it is in and offers
    // only the action that state allows. A single toggle would leave the
    // recruiter guessing whether the link is live right now, which is the one
    // thing they need to be sure of before pasting it anywhere.
    // D-0035: publishing/unpublishing the apply link is an owner action
    // (`POST /job-orders/:id/apply-link` now 403s a non-owner) — never draw a
    // button that will refuse (Session 24 rule). A non-owner still sees the
    // link's live/off state and the applicant count when it is on; they just
    // get no controls to change it.
    var canOwn=j.poc_visible!==false;
    var applyOn=!!j.apply_enabled, applyTok=j.apply_token||'', applyN=j.apply_count||0;
    var applyUrl=applyTok?(location.origin+'/apply/'+applyTok):'';
    var applyBlock='<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">'+
        '<div style="font-weight:600;font-size:13px">Apply link'+
          (applyOn?' <span style="font-size:11px;color:var(--green,#166534);font-weight:600">· live</span>':'')+
          (applyN?' <span style="font-size:11px;color:var(--text3);font-weight:500">· '+applyN+' applicant'+(applyN===1?'':'s')+'</span>':'')+
        '</div>'+
        (canOwn?'<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+
          (applyOn
            ? '<button class="btn btn-sm btn-outline" onclick="bdCopyApplyLink()" style="font-size:11.5px">Copy link</button>'+
              '<button class="btn btn-sm btn-outline" onclick="bdSetApplyLink(\''+j.id+'\',false)" style="font-size:11.5px">Turn off</button>'
            : '<button class="btn btn-sm btn-outline" onclick="bdSetApplyLink(\''+j.id+'\',true)" style="font-size:11.5px">Publish apply page</button>')+
        '</div>':'')+
      '</div>'+
      (applyOn
        ? (canOwn?'<input id="bd-apply-url" readonly value="'+esc(applyUrl)+'" onclick="this.select()" style="width:100%;box-sizing:border-box;font-size:12px;padding:7px 9px;border:1px solid var(--ctl-brd,var(--border));border-radius:7px;background:var(--card-solid,var(--card));color:var(--text)">'+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:5px">Anyone with this link can apply. Their resume is parsed and they land in Sourcing for review — nothing is added to the candidate database until you import them. The client\'s name is never shown on the page.</div>':'')
        : (canOwn?'<div style="font-size:12.5px;color:var(--text3)">Publish a page anyone can apply on, then post the link wherever you like — a job board, LinkedIn, WhatsApp, your website. Applicants arrive already parsed and scored, in the Sourcing review queue.</div>':''))+
    '</div>';

    return '<div class="page">'+
      (window.navBar?navBar():'<div style="margin-bottom:6px"><span onclick="goPage(\'bd_joborders\')" style="cursor:pointer;font-size:12.5px;color:var(--accent)">← Jobs</span></div>')+
      '<div class="card" style="padding:18px 20px;margin-bottom:16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:start">'+
          '<div>'+
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">'+code(j.job_code)+badge(j.status)+'</div>'+
            '<div style="font-size:19px;font-weight:700">'+esc(j.job_title||'')+'</div>'+
            '<div style="font-size:13px;color:var(--text3);margin-top:2px">'+esc(j.client||'')+' · '+esc(loc||'')+'</div>'+
          '</div>'+
          '<div style="display:flex;gap:8px">'+
            '<button class="btn btn-sm btn-outline" onclick="bdOpenPipeline(\''+j.id+'\')">Candidates</button>'+
            '<button class="btn btn-sm btn-outline" onclick="bdOpenKanban(\''+j.id+'\')">Board</button>'+
            // D-0035: `PUT /job-orders/:id` now 403s a non-owner — never draw
            // a button that will refuse (Session 24 rule).
            (canOwn?'<button class="btn btn-sm btn-outline" onclick="bdOpenEditJob(\''+j.id+'\')">Edit job</button>':'')+
            // The rewind clock — same mark, same panel as every other record.
            // A job order kept NO history at all before this: its status could
            // move all week with nothing recording who moved it.
            (window.rewindBtn?rewindBtn('job_order',j.id):'')+
          '</div>'+
        '</div>'+
        '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'+
          dr('Pay Rate',pay)+dr('Job Type',j.job_type)+dr('Emp. Level',j.emp_level)+
          dr('Work Auth',j.work_auth)+dr('Remote',j.remote)+dr('Clearance',j.clearance)+
          dr('Priority',j.priority)+dr('Positions',j.positions)+dr('Duration',j.duration)+
          dr('Primary Skills',j.primary_skills)+dr('Experience',(j.exp_min||j.exp_max)?j.exp_min+'–'+j.exp_max+' yrs':'')+dr('Industry',j.industry)+
          dr('Lead',j.lead_code)+dr('Client Job ID',j.client_job_id)+dr('Job Category',j.job_category)+
          // D-0035: `client_manager` is the client's POC — stripped server-side
          // (`poc_visible:false`) for anyone but the job's owner + their
          // reporting chain + admin. A blank field reads as "nobody recorded
          // this"; the quiet note says what actually happened instead.
          (j.poc_visible===false
            ? '<div style="font-size:12.5px;margin-bottom:4px;color:var(--text3)">Client contact: visible to the job owner</div>'
            : dr('Client Manager',j.client_manager))+
        '</div>'+
        jdBlock+
        applyBlock+
      '</div>'+
      // Who is on the job comes FIRST after the job itself (Session 31): the
      // owner looked for it on the job's first screen and found it at the
      // bottom, under Applicants and Recruiters.
      approval+
      seqCandidatesCard(j.id)+
      (window.renderJobApplicants?renderJobApplicants(j.id):'')+
      '<div class="card" style="padding:16px;margin-bottom:16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
          '<div style="font-weight:600;font-size:14px">Assigned Recruiters</div>'+
          '<button class="btn btn-sm btn-primary" onclick="bdOpenAssign(\''+j.id+'\')">+ Assign</button>'+
        '</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:8px">'+(recChips||'<span style="font-size:12.5px;color:var(--text3)">No recruiters assigned.</span>')+'</div>'+
      '</div>'+
      bdFunnelCard(j.id)+
    '</div>';
  };

  // ── WHO IS ON THIS JOB — the job's own page (Session 31) ─────────────────
  // Everyone on the job, on the first page: the submissions (the pipeline
  // record) plus anybody who was only TAGGED before Session 31 made tagging
  // write a submission too. The owner tagged candidates from the database and
  // they never appeared here — 15 of 15 tagged rows had no submission.
  //
  // Selection is by CANDIDATE, because the two things you do with a selection
  // take different ids: emailing about the job takes people, a sequence takes
  // submissions. A tagged-only row can be emailed; it joins a sequence once it
  // is on the pipeline.
  function jobRoster(jid){
    var subs=(STATE.bd.submissions||[]).filter(function(s){return s.job_order_id===jid;});
    var seen={}; subs.forEach(function(s){ if(s.candidate_id||(s.candidate&&s.candidate.id)) seen[s.candidate_id||s.candidate.id]=1; });
    var rows=subs.map(function(s){ return {kind:'sub', sub:s, cand:s.candidate||{}, cid:s.candidate_id||(s.candidate&&s.candidate.id)}; });
    (STATE.bd.jobPipeline||[]).filter(function(p){return p.job_order_id===jid;}).forEach(function(p){
      if(seen[p.candidate_id]) return;
      seen[p.candidate_id]=1;
      rows.push({kind:'tag', pl:p, cand:p.candidate||{}, cid:p.candidate_id});
    });
    return rows;
  }
  function seqCandidatesCard(jid){
    var roster=jobRoster(jid);
    var sel=STATE.bd.candSel||(STATE.bd.candSel={});
    var picked=roster.filter(function(r){return sel[r.cid];});
    var pickedSubs=picked.filter(function(r){return r.kind==='sub';}).length;
    var rows=roster.map(function(r){
      var c=r.cand||{}; var on=!!sel[r.cid];
      var stageHtml, moveHtml='';
      if(r.kind==='sub'){
        var s=r.sub, curStage=nStage(s.stage);
        var nextStages=BD_STAGES.filter(function(x){return x!==curStage;});
        stageHtml='<span style="font-size:11px;font-weight:700;color:'+(STAGE_COLORS[curStage]||'var(--text3)')+'">'+esc(curStage||'')+'</span>'+
          (s.sub_stage?' <span style="font-size:10px;color:var(--text3)">· '+esc(s.sub_stage)+'</span>':'');
        moveHtml='<select class="sel" style="font-size:11px;padding:3px 6px;max-width:120px" onchange="bdMoveStage(\''+s.id+'\',this.value)">'+
          '<option value="">Move…</option>'+
          nextStages.map(function(x){return '<option value="'+x+'">'+x+'</option>';}).join("")+
        '</select>';
      } else {
        stageHtml='<span style="font-size:11px;font-weight:700;color:var(--text3)">Tagged</span>';
      }
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border)">'+
        '<input type="checkbox" '+(on?'checked':'')+' onclick="bdToggleCandSel(\''+r.cid+'\')" style="cursor:pointer">'+
        '<div style="flex:1;min-width:0">'+
          '<span style="font-weight:600;font-size:13px;cursor:pointer;color:var(--accent)" onclick="bdOpenCandidate(\''+(r.cid||'')+'\')">'+esc(c.full_name||'Candidate')+'</span> '+code(c.candidate_code||'')+
          '<div style="font-size:11px;color:var(--text3)">'+esc([c.current_title||c.headline,c.email||'no email on file'].filter(Boolean).join(' · '))+'</div>'+
        '</div>'+
        stageHtml+moveHtml+
      '</div>';
    }).join('')||'<div style="font-size:12.5px;color:var(--text3);padding:6px 2px">No candidates on this job yet. Add them from Candidates — tick several and use “Add to job”.</div>';
    var allOn=roster.length&&roster.every(function(r){return sel[r.cid];});
    var dis=' disabled style="opacity:.45;cursor:default"';
    return '<div class="card" style="padding:16px;margin-bottom:16px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">'+
        '<div style="font-weight:600;font-size:14px">Candidates on this job ('+roster.length+')</div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
          (roster.length?'<label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text2);cursor:pointer"><input type="checkbox" '+(allOn?'checked':'')+' onclick="bdToggleCandSelAll(\''+jid+'\')" style="cursor:pointer"> All</label>':'')+
          '<button class="btn btn-sm btn-outline" onclick="atsOpenBulkUpload({jobId:\''+jid+'\',jobTitle:'+esc(JSON.stringify((joById(jid)||{}).job_title||''))+'})">Upload resumes</button>'+
          '<button class="btn btn-sm btn-primary"'+(picked.length?'':dis)+' onclick="bdEmailSelected(\''+jid+'\')">✉ Email about this job'+(picked.length?' ('+picked.length+')':'')+'</button>'+
          '<button class="btn btn-sm btn-outline"'+(pickedSubs?'':dis)+' onclick="bdStartSequence(\''+jid+'\')">▶ Start sequence'+(pickedSubs?' ('+pickedSubs+')':'')+'</button>'+
        '</div>'+
      '</div>'+rows+
      (picked.length?'':'<div style="font-size:11.5px;color:var(--text3);margin-top:8px">Tick candidates, then email them about this job (you see every email before it goes) or start a sequence.</div>')+
    '</div>';
  }
  window.bdToggleCandSel=function(cid){ var s=STATE.bd.candSel||(STATE.bd.candSel={}); if(s[cid])delete s[cid]; else s[cid]=true; render(); };
  window.bdToggleCandSelAll=function(jid){
    var roster=jobRoster(jid), s=STATE.bd.candSel||(STATE.bd.candSel={});
    var allOn=roster.length&&roster.every(function(r){return s[r.cid];});
    roster.forEach(function(r){ if(allOn)delete s[r.cid]; else s[r.cid]=true; });
    render();
  };
  window.bdStartSequence=function(jid){
    var s=STATE.bd.candSel||{};
    var items=jobRoster(jid).filter(function(r){return s[r.cid]&&r.kind==='sub';})
      .map(function(r){ return {entity_id:r.sub.id,label:(r.cand&&r.cand.full_name)||'Candidate'}; });
    if(!items.length)return;
    wfStartSequence('submission',items);
  };
  // ONE candidate-email workflow (D-0012): this does not send anything itself.
  // It opens Email → Compose → Candidates with this job and these people
  // already picked, straight onto the preview — the same screen, the same
  // checks, the same queue as starting there.
  window.bdEmailSelected=function(jid){
    var s=STATE.bd.candSel||{};
    var ids=jobRoster(jid).filter(function(r){return s[r.cid];}).map(function(r){return r.cid;});
    if(!ids.length)return;
    var j=joById(jid)||{};
    if(!window.candOutreachStartFor){showToast('The email screen is not loaded','error');return;}
    candOutreachStartFor({id:j.id,job_code:j.job_code,job_title:j.job_title,client:j.client||'',
      place:[j.city,j.state].filter(Boolean).join(', '),status:j.status}, ids);
  };

  // Compact vertical funnel — one thin column per stage instead of a tall
  // stack of horizontal bars.
  var STAGE_ABBR={'Sourced':'Sourced','Screening':'Screen','Submitted to BDM':'To BDM','Submitted to Client':'To Client',
    'Interview Scheduled':'Int Sched','Interview Completed':'Int Done','Offer':'Offer','Joining':'Joining',
    'Placement':'Placed','Not Accepted':'Not Acc','On Hold':'Hold'};
  function bdFunnelCard(jid){
    var subs=(STATE.bd.submissions||[]).filter(function(s){return !jid||s.job_order_id===jid;});
    var counts={};BD_STAGES.forEach(function(s){counts[s]=0;});
    subs.forEach(function(s){var ns=nStage(s.stage);if(counts[ns]!==undefined)counts[ns]++;});
    var max=Math.max(1,Math.max.apply(null,BD_STAGES.map(function(s){return counts[s];})));
    return '<div class="card" style="padding:14px 16px"><div style="font-weight:600;font-size:14px;margin-bottom:10px">Pipeline Funnel</div>'+
      '<div style="display:flex;align-items:flex-end;gap:6px;height:110px;overflow-x:auto">'+
      BD_STAGES.map(function(s){
        var h=counts[s]?Math.max(8,Math.round((counts[s]/max)*72)):3;
        return '<div style="flex:1;min-width:52px;text-align:center;display:flex;flex-direction:column;justify-content:flex-end;height:100%">'+
          '<div style="font-size:11px;font-weight:700;color:'+(counts[s]?'var(--text)':'var(--text3)')+'">'+counts[s]+'</div>'+
          '<div style="height:'+h+'px;background:'+(counts[s]?STAGE_COLORS[s]:'var(--border)')+';border-radius:4px 4px 0 0;margin:3px 6px 0"></div>'+
          '<div style="font-size:9px;color:var(--text3);padding-top:4px;border-top:2px solid var(--border);white-space:nowrap">'+esc(STAGE_ABBR[s]||s)+'</div>'+
        '</div>';
      }).join("")+'</div></div>';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE: Kanban
  // ════════════════════════════════════════════════════════════════════════════
  window.renderKanban=function(){
    var j=joById(STATE.bd.view.kanbanJoId);
    if(!j)return '<div class="page"><div style="padding:40px;text-align:center;color:var(--text3)">Job not found.</div></div>';
    var u=STATE.user,recruiterScoped=isRec(u)&&!isBDM(u);
    var subs=STATE.bd.submissions||[];
    var jobSubs=subs.filter(function(s){return s.job_order_id===j.id;});
    // every stage is a column, so a card can never vanish off the board
    var cols=BD_STAGES;
    var backLink=isBDM(u)?'bd_jodetail':'bd_myjobs';
    var colHtml=cols.map(function(st){
      var items=jobSubs.filter(function(s){return nStage(s.stage)===st;});
      var locked=(st===BDM_GATED&&recruiterScoped);
      return '<div ondragover="bdDragOver(event)" ondragenter="if(!'+(locked?'true':'false')+'){this.style.background=\'var(--accent-l)\';this.style.outline=\'2px dashed var(--accent)\'}" ondragleave="this.style.background=\'var(--bg)\';this.style.outline=\'none\'" ondrop="this.style.background=\'var(--bg)\';this.style.outline=\'none\';bdDrop(event,\''+st+'\')" style="min-width:185px;flex:1;background:var(--bg);border-radius:10px;padding:10px;transition:background .1s">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px">'+
          '<div style="font-size:12px;font-weight:700;color:'+STAGE_COLORS[st]+'">'+st+'</div>'+
          '<div style="font-size:11px;color:var(--text3);font-weight:700">'+items.length+'</div>'+
        '</div>'+
        items.map(function(s){
          var c=s.candidate||{};
          var subs=(window.ATS_SUB_STAGES&&ATS_SUB_STAGES[nStage(s.stage)])||[];
          var scol=window.subStageColor?subStageColor(s.sub_stage):'var(--text3)';
          var subSel=subs.length?'<select onchange="bdSetSubStage(\''+s.id+'\',this.value)" onclick="event.stopPropagation()" style="width:100%;font-size:11px;padding:4px 6px;border:1px solid '+(s.sub_stage?scol:'var(--border)')+';border-radius:7px;background:'+(s.sub_stage?scol+'1a':'var(--card)')+';color:'+(s.sub_stage?scol:'var(--text2)')+';font-weight:600;cursor:pointer">'+
              '<option value="">Sub-stage…</option>'+
              subs.map(function(x){return '<option value="'+esc(x)+'"'+(s.sub_stage===x?' selected':'')+'>'+esc(x)+'</option>';}).join('')+
            '</select>':'';
          return '<div draggable="true" ondragstart="bdDragStart(event,\''+s.id+'\')" ondragend="bdDragEnd(event)" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:9px 10px;margin-bottom:7px;cursor:grab">'+
            '<div style="font-weight:600;font-size:12.5px;cursor:pointer;color:var(--accent)" onclick="bdOpenCandidate(\''+(c.id||'')+'\')">'+esc(c.full_name||'')+'</div>'+
            '<div style="font-size:10.5px;color:var(--text3);margin-bottom:5px">'+code(c.candidate_code||'')+' · '+esc(c.current_title||'')+'</div>'+
            (s.interview_at?'<div style="font-size:10px;color:#2563eb;margin-bottom:5px">🗓 '+esc(new Date(s.interview_at).toLocaleString())+(s.interview_location?' · '+esc(s.interview_location):'')+'</div>':'')+
            subSel+
          '</div>';
        }).join("")+
        (locked?'<div style="font-size:10px;color:var(--text3);text-align:center;padding:4px">🔒 BDM approval required</div>':'')+
      '</div>';
    }).join("");
    return '<div class="page">'+
      (window.navBar?navBar():'<div style="margin-bottom:6px"><span onclick="bdBackFromKanban()" style="cursor:pointer;font-size:12.5px;color:var(--accent)">← Back</span></div>')+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
        '<div><div style="display:flex;gap:8px;align-items:center">'+code(j.job_code)+'<span class="mhd">'+esc(j.job_title||'')+'</span></div>'+
        '<div style="font-size:12.5px;color:var(--text3)">'+esc(j.client||'')+' · Job white-board</div></div>'+
        '<div style="display:flex;gap:8px">'+
          '<button class="btn btn-outline" onclick="bdOpenPipeline(\''+j.id+'\')">Candidates</button>'+
          '<button class="btn btn-primary" onclick="bdOpenAddCandidate(\''+j.id+'\')">+ Add Candidate</button>'+
        '</div>'+
      '</div>'+
      '<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px">Drag a candidate card to another column to change stage · pick a sub-stage on the card</div>'+
      '<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px">'+colHtml+'</div>'+
    '</div>';
  };
  window.bdBackFromKanban=function(){
    var u=STATE.user;
    if(isBDM(u)){STATE.bd.view.joId=STATE.bd.view.kanbanJoId;goPage('bd_jodetail');}
    else goPage('bd_myjobs');
  };

  // ── job order navigation ───────────────────────────────────────────────────
  // Exposed for the Applicants screen: importing an applicant onto this job
  // creates a submission server-side, and the job page must show it without a
  // reload. Module-local loadSubmissions is not reachable from another file —
  // guarding a call to a function that does not exist is dead code, not safety.
  window.bdReloadSubmissions=function(joId){
    if(!joId) return;
    loadSubmissions(joId).then(function(subs){ STATE.bd.submissions=subs; render(); }).catch(function(){});
    loadJobPipeline(joId);
  };
  // The tag rows too, so a candidate tagged before tagging wrote a submission
  // is still on the job's page. Not waited for — it only ever adds rows.
  function loadJobPipeline(joId){
    apiGet('/job-orders/'+joId+'/pipeline').then(function(rows){
      STATE.bd.jobPipeline=rows||[]; scheduleRender();
    }).catch(function(){ STATE.bd.jobPipeline=[]; });
  }

  window.bdOpenJobOrder=function(id){
    STATE.bd.view.joId=id;
    // Applicants are fetched alongside the submissions, and deliberately NOT
    // waited for: somebody applying through the public link must never be able
    // to delay a recruiter opening their own job. The block renders "Loading…"
    // and fills in.
    if (window.appliedLoad) { try { appliedLoad(id); } catch (_) {} }
    if (STATE.bd.view._candSelFor!==id){ STATE.bd.candSel={}; STATE.bd.view._candSelFor=id; }
    STATE.bd.jobPipeline=[]; loadJobPipeline(id);
    // load submissions for this job before opening detail
    loadSubmissions(id).then(function(subs){
      STATE.bd.submissions=subs;
      goPage('bd_jodetail');
    });
  };
  window.bdOpenKanban=function(id){
    STATE.bd.view.kanbanJoId=id;
    loadSubmissions(id).then(function(subs){
      STATE.bd.submissions=subs;
      goPage('bd_kanban');
    });
  };

  // ── the public apply link ─────────────────────────────────────────────────
  // Publish mints the token server-side and returns the URL. Turning it off
  // KEEPS the token, so re-publishing restores the same address — a link that
  // has already been posted somewhere must not silently change.
  window.bdSetApplyLink=function(jid,on){
    var req=on?apiPost('/job-orders/'+jid+'/apply-link',{}):apiDelete('/job-orders/'+jid+'/apply-link');
    req.then(function(r){
      var idx=STATE.bd.jobOrders.findIndex(function(x){return x.id===jid;});
      if(idx>-1){
        STATE.bd.jobOrders[idx].apply_enabled=!!r.enabled;
        STATE.bd.jobOrders[idx].apply_token=r.token||null;
        if(r.applicants!=null)STATE.bd.jobOrders[idx].apply_count=r.applicants;
      }
      showToast(on?'Apply page is live — copy the link and post it anywhere':'Apply page turned off','success');
      render();
    }).catch(function(e){showToast('Failed: '+e.message,'error');});
  };
  window.bdCopyApplyLink=function(){
    var el=document.getElementById('bd-apply-url');
    if(!el||!el.value){showToast('No link yet','error');return;}
    try{
      el.select();
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(el.value).then(function(){showToast('Link copied','success');},
          function(){showToast('Press Ctrl/Cmd+C to copy','info');});
      } else { document.execCommand('copy'); showToast('Link copied','success'); }
    }catch(e){showToast('Press Ctrl/Cmd+C to copy','info');}
  };

  // ── anonymized posting JD ─────────────────────────────────────────────────
  // Rewrite the internal job description with the client identity removed so it
  // can go on job boards. Generate (AI when configured, rule-based otherwise),
  // edit, save onto the job, copy to clipboard.
  window.bdOpenPostingJD=function(jid){
    var j=joById(jid)||{};
    STATE.bd._pjdJob=jid;
    STATE.modal=
      '<div class="modal modal-w720" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
          '<div style="font-weight:700;font-size:15px">Re-write job description — '+esc(j.job_title||'')+'</div>'+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:2px">Generate a public version (company name and identifying details removed), or replace the internal job description. Generate, review, edit, then save or copy.</div>'+
        '</div>'+
        '<div style="padding:16px 20px">'+
          '<textarea id="pjd-text" class="sel" style="min-height:270px;resize:vertical;font-size:12.5px;line-height:1.45" placeholder="Click “Generate” to create an anonymized version from the internal JD, or paste/write one here.">'+esc(j.posting_description||'')+'</textarea>'+
          '<label style="display:flex;align-items:center;gap:9px;margin-top:12px;font-size:12.5px;cursor:pointer"><input type="checkbox" id="pjd-replace" style="width:15px;height:15px;accent-color:var(--accent)"/> Replace the current job description with this text <span style="color:var(--text3)">— keeps the old one viewable until the job ends</span></label>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">'+
          '<button class="btn btn-outline" onclick="bdGeneratePostingJD(\''+jid+'\')">✨ Generate from internal JD</button>'+
          '<div style="display:flex;gap:8px">'+
            '<button class="btn btn-outline" onclick="bdCopyPostingJD()">Copy</button>'+
            '<button class="btn btn-outline" onclick="closeModal()">Close</button>'+
            '<button class="btn btn-primary" onclick="bdSavePostingJD(\''+jid+'\')">Save</button>'+
          '</div>'+
        '</div>'+
      '</div>';
    render();
  };
  window.bdGeneratePostingJD=function(jid){
    showToast('Rewriting…','info');
    apiPost('/job-orders/'+jid+'/posting-jd',{}).then(function(r){
      var ta=document.getElementById('pjd-text');
      if(ta)ta.value=r.posting||'';
      if(r.used_ai) showToast('AI rewrite ready — review before posting','success');
      else {
        // Same answer as the New Job form: the rules still anonymise it, but
        // AI did not write it, and the person is told why (Session 31).
        showToast('Cleaned by the built-in rules — review carefully before posting','info');
        aiSubscribePopup(r.ai_reason);
      }
    }).catch(function(e){showToast('Failed: '+e.message,'error');});
  };
  window.bdSavePostingJD=function(jid){
    var ta=document.getElementById('pjd-text');
    var text=ta?ta.value:'';
    var replace=(document.getElementById('pjd-replace')||{}).checked;
    var j=joById(jid)||{};
    // Replace → the new text becomes the internal JD, and the OLD one is kept as
    // previous_description (viewable via the toggle) until the job ends. Otherwise
    // it's saved as the public posting description, as before.
    var payload=replace
      ? { job_description:text, previous_description:(j.job_description||null), previous_description_at:(j.job_description?new Date().toISOString():null) }
      : { posting_description:text };
    apiPut('/job-orders/'+jid,payload).then(function(jo){
      var idx=STATE.bd.jobOrders.findIndex(function(x){return x.id===jid;});
      if(idx>-1)STATE.bd.jobOrders[idx]=jo;
      showToast(replace?'Job description replaced — previous version kept':'Posting JD saved','success');closeModal();
    }).catch(function(e){showToast('Failed: '+e.message,'error');});
  };
  window.bdCopyPostingJD=function(){
    var ta=document.getElementById('pjd-text');
    if(!ta||!ta.value.trim()){showToast('Nothing to copy','error');return;}
    (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(ta.value):Promise.reject())
      .then(function(){showToast('Copied to clipboard','success');})
      .catch(function(){ta.select();document.execCommand('copy');showToast('Copied','success');});
  };

  // ── recruiter assignment ───────────────────────────────────────────────────
  window.bdOpenAssign=function(jid){
    var j=joById(jid)||{};
    var assigned=(j.recruiters||[]).map(function(r){return r.recruiter_id||(r.recruiter&&r.recruiter.id);});
    var recruiters=(STATE.users||[]).filter(function(u){return isRec(u);});
    var list=recruiters.map(function(r){
      var on=assigned.indexOf(r.id)>-1;
      return '<label style="display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--border);border-radius:8px;margin-bottom:7px;cursor:pointer">'+
        '<input type="checkbox" class="bd-rec-chk" value="'+r.id+'"'+(on?' checked':'')+'>'+
        av(r,"26")+'<div><div style="font-weight:600;font-size:13px">'+esc(r.name)+'</div><div style="font-size:11px;color:var(--text3)">'+esc(r.desig||r.role||'')+'</div></div>'+
      '</label>';
    }).join("");
    STATE.modal='<div class="modal modal-w480" onclick="event.stopPropagation()">'+
      '<div style="padding:18px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:16px">Assign Recruiters</div>'+
      '<div style="padding:18px 20px;max-height:50vh;overflow-y:auto">'+(list||'<div style="color:var(--text3)">No users with the recruiter role yet.</div>')+'</div>'+
      '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
        '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-primary" onclick="bdSaveAssign(\''+jid+'\')">Save</button>'+
      '</div>'+
    '</div>';render();
  };
  window.bdSaveAssign=function(jid){
    var checks=Array.prototype.slice.call(document.querySelectorAll('.bd-rec-chk'));
    var chosen=checks.filter(function(c){return c.checked;}).map(function(c){return c.value;});
    apiPost('/job-orders/'+jid+'/recruiters',{recruiter_ids:chosen}).then(function(){
      showToast(chosen.length+' recruiter(s) assigned','success');
      closeModal();
      // refresh the job detail so recruiter chips update
      return apiGet('/job-orders/'+jid).then(function(jo){
        var idx=STATE.bd.jobOrders.findIndex(function(x){return x.id===jid;});
        if(idx>-1)STATE.bd.jobOrders[idx]=jo; else STATE.bd.jobOrders.push(jo);
        render();
      });
    }).catch(function(e){showToast('Failed: '+e.message,'error');});
  };
  window.bdUnassign=function(jid,rid){
    apiDelete('/job-orders/'+jid+'/recruiters/'+rid).then(function(){
      showToast('Recruiter unassigned','info');
      return apiGet('/job-orders/'+jid).then(function(jo){
        var idx=STATE.bd.jobOrders.findIndex(function(x){return x.id===jid;});
        if(idx>-1)STATE.bd.jobOrders[idx]=jo;
        render();
      });
    }).catch(function(e){showToast('Failed: '+e.message,'error');});
  };

  // ── add candidate ─────────────────────────────────────────────────────────
  // Routes to the ONE unified add-candidate window (27-page-applicants.js),
  // scoped to this job. Adding tags the candidate to the job's pipeline as
  // "Added" (they become "Submitted" only once moved to Submitted to BDM), so
  // after adding we land the user on the Candidates tab where added candidates
  // live rather than the submissions board.
  window.bdOpenAddCandidate=function(jid){
    var j=joById(jid)||{};
    if(window.atsOpenNew) return atsOpenNew({ jobId:jid, jobTitle:j.job_title||'', jobCode:j.job_code||'' });
    showToast('Candidate form not loaded','error');
  };

  // ── stage moves + BDM gate ────────────────────────────────────────────────
  // Every move opens the shared stage modal (sub-stage, note, interview
  // date/location, reminder). The modal enforces the client-side gate and
  // patches STATE.bd.submissions when done.
  window.bdMoveStage=function(sid,stage){
    if(!stage)return;
    openStageModal(sid,stage,function(){render();});
  };
  window.bdSetStage=function(sid,stage){bdMoveStage(sid,stage);};

  // ── White-board drag-and-drop ──────────────────────────────────────────────
  // Dropping a card on another stage column runs the SAME stage-change modal as
  // before (openStageModal) — so notes, sub-stage, interview details and the
  // recruiter/BDM gate all still apply. Sub-stage is changed on the card itself.
  var _bdDragId=null;
  window.bdDragStart=function(ev,sid){ _bdDragId=sid; try{ ev.dataTransfer.setData('text/plain',sid); ev.dataTransfer.effectAllowed='move'; }catch(e){} };
  window.bdDragEnd=function(){ _bdDragId=null; };
  window.bdDragOver=function(ev){ ev.preventDefault(); try{ ev.dataTransfer.dropEffect='move'; }catch(e){} };
  window.bdDrop=function(ev,stage){
    ev.preventDefault();
    var sid=_bdDragId||(ev.dataTransfer&&ev.dataTransfer.getData('text/plain')); _bdDragId=null;
    if(!sid||!stage)return;
    var s=(STATE.bd.submissions||[]).find(function(x){return x.id===sid;});
    if(!s||nStage(s.stage)===stage)return;
    var u=STATE.user;
    if(stage===BDM_GATED&&isRec(u)&&!isBDM(u)){ showToast('Only a BD Manager can submit to the client.','error'); return; }
    openStageModal(sid,stage,function(){render();});
  };
  window.bdSetSubStage=function(sid,sub){
    if(!sub)return;
    apiPatch('/submissions/'+sid,{sub_stage:sub}).then(function(){
      var s=(STATE.bd.submissions||[]).find(function(x){return x.id===sid;});
      if(s)s.sub_stage=sub;
      render();
    }).catch(function(e){ showToast('Failed: '+(e&&e.message||e),'error'); });
  };
  window.bdApproveSub=function(sid){bdMoveStage(sid,BDM_GATED);};

  // ── BDM: review a submission before approving ──────────────────────────────
  // The recruiter's submission_details (the packet they filled) + the attached
  // resume(s), with Approve → Client / Reject right inside — so the BDM reads
  // what they're approving instead of a blind "Approve".
  window.bdViewSubmission=function(sid){
    var s=(STATE.bd.submissions||[]).find(function(x){return x.id===sid;});
    if(!s){showToast('Submission not found','error');return;}
    var c=s.candidate||{};
    var d=s.submission_details||{};
    function row(lbl,val){return '<div style="display:grid;grid-template-columns:170px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--text3)">'+esc(lbl)+'</span><span>'+esc(val||'—')+'</span></div>';}
    var hasDetails=d && (d.first_name||d.comment||d.email);
    var detailRows=hasDetails?
      row('Applicant First Name',d.first_name)+row('Applicant Last Name',d.last_name)+
      row('Applicant Email Address',d.email)+row('Mobile Number',d.mobile)+
      row('Home Phone',d.home_phone)+row('Work Authorization',d.work_auth)+
      row('Current Location',d.current_location)+row('Relocation',d.relocation)+
      row('Availability',d.availability)+
      '<div style="padding:10px 0 2px"><div style="font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Submission Comment</div>'+
        '<div style="font-size:13px;line-height:1.5;white-space:pre-wrap;background:var(--bg);border-radius:8px;padding:10px 12px">'+esc(d.comment||'—')+'</div></div>'
      :'<div style="font-size:13px;color:var(--text3);padding:10px 0">No structured submission details were captured for this candidate. Basic profile shown below.</div>'+
        row('Name',c.full_name)+row('Email',c.email)+row('Mobile',c.phone)+row('Work Authorization',c.work_authorization);

    STATE.modal=
      '<div class="modal" style="width:640px;max-width:94vw" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
          '<div style="font-weight:700;font-size:15px">Review submission — '+esc(c.full_name||'Candidate')+'</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+code(s.submission_code||'')+' · submitted by '+esc((s.submitter&&s.submitter.name)||(s.recruiter&&s.recruiter.name)||'—')+'</div>'+
        '</div>'+
        '<div style="padding:16px 20px;max-height:60vh;overflow:auto">'+
          detailRows+
          '<div id="bd-sub-docs" style="margin-top:14px"><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Resume / documents</div>'+
            '<div style="font-size:12.5px;color:var(--text3)">Loading…</div></div>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
          '<button class="btn btn-outline" onclick="closeModal()">Close</button>'+
          '<button class="btn btn-outline" style="color:var(--red)" onclick="closeModal();bdSetStage(\''+s.id+'\',\'Rejected\')">Reject</button>'+
          '<button class="btn btn-primary" onclick="closeModal();bdApproveSub(\''+s.id+'\')">Approve → Client</button>'+
        '</div>'+
      '</div>';
    render();

    // fetch the candidate's documents (short-lived signed URLs) for the packet
    var cid=(c.id)||s.candidate_id;
    if(cid){
      apiGet('/candidates/'+cid+'/documents').then(function(docs){
        var box=document.getElementById('bd-sub-docs'); if(!box)return;
        var rows=(docs||[]).map(function(dc){
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">'+
            '<div style="min-width:0"><div style="font-size:13px;font-weight:600">'+(dc.url?'<a href="'+esc(dc.url)+'" target="_blank" rel="noopener" style="color:var(--accent)">'+esc(dc.filename)+'</a>':esc(dc.filename))+'</div>'+
              '<div style="font-size:11px;color:var(--text3)">'+esc(dc.doc_type||'')+' · '+esc((dc.uploader&&dc.uploader.name)||'')+'</div></div>'+
            (dc.url?'<a class="btn btn-sm btn-outline" href="'+esc(dc.url)+'" target="_blank" rel="noopener" download>Download</a>':'')+
          '</div>';
        }).join('')||'<div style="font-size:12.5px;color:var(--text3)">No documents attached.</div>';
        box.innerHTML='<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Resume / documents</div>'+rows;
      }).catch(function(){ var box=document.getElementById('bd-sub-docs'); if(box)box.innerHTML='<div style="font-size:12.5px;color:var(--text3)">Could not load documents.</div>'; });
    }
  };

})();


