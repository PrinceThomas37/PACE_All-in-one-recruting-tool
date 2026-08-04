// ── Boot ───────────────────────────────────────
// The SSO check runs FIRST. Someone returning from "Continue with Microsoft /
// Google" arrives at "/#sso=<token>" with no stored session yet, so without
// this they would land on the login screen while holding a perfectly good
// token — the sign-in would appear to have silently failed.
// consumeSsoToken() takes over rendering when it handles one.
if(typeof consumeSsoToken==='function'&&consumeSsoToken()){
  /* signing in via SSO — that path renders once the profile loads */
}else if(STATE.token&&STATE.user){STATE.page='dashboard';loadAppData();}
else{STATE.page='login';render();}
