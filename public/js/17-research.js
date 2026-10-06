// ════════════════════════════════════════════════
// RESEARCH SECTION — inside job detail modal
// ════════════════════════════════════════════════
function parseResearchObject(raw){
  if(!raw)return{};
  if(typeof raw==='string'){
    try{return JSON.parse(raw)||{};}catch(e){return{};}
  }
  return raw||{};
}
function getMergedResearch(job){
  var base=parseResearchObject(job.research);
  var draft=window._researchDraft&&window._researchDraft[job.id];
  if(!draft)return base;
  var merged=Object.assign({},base,draft);
  if(draft.company)merged.company=Object.assign({},base.company||{},draft.company);
  if(draft.outreach)merged.outreach=Object.assign({},base.outreach||{},draft.outreach);
  if(draft.requirements)merged.requirements=Object.assign({},base.requirements||{},draft.requirements);
  if(draft.contacts)merged.contacts=draft.contacts;
  if(draft.jd_raw!==undefined)merged.jd_raw=draft.jd_raw;
  return merged;
}
function canEditResearch(u,j){
  return userHasRole(u,'ra')&&!userHasAnyRole(u,'ra_lead','admin')&&j.created_by===u.id;
}
var SALARY_PERIOD_CONFIG={
  hour:{min:15,max:250,step:5,label:'per hour'},
  week:{min:400,max:15000,step:100,label:'per week'},
  year:{min:30000,max:350000,step:5000,label:'per year'}
};
function getSalaryReqState(req){
  req=req||{};
  var period=req.salary_period||'year';
  var cfg=SALARY_PERIOD_CONFIG[period]||SALARY_PERIOD_CONFIG.year;
  var min=req.salary_min!=null?Number(req.salary_min):Math.round(cfg.min+(cfg.max-cfg.min)*0.3);
  var max=req.salary_max!=null?Number(req.salary_max):Math.round(cfg.min+(cfg.max-cfg.min)*0.6);
  if(min>max){var tmp=min;min=max;max=tmp;}
  min=Math.max(cfg.min,Math.min(cfg.max,min));
  max=Math.max(cfg.min,Math.min(cfg.max,max));
  return{period:period,min:min,max:max,cfg:cfg};
}
function formatSalaryMoney(n,period){
  n=Number(n)||0;
  if(period==='year'&&n>=1000)return'$'+Math.round(n/1000)+'K';
  return'$'+n.toLocaleString();
}
function buildSalaryDisplay(min,max,period){
  var cfg=SALARY_PERIOD_CONFIG[period]||SALARY_PERIOD_CONFIG.year;
  var suffix=period==='year'?'':(' '+cfg.label);
  return formatSalaryMoney(min,period)+'–'+formatSalaryMoney(max,period)+suffix;
}
function syncResearchSkillsArray(req){
  if(!req)return;
  var list=[req.skill_1,req.skill_2,req.skill_3].map(function(s){return String(s||'').trim();}).filter(Boolean);
  req.skills=list.slice(0,3);
}
function renderSalaryRangeControl(idPrefix,req,handlerMode){
  handlerMode=handlerMode||'research';
  var st=getSalaryReqState(req);
  var display=req.salary_display||buildSalaryDisplay(st.min,st.max,st.period);
  var periodOpts=['year','week','hour'].map(function(p){
    var lbl=SALARY_PERIOD_CONFIG[p].label;
    return '<option value="'+p+'"'+(st.period===p?' selected':'')+'>'+lbl.charAt(0).toUpperCase()+lbl.slice(1)+'</option>';
  }).join('');
  var leftPct=((st.min-st.cfg.min)/(st.cfg.max-st.cfg.min))*100;
  var widthPct=((st.max-st.min)/(st.cfg.max-st.cfg.min))*100;
  var onPeriod=handlerMode==='raForm'?'raFormUpdateSalaryPeriod(this.value)':'researchUpdateSalaryPeriod(\''+idPrefix+'\',this.value)';
  var onMin=handlerMode==='raForm'?'raFormUpdateSalaryRange(\'min\',this.value)':'researchUpdateSalaryRange(\''+idPrefix+'\',\'min\',this.value)';
  var onMax=handlerMode==='raForm'?'raFormUpdateSalaryRange(\'max\',this.value)':'researchUpdateSalaryRange(\''+idPrefix+'\',\'max\',this.value)';
  return '<div class="salary-range-wrap" style="grid-column:1/-1">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'+
      '<label class="flbl" style="margin:0">Salary range</label>'+
      '<select class="sel" style="font-size:12px;max-width:160px" onchange="'+onPeriod+'">'+periodOpts+'</select>'+
    '</div>'+
    '<div id="salary-display-'+idPrefix+'" class="fs-15 c-accent" style="font-weight:600;margin-top:6px">'+htmlEsc(display)+'</div>'+
    '<div class="salary-range-track" id="salary-track-'+idPrefix+'">'+
      '<div class="salary-range-fill" id="salary-fill-'+idPrefix+'" style="left:'+leftPct+'%;width:'+widthPct+'%"></div>'+
      '<input type="range" id="salary-min-'+idPrefix+'" min="'+st.cfg.min+'" max="'+st.cfg.max+'" step="'+st.cfg.step+'" value="'+st.min+'" oninput="'+onMin+'"/>'+
      '<input type="range" id="salary-max-'+idPrefix+'" min="'+st.cfg.min+'" max="'+st.cfg.max+'" step="'+st.cfg.step+'" value="'+st.max+'" oninput="'+onMax+'"/>'+
    '</div>'+
    '<div class="fs-11 c-text3" style="display:flex;justify-content:space-between">'+
      '<span>'+formatSalaryMoney(st.cfg.min,st.period)+'</span>'+
      '<span>Drag handles to set min and max</span>'+
      '<span>'+formatSalaryMoney(st.cfg.max,st.period)+'</span>'+
    '</div>'+
  '</div>';
}
function renderResearchSection(j, canEdit){
  var r=getMergedResearch(j);
  var company=r.company||{};
  var outreach=r.outreach||{};
  var req=r.requirements||{};
  var jdRaw=r.jd_raw||'';
  syncResearchSkillsArray(req);

  var headcountOpts=['','1-10','11-50','51-200','201-500','500+'].map(function(v){
    return '<option value="'+v+'"'+(company.headcount===v?' selected':'')+'>'+( v||'— Select —')+'</option>';
  }).join('');
  var hiringOpts=['','Low','Medium','High'].map(function(v){
    return '<option value="'+v+'"'+(company.hiring_volume===v?' selected':'')+'>'+( v||'— Select —')+'</option>';
  }).join('');

  // Contact intel rows
  var cs=(j.contacts||[]);
  var contactIntel=cs.map(function(c,idx){
    var ci=(r.contacts||[])[idx]||{};
    var senOpts=['','Junior','Mid','Senior','Director','VP','C-Level'].map(function(v){
      return '<option value="'+v+'"'+(ci.seniority===v?' selected':'')+'>'+( v||'— Select —')+'</option>';
    }).join('');
    var dmOpts=['','Yes','No','Unknown'].map(function(v){
      return '<option value="'+v+'"'+(ci.decision_maker===v?' selected':'')+'>'+( v||'— Select —')+'</option>';
    }).join('');
    var timeOpts=['','Morning','Afternoon','Evening'].map(function(v){
      return '<option value="'+v+'"'+(ci.best_time===v?' selected':'')+'>'+( v||'— Select —')+'</option>';
    }).join('');
    var cName=escHtml((c.first_name||'')+' '+(c.last_name||'')).trim();

    if(!canEdit){
      // Read-only for BD
      if(!ci.seniority&&!ci.decision_maker&&!ci.best_time&&!ci.notes)return '';
      return '<div style="padding:8px 0;border-bottom:1px solid var(--border)">'+
        '<div class="fs-12" style="font-weight:500;margin-bottom:4px">'+cName+'</div>'+
        '<div class="fs-12 c-text2" style="display:flex;gap:12px;flex-wrap:wrap">'+
          (ci.seniority?'<span>\ud83d\udcbc '+htmlEsc(ci.seniority)+'</span>':'')+
          (ci.decision_maker?'<span>\ud83d\udd11 Decision maker: '+htmlEsc(ci.decision_maker)+'</span>':'')+
          (ci.best_time?'<span>\u23f0 Best time: '+htmlEsc(ci.best_time)+'</span>':'')+
          (ci.notes?'<div class="c-text3" style="width:100%;margin-top:3px">'+htmlEsc(ci.notes)+'</div>':'')+
        '</div>'+
      '</div>';
    }

    return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">'+
      '<div class="fs-12 c-text2" style="font-weight:500;margin-bottom:8px">'+cName+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:6px">'+
        '<div><label class="fs-10 c-text3">Seniority</label><select class="sel" style="font-size:12px;padding:5px 8px" onchange="researchUpdateContact(\''+j.id+'\','+idx+',\'seniority\',this.value)">'+senOpts+'</select></div>'+
        '<div><label class="fs-10 c-text3">Decision maker?</label><select class="sel" style="font-size:12px;padding:5px 8px" onchange="researchUpdateContact(\''+j.id+'\','+idx+',\'decision_maker\',this.value)">'+dmOpts+'</select></div>'+
        '<div><label class="fs-10 c-text3">Best time</label><select class="sel" style="font-size:12px;padding:5px 8px" onchange="researchUpdateContact(\''+j.id+'\','+idx+',\'best_time\',this.value)">'+timeOpts+'</select></div>'+
      '</div>'+
      '<input class="inp" style="font-size:12px" placeholder="Notes about this contact..." value="'+htmlEsc(ci.notes||'')+'" oninput="researchUpdateContact(\''+j.id+'\','+idx+',\'notes\',this.value)"/>'+
    '</div>';
  }).join('');

  if(!canEdit){
    // BD read-only view
    var hasReq=req.skill_1||req.skill_2||req.skill_3||(req.skills||[]).length||req.salary_display||req.location||req.local_hint||req.travel;
    var hasData=company.headcount||company.hiring_volume||company.notes||outreach.angle||outreach.avoid||hasReq||jdRaw;
    if(!hasData&&!contactIntel.trim())return '';
    return '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r2);padding:14px;margin-top:14px">'+
      '<div class="fs-12 c-text3" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">\ud83d\udd2c RA Research</div>'+
      (hasReq?
        '<div style="margin-bottom:10px">'+
          '<div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;margin-bottom:6px">JD requirements</div>'+
          '<div class="fs-12 c-text2" style="display:flex;gap:8px;flex-wrap:wrap">'+
            (req.skill_1?'<span class="c-accent" style="background:var(--accent-l);padding:2px 8px;border-radius:6px">'+htmlEsc(req.skill_1)+'</span>':'')+
            (req.skill_2?'<span class="c-accent" style="background:var(--accent-l);padding:2px 8px;border-radius:6px">'+htmlEsc(req.skill_2)+'</span>':'')+
            (req.skill_3?'<span class="c-accent" style="background:var(--accent-l);padding:2px 8px;border-radius:6px">'+htmlEsc(req.skill_3)+'</span>':'')+
            (req.salary_display?'<span style="background:var(--bg);border:1px solid var(--border);padding:2px 8px;border-radius:6px">'+htmlEsc(req.salary_display)+'</span>':'')+
            (req.location?'<span style="background:var(--bg);border:1px solid var(--border);padding:2px 8px;border-radius:6px">'+htmlEsc(req.location)+'</span>':'')+
            (req.local_hint?'<span style="background:var(--bg);border:1px solid var(--border);padding:2px 8px;border-radius:6px">Local: '+htmlEsc(req.local_hint)+'</span>':'')+
            (req.travel?'<span style="background:var(--bg);border:1px solid var(--border);padding:2px 8px;border-radius:6px">Travel: '+htmlEsc(req.travel)+'</span>':'')+
          '</div>'+
        '</div>':'')+
      (company.expertise?
        '<div style="margin-bottom:10px">'+
          '<div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;margin-bottom:6px">Company expertise</div>'+
          '<div class="fs-12 c-text2">'+htmlEsc(company.expertise)+'</div>'+
        '</div>':'')+
      (contactIntel?'<div style="margin-bottom:10px"><div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;margin-bottom:6px">Contact Intel</div>'+contactIntel+'</div>':'')+
      (company.headcount||company.hiring_volume||company.notes?
        '<div style="margin-bottom:10px">'+
          '<div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;margin-bottom:6px">Company Research</div>'+
          '<div class="fs-12 c-text2" style="display:flex;gap:10px;flex-wrap:wrap">'+
            (company.headcount?'<span style="background:var(--bg);border:1px solid var(--border);padding:2px 8px;border-radius:6px">'+htmlEsc(company.headcount)+' employees</span>':'')+
            (company.hiring_volume?'<span class="c-green" style="background:var(--green-l);padding:2px 8px;border-radius:6px">Hiring: '+htmlEsc(company.hiring_volume)+'</span>':'')+
          '</div>'+
          (company.notes?'<div class="fs-12 c-text2" style="margin-top:6px;padding:8px;background:var(--card);border-radius:var(--r)">'+htmlEsc(company.notes)+'</div>':'')+
        '</div>':'')+
      (outreach.angle||outreach.avoid?
        '<div>'+
          '<div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;margin-bottom:6px">Outreach notes</div>'+
          (outreach.angle?'<div class="fs-12 c-text2" style="margin-bottom:4px">\ud83c\udfaf Angle: '+htmlEsc(outreach.angle)+'</div>':'')+
          (outreach.avoid?'<div class="fs-12 c-red">\u26d4 Avoid: '+htmlEsc(outreach.avoid)+'</div>':'')+
        '</div>':'')+
    '</div>';
  }

  // RA editable view — JD/requirements live on lead form; here: contact intel + company research only
  return '<div style="border-top:2px solid var(--border2);margin-top:18px;padding-top:16px">'+
    '<div class="fs-13" style="font-weight:700;margin-bottom:14px">\ud83d\udd2c Research Notes</div>'+
    '<div class="fs-12 c-text3" style="margin-bottom:14px">Job description and requirements are edited on the lead form. Use this section for contact intel and company research.</div>'+

    (cs.length?
      '<div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Contact Intel</div>'+
      contactIntel:'') +

    '<div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin:14px 0 10px">Company Research</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
      '<div><label class="fs-11 c-text3" style="display:block;margin-bottom:4px">Headcount</label><select class="sel" style="font-size:12px" id="res-headcount" onchange="researchUpdate(\''+j.id+'\',\'company\',\'headcount\',this.value)">'+headcountOpts+'</select></div>'+
      '<div><label class="fs-11 c-text3" style="display:block;margin-bottom:4px">Hiring volume</label><select class="sel" style="font-size:12px" id="res-hiring" onchange="researchUpdate(\''+j.id+'\',\'company\',\'hiring_volume\',this.value)">'+hiringOpts+'</select></div>'+
    '</div>'+
    '<div class="fgrp mb2"><label class="flbl">Company notes / recent news</label><textarea class="txta w100" style="min-height:60px;font-size:12px" id="res-notes" oninput="researchUpdate(\''+j.id+'\',\'company\',\'notes\',this.value)" placeholder="Any relevant company news, context...">'+htmlEsc(company.notes||'')+'</textarea></div>'+
    '<div class="fs-11 c-text3" style="font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin:14px 0 10px">Outreach Notes</div>'+
    '<div class="fgrp mb2"><label class="flbl">Recommended angle</label><input class="inp" style="font-size:12px" placeholder="What angle to use in outreach..." value="'+htmlEsc(outreach.angle||'')+'" oninput="researchUpdate(\''+j.id+'\',\'outreach\',\'angle\',this.value)"/></div>'+
    '<div class="fgrp mb3"><label class="flbl">What to avoid</label><input class="inp" style="font-size:12px" placeholder="Topics or approaches to avoid..." value="'+htmlEsc(outreach.avoid||'')+'" oninput="researchUpdate(\''+j.id+'\',\'outreach\',\'avoid\',this.value)"/></div>'+

    '<div style="display:flex;justify-content:flex-end;padding-top:10px;border-top:1px solid var(--border2)">'+
      '<button onclick="saveResearch(\''+j.id+'\')" class="btn btn-primary btn-sm">\ud83d\udcbe Save research</button>'+
    '</div>'+
  '</div>';
}

// ── Research state management ──────────────────
if(!window._researchDraft)window._researchDraft={};

window.researchUpdate=function(jobId,section,field,val){
  if(!window._researchDraft[jobId])window._researchDraft[jobId]=JSON.parse(JSON.stringify((STATE.jobs.find(function(j){return j.id===jobId;})||{}).research||{}));
  if(section==='jd_raw'&&field==='__root__'){
    window._researchDraft[jobId].jd_raw=val;
    return;
  }
  if(!window._researchDraft[jobId][section])window._researchDraft[jobId][section]={};
  window._researchDraft[jobId][section][field]=val;
};

window.researchUpdateRequirements=function(jobId,field,val){
  if(!window._researchDraft[jobId])window._researchDraft[jobId]=JSON.parse(JSON.stringify((STATE.jobs.find(function(j){return j.id===jobId;})||{}).research||{}));
  if(!window._researchDraft[jobId].requirements)window._researchDraft[jobId].requirements={};
  window._researchDraft[jobId].requirements[field]=val;
  if(field==='skill_1'||field==='skill_2'||field==='skill_3')syncResearchSkillsArray(window._researchDraft[jobId].requirements);
};
function researchRefreshSalaryUi(jobId){
  var draft=window._researchDraft[jobId]||{};
  var req=draft.requirements||{};
  var st=getSalaryReqState(req);
  var displayEl=document.getElementById('salary-display-'+jobId);
  var fillEl=document.getElementById('salary-fill-'+jobId);
  var minEl=document.getElementById('salary-min-'+jobId);
  var maxEl=document.getElementById('salary-max-'+jobId);
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
window.researchUpdateSalaryRange=function(jobId,which,val){
  if(!window._researchDraft[jobId])window._researchDraft[jobId]=JSON.parse(JSON.stringify((STATE.jobs.find(function(j){return j.id===jobId;})||{}).research||{}));
  if(!window._researchDraft[jobId].requirements)window._researchDraft[jobId].requirements={};
  var req=window._researchDraft[jobId].requirements;
  var st=getSalaryReqState(req);
  var num=Number(val);
  if(which==='min'){
    req.salary_min=Math.min(num,st.max);
  } else {
    req.salary_max=Math.max(num,st.min);
  }
  req.salary_display=buildSalaryDisplay(req.salary_min,req.salary_max,req.salary_period||st.period);
  req.salary_range=req.salary_display;
  researchRefreshSalaryUi(jobId);
};
window.researchUpdateSalaryPeriod=function(jobId,period){
  if(!window._researchDraft[jobId])window._researchDraft[jobId]=JSON.parse(JSON.stringify((STATE.jobs.find(function(j){return j.id===jobId;})||{}).research||{}));
  if(!window._researchDraft[jobId].requirements)window._researchDraft[jobId].requirements={};
  var req=window._researchDraft[jobId].requirements;
  req.salary_period=period;
  var st=getSalaryReqState(req);
  req.salary_min=st.min;
  req.salary_max=st.max;
  req.salary_display=buildSalaryDisplay(st.min,st.max,period);
  req.salary_range=req.salary_display;
  render();
};

window.parseJobDescription=function(jobId){
  var jdEl=document.getElementById('res-jd-raw');
  var jdText=jdEl?jdEl.value:(window._researchDraft[jobId]&&window._researchDraft[jobId].jd_raw)||'';
  if(!jdText||!jdText.trim()){showToast('Paste a job description first','warning');return;}
  var job=STATE.jobs.find(function(j){return j.id===jobId;})||{};
  var industry=job.industry||(job.company&&job.company.industry)||'';
  apiPost('/jobs/'+jobId+'/parse-jd',{jd_text:jdText,industry:industry}).then(function(parsed){
    if(!window._researchDraft[jobId])window._researchDraft[jobId]=JSON.parse(JSON.stringify(job.research||{}));
    window._researchDraft[jobId].jd_raw=jdText;
    window._researchDraft[jobId].requirements=Object.assign({},window._researchDraft[jobId].requirements||{},parsed);
    var skills=parsed.skills||[];
    window._researchDraft[jobId].suggested_skills=parsed.suggested_skills||parsed.skills||[];
    var skills=window._researchDraft[jobId].suggested_skills;
    if(skills[0])window._researchDraft[jobId].requirements.skill_1=skills[0];
    if(skills[1])window._researchDraft[jobId].requirements.skill_2=skills[1];
    if(skills[2])window._researchDraft[jobId].requirements.skill_3=skills[2];
    syncResearchSkillsArray(window._researchDraft[jobId].requirements);
    if(parsed.travel&&!['none','25%','required'].includes(parsed.travel)){
      window._researchDraft[jobId].requirements.travel=parsed.travel.indexOf('25')>-1?'25%':'required';
    }
    var n=skills.length;
    showToast(n?'Extracted '+n+' skill'+(n!==1?'s':'')+' — review and save':'Extracted — review fields and save','success');
    render();
  }).catch(function(e){showToast('Extract failed: '+e.message,'error');});
};

window.researchUpdateContact=function(jobId,idx,field,val){
  if(!window._researchDraft[jobId])window._researchDraft[jobId]={};
  if(!window._researchDraft[jobId].contacts)window._researchDraft[jobId].contacts=[];
  while(window._researchDraft[jobId].contacts.length<=idx)window._researchDraft[jobId].contacts.push({});
  window._researchDraft[jobId].contacts[idx][field]=val;
};

window.saveResearch=function(jobId){
  var draft=window._researchDraft[jobId];
  if(!draft){showToast('Nothing to save','warning');return;}
  // Merge with existing research
  var j=STATE.jobs.find(function(x){return x.id===jobId;})||{};
  var merged=Object.assign({},j.research||{},draft);
  if(draft.company)merged.company=Object.assign({},( j.research&&j.research.company)||{},draft.company);
  if(draft.outreach)merged.outreach=Object.assign({},(j.research&&j.research.outreach)||{},draft.outreach);
  if(draft.requirements)merged.requirements=Object.assign({},(j.research&&j.research.requirements)||{},draft.requirements);
  if(draft.jd_raw!==undefined)merged.jd_raw=draft.jd_raw;
  if(draft.contacts)merged.contacts=draft.contacts;
  if(draft.suggested_skills)merged.suggested_skills=draft.suggested_skills;
  if(merged.requirements){
    syncResearchSkillsArray(merged.requirements);
    if(!merged.requirements.salary_display&&merged.requirements.salary_min!=null&&merged.requirements.salary_max!=null){
      merged.requirements.salary_display=buildSalaryDisplay(merged.requirements.salary_min,merged.requirements.salary_max,merged.requirements.salary_period||'year');
      merged.requirements.salary_range=merged.requirements.salary_display;
    }
  }
  apiFetch('PATCH','/jobs/'+jobId+'/research',{research:merged}).then(function(res){
    var saved=parseResearchObject((res&&res.research)||merged);
    STATE.jobs=STATE.jobs.map(function(x){return x.id===jobId?Object.assign({},x,{research:saved}):x;});
    delete window._researchDraft[jobId];
    showToast('Research saved','success');
    render();
  }).catch(function(e){showToast('Failed: '+e.message,'error');});
};

