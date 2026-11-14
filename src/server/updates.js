// @ts-check
// Automatic checks read one static manifest. Release APIs are used only by maintainers.
const { HOST, MANIFEST_URL, SIGNATURE_URL, SIGNING_PUBLIC_KEY, validateManifest } = require('./update-manifest');
const { verifyManifestSignature } = require('./update-signature');
const failure = message => Object.assign(new Error(message), { status: 502 });
async function boundedText(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw failure('Update manifest response is too large.'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw failure('Update manifest response is too large.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
function versionParts(value) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(String(value));
  if (!match || match[4]?.split('.').some(identifier => /^0\d+$/.test(identifier))) return null;
  const parts = match.slice(1, 4).map(Number);
  return parts.every(Number.isSafeInteger) ? { parts, preview: !!match[4] } : null;
}
function createUpdateChecker({ version, fetch: fetchImpl = global.fetch, now = Date.now, cacheMs = 5 * 60000, publicKey = SIGNING_PUBLIC_KEY }) {
  let cached = null, expires = 0, pending = null, generation = 0;
  const downloadOptions = async () => ({ allowedHost: HOST, headers: { Accept: 'application/octet-stream' } });
  // With a public key embedded, the manifest must carry a valid detached signature. A missing or bad one never installs.
  async function requireSignature(text) {
    let signature;
    try {
      const reply = await fetchImpl(SIGNATURE_URL, { headers: { Accept: 'text/plain', 'User-Agent': 'CalendarViewer' }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (!reply.ok) { await reply.body?.cancel(); throw failure('Update manifest signature is missing. Do not install this update.'); }
      signature = await boundedText(reply, 1024);
    } catch (error) { throw error.status ? error : failure('Could not read the update manifest signature. Try again later.'); }
    if (!verifyManifestSignature(text, signature, publicKey)) throw failure('Update manifest signature is invalid. Do not install this update.');
  }
  async function latest() {
    const current = versionParts(version);
    if (!current) throw failure('Current application version is invalid; cannot compare releases.');
    let response;
    try {
      response = await fetchImpl(MANIFEST_URL, {
        headers: { Accept: 'application/json', 'User-Agent': 'CalendarViewer' }, redirect: 'manual', signal: AbortSignal.timeout(10000)
      });
    } catch { throw failure('Could not reach the release site. Check your connection and try again.'); }
    const base = { currentVersion: version, latestVersion: null, releaseUrl: null, checkedAt: new Date(now()).toISOString() };
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 300 && response.status < 400) {
        let location;
        try { location = new URL(response.headers.get('location'), MANIFEST_URL); } catch { throw failure('Update manifest redirected unexpectedly.'); }
        if (location.origin === 'https://' + HOST && location.pathname === '/login') return { ...base, status: 'auth-required' };
        throw failure('Update manifest redirected unexpectedly.');
      }
      if (response.status === 429) throw failure('release site rate limit reached. Try again later.');
      if ([401, 403].includes(response.status)) return { ...base, status: 'auth-required' };
      if (response.status === 404) return { ...base, status: 'no-release' };
      throw failure('release site could not check releases. Try again later.');
    }
    let value;
    try {
      const text = await boundedText(response, 1024 * 1024);
      if (publicKey) await requireSignature(text);
      value = JSON.parse(text);
    }
    catch (error) { throw error.status ? error : failure('Could not read release manifest information. Try again later.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('Invalid release manifest information.');
    const next = versionParts(value.version);
    if (!next) throw failure('Release manifest must contain a stable version such as 1.2.3.');
    if (value.draft || value.prerelease || next.preview) return { ...base, status: 'no-release' };
    let release;
    try { release = validateManifest(value); } catch (error) { throw failure(error.message); }
    let comparison = 0;
    for (let i = 0; i < 3 && !comparison; i++) comparison = Math.sign(next.parts[i] - current.parts[i]);
    const newer = comparison > 0 || (comparison === 0 && current.preview);
    const floor = release.minimumVersion && versionParts(release.minimumVersion);
    let below = 0;
    for (let i = 0; floor && i < 3 && !below; i++) below = Math.sign(floor.parts[i] - current.parts[i]);
    const required = !!floor && newer && (below > 0 || (below === 0 && current.preview));
    return { ...base, latestVersion: release.version, status: newer ? 'available' : 'up-to-date', required, download: release.download,
      downloadReason: release.download ? null : 'This release has no verifiable checksum', releaseUrl: release.releaseUrl };
  }
  function check({ force = false } = {}) {
    if (!force && cached && now() < expires) return Promise.resolve(cached);
    if (!pending) {
      const started = generation;
      const request = latest().then(result => { if (started === generation) { cached = result; expires = now() + cacheMs; } return result; }).finally(() => { if (pending === request) pending = null; });
      pending = request;
    }
    return pending;
  }
  return { check, downloadOptions, clearCache() { generation++; cached = null; expires = 0; pending = null; } };
}
module.exports = { createUpdateChecker };
