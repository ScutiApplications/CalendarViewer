// @ts-check
// Minimal zip reader on node:zlib, so the app can unpack a downloaded program without any dependency.
// shortcut: no ZIP64, no encryption, no multi-disk archives; fine for the llama.cpp release files (all under 4 GB).
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const inflateRaw = promisify(zlib.inflateRaw);

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
// Entries are checked before anything is written, so a hostile name cannot escape the target folder.
function safeTarget(root, name) {
  const normalized = path.normalize(name.replace(/\\/g, '/'));
  if (!normalized || path.isAbsolute(normalized) || normalized.split(path.sep).includes('..') || /^[A-Za-z]:/.test(normalized)) throw new Error('Unsafe path in archive.');
  return path.join(root, normalized);
}
function entries(buffer) {
  let at = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) if (buffer.readUInt32LE(i) === EOCD) { at = i; break; }
  if (at < 0) throw new Error('Not a zip file.');
  const count = buffer.readUInt16LE(at + 10);
  let offset = buffer.readUInt32LE(at + 16);
  const list = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL) throw new Error('Damaged zip directory.');
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    list.push({
      flags: buffer.readUInt16LE(offset + 8), method: buffer.readUInt16LE(offset + 10), compressed: buffer.readUInt32LE(offset + 20), size: buffer.readUInt32LE(offset + 24),
      local: buffer.readUInt32LE(offset + 42), name: buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return list;
}
// Extracts every file of the zip at `file` into `dir`. `maxBytes` bounds the unpacked size.
async function extractZip(file, dir, { maxBytes = 1024 * 1024 * 1024 } = {}) {
  const buffer = await fsp.readFile(file);
  const list = entries(buffer);
  let total = 0;
  for (const entry of list) { total += entry.size; if (total > maxBytes) throw new Error('Archive is larger than allowed.'); if (entry.flags & 1) throw new Error('Encrypted zip is not supported.'); safeTarget(dir, entry.name); }
  for (const entry of list) {
    const target = safeTarget(dir, entry.name);
    if (entry.name.endsWith('/')) { await fsp.mkdir(target, { recursive: true }); continue; }
    if (buffer.readUInt32LE(entry.local) !== LOCAL) throw new Error('Damaged zip entry.');
    const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28);
    const raw = buffer.subarray(start, start + entry.compressed);
    const data = entry.method === 0 ? raw : entry.method === 8 ? await inflateRaw(raw, { maxOutputLength: Math.max(1, entry.size) }) : null;
    if (!data) throw new Error('Unsupported zip compression.');
    if (data.length !== entry.size) throw new Error('Zip entry size mismatch.');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
  }
  return list.length;
}
module.exports = { extractZip };
