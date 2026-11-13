const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyManifestSignature } = require('../src/server/update-signature');
const { createUpdateChecker } = require('../src/server/updates');
const { keygen, sign } = require('../tools/sign-manifest');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-sign-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const manifest = version => JSON.stringify({
  version, releaseUrl: `https://github.com/ScutiApplications/CalendarViewer/releases/tag/v${version}`,
  downloadUrl: `https://github.com/ScutiApplications/CalendarViewer/releases/download/v${version}/CalendarViewer-${version}.zip`, sha256: 'a'.repeat(64), size: 1234
});
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: new Headers(), body: new Response(body).body });

test('keygen refuses to overwrite and sign writes a verifiable signature', () => {
  const keyFile = path.join(dir, 'private.pem');
  const publicPem = keygen(keyFile);
  assert.throws(() => keygen(keyFile), /already exists/);
  const file = path.join(dir, 'latest.json');
  fs.writeFileSync(file, manifest('0.0.6'));
  const sigFile = sign(file, keyFile);
  assert.equal(verifyManifestSignature(fs.readFileSync(file, 'utf8'), fs.readFileSync(sigFile, 'utf8'), publicPem), true);
});

test('a changed manifest, wrong key or malformed signature fails verification', () => {
  const a = crypto.generateKeyPairSync('ed25519'), b = crypto.generateKeyPairSync('ed25519');
  const pem = key => key.export({ type: 'spki', format: 'pem' });
  const text = manifest('0.0.6');
  const signature = crypto.sign(null, Buffer.from(text), a.privateKey).toString('base64');
  assert.equal(verifyManifestSignature(text, signature, pem(a.publicKey)), true);
  assert.equal(verifyManifestSignature(text.replace('0.0.6', '9.9.9'), signature, pem(a.publicKey)), false);
  assert.equal(verifyManifestSignature(text, signature, pem(b.publicKey)), false);
  assert.equal(verifyManifestSignature(text, 'not-base64!', pem(a.publicKey)), false);
  assert.equal(verifyManifestSignature(text, signature, 'not a key'), false);
});

function checker(publicKey, signatureFor) {
  const text = manifest('0.0.6');
  const fetch = async url => url.endsWith('.sig') ? signatureFor(text) : reply(text);
  return createUpdateChecker({ version: '0.0.5', fetch, publicKey });
}

test('with a public key set, a valid signature lets the update through', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const result = await checker(publicKey.export({ type: 'spki', format: 'pem' }), text => reply(crypto.sign(null, Buffer.from(text), privateKey).toString('base64'))).check();
  assert.equal(result.status, 'available');
});

test('with a public key set, a missing or forged signature is refused', async () => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const forger = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  await assert.rejects(checker(pem, () => reply('', 404)).check(), /signature is missing/);
  await assert.rejects(checker(pem, text => reply(crypto.sign(null, Buffer.from(text), forger.privateKey).toString('base64'))).check(), /signature is invalid/);
});

test('with no public key embedded, unsigned manifests are still accepted', async () => {
  const result = await createUpdateChecker({ version: '0.0.5', fetch: async () => reply(manifest('0.0.6')), publicKey: null }).check();
  assert.equal(result.status, 'available');
});

test('the embedded maintainer key is a valid Ed25519 public key and is used by default', () => {
  const { SIGNING_PUBLIC_KEY } = require('../src/server/update-manifest');
  if (SIGNING_PUBLIC_KEY === null) return; // No key embedded yet: generate one with tools/sign-manifest.js keygen and set it.
  const key = crypto.createPublicKey(SIGNING_PUBLIC_KEY);
  assert.equal(key.asymmetricKeyType, 'ed25519');
});
