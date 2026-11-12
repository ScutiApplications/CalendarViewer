// Application-owned Laya runtime and checkpoint. Only startPull may contact download servers.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { extractZip } = require('./archive');
const { downloadVerified, fetchJson } = require('./model-download');
const checkpoint = require('../laya/model.json');
const execute = promisify(execFile);
const UV = '0.13.7';
const TARGETS = { 'win32-x64': 'x86_64-pc-windows-msvc.zip', 'win32-arm64': 'aarch64-pc-windows-msvc.zip',
  'linux-x64': 'x86_64-unknown-linux-gnu.tar.gz', 'linux-arm64': 'aarch64-unknown-linux-gnu.tar.gz',
  'darwin-arm64': 'aarch64-apple-darwin.tar.gz', 'darwin-x64': 'x86_64-apple-darwin.tar.gz' };
const exists = file => fs.stat(file).then(value => value.isFile() && value.size > 0, () => false);

// execFile's message starts with long command paths; stderr's tail contains the actual Python failure.
function setupFailure(error, stage) {
  const outcome = [error.code != null ? 'exit ' + error.code : '', error.signal || '', error.killed ? 'process stopped or timed out' : ''].filter(Boolean).join(', ');
  const detail = String(error.stderr || error.message || error).trim().slice(-1500);
  return `${stage} failed${outcome ? ' (' + outcome + ')' : ''}: ${detail}`;
}

async function verifiedCheckpoint(target, file, signal) {
  if (!await fs.stat(target).then(info => info.isFile() && info.size === file.size, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) return false;
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(target, { signal })) hash.update(chunk);
  return hash.digest('hex') === file.sha256.toLowerCase();
}

function createLayaEngine({ dir, model = checkpoint, platform = process.platform, arch = process.arch, fetch: fetchImpl = global.fetch,
  spawn: spawnImpl = spawn, run = execute, installRuntime, idleMs = 15 * 60 * 1000, timeoutMs = 120000, verificationTimeoutMs = 10 * 60 * 1000 }) {
  dir = path.resolve(dir);
  const project = path.join(__dirname, '..', 'laya'), folder = path.join(dir, 'model');
  const python = path.join(dir, 'runtime', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const marker = path.join(dir, '.ready');
  const identity = fs.readFile(path.join(project, 'uv.lock')).then(lock => crypto.createHash('sha256').update(lock).update(model.revision).digest('hex'));
  const environment = () => ({ ...process.env, UV_PROJECT_ENVIRONMENT: path.join(dir, 'runtime'), UV_PYTHON_INSTALL_DIR: path.join(dir, 'python'),
    UV_CACHE_DIR: path.join(dir, 'cache'), UV_DEFAULT_INDEX: 'https://pypi.org/simple', UV_INDEX_URL: '', UV_EXTRA_INDEX_URL: '',
    HF_HOME: path.join(dir, 'hub'), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_TOKEN: '',
    TOKENIZERS_PARALLELISM: 'false', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1' });
  let job = null, worker = null, active = null, buffer = '', idle, serial = 0, installController = null, generation = 0;
  async function state() {
    const ready = await fs.readFile(marker, 'utf8').catch(() => '');
    const files = await Promise.all(model.files.map(file => fs.stat(path.join(folder, file.name)).then(info => info.isFile() && info.size === file.size, () => false)));
    return { supported: !!TARGETS[`${platform}-${arch}`], installed: ready === await identity && await exists(python) && files.every(Boolean),
      model: 'Laya typed-decisions', running: !!worker,
      pulling: job && !job.done ? { percent: job.percent, status: job.status, elapsedSeconds: Math.floor((Date.now() - job.started) / 1000) } : null, error: job?.error || '' };
  }
  async function findUv(root) {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isFile() && entry.name === (platform === 'win32' ? 'uv.exe' : 'uv')) return file;
      if (entry.isDirectory()) { const found = await findUv(file); if (found) return found; }
    }
    return '';
  }
  async function prepareRuntime() {
    const signal = installController.signal;
    if (installRuntime) return installRuntime(python);
    const name = 'uv-' + TARGETS[`${platform}-${arch}`];
    job.status = 'Finding private Python installer';
    const release = await fetchJson(`https://api.github.com/repos/astral-sh/uv/releases/tags/${UV}`, { fetch: fetchImpl, signal });
    signal.throwIfAborted();
    const asset = release.assets?.find(item => item.name === name);
    const expectedUrl = `https://github.com/astral-sh/uv/releases/download/${UV}/${name}`;
    if (!asset || asset.browser_download_url !== expectedUrl) throw new Error('No verified Python installer for this system.');
    const archive = path.join(dir, 'downloads', name), tools = path.join(dir, 'bootstrap');
    job.status = 'Downloading private Python installer';
    await downloadVerified({ url: expectedUrl, target: archive, sha256: String(asset.digest || '').replace(/^sha256:/, ''), maxBytes: 100 * 1024 ** 2, fetch: fetchImpl, signal,
      onBytes: (received, total) => { job.status = 'Downloading private Python installer: ' + (received / 1024 ** 2).toFixed(1) + (total ? ' / ' + (total / 1024 ** 2).toFixed(1) : '') + ' MB'; } });
    job.status = 'Unpacking private Python installer';
    await fs.mkdir(tools, { recursive: true });
    if (name.endsWith('.zip')) await extractZip(archive, tools);
    else await run('tar', ['-xzf', archive, '-C', tools], { signal, windowsHide: true, timeout: 60000 });
    const uv = await findUv(tools);
    if (!uv) throw new Error('Python installer missing from archive.');
    if (platform !== 'win32') await fs.chmod(uv, 0o755);
    job.status = 'Installing private Python and CPU Laya dependencies';
    signal.throwIfAborted();
    // Honor OS-managed trust roots, including corporate HTTPS inspection certificates.
    const setup = run(uv, ['sync', '--system-certs', '--project', project, '--frozen', '--no-dev', '--no-build', '--python', '3.12.16', '--managed-python', '--no-progress'],
      { env: environment(), signal, windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 1024 * 1024 });
    const diagnostics = setup.child?.stderr;
    let pending = '';
    const report = chunk => {
      const lines = (pending + chunk.toString('utf8')).slice(-4096).split(/[\r\n]+/);
      pending = lines.pop();
      const line = lines.filter(value => value.trim()).pop();
      if (line) job.status = 'Installing private Python and CPU Laya dependencies: ' + line.trim().slice(-200);
    };
    diagnostics?.on('data', report);
    try { await setup; }
    finally { diagnostics?.removeListener('data', report); }
  }
  async function startPull() {
    if (job && !job.done) return state();
    if (!TARGETS[`${platform}-${arch}`]) throw new Error('Laya has no bundled runtime for this system.');
    job = { done: false, percent: null, status: 'Preparing Laya runtime', error: '', started: Date.now() };
    const controller = installController = new AbortController();
    (async () => {
      try {
        if ((await state()).installed) return;
        await fs.mkdir(dir, { recursive: true });
        await fs.rm(marker, { force: true });
        await prepareRuntime(); job.percent = 20;
        const total = model.files.reduce((size, file) => size + file.size, 0); let completed = 0;
        for (const file of model.files) {
          controller.signal.throwIfAborted();
          const target = path.join(folder, file.name);
          job.status = 'Checking downloaded Laya file: ' + file.name;
          if (!await verifiedCheckpoint(target, file, controller.signal)) {
            job.status = 'Downloading Laya: ' + file.name;
            await downloadVerified({ url: `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.subfolder}/${file.name}`,
              target, sha256: file.sha256, maxBytes: file.size, fetch: fetchImpl, signal: controller.signal,
              onBytes: got => { job.percent = 20 + Math.floor((completed + got) / total * 70); } });
          }
          completed += file.size;
          job.percent = 20 + Math.floor(completed / total * 70);
        }
        job.status = 'Verifying Laya can load offline'; job.percent = 90;
        controller.signal.throwIfAborted();
        const check = await run(python, [path.join(project, 'worker.py'), folder, '--check'], { env: environment(), signal: controller.signal, windowsHide: true, timeout: verificationTimeoutMs, maxBuffer: 1024 * 1024 });
        if (!JSON.parse(check.stdout.trim()).ready) throw new Error('Laya runtime verification failed.');
        controller.signal.throwIfAborted();
        await fs.writeFile(marker, await identity);
        job.percent = 100; job.status = 'Laya ready';
      } catch (error) {
        job.error = setupFailure(error, job.status);
        // Keep full setup diagnostics locally; never include inference requests in this file.
        await fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(path.join(dir, 'setup-error.log'),
          [job.error, String(error.stderr || '').slice(-65536)].join('\n\n'), { mode: 0o600 })).catch(() => {});
      }
      finally { job.done = true; installController = null; }
    })();
    return state();
  }
  function stop(error = new Error('Laya worker stopped.')) {
    generation++;
    clearTimeout(idle);
    installController?.abort();
    const child = worker; worker = null; buffer = '';
    if (active) { const request = active; active = null; request.reject(error); }
    child?.kill();
  }
  async function predict(text, definitions, { signal } = {}) {
    const before = generation;
    signal?.throwIfAborted();
    if (!(await state()).installed) throw new Error('Download Laya and MiniCPM in assistant settings first.');
    if (before !== generation) throw Object.assign(new Error('Laya worker stopped.'), { name: 'AbortError' });
    signal?.throwIfAborted();
    if (active) throw new Error('Laya worker is busy.');
    clearTimeout(idle);
    if (!worker) {
      const child = worker = spawnImpl(python, ['-u', path.join(project, 'worker.py'), folder], { env: environment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const onExit = () => child.kill(); process.once('exit', onExit);
      child.once('exit', () => { process.removeListener('exit', onExit); if (worker === child) stop(new Error('Laya worker exited.')); });
      child.once('error', () => { process.removeListener('exit', onExit); if (worker === child) stop(new Error('Laya worker could not start.')); });
      child.stdin.on('error', () => { if (worker === child) stop(new Error('Laya request failed.')); });
      child.stderr.on('data', () => {}); // Drain diagnostics without logging questions or model data.
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (worker !== child) return;
        buffer += chunk;
        if (buffer.length > 1024 * 1024) return stop(new Error('Laya response too large.'));
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const reply = JSON.parse(line);
            if (active && reply.id === active.id) {
              const request = active; active = null;
              if (reply.error) request.reject(new Error('Laya routing failed.')); else request.resolve(reply);
            }
          } catch { stop(new Error('Invalid Laya response.')); return; }
        }
      });
    }
    const id = ++serial;
    const body = JSON.stringify({ id, text: text.slice(0, 4000), tools: definitions.map(tool => ({ name: tool.name, description: String(tool.description || '').slice(0, 160) })) }) + '\n';
    if (Buffer.byteLength(body) > 65536) throw new Error('Laya request too large.');
    try {
      return await new Promise((resolve, reject) => {
        const cancel = () => stop(Object.assign(new Error('Stopped'), { name: 'AbortError' }));
        const timer = setTimeout(() => stop(new Error('Laya routing timed out.')), timeoutMs);
        const finish = callback => value => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); callback(value); };
        active = { id, resolve: finish(resolve), reject: finish(reject) };
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) return cancel();
        worker.stdin.write(body);
      });
    } finally { idle = setTimeout(() => stop(), idleMs); idle.unref?.(); }
  }
  return { state, startPull, predict, stop };
}
module.exports = { createLayaEngine };
