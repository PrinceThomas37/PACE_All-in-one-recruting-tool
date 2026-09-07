// ===== RESUME → SUBMISSION FORMAT =====
// Takes an uploaded resume (pdf / word / txt / rtf), runs it through the
// existing parse endpoint, and lays the content onto the company letterhead
// as the standard submission document — with a live preview and Word / PDF
// download. The letterhead uses the real futé brand assets (logo + Dallas
// address) extracted from the company's submission template.

(function () {

  function esc(s){ return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  // ── futé letterhead — real brand logo (base64 PNG) + Dallas HQ address ─────
  var FUTE_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAbQAAADBCAYAAACnrEWAAAAACXBIWXMAAC4jAAAuIwF4pT92AAALrWlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNS42LWMxNDUgNzkuMTYzNDk5LCAyMDE4LzA4LzEzLTE2OjQwOjIyICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOnhtcFRQZz0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3QvcGcvIiB4bWxuczpzdERpbT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL0RpbWVuc2lvbnMjIiB4bWxuczp4bXBHPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvZy8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0RXZ0PSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VFdmVudCMiIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczpwZGY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vcGRmLzEuMy8iIHhtbG5zOnBob3Rvc2hvcD0iaHR0cDovL25zLmFkb2JlLmNvbS9waG90b3Nob3AvMS4wLyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBJbGx1c3RyYXRvciBDQyAyMy4wIChXaW5kb3dzKSIgeG1wOkNyZWF0ZURhdGU9IjIwMjQtMTAtMjlUMDE6NDU6MzArMDY6MzAiIHhtcDpNb2RpZnlEYXRlPSIyMDI0LTEwLTI5VDAxOjQ2OjE2KzA1OjMwIiB4bXA6TWV0YWRhdGFEYXRlPSIyMDI0LTEwLTI5VDAxOjQ2OjE2KzA1OjMwIiB4bXBUUGc6TlBhZ2VzPSIxIiB4bXBUUGc6SGFzVmlzaWJsZVRyYW5zcGFyZW5jeT0iRmFsc2UiIHhtcFRQZzpIYXNWaXNpYmxlT3ZlcnByaW50PSJGYWxzZSIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHhtcE1NOlJlbmRpdGlvbkNsYXNzPSJwcm9vZjpwZGYiIHhtcE1NOkRvY3VtZW50SUQ9ImFkb2JlOmRvY2lkOnBob3Rvc2hvcDo3M2IzZDJmOS1iOTdjLWVlNGUtOTlmYi00YTQxNTdiYTE4MzEiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6NmU5NmI2MDUtMWEzNi0zOTRhLWFiOGYtMmU4ZmIxNjhjODQ3IiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InV1aWQ6M2ZiZTQyOWItZTQwMC00MzhlLWFlZTQtZDdjMjNjNTMxMzA4IiBwZGY6UHJvZHVjZXI9IkFkb2JlIFBERiBsaWJyYXJ5IDE1LjAwIiBwaG90b3Nob3A6Q29sb3JNb2RlPSIzIiBwaG90b3Nob3A6SUNDUHJvZmlsZT0ic1JHQiBJRUM2MTk2Ni0yLjEiPiA8eG1wVFBnOk1heFBhZ2VTaXplIHN0RGltOnc9IjEuNjQzMDU2IiBzdERpbTpoPSIwLjg0MDI3OCIgc3REaW06dW5pdD0iSW5jaGVzIi8+IDx4bXBUUGc6UGxhdGVOYW1lcz4gPHJkZjpTZXE+IDxyZGY6bGk+Q3lhbjwvcmRmOmxpPiA8cmRmOmxpPk1hZ2VudGE8L3JkZjpsaT4gPHJkZjpsaT5ZZWxsb3c8L3JkZjpsaT4gPHJkZjpsaT5CbGFjazwvcmRmOmxpPiA8L3JkZjpTZXE+IDwveG1wVFBnOlBsYXRlTmFtZXM+IDx4bXBUUGc6U3dhdGNoR3JvdXBzPiA8cmRmOlNlcT4gPHJkZjpsaSB4bXBHOmdyb3VwTmFtZT0iRGVmYXVsdCBTd2F0Y2ggR3JvdXAiIHhtcEc6Z3JvdXBUeXBlPSIwIi8+IDwvcmRmOlNlcT4gPC94bXBUUGc6U3dhdGNoR3JvdXBzPiA8ZGM6dGl0bGU+IDxyZGY6QWx0PiA8cmRmOmxpIHhtbDpsYW5nPSJ4LWRlZmF1bHQiPmZ1dGUtbG9nby1uZXc8L3JkZjpsaT4gPC9yZGY6QWx0PiA8L2RjOnRpdGxlPiA8eG1wTU06SGlzdG9yeT4gPHJkZjpTZXE+IDxyZGY6bGkgc3RFdnQ6YWN0aW9uPSJjb252ZXJ0ZWQiIHN0RXZ0OnBhcmFtZXRlcnM9ImZyb20gYXBwbGljYXRpb24vcGRmIHRvIGFwcGxpY2F0aW9uL3ZuZC5hZG9iZS5waG90b3Nob3AiLz4gPHJkZjpsaSBzdEV2dDphY3Rpb249InNhdmVkIiBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOjlkNThiYzgxLTIxYTMtMTI0NC1hZThjLTQ3N2YwOWQ4OTVkMyIgc3RFdnQ6d2hlbj0iMjAyNC0xMC0yOVQwMTo0NjoxNiswNTozMCIgc3RFdnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUGhvdG9zaG9wIENDIDIwMTkgKFdpbmRvd3MpIiBzdEV2dDpjaGFuZ2VkPSIvIi8+IDxyZGY6bGkgc3RFdnQ6YWN0aW9uPSJjb252ZXJ0ZWQiIHN0RXZ0OnBhcmFtZXRlcnM9ImZyb20gYXBwbGljYXRpb24vcGRmIHRvIGltYWdlL3BuZyIvPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0iZGVyaXZlZCIgc3RFdnQ6cGFyYW1ldGVycz0iY29udmVydGVkIGZyb20gYXBwbGljYXRpb24vdm5kLmFkb2JlLnBob3Rvc2hvcCB0byBpbWFnZS9wbmciLz4gPHJkZjpsaSBzdEV2dDphY3Rpb249InNhdmVkIiBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOjZlOTZiNjA1LTFhMzYtMzk0YS1hYjhmLTJlOGZiMTY4Yzg0NyIgc3RFdnQ6d2hlbj0iMjAyNC0xMC0yOVQwMTo0NjoxNiswNTozMCIgc3RFdnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUGhvdG9zaG9wIENDIDIwMTkgKFdpbmRvd3MpIiBzdEV2dDpjaGFu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';
  var FUTE_ADDRESS = '8111 Lyndon B. Johnson Freeway, Suite 1340, Dallas, TX 75251';
  var LETTERHEAD_TOP =
    '<div style="border-bottom:3px solid #2E7D32;padding:16px 0 12px;display:flex;justify-content:space-between;align-items:flex-end">'+
      '<img src="'+FUTE_LOGO+'" alt="futé" style="height:44px;width:auto">'+
      '<div style="font-size:10.5px;color:#777;text-align:right;letter-spacing:.08em;text-transform:uppercase">Candidate Submission</div>'+
    '</div>';
  var LETTERHEAD_BOTTOM =
    '<div style="border-top:2px solid #2E7D32;margin-top:26px;padding-top:8px;font-size:9.5px;color:#888;text-align:center">'+
      'futé · Recruiting &amp; Staffing · '+esc(FUTE_ADDRESS)+
    '</div>';

  // The parse endpoint may return skills as an array, a comma/newline-delimited
  // string, or null — normalize to a clean array so .map never blows up.
  function skillsArray(s){
    if (Array.isArray(s)) return s.filter(function(x){ return x!=null && String(x).trim(); }).map(function(x){ return String(x).trim(); });
    if (typeof s === 'string') return s.split(/[,;\n|]+/).map(function(x){ return x.trim(); }).filter(Boolean);
    return [];
  }

  function docHtml(fields, text, filename){
    var f = fields || {};
    // The parser returns full_name / experience_years; keep the old aliases as
    // fallbacks so either shape renders the real name (not "Candidate").
    var name = f.full_name || f.name || '';
    var yrs = (f.experience_years != null ? f.experience_years : f.years_experience);
    var title = f.current_title || '';
    var contact = [f.email, f.phone, [f.city,f.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    var sk = skillsArray(f.skills);
    var skills = sk.length
      ? '<div style="margin:10px 0 2px;font-weight:700;font-size:12px;color:#2E7D32;text-transform:uppercase;letter-spacing:.06em">Key Skills</div>'+
        '<div style="font-size:12px;line-height:1.6">'+sk.map(esc).join(' · ')+'</div>'
      : '';
    var exp = (yrs!=null && yrs!=='' && isFinite(Number(yrs))) ? '<span style="font-size:12px;color:#555"> · '+esc(String(yrs))+' yrs experience</span>' : '';
    return '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(name||filename||'Submission')+'</title></head>'+
      '<body style="font-family:Calibri,Arial,sans-serif;color:#222;max-width:750px;margin:0 auto;padding:0 28px 20px">'+
        LETTERHEAD_TOP+
        '<div style="margin-top:16px">'+
          '<div style="font-size:20px;font-weight:700">'+esc(name||'Candidate')+exp+'</div>'+
          (title?'<div style="font-size:13px;color:#333;margin-top:1px">'+esc(title)+'</div>':'')+
          (contact?'<div style="font-size:12px;color:#555;margin-top:2px">'+esc(contact)+'</div>':'')+
          (f.linkedin_url?'<div style="font-size:12px;color:#555">'+esc(f.linkedin_url)+'</div>':'')+
          skills+
          '<div style="margin:14px 0 4px;font-weight:700;font-size:12px;color:#2E7D32;text-transform:uppercase;letter-spacing:.06em">Resume</div>'+
          '<div style="font-size:12px;line-height:1.55;white-space:pre-wrap">'+esc(text||'')+'</div>'+
        '</div>'+
        LETTERHEAD_BOTTOM+
      '</body></html>';
  }

  // A .doc data-URI from the formatted HTML — HTML with a .doc name opens
  // natively in Word, and this is what gets attached to the submission packet.
  // UTF-8 safe (btoa alone breaks on accented chars like the é in futé).
  window.atsFormattedDocDataUri = function(html){
    var bytes = new TextEncoder().encode('﻿' + html);
    var bin = ''; for (var i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
    return 'data:application/msword;base64,' + btoa(bin);
  };

  // Format from a File object (used by the Submit-to-BDM modal and anywhere
  // else a resume file is at hand). opts.onFormatted(html, name) receives the
  // formatted document so the caller can stash it (e.g. attach to the packet).
  window.atsFormatResumeFile = function(file, opts){
    opts = opts || {};
    if (!file) return;
    if (file.size > 4.5*1024*1024) { showToast('File too large (max ~4.5 MB)','error'); return; }
    showToast('Formatting resume…','success');
    var reader = new FileReader();
    reader.onload = function(){
      apiPost('/candidates/parse-resume', { filename: file.name, size: file.size, data_base64: String(reader.result) })
        .then(function(r){
          var flds = (r&&r.fields)||{};
          var html = docHtml(flds, (r&&r.resume_text)||'', file.name);
          var name = flds.full_name || flds.name || file.name;
          if (opts.onFormatted) { try { opts.onFormatted(html, name); } catch(e){} }
          if (opts.preview !== false) openPreview(html, name);
        })
        .catch(function(e){ showToast('Could not parse the resume: '+e.message,'error'); });
    };
    reader.onerror = function(){ showToast('Could not read the file','error'); };
    reader.readAsDataURL(file);
  };

  function openPreview(html, name){
    var old = document.getElementById('ats-fmt-overlay'); if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'ats-fmt-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:120;display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML =
      '<div style="background:var(--card);border-radius:12px;width:820px;max-width:96vw;height:88vh;display:flex;flex-direction:column;overflow:hidden">'+
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">'+
          '<div style="font-weight:700;font-size:14px;flex:1">Formatted submission — preview</div>'+
          '<button class="btn btn-sm btn-outline" id="ats-fmt-word">Download Word</button>'+
          '<button class="btn btn-sm btn-outline" id="ats-fmt-pdf">Download PDF</button>'+
          '<button class="btn btn-sm btn-outline" id="ats-fmt-close">✕</button>'+
        '</div>'+
        '<iframe id="ats-fmt-frame" style="flex:1;border:0;background:#fff"></iframe>'+
      '</div>';
    document.body.appendChild(ov);
    var frame = document.getElementById('ats-fmt-frame');
    frame.srcdoc = html;
    var base = String(name||'candidate').replace(/[^A-Za-z0-9 _-]/g,'').trim().replace(/\s+/g,'_') || 'candidate';
    document.getElementById('ats-fmt-close').onclick = function(){ ov.remove(); };
    ov.onclick = function(e){ if (e.target===ov) ov.remove(); };
    // Word: an HTML document with a .doc name opens natively in Word.
    document.getElementById('ats-fmt-word').onclick = function(){
      var blob = new Blob(['﻿', html], { type: 'application/msword' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = base + '_Submission.doc';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
    };
    // PDF: the browser's print-to-PDF on the preview frame.
    document.getElementById('ats-fmt-pdf').onclick = function(){
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch(e){ showToast('Use the browser print dialog → Save as PDF','error'); }
    };
  }

})();
