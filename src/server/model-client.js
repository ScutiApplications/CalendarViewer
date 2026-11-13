// @ts-check
// Dependency-free model transport: the built-in llama.cpp model or a hosted provider. No request bodies or credentials are logged.
const { PROVIDERS, adapters, errorStatus, errorDetail } = require('./providers');
class ServiceError extends Error {
  constructor(status, detail = '') { super(`Model service error (${status})${detail ? ': ' + detail : ''}`); this.status = status; this.detail = detail; }
}
class ServiceUnreachable extends Error {
  // code: why the request failed (ECONNREFUSED, ENOTFOUND, timeout, ...), shown to the user so a setup problem can be diagnosed.
  constructor(message = 'Model service unreachable.', code = '') { super(message); this.code = code; }
}
function createModelClient({ provider: initialProvider = 'llamacpp', model: initialModel = '', url: initialUrl = '', token: initialToken = '', engine = null, fetch: fetchImpl = global.fetch, timeoutMs = 240000 } = /** @type {{ provider?: string, model?: string, url?: string, token?: string, engine?: any, fetch?: typeof fetch, timeoutMs?: number, fallback?: unknown }} */ ({})) {
  let url = initialUrl, token = initialToken, provider = initialProvider, model = initialModel;
  const counter = { n: 0 };
  // Only the explicitly selected provider may answer. Hosted failures never start local models.
  async function adaptedChat(target, payload, { signal } = /** @type {{ signal?: AbortSignal }} */ ({})) {
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
  // A hosted provider has no health endpoint; a key is all that can be checked without spending tokens.
  const primaryHealth = async () => provider === 'llamacpp' ? builtinHealth() : { ready: !!token, model: model || PROVIDERS[provider].model };
  return {
    get offline() { return counter.n >= 3; },
    // New connection settings also clear the offline latch.
    configure: next => {
      provider = next.provider || 'llamacpp'; model = next.model || ''; url = next.url || ''; token = next.token || '';
      counter.n = 0;
    },
    health: primaryHealth,
    async chat(payload, options) {
      if (payload.tools !== undefined && payload.schema !== undefined) throw new Error('tools and schema cannot be combined.');
      return adaptedChat(primary(), payload, options);
    }
  };
}
module.exports = { createModelClient, ServiceError, ServiceUnreachable };
