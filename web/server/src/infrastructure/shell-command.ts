import { execFile, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Runs shell commands and returns their output.
 * Resolves user login-shell environment for full PATH access.
 *
 * Swift source: Sources/KanbanCodeCore/Infrastructure/ShellCommand.swift
 * Spec: Section 7 (Infrastructure — 7 search paths, deadlock prevention, user env injection)
 */

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  succeeded: boolean;
}

/**
 * Cached user login-shell environment, resolved once on first use.
 * Node.js inherits the user's environment when run from terminal,
 * but when run as a system service or from a GUI launcher, PATH may be minimal.
 */
let cachedUserEnv: Record<string, string> | null = null;

function getUserEnvironment(): Record<string, string> {
  if (cachedUserEnv) return cachedUserEnv;

  try {
    const shell = process.env.SHELL ?? '/bin/zsh';
    const result = execFileSync(shell, ['-l', '-c', 'env'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const env: Record<string, string> = {};
    for (const line of result.split('\n')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.substring(0, eqIdx);
      const value = line.substring(eqIdx + 1);
      env[key] = value;
    }

    cachedUserEnv = Object.keys(env).length > 0 ? env : { ...process.env } as Record<string, string>;
  } catch {
    cachedUserEnv = { ...process.env } as Record<string, string>;
  }

  return cachedUserEnv;
}

/**
 * Run a command and capture its output.
 * Reads stdout/stderr BEFORE waiting for exit to prevent pipe deadlock.
 */
export async function run(
  executable: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    stdin?: string;
    timeout?: number;
    env?: Record<string, string>;
  },
): Promise<ShellResult> {
  const env = { ...getUserEnvironment(), ...(options?.env ?? {}) };

  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      {
        cwd: options?.cwd,
        env,
        timeout: options?.timeout ?? 30_000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        encoding: 'utf-8',
      },
      (error, stdout, stderr) => {
        // execFile callback fires after process exits with all output captured.
        // Node.js handles the pipe buffer internally — no deadlock risk.
        const exitCode = error && 'code' in error ? (error.code as number) ?? 1 : 0;
        resolve({
          exitCode,
          stdout: (stdout ?? '').trim(),
          stderr: (stderr ?? '').trim(),
          succeeded: exitCode === 0,
        });
      },
    );

    // Write stdin if provided
    if (options?.stdin && child.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }
  });
}

/**
 * Check if a command is available on the system.
 */
export async function isAvailable(command: string): Promise<boolean> {
  return findExecutable(command) !== null;
}

/**
 * Resolve a command name to an absolute path by checking common locations
 * plus the user's login-shell PATH (which includes nvm, volta, fnm, etc.).
 *
 * Search order (7 priority paths, matches Swift exactly):
 * 1. ~/.claude/local  (Claude Code managed install)
 * 2. ~/.local/bin     (XDG local bin / claude installer)
 * 3. /opt/homebrew/bin (Homebrew Apple Silicon)
 * 4. /usr/local/bin    (Homebrew Intel / npm global)
 * 5. /usr/bin          (System binaries)
 * 6. /bin              (Core system binaries)
 * 7. User's PATH from login shell (nvm, volta, fnm, etc.)
 */
export function findExecutable(command: string): string | null {
  const home = os.homedir();
  const searchPaths: string[] = [
    path.join(home, '.claude', 'local'),   // Claude Code managed install
    path.join(home, '.local', 'bin'),      // XDG local bin / claude installer
    '/opt/homebrew/bin',                   // Homebrew (Apple Silicon)
    '/usr/local/bin',                      // Homebrew (Intel) / npm global
    '/usr/bin',                            // System binaries
    '/bin',                                // Core system binaries
  ];

  // Also search the user's real PATH (resolved from login shell)
  const userPath = getUserEnvironment().PATH ?? '';
  for (const dir of userPath.split(':')) {
    if (dir && !searchPaths.includes(dir)) {
      searchPaths.push(dir);
    }
  }

  for (const dir of searchPaths) {
    const fullPath = path.join(dir, command);
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return fullPath;
    } catch {
      // not found or not executable — continue
    }
  }

  return null;
}

/** Reset cached environment (for testing). */
export function _resetCache(): void {
  cachedUserEnv = null;
}
