const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('settings modal opens with native focus and restores its launcher on close', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', checked: false, hidden: false, disabled: false, listeners: {},
      addEventListener(name, listener) { this.listeners[name] = listener; },
      showModal() { this.open = true; },
      close() { this.open = false; this.listeners.close?.(); },
      focus() { this.focused = true; }
    });
    return elements.get(id);
  };
  const config = { enabled: true, fallback: false, provider: 'anthropic', models: {}, tokenSets: { anthropic: true }, locked: { tokens: {} } };
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: element }, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/builtin') ? { supported: true, installed: true } : config };
    }
  });
  vm.runInContext(fs.readFileSync('src/web/js/assistant-settings.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  element('assistant-settings-open').onclick();
  assert.equal(element('assistant-settings-dialog').open, true);
  assert.equal(element('assistant-enabled').focused, true);
  assert.equal(element('assistant-token').value, '', 'saved secrets stay write-only');
  assert.equal(element('assistant-token-clear').hidden, false);
  element('assistant-provider').value = 'openai';
  element('assistant-provider').onchange();
  assert.equal(element('assistant-model-row').hidden, false);
  assert.equal(element('assistant-token-row').hidden, false);
  element('assistant-provider').value = 'llamacpp';
  element('assistant-provider').onchange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('assistant-token-row').hidden, true);
  assert.equal(element('assistant-fallback-row').hidden, true);
  assert.equal(element('assistant-local-row').hidden, false);
  assert.equal(element('assistant-local-pull').hidden, true);
  element('assistant-provider').value = 'anthropic';
  element('assistant-provider').onchange();
  element('assistant-settings-form').onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const saved = JSON.parse(requests.find(request => request.options?.method === 'PUT').options.body);
  assert.equal(saved.provider, 'anthropic');
  assert.equal(Object.hasOwn(saved, 'token'), false, 'blank token preserves the saved secret');
  element('assistant-settings-close').onclick();
  assert.equal(element('assistant-settings-dialog').open, false);
  assert.equal(element('assistant-settings-open').focused, true);
});
