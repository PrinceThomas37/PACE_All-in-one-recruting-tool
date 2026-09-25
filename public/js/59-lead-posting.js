// ============================================================================
// THE JOB POSTING ON A LEAD'S ROW (R-056, D-0046). The AI writes a lead's
// first email from `research.jd_raw`; on every live lead that held only the
// job title, so every email read the same. This puts one box on the expanded
// lead row: it says plainly whether the AI has the posting, and lets the
// people working the lead paste it (POST /jobs/:id/posting).
//
// The lead row opens WITHOUT render() (06-page-leads.js, rule 2), so this
// never calls render() either — it redraws only its own element.
// "Has a posting" mirrors services/lead-posting.js postingState (the AI's own
// thin-posting rule: title + posting under 300 characters is thin); after a
// save the server's answer is used.
// ============================================================================
(function(){
  'use strict';
  var THIN = 300, MAX = 8000;
  var editing = {};
  function esc(s){ return htmlEsc(s); }
  function job(id){ return (STATE.jobs||[]).find(function(x){ return x.id===id; }); }
  function research(j){
    var r=j&&j.research;
    if(typeof r==='string'){ try{ r=JSON.parse(r); }catch(e){ r={}; } }
    return (r&&typeof r==='object')?r:{};
  }
  function body(j){ return String(research(j).jd_raw||'').trim().replace(/^Title:[^\n]*\n*/i,'').trim(); }
  function hasPosting(j){
    var all=String(research(j).jd_raw||'').trim() || (j.position?'Title: '+j.position:'');
    return all.length>=THIN;
  }
  function canEdit(j){
    var u=STATE.user||{};
    if(userHasAnyRole(u,'admin','ra_lead')) return true;
    return !!u.id && (j.created_by===u.id || j.assigned_to===u.id || j.assigned_to_bd===u.id);
  }

  window.leadPostingSlot=function(j){
    return '<div id="lx-post-'+esc(j.id)+'" class="lx-post" onclick="event.stopPropagation()">'+inner(j)+'</div>';
  };
  function paint(id){ var el=document.getElementById('lx-post-'+id), j=job(id); if(el&&j) el.innerHTML=inner(j); }

  function inner(j){
    var id=j.id, b=body(j), ok=hasPosting(j), mine=canEdit(j);
    if(editing[id]){
      return '<div class="lx-head">Job posting</div>'+
        '<div class="lxp-card">'+
          '<div class="lxp-help">Open the job link, copy the job description, and paste it here. The AI reads it when it writes this lead\'s first email — duties, skills, certifications, pay.</div>'+
          '<textarea id="lxp-text-'+esc(id)+'" class="inp lxp-text" maxlength="'+MAX+'" placeholder="Paste the job description…">'+esc(b)+'</textarea>'+
          '<div class="lxp-actions">'+
            '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();leadPostingSave(\''+id+'\')">Save posting</button>'+
            '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();leadPostingEdit(\''+id+'\',false)">Cancel</button>'+
          '</div>'+
        '</div>';
    }
    var status = ok
      ? '<span class="lxp-ok">✓ The AI has the job posting</span> <span class="lxp-meta">· '+(b.split(/\s+/).length)+' words</span>'
      : '<span class="lxp-miss">The AI only knows the job title</span>';
    var action = mine
      ? '<button type="button" class="lxi-link" onclick="event.stopPropagation();leadPostingEdit(\''+id+'\',true)">'+(b?'Edit posting':'Paste the job posting')+'</button>'
      : '';
    return '<div class="lx-head">Job posting</div>'+
      '<div class="lxp-card lxp-row">'+
        '<div class="lxp-status">'+status+
          (ok?'':'<div class="lxp-help">Paste the job description so its first email can speak to the actual role.</div>')+
        '</div>'+action+
      '</div>';
  }

  window.leadPostingEdit=function(id,on){
    editing[id]=!!on; paint(id);
    if(on){ var t=document.getElementById('lxp-text-'+id); if(t) t.focus(); }
  };
  window.leadPostingSave=function(id){
    var t=document.getElementById('lxp-text-'+id); if(!t) return;
    apiPost('/jobs/'+encodeURIComponent(id)+'/posting',{text:t.value}).then(function(r){
      var j=job(id); if(j&&r&&r.research) j.research=r.research;
      editing[id]=false; paint(id);
      showToast(r&&r.posting&&r.posting.has_posting?'Posting saved — the AI will use it for this lead\'s first email':'Saved. That is still short — the AI treats it as title-only.', r&&r.posting&&r.posting.has_posting?'success':'info');
    }).catch(function(e){ showToast('Could not save: '+(e.message||e),'error'); });
  };
})();
