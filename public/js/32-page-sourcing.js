// ===== SOURCING MODULE (additive) =====
// Pull candidates from a source into the database. Slice A: the connector
// framework + CSV/XLSX file import → staging → dedup review → import (optionally
// tagging onto a job's pipeline). API boards (Apollo, Indeed, LinkedIn, Monster,
// CareerBuilder, Dice) show as scaffolds until credentials are added.
// docs/SOURCING_AND_SCHEDULING_PLAN.md.

(function () {

  if (!STATE.sourcing) STATE.sourcing = { providers:[], staged:[], sel:{}, loading:false, tagJob:'', force:false, jobs:null };

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function code(t){ return '<span style="font-family:var(--mono);font-size:10.5px;color:var(--text3);font-weight:600">'+esc(t)+'</span>'; }

  // ── CSV parser (quote-aware) + header mapping ───────────────────────────────
  function parseCSV(text){
    var rows=[], row=[], cur='', q=false, i=0, ch;
    text = String(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    for (i=0;i<text.length;i++){ ch=text[i];
      if (q){ if (ch==='"'){ if (text[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=ch; }
      else { if (ch==='"') q=true; else if (ch===','){ row.push(cur); cur=''; } else if (ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; } else cur+=ch; }
    }
    if (cur.length||row.length){ row.push(cur); rows.push(row); }
    return rows.filter(function(r){ return r.some(function(c){ return String(c).trim()!==''; }); });
  }
  function normHeader(h){ return String(h||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  var HEADER_MAP = {
    name:'full_name', fullname:'full_name', candidatename:'full_name', applicantname:'full_name',
    firstname:'first_name', lastname:'last_name',
    email:'email', emailaddress:'email', emailid:'email',
    phone:'phone', mobile:'phone', phonenumber:'phone', mobilenumber:'phone', cell:'phone', contact:'phone',
    title:'current_title', jobtitle:'current_title', currenttitle:'current_title', headline:'current_title', position:'current_title',
    company:'current_employer', employer:'current_employer', currentemployer:'current_employer', currentcompany:'current_employer', organization:'current_employer',
    location:'location', city:'city', state:'state', country:'country',
    workauth:'work_authorization', workauthorization:'work_authorization', visa:'work_authorization', authorization:'work_authorization', workstatus:'work_authorization',
    experience:'experience_years', experienceyears:'experience_years', yearsofexperience:'experience_years', totalexperience:'experience_years', exp:'experience_years',
    skills:'skills', keyskills:'skills',
    resume:'resume_url', resumeurl:'resume_url', resumelink:'resume_url',
    // LinkedIn gets its own field. It used to map to source_url, which the
    // import path then discarded — so every LinkedIn URL uploaded through
    // Sourcing was silently lost. Everything else stays a generic profile link.
    linkedin:'linkedin_url', linkedinurl:'linkedin_url', linkedinprofile:'linkedin_url', li:'linkedin_url',
    url:'source_url', profile:'source_url', profileurl:'source_url', link:'source_url', sourceurl:'source_url',
    github:'source_url', githuburl:'source_url', portfolio:'source_url', website:'source_url'
  };
  function rowsToRecords(matrix){
    if (!matrix.length) return [];
    var headers = matrix[0].map(normHeader);
    var fields = headers.map(function(h){ return HEADER_MAP[h] || null; });
    var out = [];
    for (var r=1;r<matrix.length;r++){
      var rec={}, raw={};
      matrix[r].forEach(function(v,ci){ var f=fields[ci]; var val=String(v==null?'':v).trim(); raw[matrix[0][ci]]=val; if(f&&val) rec[f]=val; });
      rec.raw = raw;
      if (rec.full_name || rec.email || (rec.first_name||rec.last_name)) {
        if (!rec.full_name) rec.full_name = [rec.first_name,rec.last_name].filter(Boolean).join(' ')||rec.email;
        out.push(rec);
      }
    }
    return out;
  }

  // ── data ─────────────────────────────────────────────────────────────────────
  function loadProviders(){ return apiGet('/sourcing/providers').then(function(d){ STATE.sourcing.providers=d||[]; }).catch(function(){ STATE.sourcing.providers=[]; }); }
  function loadStaged(){
    STATE.sourcing.loading=true; render();
    return apiGet('/sourcing/staged').then(function(d){ STATE.sourcing.staged=d||[]; STATE.sourcing.loading=false; render(); })
      .catch(function(e){ STATE.sourcing.loading=false; showToast('Failed to load: '+e.message,'error'); render(); });
  }
  // Sourcing lives inside the Candidates tab (see 27-page-applicants.js's
  // atsSetView) rather than as its own nav item/page — this is the hook that
  // tab uses to (re)load provider + staged-candidate data on first switch.
  window.srcLoadForCandidatesTab = function(){ loadProviders().then(loadStaged); };

  // ── page ──────────────────────────────────────────────────────────────────
  window.renderSourcing = function(){
    var s = STATE.sourcing;
    var providerCards = (s.providers||[]).map(function(p){
      var ready = p.available;
      return '<div class="card" style="padding:12px 14px;opacity:'+(ready?'1':'.7')+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:center">'+
          '<div style="font-weight:700;font-size:13px">'+esc(p.label)+'</div>'+
          (ready?'<span style="font-size:10px;font-weight:700;color:var(--green);background:rgba(0,0,0,.04);padding:2px 7px;border-radius:9px">READY</span>'
                :'<span style="font-size:10px;font-weight:700;color:var(--amber);background:rgba(0,0,0,.04);padding:2px 7px;border-radius:9px">NEEDS CREDS</span>')+
        '</div>'+
        '<div style="font-size:11.5px;color:var(--text3);margin-top:5px;min-height:30px">'+esc(p.note||'')+'</div>'+
        (p.id==='csv'
          ? '<label class="btn btn-sm btn-primary" style="cursor:pointer;margin-top:6px">Import file<input type="file" accept=".csv,.xlsx,.xls" style="display:none" onchange="srcImportFile(this)"></label>'
          : '<button class="btn btn-sm btn-outline" style="margin-top:6px" onclick="srcProviderInfo(\''+p.id+'\')">Details</button>')+
      '</div>';
    }).join('');

    var staged = s.staged||[];
    var selIds = Object.keys(s.sel).filter(function(k){ return s.sel[k]; });
    var jobs = s.jobs||[];
    var head = ['','Name','Email','Mobile','Title','Employer','Location','Work Auth','Source','Match','']
      .map(function(h){ return '<th style="text-align:left;padding:8px 9px;font-size:11px;color:var(--text3);font-weight:700;white-space:nowrap">'+h+'</th>'; }).join('');
    var body = staged.map(function(r){
      var dup = r.dup;
      return '<tr style="border-top:1px solid var(--border)">'+
        '<td style="padding:8px 9px"><input type="checkbox" '+(s.sel[r.id]?'checked':'')+' onclick="srcToggle(\''+r.id+'\')"></td>'+
        '<td style="padding:8px 9px;font-size:12.5px;font-weight:600;white-space:nowrap">'+esc(r.full_name||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px">'+esc(r.email||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(r.phone||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px">'+esc(r.current_title||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px">'+esc(r.current_employer||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px">'+esc(r.location||[r.city,r.state].filter(Boolean).join(', ')||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(r.work_authorization||'—')+'</td>'+
        '<td style="padding:8px 9px;font-size:12px;white-space:nowrap">'+esc(r.provider||'')+'</td>'+
        '<td style="padding:8px 9px;font-size:11px;white-space:nowrap">'+(dup?'<span title="'+esc(dup.full_name||'')+'" style="color:var(--amber);font-weight:700">⚠ '+esc(dup.candidate_code||'dup')+'</span>':'<span style="color:var(--green)">new</span>')+'</td>'+
        '<td style="padding:8px 9px;white-space:nowrap">'+
          '<button class="btn btn-sm btn-primary" onclick="srcImportOne(\''+r.id+'\')">Import</button> '+
          '<button class="btn btn-sm btn-outline" style="color:var(--red)" onclick="srcDiscard(\''+r.id+'\')">✕</button>'+
        '</td>'+
      '</tr>';
    }).join('');
    if (!staged.length) body = '<tr><td colspan="11" style="padding:34px;text-align:center;color:var(--text3)">Nothing staged. Import a file above to begin.</td></tr>';

    var tagPicker = jobs.length ?
      '<select class="sel" style="max-width:260px" onchange="srcSetTagJob(this.value)"><option value="">Import without tagging</option>'+
        jobs.map(function(j){ return '<option value="'+j.id+'"'+(s.tagJob===j.id?' selected':'')+'>'+esc((j.job_code?j.job_code+' · ':'')+(j.job_title||''))+'</option>'; }).join('')+'</select>' :
      '<button class="btn btn-sm btn-outline" onclick="srcLoadJobs()">Tag to a job…</button>';

    return UI.page({
      tabs: (window.atsTabBar?atsTabBar():''),
      body:
      '<div style="font-size:18px;font-weight:700;margin-bottom:2px">Sourcing</div>'+
      '<div style="font-size:12.5px;color:var(--text3);margin-bottom:14px">Bring candidates from any job board into your database. CSV/Excel works today; API boards activate when credentials are added.</div>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:18px">'+providerCards+'</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">'+
        '<div style="font-weight:600;font-size:14px">Review &amp; import ('+staged.length+')</div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
          tagPicker+
          '<label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" '+(s.force?'checked':'')+' onclick="srcToggleForce()"> Import duplicates too</label>'+
          '<button class="btn btn-sm btn-primary" '+(selIds.length?'':'disabled style="opacity:.5"')+' onclick="srcImportSelected()">Import selected'+(selIds.length?' ('+selIds.length+')':'')+'</button>'+
        '</div>'+
      '</div>'+
      (s.loading?'<div style="text-align:center;padding:40px;color:var(--text3)">Loading…</div>':
        '<div class="dt-wrap"><table class="dt" style="min-width:1000px"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>')
    });
  };

  // ── file import ─────────────────────────────────────────────────────────────
  window.srcImportFile = function(input){
    if (!input.files || !input.files[0]) return;
    var file = input.files[0]; input.value='';
    var name = (file.name||'').toLowerCase();
    var done = function(records){
      if (!records.length){ showToast('No candidate rows found in the file','error'); return; }
      apiPost('/sourcing/import-file', { provider:'csv', rows:records }).then(function(r){
        showToast('Staged '+r.staged+' candidate'+(r.staged===1?'':'s')+(r.duplicates?' ('+r.duplicates+' possible duplicate'+(r.duplicates===1?'':'s')+')':''),'success');
        loadStaged();
      }).catch(function(e){ showToast('Import failed: '+e.message,'error'); });
    };
    if (/\.xlsx?$/.test(name) && window.XLSX){
      var rb = new FileReader();
      rb.onload = function(){ try {
        var wb = window.XLSX.read(new Uint8Array(rb.result), { type:'array' });
        var sheet = wb.Sheets[wb.SheetNames[0]];
        var matrix = window.XLSX.utils.sheet_to_json(sheet, { header:1, blankrows:false });
        done(rowsToRecords(matrix));
      } catch(err){ showToast('Could not read spreadsheet: '+err.message,'error'); } };
      rb.readAsArrayBuffer(file);
    } else {
      var rt = new FileReader();
      rt.onload = function(){ done(rowsToRecords(parseCSV(rt.result))); };
      rt.onerror = function(){ showToast('Could not read file','error'); };
      rt.readAsText(file);
    }
  };
  window.srcProviderInfo = function(id){
    var p = (STATE.sourcing.providers||[]).find(function(x){ return x.id===id; })||{};
    showToast(p.label+': '+(p.note||'Scaffolded — add credentials to enable.'),'info');
  };

  // ── review actions ──────────────────────────────────────────────────────────
  window.srcToggle = function(id){ STATE.sourcing.sel[id]=!STATE.sourcing.sel[id]; render(); };
  window.srcToggleForce = function(){ STATE.sourcing.force=!STATE.sourcing.force; render(); };
  window.srcSetTagJob = function(v){ STATE.sourcing.tagJob=v; };
  window.srcLoadJobs = function(){ apiGet('/job-orders').then(function(j){ STATE.sourcing.jobs=j||[]; render(); }).catch(function(e){ showToast('Failed: '+e.message,'error'); }); };

  function importPayload(extra){ var s=STATE.sourcing; return Object.assign({ force:s.force, job_order_id:s.tagJob||undefined }, extra||{}); }

  window.srcImportOne = function(id){
    apiPost('/sourcing/staged/'+id+'/import', importPayload()).then(function(){
      showToast('Imported to database','success'); delete STATE.sourcing.sel[id]; loadStaged();
    }).catch(function(e){
      if (/possible_duplicate/i.test(e.message)){
        if (confirm('This looks like a duplicate of an existing candidate. Import as a new candidate anyway?')){
          apiPost('/sourcing/staged/'+id+'/import', importPayload({ force:true })).then(function(){ showToast('Imported','success'); loadStaged(); }).catch(function(e2){ showToast('Failed: '+e2.message,'error'); });
        }
      } else showToast('Failed: '+e.message,'error');
    });
  };
  window.srcImportSelected = function(){
    var ids = Object.keys(STATE.sourcing.sel).filter(function(k){ return STATE.sourcing.sel[k]; });
    if (!ids.length) return;
    apiPost('/sourcing/import-selected', importPayload({ ids:ids })).then(function(r){
      showToast('Imported '+r.imported+(r.skipped?' · '+r.skipped+' skipped (duplicates)':''),'success');
      STATE.sourcing.sel={}; loadStaged();
    }).catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };
  window.srcDiscard = function(id){
    apiDelete('/sourcing/staged/'+id).then(function(){ delete STATE.sourcing.sel[id]; loadStaged(); }).catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };

})();
