// Storage keys and the page state shared by every other script.
const PALETTE = ['#2563eb', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777'];
const LOCAL_SOURCES_KEY = 'ics-calendar-viewer.localSources.v1';
const FEED_CACHE_KEY = 'ics-calendar-viewer.feedSnapshots.v1';
const FEED_PREFERENCES_KEY = 'ics-calendar-viewer.feedPreferences.v1';
let restoringBackup = false;
const snoozedOccurrences = new Map();
const sources = []; // {id, name, color, enabled, events: ICAL.Event[]}
let nextId = 1;
const HIDE_CANCELLED_KEY = 'ics-calendar-viewer.hideCancelled.v1';
const VIEW_KEY = 'ics-calendar-viewer.view.v1';
let responsiveMode = typeof window === 'undefined' ? 'desktop' : CalendarLayout.mode(window.innerWidth, window.innerHeight);
const savedView = store.get(CalendarLayout.viewKey(responsiveMode, VIEW_KEY));
const initialView = CalendarLayout.view(responsiveMode, savedView);
let searchQuery = '';
let searchFilters = {}; // { sourceId, teamsOnly } from the search filters under the search box
const searchInput = document.getElementById('event-search');
const clearSearch = document.getElementById('clear-search');
const searchStatus = document.getElementById('search-status');
let hideCancelled = store.get(HIDE_CANCELLED_KEY) === 'true';
let backgroundFeedHealth = new Map();
let backgroundReachable = false;

const ALERT_RULES_KEY = 'ics-calendar-viewer.alertRules.v1';
const ALERT_FIRED_KEY = 'ics-calendar-viewer.alertsFired.v1';
let alertRules = sanitizeRules(store.json(ALERT_RULES_KEY, null));
let firedAlerts = store.json(ALERT_FIRED_KEY, {});
const BELL_PATH = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
const BELL_OFF_PATH = BELL_PATH + '<path d="M3 3l18 18"/>';
