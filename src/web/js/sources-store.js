// Saving and restoring calendars, feed preferences and the feed cache in localStorage.
function localSourceSnapshots() {
  return sources.filter(s => !s.feedId && s.icsText).map(s => ({
    name: s.name, color: s.color, enabled: s.enabled, icsText: s.icsText, alertKey: s.alertKey
  }));
}

function feedPreferenceSnapshots() {
  return sources.filter(s => s.feedId).map(s => ({ feedId: s.feedId, name: s.name, color: s.color, enabled: s.enabled }));
}

function saveLocalSources() {
  store.set(LOCAL_SOURCES_KEY, JSON.stringify(localSourceSnapshots()), 'Could not save local calendars');
  saveFeedPreferences();
  scheduleAlertSync();
}

function saveFeedPreferences() {
  const prefs = new Map(store.list(FEED_PREFERENCES_KEY).filter(s => s && typeof s.feedId === 'string').map(s => [s.feedId, s]));
  feedPreferenceSnapshots().forEach(s => prefs.set(s.feedId, s));
  store.set(FEED_PREFERENCES_KEY, JSON.stringify([...prefs.values()]), 'Could not save calendar preferences');
}

function feedPreference(feedId) {
  return store.list(FEED_PREFERENCES_KEY).find(s => s && s.feedId === feedId) || {};
}

function restoreLocalSources() {
  store.list(LOCAL_SOURCES_KEY).forEach(s => {
    if (!s || typeof s.icsText !== 'string' || typeof s.alertKey !== 'string') return;
    try {
      sources.push({
        id: nextId++, name: String(s.name || 'Local calendar'), color: s.color || PALETTE[sources.length % PALETTE.length],
        enabled: s.enabled !== false, events: parseIcs(s.icsText), icsText: s.icsText, alertKey: s.alertKey
      });
    } catch { /* Ignore a saved calendar that can no longer be read. */ }
  });
}

const readFeedCache = () => store.list(FEED_CACHE_KEY);
const writeFeedCache = cached => store.set(FEED_CACHE_KEY, JSON.stringify(cached), 'Could not save calendar cache');

function cacheFeedSnapshot(feed, icsText) {
  const cached = readFeedCache().filter(s => s.feedId !== feed.id);
  cached.push({ feedId: feed.id, name: feed.name, color: feed.color, icsText, fetchedAt: Date.now() });
  writeFeedCache(cached);
}

function restoreFeedCache() {
  readFeedCache().forEach(s => {
    if (!s || !s.feedId || typeof s.icsText !== 'string') return;
    try {
      sources.push({
        id: nextId++, feedId: s.feedId, alertKey: 'f:' + s.feedId, name: String(s.name || 'Calendar'),
        color: s.color || PALETTE[sources.length % PALETTE.length], enabled: true,
        events: parseIcs(s.icsText), fetchedAt: s.fetchedAt, ...feedPreference(s.feedId)
      });
    } catch { /* Ignore an obsolete or malformed cached snapshot. */ }
  });
}
