// @ts-check
// Conservative per-tool decisions allow compound questions; any uncertainty keeps the entire catalog.
function createLayaRouter({ engine, enabled = () => true }) {
  async function select(question, definitions, { signal } = /** @type {{ signal?: AbortSignal }} */ ({})) {
    signal?.throwIfAborted();
    if (!enabled() || definitions.length < 2) return definitions;
    try {
      const result = await engine.predict(String(question).slice(0, 4000), definitions, { signal });
      signal?.throwIfAborted();
      if (result.usage?.truncated) return definitions;
      const selected = [];
      for (const definition of definitions) {
        const answer = result.answers?.[definition.name];
        if (!answer || !['A', 'B'].includes(answer.choice) || !Number.isFinite(answer.answer_confidence) || answer.answer_confidence < 0.95 || answer.answer_confidence > 1) return definitions;
        if (answer.choice === 'A') selected.push(definition);
      }
      return selected.length ? selected : definitions;
    } catch (error) { if (signal?.aborted || error.name === 'AbortError') throw error; return definitions; }
  }
  return { select };
}
module.exports = { createLayaRouter };
