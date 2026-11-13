// @ts-check
// Maintainer-only: turn published release metadata into a small static Pages site.
const fs = require('node:fs');
const path = require('node:path');
const { RELEASES, validateManifest } = require('../src/server/update-manifest');

function createReleaseSite(release, checksumText = '', options = {}) {
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== 'string' || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name)) throw new Error('Only a published stable release can update the site.');
  const version = release.tag_name.slice(1), name = `CalendarViewer-${version}.zip`;
  const asset = Array.isArray(release.assets) && release.assets.find(item => item?.name === name && item.state === 'uploaded');
  if (!asset) throw new Error('Published installation ZIP is missing.');
  let sha256 = /^sha256:[a-f0-9]{64}$/i.test(asset.digest) ? asset.digest.slice(7).toLowerCase() : null;
  if (!sha256) {
    if (typeof checksumText !== 'string' || Buffer.byteLength(checksumText) > 65536) throw new Error('Invalid SHA256SUMS.');
    const matches = checksumText.split(/\r?\n/).map(line => /^([a-f0-9]{64}) [ *](.+)$/i.exec(line)).filter(match => match?.[2] === name);
    if (matches.length === 1) sha256 = matches[0][1].toLowerCase();
  }
  const manifest = { version, releaseUrl: `${RELEASES}/tag/v${version}`, downloadUrl: asset.browser_download_url, sha256, size: asset.size };
  // minimumVersion makes the update mandatory for every install older than it. Pass the value to keep or raise.
  if (options.minimumVersion) manifest.minimumVersion = options.minimumVersion;
  if (!validateManifest(manifest).download) throw new Error('Published ZIP has no valid checksum, size or download address.');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CalendarViewer releases</title><h1>CalendarViewer releases</h1><p>Latest version: ${version}</p><p><a href="${manifest.releaseUrl}">Release notes and downloads</a></p><p><a href="latest.json">Machine-readable update manifest</a></p></html>\n`;
  return { manifest, html };
}

if (require.main === module) {
  try {
    const [releaseFile, output, checksumFile] = process.argv.slice(2);
    if (!releaseFile || !output) throw new Error('Usage: node tools/make_release_site.js release.json output-directory [SHA256SUMS]');
    const release = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
    if (checksumFile && fs.statSync(checksumFile).size > 65536) throw new Error('SHA256SUMS is too large.');
    const site = createReleaseSite(release, checksumFile ? fs.readFileSync(checksumFile, 'utf8') : '');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify(site.manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'index.html'), site.html);
    fs.writeFileSync(path.join(output, '.nojekyll'), '');
    console.log(`Prepared static release metadata for ${site.manifest.version}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { createReleaseSite };
