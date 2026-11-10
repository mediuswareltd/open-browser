# Getting started

Run **OpenBrowser** on your machine.

## 1. Build

| Script | Description |
|--------|-------------|
| `npm start` | Build extension + electron, then launch |
| `npm run dev` | Watch-mode build + launch (for development) |
| `npm run build` | Build both extension and electron |
| `npm run build:electron` | Compile `electron/` TypeScript → `dist/electron/` |
| `npm run build:extension` | Compile `extension/src/` → `extension/dist/` |
| `npm run typecheck` | Type-check without emitting |

---


## 2. Usage

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


## 3. Quick start

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


## 4. Requirements

- **Node.js** 18+
- **npm** 9+
- A Gemini API key ([get one free](https://aistudio.google.com/app/apikey)) — only needed if using the Gemini planner
- Or **Ollama** running locally (`ollama run llama3.2`) — only needed if using the Ollama planner

---


## Next

- Full detail: [Guide](/guide)
- Source: [github.com/mediuswareltd/open-browser](https://github.com/mediuswareltd/open-browser)
