/**
 * Manages git worktrees via the git CLI.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Git/GitWorktreeAdapter.swift
 */

import path from 'path';
import type { Worktree } from '@kanban-code/shared';
import type { WorktreeManagerPort } from '../../domain/ports/worktree-manager.js';
import type { ShellResult } from '../../infrastructure/shell-command.js';
import { run as shellRun, findExecutable } from '../../infrastructure/shell-command.js';

/** Function signature for running shell commands (injectable for testing). */
type RunFn = (
  executable: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<ShellResult>;

export class GitWorktreeAdapter implements WorktreeManagerPort {
  private readonly gitPath: string;
  private readonly run: RunFn;

  constructor(gitPath?: string, runFn?: RunFn) {
    this.gitPath = gitPath ?? findExecutable('git') ?? '/usr/bin/git';
    this.run = runFn ?? shellRun;
  }

  async listWorktrees(repoRoot: string): Promise<Worktree[]> {
    const result = await this.run(
      this.gitPath,
      ['worktree', 'list', '--porcelain'],
      { cwd: repoRoot },
    );

    if (!result.succeeded) return [];

    return parseWorktreeList(result.stdout);
  }

  async createWorktree(repoRoot: string, name: string): Promise<Worktree> {
    const worktreePath = path.join(repoRoot, '.worktrees', name);
    const result = await this.run(
      this.gitPath,
      ['worktree', 'add', '-b', name, worktreePath],
      { cwd: repoRoot },
    );

    if (!result.succeeded) {
      throw new WorktreeError(`Failed to create worktree '${name}': ${result.stderr}`);
    }

    return { path: worktreePath, branch: name, isBare: false };
  }

  async removeWorktree(worktreePath: string, force: boolean): Promise<void> {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(worktreePath);

    // Derive repo root from worktree path (e.g. /repo/.claude/worktrees/name -> /repo)
    let repoRoot: string;
    const markerIdx = worktreePath.indexOf('/.claude/worktrees/');
    if (markerIdx !== -1) {
      repoRoot = worktreePath.substring(0, markerIdx);
    } else {
      repoRoot = path.dirname(worktreePath);
    }

    const result = await this.run(this.gitPath, args, { cwd: repoRoot });

    if (!result.succeeded) {
      throw new WorktreeError(`Failed to remove worktree '${worktreePath}': ${result.stderr}`);
    }
  }
}

/** Parse `git worktree list --porcelain` output. */
export function parseWorktreeList(output: string): Worktree[] {
  if (!output) return [];

  const worktrees: Worktree[] = [];
  let currentPath: string | null = null;
  let currentBranch: string | null = null;
  let isBare = false;

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      // Save previous worktree if any
      if (currentPath !== null) {
        worktrees.push({ path: currentPath, branch: currentBranch, isBare });
      }
      currentPath = line.slice('worktree '.length);
      currentBranch = null;
      isBare = false;
    } else if (line.startsWith('branch refs/heads/')) {
      currentBranch = line.slice('branch refs/heads/'.length);
    } else if (line === 'bare') {
      isBare = true;
    }
  }

  // Save last worktree
  if (currentPath !== null) {
    worktrees.push({ path: currentPath, branch: currentBranch, isBare });
  }

  return worktrees;
}

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeError';
  }
}
