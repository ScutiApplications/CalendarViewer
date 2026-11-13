// @ts-check
// Standalone worker: copied outside application code before shutdown, so updates cannot replace it mid-run.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

function managedPath(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || name.includes('\\')) return false;
  const parts = name.split('/');
  if (['data', 'secrets', '.secrets', '.git', 'node_modules', 'dist', 'build'].includes(parts[0].toLowerCase())) return false;
  return parts.every((part, i) => part && part !== '.' && part !== '..' &&
    !/[\x00-\x1f<>:"|?*]/.test(part) && !/[. ]$/.test(part) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part) &&
    !/\.(pem|key)$/i.test(part) &&
    (!part.startsWith('.') || (i === 0 && ['.github', '.gitignore', '.gitattributes'].includes(part))));
}

// Refuse links at every existing level, including Windows junctions; never follow one into user files.
async function checkedPath(root, relative) {
  if (!managedPath(relative)) throw new Error('Protected or unsafe update path: ' + relative);
  let target = root;
  for (const part of relative.split('/')) {
    target = path.join(target, part);
    const info = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (/** @type {import("node:fs").Stats | undefined} */ (info)?.isSymbolicLink()) throw new Error('Update paths cannot contain filesystem links.');
  }
  return target;
}

async function writeResult(file, result) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = JSON.stringify({ ...result, updatedAt: new Date().toISOString() });
  // Windows refuses to replace a file another process (the worker, a status poll, antivirus) holds open.
  // Use a unique staging name, retry the rename, and fall back to a direct write; the status file is small.
  const staging = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
  await fs.writeFile(staging, body);
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(staging, file); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) { await fs.rm(staging, { force: true }); throw error; }
      if (attempt >= 9) break;
      await delay(50 * (attempt + 1));
    }
  }
  try { await fs.writeFile(file, body); }
  finally { await fs.rm(staging, { force: true }); }
}

async function validateJob(job) {
  if (!Array.isArray(job.files) || !job.files.length || job.files.length > 10000 || !Array.isArray(job.obsolete)) throw new Error('Invalid update file manifest.');
  const seen = new Set();
  const data = path.resolve(job.dataDir || path.join(job.root, 'data'));
  for (const relative of [...job.files, ...job.obsolete]) {
    if (seen.has(relative.toLowerCase())) throw new Error('Duplicate update path.');
    seen.add(relative.toLowerCase());
    const target = await checkedPath(job.root, relative), fromData = path.relative(data, target);
    if (!fromData || (!fromData.startsWith('..' + path.sep) && fromData !== '..' && !path.isAbsolute(fromData))) throw new Error('Update would overwrite application data.');
    const existing = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (existing && !existing.isFile()) throw new Error('Update target must be a regular file.');
  }
  for (const relative of job.files) {
    const source = await checkedPath(job.stage, relative);
    if (!(await fs.lstat(source)).isFile()) throw new Error('Update source must be a regular file.');
  }
  if ((await fs.readFile(path.join(job.stage, 'VERSION'), 'utf8')).trim() !== job.version) throw new Error('Release ZIP version does not match its release tag.');
}

async function waitForParent(job) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { process.kill(job.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await delay(100);
  }
  throw new Error('Calendar Viewer did not stop; update was not installed.');
}

function startServer(job) {
  return new Promise((resolve, reject) => {
    const flags = process.allowedNodeEnvironmentFlags.has('--use-system-ca') ? ['--use-system-ca'] : [];
    const child = spawn(job.nodePath || process.execPath, [...flags, path.join(job.root, 'src', 'server', 'server.js')], {
      cwd: job.root, detached: true, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, PORT: String(job.port), CALENDAR_DATA_DIR: job.dataDir }
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(child); });
  });
}

async function health(child, version, job) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode) throw new Error('Updated server exited during startup.');
    try {
      const response = await fetch(`http://127.0.0.1:${job.port}/api/version`, { signal: AbortSignal.timeout(500), redirect: 'error' });
      if (response.ok) {
        const info = await response.json();
        if ((!version || info.version === version) && (!version || info.pid === child.pid)) return;
      }
    } catch { /* Server may still be starting. */ }
    await delay(150);
  }
  throw new Error('Updated server did not become ready.');
}

async function stopChild(child) {
  if (!child || child.exitCode !== null && child.exitCode !== undefined) return;
  child.kill();
  if (typeof child.once !== 'function') return;
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
}

// Back up every affected file before the first write. Roll back replacements, removals and additions together.
async function applyUpdate(job, dependencies = {}) {
  const wait = dependencies.waitForParent || waitForParent, start = dependencies.startServer || startServer, probe = dependencies.health || health;
  const saved = new Map(), changed = [];
  let child, stopped = false, restored = false;
  try {
    await validateJob(job);
    await wait(job); stopped = true;
    for (const relative of [...job.files, ...job.obsolete]) {
      const target = await checkedPath(job.root, relative), backup = path.join(job.backup, relative);
      const exists = await fs.lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (exists) { await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.copyFile(target, backup); }
      saved.set(relative, exists);
    }
    await fs.writeFile(path.join(job.backup, 'recovery.json'), JSON.stringify([...saved]));
    for (const relative of [...job.files, ...job.obsolete]) {
      const target = await checkedPath(job.root, relative);
      changed.push(relative);
      if (job.obsolete.includes(relative)) { await fs.rm(target, { force: true }); continue; }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(job.stage, relative), target + '.update-tmp');
      await fs.rename(target + '.update-tmp', target);
    }
    child = await start(job);
    await probe(child, job.version, job);
    await writeResult(job.statusFile, { phase: 'complete', version: job.version, message: 'Update installed.' });
  } catch (error) {
    await stopChild(child);
    try {
      for (const relative of changed.reverse()) {
        const target = await checkedPath(job.root, relative);
        if (saved.get(relative)) await fs.copyFile(path.join(job.backup, relative), target);
        else await fs.rm(target, { force: true });
        await fs.rm(target + '.update-tmp', { force: true });
      }
      restored = changed.length > 0;
      if (stopped) { child = await start(job); await probe(child, null, job); }
    } catch (recovery) { error.message += ' Recovery needs attention: ' + recovery.message; }
    await writeResult(job.statusFile, { phase: 'failed', version: job.version, message: error.message + (restored ? ' Previous files restored.' : '') });
    throw error;
  }
}

if (require.main === module) {
  (async () => {
    const file = process.argv[2], job = JSON.parse(await fs.readFile(file, 'utf8'));
    await validateJob(job);
    await fs.writeFile(file + '.ready', 'ready');
    await applyUpdate(job);
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { managedPath, checkedPath, validateJob, writeResult, applyUpdate };
