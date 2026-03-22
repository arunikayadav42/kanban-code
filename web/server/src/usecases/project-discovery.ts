/**
 * Detects project paths from sessions that aren't yet configured.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/ProjectDiscovery.swift
 */

import os from 'os';
import type { Project } from '@kanban-code/shared';

/**
 * Given all session project paths and configured projects,
 * return unique paths that are not yet configured.
 */
export function findUnconfiguredPaths(
  sessionPaths: (string | null)[],
  configuredProjects: Project[],
): string[] {
  const configuredPaths = new Set(configuredProjects.map((p) => normalizePath(p.path)));

  const seen = new Set<string>();
  const unconfigured: string[] = [];

  for (const rawPath of sessionPaths) {
    if (rawPath == null || rawPath === '') continue;

    const normalized = normalizePath(rawPath);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // Skip if this path matches a configured project or is a subdirectory of one
    if (configuredPaths.has(normalized)) continue;
    if (isSubdirectory(normalized, configuredPaths)) continue;

    unconfigured.push(rawPath);
  }

  return unconfigured.sort();
}

/** Normalize a path: expand ~, remove trailing slashes. */
export function normalizePath(pathStr: string): string {
  let p = pathStr;

  // Expand tilde (matches Swift's NSString.expandingTildeInPath)
  if (p.startsWith('~/')) {
    p = os.homedir() + p.slice(1);
  } else if (p === '~') {
    p = os.homedir();
  }

  // Strip trailing slashes (but keep root /)
  while (p.endsWith('/') && p.length > 1) {
    p = p.slice(0, -1);
  }

  return p;
}

/** Check if `path` is a subdirectory of any path in `parents`. */
function isSubdirectory(pathStr: string, parents: Set<string>): boolean {
  for (const parent of parents) {
    if (pathStr.startsWith(parent + '/')) {
      return true;
    }
  }
  return false;
}
