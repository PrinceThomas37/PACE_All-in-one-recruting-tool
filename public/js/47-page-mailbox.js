// ── INBOX — the connected mailbox, inside PACE ───────────────────────────────
// A real three-pane mail client over the user's own connected mailboxes:
// accounts + folders on the left, the message list in the middle, the message
// itself on the right. Reply, reply-all, compose, archive, trash, mark
// read/unread, search, and per-folder paging.
//
// Two decisions worth knowing before editing this file:
//
// 1. THE BODY RENDERS IN A SANDBOXED IFRAME, never in the page. An email body
//    is the single most hostile HTML this app handles — it is written by
//    whoever felt like emailing you. The server sanitises it (see
//    services/mail-provider.js) and this renders the result with no script and
//    no same-origin permission, so even a sanitiser bug cannot reach STATE, the
//    session token, or the DOM. Do not "simplify" this into an innerHTML.
//
// 2. REMOTE IMAGES ARE BLOCKED until the reader asks for them, per message. A
//    remote image in an inbound email is usually a tracking pixel — the exact
//    technique PACE uses on its own outbound mail — so loading it silently
//    tells a stranger when their mail was opened.
//
// Nothing here is cached in the database: every list and every body is a live
// read of the real mailbox. Delete means "move to Trash", recoverable from
// Outlook or Gmail; nothing in this UI can destroy mail outright.

(function () {

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  STATE.mailbox = STATE.mailbox || {
    accounts:null, accountsLoading:false, activeId:null,
    folders:null, folderId:null, foldersLoading:false,
    messages:null, nextCursor:null, listLoading:false, q:'',
    selectedId:null, message:null, msgLoading:false,
    crm:{}, showImages:false, replying:false, replyAll:false,
    unread:0, error:null
  };
  var M = function(){ return STATE.mailbox; };

  // ── nav + routing ──────────────────────────────────────────────────────────
  var _prevRender = window.render;
  window.render = function(){
    _prevRender.apply(this, arguments);
    if (STATE.page==='mailbox'){ paint(); var t=document.querySelector('.tb-title'); if(t) t.textContent='Inbox'; }
  };
  var _prevGoPage = window.goPage;
  window.goPage = function(p){
    if (p==='mailbox'){
      STATE.page='mailbox'; STATE.modal=null;
      render();
      loadAccounts();
      return;
    }
    return _prevGoPage.apply(this, arguments);
  };
  function paint(){ if(STATE.page!=='mailbox')return; var c=document.getElementById('content'); if(c) c.innerHTML=renderMailbox(); }

  // ── data ───────────────────────────────────────────────────────────────────
  function loadAccounts(force){
    var m=M();
    if (m.accounts && !force){ if(!m.activeId) pickAccount(m.accounts); return; }
    m.accountsLoading=true; paint();
    apiGet('/mailbox/accounts').then(function(d){
      m.accounts=d||[]; m.accountsLoading=false;
      pickAccount(m.accounts);
      paint();
    }).catch(function(e){
      m.accountsLoading=false; m.error=e.message; paint();
    });
  }
  function pickAccount(list){
    var m=M();
    var readable=(list||[]).filter(function(a){return a.readable;});
    if(!readable.length){ paint(); return; }
    // Keep the current pick if it is still openable; otherwise the primary.
    if(!m.activeId || !readable.some(function(a){return a.id===m.activeId;})) m.activeId=readable[0].id;
    loadFolders();
  }

  function loadFolders(){
    var m=M(); if(!m.activeId)return;
    m.foldersLoading=true; m.folders=null; m.error=null; paint();
    apiGet('/mailbox/'+encodeURIComponent(m.activeId)+'/folders').then(function(d){
      m.folders=d||[]; m.foldersLoading=false;
      var inbox=m.folders.filter(function(f){return f.kind==='inbox';})[0];
      m.folderId=(inbox&&inbox.id)||(m.folders[0]&&m.folders[0].id)||null;
      paint();
      loadMessages();
    }).catch(function(e){
      m.foldersLoading=false; m.folders=[]; m.error=e.message; paint();
    });
  }

  function loadMessages(cursor){
    var m=M(); if(!m.activeId)return;
    m.listLoading=true;
    if(!cursor){ m.messages=null; m.selectedId=null; m.message=null; }
    paint();
    var p='/mailbox/'+encodeURIComponent(m.activeId)+'/messages?limit=25';
    if(m.folderId) p+='&folder='+encodeURIComponent(m.folderId);
    if(m.q) p+='&q='+encodeURIComponent(m.q);
    if(cursor) p+='&cursor='+encodeURIComponent(cursor);
    apiGet(p).then(function(d){
      // Appending on "load more", replacing otherwise.
      m.messages=cursor?(m.messages||[]).concat(d.messages||[]):(d.messages||[]);
      m.nextCursor=d.next_cursor||null;
      m.crm=Object.assign(m.crm||{}, d.crm||{});
      m.listLoading=false; m.error=null;
      paint();
    }).catch(function(e){
      m.listLoading=false; m.error=e.message;
      if(!cursor) m.messages=[];
      paint();
    });
  }

  function loadMessage(id){
    var m=M();
    m.selectedId=id; m.message=null; m.msgLoading=true;
    m.showImages=false; m.replying=false; m.replyAll=false;
    paint();
    var p='/mailbox/'+encodeURIComponent(m.activeId)+'/messages/'+encodeURIComponent(id);
    apiGet(p).then(function(d){
      if(m.selectedId!==id)return; // the user moved on while this was in flight
      m.message=d; m.msgLoading=false;
      m.crm=Object.assign(m.crm||{}, d.crm||{});
      paint();
      // Opening a message marks it read, the way every mail client behaves.
      // Optimistic locally so the row un-bolds immediately.
      if(d.unread) markRead(id, true, true);
    }).catch(function(e){
      if(m.selectedId!==id)return;
      m.msgLoading=false; m.error=e.message; paint();
    });
  }

  function markRead(id, read, quiet){
    var m=M();
    (m.messages||[]).forEach(function(x){ if(x.id===id) x.unread=!read; });
    if(m.message&&m.message.id===id) m.message.unread=!read;
    if(!quiet) paint();
    apiPatch('/mailbox/'+encodeURIComponent(m.activeId)+'/messages/'+encodeURIComponent(id),{read:!!read})
      .then(function(){ refreshUnread(true); })
      .catch(function(){ /* the list is a view of the server, not the truth */ });
  }

  // Drop a message out of the list without a full reload — archiving or
  // trashing from the reading pane should feel instant.
  function removeFromList(id){
    var m=M();
    m.messages=(m.messages||[]).filter(function(x){return x.id!==id;});
    if(m.selectedId===id){ m.selectedId=null; m.message=null; }
    paint(); refreshUnread(true);
  }

  // ── actions ────────────────────────────────────────────────────────────────
  window.mbSelectAccount=function(id){ var m=M(); if(m.activeId===id)return; m.activeId=id; m.q=''; loadFolders(); };
  window.mbSelectFolder=function(id){ var m=M(); if(m.folderId===id)return; m.folderId=id; loadMessages(); };
  window.mbOpen=function(id){ loadMessage(id); };
  window.mbBack=function(){ var m=M(); m.selectedId=null; m.message=null; paint(); };
  window.mbLoadMore=function(){ var m=M(); if(m.nextCursor) loadMessages(m.nextCursor); };
  window.mbRefresh=function(){ var m=M(); m.crm={}; loadMessages(); refreshUnread(true); };
  window.mbSearch=function(v){
    var m=M(); if(m.q===v)return; m.q=v; loadMessages();
  };
  window.mbSearchKey=function(ev){ if(ev&&ev.key==='Enter') mbSearch(ev.target.value||''); };
  window.mbClearSearch=function(){ var m=M(); if(!m.q)return; m.q=''; loadMessages(); };
  window.mbToggleRead=function(id,ev){
    if(ev&&ev.stopPropagation)ev.stopPropagation();
    var m=M(); var row=(m.messages||[]).filter(function(x){return x.id===id;})[0];
    markRead(id, !!(row&&row.unread));
  };
  window.mbShowImages=function(){
    var m=M(); if(!m.message)return;
    m.showImages=true; m.msgLoading=true; paint();
    apiGet('/mailbox/'+encodeURIComponent(m.activeId)+'/messages/'+encodeURIComponent(m.message.id)+'?images=show')
      .then(function(d){ m.message=d; m.msgLoading=false; paint(); })
      .catch(function(e){ m.msgLoading=false; showToast('Could not load images: '+e.message,'error'); paint(); });
  };
  window.mbArchive=function(id,ev){
    if(ev&&ev.stopPropagation)ev.stopPropagation();
    var m=M();
    apiPost('/mailbox/'+encodeURIComponent(m.activeId)+'/messages/'+encodeURIComponent(id)+'/archive',{})
      .then(function(){ showToast('Archived','success'); removeFromList(id); })
      .catch(function(e){ showToast('Could not archive: '+e.message,'error'); });
  };
  window.mbTrash=function(id,ev){
    if(ev&&ev.stopPropagation)ev.stopPropagation();
    var m=M();
    apiDelete('/mailbox/'+encodeURIComponent(m.activeId)+'/messages/'+encodeURIComponent(id))
      // Said out loud on purpose: this moved the real message in the real
      // mailbox, and the user needs to know where to find it again.
      .then(function(){ showToast('Moved to Trash — still recoverable in your mailbox','success'); removeFromList(id); })
      .catch(function(e){ showToast('Could not delete: '+e.message,'error'); });
  };
  window.mbReply=function(all){
    var m=M(); if(!m.message)return;
    m.replying=true; m.replyAll=!!all; paint();
    var ta=document.getElementById('mb-reply-body'); if(ta) ta.focus();
  };
  window.mbCancelReply=function(){ var m=M(); m.replying=false; paint(); };
  window.mbSendReply=function(){
    var m=M(); if(!m.message)return;
    var ta=document.getElementById('mb-reply-body');
    var body=(ta&&ta.value||'').trim();
    if(!body){ showToast('Write a message first','warning'); return; }
    var btn=document.getElementById('mb-reply-send');
    if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
    apiPost('/mailbox/'+encodeURIComponent(m.activeId)+'/messages/'+encodeURIComponent(m.message.id)+'/reply',
      { body:body, reply_all:!!m.replyAll })
      .then(function(){ showToast('Reply sent','success'); m.replying=false; paint(); })
      .catch(function(e){
        showToast('Send failed: '+e.message,'error');
        if(btn){ btn.disabled=false; btn.textContent='Send'; }
      });
  };
  window.mbCompose=function(prefillTo){
    var m=M();
    if(!m.activeId){ showToast('Connect a mailbox first','warning'); return; }
    var from=(m.accounts||[]).filter(function(a){return a.id===m.activeId;})[0]||{};
    STATE.modal=
      '<div class="modal modal-w640" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
          '<div style="font-weight:700;font-size:16px">New message</div>'+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:2px">From '+esc(from.email_address||'')+'</div>'+
        '</div>'+
        '<div style="padding:16px 20px">'+
          '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">To</label>'+
            '<input id="mb-c-to" class="sel" placeholder="someone@company.com" value="'+escAttr(prefillTo||'')+'"></div>'+
          '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Cc <span style="color:var(--text3)">(optional)</span></label>'+
            '<input id="mb-c-cc" class="sel" placeholder=""></div>'+
          '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Subject</label>'+
            '<input id="mb-c-subject" class="sel" placeholder=""></div>'+
          '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Message</label>'+
            '<textarea id="mb-c-body" class="sel" style="min-height:200px;resize:vertical;font-size:12.5px;line-height:1.55"></textarea></div>'+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
          '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
          '<button class="btn btn-primary" id="mb-c-send" onclick="mbSendCompose()">Send</button>'+
        '</div>'+
      '</div>';
    render();
  };
  window.mbSendCompose=function(){
    var m=M();
    var to=(document.getElementById('mb-c-to')||{}).value||'';
    var cc=(document.getElementById('mb-c-cc')||{}).value||'';
    var subject=(document.getElementById('mb-c-subject')||{}).value||'';
    var body=(document.getElementById('mb-c-body')||{}).value||'';
    if(!to.trim()){ showToast('Who is this going to?','warning'); return; }
    if(!body.trim()){ showToast('Write a message first','warning'); return; }
    var btn=document.getElementById('mb-c-send');
    if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
    apiPost('/mailbox/'+encodeURIComponent(m.activeId)+'/send',{to:to,cc:cc,subject:subject,body:body})
      .then(function(){ showToast('Sent','success'); closeModal(); })
      .catch(function(e){
        showToast('Send failed: '+e.message,'error');
        if(btn){ btn.disabled=false; btn.textContent='Send'; }
      });
  };
  // The point of reading mail inside an ATS rather than in Gmail: this sender
  // is already someone we are working, so go straight to their record.
  window.mbOpenCrm=function(email,ev){
    if(ev&&ev.stopPropagation)ev.stopPropagation();
    var link=(M().crm||{})[String(email||'').toLowerCase()];
    if(!link)return;
    if(link.type==='contact'&&link.job_id&&typeof openJob==='function')return openJob(link.job_id);
    if(link.type==='candidate'&&typeof bdOpenCandidate==='function')return bdOpenCandidate(link.id);
    goPage('leads');
  };

  // ── the nav badge ──────────────────────────────────────────────────────────
  // One number, cached server-side for a minute, so clicking around the app
  // does not turn into a provider call per render.
  var _unreadAt=0;
  window.refreshUnread=function(force){
    if(!STATE.user)return;
    if(!force && Date.now()-_unreadAt < 60000) return;
    _unreadAt=Date.now();
    apiGet('/mailbox/unread-count').then(function(d){
      var m=M(); var was=m.unread;
      m.unread=(d&&d.unread)||0;
      if(m.unread!==was) scheduleRender();
    }).catch(function(){ /* no mailbox connected — the badge just stays empty */ });
  };

  // ── rendering ──────────────────────────────────────────────────────────────
  var ICONS={
    inbox:'M3 12h4l2 3h6l2-3h4M3 12l2.5-7h13L21 12v7H3v-7z',
    sent:'M3 20l18-8L3 4v6l12 2-12 2v6z',
    drafts:'M4 4h11l5 5v11H4V4z M15 4v5h5',
    archive:'M3 6h18v4H3V6z M5 10v10h14V10 M10 14h4',
    junk:'M12 3l9 16H3l9-16z M12 9v4 M12 16v.5',
    trash:'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
    custom:'M3 6h6l2 2h10v11H3V6z'
  };
  function icon(kind,size){
    var d=ICONS[kind]||ICONS.custom; size=size||15;
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" '+
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex:none">'+
      d.split(' M').map(function(seg,i){return '<path d="'+(i?'M'+seg:seg)+'"/>';}).join('')+'</svg>';
  }

  // Time for today, weekday for the last week, date beyond that — the same
  // shorthand every mail client uses, because a column of full timestamps is
  // unreadable at a glance.
  function fmtWhen(s){
    if(!s)return '';
    try{
      var d=new Date(s), now=new Date();
      var sameDay=d.toDateString()===now.toDateString();
      if(sameDay) return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
      var days=(now-d)/86400000;
      if(days<7&&days>=0) return d.toLocaleDateString([], {weekday:'short'});
      if(d.getFullYear()===now.getFullYear()) return d.toLocaleDateString([], {day:'numeric',month:'short'});
      return d.toLocaleDateString([], {day:'numeric',month:'short',year:'2-digit'});
    }catch(e){ return ''; }
  }
  function fmtFull(s){ if(!s)return ''; try{ return new Date(s).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}); }catch(e){ return ''; } }
  function who(a){ return (a&&(a.name||a.email))||'(unknown)'; }
  function fmtSize(n){
    n=Number(n)||0;
    if(n<1024) return n+' B';
    if(n<1048576) return Math.round(n/1024)+' KB';
    return (n/1048576).toFixed(1)+' MB';
  }

  function crmChip(email){
    var link=(M().crm||{})[String(email||'').toLowerCase()];
    if(!link)return '';
    var isC=link.type==='contact';
    return '<span onclick="mbOpenCrm(\''+escAttr(email)+'\',event)" title="Open in PACE" '+
      'style="cursor:pointer;display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;padding:1px 6px;border-radius:999px;'+
      'background:'+(isC?'var(--accent-l)':'var(--purple-l)')+';color:'+(isC?'var(--accent-d)':'var(--purple)')+'">'+
      (isC?'Lead':'Candidate')+'</span>';
  }

  function renderMailbox(){
    var m=M();
    if(m.accountsLoading||m.accounts===null)
      return '<div class="page"><div style="text-align:center;padding:60px;color:var(--text3)">Loading your mailboxes…</div></div>';

    var readable=(m.accounts||[]).filter(function(a){return a.readable;});
    if(!readable.length) return renderNoMailbox();

    return '<div class="page" style="padding:0;height:100%;display:flex;flex-direction:column;overflow:hidden">'+
      renderTopBar(readable)+
      '<div style="flex:1;display:flex;min-height:0;border-top:1px solid var(--border)">'+
        renderFolderRail()+
        renderList()+
        renderReader()+
      '</div>'+
    '</div>';
  }

  // Nothing connected. This is a setup state, not an error — say what to do.
  function renderNoMailbox(){
    var m=M();
    var broken=(m.accounts||[]).filter(function(a){return !a.readable;});
    return '<div class="page">'+
      '<div class="card" style="max-width:560px;margin:40px auto;padding:32px;text-align:center">'+
        '<div style="color:var(--text3);margin-bottom:14px">'+icon('inbox',40)+'</div>'+
        '<div style="font-weight:700;font-size:17px;margin-bottom:6px">No mailbox connected yet</div>'+
        '<div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:18px">'+
          'Connect your Outlook or Gmail account and your inbox, sent mail and folders appear here — '+
          'so you can work your email without leaving PACE.'+
        '</div>'+
        (broken.length
          ? '<div style="background:var(--amber-l);border:1px solid var(--amber);border-radius:var(--r);padding:10px 12px;font-size:12px;color:var(--amber);margin-bottom:16px;text-align:left">'+
            broken.map(function(a){
              return '<div><b>'+esc(a.email_address)+'</b> — '+
                (a.is_active===false?'switched off':(a.connection&&a.connection.status==='expired'?'sign-in expired, needs reconnecting':'not connected'))+'</div>';
            }).join('')+
            '</div>'
          : '')+
        '<button class="btn btn-primary" onclick="goPage(\'emailaccounts\')">Set up a mailbox</button>'+
      '</div>'+
    '</div>';
  }

  function renderTopBar(readable){
    var m=M();
    var accountPicker = readable.length>1
      ? '<select class="sel" style="width:auto;max-width:280px;font-size:12.5px" onchange="mbSelectAccount(this.value)">'+
          readable.map(function(a){
            return '<option value="'+escAttr(a.id)+'"'+(a.id===m.activeId?' selected':'')+'>'+
              esc(a.email_address)+(a.platform==='Gmail'?' · Gmail':' · Outlook')+'</option>';
          }).join('')+
        '</select>'
      : '<div style="font-size:13px;font-weight:600">'+esc((readable[0]||{}).email_address||'')+
        '<span style="font-weight:400;color:var(--text3)"> · '+esc((readable[0]||{}).platform==='Gmail'?'Gmail':'Outlook')+'</span></div>';

    return '<div style="padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--card)">'+
      accountPicker+
      '<div style="flex:1;min-width:160px;position:relative">'+
        '<input class="sel" id="mb-search" placeholder="Search this mailbox…" value="'+escAttr(m.q||'')+'" '+
          'onkeydown="mbSearchKey(event)" style="font-size:12.5px;padding-right:'+(m.q?'60px':'12px')+'">'+
        (m.q?'<button class="btn btn-xs btn-ghost" onclick="mbClearSearch()" style="position:absolute;right:6px;top:50%;transform:translateY(-50%)">Clear</button>':'')+
      '</div>'+
      '<button class="btn btn-sm btn-outline" onclick="mbRefresh()">Refresh</button>'+
      '<button class="btn btn-sm btn-primary" onclick="mbCompose()">Compose</button>'+
    '</div>';
  }

  function renderFolderRail(){
    var m=M();
    if(m.foldersLoading) return '<div style="width:190px;border-right:1px solid var(--border);padding:14px;color:var(--text3);font-size:12px">Loading…</div>';
    var folders=m.folders||[];
    return '<div style="width:190px;min-width:190px;border-right:1px solid var(--border);background:var(--card);overflow-y:auto;padding:8px 0">'+
      folders.map(function(f){
        var on=f.id===m.folderId;
        return '<div onclick="mbSelectFolder(\''+escAttr(f.id)+'\')" '+
          'style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;font-size:12.5px;'+
          (on?'background:var(--accent-l);color:var(--accent-d);font-weight:600;border-left:2px solid var(--accent)':'color:var(--text2);border-left:2px solid transparent')+'">'+
          icon(f.kind)+
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(f.name)+'</span>'+
          (f.unread?'<span style="font-size:10.5px;font-weight:700;background:var(--accent);color:#fff;border-radius:999px;padding:1px 6px;min-width:20px;text-align:center">'+f.unread+'</span>':'')+
        '</div>';
      }).join('')+
      (folders.length?'':'<div style="padding:14px;color:var(--text3);font-size:12px">No folders</div>')+
    '</div>';
  }

  function renderList(){
    var m=M();
    var wide=!m.selectedId;
    var body;
    if(m.listLoading&&m.messages===null) body='<div style="padding:40px;text-align:center;color:var(--text3);font-size:12.5px">Loading messages…</div>';
    else if(m.error&&!(m.messages||[]).length)
      body='<div style="padding:30px;text-align:center;color:var(--red);font-size:12.5px">'+esc(m.error)+'</div>';
    else if(!(m.messages||[]).length)
      body='<div style="padding:40px;text-align:center;color:var(--text3);font-size:12.5px">'+(m.q?'Nothing matched “'+esc(m.q)+'”':'Nothing here')+'</div>';
    else body=(m.messages||[]).map(function(x){ return renderRow(x, m.selectedId===x.id); }).join('');

    return '<div style="'+(wide?'flex:1':'width:380px;min-width:340px')+';border-right:1px solid var(--border);overflow-y:auto;background:var(--card)">'+
      body+
      (m.nextCursor
        ? '<div style="padding:12px;text-align:center"><button class="btn btn-sm btn-outline" onclick="mbLoadMore()"'+(m.listLoading?' disabled':'')+'>'+(m.listLoading?'Loading…':'Load more')+'</button></div>'
        : '')+
    '</div>';
  }

  function renderRow(x, active){
    var m=M();
    // In Sent and Drafts the useful name is the recipient, not us.
    var folder=(m.folders||[]).filter(function(f){return f.id===m.folderId;})[0];
    var outbound=folder&&(folder.kind==='sent'||folder.kind==='drafts');
    var party=outbound?((x.to||[])[0]||{}):(x.from||{});
    var partyEmail=party.email||'';
    return '<div onclick="mbOpen(\''+escAttr(x.id)+'\')" '+
      'style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;'+
      (active?'background:var(--accent-l);':(x.unread?'background:#fff;':'background:var(--card);'))+'">'+
      '<div style="display:flex;align-items:baseline;gap:8px">'+
        '<div style="flex:1;min-width:0;font-size:12.5px;'+(x.unread?'font-weight:700;color:var(--text)':'font-weight:500;color:var(--text2)')+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+
          (outbound?'To ':'')+esc(who(party))+'</div>'+
        (crmChip(partyEmail)||'')+
        '<div style="font-size:10.5px;color:var(--text3);flex:none">'+esc(fmtWhen(x.date))+'</div>'+
      '</div>'+
      '<div style="font-size:12.5px;margin-top:2px;'+(x.unread?'font-weight:600;color:var(--text)':'color:var(--text2)')+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+
        esc(x.subject||'(no subject)')+'</div>'+
      '<div style="display:flex;align-items:center;gap:6px;margin-top:2px">'+
        '<div style="flex:1;min-width:0;font-size:11.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(x.preview||'')+'</div>'+
        (x.has_attachments?'<span title="Has attachments" style="font-size:11px;color:var(--text3);flex:none">📎</span>':'')+
      '</div>'+
    '</div>';
  }

  function renderReader(){
    var m=M();
    if(!m.selectedId) return '';
    if(m.msgLoading&&!m.message)
      return '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:12.5px">Opening…</div>';
    var x=m.message;
    if(!x) return '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--red);font-size:12.5px">'+esc(m.error||'Could not open this message')+'</div>';

    var toLine=(x.to||[]).map(who).join(', ');
    var ccLine=(x.cc||[]).map(who).join(', ');

    return '<div style="flex:1;min-width:0;display:flex;flex-direction:column;background:var(--card)">'+
      // header
      '<div style="padding:14px 18px;border-bottom:1px solid var(--border)">'+
        '<div style="display:flex;align-items:flex-start;gap:10px">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:15px;font-weight:700;line-height:1.35">'+esc(x.subject||'(no subject)')+'</div>'+
            '<div style="font-size:12px;color:var(--text2);margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+
              '<b>'+esc(who(x.from))+'</b>'+
              '<span style="color:var(--text3)">&lt;'+esc((x.from||{}).email||'')+'&gt;</span>'+
              (crmChip((x.from||{}).email)||'')+
            '</div>'+
            '<div style="font-size:11.5px;color:var(--text3);margin-top:2px">To '+esc(toLine||'—')+
              (ccLine?' · Cc '+esc(ccLine):'')+' · '+esc(fmtFull(x.date))+'</div>'+
          '</div>'+
          '<button class="btn btn-xs btn-ghost" onclick="mbBack()" title="Close">✕</button>'+
        '</div>'+
        '<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">'+
          '<button class="btn btn-sm btn-primary" onclick="mbReply(false)">Reply</button>'+
          ((x.to||[]).length+(x.cc||[]).length>1?'<button class="btn btn-sm btn-outline" onclick="mbReply(true)">Reply all</button>':'')+
          '<button class="btn btn-sm btn-outline" onclick="mbArchive(\''+escAttr(x.id)+'\',event)">Archive</button>'+
          '<button class="btn btn-sm btn-outline" onclick="mbToggleRead(\''+escAttr(x.id)+'\',event)">'+(x.unread?'Mark read':'Mark unread')+'</button>'+
          '<button class="btn btn-sm btn-danger" onclick="mbTrash(\''+escAttr(x.id)+'\',event)">Delete</button>'+
        '</div>'+
      '</div>'+
      renderBlockedImagesBar(x)+
      renderAttachments(x)+
      renderBody(x)+
      renderReplyBox(x)+
    '</div>';
  }

  function renderBlockedImagesBar(x){
    if(!x.has_remote_images||M().showImages) return '';
    return '<div style="padding:8px 18px;background:var(--amber-l);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--amber)">'+
      '<span style="flex:1">Images in this message are blocked — loading them tells the sender you opened it.</span>'+
      '<button class="btn btn-xs btn-outline" onclick="mbShowImages()">Show images</button>'+
    '</div>';
  }

  function renderAttachments(x){
    var m=M();
    var files=(x.attachments||[]).filter(function(a){return !a.inline;});
    if(!files.length) return '';
    return '<div style="padding:10px 18px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap">'+
      files.map(function(a){
        var url=API_URL+'/mailbox/'+encodeURIComponent(m.activeId)+'/messages/'+encodeURIComponent(x.id)+
          '/attachments/'+encodeURIComponent(a.id)+'?name='+encodeURIComponent(a.name||'attachment');
        return '<button class="btn btn-xs btn-outline" onclick="mbDownload(\''+escAttr(url)+'\',\''+escAttr(a.name||'attachment')+'\')">'+
          '📎 '+esc(a.name||'attachment')+' <span style="color:var(--text3)">'+fmtSize(a.size)+'</span></button>';
      }).join('')+
    '</div>';
  }

  // The attachment endpoint is behind `auth`, so a plain <a href> would arrive
  // without the bearer token and 401. Fetch it with the header, then hand the
  // browser a blob.
  window.mbDownload=function(url,name){
    showToast('Downloading…','info');
    fetch(url,{headers:{Authorization:'Bearer '+STATE.token}})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.blob(); })
      .then(function(b){
        var u=URL.createObjectURL(b);
        var a=document.createElement('a'); a.href=u; a.download=name||'attachment';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function(){ URL.revokeObjectURL(u); },1000);
      })
      .catch(function(e){ showToast('Download failed: '+e.message,'error'); });
  };

  // THE SANDBOX. `sandbox` without allow-scripts and without allow-same-origin
  // means the body cannot run code and cannot reach this origin even if the
  // server-side sanitiser missed something. allow-popups is the one grant, so
  // that clicking a link in an email still works.
  function renderBody(x){
    var doc='<!doctype html><html><head><meta charset="utf-8">'+
      '<style>'+
        'html,body{margin:0;padding:16px 18px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;'+
        'font-size:13.5px;line-height:1.6;color:#0F172A;word-wrap:break-word;overflow-wrap:break-word}'+
        'img{max-width:100%;height:auto}'+
        'table{max-width:100%}'+
        'blockquote{border-left:2px solid #E2E8F0;margin:8px 0;padding-left:12px;color:#475569}'+
        'a{color:#1E7A3C}'+
        'pre{white-space:pre-wrap;word-wrap:break-word}'+
      '</style></head><body>'+(x.body_html||'<i>(no content)</i>')+'</body></html>';
    return '<div style="flex:1;min-height:0;overflow:hidden">'+
      '<iframe title="Message body" sandbox="allow-popups allow-popups-to-escape-sandbox" '+
        'style="width:100%;height:100%;border:0;background:#fff" srcdoc="'+escAttr(doc)+'"></iframe>'+
    '</div>';
  }

  function renderReplyBox(x){
    var m=M();
    if(!m.replying) return '';
    var to=m.replyAll
      ? [who(x.from)].concat((x.to||[]).map(who),(x.cc||[]).map(who)).join(', ')
      : who(x.from);
    return '<div style="border-top:1px solid var(--border);padding:12px 18px;background:var(--bg)">'+
      '<div style="font-size:11.5px;color:var(--text3);margin-bottom:6px">'+
        (m.replyAll?'Reply all to ':'Reply to ')+esc(to)+
        ' — the original message is quoted underneath automatically.</div>'+
      '<textarea id="mb-reply-body" class="sel" style="min-height:110px;resize:vertical;font-size:12.5px;line-height:1.55;background:#fff" placeholder="Write your reply…"></textarea>'+
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">'+
        '<button class="btn btn-sm btn-outline" onclick="mbCancelReply()">Cancel</button>'+
        '<button class="btn btn-sm btn-primary" id="mb-reply-send" onclick="mbSendReply()">Send</button>'+
      '</div>'+
    '</div>';
  }

})();
