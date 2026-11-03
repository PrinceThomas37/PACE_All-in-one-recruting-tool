// ============================================================================
// THE LEAD LIST, KEPT ON THE SERVER'S SIDE OF THE FENCE (R-349 Stages C + D, 3 Nov 2026).
//
// Until now the browser downloaded EVERY lead at sign-in and did the finding, counting and paging itself (06-page-leads.js renderJobs). That list grows with the
// database — 2,000 new leads a day cannot be carried. Now the browser asks for what is on screen:
//   GET /jobs/page    one page of the leads that match the filters   (newest first; the page after is reached by the bookmark the answer carries)
//   GET /jobs/counts  the stage numbers and "my / my team's" numbers under the same filters
//   GET /jobs/facets  the "Assigned to" and "Industry" drop-down numbers
//   GET /jobs/ids     "select all N matching" (every matching lead, across pages)
//   GET /jobs/by-ids  whole leads the browser has not got (a ticked lead on another page, a lead opened from the inbox)
// Nothing about WHO MAY SEE a lead is decided here — the server decides it from the session (CLAUDE.md: never filter in the browser).
//
// SAFE BY CONSTRUCTION
//   · Server mode switches on only when the server has answered a first page (STATE.leadsServer). Any failure → the old whole-list behaviour, unchanged.
//   · STATE.jobs is still "the whole list" for the ~20 screens that read it (assign, distribution, mail merge, research ...). It is an accessor now: the first
//     time any of them touches it while only a few leads are held, the whole list is fetched ONCE in the background — exactly what sign-in used to do, so those
//     screens already know how to wait for it. The Leads tab, the Dashboard numbers and the lead drawer never touch it, so they never pay for it.
//   · Every write to /jobs, /leads, /distribute ... marks the page stale; it is fetched again at once, in place (the person keeps their page and their ticks).
//
// shortcut: the leads this file has seen (pages, by-id fetches) stay in memory for the session as a "working set" — bounded by what one person looks at in a
// sitting; upgrade (evict by age) if a session ever pages through thousands.
// ============================================================================
(function(){
  var LV=STATE.lv={who:null,on:false,key:'',cursors:[null],idx:0,status:'idle',rows:[],next:null,strip:null,stripTotal:0,team:null,facets:null,countsKey:'',countsFor:'',
    gen:0,cgen:0,dirty:false,seen:{},allIds:null,allKey:'',allCapped:false,allLoading:false,error:'',pageLoadedOnce:false};
  var store=window.leadsStore={};
  var WRITE_PATH=/^\/(jobs|leads|distribute|ownership-requests|contacts|companies|lead-)/;
  var STAGES=['Unassigned','Assigned','Connected','In Discussion','Future','Rejected'];
  var BY_IDS_CHUNK=100;

  // ── the whole list, as an accessor (see the header) ─────────────────────────
  var _jobs=Array.isArray(STATE.jobs)?STATE.jobs:[];
  var _full=false, _fullAsked=false;
  Object.defineProperty(STATE,'jobs',{configurable:true,enumerable:true,
    get:function(){ if(LV.on&&!_full&&!_fullAsked)askFull(); return _jobs; },
    set:function(v){ _jobs=Array.isArray(v)?v:[]; if(!_jobs.length){ _full=false; } }
  });
  function askFull(){
    _fullAsked=true;
    // never inside a render: start it next turn, and say so the way sign-in always did (a note, not an empty list that reads as "no leads")
    setTimeout(function(){ if(LV.on&&!_full&&STATE.token&&typeof loadLeadsInBackground==='function')store.loadEverything(); },0);
  }
  store.loadEverything=function(){
    _fullAsked=true;
    var keep=_jobs.slice(), keepContacts=(STATE.contacts||[]).slice();
    return loadLeadsInBackground(0,{keepWhileLoading:true,keep:keep,keepContacts:keepContacts});
  };
  store.markFull=function(){ _full=true; _fullAsked=true; };
  store.isFull=function(){ return _full; };
  store.askedFull=function(){ return _fullAsked; };
  store.working=function(){ return _jobs; };
  store.byId=function(id){ for(var i=0;i<_jobs.length;i++){ if(_jobs[i].id===id)return _jobs[i]; } return null; };

  // ── who is served by the server, and the query ──────────────────────────────
  function roleOk(u){ return !!u&&u.role!=='ra'; }          // a Research Analyst's own list (and the entry form above it) stays on the browser's copy
  store.use=function(u){ return !!(LV.on&&LV.who&&LV.who===STATE.token&&roleOk(u)); };
  function csv(a){ return (a||[]).join(','); }
  function params(withPage){
    var f=STATE.jobsFilter||{}, p=[];
    function add(k,v){ if(v!==''&&v!=null)p.push(k+'='+encodeURIComponent(v)); }
    add('search',(f.search||'').trim()); add('industries',csv(f.industries)); add('whose',f.whose||''); add('assignee',f.assignee||'');
    if(f.dateRange&&f.dateRange!=='all'){ add('dateRange',f.dateRange); if(f.dateRange==='custom'){ add('dateFrom',f.dateFrom||''); add('dateTo',f.dateTo||''); } }
    add('today',typeof todayIST==='function'?todayIST():'');
    if(withPage){ add('stages',csv(f.stages)); add('perPage',perPage()); }
    return p.join('&');
  }
  function perPage(){ return [10,20,50].indexOf(STATE.leadsPageSize)>=0?STATE.leadsPageSize:''; }
  function keyOf(){ return params(true); }

  // ── bringing leads into the browser ─────────────────────────────────────────
  function bring(raw){
    var p=STATE._pendingStageChanges||{}, byId={}, out=[];
    raw.forEach(function(r){
      var j=normaliseJob(r); if(p[j.id])j.stage=p[j.id];
      var at=-1; for(var i=0;i<_jobs.length;i++){ if(_jobs[i].id===j.id){ at=i; break; } }
      if(at>-1)_jobs[at]=j; else _jobs.push(j);
      byId[j.id]=true; out.push(j);
    });
    STATE.contacts=(STATE.contacts||[]).filter(function(c){ return !byId[c.job_id]; }).concat(flattenContacts(raw));
    return out;
  }
  store.bring=bring;

  // ── the page ────────────────────────────────────────────────────────────────
  function loadPage(){
    var gen=++LV.gen, who=STATE.token;
    LV.status=LV.pageLoadedOnce?'refreshing':'loading'; LV.error='';
    var after=LV.cursors[LV.idx];
    var url='/jobs/page?'+keyOf()+(after?'&after='+encodeURIComponent(after):'');
    return apiGet(url).then(function(res){
      if(gen!==LV.gen||STATE.token!==who)return;
      var rows=bring(res.rows||[]); LV.perPageUsed=res.perPage||LV.perPageUsed;
      LV.rows=rows; LV.next=res.next||null; LV.status='ready'; LV.pageLoadedOnce=true;
      rows.forEach(function(j){ LV.seen[j.id]=true; });
      scheduleRender();
    }).catch(function(e){
      if(gen!==LV.gen||STATE.token!==who||(e&&e.expired))return;
      LV.status='error'; LV.error=(e&&e.message)||'Could not load the leads'; scheduleRender();
    });
  }
  function loadCounts(){
    var k=params(false); var gen=++LV.cgen, who=STATE.token;
    return apiGet('/jobs/counts?'+k).then(function(res){
      if(gen!==LV.cgen||STATE.token!==who)return;
      LV.strip=res.strip||{}; LV.stripTotal=Number(res.stripTotal)||0; LV.team=res.team||null; LV.countsFor=k; scheduleRender();
    }).catch(function(e){ if(gen===LV.cgen&&STATE.token===who&&!(e&&e.expired)){ LV.countsFor=''; scheduleRender(); } });
  }
  function loadFacets(){
    var who=STATE.token;
    return apiGet('/jobs/facets').then(function(res){ if(STATE.token!==who)return; LV.facets=res; scheduleRender(); })
      .catch(function(){ /* the drop-downs simply stay hidden until the next try */ });
  }

  /** Called by the Leads tab on every draw: starts whatever is missing for the filters on screen, and returns the state to draw. */
  store.view=function(){
    var k=keyOf();
    if(k!==LV.key){ LV.key=k; LV.cursors=[null]; LV.idx=0; LV.seen={}; LV.allIds=null; LV.allKey=''; STATE.leadsPage=0; LV.dirty=false; loadPage(); }
    else if((STATE.leadsPage||0)===0&&LV.idx>0){ LV.cursors=[null]; LV.idx=0; LV.dirty=false; loadPage(); }   // something outside asked for the first page (a filter pressed again, a clear): start from the top
    else if(LV.dirty){ LV.dirty=false; loadPage(); }
    if(LV.countsFor!==params(false)&&LV.status!=='error'){ LV.countsFor=params(false); loadCounts(); }
    if(!LV.facets&&!LV._facetsAsked){ LV._facetsAsked=true; loadFacets(); }
    return LV;
  };
  store.total=function(){
    var f=STATE.jobsFilter||{};
    if(!LV.strip)return null;
    if(f.stages&&f.stages.length){ var n=0; f.stages.forEach(function(s){ n+=LV.strip[s]||0; }); return n; }
    return LV.stripTotal;
  };
  store.pageCount=function(){ var t=store.total(); var per=perPage()||LV.perPageUsed||LV.rows.length||20; return t==null?(LV.next?LV.idx+2:LV.idx+1):Math.max(1,Math.ceil(t/Math.max(1,per))); };
  store.goPage=function(p){
    p=Math.max(0,p);
    if(p>LV.idx&&LV.next){ LV.cursors[LV.idx+1]=LV.next; LV.idx++; }
    else if(p<LV.idx){ LV.idx=p; }
    else return;
    STATE.leadsPage=LV.idx; loadPage(); render();
  };

  // ── "select all N matching": every matching lead, across pages ──────────────
  store.loadAllIds=function(){
    var k=keyOf(); if(LV.allIds&&LV.allKey===k)return Promise.resolve(LV.allIds);
    LV.allLoading=true;
    return apiGet('/jobs/ids?'+params(true)).then(function(res){
      LV.allLoading=false; if(keyOf()!==k)return LV.allIds||[];
      LV.allIds=res.ids||[]; LV.allKey=k; LV.allCapped=!!res.capped; LV.allCap=res.cap||0; return LV.allIds;
    }).catch(function(e){ LV.allLoading=false; throw e; });
  };
  /** The leads the person may act on at once: every match when "select all" was used, else every lead they have seen under these filters. */
  store.selectable=function(){ return (LV.allIds&&LV.allKey===keyOf())?LV.allIds:Object.keys(LV.seen); };

  // ── leads the browser has not got ───────────────────────────────────────────
  store.ensureLeads=function(ids){
    var need=(ids||[]).filter(function(id){ return !store.byId(id); }), chunks=[];
    for(var i=0;i<need.length;i+=BY_IDS_CHUNK)chunks.push(need.slice(i,i+BY_IDS_CHUNK));
    return chunks.reduce(function(chain,c){
      return chain.then(function(){ return apiGet('/jobs/by-ids?ids='+encodeURIComponent(c.join(','))).then(function(r){ bring(r.rows||[]); }); });
    },Promise.resolve()).then(function(){ return ids.map(store.byId).filter(Boolean); });
  };
  var _asking={};
  /** One lead by id, from wherever it is: the working set, else the server. Resolves with the lead or null. */
  store.lead=function(id){
    var have=store.byId(id); if(have)return Promise.resolve(have);
    if(_asking[id])return _asking[id];
    _asking[id]=store.ensureLeads([id]).then(function(l){ delete _asking[id]; scheduleRender(); return l[0]||null; }).catch(function(){ delete _asking[id]; return null; });
    return _asking[id];
  };

  // ── something changed: fetch again, in place ────────────────────────────────
  var _t=null;
  store.invalidate=function(){
    if(!LV.on)return;
    LV.dirty=true; LV.countsFor=''; LV.facets=null; LV._facetsAsked=false; LV.allIds=null; LV.allKey='';
    clearTimeout(_t); _t=setTimeout(function(){ if(STATE.token&&(STATE.page==='leads'||STATE.page==='dashboard'))scheduleRender(); },250);
  };
  store.retry=function(){ LV.dirty=true; LV.countsFor=''; LV.facets=null; LV._facetsAsked=false; scheduleRender(); };
  store.afterWrite=function(path){ if(WRITE_PATH.test(String(path||'')))store.invalidate(); };

  // ── sign-in: ask for the first page instead of the whole list ───────────────
  function reset(){ LV.key=''; LV.cursors=[null]; LV.idx=0; LV.rows=[]; LV.next=null; LV.strip=null; LV.stripTotal=0; LV.team=null; LV.facets=null; LV._facetsAsked=false; LV.countsFor=''; LV.seen={}; LV.allIds=null; LV.allKey=''; LV.status='idle'; LV.dirty=false; LV.pageLoadedOnce=false; LV.error=''; _full=false; _fullAsked=false; }
  store.reset=function(){ LV.on=false; LV.who=null; reset(); };
  /** Resolves true when the server answered (server mode is on), false when the old whole-list load must run instead. */
  store.start=function(){
    var who=STATE.token; store.reset();
    if(!roleOk(STATE.user))return Promise.resolve(false);
    LV.who=who;
    LV.key=keyOf();
    return Promise.all([apiGet('/jobs/page?'+LV.key),apiGet('/jobs/counts?'+params(false)),apiGet('/jobs/facets').catch(function(){ return null; })]).then(function(r){
      if(STATE.token!==who)return false;
      LV.on=true; LV.perPageUsed=r[0].perPage||0;
      LV.rows=bring(r[0].rows||[]); LV.next=r[0].next||null; LV.status='ready'; LV.pageLoadedOnce=true; LV.rows.forEach(function(j){ LV.seen[j.id]=true; });
      LV.strip=r[1].strip||{}; LV.stripTotal=Number(r[1].stripTotal)||0; LV.team=r[1].team||null; LV.countsFor=params(false);
      LV.facets=r[2]; LV._facetsAsked=true;
      return true;
    }).catch(function(e){ if(STATE.token===who&&!(e&&e.expired)){ store.reset(); } return false; });
  };

  // a page change in the old numbered pager asks for the new page index; in server mode it moves through the bookmarks
  var _setPage=window.setLeadsPage;
  window.setLeadsPage=function(p){ if(store.use(STATE.user)&&STATE.page==='leads')return store.goPage(p); return _setPage?_setPage(p):undefined; };
  store.STAGES=STAGES;
})();

// "Select all N matching" asks the server for every matching id first; "Sequence selected" needs each ticked lead's contacts, so the leads it has not got are fetched.
(function(){
  var store=window.leadsStore, LV=STATE.lv;
  var _tog=window.leadToggleSelAll;
  window.leadToggleSelAll=function(){
    if(!store.use(STATE.user)||!_tog)return _tog&&_tog();
    store.loadAllIds().then(function(ids){
      if(LV.allCapped)showToast('Selected the first '+LV.allCap+' matching leads. Narrow the filters to reach the rest.','info');
      STATE._leadSelectableIds=ids; _tog();
    }).catch(function(e){ showToast('Could not select them all: '+((e&&e.message)||e),'error'); });
  };
  var _seq=window.leadStartSequence;
  window.leadStartSequence=function(){
    if(!store.use(STATE.user)||!_seq)return _seq&&_seq();
    var sel=STATE.leadSeqSel||{}, vis=STATE._leadSelVisibleIds||null;
    var ids=Object.keys(sel).filter(function(k){return sel[k]&&(!vis||vis.indexOf(k)>-1);});
    store.ensureLeads(ids).then(function(){ _seq(); }).catch(function(e){ showToast('Could not load the selected leads: '+((e&&e.message)||e),'error'); });
  };
})();

// A lead opened from somewhere other than the list (the inbox's lead card, a reminder, a link): fetch that one lead first, then open its window.
(function(){
  var store=window.leadsStore, _open=window.openJob;
  if(typeof _open!=='function')return;
  window.openJob=function(id){
    if(store.use(STATE.user)&&!store.byId(id)&&!store.isFull()){
      store.lead(id).then(function(l){ if(l)_open(id); else showToast('That lead is not on your list right now.','info'); });
      return;
    }
    return _open(id);
  };
})();
