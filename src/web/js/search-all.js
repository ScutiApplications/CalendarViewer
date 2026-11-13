// Search every enabled calendar across one year back and one year ahead, not only the displayed range.
const SEARCH_ALL_DAYS = 365;
const SEARCH_ALL_LIMIT = 200;
const searchAllDialog = document.getElementById('search-all-dialog');

function runSearchAll() {
  const query = searchQuery.trim();
  const filterText = searchFilterText();
  const list = document.getElementById('search-all-results');
  const summary = document.getElementById('search-all-summary');
  list.replaceChildren();
  const today = new Date(), from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - SEARCH_ALL_DAYS);
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + SEARCH_ALL_DAYS);
  let events;
  try { events = visibleEvents(expandSources(sources, from, to), hideCancelled).filter(event => CalendarSearch.matches(event, query, searchFilters)); }
  catch (error) { summary.textContent = 'Search failed: ' + error.message; return; }
  events.sort((a, b) => a.start - b.start);
  const enabled = sources.filter(s => s.enabled).length;
  summary.textContent = events.length
    ? events.length + (events.length === 1 ? ' event matches' : ' events match') + (query ? ' “' + query + '”' : '') + filterText + ' from the past year to the next year across ' + enabled + ' calendars' +
      (events.length > SEARCH_ALL_LIMIT ? '. Showing the first ' + SEARCH_ALL_LIMIT + '. Refine the search to narrow it.' : '.')
    : 'No events match' + (query ? ' “' + query + '”' : '') + filterText + ' from the past year to the next year.';
  events.slice(0, SEARCH_ALL_LIMIT).forEach(event => {
    const item = create('li');
    const text = create('span', 'free-when', event.title);
    const detail = create('small', 'free-alt', eventWhenText(event) + (event.extendedProps.sources?.length ? ' · ' + event.extendedProps.sources.join(', ') : ''));
    const go = create('button', '', 'Show');
    go.type = 'button';
    go.onclick = () => { searchAllDialog.close(); showOnCalendar(event.start, event.end, event.title + ': ' + eventWhenText(event), event.allDay); };
    item.append(text, detail, go);
    list.append(item);
  });
}

document.getElementById('search-all').onclick = () => { runSearchAll(); searchAllDialog.showModal(); };
document.getElementById('search-all-close').onclick = () => searchAllDialog.close();
