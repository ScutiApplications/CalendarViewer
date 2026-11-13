// @ts-check
// Remembers which version ran last, so the page can show "What's new" after every update even when the browser's own
// storage was cleared or the app opens in a different browser. The state lives in the data folder, not in the browser.
const { readJson, writeJsonAtomic } = require('./json-store');
const { compare } = require('../shared/release-notes');

/** @param {{ file: string, version: string }} options */
function trackVersion({ file, version }) {
  const state = readJson(file, {});
  let announceFrom = typeof state.announceFrom === 'string' ? state.announceFrom : null;
  if (typeof state.lastRun === 'string' && compare(version, state.lastRun) === 1 && !announceFrom) announceFrom = state.lastRun;
  if (compare(version, '0.0.0') !== null && (state.lastRun !== version || announceFrom !== (state.announceFrom ?? null))) {
    try { writeJsonAtomic(file, { lastRun: version, ...(announceFrom ? { announceFrom } : {}) }, { mode: 0o600 }); } catch { /* The page falls back to its own storage. */ }
  }
  return {
    /** The version the person last ran before this update, until the notes are shown. */
    announceFrom: () => announceFrom,
    acknowledge() {
      announceFrom = null;
      try { writeJsonAtomic(file, { lastRun: version }, { mode: 0o600 }); } catch { /* Ignore. */ }
    }
  };
}

module.exports = { trackVersion };
