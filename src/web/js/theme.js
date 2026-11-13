// Theme buttons (the saved theme is applied earlier by theme-init.js).
const THEME_KEY = 'calendar-theme';
function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll('[data-theme-choice]').forEach(button =>
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === (choice === 'light' || choice === 'dark' ? choice : 'system'))));
  const isDark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const toggle = document.getElementById('theme-toggle');
  toggle.textContent = isDark ? 'Light theme' : 'Dark theme';
  toggle.setAttribute('aria-label', 'Switch to ' + (isDark ? 'light' : 'dark') + ' theme');
}
applyTheme(store.get(THEME_KEY) || 'system');

document.getElementById('theme-toggle').onclick = () => {
  const choice = store.get(THEME_KEY) || 'system';
  const isDark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDark ? 'light' : 'dark';
  store.set(THEME_KEY, next);
  applyTheme(next);
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.get(THEME_KEY) || 'system'));
document.querySelectorAll('[data-theme-choice]').forEach(button => {
  button.onclick = () => {
    const choice = button.dataset.themeChoice;
    store.set(THEME_KEY, choice);
    applyTheme(choice);
  };
});
