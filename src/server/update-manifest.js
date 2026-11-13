// @ts-check
// Fixed release trust boundary shared by the checker and the maintainer's site generator.
const HOST = 'github.com';
const RELEASES = `https://${HOST}/ScutiApplications/CalendarViewer/releases`;
// The manifest is served by GitHub Pages. Change these three constants if the repository or its Pages address differs.
const MANIFEST_URL = 'https://scutiapplications.github.io/CalendarViewer/latest.json';
const SIGNATURE_URL = MANIFEST_URL + '.sig';
// Ed25519 public key (PEM) of the maintainer. While null, manifests are accepted unsigned. Once set, every manifest
// needs a matching latest.json.sig. See docs/update-integrity.md.
const SIGNING_PUBLIC_KEY = null;
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.version !== 'string' || !STABLE.test(value.version) ||
      !value.version.split('.').map(Number).every(Number.isSafeInteger)) throw new Error('Update manifest must contain a stable version such as 1.2.3.');
  const version = value.version, releaseUrl = `${RELEASES}/tag/v${version}`, name = `CalendarViewer-${version}.zip`;
  if (value.releaseUrl !== releaseUrl) throw new Error('Update manifest has an invalid release address.');
  const url = `${RELEASES}/download/v${version}/${name}`;
  const download = value.downloadUrl === url && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= 100 * 1024 * 1024 &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(value.sha256) ? { url, name, size: value.size, sha256: value.sha256.toLowerCase() } : null;
  // Optional: installed versions below this one must update. Absent means the update is optional.
  let minimumVersion = null;
  if (value.minimumVersion !== undefined) {
    const min = value.minimumVersion;
    if (typeof min !== 'string' || !STABLE.test(min) || !min.split('.').map(Number).every(Number.isSafeInteger)) throw new Error('Update manifest has an invalid minimum version.');
    const a = min.split('.').map(Number), b = version.split('.').map(Number);
    if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) throw new Error('Update manifest minimum version is newer than its version.');
    minimumVersion = min;
  }
  return { version, releaseUrl, download, minimumVersion };
}

module.exports = { HOST, RELEASES, MANIFEST_URL, SIGNATURE_URL, SIGNING_PUBLIC_KEY, validateManifest };
