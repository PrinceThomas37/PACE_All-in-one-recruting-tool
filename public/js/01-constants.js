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

// "Today" in IST, as YYYY-MM-DD. The business runs on IST, so a date must not
// flip at the server's midnight or the browser's.
function todayIST(){var n=new Date();return new Date(n.getTime()+5.5*3600000).toISOString().split("T")[0]}

// YYYY-MM-DD → DD/MM/YYYY, with an em-dash for nothing.
function fmtDate(d){if(!d)return"—";var p=d.split("-");return p[2]+"/"+p[1]+"/"+p[0]}

// Look a user's name up by id, from a roster the caller supplies.
function uname(id,users){var u=(users||[]).find(function(x){return x.id===id});return u?u.name:"—"}

// Stage → CSS class, e.g. "Out of Office" → "st-Out_of_Office".
function stageClass(s){return"st-"+String(s||"").replace(/ /g,"_")}
