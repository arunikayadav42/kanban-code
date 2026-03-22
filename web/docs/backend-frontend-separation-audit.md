# Backend/Frontend Separation Audit

**Date:** 2026-03-15
**Scope:** `web/` directory — Node.js server + React client
**Goal:** Assess API-readiness for hosting frontend anywhere + future mobile app

---

## Executive Summary

The architecture is **fundamentally sound** — server-authoritative state with SSE push, clean Elm-like unidirectional flow, and a thin client transport layer. However, **significant gaps** exist that would block a mobile client:

| Category | Grade | Key Issue |
|----------|-------|-----------|
| State Authority | **A** | Server owns all state; client is a view |
| API Completeness | **C** | ~60% of operations lack REST endpoints |
| Shared Type Contract | **C+** | Covers entities well; missing most request/response types |
| Authentication | **F** | Off by default; client never sends tokens; WS has zero auth |
| Server-side Validation | **D** | Launch accepts arbitrary shell commands; no input validation |
| Client Domain Logic | **C** | Card filtering, search scoring, drop validation in browser |
| Notification Extensibility | **B+** | Clean port interface; needs APNs/FCM adapter + device registration |
| Mobile Readiness | **D** | Hardcoded relative URLs, no transport abstraction, web-only APIs |

---

## Part 1: What's Working Well

### 1.1 Server-Authoritative State (Grade: A)
- All board state lives in `StoreManager.state` with Elm-like `dispatch → reduce → effects → SSE broadcast`
- Client never mutates server state directly — all mutations go through REST endpoints
- `CoordinationStore` provides atomic file persistence (temp + rename)
- `BackgroundOrchestrator` runs 5s reconciliation tick: discover → reconcile → activity → hooks → SSE

### 1.2 Clean Transport Layer (Grade: A-)
- `api-client.ts` is thin — zero business logic, just `fetch()` wrappers with shared types
- `ws-manager.ts` handles only reconnection backoff (transport concern)
- `useSSE.ts` is a pure pipe: connect → parse JSON → delegate to store
- All card mutations flow through prop callbacks, not direct component API calls

### 1.3 Plugin Architecture (Grade: A-)
- Descriptor-driven: no `switch` on assistant type in UI components
- `AssistantIcon`, `AssistantPill`, `NewTaskDialog` all render from `getDescriptor()` data
- Server registers only available plugins via `loadPlugins()` + `isAvailable()` check
- `CompositeSessionDiscovery` and `CompositeActivityDetector` fan out to all registered plugins

### 1.4 Process Management (Grade: A)
- All process operations (kill tmux, remove worktree) go through REST APIs
- `BackgroundOrchestrator` owns all reconciliation server-side
- `ProcessManagerView` is purely presentational with injectable callbacks

### 1.5 Notification System (Grade: B+)
- Server-pushed via SSE (correct architecture)
- `NotifierPort` interface is narrow and extensible
- `CompositeNotifier` with hot-swappable primary via `updatePrimary()`
- Deduplication and content extraction are server-side

---

## Part 2: Critical Gaps

### 2.1 Authentication — CRITICAL (Grade: F)

**Current state:** Single static bearer token, opt-in via `KANBAN_AUTH=required` env var. Off by default.

**Problems:**
| Issue | Severity | Detail |
|-------|----------|--------|
| Auth disabled by default | Critical | Any network-accessible deployment is wide open |
| Client never sends tokens | Critical | `api-client.ts` sends no `Authorization` header; `useSSE.ts` sends no `?token=`; `ws-manager.ts` appends nothing |
| SSE broken under auth | Critical | `EventSource` cannot set custom headers; `?token=` not appended |
| WebSocket has zero auth | Critical | `handleTerminalConnection` has no token check = **full shell access** |
| No timing-safe comparison | Medium | Token compared with `===` (vulnerable to timing oracle) |
| Token in URL query string | Medium | Appears in logs, browser history, referrer headers |
| CORS allows all origins | High | Any website can make API calls to a reachable instance |
| No per-user identity | High | One global token, no audit trail, no device-scoped revocation |
| `/health` leaks info | Low | Version + dependency status exposed without auth |

**Required for mobile:**
- Login endpoint issuing short-lived JWTs
- Refresh token mechanism
- Token injection in api-client, useSSE (`?token=`), and ws-manager (`?token=` on URL)
- HTTPS enforcement
- Per-device identity and revocation

### 2.2 Server-Side Validation — CRITICAL (Grade: D)

| Gap | Location | Risk |
|-----|----------|------|
| `commandOverride` accepted verbatim | `launch-session.ts` | **Arbitrary shell command injection** — client can send any command |
| No empty prompt guard | `launch-session.ts` | Server proceeds with empty prompt (only client disables button) |
| No `isGitRepo` check for worktree | `launch-session.ts` | `createWorktree: true` on non-git dir executes blindly |
| No `hasRemoteConfig` check | `launch-session.ts` | Remote launch accepted without verifying config exists |
| Settings accepts any fields | `PATCH /api/settings` | Shallow merge allows arbitrary keys written to disk |
| No card existence check on archive | `POST /cards/:id/archive` | Dispatches against missing ID, returns `{ archived: true }` |
| No drop validity check | `PATCH /cards/:id` (column move) | Server has no reject-a-move API; reconciler auto-corrects on next tick |

### 2.3 Missing API Endpoints (Grade: C)

Operations that exist in server reducers but have **no HTTP route**:

| Missing Endpoint | Server Support | Impact |
|------------------|---------------|--------|
| `POST /cards/:id/queued-prompts` | `addQueuedPrompt` action exists | Queue UI buttons are no-ops |
| `DELETE /cards/:id/queued-prompts/:pid` | `removeQueuedPrompt` action exists | Cannot remove queued prompt |
| `POST /cards/:id/queued-prompts/:pid/send` | `sendQueuedPrompt` action exists | Cannot manually send |
| `PATCH /cards/:id/queued-prompts/:pid` | `updateQueuedPrompt` action exists | Cannot edit queued prompt |
| `POST /cards/:id/images/upload` | `imagePaths` field exists on `QueuedPrompt` | Images sent as base64-in-payload |
| `GET /api/assistants` | Descriptors loaded at boot | Client uses bundled built-ins only |
| `GET /api/state` (REST snapshot) | `StoreManager.getState()` exists | Mobile needs non-SSE fallback |
| `POST /cards/:id/fork` | `forkSession` on SessionStore | No route despite UI button existing |
| `POST /cards/:id/send-prompt` | Server handles via tmux internally | No direct "send prompt to running session" API |

### 2.4 Client-Side Domain Logic (Grade: C)

Logic in the browser that a mobile app would need to reimplement:

| Logic | Location | Lines | Should Be |
|-------|----------|-------|-----------|
| Card filtering by project/assistant/type | `BoardView.tsx`, `store/index.ts` | ~50 | Server query params |
| Card sorting by sortOrder/updatedAt | `store/index.ts` `getCardsInColumn` | ~30 | Server-sorted response |
| Card-type classification (`source === 'manual'` → task) | `store/index.ts` | ~10 | Server-computed `cardType` field |
| Quick-search scoring (weighted multi-field) | `SearchOverlay.tsx` | ~400 | Server `/api/search` with field params |
| Drop validation (PR required, merged PR, etc.) | `CardDropIntent.ts` | ~40 | Server-side move validation API |
| PR status color mapping (3 divergent copies) | `CardView`, `CardDetailView`, `PRBadge` | ~60 | Single shared constant or server field |
| `getCardLabel` priority ordering | `shared/link.ts` (used by client) | ~20 | Server-computed `label` field |
| `getWorstPRStatus` ranking | `shared/link.ts` (used by client) | ~15 | Server-computed `worstPRStatus` field |
| `getDisplayTitle` cascade | `shared/link.ts` (used by client) | ~10 | Server-computed `displayTitle` field |
| "Resumable" check (`sessionLink != null`) | `BulkActionsMenu` | ~5 | Server validates on bulk-resume |
| Project name from path (`split('/').pop()`) | `CardView`, `CardDetailView` | ~5 | Server `projectName` field |

### 2.5 Shared Types Gaps (Grade: C+)

**What's typed:** Core entities (`Link`, `Session`, `Project`, etc.), 5 REST shapes, 6 SSE payloads.

**What's missing:**

| Missing Type | Why It Matters |
|-------------|----------------|
| `ResumeCardRequest` | Mobile needs typed resume payload |
| `SendPromptRequest` | No type for prompt submission |
| `MergeCardsRequest/Response` | Card merge is untyped |
| `ListWorktreesResponse` | Mobile needs typed worktree list |
| `ListTmuxSessionsResponse` | Mobile needs typed tmux session list |
| `SettingsSchema` | Settings PATCH accepts `any` |
| Discriminated SSE union | `SSEEventData` is loose catch-all; 8 of 20 events have no typed payload |
| WS `TerminalMessage` union | Control messages are inline, not shared |
| `AssistantsResponse` | No type for `/api/assistants` (endpoint doesn't exist yet) |

**Server-only types leaked into shared:**
- `getPersistentPath` (image file paths) — server filesystem concern
- `AssistantDescriptor.hooks.configPath/configFormat` — hook installation details
- `parseLinkFromJSON` backward-compat migration — persistence concern
- Mutable `ALL_ASSISTANTS` registry with `registerDescriptors()` — server startup concern

---

## Part 3: Domain Port Coverage

The server has **9 well-designed ports** covering adapters (tmux, worktrees, sessions, sync, PRs, notifications, activity). However, **~60% of API surface bypasses the port layer**:

| Missing Port | Operations Affected |
|-------------|-------------------|
| `CardRepositoryPort` | All card CRUD, archive, reorder, move, bulk ops |
| `StateStorePort` | Board state access (currently concrete `StoreManager`) |
| `SettingsPort` | Settings read/write (currently concrete `SettingsStore`) |
| `ProjectRegistryPort` | Project list, hide, unhide |
| `IssueTrackerPort` | GitHub issues/backlog (PRs have a port; issues don't) |
| `HookManagerPort` | Hook install/uninstall/status |
| `EventBroadcasterPort` | SSE client management |
| `TerminalPort` | WebSocket terminal lifecycle |
| `AuthPort` | Token validation (currently inline middleware) |

---

## Part 4: Mobile Readiness Checklist

### Must-Fix Before Mobile

- [ ] **Add proper JWT auth** with login/refresh endpoints
- [ ] **Wire auth tokens** into api-client, SSE (`?token=`), WebSocket (`?token=`)
- [ ] **Add server-side input validation** on launch (sanitize commandOverride or remove it)
- [ ] **Add server-side move validation** API (reject invalid column transitions)
- [ ] **Make base URL configurable** (currently hardcoded relative `/api`)
- [ ] **Add `/api/state` REST endpoint** for non-SSE state fetch (mobile foreground/background)
- [ ] **Add `/api/assistants` endpoint** returning loaded descriptors
- [ ] **Add queued prompt REST routes** (4 endpoints: add, remove, send, update)
- [ ] **Add image upload endpoint** (replace base64-in-payload)
- [ ] **Move card filtering/sorting to server** (`GET /api/cards?project=&assistant=&type=&sort=`)
- [ ] **Add deep-merge or sub-resource settings** (replace unsafe shallow merge)
- [ ] **Type all SSE events** as discriminated union in shared package

### Should-Fix for Quality

- [ ] **Pre-compute derived fields server-side**: `displayTitle`, `cardLabel`, `worstPRStatus`, `primaryPR`, `projectName`, `effectiveAssistant`
- [ ] **Unify PR status color mapping** into one shared constant (currently 3 divergent copies)
- [ ] **Add `CardLabelBadge` colors** to shared constants
- [ ] **Type all REST responses** in shared package
- [ ] **Type WS terminal protocol** as shared discriminated union
- [ ] **Add `notification:fired` SSE event** (declared but never emitted)
- [ ] **Wire `activity:changed` client handler** (currently a Phase 2 stub)
- [ ] **Move search quick-filter to server API** (with field params)
- [ ] **Add ETag/If-Match headers** for optimistic concurrency
- [ ] **Separate server-only types** from shared package
- [ ] **Rename `claudeSession` prop** to `assistantSession` in TerminalTabs

### Nice-to-Have

- [ ] Generate OpenAPI spec from typed routes
- [ ] Add AsyncAPI spec for SSE protocol
- [ ] Add APNs/FCM notification adapter
- [ ] Add device token registration endpoint
- [ ] Move `boardViewMode`/`appearanceMode` from localStorage to server settings
- [ ] Add guard against duplicate WS connections per session
- [ ] Add rate limiting on PTY spawning

---

## Part 5: Architecture Diagram (Current vs Target)

### Current State
```
Browser ──fetch('/api')──> Express Server ──> StoreManager ──> CoordinationStore (file)
   │                          │
   ├──EventSource('/api/events')──SSE──┘
   │                          │
   └──WebSocket('/ws/terminal')──node-pty──tmux

   Client has: filtering, sorting, search scoring, drop validation, type classification
   Server has: reconciliation, session discovery, activity detection, launch execution
```

### Target State (Mobile-Ready)
```
Any Client ──REST API──> Express Server ──> Domain Ports ──> Adapters
   │            │                              │
   │            ├── JWT Auth middleware         ├── CardRepository
   │            ├── Input validation            ├── SettingsPort
   │            ├── Server-side filtering       ├── ProjectRegistry
   │            ├── Pre-computed fields         ├── AuthPort
   │            └── OpenAPI spec                └── PushNotificationPort
   │
   ├──SSE (with auth token)──> State changes
   ├──REST GET /api/state ──> Snapshot (mobile foreground resume)
   └──WebSocket (with auth token)──> Terminal

   Client has: rendering, gestures, local UI state only
   Server has: ALL domain logic, validation, filtering, sorting, computed fields
```

---

## Appendix: Files Analyzed

### Server (47 source files)
- `server/src/index.ts` — Express app, route mounting, SSE, inline routes
- `server/src/routes/cards.ts` — Card CRUD + bulk operations
- `server/src/routes/search.ts` — BM25 streaming search
- `server/src/routes/system.ts` — Health, tmux, worktrees, backlog, hooks
- `server/src/middleware/auth.ts` — Bearer token auth (opt-in)
- `server/src/sse/state-broadcaster.ts` — SSE event dispatch
- `server/src/ws/terminal-handler.ts` — WebSocket PTY management
- `server/src/domain/ports/*` — 9 port interfaces
- `server/src/usecases/*` — 16 use cases
- `server/src/adapters/*` — Claude, Gemini, Kiro, Git, Notifications, Remote, Sync, Tmux
- `server/src/infrastructure/*` — CoordinationStore, SettingsStore, KSUID, Logger, etc.
- `server/src/plugins/*` — Registry + 3 plugin adapter factories

### Client (28 source files)
- `client/src/components/*` — 22 components
- `client/src/hooks/*` — useSSE, useTerminal, useKeyboardShortcuts
- `client/src/lib/*` — api-client, ws-manager, markdown-renderer, theme
- `client/src/store/index.ts` — Zustand store

### Shared (14 type files)
- `shared/src/types/*` — All domain types + API shapes + SSE events
- `shared/src/index.ts` — Re-exports
