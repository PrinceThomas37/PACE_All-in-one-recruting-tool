// ============================================================================
// BULK RESUME UPLOAD (Session 31)
//
// The owner: "multiple document upload in a single turn, where multiple PDF
// files … can be added, and then all that can be parsed together once and
// added at one time … a progress bar … a window that previews all of those
// candidates and their details, which the user can edit manually … 'Add
// candidates' … how many candidates have been added."
//
// THREE STEPS IN ONE WINDOW: pick files → read them (progress) → check and
// edit (a table) → add them (progress) → a count.
//
// NO NEW SERVER PATH. Every file goes through the same POST
// /candidates/parse-resume the single "Parse & fill" button uses, every person
// through the same POST /candidates (so the duplicate check, the plan limit
// and the owner stamp all still apply), the file through the same documents
// upload, and a job through POST /pipeline. A bulk path that re-implemented
// any of those would be a second definition of "add a candidate" — the class
// of bug CAPABILITIES.md exists to stop.
//
// ONE AT A TIME, on purpose: each read may be an AI call against a free-tier
// allowance measured per minute, and each add is a duplicate check. Parallel
// would be faster and would trip both.
//
// The window is a MODAL (STATE.modal + render()). Typing in the table writes
// state and does NOT re-render — a repaint per keystroke takes the caret out
// of the box being typed in.
// ============================================================================
(function(){
  'use strict';

  var MAX_FILES = 25;
  var MAX_BYTES = 4.5 * 1024 * 1024;
  var ACCEPT = '.pdf,.doc,.docx,.rtf,.txt';

  function B(){ return STATE.bulkResume || (STATE.bulkResume = { rows:[], phase:'pick', job:null }); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // jobCtx is optional: { jobId, jobTitle } — from a job's page, everyone added
  // is also put on that job.
  window.atsOpenBulkUpload = function(jobCtx){
    STATE.bulkResume = { rows:[], phase:'pick', job:(jobCtx&&jobCtx.jobId)?jobCtx:null, done:0, total:0, note:'' };
    paint();
  };

  // ── 1. pick ───────────────────────────────────────────────────────────────
  window.bulkResumePicked = function(input){
    var b = B();
    var files = Array.prototype.slice.call((input && input.files) || []);
    if (!files.length) return;
    var skipped = [];
    if (files.length > MAX_FILES){ skipped.push((files.length-MAX_FILES)+' over the '+MAX_FILES+'-file limit'); files = files.slice(0, MAX_FILES); }
    b.rows = files.map(function(f, i){
      var tooBig = f.size > MAX_BYTES;
      return { key:'r'+i+'_'+Date.now(), file:f, name:f.name, size:f.size, type:f.type||'application/octet-stream',
               data:null, status: tooBig?'error':'waiting', error: tooBig?'Larger than 4.5 MB — not read':'',
               fields:{}, include:!tooBig, used_ai:false, result:'' };
    });
    b.note = skipped.join(' · ');
    b.phase = 'reading';
    paint();
    readNext();
  };

  function readFile(row){
    return new Promise(function(resolve, reject){
      var r = new FileReader();
      r.onload = function(){ resolve(String(r.result)); };
      r.onerror = function(){ reject(new Error('Could not read this file')); };
      r.readAsDataURL(row.file);
    });
  }

  // ── 2. read, one at a time ────────────────────────────────────────────────
  function readNext(){
    var b = B();
    if (b.phase !== 'reading') return;
    var row = b.rows.find(function(r){ return r.status === 'waiting'; });
    if (!row){ b.phase = 'review'; paint(); return; }
    row.status = 'reading'; paint();
    readFile(row).then(function(data){
      row.data = data;
      return apiPost('/candidates/parse-resume', { filename:row.name, size:row.size, content_type:row.type, data_base64:data });
    }).then(function(res){
      var f = (res && res.fields) || {};
      row.fields = {
        full_name: f.full_name || '', email: f.email || '', phone: f.phone || '',
        current_title: f.current_title || '', current_employer: f.current_employer || '',
        city: f.city || '', state: f.state || '', country: f.country || '',
        experience_years: (f.experience_years!=null && f.experience_years!=='') ? String(f.experience_years) : '',
        skills: f.skills || '', linkedin_url: f.linkedin_url || '', work_authorization: f.work_authorization || ''
      };
      row.resume_text = res && res.resume_text;
      row.used_ai = !!(res && res.used_ai);
      row.status = 'read';
      // A resume with no name cannot be saved — leave it ticked so the person
      // sees the empty box and fills it, rather than silently dropping it.
    }).catch(function(e){
      row.status = 'error'; row.include = false;
      row.error = (e && e.message) || 'Could not read this resume';
    }).then(function(){ paint(); readNext(); });
  }

  window.bulkResumeCancel = function(){
    var b = B();
    if (b.phase === 'reading'){ b.rows.forEach(function(r){ if(r.status==='waiting'){ r.status='error'; r.include=false; r.error='Not read — stopped'; } }); b.phase='review'; paint(); return; }
    if (b.phase === 'adding'){ b.stop = true; return; }
    STATE.bulkResume = null; closeModal();
  };

  // ── 3. review — edits write state and never re-render ─────────────────────
  window.bulkResumeSet = function(key, field, value){
    var row = B().rows.find(function(r){ return r.key===key; }); if(!row) return;
    row.fields[field] = value;
  };
  window.bulkResumeInclude = function(key, on){
    var row = B().rows.find(function(r){ return r.key===key; }); if(!row) return;
    row.include = !!on;
    var btn = document.getElementById('br-add');
    if (btn) btn.textContent = addLabel();
  };
  function addable(){ return B().rows.filter(function(r){ return r.include && r.status==='read'; }); }
  function addLabel(){ var n = addable().length; return 'Add '+n+' candidate'+(n===1?'':'s'); }

  // ── 4. add, one at a time ─────────────────────────────────────────────────
  window.bulkResumeAdd = function(){
    var b = B();
    var rows = addable();
    var nameless = rows.filter(function(r){ return !String(r.fields.full_name||'').trim(); });
    if (nameless.length){ showToast(nameless.length+' ticked resume'+(nameless.length===1?' has':'s have')+' no name — type one in, or untick '+(nameless.length===1?'it':'them'),'warning'); return; }
    if (!rows.length){ showToast('Nothing ticked to add','warning'); return; }
    b.phase = 'adding'; b.total = rows.length; b.done = 0; b.stop = false;
    rows.forEach(function(r){ r.result = 'queued'; });
    paint();
    addNext();
  };
  window.bulkResumeForce = function(key){
    var row = B().rows.find(function(r){ return r.key===key; }); if(!row) return;
    row.force = true; row.result = 'queued'; row.include = true;
    var b = B(); b.phase='adding'; b.total=(b.total||0); b.stop=false; paint(); addNext();
  };

  function addOne(row){
    var b = B();
    var payload = Object.assign({}, row.fields, { source:'Resume upload', applicant_status:'New lead' });
    if (row.resume_text) payload.resume_text = row.resume_text;
    if (payload.experience_years === '') delete payload.experience_years;
    if (row.force) payload.force = true;
    return apiPost('/candidates', payload).then(function(c){
      row.candidate = c;
      // The file itself, onto the new record. A failed attachment never
      // un-adds the person — they are saved, and the row says so.
      var attach = row.data
        ? apiPost('/candidates/'+c.id+'/documents', { filename:row.name, content_type:row.type, doc_type:'resume', data_base64:row.data })
            .catch(function(){ row.warn = 'added, but the resume file did not attach'; })
        : Promise.resolve();
      return attach.then(function(){
        if (!b.job) return;
        return apiPost('/pipeline', { candidate_id:c.id, job_order_id:b.job.jobId })
          .catch(function(e){ row.warn = 'added, but not put on the job: '+e.message; });
      });
    }).then(function(){ row.result = 'added'; })
      .catch(function(e){
        if (/possible_duplicate/i.test((e && e.message)||'')) row.result = 'duplicate';
        else { row.result = 'failed'; row.error = (e && e.message) || 'Could not add'; }
      });
  }
  function addNext(){
    var b = B();
    var row = b.rows.find(function(r){ return r.result === 'queued'; });
    if (!row || b.stop){
      b.rows.forEach(function(r){ if(r.result==='queued') r.result=''; });
      b.phase = 'done'; paint();
      if (window.atsReloadCandidates) atsReloadCandidates();
      if (b.job && window.bdReloadSubmissions) bdReloadSubmissions(b.job.jobId);
      return;
    }
    row.result = 'adding'; paint();
    addOne(row).then(function(){
      if (row.result === 'added') b.done++;
      paint(); addNext();
    });
  }

  // ── drawing ───────────────────────────────────────────────────────────────
  function bar(done, total, label){
    var pct = total ? Math.round(done*100/total) : 0;
    return '<div style="margin:4px 0 14px">'+
      '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span>'+label+'</span><b>'+done+' / '+total+'</b></div>'+
      '<div role="progressbar" aria-valuenow="'+pct+'" aria-valuemin="0" aria-valuemax="100" style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">'+
        '<div style="height:100%;width:'+pct+'%;background:var(--accent);border-radius:99px;transition:width .3s ease"></div>'+
      '</div></div>';
  }
  function cell(row, field, ph, w){
    var dis = (B().phase==='adding'||B().phase==='done'||row.status!=='read') ? ' disabled' : '';
    return '<td style="padding:4px"><input class="sel" style="min-width:'+(w||110)+'px;font-size:12px;padding:5px 7px" value="'+esc(row.fields[field]||'')+'" placeholder="'+esc(ph||'')+'"'+dis+
      ' oninput="bulkResumeSet(\''+row.key+'\',\''+field+'\',this.value)"></td>';
  }
  function statusCell(row){
    var b = B();
    if (b.phase==='adding' || b.phase==='done'){
      var r = row.result;
      if (r==='added') return '<span style="color:var(--green);font-weight:600">✓ Added</span>'+(row.warn?'<div style="font-size:10.5px;color:var(--amber)">'+esc(row.warn)+'</div>':'');
      if (r==='adding') return '<span style="color:var(--accent)">Adding…</span>';
      if (r==='queued') return '<span style="color:var(--text3)">Waiting</span>';
      if (r==='duplicate') return '<span style="color:var(--amber);font-weight:600">Already in PACE?</span>'+
        (b.phase==='done'?'<div><button class="btn btn-sm btn-outline" style="font-size:11px;padding:2px 8px;margin-top:3px" onclick="bulkResumeForce(\''+row.key+'\')">Add anyway</button></div>':'');
      if (r==='failed') return '<span style="color:var(--red)">Not added</span><div style="font-size:10.5px;color:var(--text3)">'+esc(row.error)+'</div>';
      if (!row.include) return '<span style="color:var(--text3)">Skipped</span>';
    }
    if (row.status==='reading') return '<span style="color:var(--accent)">Reading…</span>';
    if (row.status==='waiting') return '<span style="color:var(--text3)">Waiting</span>';
    if (row.status==='error') return '<span style="color:var(--red)">Could not read</span><div style="font-size:10.5px;color:var(--text3);max-width:180px">'+esc(row.error)+'</div>';
    return '<span style="color:var(--text2)">'+(row.used_ai?'Read by AI':'Read')+'</span>';
  }

  function body(){
    var b = B();
    if (b.phase==='pick'){
      return '<div style="border:2px dashed var(--border2);border-radius:12px;padding:30px 20px;text-align:center">'+
        '<div style="font-size:14px;font-weight:600;margin-bottom:6px">Choose the resumes</div>'+
        '<div style="font-size:12.5px;color:var(--text3);margin-bottom:14px">Up to '+MAX_FILES+' files at once — PDF, Word or text, 4.5 MB each. Hold Ctrl (or ⌘) to pick several.</div>'+
        '<input type="file" id="br-files" multiple accept="'+ACCEPT+'" onchange="bulkResumePicked(this)" style="font-size:12.5px">'+
      '</div>'+
      (b.job?'<div style="font-size:12px;color:var(--text2);margin-top:12px">Everyone you add will also be put on <b>'+esc(b.job.jobTitle||'this job')+'</b>.</div>':'');
    }
    var readDone = b.rows.filter(function(r){ return r.status==='read'||r.status==='error'; }).length;
    var head = '';
    if (b.phase==='reading') head = bar(readDone, b.rows.length, 'Reading resumes…');
    else if (b.phase==='adding') head = bar(b.rows.filter(function(r){return r.result&&r.result!=='queued'&&r.result!=='adding';}).length, b.total, 'Adding candidates — '+b.done+' added so far');
    else if (b.phase==='done'){
      var dup = b.rows.filter(function(r){return r.result==='duplicate';}).length;
      var bad = b.rows.filter(function(r){return r.result==='failed';}).length;
      head = '<div class="card" style="padding:12px 14px;margin-bottom:12px;border-left:3px solid var(--green)">'+
        '<div style="font-size:14px;font-weight:700">'+b.done+' candidate'+(b.done===1?'':'s')+' added'+(b.job?' to '+esc(b.job.jobTitle||'the job'):'')+'</div>'+
        ((dup||bad)?'<div style="font-size:12px;color:var(--text2);margin-top:3px">'+
          (dup?dup+' look like someone already in PACE — check them, or “Add anyway”. ':'')+
          (bad?bad+' could not be added — the reason is on the row.':'')+'</div>':'')+
      '</div>';
    } else {
      var errs = b.rows.filter(function(r){return r.status==='error';}).length;
      head = '<div style="font-size:12.5px;color:var(--text2);margin-bottom:10px">'+
        'Check each row and fix anything the reader got wrong. Untick anyone you do not want to add.'+
        (errs?' <span style="color:var(--amber)">'+errs+' file'+(errs===1?'':'s')+' could not be read.</span>':'')+'</div>';
    }
    var rows = b.rows.map(function(r){
      var lock = b.phase==='adding'||b.phase==='done'||r.status!=='read';
      return '<tr style="border-top:1px solid var(--border2)">'+
        '<td style="padding:4px 6px;text-align:center"><input type="checkbox" '+(r.include?'checked':'')+(lock?' disabled':'')+' onchange="bulkResumeInclude(\''+r.key+'\',this.checked)"></td>'+
        '<td style="padding:4px 6px;font-size:11.5px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(r.name)+'">'+esc(r.name)+'</td>'+
        cell(r,'full_name','Full name *',140)+cell(r,'email','Email',170)+cell(r,'phone','Phone',115)+
        cell(r,'current_title','Current title',140)+cell(r,'city','City',95)+cell(r,'state','State',80)+
        cell(r,'experience_years','Yrs',50)+cell(r,'skills','Skills',200)+
        '<td style="padding:4px 8px;font-size:11.5px;white-space:nowrap">'+statusCell(r)+'</td>'+
      '</tr>';
    }).join('');
    return (b.note?'<div style="font-size:12px;color:var(--amber);margin-bottom:8px">'+esc(b.note)+'</div>':'')+
      head+
      '<div class="tbl-wrap" data-keep-scroll="bulk-resume" style="overflow:auto;max-height:48vh;border:1px solid var(--border2);border-radius:var(--r)">'+
        '<table style="width:100%;border-collapse:collapse;min-width:1250px">'+
          '<thead><tr style="background:var(--bg);position:sticky;top:0;z-index:1">'+
            ['','File','Name','Email','Phone','Title','City','State','Yrs','Skills','Status'].map(function(h){
              return '<th style="text-align:left;padding:7px 6px;font-size:11px;color:var(--text3);font-weight:600">'+h+'</th>'; }).join('')+
          '</tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  function footer(){
    var b = B();
    var left = '<div style="font-size:11.5px;color:var(--text3)">'+(b.job?'Adds to '+esc(b.job.jobTitle||'the job')+' too':'Owner: you')+'</div>';
    var btns;
    if (b.phase==='pick') btns = '<button class="btn btn-outline" onclick="bulkResumeCancel()">Close</button>';
    else if (b.phase==='reading') btns = '<button class="btn btn-outline" onclick="bulkResumeCancel()">Stop reading</button>';
    else if (b.phase==='review') btns = '<button class="btn btn-outline" onclick="bulkResumeCancel()">Cancel</button>'+
      '<button class="btn btn-primary" id="br-add" onclick="bulkResumeAdd()">'+addLabel()+'</button>';
    else if (b.phase==='adding') btns = '<button class="btn btn-outline" onclick="bulkResumeCancel()">Stop after this one</button>';
    else btns = '<button class="btn btn-primary" onclick="bulkResumeCancel()">Done</button>';
    return '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+
      left+'<div style="display:flex;gap:8px">'+btns+'</div></div>';
  }

  function paint(){
    var b = B();
    STATE.modal =
      '<div class="modal" onclick="event.stopPropagation()" style="width:min(1180px,96vw)">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
          '<div class="mhd">Upload resumes'+(b.job?' — '+esc(b.job.jobTitle||''):'')+'</div>'+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:2px">Read many resumes at once, check what was found, then add them together.</div>'+
        '</div>'+
        '<div style="padding:16px 20px;max-height:66vh;overflow:auto">'+body()+'</div>'+
        footer()+
      '</div>';
    render();
  }
})();
