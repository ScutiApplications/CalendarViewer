// Self-contained built-in model: the official llama.cpp server program plus the MiniCPM5-2B weights, kept in data/llama.
// Nothing is downloaded until startPull() is called (the sidebar's Download button). Every download is checked against the
// SHA-256 that GitHub (release asset digest) and Hugging Face (LFS object id) publish. The server program runs on 127.0.0.1
// with a random port and a random key, starts on the first question and stops after a while without use.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { extractZip } = require('./archive');
const { detectDevice: probeDevice } = require('./llama-hardware');
const { cpuThreadsFor, cpuThreadLimit } = require('./assistant-config');

// Keep a CPU runtime alongside the Vulkan runtime; macOS releases already include Metal.
const RELEASE = 'b12244';
const ASSETS = { 'win32-x64': 'win-cpu-x64.zip', 'win32-arm64': 'win-cpu-arm64.zip', 'linux-x64': 'ubuntu-x64.tar.gz', 'linux-arm64': 'ubuntu-arm64.tar.gz', 'darwin-arm64': 'macos-arm64.tar.gz', 'darwin-x64': 'macos-x64.tar.gz' };
const GPU_ASSETS = { 'win32-x64': 'win-vulkan-x64.zip', 'win32-arm64': 'win-vulkan-arm64.zip', 'linux-x64': 'ubuntu-vulkan-x64.tar.gz', 'linux-arm64': 'ubuntu-vulkan-arm64.tar.gz' };
const MODEL = { repo: 'openbmb/MiniCPM5-2B-GGUF', file: 'MiniCPM5-2B-Q4_K_M.gguf' };
const RELEASE_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/';
const LIMITS = { binary: 600 * 1024 * 1024, model: 6 * 1024 * 1024 * 1024 };
const HEADERS = { 'User-Agent': 'CalendarViewer', Accept: 'application/json' };

// Measured with this build and MiniCPM5-2B-Q4_K_M on a 14-thread, 16 GB PC: the running program held about 1.6x the weights file
// in memory, and answering kept about 65% of all threads busy. Both scale with the PC, so they are shown as shares of it.
const RAM_PER_WEIGHT_BYTE = 1.6, CPU_SHARE_WHILE_ANSWERING = 0.65;
function loadEstimate(weightsBytes, totalMemory = os.totalmem()) {
  if (!(weightsBytes > 0) || !(totalMemory > 0)) return null;
  const ram = weightsBytes * RAM_PER_WEIGHT_BYTE;
  return { ramBytes: Math.round(ram), ramPercent: Math.max(1, Math.round(ram / totalMemory * 100)), cpuPercent: Math.round(CPU_SHARE_WHILE_ANSWERING * 100) };
}
const exists = async file => fsp.stat(file).then(s => s.isFile() && s.size > 0, () => false);
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`)));
});

function createLlamaEngine({ dir, fetch: fetchImpl = global.fetch, spawn: spawnImpl = spawn, detectDevice = probeDevice, cpuThreads = 0, platform = process.platform, arch = process.arch, idleMs = 15 * 60 * 1000, readyMs = 180000 }) {
  const assetSuffix = ASSETS[`${platform}-${arch}`] || '';
  const engineDir = path.join(dir, 'engine', RELEASE), modelFile = path.join(dir, 'models', MODEL.file);
  const gpuSuffix = GPU_ASSETS[`${platform}-${arch}`] || '';
  const gpuDir = platform === 'darwin' ? engineDir : engineDir + '-vulkan';
  const exeName = platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  let job = null, starting = null, idle = null, current = null;
  let selection = null, selectedDevice = null, gpuFailed = false, accelerationError = '', launchController = null;
  let threads = cpuThreadsFor(cpuThreads);

  // The program counts as installed only when its folder carries the .ok marker written after a complete unpack.
  async function search(folder, depth = 0) {
    const names = await fsp.readdir(folder, { withFileTypes: true }).catch(() => []);
    if (names.some(n => n.isFile() && n.name === exeName)) return path.join(folder, exeName);
    if (depth >= 3) return '';
    for (const n of names) if (n.isDirectory()) { const found = await search(path.join(folder, n.name), depth + 1); if (found) return found; }
    return '';
  }
  const findBinary = async () => (await exists(path.join(engineDir, '.ok'))) ? search(engineDir) : '';
  const findGpuBinary = async () => (gpuSuffix || platform === 'darwin') && await exists(path.join(gpuDir, '.ok')) ? search(gpuDir) : '';
  function hardware() {
    selection ||= findGpuBinary().then(async binary => {
      selectedDevice = binary ? await detectDevice(binary) : null;
      return selectedDevice ? { binary, device: selectedDevice } : null;
    }).catch(() => null);
    return selection;
  }
  async function state() {
    const binary = await findBinary(), weights = await exists(modelFile), weightsBytes = weights ? (await fsp.stat(modelFile)).size : 0;
    const gpu = await hardware();
    const backend = current?.backend || (!gpuFailed && gpu ? (platform === 'darwin' ? 'metal' : 'vulkan') : 'cpu');
    return { supported: !!assetSuffix, installed: !!binary && weights, binary: !!binary, weights, model: MODEL.file, running: !!current,
      accelerationReady: !!(await findGpuBinary()), backend, device: backend === 'cpu' ? null : selectedDevice?.name || null, accelerationError,
      cpuThreads: threads, activeCpuThreads: current?.cpuThreads ?? null,
      load: backend === 'cpu' ? loadEstimate(weightsBytes) : null, idleMinutes: Math.round(idleMs / 60000),
      pulling: job && !job.done ? { percent: job.percent, status: job.status } : null, error: job?.error || '' };
  }

  async function json(url) {
    const response = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}.`);
    return response.json();
  }
  // Streams to a .part file while hashing; the file only gets its real name when the checksum matches.
  async function download(url, target, sha256, maxBytes, onBytes) {
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'CalendarViewer' }, redirect: 'follow', signal: AbortSignal.timeout(2 * 60 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > maxBytes) throw new Error('The download is larger than allowed.');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const part = target + '.part', hash = crypto.createHash('sha256');
    let got = 0;
    try {
      await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _enc, done) {
        got += chunk.length;
        if (got > maxBytes) return done(new Error('The download is larger than allowed.'));
        hash.update(chunk); onBytes(got, total); done(null, chunk);
      } }), fs.createWriteStream(part));
      if (hash.digest('hex') !== sha256.toLowerCase()) throw new Error('The download did not match its published checksum.');
      await fsp.rename(part, target);
    } catch (e) { await fsp.rm(part, { force: true }); throw e; }
  }

  async function installProgram(suffix = assetSuffix, folder = engineDir) {
    job.status = suffix === gpuSuffix ? 'Downloading the GPU runtime' : 'Downloading the llama.cpp program';
    const release = await json(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${RELEASE}`);
    const asset = (release.assets || []).find(a => a.name === `llama-${RELEASE}-bin-${suffix}`);
    const sha = String(asset?.digest || '').replace(/^sha256:/, '');
    if (!asset || !/^[0-9a-f]{64}$/i.test(sha)) throw new Error('The llama.cpp release has no checksummed file for this system.');
    if (!String(asset.browser_download_url).startsWith(`${RELEASE_URL}${RELEASE}/`)) throw new Error('Unexpected download address.');
    const file = path.join(dir, 'downloads', asset.name);
    await download(asset.browser_download_url, file, sha, LIMITS.binary, (got, total) => { job.percent = total ? Math.floor(got / total * 4) : 0; });
    job.status = 'Unpacking the program'; job.percent = 4;
    const relative = path.relative(path.resolve(dir), path.resolve(folder));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid runtime folder.');
    await fsp.rm(folder, { recursive: true, force: true });
    await fsp.mkdir(folder, { recursive: true });
    if (asset.name.endsWith('.zip')) await extractZip(file, folder); else await run('tar', ['-xzf', file, '-C', folder]);
    await fsp.rm(file, { force: true });
    const binary = await search(folder);
    if (!binary) throw new Error('The program was not found in the download.');
    if (platform !== 'win32') await fsp.chmod(binary, 0o755);
    await fsp.writeFile(path.join(folder, '.ok'), RELEASE);
  }
  async function installModel() {
    job.status = 'Downloading the model';
    const tree = await json(`https://huggingface.co/api/models/${MODEL.repo}/tree/main`);
    const entry = (Array.isArray(tree) ? tree : []).find(f => f.path === MODEL.file);
    const sha = String(entry?.lfs?.oid || '');
    if (!/^[0-9a-f]{64}$/i.test(sha)) throw new Error('Hugging Face lists no checksum for the model file.');
    await download(`https://huggingface.co/${MODEL.repo}/resolve/main/${MODEL.file}`, modelFile, sha, LIMITS.model, (got, total) => { job.percent = total ? 5 + Math.floor(got / total * 95) : 5; });
  }
  // Starts the downloads in the background and returns at once; progress shows in state().
  async function startPull() {
    if (!assetSuffix) return { ...(await state()), error: 'This system has no ready-made llama.cpp build in the app.' };
    if (job && !job.done) return state();
    const mine = job = { done: false, percent: 0, status: 'Starting', error: '' };
    (async () => {
      try {
        if (!(await findBinary())) await installProgram();
        if (gpuSuffix && !(await findGpuBinary())) {
          try { await installProgram(gpuSuffix, gpuDir); accelerationError = ''; }
          catch (error) { accelerationError = 'GPU runtime unavailable; using CPU. ' + String(error.message).slice(0, 160); }
        }
        selection = null;
        mine.percent = 5;
        if (!(await exists(modelFile))) await installModel();
        mine.percent = 100; mine.status = 'Done';
      } catch (e) { mine.error = (e.name === 'TimeoutError' ? 'The download took too long.' : String(e.cause?.code || e.message)).slice(0, 200); }
      finally { mine.done = true; }
    })();
    return state();
  }

  function stop() {
    clearTimeout(idle);
    launchController?.abort();
    const old = current; current = null;
    old?.child.kill();
  }
  const touch = () => { clearTimeout(idle); idle = setTimeout(stop, idleMs); idle.unref?.(); };
  async function launchProgram(binary, device, signal) {
    signal?.throwIfAborted();
    if (!binary || !(await exists(modelFile))) throw new Error('The built-in model is not downloaded yet.');
    const port = await freePort(), key = crypto.randomBytes(16).toString('hex');
    signal?.throwIfAborted();
    // --jinja uses the model's own chat template, which is what makes tool calls work. Thinking is switched off per request.
    const args = ['-m', modelFile, '--host', '127.0.0.1', '--port', String(port), '--api-key', key, '--jinja', '-c', '8192', '-np', '1', '--device', device?.id || 'none', '-ngl', device ? 'auto' : '0'];
    const activeThreads = device ? null : Math.min(threads, cpuThreadLimit());
    if (activeThreads) args.push('-t', String(activeThreads), '-tb', String(activeThreads));
    const proc = spawnImpl(binary, args, { cwd: path.dirname(binary), stdio: 'ignore', windowsHide: true });
    let exited = false;
    const onExit = () => proc.kill();
    proc.once('exit', () => { exited = true; process.removeListener('exit', onExit); if (current?.child === proc) current = null; });
    proc.once('error', () => { exited = true; });
    process.once('exit', onExit);
    const cancel = () => proc.kill();
    signal?.addEventListener('abort', cancel, { once: true });
    const url = `http://127.0.0.1:${port}`, until = Date.now() + readyMs;
    try {
      for (;;) {
        signal?.throwIfAborted();
        if (exited) throw new Error('The model program stopped while loading. The model file may be damaged; download it again.');
        if (Date.now() > until) throw new Error('The model took too long to load.');
        try { const health = await fetchImpl(url + '/health', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(2000) }); if (health.ok) break; } catch { /* still loading */ }
        await delay(300, undefined, { signal });
      }
      signal?.throwIfAborted();
      return (current = { child: proc, url, key, backend: device ? (platform === 'darwin' ? 'metal' : 'vulkan') : 'cpu', cpuThreads: activeThreads });
    } catch (e) { proc.kill(); process.removeListener('exit', onExit); throw e; }
    finally { signal?.removeEventListener('abort', cancel); }
  }
  async function launch(signal) {
    const gpu = await hardware();
    signal?.throwIfAborted();
    if (gpu && !gpuFailed) {
      try { return await launchProgram(gpu.binary, gpu.device, signal); }
      catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        gpuFailed = true; accelerationError = 'GPU startup failed; using CPU. ' + String(error.message).slice(0, 160);
      }
    }
    return launchProgram(await findBinary(), null, signal);
  }
  // The running server's address and key; starts it (loading the model takes a few seconds) when it is not running.
  async function ensure(signal) {
    touch();
    if (current) return current;
    signal?.throwIfAborted();
    if (!starting) {
      const controller = launchController = new AbortController();
      const cancel = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      starting = launch(controller.signal).finally(() => {
        signal?.removeEventListener('abort', cancel);
        starting = null; launchController = null;
      });
    }
    return starting;
  }
  // Do not kill an active answer; the next model start takes the new thread count.
  const configure = next => { threads = cpuThreadsFor(next.cpuThreads); };
  return { state, startPull, ensure, touch, stop, configure, release: RELEASE, modelFile: MODEL.file };
}
module.exports = { createLlamaEngine, RELEASE, loadEstimate };
