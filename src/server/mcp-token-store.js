// @ts-check
// Only the hash is retained. The bearer token is returned once when generated.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { readJson, writeJsonAtomic } = require('./json-store');

function createMcpTokenStore({ file }) {
  function load() {
    try { if (fs.statSync(file).size > 1024) return null; } catch { return null; }
    const value = readJson(file, null);
    return value?.version === 1 && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) &&
      typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) ? value : null;
  }
  let stored = load();
  const status = () => ({ configured: !!stored, createdAt: stored?.createdAt || null });
  function authorize(header) {
    if (!stored || typeof header !== 'string') return false;
    const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(header);
    if (!match || match[1].length > 512) return false;
    const supplied = crypto.createHash('sha256').update(match[1]).digest();
    const expected = Buffer.from(stored.sha256, 'hex');
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
  function generate() {
    const token = 'cvmcp_' + crypto.randomBytes(32).toString('base64url');
    const value = { version: 1, sha256: crypto.createHash('sha256').update(token).digest('hex'), createdAt: new Date().toISOString() };
    try { writeJsonAtomic(file, value, { mode: 0o600 }); }
    catch { throw new Error('MCP token could not be saved.'); }
    stored = load();
    if (!stored) throw new Error('MCP token could not be loaded.');
    return { token };
  }
  function revoke() {
    try { fs.rmSync(file, { force: true }); }
    catch { throw new Error('MCP token could not be revoked.'); }
    stored = load(); return status();
  }
  return { authorize, generate, revoke, status };
}

module.exports = { createMcpTokenStore };
