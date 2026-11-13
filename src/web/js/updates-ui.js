// Check automatically; downloading and installing always require an explicit button press.
(() => {
  const button = document.getElementById('check-updates');
  if (!button) return;
  // Shown after a failed one-click update, so the person is never stuck.
  const MANUAL_UPDATE_HELP = ' To update by hand, open View releases, download the ZIP, extract it and copy its files over your CalendarViewer folder. Your data is kept.';
  const version = document.getElementById('app-version');
  const status = document.getElementById('update-status');
  const release = document.getElementById('update-release');
  const install = document.getElementById('install-update');
  const note = document.getElementById('update-install-note');
  const settings = document.getElementById('update-settings');
  const progress = document.getElementById('update-progress');
  const gate = document.getElementById('update-required');
  const gateText = document.getElementById('update-required-text');
  const gateInstall = document.getElementById('update-required-install');
  const gateProgress = document.getElementById('update-required-progress');
  const gateStatus = document.getElementById('update-required-status');
  const gateRelease = document.getElementById('update-required-release');
  let required = false;
  // The panel mirrors the normal install controls, so one code path does the work.
  function syncGate() {
    if (!gate || !required) return;
    gateInstall.disabled = install.disabled || installing;
    gateInstall.textContent = installing ? install.textContent : install.disabled ? 'Installation unavailable' : 'Download and install';
    gateInstall.ariaBusy = String(!!installing);
    gateProgress.hidden = progress.hidden;
    if (progress.value) gateProgress.value = progress.value; else gateProgress.removeAttribute('value');
    gateStatus.textContent = status.textContent + (install.disabled && !installing && note.textContent ? ' ' + note.textContent : '');
  }
  function setRequired(result) {
    if (!gate) return;
    required = result.required === true && result.status === 'available';
    if (!required) { if (gate.open) gate.close(); return; }
    gateText.textContent = 'Version ' + result.latestVersion + ' must be installed before you can keep using Calendar Viewer. Your calendars, settings and notes are kept.';
    gateRelease.href = result.releaseUrl; gateRelease.hidden = false;
    if (!gate.open) gate.showModal();
    syncGate();
  }
  if (gate) {
    // A mandatory update cannot be dismissed: Escape and a stray close both reopen it.
    gate.addEventListener('cancel', event => event.preventDefault());
    gate.addEventListener('close', () => { if (required) gate.showModal(); });
    gateInstall.onclick = () => install.click();
    if (typeof MutationObserver === 'function') {
      const watch = new MutationObserver(syncGate);
      watch.observe(status, { childList: true, characterData: true, subtree: true });
      watch.observe(install, { attributes: true, childList: true, characterData: true, subtree: true });
      watch.observe(progress, { attributes: true });
    }
  }
  let checking = false, installing = false, latest = null, reconnects = 0, startError = '', retryAfterCheck = false;
  const request = (route, options = {}, timeout = 15000) => apiAction(route, { ...options, signal: AbortSignal.timeout(timeout) });
  function busy(active, label = 'Download and install') {
    install.ariaBusy = String(active);
    install.textContent = label;
    if (progress) {
      progress.hidden = !active;
      progress.removeAttribute('value');
    }
  }
  function failed(message) {
    installing = false; button.disabled = false;
    busy(false);
    install.disabled = !latest?.download || !latest?.installation?.supported;
    status.hidden = false; status.textContent = message + MANUAL_UPDATE_HELP;
  }
  apiJson('/api/version').then(data => { version.textContent = 'Version ' + data.version; }, () => { version.textContent = 'Version unavailable'; });
  function installState(state) {
    if (!state) return false;
    if (['downloading', 'preparing', 'restarting'].includes(state.phase)) {
      installing = true; button.disabled = true; install.disabled = true; install.hidden = false;
      settings.open = true; status.hidden = false;
      busy(true, state.phase === 'downloading' ? 'Downloading…' : state.phase === 'preparing' ? 'Preparing update…' : 'Restarting…');
      if (progress && state.phase === 'downloading' && state.total > 0) progress.value = Math.min(100, Math.floor(100 * (state.received || 0) / state.total));
      const percent = state.total > 0 ? ' ' + Math.min(100, Math.floor(100 * (state.received || 0) / state.total)) + '%' : '';
      status.textContent = state.phase === 'downloading' ? 'Downloading update…' + percent : state.phase === 'preparing' ? 'Verifying and preparing update…' : 'Installing update and restarting Calendar Viewer…';
      return true;
    }
    if (state.phase === 'failed') {
      failed('Update failed: ' + state.message);
      install.disabled = !latest?.download || state.supported === false || !latest?.installation?.supported;
    }
    return false;
  }
  async function pollInstallation() {
    try {
      const state = await request('/api/updates/status', { method: 'GET' }, 5000);
      if (state.phase === 'complete' && state.version === latest?.latestVersion) {
        const current = await apiJson('/api/version', { signal: AbortSignal.timeout(5000) });
        if (current.version === state.version) { location.reload(); return; }
        throw new Error('Waiting for the updated server.');
      }
      if (state.phase === 'failed') { installState(state); return; }
      if (!['downloading', 'preparing', 'restarting'].includes(state.phase)) {
        failed(startError ? 'Could not start update: ' + startError : 'Update did not start. Check for updates, then try again.');
        return;
      }
      installState(state);
      reconnects = 0;
    } catch {
      status.textContent = 'Waiting for Calendar Viewer to restart…';
      if (++reconnects >= 180) {
        failed('Could not reconnect. Check for updates to reconnect, or reopen Calendar Viewer with run.bat.');
        install.disabled = true;
        return;
      }
    }
    setTimeout(pollInstallation, 1000);
  }
  async function check() {
    if (checking || installing) return;
    checking = true; button.disabled = true;
    button.ariaBusy = 'true'; button.textContent = 'Checking…';
    install.disabled = true;
    status.hidden = false; status.textContent = 'Checking the release site…';
    release.hidden = true; release.removeAttribute('href');
    try {
      const result = await request('/api/updates/check', { method: 'POST' });
      latest = result;
      setRequired(result);
      version.textContent = 'Version ' + result.currentVersion;
      install.hidden = result.status !== 'available';
      install.disabled = !result.download || !result.installation?.supported;
      note.hidden = result.status !== 'available';
      note.textContent = !result.download ? 'This release has no verifiable checksum' : result.installation?.unavailableReason || 'Downloads and installs this release, then restarts Calendar Viewer. Calendars, settings and built-in models are kept.';
      install.title = install.disabled ? note.textContent : '';
      install.textContent = install.disabled ? 'Installation unavailable' : 'Download and install';
      if (result.status === 'available') {
        settings.open = true;
        status.textContent = 'Version ' + result.latestVersion + ' is available.';
        release.href = result.releaseUrl; release.hidden = false;
      } else if (result.status === 'up-to-date') status.textContent = 'Calendar Viewer is up to date.';
      else if (result.status === 'auth-required') {
        settings.open = true; status.textContent = 'The release site asks for sign-in, so updates cannot be checked here. Open the release page to download the latest version.';
      }
      else if (result.status === 'no-release') status.textContent = 'No stable release is published yet.';
      else throw new Error('Unexpected update response. Try again later.');
      if (installState(result.installation)) { reconnects = 0; setTimeout(pollInstallation, 1000); }
    } catch (error) {
      status.textContent = 'Could not check for updates: ' + error.message;
    }
    finally {
      checking = false; button.disabled = installing;
      button.ariaBusy = 'false'; button.textContent = 'Check for updates';
      if (retryAfterCheck && !installing) { retryAfterCheck = false; void check(); }
    }
  }
  button.onclick = check;
  install.onclick = async () => {
    if (installing || install.disabled || !latest) return;
    installing = true; install.disabled = true; button.disabled = true; reconnects = 0;
    startError = '';
    busy(true, 'Starting download…'); settings.open = true;
    status.hidden = false; status.textContent = 'Starting update download…';
    try {
      const state = await request('/api/updates/install', { method: 'POST', body: JSON.stringify({ version: latest.latestVersion }) }, 30000);
      if (installState(state)) setTimeout(pollInstallation, 1000);
      else if (state.phase !== 'failed') failed('Update did not start. Check for updates, then try again.');
    } catch (error) {
      // A lost response does not mean the server rejected the update. Reconcile before allowing another install.
      startError = error.message;
      status.textContent = 'Confirming update status: ' + error.message;
      setTimeout(pollInstallation, 1000);
    }
  };
  void check();
  setInterval(check, 6 * 60 * 60 * 1000);
})();
