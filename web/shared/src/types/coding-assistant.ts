/**
 * Supported coding assistants that can be managed by Kanban Code.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/CodingAssistant.swift
 * Spec: Section 7.11 (Gemini CLI Integration)
 *
 * This module uses a descriptor-driven plugin system. Each assistant is
 * described by an `AssistantDescriptor` loaded from JSON plugin files at
 * startup. Helper functions look up properties from the registry and fall
 * back to sensible defaults for unknown assistants.
 */

import type { AssistantDescriptor } from './assistant-descriptor.js';

// ---------------------------------------------------------------------------
// Type -- now an open `string` so any plugin ID works
// ---------------------------------------------------------------------------

export type CodingAssistant = string;

// ---------------------------------------------------------------------------
// Descriptor registry
// ---------------------------------------------------------------------------

const descriptorMap = new Map<string, AssistantDescriptor>();

/** Built-in descriptors for backward compatibility when nothing is registered. */
const BUILTIN_DESCRIPTORS: AssistantDescriptor[] = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    shortName: 'Claude',
    cliCommand: 'claude',
    availabilityCheck: 'claude',
    promptCharacter: '\u276F',           // ❯
    autoApproveFlag: '--dangerously-skip-permissions',
    resumeFlag: '--resume',
    supportsWorktree: true,
    supportsImageUpload: true,
    configDirName: '.claude',
    historySymbol: '\u276F',             // ❯
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    needsRemotePathOverride: false,
    usesPasteInput: false,
    readyTimeoutMs: 30_000,
    color: '#f97316',
    hooks: {
      events: ['Stop', 'Notification', 'SessionStart', 'SessionEnd', 'UserPromptSubmit'],
      configPath: 'settings.json',
      configFormat: 'nested',
      normalize: {},
    },
    icon: { svgPath: 'M3 3h10v10H3z', viewBox: '0 0 16 16' },
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    shortName: 'Gemini',
    cliCommand: 'gemini',
    availabilityCheck: 'gemini',
    promptCharacter: 'Type your message',
    autoApproveFlag: '--yolo',
    resumeFlag: '--resume',
    supportsWorktree: false,
    supportsImageUpload: false,
    configDirName: '.gemini',
    historySymbol: '\u2726',             // ✦
    installCommand: 'npm install -g @google/gemini-cli',
    needsRemotePathOverride: true,
    usesPasteInput: true,
    readyTimeoutMs: 60_000,
    color: '#3b82f6',
    hooks: {
      events: ['AfterAgent', 'Notification', 'SessionStart', 'SessionEnd', 'BeforeAgent'],
      configPath: 'settings.json',
      configFormat: 'nested',
      normalize: { AfterAgent: 'Stop', BeforeAgent: 'UserPromptSubmit' },
    },
    icon: { svgPath: 'M8 1l2.5 5 5.5.8-4 3.9.9 5.3L8 13.5 3.1 16l.9-5.3L0 6.8l5.5-.8z', viewBox: '0 0 16 16' },
  },
  {
    id: 'kiro',
    displayName: 'Kiro CLI',
    shortName: 'Kiro',
    cliCommand: 'kiro-cli chat --agent default',
    availabilityCheck: 'kiro-cli',
    promptCharacter: '> ',
    autoApproveFlag: '--trust-all-tools',
    resumeFlag: '--resume',
    supportsWorktree: false,
    supportsImageUpload: true,
    configDirName: '.kiro',
    historySymbol: '>',
    installCommand: 'curl -fsSL https://cli.kiro.dev/install | bash',
    needsRemotePathOverride: false,
    usesPasteInput: false,
    readyTimeoutMs: 30_000,
    color: '#22c55e',
    hooks: {
      events: ['stop', 'userPromptSubmit', 'agentSpawn'],
      configPath: 'agents/default.json',
      configFormat: 'flat',
      normalize: { agentSpawn: 'SessionStart', stop: 'Stop', userPromptSubmit: 'UserPromptSubmit' },
    },
    icon: { svgPath: 'M13 3L4 14h5l-1 7 9-11h-5l1-7z', viewBox: '0 0 24 24' },
  },
];

// Seed the registry with built-in descriptors so callers that never call
// registerDescriptors() still get working defaults.
for (const d of BUILTIN_DESCRIPTORS) {
  descriptorMap.set(d.id, d);
}

/**
 * Ordered list of all known assistant IDs.
 * Updated automatically when `registerDescriptors()` is called.
 */
export let ALL_ASSISTANTS: string[] = Array.from(descriptorMap.keys());

/**
 * Register descriptors loaded from plugin JSON files.
 * Replaces the entire registry and updates `ALL_ASSISTANTS`.
 */
export function registerDescriptors(descriptors: AssistantDescriptor[]): void {
  descriptorMap.clear();
  for (const d of descriptors) {
    descriptorMap.set(d.id, d);
  }
  ALL_ASSISTANTS = Array.from(descriptorMap.keys());
}

/** Get all registered assistant IDs. */
export function getAllAssistants(): string[] {
  return Array.from(descriptorMap.keys());
}

/** Get the full descriptor for an assistant. */
export function getDescriptor(assistant: string): AssistantDescriptor | undefined {
  return descriptorMap.get(assistant);
}

// ---------------------------------------------------------------------------
// Property helpers -- each looks up the descriptor and falls back to a
// sensible default when the assistant is unknown.
// ---------------------------------------------------------------------------

export function getDisplayName(assistant: string): string {
  return descriptorMap.get(assistant)?.displayName ?? assistant;
}

/** Short name for inline labels (e.g. "Claude", "Gemini", "Kiro"). */
export function getShortDisplayName(assistant: string): string {
  return descriptorMap.get(assistant)?.shortName ?? assistant;
}

export function getCliCommand(assistant: string): string {
  return descriptorMap.get(assistant)?.cliCommand ?? assistant;
}

/** Text shown in the TUI when the assistant is ready for input. */
export function getPromptCharacter(assistant: string): string {
  return descriptorMap.get(assistant)?.promptCharacter ?? '>';
}

/** CLI flag to auto-approve all tool calls. */
export function getAutoApproveFlag(assistant: string): string {
  return descriptorMap.get(assistant)?.autoApproveFlag ?? '';
}

/** CLI flag to resume a session. */
export function getResumeFlag(assistant: string): string {
  return descriptorMap.get(assistant)?.resumeFlag ?? '--resume';
}

/** Whether this assistant supports git worktree creation. */
export function getSupportsWorktree(assistant: string): boolean {
  return descriptorMap.get(assistant)?.supportsWorktree ?? false;
}

/** Whether this assistant supports image upload via clipboard paste. */
export function getSupportsImageUpload(assistant: string): boolean {
  return descriptorMap.get(assistant)?.supportsImageUpload ?? false;
}

/** Name of the config directory under $HOME (e.g. ".claude", ".gemini"). */
export function getConfigDirName(assistant: string): string {
  return descriptorMap.get(assistant)?.configDirName ?? `.${assistant}`;
}

/** Symbol used to mark user turns in conversation history UI. */
export function getHistoryPromptSymbol(assistant: string): string {
  return descriptorMap.get(assistant)?.historySymbol ?? '>';
}

/** npm package installation command. */
export function getInstallCommand(assistant: string): string {
  return descriptorMap.get(assistant)?.installCommand ?? '';
}

/** Whether this assistant needs a PATH override when running remotely. */
export function getNeedsRemotePathOverride(assistant: string): boolean {
  return descriptorMap.get(assistant)?.needsRemotePathOverride ?? false;
}

/** Pill badge color for the assistant (hex string). */
export function getAssistantColor(assistant: string): string {
  return descriptorMap.get(assistant)?.color ?? '#6b7280';
}

/** Whether to use bracketed paste (pastePrompt) instead of send-keys (sendPrompt) for tmux input. */
export function getUsesPasteInput(assistant: string): boolean {
  return descriptorMap.get(assistant)?.usesPasteInput ?? false;
}

/** Timeout in ms to wait for assistant to show its input prompt. */
export function getReadyTimeoutMs(assistant: string): number {
  return descriptorMap.get(assistant)?.readyTimeoutMs ?? 30_000;
}

/** Get the health status field name for an assistant (e.g., 'claudeAvailable'). */
export function getHealthAvailableKey(assistant: string): string {
  return `${assistant}Available`;
}
