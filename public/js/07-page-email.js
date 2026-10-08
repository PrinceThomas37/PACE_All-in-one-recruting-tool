// ── EMAIL ──────────────────────────────────────
// The Pending tab's one-line split. Every pending email is in exactly one of
// these (GET /emails/pending-summary) — "ready now" used to count the ones
// waiting out a retry and the ones held by the company limit as well.
function pendingSplitLine(ps){
  ps=ps||{};
  var parts=[(ps.ready_now||0)+' ready now', (ps.waiting_window||0)+' waiting for the send window'];
  if(ps.waiting_retry)parts.push(ps.waiting_retry+' waiting to retry');
  if(ps.held_company)parts.push(ps.held_company+' held until tomorrow');
  return parts.join(' · ');
}
window.pendingSplitLine=pendingSplitLine;
window.seqView=function(v){ if(STATE.seqView===v) return; STATE.seqView=v; render(); };

// Spam check inside the sequence editor (owner, 8 Oct: it belongs where the wording is written, not on a tab nobody opens). Checks the
// subject and body as they are typed right now — saved or not — and writes the answer into its own box, so nothing is repainted
// under the person's hands.
function seqSpamHtml(key){
  var r=STATE.seqSpam; if(!r||r.key!==key||!r.res) return '';
  var res=r.res, lvl=res.level==='risk'?'is-risk':res.level==='warn'?'is-warn':'is-ok';
  return '<div class="seq-spam-box '+lvl+'" role="status"><div class="fs-13 fw6">Spam score '+htmlEsc(String(res.score))+'/100 — '+htmlEsc(String(res.level))+'</div>'+
    (res.warnings&&res.warnings.length?'<ul class="fs-12 c-text2">'+res.warnings.map(function(w){ return '<li>'+htmlEsc(w)+'</li>'; }).join('')+'</ul>':'<div class="fs-12 c-text3">Looks clean.</div>')+
    '<div class="fs-11 c-text3">Checked as written just now — press the button again after you edit.</div></div>';
}
window.seqSpamCheck=function(key,subjId,bodyId){
  var sj=(document.getElementById(subjId)||{}).value||'', bd=(document.getElementById(bodyId)||{}).value||'';
  if(!String(sj+bd).trim()){ showToast('Write the email first, then check it','info'); return; }
  apiPost('/emails/spam-check',{subject:sj,body:bd}).then(function(res){
    STATE.seqSpam={key:key,res:res};
    var el=document.getElementById('seq-spam'); if(el) el.innerHTML=seqSpamHtml(key);
  }).catch(function(e){ showToast('Could not check it: '+((e&&e.message)||e),'error'); });
};

function loadMySendingStatus(){
  apiGet('/sending/my-status').then(function(s){
    STATE.mySendingPaused=!!(s&&s.paused);
    scheduleRender();
  }).catch(function(){if(STATE.mySendingPaused===undefined)STATE.mySendingPaused=false;});
}

// ── COMPOSE PREVIEW ─────────────────────────────────────────────────────────
// What the recipient will actually see, rebuilt from STATE on every keystroke.
//
// Two rules make this worth having rather than decorative:
//
//  1. {{sender}} / {{senderemail}} resolve from the SELECTED SENDING MAILBOX,
//     never from the logged-in user. That is the rule the send path follows,
//     and a preview that used the logged-in user instead would have shown
//     "Prince Thomas" for the exact bug where 152 emails went out under the
//     wrong name.
//  2. A variable that CANNOT be filled is left visible and highlighted rather
//     than silently blanked. "Hi ," in the preview looks like a typo; a marked
//     {{fn}} tells you the recipient has no first name on record, which is the
//     actual problem to fix before sending.

// The recipient/lead a compose is aimed at, or nulls when none is picked yet.
function composeTarget(){
  var contact=null, job=null;
  if(STATE.composeContactId){
    var parts=String(STATE.composeContactId).split('|');
    contact=(STATE.contacts||[]).find(function(c){return c.id===parts[0];})||null;
    job=(STATE.jobs||[]).find(function(j){return j.id===parts[1];})||null;
  }
  return { contact:contact, job:job };
}

function composeVars(){
  var t=composeTarget(), c=t.contact, j=t.job;
  var u=STATE.user||{};
  var emails=(STATE.userEmailsCache&&STATE.userEmailsCache[u.id]||[]);
  var from=emails.find(function(e){return e.id===STATE.composeFromEmailId;})||null;
  return {
    '{{fn}}':          c?(c.first_name||''):'',
    '{{first_name}}':  c?(c.first_name||''):'',
    '{{ln}}':          c?(c.last_name||''):'',
    '{{pos}}':         j?(j.position||j.job_title||''):'',
    '{{company}}':     j?(j.company_name||''):'',
    '{{loc}}':         j?[j.city,j.state].filter(Boolean).join(', '):'',
    // The sender comes from the MAILBOX, not the session. See the note above.
    '{{sender}}':      from?(from.display_name||from.email_address||''):'',
    '{{senderemail}}': from?(from.email_address||''):''
  };
}

// Fill variables into ALREADY-ESCAPED text. Unfillable ones survive as a
// highlighted chip so they are impossible to miss.
function composeFillEscaped(escaped){
  var vars=composeVars();
  return String(escaped||'').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, function(match, name){
    var key='{{'+name.toLowerCase()+'}}';
    var val=vars[key];
    if(val===undefined) return '<span class="cmp-unset" title="Not a variable this app fills">'+htmlEsc(match)+'</span>';
    if(val==='')        return '<span class="cmp-unset" title="Nothing on record to fill this with">'+htmlEsc(match)+'</span>';
    return htmlEsc(val);
  });
}

// The body of the preview panel: subject, message, signature.
function composePreviewInner(){
  var u=STATE.user||{};
  var emails=(STATE.userEmailsCache&&STATE.userEmailsCache[u.id]||[]);
  var from=emails.find(function(e){return e.id===STATE.composeFromEmailId;})||null;

  var subj=String(STATE.composeSubj||'');
  var body=String(STATE.composeBody||'');
  if(!subj && !body){
    return '<div class="c-ink3 fs-13" style="padding:26px 0;text-align:center">'+
      'Start typing a subject or message and it appears here, filled in for this recipient.</div>';
  }

  // The signature the selected mailbox will append. Shown only once it has
  // actually loaded — inventing one would be showing the recipient something
  // that may not be what goes out.
  var sigRaw = from && STATE.emailSignaturesCache ? STATE.emailSignaturesCache[from.id] : undefined;
  var sigHtml='';
  if(sigRaw){
    var normalized = (typeof normalizeMailboxSignature==='function') ? normalizeMailboxSignature(sigRaw) : sigRaw;
    sigHtml = (typeof fillSignatureHtml==='function')
      ? fillSignatureHtml(normalized, (from.display_name||from.email_address||''), (from.email_address||''))
      : normalized;
  }

  return (subj?'<div class="cmp-subject">'+composeFillEscaped(htmlEsc(subj))+'</div>':'')+
    '<div class="cmp-body">'+composeFillEscaped(htmlEsc(body))+'</div>'+
    (sigHtml?'<div class="cmp-sig">'+sigHtml+'</div>':'');
}

// Repaint only the preview. A full render() on every keystroke would rebuild
// the textarea and fight the caret.
function composeRepaintPreview(){
  var el=document.getElementById('cmp-mail');
  if(el)el.innerHTML=composePreviewInner();
}

// ── OUTREACH PLAN: the same live preview, so the right half is never blank (owner, 6 Oct) ──
// The template is shown filled in for an EXAMPLE person (marked as one), signed by the mailbox
// chosen above. {{sender}} comes from that mailbox, exactly as at send time; a field PACE cannot
// fill is left visible and marked, never blanked.
var PLAN_EXAMPLE={
  '{{fn}}':'Sam','{{first_name}}':'Sam','{{ln}}':'Rivera','{{desig}}':'Operations Director',
  '{{pos}}':'Senior Estimator','{{company}}':'Acme Builders','{{loc}}':'Dallas, TX','{{city}}':'Dallas',
  '{{ind}}':'Construction','{{skills_line}}':' with experience in Bluebeam and Procore',
  '{{job_resp}}':'Bluebeam and Procore','{{company_service}}':'Commercial construction',
  '{{local_line}}':'Local candidates only.','{{salary_line}}':'($95k–$110k)','{{salary_range}}':'$95k–$110k',
  '{{skill_1}}':'Bluebeam','{{skill_2}}':'Procore','{{skill_3}}':'Takeoffs'
};
// R-176: one wording for all my email IDs, or one each. With "each" the editor FOLLOWS the Sending email chosen above — the way the
// signature does (owner, 8 Oct: "the template should change when the email ID above is changed, like the signature is"). So there is
// no list of email IDs here: pick the Sending email, and the wording below is that email ID's.
function renderWordingScopeCard(planEmails,planFromId){
  var each=planScope()==='each';
  var radio=function(v,label,hint){
    return '<label class="fd-use fd-block"><input type="radio" name="wscope" '+(planScope()===v?'checked':'')+' onclick="setWordingScope(\''+v+'\')"> <strong>'+label+'</strong><span class="fd-hint"> '+hint+'</span></label>';
  };
  var note='';
  if(each){
    var mb=planEmails.filter(function(e){return e.id===planFromId;})[0];
    var who=mb?htmlEsc(mb.email_address):'this email ID';
    note=mb&&mailboxHasOwnWording(mb.id)
      ? '<div class="fs-12_5 c-text2" style="margin-top:8px">The wording below is for <strong>'+who+'</strong> only. <button class="btn btn-xs btn-outline" onclick="wordingUseMine(\''+htmlEsc(mb.id)+'\')">Use my main wording again</button></div>'
      : '<div class="fs-12_5 c-text2" style="margin-top:8px"><strong>'+who+'</strong> has no wording of its own yet, so it sends your main wording (shown below). Change it and press Save to give this email ID its own.</div>';
    note+='<div class="fs-12 c-text3" style="margin-top:4px">Pick another Sending email above and the wording below changes to that email ID\'s.</div>';
  }
  return '<div class="card cp mb3"><div class="fw6 fs-13" style="margin-bottom:6px">Wording for your email IDs</div>'+
    radio('all','One wording for all my email IDs','— what you write below goes out from every email ID (only the signature differs)')+
    radio('each','A different wording for each email ID','— e.g. two companies, two pitches')+note+'</div>';
}
// {{sendercompany}} — "Your company", said once per email ID, right here (owner, 8 Oct: "your company name section, so it can be added
// easily for different email IDs"). It is the mailbox's own "sends as" (company, title, address — all three are needed once, because every
// outreach email must carry the sender's postal address); changing the Sending email above shows that email ID's company.
function renderCompanyCard(planEmails,planFromId){
  var mb=planEmails.filter(function(e){return e.id===planFromId;})[0]; if(!mb) return '';
  var sa=mb.sends_as||{}, d=STATE.planCompanyDraft||{}, complete=!!(sa.company&&sa.title&&sa.address);
  var val=function(k){ return htmlEsc(d.mb===mb.id&&d[k]!==undefined?d[k]:(sa[k]||'')); };
  var inp=function(k,ph){ return '<input class="inp fd-wide" id="pc-'+k+'" placeholder="'+ph+'" value="'+val(k)+'" oninput="planCompanyType(\''+k+'\',this.value,\''+htmlEsc(mb.id)+'\')">'; };
  return '<div class="card cp mb3"><div class="fw6 fs-13" style="margin-bottom:2px">Your company — for '+htmlEsc(mb.email_address)+'</div>'+
    '<div class="fs-11_5 c-text3" style="margin-bottom:8px">The company this email ID writes for. Put <b>Your company</b> in the wording (chips below) and each email ID fills in its own.'+(complete?'':' It is also needed once for the signature: the title and the postal address.')+'</div>'+
    inp('company','Company name, e.g. VHC Staffing')+
    (complete?'':'<div style="margin-top:6px">'+inp('title','Your job title, e.g. Recruitment Manager')+'</div><div style="margin-top:6px">'+inp('address','Company postal address')+'</div>')+
    '<button class="btn btn-sm btn-primary" style="margin-top:8px" onclick="savePlanCompany(\''+htmlEsc(mb.id)+'\')">Save company</button></div>';
}
window.planCompanyType=function(k,v,mbId){ STATE.planCompanyDraft=STATE.planCompanyDraft||{}; if(STATE.planCompanyDraft.mb!==mbId) STATE.planCompanyDraft={mb:mbId}; STATE.planCompanyDraft[k]=v; };
window.savePlanCompany=function(mbId){
  var u=STATE.user||{}, list=(STATE.userEmailsCache&&STATE.userEmailsCache[u.id])||[], mb=list.filter(function(e){return e.id===mbId;})[0]; if(!mb) return;
  var sa=Object.assign({},mb.sends_as||{}), d=STATE.planCompanyDraft&&STATE.planCompanyDraft.mb===mbId?STATE.planCompanyDraft:{};
  ['company','title','address'].forEach(function(k){ if(d[k]!==undefined) sa[k]=String(d[k]).trim(); });
  if(!sa.company){ showToast('Say which company this email ID writes for','warning'); return; }
  apiPut('/users/'+u.id+'/emails/'+mbId+'/sends-as',sa).then(function(r){
    mb.sends_as=(r&&r.sends_as)||sa; STATE.planCompanyDraft=null;
    showToast('Saved — '+mb.email_address+' writes for '+mb.sends_as.company,'success'); render();
  }).catch(function(e){ showToast((e&&e.message)||'Could not save','error'); });
};
function planFromMailbox(){
  var u=STATE.user||{};
  var list=(STATE.userEmailsCache&&STATE.userEmailsCache[u.id]||[]);
  return list.find(function(e){return e.id===STATE.planFromEmailId;})||null;
}
function planPreviewInner(){
  var t=STATE.activeTmpl||'outreach', ids=planBoxIds(t);
  var se=document.getElementById(ids[0]), be=document.getElementById(ids[1]);
  var plan=STATE.myOutreachPlan||{}, key=(t==='outreach'?'o1':t);
  var subj=se?se.value:(planWording('tmpl_'+key+'_subject')||'');
  var body=be?be.value:(planWording('tmpl_'+key+'_body')||'');
  var from=planFromMailbox();
  var vars=Object.assign({},PLAN_EXAMPLE,{'{{sender}}':from?(from.display_name||from.email_address||''):'','{{senderemail}}':from?(from.email_address||''):'',
    '{{sendercompany}}':from&&from.sends_as?(from.sends_as.company||''):''});
  function fill(escaped){
    return String(escaped||'').replace(/\{\{\s*([a-z_0-9]+)\s*\}\}/gi,function(m,name){
      var v=vars['{{'+name.toLowerCase()+'}}'];
      if(v===undefined) return '<span class="cmp-unset" title="Not a field this app fills">'+htmlEsc(m)+'</span>';
      if(v==='')        return '<span class="cmp-unset" title="'+(name.toLowerCase()==='sendercompany'?'No company said for this email ID yet — add it in the box under Sending from':'Nothing to fill this with — pick a sending email above')+'">'+htmlEsc(m)+'</span>';
      return htmlEsc(v);
    });
  }
  if(!subj&&!body) return '<div class="c-ink3 fs-13" style="padding:26px 0;text-align:center">Write the subject or message and it appears here, filled in.</div>';
  var sigRaw=from&&STATE.emailSignaturesCache?STATE.emailSignaturesCache[from.id]:undefined, sigHtml='';
  if(sigRaw){
    var n=(typeof normalizeMailboxSignature==='function')?normalizeMailboxSignature(sigRaw):sigRaw;
    sigHtml=(typeof fillSignatureHtml==='function')?fillSignatureHtml(n,(from.display_name||from.email_address||''),(from.email_address||'')):n;
  }
  return (subj?'<div class="cmp-subject">'+fill(htmlEsc(subj))+'</div>':'')+
    '<div class="cmp-body">'+fill(htmlEsc(body))+'</div>'+
    (sigHtml?'<div class="cmp-sig">'+sigHtml+'</div>':'');
}
// UNSAVED TYPING IS KEPT (owner, 8 Oct): the editor used to forget what was typed whenever the page repainted (a chip bar button, a
// signature arriving, switching the Sending email), because boxes are drawn from the SAVED text. What is typed is kept per
// (email ID or "all") and template, drawn back in on every repaint, and dropped on Save — or when it equals the saved text, so an old
// copy can never hide a later saved change.
function planBoxIds(t){ return t==='outreach'?['tmpl-o1-subj','tmpl-o1-body']:['tmpl-'+t+'-subj','tmpl-'+t+'-body']; }
function planDraftScope(){ return planScope()==='each'?(STATE.planFromEmailId||''):'all'; }
function planDraftKey(tkey){ return planDraftScope()+'|'+tkey; }
window.planDraftFor=function(tkey){ return (STATE.planDraft||{})[planDraftKey(tkey)]||null; };
window.planDraftCapture=function(){
  var t=STATE.activeTmpl||'outreach', ids=planBoxIds(t);
  var se=document.getElementById(ids[0]), be=document.getElementById(ids[1]); if(!se||!be) return;
  var k=outreachTmplApiKey(t);
  var savedS=planWording('tmpl_'+k+'_subject')||'';
  var savedB=planWording('tmpl_'+k+'_body')||'';
  STATE.planDraft=STATE.planDraft||{};
  if(se.value===savedS&&be.value===savedB) delete STATE.planDraft[planDraftKey(t)];
  else STATE.planDraft[planDraftKey(t)]={ subj:se.value, body:be.value };
};
window.planDraftClear=function(tkey){ if(STATE.planDraft) delete STATE.planDraft[planDraftKey(tkey||'outreach')]; };
window.planSetTmpl=function(key){ if(window.planDraftCapture) planDraftCapture(); STATE.activeTmpl=key; render(); };
window.planRepaintPreview=function(){
  planDraftCapture();
  var el=document.getElementById('plan-mail'); if(el) el.innerHTML=planPreviewInner();
};

// Insert a merge variable at the caret in the message box.
window.composeInsertVar=function(v){
  var ta=document.getElementById('email-body');
  if(!ta){ STATE.composeBody=(STATE.composeBody||'')+v; render(); return; }
  var s=ta.selectionStart==null?ta.value.length:ta.selectionStart;
  var e=ta.selectionEnd==null?s:ta.selectionEnd;
  ta.value=ta.value.slice(0,s)+v+ta.value.slice(e);
  STATE.composeBody=ta.value;
  ta.focus();
  var pos=s+v.length;
  try{ ta.setSelectionRange(pos,pos); }catch(err){}
  composeRepaintPreview();
};

function renderEmail(){
  var u=STATE.user;
  // BD sees pending+queued+sent; others see sent only
  var isBD=userHasAnyRole(u,'bd','bd_lead','admin','ra_lead');
  var pending=STATE.pendingEmails||[];
  // COMPOSE AND GENERATOR ARE ONE TAB NOW.
  //
  // They were two ways to write the same email, and only one of them actually
  // sent it: the old Compose tab opened a Gmail/Outlook deeplink in a new tab
  // and pushed a local "sent" record that no backend ever saw — no tracking
  // pixel, no email_tracking row, no open or reply detection. The Generator
  // sends for real from the assigned mailbox and records it, so the merge went
  // that way round. Nothing is lost: a real send from a connected mailbox still
  // lands in that mailbox's own Sent folder.
  // 'allmail' — one window onto all THREE email pipelines (Session 23). The
  // Sent tab reads only `emails` (the leads engine), which is why a client
  // email or a candidate batch never appeared in it however hard you looked.
  // Recruiters get Pending too (Session 31): their candidate emails wait in a
  // queue of their own, and "is it still queued?" had nowhere to be answered.
  // R-146 (owner, D-0082): Outreach Plan is part of Sequence now — "the outreach plan will come up when the user edits the
  // sequence". One tab, three pills: Sequences · My wording (the old Outreach Plan) · AI style. A person with no
  // sequence permission still edits their OWN wording there. 'outreachplan' stays a valid alias (old links, saved state).
  var tabs=isBD?['pending','compose','allmail','sequence']:['compose','pending','allmail'];
  if(STATE.emailTab==='sent')STATE.emailTab='allmail';
  if(STATE.emailTab==='outreachplan'){ STATE.emailTab='sequence'; STATE.seqView='wording'; }
  if(!STATE.emailTab)STATE.emailTab=isBD?'pending':'compose';

  // ── WHO THIS ORGANISATION WRITES TO ──────────────────────────────────────
  // Compose has two sides now. BD writes to CLIENTS (the outreach generator);
  // recruiters write to CANDIDATES about the jobs we hold; anyone who leads
  // both desks switches between them.
  //
  // One mode is not a choice, so the switch is only drawn when there really
  // are two. Somebody with a single side is put on it and never sees a picker
  // asking a question with one answer.
  var canClients=userHasAnyRole(u,'bd','bd_lead','admin','director','associate_director');
  var canCandidates=userHasAnyRole(u,'ra','ra_lead','recruiter','admin','director','associate_director','bd_lead')||
    // Arriving from a job's "Email about this job" (Session 31) opens this side
    // for whoever pressed it — the job page offered the button, so this side
    // must exist for them, or the click would land on the wrong screen.
    !!(STATE.candOutreach&&STATE.candOutreach.job);
  if(!canClients&&!canCandidates)canClients=true;   // never leave Compose with nothing in it
  if(STATE.composeSide!=='clients'&&STATE.composeSide!=='candidates'){
    STATE.composeSide=canClients?'clients':'candidates';
  }
  if(STATE.composeSide==='clients'&&!canClients)STATE.composeSide='candidates';
  if(STATE.composeSide==='candidates'&&!canCandidates)STATE.composeSide='clients';

  var sideSwitch='';
  if(canClients&&canCandidates){
    var sideBtn=function(id,label,note){
      var on=STATE.composeSide===id;
      return '<button type="button" onclick="setComposeSide(\''+id+'\')" title="'+htmlEsc(note)+'" style="'+
        'border:1px solid '+(on?'var(--accent)':'var(--border2)')+';'+
        'background:'+(on?'var(--accent-l)':'var(--card)')+';color:'+(on?'var(--accent)':'var(--text2)')+';'+
        'font-weight:'+(on?'600':'500')+';font-size:13px;border-radius:99px;padding:7px 16px;'+
        'cursor:pointer;font-family:inherit">'+label+'</button>';
    };
    sideSwitch='<div style="display:flex;gap:7px;margin-bottom:14px;flex-wrap:wrap">'+
      sideBtn('clients','Clients','Cold outreach to companies that are hiring')+
      sideBtn('candidates','Candidates','Ask candidates whether they want the jobs we hold')+
    '</div>';
  }

  // ── Sending paused banner — shown BEFORE the user tries to send, not just
  // as an error after the fact. Refreshed each time the Email page is viewed.
  if(STATE.mySendingPaused===undefined)loadMySendingStatus();
  var pausedBanner=STATE.mySendingPaused?
    '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--r2);padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px">'+
      '<span style="width:9px;height:9px;border-radius:50%;background:#dc2626;display:inline-block;flex-shrink:0"></span>'+
      '<div class="fs-13" style="color:#b91c1c"><strong>Sending is paused</strong> — your team lead/admin has stopped outbound email for you. New sends won\'t go out until they resume it.</div>'+
    '</div>':'';

  // ── Send progress bar ──
  var sp=STATE.sendProgress;
  var progressBar='';
  if(sp&&(sp.active||sp.done)){
    var pct=sp.total>0?Math.round((sp.sent+sp.failed+(sp.retrying||0))/sp.total*100):0;
    var barColor=sp.interrupted?'var(--amber)':(sp.done?(sp.failed>0?'var(--amber)':'var(--green)'):'var(--accent)');
    var fails=sp.failDetails||[];
    // Stat chip
    var statChip=function(val,label,color){
      return '<div style="flex:1;min-width:70px;padding:8px 12px;border-radius:8px;background:var(--bg);border:1px solid var(--border2)">'+
        '<div class="fs-20" style="font-weight:700;line-height:1;color:'+color+'">'+val+'</div>'+
        '<div class="fs-10_5 c-text3" style="text-transform:uppercase;letter-spacing:.05em;margin-top:3px">'+label+'</div>'+
      '</div>';
    };
    var waitingTotal=sp.deferred||0;
    // "Waiting" counts only the emails this run has already looked at and held back (a daily cap, a send window).
    // The ones it has not reached yet are a different number — without it the card reads like a contradiction
    // beside the Pending list (29 sent + 3 waiting of 56, while Pending shows 27). So say how many are still to go.
    var stillToGo=Math.max(0,(sp.total||0)-(sp.sent||0)-(sp.failed||0)-(sp.retrying||0)-waitingTotal);
    var notSent=Math.max(0,(sp.total||0)-(sp.sent||0)-(sp.failed||0)-(sp.retrying||0));
    var chips='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'+
      statChip(sp.sent,'Sent','var(--green)')+
      statChip(sp.failed,'Failed',sp.failed>0?'var(--red)':'var(--text2)')+
      (sp.retrying?statChip(sp.retrying,'Will retry','var(--amber)'):'')+
      (waitingTotal&&!sp.interrupted?statChip(waitingTotal,'Waiting','var(--amber)'):'')+
      (sp.interrupted?(notSent?statChip(notSent,'Still pending','var(--amber)'):''):(sp.active&&stillToGo?statChip(stillToGo,'Still to go','var(--text2)'):''))+
      statChip(sp.total,'Total','var(--text)')+
    '</div>';
    // Failed rows — each links back to its lead
    var failRows=fails.map(function(f){
      var cur=f.job_id?'cursor:pointer;':'';
      var click=f.job_id?(' onclick="closeAndOpenLead(\''+f.job_id+'\')" title="Open this lead"'):'';
      return '<div class="fail-row"'+click+' style="'+cur+'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border2)">'+
        '<div style="min-width:0;flex:1">'+
          '<div class="fs-12_5 c-text" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(f.to||'(no address)')+'</div>'+
          '<div class="fs-11_5 c-text3" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(f.error||'Send failed')+'</div>'+
        '</div>'+
        (f.job_id?'<div class="fs-11_5 c-accent" style="white-space:nowrap;font-weight:600">View lead →</div>':'<div class="fs-11 c-text3" style="white-space:nowrap">no lead link</div>')+
      '</div>';
    }).join('');
    var failPanel=fails.length?
      '<div style="margin-top:12px;border:1px solid var(--border2);border-radius:8px;overflow:hidden">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--amber-l)">'+
          '<div class="fs-12 c-amber" style="font-weight:700">Failed deliveries ('+fails.length+')</div>'+
          '<div class="fs-11 c-amber">click a row to open the lead</div>'+
        '</div>'+
        '<div style="max-height:240px;overflow-y:auto">'+failRows+'</div>'+
      '</div>':'';
    var dismissBtn=sp.done?'<button onclick="dismissSendProgress()" title="Dismiss" class="c-text3 fs-18" style="background:transparent;border:0;line-height:1;cursor:pointer;padding:0 2px">×</button>':'';
    // A run that finished cleanly is ONE quiet line, not a panel (the owner, 6 Oct: "once it is
    // done this information is on the dashboard anyway … just a small summary"). The full
    // panel stays for a send in flight and for anything that needs a person (failures, retries).
    var tidy=!!(sp.done&&!sp.active&&!sp.failed&&!sp.retrying&&!sp.interrupted);
    var doneAt=sp.completedAt?new Date(sp.completedAt):null;
    var stale=tidy&&doneAt&&!isNaN(doneAt.getTime())&&(Date.now()-doneAt.getTime())>3600000;   // an old run is history, not news
    if(tidy&&!stale){
      progressBar='<div class="sp-line"><span class="sp-line-t">Send finished'+(doneAt&&!isNaN(doneAt.getTime())?' at '+htmlEsc(doneAt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})):'')+
        ' — '+sp.sent+' sent'+(waitingTotal?', '+waitingTotal+' waiting':'')+'</span>'+
        (sp.deferredNote?'<span class="sp-line-n"> · '+htmlEsc(sp.deferredNote)+'</span>':'')+
        '<button onclick="dismissSendProgress()" title="Dismiss" class="sp-line-x" aria-label="Dismiss">×</button></div>';
    } else if(!stale)
    progressBar='<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px 18px;margin-bottom:16px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
        '<div class="fs-14" style="font-weight:700">'+(sp.interrupted?'Sending stopped early':(sp.done?(sp.failed>0?'Send complete — '+sp.failed+' need attention':'Send complete'):'Sending emails…'))+'</div>'+
        '<div style="display:flex;align-items:center;gap:10px"><div class="fs-12" style="font-weight:700;color:'+barColor+'">'+pct+'%</div>'+dismissBtn+'</div>'+
      '</div>'+
      chips+
      '<div style="background:var(--border);border-radius:99px;height:8px;overflow:hidden;margin-bottom:8px">'+
        '<div style="height:100%;border-radius:99px;background:'+barColor+';width:'+pct+'%;transition:width .3s ease"></div>'+
      '</div>'+
      '<div class="fs-12 c-text3">'+(sp.active&&sp.current?'Currently sending to: '+htmlEsc(sp.current):(sp.done?(sp.interrupted?'Stopped at ':'Completed at ')+(sp.completedAt?new Date(sp.completedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):''):''))+'</div>'+
      failPanel+
      (sp.interrupted?'<div class="fs-12_5 c-text2" style="margin-top:8px">The server restarted while this send was running, so it stopped after '+sp.sent+' of '+sp.total+'. Nothing was lost: the rest are still in Pending. Press <strong>Send all pending</strong> to carry on.</div>':'')+
      (sp.deferredNote?'<div class="fs-12" style="margin-top:8px;color:#b45309">'+htmlEsc(sp.deferredNote)+'</div>':'')+
    '</div>';
  }

  // Tabs on the shared kit. The Pending count is the number of emails actually
  // waiting; the "N now / M waiting" split stays in the sub-line under the tab
  // rather than being crammed into the label.
  var TAB_LABELS={pending:'Pending',compose:'Compose',allmail:'All email',sequence:'Sequence'};
  var ps=STATE.pendingSummary;
  var tabBar=UI.tabs(tabs.map(function(t){
    var n=null;
    if(t==='pending')n=((isBD&&((ps&&ps.total_pending)||pending.length))||0)+
      (window.candidatePendingCount?candidatePendingCount():0)||null;
    return { id:t, label:TAB_LABELS[t]||t, n:n, onclick:"setEmailTab('"+t+"')" };
  }), STATE.emailTab,
    (ps&&ps.total_pending&&STATE.emailTab==='pending'
      ? '<span class="fs-12 c-ink3" title="'+escAttr('Send window: '+(ps.send_window_label||'8:00 – 16:00 lead local time')+(ps.held_company?'. Held until tomorrow: the company already got its '+(ps.company_daily_cap||2)+' first email'+((ps.company_daily_cap||2)===1?'':'s')+' today (Admin → System Settings).':'')+(ps.waiting_retry?'. Waiting to retry: a send failed and PACE tries again by itself — each row says when.':''))+'">'+htmlEsc(pendingSplitLine(ps))+'</span>'+
        // The panel this replaces carried the only "try the waiting ones now" button; it lives on in one quiet link.
        (ps.waiting_window>0&&!userHasRole(u,'ra_lead')?' <button class="fs-12 c-accent" style="background:none;border:0;padding:0;cursor:pointer;text-decoration:underline" onclick="retryPendingWindowNow()">Try the waiting ones now</button>':'')
      : ''));

  // ── PENDING TAB ──
  var pendingHtml='';
  if(STATE.emailTab==='pending'&&isBD){
    var scheduleBanner='';   // R-141: the schedule panel is gone — the one-line summary above the list says the same
    var isRaLead=userHasRole(u,'ra_lead');

    // ── RA LEAD: BD user picker ──────────────────────────────────────
    // C-0026 #2 / D-0034: GET /emails now scopes to the viewer's own chain, so
    // grouping it client-side showed every BD at zero. Counts come from
    // GET /emails/sender-summary instead — numbers only, never a message
    // (rampart.md D4 / D-0036).
    if(isRaLead && !STATE.raLeadSelectedBD){
      var bdGroups={};
      ((STATE.senderSummary&&STATE.senderSummary.senders)||[]).forEach(function(s){
        bdGroups[s.id]={id:s.id,name:s.name||'Unknown',pending:s.pending||0,sent:s.sent||0,failed:s.failed||0};
      });
      // Always show all BD/BD_Lead users even if they have no emails yet
      (STATE.users||[]).filter(function(usr){return userHasRole(usr,'bd')||userHasRole(usr,'bd_lead');}).forEach(function(usr){
        if(!bdGroups[usr.id])bdGroups[usr.id]={id:usr.id,name:usr.name,pending:0,sent:0,failed:0};
        else if(!bdGroups[usr.id].name)bdGroups[usr.id].name=usr.name; // fill name if missing
      });
      var bdCards=Object.values(bdGroups).sort(function(a,b){return (b.pending+b.sent+b.failed)-(a.pending+a.sent+a.failed);}).map(function(bd){
        var initials=bd.name.split(' ').map(function(w){return w[0]||'';}).slice(0,2).join('').toUpperCase();
        var total=bd.pending+bd.sent+bd.failed;
        var statusLine=total===0?'<span class="c-text3">No emails yet</span>':(
          (bd.pending?'<span class="c-amber" style="font-weight:600">'+bd.pending+' pending</span>':'')+
          (bd.pending&&(bd.sent||bd.failed)?' · ':'')+
          (bd.sent?'<span class="c-green" style="font-weight:600">'+bd.sent+' sent</span>':'')+
          (bd.sent&&bd.failed?' · ':'')+
          (bd.failed?'<span style="color:var(--red,#dc2626);font-weight:600">'+bd.failed+' failed (all runs)</span>':'')
        );
        return '<div onclick="STATE.raLeadSelectedBD=\''+bd.id+'\';STATE.pendingEmailPage=0;loadPendingSummary();render()" style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s" onmouseover="this.style.background=\'var(--accent-l)\'" onmouseout="this.style.background=\'\'" >'+
          '<div class="fs-13" style="width:38px;height:38px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">'+htmlEsc(initials)+'</div>'+
          '<div style="flex:1">'+
            '<div class="fs-13_5" style="font-weight:600">'+htmlEsc(bd.name)+'</div>'+
            '<div class="fs-12" style="margin-top:2px">'+statusLine+'</div>'+
          '</div>'+
          '<div class="c-text3 fs-16">→</div>'+
        '</div>';
      }).join('');
      if(!bdCards)bdCards='<div class="c-text3" style="padding:40px;text-align:center">No BD users found.</div>';
      pendingHtml=scheduleBanner+'<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+
        '<div class="fs-12 c-text3" style="padding:12px 18px;border-bottom:1px solid var(--border);font-weight:600;text-transform:uppercase;letter-spacing:.05em">BD Managers — click to view emails</div>'+
        bdCards+
      '</div>';

    // ── RA LEAD: viewing a specific BD's emails ──────────────────────
    } else if(isRaLead&&STATE.raLeadSelectedBD){
      // D-0036 confirmed: the drill-down is COUNTS, never another person's
      // messages — no row, no subject, no body. pending-summary(manager_id=)
      // still gives the timezone breakdown; sender-summary gives the totals.
      var bdId=STATE.raLeadSelectedBD;
      var bdName=(function(){var bd=(STATE.users||[]).find(function(u){return u.id===bdId;});return bd?bd.name:'BD Manager';})();
      var bdSum=((STATE.senderSummary&&STATE.senderSummary.senders)||[]).find(function(s){return s.id===bdId;})||{pending:0,sent:0,failed:0};
      var backBtn='<div style="margin-bottom:14px"><button onclick="STATE.raLeadSelectedBD=null;render()" class="fs-13 c-text2" style="background:none;border:1px solid var(--border2);padding:6px 14px;border-radius:7px;cursor:pointer">← Back to all BD Managers</button><span class="fs-14" style="margin-left:12px;font-weight:600">'+htmlEsc(bdName)+'</span></div>';
      var ps=STATE.pendingSummary;
      var tzRows=((ps&&ps.by_timezone)||[]).map(function(t){
        return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>'+htmlEsc(t.timezone)+'</span><span>'+t.ready_now+' ready now · '+t.waiting_window+' waiting</span></div>';
      }).join('');
      pendingHtml='<div>'+scheduleBanner+backBtn+
        '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:18px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;text-align:center;margin-bottom:14px">'+
          '<div><div class="fs-24 c-amber" style="font-weight:700">'+(bdSum.pending||0)+'</div><div class="fs-11 c-text3" style="margin-top:2px">PENDING</div></div>'+
          '<div><div class="fs-24 c-green" style="font-weight:700">'+(bdSum.sent||0)+'</div><div class="fs-11 c-text3" style="margin-top:2px">SENT</div></div>'+
          '<div><div class="fs-24" style="font-weight:700;color:var(--red,#dc2626)">'+(bdSum.failed||0)+'</div><div class="fs-11 c-text3" style="margin-top:2px">FAILED (all runs)</div></div>'+
        '</div>'+
        (tzRows?'<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px 18px"><div class="fs-11 c-text3" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Pending, by lead timezone</div>'+tzRows+'</div>':
          '<div class="c-text3 fs-13" style="padding:24px;text-align:center">Only this manager\'s counts are shown here — not the messages themselves.</div>')+
      '</div>';

    // ── everyone else: bd, bd_lead, admin ─────────────────────────────
    } else {
      // C-0026 #2 (D-0034): GET /emails?status=pending now includes a
      // bd_lead's team's rows too (the reporting chain), each carrying
      // `is_mine`. "Send all" acts only on the caller's own queue
      // (`/emails/queue-all` is server-scoped to `sent_by=req.user.id`
      // regardless of what is shown), so the count and the confirm modal
      // must say so rather than promise a number they will not send.
      var minePending=pending.filter(function(e){return e.is_mine!==false;});
      var totalRecipients=pending.length;
      var mineCount=minePending.length;
      var _pPg=Math.min(STATE.pendingEmailPage||0,Math.max(0,Math.ceil(totalRecipients/20)-1));
      var _pTp=Math.max(1,Math.ceil(totalRecipients/20));
      var pendingPaged=pending.slice(_pPg*20,(_pPg+1)*20);
      var sendBlocked=!mineCount||STATE.mySendingPaused;
      var sendAllBtn='<button class="btn btn-primary" onclick="openSendAllConfirm()"'+(sendBlocked?' disabled':'')+(STATE.mySendingPaused?' title="Sending is paused"':'')+'>Send all pending ('+mineCount+')</button>';

      var pendingRows=pendingPaged.map(function(e){
        var isMine=e.is_mine!==false;
        var isSelected=STATE.previewPendingId===e.id;
        var jname=(e.job&&e.job.position?e.job.position:'')+(e.job&&e.job.company?(' · '+e.job.company.name):'');
        var fu=e.followup_type;
        var rowBg=isSelected?'var(--accent-l)':fu==='fu2'?'#fff8f0':fu==='fu1'?'#fffdf0':'';
        var fuBadge=fu==='fu1'?'<span class="fs-10" style="padding:2px 7px;background:#fef9c3;color:#92400e;border-radius:6px;font-weight:700;margin-left:6px">FU1</span>':fu==='fu2'?'<span class="fs-10" style="padding:2px 7px;background:#ffedd5;color:#9a3412;border-radius:6px;font-weight:700;margin-left:6px">FU2</span>':'';
        // A teammate's row (bd_lead's team view): named, never blended into
        // the caller's own — the same reason a rewind entry always says who.
        var ownerBadge=isMine?'':'<span class="fs-10 c-text3" style="padding:2px 7px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;font-weight:600;margin-left:6px">'+htmlEsc((e.sender&&e.sender.name)||'Teammate')+'</span>';
        var leadTz=(e.job&&e.job.timezone)||'EST';
        var tzRow2=(STATE.pendingSummary&&STATE.pendingSummary.by_timezone||[]).find(function(t){return t.timezone===leadTz;});
        var aiBadge=e.ai_written?'<span class="ai-chip">AI-written</span>':e.ai_will_write?'<span class="ai-chip" title="The template below is the fallback. AI writes this lead\'s own email just before it is sent.">AI writes at send</span>':'';
        // Held by the per-company daily limit (D-0046): it is not "Ready now"
        // and says so, rather than sitting in Pending with no reason.
        var heldIds=(STATE.pendingSummary&&STATE.pendingSummary.held_ids)||[];
        var capN=(STATE.pendingSummary&&STATE.pendingSummary.company_daily_cap)||2;
        var heldChip=heldIds.indexOf(e.id)>=0?'<span class="retry-chip held-chip" title="'+htmlEsc(capN+' '+(capN===1?'person':'people')+' at this company already got a first email today. This one goes tomorrow.')+'">Held · goes tomorrow</span>':'';
        var winBadge=aiBadge+((e.attempt_count>0&&e.retry_note)?'<span class="retry-chip">'+htmlEsc(e.retry_note)+'</span>':heldChip?heldChip:(tzRow2&&tzRow2.waiting_window>0&&!(tzRow2.ready_now>0))?'<span class="fs-10" style="padding:2px 7px;background:#fef3c7;color:#92400e;border-radius:6px;font-weight:600;margin-left:6px">Waiting · '+htmlEsc(leadTz)+'</span>':'<span class="fs-10 c-green" style="padding:2px 7px;background:var(--green-l);border-radius:6px;font-weight:600;margin-left:6px">Ready now</span>');
        return '<tr style="border-bottom:1px solid var(--border2);cursor:pointer;background:'+rowBg+'" onclick="previewPendingEmail(\''+e.id+'\')">'+'<td class="fs-13" style="padding:10px 12px"><div style="font-weight:500">'+htmlEsc(e.to_email)+fuBadge+ownerBadge+winBadge+'</div>'+'<div class="fs-11 c-text3">'+htmlEsc((e.contact&&e.contact.first_name?e.contact.first_name+' '+(e.contact.last_name||''):''))+'</div></td>'+'<td style="padding:10px 12px;font-size:12px;color:var(--text2)">'+htmlEsc(jname)+'</td>'+'<td class="fs-12" style="padding:10px 12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(e.subject||'')+'</td>'+'<td style="padding:10px 12px;white-space:nowrap">'+(function(){var sc=e.status==='sent'?'background:var(--green-l);color:var(--green)':e.status==='failed'?'background:#fee2e2;color:#dc2626':'background:var(--amber-l);color:var(--amber)';return '<span class="fs-11" style="padding:2px 8px;'+sc+';border-radius:8px;font-weight:600">'+htmlEsc(e.status)+'</span>';})() +'</td>'+'</tr>';
      }).join('');
      if(!pendingRows)pendingRows='<tr><td colspan="4" style="padding:40px;text-align:center;color:var(--text3)">No pending emails yet.</td></tr>';

    // Preview panel — Edit is the sender's own act (PATCH /emails/:id is
    // sender-scoped server-side), so it is offered only on the caller's own row.
    var previewPanel='';
    if(STATE.previewPendingId){
      var pe=pending.find(function(e){return e.id===STATE.previewPendingId;});
      if(pe){
        var peMine=pe.is_mine!==false;
        previewPanel='<div style="width:380px;flex-shrink:0;background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+
          '<div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'+
            '<div class="fs-13" style="font-weight:600">Email Preview'+(peMine?'':' — '+htmlEsc((pe.sender&&pe.sender.name)||'Teammate'))+'</div>'+
            '<button class="btn-icon" onclick="STATE.previewPendingId=null;render()">'+ico('x',13)+'</button>'+
          '</div>'+
          '<div class="fs-12 c-text2" style="padding:12px 14px;border-bottom:1px solid var(--border)">'+
            '<div><strong>To:</strong> '+htmlEsc(pe.to_email)+'</div>'+
            '<div class="mt1"><strong>Subject:</strong> '+htmlEsc(pe.subject||'')+'</div>'+
          '</div>'+
          '<div class="fs-13" style="padding:14px;line-height:1.7;white-space:pre-wrap;max-height:360px;overflow-y:auto">'+htmlEsc(pe.body||'')+'</div>'+
          (peMine?'<div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">'+
            '<button class="btn btn-outline btn-sm" onclick="openEditPendingEmail(\''+pe.id+'\')">✒ Edit email</button>'+
          '</div>':'')+
          '</div>'+
        '</div>';
      }
    }

    // ── DIDN'T SEND ── failed emails used to vanish from this page the moment
    // the run card expired. They now stay here, with the reason, until they
    // are retried or deleted. Calm by default (D-0019): a stripe and one chip.
    // A bd_lead's team rows are visible here too now (D-0034) — Retry stays
    // the sender's own act (POST /emails/:id/retry answers 404 for anyone
    // else's row), so the button is offered only on `is_mine` rows.
    var failedList=STATE.failedEmails||[];
    var retryable=failedList.filter(function(e){return e.can_retry&&e.is_mine!==false;});
    var mineFailed=failedList.filter(function(e){return e.is_mine!==false;});
    var failedPanel=failedList.length?(
      '<div class="failed-panel">'+
        '<div class="failed-head">'+
          '<div><div class="failed-title">Didn\'t send ('+failedList.length+')</div>'+
          '<div class="failed-sub">Temporary problems retry on their own. These need a person.</div></div>'+
          '<div class="failed-acts">'+
            (retryable.length?'<button class="btn btn-outline btn-sm" onclick="retryAllFailedEmails('+htmlEsc(JSON.stringify(retryable.map(function(e){return e.id;})))+')">Retry all ('+retryable.length+')</button>':'')+
            (mineFailed.length?'<button class="btn btn-outline btn-sm" onclick="closeFailedEmails('+htmlEsc(JSON.stringify(mineFailed.map(function(e){return e.id;})))+')">Close all</button>':'')+
          '</div>'+
        '</div>'+
        failedList.slice(0,50).map(function(e){
          var isMine=e.is_mine!==false;
          var jn=(e.job&&e.job.position?e.job.position:'')+(e.job&&e.job.company?(' · '+e.job.company.name):'');
          var ownerNote=isMine?'':' <span class="failed-job">'+htmlEsc((e.sender&&e.sender.name)||'Teammate')+'</span>';
          return '<div class="failed-row">'+
            '<div class="failed-main">'+
              '<div class="failed-to">'+htmlEsc(e.to_email||'(no address)')+(jn?' <span class="failed-job">'+htmlEsc(jn)+'</span>':'')+ownerNote+'</div>'+
              '<div class="failed-why">'+htmlEsc(e.fail_reason||'Send failed — no reason was recorded (failed before retries existed).')+'</div>'+
              (e.retry_note?'<div class="failed-note">'+htmlEsc(e.retry_note)+'</div>':'')+
            '</div>'+
            (isMine?'<div class="failed-acts">'+
              (e.can_retry?'<button class="btn btn-outline btn-sm" onclick="retryFailedEmail(\''+e.id+'\',event)">Retry</button>':'')+
              '<button class="btn btn-outline btn-sm" title="Take this off the list. Nothing is sent." onclick="closeFailedEmails([\''+e.id+'\'])">Close</button>'+
            '</div>':'')+
          '</div>';
        }).join('')+
        (failedList.length>50?'<div class="failed-sub" style="padding:8px 14px">Showing 50 of '+failedList.length+'.</div>':'')+
      '</div>'):'';

    pendingHtml='<div>'+scheduleBanner+
      failedPanel+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
        // "pending", not "ready": what is ready NOW is the split under the tab.
        '<div class="fs-13 c-text2">'+totalRecipients+' pending email'+(totalRecipients!==1?'s':'')+(totalRecipients!==mineCount?' · '+mineCount+' yours':'')+' · page '+(_pPg+1)+' of '+_pTp+'</div>'+
        sendAllBtn+
      '</div>'+
      '<div style="display:flex;gap:14px;align-items:flex-start">'+
        '<div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+
          '<table class="fs-13" style="width:100%;border-collapse:collapse">'+
            '<thead class="c-text3 fs-11" style="background:var(--bg);text-transform:uppercase;letter-spacing:.5px">'+
              '<tr><th style="padding:10px 12px;text-align:left">Recipient</th><th style="padding:10px 12px;text-align:left">Job</th><th style="padding:10px 12px;text-align:left">Subject</th><th style="padding:10px 12px;text-align:left">Status</th></tr>'+
            '</thead>'+
            '<tbody>'+pendingRows+'</tbody>'+
          '</table>'+
          (_pTp>1?'<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--border)">'+
            '<div class="fs-12 c-text3">'+totalRecipients+' total · page '+(_pPg+1)+' of '+_pTp+'</div>'+
            '<div style="display:flex;gap:5px">'+
              '<button onclick="STATE.pendingEmailPage=Math.max(0,'+_pPg+'-1);render()" style="padding:5px 12px;border:1px solid var(--border2);border-radius:7px;background:var(--card);font-size:12px;cursor:pointer" '+(_pPg===0?'disabled':'')+'>← Prev</button>'+
              '<span class="fs-12" style="padding:5px 10px;font-weight:600">'+(_pPg+1)+' / '+_pTp+'</span>'+
              '<button onclick="STATE.pendingEmailPage=Math.min('+(_pTp-1)+','+_pPg+'+1);render()" style="padding:5px 12px;border:1px solid var(--border2);border-radius:7px;background:var(--card);font-size:12px;cursor:pointer" '+(_pPg>=_pTp-1?'disabled':'')+'>Next →</button>'+
            '</div>'+
          '</div>':'')  +
        '</div>'+
        previewPanel+
      '</div>'+
    '</div>';
    } // end else (BD table view)
  }

  // (There is no separate Sent tab any more — "All email" holds what was sent AND what came back, 6 Oct.)

  // ── OUTREACH PLAN TAB ──
  if(!STATE.activeTmpl)STATE.activeTmpl='outreach';
  var myPlan=STATE.myOutreachPlan||{};
  // HOW MANY FOLLOW-UPS, AND WHEN EACH GOES OUT, IS THE PERSON'S CHOICE (owner, 8 Oct, D-0113): none to five; two (day 3, day 7) unless they say
  // otherwise. A new person starts with BLANK boxes — they write their own wording; nothing is written for them.
  var fuCount=(function(){ var v=myPlan['fu_count']; if(v===undefined||v===null||String(v).trim()==='')return 2; var k=Number(v); return (k===Math.floor(k)&&k>=0&&k<=5)?k:2; })();
  var FU_DEFAULT_DAY=[3,7,14,21,28], FU_COLORS=['#ca8a04','#ea580c','#c2410c','#9a3412','#7c2d12'];
  function fuDay(n){ var d=parseInt(myPlan['fu'+n+'_day'],10); return (d>=1&&d<=90)?d:FU_DEFAULT_DAY[n-1]; }
  function dayOpts(selected,minDay){
    var opts='';
    for(var d=minDay+1;d<=Math.max(60,selected);d++){
      opts+='<option value="'+d+'"'+(d===selected?' selected':'')+'>Day '+d+'</option>';
    }
    return opts;
  }
  var tmplDefs=[
    {key:'outreach',label:'Outreach 1',sublabel:'Sent immediately on assignment',color:'var(--accent)',subjVal:planWording('tmpl_o1_subject')||'',bodyVal:planWording('tmpl_o1_body')||'',subjId:'tmpl-o1-subj',bodyId:'tmpl-o1-body'}
  ];
  for(var fn=1;fn<=fuCount;fn++){
    tmplDefs.push({key:'fu'+fn,n:fn,label:'Follow-up '+fn,sublabel:'Day '+fuDay(fn)+' after the first email',color:FU_COLORS[fn-1],
      subjVal:planWording('tmpl_fu'+fn+'_subject')||'',bodyVal:planWording('tmpl_fu'+fn+'_body')||'',subjId:'tmpl-fu'+fn+'-subj',bodyId:'tmpl-fu'+fn+'-body'});
  }
  tmplDefs.forEach(function(t){ var d=planDraftFor(t.key); if(d){ t.subjVal=d.subj; t.bodyVal=d.body; } });   // unsaved typing wins until Save
  var activeTmpl=tmplDefs.find(function(t){return t.key===STATE.activeTmpl;})||tmplDefs[0];
  STATE.activeTmpl=activeTmpl.key;                     // fewer follow-ups than the tab that was open: back to the first email
  var planEmails=(STATE.userEmailsCache&&STATE.userEmailsCache[u.id]||[]).filter(function(e){return e.is_active;});
  var planFromId=STATE.planFromEmailId||(planEmails.find(function(e){return e.is_primary;})||planEmails[0]||{}).id;
  if(planFromId&&!STATE.planFromEmailId)STATE.planFromEmailId=planFromId;
  if(planFromId&&STATE.sigEmailId!==planFromId)STATE.sigEmailId=planFromId;
  var styleBtns=Object.keys(OUTREACH_STYLE_PRESETS).map(function(pk){
    var p=OUTREACH_STYLE_PRESETS[pk];
    var on=STATE.outreachStylePreset===pk;
    return '<button type="button" onclick="applyOutreachStylePreset(\''+pk+'\')" style="text-align:left;padding:10px 14px;border-radius:10px;cursor:pointer;border:2px solid '+(on?'var(--accent)':'var(--border)')+';background:'+(on?'var(--accent-l)':'var(--card)')+';min-width:140px;flex:1">'+
      '<div class="fs-13" style="font-weight:700;color:'+(on?'var(--accent)':'var(--text)')+'">'+htmlEsc(p.label)+'</div>'+
      '<div class="fs-11 c-text3" style="margin-top:3px">'+htmlEsc(p.hint)+'</div></button>';
  }).join('');
  var tmplTabBtns=tmplDefs.map(function(t){
    var isActive=STATE.activeTmpl===t.key;
    return '<button onclick="planSetTmpl(\''+t.key+'\')" style="padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:2px solid '+(isActive?t.color:'var(--border)')+';background:'+(isActive?t.color:'var(--card)')+';color:'+(isActive?'#fff':'var(--text2)')+';transition:all .15s">'+t.label+'</button>';
  }).join('');
  var daySettingsHtml='';
  if(activeTmpl.n){
    var fN=activeTmpl.n, prevDay=fN>1?fuDay(fN-1):0, thrKey='fu'+fN+'_thread', thr=myPlan[thrKey]==='new'?'new':'same';
    var notWritten=!planWording('tmpl_fu'+fN+'_subject')&&!planWording('tmpl_fu'+fN+'_body')&&!planDraftFor(activeTmpl.key);
    daySettingsHtml='<div class="fgrp" style="margin-bottom:14px"><label class="flbl">Send Follow-up '+fN+' on</label>'+
      '<select class="sel" style="max-width:160px" id="fu'+fN+'-day-sel" onchange="saveOutreachDay(\'fu'+fN+'_day\',this.value)">'+
        '<option value="">— select day —</option>'+dayOpts(fuDay(fN),prevDay)+
      '</select>'+
      '<div class="fs-11 c-text3" style="margin-top:4px">'+(fN>1?'Days after the first email was sent — must be after Follow-up '+(fN-1)+' (Day '+prevDay+')':'Days after the first email was sent')+'</div>'+
    '</div>'+
    // Same thread or a new email — per follow-up (owner, 8 Oct). Default 'same' = how follow-ups have always gone out.
    '<div class="fgrp" style="margin-bottom:14px"><label class="flbl">How Follow-up '+fN+' is sent</label>'+
      '<label class="fd-use fd-block"><input type="radio" name="futhread" '+(thr==='same'?'checked':'')+' onclick="setFollowupThread(\''+thrKey+'\',\'same\')"> <strong>In the same email thread</strong><span class="fd-hint"> — a reply under your first email, so it reads as one conversation</span></label>'+
      '<label class="fd-use fd-block"><input type="radio" name="futhread" '+(thr==='new'?'checked':'')+' onclick="setFollowupThread(\''+thrKey+'\',\'new\')"> <strong>As a new email</strong><span class="fd-hint"> — its own subject line, in a thread of its own (write a subject that stands alone, not “Re: …”)</span></label>'+
    '</div>'+
    (notWritten?('<div class="fs-12 c-amber" style="margin-bottom:12px">You have not written this follow-up yet.'+(fN<=2?' Until you do, PACE sends its own standard follow-up wording.':' Until you do, it is skipped — nothing goes out for it.')+'</div>'):'');
  }
  var canEditTemplates=userHasAnyRole(u,'bd','bd_lead','admin');
  var planFrom=planFromMailbox();
  var planPrev='<div class="cmp-prev">'+
    '<div class="cmp-prev-h">'+UI.ic('mailopen')+'<b>How '+htmlEsc(activeTmpl.label)+' reads</b>'+
      '<span class="fs-11_5 c-ink3" style="margin-left:auto">example person</span></div>'+
    '<div class="cmp-fld"><label>From</label><div class="cmp-static">'+(planFrom?htmlEsc((planFrom.display_name?planFrom.display_name+' <':'')+planFrom.email_address+(planFrom.display_name?'>':'')):'<span class="c-amber">Pick a sending email</span>')+'</div></div>'+
    '<div class="cmp-fld"><label>To</label><div class="cmp-static">Sam Rivera &lt;sam@acmebuilders.example&gt;</div></div>'+
    '<div class="cmp-mail" id="plan-mail">'+planPreviewInner()+'</div>'+
    '<div class="cmp-foot">'+UI.ic('shield')+'<span>Filled in with an example person. Each lead gets its own details when it is sent; your signature is added from the mailbox above.</span></div>'+
  '</div>';
  var tmplHtml=canEditTemplates?
    '<div class="cmp cmp-plan"><div class="cmp-edit">'+
      '<div class="fs-13 c-text2" style="padding:12px 14px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:16px">'+
        '<strong>How this works:</strong> Pick your sending email → choose a message style → edit Outreach &amp; follow-ups → Save. Assigned leads use these templates automatically.'+
      '</div>'+
      renderSendingEmailCard(u.id,planEmails,planFromId,'selectPlanFromEmail')+
      renderCompanyCard(planEmails,planFromId)+
      renderWordingScopeCard(planEmails,planFromId)+
      '<div class="card cp mb3">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'+
          '<div class="fw6 fs-13">Message style</div>'+
          '<div class="fs-12" style="display:flex;align-items:center;gap:8px">'+
            '<span class="c-text3">Template mode:</span>'+
            '<div style="display:flex;border:1px solid var(--border);border-radius:20px;overflow:hidden;background:var(--card)">'+
              '<button type="button" onclick="setTemplateModeSpecific()" class="fs-12" style="padding:4px 14px;font-weight:600;cursor:pointer;border:0;border-radius:20px 0 0 20px;background:'+(STATE.randomTemplateMode?'transparent':'var(--accent)')+';color:'+(STATE.randomTemplateMode?'var(--text3)':'#fff')+';transition:all .15s">Specific</button>'+
              '<button type="button" onclick="setTemplateModeRandom()" class="fs-12" style="padding:4px 14px;font-weight:600;cursor:pointer;border:0;border-radius:0 20px 20px 0;background:'+(STATE.randomTemplateMode?'var(--accent)':'transparent')+';color:'+(STATE.randomTemplateMode?'#fff':'var(--text3)')+';transition:all .15s">Random</button>'+
            '</div>'+
          '</div>'+
        '</div>'+
        (STATE.randomTemplateMode?
          '<div class="fs-11_5 c-text3" style="margin-bottom:10px">Bulk outreach rotates through all '+Object.keys(OUTREACH_STYLE_PRESETS).length+' matched styles (outreach + follow-ups) — each used once before any repeat. Follow-up 1 and 2 use the same style as the original outreach for each contact.</div>'+
          '<div class="fs-12_5 c-accent" style="padding:10px 14px;background:var(--accent-l);border-radius:var(--r2);font-weight:600;margin-bottom:10px">'+
            '&#8652; Random mode — outreach, FU1, and FU2 rotate together per contact'+
          '</div>':
          '<div class="fs-11_5 c-text3" style="margin-bottom:10px">Start from a proven template — you can edit any field after applying.</div>'+
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+styleBtns+'</div>'
        )+
        '<button class="btn btn-primary" onclick="saveTemplateModePreference()" style="font-size:12px;padding:6px 18px">Save preference</button>'+
      '</div>'+
      '<div class="fgrp" style="margin-bottom:14px"><label class="flbl">How many follow-ups do you want?</label>'+
        '<select class="sel" style="max-width:220px" id="fu-count-sel" onchange="setFollowupCount(this.value)">'+[0,1,2,3,4,5].map(function(k){return '<option value="'+k+'"'+(k===fuCount?' selected':'')+'>'+(k===0?'None — only the first email':k+(k===1?' follow-up':' follow-ups'))+'</option>';}).join('')+'</select>'+
        '<div class="fs-11 c-text3" style="margin-top:4px">You decide. After the first email PACE sends each follow-up on its day, and stops when the person replies.</div></div>'+
      '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">'+tmplTabBtns+'</div>'+
      '<div class="card cp" style="border-top:3px solid '+activeTmpl.color+'">'+
        '<div style="margin-bottom:14px">'+
          '<div class="fs-14 c-text" style="font-weight:700">'+activeTmpl.label+(planScope()==='each'&&planFrom?' <span class="c-text3" style="font-weight:400">— for '+htmlEsc(planFrom.email_address)+'</span>':'')+'</div>'+
          '<div class="fs-12 c-text3" style="margin-top:2px">'+activeTmpl.sublabel+'</div>'+
        '</div>'+
        daySettingsHtml+
        '<div class="fgrp"><label class="flbl">Subject</label><input class="inp" id="'+activeTmpl.subjId+'" value="'+htmlEsc(activeTmpl.subjVal)+'" oninput="planRepaintPreview()" onfocus="setVarInsertTarget(\'subject\')"/></div>'+
        '<div class="fgrp"><label class="flbl">Body</label><textarea class="txta w100" style="min-height:200px" id="'+activeTmpl.bodyId+'" oninput="planRepaintPreview()" onfocus="setVarInsertTarget(\'body\')">'+htmlEsc(activeTmpl.bodyVal)+'</textarea></div>'+
        renderVarChipBar(activeTmpl.subjId,activeTmpl.bodyId)+
        '<button class="btn btn-primary mt3" onclick="saveOutreachTemplate(\''+activeTmpl.key+'\',\''+activeTmpl.subjId+'\',\''+activeTmpl.bodyId+'\')">Save '+activeTmpl.label+'</button>'+
        '<button class="btn btn-outline mt3" style="margin-left:8px" title="Looks for spam-trigger words, too many links, ALL-CAPS and other things that send mail to junk. Nothing is saved or sent." onclick="seqSpamCheck(\''+activeTmpl.key+'\',\''+activeTmpl.subjId+'\',\''+activeTmpl.bodyId+'\')">Check for spam triggers</button>'+
        '<div id="seq-spam">'+seqSpamHtml(activeTmpl.key)+'</div>'+
      '</div>'+

      // ── SIGNATURE EDITOR (per sending email ID) ───────────────
      (function(){
        var myEmails=(STATE.userEmailsCache&&STATE.userEmailsCache[u.id]||[]).filter(function(e){return e.is_active;});
        var sigEmailId=STATE.sigEmailId||(myEmails.find(function(e){return e.is_primary;})||myEmails[0]||{}).id;
        if(sigEmailId&&!STATE.sigEmailId)STATE.sigEmailId=sigEmailId;
        var sigEmail=myEmails.find(function(e){return e.id===sigEmailId;});
        var sig='';
        if(sigEmailId&&STATE.emailSignaturesCache&&STATE.emailSignaturesCache[sigEmailId]!==undefined){
          var rawSig=STATE.emailSignaturesCache[sigEmailId];
          sig=normalizeMailboxSignature(rawSig);
          syncMailboxSignatureIfNeeded(u.id,sigEmailId,rawSig,sig);
        } else if(sigEmailId){
          loadMailboxSignature(u.id,sigEmailId);
        }
        var editing=STATE.sigEditing;
        var presets=SIG_PRESETS;
        var presetNames={professional:'Professional',minimal:'Minimal',withLogo:'With logo'};
        var previewSender=(sigEmail&&sigEmail.display_name)||'Your Name';
        var previewEmail=(sigEmail&&sigEmail.email_address)||'you@fute-global.com';
        var previewSource=sig||(SIG_PRESETS&&SIG_PRESETS.professional)||'';
        var previewHtml=previewSource?(previewSource.replace(/{{sender}}/g,previewSender).replace(/{{senderemail}}/g,previewEmail)):'<em class="c-text3 fs-12">Loading signature…</em>';
        var sigLabel=sigEmail?(htmlEsc(sigEmail.display_name||sigEmail.email_address)+' &lt;'+htmlEsc(sigEmail.email_address)+'&gt;'):'selected email above';
        return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);margin-top:16px;overflow:hidden">'+
          '<div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'+
            '<div>'+
              '<div class="fs-12 c-text3" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em">Email Signature</div>'+
              '<div class="fs-11_5 c-text3" style="margin-top:2px">For '+sigLabel+' — appended automatically on send</div>'+
            '</div>'+
            '<button onclick="sigEditToggle()" class="fs-12 c-text2" style="padding:5px 12px;border:1px solid var(--border2);border-radius:7px;background:var(--bg);cursor:pointer">'+(editing?'Close editor':'Edit signature')+'</button>'+
          '</div>'+
          (!myEmails.length?'<div class="fs-12 c-amber" style="padding:12px 16px 0">Add a sending email ID in Admin → your profile before setting a signature.</div>':'')+
          (editing?
            '<div style="padding:16px">'+
              '<div style="margin-bottom:12px">'+
                '<div class="fs-11_5 c-text2" style="font-weight:600;margin-bottom:7px">Start from a preset layout:</div>'+
                '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
                Object.keys(presets).map(function(pk){
                  return '<button onclick="applySigPreset(\''+pk+'\')" style="font-size:12px;padding:5px 12px;border:1.5px solid var(--border2);border-radius:8px;background:var(--bg);cursor:pointer;color:var(--text2);transition:all .12s" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border2)\'">'+presetNames[pk]+'</button>';
                }).join('')+
                '</div>'+
              '</div>'+
              '<div style="margin-bottom:12px">'+
                '<div class="fs-11_5 c-text2" style="font-weight:600;margin-bottom:6px">Your signature <span class="c-text3" style="font-weight:400">— type and format it right here, exactly as it will look. Your name and email fill in automatically for each mailbox.</span></div>'+
                '<div class="sig-bar" onmousedown="event.preventDefault()">'+
                  '<button type="button" title="Bold" onclick="sigCmd(\'bold\')"><b>B</b></button>'+
                  '<button type="button" title="Italic" onclick="sigCmd(\'italic\')"><i>I</i></button>'+
                  '<button type="button" title="Underline" onclick="sigCmd(\'underline\')"><u>U</u></button>'+
                  '<button type="button" title="Turn the selected words into a link" onclick="sigLink()">Link</button>'+
                  '<span class="sig-bar-sep"></span>'+
                  '<button type="button" title="Put your name here — filled in per mailbox" onclick="sigInsert(\'sender\')">+ My name</button>'+
                  '<button type="button" title="Put this mailbox\'s email address here" onclick="sigInsert(\'senderemail\')">+ My email</button>'+
                  '<span class="sig-bar-sep"></span>'+
                  '<button type="button" title="Remove colours and fonts from the selected words" onclick="sigCmd(\'removeFormat\')">Clear style</button>'+
                '</div>'+
                '<div id="sig-editor" class="sig-editor" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Email signature">'+sigToEditor(STATE.sigEditInit!=null?STATE.sigEditInit:(sig||previewSource))+'</div>'+
              '</div>'+
              '<div style="display:flex;gap:8px">'+
                '<button onclick="saveSig()" class="fs-13" style="padding:7px 18px;background:var(--accent);color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer">Save signature</button>'+
                (sig?'<button onclick="clearSig()" class="c-red fs-13" style="padding:7px 14px;background:transparent;border:1px solid var(--red);border-radius:8px;cursor:pointer">Clear</button>':'')+
              '</div>'+
            '</div>'
          :
            '<div style="padding:14px 16px">'+
              '<div style="padding:12px 16px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;font-family:Arial,sans-serif;min-height:40px">'+previewHtml+'</div>'+
            '</div>'
          )+
        '</div>';
      })()+
    '</div>'+planPrev+'</div>':
    '<div class="card cp"><div class="c-text3 fs-13">Outreach plan editing is available to BD and Admin roles only.</div></div>';

  // ── SEQUENCE TAB (Sequences · My wording · AI style) ──
  var seqShell='';
  if(STATE.emailTab==='sequence'){
    var canSeeSeqs=userHasAnyRole(u,'admin','bd_lead','ra_lead','bd');
    var seqPills=[];
    if(canSeeSeqs) seqPills.push(['sequences','Sequences']);
    seqPills.push(['wording','My wording']);
    seqPills.push(['style','AI style']);
    var seqView=STATE.seqView||(canSeeSeqs?'sequences':'wording');
    if(!seqPills.some(function(p){return p[0]===seqView;})) seqView=seqPills[0][0];
    seqShell='<div class="rep-fgroup" style="margin-bottom:14px">'+seqPills.map(function(p){
      return '<button class="rep-pill'+(seqView===p[0]?' on':'')+'" onclick="seqView(\''+p[0]+'\')">'+p[1]+'</button>';
    }).join('')+'</div>'+
      (seqView==='wording'?tmplHtml:seqView==='style'?renderAiStyleCard():renderSequenceBody());
  }

  // ── COMPOSE TAB ──
  var myJobs=getMyJobs(u);

  // Build company list for step-1 picker
  var companyIds={};
  myJobs.forEach(function(j){
    if(j.company_id&&!companyIds[j.company_id])companyIds[j.company_id]={id:j.company_id,name:j.company_name};
  });
  var companyList=Object.values(companyIds).sort(function(a,b){return a.name.localeCompare(b.name);});
  var coOpts='<option value="">— Select company —</option>'+companyList.map(function(c){
    return '<option value="'+c.id+'"'+(STATE.composeCompanyId===c.id?' selected':'')+'>'+escHtml(c.name)+'</option>';
  }).join('');

  // Step-2: contacts for selected company
  var pocOpts='';
  if(STATE.composeCompanyId){
    var coJobs=myJobs.filter(function(j){return j.company_id===STATE.composeCompanyId;});
    var pocList=[];
    coJobs.forEach(function(j){
      STATE.contacts.filter(function(c){return c.job_id===j.id&&c.email;}).forEach(function(c){
        pocList.push({cid:c.id,jid:j.id,label:(c.first_name||'')+' '+(c.last_name||'').trim()+(c.email?' <'+c.email+'>':'')+(c.designation?' · '+c.designation:''),email:c.email});
      });
    });
    pocOpts='<option value="">— Select contact —</option>'+pocList.map(function(p){
      return '<option value="'+p.cid+'|'+p.jid+'"'+(STATE.composeContactId===p.cid+'|'+p.jid?' selected':'')+'>'+escHtml(p.label)+'</option>';
    }).join('');
  }

  // ── COMPOSE TAB ──────────────────────────────────────────────────────────
  // Editor on the left, a live preview of the actual email on the right, with
  // the "From" mailbox chosen inside the preview — because which mailbox sends
  // is not a setting, it is part of what the recipient reads.
  //
  // The preview resolves {{sender}} / {{senderemail}} FROM THE SELECTED
  // MAILBOX, which is the same rule the send path follows. This is the one
  // thing in this app that has previously gone wrong where a recipient could
  // see it (Session 14: 152 emails went out signed by the wrong person), and a
  // preview that quietly showed the logged-in user's name instead would hide
  // exactly that class of mistake rather than catch it.
  var composeHtml='';
  if(STATE.emailTab==='compose'){
    var hasRecipient=!!(STATE.composeContactId||STATE.manualEmail||STATE.composeReminderTo);

    var composeEmails=(STATE.userEmailsCache&&STATE.userEmailsCache[u.id]||[]).filter(function(e){return e.is_active;});
    var composeFromId=STATE.composeFromEmailId||(composeEmails.find(function(e){return e.is_primary;})||composeEmails[0]||{}).id;
    if(composeFromId&&!STATE.composeFromEmailId)STATE.composeFromEmailId=composeFromId;

    // Who is this going to? Either a contact on a lead, a typed address, or —
    // when composing from a reminder — the address the reminder itself carries.
    //
    // That last branch is not a nicety. This block used to resolve the
    // recipient ONLY out of STATE.contacts, which holds contacts from the jobs
    // this user's GET /jobs returned. A reminder whose lead is not in that set
    // left toEmail empty, so the To box and the preview both said "pick a
    // recipient" while Send stayed enabled and sent anyway. A screen that
    // cannot name the recipient must not be the screen that sends to them.
    var toName='', toEmail='', toCompany='', toJob=null, toContact=null;
    if(STATE.composeContactId){
      var parts=STATE.composeContactId.split('|');
      toContact=STATE.contacts.find(function(c){return c.id===parts[0];})||null;
      toJob=myJobs.find(function(j){return j.id===parts[1];})||null;
      if(toContact){
        toName=((toContact.first_name||'')+' '+(toContact.last_name||'')).trim();
        toEmail=toContact.email||'';
        toCompany=(toJob&&toJob.company_name)||'';
      }
    } else if(STATE.manualEmail){
      toEmail=STATE.manualEmail;
    }
    if(!toEmail&&STATE.composeReminderTo){
      toName=STATE.composeReminderTo.name||toName;
      toEmail=STATE.composeReminderTo.email||'';
      toCompany=STATE.composeReminderTo.company||toCompany;
    }

    // Recipient badge (kept — it is how you confirm you picked the right person)
    var recipientBadge='';
    if(toContact){
      recipientBadge='<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--accent-l);border-radius:var(--r);margin-top:8px">'+
        '<div class="fs-13" style="flex:1"><strong>'+escHtml(toName)+'</strong>'+(toContact.designation?' · '+escHtml(toContact.designation):'')+
          '<div class="fs-12 c-accent" style="font-weight:600;margin-top:2px">'+escHtml(toEmail||'(no email on record)')+'</div>'+(toCompany?'<div class="fs-11 c-text3">'+escHtml(toCompany)+'</div>':'')+
        '</div>'+
        '<button class="btn-icon" onclick="STATE.composeContactId=null;STATE.composeCompanyId=null;STATE.genEmail=null;render()">'+ico('x',13)+'</button>'+
      '</div>';
    } else if(STATE.manualEmail){
      recipientBadge='<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--green-l);border-radius:var(--r);margin-top:8px">'+
        '<div class="fs-13" style="flex:1"><strong>'+htmlEsc(STATE.manualEmail)+'</strong><div class="fs-11 c-text3">Manual entry</div></div>'+
        '<button class="btn-icon" onclick="STATE.manualEmail=null;STATE.genEmail=null;render()">'+ico('x',13)+'</button>'+
      '</div>';
    } else if(STATE.composeReminderTo&&STATE.composeReminderTo.email){
      var rt=STATE.composeReminderTo;
      recipientBadge='<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--accent-l);border-radius:var(--r);margin-top:8px">'+
        '<div class="fs-13" style="flex:1"><strong>'+escHtml(rt.name||rt.email)+'</strong>'+(rt.desig?' · '+escHtml(rt.desig):'')+
          '<div class="fs-12 c-accent" style="font-weight:600;margin-top:2px">'+escHtml(rt.email)+'</div>'+
          '<div class="fs-11 c-text3">'+(rt.company?escHtml(rt.company)+' · ':'')+'From the reminder</div>'+
        '</div>'+
      '</div>';
    }

    // ── the editor ───────────────────────────────────────────────────────
    var varChips=['{{fn}}','{{pos}}','{{company}}','{{loc}}','{{sender}}'].map(function(v){
      return '<span class="var-chip" title="Insert '+v+' into the message" onclick="composeInsertVar(\''+v+'\')">'+v+'</span>';
    }).join('');

    var editor=
      '<div class="card cp mb3">'+
        '<div class="fw6 mb2 fs-13">To</div>'+
        '<select class="sel mb2" onchange="STATE.composeCompanyId=this.value;STATE.composeContactId=null;render()">'+coOpts+'</select>'+
        (STATE.composeCompanyId?
          '<select class="sel" onchange="STATE.composeContactId=this.value;STATE.manualEmail=null;render()">'+pocOpts+'</select>':'')+
        '<div class="fs-11 c-text3" style="text-align:center;margin:10px 0">or enter an email</div>'+
        '<input class="inp" placeholder="name@company.com" id="manual-email-inp" value="'+htmlEsc(STATE.manualEmail||'')+'" oninput="STATE.manualEmail=this.value||null;STATE.composeContactId=null;STATE.composeCompanyId=null;render()"/>'+
        recipientBadge+
      '</div>'+
      (STATE.composeContext==='reminder'?
        '<div class="card cp mb3">'+
          '<div class="fw6 mb2 fs-13">Reminder templates</div>'+
          '<div class="fs-11_5 c-text3" style="margin-bottom:8px">Pick a template (fills from the lead), edit if needed, then Send. It goes through the email engine.</div>'+
          REMINDER_TEMPLATES.map(function(t,i){return '<button type="button" class="btn btn-outline btn-sm" style="margin:0 6px 6px 0" onclick="applyReminderTemplate('+i+')">'+escHtml(t.name)+'</button>';}).join('')+
        '</div>':'')+
      '<div class="card cp">'+
        '<div class="fgrp"><label class="flbl">Subject</label>'+
          '<input class="inp" id="email-subj" value="'+htmlEsc(STATE.composeSubj)+'" oninput="STATE.composeSubj=this.value;composeRepaintPreview()" placeholder="Email subject"/></div>'+
        '<div class="fgrp"><label class="flbl">Message</label>'+
          '<textarea class="txta w100" style="min-height:220px" id="email-body" oninput="STATE.composeBody=this.value;composeRepaintPreview()" placeholder="Write your message here...">'+htmlEsc(STATE.composeBody)+'</textarea></div>'+
        '<div style="margin-top:6px">'+
          '<div class="fs-11_5 c-text3" style="margin-bottom:5px">Click to insert:</div>'+varChips+
        '</div>'+
        '<div style="display:flex;justify-content:flex-end;margin-top:12px">'+
          '<button class="btn btn-primary" onclick="'+(STATE.composeContext==='reminder'?'sendReminderViaEngine()':'sendEmail()')+'" '+((hasRecipient&&composeEmails.length)?'':'disabled style="opacity:.5;cursor:not-allowed"')+'>'+ico('send',13)+' Send</button>'+
        '</div>'+
      '</div>';

    // ── the preview ──────────────────────────────────────────────────────
    var fromOpts=composeEmails.map(function(e){
      return '<option value="'+e.id+'"'+(e.id===composeFromId?' selected':'')+'>'+
        htmlEsc((e.display_name||e.email_address)+' <'+e.email_address+'>')+'</option>';
    }).join('');

    // Ask for the signature of whichever mailbox is selected, so the preview
    // shows the sign-off the recipient will actually get rather than a guess.
    if(composeFromId&&(!STATE.emailSignaturesCache||STATE.emailSignaturesCache[composeFromId]===undefined)){
      if(typeof loadMailboxSignature==='function')loadMailboxSignature(u.id,composeFromId);
    }

    var preview=
      '<div class="cmp-prev">'+
        '<div class="cmp-prev-h">'+UI.ic('mailopen')+'<b>Email preview</b>'+
          '<span class="fs-11_5 c-ink3" style="margin-left:auto">exactly what they receive</span></div>'+
        '<div class="cmp-fld"><label>From</label>'+
          (composeEmails.length
            ? '<select onchange="selectComposeFromEmail(this.value)">'+fromOpts+'</select>'
            : '<div class="cmp-static c-amber">No sending email ID assigned</div>')+
        '</div>'+
        '<div class="cmp-fld"><label>To</label>'+
          '<div class="cmp-static">'+(toEmail?htmlEsc((toName?toName+' <':'')+toEmail+(toName?'>':'')):'<span class="c-ink3">Pick a recipient</span>')+'</div>'+
        '</div>'+
        '<div class="cmp-mail" id="cmp-mail">'+composePreviewInner()+'</div>'+
        '<div class="cmp-foot">'+UI.ic('shield')+
          '<span>Your signature is added when the email is sent, from the mailbox above.</span></div>'+
      '</div>';

    composeHtml='<div class="cmp"><div class="cmp-edit">'+editor+'</div>'+preview+'</div>';
  }

  // OOO reminder cards for dashboard
  var today=todayIST();
  var oooReminders=(STATE.reminders||[]).filter(function(r){
    return r.reminder_type==='ooo_return'&&r.status==='pending';
  }).sort(function(a,b){return a.return_date>b.return_date?1:-1;});
  var dueOOO=oooReminders.filter(function(r){return r.return_date<=today;});

  var oooCards='';
  if(dueOOO.length){
    oooCards+='<div style="margin-bottom:16px">';
    oooCards+=dueOOO.map(function(r){
      var cid=(r.contact&&r.contact.id)||null;
      return '<div style="background:var(--green-l);border:1.5px solid var(--green);border-radius:var(--r2);padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px">'+
        '<div class="fs-20">🟢</div>'+
        '<div style="flex:1">'+
          '<div class="fs-13 c-text" style="font-weight:600">'+htmlEsc(r.contact_name||'Contact')+' has returned from OOO</div>'+
          '<div class="fs-12 c-text2" style="margin-top:2px">'+htmlEsc(r.company_name||'')+(r.return_date?' \u00b7 Returned '+htmlEsc(r.return_date):'')+'</div>'+
        '</div>'+
        (cid?'<button onclick="composeReminderEmail(\''+r.id+'\',\''+cid+'\')" style="background:var(--green);color:#fff;border:0;padding:6px 12px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer">Compose Email</button>':'')+
        '<button onclick="dismissReminder(\''+r.id+'\')" style="background:transparent;border:1px solid var(--green);color:var(--green);padding:6px 10px;border-radius:7px;font-size:12px;cursor:pointer">Dismiss</button>'+
      '</div>';
    }).join('')+'</div>';
  }
  // (R-141) "Upcoming OOO returns" is not drawn: it lives on the Reminders page and Today. A contact who HAS
  // returned is still shown above, because that one asks the person to do something.

  // The page identity already lives in the top bar, so the old in-page title
  // block is gone — it was the second "Email" heading on the same screen.
  return UI.page({
    tabs: tabBar,
    body:
      oooCards+
      pausedBanner+
      progressBar+
      // Candidate emails first: they are drained on their own queue and used
      // to be invisible here, so a batch that was quietly going out one every
      // ninety seconds read as stuck (Session 31).
      (STATE.emailTab==='pending'?(window.renderCandidatePendingPanel?renderCandidatePendingPanel(isBD):'')+pendingHtml:'')+
      // Compose is drawn by 48-page-outreach-gen.js, which loads after this
      // file — hence the guard rather than a bare call. The old hand-rolled
      // compose body is kept below as `composeHtml` only for the reminder flow,
      // which still uses the send engine rather than this composer.
      (STATE.emailTab==='compose'
        ? (STATE.composeContext==='reminder'
            ? composeHtml
            : sideSwitch+(STATE.composeSide==='candidates'
                ? (typeof renderCandidateOutreachBody==='function'?renderCandidateOutreachBody():composeHtml)
                : (typeof renderOutreachGenBody==='function'?renderOutreachGenBody():composeHtml)))
        : '')+
      (STATE.emailTab==='allmail'?renderAllMailBody():'')+
      (STATE.emailTab==='sequence'?seqShell:'')
  });
}

