import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GhCliAdapter, GhCliError } from '../gh-cli-adapter.js';

/**
 * GhCliAdapter tests.
 * Since gh CLI requires auth, we test:
 * - Pure logic (parsePRFromGraphQL behavior via batchPRLookup/enrichPRDetails)
 * - Error handling (rate limits)
 * - isAvailable (returns boolean without crashing)
 * - MergeResult types
 * - GhCliError construction
 */

// Mock shell-command to avoid actual CLI calls
vi.mock('../../../infrastructure/shell-command.js', () => ({
  run: vi.fn(),
  findExecutable: vi.fn().mockReturnValue('/usr/local/bin/gh'),
}));

import { run, findExecutable } from '../../../infrastructure/shell-command.js';

const mockRun = vi.mocked(run);
const mockFindExecutable = vi.mocked(findExecutable);

describe('GhCliAdapter', () => {
  let adapter: GhCliAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindExecutable.mockReturnValue('/usr/local/bin/gh');
    adapter = new GhCliAdapter();
  });

  describe('fetchPRs', () => {
    it('parses PR list JSON correctly', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify([
          { number: 1, title: 'Fix bug', state: 'OPEN', url: 'https://github.com/test/pr/1', headRefName: 'fix-bug', reviewDecision: 'REVIEW_REQUIRED' },
          { number: 2, title: 'Add feature', state: 'MERGED', url: 'https://github.com/test/pr/2', headRefName: 'add-feature', reviewDecision: 'APPROVED' },
        ]),
        stderr: '',
        succeeded: true,
      });

      const prs = await adapter.fetchPRs('/project');
      expect(Object.keys(prs).length).toBe(2);
      expect(prs['fix-bug'].number).toBe(1);
      expect(prs['fix-bug'].state).toBe('open');
      expect(prs['add-feature'].state).toBe('merged');
    });

    it('prefers open PRs over closed for same branch', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify([
          { number: 1, title: 'Old PR', state: 'CLOSED', url: 'url1', headRefName: 'feat-x', reviewDecision: null },
          { number: 2, title: 'New PR', state: 'OPEN', url: 'url2', headRefName: 'feat-x', reviewDecision: null },
        ]),
        stderr: '',
        succeeded: true,
      });

      const prs = await adapter.fetchPRs('/project');
      expect(prs['feat-x'].number).toBe(2);
      expect(prs['feat-x'].state).toBe('open');
    });

    it('returns empty on failure', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'not authenticated',
        succeeded: false,
      });

      const prs = await adapter.fetchPRs('/project');
      expect(Object.keys(prs).length).toBe(0);
    });

    it('returns empty on invalid JSON', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'not json',
        stderr: '',
        succeeded: true,
      });

      const prs = await adapter.fetchPRs('/project');
      expect(Object.keys(prs).length).toBe(0);
    });
  });

  describe('enrichPRDetails', () => {
    it('skips enrichment when no open PRs', async () => {
      const prs: Record<string, any> = {
        'feat-x': { number: 1, title: 'PR', state: 'merged', url: 'url', headRefName: 'feat-x', checksStatus: 'none', unresolvedThreads: 0, approvalCount: 0, checkRuns: [] },
      };

      const result = await adapter.enrichPRDetails('/project', prs);
      expect(result).toEqual(prs);
      expect(mockRun).not.toHaveBeenCalled();
    });

    it('enriches open PRs with GraphQL data', async () => {
      const prs: Record<string, any> = {
        'feat-x': { number: 42, title: 'PR', state: 'open', url: 'url', headRefName: 'feat-x', checksStatus: 'none', unresolvedThreads: 0, approvalCount: 0, checkRuns: [] },
      };

      // First call: repo info
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ owner: { login: 'testowner' }, name: 'testrepo' }),
        stderr: '',
        succeeded: true,
      });

      // Second call: GraphQL
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pr0: {
                body: 'PR body text',
                reviewDecision: 'APPROVED',
                mergeStateStatus: 'CLEAN',
                reviewThreads: { nodes: [] },
                reviews: { totalCount: 2 },
                commits: {
                  nodes: [{
                    commit: {
                      statusCheckRollup: {
                        state: 'SUCCESS',
                        contexts: { nodes: [{ name: 'CI', status: 'completed', conclusion: 'success' }] },
                      },
                    },
                  }],
                },
              },
            },
          },
        }),
        stderr: '',
        succeeded: true,
      });

      const result = await adapter.enrichPRDetails('/project', prs);
      expect(result['feat-x'].body).toBe('PR body text');
      expect(result['feat-x'].reviewDecision).toBe('APPROVED');
      expect(result['feat-x'].mergeStateStatus).toBe('CLEAN');
      expect(result['feat-x'].approvalCount).toBe(2);
      expect(result['feat-x'].checksStatus).toBe('pass');
      expect(result['feat-x'].checkRuns.length).toBe(1);
      expect(result['feat-x'].checkRuns[0].name).toBe('CI');
    });
  });

  describe('batchPRLookup', () => {
    it('returns empty for no branches and no numbers', async () => {
      const result = await adapter.batchPRLookup('/project', [], []);
      expect(result.byBranch).toEqual({});
      expect(result.byNumber).toEqual({});
    });

    it('throws GhCliError on rate limit', async () => {
      // repo info
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ owner: { login: 'testowner' }, name: 'testrepo' }),
        stderr: '',
        succeeded: true,
      });
      // GraphQL call returns rate limit
      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'rate limit exceeded',
        succeeded: false,
      });

      await expect(adapter.batchPRLookup('/project', ['feat-x'], []))
        .rejects.toThrow(GhCliError);
    });
  });

  describe('fetchPRBody', () => {
    it('returns body on success', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ body: 'This is the PR body' }),
        stderr: '',
        succeeded: true,
      });

      const body = await adapter.fetchPRBody('/project', 42);
      expect(body).toBe('This is the PR body');
    });

    it('returns null on failure', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'not found',
        succeeded: false,
      });

      const body = await adapter.fetchPRBody('/project', 999);
      expect(body).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('returns true when gh is found and auth succeeds', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Logged in to github.com',
        stderr: '',
        succeeded: true,
      });

      const available = await adapter.isAvailable();
      expect(available).toBe(true);
    });

    it('returns false when gh is not found', async () => {
      mockFindExecutable.mockReturnValueOnce(null);
      // Need a new adapter to pick up the null
      const freshAdapter = new GhCliAdapter();
      // findExecutable called in isAvailable returns null
      mockFindExecutable.mockReturnValueOnce(null);
      const available = await freshAdapter.isAvailable();
      expect(available).toBe(false);
    });

    it('returns false when auth fails', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'not authenticated',
        succeeded: false,
      });

      const available = await adapter.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('fetchIssues', () => {
    it('parses issue list correctly', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify([
          { number: 1, title: 'Bug report', body: 'Details', url: 'https://github.com/test/issues/1', labels: [{ name: 'bug' }] },
          { number: 2, title: 'Feature request', url: 'https://github.com/test/issues/2', labels: [] },
        ]),
        stderr: '',
        succeeded: true,
      });

      const issues = await adapter.fetchIssues('/project', 'repo:test/test');
      expect(issues.length).toBe(2);
      expect(issues[0].number).toBe(1);
      expect(issues[0].labels).toEqual(['bug']);
      expect(issues[1].body).toBeNull();
    });

    it('returns empty on failure', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'error',
        succeeded: false,
      });

      const issues = await adapter.fetchIssues('/project', 'repo:test/test');
      expect(issues.length).toBe(0);
    });
  });

  describe('mergePR', () => {
    it('reports success on exit code 0', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Merged PR #42',
        stderr: '',
        succeeded: true,
      });

      const result = await adapter.mergePR('/project', 42, 'gh pr merge ${number} --squash');
      expect(result.type).toBe('success');
    });

    it('detects merge from output even on non-zero exit', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: 'pull request was merged',
        stderr: '',
        succeeded: false,
      });

      const result = await adapter.mergePR('/project', 42, 'gh pr merge ${number}');
      expect(result.type).toBe('success');
    });

    it('reports failure on actual error', async () => {
      mockRun.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'not mergeable',
        succeeded: false,
      });

      const result = await adapter.mergePR('/project', 42, 'gh pr merge ${number}');
      expect(result.type).toBe('failure');
      if (result.type === 'failure') {
        expect(result.message).toBe('not mergeable');
      }
    });

    it('returns failure for invalid command template', async () => {
      const result = await adapter.mergePR('/project', 42, 'x');
      expect(result.type).toBe('failure');
    });
  });

  describe('GhCliError', () => {
    it('has correct error message for rateLimited', () => {
      const error = new GhCliError('rateLimited');
      expect(error.message).toContain('rate limit');
      expect(error.code).toBe('rateLimited');
      expect(error.name).toBe('GhCliError');
    });
  });
});
