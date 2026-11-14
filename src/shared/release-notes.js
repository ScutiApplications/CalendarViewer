// Keep entries paired with published VERSION values. Content is rendered as text, never HTML.
(function (root) {
  const releases = [
    { version: '1.2.0', changes: [
      'Internal cleanup of free-time search and summary notifications. How the app looks and works is unchanged.'
    ] },
    { version: '1.1.0', changes: [
      'Find free time across all calendars, plus Next free slot, Focus time, Overlaps and Week summary. Show jumps to the matching week.',
      'Join now button for a Teams meeting that is running or starts within 10 minutes.',
      'Search all dates, with filters for one calendar or Teams meetings only. The search area starts collapsed.',
      'Private notes on events, kept in this browser and in backups only, never added to a calendar.',
      'Daily agenda and weekly summary Windows notifications at times you choose.',
      'Export the displayed range as .ics, print a fitted A4 view, keyboard shortcuts, a second time zone, first day of week, 12 or 24 hour clock and high-contrast mode.',
      'MCP access needs a token generated in Settings; regenerate or revoke it at any time.',
      'Update checks verify a signed release manifest. A release can require an update, which shows a dialog that stays until the update is installed.',
      'What’s new appears after every update, tracked by the application rather than by browser storage.',
      'Clearer calendar link errors, and a link that is already saved is refused with the name of the existing calendar.'
    ] },
    { version: '1.0.6', changes: [
      'Saved API keys use Windows DPAPI encryption tied to the Windows account running CalendarViewer. Existing plaintext keys migrate on startup.',
      'Calendar starts while keys unlock; assistant settings show progress and recovery options for unavailable keys.',
      'Hardened calendar-tool dispatch and argument validation, provider validation, download fixture URL checks and workflow permissions.',
      'Encrypted keys may need re-entering after moving to another PC or Windows account. Calendar data and old backup copies are not encrypted by this feature.'
    ] },
    { version: '1.0.5', changes: [
      'Read the Philippines-focused Privacy Policy, Terms of Use and Cookies & Local Storage pages from Settings.',
      'Choose hosted-AI sharing separately for each provider; withdraw consent from Settings or chat. Built-in models remain local.',
      'Calendar imports show privacy notices, including drag and drop.',
      'What’s new shows bundled release notes once per version in this browser and can be reopened from update settings.'
    ] },
    { version: '1.0.4', changes: [
      'run.bat stop also stops CalendarViewer’s private Laya Python and installer processes, including orphaned workers.',
      'Unrelated Python applications remain running.'
    ] },
    { version: '1.0.3', changes: [
      'Built-in setup shows preparation stages, elapsed time and download progress.',
      'Laya setup reports useful error details, allows more time for verification and reuses verified model downloads.'
    ] },
    { version: '1.0.2', changes: [
      'Update installation shows animated progress and clearer installation states.',
      'Lost install responses recover through status checks; unavailable installation actions explain why.'
    ] },
    { version: '1.0.1', changes: [
      'Laya dependency installation uses the system certificate store without requiring an environment variable.'
    ] },
    { version: '1.0.0', changes: [
      'First stable portable release: combine ICS calendars, imported files, reminders and a read-only calendar assistant.',
      'Check GitHub releases automatically; download and installation start only when requested.'
    ] }
  ];
  function parts(value) {
    if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) return null;
    const numbers = value.split('.').map(Number);
    return numbers.every(Number.isSafeInteger) ? numbers : null;
  }
  function compare(left, right) {
    const a = parts(left), b = parts(right);
    if (!a || !b) return null;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    return 0;
  }
  const through = version => parts(version) ? releases.filter(item => compare(item.version, version) <= 0) : [];
  const since = (previous, version) => through(version).filter(item => !parts(previous) || compare(item.version, previous) > 0);
  const api = { releases, compare, through, since };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalendarReleases = api;
})(globalThis);
