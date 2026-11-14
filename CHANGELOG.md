# Changelog

## Unreleased

## 1.2.5

### Changed

- Maintenance release. No user-facing changes.

## 1.2.4

### Changed

- Check for updates now reports a new version right away, without a restart or a wait for the 5-minute cache.
- In portrait and mobile, the menu button sits in the date row.

## 1.2.3

### Changed

- The red now-indicator no longer appears when the visible week has no today column.
- In landscape, the search box and date title share one line. Portrait and mobile keep two lines.

## 1.2.2

### Changed

- The header is merged into the sidebar: the Calendar Viewer title and the duplicate Read-only badge are gone, and the theme switch sits in the sticky sidebar footer.
- With the filters collapsed, the header shows only the search box and the date title in every layout.

## 1.2.1

### Changed

- Maintenance release. No user-facing changes.

## 1.2.0

### Changed

- Internal cleanup of free-time search and summary notifications. How the app looks and works is unchanged.

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

- `tools\release.bat` replaces the manual version bump; `pnpm run check` is the local quality gate.
