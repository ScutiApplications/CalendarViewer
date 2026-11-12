const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelClient, ServiceError, ServiceUnreachable } = require('../src/server/model-client');
const payload = { messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'ping', description: 'x', parameters: { type: 'object', properties: {} } }] };
const answer = text => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }));
const hosted = fetch => createModelClient({ provider: 'openai', token: 'k', fetch });

test('three failures latch the client offline, and new settings clear the latch', async () => {
  let calls = 0;
  const client = hosted(async () => { calls++; throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
  for (let i = 0; i < 3; i++) await assert.rejects(client.chat(payload), e => e instanceof ServiceUnreachable && e.code === 'ECONNREFUSED');
  assert.equal(client.offline, true);
  await assert.rejects(client.chat(payload), /offline/);
  assert.equal(calls, 3);
  client.configure({ provider: 'openai', token: 'k' });
  assert.equal(client.offline, false);
});
test('provider statuses are preserved, a success resets the count, and a caller abort does not open the circuit', async () => {
  let mode = 'rate';
  const client = hosted(async () => mode === 'rate' ? new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429 }) : answer('ok'));
  await assert.rejects(client.chat(payload), e => e instanceof ServiceError && e.status === 429 && /slow down/.test(e.detail));
  mode = 'ok'; assert.equal((await client.chat(payload)).content, 'ok');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.chat(payload, { signal: controller.signal }));
  assert.equal(client.offline, false);
});
test('the timeout bounds a request and is reported as such', async () => {
  const client = createModelClient({ provider: 'openai', token: 'k', timeoutMs: 20, fetch: (url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(client.chat(payload), e => e instanceof ServiceUnreachable && e.code === 'timeout');
});
test('tools and schema cannot be combined', async () => {
  await assert.rejects(hosted(async () => answer('x')).chat({ ...payload, schema: {} }), /cannot be combined/);
});
test('health of a hosted provider only says whether a key is set; the built-in model asks its engine', async () => {
  assert.deepEqual(await hosted(async () => { throw new Error('unused'); }).health(), { ready: true, model: 'luna-6' });
  const builtin = createModelClient({ provider: 'llamacpp', engine: { state: async () => ({ installed: false }) } });
  assert.deepEqual(await builtin.health(), { ready: false, model: 'MiniCPM5-2B-Q4_K_M' });
  await assert.rejects(createModelClient({ provider: 'llamacpp' }).chat(payload), e => e instanceof ServiceUnreachable && e.code === 'engine');
});
