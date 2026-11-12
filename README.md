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
                    assistant-config.js, assistant-route.js,
                    json-store.js (atomic JSON files), startup.js, powershell.js
src/shared/         alert-logic.js, backup.js and search.js (page and server), storage.js and calendar-layout.js (page only),
                    assistant-dates.js and free-time.js (server calculations)
src/web/            index.html, css/ (styles, responsive, assistant), js/ (one script per feature including assistant-ui.js, main.js last)
vendor/             FullCalendar, ical.js and third-party licences
test/               run with: node --test
data/               your feeds and alert state, and the built-in model under data/llama/ (created at run time, private)
```

## Requirements

- Windows with Node.js 18 or newer on PATH. A currently supported Node.js LTS release is recommended.
- A browser; an internet connection is needed only for remote calendar feeds and links you open.
- Python 3.10 or newer (run through `uv`) only if you want to create a distribution ZIP.

No dependency installation or build step is required.

## Launcher reference

Keep the application folder together: `run.bat` runs `scripts\calendar.ps1`.

| Command | Action |
| --- | --- |
| `run.bat` | Start the server if needed (restart it after an update) and open the calendar. Add `-NoBrowser` to skip the browser. |
| `run.bat restart` | Always restart the server and open the calendar. |
| `run.bat stop` | Stop this application's background server. |
| `run.bat startup-on` | Start the server automatically at Windows sign-in. Add `-Browser` to open the calendar too. |
| `run.bat startup-off` | Turn off automatic startup for your Windows account. |

## Quick start with run.bat

Double-click `run.bat` (or run `run.bat -NoBrowser` to skip the browser). It does the right thing without a menu:

- Server stopped: starts it and opens the calendar.
- Server running and up to date: leaves it running and opens the calendar.
- Server running but older than the files on disk (the `VERSION` differs, or a file in `src/` or `vendor/` is newer than the server process): restarts it, then opens the calendar.

To update, extract the new version over the application folder (keep `data/`), then double-click `run.bat`. Maintainers: see [Releasing](#releasing).

## Start, restart, and stop

Extract the entire application into a permanent folder, then double-click `run.bat`.
It starts the server in the background and opens <http://localhost:3000>. Closing the launcher or the browser does not stop the server.

- Run `run.bat restart` to restart the server and reopen the calendar.
- Run `run.bat stop` to stop this application's server.
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

Off by default. Open the sidebar, select **Calendar assistant settings**, switch **Enable assistant** on, pick an **AI provider** and press **Save**. **Built-in MiniCPM5-2B** is the default. It runs on this PC and sends nothing off the machine, and it needs nothing installed: **Download engine and model** (about 1.6 GB, only when you click it) fetches the official [llama.cpp](https://github.com/ggml-org/llama.cpp) server program (CPU build, release `b12244`) from GitHub and the MiniCPM5-2B weights from Hugging Face into `data/llama/` inside the application folder (never a user-profile or system cache), checks both against their published SHA-256, then starts the program on the first question (loopback only, random port and key) and stops it after 15 idle minutes. Windows, Linux and macOS on x64 or arm64 are covered; a GPU build can be placed in `data/llama/engine/b12244/` by hand. While it is loaded it uses roughly 1.6 times the size of the weights in memory (about 15% of a 16 GB PC) and up to about 65% of the CPU while it answers; the chat shows these figures in a yellow warning. **Anthropic** (Claude Haiku 5.5), **OpenAI** (Luna 6) and **Google Gemini** (3.8 Flash) use your own API key and run in the provider's cloud. Switch on **Use built-in MiniCPM5-2B as backup** with a hosted provider and the built-in model answers whenever that provider is down, unreachable, rate limited or has no valid key; the dialog then says so. The model name of a hosted provider is editable, in case your account uses a different id. **Test connection** checks the key before you save. It applies at once; no restart or environment variable is needed. **Ask calendar** opens a keyboard-accessible dialog on desktop, portrait and phone layouts. Try “what is on my plate Thursday?” or “find one free hour this week”. Stop answer, Escape and Close cancel model work. Refresh status checks the model again.

The settings modal writes `data/assistant-config.json`. Optional environment variables override it and show the field as locked:

| Setting | Default | Meaning |
| --- | --- | --- |
| `CALENDAR_ASSISTANT_ENABLED` | `0` | `1` enables chat. When set it overrides the web UI switch. |
| `ASSISTANT_PROVIDER` | `llamacpp` | `llamacpp` (the built-in model), `anthropic`, `openai` or `gemini`. Overrides the web UI choice and locks the chat's provider dropdown. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | unset | API key for that hosted provider. Overrides a key saved in the web UI. |

Saving in the page needs no restart; changing an environment variable does. This application does not read an environment file itself; launch it with the variables already set. **Test connection** checks the typed key (without saving) and reports whether it is accepted and the model is ready.

Questions, the remembered chat and bounded calendar tool results (titles, dates, descriptions, locations, calendar names and potentially meeting links) go from this server to the chosen model: the built-in one stays on this PC, a hosted provider receives them over the internet under its own terms. The dialog names where they go and the **server timezone**, which determines relative dates and working hours. Chat is not saved by CalendarViewer: the conversation lives only in the open page. Its last three exchanges are sent with each new question so follow-ups work; when a fourth arrives the three oldest are first summarized by the same model, and the summary replaces them. The chat is dropped after 5 minutes without use, when you press **New chat**, or on reload. Enabled calendars and imported files synced to the background server are available, just as for MCP; open the calendar page and let synchronization finish first.

The tools compute relative dates and free time in code. Thursday means the next Thursday, including today; weeks begin Monday and range ends are exclusive. Availability uses the **working hours** set in the sidebar (the page sends them with each question; without them the default is weekdays 09:00–17:00), including overnight shifts, and asking for a length defaults to 30 minutes. All-day events block availability. Results exclude past time and return up to 20 candidate slots. Events in tool results are marked `[ended]` or `[in progress]` by code, and questions about what is *remaining*, *left*, *upcoming* or *later* only receive events that have not finished.

The assistant's read-only tools are `list_calendars`, `list_events`, `get_event`, `up_next`, `conflicts`, `find_free_time`, `next_free_slot`, `get_working_hours`, `day_summary`, `time_until`, `busiest_day`, `search_events`, `list_all_day` and `recurring_summary`; times, gaps, busy minutes and countdowns are computed by code, not by the model. When the built-in model is the chosen provider (hosted providers always get every tool), before each question a short tool-free call to that model picks which tools are needed, and only those are sent with the real call (one extra quick model call; if it fails or picks nothing, every tool is sent). The assistant has no network tools, five model turns per question and four calls per turn. Dates span at most 93 days, tool lists sent to the model contain at most 30 records, and long fields are truncated. Source data is displayed with the answer. Small models can invent facts, misuse tools or exhaust their tokens; verify answers against these sources. Model links remain plain text; only validated source buttons navigate to known dates/events. After three consecutive model failures the client stays offline until the calendar server restarts. Disabled/offline chat does not affect calendars or alerts. Laya tagging and alert-rule drafting are not implemented.

The dialog is a chat: your questions and the replies stack in a scrolling thread, each reply with its own source data. While an answer runs, the chat lists the working steps (tool calls) live. Clicking the backdrop closes any dialog, the chat included. The header has a **provider dropdown** (every provider is listed; only ones that are set up can be chosen: a key for hosted providers, a downloaded model for the built-in one) and **New chat**. **Check Connection** sends a one-word test through the chosen provider and shows the result under the input. `GET /api/assistant/status` reports enabled/reachable/model; `GET /api/assistant/providers` lists providers and whether each is set up; `POST /api/assistant/provider` switches to one that is; `POST /api/assistant/test` checks a connection; `POST /api/assistant` accepts `{"question":"…","memory":{"summary":"…","turns":[{"question":"…","answer":"…"}]},"workingHours":{"start":"HH:MM","end":"HH:MM"}}` (memory and hours optional) and streams NDJSON. Both require the local Host/Origin checks and `X-Calendar-Action: 1`, so a page opened through a remote hostname cannot use chat. Questions are limited to 2000 characters, at most three remembered exchanges are accepted, and request bodies are limited to 32KB; one answer runs at a time.

Every event card also carries visually hidden text with its date, time range, location and calendars, so screen readers and page-reading browser assistants such as Edge Copilot can answer from the page without the built-in assistant.

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

1. Put the new number in `VERSION` and commit it on `main`.
2. Tag that commit and push `main` with the tag (`X.Y.Z` is the number in `VERSION`):

   ```bat
   git tag -a vX.Y.Z -m vX.Y.Z
   git push origin main vX.Y.Z
   ```

3. Run `tools\make_zip.bat`. It builds the desktop ZIP, selects it in Explorer and opens GitHub's new-release page for the tag, where you drag the ZIP on and publish.

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
- Every control shows a visible focus outline, and animations stop under `prefers-reduced-motion`.
- Known gaps: calendar colours you choose yourself are not checked for contrast, and the page has not been tested with a screen reader. Reports are welcome.

## Disclaimer

Alerts are best effort and must not be used for safety-critical purposes.
This project is not affiliated with Microsoft, Google or DXC. "Teams-inspired" describes the layout only.

## Licences and security

See [third-party notices](THIRD-PARTY-NOTICES.md) for bundled components and their licences, and [the security policy](SECURITY.md) for private vulnerability reporting.
