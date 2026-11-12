// Bundled notes work offline. Remember presentation per browser, not per server installation.
(() => {
  const button = document.getElementById('show-release-notes');
  const dialog = document.getElementById('release-notes-dialog');
  const content = document.getElementById('release-notes-content');
  const state = document.getElementById('release-notes-state');
  const key = 'ics-calendar-viewer.releaseNotes.v1';
  let version = '', pending = true, previousFocus = null, loading = null;

  function remembered() { try { return localStorage.getItem(key); } catch { return null; } }
  function remember() {
    try {
      const old = remembered();
      if (CalendarReleases.compare(old, version) !== 1) localStorage.setItem(key, version);
    } catch { /* Manual history remains available with storage disabled. */ }
  }
  function show(automatic) {
    if (dialog.open || document.querySelector('dialog[open]') || document.hidden) return false;
    const previous = remembered();
    if (automatic && CalendarReleases.compare(version, previous) !== null && CalendarReleases.compare(version, previous) <= 0) { pending = false; return false; }
    const entries = automatic ? CalendarReleases.since(previous, version) : CalendarReleases.through(version);
    content.replaceChildren();
    if (!entries.some(item => item.version === version)) entries.unshift({ version, changes: ['Bundled notes for this version are not available. Use the published release history for details.'] });
    for (const entry of entries) {
      const section = create('section', 'release-entry');
      section.append(create('h3', '', 'Version ' + entry.version));
      const list = create('ul');
      for (const change of entry.changes) list.append(create('li', '', change));
      section.append(list); content.append(section);
    }
    document.getElementById('release-notes-version').textContent = 'Installed version ' + version;
    previousFocus = document.activeElement;
    dialog.showModal();
    document.getElementById('release-notes-close').focus();
    pending = false; remember();
    return true;
  }
  async function maybeShow() {
    if (!pending || !version) return;
    // If persistence cannot be used, skip automatic interruption instead of repeating it on every load.
    try {
      const probe = key + '.probe';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
    } catch { pending = false; return; }
    const attempt = () => show(true);
    if (navigator.locks?.request) await navigator.locks.request('calendar-release-notes', { ifAvailable: true }, lock => lock ? attempt() : false);
    else attempt();
  }
  async function load() {
    if (version) return;
    if (loading) return loading;
    loading = apiJson('/api/version', { signal: AbortSignal.timeout(5000) }).then(data => {
      if (CalendarReleases.compare(data.version, '0.0.0') === null) throw new Error('Installed version is unavailable.');
      version = data.version; state.textContent = '';
    }).finally(() => { loading = null; });
    return loading;
  }
  button.onclick = async () => {
    button.disabled = true;
    try { await load(); show(false); }
    catch (error) { state.textContent = 'Could not load release history: ' + error.message + ' Try again.'; }
    finally { button.disabled = false; }
  };
  document.getElementById('release-notes-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (previousFocus?.isConnected) previousFocus.focus(); });
  document.addEventListener('close', () => { if (pending) queueMicrotask(() => void maybeShow()); }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void maybeShow(); });
  load().then(maybeShow).catch(() => { state.textContent = 'Release history unavailable. Press What’s new to retry.'; });
})();
