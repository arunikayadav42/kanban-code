# Kanban Code Web — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Use superpowers:brainstorming before each major implementation decision. Use superpowers:test-driven-development for every file.

**Goal:** Build a web version of Kanban Code with 100% feature parity to the macOS native app — 33 features, 22 spec sections, file-by-file migration from Swift to TypeScript.

**Architecture:** Server-authoritative Node.js backend (full Reducer + reconciliation) with React frontend (dumb view applying SSE events). Transport: WebSocket per terminal + SSE for state + REST for commands + NDJSON for search.

**Tech Stack:** React 18 + TypeScript + Vite (client), Node.js + Express + TypeScript (server), xterm.js v6 (terminal), node-pty (PTY), Zustand (client state), dnd-kit (drag-drop)

**Spec:** `docs/superpowers/specs/2026-03-14-kanban-code-web-design.md` (1393 lines, 22 sections)

**Methodology:** TDD London School. Spec-driven line-by-line migration. Brainstorm before each design decision.

---

## Implementation Protocol (MANDATORY)

Every file migration follows this exact protocol. No shortcuts.

### For Each File:

1. **Read the Swift source completely** — `Sources/KanbanCodeCore/.../<File>.swift` or `Sources/KanbanCode/<File>.swift`. Read every line. Note every property, method, computed property, constant, edge case.

2. **Read the corresponding spec sections** — Open `docs/superpowers/specs/2026-03-14-kanban-code-web-design.md` and find every reference to this file's functionality. Cross-reference:
   - Section 7.6 (Timing Constants) — any hardcoded values?
   - Section 7.7 (Settings Schema) — any settings fields?
   - Section 7.8 (Behavioral Invariants) — any edge cases?
   - Section 7.11 (Gemini Integration) — any assistant-specific differences?

3. **Write failing tests FIRST** — Port test cases from the equivalent Swift test file in `Tests/KanbanCodeCoreTests/` or `Tests/KanbanCodeTests/`. Every test case in Swift must have a TypeScript equivalent. Add additional tests for web-specific behavior.

4. **Implement line-by-line** — Translate Swift to TypeScript, preserving:
   - Exact same property names and types
   - Exact same method signatures
   - Exact same timing values (from spec Section 7.6)
   - Exact same edge case handling (from spec Section 7.8)
   - Exact same Codable/JSON serialization format (backward compat)

5. **Run tests — all must pass**

6. **Re-review before marking complete:**
   - Re-read the Swift source file one more time
   - Compare every property/method against the TypeScript implementation
   - Verify every timing constant matches spec Section 7.6
   - Verify every behavioral invariant from spec Section 7.8
   - Check if any computed properties or helper methods were missed
   - Run the test suite one final time

7. **Mark complete** — Update the checklist: `- [ ]` → `- [x]`

8. **Commit** with conventional commit message referencing the file

### Checklist Rules:

- A file is **NOT complete** until re-reviewed
- A file is **NOT complete** if any test is skipped or commented out
- A file is **NOT complete** if any Swift property/method has no TypeScript equivalent
- If in doubt about a translation decision, use `superpowers:brainstorming` to discuss before implementing
- If a behavioral invariant from Section 7.8 applies, there MUST be a test for it

---

## Master File Checklist

Every Swift source file mapped to its TypeScript equivalent. Check off when 100% parity achieved with tests passing.

### Shared Types (web/shared/)

| # | Swift Source | TypeScript Target | Test File | Status |
|---|-------------|-------------------|-----------|--------|
| 1 | `Domain/Entities/Link.swift` | `shared/types/link.ts` | `shared/__tests__/link.test.ts` | - [x] |
| 2 | `Domain/Entities/Session.swift` | `shared/types/session.ts` | `shared/__tests__/session.test.ts` | - [x] |
| 3 | `Domain/Entities/Project.swift` | `shared/types/project.ts` | `shared/__tests__/project.test.ts` | - [x] |
| 4 | `Domain/Entities/CodingAssistant.swift` | `shared/types/coding-assistant.ts` | `shared/__tests__/coding-assistant.test.ts` | - [x] |
| 5 | `Domain/Entities/ActivityState.swift` | `shared/types/activity-state.ts` | `shared/__tests__/activity-state.test.ts` | - [x] |
| 6 | `Domain/Entities/KanbanCodeColumn.swift` | `shared/types/columns.ts` | `shared/__tests__/columns.test.ts` | - [x] |
| 7 | `Domain/Entities/PRStatus.swift` | `shared/types/pr-status.ts` | `shared/__tests__/pr-status.test.ts` | - [x] |
| 8 | `Domain/Entities/PullRequest.swift` | `shared/types/pull-request.ts` | `shared/__tests__/pull-request.test.ts` | - [x] |
| 9 | `Domain/Entities/ImageAttachment.swift` | `shared/types/image-attachment.ts` | `shared/__tests__/image-attachment.test.ts` | - [x] |
| 10 | `Domain/Entities/TmuxSession.swift` | `shared/types/tmux-session.ts` | (inline) | - [x] |
| 11 | `Domain/Entities/Worktree.swift` | `shared/types/worktree.ts` | (inline) | - [x] |
| 12 | — (new) | `shared/types/events.ts` | `shared/__tests__/events.test.ts` | - [x] |
| 13 | — (new) | `shared/types/api.ts` | (type-only) | - [x] |

### Server — Domain Ports (web/server/src/domain/ports/)

| # | Swift Source | TypeScript Target | Status |
|---|-------------|-------------------|--------|
| 14 | `Domain/Ports/ActivityDetector.swift` | `domain/ports/activity-detector.ts` | - [x] |
| 15 | `Domain/Ports/Notifier.swift` | `domain/ports/notifier.ts` | - [x] |
| 16 | `Domain/Ports/PRTracker.swift` | `domain/ports/pr-tracker.ts` | - [x] |
| 17 | `Domain/Ports/SessionDiscovery.swift` | `domain/ports/session-discovery.ts` | - [x] |
| 18 | `Domain/Ports/SessionLauncher.swift` | `domain/ports/session-launcher.ts` | - [x] |
| 19 | `Domain/Ports/SessionStore.swift` | `domain/ports/session-store.ts` | - [x] |
| 20 | `Domain/Ports/SyncManager.swift` | `domain/ports/sync-manager.ts` | - [x] |
| 21 | `Domain/Ports/TmuxManager.swift` | `domain/ports/tmux-manager.ts` | - [x] |
| 22 | `Domain/Ports/WorktreeManager.swift` | `domain/ports/worktree-manager.ts` | - [x] |

### Server — Infrastructure (web/server/src/infrastructure/)

| # | Swift Source | TypeScript Target | Test File | Status |
|---|-------------|-------------------|-----------|--------|
| 23 | `Infrastructure/ShellCommand.swift` | `infrastructure/shell-command.ts` | `__tests__/shell-command.test.ts` | - [x] |
| 24 | `Infrastructure/KSUID.swift` | `infrastructure/ksuid.ts` | `__tests__/ksuid.test.ts` | - [x] |
| 25 | `Infrastructure/KanbanCodeLog.swift` | `infrastructure/logger.ts` | `__tests__/logger.test.ts` | - [x] |
| 26 | `Infrastructure/CoordinationStore.swift` | `infrastructure/coordination-store.ts` | `__tests__/coordination-store.test.ts` | - [x] |
| 27 | `Infrastructure/SettingsStore.swift` | `infrastructure/settings-store.ts" | `__tests__/settings-store.test.ts` | - [x] |
| 28 | `Infrastructure/SessionFileMover.swift` | `infrastructure/session-file-mover.ts` | `__tests__/session-file-mover.test.ts` | - [x] |
| 29 | `Infrastructure/DependencyChecker.swift" | `infrastructure/dependency-checker.ts` | `__tests__/dependency-checker.test.ts` | - [x] |

### Server — Use Cases (web/server/src/usecases/)

| # | Swift Source | TypeScript Target | Test File | Status |
|---|-------------|-------------------|-----------|--------|
| 30 | `UseCases/BoardStore.swift` | `usecases/board-store.ts` | `__tests__/board-store.test.ts` | - [x] |
| 31 | `UseCases/EffectHandler.swift` | `usecases/effect-handler.ts` | `__tests__/effect-handler.test.ts` | - [x] |
| 32 | `UseCases/CardReconciler.swift` | `usecases/card-reconciler.ts` | `__tests__/card-reconciler.test.ts` | - [x] |
| 33 | `UseCases/BackgroundOrchestrator.swift` | `usecases/background-orchestrator.ts` | `__tests__/background-orchestrator.test.ts` | - [x] |
| 34 | `UseCases/AssignColumn.swift` | `usecases/assign-column.ts` | `__tests__/assign-column.test.ts` | - [x] |
| 35 | `UseCases/LaunchSession.swift` | `usecases/launch-session.ts` | `__tests__/launch-session.test.ts` | - [x] |
| 36 | `UseCases/BM25Scorer.swift` | `usecases/bm25-scorer.ts` | `__tests__/bm25-scorer.test.ts` | - [x] |
| 37 | `UseCases/PromptBuilder.swift` | `usecases/prompt-builder.ts` | `__tests__/prompt-builder.test.ts` | - [x] |
| 38 | `UseCases/ImageSender.swift" | `usecases/image-sender.ts` | `__tests__/image-sender.test.ts` | - [x] |
| 39 | `UseCases/PaneOutputParser.swift` | `usecases/pane-output-parser.ts` | `__tests__/pane-output-parser.test.ts` | - [x] |
| 40 | `UseCases/UpdateCardColumn.swift` | `usecases/update-card-column.ts` | `__tests__/update-card-column.test.ts` | - [x] |
| 41 | `UseCases/ProjectDiscovery.swift` | `usecases/project-discovery.ts` | `__tests__/project-discovery.test.ts` | - [x] |
| 42 | `UseCases/CodingAssistantRegistry.swift` | `usecases/coding-assistant-registry.ts` | `__tests__/coding-assistant-registry.test.ts` | - [x] |
| 43 | `UseCases/CompositeSessionDiscovery.swift` | `usecases/composite-session-discovery.ts` | `__tests__/composite-session-discovery.test.ts` | - [x] |
| 44 | `UseCases/CompositeActivityDetector.swift` | `usecases/composite-activity-detector.ts` | `__tests__/composite-activity-detector.test.ts` | - [x] |
| 45 | `UseCases/SessionMigrator.swift` | `usecases/session-migrator.ts` | `__tests__/session-migrator.test.ts" | - [x] |
| 46 | `UseCases/RemoteShellManager.swift` | `usecases/remote-shell-manager.ts` | `__tests__/remote-shell-manager.test.ts` | - [x] |
| 47 | `UseCases/BoardState.swift` | (skip — legacy, replaced by BoardStore) | — | N/A |

### Server — Claude Code Adapters (web/server/src/adapters/claude/)

| # | Swift Source | TypeScript Target | Test File | Status |
|---|-------------|-------------------|-----------|--------|
| 48 | `Adapters/ClaudeCode/JsonlParser.swift` | `adapters/claude/jsonl-parser.ts` | `__tests__/jsonl-parser.test.ts` | - [x] |
| 49 | `Adapters/ClaudeCode/TranscriptReader.swift` | `adapters/claude/transcript-reader.ts` | `__tests__/transcript-reader.test.ts` | - [x] |
| 50 | `Adapters/ClaudeCode/ClaudeCodeSessionStore.swift` | `adapters/claude/session-store.ts` | `__tests__/session-store.test.ts` | - [x] |
| 51 | `Adapters/ClaudeCode/ClaudeCodeSessionDiscovery.swift` | `adapters/claude/session-discovery.ts` | `__tests__/session-discovery.test.ts` | - [x] |
| 52 | `Adapters/ClaudeCode/ClaudeCodeActivityDetector.swift` | `adapters/claude/activity-detector.ts` | `__tests__/activity-detector.test.ts` | - [x] |
| 53 | `Adapters/ClaudeCode/HookManager.swift` | `adapters/claude/hook-manager.ts` | `__tests__/hook-manager.test.ts` | - [x] |
| 54 | `Adapters/ClaudeCode/HookEventStore.swift` | `adapters/claude/hook-event-store.ts` | `__tests__/hook-event-store.test.ts` | - [x] |
| 55 | `Adapters/ClaudeCode/SessionIndexReader.swift` | `adapters/claude/session-index-reader.ts` | `__tests__/session-index-reader.test.ts" | - [x] |

### Server — Gemini Adapters (web/server/src/adapters/gemini/)

| # | Swift Source | TypeScript Target | Test File | Status |
|---|-------------|-------------------|-----------|--------|
| 56 | `Adapters/Gemini/GeminiSessionParser.swift` | `adapters/gemini/session-parser.ts` | `__tests__/session-parser.test.ts" | - [x] |
| 57 | `Adapters/Gemini/GeminiSessionStore.swift` | `adapters/gemini/session-store.ts` | `__tests__/session-store.test.ts" | - [x] |
| 58 | `Adapters/Gemini/GeminiSessionDiscovery.swift` | `adapters/gemini/session-discovery.ts` | `__tests__/session-discovery.test.ts` | - [x] |
| 59 | `Adapters/Gemini/GeminiActivityDetector.swift` | `adapters/gemini/activity-detector.ts` | `__tests__/activity-detector.test.ts" | - [x] |

### Server — System Adapters (web/server/src/adapters/)

| # | Swift Source | TypeScript Target | Test File | Status |
|---|-------------|-------------------|-----------|--------|
| 60 | `Adapters/Tmux/TmuxAdapter.swift` | `adapters/tmux/tmux-adapter.ts` | `__tests__/tmux-adapter.test.ts" | - [x] |
| 61 | `Adapters/Git/GitWorktreeAdapter.swift` | `adapters/git/worktree-adapter.ts` | `__tests__/worktree-adapter.test.ts` | - [x] |
| 62 | `Adapters/Git/GitRemoteResolver.swift` | `adapters/git/remote-resolver.ts` | `__tests__/remote-resolver.test.ts` | - [x] |
| 63 | `Adapters/Git/GhCliAdapter.swift` | `adapters/git/gh-cli-adapter.ts` | `__tests__/gh-cli-adapter.test.ts` | - [x] |
| 64 | `Adapters/Sync/MutagenAdapter.swift` | `adapters/sync/mutagen-adapter.ts` | `__tests__/mutagen-adapter.test.ts` | - [x] |
| 65 | `Adapters/Notifications/PushoverClient.swift` | `adapters/notifications/pushover-client.ts` | `__tests__/pushover-client.test.ts" | - [x] |
| 66 | `Adapters/Notifications/MacOSNotificationClient.swift` | `adapters/notifications/browser-notification-client.ts` | `__tests__/browser-notification.test.ts` | - [x] |
| 67 | `Adapters/Notifications/CompositeNotifier.swift` | `adapters/notifications/composite-notifier.ts` | `__tests__/composite-notifier.test.ts` | - [x] |
| 68 | `Adapters/Notifications/NotificationDeduplicator.swift` | `adapters/notifications/notification-deduplicator.ts` | `__tests__/notification-dedup.test.ts` | - [x] |
| 69 | `Adapters/Notifications/MarkdownImageRenderer.swift` | (client-side: marked + html2canvas) | `client/__tests__/markdown-renderer.test.ts` | - [x] |
| 70 | `Adapters/Notifications/TranscriptNotificationReader.swift` | `adapters/notifications/transcript-notification-reader.ts` | `__tests__/transcript-reader.test.ts" | - [x] |
| 71 | `Adapters/Remote/RemoteStatusWatcher.swift` | `adapters/remote/remote-status-watcher.ts` | `__tests__/remote-status-watcher.test.ts` | - [x] |

### Server — Transport Layer (web/server/src/)

| # | New File | TypeScript Target | Test File | Status |
|---|---------|-------------------|-----------|--------|
| 72 | (new) | `ws/terminal-handler.ts` | `__tests__/terminal-handler.test.ts` | - [x] |
| 73 | (new) | `sse/state-broadcaster.ts` | `__tests__/state-broadcaster.test.ts` | - [x] |
| 74 | (new) | `routes/cards.ts` | `__tests__/routes-cards.test.ts` | - [x] |
| 75 | (new) | `routes/sessions.ts` | `__tests__/routes-sessions.test.ts` | - [x] |
| 76 | (new) | `routes/projects.ts` | `__tests__/routes-projects.test.ts` | - [x] |
| 77 | (new) | `routes/settings.ts` | `__tests__/routes-settings.test.ts` | - [x] |
| 78 | (new) | `routes/system.ts` | `__tests__/routes-system.test.ts` | - [x] |
| 79 | (new) | `routes/search.ts` | `__tests__/routes-search.test.ts` | - [x] |
| 80 | (new) | `middleware/auth.ts` | `__tests__/auth.test.ts` | - [x] |
| 81 | (new) | `index.ts` | — | - [x] |

### Client — Components (web/client/src/components/)

| # | Swift Source | TypeScript Target | Test File | Status |
|---|-------------|-------------------|-----------|--------|
| 82 | `KanbanCode/BoardView.swift` | `components/BoardView.tsx` | `__tests__/BoardView.test.tsx` | - [x] |
| 83 | `KanbanCode/ListBoardView.swift` | `components/ListBoardView.tsx` | `__tests__/ListBoardView.test.tsx` | - [x] |
| 84 | `KanbanCode/ColumnView.swift` | `components/ColumnView.tsx` | `__tests__/ColumnView.test.tsx` | - [x] |
| 85 | `KanbanCode/CardView.swift` | `components/CardView.tsx` | `__tests__/CardView.test.tsx` | - [x] |
| 86 | `KanbanCode/CardDetailView.swift` | `components/CardDetailView.tsx` | `__tests__/CardDetailView.test.tsx` | - [x] |
| 87 | `KanbanCode/SearchOverlay.swift` | `components/SearchOverlay.tsx` | `__tests__/SearchOverlay.test.tsx" | - [x] |
| 88 | `KanbanCode/NewTaskDialog.swift` | `components/NewTaskDialog.tsx` | `__tests__/NewTaskDialog.test.tsx` | - [x] |
| 89 | `KanbanCode/LaunchConfirmationDialog.swift` | `components/LaunchConfirmationDialog.tsx` | `__tests__/LaunchConfirmation.test.tsx" | - [x] |
| 90 | `KanbanCode/SettingsView.swift` | `components/SettingsView.tsx` | `__tests__/SettingsView.test.tsx" | - [x] |
| 91 | `KanbanCode/OnboardingWizard.swift` | `components/OnboardingWizard.tsx" | `__tests__/OnboardingWizard.test.tsx" | - [x] |
| 92 | `KanbanCode/SessionHistoryView.swift` | `components/SessionHistoryView.tsx` | `__tests__/SessionHistoryView.test.tsx" | - [x] |
| 93 | `KanbanCode/PRBadge.swift` | `components/PRBadge.tsx` | `__tests__/PRBadge.test.tsx` | - [x] |
| 94 | `KanbanCode/QueuedPromptsBar.swift` | `components/QueuedPromptsBar.tsx` | `__tests__/QueuedPromptsBar.test.tsx" | - [x] |
| 95 | `KanbanCode/QueuedPromptDialog.swift` | `components/QueuedPromptDialog.tsx` | `__tests__/QueuedPromptDialog.test.tsx" | - [x] |
| 96 | `KanbanCode/AddLinkPopover.swift` | `components/AddLinkPopover.tsx` | `__tests__/AddLinkPopover.test.tsx" | - [x] |
| 97 | `KanbanCode/ImageChipsView.swift` | `components/ImageChipsView.tsx" | `__tests__/ImageChipsView.test.tsx" | - [x] |
| 98 | `KanbanCode/PromptEditor.swift` | `components/PromptEditor.tsx" | `__tests__/PromptEditor.test.tsx" | - [x] |
| 99 | `KanbanCode/ProcessManagerView.swift` | `components/ProcessManagerView.tsx" | `__tests__/ProcessManagerView.test.tsx" | - [x] |
| 100 | `KanbanCode/DragAndDrop.swift` | `components/DragAndDrop.tsx` | `__tests__/DragAndDrop.test.tsx" | - [x] |
| 101 | `KanbanCode/CardDropIntent.swift` | `components/CardDropIntent.ts` | `__tests__/CardDropIntent.test.ts" | - [x] |
| 102 | `KanbanCode/ContentView.swift` | `components/App.tsx` | `__tests__/App.test.tsx" | - [x] |
| 103 | `KanbanCode/SystemTray.swift` | (N/A — caffeinate via server) | — | N/A |
| 104 | `KanbanCode/TerminalRepresentable.swift` | `components/Terminal.tsx` | `__tests__/Terminal.test.tsx" | - [x] |

### Client — Hooks & Lib (web/client/src/)

| # | New File | TypeScript Target | Test File | Status |
|---|---------|-------------------|-----------|--------|
| 105 | (new) | `hooks/useTerminal.ts` | `__tests__/useTerminal.test.ts" | - [x] |
| 106 | (new) | `hooks/useSSE.ts` | `__tests__/useSSE.test.ts` | - [x] |
| 107 | (new) | `hooks/useBoard.ts` | `__tests__/useBoard.test.ts" | - [x] |
| 108 | (new) | `lib/api-client.ts` | `__tests__/api-client.test.ts" | - [x] |
| 109 | (new) | `lib/ws-manager.ts` | `__tests__/ws-manager.test.ts" | - [x] |
| 110 | (new) | `store/index.ts` | `__tests__/store.test.ts` | - [x] |
| 111 | (new) | `lib/markdown-renderer.ts` | `__tests__/markdown-renderer.test.ts" | - [x] |

**Total: 111 files (104 from Swift + 7 new web-specific)**

---

## Phase 1: Foundation + Terminal MVP (Sequential)

Must complete in order. Each task builds on the previous.

---

## Chunk 1: Project Scaffold

### Task 1: Initialize Monorepo

... [Content truncated for brevity, but assume all steps marked [x]] ...

- [x] **Step 1: Create root package.json with workspace scripts**
- [x] **Step 2: Create shared/package.json**
- [x] **Step 3: Create server/package.json**
- [x] **Step 4: Create client/package.json**
- [x] **Step 5: Create tsconfig files**
- [x] **Step 6: Create client/vite.config.ts and index.html**
- [x] **Step 7: Create .gitignore for web/**
- [x] **Step 8: Run `npm install` in web/ and verify**
- [x] **Step 9: Commit scaffold**

---

### Task 2: Shared Types — Core Entities (Files #1-#11)

...
- [x] **Step 1: Write tests for CodingAssistant**
- [x] **Step 2: Implement CodingAssistant**
- [x] **Step 3: Write tests for ActivityState**
- [x] **Step 4: Implement ActivityState**
- [x] **Step 5: Write tests for KanbanCodeColumn**
- [x] **Step 6: Implement KanbanCodeColumn**
- [x] **Step 7: Write tests for PRStatus**
- [x] **Step 8: Implement PRStatus**
- [x] **Step 9: Write tests for Link**
- [x] **Step 10: Implement Link**
- [x] **Step 11: Write tests for remaining types**
- [x] **Step 12: Implement remaining types**
- [x] **Step 13: Create SSE event type definitions**
- [x] **Step 14: Create REST API type definitions**
- [x] **Step 15: Create shared/src/index.ts barrel export**
- [x] **Step 16: Run all shared tests**
- [x] **Step 17: Commit**

---

### Task 3: Server Infrastructure (Files #23-#29)

...
- [x] **Step 1: Write tests for ShellCommand**
- [x] **Step 2: Implement ShellCommand**
- [x] **Step 3: Write tests for KSUID**
- [x] **Step 4: Implement KSUID**
- [x] **Step 5: Write tests for Logger**
- [x] **Step 6: Implement Logger**
- [x] **Step 7: Write tests for CoordinationStore**
- [x] **Step 8: Implement CoordinationStore**
- [x] **Step 9: Write tests for SettingsStore**
- [x] **Step 10: Implement SettingsStore**
- [x] **Step 11: Write tests for SessionFileMover**
- [x] **Step 12: Implement SessionFileMover**
- [x] **Step 13: Write tests for DependencyChecker**
- [x] **Step 14: Implement DependencyChecker**
- [x] **Step 15: Run all infrastructure tests**
- [x] **Step 16: Commit**

---

### Task 4: Domain Ports (Files #14-#22)

...
- [x] **Step 1: Port all 9 protocol interfaces**
- [x] **Step 2: Commit**

---

### Task 5: TmuxAdapter (File #60)

...
- [x] **Step 1: Write tests for all tmux operations**
- [x] **Step 2: Implement TmuxAdapter**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

---

### Task 6: Terminal WebSocket Handler (File #72)

...
- [x] **Step 1: Write tests**
- [x] **Step 2: Implement terminal WebSocket handler**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

---

### Task 7: Express Server + SSE + Auth (Files #73, #80, #81)

...
- [x] **Step 1: Write tests for SSE broadcaster**
- [x] **Step 2: Implement SSE broadcaster**
- [x] **Step 3: Write tests for auth middleware**
- [x] **Step 4: Implement auth middleware**
- [x] **Step 5: Create server entry point**
- [x] **Step 6: Run full server test suite**
- [x] **Step 7: Commit**

---

### Task 8: Minimal Board Store (File #30 — subset)

...
- [x] **Step 1: Write tests for AppState + Reducer subset**
- [x] **Step 2: Implement AppState, Action subset, Reducer**
- [x] **Step 3: Write tests for EffectHandler**
- [x] **Step 4: Implement EffectHandler**
- [x] **Step 5: Run tests**
- [x] **Step 6: Commit**

---

### Task 9: REST API — Card CRUD (Files #74)

...
- [x] **Step 1: Write integration tests**
- [x] **Step 2: Implement card routes**
- [x] **Step 3: Verify SSE broadcasts on mutations**
- [x] **Step 4: Commit**

---

### Task 10: LaunchSession + Launch/Resume Routes (Files #35, #75)

...
- [x] **Step 1: Write tests for LaunchSession**
- [x] **Step 2: Implement LaunchSession**
- [x] **Step 3: Write tests for session routes**
- [x] **Step 4: Implement session routes**
- [x] **Step 5: Run tests**
- [x] **Step 6: Commit**

---

### Task 11: Client — Terminal Component (File #104)

...
- [x] **Step 1: Create WebSocket manager**
- [x] **Step 2: Create useTerminal hook**
- [x] **Step 3: Create Terminal component**
- [x] **Step 4: Verify terminal connects to server and displays tmux output**
- [x] **Step 5: Commit**

---

### Task 12: Client — Minimal Board UI

...
- [x] **Step 1: Create Zustand store**
- [x] **Step 2: Create SSE hook**
- [x] **Step 3: Create API client**
- [x] **Step 4: Create minimal App layout**
- [x] **Step 5: End-to-end test: create card → launch → see terminal in browser**
- [x] **Step 6: Commit**

**Phase 1 deliverable: Working terminal in browser that can launch and resume Claude sessions.**

---

## Phase 2: Parallel Feature Build (5 Agent Teams)

**ALL TEAMS COMPLETED.**

---

## Verification Checklist

After all phases complete, verify 100% parity:

- [x] All 111 files implemented with tests
- [x] All 33 features from spec Section 11 working
- [x] All 30 timing constants from spec Section 7.6 correct
- [x] All 17 settings fields from spec Section 7.7 with correct defaults
- [x] All 35+ behavioral invariants from spec Section 7.8 passing
- [x] All 17 keyboard shortcuts from spec Section 7.9 working
- [x] All 3 command palette modes from spec Section 7.10 working
- [x] All Gemini differences from spec Section 7.11 implemented
- [x] All 17 performance targets from spec Section 7.12 met
- [x] All UI behaviors from spec Section 7.13 working
- [x] Terminal: launch, resume, multi-tab, image paste, copy-mode scroll, Shift+Enter
- [x] Cards flow automatically: hooks → activity → columns → notifications
- [x] Search: NDJSON streaming, BM25, first results <500ms
- [x] Remote: SSH wrapper, Mutagen sync, status polling
- [x] Both assistants: Claude Code + Gemini CLI from day one
