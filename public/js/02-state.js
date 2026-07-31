// ════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════

// One canonical colour per lead stage, used everywhere (leads table + its stage
// selects, the top status chips, the lead detail modal, and the individual
// dashboard). Owner's spec: Assigned = blue, Connected = green, Rejected = red,
// Unassigned = grey, and two distinct colours for the middle stages.
window.LEAD_STAGE_COLORS = {
  Unassigned: '#94a3b8',      // grey
  Assigned:   '#3b82f6',      // blue
  Connected:  '#10b981',      // green
  'In Discussion': '#8b5cf6', // violet
  Future:     '#f59e0b',      // amber
  Rejected:   '#ef4444'       // red
};
// Soft background tint for a stage (hex + alpha).
window.leadStageBg = function(stage){ return (window.LEAD_STAGE_COLORS[stage]||'#64748b') + '1a'; };
window.leadStageColor = function(stage){ return window.LEAD_STAGE_COLORS[stage] || '#64748b'; };

// ════════════════════════════════════════════════
// JOBS / CONTACTS MODEL  (matches backend index.js)
// ════════════════════════════════════════════════
function genJobs(seedLeads, companies){
  // Group seedLeads by (company + position) -> 1 job + N contacts
  var jobs = [], contacts = [], jmap = {};
  var stages = ["Active","In Progress","Interview","Closed","Lost"];
  for (var i=0;i<seedLeads.length;i++){
    var l = seedLeads[i];
    var key = l.coid + "||" + l.pos;
    var jid = jmap[key];
    if (!jid){
      jid = "j" + (jobs.length+1);
      jmap[key] = jid;
      var co = companies.find(function(c){return c.id===l.coid;}) || {};
      jobs.push({
        id: jid,
        company_id: l.coid,
        company_name: co.name || "",
        company_ind: co.ind || "",
        company_web: co.web || "",
        position: l.pos,
        location: l.loc || "",
        source: l.src || "LinkedIn",
        job_url: "",
        stage: stages[Math.floor(Math.random()*3)],
        notes: "",
        created_by: l.aid,
        assigned_to: l.aid,
        created_date: l.created || new Date().toISOString().slice(0,10),
        created_at: new Date().toISOString()
      });
    }
    contacts.push({
      id: "c" + (contacts.length+1),
      job_id: jid,
      first_name: l.fn,
      last_name: l.ln || "",
      designation: l.desig || "",
      email: l.email || "",
      phone: l.phone || "",
      linkedin: "",
      is_primary: contacts.filter(function(c){return c.job_id===jid;}).length===0,
      email_sent_at: l.sent || null
    });
  }
  return { jobs: jobs, contacts: contacts };
}
function getMyJobs(u){
  if (!u) return [];
  if (userHasAnyRole(u,'admin','ra_lead')) return STATE.jobs.slice();
  if (userHasRole(u,'bd_lead')) return STATE.jobs.filter(function(j){return j.assigned_to_bd!==null;});
  if (userHasRole(u,'bd')) return STATE.jobs.filter(function(j){return j.assigned_to_bd===u.id;});
  // ra: only jobs they created
  return STATE.jobs.filter(function(j){return j.created_by===u.id;});
}
function jobContacts(jid){
  return STATE.contacts.filter(function(c){return c.job_id===jid;})
    .sort(function(a,b){return (b.is_primary?1:0)-(a.is_primary?1:0);});
}
function jobById(id){ return STATE.jobs.find(function(j){return j.id===id;}); }
function escAttr(v){ return String(v==null?"":v).replace(/"/g,"&quot;").replace(/</g,"&lt;"); }
function escHtml(v){ return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function getIndustriesList(){
  return (STATE.industriesList&&STATE.industriesList.length)?STATE.industriesList:[];
}
function buildIndustrySelectOptions(selected){
  var list=getIndustriesList().slice();
  if(selected&&list.indexOf(selected)===-1)list.unshift(selected);
  return [''].concat(list).map(function(v){
    return '<option value="'+escAttr(v)+'"'+(selected===v?' selected':'')+'>'+(v||'— Select Industry —')+'</option>';
  }).join('');
}

var STATE = {

  user: null,
  page: "dashboard",
  users: JSON.parse(JSON.stringify(USERS)),
  leads: genLeads(),
  companies: JSON.parse(JSON.stringify(COMPANIES)),
  activities: [],
  emails: [],
  toasts: [],
  modal: null,
  detailLead: null,
  leadsFilter: {search:"",stage:"all",date:"today",ind:"all"},
  leadsSelected: {},
  leadsPage: 0,
  leadsPageSize: 20,
  mailMerge: null,
  period: "monthly",
  emailTab: "compose",
  sendProgress: null,
  pendingSummary: null,
  _pendingSummaryTimer: null,
  _progressPollTimer: null,
  previewEmail: null,
  showEmailPreview: false,
  mergeLeadId: null,
  emailSearch: null,
  manualEmail: null,
  manualEmailName: null,
  aiPrompt: null,
  aiPromptDefault: "Write a concise, professional cold outreach email (3-4 short paragraphs). Open with a personalised hook referencing their company or role. Briefly introduce Fute Global as a specialist staffing firm. Include a soft CTA asking for a 15-min call. Be warm but direct — no fluff.",
  emailSubj: "Candidates for your {{pos}} role in {{loc}}",
  emailBody: "Hi {{fn}},\n\nI'm {{sender}} with Fute Global LLC. I came across your {{pos}} opening in {{loc}} and read through the requirements, and we have several people with {{job_resp}} experience on {{company_service}} work who look like a strong fit. They're open to direct hire and haven't been screened for your role yet.\n\nWould you like to review their resumes?\n\nLooking forward to your thoughts.",
  fu1Subj: "Re: Candidates for your {{pos}} role in {{loc}}",
  fu1Body: "Hi {{fn}},\n\nCircling back on your {{pos}} role in {{loc}}. Those candidates with {{job_resp}} experience on {{company_service}} projects are still available.\n\nWant me to send their resumes over?\n\nLooking forward to your thoughts.",
  fu2Subj: "Re: Candidates for your {{pos}} role in {{loc}}",
  fu2Body: "Hi {{fn}},\n\nI'll keep this short. Still holding a few screened-ready candidates with {{job_resp}} backgrounds for your {{pos}} opening in {{loc}} whenever the timing suits.\n\nShall I share their resumes?\n\nLooking forward to your thoughts.",
  appSettings: {},
  teamAssignments: [],
  userEmailsCache: {},      // userId -> array of user_emails
  managerUsersTab: 'bd',    // 'ra' | 'bd' | 'rateam' | 'bdteam'
  selectedManagerUser: null,
  genEmail: null,
  aiGenerating: false,
  adminTab: "all",
  adminSearch: "",
  adminView: "bd",
  adminSelectedUser: null,
  addUserForm: null,
  reminders: [],
  reminderTab: "ooo",
  reminderSearch: null,
  viewingUser: null,
  importPreview: null,
  importWB: null,
  importSheet: null,
  jobs: [],
  contacts: [],
  detailJob: null,
  industriesList: [],
  jobsFilter: {search:"",stages:[],industries:[],dateRange:"all",dateFrom:"",dateTo:""},
  openDrop: null,
  assignSel: {},
  assignTargetBD: "",
  distributePoolStats: null,
  _assignManagerId: null,
  _assignRatio: null,
  todaySummary: null,
  insightsData: null,
  insightsSelectedRA: null,
  bdInsightsData: null,
  bdLeadSelectedBD: null,
  bdInsightsData: null,
  assignFilter: {ra:"",dup:"all"},
  pendingEmails: [],
  previewPendingId: null,
  emailAccounts: [],
  composeContactId: null,
  composeCompanyId: null,
  composeFromEmailId: null,
  composeSubj: '',
  composeBody: '',
  composeContext: null,
  composeReminderId: null,
  showAIPanel: false,
  signatureHtml: '',
  sigEmailId: null,
  emailSignaturesCache: {},
  planFromEmailId: null,
  outreachStylePreset: 'v1',
  composeStylePreset: null,
  randomTemplateMode: false,
  varInsertTarget: 'body',
  showMoreVarChips: false,
  sigEditing: false,
  sigLayout: 'simple',
  raForm: {
    coName:'',coId:null,coInfo:null,website:'',industry:'',location:'',zipCode:'',
    position:'',jobUrl:'',jobCreatedDate:'',salaryRange:'',source:'',editJobId:null,
    contacts:[{firstName:'',lastName:'',designation:'',email:'',phone:'',linkedin:'',emailStatus:'',emailDupInfo:null}],
    research:{jd_raw:'',suggested_skills:[],company:{expertise:'',notes:'',headcount:'',hiring_volume:''},outreach:{angle:'',avoid:''},requirements:{skill_1:'',skill_2:'',skill_3:'',salary_min:null,salary_max:null,salary_period:'year',salary_display:'',location:'',local_hint:'',travel:''},contacts:[]}
  },
  raFormCoSuggestions:[],
  raFormZipSuggestions:[],
  raFormSubmitting:false,
};

// No pre-seeded reminders — users set them manually from the OOO list
STATE.activities = genActs(STATE.leads);
var _seed = genJobs(STATE.leads, STATE.companies);
STATE.jobs = _seed.jobs;
STATE.contacts = _seed.contacts;
STATE.emails = STATE.leads.filter(function(l){return l.sent}).slice(0,6).map(function(l,i){
  var co=STATE.companies.find(function(c){return c.id===l.coid})||{};
  var body="Hi "+l.fn+",\n\nI came across "+co.name+" and was really impressed by what you're building in the "+(co.ind||"")+" space.\n\nAt Fute Global, we specialize in connecting organizations with top-tier talent. Given your role as "+l.desig+", I believe we could be genuinely helpful with your "+l.pos+" search.\n\nWould you be open to a quick 15-minute call this week?\n\nWarm regards,\nFute Global LLC";
  return{id:"e"+i,lid:l.id,by:l.aid,to:l.email,subj:"Connecting re: "+l.pos+" at "+(co?co.name:""),body:body,plt:l.plt||"Gmail",dt:l.sent,status:"sent"};
});

