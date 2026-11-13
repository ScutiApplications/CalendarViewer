// @ts-check
// Download and staging run asynchronously; only an explicit local action can start installation.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { downloadVerified } = require('./model-download');
const { extractZip } = require('./archive');
const { managedPath, checkedPath, validateJob, writeResult } = require('./update-worker');
const errorWithStatus = (message, status = 409) => Object.assign(new Error(message), { status });

async function listFiles(root, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (!managedPath(relative) || entry.isSymbolicLink()) throw new Error('Release ZIP contains a protected or unsafe path: ' + relative);
    if (entry.isDirectory()) files.push(...await listFiles(root, relative + '/'));
    else if (entry.isFile()) files.push(relative);
    else throw new Error('Release ZIP contains an unsupported entry.');
    if (files.length > 10000) throw new Error('Release ZIP has too many files.');
  }
  return files;
}

async function launchWorker(job, work) {
  const file = path.join(work, 'job.json'), script = path.join(work, 'worker.js');
  await fs.copyFile(path.join(__dirname, 'update-worker.js'), script);
  await fs.writeFile(file, JSON.stringify(job));
  const child = spawn(process.execPath, [script, file], { detached: true, windowsHide: true, stdio: 'ignore' });
  let failure;
  child.on('error', error => { failure = error; });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (failure) throw failure;
    if (await fs.stat(file + '.ready').then(() => true, () => false)) return;
    if (child.exitCode !== null) throw new Error('Update worker exited before it was ready.');
    await delay(100);
  }
  child.kill();
  throw new Error('Update worker did not become ready.');
}

function createUpdateInstaller({ root, dataDir, version, checker, port, platform = process.platform, download = downloadVerified, extract = extractZip, launch = launchWorker, restart = () => {} }) {
  const directory = path.join(dataDir, 'updates'), statusFile = path.join(directory, 'result.json');
  let current = { phase: 'idle' }, busy = false;
  async function unavailableReason() {
    if (platform !== 'win32') return 'One-click installation is supported on Windows portable installations.';
    if (await fs.lstat(path.join(root, '.git')).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; })) return 'This is a Git checkout. Update it with Git, or use a packaged portable installation.';
    return null;
  }
  async function state() {
    const unavailable = await unavailableReason();
    const result = busy ? current : await fs.readFile(statusFile, 'utf8').then(JSON.parse).catch(() => current);
    return { ...result, supported: !unavailable, unavailableReason: unavailable };
  }
  async function install(release) {
    try {
      await fs.mkdir(directory, { recursive: true });
      const work = await fs.mkdtemp(path.join(directory, 'job-'));
      const zip = path.join(work, 'release.zip'), unpacked = path.join(work, 'unpacked');
      await download({ ...release.download, ...await checker.downloadOptions?.(), target: zip, maxBytes: 100 * 1024 * 1024, signal: AbortSignal.timeout(10 * 60 * 1000), onBytes(received, total) { current = { ...current, received, total: total || release.download.size }; } });
      current = { phase: 'preparing', version: release.latestVersion };
      await extract(zip, unpacked, { maxBytes: 256 * 1024 * 1024 });
      const stage = path.join(unpacked, 'CalendarViewer');
      const top = await fs.readdir(unpacked);
      if (top.length !== 1 || top[0] !== 'CalendarViewer') throw new Error('Release ZIP must contain one CalendarViewer folder.');
      const files = await listFiles(stage);
      for (const required of ['VERSION', 'run.bat', 'src/server/server.js', 'scripts/calendar.ps1']) if (!files.includes(required)) throw new Error('Release ZIP is missing ' + required);
      let previous = [];
      const manifest = await checkedPath(root, 'update-manifest.json');
      try {
        previous = JSON.parse(await fs.readFile(manifest, 'utf8'));
        if (!Array.isArray(previous) || previous.some(name => !managedPath(name))) throw new Error('Invalid installed update manifest.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!files.includes('update-manifest.json')) files.push('update-manifest.json');
      await fs.writeFile(path.join(stage, 'update-manifest.json'), JSON.stringify(files));
      const job = { root: await fs.realpath(root), dataDir: await fs.realpath(dataDir), stage, files, obsolete: previous.filter(name => !files.includes(name)), backup: path.join(work, 'previous'), statusFile, version: release.latestVersion, pid: process.pid, port, nodePath: process.execPath };
      await validateJob(job);
      await launch(job, work);
      current = { phase: 'restarting', version: release.latestVersion };
      await writeResult(statusFile, current);
      restart();
    } catch (error) {
      const failed = { phase: 'failed', version: release.latestVersion, message: error.message };
      await writeResult(statusFile, failed).catch(() => {});
      busy = false;
      current = failed;
    }
  }
  async function start(expectedVersion) {
    if (busy) throw errorWithStatus('An update is already in progress.');
    busy = true;
    try {
      const unavailable = await unavailableReason();
      if (unavailable) throw errorWithStatus(unavailable);
      const release = await checker.check({ force: true });
      if (release.status !== 'available' || !release.download) throw errorWithStatus('No installable stable update is available.');
      if (release.latestVersion !== expectedVersion || release.latestVersion === version) throw errorWithStatus('Available version changed. Check for updates again before installing.');
      current = { phase: 'downloading', version: release.latestVersion, received: 0, total: release.download.size };
      void install(release);
      return current;
    } catch (error) { busy = false; throw error; }
  }
  return { state, start };
}
module.exports = { createUpdateInstaller };
