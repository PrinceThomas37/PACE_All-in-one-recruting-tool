// ============================================================================
// SPREADSHEET ROWS THAT ARE HIDDEN OR FILTERED OUT (R-306, owner 3 Nov 2026).
// The 26 Oct import: the owner expected 78 leads and PACE created 95 — rows hidden or filtered out of the sheet were read as if they were there.
// SheetJS reads every row; a row the person hid (or an auto-filter hid) carries `hidden` in the worksheet's row info. What the owner decided:
// show "N rows are hidden", import ONLY the visible rows by default, and import all only when the person chooses it.
// PURE: takes the worksheet and the XLSX object (so it is tested in Node with the real library, and used in the browser with the page's own).
//   read(ws, XLSX) → { all:[row objects, exactly what sheet_to_json gives], visible:[the same without hidden rows], hidden:n }
// The first row is the header and always counts as visible. A hidden row that is blank is not counted (nobody sees a loss).
// ============================================================================
(function(root){
  'use strict';
  function read(ws, XLSX){
    var all=XLSX.utils.sheet_to_json(ws,{defval:''});
    var info=(ws&&ws['!rows'])||[];
    if(!info.some(function(r){return r&&r.hidden;})) return {all:all,visible:all,hidden:0};
    var ref=ws['!ref']; if(!ref) return {all:all,visible:all,hidden:0};
    var range=XLSX.utils.decode_range(ref);
    // every row as an array, blank rows kept, so array index i is worksheet row range.s.r + i
    var aoa=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',blankrows:true});
    var kept=[aoa[0]], hidden=0;
    for(var i=1;i<aoa.length;i++){
      var rinfo=info[range.s.r+i];
      var isHidden=!!(rinfo&&rinfo.hidden);
      var blank=aoa[i].every(function(c){return c===''||c==null;});
      if(isHidden){ if(!blank)hidden++; continue; }
      kept.push(aoa[i]);
    }
    if(!hidden) return {all:all,visible:all,hidden:0};
    // the same conversion as for `all` (duplicate header names, blank rows), on a sheet that no longer has the hidden rows
    var visible=XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(kept),{defval:''});
    return {all:all,visible:visible,hidden:hidden};
  }
  var api={read:read};
  if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.ImportVisible=api;
})(typeof window!=='undefined'?window:this);
