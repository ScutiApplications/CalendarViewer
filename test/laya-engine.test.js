const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createLayaEngine } = require('../src/server/laya-engine');
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-laya-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const model = { repo: 'test/model', revision: 'a'.repeat(40), subfolder: 'typed-decisions', files: [{ name: 'model.safetensors', size: 7, sha256: sha('weights') }] };

test('runtime setup reports unknown progress and preserves the actual failure after long command paths', async t => {
  const dir = temp(t);
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const engine = createLayaEngine({ dir, model, platform: 'win32', arch: 'x64',
    installRuntime: async () => {
      await waiting;
      throw Object.assign(new Error('Command failed: ' + 'long-path/'.repeat(100)), {
        code: 1, stderr: 'warning\n'.repeat(400) + 'RuntimeError: synthetic verification failure'
      });
    }
  });
  t.after(() => engine.stop());
  await engine.startPull();
  const pending = await engine.state();
  assert.equal(pending.pulling.percent, null);
  assert.equal(typeof pending.pulling.elapsedSeconds, 'number');
  release();
  for (let i = 0; i < 200 && (await engine.state()).pulling; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const failed = await engine.state();
  assert.match(failed.error, /exit 1/);
  assert.match(failed.error, /RuntimeError: synthetic verification failure$/);
  assert.doesNotMatch(failed.error, /long-path/);
  assert.match(await fs.promises.readFile(path.join(dir, 'setup-error.log'), 'utf8'), /RuntimeError: synthetic verification failure/);
});

test('private runtime setup uses system certificates for dependency downloads', async t => {
  const dir = temp(t), archive = 'synthetic runtime archive';
  const name = 'uv-x86_64-unknown-linux-gnu.tar.gz';
  const url = `https://github.com/astral-sh/uv/releases/download/0.13.7/${name}`;
  let synced = false;
  const engine = createLayaEngine({ dir, model, platform: 'linux', arch: 'x64',
    fetch: async request => request.includes('api.github.com')
      ? new Response(JSON.stringify({ assets: [{ name, browser_download_url: url, digest: 'sha256:' + sha(archive) }] }))
      : new Response(request === url ? archive : 'weights'),
    run: async (binary, args, options) => {
      if (binary === 'tar') await fs.promises.writeFile(path.join(dir, 'bootstrap', 'uv'), 'installer');
      else if (args[0] === 'sync') {
        assert.ok(args.includes('--system-certs'), 'uv must use system trust roots');
        assert.ok(!args.includes('--allow-insecure-host'));
        assert.equal(options.windowsHide, true);
        const python = path.join(dir, 'runtime', 'bin', 'python');
        await fs.promises.mkdir(path.dirname(python), { recursive: true });
        await fs.promises.writeFile(python, 'python');
        synced = true;
      }
      return { stdout: '{"ready":true}' };
    }
  });
  t.after(() => engine.stop());
  await engine.startPull();
  for (let i = 0; i < 200 && (await engine.state()).pulling; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const state = await engine.state();
  assert.equal(state.error, '');
  assert.equal(synced, true);
  assert.equal(state.installed, true);
});

test('Laya never downloads on state or inference; explicit setup verifies all checkpoint files', async t => {
  const dir = temp(t); let calls = 0, installs = 0;
  const engine = createLayaEngine({ dir, model, platform: 'win32', arch: 'x64', fetch: async () => { calls++; return new Response('weights'); },
    installRuntime: async python => { installs++; fs.mkdirSync(path.dirname(python), { recursive: true }); fs.writeFileSync(python, 'python'); }, run: async () => ({ stdout: '{"ready":true}' }) });
  assert.equal((await engine.state()).installed, false);
  await assert.rejects(engine.predict('q', []), /download/i);
  assert.equal(calls, 0);
  await engine.startPull();
  for (let i = 0; i < 100 && (await engine.state()).pulling; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal((await engine.state()).installed, true); assert.equal(calls, 1); assert.equal(installs, 1);
  await engine.startPull();
  for (let i = 0; i < 100 && (await engine.state()).pulling; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(calls, 1); assert.equal(installs, 1);
});

test('bad Laya hashes never mark setup complete, and a retry repairs the checkpoint', async t => {
  const dir = temp(t); let bytes = 'corrupt';
  const engine = createLayaEngine({ dir, model, platform: 'win32', arch: 'x64', fetch: async () => new Response(bytes),
    installRuntime: async python => { fs.mkdirSync(path.dirname(python), { recursive: true }); fs.writeFileSync(python, 'python'); }, run: async () => ({ stdout: '{"ready":true}' }) });
  async function install() { await engine.startPull(); for (let i = 0; i < 100 && (await engine.state()).pulling; i++) await new Promise(r => setTimeout(r, 5)); return engine.state(); }
  assert.match((await install()).error, /checksum/);
  assert.equal((await engine.state()).installed, false);
  bytes = 'weights'; assert.equal((await install()).installed, true);
});

test('verification retry reuses checksummed downloads and allows slow first loads', async t => {
  const dir = temp(t); let downloads = 0, checks = 0;
  const engine = createLayaEngine({ dir, model, platform: 'win32', arch: 'x64',
    fetch: async () => { downloads++; return new Response('weights'); },
    installRuntime: async python => { await fs.promises.mkdir(path.dirname(python), { recursive: true }); await fs.promises.writeFile(python, 'python'); },
    run: async (_binary, _args, options) => {
      assert.equal(options.timeout, 10 * 60 * 1000);
      assert.equal(options.env.HF_HUB_OFFLINE, '1');
      if (++checks === 1) throw Object.assign(new Error('verification timed out'), { killed: true, signal: 'SIGTERM' });
      return { stdout: '{"ready":true}', stderr: 'A nonfatal warning' };
    }
  });
  t.after(() => engine.stop());
  async function install() {
    await engine.startPull();
    for (let i = 0; i < 200 && (await engine.state()).pulling; i++) await new Promise(resolve => setTimeout(resolve, 5));
    return engine.state();
  }
  assert.match((await install()).error, /timed out/);
  assert.equal((await install()).installed, true);
  assert.equal(downloads, 1);
  assert.equal(checks, 2);
});

async function readyWorker(t, spawn) {
  const dir = temp(t); let downloads = 0;
  const engine = createLayaEngine({ dir, model, platform: 'win32', arch: 'x64', spawn,
    fetch: async () => { downloads++; return new Response('weights'); },
    installRuntime: async python => { fs.mkdirSync(path.dirname(python), { recursive: true }); fs.writeFileSync(python, 'python'); }, run: async () => ({ stdout: '{"ready":true}' }) });
  t.after(() => engine.stop());
  await engine.startPull(); for (let i = 0; i < 100 && (await engine.state()).pulling; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal((await engine.state()).installed, true);
  return { engine, downloads: () => downloads };
}
function child(onRequest) {
  const process = new EventEmitter(); process.stdout = new PassThrough(); process.stderr = new PassThrough();
  process.stdin = new Writable({ write(bytes, _encoding, done) { done(); onRequest(JSON.parse(String(bytes)), process); } });
  process.kill = () => { process.killed = true; process.emit('exit', 0); };
  return process;
}

test('offline worker is reused and routes over stdin without downloading or opening another service', async t => {
  const starts = [];
  const { engine, downloads } = await readyWorker(t, (binary, args, options) => {
    assert.match(binary, /runtime.*python.exe$/);
    assert.equal(options.env.HF_HUB_OFFLINE, '1'); assert.equal(options.env.TRANSFORMERS_OFFLINE, '1');
    assert.equal(options.windowsHide, true);
    const process = child((request, proc) => queueMicrotask(() => proc.stdout.write(JSON.stringify({ id: request.id, answers: { tool: { choice: 'A', answer_confidence: 0.99 } } }) + '\n')));
    starts.push(process); return process;
  });
  for (let i = 0; i < 2; i++) assert.equal((await engine.predict('synthetic question', [{ name: 'tool' }])).answers.tool.choice, 'A');
  assert.equal(starts.length, 1); assert.equal(downloads(), 1);
  engine.stop(); assert.equal(starts[0].killed, true);
});

test('cancellation terminates an active worker, and concurrent routing does not create another process', async t => {
  let requested, proc; const written = new Promise(resolve => { requested = resolve; });
  const { engine } = await readyWorker(t, () => (proc = child(() => requested())));
  const controller = new AbortController();
  const pending = engine.predict('q', [{ name: 'tool' }], { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await written;
  await assert.rejects(engine.predict('q2', [{ name: 'tool' }]), /busy/);
  controller.abort(); await rejected;
  assert.equal(proc.killed, true); assert.equal((await engine.state()).running, false);
});

test('stopping setup prevents model verification after changing provider', async t => {
  const dir = temp(t); let installed, proceed, checked = false;
  const begun = new Promise(resolve => { installed = resolve; });
  const gate = new Promise(resolve => { proceed = resolve; });
  const engine = createLayaEngine({ dir, model, platform: 'win32', arch: 'x64', installRuntime: async () => { installed(); await gate; },
    fetch: async () => { throw new Error('must not download after cancellation'); }, run: async () => { checked = true; return { stdout: '{"ready":true}' }; } });
  await engine.startPull(); await begun; engine.stop(); proceed();
  for (let i = 0; i < 100 && (await engine.state()).pulling; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(checked, false); assert.equal((await engine.state()).installed, false);
});

test('stopping during a readiness read prevents a late worker start', async t => {
  let starts = 0;
  const { engine } = await readyWorker(t, () => { starts++; return child((request, proc) => queueMicrotask(() => proc.stdout.write(JSON.stringify({ id: request.id, answers: {} }) + '\n'))); });
  const pending = engine.predict('q', [{ name: 'tool' }]); engine.stop();
  await assert.rejects(pending, /stopped/i); assert.equal(starts, 0);
});
