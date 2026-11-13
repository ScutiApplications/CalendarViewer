// MCP credentials are shown once and cleared when access settings or the sidebar close.
(() => {
  const settings = document.getElementById('mcp-settings');
  const state = document.getElementById('mcp-token-state');
  const generate = document.getElementById('mcp-token-generate');
  const revoke = document.getElementById('mcp-token-revoke');
  const panel = document.getElementById('mcp-token-once');
  const input = document.getElementById('mcp-token-value');
  const copy = document.getElementById('mcp-token-copy');
  let pending = false, generation = 0;
  const request = (route, options = {}) => apiAction(route, { ...options, signal: AbortSignal.timeout(15000) });
  function clear() { generation++; input.value = ''; panel.hidden = true; copy.textContent = 'Copy'; }
  function show(status) {
    state.textContent = status.configured ? 'On since ' + new Date(status.createdAt).toLocaleString() : 'Off: no token';
    generate.textContent = status.configured ? 'Regenerate' : 'Generate token';
    revoke.disabled = !status.configured;
  }
  async function load() {
    try { show(await request('/api/mcp/token/status', { method: 'GET' })); }
    catch { state.textContent = 'MCP token status unavailable'; }
  }
  async function change(method) {
    if (pending) return;
    clear(); const started = generation;
    pending = true; generate.disabled = revoke.disabled = true;
    try {
      const result = await request('/api/mcp/token', { method });
      await load();
      if (method === 'POST' && started === generation && settings.open) {
        input.value = result.token; panel.hidden = false;
      }
    } catch (error) { await load(); state.textContent = error.message; }
    finally { pending = false; generate.disabled = false; }
  }
  generate.onclick = () => change('POST');
  revoke.onclick = () => change('DELETE');
  copy.onclick = async () => {
    if (!input.value) return;
    try { await navigator.clipboard.writeText(input.value); copy.textContent = 'Copied'; }
    catch { input.focus(); input.select(); copy.textContent = 'Select and copy'; }
  };
  settings.addEventListener('toggle', () => { if (!settings.open) clear(); });
  document.addEventListener('close', clear, true);
  window.addEventListener('pagehide', clear);
  new MutationObserver(() => {
    if (document.getElementById('sidebar').inert) clear();
  }).observe(document.getElementById('sidebar'), { attributes: true, attributeFilter: ['inert'] });
  void load();
})();
