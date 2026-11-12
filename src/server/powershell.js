// Runs scripts/calendar.ps1 with an action. Shared by the toast sender (alerts.js) and the startup installer (startup.js).
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'calendar.ps1');

const runCalendarScript = (args, options) => spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args
], { windowsHide: true, ...options });

module.exports = { runCalendarScript };
