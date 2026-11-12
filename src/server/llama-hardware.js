// Ask the installed inference runtime which GPU drivers actually work; never invoke a shell.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

async function detectDevice(binary, { run = execute, signal } = {}) {
  signal?.throwIfAborted();
  try {
    const { stdout = '', stderr = '' } = await run(binary, ['--list-devices'], { windowsHide: true, timeout: 8000, maxBuffer: 65536, signal });
    signal?.throwIfAborted();
    const output = (stdout + '\n' + stderr).split('Available devices:')[1];
    if (!output) return null;
    const devices = [...output.matchAll(/^\s*((?:Vulkan|MTL|Metal|CUDA)\d*):\s*([^\r\n]{1,300})$/gm)].map(match => ({
      id: match[1], name: match[2].replace(/\s+\(\d+ MiB.*$/, '').trim()
    }));
    // Preserve runtime order otherwise, including integrated GPUs when they are the only option.
    return devices.find(device => /NVIDIA|Radeon\s+(?:RX|PRO)|Arc\(TM\)|\bArc\b/i.test(device.name)) || devices[0] || null;
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    return null;
  }
}

module.exports = { detectDevice };
