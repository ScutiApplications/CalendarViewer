// Settings come from the web UI (data/assistant-config.json, mode 0600); environment variables override them.
// provider: llamacpp (MiniCPM5-2B run by a llama.cpp server program the app downloads itself) or a hosted provider
// (anthropic, openai, gemini) with an API key. `fallback` is '' or 'llamacpp': the built-in model that answers when the chosen
// hosted provider fails. Older saved settings that named the Scuti service or Ollama now mean the built-in model.
const { PROVIDERS } = require('./providers');
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/;
const oneLine = token => token.length <= 512 && !token.includes('\n') && !token.includes('\r');
const modelFor = (config, name) => {
  const model = typeof config.models?.[name] === 'string' && config.models[name] ? config.models[name] : PROVIDERS[name].model;
  if (!MODEL_ID.test(model)) throw new Error('Model name may use letters, digits and . _ : / - only.');
  return model;
};
const RETIRED = new Set(['scuti', 'local']);
function assistantConfig(config = {}, env = process.env) {
  let provider = env.ASSISTANT_PROVIDER || config.provider || 'llamacpp';
  if (RETIRED.has(provider)) provider = 'llamacpp';
  if (!(provider in PROVIDERS)) throw new Error('Provider must be llamacpp, anthropic, openai or gemini.');
  const enabled = env.CALENDAR_ASSISTANT_ENABLED === undefined ? config.enabled === true : env.CALENDAR_ASSISTANT_ENABLED === '1';
  const fallback = (config.fallback === true || config.fallback === 'llamacpp' || config.fallback === 'local') && provider !== 'llamacpp' ? 'llamacpp' : '';
  if (provider === 'llamacpp') return { enabled, provider, url: PROVIDERS.llamacpp.origin, token: '', model: PROVIDERS.llamacpp.model, fallback };
  const info = PROVIDERS[provider];
  const key = env[info.env] || (typeof config.keys?.[provider] === 'string' ? config.keys[provider] : '');
  if (!oneLine(key)) throw new Error('API key must be one line of at most 512 characters.');
  return { enabled, provider, url: info.origin, token: key, model: modelFor(config, provider), fallback };
}
// Settings the environment pins; the web UI shows them read-only. `token` is for the active provider, `tokens` for each.
function assistantLocks(env = process.env, provider = env.ASSISTANT_PROVIDER || 'llamacpp') {
  const tokens = Object.fromEntries(Object.entries(PROVIDERS).map(([name, info]) => [name, !!(info.env && env[info.env])]));
  return { enabled: env.CALENDAR_ASSISTANT_ENABLED !== undefined, provider: !!env.ASSISTANT_PROVIDER, token: !!tokens[provider], tokens };
}
module.exports = { assistantConfig, assistantLocks };
