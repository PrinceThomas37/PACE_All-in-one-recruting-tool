// ── Auth ───────────────────────────────────────
window.guestSwitchRole=function(role){
  if(!STATE.user||!STATE.user.isGuest)return;
  var roleMap={bd:{role:'bd',roles:['bd'],av:'G',avc:'av-bd',desig:'BD Manager'},ra:{role:'ra',roles:['ra'],av:'G',avc:'av-ra',desig:'Research Analyst'},ra_lead:{role:'ra_lead',roles:['ra_lead'],av:'G',avc:'av-admin',desig:'RA Lead'}};
  var r=roleMap[role];if(!r)return;
  Object.assign(STATE.user,r);
  STATE.page='dashboard';
  sessionStorage.setItem('fg_user',JSON.stringify(STATE.user));
  showToast('Switched to '+r.desig+' view','info');
  render();
};

window.doGuestLogin=function(){
  STATE.loading=false;
  // Seed demo users
  var demoUsers=[
    {id:'guest',name:'Guest User',email:'guest@futeglobal.com',role:'bd',roles:['bd'],av:'G',avc:'av-bd',empId:'GUEST',desig:'BD Manager',isGuest:true},
    {id:'demo-ra',name:'Demo Analyst',email:'analyst@futeglobal.com',role:'ra',roles:['ra'],av:'DA',avc:'av-ra',empId:'FG-D01',desig:'Research Analyst',isGuest:true},
    {id:'demo-bd2',name:'Alex Rivera',email:'alex@futeglobal.com',role:'bd',roles:['bd'],av:'AR',avc:'av-bd',empId:'FG-D02',desig:'BD Manager',isGuest:true},
  ];
  // Seed demo jobs
  var demoJobs=[
    {id:'dj1',company_name:'Apex Construction Group',company_id:'dc1',position:'Project Manager',industry:'Architecture, Construction & Building Materials',location:'Dallas, TX',timezone:'CST',stage:'Assigned',assigned_to_bd:'guest',assigned_bd_name:'Guest User',created_by:'demo-ra',created_date:'2026-04-29',created_at:'2026-04-29T08:00:00Z',is_duplicate:false,freshness:'New'},
    {id:'dj2',company_name:'Meridian Financial',company_id:'dc2',position:'VP Finance',industry:'Banking & Financial Services',location:'New York, NY',timezone:'EST',stage:'Connected',assigned_to_bd:'guest',assigned_bd_name:'Guest User',created_by:'demo-ra',created_date:'2026-04-28',created_at:'2026-04-28T09:00:00Z',is_duplicate:false,freshness:'New'},
    {id:'dj3',company_name:'TechNova Solutions',company_id:'dc3',position:'Head of Engineering',industry:'Computer Hardware & Software',location:'San Francisco, CA',timezone:'PST',stage:'Unassigned',assigned_to_bd:null,assigned_bd_name:null,created_by:'demo-ra',created_date:'2026-04-29',created_at:'2026-04-29T10:00:00Z',is_duplicate:false,freshness:'New'},
    {id:'dj4',company_name:'GreenPath Energy',company_id:'dc4',position:'Operations Director',industry:'Energy, Utilities, Oil & Petroleum',location:'Houston, TX',timezone:'CST',stage:'Unassigned',assigned_to_bd:null,assigned_bd_name:null,created_by:'demo-ra',created_date:'2026-04-29',created_at:'2026-04-29T11:00:00Z',is_duplicate:false,freshness:'New'},
    {id:'dj5',company_name:'Coastal Legal Partners',company_id:'dc5',position:'Managing Partner',industry:'Law Enforcement, Legal & Security',location:'Miami, FL',timezone:'EST',stage:'Future',assigned_to_bd:'guest',assigned_bd_name:'Guest User',created_by:'demo-ra',created_date:'2026-04-27',created_at:'2026-04-27T08:00:00Z',is_duplicate:false,freshness:'Normal'},
  ];
  var demoContacts=[
    {id:'dc1',job_id:'dj1',first_name:'Karen',last_name:'Hadley',designation:'Project Manager',email:'khadley@apexconstruction.com',phone:'',linkedin:'',email_status:'valid',phone_type:'office'},
    {id:'dc2',job_id:'dj2',first_name:'Robert',last_name:'Chen',designation:'VP Finance',email:'rchen@meridianfinancial.com',phone:'',linkedin:'',email_status:'valid',phone_type:'office'},
    {id:'dc3',job_id:'dj3',first_name:'Sarah',last_name:'Kim',designation:'Head of Engineering',email:'skim@technova.io',phone:'',linkedin:'',email_status:'valid',phone_type:'personal'},
    {id:'dc4',job_id:'dj4',first_name:'Marcus',last_name:'Webb',designation:'Operations Director',email:'mwebb@greenpathenergy.com',phone:'',linkedin:'',email_status:'valid',phone_type:'office'},
    {id:'dc5',job_id:'dj5',first_name:'Diana',last_name:'Torres',designation:'Managing Partner',email:'dtorres@coastallegal.com',phone:'',linkedin:'',email_status:'out_of_office',phone_type:'office'},
  ];
  var demoPending=[
    {id:'de1',job_id:'dj1',contact_id:'dc1',to_email:'khadley@apexconstruction.com',subject:'Project Manager opportunity at Apex Construction Group',body:'Hi Karen,\n\nI came across Apex Construction Group and was impressed by your project portfolio.\n\nAt Fute Global, we specialize in connecting organizations with top-tier talent. Given your role, I believe we could assist with your Project Manager search.\n\nWould you be open to a quick 15-minute call?\n\nBest,\nGuest User\nFute Global LLC',status:'pending',followup_type:'initial',contact:{first_name:'Karen',last_name:'Hadley'},job:{position:'Project Manager',company:{name:'Apex Construction Group'}}},
  ];
  STATE.user=demoUsers[0];
  STATE.token='guest';
  STATE.jobs=demoJobs;
  STATE.contacts=demoContacts;
  STATE.users=demoUsers;
  STATE.companies=[
    {id:'dc1',name:'Apex Construction Group',ind:'Architecture, Construction & Building Materials',loc:'Dallas, TX'},
    {id:'dc2',name:'Meridian Financial',ind:'Banking & Financial Services',loc:'New York, NY'},
    {id:'dc3',name:'TechNova Solutions',ind:'Computer Hardware & Software',loc:'San Francisco, CA'},
  ];
  STATE.reminders=[];
  STATE.pendingEmails=demoPending;
  STATE.sentEmails=[];
  STATE.emailAccounts=[{id:'ge1',email_address:'guest@futeglobal.com',display_name:'Guest User',platform:'Gmail',is_connected:true}];
  STATE.page='dashboard';
  sessionStorage.setItem('fg_token','guest');
  sessionStorage.setItem('fg_user',JSON.stringify(STATE.user));
  render();
  showToast('Welcome! Explore the full workflow as Guest · Portfolio preview','info');
};

// ── Guest simulation layer ──────────────────────
window.guestSimulate=function(action,payload){
  if(!STATE.user||!STATE.user.isGuest)return false;
  switch(action){
    case 'addJob':
      var newJob={id:'dj'+Date.now(),company_name:payload.coName||'Demo Company',company_id:'demo',position:payload.position||'Demo Position',industry:payload.industry||'Computer Hardware & Software',location:payload.location||'New York, NY',timezone:'EST',stage:'Unassigned',assigned_to_bd:null,assigned_bd_name:null,created_by:'guest',created_date:todayIST(),created_at:new Date().toISOString(),is_duplicate:false,freshness:'New'};
      STATE.jobs.unshift(newJob);
      (payload.contacts||[]).forEach(function(c,i){STATE.contacts.push({id:'dc'+Date.now()+i,job_id:newJob.id,first_name:c.firstName||'',last_name:c.lastName||'',designation:c.designation||'',email:c.email||'',phone:c.phone||'',linkedin:c.linkedin||'',email_status:'valid',phone_type:c.phoneType||'office'});});
      STATE.modal=null;STATE.raForm=null;
      showToast('Lead added successfully (demo)','success');render();return true;
    case 'importExcel':
      [['BuildRight Inc','Site Superintendent','Architecture, Construction & Building Materials','Phoenix, AZ','MST','Tom','Bradley','tbradley@buildright.com'],
       ['Summit Healthcare','Director of Operations','Healthcare & Health Services','Chicago, IL','CST','Lisa','Monroe','lmonroe@summithealth.com'],
       ['Vector Capital','CFO','Banking & Financial Services','Boston, MA','EST','James','Whitfield','jwhitfield@vectorcap.com'],
       ['Nova Logistics','VP Supply Chain','Airline, Aviation & Transportation','Atlanta, GA','EST','Angela','Park','apark@novalogistics.com'],
       ['ClearSky Energy','Project Engineer','Energy, Utilities, Oil & Petroleum','Denver, CO','MST','Carlos','Vega','cvega@clearsky.com']
      ].forEach(function(d){var jid='dji'+Date.now()+Math.random();STATE.jobs.unshift({id:jid,company_name:d[0],company_id:jid,position:d[1],industry:d[2],location:d[3],timezone:d[4],stage:'Unassigned',assigned_to_bd:null,assigned_bd_name:null,created_by:'guest',created_date:todayIST(),created_at:new Date().toISOString(),is_duplicate:false,freshness:'New'});STATE.contacts.push({id:'dci'+Date.now()+Math.random(),job_id:jid,first_name:d[5],last_name:d[6],designation:d[1],email:d[7],phone:'',linkedin:'',email_status:'valid',phone_type:'office'});});
      STATE.modal=null;showToast('Imported 5 demo leads successfully','success');render();return true;
    case 'sendEmail':
      showToast('Email sent to '+(payload&&payload.to||'contact')+' (demo)','success');
      STATE.modal=null;STATE.mailMerge=null;render();return true;
    case 'assignLeads':
      var unassigned=STATE.jobs.filter(function(j){return j.stage==='Unassigned';});
      var n=Math.min(payload&&payload.count||3,unassigned.length);
      unassigned.slice(0,n).forEach(function(j){j.stage='Assigned';j.assigned_to_bd='guest';j.assigned_bd_name='Guest User';j.assigned_at=new Date().toISOString();});
      showToast('Assigned '+n+' leads to Guest User (demo)','success');render();return true;
    case 'connectEmail':
      STATE.emailAccounts=[{id:'ge1',email_address:'guest@futeglobal.com',display_name:'Guest User',platform:'Gmail',is_connected:true}];
      showToast('Email account connected (demo)','success');render();return true;
    case 'stageChange':
      var sj=STATE.jobs.find(function(x){return x.id===payload.id;});
      if(sj){sj.stage=payload.stage;showToast('Stage updated (demo)','success');render();}return true;
  }
  return false;
};

window.doLogin=function(){
  if(IS_FILE){showToast('Open PACE in your browser, not from a file','warning');return;}
  var em=(document.getElementById('login-email')||{}).value||'';
  var pw=(document.getElementById('login-pass')||{}).value||'';
  if(!em||!pw){var e=document.getElementById('login-err');if(e){e.textContent='Enter email and password';e.style.display='block';}return;}
  // Clear any guest session before attempting real login
  STATE.token=null;STATE.user=null;
  sessionStorage.removeItem('fg_token');sessionStorage.removeItem('fg_user');
  STATE.loading=true;render();
  apiPost('/auth/login',{email:em,password:pw}).then(function(d){
    STATE.token=d.token;STATE.user=normaliseUser(d.user);
    sessionStorage.setItem('fg_token',d.token);sessionStorage.setItem('fg_user',JSON.stringify(STATE.user));
    STATE.page='dashboard';loadAppData();
  }).catch(function(err){
    STATE.loading=false;render();
    var e=document.getElementById('login-err');if(e){e.textContent=err.message||'Invalid credentials';e.style.display='block';}
  });
};
window.loginAs=function(){showToast('Use email + password to log in','warning');};
window.doLogout=function(){STATE.user=null;STATE.token=null;sessionStorage.removeItem('fg_token');sessionStorage.removeItem('fg_user');STATE.jobs=[];STATE.contacts=[];STATE.page='login';render();};

