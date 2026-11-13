// @ts-check
// Bounded, checksummed model/runtime downloads. No file is accepted until its SHA-256 matches.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { fetchUpdateAsset } = require('./update-download');

async function performDownload({ url, target, sha256, maxBytes, fetch: fetchImpl = global.fetch, onBytes = /** @type {(got: number, total: number) => void} */ (() => {}), signal, headers, allowedHost }) {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('Missing download checksum.');
  const response = allowedHost ? await fetchUpdateAsset(url, { fetch: fetchImpl, headers, allowedHost, signal }) :
    await fetchImpl(url, { headers: { 'User-Agent': 'CalendarViewer' }, redirect: 'follow', signal });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > maxBytes) { await response.body.cancel(); throw new Error('The download is larger than allowed.'); }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const part = target + '.part', hash = crypto.createHash('sha256'); let got = 0;
  try {
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, done) {
      got += chunk.length;
      if (got > maxBytes) return done(new Error('The download is larger than allowed.'));
      hash.update(chunk); onBytes(got, total); done(null, chunk);
    } }), fs.createWriteStream(part), { signal });
    if (hash.digest('hex') !== sha256.toLowerCase()) throw new Error('The download did not match its published checksum.');
    await fs.promises.rename(part, target);
  } catch (error) { await fs.promises.rm(part, { force: true }); throw error; }
}

async function withTimeout(signal, timeoutMs, operation) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await operation(controller.signal); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
const downloadVerified = options => withTimeout(options.signal, 2 * 60 * 60 * 1000, signal => performDownload({ ...options, signal }));
const fetchJson = (url, { fetch: fetchImpl = global.fetch, signal, headers = {} } = /** @type {{ fetch?: typeof fetch, signal?: AbortSignal, headers?: Record<string, string> }} */ ({})) => withTimeout(signal, 20000, async requestSignal => {
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'CalendarViewer', ...headers }, signal: requestSignal });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}.`);
  return response.json();
});

module.exports = { downloadVerified, fetchJson };
