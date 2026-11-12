const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAssistantRoute } = require('../src/server/assistant-route');
const { ServiceError, ServiceUnreachable } = require('../src/server/model-client');

async function fixture(t, enabled = true, answer, extra = {}) {
  let healthCalls = 0;
  const route = createAssistantRoute({ config: { enabled, provider: 'llamacpp', url: '' }, client: { offline: false, configure(next) { extra.configured = next; }, health: async () => { healthCalls++; return { ready: true, model: 'fake' }; } },
    assistant: { answer: answer || (async (q, { emit }) => { emit({ type: 'content', text: 'hello' }); emit({ type: 'done' }); }) },
    ...extra.route,
    refuseUnlessLocalAction(req, res) {
      if (req.headers['x-calendar-action'] === '1' && req.headers.host === `127.0.0.1:${server.address().port}` && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`)) return false;
      res.writeHead(403).end('Forbidden'); return true;
    } });
  const server = http.createServer((req, res) => route(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = async (path, options = {}) => {
    if (options.headers?.Host) return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method: options.method || 'GET', headers: { 'X-Calendar-Action': '1', ...options.headers } }, res => { res.resume(); resolve({ status: res.statusCode }); });
      req.on('error', reject); req.end(options.body);
    });
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...options, headers: { 'X-Calendar-Action': '1', ...options.headers } });
  };
  return { request, healthCalls: () => healthCalls };
}
test('assistant route refuses foreign origin/host and missing action header', async t => {
  const { request } = await fixture(t);
  for (const headers of [{ Origin: 'https://evil.example' }, { Host: 'evil.example' }, { 'X-Calendar-Action': '' }]) {
    for (const [path, method] of [['/api/assistant/status', 'GET'], ['/api/assistant', 'POST']]) assert.equal((await request(path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) })).status, 403);
  }
});
test('disabled route makes no model calls; enabled status and stream work', async t => {
  const off = await fixture(t, false);
  assert.equal((await (await off.request('/api/assistant/status')).json()).enabled, false);
  assert.equal((await off.request('/api/assistant', { method: 'POST', body: '{"question":"x"}' })).status, 404);
  assert.equal(off.healthCalls(), 0);
  const on = await fixture(t);
  assert.equal((await (await on.request('/api/assistant/status')).json()).model, 'fake');
  const response = await on.request('/api/assistant', { method: 'POST', body: '{"question":"Thursday?"}' });
  assert.match(response.headers.get('content-type'), /ndjson/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await response.text(), /"type":"done"/);
});
test('invalid/oversized bodies and unsupported methods are rejected', async t => {
  const { request } = await fixture(t);
  for (const body of ['{', '{}', '{"question":4}', '{"question":""}', JSON.stringify({ question: 'x'.repeat(2001) })]) assert.equal((await request('/api/assistant', { method: 'POST', body })).status, 400);
  assert.equal((await request('/api/assistant', { method: 'POST', body: 'x'.repeat(40000) })).status, 413);
  assert.equal((await request('/api/assistant')).status, 405);
});
test('busy requests are refused and disconnect aborts upstream work', async t => {
  let aborted; const didAbort = new Promise(resolve => { aborted = resolve; });
  const { request } = await fixture(t, true, async (q, { emit, signal }) => {
    emit({ type: 'content', text: 'starting' });
    await new Promise(resolve => signal.addEventListener('abort', () => { aborted(); resolve(); }, { once: true }));
  });
  const controller = new AbortController();
  const response = await request('/api/assistant', { method: 'POST', body: '{"question":"x"}', signal: controller.signal });
  assert.equal((await request('/api/assistant', { method: 'POST', body: '{"question":"y"}' })).status, 429);
  controller.abort(); await didAbort;
  assert.equal(response.status, 200);
});

test('normal stream backpressure preserves larger source records and final done', async t => {
  const { request } = await fixture(t, true, async (q, { emit, signal }) => {
    for (let i = 0; i < 10; i++) emit({ type: 'sources', data: 'x'.repeat(12000) });
    assert.equal(signal.aborted, false);
    emit({ type: 'content', text: 'Finished' }); emit({ type: 'done' });
  });
  const response = await request('/api/assistant', { method: 'POST', body: '{"question":"x"}' });
  const body = await response.text();
  assert.equal(body.split('\n').filter(s => s.includes('"type":"sources"')).length, 10);
  assert.match(body, /"type":"done"/);
});

test('real server wiring protects routes, defaults to the built-in model and reports it missing without failing', async t => {
  const { spawn } = require('node:child_process');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-integration-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'assistant-config.json'), '{"provider":"scuti"}'); // unknown saved provider falls back to the built-in model
  const child = spawn(process.execPath, [path.resolve('src/server/server.js')], { env: { ...process.env, PORT: '3992', CALENDAR_ASSISTANT_ENABLED: '1', ASSISTANT_PROVIDER: '', CALENDAR_DATA_DIR: dataDir }, stdio: 'pipe' });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('ICS viewer')) resolve(); }); child.on('error', reject); child.on('exit', code => reject(new Error('Server exited ' + code))); });
  const request = (route, method = 'GET', body, extra = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 3992, path: route, method, headers: { 'X-Calendar-Action': '1', ...extra } }, res => { let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text })); });
    req.on('error', reject); req.end(body);
  });
  for (const headers of [{ Host: 'evil.example' }, { Origin: 'https://evil.example' }, { 'X-Calendar-Action': '' }]) assert.equal((await request('/api/assistant/status', 'GET', undefined, headers)).status, 403);
  const status = JSON.parse((await request('/api/assistant/status')).text);
  assert.deepEqual([status.provider, status.reachable], ['llamacpp', false]);
  const stream = await request('/api/assistant', 'POST', JSON.stringify({ question: 'What is on my plate Thursday?' }));
  assert.equal(stream.status, 200); assert.match(stream.text, /"type":"error"/);
  assert.equal((await request('/api/assistant', 'POST', 'x'.repeat(40000))).status, 413);
  assert.equal((await request('/api/assistant/local')).status, 404);
});

test('settings save from the web UI, hide the key and respect environment locks', async t => {
  const extra = { route: { saved: {}, env: {}, persist(value) { extra.persisted = JSON.parse(JSON.stringify(value)); } } };
  const { request } = await fixture(t, false, undefined, extra);
  const put = body => request('/api/assistant/config', { method: 'PUT', body: JSON.stringify(body) });
  const ok = await put({ enabled: true, provider: 'openai', token: 'secret' });
  const view = await ok.json();
  assert.deepEqual([ok.status, view.enabled, view.provider, view.tokenSet, JSON.stringify(view).includes('secret')], [200, true, 'openai', true, false]);
  assert.deepEqual(extra.persisted, { enabled: true, provider: 'openai', keys: { openai: 'secret' } });
  assert.equal((await (await request('/api/assistant/status')).json()).enabled, true);
  assert.equal((await put({ token: 'a\nb' })).status, 400);
  assert.equal((await (await put({ token: '' })).json()).tokenSet, false);
  assert.equal((await request('/api/assistant/config', { method: 'PUT', headers: { Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  extra.route.env.ASSISTANT_PROVIDER = 'gemini';
  const locked = await (await put({ provider: 'openai' })).json();
  assert.deepEqual([locked.provider, locked.locked.provider], ['gemini', true]);
});

test('test connection checks health and a tool chat with the typed key, without saving', async t => {
  const calls = [];
  const health = { ready: true, model: 'luna-6' };
  const plans = { ok: { health: async () => health, chat: async () => ({ finish_reason: 'stop' }) }, notReady: { health: async () => ({ ready: false, model: 'luna-6' }) },
    rejected: { health: async () => health, chat: async () => { throw new ServiceError(401); } }, down: { health: async () => { throw new ServiceUnreachable(undefined, 'ECONNREFUSED'); } },
    noTools: { health: async () => health, chat: async () => { throw new ServiceError(422); } }, limited: { health: async () => health, chat: async () => { throw new ServiceError(429); } },
    broken: { health: async () => health, chat: async () => { throw new ServiceError(500); } } };
  let plan = 'ok';
  const extra = { route: { saved: { provider: 'openai', keys: { openai: 'kept' } }, env: {}, persist() { throw new Error('must not save'); }, createClient: options => { calls.push(options); return plans[plan]; } } };
  const { request } = await fixture(t, false, undefined, extra);
  const test = body => request('/api/assistant/test', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json().then(j => [r.status, j]));
  assert.deepEqual(await test({}), [200, { ok: true, model: 'luna-6' }]);
  assert.equal(calls[0].token, 'kept');
  plan = 'notReady'; assert.deepEqual(await test({ token: 'new' }), [200, { ok: false, reason: 'not-ready', model: 'luna-6' }]);
  assert.equal(calls[1].token, 'new');
  for (const [name, expected] of [['rejected', { ok: false, reason: 'token-rejected', status: 401 }], ['down', { ok: false, reason: 'unreachable', code: 'ECONNREFUSED' }],
    ['noTools', { ok: false, reason: 'no-tools', status: 422 }], ['limited', { ok: false, reason: 'rate-limited', status: 429 }], ['broken', { ok: false, reason: 'service-error', status: 500 }]]) {
    plan = name; assert.deepEqual(await test({}), [200, expected]);
  }
  assert.equal((await request('/api/assistant/test')).status, 405);
  assert.equal((await request('/api/assistant/test', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' })).status, 403);
});

test('hosted providers: keys are saved per provider, never returned, and the model name is editable', async t => {
  const extra = { route: { saved: {}, env: {}, persist(value) { extra.persisted = JSON.parse(JSON.stringify(value)); } } };
  const { request } = await fixture(t, false, undefined, extra);
  const put = body => request('/api/assistant/config', { method: 'PUT', body: JSON.stringify(body) });
  const view = await (await put({ enabled: true, provider: 'anthropic', token: 'sk-ant-test' })).json();
  assert.deepEqual([view.provider, view.model, view.tokenSet, view.tokenSets.anthropic, view.tokenSets.openai, JSON.stringify(view).includes('sk-ant-test')], ['anthropic', 'claude-haiku-5-5', true, true, false, false]);
  assert.deepEqual(extra.configured, { provider: 'anthropic', model: 'claude-haiku-5-5', url: 'https://api.anthropic.com', token: 'sk-ant-test', fallback: '' });
  assert.deepEqual(extra.persisted.keys, { anthropic: 'sk-ant-test' });
  const openai = await (await put({ provider: 'openai', token: 'sk-oa', model: 'luna-6-mini' })).json();
  assert.deepEqual([openai.model, openai.models.openai, openai.tokenSets.anthropic, openai.tokenSets.openai], ['luna-6-mini', 'luna-6-mini', true, true]);
  assert.equal((await put({ provider: 'gemini', model: 'bad model!' })).status, 400);
  assert.equal((await put({ provider: 'nope' })).status, 400);
  const back = await (await put({ provider: 'llamacpp' })).json();
  assert.deepEqual([back.provider, back.tokenSet], ['llamacpp', false]);
  const cleared = await (await put({ provider: 'openai', token: '' })).json();
  assert.deepEqual([cleared.tokenSets.openai, cleared.tokenSets.anthropic], [false, true]);
  extra.route.env.GEMINI_API_KEY = 'from-env';
  const locked = await (await put({ provider: 'gemini' })).json();
  assert.deepEqual([locked.tokenSet, locked.locked.token, locked.locked.tokens.gemini, locked.locked.tokens.openai], [true, true, true, false]);
});

test('test connection for a hosted provider needs a key and probes with the typed key and model', async t => {
  const probes = [];
  const extra = { route: { saved: {}, env: {}, createClient: options => { probes.push(options); return { health: async () => ({ ready: !!options.token, model: options.model }), chat: async () => ({ finish_reason: 'stop' }) }; } } };
  const { request } = await fixture(t, true, undefined, extra);
  const test = body => request('/api/assistant/test', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
  assert.deepEqual(await test({ provider: 'openai' }), { ok: false, reason: 'no-key' });
  assert.deepEqual(await test({ provider: 'gemini', token: 'k', model: 'gemini-x' }), { ok: true, model: 'gemini-x' });
  assert.deepEqual([probes.length, probes[0].provider, probes[0].token, probes[0].model], [1, 'gemini', 'k', 'gemini-x']);
});

test('the built-in model needs no key, can be a backup, and reports its download state', async t => {
  const calls = [];
  const engine = { state: async () => ({ supported: true, installed: false, pulling: null }), startPull: async () => { calls.push('pull'); return { pulling: { percent: 0, status: 'starting' } }; } };
  const extra = { route: { saved: {}, env: {}, engine, persist() {} } };
  const { request } = await fixture(t, false, undefined, extra);
  const put = body => request('/api/assistant/config', { method: 'PUT', body: JSON.stringify(body) });
  const view = await (await put({ enabled: true, provider: 'llamacpp', token: 'ignored' })).json();
  assert.deepEqual([view.provider, view.tokenSet, view.fallback, view.tokenSets.llamacpp], ['llamacpp', false, '', false]);
  const backed = await (await put({ provider: 'openai', token: 'k', fallback: true })).json();
  assert.deepEqual([backed.fallback, extra.configured.fallback], ['llamacpp', 'llamacpp']);
  assert.equal((await (await put({ provider: 'llamacpp', fallback: true })).json()).fallback, '');
  assert.deepEqual(await (await request('/api/assistant/builtin')).json(), { supported: true, installed: false, pulling: null });
  assert.equal((await request('/api/assistant/builtin/pull', { method: 'POST' })).status, 200);
  assert.deepEqual(calls, ['pull']);
  assert.equal((await request('/api/assistant/builtin/pull')).status, 405);
});

test('remembered chat is validated, trimmed to 3 exchanges and passed to the assistant', async t => {
  let seenMemory;
  const { request } = await fixture(t, true, async (q, { emit, memory }) => { seenMemory = memory; emit({ type: 'done' }); });
  const turns = [1, 2, 3, 4].map(i => ({ question: 'q' + i, answer: 'a'.repeat(3000) }));
  assert.equal((await request('/api/assistant', { method: 'POST', body: JSON.stringify({ question: 'x', memory: { summary: 's', turns } }) })).status, 200);
  assert.equal(seenMemory.turns.length, 3); assert.equal(seenMemory.turns[0].question, 'q2'); assert.equal(seenMemory.turns[0].answer.length, 1500);
  await request('/api/assistant', { method: 'POST', body: '{"question":"x"}' });
  assert.deepEqual(seenMemory, { summary: '', turns: [] });
  for (const memory of [5, { summary: 4 }, { turns: 'x' }, { turns: [{ question: 1, answer: 'a' }] }]) assert.equal((await request('/api/assistant', { method: 'POST', body: JSON.stringify({ question: 'x', memory }) })).status, 400);
});

test('provider list marks which providers are set up; switching to one that is not set up is refused', async t => {
  const saved = { provider: 'anthropic', keys: { anthropic: 'sk-test' } };
  const config = { enabled: true, provider: 'anthropic', url: 'https://api.anthropic.com' };
  const persisted = [];
  const { request } = await fixture(t, true, undefined, { route: { saved, config, persist: v => persisted.push(v), env: {}, engine: { state: async () => ({ installed: true }) } } });
  const list = await (await request('/api/assistant/providers')).json();
  const ready = Object.fromEntries(list.items.map(i => [i.name, i.available]));
  assert.deepEqual(ready, { llamacpp: true, anthropic: true, openai: false, gemini: false });
  assert.equal(list.current, 'anthropic');
  assert.equal((await request('/api/assistant/provider', { method: 'POST', body: '{"provider":"openai"}' })).status, 409);
  assert.equal((await request('/api/assistant/provider', { method: 'POST', body: '{"provider":"scuti"}' })).status, 400);
  assert.equal((await request('/api/assistant/provider', { method: 'POST', body: '{"provider":"nope"}' })).status, 400);
  assert.equal((await request('/api/assistant/provider', { method: 'POST', body: '{"provider":"llamacpp"}' })).status, 200);
  assert.equal(persisted.at(-1).provider, 'llamacpp');
});

test('built-in status exposes automatic backend selection and fallback diagnostics', async t => {
  const { request } = await fixture(t, true, undefined, { route: { engine: { state: async () => ({ installed: true, backend: 'vulkan', device: 'NVIDIA RTX 4050', accelerationError: '' }) } } });
  const status = await (await request('/api/assistant/status')).json();
  assert.equal(status.backend, 'vulkan');
  assert.equal(status.device, 'NVIDIA RTX 4050');
  assert.equal(status.accelerationError, '');
});

test('CPU thread setting is validated, persisted, returned and applied to the engine', async t => {
  const { cpuThreadLimit } = require('../src/server/assistant-config');
  const threads = Math.min(6, cpuThreadLimit());
  const saved = {}, persisted = [], configured = [];
  const { request } = await fixture(t, true, undefined, { route: { saved, env: {}, persist: next => persisted.push(next), engine: { configure: next => configured.push(next) } } });
  const response = await request('/api/assistant/config', { method: 'PUT', body: JSON.stringify({ cpuThreads: threads }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cpuThreads, threads);
  assert.equal(persisted[0].cpuThreads, threads);
  assert.equal(configured[0].cpuThreads, threads);
  for (const cpuThreads of [-1, cpuThreadLimit() + 1, '6', null]) {
    assert.equal((await request('/api/assistant/config', { method: 'PUT', body: JSON.stringify({ cpuThreads }) })).status, 400);
  }
  assert.equal(persisted.length, 1);
});

test('CPU capacity comes from the server and cannot be overridden by a request', async t => {
  const { cpuThreadLimit } = require('../src/server/assistant-config');
  const { request } = await fixture(t);
  const max = cpuThreadLimit();
  assert.equal((await (await request('/api/assistant/config')).json()).maxCpuThreads, max);
  const response = await request('/api/assistant/config', { method: 'PUT', body: JSON.stringify({ cpuThreads: max + 1, maxCpuThreads: max + 1 }) });
  assert.equal(response.status, 400);
});
