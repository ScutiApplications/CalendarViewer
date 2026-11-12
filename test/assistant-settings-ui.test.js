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
  const config = { enabled: true, fallback: false, provider: 'anthropic', cpuThreads: 6, maxCpuThreads: 12, models: {}, tokenSets: { anthropic: true }, locked: { tokens: {} } };
  const requests = [];
  let builtinState = { supported: true, installed: true };
  const context = vm.createContext({
    document: { getElementById: element }, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/builtin') ? builtinState : config };
    }
  });
  vm.runInContext(fs.readFileSync('src/web/js/assistant-settings.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  element('assistant-settings-open').onclick();
  assert.equal(element('assistant-settings-dialog').open, true);
  assert.equal(element('assistant-enabled').focused, true);
  assert.equal(element('assistant-cpu-threads').value, '6');
  assert.equal(element('assistant-cpu-threads').max, '12');
  assert.match(element('assistant-cpu-threads-help').textContent, /12/);
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
  builtinState = { supported: true, installed: true, accelerationReady: false, backend: 'cpu' };
  element('assistant-provider').onchange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('assistant-local-pull').hidden, false, 'an existing CPU install must offer its GPU runtime upgrade');
  assert.equal(element('assistant-local-pull').disabled, false);
  assert.match(element('assistant-local-pull').textContent, /GPU/);
  builtinState = { supported: true, installed: true, accelerationReady: true, backend: 'vulkan', device: 'NVIDIA RTX 4050' };
  element('assistant-provider').onchange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('assistant-local-pull').hidden, true);
  assert.match(element('assistant-local-state').textContent, /NVIDIA RTX 4050/);
  element('assistant-cpu-threads').value = '4';
  element('assistant-settings-form').onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const cpuSaved = JSON.parse(requests.find(request => request.options?.method === 'PUT').options.body);
  assert.equal(cpuSaved.provider, 'llamacpp');
  assert.equal(cpuSaved.cpuThreads, 4);
  element('assistant-provider').value = 'anthropic';
  element('assistant-provider').onchange();
  element('assistant-cpu-threads').value = '257';
  assert.equal(element('assistant-cpu-threads').disabled, true);
  element('assistant-settings-form').onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const saved = JSON.parse(requests.filter(request => request.options?.method === 'PUT').at(-1).options.body);
  assert.equal(saved.provider, 'anthropic');
  assert.equal(Object.hasOwn(saved, 'cpuThreads'), false, 'hidden invalid CPU input must not block hosted settings');
  assert.equal(Object.hasOwn(saved, 'token'), false, 'blank token preserves the saved secret');
  element('assistant-settings-close').onclick();
  assert.equal(element('assistant-settings-dialog').open, false);
  assert.equal(element('assistant-settings-open').focused, true);
});
