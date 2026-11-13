// @ts-check
// Turns "start the server at Windows sign-in" on or off by running scripts/calendar.ps1, the same script run.bat uses.
const fs = require('fs');
const path = require('path');
const { runCalendarScript } = require('./powershell');

const SHORTCUT_NAME = 'ICS Calendar Viewer.lnk';

function runInstaller(args) {
  return new Promise((resolve, reject) => {
    const child = runCalendarScript(args);
    let output = '';
    child.stdout.on('data', c => { output += c; });
    child.stderr.on('data', c => { output += c; });
    child.on('error', e => reject(new Error(e.message)));
    child.on('exit', code => {
      if (code === 0) return resolve(undefined);
      const lines = output.trim().split(/\r?\n/).filter(Boolean);
      reject(new Error(lines.pop() || 'Startup installer failed with code ' + code));
    });
  });
}

function createStartupService({
  platform = process.platform,
  shortcutPath = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', SHORTCUT_NAME),
  install = runInstaller
} = {}) {
  const supported = platform === 'win32' && !!process.env.APPDATA;
  const status = () => ({ supported, enabled: supported && fs.existsSync(shortcutPath) });

  // Server only: startup-on without -Browser does not open a browser at sign-in.
  async function set(enabled) {
    if (!supported) throw new Error('Automatic startup is only available on Windows.');
    await install([enabled ? 'startup-on' : 'startup-off']);
    return status();
  }

  return { status, set };
}

module.exports = { createStartupService };
