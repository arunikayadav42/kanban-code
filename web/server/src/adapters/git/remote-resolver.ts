/**
 * Resolves a GitHub base URL from a local git repo's remote.
 * Results are cached in memory.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Git/GitRemoteResolver.swift
 */

import type { ShellResult } from '../../infrastructure/shell-command.js';
import { run as shellRun, findExecutable } from '../../infrastructure/shell-command.js';

/** Function signature for running shell commands (injectable for testing). */
type RunFn = (
  executable: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<ShellResult>;

export class GitRemoteResolver {
  private readonly cache = new Map<string, string | null>();
  private readonly gitPath: string;
  private readonly run: RunFn;

  constructor(runFn?: RunFn, gitPath?: string) {
    this.gitPath = gitPath ?? findExecutable('git') ?? '/usr/bin/git';
    this.run = runFn ?? shellRun;
  }

  /**
   * Returns the GitHub base URL for a repo at the given path, or null if not a GitHub repo.
   * Example: "/Users/me/projects/langwatch" -> "https://github.com/langwatch/langwatch"
   */
  async githubBaseURL(projectPath: string): Promise<string | null> {
    if (this.cache.has(projectPath)) {
      return this.cache.get(projectPath) ?? null;
    }

    let url: string | null = null;
    try {
      const result = await this.run(
        this.gitPath,
        ['remote', 'get-url', 'origin'],
        { cwd: projectPath },
      );

      if (result.succeeded && result.stdout) {
        url = parseGitHubURL(result.stdout.trim());
      }
    } catch {
      // git command failed entirely — leave url as null
    }

    this.cache.set(projectPath, url);
    return url;
  }
}

/** Construct a full issue URL. */
export function issueURL(base: string, number: number): string {
  return `${base}/issues/${number}`;
}

/** Construct a full PR URL. */
export function prURL(base: string, number: number): string {
  return `${base}/pull/${number}`;
}

/**
 * Parse a git remote URL into a GitHub base URL.
 * Handles: git@github.com:owner/repo.git, https://github.com/owner/repo.git, etc.
 */
export function parseGitHubURL(remote: string): string | null {
  // SSH: git@github.com:owner/repo.git
  if (remote.includes('github.com:')) {
    const parts = remote.split('github.com:');
    if (parts.length !== 2) return null;
    const repoPath = parts[1].replace('.git', '');
    return `https://github.com/${repoPath}`;
  }

  // HTTPS: https://github.com/owner/repo.git
  if (remote.includes('github.com/')) {
    let cleaned = remote;
    if (cleaned.endsWith('.git')) {
      cleaned = cleaned.slice(0, -4);
    }
    // Normalize to https
    if (cleaned.startsWith('http://')) {
      cleaned = 'https://' + cleaned.slice(7);
    }
    return cleaned;
  }

  return null;
}

/** Singleton instance for use across the application. */
let sharedInstance: GitRemoteResolver | null = null;

export function getSharedResolver(): GitRemoteResolver {
  if (!sharedInstance) {
    sharedInstance = new GitRemoteResolver();
  }
  return sharedInstance;
}
