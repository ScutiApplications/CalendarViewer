// @ts-check
// Shared policy for initial load, resizing and saved view preferences.
(function (root) {
  const profiles = {
    desktop: { defaultView: 'timeGridWorkWeek', views: ['timeGridDay', 'timeGridWorkWeek', 'timeGridWeek', 'dayGridMonth', 'listWeek'] },
    portrait: { defaultView: 'timeGridThreeDay', views: ['timeGridThreeDay', 'listWeek'] },
    mobile: { defaultView: 'listDay', views: ['listDay', 'timeGridDay'] }
  };
  function mode(width, height) {
    if (width <= 600) return 'mobile';
    return width <= 1100 || height >= width ? 'portrait' : 'desktop';
  }
  function profile(name) { return profiles[name] || profiles.desktop; }
  function view(name, saved) {
    const p = profile(name);
    return p.views.includes(saved) ? saved : p.defaultView;
  }
  function viewKey(name, base) { return name === 'desktop' ? base : base + '.' + name; }
  const api = { mode, profile, view, viewKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalendarLayout = api;
})(globalThis);
