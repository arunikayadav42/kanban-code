import type { CodingAssistant } from '@kanban-code/shared';

/** Port for launching and resuming AI CLI sessions. */
export interface SessionLauncher {
  launch(options: {
    sessionName: string;
    projectPath: string;
    prompt: string;
    worktreeName?: string | null;
    shellOverride?: string | null;
    extraEnv?: Record<string, string>;
    commandOverride?: string | null;
    skipPermissions?: boolean;
    preamble?: string | null;
    assistant?: CodingAssistant;
  }): Promise<string>; // returns tmux session name

  resume(options: {
    sessionId: string;
    projectPath: string;
    shellOverride?: string | null;
    extraEnv?: Record<string, string>;
    commandOverride?: string | null;
    skipPermissions?: boolean;
    preamble?: string | null;
    assistant?: CodingAssistant;
  }): Promise<string>; // returns tmux session name
}
