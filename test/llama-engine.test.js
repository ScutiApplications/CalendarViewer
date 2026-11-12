const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { extractZip } = require('../src/server/archive');
const { createLlamaEngine, RELEASE } = require('../src/server/llama-engine');
const { createModelClient, ServiceUnreachable } = require('../src/server/model-client');

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
// A real zip (deflate), built here so the extractor is tested on bytes it did not write.
function makeZip(files) {
  const locals = [], central = []; let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.data), packed = zlib.deflateRawSync(data), name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, name, packed); central.push(entry, name); offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const settle = async engine => { for (let i = 0; i < 200; i++) { if (!(await engine.state()).pulling) return engine.state(); await new Promise(r => setTimeout(r, 10)); } throw new Error('still pulling'); };

test('zip extraction unpacks nested files and refuses paths that escape the folder', async t => {
  const dir = temp(t), file = path.join(dir, 'a.bin');
  fs.writeFileSync(file, makeZip([{ name: 'build/bin/tool.exe', data: 'exe-bytes' }, { name: 'build/readme.txt', data: 'hello '.repeat(50) }]));
  assert.equal(await extractZip(file, path.join(dir, 'out')), 2);
  assert.equal(fs.readFileSync(path.join(dir, 'out/build/bin/tool.exe'), 'utf8'), 'exe-bytes');
  fs.writeFileSync(file, makeZip([{ name: '../escape.txt', data: 'x' }]));
  await assert.rejects(extractZip(file, path.join(dir, 'out2')), /Unsafe path/);
  assert.equal(fs.existsSync(path.join(dir, 'escape.txt')), false);
  fs.writeFileSync(file, makeZip([{ name: 'big.txt', data: 'x'.repeat(5000) }]));
  await assert.rejects(extractZip(file, path.join(dir, 'out3'), { maxBytes: 100 }), /larger than allowed/);
  fs.writeFileSync(file, 'not a zip at all, just some text that is long enough to look for a directory in');
  await assert.rejects(extractZip(file, path.join(dir, 'out4')), /Not a zip/);
});

function downloadFixture({ badModelSha = false } = {}) {
  const zip = makeZip([{ name: 'llama-bin/llama-server.exe', data: 'fake-server' }]);
  const model = Buffer.from('gguf-weights'.repeat(100));
  const asset = `llama-${RELEASE}-bin-win-cpu-x64.zip`, assetUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${RELEASE}/${asset}`;
  const seen = [];
  const fetch = async url => {
    seen.push(url);
    if (url.includes('api.github.com')) return new Response(JSON.stringify({ assets: [{ name: asset, digest: 'sha256:' + sha(zip), browser_download_url: assetUrl }] }));
    if (url === assetUrl) return new Response(zip);
    if (url.includes('huggingface.co/api')) return new Response(JSON.stringify([{ path: 'MiniCPM5-2B-Q4_K_M.gguf', lfs: { oid: badModelSha ? sha('other') : sha(model) } }]));
    if (url.includes('huggingface.co/openbmb')) return new Response(model);
    return new Response('?', { status: 404 });
  };
  return { fetch, seen, model };
}
test('download installs the program and the model after checking both checksums', async t => {
  const dir = temp(t), { fetch, seen, model } = downloadFixture();
  const engine = createLlamaEngine({ dir, fetch, platform: 'win32', arch: 'x64' });
  assert.deepEqual([(await engine.state()).installed, (await engine.state()).supported], [false, true]);
  await engine.startPull();
  const done = await settle(engine);
  assert.deepEqual([done.installed, done.error], [true, '']);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'models/MiniCPM5-2B-Q4_K_M.gguf')), model);
  assert.equal(fs.readdirSync(path.join(dir, 'models')).some(n => n.endsWith('.part')), false);
  assert.ok(seen.some(u => u.startsWith('https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/' + RELEASE)));
  // A second press downloads nothing.
  seen.length = 0; await engine.startPull(); await settle(engine);
  assert.deepEqual(seen, []);
});
test('a download that does not match its published checksum is discarded', async t => {
  const dir = temp(t), { fetch } = downloadFixture({ badModelSha: true });
  const engine = createLlamaEngine({ dir, fetch, platform: 'win32', arch: 'x64' });
  await engine.startPull();
  const done = await settle(engine);
  assert.match(done.error, /checksum/);
  assert.equal(done.installed, false);
  assert.equal(fs.existsSync(path.join(dir, 'models/MiniCPM5-2B-Q4_K_M.gguf')), false);
  assert.equal(fs.existsSync(path.join(dir, 'models/MiniCPM5-2B-Q4_K_M.gguf.part')), false);
});
test('an unsupported system and a release without a checksum are reported, not guessed', async t => {
  const unsupported = createLlamaEngine({ dir: temp(t), platform: 'freebsd', arch: 'x64' });
  assert.equal((await unsupported.state()).supported, false);
  assert.match((await unsupported.startPull()).error, /no ready-made/);
  const dir = temp(t);
  const engine = createLlamaEngine({ dir, platform: 'win32', arch: 'x64', fetch: async () => new Response(JSON.stringify({ assets: [{ name: `llama-${RELEASE}-bin-win-cpu-x64.zip`, browser_download_url: 'https://evil.example/x.zip' }] })) });
  await engine.startPull();
  assert.match((await settle(engine)).error, /checksummed/);
});

function installed(dir) {
  fs.mkdirSync(path.join(dir, 'engine', RELEASE, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'engine', RELEASE, 'bin', 'llama-server.exe'), 'x');
  fs.writeFileSync(path.join(dir, 'engine', RELEASE, '.ok'), RELEASE);
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'models', 'MiniCPM5-2B-Q4_K_M.gguf'), 'weights');
}
function fakeProgram() {
  const started = [];
  const spawn = (binary, args, options) => {
    const child = new EventEmitter(); child.kill = () => { child.killed = true; child.emit('exit', 0); };
    started.push({ binary, args, options, child }); return child;
  };
  const fetch = async (url, options) => {
    const port = new URL(url).port, entry = started.find(s => s.args.includes(port));
    return options.headers.Authorization === `Bearer ${entry.args[entry.args.indexOf('--api-key') + 1]}` ? new Response('{"status":"ok"}') : new Response('', { status: 401 });
  };
  return { started, spawn, fetch };
}
test('the engine starts the program once, on a loopback port with a key, and stops it', async t => {
  const dir = temp(t); installed(dir);
  const { started, spawn, fetch } = fakeProgram();
  const engine = createLlamaEngine({ dir, spawn, fetch, platform: 'win32', arch: 'x64', idleMs: 60000 });
  const [a, b] = await Promise.all([engine.ensure(), engine.ensure()]);
  assert.equal(a.url, b.url); assert.equal(started.length, 1);
  const { args } = started[0];
  assert.deepEqual([args[args.indexOf('--host') + 1], args.includes('--jinja'), args.includes('-m'), /^[0-9a-f]{32}$/.test(a.key)], ['127.0.0.1', true, true, true]);
  assert.ok(a.url.startsWith('http://127.0.0.1:'));
  assert.equal((await engine.ensure()).url, a.url); assert.equal(started.length, 1);
  engine.stop();
  assert.equal(started[0].child.killed, true);
  assert.equal((await engine.ensure()).url !== undefined, true); assert.equal(started.length, 2);
  engine.stop();
});
test('the engine reports a program that quits while loading and a model that is not downloaded', async t => {
  const empty = createLlamaEngine({ dir: temp(t), platform: 'win32', arch: 'x64' });
  await assert.rejects(empty.ensure(), /not downloaded/);
  const dir = temp(t); installed(dir);
  const crashing = createLlamaEngine({ dir, platform: 'win32', arch: 'x64', fetch: async () => { throw new Error('refused'); }, spawn: () => { const c = new EventEmitter(); c.kill = () => {}; setTimeout(() => c.emit('exit', 1), 20); return c; } });
  await assert.rejects(crashing.ensure(), /stopped while loading/);
});

test('the client answers through the engine, and as the backup when the chosen provider fails', async t => {
  const calls = [];
  const engine = { ensure: async () => ({ url: 'http://127.0.0.1:5555', key: 'k1' }), touch() { calls.push('touch'); }, state: async () => ({ installed: true }) };
  const fetch = async (url, options) => {
    calls.push(url);
    if (url.includes('openai')) return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    assert.equal(options.headers.Authorization, 'Bearer k1');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ function: { name: 'list_events', arguments: '{"start":"today"}' } }] } }] }));
  };
  const payload = { messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], tools: [{ name: 'list_events', description: 'd', parameters: { type: 'object', properties: {} } }], max_tokens: 100, temperature: 0 };
  const own = createModelClient({ provider: 'llamacpp', engine, fetch });
  assert.deepEqual(await own.health(), { ready: true, model: 'MiniCPM5-2B-Q4_K_M' });
  const reply = await own.chat(payload);
  assert.deepEqual([reply.finish_reason, reply.tool_calls[0].arguments, calls.includes('http://127.0.0.1:5555/v1/chat/completions'), calls.at(-1)], ['tool_calls', { start: 'today' }, true, 'touch']);
  const backed = createModelClient({ provider: 'openai', token: 'bad', fallback: 'llamacpp', engine, fetch });
  assert.equal((await backed.chat(payload)).backup, true);
  assert.deepEqual(await backed.health(), { ready: true, model: 'luna-6' });
  const broken = createModelClient({ provider: 'llamacpp', engine: { ensure: async () => { throw new Error('not downloaded'); }, touch() {}, state: async () => ({ installed: false }) }, fetch });
  await assert.rejects(broken.chat(payload), e => e instanceof ServiceUnreachable && e.code === 'engine' && /not downloaded/.test(e.message));
  assert.deepEqual(await broken.health(), { ready: false, model: 'MiniCPM5-2B-Q4_K_M' });
});

test('the load estimate scales with the weights and the PC memory', () => {
  const { loadEstimate } = require('../src/server/llama-engine');
  const gb = 1024 ** 3;
  assert.deepEqual(loadEstimate(1.5 * gb, 16 * gb), { ramBytes: Math.round(1.5 * gb * 1.6), ramPercent: 15, cpuPercent: 65 });
  assert.equal(loadEstimate(1.5 * gb, 8 * gb).ramPercent, 30);
  assert.equal(loadEstimate(0, 16 * gb), null);
});
