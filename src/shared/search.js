(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalendarSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function matches(event, query) {
    const term = String(query || '').trim().toLowerCase();
    if (!term) return true;
    return [event.title, event.extendedProps && event.extendedProps.location]
      .some(value => String(value || '').toLowerCase().includes(term));
  }
  return { matches };
});
