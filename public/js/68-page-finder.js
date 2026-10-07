// ===== FIND LEADS — the Lead Finder (R-157, D-0087…D-0092) =====
// Steps 2 and 3 of the plan the owner approved:
//   2. a person saves a search (job titles, places, size, how recent); PACE asks Apollo for companies hiring for
//      those jobs — each morning, or on "Run now" — and turns each good one into a CARD.
//   3. Accept on a card opens ONE window: pick the job, find the person (title search is free), reveal up to three
//      emails (a credit each), Save. Only Save writes a lead. Wait and Reject write nothing but a small mark.
// Every rule lives on the server (routes/finder.js); this file only asks and shows. Nothing is filtered here.

(function () {

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function lines(v){ return String(v||'').split(/[,\n;]+/).map(function(x){ return x.trim(); }).filter(Boolean); }
  function plural(n, one, many){ return n+' '+(n===1?one:(many||one+'s')); }
  function fmtDay(s){ if(!s)return ''; try{ var d=new Date(String(s).slice(0,10)+'T12:00:00'); return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return ''; } }

  var F = STATE.finder = STATE.finder || {
    tab:'cards', access:null, accessFor:null, accessLoading:false,
    cards:null, waiting:0, daily:0, today:0, loading:false,
    searches:null, form:null, running:false,
    admin:null, diag:null, diagBusy:false,
    acc:null
  };

  // ── who sees the menu item ────────────────────────────────────────────────
  // The sidebar asks this on every render; the answer is fetched once per person.
  window.finderEnabled = function(){ return !!(F.access && F.access.enabled); };
  window.finderEnsureAccess = function(){
    var uid = STATE.user && STATE.user.id; if(!uid) return;
    if (F.accessFor !== uid){ F.access=null; F.accessFor=uid; F.accessLoading=false; F.cards=null; F.searches=null; F.admin=null; }
    if (F.access || F.accessLoading) return;
    F.accessLoading = true;
    apiGet('/finder/access').then(function(r){
      F.access = r || { enabled:false }; F.accessLoading=false;
      if (F.access.enabled) render();
    }).catch(function(){ F.access = { enabled:false }; F.accessLoading=false; });
  };

  // ── routing ───────────────────────────────────────────────────────────────
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p==='finder'){
      STATE.page='finder'; STATE.modal=null; render();
      loadAccess(function(){ loadCards(); loadSearches(); });
      return;
    }
    return _prevGoPage.apply(this, arguments);
  };
  // A repaint first keeps what the person has typed into the form — unless the caller has just changed the form itself
  // (skipCapture), in which case reading the old screen back would undo that change.
  function paint(skipCapture){ if(STATE.page!=='finder')return; if(!skipCapture) captureForm(); paintPageContent(); }
  UI.registerPage('finder', function(){ return renderPage(); });

  // ── data ──────────────────────────────────────────────────────────────────
  function loadAccess(then){
    apiGet('/finder/access').then(function(r){ F.access=r||{enabled:false}; F.accessFor=STATE.user&&STATE.user.id; paint(); if(then) then(); })
      .catch(function(e){ showToast('Could not load: '+e.message,'error'); });
  }
  function loadCards(){
    F.loading = true; paint();
    apiGet('/finder/cards').then(function(r){
      F.loading=false; F.cards=((r&&r.cards)||[]).map(function(c){ c._base=(c.chips||[]).slice(); return c; });
      F.waiting=(r&&r.waiting)||0; F.daily=(r&&r.daily)||0; F.today=(r&&r.today)||0; paint();
    }).catch(function(e){ F.loading=false; F.cards=F.cards||[]; showToast('Could not load cards: '+e.message,'error'); paint(); });
  }
  function loadSearches(){
    apiGet('/finder/searches').then(function(r){ F.searches=(r&&r.searches)||[]; paint(); })
      .catch(function(e){ F.searches=F.searches||[]; showToast('Could not load searches: '+e.message,'error'); paint(); });
  }
  function loadAdmin(){
    apiGet('/finder/admin/users').then(function(r){ F.admin=r||{users:[]}; paint(); })
      .catch(function(e){ F.admin={users:[]}; showToast('Could not load: '+e.message,'error'); paint(); });
  }

  window.fdTab = function(t){
    captureForm(); F.tab=t; paint();
    if (t==='admin' && !F.admin) loadAdmin();
  };

  // ── running searches ──────────────────────────────────────────────────────
  window.fdRun = function(id){
    if (F.running) return;
    F.running = id || 'all'; paint();
    apiPost(id ? '/finder/searches/'+id+'/run' : '/finder/run', {}).then(function(r){
      F.running=false;
      var res=(r&&r.results)||[];
      var note=res.map(function(x){ return (res.length>1?x.name+': ':'')+x.note; }).join('  ');
      showToast(note || 'Done', (r&&r.new_cards)?'success':'info');
      if (r && r.credits && F.access) F.access.credits = r.credits;
      F.tab = (r && r.new_cards) ? 'cards' : F.tab;
      loadCards(); loadSearches();
    }).catch(function(e){ F.running=false; showToast(e.message,'error'); paint(); });
  };

  // ── cards: wait / reject / postings ──────────────────────────────────────
  function dropCard(id){ F.cards=(F.cards||[]).filter(function(c){ return c.id!==id; }); }
  window.fdReject = function(id, btn){
    if (btn){ btn.disabled=true; }
    apiPost('/finder/cards/'+id+'/reject', {}).then(function(){ dropCard(id); showToast('Turned down — you will not be shown this company again','info'); paint(); })
      .catch(function(e){ showToast(e.message,'error'); if(btn)btn.disabled=false; });
  };
  window.fdWait = function(id, btn){
    if (btn){ btn.disabled=true; }
    apiPost('/finder/cards/'+id+'/wait', {}).then(function(r){
      dropCard(id); F.waiting=(F.waiting||0)+1;
      showToast('Parked — it comes back on '+fmtDay(r&&r.wait_until),'info'); paint();
    }).catch(function(e){ showToast(e.message,'error'); if(btn)btn.disabled=false; });
  };
  window.fdPostings = function(id, btn){
    if (btn){ btn.disabled=true; btn.textContent='Opening…'; }
    apiPost('/finder/cards/'+id+'/postings', {}).then(function(r){
      var c=(F.cards||[]).find(function(x){ return x.id===id; });
      if (c){ c.postings=r.postings||[]; c.chips=(c._base||[]).concat((r.signals&&r.signals.chips)||[]); }
      if (r.credits && F.access) F.access.credits=r.credits;
      if (F.acc && F.acc.card && F.acc.card.id===id){ F.acc.card.postings=c&&c.postings; paintAccept(); }
      paint();
    }).catch(function(e){ showToast(e.message,'error'); if(btn){btn.disabled=false;btn.textContent='See their open jobs · 1 credit';} });
  };

  // ── ACCEPT: the one window (step 3) ──────────────────────────────────────
  window.fdAccept = function(id){
    var c=(F.cards||[]).find(function(x){ return x.id===id; }); if(!c) return;
    if (c.decision && c.decision.blocked){ showToast(c.decision.sentence,'error'); return; }       // the server enforces it too
    F.acc = { card:c, jobs:[], jobQ:'', writeEmail:((F.access&&F.access.goes_to)==='you'), titleQ:'', people:null, picked:{}, manual:[], busy:false, finding:false, revealing:null, err:'' };
    paintAccept();
  };
  window.fdCloseAccept = function(){ F.acc=null; STATE.modal=null; render(); };
  function captureAcc(){
    var a=F.acc; if(!a) return;
    var el;
    if ((el=document.getElementById('fd-position'))) a.jobQ=el.value;
    if ((el=document.getElementById('fd-titleq'))) a.titleQ=el.value;
    var m={}; ['first','last','email','title'].forEach(function(k){ var e=document.getElementById('fd-m-'+k); if(e) m[k]=e.value; });
    if (Object.keys(m).length) a.mdraft=m;
  }
  function paintAccept(skipCapture){ if(!skipCapture) captureAcc(); STATE.modal = F.acc ? renderAcceptModal() : null; render(); }

  function pickedCount(a){ return Object.keys(a.picked).filter(function(k){ return a.picked[k]; }).length + a.manual.length; }
  window.fdFindPeople = function(){
    var a=F.acc; if(!a||a.finding) return; captureAcc();
    a.finding=true; a.err=''; paintAccept();
    apiPost('/finder/cards/'+a.card.id+'/people', { title:a.titleQ }).then(function(r){
      a.finding=false;
      // A new search ADDS to the list: anybody already paid for or ticked stays, at the top (their credit and their tick are not lost).
      var fresh=(r&&r.people)||[], keep=(a.people||[]).filter(function(p){ return p.revealed || a.picked[p.id]; });
      var have={}; keep.forEach(function(p){ have[p.id]=true; });
      var added=fresh.filter(function(p){ return !have[p.id]; });
      a.people=keep.concat(added);
      if(!added.length) a.err = fresh.length ? 'Nobody new with those titles — the people already shown are the ones Apollo has.' : 'Nobody with those titles at this company. Try other titles — or add someone by hand below.';
      paintAccept();
    }).catch(function(e){ a.finding=false; a.err=e.message; paintAccept(); });
  };
  window.fdReveal = function(personId){
    var a=F.acc; if(!a||a.revealing) return; captureAcc();
    a.revealing=personId; a.err=''; paintAccept();
    apiPost('/finder/cards/'+a.card.id+'/reveal', { person_id:personId }).then(function(r){
      a.revealing=null;
      var p=(a.people||[]).find(function(x){ return x.id===personId; });
      var person=(r&&r.person)||{};
      if (p){ p.revealed=true; p.email=person.email||null; if(person.last_name) p.last_name=person.last_name; if(person.title) p.title=person.title; }
      if (person.email && pickedCount(a)<3) a.picked[personId]=true;
      if (r && r.credits && F.access) F.access.credits=r.credits;
      if (F.access && F.access.reveals) F.access.reveals.used=(F.access.reveals.used||0)+1;
      if (r && r.note) a.err=r.note;
      paintAccept();
    }).catch(function(e){ a.revealing=null; a.err=e.message; paintAccept(); });
  };
  window.fdPick = function(personId){
    var a=F.acc; if(!a) return; captureAcc();
    if (!a.picked[personId] && pickedCount(a)>=3){ a.err='Three contacts is the most one lead can carry.'; paintAccept(true); return; }
    a.picked[personId]=!a.picked[personId]; a.err=''; paintAccept(true);
  };
  window.fdAddManual = function(){
    var a=F.acc; if(!a) return; captureAcc();
    var m=a.mdraft||{};
    if (!m.first || !m.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email.trim())){ a.err='A contact added by hand needs a first name and a valid email.'; paintAccept(true); return; }
    if (pickedCount(a)>=3){ a.err='Three contacts is the most one lead can carry.'; paintAccept(true); return; }
    a.manual.push({ first_name:m.first.trim(), last_name:(m.last||'').trim(), designation:(m.title||'').trim(), email:m.email.trim() });
    a.mdraft=null; a.err=''; paintAccept();
  };
  window.fdDropManual = function(i){ var a=F.acc; if(!a) return; captureAcc(); a.manual.splice(i,1); paintAccept(true); };
  // Jobs: tick as many as the lead is for (up to 5). The first is the lead's main job; the rest are saved on it as "also hiring".
  window.fdToggleJob = function(t){
    var a=F.acc; if(!a) return; captureAcc();
    var i=a.jobs.indexOf(t);
    if (i>=0) a.jobs.splice(i,1);
    else if (a.jobs.length>=5){ a.err='Five jobs is the most one lead can carry.'; paintAccept(true); return; }
    else a.jobs.push(t);
    a.err=''; paintAccept(true);
  };
  window.fdAddJob = function(){
    var a=F.acc; if(!a) return; captureAcc();
    var t=String(a.jobQ||'').trim();
    if (!t) return;
    if (a.jobs.some(function(x){ return x.toLowerCase()===t.toLowerCase(); })){ a.jobQ=''; paintAccept(true); return; }
    if (a.jobs.length>=5){ a.err='Five jobs is the most one lead can carry.'; paintAccept(true); return; }
    a.jobs.push(t); a.jobQ=''; a.err=''; paintAccept(true);
  };
  window.fdToggleWrite = function(){ var a=F.acc; if(!a) return; captureAcc(); a.writeEmail=!a.writeEmail; paintAccept(true); };
  function jobsToSave(a){
    var out=a.jobs.slice(), q=String(a.jobQ||'').trim();
    if (q && !out.some(function(x){ return x.toLowerCase()===q.toLowerCase(); }) && out.length<5) out.push(q);
    return out;
  }
  window.fdSave = function(){
    var a=F.acc; if(!a||a.busy) return; captureAcc();
    var contacts=[];
    Object.keys(a.picked).forEach(function(k){ if(a.picked[k]) contacts.push({ person_id:k }); });
    a.manual.forEach(function(m){ contacts.push(m); });
    var jobs=jobsToSave(a);
    if (!jobs.length){ a.err='Pick the job this lead is for.'; paintAccept(); return; }
    if (!contacts.length){ a.err='Pick at least one contact with an email, so the lead can be emailed.'; paintAccept(); return; }
    a.busy=true; a.err=''; paintAccept();
    apiPost('/finder/cards/'+a.card.id+'/accept', { positions:jobs, contacts:contacts }).then(function(r){
      var id=a.card.id, wantEmail=!!a.writeEmail; F.acc=null; STATE.modal=null; dropCard(id);
      showToast(r&&r.goes_to==='you' ? 'Lead saved — it is yours, in Leads' : 'Lead saved — it is in the Unassigned pool','success');
      render(); loadAccess();
      if (typeof refreshJobs==='function') refreshJobs();           // the new lead shows in Leads without a manual refresh
      // The explicit next step Take-leads and Import already use: the first email is WRITTEN into Pending for the person to read.
      // Nothing is sent here — a person presses Send.
      if (wantEmail && r && r.goes_to==='you' && r.lead_id){
        apiPost('/emails/generate',{ job_ids:[r.lead_id] }).then(function(g){
          var n=(g&&g.generated)||0;
          showToast(n?'First email written — read it in Email → Pending, then send':'The lead is saved, but no email could be written (check the contact\'s address)', n?'success':'warning');
        }).catch(function(e){ showToast('The lead is saved, but the email could not be written: '+((e&&e.message)||e),'warning'); });
      }
    }).catch(function(e){ a.busy=false; a.err=e.message; paintAccept(); });
  };

  function decisionBox(d){
    if(!d) return '';
    if(d.blocked) return '<div class="ld-box is-stop" role="alert"><strong>Cannot add this company right now</strong>'+esc(d.sentence)+'</div>';
    return '';
  }

  function renderAcceptModal(){
    var a=F.acc; if(!a) return '';
    var c=a.card, goes=(F.access&&F.access.goes_to)==='you';
    var posts=c.postings||[];
    var titles=[]; posts.forEach(function(p){ if(titles.indexOf(p.title)<0) titles.push(p.title); });

    var union=titles.slice(); a.jobs.forEach(function(j){ if(union.indexOf(j)<0) union.push(j); });
    var jobPart =
      '<div class="fd-label">1 · Which jobs is this lead for? <span class="fd-hint">tick one or more — the first is the main job</span></div>'+
      (union.length
        ? '<div class="fd-pills">'+union.slice(0,14).map(function(t){ var n=a.jobs.indexOf(t); return '<button class="fd-pill'+(n>=0?' on':'')+'" onclick="fdToggleJob(\''+esc(t.replace(/\\/g,'\\\\').replace(/'/g,"\\'"))+'\')">'+(n>=0?(n+1)+' · ':'')+esc(t)+'</button>'; }).join('')+'</div>'
        : '<div class="fd-hint">Open their jobs on the card to pick from a list, or type one below.</div>')+
      '<div class="fd-row"><input id="fd-position" class="inp fd-grow" placeholder="Or type a job, e.g. CNC Machinist" value="'+esc(a.jobQ)+'" onkeydown="if(event.key===\'Enter\'){fdAddJob()}">'+
        '<button class="btn btn-sm btn-outline" onclick="fdAddJob()">Add</button></div>'+
      (a.jobs.length>1?'<div class="fd-hint">The other jobs are saved on the lead as “also hiring” — no extra credit, they are already on the card.</div>':'');

    var rows = (a.people||[]).map(function(p){
      var name=esc(p.first_name+' '+(p.last_name||p.last_name_hint||''));
      var right;
      if (p.revealed && p.email) right='<label class="fd-use"><input type="checkbox" '+(a.picked[p.id]?'checked':'')+' onclick="fdPick(\''+esc(p.id)+'\')"> Use</label>';
      else if (p.revealed) right='<span class="fd-hint">No verified email</span>';
      else right='<button class="btn btn-sm btn-outline" '+(a.revealing?'disabled':'')+' onclick="fdReveal(\''+esc(p.id)+'\')">'+(a.revealing===p.id?'Getting…':'Get email · 1 credit')+'</button>';
      return '<div class="fd-person"><div class="fd-person-main"><strong>'+name+'</strong>'+
        '<span class="fd-hint">'+esc(p.title||'')+(p.revealed&&p.email?' · '+esc(p.email):'')+'</span></div>'+right+'</div>';
    }).join('');

    var manualRows = a.manual.map(function(m,i){
      return '<div class="fd-person"><div class="fd-person-main"><strong>'+esc(m.first_name+' '+m.last_name)+'</strong><span class="fd-hint">'+esc(m.designation||'')+' · '+esc(m.email)+' · added by hand</span></div>'+
        '<button class="btn btn-sm btn-outline" onclick="fdDropManual('+i+')">Remove</button></div>';
    }).join('');
    var md=a.mdraft||{};

    var peoplePart =
      '<div class="fd-label">2 · Who should we write to? <span class="fd-hint">up to 3 · '+pickedCount(a)+' chosen</span></div>'+
      '<div class="fd-row"><input id="fd-titleq" class="inp fd-grow" placeholder="Job titles, e.g. HR Manager, Plant Manager (blank = the usual suspects)" value="'+esc(a.titleQ)+'" onkeydown="if(event.key===\'Enter\'){fdFindPeople()}">'+
        '<button class="btn btn-sm btn-primary" '+(a.finding?'disabled':'')+' onclick="fdFindPeople()">'+(a.finding?'Looking…':'Find people')+'</button></div>'+
      '<div class="fd-hint">Finding people is free. An email costs 1 credit, and only a verified address is kept.</div>'+
      rows+manualRows+
      '<details class="fd-manual"'+(a.mdraft?' open':'')+'><summary>Add someone by hand</summary>'+
        '<div class="fd-grid"><input id="fd-m-first" class="inp" placeholder="First name" value="'+esc(md.first||'')+'"><input id="fd-m-last" class="inp" placeholder="Last name" value="'+esc(md.last||'')+'">'+
        '<input id="fd-m-email" class="inp" placeholder="Email" value="'+esc(md.email||'')+'"><input id="fd-m-title" class="inp" placeholder="Job title" value="'+esc(md.title||'')+'"></div>'+
        '<button class="btn btn-sm btn-outline" onclick="fdAddManual()">Add this person</button></details>';

    var where = '<div class="ld-box is-info"><strong>Where it goes</strong>'+(goes
      ? 'Straight to you, in Leads, sending from one of your connected mailboxes.'+
        '<label class="fd-use fd-block"><input type="checkbox" '+(a.writeEmail?'checked':'')+' onclick="fdToggleWrite()"> Write the first email now — it waits in Email → Pending for you to read. Nothing is sent until you press Send.</label>'
      : 'Into the Unassigned pool, where your lead hands it out. Nothing is emailed now.')+'</div>';

    var can = !a.busy && jobsToSave(a).length>0 && pickedCount(a)>0 && !(c.decision&&c.decision.blocked);

    return '<div class="modal modal-w720" onclick="event.stopPropagation()">'+
      '<div class="fs-16 fd-mhead">Add '+esc(c.company_name)+' as a lead</div>'+
      '<div class="fd-mbody">'+decisionBox(c.decision)+jobPart+peoplePart+
        (a.err?'<div class="ld-box is-stop" role="alert">'+esc(a.err)+'</div>':'')+where+
      '</div>'+
      '<div class="fd-mfoot"><button class="btn btn-outline" onclick="fdCloseAccept()">Cancel</button>'+
        '<button class="btn btn-primary" '+(can?'':'disabled')+' onclick="fdSave()">'+(a.busy?'Saving…':'Save lead')+'</button></div>'+
    '</div>';
  }

  // ── saved searches ───────────────────────────────────────────────────────
  function blankForm(){ return { id:null, name:'', sector:'', titles:'', locations:'', sizes:[], posted_days:14, keywords:'', domains:'' }; }
  function formFrom(s){
    return { id:s.id, name:s.name, sector:s.sector||'', titles:(s.titles||[]).join(', '), locations:(s.locations||[]).join(', '),
             sizes:(s.sizes||[]).slice(), posted_days:s.posted_days||14, keywords:(s.keywords||[]).join(', '), domains:(s.domains||[]).join(', ') };
  }
  function captureForm(){
    var f=F.form; if(!f) return;
    var g=function(id){ var e=document.getElementById(id); return e?e.value:null; };
    var v;
    if ((v=g('fd-f-name'))!==null) f.name=v;
    if ((v=g('fd-f-titles'))!==null) f.titles=v;
    if ((v=g('fd-f-locations'))!==null) f.locations=v;
    if ((v=g('fd-f-keywords'))!==null) f.keywords=v;
    if ((v=g('fd-f-domains'))!==null) f.domains=v;
    if ((v=g('fd-f-posted'))!==null) f.posted_days=Number(v)||14;
    if ((v=g('fd-f-sector'))!==null) f.sector=v;
    var boxes=document.querySelectorAll('.fd-size-box');
    if (boxes.length){ f.sizes=[]; Array.prototype.forEach.call(boxes,function(b){ if(b.checked) f.sizes.push(b.value); }); }
  }
  window.fdNewSearch = function(){ F.form=blankForm(); F.tab='searches'; paint(true); };
  window.fdEditSearch = function(id){ var s=(F.searches||[]).find(function(x){ return x.id===id; }); if(!s) return; F.form=formFrom(s); F.tab='searches'; paint(true); };
  window.fdCancelForm = function(){ F.form=null; paint(true); };
  window.fdPickSector = function(v){
    captureForm(); var f=F.form; if(!f) return;
    f.sector=v;
    var sec=((F.access&&F.access.sectors)||[]).find(function(x){ return x.id===v; });
    if (sec){ if(!String(f.titles).trim()) f.titles=sec.titles.join(', '); if(!String(f.name).trim()) f.name=sec.label; }
    paint(true);
  };
  window.fdSaveSearch = function(){
    captureForm(); var f=F.form; if(!f) return;
    var body={ name:f.name.trim(), sector:f.sector||null, titles:lines(f.titles), locations:lines(f.locations), sizes:f.sizes, posted_days:f.posted_days, keywords:lines(f.keywords), domains:lines(f.domains) };
    var req = f.id ? apiPut('/finder/searches/'+f.id, body) : apiPost('/finder/searches', body);
    req.then(function(){ var edited=!!f.id; F.form=null; showToast(edited?'Search updated':'Search saved — it runs every morning, or press Run now','success'); loadSearches(); })
      .catch(function(e){ showToast(e.message,'error'); });
  };
  window.fdToggleSearch = function(id){
    var s=(F.searches||[]).find(function(x){ return x.id===id; }); if(!s) return;
    var body=formFrom(s); body.titles=lines(body.titles); body.locations=lines(body.locations); body.keywords=lines(body.keywords); body.domains=lines(body.domains);
    body.active = s.active===false; body.sector=s.sector||null;
    apiPut('/finder/searches/'+id, body).then(function(){ showToast(body.active?'Search resumed':'Search paused — it will not run each morning','info'); loadSearches(); })
      .catch(function(e){ showToast(e.message,'error'); });
  };
  window.fdDeleteSearch = function(id){
    if (!confirm('Delete this saved search? Cards it already made stay.')) return;
    apiDelete('/finder/searches/'+id).then(function(){ showToast('Search deleted','info'); loadSearches(); }).catch(function(e){ showToast(e.message,'error'); });
  };

  function renderForm(){
    var f=F.form, acc=F.access||{};
    var sectors=(acc.sectors||[]).map(function(s){ return '<option value="'+esc(s.id)+'"'+(f.sector===s.id?' selected':'')+'>'+esc(s.label)+'</option>'; }).join('');
    var sizes=(acc.sizes||[]).map(function(b){ return '<label class="fd-use"><input type="checkbox" class="fd-size-box" value="'+esc(b.id)+'" '+(f.sizes.indexOf(b.id)>=0?'checked':'')+'> '+esc(b.label)+'</label>'; }).join('');
    var posted=(acc.posted||[7,14,30]).map(function(d){ return '<option value="'+d+'"'+(f.posted_days===d?' selected':'')+'>last '+d+' days</option>'; }).join('');
    return '<div class="card fd-form">'+
      '<div class="fs-14 fd-strong">'+(f.id?'Edit this search':'New search')+'</div>'+
      '<div class="fd-grid">'+
        '<div><div class="fd-label">Name</div><input id="fd-f-name" class="inp fd-wide" placeholder="e.g. Texas machine shops" value="'+esc(f.name)+'"></div>'+
        '<div><div class="fd-label">Start from an industry (optional)</div><select id="fd-f-sector" class="sel fd-wide" onchange="fdPickSector(this.value)"><option value="">— pick to fill in titles —</option>'+sectors+'</select></div>'+
      '</div>'+
      '<div class="fd-label">Job titles they are hiring for</div>'+
      '<textarea id="fd-f-titles" class="inp fd-wide" rows="2" placeholder="Separate with commas, e.g. CNC Machinist, Welder">'+esc(f.titles)+'</textarea>'+
      '<div class="fd-grid">'+
        '<div><div class="fd-label">Where the job is</div><input id="fd-f-locations" class="inp fd-wide" placeholder="e.g. Texas, Austin TX, remote" value="'+esc(f.locations)+'"></div>'+
        '<div><div class="fd-label">Posted within</div><select id="fd-f-posted" class="sel fd-wide">'+posted+'</select></div>'+
      '</div>'+
      '<div class="fd-label">Company size <span class="fd-hint">(none ticked = any)</span></div><div class="fd-row">'+sizes+'</div>'+
      '<div class="fd-grid">'+
        '<div><div class="fd-label">Industry words (optional)</div><input id="fd-f-keywords" class="inp fd-wide" placeholder="e.g. machining, fabrication" value="'+esc(f.keywords)+'"></div>'+
        '<div><div class="fd-label">Only these company websites (optional)</div><input id="fd-f-domains" class="inp fd-wide" placeholder="e.g. acme.com, widgets.com" value="'+esc(f.domains)+'"></div>'+
      '</div>'+
      '<div class="fd-row fd-end"><button class="btn btn-outline" onclick="fdCancelForm()">Cancel</button><button class="btn btn-primary" onclick="fdSaveSearch()">'+(f.id?'Save changes':'Save search')+'</button></div>'+
    '</div>';
  }

  function summaryOf(s){
    var bits=[(s.titles||[]).slice(0,4).join(', ')+((s.titles||[]).length>4?'…':''), (s.locations||[]).join(', '), 'posted in the last '+s.posted_days+' days'];
    return bits.filter(Boolean).join(' · ');
  }
  function renderSearches(){
    if (F.form) return renderForm();
    var list=F.searches;
    if (!list) return '<div class="fd-empty">Loading…</div>';
    var head='<div class="fd-row fd-between"><div class="fd-hint">Your searches are yours alone. Each one runs every morning and brings its best companies to <strong>Today\'s cards</strong>.</div>'+
      '<button class="btn btn-primary btn-sm" onclick="fdNewSearch()">+ New search</button></div>';
    if (!list.length) return head+'<div class="card fd-empty">No saved searches yet.<br>A search says what jobs to look for and where — PACE then finds companies hiring for them.<br><button class="btn btn-primary" onclick="fdNewSearch()">Make your first search</button></div>';
    return head+list.map(function(s){
      return '<div class="card fd-card"><div class="fd-row fd-between"><div class="fd-grow">'+
        '<div class="fs-14 fd-strong">'+esc(s.name)+(s.active===false?' <span class="fd-tag">paused</span>':'')+'</div>'+
        '<div class="fs-12_5 c-text2">'+esc(summaryOf(s))+'</div>'+
        '<div class="fs-12 c-text3">'+(s.last_run_at?'Last ran '+esc(fmtDay(s.last_run_at))+' — '+esc(s.last_run_note||''):'Has not run yet.')+'</div></div>'+
        '<div class="fd-row"><button class="btn btn-sm btn-primary" '+(F.running?'disabled':'')+' onclick="fdRun(\''+s.id+'\')">'+((F.running===s.id||F.running==='all')?'Running…':'Run now')+'</button>'+
        '<button class="btn btn-sm btn-outline" onclick="fdEditSearch(\''+s.id+'\')">Edit</button>'+
        '<button class="btn btn-sm btn-outline" onclick="fdToggleSearch(\''+s.id+'\')">'+(s.active===false?'Resume':'Pause')+'</button>'+
        '<button class="btn btn-sm btn-outline" onclick="fdDeleteSearch(\''+s.id+'\')">Delete</button></div></div></div>';
    }).join('');
  }

  // ── today's cards ────────────────────────────────────────────────────────
  function renderCard(c){
    var blocked=c.decision&&c.decision.blocked;
    var place=[c.city,c.state].filter(Boolean).join(', ');
    var facts=[place, c.employees?plural(c.employees,'employee'):'', c.revenue||''].filter(Boolean).join(' · ');
    var links=[c.website?'<a href="'+esc(/^https?:/i.test(c.website)?c.website:'https://'+c.website)+'" target="_blank" rel="noopener">'+esc(c.domain||c.website)+'</a>':'',
               c.linkedin_url?'<a href="'+esc(c.linkedin_url)+'" target="_blank" rel="noopener">LinkedIn</a>':'', c.phone?esc(c.phone):''].filter(Boolean).join(' · ');
    var chips=(c.chips||[]).map(function(x){ return '<span class="fd-chip">'+esc(x)+'</span>'; }).join('');
    var posts=c.postings;
    var postBlock = posts
      ? '<div class="fd-posts">'+(posts.length?posts.slice(0,8).map(function(p){
          return '<div>• '+(p.url?'<a href="'+esc(p.url)+'" target="_blank" rel="noopener">'+esc(p.title)+'</a>':esc(p.title))+
            '<span class="fd-hint"> '+esc([[p.city,p.state].filter(Boolean).join(', '), p.age_days!=null?p.age_days+'d ago':'', p.source].filter(Boolean).join(' · '))+'</span></div>';
        }).join(''):'<span class="fd-hint">Apollo lists no open jobs for this company right now.</span>')+'</div>'
      : '<button class="btn btn-sm btn-outline" onclick="fdPostings(\''+c.id+'\',this)">See their open jobs · 1 credit</button>';
    return '<div class="card fd-card'+(blocked?' is-blocked':'')+'">'+
      '<div class="fd-row fd-between"><div class="fd-grow">'+
        '<div class="fs-15 fd-strong">'+esc(c.company_name)+'</div>'+
        (facts?'<div class="fs-12_5 c-text2">'+esc(facts)+'</div>':'')+
        (links?'<div class="fs-12_5">'+links+'</div>':'')+
      '</div></div>'+
      (chips?'<div class="fd-pills">'+chips+'</div>':'')+
      (c.search&&(c.search.titles||[]).length?'<div class="fs-12 c-text3">Found for: '+esc(c.search.titles.slice(0,3).join(', '))+(c.search.locations&&c.search.locations.length?' in '+esc(c.search.locations.slice(0,2).join(', ')):'')+'</div>':'')+
      decisionBox(c.decision)+
      '<div class="fd-row fd-between">'+postBlock+
        '<div class="fd-row"><button class="btn btn-sm btn-outline" onclick="fdReject(\''+c.id+'\',this)">Reject</button>'+
          '<button class="btn btn-sm btn-outline" onclick="fdWait(\''+c.id+'\',this)" title="Hide it for '+esc(String((F.access&&F.access.wait_days)||14))+' days, then show it again">Wait '+esc(String((F.access&&F.access.wait_days)||14))+' days</button>'+
          '<button class="btn btn-sm btn-primary" '+(blocked?'disabled title="This company cannot be added right now — see the reason above"':'')+' onclick="fdAccept(\''+c.id+'\')">Accept</button></div></div>'+
    '</div>';
  }
  function renderCards(){
    if (F.loading && !F.cards) return '<div class="fd-empty">Loading…</div>';
    var list=F.cards||[];
    if (!list.length){
      var noSearch = F.searches && !F.searches.length;
      return '<div class="card fd-empty">'+(noSearch
        ? 'Nothing to review yet — you have not saved a search.<br><button class="btn btn-primary" onclick="fdNewSearch()">Make a search</button>'
        : 'Nothing to review right now.<br>Your searches run each morning. To look now, press <strong>Run my searches</strong>.')+'</div>';
    }
    // Which search found each card: a row of choices appears when more than one search has cards (a view only —
    // the server already gave this person only their own cards).
    var names={}; (F.searches||[]).forEach(function(x){ names[x.id]=x.name; });
    var counts={}; list.forEach(function(c){ var k=c.search_id||''; counts[k]=(counts[k]||0)+1; });
    var keys=Object.keys(counts);
    var sel=(F.cardSearch && counts[F.cardSearch]) ? F.cardSearch : '';
    var bar = keys.length>1
      ? '<div class="fd-pills"><button class="fd-pill'+(sel===''?' on':'')+'" onclick="fdFilterCards(\'\')">All · '+list.length+'</button>'+
        keys.map(function(k){ return '<button class="fd-pill'+(sel===k?' on':'')+'" onclick="fdFilterCards(\''+esc(k)+'\')">'+esc(names[k]||'Earlier search')+' · '+counts[k]+'</button>'; }).join('')+'</div>'
      : '';
    return bar+list.filter(function(c){ return !sel || (c.search_id||'')===sel; }).map(renderCard).join('');
  }
  window.fdFilterCards = function(id){ F.cardSearch=id||''; paint(); };

  // ── admin: who may use it, and Apollo's reach ────────────────────────────
  window.fdAdminSave = function(id){
    var on=document.getElementById('fd-on-'+id), n=document.getElementById('fd-n-'+id);
    apiPut('/finder/admin/users/'+id, { enabled:!!(on&&on.checked), daily:(n&&String(n.value).trim()!=='')?Number(n.value):null }).then(function(){
      showToast('Saved','success'); loadAdmin();
    }).catch(function(e){ showToast(e.message,'error'); });
  };
  window.fdDiagnose = function(){
    if (F.diagBusy) return;
    if (!confirm('This tests Apollo with three tiny searches and uses about 2 of your credits. Go ahead?')) return;
    F.diagBusy=true; F.diag=null; paint();
    apiGet('/finder/diagnose').then(function(r){ F.diagBusy=false; F.diag=r; if(r&&r.credits&&F.access) F.access.credits={ used:r.credits.used, limit:r.credits.limit }; paint(); })
      .catch(function(e){ F.diagBusy=false; F.diag={ checks:[{ ok:false, text:e.message }] }; paint(); });
  };
  function renderAdmin(){
    var a=F.admin, acc=F.access||{};
    var diag = F.diag ? '<div class="fd-diag">'+(F.diag.checks||[]).map(function(c){ return '<div class="'+(c.ok?'c-green':'c-red')+'">'+(c.ok?'✓ ':'✗ ')+esc(c.text)+'</div>'; }).join('')+'</div>' : '';
    var users = !a ? '<div class="fd-empty">Loading…</div>' : (a.users||[]).map(function(u){
      return '<div class="fd-person"><div class="fd-person-main"><strong>'+esc(u.name||u.email)+'</strong><span class="fd-hint">'+esc(u.roles.join(', '))+'</span></div>'+
        '<div class="fd-row"><label class="fd-use"><input type="checkbox" id="fd-on-'+u.id+'" '+(u.enabled?'checked':'')+'> May use it</label>'+
        '<input id="fd-n-'+u.id+'" class="inp fd-num" type="number" min="0" max="500" placeholder="'+a.default_daily+'" value="'+(u.daily!=null?u.daily:'')+'" title="Cards a day (empty = '+a.default_daily+')"> <span class="fd-hint">cards/day</span>'+
        '<button class="btn btn-sm btn-primary" onclick="fdAdminSave(\''+u.id+'\')">Save</button></div></div>';
    }).join('');
    return '<div class="card fd-form"><div class="fs-14 fd-strong">Apollo</div>'+
      '<div class="fs-12_5 c-text2">'+(acc.apollo&&acc.apollo.connected?'An Apollo key is saved.':'<span class="c-red">Apollo is not connected.</span> Add its key in Admin → Integrations.')+
      ' Today: '+esc(String(acc.credits?acc.credits.used:0))+' of '+esc(String(acc.credits?acc.credits.limit:0))+' credits used by your organisation. The daily limits and the wait time are under Admin → Settings → Lead Finder.</div>'+
      '<div class="fd-row"><button class="btn btn-sm btn-outline" '+(F.diagBusy?'disabled':'')+' onclick="fdDiagnose()">'+(F.diagBusy?'Checking…':'Check what my Apollo key can do (about 2 credits)')+'</button></div>'+diag+'</div>'+
      '<div class="fs-14 fd-strong fd-pad">Who may use Find Leads</div>'+
      '<div class="fd-hint">Admins always can. Everyone else needs to be switched on here. Leave “cards/day” empty to use the organisation\'s number'+(a?' ('+a.default_daily+')':'')+'.</div>'+users;
  }

  // ── the page ─────────────────────────────────────────────────────────────
  function renderPage(){
    var acc=F.access;
    if (!acc) return UI.page({ body:'<div class="fd-empty">Loading…</div>' });
    if (!acc.enabled) return UI.page({ body:'<div class="card fd-empty">Find Leads is not switched on for you yet.<br>Ask an admin to turn it on.</div>' });
    var tabs=[
      { id:'cards', label:'Today\'s cards', n:(F.cards||[]).length, onclick:"fdTab('cards')" },
      { id:'searches', label:'My searches', onclick:"fdTab('searches')" }
    ];
    if (acc.is_admin) tabs.push({ id:'admin', label:'Access & Apollo', onclick:"fdTab('admin')" });
    var right='<span class="fs-12 c-ink3">Companies hiring for the jobs you search for. Nothing becomes a lead until you press Accept and Save.</span>';
    var strip=UI.strip([
      { v:(F.cards||[]).length, label:'To review', on:F.tab==='cards', onclick:"fdTab('cards')" },
      { v:F.waiting||0, label:'Waiting', on:false },
      { v:(acc.credits?acc.credits.used:0)+'/'+(acc.credits?acc.credits.limit:0), label:'Apollo credits today', on:false },
      { v:(acc.reveals?acc.reveals.used:0)+'/'+(acc.reveals?acc.reveals.limit:0), label:'Emails revealed', on:false }
    ]);
    var toolbar = F.tab==='cards'
      ? '<div class="fd-row fd-between fd-toolbar"><span class="fd-hint">'+esc(String(F.today||0))+' of your '+esc(String(F.daily||acc.daily||0))+' cards for today.</span>'+
        '<button class="btn btn-sm btn-primary" '+(F.running?'disabled':'')+' onclick="fdRun()">'+(F.running==='all'?'Searching…':'Run my searches')+'</button></div>'
      : '';
    var body = F.tab==='admin' && acc.is_admin ? renderAdmin() : (F.tab==='searches' ? renderSearches() : renderCards());
    return UI.page({ tabs:UI.tabs(tabs, F.tab, right), strip:strip, body:toolbar+body });
  }

})();
