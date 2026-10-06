// ── Jobs (wired) ───────────────────────────────
window.changeJobStage=function(jid,st){
  var j=jobById(jid);if(!j)return;
  if(j.stage===st)return;
  var old=j.stage;j.stage=st;
  if(!STATE._pendingStageChanges)STATE._pendingStageChanges={};
  STATE._pendingStageChanges[jid]=st;
  render();
  apiPut('/jobs/'+jid,{stage:st}).then(function(){
    if(STATE._pendingStageChanges)delete STATE._pendingStageChanges[jid];
    showToast('Stage updated','success');
  }).catch(function(e){
    if(STATE._pendingStageChanges)delete STATE._pendingStageChanges[jid];
    j.stage=old;showToast('Failed: '+e.message,'error');render();
  });
};
window.saveJobNotes=function(jid,val){
  var j=jobById(jid);if(!j||j.notes===val)return;var old=j.notes;j.notes=val;
  apiPut('/jobs/'+jid,{notes:val}).then(function(){showToast('Notes saved','success');}).catch(function(e){j.notes=old;showToast('Failed: '+e.message,'error');render();});
};
window.deleteJob=function(jid){
  if(!confirm('Delete this job and all its contacts?'))return;
  apiDelete('/jobs/'+jid).then(function(){STATE.modal=null;STATE.detailJob=null;showToast('Job deleted','success');return refreshJobs();}).catch(function(e){showToast('Failed: '+e.message,'error');});
};
// ── ADD LEAD: handlers and save (the window itself is renderAddJobModal, 06) ──
// Typing writes into STATE.addLead and never repaints; only the buttons that
// change the SHAPE of the window (company mode, add/remove a contact) do.
function _al(){ return STATE.addLead||(STATE.addLead=window.addLeadFresh()); }
window.addLeadField=function(k,v){ _al()[k]=v; };
window.addLeadCo=function(k,v){ _al().newCo[k]=v; };
window.addLeadContact=function(i,k,v){ var c=_al().contacts[i]; if(c)c[k]=v; };
window.addLeadMode=function(m){
  var a=_al(); if(a.mode===m)return;
  // Carry what was typed across: the search text becomes the new company's name.
  if(m==='new'&&!a.newCo.name)a.newCo.name=a.coText||'';
  a.mode=m; render();
};
window.addLeadChangeCo=function(){ var a=_al(); a.company=null; a.coText=''; render(); };
window.addLeadPickCo=function(co){ var a=_al(); a.company={id:co.id,name:co.name,industry:co.industry||'',location:co.location||''}; a.coText=co.name; render(); };
window.addLeadTypeCo=function(text){ var a=_al(); a.coText=text; a.company=null; };   // typing again drops a stale pick
window.addLeadAddContact=function(){ _al().contacts.push(window.addLeadBlankContact()); render(); };
window.addLeadRemoveContact=function(i){ var a=_al(); if(i>0)a.contacts.splice(i,1); render(); };

window.submitAddJob=function(){
  var a=_al(); if(a.busy)return;
  var pos=(a.pos||'').trim();
  // Which company: one picked from yours, or a new one typed here.
  var needNew=a.mode==='new';
  if(needNew){ if(!(a.newCo.name||'').trim()){showToast('Give the new company a name','error');return;} }
  else if(!a.company){showToast('Pick a company — or add it as a new one','error');return;}
  if(!pos){showToast('Position is required','error');return;}
  // Contacts: an empty block is ignored; a block with anything in it needs a first name.
  var contacts=[];
  for(var i=0;i<a.contacts.length;i++){
    var c=a.contacts[i], any=['first_name','last_name','designation','email','phone','linkedin'].some(function(k){return (c[k]||'').trim();});
    if(!any)continue;
    if(!(c.first_name||'').trim()){showToast('Contact '+(i+1)+' needs a first name','error');return;}
    if((c.email||'').trim()&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())){showToast('Contact '+(i+1)+': that email does not look right','error');return;}
    contacts.push({first_name:c.first_name.trim(),last_name:(c.last_name||'').trim(),designation:(c.designation||'').trim(),
      email:(c.email||'').trim(),phone:(c.phone||'').trim(),linkedin:(c.linkedin||'').trim()});
  }
  if(!contacts.length){showToast('Add at least one contact — a first name is enough','error');return;}

  a.busy=true; render();
  var fail=function(e){ a.busy=false; render(); showToast((e&&e.message)||'Could not add the lead','error'); };

  // 1) the company — checked against yours first, so a typo of an existing one never doubles it.
  var companyId;
  var ensureCompany=needNew
    ? apiGet('/companies/search?q='+encodeURIComponent(a.newCo.name.trim())).then(function(found){
        var same=(found||[]).filter(function(c){return String(c.name||'').trim().toLowerCase()===a.newCo.name.trim().toLowerCase();})[0];
        if(same){
          // Already there: use it, and say so. Nothing is created.
          a.mode='existing'; a.company={id:same.id,name:same.name,industry:same.industry||'',location:same.location||''};
          showToast('"'+same.name+'" is already one of your companies — using it','info');
          return same.id;
        }
        var n=a.newCo;
        return apiPost('/companies',{name:n.name.trim(),website:n.website.trim()||null,industry:n.industry||null,
          address_line1:n.address_line1.trim(),address_line2:n.address_line2.trim(),city:n.city.trim(),state:n.state.trim(),postal_code:n.postal_code.trim(),country:n.country.trim()}).then(function(co){
          // Remember it, so a retry after a later failure reuses it instead of creating another.
          a.mode='existing'; a.company={id:co.id,name:co.name,industry:co.industry||'',location:co.location||''};
          STATE.companies.push({id:co.id,name:co.name,web:co.website,ind:co.industry,loc:co.location});
          return co.id;
        });
      })
    : Promise.resolve(a.company.id);

  // 2) the lead, with every contact in one go.
  ensureCompany.then(function(id){
    companyId=id;
    return apiPost('/jobs',{company_id:companyId,position:pos,location:(a.loc||'').trim()||null,source:a.src||'LinkedIn',
      job_url:(a.url||'').trim()||null,stage:'Active',notes:'',contacts:contacts});
  }).then(function(){
    STATE.modal=null; STATE.addLead=null; render();     // the window goes first, whatever the refresh does
    showToast('Lead added'+(contacts.length>1?' with '+contacts.length+' contacts':''),'success');
    return refreshJobs();
  }).catch(fail);
};
window.submitAddContact=function(jid){
  var fn=document.getElementById('ac-fn').value.trim();
  if(!fn){showToast('First name is required','error');return;}
  var existing=jobContacts(jid);
  sendAddContact(jid,{job_id:jid,first_name:fn,
    last_name:document.getElementById('ac-ln').value.trim(),
    designation:document.getElementById('ac-desig').value.trim(),
    email:document.getElementById('ac-email').value.trim(),
    phone:document.getElementById('ac-phone').value.trim(),
    linkedin:document.getElementById('ac-linkedin').value.trim(),
    is_primary:existing.length===0
  });
};
// Already added? The server refuses (409 + `duplicate`) and this shows the
// same pop-up as the POC finder. The form is a modal the pop-up replaces, so
// the typed values are kept here for "Add anyway"; closing goes back to the
// lead, where the person already is.
function sendAddContact(jid,body){
  apiPost('/contacts',body).then(function(){showToast('Contact added','success');STATE.modal={type:'jobDetail',id:jid};return refreshJobs();}).catch(function(e){
    var dup=e&&e.body&&e.body.duplicate;
    if(dup){
      showAlreadyAdded(dup,{
        onAddAnyway:dup.can_add_anyway?function(){sendAddContact(jid,Object.assign({},body,{allow_same_name:true}));}:null,
        onClose:function(){STATE.modal={type:'jobDetail',id:jid};render();}
      });
      return;
    }
    showToast('Failed: '+e.message,'error');
  });
}
window.deleteContact=function(cid){
  if(!confirm('Delete this contact?'))return;
  apiDelete('/contacts/'+cid).then(function(){showToast('Contact deleted','success');return refreshJobs();}).catch(function(e){showToast('Failed: '+e.message,'error');});
};


