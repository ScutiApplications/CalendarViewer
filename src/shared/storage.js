(function (root) {
  function write(storage, values, validateOnly = false) {
    const staging = 'ics-calendar-viewer.restore-staging';
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, storage.getItem(key)]));
    try {
      storage.setItem(staging, JSON.stringify(values));
      storage.removeItem(staging);
      if (validateOnly) return;
      for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
    } catch (error) {
      storage.removeItem(staging);
      if (!validateOnly) {
        for (const [key, value] of Object.entries(previous)) {
          if (value === null) storage.removeItem(key); else storage.setItem(key, value);
        }
      }
      throw new Error('Could not save restored settings: ' + error.message);
    }
  }
  const api = { write };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalendarStorage = api;
})(globalThis);
