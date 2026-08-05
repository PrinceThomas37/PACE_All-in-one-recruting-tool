// ════════════════════════════════════════════════
// MAIL MERGE ENGINE
// ════════════════════════════════════════════════
window.openMailMerge=function(ids){
  if(!ids||!ids.length)return;
  var leads=ids.map(function(id){return STATE.leads.find(function(l){return l.id===id;});}).filter(function(l){return l&&l.email;});
  if(!leads.length){showToast("No email addresses in selected leads","warning");return;}

  // Build per-lead email drafts
  var queue=leads.map(function(l){
    var co=STATE.companies.find(function(c){return c.id===l.coid;})||{name:l.coName,ind:l.coInd,loc:l.coLoc};
    return{
      lid:l.id,
      name:l.fn+" "+l.ln,
      desig:l.desig,
      company:co.name||l.coName||"",
      email:l.email,
      subj:fillEmail(STATE.emailSubj,l,co,STATE.user.name),
      body:fillEmail(STATE.emailBody,l,co,STATE.user.name),
      status:"pending"
    };
  });

  STATE.mailMerge={queue:queue,index:0};
  STATE.modal=renderMailMergeModal();
  render();
};

function renderMailMergeModal(){
  var mm=STATE.mailMerge;
  if(!mm)return"";
  var q=mm.queue;
  var i=mm.index;
  var current=q[i];
  var total=q.length;
  var sentCount=q.filter(function(x){return x.status==="sent";}).length;
  var plt=STATE.user.plt||"Gmail";
  var allDone=q.every(function(x){return x.status==="sent"||x.status==="skipped";});

  return '<div class="modal" style="width:680px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column">'+
    // Header
    '<div class="mh">'+
      '<div>'+
        '<div class="mt">Mail Merge</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+sentCount+' sent · '+(total-sentCount-(q.filter(function(x){return x.status==="skipped";}).length))+' remaining · '+total+' total</div>'+
      '</div>'+
      '<button class="btn-icon" onclick="STATE.mailMerge=null;closeModal()">'+ico("x",14)+'</button>'+
    '</div>'+

    // Progress counter
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 20px;background:var(--bg);border-bottom:1px solid var(--border)">'+
      '<div style="font-size:13px;font-weight:500;color:var(--text2)">Email <span style="color:var(--accent);font-weight:700">'+(i+1)+'</span> of <span style="font-weight:700">'+total+'</span></div>'+
      '<div style="display:flex;gap:6px;align-items:center">'+
        (sentCount>0?'<span style="font-size:12px;padding:2px 8px;background:var(--green-l);color:var(--green);border-radius:10px;font-weight:500">'+sentCount+' sent ✓</span>':"")+
        (q.filter(function(x){return x.status==="skipped";}).length>0?'<span style="font-size:12px;padding:2px 8px;background:var(--bg);color:var(--text3);border-radius:10px">'+q.filter(function(x){return x.status==="skipped";}).length+' skipped</span>':"")+
      '</div>'+
    '</div>'+

    (allDone?
      '<div style="padding:40px;text-align:center">'+
        '<div style="font-size:40px;margin-bottom:12px">✅</div>'+
        '<div style="font-family:var(--display);font-size:18px;font-weight:600;margin-bottom:6px">All done!</div>'+
        '<div style="font-size:13px;color:var(--text3);margin-bottom:20px">'+sentCount+' email'+(sentCount!==1?"s":"")+" sent successfully."+'</div>'+
        '<button class="btn btn-primary" onclick="STATE.mailMerge=null;closeModal()">Close</button>'+
      '</div>'
    :
      '<div style="padding:18px 20px;flex:1;overflow-y:auto">'+
        '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:14px;border:1px solid rgba(37,99,235,.15)">'+
          '<div style="flex:1">'+
            '<div style="font-weight:600;font-size:14px">'+htmlEsc(current.name)+'<span style="font-weight:400;color:var(--text2);font-size:12.5px"> · '+htmlEsc(current.desig||"")+'</span></div>'+
            '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+htmlEsc(current.company)+' · '+htmlEsc(current.email)+'</div>'+
          '</div>'+
          (current.status==="sent"?'<span style="font-size:11px;padding:3px 9px;background:var(--green);color:#fff;border-radius:10px">✓ Sent</span>':"")+
        '</div>'+
        '<div class="fgrp">'+
          '<label class="flbl">Subject</label>'+
          '<input class="inp" id="mm-subj" value="'+htmlEsc(current.subj)+'" oninput="mmUpdateSubj(this.value)" onfocus="setVarInsertTarget(\'subject\')"/>'+
        '</div>'+
        '<div class="fgrp">'+
          '<label class="flbl">Body</label>'+
          '<textarea class="txta w100" id="mm-body" style="min-height:200px;font-size:13px;line-height:1.6" oninput="mmUpdateBody(this.value)" onfocus="setVarInsertTarget(\'body\')">'+htmlEsc(current.body)+'</textarea>'+
        '</div>'+
        renderVarChipBar('mm-subj','mm-body')+
      '</div>'+

      '<div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--card)">'+
        '<button class="btn btn-outline btn-sm" onclick="mmPrev()" '+(i===0?'disabled style="opacity:.4"':'')+'>← Prev</button>'+
        '<button class="btn btn-outline btn-sm" onclick="mmNext()">Next →</button>'+
        '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" onclick="mmSkipAll()">Skip all</button>'+
        '<div style="flex:1"></div>'+
        '<div class="flex gap1">'+
          '<button class="fc'+(plt==="Gmail"?" on":"")+'" onclick="setPlatform(\'Gmail\')" style="font-size:12px">Gmail</button>'+
          '<button class="fc'+(plt==="Outlook"?" on":"")+'" onclick="setPlatform(\'Outlook\')" style="font-size:12px">Outlook</button>'+
        '</div>'+
        '<button class="btn btn-outline btn-sm" style="color:var(--accent);border-color:var(--accent)" onclick="mmSendAll()" title="Opens all remaining emails at once in '+plt+'">'+
          ico("send",13)+' Send all ('+q.filter(function(x){return x.status==="pending";}).length+')'+
        '</button>'+
        '<button class="btn btn-primary btn-sm" onclick="mmSend()">'+
          ico("send",13)+' Send'+(i<total-1?' & Next':' & Finish')+
        '</button>'+
      '</div>'
    )+
  '</div>';
}

window.mmGoTo=function(idx){
  STATE.mailMerge.index=idx;
  STATE.modal=renderMailMergeModal();render();
};
window.mmPrev=function(){
  if(STATE.mailMerge.index>0){STATE.mailMerge.index--;STATE.modal=renderMailMergeModal();render();}
};
window.mmNext=function(){
  var mm=STATE.mailMerge;
  if(mm.index<mm.queue.length-1){mm.index++;STATE.modal=renderMailMergeModal();render();}
};
window.mmSkip=function(){
  var mm=STATE.mailMerge;
  mm.queue[mm.index].status="skipped";
  var next=mm.queue.findIndex(function(x,idx){return idx>mm.index&&x.status==="pending";});
  if(next>=0)mm.index=next;
  STATE.modal=renderMailMergeModal();render();
};
window.mmSkipAll=function(){
  if(!confirm("Skip all remaining unsent emails?"))return;
  STATE.mailMerge.queue.forEach(function(x){if(x.status==="pending")x.status="skipped";});
  STATE.modal=renderMailMergeModal();render();
};
window.mmSendAll=function(){
  var mm=STATE.mailMerge;
  var pending=mm.queue.filter(function(x){return x.status==="pending";});
  if(!pending.length){showToast("No pending emails","info");return;}
  if(!confirm("Open all "+pending.length+" remaining emails in "+( STATE.user.plt||"Gmail")+"? Your browser may block multiple popups — allow them if prompted."))return;

  var plt=STATE.user.plt||"Gmail";
  var gmailUser=STATE.user.email||"";
  pending.forEach(function(item,idx){
    setTimeout(function(){
      // Sync any edits on current
      if(mm.queue[mm.index]===item){
        var subjEl=document.getElementById("mm-subj");
        var bodyEl=document.getElementById("mm-body");
        if(subjEl)item.subj=subjEl.value;
        if(bodyEl)item.body=bodyEl.value;
      }
      var url;
      if(plt==="Gmail"){
        url="https://mail.google.com/mail/u/0/?authuser="+encodeURIComponent(gmailUser)+
            "&view=cm&to="+encodeURIComponent(item.email)+
            "&su="+encodeURIComponent(item.subj)+
            "&body="+encodeURIComponent(item.body);
      } else {
        url="https://outlook.office.com/mail/deeplink/compose?to="+encodeURIComponent(item.email)+
            "&subject="+encodeURIComponent(item.subj)+
            "&body="+encodeURIComponent(item.body);
      }
      window.open(url,"_blank");
      item.status="sent";
      STATE.emails.push({id:"e"+Date.now()+idx,lid:item.lid,by:STATE.user.id,to:item.email,subj:item.subj,body:item.body,plt:plt,dt:todayIST(),status:"sent"});
    },idx*600); // 600ms gap between each to avoid popup blocker
  });

  // Mark all as sent after delay and refresh
  setTimeout(function(){
    STATE.modal=renderMailMergeModal();render();
    showToast(pending.length+" emails opened in "+plt,"success");
  },pending.length*600+200);
};
window.mmUpdateBody=function(v){if(STATE.mailMerge)STATE.mailMerge.queue[STATE.mailMerge.index].body=v;};

window.mmSend=function(){
  var mm=STATE.mailMerge;
  var current=mm.queue[mm.index];
  var plt=STATE.user.plt||"Gmail";

  // Sync any edits from textarea
  var subjEl=document.getElementById("mm-subj");
  var bodyEl=document.getElementById("mm-body");
  if(subjEl)current.subj=subjEl.value;
  if(bodyEl)current.body=bodyEl.value;

  // Build Gmail URL with user's actual account
  var gmailUser=STATE.user.email||"";
  var url;
  if(plt==="Gmail"){
    // authuser param forces correct Google account
    url="https://mail.google.com/mail/u/0/?authuser="+encodeURIComponent(gmailUser)+
        "&view=cm&to="+encodeURIComponent(current.email)+
        "&su="+encodeURIComponent(current.subj)+
        "&body="+encodeURIComponent(current.body);
  } else {
    url="https://outlook.office.com/mail/deeplink/compose?to="+encodeURIComponent(current.email)+
        "&subject="+encodeURIComponent(current.subj)+
        "&body="+encodeURIComponent(current.body);
  }
  window.open(url,"_blank");

  // Mark sent and log
  current.status="sent";
  STATE.emails.push({id:"e"+Date.now(),lid:current.lid,by:STATE.user.id,to:current.email,subj:current.subj,body:current.body,plt:plt,dt:todayIST(),status:"sent"});
  STATE.activities.push({id:"a"+Date.now(),lid:current.lid,uid:STATE.user.id,type:"email",txt:"Email sent via "+plt+" (mail merge)",dt:todayIST()});

  // Move to next unsent
  var next=mm.queue.findIndex(function(x,idx){return idx>mm.index&&x.status==="pending";});
  if(next>=0){mm.index=next;}
  // else stay on current (all done state will show)

  STATE.modal=renderMailMergeModal();render();
};

// Keep quickSendEmail for single row icon
window.quickSendEmail=function(lid){
  openMailMerge([lid]);
};

window.bulkSendEmail=function(){
  var ids=Object.keys(STATE.leadsSelected).filter(function(id){return STATE.leadsSelected[id];});
  openMailMerge(ids);
};
// Parse date from Excel — handles dd/mm/yyyy, yyyy-mm-dd, Excel serial numbers
function parseExcelDateToISO(v){
  if(!v)return null;
  if(!isNaN(v)){var d=new Date(Math.round((Number(v)-25569)*86400000));return d.toISOString().split('T')[0];}
  var d2=new Date(v);
  if(!isNaN(d2))return d2.toISOString().split('T')[0];
  return null;
}
function parseExcelDate(val){
  if(!val)return todayIST();
  if(typeof val==="number"){var d=new Date((val-25569)*86400000);return d.toISOString().split("T")[0];}
  var s=String(val).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  var m=s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if(m)return m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");
  var d2=new Date(s);
  if(!isNaN(d2))return d2.toISOString().split("T")[0];
  return todayIST();
}

window.triggerImport=function(){
  var el=document.getElementById("xl-import");
  if(el){el.value="";el.click();}
}

window.importXL=function(input){
  if(!input.files||!input.files[0])return;
  var file=input.files[0];
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=new Uint8Array(e.target.result);
      var wb=XLSX.read(data,{type:"array"});
      var sheets=wb.SheetNames;
      STATE.importWB=wb;
      if(sheets.length===1){
        // Only one sheet — go straight to preview
        var ws=wb.Sheets[sheets[0]];
        var rows=XLSX.utils.sheet_to_json(ws,{defval:""});
        if(!rows.length){showToast("No data found in file","warning");return;}
        STATE.importPreview=rows;
        STATE.importSheet=sheets[0];
        STATE.modal=renderImportModal(rows,sheets[0]);
      } else {
        // Multiple sheets — show sheet picker first
        STATE.modal=renderSheetPickerModal(sheets);
      }
      render();
    }catch(err){showToast("Could not read file: "+err.message,"error");}
  };
  reader.readAsArrayBuffer(file);
}

function renderSheetPickerModal(sheets){
  var items=sheets.map(function(s,i){
    return '<div onclick="selectSheet(\''+htmlEsc(s)+'\')" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid var(--border);border-radius:var(--r2);cursor:pointer;margin-bottom:8px;transition:all .12s" onmouseenter="this.style.borderColor=\'var(--accent)\';this.style.background=\'var(--accent-l)\'" onmouseleave="this.style.borderColor=\'var(--border)\';this.style.background=\'\'">'+
      '<div style="width:32px;height:32px;background:var(--accent-l);border-radius:var(--r);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;color:var(--accent)">'+(i+1)+'</div>'+
      '<div><div style="font-weight:500;font-size:13.5px">'+htmlEsc(s)+'</div>'+
      '<div class="f12 text3">Sheet '+(i+1)+' of '+sheets.length+'</div></div>'+
      '<div style="margin-left:auto;color:var(--text3);font-size:18px">›</div>'+
    '</div>';
  }).join("");
  return '<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">Select sheet to import</div><button class="btn-icon" onclick="closeModal()">'+ico("x",14)+'</button></div>'+
    '<div class="mb_">'+
      '<div style="font-size:13px;color:var(--text3);margin-bottom:14px">This file has '+sheets.length+' sheets. Choose which one contains your leads.</div>'+
      items+
    '</div>'+
  '</div>';
}

window.selectSheet=function(sheetName){
  if(!STATE.importWB)return;
  var ws=STATE.importWB.Sheets[sheetName];
  var rows=XLSX.utils.sheet_to_json(ws,{defval:""});
  if(!rows.length){showToast("No data found in sheet: "+sheetName,"warning");return;}
  STATE.importPreview=rows;
  STATE.importSheet=sheetName;
  STATE.modal=renderImportModal(rows,sheetName);
  render();
}

// Column name mapping — accepts many variations
function mapCol(row, keys){
  var r={};
  Object.keys(row).forEach(function(k){
    var kl=k.toLowerCase().replace(/[\s_\-\.]/g,"");
    keys.forEach(function(pair){
      if(pair[0].some(function(v){return kl===v||kl.includes(v);})){
        if(!r[pair[1]])r[pair[1]]=String(row[k]||"").trim();
      }
    });
  });
  return r;
}

var COL_MAP=[
  [["companyname","company","firm","organisation","organization"],"company"],
  [["website","web","url","site"],"website"],
  [["industry","sector","vertical"],"industry"],
  [["location","city","place","region"],"location"],
  [["position","role","jobtitle","jobrole","openrole","vacancy","opening"],"position"],
  [["firstname","fname","first"],"firstName"],
  [["lastname","lname","last","surname"],"lastName"],
  [["designation","title","jobtitle","currenttitle"],"designation"],
  [["email","emailid","emailaddress","mail"],"email"],
  [["contact","phone","mobile","phonenumber","contactno","contactnumber"],"phone"],
  [["linkedin","linkedinurl","linkedinprofile","li"],"linkedin"],
  [["source","leadsource","foundon","platform"],"source"],
  [["date","leaddate","dateadded","createdon"],"date"],
  [["notes","note","comments","remarks"],"notes"],
  [["jobdescription","jobdesc","jd","description","requirements","jobdetails","jobposting","posting"],"jdText"],
  [["analystname","analyst","raname","researchanalyst","ra"],"analystName"],
  [["bdmassigned","bdm","bdmanager","managername","assignedto"],"bdmAssigned"],
  [["salaryrange","salary","compensation","pay","salaryband"],"salaryRange"],
  [["jobcreateddate","jobcreated","datecreated","createdate"],"jobCreatedDate"],
];

function renderImportModal(rows, sheetName){
  var sample=rows.slice(0,3);
  var cols=Object.keys(rows[0]);
  var mapped=rows.map(function(r){return mapCol(r,COL_MAP);});
  var groups=groupImportRows(mapped);
  var totalContacts=groups.reduce(function(s,g){return s+g.contacts.length;},0);
  var skippedRows=rows.length-totalContacts;
  var multiSheet=STATE.importWB&&STATE.importWB.SheetNames.length>1;

  // new companies not yet in STATE
  var newCoNames={};
  groups.forEach(function(g){
    if(!g.coName)return;
    var exists=STATE.companies.find(function(c){return c.name.toLowerCase()===g.coName.toLowerCase();});
    if(!exists)newCoNames[g.coName.toLowerCase()]=1;
  });
  var newCoCnt=Object.keys(newCoNames).length;

  // duplicate jobs (already exist client-side)
  var dupeCnt=0;
  groups.forEach(function(g){
    var exists=STATE.jobs.find(function(j){
      return j.company_name.toLowerCase()===g.coName.toLowerCase()&&
             j.position.toLowerCase()===g.position.toLowerCase();
    });
    if(exists)dupeCnt++;
  });
  var newJobs=groups.length-dupeCnt;

  var colRows=cols.map(function(c){
    var kl=c.toLowerCase().replace(/[\s_\-\.]/g,"");
    var match=COL_MAP.find(function(pair){return pair[0].some(function(v){return kl===v||kl.includes(v);});});
    var status=match?
      '<span style="color:var(--green);font-weight:500">\u2192 '+match[1]+'</span>':
      '<span style="color:var(--text3)">\u2014 not mapped</span>';
    return '<tr><td style="padding:5px 10px;font-size:12.5px">'+htmlEsc(c)+'</td><td style="padding:5px 10px">'+status+'</td></tr>';
  }).join("");

  return '<div class="modal modal-w640">'+
    '<div class="mh">'+
      '<div>'+
        '<div class="mt">Import Jobs from Excel</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:3px">Sheet: <strong style="color:var(--accent)">'+htmlEsc(sheetName||"Sheet1")+'</strong>'+
        (multiSheet?' \u00b7 <span style="cursor:pointer;color:var(--accent);text-decoration:underline" onclick="STATE.modal=renderSheetPickerModal(STATE.importWB.SheetNames);render()">Change sheet</span>':'')+
        '</div>'+
      '</div>'+
      '<button class="btn-icon" onclick="closeModal()">'+ico("x",14)+'</button>'+
    '</div>'+
    '<div class="mb_">'+
      '<div style="padding:12px 14px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">'+
        '<div><div style="font-size:22px;font-weight:700;color:var(--accent)">'+newJobs+'</div><div style="color:var(--text2);font-size:11px;margin-top:2px">NEW JOBS</div></div>'+
        '<div><div style="font-size:22px;font-weight:700;color:var(--teal)">'+totalContacts+'</div><div style="color:var(--text2);font-size:11px;margin-top:2px">CONTACTS</div></div>'+
        '<div><div style="font-size:22px;font-weight:700;color:var(--purple)">'+newCoCnt+'</div><div style="color:var(--text2);font-size:11px;margin-top:2px">NEW COMPANIES</div></div>'+
      '</div>'+
      (dupeCnt?'<div style="padding:8px 12px;background:var(--amber-l);border-radius:var(--r2);margin-bottom:10px;font-size:12.5px;color:var(--amber)">\u26a0 '+dupeCnt+' job'+(dupeCnt>1?'s':'')+' already exist and will be skipped.</div>':'')+
      (skippedRows?'<div style="padding:8px 12px;background:var(--bg);border-radius:var(--r2);margin-bottom:10px;font-size:12.5px;color:var(--text3)">'+skippedRows+' row'+(skippedRows>1?'s':'')+' skipped (no company/name).</div>':'')+
      '<div class="fw5 f13 mb2">Column mapping</div>'+
      '<div class="tbl-wrap mb4" style="max-height:180px;overflow-y:auto">'+
        '<table><thead><tr><th>Your column</th><th>Maps to</th></tr></thead>'+
        '<tbody>'+colRows+'</tbody></table>'+
      '</div>'+
      '<div class="fw5 f13 mb2">Preview (first 3 rows)</div>'+
      '<div style="background:var(--bg);border-radius:var(--r2);padding:10px;font-size:12px;max-height:130px;overflow-y:auto">'+
        sample.map(function(r){
          var m=mapCol(r,COL_MAP);
          return '<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;gap:6px;flex-wrap:wrap">'+
            (m.firstName?'<span class="bdg bdg-blue">'+htmlEsc(m.firstName+(m.lastName?" "+m.lastName:""))+'</span>':"")+
            (m.company?'<span class="bdg bdg-gray">'+htmlEsc(m.company)+'</span>':"")+
            (m.position?'<span class="bdg bdg-gray">'+htmlEsc(m.position)+'</span>':"")+
            (m.email?'<span class="bdg bdg-teal" style="background:var(--teal-l);color:var(--teal)">'+htmlEsc(m.email)+'</span>':"")+
          '</div>';
        }).join("")+
      '</div>'+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      (newJobs>0
        ?'<button class="btn btn-primary" onclick="confirmImport()">'+ico("plus",13)+' Import '+newJobs+' job'+(newJobs>1?'s':'')+'</button>'
        :'<button class="btn btn-primary" disabled style="opacity:.5;cursor:not-allowed">Nothing new to import</button>')+
    '</div>'+
  '</div>';
}

// ── Drop C helpers ──────────────────────────────
function groupImportRows(mapped){
  var groups={};var order=[];
  var norm=function(s){return(s||"").trim().toLowerCase().replace(/\s+/g," ");};
  mapped.forEach(function(r){
    if(!r.company&&!r.firstName){return;}
    var coKey=norm(r.company||"unknown");
    var posKey=norm(r.position||"unknown");
    var key=coKey+"||"+posKey;
    if(!groups[key]){
      groups[key]={
        coName:(r.company||"").trim(),
        website:(r.website||"").trim(),
        industry:(r.industry||"").trim(),
        location:(r.location||"").trim(),
        position:(r.position||"").trim(),
        source:(r.source||"Import").trim(),
        salaryRange:(r.salaryRange||"").trim(),
        jobCreatedDate:(r.jobCreatedDate||"").trim(),
        bdmAssigned:(r.bdmAssigned||"").trim(),
        analystName:(r.analystName||"").trim(),
        notes:"",
        jdText:"",
        contacts:[]
      };
      order.push(key);
    }
    if(r.notes){
      var noteText=(r.notes||"").trim();
      if(noteText){groups[key].notes=groups[key].notes?(groups[key].notes+"\n"+noteText):noteText;}
    }
    if(r.jdText){
      var jd=(r.jdText||"").trim();
      if(jd){groups[key].jdText=groups[key].jdText?(groups[key].jdText+"\n"+jd):jd;}
    }
    if(r.firstName||r.email){
      groups[key].contacts.push({
        first_name:(r.firstName||"").trim(),
        last_name:(r.lastName||"").trim(),
        designation:(r.designation||"").trim(),
        email:(r.email||"").trim(),
        phone:(r.phone||"").trim(),
        linkedin:(r.linkedin||"").trim()
      });
    }
  });
  return order.map(function(k){return groups[k];}).filter(function(g){return g.contacts.length>0;});
}

function renderImportProgressModal(done,total,logLines,finished,summary){
  var pct=total>0?Math.round(done/total*100):0;
  return '<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">'+(finished?'Import complete':'Importing\u2026')+'</div></div>'+
    '<div class="mb_">'+
      '<div style="margin-bottom:12px">'+
        '<div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text2);margin-bottom:6px">'+
          '<span>'+(finished?'Done':'Processing job '+Math.min(done+1,total)+' of '+total)+'</span>'+
          '<span>'+pct+'%</span>'+
        '</div>'+
        '<div style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">'+
          '<div style="height:100%;width:'+pct+'%;background:var(--accent);border-radius:99px;transition:width .3s"></div>'+
        '</div>'+
      '</div>'+
      (finished&&summary?'<div style="padding:10px 12px;background:var(--accent-l);border-radius:var(--r2);margin-bottom:10px;font-size:13px">'+htmlEsc(summary)+'</div>':'')+
      '<div style="background:var(--bg);border-radius:var(--r2);padding:8px 10px;font-size:11.5px;max-height:160px;overflow-y:auto;font-family:var(--mono);color:var(--text2)" id="import-log">'+
        (logLines.length?logLines.map(function(l){return '<div style="padding:2px 0">'+htmlEsc(l)+'</div>';}).join(''):'<div style="color:var(--text3)">Starting\u2026</div>')+
      '</div>'+
    '</div>'+
    (finished?'<div class="mf"><button class="btn btn-primary" onclick="closeModal();refreshJobs().then(function(){if(STATE.user&&(STATE.user.role===\'bd\'||STATE.user.role===\'bd_lead\')){var myJobIds=STATE.jobs.filter(function(j){return j.assigned_to_bd===STATE.user.id&&j.stage===\'Unassigned\';}).map(function(j){return j.id;});if(myJobIds.length)apiPost(\'/emails/generate\',{job_ids:myJobIds}).then(function(r){showToast(r.generated+\' emails generated\',\'success\');apiGet(\'/emails?status=pending\').then(function(d){STATE.pendingEmails=d;render();});});}});">Done</button></div>':'')+
  '</div>';
}

window.confirmImport=function(){
  if(!STATE.importPreview||!STATE.importPreview.length){closeModal();return;}
  var mapped=STATE.importPreview.map(function(r){return mapCol(r,COL_MAP);});
  var groups=groupImportRows(mapped);
  STATE.importPreview=null;

  var toProcess=groups.filter(function(g){
    return !STATE.jobs.find(function(j){
      return j.company_name.toLowerCase()===g.coName.toLowerCase()&&
             j.position.toLowerCase()===g.position.toLowerCase();
    });
  });
  if(!toProcess.length){closeModal();showToast('All jobs already exist \u2014 nothing to import.','warning');return;}

  var allEmails=[];
  toProcess.forEach(function(g){
    g.contacts.forEach(function(c){if(c.email)allEmails.push(c.email.toLowerCase().trim());});
  });

  function startImport(dupEmailMap){
    STATE._pendingImport=toProcess;
    STATE._pendingDupMap=dupEmailMap||{};
    doImportProcess(toProcess,dupEmailMap||{});
  }

  if(allEmails.length){
    apiPost('/jobs/check-duplicates',{emails:allEmails}).then(function(res){
      var dupEmailMap={};
      (res.duplicates||[]).forEach(function(d){
        if(d.email){dupEmailMap[d.email.toLowerCase()]={
          position:(d.job&&d.job.position)||'',
          company:(d.job&&d.job.company&&d.job.company.name)||''
        };}
      });
      if(Object.keys(dupEmailMap).length){
        STATE._pendingImport=toProcess;
        STATE._pendingDupMap=dupEmailMap;
        STATE.modal=renderDuplicateWarningModal(toProcess,dupEmailMap);
        render();
      } else { startImport({}); }
    }).catch(function(){startImport({});});
  } else { startImport({}); }
};

function renderDuplicateWarningModal(groups,dupEmailMap){
  var dupCount=Object.keys(dupEmailMap).length;
  var items=Object.keys(dupEmailMap).slice(0,6).map(function(email){
    var d=dupEmailMap[email];
    return '<div style="padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">'+
      '<span style="color:var(--amber);font-weight:600">'+htmlEsc(email)+'</span>'+
      (d.company?' \u2014 already in <strong>'+htmlEsc(d.company)+'</strong>'+(d.position?' ('+htmlEsc(d.position)+')':''):'')+
    '</div>';
  }).join('');
  return '<div class="modal modal-w480">'+
    '<div class="mh"><div class="mt">\u26a0 Duplicate emails found</div>'+
    '<button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div style="padding:10px 12px;background:var(--amber-l);border-radius:var(--r2);margin-bottom:12px;font-size:13px;color:var(--amber)">'+
        '<strong>'+dupCount+' email ID'+(dupCount>1?'s':'')+' already exist</strong> in the system. These leads will be imported but flagged as <strong>DUPLICATE</strong> for the Team Lead to review.'+
      '</div>'+
      items+
      (Object.keys(dupEmailMap).length>6?'<div style="font-size:12px;color:var(--text3);padding-top:6px">+'+(Object.keys(dupEmailMap).length-6)+' more</div>':'')+
    '</div>'+
    '<div class="mf">'+
      '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="doImportProcess(STATE._pendingImport,STATE._pendingDupMap)">Proceed (flag as duplicates)</button>'+
    '</div>'+
  '</div>';
}

window.doImportProcess=function(toProcess,dupEmailMap){
  STATE.modal=null;
  var total=toProcess.length;
  STATE.modal=renderImportProgressModal(0,total,['Preparing batch\u2026 '+total+' jobs'],false,'');
  render();

  // ── Step 1: resolve all companies in bulk ──
  var newCoNames={};
  toProcess.forEach(function(g){
    var key=g.coName.toLowerCase();
    if(!STATE.companies.find(function(c){return c.name.toLowerCase()===key;})){
      newCoNames[key]=g;
    }
  });
  var newCoList=Object.values(newCoNames);

  function buildAndSend(coCache){
    // Build job payloads
    var jobPayloads=toProcess.map(function(g){
      var key=g.coName.toLowerCase();
      var coId=coCache[key];
      if(!coId)return null; // skip if company resolution failed
      var groupIsDup=g.contacts.some(function(c){return c.email&&dupEmailMap[c.email.toLowerCase().trim()];});
      var payload={
        company_id:coId,
        position:g.position||'(unknown)',
        contacts:g.contacts,
        is_duplicate:groupIsDup
      };
      if(g.location)payload.location=g.location;
      if(g.source)payload.source=g.source;
      if(g.industry)payload.industry=g.industry;
      if(g.salaryRange)payload.salary_range=g.salaryRange;
      if(g.jobCreatedDate)payload.job_created_date=parseExcelDateToISO(g.jobCreatedDate);
      if(g.bdmAssigned)payload.bdm_assigned_name=g.bdmAssigned;
      if(g.notes)payload.notes=g.notes;
      if(g.jdText)payload.jd_text=g.jdText;
      return payload;
    }).filter(Boolean);

    if(!jobPayloads.length){
      STATE.modal=renderImportProgressModal(total,total,['No valid jobs to import.'],true,'0 jobs imported.');
      render();return;
    }

    STATE.modal=renderImportProgressModal(0,total,['Uploading '+jobPayloads.length+' jobs in one batch\u2026'],false,'');
    render();

    // Single bulk API call
    apiPost('/jobs/bulk',{jobs:jobPayloads}).then(function(res){
      var summary=res.imported+' job'+(res.imported!==1?'s':'')+' imported, '+res.contacts+' contacts created.';
      var logs=[
        '\u2713 Batch complete',
        'Jobs imported: '+res.imported,
        'Contacts created: '+res.contacts,
        (Object.keys(dupEmailMap).length?' Flagged as duplicates: '+toProcess.filter(function(g){return g.contacts.some(function(c){return c.email&&dupEmailMap[c.email.toLowerCase().trim()];});}).length:'')
      ].filter(Boolean);
      STATE.modal=renderImportProgressModal(res.imported,res.imported,logs,true,summary);
      render();
    }).catch(function(err){
      var logs=['\u2717 Batch failed: '+err.message,'Check your data and try again.'];
      STATE.modal=renderImportProgressModal(0,total,logs,true,'Import failed: '+err.message);
      render();
    });
  }

  // Build company cache from existing
  var coCache={};
  STATE.companies.forEach(function(c){coCache[c.name.toLowerCase()]=c.id;});

  if(newCoList.length){
    STATE.modal=renderImportProgressModal(0,total,['Creating '+newCoList.length+' new companies\u2026'],false,'');
    render();
    // Bulk create new companies
    var coPayloads=newCoList.map(function(g){
      var p={name:g.coName};
      if(g.website)p.website=g.website;
      if(g.industry)p.industry=g.industry;
      if(g.location)p.location=g.location;
      return p;
    });
    apiPost('/companies/bulk',{companies:coPayloads}).then(function(created){
      created.forEach(function(c){
        coCache[c.name.toLowerCase()]=c.id;
        STATE.companies.push({id:c.id,name:c.name,web:'',ind:'',loc:''});
      });
      buildAndSend(coCache);
    }).catch(function(err){
      // If bulk company creation fails, fall back to individual
      var promises=coPayloads.map(function(p){
        return apiPost('/companies',p).then(function(c){
          coCache[c.name.toLowerCase()]=c.id;
          STATE.companies.push({id:c.id,name:c.name,web:'',ind:'',loc:''});
        }).catch(function(){});
      });
      Promise.all(promises).then(function(){buildAndSend(coCache);});
    });
  } else {
    buildAndSend(coCache);
  }
};



