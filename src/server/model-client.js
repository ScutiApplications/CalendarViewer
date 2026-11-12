// Dependency-free model transport: the built-in llama.cpp model or a hosted provider. No request bodies or credentials are logged.
const { PROVIDERS, needsKey, adapters, errorStatus, errorDetail } = require('./providers');
class ServiceError extends Error {
  constructor(status, detail = '') { super(`Model service error (${status})${detail ? ': ' + detail : ''}`); this.status = status; this.detail = detail; }
}
class ServiceUnreachable extends Error {
  // code: why the request failed (ECONNREFUSED, ENOTFOUND, timeout, ...), shown to the user so a setup problem can be diagnosed.
  constructor(message = 'Model service unreachable.', code = '') { super(message); this.code = code; }
}
function createModelClient({ provider: initialProvider = 'llamacpp', model: initialModel = '', url: initialUrl = '', token: initialToken = '', fallback: initialFallback = '', engine = null, fetch: fetchImpl = global.fetch, timeoutMs = 240000 } = {}) {
  // `failures` counts the chosen provider; `backupFailures` the built-in model that can stand in for a hosted one.
  let failures = 0, backupFailures = 0, url = initialUrl, token = initialToken, provider = initialProvider, model = initialModel, fallback = initialFallback;
  const lanes = { primary: { get n() { return failures; }, set n(v) { failures = v; } }, backup: { get n() { return backupFailures; }, set n(v) { backupFailures = v; } } };
  // One non-streaming request through a provider adapter; the answer arrives whole. `lane` picks the failure counter.
  async function adaptedChat(target, payload, { signal } = {}, lane = 'primary') {
    const counter = lanes[lane];
    if (counter.n >= 3) throw new ServiceUnreachable('Assistant offline until the calendar server restarts.');
    signal?.throwIfAborted();
    const abort = new AbortController();
    const cancel = () => abort.abort(signal.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const adapter = adapters[target.provider];
      let { url: targetUrl, token: targetKey } = target;
      if (target.provider === 'llamacpp') {
        // The self-contained model program starts on the first question; this can take a few seconds.
        if (!engine) throw new ServiceUnreachable('The built-in model is not available here.', 'engine');
        try { const running = await engine.ensure(abort.signal); targetUrl = running.url; targetKey = running.key; }
        catch (e) { if (signal?.aborted) throw e; throw new ServiceUnreachable('The built-in model could not start: ' + String(e.message).slice(0, 160), 'engine'); }
      }
      const spec = adapter.build(payload, { key: targetKey, model: target.model || PROVIDERS[target.provider].model, url: targetUrl });
      let response;
      try {
        response = await fetchImpl(spec.url, { method: 'POST', redirect: 'error', signal: abort.signal, headers: { 'Content-Type': 'application/json', ...spec.headers }, body: JSON.stringify(spec.body) });
      } catch (e) { if (signal?.aborted) throw e; throw new ServiceUnreachable(undefined, abort.signal.aborted ? 'timeout' : String(e.cause?.code || e.cause?.message || e.message || e.name).slice(0, 80)); }
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error('Model response too large.');
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      if (!response.ok) throw new ServiceError(errorStatus(target.provider, response.status, json), errorDetail(json));
      const reply = adapter.parse(json);
      counter.n = 0; return reply;
    } catch (e) {
      if (signal?.aborted) throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
      counter.n++;
      throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); if (target.provider === 'llamacpp') engine?.touch(); }
  }
  // The built-in model is ready once its program and weights are on this PC.
  const builtinHealth = async () => ({ ready: !!engine && (await engine.state()).installed, model: PROVIDERS.llamacpp.model });
  const primary = () => ({ provider, model, url, token });
  const backupTarget = () => ({ provider: 'llamacpp', model: PROVIDERS.llamacpp.model, url: '', token: '' });
  // Only a hosted provider can fall back, and only to the built-in model.
  const canFallBack = () => !!fallback && provider !== 'llamacpp';
  // A hosted provider has no health endpoint; a key is all that can be checked without spending tokens.
  const primaryHealth = async () => provider === 'llamacpp' ? builtinHealth() : { ready: !!token, model: model || PROVIDERS[provider].model };
  const mark = reply => Object.assign(reply, { backup: true });
  return {
    // Offline only when the chosen provider is latched off and no working backup remains.
    get offline() { return failures >= 3 && !(canFallBack() && backupFailures < 3); },
    // New connection settings also clear the offline latch.
    configure: next => {
      provider = next.provider || 'llamacpp'; model = next.model || ''; url = next.url || ''; token = next.token || '';
      fallback = next.fallback || ''; failures = 0; backupFailures = 0;
    },
    // With a backup enabled, a provider that is down or has no usable key reports the built-in model instead.
    async health() {
      let failure, notReady;
      try {
        const result = await primaryHealth();
        if (result.ready || !canFallBack()) return result;
        notReady = result;
      } catch (e) { if (!canFallBack()) throw e; failure = e; }
      try { const result = await builtinHealth(); if (result.ready) return { ...result, backup: true }; } catch { /* keep the primary's failure */ }
      if (notReady) return notReady;
      throw failure;
    },
    async chat(payload, options) {
      if (payload.tools !== undefined && payload.schema !== undefined) throw new Error('tools and schema cannot be combined.');
      if (!canFallBack()) return adaptedChat(primary(), payload, options, 'primary');
      try {
        // A hosted provider without a key would only fail; skip it.
        if (needsKey(provider) && !token) throw new ServiceError(401, 'No API key set.');
        return await adaptedChat(primary(), payload, options, 'primary');
      } catch (e) {
        if (options?.signal?.aborted || e.name === 'AbortError') throw e;
        // Only provider-side failures fall back; a bad request would fail on the backup too.
        const providerSide = e instanceof ServiceUnreachable || (e instanceof ServiceError && (e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500));
        if (!providerSide) throw e;
        return mark(await adaptedChat(backupTarget(), payload, options, 'backup'));
      }
    }
  };
}
module.exports = { createModelClient, ServiceError, ServiceUnreachable };
