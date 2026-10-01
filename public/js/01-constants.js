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
