// Loading linked calendars from the server and refreshing them.
let pendingRefreshes = 0;
let refreshQueued = false;
const skeleton = document.getElementById('calendar-loading');
for (let i = 0; i < 5; i++) {
  const column = create('div', 'skeleton-column');
  for (let j = 0; j < 3; j++) column.append(create('div', 'skeleton-event'));
  skeleton.append(column);
}

async function loadFeeds() {
  if (restoringBackup) return;
  if (pendingRefreshes) { refreshQueued = true; return; }
  pendingRefreshes++;
  const main = document.querySelector('main');
  main.classList.add('is-refreshing');
  calBox.setAttribute('aria-busy', 'true');
  skeleton.hidden = !!document.querySelector('.fc-event');
  setStatus('Refreshing…');
  setSyncState('busy');
  try { await fetchFeeds(); }
  finally {
    pendingRefreshes--;
    if (!pendingRefreshes) {
      if (syncStrip.dataset.state === 'busy') setSyncState('error');
      skeleton.hidden = true;
      main.classList.remove('is-refreshing');
      calBox.setAttribute('aria-busy', 'false');
      if (refreshQueued) { refreshQueued = false; await loadFeeds(); }
    }
  }
}

async function fetchFeeds() {
  let feeds;
  try { feeds = await apiJson('/api/feeds'); }
  catch {
    sources.filter(s => s.feedId).forEach(s => { s.failed = true; s.fetching = false; });
    updateSourceHealth();
    setSyncState('error');
    return setStatus('Server not running. Start it with run.bat. Link feeds are off.');
  }
  setStatus('Refreshing…');
  feeds.forEach(f => {
    let source = sources.find(s => s.feedId === f.id);
    if (!source) {
      source = { id: nextId++, feedId: f.id, alertKey: 'f:' + f.id, name: f.name, color: f.color, enabled: true, events: [], ...feedPreference(f.id) };
      sources.push(source);
    }
    source.fetching = true;
  });
  renderSources();
  const results = await Promise.allSettled(feeds.map(async f => {
    const source = sources.find(s => s.feedId === f.id);
    try {
      const icsText = await (await api('/api/ics/' + f.id)).text();
      const events = parseIcs(icsText);
      if (!sources.includes(source)) return;
      source.events = events;
      source.fetchedAt = Date.now();
      source.failed = false;
      cacheFeedSnapshot(f, icsText);
    } catch (error) {
      if (sources.includes(source)) source.failed = true;
      throw error;
    } finally {
      if (sources.includes(source)) source.fetching = false;
      updateSourceHealth();
      calendar.refetchEvents();
    }
  }));
  const errors = [];
  feeds.forEach((f, i) => {
    const r = results[i];
    if (r.status === 'rejected') errors.push(f.name + ': ' + r.reason.message);
  });
  for (let i = sources.length - 1; i >= 0; i--) {
    if (sources[i].feedId && !feeds.some(f => f.id === sources[i].feedId)) sources.splice(i, 1);
  }
  writeFeedCache(readFeedCache().filter(s => feeds.some(f => f.id === s.feedId)));
  renderSources();
  calendar.refetchEvents();
  runAlertCheck(false);
  scheduleAlertSync();
  setSyncState(errors.length ? 'error' : 'ok');
  setStatus(errors.length ? 'Errors – ' + errors.join('; ') : 'Updated ' + new Date().toLocaleTimeString([], CLOCK));
}
