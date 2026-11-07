// Runs before office.js. If PowerPoint has not finished loading the add-in after
// a few seconds, say so instead of leaving an empty pane, and offer a reload.
(function () {
  setTimeout(function () {
    if (window.__openroomStarted) return;
    var officeLoaded = typeof window.Office !== 'undefined';
    var note = document.createElement('div');
    note.id = 'openroom-boot-stalled';
    note.setAttribute('role', 'status');
    note.setAttribute('data-stage', officeLoaded ? 'app' : 'office');
    note.style.cssText = 'margin:0;padding:24px;font:14px/1.5 system-ui,sans-serif;color:#1b302e;background:#f6f8f6';
    var text = document.createElement('p');
    text.style.margin = '0 0 12px';
    text.textContent = 'PowerPoint is still loading OpenRoom. Reload the add-in. If that does not help, close this pane and open it again, or quit and reopen PowerPoint.';
    var detail = document.createElement('p');
    detail.style.cssText = 'margin:12px 0 0;font-size:12px;color:#53655f';
    detail.textContent = officeLoaded ? 'Office loaded; OpenRoom did not start.' : 'Office did not load.';
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reload';
    button.style.cssText = 'font:inherit;border:1px solid #225c4e;border-radius:7px;background:#225c4e;color:#fff;padding:8px 16px;cursor:pointer';
    button.addEventListener('click', function () { location.reload(); });
    note.appendChild(text); note.appendChild(button); note.appendChild(detail);
    (document.body || document.documentElement).appendChild(note);
  }, 6000);
})();
