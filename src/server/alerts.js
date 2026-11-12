// Background alert scheduler: sends Windows toasts for upcoming events even when the web page is closed.
// The page pushes its alert rules and imported calendars here; feed links are fetched by this process.
const path = require('path');
const { runCalendarScript } = require('./powershell');
const { createReminderStore } = require('./reminders');
const { writeJsonAtomic, readJson } = require('./json-store');

global.ICAL = require('../../vendor/ical.min.js');
const logic = require('../shared/alert-logic.js');

const FEED_REFRESH_MS = 5 * 60000;
const TICK_MS = 30000;

const b64 = text => Buffer.from(String(text || ''), 'utf8').toString('base64');

function windowsToast(occ, body, onResult) {
  const child = runCalendarScript(
    ['toast', '-Title', b64(occ.title), '-Body', b64(body), '-Url', b64(occ.join), '-SnoozeUrl', b64(occ.snoozeUrl)],
    { stdio: 'ignore' }
  );
  child.on('error', e => onResult(e.message));
  child.on('exit', code => onResult(code ? 'powershell exited with code ' + code : null));
}

function createAlertService({ readFeeds, fetchText, notify = windowsToast, stateFile, firedFile, snoozeBaseUrl, now = Date.now, log = console.log }) {

  let state = readJson(stateFile, {});
  state = { rules: logic.sanitizeRules(state.rules), sources: Array.isArray(state.sources) ? state.sources : [] };
  const fired = readJson(firedFile, {});
  const reminders = createReminderStore({ file: path.join(path.dirname(stateFile), 'alerts-snoozed.json'), now });
  const feedCache = new Map();  // feedId -> { events, fetchedAt }
  const feedHealth = new Map(); // refresh state, independent of the last successful snapshot
  const localCache = new Map(); // alertKey -> { text, events }
  let toastError = null;
  let running = null;
  let feedGeneration = 0;

  async function refreshFeeds(feeds) {
    const generation = feedGeneration;
    await Promise.all(feeds.map(async feed => {
      const cached = feedCache.get(feed.id);
      if (cached && now() - cached.fetchedAt < FEED_REFRESH_MS) return;
      feedHealth.set(feed.id, { fetching: true });
      try {
        const events = logic.parseIcs(await fetchText(feed));
        if (generation !== feedGeneration) return;
        feedCache.set(feed.id, { events, fetchedAt: now() });
        feedHealth.set(feed.id, { failed: false });
      } catch (e) {
        if (generation !== feedGeneration) return;
        feedHealth.set(feed.id, { failed: true });
        log('Alert feed refresh failed for ' + feed.name + ': ' + e.message);
      }
    }));
  }

  function currentSources(feeds) {
    const flags = new Map(state.sources.map(s => [s.alertKey, s]));
    const out = [];
    feeds.forEach(feed => {
      const cached = feedCache.get(feed.id);
      if (!cached) return;
      const key = 'f:' + feed.id;
      const flag = flags.get(key);
      out.push({ id: out.length + 1, alertKey: key, name: feed.name, color: feed.color, enabled: flag ? flag.enabled !== false : true, events: cached.events });
    });
    state.sources.forEach(s => {
      if (typeof s.icsText !== 'string' || s.alertKey.startsWith('f:')) return;
      let cached = localCache.get(s.alertKey);
      if (!cached || cached.text !== s.icsText) {
        try { cached = { text: s.icsText, events: logic.parseIcs(s.icsText) }; } catch { return; }
        localCache.set(s.alertKey, cached);
      }
      out.push({ id: out.length + 1, alertKey: s.alertKey, name: s.name, color: logic.DEFAULT_SOURCE_COLOR, enabled: s.enabled !== false, events: cached.events });
    });
    return out;
  }

  // Marks due alerts as fired; shows them unless silent. Uses cached feed data only.
  function check(silent) {
    const t = now();
    const horizon = Math.max(logic.maxConfiguredOffset(state.rules) * 60000, reminders.horizon());
    if (!horizon) return;
    let due, deferred;
    const suppressed = new Set(reminders.status().pending.map(s => s.key + '|' + s.start));
    try {
      const sources = currentSources(readFeeds());
      const occurrences = logic.collectOccurrences(sources, t, horizon);
      due = logic.findDueAlerts(state.rules, occurrences, fired, t);
      const freshSources = sources.filter(source => {
        const key = source.alertKey;
        if (key.startsWith('l:')) return true;
        const id = key.slice(2), health = feedHealth.get(id), cached = feedCache.get(id);
        return cached && !health?.failed && !health?.fetching && t - cached.fetchedAt < FEED_REFRESH_MS;
      });
      const fresh = logic.collectOccurrences(freshSources, t, horizon);
      deferred = reminders.takeDue(fresh, state.rules, silent);
    }
    catch (e) { log('Alert check failed: ' + e.message); return; }
    const deliver = occ => {
      let snoozeUrl;
      if (snoozeBaseUrl && t + logic.SNOOZE_MS < occ.start) {
        try { snoozeUrl = snoozeBaseUrl + '/alerts/snooze/' + reminders.issueTicket(occ); }
        catch (e) { log('Could not save snooze action: ' + e.message); }
      }
      notify({ ...occ, snoozeUrl }, logic.alertBody(occ, t), err => { toastError = err; if (err) log('Windows toast failed: ' + err); });
    };
    due.forEach(a => {
      fired[a.id] = a.occ.start;
      if (silent || a.superseded || suppressed.has(a.occ.key + '|' + a.occ.start)) return;
      deliver(a.occ);
    });
    deferred.forEach(a => deliver(a.occ));
    logic.pruneFired(fired, t);
    if (due.length) {
      try { writeJsonAtomic(firedFile, fired); }
      catch (e) { log('Could not save ' + path.basename(firedFile) + ': ' + e.message); }
    }
  }

  function tick() {
    if (running) return running;
    running = Promise.resolve().then(async () => {
      try {
        if (logic.maxConfiguredOffset(state.rules) || reminders.horizon()) await refreshFeeds(readFeeds());
        check(false);
      } finally { running = null; }
    });
    return running;
  }

  function setState(body) {
    const next = {
      rules: logic.sanitizeRules(body && body.rules),
      sources: (Array.isArray(body && body.sources) ? body.sources : [])
        .filter(s => s && typeof s.alertKey === 'string')
        .map(s => ({ alertKey: s.alertKey, name: String(s.name || ''), enabled: s.enabled !== false, icsText: typeof s.icsText === 'string' ? s.icsText : undefined }))
    };
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    if (!changed) return;
    writeJsonAtomic(stateFile, next);
    state = next;
    for (const key of localCache.keys()) if (!state.sources.some(s => s.alertKey === key)) localCache.delete(key);
    // Edits must not announce alerts that were already past; the next tick also fetches any new feeds.
    check(true);
    tick();
  }

  const status = () => ({
    serverToasts: process.platform === 'win32' && !toastError,
    snoozes: reminders.status(),
    feeds: readFeeds().map(feed => ({
      id: feed.id,
      ...logic.syncHealth({ fetchedAt: feedCache.get(feed.id)?.fetchedAt, ...feedHealth.get(feed.id) }, now()),
      ...(!logic.maxConfiguredOffset(state.rules) ? { state: 'inactive' } : {})
    }))
  });

  let timer;
  function start() {
    tick();
    timer = setInterval(tick, TICK_MS);
  }
  const stop = () => clearInterval(timer);

  async function snooze(reference) {
    if (!reference || typeof reference.key !== 'string' || !Number.isFinite(reference.start)) throw new Error('Invalid reminder.');
    await tick();
    const horizon = reference.start - now();
    if (horizon <= 0 || horizon > logic.MAX_OFFSET_MIN * 60000) throw new Error('This event is no longer upcoming.');
    const occ = logic.collectOccurrences(currentSources(readFeeds()), now(), horizon)
      .find(o => o.key === reference.key && o.start === reference.start);
    if (!occ || !logic.isAlertable(state.rules, occ)) {
      throw new Error('This reminder is cancelled or inactive.');
    }
    return reminders.schedule(occ);
  }

  // Parsed sources for read-only consumers such as the MCP server; refreshes stale feeds (5-minute cache).
  async function sources() {
    await refreshFeeds(readFeeds());
    return currentSources(readFeeds());
  }

  return {
    setState, status, start, stop, tick, snooze, sources,
    snoozeTicket: token => snooze(reminders.consumeTicket(token)),
    getState: () => JSON.parse(JSON.stringify(state)),
    invalidateFeeds: () => { feedGeneration++; feedCache.clear(); feedHealth.clear(); }
  };
}

module.exports = { createAlertService };
