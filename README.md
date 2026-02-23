# OpenBrowser

**OpenBrowser** — execution-first AI browser (like OpenClaw, OpenAI). AI controls the browser via a Chrome extension for structured task automation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Electron Shell (main + sidebar)                                 │
│  • Persistent user profile (persist:openbrowser)                 │
│  • WebSocket bridge (port 9333)                                  │
│  • Sidebar: goal input, status, action log, approval gates       │
└────────────────────────────┬────────────────────────────────────┘
                             │ WebSocket
┌────────────────────────────▼────────────────────────────────────┐
│  Chrome Extension (MV2)                                          │
│  • Background: connects to bridge, routes actions                │
│  • Content: DOM perception, stable element IDs, action execution │
│  • Actions: click, type, fill, scroll, select                    │
└────────────────────────────┬────────────────────────────────────┘
                             │ chrome.tabs.sendMessage
┌────────────────────────────▼────────────────────────────────────┐
│  Webview (target pages)                                          │
│  • Extension content scripts run in pages                        │
│  • Perceives interactable elements, executes typed actions       │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Build extension (creates extension/dist/*.js)
npm run build:extension

# Build Electron (creates dist/electron/*.js)
npm run build:electron

# Run (builds both then launches)
npm start
```

## AI Configuration (.env)

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `PIXIS_AI_PROVIDER` | `gemini` \| `ollama` \| `heuristic` |
| `PIXIS_AI_MODEL` | Model name (e.g. `gemini-2.0-flash`, `llama3.2`) |
| `PIXIS_GEMINI_API_KEY` | API key from [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| `PIXIS_OLLAMA_BASE_URL` | Ollama URL (default: `http://localhost:11434`) |

The **AI Provider** dropdown in the sidebar lets you switch between providers; env sets the default. You can override the API key in the sidebar for Gemini.

## Usage

1. **Launch** — The app opens with a sidebar and a browser panel (default: Google).
2. **Enter a goal** — e.g. `Search for weather in Tokyo` or `https://example.com`.
3. **Execute** — Click **Execute** to run the heuristic planner and actions.
4. **Action log** — See each step and result in the sidebar.

### Heuristic planner (MVP)

- Phrases like "search for X" or "google X" → navigate to Google, then type the query and submit.
- If the goal looks like a URL → navigate to that URL.
- Otherwise → treat the goal as a search query.

### Approval gates

Risky actions (e.g. payment, login) can require approval. The MVP planner does not flag these by default; you can extend the planner to add `requiresApproval: true` for specific actions.

## Project Structure

```
browser-execution-runtime/
├── electron/           # Electron main process
│   ├── main.ts         # App bootstrap, extension loading, bridge
│   ├── bridge-server.ts
│   └── preload.ts
├── extension/          # Chrome extension (MV2)
│   ├── src/
│   │   ├── background.ts  # Bridge connection, action routing
│   │   └── content.ts     # DOM perception, action execution
│   └── manifest.json
├── sidebar/            # Sidebar UI (HTML/CSS/JS)
├── shared/             # Shared schemas (Zod) and types
├── runtime/            # Executor loop (for future Node-based agent)
└── package.json
```

## Schemas (Zod)

- **PagePerception** — URL, title, elements (id, selector, rect, etc.), risk signals.
- **BrowserAction** — click | type | fill | scroll | select | navigate | screenshot.
- **ActionResult** — success, error, optional perception.

## Extending

- **Planner** — Replace the heuristic planner in `sidebar/renderer.js` with an LLM-based planner.
- **Validators** — Add deterministic checkers in `runtime/executor.ts`.
- **Replay** — Persist `TraceEntry[]` to disk and add a replay harness.

## License

MIT
