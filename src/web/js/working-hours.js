// Working hours: saved range, shaded business hours, and the two sidebar time inputs.
// Hours outside this range, and weekends, are shaded in every view. A start later than the end (22:00 to 06:00)
// is an overnight shift: the early-morning part belongs to the day after the shift starts.
const HOURS_KEY = 'ics-calendar-viewer.workingHours.v1';
const endOfDay = time => (time === '00:00' ? '24:00' : time); // an end of 12 AM means midnight at the end of the day
function loadWorkingHours() {
  const h = store.json(HOURS_KEY, null);
  if (h && /^\d\d:\d\d$/.test(h.start) && /^\d\d:\d\d$/.test(h.end) && h.start !== h.end) return h;
  return { start: '08:00', end: '18:00' };
}
let workingHours = loadWorkingHours();
function businessHours() {
  const { start, end } = workingHours;
  if (start < endOfDay(end)) return { daysOfWeek: [1, 2, 3, 4, 5], startTime: start, endTime: endOfDay(end) };
  return [
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: start, endTime: '24:00' },
    { daysOfWeek: [2, 3, 4, 5, 6], startTime: '00:00', endTime: end }
  ];
}

// ---- Working hours ----
const hoursStart = document.getElementById('hours-start');
const hoursEnd = document.getElementById('hours-end');
hoursStart.value = workingHours.start;
hoursEnd.value = workingHours.end;
function applyWorkingHours() {
  if (hoursStart.value && hoursEnd.value && hoursStart.value !== hoursEnd.value) {
    workingHours = { start: hoursStart.value, end: hoursEnd.value };
    store.set(HOURS_KEY, JSON.stringify(workingHours)); // a failed save still applies for this visit
    calendar.setOption('businessHours', businessHours());
  } else {
    hoursStart.value = workingHours.start;
    hoursEnd.value = workingHours.end;
    setStatus('Working hours: the start and end must be different.');
  }
}
hoursStart.onchange = applyWorkingHours;
hoursEnd.onchange = applyWorkingHours;
