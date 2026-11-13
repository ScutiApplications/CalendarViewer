const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('automatic checks never install; one explicit click starts download and installation', async () => {
  const elements = Object.fromEntries(['check-updates', 'app-version', 'update-status', 'update-release', 'install-update', 'update-install-note', 'update-settings', 'update-progress'].map(id => [id, { hidden: true, textContent: '', removeAttribute(name) { delete this[name]; } }]));
  let checks = 0, installs = 0, poll, interval, reloaded = false;
  let result = { status: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0', releaseUrl: 'https://github.com/ScutiApplications/CalendarViewer/releases/tag/v1.2.0', download: {}, installation: { phase: 'idle', supported: true } };
  let installation = { phase: 'downloading', version: '1.2.0' };
  const context = vm.createContext({ AbortSignal, document: { getElementById: id => elements[id] },
    location: { reload() { reloaded = true; } },
    setTimeout(fn) { poll = fn; }, setInterval(fn, ms) { interval = fn; assert.equal(ms, 6 * 60 * 60 * 1000); },
    apiJson: async () => ({ version: installation.phase === 'complete' ? '1.2.0' : '1.1.0' }),
    apiAction: async (route, options) => {
      if (route.endsWith('/install')) { installs++; assert.equal(options.method, 'POST'); assert.equal(JSON.parse(options.body).version, '1.2.0'); return installation; }
      if (route.endsWith('/status')) return installation;
      checks++; assert.equal(options.method, 'POST'); if (result instanceof Error) throw result; return result;
    }
  });
  vm.runInContext(fs.readFileSync('src/web/js/updates-ui.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checks, 1); assert.equal(installs, 0); assert.match(elements['app-version'].textContent, /1.1.0/);
  assert.equal(elements['install-update'].hidden, false); assert.equal(elements['install-update'].disabled, false);
  await Promise.all([elements['check-updates'].onclick(), elements['check-updates'].onclick()]);
  assert.equal(checks, 2); assert.equal(elements['update-release'].hidden, false);
  assert.equal(elements['update-release'].href, result.releaseUrl); assert.match(elements['update-status'].textContent, /1.2.0/);
  await interval(); assert.equal(checks, 3); assert.equal(installs, 0);
  await Promise.all([elements['install-update'].onclick(), elements['install-update'].onclick()]);
  assert.equal(installs, 1); assert.equal(elements['install-update'].disabled, true);
  for (let attempt = 0; attempt < 181; attempt++) await poll();
  assert.match(elements['update-status'].textContent, /Downloading/);
  installation = { phase: 'complete', version: '1.2.0' }; await poll();
  assert.equal(reloaded, true);
});

test('automatic checks report unavailable installs, offline checks and failed installation', async () => {
  const elements = Object.fromEntries(['check-updates', 'app-version', 'update-status', 'update-release', 'install-update', 'update-install-note', 'update-settings', 'update-progress'].map(id => [id, { hidden: true, textContent: '', removeAttribute(name) { delete this[name]; } }]));
  let result = { status: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0', download: {}, installation: { phase: 'idle', supported: false, unavailableReason: 'Git checkout' } };
  const context = vm.createContext({ AbortSignal, document: { getElementById: id => elements[id] }, setInterval() {}, setTimeout() {}, apiJson: async () => ({ version: '1.1.0' }), apiAction: async () => { if (result instanceof Error) throw result; return result; } });
  vm.runInContext(fs.readFileSync('src/web/js/updates-ui.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['install-update'].disabled, true); assert.match(elements['update-install-note'].textContent, /Git checkout/);
  result = { status: 'up-to-date', currentVersion: '1.1.0' }; await elements['check-updates'].onclick();
  assert.match(elements['update-status'].textContent, /up to date/i); assert.equal(elements['update-release'].hidden, true);
  result = new Error('Offline'); await elements['check-updates'].onclick();
  assert.match(elements['update-status'].textContent, /Offline/); assert.equal(elements['check-updates'].disabled, false);
  result = { status: 'no-release', currentVersion: '1.1.0' }; await elements['check-updates'].onclick();
  assert.match(elements['update-status'].textContent, /No stable release/i);
  result = { status: 'auth-required', currentVersion: '1.1.0' }; await elements['check-updates'].onclick();
  assert.equal(elements['update-status'].textContent, 'The release site asks for sign-in, so updates cannot be checked here. Open the release page to download the latest version.');
  assert.equal(elements['install-update'].hidden, true);
  result = { status: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0', download: null, installation: { supported: true } }; await elements['check-updates'].onclick();
  assert.equal(elements['update-install-note'].textContent, 'This release has no verifiable checksum');
  result = { status: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0', download: {}, installation: { phase: 'failed', supported: true, message: 'Checksum mismatch' } };
  await elements['check-updates'].onclick();
  assert.match(elements['update-status'].textContent, /Checksum mismatch/);
  assert.equal(elements['install-update'].disabled, false);
});
