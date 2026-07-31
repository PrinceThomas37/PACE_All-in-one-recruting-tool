// ── REMINDERS ─────────────────────────────────
function renderReminders(){
  var u=STATE.user;
  var today=todayIST();
  // API returns user_id, return_date, reminder_time, contact_name, company_name
  var myReminders=(STATE.reminders||[]).filter(function(r){return r.user_id===u.id;});
  var due=myReminders.filter(function(r){return r.status==='pending'&&r.return_date<=today;});
  var upcoming=myReminders.filter(function(r){return r.status==='pending'&&r.return_date>today;});
  var sent=myReminders.filter(function(r){return r.status==='sent';});

  function daysUntil(d){return Math.ceil((new Date(d)-new Date(today))/86400000);}

  var dueCards=due.map(function(r){
    var contactId=(r.contact&&r.contact.id)||null;
    var isOOO=r.reminder_type==='ooo_return';
    return '<div style="border:2px solid var(--amber);border-radius:var(--r2);padding:14px 16px;margin-bottom:10px;background:var(--amber-l)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<div style="width:8px;height:8px;border-radius:50%;background:var(--amber)"></div>'+
          '<div style="font-weight:600;font-size:14px">'+htmlEsc(r.contact_name||'Reminder')+'</div>'+
          '<span style="font-size:11px;padding:2px 7px;background:var(--amber);color:#fff;border-radius:10px">'+(isOOO?'OOO Return':'Due today')+'</span>'+
        '</div>'+
        '<div style="display:flex;gap:8px">'+
          (contactId?'<button class="btn btn-sm" style="background:var(--amber);color:#fff" onclick="composeReminderEmail(\''+r.id+'\',\''+contactId+'\')">'+ico('send',13)+' Compose email</button>':'')+
          '<button class="btn btn-outline btn-sm" onclick="dismissReminder(\''+r.id+'\')">Dismiss</button>'+
        '</div>'+
      '</div>'+
      '<div style="font-size:12px;color:var(--text2)">'+htmlEsc(r.company_name||'')+(r.email?' · '+htmlEsc(r.email):'')+'</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-top:3px">Return date: '+htmlEsc(r.return_date||'')+' · '+htmlEsc(r.reminder_time||'09:00')+' IST</div>'+
      (r.note?'<div style="font-size:12px;margin-top:6px;padding:6px 8px;background:rgba(0,0,0,.04);border-radius:var(--r)">'+htmlEsc(r.note)+'</div>':'')+
    '</div>';
  }).join('');

  var upcomingRows=upcoming.map(function(r){
    var days=daysUntil(r.return_date);
    var isOOO=r.reminder_type==='ooo_return';
    return '<tr>'+
      '<td><div style="font-weight:500;font-size:13px">'+htmlEsc(r.contact_name||'—')+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+htmlEsc(r.company_name||'')+'</div></td>'+
      '<td style="font-size:12px;color:var(--text3)">'+htmlEsc(r.email||'—')+'</td>'+
      '<td>'+(isOOO?'<span style="font-size:11px;padding:2px 7px;background:var(--amber-l);color:var(--amber);border-radius:8px;font-weight:600">OOO Return</span>':'<span style="font-size:11px;padding:2px 7px;background:var(--accent-l);color:var(--accent);border-radius:8px">Follow-up</span>')+'</td>'+
      '<td><span style="font-size:11.5px;padding:2px 8px;background:'+(days<=3?'var(--red-l)':'var(--accent-l)')+';color:'+(days<=3?'var(--red)':'var(--accent)')+';border-radius:10px">'+days+' day'+(days!==1?'s':'')+'</span></td>'+
      '<td style="font-size:12px;color:var(--text3)">'+htmlEsc(r.return_date||'')+'</td>'+
      '<td style="font-size:12px;color:var(--text3)">'+htmlEsc(r.reminder_time||'09:00')+'</td>'+
      '<td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+htmlEsc(r.note||'')+'</td>'+
      '<td><button class="btn btn-outline btn-xs" onclick="dismissReminder(\''+r.id+'\')">Remove</button></td>'+
    '</tr>';
  }).join('');

  var sentRows=sent.slice(0,10).map(function(r){
    return '<tr>'+
      '<td style="font-size:12px">'+htmlEsc(r.contact_name||'—')+'</td>'+
      '<td style="font-size:12px;color:var(--text3)">'+htmlEsc(r.company_name||'')+'</td>'+
      '<td style="font-size:12px;color:var(--text3)">'+htmlEsc(r.return_date||'')+'</td>'+
      '<td><span style="font-size:11px;padding:2px 7px;background:var(--green-l);color:var(--green);border-radius:8px">Done</span></td>'+
    '</tr>';
  }).join('');

  return '<div class="page">'+
    '<div class="ph" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">'+
      '<div><div class="ptitle">Reminders</div>'+
        '<div class="psub">Follow-up reminders · '+myReminders.filter(function(r){return r.status==="pending";}).length+' pending</div></div>'+
      '<div style="display:flex;gap:8px">'+
        '<button class="btn btn-outline btn-sm" onclick="remOpenMeeting()">📅 Schedule a meeting</button>'+
        '<button class="btn btn-primary btn-sm" onclick="remOpenAdd()">+ Add reminder</button>'+
      '</div>'+
    '</div>'+

    (due.length?
      '<div style="background:var(--amber-l);border:1.5px solid var(--amber);border-radius:var(--r2);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">'+
        '<div style="font-size:20px">\u23f0</div>'+
        '<div style="flex:1"><div style="font-weight:600;font-size:14px">'+due.length+' reminder'+(due.length>1?'s':'')+' due today</div>'+
          '<div style="font-size:12px;color:var(--text3)">These contacts are expected back — send your follow-up now.</div></div>'+
      '</div>'
    :'')+
    dueCards+

    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:18px">'+
      '<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:600;font-size:13px">Upcoming reminders ('+upcoming.length+')</div>'+
      (upcoming.length?
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'+
          '<thead style="background:var(--bg);color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.5px">'+
            '<tr><th style="padding:10px 12px;text-align:left">Contact</th><th style="padding:10px 12px;text-align:left">Email</th><th style="padding:10px 12px;text-align:left">Type</th><th style="padding:10px 12px;text-align:left">In</th><th style="padding:10px 12px;text-align:left">Date</th><th style="padding:10px 12px;text-align:left">Time</th><th style="padding:10px 12px;text-align:left">Note</th><th style="padding:10px 12px"></th></tr>'+
          '</thead>'+
          '<tbody>'+upcomingRows+'</tbody>'+
        '</table></div>'
      :'<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">No upcoming reminders.</div>')+
    '</div>'+

    (sent.length?
      '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">'+
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:600;font-size:13px;color:var(--text3)">Recently dismissed ('+sent.length+')</div>'+
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'+
          '<thead style="background:var(--bg);color:var(--text3);font-size:11px;text-transform:uppercase">'+
            '<tr><th style="padding:10px 12px;text-align:left">Contact</th><th style="padding:10px 12px;text-align:left">Company</th><th style="padding:10px 12px;text-align:left">Date</th><th style="padding:10px 12px;text-align:left">Status</th></tr>'+
          '</thead>'+
          '<tbody>'+sentRows+'</tbody>'+
        '</table></div>'+
      '</div>'
    :'')+
  '</div>';
}

// ── Add reminder ──────────────────────────────
function remField(lbl,inner){return '<div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">'+lbl+'</label>'+inner+'</div>';}
window.remOpenAdd=function(){
  var t=todayIST();
  STATE.modal='<div class="modal" onclick="event.stopPropagation()" style="max-width:440px">'+
    '<div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:15px">Add reminder</div>'+
    '<div style="padding:16px 20px;display:grid;gap:12px">'+
      remField('Who','<input id="rem-name" class="inp" placeholder="Contact or candidate name"/>')+
      remField('Company','<input id="rem-co" class="inp" placeholder="Company (optional)"/>')+
      remField('Email','<input id="rem-email" class="inp" type="email" placeholder="Email (optional)"/>')+
      '<div style="display:flex;gap:10px"><div style="flex:1">'+remField('Date','<input id="rem-date" class="inp" type="date" value="'+t+'"/>')+'</div>'+
        '<div style="width:120px">'+remField('Time · IST','<input id="rem-time" class="inp" type="time" value="09:00"/>')+'</div></div>'+
      remField('Note','<textarea id="rem-note" class="inp" style="min-height:70px;resize:vertical" placeholder="What to follow up on"></textarea>')+
    '</div>'+
    '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="remSaveAdd()">Add reminder</button></div>'+
  '</div>';
  render();
};
window.remSaveAdd=function(){
  var name=((document.getElementById('rem-name')||{}).value||'').trim();
  var date=(document.getElementById('rem-date')||{}).value||'';
  if(!name){showToast('Add a name','error');return;}
  if(!date){showToast('Pick a date','error');return;}
  apiPost('/reminders',{contact_name:name,company_name:(document.getElementById('rem-co')||{}).value||'',email:(document.getElementById('rem-email')||{}).value||'',return_date:date,reminder_time:(document.getElementById('rem-time')||{}).value||'09:00',note:(document.getElementById('rem-note')||{}).value||'',reminder_type:'manual'})
    .then(function(){showToast('Reminder added','success');closeModal();if(window.loadReminders)loadReminders();})
    .catch(function(e){showToast('Failed: '+(e&&e.message||e),'error');});
};

// ── Schedule a meeting ────────────────────────
// Universal person search over candidates (loaded once) + lead contacts, a
// platform picker (Teams live; Zoom/Meet coming soon), Teams link creation, then
// an editable email preview → send + a reminder row.
window.remOpenMeeting=function(){
  var t=todayIST();
  STATE._meeting={ name:'', email:'', q:'', subject:'', date:t, time:'10:00', minutes:'30', joinUrl:'', emailSubject:'', emailBody:'' };
  if(!STATE._meetingCands){ apiGet('/candidates').then(function(d){STATE._meetingCands=d||[];if(STATE._meeting)remRenderMeeting();}).catch(function(){STATE._meetingCands=[];}); }
  remRenderMeeting();
};
function remPeople(q){
  q=(q||'').toLowerCase().trim();
  var out=[];
  (STATE._meetingCands||[]).forEach(function(c){var nm=c.full_name||c.name||'';var em=c.email||'';if(!em)return;if(!q||nm.toLowerCase().indexOf(q)>-1||em.toLowerCase().indexOf(q)>-1)out.push({type:'Candidate',name:nm,email:em});});
  (STATE.jobs||[]).forEach(function(j){(jobContacts(j.id)||[]).forEach(function(c){var nm=((c.first_name||'')+' '+(c.last_name||'')).trim();var em=c.email||'';if(!em)return;if(!q||nm.toLowerCase().indexOf(q)>-1||em.toLowerCase().indexOf(q)>-1)out.push({type:'Client',name:nm||j.company_name,email:em});});});
  var seen={};return out.filter(function(p){if(seen[p.email])return false;seen[p.email]=true;return true;}).slice(0,8);
}
window.remMeetingSet=function(k,v){STATE._meeting[k]=v;};
window.remMeetingSearch=function(v){STATE._meeting.q=v;remRenderMeeting();setTimeout(function(){var s=document.getElementById('mt-q');if(s){s.focus();s.setSelectionRange(s.value.length,s.value.length);}},0);};
window.remPickAttendee=function(name,email){STATE._meeting.name=name;STATE._meeting.email=email;STATE._meeting.q='';remRenderMeeting();};
function remRenderMeeting(){
  var m=STATE._meeting||{};
  if(m.joinUrl){
    STATE.modal='<div class="modal" onclick="event.stopPropagation()" style="max-width:520px">'+
      '<div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:15px">Send meeting invite</div>'+
      '<div style="padding:16px 20px;display:grid;gap:12px">'+
        '<div style="font-size:12px;color:var(--green);background:var(--green-l);padding:8px 10px;border-radius:8px">✓ Teams link created — review the email, then send.</div>'+
        remField('To','<input id="mt-to" class="inp" value="'+escAttr(m.name+' <'+m.email+'>')+'" readonly style="color:var(--text3)"/>')+
        remField('Subject','<input id="mt-esub" class="inp" value="'+escAttr(m.emailSubject)+'"/>')+
        remField('Message','<textarea id="mt-ebody" class="inp" style="min-height:150px;resize:vertical">'+htmlEsc(m.emailBody)+'</textarea>')+
      '</div>'+
      '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="remSendMeeting()">'+ico('send',13)+' Send invite</button></div>'+
    '</div>';
    render();return;
  }
  var people=remPeople(m.q);
  var results=(m.q&&people.length)?'<div style="border:1px solid var(--border);border-radius:8px;margin-top:4px;max-height:170px;overflow:auto">'+people.map(function(p){return '<div onclick="remPickAttendee(\''+escAttr(p.name)+'\',\''+escAttr(p.email)+'\')" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border);font-size:12.5px" onmouseenter="this.style.background=\'var(--bg)\'" onmouseleave="this.style.background=\'transparent\'"><b>'+htmlEsc(p.name)+'</b> <span style="color:var(--text3)">· '+htmlEsc(p.email)+'</span> <span style="font-size:10px;color:var(--accent)">'+p.type+'</span></div>';}).join('')+'</div>':(m.q?'<div style="font-size:11.5px;color:var(--text3);margin-top:4px">No match — type a name/email above or fill the fields below.</div>':'');
  STATE.modal='<div class="modal" onclick="event.stopPropagation()" style="max-width:520px">'+
    '<div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:15px">Schedule a meeting</div>'+
    '<div style="padding:16px 20px;display:grid;gap:12px">'+
      remField('Find a person <span style="font-weight:400;color:var(--text3);text-transform:none">— candidate or client contact</span>','<input id="mt-q" class="inp" value="'+escAttr(m.q)+'" placeholder="Search by name or email" oninput="remMeetingSearch(this.value)"/>'+results)+
      '<div style="display:flex;gap:10px"><div style="flex:1">'+remField('Name','<input id="mt-name" class="inp" value="'+escAttr(m.name)+'" onchange="remMeetingSet(\'name\',this.value)" placeholder="Attendee name"/>')+'</div>'+
        '<div style="flex:1">'+remField('Email','<input id="mt-email" class="inp" type="email" value="'+escAttr(m.email)+'" onchange="remMeetingSet(\'email\',this.value)" placeholder="attendee@email.com"/>')+'</div></div>'+
      remField('Subject','<input id="mt-subject" class="inp" value="'+escAttr(m.subject)+'" onchange="remMeetingSet(\'subject\',this.value)" placeholder="e.g. Intro call — futé"/>')+
      '<div style="display:flex;gap:10px"><div style="flex:1">'+remField('Date','<input id="mt-date" class="inp" type="date" value="'+escAttr(m.date)+'" onchange="remMeetingSet(\'date\',this.value)"/>')+'</div>'+
        '<div style="width:110px">'+remField('Time','<input id="mt-time" class="inp" type="time" value="'+escAttr(m.time)+'" onchange="remMeetingSet(\'time\',this.value)"/>')+'</div>'+
        '<div style="width:110px">'+remField('Minutes','<select id="mt-min" class="inp" onchange="remMeetingSet(\'minutes\',this.value)">'+['15','30','45','60'].map(function(x){return '<option'+(m.minutes===x?' selected':'')+'>'+x+'</option>';}).join('')+'</select>')+'</div></div>'+
      remField('Platform','<div style="display:flex;gap:8px;flex-wrap:wrap">'+
        '<span style="display:flex;align-items:center;gap:6px;font-size:12.5px;padding:6px 11px;border:1.5px solid var(--accent);border-radius:8px;background:var(--accent-l);color:var(--accent)">✓ Microsoft Teams</span>'+
        '<span style="font-size:12px;padding:6px 11px;border:1px solid var(--border);border-radius:8px;color:var(--text3)">Zoom · soon</span>'+
        '<span style="font-size:12px;padding:6px 11px;border:1px solid var(--border);border-radius:8px;color:var(--text3)">Google Meet · soon</span>'+
      '</div>')+
    '</div>'+
    '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="remCreateMeeting()">Create link & preview email →</button></div>'+
  '</div>';
  render();
}
window.remCreateMeeting=function(){
  var m=STATE._meeting;
  // pull latest field values (in case onchange didn't fire)
  m.name=(document.getElementById('mt-name')||{}).value||m.name;
  m.email=(document.getElementById('mt-email')||{}).value||m.email;
  m.subject=(document.getElementById('mt-subject')||{}).value||m.subject;
  m.date=(document.getElementById('mt-date')||{}).value||m.date;
  m.time=(document.getElementById('mt-time')||{}).value||m.time;
  m.minutes=(document.getElementById('mt-min')||{}).value||m.minutes;
  if(!m.email){showToast('Add the attendee email','error');return;}
  if(!m.date||!m.time){showToast('Pick a date and time','error');return;}
  var start=new Date(m.date+'T'+m.time+':00');
  var subject=m.subject||'Meeting with '+(m.name||'you');
  showToast('Creating Teams link…','info');
  apiPost('/meetings',{start:start.toISOString(),minutes:parseInt(m.minutes,10)||30,subject:subject,platform:'teams'}).then(function(r){
    m.joinUrl=r.joinUrl;
    var whenStr=start.toLocaleString('en-IN',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:true});
    m.emailSubject=subject;
    m.emailBody='Hi '+(m.name||'there')+',\n\nI\'d like to set up a quick meeting.\n\nWhen: '+whenStr+' ('+m.minutes+' min)\nJoin (Microsoft Teams): '+r.joinUrl+'\n\nLooking forward to it.';
    remRenderMeeting();
  }).catch(function(e){
    var msg=(e&&e.message||e)+'';
    if(/no_connected_mailbox/.test(msg))showToast('No connected sending mailbox — connect one under Manager Users → Email IDs first.','error');
    else if(/meetings_permission_missing/.test(msg))showToast('Reconnect your mailbox to grant Teams-meeting permission.','error');
    else showToast('Couldn\'t create the meeting: '+msg,'error');
  });
};
window.remSendMeeting=function(){
  var m=STATE._meeting;
  var subject=(document.getElementById('mt-esub')||{}).value||m.emailSubject;
  var body=(document.getElementById('mt-ebody')||{}).value||m.emailBody;
  apiPost('/candidates/email',{recipients:[{email:m.email,name:m.name}],subject:subject,body:body}).then(function(){
    // also drop a reminder so it shows on the day.
    apiPost('/reminders',{contact_name:m.name||m.email,email:m.email,return_date:m.date,reminder_time:m.time,note:'Meeting · '+m.joinUrl,reminder_type:'meeting'}).catch(function(){});
    showToast('Meeting invite sent','success');closeModal();if(window.loadReminders)loadReminders();
  }).catch(function(e){
    var msg=(e&&e.message||e)+'';
    if(/no_connected_mailbox/.test(msg))showToast('No connected sending mailbox to send from.','error');
    else showToast('Send failed: '+msg,'error');
  });
};

// ── MAIL MERGE MODAL ───────────────────────────
function renderMailMergeModal(){
  var mm=STATE.mailMerge;
  if(!mm||!mm.leads||!mm.leads.length)return"";
  var idx=mm.currentIdx||0;
  var l=mm.leads[idx];
  var co=STATE.companies.find(function(c){return c.id===l.coid})||{};
  var total=mm.leads.length;
  var sent=mm.sent||0;
  var skipped=mm.skipped||0;

  // Current email content — use edited version if available, else build from template
  var current=mm.emails[idx]||{};
  var subj=current.subj||fillEmail(STATE.emailSubj,l,co,STATE.user.name);
  var body=current.body||fillEmail(STATE.emailBody,l,co,STATE.user.name);
  if(!mm.emails[idx])mm.emails[idx]={subj:subj,body:body,sent:false};

  var plt=STATE.user.plt||"Gmail";
  var isSent=mm.emails[idx]&&mm.emails[idx].sent;

  return '<div class="modal" style="width:700px;max-width:98vw;max-height:92vh;display:flex;flex-direction:column">'+
    // Header
    '<div class="mh">'+
      '<div>'+
        '<div class="mt">Mail Merge</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+
          sent+' sent · '+(total-sent-skipped)+' remaining · '+skipped+' skipped'+
        '</div>'+
      '</div>'+
      '<button class="btn-icon" onclick="closeMailMerge()">'+ico("x",14)+'</button>'+
    '</div>'+

    // Progress bar
    '<div style="padding:0 20px;background:var(--card)">'+
      '<div style="height:3px;background:var(--border);border-radius:2px">'+
        '<div style="height:3px;background:var(--accent);border-radius:2px;width:'+(sent/total*100)+'%;transition:width .3s"></div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0">'+
        // Prev arrow
        '<button onclick="mailMergeNav(-1)" '+(idx===0?'disabled style="opacity:.3"':'')+
          ' style="width:32px;height:32px;border-radius:50%;border:1.5px solid var(--border2);background:var(--card);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px">‹</button>'+
        // Lead info
        '<div style="text-align:center;flex:1;padding:0 14px">'+
          '<div style="font-weight:600;font-size:14px">'+htmlEsc(l.fn+' '+l.ln)+'</div>'+
          '<div style="font-size:12px;color:var(--text3)">'+htmlEsc(l.desig||"")+(co.name?' · '+htmlEsc(co.name):'')+'</div>'+
          '<div style="font-size:12px;color:var(--accent);margin-top:2px">'+htmlEsc(l.email||"No email")+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:4px">'+
            (idx+1)+' of '+total+
            (isSent?' · <span style="color:var(--green);font-weight:500">✓ Sent</span>':'')+
          '</div>'+
        '</div>'+
        // Next arrow
        '<button onclick="mailMergeNav(1)" '+(idx>=total-1?'disabled style="opacity:.3"':'')+
          ' style="width:32px;height:32px;border-radius:50%;border:1.5px solid var(--border2);background:var(--card);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px">›</button>'+
      '</div>'+
    '</div>'+

    // Email editor
    '<div class="mb_" style="flex:1;overflow-y:auto;padding:16px 20px">'+
      '<div class="fgrp">'+
        '<label class="flbl">To</label>'+
        '<input class="inp" value="'+htmlEsc((l.fn||"")+" "+(l.ln||"")+" <"+(l.email||"")+">")+'" readonly style="background:var(--bg);color:var(--text2)"/>'+
      '</div>'+
      '<div class="fgrp">'+
        '<label class="flbl">Subject</label>'+
        '<input class="inp" id="mm-subj" value="'+htmlEsc(subj)+'" oninput="mailMergeEdit(\'subj\',this.value)"/>'+
      '</div>'+
      '<div class="fgrp">'+
        '<label class="flbl">Body</label>'+
        '<textarea class="txta w100" style="min-height:180px;font-size:13px" id="mm-body" oninput="mailMergeEdit(\'body\',this.value)">'+htmlEsc(body)+'</textarea>'+
      '</div>'+
    '</div>'+

    // Footer
    '<div class="mf" style="justify-content:space-between">'+
      '<div class="flex gap2">'+
        '<button class="btn btn-outline btn-sm" onclick="mailMergeSkip()" '+(isSent?'disabled style="opacity:.4"':'')+'>Skip</button>'+
        '<div class="flex gap1">'+
          '<button class="fc'+(plt==="Gmail"?" on":"")+'" onclick="setPlatform(\'Gmail\')">Gmail</button>'+
          '<button class="fc'+(plt==="Outlook"?" on":"")+'" onclick="setPlatform(\'Outlook\')">Outlook</button>'+
        '</div>'+
      '</div>'+
      '<div class="flex gap2">'+
        (isSent?
          '<span style="font-size:13px;color:var(--green);font-weight:500">✓ Sent</span>':
          '<button class="btn btn-primary" onclick="mailMergeSend()" '+(l.email?'':'disabled style="opacity:.4" title="No email address"')+'>'+ico("send",13)+' Send this email</button>'
        )+
        (idx<total-1?
          '<button class="btn btn-outline" onclick="mailMergeNav(1)">Next →</button>':
          '<button class="btn btn-outline" style="color:var(--green);border-color:var(--green)" onclick="closeMailMerge()">✓ Done</button>'
        )+
      '</div>'+
    '</div>'+
  '</div>';
}
function renderSetReminderModal(leadId, manualEmail){
  var lead=leadId?STATE.leads.find(function(l){return l.id===leadId}):null;
  var co=lead?STATE.companies.find(function(c){return c.id===lead.coid})||{}:{};
  var future=new Date();future.setDate(future.getDate()+7);
  var futureStr=future.toISOString().split("T")[0];
  var displayName=lead?(lead.fn+" "+lead.ln):(manualEmail||"");
  var displaySub=lead?(lead.desig+(co.name?" · "+co.name:"")+" · "+lead.email):(manualEmail||"");

  return '<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Set reminder</div><button class="btn-icon" onclick="closeModal()">'+ico("x",14)+'</button></div>'+
    '<div class="mb_">'+
      '<div style="padding:10px 12px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:16px;border:1px solid rgba(37,99,235,.15)">'+
        '<div class="fw5 f13">'+htmlEsc(displayName)+'</div>'+
        '<div class="f12 text3">'+htmlEsc(displaySub)+'</div>'+
      '</div>'+
      '<div class="g2 mb3">'+
        '<div class="fgrp"><label class="flbl">Return / follow-up date</label><input class="inp" type="date" id="rem-date" value="'+futureStr+'"/></div>'+
        '<div class="fgrp"><label class="flbl">Reminder time (IST)</label><input class="inp" type="time" id="rem-time" value="09:00"/></div>'+
      '</div>'+
      '<div class="fgrp"><label class="flbl">Note (optional)</label><textarea class="txta" id="rem-note" style="min-height:60px" placeholder="e.g. They are back from holiday after 15th"></textarea></div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="saveReminder(\''+( leadId||"")+'\',' +(manualEmail?'\''+manualEmail+'\'':'null')+')">Set reminder</button>'+
    '</div>'+
  '</div>';
}

// ── PROFILE ──────────────────────────────────
function renderProfile(){
  var u=STATE.user;
  var pltOpts=["Gmail","Outlook"].map(function(p){
    var sel=u.plt===p;
    return '<div onclick="setProfilePlt(\''+p+'\')" style="display:flex;align-items:center;gap:11px;padding:12px 13px;border:2px solid '+(sel?"var(--accent)":"var(--border)")+';border-radius:var(--r2);cursor:pointer;margin-bottom:8px;background:'+(sel?"var(--accent-l)":"var(--card)")+';transition:all .12s">'+
      '<div style="width:22px;height:22px;border-radius:5px;background:'+(sel?"var(--accent)":"var(--bg)")+';display:flex;align-items:center;justify-content:center">'+ico("email",13)+'</div>'+
      '<div style="flex:1"><div style="font-weight:500;font-size:13.5px;color:'+(sel?"var(--accent)":"var(--text)")+'">'+p+'</div><div class="f12 text3">'+(p==="Gmail"?"Google Workspace":"Microsoft 365")+'</div></div>'+
      (sel?'<div style="width:16px;height:16px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="#fff" stroke-width="1.6"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg></div>':"")+
    '</div>';
  }).join("");

  return '<div class="page">'+
    '<div class="ph"><div class="ptitle">My Profile</div><div class="psub">Manage your account details</div></div>'+
    '<div class="g2">'+
      '<div>'+
        '<div class="card cp mb4">'+
          '<div class="flex aic gap4 mb4">'+av(u,"48")+
            '<div><div style="font-family:var(--display);font-weight:600;font-size:18px">'+u.name+'</div>'+
            '<div class="text3 f12 mt1">'+roleLabel(u.role)+' · '+u.empId+'</div>'+
            '<span class="bdg '+(u.role==="admin"?"bdg-purple":u.role==="bd"?"bdg-blue":"bdg-green")+' mt1">'+roleLabel(u.role)+'</span></div>'+
          '</div>'+
          '<div class="hr"></div>'+
          '<div class="g2 mb3"><div class="fgrp"><label class="flbl">Full name</label><input class="inp" id="p-name" value="'+htmlEsc(u.name)+'"/></div><div class="fgrp"><label class="flbl">Work email</label><input class="inp" id="p-email" value="'+htmlEsc(u.email)+'"/></div></div>'+
          '<div class="g2 mb3"><div class="fgrp"><label class="flbl">Employee ID</label><input class="inp" id="p-eid" value="'+htmlEsc(u.empId)+'"/></div><div class="fgrp"><label class="flbl">Designation</label><input class="inp" id="p-desig" value="'+htmlEsc(u.desig)+'"/></div></div>'+
          '<button class="btn btn-primary" onclick="saveProfile()">Save changes</button>'+
        '</div>'+
        '<div class="card cp">'+
          '<div class="fw6 mb1">Change password</div>'+
          '<div class="fgrp mt3"><label class="flbl">Current password</label><input class="inp" type="password" id="pw-cur" placeholder="••••••••"/></div>'+
          '<div class="fgrp"><label class="flbl">New password</label><input class="inp" type="password" id="pw-new" placeholder="••••••••"/></div>'+
          '<div class="fgrp"><label class="flbl">Confirm new password</label><input class="inp" type="password" id="pw-con" placeholder="••••••••"/></div>'+
          '<button class="btn btn-outline" onclick="changePassword()">Update password</button>'+
        '</div>'+
      '</div>'+
      '<div>'+
        '<div class="card cp">'+
          '<div class="fw6 mb1">Email platform</div>'+
          '<div class="f12 text3 mb3">Choose your outreach platform. Emails will open in this app when you click Send.</div>'+
          pltOpts+
          '<div style="margin-top:13px;padding:9px 11px;background:var(--bg);border-radius:var(--r);font-size:12px;color:var(--text3)">In production: clicking Connect will open OAuth authorization to send emails from your account.</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
  '</div>';
}

// ── ADD LEAD MODAL ─────────────────────────────
function renderAddLeadModal(){
  var u=STATE.user;
  var bds=u.role==="ra"?STATE.users.filter(function(x){return x.id===u.bdm}):STATE.users.filter(function(x){return x.role==="bd"||x.role==="admin"});
  var ras=u.role==="ra"?[u]:STATE.users.filter(function(x){return x.role==="ra"&&(u.role==="admin"||x.bdm===u.id)});
  var cos=STATE.companies;
  var indOpts=(getIndustriesList().length?getIndustriesList():INDUSTRIES).map(function(i){return'<option>'+htmlEsc(i)+'</option>'}).join("");
  var srcOpts=SOURCES.map(function(s){return'<option>'+s+'</option>'}).join("");
  var raOpts=ras.map(function(r){return'<option value="'+r.id+'">'+r.name+'</option>'}).join("");
  var bdOpts=bds.map(function(b){return'<option value="'+b.id+'">'+b.name+'</option>'}).join("");
  var coOpts='<option value="">— Choose existing —</option>'+cos.map(function(c){return'<option value="'+c.id+'">'+c.name+'</option>'}).join("");
  return '<div class="modal modal-w860">'+
    '<div class="mh"><div class="mt">Add new lead</div><button class="btn-icon" onclick="closeModal()">'+ico("x",14)+'</button></div>'+
    '<div class="mb_">'+
      '<div style="padding:12px 14px;background:var(--bg);border-radius:var(--r2);margin-bottom:14px">'+
        '<div class="fw5 f13 mb2">Company</div>'+
        '<div class="flex gap2 mb3"><button class="fc on" id="co-new-btn" onclick="toggleCoMode(true)">New company</button><button class="fc" id="co-exist-btn" onclick="toggleCoMode(false)">Existing company</button></div>'+
        '<div id="co-new-fields">'+
          '<div class="g3"><div class="fgrp"><label class="flbl">Company name <span style="color:var(--red)">*</span></label><input class="inp" id="f-coname" placeholder="e.g. Acme Corp"/></div>'+
          '<div class="fgrp"><label class="flbl">Website</label><input class="inp" id="f-web" placeholder="acme.com"/></div>'+
          '<div class="fgrp"><label class="flbl">Industry</label><select class="sel" id="f-ind">'+indOpts+'</select></div>'+
          '<div class="fgrp"><label class="flbl">Location</label><input class="inp" id="f-loc" placeholder="City"/></div></div>'+
        '</div>'+
        '<div id="co-exist-fields" style="display:none"><div class="fgrp"><label class="flbl">Select company</label><select class="sel" id="f-coid">'+coOpts+'</select></div></div>'+
      '</div>'+
      '<div class="fw5 f13 mb3">Point of Contact</div>'+
      '<div class="g3 mb4">'+
        '<div class="fgrp"><label class="flbl">First name <span style="color:var(--red)">*</span></label><input class="inp" id="f-fn"/></div>'+
        '<div class="fgrp"><label class="flbl">Last name</label><input class="inp" id="f-ln"/></div>'+
        '<div class="fgrp"><label class="flbl">Designation</label><input class="inp" id="f-desig" placeholder="e.g. CTO"/></div>'+
        '<div class="fgrp span2"><label class="flbl">Email ID <span style="color:var(--red)">*</span></label><input class="inp" id="f-email" type="email"/></div>'+
        '<div class="fgrp"><label class="flbl">Phone</label><input class="inp" id="f-phone" type="tel"/></div>'+
        '<div class="fgrp span3"><label class="flbl">LinkedIn URL</label><input class="inp" id="f-li" placeholder="linkedin.com/in/..."/></div>'+
      '</div>'+
      '<div class="fw5 f13 mb3">Job opening</div>'+
      '<div class="g3 mb4">'+
        '<div class="fgrp span2"><label class="flbl">Position / Role <span style="color:var(--red)">*</span></label><input class="inp" id="f-pos" placeholder="e.g. VP of Engineering"/></div>'+
        '<div class="fgrp"><label class="flbl">Source</label><select class="sel" id="f-src">'+srcOpts+'</select></div>'+
      '</div>'+
      '<div class="g2">'+
        '<div class="fgrp"><label class="flbl">Research Analyst</label><select class="sel" id="f-ra"'+(u.role==="ra"?" disabled":"")+'>'+raOpts+'</select></div>'+
        '<div class="fgrp"><label class="flbl">BD Manager</label><select class="sel" id="f-bd"'+(u.role==="ra"?" disabled":"")+'>'+bdOpts+'</select></div>'+
      '</div>'+
    '</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveLead()">Save lead</button></div>'+
  '</div>';
}

// ── ADD/EDIT USER MODAL ────────────────────────
function renderUserModal(existing){
  var u=existing||{name:"",email:"",role:"ra",empId:"FG-0"+(STATE.users.length+1),desig:"",bdm:"",plt:"Gmail"};
  var bds=STATE.users.filter(function(x){return x.role==="bd"||x.role==="admin";});
  var bdOpts='<option value="">— Unassigned —</option>'+bds.map(function(b){return'<option value="'+b.id+'"'+(u.bdm===b.id?" selected":"")+'>'+b.name+'</option>';}).join("");
  // Only show BD assignment field if role is RA — use onchange to show/hide dynamically
  var isRA=u.role==="ra";
  return '<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">'+(existing?"Edit user":"Add new user")+'</div><button class="btn-icon" onclick="closeModal()">'+ico("x",14)+'</button></div>'+
    '<div class="mb_">'+
      '<div class="g2 mb3">'+
        '<div class="fgrp"><label class="flbl">Full name <span style="color:var(--red)">*</span></label><input class="inp" id="u-name" value="'+htmlEsc(u.name)+'"/></div>'+
        '<div class="fgrp"><label class="flbl">Work email <span style="color:var(--red)">*</span></label><input class="inp" id="u-email" type="email" value="'+htmlEsc(u.email)+'"/></div>'+
      '</div>'+
      '<div class="g2 mb3">'+
        '<div class="fgrp"><label class="flbl">Employee ID</label><input class="inp" id="u-eid" value="'+htmlEsc(u.empId)+'"/></div>'+
        '<div class="fgrp"><label class="flbl">Designation</label><input class="inp" id="u-desig" value="'+htmlEsc(u.desig)+'"/></div>'+
      '</div>'+
      '<div class="g2 mb3">'+
        '<div class="fgrp"><label class="flbl">Role</label>'+
          '<select class="sel" id="u-role" onchange="toggleBDAssign(this.value)">'+
            '<option value="ra"'+(u.role==="ra"?" selected":"")+'>Research Analyst</option>'+
            '<option value="ra_lead"'+(u.role==="ra_lead"?" selected":"")+'>RA Team Lead</option>'+
            '<option value="bd"'+(u.role==="bd"?" selected":"")+'>BD Manager</option>'+
            '<option value="bd_lead"'+(u.role==="bd_lead"?" selected":"")+'>BD Team Lead</option>'+
            '<option value="admin"'+(u.role==="admin"?" selected":"")+'>Admin</option>'+
            '<option value="recruiter"'+(u.role==="recruiter"?" selected":"")+'>Recruiter</option>'+
          '</select>'+
        '</div>'+
        '<div class="fgrp"><label class="flbl">Email platform</label><select class="sel" id="u-plt"><option'+(u.plt==="Gmail"?" selected":"")+'>Gmail</option><option'+(u.plt==="Outlook"?" selected":"")+'>Outlook</option></select></div>'+
      '</div>'+
      '<div class="fgrp" id="u-bd-wrap" style="'+(isRA?"":"display:none")+'">'+
        '<label class="flbl">Assigned BD Manager <span style="font-size:11px;color:var(--text3)">(only for Research Analysts)</span></label>'+
        '<select class="sel" id="u-bd">'+bdOpts+'</select>'+
      '</div>'+
    '</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveUser('+(existing?'\''+existing.id+'\'':null)+')">'+( existing?"Save changes":"Add user")+'</button></div>'+
  '</div>';
}

// ── TOASTS & MODAL ─────────────────────────────
function renderToasts(){
  var tc={success:"var(--green)",error:"var(--red)",info:"var(--accent)",warning:"var(--amber)"};
  return '<div class="toast-wrap">'+STATE.toasts.map(function(t){
    var c=tc[t.type]||tc.info;
    return'<div class="toast" style="border-left:3px solid '+c+'"><div style="width:7px;height:7px;border-radius:50%;background:'+c+';flex-shrink:0"></div>'+htmlEsc(t.msg)+'</div>';
  }).join("")+'</div>';
}
function renderModal(){
  if(STATE.modal&&STATE.modal.type==="jobDetail")return renderJobDetailModal();
  if(STATE.modal&&STATE.modal.type==="addJob")return renderAddJobModal();
  if(STATE.modal&&STATE.modal.type==="addContact")return renderAddContactModal();
  if(STATE.mailMerge&&!STATE.modal)return'<div class="overlay">'+renderMailMergeModal()+'</div>';
  if(!STATE.modal)return"";
  return'<div class="overlay" onclick="overlayClick(event)">'+STATE.modal+'</div>';
}

function normalizeIndustry(raw){
  if(!raw)return'Other';
  var r=raw.toLowerCase();
  if(r.indexOf('engineer')>-1||r.indexOf('manufactur')>-1||r.indexOf('construction')>-1||r.indexOf('civil')>-1||r.indexOf('mechanical')>-1||r.indexOf('oil')>-1||r.indexOf('gas')>-1||r.indexOf('aerospace')>-1||r.indexOf('aviation')>-1||r.indexOf('transportation')>-1||r.indexOf('logistics')>-1||r.indexOf('real estate')>-1||r.indexOf('architecture')>-1||r.indexOf('industrial')>-1||r.indexOf('defense')>-1||r.indexOf('machinery')>-1||r.indexOf('automation')>-1)return'Engineering';
  if(r.indexOf('health')>-1||r.indexOf('medical')>-1||r.indexOf('pharma')>-1||r.indexOf('hospital')>-1||r.indexOf('wellness')>-1||r.indexOf('fitness')>-1||r.indexOf('biotech')>-1||r.indexOf('dental')>-1||r.indexOf('clinical')>-1)return'Healthcare';
  if(r.indexOf('legal')>-1||r.indexOf('law')>-1||r.indexOf('attorney')>-1||r.indexOf('compliance')>-1||r.indexOf('litigation')>-1)return'Legal';
  if(r.indexOf('account')>-1||r.indexOf('financ')>-1||r.indexOf('audit')>-1||r.indexOf('tax')>-1||r.indexOf('bookkeep')>-1||r.indexOf('cpa')>-1)return'Accounting';
  if(r.indexOf('manag')>-1||r.indexOf('consult')>-1||r.indexOf('staffing')>-1||r.indexOf('recruit')>-1||r.indexOf('human resource')>-1||r.indexOf('executive')>-1||r.indexOf('strategy')>-1)return'Management';
  return'Other';
}
function htmlEsc(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

