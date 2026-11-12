const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssistantSettingsStore } = require('../src/server/assistant-settings-store');
const { createCredentialProtector } = require('../src/server/credential-protection');

// An injectable codec exercises persistence boundaries; actual DPAPI has its own Windows-only roundtrip below.
function fixtureProtector() {
  return {
    supported: true,
    async protect(value, provider) { return Buffer.from('fixture:' + provider + ':' + value).toString('base64'); },
    async unprotect(value, provider) {
      const decoded = Buffer.from(value, 'base64').toString('utf8'), prefix = 'fixture:' + provider + ':';
      if (!decoded.startsWith(prefix)) throw new Error('wrong provider or damaged data');
      return decoded.slice(prefix.length);
    }
  };
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'calendar-credentials-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'settings.json') };
}

test('legacy keys migrate to provider-bound envelopes and reload without changing other settings', async t => {
  const { file } = await fixture(t), protector = fixtureProtector();
  const original = { enabled: true, provider: 'openai', cpuThreads: 0, models: { openai: 'custom-model' }, keys: { openai: 'fixture-value' } };
  await fs.writeFile(file, JSON.stringify(original));
  const first = createAssistantSettingsStore({ file, protector });
  assert.deepEqual(await first.load(), original);
  const text = await fs.readFile(file, 'utf8'), disk = JSON.parse(text);
  assert.equal(disk.keys.openai.type, 'windows-dpapi');
  assert.equal(disk.keys.openai.version, 1); assert.doesNotMatch(text, /fixture-value/);
  assert.equal(first.status().migrationPending, false);
  const second = createAssistantSettingsStore({ file, protector });
  assert.deepEqual(await second.load(), original);
  assert.equal(await fs.readFile(file, 'utf8'), text);
});

test('encryption failure preserves original bytes and does not write a new plaintext key', async t => {
  const { file } = await fixture(t), protector = fixtureProtector();
  const store = createAssistantSettingsStore({ file, protector }); await store.load();
  await store.save({ provider: 'openai', keys: { openai: 'first-fixture' } });
  const before = await fs.readFile(file, 'utf8');
  protector.protect = async () => { throw new Error('private input must never be displayed'); };
  await assert.rejects(store.save({ provider: 'openai', keys: { openai: 'replacement-fixture' } }));
  assert.equal(await fs.readFile(file, 'utf8'), before);
});

test('unreadable ciphertext is preserved until explicit replacement or removal', async t => {
  const { file } = await fixture(t), protector = fixtureProtector();
  const locked = { type: 'windows-dpapi', version: 1, ciphertext: 'AAAA' };
  await fs.writeFile(file, JSON.stringify({ provider: 'openai', keys: { openai: locked } }));
  const store = createAssistantSettingsStore({ file, protector }); const loaded = await store.load();
  assert.deepEqual(loaded.keys.openai, locked);
  assert.match(store.status().errors.openai, /cannot be unlocked/);
  await store.save({ ...loaded, cpuThreads: 0 });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).keys.openai, locked);
  await store.save({ ...loaded, keys: { openai: 'replacement-fixture' } });
  assert.deepEqual(store.status().errors, {});
  await store.save({ provider: 'openai', keys: {} });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).keys, {});
});

test('non-Windows migration fails closed and multiple unavailable keys can be removed atomically', async t => {
  const { file } = await fixture(t);
  const original = JSON.stringify({ enabled: true, provider: 'llamacpp', keys: { openai: 'fixture-one', gemini: 'fixture-two' } });
  await fs.writeFile(file, original);
  const store = createAssistantSettingsStore({ file, protector: createCredentialProtector({ platform: 'linux' }) });
  const loaded = await store.load();
  assert.equal(typeof loaded.keys.openai, 'object'); assert.equal(typeof loaded.keys.gemini, 'object');
  assert.equal(store.status().migrationPending, true);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  await assert.rejects(store.save({ ...loaded, keys: { ...loaded.keys, openai: 'new-fixture' } }));
  assert.equal(await fs.readFile(file, 'utf8'), original);
  await store.save({ ...loaded, keys: {} });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).keys, {});
});

test('corrupt settings are never overwritten by a later save', async t => {
  const { file } = await fixture(t); await fs.writeFile(file, '{broken');
  const store = createAssistantSettingsStore({ file, protector: fixtureProtector() });
  await assert.rejects(store.load(), /Original file was not changed/);
  await assert.rejects(store.save({ keys: {} }), /refusing to overwrite/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('Windows DPAPI roundtrip uses provider-bound protection', { skip: process.platform !== 'win32' }, async () => {
  const protector = createCredentialProtector();
  const encrypted = await protector.protect('dpapi-fixture-value', 'openai');
  assert.notEqual(encrypted, 'dpapi-fixture-value'); assert.doesNotMatch(encrypted, /dpapi-fixture-value/);
  assert.equal(await protector.unprotect(encrypted, 'openai'), 'dpapi-fixture-value');
  await assert.rejects(protector.unprotect(encrypted, 'anthropic'));
});
