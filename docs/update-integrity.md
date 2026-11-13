# Update integrity and trust model

## What the installer verifies today

1. `latest.json` is read from the fixed GitHub Pages URL for this repository.
2. The download address must be a versioned release ZIP of `ScutiApplications/CalendarViewer` on `github.com`.
3. The ZIP must match the `sha256` and `size` recorded in `latest.json`.
4. The ZIP is staged while the old server keeps running. A failed start restores the previous files.

## What this does not prove

The checksum and the ZIP come from the same publisher path. A SHA-256 value proves the download was not corrupted or swapped in transit. It does not prove who produced the release. Anyone who can write both the release asset and `latest.json` (for example, with a stolen repository token or a compromised Actions run) can ship code that the installer accepts.

## Manifest signing (implemented, off until you set a key)

The app can verify an Ed25519 signature of `latest.json`. It is off while `SIGNING_PUBLIC_KEY` in `src/server/update-manifest.js` is `null`, so current releases keep working.

To turn it on:

1. On a trusted machine, run `node tools/sign-manifest.js keygen <private-key-file>`. Keep that file offline and out of every repository. The command prints the public key.
2. Paste the public key (PEM) into `SIGNING_PUBLIC_KEY`, and ship that as a normal release. Older installs that lack the key keep accepting unsigned manifests until they update.
3. For every later release, after the workflow publishes `latest.json`, run `node tools/sign-manifest.js sign latest.json <private-key-file>` and publish the resulting `latest.json.sig` next to it on the Pages branch. `tools\release.bat --key <private-key-file>` does this for you and refuses to publish an unsigned manifest once a key is embedded.

Once a build carries the key, it refuses a manifest with a missing or invalid signature. Losing the key means shipping a new key in a release signed by the old one, so back it up offline. Do not set the key before you can publish `.sig` files, or updates stop working.

## Recommended hardening (remaining)

Pick from these, in order of effort:

1. **Protect the publishing path.** Require review for changes to `.github/workflows/`, restrict who can push to `main` and `gh-pages`, and limit the workflow token to the permissions in the release workflow. No code change is needed.
2. **Rotate keys safely.** Ship a release signed by the old key that carries the new public key before retiring the old one.
3. **Authenticode-sign the launcher** if a code-signing certificate is available. Windows then shows publisher information and SmartScreen can use it.

Until one of these is in place, treat the update path as trust in GitHub access controls.
