// Local server: serves the web page and fetches ICS links server-side (browsers block them via CORS).
// Feed links are stored in data/feeds.json (gitignored). Listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeJsonAtomic, readJson } = require('./json-store');
const { send, sendJson, sendError, readBody } = require('./http');
const { staticFile, sendStatic } = require('./static-files');
const { createFeedFetcher } = require('./feed-fetch');
const { createAlertService } = require('./alerts'); // defines the global ICAL that ./mcp and the shared logic need
const { createStartupService } = require('./startup');
const { createBackupService } = require('./backups');
const { createMcpHandler } = require('./mcp');
const { createCalendarTools } = require('./calendar-tools');
const { assistantConfig, savedSettings } = require('./assistant-config');
const { createModelClient } = require('./model-client');
const { createAssistant } = require('./assistant');
const { createLayaRouter } = require('./tool-router');
const { createAssistantRoute } = require('./assistant-route');
const { createLlamaEngine } = require('./llama-engine');
const { createLayaEngine } = require('./laya-engine');
const { createBuiltinModels } = require('./builtin-models');
const { normalizeFeedUrl } = require('../shared/alert-logic.js');
const { createUpdateChecker } = require('./updates');
const { createUpdateInstaller } = require('./update-install');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.CALENDAR_DATA_DIR || path.join(ROOT, 'data'); // the override is for tests
const FEEDS_FILE = path.join(DATA_DIR, 'feeds.json');
// Read once at start, so run.bat can tell when a running server is older than the files on disk.
const VERSION = (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return 'unknown'; } })();
const updates = createUpdateChecker({ version: VERSION });
const updateInstaller = createUpdateInstaller({ root: ROOT, dataDir: DATA_DIR, version: VERSION, checker: updates, port: PORT,
  restart: () => setTimeout(shutdown, 500).unref() });

fs.mkdirSync(DATA_DIR, { recursive: true });

const readFeeds = () => readJson(FEEDS_FILE, []);
const writeFeeds = feeds => writeJsonAtomic(FEEDS_FILE, feeds, { space: 2 });


const fetchFeedText = createFeedFetcher();

const alerts = createAlertService({
  readFeeds,
  fetchText: fetchFeedText,
  stateFile: path.join(DATA_DIR, 'alerts-state.json'),
  firedFile: path.join(DATA_DIR, 'alerts-fired.json'),
  snoozeBaseUrl: `http://localhost:${PORT}`
});
const mcp = createMcpHandler({ sources: alerts.sources });
const backups = createBackupService({ readFeeds, writeFeeds, alerts, recoveryFile: path.join(DATA_DIR, 'backup-recovery.json') });

const startup = createStartupService();

// Actions that change the machine must come from this page: block other websites and DNS rebinding.
const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
const ORIGINS = HOSTS.map(h => 'http://' + h);
const isLocalHost = req => HOSTS.includes(req.headers.host);
const isLocalAction = req => {
  return req.headers['x-calendar-action'] === '1' && isLocalHost(req) &&
    (!req.headers.origin || ORIGINS.includes(req.headers.origin));
};
// Replies 403 and returns true when the request is not a local action from this page.
const refuseUnlessLocalAction = (req, res) => !isLocalAction(req) && (send(res, 403, 'Forbidden'), true);

// Invalid optional settings disable only the assistant, leaving the calendar operational.
const ASSISTANT_FILE = path.join(DATA_DIR, 'assistant-config.json');
const savedAssistant = savedSettings(readJson(ASSISTANT_FILE, {}));
let modelConfig;
try { modelConfig = assistantConfig(savedAssistant); }
catch { modelConfig = { enabled: false, provider: 'llamacpp', url: '' }; console.warn('Assistant disabled: invalid model configuration.'); }
// The self-contained built-in model keeps its program and weights under data/llama; nothing is downloaded until the user asks.
const minicpm = createLlamaEngine({ dir: path.join(DATA_DIR, 'llama'), cpuThreads: modelConfig.cpuThreads });
const laya = createLayaEngine({ dir: path.join(DATA_DIR, 'laya') });
const llamaEngine = createBuiltinModels({ minicpm, laya, selected: () => modelConfig.provider === 'llamacpp' });
const modelClient = createModelClient({ ...modelConfig, engine: llamaEngine });
const toolRouter = createLayaRouter({ engine: laya, enabled: () => modelConfig.provider === 'llamacpp' });
const assistant = createAssistant({ client: modelClient, tools: createCalendarTools({ sources: alerts.sources }), router: toolRouter });
const assistantRoute = createAssistantRoute({ config: modelConfig, client: modelClient, engine: llamaEngine, assistant, refuseUnlessLocalAction, saved: savedAssistant, persist: value => writeJsonAtomic(ASSISTANT_FILE, value, { space: 2, mode: 0o600 }) });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET') {
      const asset = await staticFile(url.pathname);
      if (asset) return sendStatic(req, res, asset);
    }

    // MCP clients are not browsers: refuse any request carrying an Origin, and foreign Host headers (DNS rebinding).
    if (url.pathname === '/mcp') {
      if (!isLocalHost(req) || req.headers.origin) return send(res, 403, 'Forbidden');
      if (req.method !== 'POST') return send(res, 405, 'Use POST');
      let message;
      try { message = JSON.parse(await readBody(req, 1e6)); }
      catch { return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }); }
      const reply = await mcp.handle(message);
      return reply === null ? send(res, 202, '') : sendJson(res, 200, reply);
    }

    if (url.pathname === '/api/version' && req.method === 'GET') return sendJson(res, 200, { version: VERSION, pid: process.pid });
    if (url.pathname === '/api/updates/check') {
      if (refuseUnlessLocalAction(req, res)) return;
      if (req.method !== 'POST') return send(res, 405, 'Use POST.');
      try { return sendJson(res, 200, { ...await updates.check(), installation: await updateInstaller.state() }); }
      catch (error) { return sendError(res, error); }
    }
    if (url.pathname === '/api/updates/status' || url.pathname === '/api/updates/install') {
      if (refuseUnlessLocalAction(req, res)) return;
      if (url.pathname.endsWith('/status') && req.method === 'GET') return sendJson(res, 200, await updateInstaller.state());
      if (url.pathname.endsWith('/install') && req.method === 'POST') {
        const payload = JSON.parse(await readBody(req, 1000));
        if (typeof payload?.version !== 'string') return send(res, 400, 'Update version is required.');
        return sendJson(res, 202, await updateInstaller.start(payload.version));
      }
      return send(res, 405, 'Method not allowed.');
    }
    if (url.pathname === '/api/assistant' || url.pathname === '/api/assistant/status' || url.pathname === '/api/assistant/config' || url.pathname === '/api/assistant/test' || url.pathname === '/api/assistant/builtin' || url.pathname === '/api/assistant/builtin/pull' || url.pathname === '/api/assistant/providers' || url.pathname === '/api/assistant/provider') return await assistantRoute(req, res);

    if (url.pathname.startsWith('/api/backup/')) {
      if (refuseUnlessLocalAction(req, res)) return;
      try {
        if (url.pathname === '/api/backup/export' && req.method === 'POST') return sendJson(res, 200, backups.exportBackup(JSON.parse(await readBody(req, 42e6))));
        if (url.pathname === '/api/backup/restore' && req.method === 'POST') return sendJson(res, 200, backups.restoreBackup(JSON.parse(await readBody(req, 42e6))));
        if (url.pathname === '/api/backup/recovery' && req.method === 'GET') return sendJson(res, 200, backups.recoveryBackup());
      } catch (e) { return sendError(res, e); }
    }

    if (url.pathname === '/api/alerts/snooze' && req.method === 'POST') {
      if (refuseUnlessLocalAction(req, res)) return;
      try { return sendJson(res, 200, await alerts.snooze(JSON.parse(await readBody(req)))); }
      catch (e) { return sendError(res, e); }
    }
    const snoozeAction = url.pathname.match(/^\/alerts\/snooze\/([a-f0-9]{48})$/);
    if (snoozeAction && req.method === 'GET') {
      if (!isLocalHost(req)) return send(res, 403, 'Forbidden');
      try {
        await alerts.snoozeTicket(snoozeAction[1]);
        res.setHeader('Referrer-Policy', 'no-referrer');
        return send(res, 200, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Reminder snoozed</title><h1>Reminder snoozed for 5 minutes</h1><p>You can close this tab. The background server will send the reminder.</p><a href="/">Open calendar</a></html>', 'text/html; charset=utf-8');
      } catch (e) { return sendError(res, e); }
    }

    if (url.pathname === '/api/startup') {
      if (req.method === 'GET') return sendJson(res, 200, startup.status());
      if (req.method === 'POST') {
        if (refuseUnlessLocalAction(req, res)) return;
        const { enabled } = JSON.parse(await readBody(req));
        return sendJson(res, 200, await startup.set(!!enabled));
      }
    }

    if (url.pathname === '/api/alerts/status' && req.method === 'GET') return sendJson(res, 200, alerts.status());
    if (url.pathname === '/api/alerts/state' && req.method === 'POST') {
      alerts.setState(JSON.parse(await readBody(req, 2e7)));
      return sendJson(res, 200, alerts.status());
    }

    if (url.pathname === '/api/feeds') {
      if (req.method === 'GET') {
        return sendJson(res, 200, readFeeds().map(({ id, name, color }) => ({ id, name, color })));
      }
      if (req.method === 'POST') {
        const { name, url: link, color } = JSON.parse(await readBody(req));
        const href = normalizeFeedUrl(link);
        if (!href) return send(res, 400, 'Link must start with https:// or webcal://');
        const feed = { id: crypto.randomUUID(), name: String(name || 'Calendar').trim(), color, url: href };
        writeFeeds([...readFeeds(), feed]);
        return sendJson(res, 201, { id: feed.id, name: feed.name, color: feed.color });
      }
    }

    const m = url.pathname.match(/^\/api\/(feeds|ics)\/([\w-]+)$/);
    if (m) {
      const feeds = readFeeds();
      const feed = feeds.find(f => f.id === m[2]);
      if (!feed) return send(res, 404, 'Unknown feed');
      if (m[1] === 'feeds' && req.method === 'DELETE') {
        writeFeeds(feeds.filter(f => f.id !== feed.id));
        return send(res, 204, '');
      }
      if (m[1] === 'ics' && req.method === 'GET') {
        try { return send(res, 200, await fetchFeedText(feed), 'text/calendar; charset=utf-8'); }
        catch (e) { return send(res, 502, /^HTTP \d+$/.test(e.message) ? `Upstream returned ${e.message}` : e.message); }
      }
    }

    send(res, 404, 'Not found');
  } catch (e) {
    send(res, e.status || 500, e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ICS viewer: http://localhost:${PORT}`);
  alerts.start();
});

// On SIGTERM or SIGINT: every state file is written atomically and synchronously, so nothing needs flushing:
// stop the alert timer, finish in-flight requests, then exit.
function shutdown() {
  alerts.stop();
  llamaEngine.stop();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
