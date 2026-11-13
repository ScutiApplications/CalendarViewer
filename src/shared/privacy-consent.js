// @ts-check
// Shared notice contract: changing the disclosure requires a new revision and a fresh choice.
(function (root) {
  const REVISION = '2026-11-12';
  const LABELS = Object.freeze({ anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google Gemini' });
  const POLICIES = Object.freeze({
    anthropic: 'https://platform.claude.com/docs/en/build-with-claude/api-and-data-retention',
    openai: 'https://developers.openai.com/api/docs/guides/your-data',
    gemini: 'https://ai.google.dev/gemini-api/terms'
  });
  const hosted = provider => Object.hasOwn(LABELS, provider);
  const valid = (value, provider) => hosted(provider) && value?.accepted === true && value.provider === provider && value.revision === REVISION;
  const api = Object.freeze({ REVISION, LABELS, POLICIES, hosted, valid });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalendarConsent = api;
})(globalThis);
