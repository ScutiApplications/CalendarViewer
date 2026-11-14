# Update integrity and trust model

## What the installer verifies

1. `latest.json` is read from the fixed GitHub Pages URL for this repository.
2. The download address must be a versioned release ZIP of `ScutiApplications/CalendarViewer` on `github.com`.
3. The ZIP must match the `sha256` and `size` recorded in `latest.json`.
4. The Ed25519 signature `latest.json.sig` must match the exact manifest bytes (`SIGNING_PUBLIC_KEY` in `src/server/update-manifest.js`).
5. The ZIP is staged while the old server keeps running. A failed start restores the previous files.

## What this does not prove

The checksum and the ZIP come from the same publisher path. A SHA-256 value proves the download was not corrupted or swapped in transit. It does not prove who produced the release. Anyone who can write both the release asset and `latest.json` (for example, with a stolen repository token or a compromised Actions run) can ship code that the installer accepts.

## Manifest signing (on)

The app embeds the maintainer's Ed25519 public key (`SIGNING_PUBLIC_KEY`). It refuses a manifest whose `latest.json.sig` is missing or invalid, so a stolen repository token cannot forge an update that installs.

Every release is signed offline. `tools\release.bat` signs `latest.json` with the private key (default `%USERPROFILE%\Documents\calendarviewer-signing.pem`, or the file named by `CV_SIGNING_KEY`) and publishes `latest.json.sig` next to it on the Pages branch. It refuses to publish an unsigned manifest. Create a key once with `node tools/sign-manifest.js keygen <private-key-file>`, keep it offline and out of every repository, and back it up. Losing the key means shipping a new public key in a release signed by the old one, so keep a backup.

## Recommended hardening (remaining)

Pick from these, in order of effort:

1. **Protect the publishing path.** Require review for changes to `.github/workflows/`, restrict who can push to `main` and `gh-pages`, and limit the workflow token to the permissions in the release workflow. No code change is needed.
2. **Rotate keys safely.** Ship a release signed by the old key that carries the new public key before retiring the old one.
3. **Authenticode-sign the launcher** if a code-signing certificate is available. Windows then shows publisher information and SmartScreen can use it.

Until one of these is in place, treat the update path as trust in GitHub access controls.
