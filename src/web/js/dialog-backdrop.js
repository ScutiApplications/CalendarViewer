// Every dialog closes when the dimmed area outside it is pressed, the same as pressing Escape (the cancel event runs
// first, so a dialog that is busy can still refuse). Both the press and the release must land outside, so selecting
// text inside a dialog and letting go outside does not close it.
(() => {
  let pressed = null;
  document.addEventListener('pointerdown', event => { pressed = event.target instanceof HTMLDialogElement ? event.target : null; }, true);
  document.addEventListener('click', event => {
    const dialog = event.target, started = pressed;
    pressed = null;
    if (!(dialog instanceof HTMLDialogElement) || !dialog.open || started !== dialog) return;
    if (typeof dialog.requestClose === 'function') dialog.requestClose();
    else if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
  }, true);
})();
