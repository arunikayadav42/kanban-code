# Kanban Code → Web Application: Feature Parity Analysis

> **Status:** ✅ **COMPLETED & IMPLEMENTED**
> This analysis served as the blueprint for the web port. All recommended features have been implemented in the Node.js/React stack.

## TL;DR

**Yes, almost every feature can be kept as-is.** Terminal sessions resume, history tabs, prompt tabs, activity tracking, image paste — all of it works in a web context. The project already has a working proof-of-concept in `windows/` (Tauri 2 + React + xterm.js). The only features that truly cannot exist in a pure browser app are system tray and Amphetamine sleep prevention. Everything else has full or near-full parity.

---

## Architecture Options

| Approach | Terminal Access | System Tray | Offline | Complexity |
|----------|---------------|-------------|---------|------------|
| **A. Pure Web App (SPA + Backend)** | Backend PTY → WebSocket → xterm.js | No | No | Medium |
| **B. Electron** | node-pty direct | Yes | Yes | High (bundle size) |
| **C. Tauri** (already exists in `windows/`) | tauri-pty → xterm.js | Yes | Yes | Medium |
| **D. Web App + Local Agent** | Agent manages PTY, WebSocket to browser | Possible (agent) | Partial | Medium-High |
| **E. PWA + Local Agent** | Same as D, installable | Limited | Partial | Medium-High |

**Recommendation**: Approach A (pure web SPA + backend) for maximum reach, or extend the existing Tauri app (Approach C) for desktop parity. Approach D is the sweet spot if you want browser-based UI with full system access.

---

## Terminal Technology Comparison

### xterm.js vs SwiftTerm (Current Native)

| Capability | SwiftTerm (macOS native) | xterm.js (web) | Parity |
|-----------|------------------------|----------------|--------|
| True color (24-bit) | Yes | Yes | Full |
| Unicode / emoji | Yes | Yes (unicode11 addon) | Full |
| Mouse events (click, scroll, drag) | Yes | Yes | Full |
| Alternate screen buffer | Yes | Yes | Full |
| Scrollback buffer | Yes | Yes (configurable, default 1000) | Full |
| Selection / copy | Yes | Yes | Full |
| Paste (including bracketed) | Yes | Yes | Full |
| Font ligatures | Yes | Yes (ligatures addon) | Full |
| GPU-accelerated rendering | Metal | WebGL (canvas addon) | Full |
| URL detection (Cmd+click) | Custom (NSBezierPath underline) | web-links addon | Full |
| Sixel / iTerm2 image protocol | No | Yes (image addon) | **Web is better** |
| Batched rendering (reduce redraws) | Custom BatchedTerminalView (8ms batch, 32KB/4ms budget) | Built-in (xterm.js batches internally) | Full |
| Color themes | Custom ANSI palette (16 colors + true color) | Theme object (same) | Full |
| Search within terminal | No built-in | search addon | **Web is better** |
| Serialize terminal state | No | serialize addon | **Web is better** |
| Resize handling | Manual frame calculation + SIGWINCH guard | FitAddon + ResizeObserver | Full |
| Copy-mode scrollback (tmux) | Custom NSEvent monitor + tmux copy-mode commands | Same approach via WebSocket commands | Full |

**Verdict: xterm.js has feature parity or better than SwiftTerm.** The existing Tauri Windows app already uses `@xterm/xterm` v6.0 with `addon-fit` and `addon-web-links`.

---

### Web Terminal Backend Options

| Technology | Language | How it works | Used by | Maturity |
|-----------|---------|-------------|---------|----------|
| **node-pty** (microsoft) | Node.js | Fork PTY, stream data via IPC | VS Code, Hyper, Tabby | Production (millions of users) |
| **tauri-pty** | Rust | PTY via Tauri plugin | Kanban Code Windows | Newer, used in this project |
| **creack/pty** | Go | Go PTY package | Gotty, many Go tools | Stable |
| **pty** (Python) | Python | Python PTY module | JupyterLab, Theia | Stable |
| **ttyd** | C | Standalone terminal-over-web server | Standalone deployments | Stable, simple |
| **Wetty** | Node.js | WebSocket terminal over SSH | Standalone deployments | Stable |

**For this project**: node-pty (Node.js backend) or creack/pty (Go backend) is the right choice. Both are battle-tested and support the exact pattern needed: spawn `tmux attach-session -t <name>` as a PTY process, stream data over WebSocket to xterm.js.

---

## Feature-by-Feature Parity Analysis

### Category 1: Terminal & Session Management (THE HARD PART)

| # | Feature | How it works in macOS | Web equivalent | Parity |
|---|---------|----------------------|----------------|--------|
| 1 | **Embedded terminal emulator** | SwiftTerm `LocalProcessTerminalView` | xterm.js + WebSocket + backend PTY (node-pty) | ✅ Full |
| 2 | **Connect to tmux session** | `terminal.startProcess(tmux attach-session -t <name>)` | Backend: `node-pty.spawn('tmux', ['attach-session', '-t', name])` → WebSocket → xterm.js | ✅ Full |
| 3 | **Terminal survives drawer close/reopen** | `TerminalCache` — detach NSView, keep process alive, reparent on reopen | WebSocket stays connected when tab hidden; or disconnect/reconnect (tmux preserves state) | ✅ Full |
| 4 | **Multi-tab terminals (Claude + extras)** | Multiple `BatchedTerminalView` in `TerminalContainerNSView`, show/hide by session name | Multiple xterm.js instances, show/hide divs, each with own WebSocket | ✅ Full |
| 5 | **Tmux session creation** | `TmuxAdapter.createSession()` → `tmux new-session -d -s <name>` | Backend: same `tmux new-session` command | ✅ Full |
| 6 | **Send prompt to tmux** | `tmux send-keys -t <name> <text> Enter` | Backend: same command via shell exec | ✅ Full |
| 7 | **Capture pane output** | `tmux capture-pane -p -t <name>` | Backend: same command | ✅ Full |
| 8 | **Bracketed paste (image send)** | `tmux load-buffer + paste-buffer -p` | Backend: same tmux commands | ✅ Full |
| 9 | **Session resume** | `claude --resume <id>` via tmux send-keys | Backend: same command via tmux | ✅ Full |
| 10 | **Session fork** | Copy .jsonl, replace UUIDs | Backend: same file operations | ✅ Full |
| 11 | **Session checkpoint** | Backup .jsonl → truncate at turn N | Backend: same file operations | ✅ Full |
| 12 | **Session history (transcript view)** | `TranscriptReader.readTail()` → SwiftUI list with markdown rendering | Backend API returns turns → React list with react-markdown | ✅ Full |
| 13 | **Shift+Enter → newline (not submit)** | NSEvent monitor intercepts keyDown in terminal | xterm.js `onKey` handler or `attachCustomKeyEventHandler` | ✅ Full |
| 14 | **Copy-mode scroll (tmux)** | NSEvent monitor for scrollWheel → `tmux copy-mode` + `cursor-up/down` | Wheel event listener → WebSocket command → backend tmux copy-mode | ✅ Full |
| 15 | **Terminal font size adjustment** | `NSFont.monospacedSystemFont(ofSize:)` + UserDefaults observer | xterm.js `options.fontSize` + localStorage | ✅ Full |
| 16 | **URL detection (Cmd+click)** | Custom regex + NSBezierPath underline + NSWorkspace.open | xterm.js `web-links` addon (built-in, better than native) | ✅ Full |
| 17 | **Kill tmux session** | `tmux kill-session -t <name>` | Backend: same command | ✅ Full |
| 18 | **Tmux session reuse (name conflict)** | `tmux has-session -t <name>` check before create | Backend: same check | ✅ Full |

### Category 2: Image Handling

| # | Feature | macOS | Web | Parity |
|---|---------|-------|-----|--------|
| 19 | **Image paste into prompt editor** | NSPasteboard → ImageAttachment → chips | Clipboard API `navigator.clipboard.read()` → blob → chips | ✅ Full |
| 20 | **Image send to Claude via terminal** | Set NSPasteboard → tmux bracketed paste → poll capture-pane for `[Image #N]` | Backend: write image to temp file → `tmux load-buffer` → `paste-buffer -p` → poll | ✅ Full |
| 21 | **Image chips display** | `ImageChipsView` (SwiftUI) | React component with thumbnails | ✅ Full |

### Category 3: Activity Detection & Hooks

| # | Feature | macOS | Web | Parity |
|---|---------|-------|-----|--------|
| 22 | **Hook installation** | `HookManager.install()` → write `~/.claude/settings.json` | Backend: same file operations | ✅ Full |
| 23 | **Hook event processing** | `HookEventStore` actor reads `hook-events.jsonl` incrementally | Backend: same file reading (fs.watch + incremental read) | ✅ Full |
| 24 | **Activity detection (hooks)** | `ClaudeCodeActivityDetector` actor — UserPromptSubmit/Stop/Notification events | Backend: same logic, push state to frontend via WebSocket/SSE | ✅ Full |
| 25 | **Activity detection (polling)** | File mtime checks on .jsonl files | Backend: same `fs.stat` checks | ✅ Full |
| 26 | **Ctrl+C interrupt detection** | Read last 4KB of .jsonl for `[Request interrupted by user]` | Backend: same file read | ✅ Full |
| 27 | **5-minute timeout** | Timer-based in activity detector | Backend: same timer logic | ✅ Full |

### Category 4: Kanban Board & Cards

| # | Feature | macOS | Web | Parity |
|---|---------|-------|-----|--------|
| 28 | **Six-column kanban board** | SwiftUI `BoardView` with `LazyVStack` per column | React with virtual scroll (react-virtuoso / tanstack-virtual) | ✅ Full |
| 29 | **List view mode** | `ListBoardView` with collapsible sections | React collapsible sections | ✅ Full |
| 30 | **Drag and drop** | Custom `DragState` + `ColumnDropDelegate` + `CardDropIntent` validation | dnd-kit (already used in Tauri Windows version) or react-beautiful-dnd | ✅ Full |
| 31 | **Card context menu** | Native NSMenu via `.contextMenu` | React context menu (right-click handler + portal menu) | ✅ Full |
| 32 | **Card detail panel (inspector)** | SwiftUI `.inspector()` side panel | Resizable side panel (CSS flex/grid) | ✅ Full |
| 33 | **Tabs (Terminal/History/Issue/PR/Prompt)** | SwiftUI TabView in CardDetailView | React tab component | ✅ Full |
| 34 | **PR badge with status colors** | `PRBadge` SwiftUI view | React component with CSS | ✅ Full |
| 35 | **GitHub-flavored markdown rendering** | MarkdownUI library | react-markdown + rehype-raw + remark-gfm | ✅ Full |
| 36 | **PR body lazy loading** | Fetch on tab open, cache per card selection | Same pattern (fetch on mount, state cache) | ✅ Full |

### Category 5: Search & Navigation

| # | Feature | macOS | Web | Parity |
|---|---------|-------|-----|--------|
| 37 | **Command palette (Cmd+K)** | `SearchOverlay` with live filter + deep search | kbar / cmdk / custom overlay | ✅ Full |
| 38 | **BM25 full-text search** | `BM25Scorer` + streaming .jsonl search | Backend: same algorithm, stream results via WebSocket/SSE | ✅ Full |
| 39 | **Live metadata filtering** | Substring match on card fields | Client-side filter (fuse.js already used in Tauri version) | ✅ Full |
| 40 | **Recent cards (lastOpenedAt ordering)** | Sort by `lastOpenedAt` with VS Code-style toggle | Same logic client-side | ✅ Full |

### Category 6: GitHub & Git Integration

| # | Feature | macOS | Web | Parity |
|---|---------|-------|-----|--------|
| 41 | **GitHub issue backlog** | `GhCliAdapter.fetchIssues()` via `gh search issues` | Backend: same CLI call | ✅ Full |
| 42 | **PR tracking (batch + GraphQL)** | `gh pr list` + `gh api graphql` batch enrichment | Backend: same CLI calls | ✅ Full |
| 43 | **Git worktree discovery** | `git worktree list --porcelain` parsing | Backend: same CLI call | ✅ Full |
| 44 | **Worktree cleanup** | `git worktree remove` | Backend: same CLI call | ✅ Full |
| 45 | **Branch discovery from conversation** | `JsonlParser.extractPushedBranches()` regex scan | Backend: same regex scan | ✅ Full |

### Category 7: Notifications

| # | Feature | macOS | Web | Parity |
|---|---------|-------|-----|--------|
| 46 | **Pushover push notifications** | `PushoverClient` HTTP POST | Backend: same HTTP POST | ✅ Full |
| 47 | **macOS native notifications** | `UNUserNotificationCenter` | Web Push API / Notification API | ⚠️ Requires permission, less reliable |
| 48 | **Notification dedup (62s window)** | `NotificationDeduplicator` actor | Backend: same dedup logic | ✅ Full |
| 49 | **Markdown image rendering** | pandoc → wkhtmltoimage pipeline | Backend: same pipeline, OR use headless Chrome/Puppeteer | ✅ Full |

### Category 8: Remote Execution

| # | Feature | macOS | Web | Parity |
|---|---------|-------|-----|--------|
| 50 | **Remote shell wrapper** | `RemoteShellManager` deploys bash script | Backend: same deployment | ✅ Full |
| 51 | **Mutagen file sync** | `MutagenAdapter` CLI wrapper | Backend: same CLI wrapper | ✅ Full |
| 52 | **Remote status monitoring** | `RemoteStatusWatcher` polls status files | Backend: same polling | ✅ Full |
| 53 | **Local fallback** | Automatic in bash script | Same — script logic is unchanged | ✅ Full |

### Category 9: Project & Settings Management

| # | Feature | macOS | Web | Parity |
|---|---------|-------|-----|--------|
| 54 | **Multi-project management** | `SettingsStore` actor | Backend: same file management | ✅ Full |
| 55 | **Settings hot-reload** | Mtime-based caching in actor | Backend: fs.watch + cache | ✅ Full |
| 56 | **Project auto-discovery** | `ProjectDiscovery` scans session paths | Backend: same scan | ✅ Full |
| 57 | **Prompt template system** | `PromptBuilder` template interpolation | Backend: same string interpolation | ✅ Full |
| 58 | **Onboarding wizard** | `OnboardingWizard` SwiftUI view | React step wizard | ✅ Full |
| 59 | **Dependency checker** | `DependencyChecker.checkAll()` concurrent checks | Backend: same checks | ✅ Full |

### Category 10: System Integration (THE ONLY GAPS)

| # | Feature | macOS | Web | Parity |
|---|---------|-------|-----|--------|
| 60 | **System tray (menu bar icon)** | `SystemTray` via NSStatusItem | ❌ Pure web: impossible. Electron/Tauri: yes | ❌ Web gap |
| 61 | **Amphetamine sleep prevention** | `KanbanCodeActiveSession` helper .app | ❌ Pure web: impossible. Could use `caffeinate` CLI from backend | ⚠️ Workaround |
| 62 | **Deep link URL scheme (kanbancode://)** | Info.plist CFBundleURLSchemes | Use regular HTTP URLs: `localhost:PORT/card/ID` (actually better) | ✅ Better in web |
| 63 | **Folder drop zone (add project)** | `FolderDropZone` NSView-based | HTML5 drag+drop for files (limited — can't get folder path from browser) | ⚠️ Needs file picker instead |
| 64 | **Keyboard shortcuts** | macOS native (Cmd+K, Cmd+N, etc.) | Web keyboard events — some conflict with browser shortcuts (Cmd+T, Cmd+N, Cmd+W) | ⚠️ Partial conflicts |
| 65 | **Liquid glass materials** | macOS 26 `.glassEffect` | CSS `backdrop-filter: blur()` + glassmorphism | ⚠️ Similar but not identical |
| 66 | **Window management (split view, full screen)** | Native macOS window | Browser window (responsive layout) | ⚠️ Different but functional |

---

## Parity Score

| Category | Features | Full Parity | Partial | No Parity |
|----------|----------|-------------|---------|-----------|
| Terminal & Sessions | 18 | **18** | 0 | 0 |
| Image Handling | 3 | **3** | 0 | 0 |
| Activity Detection | 6 | **6** | 0 | 0 |
| Kanban Board & Cards | 9 | **9** | 0 | 0 |
| Search & Navigation | 4 | **4** | 0 | 0 |
| GitHub & Git | 5 | **5** | 0 | 0 |
| Notifications | 4 | **3** | 1 | 0 |
| Remote Execution | 4 | **4** | 0 | 0 |
| Settings & Projects | 6 | **6** | 0 | 0 |
| System Integration | 7 | 1 | 4 | **2** |
| **TOTAL** | **66** | **59 (89%)** | **5 (8%)** | **2 (3%)** |

**89% full parity, 97% functional parity** (the 2 "no parity" features are system tray and Amphetamine — both cosmetic/convenience, not core functionality).

---

## The 2 True Gaps and Their Workarounds

### Gap 1: System Tray
- **Why it matters**: Shows active session count, quick access without switching to the app
- **Workaround A**: Browser tab favicon badge (shows notification count)
- **Workaround B**: Desktop notification with action buttons
- **Workaround C**: PWA installation gives app-like presence (but no true tray)
- **Workaround D**: Tiny companion CLI process (`kanban-code-agent`) that provides tray — web app communicates with it

### Gap 2: Amphetamine Sleep Prevention
- **Why it matters**: Mac sleeps during long Claude runs, interrupting work
- **Workaround A**: Backend runs `caffeinate -d -i -s` while sessions are active (same effect, no Amphetamine needed)
- **Workaround B**: Backend spawns `pmset noidle` process
- **Verdict**: Actually easier in web — backend directly prevents sleep without needing a helper .app bundle

---

## Recommended Web Stack

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (SPA)                         │
│                                                         │
│  React 19 + TypeScript                                  │
│  ├── xterm.js v6          (terminal emulator)           │
│  │   ├── @xterm/addon-fit                               │
│  │   ├── @xterm/addon-web-links                         │
│  │   ├── @xterm/addon-search                            │
│  │   └── @xterm/addon-canvas (GPU rendering)            │
│  ├── react-markdown       (GFM rendering)               │
│  ├── dnd-kit              (drag and drop)               │
│  ├── cmdk                 (command palette)              │
│  ├── zustand              (state management)            │
│  └── WebSocket            (terminal + real-time state)  │
│                                                         │
└──────────────────────┬──────────────────────────────────┘
                       │ WebSocket + REST API
                       ▼
┌─────────────────────────────────────────────────────────┐
│                 Backend (Node.js or Go)                  │
│                                                         │
│  ├── node-pty / creack/pty   (PTY management)           │
│  ├── WebSocket server        (terminal streams)         │
│  ├── REST API                (cards, sessions, PRs)     │
│  ├── fs.watch                (hook events, file changes) │
│  ├── child_process / exec    (tmux, git, gh, mutagen)   │
│  ├── caffeinate              (sleep prevention)          │
│  └── Same adapters as KanbanCodeCore:                   │
│       ├── Session discovery (scan ~/.claude/projects/)   │
│       ├── Activity detection (hooks + polling)           │
│       ├── Card reconciliation                           │
│       ├── PR tracking (gh CLI)                          │
│       ├── Worktree management (git CLI)                  │
│       ├── Notifications (Pushover + Web Push)            │
│       └── Remote execution (shell wrapper)               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## What Already Exists (Tauri Windows Version)

The project already has `windows/` with a working web-based implementation:

| Component | Technology | Status |
|-----------|-----------|--------|
| Terminal | `@xterm/xterm` v6 + `tauri-pty` + `addon-fit` + `addon-web-links` | Working |
| State | Zustand | Working |
| DnD | @dnd-kit/core + @dnd-kit/sortable | Working |
| Search | fuse.js | Working |
| UI | React 18 + Tailwind CSS | Working |
| Notifications | @tauri-apps/plugin-notification | Working |
| Shell commands | @tauri-apps/plugin-shell | Working |
| Backend | Rust (src-tauri/) | Working |

This is **95% of the work already done**. Converting to a pure web app primarily requires:
1. Replace `tauri-pty` → `node-pty` (or Go PTY) + WebSocket
2. Replace `@tauri-apps/plugin-shell` → backend REST API
3. Replace `@tauri-apps/plugin-dialog` → browser file picker
4. Add WebSocket server for terminal streaming + real-time state updates

---

## Terminal Session Lifecycle: Web vs Native (Side-by-Side)

### Launch a new Claude session

**Native (current):**
```
User clicks Start → LaunchConfirmationDialog → confirm
  → TmuxAdapter.createSession(name, path, command)
    → ShellCommand.run("tmux", ["new-session", "-d", "-s", name, "-c", path])
    → ShellCommand.run("tmux", ["send-keys", "-t", name, command, "Enter"])
  → TerminalCache.terminal(for: name)
    → BatchedTerminalView (SwiftTerm) runs `tmux attach-session -t <name>`
  → Card gains tmuxLink, moves to In Progress
```

**Web equivalent:**
```
User clicks Start → LaunchConfirmationDialog → confirm
  → POST /api/sessions/launch { name, path, command }
    → server: exec("tmux new-session -d -s ${name} -c ${path}")
    → server: exec("tmux send-keys -t ${name} ${command} Enter")
  → WebSocket: connect to /ws/terminal/${name}
    → server: node-pty.spawn("tmux", ["attach-session", "-t", name])
    → pipe PTY ↔ WebSocket ↔ xterm.js
  → Card gains tmuxLink, moves to In Progress (via WebSocket state push)
```

**Identical behavior.** The only difference is the transport layer (process ↔ NSView vs PTY ↔ WebSocket ↔ xterm.js).

### Resume a session

**Native:** `claude --resume <id>` via tmux send-keys → terminal attaches
**Web:** Same command via backend, same tmux session, WebSocket to xterm.js

### Fork a session

**Native:** Read .jsonl → replace UUIDs → write new file
**Web:** Same file operations on backend → return new session ID via API

### Checkpoint

**Native:** Backup .jsonl → truncate → refresh UI
**Web:** Same on backend → push update via WebSocket

### Image paste and send

**Native:**
1. NSPasteboard → image data → ImageAttachment
2. Set clipboard → tmux bracketed paste → poll capture-pane for `[Image #N]`

**Web:**
1. Clipboard API → blob → upload to backend
2. Backend writes temp file → `tmux load-buffer` → `paste-buffer -p` → poll capture-pane
3. Same confirmation logic

### Queued prompts auto-send

**Native:** BackgroundOrchestrator detects Stop → wait 2s → tmux send-keys
**Web:** Same logic in backend → same tmux send-keys

---

## Bottom Line

The terminal is NOT the blocker. xterm.js + node-pty over WebSocket is an industry-standard pattern used by VS Code Server (millions of users), GitHub Codespaces, Gitpod, JupyterLab, and Coder. Every single terminal feature — attach, detach, scrollback, multi-tab, image paste, Shift+Enter, copy-mode scroll — has a direct web equivalent.

The real question isn't "can it work?" but "which architecture?" — and the Tauri Windows version already answers that with a working React + xterm.js + Rust backend implementation.
