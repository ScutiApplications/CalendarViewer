// Hosted model providers. Each adapter turns the assistant's neutral chat payload into the provider's request
// and the provider's answer back into { finish_reason, content, tool_calls }. No dependencies, no streaming.
// Required lazily: model-client requires this file too.
const fail = (status, detail) => new (require('./model-client').ServiceError)(status, detail);

// Model ids are defaults; the settings form can override them.
const PROVIDERS = {
  // MiniCPM5-2B GGUF run by llama.cpp's own server program, which CalendarViewer downloads and starts itself (see llama-engine.js).
  llamacpp: { label: 'Built-in MiniCPM5-2B (self-contained)', model: 'MiniCPM5-2B-Q4_K_M', origin: 'http://127.0.0.1', env: null },
  anthropic: { label: 'Anthropic', model: 'claude-haiku-5-5', origin: 'https://api.anthropic.com', env: 'ANTHROPIC_API_KEY' },
  openai: { label: 'OpenAI', model: 'luna-6', origin: 'https://api.openai.com', env: 'OPENAI_API_KEY' },
  gemini: { label: 'Google Gemini', model: 'gemini-3.8-flash', origin: 'https://generativelanguage.googleapis.com', env: 'GEMINI_API_KEY' }
};
// Providers reached over the internet with an API key (everything except the built-in model).
const isHosted = provider => provider !== 'llamacpp' && provider in PROVIDERS;
const needsKey = provider => !!PROVIDERS[provider]?.env;

const parseArgs = value => {
  if (value && typeof value === 'object') return value;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
};
const systemText = messages => messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
// Parallel tool results must share one turn, so neighbours with the same role merge.
const pushMerged = (list, role, parts) => { const last = list.at(-1); if (last?.role === role) last.content.push(...parts); else list.push({ role, content: [...parts] }); };

// Gemini accepts only an OpenAPI subset of JSON Schema.
const GEMINI_KEYS = ['type', 'description', 'properties', 'required', 'items', 'enum', 'nullable', 'minimum', 'maximum', 'minItems', 'maxItems'];
function geminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  const out = {};
  for (const key of GEMINI_KEYS) if (schema[key] !== undefined) out[key] = key === 'properties' ? Object.fromEntries(Object.entries(schema.properties).map(([name, value]) => [name, geminiSchema(value)])) : key === 'items' ? geminiSchema(schema.items) : schema[key];
  return out;
}
const hasProperties = parameters => parameters && Object.keys(parameters.properties || {}).length > 0;

const adapters = {
  // llama-server speaks the OpenAI chat format; `url` and `key` come from the running engine.
  llamacpp: {
    build(payload, { key, url }) {
      const spec = adapters.openai.build(payload, { key, model: 'minicpm' });
      const { max_completion_tokens, ...body } = spec.body;
      return { url: `${url}/v1/chat/completions`, headers: spec.headers, body: { ...body, max_tokens: payload.max_tokens || 1024, temperature: payload.temperature ?? 0, chat_template_kwargs: { enable_thinking: false } } };
    },
    parse: json => adapters.openai.parse(json)
  },
  anthropic: {
    // No temperature: current Claude models reject it as deprecated (HTTP 400).
    build({ messages, tools, max_tokens }, { key, model }) {
      const out = []; let ids = [], count = 0;
      for (const m of messages) {
        if (m.role === 'user') pushMerged(out, 'user', [{ type: 'text', text: m.content }]);
        else if (m.role === 'assistant') {
          const parts = m.content ? [{ type: 'text', text: m.content }] : [];
          ids = [];
          for (const call of m.tool_calls || []) { const id = 'call_' + (++count); ids.push(id); parts.push({ type: 'tool_use', id, name: call.name, input: parseArgs(call.arguments) }); }
          if (parts.length) pushMerged(out, 'assistant', parts);
        } else if (m.role === 'tool') pushMerged(out, 'user', [{ type: 'tool_result', tool_use_id: ids.shift() || 'call_0', content: m.content }]);
      }
      return {
        url: `${PROVIDERS.anthropic.origin}/v1/messages`,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: { model, max_tokens: max_tokens || 1024, system: systemText(messages), messages: out,
          ...(tools?.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}) }
      };
    },
    parse(json) {
      const blocks = Array.isArray(json?.content) ? json.content : [];
      const tool_calls = blocks.filter(b => b.type === 'tool_use').map(b => ({ name: b.name, arguments: b.input || {} }));
      const content = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      return { finish_reason: json?.stop_reason === 'max_tokens' ? 'length' : tool_calls.length ? 'tool_calls' : 'stop', content, tool_calls };
    }
  },
  openai: {
    build({ messages, tools, max_tokens }, { key, model }) {
      const out = []; let ids = [], count = 0;
      for (const m of messages) {
        if (m.role === 'assistant') {
          ids = [];
          const tool_calls = (m.tool_calls || []).map(call => { const id = 'call_' + (++count); ids.push(id); return { id, type: 'function', function: { name: call.name, arguments: JSON.stringify(parseArgs(call.arguments)) } }; });
          out.push({ role: 'assistant', content: m.content || null, ...(tool_calls.length ? { tool_calls } : {}) });
        } else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: ids.shift() || 'call_0', content: m.content });
        else out.push({ role: m.role, content: m.content });
      }
      // Reasoning models count hidden thinking against the limit, so the cap is generous. Temperature stays at the model default.
      return {
        url: `${PROVIDERS.openai.origin}/v1/chat/completions`,
        headers: { Authorization: `Bearer ${key}` },
        body: { model, messages: out, max_completion_tokens: Math.max(max_tokens || 0, 4096),
          ...(tools?.length ? { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}) }
      };
    },
    parse(json) {
      const choice = json?.choices?.[0];
      if (!choice?.message) throw fail(502, 'Empty reply from OpenAI.');
      const tool_calls = (choice.message.tool_calls || []).map(call => ({ name: call.function?.name, arguments: parseArgs(call.function?.arguments) }));
      return { finish_reason: choice.finish_reason === 'length' ? 'length' : tool_calls.length ? 'tool_calls' : 'stop', content: choice.message.content || '', tool_calls };
    }
  },
  gemini: {
    build({ messages, tools, max_tokens }, { key, model }) {
      const contents = []; let names = [];
      for (const m of messages) {
        if (m.role === 'user') pushMerged(contents, 'user', [{ text: m.content }]);
        else if (m.role === 'assistant') {
          const parts = m.content ? [{ text: m.content }] : [];
          names = [];
          // Gemini 3 needs the thought signature of a function call echoed back.
          for (const call of m.tool_calls || []) { names.push(call.name); parts.push({ functionCall: { name: call.name, args: parseArgs(call.arguments) }, ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) }); }
          if (parts.length) pushMerged(contents, 'model', parts);
        } else if (m.role === 'tool') pushMerged(contents, 'user', [{ functionResponse: { name: m.tool_name || names.shift() || 'tool', response: { result: m.content } } }]);
      }
      const declarations = (tools || []).map(t => ({ name: t.name, description: t.description, ...(hasProperties(t.parameters) ? { parameters: geminiSchema(t.parameters) } : {}) }));
      return {
        url: `${PROVIDERS.gemini.origin}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: { 'x-goog-api-key': key },
        body: { systemInstruction: { parts: [{ text: systemText(messages) }] }, contents: contents.map(c => ({ role: c.role, parts: c.content })), generationConfig: { maxOutputTokens: Math.max(max_tokens || 0, 4096) },
          ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}) }
      };
    },
    parse(json) {
      const candidate = json?.candidates?.[0];
      if (!candidate?.content) throw fail(502, json?.promptFeedback?.blockReason ? 'Blocked: ' + json.promptFeedback.blockReason : 'Empty reply from Gemini.');
      const parts = candidate.content.parts || [];
      const tool_calls = parts.filter(p => p.functionCall).map(p => ({ name: p.functionCall.name, arguments: p.functionCall.args || {}, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) }));
      const content = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
      return { finish_reason: candidate.finishReason === 'MAX_TOKENS' ? 'length' : tool_calls.length ? 'tool_calls' : 'stop', content, tool_calls };
    }
  }
};

// Gemini answers a bad key with 400, not 401. Map it so the UI says the key was rejected.
function errorStatus(provider, status, json) {
  if (provider === 'gemini' && status === 400 && /api key/i.test(String(json?.error?.message || ''))) return 401;
  return status;
}
const errorDetail = json => String(json?.error?.message || (typeof json?.error === 'string' ? json.error : '')).slice(0, 200);
module.exports = { PROVIDERS, isHosted, needsKey, adapters, errorStatus, errorDetail };
