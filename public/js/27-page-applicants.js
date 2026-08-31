// ===== APPLICANTS / CANDIDATE DATABASE MODULE (additive) =====
// The shared candidate pool as a Ceipal-style browsable database, usable by both
// BD managers and recruiters. Adds a top-nav "Applicants" page: search + filter +
// paginate, add a new candidate (individual CN- id) with duplicate detection
// (full name + email-or-phone, warn-and-offer), edit, delete, and add-to-job.
// Slice 1 of docs/ATS_RECRUITING_PLAN.md.

(function () {

  // ── taxonomies ──────────────────────────────────────────────────────────────
  var APPLICANT_STATUSES = ['New lead','Active','Submitted','Interviewing','Placed','Do Not Call','Blacklisted','Inactive'];
  var SOURCES = ['Monster','CareerBuilder','LinkedIn','Indeed','Dice','Naukri','ZipRecruiter','Referral','Career Site','Job Board','Vendor','Manual'];
  var WORK_AUTH = ['US Citizen','Green Card','GC EAD','H1B','H4 EAD','OPT EAD','CPT','TN','L2 EAD','E3','Canada Citizen','Canada PR','Other'];
  var PAY_TYPES = ['Hourly','Yearly'];
  var AVAILABILITY = ['Immediate','1 week','2 weeks','3 weeks','1 month','Notice period'];
  var US_STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];

  if (!STATE.ats) {
    STATE.ats = {
      loading:false, rows:[], total:0, page:1, limit:25,
      q:'', filters:{ applicant_status:'', source:'', state:'', work_authorization:'',
        availability:'', experience_min:'', experience_max:'', created_from:'', created_to:'', has_resume:'' },
      advOpen:false, form:{}, editId:null, dupMatches:[], sel:{}, view:'grid',
      counts:{}, countsTotal:null, countsLoaded:false
    };
  }
  if (!STATE.ats.sel) STATE.ats.sel = {};

  // resolve a taxonomy from the managed lookups (Slice 6), falling back to the
  // built-in defaults if the lookups aren't loaded / are empty.
  function lk(cat, fb){ return (window.atsLookup ? window.atsLookup(cat, fb) : fb); }

  // Shared: attach a resume file to a candidate (used by every quick-create
  // modal). Resolves true/false, never rejects — creation must not fail on a
  // bad attachment.
  window.atsUploadResumeFile = function(candId, fileEl){
    return new Promise(function(resolve){
      var f = fileEl && fileEl.files && fileEl.files[0];
      if (!f || !candId){ resolve(false); return; }
      if (f.size > 4.5*1024*1024){ showToast('Resume too large (max ~4.5 MB) — not attached','error'); resolve(false); return; }
      var r = new FileReader();
      r.onload = function(){
        apiPost('/candidates/'+candId+'/documents', { filename:f.name, content_type:f.type||'application/octet-stream', doc_type:'resume', data_base64:String(r.result) })
          .then(function(){ resolve(true); })
          .catch(function(){ showToast('Resume upload failed','error'); resolve(false); });
      };
      r.onerror = function(){ resolve(false); };
      r.readAsDataURL(f);
    });
  };

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function code(t){ return '<span style="font-family:var(--mono);font-size:10.5px;color:var(--text3);font-weight:600">'+esc(t)+'</span>'; }
  function canUse(u){ return userHasAnyRole(u,'admin','bd','bd_lead','recruiter'); }
  function isBDMlike(u){ return userHasAnyRole(u,'admin','bd','bd_lead'); }
  function fmtDate(s){ if(!s)return '—'; try{ var d=new Date(s); return (d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(2); }catch(e){ return '—'; } }
  function loc(c){ return [c.city,c.state].filter(Boolean).join(', ') || c.current_location || '—'; }
  function jobTitle(c){ return c.headline || c.current_title || '—'; }
  function ownerName(c){ return (c.owner && c.owner.name) || '—'; }
  function creatorName(c){ return (c.creator && c.creator.name) || '—'; }

  // ── data ─────────────────────────────────────────────────────────────────────
  // How many candidates exist in total, ignoring the filters — the denominator
  // the stat strip and the tab count are measured against. `a.total` is the
  // FILTERED count and belongs to the pager, not to either of those.
  function poolTotal(a){ return a.countsTotal!=null ? a.countsTotal : (a.total||0); }

  // The stat strip's per-status numbers. Deliberately NOT refetched on every
  // filter change: they describe the whole pool, so a filter must not move
  // them — otherwise clicking "Interviewing" would rewrite the very number the
  // click was aimed at.
  function loadStatusCounts(){
    var statuses = lk('applicant_status', APPLICANT_STATUSES);
    return apiGet('/candidates/status-counts?statuses='+encodeURIComponent(statuses.join(',')))
      .then(function(r){
        STATE.ats.counts = (r&&r.counts)||{};
        STATE.ats.countsTotal = (r&&r.total)||0;
        STATE.ats.countsLoaded = true;
        paintATSPage();
      })
      .catch(function(){
        // A strip that cannot count is a strip that shows "·", not zeroes —
        // a fabricated 0 reads as "nobody is interviewing", which is a lie.
        STATE.ats.countsLoaded = false; paintATSPage();
      });
  }
  window.atsReload = function(){ STATE.ats.countsLoaded=false; loadApplicants(); loadStatusCounts(); };

  function loadApplicants(){
    STATE.ats.loading = true; paintATSPage();
    var a = STATE.ats, p = ['page='+a.page, 'limit='+a.limit];
    if (a.q) p.push('q='+encodeURIComponent(a.q));
    Object.keys(a.filters).forEach(function(k){ if(a.filters[k]) p.push(k+'='+encodeURIComponent(a.filters[k])); });
    return apiGet('/candidates?'+p.join('&')).then(function(r){
      STATE.ats.rows = (r&&r.data)||[]; STATE.ats.total = (r&&r.total)||0; STATE.ats.loading = false; paintATSPage();
    }).catch(function(e){ STATE.ats.loading=false; showToast('Failed to load candidates: '+e.message,'error'); paintATSPage(); });
  }

  // ── nav + routing (wrap, like the BD module) ─────────────────────────────────
  var _prevRender = window.render;
  window.render = function(){
    _prevRender.apply(this, arguments);
    if (STATE.page === 'applicants') paintATSPage();
  };

  // (The "Candidates" nav item is now built by the sidebar in 04-shell-login.js.)

  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p === 'applicants'){
      STATE.page = 'applicants'; STATE.modal = null;
      render();
      if (window.atsLoadLookups) atsLoadLookups();
      loadApplicants();
      loadStatusCounts();
      return;
    }
    return _prevGoPage.apply(this, arguments);
  };

  function paintATSPage(){
    if (STATE.page !== 'applicants') return;
    var c = document.getElementById('content'); if(!c) return;
    c.innerHTML = (STATE.ats.view === 'sourcing' && window.renderSourcing) ? renderSourcing() : renderApplicants();
  }

  // Candidates / Sourcing sub-tabs — Sourcing used to be its own top-level nav
  // item; it now lives inside the Candidates tab since both work the same pool.
  window.atsSetView = function(v){
    STATE.ats.view = v;
    if (v === 'sourcing' && window.srcLoadForCandidatesTab) srcLoadForCandidatesTab();
    render();
  };
  // The same tab bar the grid draws, exported for the Sourcing view so the two
  // halves of the Candidates page cannot drift apart visually.
  window.atsTabBar = function(){
    return UI.tabs([
      { id:'grid',     label:'All Candidates', n:poolTotal(STATE.ats), onclick:"atsSetView('grid')" },
      { id:'sourcing', label:'Sourcing',                               onclick:"atsSetView('sourcing')" }
    ], STATE.ats.view || 'grid');
  };

  // ── grid ────────────────────────────────────────────────────────────────────
  // Laid out on the shared UI kit (public/js/00-ui-kit.js): page tabs, a stat
  // strip that doubles as the status filter, one toolbar row, then a dense
  // table. The strip's numbers come from GET /candidates/status-counts, so
  // clicking "Interviewing" filters to exactly the number it shows.
  function renderApplicants(){
    var a = STATE.ats, u = STATE.user;
    var f = a.filters;
    var canManage = userHasAnyRole(u,'admin','bd_lead');
    var owners = (STATE.users||[]).filter(function(x){ return userHasAnyRole(x,'admin','bd','bd_lead','recruiter'); });
    var statuses = lk('applicant_status', APPLICANT_STATUSES);
    var advActive = f.availability||f.experience_min||f.experience_max||f.created_from||f.created_to||f.has_resume||f.owner_id;
    var anyActive = a.q||f.applicant_status||f.source||f.work_authorization||f.state||advActive;

    // ── tabs ──────────────────────────────────────────────────────────────
    var tabs = UI.tabs([
      { id:'grid',     label:'All Candidates', n:poolTotal(a), onclick:"atsSetView('grid')" },
      { id:'sourcing', label:'Sourcing',                        onclick:"atsSetView('sourcing')" }
    ], a.view||'grid',
      (canManage?'<button class="btn btn-outline btn-sm" onclick="atsOpenLookupsManager()">Manage lists</button>':'')+
      '<button class="btn btn-primary btn-sm" onclick="atsOpenNew()">'+UI.ic('plus')+'New Candidate</button>');

    // ── stat strip: total + one cell per status, each a filter ────────────
    var counts = a.counts || {};
    var stripItems = [{
      v:poolTotal(a), label:'Total', on:!f.applicant_status,
      onclick:"atsSetFilter('applicant_status','')"
    },{ sep:true }];
    statuses.forEach(function(st){
      stripItems.push({
        v: (a.countsLoaded ? (counts[st]||0) : '·'),
        label: st,
        on: f.applicant_status===st,
        onclick: "atsSetFilter('applicant_status','"+UI.attr(st)+"')"
      });
    });
    var strip = UI.strip(stripItems);

    // ── toolbar ───────────────────────────────────────────────────────────
    var fopt = function(key, all, list){
      return '<select class="sel" style="width:auto;height:34px;padding:0 26px 0 10px;font-size:13px" onchange="atsSetFilter(\''+key+'\',this.value)">'+
        '<option value="">'+all+'</option>'+
        list.map(function(x){ return '<option value="'+esc(x)+'"'+(f[key]===x?' selected':'')+'>'+esc(x)+'</option>'; }).join('')+
      '</select>';
    };
    var toolbar = UI.toolbar({
      search:{ value:a.q, placeholder:'Search name, email, phone, CN- code…',
               oninput:'atsSetSearch(this.value)',
               onkeydown:"if(event.key===&#39;Enter&#39;)atsApplySearch()" },
      icons:[
        { icon:'search',  title:'Search',            onclick:'atsApplySearch()' },
        { icon:'filter',  title:'Advanced filters',  onclick:'atsToggleAdvanced()', on:!!(a.advOpen||advActive) },
        { sep:true },
        { icon:'refresh', title:'Reload',            onclick:'atsReload()' },
        { icon:'x',       title:'Clear all filters', onclick:'atsClearFilters()', off:!anyActive }
      ],
      right: fopt('source','All sources',lk('source',SOURCES))+
             fopt('work_authorization','All work auth',lk('work_authorization',WORK_AUTH))+
             fopt('state','All states',US_STATES)
    });

    // ── advanced panel (unchanged fields, restyled) ───────────────────────
    var advPanel = a.advOpen ? (
      '<div class="card" style="padding:12px 14px;margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">'+
        '<div><label class="flbl">Availability</label>'+
          '<select class="sel" onchange="atsSetFilter(\'availability\',this.value)"><option value="">Any</option>'+
          lk('availability',AVAILABILITY).map(function(x){ return '<option value="'+esc(x)+'"'+(f.availability===x?' selected':'')+'>'+esc(x)+'</option>'; }).join('')+'</select></div>'+
        '<div><label class="flbl">Ownership</label>'+
          '<select class="sel" onchange="atsSetFilter(\'owner_id\',this.value)"><option value="">Anyone</option>'+
          owners.map(function(o){ return '<option value="'+o.id+'"'+(f.owner_id===o.id?' selected':'')+'>'+esc(o.name)+'</option>'; }).join('')+'</select></div>'+
        '<div><label class="flbl">Experience (yrs)</label>'+
          '<div style="display:flex;gap:6px"><input class="sel" type="number" placeholder="min" value="'+esc(f.experience_min)+'" onchange="atsSetFilter(\'experience_min\',this.value)">'+
          '<input class="sel" type="number" placeholder="max" value="'+esc(f.experience_max)+'" onchange="atsSetFilter(\'experience_max\',this.value)"></div></div>'+
        '<div><label class="flbl">Created from</label><input class="sel" type="date" value="'+esc(f.created_from)+'" onchange="atsSetFilter(\'created_from\',this.value)"></div>'+
        '<div><label class="flbl">Created to</label><input class="sel" type="date" value="'+esc(f.created_to)+'" onchange="atsSetFilter(\'created_to\',this.value)"></div>'+
        '<div style="display:flex;align-items:end"><label style="font-size:12.5px;color:var(--ink2);display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" class="ck"'+(f.has_resume==='1'?' checked':'')+' onchange="atsSetFilter(\'has_resume\',this.checked?\'1\':\'\')"> Has résumé</label></div>'+
      '</div>') : '';

    if (a.loading) return UI.page({ tabs:tabs, strip:strip, toolbar:toolbar,
      body:'<div class="dt-empty">Loading candidates…</div>' });

    // ── selection ─────────────────────────────────────────────────────────
    var selIds = Object.keys(a.sel).filter(function(k){ return a.sel[k]; });
    var allOn = a.rows.length && a.rows.every(function(c){ return a.sel[c.id]; });
    var bulkBar = selIds.length ?
      '<div class="card" style="padding:9px 14px;margin-bottom:12px;display:flex;align-items:center;gap:12px">'+
        '<span style="font-size:12.5px;color:var(--ink2)"><b>'+selIds.length+'</b> selected</span>'+
        '<button class="btn btn-sm btn-primary" onclick="atsSequenceSelected()">'+UI.ic('send')+'Add to email sequence</button>'+
        '<button class="btn btn-sm btn-outline" onclick="atsClearSel()">Clear</button>'+
      '</div>' : '';

    // ── table ─────────────────────────────────────────────────────────────
    // The identity column carries name + email together, the way every list in
    // the benchmark tools does: one glance tells you who, not just what.
    var cols = [
      { raw: UI.check(allOn, 'atsToggleSelAll()'), w:'34px' },
      { label:'Candidate',  icon:'user' },
      { label:'Status' },
      { label:'Title' },
      { label:'Location' },
      { label:'Phone' },
      { label:'Source' },
      { label:'Work auth' },
      { label:'Owner' },
      { label:'Added' },
      { label:'', w:'120px' }
    ];
    var rows = a.rows.map(function(c){
      return [
        { html: UI.check(!!a.sel[c.id], "atsToggleSel('"+c.id+"')") },
        { html: UI.idCell(c.full_name||'—', c.email||'', "bdOpenCandidate('"+c.id+"')",
                 { verified:!!c.email, badge: c.candidate_code?'<span class="pill mute" style="font-family:var(--mono);font-size:10.5px">'+esc(c.candidate_code)+'</span>':'' }) },
        { html: statusPill(c.applicant_status), cls:'tight' },
        { html: esc(jobTitle(c)) },
        { html: esc(loc(c)), cls:'tight' },
        { html: UI.dash(c.phone), cls:'tight' },
        { html: UI.dash(c.source), cls:'tight' },
        { html: UI.dash(c.work_authorization), cls:'tight' },
        { html: UI.dash(ownerName(c)), cls:'tight' },
        { html: '<span style="color:var(--ink3)">'+fmtDate(c.created_at)+'</span>', cls:'tight' },
        { html: '<button class="btn btn-sm btn-outline" onclick="atsAddToJob(\''+c.id+'\')">Add to Job</button>', cls:'tight' }
      ];
    });

    var table = UI.table({
      cols: cols, rows: rows, minWidth:'1180px',
      empty: anyActive
        ? 'No candidates match these filters. <span style="color:var(--accent);cursor:pointer" onclick="atsClearFilters()">Clear them &rarr;</span>'
        : 'No candidates yet. <span style="color:var(--accent);cursor:pointer" onclick="atsOpenNew()">Add the first one &rarr;</span>'
    });

    // ── pager ─────────────────────────────────────────────────────────────
    var totalPages = Math.max(1, Math.ceil((a.total||0)/a.limit));
    var fromN = a.total ? (a.page-1)*a.limit+1 : 0, toN = Math.min(a.page*a.limit, a.total);
    var pager =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12.5px;color:var(--ink3)">'+
        '<div>'+fromN+'–'+toN+' of '+(a.total||0)+'</div>'+
        '<div style="display:flex;gap:6px;align-items:center">'+
          '<button class="btn btn-sm btn-outline" '+(a.page<=1?'disabled style="opacity:.5"':'')+' onclick="atsGoPage('+(a.page-1)+')">&lsaquo; Prev</button>'+
          '<span>Page '+a.page+' / '+totalPages+'</span>'+
          '<button class="btn btn-sm btn-outline" '+(a.page>=totalPages?'disabled style="opacity:.5"':'')+' onclick="atsGoPage('+(a.page+1)+')">Next &rsaquo;</button>'+
        '</div>'+
      '</div>';

    return UI.page({ tabs:tabs, strip:strip, toolbar:toolbar,
      body: advPanel + bulkBar + table + pager });
  }

  // Status as a coloured pill in the kit's vocabulary, replacing the old inline
  // span. Tones are semantic, not decorative: anything that stops work being
  // done to a person (Do Not Call / Blacklisted) reads red or amber.
  function statusPill(s){
    var tone = {
      'New lead':'mute','Active':'ok','Submitted':'info','Interviewing':'cool',
      'Placed':'ok','Do Not Call':'warn','Blacklisted':'bad','Inactive':'mute'
    }[s] || 'mute';
    return UI.pill(s||'—', tone, true);
  }


  // ── multi-select → email sequence ───────────────────────────────────────────
  window.atsToggleSel = function(id){ STATE.ats.sel[id]=!STATE.ats.sel[id]; render(); };
  window.atsToggleSelAll = function(){
    var a=STATE.ats, allOn=a.rows.length&&a.rows.every(function(c){return a.sel[c.id];});
    a.rows.forEach(function(c){ a.sel[c.id]=!allOn; });
    render();
  };
  window.atsClearSel = function(){ STATE.ats.sel={}; render(); };
  window.atsSequenceSelected = function(){
    var a=STATE.ats;
    var items=a.rows.filter(function(c){return a.sel[c.id];})
      .map(function(c){ return { entity_id:c.id, label:c.full_name||'Candidate' }; });
    if(!items.length){ showToast('Select candidates first','error'); return; }
    if(typeof wfStartSequence!=='function'){ showToast('Sequencing module not loaded','error'); return; }
    wfStartSequence('candidate', items, { anyStage:true });
  };

  // ── search / filter / pagination handlers ────────────────────────────────────
  window.atsSetSearch = function(v){ STATE.ats.q = v; };
  window.atsApplySearch = function(){ STATE.ats.page = 1; loadApplicants(); };
  window.atsSetFilter = function(k,v){ STATE.ats.filters[k]=v; STATE.ats.page=1; loadApplicants(); };
  window.atsClearFilters = function(){ STATE.ats.q=''; STATE.ats.filters={ applicant_status:'', source:'', state:'', work_authorization:'', availability:'', experience_min:'', experience_max:'', created_from:'', created_to:'', has_resume:'', owner_id:'' }; STATE.ats.page=1; loadApplicants(); };
  window.atsToggleAdvanced = function(){ STATE.ats.advOpen = !STATE.ats.advOpen; render(); };
  window.atsGoPage = function(p){ if(p<1)return; STATE.ats.page=p; loadApplicants(); };

  // ── add / edit modal ─────────────────────────────────────────────────────────
  // The ONE add-candidate window used everywhere — the Candidates database AND
  // every job's "+ Add Candidate". Pass a jobCtx ({jobId,jobTitle,jobCode}) to
  // additionally tag the candidate to that job after creating (or to search an
  // existing candidate to add), so there is a single consistent form.
  window.atsOpenNew = function(jobCtx){
    STATE.ats.editId = null; STATE.ats.dupMatches = []; STATE.ats._resumeStash = null;
    STATE.ats._jobCtx = (jobCtx && jobCtx.jobId) ? jobCtx : null;
    STATE.ats._jobTagQ = ''; STATE.ats._jobTagPool = [];
    STATE.ats.form = { applicant_status:'New lead', source:'Manual', pay_currency:'USD' };
    showApplicantModal();
  };
  window.atsOpenEdit = function(id){
    STATE.ats._jobCtx = null; STATE.ats._jobTagQ = ''; STATE.ats._jobTagPool = [];
    var c = STATE.ats.rows.find(function(x){ return x.id===id; });
    if(!c){ apiGet('/candidates/'+id).then(function(d){ STATE.ats.editId=id; STATE.ats.dupMatches=[]; STATE.ats._resumeStash=null; STATE.ats.form=Object.assign({},d); showApplicantModal(); }).catch(function(e){ showToast('Failed: '+e.message,'error'); }); return; }
    STATE.ats.editId = id; STATE.ats.dupMatches = []; STATE.ats._resumeStash = null; STATE.ats.form = Object.assign({}, c);
    showApplicantModal();
  };

  window.atsFormSet = function(k,v){ STATE.ats.form[k]=v; };
  window.atsZipPick = function(place){
    STATE.ats.form.zip = place.zip || STATE.ats.form.zip;
    STATE.ats.form.city = place.city || STATE.ats.form.city;
    STATE.ats.form.state = place.state || STATE.ats.form.state;
    showApplicantModal();
  };

  // ── job-context: search an existing candidate to add to this job ────────────
  window.atsJobTagSearch = function(q){
    STATE.ats._jobTagQ = q; q = (q||'').trim();
    if (q.length < 2){ STATE.ats._jobTagPool = []; showApplicantModal(); return; }
    apiGet('/candidates?q='+encodeURIComponent(q)).then(function(pool){ STATE.ats._jobTagPool = pool||[]; showApplicantModal(); })
      .catch(function(){ STATE.ats._jobTagPool = []; showApplicantModal(); });
  };
  window.atsJobTagPick = function(cid){
    var ctx = STATE.ats._jobCtx; if(!ctx) return;
    apiPost('/pipeline', { candidate_id:cid, job_order_id:ctx.jobId }).then(function(){ atsAfterJobAdd(ctx); })
      .catch(function(e){
        if (/already tagged/i.test(e.message)) showToast('Already on this job','error');
        else showToast('Failed: '+e.message,'error');
      });
  };
  function atsAfterJobAdd(ctx){
    STATE.ats._jobCtx = null; STATE.ats._jobTagPool = []; STATE.ats._jobTagQ = '';
    closeModal();
    showToast('Candidate added to '+((ctx && ctx.jobTitle) || 'the job'),'success');
    // Refresh whichever job view is open so the new candidate shows immediately.
    if (STATE.page==='bd_pipeline' && window.bdReloadPipeline) return bdReloadPipeline();
    if ((STATE.page==='bd_kanban' || STATE.page==='bd_jodetail') && window.bdOpenPipeline) return bdOpenPipeline(ctx.jobId);
  }

  // ── resume parsing: file → fields, prefilled into the form ─────────────────
  // The file is stashed so it still attaches on save even though the modal
  // re-render clears the file input.
  window.atsParseResume = function(){
    var fileEl = document.getElementById('ats_resume_file');
    var f = fileEl && fileEl.files && fileEl.files[0];
    if (!f && STATE.ats._resumeStash){ atsDoParse(STATE.ats._resumeStash); return; }
    if (!f){ showToast('Choose a resume file first','error'); return; }
    if (f.size > 4.5*1024*1024){ showToast('File too large (max ~4.5 MB)','error'); return; }
    var r = new FileReader();
    r.onload = function(){
      STATE.ats._resumeStash = { name:f.name, type:f.type||'application/octet-stream', data:String(r.result) };
      atsDoParse(STATE.ats._resumeStash);
    };
    r.onerror = function(){ showToast('Could not read file','error'); };
    r.readAsDataURL(f);
  };
  function atsDoParse(stash){
    showToast('Parsing resume…','info');
    apiPost('/candidates/parse-resume', { filename:stash.name, content_type:stash.type, data_base64:stash.data })
      .then(function(r){
        var flds = (r&&r.fields)||{};
        var form = STATE.ats.form;
        // fill only fields the user hasn't already typed; resume_text always
        Object.keys(flds).forEach(function(k){
          if (k==='summary') return;
          if (form[k]===undefined || form[k]===null || form[k]==='') form[k]=flds[k];
        });
        if (r.resume_text) form.resume_text = r.resume_text;
        showApplicantModal();
        showToast(r.used_ai?'Parsed with AI — review the filled fields':'Parsed (basic mode — no AI key). Review the filled fields','success');
      })
      .catch(function(e){ showToast('Parse failed: '+e.message,'error'); });
  }
  // upload from the live input, or from the stash if the input was cleared by a re-render
  function uploadResumeFor(candId){
    var fileEl = document.getElementById('ats_resume_file');
    if (fileEl && fileEl.files && fileEl.files[0]) return atsUploadResumeFile(candId, fileEl);
    var st = STATE.ats._resumeStash;
    if (st) return apiPost('/candidates/'+candId+'/documents', { filename:st.name, content_type:st.type, doc_type:'resume', data_base64:st.data }).catch(function(){ showToast('Resume upload failed','error'); });
    return Promise.resolve(false);
  }

  function fld(label, inner, req){
    return '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">'+label+(req?' <span style="color:var(--red)">*</span>':'')+'</label>'+inner+'</div>';
  }
  function inp(key, ph){ return '<input class="sel" value="'+esc(STATE.ats.form[key]||'')+'" placeholder="'+(ph||'')+'" oninput="atsFormSet(\''+key+'\',this.value)">'; }
  function sel(key, opts, blank){
    var list = (blank?['']:[]).concat(opts);
    return '<select class="sel" onchange="atsFormSet(\''+key+'\',this.value)">'+
      list.map(function(o){ return '<option value="'+esc(o)+'"'+(STATE.ats.form[key]===o?' selected':'')+'>'+esc(o||'Select…')+'</option>'; }).join('')+'</select>';
  }

  function showApplicantModal(){
    var f = STATE.ats.form, editing = !!STATE.ats.editId;
    var u = STATE.user;
    var jobCtx = STATE.ats._jobCtx;

    // When adding from a job, offer to reuse an existing candidate (search-to-add)
    // before falling back to creating a brand-new one via the form below.
    var jobTag = '';
    if (jobCtx && !editing){
      var jq = (STATE.ats._jobTagQ||'').trim();
      var jpool = jq.length>=2 ? (STATE.ats._jobTagPool||[]) : [];
      var jpoolHtml = jq.length<2
        ? '<div style="color:var(--text3);font-size:12px;padding:4px 2px">Type a name, email or CN- code to add someone already in the system.</div>'
        : (jpool.map(function(c){
            return '<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);border-radius:8px;padding:7px 10px;margin-bottom:5px">'+
              '<div><div style="font-weight:600;font-size:12.5px">'+esc(c.full_name)+' '+code(c.candidate_code||'')+'</div>'+
              '<div style="font-size:11px;color:var(--text3)">'+esc(c.current_title||c.headline||'')+(c.email?' · '+esc(c.email):'')+'</div></div>'+
              '<button class="btn btn-sm btn-primary" onclick="atsJobTagPick(\''+c.id+'\')">Add</button>'+
            '</div>';
          }).join('') || '<div style="color:var(--text3);font-size:12px;padding:4px 2px">No matches — fill the form below to create a new candidate.</div>');
      jobTag =
        '<div style="border:1px solid var(--border);border-radius:8px;padding:11px 13px;margin-bottom:16px;background:var(--bg)">'+
          '<div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:7px">ALREADY IN THE SYSTEM? SEARCH TO ADD TO THIS JOB</div>'+
          '<input class="sel" placeholder="Search name, email, CN- code…" value="'+esc(STATE.ats._jobTagQ||'')+'" oninput="atsJobTagSearch(this.value)">'+
          '<div style="max-height:22vh;overflow-y:auto;margin-top:8px">'+jpoolHtml+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:7px;border-top:1px dashed var(--border);padding-top:7px">…or create a brand-new candidate below.</div>'+
        '</div>';
    }
    var modalTitle = editing ? ('Edit Candidate'+(f.candidate_code?' '+code(f.candidate_code):''))
      : (jobCtx ? ('Add Candidate'+(jobCtx.jobTitle?' — '+esc(jobCtx.jobTitle):'')) : 'New Candidate');
    var saveLabel = editing ? 'Save changes' : (jobCtx ? 'Create & add to job' : 'Create candidate');
    var ownerSel = '';
    if (isBDMlike(u)) {
      var owners = (STATE.users||[]).filter(function(x){ return userHasAnyRole(x,'admin','bd','bd_lead','recruiter'); });
      ownerSel = fld('Ownership',
        '<select class="sel" onchange="atsFormSet(\'owner_id\',this.value)">'+
          '<option value="">'+esc(u.name)+' (me)</option>'+
          owners.map(function(o){ return '<option value="'+o.id+'"'+(f.owner_id===o.id?' selected':'')+'>'+esc(o.name)+'</option>'; }).join('')+
        '</select>');
    }

    var dup = STATE.ats.dupMatches.length ? (
      '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-bottom:14px">'+
        '<div style="font-weight:700;font-size:12.5px;color:#b45309;margin-bottom:8px">⚠ Possible existing candidate'+(STATE.ats.dupMatches.length>1?'s':'')+' — matched by name + email/phone</div>'+
        STATE.ats.dupMatches.map(function(m){
          return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:7px;padding:8px 10px;margin-bottom:6px">'+
            '<div style="font-size:12.5px"><b>'+esc(m.full_name)+'</b> '+code(m.candidate_code||'')+
              '<div style="font-size:11px;color:var(--text3)">'+esc(m.email||'')+(m.phone?' · '+esc(m.phone):'')+(m.current_title?' · '+esc(m.current_title):'')+'</div></div>'+
            '<button class="btn btn-sm btn-outline" onclick="atsOpenEdit(\''+m.id+'\')">Open</button>'+
          '</div>';
        }).join('')+
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">'+
          '<button class="btn btn-sm btn-primary" onclick="atsSaveApplicant(true)">Create anyway</button>'+
        '</div>'+
      '</div>') : '';

    STATE.modal =
      '<div class="modal modal-w720" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'+
          '<div style="font-weight:700;font-size:16px">'+modalTitle+'</div>'+
          '<span style="cursor:pointer;color:var(--text3)" onclick="closeModal()">✕</span>'+
        '</div>'+
        '<div style="padding:18px 20px;max-height:66vh;overflow-y:auto">'+
          jobTag+
          dup+
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">'+
            fld('Full Name', inp('full_name','Jane Doe'), true)+
            fld('Email', inp('email','jane@example.com'))+
            fld('Mobile', inp('phone','(555) 123-4567'))+
            fld('Work Authorization', sel('work_authorization', lk('work_authorization',WORK_AUTH), true))+
            fld('Source', sel('source', lk('source',SOURCES), true))+
            fld('Candidate Status', sel('applicant_status', lk('applicant_status',APPLICANT_STATUSES)))+
            fld('City', inp('city'))+
            fld('State', sel('state', US_STATES, true))+
            fld('Country', inp('country','United States'))+
            fld('Zip', zipAcHTML('ats-zip', STATE.ats.form.zip, 'atsZipPick'))+
            fld('Current Title', inp('current_title'))+
            fld('Desired / Headline Title', inp('headline'))+
            fld('Current Employer', inp('current_employer'))+
            fld('Experience (years)', inp('experience_years','e.g. 8'))+
            fld('LinkedIn', inp('linkedin_url'))+
            fld('Availability', sel('availability', lk('availability',AVAILABILITY), true))+
            fld('Notice Period', inp('notice_period'))+
            fld('Current CTC', inp('current_ctc'))+
            fld('Expected CTC', inp('expected_ctc'))+
            fld('Bill Rate', inp('bill_rate'))+
            fld('Pay Rate', inp('pay_rate'))+
            fld('Pay Type', sel('pay_type', lk('pay_type',PAY_TYPES), true))+
            fld('Resume URL', inp('resume_url'))+
            fld('Attach Resume', '<input type="file" id="ats_resume_file" accept=".pdf,.doc,.docx,.rtf,.txt" style="font-size:11.5px;width:100%">'+
              (STATE.ats._resumeStash?'<div style="font-size:10.5px;color:var(--green);margin-top:3px">✓ '+esc(STATE.ats._resumeStash.name)+' ready to attach</div>':''))+
            ownerSel+
          '</div>'+
          '<div style="margin-top:10px"><button class="btn btn-sm btn-outline" onclick="atsParseResume()">✨ Parse &amp; fill from resume</button>'+
            '<span style="font-size:11px;color:var(--text3);margin-left:8px">Choose a resume file above, then parse to auto-fill the form. Review before saving.</span></div>'+
          '<div style="margin-top:12px">'+fld('Skills', '<textarea class="sel" style="min-height:60px;resize:vertical" placeholder="Comma-separated skills" oninput="atsFormSet(\'skills\',this.value)">'+esc(f.skills||'')+'</textarea>')+'</div>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:'+(editing?'space-between':'flex-end')+';gap:8px;align-items:center">'+
          (editing?'<button class="btn btn-sm btn-outline" style="color:var(--red)" onclick="atsDeleteApplicant(\''+STATE.ats.editId+'\')">Delete</button>':'')+
          '<div style="display:flex;gap:8px">'+
            '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
            '<button class="btn btn-primary" onclick="atsSaveApplicant(false)">'+saveLabel+'</button>'+
          '</div>'+
        '</div>'+
      '</div>';
    render();
  }

  window.atsSaveApplicant = function(force){
    var f = STATE.ats.form;
    if (!f.full_name || !f.full_name.trim()){ showToast('Full name is required','error'); return; }
    var payload = Object.assign({}, f); if (force) payload.force = true;

    if (STATE.ats.editId){
      var editId = STATE.ats.editId;
      apiPut('/candidates/'+editId, payload).then(function(){
        return uploadResumeFor(editId);
      }).then(function(){
        STATE.ats._resumeStash=null;
        showToast('Candidate updated','success'); closeModal();
        if (window.bdReloadCandidateProfile) window.bdReloadCandidateProfile();
        loadApplicants();
      }).catch(function(e){ showToast('Failed: '+e.message,'error'); });
      return;
    }
    var ctx = STATE.ats._jobCtx;
    apiPost('/candidates', payload).then(function(c){
      return uploadResumeFor(c.id).then(function(){ return c; });
    }).then(function(c){
      STATE.ats._resumeStash=null; STATE.ats.dupMatches=[];
      if (ctx){
        return apiPost('/pipeline', { candidate_id:c.id, job_order_id:ctx.jobId })
          .then(function(){ atsAfterJobAdd(ctx); })
          .catch(function(e){ showToast('Candidate created, but adding to the job failed: '+e.message,'error'); closeModal(); });
      }
      showToast('Candidate created','success'); closeModal(); STATE.ats.page=1; loadApplicants();
    }).catch(function(e){
      // 409 possible_duplicate → surface matches, keep the form open (warn-and-offer)
      if (/possible_duplicate/i.test(e.message)){
        apiGet('/candidates/check-duplicate?full_name='+encodeURIComponent(f.full_name||'')+'&email='+encodeURIComponent(f.email||'')+'&phone='+encodeURIComponent(f.phone||''))
          .then(function(r){ STATE.ats.dupMatches = (r&&r.duplicates)||[]; showApplicantModal(); showToast('Possible duplicate found — review below','info'); })
          .catch(function(){ STATE.ats.dupMatches=[{full_name:f.full_name,candidate_code:'',email:f.email,phone:f.phone}]; showApplicantModal(); });
      } else showToast('Failed: '+e.message,'error');
    });
  };

  window.atsDeleteApplicant = function(id){
    if (!confirm('Remove this candidate from the database?')) return;
    apiDelete('/candidates/'+id).then(function(){ showToast('Candidate removed','info'); closeModal(); loadApplicants(); })
      .catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };

  // ── add a candidate to a job — type-to-search the job by id / title / client ─
  window.atsAddToJob = function(cid){
    var c = STATE.ats.rows.find(function(x){ return x.id===cid; }) || {};
    apiGet('/job-orders').then(function(jobs){
      STATE.ats._jobPick = { cid:cid, name:c.full_name||'candidate', jobs:jobs||[], q:'' };
      atsRenderJobPick();
    }).catch(function(e){ showToast('Failed to load jobs: '+e.message,'error'); });
  };
  window.atsJobPickSearch = function(q){ if(STATE.ats._jobPick){ STATE.ats._jobPick.q=q; atsRenderJobPick(); } };
  function atsRenderJobPick(){
    var jp = STATE.ats._jobPick; if(!jp) return;
    var q = (jp.q||'').toLowerCase();
    var list = jp.jobs.filter(function(j){
      if(!q) return true;
      return [j.job_code,j.job_title,j.client].some(function(v){ return String(v||'').toLowerCase().indexOf(q)>-1; });
    }).slice(0,30);
    var rows = list.map(function(j){
      return '<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);border-radius:8px;padding:8px 11px;margin-bottom:6px;cursor:pointer" onclick="atsDoAddToJob(\''+jp.cid+'\',\''+j.id+'\')">'+
        '<div><div style="font-weight:600;font-size:13px">'+esc(j.job_title||'')+' '+code(j.job_code||'')+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+esc(j.client||'')+(j.status?' · '+esc(j.status):'')+'</div></div>'+
        '<span class="btn btn-sm btn-primary">Tag</span>'+
      '</div>';
    }).join('') || '<div style="color:var(--text3);font-size:12.5px;padding:8px">No jobs match.</div>';
    STATE.modal =
      '<div class="modal modal-w560" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:16px">Add '+esc(jp.name)+' to a Job</div>'+
        '<div style="padding:18px 20px">'+
          '<input class="sel" placeholder="Search by job ID, title, or client…" value="'+esc(jp.q)+'" oninput="atsJobPickSearch(this.value)" style="margin-bottom:10px">'+
          '<div style="max-height:40vh;overflow-y:auto">'+rows+'</div>'+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:8px">Tags the candidate into the job pipeline. Promote to a submission from the job\'s Pipeline tab.</div>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">'+
          '<button class="btn btn-outline" onclick="closeModal()">Close</button>'+
        '</div>'+
      '</div>';
    render();
  }
  window.atsDoAddToJob = function(cid, jid){
    if(!jid){ showToast('Pick a job','error'); return; }
    apiPost('/pipeline', { candidate_id:cid, job_order_id:jid }).then(function(){
      showToast('Tagged to job pipeline','success'); STATE.ats._jobPick=null; closeModal();
    }).catch(function(e){
      if (/already tagged/i.test(e.message)) showToast('Candidate already in that pipeline','error');
      else showToast('Failed: '+e.message,'error');
    });
  };

})();
