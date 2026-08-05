// ════════════════════════════════════════════════
// RA LEAD ENTRY FORM — Drop P
// ════════════════════════════════════════════════
function defaultRaFormResearch(){
  return{jd_raw:'',suggested_skills:[],company:{expertise:'',notes:'',headcount:'',hiring_volume:''},outreach:{angle:'',avoid:''},requirements:{skill_1:'',skill_2:'',skill_3:'',salary_min:null,salary_max:null,salary_period:'year',salary_display:'',location:'',local_hint:'',travel:''},contacts:[]};
}
function renderSuggestedSkillChips(suggested,assignHandler,skillsSource){
  assignHandler=assignHandler||'raFormAssignSkill';
  if(!suggested||!suggested.length)return '';
  var unique=[],seen={};
  suggested.forEach(function(s){
    var k=String(s||'').trim().toLowerCase();
    if(!k||seen[k])return;
    seen[k]=1;
    unique.push(String(s).trim());
  });
  if(!unique.length)return '';
  var sourceNote='';
  if(skillsSource==='title_inference')sourceNote='<div style="font-size:10.5px;color:var(--amber);margin-bottom:6px">⚠ Guessed from the job title (no JD on file) — verify before sending</div>';
  else if(skillsSource==='history_match')sourceNote='<div style="font-size:10.5px;color:var(--accent);margin-bottom:6px">Based on similar past leads (no JD on file) — verify before sending</div>';
  return '<div class="mb3" style="padding:10px 12px;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r2)">'+
    sourceNote+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">Suggested skills — click 1, 2, or 3 to assign</div>'+
    '<div style="display:flex;flex-direction:column;gap:8px">'+
    unique.map(function(sk){
      var esc=htmlEsc(sk);
      return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
        '<span style="font-size:12px;color:var(--text);flex:1;min-width:140px">'+esc+'</span>'+
        '<span style="display:inline-flex;gap:4px">'+
          [1,2,3].map(function(slot){
            return '<button type="button" class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:10px;min-width:28px" onclick="'+assignHandler+'(this)" data-skill="'+esc.replace(/"/g,'&quot;')+'" data-slot="'+slot+'">'+slot+'</button>';
          }).join('')+
        '</span></div>';
    }).join('')+
    '</div></div>';
}
function raFormEnsureResearch(){
  if(!STATE.raForm.research)STATE.raForm.research=defaultRaFormResearch();
  if(!STATE.raForm.research.company)STATE.raForm.research.company={};
  if(!STATE.raForm.research.outreach)STATE.raForm.research.outreach={};
  if(!STATE.raForm.research.requirements)STATE.raForm.research.requirements={};
  if(!STATE.raForm.research.contacts)STATE.raForm.research.contacts=[];
  // Imported leads keep parsed/inferred skills under requirements — surface them
  // at the top level so the suggested-skill chips render.
  if((!STATE.raForm.research.suggested_skills||!STATE.raForm.research.suggested_skills.length)
    &&STATE.raForm.research.requirements.suggested_skills
    &&STATE.raForm.research.requirements.suggested_skills.length){
    STATE.raForm.research.suggested_skills=STATE.raForm.research.requirements.suggested_skills.slice();
  }
  return STATE.raForm.research;
}
function buildRaFormResearchPayload(){
  var r=raFormEnsureResearch();
  var req=Object.assign({},r.requirements||{});
  syncResearchSkillsArray(req);
  if(req.salary_min!=null&&req.salary_max!=null){
    req.salary_display=req.salary_display||buildSalaryDisplay(req.salary_min,req.salary_max,req.salary_period||'year');
    req.salary_range=req.salary_display;
  }
  var hasReq=req.skill_1||req.skill_2||req.skill_3||req.salary_display||req.location||req.local_hint||req.travel;
  var hasCo=r.company.expertise||r.company.notes||r.company.headcount||r.company.hiring_volume;
  var hasOut=r.outreach.angle||r.outreach.avoid;
  var hasContacts=(r.contacts||[]).some(function(c){return c.seniority||c.decision_maker||c.best_time||c.notes;});
  if(!r.jd_raw&&!hasReq&&!hasCo&&!hasOut&&!hasContacts)return null;
  return{jd_raw:r.jd_raw||null,suggested_skills:(r.suggested_skills||[]).slice(),company:Object.assign({},r.company),outreach:Object.assign({},r.outreach),requirements:req,contacts:(r.contacts||[]).slice()};
}
function renderRaFormSalaryRange(req){
  return renderSalaryRangeControl('ra-form',req,'raForm');
}
function renderRaFormContactIntel(f){
  var r=raFormEnsureResearch();
  return f.contacts.map(function(c,idx){
    var ci=(r.contacts[idx])||{};
    var cName=htmlEsc(((c.firstName||'')+' '+(c.lastName||'')).trim())||('Contact '+(idx+1));
    var senOpts=['','Junior','Mid','Senior','Director','VP','C-Level'].map(function(v){
      return '<option value="'+v+'"'+(ci.seniority===v?' selected':'')+'>'+(v||'— Select —')+'</option>';
    }).join('');
    var dmOpts=['','Yes','No','Unknown'].map(function(v){
      return '<option value="'+v+'"'+(ci.decision_maker===v?' selected':'')+'>'+(v||'— Select —')+'</option>';
    }).join('');
    var timeOpts=['','Morning','Afternoon','Evening'].map(function(v){
      return '<option value="'+v+'"'+(ci.best_time===v?' selected':'')+'>'+(v||'— Select —')+'</option>';
    }).join('');
    return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">'+
      '<div style="font-weight:500;font-size:12px;margin-bottom:8px;color:var(--text2)">'+cName+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:6px">'+
        '<div><label style="font-size:10px;color:var(--text3)">Seniority</label><select class="sel" style="font-size:12px;padding:5px 8px" onchange="raFormUpdateContactIntel('+idx+',\'seniority\',this.value)">'+senOpts+'</select></div>'+
        '<div><label style="font-size:10px;color:var(--text3)">Decision maker?</label><select class="sel" style="font-size:12px;padding:5px 8px" onchange="raFormUpdateContactIntel('+idx+',\'decision_maker\',this.value)">'+dmOpts+'</select></div>'+
        '<div><label style="font-size:10px;color:var(--text3)">Best time</label><select class="sel" style="font-size:12px;padding:5px 8px" onchange="raFormUpdateContactIntel('+idx+',\'best_time\',this.value)">'+timeOpts+'</select></div>'+
      '</div>'+
      '<input class="inp" style="font-size:12px" placeholder="Notes about this contact..." value="'+htmlEsc(ci.notes||'')+'" oninput="raFormUpdateContactIntel('+idx+',\'notes\',this.value)"/>'+
    '</div>';
  }).join('');
}
function renderRALeadForm(){
  var f=STATE.raForm;
  var isEditing=!!f.editJobId;
  var r=raFormEnsureResearch();
  var req=r.requirements||{};
  var indOpts=buildIndustrySelectOptions(f.industry||'');
  var headcountOpts=['','1-10','11-50','51-200','201-500','500+'].map(function(v){
    return '<option value="'+v+'"'+(r.company.headcount===v?' selected':'')+'>'+(v||'— Select —')+'</option>';
  }).join('');
  var hiringOpts=['','Low','Medium','High'].map(function(v){
    return '<option value="'+v+'"'+(r.company.hiring_volume===v?' selected':'')+'>'+(v||'— Select —')+'</option>';
  }).join('');

  // Company info banner
  var coBanner='';
  if(f.coInfo){
    var ci=f.coInfo;
    coBanner='<div style="margin-top:6px;padding:8px 12px;background:var(--accent-l);border-radius:var(--r);font-size:12px;color:var(--text2)">'+
      '\u2139\ufe0f <strong>'+htmlEsc(ci.name)+'</strong> already exists'+
      (ci.job_count?' \u00b7 '+ci.job_count+' open job'+(ci.job_count!==1?'s':'')+' in system':'')+
      (ci.bd_name?' \u00b7 Manager: <strong>'+htmlEsc(ci.bd_name)+'</strong>':'')+
    '</div>';
  }

  // Zip suggestions dropdown
  var zipSuggestions='';
  if(STATE.raFormZipSuggestions&&STATE.raFormZipSuggestions.length){
    zipSuggestions='<div style="position:absolute;top:100%;left:0;right:0;background:var(--card);border:1px solid var(--border2);border-radius:var(--r2);box-shadow:var(--sh2);z-index:100;margin-top:2px" id="zip-suggestions">'+
      STATE.raFormZipSuggestions.map(function(z,i){
        return '<div class="_zip-sug" data-idx="'+i+'" style="padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px">'+
          htmlEsc(z.display)+'</div>';
      }).join('')+
    '</div>';
  }

  // Contact rows
  var contactRows=(f.contacts||[]).map(function(c,idx){
    var dupWarning='';
    if(c.emailDupInfo&&c.emailDupInfo.duplicate){
      var d=c.emailDupInfo;
      dupWarning='<div style="margin-top:4px;padding:6px 10px;background:var(--red-l);border-radius:var(--r);font-size:11.5px;color:var(--red)">'+
        '\u26a0 Added '+d.days_ago+' day'+(d.days_ago!==1?'s':'')+' ago'+(d.added_by?' by <strong>'+htmlEsc(d.added_by)+'</strong>':'')+
        (d.company?' at <strong>'+htmlEsc(d.company)+'</strong>':'')+'. Will be flagged duplicate.</div>';
    } else if(c.emailStatus==='ok'){
      dupWarning='<div style="margin-top:3px;font-size:11px;color:var(--green)">\u2713 Email looks good</div>';
    }
    return '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r2);padding:14px;margin-bottom:10px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
        '<div style="font-weight:600;font-size:12px;color:var(--text2)">Contact '+(idx+1)+(idx===0?' <span style="font-size:10px;color:var(--green);background:var(--green-l);padding:1px 6px;border-radius:5px;margin-left:4px">PRIMARY</span>':'')+'</div>'+
        (idx>0?'<button onclick="raFormRemoveContact('+idx+')" style="background:transparent;border:0;color:var(--red);font-size:12px;cursor:pointer">\u2715 Remove</button>':'')+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">'+
        '<input class="inp" placeholder="First name *" value="'+htmlEsc(c.firstName||'')+'" oninput="raFormUpdateContact('+idx+',\'firstName\',this.value)"/>'+
        '<input class="inp" placeholder="Last name" value="'+htmlEsc(c.lastName||'')+'" oninput="raFormUpdateContact('+idx+',\'lastName\',this.value)"/>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">'+
        '<input class="inp" placeholder="Designation" value="'+htmlEsc(c.designation||'')+'" oninput="raFormUpdateContact('+idx+',\'designation\',this.value)"/>'+
        '<div>'+
          '<input class="inp" placeholder="Email ID *" value="'+htmlEsc(c.email||'')+'" oninput="raFormUpdateContact('+idx+',\'email\',this.value)" onblur="raFormCheckEmail('+idx+',this.value)"/>'+
          dupWarning+
        '</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<input class="inp" placeholder="Phone" value="'+htmlEsc(c.phone||'')+'" oninput="raFormUpdateContact('+idx+',\'phone\',this.value)"/>'+
        '<input class="inp" placeholder="LinkedIn URL (POC\'s profile)" value="'+htmlEsc(c.linkedin||'')+'" oninput="raFormUpdateContact('+idx+',\'linkedin\',this.value)"/>'+
      '</div>'+
    '</div>';
  }).join('');

  return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:20px;margin-bottom:8px">'+
    '<div style="font-weight:700;font-size:14px;margin-bottom:16px;color:var(--text)">'+(isEditing?'\u270f\ufe0f Edit Lead':'Add New Lead')+'</div>'+

    // ── Company ──
    '<div style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Company</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
      '<div>'+
        '<div style="position:relative">'+
          '<input class="inp" id="ra-co-name" placeholder="Company name *" value="'+htmlEsc(f.coName||'')+'" autocomplete="off" oninput="raFormCoSearch(this.value)" onblur="raFormCoBlur()" style="'+(companyCooldownCheck(f.coName)?'border-color:#f59e0b':'')+'"/>'+
          (STATE.raFormCoSuggestions&&STATE.raFormCoSuggestions.length?
            '<div style="position:absolute;top:100%;left:0;right:0;background:var(--card);border:1px solid var(--border2);border-radius:var(--r2);box-shadow:var(--sh2);z-index:100;max-height:200px;overflow-y:auto;margin-top:2px" id="co-suggestions">'+
              STATE.raFormCoSuggestions.map(function(co,i){
                var cool=companyCooldownCheck(co.name);
                return '<div class="_co-sug" data-idx="'+i+'" style="padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--border);opacity:'+(cool?'.5':'1')+'">'+
                  '<div style="font-weight:500;font-size:13px">'+htmlEsc(co.name)+(cool?'<span style="margin-left:6px;font-size:10px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px">Cooldown '+cool.daysLeft+'d</span>':'')+'</div>'+
                  '<div style="font-size:11px;color:var(--text3)">'+htmlEsc(co.industry||'')+(co.location?' \u00b7 '+htmlEsc(co.location):'')+( co.job_count?' \u00b7 '+co.job_count+' jobs':'')+( co.bd_name?' \u00b7 '+htmlEsc(co.bd_name):'')+'</div>'+
                '</div>';
              }).join('')+
            '</div>':'')+
        '</div>'+
        (function(){var cool=companyCooldownCheck(f.coName);return cool?'<div style="margin-top:5px;padding:8px 10px;background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;font-size:11.5px;color:#92400e"><strong>⚠ 21-day cooldown active</strong> — '+htmlEsc(f.coName)+' was added '+cool.daysAgo+' day'+(cool.daysAgo!==1?'s':'')+' ago ('+htmlEsc(cool.position)+'). '+cool.daysLeft+' day'+(cool.daysLeft!==1?'s':'')+' remaining.</div>':'';})()  +
        coBanner+
      '</div>'+
      '<input class="inp" placeholder="Website" value="'+htmlEsc(f.website||'')+'" oninput="raFormSet(\'website\',this.value)"/>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
      '<select class="sel" onchange="raFormSet(\'industry\',this.value)">'+indOpts+'</select>'+
      '<div>'+
        '<div style="position:relative">'+
          '<input class="inp" id="ra-zip" placeholder="Zip code (e.g. 10001)" value="'+htmlEsc(f.zipCode||'')+'" autocomplete="off" oninput="raFormZipSearch(this.value)" onblur="raFormZipBlur()"/>'+
          zipSuggestions+
        '</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:3px">Type zip to auto-fill location</div>'+
      '</div>'+
    '</div>'+
    '<div style="margin-bottom:10px">'+
      '<input class="inp" id="ra-location" placeholder="Location (City, State) *" value="'+htmlEsc(f.location||'')+'" oninput="raFormSet(\'location\',this.value)" style="border-color:'+(f.location?'var(--border)':'')+'"/>'+
      (!f.location?'<div style="font-size:11px;color:var(--red);margin-top:3px">Location is required</div>':'')+
    '</div>'+
    '<div class="fgrp mb4"><label class="flbl">Company expertise</label><input class="inp" placeholder="e.g. Healthcare staffing, ERP implementations..." value="'+htmlEsc(r.company.expertise||'')+'" oninput="raFormUpdateResearch(\'company\',\'expertise\',this.value)"/></div>'+

    // ── Job ──
    '<div style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Job Details</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
      '<input class="inp" placeholder="Job title *" value="'+htmlEsc(f.position||'')+'" oninput="raFormSet(\'position\',this.value)"/>'+
      '<input class="inp" placeholder="Job URL" value="'+htmlEsc(f.jobUrl||'')+'" oninput="raFormSet(\'jobUrl\',this.value)"/>'+
    '</div>'+
    '<div style="margin-bottom:10px">'+
      '<input class="inp" placeholder="Source (LinkedIn, Indeed...)" value="'+htmlEsc(f.source||'')+'" oninput="raFormSet(\'source\',this.value)"/>'+
    '</div>'+
    '<div style="margin-bottom:16px;max-width:280px">'+
      '<label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Job Created Date</label>'+
      '<input type="date" class="inp" value="'+htmlEsc(f.jobCreatedDate||'')+'" oninput="raFormSet(\'jobCreatedDate\',this.value)"/>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:4px">Job opened date is set automatically when the lead is converted to a job.</div>'+
    '</div>'+

    // ── Contacts ──
    '<div style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Contacts / POCs</div>'+
    contactRows+
    '<button onclick="raFormAddContact()" style="background:transparent;border:1.5px dashed var(--border2);color:var(--text3);padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer;width:100%;margin-bottom:16px">+ Add another contact</button>'+

    // ── Job Description (requirements) ──
    '<div style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Job Description</div>'+
    '<div class="fgrp mb2"><label class="flbl">Paste job description</label>'+
      '<textarea class="txta w100" style="min-height:120px;font-size:12px" id="ra-jd-raw" placeholder="Paste the full JD here, then click Extract..." oninput="raFormUpdateResearch(\'jd_raw\',\'__root__\',this.value)">'+htmlEsc(r.jd_raw||'')+'</textarea>'+
    '</div>'+
    '<div style="margin-bottom:12px">'+
      '<button type="button" class="btn btn-outline btn-sm" onclick="raFormParseJD()">Extract requirements</button>'+
    '</div>'+
    renderSuggestedSkillChips(r.suggested_skills||[],'raFormAssignSkill',(r.requirements||{}).skills_source)+
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">'+
      '<div class="fgrp"><label class="flbl">Skill 1</label><input class="inp" style="font-size:12px" placeholder="Primary skill from JD" value="'+htmlEsc(req.skill_1||'')+'" oninput="raFormUpdateRequirements(\'skill_1\',this.value)"/></div>'+
      '<div class="fgrp"><label class="flbl">Skill 2</label><input class="inp" style="font-size:12px" placeholder="Secondary skill" value="'+htmlEsc(req.skill_2||'')+'" oninput="raFormUpdateRequirements(\'skill_2\',this.value)"/></div>'+
      '<div class="fgrp"><label class="flbl">Skill 3</label><input class="inp" style="font-size:12px" placeholder="Third skill (optional)" value="'+htmlEsc(req.skill_3||'')+'" oninput="raFormUpdateRequirements(\'skill_3\',this.value)"/></div>'+
      renderRaFormSalaryRange(req)+
      '<div class="fgrp"><label class="flbl">Location</label><input class="inp" style="font-size:12px" placeholder="" value="'+htmlEsc(req.location||'')+'" oninput="raFormUpdateRequirements(\'location\',this.value)"/></div>'+
      '<div class="fgrp"><label class="flbl">City / local hint</label><input class="inp" style="font-size:12px" placeholder="" value="'+htmlEsc(req.local_hint||'')+'" oninput="raFormUpdateRequirements(\'local_hint\',this.value)"/></div>'+
      '<div class="fgrp"><label class="flbl">Travel</label><select class="sel" style="font-size:12px" onchange="raFormUpdateRequirements(\'travel\',this.value)">'+
        ['','none','25%','required'].map(function(v){
          var labels={'':'— Select —','none':'None','25%':'25%','required':'Required'};
          return '<option value="'+v+'"'+(req.travel===v?' selected':'')+'>'+labels[v]+'</option>';
        }).join('')+
      '</select></div>'+
    '</div>'+

    // ── Contact Intel ──
    '<div style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:16px 0 10px">Contact Intel</div>'+
    renderRaFormContactIntel(f)+

    // ── Company Research ──
    '<div style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:16px 0 10px">Company Research</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
      '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Headcount</label><select class="sel" style="font-size:12px" onchange="raFormUpdateResearch(\'company\',\'headcount\',this.value)">'+headcountOpts+'</select></div>'+
      '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Hiring volume</label><select class="sel" style="font-size:12px" onchange="raFormUpdateResearch(\'company\',\'hiring_volume\',this.value)">'+hiringOpts+'</select></div>'+
    '</div>'+
    '<div class="fgrp mb2"><label class="flbl">Company notes / recent news</label><textarea class="txta w100" style="min-height:60px;font-size:12px" placeholder="Any relevant company news, context..." oninput="raFormUpdateResearch(\'company\',\'notes\',this.value)">'+htmlEsc(r.company.notes||'')+'</textarea></div>'+
    '<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 10px">Outreach Notes</div>'+
    '<div class="fgrp mb2"><label class="flbl">Recommended angle</label><input class="inp" style="font-size:12px" placeholder="What angle to use in outreach..." value="'+htmlEsc(r.outreach.angle||'')+'" oninput="raFormUpdateResearch(\'outreach\',\'angle\',this.value)"/></div>'+
    '<div class="fgrp mb4"><label class="flbl">What to avoid</label><input class="inp" style="font-size:12px" placeholder="Topics or approaches to avoid..." value="'+htmlEsc(r.outreach.avoid||'')+'" oninput="raFormUpdateResearch(\'outreach\',\'avoid\',this.value)"/></div>'+

    // ── Actions ──
    '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;border-top:1px solid var(--border)">'+
      '<button onclick="raFormClear()" style="background:transparent;border:1px solid var(--border);color:var(--text3);padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer">'+(isEditing?'Cancel edit':'Clear form')+'</button>'+
      '<button onclick="raFormSubmit()" style="background:var(--accent);color:#fff;border:0;padding:10px 24px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer'+(STATE.raFormSubmitting?';opacity:.6':'')+'">'+( STATE.raFormSubmitting?'Saving\u2026':(isEditing?'Save changes':'Submit Lead'))+'</button>'+
    '</div>'+
  '</div>';
}

// ── RA Form actions ──────────────────────────────
window.raFormUpdateResearch=function(section,field,val){
  var r=raFormEnsureResearch();
  if(section==='jd_raw'&&field==='__root__'){r.jd_raw=val;STATE.raFormTouchedAt=Date.now();return;}
  if(!r[section])r[section]={};
  r[section][field]=val;
  STATE.raFormTouchedAt=Date.now();
};
window.raFormUpdateRequirements=function(field,val){
  var r=raFormEnsureResearch();
  if(!r.requirements)r.requirements={};
  r.requirements[field]=val;
  if(field==='skill_1'||field==='skill_2'||field==='skill_3')syncResearchSkillsArray(r.requirements);
};
window.raFormAssignSkill=function(btn){
  var skill=btn.getAttribute('data-skill');
  var slot=Number(btn.getAttribute('data-slot'));
  if(!skill||!slot)return;
  var r=raFormEnsureResearch();
  if(!r.requirements)r.requirements={};
  r.requirements['skill_'+slot]=skill;
  syncResearchSkillsArray(r.requirements);
  render();
};
window.raFormUpdateContactIntel=function(idx,field,val){
  var r=raFormEnsureResearch();
  while(r.contacts.length<=idx)r.contacts.push({});
  r.contacts[idx][field]=val;
};
function raFormRefreshSalaryUi(){
  var r=raFormEnsureResearch();
  var req=r.requirements||{};
  var st=getSalaryReqState(req);
  var displayEl=document.getElementById('salary-display-ra-form');
  var fillEl=document.getElementById('salary-fill-ra-form');
  var minEl=document.getElementById('salary-min-ra-form');
  var maxEl=document.getElementById('salary-max-ra-form');
  if(displayEl)displayEl.textContent=req.salary_display||buildSalaryDisplay(st.min,st.max,st.period);
  if(fillEl){
    var leftPct=((st.min-st.cfg.min)/(st.cfg.max-st.cfg.min))*100;
    var widthPct=((st.max-st.min)/(st.cfg.max-st.cfg.min))*100;
    fillEl.style.left=leftPct+'%';
    fillEl.style.width=widthPct+'%';
  }
  if(minEl){minEl.min=st.cfg.min;minEl.max=st.cfg.max;minEl.step=st.cfg.step;minEl.value=st.min;}
  if(maxEl){maxEl.min=st.cfg.min;maxEl.max=st.cfg.max;maxEl.step=st.cfg.step;maxEl.value=st.max;}
}
window.raFormUpdateSalaryRange=function(which,val){
  var r=raFormEnsureResearch();
  if(!r.requirements)r.requirements={};
  var req=r.requirements;
  var st=getSalaryReqState(req);
  var num=Number(val);
  if(which==='min')req.salary_min=Math.min(num,st.max);
  else req.salary_max=Math.max(num,st.min);
  req.salary_display=buildSalaryDisplay(req.salary_min,req.salary_max,req.salary_period||st.period);
  req.salary_range=req.salary_display;
  raFormRefreshSalaryUi();
};
window.raFormUpdateSalaryPeriod=function(period){
  var r=raFormEnsureResearch();
  if(!r.requirements)r.requirements={};
  var req=r.requirements;
  req.salary_period=period;
  var st=getSalaryReqState(req);
  req.salary_min=st.min;
  req.salary_max=st.max;
  req.salary_display=buildSalaryDisplay(st.min,st.max,period);
  req.salary_range=req.salary_display;
  render();
};
window.raFormParseJD=function(){
  var r=raFormEnsureResearch();
  var jdEl=document.getElementById('ra-jd-raw');
  var jdText=jdEl?jdEl.value:(r.jd_raw||'');
  if(!jdText||!jdText.trim()){showToast('Paste a job description first','warning');return;}
  apiPost('/parse-jd',{jd_text:jdText,industry:STATE.raForm.industry||''}).then(function(parsed){
    r.jd_raw=jdText;
    r.requirements=Object.assign({},r.requirements||{},parsed);
    r.suggested_skills=parsed.suggested_skills||parsed.skills||[];
    var skills=r.suggested_skills;
    if(skills[0])r.requirements.skill_1=skills[0];
    if(skills[1])r.requirements.skill_2=skills[1];
    if(skills[2])r.requirements.skill_3=skills[2];
    syncResearchSkillsArray(r.requirements);
    if(parsed.travel&&!['none','25%','required'].includes(parsed.travel)){
      r.requirements.travel=parsed.travel.indexOf('25')>-1?'25%':'required';
    }
    if(parsed.salary_display)STATE.raForm.salaryRange=parsed.salary_display;
    var n=skills.length;
    showToast(n?'Extracted '+n+' skill'+(n!==1?'s':'')+' — review before submit':'Extracted — review fields before submit','success');
    render();
  }).catch(function(e){showToast('Extract failed: '+e.message,'error');});
};
window.raFormSet=function(field,val){
  STATE.raForm[field]=val;
  STATE.raFormTouchedAt=Date.now();
};

window.raFormDetectTimezone=function(location){
  if(!location)return;
  var tzMap={ny:'EST',nj:'EST',fl:'EST',ma:'EST',pa:'EST',ga:'EST',nc:'EST',sc:'EST',va:'EST',ct:'EST',oh:'EST',mi:'EST',ky:'EST',tn:'EST',tx:'CST',il:'CST',mn:'CST',wi:'CST',mo:'CST',ok:'CST',la:'CST',ar:'CST',ms:'CST',al:'CST',co:'MST',az:'MST',nm:'MST',ut:'MST',ca:'PST',wa:'PST',or:'PST',nv:'PST'};
  var loc=location.toLowerCase();
  var tz='EST';
  Object.keys(tzMap).forEach(function(state){if(loc.indexOf(state)>-1)tz=tzMap[state];});
  STATE.raForm.timezone=tz;
  var el=document.querySelector('input[placeholder="Timezone (auto-detected)"]');
  if(el)el.value=tz;
};

window.raFormEdit=function(jobId){
  var j=STATE.jobs.find(function(x){return x.id===jobId;});
  if(!j)return;
  var cs=STATE.contacts.filter(function(c){return c.job_id===jobId;})
    .sort(function(a,b){return (b.is_primary?1:0)-(a.is_primary?1:0);});
  var co=STATE.companies.find(function(c){return c.id===j.company_id;})||{};
  var savedResearch=parseResearchObject(j.research)||defaultRaFormResearch();
  STATE.raForm={
    editJobId:jobId,
    coName:j.company_name||'',coId:j.company_id,coInfo:null,
    website:co.web||'',industry:j.industry||co.ind||'',
    location:j.location||'',zipCode:'',
    position:j.position||'',jobUrl:j.job_url||'',
    salaryRange:j.salary_range||'',source:j.source||'',
    jobCreatedDate:j.job_created_date||'',
    contacts:cs.length?cs.map(function(c){
      return{firstName:c.first_name,lastName:c.last_name,designation:c.designation,
             email:c.email,phone:c.phone,linkedin:c.linkedin,emailStatus:'',emailDupInfo:null};
    }):[{firstName:'',lastName:'',designation:'',email:'',phone:'',linkedin:'',emailStatus:'',emailDupInfo:null}],
    research:JSON.parse(JSON.stringify(savedResearch))
  };
  STATE.raFormCoSuggestions=[];
  STATE.raFormZipSuggestions=[];
  // Scroll to top of page
  window.scrollTo(0,0);
  render();
};

// ── Autocomplete DOM patchers — update only the dropdown, never the whole page ──
function _patchZipSuggestions(){
  var input=document.getElementById('ra-zip');
  if(!input)return;
  var wrap=input.parentElement;if(!wrap)return;
  var existing=document.getElementById('zip-suggestions');
  var sugs=STATE.raFormZipSuggestions||[];
  if(!sugs.length){if(existing)existing.remove();return;}
  var html='<div id="zip-suggestions" style="position:absolute;top:100%;left:0;right:0;background:var(--card);border:1px solid var(--border2);border-radius:var(--r2);box-shadow:var(--sh2);z-index:100;margin-top:2px">'+
    sugs.map(function(z,i){return'<div class="_zip-sug" data-idx="'+i+'" style="padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px">'+htmlEsc(z.display)+'</div>';}).join('')+'</div>';
  if(existing){existing.outerHTML=html;}else{var d=document.createElement('div');d.innerHTML=html;wrap.appendChild(d.firstChild);}
  Array.prototype.forEach.call(document.querySelectorAll('._zip-sug'),function(el){
    el.addEventListener('mouseenter',function(){this.style.background='var(--accent-l)';});
    el.addEventListener('mouseleave',function(){this.style.background='';});
    el.addEventListener('mousedown',function(e){
      e.preventDefault(); // prevent input blur before selection
      var z=STATE.raFormZipSuggestions[parseInt(this.getAttribute('data-idx'))];
      if(!z)return;
      STATE.raForm.location=z.display;STATE.raForm.zipCode=z.zip;STATE.raFormZipSuggestions=[];
      var loc=document.getElementById('ra-location');if(loc)loc.value=z.display;
      render();
    });
  });
}

function _patchCoSuggestions(){
  var input=document.getElementById('ra-co-name');
  if(!input)return;
  var wrap=input.parentElement;if(!wrap)return;
  var existing=document.getElementById('co-suggestions');
  var sugs=STATE.raFormCoSuggestions||[];
  if(!sugs.length){if(existing)existing.remove();return;}
  var html='<div id="co-suggestions" style="position:absolute;top:100%;left:0;right:0;background:var(--card);border:1px solid var(--border2);border-radius:var(--r2);box-shadow:var(--sh2);z-index:100;max-height:200px;overflow-y:auto;margin-top:2px">'+
    sugs.map(function(co,i){
      var cool=companyCooldownCheck(co.name);
      return'<div class="_co-sug" data-idx="'+i+'" style="padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--border);opacity:'+(cool?'.5':'1')+'">'+
        '<div style="font-weight:500;font-size:13px">'+htmlEsc(co.name)+(cool?'<span style="margin-left:6px;font-size:10px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px">Cooldown '+cool.daysLeft+'d</span>':'')+'</div>'+
        '<div style="font-size:11px;color:var(--text3)">'+htmlEsc(co.industry||'')+(co.location?' · '+htmlEsc(co.location):'')+(co.job_count?' · '+co.job_count+' jobs':'')+(co.bd_name?' · '+htmlEsc(co.bd_name):'')+'</div>'+
      '</div>';
    }).join('')+'</div>';
  if(existing){existing.outerHTML=html;}else{var d=document.createElement('div');d.innerHTML=html;wrap.appendChild(d.firstChild);}
  Array.prototype.forEach.call(document.querySelectorAll('._co-sug'),function(el){
    el.addEventListener('mouseenter',function(){this.style.background='var(--accent-l)';});
    el.addEventListener('mouseleave',function(){this.style.background='';});
    el.addEventListener('mousedown',function(e){
      e.preventDefault(); // prevent input blur before selection
      var co=STATE.raFormCoSuggestions[parseInt(this.getAttribute('data-idx'))];
      if(!co)return;
      STATE.raForm.coName=co.name;STATE.raForm.coId=co.id;STATE.raForm.coInfo=co;
      STATE.raForm.industry=co.industry||STATE.raForm.industry;
      STATE.raForm.location=co.location||STATE.raForm.location;
      STATE.raForm.website=co.website||STATE.raForm.website;
      STATE.raFormCoSuggestions=[];
      if(co.location)raFormDetectTimezone(co.location);
      render();
    });
  });
}

window.raFormZipSearch=function(val){
  STATE.raForm.zipCode=val;
  STATE.raFormTouchedAt=Date.now();
  if(!val||val.length<3){STATE.raFormZipSuggestions=[];_patchZipSuggestions();return;}
  apiGet('/lookup/zipcode?zip='+encodeURIComponent(val)).then(function(results){
    STATE.raFormZipSuggestions=results;_patchZipSuggestions();
  }).catch(function(){STATE.raFormZipSuggestions=[];_patchZipSuggestions();});
};

window.raFormZipBlur=function(){
  if(STATE._rendering)return; // blur from DOM rebuild, not user action — skip
  setTimeout(function(){STATE.raFormZipSuggestions=[];_patchZipSuggestions();},200);
};

// ── Company cooldown helper ─────────────────────
function companyCooldownCheck(coName){
  if(!coName)return null;
  var COOLDOWN_DAYS=21;
  var cutoff=new Date(Date.now()-COOLDOWN_DAYS*24*3600000);
  var match=STATE.jobs.find(function(j){
    if(j.company_name.toLowerCase()!==coName.toLowerCase())return false;
    var d=j.created_at?new Date(j.created_at):j.created_date?new Date(j.created_date):null;
    return d&&d>cutoff;
  });
  if(!match)return null;
  var daysAgo=Math.floor((Date.now()-new Date(match.created_at||match.created_date).getTime())/(24*3600000));
  var daysLeft=COOLDOWN_DAYS-daysAgo;
  return{daysLeft:daysLeft,daysAgo:daysAgo,position:match.position,addedBy:match.created_by_name||'an RA'};
}

window.raFormCoSearch=function(val){
  STATE.raForm.coName=val;STATE.raForm.coId=null;STATE.raForm.coInfo=null;
  STATE.raFormTouchedAt=Date.now();
  if(!val||val.length<3){STATE.raFormCoSuggestions=[];_patchCoSuggestions();return;}
  apiGet('/companies/search?q='+encodeURIComponent(val)).then(function(results){
    STATE.raFormCoSuggestions=results;_patchCoSuggestions();
  }).catch(function(){STATE.raFormCoSuggestions=[];});
};

window.raFormCoBlur=function(){
  if(STATE._rendering)return; // blur from DOM rebuild, not user action — skip
  setTimeout(function(){STATE.raFormCoSuggestions=[];_patchCoSuggestions();},200);
};

window.raFormCheckEmail=function(idx,email){
  if(!email||email.indexOf('@')<0)return;
  var contacts=STATE.raForm.contacts;
  apiPost('/contacts/check-email',{email:email}).then(function(res){
    contacts[idx].emailStatus=res.duplicate?'dup':'ok';
    contacts[idx].emailDupInfo=res;
    scheduleRender();
  }).catch(function(){});
};

window.raFormUpdateContact=function(idx,field,val){
  STATE.raForm.contacts[idx][field]=val;
  if(field==='email')STATE.raForm.contacts[idx].emailStatus='';
  STATE.raFormTouchedAt=Date.now();
};

window.raFormAddContact=function(){
  STATE.raForm.contacts.push({firstName:'',lastName:'',designation:'',email:'',phone:'',linkedin:'',emailStatus:'',emailDupInfo:null});
  raFormEnsureResearch().contacts.push({});
  render();
};

window.raFormRemoveContact=function(idx){
  STATE.raForm.contacts.splice(idx,1);
  var r=raFormEnsureResearch();
  if(r.contacts)r.contacts.splice(idx,1);
  render();
};

window.raFormClear=function(){
  STATE.raForm={coName:'',coId:null,coInfo:null,website:'',industry:'',location:'',zipCode:'',position:'',jobUrl:'',jobCreatedDate:'',salaryRange:'',source:'',editJobId:null,contacts:[{firstName:'',lastName:'',designation:'',email:'',phone:'',linkedin:'',emailStatus:'',emailDupInfo:null}],research:defaultRaFormResearch()};
  STATE.raFormCoSuggestions=[];
  STATE.raFormZipSuggestions=[];
  STATE.raFormTouchedAt=null;
  render();
};

window.raFormSubmit=function(){
  var f=STATE.raForm;
  if(!f.coName){showToast('Company name is required','warning');return;}
  if(!f.location){showToast('Location is required','warning');return;}
  if(!f.position){showToast('Job title is required','warning');return;}
  var validContacts=f.contacts.filter(function(c){return c.firstName||c.email;});
  if(!validContacts.length){showToast('At least one contact is required','warning');return;}
  // 21-day company cooldown check
  var cooldown=companyCooldownCheck(f.coName);
  if(cooldown){showToast(f.coName+' is in a 21-day cooldown. '+cooldown.daysLeft+' day'+(cooldown.daysLeft!==1?'s':'')+' remaining.','warning');return;}

  STATE.raFormSubmitting=true;render();

  function doSave(coId){
    var hasDup=validContacts.some(function(c){return c.emailDupInfo&&c.emailDupInfo.duplicate;});
    var researchPayload=buildRaFormResearchPayload();
    var salaryFromReq=researchPayload&&researchPayload.requirements&&researchPayload.requirements.salary_display;
    var payload={
      company_id:coId,
      position:f.position,
      stage:'Unassigned',
      source:f.source||'Manual',
      location:f.location||undefined,
      industry:f.industry||undefined,
      salary_range:salaryFromReq||f.salaryRange||undefined,
      job_created_date:f.jobCreatedDate||undefined,
      job_url:f.jobUrl||undefined,
      is_duplicate:hasDup,
      research:researchPayload||undefined,
      contacts:validContacts.map(function(c){
        return{first_name:c.firstName,last_name:c.lastName,designation:c.designation,email:c.email,phone:c.phone,linkedin:c.linkedin};
      })
    };
    var isEdit=!!f.editJobId;
    var apiCall=isEdit?apiPut('/jobs/'+f.editJobId,payload):apiPost('/jobs',payload);
    apiCall.then(function(){
      showToast(isEdit?'Lead updated':'Lead submitted successfully','success');
      STATE.raFormSubmitting=false;
      raFormClear();
      refreshJobs();
    }).catch(function(e){
      STATE.raFormSubmitting=false;
      showToast('Failed: '+e.message,'error');
      render();
    });
  }

  if(f.coId){
    doSave(f.coId);
  } else {
    // Create new company first
    var cp={name:f.coName};
    if(f.website)cp.website=f.website;
    if(f.industry)cp.industry=f.industry;
    if(f.location)cp.location=f.location;
    apiPost('/companies',cp).then(function(co){
      STATE.companies.push({id:co.id,name:co.name,web:co.website||'',ind:co.industry||'',loc:co.location||''});
      doSave(co.id);
    }).catch(function(e){
      STATE.raFormSubmitting=false;
      showToast('Failed to create company: '+e.message,'error');
      render();
    });
  }
};

// ── Export leads (RA Lead / Admin) ───────────────
window.openExportLeads=function(){
  var today=todayIST();
  var monthAgo=new Date();monthAgo.setMonth(monthAgo.getMonth()-1);
  var fromDefault=monthAgo.toISOString().split('T')[0];
  STATE.modal='<div class="modal modal-w400">'+
    '<div class="mh"><div class="mt">Export Leads</div><button class="btn-icon" onclick="closeModal()">'+ico('x',14)+'</button></div>'+
    '<div class="mb_">'+
      '<div class="g2 mb3">'+
        '<div class="fgrp"><label class="flbl">From date</label><input type="date" class="inp" id="exp-from" value="'+fromDefault+'"/></div>'+
        '<div class="fgrp"><label class="flbl">To date</label><input type="date" class="inp" id="exp-to" value="'+today+'"/></div>'+
      '</div>'+
      '<div class="fgrp"><label class="flbl">Stage filter</label>'+
        '<select class="sel" id="exp-stage">'+
          '<option value="">All stages</option>'+
          ['Unassigned','Assigned','Connected','Rejected','Future','In Discussion'].map(function(s){return'<option value="'+s+'">'+s+'</option>';}).join('')+
        '</select>'+
      '</div>'+
    '</div>'+
    '<div class="mf"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitExportLeads()">'+ico('dl',13)+' Download Excel</button></div>'+
  '</div>';
  render();
};

window.submitExportLeads=function(){
  var from=(document.getElementById('exp-from')||{}).value||'';
  var to=(document.getElementById('exp-to')||{}).value||'';
  var stage=(document.getElementById('exp-stage')||{}).value||'';
  var url='/jobs/export?from='+from+'&to='+to+(stage?'&stage='+stage:'');
  closeModal();
  showToast('Preparing export\u2026','info');
  apiGet(url).then(function(data){
    if(!data||!data.length){showToast('No leads found for selected range','warning');return;}
    // Build XLSX using the XLSX library
    var rows=[['Date','Company','Website','Industry','Location','Timezone','Freshness','Job Title','Job Created Date','Job Opened Date','Salary Range','Source','BDM Assigned','Stage','First Name','Last Name','Designation','Email','Phone','LinkedIn']];
    data.forEach(function(j){
      var co=j.company||{};
      var contacts=j.contacts||[];
      if(!contacts.length)contacts=[{}];
      contacts.forEach(function(c,ci){
        rows.push([
          ci===0?(j.created_at||'').slice(0,10):'',
          ci===0?htmlEsc(co.name||''):'',
          ci===0?htmlEsc(co.website||''):'',
          ci===0?htmlEsc(j.industry||co.industry||''):'',
          ci===0?htmlEsc(j.location||co.location||''):'',
          ci===0?htmlEsc(j.timezone||''):'',
          ci===0?htmlEsc(j.freshness||''):'',
          ci===0?htmlEsc(j.position||''):'',
          ci===0?htmlEsc(j.job_created_date||''):'',
          ci===0?htmlEsc(j.job_opened_date||''):'',
          ci===0?htmlEsc(j.salary_range||''):'',
          ci===0?htmlEsc(j.source||''):'',
          ci===0?htmlEsc(j.bdm_assigned_name||''):'',
          ci===0?htmlEsc(j.stage||''):'',
          htmlEsc(c.first_name||''),
          htmlEsc(c.last_name||''),
          htmlEsc(c.designation||''),
          htmlEsc(c.email||''),
          htmlEsc(c.phone||''),
          htmlEsc(c.linkedin||'')
        ]);
      });
    });
    var ws=XLSX.utils.aoa_to_sheet(rows);
    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Leads');
    XLSX.writeFile(wb,'FuteGlobal_Leads_'+from+'_to_'+to+'.xlsx');
    showToast(data.length+' leads exported','success');
  }).catch(function(e){showToast('Export failed: '+e.message,'error');});
};

