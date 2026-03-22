# Kanban Code Web — Architecture

## Overview

Server-authoritative web application for managing AI coding agent sessions on a kanban board. The server holds all state and runs the Reducer, reconciler, and background orchestrator. The client is a dumb view that applies SSE events and sends REST commands.

Three transports: REST for commands, SSE for state push, WebSocket for terminal I/O.

---

## System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Browser (Client)                            │
│                                                                      │
│  React 18 + Zustand Store (15 fields)                                │
│  ├── BoardView / ListBoardView ── cards rendered from store.links    │
│  ├── CardDetailView ── Terminal (xterm.js) + History + PR + Issue    │
│  ├── SearchOverlay ── BM25 search via NDJSON streaming               │
│  ├── SettingsView ── configurable backendUrl (localStorage)          │
│  └── 26 components total                                             │
│                                                                      │
│  Transports:                                                         │
│  ├── SSE (EventSource) ←── 20 named events (150ms debounce)          │
│  ├── REST (fetch) ──────→ 40 endpoints via configurable getApiBase() │
│  └── WebSocket (binary) ←→ terminal PTY I/O (node-pty ↔ tmux)       │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────┴──────────────────────────────────────────┐
│                       Server (Node.js + Express)                     │
│                                                                      │
│  ┌─ Routes (40 endpoints) ───────────────────────────────────────┐   │
│  │  /api/cards (22)  /api/search (1)  /api/system (11)           │   │
│  │  /health  /api/state  /api/events(SSE)  /api/settings (4)     │   │
│  │  /api/sync (1)  /api/terminal-page (1)                        │   │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Plugin System ────────────────────────────────────────────────┐  │
│  │  plugins/claude/descriptor.json + adapters/                    │  │
│  │  plugins/gemini/descriptor.json + adapters/                    │  │
│  │  plugins/kiro/descriptor.json   + adapters/                    │  │
│  │                                                                │  │
│  │  loadPlugins() → registerDescriptors() → CodingAssistantRegistry  │
│  │  CompositeSessionDiscovery ── fans out to all registered       │  │
│  │  CompositeActivityDetector ── fans out to all registered       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ State Management (Elm-like) ──────────────────────────────────┐  │
│  │  AppState ── single source of truth (links, sessions, activity) │  │
│  │  Action (51 types) → Reducer (pure, sync) → (State', Effects)  │  │
│  │  EffectHandler (async, 14 effect types) → disk, tmux, notifs   │  │
│  │  StoreManager ── dispatch + SSE broadcast via ACTION_TO_SSE_EVENT │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Background Orchestrator (5s tick) ────────────────────────────┐  │
│  │  1. processHookEvents() ── Stop → needsAttention               │  │
│  │  2. discoverSessions() ── Claude JSONL + Gemini JSON + Kiro SQLite │
│  │  3. listTmuxSessions() ── live tmux session scan               │  │
│  │  4. listWorktrees() ── per configured project                  │  │
│  │  5. fetchPRs() ── GitHub CLI (GraphQL batch)                   │  │
│  │  6. CardReconciler.reconcile() ── 5-phase match/merge/dedup    │  │
│  │  7. pollActivity() ── hook-based + file mtime fallback         │  │
│  │  8. dispatch('reconciled') ── column recomputation + SSE       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Infrastructure ───────────────────────────────────────────────┐  │
│  │  CoordinationStore ── ~/.kanban-code-web/links.json (atomic)   │  │
│  │  SettingsStore ── ~/.kanban-code-web/settings.json (mtime cache) │  │
│  │  HookEventStore ── ~/.kanban-code/hook-events.jsonl (shared)   │  │
│  │  ShellCommand ── user env injection, 7 search paths            │  │
│  │  Logger ── ~/.kanban-code-web/logs/kanban-code.log             │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
web/
├── shared/                      ← Shared types (raw TS, no build step)
│   ├── src/
│   │   ├── types/               ← 16 type modules
│   │   ├── helpers/             ← enrichLink, enrichLinks, validateColumnMove
│   │   └── constants/           ← SSE_EVENT_TYPES, PR_STATUS_COLORS, CARD_LABEL_COLORS
│   └── tests/                   ← 187 tests
│
├── server/                      ← Node.js + Express backend
│   ├── src/
│   │   ├── routes/              ← cards.ts, search.ts, system.ts
│   │   ├── store/               ← AppState, Reducer, StoreManager
│   │   ├── effects/             ← EffectHandler (14 effect types)
│   │   ├── reconciler/          ← CardReconciler (5-phase)
│   │   ├── orchestrator/        ← BackgroundOrchestrator (5s tick)
│   │   ├── plugins/             ← claude/, gemini/, kiro/ (descriptor + adapters)
│   │   ├── ports/               ← 9 domain port interfaces
│   │   └── infrastructure/      ← CoordinationStore, SettingsStore, ShellCommand, Logger
│   └── tests/
│
└── client/                      ← React 18 + Vite frontend
    ├── src/
    │   ├── components/          ← 26 components
    │   ├── store/               ← Zustand store (15 fields) + applyEvent
    │   ├── hooks/               ← useSSE, useTerminal, useKeyboardShortcuts
    │   └── lib/                 ← api-client (25+ methods), ws-manager
    └── tests/
```

---

## Server Architecture

### Routes (34 Endpoints)

**cards.ts (20 routes)**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cards` | List all cards |
| POST | `/api/cards` | Create manual task |
| PATCH | `/api/cards/:id` | Update / move card |
| DELETE | `/api/cards/:id` | Delete card |
| POST | `/api/cards/:id/archive` | Archive card |
| POST | `/api/cards/:id/reorder` | Reorder within column |
| POST | `/api/cards/:id/launch` | Launch new session |
| POST | `/api/cards/:id/resume` | Resume session |
| POST | `/api/cards/:id/cancel-launch` | Cancel in-progress launch |
| DELETE | `/api/cards/:id/terminals/:name` | Kill terminal |
| POST | `/api/cards/:id/move-to-project` | Move card to project |
| POST | `/api/cards/:id/fork` | Fork session |
| POST | `/api/cards/:id/send-prompt` | Send prompt directly |
| GET | `/api/cards/:id/queued-prompts` | List queued prompts |
| POST | `/api/cards/:id/queued-prompts` | Add queued prompt |
| DELETE | `/api/cards/:id/queued-prompts/:pid` | Remove queued prompt |
| POST | `/api/cards/:id/queued-prompts/:pid/send` | Send specific queued prompt |
| PATCH | `/api/cards/:id/queued-prompts/:pid` | Update queued prompt |
| POST | `/api/cards/bulk-resume` | Bulk resume cards |
| POST | `/api/cards/bulk-move-project` | Bulk move to project |
| POST | `/api/cards/bulk-delete` | Bulk delete cards |

**search.ts (1 route)**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search?q=` | BM25 full-text search, NDJSON streaming |

**system.ts (9 routes)**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tmux-sessions` | List live tmux sessions |
| GET | `/api/worktrees` | List all worktrees |
| POST | `/api/rediscover` | Force session rediscovery |
| GET | `/api/backlog` | Get backlog items |
| POST | `/api/backlog/refresh` | Refresh backlog from GitHub |
| POST | `/api/hooks/install` | Install hook scripts |
| POST | `/api/hooks/uninstall` | Uninstall hook scripts |
| GET | `/api/hooks/status` | Hook installation status |
| GET | `/api/assistants` | List registered assistant descriptors |

**index.ts inline (5 routes)**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/state` | Full state snapshot |
| GET | `/api/events` | SSE stream |
| GET | `/api/settings` | Read settings |
| PATCH | `/api/settings` | Update settings |

---

### State Management (Elm-like Unidirectional)

```
User Action (REST) → StoreManager.dispatch(action)
                       → reduce(state, action)          [pure, sync]
                       → (newState, effects[])
                       → this.state = newState
                       → buildEventPayload: enrichLinks() applied to state.links
                       → SSE broadcast (ACTION_TO_SSE_EVENT mapping)
                       → EffectHandler.execute(effects) [async]
                            → disk I/O, tmux, notifications
                            → may dispatch follow-up actions
```

### AppState (Single Source of Truth)

```typescript
interface AppState {
  links: Record<string, Link>;               // cardId → Link (all cards)
  sessions: Record<string, Session>;          // sessionId → Session
  activityMap: Record<string, ActivityState>; // sessionId → activity
  tmuxSessions: string[];                     // live tmux session names
  selectedCardId: string | null;
  configuredProjects: Project[];
  deletedCardIds: string[];                   // prevent reconciler resurrection
  deletedSessionIds: string[];
  // ... 21 fields total
}
```

### 51 Action Types

- **UI/Card**: createManualTask, selectCard, moveCard, renameCard, archiveCard, deleteCard, reorderCard, updatePrompt
- **Launch/Resume**: launchCard, launchCompleted, launchTmuxReady, launchFailed, resumeCard, resumeCompleted, resumeFailed, cancelLaunch
- **Terminal**: createTerminal, addExtraTerminal, terminalCreated, terminalFailed, extraTerminalCreated, killTerminal, renameTerminalTab, reorderTerminalTab
- **Links**: unlinkFromCard, addBranchToCard, addIssueLinkToCard, addPRToCard, markPRMerged
- **Queued Prompts**: addQueuedPrompt, updateQueuedPrompt, removeQueuedPrompt, sendQueuedPrompt, sendDirectPrompt
- **Organization**: moveCardToProject, moveCardToFolder, mergeCards
- **Migration**: beginMigration, migrateSession, migrationFailed
- **Bulk**: bulkResume, bulkMoveToProject, bulkDelete
- **Background**: reconciled, activityChanged, gitHubIssuesUpdated, settingsLoaded, setIsLoading, setIsRefreshingBacklog, setRateLimitedRepos, setGlobalRemoteSettings, setPaletteOpen

### 14 Effect Types

`persistLinks`, `upsertLink`, `removeLink`, `createTmuxSession`, `killTmuxSession`, `killTmuxSessions`, `deleteSessionFile`, `cleanupTerminalCache`, `updateSessionIndex`, `moveSessionFile`, `sendPromptToTmux`, `sendPromptWithImagesToTmux`, `deleteFiles`, `persistDeletedIds`

### 9 Domain Port Interfaces

`ActivityDetector`, `NotifierPort`, `PRTrackerPort`, `SessionDiscovery`, `SessionLauncher`, `SessionStore` (with `resolveSessionPath`), `SyncManager`, `TmuxManagerPort`, `WorktreeManagerPort`

---

### Reconciled Handler (Critical)

The `reconciled` action merges background discoveries with in-memory state:

1. **isLaunching guard** — cards mid-launch preserved (30s stale timeout)
2. **Deleted card/session skip** — prevents resurrection
3. **Last-writer-wins** — newer `updatedAt` wins
4. **Orphan worktree dedup** — absorbs orphan cards into session cards on same branch
5. **Column recomputation** — `UpdateCardColumn` for all non-launching cards
6. **Selected card validation** — clears if card removed

### Card Reconciliation (5-Phase)

```
Phase A:   Match sessions to cards (sessionId → branch → projectPath+tmux)
Phase A2:  Update branch index from session metadata
Phase B:   Match worktrees to cards (orphan creation, launch-phase association)
Phase B1.5: Detect branch switches, clear stale PRs
Phase B2:  Absorb orphan worktree cards
Phase C:   Match PRs to cards via branch name
Phase D:   Clear dead links (tmux sessions gone, worktree paths deleted)
```

---

## Client Architecture

### 26 Components

`App`, `AddLinkPopover`, `AssistantIcon`, `AssistantPill`, `BoardView`, `BulkConfirmDialog`, `CardDetailView`, `CardView`, `ColumnView`, `DragAndDrop`, `ImageChipsView`, `LaunchConfirmationDialog`, `ListBoardView`, `NewTaskDialog`, `OnboardingWizard`, `PRBadge`, `ProcessManagerView`, `PromptEditor`, `QueuedPromptDialog`, `QueuedPromptsBar`, `SearchOverlay`, `SessionHistoryView`, `SettingsView`, `Terminal`, `TerminalTabs`, `Toast`

### Zustand Store (15 Fields)

`links`, `selectedCardId`, `selectedProjectPath`, `paletteOpen`, `detailExpanded`, `boardViewMode`, `error`, `isLoading`, `isConnected`, `backendUrl`, `selectedCardIds`, `selectedAssistant`, `selectedCardType`, `pendingOps`

The store exposes `applyEvent(event)` which handles all 20 SSE event types by updating the relevant slice of state.

### 3 Hooks

- **useSSE** — EventSource with configurable `backendUrl`, auto-reconnect, routes events to `applyEvent`
- **useTerminal** — xterm.js + TerminalWS via `ws-manager`, binary PTY frames + JSON control frames
- **useKeyboardShortcuts** — global keyboard bindings for board navigation

### Configurable Backend URL

```
SettingsView → localStorage → store.backendUrl
                                   ↓
                     getApiBase()  ←  all REST calls (api-client, 25+ methods)
                     useSSE        ←  SSE EventSource URL
                     ws-manager    ←  WebSocket URL
```

This allows the client to connect to a remote server instance without rebuilding.

---

## Shared Package

16 type modules, 187 tests. Consumed directly as raw TypeScript (no build step).

### Key Exports

- **`Link`** — 25 fields + 6 computed properties (primary card entity)
- **`enrichLink` / `enrichLinks`** — applied by server before every SSE broadcast
- **`validateColumnMove`** — shared column transition validation
- **`SSE_EVENT_TYPES`** — 20 event type constants
- **SSE payload interfaces** — typed payload per event type
- **REST request/response types** — shared between client api-client and server route handlers
- **`TerminalServerMessage` / `TerminalClientMessage`** — WebSocket protocol types
- **`AssistantDescriptor`** — descriptor schema type
- **`CodingAssistant`** — now `string` (runtime-extensible from plugin descriptors)
- **`CodingAssistantRegistry` functions** — `getDisplayName`, `getCliCommand`, etc. (one-line descriptor lookups)
- **`PR_STATUS_COLORS`**, **`CARD_LABEL_COLORS`** — shared UI constants

---

## Data Flow

### Full Dispatch Pipeline

```
1. REST request arrives → route handler validates input
2. route handler calls store.dispatch(action)
3. Reducer: (state, action) → (newState, effects[])    [pure, synchronous]
4. StoreManager stores newState
5. buildEventPayload(action, newState)
   └── enrichLinks(state.links) applied for card-related events
6. SSE broadcast: ACTION_TO_SSE_EVENT[action.type] → named event + payload
7. EffectHandler.execute(effects) [async, non-blocking]
   └── may dispatch follow-up actions (launchCompleted, terminalCreated, etc.)
```

### Background Orchestrator (5s Tick)

```
hooks → discover → tmux → worktrees → PRs → reconcile → activity → dispatch('reconciled')
```

Each step is independent; failures in one step do not abort the tick.

---

## Plugin System

### Why Plugins

Each CLI assistant has different session storage, hook event formats, CLI flags, and config structure. Descriptor-driven plugins allow new tools with zero engine changes.

### Plugin Structure

```
plugins/<name>/
├── descriptor.json          ← All properties: CLI command, flags, hooks, icon
└── adapters/
    ├── index.ts             ← Factory: createAdapters(desc) → { discovery, detector, store }
    ├── session-discovery.ts ← Implements SessionDiscovery port
    ├── session-store.ts     ← Implements SessionStore port
    └── activity-detector.ts ← Implements ActivityDetector port
```

### Descriptor Schema

```json
{
  "id": "kiro",
  "displayName": "Kiro CLI",
  "cliCommand": "kiro-cli chat --agent default",
  "availabilityCheck": "kiro-cli",
  "autoApproveFlag": "--trust-all-tools",
  "resumeFlag": "--resume",
  "supportsWorktree": false,
  "supportsImageUpload": true,
  "hooks": {
    "events": ["stop", "userPromptSubmit", "agentSpawn"],
    "configPath": "agents/default.json",
    "configFormat": "flat",
    "normalize": { "agentSpawn": "SessionStart", "stop": "Stop" }
  },
  "icon": { "svgPath": "M13 3L4 14h5l-1 7 9-11h-5l1-7z" }
}
```

### Plugin Loading Flow

```
Server startup
  → loadPlugins(pluginsDir, registry)
    → for each subdirectory:
      → read descriptor.json
      → isAvailable(desc.availabilityCheck)
      → dynamic import adapters/index.ts
      → createAdapters(desc) → { discovery, detector, store }
      → registry.register(desc.id, discovery, detector, store)
  → registerDescriptors(descriptors)      // populates helper function lookups
  → CompositeSessionDiscovery(registry)   // fans out to all registered
  → CompositeActivityDetector(registry)   // fans out to all registered
  → BackgroundOrchestrator starts 5s tick
```

### Session Storage by Plugin

| Plugin | Storage | Format |
|--------|---------|--------|
| claude | `~/.claude/projects/<dir>/*.jsonl` | JSONL streaming, file scan + mtime cache |
| gemini | `~/.gemini/tmp/<slug>/chats/*.json` | JSON single file, file scan + mtime cache |
| kiro | `~/Library/Application Support/kiro-cli/data.sqlite3` | SQLite `conversations_v2` table |

### Activity Detection

```
Hook-based (primary):
  UserPromptSubmit → activelyWorking
  Stop             → needsAttention (after configurable delay)
  SessionStart / agentSpawn → idleWaiting

Polling fallback (when hooks absent):
  Claude: NEVER returns activelyWorking (only hooks can)
  Gemini/Kiro: CAN return activelyWorking if file/db modified <2min
  All: <5min idle → idleWaiting, 5-60min → needsAttention, 1-24hr → ended, >24hr → stale
```

---

## Transport Layer

### SSE (Server-Sent Events)

- Endpoint: `GET /api/events`
- Initial snapshot on connect: `state:snapshot`
- 150ms debounce for background changes; immediate for user-initiated actions
- 20 named event types mapped from 51 actions via `ACTION_TO_SSE_EVENT`
- `enrichLinks()` applied to card payloads before broadcast
- Client `applyEvent` switch handles each event type in Zustand store

### WebSocket (Terminal)

- Endpoint: `/ws/terminal/:sessionName`
- Binary frames = terminal I/O (PTY output ↔ xterm.js input)
- Text frames = JSON control messages (`{type:'resize', cols, rows}`)
- PTY spawn: `tmux attach` with 50-retry polling loop + mouse mode enabled
- Auto-reconnect with exponential backoff (5 retries)

### REST (fetch via api-client)

- 25+ methods covering all card, system, and settings operations
- `getApiBase()` reads `backendUrl` from Zustand store (set from localStorage)
- All mutations go through REST → server dispatch → SSE broadcast (no optimistic updates)

---

## Deployment

### File System Layout

```
~/.kanban-code-web/              ← Web app data (separate from native)
├── links.json                   ← Card coordination records (atomic write)
├── settings.json                ← User settings (mtime-cached)
└── logs/kanban-code.log

~/.kanban-code/                  ← Shared with native macOS app
├── hook.sh                      ← Hook handler script (all assistants)
└── hook-events.jsonl            ← Hook event log (read by web + native)

~/.claude/projects/<dir>/*.jsonl             ← Claude session files
~/.gemini/tmp/<slug>/chats/*.json            ← Gemini session files
~/Library/Application Support/kiro-cli/data.sqlite3  ← Kiro sessions
```

### Running

**Single machine (default)**

```bash
./web/dev.sh              # starts both server (3000) and client (5173)
```

**Split frontend/backend** — set `backendUrl` in the client Settings UI to point to the remote server. The client reads this from localStorage on every request; no rebuild required.

**Environment**

- Node 22 required (node-pty 0.10.1 constraint)
- Web data at `~/.kanban-code-web/` to avoid overwriting native app's `links.json`

---

## Testing

~1,572 tests across 3 packages:

| Package | Tests | Coverage |
|---------|-------|----------|
| shared | 187 | Types, helpers, enrichLink, validateColumnMove, SSE payload shapes |
| server | ~1,100 | Reducer actions, reconciler phases, effect handler, plugin adapters, routes |
| client | ~285 | Component rendering, store applyEvent, hook behaviour |

---

## Design Principles

1. **Server is truth** — client never reconciles or optimistically updates state
2. **Plugins, not switches** — assistant properties from JSON descriptors, not code branches
3. **Ports and adapters** — 9 domain port interfaces, plugin adapters per assistant
4. **Pure reducer** — synchronous, no side effects, fully testable in isolation
5. **Atomic writes** — `.tmp` → rename pattern for all persistent stores
6. **Mtime caching** — skip re-read if file unchanged (SettingsStore, SessionDiscovery)
7. **Graceful degradation** — each assistant and external tool is optional
8. **Hook events over polling** — hooks are the only path to "activelyWorking" for Claude
9. **enrichLinks at broadcast boundary** — computed Link fields added once, at SSE send time
