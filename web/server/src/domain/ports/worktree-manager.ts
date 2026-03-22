import type { Worktree } from '@kanban-code/shared';

/** Port for managing git worktrees. */
export interface WorktreeManagerPort {
  listWorktrees(repoRoot: string): Promise<Worktree[]>;
  createWorktree(repoRoot: string, name: string): Promise<Worktree>;
  removeWorktree(path: string, force: boolean): Promise<void>;
}
