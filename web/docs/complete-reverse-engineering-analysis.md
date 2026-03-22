---
title: "Kanban Code — Complete Reverse Engineering Analysis"
date: 2026-03-14
author: "Staff Engineer Reverse Engineering"
methodology: "Superpowers brainstorming + systematic debugging"
---

# Kanban Code — Complete Reverse Engineering Analysis

> **Date:** 2026-03-14 | **Scope:** Every feature, every subsystem, every data flow
> **Methodology:** Systematic Phase 1 root-cause investigation applied to reverse engineering — read everything, trace data flows, map dependencies before drawing conclusions.

---

# Executive Summary

**Kanban Code** is a native macOS SwiftUI application (targeting macOS 26 / Tahoe) that provides a kanban board for managing **AI coding agent sessions** — primarily Claude Code and Gemini CLI. It unifies session management, tmux terminals, git worktrees, GitHub PRs, push notifications, and remote execution into a single board where cards automatically flow through columns based on real activity signals.

**Tech stack**: Swift 6.2, SwiftUI (Liquid Glass), SwiftTerm (embedded terminal), MarkdownUI, custom Elm-like state management (~400 lines). No TCA, no Electron. Pure native.

**Architecture**: Clean Architecture with Elm-inspired unidirectional data flow:

```
Action → dispatch() → Reducer(State, Action) → (State', [Effect]) → EffectHandler → disk/tmux/network
```

Three build targets:

1. **KanbanCode** — the main SwiftUI app (~30 files, ~5000 lines SwiftUI)
2. **KanbanCodeCore** — pure Swift library (~50 files, domain + use cases + adapters + infrastructure)
3. **KanbanCodeActiveSession** — lightweight helper process for Amphetamine sleep prevention

**Dependencies** (only 2 external):

- [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm) — native terminal emulator
- [swift-markdown-ui](https://github.com/gonzalezreal/swift-markdown-ui) — markdown rendering

**License**: AGPLv3

---

# Table of Contents

1. [Feature Inventory (33 Features)](#feature-inventory)
2. [Domain Layer — Entities & Ports](#domain-layer)
3. [Use Cases & State Management](#use-cases--state-management)
4. [Adapter Subsystems](#adapter-subsystems)
5. [SwiftUI Views & UI Layer](#swiftui-views--ui-layer)
6. [Infrastructure & Helper Systems](#infrastructure--helper-systems)
7. [Complete Data Flow Diagram](#complete-data-flow-diagram)
8. [File System Paths Reference](#file-system-paths-reference)
9. [Test Coverage](#test-coverage)

---

# Feature Inventory

## Feature 1: Elm-like Unidirectional State Management

### What it is
A custom ~400-line Redux/Elm store that serializes all state mutations through a pure reducer. Not TCA — zero framework dependencies.

### How it works
- **`AppState`** (struct) — single source of truth containing: `links: [String: Link]` (cards), `sessions`, `activityMap`, `tmuxSessions`, `selectedCardId`, `selectedProjectPath`, `configuredProjects`, `error`, plus computed properties (`cards`, `filteredCards`, `visibleColumns`)
- **`Action`** (enum) — exhaustive list of ~25+ actions: UI actions (`createManualTask`, `launchCard`, `resumeCard`, `moveCard`, `renameCard`, `archiveCard`, `deleteCard`, `killTerminal`, `addBranchToCard`, `addExtraTerminal`), async completions (`launchCompleted`, `launchFailed`, `resumeCompleted`), background (`reconciled`), settings (`setError`, `setSelectedProject`)
- **`Reducer`** — pure synchronous function `(inout AppState, Action) -> [Effect]`. Runs on `@MainActor`. No async, no side effects. Fully testable.
- **`Effect`** (enum) — side effects declared by the reducer: `persistLinks`, `upsertLink`, `removeLink`, `createTmuxSession`, `killTmuxSession`, `deleteSessionFile`, `cleanupTerminalCache`, `updateSessionIndex`
- **`EffectHandler`** (actor) — executes effects asynchronously, can dispatch completion actions back to the store
- **`BoardStore`** (`@Observable @MainActor`) — the store that ties it together: `dispatch(action)` runs reducer, spawns effect tasks

### Race condition prevention
- **`isLaunching` flag** on `Link` — when a card is being launched/resumed, background reconciliation `.reconciled` action **skips** that card, preventing column bouncing
- **Terminal naming** — uses `"card-{id.prefix(12)}"` to prevent collisions
- **Concurrent reconciliation guard** — overlapping `reconcile()` calls return immediately
- **In-memory state is truth** — disk reads race with async writes; in-memory eliminates that class

### Key files
`BoardStore.swift` (988 lines), `EffectHandler.swift` (147 lines), `BoardState.swift` (legacy, 736 lines, kept for regression tests)

---

## Feature 2: Card-Centric Entity Model

### What it is
A card is the first-class entity. Each card has **independently optional typed links** — any combination can be present or absent.

### Link types

| Link | What it adds | Badge |
|------|-------------|-------|
| `SessionLink` | History tab, resume, fork, checkpoint | SESSION (orange) |
| `TmuxLink` | Terminal tab, live view, `isShellOnly`, `isPrimaryDead`, `extras` array | — |
| `WorktreeLink` | Branch info, path, cleanup action | WORKTREE (green) |
| `PRLink` | PR status, CI checks, reviews (multiple per card via `prLinks` array) | PR (purple) |
| `IssueLink` | Issue body, "Open in Browser" | ISSUE (blue) |

### Card identity
- **KSUID** format: `card_<27-char-base62>` — time-sortable using epoch 2014-05-13 (4-byte timestamp + 16-byte random), no database needed
- Backward-compatible with old UUID format

### Card metadata
- `source`: `manual`, `github_issue`, `discovered`, `hook`
- `column`: `backlog`, `in_progress`, `requires_attention`, `in_review`, `done`, `all_sessions`
- `manualOverrides`: per-field flags preventing reconciler from overwriting manual links (includes `dismissedPRs` and `branchWatermark` for incremental scanning)
- `manuallyArchived`: prevents auto-return from All Sessions
- `assistant`: `CodingAssistant` enum (`.claude`, `.gemini`), defaults to `.claude` when nil
- `promptBody`, `queuedPrompts`, `discoveredBranches`, `discoveredRepos`, `lastOpenedAt`

### Persistence
- Stored in `~/.kanban-code/links.json` — human-readable, pretty-printed, sorted keys
- Atomic writes (write to `.tmp`, rename)
- File locking via `.lock` file
- Corruption recovery: detect invalid JSON → backup as `.bkp` → rebuild from discovery
- Backward compatibility: old flat-format auto-migrated to nested typed links on read, always writes new format

---

## Feature 3: Six-Column Kanban Board with Automatic Card Flow

### Columns

| Column | What goes here | Trigger |
|--------|---------------|---------|
| **Backlog** | GitHub issues, manual tasks, ideas | Created via UI or GitHub import |
| **In Progress** | Claude/Gemini actively working | **Only** via hook-confirmed `activelyWorking` |
| **Requires Attention** | Stopped, needs plan approval, permission prompt | Stop/Notification hook, 5-min timeout |
| **In Review** | PR open, waiting for CI or review | PR discovered + session idle |
| **Done** | PR merged, worktree ready to clean up | All PRs merged/closed |
| **All Sessions** | Archive of every past session | Stale (24h idle), manually archived, cleanup |

### Automatic transitions
- **Backlog → In Progress**: User clicks Start → launch confirmation → tmux + Claude launched
- **In Progress → Requires Attention**: Stop hook fires, Notification hook fires, 5-minute timeout with no file changes
- **Requires Attention → In Progress**: UserPromptSubmit hook fires
- **In Progress → In Review**: PR discovered + session idle >5 min
- **In Review → In Progress**: User tells Claude to address review
- **In Review → Done**: All PRs merged/closed
- **Done → All Sessions**: Worktree cleaned up or manually archived
- **All Sessions → In Progress**: Resume button clicked

### Column assignment logic (`AssignColumn.swift`, 107 lines)
Pure function `f(card_state)` with decision tree:
1. Manual backlog override → sticky
2. Actively working → inProgress (even if archived → unarchive)
3. Manually archived → allSessions
4. All PRs done → done
5. Has PR + idle state → inReview
6. Activity state mapping (activelyWorking→inProgress, needsAttention→waiting, etc.)
7. GitHub issue without session → backlog
8. Manual task without session (has tmuxLink not shell-only) → inProgress (launching)
9. Has worktree → waiting
10. Recently active (<24h) → waiting
11. Default → allSessions

---

## Feature 4: Card Reconciliation Engine

### What it is
The `CardReconciler` (457 lines) merges discovered external resources (sessions, worktrees, PRs, tmux sessions) with existing cards using a multi-phase matching algorithm.

### Five reconciliation phases

**Phase A: Match sessions to existing cards**
- Priority: exact sessionId → git branch (same project) → projectPath+tmux
- Creates new card for unmatched sessions
- Updates sessionLink, lastActivity, projectPath
- On `isLaunching=true`, auto-attaches worktreeLink from session path

**Phase A2: Update branch index** from session.gitBranch (filters main/master)

**Phase B: Match worktrees to existing cards**
- Skip main/master branches
- No matching card → check if launching card in repo → associate; else create orphan
- Existing card → update worktreeLink.path (unless branch discovery blocked)
- B1.5: Detect branch switches, clear stale PR links
- B2: Absorb orphan worktree cards (keep real session card, absorb bare orphans)

**Phase C: Match PRs to existing cards** via branch name, skip dismissed

**Phase D: Clear dead links**
- tmuxLink cleared if session no longer live (unless mid-launch)
- worktreeLink cleared if path no longer exists on disk (unless manual override)
- Only clears if actually scanned (didScanTmux/didScanWorktrees flags)

### Branch auto-discovery (3 layers, cheapest to most expensive)
1. `gitBranch` field from JSONL metadata (every line has it)
2. Worktree disk scan (`git worktree list`)
3. Conversation scan via `JsonlParser.extractPushedBranches()` — regex matches `git push`, `git checkout -b`, `git switch -c`, `git worktree add`, `gh pr create` — cached with `branchWatermark`, only for sessions <24h

---

## Feature 5: Multi-Assistant Support (Claude Code + Gemini CLI)

### `CodingAssistant` enum

| ID | CLI | Config Dir | Worktree | Image Upload | Auto-Approve | Prompt Char | History Symbol |
|---|---|---|---|---|---|---|---|
| `claude` | `claude` | `.claude` | Yes | Yes | `--dangerously-skip-permissions` | `❯` | `❯` |
| `gemini` | `gemini` | `.gemini` | No | No | `--yolo` | `Type your message` | `✦` |

### `CodingAssistantRegistry`
- Maps each assistant to: `SessionDiscovery`, `ActivityDetector`, `SessionStore`
- Only installed assistants registered (checked via `ShellCommand.isAvailable()`)
- `CompositeSessionDiscovery` merges all sources sorted by mtime, handles individual failures gracefully
- `CompositeActivityDetector` routes hook events to all detectors, picks highest-priority state per session

### Session migration (`SessionMigrator`)
- Export as plain text (tool calls summarized as `[Tool: Edit src/main.ts]`, thinking blocks included)
- Import into target format (JSONL for Claude, JSON for Gemini)
- Card's `assistant` and `sessionLink` updated, other links preserved
- Source file backed up and removed to prevent reconciler duplication

---

## Feature 6: Session Discovery & Lifecycle

### Claude discovery (`ClaudeCodeSessionDiscovery`)
- Scans `~/.claude/projects/` directories
- **Mtime-based caching**: per-directory AND per-file mtime checks — skip unchanged entirely
- Merges `sessions-index.json` summaries with `.jsonl` metadata extraction
- `SessionIndexReader` handles two JSON formats (array-based and object-based)
- Evicts sessions from removed directories

### Gemini discovery (`GeminiSessionDiscovery`)
- Reads `~/.gemini/projects.json` for slug→path mapping
- Scans `~/.gemini/tmp/<slug>/chats/session-*.json`
- Same mtime caching pattern

### Session metadata extraction (`JsonlParser`)
- Streams `.jsonl` via `FileHandle.bytes.lines` (never loads entire file)
- Extracts: sessionId, firstPrompt, projectPath, gitBranch, messageCount
- Stops after 5 messages for efficiency
- Handles `file-history-snapshot` first lines, large messages (57KB+)
- `decodeDirectoryName()` converts `-Users-me-Projects-repo` → `/Users/me/Projects/repo`
- Filters metadata messages: XML tags (`<local-command-caveat>`, `<command-name>`, etc.), `isMeta: true` flag

### Session operations
- **Fork**: Copy `.jsonl` with new UUID in every JSON line, preserve original mtime (prevents 10-second "active" window)
- **Checkpoint**: Scrollable turn list → backup `.jsonl` as `.bkp` → truncate to selected turn's lineNumber
- **Rename**: Custom name stored in coordination file + `sessions-index.json` updated via `SessionIndexReader.updateSummary()`
- **Resume**: `claude --resume <sessionId>` in new/existing tmux session

---

## Feature 7: Activity Detection (Dual-Mode)

### Hook-based detection (primary — the ONLY way to reach "In Progress")
- **Hooks**: `UserPromptSubmit`, `Stop`, `Notification`, `SessionStart`, `SessionEnd`
- Gemini equivalents: `BeforeAgent`→UserPromptSubmit, `AfterAgent`→Stop (normalized in `HookManager`)
- Handler at `~/.kanban-code/hook.sh` — bash script reads JSON stdin, appends to `hook-events.jsonl`
- `HookEventStore` (actor) reads incrementally via `lastReadOffset` (FileHandle.seek)

### `ClaudeCodeActivityDetector` (actor)
- Maintains: `lastEvents`, `lastMtimes`, `polledStates`, `pendingStops` per session
- UserPromptSubmit → `.activelyWorking`, BUT downgrades if:
  - No file modification >5min (timeout matching Claude's tool timeout)
  - Last 4KB of `.jsonl` contains `[Request interrupted by user]` (Ctrl+C fast detection)
- Stop → `.needsAttention` (after configurable stopDelay)
- `resolvePendingStops()` returns sessionIds whose delay has elapsed

### `GeminiActivityDetector` (actor)
- Key difference: polling CAN return `.activelyWorking` if file modified <2min (Gemini has no hooks by default)
- Hook states have 5-minute timeout before downgrade

### Polling fallback (never promotes to In Progress for Claude)
- < 5min → `.idleWaiting`
- 5min–1hr → `.needsAttention`
- 1hr–24hr → `.ended`
- >24hr → `.stale`

---

## Feature 8: Embedded Terminal Emulator

### Technology
- **SwiftTerm** `LocalProcessTerminalView` wrapped in `BatchedTerminalView`
- **Performance**: 8ms batch delay, 32KB chunks per 4ms main-thread budget (prevents UI freeze on huge tmux repaints)
- URL detection: `Cmd+hover` + regex, `NSBezierPath` underlines, open via `NSWorkspace`
- True color (24-bit), Unicode/emoji, mouse events, alternate screen, scrollback, selection/copy/paste

### Multi-tab terminal
- **Claude tab** — always present when any terminal exists
- **Extra shells** — `sh1`, `sh2`, etc. via "+" button (independent from Claude tab)
- Killing Claude tab preserves extras (`isPrimaryDead` flag)
- Killing last extra while Claude dead → removes `tmuxLink` entirely
- Terminal reattaches on drawer close/reopen (tmux sessions persist)

### Tmux resilience
- Uses `send-keys` (not session command) → tmux session survives Claude exit/crash
- Multi-line commands: writes to `/tmp/kanban-code-launch-<name>.sh`, sources it
- Reuses existing tmux session if name conflicts (no kill-and-recreate)

---

## Feature 9: BM25 Full-Text Search

### `BM25Scorer` (86 lines)
- Parameters: k1=1.2, b=0.4
- Prefix matching for terms ≥3 chars, exact match for shorter
- Recency boost: 3x today → 1x in 30 days
- IDF: `log((n - df + 0.5) / (df + 0.5) + 1)`

### Search flow
- **Live filtering** — instant substring match on: session name, first prompt, project name/path, git branch, custom name
- **Deep search** (on Enter) — `ClaudeCodeSessionStore.searchSessionsStreaming()`:
  - FileHandle streaming (never loads entire file)
  - `Task.checkCancellation()` every 100 lines
  - Top 3 snippets per result (40 chars context around match)
  - `@MainActor` callback for incremental UI updates
- Files processed newest-first by mtime
- First results within 500ms across 1000+ sessions

### Command palette (`SearchOverlay`)
- Empty query → cards ordered by `lastOpenedAt` (VS Code-style toggle: second-most-recent pre-selected)
- `>` prefix → command mode: Open Settings, Toggle View Mode, New Task, project switching
- Arrow keys navigate, Enter selects + focuses terminal

---

## Feature 10: GitHub Issue Backlog Integration

### How it works
- Per-project GitHub filters (raw `gh search issues` syntax)
- `GhCliAdapter.fetchIssues()` → cards created with `issueLink` in Backlog
- Issue body rendered as GitHub-flavored markdown via MarkdownUI

### Prompt building (`PromptBuilder`, 58 lines)
1. If issueLink: apply `githubIssuePromptTemplate` (`#${number}: ${title}\n\n${body}`)
2. Else if promptBody: use as-is
3. Wrap with `promptTemplate` (project → settings → default)
4. `${prompt}` interpolation or prepend

### Stale issue cleanup
- Issues removed from backlog if `gh` no longer returns them — UNLESS work has started (has sessionLink)

---

## Feature 11: GitHub PR Tracking

### PR discovery (multi-branch, batched)
- Single `gh pr list --state all --json ...` per cycle (not per-session)
- `GhCliAdapter.batchPRLookup()` — single GraphQL query with field aliases (`pr0`, `pr1`, `pr2`...) for all open PRs
- Enriches: body, reviewThreads, approvals, CI check rollup (statusCheckRollup)
- Fallback to individual queries on GraphQL failure
- Rate limit detection

### PR status priority
`failing > unresolved > changesRequested > reviewNeeded > pendingCI > approved > merged > closed`

Each with `PRStatus: Comparable` (priority 0→7). `PullRequest.status` computed property implements full decision tree.

### Multi-PR display
- `prLinks: [PRLink]` array per card
- Worst-status badge shown + "+N" indicator
- Card → Done only when ALL PRs merged/closed
- PR body lazy-loaded via `gh pr view {number} --json body`, cached per card selection

---

## Feature 12: Git Worktree Integration

### Discovery (`GitWorktreeAdapter`)
- `git worktree list --porcelain` → parsed (path, branch from `refs/heads/`, isBare)
- Filters out bare and main/master worktrees
- Worktrees at `<repoRoot>/.worktrees/<name>` or `.claude/worktrees/<name>`

### Branch name resolution
- Authoritative: git worktree snapshot (`refs/heads/worktree-hashed-snacking-pony`)
- Fallback: directory name extracted from path

### `GitRemoteResolver` (actor singleton)
- Caches `git remote get-url origin` results
- Parses SSH (`git@github.com:owner/repo.git`) and HTTPS formats

---

## Feature 13: Push Notifications

### Pushover integration (`PushoverClient`)
- `POST https://api.pushover.net/1/messages.json` — multipart form-data with token, user, title, message (html=1), attachment
- URL scheme in notification: `kanbancode://card/<cardId>` for deep-linking

### Image rendering (`MarkdownImageRenderer`)
- Pipeline: pandoc (GFM → HTML body) → wrap in dark-theme CSS template → wkhtmltoimage (HTML → PNG)
- Dark theme: #1e1e1e bg, #e0e0e0 text, code blocks #2d2d2d, links #58a6ff

### Anti-duplicate logic (`NotificationDeduplicator`, actor)
- 62-second dedup window using **event timestamps** (not `Date.now`) for batch processing correctness
- `hasPromptedWithin()` checks if prompt came 0–1s AFTER stop (prevents notify-then-immediately-prompt race)

### Composite notifier
- Primary: `PushoverClient` (if configured)
- Fallback: `MacOSNotificationClient` (UserNotifications framework with PNG attachment)

---

## Feature 14: Remote Execution

### Shell interception (`RemoteShellManager`, 366 lines)
- Deploys 293-line `remote-shell.sh` at `~/.kanban-code/remote/`
- Symlinks as `zsh` and `bash` for SHELL override compatibility
- Script reads config from `~/.kanban-code/settings.json`

### Remote shell script features
- Recursion guard: `__KANBAN_REMOTE_WRAPPER` env var
- SSH multiplexing: ControlMaster=auto, ControlPersist=600
- Mutagen sync: create, flush before/after commands
- Worktree path fix: convert absolute `.git/gitdir` paths to relative (survive Mutagen sync)
- Path mapping: `local_to_remote()`, `remote_to_local()`
- Local fallback with 5-minute notification cooldown
- Working directory tracking: strip `pwd` capture, translate remote → local

### Mutagen sync (`MutagenAdapter`)
- Per-project named sessions: `mutagen sync create --name=kanban-<project> --label=name=kanban`
- Two-way-resolved mode
- Default ignores: node_modules, .venv, target, build, .DS_Store, .next*
- Status polling via `mutagen sync list --template`

---

## Feature 15: System Tray & Amphetamine Integration

### `KanbanCodeActiveSession` (separate executable)
- `NSApplication.shared.run()` — just sits in Activity Monitor
- `LSUIElement=true` — no Dock icon, menu bar only
- Amphetamine detects it → prevents Mac sleep

### `SystemTray` (SwiftUI view)
- `NSStatusItem` with clawd@1x/2x icons
- Menu: In Progress cards (gear icon), Waiting cards (exclamation), countdown when idle
- Auto-hides after configurable linger timeout (default 60s)
- Race prevention: exclusive create (`O_EXCL`) lock, PID validation via `kill(pid, 0)`

---

## Feature 16: Drag and Drop

### `DragAndDrop.swift`
- `DragState` (@Observable): `draggingCard`, `sourceColumn`, `mergeTargetId`, `reorderTargetId`, `reorderAbove`
- `ColumnDropDelegate`: detects merge vs. reorder based on same-column check
- Merge validation: `Link.mergeBlocked()` returns error message if unsafe
- Visual indicators: orange border (merge), green dashed line (reorder), red border (invalid)
- Works in both kanban and list view

### `CardDropIntent` (enum)
- `.move`, `.start`, `.resume`, `.archive`, `.invalid(reason)`
- Validates column transitions (can't move to In Review without PR, etc.)

---

## Feature 17: Dual Board View Modes

- **Kanban view** (`BoardView`) — horizontal columns, independent scroll, glass material headers
- **List view** (`ListBoardView`) — vertical sections, collapsible headers (stored in `@AppStorage`), drag/drop between sections
- View mode persists across relaunch via `@AppStorage`
- Selected card survives view mode switch

---

## Feature 18: Session Launching & Resume

### Launch confirmation dialog
- Editable TextEditor prompt, create worktree checkbox, run remotely checkbox, skip permissions checkbox
- Command preview updates live as toggles change
- Worktree disabled for non-git folders, hidden when worktree exists
- Run remotely disabled without config

### Launch flow (`LaunchSession`, 145 lines)
1. Build CLI command: `assistant.cliCommand + flags`
2. Prepend: `cd <projectPath> && [preamble] && <cmd>`
3. Kill stale tmux session, create new via `tmux.createSession()`
4. Uses `send-keys` (not session command) — keeps shell alive on Claude exit

### Session detection after launch
- Snapshot existing `.jsonl` files before launch
- Poll for NEW files: worktree launch 6s/12 attempts, normal 3s/6 attempts
- Scan all `~/.claude/projects/` directories matching project prefix (including worktree-specific dirs)
- Branch extracted from first JSONL line's `gitBranch` field

---

## Feature 19: Queued Prompts

- `QueuedPrompt` stored in `Link.queuedPrompts` (survives restart)
- Auto-send: on Stop hook + was actively working → 2-second delay → first auto-send prompt
- Does NOT fire on app launch or if user interacted within 2 seconds
- `BackgroundOrchestrator` checks `editingQueuedPromptIds` to skip prompts being edited

---

## Feature 20: Image Paste & Send

### `ImageSender` (actor)
- `waitForReady()` — polls `tmux.capturePane()` for `assistant.promptCharacter`, timeout 60s Gemini / 30s Claude
- `sendImages()` — for each image: set clipboard → send bracketed paste → poll until image count increases (30s per image)
- Only for Claude (`supportsImageUpload = true`)

### `ImageAttachment`
- Save to `/tmp/kanban-code-img-{id}.png` (transient) or `~/.kanban-code/images/{id}.png` (persistent for queued prompts)

---

## Feature 21: Hook Onboarding

### `HookManager` (static enum)
- Required hooks per assistant: Claude (5), Gemini (5 with name normalization)
- Preserves existing hooks (e.g., pushover) — adds alongside, deduplicates on `hook.sh` path
- Deploys `~/.kanban-code/hook.sh` (mode 0o755) — bash script using grep/cut (no jq dependency)

---

## Feature 22: Onboarding Wizard

- Multi-step: Welcome → Assistants selection → per-assistant hooks → Dependencies → Notifications → Complete
- `DependencyChecker.checkAll()` — concurrent `async let` checks for: claude, gemini, pandoc, wkhtmltoimage, gh (+ auth), tmux, mutagen, Pushover config

---

## Feature 23: Multi-Project Management

- Projects in settings: path, name, repoRoot, visible, githubFilter, promptTemplate, githubIssuePromptTemplate
- `ProjectDiscovery.findUnconfiguredPaths()` — detects unconfigured paths from sessions, groups subdirectories to parent, limits to 8 suggestions
- Add via: Settings → folder picker, toolbar menu → folder picker/text input, discovered section click

---

## Feature 24: Settings System

### `SettingsStore` (actor)
- `~/.kanban-code/settings.json` — human-readable, hot-reload via mtime-based caching
- `Settings` struct: projects, globalView, github, notifications, remote, sessionTimeout, promptTemplate, githubIssuePromptTemplate, columnOrder, hasCompletedOnboarding, defaultAssistant, enabledAssistants
- Backward compat: old `"skill"` key → new `"promptTemplate"`

---

## Feature 25: Liquid Glass UI Design

- Toolbar: `ToolbarSpacer` for separate glass pills (macOS 26+)
- `GlassHelpers`: `.glassColumn()`, `.glassOverlay()`, `.extendedBackground()`
- `AppScale`: 0.85x → 1.5x via UserDefaults, separate session detail font size
- Dark/light mode auto-adaptation, high contrast support

---

## Feature 26: Session History View

- `TranscriptReader` — two-pass algorithm: count turns + record last N lineNumbers, then parse only those turns
- Lazy loading: last 80 turns via `readTail()`, "Load 80 earlier" via `readRange()`
- Content parsing: `extractAssistantBlocks()` handles text, tool_use, thinking blocks
- Tool use display: `[tool: Read, Edit, Bash]` with path shortening (last 3 components)
- Metadata filtering: strips XML wrapper tags, hides caveat messages, renders local-command-stdout as assistant

---

## Feature 27: Process Manager

- Tabs: Tmux Sessions, Claude Processes, Git Worktrees
- Kill/remove buttons, refresh, integrated into toolbar

---

## Feature 28: Folder Drop Zone

- `FolderDropZone` — NSView-based drop zone using `registerForDraggedTypes`
- Bypasses SwiftUI's nested `.onDrop` hierarchy limitations
- Detects folder paths, image data (PNG/TIFF)

---

## Feature 29: Prompt Editor

- `PromptEditor` — NSViewRepresentable wrapping NSTextView
- Enter submits, Shift+Enter newline
- Image paste support, monospaced font, undo/redo
- Intrinsic height calculation for auto-sizing

---

## Feature 30: Custom URL Scheme

- `kanbancode://card/{cardId}` registered in Info.plist
- `AppDelegate` handles URL open → posts `kanbanCodeSelectCard` notification
- Used in Pushover notifications for deep-linking

---

## Feature 31: Keyboard Shortcuts

### `KeyboardShortcuts` (centralized enum)
- Context-aware activation via `AppShortcutContext` derived from AppState
- `Cmd+K`/`Cmd+P`: palette (anywhere); `Cmd+Shift+P`: command mode
- `Cmd+Enter`: toggle detail expand (detail open) OR deep search (palette open)
- `Cmd+T`: new terminal tab (detail on terminal tab)
- `Cmd+1-9`: switch projects; `Escape`: deselect; `Delete`: delete card

---

## Feature 32: Background Orchestrator

### `BackgroundOrchestrator` (391 lines, @Observable)
- 5-second tick loop calling `updateActivityStates()`
- `processHookEvents()` — event-driven path with 500ms delay for Stop events:
  1. Wait 500ms → check if user prompted → send notification
  2. Wait 500ms more → auto-send queued prompt
- `discoverBranchesForCard()` — manual branch discovery: clear watermark → re-scan JSONL → fetch PRs → assign column

---

## Feature 33: Remote Status Watcher

### `RemoteStatusWatcher`
- Polls `~/.kanban-code/remote/status-<host>.json` files
- Detects online→offline / offline→online transitions
- Sends notifications: "Remote Connection Lost" / "Remote Connection Restored"
- Thread-safe via NSLock

---


---

# Domain Layer — Entities & Ports (Deep Dive)

## Domain Layer Reverse Engineering Report

### ENTITIES DIRECTORY

#### 1. ActivityState.swift
**Type:** `enum ActivityState: String, Codable, Sendable`

**Cases:**
- `activelyWorking` = "actively_working"
- `needsAttention` = "needs_attention"
- `idleWaiting` = "idle_waiting"
- `ended`
- `stale`

**Computed Properties:**
- `priority: Int` — Priority for composite activity detection (higher = more informative)
  - activelyWorking: 5
  - needsAttention: 4
  - idleWaiting: 3
  - ended: 2
  - stale: 1

**Key Pattern:** Used by CompositeActivityDetector to pick best state when multiple detectors report on same session.

---

#### 2. CodingAssistant.swift
**Type:** `enum CodingAssistant: String, Codable, Sendable, CaseIterable`

**Cases:**
- `claude`
- `gemini`

**Computed Properties:**
- `displayName: String` — UI name for each assistant
- `cliCommand: String` — CLI command ("claude" or "gemini")
- `promptCharacter: String` — TUI ready-for-input indicator ("❯" or "Type your message")
- `autoApproveFlag: String` — CLI flag to skip permissions ("--dangerously-skip-permissions" or "--yolo")
- `resumeFlag: String` — Resume flag ("--resume")
- `supportsWorktree: Bool` — Only claude = true, gemini = false
- `supportsImageUpload: Bool` — Only claude = true, gemini = false
- `configDirName: String` — Config directory ("~/.claude" or "~/.gemini")
- `historyPromptSymbol: String` — User turn marker in conversation UI ("❯" or "✦")
- `installCommand: String` — npm package installation command

---

#### 3. ImageAttachment.swift
**Type:** `struct ImageAttachment: Identifiable, Sendable`

**Properties:**
- `id: String` — Unique identifier (UUID)
- `data: Data` — Raw image bytes
- `tempPath: String?` — Optional path to saved temp/persistent file

**Methods:**
- `init(id: String = UUID().uuidString, data: Data, tempPath: String? = nil)`
- `saveToTemp() throws -> String` — Save to `/tmp/kanban-code-img-{id}.png`, returns path
- `saveToPersistent() throws -> String` — Save to `~/.kanban-code/images/{id}.png`, returns path
- `static func fromPath(_ path: String) -> ImageAttachment?` — Load from disk

**Key Pattern:** Transient attachment for prompt dialogs. Not persisted in links.json; images saved as temp files for queued prompts.

---

#### 4. KanbanCodeColumn.swift
**Type:** `enum KanbanCodeColumn: String, Codable, CaseIterable, Sendable`

**Cases:**
- `backlog`
- `inProgress` = "in_progress"
- `waiting` = "requires_attention"
- `inReview` = "in_review"
- `done`
- `allSessions` = "all_sessions"

**Computed Properties:**
- `displayName: String` — User-facing column name
- `allowsBoardTaskCreation: Bool` — False only for `.allSessions`

---

#### 5. Link.swift
**Large complex file with multiple nested types**

##### Sub-Structs:

**SessionLink: Codable, Sendable, Equatable**
- `sessionId: String` — UUID of Claude session
- `sessionPath: String?` — Path to .jsonl transcript
- `sessionNumber: Int?` — Display number

**TmuxLink: Codable, Sendable, Equatable**
- `sessionName: String` — Primary tmux session
- `extraSessions: [String]?` — User-created shell terminals
- `tabNames: [String: String]?` — Custom display names (sessionName → label)
- `isShellOnly: Bool?` — True if primary is plain shell, not Claude
- `isPrimaryDead: Bool?` — True when primary killed but extras survive
- Computed: `allSessionNames: [String]` — All sessions (primary + extras)
- Computed: `terminalCount: Int`

**WorktreeLink: Codable, Sendable, Equatable**
- `path: String` — Worktree directory
- `branch: String?` — Git branch name

**PRLink: Codable, Sendable, Equatable**
- `number: Int` — PR number
- `url: String?`, `status: PRStatus?`, `unresolvedThreads: Int?`
- `title: String?`, `body: String?`, `approvalCount: Int?`
- `checkRuns: [CheckRun]?`, `firstUnresolvedThreadURL: String?`
- `mergeStateStatus: String?`

**IssueLink: Codable, Sendable, Equatable**
- `number: Int`, `url: String?`, `body: String?`, `title: String?`

**QueuedPrompt: Codable, Sendable, Equatable, Identifiable**
- `id: String` — KSUID with "prompt" prefix
- `body: String` — Prompt text
- `sendAutomatically: Bool` — Whether to auto-send
- `imagePaths: [String]?` — Associated image files

##### CardLabel Enum:
```swift
enum CardLabel: String, Sendable {
    case session = "SESSION"
    case worktree = "WORKTREE"
    case issue = "ISSUE"
    case pr = "PR"
    case task = "TASK"
}
```

##### Link (Main Card Entity)
**Type:** `struct Link: Identifiable, Codable, Sendable`

**Card-Level Properties:**
- `id: String` — KSUID with "card" prefix
- `name: String?` — Custom card name
- `projectPath: String?` — Project directory
- `column: KanbanCodeColumn` — Board column
- `createdAt: Date`, `updatedAt: Date`, `lastActivity: Date?`, `lastOpenedAt: Date?`
- `manualOverrides: ManualOverrides` — Tracks user-set fields
- `manuallyArchived: Bool`
- `source: LinkSource` — How card was created (discovered/hook/github_issue/manual)
- `promptBody: String?`, `promptImagePaths: [String]?`
- `isRemote: Bool` — Project configured for remote execution
- `sortOrder: Int?` — Manual sort within column
- `assistant: CodingAssistant?` — Nil defaults to claude
- `isLaunching: Bool?` — Launch/resume lock (prevents background reconciliation override)

**Typed Links (independently optional):**
- `sessionLink: SessionLink?`, `tmuxLink: TmuxLink?`, `worktreeLink: WorktreeLink?`
- `prLinks: [PRLink]` — Multiple PRs!
- `issueLink: IssueLink?`, `queuedPrompts: [QueuedPrompt]?`

**Branch Discovery:**
- `discoveredBranches: [String]?` — Branches from git push commands (nil = not scanned, [] = scanned but none found)
- `discoveredRepos: [String: String]?` — Maps branch name → git repo root path (for repos differing from projectPath)

**Display/Computed Properties:**
- `displayTitle: String` — name → promptBody → branch → PR title → session ID
- `effectiveAssistant: CodingAssistant` — Never nil, defaults to claude
- `prLink: PRLink?` — Primary PR (backward compat, first in array)
- `mergeablePR: PRLink?` — Single open PR eligible for merge
- `worstPRStatus: PRStatus?` — Highest urgency across all PRs
- `allPRsDone: Bool` — All PRs merged or closed
- `cardLabel: CardLabel` — Derived label based on which links present

**Backward-Compatible Properties (for legacy access):**
- `sessionId: String?`, `sessionPath: String?`, `sessionNumber: Int?`
- `tmuxSession: String?`, `worktreePath: String?`, `worktreeBranch: String?`
- `githubIssue: Int?`, `githubPR: Int?`, `issueBody: String?`

**Merge Validation:**
- `static func mergeBlocked(source: Link, target: Link) -> String?` — Returns error message if blocked (same ID, duplicate sessions/tmux/issue/worktree)

**Codable Implementation:**
- Custom `CodingKeys` for backward compatibility with legacy format
- `init(from:)` performs migration: old flat format → new typed links
- Migration logic for sessionLink, tmuxLink, worktreeLink, prLinks, issueLink
- Falls back from new nested format to legacy flat keys
- `encode(to:)` always writes new nested format

##### ManualOverrides Struct
**Type:** `struct ManualOverrides: Codable, Sendable`

**Properties:**
- `worktreePath: Bool`, `tmuxSession: Bool`, `name: Bool`, `column: Bool`, `prLink: Bool`, `issueLink: Bool`
- `dismissedPRs: [Int]?` — PR numbers explicitly dismissed
- `branchWatermark: Int?` — Byte offset into session JSONL; nil = no watermark

**Computed Properties:**
- `isBranchDiscoveryBlocked: Bool` — True if branchWatermark set OR worktreePath true

**Methods:**
- `isPRDismissed(_ number: Int) -> Bool` — Check if specific PR dismissed (legacy: prLink = all dismissed)

##### LinkSource Enum
```swift
enum LinkSource: String, Codable, Sendable {
    case discovered
    case hook
    case githubIssue = "github_issue"
    case manual
}
```

##### ContentBlock & ConversationTurn (for History)
**ContentBlock:**
```swift
struct ContentBlock: Sendable {
    enum Kind: Sendable, Equatable {
        case text
        case toolUse(name: String, input: [String: String])
        case toolResult(toolName: String?)
        case thinking
    }
    let kind: Kind
    let text: String
}
```

**ConversationTurn:**
```swift
struct ConversationTurn: Sendable {
    let index: Int
    let lineNumber: Int
    let role: String // "user" or "assistant"
    let textPreview: String
    let timestamp: String?
    let contentBlocks: [ContentBlock]
}
```

---

#### 6. PRStatus.swift

**Type:** `enum PRStatus: String, Codable, Sendable, Comparable`

**Cases (in priority order, 0 = highest urgency):**
- `failing` (0)
- `unresolved` (1)
- `changesRequested` = "changes_requested" (2)
- `reviewNeeded` = "review_needed" (3)
- `pendingCI` = "pending_ci" (4)
- `approved` (5)
- `merged` (6)
- `closed` (7)

**Comparable Implementation:**
- `static func < (lhs: PRStatus, rhs: PRStatus) -> Bool` — Uses priority ordering

**Supporting Types:**

**ChecksStatus: String, Codable, Sendable**
```swift
enum ChecksStatus: String, Codable, Sendable {
    case pass, fail, pending, none
}
```

**CheckRun: Codable, Sendable, Equatable**
- `name: String`
- `status: CheckRunStatus`
- `conclusion: CheckRunConclusion?`

**CheckRunStatus: String, Codable, Sendable**
```swift
enum CheckRunStatus: String, Codable, Sendable {
    case queued
    case inProgress = "in_progress"
    case completed
}
```

**CheckRunConclusion: String, Codable, Sendable**
```swift
enum CheckRunConclusion: String, Codable, Sendable {
    case success, failure, neutral, cancelled
    case timedOut = "timed_out"
    case actionRequired = "action_required"
    case skipped
}
```

---

#### 7. Project.swift

**Type:** `struct Project: Identifiable, Codable, Sendable`

**Properties:**
- `path: String` — Project directory (where Claude runs) — also computed as `id`
- `name: String` — Display name
- `repoRoot: String?` — Git repo root if different from path
- `visible: Bool` — Whether visible in UI
- `githubFilter: String?` — Per-project gh filter (nil = inherit global)
- `promptTemplate: String?` — Per-project prompt template (nil = inherit global)
- `githubIssuePromptTemplate: String?` — Per-project issue template (nil = inherit global)

**Computed Properties:**
- `effectiveRepoRoot: String` — repoRoot if set, otherwise path

**Init:** Auto-derives name from path's last component if not provided

---

#### 8. PullRequest.swift

**Type:** `struct PullRequest: Identifiable, Sendable`

**Properties:**
- `number: Int` — PR number (also computed as `id`)
- `title: String`, `state: String` — "open", "closed", "merged"
- `url: String`, `headRefName: String` — branch name
- `reviewDecision: String?` — "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", ""
- `checksStatus: ChecksStatus` — CI status aggregation
- `unresolvedThreads: Int` — Unresolved review threads
- `body: String?`, `approvalCount: Int`
- `checkRuns: [CheckRun]` — Individual CI check details
- `firstUnresolvedThreadURL: String?`
- `mergeStateStatus: String?` — CLEAN, BLOCKED, DIRTY, BEHIND, DRAFT, UNSTABLE, HAS_HOOKS, UNKNOWN

**Computed Properties:**
- `status: PRStatus` — Derive unified status with priority ordering
  - Highest priority: state == "merged" → merged
  - Then: state == "closed" → closed
  - Then: checksStatus == fail → failing
  - Then: unresolvedThreads > 0 → unresolved
  - Then: reviewDecision == "CHANGES_REQUESTED" → changesRequested
  - Then: reviewNeeded vs approved (based on decision and approvalCount)
  - Then: pending CI vs approved
  - Fallback: reviewNeeded

---

#### 9. Session.swift

**Type:** `struct Session: Identifiable, Sendable`

**Properties:**
- `id: String` — Session UUID
- `name: String?` — Custom name or auto-generated summary
- `firstPrompt: String?` — First user message text
- `projectPath: String?` — Decoded project directory
- `gitBranch: String?` — Branch if in worktree
- `messageCount: Int` — Message count
- `modifiedTime: Date`
- `jsonlPath: String?` — Full path to session file (.jsonl or .json)
- `assistant: CodingAssistant` — Which assistant (default: claude)

**Computed Properties:**
- `displayTitle: String` — custom name → first prompt preview → session ID prefix (8 chars + "...")

---

#### 10. TmuxSession.swift

**Type:** `struct TmuxSession: Identifiable, Sendable`

**Properties:**
- `name: String` — Session name (also computed as `id`)
- `path: String` — session_path
- `attached: Bool` — Whether currently attached

---

#### 11. Worktree.swift

**Type:** `struct Worktree: Identifiable, Sendable`

**Properties:**
- `path: String` — Worktree path (also computed as `id`)
- `branch: String?` — Git branch
- `isBare: Bool` — Whether bare worktree

**Computed Properties:**
- `directoryName: String` — Last path component (directory name)

---

### PORTS DIRECTORY (Adapter Interfaces)

#### 1. ActivityDetector.swift

**HookEvent: Sendable**
- `sessionId: String`, `eventName: String`
- `transcriptPath: String?`, `notificationType: String?`, `timestamp: Date`

**Protocol ActivityDetector: Sendable**
```swift
protocol ActivityDetector: Sendable {
    func handleHookEvent(_ event: HookEvent) async
    func pollActivity(sessionPaths: [String: String]) async -> [String: ActivityState]
    func activityState(for sessionId: String) async -> ActivityState
    func resolvePendingStops() async -> [String]  // Default: []
}
```

**Key Purpose:** Process hook events and poll activity for sessions without hooks.

---

#### 2. Notifier.swift

**Protocol NotifierPort: Sendable**
```swift
protocol NotifierPort: Sendable {
    func sendNotification(title: String, message: String, imageData: Data?, cardId: String?) async throws
    func isConfigured() -> Bool
}
```

**Key Purpose:** Send notifications with optional images and card ID for click handling.

---

#### 3. PRTracker.swift

**Protocol PRTrackerPort: Sendable**
```swift
protocol PRTrackerPort: Sendable {
    func fetchPRs(repoRoot: String) async throws -> [String: PullRequest]
    func enrichPRDetails(repoRoot: String, prs: inout [String: PullRequest]) async throws
    func fetchPRBody(repoRoot: String, prNumber: Int) async throws -> String?
    func isAvailable() async -> Bool
}
```

**Key Purpose:** Fetch and enrich PR data from GitHub. Returns PRs keyed by branch name. Lazy-loads PR bodies on demand.

---

#### 4. SessionDiscovery.swift

**Protocol SessionDiscovery: Sendable**
```swift
protocol SessionDiscovery: Sendable {
    func discoverSessions() async throws -> [Session]
    func discoverNewOrModified(since: Date) async throws -> [Session]
}
```

**Key Purpose:** Discover Claude Code sessions across all projects. Supports incremental re-scan.

---

#### 5. SessionLauncher.swift

**Protocol SessionLauncher: Sendable**
```swift
protocol SessionLauncher: Sendable {
    func launch(
        sessionName: String, projectPath: String, prompt: String,
        worktreeName: String?, shellOverride: String?,
        extraEnv: [String: String], commandOverride: String?,
        skipPermissions: Bool, preamble: String?,
        assistant: CodingAssistant
    ) async throws -> String  // returns tmux session name

    func resume(
        sessionId: String, projectPath: String, shellOverride: String?,
        extraEnv: [String: String], commandOverride: String?,
        skipPermissions: Bool, preamble: String?,
        assistant: CodingAssistant
    ) async throws -> String  // returns tmux session name
}
```

**Extension Defaults:** Overloaded methods for simpler cases (use default values for extraEnv, commandOverride, skipPermissions, preamble, assistant).

**Key Purpose:** Launch new sessions or resume existing by ID. Supports assistant selection and customization.

---

#### 6. SessionStore.swift

**SearchResult: Sendable**
- `sessionPath: String`, `score: Double`, `snippets: [String]`

**Protocol SessionStore: Sendable**
```swift
protocol SessionStore: Sendable {
    func readTranscript(sessionPath: String) async throws -> [ConversationTurn]
    func forkSession(sessionPath: String, targetDirectory: String?) async throws -> String
    func truncateSession(sessionPath: String, afterTurn: ConversationTurn) async throws
    func searchSessions(query: String, paths: [String]) async throws -> [SearchResult]
    func searchSessionsStreaming(
        query: String, paths: [String],
        onResult: @MainActor @Sendable ([SearchResult]) -> Void
    ) async throws
    func writeSession(turns: [ConversationTurn], sessionId: String, projectPath: String?) async throws -> String
}
```

**Default Extensions:**
- `forkSession` without targetDirectory calls full method with nil
- `searchSessionsStreaming` falls back to batch search, calls onResult once
- `writeSession` throws `SessionStoreError.writeNotSupported` by default

**Key Purpose:** Read/write sessions, fork, truncate, full-text search (batch and streaming).

---

#### 7. SyncManager.swift

**SyncStatus: String, Sendable**
```swift
enum SyncStatus: String, Sendable {
    case watching, staging, conflicts, paused, error, notRunning = "not_running"
}
```

**Protocol SyncManagerPort: Sendable**
```swift
protocol SyncManagerPort: Sendable {
    func startSync(localPath: String, remotePath: String, name: String, ignores: [String]) async throws
    func stopSync(name: String) async throws
    func flushSync() async throws
    func status() async throws -> [String: SyncStatus]
    func rawStatus() async throws -> String
    func isAvailable() async -> Bool
}
```

**Key Purpose:** Manage file synchronization (e.g., Mutagen) for remote projects.

---

#### 8. TmuxManager.swift

**Protocol TmuxManagerPort: Sendable**
```swift
protocol TmuxManagerPort: Sendable {
    func listSessions() async throws -> [TmuxSession]
    func createSession(name: String, path: String, command: String?) async throws
    func killSession(name: String) async throws
    func findSessionForWorktree(sessions: [TmuxSession], worktreePath: String, branch: String?) -> TmuxSession?
    func sendPrompt(to sessionName: String, text: String) async throws
    func pastePrompt(to sessionName: String, text: String) async throws
    func capturePane(sessionName: String) async throws -> String
    func sendBracketedPaste(to sessionName: String) async throws
    func isAvailable() async -> Bool
}
```

**Key Purpose:** Control tmux sessions. Notable: `pastePrompt` uses bracketed paste to bypass special character handling.

---

#### 9. WorktreeManager.swift

**Protocol WorktreeManagerPort: Sendable**
```swift
protocol WorktreeManagerPort: Sendable {
    func listWorktrees(repoRoot: String) async throws -> [Worktree]
    func createWorktree(repoRoot: String, name: String) async throws -> Worktree
    func removeWorktree(path: String, force: Bool) async throws
}
```

**Key Purpose:** Manage git worktrees for a repository.

---

### KEY ARCHITECTURAL PATTERNS

1. **Backward Compatibility:** Link.swift has extensive migration logic in Codable implementation to support both old flat format and new typed links structure.

2. **Computed Priority Values:** ActivityState, PRStatus use computed priority properties for ranking and comparison.

3. **Multi-PR Support:** Link now holds `prLinks: [PRLink]` array instead of singular PR, with computed properties for primary/mergeable/worst status.

4. **Launch Locks:** `Link.isLaunching` flag prevents background reconciliation from overriding card state during async launch/resume.

5. **Branch Discovery:** Tracked separately from linked worktree—`discoveredBranches` scanned from session JSONL, with watermark for incremental updates.

6. **Assistant Polymorphism:** CodingAssistant enum provides CLI flags, display names, capabilities for both Claude and Gemini.

7. **Typed Sub-Links:** SessionLink, TmuxLink, WorktreeLink, PRLink, IssueLink are independently optional—a card can hold any combination.

8. **Port-Based Architecture:** Nine protocols define adapters for session discovery, launching, storage, tmux management, PR tracking, sync, notifications, and activity detection.

9. **Streaming Search:** SessionStore supports both batch and streaming search with callback-based result updates.

10. **CardLabel Derivation:** Auto-computed from presence of links (session > worktree > issue > PR > task fallback).

---

### FILE LOCATIONS

**Entities:**
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/ActivityState.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/CodingAssistant.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/ImageAttachment.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/KanbanCodeColumn.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/Link.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/PRStatus.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/Project.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/PullRequest.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/Session.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/TmuxSession.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Entities/Worktree.swift

**Ports:**
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Ports/ActivityDetector.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Ports/Notifier.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Ports/PRTracker.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Ports/SessionDiscovery.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Ports/SessionLauncher.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Ports/SessionStore.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Ports/SyncManager.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Ports/TmuxManager.swift
- /Users/mayankw/Documents/Projects/kanban-code-main/Sources/KanbanCodeCore/Domain/Ports/WorktreeManager.swift
---

# Use Cases & State Management (Deep Dive)

## Complete Analysis of `/Sources/KanbanCodeCore/UseCases/`

I have thoroughly analyzed all 18 files in the UseCases directory. Here is the complete reverse-engineering documentation:

---

### **FILE 1: BoardStore.swift** (988 lines)
**Elm-like unidirectional state management for the Kanban board**

**AppState struct** (Source of Truth)
- Properties:
  - `links: [String: Link]` - cardId → Link mapping
  - `sessions: [String: Session]` - sessionId → Session
  - `activityMap: [String: ActivityState]` - sessionId → activity state
  - `tmuxSessions: Set<String>` - live tmux session names
  - `selectedCardId: String?`, `selectedProjectPath: String?`
  - `paletteOpen: Bool`, `detailExpanded: Bool`
  - `error: String?`, `isLoading: Bool`, `lastRefresh: Date?`
  - `configuredProjects: [Project]` - from settings
  - `excludedPaths: [String]` - for global view filtering
  - `discoveredProjectPaths: [String]` - unconfigured projects
  - `lastGitHubRefresh: Date?`, `isRefreshingBacklog: Bool`
  - `rateLimitedRepos: Set<String>` - GitHub API rate-limited repos
  - `deletedSessionIds: Set<String>` - user-deleted sessions
  - `deletedCardIds: Set<String>` - user-deleted cards

**Action enum** (User intent)
- Variants: `refreshDiscovery`, `reconcileDiscovery`, `setError`, `setLoading`, `selectCard`, etc.

**Reducer function** → Pure state transformation
- Input: (currentState, action) → Output: (newState, [effects])
- Effect types: `persistLinks`, `upsertLink`, `removeLink`, `createTmuxSession`, `killTmuxSession`, `refreshDiscovery`, `sendPromptToTmux`, etc.

**BoardStore class** (Observable)
- Holds AppState as @MainActor
- `dispatch(_ action: Action)` → calls Reducer → executes Effects via EffectHandler
- Data flows: User action → Reducer → State update + Effects → Async side effects

---

### **FILE 2: BoardState.swift** (736 lines)
**Observable wrapper for Kanban board display (legacy/deprecated in favor of AppState)**

**KanbanCodeCard struct** (Display model)
- Properties:
  - `id: String` - link.id
  - `link: Link`, `session: Session?`, `activityState: ActivityState?`
  - `isBusy: Bool` - async operation in progress
  - `isRateLimited: Bool` - GitHub API rate limiting
  - Computed: `isActivelyWorking`, `showSpinner`, `displayTitle`, `projectName`, `relativeTime`, `column`

**BoardState @Observable class** (UI binding target)
- Properties:
  - `cards: [KanbanCodeCard]` - all cards
  - `selectedCardId: String?`, `isLoading: Bool`, `error: String?`
  - `selectedProjectPath: String?`, `discoveredProjectPaths: [String]`, `configuredProjects: [Project]`
  - `lastGitHubRefresh: Date?`, `isRefreshingBacklog: Bool`
  - Private: `discovery`, `coordinationStore`, `activityDetector`, `settingsStore`, `ghAdapter`, `worktreeAdapter`, `tmuxAdapter`, `sessionStore`

**Methods:**
- `filteredCards` - project-filtered cards
- `cards(in column: KanbanCodeColumn)` - sorted by sortOrder then activity
- `addCard(link:)`, `renameCard(cardId:name:)`, `archiveCard`, `deleteCard`, `reorderCard`, `moveCard`
- `addBranchToCard`, `addIssueLinkToCard`, `unlinkFromCard(linkType:)`
- `setError(_ message:)` - auto-dismissing
- `refresh()` - full reconciliation: discover sessions → load links → scan worktrees → fetch PRs → reconcile → update columns → GitHub issues
- `refreshBacklog()` - force GitHub issue refresh
- `refreshGitHubIssues()` - fetches issues, syncs to links

**Data flow in/out:**
- Loads from: `discovery.discoverSessions()`, `coordinationStore.readLinks()`, `worktreeAdapter.listWorktrees()`, `ghAdapter.fetchPRs()`, `activityDetector.activityState()`
- Persists to: `coordinationStore.upsertLink()`, `coordinationStore.writeLinks()`, `SessionIndexReader.updateSummary()`
- Actions dispatched: implicit in Task blocks (no BoardStore reference)

---

### **FILE 3: EffectHandler.swift** (147 lines)
**Executes all side effects (async operations) produced by Reducer**

**EffectHandler actor**
- Properties:
  - `coordinationStore: CoordinationStore`
  - `tmuxAdapter: TmuxManagerPort?`
  - `setClipboardImage: (@Sendable (Data) -> Void)?`

**execute(_ effect:, dispatch:)** method
- Switch on Effect enum:
  - `.persistLinks(links)` → `coordinationStore.writeLinks()`
  - `.upsertLink(link)` → `coordinationStore.upsertLink()`
  - `.removeLink(id)` → `coordinationStore.removeLink()`
  - `.createTmuxSession(cardId, name, path)` → `tmux.createSession()` → dispatch `.terminalCreated` or `.terminalFailed`
  - `.killTmuxSession(name)`, `.killTmuxSessions(names)` → `tmux.killSession()`
  - `.deleteSessionFile(path)` → `FileManager.removeItem()`
  - `.cleanupTerminalCache(sessionNames)` → relay to TerminalCacheRelay
  - `.updateSessionIndex(sessionId, name)` → `SessionIndexReader.updateSummary()`
  - `.moveSessionFile()` → `SessionFileMover.moveSession()` + update coordinationStore
  - `.sendPromptToTmux()` → `tmux.sendPrompt()` or `pastePrompt()` (Gemini-aware)
  - `.sendPromptWithImagesToTmux()` → ImageSender → send images → send prompt
  - `.deleteFiles(paths)` → FileManager cleanup

**TerminalCacheRelay** - relay pattern to avoid circular imports

---

### **FILE 4: CardReconciler.swift** (457 lines)
**Pure reconciliation logic: merges discovered resources with existing cards, preventing duplicates**

**DiscoverySnapshot struct**
- `sessions: [Session]` - discovered Claude/Gemini sessions
- `tmuxSessions: [TmuxSession]`, `didScanTmux: Bool`
- `worktrees: [String: [Worktree]]` - repoRoot → worktrees
- `pullRequests: [String: PullRequest]` - branch → PR

**reconcile(existing:, snapshot:)** static function
1. **A. Match sessions to existing cards:**
   - Priority: exact sessionId → git branch → projectPath+tmux
   - Creates new card for unmatched session
   - Updates sessionLink, lastActivity, projectPath
   - On `isLaunching=true`, auto-attaches worktreeLink from session path

2. **A2. Update branch index** from session.gitBranch (if not main/master)

3. **B. Match worktrees to existing cards:**
   - Skip main/master branches
   - If no card exists for branch: check if a launching card in repo → associate
   - Else: create orphan worktree card
   - If card exists: update worktreeLink.path (unless branch discovery blocked)

4. **B1.5. Refresh worktree branches:**
   - Detect branch switches within same worktree path
   - Clear stale PR links when branch changes

5. **B2. Absorb orphan worktree cards:**
   - Multiple cards on same branch → dedup (keep real session card, absorb orphan)

6. **C. Match PRs to existing cards** via branch
   - Add/update PRLink, skip if dismissed

7. **D. Clear dead links:**
   - Remove tmuxLink if session no longer live (unless mid-launch)
   - Remove worktreeLink if path no longer exists on disk
   - Only clear if we actually scanned (didScanTmux/didScanWorktrees)

**Helper: findCardForSession()**
- Match priority: sessionId (exact) → branch (same project) → projectPath+tmux

---

### **FILE 5: LaunchSession.swift** (145 lines)
**Launches coding assistant sessions inside tmux (pure CLI wrapper)**

**LaunchSession: SessionLauncher**

**launch()** method
- Parameters: sessionName, projectPath, prompt, worktreeName?, shellOverride?, extraEnv, commandOverride?, skipPermissions, preamble, assistant
- Builds CLI command: `assistant.cliCommand` + flags (worktree, autoApprove, shell env)
- Prepends: `cd <projectPath> && [preamble] && <cmd>`
- Kills stale tmux session first
- Calls `tmux.createSession(name, path, fullCmd)`
- Returns sessionName

**resume()** method
- Parameters: sessionId, projectPath, shellOverride, extraEnv, commandOverride, skipPermissions, preamble, assistant
- Kills existing session with same sessionId prefix
- Builds CLI: `assistant.cliCommand + resumeFlag + sessionId`
- Creates new tmux session
- Returns sessionName

**buildEnvPrefix()** - VAR=value prefix for env overrides (handles shell variables with quotes)

**tmuxSessionName()** - static helper for naming (projectName-worktree)

**shellEscape()** - quote/escape paths for shell

---

### **FILE 6: BackgroundOrchestrator.swift** (391 lines)
**Coordinates all background processes: discovery, activity polling, hook events, notifications, auto-send**

**BackgroundOrchestrator @Observable**
- Properties:
  - `isRunning: Bool`
  - Dependencies: `discovery`, `coordinationStore`, `activityDetector`, `hookEventStore`, `tmux`, `prTracker`, `notificationDedup`, `notifier`, `registry`
  - `backgroundTask: Task?`, `didInitialLoad: Bool`, `dispatch: (@MainActor (Action) -> Void)?`
  - `editingQueuedPromptIds: Set<String>` - skip auto-send for these

**start()** - spawns background loop task that calls `backgroundTick()` every 5s

**stop()** - cancels background task

**discoverBranchesForCard(cardId)** - manual branch discovery
- Clears watermark/legacy flags
- Re-scans session for pushed branches via `JsonlParser.extractPushedBranches()`
- Stores branches + repo paths in link
- Fetches PRs from each repo
- Runs column assignment
- Persists to coordinationStore

**processHookEvents()** - event-driven path (called by file watcher)
1. First call: consume old events without notifying
2. For each event:
   - Forward to all `activityDetector.handleHookEvent()`
   - Route on event type:
     - **Stop**: wait 500ms → check if user prompted → send notification → wait 500ms more → auto-send queued prompt
     - **Notification**: apply 62s dedup → send notification
     - **UserPromptSubmit**: record prompt timestamp

**doNotify()** - format and send notification
- Gets link from coordinationStore
- Reads last assistant response from session transcript
- If multiline + renderMarkdown: generate markdown image
- Else: truncate to 1000 chars
- Sends via notifier

**autoSendQueuedPrompt()** - auto-send first sendAutomatically=true prompt
- Checks not being edited
- Dispatches `.sendQueuedPrompt()` action
- Records "prompted" for dedup

**backgroundTick()** - calls `updateActivityStates()`

**updateActivityStates()** - polls activity for sessions without hook events

---

### **FILE 7: AssignColumn.swift** (107 lines)
**Pure column assignment logic based on state signals**

**AssignColumn.assign()** static function
- Parameters: link, activityState?, hasPR, allPRsDone, hasWorktree
- Decision tree:
  1. Manual backlog override → .backlog (sticky)
  2. Actively working → .inProgress (even if archived)
  3. Archived → .allSessions
  4. All PRs done → .done
  5. Manual column override → current column
  6. Has PR + state = needsAttention/idleWaiting/ended/stale → .inReview
  7. Activity state:
     - activelyWorking → .inProgress
     - needsAttention → .waiting
     - idleWaiting → .waiting
     - ended + hasWorktree → .waiting; else fall through
     - stale → fall through
  8. GitHub issue without session → .backlog
  9. Manual task without session:
     - Has tmuxLink (not shell-only) → .inProgress (launching)
     - Else → .backlog
  10. Has worktree → .waiting
  11. Recently active (<24h) → .waiting
  12. Default → .allSessions

---

### **FILE 8: ProjectDiscovery.swift** (53 lines)
**Detects unconfigured project paths from sessions**

**ProjectDiscovery.findUnconfiguredPaths()** static function
- Input: sessionPaths, configuredProjects
- Collects unique non-nil session paths
- Filters out:
  - Configured projects (direct match)
  - Subdirectories of configured projects
- Returns sorted unique unconfigured paths

**normalizePath()** - expand ~, strip trailing /

**isSubdirectory()** - path.hasPrefix(parent + "/")

---

### **FILE 9: CompositeSessionDiscovery.swift** (52 lines)
**Routes discovery to all registered assistant adapters, merges results**

**CompositeSessionDiscovery: SessionDiscovery**
- Property: `registry: CodingAssistantRegistry`

**discoverSessions()** method
- For each registered assistant:
  - Call `registry.discovery(for: assistant).discoverSessions()`
  - Catch and log errors
- Returns all sessions sorted by modifiedTime descending

**discoverNewOrModified(since:)** method
- Same pattern, filtered to new/modified since date

---

### **FILE 10: CompositeActivityDetector.swift** (63 lines)
**Routes activity operations to all registered assistants, merges results**

**CompositeActivityDetector: ActivityDetector**
- Property: `registry: CodingAssistantRegistry`

**handleHookEvent()** - forward to all detectors

**pollActivity()** - fan out to all detectors, keep highest-priority state per session

**activityState()** - query all detectors, return highest-priority state (ensures correct detector's state wins)

---

### **FILE 11: BM25Scorer.swift** (86 lines)
**BM25 full-text search scoring for session .jsonl files**

**BM25Scorer enum**
- Constants: k1=1.2, b=0.4

**score()** static function
- Parameters: terms, documentTokens, avgDocLength, docCount, docFreqs, recencyBoost
- Builds term frequency map
- For each term:
  - If ≥3 chars: prefix match + all matching tokens
  - Else: exact match
  - Calculate IDF: `log((n - df + 0.5) / (df + 0.5) + 1)`
  - Calculate TF with BM25: `(tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgLen))`
  - Score += idf * tf_norm
- Multiply by recencyBoost

**recencyBoost()** - time-based boost (3x today → 1x in 30 days)

**tokenize()** - split on non-alphanumeric, filter < 2 chars

---

### **FILE 12: CodingAssistantRegistry.swift** (52 lines)
**Registry mapping CodingAssistant enum to adapter instances**

**CodingAssistantRegistry class**
- Private: `discoveries`, `detectors`, `stores` (keyed by CodingAssistant)

**register()** - register all three adapters for an assistant

**discovery(for:)**, **detector(for:)**, **store(for:)** - retrieve adapters

**unregister()** - remove all adapters for an assistant

**available** - computed property: all registered assistants sorted

---

### **FILE 13: ImageSender.swift** (88 lines)
**Orchestrates image transmission to tmux via clipboard + bracketed paste**

**ImageSendError enum**
- `.assistantNotReady(CodingAssistant)`
- `.imageUploadTimeout(expected: Int, assistant: CodingAssistant)`

**ImageSender actor**
- Property: `tmux: TmuxManagerPort`

**waitForReady()** method
- Polls `tmux.capturePane()` until `PaneOutputParser.isReady()`
- Timeout: 60s for Gemini, 30s for Claude
- Throws if not ready

**sendImages()** method
- For each image:
  - Capture pane to count images before
  - Set clipboard to image data
  - Send bracketed paste event
  - Poll until image count increases
  - Timeout: 30s per image

---

### **FILE 14: SessionMigrator.swift** (69 lines)
**Migrates session from one coding assistant to another**

**SessionMigrator enum**

**MigrationResult struct**
- `newSessionId, newSessionPath, backupPath`

**migrate()** static function
- Input: sourceSessionPath, sourceStore, targetStore, projectPath
- Steps:
  1. Read transcript from source store
  2. Generate new sessionId (UUID)
  3. Write to target format
  4. Backup source file + remove original (prevent reconciler duplication)
- Returns MigrationResult

**MigrationError** - emptySession error

---

### **FILE 15: RemoteShellManager.swift** (366 lines)
**Deploys remote-shell.sh wrapper for remote code execution via SSH**

**RemoteShellManager enum**

**deploy()** - write script, create symlinks (zsh, bash)

**shellOverridePath()** - return zsh symlink path (for SHELL override)

**remoteDirPath()** - return remote dir (~/.kanban-code/remote)

**setupEnvironment()** - returns empty dict (script reads config from settings.json)

**Embedded remote-shell.sh script** (293 lines)
- Recursion guard: `__KANBAN_REMOTE_WRAPPER` env var
- Hook/script fast-path: detect executable paths, run locally
- Reads config from ~/.kanban-code/settings.json (remote.host, remote.remotePath, remote.localPath)
- SSH options: ControlMaster=auto with 600s persist
- Mutagen sync integration: create, list, flush
- Worktree path fix: convert absolute .git/gitdir paths to relative (survive Mutagen sync)
- Path mapping: `local_to_remote()`, `remote_to_local()`
- Notification with cooldown (5 min)
- Remote availability check: SSH -O check with 5s timeout
- Main logic:
  - Parse `-c` flag to extract command
  - If not configured: run locally
  - If remote available: run remotely (fix worktrees before/after, flush Mutagen)
  - Else: fallback to local (with path mapping)
  - Handle pwd file extraction/restoration
  - Interactive shell support

---

### **FILE 16: UpdateCardColumn.swift** (37 lines)
**Updates link's column based on activity + PR status**

**UpdateCardColumn enum**

**update()** static function
- Input: link (inout), activityState, hasWorktree
- Computes: hasPR = !prLinks.isEmpty, allPRsDone = link.allPRsDone
- Calls: `AssignColumn.assign()`
- If archived + newColumn == inProgress → unarchive
- If column changed → set updatedAt

---

### **FILE 17: PaneOutputParser.swift** (30 lines)
**Parses tmux capture-pane output for assistant state**

**PaneOutputParser enum**

**countImages()** - count `[Image #` occurrences (multiline support)

**isReady()** - check if `assistant.promptCharacter` visible

**isClaudeReady()** - backward-compatible Claude check

---

### **FILE 18: PromptBuilder.swift** (58 lines)
**Builds final prompt for card with template application**

**PromptBuilder enum**

**buildPrompt()** static function
- Input: link (Link), project (Project?), settings (Settings?)
- Logic:
  1. If issueLink: apply `githubIssuePromptTemplate`, interpolate #number, title, body, url
  2. Else if promptBody: use as-is
  3. Else: use link.name
  4. Wrap with `promptTemplate` (project → settings → default)
  5. If template has `${prompt}`: interpolate
  6. Else: prepend template + newline
- Returns trimmed prompt

**applyTemplate()** - simple `${key}` → value replacement

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│              UI Action (SwiftUI Button Click)               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
          ┌────────────────────────────┐
          │   BoardStore.dispatch()    │
          │      (receives Action)     │
          └─────────┬──────────────────┘
                    │
                    ▼
          ┌────────────────────────────┐
          │     Reducer Function       │
          │   (pure state transform)   │
          │  Input:  (state, action)   │
          │  Output: (newState, fx[])  │
          └─────────┬──────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
    ┌─────────┐          ┌──────────────┐
    │  State  │          │ Effects      │
    │ Updates │          │ (side effects)│
    └─────────┘          └──────┬───────┘
        │                       │
        │                       ▼
        │              ┌───────────────────┐
        │              │  EffectHandler    │
        │              │   (actor)         │
        │              │  - CoordinationStore
        │              │  - TmuxAdapter    │
        │              │  - FileManager    │
        │              │  - etc.           │
        │              └────────┬──────────┘
        │                       │
        │          ┌────────────┴─────────────┐
        │          │                         │
        │          ▼                         ▼
        │     ┌─────────┐           ┌──────────────┐
        │     │ Async   │           │  Callbacks   │
        │     │ Disk I/O│           │ (dispatch new│
        │     │ Network │           │  actions)    │
        │     └─────────┘           └──────────────┘
        │                                   │
        ▼                                   ▼
    ┌────────────────┐          ┌──────────────────┐
    │  @Observable   │          │   Loop Back to   │
    │  Updates UI    │          │   Reducer again  │
    │                │          │   (if new action)│
    └────────────────┘          └──────────────────┘

BACKGROUND PROCESSES (parallel):
- BackgroundOrchestrator.start() → 5s tick → updateActivityStates()
- HookEventStore watcher → processHookEvents() → notifications → auto-send
- CompositeSessionDiscovery → discoverSessions() → CardReconciler.reconcile()
- CompositeActivityDetector → polls all assistants, merges states

COORDINATION STORE (persistent state):
- Links: serialized to ~/.kanban-code/links.json
- All writes go through coordinationStore (atomic merge on reads)
- Reads: cached in memory, refreshed on full refresh()
```

---

All files are pure Swift with strong typing, async/await support, and actor isolation. The architecture follows Elm-like unidirectional data flow with pure reducers, side effects properly separated, and multi-assistant support via registry pattern.
---

# Adapter Subsystems (Deep Dive)

## COMPREHENSIVE ADAPTER ANALYSIS - KANBAN CODE

This is a detailed reverse engineering of all adapter files in `Sources/KanbanCodeCore/Adapters/`. Every file has been analyzed for protocol implementations, method signatures, shell commands, file paths, and integration patterns.

---

## 1. CLAUDECODE ADAPTERS

### HookEventStore.swift
**Protocol**: None (standalone actor)  
**File Paths**: `~/.kanban-code/hook-events.jsonl`

**Class**: `HookEventStore` (public actor)
- **Methods**:
  - `init(basePath: String? = nil)` — uses `~/.kanban-code` by default
  - `readNewEvents() throws -> [HookEvent]` — reads lines since last offset, parses JSON
  - `readAllEvents() throws -> [HookEvent]` — resets offset, calls readNewEvents
  - `var path: String` — returns filePath

**Behavior**: Actor manages stateful offset into `.jsonl` file. Uses `FileHandle.seek()` for incremental reads. Parses JSON lines with ISO8601 timestamps. Stores `HookEvent` (sessionId, eventName, transcriptPath, timestamp).

---

### JsonlParser.swift
**Protocol**: None (static enum)  
**File Paths**: Session `.jsonl` files at `~/.claude/projects/<dirname>/<sessionId>.jsonl`

**Structures & Enums**:
- `SessionMetadata` — sessionId, firstPrompt, projectPath, gitBranch, messageCount
- `DiscoveredBranch` — branch name + repoPath (nil = same as projectPath)

**Methods**:
- `extractMetadata(from filePath: String) async throws -> SessionMetadata?` — streams .jsonl, extracts first user prompt + cwd/gitBranch. **Stops after 5 messages** for efficiency.
- `extractPushedBranches(from filePath: String, startOffset: Int?) async throws -> [DiscoveredBranch]` — scans tool_use Bash blocks for regex patterns:
  - `git push [flags] origin|upstream <branch>`
  - `git checkout -b <branch>`
  - `git switch -c <branch>`
  - `git worktree add ... -b <branch>`
  - Extracts `cd <path> &&` prefix to detect repoPath
  - **Strips `.claude/worktrees/<name>` suffix to get git root**
  - Excludes main/master branches
- `extractLatestPushedBranch(from filePath: String, stopAtOffset: Int) async throws -> DiscoveredBranch?` — **reverse-scan** from file end in 256KB chunks, returns first match found
- `decodeDirectoryName(_ name: String) -> String` — converts `-Users-me-Projects-repo` → `/Users/me/Projects/repo` (dashes = path separators)

**Metadata Message Filtering**:
- XML tags: `<local-command-caveat>`, `<command-name>`, `<command-message>`, `<command-args>`, `<local-command-stdout>`
- `isCaveatMessage()` — checks `isMeta: true` flag (hides entirely)
- `isMetadataMessage()` — checks if message is pure metadata tags
- `isLocalCommandStdout()` — contains `<local-command-stdout>` (render as assistant response)
- `parseLocalCommand()` — extract command from tags
- `stripMetadataTags()` — regex remove all XML wrapper tags

---

### TranscriptReader.swift
**Protocol**: None (static enum)  
**File Paths**: Session `.jsonl` files

**Structures**:
- `ReadResult` — turns: [ConversationTurn], totalLineCount: Int, hasMore: Bool

**Methods**:
- `readTurns(from filePath: String) async throws -> [ConversationTurn]` — legacy, calls readTail with max=Int.max
- `readTail(from filePath: String, maxTurns: Int = 80) async throws -> ReadResult` — **two-pass algorithm**:
  1. Count turns, record last N lineNumbers
  2. Parse only last N turns (with running index)
  - **Skips caveat wrapper messages**
  - Stdout responses render as "assistant" role
- `streamAllTurns(from filePath: String) -> AsyncStream<ConversationTurn>` — yields turns incrementally, cancellable
- `scanForMatches(from filePath: String, query: String) -> AsyncStream<Int>` — case-insensitive text search across textPreview + contentBlocks[].text
- `readRange(from filePath: String, turnRange: Range<Int>) async throws -> [ConversationTurn]` — pagination support

**Content Parsing**:
- `extractUserBlocks()` — handles tool_result blocks, command output, metadata-stripped text
- `extractAssistantBlocks()` — parses text, tool_use, thinking blocks
- `buildTextPreview()` — "tool: Name1, Name2" or "tool result x3" or "(empty)"
- `parseToolUse()` — extracts Bash command/description, Read/Write/Edit paths, Grep patterns, Glob patterns, Agent descriptions, etc.
- `shortenPath()` — keeps last 3 path components: `/path → .../last/3`

---

### HookManager.swift
**Protocol**: None (static enum)  
**File Paths**: 
- Settings: `~/.claude/settings.json` or `~/.gemini-latest/settings.json`
- Hook script: `~/.kanban-code/hook.sh`

**Methods**:
- `requiredHooks(for assistant: CodingAssistant) -> [String]` 
  - Claude: ["Stop", "Notification", "SessionStart", "SessionEnd", "UserPromptSubmit"]
  - Gemini: ["AfterAgent", "Notification", "SessionStart", "SessionEnd", "BeforeAgent"]
- `normalizeEventName(_ name: String) -> String` — AfterAgent→Stop, BeforeAgent→UserPromptSubmit
- `isInstalled(for assistant:, settingsPath:) -> Bool` — checks if all required hooks present in settings.json hooks.<eventName>[]
- `install(for assistant:, settingsPath:, hookScriptPath:) throws` — deploys hook.sh, updates settings.json JSON structure
- `uninstall(for assistant:, settingsPath:) throws` — removes Kanban hook entries from settings.json
- `deployHookScript(to path: String) throws` — writes shell script, sets 0o755 permissions

**Hook Script** (`~/.kanban-code/hook.sh`):
- Reads JSON from stdin
- Extracts sessionId, hook_event_name, transcript_path (fallback: sessionId)
- Appends JSONL line to `~/.kanban-code/hook-events.jsonl` with timestamp
- No jq dependency (uses grep/cut for parsing)

**Settings.json Structure**:
```
{ "hooks": { "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.kanban-code/hook.sh" }] }] } }
```

---

### ClaudeCodeSessionStore.swift
**Protocol**: `SessionStore`  
**File Paths**: `~/.claude/projects/<dirname>/<sessionId>.jsonl`

**Class**: `ClaudeCodeSessionStore` (final, Sendable)

**Methods**:
- `readTranscript(sessionPath: String) async throws -> [ConversationTurn]` — delegates to TranscriptReader.readTurns
- `forkSession(sessionPath: String, targetDirectory:) async throws -> String` — creates new UUID sessionId, copies file with replaced sessionIds in all JSON lines, preserves original mtime
- `writeSession(turns: [ConversationTurn], sessionId: String, projectPath:) async throws -> String` — reconstructs JSONL:
  - Encodes projectPath via `SessionFileMover.encodeProjectPath()`
  - Writes to `~/.claude/projects/<encoded>/<sessionId>.jsonl`
  - Maps tool names (Shell→Bash, ReadFile→Read, etc.)
  - Creates separate user message per tool_result (Claude's format)
- `truncateSession(sessionPath: String, afterTurn: ConversationTurn) async throws` — keeps lines up to turn.lineNumber, backs up original to `.bkp`
- `searchSessions(query: String, paths: [String]) async throws -> [SearchResult]` — batch search with BM25 scoring
- `searchSessionsStreaming()` — streaming version with @MainActor callback

**BM25 Search Algorithm**:
- **Tokenization**: lowercase, split on non-alphanumeric, filter len<2
- **Scoring**: prefix/exact match on queryTerms, recency boost (newer files score higher)
- **Snippets**: top 3 by query term frequency, 40 chars context around first match

---

### ClaudeCodeSessionDiscovery.swift
**Protocol**: `SessionDiscovery`  
**File Paths**: `~/.claude/projects/<dirname>/`

**Class**: `ClaudeCodeSessionDiscovery` (final, Sendable)

**Caching Strategy**:
- `dirMtimes[dirName]` — skip unchanged project dirs entirely
- `fileMtimes[filePath]` — skip unchanged .jsonl files within changed dirs
- `dirSessionIds[dirName]` — track which sessions belong to each dir for eviction

**Methods**:
- `discoverSessions() async throws -> [Session]` — scans `~/.claude/projects/`:
  1. Check each project dir's mtime
  2. If changed, read `sessions-index.json` and scan .jsonl files
  3. Parse metadata via JsonlParser if mtime changed or not cached
  4. Merge index data (summary, projectPath overrides)
  5. Evict removed dirs/sessions
  6. Return sorted by modifiedTime (newest first)
- `discoverNewOrModified(since: Date) async throws -> [Session]` — currently just calls discoverSessions (no time filtering)

**Integration**: Metadata from index file + .jsonl scanning for git branch, first prompt, message count.

---

### SessionIndexReader.swift
**Protocol**: None (static enum)  
**File Paths**: `~/.claude/projects/<dirname>/sessions-index.json`

**Structures**:
- `IndexEntry` — sessionId, summary?, projectPath, directoryName

**Methods**:
- `updateSummary(sessionId: String, summary: String, claudeDir:) throws` — finds index containing sessionId, updates summary field in-place
- `readIndex(at path: String, directoryName: String) throws -> [IndexEntry]` — handles multiple formats:
  - Format 1: `{ "sessions": [{ "sessionId": "...", "summary": "..." }] }`
  - Format 2: `{ "uuid-1": { "summary": "..." }, ... }` (top-level keys)
  - Decodes projectPath from directoryName via JsonlParser.decodeDirectoryName

---

### ClaudeCodeActivityDetector.swift
**Protocol**: `ActivityDetector`

**Actor**: `ClaudeCodeActivityDetector`

**State**:
- `lastEvents[sessionId]` — last HookEvent per session
- `lastMtimes[sessionId]` — file mtime for timeout calculation
- `polledStates[sessionId]` — cached polling results
- `sessionPaths[sessionId]` — session .jsonl paths for direct checks
- `pendingStops[sessionId]` — Stop event timestamps (resolved after stopDelay)

**Methods**:
- `handleHookEvent(_ event: HookEvent) async` — records events, manages pending stops
- `pollActivity(sessionPaths: [String: String]) async -> [String: ActivityState]` — **polling NEVER returns .activelyWorking**:
  - < 5min: .idleWaiting
  - 5min–1hr: .needsAttention
  - 1hr–24hr: .ended
  - 24hr+: .stale
- `activityState(for sessionId: String) async -> ActivityState` — hook-based precedence:
  - **UserPromptSubmit**: .activelyWorking, but downgrades if:
    - No file modification >5min (timeout)
    - Last line contains "[Request interrupted by user]" (Ctrl+C detected)
    - File age >3s + interrupt marker (fast detection)
  - SessionStart: .idleWaiting
  - Stop: .needsAttention
  - SessionEnd: .ended
  - Notification: .needsAttention
- `fileAge(_ path: String) -> TimeInterval?` — mtime check via FileHandle seek to end
- `lastLineContainsInterrupt(_ path: String) -> Bool` — reads last 4KB for "[Request interrupted by user]"
- `resolvePendingStops() -> [String]` — returns sessionIds whose stopDelay has elapsed

**Key Behavior**: Hook events override polling. Polling serves as fallback but never signals active work (prevents false "In Progress" for externally-started sessions).

---

## 2. GEMINI ADAPTERS

### GeminiActivityDetector.swift
**Protocol**: `ActivityDetector`

**Actor**: `GeminiActivityDetector`

**State**:
- `polledStates` — cached from last poll
- `hookStates` — per-session hook-based state
- `lastEventTime` — timestamp of last hook event (for timeout)

**Methods**:
- `handleHookEvent(_ event: HookEvent) async` — normalizes event names, maps to ActivityState:
  - UserPromptSubmit/BeforeAgent → .activelyWorking
  - SessionStart → .idleWaiting
  - Stop/AfterAgent → .needsAttention
- `pollActivity(sessionPaths: [String: String]) async -> [String: ActivityState]` — **file-based fallback**:
  - If hookState exists: check timeout (>5min → downgrade to .needsAttention)
  - Otherwise: <2min .activelyWorking, 2–5min .needsAttention, 5min–1hr .idleWaiting, etc.
- `activityState(for sessionId: String) async -> ActivityState` — returns hookState (with timeout check) or polledState

**Key Difference from Claude**: Gemini polling CAN return .activelyWorking (file modification <2min).

---

### GeminiSessionDiscovery.swift
**Protocol**: `SessionDiscovery`  
**File Paths**: `~/.gemini/tmp/<slug>/chats/session-*.json` + `~/.gemini/projects.json`

**Class**: `GeminiSessionDiscovery` (final, Sendable)

**Caching**:
- `dirMtimes[slug]` — per-chats-dir mtime
- `fileMtimes[filePath]` — per-file mtime
- `slugSessionIds[slug]` — track sessions per slug

**Methods**:
- `discoverSessions() async throws -> [Session]` — scans ~/.gemini/tmp:
  1. Read projects.json for slug→path mapping
  2. For each chats dir with changed mtime:
     - Scan session-*.json files
     - Parse metadata via GeminiSessionParser
     - Evict removed sessions
  3. Return sorted by modifiedTime (newest first)
- `readProjectsMapping() -> [String: String]` — inverts projects.json (path→slug to slug→path)
- `resolveProjectPath(slug:, slugToPath:) -> String?` — looks up from mapping

---

### GeminiSessionParser.swift
**Protocol**: None (static enum)  
**File Paths**: `~/.gemini/tmp/<slug>/chats/session-*.json`

**Codable Structures**:
- `SessionFile` — sessionId, projectHash?, startTime, lastUpdated, messages[], summary?
- `Message` — id?, type (user/gemini/info/error), content, thoughts?, tokens?, model?, toolCalls?, timestamp
- `MessageContent` — enum: .text(String) or .parts([ContentPart])
- `Thought` — text?
- `TokenInfo` — inputTokens?, outputTokens?, totalTokens?
- `ToolCall` — id?, name, args:[String:String]?, result (string or array), status, timestamp, displayName?, description?
- `AnyCodable` — flexible JSON (string/int/double/bool/dict/array/null)

**Methods**:
- `extractMetadata(from filePath: String) throws -> SessionMetadata?` — counts user+gemini messages, extracts firstUserMessage.content.textValue
- `parseSession(from filePath: String) throws -> SessionFile?` — full JSON decode

**Key Feature**: Graceful fallback for unparseable messages (rendered as raw JSON text).

---

### GeminiSessionStore.swift
**Protocol**: `SessionStore`  
**File Paths**: `~/.gemini/tmp/<slug>/chats/session-*.json`

**Class**: `GeminiSessionStore` (final, Sendable)

**Methods**:
- `readTranscript(sessionPath: String) async throws -> [ConversationTurn]` — parses SessionFile, maps types (user/gemini/info/error), builds turns with thinking + toolCall blocks
- `forkSession(sessionPath: String, targetDirectory:) async throws -> String` — copies JSON, replaces sessionId, generates new filename (session-forked-<id>.json), preserves mtime
- `writeSession(turns: [ConversationTurn], sessionId: String, projectPath:) async throws -> String` — reconstructs JSON:
  - Resolves slug via projects.json
  - Writes to `~/.gemini/tmp/<slug>/chats/session-migrated-<id>.json`
  - Maps content blocks to Gemini message format (toolCalls, thinking)
- `truncateSession(sessionPath: String, afterTurn: ConversationTurn) async throws` — keeps messages[0..<lineNumber]
- `searchSessions()` + `searchSessionsStreaming()` — BM25 search (similar to Claude store)

**Integration**: Slug resolution for multi-project setups.

---

## 3. TMUX ADAPTER

### TmuxAdapter.swift
**Protocol**: `TmuxManagerPort`

**Class**: `TmuxAdapter` (final, Sendable)

**Shell Commands**:
- `tmux list-sessions -F '#{session_name}\t#{session_path}\t#{session_attached}'` → TmuxSession[]
- `tmux has-session -t <name>` — check existence
- `tmux new-session -d -s <name> -c <path>` — create (daemonized)
- `tmux send-keys -t <name> <command> Enter` — send command
- `tmux send-keys -t <name> -l <text>` — send literal text (no escaping)
- `tmux kill-session -t <name>` — kill session
- `tmux capture-pane -p -t <name>` — get pane contents
- `tmux load-buffer <file>` — load file into buffer
- `tmux paste-buffer -p -t <name>` — paste (bracketed paste for readline safety)
- `tmux send-keys -t <name> \e[200~\e[201~` — empty bracketed paste (clipboard check)

**Methods**:
- `listSessions() async throws -> [TmuxSession]` — parses list-sessions output
- `createSession(name: String, path: String, command:) async throws` — creates session, optionally runs command:
  - Single-line: via send-keys
  - Multi-line: writes to `/tmp/kanban-code-launch-<name>.sh`, sources it (newlines safe in quoted context)
  - Reuses existing session if name conflicts
- `killSession(name: String) async throws` — kills by name
- `sendPrompt(to sessionName: String, text: String) async throws` — sends literal text + Enter
- `pastePrompt(to sessionName: String, text: String) async throws` — uses bracketed paste (for Gemini readline safety)
- `capturePane(sessionName: String) async throws -> String` — returns pane contents
- `sendBracketedPaste(to sessionName:) async throws` — signals clipboard check
- `findSessionForWorktree()` — priority matching: exact path > dir name > branch name > branch-with-dashes
- `isAvailable() async -> Bool` — checks if tmux executable exists

**File Paths**: `/tmp/kanban-code-launch-<name>.sh`, `/tmp/kanban-code-paste-<pid>.txt`

---

## 4. GIT ADAPTERS

### GitWorktreeAdapter.swift
**Protocol**: `WorktreeManagerPort`

**Class**: `GitWorktreeAdapter` (final, Sendable)

**Shell Commands**:
- `git worktree list --porcelain` — returns worktree status
- `git worktree add -b <name> <path>` — create new worktree + branch
- `git worktree remove [--force] <path>` — remove worktree

**Methods**:
- `listWorktrees(repoRoot: String) async throws -> [Worktree]` — parses porcelain output
- `createWorktree(repoRoot: String, name: String) async throws -> Worktree` — creates at `<repoRoot>/.worktrees/<name>`
- `removeWorktree(path: String, force: Bool) async throws` — derives repoRoot by stripping `/.claude/worktrees/` suffix
- `parseWorktreeList()` — handles porcelain format: "worktree <path>", "branch refs/heads/<name>", "bare"

**Convention**: Worktrees stored in `<repoRoot>/.worktrees/` or `.claude/worktrees/` (claude-remote convention).

---

### GitRemoteResolver.swift
**Protocol**: None (actor singleton)

**Actor**: `GitRemoteResolver` (static shared instance)

**Shell Commands**:
- `git remote get-url origin` — get origin URL

**Methods**:
- `githubBaseURL(for projectPath: String) async -> String?` — caches result, calls git command
- `issueURL(base: String, number: Int) -> String` — constructs `<base>/issues/<number>`
- `prURL(base: String, number: Int) -> String` — constructs `<base>/pull/<number>`
- `parseGitHubURL(from remote: String) -> String?` — handles:
  - SSH: `git@github.com:owner/repo.git` → `https://github.com/owner/repo`
  - HTTPS: various formats, normalizes to https

---

### GhCliAdapter.swift
**Protocol**: `PRTrackerPort`

**Class**: `GhCliAdapter` (final, Sendable)

**Shell Commands**:
- `gh pr list --state all --limit 50 --json number,title,state,url,headRefName,reviewDecision`
- `gh repo view --json owner,name` — get repo info
- `gh api graphql -f 'query=...'` — GraphQL queries for detailed PR info
- `gh pr view <number> --json body` — fetch PR body
- `gh auth status` — check authentication
- `gh search issues --match title,body --json number,title,body,url,labels --limit 25 <filter-args>`
- Custom merge command via template: `gh pr merge <number>`

**Methods**:
- `fetchPRs(repoRoot: String) async throws -> [String: PullRequest]` — lists PRs, maps by branch (prefers open over closed/merged)
- `enrichPRDetails()` — GraphQL batch query for detailed info (body, review status, checks)
- `batchPRLookup(repoRoot:, branches:, prNumbers:) async throws -> (byBranch:, byNumber:)` — single GraphQL call for multiple lookups, fallback to individual queries on failure
- `fetchPRBody(repoRoot:, prNumber: Int) async throws -> String?` — single PR body
- `isAvailable() async -> Bool` — checks gh executable + auth status
- `fetchIssues()` — searches issues by filter
- `mergePR()` — executes merge command template with substitutions

**Error Handling**: Rate limit detection, partial GraphQL success handling, individual retry fallback.

---

## 5. SYNC ADAPTER

### MutagenAdapter.swift
**Protocol**: `SyncManagerPort`

**Class**: `MutagenAdapter` (final, Sendable)

**Shell Commands**:
- `mutagen sync create <local> <remote> --name <name> --label <label>=true --sync-mode two-way-resolved --default-file-mode-beta 0644 --default-directory-mode-beta 0755 --ignore <pattern>...`
- `mutagen sync list --label-selector <label>=true` — check existence
- `mutagen sync pause --label-selector <label>=true` — pause all
- `mutagen sync resume --label-selector <label>=true` — resume all
- `mutagen sync terminate --label-selector <label>=true` — stop all
- `mutagen sync flush --label-selector <label>=true` — flush changes
- `mutagen sync list --label-selector <label>=true --template '{{range .}}...'` — get status

**Methods**:
- `startSync(localPath:, remotePath:, name:, ignores:) async throws` — creates with default ignores (node_modules, .venv, target, build, .DS_Store, etc.) or custom list. Checks for existing syncs and reuses.
- `resetSync(name:) async throws` — pause then resume (unstick)
- `stopSync(name:) async throws` — terminates
- `flushSync() async throws` — flushes changes
- `status() async throws -> [String: SyncStatus]` — parses template output:
  - watching → .watching
  - scanning/staging/transitioning/reconciling/saving → .staging
  - paused/halted → .paused
  - conflicts present → .conflicts
  - error → .error
- `rawStatus() async throws -> String` — returns `mutagen sync list -l` output
- `isAvailable() async -> Bool` — checks executable

**Convention**: Single global sync session per label (kanban-specific label for multi-session isolation).

---

## 6. NOTIFICATIONS ADAPTERS

### PushoverClient.swift
**Protocol**: `NotifierPort`

**Class**: `PushoverClient` (final, Sendable)

**HTTP**:
- `POST https://api.pushover.net/1/messages.json` — multipart form-data:
  - token, user, title, message (html=1), url, url_title, attachment (PNG)

**Methods**:
- `sendNotification(title:, message:, imageData:, cardId:) async throws`
  - Constructs multipart with boundary
  - URL scheme: `kanbancode://card/<cardId>`
  - Attachment: image.png
- `isConfigured() -> Bool` — checks token and userKey non-empty

---

### MacOSNotificationClient.swift
**Protocol**: `NotifierPort`

**Framework**: UserNotifications

**Methods**:
- `sendNotification(title:, message:, imageData:, cardId:) async throws`
  - Checks authorization status (.authorized or .provisional)
  - Writes PNG to temp directory
  - Attaches via UNNotificationAttachment (thumbnail display)
  - Stores cardId in userInfo for click-to-open
- `isConfigured() -> Bool` — always true (always available on macOS)

---

### CompositeNotifier.swift
**Protocol**: `NotifierPort`

**Class**: `CompositeNotifier` (final, Sendable)

**Methods**:
- `sendNotification()` — tries primary (if configured), falls back to secondary (images not sent to fallback)
- `isConfigured() -> Bool` — always true (fallback always available)
- `updatePrimary(_ notifier:)` — hot-swap at runtime

---

### NotificationDeduplicator.swift
**Protocol**: None (actor)

**Actor**: `NotificationDeduplicator`

**State**:
- `lastNotified[sessionId]` — last notification time for 62s dedup
- `lastPromptTime[sessionId]` — last UserPromptSubmit time

**Methods**:
- `recordPrompt(sessionId:, at eventTime:)` — records prompt timestamp
- `hasPromptedWithin(sessionId:, after stopTime:, window:) -> Bool` — checks if prompt came 0–1s AFTER stop (uses event timestamps, not wall clock)
- `shouldNotify(sessionId:, eventTime:) -> Bool` — checks 62s dedup window, records time
- `clearAllPending()` — reset state on startup

**Key**: Uses event timestamps (not Date.now) for batch processing correctness. Prevents:
- Duplicate notifications within 62s
- Notification on Stop if user immediately prompts (within 1s)

---

### MarkdownImageRenderer.swift
**Protocol**: None (static enum)

**Shell Commands**:
- `pandoc -f gfm -t html` (stdin) — converts markdown → HTML body fragment
- `wkhtmltoimage --quality 90 --width 600 --disable-smart-width --quiet <html> <png>` — renders to PNG

**Methods**:
- `isAvailable() async -> Bool` — checks both pandoc + wkhtmltoimage executables
- `renderToImage(markdown: String) async -> Data?` — full pipeline:
  1. Pandoc markdown → HTML body
  2. Wraps in HTML template (dark theme CSS)
  3. wkhtmltoimage HTML → PNG
  4. Returns image Data or nil on failure
  - Cleanup: removes temp HTML file

**File Paths**: `$TMPDIR/kanban-code-<id>.html`, `$TMPDIR/kanban-code-<id>.png`

**CSS Theme**: Dark mode (#1e1e1e bg, #e0e0e0 text, code blocks #2d2d2d, links #58a6ff)

---

### TranscriptNotificationReader.swift
**Protocol**: None (static enum)

**Methods**:
- `lastAssistantText(transcriptPath:) async -> String?` — reads transcript file, extracts last assistant turn
- `lastAssistantText(from turns:) -> String?` — extracts last assistant text from parsed turns (filters .text content blocks)
- `textPreview(_ text: String) -> String` — mirrors claude-pushover:
  - If first line ≥42 chars: use it
  - Else: accumulate sentences (split by ".") until >140 chars

---

### RemoteStatusWatcher.swift
**Protocol**: None (final class, Sendable)

**File Paths**: `~/.kanban-code/remote/status-<host>.json`

**Class**: `RemoteStatusWatcher` (final, Sendable)

**State**:
- `knownStatuses[host]` — cached RemoteHostStatus
- Thread-safe via NSLock

**Methods**:
- `isOnline(host: String) -> Bool` — reads status file, returns true if missing (assume online)
- `pollStatusChanges() async` — scans all status files:
  1. Parses JSON: `{ "status": "online|offline", "since": "ISO8601?" }`
  2. Detects changes (online→offline or vice versa)
  3. Notifies on first observation of offline state
- `notifyStatusChange()` — sends title + message via NotifierPort
  - Offline: "Remote Connection Lost — using local fallback"
  - Online: "Remote Connection Restored"

**JSON Format**: `{ "status": "online" | "offline", "since": "ISO8601" }`

---

## 7. INTEGRATION PATTERNS

### Domain-Adapter Boundaries
- **Activity Detection**: Hook events > polling fallback. Adapters normalize event names (Gemini→Claude).
- **Session Stores**: Read via shared reader (TranscriptReader for Claude, GeminiSessionParser for Gemini), write via adapter-specific format.
- **Discovery**: Scan respective directories, cache by mtime, evict removed entries.
- **Git Integration**: Worktrees under `.worktrees/` or `.claude/worktrees/`. Branch discovery via regex scan of git commands in transcripts.
- **Notifications**: Multi-tier (Pushover → macOS → none). Deduplication by event timestamp. Image rendering via pandoc+wkhtmltoimage pipeline.
- **Remote Status**: File-based polling with change detection. Decoupled from session activity.

### File System Conventions
| Adapter | Path | Format |
|---------|------|--------|
| Claude Sessions | `~/.claude/projects/<dirname>/<id>.jsonl` | JSONL (streaming) |
| Claude Index | `~/.claude/projects/<dirname>/sessions-index.json` | JSON |
| Claude Settings | `~/.claude/settings.json` | JSON (hooks config) |
| Gemini Sessions | `~/.gemini/tmp/<slug>/chats/session-*.json` | JSON (single file) |
| Gemini Projects | `~/.gemini/projects.json` | JSON (slug→path) |
| Gemini Settings | `~/.gemini-latest/settings.json` | JSON (hooks config) |
| Hook Events | `~/.kanban-code/hook-events.jsonl` | JSONL (stateful offset) |
| Hook Script | `~/.kanban-code/hook.sh` | Bash executable (0o755) |
| Worktrees | `<repo>/.worktrees/<name>` or `<repo>/.claude/worktrees/<name>` | Directory (git metadata) |
| Remote Status | `~/.kanban-code/remote/status-<host>.json` | JSON (online\|offline) |
| Temp Files | `/tmp/kanban-code-*`, `$TMPDIR/` | Various (cleaned up) |

### Shell Commands Summary
- **Git**: `git worktree add/list/remove`, `git remote get-url origin`
- **Tmux**: `list-sessions`, `new-session`, `send-keys`, `capture-pane`, `load-buffer`, `paste-buffer`, `kill-session`
- **GitHub**: `gh pr list`, `gh api graphql`, `gh pr view`, `gh auth status`, `gh search issues`, `gh pr merge`
- **Sync**: `mutagen sync create/list/pause/resume/terminate/flush` (label-based)
- **Markdown**: `pandoc -f gfm -t html`, `wkhtmltoimage`
- **Misc**: `mutagen`, `git`, `tmux`, `gh` executable path resolution via ShellCommand.findExecutable()

All shell commands are executed via `ShellCommand.run()` abstraction with timeout + error handling. No direct Process() spawning visible in adapters.
---

# SwiftUI Views & UI Layer (Deep Dive)

## Comprehensive SwiftUI App Layer Analysis (Sources/KanbanCode/)

### App Initialization & Lifecycle

**App.swift**
- Main `@main` entry point: `KanbanCodeApp` wrapping `ContentView`
- Window: 900×500 min, 1200×700 default (macOS 26 liquid glass)
- Commands: Cmd+N (New Task), Cmd+K (Search), Cmd+±/0 (zoom), Cmd+= (alt zoom-in)
- `AppDelegate` handles notifications (UNUserNotificationCenter), deep links (`kanbancode://card/{cardId}`), window lifecycle (prevents Cmd+W from closing)
- Lazy app startup: `NSApp.setActivationPolicy(.regular)`, icon loading from bundle, notification auth
- Notification clicks select card via `kanbanCodeSelectCard` notification
- Stores zoom state in UserDefaults: `uiTextSize` (0-4) and `sessionDetailFontSize`

**Extension: Notification.Name**
- `kanbanCodeNewTask` – Cmd+N to create task
- `kanbanCodeToggleSearch` – Cmd+K to open palette
- `kanbanCodeSelectCard` – Deep link or notification click
- `kanbanCodeQuitRequested` – Graceful shutdown hook
- `kanbanSelectTerminalTab` / `kanbanCloseTerminalTab` – Terminal tab nav

---

### Core Board Views

**ContentView.swift** (too large to fully display, but structure)
- Main container: reads from `BoardStore` (single source of truth)
- Toolbar with: project selector, board mode toggle, refresh, process manager, settings
- Body split: conditional `BoardView` or `ListBoardView` based on `store.state.boardViewMode`
- Detail panel (right side): `CardDetailView` when `selectedCardId` is set
- Search overlay: `SearchOverlay` when palette is open
- Processes manager modal, settings modal, launch confirmation dialog, new task dialog
- All card/board actions dispatched to store: `.selectCard()`, `.reorderCard()`, `.renameCard()`, etc.
- State lifecycle: tasks for loading, session reconciliation, history polling

**BoardView.swift**
- Horizontal kanban layout: 5 columns (backlog, inProgress, waiting, inReview, done, allSessions)
- Each column wrapped in `DroppableColumnView` with merge + reorder support
- Reads: `store.state.visibleColumns`, `store.state.cards(in: column)`, `store.state.selectedCardId`
- Dispatches: `.selectCard()`, `.reorderCard()`, `.renameCard()`, `.setError()`
- Error banner at bottom (dismiss button)
- Empty state overlay with "New Task" button when no sessions
- ScrollViewReader for auto-scrolling to selected column

**ListBoardView.swift**
- Vertical list layout: sections per column with collapse toggle
- Stores collapse state in `@AppStorage("listBoardCollapsedColumns")` as encoded set
- Each section: `ListBoardSectionView` with cards inside, drag/drop reordering + merging
- Column header: toggle, circle badge, card count, refresh button (backlog only)
- Drop zones: header + body for both move and reorder
- Selected card: blue accent background + border
- Empty section: dashed border, placeholder text
- Target: reorder indicator above/below card

**ColumnView.swift**
- Single column view (deprecated, simple layout)
- ScrollView with LazyVStack of cards
- Floating header pill with column name + count badge
- Responsive width: min 240, ideal 280, max 360

---

### Card Rendering & Interaction

**CardView.swift**
- Title (2 lines max), project + branch labels, time + badges
- Bottom row: assistant icon OR label badge, relative time, spacer, badges (tmux, PR, issue, etc.)
- Play button top-right for backlog cards (onStart action)
- Context menu: Start/Resume/Fork, Copy Resume Cmd, Open PR/Issue, Move to Project/Assistant, Archive/Delete
- Selection: tap = toggle selected, context background changes
- `onSelect` callback: toggle selection
- Various optional callbacks: onStart, onResume, onFork, onRename, etc.

**CardDetailView.swift** (too large, but key sections)
- Tabs: Terminal (if tmux), History (session turns), Issue, PR, Prompt
- Terminal: `TerminalRepresentable` embedding SwiftTerm's `LocalProcessTerminalView`
- History: `SessionHistoryView` with turn rendering, search, checkpoint mode
- Issue/PR: markdown rendering via MarkdownUI
- Prompt: readonly display of initial prompt
- Toolbar: actions menu (Start, Resume, Fork, Queue Prompt, Archive), close button
- State: tab selection, terminal focus, checkpoint mode toggle
- Reads: card info, turns, terminal attachment, PR/issue data

**CardDropIntent.swift**
- Enum: `.move`, `.start`, `.resume`, `.archive`, `.invalid(reason)`
- Logic: validates column transitions (e.g., can't move to In Review without PR, can't move to Done without merged PR)

---

### Drag & Drop

**DragAndDrop.swift**
- `DragState` (Observable): `draggingCard`, `sourceColumn`, `mergeTargetId`, `reorderTargetId`, `reorderAbove`
- `DroppableColumnView`: wraps column in drop target, card-to-card merge detection
- `ColumnDropDelegate`: updateTargets() detects merge vs. reorder based on same-column check
- Merge: 2-card link combine (via `Link.mergeBlocked()` predicate)
- Reorder: same-column insertion above/below via cursor midpoint
- Drop indicators: orange border (merge), green dashed line (reorder)
- Invalid drop: red border + "Not allowed" badge
- Ghost card: faded placeholder when dragging cross-column

**CardView frame collection**: GeometryReader + CardFramePreference to track card rects in column coordinate space

---

### Search & Navigation

**SearchOverlay.swift**
- Command palette pattern: quick filter + deep search
- Modes: command mode (`>`), recent cards, filtered cards, deep search results
- Quick filter: title/project/branch/other fields with fuzzy scoring
- Deep search: hits sessionStore.searchSessionsStreaming() via .jsonl files
- Navigation: up/down arrows, Enter to select, Escape to close
- Cmd+↩ for deep search
- Recent cards sorted by lastOpenedAt > lastActivity > updatedAt
- Highlighted selected item scrolls into view
- Context menu: Resume, Fork, Checkpoint

**SearchCardRow** / **SearchResultRow**: display with badges, highlights query terms
**CommandRow**: icon + title + optional shortcut display

---

### Terminal & Process Management

**TerminalRepresentable.swift**
- `BatchedTerminalView`: SwiftTerm's LocalProcessTerminalView subclass
- Batches pty data with 8ms delay to reduce redraws
- Chunks 32KB per 4ms main-thread budget (prevents UI freeze on huge tmux repaints)
- URL detection: Cmd+hover + regex, open URL via NSWorkspace
- Monitors Cmd key + mouse position for URL highlight
- NSBezierPath underlines detected URLs in terminal output

**ProcessManagerView.swift**
- Tabs: Tmux Sessions, Claude Processes, Git Worktrees
- Lists running sessions via TmuxAdapter, worktrees via GitWorktreeAdapter
- Kill/remove buttons for selected items
- Refresh button, "Done" button to close

---

### Dialogs & Modals

**NewTaskDialog.swift**
- Form: prompt input, title, project picker, start immediately toggle
- Launch options (when start=true): create worktree, run remotely, dangerously skip permissions, custom branch
- Assistant picker (when multiple enabled)
- Command preview (editable, syncs from options)
- onCreate vs onCreateAndLaunch callbacks

**LaunchConfirmationDialog.swift**
- Pre-launch: editable prompt, image attachments, options, command override
- Resume: shows session ID, command preview, options
- Worktree name display, project path
- Image attachment support via PromptEditor

**QueuedPromptDialog.swift**
- Add/edit queued prompts for follow-up messages
- "Send automatically when Claude finishes" toggle
- Image attachments

**QueuedPromptsBar.swift**
- Horizontal bar: list of queued prompts
- Each: text, "Send Now" button, edit/remove buttons
- Bolt icon for auto-send prompts

**OnboardingWizard.swift**
- Multi-step: Welcome, Assistants selection, per-assistant hooks, Dependencies, Notifications, Complete
- Step indicators (colored circles), navigation buttons, transitions
- Dynamic step count based on enabled assistants

---

### Session History & Conversation

**SessionHistoryView.swift**
- Renders conversation turns with dark scrollbar overlay
- Features: search (Cmd+F), checkpoint mode, auto-load earlier turns (near-top detection), scroll preservation
- Turn blocks: role (user/assistant), syntax highlighting, copy buttons
- Search: debounced input, match navigation (prev/next), highlighting
- Checkpoint mode: hover highlights turn, dims later turns
- Scroll state preservation during auto-load
- onLoadMore, onLoadAroundTurn callbacks

---

### Settings & Helpers

**SettingsView.swift** (not fully read, but structure)
- General settings: project management, assistant config, hooks
- Remote execution config
- Notification settings (Pushover)
- Appearance theme toggle
- Editor discovery (Zed, Cursor, VS Code, Xcode, JetBrains, etc.)
- Opens selected editor/folder via NSWorkspace

**SystemTray.swift**
- NSStatusItem (menu bar icon): shows clawd@1x + clawd@2x for crisp rendering
- Menu: In Progress cards (gear icon), Waiting cards (exclamation icon), countdown when idle
- Tray hides after linger timeout (configurable in settings, default 60s)
- Launches helper .app for tool detection (Amphetamine compatibility)
- Click "Open Kanban" → activates main window

**AddLinkPopover.swift**
- Segmented picker: Branch / Issue / PR
- Input field + Add button
- Callbacks: onAddBranch, onAddIssue, onAddPR

---

### UI Components & Styling

**PRBadge.swift**
- Colored pill: PR #, status icon (checkmark if approved), unresolved threads count
- Colors: red (failing), orange (unresolved/changes requested), blue (needs review), yellow (pending CI), green (approved), purple (merged), secondary (closed)

**ImageChipsView.swift** + **PromptSection.swift**
- Image attachments as horizontal strip
- Chip: "Image #N" label, remove button
- Hover preview popup
- Integrated into PromptEditor for image paste support

**FolderDropZone.swift** + **ImageDropZone.swift**
- Invisible NSView-based drop zones using `registerForDraggedTypes`
- Bypasses SwiftUI's nested `.onDrop` hierarchy
- Detects folder paths, image data (PNG/TIFF from files)
- Calls onDrop callback with URL or Data

**PromptEditor.swift**
- NSViewRepresentable wrapping NSTextView with custom SubmitTextView
- Enter submits (Shift+Enter inserts newline)
- Placeholder text support
- Intrinsic height calculation for auto-sizing
- Image paste support
- Monospaced font, supports undo/redo
- Delegates to Coordinator for text updates + placeholder management

---

### Styling & Layout

**GlassHelpers.swift**
- `.glassColumn()` → ultraThinMaterial rounded rect (columns)
- `.glassOverlay()` → ultraThinMaterial rounded rect (modals)
- `.extendedBackground()` → backgroundExtensionEffect for visual continuity

**AppScale.swift**
- UI scale: 0.85x → 1.5x via UserDefaults `uiTextSize`
- Session detail font: separate size control, monospaced system font
- `.app(style:)`, `.app(size:)` factory functions apply global scale

**ResourceBundle.swift**
- `Bundle.appResources` → SPM resource bundle with fallback to Bundle.main

---

### Keyboard Shortcuts & Context

**KeyboardShortcuts.swift**
- Centralized shortcuts enum with context-aware activation:
  - Cmd+K / Cmd+P: open palette (anywhere)
  - Cmd+Shift+P: command mode
  - Cmd+↩: toggle detail expand (detail open, palette closed) OR deep search (palette open)
  - Cmd+T: new terminal tab (detail on terminal tab)
  - Escape: deselect card
  - Delete: delete card
  - Cmd+1-9: switch projects (anywhere)
- `AppShortcutContext`: derives from AppState (palette open, detail open, detail expanded, terminal active)
- `isActive(in:)` predicate gates shortcuts based on context

---

### Board View Mode

**BoardViewMode.swift**
- `BoardViewMode`: kanban vs. list (toggle in toolbar)
- `ListBoardSection`: helper struct with column + cards
- `ListSectionCollapseState`: encodes/decodes collapsed columns to UserDefaults

---

### Summary Table

| File | View Name | Role | State Read | Actions Dispatched |
|------|-----------|------|-----------|-------------------|
| App.swift | KanbanCodeApp | App root, lifecycle | N/A | N/A |
| ContentView.swift | ContentView | Main container | visibleColumns, selectedCardId, boardViewMode | selectCard, reorderCard, renameCard, etc. |
| BoardView.swift | BoardView | Kanban layout | cards(in:column), selectedCardId | selectCard, reorderCard, setError |
| ListBoardView.swift | ListBoardView | List layout | cards(in:column), selectedCardId | selectCard, reorderCard |
| CardView.swift | CardView | Card tile | card data, selection state | onStart, onResume, onFork, archive, etc. |
| CardDetailView.swift | CardDetailView | Detail panel | turns, card, session | varies (terminal, history, PR data) |
| SearchOverlay.swift | SearchOverlay | Command palette | cards, sessionStore | onSelectCard, onResumeCard, onForkCard |
| SessionHistoryView.swift | SessionHistoryView | Conversation | turns, isLoading | onLoadMore, onLoadAroundTurn |
| SettingsView.swift | SettingsView | Settings | projects, assistants | store operations |
| SystemTray.swift | SystemTray | Menu bar | cards(in:column) | N/A (display only) |
| ProcessManagerView.swift | ProcessManagerView | Process list | tmux, claude, worktrees | kill, remove operations |

---

All 30 files have been analyzed. The app follows **Elm-like unidirectional state**: Store → State → Views → Actions → Store (reducer + effects). No direct mutations; all state changes flow through `store.dispatch(action)`. This is a production macOS app (~5,000 lines of SwiftUI) managing Claude coding sessions with Kanban workflow, terminal integration, GitHub/PR tracking, and remote execution support.
---

# Infrastructure & Helper Systems (Deep Dive)

## COMPREHENSIVE REVERSE ENGINEERING REPORT: Kanban Code

Based on thorough analysis of all files in Sources/KanbanCodeCore/, Scripts/hooks/, and related components.

---

### 1. PROJECT STRUCTURE OVERVIEW

**Directory Layout:**
- `/Sources/KanbanCodeCore/` — Pure Swift library (no UI), fully testable
- `/Sources/KanbanCode/` — macOS app (SwiftUI + AppKit)
- `/Sources/KanbanCodeActiveSession/` — Background-only marker app (Activity Monitor indicator)
- `/Scripts/hooks/` — Claude Code hook integration
- `/Tests/` — Test suite
- `/docs/` — Architecture documentation
- `/specs/` — Specifications
- Deployment: macOS 26, Swift 6.2 (no #available checks needed)

---

### 2. INFRASTRUCTURE LAYER (7 Critical Files)

#### **CoordinationStore.swift** (Actor)
**Purpose:** Persistent store for Link records in `~/.kanban-code/links.json`

**Key Properties:**
- `filePath: String` — Location of links.json
- `encoder/decoder: JSONEncoder/JSONDecoder` — ISO8601 date strategies, pretty-printed sorted output

**Public Methods:**
- `readLinks() -> [Link]` — Read all coordination records
- `writeLinks([Link])` — Atomic write with .tmp → rename pattern
- `linkById(String) -> Link?` — Get single link by ID
- `linkForSession(String) -> Link?` — Lookup by session ID
- `upsertLink(Link)` — Insert or update by link.id
- `updateLink(id:update:)` — Mutate specific fields, update `updatedAt`
- `updateLink(sessionId:update:)` — Update by session ID
- `removeLink(id:)` / `removeLink(sessionId:)` — Delete records
- `removeOrphans()` — Clean up dead .jsonl file references
- `modifyLinks(transform:)` — Atomic read-modify-write (full transaction)
- `var path: String` — Public access to filePath

**Concurrency:** `actor` — All operations isolated, no interleaving

**Corruption Recovery:** On JSON parse error, backs up to `.bkp`, returns empty container

---

#### **SettingsStore.swift** (Actor)
**Purpose:** Manages user configuration at `~/.kanban-code/settings.json`

**Core Struct: Settings (Codable, Sendable)**
```
projects: [Project]
globalView: GlobalViewSettings (excludedPaths)
github: GitHubSettings (defaultFilter, pollIntervalSeconds, mergeCommand)
notifications: NotificationSettings (pushoverEnabled, token, userKey, renderMarkdownImage)
remote: RemoteSettings? (host, remotePath, localPath, syncIgnores)
sessionTimeout: SessionTimeoutSettings (activeThresholdMinutes)
promptTemplate: String (supports backward-compat "skill" key)
githubIssuePromptTemplate: String
columnOrder: [KanbanCodeColumn]
hasCompletedOnboarding: Bool
defaultAssistant: CodingAssistant?
enabledAssistants: [CodingAssistant]
```

**Public Methods:**
- `read() -> Settings` — Reads from disk with mtime-based caching
- `write(Settings)` — Atomic write (.tmp → rename)
- `invalidateCache()` — Force next read from disk
- `addProject(Project)` — Append (throws on duplicate path)
- `updateProject(Project)` — Update by path
- `removeProject(path:)` — Delete by path
- `reorderProjects([Project])` — Reorder list
- `var path: String` — Public filePath access

**Error Handling:**
- `SettingsError.duplicateProject(String)`
- `SettingsError.projectNotFound(String)`

**Caching:** Mtime-based — returns cached if file unchanged since last read

---

#### **KanbanCodeLog.swift** (Enum + Static)
**Purpose:** Centralized async logging to `~/.kanban-code/logs/kanban-code.log`

**Key Properties:**
- `logDir: String` — `~/.kanban-code/logs` (created on first access)
- `logPath: String` — Full path to `kanban-code.log`
- `queue: DispatchQueue` — `.utility` QoS, label `"kanban-code.log"`

**Public API (nonisolated static):**
- `info(subsystem: String, message: String)` — Log INFO level
- `warn(subsystem: String, message: String)` — Log WARN level
- `error(subsystem: String, message: String)` — Log ERROR level

**Format:** `[ISO8601 timestamp] [LEVEL] [subsystem] message\n`

**Threading:** Fire-and-forget via `queue.async` — FileHandle write or create on first append

---

#### **ShellCommand.swift** (Enum)
**Purpose:** Execute shell commands with user environment injection

**Key Struct: Result**
```
exitCode: Int32
stdout: String
stderr: String
var succeeded: Bool { exitCode == 0 }
```

**Public Methods:**
- `run(executable, arguments, currentDirectory?, stdin?) async throws -> Result` — Execute with full environment
- `isAvailable(command) async -> Bool` — Check if command exists
- `findExecutable(command) -> String?` — Resolve to absolute path

**Environment Resolution:**
- User login shell extracted once on first use: `$SHELL -l -c env`
- Fallback to process environment if shell fails
- Search paths in order:
  1. `~/.claude/local` (Claude Code managed)
  2. `~/.local/bin` (XDG)
  3. `/opt/homebrew/bin` (Apple Silicon Homebrew)
  4. `/usr/local/bin` (Intel Homebrew)
  5. `/usr/bin` (System)
  6. `/bin` (Core system)
  7. User's `$PATH` from login shell (nvm, volta, fnm, etc.)

**Deadlock Prevention:** Reads stdout/stderr BEFORE waitUntilExit to avoid pipe buffer overflow

---

#### **KSUID.swift** (Enum)
**Purpose:** K-Sortable Unique Identifier generation (4-byte timestamp + 16-byte random → 27-char base62)

**Format:** `[prefix_]XXXXXXXXXXXXXXXXXXXXXXXXX` (27 chars base62-encoded)

**Public Method:**
- `generate(prefix: String?) -> String` — Generate new KSUID

**Timestamp:** Epoch 2014-05-13 (1,400,000,000 unix seconds) — naturally sortable by creation time

**Example:** `KSUID.generate(prefix: "card")` → `"card_2MtCMwXZOHPSlEMDe7OYW6bRfXX"`

---

#### **SessionFileMover.swift** (Enum)
**Purpose:** Move Claude Code session .jsonl files between projects, updating `cwd` field

**Public Method:**
- `moveSession(sessionId, fromPath, toProjectPath) -> String` — Returns new path

**Algorithm:**
1. Encode target path: `encodeProjectPath(toProjectPath)` (replace `/` with `-`, strip `.`)
2. Target: `~/.claude/projects/{encoded}/{sessionId}.jsonl`
3. Read all JSONL lines, replace `"cwd"` value in each
4. Write to target location atomically
5. Remove original file
6. Update source `sessions-index.json` (remove entry for sessionId)

**Encoding:** `/Users/mayankw/Projects/repo` → `Users-mayankwDocuments-Projectsrepo`

---

#### **DependencyChecker.swift** (Enum)
**Purpose:** Check availability of all external dependencies

**Struct: Status (Sendable)**
```
claudeAvailable: Bool
geminiAvailable: Bool
hooksInstalled: Bool
pandocAvailable: Bool
wkhtmltoimageAvailable: Bool
pushoverConfigured: Bool
ghAvailable: Bool
ghAuthenticated: Bool
tmuxAvailable: Bool
mutagenAvailable: Bool
assistantHooks: [CodingAssistant: Bool]
```

**Public Method:**
- `checkAll(settingsStore: SettingsStore) async -> Status` — Concurrent checks via async/await

**Checks Performed (concurrent via `async let`):**
- `ShellCommand.isAvailable("claude")` / `"gemini"`
- `ShellCommand.isAvailable("pandoc")` / `"wkhtmltoimage"` / `"gh"` / `"tmux"` / `"mutagen"`
- `checkGhAuth()` — Run `gh auth status` (exit code 0 = authenticated)
- `HookManager.isInstalled(for: assistant)` — For each CodingAssistant
- Pushover configured: Check settings file for token/userKey, verify both non-empty + enabled flag

---

### 3. DOMAIN LAYER: Core Data Models

#### **Link.swift** (Main Card Entity)
**Purpose:** Coordination record representing a card on the Kanban board, stored in `links.json`

**Card-Level Properties:**
- `id: String` — KSUID with "card" prefix (Identifiable)
- `name: String?` — Manual card title
- `projectPath: String?` — Project where work happens
- `column: KanbanCodeColumn` — Current board column
- `createdAt / updatedAt / lastActivity / lastOpenedAt: Date`
- `manualOverrides: ManualOverrides` — Track user-set fields
- `manuallyArchived: Bool` — User manually archived
- `source: LinkSource` — How card was created (discovered/hook/github_issue/manual)
- `promptBody: String?` / `promptImagePaths: [String]?` — Queued prompt
- `isRemote: Bool` — Project uses remote execution
- `isLaunching: Bool?` — Prevents background reconciliation mid-launch
- `sortOrder: Int?` — Manual sort within column
- `assistant: CodingAssistant?` — Which assistant (default .claude for backward-compat)

**Typed Links (independently optional):**
```
sessionLink: SessionLink? {
  sessionId: String (UUID)
  sessionPath: String? (full path to .jsonl)
  sessionNumber: Int? (display number)
}

tmuxLink: TmuxLink? {
  sessionName: String (primary session)
  extraSessions: [String]? (user-created shells)
  tabNames: [String: String]? (sessionName → display label)
  isShellOnly: Bool? (true if plain shell, not Claude)
  isPrimaryDead: Bool? (primary killed but extras survive)
  allSessionNames: [String] (computed: primary + extras)
  terminalCount: Int (computed)
}

worktreeLink: WorktreeLink? {
  path: String (git worktree directory)
  branch: String? (checked-out branch name)
}

prLinks: [PRLink] (multiple PRs, new format)
  number: Int
  url, status: PRStatus?, unresolvedThreads: Int?
  title, body, approvalCount: Int?
  checkRuns: [CheckRun]?
  firstUnresolvedThreadURL, mergeStateStatus: String?

issueLink: IssueLink? {
  number: Int
  url, body, title: String?
}

queuedPrompts: [QueuedPrompt]? {
  id: String (KSUID with "prompt" prefix)
  body: String
  sendAutomatically: Bool
  imagePaths: [String]?
}

discoveredBranches: [String]? (branches scanned from .jsonl)
discoveredRepos: [String: String]? (branch → git repo root if different)
```

**Computed Properties:**
- `displayTitle: String` — Priority: name → promptBody → branch → PR title → sessionId
- `prLink: PRLink?` — First PR (backward-compat)
- `mergeablePR: PRLink?` — Single open PR, or nil if 0 or 2+
- `worstPRStatus: PRStatus?` — Minimum status (highest urgency)
- `allPRsDone: Bool` — All PRs merged or closed
- `cardLabel: CardLabel` — Primary link type: .session / .worktree / .issue / .pr / .task
- `effectiveAssistant: CodingAssistant` — Never nil (defaults to .claude)

**Backward-Compat Computed Properties:**
```
sessionId, sessionPath, sessionNumber (from sessionLink)
tmuxSession (from tmuxLink?.sessionName)
worktreePath, worktreeBranch (from worktreeLink)
githubIssue (from issueLink?.number)
githubPR (from prLinks.first?.number)
issueBody (from issueLink?.body ?? promptBody)
```

**Merge Validation:**
- `mergeBlocked(source, target) -> String?` — Returns error message if merge unsafe
  - Can't merge with itself
  - Can't merge two sessions / two terminals / different issues / different worktrees

**ManualOverrides struct (Codable):**
```
worktreePath, tmuxSession, name, column, prLink, issueLink: Bool
dismissedPRs: [Int]? (user dismissed specific PR numbers)
branchWatermark: Int? (byte offset in JSONL for branch discovery)
isBranchDiscoveryBlocked: Bool (computed: true if watermark set or legacy worktreePath)
isPRDismissed(number: Int) -> Bool (check dismissedPRs or legacy prLink)
```

**LinkSource enum:**
- `.discovered` — Found via session scanning
- `.hook` — Created via Claude hook event
- `.githubIssue` — Created from GitHub issue
- `.manual` — User-created task

**Backward-Compatible Codable:**
- Old flat format: `sessionId`, `sessionPath`, `tmuxSession`, `worktreePath`, `worktreeBranch`, `githubPR`
- New nested format: `sessionLink`, `tmuxLink`, `worktreeLink`, `prLinks`, `issueLink`
- On decode: tries nested first, falls back to flat
- On encode: always writes nested format (forward migration)

**ConversationTurn struct (for history/checkpoint):**
```
index, lineNumber: Int
role: String ("user" or "assistant")
textPreview: String
timestamp: String?
contentBlocks: [ContentBlock]
```

**ContentBlock.Kind enum:**
- `.text` — Text content
- `.toolUse(name, input)` — Tool call
- `.toolResult(toolName?)` — Tool result
- `.thinking` — Claude thinking blocks

---

#### **Session.swift**
**Purpose:** Discovered coding assistant session extracted from session files

**Properties:**
- `id: String` — Session UUID
- `name: String?` — Custom name or auto-summary
- `firstPrompt: String?` — First user message
- `projectPath: String?` — Decoded project directory
- `gitBranch: String?` — Git branch if in worktree
- `messageCount: Int` — Message count
- `modifiedTime: Date` — File mtime
- `jsonlPath: String?` — Full path to session file
- `assistant: CodingAssistant` — Which assistant

**Computed:**
- `displayTitle: String` — Priority: custom name → first prompt → session ID prefix

---

#### **CodingAssistant.swift** (Enum: claude, gemini)

**Properties per Assistant:**
```
case .claude: displayName="Claude Code", cliCommand="claude", promptCharacter="❯"
case .gemini: displayName="Gemini CLI", cliCommand="gemini", promptCharacter="Type your message"
```

**Feature Flags:**
```
.claude: supportsWorktree=true, supportsImageUpload=true
.gemini: supportsWorktree=false, supportsImageUpload=false
```

**CLI Flags:**
```
.claude: autoApproveFlag="--dangerously-skip-permissions", resumeFlag="--resume"
.gemini: autoApproveFlag="--yolo", resumeFlag="--resume"
```

**Config:**
```
.claude: configDirName=".claude", historyPromptSymbol="❯"
.gemini: configDirName=".gemini", historyPromptSymbol="✦"
```

**Install:**
```
.claude: "npm install -g @anthropic-ai/claude-code"
.gemini: "npm install -g @google/gemini-cli"
```

---

#### **Project.swift**
**Purpose:** Configured repository that Kanban tracks

**Properties:**
- `path: String` — Project directory (where Claude runs)
- `name: String` — Display name
- `repoRoot: String?` — Git root if different from path
- `visible: Bool` — Show in UI
- `githubFilter: String?` — Per-project `gh` filter (inherits global if nil)
- `promptTemplate: String?` — Per-project template (inherits global if nil)
- `githubIssuePromptTemplate: String?` — Per-project issue template

**Computed:**
- `id: String { path }` — Identifiable
- `effectiveRepoRoot: String` — `repoRoot ?? path`

---

#### **KanbanCodeColumn.swift** (Enum)
**Columns (display order):**
1. `.backlog` → "Backlog"
2. `.inProgress` → "In Progress"
3. `.waiting` (raw: `"requires_attention"`) → "Waiting"
4. `.inReview` → "In Review"
5. `.done` → "Done"
6. `.allSessions` → "All Sessions"

**Computed:**
- `allowsBoardTaskCreation: Bool` — false for `.allSessions`, true for others

---

#### **ActivityState.swift** (Enum)
**States (priority 5→1):**
1. `.activelyWorking` (5) — Tools executing or generating
2. `.needsAttention` (4) — Stopped, awaiting input
3. `.idleWaiting` (3) — Running but no recent activity
4. `.ended` (2) — Process finished
5. `.stale` (1) — Old, no process/worktree/tmux

Used by CompositeActivityDetector to pick best state when multiple detectors report.

---

### 4. HOOK INTEGRATION SYSTEM

#### **hook.sh** (Bash Script)
**Location:** `/Scripts/hooks/hook.sh` → deployed to `~/.kanban-code/hook.sh`

**Input:** JSON on stdin from Claude Code hooks

**Fields Extracted:**
```
session_id / sessionId (fallback)
hook_event_name
transcript_path
```

**Output:** Append to `~/.kanban-code/hook-events.jsonl`

**Format:** `{"sessionId":"...","event":"...","timestamp":"ISO8601","transcriptPath":"..."}\n`

**Installation:** Add to `~/.claude/settings.json` under `hooks`:
```json
{
  "hooks": {
    "Stop": [{ "type": "command", "command": "~/.kanban-code/hook.sh" }],
    "Notification": [...],
    "SessionStart": [...],
    "SessionEnd": [...],
    "UserPromptSubmit": [...]
  }
}
```

---

#### **HookManager.swift** (Enum + Static)
**Purpose:** Install/uninstall/check hook integration for Claude Code and Gemini CLI

**Required Hooks per Assistant:**
```
.claude: ["Stop", "Notification", "SessionStart", "SessionEnd", "UserPromptSubmit"]
.gemini: ["AfterAgent", "Notification", "SessionStart", "SessionEnd", "BeforeAgent"]
```

**Event Name Normalization:**
- Gemini `AfterAgent` → `Stop`
- Gemini `BeforeAgent` → `UserPromptSubmit`

**Public Methods:**
- `requiredHooks(for: CodingAssistant) -> [String]` — Get event list
- `normalizeEventName(String) -> String` — Map Gemini → canonical names
- `isInstalled(for: CodingAssistant, settingsPath?) -> Bool` — Check if installed
- `install(for: CodingAssistant, settingsPath?, hookScriptPath?) throws` — Deploy hooks
- `uninstall(for: CodingAssistant, settingsPath?) throws` — Remove hooks

**Implementation:**
1. Deploy hook script to `~/.kanban-code/hook.sh` (mode 0o755)
2. Read existing `settings.json`
3. Add hook entries to each required event
4. Deduplicates on existing `.kanban-code/hook.sh` references
5. Write back atomically

---

#### **HookEventStore.swift** (Actor)
**Purpose:** Read and manage hook events from `~/.kanban-code/hook-events.jsonl`

**Properties:**
- `filePath: String` — Full path
- `lastReadOffset: UInt64` — Track file position for incremental reads

**Public Methods:**
- `readNewEvents() -> [HookEvent]` — Read since last offset
- `readAllEvents() -> [HookEvent]` — Reset offset, read all
- `var path: String`

**Algorithm (readNewEvents):**
1. Seek to `lastReadOffset`
2. Read remaining bytes
3. Update `lastReadOffset`
4. Parse JSONL lines, extract:
   - `sessionId` (required)
   - `event` (defaults to "unknown")
   - `transcriptPath`
   - `timestamp` (ISO8601, defaults to .now if parse fails)
5. Return `[HookEvent]`

---

### 5. ADAPTER LAYER: Session Management

#### **ClaudeCodeSessionStore.swift** (Final Class, SessionStore protocol)
**Purpose:** Implement SessionStore for Claude Code .jsonl files

**File Location:** `~/.claude/projects/{encoded-path}/{sessionId}.jsonl`

**Public Methods:**

1. **readTranscript(sessionPath) -> [ConversationTurn]**
   - Delegate to `TranscriptReader.readTurns()`

2. **forkSession(sessionPath, targetDirectory?) -> String**
   - Generate new UUID (sessionId)
   - Copy file to target or same directory
   - Replace all old sessionId references with new UUID
   - Preserve original mtime (prevents "active" flagging in 10-second window)
   - Return new sessionId

3. **writeSession(turns, sessionId, projectPath?) -> String**
   - Encode projectPath via `SessionFileMover.encodeProjectPath()`
   - Target: `~/.claude/projects/{encoded}/{sessionId}.jsonl`
   - Convert each `ConversationTurn` to JSONL format:
     - User message: `{"type":"user","sessionId":"...","message":{"role":"user","content":"..."}}`
     - Assistant message with tool calls: emit tool_use in content blocks, then separate user messages for tool_result
   - Tool name mapping: shell→Bash, readfile→Read, writefile→Write, editfile→Edit, glob→Glob, grep→Grep
   - Write atomically
   - Return file path

4. **truncateSession(sessionPath, afterTurn) -> void**
   - Backup to `.bkp`
   - Read lines up to `afterTurn.lineNumber`
   - Truncate file

5. **searchSessions(query, paths) -> [SearchResult]**
   - Batch wrapper around `searchSessionsStreaming`

6. **searchSessionsStreaming(query, paths, onResult) -> void**
   - BM25 full-text search with recency boost
   - Process each file streaming via FileHandle (never load entire file)
   - Extract matching tokens and snippets
   - Compute BM25 score with avgDocLength and docFreq
   - Yield results after each file processed (incremental)
   - Cancellation-aware via `Task.checkCancellation()`

---

#### **ClaudeCodeSessionDiscovery.swift** (Final Class, SessionDiscovery protocol)
**Purpose:** Discover Claude Code sessions by scanning `~/.claude/projects/`

**Caching Strategy:**
- Mtime-based directory cache (skip unchanged dirs)
- Per-file mtime cache (skip unchanged .jsonl)
- Merged with `sessions-index.json` metadata

**Public Method:**
- `discoverSessions() async -> [Session]`
  1. Scan `~/.claude/projects/` for subdirectories
  2. Check each dir's mtime against cache
  3. If unchanged, skip entirely
  4. If changed, re-scan all .jsonl files in that dir
  5. Read `sessions-index.json` for summaries (if present)
  6. For each .jsonl:
     - Check file mtime against cache
     - If file unchanged and cached Session exists, reuse + merge index metadata
     - Otherwise, parse metadata via `JsonlParser.extractMetadata()`
     - Merge with index entry (summary, projectPath)
  7. Evict sessions from dirs that were removed
  8. Filter to messageCount > 0
  9. Sort by modifiedTime (newest first)

---

### 6. FILE SYSTEM PATHS USED

**Core Paths:**
```
~/.kanban-code/
  ├── links.json                 # Coordination store (Link records)
  ├── settings.json              # User settings
  ├── hook.sh                    # Deployed hook script (mode 0755)
  ├── hook-events.jsonl          # Hook event log (append-only)
  └── logs/
      └── kanban-code.log        # Application log

~/.claude/projects/
  └── {encoded-path}/            # e.g., "Users-mayankw-Projects-repo"
      ├── sessions-index.json    # Session metadata/summaries
      └── {sessionId}.jsonl      # Claude Code conversation file
```

**Gemini (if enabled):**
```
~/.gemini/projects/
  └── {encoded-path}/
      └── {sessionId}.jsonl
```

**Claude Settings:**
```
~/.claude/settings.json           # Claude Code config (hooks installed here)
```

**Gemini Settings (if enabled):**
```
~/.gemini/settings.json           # Gemini CLI config
```

**Worktrees:**
```
{projectPath}/.git/worktrees/
```

**Tmux:**
```
/tmp/tmux-{uid}/S-{sessionName}   # Standard tmux socket
```

---

### 7. EXTERNAL INTEGRATIONS

**CLI Tools Checked:**
- `claude` / `gemini` — AI assistants (via ShellCommand.run)
- `gh` — GitHub CLI (with auth status check)
- `pandoc` — Document conversion
- `wkhtmltoimage` — HTML to image rendering
- `tmux` — Terminal multiplexing
- `mutagen` — File sync for remote

**Environment Injection:**
- ShellCommand resolves user's login shell environment (nvm, volta, fnm, etc.)
- Searches: `~/.claude/local`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, user PATH

**Git Integration:**
- Worktree discovery via git repo scanning
- Branch detection from Claude conversation (.jsonl parsing)
- Commit/push tracking

**GitHub Integration:**
- `gh pr` commands (status, merge, check runs)
- `gh issue` commands
- Per-project or global filter settings

**Notifications:**
- Pushover API (if configured with token + userKey)
- macOS native notifications
- Composite deduplicator

**File Sync:**
- Mutagen for remote project sync (optional per project)

---

### 8. THREADING & CONCURRENCY MODEL

**Actors (Isolated):**
- `CoordinationStore` — All Link operations serialized
- `SettingsStore` — All config reads/writes serialized
- `HookEventStore` — Incremental event reads

**Global State:**
- `ShellCommand.userEnvironment` — Static, computed once on first use
- `KanbanCodeLog.queue` — DispatchQueue.utility

**Async/Await:**
- `ShellCommand.run()` — Async, manages Process/pipes
- `DependencyChecker.checkAll()` — Concurrent via `async let`
- `SessionStore.readTranscript()`, `searchSessions()` — Async
- `SessionDiscovery.discoverSessions()` — Async

**Pipe Deadlock Prevention:**
- Always read stdout/stderr BEFORE waitUntilExit
- Pipes buffer ~64KB; reading after exit prevents hang

**MainActor Usage:**
- Session search results callback: `onResult: @MainActor @Sendable`
- Prevents off-thread UI updates

---

### 9. ERROR HANDLING & RECOVERY

**Corruption Recovery:**
- CoordinationStore: JSON parse error → back up to `.bkp`, return empty
- SettingsStore: File missing → create defaults

**Session Forking:**
- Preserves original mtime to avoid "active" flag (10-second window)

**Atomic Operations:**
- Write to `.tmp`, remove old, move new (rename-safe)
- Used by CoordinationStore, SettingsStore, ClaudeCodeSessionStore

**Truncation:**
- Backup to `.bkp` before modifying

**Search Cancellation:**
- `Task.checkCancellation()` every 100 lines in large files

---

### 10. BACKWARD COMPATIBILITY

**Link Schema Migration:**
- Old flat format: `sessionId`, `sessionPath`, `tmuxSession`, `worktreePath`, `worktreeBranch`, `githubPR`
- New nested format: `sessionLink`, `tmuxLink`, `worktreeLink`, `prLinks` (array), `issueLink`
- On decode: nested first, fallback to flat
- On encode: always nested (forward migration)

**Settings Migration:**
- Old key `"skill"` → new key `"promptTemplate"` (read as fallback)

**Assistants:**
- Default assistant: `.claude` if `assistant: nil` in Link

---

### 11. KEY FILE PATHS REFERENCE

| Path | Purpose | Owner |
|------|---------|-------|
| `~/. kanban-code/links.json` | Card coordination records | CoordinationStore |
| `~/.kanban-code/settings.json` | User config | SettingsStore |
| `~/.kanban-code/hook.sh` | Deployed hook script | HookManager |
| `~/.kanban-code/hook-events.jsonl` | Hook event log | HookEventStore |
| `~/.kanban-code/logs/kanban-code.log` | Application log | KanbanCodeLog |
| `~/.claude/projects/{encoded}/*.jsonl` | Claude session files | ClaudeCodeSessionStore/Discovery |
| `~/.gemini/projects/{encoded}/*.jsonl` | Gemini session files | GeminiSessionStore/Discovery |
| `~/.claude/settings.json` | Claude hooks config | HookManager |
| `~/.gemini/settings.json` | Gemini hooks config | HookManager (if enabled) |

---

### 12. NOTABLE ARCHITECTURAL PATTERNS

**Pattern 1: Actor Isolation**
- CoordinationStore, SettingsStore, HookEventStore are Actors
- Ensures serial access, no race conditions
- All mutations go through single actor

**Pattern 2: Mtime-Based Caching**
- SettingsStore: Check file mtime, return cached if unchanged
- ClaudeCodeSessionDiscovery: Directory mtime + per-file mtime
- Avoids re-parsing unchanged data

**Pattern 3: Backward-Compatible Codable**
- Custom `init(from:)` and `encode(to:)` in Link
- Reads old flat format, writes new nested format
- Computed properties bridge old accessors to new structure

**Pattern 4: Atomic File Operations**
- Write to `.tmp`, remove old, move new (rename-safe)
- Prevents partial writes or corruption on crash

**Pattern 5: Environment Injection for .app Bundles**
- Resolve user's login shell environment once
- Inject into all subprocesses (fixes tmux socket mismatch, missing binaries)

**Pattern 6: Streaming Search with Cancellation**
- Never load entire large .jsonl into memory
- FileHandle.bytes.lines for incremental processing
- Task.checkCancellation() for responsiveness

**Pattern 7: Hook Event Streaming**
- Incremental reads via lastReadOffset
- JSONL format (append-only)
- Fire-and-forget deployment + installation

---

### 13. ACTIVE SESSION MARKER APP

**File:** `/Sources/KanbanCodeActiveSession/main.swift`

**Purpose:** Invisible background-only app that runs when Claude sessions are active

**How It Works:**
1. `let app = NSApplication.shared`
2. `app.run()` — Handles SIGTERM/terminate() properly
3. LSUIElement in Info.plist keeps it out of Dock
4. Tools like Amphetamine can detect it in Activity Monitor
5. Kanban Code launches this .app bundle when Claude sessions are active

---

### SUMMARY

**Kanban Code** is a sophisticated session coordination system for Claude Code and Gemini CLI:

1. **Domain-Driven Design:** Pure domain layer (Link, Session, Project, etc.) with clean ports/adapters
2. **Persistent State:** Three main stores (CoordinationStore, SettingsStore, HookEventStore) backed by atomic file operations
3. **Multi-Assistant Support:** Extensible to Claude Code and Gemini CLI via CodingAssistant enum + adapter pattern
4. **Hook-Based Integration:** Bash hook script + Claude settings injection for event streaming
5. **Session Discovery:** Efficient mtime-based incremental scanning + BM25 full-text search
6. **Backward Compatibility:** Nested structured data with graceful fallbacks to old flat format
7. **Concurrency:** Actors for isolated state, async/await for I/O, proper pipe handling
8. **Recovery:** Corruption backup, atomic writes, mtime preservation for forked sessions

All code is in `/Sources/KanbanCodeCore/`, fully testable, with no UI dependencies.

---

# Complete Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          External World                                  │
│  Claude Code ←→ Hooks → hook.sh → hook-events.jsonl → HookEventStore    │
│  Gemini CLI  ←→ File polling (mtime-based)                               │
│  GitHub      ←→ gh CLI → GhCliAdapter (batch PR list + GraphQL enrich)   │
│  Git         ←→ git CLI → GitWorktreeAdapter (porcelain parsing)         │
│  tmux        ←→ tmux CLI → TmuxAdapter (send-keys, capture-pane)         │
│  Remote SSH  ←→ RemoteShellManager (293-line bash script)                │
│  Mutagen     ←→ MutagenAdapter (label-based sync sessions)               │
│  Pushover    ←→ HTTP POST → PushoverClient (multipart form-data)         │
│  macOS       ←→ UserNotifications → MacOSNotificationClient              │
│  Amphetamine ←→ KanbanCodeActiveSession (helper .app bundle)             │
│  pandoc+wkhtmltoimage → MarkdownImageRenderer (dark-theme PNG)           │
└───────────────────────────┬──────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                KanbanCodeCore (Pure Swift Library)                        │
│                                                                          │
│  ┌─ Adapters (Protocol Implementations) ─────────────────────────────┐   │
│  │  Claude: SessionStore, SessionDiscovery, ActivityDetector         │   │
│  │  Gemini: SessionStore, SessionDiscovery, ActivityDetector         │   │
│  │  Tmux: TmuxManagerPort                                           │   │
│  │  Git: WorktreeManagerPort, PRTrackerPort, GitRemoteResolver       │   │
│  │  Sync: SyncManagerPort (Mutagen)                                  │   │
│  │  Notifications: NotifierPort (Pushover + macOS + Composite)       │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                            │                                             │
│                            ▼                                             │
│  ┌─ Use Cases ───────────────────────────────────────────────────────┐   │
│  │  CompositeSessionDiscovery → merge all sources by mtime          │   │
│  │  CompositeActivityDetector → route hooks + poll, highest priority │   │
│  │  CodingAssistantRegistry  → map assistant → adapters             │   │
│  │  CardReconciler           → 5-phase match/merge/dedup            │   │
│  │  BackgroundOrchestrator   → 5s tick loop + hook event processing │   │
│  │  PromptBuilder            → template interpolation               │   │
│  │  ImageSender              → clipboard + bracketed paste          │   │
│  │  BM25Scorer               → full-text search scoring             │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                            │                                             │
│                            ▼                                             │
│  ┌─ State Management ────────────────────────────────────────────────┐   │
│  │  store.dispatch(.reconciled(result))                              │   │
│  │       │                                                           │   │
│  │       ▼                                                           │   │
│  │  Reducer.reduce(state, action) → (state', effects)                │   │
│  │       │                    │                                      │   │
│  │       ▼                    ▼                                      │   │
│  │  AppState mutated    EffectHandler (actor)                        │   │
│  │  (@Observable)       → CoordinationStore (atomic disk I/O)        │   │
│  │                      → TmuxAdapter (session lifecycle)            │   │
│  │                      → FileManager (cleanup)                      │   │
│  │                      → SessionIndexReader (summary updates)       │   │
│  │                      → ImageSender (clipboard paste)              │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─ Infrastructure ──────────────────────────────────────────────────┐   │
│  │  CoordinationStore (actor) → ~/.kanban-code/links.json            │   │
│  │  SettingsStore (actor)     → ~/.kanban-code/settings.json         │   │
│  │  HookEventStore (actor)    → ~/.kanban-code/hook-events.jsonl     │   │
│  │  ShellCommand              → user env injection, 7 search paths   │   │
│  │  KSUID                     → time-sortable card IDs               │   │
│  │  KanbanCodeLog             → ~/.kanban-code/logs/kanban-code.log  │   │
│  └───────────────────────────────────────────────────────────────────┘   │
└───────────────────────────┬──────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                KanbanCode (SwiftUI App Layer)                             │
│                                                                          │
│  App.swift → ContentView ─┬─→ BoardView / ListBoardView                 │
│                           │     └─→ ColumnView → CardView                │
│                           │                                              │
│                           ├─→ CardDetailView                             │
│                           │     ├─→ Terminal (BatchedTerminalView)        │
│                           │     ├─→ History (SessionHistoryView)         │
│                           │     ├─→ Issue / PR (MarkdownUI)              │
│                           │     └─→ Prompt (read-only)                   │
│                           │                                              │
│                           ├─→ SearchOverlay (command palette + BM25)     │
│                           ├─→ NewTaskDialog / LaunchConfirmationDialog   │
│                           ├─→ QueuedPromptsBar / QueuedPromptDialog      │
│                           ├─→ SettingsView / OnboardingWizard            │
│                           └─→ SystemTray (NSStatusItem)                  │
│                                                                          │
│  All views read from BoardStore.state, dispatch actions — never mutate   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

# File System Paths Reference

| Path | Purpose | Owner |
|------|---------|-------|
| `~/.kanban-code/links.json` | Card coordination records | CoordinationStore |
| `~/.kanban-code/links.json.tmp` | Atomic write temp file | CoordinationStore |
| `~/.kanban-code/links.json.lock` | File locking | CoordinationStore |
| `~/.kanban-code/links.json.bkp` | Corruption backup | CoordinationStore |
| `~/.kanban-code/settings.json` | User configuration | SettingsStore |
| `~/.kanban-code/hook.sh` | Hook handler script (0755) | HookManager |
| `~/.kanban-code/hook-events.jsonl` | Hook event log (append-only) | HookEventStore |
| `~/.kanban-code/logs/kanban-code.log` | Application log | KanbanCodeLog |
| `~/.kanban-code/images/{id}.png` | Persistent image attachments | ImageAttachment |
| `~/.kanban-code/remote/` | Remote shell scripts + symlinks | RemoteShellManager |
| `~/.kanban-code/remote/remote-shell.sh` | SSH command interceptor | RemoteShellManager |
| `~/.kanban-code/remote/zsh` | Symlink to remote-shell.sh | RemoteShellManager |
| `~/.kanban-code/remote/status-<host>.json` | Remote host online/offline state | RemoteStatusWatcher |
| `~/.claude/projects/<encoded>/*.jsonl` | Claude session transcripts | ClaudeCodeSessionStore |
| `~/.claude/projects/<encoded>/sessions-index.json` | Session metadata/summaries | SessionIndexReader |
| `~/.claude/settings.json` | Claude Code hooks config | HookManager |
| `~/.gemini/projects.json` | Gemini slug→path mapping | GeminiSessionDiscovery |
| `~/.gemini/tmp/<slug>/chats/session-*.json` | Gemini session files | GeminiSessionStore |
| `~/.gemini-latest/settings.json` | Gemini CLI hooks config | HookManager |
| `/tmp/kanban-code-launch-<name>.sh` | Multi-line tmux launch scripts | TmuxAdapter |
| `/tmp/kanban-code-img-{id}.png` | Transient image attachments | ImageAttachment |
| `$TMPDIR/kanban-code-<id>.html` | Markdown render temp HTML | MarkdownImageRenderer |
| `$TMPDIR/kanban-code-<id>.png` | Markdown render temp PNG | MarkdownImageRenderer |
| `~/Library/Logs/DiagnosticReports/KanbanCode-*.ips` | macOS crash reports | System |

---

# External Shell Commands Used

| Tool | Commands | Adapter |
|------|----------|---------|
| **tmux** | `list-sessions`, `has-session`, `new-session`, `send-keys`, `kill-session`, `capture-pane`, `load-buffer`, `paste-buffer` | TmuxAdapter |
| **git** | `worktree list --porcelain`, `worktree add`, `worktree remove`, `remote get-url origin` | GitWorktreeAdapter, GitRemoteResolver |
| **gh** | `pr list`, `api graphql`, `pr view`, `auth status`, `search issues`, `pr merge`, `repo view` | GhCliAdapter |
| **mutagen** | `sync create`, `sync list`, `sync pause`, `sync resume`, `sync terminate`, `sync flush` | MutagenAdapter |
| **pandoc** | `-f gfm -t html` (stdin) | MarkdownImageRenderer |
| **wkhtmltoimage** | `--quality 90 --width 600` | MarkdownImageRenderer |
| **ssh** | `-O check`, ControlMaster=auto | remote-shell.sh |

---

# Test Coverage

38 test files covering every subsystem:

| Test File | What it covers |
|-----------|---------------|
| `ReducerTests.swift` | Pure reducer logic (no disk/async) |
| `CardLifecycleTests.swift` | Full card state transitions |
| `CardReconcilerTests.swift` | Orphan dedup, matching strategies |
| `ActivityDetectorTests.swift` | Hook + polling activity detection |
| `SessionDiscoveryTests.swift` | Claude session scanning |
| `Gemini/GeminiSessionStoreTests.swift` | Gemini transcript reading |
| `Gemini/GeminiSessionDiscoveryTests.swift` | Gemini session scanning |
| `Gemini/GeminiSessionParserTests.swift` | Gemini JSON format parsing |
| `Gemini/GeminiIntegrationTests.swift` | End-to-end Gemini flow |
| `Gemini/GeminiActivityDetectorTests.swift` | Gemini activity polling |
| `BM25Tests.swift` | Search scoring algorithm |
| `JsonlParserTests.swift` | JSONL metadata extraction |
| `WorktreeParserTests.swift` | Git worktree list parsing |
| `NotificationDedupTests.swift` | 62-second dedup window |
| `HookManagerTests.swift` | Hook install/uninstall/detection |
| `MultiAssistant/CodingAssistantTests.swift` | Assistant enum properties |
| `MultiAssistant/RegistryTests.swift` | Registry lookup/registration |
| `MultiAssistant/ImageSenderMultiAssistantTests.swift` | Image send per-assistant |
| `MultiAssistant/PaneOutputParserMultiAssistantTests.swift` | Ready detection per-assistant |
| `MultiAssistant/LinkAssistantCodableTests.swift` | JSON round-trip with assistant |
| `MultiAssistant/LaunchSessionMultiAssistantTests.swift` | Launch command construction |
| `SettingsStoreTests.swift` | Settings CRUD + caching |
| `EntityTests.swift` | Domain entity properties |
| `CoordinationStoreTests.swift` | Link persistence + corruption |
| `AssignColumnTests.swift` | Column assignment logic |
| `PromptBuilderTests.swift` | Template interpolation |
| `LaunchFlowIntegrationTests.swift` | End-to-end launch flow |
| `BoardStateIntegrationTests.swift` | Legacy board state (regression) |
| `SessionOperationsTests.swift` | Fork, checkpoint, rename |
| `ImagePasteTests.swift` | Image attachment handling |
| `GitRemoteResolverTests.swift` | Git URL parsing |
| `TmuxMatchingTests.swift` | Tmux session matching logic |
| `ProjectDiscoveryTests.swift` | Unconfigured path detection |
| `TranscriptReaderTests.swift` | JSONL turn parsing |
| `KanbanCodeCardTests.swift` | Card display model |
| `BoardViewModeTests.swift` | Kanban/list mode toggle |
| `CardDropIntentTests.swift` | Drag-drop validation |
| `KanbanCodeCoreTests.swift` | Core library smoke tests |

---

# Architectural Patterns Summary

| Pattern | Where Applied | Why |
|---------|--------------|-----|
| **Elm/Redux Store** | BoardStore.swift | Serialize all mutations through pure reducer, eliminate race conditions |
| **Port/Adapter** | 9 protocols in Domain/Ports/ | Decouple domain from external integrations |
| **Actor Isolation** | CoordinationStore, SettingsStore, HookEventStore, ImageSender | Serial access, no interleaving |
| **KSUID** | Card IDs | Time-sortable without database |
| **Atomic File Writes** | .tmp → rename pattern | Prevent corruption on crash |
| **Mtime Caching** | SessionDiscovery, SettingsStore | Avoid re-parsing unchanged files |
| **Streaming I/O** | JsonlParser, TranscriptReader, BM25 search | Never load entire .jsonl into memory |
| **Orphan Absorption** | CardReconciler + Reducer (dual) | Last line of defense against duplicate cards |
| **isLaunching Guard** | Link.isLaunching + Reducer | Prevent reconciler from overriding mid-launch state |
| **Composite Pattern** | CompositeNotifier, CompositeSessionDiscovery, CompositeActivityDetector | Multi-source aggregation with graceful failure |
| **Event Timestamp Dedup** | NotificationDeduplicator | Batch-safe deduplication using hook event times, not wall clock |
| **Backward-Compatible Codable** | Link.init(from:) | Read old flat format, write new nested format |
| **Progressive Enhancement** | DependencyChecker | Every external tool is optional; features degrade gracefully |

---

**Total scope**: ~100 Swift source files, 50+ spec files, 38 test files, covering 33 distinct features with a clean Elm-like architecture, multi-assistant support, and extensive edge case handling. This is a production-grade macOS app with impressive architectural discipline for a single-team project.

--- Document complete ---
