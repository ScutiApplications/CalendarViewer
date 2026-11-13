// @ts-check
// Ed25519 signature check for the update manifest. The maintainer signs latest.json offline with tools/sign-manifest.js;
// the app embeds only the public key, so a stolen repository token cannot forge an update that installs.
const crypto = require('node:crypto');

// Returns true only when `signatureBase64` is a valid Ed25519 signature of the exact manifest bytes.
function verifyManifestSignature(manifestText, signatureBase64, publicKeyPem) {
  try {
    const signature = Buffer.from(String(signatureBase64).trim(), 'base64');
    if (signature.length !== 64) return false;
    return crypto.verify(null, Buffer.from(manifestText, 'utf8'), crypto.createPublicKey(publicKeyPem), signature);
  } catch { return false; }
}

module.exports = { verifyManifestSignature };
