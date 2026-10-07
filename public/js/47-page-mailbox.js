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
    unread:0, error:null,
    sel:{},            // ticked messages: id → true (the bulk bar acts on these)
    labels:{}, labelMenu:null, _pages:1
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

  function setClass(el, want){ if(el && el.className!==want) el.className=want; }

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
    ok = put('mb-bulk', p.bulk, _regs.bulk) && ok;
    // The list is replaced as a whole element, so its scroll position is carried across by hand —
    // ticking the 20th message must not throw you back to the first.
    var oldList=document.getElementById('mb-list'), keepTop=oldList?oldList.scrollTop:0;
    ok = putOuter('mb-list', p.list, _regs.list) && ok;
    if(keepTop){ var newList=document.getElementById('mb-list'); if(newList&&newList!==oldList) newList.scrollTop=keepTop; }
    // Write a class ONLY when it changes. Assigning the same className still
    // sets the attribute, which invalidates style on an ancestor of the message
    // body — and an out-of-process sandboxed iframe answers that by re-rastering
    // itself, which reads on screen as a white flash. An idle repaint must not
    // touch the DOM at all.
    setClass(document.getElementById('mb-panes'), 'mb-panes'+(p.reading?' reading':''));
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
      setClass(document.querySelector('#mb-open .mb-body'), 'mb-body'+(p.short?' short':'')+(p.tall?' tall':''));
      setClass(document.getElementById('mb-thread'), 'mb-thread'+(p.solo?' solo':''));
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

  // ── REMEMBERING WHAT WAS JUST ON SCREEN (the owner, 6 Oct: switching folders and messages is slow) ──
  // Every list and every body is still a live read of the real mailbox — nothing is stored anywhere but
  // this tab's memory. What changed: a screen the person has just seen is shown AT ONCE when they come
  // back to it, and refreshed behind it, instead of blanking and waiting for the mail provider again.
  //   * a folder/search list is shown from memory and quietly re-read when it is older than 15s;
  //   * an opened message is kept (40 of them) — a message does not change, so it is not re-fetched;
  //     hovering a row for a moment fetches it ahead of the click;
  //   * the folder list (counts) is kept per mailbox and re-read behind the screen.
  // Any action (archive, delete, label, mark read) updates or drops what it touches, so a remembered
  // screen is never the one that still shows a message you deleted.
  var LIST_TTL=15000, MSG_MAX=40;
  var _lc={}, _mc={}, _mcOrder=[], _tc={}, _fc={}, _inflight={}, _hoverT=null;
  function lkey(){ var m=M(); return [m.activeId,m.folderId||'',m.q||''].join('|'); }
  function mkey(id){ return M().activeId+':'+id; }
  function mcPut(acct,id,msg){
    var k=acct+':'+id; if(!_mc[k]) _mcOrder.push(k); _mc[k]=msg;
    while(_mcOrder.length>MSG_MAX){ delete _mc[_mcOrder.shift()]; }
  }
  function listCachePut(){
    var m=M(); if(!m.activeId||m.messages===null) return;
    _lc[lkey()]={at:Date.now(),messages:m.messages.slice(),nextCursor:m.nextCursor,crm:Object.assign({},m.crm||{})};
  }
  function cacheDropAccount(acct){
    Object.keys(_lc).forEach(function(k){ if(k.indexOf(acct+'|')===0) delete _lc[k]; });
    delete _fc[acct];
  }
  function cacheForget(acct,id){ delete _mc[acct+':'+id]; }
  function hasSel(){ return Object.keys(M().sel||{}).length>0; }
  function enc(x){ return encodeURIComponent(x); }

  function pickFolderId(folders){
    var inbox=(folders||[]).filter(function(f){return f.kind==='inbox';})[0];
    return (inbox&&inbox.id)||((folders||[])[0]&&folders[0].id)||null;
  }

  function loadFolders(){
    var m=M(); if(!m.activeId)return;
    var acct=m.activeId, hit=_fc[acct];
    m.error=null; m.sel={};
    if(hit){
      m.folders=hit.folders; m.foldersLoading=false; m.folderId=pickFolderId(hit.folders);
      paint(); loadMessages(); ensureLabels();
      if(Date.now()-hit.at>30000) fetchFolders(acct,true);   // counts, quietly
      return;
    }
    m.foldersLoading=true; m.folders=null; paint();
    fetchFolders(acct,false);
  }
  function fetchFolders(acct,quiet){
    apiGet('/mailbox/'+enc(acct)+'/folders').then(function(d){
      _fc[acct]={at:Date.now(),folders:d||[]};
      var m=M(); if(m.activeId!==acct) return;
      m.folders=d||[]; m.foldersLoading=false;
      if(!quiet){ m.folderId=pickFolderId(m.folders); paint(); loadMessages(); ensureLabels(); }
      else paint();
    }).catch(function(e){
      var m=M(); if(m.activeId!==acct) return;
      m.foldersLoading=false; if(!quiet){ m.folders=[]; } m.error=quiet?m.error:e.message; paint();
    });
  }

  function listPath(cursor){
    var m=M();
    var p='/mailbox/'+enc(m.activeId)+'/messages?limit=25';
    if(m.folderId) p+='&folder='+enc(m.folderId);
    if(m.q) p+='&q='+enc(m.q);
    if(cursor) p+='&cursor='+enc(cursor);
    return p;
  }

  function loadMessages(cursor){
    var m=M(); if(!m.activeId)return;
    var key=lkey();
    if(!cursor){
      m.sel={}; m.labelMenu=null; m._pages=1;
      m.selectedId=null; m.message=null; m.thread=null; m.threadId=null;
      var hit=_lc[key];
      if(hit){
        // Seen a moment ago: show it now, re-read it behind the screen if it has aged.
        m.messages=hit.messages.slice(); m.nextCursor=hit.nextCursor;
        m.crm=Object.assign(m.crm||{},hit.crm||{});
        m.listLoading=false; m.error=null; paint();
        if(Date.now()-hit.at>=LIST_TTL) fetchList(key,null,true);
        return;
      }
      m.messages=null;
    }
    m.listLoading=true; paint();
    fetchList(key,cursor,false);
  }

  // THE OTHER FOLDERS ARE READ BEHIND THE SCREEN (R-142). The owner: "once it is loaded it switches
  // mailboxes easily, but not the tabs within, from inbox to sent to spam … it still takes 3 secs."
  // Switching a mailbox was quick because the folder list was remembered; switching a FOLDER was slow
  // because its messages had never been read. So once the Inbox is on screen, the folders people
  // actually move between (Sent, Junk, Archive) are read quietly, one at a time with a pause between,
  // into the same memory a visit fills — and the first click on one of them is a remembered screen.
  // Only ever once per connection per page-load, never while the tab is hidden, never when a search
  // is typed, and any action that moves mail (archive, delete, label) drops it all, as before.
  var WARM_KINDS=['sent','junk','archive'], WARM_GAP=350, _warmed={};
  function warmFolders(acct){
    if(_warmed[acct]) return; _warmed[acct]=true;
    var m=M(), ids=(m.folders||[]).filter(function(f){ return WARM_KINDS.indexOf(f.kind)>=0; })
      .sort(function(a,b){ return WARM_KINDS.indexOf(a.kind)-WARM_KINDS.indexOf(b.kind); })
      .map(function(f){ return f.id; });
    var next=function(){
      var mm=M(); if(mm.activeId!==acct) { _warmed[acct]=false; return; }   // moved on: a later visit may warm it
      var id=ids.shift(); if(!id) return;
      var key=[acct,id,''].join('|');
      if(_lc[key]||(typeof document!=='undefined'&&document.hidden)) return next();
      apiGet('/mailbox/'+enc(acct)+'/messages?limit=25&folder='+enc(id)).then(function(d){
        if(!_lc[key]) _lc[key]={at:Date.now(),messages:(d.messages||[]).slice(),nextCursor:d.next_cursor||null,crm:Object.assign({},d.crm||{})};
      }).catch(function(){}).then(function(){ setTimeout(next,WARM_GAP); });
    };
    setTimeout(next,WARM_GAP);
  }
  window.mbWarmFolders=warmFolders;

  function fetchList(key,cursor,quiet){
    var m=M(), acct=m.activeId;
    apiGet(listPath(cursor)).then(function(d){
      if(M().activeId!==acct || lkey()!==key) return;          // they moved on while this was in flight
      if(quiet){
        // Replace what is on screen only while nothing has been done with it — a list the person
        // is ticking, paging or reading is never rewritten under their hands.
        var untouched=(m._pages||1)===1 && !hasSel();
        if(untouched){
          m.messages=d.messages||[]; m.nextCursor=d.next_cursor||null;
          m.crm=Object.assign(m.crm||{}, d.crm||{});
          paint();
        }
        _lc[key]={at:Date.now(),messages:(d.messages||[]).slice(),nextCursor:d.next_cursor||null,crm:Object.assign({},m.crm||{})};
        return;
      }
      m.messages=cursor?(m.messages||[]).concat(d.messages||[]):(d.messages||[]);
      m.nextCursor=d.next_cursor||null;
      if(cursor) m._pages=(m._pages||1)+1;
      m.crm=Object.assign(m.crm||{}, d.crm||{});
      m.listLoading=false; m.error=null;
      if(!cursor) _lc[key]={at:Date.now(),messages:m.messages.slice(),nextCursor:m.nextCursor,crm:Object.assign({},m.crm||{})};
      paint();
      if(!cursor&&!m.q){
        var cur=(m.folders||[]).filter(function(f){return f.id===m.folderId;})[0];
        if(cur&&cur.kind==='inbox') warmFolders(acct);
      }
    }).catch(function(e){
      if(M().activeId!==acct || lkey()!==key) return;
      if(quiet) return;                                          // a failed refresh behind the screen says nothing
      m.listLoading=false; m.error=e.message;
      if(!cursor) m.messages=[];
      paint();
    });
  }

  // One fetch per message at a time, shared by "open" and "hover ahead".
  function fetchMessage(acct,id,images){
    var k=acct+':'+id+(images?':img':'');
    if(_inflight[k]) return _inflight[k];
    var path='/mailbox/'+enc(acct)+'/messages/'+enc(id)+(images?'?images=show':'');
    var pr=apiGet(path).then(function(d){ delete _inflight[k]; if(!images) mcPut(acct,id,d); return d; },
      function(e){ delete _inflight[k]; throw e; });
    _inflight[k]=pr; return pr;
  }
  window.mbHover=function(id){
    clearTimeout(_hoverT);
    try{ if(!(window.matchMedia&&matchMedia('(hover:hover) and (pointer:fine)').matches)) return; }catch(e){ return; }
    var acct=M().activeId; if(!acct) return;
    _hoverT=setTimeout(function(){ if(!_mc[acct+':'+id]) fetchMessage(acct,id,false).catch(function(){}); },180);
  };
  window.mbHoverEnd=function(){ clearTimeout(_hoverT); };

  function loadMessage(id){
    var m=M(), acct=m.activeId;
    m.selectedId=id; m.showImages=false;   // a reply in progress is its own window now — selecting another message must not wipe it
    var hit=_mc[acct+':'+id];
    if(hit){                                    // a message does not change: show it, no round trip
      m.message=hit; m.msgLoading=false; m.error=null;
      m.crm=Object.assign(m.crm||{}, hit.crm||{});
      paint();
      if(hit.unread) markRead(id, true, true);
      loadThread(hit);
      return;
    }
    m.message=null; m.msgLoading=true;
    paint();
    fetchMessage(acct,id,false).then(function(d){
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
    var m=M(), acct=m.activeId;
    var tid=msg&&msg.thread_id;
    if(!tid){ m.thread=null; m.threadId=null; return; }
    if(m.threadId===tid && m.thread) return;   // already have it
    m.threadId=tid;
    var th=_tc[acct+':'+tid];
    if(th){ m.thread=th; paint(); return; }
    m.thread=null;
    apiGet('/mailbox/'+enc(acct)+'/threads/'+enc(tid))
      .then(function(list){
        _tc[acct+':'+tid]=list||[];
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
    var cm=_mc[m.activeId+':'+id]; if(cm) cm.unread=!read;
    listCachePut();
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
    if(m.sel) delete m.sel[id];
    cacheForget(m.activeId,id); cacheDropAccount(m.activeId); listCachePut();   // other folders' counts and lists are now older than this action
    paint(); refreshUnread(true);
  }

  // ── actions ────────────────────────────────────────────────────────────────
  // ── select many ───────────────────────────────────────────────────────────
  function visibleRows(){
    var m=M(), all=m.messages||[];
    return (m.filter==='unread')?all.filter(function(x){return x.unread;}):all;
  }
  function selectHead(rows){
    var m=M(), sel=m.sel||{};
    var all=rows.length&&rows.every(function(r){return sel[r.id];});
    return '<label class="mb-selhead"><input type="checkbox" '+(all?'checked ':'')+'onclick="mbSelAll()" aria-label="Select all loaded emails"> '+
      '<span>Select all '+rows.length+' loaded</span></label>';
  }
  function renderBulkBar(){
    var m=M(), n=Object.keys(m.sel||{}).length;
    if(!n) return '';
    var dis=m.bulkBusy?' disabled':'';
    return '<div class="mb-bulk">'+
      '<span class="mb-bulk-n">'+n+' selected</span>'+
      '<button class="btn btn-sm btn-outline"'+dis+' onclick="mbBulk(\'archive\')">Archive</button>'+
      '<button class="btn btn-sm btn-danger"'+dis+' title="Moves them to Trash — still recoverable in your mailbox" onclick="mbBulk(\'trash\')">Delete</button>'+
      '<button class="btn btn-sm btn-outline"'+dis+' onclick="mbBulk(\'read\')">Mark read</button>'+
      '<button class="btn btn-sm btn-outline"'+dis+' onclick="mbBulk(\'unread\')">Mark unread</button>'+
      '<button class="btn btn-sm btn-outline"'+dis+' onclick="mbLabelMenu()">Label…</button>'+
      '<button class="btn btn-sm btn-outline"'+dis+' onclick="mbSelClear()">Clear</button>'+
      (m.bulkBusy?'<span class="mb-bulk-wait">Working…</span>':'')+
    '</div>';
  }
  window.mbSel=function(id,ev){
    if(ev&&ev.stopPropagation) ev.stopPropagation();
    var m=M(); m.sel=m.sel||{};
    if(m.sel[id]) delete m.sel[id]; else m.sel[id]=true;
    paint();
  };
  window.mbSelAll=function(){
    var m=M(), rows=visibleRows(); m.sel=m.sel||{};
    var all=rows.length&&rows.every(function(r){return m.sel[r.id];});
    if(all) m.sel={}; else rows.forEach(function(r){ m.sel[r.id]=true; });
    paint();
  };
  window.mbSelClear=function(){ M().sel={}; paint(); };

  // One request per 50, in order; each message is answered on its own, so a failure names itself
  // and the rest still happen. Delete is a MOVE to Trash — said out loud, as everywhere here.
  function bulkRequest(acct,ids,action,labelId){
    var chunks=[]; for(var i=0;i<ids.length;i+=50) chunks.push(ids.slice(i,i+50));
    var results=[];
    return chunks.reduce(function(p,chunk){
      return p.then(function(){
        return apiPost('/mailbox/'+enc(acct)+'/bulk',{ids:chunk,action:action,label_id:labelId||undefined})
          .then(function(r){ results=results.concat((r&&r.results)||[]); });
      });
    },Promise.resolve()).then(function(){ return results; });
  }
  function applyLocal(acct,okIds,action,labelId){
    var m=M(), set={}; okIds.forEach(function(id){ set[id]=1; });
    function touch(x){
      if(!x||!set[x.id]) return;
      if(action==='read') x.unread=false; else if(action==='unread') x.unread=true;
      else if(action==='label'){ x.label_ids=(x.label_ids||[]).filter(function(l){return l!==labelId;}).concat([labelId]); }
      else if(action==='unlabel'){ x.label_ids=(x.label_ids||[]).filter(function(l){return l!==labelId;}); }
    }
    (m.messages||[]).forEach(touch); touch(m.message);
    okIds.forEach(function(id){ touch(_mc[acct+':'+id]); });
    if(action==='trash'||action==='archive'){
      m.messages=(m.messages||[]).filter(function(x){return !set[x.id];});
      if(m.selectedId&&set[m.selectedId]){ m.selectedId=null; m.message=null; }
      okIds.forEach(function(id){ cacheForget(acct,id); delete m.sel[id]; });
    }
  }
  window.mbBulk=function(action,labelId,idsOverride){
    var m=M(), acct=m.activeId;
    var ids=idsOverride||Object.keys(m.sel||{});
    if(!ids.length||m.bulkBusy) return Promise.resolve();
    m.bulkBusy=true; paint();
    return bulkRequest(acct,ids,action,labelId).then(function(results){
      if(M().activeId!==acct){ return; }
      var okIds=results.filter(function(r){return r.ok;}).map(function(r){return r.id;});
      var failed=results.length-okIds.length;
      applyLocal(acct,okIds,action,labelId);
      cacheDropAccount(acct); listCachePut();
      m.bulkBusy=false;
      var n=okIds.length;
      var msg={ trash:'Moved '+n+' to Trash — still recoverable in your mailbox', archive:'Archived '+n,
        read:'Marked '+n+' as read', unread:'Marked '+n+' as unread', label:'Labelled '+n, unlabel:'Label removed from '+n }[action]||('Done for '+n);
      if(failed) showToast(msg+' · '+failed+' could not be changed — try those again','warning');
      else showToast(msg,'success');
      render(); refreshUnread(true);
    }).catch(function(e){
      m.bulkBusy=false; render(); showToast('That did not go through: '+((e&&e.message)||e),'error');
    });
  };

  // The label picker: ✓ on every picked email, – on some, empty on none; one click flips it for them all.
  window.mbLabelMenu=function(ids){
    var m=M(); ids=ids||Object.keys(m.sel||{});
    if(!ids.length) return;
    ensureLabels();
    m.labelMenu={ids:ids.slice(),busy:false,err:null}; render();
    setTimeout(function(){ var i=document.getElementById('mb-newlabel'); if(i&&i.focus) i.focus(); },30);
  };
  window.mbLabelClose=function(){ var m=M(); if(!m.labelMenu) return; m.labelMenu=null; render(); };
  function labelState(labelId){
    var m=M(), ids=(m.labelMenu&&m.labelMenu.ids)||[];
    var rows=ids.map(function(id){
      return (m.messages||[]).filter(function(x){return x.id===id;})[0] || (m.message&&m.message.id===id?m.message:null) || _mc[m.activeId+':'+id] || {label_ids:[]};
    });
    var have=rows.filter(function(r){return (r.label_ids||[]).indexOf(labelId)>=0;}).length;
    return have===0?'none':(have===rows.length?'all':'some');
  }
  window.mbLabelToggle=function(labelId){
    var m=M(); if(!m.labelMenu||m.labelMenu.busy) return;
    var st=labelState(labelId), ids=m.labelMenu.ids.slice();
    m.labelMenu.busy=true; render();
    mbBulk(st==='all'?'unlabel':'label',labelId,ids).then(function(){ if(m.labelMenu){ m.labelMenu.busy=false; render(); } });
  };
  window.mbLabelCreate=function(){
    var m=M(); if(!m.labelMenu||m.labelMenu.busy) return;
    var inp=document.getElementById('mb-newlabel'); var name=inp?String(inp.value||'').trim():'';
    if(!name){ m.labelMenu.err='Give the label a name'; render(); return; }
    var acct=m.activeId, ids=m.labelMenu.ids.slice();
    m.labelMenu.busy=true; m.labelMenu.err=null; render();
    apiPost('/mailbox/'+enc(acct)+'/labels',{name:name}).then(function(l){
      m.labels[acct]=(m.labels[acct]||[]).filter(function(x){return x.id!==l.id;}).concat([{id:l.id,name:l.name||name}]);
      return mbBulk('label',l.id,ids);
    }).then(function(){ if(m.labelMenu){ m.labelMenu.busy=false; render(); } })
    .catch(function(e){ if(m.labelMenu){ m.labelMenu.busy=false; m.labelMenu.err=(e&&e.message)||'Could not create it'; render(); } });
  };
  function drawLabelMenu(){
    var m=M();
    if(STATE.page!=='mailbox'||!m.labelMenu) return '';
    var list=labelList(), n=m.labelMenu.ids.length;
    var rows=list.length?list.map(function(l){
      var st=labelState(l.id);
      return '<button class="mb-lm-row" '+(m.labelMenu.busy?'disabled ':'')+'onclick="mbLabelToggle(\''+escAttr(l.id)+'\')">'+
        '<span class="mb-lm-box st-'+st+'">'+(st==='all'?'✓':(st==='some'?'–':''))+'</span>'+
        '<span class="mb-lm-name">'+labelDot(l.id)+esc(l.name)+'</span></button>';
    }).join(''):'<div class="mb-lm-empty">No labels yet — make the first one below.</div>';
    return '<div class="overlay" onclick="mbLabelClose()">'+
      '<div class="modal mb-lm" role="dialog" aria-label="Label emails" onclick="event.stopPropagation()">'+
        '<div class="mb-lm-h"><b>Label '+n+' email'+(n===1?'':'s')+'</b>'+
          '<button class="btn btn-outline btn-sm" onclick="mbLabelClose()">Done</button></div>'+
        '<div class="mb-lm-list">'+rows+'</div>'+
        '<div class="mb-lm-new"><input id="mb-newlabel" class="sel" maxlength="60" placeholder="New label…" '+
          'onkeydown="if(event.key===\'Enter\'){mbLabelCreate()}">'+
          '<button class="btn btn-primary btn-sm" '+(m.labelMenu.busy?'disabled ':'')+'onclick="mbLabelCreate()">Create & apply</button></div>'+
        (m.labelMenu.err?'<div class="mb-lm-err">'+esc(m.labelMenu.err)+'</div>':'')+
      '</div></div>';
  }
  UI.registerOverlay('mb-labels',drawLabelMenu);
  document.addEventListener('keydown',function(ev){ if(ev.key==='Escape'&&M().labelMenu) mbLabelClose(); });

  window.mbSelectAccount=function(id){ var m=M(); if(m.activeId===id)return; m.activeId=id; m.q=''; loadFolders(); };
  window.mbSelectFolder=function(id){ var m=M(); if(m.folderId===id)return; m.folderId=id; loadMessages(); };
  window.mbOpen=function(id){ loadMessage(id); };
  // R-108: read a message in a long thread at (nearly) full screen height. Only a
  // class changes — see paint() — so the sandboxed frame is not rewritten.
  window.mbToggleTall=function(){
    var m=M(); m.bodyTall=!m.bodyTall; paint();
    if(m.bodyTall){ var o=document.getElementById('mb-open'); if(o&&o.scrollIntoView) o.scrollIntoView({block:'start'}); }
  };
  window.mbBack=function(){ var m=M(); m.bodyTall=false; m.selectedId=null; m.message=null; m.thread=null; m.threadId=null; paint(); };
  window.mbLoadMore=function(){ var m=M(); if(m.nextCursor) loadMessages(m.nextCursor); };
  window.mbRefresh=function(){ var m=M(); m.crm={}; delete _lc[lkey()]; delete _fc[m.activeId]; loadMessages(); fetchFolders(m.activeId,true); refreshUnread(true); };
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
    fetchMessage(m.activeId,m.message.id,true)
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
    // THE REPLY IS A WINDOW (7 Oct, owner: "it does not open up like a new window … we have to go back and take some
    // information from somewhere else in the app, what we have written goes off, the reply resets"). It was a box
    // inside the reading pane, wiped by the next click on a message. It is now a window on the dock
    // (10a-window-dock.js: minimise, full screen, look elsewhere in PACE, come back as left), it remembers WHICH
    // message it answers (so it can be sent from anywhere), and what is typed is also kept on this device
    // (a draft), so even closing it or reloading the page loses nothing.
    var c={ mode:mode, to:to, cc:cc, subject:subject, body:'', files:[], sig:sigPrefGet(), showCc:!!cc, sending:false,
            acct:m.activeId, msgId:x.id, from:(x.from&&(x.from.name||x.from.email))||'', savedAt:null };
    var d=draftGet(c);
    if(d){ c.to=d.to; c.cc=d.cc; c.subject=d.subject; c.body=d.body; c.showCc=!!d.cc; c.restored=true; }
    m.composer=c;
    if(c.sig) loadSignature();
    paintComposer();
    setTimeout(function(){ var ta=document.getElementById('mb-comp-body'); if(ta){ ta.focus(); try{ ta.setSelectionRange(ta.value.length,ta.value.length); }catch(e){} } },30);
    if(d) showToast('Your unsent draft for this message is back','info');
  }
  // A reply already open (on screen or minimised) comes back instead of being replaced by a blank one.
  function replyWindowOpen(){
    return (typeof STATE.modal==='string'&&STATE.modal.indexOf('data-win="mailReply"')>=0)||(window.Dock&&Dock.parkedKinds().indexOf('mailReply')>=0);
  }
  window.mbReply=function(all){ mbOpenReplyWindow(all?'replyAll':'reply'); };
  window.mbForward=function(){ mbOpenReplyWindow('forward'); };
  function mbOpenReplyWindow(mode){
    var m=M();
    if(m.composer&&replyWindowOpen()){
      // Words already typed are never replaced by a blank window: bring that one back and say so.
      if(String(m.composer.body||'').trim()){
        if(window.Dock) Dock.restoreKind('mailReply');
        showToast('You already have a reply open — send it or discard it first','info'); return;
      }
      if(window.Dock&&Dock.parkedKinds().indexOf('mailReply')>=0) Dock.discardKind('mailReply');   // an empty one is simply replaced
    }
    openComposer(mode);
  }
  // Discard = the draft is deleted too. Closing the window (×) keeps the draft on this device.
  window.mbCancelComposer=function(){ var m=M(); if(m.composer) draftClear(m.composer); m.composer=null; if(window.Dock) Dock.close(); else closeModal(); };
  window.mbCancelReply=window.mbCancelComposer;   // older name, still referenced
  window.mbCompField=function(k,v){ var m=M(); if(m.composer){ m.composer[k]=v; draftSaveSoon(); } };
  window.mbCompToggleCc=function(){ var m=M(); if(!m.composer)return; m.composer.showCc=!m.composer.showCc; paintComposer(); };
  window.mbCompSetSig=function(on){
    var m=M(); if(!m.composer)return;
    m.composer.sig=!!on; sigPrefSet(!!on);
    if(m.composer.sig) loadSignature();
    paintComposer();
  };

  // ── the draft kept on this device ───────────────────────────────────────────
  // Not the provider's Drafts folder (that needs Gmail/Outlook draft calls — offered, not built): a copy in this
  // browser, keyed by mailbox + message + kind of reply, written a moment after typing stops and removed on send/discard.
  function draftKey(c){ return 'pace-mb-draft:'+(c.acct||'')+':'+(c.msgId||'')+':'+(c.mode==='forward'?'fwd':'re'); }
  function draftGet(c){
    try{ var v=JSON.parse(localStorage.getItem(draftKey(c))||'null'); return (v&&String(v.body||'').trim())?v:null; }catch(e){ return null; }
  }
  function draftClear(c){ try{ localStorage.removeItem(draftKey(c)); }catch(e){} }
  var _draftT=null;
  function draftSave(){
    var c=M().composer; if(!c)return;
    ['to','cc','subject','body'].forEach(function(k){ var el=document.getElementById('mb-comp-'+k); if(el) c[k]=el.value; });
    try{
      if(String(c.body||'').trim()){
        localStorage.setItem(draftKey(c),JSON.stringify({to:c.to,cc:c.cc,subject:c.subject,body:c.body,at:Date.now()}));
        c.savedAt=Date.now();
        var el=document.getElementById('mb-comp-saved'); if(el) el.textContent='Draft saved on this device';
      } else draftClear(c);
    }catch(e){}
  }
  function draftSaveSoon(){ clearTimeout(_draftT); _draftT=setTimeout(draftSave,600); }
  window.mbDraftFlush=function(){ clearTimeout(_draftT); draftSave(); };

  function loadSignature(){
    var m=M(); if(m.sigHtml!==null||m.sigLoading||!m.activeId)return;
    m.sigLoading=true;
    apiGet('/mailbox/'+encodeURIComponent(m.activeId)+'/signature')
      .then(function(d){ m.sigHtml=(d&&d.html)||''; m.sigLoading=false; if(m.composer) paintComposer(); else paint(); })
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
      paintComposer();
    }
  };
  window.mbRemoveFile=function(i){ var m=M(); if(!m.composer)return; m.composer.files.splice(i,1); paintComposer(); };

  window.mbSendComposer=function(){
    mbChipFlush();
    var m=M(); var c=m.composer; if(!c||!c.msgId||c.sending)return;
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
    c.sending=true; paintComposer();
    var payload={
      body:c.body, subject:c.subject,
      to:c.to, cc:c.cc,
      include_signature:!!c.sig,
      attachments:(c.files||[]).map(function(f){return {filename:f.name,content_type:f.type,base64:f.base64};})
    };
    // The mailbox and message captured when the window was opened — not whatever is selected now.
    var path='/mailbox/'+encodeURIComponent(c.acct)+'/messages/'+encodeURIComponent(c.msgId)+
      (c.mode==='forward'?'/forward':'/reply');
    if(c.mode!=='forward') payload.reply_all=(c.mode==='replyAll');
    apiPost(path,payload)
      .then(function(){
        showToast(c.mode==='forward'?'Forwarded':'Reply sent','success');
        draftClear(c);
        // Close whichever way the window is now: on screen, or parked while the person looked elsewhere.
        if(m.composer===c){ m.composer=null; if(window.Dock&&Dock.parkedKinds().indexOf('mailReply')>=0) Dock.discardKind('mailReply'); else closeModal(); }
        paint();
      })
      .catch(function(e){
        c.sending=false; if(m.composer===c) paintComposer();
        showToast((c.mode==='forward'?'Forward':'Send')+' failed: '+e.message,'error');
      });
  };
  // Older name kept so nothing that still calls it silently does nothing.
  window.mbSendReply=window.mbSendComposer;

  // ── compose (new message) ───────────────────────────────────────────────────
  window.mbCompose=function(prefillTo){
    var m=M();
    if(!m.activeId){ showToast('Connect a mailbox first','warning'); return; }
    // One new message at a time: a draft parked in the tray comes back rather than
    // being silently replaced by an empty one.
    if(window.Dock&&Dock.restoreKind('mailCompose')) return;
    m.compose={ to:prefillTo||'', cc:'', subject:'', body:'', files:[], sig:sigPrefGet(), sending:false };
    if(m.compose.sig) loadSignature();
    paintComposeModal();
  };
  // "Email this person" from anywhere in PACE (owner, 2026-09-30: the email links on
  // candidate rows opened the computer's mail program instead of PACE). Opens the
  // in-app New message window already addressed, loading the person's mailboxes
  // first if the Mailbox page has not been visited yet. Sends nothing.
  window.mbComposeTo=function(to,subject){
    var m=M();
    var go=function(){
      if(!m.activeId){ showToast('Connect a mailbox first — Email → Accounts','warning'); return; }
      mbCompose(to);
      if(subject&&m.compose&&!m.compose.subject){ m.compose.subject=subject; paintComposeModal(); }
    };
    if(m.activeId) return go();
    apiGet('/mailbox/accounts').then(function(d){ m.accounts=d||[]; pickAccount(m.accounts); go(); })
      .catch(function(e){ showToast('Could not load your mailboxes: '+((e&&e.message)||e),'error'); });
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
    var html=
      '<div class="modal modal-w640" data-win="mailCompose" onclick="event.stopPropagation()">'+
        '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">'+
          '<div class="mhd">New message</div>'+
          '<div class="fs-11_5 c-text3" style="margin-top:2px">From '+esc(from.email_address||'')+'</div>'+
        '</div>'+
        '<div style="padding:16px 20px">'+
          '<div style="margin-bottom:12px"><label class="fs-11 c-text2" style="display:block;margin-bottom:3px">To <span class="c-text3">(press Enter or comma after each address)</span></label>'+chipField('mb-c-to','to',c.to,'mbComposeField','someone@company.com')+'</div>'+
          '<div style="margin-bottom:12px"><label class="fs-11 c-text2" style="display:block;margin-bottom:3px">Cc <span class="c-text3">(optional — add as many as you like)</span></label>'+chipField('mb-c-cc','cc',c.cc,'mbComposeField','')+'</div>'+
          field('mb-c-subject','Subject','',c.subject,'mbComposeField(\'subject\',this.value)')+
          '<div><label class="fs-11 c-text2" style="display:block;margin-bottom:3px">Message</label>'+
            '<textarea id="mb-c-body" class="sel" oninput="mbComposeField(\'body\',this.value)" style="min-height:180px;resize:vertical;font-size:12.5px;line-height:1.55">'+esc(c.body)+'</textarea></div>'+
          renderAttachRow(c.files,'mbComposePickFiles()','mbComposeRemoveFile','mb-c-files','mbComposeFilesChosen(this)')+
          renderSigRow(c.sig,'mbComposeSetSig')+
        '</div>'+
        '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">'+
          '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
          '<button class="btn btn-primary" id="mb-c-send" onclick="mbSendCompose()"'+(c.sending?' disabled':'')+'>'+(c.sending?'Sending…':'Send')+'</button>'+
        '</div>'+
      '</div>';
    // Minimised (10a-window-dock.js): a repaint from a signature or an attachment
    // finishing must update the parked window, never open it over the page.
    if(window.Dock&&Dock.updateParked('mailCompose',html))return;
    STATE.modal=html;
    render();
  }
  // Closing the parked window's chip discards the draft with it — no ghost.
  if(window.Dock) Dock.onDiscard('mailCompose',function(){ M().compose=null; });
  // ── ADDRESS CHIPS (R-093) ─────────────────────────────────────────────────
  // Owner: "once one email is added into the CC row … there is no option to add
  // another". The box always took a comma-separated list, but nothing said so.
  // Now each address becomes a chip: type it, press Enter / comma / semicolon
  // (or just click away) and it is added; × removes one; Backspace on an empty
  // box takes the last one back. The real value stays in a hidden input with the
  // same id the old text box had, so every reader of `#mb-c-to` / `#mb-comp-cc`
  // keeps working and the server still gets "a@x.com, b@y.com".
  function chipOk(a){ return /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(a) || /<[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+>\s*$/.test(a); }
  function chipHtml(a){
    return '<span class="chipf-c'+(chipOk(a)?'':' bad')+'" data-a="'+escAttr(a)+'">'+esc(a)+
      '<button type="button" tabindex="-1" aria-label="Remove '+escAttr(a)+'" onclick="mbChipRm(this,event)">&times;</button></span>';
  }
  function chipList(v){ return String(v||'').split(/[,;\n]+/).map(function(x){return x.trim();}).filter(Boolean); }
  // cb = name of the state setter (mbCompField | mbComposeField), key = to | cc
  function chipField(id,key,value,cb,ph){
    return '<div class="chipf" data-chipf data-cb="'+cb+'" data-k="'+key+'" onclick="this.querySelector(\'.chipf-in\').focus()">'+
      '<input type="hidden" id="'+id+'" value="'+escAttr(chipList(value).join(', '))+'">'+
      chipList(value).map(chipHtml).join('')+
      '<input type="text" class="chipf-in" autocomplete="off" placeholder="'+escAttr(chipList(value).length?'add another…':(ph||''))+'" '+
        'onkeydown="mbChipKey(event,this)" oninput="mbChipInput(this)" onblur="mbChipCommit(this)">'+
    '</div>';
  }
  function chipSync(box){
    var list=Array.prototype.map.call(box.querySelectorAll('.chipf-c'),function(c){return c.getAttribute('data-a');});
    var v=list.join(', ');
    box.querySelector('input[type=hidden]').value=v;
    var cb=window[box.getAttribute('data-cb')]; if(cb) cb(box.getAttribute('data-k'),v);
    var inp=box.querySelector('.chipf-in'); if(inp && !inp.value) inp.placeholder=list.length?'add another…':'';
  }
  window.mbChipCommit=function(inp){
    var box=inp.closest('.chipf'); if(!box)return;
    var parts=chipList(inp.value); inp.value='';
    if(!parts.length)return;
    parts.forEach(function(a){
      var have=Array.prototype.some.call(box.querySelectorAll('.chipf-c'),function(c){return c.getAttribute('data-a').toLowerCase()===a.toLowerCase();});
      if(have)return;
      inp.insertAdjacentHTML('beforebegin',chipHtml(a));
    });
    chipSync(box);
  };
  window.mbChipKey=function(e,inp){
    if(e.key==='Enter'||e.key===','||e.key===';'){ e.preventDefault(); mbChipCommit(inp); return; }
    if(e.key==='Backspace' && !inp.value){
      var box=inp.closest('.chipf'); var cs=box.querySelectorAll('.chipf-c');
      if(cs.length){ cs[cs.length-1].remove(); chipSync(box); }
    }
  };
  window.mbChipInput=function(inp){ if(/[,;\n]/.test(inp.value)) mbChipCommit(inp); };   // a pasted list
  window.mbChipRm=function(btn,e){
    if(e){ e.stopPropagation(); }
    var box=btn.closest('.chipf'); btn.parentNode.remove(); if(box) chipSync(box);
  };
  // Anything typed but not yet committed counts — a send must never lose it.
  window.mbChipField=chipField;   // reused by the submission-email section (33-stage-modal.js)
  window.mbChipFlush=function(){ Array.prototype.forEach.call(document.querySelectorAll('.chipf-in'),function(i){ if(i.value) mbChipCommit(i); }); };

  function field(id,label,ph,val,oninput){
    return '<div style="margin-bottom:12px"><label class="fs-11 c-text2" style="display:block;margin-bottom:3px">'+label+'</label>'+
      '<input id="'+id+'" class="sel" placeholder="'+escAttr(ph)+'" value="'+escAttr(val||'')+'" oninput="'+oninput+'"></div>';
  }

  window.mbSendCompose=function(){
    mbChipFlush();
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
      '<div id="mb-bulk" style="flex:none">'+p.bulk+'</div>'+
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
      bulk:renderBulkBar(),
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
    p.tall=p.short&&!!m.bodyTall;   // R-108: the reader's own "Expand" choice
    // ONE SCROLLBAR, not two. A single-message conversation with no reply box
    // open lets the body fill the pane and scroll inside itself; the pane does
    // not scroll at all. Before this the pane scrolled AND the 420px body
    // scrolled, so a wheel over the message scrolled the text, hit its end and
    // then jerked the whole pane — and every one of those pane scrolls moved
    // the iframe, which is what made reading feel like it was flickering.
    // With several messages on screen the pane has to scroll, so it does.
    p.solo=(thread.length===1);
    p.head=renderHead(x, thread.length);
    p.before=thread.slice(0,at).map(renderCollapsedMessage).join('');
    p.open=renderOpenMessage(x);
    p.after=thread.slice(at+1).map(renderCollapsedMessage).join('');
    p.comp='';   // the reply is its own window (paintComposer)
    p.reader='<div class="mb-read" id="mb-read" data-shape="msg">'+
      '<div class="mb-head" id="mb-head">'+p.head+'</div>'+
      '<div class="mb-thread'+(p.solo?' solo':'')+'" id="mb-thread">'+
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
      ? '<span class="fs-12 c-ink3">'+esc(folder.name)+
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
        '<div class="c-text3" style="margin-bottom:14px">'+icon('inbox',40)+'</div>'+
        '<div class="fs-17" style="font-weight:700;margin-bottom:6px">No mailbox connected yet</div>'+
        '<div class="fs-13 c-text2" style="line-height:1.6;margin-bottom:18px">'+
          'Connect your Outlook or Gmail account and your inbox, sent mail and folders appear here — '+
          'so you can work your email without leaving PACE.'+
        '</div>'+
        (broken.length
          ? '<div class="fs-12 c-amber" style="background:var(--amber-l);border:1px solid var(--amber);border-radius:var(--r);padding:10px 12px;margin-bottom:16px;text-align:left">'+
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
      : '<div class="fs-13" style="font-weight:600">'+esc((readable[0]||{}).email_address||'')+
        '<span class="c-ink3" style="font-weight:400"> · '+esc((readable[0]||{}).platform==='Gmail'?'Gmail':'Outlook')+'</span></div>';

    var folders=m.folders||[];
    var folderPicker = m.foldersLoading
      ? '<span class="fs-12_5 c-ink3">Loading folders…</span>'
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
    else body=selectHead(rows)+rows.map(function(x){ return renderRow(x, m.selectedId===x.id); }).join('');

    return '<div class="mb-list'+(wide?' wide':'')+'" id="mb-list">'+
      body+
      (m.nextCursor
        ? '<div style="padding:12px;text-align:center"><button class="btn btn-sm btn-outline" onclick="mbLoadMore()"'+(m.listLoading?' disabled':'')+'>'+(m.listLoading?'Loading…':'Load more')+'</button></div>'
        : '')+
    '</div>';
  }

  // ── LABELS (Gmail labels / Outlook categories) ────────────────────────────────
  function labelList(){
    var m=M(); var l=(m.labels&&m.labels[m.activeId])||[];
    var seen={}; l.forEach(function(x){ seen[x.id]=1; });
    // Outlook applies a category by NAME, and its master list may be unreadable — so the names the
    // loaded messages already carry are offered too.
    var extra=[];
    (m.messages||[]).concat(m.message?[m.message]:[]).forEach(function(x){
      (x.label_ids||[]).forEach(function(id){ if(!seen[id]&&(m.accounts||[]).some(function(a){return a.id===m.activeId&&a.platform!=='Gmail';})){ seen[id]=1; extra.push({id:id,name:id}); } });
    });
    return l.concat(extra);
  }
  function labelName(id){
    var l=labelList().filter(function(x){return x.id===id;})[0];
    return l?l.name:'';
  }
  // The label's own colour as a small square beside its name (R-136) — a square, never a coloured chip, so the
  // text keeps the paper's ink and its contrast, whatever colour the person chose in Gmail or Outlook.
  function labelColor(id){
    var l=labelList().filter(function(x){return x.id===id;})[0];
    return (l&&l.color)||'';
  }
  function labelDot(id){
    var c=labelColor(id);
    return /^#[0-9a-fA-F]{3,8}$/.test(c)?'<i class="mb-ldot" style="background:'+c+'"></i>':'';
  }
  function labelChips(ids,max){
    ids=(ids||[]); if(!ids.length) return '';
    var named=ids.map(function(id){ return {id:id,name:labelName(id)}; }).filter(function(x){return x.name;});
    if(!named.length) return '';
    var shown=named.slice(0,max||2), more=named.length-shown.length;
    return '<div class="mb-lbls">'+shown.map(function(x){ return '<span class="mb-lbl">'+labelDot(x.id)+esc(x.name)+'</span>'; }).join('')+
      (more>0?'<span class="mb-lbl mb-lbl-more">+'+more+'</span>':'')+'</div>';
  }
  function ensureLabels(){
    var m=M(), acct=m.activeId; if(!acct) return;
    m.labels=m.labels||{};
    if(m.labels[acct]) return;
    m.labels[acct]=[];                                   // asked once; an unreadable list is "no list"
    apiGet('/mailbox/'+enc(acct)+'/labels').then(function(d){
      m.labels[acct]=d||[]; paint();
    }).catch(function(){ /* labels are a nicety — the inbox works without the list */ });
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
    var picked=!!((m.sel||{})[x.id]);
    return '<div class="mb-row'+(active?' on':'')+(x.unread?' unread':'')+(picked?' picked':'')+'" onclick="mbOpen(\''+escAttr(x.id)+'\')" '+
      'onmouseenter="mbHover(\''+escAttr(x.id)+'\')" onmouseleave="mbHoverEnd()">'+
      '<label class="mb-chk" title="Select" onclick="event.stopPropagation()"><input type="checkbox" '+(picked?'checked ':'')+'onclick="mbSel(\''+escAttr(x.id)+'\',event)" aria-label="Select this email"></label>'+
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
        labelChips(x.label_ids,2)+
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
    else                       inner='<span class="c-red">'+esc(m.error||'Could not open this message')+'</span>';
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
      labelChips(x.label_ids,6)+
      '<div class="mb-acts">'+
        '<button class="btn btn-sm btn-primary" onclick="mbReply(false)">'+UI.ic('reply')+'Reply</button>'+
        ((x.to||[]).length+(x.cc||[]).length>1?'<button class="btn btn-sm btn-outline" onclick="mbReply(true)">Reply all</button>':'')+
        '<button class="btn btn-sm btn-outline" onclick="mbForward()">Forward</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mbArchive(\''+escAttr(x.id)+'\',event)">Archive</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mbToggleRead(\''+escAttr(x.id)+'\',event)">'+(x.unread?'Mark read':'Mark unread')+'</button>'+
        '<button class="btn btn-sm btn-outline" onclick="mbLabelMenu([\''+escAttr(x.id)+'\'])">Label</button>'+
        (hasOthers?'<button class="btn btn-sm btn-outline" title="Make the open message taller, to read it without scrolling inside it" onclick="mbToggleTall()">'+(M().bodyTall?'Shrink message':'Expand message')+'</button>':'')+
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
          '<div class="mb-from fs-13">'+esc(who(t.from))+'</div>'+
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
          '📎 '+esc(a.name||'attachment')+' <span class="c-text3">'+fmtSize(a.size)+'</span></button>';
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
          return '<span class="fs-11" style="display:inline-flex;align-items:center;gap:5px;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:2px 4px 2px 9px">'+
            esc(f.name)+' <span class="c-text3">'+fmtSize(f.size)+'</span>'+
            '<button onclick="'+removeFn+'('+i+')" title="Remove" class="c-text3 fs-13" style="line-height:1;padding:0 3px">✕</button></span>';
        }).join('')+
      '</div>'+
      (over?'<div class="fs-11 c-red" style="margin-top:5px">That is over the '+(MAX_ATTACH_BYTES/1048576).toFixed(1)+' MB limit — remove something, or send the big files as a link.</div>':'')+
    '</div>';
  }

  // The signature picker. Off by default and remembered, with the real filled
  // signature shown when it is on — so what you pick is what the recipient gets.
  function renderSigRow(on, setFn){
    var m=M();
    return '<div style="margin-top:10px;display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap">'+
      '<label class="fs-11 c-text2" style="padding-top:5px">Signature</label>'+
      '<select class="sel" style="width:auto;font-size:12px;padding:4px 8px" onchange="'+setFn+'(this.value===\'1\')">'+
        '<option value="0"'+(on?'':' selected')+'>No signature</option>'+
        '<option value="1"'+(on?' selected':'')+'>My signature</option>'+
      '</select>'+
      (on
        ? '<div style="flex:1;min-width:200px;border:1px solid var(--border);border-radius:var(--r);padding:8px 10px;background:var(--card);max-height:120px;overflow:auto">'+
            (m.sigLoading?'<span class="fs-11 c-text3">Loading…</span>'
              : (m.sigHtml?m.sigHtml:'<span class="fs-11 c-text3">No signature saved for this mailbox.</span>'))+
          '</div>'
        : '')+
    '</div>';
  }

  // The reply / forward window. Same fields and handlers as before (mb-comp-*), now a modal on the dock.
  function paintComposer(){
    var m=M(); var c=m.composer; if(!c)return;
    var fwd=c.mode==='forward';
    var title=fwd?'Forward':(c.mode==='replyAll'?'Reply all':'Reply')+(c.from?' to '+c.from:'');
    var from=(m.accounts||[]).filter(function(a){return a.id===c.acct;})[0]||{};
    var html=
      '<div class="modal modal-w640" data-win="mailReply" onclick="event.stopPropagation()">'+
        '<div class="mb-win-hd">'+
          '<div class="mhd">'+esc(title)+'</div>'+
          '<div class="fs-11_5 c-text3">From '+esc(from.email_address||'')+(fwd?' · attachments on the original are carried over':' · the original is quoted underneath automatically')+'</div>'+
        '</div>'+
        '<div class="mb-win-bd">'+
          '<div class="mb-win-row"><label class="fs-11 c-text2">To</label>'+
            chipField('mb-comp-to','to',c.to,'mbCompField',fwd?'someone@company.com':'')+
            (c.showCc?'':'<button class="btn btn-xs btn-ghost" onclick="mbCompToggleCc()">Add Cc</button>')+'</div>'+
          (c.showCc?'<div class="mb-win-row"><label class="fs-11 c-text2">Cc</label>'+chipField('mb-comp-cc','cc',c.cc,'mbCompField','')+'</div>':'')+
          '<div class="mb-win-row"><label class="fs-11 c-text2">Subject</label>'+
            '<input id="mb-comp-subject" class="sel mb-win-grow" value="'+escAttr(c.subject||'')+'" oninput="mbCompField(\'subject\',this.value)"></div>'+
          '<textarea id="mb-comp-body" class="sel mb-win-text" oninput="mbCompField(\'body\',this.value)" '+
            'placeholder="'+(fwd?'Add a note (optional)…':'Write your reply…')+'">'+esc(c.body||'')+'</textarea>'+
          renderAttachRow(c.files,'mbPickFiles()','mbRemoveFile','mb-comp-files','mbFilesChosen(this)')+
          renderSigRow(c.sig,'mbCompSetSig')+
        '</div>'+
        '<div class="mb-win-ft">'+
          '<span class="fs-11 c-text3" id="mb-comp-saved" title="Closing this window keeps your draft on this device. Discard deletes it.">'+(c.restored?'Draft restored from this device':(c.savedAt?'Draft saved on this device':'Your words are kept on this device as you type'))+'</span>'+
          '<span class="mb-win-btns">'+
            '<button class="btn btn-outline" onclick="mbCancelComposer()">Discard</button>'+
            '<button class="btn btn-primary" id="mb-comp-send" onclick="mbSendComposer()"'+(c.sending?' disabled':'')+'>'+(c.sending?'Sending…':(fwd?'Forward':'Send'))+'</button>'+
          '</span>'+
        '</div>'+
      '</div>';
    // Minimised: a repaint (a signature or file finishing) updates the parked window, it never pops open over the page.
    if(window.Dock&&Dock.updateParked('mailReply',html))return;
    STATE.modal=html;
    render();
  }
  // The chip's × on a parked reply: the window goes, the draft stays on this device.
  if(window.Dock) Dock.onDiscard('mailReply',function(){ M().composer=null; });

})();
