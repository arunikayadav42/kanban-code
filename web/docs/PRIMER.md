# Kanban Code Web — PRIMER

> **Read this file first.** Everything needed to run, develop, and distribute the web version.

## What This Is

A web kanban board for managing AI coding agent sessions — Claude Code, Gemini CLI, Kiro CLI, or any future CLI tool via the plugin system. Server-authoritative: Node.js holds all state, browser is a dumb view.

## Quick Start

```bash
cd web
bash dev.sh          # Installs deps, builds shared types, starts server + client
```

Open http://localhost:5173

### Flags

```bash
bash dev.sh              # Normal start (auto-installs if needed)
bash dev.sh --fresh      # Wipe discovered cards, rediscover from disk
bash dev.sh --release    # Clean node_modules, create distribution zip
```

### Environment Variables

| Variable | Default | What |
|----------|---------|------|
| `KANBAN_SERVER_PORT` | `3000` | Backend port |
| `KANBAN_CLIENT_PORT` | `5173` | Frontend port |
| `HOST` | `127.0.0.1` | Bind address |
| `KANBAN_LOG_STDOUT` | `1` | Set `0` to silence terminal logs |

```bash
KANBAN_SERVER_PORT=4000 KANBAN_CLIENT_PORT=8080 bash dev.sh
```

## Architecture

```
Browser (View)                              Server (Source of Truth)
├── xterm.js ─────── WS (binary) ─────────── node-pty (tmux attach)
├── Zustand Store ── SSE (named events) ───── Reducer (71 Actions) + EffectHandler
├── User Actions ─── REST (40 endpoints) ──── CoordinationStore + SettingsStore
└── BM25 Search ──── NDJSON stream ────────── Streaming search (per-doc score)
```

**Elm-like unidirectional flow:**
```
REST request → StoreManager.dispatch(action) → reduce(state, action) → (newState, effects[])
                                                      ↓                        ↓
                                               SSE broadcast            EffectHandler
                                               (ACTION_TO_SSE_EVENT)    (disk I/O, tmux, notifications)
```

## Plugin System

Each CLI tool is a plugin — no hardcoded assistant switches anywhere in engine code.

```
plugins/<name>/
├── descriptor.json          ← Properties: CLI command, flags, hooks, icon, color, timeouts
└── adapters/
    ├── index.ts             ← Factory: createAdapters(desc) → { discovery, detector, store }
    ├── session-discovery.ts ← Discovers sessions from disk/DB
    ├── session-store.ts     ← Reads/writes session transcripts
    └── activity-detector.ts ← Tracks hook events + polling
```

**Adding a new CLI tool:** Create `plugins/your-tool/descriptor.json` + adapter files. Zero engine changes.

### Descriptor Fields

```json
{
  "id": "claude",
  "displayName": "Claude Code",
  "shortName": "Claude",
  "cliCommand": "claude",
  "availabilityCheck": "claude",
  "autoApproveFlag": "--dangerously-skip-permissions",
  "resumeFlag": "--resume",
  "supportsWorktree": true,
  "supportsImageUpload": true,
  "usesPasteInput": false,
  "readyTimeoutMs": 30000,
  "color": "#f97316",
  "hooks": { "events": [...], "configPath": "...", "configFormat": "nested", "normalize": {} },
  "icon": { "svgPath": "...", "viewBox": "0 0 16 16" }
}
```

All helper functions (`getDisplayName`, `getCliCommand`, `getAssistantColor`, etc.) are one-liner descriptor lookups in `shared/src/types/coding-assistant.ts`.

## Tech Stack

- **Client:** React 18 + TypeScript + Vite, xterm.js v6, Zustand, dnd-kit
- **Server:** Node.js 22 + TypeScript + Express, node-pty 0.10.1, ws
- **Shared:** TypeScript types in `web/shared/`
- **Tests:** Vitest (all packages)
- **Fonts:** DM Sans (UI), JetBrains Mono (terminal)

## Project Structure

```
web/
├── shared/src/types/          # 14 type files + coding-assistant helpers
│   └── __tests__/             # 153 tests
├── server/src/
│   ├── plugins/               # claude/, gemini/, kiro/ descriptors + adapter factories
│   ├── domain/ports/          # 9 TypeScript interfaces
│   ├── infrastructure/        # CoordinationStore, SettingsStore, Logger, ShellCommand, KSUID
│   ├── usecases/              # BoardStore (71 Actions), CardReconciler, BackgroundOrchestrator,
│   │                          # AssignColumn, LaunchSession, EffectHandler, ImageSender, BM25, etc.
│   ├── adapters/              # claude/, gemini/, kiro/, git/, tmux/, sync/, notifications/, remote/
│   ├── routes/                # cards.ts (CRUD + bulk), search.ts, system.ts (health, hooks, rediscover)
│   ├── ws/                    # Terminal WebSocket handler
│   ├── sse/                   # Named event broadcaster (150ms debounce)
│   ├── middleware/            # Auth (token-based)
│   └── index.ts               # Express entry point + startup cleanup + rediscovery
├── client/src/
│   ├── components/            # App, BoardView, ListBoardView, CardView, ColumnView,
│   │                          # CardDetailView, TerminalTabs, SessionHistoryView,
│   │                          # SearchOverlay, SettingsView, NewTaskDialog, BulkConfirmDialog,
│   │                          # Toast, AssistantPill, AssistantIcon, etc.
│   ├── hooks/                 # useTerminal, useSSE, useKeyboardShortcuts
│   ├── lib/                   # api-client, ws-manager, theme, markdown-renderer
│   ├── store/                 # Zustand store (links, selection, 3 filters, SSE handler)
│   └── styles/                # kanban.css (glass morphism, dark/light theme)
├── docs/                      # Architecture, specs, plans, reverse engineering
└── dev.sh                     # One-script launcher (install, build, start, release)
```

## Key Features

### Three Toolbar Filters (all independent, all persist via localStorage)
- **Project filter**: "All Projects" / per-project — filters cards by `projectPath`
- **Assistant filter**: "All Assistants" / Claude / Gemini / Kiro — filters by `link.assistant`
- **Card type filter**: "All Types" / Sessions / Tasks / Issues — filters by `source` + `sessionLink`
- All three stack orthogonally (e.g. "Kiro sessions in AISkills project")
- Selection cleared automatically on filter change

### Bulk Select & Actions
- Checkbox on each card (visible on hover, always visible when any selected)
- Three-state column header checkbox (none/some/all)
- "Actions ▾" dropdown menu: Archive, Resume, Move to Project (submenu), Delete (red)
- Move to Project uses portal-based submenu (auto-flips when near viewport edge)
- Confirmation dialog before execution
- Resume capped at 5 concurrent (prevents resource exhaustion)
- Toast notification on completion ("Archived 5 cards", "Deleted 3 cards")

### Assistant Labels on Cards
- Icon + short name (e.g. "Claude", "Kiro") shown in project/branch row
- Color from descriptor, icon from descriptor SVG path
- Backfilled from session discovery (reconciler sets `assistant` on existing cards)
- Cards without sessions show card type badge (SESSION, WORKTREE, ISSUE, PR, TASK)

### Hover Tooltips on Truncated Text
- All 18 truncation points across 9 components have `title` attributes
- CardView: title, project path, assistant name, branch
- CardDetailView: title
- SearchOverlay: card titles, snippets
- ProcessManagerView: session name, path, worktree branch
- SessionHistoryView: tool-use arguments
- TerminalTabs: queued prompt body
- QueuedPromptsBar: prompt body
- BulkConfirmDialog: card names
- LaunchConfirmDialog: project path
- SettingsView: project paths (visible + hidden)

### Project Management
- Auto-discovered from card `projectPath` values (no manual config needed)
- Hidden project blocklist: `hiddenProjectPaths` in `settings.json`
- Settings UI: visible projects with "Remove" + hidden projects with "Restore"
- `POST /api/projects/hide` / `POST /api/projects/unhide` endpoints
- `GET /api/projects` returns configured + auto-discovered, minus hidden

### Startup Cleanup (automatic every start)
- Dead tmuxLink: tmux session not alive → clear
- Dead sessionLink: file doesn't exist on disk → clear (skips kiro-sqlite:// URIs)
- Dead worktreeLink: path doesn't exist → clear
- Stale isLaunching: no launch survives a restart → clear
- Orphan discovered cards: no links at all → remove
- Fresh mode (`--fresh`): wipe all `source: 'discovered'` cards before reconciliation
- Always writes cleaned state back to disk

### Rediscovery
- Toolbar "Rediscover" button: wipes discovered cards, triggers reconciliation, shows toast
- `bash dev.sh --fresh`: same at startup via `KANBAN_STARTUP_MODE=fresh`
- Manual cards (source: 'manual') and GitHub issues preserved through rediscovery

### Deleted Session Persistence
- `deleted-ids.json` persists deleted session/card IDs across restarts
- Prevents reconciler from resurrecting deleted cards
- Plugin-agnostic: works for any assistant's session IDs

### Archived Card Protection
- `manuallyArchived` cards skip column recomputation in reconciled handler
- Only explicit user actions (resumeCard, moveCard) can un-archive
- Background reconciliation never overrides archive decision

### Auto-Scroll Prevention
- Board only scrolls to a card's column when `selectedCardId` actually changes
- Actions (archive, resume, etc.) on the currently selected card don't trigger scroll
- Uses `useRef` to track previous selection

### Logging
- Server logs to both `~/.kanban-code-web/logs/kanban-code.log` AND stdout
- All startup, reconciliation, SSE, and error events visible in terminal
- Set `KANBAN_LOG_STDOUT=0` to silence terminal output

## File System Layout

```
~/.kanban-code-web/              ← Web app data (separate from native ~/.kanban-code/)
├── links.json                   ← Card coordination records
├── deleted-ids.json             ← Persisted deletion blocklist
├── settings.json                ← User settings + hiddenProjectPaths
└── logs/kanban-code.log         ← Application log

~/.kanban-code/                  ← Shared with native app
├── hook.sh                      ← Hook handler script (all assistants)
└── hook-events.jsonl            ← Hook event log (read by web + native)
```

## REST API

### Card CRUD
- `POST /api/cards` — Create manual task
- `GET /api/cards` — List (with column/offset/limit)
- `PATCH /api/cards/:id` — Update (name, column)
- `DELETE /api/cards/:id` — Delete card
- `POST /api/cards/:id/archive` — Archive
- `POST /api/cards/:id/launch` — Launch session
- `POST /api/cards/:id/resume` — Resume session
- `POST /api/cards/:id/move-to-project` — Move to project

### Bulk Operations
- `POST /api/cards/bulk-archive` — `{ cardIds: string[] }`
- `POST /api/cards/bulk-resume` — `{ cardIds: string[] }` (5 concurrent cap)
- `POST /api/cards/bulk-delete` — `{ cardIds: string[] }`
- `POST /api/cards/bulk-move-project` — `{ cardIds: string[], projectPath: string }`

### System
- `GET /api/health` — Dependency status
- `GET /api/settings` / `PATCH /api/settings`
- `GET /api/projects` — Configured + auto-discovered (minus hidden)
- `POST /api/projects/hide` / `POST /api/projects/unhide` — Project blocklist
- `POST /api/rediscover` — Wipe discovered cards + reconcile
- `POST /api/hooks/install` / `POST /api/hooks/uninstall` / `GET /api/hooks/status`
- `GET /api/search?q=` — NDJSON streaming BM25 search

## Commands

```bash
# Start
cd web && bash dev.sh

# Tests
cd web/shared && npm test
cd web/server && npm test
cd web/client && npx vitest run

# Release
cd web && bash dev.sh --release

# Custom ports
KANBAN_SERVER_PORT=4000 KANBAN_CLIENT_PORT=8080 bash dev.sh

# Fresh start (wipe + rediscover)
bash dev.sh --fresh
```

## Key Patterns

### SSE Event Mapping
- `ACTION_TO_SSE_EVENT` in `store-manager.ts` maps 57 action types → SSE event names
- User actions: `sendAndFlush()` (immediate)
- Background: `queueEvent()` (150ms debounce buffer)
- Client `applyEvent`: full `links` replacement on every event (no patching)
- Stale `selectedCardIds` pruned automatically on every SSE update

### Selection State
- `selectedCardIds: Set<string>` in Zustand store (client-only)
- Pruned automatically when SSE delivers updated links (removes deleted card IDs)
- Cleared on project/assistant/card-type filter change
- Cleared after successful bulk operation

### DOM Safety Pattern
- All `contains(e.target)` calls guard with `if (!(target instanceof Node)) return`
- Prevents crashes from SVG elements or portal-rendered content
- Applied consistently in CardView, ColumnView, ListBoardView context menus

### Portal-Based Submenus
- "Move to Project" submenu renders via `createPortal(…, document.body)`
- Positioned with `position: fixed` using trigger's `getBoundingClientRect()`
- Auto-flips left when insufficient viewport space on right
- Explicit `color` CSS var on portal (doesn't inherit from app root)

### Behavioral Invariants
- `isLaunching` guard: reconciler skips cards mid-launch, 30s stale timeout
- `manuallyArchived` guard: reconciler skips column recompute for archived cards
- Polling NEVER returns `activelyWorking` for Claude (only hooks can)
- Gemini/Kiro polling CAN return `activelyWorking` if file/db modified <2min
- `deletedSessionIds`/`deletedCardIds` persisted to `deleted-ids.json`

### Timing Constants
| Constant | Value | Location |
|----------|-------|----------|
| SSE debounce | 150ms | `state-broadcaster.ts` |
| Launch stale timeout | 30s | `board-store.ts` |
| Background tick | 5s | `background-orchestrator.ts` |
| Notification dedup | 62s | `notification-deduplicator.ts` |
| Activity timeout | 300s | `activity-detector.ts` |
| Resume concurrency cap | 5 | `routes/cards.ts` |
| Toast auto-dismiss | 3s | `Toast.tsx` |

## Environment Requirements

- **Node 22** (node-pty 0.10.1 incompatible with Node 23+)
- **tmux** for terminal functionality
- **nvm** recommended (dev.sh auto-switches to Node 22)

## Distribution

```bash
cd web && bash dev.sh --release
# Creates kanban-code-web-YYYYMMDD-HHMM.zip (~640KB, 0 node_modules)
# Recipient: mkdir kanban-code-web && cd kanban-code-web && unzip ../kanban-code-web-*.zip && bash dev.sh
```
