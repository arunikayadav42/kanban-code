import { describe, it, expect } from 'vitest';
import { findUnconfiguredPaths, normalizePath } from '../project-discovery.js';
import type { Project } from '@kanban-code/shared';

/** Helper to create a minimal Project with just a path. */
function makeProject(path: string): Project {
  return { path, name: path.split('/').pop() ?? path, visible: true };
}

describe('ProjectDiscovery', () => {
  describe('findUnconfiguredPaths', () => {
    it('finds unconfigured paths', () => {
      const projects = [makeProject('/Users/test/Projects/langwatch')];
      const sessionPaths: (string | null)[] = [
        '/Users/test/Projects/langwatch',
        '/Users/test/Projects/scenario',
        '/Users/test/Projects/kanban',
      ];

      const result = findUnconfiguredPaths(sessionPaths, projects);

      expect(result).toHaveLength(2);
      expect(result).toContain('/Users/test/Projects/scenario');
      expect(result).toContain('/Users/test/Projects/kanban');
    });

    it('ignores subdirectories of configured projects', () => {
      const projects = [makeProject('/Users/test/Projects/langwatch-saas')];
      const sessionPaths: (string | null)[] = [
        '/Users/test/Projects/langwatch-saas/langwatch',
        '/Users/test/Projects/langwatch-saas/api',
        '/Users/test/Projects/other',
      ];

      const result = findUnconfiguredPaths(sessionPaths, projects);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('/Users/test/Projects/other');
    });

    it('deduplicates paths', () => {
      const result = findUnconfiguredPaths(
        ['/Users/test/foo', '/Users/test/foo', '/Users/test/foo'],
        [],
      );

      expect(result).toHaveLength(1);
    });

    it('skips nil and empty paths', () => {
      const result = findUnconfiguredPaths(
        [null, '', null, '/Users/test/real'],
        [],
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('/Users/test/real');
    });

    it('returns sorted results', () => {
      const result = findUnconfiguredPaths(
        ['/z/path', '/a/path', '/m/path'],
        [],
      );

      expect(result).toEqual(['/a/path', '/m/path', '/z/path']);
    });

    it('returns empty for empty inputs', () => {
      const result = findUnconfiguredPaths([], []);
      expect(result).toHaveLength(0);
    });

    it('normalizes trailing slashes', () => {
      const projects = [makeProject('/Users/test/Projects/langwatch')];
      const sessionPaths: (string | null)[] = [
        '/Users/test/Projects/langwatch/',
      ];

      const result = findUnconfiguredPaths(sessionPaths, projects);

      expect(result).toHaveLength(0);
    });
  });

  describe('normalizePath', () => {
    it('strips trailing slashes', () => {
      expect(normalizePath('/foo/bar/')).toBe('/foo/bar');
    });

    it('strips multiple trailing slashes', () => {
      expect(normalizePath('/foo/bar///')).toBe('/foo/bar');
    });

    it('leaves root slash alone', () => {
      expect(normalizePath('/')).toBe('/');
    });

    it('expands tilde to home directory', () => {
      const result = normalizePath('~/Projects');
      expect(result).not.toContain('~');
      expect(result).toContain('Projects');
    });

    it('returns path unchanged when no trailing slash', () => {
      expect(normalizePath('/foo/bar')).toBe('/foo/bar');
    });
  });
});
