// Cached checks against this application's latest stable GitHub Release.
const REPOSITORY = 'ScutiApplications/CalendarViewer';
const RELEASES = `https://github.com/${REPOSITORY}/releases`;
const failure = message => Object.assign(new Error(message), { status: 502 });
function versionParts(value) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(String(value));
  if (!match || match[4]?.split('.').some(identifier => /^0\d+$/.test(identifier))) return null;
  const parts = match.slice(1, 4).map(Number);
  return parts.every(Number.isSafeInteger) ? { parts, preview: !!match[4] } : null;
}
function createUpdateChecker({ version, fetch: fetchImpl = global.fetch, now = Date.now, cacheMs = 5 * 60000 }) {
  let cached = null, expires = 0, pending = null;
  async function latest() {
    const current = versionParts(version);
    if (!current) throw failure('Current application version is invalid; cannot compare releases.');
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CalendarViewer' }, redirect: 'error', signal: AbortSignal.timeout(10000)
      });
    } catch { throw failure('Could not reach GitHub. Check your connection and try again.'); }
    const base = { currentVersion: version, latestVersion: null, releaseUrl: null, checkedAt: new Date(now()).toISOString() };
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return { ...base, status: 'no-release' };
      if (response.status === 403 || response.status === 429) throw failure('GitHub rate limit reached. Try again later.');
      throw failure('GitHub could not check releases. Try again later.');
    }
    let release;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1024 * 1024) throw failure('GitHub release response is too large.');
        chunks.push(Buffer.from(chunk));
      }
      release = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { throw error.status ? error : failure('Could not read GitHub release information. Try again later.'); }
    if (!release || typeof release !== 'object') throw failure('Invalid GitHub release information.');
    const tag = release.tag_name, next = typeof tag === 'string' && tag.length <= 100 ? versionParts(tag) : null;
    if (!next) throw failure('Latest release tag must use a version such as v1.2.3.');
    if (release.draft || release.prerelease || next.preview) return { ...base, status: 'no-release' };
    let comparison = 0;
    for (let i = 0; i < 3 && !comparison; i++) comparison = Math.sign(next.parts[i] - current.parts[i]);
    const newer = comparison > 0 || (comparison === 0 && current.preview);
    const latestVersion = tag.replace(/^v/, ''), name = `CalendarViewer-${latestVersion}.zip`;
    const url = `${RELEASES}/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
    const asset = Array.isArray(release.assets) && release.assets.find(item => item?.name === name && item.state === 'uploaded' && item.browser_download_url === url &&
      Number.isSafeInteger(item.size) && item.size > 0 && item.size <= 100 * 1024 * 1024 && /^sha256:[a-f0-9]{64}$/i.test(item.digest));
    const download = asset ? { url, name, size: asset.size, sha256: asset.digest.slice(7) } : null;
    return { ...base, latestVersion, status: newer ? 'available' : 'up-to-date', download, releaseUrl: `${RELEASES}/tag/${encodeURIComponent(tag)}` };
  }
  function check({ force = false } = {}) {
    if (!force && cached && now() < expires) return Promise.resolve(cached);
    pending ||= latest().then(result => { cached = result; expires = now() + cacheMs; return result; }).finally(() => { pending = null; });
    return pending;
  }
  return { check };
}
module.exports = { createUpdateChecker };
