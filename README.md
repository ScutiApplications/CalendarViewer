# ICS Calendar Viewer

A read-only calendar that combines ICS links and imported `.ics` files in a Teams-inspired interface.

The layout adapts to your screen: phones open a daily agenda, portrait and tablet screens open a three-day calendar, and wide landscape screens retain the full desktop layout. Drag, swipe, or scroll the date strip to roll through days; it snaps to the selected date. You can also tap a date or use the arrow keys, and switch between the grid and agenda with the view buttons. On compact screens, the menu button opens calendars and settings; tap an event for its details. Each layout remembers its own view preference, and rotating your device keeps the selected date.

Click the date button to open the date picker. Scroll or drag its month, day, and year wheels, or use the up/down arrow keys, then press Apply date to jump to your selection. Closing the modal cancels pending changes. Today sits between the previous/next week arrows.

## Project layout

```text
run.bat             one-click: start the server if needed, restart it after an update, open the calendar; or: run.bat restart|stop|startup-on|startup-off
VERSION             application version, reported by the server at /api/version
scripts/            calendar.ps1 (start, restart, stop, startup, toast)
tools/              make_zip.bat and make_zip.py: ZIP for a GitHub release
src/server/         server.js (routes and startup), http.js, static-files.js, feed-fetch.js, alerts.js (background alerts),
                    reminders.js (snoozes), backups.js, mcp.js (MCP adapter), calendar-tools.js (shared read-only tools),
                    assistant.js (tool loop), model-client.js (built-in and hosted transport), providers.js, llama-engine.js,
                    assistant-config.js, assistant-route.js, laya-engine.js, builtin-models.js, tool-router.js,
                    json-store.js (atomic JSON files), startup.js, powershell.js,
                    updates.js (GitHub releases), update-install.js (download/staging), update-worker.js (installation/rollback)
src/shared/         alert-logic.js, backup.js and search.js (page and server), storage.js and calendar-layout.js (page only),
                    assistant-dates.js and free-time.js (server calculations)
src/web/            index.html, css/ (styles, responsive, assistant), js/ (one script per feature including assistant-ui.js, main.js last)
vendor/             FullCalendar, ical.js and third-party licences
test/               run with: node --test
data/               your feeds and alert state, MiniCPM under data/llama/ and Laya under data/laya/ (private)
```

## Requirements

- Windows with Node.js 18 or newer on PATH. A currently supported Node.js LTS release is recommended.
- A browser; an internet connection is needed for remote calendar feeds, links you open, assistant downloads and hosted assistant providers. Once downloaded, the built-in assistant runs offline.
- Python 3.10 or newer (run through `uv`) only if you want to create a distribution ZIP.

No dependency installation or build step is required.

## Launcher reference

Keep the application folder together: `run.bat` runs `scripts\calendar.ps1`.

| Command | Action |
| --- | --- |
| `run.bat` | Start the server if needed (restart it after an update) and open the calendar. Add `-NoBrowser` to skip the browser. |
| `run.bat restart` | Always restart the server and open the calendar. |
| `run.bat stop` | Stop this application's background server and private Laya Python/installer processes, including orphaned workers. |
| `run.bat startup-on` | Start the server automatically at Windows sign-in. Add `-Browser` to open the calendar too. |
| `run.bat startup-off` | Turn off automatic startup for your Windows account. |

## Quick start with run.bat

Double-click `run.bat` (or run `run.bat -NoBrowser` to skip the browser). It does the right thing without a menu:

- Server stopped: starts it and opens the calendar.
- Server running and up to date: leaves it running and opens the calendar.
- Server running but older than the files on disk (the `VERSION` differs, or a file in `src/` or `vendor/` is newer than the server process): restarts it, then opens the calendar.

To update a Windows portable installation, press **Download and install** when an update is offered. Manual alternative: extract the new version over the application folder (keep `data/`), then double-click `run.bat`. Maintainers: see [Releasing](#releasing).

## Start, restart, and stop

**Updates:** Calendar Viewer checks the latest published stable GitHub Release from `ScutiApplications/CalendarViewer` when the page opens and every six hours while it stays open. Checks ignore drafts and prereleases, share in-flight requests and cache successful results for five minutes. You can also press **Check for updates** under **Calendar Viewer updates** in sidebar settings.

When a newer version is available, press **Download and install** once. Only this button starts downloading or installing. Calendar Viewer verifies the release ZIP against GitHub's published SHA-256, stages it while the current server keeps running, then installs and restarts automatically. The page reconnects and reloads. Your `data/` folder (calendars, settings, downloaded MiniCPM and Laya models) and browser preferences are preserved. Previous application files remain under `data/updates/job-*/previous/`; failed startup restores them and restarts the previous server. File removals use the previous installation's generated `update-manifest.json`, so unrelated local files are preserved.

One-click installation supports Windows portable ZIP installations. Git checkouts and other operating systems show release notes and explain why installation is unavailable; use your normal Git or manual update workflow there. Releases without a verified installation ZIP cannot be installed with the button. Restart interrupts any active assistant response.

Extract the entire application into a permanent folder, then double-click `run.bat`.
It starts the server in the background and opens <http://localhost:3000>. Closing the launcher or the browser does not stop the server.

- Run `run.bat restart` to restart the server and reopen the calendar.
- Run `run.bat stop` to stop this application's server and private Laya Python/installer processes. It also cleans up orphaned Laya processes when the server is already stopped; other applications' Python processes are left running.
- Alternatively, run `node src/server/server.js` in a terminal and use Ctrl+C to stop it. On a network that inspects HTTPS (corporate proxy), start it with `node --use-system-ca src/server/server.js` so downloads trust the Windows certificate store.

The launcher deliberately avoids stopping processes they cannot identify as this application.

## Start automatically with Windows

Run `run.bat startup-on` (add `-Browser` to also open the calendar at sign-in). It adds one shortcut to your account's Windows Startup folder.
The server starts when you next sign in after booting Windows, and the calendar opens in your browser only with `-Browser`.
It runs as your account, without administrator privileges; it does not run before sign-in.
Running `run.bat startup-on` again updates the same shortcut.

You can also turn startup on or off from the calendar page with the **Start with Windows** checkbox in the sidebar. The checkbox starts only the server at sign-in and does not open a browser, which is enough for Windows alert notifications. It makes the same shortcut as `run.bat startup-on`. The checkbox is available only when the page is served by this application's server on `localhost`.

To disable automatic startup, open a terminal in this folder and run:

```bat
run.bat startup-off
```

You can also press Win+R, enter `shell:startup`, and delete only `ICS Calendar Viewer.lnk`.
Disabling startup does not stop an already-running server; use `run.bat stop` for that.
If you move the application folder, run `run.bat startup-on` again from the new location.

## Use the calendar

- Add an ICS link and a label in the sidebar, or drop/select `.ics` files.
- Toggle calendars, edit their labels, change source colors, or remove them in the sidebar.
- Use Today, the navigation arrows, and Day / Work week / Week / Month / Agenda to navigate. The selected view is remembered. Agenda is a compact weekly list with times, locations, source labels, alert indicators and overlap badges.
- **Search events** filters titles and locations in the displayed date range, ignoring capitalization. Clear or press Escape to reset it; navigate dates to search another range. Search changes the display, while alert scheduling and overlap detection continue to consider all eligible events.
- Open an event for dates, location, description, and a Join button when a Teams meeting link is available.
- Matching events from multiple sources are merged and display their source badges and dots.
- Use **Hide cancelled events** in the sidebar to hide events whose titles start with Canceled or Cancelled. The choice is remembered. Events explicitly marked `STATUS:CANCELLED` in the feed are always excluded.
- Overlapping timed meetings show an **Overlap** badge; open a meeting to see the conflicting titles. Cancelled events, all-day events, hidden calendars and back-to-back meetings do not count. Matching events are merged before checking overlaps.
- Each linked calendar shows separate **Page** and **Alerts** refresh states with its last successful refresh time. Failed refreshes retain cached events and their original timestamps. A feed that takes longer than 20 seconds or is larger than 10 MB counts as a failed refresh. Page data is marked stale after twice the selected auto-refresh interval (at least 10 minutes); background alert data after 10 minutes. **Not needed** means no alert offsets are configured. Imported calendars are labelled **Local file**.
- Upcoming and ongoing events are green; finished events turn gray. Green is reserved for event status.
- Refresh manually or select an auto-refresh interval (off, or every 1, 5, 10, 15, 30 or 60 minutes) in the sync strip under the calendar toolbar, which also shows the update status. The interval is remembered between visits.
- **Working hours** in the sidebar shade the hours outside them, and weekends, in every view. A start later than the end (for example 22:00 to 06:00) is an overnight shift. The choice is remembered.
- Day view shows an **Up next** list of the next three upcoming events in the coming 7 days, with a Join button for the first when it has a Teams link.

## Alerts

Get an in-app toast and a system notification a set time before an event starts.

- **Calendar default:** click the bell next to a calendar in the sidebar, then add offsets such as 15 minutes or 1 hour. They apply to every event in that calendar.
- **Single event:** open an event and choose *Calendar default*, *Custom*, or *Muted*. The setting applies to every occurrence of a recurring event and replaces the calendar default.
- **Mute everything:** tick *Mute all alerts* in the sidebar. Settings are kept.
- Events with an active alert show a bell icon. Hidden calendars do not alert.
- Cancelled events never alert, including events with custom reminders. Their bell is muted and their reminder controls are disabled; saved rules are kept in case the event becomes active again.
- In-app toasts stay until dismissed and include a Join button for Teams meetings. Windows notification banners disappear automatically after the normal short display duration controlled by your Windows settings; their actions remain available in Notification Center.
- **Snooze 5 min** defers an upcoming reminder for five minutes, provided that ends before the meeting starts. In-app snooze requires the background server; failure leaves the original alert visible. The Windows Snooze button opens a small local confirmation tab that you can close. Both buttons use the same saved background queue, so snoozes survive a server restart. The server checks current event details, cancellation, calendar visibility and alert rules before sending again; a failed remote refresh keeps the snooze pending until fresh data arrives or the meeting starts.
- **Windows notifications come from the background server**, so they appear even when the browser is closed. The page sends its alert settings and imported calendars to the server, which re-fetches feed links every 5 minutes and checks every 30 seconds.
- The server must be running: use `run.bat` or `run.bat startup-on`. If the server is stopped, no alert fires; alerts that came due while it was stopped fire when it starts, if the event has not started.
- If the server cannot show Windows notifications, or is not reachable, the page falls back to browser notifications (needs browser permission) while it is open.
- Windows Focus Assist / Do Not Disturb can hide Windows notifications.
- The first notification registers an app name "ICS Calendar Viewer" for your Windows account (`HKCU\Software\Classes\AppUserModelId`).
- Alert settings are kept in browser local storage and copied to `data/alerts-state.json` (private, gitignored, excluded from ZIPs). `data/alerts-fired.json` remembers which alerts were sent.

Cached events display while remote calendars refresh. Skeleton placeholders appear when the calendar is empty.
The interface follows your system's light/dark preference unless you pick Light or Dark under **Theme** in the sidebar.

## Privacy

Calendar data stays on your machine. Remote feed links are saved in `data/feeds.json`, which the server creates as needed. Imported files, cached feed snapshots, and preferences are stored in your browser's local storage; use the same browser profile and address to retain them, because clearing site data removes them.
The server listens only on `127.0.0.1`. This application does not edit the source calendars.
The [MCP endpoint](#mcp-server) returns event titles, locations and descriptions to any local program that calls it. The endpoint has no token, so keep the server on `127.0.0.1`.

The app contacts the calendar hosts you add (including redirects) and, when you enable the assistant, the built-in model on this computer or a hosted provider you chose (Anthropic, OpenAI or Google). Downloading the built-in engine and model contacts GitHub and Hugging Face. Opening a meeting or description link contacts its destination. All libraries are bundled locally: there is no CDN request and no telemetry. The server sends a Content Security Policy that allows only scripts and connections from its own origin.

## AI assistant (optional)

Off by default. Open **Calendar assistant settings**, select **Built-in Laya + MiniCPM5-2B**, enable the assistant and press **Save**. Then press **Download Laya and MiniCPM**. This single action installs Laya typed-decisions for tool selection, MiniCPM5-2B Q4_K_M for answers, and their private runtimes. Both models must be installed before built-in chat is ready. Existing MiniCPM installations keep their weights; the same button adds missing Laya files. Downloads happen only after this explicit action, never on a question or a server restart.

MiniCPM uses the pinned llama.cpp release `b12244` under `data/llama/`, with automatic Vulkan/Metal GPU detection and CPU fallback. Laya uses a pinned checkpoint revision and a private CPU Python runtime under `data/laya/`; no manual Python installation or separate Laya service is needed. The bootstrap uses pinned uv `0.13.7`, Python `3.12.16` and `src/laya/uv.lock`. Checkpoint files are SHA-256 verified, and setup checks that Laya loads offline before marking it ready. First setup downloads roughly 2.4 GB of model weights plus platform runtimes/dependencies; progress names the model being installed.

Laya's Python installer uses the operating system's certificate store for HTTPS downloads, including trusted corporate proxy certificates. If setup previously failed with `UnknownIssuer`, restart CalendarViewer after updating and press **Complete setup: Laya and MiniCPM** to retry. Certificate verification remains enabled.

Only the selected built-in provider runs these local models. Anthropic, OpenAI and Gemini use the chosen hosted provider directly, including on errors; legacy hosted-to-local fallback settings are ignored. Changing to a hosted provider stops the local models and hides the built-in download panel. The downloaded files remain available when switching back.

The settings modal writes `data/assistant-config.json`. Optional environment variables override it and show the field as locked:

| Setting | Default | Meaning |
| --- | --- | --- |
| `CALENDAR_ASSISTANT_ENABLED` | `0` | `1` enables chat. When set it overrides the web UI switch. |
| `ASSISTANT_PROVIDER` | `llamacpp` | `llamacpp` (the built-in model), `anthropic`, `openai` or `gemini`. Overrides the web UI choice and locks the chat's provider dropdown. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | unset | API key for that hosted provider. Overrides a key saved in the web UI. |

Saving in the page needs no restart; changing an environment variable does. This application does not read an environment file itself; launch it with the variables already set. **Test connection** checks the typed key (without saving) and reports whether it is accepted and the model is ready.

Questions, the remembered chat and bounded calendar tool results (titles, dates, descriptions, locations, calendar names and potentially meeting links) go from this server to the chosen model: the built-in one stays on this PC, a hosted provider receives them over the internet under its own terms. The dialog names where they go and the **server timezone**, which determines relative dates and working hours. Chat is not saved by CalendarViewer: the conversation lives only in the open page. Its last three exchanges are sent with each new question so follow-ups work; when a fourth arrives the three oldest are first summarized by the same model, and the summary replaces them. The chat is dropped after 5 minutes without use, when you press **New chat**, or on reload. Enabled calendars and imported files synced to the background server are available, just as for MCP; open the calendar page and let synchronization finish first.

The tools compute relative dates and free time in code. Thursday means the next Thursday, including today; weeks begin Monday and range ends are exclusive. Availability uses the **working hours** set in the sidebar (the page sends them with each question; without them the default is weekdays 09:00–17:00), including overnight shifts, and asking for a length defaults to 30 minutes. All-day events block availability. Results exclude past time and return up to 20 candidate slots. Events in tool results are marked `[ended]` or `[in progress]` by code, and questions about what is *remaining*, *left*, *upcoming* or *later* only receive events that have not finished.

The assistant's read-only tools are `list_calendars`, `list_events`, `get_event`, `up_next`, `conflicts`, `find_free_time`, `next_free_slot`, `get_working_hours`, `day_summary`, `time_until`, `busiest_day`, `search_events`, `list_all_day` and `recurring_summary`; times, gaps, busy minutes and countdowns are computed by code, not by the model. When the built-in model is the chosen provider (hosted providers always get every tool), Laya evaluates which declared tools are needed, including multiple tools for compound requests. MiniCPM receives the selected tools and produces arguments and the final answer. Missing, truncated, malformed, uncertain or failed Laya decisions keep every tool available. A conservative confidence threshold is used; this checkpoint is not fine-tuned for calendar requests, so routing may often retain the full set. This is not a measured speedup or accuracy guarantee. The assistant has no network tools, five model turns per question and four calls per turn. Dates span at most 93 days, tool lists sent to the model contain at most 30 records, and long fields are truncated. Source data is displayed with the answer. Small models can invent facts, misuse tools or exhaust their tokens; verify answers against these sources. Model links remain plain text; only validated source buttons navigate to known dates/events. After three consecutive model failures the client stays offline until the calendar server restarts. Disabled/offline chat does not affect calendars or alerts. Alert-rule drafting is not implemented.

The dialog is a chat: your questions and the replies stack in a scrolling thread, each reply with its own source data. While an answer runs, the chat lists the working steps (tool calls) live. Clicking the backdrop closes any dialog, the chat included. The header has a **provider dropdown** (every provider is listed; only ones that are set up can be chosen: a key for hosted providers, a downloaded model for the built-in one) and **New chat**. **Check Connection** sends a one-word test through the chosen provider and shows the result under the input. `GET /api/assistant/status` reports enabled/reachable/model; `GET /api/assistant/providers` lists providers and whether each is set up; `POST /api/assistant/provider` switches to one that is; `POST /api/assistant/test` checks a connection; `POST /api/assistant` accepts `{"question":"…","memory":{"summary":"…","turns":[{"question":"…","answer":"…"}]},"workingHours":{"start":"HH:MM","end":"HH:MM"}}` (memory and hours optional) and streams NDJSON. Both require the local Host/Origin checks and `X-Calendar-Action: 1`, so a page opened through a remote hostname cannot use chat. Questions are limited to 2000 characters, at most three remembered exchanges are accepted, and request bodies are limited to 32KB; one answer runs at a time.

Every event card also carries visually hidden text with its date, time range, location and calendars, so screen readers and page-reading browser assistants such as Edge Copilot can answer from the page without the built-in assistant.

**CPU threads:** Assistant settings include a thread count for CPU-only MiniCPM, including CPU fallback when a GPU cannot be used. `0` keeps llama.cpp's automatic defaults; manual counts range from `1` to the available logical CPU count detected on the server machine. This limit is shown in settings and enforced by the server. The count sets both generation and prompt-processing threads, is saved with assistant settings, and is ignored during GPU inference. Settings copied from a larger machine are capped to the current machine's available CPUs. Changes apply the next time the built-in model starts (after idle unloading or a server restart), so saving does not interrupt an answer. More threads do not always mean faster responses; compare several counts on your hardware.

## Backup and restore

Open **Backup & restore** in the sidebar to export a local JSON backup. It includes linked calendar URLs, imported ICS files, calendar labels/colors/visibility, alert rules, theme, working hours, refresh interval, hide-cancelled choice and selected view. It does not transfer the Windows startup setting, cached feed snapshots, already-fired alerts or pending snoozes.

Choose **Restore backup** to validate a file and preview the calendar/rule counts before replacing your current configuration. Restore checks browser storage first and saves the previous configuration in `data/backup-recovery.json`. **Recovery backup** previews that saved configuration for restoring it. Failed writes roll back; if an interrupted connection prevents confirming recovery, synchronization pauses and the page explains how to recover. Wait for any active calendar refresh to finish before exporting or restoring.

Backup files and recovery snapshots contain private calendar links and event contents, and are not encrypted. ICS links may contain secret access tokens. Keep backups, `data/`, imported calendars and browser storage private, and do not share feed links.

## MCP server

The same server exposes a read-only [MCP](https://modelcontextprotocol.io) endpoint at `http://127.0.0.1:3000/mcp` (streamable HTTP, POST only, no extra install). Tools, all marked `readOnlyHint`: `list_calendars`, `list_events` (date range and text search, overlaps marked), `get_event`, `up_next` and `conflicts`. It reads linked calendars (fetched with a 5-minute cache) and the imported files the page has synced for alerts, so open the calendar page once to make imported files visible. Cancelled events are left out.

To use it from an MCP client, add an entry like this to the client's server configuration and restart the client (start this server first):

```json
"calendar_viewer": {
  "label": "Calendar Viewer",
  "description": "Read-only view of your ICS calendars: events, overlaps and what is up next.",
  "url": "http://127.0.0.1:3000/mcp"
}
```

`/mcp` accepts any local caller. Requests with an `Origin` header (browsers) or a foreign `Host` are always refused. A custom `PORT` changes the URL.

## Releasing

1. Put the next stable number (`X.Y.Z`) in `VERSION`, commit the changes and push to `main`.
2. The **release** GitHub Actions workflow runs the tests on Windows and Linux, builds `CalendarViewer-X.Y.Z.zip`, creates tag `vX.Y.Z` and uploads a draft release with generated notes.
3. After checking GitHub's uploaded ZIP digest against the local SHA-256, the workflow publishes the release as latest. Failed tests prevent publication; a failed upload verification leaves a draft for investigation.

The workflow uses GitHub's built-in token; no personal token or local GitHub CLI is required. You can retry from **Actions > release > Run workflow** on `main`. An existing published version is left alone, and a version tag pointing to another commit is rejected: increase `VERSION` for each new release. Changes to the release workflow or packager also run the workflow.

For manual packaging, `tools\make_zip.bat` builds the ZIP and opens GitHub's release page. Automated releases already attach the ZIP.

The update checker uses published stable Releases, not commits on `main`. Keep release tags in `vX.Y.Z` form matching `VERSION`, attach `CalendarViewer-X.Y.Z.zip` from the packager (with its single `CalendarViewer/` folder), and publish the release as the latest stable version. GitHub supplies the asset's SHA-256 digest; the installer requires it, validates the ZIP version and refuses packages that touch user data, secrets or filesystem links. Drafts, tags without a Release and prereleases are not offered by the stable update checker.

## Package the application

Double-click `tools\make_zip.bat`, or run:

```bat
uv run tools/make_zip.py
```

The archive is created at `dist/CalendarViewer-<VERSION>.zip` (the number comes from `VERSION`) and includes everything outside the exclusions below: the app, launchers, `scripts/`, the tests, and this README.
The archive holds the files git tracks or would track, so everything in `.gitignore` is left out (`.env`, `data/`, `.ics` files, caches, dependencies, build output, older ZIPs). `tools/` (release tooling) is excluded.
An existing archive of the same version is overwritten.
Recipients should extract the ZIP before running the launchers and add their own calendars. Node.js is not bundled.

## Troubleshooting

- **Node.js not found:** install Node.js and reopen the launcher.
- **Port already in use:** stop the previous calendar server or the other application using port 3000.
- **Feed refresh fails:** confirm the server is running and the ICS link is accessible. Cached events remain available.
- **Startup does not work:** check that the application folder has not moved and turn startup off and on again with `run.bat startup-off` and `run.bat startup-on`.
- **An MCP client cannot connect (403):** the URL must use `127.0.0.1:3000` or `localhost:3000` (your port if changed), and the request must carry no `Origin` header. Start this server before the client.
- **MCP tools miss an imported file:** open the calendar page once so it syncs imported files to the server.
- **Custom port:** set the `PORT` environment variable before launching. Browser storage is separate for each port.

## Accessibility

- Interface text and controls in the default light and dark themes meet WCAG 2.1 AA contrast (4.5:1 for text), checked by calculation on the theme colours.
- Buttons, switches and form fields have text labels or `aria-label`s, and status messages use `role="status"` with `aria-live`.
- Every control shows a visible focus outline.
- Known gaps: calendar colours you choose yourself are not checked for contrast, and the page has not been tested with a screen reader. Reports are welcome.

## Disclaimer

Alerts are best effort and must not be used for safety-critical purposes.
This project is not affiliated with Microsoft, Google or DXC. "Teams-inspired" describes the layout only.

## Licences and security

See [third-party notices](THIRD-PARTY-NOTICES.md) for bundled components and their licences, and [the security policy](SECURITY.md) for private vulnerability reporting.
