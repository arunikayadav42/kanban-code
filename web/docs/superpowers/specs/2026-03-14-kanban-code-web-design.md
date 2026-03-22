# Kanban Code Web — Design Specification

**Date:** 2026-03-14
**Status:** Code-verified (10 parallel agents validated every decision against source)
**Scope:** Full feature parity with macOS native app — all 33 features, no deferrals

---

## 1. Overview

Build a web version of Kanban Code — a kanban board for managing AI coding agent sessions (Claude Code + Gemini CLI). The web app must achieve exact feature parity with the existing macOS SwiftUI app.

### Key Decisions (Code-Verified)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deployment | Local-first AND remote-capable | Same backend serves localhost or remote |
| Frontend | React + TypeScript + Vite (adapt from `windows/src/`) | Existing Tauri components need adaptation (replace `@tauri-apps` invoke patterns with REST/WS), but layout and UI logic reusable |
| Backend | Node.js + TypeScript | Single language, node-pty proven at scale (VS Code Server), shared types |
| Monorepo | Single `web/` directory in this repo | Co-located with macOS source and specs |
| Terminal | xterm.js v6 + node-pty via WebSocket | 24 tmux commands mapped 1:1 to web equivalents |
| State | Server-authoritative, no client reconciliation | Reconciler orphan dedup (BoardStore.swift:997-1032) needs ALL cards; 11 user actions overlap with reconciler |
| SSE | Named events + 150ms debounce (not JSON Patch) | 51 Actions, Set types and bulk replacements break JSON Patch; bursty cascading dispatches |
| REST | Specific endpoints (not generic dispatch) | Better documentation, per-endpoint middleware, clearer error types |
| Search | NDJSON streaming (improvement over native) | Eliminates O(n²) rescoring in native searchSessionsStreaming |
| Optimistic updates | Never — server-authoritative only | 11 overlapping actions with reconciler, 5 unguarded — needs CRDT/OT for safety |
| PTY pooling | None — fresh tmux attach on reconnect | tmux redraws in ~50ms; TerminalCache pattern maps to keeping xterm.js instances alive |
| Notifications | Pushover (server) + Browser Notification API (client) | UNUserNotificationCenter is macOS-only |
| Markdown images | Browser-side (marked + html2canvas) | Eliminates pandoc + wkhtmltoimage server dependency |
| Multi-assistant | 100% TypeScript translatable | All operations are file I/O + JSON manipulation |
| Compression | Remote connections only | Localhost bandwidth is free; permessage-deflate costs 300KB per WS connection |

---

## 2. Architecture

### Server-Authoritative Model

The native app's strength is a single-threaded Reducer operating on full state (`@MainActor`). The web port preserves this by keeping the Reducer server-side. The client is a view — it applies events and sends commands, never reconciles.

```
Browser (View)                              Server (Source of Truth)
┌──────────────────────────┐      ┌──────────────────────────────────────┐
│                          │      │                                      │
│  xterm.js ───────────────┤─ WS ─┤── node-pty (tmux attach per session) │
│  (binary=data, text=ctrl)│      │                                      │
│                          │      │  AppState (ALL cards, full state)     │
│  Zustand Store ◄─────────┤─ SSE ┤── Reducer (51 Actions, pure)         │
│  (apply named events)    │      │── EffectHandler (async side effects)  │
│                          │      │── CardReconciler (5-phase dedup)      │
│  User Actions ───────────┤─REST─┤── BackgroundOrchestrator (5s tick)    │
│  (31 endpoints)          │      │── AssignColumn (pure column logic)    │
│                          │      │                                      │
│  BM25 Search ◄───────────┤─NDJSON┤── Streaming search (per-doc score)  │
│                          │stream│                                      │
└──────────────────────────┘      └──────────────────────────────────────┘
```

### Why Server-Authoritative (Evidence)

- **Orphan dedup** (BoardStore.swift:997-1032) groups ALL cards by branch — client with partial state would miss orphans
- **Archived cards resume** (UpdateCardColumn.swift:27-29) — reconciler moves archived → active when hooks fire
- **Session matching** (CardReconciler.swift:428-435) searches ALL links — partial state misses matches
- **11 user actions overlap** with reconciler mutations, 5 have no guard — optimistic updates create distributed state conflicts requiring CRDT/OT

### Project Structure

```
web/
├── client/                      # React + Vite frontend
│   ├── src/
│   │   ├── components/          # Adapt from windows/src/components/ (replace Tauri IPC with REST/WS)
│   │   ├── store/               # Zustand (SSE event application)
│   │   ├── hooks/               # useTerminal, useSSE, useBoard
│   │   ├── lib/                 # API client, WS manager, SSE client
│   │   └── types/               # Shared type imports
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── server/                      # Node.js + Express backend
│   ├── src/
│   │   ├── adapters/            # Mirror KanbanCodeCore/Adapters/
│   │   │   ├── claude/          # Discovery, Store, ActivityDetector, JsonlParser
│   │   │   ├── gemini/          # Discovery, Parser, Store, ActivityDetector
│   │   │   ├── tmux/            # TmuxAdapter (24 commands)
│   │   │   ├── git/             # Worktree, RemoteResolver, GhCli
│   │   │   ├── notifications/   # Pushover, Dedup, TranscriptReader
│   │   │   └── sync/            # MutagenAdapter
│   │   ├── domain/
│   │   │   ├── entities/        # Link, Session, Project, CodingAssistant, etc.
│   │   │   └── ports/           # TypeScript interfaces (9 ports)
│   │   ├── usecases/
│   │   │   ├── board-store.ts   # AppState, Action (51 cases), Reducer, effects
│   │   │   ├── effect-handler.ts
│   │   │   ├── card-reconciler.ts
│   │   │   ├── background-orchestrator.ts
│   │   │   ├── assign-column.ts
│   │   │   ├── bm25-scorer.ts
│   │   │   ├── launch-session.ts
│   │   │   ├── prompt-builder.ts
│   │   │   ├── image-sender.ts
│   │   │   ├── session-migrator.ts
│   │   │   ├── remote-shell-manager.ts
│   │   │   ├── coding-assistant-registry.ts
│   │   │   ├── composite-session-discovery.ts
│   │   │   ├── composite-activity-detector.ts
│   │   │   ├── pane-output-parser.ts
│   │   │   └── project-discovery.ts    # Detect unconfigured project paths from sessions
│   │   ├── infrastructure/
│   │   │   ├── coordination-store.ts
│   │   │   ├── settings-store.ts
│   │   │   ├── hook-event-store.ts
│   │   │   ├── shell-command.ts
│   │   │   ├── ksuid.ts
│   │   │   ├── session-file-mover.ts   # Move .jsonl between project dirs, update cwd field
│   │   │   └── logger.ts
│   │   ├── routes/              # REST API (31 endpoints)
│   │   ├── ws/                  # WebSocket terminal handler
│   │   ├── sse/                 # Named event broadcaster
│   │   └── index.ts             # Server entry point
│   ├── tsconfig.json
│   └── package.json
│
├── shared/                      # Shared TypeScript types
│   ├── types.ts                 # Link, Session, Project, Action, AppState
│   ├── columns.ts               # KanbanCodeColumn enum
│   ├── events.ts                # SSE event type definitions
│   └── package.json
│
├── package.json                 # Root scripts: dev, build, start
└── tsconfig.base.json
```

---

## 2.5 Security & Authentication

The server can launch terminal sessions, execute shell commands, and access the filesystem. Security is mandatory for remote access and good practice for local.

### Authentication

| Mode | Mechanism | When |
|------|-----------|------|
| **Local** (`localhost`) | Optional — trust local user. Can be enabled via config. | Default for `npm run dev` |
| **Remote** (non-localhost) | Required — token-based auth. | Enforced when `KANBAN_AUTH=required` or bind address is non-loopback |

**Token auth flow:**
1. On first start, server generates a random 256-bit token, saves to `~/.kanban-code/auth-token`
2. Server prints the authenticated URL: `http://server:3000?token=<TOKEN>`
3. Client includes token as `Authorization: Bearer <TOKEN>` header on all REST, SSE, and WS connections
4. Server middleware rejects requests without valid token (401 Unauthorized)
5. Token rotatable via `POST /api/auth/rotate` (invalidates all existing sessions)

### Transport Security

| Concern | Mitigation |
|---------|-----------|
| **Eavesdropping** | Use SSH tunnel (`ssh -L 3000:localhost:3000 server`) or reverse proxy with TLS. App logs a hint when remote access is detected without TLS. |
| **CORS** | Strict origin checking. Default: same-origin only. Configurable via `KANBAN_CORS_ORIGIN`. |
| **WebSocket origin** | Validate `Origin` header on WS upgrade. Reject cross-origin unless configured. |
| **Rate limiting** | Per-IP rate limiting on REST endpoints (100 req/min default). No limit on SSE/WS (persistent connections). |
| **Input validation** | Sanitize all user inputs. Shell commands use parameterized exec (never string interpolation). File paths validated against allowed directories. |

### Local-Only Mode (Default)

When running on `localhost` without `KANBAN_AUTH`:
- No token required
- CORS allows `localhost:*`
- All endpoints accessible
- This matches the native app's security model (local process, no network exposure)

---

## 3. Transport Layer

### 3.1 Terminal WebSocket (`/ws/terminal/:sessionName`)

One WebSocket per terminal tab. Binary frames for terminal data, text frames for control (native WS opcodes — zero custom framing).

**Connection lifecycle:**
1. Client opens WS to `/ws/terminal/:sessionName`
2. Server spawns node-pty: `userShell -l -c "for i in $(seq 1 50); do tmux has-session -t 'NAME' && break; sleep 0.1; done; exec tmux attach-session -t 'NAME'"`
3. PTY stdout → binary WS frames → xterm.js
4. xterm.js input → binary WS frames → PTY stdin
5. Resize: text WS frame `{"type":"resize","cols":N,"rows":N}` → `pty.resize()`
6. On WS close: kill PTY process (tmux client only — server session persists)
7. On reconnect: fresh PTY spawns, tmux redraws current screen (~50ms)

**Control messages (text frames, JSON):**

| Client → Server | Purpose |
|----------------|---------|
| `{"type":"resize","cols":N,"rows":N}` | Terminal resized |

| Server → Client | Purpose |
|----------------|---------|
| `{"type":"exit","code":N}` | PTY process exited |

**All other terminal interaction uses binary frames exclusively.**

### 3.2 Server-Sent Events (`/api/events`)

Single SSE connection per browser tab. Named events with 150ms debounce for background changes, immediate flush for user-initiated changes.

**On connect:** Full `AppState` snapshot (active cards + metadata):
```
event: state:snapshot
data: {"links":{...},"sessions":{...},"activityMap":{...},...}
```

**Subsequent events (named, debounced):**

| Event | When | Payload |
|-------|------|---------|
| `card:updated` | Single card changed | `{cardId, link}` |
| `card:deleted` | Card removed | `{cardId}` |
| `cards:reordered` | Multiple sortOrders changed | `{cards:[{id,sortOrder},...]}` |
| `cards:reconciled` | Full reconciliation cycle | `{links:{...},sessions:{...},activityMap:{...},tmuxSessions:[...]}` |
| `activity:changed` | Session activity updated | `{activityMap:{sessionId:state,...}}` |
| `github:issues-updated` | Backlog refreshed | `{links:[...],lastRefresh}` |
| `github:rate-limited` | API rate limit hit | `{repos:[...]}` |
| `launch:completed` | Session launched | `{cardId,tmuxName,sessionLink?,worktreeLink?}` |
| `launch:failed` | Launch failed | `{cardId,error}` |
| `resume:completed` | Session resumed | `{cardId,tmuxName}` |
| `resume:failed` | Resume failed | `{cardId,error}` |
| `terminal:created` | Terminal ready | `{cardId,tmuxName}` |
| `terminal:failed` | Terminal creation failed | `{cardId,error}` |
| `settings:loaded` | Settings changed | `{projects,excludedPaths,remote}` |
| `notification:fired` | Push notification sent | `{cardId,title,message,markdownContent}` |
| `migration:failed` | Session migration failed | `{cardId,error}` |
| `error` | Error occurred | `{message}` |
| `loading` | Loading state changed | `{isLoading}` |
| `backlog:refreshing` | GitHub refresh state | `{refreshing}` |

**Debounce rules:**
- Background changes (reconciliation, activity polling, hook events): 150ms buffer, batch into single event
- User-initiated changes (REST response triggers): flush immediately
- Why 150ms: cascading dispatches produce 5-10 updates in <500ms (verified: EffectHandler dispatches follow-up Actions)

### 3.3 REST API (31 Endpoints)

Every user-initiated Action maps to a specific endpoint. No generic dispatch.

**Card CRUD:**

| Method | Endpoint | Action | Notes |
|--------|----------|--------|-------|
| `POST` | `/api/cards` | `createManualTask` | Create card with name, promptBody, projectPath, assistant |
| `PATCH` | `/api/cards/:id` | `renameCard`, `moveCard`, `updatePrompt` | Field-specific update via body |
| `DELETE` | `/api/cards/:id` | `deleteCard` | Kills tmux, deletes session file, removes images |
| `POST` | `/api/cards/:id/archive` | `archiveCard` | Sets manuallyArchived, kills tmux |
| `POST` | `/api/cards/:id/reorder` | `reorderCard` | `{targetCardId, above}` |
| `POST` | `/api/cards/:srcId/merge-into/:tgtId` | `mergeCards` | Transfer links, delete source |

**Session Operations:**

| Method | Endpoint | Action | Notes |
|--------|----------|--------|-------|
| `POST` | `/api/cards/:id/launch` | `launchCard` | `{prompt, projectPath, worktreeName?, runRemotely, commandOverride?, skipPermissions}` |
| `POST` | `/api/cards/:id/resume` | `resumeCard` | Creates tmux + `claude --resume` |
| `POST` | `/api/cards/:id/cancel-launch` | `cancelLaunch` | Clears isLaunching, kills tmux |
| `POST` | `/api/cards/:id/fork` | fork via SessionStore | Copy .jsonl with new UUID |
| `POST` | `/api/cards/:id/checkpoint` | truncate via SessionStore | `{turnIndex}` |
| `GET` | `/api/sessions/:id/history` | — | Paginated turns `{offset, limit}`, ETag cached |
| `GET` | `/api/sessions/:id/history/search` | — | Search within transcript `{q}` |
| `POST` | `/api/cards/:id/migrate/begin` | `beginMigration` | Sets isLaunching |
| `POST` | `/api/cards/:id/migrate/confirm` | `migrateSession` | `{newAssistant, newSessionId, newSessionPath}` |

**Terminal Management:**

| Method | Endpoint | Action | Notes |
|--------|----------|--------|-------|
| `POST` | `/api/cards/:id/terminals` | `createTerminal` | Shell-only terminal |
| `POST` | `/api/cards/:id/terminals/extra` | `addExtraTerminal` | Extra shell tab |
| `DELETE` | `/api/cards/:id/terminals/:name` | `killTerminal` | Independent kill |
| `PATCH` | `/api/cards/:id/terminals/:name/label` | `renameTerminalTab` | `{label}` |
| `POST` | `/api/cards/:id/terminals/:name/reorder` | `reorderTerminalTab` | `{beforeSession?}` |

**Link Management:**

| Method | Endpoint | Action | Notes |
|--------|----------|--------|-------|
| `POST` | `/api/cards/:id/branches` | `addBranchToCard` | `{branch}` |
| `POST` | `/api/cards/:id/issues` | `addIssueLinkToCard` | `{issueNumber}` |
| `POST` | `/api/cards/:id/prs` | `addPRToCard` | `{prNumber}` |
| `DELETE` | `/api/cards/:id/pr/:num` | `unlinkFromCard(.pr)` | Dismiss PR |
| `DELETE` | `/api/cards/:id/issue` | `unlinkFromCard(.issue)` | Remove issue |
| `DELETE` | `/api/cards/:id/worktree` | `unlinkFromCard(.worktree)` | Remove branch |
| `DELETE` | `/api/cards/:id/tmux` | `unlinkFromCard(.tmux)` | Remove tmux |
| `PATCH` | `/api/cards/:id/prs/:num/merged` | `markPRMerged` | Manual merge mark |

**Queued Prompts:**

| Method | Endpoint | Action |
|--------|----------|--------|
| `POST` | `/api/cards/:id/queued-prompts` | `addQueuedPrompt` |
| `PATCH` | `/api/cards/:id/queued-prompts/:pid` | `updateQueuedPrompt` |
| `DELETE` | `/api/cards/:id/queued-prompts/:pid` | `removeQueuedPrompt` |
| `POST` | `/api/cards/:id/queued-prompts/:pid/send` | `sendQueuedPrompt` |

**Project & Settings:**

| Method | Endpoint | Action |
|--------|----------|--------|
| `POST` | `/api/cards/:id/move-project` | `moveCardToProject` |
| `POST` | `/api/cards/:id/move-folder` | `moveCardToFolder` |
| `GET` | `/api/projects` | List configured projects |
| `POST` | `/api/projects` | Add project |
| `PATCH` | `/api/projects/:path` | Update project |
| `DELETE` | `/api/projects/:path` | Remove project |
| `GET` | `/api/settings` | Get settings |
| `PATCH` | `/api/settings` | Update settings |
| `POST` | `/api/hooks/install` | Install Claude/Gemini hooks |
| `GET` | `/api/health` | Dependency check |
| `GET` | `/api/cards?column=all_sessions&offset=0&limit=50` | Paginated archived cards |

**Process Manager & System:**

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/tmux-sessions` | List all tmux sessions (name, path, attached) |
| `DELETE` | `/api/tmux-sessions/:name` | Kill a standalone tmux session |
| `GET` | `/api/worktrees/:repoRoot` | List worktrees for a repo |
| `DELETE` | `/api/worktrees` | Remove a worktree `{path, force?}` |
| `POST` | `/api/backlog/refresh` | Trigger GitHub issue refresh immediately |

**Search:**

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/search?q=...` | NDJSON stream (`Accept: application/x-ndjson`) |

### 3.4 NDJSON Streaming Search

```
GET /api/search?q=database+migration
Accept: application/x-ndjson

← 200 OK (Transfer-Encoding: chunked)
← {"sessionPath":"...","score":0.89,"snippet":"...","card":{...}}
← {"sessionPath":"...","score":0.72,"snippet":"...","card":{...}}
← (connection closes when done)
```

Improvement over native: scores each document once and emits. Native `searchSessionsStreaming` rescores ALL previous docs on every new match (O(n²)).

BM25 parameters: k1=1.2, b=0.4, recency boost 3x→1x over 30 days. Prefix matching for terms ≥3 chars.

---

## 4. Terminal Protocol

### 4.1 tmux Commands (All 24, Code-Verified)

| Command | Arguments | Purpose | Source |
|---------|-----------|---------|--------|
| `has-session` | `-t NAME` | Check session exists | TmuxAdapter:36 |
| `new-session` | `-d -s NAME -c PATH` | Create detached session | TmuxAdapter:44 |
| `send-keys` | `-t NAME CMD Enter` | Send command + submit | TmuxAdapter:65 |
| `send-keys` | `-t NAME -l TEXT` | Send literal text | TmuxAdapter:98 |
| `send-keys` | `-t NAME "\x0a"` | Send newline (Shift+Enter) | TerminalRepresentable:288 |
| `send-keys` | `-t NAME -X CMD` | Copy-mode command | TerminalRepresentable:355 |
| `send-keys` | `-t NAME -X -N N CMD` | Repeat copy-mode cmd | TerminalRepresentable:356 |
| `send-keys` | `-t NAME ESC[200~ESC[201~` | Empty bracketed paste | TmuxAdapter:133 |
| `kill-session` | `-t NAME` | Destroy session | TmuxAdapter:85 |
| `list-sessions` | `-F "#{name}\t#{path}\t#{attached}"` | List all sessions | TmuxAdapter:13 |
| `capture-pane` | `-p -t NAME` | Get visible pane text | TmuxAdapter:122 |
| `copy-mode` | `-t NAME` | Enter scroll mode | TerminalRepresentable:354 |
| `display-message` | `-p -t NAME "#{scroll_position}"` | Get scroll position | TerminalRepresentable:372 |
| `attach-session` | `-t NAME` | Attach PTY (blocking) | TerminalRepresentable:479 |
| `load-buffer` | `FILE` | Load clipboard from file | TmuxAdapter:128 |
| `paste-buffer` | `-p -t NAME` | Paste clipboard (bracketed) | TmuxAdapter:131 |

### 4.2 Session Launch Flow

```
1. tmux has-session -t NAME → if exists, reuse
2. tmux new-session -d -s NAME -c PATH
3. If multi-line command: write to /tmp/kanban-code-launch-NAME.sh
   tmux send-keys -t NAME ". '/tmp/...sh' ; rm -f '/tmp/...sh'" Enter
4. If single-line: tmux send-keys -t NAME "cd PATH && CMD" Enter
5. Attach: userShell -l -c "poll has-session 50x; exec tmux attach-session -t NAME"
```

### 4.3 Image Send Flow

```
1. waitForReady: poll capture-pane for prompt character (❯ for Claude, "Type your message" for Gemini)
   - Timeout: 30s Claude, 60s Gemini. Poll interval: 500ms.
2. For each image:
   a. Write image to temp file
   b. tmux load-buffer TEMP_FILE
   c. tmux paste-buffer -p -t NAME (bracketed paste)
   d. Poll capture-pane until [Image #N] count increases
   e. Timeout: 30s per image. Poll interval: 500ms.
```

### 4.4 Copy-Mode Scroll

```
1. Wheel event (deltaY > 0, scroll up):
   - If not in copy-mode: tmux copy-mode -t NAME
   - tmux send-keys -t NAME -X -N LINES cursor-up
2. Wheel event (deltaY < 0, scroll down, in copy-mode):
   - tmux send-keys -t NAME -X -N LINES cursor-down
   - After 50ms: tmux display-message -p -t NAME "#{scroll_position}"
   - If position == 0: auto-exit via tmux send-keys -t NAME -X cancel
3. Any key press in copy-mode (except Cmd/Opt/Ctrl):
   - tmux send-keys -t NAME -X cancel
   - Re-send the key: tmux send-keys -t NAME CHARS
4. 500ms cooldown after exit (prevent trackpad momentum re-entry)
```

### 4.5 Multi-Tab Terminals

- Primary session: `projectName-cardIdPrefix` (Claude or shell)
- Extra sessions: `projectName-cardIdPrefix-sh1`, `-sh2`, etc.
- Tab labels: "Claude" (brain icon) if `isShellOnly=false`, "Shell"/"sh1" (terminal icon) if `isShellOnly=true`
- Kill independence: killing primary preserves extras (`isPrimaryDead=true`), killing extra preserves primary
- Killing last extra while primary dead → clear `tmuxLink` entirely
- Keep xterm.js instances alive across tab switches (equivalent to native TerminalCache)

### 4.6 Shift+Enter Handling

xterm.js `attachCustomKeyEventHandler`: intercept Enter with Shift → send `\x0a` instead of `\x0d`.

### 4.7 Terminal Rendering

- xterm.js batches internally (equivalent to native BatchedTerminalView's 8ms/32KB batching)
- Use `@xterm/addon-canvas` for GPU rendering (equivalent to native Metal)
- Use `@xterm/addon-web-links` for URL detection (equivalent to native Cmd+click with NSBezierPath underline)
- Use `@xterm/addon-fit` + ResizeObserver for sizing (equivalent to native layout() with 1px delta guard)
- ANSI color palette matching native: dark background (#121212), light foreground (#EBEBEB), green cursor

---

## 5. State Management

### 5.1 Server-Side Reducer

Direct TypeScript port of `BoardStore.swift` Reducer. Same pure function signature:

```typescript
function reduce(state: AppState, action: Action): { state: AppState; effects: Effect[] }
```

51 Action types (verified: BoardStore.swift lines 150-210). Grouped:
- 27 UI actions (createManualTask, launchCard, moveCard, renameCard, etc.)
- 4 queued prompt actions
- 10 async completions (launchCompleted, terminalCreated, etc.)
- 3 background reconciliation (reconciled, gitHubIssuesUpdated, activityChanged)
- 7 transient/settings (setBusy, setError, settingsLoaded, etc.)

### 5.2 Client-Side Store (Zustand)

```typescript
interface ClientState {
  // Mirrors server AppState (received via SSE)
  links: Record<string, Link>;
  sessions: Record<string, Session>;
  activityMap: Record<string, ActivityState>;
  tmuxSessions: string[];
  selectedCardId: string | null;
  selectedProjectPath: string | null;
  configuredProjects: Project[];
  excludedPaths: string[];
  discoveredProjectPaths: string[];
  error: string | null;
  isLoading: boolean;
  isRefreshingBacklog: boolean;
  rateLimitedRepos: string[];
  busyCards: string[];
  lastRefresh: string | null;         // ISO8601 — last reconciliation time (for UI display)
  lastGitHubRefresh: string | null;   // ISO8601 — last backlog refresh (for refresh button state)
  globalRemoteSettings: RemoteSettings | null; // Needed for UI toggles (run remotely checkbox)

  // Client-only state (not synced to server)
  paletteOpen: boolean;
  detailExpanded: boolean;
  boardViewMode: 'kanban' | 'list';   // Persisted in localStorage
  archivedCards: Link[];              // Lazy-loaded via paginated REST
  archivedCardsTotal: number;
  uiScale: number;                    // 0.85-1.5x (CSS transform: scale), persisted in localStorage
  terminalFontSize: number;           // Separate from UI scale, persisted in localStorage
}
```

**Event application**: Each SSE event type has a handler that updates the corresponding zustand fields. No reconciliation logic — pure assignment.

### 5.3 Archived Cards

- Server holds ALL cards in AppState (required for reconciler)
- SSE `state:snapshot` on connect includes active cards only (backlog, in_progress, waiting, in_review, done)
- Archived cards loaded on-demand: `GET /api/cards?column=all_sessions&offset=0&limit=50`
- When reconciler promotes archived → active, SSE `card:updated` includes full card data (client adds it)

---

## 6. Adapters (TypeScript Ports)

### 6.1 Claude Code Adapters

| Adapter | Swift File | TypeScript Equivalent | Key Operations |
|---------|-----------|----------------------|----------------|
| `ClaudeCodeSessionDiscovery` | ClaudeCodeSessionDiscovery.swift | `claude/session-discovery.ts` | Scan `~/.claude/projects/`, mtime caching, merge with sessions-index.json |
| `ClaudeCodeSessionStore` | ClaudeCodeSessionStore.swift | `claude/session-store.ts` | readTranscript, fork (.jsonl copy with UUID replace), truncate, BM25 search streaming |
| `ClaudeCodeActivityDetector` | ClaudeCodeActivityDetector.swift | `claude/activity-detector.ts` | Hook-based (UserPromptSubmit→active, Stop→needs_attention), polling fallback (never returns activelyWorking), Ctrl+C detection (last 4KB), 5-min timeout |
| `JsonlParser` | JsonlParser.swift | `claude/jsonl-parser.ts` | Stream metadata extraction, branch discovery regex (git push/checkout/switch/worktree add), path decoding |
| `TranscriptReader` | TranscriptReader.swift | `claude/transcript-reader.ts` | Two-pass readTail (count turns, parse last N), readRange pagination, content block parsing |
| `HookManager` | HookManager.swift | `claude/hook-manager.ts` | Deploy hook.sh, read/write ~/.claude/settings.json, idempotent hook installation |
| `HookEventStore` | HookEventStore.swift | `claude/hook-event-store.ts` | Incremental JSONL reader (file offset tracking) |
| `SessionIndexReader` | SessionIndexReader.swift | `claude/session-index-reader.ts` | Read/update sessions-index.json (two formats) |

### 6.2 Gemini Adapters

| Adapter | Key Differences from Claude |
|---------|---------------------------|
| `GeminiSessionDiscovery` | Reads `~/.gemini/projects.json` for slug→path. Scans `~/.gemini/tmp/<slug>/chats/session-*.json` |
| `GeminiSessionParser` | Full JSON parse (not JSONL streaming). Messages have `type: user|gemini|info|error`, content can be string or `{textValue}`, tool calls in `toolCalls` array |
| `GeminiSessionStore` | Fork: UUID replace + `session-forked-*.json`. Write: `session-migrated-*.json`. Search: BM25 on JSON content |
| `GeminiActivityDetector` | Polling CAN return activelyWorking (file mtime <2min). Hook normalization: AfterAgent→Stop, BeforeAgent→UserPromptSubmit |

### 6.3 System Adapters

| Adapter | Key Operations |
|---------|----------------|
| `TmuxAdapter` | 24 commands (see Section 4.1). Multi-line via temp file sourcing. Session reuse via has-session check. |
| `GitWorktreeAdapter` | `git worktree list --porcelain` parsing. Create at `<repo>/.worktrees/<name>`. Remove with force option. |
| `GitRemoteResolver` | `git remote get-url origin` with caching. Parse SSH + HTTPS formats to GitHub base URL. |
| `GhCliAdapter` | Batch `gh pr list`. GraphQL enrichment with field aliases (pr0, pr1...). `gh search issues`. Rate limit detection. |
| `MutagenAdapter` | `mutagen sync create/list/flush/pause/resume/terminate`. Label-based session management. Status parsing. |

### 6.4 Notification Adapters

| Adapter | Web Equivalent |
|---------|---------------|
| `PushoverClient` | Direct port — HTTP POST to `api.pushover.net`. Multipart form-data with optional PNG attachment. `kanbancode://card/{id}` → `http://host:port/card/{id}` URL. |
| `MacOSNotificationClient` | Replace with Browser Notification API. Server sends notification intent via SSE `notification:fired`. Client shows `new Notification(title, {body, icon})`. |
| `CompositeNotifier` | Same strategy pattern: try Pushover (server-side), fallback to browser notification (client-side via SSE). |
| `NotificationDeduplicator` | Direct port — in-memory Maps. 62s dedup window. 1s stop debounce. Uses event timestamps (not wall clock). |
| `MarkdownImageRenderer` | Move to browser-side: `marked` (GFM→HTML) + `DOMPurify` (sanitize) + `html2canvas` (HTML→PNG). No pandoc/wkhtmltoimage server dependency. |
| `TranscriptNotificationReader` | Direct port — read last assistant turn, extract text preview (first line ≥42 chars or accumulate sentences to 140 chars). |

### 6.5 Remote Execution

| Component | Web Approach |
|-----------|-------------|
| `RemoteShellManager` | Deploy same `remote-shell.sh` (293-line bash script). Manage symlinks at `~/.kanban-code/remote/`. Replace `osascript` notifications with SSE events to client. |
| `RemoteStatusWatcher` | Poll `~/.kanban-code/remote/status-*.json`. Detect online/offline transitions. Send status via SSE. |
| Sleep prevention | Replace `KanbanCodeActiveSession` helper .app with `caffeinate -d -i -s` (direct process, simpler than helper bundle). |

---

## 7. Infrastructure

| Component | Implementation |
|-----------|---------------|
| `CoordinationStore` | Read/write `~/.kanban-code/links.json`. Atomic writes (.tmp → rename). Corruption recovery (.bkp backup). Same JSON encoder (pretty-printed, sorted keys, ISO8601 dates). |
| `SettingsStore` | Read/write `~/.kanban-code/settings.json`. Mtime-based caching. Hot-reload via `fs.watch`. |
| `HookEventStore` | Incremental JSONL reader with file offset. `fs.read` with seek. |
| `ShellCommand` | `child_process.execFile` with user environment injection. Search paths: `~/.claude/local`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, user PATH. Pipe stdout/stderr before waitpid (prevent deadlock). |
| `KSUID` | 4-byte timestamp (epoch 2014-05-13) + 16-byte random → 27-char base62. `card_` prefix for cards, `prompt_` for queued prompts. |
| `SessionFileMover` | Move `.jsonl` between project directories. Encode target path (replace `/` with `-`). Update `cwd` field in every JSON line. Remove from source `sessions-index.json`. |
| `ProjectDiscovery` | Detect unconfigured project paths from session history. Filter subdirectories of configured projects. Limit to 8 suggestions. |
| `Logger` | Write to `~/.kanban-code/logs/kanban-code.log`. Format: `[ISO8601] [LEVEL] [subsystem] message`. |

---

## 7.4 Card Detail Side Panel

The card detail panel opens as a right-side drawer when a card is selected. It contains a header with property rows, a tab bar, and tab content.

### Tab System

**Tabs available (conditional, based on which links exist):**

| Tab | Shown When | Content |
|-----|-----------|---------|
| **Terminal** | `tmuxLink` exists | Live xterm.js terminal connected to tmux session |
| **History** | `sessionLink` exists | Conversation transcript (paginated turns) |
| **Issue** | `issueLink` exists | GitHub issue body rendered as markdown |
| **Pull Request** | `prLinks` non-empty | PR status, CI checks, reviews, lazy-loaded body |
| **Prompt** | `promptBody` exists (no issueLink) | Prompt text with copy/edit buttons + image attachments |

**Default tab selection priority:** Terminal > History > Issue > PR > Prompt

When the selected card changes, the tab resets to the default for the new card.

### Header — Property Rows

The header shows card metadata as rows (icon + label + value + action buttons). Only rows with data are shown:

| Row | Icon | Value | Actions |
|-----|------|-------|---------|
| **Branch** | `arrow.triangle.branch` | Branch name (from worktreeLink or discoveredBranches) | × unlink |
| **Worktree** | `folder` | Worktree path (if on disk) | — |
| **PR** | `arrow.triangle.pull` | `#N · Status` (per PR in prLinks) | Open in browser, × unlink |
| **Issue** | `circle.circle` | `#N` | Open in browser, × unlink |
| **Project** | `folder` | Project path | Copy |
| **Session** | `number` | Session UUID | Copy |

**"+ Add link" button** at the bottom opens the AddLinkPopover (Branch / Issue picker).

### Terminal Tab

When tmux session exists:
- **Tab bar:** Claude tab (brain icon) + extra shell tabs (terminal icon, "sh1", "sh2"...)
- **Content:** Full xterm.js terminal connected via WebSocket
- **Below terminal:** "Copy tmux attach" button + "+ Queue Prompt" button
- **Queued prompts bar** shown above terminal if prompts exist (horizontal strip with send/edit/remove per prompt)

When tmux session does NOT exist:
- Two buttons centered: **Resume Claude** (play icon, prominent) + **New Terminal** (terminal icon, bordered)

When `isLaunching = true`:
- "Starting session..." spinner + **Stop** button to cancel

When primary session is dead but extras exist:
- Claude tab shows "Session ended" + **Resume** button
- Extra shell tabs continue to function independently

### History Tab

Renders conversation transcript from `.jsonl` / `.json` session file.

**Turn rendering:**
- **User turns:** "You" label with `❯` (Claude) or `✦` (Gemini) icon, message text rendered as markdown
- **Assistant turns:** "Claude"/"Gemini" label, message text rendered as markdown
- **Tool use messages:** Collapsed display: `[tool: Read, Edit, Bash]` with tool name + abbreviated path (last 3 components)
- **Tool result messages:** `[tool result ×3]`
- **Thinking blocks:** Collapsible "Thinking" section

**Features:**
- **Lazy loading:** Last 80 turns loaded initially (`GET /api/sessions/:id/history?limit=80`). "Load 80 earlier" button at top → `GET /api/sessions/:id/history?offset=N&limit=80`
- **Search within history:** Cmd+F opens search bar, debounced input, match navigation (prev/next), highlighting
- **Checkpoint mode:** Activated from actions menu. Turns become selectable. Hovering a turn dims later turns. Clicking opens checkpoint confirmation dialog.
- **Live updates:** When History tab is active, poll for new turns (or watch via file watcher on server, push via SSE)
- **Scroll to bottom:** Default scroll position is the most recent message
- **ETag caching:** `GET /api/sessions/:id/history` includes `ETag` based on file mtime. 304 Not Modified for unchanged files.

### Issue Tab

Shown for cards with `issueLink`:

- **Header:** Issue title + `#N` number + "Open in Browser" button
- **Body:** GitHub-flavored markdown rendered via `react-markdown` + `remark-gfm`
  - Headers, code blocks (syntax highlighted), tables, links (clickable), task lists (checkboxes)
- **Empty state:** "No description provided." (italic, tertiary)
- **Start button:** In the card header (not inside the tab) for backlog issue cards

### Pull Request Tab

Shown for cards with `prLinks`:

- **Per PR (multiple PRs shown in sequence with dividers):**
  - **Header:** PR title + `PRBadge` (status, number, color) + "Open in Browser" button
  - **CI Checks section:** Each check run with icon:
    - `checkmark.circle` (green) = success
    - `xmark.circle` (red) = failure
    - `clock` (yellow) = in_progress/pending
    - `minus.circle` (gray) = skipped/neutral
  - **Reviews section:** "N approvals" (green checkmark) + "N unresolved" (orange bubble)
- **PR Body:** Lazy-loaded on tab open (`GET /api/sessions/:id/pr-body?prNumber=N`). Shows spinner while loading. Rendered as markdown. Cached per card selection (reset when switching cards).
- **Empty body:** "No description provided." (italic, tertiary)

### Prompt Tab

Shown for manual tasks (have `promptBody` but no `issueLink`):

- **Header:** "Prompt" label + copy button + edit button
- **Body:** `promptBody` text displayed as monospaced text (selectable)
- **Edit:** Opens edit sheet → `PATCH /api/cards/:id {promptBody, promptImagePaths}`
- **Attached images:** Shown below text as thumbnails (expandable on click)

---

## 7.5 Card Operations & UI Flows

### Card Context Menu (right-click on any card)

Items shown conditionally based on card state:

| Item | Condition | Action |
|------|-----------|--------|
| **Start** | Backlog cards only | Opens launch confirmation dialog → `POST /api/cards/:id/launch` |
| **Resume Session** | Non-backlog cards with sessionLink | `POST /api/cards/:id/resume` |
| **Fork Session** | Cards with sessionLink.sessionPath | Shows fork confirmation dialog (see below) |
| **Rename** | Always | Shows inline rename input or modal → `PATCH /api/cards/:id {name}` |
| **Copy Resume Command** | Cards with sessionLink | Client-side: copy `cd <projectPath> && claude --resume <sessionId>` to clipboard |
| **Copy Card ID** | Always | Client-side: copy `card.id` to clipboard |
| --- | Divider | --- |
| **Open PR #N** | Per PR in prLinks | Client-side: `window.open(pr.url)` |
| **Open Issue #N** | If issueLink exists | Client-side: `window.open(issue.url)` |
| --- | Divider | --- |
| **Cleanup Worktree** | If worktreeLink exists and worktree on disk | Confirmation → `DELETE /api/worktrees {path}`, then clear worktreeLink |
| **Move to Project →** | If sessionLink exists | Submenu of configured projects → `POST /api/cards/:id/move-project` |
| **Select Folder...** | If sessionLink exists | File picker (or text input) → `POST /api/cards/:id/move-folder` |
| --- | Divider | --- |
| **Migrate to Assistant →** | If sessionLink + other assistants installed | Submenu → `POST /api/cards/:id/migrate/begin` + confirm dialog |
| --- | Divider | --- |
| **Archive** | Not already archived | `POST /api/cards/:id/archive` |
| **Delete Card** | Already archived (not github_issue source) | Confirmation → `DELETE /api/cards/:id` |

### Card Detail Actions Menu (toolbar button in detail panel)

Same items as context menu, plus:

| Item | Action |
|------|--------|
| **Checkpoint / Restore** | Switches History tab to checkpoint mode (see below) |
| **Copy Tmux Command** | Client-side: copy `tmux attach-session -t <sessionName>` to clipboard |
| **Queue Prompt** | Opens queued prompt dialog |

### Fork Session Dialog

**Trigger:** Context menu → "Fork Session" or Actions menu → "Fork Session"

```
┌─────────────────────────────────────┐
│  Fork Session?                      │
│                                     │
│  A copy of the conversation will    │
│  be created with a new session ID.  │
│                                     │
│  [Cancel]                           │
│  [Fork (same worktree)]  ← only if worktreeLink exists
│  [Fork (project root)]             │
└─────────────────────────────────────┘
```

- **Fork (same worktree):** `POST /api/cards/:id/fork` — new card gets same worktreeLink
- **Fork (project root):** `POST /api/cards/:id/fork` — new card gets no worktreeLink, session in project root
- Result: new card appears on board, toast: "Forked! New session: {shortId}..."

### Checkpoint / Restore Flow

**Trigger:** Actions menu → "Checkpoint / Restore" (switches History tab to checkpoint mode)

1. **History tab enters checkpoint mode:** turns become selectable, later turns dimmed on hover
2. **User clicks a turn:** confirmation dialog appears:
   ```
   ┌─────────────────────────────────────────┐
   │  Restore to Turn N?                     │
   │                                         │
   │  Everything after this point will be    │
   │  removed. A .bkp backup will be saved.  │
   │                                         │
   │  [Cancel]  [Restore]                    │
   └─────────────────────────────────────────┘
   ```
3. **On confirm:** `POST /api/cards/:id/checkpoint {turnIndex: N}`
4. **Result:** session truncated, card refreshes with updated message count, checkpoint mode exits

### Launch Confirmation Dialog

**Trigger:** "Start" on backlog card, or "Start immediately" on new task

| Field | Type | Editable | Notes |
|-------|------|----------|-------|
| Project path | Text | No | Read-only display |
| Prompt | TextEditor | Yes | Pre-filled from templates, user can edit |
| Image attachments | Chips | Yes | Paste images (Cmd+V), remove with X |
| Create worktree | Checkbox | Yes | Hidden if card has worktreeLink; disabled if not git repo |
| Run remotely | Checkbox | Yes | Disabled if no remote config or project not under localPath |
| Skip permissions | Checkbox | Yes | Default checked. Label adapts: "--dangerously-skip-permissions" (Claude) or "--yolo" (Gemini) |
| Command preview | Monospace | No | Updates live as toggles change |

Buttons: **[Cancel]** **[Launch]**

### New Task Dialog

**Trigger:** Cmd+N, "+" button, or double-click empty column background (except All Sessions)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Prompt | Multiline text editor | Yes | Placeholder: "Describe what you want Claude to do..." |
| Title | Text field | No | Empty = first line of prompt used as card name |
| Project | Dropdown picker | Yes | Defaults to current project selection |
| Assistant | Picker | Yes | Lists installed assistants; defaults from settings |
| Start immediately | Checkbox | No | Remembers last setting (localStorage) |

When "Start immediately" is checked, additional inline launch options appear (worktree, remote, skip permissions, command preview). **[Create]** or **[Create & Start]**.

### Rename Dialog

**Trigger:** Context menu → "Rename"

Simple text input pre-filled with current name. Enter saves, Escape cancels. → `PATCH /api/cards/:id {name}`

### Session Migration Dialog

**Trigger:** Context menu → "Migrate to [Assistant]"

```
┌──────────────────────────────────────────────┐
│  Migrate to Gemini CLI?                      │
│                                              │
│  ⚠ Tool calls will be converted to text      │
│  ⚠ Images will not be transferred            │
│  ⚠ This cannot be undone                     │
│                                              │
│  [Cancel]  [Migrate]                         │
└──────────────────────────────────────────────┘
```

On confirm: `POST /api/cards/:id/migrate/begin` → server exports → imports → `POST /api/cards/:id/migrate/confirm`

---

## 7.6 Timing Constants Reference

Every hardcoded timing value in the codebase. The web port must use identical values.

| Constant | Value | Source | Purpose |
|----------|-------|--------|---------|
| `stopDelay` | 1.0s | ClaudeCodeActivityDetector:16 | Delay before resolving pending Stop events |
| `activeTimeout` | 300s (5 min) | ClaudeCodeActivityDetector:18 | File stale timeout → downgrade activelyWorking to needsAttention |
| `dedupWindow` | 62s | NotificationDeduplicator:20 | Suppress duplicate notifications within this window |
| `stopDebounceWindow` | 1.0s | NotificationDeduplicator:32 | If user prompts within 1s after Stop, suppress notification |
| **Polling stale tiers** | | ClaudeCodeActivityDetector:64-71 | Three-tier activity state from file age |
| — idleWaiting | < 300s (5 min) | | File modified recently but no hook |
| — needsAttention | 300s – 3600s (5 min – 1 hr) | | File becoming stale |
| — ended | 3600s – 86400s (1 hr – 24 hr) | | Session likely finished |
| — stale | ≥ 86400s (24 hr) | | Old session, auto-archive candidate |
| `ctrlCGracePeriod` | 3s | ClaudeCodeActivityDetector:118 | File age threshold before checking for interrupt marker |
| `launchStaleTimeout` | 30s | CardReconciler/Reducer | If isLaunching persists >30s, clear it (crash recovery) |
| `backgroundTickInterval` | 5s | BackgroundOrchestrator:62 | Background reconciliation/activity poll cycle |
| `hookProcessingDelay` | 500ms | BackgroundOrchestrator:216 | Wait after Stop before checking if user prompted |
| `autoSendDelay` | 500ms | BackgroundOrchestrator (after hook delay) | Additional wait before auto-sending queued prompt |
| `sessionTimeout` | 1440 min (24 hr) | Settings.sessionTimeout.activeThresholdMinutes | Auto-archive idle sessions without worktree/tmux |
| `githubPollInterval` | 60s | Settings.github.pollIntervalSeconds | GitHub issue backlog refresh interval |
| `ghPRListLimit` | 50 | GhCliAdapter:16 | `gh pr list --limit 50` per repo |
| `ghIssueSearchLimit` | 25 | GhCliAdapter:415 | `gh search issues --limit 25` |
| `imageReadyTimeout` | 30s (Claude), 60s (Gemini) | ImageSender:38-39 | Wait for assistant prompt character |
| `imageUploadTimeout` | 30s per image | ImageSender:63 | Wait for `[Image #N]` confirmation |
| `imagePollInterval` | 500ms | ImageSender:36 | Poll capture-pane for ready/image |
| `tmuxAttachPollMax` | 50 attempts × 100ms = 5s | TerminalRepresentable:479 | Polling loop for tmux has-session before attach |
| `copyModeCooldown` | 500ms | TerminalRepresentable:343 | Prevent trackpad momentum re-entering copy-mode |
| `scrollPositionCheckDelay` | 50ms | TerminalRepresentable:371 | Wait after cursor-down before checking scroll position |
| `sseDebounceWindow` | 150ms | Transport design | Batch background SSE events |
| `historyReloadDebounce` | 500ms | CardDetailView:293 | Debounce history tab refresh on file change |
| `focusRetryDelay` | 500ms | TerminalCache:507 | Retry terminal focus after SwiftUI re-renders steal it |
| `BM25RecencyBoostMax` | 3.0x (today) → 1.0x (30 days) | BM25Scorer:71-77 | Linear decay over 30 days |

---

## 7.7 Settings Schema & Defaults

Complete `~/.kanban-code/settings.json` structure with all fields and defaults.

```typescript
interface Settings {
  projects: Project[];                          // Default: []
  globalView: {
    excludedPaths: string[];                    // Default: []
  };
  github: {
    defaultFilter: string;                      // Default: "assignee:@me is:open"
    pollIntervalSeconds: number;                // Default: 60
    mergeCommand: string;                       // Default: "" (uses gh pr merge)
  };
  notifications: {
    pushoverEnabled: boolean;                   // Default: false
    pushoverToken: string;                      // Default: ""
    pushoverUserKey: string;                    // Default: ""
    renderMarkdownImage: boolean;               // Default: true
  };
  remote: {                                     // Default: {} (unconfigured)
    host: string;                               // SSH host (e.g., "ubuntu@server.com")
    remotePath: string;                         // Remote base directory
    localPath: string;                          // Local base directory
    syncIgnores: string[];                      // Additional Mutagen ignore patterns
  } | null;
  sessionTimeout: {
    activeThresholdMinutes: number;             // Default: 1440 (24 hours)
  };
  promptTemplate: string;                       // Default: "${prompt}" (also reads legacy "skill" key)
  githubIssuePromptTemplate: string;            // Default: "#${number}: ${title}\n\n${body}"
  columnOrder: KanbanCodeColumn[];              // Default: ["backlog","in_progress","requires_attention","in_review","done","all_sessions"]
  hasCompletedOnboarding: boolean;              // Default: false
  defaultAssistant: CodingAssistant | null;     // Default: null (→ claude)
  enabledAssistants: CodingAssistant[];         // Default: [] (auto-detected from installed CLIs)
}
```

**Template interpolation rules** (`PromptBuilder`):
1. If card has `issueLink`: apply `githubIssuePromptTemplate` first (interpolate `${number}`, `${title}`, `${body}`, `${url}`)
2. Result (or `promptBody` if no issue) becomes `${prompt}`
3. Apply `promptTemplate`: if template contains `${prompt}`, substitute; **else prepend template + newline** (fallback behavior)
4. Trim whitespace

---

## 7.8 Behavioral Invariants & Edge Cases

Critical correctness behaviors verified by tests. The web port MUST replicate these exactly.

### Reconciliation Invariants

| Invariant | Source | Rule |
|-----------|--------|------|
| Launch state preserved | ReducerTests | `.reconciled` action must NOT reset cards where `isLaunching=true`; uses `updatedAt` timestamps to preserve in-memory changes |
| No unnecessary updatedAt | CardLifecycleTests | Column transitions with same target must NOT update `updatedAt` (prevents reconciliation flicker) |
| Stale launch cleanup | CardReconciler | If `isLaunching` persists >30s without activity confirmation, force-clear it (crash recovery) |
| Orphan dedup is dual | CardReconciler + Reducer | Orphan absorption runs in BOTH CardReconciler output AND the Reducer's `.reconciled` handler (last line of defense) |
| Session match priority | CardReconciler:428 | Match by: exact sessionId → git branch (same project) → projectPath + tmux presence |
| Worktree branch resolution | CardReconciler | Use git worktree snapshot branch name (authoritative), fallback to directory name |
| Main/master filtered | CardReconciler | Never create worktree cards for main or master branches |

### Card Lifecycle Invariants

| Invariant | Source | Rule |
|-----------|--------|------|
| Only activelyWorking → inProgress | AssignColumnTests | ONLY `ActivityState.activelyWorking` moves cards to In Progress; recent activity, idle waiting, etc. are insufficient |
| Revived card → waiting | CardLifecycleTests | When archived card becomes active then work stops, card goes to **waiting** (not back to allSessions) |
| Unarchive on activity | UpdateCardColumn:27-29 | When `manuallyArchived=true` and new column would be `.inProgress`, clear `manuallyArchived` first |
| Rename doesn't change column | ReducerTests | `renameCard` must NOT trigger column reassignment or update `updatedAt` |
| launchFailed doesn't kill tmux | LaunchFlowIntegrationTests | `.launchFailed` clears `isLaunching` and sets error but does NOT kill the tmux session (cleanup is deferred) |
| Empty worktreeName → nil | LaunchFlowIntegrationTests | Empty string worktreeName treated as nil; falls back to cardId for tmux name |
| Resume tmux naming | LaunchFlowIntegrationTests | Resume uses `{assistant}-{sessionId.prefix(8)}` for tmux name (e.g., `claude-abcdef12`) |
| Delete kills tmux | ReducerTests | `deleteCard` emits `.killTmuxSessions` + `.deleteSessionFile` + `.deleteFiles` (images) |

### Notification Invariants

| Invariant | Source | Rule |
|-----------|--------|------|
| 62s dedup window | NotificationDedupTests | Uses **event timestamps** not wall clock (batch processing correctness) |
| 1s stop debounce | NotificationDedupTests | If UserPromptSubmit arrives within 1.0s AFTER Stop event, suppress notification |
| Batch processing safe | NotificationDedupTests | Multiple Stop/UserPromptSubmit events in burst are processed with correct timestamp ordering |

### Activity Detection Invariants

| Invariant | Source | Rule |
|-----------|--------|------|
| Polling never returns activelyWorking (Claude) | ActivityDetectorTests | `pollActivity()` returns idleWaiting/needsAttention/ended/stale — NEVER activelyWorking for Claude |
| Polling CAN return activelyWorking (Gemini) | GeminiActivityDetector | File mtime <2min → activelyWorking (Gemini has no hooks by default) |
| Ctrl+C detection | ActivityDetectorTests | `[Request interrupted by user]` in last 4KB, BUT only if file age >3s (grace period prevents false positives during normal writes) |
| 5-minute timeout | ActivityDetectorTests | activelyWorking → needsAttention after 5min file age (safety net matching Claude's tool timeout) |
| Stop is immediate | ActivityDetectorTests | Stop hook transitions to needsAttention immediately (no async pending queue) |

### Search Invariants

| Invariant | Source | Rule |
|-----------|--------|------|
| Multi-term AND semantics | BM25Tests | Queries score higher when ALL terms present; partial matches score lower |
| Sessions sorted newest-first | SessionDiscoveryTests | Discovery returns sessions sorted by file mtime, newest first |
| Zero-message sessions filtered | SessionDiscoveryTests | Sessions with zero user/assistant messages are excluded from results |
| Index merged with JSONL | SessionDiscoveryTests | Index file metadata (name, summary) takes precedence for display name; JSONL provides message counts |

### Hook Invariants

| Invariant | Source | Rule |
|-----------|--------|------|
| Idempotent install | HookManagerTests | Multiple installs must NOT create duplicate hook entries (dedup by command path containing `.kanban-code/hook.sh`) |
| Preserve existing hooks | HookManagerTests | Install appends to existing hook groups; never replaces them |
| Per-assistant event names | HookManagerTests | Claude: Stop, UserPromptSubmit; Gemini: AfterAgent→Stop, BeforeAgent→UserPromptSubmit (normalized) |

### Card Merge Invariants

| Invariant | Source | Rule |
|-----------|--------|------|
| mergeBlocked validation | Link.swift:247-264 | Cannot merge: same card, two cards with sessions, two with tmux, different issues, different worktrees |
| Card label priority | Link.swift:236-242 | SESSION > WORKTREE > ISSUE > PR > TASK (based on which links present) |
| worstPRStatus | Link.swift:210 | Across all prLinks, return the highest-urgency status (lowest priority number) |
| allPRsDone | Link.swift | True only when every PR in prLinks is merged or closed |

### UI State Invariants

| Invariant | Source | Rule |
|-----------|--------|------|
| List view shows empty columns | BoardViewModeTests | ALL columns visible in list view, even when empty (with collapse toggle) |
| Collapsed sections persist | BoardViewModeTests | Encoded as comma-separated column names in localStorage |
| Project filter includes worktrees | LaunchFlowIntegrationTests | Filtering by project path includes cards whose session path is under `<project>/.claude/worktrees/` |

---

## 7.9 Keyboard Shortcuts (Complete)

| Shortcut | Action | Context | Notes |
|----------|--------|---------|-------|
| `Cmd+K` | Open command palette | Anywhere | Primary palette shortcut |
| `Cmd+P` | Open command palette | Anywhere | Alternate (VS Code style) |
| `Cmd+Shift+P` | Open palette in command mode | Anywhere | Pre-fills ">" for command filtering |
| `Cmd+N` | New task dialog | Anywhere | Opens task creation form |
| `Cmd+,` | Open settings | Anywhere | Standard macOS convention |
| `Cmd+Enter` | Toggle detail expand | Detail panel open, palette closed | Expands/collapses side panel |
| `Cmd+Enter` | Deep search | Palette open | Triggers BM25 search on current query |
| `Cmd+T` | New terminal tab | Detail panel on terminal tab | Creates extra shell terminal |
| `Cmd+W` | Close terminal tab | Detail panel on terminal tab | Closes active terminal tab (NOT browser tab) |
| `Cmd+1` through `Cmd+9` | Switch to project N | Anywhere | Project index in configured list |
| `Cmd++` / `Cmd+=` | Zoom in (UI scale) | Anywhere | Increases `uiScale` |
| `Cmd+-` | Zoom out (UI scale) | Anywhere | Decreases `uiScale` |
| `Cmd+0` | Reset zoom | Anywhere | Resets to default font size |
| `Escape` | Close palette / deselect card | Palette open / card selected | Context-dependent dismiss |
| `Delete` / `Backspace` | Delete card | Card selected | With confirmation |
| `Up/Down Arrow` | Navigate items | Palette open | Move selection in palette |
| `Enter` | Select item / submit | Palette open / dialog open | Select highlighted item |

**Context awareness** (from `KeyboardShortcuts.swift`):

Shortcuts are conditionally active based on `AppShortcutContext`:
- `paletteOpen`: Cmd+Enter → deep search (not detail expand)
- `detailOpen && !paletteOpen`: Cmd+Enter → toggle detail expand
- `detailOnTerminalTab`: Cmd+T → new terminal, Cmd+W → close terminal tab
- Only non-modifier keys exit copy-mode (Cmd/Opt/Ctrl held → pass through to system)

**Web browser conflicts:**
- `Cmd+T` (new tab) — intercept via `e.preventDefault()` when terminal tab is focused
- `Cmd+W` (close tab) — intercept when terminal tab focused, otherwise let browser handle
- `Cmd+N` (new window) — intercept globally
- `Cmd+P` (print) — intercept globally (palette instead)

---

## 7.10 Command Palette Details

### Modes

| Mode | Trigger | Content |
|------|---------|---------|
| **Recent cards** | Open with empty query | Top 20 cards sorted by `lastOpenedAt` (fallback: `lastActivity` → `updatedAt`). Second-most-recent pre-selected (VS Code toggle pattern). |
| **Filtered cards** | Type any text | Live substring match on: title, project name/path, branch, session name. Multi-word: each term matched independently. Fuzzy initials: "kp" matches "Kanban Projects". |
| **Command mode** | Type ">" prefix | Shows available commands: Open Settings, Toggle View Mode, New Task, Toggle Expanded Mode, project switch commands. Filter by typing after ">". |
| **Deep search** | Press `Cmd+Enter` | BM25 full-text search through .jsonl/.json files. Results stream via NDJSON. Replaces filtered results. |

### UI Elements

- **Search input** at top, auto-focused on open
- **Deep search hint**: "⌘↩ deep search" shown when query is non-empty (not in command mode)
- **Result items**: card title, project badge, branch badge, relative time, status indicator
- **Highlighted terms**: query terms highlighted in results (merged overlapping ranges)
- **Keyboard navigation**: Up/Down arrows, Enter to select, Escape to close
- **Terminal focus**: after selecting a card with live terminal, detail panel opens and terminal receives keyboard focus

### Actions from Palette

| Action | Trigger | Behavior |
|--------|---------|----------|
| Select card | Click or Enter on card | Selects card on board, opens detail panel |
| Resume | Right-click → Resume | Creates tmux + resumes session |
| Fork | Right-click → Fork | Shows fork confirmation dialog |
| Checkpoint | Right-click → Checkpoint | Opens checkpoint mode in history tab |
| Open Settings | Select from ">" commands | Opens settings panel |
| Toggle View Mode | Select from ">" commands | Switches kanban ↔ list |
| Switch Project | Select from ">" commands | Filters board to selected project |

---

## 7.11 Gemini CLI Integration (Full Parity)

Gemini must work identically to Claude on the board. Key differences from Claude documented here.

### Discovery

| Aspect | Claude | Gemini |
|--------|--------|--------|
| Config directory | `~/.claude/` | `~/.gemini/` |
| Project registry | Encoded directory names | `~/.gemini/projects.json` (slug→path map) |
| Session files | `~/.claude/projects/<encoded>/<uuid>.jsonl` | `~/.gemini/tmp/<slug>/chats/session-*.json` |
| File format | JSONL (one JSON object per line) | Single JSON file with `messages` array |
| Session ID source | Filename (UUID) | `sessionId` field in JSON |
| Message types | `user`, `assistant` | `user`, `gemini`, `info`, `error` |
| Content format | Inline text or content blocks | String or `{textValue}` object + `thoughts` array + `toolCalls` array |

### Activity Detection

| Behavior | Claude | Gemini |
|----------|--------|--------|
| Polling returns activelyWorking | **Never** (hooks only) | **Yes** (file mtime <2min) |
| Hook events | Stop, UserPromptSubmit, Notification, SessionStart, SessionEnd | AfterAgent→Stop, BeforeAgent→UserPromptSubmit, Notification, SessionStart, SessionEnd |
| Active timeout | 5 min (300s) | 2 min (configurable `activeThreshold`) + 5 min `attentionThreshold` |
| Prompt character | `❯` | `Type your message` |
| History prompt symbol | `❯` | `✦` |

### Launch & Resume

| Behavior | Claude | Gemini |
|----------|--------|--------|
| CLI command | `claude` | `gemini` |
| Auto-approve flag | `--dangerously-skip-permissions` | `--yolo` |
| Resume flag | `--resume <sessionId>` | `--resume <sessionId>` |
| Worktree support | Yes (`--worktree <name>`) | No (flag ignored) |
| Image upload | Yes (bracketed paste) | No (`supportsImageUpload = false`) |
| Tmux resume name | `claude-<sessionId.prefix(8)>` | `gemini-<sessionId.prefix(8)>` |
| Install command | `npm install -g @anthropic-ai/claude-code` | `npm install -g @google/gemini-cli` |

### Transcript Rendering

| Element | Claude | Gemini |
|---------|--------|--------|
| Thinking blocks | Not present | `thoughts` array → render as collapsible "Thinking" |
| Tool calls | `tool_use` content blocks | `toolCalls` array with `name`, `args`, `result`, `status` |
| Tool results | Separate user messages with `tool_result` | Inline in `toolCalls[].result` |
| Info messages | Not present | `type: "info"` → render as system notice |
| Error messages | Not present | `type: "error"` → render as error notice |

### Session Operations

| Operation | Claude | Gemini |
|-----------|--------|--------|
| Fork | Copy .jsonl, replace UUID in every line | Copy .json, replace sessionId field, new filename `session-forked-*.json` |
| Checkpoint | Backup .jsonl → .bkp, truncate lines | Backup .json, truncate `messages` array |
| Write (migration) | Create .jsonl with Claude message format | Create .json with `session-migrated-*.json` |
| Search (BM25) | Stream .jsonl line-by-line | Parse full JSON, extract message texts |

---

## 7.12 Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Cold start (window visible) | < 500ms | Native app achieves this; web app should render cached data from localStorage |
| Board render with cached data | < 1s | Show previous state immediately, update silently from SSE |
| Live data populated | < 3s | Full reconciliation + SSE snapshot |
| Card render budget | < 2ms per card | Enables 60fps with 50+ visible cards |
| Scrolling frame rate | 60fps | Virtual scroll for All Sessions (500+ cards) using react-virtuoso or tanstack-virtual |
| Search first results | < 500ms | NDJSON streaming, files processed newest-first |
| Search complete (1000 files) | < 5s | Cancellable via AbortController |
| Live metadata filter | < 16ms (one frame) | Client-side substring match on zustand state |
| Terminal rendering | 60fps | xterm.js with @xterm/addon-canvas (WebGL) |
| Terminal scrollback | 10,000+ lines without degradation | Bounded buffer, memory stable |
| Reconciliation cycle | < 500ms for 200 sessions | Server-side, mtime-based caching |
| Background CPU (idle) | < 5% | Only wake on: hook events, 5s tick, fs.watch |
| GitHub API calls | 1 `gh pr list` + 1 GraphQL per cycle | Batched, never per-session |
| tmux session list cache | 5s TTL | Single `tmux list-sessions` cached between polls |
| Memory (1000 sessions) | < 200MB server | Only visible card data fully loaded on client |
| SSE reconnection | Automatic (EventSource built-in) | No manual reconnect logic needed |
| Network offline | All local features work | GitHub features show cached data, no error dialogs block UI |

---

## 7.13 UI Behavior Details

### Appearance Mode

Three-state toggle (cycling): **Auto → Dark → Light → Auto**
- Auto: follows system preference (`prefers-color-scheme` CSS media query)
- Dark: forced dark theme
- Light: forced light theme
- Stored in localStorage, applied via `data-theme` attribute on `<html>`

### Auto-Scroll to Selected Card

When a card is selected (click, palette selection, deep link):
- **Kanban view:** scroll horizontally to center the card's column
- **List view:** scroll vertically to the card's position
- Use `scrollIntoView({ behavior: 'smooth', block: 'center' })` or equivalent

### Section Collapse Persistence (List View)

- Each column section in list view can be collapsed/expanded by clicking the header
- Collapsed state stored in localStorage as comma-separated column names: `"backlog,all_sessions"`
- All columns visible even when empty (with collapsed state)
- Backlog refresh button in header is separate from collapse toggle (clicking refresh doesn't toggle)

### Launch Stale Detection

If `isLaunching = true` persists for >30s:
- Terminal tab switches from "Starting session..." spinner to showing the actual terminal
- This handles cases where the launch completed but the completion event was missed
- Reconciler also force-clears stale `isLaunching` after 30s

### Persistent Toggle Preferences

These user preferences persist across sessions via localStorage:

| Key | Default | Used in |
|-----|---------|---------|
| `startTaskImmediately` | true | New Task Dialog |
| `createWorktree` | true | Launch Confirmation Dialog |
| `dangerouslySkipPermissions` | true | Launch Confirmation Dialog |
| `runRemotely` | true | Launch Confirmation Dialog |
| `boardViewMode` | "kanban" | Board toggle |
| `uiTextSize` | 0 (index 0-4, maps to 0.85x-1.5x) | UI scale |
| `sessionDetailFontSize` | 12 | Terminal font size |
| `listBoardCollapsedColumns` | "" | List view collapse state |

### Process Manager UI

Full-screen modal with three tabs:

| Tab | Content | Actions |
|-----|---------|---------|
| **Tmux Sessions** | All tmux sessions (name, path, attached status). "Managed" badge for Kanban-owned sessions. | Kill button per session |
| **Claude Processes** | Running Claude/Gemini processes | — (informational) |
| **Git Worktrees** | Worktrees per configured project (branch, path) | Remove button per worktree |

Refresh button at top. "Done" button to close.

Endpoints: `GET /api/tmux-sessions`, `DELETE /api/tmux-sessions/:name`, `GET /api/worktrees/:repoRoot`, `DELETE /api/worktrees`

### Image/File Drag-Drop

- **Prompt editors:** Paste images via Clipboard API (`navigator.clipboard.read()`), displayed as chips with remove button
- **Terminal area:** No direct file drag-drop in web (browser security prevents reading file paths from DnD). Instead: paste image from clipboard → sent via backend tmux bracketed paste flow.
- **Project addition:** Use HTML5 file picker (`<input type="file" webkitdirectory>`) instead of native folder DnD (browser can't read folder paths from drag events)

### Metadata Message Filtering (Claude JSONL)

When rendering Claude session history, filter these XML metadata tags:

| Tag | Behavior |
|-----|----------|
| `<local-command-caveat>` | Hide entire message (`isMeta: true`) |
| `<command-name>` | Strip from display |
| `<command-message>` | Strip from display |
| `<command-args>` | Strip from display |
| `<local-command-stdout>` | Render as assistant response (not user message) |

Use `stripMetadataTags()` regex to clean display text.

### Directory Encoding (Claude Session Paths)

Claude encodes project paths as directory names: `/Users/me/Projects/repo` → `-Users-me-Projects-repo`

`encodeProjectPath()` logic: replace `/` with `-`, strip leading `.`

`decodeDirectoryName()` logic (JsonlParser): convert leading dashes back to `/`, dashes between components to `/`

### Dynamic Onboarding Steps

The onboarding wizard generates steps dynamically based on installed assistants:
1. Welcome
2. For each enabled assistant: Hook installation step (with assistant-specific event names)
3. Dependencies check (shows status of tmux, gh, mutagen, etc.)
4. Notifications setup (Pushover or browser notifications)
5. Complete

If only Claude is installed: 5 steps. If both Claude + Gemini: 6 steps. Wizard detects running sessions and offers to kill them during setup.

---

## 8. Build Phases

### Phase 1: Foundation + Terminal MVP (Sequential)

1. Project scaffold: monorepo structure, shared types package, tsconfig
2. Express server with WebSocket (ws library) + SSE infrastructure
3. node-pty terminal: all 24 tmux commands, binary WS protocol, xterm.js frontend
4. Core state: AppState, Reducer (subset: createManualTask, selectCard, moveCard), EffectHandler
5. CoordinationStore + SettingsStore (file I/O)
6. Basic card CRUD: REST endpoints + SSE broadcast
7. Session launch + resume flow (LaunchSession, TmuxAdapter)

**Deliverable:** Working terminal in browser that can launch/resume Claude sessions.

### Phase 2: Parallel Feature Build (5 Agent Teams)

**Team 1: Session Adapters**
- ClaudeCodeSessionDiscovery + SessionStore + JsonlParser + TranscriptReader
- GeminiSessionDiscovery + SessionParser + SessionStore
- CompositeSessionDiscovery
- SessionIndexReader
- HookEventStore + HookManager

**Team 2: System Adapters + State**
- Full Reducer (all 51 Actions)
- CardReconciler (5-phase match/dedup)
- BackgroundOrchestrator (5s tick loop + hook event processing)
- AssignColumn, PromptBuilder, BM25Scorer, PaneOutputParser
- GitWorktreeAdapter, GitRemoteResolver, GhCliAdapter
- CodingAssistantRegistry + CompositeActivityDetector

**Team 3: Board UI**
- BoardView (horizontal kanban) + ListBoardView (vertical sections)
- ColumnView + CardView (with badges, context menu, play button)
- DragAndDrop (dnd-kit: cross-column move, within-column reorder, merge)
- CardDropIntent validation rules:
  - Cannot move to In Review without a PR link
  - Cannot move to Done without all PRs merged/closed
  - Cannot move to In Progress without tmux or active session
  - Drag to All Sessions = archive (sets manuallyArchived)
  - Drag from All Sessions clears manuallyArchived
  - Invalid targets show "not allowed" indicator before drop
- BoardViewMode toggle + persistence
- AddLinkPopover (segmented picker: Branch / Issue — no direct PR add since PRs are discovered from branches)

**Team 4: Card Detail UI**
- CardDetailView with tabs (Terminal, History, Issue, PR, Prompt)
- Terminal tabs (multi-tab with Claude/Shell distinction, independent kill)
- SessionHistoryView (paginated turns, search, checkpoint mode)
- PRBadge, ImageChipsView, PromptEditor (Enter submits, Shift+Enter newline, image paste)
- Copy-mode scroll (wheel event → backend tmux commands → 500ms cooldown)
- QueuedPromptsBar + QueuedPromptDialog

**Team 5: Integrations**
- GitHub issue backlog (GhCliAdapter.fetchIssues, per-project filters, dedup)
- PR tracking (batch list + GraphQL enrichment, multi-PR per card, status priority)
- Notifications (PushoverClient + Browser API + CompositeNotifier + Dedup)
- Remote execution (RemoteShellManager + MutagenAdapter + RemoteStatusWatcher)
- Search (BM25 NDJSON streaming + SearchOverlay/command palette)
- Onboarding wizard + dependency checker
- Settings UI (projects, GitHub filters, Pushover, remote config)
- Image sending (ImageSender: clipboard → tmux bracketed paste → poll confirmation)
- Session migration (SessionMigrator: export text → import target format)

---

## 9. Client Dependencies

```json
{
  "@xterm/xterm": "^6.0.0",
  "@xterm/addon-fit": "^0.11.0",
  "@xterm/addon-web-links": "^0.12.0",
  "@xterm/addon-canvas": "^0.7.0",
  "@xterm/addon-search": "^0.16.0",
  "@dnd-kit/core": "^6.3.1",
  "@dnd-kit/sortable": "^8.0.0",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-markdown": "^9.0.0",
  "remark-gfm": "^4.0.0",
  "zustand": "^5.0.4",
  "marked": "^15.0.0",
  "dompurify": "^3.2.0",
  "html2canvas": "^1.4.1"
}
```

**Note:** Two markdown libraries serve different purposes:
- `react-markdown` + `remark-gfm` — UI rendering of issue/PR bodies (React component, interactive)
- `marked` + `dompurify` + `html2canvas` — notification image rendering (non-interactive, generates PNG for Pushover)
```

## 10. Server Dependencies

```json
{
  "express": "^5.0.0",
  "ws": "^8.18.0",
  "node-pty": "^1.0.0",
  "cors": "^2.8.5",
  "form-data": "^4.0.0",
  "node-fetch": "^3.3.0"
}
```

---

## 11. Feature Parity Checklist (33 Features)

Every feature from the macOS app mapped to its web implementation:

| # | Feature | Web Implementation | Parity |
|---|---------|-------------------|--------|
| 1 | Elm-like state management | Server-side Reducer + SSE events | Full |
| 2 | Card-centric entity model | Shared TypeScript types | Full |
| 3 | Six-column kanban board | React BoardView + ListBoardView | Full |
| 4 | Card reconciliation engine | Server-side CardReconciler | Full |
| 5 | Multi-assistant (Claude + Gemini) | Registry + composite adapters | Full |
| 6 | Session discovery | Server-side scanning + SSE push | Full |
| 7 | Activity detection (hooks + polling) | Server-side detectors + SSE | Full |
| 8 | Embedded terminal | xterm.js + node-pty via WebSocket | Full |
| 9 | BM25 full-text search | NDJSON streaming (improved) | Better |
| 10 | GitHub issue backlog | Server-side gh CLI + SSE | Full |
| 11 | GitHub PR tracking | Server-side GraphQL + SSE | Full |
| 12 | Git worktree integration | Server-side git CLI | Full |
| 13 | Push notifications | Pushover (server) + Browser API | Full |
| 14 | Remote execution | Server-side SSH + Mutagen | Full |
| 15 | System tray / Amphetamine | `caffeinate` for sleep prevention; no tray in browser | Partial |
| 16 | Drag and drop | dnd-kit (cross-column move, reorder, merge, validation) | Full |
| 17 | Dual board view modes | React BoardView + ListBoardView with collapse persistence | Full |
| 18 | Session launching & resume | Server-side tmux + REST + launch confirmation dialog | Full |
| 19 | Queued prompts | Server state + auto-send after Stop hook + 2s delay | Full |
| 20 | Image paste & send | Clipboard API → backend temp file → tmux bracketed paste | Full |
| 21 | Hook onboarding | Server-side HookManager + REST install endpoint | Full |
| 22 | Onboarding wizard | React multi-step wizard + DependencyChecker | Full |
| 23 | Multi-project management | Server SettingsStore + REST CRUD + auto-discovery | Full |
| 24 | Settings system | Server-side JSON + REST + fs.watch hot-reload | Full |
| 25 | UI design | CSS glassmorphism (`backdrop-filter: blur()`) | Similar |
| 26 | Session history view | React + paginated REST + ETag + lazy load 80 turns | Full |
| 27 | Process manager | React tabs (tmux/worktrees) + REST endpoints | Full |
| 28 | Add project from folder | HTML5 file picker (browser DnD can't get folder paths) | Partial |
| 29 | Prompt editor | Textarea: Enter submits, Shift+Enter newline, image paste via Clipboard API | Full |
| 30 | Deep linking | HTTP URLs `localhost:PORT/card/ID` (better than custom URL scheme) | Better |
| 31 | Keyboard shortcuts | Web keyboard events; Cmd+K, Cmd+N work; Cmd+T/Cmd+W conflict with browser | Partial |
| 32 | Background orchestrator | Server-side 5s tick + hook event processing + auto-send | Full |
| 33 | Remote status watcher | Server-side polling + SSE push for online/offline transitions | Full |

**Score: 28 Full + 2 Better + 3 Partial = 97% functional parity (30/33 full or better)**

---

## 12. Success Criteria

1. **Terminal works identically**: launch, resume, multi-tab, image paste, copy-mode scroll, Shift+Enter
2. **Cards flow automatically**: hooks → activity detection → column movement → notifications
3. **Search is faster**: NDJSON streaming eliminates O(n²) rescoring
4. **Remote access works**: same UI from `localhost:3000` or `server:3000`
5. **All 33 features present**: no deferrals, no v2
6. **Both assistants supported**: Claude Code + Gemini CLI from day one
