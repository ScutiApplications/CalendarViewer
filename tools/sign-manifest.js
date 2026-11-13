// @ts-check
// Maintainer-only, run on a trusted machine. The private key must never be committed or stored on GitHub.
//   node tools/sign-manifest.js keygen <private-key-file>      writes the private key, prints the public key to embed
//   node tools/sign-manifest.js sign <latest.json> <private-key-file>   writes <latest.json>.sig (base64)
const crypto = require('node:crypto');
const fs = require('node:fs');
const { verifyManifestSignature } = require('../src/server/update-signature');

function keygen(privateFile) {
  if (fs.existsSync(privateFile)) throw new Error(privateFile + ' already exists. Refusing to overwrite a key.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  return String(publicKey.export({ type: 'spki', format: 'pem' }));
}

function sign(manifestFile, privateFile) {
  const manifest = fs.readFileSync(manifestFile);
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateFile));
  const signature = crypto.sign(null, manifest, privateKey).toString('base64');
  const publicPem = String(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }));
  if (!verifyManifestSignature(manifest.toString('utf8'), signature, publicPem)) throw new Error('Signature self-check failed.');
  fs.writeFileSync(manifestFile + '.sig', signature + '\n');
  return manifestFile + '.sig';
}

if (require.main === module) {
  const [command, a, b] = process.argv.slice(2);
  try {
    if (command === 'keygen' && a) {
      console.log(keygen(a));
      console.log('Private key written to ' + a + '. Store it offline. Paste the public key above into SIGNING_PUBLIC_KEY in src/server/update-manifest.js.');
    } else if (command === 'sign' && a && b) console.log('Wrote ' + sign(a, b));
    else { console.error('Usage: keygen <private-key-file> | sign <latest.json> <private-key-file>'); process.exit(2); }
  } catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { keygen, sign };
