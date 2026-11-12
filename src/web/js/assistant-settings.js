// Modal settings for the AI provider. Keys and tokens stay write-only.
// A 404 means the page is newer than the running server process.
const assistantStaleServer = response => response.status === 404 ? 'The calendar server is older than this page. Restart it with run.bat restart.' : '';
function initAssistantSettings() {
  const form = document.getElementById('assistant-settings-form');
  if (!form) return;
  const enabled = document.getElementById('assistant-enabled');
  const provider = document.getElementById('assistant-provider');
  const model = document.getElementById('assistant-model');
  const modelRow = document.getElementById('assistant-model-row');
  const hostedNote = document.getElementById('assistant-hosted-note');
  const builtinNote = document.getElementById('assistant-builtin-note');
  const tokenRow = document.getElementById('assistant-token-row');
  const fallback = document.getElementById('assistant-fallback');
  const fallbackRow = document.getElementById('assistant-fallback-row');
  const localRow = document.getElementById('assistant-local-row');
  const localState = document.getElementById('assistant-local-state');
  const localPull = document.getElementById('assistant-local-pull');
  const token = document.getElementById('assistant-token');
  const clear = document.getElementById('assistant-token-clear');
  const state = document.getElementById('assistant-settings-state');
  const testButton = document.getElementById('assistant-test');
  const settingsDialog = document.getElementById('assistant-settings-dialog');
  const settingsOpen = document.getElementById('assistant-settings-open');
  settingsOpen.onclick = () => {
    settingsDialog.showModal();
    (enabled.disabled ? provider : enabled).focus();
    if (current) checkLocal();
  };
  document.getElementById('assistant-settings-close').onclick = () => settingsDialog.close();
  settingsDialog.addEventListener('close', () => {
    clearTimeout(pollTimer);
    settingsOpen.focus();
  });
  const launcher = document.getElementById('assistant-open');
  const headers = { 'X-Calendar-Action': '1', 'Content-Type': 'application/json' };
  let current = null;
  // Fields follow the selected provider; saved keys are never shown, only whether one exists.
  function render() {
    const name = provider.value, builtin = name === 'llamacpp', keyed = !builtin;
    modelRow.hidden = builtin; hostedNote.hidden = !keyed; builtinNote.hidden = !builtin;
    tokenRow.hidden = builtin; fallbackRow.hidden = builtin;
    checkLocal();
    const set = !!current.tokenSets[name], locked = !!current.locked.tokens[name];
    token.disabled = locked; token.value = '';
    token.placeholder = set ? 'Saved. Leave blank to keep it.' : '';
    clear.hidden = !set || locked;
    const tokenState = document.getElementById('assistant-token-state');
    tokenState.textContent = locked ? 'Key managed by the server environment.' : set ? 'Key saved. Leave blank to keep it.' : 'No key saved.';
    if (keyed) model.value = current.models[name] || '';
  }
  function show(data) {
    current = data;
    enabled.checked = data.enabled; fallback.checked = !!data.fallback;
    provider.value = data.provider;
    enabled.disabled = data.locked.enabled; provider.disabled = data.locked.provider;
    render();
    if (launcher) launcher.hidden = !data.enabled;
    const locked = Object.keys(data.locked).filter(key => key !== 'tokens' && data.locked[key]);
    return locked.length ? `Set by the server environment: ${locked.join(', ')}.` : '';
  }
  provider.onchange = () => { if (current) render(); };
  fallback.onchange = () => checkLocal();
  // The built-in model is needed when it is the chosen provider or the backup.
  const engineInUse = () => provider.value === 'llamacpp' || fallback.checked;
  // The panel shows whether the engine and the weights are present, and offers the download.
  let pollTimer = null;
  async function checkLocal() {
    clearTimeout(pollTimer);
    localRow.hidden = !engineInUse();
    if (localRow.hidden) return;
    localPull.textContent = 'Download engine and model (about 1.6 GB)';
    try {
      const response = await fetch('/api/assistant/builtin', { headers });
      if (!response.ok) throw new Error(assistantStaleServer(response) || 'unavailable');
      const info = await response.json();
      localPull.disabled = !!info.pulling || info.installed || !info.supported;
      localPull.hidden = info.installed;
      localState.textContent = info.pulling ? `Downloading… ${info.pulling.percent}% (${info.pulling.status})` :
        info.error ? 'Download failed: ' + info.error :
        !info.supported ? 'This system has no ready-made engine in the app. Choose another provider.' :
        info.installed ? 'Built-in model ready.' : 'Built-in model not downloaded yet.';
      if (info.pulling && settingsDialog.open) pollTimer = setTimeout(checkLocal, 2000);
    } catch (e) { localState.textContent = 'Built-in model status unavailable: ' + e.message; }
  }
  localPull.onclick = async () => {
    localPull.disabled = true; localState.textContent = 'Starting download…';
    try { const response = await fetch('/api/assistant/builtin/pull', { method: 'POST', headers }); if (!response.ok) throw new Error('Could not start.'); } catch (e) { localState.textContent = 'Not started: ' + e.message; return; }
    checkLocal();
  };
  // The request body follows the selected provider.
  function fields() {
    const builtin = provider.value === 'llamacpp';
    // The backup is the built-in model ('llamacpp'), or an empty string for none.
    const body = { enabled: enabled.checked, provider: provider.value, fallback: fallback.checked && !builtin ? 'llamacpp' : '' };
    if (!builtin) body.model = model.value;
    if (token.value) body.token = token.value;
    return body;
  }
  async function send(body, done) {
    state.textContent = 'Saving…';
    try {
      const response = await fetch('/api/assistant/config', { method: 'PUT', headers, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(assistantStaleServer(response) || (await response.text()) || 'Could not save.');
      state.textContent = done + ' ' + show(await response.json());
    } catch (e) { state.textContent = 'Not saved: ' + e.message; }
  }
  form.onsubmit = event => {
    event.preventDefault();
    send(fields(), 'Saved.');
  };
  const reasons = { 'not-ready': 'The model is not ready. For the built-in model press Download first.', 'token-rejected': 'Reached the service, but it rejected the access token or API key.', 'no-key': 'Enter an API key first.', 'no-tools': 'Reached the service, but it does not accept tool calls. Update and redeploy it (CNV_MiniCPM_Model with tool support).', 'rate-limited': 'Reached the service, but it is rate limiting this token.', 'service-error': 'Reached the service, but it returned an error.', unreachable: 'Could not reach the service. Check the address, port, firewall and internet connection.' };
  testButton.onclick = async () => {
    testButton.disabled = true; state.textContent = 'Testing…';
    try {
      const response = await fetch('/api/assistant/test', { method: 'POST', headers, body: JSON.stringify(fields()) });
      if (!response.ok) throw new Error(assistantStaleServer(response) || (await response.text()) || 'Could not test.');
      const result = await response.json();
      state.textContent = result.ok ? `Connected${result.model ? ' · ' + result.model : ''}. Press Save to use it.` : (reasons[result.reason] || 'Connection failed.') + (result.code ? ` (${result.code})` : '') + (result.status ? ` (HTTP ${result.status})` : '') + (result.detail ? ': ' + result.detail : '');
    } catch (e) { state.textContent = 'Not tested: ' + e.message; }
    finally { testButton.disabled = false; }
  };
  clear.onclick = () => send({ provider: provider.value, token: '' }, 'Removed.');
  fetch('/api/assistant/config', { headers }).then(r => r.ok ? r.json() : Promise.reject()).then(data => { state.textContent = show(data); }).catch(() => { state.textContent = 'Settings unavailable: calendar server unreachable.'; });
}
initAssistantSettings();
