// ── Auth ───────────────────────────────────────
//
// This file used to be 23-auth-guest.js and was mostly the guest tour: a fake
// signed-in user, a hand-written set of demo leads/contacts/emails, a role
// switcher, and a "guestSimulate" layer that faked the result of every write so
// the tour appeared to work. All of it is gone, along with the `guest` token the
// backend accepted — that token granted read-only access to the DEFAULT
// organisation, which is a real customer's live data. Defensible while PACE was
// one company's internal tool; not once strangers can sign themselves up.
//
// If a product tour is wanted again, it must be served from its own seeded
// organisation with its own real login, never from a bypass.

window.doLogin=function(){
  if(IS_FILE){showToast('Open PACE in your browser, not from a file','warning');return;}
  var em=(document.getElementById('login-email')||{}).value||'';
  var pw=(document.getElementById('login-pass')||{}).value||'';
  if(!em||!pw){var e=document.getElementById('login-err');if(e){e.textContent='Enter email and password';e.style.display='block';}return;}
  STATE.token=null;STATE.user=null;STATE.loginNotice=null;
  sessionStorage.removeItem('fg_token');sessionStorage.removeItem('fg_user');
  STATE.loading=true;render();
  apiPost('/auth/login',{email:em,password:pw}).then(function(d){
    STATE.token=d.token;STATE.user=normaliseUser(d.user);
    sessionStorage.setItem('fg_token',d.token);sessionStorage.setItem('fg_user',JSON.stringify(STATE.user));
    STATE.page='dashboard';
    // The theme belongs to the PERSON (D-0022) — pull theirs now so a shared
    // computer does not leave them with the last user's choice.
    if(window.loadThemePreference)loadThemePreference();
    loadAppData();
  }).catch(function(err){
    STATE.loading=false;render();
    var e=document.getElementById('login-err');if(e){e.textContent=err.message||'Invalid credentials';e.style.display='block';}
  });
};

// ── A sign-in that ran out (R-118) ──────────────────────────────────────────
// PACE sessions last 8 hours. A tab left open longer used to keep showing the old screen and fail every click
// with a raw "Invalid token". Now: the FIRST time the server says the session is gone (or the tab is looked at
// again and the token is past its time), we remember where the person was, put the login screen up with one plain
// sentence, and — once they sign in again (password or Microsoft/Google) — take them back to that place.
//
// "Where" = the page, plus the job and candidate they had open (the navigation trail, 37-nav-history.js).
// It is kept in sessionStorage (this tab only, gone when the tab closes), used ONCE, only for the SAME person, and
// only if it is under 12 hours old. An explicit sign-out throws it away: whoever sits down next starts clean.
var RESUME_KEY='fg_resume', RESUME_MAX_MS=12*60*60*1000;
window.saveResumePoint=function(){
  try{
    if(!STATE.user||!STATE.page||STATE.page==='login')return;
    var st=(STATE.nav&&STATE.nav.stack)||[];
    sessionStorage.setItem(RESUME_KEY,JSON.stringify({uid:STATE.user.id,page:STATE.page,stack:st.length>1?st:[],at:Date.now()}));
  }catch(e){}
};
window.sessionExpired=function(){
  if(STATE._expiring||!STATE.token)return;     // many calls fail together; one answer is enough
  STATE._expiring=true;
  saveResumePoint();
  if(window.stopBackgroundPoll)stopBackgroundPoll();
  if(window.stopProgressPoll)stopProgressPoll();
  STATE.token=null;STATE.user=null;STATE.modal=null;STATE.loading=false;
  sessionStorage.removeItem('fg_token');sessionStorage.removeItem('fg_user');
  STATE.jobs=[];STATE.contacts=[];
  STATE.loginErr=null;STATE.loginTab='login';
  STATE.loginNotice='Your session expired. Sign in again and PACE will take you back to where you were.';
  STATE.page='login';
  render();
  STATE._expiring=false;
};
window.resumeWhereLeftOff=function(){
  var raw=null;
  try{raw=sessionStorage.getItem(RESUME_KEY);sessionStorage.removeItem(RESUME_KEY);}catch(e){}
  if(!raw||!STATE.user)return false;
  var r=null;try{r=JSON.parse(raw);}catch(e){return false;}
  if(!r||r.uid!==STATE.user.id||!r.at||Date.now()-r.at>RESUME_MAX_MS)return false;
  var ok=false;
  if(r.stack&&r.stack.length>1&&window.navResume){ok=navResume(r.stack);}
  else if(r.page&&r.page!=='login'&&r.page!==STATE.page&&window.goPage){goPage(r.page);ok=true;}
  if(ok&&window.showToast)showToast('Welcome back — you are where you left off.','success');
  return ok;
};

window.loginAs=function(){showToast('Use email + password to log in','warning');};

window.doLogout=function(){
  // Drop the cached theme with the session. It is the previous PERSON's choice,
  // and the next one to sign in at this desk gets their own (D-0022).
  try{ localStorage.removeItem('pace-theme'); }catch(e){}
  STATE.user=null;STATE.token=null;STATE.loginNotice=null;
  sessionStorage.removeItem('fg_token');sessionStorage.removeItem('fg_user');sessionStorage.removeItem('fg_resume');
  STATE.jobs=[];STATE.contacts=[];STATE.page='login';render();
};
