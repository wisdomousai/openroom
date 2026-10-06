import './style.css';
const query = new URLSearchParams(location.search);
const code = query.get('code'), state = query.get('state');
try { history.replaceState?.(null, '', location.pathname); } catch { /* Referrer policy also prevents query disclosure. */ }
const status = document.getElementById('status')!;
if (!code || !/^orcode_[A-Za-z0-9_-]{43}$/.test(code) || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
  status.textContent = 'Sign-in could not be completed. Close this window and try again in PowerPoint.';
} else if (typeof Office === 'undefined') {
  status.textContent = 'PowerPoint could not load. Close this window and try signing in again.';
} else {
  void Office.onReady().then(() => {
    if (!Office.context.requirements.isSetSupported('DialogOrigin', '1.1')) throw new Error('Unsupported Office version');
    Office.context.ui.messageParent(JSON.stringify({ type: 'openroom.oauth', code, state }), { targetOrigin: location.origin });
    status.textContent = 'You can return to PowerPoint.';
  }).catch(() => { status.textContent = 'Could not return to PowerPoint. Close this window and try signing in again.'; });
}
