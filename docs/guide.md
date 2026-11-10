# Guide

Describe a goal in plain language; OpenBrowser plans and executes steps in a real Chromium browser with optional AI planners.

](https://mediuswareltd.github.io/open-browser/)

<p align="center">
  <img src="arts/open-browser.png" alt="OpenBrowser" width="320" />
</p>

**OpenBrowser** — AI-powered browser automation. Describe your goal in plain language; OpenBrowser plans and executes the steps inside a real Chromium browser. It supports a fast rule-based planner out of the box, and optional AI planners (Gemini, Ollama) for complex goals.

---

## Features

- **Three planners** — Quick (heuristic, no API key needed), Gemini, or Ollama.
- **Chrome extension** — Perceives DOM elements and executes typed actions (click, type, fill, scroll, select, navigate).
- **Projects** — Save goals, plans, and run traces; reload and re-run anytime.
- **Approval gates** — Optionally require human confirmation before risky actions.
- **Persistent browser profile** — Stays logged in across sessions (`persist:openbrowser`).
- **Sidebar UI** — Goal input, model selector, status, live action log, and URL bar.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Electron Shell (main + sidebar)                                  │
│  • Persistent user profile (persist:openbrowser)                  │
│  • WebSocket bridge server (port 9333)                            │
│  • Sidebar: goal input, model select, status, action log          │
│  • BrowserView: embedded Chromium panel                           │
└────────────────────────────┬─────────────────────────────────────┘
                             │ WebSocket (ws://localhost:9333)
┌────────────────────────────▼─────────────────────────────────────┐
│  Chrome Extension (MV2) — "OpenBrowser Agent"                     │
│  • Background: connects to bridge, routes actions to content      │
│  • Content: DOM perception, stable element IDs, action execution  │
│  • Actions: click, type, fill, scroll, select, navigate           │
└────────────────────────────┬─────────────────────────────────────┘
                             │ chrome.tabs.sendMessage
┌────────────────────────────▼─────────────────────────────────────┐
│  Webview (target pages)                                           │
│  • Content scripts perceive interactable elements                 │
│  • Execute typed actions directly in the page                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Requirements

- **Node.js** 18+
- **npm** 9+
- A Gemini API key ([get one free](https://aistudio.google.com/app/apikey)) — only needed if using the Gemini planner
- Or **Ollama** running locally (`ollama run llama3.2`) — only needed if using the Ollama planner

---

## Quick Start

```bash
# 1. Install dependencies
npm install
cd extension && npm install && cd ..

# 2. Configure AI (optional — heuristic works without any key)
cp .env.example .env
# Edit .env with your preferred provider and API key

# 3. Build and launch
npm start
```

For development (auto-rebuild on change):

```bash
npm run dev
```

---

## Build Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Build extension + electron, then launch |
| `npm run dev` | Watch-mode build + launch (for development) |
| `npm run build` | Build both extension and electron |
| `npm run build:electron` | Compile `electron/` TypeScript → `dist/electron/` |
| `npm run build:extension` | Compile `extension/src/` → `extension/dist/` |
| `npm run typecheck` | Type-check without emitting |

---

## AI Configuration (`.env`)

Copy `.env.example` to `.env` and set your preferred provider:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENBROWSER_AI_PROVIDER` | `heuristic` | `heuristic` \| `gemini` \| `ollama` |
| `OPENBROWSER_AI_MODEL` | `gemini-2.5-flash` | Gemini: `gemini-2.5-flash` (recommended), `gemini-2.5-flash-lite`, `gemini-2.5-pro` — Ollama: `llama3.2`, `mistral`, `phi3` |
| `OPENBROWSER_GEMINI_API_KEY` | _(empty)_ | Required for Gemini — [get a free key](https://aistudio.google.com/app/apikey) |
| `OPENBROWSER_OLLAMA_BASE_URL` | `http://localhost:11434` | Required for Ollama — run `ollama run llama3.2` first |

> The **Model** dropdown in the sidebar lets you switch providers at runtime. You can also paste a Gemini API key directly in the sidebar without setting it in `.env`.

---

## Usage

1. **Launch** — The app opens with a sidebar (left) and a browser panel (right).
2. **Create a project** — Enter a project name and click **Save**.
3. **Enter a goal** — e.g. `Search for weather in Tokyo` or `Open https://example.com`.
4. **Choose a model** — Quick (heuristic), Gemini, or Ollama.
5. **Run** — Click **Run** or press `Ctrl+Enter` / `Cmd+Enter`.
6. **Watch** — The action log shows each step live; the browser executes them.
7. **Save** — The goal and plan are auto-saved to the project on each run.

### Heuristic planner

The built-in rule-based planner requires no API key:

- `"search for X"` / `"google X"` → navigate to Google, type the query, submit.
- `"open X"` / URL-shaped input → navigate to that URL directly.
- Anything else → treated as a Google search query.

### Approval gates

Actions can be flagged `requiresApproval: true` in the plan. When triggered, the sidebar pauses and asks you to **Approve** or **Reject** before proceeding. The heuristic planner does not flag any actions by default; extend the planner to add approval for sensitive steps (login, payment, form submit, etc.).

---

## Project Structure

```
browser-execution-runtime/
├── electron/                  # Electron main process (TypeScript)
│   ├── main.ts                # App bootstrap, BrowserView, bridge, IPC
│   ├── preload.ts             # Exposes safe APIs to the renderer
│   ├── bridge-server.ts       # WebSocket bridge (extension ↔ renderer)
│   ├── browser-executor.ts    # Runs actions directly via webContents
│   ├── config.ts              # AI provider config from .env
│   ├── gemini-planner.ts      # Gemini planning via @google/genai
│   ├── ollama-planner.ts      # Ollama planning via local HTTP API
│   └── project-store.ts       # Save/load projects as JSON files
├── extension/                 # Chrome extension (MV2, TypeScript)
│   ├── src/
│   │   ├── background.ts      # Bridge connection, action routing
│   │   └── content.ts         # DOM perception, action execution
│   └── manifest.json
├── sidebar/                   # Sidebar UI (HTML + CSS + vanilla JS)
│   ├── index.html
│   ├── styles.css
│   └── renderer.js
├── shared/                    # Shared Zod schemas and TypeScript types
│   ├── schemas.ts
│   └── types.ts
├── arts/                      # Brand assets
│   ├── logo.png               # Icon
│   └── open-browser.png       # Full wordmark
├── .env.example               # AI config template
└── package.json
```

---

## Schemas (Zod)

Defined in `shared/schemas.ts`:

- **`PagePerception`** — URL, title, interactable elements (id, tag, selector, text, rect, role), risk signals.
- **`BrowserAction`** — `click` | `type` | `fill` | `scroll` | `select` | `navigate` | `screenshot`, with typed fields per action.
- **`ActionResult`** — `success`, optional `error`, optional follow-up `PagePerception`.
- **`PlanStep`** — `{ action: BrowserAction, requiresApproval?: boolean }`.

---

## Extending

- **Planner** — Add a new planner function in `electron/` and wire it up in `main.ts` under a new `OPENBROWSER_AI_PROVIDER` value.
- **Actions** — Add new action types to the `BrowserAction` schema in `shared/schemas.ts` and implement execution in `extension/src/content.ts` and `electron/browser-executor.ts`.
- **Approval logic** — Set `requiresApproval: true` on any `PlanStep` to trigger the approval gate in the sidebar.
- **Replay** — `TraceEntry[]` is already persisted per project; add a replay harness that re-feeds the saved plan into `runPlan()`.

---

## License

MIT

## Documentation

Full docs site (VitePress): **https://mediuswareltd.github.io/open-browser/**

Local preview:

```bash
cd docs
npm install
npm run docs:dev
```


---

Repository: [mediuswareltd/open-browser](https://github.com/mediuswareltd/open-browser)
