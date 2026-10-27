// ════════════════════════════════════════════════
// SHARED CONSTANTS & FORMAT HELPERS
// ════════════════════════════════════════════════
//
// This file used to be 01-seed-demo.js and was mostly a generated world: 25
// invented staff, a dozen invented companies, and functions that spun those
// into hundreds of fake leads, activities and jobs at page load. All of that
// existed to give the "Continue as Guest" product tour something to show. The
// tour is gone — it handed anyone read-only access to a real customer's live
// org — and so is the fake world.
//
// What is left is the part real screens actually use: the lead-stage
// vocabulary, the dropdown lists, and the date/formatting helpers that most of
// the other modules call. Nothing here invents data.

// BD lead stages, in the order the dashboard shows them as pills.
// A contact's email status — the order the menu offers them in, and their names. The server's definition is services/contact-status.js
// (test/contact-status-smoke.mjs fails if the two ever disagree). "Blocked" = the address is right, but their side rejects our mail.
var CONTACT_STATUSES = ["valid","invalid","deactivated","blocked","out_of_office"];
var CONTACT_STATUS_LABELS = { valid:"Valid", invalid:"Invalid", deactivated:"Deactivated", blocked:"Blocked", out_of_office:"Out of office" };
// What a job's pay figures are PER (migration 065, owner 14 Oct: "no option to choose hourly, weekly, yearly"). The server's list is
// services/recruiting-core.js PAY_PERIODS; the ids are the stored words, the short form is what a row prints after the range.
var PAY_PERIODS = [["hour","Hourly","/hr"],["week","Weekly","/wk"],["month","Monthly","/mo"],["year","Yearly","/yr"]];
// "USD 22–26 /hr" — or `empty` when the job has no pay at all. One place, so a row can never print the range without its period.
function jobPayText(j, empty){
  j = j || {};
  if(!(j.pay_min||j.pay_max)) return empty==null ? '' : empty;
  var per = PAY_PERIODS.filter(function(x){ return x[0]===j.pay_period; })[0];
  return (j.pay_cur||'USD')+' '+(j.pay_min||'?')+'–'+(j.pay_max||'?')+(per?' '+per[2]:'');
}
// Words in a posting's own pay text ("$22 - $26 per hour", "120k a year") → the period id, or '' when it does not say.
function payPeriodFromText(t){
  t = String(t||'').toLowerCase();
  if(/(\bper\s+hour\b|\/\s*h(ou)?r\b|\ban\s+hour\b|\bhourly\b|\bph\b)/.test(t)) return 'hour';
  if(/(\bper\s+week\b|\/\s*(wk|week)\b|\bweekly\b)/.test(t)) return 'week';
  if(/(\bper\s+month\b|\/\s*(mo|month)\b|\bmonthly\b)/.test(t)) return 'month';
  if(/(\bper\s+(year|annum)\b|\/\s*(yr|year)\b|\bannual(ly)?\b|\ba\s+year\b|\bp\.?a\.?\b|\byearly\b)/.test(t)) return 'year';
  return '';
}
var STAGES = ["Active","No Response","Negative","Positive","Connected","Future","Out of Office","Deactivated","Referred"];

// Fallback industry list — used only when the server has not supplied one
// (getIndustriesList() is the real source).
var INDUSTRIES = ["Technology","Finance","Healthcare","Manufacturing","Retail","Education","Consulting","Media","Logistics","Legal","Real Estate"];

// Where a BD lead came from. Offered in the lead form's Source dropdown.
var SOURCES = ["LinkedIn","Indeed","Naukri","Company Website","Glassdoor","AngelList","Referral","Other"];

// ── Formatting helpers (used across nearly every module) ────────────────────

// "Today" is the VIEWER'S own calendar day, as YYYY-MM-DD (D-0065, R-103: "that date according to the
// system of the user"). This used to be India's date for everyone (device time + 5.5 h), so a US
// recruiter's reminders turned "due" about ten hours early and "today's leads" flipped at the wrong hour.
// The name is kept — a dozen call sites — but it now reads the device's clock.
function localDayKey(v){
  if(v&&/^\d{4}-\d{2}-\d{2}$/.test(String(v)))return String(v);   // a plain date is already a day
  var d=v?new Date(v):new Date();
  if(isNaN(d.getTime()))return "";
  var p=function(n){return String(n).padStart(2,"0")};
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
}
function todayIST(){return localDayKey()}

// The viewer's IANA time zone, for the server's windows (?tz=…, R-105). withTz("/x?a=1") → "/x?a=1&tz=Asia/Kolkata".
function viewerTz(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch(e){return ""}}
function withTz(path){var z=viewerTz();if(!z)return path;return path+(path.indexOf("?")<0?"?":"&")+"tz="+encodeURIComponent(z)}

// YYYY-MM-DD → DD/MM/YYYY, with an em-dash for nothing.
function fmtDate(d){if(!d)return"—";var p=d.split("-");return p[2]+"/"+p[1]+"/"+p[0]}

// Look a user's name up by id, from a roster the caller supplies.
function uname(id,users){var u=(users||[]).find(function(x){return x.id===id});return u?u.name:"—"}

// Stage → CSS class, e.g. "Out of Office" → "st-Out_of_Office".
function stageClass(s){return"st-"+String(s||"").replace(/ /g,"_")}

// ── The organisation's contact database (R-321, D-0175) ──────────────────────────────────────────────────────────────────────────────
// What the server last said about it: { provider, label, name, connected, capabilities } — set by the screens that fetch it
// (`cdSet`). The NAME is the provider the organisation chose, never a vendor written into a screen; until the server has said, it is
// the plain words. `cdCan(verb)` is "may the screen offer this?": a provider that does not offer a verb does not get the button.
// Unknown (nothing fetched yet) = yes — the server answers in words if it cannot.
function cdSet(c){ if(c && typeof c==='object') STATE.contactData=c; }
function cdn(){ var c=STATE.contactData; return (c&&c.name)||'the contact database'; }
function cdnCap(){ var n=cdn(); return n.charAt(0).toUpperCase()+n.slice(1); }
function cdCan(verb){ var c=STATE.contactData; if(!c||!c.capabilities||!c.capabilities[verb]) return true; return !!c.capabilities[verb].offered; }
function cdOr(plain){ var c=STATE.contactData; return (c&&c.name)||plain; }   // the provider's own name when the server has said it, else the plain word
