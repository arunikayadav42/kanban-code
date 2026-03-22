import { describe, it, expect } from 'vitest';
import type { Link, Session, PullRequest, Worktree, TmuxSession } from '@kanban-code/shared';
import { createLink, createDefaultManualOverrides } from '@kanban-code/shared';
import { reconcile, createDiscoverySnapshot } from '../card-reconciler.js';
import { generate } from '../../infrastructure/ksuid.js';

/**
 * Card reconciler tests — ported from Swift CardReconcilerTests.swift.
 * Tests all 5 phases: session matching, worktree matching, PR matching,
 * dead link cleanup, and orphan dedup.
 */

// Helper to create a test Session
function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    messageCount: 1,
    modifiedTime: new Date().toISOString(),
    assistant: 'claude',
    ...overrides,
  };
}

// Helper to create a test Link with auto-generated id
function makeLink(overrides?: Partial<Link>): Link {
  return createLink({ id: overrides?.id ?? generate(), ...overrides });
}

// Helper to create a test PullRequest
function makePR(overrides: Partial<PullRequest> & { number: number; headRefName: string }): PullRequest {
  return {
    title: `PR #${overrides.number}`,
    state: 'open',
    url: `https://github.com/test/pr/${overrides.number}`,
    reviewDecision: null,
    checksStatus: 'none',
    unresolvedThreads: 0,
    approvalCount: 0,
    checkRuns: [],
    ...overrides,
  };
}

describe('CardReconciler', () => {

  // MARK: - Session matching

  describe('Session matching', () => {
    it('New session creates a discovered card', () => {
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1' })],
      });
      const result = reconcile([], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].sessionLink?.sessionId).toBe('s1');
      expect(result[0].source).toBe('discovered');
      expect(result[0].column).toBe('all_sessions');
    });

    it('Existing card matched by sessionId is updated, not duplicated', () => {
      const existing = [
        makeLink({
          column: 'in_progress',
          lastActivity: new Date(Date.now() - 3600000).toISOString(),
          sessionLink: { sessionId: 's1', sessionPath: '/old/path.jsonl' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1', messageCount: 5, jsonlPath: '/new/path.jsonl' })],
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(existing[0].id);
      expect(result[0].sessionLink?.sessionPath).toBe('/new/path.jsonl');
    });

    it('Session matched to pending card by worktree branch', () => {
      const existing = [
        makeLink({
          name: '#42: Fix login',
          projectPath: '/project',
          column: 'backlog',
          source: 'github_issue',
          worktreeLink: { path: '/worktree', branch: 'fix-login' },
          issueLink: { number: 42 },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1', projectPath: '/project', gitBranch: 'fix-login' })],
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(existing[0].id);
      expect(result[0].sessionLink?.sessionId).toBe('s1');
      expect(result[0].issueLink?.number).toBe(42);
      expect(result[0].name).toBe('#42: Fix login');
    });

    it('Session matched to pending card by tmux + project path', () => {
      const existing = [
        makeLink({
          name: 'My task',
          projectPath: '/project',
          column: 'in_progress',
          source: 'manual',
          tmuxLink: { sessionName: 'my-task' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1', projectPath: '/project' })],
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(existing[0].id);
      expect(result[0].sessionLink?.sessionId).toBe('s1');
      expect(result[0].name).toBe('My task');
    });
  });

  // MARK: - Triplication bug

  describe('Triplication bug', () => {
    it('Manual task + start + session discovery = 1 card (not 3!)', () => {
      const manualCard = makeLink({
        name: 'Fix auth bug',
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        promptBody: 'Fix the authentication bug in the login flow',
        tmuxLink: { sessionName: 'fix-auth' },
        worktreeLink: { path: '/project/.claude/worktrees/fix-auth', branch: 'fix-auth' },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 'claude-uuid-123',
          projectPath: '/project',
          gitBranch: 'fix-auth',
          messageCount: 10,
          jsonlPath: '/path/to/session.jsonl',
        })],
        tmuxSessions: [
          { name: 'fix-auth', path: '/project/.claude/worktrees/fix-auth', attached: false },
        ],
        didScanTmux: true,
      });

      const result = reconcile([manualCard], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(manualCard.id);
      expect(result[0].name).toBe('Fix auth bug');
      expect(result[0].source).toBe('manual');
      expect(result[0].sessionLink?.sessionId).toBe('claude-uuid-123');
      expect(result[0].tmuxLink?.sessionName).toBe('fix-auth');
      expect(result[0].worktreeLink?.branch).toBe('fix-auth');
    });

    it('GitHub issue + start work = 1 card (issue gains sessionLink)', () => {
      const issueCard = makeLink({
        name: '#123: Fix the bug',
        projectPath: '/project',
        column: 'backlog',
        source: 'github_issue',
        tmuxLink: { sessionName: 'issue-123' },
        worktreeLink: { path: '/worktree', branch: 'issue-123' },
        issueLink: { number: 123, body: 'Fix the bug' },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 's1', projectPath: '/project', gitBranch: 'issue-123', messageCount: 5,
        })],
        tmuxSessions: [
          { name: 'issue-123', path: '/worktree', attached: false },
        ],
        didScanTmux: true,
      });

      const result = reconcile([issueCard], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(issueCard.id);
      expect(result[0].sessionLink?.sessionId).toBe('s1');
      expect(result[0].issueLink?.number).toBe(123);
    });
  });

  // MARK: - Worktree launch integration

  describe('Worktree launch integration', () => {
    it('session before executeLaunch links it (reconciler first)', () => {
      const manualCard = makeLink({
        name: 'Do a thing',
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        tmuxLink: { sessionName: 'project-wt' },
        isLaunching: true,
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 'session-1',
          projectPath: '/project/.claude/worktrees/jazzy-floating-bird',
          gitBranch: null,
          jsonlPath: '/claude/projects/session-1.jsonl',
        })],
        tmuxSessions: [
          { name: 'project-wt', path: '/project', attached: false },
        ],
        didScanTmux: true,
        worktrees: {
          '/project': [
            { path: '/project/.claude/worktrees/jazzy-floating-bird', branch: 'jazzy-floating-bird', isBare: false },
          ],
        },
      });

      const result = reconcile([manualCard], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(manualCard.id);
      expect(result[0].sessionLink?.sessionId).toBe('session-1');
      expect(result[0].worktreeLink?.branch).toBe('jazzy-floating-bird');
    });

    it('executeLaunch already linked session (reconciler second)', () => {
      const manualCard = makeLink({
        name: 'Do a thing',
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        sessionLink: { sessionId: 'session-1', sessionPath: '/claude/projects/session-1.jsonl' },
        tmuxLink: { sessionName: 'project-wt' },
        isLaunching: true,
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 'session-1',
          projectPath: '/project/.claude/worktrees/jazzy-floating-bird',
          gitBranch: null,
          jsonlPath: '/claude/projects/session-1.jsonl',
        })],
        tmuxSessions: [
          { name: 'project-wt', path: '/project', attached: false },
        ],
        didScanTmux: true,
        worktrees: {
          '/project': [
            { path: '/project/.claude/worktrees/jazzy-floating-bird', branch: 'jazzy-floating-bird', isBare: false },
          ],
        },
      });

      const result = reconcile([manualCard], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(manualCard.id);
      expect(result[0].sessionLink?.sessionId).toBe('session-1');
      expect(result[0].worktreeLink?.branch).toBe('jazzy-floating-bird');
    });

    it('git branch name differs from worktree directory name', () => {
      const manualCard = makeLink({
        name: 'Do a thing',
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        sessionLink: { sessionId: 'session-1', sessionPath: '/path.jsonl' },
        tmuxLink: { sessionName: 'project-wt' },
        isLaunching: true,
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 'session-1',
          projectPath: '/project/.claude/worktrees/hashed-snacking-pony',
          gitBranch: null,
          jsonlPath: '/path.jsonl',
        })],
        tmuxSessions: [
          { name: 'project-wt', path: '/project', attached: false },
        ],
        didScanTmux: true,
        worktrees: {
          '/project': [
            { path: '/project/.claude/worktrees/hashed-snacking-pony', branch: 'worktree-hashed-snacking-pony', isBare: false },
          ],
        },
      });

      const result = reconcile([manualCard], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].worktreeLink?.branch).toBe('worktree-hashed-snacking-pony');
    });

    it('existing orphans are deduplicated', () => {
      const mainCard = makeLink({
        name: 'Do a thing',
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        sessionLink: { sessionId: 's1', sessionPath: '/path.jsonl' },
        worktreeLink: { path: '/project/.claude/worktrees/feat-x', branch: 'feat-x' },
      });
      const orphan1 = makeLink({
        projectPath: '/project',
        source: 'discovered',
        worktreeLink: { path: '/project/.claude/worktrees/feat-x', branch: 'feat-x' },
      });
      const orphan2 = makeLink({
        projectPath: '/project',
        source: 'discovered',
        worktreeLink: { path: '/project/.claude/worktrees/feat-x', branch: 'feat-x' },
      });
      const orphan3 = makeLink({
        projectPath: '/project',
        source: 'discovered',
        worktreeLink: { path: '/project/.claude/worktrees/feat-x', branch: 'feat-x' },
      });

      const snapshot = createDiscoverySnapshot({
        worktrees: {
          '/project': [
            { path: '/project/.claude/worktrees/feat-x', branch: 'feat-x', isBare: false },
          ],
        },
      });

      const result = reconcile([mainCard, orphan1, orphan2, orphan3], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(mainCard.id);
      expect(result[0].sessionLink?.sessionId).toBe('s1');
      expect(result[0].worktreeLink?.branch).toBe('feat-x');
    });

    it('second reconcile after first linked session produces 1 card', () => {
      const linkedCard = makeLink({
        name: 'Do a thing',
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        sessionLink: { sessionId: 'session-1', sessionPath: '/path.jsonl' },
        worktreeLink: { path: '/project/.claude/worktrees/feat-x', branch: 'feat-x' },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 'session-1',
          projectPath: '/project/.claude/worktrees/feat-x',
          gitBranch: 'feat-x',
          messageCount: 10,
          jsonlPath: '/path.jsonl',
        })],
        tmuxSessions: [
          { name: 'project-wt', path: '/project', attached: false },
        ],
        didScanTmux: true,
        worktrees: {
          '/project': [
            { path: '/project/.claude/worktrees/feat-x', branch: 'feat-x', isBare: false },
          ],
        },
      });

      const result1 = reconcile([linkedCard], snapshot);
      expect(result1.length).toBe(1);

      const result2 = reconcile(result1, snapshot);
      expect(result2.length).toBe(1);
      expect(result2[0].id).toBe(linkedCard.id);
    });
  });

  // MARK: - Worktree handling

  describe('Worktree handling', () => {
    it('Orphan worktree creates new card with just worktreeLink', () => {
      const snapshot = createDiscoverySnapshot({
        worktrees: {
          '/project': [
            { path: '/project/.worktrees/fix-auth', branch: 'fix-auth', isBare: false },
          ],
        },
      });

      const result = reconcile([], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].worktreeLink?.branch).toBe('fix-auth');
      expect(result[0].worktreeLink?.path).toBe('/project/.worktrees/fix-auth');
      expect(result[0].sessionLink).toBeFalsy();
      expect(result[0].source).toBe('discovered');
    });

    it('Bare worktree is skipped', () => {
      const snapshot = createDiscoverySnapshot({
        worktrees: {
          '/project': [
            { path: '/project', branch: 'main', isBare: true },
          ],
        },
      });

      const result = reconcile([], snapshot);
      expect(result.length).toBe(0);
    });

    it('Main branch worktree is skipped', () => {
      const snapshot = createDiscoverySnapshot({
        worktrees: {
          '/project': [
            { path: '/project/.worktrees/main', branch: 'main', isBare: false },
            { path: '/project/.worktrees/master', branch: 'master', isBare: false },
          ],
        },
      });

      const result = reconcile([], snapshot);
      expect(result.length).toBe(0);
    });

    it('Existing card worktree path is updated', () => {
      const existing = [
        makeLink({
          column: 'in_progress',
          sessionLink: { sessionId: 's1' },
          worktreeLink: { path: '/old/path', branch: 'feat-x' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1', gitBranch: 'feat-x' })],
        worktrees: {
          '/project': [
            { path: '/new/path', branch: 'feat-x', isBare: false },
          ],
        },
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].worktreeLink?.path).toBe('/new/path');
    });

    it('Worktree branch updated when Claude switches branch inside worktree', () => {
      const existing = [
        makeLink({
          column: 'in_progress',
          sessionLink: { sessionId: 's1' },
          worktreeLink: { path: '/project/.worktrees/feat-original', branch: 'feat-original' },
          prLinks: [{ number: 42, url: 'https://github.com/test/pr/42', status: 'review_needed', title: 'Old PR' }],
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1', gitBranch: 'feat-original' })],
        worktrees: {
          '/project': [
            { path: '/project/.worktrees/feat-original', branch: 'feat-renamed', isBare: false },
          ],
        },
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].worktreeLink?.path).toBe('/project/.worktrees/feat-original');
      expect(result[0].worktreeLink?.branch).toBe('feat-renamed');
      expect(result[0].prLinks.length).toBe(0); // Stale PR cleared
    });

    it('Session gitBranch prevents orphan worktree creation', () => {
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 's1', projectPath: '/project', gitBranch: 'feat-x', messageCount: 5,
        })],
        worktrees: {
          '/project': [
            { path: '/project/.worktrees/feat-x', branch: 'feat-x', isBare: false },
          ],
        },
      });

      const result = reconcile([], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].sessionLink?.sessionId).toBe('s1');
      expect(result[0].worktreeLink?.branch).toBe('feat-x');
      expect(result[0].worktreeLink?.path).toBe('/project/.worktrees/feat-x');
    });

    it('Worktree creates worktreeLink on session card without existing worktreeLink', () => {
      const existing = [
        makeLink({
          projectPath: '/project',
          column: 'in_progress',
          sessionLink: { sessionId: 's1' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1', gitBranch: 'feat-x', messageCount: 5 })],
        worktrees: {
          '/project': [
            { path: '/project/.worktrees/feat-x', branch: 'feat-x', isBare: false },
          ],
        },
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].worktreeLink?.branch).toBe('feat-x');
      expect(result[0].worktreeLink?.path).toBe('/project/.worktrees/feat-x');
    });

    it('Orphan worktree card gets projectPath from repoRoot', () => {
      const snapshot = createDiscoverySnapshot({
        worktrees: {
          '/Users/me/Projects/langwatch': [
            { path: '/Users/me/Projects/langwatch/.worktrees/feat-x', branch: 'feat-x', isBare: false },
          ],
        },
      });

      const result = reconcile([], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].projectPath).toBe('/Users/me/Projects/langwatch');
    });
  });

  // MARK: - PR matching

  describe('PR matching', () => {
    it('PR linked to card via branch', () => {
      const existing = [
        makeLink({
          column: 'in_progress',
          sessionLink: { sessionId: 's1' },
          worktreeLink: { path: '/wt', branch: 'feat-login' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1', gitBranch: 'feat-login' })],
        pullRequests: {
          'feat-login': makePR({ number: 42, title: 'Add login', headRefName: 'feat-login' }),
        },
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].prLinks[0]?.number).toBe(42);
    });
  });

  // MARK: - Dead link cleanup

  describe('Dead link cleanup', () => {
    it('Dead tmux link is cleared when tmux was scanned', () => {
      const existing = [
        makeLink({
          column: 'in_progress',
          sessionLink: { sessionId: 's1' },
          tmuxLink: { sessionName: 'dead-session' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1' })],
        tmuxSessions: [{ name: 'other-alive', path: '/tmp', attached: false }],
        didScanTmux: true,
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].tmuxLink).toBeNull();
      expect(result[0].sessionLink?.sessionId).toBe('s1');
    });

    it('Dead tmux cleared even when zero sessions exist (server killed)', () => {
      const existing = [
        makeLink({
          column: 'in_progress',
          tmuxLink: { sessionName: 'test', extraSessions: ['test-sh1', 'test-sh2'] },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        tmuxSessions: [],
        didScanTmux: true,
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].tmuxLink).toBeNull();
    });

    it('Tmux link preserved when tmux not scanned', () => {
      const existing = [
        makeLink({
          column: 'in_progress',
          sessionLink: { sessionId: 's1' },
          tmuxLink: { sessionName: 'my-session' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1' })],
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].tmuxLink?.sessionName).toBe('my-session');
    });

    it('Dead worktree link is cleared when worktrees were scanned', () => {
      const existing = [
        makeLink({
          column: 'done',
          worktreeLink: { path: '/deleted/worktree', branch: 'old-branch' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        worktrees: {
          '/project': [
            { path: '/project', branch: 'main', isBare: true },
          ],
        },
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].worktreeLink).toBeNull();
    });

    it('Manual tmux override is preserved even when tmux is dead', () => {
      const link = makeLink({
        column: 'in_progress',
        tmuxLink: { sessionName: 'my-session' },
        manualOverrides: { ...createDefaultManualOverrides(), tmuxSession: true },
      });

      const snapshot = createDiscoverySnapshot({
        tmuxSessions: [],
        didScanTmux: true,
      });

      const result = reconcile([link], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].tmuxLink?.sessionName).toBe('my-session');
    });
  });

  // MARK: - Multiple sessions

  describe('Multiple sessions', () => {
    it('Multiple sessions each get their own card', () => {
      const snapshot = createDiscoverySnapshot({
        sessions: [
          makeSession({ id: 's1' }),
          makeSession({ id: 's2' }),
          makeSession({ id: 's3' }),
        ],
      });

      const result = reconcile([], snapshot);
      expect(result.length).toBe(3);
      const sessionIds = new Set(result.map(r => r.sessionLink?.sessionId));
      expect(sessionIds).toEqual(new Set(['s1', 's2', 's3']));
    });

    it('Existing cards without matching sessions are preserved', () => {
      const existing = [
        makeLink({ name: 'Manual task', column: 'backlog', source: 'manual' }),
        makeLink({ name: 'Issue', column: 'backlog', source: 'github_issue', issueLink: { number: 42 } }),
      ];
      const snapshot = createDiscoverySnapshot();

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(2);
      expect(result.some(r => r.name === 'Manual task')).toBe(true);
      expect(result.some(r => r.name === 'Issue')).toBe(true);
    });

    it('No double reconciliation — running twice produces same result', () => {
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 's1', projectPath: '/p', gitBranch: 'feat-x', messageCount: 5,
        })],
        worktrees: {
          '/p': [{ path: '/p/.wt/feat-x', branch: 'feat-x', isBare: false }],
        },
        pullRequests: {
          'feat-x': makePR({ number: 1, title: 'PR', headRefName: 'feat-x' }),
        },
      });

      const first = reconcile([], snapshot);
      const second = reconcile(first, snapshot);

      expect(first.length).toBe(second.length);
      const firstIds = new Set(first.map(r => r.id));
      const secondIds = new Set(second.map(r => r.id));
      expect(firstIds).toEqual(secondIds);
    });
  });

  // MARK: - Fork regression

  describe('Fork regression', () => {
    it('Forked card (project root) does NOT get worktreeLink re-attached', () => {
      const originalCard = makeLink({
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        sessionLink: { sessionId: 'original-session', sessionPath: '/claude/projects/original-session.jsonl' },
        worktreeLink: { path: '/project/.claude/worktrees/jazzy-floating-bird', branch: 'jazzy-floating-bird' },
      });

      const forkedCard = makeLink({
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        sessionLink: { sessionId: 'forked-session-1', sessionPath: '/claude/projects/forked-session-1.jsonl' },
        manualOverrides: { ...createDefaultManualOverrides(), branchWatermark: 50000 },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [
          makeSession({
            id: 'original-session',
            projectPath: '/project/.claude/worktrees/jazzy-floating-bird',
            gitBranch: 'jazzy-floating-bird',
            messageCount: 20,
            jsonlPath: '/claude/projects/original-session.jsonl',
          }),
          makeSession({
            id: 'forked-session-1',
            projectPath: '/project/.claude/worktrees/jazzy-floating-bird',
            gitBranch: null,
            messageCount: 10,
            jsonlPath: '/claude/projects/forked-session-1.jsonl',
          }),
        ],
        worktrees: {
          '/project': [
            { path: '/project/.claude/worktrees/jazzy-floating-bird', branch: 'jazzy-floating-bird', isBare: false },
          ],
        },
      });

      const result = reconcile([originalCard, forkedCard], snapshot);
      expect(result.length).toBe(2);

      const forked = result.find(r => r.id === forkedCard.id)!;
      const original = result.find(r => r.id === originalCard.id)!;

      expect(forked.sessionLink?.sessionId).toBe('forked-session-1');
      expect(forked.worktreeLink).toBeFalsy();

      expect(original.worktreeLink?.branch).toBe('jazzy-floating-bird');
      expect(original.sessionLink?.sessionId).toBe('original-session');
    });

    it('Fork with same worktree KEEPS worktreeLink', () => {
      const originalCard = makeLink({
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        sessionLink: { sessionId: 'original', sessionPath: '/p/original.jsonl' },
        worktreeLink: { path: '/project/.claude/worktrees/feat', branch: 'feat' },
      });
      const forkedCard = makeLink({
        projectPath: '/project',
        column: 'requires_attention',
        source: 'discovered',
        sessionLink: { sessionId: 'forked', sessionPath: '/p/forked.jsonl' },
        worktreeLink: { path: '/project/.claude/worktrees/feat', branch: 'feat' },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [
          makeSession({ id: 'original', projectPath: '/project/.claude/worktrees/feat', gitBranch: 'feat', messageCount: 10, jsonlPath: '/p/original.jsonl' }),
          makeSession({ id: 'forked', projectPath: '/project/.claude/worktrees/feat', gitBranch: 'feat', messageCount: 10, jsonlPath: '/p/forked.jsonl' }),
        ],
        worktrees: {
          '/project': [
            { path: '/project/.claude/worktrees/feat', branch: 'feat', isBare: false },
          ],
        },
      });

      const result = reconcile([originalCard, forkedCard], snapshot);
      const forked = result.find(r => r.id === forkedCard.id)!;
      expect(forked.worktreeLink?.branch).toBe('feat');
    });

    it('Forked card without manualOverride still gets worktreeLink (backwards compat)', () => {
      const card = makeLink({
        projectPath: '/project',
        column: 'requires_attention',
        source: 'discovered',
        sessionLink: { sessionId: 's1', sessionPath: '/p/s1.jsonl' },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 's1', projectPath: '/project', gitBranch: 'feat-y',
          messageCount: 5, jsonlPath: '/p/s1.jsonl',
        })],
        worktrees: {
          '/project': [
            { path: '/project/.worktrees/feat-y', branch: 'feat-y', isBare: false },
          ],
        },
      });

      const result = reconcile([card], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].worktreeLink?.branch).toBe('feat-y');
    });

    it('Existing card with worktreeLink gets path updated (not duplicated)', () => {
      const card = makeLink({
        projectPath: '/project',
        column: 'in_progress',
        source: 'manual',
        sessionLink: { sessionId: 's1', sessionPath: '/p/s1.jsonl' },
        worktreeLink: { path: '/old/path', branch: 'feat-z' },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 's1', projectPath: '/project', gitBranch: 'feat-z',
          messageCount: 5, jsonlPath: '/p/s1.jsonl',
        })],
        worktrees: {
          '/project': [
            { path: '/project/.worktrees/feat-z', branch: 'feat-z', isBare: false },
          ],
        },
      });

      const result = reconcile([card], snapshot);
      expect(result.length).toBe(1);
      expect(result[0].worktreeLink?.branch).toBe('feat-z');
      expect(result[0].worktreeLink?.path).toBe('/project/.worktrees/feat-z');
    });

    it('Forked card (project root) does NOT get PR from session gitBranch', () => {
      const forkedCard = makeLink({
        projectPath: '/project',
        column: 'requires_attention',
        source: 'discovered',
        sessionLink: { sessionId: 'forked-s1', sessionPath: '/p/forked.jsonl' },
        manualOverrides: { ...createDefaultManualOverrides(), branchWatermark: 50000 },
      });
      const originalCard = makeLink({
        projectPath: '/project',
        column: 'in_progress',
        source: 'discovered',
        sessionLink: { sessionId: 'original-s1', sessionPath: '/p/original.jsonl' },
        worktreeLink: { path: '/project/.claude/worktrees/feat-x', branch: 'feat-x' },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [
          makeSession({ id: 'original-s1', projectPath: '/project/.claude/worktrees/feat-x', gitBranch: 'feat-x', messageCount: 10, jsonlPath: '/p/original.jsonl' }),
          makeSession({ id: 'forked-s1', projectPath: '/project', gitBranch: 'feat-x', messageCount: 10, jsonlPath: '/p/forked.jsonl' }),
        ],
        worktrees: {
          '/project': [
            { path: '/project/.claude/worktrees/feat-x', branch: 'feat-x', isBare: false },
          ],
        },
        pullRequests: {
          'feat-x': makePR({ number: 42, title: 'Add feat X', headRefName: 'feat-x' }),
        },
      });

      const result = reconcile([originalCard, forkedCard], snapshot);
      const forked = result.find(r => r.id === forkedCard.id)!;
      const original = result.find(r => r.id === originalCard.id)!;

      expect(forked.prLinks.length).toBe(0);
      expect(forked.worktreeLink).toBeFalsy();
      expect(original.prLinks.length).toBe(1);
      expect(original.prLinks[0].number).toBe(42);
    });

    it('Card with branchWatermark: discoveredBranches ARE still indexed for PR matching', () => {
      const card = makeLink({
        projectPath: '/project',
        column: 'in_progress',
        source: 'discovered',
        sessionLink: { sessionId: 's1', sessionPath: '/p/s1.jsonl' },
        manualOverrides: { ...createDefaultManualOverrides(), branchWatermark: 50000 },
        discoveredBranches: ['feat-new'],
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 's1', projectPath: '/project', gitBranch: 'feat-old',
          messageCount: 10, jsonlPath: '/p/s1.jsonl',
        })],
        pullRequests: {
          'feat-old': makePR({ number: 1, title: 'Old PR', headRefName: 'feat-old' }),
          'feat-new': makePR({ number: 2, title: 'New PR', headRefName: 'feat-new' }),
        },
      });

      const result = reconcile([card], snapshot);
      const updated = result.find(r => r.id === card.id)!;

      expect(updated.prLinks.some(p => p.number === 1)).toBe(false);
      expect(updated.prLinks.some(p => p.number === 2)).toBe(true);
    });

    it('Legacy worktreePath=true still blocks branch discovery (backward compat)', () => {
      const card = makeLink({
        projectPath: '/project',
        column: 'requires_attention',
        source: 'discovered',
        sessionLink: { sessionId: 's1', sessionPath: '/p/s1.jsonl' },
        manualOverrides: { ...createDefaultManualOverrides(), worktreePath: true },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 's1', projectPath: '/project', gitBranch: 'feat-x',
          messageCount: 5, jsonlPath: '/p/s1.jsonl',
        })],
        worktrees: {
          '/project': [
            { path: '/project/.worktrees/feat-x', branch: 'feat-x', isBare: false },
          ],
        },
        pullRequests: {
          'feat-x': makePR({ number: 1, title: 'PR', headRefName: 'feat-x' }),
        },
      });

      const result = reconcile([card], snapshot);
      const updated = result.find(r => r.id === card.id)!;

      expect(updated.worktreeLink).toBeFalsy();
      expect(updated.prLinks.length).toBe(0);
    });

    it('Clearing watermark allows full re-discovery', () => {
      const card = makeLink({
        projectPath: '/project',
        column: 'in_progress',
        source: 'discovered',
        sessionLink: { sessionId: 's1', sessionPath: '/p/s1.jsonl' },
      });

      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 's1', projectPath: '/project', gitBranch: 'feat-x',
          messageCount: 5, jsonlPath: '/p/s1.jsonl',
        })],
        worktrees: {
          '/project': [
            { path: '/project/.worktrees/feat-x', branch: 'feat-x', isBare: false },
          ],
        },
        pullRequests: {
          'feat-x': makePR({ number: 1, title: 'PR', headRefName: 'feat-x' }),
        },
      });

      const result = reconcile([card], snapshot);
      const updated = result.find(r => r.id === card.id)!;

      expect(updated.worktreeLink?.branch).toBe('feat-x');
      expect(updated.prLinks.length).toBe(1);
    });

    it('Project path filled from session when card has none', () => {
      const existing = [
        makeLink({
          projectPath: '/my/project',
          column: 'backlog',
          source: 'manual',
          tmuxLink: { sessionName: 'task-1' },
          worktreeLink: { path: '/wt', branch: 'task-1' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({
          id: 's1', projectPath: '/my/project', gitBranch: 'task-1',
        })],
      });

      const result = reconcile(existing, snapshot);
      expect(result.length).toBe(1);
      expect(result[0].sessionLink?.sessionId).toBe('s1');
      expect(result[0].projectPath).toBe('/my/project');
    });
  });

  // MARK: - Cross-repo worktree stability

  describe('Cross-repo worktree stability', () => {
    it('Cross-repo discoveredBranches don\'t cause worktreeLink flipping', () => {
      const existing = [
        makeLink({
          id: 'card-multi-repo',
          projectPath: '/repos/langwatch',
          column: 'in_progress',
          sessionLink: { sessionId: 's1' },
          worktreeLink: { path: '/repos/langwatch/.claude/worktrees/fix-trigger', branch: 'fix/approval-check-retrigger' },
          discoveredBranches: ['fix/approval-check-retrigger', 'fix/add-flaky-markers'],
          discoveredRepos: { 'fix/add-flaky-markers': '/repos/scenario' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1' })],
        worktrees: {
          '/repos/langwatch': [
            { path: '/repos/langwatch/.claude/worktrees/fix-trigger', branch: 'refs/heads/fix/approval-check-retrigger', isBare: false },
          ],
          '/repos/scenario': [
            { path: '/repos/scenario/.claude/worktrees/herding-cloud', branch: 'refs/heads/fix/add-flaky-markers', isBare: false },
          ],
        },
      });

      const result = reconcile(existing, snapshot);
      const card = result.find(r => r.id === 'card-multi-repo')!;

      expect(card.worktreeLink?.branch).toBe('fix/approval-check-retrigger');
      expect(card.worktreeLink?.path).toBe('/repos/langwatch/.claude/worktrees/fix-trigger');
    });

    it('Cross-repo worktree won\'t attach to card from wrong repo', () => {
      const existing = [
        makeLink({
          id: 'card-no-wt',
          projectPath: '/repos/langwatch',
          column: 'in_progress',
          sessionLink: { sessionId: 's1' },
          discoveredBranches: ['branch-a'],
          discoveredRepos: { 'branch-a': '/repos/scenario' },
        }),
      ];
      const snapshot = createDiscoverySnapshot({
        sessions: [makeSession({ id: 's1' })],
        worktrees: {
          '/repos/langwatch': [
            { path: '/repos/langwatch/.claude/worktrees/wt-a', branch: 'refs/heads/branch-a', isBare: false },
          ],
        },
      });

      const result = reconcile(existing, snapshot);
      const card = result.find(r => r.id === 'card-no-wt')!;
      expect(card.worktreeLink).toBeFalsy();
    });
  });
});
