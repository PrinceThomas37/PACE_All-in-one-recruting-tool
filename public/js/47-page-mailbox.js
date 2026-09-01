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
    thread:null, threadId:null,
    messages:null, nextCursor:null, listLoading:false, q:'',
    selectedId:null, message:null, msgLoading:false,
    crm:{}, showImages:false,
    // One composer serves reply / reply-all / forward. Its field values live
    // HERE and not in the DOM, because render() rebuilds #content from a string
    // — anything typed but not in STATE is lost the moment anything else
    // repaints. oninput writes through; nothing repaints per keystroke.
    composer:null, sigHtml:null, sigLoading:false,
    unread:0, error:null
  };
  var M = function(){ return STATE.mailbox; };

  // ── nav + routing ──────────────────────────────────────────────────────────
  // The shell draws this page and repaints it THROUGH paint() below (see
  // UI.registerPage at the foot of the render section). It used to wrap
  // render() and rewrite #content after the shell had already written it,
  // which meant two full writes per repaint — and every write threw away the
  // <iframe> holding the message you were reading.
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
  // ── painting ───────────────────────────────────────────────────────────────
  // The screen is drawn in REGIONS and each one is written only when its html
  // actually changes. This is not an optimisation: the open message's body
  // lives in a sandboxed <iframe>, and re-creating that element blanks the
  // pane for a beat and resets the reader's scroll position back to the top.
  // Marking a message read (which ticks the unread badge) used to do exactly
  // that to the message being read.
  //
  // _regs holds the strings currently on screen. renderMailbox() fills it as
  // it builds, so the first granular paint after a full draw compares against
  // the truth rather than rewriting everything once.
  var _regs=null;

  function put(id, html, prev){
    if(html===prev) return true;                 // already on screen — leave the DOM alone
    var el=document.getElementById(id); if(!el) return false;
    return putRegion(el, html, false);
  }
  function putOuter(id, html, prev){
    if(html===prev) return true;
    var el=document.getElementById(id); if(!el) return false;
    return putRegion(el, html, true);
  }

  function paint(){
    if(STATE.page!=='mailbox')return;
    var c=document.getElementById('content'); if(!c) return;
    var m=M();
    var readable=(m.accounts||[]).filter(function(a){return a.readable;});
    // No standing mailbox layout (first draw, or a whole-page state like
    // "loading your mailboxes") → draw the page whole.
    if(!_regs || !document.getElementById('mb-root') || m.accountsLoading || m.accounts===null || !readable.length){
      c.innerHTML=renderMailbox();
      return;
    }
    var p=parts(readable);
    var ok=true;
    ok = put('mb-tabs', p.tabs, _regs.tabs) && ok;
    ok = put('mb-toolbar', p.toolbar, _regs.toolbar) && ok;
    ok = putOuter('mb-list', p.list, _regs.list) && ok;
    var panes=document.getElementById('mb-panes');
    if(panes) panes.className='mb-panes'+(p.reading?' reading':'');
    if(p.shape!==_regs.shape || p.shape!=='msg'){
      ok = putOuter('mb-read', p.reader, _regs.reader) && ok;
    }else{
      // Same open message: head, the summaries either side of it, and the
      // composer are separate regions precisely so that the thread arriving,
      // or a reply box opening, does not touch #mb-open and its iframe.
      ok = put('mb-head', p.head, _regs.head) && ok;
      ok = put('mb-before', p.before, _regs.before) && ok;
      ok = put('mb-open', p.open, _regs.open) && ok;
      ok = put('mb-after', p.after, _regs.after) && ok;
      ok = put('mb-comp', p.comp, _regs.comp) && ok;
      // Whether the body box is the short in-thread size is a CLASS, applied
      // here rather than baked into #mb-open's html — otherwise the thread
      // arriving would rewrite the iframe just to make it shorter.
      var body=document.querySelector('#mb-open .mb-body');
      if(body){ if(p.short) body.classList.add('short'); else body.classList.remove('short'); }
    }
    // A region we expected was missing — fall back to a whole draw rather than
    // leaving a half-updated screen.
    if(!ok){ c.innerHTML=renderMailbox(); return; }
    _regs=p;
  }
  // The shell draws the page, and repaints it through paint() — so a shell
  // repaint (a badge, a toast, a background refresh) costs the reading pane
  // nothing.
  UI.registerPage('mailbox', function(){ return renderMailbox(); }, paint);

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
    if(!cursor){ m.messages=null; m.selectedId=null; m.message=null; m.thread=null; m.threadId=null; }
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
    m.showImages=false; m.composer=null;
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
      loadThread(d);
    }).catch(function(e){
      if(m.selectedId!==id)return;
      m.msgLoading=false; m.error=e.message; paint();
    });
  }

  // The rest of the conversation. A reply read on its own is half a story —
  // "yes please" means nothing without the message it answers.
  //
  // The thread endpoint returns SUMMARIES, not bodies, so the other messages
  // render collapsed and clicking one loads it through loadMessage() like any
  // other. That keeps ONE code path for opening mail (and for marking it read)
  // instead of a second, quieter one that would drift out of step.
  function loadThread(msg){
    var m=M();
    var tid=msg&&msg.thread_id;
    if(!tid){ m.thread=null; m.threadId=null; return; }
    if(m.threadId===tid && m.thread) return;   // already have it
    m.threadId=tid; m.thread=null;
    apiGet('/mailbox/'+encodeURIComponent(m.activeId)+'/threads/'+encodeURIComponent(tid))
      .then(function(list){
        if(m.threadId!==tid)return;
        m.thread=list||[];
        paint();
      })
      .catch(function(){
        // No thread is not an error — a one-message conversation is the common
        // case, and the reader falls back to showing just this message.
        if(m.threadId===tid){ m.thread=[]; paint(); }
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
  window.mbBack=function(){ var m=M(); m.selectedId=null; m.message=null; m.thread=null; m.threadId=null; paint(); };
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
  // ── the composer: reply / reply all / forward ───────────────────────────────
  // Whether a signature goes on is REMEMBERED, and defaults to off. A signature
  // belongs on outreach; repeating a postal address in every message of a live
  // thread reads like a mail-merge, which is what the owner ran into.
  function sigPrefKey(){ return 'pace_mb_sig_'+((STATE.user&&STATE.user.id)||'anon'); }
  function sigPrefGet(){ try{ return localStorage.getItem(sigPrefKey())==='1'; }catch(e){ return false; } }
  function sigPrefSet(on){ try{ localStorage.setItem(sigPrefKey(), on?'1':'0'); }catch(e){} }

  function addrLine(list){ return (list||[]).map(function(a){return a.email;}).filter(Boolean).join(', '); }

  function openComposer(mode){
    var m=M(); var x=m.message; if(!x)return;
    var to='', cc='', subject='';
    if(mode==='forward'){
      to=''; cc='';
      subject=/^(fw|fwd):/i.test(x.subject||'')?x.subject:('Fwd: '+(x.subject||''));
    } else {
      var all=mode==='replyAll';
      to=addrLine([x.from]);
      if(all){
        // Everyone else who was on it, minus us — the two classic reply-all
        // bugs are mailing yourself and mailing the sender twice.
        var own=((m.accounts||[]).filter(function(a){return a.id===m.activeId;})[0]||{}).email_address||'';
        var seen={}; seen[(x.from&&x.from.email)||'']=1; seen[own.toLowerCase()]=1;
        cc=addrLine((x.to||[]).concat(x.cc||[]).filter(function(a){
          if(!a.email||seen[a.email])return false; seen[a.email]=1; return true;
        }));
      }
      subject=/^re:/i.test(x.subject||'')?x.subject:('Re: '+(x.subject||''));
    }
    m.composer={ mode:mode, to:to, cc:cc, subject:subject, body:'', files:[], sig:sigPrefGet(), showCc:!!cc, sending:false };
    paint();
    var ta=document.getElementById('mb-comp-body'); if(ta)ta.focus();
  }
  window.mbReply=function(all){ openComposer(all?'replyAll':'reply'); };
  window.mbForward=function(){ openComposer('forward'); };
  window.mbCancelComposer=function(){ var m=M(); m.composer=null; paint(); };
  window.mbCancelReply=window.mbCancelComposer;   // older name, still referenced
  window.mbCompField=function(k,v){ var m=M(); if(m.composer) m.composer[k]=v; };
  window.mbCompToggleCc=function(){ var m=M(); if(!m.composer)return; m.composer.showCc=!m.composer.showCc; paint(); };
  window.mbCompSetSig=function(on){
    var m=M(); if(!m.composer)return;
    m.composer.sig=!!on; sigPrefSet(!!on);
    if(m.composer.sig) loadSignature();
    paint();
  };

  function loadSignature(){
    var m=M(); if(m.sigHtml!==null||m.sigLoading||!m.activeId)return;
    m.sigLoading=true;
    apiGet('/mailbox/'+encodeURIComponent(m.activeId)+'/signature')
      .then(function(d){ m.sigHtml=(d&&d.html)||''; m.sigLoading=false; paint(); })
      .catch(function(){ m.sigHtml=''; m.sigLoading=false; });
  }

  // ── attachments ─────────────────────────────────────────────────────────────
  var MAX_ATTACH_BYTES=3.5*1024*1024;
  window.mbPickFiles=function(){ var i=document.getElementById('mb-comp-files'); if(i)i.click(); };
  window.mbFilesChosen=function(input){
    var m=M(); if(!m.composer||!input.files||!input.files.length)return;
    var files=Array.prototype.slice.call(input.files);
    var pending=files.length;
    files.forEach(function(f){
      var r=new FileReader();
      r.onload=function(){
        // readAsDataURL gives "data:<type>;base64,<payload>" — the server wants
        // the payload, and strips the prefix defensively too.
        var b64=String(r.result||'').replace(/^data:[^;]*;base64,/,'');
        m.composer.files.push({ name:f.name, type:f.type||'application/octet-stream', size:f.size, base64:b64 });
        if(--pending===0) afterFiles();
      };
      r.onerror=function(){ if(--pending===0) afterFiles(); showToast('Could not read '+f.name,'error'); };
      r.readAsDataURL(f);
    });
    input.value='';
    function afterFiles(){
      var total=m.composer.files.reduce(function(n,f){return n+f.size;},0);
      if(total>MAX_ATTACH_BYTES){
        showToast('That is over the '+(MAX_ATTACH_BYTES/1048576).toFixed(1)+' MB limit — remove something or send a link instead','warning');
      }
      paint();
    }
  };
  window.mbRemoveFile=function(i){ var m=M(); if(!m.composer)return; m.composer.files.splice(i,1); paint(); };

  window.mbSendComposer=function(){
    var m=M(); var c=m.composer; if(!c||!m.message||c.sending)return;
    // Read straight from the DOM as well as STATE: oninput keeps STATE current,
    // but reading here means a send can never lose a last keystroke.
    ['to','cc','subject','body'].forEach(function(k){
      var el=document.getElementById('mb-comp-'+k); if(el) c[k]=el.value;
    });
    if(c.mode!=='forward' && !String(c.body||'').trim()){ showToast('Write a message first','warning'); return; }
    if(c.mode==='forward' && !String(c.to||'').trim()){ showToast('Who are you forwarding this to?','warning'); return; }
    var total=(c.files||[]).reduce(function(n,f){return n+f.size;},0);
    if(total>MAX_ATTACH_BYTES){
      showToast('Attachments are over the '+(MAX_ATTACH_BYTES/1048576).toFixed(1)+' MB limit','error'); return;
    }
    c.sending=true; paint();
    var payload={
      body:c.body, subject:c.subject,
      to:c.to, cc:c.cc,
      include_signature:!!c.sig,
      attachments:(c.files||[]).map(function(f){return {filename:f.name,content_type:f.type,base64:f.base64};})
    };
    var path='/mailbox/'+encodeURIComponent(m.activeId)+'/messages/'+encodeURIComponent(m.message.id)+
      (c.mode==='forward'?'/forward':'/reply');
    if(c.mode!=='forward') payload.reply_all=(c.mode==='replyAll');
    apiPost(path,payload)
      .then(function(){
        showToast(c.mode==='forward'?'Forwarded':'Reply sent','success');
        m.composer=null; paint();
      })
      .catch(function(e){
        c.sending=false; paint();
        showToast((c.mode==='forward'?'Forward':'Send')+' failed: '+e.message,'error');
      });
  };
  // Older name kept so nothing that still calls it silently does nothing.
  window.mbSendReply=window.mbSendComposer;

  // ── compose (new message) ───────────────────────────────────────────────────
  window.mbCompose=function(prefillTo){
    var m=M();
    if(!m.activeId){ showToast('Connect a mailbox first','warning'); return; }
    m.compose={ to:prefillTo||'', cc:'', subject:'', body:'', files:[], sig:sigPrefGet(), sending:false };
    if(m.compose.sig) loadSignature();
    paintComposeModal();
  };
  window.mbComposeField=function(k,v){ var m=M(); if(m.compose) m.compose[k]=v; };
  window.mbComposeSetSig=function(on){
    var m=M(); if(!m.compose)return;
    m.compose.sig=!!on; sigPrefSet(!!on);
    if(m.compose.sig) loadSignature();
    paintComposeModal();
  };
  window.mbComposePickFiles=function(){ var i=document.getElementById('mb-c-files'); if(i)i.click(); };
  window.mbComposeFilesChosen=function(input){
    var m=M(); if(!m.compose||!input.files||!input.files.length)return;
    var files=Array.prototype.slice.call(input.files); var pending=files.length;
    ['to','cc','subject','body'].forEach(function(k){
      var el=document.getElementById('mb-c-'+k); if(el) m.compose[k]=el.value;
    });
    files.forEach(function(f){
      var r=new FileReader();
      r.onload=function(){
        m.compose.files.push({ name:f.name, type:f.type||'application/octet-stream', size:f.size,
          base64:String(r.result||'').replace(/^data:[^;]*;base64,/,'') });
        if(--pending===0) paintComposeModal();
      };
      r.onerror=function(){ if(--pending===0) paintComposeModal(); };
      r.readAsDataURL(f);
    });
    input.value='';
  };
  window.mbComposeRemoveFile=function(i){
    var m=M(); if(!m.compose)return;
    ['to','cc','subject','body'].forEach(function(k){
      var el=document.getElementById('mb-c-'+k); if(el) m.compose[k]=el.value;
    });
    m.compose.files.splice(i,1); paintComposeModal();
  };

  function paintComposeModal(){
    var m=M(); var c=m.compose; if(!c)return;
    var from=(m.accounts||[]).filter(function(a){return a.id===m.activeId;})[0]||{};
    STATE.modal=
      '<div class="modal modal-w640" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
          '<div style="font-weight:700;font-size:16px">New message</div>'+
          '<div style="font-size:11.5px;color:var(--text3);margin-top:2px">From '+esc(from.email_address||'')+'</div>'+
        '</div>'+
        '<div style="padding:16px 20px">'+
          field('mb-c-to','To','someone@company.com',c.to,'mbComposeField(\'to\',this.value)')+
          field('mb-c-cc','Cc <span style="color:var(--text3)">(optional)</span>','',c.cc,'mbComposeField(\'cc\',this.value)')+
          field('mb-c-subject','Subject','',c.subject,'mbComposeField(\'subject\',this.value)')+
          '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Message</label>'+
            '<textarea id="mb-c-body" class="sel" oninput="mbComposeField(\'body\',this.value)" style="min-height:180px;resize:vertical;font-size:12.5px;line-height:1.55">'+esc(c.body)+'</textarea></div>'+
          renderAttachRow(c.files,'mbComposePickFiles()','mbComposeRemoveFile','mb-c-files','mbComposeFilesChosen(this)')+
          renderSigRow(c.sig,'mbComposeSetSig')+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
          '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
          '<button class="btn btn-primary" id="mb-c-send" onclick="mbSendCompose()"'+(c.sending?' disabled':'')+'>'+(c.sending?'Sending…':'Send')+'</button>'+
        '</div>'+
      '</div>';
    render();
  }
  function field(id,label,ph,val,oninput){
    return '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">'+label+'</label>'+
      '<input id="'+id+'" class="sel" placeholder="'+escAttr(ph)+'" value="'+escAttr(val||'')+'" oninput="'+oninput+'"></div>';
  }

  window.mbSendCompose=function(){
    var m=M(); var c=m.compose; if(!c||c.sending)return;
    ['to','cc','subject','body'].forEach(function(k){
      var el=document.getElementById('mb-c-'+k); if(el) c[k]=el.value;
    });
    if(!String(c.to||'').trim()){ showToast('Who is this going to?','warning'); return; }
    if(!String(c.body||'').trim()){ showToast('Write a message first','warning'); return; }
    var total=(c.files||[]).reduce(function(n,f){return n+f.size;},0);
    if(total>MAX_ATTACH_BYTES){ showToast('Attachments are over the '+(MAX_ATTACH_BYTES/1048576).toFixed(1)+' MB limit','error'); return; }
    c.sending=true; paintComposeModal();
    apiPost('/mailbox/'+encodeURIComponent(m.activeId)+'/send',{
      to:c.to, cc:c.cc, subject:c.subject, body:c.body,
      include_signature:!!c.sig,
      attachments:(c.files||[]).map(function(f){return {filename:f.name,content_type:f.type,base64:f.base64};})
    })
      .then(function(){ showToast('Sent','success'); m.compose=null; closeModal(); })
      .catch(function(e){ c.sending=false; paintComposeModal(); showToast('Send failed: '+e.message,'error'); });
  };

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
    _regs=null;
    if(m.accountsLoading||m.accounts===null)
      return '<div class="pg"><div class="dt-empty">Loading your mailboxes…</div></div>';

    var readable=(m.accounts||[]).filter(function(a){return a.readable;});
    if(!readable.length) return renderNoMailbox();

    // TWO panes, not three. The folder rail became a picker in the toolbar:
    // it cost 190px on every screen to save one click on the folder switch
    // most people make a handful of times a day, and the two panes that carry
    // the work — the conversation list and the conversation — were paying for
    // it. Nothing is lost; every folder, custom ones included, is in the list.
    var p=parts(readable);
    _regs=p;
    return '<div class="mb" id="mb-root">'+
      '<div id="mb-tabs" style="flex:none">'+p.tabs+'</div>'+
      '<div id="mb-toolbar" style="flex:none">'+p.toolbar+'</div>'+
      '<div class="mb-panes'+(p.reading?' reading':'')+'" id="mb-panes">'+
        p.list+
        p.reader+
      '</div>'+
    '</div>';
  }

  // Every region of the screen, as strings, built once per paint. paint()
  // compares them against what is already showing and writes only the
  // difference; renderMailbox() concatenates them for a first draw.
  function parts(readable){
    var m=M();
    var p={
      reading:!!m.selectedId,
      tabs:renderMbTabs(),
      toolbar:renderTopBar(readable),
      list:renderList(),
      shape:readerShape()
    };
    if(p.shape!=='msg'){ p.reader=renderEmptyReader(p.shape); return p; }

    var x=m.message;
    // The conversation, oldest first, with the open message expanded in place.
    // When the thread has not arrived (or there is none) the open message is
    // the whole conversation — which is true, not a placeholder.
    var thread=(m.thread&&m.thread.length)?m.thread:[x];
    var at=-1;
    for(var i=0;i<thread.length;i++){ if(thread[i].id===x.id){ at=i; break; } }
    if(at<0){ thread=[x]; at=0; }
    p.short=thread.length>1;
    p.head=renderHead(x, thread.length);
    p.before=thread.slice(0,at).map(renderCollapsedMessage).join('');
    p.open=renderOpenMessage(x);
    p.after=thread.slice(at+1).map(renderCollapsedMessage).join('');
    p.comp=renderComposer(x);
    p.reader='<div class="mb-read" id="mb-read" data-shape="msg">'+
      '<div class="mb-head" id="mb-head">'+p.head+'</div>'+
      '<div class="mb-thread" id="mb-thread">'+
        '<div id="mb-before">'+p.before+'</div>'+
        '<div id="mb-open"'+(p.short?' data-short="1"':'')+'>'+p.open+'</div>'+
        '<div id="mb-after">'+p.after+'</div>'+
        '<div id="mb-comp">'+p.comp+'</div>'+
      '</div>'+
    '</div>';
    return p;
  }

  // Which of the four reading-pane states we are in. A change of shape
  // replaces the pane; staying in 'msg' updates it region by region.
  function readerShape(){
    var m=M();
    if(!m.selectedId) return 'none';
    if(m.msgLoading&&!m.message) return 'loading';
    if(!m.message) return 'error';
    return 'msg';
  }

  // All / Unread, plus where you are in the folder. The count is the number of
  // messages actually loaded, never an estimate.
  function renderMbTabs(){
    var m=M();
    var list=m.messages||[];
    var unread=list.filter(function(x){return x.unread;}).length;
    var folder=(m.folders||[]).filter(function(f){return f.id===m.folderId;})[0];
    var right=folder
      ? '<span style="font-size:12px;color:var(--ink3)">'+esc(folder.name)+
        (list.length?' · '+list.length+' loaded':'')+'</span>'
      : '';
    return UI.tabs([
      { id:'all',    label:'All',    n:list.length, onclick:"mbSetFilter('all')" },
      { id:'unread', label:'Unread', n:unread,      onclick:"mbSetFilter('unread')" }
    ], m.filter||'all', right);
  }

  // A view filter over what is already loaded — deliberately NOT a server
  // query. "Unread" here means "unread among the messages on screen", which is
  // the honest reading of a list that pages in 25 at a time.
  window.mbSetFilter=function(f){ var m=M(); m.filter=f; paint(); };

  // Nothing connected. This is a setup state, not an error — say what to do.
  function renderNoMailbox(){
    var m=M();
    var broken=(m.accounts||[]).filter(function(a){return !a.readable;});
    return '<div class="pg"><div class="pg-body">'+
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
    '</div></div>';
  }

  function renderTopBar(readable){
    var m=M();
    var accountPicker = readable.length>1
      ? '<select class="seq-sel" style="max-width:280px" onchange="mbSelectAccount(this.value)">'+
          readable.map(function(a){
            return '<option value="'+escAttr(a.id)+'"'+(a.id===m.activeId?' selected':'')+'>'+
              esc(a.email_address)+(a.platform==='Gmail'?' · Gmail':' · Outlook')+'</option>';
          }).join('')+
        '</select>'
      : '<div style="font-size:13px;font-weight:600">'+esc((readable[0]||{}).email_address||'')+
        '<span style="font-weight:400;color:var(--ink3)"> · '+esc((readable[0]||{}).platform==='Gmail'?'Gmail':'Outlook')+'</span></div>';

    var folders=m.folders||[];
    var folderPicker = m.foldersLoading
      ? '<span style="font-size:12.5px;color:var(--ink3)">Loading folders…</span>'
      : (folders.length
        ? '<select class="seq-sel" style="max-width:230px" onchange="mbSelectFolder(this.value)">'+
            folders.map(function(f){
              return '<option value="'+escAttr(f.id)+'"'+(f.id===m.folderId?' selected':'')+'>'+
                esc(f.name)+(f.unread?' ('+f.unread+')':'')+'</option>';
            }).join('')+
          '</select>'
        : '');

    return UI.toolbar({
      search:{ value:m.q||'', placeholder:'Search this mailbox…', onkeydown:'mbSearchKey(event)' },
      icons:[
        { icon:'x', title:'Clear search', onclick:'mbClearSearch()', off:!m.q },
        { sep:true },
        { icon:'refresh', title:'Refresh', onclick:'mbRefresh()' }
      ],
      right: folderPicker + accountPicker +
        '<button class="btn btn-primary btn-sm" onclick="mbCompose()">'+UI.ic('plus')+'Compose</button>'
    }).replace('id="mb-search-placeholder"','');
  }

  function renderList(){
    var m=M();
    var wide=!m.selectedId;
    var all=m.messages||[];
    var rows=(m.filter==='unread')?all.filter(function(x){return x.unread;}):all;
    var body;
    if(m.listLoading&&m.messages===null) body='<div class="dt-empty">Loading messages…</div>';
    else if(m.error&&!all.length)        body='<div class="dt-empty" style="color:var(--red)">'+esc(m.error)+'</div>';
    else if(!rows.length)                body='<div class="dt-empty">'+(m.q?'Nothing matched “'+esc(m.q)+'”':(m.filter==='unread'?'Nothing unread here':'Nothing here'))+'</div>';
    else body=rows.map(function(x){ return renderRow(x, m.selectedId===x.id); }).join('');

    return '<div class="mb-list'+(wide?' wide':'')+'" id="mb-list">'+
      body+
      (m.nextCursor
        ? '<div style="padding:12px;text-align:center"><button class="btn btn-sm btn-outline" onclick="mbLoadMore()"'+(m.listLoading?' disabled':'')+'>'+(m.listLoading?'Loading…':'Load more')+'</button></div>'
        : '')+
    '</div>';
  }

  // The initials block that identifies a correspondent at a glance.
  function mbAvatar(party,size){
    var nm=(party&&(party.name||party.email))||'?';
    var initials=String(nm).trim().split(/[\s@.]+/).slice(0,2)
      .map(function(w){ return (w[0]||''); }).join('').toUpperCase()||'?';
    return '<div class="av av-'+(size||28)+' av-bd">'+esc(initials)+'</div>';
  }

  function renderRow(x, active){
    var m=M();
    // In Sent and Drafts the useful name is the recipient, not us.
    var folder=(m.folders||[]).filter(function(f){return f.id===m.folderId;})[0];
    var outbound=folder&&(folder.kind==='sent'||folder.kind==='drafts');
    var party=outbound?((x.to||[])[0]||{}):(x.from||{});
    var partyEmail=party.email||'';
    return '<div class="mb-row'+(active?' on':'')+(x.unread?' unread':'')+'" onclick="mbOpen(\''+escAttr(x.id)+'\')">'+
      mbAvatar(party,28)+
      '<div class="mb-row-b">'+
        '<div class="mb-row-t">'+
          '<div class="mb-who">'+(outbound?'To ':'')+esc(who(party))+'</div>'+
          (crmChip(partyEmail)||'')+
          '<div class="mb-when">'+esc(fmtWhen(x.date))+'</div>'+
        '</div>'+
        '<div class="mb-subj">'+esc(x.subject||'(no subject)')+'</div>'+
        '<div class="mb-prev">'+esc(x.preview||'')+
          (x.has_attachments?' <span title="Has attachments">📎</span>':'')+'</div>'+
      '</div>'+
    '</div>';
  }

  // The three states that are not an open message. Kept as one element with
  // the same id, so switching between them replaces the pane cleanly.
  function renderEmptyReader(shape){
    var m=M();
    var inner;
    if(shape==='none')         inner=UI.ic('mailopen')+'<div>Pick a conversation to read it here.</div>';
    else if(shape==='loading') inner='Opening…';
    else                       inner='<span style="color:var(--red)">'+esc(m.error||'Could not open this message')+'</span>';
    return '<div class="mb-read" id="mb-read" data-shape="'+shape+'"><div class="mb-empty">'+inner+'</div></div>';
  }

  // The subject line and the verbs that act on the open message.
  function renderHead(x, threadLen){
    var hasOthers=threadLen>1;
    return '<div style="display:flex;align-items:flex-start;gap:10px">'+
        '<div class="mb-title" style="flex:1;min-width:0">'+esc(x.subject||'(no subject)')+
          (hasOthers?'<span class="pill mute">'+threadLen+' messages</span>':'')+'</div>'+
        '<span class="kebab" title="Close" onclick="mbBack()">'+UI.ic('x')+'</span>'+
      '</div>'+
      '<div class="mb-acts">'+
        '<button class="btn btn-sm btn-primary" onclick="mbReply(false)">'+UI.ic('reply')+'Reply</button>'+
        ((x.to||[]).length+(x.cc||[]).length>1?'<button class="btn btn-sm btn-outline" onclick="mbReply(true)">Reply all</button>':'')+
        '<button class="btn btn-sm btn-outline" onclick="mbForward()">Forward</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mbArchive(\''+escAttr(x.id)+'\',event)">Archive</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mbToggleRead(\''+escAttr(x.id)+'\',event)">'+(x.unread?'Mark read':'Mark unread')+'</button>'+
        '<button class="btn btn-sm btn-danger" onclick="mbTrash(\''+escAttr(x.id)+'\',event)">Delete</button>'+
      '</div>';
  }

  // One message in the thread, opened: header, warnings, attachments, body.
  function renderOpenMessage(x){
    var toLine=(x.to||[]).map(who).join(', ');
    var ccLine=(x.cc||[]).map(who).join(', ');
    return '<div class="mb-msg open">'+
      '<div class="mb-msg-h">'+
        mbAvatar(x.from,32)+
        '<div class="mb-msg-b">'+
          '<div class="mb-from">'+esc(who(x.from))+
            '<span class="addr">&lt;'+esc((x.from||{}).email||'')+'&gt;</span>'+
            (crmChip((x.from||{}).email)||'')+'</div>'+
          '<div class="mb-to">To '+esc(toLine||'—')+(ccLine?' · Cc '+esc(ccLine):'')+'</div>'+
        '</div>'+
        '<div class="mb-msg-when">'+esc(fmtFull(x.date))+'</div>'+
        '<div class="mb-msg-ico">'+
          '<span class="kebab" title="Reply" onclick="mbReply(false)">'+UI.ic('reply')+'</span>'+
          '<span class="kebab" title="Forward" onclick="mbForward()">'+UI.ic('right')+'</span>'+
        '</div>'+
      '</div>'+
      renderBlockedImagesBar(x)+
      renderAttachments(x)+
      renderBody(x)+
    '</div>';
  }

  // The other messages in the thread — summaries only, because the thread
  // endpoint does not carry bodies. Clicking one opens it the normal way.
  function renderCollapsedMessage(t){
    return '<div class="mb-msg'+(t.unread?' unread':'')+'" onclick="mbOpen(\''+escAttr(t.id)+'\')">'+
      '<div class="mb-msg-h">'+
        mbAvatar(t.from,28)+
        '<div class="mb-msg-b">'+
          '<div class="mb-from" style="font-size:13px">'+esc(who(t.from))+'</div>'+
          '<div class="mb-collapsed">'+esc(t.preview||'(no preview)')+'</div>'+
        '</div>'+
        '<div class="mb-msg-when">'+esc(fmtWhen(t.date))+'</div>'+
      '</div>'+
    '</div>';
  }

  function renderBlockedImagesBar(x){
    if(!x.has_remote_images||M().showImages) return '';
    return '<div class="mb-bar">'+
      '<span style="flex:1">Images in this message are blocked — loading them tells the sender you opened it.</span>'+
      '<button class="btn btn-xs btn-outline" onclick="mbShowImages()">Show images</button>'+
    '</div>';
  }

  function renderAttachments(x){
    var m=M();
    var files=(x.attachments||[]).filter(function(a){return !a.inline;});
    if(!files.length) return '';
    return '<div class="mb-att">'+
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
    // The height is FIXED and the body scrolls inside itself. Auto-sizing to
    // the content would mean measuring the iframe from the parent, which needs
    // allow-same-origin — the very grant that keeps a hostile email boxed in.
    // The shorter in-thread size is a class paint() toggles, NOT part of this
    // string: if it were, the thread arriving would rewrite the iframe — the
    // very thing that made the reading pane blink and lose its scroll.
    return '<div class="mb-body">'+
      '<iframe title="Message body" sandbox="allow-popups allow-popups-to-escape-sandbox" '+
        'srcdoc="'+escAttr(doc)+'"></iframe>'+
    '</div>';
  }

  // Shared attachment row: the "Attach files" button, the chips, and the hidden
  // file input that actually opens the picker.
  function renderAttachRow(files, pickFn, removeFn, inputId, onChange){
    files=files||[];
    var total=files.reduce(function(n,f){return n+(f.size||0);},0);
    var over=total>MAX_ATTACH_BYTES;
    return '<div style="margin-top:10px">'+
      '<input type="file" id="'+inputId+'" multiple style="display:none" onchange="'+onChange+'">'+
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
        '<button class="btn btn-xs btn-outline" onclick="'+pickFn+'">📎 Attach files</button>'+
        files.map(function(f,i){
          return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:2px 4px 2px 9px">'+
            esc(f.name)+' <span style="color:var(--text3)">'+fmtSize(f.size)+'</span>'+
            '<button onclick="'+removeFn+'('+i+')" title="Remove" style="color:var(--text3);font-size:13px;line-height:1;padding:0 3px">✕</button></span>';
        }).join('')+
      '</div>'+
      (over?'<div style="font-size:11px;color:var(--red);margin-top:5px">That is over the '+(MAX_ATTACH_BYTES/1048576).toFixed(1)+' MB limit — remove something, or send the big files as a link.</div>':'')+
    '</div>';
  }

  // The signature picker. Off by default and remembered, with the real filled
  // signature shown when it is on — so what you pick is what the recipient gets.
  function renderSigRow(on, setFn){
    var m=M();
    return '<div style="margin-top:10px;display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap">'+
      '<label style="font-size:11px;color:var(--text2);padding-top:5px">Signature</label>'+
      '<select class="sel" style="width:auto;font-size:12px;padding:4px 8px" onchange="'+setFn+'(this.value===\'1\')">'+
        '<option value="0"'+(on?'':' selected')+'>No signature</option>'+
        '<option value="1"'+(on?' selected':'')+'>My signature</option>'+
      '</select>'+
      (on
        ? '<div style="flex:1;min-width:200px;border:1px solid var(--border);border-radius:var(--r);padding:8px 10px;background:var(--card);max-height:120px;overflow:auto">'+
            (m.sigLoading?'<span style="font-size:11px;color:var(--text3)">Loading…</span>'
              : (m.sigHtml?m.sigHtml:'<span style="font-size:11px;color:var(--text3)">No signature saved for this mailbox.</span>'))+
          '</div>'
        : '')+
    '</div>';
  }

  function renderComposer(x){
    var m=M(); var c=m.composer;
    if(!c) return '';
    var fwd=c.mode==='forward';
    var title=fwd?'Forward':(c.mode==='replyAll'?'Reply all':'Reply');

    return '<div style="border-top:1px solid var(--border);padding:12px 18px;background:var(--bg);max-height:62%;overflow-y:auto">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
        '<div style="font-size:12px;font-weight:700">'+title+'</div>'+
        (fwd?'':'<div style="font-size:11px;color:var(--text3)">The original is quoted underneath automatically.</div>')+
        (fwd?'<div style="font-size:11px;color:var(--text3)">Attachments on the original are carried over.</div>':'')+
      '</div>'+

      // To — editable everywhere. A forward starts empty; a reply is prefilled.
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">'+
        '<label style="font-size:11px;color:var(--text2);width:52px;flex:none">To</label>'+
        '<input id="mb-comp-to" class="sel" style="flex:1;font-size:12.5px" value="'+escAttr(c.to||'')+'" '+
          'placeholder="'+(fwd?'someone@company.com':'')+'" oninput="mbCompField(\'to\',this.value)">'+
        (c.showCc?'':'<button class="btn btn-xs btn-ghost" onclick="mbCompToggleCc()">Add Cc</button>')+
      '</div>'+
      (c.showCc
        ? '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">'+
            '<label style="font-size:11px;color:var(--text2);width:52px;flex:none">Cc</label>'+
            '<input id="mb-comp-cc" class="sel" style="flex:1;font-size:12.5px" value="'+escAttr(c.cc||'')+'" oninput="mbCompField(\'cc\',this.value)">'+
          '</div>'
        : '')+

      // Subject — visible and editable on reply and forward alike. It was
      // previously decided for you by the mail provider and never shown.
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">'+
        '<label style="font-size:11px;color:var(--text2);width:52px;flex:none">Subject</label>'+
        '<input id="mb-comp-subject" class="sel" style="flex:1;font-size:12.5px" value="'+escAttr(c.subject||'')+'" oninput="mbCompField(\'subject\',this.value)">'+
      '</div>'+

      '<textarea id="mb-comp-body" class="sel" oninput="mbCompField(\'body\',this.value)" '+
        'style="min-height:110px;resize:vertical;font-size:12.5px;line-height:1.55;background:#fff" '+
        'placeholder="'+(fwd?'Add a note (optional)…':'Write your reply…')+'">'+esc(c.body||'')+'</textarea>'+

      renderAttachRow(c.files,'mbPickFiles()','mbRemoveFile','mb-comp-files','mbFilesChosen(this)')+
      renderSigRow(c.sig,'mbCompSetSig')+

      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">'+
        '<button class="btn btn-sm btn-outline" onclick="mbCancelComposer()">Cancel</button>'+
        '<button class="btn btn-sm btn-primary" id="mb-comp-send" onclick="mbSendComposer()"'+(c.sending?' disabled':'')+'>'+
          (c.sending?'Sending…':(fwd?'Forward':'Send'))+'</button>'+
      '</div>'+
    '</div>';
  }

})();
