# Third-party notices

The application's MIT licence does not replace these components' licences. Licence files below are included in distribution ZIPs.

| Component | Version | Licence | Source and licence text |
| --- | --- | --- | --- |
| FullCalendar Standard Bundle (core, interaction, daygrid, timegrid, list, multimonth) | 6.1.15 | MIT | [Source release](https://github.com/fullcalendar/fullcalendar/tree/v6.1.15), [package metadata](https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/package.json), [full licence text](vendor/fullcalendar.LICENSE.txt) |
| Preact (embedded in FullCalendar) | 10.12.1 | MIT | [Source](https://github.com/preactjs/preact/tree/10.12.1), [release lockfile](https://github.com/fullcalendar/fullcalendar/blob/v6.1.15/pnpm-lock.yaml), [full licence text](vendor/preact.LICENSE.txt) |
| ical.js | 1.5.0 | MPL-2.0 | [Corresponding source](https://github.com/mozilla-comm/ical.js/tree/v1.5.0), [package metadata](https://cdn.jsdelivr.net/npm/ical.js@1.5.0/package.json), [full licence text](vendor/ical.LICENSE.txt) |

## Distribution details

`vendor/fullcalendar.min.js` is the unmodified 6.1.15 global bundle from [jsDelivr](https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js), with its upstream copyright header retained. Its embedded `fcicons` font is part of FullCalendar's MIT-licensed source, not an external font service.

`vendor/ical.min.js` exactly matched the upstream [1.5.0 minified build](https://cdn.jsdelivr.net/npm/ical.js@1.5.0/build/ical.min.js) before this review. That upstream minified file omitted its licence header. We restored the MPL notice and copyright from the release's [module source](https://github.com/mozilla-comm/ical.js/blob/v1.5.0/lib/ical/module.js); executable code is unchanged. The corresponding MPL source is available at the source release linked above, and the full MPL-2.0 licence is bundled here.

`src/web/css/styles.css` requests Segoe UI, system-ui and sans-serif fonts already installed on the user's system; no font files are bundled or downloaded for those declarations. The app uses inline SVG paths and Unicode symbols for its own controls. No separately attributed icon or font package was found outside FullCalendar.
