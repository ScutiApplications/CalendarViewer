// Check automatically; downloading and installing always require an explicit button press.
(() => {
  const button = document.getElementById('check-updates');
  if (!button) return;
  const version = document.getElementById('app-version');
  const status = document.getElementById('update-status');
  const release = document.getElementById('update-release');
  const install = document.getElementById('install-update');
  const note = document.getElementById('update-install-note');
  const settings = document.getElementById('update-settings');
  let checking = false, installing = false, latest = null, reconnects = 0;
  apiJson('/api/version').then(data => { version.textContent = 'Version ' + data.version; }, () => { version.textContent = 'Version unavailable'; });
  function installState(state) {
    if (!state) return false;
    if (['downloading', 'preparing', 'restarting'].includes(state.phase)) {
      installing = true; button.disabled = true; install.disabled = true; install.hidden = false;
      settings.open = true; status.hidden = false;
      const percent = state.total > 0 ? ' ' + Math.min(100, Math.floor(100 * (state.received || 0) / state.total)) + '%' : '';
      status.textContent = state.phase === 'downloading' ? 'Downloading update…' + percent : state.phase === 'preparing' ? 'Verifying and preparing update…' : 'Installing update and restarting Calendar Viewer…';
      return true;
    }
    if (state.phase === 'failed') {
      installing = false; button.disabled = false;
      status.hidden = false; status.textContent = 'Update failed: ' + state.message;
      install.disabled = !latest?.download || !state.supported;
    }
    return false;
  }
  async function pollInstallation() {
    try {
      const state = await apiAction('/api/updates/status', { method: 'GET' });
      if (state.phase === 'complete') {
        const current = await apiJson('/api/version');
        if (current.version === state.version) { location.reload(); return; }
      }
      if (state.phase === 'failed') { installState(state); return; }
      installState(state);
      reconnects = 0;
    } catch {
      status.textContent = 'Waiting for Calendar Viewer to restart…';
      if (++reconnects >= 180) {
        status.textContent = 'Update is taking longer than expected. Reopen Calendar Viewer with run.bat to check its status.';
        return;
      }
    }
    setTimeout(pollInstallation, 1000);
  }
  async function check() {
    if (checking || installing) return;
    checking = true; button.disabled = true;
    status.hidden = false; status.textContent = 'Checking GitHub releases…';
    release.hidden = true; release.removeAttribute('href');
    try {
      const result = await apiAction('/api/updates/check', { method: 'POST' });
      latest = result;
      version.textContent = 'Version ' + result.currentVersion;
      install.hidden = result.status !== 'available';
      install.disabled = !result.download || !result.installation?.supported;
      note.hidden = result.status !== 'available';
      note.textContent = result.installation?.unavailableReason || (!result.download ? 'Release has no verified installation ZIP yet.' : 'Downloads and installs this release, then restarts Calendar Viewer. Calendars, settings and built-in models are kept.');
      if (result.status === 'available') {
        settings.open = true;
        status.textContent = 'Version ' + result.latestVersion + ' is available.';
        release.href = result.releaseUrl; release.hidden = false;
      } else if (result.status === 'up-to-date') status.textContent = 'Calendar Viewer is up to date.';
      else if (result.status === 'no-release') status.textContent = 'No stable release is published yet.';
      else throw new Error('Unexpected update response. Try again later.');
      if (installState(result.installation)) { reconnects = 0; setTimeout(pollInstallation, 1000); }
    } catch (error) { status.textContent = 'Could not check for updates: ' + error.message; }
    finally { checking = false; button.disabled = installing; }
  }
  button.onclick = check;
  install.onclick = async () => {
    if (installing || install.disabled || !latest) return;
    installing = true; install.disabled = true; button.disabled = true; reconnects = 0;
    status.hidden = false; status.textContent = 'Starting update download…';
    try {
      const state = await apiAction('/api/updates/install', { method: 'POST', body: JSON.stringify({ version: latest.latestVersion }) });
      installState(state); setTimeout(pollInstallation, 1000);
    } catch (error) {
      installing = false; button.disabled = false; install.disabled = false;
      status.textContent = 'Could not start update: ' + error.message;
    }
  };
  void check();
  setInterval(check, 6 * 60 * 60 * 1000);
})();
