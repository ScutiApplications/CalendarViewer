# Changelog

## Unreleased

## 1.1.0

### Added

- Find free time across all calendars, plus Next free slot, Focus time, Overlaps and Week summary. Show jumps to the matching week.
- Join now button for a Teams meeting that is running or starts within 10 minutes.
- Search all dates, with filters for one calendar or Teams meetings only. The search area starts collapsed.
- Private notes on events, kept in this browser and in backups only, never added to a calendar.
- Daily agenda and weekly summary Windows notifications at times you choose.
- Export the displayed range as .ics, print a fitted A4 view, keyboard shortcuts, a second time zone, first day of week, 12 or 24 hour clock and high-contrast mode.
- MCP access needs a token generated in Settings; regenerate or revoke it at any time.
- Update checks verify a signed release manifest. A release can require an update, which shows a dialog that stays until the update is installed.
- What’s new appears after every update, tracked by the application rather than by browser storage.

### Changed

- Clearer calendar link errors, and a link that is already saved is refused with the name of the existing calendar.

### Maintainer

- Run `node tools/sign-manifest.js keygen <file>`, store the private key outside the repository, and set `SIGNING_PUBLIC_KEY` in `src/server/update-manifest.js` before the first signed release.
- `tools\release.bat` replaces the manual version bump; `pnpm run check` is the local quality gate and `.githooks/pre-push` runs it.
