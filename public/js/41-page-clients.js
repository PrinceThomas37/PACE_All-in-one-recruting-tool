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
  // The shell draws this page itself now (UI.registerPage below), so there is
  // no render() wrapper repainting #content a second time.
  // (The "Clients" nav item is now built by the sidebar in 04-shell-login.js,
  // positioned above Candidates.)
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p==='clients'){ STATE.page='clients'; STATE.modal=null; STATE.clients.selectedId=null; render(); loadClients(); return; }
    return _prevGoPage.apply(this, arguments);
  };
  function paint(){ if(STATE.page!=='clients')return; paintPageContent(); }
  UI.registerPage('clients', function(){ return renderClients(); });

  // ── data ─────────────────────────────────────────────────────────────────────
  function loadClients(){
    STATE.clients.loading=true; paint();
    return apiGet('/clients').then(function(d){ STATE.clients.list=d||[]; STATE.clients.loading=false; paint(); })
      .catch(function(e){ STATE.clients.loading=false; showToast('Failed to load clients: '+e.message,'error'); paint(); });
  }
  // Repaint just the open drawer. paint() rebuilds #content, and the drawer is
  // an OVERLAY drawn after #content — so these four responses would otherwise
  // land in state and never reach the screen.
  function paintDetail(){
    var el=document.querySelector('.dwr-scrim');
    if(!el) return paint();
    var html=renderClientDetail();
    if(!html) return;
    var d=document.createElement('div'); d.innerHTML=html;
    if(d.firstChild) el.replaceWith(d.firstChild);
  }

  function loadClientDetail(id){
    STATE.clients.jobOrders=null; STATE.clients.documents=null; STATE.clients.docsLoading=true;
    STATE.clients.contacts=null; STATE.clients.emailActivity=null;
    apiGet('/companies/'+id+'/job-orders').then(function(d){ STATE.clients.jobOrders=d||[]; paintDetail(); }).catch(function(){ STATE.clients.jobOrders=[]; paintDetail(); });
    apiGet('/companies/'+id+'/documents').then(function(d){ STATE.clients.documents=d||[]; STATE.clients.docsLoading=false; paintDetail(); })
      .catch(function(){ STATE.clients.documents=[]; STATE.clients.docsLoading=false; paintDetail(); });
    apiGet('/companies/'+id+'/contacts').then(function(d){ STATE.clients.contacts=d||[]; paintDetail(); }).catch(function(){ STATE.clients.contacts=[]; });
    apiGet('/companies/'+id+'/email-activity').then(function(d){ STATE.clients.emailActivity=d||[]; paintDetail(); }).catch(function(){ STATE.clients.emailActivity=[]; });
  }
  // Opening or closing a client changes an OVERLAY, which lives outside
  // #content — so these go through render(), not paint().
  window.clientsOpen = function(id){ STATE.clients.selectedId=id; STATE.clients.selDocs={}; loadClientDetail(id); render(); };
  window.clientsBack = function(){ STATE.clients.selectedId=null; render(); };
  window.clientsSearch = function(v){ STATE.clients.q=v; paint(); };

  // ── list page ────────────────────────────────────────────────────────────────
  // The client record opens OVER its list, the same as a candidate: close it and
  // you are back on the same list with the same search still typed.
  UI.registerOverlay('client', function(){
    return (STATE.page==='clients' && STATE.clients && STATE.clients.selectedId)
      ? renderClientDetail() : '';
  });

  function renderClients(){
    if (STATE.clients.loading || STATE.clients.list===null)
      return UI.page({ body:'<div class="dt-empty">Loading clients…</div>' });

    var all=STATE.clients.list||[];
    var q=(STATE.clients.q||'').toLowerCase();
    var list=all.filter(function(c){ return !q || (c.name||'').toLowerCase().indexOf(q)>-1; });

    // Counts describe every client, not the filtered view — the strip is what
    // you filter against, so searching must not move it.
    var openJos=all.reduce(function(n,c){ return n+(c.open_job_order_count||0); },0);
    var totalJos=all.reduce(function(n,c){ return n+(c.job_order_count||0); },0);
    var withOpen=all.filter(function(c){ return c.open_job_order_count>0; }).length;

    var rows=list.map(function(c){
      return { onclick:"clientsOpen('"+c.id+"')", cells:[
        { html: UI.idCell(c.name||'—', c.website||'', null) },
        { html: UI.dash(c.industry) },
        { cls:'tight', html: UI.dash(c.location) },
        { cls:'tight', html: c.open_job_order_count
            ? UI.pill(c.open_job_order_count+' open','ok',true)+
              '<span style="margin-left:7px;color:var(--ink3)">'+c.job_order_count+' total</span>'
            : '<span style="color:var(--ink3)">'+(c.job_order_count||0)+' total</span>' }
      ]};
    });

    return UI.page({
      strip: UI.strip([
        { v:all.length,  label:'Clients',          icon:'building' },
        { sep:true },
        { v:withOpen,    label:'Hiring right now', icon:'flame' },
        { v:openJos,     label:'Open job orders',  icon:'doc' },
        { v:totalJos,    label:'Job orders, all time' }
      ]),
      toolbar: UI.toolbar({
        search:{ value:STATE.clients.q||'', placeholder:'Search clients…', oninput:'clientsSearch(this.value)' },
        right:'<span style="font-size:12.5px;color:var(--ink3)">Companies with at least one job order — leads that turned into real business.</span>'
      }),
      body: UI.table({
        cols:[{label:'Client',icon:'building'},'Industry','Location','Job orders'],
        rows:rows, minWidth:'680px',
        empty: q
          ? 'No client matches “'+esc(STATE.clients.q)+'”.'
          : 'No clients yet — a company appears here once one of its leads converts into a job order.'
      })
    });
  }

  function renderClientDetail(){
    var c=(STATE.clients.list||[]).find(function(x){ return x.id===STATE.clients.selectedId; }); if(!c) return '';
    var jobs=STATE.clients.jobOrders;
    var docs=STATE.clients.documents;
    var sel=STATE.clients.selDocs||{};
    var selIds=Object.keys(sel).filter(function(k){ return sel[k]; });
    var tab=STATE.clients.tab||'jobs';

    var jobRows=(jobs||[]).map(function(j){
      return { cells:[
        { cls:'tight', html:'<span style="font-family:var(--mono);font-size:11.5px;color:var(--ink3)">'+esc(j.job_code||'')+'</span>' },
        { html: esc(j.job_title||'—') },
        { cls:'tight', html: j.status ? UI.pill(j.status, /open|active/i.test(j.status)?'ok':'mute', true) : UI.dash('') },
        { cls:'tight', html: UI.dash((j.bd_manager&&j.bd_manager.name)||'') },
        { cls:'tight', html:'<span style="color:var(--ink3)">'+fmtDate(j.created_at)+'</span>' }
      ]};
    });

    var docRows=(docs||[]).map(function(d){
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--line)">'+
        '<input type="checkbox" class="ck" '+(sel[d.id]?'checked':'')+' onclick="clientsDocToggle(\''+d.id+'\')">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:600">'+(d.url?'<a href="'+esc(d.url)+'" target="_blank" rel="noopener" style="color:var(--accent)">'+esc(d.filename)+'</a>':esc(d.filename))+'</div>'+
          '<div style="font-size:11.5px;color:var(--ink3)">'+esc(d.doc_type||'')+' · '+esc((d.uploader&&d.uploader.name)||'—')+' · '+fmtDate(d.uploaded_at)+'</div>'+
        '</div>'+
        '<span class="kebab" title="Delete" onclick="clientsDeleteDoc(\''+d.id+'\')">'+UI.ic('trash')+'</span>'+
      '</div>';
    }).join('') || '<div class="dt-empty">No documents yet.</div>';

    var tabBar='<div class="pgtabs">'+
      [{id:'jobs',label:'Job orders',n:(jobs?jobs.length:0)},
       {id:'emails',label:'Emails',n:(STATE.clients.emailActivity||[]).length},
       {id:'docs',label:'Documents',n:(docs?docs.length:0)}].map(function(t){
        return '<div class="pgtab'+(tab===t.id?' on':'')+'" data-cltab="'+t.id+'" onclick="clientsTab(\''+t.id+'\')">'+
          t.label+'<span class="pgtab-n">'+t.n+'</span></div>';
      }).join('')+'</div>';

    // Both panels render; the inactive one is hidden. Same reason as the
    // candidate drawer — a tab click must not rebuild the DOM under an upload.
    var body=
      '<div class="feed" data-clpanel="jobs" style="padding:16px 18px"'+(tab==='jobs'?'':' hidden')+'>'+
        UI.table({ cols:['Code','Title','Status','BD manager','Created'], rows:jobRows,
                   minWidth:'620px', empty:'No job orders for this client yet.' })+
      '</div>'+
      '<div class="feed" data-clpanel="emails" style="padding:16px 18px"'+(tab==='emails'?'':' hidden')+'>'+
        recentEmailsCard(c)+
      '</div>'+
      '<div class="feed" data-clpanel="docs" style="padding:16px 18px"'+(tab==='docs'?'':' hidden')+'>'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
          '<div style="font-weight:600;font-size:13.5px">Documents'+(selIds.length?' · '+selIds.length+' selected':'')+'</div>'+
          '<div style="display:flex;gap:8px">'+
            (selIds.length?'<button class="btn btn-sm btn-outline" onclick="clientsOpenEmail(\''+c.id+'\',true)">Email selected</button>':'')+
            '<label class="btn btn-sm btn-primary" style="cursor:pointer;margin:0">'+UI.ic('plus')+'Upload'+
              '<input type="file" id="client-doc-file" style="display:none" onchange="clientsUploadDoc(this)"></label>'+
          '</div>'+
        '</div>'+ docRows+
      '</div>';

    var initials=(String(c.name||'?').trim().split(/\s+/).slice(0,2)
      .map(function(w){ return (w[0]||''); }).join('')||'?').toUpperCase();

    return UI.drawer({
      avatar:'<div class="av av-48 av-bd" style="font-size:16px">'+esc(initials)+'</div>',
      name: c.name||'Client',
      sub: [c.industry, c.location].filter(Boolean).join(' · '),
      onclose:'clientsBack()',
      acts:[
        { icon:'mail',     title:'Email this client', onclick:"clientsOpenEmail('"+c.id+"')" },
        { icon:'mailopen', title:'Email history',     onclick:"clientsTab('emails')" },
        { icon:'doc',      title:'Documents',         onclick:"clientsTab('docs')" }
      ],
      stats:[
        { v:(c.open_job_order_count||0), label:'Open',      icon:'flame' },
        { v:(c.job_order_count||0),      label:'All time',  icon:'doc' },
        { v:(docs?docs.length:0),        label:'Documents', icon:'note' }
      ],
      fields:
        UI.kv('Industry', c.industry, { placeholder:'Not recorded' })+
        UI.kv('Location', c.location, { placeholder:'Not recorded' })+
        (c.website
          ? UI.kv('Website','<a href="'+esc(/^https?:/.test(c.website)?c.website:'https://'+c.website)+'" target="_blank" rel="noopener" style="color:var(--accent)">'+esc(c.website)+'</a>',{ html:true })
          : UI.kv('Website','',{ placeholder:'Not recorded' })),
      tabs: tabBar,
      body: body
    });
  }

  // Toggles the panel that is already in the DOM — never a re-render, so an
  // in-progress upload or a half-made selection survives a tab click.
  window.clientsTab=function(id){
    if(STATE.clients) STATE.clients.tab=id;
    var root=document.querySelector('.dwr-right'); if(!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-clpanel]'), function(el){
      el.hidden = el.getAttribute('data-clpanel')!==id;
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-cltab]'), function(el){
      el.classList.toggle('on', el.getAttribute('data-cltab')===id);
    });
  };

  function recentEmailsCard(c){
    var acts=STATE.clients.emailActivity;
    if(acts===null) return '<div class="dt-empty">Loading email history…</div>';
    var rows=(acts||[]).map(function(a){
      var status=a.replied_at?'<span style="font-size:10.5px;font-weight:700;color:var(--green)">↩ Replied</span>':(a.opened_at?'<span style="font-size:10.5px;font-weight:700;color:var(--accent)">✓ Opened'+(a.open_count>1?' ·'+a.open_count+'×':'')+'</span>':'<span style="font-size:10.5px;color:var(--text3)">Sent</span>');
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border)">'+
        '<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(a.subject||'(no subject)')+'</div>'+
          '<div style="font-size:11px;color:var(--text3)">'+esc(a.to_email||'')+' · '+fmtDate(a.sent_at)+'</div></div>'+
        status+
        '<button class="btn btn-sm btn-outline" onclick="clientsReply(\''+c.id+'\',\''+escAttr(a.to_email||'')+'\',\''+escAttr(a.subject||'')+'\')">Reply</button>'+
      '</div>';
    }).join('') || '<div class="dt-empty">No emails sent to this client yet.</div>';
    return rows;
  }
  window.clientsReply=function(companyId,to,subject){
    var re=/^re:/i.test(subject)?subject:('Re: '+subject);
    clientsOpenEmail(companyId,false,{to:to,subject:re,body:'Hi,\n\n\n\nBest regards,'});
  };

  window.clientsDocToggle=function(id){ STATE.clients.selDocs=STATE.clients.selDocs||{}; STATE.clients.selDocs[id]=!STATE.clients.selDocs[id]; paintDetail(); };

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
