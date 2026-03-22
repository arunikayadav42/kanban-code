import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDescriptor, getConfigDirName } from '@kanban-code/shared';

/**
 * Manages hook installation for coding assistants.
 *
 * Uses the descriptor-driven plugin system to determine hook events,
 * config paths, and config formats per assistant. No hardcoded switches.
 *
 * Config formats:
 *   "nested" (Claude/Gemini): settings.json -> hooks -> { Event: [{ matcher, hooks: [{ type, command }] }] }
 *   "flat" (Kiro): agents/default.json -> hooks -> { event: [{ command }] }
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/ClaudeCode/HookManager.swift
 * Spec: Section 7.8 (Idempotent install - no duplicate entries)
 */
export class HookManager {
  /** Hook events needed per assistant, read from the descriptor. */
  static requiredHooks(assistant: string): string[] {
    const desc = getDescriptor(assistant);
    return desc?.hooks?.events ?? [];
  }

  /** Normalize assistant-specific event names to canonical names the orchestrator understands. */
  static normalizeEventName(eventName: string, assistant?: string): string {
    if (assistant) {
      const desc = getDescriptor(assistant);
      if (desc?.hooks?.normalize[eventName]) return desc.hooks.normalize[eventName];
    }
    // Fallback normalization for common patterns across all assistants
    const common: Record<string, string> = {
      AfterAgent: 'Stop',
      BeforeAgent: 'UserPromptSubmit',
      agentSpawn: 'SessionStart',
      stop: 'Stop',
      userPromptSubmit: 'UserPromptSubmit',
    };
    return common[eventName] ?? eventName;
  }

  /** Get the config format for an assistant ("nested" or "flat"). */
  private static getConfigFormat(assistant: string): 'nested' | 'flat' {
    return getDescriptor(assistant)?.hooks?.configFormat ?? 'nested';
  }

  // -- Check --

  /** Check if hooks are already installed for the given assistant. */
  static isInstalled(options: {
    assistant: string;
    settingsPath?: string;
  }): boolean {
    const settingsPath = options.settingsPath ?? defaultSettingsPath(options.assistant);

    let root: Record<string, unknown>;
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      root = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return false;
    }

    const hooks = root.hooks as Record<string, unknown> | undefined;
    if (!hooks) return false;

    const format = HookManager.getConfigFormat(options.assistant);

    if (format === 'flat') {
      // Flat format: { hooks: { event: [{ command }] } }
      return HookManager.requiredHooks(options.assistant).every(eventName => {
        const entries = hooks[eventName] as KiroHookEntry[] | undefined;
        if (!Array.isArray(entries)) return false;
        return entries.some(entry =>
          typeof entry.command === 'string'
          && entry.command.includes('.kanban-code/hook.sh'),
        );
      });
    }

    // Nested format: { hooks: { Event: [{ matcher, hooks: [{ type, command }] }] } }
    return HookManager.requiredHooks(options.assistant).every(eventName => {
      const groups = hooks[eventName] as HookGroup[] | undefined;
      if (!Array.isArray(groups)) return false;

      return groups.some(group => {
        const hookEntries = group.hooks;
        if (!Array.isArray(hookEntries)) return false;
        return hookEntries.some(entry =>
          typeof entry.command === 'string'
          && entry.command.includes('.kanban-code/hook.sh'),
        );
      });
    });
  }

  // -- Install --

  /** Install hooks for the given assistant. */
  static install(options: {
    assistant: string;
    settingsPath?: string;
    hookScriptPath?: string;
  }): void {
    const settingsPath = options.settingsPath ?? defaultSettingsPath(options.assistant);
    const scriptPath = options.hookScriptPath ?? defaultHookScriptPath();

    // Deploy the hook script to disk
    deployHookScript(scriptPath);

    // Read existing config
    let root: Record<string, unknown>;
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      root = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      root = {};
    }

    const format = HookManager.getConfigFormat(options.assistant);

    if (format === 'flat') {
      // Flat format: { hooks: { event: [{ command }] } }
      const hooks = (root.hooks ?? {}) as Record<string, KiroHookEntry[]>;

      for (const eventName of HookManager.requiredHooks(options.assistant)) {
        const entries: KiroHookEntry[] = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];

        const alreadyInstalled = entries.some(entry =>
          typeof entry.command === 'string'
          && entry.command.includes('.kanban-code/hook.sh'),
        );

        if (!alreadyInstalled) {
          entries.push({ command: scriptPath });
        }

        hooks[eventName] = entries;
      }

      root.hooks = hooks;
    } else {
      // Nested format: { hooks: { Event: [{ matcher, hooks: [{ type, command }] }] } }
      const hooks = (root.hooks ?? {}) as Record<string, HookGroup[]>;

      const hookEntry: HookEntry = {
        type: 'command',
        command: scriptPath,
      };

      for (const eventName of HookManager.requiredHooks(options.assistant)) {
        let groups: HookGroup[] = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];

        // Check if .kanban-code/hook.sh already exists in any group (idempotent)
        const alreadyInstalled = groups.some(group => {
          if (!Array.isArray(group.hooks)) return false;
          return group.hooks.some(entry =>
            typeof entry.command === 'string'
            && entry.command.includes('.kanban-code/hook.sh'),
          );
        });

        if (!alreadyInstalled) {
          if (groups.length === 0) {
            groups.push({ matcher: '', hooks: [hookEntry] });
          } else {
            // Append to first group's hooks array
            const firstGroup = groups[0];
            if (!Array.isArray(firstGroup.hooks)) {
              firstGroup.hooks = [];
            }
            firstGroup.hooks.push(hookEntry);
          }
        }

        hooks[eventName] = groups;
      }

      root.hooks = hooks;
    }

    // Write back
    const dir = path.dirname(settingsPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(root, null, 2));
  }

  // -- Uninstall --

  /** Remove Kanban hooks from the given assistant's settings. */
  static uninstall(options: {
    assistant: string;
    settingsPath?: string;
  }): void {
    const settingsPath = options.settingsPath ?? defaultSettingsPath(options.assistant);

    let root: Record<string, unknown>;
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      root = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const hooks = root.hooks as Record<string, unknown[]> | undefined;
    if (!hooks) return;

    const format = HookManager.getConfigFormat(options.assistant);

    if (format === 'flat') {
      // Flat format: { hooks: { event: [{ command }] } }
      for (const eventName of HookManager.requiredHooks(options.assistant)) {
        let entries = hooks[eventName] as KiroHookEntry[] | undefined;
        if (!Array.isArray(entries)) continue;

        entries = entries.filter(entry =>
          !(typeof entry.command === 'string'
            && entry.command.includes('.kanban-code/hook.sh')),
        );

        if (entries.length === 0) {
          delete hooks[eventName];
        } else {
          hooks[eventName] = entries;
        }
      }
    } else {
      // Nested format: { hooks: { Event: [{ matcher, hooks: [{ type, command }] }] } }
      for (const eventName of HookManager.requiredHooks(options.assistant)) {
        let groups = hooks[eventName] as HookGroup[] | undefined;
        if (!Array.isArray(groups)) continue;

        // Remove kanban hook entries from each group
        for (const group of groups) {
          if (Array.isArray(group.hooks)) {
            group.hooks = group.hooks.filter(entry =>
              !(typeof entry.command === 'string'
                && entry.command.includes('.kanban-code/hook.sh')),
            );
          }
        }

        // Remove empty groups (groups with no hooks left)
        groups = groups.filter(group =>
          Array.isArray(group.hooks) && group.hooks.length > 0,
        );

        if (groups.length === 0) {
          delete hooks[eventName];
        } else {
          hooks[eventName] = groups;
        }
      }
    }

    root.hooks = hooks;
    fs.writeFileSync(settingsPath, JSON.stringify(root, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface HookEntry {
  type: string;
  command: string;
}

interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

/** Flat hook entry format (no matcher/type wrapper). */
interface KiroHookEntry {
  command: string;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function defaultSettingsPath(assistant: string): string {
  const desc = getDescriptor(assistant);
  if (desc?.hooks?.configPath) {
    return path.join(os.homedir(), getConfigDirName(assistant), desc.hooks.configPath);
  }
  return path.join(os.homedir(), getConfigDirName(assistant), 'settings.json');
}

function defaultHookScriptPath(): string {
  return path.join(os.homedir(), '.kanban-code', 'hook.sh');
}

function deployHookScript(scriptPath: string): void {
  const dir = path.dirname(scriptPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(scriptPath, HOOK_SCRIPT_CONTENT);
  fs.chmodSync(scriptPath, 0o755);
}

const HOOK_SCRIPT_CONTENT = `#!/usr/bin/env bash
# Kanban hook handler for coding assistants (Claude Code, Gemini CLI).
# Receives JSON on stdin from hooks, appends a timestamped
# event line to ~/.kanban-code/hook-events.jsonl.

set -euo pipefail

EVENTS_DIR="\${HOME}/.kanban-code"
EVENTS_FILE="\${EVENTS_DIR}/hook-events.jsonl"

# Ensure directory exists
mkdir -p "$EVENTS_DIR"

# Read the JSON payload from stdin
input=$(cat)

# Extract fields using lightweight parsing (no jq dependency)
session_id=$(echo "$input" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
hook_event=$(echo "$input" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4)
transcript=$(echo "$input" | grep -o '"transcript_path":"[^"]*"' | head -1 | cut -d'"' -f4)

# Fallback: try sessionId (different hook formats)
if [ -z "$session_id" ]; then
    session_id=$(echo "$input" | grep -o '"sessionId":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

# Skip if we couldn't extract a session ID
 [ -z "$session_id" ] && exit 0

# Get current timestamp
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Append event line
printf '{"sessionId":"%s","event":"%s","timestamp":"%s","transcriptPath":"%s"}\\n' \\
    "$session_id" "$hook_event" "$timestamp" "$transcript" >> "$EVENTS_FILE"
`;
