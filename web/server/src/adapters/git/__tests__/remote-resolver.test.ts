import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitRemoteResolver, parseGitHubURL, issueURL, prURL } from '../remote-resolver.js';

describe('GitRemoteResolver', () => {
  describe('parseGitHubURL', () => {
    it('parses SSH remote URL', () => {
      const result = parseGitHubURL('git@github.com:langwatch/langwatch.git');
      expect(result).toBe('https://github.com/langwatch/langwatch');
    });

    it('parses HTTPS remote URL', () => {
      const result = parseGitHubURL('https://github.com/langwatch/langwatch.git');
      expect(result).toBe('https://github.com/langwatch/langwatch');
    });

    it('parses HTTPS remote URL without .git suffix', () => {
      const result = parseGitHubURL('https://github.com/owner/repo');
      expect(result).toBe('https://github.com/owner/repo');
    });

    it('returns null for non-GitHub remote', () => {
      const result = parseGitHubURL('git@gitlab.com:owner/repo.git');
      expect(result).toBeNull();
    });

    it('normalizes http to https', () => {
      const result = parseGitHubURL('http://github.com/owner/repo.git');
      expect(result).toBe('https://github.com/owner/repo');
    });
  });

  describe('issueURL', () => {
    it('constructs full issue URL', () => {
      const url = issueURL('https://github.com/langwatch/langwatch', 42);
      expect(url).toBe('https://github.com/langwatch/langwatch/issues/42');
    });
  });

  describe('prURL', () => {
    it('constructs full PR URL', () => {
      const url = prURL('https://github.com/langwatch/langwatch', 17);
      expect(url).toBe('https://github.com/langwatch/langwatch/pull/17');
    });
  });

  describe('githubBaseURL', () => {
    it('resolves GitHub base URL from git remote', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: true,
        stdout: 'git@github.com:langwatch/langwatch.git',
        stderr: '',
        exitCode: 0,
      });

      const resolver = new GitRemoteResolver(mockRun);
      const url = await resolver.githubBaseURL('/Users/me/langwatch');

      expect(url).toBe('https://github.com/langwatch/langwatch');
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        ['remote', 'get-url', 'origin'],
        { cwd: '/Users/me/langwatch' },
      );
    });

    it('returns null when git command fails', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: false,
        stdout: '',
        stderr: 'not a git repo',
        exitCode: 128,
      });

      const resolver = new GitRemoteResolver(mockRun);
      const url = await resolver.githubBaseURL('/not-a-repo');
      expect(url).toBeNull();
    });

    it('caches results', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: true,
        stdout: 'git@github.com:owner/repo.git',
        stderr: '',
        exitCode: 0,
      });

      const resolver = new GitRemoteResolver(mockRun);
      await resolver.githubBaseURL('/project');
      await resolver.githubBaseURL('/project');

      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('caches null results (negative cache)', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: false,
        stdout: '',
        stderr: 'error',
        exitCode: 1,
      });

      const resolver = new GitRemoteResolver(mockRun);
      await resolver.githubBaseURL('/bad');
      await resolver.githubBaseURL('/bad');

      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('returns null for non-GitHub remote', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: true,
        stdout: 'git@gitlab.com:owner/repo.git',
        stderr: '',
        exitCode: 0,
      });

      const resolver = new GitRemoteResolver(mockRun);
      const url = await resolver.githubBaseURL('/gitlab-project');
      expect(url).toBeNull();
    });
  });
});
