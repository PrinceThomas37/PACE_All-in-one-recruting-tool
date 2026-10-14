// ── EDIT A LEAD AFTER THE FACT (owner, 14 Oct) ───────────────────────────────────────────────────────────────────────
// "Even if that information is wrong they can edit it later" — for the manager and the lead RA, not the RA. An RA already has a
// 24-hour correction window on their own lead (raFormEdit); everyone above them had no way to fix a title, a "Found by" or a note.
// This is the window: the lead's own fields (title, place, where it was found, job link, pay, industry, notes). The company and its
// people are edited where they live (the company record, the contact rows) — this window says so.
//
// PEOPLE (14 Oct, owner: an RA lead may edit a lead's contacts "within 24 hours, which the admin set up in the admin panel"): the window
// also lists the people on the lead — name, title, email, phone — when GET /jobs/:id/edit-rights says the server would accept it (admin;
// the lead's owner; an RA lead for a lead their team made, inside the admin-set window — services/contact-edit-window.js). When the
// RA lead's window has closed it says so, and when. Only the people actually changed are sent (PUT /contacts/:id).
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
    var people=(STATE.contacts||[]).filter(function(c){ return c.job_id===id; }).sort(function(a,b){ return (b.is_primary?1:0)-(a.is_primary?1:0); })
      .map(function(c){ return { id:c.id, first_name:c.first_name||'', last_name:c.last_name||'', designation:c.designation||'', email:c.email||'', phone:c.phone||'' }; });
    var e=STATE.leadEdit={ id:id, company:j.company_name||'', busy:false, err:'', rights:null, people:people, orig:JSON.parse(JSON.stringify(people)),
      f:{ position:j.position||'', location:j.location||'', source:j.source||'', job_url:j.job_url||'', salary_range:j.salary_range||'', industry:j.industry||'', notes:j.notes||'' } };
    STATE.modal=draw(); render();
    // The People section waits for the server's answer — it is never drawn on a guess.
    apiGet('/jobs/'+encodeURIComponent(id)+'/edit-rights').then(function(r){
      if(STATE.leadEdit!==e) return; e.rights=r||{}; STATE.modal=draw(); render();
    }).catch(function(){ if(STATE.leadEdit===e) e.rights={ contacts:false }; });
  };
  window.leadEditPerson=function(i,k,v){ var e=E(); if(e&&e.people[i]) e.people[i][k]=v; };
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
    var said='';
    apiPut('/jobs/'+encodeURIComponent(e.id),{
      position:e.f.position.trim(), location:e.f.location.trim(), source:e.f.source.trim(), job_url:e.f.job_url.trim(),
      salary_range:e.f.salary_range.trim(), industry:e.f.industry.trim(), notes:e.f.notes
    }).then(function(r){
      said=(r&&r.moved_sentence)||'';
      // The people: only those that changed, one at a time, so a refusal names the person it is about.
      var canPeople=e.rights&&e.rights.contacts;
      var changed=canPeople?e.people.map(function(p,i){ return { p:p, o:e.orig[i] }; }).filter(function(x){
        return PERSON_KEYS.some(function(k){ return String(x.p[k]||'')!==String(x.o[k]||''); });
      }):[];
      return changed.reduce(function(chain,x){
        return chain.then(function(){
          var body={}; PERSON_KEYS.forEach(function(k){ if(String(x.p[k]||'').trim()!==String(x.o[k]||'')) body[k]=String(x.p[k]||'').trim(); });
          return apiPut('/contacts/'+encodeURIComponent(x.p.id),body).catch(function(err){
            var who=((x.o.first_name||'')+' '+(x.o.last_name||'')).trim()||'this person';
            throw new Error('The lead was saved, but '+who+' could not be: '+((err&&err.message)||'refused'));
          });
        });
      },Promise.resolve());
    }).then(function(){
      STATE.leadEdit=undefined; closeModal();
      showToast(said||'Lead updated',said?'info':'success');
      Promise.resolve(typeof refreshJobs==='function'?refreshJobs():null).then(function(){ if(typeof rowRevealRefresh==='function') rowRevealRefresh(); });
    }).catch(function(err){ e.busy=false; e.err=(err&&err.message)||'Could not save'; STATE.modal=draw(); render(); });
  };
  var PERSON_KEYS=['first_name','last_name','designation','email','phone'];

  function field(label,key,ph){
    var e=E(), v=e.f[key], hint=HINTS[key]?HINTS[key](v):'';
    return '<div class="fd-label">'+label+'</div>'+
      '<input id="le-'+key+'" class="inp fd-wide" value="'+escAttr(v)+'" placeholder="'+escAttr(ph||'')+'" oninput="leadEditSet(\''+key+'\',this.value)">'+
      (HINTS[key]?'<div id="le-hint-'+key+'" class="fs-12 c-text3" role="status">'+esc(hint)+'</div>':'');
  }
  function fmtDay(iso){ try{ return new Date(iso).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }catch(x){ return ''; } }
  function personField(i,k,label,ph){
    return '<label class="le-f"><span class="fs-11 c-text3">'+label+'</span><input id="le-p'+i+'-'+k+'" class="inp fd-wide" value="'+escAttr(E().people[i][k])+'" placeholder="'+escAttr(ph||'')+'" oninput="leadEditPerson('+i+',\''+k+'\',this.value)"></label>';
  }
  // The People section: drawn only when the server said yes; when an RA lead's window has closed, says so and when.
  function peopleHtml(e){
    var r=e.rights;
    if(!r||!e.people.length) return '';
    if(!r.contacts){
      return r.contacts_until?'<div class="fd-label">People on this lead</div><div class="fs-12_5 c-text3">The time to edit the people on this lead closed on '+esc(fmtDay(r.contacts_until))+' ('+esc(r.window_hours)+' hours after it was made — set by your admin).</div>':'';
    }
    return '<div class="fd-label">People on this lead</div>'+
      (r.via==='ra_lead_window'?'<div class="fs-12 c-text3">You can edit these until '+esc(fmtDay(r.contacts_until))+' ('+esc(r.window_hours)+' hours after the lead was made — set by your admin).</div>':'')+
      e.people.map(function(p,i){
        return '<div class="le-person"><div class="le-grid">'+
          personField(i,'first_name','First name')+personField(i,'last_name','Last name')+
          personField(i,'designation','Title')+personField(i,'phone','Phone')+
        '</div>'+personField(i,'email','Email')+'</div>';
      }).join('');
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
      peopleHtml(e)+
      (e.err?'<div class="c-red fs-13" role="alert">'+esc(e.err)+'</div>':'');
    var foot='<button class="btn btn-outline" onclick="leadEditClose()">Cancel</button>'+
      '<button class="btn btn-primary" id="le-save" '+(e.busy?'disabled ':'')+'onclick="leadEditSave()">'+(e.busy?'Saving…':'Save changes')+'</button>';
    return '<div class="modal modal-w480"><div class="mh"><div class="mt">Edit lead</div></div><div class="mb_">'+body+'</div><div class="mf">'+foot+'</div></div>';
  }
})();
