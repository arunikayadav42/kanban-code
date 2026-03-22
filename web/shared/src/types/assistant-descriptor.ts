/**
 * Descriptor for a coding assistant plugin.
 *
 * Each supported CLI tool (Claude Code, Gemini CLI, Kiro CLI, etc.) provides
 * a `descriptor.json` conforming to this interface. The plugin loader reads
 * these at startup so engine code never needs hardcoded switch statements.
 *
 * Spec: docs/superpowers/specs/2026-03-15-assistant-plugin-architecture-design.md
 */
export interface AssistantDescriptor {
  /** Unique identifier -- used as CodingAssistant type value */
  id: string;
  /** Full display name: "Claude Code", "Kiro CLI" */
  displayName: string;
  /** Short name for inline use: "Claude", "Kiro" */
  shortName: string;
  /** CLI command to launch (including subcommand): "claude", "kiro-cli chat" */
  cliCommand: string;
  /** Binary to check for availability (may differ from cliCommand): "claude", "kiro-cli" */
  availabilityCheck: string;
  /** Text shown when assistant is ready for input */
  promptCharacter: string;
  /** Flag to skip permission prompts */
  autoApproveFlag: string;
  /** Flag to resume a session */
  resumeFlag: string;
  /** Config directory name under ~/ */
  configDirName: string;
  /** Symbol shown in conversation history for user turns */
  historySymbol: string;
  /** Shell command to install the CLI */
  installCommand: string;
  /** Whether this assistant supports git worktrees */
  supportsWorktree: boolean;
  /** Whether this assistant supports image upload */
  supportsImageUpload: boolean;
  /** Whether PATH override needed for remote execution */
  needsRemotePathOverride: boolean;
  /** Whether to use bracketed paste (pastePrompt) instead of send-keys (sendPrompt) for tmux input */
  usesPasteInput: boolean;
  /** Timeout in ms to wait for assistant to show its input prompt (default 30000) */
  readyTimeoutMs: number;
  /** Hook configuration */
  hooks: {
    /** Hook event names this assistant fires */
    events: string[];
    /** Path to hook config file relative to configDir */
    configPath: string;
    /** Config file format: "nested" (Claude/Gemini) or "flat" (Kiro) */
    configFormat: 'nested' | 'flat';
    /** Event name normalization map: { "agentSpawn": "SessionStart" } */
    normalize: Record<string, string>;
  };
  /** Pill badge color for card UI (hex string, e.g. "#f97316") */
  color?: string;
  /** SVG icon for UI */
  icon: {
    /** SVG path data for the assistant icon */
    svgPath: string;
    /** ViewBox (default "0 0 16 16") */
    viewBox?: string;
  };
}
