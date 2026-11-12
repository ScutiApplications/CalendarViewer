// Theme buttons (the saved theme is applied earlier by theme-init.js).
const THEME_KEY = 'calendar-theme';
function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll('[data-theme-choice]').forEach(button =>
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === (choice === 'light' || choice === 'dark' ? choice : 'system'))));
}
applyTheme(store.get(THEME_KEY) || 'system');
document.querySelectorAll('[data-theme-choice]').forEach(button => {
  button.onclick = () => {
    const choice = button.dataset.themeChoice;
    store.set(THEME_KEY, choice);
    applyTheme(choice);
  };
});
