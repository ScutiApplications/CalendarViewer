// The event search box and its filters (one calendar, Teams meetings only).
const searchSource = document.getElementById('search-source');
const searchTeams = document.getElementById('search-teams');
let searchSourceSignature = '';
const searchTools = document.getElementById('search-tools');
const searchOptionsToggle = document.getElementById('search-options-toggle');
const SEARCH_OPTIONS_KEY = 'ics-calendar-viewer.searchOptionsCollapsed.v1';

// Keep the calendar list in step with the sidebar; the chosen calendar stays selected while it still exists.
function refreshSearchSources() {
  const signature = sources.map(s => s.id + ':' + s.name).join('|');
  if (signature === searchSourceSignature) return;
  searchSourceSignature = signature;
  const chosen = searchSource.value;
  searchSource.replaceChildren();
  const all = create('option', '', 'All calendars');
  all.value = '';
  searchSource.append(all);
  sources.forEach(source => { const option = create('option', '', source.name); option.value = String(source.id); searchSource.append(option); });
  searchSource.value = sources.some(s => String(s.id) === chosen) ? chosen : '';
  readSearchFilters();
}
function readSearchFilters() {
  searchFilters = { sourceId: searchSource.value || undefined, teamsOnly: searchTeams.checked || undefined };
}
// " in Work, with a Teams link" for the summaries, or '' when no filter is on.
function searchFilterText() {
  const parts = [];
  if (searchFilters.sourceId) parts.push(' in ' + (searchSource.selectedOptions[0]?.textContent || 'one calendar'));
  if (searchFilters.teamsOnly) parts.push(' with a Teams link');
  return parts.join(',');
}

function updateSearchStatus(count, total) {
  refreshSearchSources();
  const active = CalendarSearch.active(searchQuery, searchFilters);
  clearSearch.disabled = !searchQuery && !searchFilters.sourceId && !searchFilters.teamsOnly;
  document.getElementById('search-all').disabled = !active;
  searchTools.classList.toggle('idle', !active);
  searchOptionsToggle.toggleAttribute('data-active', !!(searchFilters.sourceId || searchFilters.teamsOnly));
  searchStatus.textContent = active
    ? (count ? count + ' of ' + total + ' events match in this date range.' : 'No matching events in this date range. Clear search or change dates.')
    : 'Search titles and locations in the displayed date range.';
}

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  calendar.refetchEvents();
});
[searchSource, searchTeams].forEach(control => control.addEventListener('change', () => {
  readSearchFilters();
  calendar.refetchEvents();
}));
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape' && (searchInput.value || searchFilters.sourceId || searchFilters.teamsOnly)) {
    event.preventDefault();
    resetSearch();
  }
});
function resetSearch() {
  searchQuery = '';
  searchInput.value = '';
  searchSource.value = '';
  searchTeams.checked = false;
  readSearchFilters();
  searchInput.focus();
  calendar.refetchEvents();
}
clearSearch.addEventListener('click', resetSearch);

// Collapsed (the default) leaves only the search box and the calendar's date bar; the Filters button opens the rest. The choice is remembered.
function setSearchOptions(open, remember) {
  searchTools.classList.toggle('options-collapsed', !open);
  searchOptionsToggle.setAttribute('aria-expanded', String(open));
  searchOptionsToggle.title = open ? 'Hide filters' : 'Show filters';
  if (remember) { try { localStorage.setItem(SEARCH_OPTIONS_KEY, open ? '0' : '1'); } catch { /* Not remembered. */ } }
}
searchOptionsToggle.addEventListener('click', () => setSearchOptions(searchOptionsToggle.getAttribute('aria-expanded') !== 'true', true));
// Collapsed unless the person opened it before.
let searchOpen = false;
try { searchOpen = localStorage.getItem(SEARCH_OPTIONS_KEY) === '0'; } catch { /* Collapsed by default. */ }
setSearchOptions(searchOpen, false);
