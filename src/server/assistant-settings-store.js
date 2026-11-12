// Async, atomic settings persistence. Plaintext keys exist only in runtime objects; disk writes use DPAPI envelopes.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { savedSettings } = require('./assistant-config');
const { PROVIDERS, isHosted } = require('./providers');
const { createCredentialProtector } = require('./credential-protection');

const NAMES = Object.keys(PROVIDERS).filter(isHosted);
const MAX_FILE = 32768;
const validKey = value => typeof value === 'string' && value.length <= 512 && !/[\r\n]/.test(value);
const envelope = value => value?.type === 'windows-dpapi' && value.version === 1 && typeof value.ciphertext === 'string' &&
  value.ciphertext.length > 0 && value.ciphertext.length <= 8192 && /^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext);

async function readSettings(file) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 8192 })) {
      size += chunk.length;
      if (size > MAX_FILE) throw new Error('Settings file is too large.');
      chunks.push(chunk);
    }
  } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings.');
  if (value.keys !== undefined && (!value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys))) throw new Error('Invalid credentials.');
  return value;
}

function createAssistantSettingsStore({ file, protector = createCredentialProtector() }) {
  const cached = new Map();
  let queue = Promise.resolve(), loaded = false, loadError = '', migrationPending = false, errors = {};
  const serialized = work => {
    const operation = queue.then(work);
    queue = operation.catch(() => {});
    return operation;
  };
  const unavailable = provider => `${PROVIDERS[provider].label} key cannot be unlocked or encrypted. Re-enter it on Windows, or remove the saved key.`;
  async function encode(settings) {
    const result = { ...savedSettings(settings), keys: {} };
    for (const provider of NAMES) {
      const value = settings.keys?.[provider];
      if (value === undefined || value === '') continue;
      if (envelope(value)) { result.keys[provider] = { type: value.type, version: value.version, ciphertext: value.ciphertext }; continue; }
      if (!validKey(value)) throw new Error(unavailable(provider));
      let entry = cached.get(provider);
      if (!entry || entry.value !== value) {
        const ciphertext = await protector.protect(value, provider);
        const encrypted = { type: 'windows-dpapi', version: 1, ciphertext };
        if (!envelope(encrypted)) throw new Error(unavailable(provider));
        entry = { value, encrypted }; cached.set(provider, entry);
      }
      result.keys[provider] = entry.encrypted;
    }
    return result;
  }
  async function write(settings) {
    const protectedSettings = await encode(settings);
    const content = JSON.stringify(protectedSettings, null, 2);
    if (Buffer.byteLength(content) > MAX_FILE) throw new Error('Encrypted assistant settings exceed the size limit.');
    const staging = path.join(path.dirname(file), '.' + path.basename(file) + '.' + randomUUID() + '.tmp');
    try {
      await fs.promises.writeFile(staging, content, { mode: 0o600, flag: 'wx' });
      await fs.promises.rename(staging, file);
    } finally { await fs.promises.unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw new Error('Could not clean up encrypted settings staging file.'); }); }
  }
  function load() {
    return serialized(async () => {
      let raw;
      try { raw = await readSettings(file); }
      catch { loadError = 'Assistant settings could not be read. Original file was not changed.'; throw new Error(loadError); }
      const settings = { ...savedSettings(raw), keys: {} };
      let legacy = false;
      errors = {}; cached.clear();
      for (const provider of NAMES) {
        if (!Object.hasOwn(raw.keys || {}, provider)) continue;
        const value = raw.keys[provider];
        if (value === '') continue;
        if (envelope(value)) {
          try {
            const plaintext = await protector.unprotect(value.ciphertext, provider);
            if (!validKey(plaintext) || !plaintext) throw new Error('Invalid key.');
            settings.keys[provider] = plaintext; cached.set(provider, { value: plaintext, encrypted: value });
          } catch { settings.keys[provider] = value; errors[provider] = unavailable(provider); }
        } else if (validKey(value)) {
          legacy = true;
          try {
            const ciphertext = await protector.protect(value, provider);
            const encrypted = { type: 'windows-dpapi', version: 1, ciphertext };
            if (!envelope(encrypted)) throw new Error('Invalid protected key.');
            settings.keys[provider] = value; cached.set(provider, { value, encrypted });
          } catch { settings.keys[provider] = { type: 'unavailable-legacy' }; errors[provider] = unavailable(provider); }
        } else { settings.keys[provider] = { type: 'unavailable-record' }; errors[provider] = unavailable(provider); }
      }
      loaded = true; loadError = ''; migrationPending = false;
      if (legacy) {
        try { await write(settings); }
        catch { migrationPending = true; }
      }
      return settings;
    });
  }
  function save(settings) {
    return serialized(async () => {
      if (!loaded || loadError) throw new Error('Original assistant settings are unavailable; refusing to overwrite them.');
      await write(settings);
      migrationPending = false;
      errors = Object.fromEntries(NAMES.filter(name => settings.keys?.[name] && typeof settings.keys[name] !== 'string').map(name => [name, unavailable(name)]));
      for (const name of cached.keys()) if (!settings.keys?.[name]) cached.delete(name);
    });
  }
  const status = () => ({ supported: protector.supported, scheme: 'windows-dpapi-current-user', errors: { ...errors }, migrationPending,
    message: loadError || (migrationPending ? 'Existing key encryption could not be completed. Original file was not changed; remove unavailable keys or restart on Windows to retry.' :
      protector.supported ? 'Saved API keys are encrypted for your Windows account.' : 'Encrypted key storage requires Windows. Plaintext keys will not be saved.') });
  return { load, save, status };
}

module.exports = { createAssistantSettingsStore };
