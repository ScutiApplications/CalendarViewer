// Tool filter: one short, tool-free call to the same model picks the tool names, so the real call is sent only those
// definitions: fewer tokens and fewer wrong calls for a small model. Anything that goes wrong (model off, odd answer,
// nothing chosen) sends every tool, so filtering can never remove the answer.
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
module.exports = { createModelRouter };
