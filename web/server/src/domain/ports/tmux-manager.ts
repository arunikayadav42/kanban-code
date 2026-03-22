import type { TmuxSession } from '@kanban-code/shared';

/** Port for managing tmux sessions. */
export interface TmuxManagerPort {
  listSessions(): Promise<TmuxSession[]>;
  createSession(name: string, path: string, command?: string | null): Promise<void>;
  killSession(name: string): Promise<void>;
  findSessionForWorktree(sessions: TmuxSession[], worktreePath: string, branch?: string | null): TmuxSession | null;
  sendPrompt(sessionName: string, text: string): Promise<void>;
  pastePrompt(sessionName: string, text: string): Promise<void>;
  capturePane(sessionName: string): Promise<string>;
  sendBracketedPaste(sessionName: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
