// Serves the page, shared scripts and vendor libraries from three public folders.
const fs = require('fs');
const path = require('path');
const { SECURITY_HEADERS } = require('./http');

const ROOT = path.join(__dirname, '..', '..');
const STATIC_ROOTS = [
  ['/shared/', path.join(ROOT, 'src', 'shared')],
  ['/vendor/', path.join(ROOT, 'vendor')],
  ['/', path.join(ROOT, 'src', 'web')]
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// Only files inside the three public folders are served; anything that escapes them is refused.
async function staticFile(pathname) {
  const wanted = pathname === '/' ? '/index.html' : pathname;
  for (const [prefix, dir] of STATIC_ROOTS) {
    if (!wanted.startsWith(prefix)) continue;
    const file = path.resolve(dir, decodeURIComponent(wanted.slice(prefix.length)));
    const type = TYPES[path.extname(file)];
    if (!type || !file.startsWith(dir + path.sep)) return null;
    const info = await fs.promises.stat(file).catch(() => null);
    return info && info.isFile() ? { file, type, etag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"` } : null;
  }
  return null;
}

// Files are revalidated on every load (no-cache), but an unchanged one costs a 304 instead of a re-download.
const sendStatic = (req, res, { file, type, etag }) => {
  const headers = { 'Cache-Control': 'no-cache', ETag: etag, ...SECURITY_HEADERS };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, { 'Content-Type': type, ...headers });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
};
module.exports = { staticFile, sendStatic };
