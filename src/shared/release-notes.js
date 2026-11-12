// Keep entries paired with published VERSION values. Content is rendered as text, never HTML.
(function (root) {
  const releases = [
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
