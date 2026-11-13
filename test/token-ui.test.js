const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('MCP one-time token clears on details/sidebar/dialog close, including an in-flight generation', async () => {
  const ids = ['mcp-settings', 'mcp-token-state', 'mcp-token-generate', 'mcp-token-revoke', 'mcp-token-once', 'mcp-token-value', 'mcp-token-copy', 'sidebar'];
  const elements = Object.fromEntries(ids.map(id => [id, { value: '', hidden: true, open: true, addEventListener(name, fn) { this[name] = fn; } }]));
  const listeners = {}; let observer, configured = false, resolveGenerate;
  const context = vm.createContext({ AbortSignal, Date, navigator: { clipboard: { writeText: async () => {} } },
    document: { getElementById: id => elements[id], addEventListener: (name, fn) => { listeners[name] = fn; } },
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
    apiAction: async (route, options) => {
      if (route.endsWith('/status')) return { configured, createdAt: configured ? '2026-11-12T00:00:00Z' : null };
      if (options.method === 'DELETE') { configured = false; return { configured: false }; }
      configured = true;
      return new Promise(resolve => { resolveGenerate = () => resolve({ token: 'synthetic-one-time-token' }); });
    }
  });
  vm.runInContext(fs.readFileSync('src/web/js/mcp-token-ui.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['mcp-token-state'].textContent, 'Off: no token');
  let pending = elements['mcp-token-generate'].onclick();
  elements['mcp-settings'].open = false; elements['mcp-settings'].toggle(); resolveGenerate(); await pending;
  assert.equal(elements['mcp-token-value'].value, ''); assert.equal(elements['mcp-token-once'].hidden, true);
  elements['mcp-settings'].open = true;
  for (const close of [() => { elements['mcp-settings'].open = false; elements['mcp-settings'].toggle(); }, () => { elements.sidebar.inert = true; observer(); }, listeners.close, listeners.pagehide]) {
    elements['mcp-settings'].open = true; elements.sidebar.inert = false;
    pending = elements['mcp-token-generate'].onclick(); resolveGenerate(); await pending;
    assert.equal(elements['mcp-token-value'].value, 'synthetic-one-time-token');
    close(); assert.equal(elements['mcp-token-value'].value, ''); assert.equal(elements['mcp-token-once'].hidden, true);
  }
  await elements['mcp-token-revoke'].onclick(); assert.equal(elements['mcp-token-state'].textContent, 'Off: no token');
});
