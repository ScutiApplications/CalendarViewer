// Windows owns the encryption key. Credentials travel over private stdin/stdout pipes, never command arguments.
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isHosted } = require('./providers');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'credential-protection.ps1');
const MAX_OUTPUT = 16384;
const failure = () => new Error('Windows could not protect or unlock the saved API key. Re-enter it under the Windows account that runs CalendarViewer.');

function createCredentialProtector({ platform = process.platform, spawnProcess = spawn, timeoutMs = 15000 } = {}) {
  async function transform(action, value, provider) {
    if (!isHosted(provider)) throw new Error('Unknown API key provider.');
    if (platform !== 'win32') throw new Error('Encrypted API key storage requires Windows. Plaintext keys will not be saved.');
    if (typeof value !== 'string' || value.length > 8192) throw failure();
    const input = JSON.stringify({ action, provider, data: action === 'protect' ? Buffer.from(value, 'utf8').toString('base64') : value });
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = await new Promise((resolve, reject) => {
      const child = spawnProcess(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      let size = 0, failed = false;
      const chunks = [];
      const timer = setTimeout(() => { failed = true; child.kill(); reject(failure()); }, timeoutMs);
      timer.unref?.();
      child.on('error', () => { clearTimeout(timer); reject(failure()); });
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_OUTPUT) { failed = true; child.kill(); reject(failure()); return; }
        chunks.push(chunk);
      });
      child.stdin.on('error', () => { /* EPIPE is reported by the exit/error handlers without exposing input. */ });
      child.on('close', code => {
        clearTimeout(timer);
        if (failed || code !== 0) return reject(failure());
        try {
          const output = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
          if (typeof output.data !== 'string' || !output.data || output.data.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output.data)) throw failure();
          resolve(output.data);
        } catch { reject(failure()); }
      });
      child.stdin.end(input);
    });
    return action === 'protect' ? result : Buffer.from(result, 'base64').toString('utf8');
  }
  return Object.freeze({ supported: platform === 'win32', protect: (value, provider) => transform('protect', value, provider),
    unprotect: (value, provider) => transform('unprotect', value, provider) });
}

module.exports = { createCredentialProtector };
