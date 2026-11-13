const { defineConfig } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');

const PORT = 3457;
// Uses the Microsoft Edge already installed on Windows, so no browser download is needed.
module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  workers: 1,
  retries: 1, // the first Edge launch is occasionally slow
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, channel: 'msedge', headless: true, viewport: { width: 1400, height: 900 } },
  webServer: {
    command: 'node src/server/server.js',
    url: `http://localhost:${PORT}/api/version`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), CALENDAR_DATA_DIR: path.join(os.tmpdir(), 'calendarviewer-e2e-' + process.pid) }
  }
});
