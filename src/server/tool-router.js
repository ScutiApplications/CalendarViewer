// Optional tool filter. Laya (a small classifier service, default http://127.0.0.1:9120) reads the question and says which tools
// it needs, so the model is sent only those definitions: fewer tokens and fewer wrong calls for a small model. Anything that
// goes wrong (service off, slow, odd answer, nothing chosen) sends every tool, so filtering can never remove the answer.
const FAILURE_LIMIT = 3;
function createToolRouter({ url, token = '', fetch: fetchImpl = global.fetch, timeoutMs = 3000 }) {
  let failures = 0;
  async function select(question, definitions) {
    if (!url || failures >= FAILURE_LIMIT || definitions.length < 2) return definitions;
    const questions = Object.fromEntries(definitions.map(tool => [tool.name, { type: 'boolean',
      instructions: 'Does answering the text need this calendar tool? Answer true only if it is clearly needed.', criteria: String(tool.description || '').slice(0, 300) }]));
    try {
      const response = await fetchImpl(url.replace(/\/+$/, '') + '/v1/ask', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Internal-Token': token } : {}) }, body: JSON.stringify({ text: String(question).slice(0, 2000), questions }) });
      if (!response.ok) throw new Error('status ' + response.status);
      const answers = (await response.json())?.answers;
      if (!answers || typeof answers !== 'object') throw new Error('no answers');
      failures = 0;
      const wanted = tool => { const a = answers[tool.name]; return a === true || a?.value === true || a?.answer === true; };
      const chosen = definitions.filter(wanted);
      return chosen.length ? chosen : definitions;
    } catch { failures++; return definitions; }
  }
  return { select };
}

// Built-in router: one short, tool-free call to the same model picks the tool names. No extra service is needed.
const ROUTER_PROMPT = 'Pick the calendar tools needed to answer the user text. Reply with only the tool names, comma separated, nothing else. Pick as few as possible.';
function createModelRouter({ client }) {
  async function select(question, definitions, { signal } = {}) {
    if (definitions.length < 2) return definitions;
    const list = definitions.map(t => `${t.name}: ${String(t.description || '').slice(0, 160)}`).join('\n');
    try {
      const reply = await client.chat({ messages: [{ role: 'system', content: `${ROUTER_PROMPT}\nTools:\n${list}` }, { role: 'user', content: String(question).slice(0, 2000) }],
        project: 'calendarviewer', thinking: false, temperature: 0, max_tokens: 60, stream: false }, { signal });
      const names = new Set(String(reply?.content || '').toLowerCase().match(/[a-z_]+/g) || []);
      const chosen = definitions.filter(t => names.has(t.name));
      return chosen.length ? chosen : definitions;
    } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; return definitions; }
  }
  return { select };
}
module.exports = { createToolRouter, createModelRouter };
