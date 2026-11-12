const test = require('node:test');
const assert = require('node:assert/strict');
const { adapters, errorStatus } = require('../src/server/providers');
const { createModelClient, ServiceError } = require('../src/server/model-client');
const { assistantConfig } = require('../src/server/assistant-config');

const tools = [{ name: 'list_events', description: 'List events.', parameters: { type: 'object', additionalProperties: false, properties: { start: { type: 'string', description: 'when' } } } }, { name: 'ping', description: 'Unused.', parameters: { type: 'object', properties: {} } }];
const messages = [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: 'Thursday?' },
  { role: 'assistant', tool_calls: [{ name: 'list_events', arguments: { start: 'thursday' } }, { name: 'ping', arguments: '{}' }] },
  { role: 'tool', tool_name: 'list_events', content: '{"a":1}' },
  { role: 'tool', tool_name: 'ping', content: '{"b":2}' },
  { role: 'user', content: 'Call the tool.' }
];
const payload = { messages, tools, temperature: 0, max_tokens: 1200 };

test('anthropic request: system split out, tool results share one user turn, ids pair up', () => {
  const { url, headers, body } = adapters.anthropic.build(payload, { key: 'k', model: 'claude-haiku-5-5' });
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual([headers['x-api-key'], headers['anthropic-version'], body.model, body.system], ['k', '2023-06-01', 'claude-haiku-5-5', 'Be brief.']);
  assert.deepEqual(body.messages.map(m => m.role), ['user', 'assistant', 'user']);
  const [use1, use2] = body.messages[1].content;
  assert.deepEqual([use1.type, use1.name, use1.input, use2.input], ['tool_use', 'list_events', { start: 'thursday' }, {}]);
  assert.deepEqual(body.messages[2].content.map(b => b.type === 'tool_result' ? b.tool_use_id : b.type), [use1.id, use2.id, 'text']);
  assert.equal(body.tools[0].input_schema.type, 'object');
  assert.equal('temperature' in body, false);
});
test('anthropic reply: text, tool calls and length', () => {
  assert.deepEqual(adapters.anthropic.parse({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'list_events', input: { start: 'today' } }] }),
    { finish_reason: 'tool_calls', content: 'x', tool_calls: [{ name: 'list_events', arguments: { start: 'today' } }] });
  assert.equal(adapters.anthropic.parse({ stop_reason: 'max_tokens', content: [] }).finish_reason, 'length');
  assert.equal(adapters.anthropic.parse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] }).content, 'Hi');
});
test('openai request: bearer key, stringified arguments, tool ids, no temperature', () => {
  const { url, headers, body } = adapters.openai.build(payload, { key: 'k', model: 'luna-6' });
  assert.deepEqual([url, headers.Authorization, body.model, body.temperature], ['https://api.openai.com/v1/chat/completions', 'Bearer k', 'luna-6', undefined]);
  assert.ok(body.max_completion_tokens >= 4096);
  const assistant = body.messages.find(m => m.role === 'assistant');
  assert.deepEqual([assistant.tool_calls[0].function.arguments, assistant.tool_calls[1].function.arguments], ['{"start":"thursday"}', '{}']);
  assert.deepEqual(body.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id), assistant.tool_calls.map(c => c.id));
  assert.equal(body.messages[0].role, 'system');
});
test('openai reply: parsed arguments and finish reasons', () => {
  const reply = adapters.openai.parse({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ function: { name: 'list_events', arguments: '{"start":"today"}' } }] } }] });
  assert.deepEqual(reply, { finish_reason: 'tool_calls', content: '', tool_calls: [{ name: 'list_events', arguments: { start: 'today' } }] });
  assert.equal(adapters.openai.parse({ choices: [{ finish_reason: 'length', message: { content: 'x' } }] }).finish_reason, 'length');
  assert.throws(() => adapters.openai.parse({}), ServiceError);
});
test('gemini request: key header, plain schema, empty tools omit parameters, signatures echoed', () => {
  const withSignature = structuredClone(messages); withSignature[2].tool_calls[0].thoughtSignature = 'sig';
  const { url, headers, body } = adapters.gemini.build({ ...payload, messages: withSignature }, { key: 'k', model: 'gemini-3.8-flash' });
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(headers['x-goog-api-key'], 'k');
  const [list, ping] = body.tools[0].functionDeclarations;
  assert.deepEqual(list.parameters, { type: 'object', properties: { start: { type: 'string', description: 'when' } } });
  assert.equal(ping.parameters, undefined);
  assert.deepEqual(body.contents.map(c => c.role), ['user', 'model', 'user']);
  assert.deepEqual([body.contents[1].parts[0].functionCall.name, body.contents[1].parts[0].thoughtSignature, body.contents[2].parts.length], ['list_events', 'sig', 3]);
  assert.equal(body.systemInstruction.parts[0].text, 'Be brief.');
});
test('gemini reply: function calls keep their signature; a blocked prompt fails; bad key maps to 401', () => {
  const reply = adapters.gemini.parse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'list_events', args: { start: 'today' } }, thoughtSignature: 's' }] } }] });
  assert.deepEqual(reply, { finish_reason: 'tool_calls', content: '', tool_calls: [{ name: 'list_events', arguments: { start: 'today' }, thoughtSignature: 's' }] });
  assert.equal(adapters.gemini.parse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'x' }] } }] }).finish_reason, 'length');
  assert.throws(() => adapters.gemini.parse({ promptFeedback: { blockReason: 'SAFETY' } }), /Blocked/);
  assert.equal(errorStatus('gemini', 400, { error: { message: 'API key not valid. Please pass a valid API key.' } }), 401);
  assert.equal(errorStatus('gemini', 400, { error: { message: 'bad schema' } }), 400);
});
test('client sends hosted requests, returns the parsed reply, and reports provider errors', async () => {
  const seen = [];
  const client = createModelClient({ provider: 'anthropic', model: 'claude-haiku-5-5', token: 'k', fetch: async (url, opts) => {
    seen.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return seen.length === 1 ? new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] })) : new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 });
  } });
  assert.deepEqual(await client.health(), { ready: true, model: 'claude-haiku-5-5' });
  assert.equal((await client.chat(payload)).content, 'ok');
  assert.equal(seen[0].headers['x-api-key'], 'k'); assert.equal(seen[0].headers['Content-Type'], 'application/json');
  await assert.rejects(client.chat(payload), e => e instanceof ServiceError && e.status === 401 && /invalid x-api-key/.test(e.detail));
  client.configure({ provider: 'openai', model: '', url: 'https://api.openai.com', token: '' });
  assert.equal((await client.health()).ready, false);
});
test('configuration for hosted providers uses default models, saved keys and environment keys', () => {
  assert.deepEqual(assistantConfig({ provider: 'anthropic', keys: { anthropic: 'a' } }, {}), { enabled: false, provider: 'anthropic', url: 'https://api.anthropic.com', token: 'a', model: 'claude-haiku-5-5', fallback: '' });
  assert.equal(assistantConfig({ provider: 'openai' }, {}).model, 'luna-6');
  assert.equal(assistantConfig({ provider: 'gemini' }, {}).model, 'gemini-3.8-flash');
  assert.equal(assistantConfig({ provider: 'openai', keys: { openai: 'saved' }, models: { openai: 'luna-6-mini' } }, { OPENAI_API_KEY: 'env' }).token, 'env');
  assert.equal(assistantConfig({ provider: 'openai', models: { openai: 'luna-6-mini' } }, {}).model, 'luna-6-mini');
  assert.equal(assistantConfig({ keys: { openai: 'x' } }, { ASSISTANT_PROVIDER: 'openai' }).provider, 'openai');
  assert.throws(() => assistantConfig({ provider: 'x' }, {}), /Provider/);
  assert.throws(() => assistantConfig({ provider: 'gemini', models: { gemini: 'a b' } }, {}), /Model name/);
});
test('the built-in model is the default, and retired providers (Scuti, Ollama) now mean it', () => {
  for (const provider of [undefined, 'scuti', 'local', 'llamacpp']) assert.equal(assistantConfig({ provider }, {}).provider, 'llamacpp');
  assert.equal(assistantConfig({ provider: 'openai', fallback: 'local' }, {}).fallback, 'llamacpp');
  assert.equal(assistantConfig({ provider: 'openai', fallback: true }, {}).fallback, 'llamacpp');
  assert.equal(assistantConfig({ provider: 'llamacpp', fallback: 'llamacpp' }, {}).fallback, '');
});

// The built-in engine stand-in answers in llama-server's OpenAI chat format.
const engine = { ensure: async () => ({ url: 'http://127.0.0.1:5', key: 'engine-key' }), touch() {}, state: async () => ({ installed: true }) };
const builtinReply = text => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }));
test('backup: a failing provider falls back to the built-in model and the reply says so', async () => {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url.includes('openai')) return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    return builtinReply('from built-in');
  };
  const client = createModelClient({ provider: 'openai', token: 'k', fallback: 'llamacpp', engine, fetch });
  const reply = await client.chat(payload);
  assert.deepEqual([reply.content, reply.backup, calls.length], ['from built-in', true, 2]);
  // Without the backup switch the provider's error stays visible.
  client.configure({ provider: 'openai', token: 'k', url: 'https://api.openai.com', fallback: '' });
  await assert.rejects(client.chat(payload), e => e instanceof ServiceError && e.status === 401);
  // A missing key skips the provider call entirely.
  calls.length = 0;
  client.configure({ provider: 'gemini', token: '', url: 'https://x', fallback: 'llamacpp' });
  assert.equal((await client.chat(payload)).backup, true);
  assert.deepEqual(calls, ['http://127.0.0.1:5/v1/chat/completions']);
});
test('backup: client errors do not fall back, an unreachable provider does, and health reports the backup', async () => {
  const bad = createModelClient({ provider: 'openai', token: 'k', fallback: 'llamacpp', engine, fetch: async () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }) });
  await assert.rejects(bad.chat(payload), e => e.status === 400);
  const down = createModelClient({ provider: 'openai', token: 'k', fallback: 'llamacpp', engine, fetch: async url => {
    if (url.includes('openai')) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    return builtinReply('backup answer');
  } });
  assert.equal((await down.chat(payload)).backup, true);
  const noKey = createModelClient({ provider: 'openai', token: '', fallback: 'llamacpp', engine, fetch: async () => { throw new Error('unused'); } });
  assert.deepEqual(await noKey.health(), { ready: true, model: 'MiniCPM5-2B-Q4_K_M', backup: true });
  const noModel = createModelClient({ provider: 'openai', token: '', fallback: 'llamacpp', engine: { ...engine, state: async () => ({ installed: false }) }, fetch: async () => { throw new Error('unused'); } });
  assert.deepEqual(await noModel.health(), { ready: false, model: 'luna-6' });
});
