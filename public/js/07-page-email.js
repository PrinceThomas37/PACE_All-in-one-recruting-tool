// ── EMAIL ──────────────────────────────────────
function loadMySendingStatus(){
  apiGet('/sending/my-status').then(function(s){
    STATE.mySendingPaused=!!(s&&s.paused);
    scheduleRender();
  }).catch(function(){if(STATE.mySendingPaused===undefined)STATE.mySendingPaused=false;});
}

function renderEmail(){
  var u=STATE.user;
  // BD sees pending+queued+sent; others see sent only
  var isBD=userHasAnyRole(u,'bd','bd_lead','admin','ra_lead');
  var pending=STATE.pendingEmails||[];
  var sentEmails=STATE.sentEmails||[];
  var tabs=isBD?['pending','compose','sent','outreachplan','sequence']:['compose','sent','outreachplan'];
  if(!STATE.emailTab)STATE.emailTab=isBD?'pending':'compose';

  // ── Sending paused banner — shown BEFORE the user tries to send, not just
  // as an error after the fact. Refreshed each time the Email page is viewed.
  if(STATE.mySendingPaused===undefined)loadMySendingStatus();
  var pausedBanner=STATE.mySendingPaused?
    '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--r2);padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px">'+
      '<span style="width:9px;height:9px;border-radius:50%;background:#dc2626;display:inline-block;flex-shrink:0"></span>'+
      '<div style="font-size:13px;color:#b91c1c"><strong>Sending is paused</strong> — your team lead/admin has stopped outbound email for you. New sends won\'t go out until they resume it.</div>'+
    '</div>':'';

  // ── Send progress bar ──
  var sp=STATE.sendProgress;
  var progressBar='';
  if(sp&&(sp.active||sp.done)){
    var pct=sp.total>0?Math.round((sp.sent+sp.failed)/sp.total*100):0;
    var barColor=sp.done?(sp.failed>0?'var(--amber)':'var(--green)'):'var(--accent)';
    var fails=sp.failDetails||[];
    // Stat chip
    var statChip=function(val,label,color){
      return '<div style="flex:1;min-width:70px;padding:8px 12px;border-radius:8px;background:var(--bg);border:1px solid var(--border2)">'+
        '<div style="font-size:20px;font-weight:700;line-height:1;color:'+color+'">'+val+'</div>'+
        '<div style="font-size:10.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:3px">'+label+'</div>'+
      '</div>';
    };
    var waitingTotal=sp.deferred||0;
    var chips='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'+
      statChip(sp.sent,'Sent','var(--green)')+
      statChip(sp.failed,'Failed',sp.failed>0?'#ef4444':'var(--text2)')+
      (waitingTotal?statChip(waitingTotal,'Waiting','var(--amber)'):'')+
      statChip(sp.total,'Total','var(--text)')+
    '</div>';
    // Failed rows — each links back to its lead
    var failRows=fails.map(function(f){
      var cur=f.job_id?'cursor:pointer;':'';
      var click=f.job_id?(' onclick="closeAndOpenLead(\''+f.job_id+'\')" title="Open this lead"'):'';
      return '<div class="fail-row"'+click+' style="'+cur+'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border2)">'+
        '<div style="min-width:0;flex:1">'+
          '<div style="font-size:12.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(f.to||'(no address)')+'</div>'+
          '<div style="font-size:11.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(f.error||'Send failed')+'</div>'+
        '</div>'+
        (f.job_id?'<div style="font-size:11.5px;color:var(--accent);white-space:nowrap;font-weight:600">View lead →</div>':'<div style="font-size:11px;color:var(--text3);white-space:nowrap">no lead link</div>')+
      '</div>';
    }).join('');
    var failPanel=fails.length?
      '<div style="margin-top:12px;border:1px solid var(--border2);border-radius:8px;overflow:hidden">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--amber-l)">'+
          '<div style="font-size:12px;font-weight:700;color:var(--amber)">Failed deliveries ('+fails.length+')</div>'+
          '<div style="font-size:11px;color:var(--amber)">click a row to open the lead</div>'+
        '</div>'+
        '<div style="max-height:240px;overflow-y:auto">'+failRows+'</div>'+
      '</div>':'';
    var dismissBtn=sp.done?'<button onclick="dismissSendProgress()" title="Dismiss" style="background:transparent;border:0;color:var(--text3);font-size:18px;line-height:1;cursor:pointer;padding:0 2px">×</button>':'';
    progressBar='<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:14px 18px;margin-bottom:16px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
        '<div style="font-weight:700;font-size:14px">'+(sp.done?(sp.failed>0?'Send complete — '+sp.failed+' need attention':'Send complete'):'Sending emails…')+'</div>'+
        '<div style="display:flex;align-items:center;gap:10px"><div style="font-size:12px;font-weight:700;color:'+barColor+'">'+pct+'%</div>'+dismissBtn+'</div>'+
      '</div>'+
      chips+
      '<div style="background:var(--border);border-radius:99px;height:8px;overflow:hidden;margin-bottom:8px">'+
        '<div style="height:100%;border-radius:99px;background:'+barColor+';width:'+pct+'%;transition:width .3s ease"></div>'+
      '</div>'+
      '<div style="font-size:12px;color:var(--text3)">'+(sp.active&&sp.current?'Currently sending to: '+htmlEsc(sp.current):(sp.done?'Completed at '+(sp.completedAt?new Date(sp.completedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):''):''))+'</div>'+
      failPanel+
      (sp.deferredNote?'<div style="margin-top:8px;font-size:12px;color:#b45309">'+htmlEsc(sp.deferredNote)+'</div>':'')+
    '</div>';
  }

  var tabBar=tabs.map(function(t){
    var lbl;
    if(t==='pending'){
      var ps=STATE.pendingSummary;
      if(ps&&ps.total_pending){
        lbl='Pending ('+ps.total_pending+(ps.ready_now?': '+ps.ready_now+' now':'')+(ps.waiting_window?(', '+ps.waiting_window+' waiting'):'')+')';
      }else{
        lbl='Pending'+(pending.length?' ('+pending.length+')':'');
      }
    }else if(t==='outreachplan'){lbl='Outreach Plan';}else{lbl=t.charAt(0).toUpperCase()+t.slice(1);}
    return '<div class="tab'+(STATE.emailTab===t?' active':'')+'" onclick="setEmailTab(\''+t+'\')">'+lbl+'</div>';
  }).join('');

  // ── PENDING TAB ──
  var pendingHtml='';
  if(STATE.emailTab==='pending'){
    var scheduleBanner=renderPendingScheduleBanner();
    var isRaLead=userHasRole(u,'ra_lead');

    // ── RA LEAD: BD user picker ──────────────────────────────────────
    if(isRaLead && !STATE.raLeadSelectedBD){
      // Group ALL emails (pending + sent + failed) by BD user for the picker
      var bdGroups={};
      (STATE.allBDEmails||STATE.pendingEmails||[]).forEach(function(e){
        var sid=e.sender&&e.sender.id?e.sender.id:(e.sent_by||'unknown');
        var sname=e.sender&&e.sender.name?e.sender.name:'Unknown';
        if(!bdGroups[sid])bdGroups[sid]={id:sid,name:sname,pending:0,sent:0,failed:0};
        if(e.status==='pending')bdGroups[sid].pending++;
        else if(e.status==='sent')bdGroups[sid].sent++;
        else if(e.status==='failed')bdGroups[sid].failed++;
      });
      // Always show all BD/BD_Lead users even if they have no emails yet
      (STATE.users||[]).filter(function(usr){return userHasRole(usr,'bd')||userHasRole(usr,'bd_lead');}).forEach(function(usr){
        if(!bdGroups[usr.id])bdGroups[usr.id]={id:usr.id,name:usr.name,pending:0,sent:0,failed:0};
        else if(!bdGroups[usr.id].name)bdGroups[usr.id].name=usr.name; // fill name if missing
      });
      var bdCards=Object.values(bdGroups).sort(function(a,b){return (b.pending+b.sent+b.failed)-(a.pending+a.sent+a.failed);}).map(function(bd){
        var initials=bd.name.split(' ').map(function(w){return w[0]||'';}).slice(0,2).join('').toUpperCase();
        var total=bd.pending+bd.sent+bd.failed;
        var statusLine=total===0?'<span style="color:var(--text3)">No emails yet</span>':(
          (bd.pending?'<span style="color:var(--amber);font-weight:600">'+bd.pending+' pending</span>':'')+
          (bd.pending&&(bd.sent||bd.failed)?' · ':'')+
          (bd.sent?'<span style="color:var(--green);font-weight:600">'+bd.sent+' sent</span>':'')+
          (bd.sent&&bd.failed?' · ':'')+
          (bd.failed?'<span style="color:var(--red,#dc2626);font-weight:600">'+bd.failed+' failed (all runs)</span>':'')
        );
        return '<div onclick="STATE.raLeadSelectedBD=\''+bd.id+'\';STATE.pendingEmailPage=0;loadPendingSummary();render()" style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s" onmouseover="this.style.background=\'var(--accent-l)\'" onmouseout="this.style.background=\'\'" >'+
          '<div style="width:38px;height:38px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0">'+htmlEsc(initials)+'</div>'+
          '<div style="flex:1">'+
            '<div style="font-weight:600;font-size:13.5px">'+htmlEsc(bd.name)+'</div>'+
            '<div style="font-size:12px;margin-top:2px">'+statusLine+'</div>'+
          '</div>'+
          '<div style="color:var(--text3);font-size:16px">→</div>'+
        '</div>';
      }).join('');
      if(!bdCards)bdCards='<div style="padding:40px;text-align:center;color:var(--text3)">No BD users found.</div>';
      pendingHtml=scheduleBanner+'<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+
        '<div style="padding:12px 18px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">BD Managers — click to view emails</div>'+
        bdCards+
      '</div>';

    // ── RA LEAD: viewing a specific BD's emails ──────────────────────
    } else {
      var viewingBD=isRaLead&&STATE.raLeadSelectedBD;
      var displayPending=viewingBD
        ? (STATE.allBDEmails||STATE.pendingEmails||[]).filter(function(e){return (e.sender&&e.sender.id?e.sender.id:e.sent_by)===STATE.raLeadSelectedBD;})
        : pending;
      var bdName=viewingBD?(function(){var bd=(STATE.users||[]).find(function(u){return u.id===STATE.raLeadSelectedBD;});return bd?bd.name:'BD Manager';})():'';

      var totalRecipients=displayPending.length;
      var _pPg=Math.min(STATE.pendingEmailPage||0,Math.max(0,Math.ceil(totalRecipients/20)-1));
      var _pTp=Math.max(1,Math.ceil(totalRecipients/20));
      var pendingPaged=displayPending.slice(_pPg*20,(_pPg+1)*20);
      var sendBlocked=!totalRecipients||STATE.mySendingPaused;
      var sendAllBtn=isRaLead?'':('<button onclick="openSendAllConfirm()" style="background:var(--accent);color:#fff;border:0;padding:9px 18px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer'+(sendBlocked?';opacity:.4;cursor:not-allowed':'')+'"'+(sendBlocked?'disabled':'')+(STATE.mySendingPaused?' title="Sending is paused"':'')+'>Send all pending ('+totalRecipients+')</button>');

      var pendingRows=pendingPaged.map(function(e){
        var isSelected=STATE.previewPendingId===e.id;
        var jname=(e.job&&e.job.position?e.job.position:'')+(e.job&&e.job.company?(' · '+e.job.company.name):'');
        var fu=e.followup_type;
        var rowBg=isSelected?'var(--accent-l)':fu==='fu2'?'#fff8f0':fu==='fu1'?'#fffdf0':'';
        var fuBadge=fu==='fu1'?'<span style="font-size:10px;padding:2px 7px;background:#fef9c3;color:#92400e;border-radius:6px;font-weight:700;margin-left:6px">FU1</span>':fu==='fu2'?'<span style="font-size:10px;padding:2px 7px;background:#ffedd5;color:#9a3412;border-radius:6px;font-weight:700;margin-left:6px">FU2</span>':'';
        var leadTz=(e.job&&e.job.timezone)||'EST';
        var tzRow2=(STATE.pendingSummary&&STATE.pendingSummary.by_timezone||[]).find(function(t){return t.timezone===leadTz;});
        var winBadge=(tzRow2&&tzRow2.waiting_window>0&&!(tzRow2.ready_now>0))?'<span style="font-size:10px;padding:2px 7px;background:#fef3c7;color:#92400e;border-radius:6px;font-weight:600;margin-left:6px">Waiting · '+htmlEsc(leadTz)+'</span>':'<span style="font-size:10px;padding:2px 7px;background:var(--green-l);color:var(--green);border-radius:6px;font-weight:600;margin-left:6px">Ready now</span>';
        return '<tr style="border-bottom:1px solid var(--border2);cursor:pointer;background:'+rowBg+'" onclick="previewPendingEmail(\''+e.id+'\')">'+'<td style="padding:10px 12px;font-size:13px"><div style="font-weight:500">'+htmlEsc(e.to_email)+fuBadge+winBadge+'</div>'+'<div style="font-size:11px;color:var(--text3)">'+htmlEsc((e.contact&&e.contact.first_name?e.contact.first_name+' '+(e.contact.last_name||''):''))+'</div></td>'+'<td style="padding:10px 12px;font-size:12px;color:var(--text2)">'+htmlEsc(jname)+'</td>'+'<td style="padding:10px 12px;font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(e.subject||'')+'</td>'+'<td style="padding:10px 12px;white-space:nowrap">'+(function(){var sc=e.status==='sent'?'background:var(--green-l);color:var(--green)':e.status==='failed'?'background:#fee2e2;color:#dc2626':'background:var(--amber-l);color:var(--amber)';return '<span style="font-size:11px;padding:2px 8px;'+sc+';border-radius:8px;font-weight:600">'+htmlEsc(e.status)+'</span>';})() +'</td>'+'</tr>';
      }).join('');
      if(!pendingRows)pendingRows='<tr><td colspan="4" style="padding:40px;text-align:center;color:var(--text3)">No pending emails yet.</td></tr>';

    // Preview panel
    var previewPanel='';
    if(STATE.previewPendingId){
      var pe=displayPending.find(function(e){return e.id===STATE.previewPendingId;});
      if(pe){
        previewPanel='<div style="width:380px;flex-shrink:0;background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+
          '<div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'+
            '<div style="font-weight:600;font-size:13px">Email Preview</div>'+
            '<button class="btn-icon" onclick="STATE.previewPendingId=null;render()">'+ico('x',13)+'</button>'+
          '</div>'+
          '<div style="padding:12px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text2)">'+
            '<div><strong>To:</strong> '+htmlEsc(pe.to_email)+'</div>'+
            '<div class="mt1"><strong>Subject:</strong> '+htmlEsc(pe.subject||'')+'</div>'+
          '</div>'+
          '<div style="padding:14px;font-size:13px;line-height:1.7;white-space:pre-wrap;max-height:360px;overflow-y:auto">'+htmlEsc(pe.body||'')+'</div>'+
          '<div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">'+
            '<button class="btn btn-outline btn-sm" onclick="openEditPendingEmail(\''+pe.id+'\')">✒ Edit email</button>'+
          '</div>'+
          '</div>'+
        '</div>';
      }
    }

    // Back button for RA Lead drill-down view
    var backBtn=viewingBD?('<div style="margin-bottom:14px"><button onclick="STATE.raLeadSelectedBD=null;STATE.previewPendingId=null;loadPendingSummary();render()" style="background:none;border:1px solid var(--border2);padding:6px 14px;border-radius:7px;font-size:13px;cursor:pointer;color:var(--text2)">← Back to all BD Managers</button><span style="margin-left:12px;font-weight:600;font-size:14px">'+htmlEsc(bdName)+'</span></div>'):'';

    pendingHtml='<div>'+scheduleBanner+
      backBtn+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
        '<div style="font-size:13px;color:var(--text2)">'+totalRecipients+' email'+(totalRecipients!==1?'s':'')+' ready · page '+(_pPg+1)+' of '+_pTp+'</div>'+
        sendAllBtn+
      '</div>'+
      '<div style="display:flex;gap:14px;align-items:flex-start">'+
        '<div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+
          '<table style="width:100%;border-collapse:collapse;font-size:13px">'+
            '<thead style="background:var(--bg);color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.5px">'+
              '<tr><th style="padding:10px 12px;text-align:left">Recipient</th><th style="padding:10px 12px;text-align:left">Job</th><th style="padding:10px 12px;text-align:left">Subject</th><th style="padding:10px 12px;text-align:left">Status</th></tr>'+
            '</thead>'+
            '<tbody>'+pendingRows+'</tbody>'+
          '</table>'+
          (_pTp>1?'<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--border)">'+
            '<div style="font-size:12px;color:var(--text3)">'+totalRecipients+' total · page '+(_pPg+1)+' of '+_pTp+'</div>'+
            '<div style="display:flex;gap:5px">'+
              '<button onclick="STATE.pendingEmailPage=Math.max(0,'+_pPg+'-1);render()" style="padding:5px 12px;border:1px solid var(--border2);border-radius:7px;background:var(--card);font-size:12px;cursor:pointer" '+(_pPg===0?'disabled':'')+'>← Prev</button>'+
              '<span style="padding:5px 10px;font-size:12px;font-weight:600">'+(_pPg+1)+' / '+_pTp+'</span>'+
              '<button onclick="STATE.pendingEmailPage=Math.min('+(_pTp-1)+','+_pPg+'+1);render()" style="padding:5px 12px;border:1px solid var(--border2);border-radius:7px;background:var(--card);font-size:12px;cursor:pointer" '+(_pPg>=_pTp-1?'disabled':'')+'>Next →</button>'+
            '</div>'+
          '</div>':'')  +
        '</div>'+
        previewPanel+
      '</div>'+
    '</div>';
    } // end else (BD table view)
  }

  // ── SENT TAB ──
  var sentHtml='';
  if(STATE.emailTab==='sent'){
    var _sPg=Math.min(STATE.sentEmailPage||0,Math.max(0,Math.ceil(sentEmails.length/20)-1));
    var _sTp=Math.max(1,Math.ceil(sentEmails.length/20));
    var sentPaged=sentEmails.slice(_sPg*20,(_sPg+1)*20);
    var sentRows=sentPaged.map(function(e){
      var jname=(e.job&&e.job.position?e.job.position:'')+(e.job&&e.job.company?(' · '+e.job.company.name):'');
      return '<tr style="border-bottom:1px solid var(--border2)">'+
        '<td style="padding:10px 12px;font-size:13px">'+htmlEsc(e.to_email||'')+'</td>'+
        '<td style="padding:10px 12px;font-size:12px;color:var(--text2)">'+htmlEsc(jname)+'</td>'+
        '<td style="padding:10px 12px;font-size:12px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(e.subject||'')+'</td>'+
        '<td style="padding:10px 12px"><span style="font-size:11px;padding:2px 8px;background:var(--green-l);color:var(--green);border-radius:8px;font-weight:600">'+htmlEsc(e.status||'sent')+'</span></td>'+
        '<td style="padding:10px 12px;font-size:11px;color:var(--text3)">'+htmlEsc(e.sent_at||'')+'</td>'+
      '</tr>';
    }).join('');
    if(!sentRows)sentRows='<tr><td colspan="5" style="padding:40px;text-align:center;color:var(--text3)">No sent emails yet.</td></tr>';
    sentHtml='<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+
      '<table style="width:100%;border-collapse:collapse;font-size:13px">'+
        '<thead style="background:var(--bg);color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.5px">'+
          '<tr><th style="padding:10px 12px;text-align:left">To</th><th style="padding:10px 12px;text-align:left">Job</th><th style="padding:10px 12px;text-align:left">Subject</th><th style="padding:10px 12px;text-align:left">Status</th><th style="padding:10px 12px;text-align:left">Date</th></tr>'+
        '</thead>'+
        '<tbody>'+sentRows+'</tbody>'+
      '</table>'+
      (_sTp>1?'<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--border)">'+
        '<div style="font-size:12px;color:var(--text3)">'+sentEmails.length+' total · page '+(_sPg+1)+' of '+_sTp+'</div>'+
        '<div style="display:flex;gap:5px">'+
          '<button onclick="STATE.sentEmailPage=Math.max(0,'+_sPg+'-1);render()" style="padding:5px 12px;border:1px solid var(--border2);border-radius:7px;background:var(--card);font-size:12px;cursor:pointer" '+(_sPg===0?'disabled':'')+'>← Prev</button>'+
          '<span style="padding:5px 10px;font-size:12px;font-weight:600">'+(_sPg+1)+' / '+_sTp+'</span>'+
          '<button onclick="STATE.sentEmailPage=Math.min('+(_sTp-1)+','+_sPg+'+1);render()" style="padding:5px 12px;border:1px solid var(--border2);border-radius:7px;background:var(--card);font-size:12px;cursor:pointer" '+(_sPg>=_sTp-1?'disabled':'')+'>Next →</button>'+
        '</div>'+
      '</div>':'')  +
    '</div>';
  }

  // ── OUTREACH PLAN TAB ──
  if(!STATE.activeTmpl)STATE.activeTmpl='outreach';
  var myPlan=STATE.myOutreachPlan||{};
  var fu1Day=parseInt(myPlan['fu1_day']||'3',10);
  var fu2Day=parseInt(myPlan['fu2_day']||'7',10);
  function dayOpts(selected,minDay){
    var opts='';
    for(var d=1;d<=10;d++){
      if(d<=minDay)continue;
      opts+='<option value="'+d+'"'+(d===selected?' selected':'')+'>Day '+d+'</option>';
    }
    return opts;
  }
  var tmplDefs=[
    {key:'outreach',label:'Outreach 1',sublabel:'Sent immediately on assignment',color:'var(--accent)',subjVal:myPlan['tmpl_o1_subject']||STATE.emailSubj,bodyVal:myPlan['tmpl_o1_body']||STATE.emailBody,subjId:'tmpl-o1-subj',bodyId:'tmpl-o1-body'},
    {key:'fu1',label:'Follow-up 1',sublabel:'Day '+fu1Day+' after outreach',color:'#ca8a04',subjVal:myPlan['tmpl_fu1_subject']||STATE.fu1Subj,bodyVal:myPlan['tmpl_fu1_body']||STATE.fu1Body,subjId:'tmpl-fu1-subj',bodyId:'tmpl-fu1-body'},
    {key:'fu2',label:'Follow-up 2',sublabel:'Day '+fu2Day+' after outreach',color:'#ea580c',subjVal:myPlan['tmpl_fu2_subject']||STATE.fu2Subj,bodyVal:myPlan['tmpl_fu2_body']||STATE.fu2Body,subjId:'tmpl-fu2-subj',bodyId:'tmpl-fu2-body'}
  ];
  var activeTmpl=tmplDefs.find(function(t){return t.key===STATE.activeTmpl;})||tmplDefs[0];
  var planEmails=(STATE.userEmailsCache&&STATE.userEmailsCache[u.id]||[]).filter(function(e){return e.is_active;});
  var planFromId=STATE.planFromEmailId||(planEmails.find(function(e){return e.is_primary;})||planEmails[0]||{}).id;
  if(planFromId&&!STATE.planFromEmailId)STATE.planFromEmailId=planFromId;
  if(planFromId&&STATE.sigEmailId!==planFromId)STATE.sigEmailId=planFromId;
  var styleBtns=Object.keys(OUTREACH_STYLE_PRESETS).map(function(pk){
    var p=OUTREACH_STYLE_PRESETS[pk];
    var on=STATE.outreachStylePreset===pk;
    return '<button type="button" onclick="applyOutreachStylePreset(\''+pk+'\')" style="text-align:left;padding:10px 14px;border-radius:10px;cursor:pointer;border:2px solid '+(on?'var(--accent)':'var(--border)')+';background:'+(on?'var(--accent-l)':'var(--card)')+';min-width:140px;flex:1">'+
      '<div style="font-weight:700;font-size:13px;color:'+(on?'var(--accent)':'var(--text)')+'">'+htmlEsc(p.label)+'</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:3px">'+htmlEsc(p.hint)+'</div></button>';
  }).join('');
  var tmplTabBtns=tmplDefs.map(function(t){
    var isActive=STATE.activeTmpl===t.key;
    return '<button onclick="STATE.activeTmpl=\''+t.key+'\';render()" style="padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:2px solid '+(isActive?t.color:'var(--border)')+';background:'+(isActive?t.color:'var(--card)')+';color:'+(isActive?'#fff':'var(--text2)')+';transition:all .15s">'+t.label+'</button>';
  }).join('');
  var daySettingsHtml='';
  if(STATE.activeTmpl==='fu1'){
    daySettingsHtml='<div class="fgrp" style="margin-bottom:14px"><label class="flbl">Send Follow-up 1 on</label>'+
      '<select class="sel" style="max-width:160px" id="fu1-day-sel" onchange="saveOutreachDay(\'fu1_day\',this.value)">'+
        '<option value="">— select day —</option>'+dayOpts(fu1Day,0)+
      '</select>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:4px">Days after the outreach email was sent</div>'+
    '</div>';
  } else if(STATE.activeTmpl==='fu2'){
    daySettingsHtml='<div class="fgrp" style="margin-bottom:14px"><label class="flbl">Send Follow-up 2 on</label>'+
      '<select class="sel" style="max-width:160px" id="fu2-day-sel" onchange="saveOutreachDay(\'fu2_day\',this.value)">'+
        '<option value="">— select day —</option>'+dayOpts(fu2Day,fu1Day)+
      '</select>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:4px">Must be after Follow-up 1 (Day '+fu1Day+')</div>'+
    '</div>';
  }
  var canEditTemplates=userHasAnyRole(u,'bd','bd_lead','admin');
  var tmplHtml=canEditTemplates?
    '<div style="max-width:720px">'+
      '<div style="padding:12px 14px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:16px;font-size:13px;color:var(--text2)">'+
        '<strong>How this works:</strong> Pick your sending email → choose a message style → edit Outreach &amp; follow-ups → Save. Assigned leads use these templates automatically.'+
      '</div>'+
      renderSendingEmailCard(u.id,planEmails,planFromId,'selectPlanFromEmail')+
      '<div class="card cp mb3">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'+
          '<div class="fw6" style="font-size:13px">Message style</div>'+
          '<div style="display:flex;align-items:center;gap:8px;font-size:12px">'+
            '<span style="color:var(--text3)">Template mode:</span>'+
            '<div style="display:flex;border:1px solid var(--border);border-radius:20px;overflow:hidden;background:var(--card)">'+
              '<button type="button" onclick="setTemplateModeSpecific()" style="padding:4px 14px;font-size:12px;font-weight:600;cursor:pointer;border:0;border-radius:20px 0 0 20px;background:'+(STATE.randomTemplateMode?'transparent':'var(--accent)')+';color:'+(STATE.randomTemplateMode?'var(--text3)':'#fff')+';transition:all .15s">Specific</button>'+
              '<button type="button" onclick="setTemplateModeRandom()" style="padding:4px 14px;font-size:12px;font-weight:600;cursor:pointer;border:0;border-radius:0 20px 20px 0;background:'+(STATE.randomTemplateMode?'var(--accent)':'transparent')+';color:'+(STATE.randomTemplateMode?'#fff':'var(--text3)')+';transition:all .15s">Random</button>'+
            '</div>'+
          '</div>'+
        '</div>'+
        (STATE.randomTemplateMode?
          '<div style="font-size:11.5px;color:var(--text3);margin-bottom:10px">Bulk outreach rotates through all '+Object.keys(OUTREACH_STYLE_PRESETS).length+' matched styles (outreach + follow-ups) — each used once before any repeat. Follow-up 1 and 2 use the same style as the original outreach for each contact.</div>'+
          '<div style="padding:10px 14px;background:var(--accent-l);border-radius:var(--r2);font-size:12.5px;color:var(--accent);font-weight:600;margin-bottom:10px">'+
            '&#8652; Random mode — outreach, FU1, and FU2 rotate together per contact'+
          '</div>':
          '<div style="font-size:11.5px;color:var(--text3);margin-bottom:10px">Start from a proven template — you can edit any field after applying.</div>'+
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+styleBtns+'</div>'
        )+
        '<button class="btn btn-primary" onclick="saveTemplateModePreference()" style="font-size:12px;padding:6px 18px">Save preference</button>'+
      '</div>'+
      '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">'+tmplTabBtns+'</div>'+
      '<div class="card cp" style="border-top:3px solid '+activeTmpl.color+'">'+
        '<div style="margin-bottom:14px">'+
          '<div style="font-weight:700;font-size:14px;color:var(--text)">'+activeTmpl.label+'</div>'+
          '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+activeTmpl.sublabel+'</div>'+
        '</div>'+
        daySettingsHtml+
        '<div class="fgrp"><label class="flbl">Subject</label><input class="inp" id="'+activeTmpl.subjId+'" value="'+htmlEsc(activeTmpl.subjVal)+'" onfocus="setVarInsertTarget(\'subject\')"/></div>'+
        '<div class="fgrp"><label class="flbl">Body</label><textarea class="txta w100" style="min-height:200px" id="'+activeTmpl.bodyId+'" onfocus="setVarInsertTarget(\'body\')">'+htmlEsc(activeTmpl.bodyVal)+'</textarea></div>'+
        renderVarChipBar(activeTmpl.subjId,activeTmpl.bodyId)+
        '<button class="btn btn-primary mt3" onclick="saveOutreachTemplate(\''+activeTmpl.key+'\',\''+activeTmpl.subjId+'\',\''+activeTmpl.bodyId+'\')">Save '+activeTmpl.label+'</button>'+
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
        var previewHtml=previewSource?(previewSource.replace(/{{sender}}/g,previewSender).replace(/{{senderemail}}/g,previewEmail)):'<em style="color:var(--text3);font-size:12px">Loading signature…</em>';
        var sigLabel=sigEmail?(htmlEsc(sigEmail.display_name||sigEmail.email_address)+' &lt;'+htmlEsc(sigEmail.email_address)+'&gt;'):'selected email above';
        return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);margin-top:16px;overflow:hidden">'+
          '<div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'+
            '<div>'+
              '<div style="font-weight:700;font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Email Signature</div>'+
              '<div style="font-size:11.5px;color:var(--text3);margin-top:2px">For '+sigLabel+' — appended automatically on send</div>'+
            '</div>'+
            '<button onclick="STATE.sigEditing=!STATE.sigEditing;render()" style="font-size:12px;padding:5px 12px;border:1px solid var(--border2);border-radius:7px;background:var(--bg);cursor:pointer;color:var(--text2)">'+(editing?'Close editor':'Edit signature')+'</button>'+
          '</div>'+
          (!myEmails.length?'<div style="padding:12px 16px 0;font-size:12px;color:var(--amber)">Add a sending email ID in Admin → your profile before setting a signature.</div>':'')+
          (editing?
            '<div style="padding:16px">'+
              '<div style="margin-bottom:12px">'+
                '<div style="font-size:11.5px;font-weight:600;color:var(--text2);margin-bottom:7px">Start from a preset layout:</div>'+
                '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
                Object.keys(presets).map(function(pk){
                  return '<button onclick="applySigPreset(\''+pk+'\')" style="font-size:12px;padding:5px 12px;border:1.5px solid var(--border2);border-radius:8px;background:var(--bg);cursor:pointer;color:var(--text2);transition:all .12s" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border2)\'">'+presetNames[pk]+'</button>';
                }).join('')+
                '</div>'+
              '</div>'+
              '<div style="margin-bottom:10px">'+
                '<div style="font-size:11.5px;font-weight:600;color:var(--text2);margin-bottom:6px">Signature HTML <span style="font-weight:400;color:var(--text3)">({{sender}} = display name, {{senderemail}} = this email ID)</span></div>'+
                '<textarea id="sig-html-input" style="width:100%;min-height:110px;padding:10px;border:1.5px solid var(--border2);border-radius:8px;font-family:var(--mono);font-size:12px;line-height:1.6;resize:vertical;color:var(--text);background:var(--bg)" placeholder="<p>Best regards,<br><strong>{{sender}}</strong></p>">'+htmlEsc(sig)+'</textarea>'+
              '</div>'+
              '<div style="margin-bottom:12px">'+
                '<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Live preview</div>'+
                '<div id="sig-live-preview" style="padding:14px 16px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;font-family:Arial,sans-serif;min-height:48px">'+
                  previewHtml+
                '</div>'+
              '</div>'+
              '<div style="display:flex;gap:8px">'+
                '<button onclick="saveSig()" style="padding:7px 18px;background:var(--accent);color:#fff;border:0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Save signature</button>'+
                (sig?'<button onclick="clearSig()" style="padding:7px 14px;background:transparent;color:var(--red);border:1px solid var(--red);border-radius:8px;font-size:13px;cursor:pointer">Clear</button>':'')+
              '</div>'+
            '</div>'
          :
            '<div style="padding:14px 16px">'+
              '<div style="padding:12px 16px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;font-family:Arial,sans-serif;min-height:40px">'+previewHtml+'</div>'+
            '</div>'
          )+
        '</div>';
      })()+
    '</div>':
    '<div class="card cp"><div style="color:var(--text3);font-size:13px">Outreach plan editing is available to BD and Admin roles only.</div></div>';

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

  var composeHtml='';
  if(STATE.emailTab==='compose'){
    var hasRecipient=!!(STATE.composeContactId||STATE.manualEmail);

    // Recipient badge
    var recipientBadge='';
    if(STATE.composeContactId){
      var parts=STATE.composeContactId.split('|');
      var cc=STATE.contacts.find(function(c){return c.id===parts[0];});
      var cj=myJobs.find(function(j){return j.id===parts[1];});
      if(cc)recipientBadge='<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--accent-l);border-radius:var(--r);margin-top:8px">'+
        '<div style="flex:1;font-size:13px"><strong>'+escHtml((cc.first_name||'')+' '+(cc.last_name||''))+'</strong>'+(cc.designation?' \u00b7 '+escHtml(cc.designation):'')+
          '<div style="font-size:12px;color:var(--accent);font-weight:600;margin-top:2px">'+escHtml(cc.email||'(no email on record)')+'</div>'+(cj?'<div style="font-size:11px;color:var(--text3)">'+escHtml(cj.company_name)+'</div>':'')+
        '</div>'+
        '<button class="btn-icon" onclick="STATE.composeContactId=null;STATE.composeCompanyId=null;STATE.genEmail=null;render()">'+ico('x',13)+'</button>'+
      '</div>';
    } else if(STATE.manualEmail){
      recipientBadge='<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--green-l);border-radius:var(--r);margin-top:8px">'+
        '<div style="flex:1;font-size:13px"><strong>'+htmlEsc(STATE.manualEmail)+'</strong><div style="font-size:11px;color:var(--text3)">Manual entry</div></div>'+
        '<button class="btn-icon" onclick="STATE.manualEmail=null;STATE.genEmail=null;render()">'+ico('x',13)+'</button>'+
      '</div>';
    }

    var composeFromOpts='';
    var composeEmails=(STATE.userEmailsCache&&STATE.userEmailsCache[u.id]||[]).filter(function(e){return e.is_active;});
    var composeFromId=STATE.composeFromEmailId||(composeEmails.find(function(e){return e.is_primary;})||composeEmails[0]||{}).id;
    if(composeFromId&&!STATE.composeFromEmailId)STATE.composeFromEmailId=composeFromId;
    if(composeEmails.length){
      composeFromOpts=composeEmails.map(function(e){
        return '<option value="'+e.id+'"'+(e.id===composeFromId?' selected':'')+'>'+htmlEsc(e.display_name||e.email_address)+' &lt;'+htmlEsc(e.email_address)+'&gt;</option>';
      }).join('');
    }

    composeHtml='<div style="max-width:520px">'+
      '<div class="card cp mb3">'+
        '<div class="fw6 mb2" style="font-size:13px">To</div>'+
        '<select class="sel mb2" onchange="STATE.composeCompanyId=this.value;STATE.composeContactId=null;render()">'+coOpts+'</select>'+
        (STATE.composeCompanyId?
          '<select class="sel" onchange="STATE.composeContactId=this.value;STATE.manualEmail=null;render()">'+pocOpts+'</select>':'')+
        '<div style="text-align:center;font-size:11px;color:var(--text3);margin:10px 0">or enter an email</div>'+
        '<input class="inp" placeholder="name@company.com" id="manual-email-inp" value="'+htmlEsc(STATE.manualEmail||'')+'" oninput="STATE.manualEmail=this.value||null;STATE.composeContactId=null;STATE.composeCompanyId=null;render()"/>'+
        recipientBadge+
      '</div>'+
      '<div class="card cp mb3">'+
        (composeEmails.length?
          '<div class="fgrp" style="margin-bottom:0"><label class="flbl">From</label><select class="sel" onchange="selectComposeFromEmail(this.value)">'+composeFromOpts+'</select></div>'
          :'<div style="font-size:12px;color:var(--amber)">No sending email ID assigned — ask your admin to add one.</div>')+
      '</div>'+
      (STATE.composeContext==='reminder'?
        '<div class="card cp mb3">'+
          '<div class="fw6 mb2" style="font-size:13px">Reminder templates</div>'+
          '<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px">Pick a template (fills from the lead), edit if needed, then Send. It goes through the email engine.</div>'+
          REMINDER_TEMPLATES.map(function(t,i){return '<button type="button" class="btn btn-outline btn-sm" style="margin:0 6px 6px 0" onclick="applyReminderTemplate('+i+')">'+escHtml(t.name)+'</button>';}).join('')+
        '</div>':'')+
      '<div class="card cp mb3">'+
        '<div class="fgrp"><label class="flbl">Subject</label><input class="inp" id="email-subj" value="'+htmlEsc(STATE.composeSubj)+'" oninput="STATE.composeSubj=this.value" placeholder="Email subject"/></div>'+
        '<div class="fgrp"><label class="flbl">Message</label><textarea class="txta w100" style="min-height:180px" id="email-body" oninput="STATE.composeBody=this.value" placeholder="Write your message here...">'+htmlEsc(STATE.composeBody)+'</textarea></div>'+
        '<div style="display:flex;justify-content:flex-end;margin-top:12px">'+
          '<button class="btn btn-primary" onclick="'+(STATE.composeContext==='reminder'?'sendReminderViaEngine()':'sendEmail()')+'" '+((hasRecipient&&composeEmails.length)?'':'disabled style="opacity:.5;cursor:not-allowed"')+'>'+ico('send',13)+' Send</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }



  // OOO reminder cards for dashboard
  var today=todayIST();
  var oooReminders=(STATE.reminders||[]).filter(function(r){
    return r.reminder_type==='ooo_return'&&r.status==='pending';
  }).sort(function(a,b){return a.return_date>b.return_date?1:-1;});
  var dueOOO=oooReminders.filter(function(r){return r.return_date<=today;});
  var upcomingOOO=oooReminders.filter(function(r){return r.return_date>today;});

  var oooCards='';
  if(dueOOO.length){
    oooCards+='<div style="margin-bottom:16px">';
    oooCards+=dueOOO.map(function(r){
      var cid=(r.contact&&r.contact.id)||null;
      return '<div style="background:var(--green-l);border:1.5px solid var(--green);border-radius:var(--r2);padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px">'+
        '<div style="font-size:20px">🟢</div>'+
        '<div style="flex:1">'+
          '<div style="font-weight:600;font-size:13px;color:var(--text)">'+htmlEsc(r.contact_name||'Contact')+' has returned from OOO</div>'+
          '<div style="font-size:12px;color:var(--text2);margin-top:2px">'+htmlEsc(r.company_name||'')+(r.return_date?' \u00b7 Returned '+htmlEsc(r.return_date):'')+'</div>'+
        '</div>'+
        (cid?'<button onclick="composeReminderEmail(\''+r.id+'\',\''+cid+'\')" style="background:var(--green);color:#fff;border:0;padding:6px 12px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer">Compose Email</button>':'')+
        '<button onclick="dismissReminder(\''+r.id+'\')" style="background:transparent;border:1px solid var(--green);color:var(--green);padding:6px 10px;border-radius:7px;font-size:12px;cursor:pointer">Dismiss</button>'+
      '</div>';
    }).join('')+'</div>';
  }
  if(upcomingOOO.length){
    oooCards+='<div style="background:var(--amber-l);border:1px solid var(--amber);border-radius:var(--r2);padding:10px 14px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:600;color:var(--amber);margin-bottom:6px">⏰ Upcoming OOO Returns ('+upcomingOOO.length+')</div>'+
      upcomingOOO.slice(0,3).map(function(r){
        return '<div style="font-size:12px;color:var(--text2);padding:3px 0;border-bottom:1px solid rgba(0,0,0,.05)">'+
          htmlEsc(r.contact_name||'')+(r.company_name?' \u00b7 '+htmlEsc(r.company_name):'')+'<span style="float:right;color:var(--amber);font-weight:600">'+htmlEsc(r.return_date)+'</span>'+
        '</div>';
      }).join('')+
    '</div>';
  }

  // BD today summary card
  var bdSummaryCard='';
  if((u.role==='bd'||u.role==='bd_lead')&&STATE.todaySummary&&STATE.todaySummary.total>0){
    bdSummaryCard=renderTodaySummaryCard(STATE.todaySummary);
  }

  return '<div class="page">'+
    (oooCards?'<div style="padding:0 24px;padding-top:16px">'+oooCards+'</div>':'')+
    (bdSummaryCard?'<div style="padding:0 24px;padding-top:16px">'+bdSummaryCard+'</div>':'')+
    '<div class="ph"><div class="ptitle">Email</div>'+
      '<div class="psub">'+(isBD?'Compose emails or manage your outreach plan':'Email')+' · '+u.name+'</div>'+
    '</div>'+
    pausedBanner+
    progressBar+
    '<div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:18px;overflow-x:auto">'+tabBar+'</div>'+
    (STATE.emailTab==='pending'?pendingHtml:'')+
    (STATE.emailTab==='compose'?composeHtml:'')+
    (STATE.emailTab==='sent'?sentHtml:'')+
    (STATE.emailTab==='outreachplan'?tmplHtml:'')+
    (STATE.emailTab==='sequence'?renderSequenceBody():'')+
  '</div>';
}

