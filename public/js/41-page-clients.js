// ===== CLIENTS TAB (additive) =====
// BD/admin only: companies that have converted into at least one job order —
// i.e. actual client relationships, not just leads in the pipeline. Each
// client gets its job orders, document storage (contracts, MSAs, rate
// cards…), and a tracked "Email this client" action, mirroring what the
// candidate profile already has.

(function () {

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function isBDlike(u){ return userHasAnyRole(u,'admin','bd','bd_lead'); }
  function fmtDate(s){ if(!s)return '—'; try{ var d=new Date(s); return (d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(2); }catch(e){ return '—'; } }

  STATE.clients = STATE.clients || { list:null, loading:false, q:'', selectedId:null, jobOrders:null, documents:null, docsLoading:false };

  // ── nav + routing ───────────────────────────────────────────────────────────
  var _prevRender = window.render;
  window.render = function(){
    _prevRender.apply(this, arguments);
    if (STATE.page==='clients'){ paint(); var t=document.querySelector('.tb-title'); if(t) t.textContent='Clients'; }
  };
  // (The "Clients" nav item is now built by the sidebar in 04-shell-login.js,
  // positioned above Candidates.)
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p==='clients'){ STATE.page='clients'; STATE.modal=null; STATE.clients.selectedId=null; render(); loadClients(); return; }
    return _prevGoPage.apply(this, arguments);
  };
  function paint(){ if(STATE.page!=='clients')return; var c=document.getElementById('content'); if(c) c.innerHTML=renderClients(); }

  // ── data ─────────────────────────────────────────────────────────────────────
  function loadClients(){
    STATE.clients.loading=true; paint();
    return apiGet('/clients').then(function(d){ STATE.clients.list=d||[]; STATE.clients.loading=false; paint(); })
      .catch(function(e){ STATE.clients.loading=false; showToast('Failed to load clients: '+e.message,'error'); paint(); });
  }
  function loadClientDetail(id){
    STATE.clients.jobOrders=null; STATE.clients.documents=null; STATE.clients.docsLoading=true;
    STATE.clients.contacts=null; STATE.clients.emailActivity=null;
    apiGet('/companies/'+id+'/job-orders').then(function(d){ STATE.clients.jobOrders=d||[]; paint(); }).catch(function(){ STATE.clients.jobOrders=[]; paint(); });
    apiGet('/companies/'+id+'/documents').then(function(d){ STATE.clients.documents=d||[]; STATE.clients.docsLoading=false; paint(); })
      .catch(function(){ STATE.clients.documents=[]; STATE.clients.docsLoading=false; paint(); });
    apiGet('/companies/'+id+'/contacts').then(function(d){ STATE.clients.contacts=d||[]; paint(); }).catch(function(){ STATE.clients.contacts=[]; });
    apiGet('/companies/'+id+'/email-activity').then(function(d){ STATE.clients.emailActivity=d||[]; paint(); }).catch(function(){ STATE.clients.emailActivity=[]; });
  }
  window.clientsOpen = function(id){ STATE.clients.selectedId=id; STATE.clients.selDocs={}; loadClientDetail(id); paint(); };
  window.clientsBack = function(){ STATE.clients.selectedId=null; paint(); };
  window.clientsSearch = function(v){ STATE.clients.q=v; paint(); };

  // ── list page ────────────────────────────────────────────────────────────────
  function renderClients(){
    if (STATE.clients.selectedId) return renderClientDetail();
    if (STATE.clients.loading || STATE.clients.list===null) return '<div class="page"><div style="text-align:center;padding:60px;color:var(--text3)">Loading clients…</div></div>';
    var q=(STATE.clients.q||'').toLowerCase();
    var list=(STATE.clients.list||[]).filter(function(c){ return !q || (c.name||'').toLowerCase().indexOf(q)>-1; });
    var rows=list.map(function(c){
      return '<tr style="border-top:1px solid var(--border);cursor:pointer" onclick="clientsOpen(\''+c.id+'\')">'+
        '<td style="padding:11px 12px"><div style="font-weight:600;font-size:13.5px">'+esc(c.name)+'</div>'+(c.website?'<div style="font-size:11px;color:var(--text3)">'+esc(c.website)+'</div>':'')+'</td>'+
        '<td style="padding:11px 12px;font-size:12.5px">'+esc(c.industry||'—')+'</td>'+
        '<td style="padding:11px 12px;font-size:12.5px">'+esc(c.location||'—')+'</td>'+
        '<td style="padding:11px 12px;font-size:12.5px">'+c.job_order_count+' total'+(c.open_job_order_count?' · '+c.open_job_order_count+' open':'')+'</td>'+
      '</tr>';
    }).join('');
    return '<div class="page">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
        '<div style="font-size:13px;color:var(--text3)">Companies with at least one job order — leads that converted into real business.</div>'+
        '<input class="inp" style="max-width:260px" placeholder="Search clients…" value="'+esc(STATE.clients.q||'')+'" oninput="clientsSearch(this.value)"/>'+
      '</div>'+
      '<div class="card" style="overflow:auto">'+
        '<table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">'+
          '<thead><tr style="background:var(--bg);text-align:left">'+
            ['CLIENT','INDUSTRY','LOCATION','JOB ORDERS'].map(function(h){ return '<th style="padding:10px 12px;font-size:11px;color:var(--text3);font-weight:600">'+h+'</th>'; }).join('')+
          '</tr></thead>'+
          '<tbody>'+(rows||'<tr><td colspan="4" style="padding:40px;text-align:center;color:var(--text3)">No clients yet — clients appear here once a lead converts into a job order.</td></tr>')+'</tbody>'+
        '</table>'+
      '</div>'+
    '</div>';
  }

  // ── client detail ────────────────────────────────────────────────────────────
  function renderClientDetail(){
    var c=(STATE.clients.list||[]).find(function(x){ return x.id===STATE.clients.selectedId; }); if(!c) return '';
    var jobs=STATE.clients.jobOrders;
    var jobRows=(jobs||[]).map(function(j){
      return '<tr style="border-top:1px solid var(--border)">'+
        '<td style="padding:9px 10px;font-size:12.5px">'+esc(j.job_code||'')+'</td>'+
        '<td style="padding:9px 10px;font-size:12.5px;font-weight:600">'+esc(j.job_title||'')+'</td>'+
        '<td style="padding:9px 10px;font-size:12.5px">'+esc(j.status||'')+'</td>'+
        '<td style="padding:9px 10px;font-size:12.5px">'+esc((j.bd_manager&&j.bd_manager.name)||'—')+'</td>'+
        '<td style="padding:9px 10px;font-size:12px;color:var(--text3)">'+fmtDate(j.created_at)+'</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text3);font-size:12.5px">No job orders.</td></tr>';

    var sel=STATE.clients.selDocs||{};
    var selIds=Object.keys(sel).filter(function(k){ return sel[k]; });
    var docs=STATE.clients.documents;
    var docRows=(docs||[]).map(function(d){
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border)">'+
        '<input type="checkbox" '+(sel[d.id]?'checked':'')+' onclick="clientsDocToggle(\''+d.id+'\')"/>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:600">'+(d.url?'<a href="'+esc(d.url)+'" target="_blank" rel="noopener" style="color:var(--accent)">'+esc(d.filename)+'</a>':esc(d.filename))+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+esc(d.doc_type||'')+' · '+esc((d.uploader&&d.uploader.name)||'—')+' · '+fmtDate(d.uploaded_at)+'</div>'+
        '</div>'+
        '<span style="cursor:pointer;color:var(--text3);font-size:12px" onclick="clientsDeleteDoc(\''+d.id+'\')">✕</span>'+
      '</div>';
    }).join('') || '<div style="padding:10px 4px;color:var(--text3);font-size:12.5px">No documents yet.</div>';

    return '<div class="page">'+
      '<div style="margin-bottom:10px"><span onclick="clientsBack()" style="cursor:pointer;font-size:12.5px;color:var(--accent)">← All Clients</span></div>'+
      '<div class="card" style="padding:18px 20px;margin-bottom:16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:start">'+
          '<div><div style="font-size:20px;font-weight:700">'+esc(c.name)+'</div>'+
            '<div style="font-size:13px;color:var(--text3);margin-top:2px">'+esc(c.industry||'')+(c.location?' · '+esc(c.location):'')+(c.website?' · '+esc(c.website):'')+'</div></div>'+
          '<button class="btn btn-sm btn-primary" onclick="clientsOpenEmail(\''+c.id+'\')">✉ Email this client</button>'+
        '</div>'+
      '</div>'+
      '<div class="card" style="padding:0;margin-bottom:16px;overflow-x:auto">'+
        '<div style="padding:14px 16px;font-weight:600;font-size:14px;border-bottom:1px solid var(--border)">Job Orders ('+(jobs?jobs.length:0)+')</div>'+
        '<table style="width:100%;border-collapse:collapse;min-width:640px"><thead><tr style="background:var(--bg)">'+
          ['Code','Title','Status','BD Manager','Created'].map(function(h){ return '<th style="text-align:left;padding:8px 10px;font-size:11px;color:var(--text3);font-weight:700">'+h+'</th>'; }).join('')+
        '</tr></thead><tbody>'+jobRows+'</tbody></table>'+
      '</div>'+
      '<div class="card" style="padding:16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
          '<div style="font-weight:600;font-size:14px">Documents'+(selIds.length?' · '+selIds.length+' selected':'')+'</div>'+
          '<div style="display:flex;gap:8px">'+
            (selIds.length?'<button class="btn btn-sm btn-outline" onclick="clientsOpenEmail(\''+c.id+'\',true)">Email selected</button>':'')+
            '<label class="btn btn-sm btn-primary" style="cursor:pointer;margin:0">+ Upload<input type="file" id="client-doc-file" style="display:none" onchange="clientsUploadDoc(this)"></label>'+
          '</div>'+
        '</div>'+
        docRows+
      '</div>'+
      recentEmailsCard(c)+
    '</div>';
  }

  function recentEmailsCard(c){
    var acts=STATE.clients.emailActivity;
    if(acts===null) return '<div class="card" style="padding:16px;margin-top:16px"><div style="font-weight:600;font-size:14px;margin-bottom:6px">Recent emails</div><div style="font-size:12.5px;color:var(--text3)">Loading…</div></div>';
    var rows=(acts||[]).map(function(a){
      var status=a.replied_at?'<span style="font-size:10.5px;font-weight:700;color:var(--green)">↩ Replied</span>':(a.opened_at?'<span style="font-size:10.5px;font-weight:700;color:var(--accent)">✓ Opened'+(a.open_count>1?' ·'+a.open_count+'×':'')+'</span>':'<span style="font-size:10.5px;color:var(--text3)">Sent</span>');
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border)">'+
        '<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(a.subject||'(no subject)')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+esc(a.to_email||'')+' · '+fmtDate(a.sent_at)+'</div></div>'+
        status+
        '<button class="btn btn-sm btn-outline" onclick="clientsReply(\''+c.id+'\',\''+escAttr(a.to_email||'')+'\',\''+escAttr(a.subject||'')+'\')">Reply</button>'+
      '</div>';
    }).join('') || '<div style="padding:10px 4px;color:var(--text3);font-size:12.5px">No emails sent to this client yet.</div>';
    return '<div class="card" style="padding:16px;margin-top:16px"><div style="font-weight:600;font-size:14px;margin-bottom:8px">Recent emails</div>'+rows+'</div>';
  }
  window.clientsReply=function(companyId,to,subject){
    var re=/^re:/i.test(subject)?subject:('Re: '+subject);
    clientsOpenEmail(companyId,false,{to:to,subject:re,body:'Hi,\n\n\n\nBest regards,'});
  };

  window.clientsDocToggle=function(id){ STATE.clients.selDocs=STATE.clients.selDocs||{}; STATE.clients.selDocs[id]=!STATE.clients.selDocs[id]; paint(); };

  // ── documents ────────────────────────────────────────────────────────────────
  window.clientsUploadDoc = function(input){
    var f=input.files&&input.files[0]; if(!f) return; input.value='';
    if (f.size>4.5*1024*1024){ showToast('File too large (max ~4.5 MB)','error'); return; }
    var r=new FileReader();
    r.onload=function(){
      apiPost('/companies/'+STATE.clients.selectedId+'/documents', { filename:f.name, content_type:f.type||'application/octet-stream', doc_type:'other', data_base64:String(r.result) })
        .then(function(){ showToast('Uploaded','success'); loadClientDetail(STATE.clients.selectedId); })
        .catch(function(e){ showToast('Upload failed: '+e.message,'error'); });
    };
    r.onerror=function(){ showToast('Could not read file','error'); };
    r.readAsDataURL(f);
  };
  window.clientsDeleteDoc = function(id){
    if(!confirm('Delete this document?')) return;
    apiDelete('/companies/'+STATE.clients.selectedId+'/documents/'+id)
      .then(function(){ showToast('Deleted','success'); loadClientDetail(STATE.clients.selectedId); })
      .catch(function(e){ showToast('Failed: '+e.message,'error'); });
  };

  // ── email compose ────────────────────────────────────────────────────────────
  window.clientsOpenEmail = function(companyId, fromSelectedDocs, prefill){
    var c=(STATE.clients.list||[]).find(function(x){ return x.id===companyId; }); if(!c) return;
    var sel=STATE.clients.selDocs||{};
    var docIds = fromSelectedDocs ? Object.keys(sel).filter(function(k){ return sel[k]; }) : [];
    prefill=prefill||{};
    var contacts=STATE.clients.contacts||[];
    var toVal=prefill.to||(contacts[0]&&contacts[0].email)||'';
    STATE.clients._emailDraft = { companyId:companyId, to:toVal, subject:prefill.subject||('Following up — '+c.name), body:prefill.body||'Hi,\n\n\n\nBest regards,', documentIds:docIds };
    // POC dropdown from the client's contacts, with a free-text fallback.
    var toField = contacts.length
      ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
          '<select id="client-em-poc" class="sel" style="flex:1;min-width:180px" onchange="var t=document.getElementById(\'client-em-to\');if(t&&this.value)t.value=this.value">'+
            '<option value="">— pick a contact —</option>'+
            contacts.map(function(ct){return '<option value="'+escAttr(ct.email)+'"'+(ct.email===toVal?' selected':'')+'>'+esc(ct.name||ct.email)+(ct.designation?' · '+esc(ct.designation):'')+' ('+esc(ct.email)+')</option>';}).join('')+
          '</select>'+
          '<input id="client-em-to" class="sel" style="flex:1;min-width:180px" placeholder="or type an email" value="'+escAttr(toVal)+'">'+
        '</div>'
      : '<input id="client-em-to" class="sel" placeholder="contact@client.com" value="'+escAttr(toVal)+'">';
    STATE.modal =
      '<div class="modal modal-w720" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
          '<div style="font-weight:700;font-size:16px">Email '+esc(c.name)+'</div>'+
          (docIds.length?'<div style="font-size:11.5px;color:var(--text3);margin-top:2px">'+docIds.length+' document'+(docIds.length>1?'s':'')+' will be attached.</div>':'')+
        '</div>'+
        '<div style="padding:16px 20px">'+
          '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">To</label>'+
            toField+'</div>'+
          '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Subject</label>'+
            '<input id="client-em-subject" class="sel" value="'+esc(STATE.clients._emailDraft.subject)+'"></div>'+
          '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Message</label>'+
            '<textarea id="client-em-body" class="sel" style="min-height:180px;resize:vertical;font-size:12.5px;line-height:1.5">'+esc(STATE.clients._emailDraft.body)+'</textarea></div>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
          '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
          '<button class="btn btn-primary" onclick="clientsSendEmail()">Send tracked</button>'+
        '</div>'+
      '</div>';
    render();
  };
  window.clientsSendEmail = function(){
    var d=STATE.clients._emailDraft; if(!d) return;
    var to=(document.getElementById('client-em-to')||{}).value||'';
    var subject=(document.getElementById('client-em-subject')||{}).value||d.subject;
    var body=(document.getElementById('client-em-body')||{}).value||d.body;
    if(!to.trim()){ showToast('Recipient email required','error'); return; }
    showToast('Sending…','info');
    apiPost('/companies/'+d.companyId+'/email', { to:to, subject:subject, body:body, document_ids:d.documentIds||[] })
      .then(function(){ showToast('Email sent','success'); closeModal(); })
      .catch(function(e){
        if(/no_connected_mailbox/.test(e.message)) showToast('No connected mailbox — connect one under Email','error');
        else showToast('Send failed: '+e.message,'error');
      });
  };

})();
