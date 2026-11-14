const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const pad = n => String(n).padStart(2, '0');
const stamp = d => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
// Two overlapping events today plus one later, built from the browser clock so they land in view.
function fixture() {
  const event = (uid, title, hour, minute, length) => {
    const start = new Date(); start.setHours(hour, minute, 0, 0);
    return ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:20260101T000000Z', 'SUMMARY:' + title,
      'DTSTART:' + stamp(start), 'DTEND:' + stamp(new Date(start.getTime() + length * 60000)), 'LOCATION:Room 1', 'END:VEVENT'].join('\r\n');
  };
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//EN',
    event('a', 'Standup', 9, 0, 60), event('b', 'Design review', 9, 30, 60), event('c', 'Workshop', 14, 0, 90), 'END:VCALENDAR'].join('\r\n');
}

// First-visit dialogs (release notes) would block shortcuts, so dismiss anything open.
async function ready(page, { collapsed = false } = {}) {
  // The release-notes dialog opens a moment after load on a first visit. On a cold start it could open after the dialogs
  // were closed below and cover the page, so a click timed out. Mark the notes as already seen instead.
  await page.addInitScript(() => { try { localStorage.setItem('ics-calendar-viewer.releaseNotes.v1', '99.0.0'); } catch { /* storage unavailable */ } });
  // The search filters start collapsed. Most tests use them, so open them unless a test checks the default.
  if (!collapsed) await page.addInitScript(() => { try { localStorage.setItem('ics-calendar-viewer.searchOptionsCollapsed.v1', '0'); } catch { /* storage unavailable */ } });
  await page.goto('/');
  await page.waitForSelector('.fc');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  // Settings are a disclosure in the redesigned sidebar; legacy preference tests use them directly.
  if (await page.locator('#display-settings').count()) await page.locator('#display-settings').evaluate(el => { el.open = true; });
}

async function addFixture(page) {
  await page.evaluate(text => {
    sources.push({ id: nextId++, name: 'E2E', alertKey: 'x:e2e', color: '#2563eb', enabled: true, events: parseIcs(text), icsText: text });
    renderSources();
    calendar.changeView('timeGridDay');
    calendar.today();
    calendar.refetchEvents();
  }, fixture());
  await expect(page.locator('.fc-event')).toHaveCount(3);
}

test('events render, overlap is flagged and details open', async ({ page }) => {
  await ready(page);
  await addFixture(page);
  await expect(page.locator('.event-card.has-conflict')).toHaveCount(2);
  await page.locator('.fc-event', { hasText: 'Workshop' }).click();
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dt')).toHaveText('Workshop');
  await expect(page.locator('#event-location')).toHaveText('Room 1');
});

test('keyboard shortcuts switch view, focus search and open the shortcut list', async ({ page }) => {
  await ready(page);
  await page.locator('body').press('m');
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  await page.locator('body').press('/');
  await expect(page.locator('#event-search')).toBeFocused();
  await page.locator('#event-search').press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.locator('body').press('?');
  await expect(page.locator('#shortcuts-dialog')).toBeVisible();
});

test('free-time finder lists slots that avoid busy time', async ({ page }) => {
  await ready(page);
  await addFixture(page);
  await page.locator('#open-free-time').click();
  await expect(page.locator('#free-time-dialog')).toBeVisible();
  await page.locator('#free-minutes').fill('30');
  await page.locator('#free-time-form button[type=submit]').click();
  await expect(page.locator('.free-list li').first()).toBeVisible();
  await expect(page.locator('.free-pick:checked')).toHaveCount(3);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy selected as text' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^I am free for 30 minutes at these times \(.+\):\r?\n- /);
});

test('export view downloads an .ics file with the shown events', async ({ page }) => {
  await ready(page);
  await addFixture(page);
  const download = page.waitForEvent('download');
  await page.locator('#export-view').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^calendar-view-\d{4}-\d{2}-\d{2}\.ics$/);
  const text = require('node:fs').readFileSync(await file.path(), 'utf8');
  expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  expect(text).toContain('SUMMARY:Design review');
});

for (const scheme of ['light', 'dark']) {
  test(`no serious or critical axe violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await ready(page);
    await addFixture(page);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | '))).toEqual([]);
  });
}

test('week start and 24-hour clock preferences apply and persist', async ({ page }) => {
  await ready(page);
  await addFixture(page);
  await page.locator('#week-start').selectOption('1');
  await page.locator('#clock-format').selectOption('24');
  expect(await page.evaluate(() => calendar.getOption('firstDay'))).toBe(1);
  expect(await page.evaluate(() => eventWhenText(calendar.getEvents()[0]))).not.toMatch(/AM|PM/);
  await page.reload();
  await page.waitForSelector('.fc');
  await expect(page.locator('#week-start')).toHaveValue('1');
  await expect(page.locator('#clock-format')).toHaveValue('24');
  expect(await page.evaluate(() => calendar.getOption('firstDay'))).toBe(1);
});

test('a failed feed shows its reason under the calendar', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    sources.push({ id: nextId++, feedId: 'f-bad', alertKey: 'f:bad', name: 'Broken', color: '#2563eb', enabled: true, events: [], failed: true,
      error: 'Link rejected (HTTP 403). It may have expired or been revoked.' });
    renderSources();
  });
  await expect(page.locator('.source-error')).toContainText('Link rejected (HTTP 403)');
});

test('all-day events block free time only when asked', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const day = new Date();
    const stamp = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    // Cover the whole 7 day search so the test does not depend on the time of day or the weekday.
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 8);
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//EN', 'BEGIN:VEVENT', 'UID:leave', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Leave',
      'DTSTART;VALUE=DATE:' + stamp(day), 'DTEND;VALUE=DATE:' + stamp(next), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    sources.push({ id: nextId++, name: 'Leave', alertKey: 'x:leave', color: '#2563eb', enabled: true, events: parseIcs(text), icsText: text });
    workingHours = { start: '00:00', end: '23:59' };
    calendar.refetchEvents();
  });
  await page.locator('#open-free-time').click();
  await page.locator('#free-range').selectOption('7');
  await page.locator('#free-time-form button[type=submit]').click();
  const first = await page.locator('.free-list li').count();
  expect(first).toBeGreaterThan(0);
  await page.locator('#free-allday').check();
  await page.locator('#free-time-form button[type=submit]').click();
  await expect(page.locator('#free-time-results')).toContainText('No free');
});

test.describe('compact layouts', () => {
  test('a phone opens the agenda, shows the menu button and opens settings as a drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'mobile');
    await expect(page.locator('.menu-toggle')).toBeVisible();
    await expect(page.locator('#sidebar')).toBeHidden();
    await page.locator('.menu-toggle').click();
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('#open-free-time')).toBeVisible();
    await page.locator('#sidebar-close').click();
    await expect(page.locator('#sidebar')).toBeHidden();
  });

  test('a phone lists events and opens details on tap', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    await page.evaluate(text => {
      sources.push({ id: nextId++, name: 'E2E', alertKey: 'x:e2e', color: '#2563eb', enabled: true, events: parseIcs(text), icsText: text });
      renderSources();
      calendar.changeView('listDay');
      calendar.today();
      calendar.refetchEvents();
    }, fixture());
    await expect(page.locator('.agenda-card')).toHaveCount(3);
    await page.locator('.agenda-card', { hasText: 'Workshop' }).click();
    await expect(page.locator('#dlg')).toBeVisible();
  });

  test('a tablet in portrait uses the compact header too', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 1100 });
    await ready(page);
    await expect(page.locator('html')).not.toHaveAttribute('data-layout', 'desktop');
  });

  test('no serious axe violations on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | '))).toEqual([]);
  });
});

test('standard themes ignore legacy high contrast preferences', async ({ page }) => {
  await page.emulateMedia({ contrast: 'more' });
  await page.addInitScript(() => localStorage.setItem('calendar-contrast', 'high'));
  await ready(page);
  await expect(page.locator('#high-contrast')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-contrast', 'high');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-contrast', 'high');
});

test('workspace groups settings and exposes event time and overlap labels', async ({ page }) => {
  await ready(page);
  await page.reload();
  await expect(page.locator('#display-settings')).not.toHaveAttribute('open', '');
  await expect(page.locator('.sidebar-foot')).toContainText('view-only');
  await page.locator('#display-settings > summary').click();
  await expect(page.locator('#hours-start')).toBeVisible();
  await addFixture(page);
  await expect(page.locator('.fc-timegrid-event .event-time')).toHaveCount(3);
  await expect(page.locator('.fc-timegrid-event .conflict-badge')).toHaveCount(2);
  await expect(page.locator('#up-next')).toHaveCSS('background-color', 'rgb(36, 36, 36)');
});

test('calendar colour choices come from the palette', async ({ page }) => {
  await ready(page);
  await addFixture(page);
  await page.locator('.more-button').first().click();
  await page.getByRole('menuitem', { name: 'Colour', exact: true }).click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(6);
  await page.getByRole('menuitemradio', { name: 'Amber', exact: true }).click();
  expect(await page.evaluate(() => sources[0].color.toUpperCase())).toBe('#D97706');
  await expect(page.locator('.src-menu')).toBeHidden();
});

test('a 15-minute overlap with a private note keeps its title visible', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const start = new Date(); start.setHours(10, 30, 0, 0);
    const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const event = (uid, title, minutes) => ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:20260101T000000Z', 'SUMMARY:' + title,
      'DTSTART:' + stamp(start), 'DTEND:' + stamp(new Date(+start + minutes * 60000)), 'END:VEVENT'].join('\r\n');
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//EN', event('short', 'Quick handover', 15), event('long', 'Planning review', 60), 'END:VCALENDAR'].join('\r\n');
    sources.push({ id: nextId++, name: 'Fictional delivery team', alertKey: 'x:short', color: '#D97706', enabled: true, events: parseIcs(text), icsText: text });
    calendar.changeView('timeGridDay'); calendar.today(); calendar.refetchEvents();
    saveNote(calendar.getEvents().find(e => e.title === 'Quick handover'), 'Bring the checklist', false);
    calendar.refetchEvents();
  });
  const short = page.locator('.fc-timegrid-event').filter({ has: page.locator('.event-title', { hasText: /^Quick handover$/ }) });
  await expect(short.locator('.note-badge')).toBeVisible();
  await expect(short.locator('.conflict-badge')).toBeVisible();
  expect((await short.locator('.event-title').boundingBox()).height).toBeGreaterThanOrEqual(12);
});

test('redesigned workspace fits desktop and phone and prints a week on A4', async ({ page }, testInfo) => {
  const visualNow = new Date(); visualNow.setHours(10, 18, 0, 0);
  await page.clock.setFixedTime(visualNow);
  await ready(page);
  await addFixture(page);
  await page.locator('#display-settings').evaluate(el => { el.open = false; });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const view of ['timeGridWeek', 'timeGridDay', 'dayGridMonth', 'listWeek']) {
      await page.evaluate(view => calendar.changeView(view), view);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow, scheme + ' ' + view).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(scheme + '-' + view + '.png') });
    }
  }
  await page.evaluate(() => { calendar.changeView('timeGridWeek'); applyPrintRange(); });
  const pdf = await page.pdf({ format: 'A4', landscape: true, preferCSSPageSize: true, printBackground: true });
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ media: 'screen', colorScheme: 'light' });
  await page.evaluate(() => calendar.changeView('listDay'));
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'mobile');
  expect((await page.locator('.search-filters label').first().boundingBox()).width).toBeGreaterThan(80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('phone-agenda.png') });
});

for (const provider of ['llamacpp', 'hosted']) {
  test(`assistant processing badge describes ${provider} accurately`, async ({ page }, testInfo) => {
    await page.route('**/api/assistant/config', async route => {
      const response = await route.fetch();
      const config = await response.json();
      config.enabled = true;
      await route.fulfill({ response, json: config });
    });
    await page.route('**/api/assistant/status', route => route.fulfill({ json: {
      enabled: true, provider, providerLabel: 'Configured provider', reachable: false, timezone: 'Asia/Manila'
    } }));
    await ready(page);
    await page.locator('#assistant-open').click();
    await expect(page.locator('#assistant-processing')).toHaveText(provider === 'llamacpp' ? 'Runs on this PC' : 'Hosted AI · Sharing consent required');
    await expect(page.locator('#assistant-title')).toHaveText('Ask Calendar');
    await page.screenshot({ path: testInfo.outputPath(provider + '-assistant.png') });
    if (provider === 'llamacpp') {
      await page.getByRole('button', { name: 'Set up Ask Calendar', exact: true }).click();
      await expect(page.locator('#assistant-settings-dialog')).toBeVisible();
      await expect(page.locator('#assistant-dialog')).not.toBeVisible();
    }
  });
}

test('search all dates finds events outside the displayed range', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const day = new Date(); day.setDate(day.getDate() + 90); day.setHours(10, 0, 0, 0);
    const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//EN', 'BEGIN:VEVENT', 'UID:far', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Quarterly planning',
      'DTSTART:' + f(day), 'DTEND:' + f(new Date(day.getTime() + 3600000)), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    sources.push({ id: nextId++, name: 'E2E', alertKey: 'x:far', color: '#2563eb', enabled: true, events: parseIcs(text), icsText: text });
    calendar.today();
  });
  await expect(page.locator('#search-all')).toBeDisabled();
  await page.locator('#event-search').fill('quarterly');
  await expect(page.locator('#search-all')).toBeEnabled();
  await page.locator('#search-all').click();
  await expect(page.locator('#search-all-results li')).toHaveCount(1);
  await expect(page.locator('#search-all-summary')).toContainText('1 event matches');
  await page.locator('#search-all-results button').click();
  await expect(page.locator('#search-all-dialog')).toBeHidden();
});

test('daily agenda setting saves and survives a reload', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#daily-time')).toBeDisabled();
  await page.locator('#daily-enabled').check();
  await expect(page.locator('#daily-time')).toBeEnabled();
  await page.locator('#daily-time').fill('07:45');
  await page.locator('#daily-time').dispatchEvent('change');
  await page.reload();
  await page.waitForSelector('.fc');
  await expect(page.locator('#daily-enabled')).toBeChecked();
  await expect(page.locator('#daily-time')).toHaveValue('07:45');
});

// Events on the next day, so tests do not depend on the time of day they run.
async function addTomorrow(page, name, events) {
  await page.evaluate(({ name, events }) => {
    const pad = n => String(n).padStart(2, '0');
    const stamp = d => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//EN'];
    events.forEach(e => {
      const start = new Date(); start.setDate(start.getDate() + (e.dayOffset ?? 1)); start.setHours(e.hour, e.minute || 0, 0, 0);
      lines.push('BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:20260101T000000Z', 'SUMMARY:' + e.title, 'DTSTART:' + stamp(start),
        'DTEND:' + stamp(new Date(start.getTime() + e.length * 60000)), ...(e.description ? ['DESCRIPTION:' + e.description] : []), 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const text = lines.join('\r\n');
    sources.push({ id: nextId++, name, alertKey: 'x:' + name, color: '#2563eb', enabled: true, events: parseIcs(text), icsText: text });
    workingHours = { start: '00:00', end: '23:59' };
    renderSources();
    calendar.refetchEvents();
  }, { name, events });
}

test('a private note is framed apart from the calendar, saved and shown on the card', async ({ page }) => {
  await ready(page);
  await addFixture(page);
  await page.locator('.fc-event', { hasText: 'Workshop' }).click();
  const note = page.locator('#event-note');
  await expect(page.locator('.note-section')).toBeVisible();
  await expect(page.locator('.note-section')).toHaveCSS('border-top-style', 'dashed');
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).include('#dlg').analyze();
    expect(results.violations.filter(v => ['serious', 'critical'].includes(v.impact)), scheme).toEqual([]);
  }
  await note.fill('Bring the slides');
  await page.locator('#dlg .dialog-close').click();
  await expect(page.locator('.fc-event', { hasText: 'Workshop' }).locator('.note-badge')).toBeVisible();
  await page.locator('.fc-event', { hasText: 'Workshop' }).click();
  await expect(note).toHaveValue('Bring the slides');
  expect(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('ics-calendar-viewer.eventNotes.v1'))).map(n => n.text))).toEqual(['Bring the slides']);
  await note.fill('');
  await page.locator('#dlg .dialog-close').click();
  await expect(page.locator('.note-badge')).toHaveCount(0);
});

test('overlaps, focus time and week summary dialogs list the schedule', async ({ page }) => {
  await ready(page);
  await addTomorrow(page, 'Plan', [
    { uid: 'p1', title: 'Alpha', hour: 10, length: 60 },
    { uid: 'p2', title: 'Beta', hour: 10, minute: 30, length: 60 }
  ]);
  await page.locator('#open-overlaps').click();
  await expect(page.locator('#insights-dialog')).toBeVisible();
  await expect(page.locator('#insights-body')).toContainText('Alpha and Beta');
  await page.locator('#insights-close').click();
  await page.locator('#open-focus').click();
  await expect(page.locator('#insights-body .free-list li').first()).toBeVisible();
  await page.locator('#insights-close').click();
  await page.locator('#open-week-summary').click();
  await expect(page.locator('#insights-body')).toContainText('Time in meetings');
  await expect(page.locator('#insights-body')).toContainText('Longest free stretch');
});

test('next free slot moves the calendar and says when', async ({ page }) => {
  await ready(page);
  await addTomorrow(page, 'Plan', [{ uid: 'n1', title: 'Busy', hour: 0, length: 60, dayOffset: 0 }]);
  await page.locator('body').press('n');
  await expect(page.locator('#status')).toContainText('Next free 30 minutes');
});

test('search filters narrow results to one calendar', async ({ page }) => {
  await ready(page);
  // Today, not tomorrow: tomorrow falls in the next week when today is the last day of the displayed week.
  await addTomorrow(page, 'Plan', [{ uid: 'f1', title: 'Alpha', hour: 10, length: 60, dayOffset: 0 }]);
  await addTomorrow(page, 'Other', [{ uid: 'f2', title: 'Gamma', hour: 12, length: 30, dayOffset: 0 }]);
  await page.evaluate(() => calendar.changeView('listWeek'));
  await page.locator('#search-source').selectOption({ label: 'Other' });
  await expect(page.locator('#search-status')).toContainText('1 of 2');
  await page.locator('#search-all').click();
  await expect(page.locator('#search-all-results li')).toHaveCount(1);
  await expect(page.locator('#search-all-summary')).toContainText('in Other');
  await page.locator('#search-all-close').click();
  await page.locator('#clear-search').click();
  await expect(page.locator('#search-source')).toHaveValue('');
});

test('Join now appears for a Teams meeting that is running', async ({ page }) => {
  await ready(page);
  await addTomorrow(page, 'Live', [{ uid: 'j1', title: 'Live sync', hour: 0, length: 1439, dayOffset: 0, description: 'https://teams.microsoft.com/l/meetup-join/abc123' }]);
  await page.evaluate(() => updateJoinNow());
  await expect(page.locator('#join-now')).toBeVisible();
  await expect(page.locator('#join-now')).toHaveAttribute('href', /teams\.microsoft\.com/);
  await expect(page.locator('#join-now')).toContainText('Live sync');
});

test('a note can cover every occurrence of a repeating event', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const pad = n => String(n).padStart(2, '0');
    const start = new Date(); start.setHours(10, 0, 0, 0); start.setDate(start.getDate() - 1);
    const stamp = d => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//EN', 'BEGIN:VEVENT', 'UID:daily', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Daily sync', 'RRULE:FREQ=DAILY;COUNT=5',
      'DTSTART:' + stamp(start), 'DTEND:' + stamp(new Date(start.getTime() + 1800000)), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    sources.push({ id: nextId++, name: 'Repeat', alertKey: 'x:repeat', color: '#2563eb', enabled: true, events: parseIcs(text), icsText: text });
    renderSources(); calendar.changeView('listWeek'); calendar.today(); calendar.refetchEvents();
  });
  const cards = page.locator('.fc-event', { hasText: 'Daily sync' });
  expect(await cards.count()).toBeGreaterThan(1);
  await cards.first().click();
  await page.locator('#event-note').fill('Share the notes');
  await page.locator('#note-all').check();
  await page.locator('#dlg .dialog-close').click();
  await expect(cards.locator('.note-badge')).toHaveCount(await cards.count());
  await cards.last().click();
  await expect(page.locator('#event-note')).toHaveValue('Share the notes');
  await expect(page.locator('#note-all')).toBeChecked();
});

test('search starts collapsed to the search box with Clear, All dates and Filters plus the date title, and the Filters toggle opens the rest and is remembered', async ({ page }) => {
  await ready(page, { collapsed: true });
  const toggle = page.locator('#search-options-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  for (const hidden of ['#search-filters', '#search-status']) await expect(page.locator(hidden)).toBeHidden();
  for (const shown of ['#clear-search', '#search-all', '#search-options-toggle']) await expect(page.locator(shown)).toBeVisible();
  await expect(page.locator('#event-search')).toBeVisible();
  await expect(page.locator('.fc-toolbar-title')).toBeVisible();
  await page.locator('#event-search').fill('zzzz-no-match');
  await expect(page.locator('#search-status')).toBeHidden();
  await toggle.click();
  await expect(page.locator('#search-filters')).toBeVisible();
  await expect(page.locator('#search-status')).toBeVisible();
  await expect(page.locator('#search-all')).toBeVisible();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(page.locator('#search-filters')).toBeHidden();
});

test("What's new opens after an update even when the browser already remembers a newer version", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ics-calendar-viewer.releaseNotes.v1', '99.0.0'); } catch { /* storage unavailable */ } });
  let acknowledged = 0;
  await page.route('**/api/version', route => route.fulfill({ json: { version: '1.0.6', pid: 1, announceFrom: '1.0.4' } }));
  await page.route('**/api/version/seen', route => { acknowledged++; return route.fulfill({ status: 204, body: '' }); });
  await page.goto('/');
  await expect(page.locator('#release-notes-dialog')).toBeVisible();
  await expect(page.locator('#release-notes-content')).toContainText('Version 1.0.6');
  await expect(page.locator('#release-notes-content')).toContainText('Version 1.0.5');
  await expect.poll(() => acknowledged).toBe(1);
});

test('Show marks the chosen time range on the calendar and switches to a time grid', async ({ page }) => {
  await ready(page);
  await addFixture(page);
  await page.evaluate(() => { workingHours = { start: '00:00', end: '23:59' }; calendar.changeView('dayGridMonth'); });
  await page.locator('#open-focus').click();
  const show = page.locator('#insights-body .free-list button').first();
  await expect(show).toBeVisible();
  await show.click();
  await expect(page.locator('.fc-bg-event.show-highlight').first()).toBeVisible();
  expect(await page.evaluate(() => calendar.view.type)).toMatch(/^timeGrid/);
  await expect(page.locator('#status, [role=status]').filter({ hasText: /free/i }).first()).toBeAttached();
});

test('the Next free button names its length and marks the slot', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { workingHours = { start: '00:00', end: '23:59' }; });
  await page.locator('#open-free-time').click();
  await page.locator('#free-minutes').fill('45');
  await page.locator('#free-time-close').click();
  await expect(page.locator('#next-free-label')).toHaveText('Next free 45 min');
  await page.locator('#next-free').click();
  await expect(page.locator('.fc-bg-event.show-highlight').first()).toBeVisible();
});

test('a required update shows a panel that cannot be closed until it is installed', async ({ page }) => {
  let started = 0;
  await page.route('**/api/updates/check', route => route.fulfill({ json: {
    status: 'available', required: true, currentVersion: '0.0.9', latestVersion: '0.0.12', download: { name: 'x.zip', size: 1, sha256: 'a'.repeat(64) },
    releaseUrl: 'https://github.com/ScutiApplications/CalendarViewer/releases/tag/v0.0.12', installation: { supported: true }
  } }));
  await page.route('**/api/updates/install', route => { started++; return route.fulfill({ json: { phase: 'downloading', received: 0, total: 100 } }); });
  await page.route('**/api/updates/status', route => route.fulfill({ json: { phase: 'downloading', received: 40, total: 100 } }));
  await page.goto('/');
  const panel = page.locator('#update-required');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('0.0.12');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await expect(panel.locator('button.icon-button, [aria-label^="Close"]')).toHaveCount(0);
  await panel.locator('#update-required-install').click();
  await expect.poll(() => started).toBe(1);
  await expect(panel.locator('#update-required-status')).toContainText('Downloading');
  await expect(panel).toBeVisible();
});
