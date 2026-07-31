// ===== ATS MANAGED LOOKUPS MODULE (additive) =====
// Loads the recruiting taxonomies (work authorization, source, applicant status,
// availability, pay type) from the backend so admins can extend them without a
// code change. `atsLookup(cat, fallback)` returns the managed values or the
// caller's built-in defaults. Slice 6 of docs/ATS_RECRUITING_PLAN.md.

(function () {

  if (STATE.atsLookups === undefined) STATE.atsLookups = null;   // null = not loaded
  var _loading = false;

  var CATS = [
    { key:'work_authorization', label:'Work Authorization' },
    { key:'source',             label:'Source' },
    { key:'applicant_status',   label:'Candidate Status' },
    { key:'availability',       label:'Availability' },
    { key:'pay_type',           label:'Pay Type' }
  ];

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  // resolve a category to its managed values, or the caller's fallback array
  window.atsLookup = function(cat, fallback){
    var L = STATE.atsLookups;
    if (L && Array.isArray(L[cat]) && L[cat].length) return L[cat];
    return fallback || [];
  };

  window.atsLoadLookups = function(force){
    if (_loading) return;
    if (STATE.atsLookups && !force) return;          // already loaded
    _loading = true;
    apiGet('/recruiting-lookups').then(function(d){
      STATE.atsLookups = d || {}; _loading = false;
      if (typeof scheduleRender === 'function') scheduleRender(); else render();
    }).catch(function(){ _loading = false; STATE.atsLookups = STATE.atsLookups || {}; });
  };

  // ── management (admin / bd_lead) ────────────────────────────────────────────
  window.atsOpenLookupsManager = function(){
    apiGet('/recruiting-lookups?all=1').then(function(d){ STATE.ats = STATE.ats||{}; STATE.ats._lkAll = d||{}; showLookupsModal(); })
      .catch(function(e){ showToast('Failed to load lists: '+e.message,'error'); });
  };

  function showLookupsModal(){
    var all = (STATE.ats && STATE.ats._lkAll) || {};
    var cats = CATS.map(function(c){
      var rows = (all[c.key]||[]).map(function(r){
        return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">'+
          '<span style="flex:1;font-size:12.5px'+(r.is_active?'':';color:var(--text3);text-decoration:line-through')+'">'+esc(r.value)+'</span>'+
          '<label style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox"'+(r.is_active?' checked':'')+' onchange="atsLkToggle(\''+r.id+'\',this.checked)"> active</label>'+
        '</div>';
      }).join('') || '<div style="font-size:12px;color:var(--text3);padding:4px 0">No values.</div>';
      return '<div style="margin-bottom:16px">'+
        '<div style="font-weight:700;font-size:12.5px;margin-bottom:4px">'+esc(c.label)+'</div>'+
        rows+
        '<div style="display:flex;gap:6px;margin-top:6px">'+
          '<input class="sel" id="lkadd_'+c.key+'" placeholder="Add value…" style="flex:1" onkeydown="if(event.key===\'Enter\')atsLkAdd(\''+c.key+'\')">'+
          '<button class="btn btn-sm btn-primary" onclick="atsLkAdd(\''+c.key+'\')">Add</button>'+
        '</div>'+
      '</div>';
    }).join('');
    STATE.modal =
      '<div class="modal modal-w640" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'+
          '<div style="font-weight:700;font-size:16px">Manage ATS Lists</div><span style="cursor:pointer;color:var(--text3)" onclick="closeModal()">✕</span>'+
        '</div>'+
        '<div style="padding:18px 20px;max-height:64vh;overflow-y:auto">'+
          '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">These populate the dropdowns on the applicant form and filters. Inactive values are hidden from new entries but kept on existing records.</div>'+
          cats+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">'+
          '<button class="btn btn-outline" onclick="closeModal()">Done</button>'+
        '</div>'+
      '</div>';
    render();
  }

  function reloadManager(){
    return apiGet('/recruiting-lookups?all=1').then(function(d){ STATE.ats._lkAll = d||{}; showLookupsModal(); atsLoadLookups(true); });
  }

  window.atsLkAdd = function(cat){
    var el = document.getElementById('lkadd_'+cat); var v = el ? el.value : '';
    if (!v.trim()){ showToast('Enter a value','error'); return; }
    apiPost('/admin/recruiting-lookups', { category:cat, value:v }).then(function(){ showToast('Added','success'); reloadManager(); })
      .catch(function(e){ showToast(/already exists/i.test(e.message)?'That value already exists':('Failed: '+e.message),'error'); });
  };
  window.atsLkToggle = function(id, active){
    apiPatch('/admin/recruiting-lookups/'+id, { is_active: active }).then(function(){ reloadManager(); })
      .catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };
  window.atsLkDelete = function(id){
    if (!confirm('Delete this value?')) return;
    apiDelete('/admin/recruiting-lookups/'+id).then(function(){ reloadManager(); })
      .catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };

})();
