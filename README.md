<p align="center">
  <img src="assets/app-icon.png" width="128" height="128" alt="Kanban Code">
</p>

<h1 align="center">Kanban Code</h1>

<p align="center">
  <strong>A beautiful kanban board for managing AI coding agent sessions.</strong><br>
  Web app (React + Node.js) with Android companion (React Native). Supports Claude, Gemini CLI, and Kiro.
</p>

<p align="center">
  <a href="#installation">Installation</a> ·
  <a href="#features">Features</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#license">License</a>
</p>

---

![Kanban Code](assets/screenshot.webp)

## What is Kanban Code?

A web app for running multiple AI coding agents in parallel. Each task is a card on a Kanban board that automatically links your session, git worktree, tmux terminal, and GitHub PR together — cards flow from backlog to done as agents work, open PRs, and get them merged. Push notifications on your phone when agents need attention, remote execution to offload work to a server, and an Android companion app for monitoring on the go.

Kanban Code combines the lessons learned from [claude-resume](https://github.com/langwatch/claude-resume), [claude-remote](https://github.com/langwatch/claude-remote), [git-orchard](https://github.com/drewdrewthis/git-orchard), [claude-pushover](https://github.com/langwatch/claude-pushover), and [cc-amphetamine](https://github.com/rogeriochaves/cc-amphetamine) into one unified experience.

## Installation

### Web (Backend + Frontend)

Requires [Node.js](https://nodejs.org/) (v22+) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed.

```bash
git clone https://github.com/langwatch/kanban-code.git
cd kanban-code
bash setup.sh        # install dependencies
cd web && ./dev.sh   # start backend + frontend
```

Open http://localhost:5173 in your browser.

For remote/mobile access, bind to all interfaces:
```bash
cd web && HOST=0.0.0.0 ./dev.sh --backend
```

### Android

```bash
cd mobile
./setup-prereqs.sh       # one-time: Java, ADB, Android SDK
./build-apk.sh --install # build + install APK on connected device
```

On first launch, enter the backend URL (e.g., `http://192.168.1.5:3000`).

## Features

### Kanban Board with Smart Columns

Six columns that cards flow through automatically based on real activity signals:

| Column | What goes here |
|---|---|
| **Backlog** | GitHub issues, manual tasks, ideas waiting to start |
| **In Progress** | Claude is actively working (confirmed via hooks) |
| **Waiting** | Claude stopped, needs plan approval, or hit a permission prompt |
| **In Review** | PR is open, waiting for CI or code review |
| **Done** | PR merged, worktree ready to clean up |
| **All Sessions** | Archive of every past session, searchable |

Cards move between columns automatically. When Claude starts working, the card jumps to In Progress. When it stops and needs input, it moves to Waiting and sends you a push notification. When a PR opens, it shifts to In Review. You can always drag cards manually to override.

### Tmux Sessions & Embedded Terminal

Every Claude task runs inside a tmux session. This means you can always take control — attach from your own terminal, send input, inspect output, or just watch Claude work. Kanban Code manages the tmux lifecycle for you: creating sessions on launch, reattaching on resume, killing on archive.

Each card can have multiple terminals associated with it — Claude's main session plus any extra shells you spin up. Start a dev server for one worktree, a test watcher for another, and they all live on the right card. When you have ten Claude agents running across five projects, you can see every terminal for every task at a glance, without losing track of which server belongs to which branch.

Each card has an embedded terminal (powered by [xterm.js](https://xtermjs.org/)) that connects to the tmux session via WebSocket. True color, Unicode, mouse events, scrollback — the full terminal experience in your browser. If an agent is waiting for input, hit Resume and you're typing to it immediately. Terminal state persists as you navigate between cards. Browser-like text selection is supported (drag to select, right-click to copy). Or copy the `tmux attach` command to connect from your own terminal.

### Session Discovery, Search, Fork & Checkpoint

Kanban Code automatically discovers all your Claude Code sessions from `~/.claude/projects/`. Past sessions, active sessions, sessions you started from the terminal — they all show up.

**BM25 full-text search** lets you find any session across your entire history. Search by prompt, conversation content, or project name. Results are ranked by relevance with a recency boost.

**Fork** any session to branch off a new conversation with the same history — perfect for spinning up parallel tasks that share context, or exploring a different approach without losing your place. **Checkpoint** lets you roll back to any point in a conversation and continue from there. Both are dramatically faster than Claude Code's built-in equivalents, operating directly on the session files instead of going through the CLI.

### Git Worktree Integration

Start a task and Kanban Code can create a git worktree automatically, giving Claude its own isolated branch. The app tracks which worktree belongs to which card, discovers orphaned worktrees, and offers cleanup when you're done.

Cards created from GitHub issues get named worktrees (`issue-123`). Manual tasks get auto-generated names. You can also link existing worktrees to cards.

### Remote Execution

Offload Claude to a remote machine and run even more agents in parallel without melting your laptop. Kanban Code manages a shell wrapper that transparently intercepts commands and executes them over SSH, with [Mutagen](https://mutagen.io/) handling bidirectional file sync. Local paths are automatically translated to remote paths — Claude doesn't know it's running remotely.

The UI shows Mutagen sync status in real time. If the remote host goes offline, Kanban Code automatically falls back to local execution and notifies you. Configure it globally or per-project.

### GitHub PR Tracking

Once Claude pushes a branch, Kanban Code discovers the PR via `gh` CLI and tracks it on the card:

- PR status (draft, open, merged, closed)
- CI check runs with individual pass/fail status
- Review decision (approved, changes requested)
- Unresolved review thread count
- Lazy-loaded PR description

Multiple PRs per card are supported. Click to open in browser, or copy the link.

### GitHub Issue Backlog

Configure per-project GitHub issue filters (e.g. `assignee:@me label:bug`) and Kanban Code populates your backlog automatically. Issues become cards with the full issue body as context. Start working on one and Claude gets the issue description as its prompt.

### Push Notifications

Get notified on your phone — and your Apple Watch — when Claude needs attention, via [Pushover](https://pushover.net/). Notifications include a full summary of what Claude did, rendered as Markdown so you can read the last assistant response right from the lock screen. Multi-line responses are rendered as images for readability.

Smart deduplication prevents notification spam — rapid Stop events are collapsed, and duplicate notifications within 62 seconds are suppressed. Each notification includes the session number so you know which agent is calling.

Falls back to browser notifications if Pushover isn't configured. Just add your Pushover user key and API token in settings.

### Amphetamine Integration

When Claude agents are actively working, Kanban Code spawns a lightweight companion process that keeps [Amphetamine](https://apps.apple.com/app/amphetamine/id937984704) triggered — preventing your Mac from sleeping mid-task. The companion quits automatically when all agents are idle. No more waking up to find Claude was interrupted by sleep mode.

### Multi-Project Support

Configure multiple projects, each with its own GitHub filters, prompt templates, and repository settings. A global view combines everything — or focus on a single project. Exclude side projects from the global view to keep work and personal separate.

### Keyboard-First

- **⌘K** — Search sessions
- **⌘N** — New task
- Drag and drop between columns
- Context menus on every card

## Optional Dependencies

These unlock additional features. Kanban Code works without them — it's all progressive enhancement.

| Tool | What it enables |
|---|---|
| [`tmux`](https://github.com/tmux/tmux) | Embedded terminal, session persistence, launch/resume |
| [`gh`](https://cli.github.com/) | GitHub PR tracking, issue backlog import |
| [`mutagen`](https://mutagen.io/) | Remote execution with bidirectional file sync |
| [Amphetamine](https://apps.apple.com/app/amphetamine/id937984704) | Prevent Mac sleep while agents are working |
| [Pushover](https://pushover.net/) | Push notifications to phone and Apple Watch |

## Getting Started

### 1. First Launch

Kanban Code scans your `~/.claude/projects/` directory and discovers all existing sessions. They'll appear in the **All Sessions** column immediately.

### 2. Add a Project

Open Settings and add your project path (e.g., `~/Projects/my-app`). If it's a git repo with `gh` configured, Kanban Code will start pulling GitHub issues into your backlog.

### 3. Configure Hooks

Kanban Code uses [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) for real-time activity detection. On first launch, it offers to install them automatically. The hooks fire on:

- **Stop** — Claude finished or needs input
- **UserPromptSubmit** — User sent a message
- **Notification** — Claude raised a notification
- **SessionStart/End** — Session lifecycle

### 4. Start a Task

Click a card in the backlog and hit **Start**. Kanban Code will:

1. Optionally create a git worktree
2. Launch a tmux session
3. Start Claude with your prompt
4. Open the embedded terminal so you can watch

Or just start Claude yourself from your terminal — Kanban Code will discover the session and create a card for it.

### 5. Let it Flow

From here, cards move automatically. Claude working? In Progress. Claude stopped? Waiting (+ notification). PR opened? In Review. PR merged? Done. Clean up the worktree and it's archived.

## Configuration

Settings are stored in `~/.kanban-code/settings.json` — human-readable, version-controllable.

```jsonc
{
  "projects": [
    {
      "path": "/Users/you/Projects/my-app",
      "github": {
        "issueFilters": "assignee:@me state:open"
      }
    }
  ],
  "globalView": {
    "excludedPaths": ["/Users/you/Projects/side-project"]
  },
  "pushover": {
    "userKey": "your-key",
    "apiToken": "your-token"
  }
}
```

Card coordination lives in `~/.kanban-code/links.json` — the single source of truth linking sessions, worktrees, tmux sessions, and PRs together. You can inspect and edit it directly if needed.

## Architecture

Kanban Code follows **Clean Architecture** with an Elm-inspired unidirectional data flow:

```
User Action → dispatch(Action) → Reducer(State, Action) → (State', [Effect])
                                                              ↓          ↓
                                                           React UI   EffectHandler
                                                           re-render  (async I/O)
```

All state lives in a single store. All mutations go through the dispatcher. Side effects (disk, network, tmux) are executed by the `EffectHandler`. Views never mutate state directly. The web client and mobile app receive updates via Server-Sent Events (SSE).

### Project Structure

```
web/
├── shared/                      # @kanban-code/shared — TypeScript types
│   └── src/types/               # Link, Session, Column, PR, Activity, API types
├── server/                      # Node.js + Express backend
│   ├── adapters/                # Claude, Gemini, Kiro, git, tmux, notifications
│   ├── domain/ports/            # Protocol interfaces (adapter pattern)
│   ├── usecases/                # BoardStore, CardReconciler, LaunchSession, BM25
│   ├── infrastructure/          # CoordinationStore, KSUID, SettingsStore
│   ├── routes/                  # REST API (cards, system, search)
│   └── plugins/                 # Assistant plugin registry
├── client/                      # React + Vite + Tailwind frontend
│   ├── components/              # BoardView, CardDetailView, SearchOverlay, etc.
│   ├── hooks/                   # useSSE, useTerminal, useKeyboardShortcuts
│   └── store/                   # Zustand state management
mobile/                          # React Native (Expo) Android app
├── src/screens/                 # Board, Search, Settings, CardDetail
├── src/components/              # CardItem, TerminalSheet, NewTaskSheet, FilterBar
└── src/utils/                   # Theme system, colors, time formatting
```

The server uses **port/adapter** pattern — all external integrations (Claude Code, Gemini, Kiro, git, tmux, GitHub, Pushover) are behind protocol interfaces.

### Key Design Decisions

**Card as first-class entity.** A card can independently have (or not have) a session, worktree, tmux terminal, PR, and issue link. These are all optional typed sub-structs on the `Link` model. This prevents the "triplication bug" where the same work appears as three different cards.

**Reconciler, not poller.** Background reconciliation discovers external resources (sessions, worktrees, PRs) and merges them with existing cards using a matching algorithm (session ID → branch name → project path). New cards are only created for truly unmatched resources.

**In-memory state is truth.** The app uses in-memory state as the source of truth during reconciliation, not disk. Disk reads race with async writes — in-memory state eliminates that class of bugs.

**KSUID for card IDs.** Time-sortable unique IDs (`card_2MtCMwXZOHPSlEMDe7OYW6bRfXX`) that sort chronologically without a database.

## Contributing

Kanban Code is open source under the AGPLv3 license. Contributions are welcome.

```bash
# Setup
bash setup.sh

# Run web (backend + frontend)
cd web && ./dev.sh

# Build mobile APK
cd mobile && ./build-apk.sh --install
```

The spec files in `spec/` document every feature and edge case in detail.

## License

[AGPLv3](LICENSE) — Kanban Code is free software. You can use, modify, and distribute it under the terms of the GNU Affero General Public License v3.

---

<p align="center">
  Built by <a href="https://github.com/langwatch">LangWatch</a>
</p>
