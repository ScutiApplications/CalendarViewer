const fs = require('fs');

function writeJsonAtomic(file, value, { space, mode } = {}) {
  const staging = file + '.tmp';
  fs.writeFileSync(staging, JSON.stringify(value, null, space), mode === undefined ? undefined : { mode });
  fs.renameSync(staging, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

module.exports = { writeJsonAtomic, readJson };
