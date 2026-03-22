/**
 * A git worktree on disk.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/Worktree.swift
 */

export interface Worktree {
  path: string;
  branch: string | null;
  isBare: boolean;
}

/** The last path component (directory name). */
export function getDirectoryName(worktree: Worktree): string {
  const parts = worktree.path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? worktree.path;
}
