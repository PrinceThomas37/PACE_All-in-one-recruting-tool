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
  var editing = {}, viewing = {}, loading = {};
  function esc(s){ return htmlEsc(s); }
  function job(id){ return (STATE.jobs||[]).find(function(x){ return x.id===id; }); }
  function research(j){
    var r=j&&j.research;
    if(typeof r==='string'){ try{ r=JSON.parse(r); }catch(e){ r={}; } }
    return (r&&typeof r==='object')?r:{};
  }
  function body(j){ return String(research(j).jd_raw||'').trim().replace(/^Title:[^\n]*\n*/i,'').trim(); }
  // R-301: the list copy of a lead has no posting text, only the server's summary of it (`j.posting`); the text loads when
  // someone opens it (loadLeadPosting, 22-api.js).
  function omitted(j){ return !!research(j).jd_raw_omitted; }
  function hasPosting(j){
    if(omitted(j)) return !!(j.posting&&j.posting.has_posting);
    var all=String(research(j).jd_raw||'').trim() || (j.position?'Title: '+j.position:'');
    return all.length>=THIN;
  }
  function words(j,b){ return omitted(j) ? ((j.posting&&j.posting.words)||0) : (b?b.split(/\s+/).length:0); }
  function attached(j,b){ return omitted(j) ? !!(j.posting&&j.posting.chars) : !!b; }
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
    var id=j.id, b=body(j), ok=hasPosting(j), mine=canEdit(j), has=attached(j,b);
    if(loading[id]){
      return '<div class="lx-head">Job posting</div><div class="lxp-card lxp-row"><div class="lxp-status lxp-meta">Loading the job description…</div></div>';
    }
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
    // A posting that is attached is SHOWN first (owner, 14 Oct: "instead of Edit job posting, if the JD is attached, show option");
    // changing it is one more click, inside the view. With nothing attached the way in is still "Paste the job posting".
    if(b && viewing[id]){
      return '<div class="lx-head">Job posting</div>'+
        '<div class="lxp-card">'+
          '<div class="lxp-read">'+esc(b)+'</div>'+
          '<div class="lxp-actions">'+
            '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();leadPostingShow(\''+id+'\',false)">Hide</button>'+
            (mine?'<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();leadPostingEdit(\''+id+'\',true)">Edit posting</button>':'')+
          '</div>'+
        '</div>';
    }
    var status = ok
      ? '<span class="lxp-ok">✓ The AI has the job posting</span> <span class="lxp-meta">· '+words(j,b)+' words</span>'
      : '<span class="lxp-miss">The AI only knows the job title</span>';
    var action = has
      ? '<button type="button" class="lxi-link" onclick="event.stopPropagation();leadPostingShow(\''+id+'\',true)">Show job description</button>'
      : (mine ? '<button type="button" class="lxi-link" onclick="event.stopPropagation();leadPostingEdit(\''+id+'\',true)">Paste the job posting</button>' : '');
    return '<div class="lx-head">Job posting</div>'+
      '<div class="lxp-card lxp-row">'+
        '<div class="lxp-status">'+status+
          (ok?'':'<div class="lxp-help">Paste the job description so its first email can speak to the actual role.</div>')+
        '</div>'+action+
      '</div>';
  }

  // Opening the text loads it first when the list copy does not carry it. A failed load says so and opens nothing — an empty
  // edit box would look like "no posting" and saving it would clear the real one.
  function withText(id, then){
    var j=job(id);
    if(!j||!omitted(j)){ then(); return; }
    loading[id]=true; paint(id);
    loadLeadPosting(id).then(function(){ loading[id]=false; then(); })
      .catch(function(e){ loading[id]=false; paint(id); showToast('Could not load the job description: '+(e.message||e),'error'); });
  }
  window.leadPostingShow=function(id,on){
    if(!on){ viewing[id]=false; paint(id); return; }
    withText(id,function(){ viewing[id]=true; paint(id); });
  };
  window.leadPostingEdit=function(id,on){
    if(!on){ editing[id]=false; paint(id); return; }
    withText(id,function(){
      editing[id]=true; viewing[id]=false; paint(id);
      var t=document.getElementById('lxp-text-'+id); if(t) t.focus();
    });
  };
  window.leadPostingSave=function(id){
    var t=document.getElementById('lxp-text-'+id); if(!t) return;
    apiPost('/jobs/'+encodeURIComponent(id)+'/posting',{text:t.value}).then(function(r){
      var j=job(id); if(j&&r&&r.research){ j.research=r.research; if(r.posting) j.posting=r.posting; leadPostingKeep(id,(r.research&&r.research.jd_raw)||''); }
      editing[id]=false; viewing[id]=false; paint(id);
      showToast(r&&r.posting&&r.posting.has_posting?'Posting saved — the AI will use it for this lead\'s first email':'Saved. That is still short — the AI treats it as title-only.', r&&r.posting&&r.posting.has_posting?'success':'info');
    }).catch(function(e){ showToast('Could not save: '+(e.message||e),'error'); });
  };
})();
