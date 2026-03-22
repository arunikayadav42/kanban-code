import fs from 'fs';
import type { TmuxSession } from '@kanban-code/shared';
import type { TmuxManagerPort } from '../../domain/ports/tmux-manager.js';
import { run, findExecutable } from '../../infrastructure/shell-command.js';
import { info, error as logError } from '../../infrastructure/logger.js';

/**
 * Manages tmux sessions via the tmux CLI.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Tmux/TmuxAdapter.swift (187 lines)
 * Spec: Section 4.1 (all tmux commands)
 */

/** Sanitize session name to match what tmux does internally (dots/colons → underscores). */
function sanitizeName(name: string): string {
  return name.replace(/[.:]/g, '_');
}

export class TmuxAdapter implements TmuxManagerPort {
  private readonly tmuxPath: string;

  constructor(tmuxPath?: string) {
    this.tmuxPath = tmuxPath ?? findExecutable('tmux') ?? 'tmux';
  }

  async listSessions(): Promise<TmuxSession[]> {
    const result = await run(this.tmuxPath, [
      'list-sessions', '-F', '#{session_name}\t#{session_path}\t#{session_attached}',
    ]);

    // tmux returns exit code 1 with "no server running" when there are no sessions
    if (!result.succeeded || !result.stdout) return [];

    return result.stdout.split('\n').filter(Boolean).map(line => {
      const parts = line.split('\t');
      if (parts.length < 3) return null;
      return {
        name: parts[0],
        path: parts[1],
        attached: parts[2] === '1',
      };
    }).filter((s): s is TmuxSession => s !== null);
  }

  async createSession(name: string, path: string, command?: string | null): Promise<void> {
    const safeName = sanitizeName(name);
    // If session already exists, reuse it (prevents killing active terminal)
    const check = await run(this.tmuxPath, ['has-session', '-t', safeName]);
    if (check.succeeded) return;

    // Create session with shell (no command arg) — shell stays alive if command exits
    const result = await run(this.tmuxPath, ['new-session', '-d', '-s', safeName, '-c', path]);
    if (!result.succeeded) {
      throw new TmuxError('createFailed', safeName, result.stderr);
    }

    if (command && command.length > 0) {
      if (command.includes('\n')) {
        // Multi-line: write temp file and source it
        const tempFile = `/tmp/kanban-code-launch-${safeName}.sh`;
        fs.writeFileSync(tempFile, command, 'utf-8');
        const sendResult = await run(this.tmuxPath, [
          'send-keys', '-t', safeName, `. '${tempFile}' ; rm -f '${tempFile}'`, 'Enter',
        ]);
        if (!sendResult.succeeded) {
          logError('tmux', `send-keys (source) failed for ${safeName}: ${sendResult.stderr}`);
        }
      } else {
        // Single-line: send directly
        const sendResult = await run(this.tmuxPath, [
          'send-keys', '-t', safeName, command, 'Enter',
        ]);
        if (!sendResult.succeeded) {
          logError('tmux', `send-keys failed for ${safeName}: ${sendResult.stderr}`);
        }
      }
    }
  }

  async killSession(name: string): Promise<void> {
    const safeName = sanitizeName(name);
    const result = await run(this.tmuxPath, ['kill-session', '-t', safeName]);
    if (!result.succeeded) {
      throw new TmuxError('killFailed', safeName, result.stderr);
    }
  }

  async sendPrompt(sessionName: string, text: string): Promise<void> {
    const safeName = sanitizeName(sessionName);
    // Send text literally (-l avoids interpreting special keys)
    await run(this.tmuxPath, ['send-keys', '-t', safeName, '-l', text]);
    // Press Enter to submit
    await run(this.tmuxPath, ['send-keys', '-t', safeName, 'Enter']);
  }

  async pastePrompt(sessionName: string, text: string): Promise<void> {
    const safeName = sanitizeName(sessionName);
    // Use load-buffer + paste-buffer -p for bracketed paste
    // (Gemini CLI treats special chars literally in bracketed paste mode)
    const tempFile = `/tmp/kanban-code-paste-${process.pid}.txt`;
    fs.writeFileSync(tempFile, text, 'utf-8');
    try {
      await run(this.tmuxPath, ['load-buffer', tempFile]);
      await run(this.tmuxPath, ['paste-buffer', '-p', '-t', safeName]);
      // Press Enter to submit
      await run(this.tmuxPath, ['send-keys', '-t', safeName, 'Enter']);
    } finally {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    }
  }

  async capturePane(sessionName: string): Promise<string> {
    const result = await run(this.tmuxPath, ['capture-pane', '-p', '-t', sanitizeName(sessionName)]);
    return result.stdout;
  }

  async sendBracketedPaste(sessionName: string): Promise<void> {
    const safeName = sanitizeName(sessionName);
    // Send empty bracketed paste: ESC[200~ ESC[201~
    // Claude Code detects the paste event and checks clipboard for images
    await run(this.tmuxPath, [
      'send-keys', '-t', safeName, '\x1b[200~\x1b[201~',
    ]);
  }

  findSessionForWorktree(
    sessions: TmuxSession[],
    worktreePath: string,
    branch?: string | null,
  ): TmuxSession | null {
    // Priority 1: Exact path match
    const byPath = sessions.find(s => s.path === worktreePath);
    if (byPath) return byPath;

    // Priority 2: Session name matches directory name
    const dirName = worktreePath.split('/').filter(Boolean).pop() ?? '';
    const byDirName = sessions.find(s => s.name === dirName);
    if (byDirName) return byDirName;

    // Priority 3: Branch name match
    if (branch) {
      const byBranch = sessions.find(s => s.name === branch);
      if (byBranch) return byBranch;

      // Priority 4: Branch with slashes replaced by dashes
      const dashBranch = branch.replace(/\//g, '-');
      if (dashBranch !== branch) {
        const byDashBranch = sessions.find(s => s.name === dashBranch);
        if (byDashBranch) return byDashBranch;
      }
    }

    return null;
  }

  async isAvailable(): Promise<boolean> {
    return findExecutable('tmux') !== null;
  }
}

export class TmuxError extends Error {
  constructor(
    public readonly code: 'createFailed' | 'killFailed',
    public readonly sessionName: string,
    public readonly detail: string,
  ) {
    super(
      code === 'createFailed'
        ? `Failed to create tmux session '${sessionName}': ${detail}`
        : `Failed to kill tmux session '${sessionName}': ${detail}`,
    );
    this.name = 'TmuxError';
  }
}
