// ── EDIT A LEAD AFTER THE FACT (owner, 14 Oct) ───────────────────────────────────────────────────────────────────────
// "Even if that information is wrong they can edit it later" — for the manager and the lead RA, not the RA. An RA already has a
// 24-hour correction window on their own lead (raFormEdit); everyone above them had no way to fix a title, a "Found by" or a note.
// This is the window: the lead's own fields (title, place, where it was found, job link, pay, industry, notes). The company and its
// people are edited where they live (the company record, the contact rows) — this window says so.
//
// WHO: the same people the server lets save PUT /jobs/:id — admin and RA lead always; a BD / BD lead for a lead they own or that
// someone they manage owns. The button is only OFFERED to them (CLAUDE.md: a rule that decides whether an action is allowed lives
// where the action is offered) and the server still decides: a 403 is shown in words, never a silent no-op.
//
// What the server does with a wrong-field value on save is services/lead-fields.js (a paragraph in "Found by" goes to Notes, said
// out loud). The hint under a field is ADVISORY only — it tells the person before they press Save; the server is the rule.
// Typing never repaints the window; only a button does.
(function(){
  'use strict';
  var esc=function(t){ return htmlEsc(t==null?'':t); };
  var E=function(){ return STATE.leadEdit; };

  window.canEditLead=function(j){
    var u=STATE.user; if(!u||!j) return false;
    if(userHasAnyRole(u,'admin','ra_lead')) return true;
    if(!userHasAnyRole(u,'bd','bd_lead')||!j.assigned_to_bd) return false;
    if(j.assigned_to_bd===u.id) return true;
    var sub=(typeof reportingSubtree==='function'?reportingSubtree(u.id):[])||[];
    return sub.some(function(x){ return x.id===j.assigned_to_bd; });
  };

  // What a one-line field should never look like: a paragraph. (Advisory — the rule is on the server.)
  function looksLikeText(v){ v=String(v||'').trim(); return v.length>60||v.split(/\s+/).length>8||/[.!?]\s+[A-Z]/.test(v); }
  var HINTS={
    source:function(v){ return looksLikeText(v)?'This reads like a description, not where the lead was found. Save will move it to Notes — nothing is lost.':''; },
    job_url:function(v){ v=String(v||'').trim(); return v&&!/^(https?:\/\/|www\.)\S+$|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)?'This is not a web address. Save will move it to Notes.':''; }
  };

  window.openLeadEdit=function(id){
    var j=jobById(id);
    if(!j) return;
    if(!canEditLead(j)){ showToast('Only a manager or RA lead can edit a lead','warning'); return; }
    STATE.leadEdit={ id:id, company:j.company_name||'', busy:false, err:'',
      f:{ position:j.position||'', location:j.location||'', source:j.source||'', job_url:j.job_url||'', salary_range:j.salary_range||'', industry:j.industry||'', notes:j.notes||'' } };
    STATE.modal=draw(); render();
  };
  window.leadEditSet=function(k,v){
    var e=E(); if(!e) return; e.f[k]=v;
    var h=document.getElementById('le-hint-'+k);
    if(h&&HINTS[k]) h.textContent=HINTS[k](v);
  };
  window.leadEditClose=function(){ STATE.leadEdit=undefined; closeModal(); };
  window.leadEditSave=function(){
    var e=E(); if(!e||e.busy) return;
    if(!String(e.f.position||'').trim()){ e.err='A lead needs a job title.'; STATE.modal=draw(); render(); return; }
    e.busy=true; e.err=''; STATE.modal=draw(); render();
    apiPut('/jobs/'+encodeURIComponent(e.id),{
      position:e.f.position.trim(), location:e.f.location.trim(), source:e.f.source.trim(), job_url:e.f.job_url.trim(),
      salary_range:e.f.salary_range.trim(), industry:e.f.industry.trim(), notes:e.f.notes
    }).then(function(r){
      var say=r&&r.moved_sentence;
      STATE.leadEdit=undefined; closeModal();
      showToast(say||'Lead updated',say?'info':'success');
      Promise.resolve(typeof refreshJobs==='function'?refreshJobs():null).then(function(){ if(typeof rowRevealRefresh==='function') rowRevealRefresh(); });
    }).catch(function(err){ e.busy=false; e.err=(err&&err.message)||'Could not save'; STATE.modal=draw(); render(); });
  };

  function field(label,key,ph){
    var e=E(), v=e.f[key], hint=HINTS[key]?HINTS[key](v):'';
    return '<div class="fd-label">'+label+'</div>'+
      '<input id="le-'+key+'" class="inp fd-wide" value="'+escAttr(v)+'" placeholder="'+escAttr(ph||'')+'" oninput="leadEditSet(\''+key+'\',this.value)">'+
      (HINTS[key]?'<div id="le-hint-'+key+'" class="fs-12 c-text3" role="status">'+esc(hint)+'</div>':'');
  }
  function draw(){
    var e=E();
    var body=
      '<div class="fs-12_5 c-text3">'+(e.company?'At <b>'+esc(e.company)+'</b>. ':'')+'The company and the people on the lead are edited from their own places — this window changes the lead itself.</div>'+
      field('Job title','position')+
      field('Location','location','City, ST')+
      field('Found by','source','e.g. LinkedIn, Indeed, Referral')+
      field('Job link','job_url','https://…')+
      field('Pay','salary_range','e.g. $22 – $26 per hour')+
      field('Industry','industry')+
      '<div class="fd-label">Notes</div>'+
      '<textarea id="le-notes" class="inp fd-wide le-notes" rows="5" oninput="leadEditSet(\'notes\',this.value)">'+esc(e.f.notes)+'</textarea>'+
      (e.err?'<div class="c-red fs-13" role="alert">'+esc(e.err)+'</div>':'');
    var foot='<button class="btn btn-outline" onclick="leadEditClose()">Cancel</button>'+
      '<button class="btn btn-primary" id="le-save" '+(e.busy?'disabled ':'')+'onclick="leadEditSave()">'+(e.busy?'Saving…':'Save changes')+'</button>';
    return '<div class="modal modal-w480"><div class="mh"><div class="mt">Edit lead</div></div><div class="mb_">'+body+'</div><div class="mf">'+foot+'</div></div>';
  }
})();
