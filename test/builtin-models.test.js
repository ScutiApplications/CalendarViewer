const test = require('node:test');
const assert = require('node:assert/strict');
const { createBuiltinModels } = require('../src/server/builtin-models');
const { createLayaRouter } = require('../src/server/tool-router');
const { createModelClient } = require('../src/server/model-client');

test('one download installs both components, and readiness requires both models', async () => {
  const calls = []; let mini = false, laya = false;
  const models = createBuiltinModels({ selected: () => true,
    minicpm: { state: async () => ({ supported: true, installed: mini, backend: 'cpu' }), startPull: async () => { calls.push('minicpm'); mini = true; } },
    laya: { state: async () => ({ supported: true, installed: laya }), startPull: async () => { calls.push('laya'); laya = true; } }
  });
  assert.equal((await models.state()).installed, false);
  await models.startPull();
  for (let n = 0; n < 50 && (await models.state()).pulling; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await models.state()).installed, true);
  assert.deepEqual(calls, ['laya', 'minicpm']);
});

test('hosted selection cannot download, start or invoke local models', async () => {
  const fail = () => { throw new Error('local model must not run'); };
  const models = createBuiltinModels({ selected: () => false, minicpm: { startPull: fail, ensure: fail }, laya: { startPull: fail, predict: fail } });
  await assert.rejects(models.startPull(), /built-in/i);
  await assert.rejects(models.ensure(), /built-in/i);
  const defs = [{ name: 'a' }, { name: 'b' }];
  assert.equal(await createLayaRouter({ engine: { predict: fail }, enabled: () => false }).select('question', defs), defs);
  let localCalls = 0;
  const client = createModelClient({ provider: 'openai', token: 'bad', fallback: 'llamacpp', engine: { touch() {}, ensure: async () => { localCalls++; return { url: 'http://127.0.0.1:29990', key: 'test' }; }, state: async () => { localCalls++; return { installed: true }; } },
    fetch: async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }) });
  await assert.rejects(client.chat({ messages: [] }), /401/);
  assert.equal(localCalls, 0);
  assert.equal((await client.health()).model, 'luna-6');
});

test('Laya chooses multiple declared tools, with full-tool fallback on uncertainty or failure', async () => {
  const defs = [{ name: 'list_events' }, { name: 'find_free_time' }, { name: 'conflicts' }];
  const result = { answers: { list_events: { choice: 'A', answer_confidence: 0.99 }, find_free_time: { choice: 'A', answer_confidence: 0.99 }, conflicts: { choice: 'B', answer_confidence: 0.99 } } };
  const engine = { predict: async () => result };
  const router = createLayaRouter({ engine });
  assert.deepEqual((await router.select('meetings and free time', defs)).map(d => d.name), ['list_events', 'find_free_time']);
  result.answers.conflicts.answer_confidence = 0.6;
  assert.equal(await router.select('question', defs), defs);
  result.answers.conflicts.answer_confidence = 0.99; result.usage = { truncated: true };
  assert.equal(await router.select('question', defs), defs);
  engine.predict = async () => { throw new Error('worker failed'); };
  assert.equal(await router.select('question', defs), defs);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(router.select('question', defs, { signal: controller.signal }), { name: 'AbortError' });
});

test('switching provider during readiness checks cannot start a local model afterward', async () => {
  let selected = true, release, starts = 0;
  const ready = new Promise(resolve => { release = resolve; });
  const models = createBuiltinModels({ selected: () => selected, laya: { state: () => ready, stop() {} }, minicpm: { ensure: async () => { starts++; }, stop() {} } });
  const pending = models.ensure(); selected = false; models.stop(); release({ installed: true });
  await assert.rejects(pending, /built-in|stopped/i); assert.equal(starts, 0);
});
