const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDevice } = require('../src/server/llama-hardware');

test('device detection uses the runtime listing and prefers a discrete GPU over integrated graphics', async () => {
  const device = await detectDevice('llama-server.exe', { run: async (binary, args, options) => {
    assert.equal(binary, 'llama-server.exe');
    assert.deepEqual(args, ['--list-devices']);
    assert.equal(options.windowsHide, true);
    assert.ok(options.timeout > 0 && options.maxBuffer <= 65536);
    return { stdout: 'Available devices:\n  Vulkan0: AMD Radeon 740M Graphics (8326 MiB, 7909 MiB free)\n  Vulkan1: NVIDIA GeForce RTX 4050 Laptop GPU (5920 MiB, 5152 MiB free)\n', stderr: '' };
  } });
  assert.deepEqual(device, { id: 'Vulkan1', name: 'NVIDIA GeForce RTX 4050 Laptop GPU' });
});

test('Metal, AMD and Intel GPUs are eligible without NVIDIA tools', async () => {
  for (const [id, name] of [['MTL0', 'Apple M2'], ['Metal0', 'Apple M2'], ['Vulkan0', 'AMD Radeon RX 7600'], ['Vulkan0', 'Intel(R) Arc(TM) A770 Graphics']]) {
    assert.deepEqual(await detectDevice('server', { run: async () => ({ stdout: `Available devices:\n  ${id}: ${name} (8192 MiB, 7000 MiB free)\n` }) }), { id, name });
  }
});

test('missing drivers, empty lists, RPC/CPU devices and malformed identifiers select CPU', async () => {
  for (const stdout of ['', 'Available devices:\n', 'Vulkan0: GPU without header', 'Available devices:\n  CPU: AMD Ryzen\n  RPC0: Remote GPU\n', 'Available devices:\n  Vulkan0;bad: GPU\n']) {
    assert.equal(await detectDevice('server', { run: async () => ({ stdout }) }), null);
  }
  for (const code of ['ENOENT', 'ETIMEDOUT']) assert.equal(await detectDevice('server', { run: async () => { throw Object.assign(new Error(code), { code }); } }), null);
});

test('caller cancellation propagates instead of becoming CPU fallback', async () => {
  const controller = new AbortController();
  const pending = detectDevice('server', { signal: controller.signal, run: async (_binary, _args, { signal }) => {
    assert.equal(signal, controller.signal); controller.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  } });
  await assert.rejects(pending, { name: 'AbortError' });
});
