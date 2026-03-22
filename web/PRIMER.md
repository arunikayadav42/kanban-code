# Kanban Code Web — Primer

## What Is This?

Kanban Code is a native macOS app with a web port for managing AI coding agent sessions (Claude Code, Gemini CLI, Kiro CLI, and others) on a kanban board. It is server-authoritative: the Node.js backend holds all state and broadcasts changes over SSE; the browser is a thin view that renders whatever the server says.

## Prerequisites

- **Node 22** — required for node-pty 0.10.1 (terminal sessions will not work on older versions)
- **nvm** — recommended for switching Node versions (`nvm use 22`)
- **tmux** — required for terminal sessions inside cards
- **gh CLI** — optional, enables GitHub PR tracking per card

## Quick Start

```bash
cd web
./dev.sh
# Opens at http://localhost:5173
```

### Flags

| Flag | Effect |
|------|--------|
| `./dev.sh` | Start backend + frontend (default) |
| `./dev.sh --backend` | Backend only (for remote / server deployment) |
| `./dev.sh --frontend` | Frontend only (point to a remote backend via Settings) |
| `./dev.sh --release` | Build a distribution zip |
| `./dev.sh --fresh` | Wipe discovered cards and rediscover from scratch |
| `HOST=0.0.0.0 ./dev.sh --backend` | Accept connections from other machines |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KANBAN_SERVER_PORT` | `3000` | Port the Express backend listens on |
| `KANBAN_CLIENT_PORT` | `5173` | Port Vite dev server listens on |
| `HOST` | `127.0.0.1` | Bind address for both servers |

## Remote / Split Deployment

Run the frontend and backend on separate machines:

1. **Server machine:** `HOST=0.0.0.0 ./dev.sh --backend`
2. **Client machine:** `./dev.sh --frontend`
3. Open **Settings → Backend Connection** and enter `http://<server-ip>:3000`
4. The board auto-refreshes via SSE reconnect — no manual reload needed

## Project Structure

```
web/
├── shared/          @kanban-code/shared — types, helpers, constants
│   └── src/types/   Link, events, api, colors, terminal-protocol
├── server/          Express backend — routes, reducer, SSE, plugins
│   └── src/
│       ├── routes/           REST API endpoints
│       ├── usecases/         Board store, reconciler, orchestrator
│       ├── domain/ports/     Adapter interfaces
│       ├── adapters/         Claude, Gemini, Kiro, Git, Notifications
│       ├── plugins/          Plugin descriptors + adapter factories
│       ├── infrastructure/   File persistence, settings, KSUID, logger
│       ├── sse/              State broadcaster
│       └── ws/               Terminal WebSocket handler
├── client/          React 18 + Vite frontend
│   └── src/
│       ├── components/       26 React components
│       ├── hooks/            useSSE, useTerminal, useKeyboardShortcuts
│       ├── lib/              api-client, ws-manager, theme, markdown
│       ├── store/            Zustand store (state + actions)
│       └── styles/           CSS (glass morphism, pending overlays)
└── dev.sh           Launcher script
```

## Architecture at a Glance

- **Elm-like unidirectional state:** `dispatch(action)` → pure `Reducer` → `Effect`s → SSE broadcast to all clients
- **Client is a thin view:** SSE → Zustand store → React components; no client-side state mutations
- **Plugin system:** each CLI tool ships a `descriptor.json` + adapter factory under `server/src/plugins/<name>/`; `ALL_ASSISTANTS` is populated at runtime
- **3 transports:**
  - REST (`/api/*`) — mutations (create card, launch session, send prompt)
  - SSE (`/api/events`) — server-push state sync (20 event types)
  - WebSocket (`/ws/terminal/:session`) — terminal I/O
- **Background reconciler:** 5-second tick runs discover → reconcile → activity detection → hook processing
- **Configurable backend URL:** frontend can point to any backend host via Settings

## Key Commands

```bash
# Start everything
./dev.sh

# Run tests
cd web/server && npx vitest run   # ~900 server tests
cd web/shared && npx vitest run   # ~180 shared tests
cd web/client && npx vitest run   # ~475 client tests

# Type-check without building
cd web/server && npx tsc --noEmit
cd web/client && npx tsc --noEmit
```

## Data Directories

| Path | Contents |
|------|----------|
| `~/.kanban-code-web/` | Web-specific data: `links.json`, `settings.json`, logs |
| `~/.kanban-code/` | Shared with the native macOS app: `hook-events.jsonl` |

The web app uses a separate data directory so the native app cannot overwrite active card state.

## API Quick Reference

| Endpoint | Description |
|----------|-------------|
| `GET/POST/PATCH/DELETE /api/cards` | Card CRUD |
| `POST /api/cards/:id/launch` | Launch a new agent session |
| `POST /api/cards/:id/resume` | Resume a paused session |
| `POST /api/cards/:id/fork` | Fork a session into a new card |
| `POST /api/cards/:id/send-prompt` | Send a prompt to the running agent |
| `POST/DELETE/PATCH /api/cards/:id/queued-prompts` | Manage the prompt queue |
| `GET /api/events` | SSE stream — subscribe for live state updates |
| `GET /api/state` | REST snapshot of current board state |
| `GET /api/assistants` | List loaded plugin descriptors |
| `GET /api/settings` + `PATCH` | Read / update user settings |
| `GET /api/search?q=` | BM25 full-text search (NDJSON streaming response) |
| `WS /ws/terminal/:session` | Terminal I/O (xterm.js ↔ node-pty) |
