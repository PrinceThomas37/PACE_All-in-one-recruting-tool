// ════════════════════════════════════════════════
// RENDER LOGIN
// ════════════════════════════════════════════════
function renderLogin(){
  var tab=STATE.loginTab||'login';
  function tabBtn(id,label,icon){
    var on=tab===id;
    // The selected tab used to paint `background: var(--text)` — an INVERSION.
    // That reads as a near-black pill in light and a near-WHITE pill with white
    // text in dark: 1.09:1, completely unreadable. Inversion is not a
    // theme-safe colour; the accent is.
    return '<button class="login-tab'+(on?' is-on':'')+'" '+
      'onclick="STATE.loginTab=\''+id+'\';STATE.loginErr=null;render()">'+
      (icon||'')+label+'</button>';
  }

  var err=STATE.loginErr
    ? '<div class="c-red fs-12" style="background:var(--red-l);padding:8px 10px;border-radius:var(--r);margin-bottom:12px">'+htmlEsc(STATE.loginErr)+'</div>'
    : '<div id="login-err" class="c-red fs-12" style="display:none;background:var(--red-l);padding:8px 10px;border-radius:var(--r);margin-bottom:12px"></div>';

  // The plain reason the person is looking at the sign-in again (R-118) — a calm notice, not an error.
  var notice=STATE.loginNotice
    ? '<div role="status" class="c-text fs-12_5" style="background:var(--accent-l,var(--card-solid));border:1px solid var(--accent);padding:9px 11px;border-radius:var(--r);margin-bottom:12px">'+htmlEsc(STATE.loginNotice)+'</div>'
    : '';
  var body = tab==='signup' ? renderSignupPanel() :
    // ── Log In ──────────────────────────────────────────────────────────────
    notice+
    ssoButtons()+
    orgSsoButton()+
    '<div class="or-div">Or</div>'+
    '<div class="fgrp"><label class="flbl">Email</label><input class="inp" id="login-email" type="email" placeholder="Work email"/></div>'+
    '<div class="fgrp"><label class="flbl">Password</label><div style="position:relative"><input class="inp" id="login-pass" type="password" placeholder="Enter your password" style="padding-right:40px"/><button type="button" onclick="var i=document.getElementById(\'login-pass\');i.type=i.type===\'password\'?\'text\':\'password\'" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;color:var(--text3);padding:0;display:flex;align-items:center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div>'+
    err+
    '<button class="btn btn-primary w100" style="justify-content:center" onclick="doLogin()">Log In</button>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:10px">'+
      '<label class="fs-12_5 c-text2" style="display:flex;align-items:center;gap:7px;cursor:pointer">'+
        '<input type="checkbox" id="login-remember" checked style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer"/> Keep me signed in'+
      '</label>'+
      '<button onclick="showForgotPassword()" class="fs-12_5 c-text2" style="background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;font-family:inherit">Forgot password?</button>'+
    '</div>';

  return '<div class="login-wrap">'+
    '<canvas id="login-canvas" style="position:fixed;inset:0;width:100%;height:100%;z-index:0"></canvas>'+
    '<div class="login-card" style="position:relative;z-index:2">'+
      '<div class="login-top">'+
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">'+
          '<div style="line-height:1;flex-shrink:0"><span class="fs-36" style="font-family:var(--display);font-weight:700;color:#fff;letter-spacing:-.5px">PA</span><span class="fs-36" style="font-family:var(--display);font-weight:700;color:#F5C23B;letter-spacing:-.5px">CE</span></div>'+
          '<div><div class="fs-17" style="font-family:var(--display);font-weight:700;color:#fff;line-height:1.25">All-in-one Recruiting Platform</div><div class="fs-12" style="color:rgba(255,255,255,.82);margin-top:3px">Applicant tracking · Lead management · Outreach</div></div>'+
        '</div>'+
        '<div class="fs-11_5" style="color:rgba(255,255,255,.65);border-top:1px solid rgba(255,255,255,.2);padding-top:10px">Sign in to your workspace</div>'+
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
  // Grouped, because a flat list of fourteen items is a list nobody reads.
  // R-122: the groups follow the two halves of the BUSINESS — PACE is a lead-
  // generation tool and an ATS — plus your own day and the setup screens:
  //   My Day (dashboard, team, inbox, reminders, email) · Sales (leads, sourced,
  //   assign, clients, lead numbers) · Recruiting (jobs, candidates) · Setup.
  // WHO SEES WHAT IS UNCHANGED — only the headings moved. A group with no
  // visible items disappears entirely, so a recruiter never sees "Sales" and a
  // research analyst never sees "Recruiting". Each group carries a class
  // (sec-day / sec-sales / sec-rec / sec-set) that retro.css colours.
  var G_WORK='My Day', G_REC='Recruiting', G_SALES='Sales', G_OUT='My Day', G_INS='Sales', G_SET='Setup';
  var GRP_CLS={'My Day':'sec-day','Sales':'sec-sales','Recruiting':'sec-rec','Setup':'sec-set'};
  var navItems=[{id:"dashboard",lbl:"Today",ic:"grid",grp:G_WORK}];
  if(leadsAnyTeam)navItems.push({id:"myteam",lbl:"My Team",ic:"users",grp:G_WORK});
  // 8 Oct (owner: which email ID got the new mail?): hovering the Inbox says how many are unread in each mailbox.
  var inboxTip=Object.keys((STATE.mailbox&&STATE.mailbox.unreadBy)||{}).map(function(id){ var r=STATE.mailbox.unreadBy[id]; return r.unread>0?r.email+' — '+r.unread+' unread':''; }).filter(Boolean).join('\n');
  navItems.push({id:"mailbox",lbl:"Inbox",ic:"inbox",badge:inboxBadge,tip:inboxTip,grp:G_WORK});
  navItems.push(raOnly?{id:"insights",lbl:"My Numbers",ic:"chart",grp:G_INS}
                      :{id:"reminders",lbl:"Reminders",ic:"bell",badge:remBadge,grp:G_WORK});

  if(!pureRec)navItems.push({id:"leads",lbl:"Leads",ic:"send",badge:todayCnt,grp:G_SALES});
  if(userHasAnyRole(u,'ra_lead','admin'))navItems.push({id:"assign",lbl:"Assign Leads",ic:"check",grp:G_SALES});
  // ONE place for finding leads (owner, 8 Oct): the Lead Finder AND the leads PACE sourced itself (waiting for a human to approve
  // them — a tab in the same page). The item shows for anyone switched on for the finder or allowed to review sourced leads; the
  // badge counts what is waiting in the Sourced leads queue. The finder's access is fetched once per person; finderEnsureAccess()
  // repaints the rail when it arrives.
  if(typeof finderEnsureAccess==='function')finderEnsureAccess();
  if(typeof finderNavVisible==='function'&&finderNavVisible())navItems.push({id:"finder",lbl:"Find Leads",ic:"search",grp:G_SALES,badge:(typeof srcdNewCount==='function'?srcdNewCount():0)});
  if(bdm)navItems.push({id:"bd_joborders",lbl:"Jobs",ic:"doc",grp:G_REC});
  if(recruiter&&!bdm){navItems.push({id:"bd_myjobs",lbl:"My Jobs",ic:"doc",grp:G_REC});navItems.push({id:"job_board",lbl:"All Jobs",ic:"search",grp:G_REC});}
  // Clients sit with Sales: that is where the relationship is won. A job still
  // links to its client.
  if(bdm)navItems.push({id:"clients",lbl:"Clients",ic:"building",grp:G_SALES});
  if(bdm||recruiter)navItems.push({id:"applicants",lbl:"Candidates",ic:"user",grp:G_REC});

  if(!userHasRole(u,'ra')||userHasAnyRole(u,'bd','bd_lead','admin','ra_lead'))navItems.push({id:"email",lbl:"Email",ic:"mail",grp:G_OUT});
  if(userHasRole(u,'admin'))navItems.push({id:"deliverability",lbl:"Deliverability",ic:"shield",grp:G_SET});

  if(userHasAnyRole(u,'ra_lead','admin'))navItems.push({id:"insights",lbl:"Insights",ic:"chart",grp:G_INS});
  // BD / BD Lead (not admin): own lead-gen performance — "Lead Insights".
  if(userHasAnyRole(u,'bd','bd_lead')&&!isAdmin)navItems.push({id:"bdinsights",lbl:"Outreach Insights",ic:"chart",grp:G_INS});
  // NOT "chart": Insights / Lead Insights already use it, and they sit in this
  // same group. The collapsed rail is ICON-ONLY, so two items sharing an icon
  // are indistinguishable there — which is what "the menu is repeating" was.
  // Expanding it showed different labels, hence "no repeats in full menu".
  // R-006: Reports are part of the Dashboard now (its foot), so the standalone
  // nav item is gone; goPage('reports') still works and lands there.
  // My Setup (owner, 8 Oct): every person sets up THEIR OWN outreach — mailbox, who it writes for, sequence.
  navItems.push({id:"mysetup",lbl:"My Setup",ic:"cog",grp:G_SET});
  if(isAdmin)navItems.push({id:"admin",lbl:"Admin",ic:"cog",grp:G_SET});

  // De-duplicate: Insights can be pushed twice for an admin who is also an RA
  // lead, and a doubled nav item looks like a bug to the person using it.
  var seen={};
  navItems=navItems.filter(function(n){ if(seen[n.id])return false; seen[n.id]=true; return true; });

  function navRow(n){
    var active=(STATE.page===n.id?" active":"")+" "+GRP_CLS[n.grp];
    var badge=n.badge&&n.badge>0?'<span class="nav-badge">'+n.badge+'</span>':"";
    // R-122: a pixel icon per item (9x9, drawn in the text colour). Every item
    // has its OWN — the collapsed rail is icons only (nav-icons-smoke).
    var pic=NAV_PIXEL_ICONS[n.id];
    return '<div class="nav-item'+active+'" onclick="goPage(\''+n.id+'\')" title="'+escAttr(n.tip||n.lbl)+'">'+
      '<span class="nav-icon">'+(pic?pixelSprite(pic,'currentColor',2):UI.ic(n.ic))+'</span>'+
      '<span class="nav-txt">'+n.lbl+'</span>'+badge+
    '</div>';
  }
  // Setup (Deliverability, Admin) is not a menu section: it lives under the
  // name card, behind "Setup" (toggleSetup — one class, no render).
  var setupRows=navItems.filter(function(n){return n.grp==='Setup';});
  var setupOpen=(STATE.page==='admin'||STATE.page==='deliverability'||STATE.page==='mysetup')?' setup-open':'';
  var nav=['My Day','Sales','Recruiting'].map(function(g){
    var rows=navItems.filter(function(n){return n.grp===g;});
    if(!rows.length)return '';
    return '<div class="sb-lbl '+GRP_CLS[g]+'">'+g+'</div>'+rows.map(navRow).join('');
  }).join('');

  // Restore the rail's pinned state. Read at build time so it is part of the
  // region's html string — the render engine compares those strings, so a
  // deterministic class here costs nothing and never causes a repaint.
  // R-122: on a full-size screen the labelled sidebar is OPEN by default (the
  // owner's design); one click on the logo folds it to the icon rail, and that
  // choice is remembered. Below 1100px (tablets, phones) it starts folded as
  // before.
  var railPinned='';
  try{
    var rp=localStorage.getItem('pace-rail');
    // R-139 (owner: the fold on a logo click "pushes the page under the menu,
    // it is not required now"): on a full-size screen the sidebar is simply
    // OPEN, and an old remembered 'collapsed' is ignored there, so nobody who
    // folded it before is left with a closed menu and no way to open it.
    // Below 1100px (tablet, phone) the person's own choice still applies.
    if(window.innerWidth>=1100||rp==='pinned') railPinned=' pinned';
  }catch(e){}

  return '<div id="sidebar" class="'+(railPinned+setupOpen).trim()+'">'+
    // THE BRAND MARK IS ALSO THE RAIL'S SWITCH ON A TOUCH DEVICE.
    // The rail expands on hover, correctly gated on (hover:hover) — a mouse
    // feature, never a width. But that leaves a TOUCH device at desktop width
    // (a tablet, or a phone in "desktop site" mode) with a 60px icon-only rail
    // and no way to read a single label. Reported from a real phone.
    // `.pinned` already existed and already sits outside the hover query
    // precisely because it is an explicit choice rather than a hover — it just
    // had nothing to toggle it. Now the mark does, and CSS shows the affordance
    // only where hover is unavailable.
    '<div class="sb-brand" onclick="paceLogoClick()" role="button" tabindex="0" '+
      'title="PACE" aria-label="PACE">'+
      // R-122: the pixel logo on a slice of the sky (retro.css paints both).
      '<div class="rail-mark">P</div>'+
      paceLogoWord()+
      '<span class="sb-cloud">'+pixelSprite(PACE_CLOUD,'currentColor',2)+'</span>'+
      '<div class="rail-pin">'+UI.ic('menu')+'</div>'+
    '</div>'+
    '<div class="sb-nav">'+nav+'</div>'+
    '<div class="sb-footer">'+
      (setupRows.length?'<div class="sb-setup">'+setupRows.map(navRow).join('')+'</div>':'')+
      '<div class="me-card">'+
        '<div class="user-row" onclick="goPage(\'profile\')" title="'+htmlEsc(u.name)+' — open my profile">'+
          av(u,"32")+
          '<div class="user-meta" style="flex:1;min-width:0">'+
            '<div class="u-name">'+htmlEsc(u.name)+'</div>'+
            '<div class="u-role">'+roleLabel(u.role)+'</div>'+
          '</div>'+
        '</div>'+
        (setupRows.length?'<div class="me-setup" onclick="toggleSetup()" role="button" title="Setup: '+setupRows.map(function(n){return n.lbl;}).join(', ')+'">'+UI.ic('cog')+'<span class="nav-txt">Setup</span></div>':'')+
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
  var pageTitles={dashboard:"Today",mailbox:"Inbox",bd_pipeline:"Candidates",myteam:"My Team",leads:"Leads",assign:"Assign Leads",bd_joborders:"Jobs",bd_myjobs:"My Jobs",bd_jodetail:"Job",bd_kanban:"Job White-board",job_board:"All Jobs",clients:"Clients",applicants:"Candidates",email:"Email",admin:"Admin",deliverability:"Deliverability",emailaccounts:"Email Accounts",managerusers:"Manager Users",insights:"Insights",bdinsights:"Outreach Insights",bdleadinsights:"Team Insights",reports:"Reports",profile:"My Profile",reminders:"Reminders",sourced:"Sourced Leads",finder:"Find Leads",mysetup:"My Setup"};

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
      // R-122: the sky. The bar's colours follow the clock through the
      // data-sky attribute on <html> (retro.css); the sun or moon is the one
      // thing drawn here, placed by the hour (paceSkyOrb). Decorative only.
      // The sky's decoration sits in its own clipped layer, so the bar itself
      // can let the search results hang below it.
      '<div class="tb-sky" aria-hidden="true">'+paceSkyOrb()+paceSkyDecor()+'</div>'+
      '<div class="tb-burger" onclick="toggleNav()" title="Menu" aria-label="Menu" role="button">'+UI.ic('menu')+'</div>'+
      // The title block: the page name in pixels, and under it today's date
      // and time (the clock ticker keeps #tb-clock current — text only).
      '<div class="tb-head">'+
        '<div class="tb-title">'+pageTitles[STATE.page]+countChip+viewingName+'</div>'+
        '<div class="tb-meta"><span id="tb-clock">'+paceHeaderClock()+'</span></div>'+
      '</div>'+
      paceTodayChips()+
      (window.paceSearchBox?paceSearchBox():'')+
      '<div class="tb-right" style="margin-left:12px;display:flex;align-items:center;gap:10px">'+
        (STATE.viewingUser&&STATE.viewingUser.id!==u.id?
          '<button class="btn btn-outline btn-sm" onclick="stopViewing()">← Back to my dashboard</button>':'')+
        // BOTH ICONS ARE ALWAYS IN THE MARKUP; theme.css shows one and hides
        // the other. That is deliberate: swapping them by re-rendering would
        // make changing theme repaint the shell, reload every iframe and take
        // the page's scroll position with it — the exact rule the render
        // engine is built around (a repaint that changes nothing writes
        // nothing). Toggling an attribute on <html> costs a repaint of colour
        // and nothing else.
        paceHeaderNew()+
        '<div class="tb-theme" onclick="toggleTheme()" title="Light / dark" aria-label="Toggle light or dark theme" role="button">'+
          '<span class="ic-moon">'+UI.ic('moon')+'</span><span class="ic-sun">'+UI.ic('sun')+'</span>'+
        '</div>'+
        '<div class="tb-icons">'+
          '<div class="tb-ico" title="What needs you today" onclick="goPage(\'dashboard\')">'+UI.ic('bolt')+'</div>'+
          '<div class="tb-ico" title="Reminders" onclick="goPage(\'reminders\')">'+UI.ic('bell')+
            (remBadge?'<span class="dot"></span>':'')+'</div>'+
        '</div>'+
        '<div class="tb-user" onclick="goPage(\'profile\')">'+av(u,"28")+'</div>'+
      '</div>'+
  '</div>';
}

// THE LOGO TYPES ITSELF OUT (R-122): P, A, C, E appear one by one with a caret
// that blinks and goes. The MARKUP NEVER CHANGES — it is always the finished
// word — because the render engine compares the sidebar's html and an idle
// repaint must write nothing (ui-smoothness-smoke). The show is a class
// ('typing') put on the live element once, by script, for the first 3 seconds of
// a visit; the animation itself is CSS (retro.css .rail-word.typing). If a
// repaint replaces the element mid-show, the class is put back and the
// animation resumes where it should be (--el), so it never restarts or jumps.
var PACE_LOGO_SHOW_MS=3200;
function paceLogoWord(){
  var letters='PACE'.split('').map(function(ch,i){return '<span class="tw" style="--i:'+i+'">'+ch+'</span>';}).join('');
  if(!window.__paceLogoT0){ window.__paceLogoT0=Date.now(); paceLogoShow(); }
  return '<div class="rail-word" aria-label="PACE"><span aria-hidden="true">'+letters+'<span class="tw-caret"></span></span></div>';
}
function paceLogoShow(){
  var t0=window.__paceLogoT0;
  var tick=function(){
    var el=document.querySelector('#sidebar .rail-word'), gone=Date.now()-t0>=PACE_LOGO_SHOW_MS;
    if(el){
      if(gone){ el.classList.remove('typing'); el.style.removeProperty('--el'); return true; }
      if(!el.classList.contains('typing')){ el.style.setProperty('--el',((Date.now()-t0)/1000).toFixed(2)+'s'); el.classList.add('typing'); }
    }
    return gone;
  };
  var iv=setInterval(function(){ if(tick())clearInterval(iv); },250);
}
window.paceLogoWord=paceLogoWord;
// A click on the logo types PACE again (R-138). On a screen too narrow for the
// open sidebar the same click still folds/unfolds the rail — a touch device
// has no other way to read the labels (see the long note above).
window.paceLogoClick=function(){
  var el=document.querySelector('#sidebar .rail-word');
  if(el){
    window.__paceLogoT0=Date.now();
    el.classList.remove('typing'); el.style.removeProperty('--el');
    void el.offsetWidth;                       // let the animation start from the beginning
    el.classList.add('typing');
    paceLogoShow();                            // ends the show, and keeps it alive through a repaint
  }
  if(window.innerWidth<1100&&typeof window.toggleRail==='function') window.toggleRail();
};

// Show or hide the Setup items above the name card. One class, no render.
window.toggleSetup=function(){
  var sb=document.getElementById('sidebar'); if(sb)sb.classList.toggle('setup-open');
};

// The sidebar's pixel icons (R-122): 9x9, '#' = a pixel. One per nav id.
var NAV_PIXEL_ICONS={
  dashboard:['#...#...#','.#..#..#.','..#####..','..#####..','#########','..#####..','..#####..','.#..#..#.','#...#...#'],
  myteam:['..##.##..','.####.##.','.####.##.','..##..#..','.........','######.##','#######.#','#######.#','.........'],
  mailbox:['#########','#.......#','#.......#','#.......#','##.....##','#.##.##.#','#..###..#','#.......#','#########'],
  reminders:['....#....','...###...','..#####..','..#####..','..#####..','.#######.','#########','.........','....#....'],
  email:['#########','##.....##','#.#...#.#','#..#.#..#','#...#...#','#.......#','#.......#','#.......#','#########'],
  leads:['....#....','..#####..','.#..#..#.','.#.....#.','####.####','.#.....#.','.#..#..#.','..#####..','....#....'],
  assign:['#####....','#...#....','#...#..#.','#####.###','......###','..#....#.','.###.....','#####....','..#......'],
  finder:['..####...','.#....#..','#..##..#.','#.#..#.#.','#.#..#.#.','#..##..#.','.#....#..','..####.#.','.......##'],
  sourced:['.####....','#....#...','#....#...','#....#...','#....#...','.####.#..','......##.','.......##','........#'],
  clients:['..#####..','..#.#.#..','..#####..','..#.#.#..','#########','#.#.#.#.#','#########','#.#.#.#.#','#########'],
  insights:['.......##','.......##','....##.##','....##.##','.##.##.##','.##.##.##','.##.##.##','.##.##.##','#########'],
  bdinsights:['........#','.......#.','......#..','.#...#...','#.#.#....','...#.....','.........','#########','#########'],
  bd_joborders:['...###...','..#...#..','#########','#.......#','#...#...#','#########','#.......#','#.......#','#########'],
  bd_myjobs:['...###...','..#...#..','#########','#.......#','#.#####.#','#########','#.......#','#.......#','#########'],
  job_board:['#########','#.......#','#.#####.#','#.......#','#.####..#','#.......#','#.###...#','#.......#','#########'],
  applicants:['...###...','..#####..','..#####..','...###...','.........','.#######.','#########','#########','#########'],
  deliverability:['.#######.','#########','##.....##','##.....##','##.....##','.##...##.','..##.##..','...###...','....#....'],
  mysetup:['.........','###.#####','###.#####','.........','#####.###','#####.###','.........','##.######','##.######'],
  admin:['...#.#...','.#######.','.##...##.','###...###','.#.....#.','###...###','.##...##.','.#######.','...#.#...']
};
window.NAV_PIXEL_ICONS=NAV_PIXEL_ICONS;

// Expand or collapse the icon rail. Like the nav drawer and the theme switch,
// this toggles ONE class and calls nothing else — a render() here would rebuild
// the shell, reload every iframe and lose the page's scroll, to move a rail.
window.toggleRail=function(){
  var sb=document.getElementById('sidebar'); if(!sb)return;
  var on=sb.classList.toggle('pinned');
  try{ localStorage.setItem('pace-rail', on?'pinned':'collapsed'); }catch(e){}
};

// ── LIGHT / DARK / AUTO ───────────────────────────────────────────────────
// Three states (D-0015, D-0072): the person chose 'light', chose 'dark', or
// chose nothing — AUTO, which follows their clock (light 05:00–16:59, dark
// otherwise; the same hours as the inline script in index.html's <head>).
// Auto is always resolved to a real data-theme attribute, with a
// data-theme-auto marker saying nobody picked it.
//
// Like openNav()/closeNav(), changing theme touches attributes and calls
// nothing else. No render(), no scheduleRender(). Re-rendering to change a
// colour would reload every sandboxed iframe on screen and lose the page's
// scroll — and the whole point of the render engine is that a repaint changing
// nothing writes nothing.
function paceClockTheme(d){
  var h=(d||new Date()).getHours();
  return (h>=5&&h<17)?'light':'dark';
}
window.paceClockTheme=paceClockTheme;
function isAutoTheme(){ return document.documentElement.hasAttribute('data-theme-auto'); }
window.isAutoTheme=isAutoTheme;
function currentTheme(){
  var set=document.documentElement.getAttribute('data-theme');
  if(set==='dark'||set==='light')return set;
  return paceClockTheme();
}
// THE SKY (R-122). Four phases by the clock — dawn 05–07, day 08–16, dusk
// 17–19, night 20–04 — independent of light/dark: someone who chose dark still
// sees the sun at noon. Set on <html> as data-sky before first paint
// (index.html, same hours) and kept up by paceClockCheck().
function paceSkyPhase(d){
  var h=(d||new Date()).getHours();
  return h>=5&&h<8?'dawn':h>=8&&h<17?'day':h>=17&&h<20?'dusk':'night';
}
window.paceSkyPhase=paceSkyPhase;
// The date line under the page title: "TUE · 06 OCT 2026 · 15:52 CDT" in
// the person's own zone. startClock() refreshes #tb-clock's TEXT every tick;
// nothing re-renders for it.
function paceHeaderClock(d){
  d=d||new Date();
  var day=d.toLocaleDateString('en-GB',{weekday:'short'}).toUpperCase();
  var date=d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
  var t=d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).toUpperCase();
  return day+' · '+date+' · '+t;
}
window.paceHeaderClock=paceHeaderClock;
// On Today only: how many of YOUR reminders are past due - real or absent, and
// a click goes to the Reminders page. There used to be a "N NEED YOU" chip
// beside it; it did nothing when clicked (and counted items the card below
// already lists), so the owner had it removed (R-122 step 3). A chip that
// looks like a button must be one.
function paceTodayChips(){
  if(STATE.page!=='dashboard'||(STATE.viewingUser&&STATE.viewingUser.id!==STATE.user.id))return '';
  var out='';
  var uid=STATE.user&&STATE.user.id, today=(typeof todayIST==='function')?todayIST():new Date().toISOString().slice(0,10);
  var late=(STATE.reminders||[]).filter(function(r){return r.user_id===uid&&r.status==='pending'&&r.return_date&&String(r.return_date).slice(0,10)<today;}).length;
  if(late)out+='<span class="tb-chip is-late" onclick="goPage(\'reminders\')" role="button">'+late+' PAST DUE</span>';
  return out?'<div class="tb-chips">'+out+'</div>':'';
}
// THE "+ NEW" MENU (R-122 step 3). One yellow button on every page that opens
// a small paper menu of the things a person can START: a job, a candidate, a
// lead, an email, a sequence. Each entry is offered ONLY to someone who is
// already given that action on its own page (same role gates as the Jobs /
// Candidates / Leads / Email / Sequence screens), and only when the function
// that does it is loaded - the menu never advertises something PACE cannot do.
// The open/closed flag lives in STATE so a repaint of the bar draws it the same.
function paceNewItems(){
  // R-135 (owner: "keep it the same; if permission is not there, it should be greyed out"):
  // every entry is ALWAYS listed. One the person cannot use is shown greyed with the reason —
  // never hidden, so the menu looks the same for everyone and nobody wonders where "Sequence" went.
  var u=STATE.user, out=[];
  if(!u)return out;
  var bdm=userHasAnyRole(u,'admin','bd','bd_lead');
  var recruiter=userHasRole(u,'recruiter');
  var viewingOther=!!(STATE.viewingUser&&STATE.viewingUser.id!==u.id);
  var away='You are looking at someone else\u2019s desk';
  function item(id,lbl,sub,ok,why,loaded){
    var can=!!ok&&(loaded!==false)&&!viewingOther;
    return {id:id,lbl:lbl,sub:sub,ok:can,why:can?'':(viewingOther?away:(ok?'Not available here':why))};
  }
  out.push(item('job','Job','An opening from a client',bdm,'BD managers and admins',typeof window.bdOpenNewJob==='function'));
  out.push(item('candidate','Candidate','Add a person to the pool',bdm||recruiter,'Recruiters, BD managers and admins',typeof window.atsOpenNew==='function'));
  out.push(item('lead','Lead','A company to sell to',!isPureRecruiter(u)&&u.role!=='ra','Sales roles only',typeof window.openAddJob==='function'));
  out.push(item('email','Email','Write a new message',!userHasRole(u,'ra')||userHasAnyRole(u,'bd','bd_lead','admin','ra_lead'),'Not available to analysts'));
  out.push(item('sequence','Sequence','Steps and timing for outreach',userHasAnyRole(u,'admin','ra_lead','bd_lead'),'Team leads and admins',typeof window.wfOpenBuilder==='function'));
  return out;
}
window.paceNewItems=paceNewItems;
function paceHeaderNew(){
  if(!STATE.user)return '';
  var items=paceNewItems();
  var any=items.some(function(it){return it.ok;});
  var open=!!STATE.newMenu&&any;
  if(!any){
    // nothing to start on this desk: the button stays, greyed, and says why on hover
    var why=items.length&&items[0].why==='You are looking at someone else\u2019s desk'?items[0].why:'Nothing to start from this role';
    return '<div class="tb-newwrap"><button class="btn btn-primary tb-new is-off" disabled aria-disabled="true" title="'+escAttr(why)+'">+ New<span class="tb-caret" aria-hidden="true"></span></button></div>';
  }
  return '<div class="tb-newwrap'+(open?' is-open':'')+'">'+
    '<button class="btn btn-primary tb-new" onclick="paceNewToggle(event)" aria-haspopup="menu" aria-expanded="'+(open?'true':'false')+'">+ New<span class="tb-caret" aria-hidden="true"></span></button>'+
    (open?'<div class="tb-newmenu" role="menu">'+items.map(function(it){
      if(!it.ok) return '<button class="tb-newrow is-off" role="menuitem" aria-disabled="true" disabled title="'+escAttr(it.why)+'">'+
        '<span class="tb-newlbl">'+it.lbl+'</span><span class="tb-newsub">'+htmlEsc(it.why)+'</span></button>';
      return '<button class="tb-newrow" role="menuitem" onclick="paceNewGo(\''+it.id+'\')">'+
        '<span class="tb-newlbl">'+it.lbl+'</span><span class="tb-newsub">'+it.sub+'</span></button>';
    }).join('')+'</div>':'')+
  '</div>';
}
window.paceNewToggle=function(ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  STATE.newMenu=!STATE.newMenu; render();
};
window.paceNewGo=function(kind){
  STATE.newMenu=false; render();     // the menu is gone first, whatever the action then draws
  if(kind==='job')return bdOpenNewJob(null);
  if(kind==='candidate')return atsOpenNew();
  if(kind==='lead')return openAddJob();
  if(kind==='email'){ STATE.emailTab='compose'; return goPage('email'); }
  if(kind==='sequence'){
    STATE.emailTab='sequence'; goPage('email');
    return setTimeout(function(){ if(window.wfOpenBuilder)wfOpenBuilder(); },0);
  }
};
// Click anywhere else, or Escape, closes the menu. One listener for the app.
document.addEventListener('click',function(ev){
  if(!STATE.newMenu)return;
  if(ev.target&&ev.target.closest&&ev.target.closest('.tb-newwrap'))return;
  STATE.newMenu=false; render();
});
document.addEventListener('keydown',function(ev){
  if(ev.key==='Escape'&&STATE.newMenu){ STATE.newMenu=false; render(); }
});
// Pixel clouds (always) and stars (CSS shows them at dusk and night).
var PACE_CLOUD=['......####......','...#########....','..############..','.##############.','################'];
function paceSkyDecor(){
  return '<span class="tb-cloud c1">'+pixelSprite(PACE_CLOUD,'currentColor',3)+'</span>'+
    '<span class="tb-cloud c2">'+pixelSprite(PACE_CLOUD,'currentColor',2)+'</span>'+
    '<span class="tb-stars"></span>';
}
window.paceSkyDecor=paceSkyDecor;

// The sun (06:00–18:59) or the moon (19:00–05:59) on an arc across the empty
// middle of the top bar — between the page title and the icons, so it never
// sits behind either. Quantised to 15 minutes so the bar's html (which the
// render engine compares) changes at most four times an hour.
var PACE_SUN=['...YYYY...','..YYYYYY..','.YYYYYYYY.','YYYYYYYYYY','YYYYYYYYYY','YYYYYYYYYY','YYYYYYYYYY','.YYYYYYYY.','..YYYYYY..','...YYYY...'];
var PACE_MOON=['...YYY.','..YYY..','.YYY...','.YYY...','.YYY...','..YYY..','...YYY.'];
function pixelSprite(rows,fill,px){
  var r='';
  rows.forEach(function(row,y){ for(var x=0;x<row.length;x++) if(row.charAt(x)!=='.') r+='<rect x="'+x+'" y="'+y+'" width="1.02" height="1.02"/>'; });
  return '<svg viewBox="0 0 '+rows[0].length+' '+rows.length+'" width="'+rows[0].length*px+'" height="'+rows.length*px+'" fill="'+fill+'" shape-rendering="crispEdges" aria-hidden="true">'+r+'</svg>';
}
window.pixelSprite=pixelSprite;
function paceSkyOrb(d){
  d=d||new Date();
  var h=d.getHours()+Math.floor(d.getMinutes()/15)*15/60;
  var sun=h>=6&&h<19, p=sun?(h-6)/13:((h-19+24)%24)/11;
  var left=(30+p*40).toFixed(1), top=Math.round(92-Math.sin(p*Math.PI)*22);
  return '<span class="tb-orb '+(sun?'is-sun':'is-moon')+'" style="left:'+left+'%;top:'+top+'px">'+
    (sun?pixelSprite(PACE_SUN,'currentColor',3.4):pixelSprite(PACE_MOON,'currentColor',4.4))+'</span>';
}
window.paceSkyOrb=paceSkyOrb;
function themeChanged(){
  // Anything that paints itself rather than being painted BY CSS has to be
  // told. Right now that is the login backdrop (a <canvas>); an event keeps
  // that knowledge with the thing that needs it instead of hard-wiring a call
  // to a function that may not be on the page.
  try{ window.dispatchEvent(new Event('pace-theme-change')); }catch(e){}
}
// APPLY A CHOSEN THEME WITHOUT RE-RENDERING. Shared by the toggle and by the
// account-preference load, so there is one place that knows how to put a theme
// on screen.
function applyTheme(next){
  document.documentElement.removeAttribute('data-theme-auto');
  document.documentElement.setAttribute('data-theme',next);
  // localStorage stays, but only as the INSTANT-APPLY CACHE: it is read before
  // the account preference arrives so the page never flashes the wrong theme
  // while a fetch is in flight. The account is the authority (D-0022).
  try{ localStorage.setItem('pace-theme',next); }catch(e){ /* private mode: lasts the session */ }
  themeChanged();
}
window.applyTheme=applyTheme;
// BACK TO AUTO: forget the choice and let the clock decide.
function applyAutoTheme(){
  try{ localStorage.removeItem('pace-theme'); }catch(e){}
  document.documentElement.setAttribute('data-theme-auto','');
  var was=document.documentElement.getAttribute('data-theme');
  var now=paceClockTheme();
  document.documentElement.setAttribute('data-theme',now);
  if(was!==now)themeChanged();
}
window.applyAutoTheme=applyAutoTheme;
// AUTO KEEPS UP WITH THE CLOCK — but never under someone's hands. Called when
// they move to another screen (goPage) and when they come back to the tab; a
// timer would flip the page while they are reading it.
window.paceClockCheck=function(){
  var sky=paceSkyPhase();
  if(document.documentElement.getAttribute('data-sky')!==sky)document.documentElement.setAttribute('data-sky',sky);
  if(!isAutoTheme())return;
  var now=paceClockTheme();
  if(document.documentElement.getAttribute('data-theme')!==now){
    document.documentElement.setAttribute('data-theme',now);
    themeChanged();
  }
};
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible')window.paceClockCheck();
});

// ONE CLICK ALWAYS FLIPS WHAT IS ON SCREEN. If the flip lands on what the clock
// would show anyway, that is Auto again (saved as 'system', the value the
// account preference already uses for "nobody chose"); otherwise it is a
// choice. So in the daytime: Auto(light) → Dark → Auto(light) → …
window.toggleTheme=function(){
  var next=currentTheme()==='dark'?'light':'dark';
  var save;
  if(!isAutoTheme()&&next===paceClockTheme()){ applyAutoTheme(); save='system'; }
  else { applyTheme(next); save=next; }
  // THE CHOICE FOLLOWS THE PERSON, NOT THE BROWSER (D-0022). Saved against the
  // account so it reaches their other devices and does NOT carry over to
  // whoever signs in next on a shared computer. Best-effort: a preference that
  // fails to save still applied on screen, and localStorage keeps it for this
  // browser, so the failure costs a sync and never the interaction.
  if(STATE&&STATE.token&&typeof apiFetch==='function'){
    apiFetch('PUT','/me/preferences',{theme:save}).catch(function(){});
  }
};

// Read the signed-in user's saved theme and apply it. Called after login.
// If they have never chosen one, the browser's cached choice stands — we do not
// overwrite a local preference with a default nobody set.
window.loadThemePreference=function(){
  if(!(STATE&&STATE.token)||typeof apiGet!=='function')return;
  apiGet('/me/preferences').then(function(p){
    if(!p||!p.theme)return;
    if(p.theme==='system'){ if(!isAutoTheme())applyAutoTheme(); return; }
    if(p.theme==='light'||p.theme==='dark'){
      if(isAutoTheme()||p.theme!==currentTheme())applyTheme(p.theme);
    }
  }).catch(function(){});
};

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
      // a password session are indistinguishable from here on — including the
      // person's own theme (D-0022).
      if(window.loadThemePreference)loadThemePreference();
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
    return '<div class="fs-13 c-text3" style="margin-bottom:16px;line-height:1.55">'+
        'Create your PACE workspace in one step — no password to choose. Sign in with your work account and we’ll set everything up.'+
      '</div>'+
      (STATE.ssoProviders||[]).map(function(p){
        return '<button class="google-btn" onclick="startSso(\''+p.id+'\')">'+
          '<span style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center">'+(SSO_ICON[p.id]||'')+'</span>'+
          htmlEsc(String(p.label||'').replace(/^Continue with/,'Sign up with'))+
        '</button>';
      }).join('')+
      '<div class="fs-11_5 c-text3" style="margin-top:14px;line-height:1.55;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px">'+
        '<strong class="c-text2">If your company already uses PACE</strong> and has verified its email domain, you’ll join their workspace automatically. '+
        'Otherwise you get a private workspace of your own — you can invite your team and claim your domain from there.'+
      '</div>'+
      '<div class="fs-11_5 c-text3" style="margin-top:12px;text-align:center;line-height:1.5">Already have an account? '+
        '<button onclick="STATE.loginTab=\'login\';render()" style="background:none;border:0;padding:0;color:var(--accent);font-size:12px;cursor:pointer;text-decoration:underline;font-family:inherit">Log in</button>'+
      '</div>';
  }
  if(STATE.signupSent){
    return '<div style="text-align:center;padding:14px 4px">'+
      '<div style="font-size:34px;line-height:1;margin-bottom:10px">✓</div>'+
      '<div class="fs-16" style="font-family:var(--display);font-weight:600;margin-bottom:6px">Request received</div>'+
      '<div class="fs-13 c-text3" style="line-height:1.55">We’ll be in touch at <strong>'+htmlEsc(STATE.signupSent)+'</strong> to set your workspace up.</div>'+
      '<button onclick="STATE.signupSent=null;STATE.loginTab=\'login\';render()" style="margin-top:16px;background:none;border:0;color:var(--accent);font-size:13px;cursor:pointer;text-decoration:underline;font-family:inherit">Back to log in</button>'+
    '</div>';
  }
  return '<div class="fs-13 c-text3" style="margin-bottom:16px;line-height:1.55">'+
      'PACE is rolling out to new organisations. Tell us where to reach you and we’ll set your workspace up.'+
    '</div>'+
    '<div class="fgrp"><label class="flbl">Work email</label><input class="inp" id="su-email" type="email" placeholder="you@yourcompany.com"/></div>'+
    '<div class="fgrp"><label class="flbl">Company <span class="c-text3" style="font-weight:400">(leave blank if it’s just you)</span></label><input class="inp" id="su-company" type="text" placeholder="Your company"/></div>'+
    '<div id="su-err" class="c-red fs-12" style="display:none;background:var(--red-l);padding:8px 10px;border-radius:var(--r);margin-bottom:12px"></div>'+
    '<button class="btn btn-primary w100" style="justify-content:center" onclick="submitSignupRequest()">Request access</button>'+
    '<div class="fs-11_5 c-text3" style="margin-top:12px;text-align:center;line-height:1.5">Already have an account? '+
      '<button onclick="STATE.loginTab=\'login\';render()" style="background:none;border:0;padding:0;color:var(--accent);font-size:12px;cursor:pointer;text-decoration:underline;font-family:inherit">Log in</button>'+
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
