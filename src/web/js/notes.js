// Private notes on events. They live only in this browser (and in backups), never in the calendar feed.
// Notes are shown in their own amber frame so they cannot be mistaken for calendar content.
const NOTES_KEY = 'ics-calendar-viewer.eventNotes.v1';
const NOTE_MAX_CHARS = 2000;
const NOTE_MAX_COUNT = 500;
let eventNotes = (() => {
  const raw = store.json(NOTES_KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
})();
// A note belongs to one occurrence, or to every occurrence of a repeating event ("|*" key). An occurrence note wins.
const noteKey = event => eventAlertKey(event.extendedProps.uid, event.title) + '|' + (event.start ? event.start.getTime() : 0);
const seriesNoteKey = event => eventAlertKey(event.extendedProps.uid, event.title) + '|*';
const noteFor = event => eventNotes[noteKey(event)] || eventNotes[seriesNoteKey(event)];
const hasNote = event => !!noteFor(event)?.text;

function saveNote(event, text, all) {
  const key = all ? seriesNoteKey(event) : noteKey(event), other = all ? noteKey(event) : seriesNoteKey(event);
  const value = String(text).slice(0, NOTE_MAX_CHARS);
  if (!value.trim()) delete eventNotes[key];
  else {
    if (!eventNotes[key] && Object.keys(eventNotes).length >= NOTE_MAX_COUNT) return false;
    eventNotes[key] = { text: value, updated: new Date().toISOString() };
    delete eventNotes[other];
  }
  store.set(NOTES_KEY, JSON.stringify(eventNotes), 'Could not save the note');
  return true;
}

// A small amber "Note" tag on cards that have a note.
function appendNoteBadge(parent, event) {
  if (!hasNote(event)) return;
  const badge = create('span', 'note-badge', 'Note');
  badge.title = 'You have a private note on this event';
  parent.append(badge);
}

// The note box in the event dialog.
const noteBox = document.getElementById('event-note');
const noteAll = document.getElementById('note-all');
let noteEvent = null, noteTimer = 0;
function showNote(event) {
  clearTimeout(noteTimer);
  noteEvent = event;
  const own = eventNotes[noteKey(event)];
  noteBox.value = (own || eventNotes[seriesNoteKey(event)])?.text || '';
  noteAll.checked = !own && !!eventNotes[seriesNoteKey(event)];
  document.getElementById('note-hint').textContent = 'Saved in this browser only, not in the calendar. Included in backups.';
}
function flushNote() {
  clearTimeout(noteTimer);
  if (!noteEvent) return;
  const had = hasNote(noteEvent);
  const before = noteFor(noteEvent)?.text;
  if (!saveNote(noteEvent, noteBox.value, noteAll.checked)) {
    document.getElementById('note-hint').textContent = 'Too many notes (' + NOTE_MAX_COUNT + '). Clear an old one first.';
    return;
  }
  if (had !== hasNote(noteEvent) || before !== noteFor(noteEvent)?.text) calendar.refetchEvents();
}
noteAll.addEventListener('change', flushNote);
noteBox.addEventListener('input', () => { clearTimeout(noteTimer); noteTimer = setTimeout(flushNote, 500); });
document.getElementById('dlg').addEventListener('close', () => { flushNote(); noteEvent = null; });
