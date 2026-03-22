# Kanban Code – Claude Code Guidelines

## Project Structure

```
kanban-code-final/
├── web/              ← Node.js backend + React frontend + shared types
└── mobile/           ← React Native Android app (Expo)
```

## Build & Test

```bash
# Web
cd web && ./dev.sh                    # backend + frontend
cd web && HOST=0.0.0.0 ./dev.sh --backend  # backend only

# Mobile
cd mobile && ./setup-prereqs.sh       # one-time: Java, ADB, Android SDK
cd mobile && ./build-apk.sh --install # build + install APK on device
cd mobile && ./dev.sh                 # start Expo dev server (hot-reload)
```

## Web Architecture

- **Shared types** (`web/shared/`) — TypeScript types shared between server, client, and mobile.
- **Server** (`web/server/`) — Express backend with domain-driven design (ports/adapters). Adapters for Claude, Gemini, Kiro, git, tmux, notifications.
- **Client** (`web/client/`) — React + Vite frontend with Zustand state, xterm.js terminal, Tailwind CSS.
- **Mobile** (`mobile/`) — React Native (Expo) Android app. Zustand store, WebView terminal, theme system.
- Unidirectional state: all mutations go through `store.dispatch(action)` → reducer → SSE broadcast to clients.
- `isLaunching` flag on `Link` prevents background reconciliation from overriding cards mid-launch/resume.

## Key Endpoints

- `POST /api/cards` — create card
- `POST /api/cards/:id/launch` — launch session
- `POST /api/sync` — full reconciliation + PR fetch (on-demand)
- `GET /api/search?q=` — BM25 NDJSON streaming search
- `GET /sse` — Server-Sent Events for real-time state

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages. Release-please uses these to generate changelogs automatically.

- `feat: add dark mode` — new feature (minor version bump)
- `fix: correct session dedup` — bug fix (patch version bump)
- `perf: speed up branch discovery` — performance (patch)
- `refactor: extract hook manager` — refactoring (hidden from changelog)
- `docs: update README` — documentation (hidden)
- `chore: bump deps` — maintenance (hidden)
- `feat!: redesign board layout` — breaking change (major version bump)

## Logs

App logs: `~/.kanban-code/logs/kanban-code.log`
