// Runs before first paint so the saved theme shows without a flash. External file, so the CSP needs no inline script.
(function () {
  try { var t = localStorage.getItem('calendar-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { }
})();
