import type { CodingAssistant } from '@kanban-code/shared';
import { getCliCommand, getAutoApproveFlag, getResumeFlag, getSupportsWorktree } from '@kanban-code/shared';
import type { TmuxManagerPort } from '../domain/ports/tmux-manager.js';

/**
 * Launches a coding assistant session inside a tmux session.
 * Does NOT manage Link records — the caller owns link lifecycle.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/LaunchSession.swift (145 lines)
 * Spec: Section 4.2 (Session Launch Flow)
 */

export class LaunchSession {
  constructor(private readonly tmux: TmuxManagerPort) {}

  async launch(options: {
    sessionName: string;
    projectPath: string;
    prompt: string;
    worktreeName?: string | null;
    shellOverride?: string | null;
    extraEnv?: Record<string, string>;
    commandOverride?: string | null;
    skipPermissions?: boolean;
    preamble?: string | null;
    assistant: CodingAssistant;
  }): Promise<string> {
    const assistant = options.assistant;

    let cmd: string;
    if (options.commandOverride && options.commandOverride.length > 0) {
      cmd = options.commandOverride;
    } else {
      let built = getCliCommand(assistant);
      if (options.skipPermissions) built += ` ${getAutoApproveFlag(assistant)}`;
      // Append prompt as positional arg: claude "prompt" / kiro-cli chat "prompt"
      if (options.prompt && options.prompt.length > 0) {
        built += ` ${shellEscape(options.prompt)}`;
      }
      if (getSupportsWorktree(assistant) && options.worktreeName !== undefined && options.worktreeName !== null) {
        if (options.worktreeName.length === 0) {
          built += ' --worktree';
        } else {
          built += ` --worktree ${options.worktreeName}`;
        }
      }

      const envPrefix = buildEnvPrefix(options.shellOverride ?? null, options.extraEnv ?? {});
      if (envPrefix.length > 0) {
        built = `${envPrefix} ${built}`;
      }
      cmd = built;
    }

    let fullCmd = `cd ${shellEscape(options.projectPath)}`;
    if (options.preamble && options.preamble.length > 0) {
      fullCmd += ` && ${options.preamble}`;
    }
    fullCmd += ` && ${cmd}`;

    // Kill any stale session with the same name before launching
    try { await this.tmux.killSession(options.sessionName); } catch { /* ignore */ }

    await this.tmux.createSession(options.sessionName, options.projectPath, fullCmd);
    return options.sessionName;
  }

  async resume(options: {
    sessionId: string;
    projectPath: string;
    shellOverride?: string | null;
    extraEnv?: Record<string, string>;
    commandOverride?: string | null;
    skipPermissions?: boolean;
    preamble?: string | null;
    assistant: CodingAssistant;
  }): Promise<string> {
    const assistant = options.assistant;

    // Kill stale session if one exists
    const existing = await this.tmux.listSessions();
    const stale = existing.find(s => s.name.includes(options.sessionId.substring(0, 8)));
    if (stale) {
      try { await this.tmux.killSession(stale.name); } catch { /* ignore */ }
    }

    const sessionName = `${getCliCommand(assistant)}-${options.sessionId.substring(0, 8)}`;

    let cmd: string;
    if (options.commandOverride && options.commandOverride.length > 0) {
      cmd = options.commandOverride;
    } else {
      let built = getCliCommand(assistant);
      if (options.skipPermissions) built += ` ${getAutoApproveFlag(assistant)}`;
      built += ` ${getResumeFlag(assistant)} ${options.sessionId}`;

      const envPrefix = buildEnvPrefix(options.shellOverride ?? null, options.extraEnv ?? {});
      if (envPrefix.length > 0) {
        built = `${envPrefix} ${built}`;
      }
      cmd = built;
    }

    let fullCmd = `cd ${shellEscape(options.projectPath)}`;
    if (options.preamble && options.preamble.length > 0) {
      fullCmd += ` && ${options.preamble}`;
    }
    fullCmd += ` && ${cmd}`;

    await this.tmux.createSession(sessionName, options.projectPath, fullCmd);
    return sessionName;
  }
}

/** Build a string of VAR=value assignments to prepend to the command. */
function buildEnvPrefix(shellOverride: string | null, extraEnv: Record<string, string>): string {
  const parts: string[] = [];

  if (shellOverride) {
    parts.push(`SHELL=${shellOverride}`);
  }

  for (const key of Object.keys(extraEnv).sort()) {
    const value = extraEnv[key];
    if (value.includes('$')) {
      // Double quotes so shell variables get expanded
      const escaped = value.replace(/"/g, '\\"');
      parts.push(`${key}="${escaped}"`);
    } else {
      parts.push(`${key}=${shellEscape(value)}`);
    }
  }

  return parts.join(' ');
}

/** Tmux session name for a project+worktree combination. */
export function tmuxSessionName(project: string, worktree?: string | null): string {
  const projectName = project.split('/').filter(Boolean).pop() ?? project;
  if (worktree) return `${projectName}-${worktree}`;
  return projectName;
}

function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}
