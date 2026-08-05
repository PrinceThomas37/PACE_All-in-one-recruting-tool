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

window.doLogout=function(){
  STATE.user=null;STATE.token=null;
  sessionStorage.removeItem('fg_token');sessionStorage.removeItem('fg_user');
  STATE.jobs=[];STATE.contacts=[];STATE.page='login';render();
};
