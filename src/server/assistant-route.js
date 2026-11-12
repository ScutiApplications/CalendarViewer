// Same-origin assistant routes, with independent limits and disconnect cancellation.
const { readBody, send, sendJson, SECURITY_HEADERS } = require('./http');
const { ServiceError, ServiceUnreachable, createModelClient } = require('./model-client');
const { assistantConfig, assistantLocks, cpuThreadLimit } = require('./assistant-config');
const { PROVIDERS, isHosted, needsKey } = require('./providers');
const Consent = require('../shared/privacy-consent');
// Remembered chat sent by the page: an optional summary and up to 3 recent exchanges. Throws when the shape is wrong; long text is cut.
function cleanMemory(value) {
  if (value === undefined) return { summary: '', turns: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  const { summary = '', turns = [] } = value;
  if (typeof summary !== 'string' || !Array.isArray(turns) || turns.some(t => typeof t?.question !== 'string' || typeof t?.answer !== 'string')) throw new Error('invalid');
  return { summary: summary.slice(0, 1500), turns: turns.slice(-3).map(t => ({ question: t.question.slice(0, 2000), answer: t.answer.slice(0, 1500) })) };
}
// The page's working hours (HH:MM, start and end different); anything else is ignored rather than refused.
function cleanHours(value) {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return value && time.test(value.start) && time.test(value.end) && value.start !== value.end ? { start: value.start, end: value.end } : undefined;
}
function createAssistantRoute({ config, client, assistant, refuseUnlessLocalAction, saved = {}, persist = () => {}, env = process.env, createClient = createModelClient, engine = null }) {
  let busy = false, lastStatus = { reachable: false, model: null }, activeController = null;
  // The token is write-only: it is never sent to the browser.
  const hostedNames = Object.keys(PROVIDERS).filter(isHosted);
  // Whether a credential exists for each provider (saved or from the environment), without revealing it.
  const credentialSet = name => needsKey(name) && !!(env[PROVIDERS[name].env] || saved.keys?.[name]);
  const view = () => ({
    cpuThreads: config.cpuThreads ?? 0,
    maxCpuThreads: cpuThreadLimit(),
    enabled: config.enabled, fallback: config.fallback || '', provider: config.provider, model: config.model, tokenSet: !!config.token,
    tokenSets: Object.fromEntries(Object.keys(PROVIDERS).map(name => [name, credentialSet(name)])),
    models: Object.fromEntries(hostedNames.map(name => [name, saved.models?.[name] || PROVIDERS[name].model])),
    labels: Object.fromEntries(Object.entries(PROVIDERS).map(([name, info]) => [name, info.label])),
    locked: assistantLocks(env, config.provider)
  });
  // Applies a settings request to a copy of the saved settings. A blank credential clears only when saving.
  function merge(body, clearOnEmpty) {
    const next = { ...saved };
    if (typeof body.enabled === 'boolean') next.enabled = body.enabled;
    if (body.cpuThreads !== undefined) next.cpuThreads = body.cpuThreads;
    if (typeof body.provider === 'string' && body.provider) next.provider = body.provider;
    const provider = next.provider || 'llamacpp';
    if (typeof body.token === 'string' && needsKey(provider)) {
      next.keys = { ...saved.keys };
      if (body.token) next.keys[provider] = body.token; else if (clearOnEmpty) delete next.keys[provider];
    }
    if (typeof body.model === 'string' && isHosted(provider)) {
      next.models = { ...saved.models };
      if (body.model.trim()) next.models[provider] = body.model.trim(); else delete next.models[provider];
    }
    return next;
  }
  // Parses a small JSON object body; on failure it answers 413/400 itself and returns null.
  async function readJson(req, res, limit, message) {
    try { const body = JSON.parse(await readBody(req, limit)); if (body && typeof body === 'object' && !Array.isArray(body)) return body; throw new Error('invalid'); }
    catch (e) { send(res, e.status === 413 ? 413 : 400, message); return null; }
  }
  // Checks the key typed in the form (not yet saved); a blank field falls back to the saved value.
  async function testConnection(req, res) {
    const body = await readJson(req, res, 4096, 'Send a JSON object with a token.');
    if (!body) return;
    let target;
    try { target = assistantConfig(merge(body, false), env); } catch (e) { return send(res, 400, e.message); }
    if (needsKey(target.provider) && !target.token) return sendJson(res, 200, { ok: false, reason: 'no-key' });
    if (isHosted(target.provider) && !Consent.valid(body.hostedConsent, target.provider)) return send(res, 403, 'Choose AI sharing consent for this provider before testing the connection.');
    // Readiness alone cannot verify credentials or tool support; a one-word chat with one tool does.
    const probe = { messages: [{ role: 'user', content: 'ping' }], tools: [{ name: 'ping', description: 'Unused.', parameters: { type: 'object', properties: {} } }], temperature: 0, max_tokens: 8 };
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    try {
      // The test checks the chosen provider alone, so a working backup cannot hide a broken key.
      const probeClient = createClient({ provider: target.provider, model: target.model, url: target.url, token: target.token, fallback: '', engine, timeoutMs: 30000 });
      const health = await probeClient.health();
      const model = String(health.model || '').slice(0, 120) || null;
      if (health.ready !== true) return sendJson(res, 200, { ok: false, reason: 'not-ready', model });
      await probeClient.chat(probe, { signal: controller.signal });
      // A passing check of the saved settings also clears the offline latch left by earlier failures.
      if (!Object.keys(body).some(key => key !== 'hostedConsent')) client.configure?.({ provider: config.provider, model: config.model, url: config.url, token: config.token, fallback: config.fallback });
      return sendJson(res, 200, { ok: true, model });
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ServiceError) {
        const reason = { 401: 'token-rejected', 403: 'token-rejected', 422: 'no-tools', 429: 'rate-limited', 503: 'not-ready' }[e.status] || 'service-error';
        return sendJson(res, 200, { ok: false, reason, status: e.status, ...(e.detail ? { detail: String(e.detail).slice(0, 200) } : {}) });
      }
      return sendJson(res, 200, { ok: false, reason: 'unreachable', ...(e instanceof ServiceUnreachable && e.code ? { code: e.code } : {}) });
    } finally { res.removeListener('close', cancel); }
  }
  async function saveSettings(req, res) {
    const body = await readJson(req, res, 4096, 'Send a JSON object with enabled and a token.');
    if (!body) return;
    return applySettings(body, res);
  }
  function applySettings(body, res) {
    const next = merge(body, true);
    let applied;
    try { applied = assistantConfig(next, env); } catch (e) { return send(res, 400, e.message); }
    try { persist(next); } catch { return send(res, 500, 'Could not save assistant settings.'); }
    for (const key of Object.keys(saved)) delete saved[key];
    Object.assign(saved, next);
    const providerChanged = config.provider !== applied.provider;
    if (providerChanged) activeController?.abort();
    Object.assign(config, applied);
    engine?.configure?.({ cpuThreads: applied.cpuThreads });
    if (providerChanged || applied.provider !== 'llamacpp') engine?.stop?.();
    client.configure?.({ provider: applied.provider, model: applied.model, url: applied.url, token: applied.token, fallback: applied.fallback });
    lastStatus = { reachable: false, model: null };
    return sendJson(res, 200, view());
  }
  // Which providers are set up: a key for hosted ones, a downloaded model for the built-in one.
  const HINTS = { llamacpp: 'Download the model in the assistant settings.' };
  async function availability() {
    const builtin = engine ? await engine.state().then(s => s.installed, () => false) : false;
    return Object.fromEntries(Object.keys(PROVIDERS).map(name => [name, name === 'llamacpp' ? builtin : credentialSet(name)]));
  }
  async function listProviders(res) {
    const ready = await availability();
    return sendJson(res, 200, { current: config.provider, locked: assistantLocks(env, config.provider).provider,
      items: Object.keys(PROVIDERS).map(name => ({ name, label: PROVIDERS[name].label, available: ready[name], hint: ready[name] ? '' : HINTS[name] || 'Add an API key in the assistant settings.' })) });
  }
  async function chooseProvider(req, res) {
    const body = await readJson(req, res, 1024, 'Send a JSON object with a provider name.');
    if (!body) return;
    const name = body.provider;
    if (typeof name !== 'string' || !(name in PROVIDERS)) return send(res, 400, 'Send a JSON object with a provider name.');
    if (assistantLocks(env, config.provider).provider) return send(res, 409, 'The provider is fixed by the server environment.');
    if (name !== config.provider && !(await availability())[name]) return send(res, 409, 'That provider is not set up yet. Set it up in the assistant settings.');
    return applySettings({ provider: name }, res);
  }
  async function handle(req, res) {
    if (refuseUnlessLocalAction(req, res)) return;
    const route = req.url.split('?')[0];
    if (route.startsWith('/api/assistant/builtin') && config.provider !== 'llamacpp') return send(res, 403, 'Select the built-in provider to download or use local models.');
    if (route === '/api/assistant/config') {
      if (req.method === 'GET') return sendJson(res, 200, view());
      if (req.method === 'PUT') return saveSettings(req, res);
      return send(res, 405, 'Use GET or PUT.');
    }
    if (route === '/api/assistant/builtin') return req.method === 'GET' ? sendJson(res, 200, engine ? await engine.state() : { supported: false, installed: false, pulling: null, error: '' }) : send(res, 405, 'Use GET.');
    if (route === '/api/assistant/builtin/pull') return req.method === 'POST' ? (engine ? sendJson(res, 200, await engine.startPull()) : send(res, 404, 'Built-in engine unavailable.')) : send(res, 405, 'Use POST.');
    if (route === '/api/assistant/providers') return req.method === 'GET' ? listProviders(res) : send(res, 405, 'Use GET.');
    if (route === '/api/assistant/provider') return req.method === 'POST' ? chooseProvider(req, res) : send(res, 405, 'Use POST.');
    if (route === '/api/assistant/test') return req.method === 'POST' ? testConnection(req, res) : send(res, 405, 'Use POST.');
    const statusRoute = route === '/api/assistant/status';
    if (statusRoute && req.method === 'GET') {
      if (config.enabled && !busy && !client.offline) {
        try { const health = await client.health(); lastStatus = { reachable: health.ready === true, model: String(health.model || '').slice(0, 120) || null, backup: health.backup === true }; }
        catch (e) { lastStatus = { reachable: false, model: null, tokenState: e instanceof ServiceError && e.status === 401 ? 'rejected' : undefined }; }
      }
      const builtinState = engine && config.provider === 'llamacpp' ? await engine.state().catch(() => null) : null;
      const acceleration = builtinState ? { backend: builtinState.backend || 'cpu', device: builtinState.device || null, accelerationError: builtinState.accelerationError || '' } : {};
      return sendJson(res, 200, { ...acceleration, load: builtinState?.load ? { ...builtinState.load, idleMinutes: builtinState.idleMinutes } : null, enabled: config.enabled, reachable: config.enabled && !client.offline && lastStatus.reachable, model: lastStatus.model, provider: config.provider, providerLabel: PROVIDERS[config.provider].label, backup: lastStatus.backup === true, fallback: config.fallback || '', tokenSet: !!config.token, tokenState: needsKey(config.provider) && !config.token && !lastStatus.backup ? 'missing' : lastStatus.tokenState, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, offline: client.offline });
    }
    if (statusRoute || req.method !== 'POST') return send(res, 405, 'Use GET for status or POST for a question.');
    if (!config.enabled) return send(res, 404, 'Assistant disabled.');
    if (busy) return send(res, 429, 'Assistant is busy. Stop the current answer first.');
    let question, memory, workingHours, hostedConsent;
    try {
      const body = JSON.parse(await readBody(req, 32768));
      question = body?.question;
      if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw new Error('invalid');
      memory = cleanMemory(body?.memory);
      workingHours = cleanHours(body?.workingHours);
      hostedConsent = body?.hostedConsent;
    } catch (e) { return send(res, e.status === 413 ? 413 : 400, 'Send a question of 1–2000 characters in a JSON object.'); }
    // Validate after the body is read: another tab may have switched the provider while it arrived.
    if (isHosted(config.provider) && !Consent.valid(hostedConsent, config.provider)) return send(res, 403, 'Choose AI sharing consent for the selected provider before sending a question.');
    if (busy) return send(res, 429, 'Assistant is busy.');
    busy = true;
    const controller = activeController = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    let pending = Promise.resolve(), queuedBytes = 0;
    const emit = value => {
      if (controller.signal.aborted || res.destroyed) return;
      const line = JSON.stringify(value) + '\n';
      const size = Buffer.byteLength(line);
      queuedBytes += size;
      if (queuedBytes > 1024 * 1024) { controller.abort(); return; }
      // A false write return is normal backpressure. Await its callback before the next write.
      pending = pending.then(() => new Promise(resolve => {
        if (controller.signal.aborted || res.destroyed) { queuedBytes -= size; resolve(); return; }
        res.write(line, error => { queuedBytes -= size; if (error) controller.abort(); resolve(); });
      })).catch(() => controller.abort());
    };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    res.flushHeaders();
    // Only the built-in model filters tools; hosted providers receive every tool.
    try { await assistant.answer(question.trim(), { emit, signal: controller.signal, memory, workingHours, filterTools: config.provider === 'llamacpp' }); lastStatus.reachable = true; }
    catch (e) {
      if (!controller.signal.aborted) {
        const offline = e instanceof ServiceUnreachable || client.offline;
        if (offline) lastStatus.reachable = false;
        const message = offline ? `Assistant offline${e.code ? ' (' + e.code + ')' : ''}. Check the model service; after three failures restart the calendar server.` :
          e instanceof ServiceError ? ([401, 403].includes(e.status) ? 'The model provider rejected the access token or API key. Update it under Calendar assistant in the sidebar.' : e.status === 429 ? 'The model provider is rate limiting requests. Try again shortly.' : `Model service error (${e.status})${e.detail ? ': ' + e.detail : ''}. Check the service, token and model name.`) :
            /token|empty|calendar|limit|invalid tool/i.test(e.message) ? e.message : 'Assistant could not finish this answer. Please try again.';
        emit({ type: 'error', message, offline });
      }
    } finally { await pending; res.removeListener('close', cancel); activeController = null; busy = false; res.end(); }
  }
  return handle;
}
module.exports = { createAssistantRoute };
