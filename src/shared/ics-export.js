// @ts-check
// Builds an .ics file from the events shown on the page. Shared by the page (global CalendarIcsExport) and tests (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalendarIcsExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const escapeText = value => String(value == null ? '' : value)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  // RFC 5545 limits lines to 75 octets; continuation lines start with one space.
  function fold(line) {
    const bytes = octets(line);
    if (bytes.length <= 75) return line;
    const parts = [];
    let current = '', size = 0;
    for (const char of line) {
      const width = octets(char).length;
      if (size + width > (parts.length ? 74 : 75)) { parts.push(current); current = ''; size = 0; }
      current += char; size += width;
    }
    parts.push(current);
    return parts.join('\r\n ');
  }
  function octets(text) { return new TextEncoder().encode(text); }
  const pad = n => String(n).padStart(2, '0');
  const utc = d => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  const day = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());

  // events: {title, start, end, allDay, extendedProps: {uid, location, description}}; now: Date used for DTSTAMP.
  function buildIcs(events, now = new Date()) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CalendarViewer//Merged view//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    events.forEach((event, index) => {
      if (!event.start) return;
      const p = event.extendedProps || {};
      lines.push('BEGIN:VEVENT');
      // A recurring series shares one UID, so each occurrence gets its own start in the UID.
      lines.push('UID:' + escapeText((p.uid || 'event-' + index) + '-' + event.start.getTime()) + '@calendarviewer');
      lines.push('DTSTAMP:' + utc(now));
      if (event.allDay) {
        lines.push('DTSTART;VALUE=DATE:' + day(event.start));
        lines.push('DTEND;VALUE=DATE:' + day(event.end || new Date(event.start.getFullYear(), event.start.getMonth(), event.start.getDate() + 1)));
      } else {
        lines.push('DTSTART:' + utc(event.start));
        if (event.end) lines.push('DTEND:' + utc(event.end));
      }
      lines.push('SUMMARY:' + escapeText(event.title));
      if (p.location) lines.push('LOCATION:' + escapeText(p.location));
      if (p.description) lines.push('DESCRIPTION:' + escapeText(p.description));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  return { buildIcs, escapeText };
});
