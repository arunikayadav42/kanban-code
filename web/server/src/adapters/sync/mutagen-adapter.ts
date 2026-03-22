import type { SyncManagerPort, SyncStatus } from '../../domain/ports/sync-manager.js';
import { run, findExecutable } from '../../infrastructure/shell-command.js';

/**
 * Manages Mutagen sync sessions via the mutagen CLI.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Sync/MutagenAdapter.swift (157 lines)
 * Spec: Section 7 (Infrastructure)
 *
 * Implements SyncManagerPort. Key features:
 * - startSync: label-based, default ignores, two-way-resolved mode
 * - stopSync: terminate by label selector
 * - flushSync: force flush by label selector
 * - status: parse template output into SyncStatus map
 * - rawStatus: raw `mutagen sync list -l` output
 * - resetSync: pause + resume to unstick sessions
 * - isAvailable: check if mutagen binary exists
 */

/** Default ignore patterns for mutagen sync (matching claude-remote + Swift/Rust). */
export const DEFAULT_IGNORES: string[] = [
  'node_modules', '.venv', '.cache', 'dist', '.next*',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.turbo',
  '*.pyc', '.DS_Store', 'coverage', '.nyc_output',
  'target', 'build', '.build', '.swiftpm',
];

export class MutagenAdapter implements SyncManagerPort {
  private readonly label: string;
  private readonly mutagenPath: string;

  constructor(label: string = 'kanban') {
    this.label = label;
    this.mutagenPath = findExecutable('mutagen') ?? 'mutagen';
  }

  async startSync(
    localPath: string,
    remotePath: string,
    name: string,
    ignores: string[] = DEFAULT_IGNORES,
  ): Promise<void> {
    // Check for ANY existing kanban sync session -- there should only ever be one
    try {
      const listResult = await run(this.mutagenPath, [
        'sync', 'list', '--label-selector', `${this.label}=true`,
      ]);
      if (listResult.succeeded && listResult.stdout.includes('Name:')) {
        // Already running -- just flush and return
        await this.flushSync().catch(() => { /* best-effort */ });
        return;
      }
    } catch {
      // continue to create
    }

    const args = [
      'sync', 'create',
      localPath, remotePath,
      '--name', name,
      '--label', `${this.label}=true`,
      '--sync-mode', 'two-way-resolved',
      '--default-file-mode-beta', '0644',
      '--default-directory-mode-beta', '0755',
    ];
    for (const pattern of ignores) {
      args.push('--ignore', pattern);
    }

    const result = await run(this.mutagenPath, args);
    if (!result.succeeded) {
      throw new MutagenError('createFailed', name, result.stderr);
    }
  }

  /** Reset a stuck or errored sync session by pausing then resuming. */
  async resetSync(name: string): Promise<void> {
    const selector = '--label-selector';
    const labelFilter = `${this.label}=true`;
    await run(this.mutagenPath, ['sync', 'pause', selector, labelFilter]);
    const result = await run(this.mutagenPath, ['sync', 'resume', selector, labelFilter]);
    if (!result.succeeded) {
      throw new MutagenError('resetFailed', name, result.stderr);
    }
  }

  async stopSync(name: string): Promise<void> {
    const result = await run(this.mutagenPath, [
      'sync', 'terminate', '--label-selector', `${this.label}=true`,
    ]);
    if (!result.succeeded) {
      throw new MutagenError('terminateFailed', name, result.stderr);
    }
  }

  async flushSync(): Promise<void> {
    const result = await run(this.mutagenPath, [
      'sync', 'flush', '--label-selector', `${this.label}=true`,
    ]);
    if (!result.succeeded) {
      throw new MutagenError('flushFailed', '', result.stderr);
    }
  }

  async status(): Promise<Record<string, SyncStatus>> {
    const template = '{{range .}}{{.Name}}|{{.Status}}|{{len .Conflicts}}|{{.Paused}}{{"\\n"}}{{end}}';
    const result = await run(this.mutagenPath, [
      'sync', 'list',
      '--label-selector', `${this.label}=true`,
      '--template', template,
    ]);

    if (!result.succeeded || !result.stdout) return {};

    const statuses: Record<string, SyncStatus> = {};
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      if (parts.length < 4) continue;

      const name = parts[0];
      const statusStr = parts[1].toLowerCase();
      const conflictCount = parseInt(parts[2], 10) || 0;
      const paused = parts[3] === 'true';

      let status: SyncStatus;
      if (paused) {
        status = 'paused';
      } else if (conflictCount > 0) {
        status = 'conflicts';
      } else {
        switch (statusStr) {
          case 'watching':
            status = 'watching';
            break;
          case 'scanning':
          case 'staging':
          case 'transitioning':
          case 'reconciling':
          case 'saving':
            status = 'staging';
            break;
          case 'halted':
            status = 'paused';
            break;
          default:
            status = 'error';
        }
      }

      statuses[name] = status;
    }

    return statuses;
  }

  async rawStatus(): Promise<string> {
    const result = await run(this.mutagenPath, ['sync', 'list', '-l']);
    const output = result.stdout.trim();
    if (!output) {
      return 'No sync sessions running.';
    }
    return output;
  }

  async isAvailable(): Promise<boolean> {
    return findExecutable('mutagen') !== null;
  }
}

// MARK: - Error

export type MutagenErrorCode = 'createFailed' | 'terminateFailed' | 'resetFailed' | 'flushFailed';

export class MutagenError extends Error {
  constructor(
    public readonly code: MutagenErrorCode,
    public readonly sessionName: string,
    public readonly detail: string,
  ) {
    const messages: Record<MutagenErrorCode, string> = {
      createFailed: `Failed to create sync '${sessionName}': ${detail}`,
      terminateFailed: `Failed to terminate sync '${sessionName}': ${detail}`,
      resetFailed: `Failed to reset sync: ${detail}`,
      flushFailed: `Failed to flush sync: ${detail}`,
    };
    super(messages[code]);
    this.name = 'MutagenError';
  }
}
