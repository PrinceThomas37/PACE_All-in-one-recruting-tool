// ════════════════════════════════════════════════
// RENDER LOGIN
// ════════════════════════════════════════════════
function renderLogin(){
  var tab=STATE.loginTab||'login';
  function tabBtn(id,label,icon){
    var on=tab===id;
    return '<button onclick="STATE.loginTab=\''+id+'\';STATE.loginErr=null;render()" '+
      'style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:11px 8px;border:0;cursor:pointer;font-family:inherit;'+
      'font-size:13.5px;font-weight:600;border-radius:8px;'+
      'background:'+(on?'var(--text)':'transparent')+';color:'+(on?'#fff':'var(--text2)')+'">'+
      (icon||'')+label+'</button>';
  }

  var err=STATE.loginErr
    ? '<div style="color:var(--red);font-size:12px;background:var(--red-l);padding:8px 10px;border-radius:var(--r);margin-bottom:12px">'+htmlEsc(STATE.loginErr)+'</div>'
    : '<div id="login-err" style="display:none;color:var(--red);font-size:12px;background:var(--red-l);padding:8px 10px;border-radius:var(--r);margin-bottom:12px"></div>';

  var body = tab==='signup' ? renderSignupPanel() :
    // ── Log In ──────────────────────────────────────────────────────────────
    ssoButtons()+
    orgSsoButton()+
    '<div class="or-div">Or</div>'+
    '<div class="fgrp"><label class="flbl">Email</label><input class="inp" id="login-email" type="email" placeholder="Work email"/></div>'+
    '<div class="fgrp"><label class="flbl">Password</label><div style="position:relative"><input class="inp" id="login-pass" type="password" placeholder="Enter your password" style="padding-right:40px"/><button type="button" onclick="var i=document.getElementById(\'login-pass\');i.type=i.type===\'password\'?\'text\':\'password\'" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;color:var(--text3);padding:0;display:flex;align-items:center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div>'+
    err+
    '<button class="btn btn-primary w100" style="justify-content:center" onclick="doLogin()">Log In</button>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:10px">'+
      '<label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text2);cursor:pointer">'+
        '<input type="checkbox" id="login-remember" checked style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer"/> Keep me signed in'+
      '</label>'+
      '<button onclick="showForgotPassword()" style="background:none;border:0;padding:0;font-size:12.5px;color:var(--text2);text-decoration:underline;cursor:pointer;font-family:inherit">Forgot password?</button>'+
    '</div>';

  return '<div class="login-wrap">'+
    '<canvas id="login-canvas" style="position:fixed;inset:0;width:100%;height:100%;z-index:0"></canvas>'+
    '<div class="login-card" style="position:relative;z-index:2">'+
      '<div class="login-top">'+
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">'+
          '<div style="line-height:1;flex-shrink:0"><span style="font-family:var(--display);font-weight:700;font-size:36px;color:#fff;letter-spacing:-.5px">PA</span><span style="font-family:var(--display);font-weight:700;font-size:36px;color:#F5C23B;letter-spacing:-.5px">CE</span></div>'+
          '<div><div style="font-family:var(--display);font-weight:700;font-size:17px;color:#fff;line-height:1.25">All-in-one Recruiting Platform</div><div style="font-size:12px;color:rgba(255,255,255,.82);margin-top:3px">Applicant tracking · Lead management · Outreach</div></div>'+
        '</div>'+
        '<div style="font-size:11.5px;color:rgba(255,255,255,.65);border-top:1px solid rgba(255,255,255,.2);padding-top:10px">Sign in to your workspace</div>'+
      '</div>'+
      '<div class="login-body">'+
        '<div style="display:flex;gap:4px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:4px;margin-bottom:18px">'+
          tabBtn('login','Log In','')+
          tabBtn('signup','Sign Up','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>')+
        '</div>'+
        body+
      '</div>'+
    '</div>'+
  '</div>';
}


// The shell, in FOUR independently drawable regions: the rail, the topbar, the
// page, and the layer above the page (modal + overlays).
//
// renderApp() assembles them for a first paint and records each piece in
// window._shellParts, so the render engine knows exactly what is on screen and
// can later rewrite ONLY the region whose string changed. That is the whole
// trick behind the flicker fix: a badge going 24 → 23 rewrites the rail, and
// leaves the message you are reading — iframe, scroll position and all —
// untouched.
function renderApp(){
  var parts=window._shellParts=window._shellParts||{};
  parts.sidebar=renderSidebar();
  parts.topbar=renderTopbar();
  parts.content=renderPageContent();
  parts.modal=renderModal();
  parts.overlays=UI.renderOverlays();
  // The nav scrim sits between the four patched regions on purpose: it has no
  // state of its own (it is shown by `body.nav-open`, and hidden outright above
  // 860px), so patchShell() never touches it and it survives every repaint.
  // Anything with state belongs in a region; this has none.
  return parts.sidebar+
    '<div id="nav-scrim" onclick="closeNav()"></div>'+
    '<div id="main">'+parts.topbar+'<div id="content">'+parts.content+'</div></div>'+
    renderToasts()+
    '<div id="layer">'+parts.modal+parts.overlays+'</div>';
}

// The page body: a registered page draws itself, everything else goes through
// the original renderPage() switch.
function renderPageContent(){
  if(UI.hasPage(STATE.page)) return UI.pageHtml(STATE.page);
  return renderPage();
}

function renderSidebar(){
  var u=STATE.user;
  var today=todayIST();
  var myLeads=getMyLeads(u);
  var todayCnt=myLeads.filter(function(l){return l.date===today}).length;

  // ── Sidebar menu (single source of truth) ────────────────────────────────
  // Every nav item is built here, in one deterministic order. (Historically the
  // BD Jobs / Candidates / Clients / Reports / My Team items were injected into
  // the DOM by their own page modules, which made ordering depend on script load
  // order and left "My Team" stranded at the bottom. They now live here.)
  var isAdmin=userHasRole(u,'admin');
  var bdm=userHasAnyRole(u,'admin','bd','bd_lead');          // BD desk: Jobs/Clients/Candidates
  var pureRec=isPureRecruiter(u);
  var recruiter=userHasRole(u,'recruiter');
  var raOnly=userHasRole(u,'ra')&&!userHasAnyRole(u,'admin','bd','bd_lead','ra_lead');
  // "Team lead" is data-driven: anyone with at least one direct report. They get
  // the "My Team" hub (which folds in Team Insights + Reports as tabs), so the
  // standalone Reports item is only for people who DON'T have My Team — a plain
  // recruiter or a report-less BD still needs their own numbers somewhere.
  var leadsAnyTeam=!!(window.directReportsOf&&directReportsOf(u.id).length);
  var canReports=userHasAnyRole(u,'admin','bd','bd_lead','ra_lead','recruiter');
  var remBadge=STATE.reminders.filter(function(r){return r.user_id===u.id&&r.status==="pending";}).length||null;

  // The in-app mailbox. Deliberately NOT role-gated: a connected mailbox is a
  // personal thing, not a desk-specific one, and a recruiter has as much right
  // to read their own mail here as a BD does. Someone with no mailbox connected
  // gets a "set one up" page rather than a hidden nav item they never discover.
  // The unread count is fetched lazily and cached (60s server-side, 60s here),
  // so rendering the sidebar costs nothing.
  if(typeof refreshUnread==='function')refreshUnread();
  var inboxBadge=(STATE.mailbox&&STATE.mailbox.unread)||null;

  // ── The rail's menu ──────────────────────────────────────────────────────
  // Grouped, because a flat list of fourteen items is a list nobody reads. The
  // groups follow how the work actually splits: what you do today (Work), the
  // records you work on (Records), the mail machinery (Outreach), and the
  // numbers (Insight). A group with no visible items disappears entirely.
  var G_WORK='Work', G_REC='Records', G_OUT='Outreach', G_INS='Insight';
  var navItems=[{id:"dashboard",lbl:"Dashboard",ic:"grid",grp:G_WORK}];
  if(leadsAnyTeam)navItems.push({id:"myteam",lbl:"My Team",ic:"users",grp:G_WORK});
  navItems.push({id:"mailbox",lbl:"Inbox",ic:"inbox",badge:inboxBadge,grp:G_WORK});
  navItems.push(raOnly?{id:"insights",lbl:"Insights",ic:"chart",grp:G_INS}
                      :{id:"reminders",lbl:"Reminders",ic:"bell",badge:remBadge,grp:G_WORK});

  if(!pureRec)navItems.push({id:"leads",lbl:"Leads",ic:"send",badge:todayCnt,grp:G_REC});
  if(userHasAnyRole(u,'ra_lead','admin'))navItems.push({id:"assign",lbl:"Assign Leads",ic:"check",grp:G_REC});
  // Leads PACE sourced itself, waiting for a human to approve them. Sits next to
  // Leads because that is where the work continues once one is approved.
  if(userHasAnyRole(u,'admin','bd','bd_lead','ra_lead','director','associate_director'))
    navItems.push({id:"sourced",lbl:"Sourced Leads",ic:"search",grp:G_REC,badge:(STATE.sourced&&STATE.sourced.counts&&STATE.sourced.counts['new'])||0});
  if(bdm)navItems.push({id:"bd_joborders",lbl:"Jobs",ic:"doc",grp:G_REC});
  if(recruiter&&!bdm){navItems.push({id:"bd_myjobs",lbl:"My Jobs",ic:"doc",grp:G_REC});navItems.push({id:"job_board",lbl:"All Jobs",ic:"search",grp:G_REC});}
  if(bdm)navItems.push({id:"clients",lbl:"Clients",ic:"building",grp:G_REC});
  if(bdm||recruiter)navItems.push({id:"applicants",lbl:"Candidates",ic:"user",grp:G_REC});

  if(!userHasRole(u,'ra')||userHasAnyRole(u,'bd','bd_lead','admin','ra_lead'))navItems.push({id:"email",lbl:"Email",ic:"mail",grp:G_OUT});
  if(userHasAnyRole(u,'admin','bd_lead','ra_lead'))navItems.push({id:"deliverability",lbl:"Deliverability",ic:"shield",grp:G_OUT});

  if(userHasAnyRole(u,'ra_lead','admin'))navItems.push({id:"insights",lbl:"Insights",ic:"chart",grp:G_INS});
  // BD / BD Lead (not admin): own lead-gen performance — "Lead Insights".
  if(userHasAnyRole(u,'bd','bd_lead')&&!isAdmin)navItems.push({id:"bdinsights",lbl:"Lead Insights",ic:"chart",grp:G_INS});
  if(canReports&&!leadsAnyTeam)navItems.push({id:"reports",lbl:"Reports",ic:"chart",grp:G_INS});
  if(isAdmin)navItems.push({id:"admin",lbl:"Admin",ic:"cog",grp:G_INS});

  // De-duplicate: Insights can be pushed twice for an admin who is also an RA
  // lead, and a doubled nav item looks like a bug to the person using it.
  var seen={};
  navItems=navItems.filter(function(n){ if(seen[n.id])return false; seen[n.id]=true; return true; });

  function navRow(n){
    var active=STATE.page===n.id?" active":"";
    var badge=n.badge&&n.badge>0?'<span class="nav-badge">'+n.badge+'</span>':"";
    return '<div class="nav-item'+active+'" onclick="goPage(\''+n.id+'\')" title="'+n.lbl+'">'+
      '<span class="nav-icon">'+UI.ic(n.ic)+'</span>'+
      '<span class="nav-txt">'+n.lbl+'</span>'+badge+
    '</div>';
  }
  var nav=[G_WORK,G_REC,G_OUT,G_INS].map(function(g){
    var rows=navItems.filter(function(n){return n.grp===g;});
    if(!rows.length)return '';
    return '<div class="sb-lbl">'+g+'</div>'+rows.map(navRow).join('');
  }).join('');

  return '<div id="sidebar">'+
    '<div class="sb-brand">'+
      '<div class="rail-mark">P</div>'+
      '<div class="rail-word"><span style="color:var(--accent)">PA</span><span style="color:#C99A18">CE</span></div>'+
    '</div>'+
    '<div class="sb-nav">'+nav+'</div>'+
    '<div class="sb-footer">'+
      '<div class="user-row" onclick="goPage(\'profile\')" title="'+htmlEsc(u.name)+' — open my profile">'+
        av(u,"32")+
        '<div class="user-meta" style="flex:1;min-width:0">'+
          '<div class="u-name">'+htmlEsc(u.name)+'</div>'+
          '<div class="u-role">'+roleLabel(u.role)+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="nav-item" onclick="signOut()" title="Sign out">'+
        '<span class="nav-icon">'+UI.ic('ban')+'</span><span class="nav-txt">Sign out</span>'+
      '</div>'+
    '</div>'+
  '</div>';
}

function renderTopbar(){
  var u=STATE.user;
  var remBadge=STATE.reminders.filter(function(r){return r.user_id===u.id&&r.status==="pending";}).length||null;
  var pageTitles={dashboard:"Dashboard",mailbox:"Inbox",bd_pipeline:"Candidates",myteam:"My Team",leads:"Leads",assign:"Assign Leads",bd_joborders:"Jobs",bd_myjobs:"My Jobs",bd_jodetail:"Job",bd_kanban:"Job White-board",job_board:"All Jobs",clients:"Clients",applicants:"Candidates",email:"Email",admin:"Admin",deliverability:"Deliverability & Replies",emailaccounts:"Email Accounts",managerusers:"Manager Users",insights:"Insights",bdinsights:"Lead Insights",bdleadinsights:"Team Insights",reports:"Reports",profile:"My Profile",reminders:"Reminders",sourced:"Sourced Leads"};

  // The count beside the page title. Each page owns its own number, so this is
  // a lookup rather than something the shell can compute — a page with nothing
  // countable simply has no chip, which is quieter than a "0".
  var counts={
    applicants:(STATE.ats&&(STATE.ats.countsTotal!=null?STATE.ats.countsTotal:STATE.ats.total))||null,
    mailbox:(STATE.mailbox&&STATE.mailbox.unread)||null,
    sourced:(STATE.sourced&&STATE.sourced.counts&&STATE.sourced.counts['new'])||null,
    reminders:remBadge
  };
  var countChip=counts[STATE.page]?'<span class="tb-count">'+counts[STATE.page]+'</span>':'';
  var viewingName=STATE.viewingUser&&STATE.viewingUser.id!==u.id
    ?'<span class="tb-crumb">· Viewing '+htmlEsc(STATE.viewingUser.name)+'</span>':'';

  // The only way into the menu on a phone. The rail expands on hover, and a
  // touch screen has no hover — so without this the whole nav was fourteen
  // unlabelled icons in a 60px strip. Hidden by CSS above 860px, where the
  // hover rail is back and a hamburger would be one click too many.
  return '<div id="topbar">'+
      '<div class="tb-burger" onclick="toggleNav()" title="Menu" aria-label="Menu" role="button">'+UI.ic('menu')+'</div>'+
      '<div class="tb-title">'+pageTitles[STATE.page]+countChip+viewingName+'</div>'+
      '<div class="tb-right" style="margin-left:auto;display:flex;align-items:center;gap:10px">'+
        (STATE.viewingUser&&STATE.viewingUser.id!==u.id?
          '<button class="btn btn-outline btn-sm" onclick="stopViewing()">← Back to my dashboard</button>':'')+
        '<div class="tb-icons">'+
          '<div class="tb-ico" title="What needs you today" onclick="goPage(\'dashboard\')">'+UI.ic('bolt')+'</div>'+
          '<div class="tb-ico" title="Reminders" onclick="goPage(\'reminders\')">'+UI.ic('bell')+
            (remBadge?'<span class="dot"></span>':'')+'</div>'+
        '</div>'+
        '<div class="tb-user" onclick="goPage(\'profile\')">'+av(u,"28")+'</div>'+
      '</div>'+
  '</div>';
}

function roleLabel(r){return{ra:"Research Analyst",bd:"BD Manager",admin:"Admin",ra_lead:"RA Team Lead",bd_lead:"BD Team Lead",recruiter:"Recruiter",associate_director:"Associate Director",director:"Director"}[r]||r;}

// ── SSO sign-in ─────────────────────────────────────────────────────────────
// "Continue with Microsoft / Google" — the flow people expect from every other
// tool they use. Replaces a button that used to be a placeholder: it showed
// "Google Workspace login coming soon" and did nothing, which is worse than no
// button at all.
//
// A provider's button only renders when that provider is actually configured on
// the server (GET /auth/sso/providers), so a visible button always works.
function loadSsoProviders(){
  if(STATE.ssoProviders!==undefined||STATE._ssoLoading)return;
  STATE._ssoLoading=true;
  // Plain fetch, not apiGet — this runs on the login screen, before any session
  // exists, and must never trigger the 401 handling that bounces to login.
  fetch(API_URL+'/auth/sso/providers').then(function(r){return r.json();}).then(function(d){
    STATE.ssoProviders=(d&&d.providers)||[];
    // Can this deployment actually create a workspace on the spot, or should
    // Sign Up keep capturing requests for a human? Same rule as the buttons:
    // never offer something the server cannot do.
    STATE.selfServe=!!(d&&d.self_serve);
    STATE._ssoLoading=false;
    render();
  }).catch(function(){
    // If we can't tell, show nothing rather than a button that may fail.
    STATE.ssoProviders=[];
    STATE.selfServe=false;
    STATE._ssoLoading=false;
  });
}

var SSO_ICON={
  microsoft:'<svg width="18" height="18" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>',
  google:'<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.5-4.5 6.4l6.9 5.4c4.1-3.8 6.6-9.4 6.6-15z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C7.9 40.9 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .7-4.4l-7.1-5.5A22 22 0 0 0 2 24c0 3.5.9 6.9 2.4 9.9l7.1-5.5z"/><path fill="#EB4335" d="M24 9.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.4 29.9 1 24 1 15.4 1 7.9 6.1 4.4 13.5l7.1 5.5C13.3 13.3 18.2 9.5 24 9.5z"/></svg>'
};

function ssoButtons(){
  if(STATE.ssoProviders===undefined){loadSsoProviders();return '';}
  var list=STATE.ssoProviders||[];
  if(!list.length)return '';
  return list.map(function(p){
    return '<button class="google-btn" onclick="startSso(\''+p.id+'\')">'+
      '<span style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center">'+(SSO_ICON[p.id]||'')+'</span>'+
      htmlEsc(p.label)+
    '</button>';
  }).join('');
}

window.startSso=function(provider){
  // A full-page redirect, not a popup: popups get blocked, and the identity
  // providers increasingly refuse to render inside one.
  window.location.href=API_URL+'/auth/sso/'+encodeURIComponent(provider);
};

// Pick up the session the SSO callback hands back.
//
// It arrives in the URL FRAGMENT (#sso=…), never the query string — fragments
// are not sent to the server, so the token stays out of access logs, proxy logs
// and Referer headers. It is consumed and scrubbed from the address bar
// immediately so it can't be shoulder-surfed or pasted into a bug report.
function consumeSsoToken(){
  var h=window.location.hash||'';
  var m=/[#&]sso=([^&]+)/.exec(h);
  if(!m)return false;
  var token=decodeURIComponent(m[1]);
  try{history.replaceState(null,'',window.location.pathname+window.location.search);}catch(_){window.location.hash='';}
  sessionStorage.setItem('fg_token',token);
  STATE.token=token;
  // Fetch the profile with the new token; on failure fall back to the login
  // screen rather than a half-signed-in state.
  fetch(API_URL+'/users/me',{headers:{Authorization:'Bearer '+token}})
    .then(function(r){return r.ok?r.json():Promise.reject(new Error('profile'));})
    .then(function(u){
      STATE.user=normaliseUser(u);
      sessionStorage.setItem('fg_user',JSON.stringify(STATE.user));
      STATE.page='dashboard';
      // Same tail as the password path (23-auth.js) so an SSO session and
      // a password session are indistinguishable from here on.
      loadAppData();
    })
    .catch(function(){
      sessionStorage.removeItem('fg_token');
      STATE.token=null;STATE.user=null;STATE.page='login';
      showToast('Signed in, but your profile could not be loaded. Please try again.','error');
      render();
    });
  return true;
}

// ── "Log In with your Organization" ─────────────────────────────────────────
// Enterprise sign-in: the user gives their work email, PACE looks up which
// identity provider that email's DOMAIN is registered to, and sends them there.
//
// Deliberately honest about what it is today. It routes by domain to a real
// provider (Microsoft/Google), which is what the great majority of companies
// actually use. It is NOT yet full SAML/Okta federation — that is a bigger
// piece, and this endpoint is the seam it will slot into. Rather than show a
// button that pretends otherwise, an unrecognised domain says so plainly.
function orgSsoButton(){
  if(!(STATE.ssoProviders||[]).length)return '';
  return '<button class="google-btn" onclick="startOrgSso()">'+
    '<span style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center">'+
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>'+
    '</span>'+
    'Log In with your Organization'+
  '</button>';
}

window.startOrgSso=function(){
  var email=prompt('Enter your work email and we’ll take you to your company’s sign-in page:');
  if(!email)return;
  var domain=String(email).split('@')[1];
  if(!domain){showToast('That does not look like an email address.','error');return;}
  fetch(API_URL+'/auth/sso/for-domain?domain='+encodeURIComponent(domain))
    .then(function(r){return r.json();})
    .then(function(d){
      // Nobody has claimed this domain, but self-serve is on — so instead of a
      // dead end this is an offer. Say so before redirecting: "log in with your
      // organization" silently creating a brand-new workspace would be a
      // surprise, and the difference matters to whoever is clicking.
      if(d&&d.provider&&d.new_workspace){
        if(!confirm('We don’t have a workspace for '+domain+' yet.\n\nContinue to create your own workspace? If your company already uses PACE, ask your administrator to invite you instead.'))return;
      }
      if(d&&d.provider){window.location.href=API_URL+'/auth/sso/'+encodeURIComponent(d.provider);return;}
      showToast(d&&d.message?d.message:'We could not find a sign-in method for '+domain+'. Use Microsoft or Google above, or ask your administrator.','warning');
    })
    .catch(function(){showToast('Could not reach the sign-in service. Please try again.','error');});
};

// ── Sign Up ─────────────────────────────────────────────────────────────────
// Two panels, and which one shows is decided by the SERVER (self_serve on
// GET /auth/sso/providers), never guessed here.
//
//   Self-serve ON  → a real signup. You continue with Microsoft or Google, and
//                    the account you sign in with becomes your workspace — or
//                    joins your company's, if your company has verified its
//                    domain and switched auto-join on. There is no form to
//                    fill in and no password to choose, because the identity
//                    provider has already proved who you are.
//   Self-serve OFF → the request-capture panel below, which is honest about
//                    being a waiting list. Better than a tab that silently
//                    does nothing (the old "Google login coming soon" button).
function renderSignupPanel(){
  // Landing straight on this tab must not skip the capability lookup — which
  // panel to show depends on it.
  if(STATE.ssoProviders===undefined){loadSsoProviders();return '';}
  if(STATE.selfServe&&(STATE.ssoProviders||[]).length){
    return '<div style="font-size:13px;color:var(--text3);margin-bottom:16px;line-height:1.55">'+
        'Create your PACE workspace in one step — no password to choose. Sign in with your work account and we’ll set everything up.'+
      '</div>'+
      (STATE.ssoProviders||[]).map(function(p){
        return '<button class="google-btn" onclick="startSso(\''+p.id+'\')">'+
          '<span style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center">'+(SSO_ICON[p.id]||'')+'</span>'+
          htmlEsc(String(p.label||'').replace(/^Continue with/,'Sign up with'))+
        '</button>';
      }).join('')+
      '<div style="font-size:11.5px;color:var(--text3);margin-top:14px;line-height:1.55;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px">'+
        '<strong style="color:var(--text2)">If your company already uses PACE</strong> and has verified its email domain, you’ll join their workspace automatically. '+
        'Otherwise you get a private workspace of your own — you can invite your team and claim your domain from there.'+
      '</div>'+
      '<div style="font-size:11.5px;color:var(--text3);margin-top:12px;text-align:center;line-height:1.5">Already have an account? '+
        '<button onclick="STATE.loginTab=\'login\';render()" style="background:none;border:0;padding:0;color:var(--accent);font-size:11.5px;cursor:pointer;text-decoration:underline;font-family:inherit">Log in</button>'+
      '</div>';
  }
  if(STATE.signupSent){
    return '<div style="text-align:center;padding:14px 4px">'+
      '<div style="font-size:34px;line-height:1;margin-bottom:10px">✓</div>'+
      '<div style="font-family:var(--display);font-weight:600;font-size:16px;margin-bottom:6px">Request received</div>'+
      '<div style="font-size:13px;color:var(--text3);line-height:1.55">We’ll be in touch at <strong>'+htmlEsc(STATE.signupSent)+'</strong> to set your workspace up.</div>'+
      '<button onclick="STATE.signupSent=null;STATE.loginTab=\'login\';render()" style="margin-top:16px;background:none;border:0;color:var(--accent);font-size:13px;cursor:pointer;text-decoration:underline;font-family:inherit">Back to log in</button>'+
    '</div>';
  }
  return '<div style="font-size:13px;color:var(--text3);margin-bottom:16px;line-height:1.55">'+
      'PACE is rolling out to new organisations. Tell us where to reach you and we’ll set your workspace up.'+
    '</div>'+
    '<div class="fgrp"><label class="flbl">Work email</label><input class="inp" id="su-email" type="email" placeholder="you@yourcompany.com"/></div>'+
    '<div class="fgrp"><label class="flbl">Company <span style="color:var(--text3);font-weight:400">(leave blank if it’s just you)</span></label><input class="inp" id="su-company" type="text" placeholder="Your company"/></div>'+
    '<div id="su-err" style="display:none;color:var(--red);font-size:12px;background:var(--red-l);padding:8px 10px;border-radius:var(--r);margin-bottom:12px"></div>'+
    '<button class="btn btn-primary w100" style="justify-content:center" onclick="submitSignupRequest()">Request access</button>'+
    '<div style="font-size:11.5px;color:var(--text3);margin-top:12px;text-align:center;line-height:1.5">Already have an account? '+
      '<button onclick="STATE.loginTab=\'login\';render()" style="background:none;border:0;padding:0;color:var(--accent);font-size:11.5px;cursor:pointer;text-decoration:underline;font-family:inherit">Log in</button>'+
    '</div>';
}

window.submitSignupRequest=function(){
  var em=(document.getElementById('su-email')||{}).value||'';
  var co=(document.getElementById('su-company')||{}).value||'';
  var err=document.getElementById('su-err');
  if(!em||em.indexOf('@')<0){if(err){err.textContent='Enter a valid work email.';err.style.display='block';}return;}
  fetch(API_URL+'/auth/signup-request',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:em,company:co})
  }).then(function(r){return r.json();}).then(function(d){
    if(d&&d.error)throw new Error(d.error);
    STATE.signupSent=em;render();
  }).catch(function(e){
    if(err){err.textContent=e.message||'Could not send that. Please try again.';err.style.display='block';}
  });
};

window.showForgotPassword=function(){
  showToast('PACE accounts sign in with Microsoft or Google — there is usually no password to reset. If you use a password, ask your administrator to set a new one.','info');
};
