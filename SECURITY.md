# Security policy

Only the latest released version is supported. Please update before reporting a vulnerability.

Report vulnerabilities privately through GitHub private vulnerability reporting (the repository's Security tab, "Report a vulnerability"). Do not include feed tokens or private calendar data in public issues.

## Threat model

The server listens on `127.0.0.1` only (`/mcp` has no token, so do not publish it to an untrusted network) and is intended for one trusted local user, not network hosting or untrusted local users.
Machine-changing actions require the local Host, an absent or local Origin, and the app's action header; these checks are not authentication for local processes.
Feed URLs may contain secret tokens. Keep `data/` and browser storage private; adding a feed lets the server contact that URL and follow redirects.

## Optional model assistant

Disabled by default. When enabled, questions and bounded read-only calendar results (including event titles, descriptions, locations and potentially meeting links) go to the chosen model. The default is the built-in MiniCPM5-2B, which runs on this PC and sends nothing off it. Alternatively the sidebar can select Anthropic, OpenAI or Google Gemini: then the same questions and calendar details go over https to that provider, using an API key (saved in `data/assistant-config.json`, mode 0600, or from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`; write-only and never sent to the browser) under that provider's own retention and privacy terms. Choose a hosted provider only for calendars you are willing to share with it. CalendarViewer does not persist chat; the browser receives answers and source records through same-origin NDJSON. Redirects from model endpoints are refused. The built-in model downloads, only on the **Download** button press, the pinned llama.cpp release from `github.com/ggml-org/llama.cpp` and the weights from `huggingface.co/openbmb`; each file is accepted only if its SHA-256 matches the digest GitHub or Hugging Face publishes for it, and the zip is unpacked with path checks. The program it starts listens on `127.0.0.1` only, with a random port and a random key per start, runs as your user, and is stopped when the calendar server stops or after idle time. Anything you place in `data/llama/` by hand runs the same way, so keep `data/` private. With the backup switch on, a question that the chosen hosted provider could not answer is sent to the built-in model, never to another cloud provider.

Both assistant routes use the local Host/Origin/action-header guard. Requests, responses, tool calls and iteration counts are bounded, and cancellation aborts model fetches. Three consecutive transport failures disable the client until restart. Feed text is untrusted data, truncated and labelled in prompts. The model has no write or network tools. These measures limit prompt-injection impact but do not make a small model's statements reliable: users must check visible calendar sources. Output is rendered as text; model links never become executable navigation. Source-derived event buttons verify the uid and occurrence against the current page calendar before opening it.

Built-in setup also installs the pinned, checksummed Vulkan runtime on supported Windows/Linux systems; macOS builds include Metal. GPU detection runs the installed program's bounded `--list-devices` probe without a shell. Driver/probe failure selects CPU mode; GPU startup failure retries the separately installed CPU runtime without downloading during inference. The assistant settings show the selected backend and GPU fallback errors. GPU availability does not change where calendar data is sent.
