# 🔌 Bring Your Own Assistant (BYOA) Integration Spec

This specification defines how to integrate any AI CLI tool (e.g., Claude Code, Google Gemini CLI, Aider) into Agentic Kanban as a managed agent.

---

## 1. Architectural Overview

Agentic Kanban uses a **Plugin Architecture** based on the **Ports and Adapters** pattern. To add a new assistant, you must provide:
1.  **A Descriptor (`descriptor.json`):** Metadata about the CLI (command, flags, icons, UI colors).
2.  **Adapters (TypeScript):** Implementations of three core domain ports that handle session discovery, activity tracking, and history management.

---

## 2. The Plugin Structure

Every plugin must live in `web/server/src/plugins/<assistant-id>/`:

```text
plugins/<assistant-id>/
├── descriptor.json          # Metadata & UI configuration
└── adapters/
    └── index.ts             # Factory that returns the adapter implementations
```

---

## 3. The Descriptor (`descriptor.json`)

The descriptor tells the Kanban engine how to interact with the CLI and how to render it in the UI.

### Key Fields:
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier (e.g., `claude`, `gemini`). |
| `cliCommand` | `string` | The base command to launch the assistant (e.g., `claude`). |
| `autoApproveFlag` | `string` | Flag to skip manual permissions (e.g., `--dangerously-skip-permissions`). |
| `resumeFlag` | `string` | Flag to resume an existing session (e.g., `--resume`). |
| `supportsWorktree`| `boolean`| Whether the assistant can be launched inside a Git Worktree. |
| `hooks` | `object` | Configuration for the activity hook system. |
| `color` | `hex` | Primary color used for the agent's cards and icons in the UI. |

---

## 4. The Adapters (The "Brain")

The `adapters/index.ts` must export a `createAdapters()` function that returns implementations for these three interfaces:

### A. `SessionDiscovery`
Responsible for finding existing sessions on the filesystem.
*   **Efficiency:** Runs every 5 seconds; uses `mtime` caching to skip unchanged files.
*   **Mapping:** Converts native CLI metadata into a unified `Session` object.

### B. `ActivityDetector`
Determines the real-time "pulse" of an agent.
*   **Hook-Driven:** Processes events like `UserPromptSubmit` (Active) or `Stop` (Needs Attention).
*   **Polling Fallback:** Checks file modification timestamps if the hook system is unavailable.

### C. `SessionStore`
Manages history, search, and non-linear workflows.
*   **Parsing:** Converts raw CLI logs (JSONL, SQLite, etc.) into clean `ConversationTurn[]`.
*   **Forking:** Logic to clone an existing session state into a new file/entry.
*   **Search:** Implements full-text search (BM25) across all transcripts for that assistant.

---

## 5. Case Study: Claude Code Integration

Claude Code serves as the gold standard for our BYOA model.

1.  **Descriptor:** Maps `cliCommand: "claude"` and uses `#f97316` (Claude Orange).
2.  **Discovery:** Scans `~/.claude/projects/` for `.jsonl` files.
3.  **Store:** Parses streaming JSONL records, filtering out tool-use noise to show only user/assistant dialogue.
4.  **Forking:** Copies the `.jsonl` file to a new ID, allowing the user to branch their research.
5.  **Activity:** Listen for `Stop` events to trigger "Needs Attention" on the user's mobile app.

---

## 6. How to Add a New Assistant (Step-by-Step)

1.  **Create Directory:** `mkdir -p web/server/src/plugins/my-new-ai`
2.  **Define Descriptor:** Copy an existing `descriptor.json` and update the `cliCommand` and `hooks`.
3.  **Implement Adapters:**
    *   If your tool uses JSONL, use the provided `JsonlParser` utility.
    *   If it uses SQLite (like Kiro), implement a SQL-based discovery adapter.
4.  **Register:** The engine automatically loads anything in the `plugins/` folder on startup.
5.  **Test:** Run `npm test` in the server directory to verify your adapter logic.
