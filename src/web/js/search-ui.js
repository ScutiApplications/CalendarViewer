// The event search box.
function updateSearchStatus(count, total) {
  clearSearch.disabled = !searchQuery;
  searchStatus.textContent = searchQuery.trim()
    ? (count ? count + ' of ' + total + ' events match in this date range.' : 'No matching events in this date range. Clear search or change dates.')
    : 'Search titles and locations in the displayed date range.';
}

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  calendar.refetchEvents();
});
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape' && searchInput.value) {
    event.preventDefault();
    resetSearch();
  }
});
function resetSearch() {
  searchQuery = '';
  searchInput.value = '';
  searchInput.focus();
  calendar.refetchEvents();
}
clearSearch.addEventListener('click', resetSearch);
