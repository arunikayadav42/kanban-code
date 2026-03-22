import { describe, it, expect } from 'vitest';
import { type Session, getSessionDisplayTitle } from '../types/session.js';
import { type Project, getEffectiveRepoRoot, createProject } from '../types/project.js';
import { type PullRequest, derivePRStatus } from '../types/pull-request.js';
import { type Worktree, getDirectoryName } from '../types/worktree.js';
import { type TmuxSession } from '../types/tmux-session.js';

describe('Session', () => {
  describe('displayTitle', () => {
    it('returns name when set', () => {
      const s: Session = { id: 'uuid', name: 'My Session', messageCount: 5, modifiedTime: '2026-01-01', assistant: 'claude' };
      expect(getSessionDisplayTitle(s)).toBe('My Session');
    });
    it('returns firstPrompt truncated to 100 chars', () => {
      const s: Session = { id: 'uuid', firstPrompt: 'a'.repeat(200), messageCount: 5, modifiedTime: '2026-01-01', assistant: 'claude' };
      expect(getSessionDisplayTitle(s)).toHaveLength(100);
    });
    it('returns id prefix + "..." as fallback', () => {
      const s: Session = { id: 'abcdef12-3456-7890', messageCount: 0, modifiedTime: '2026-01-01', assistant: 'claude' };
      expect(getSessionDisplayTitle(s)).toBe('abcdef12...');
    });
  });
});

describe('Project', () => {
  describe('effectiveRepoRoot', () => {
    it('returns repoRoot when set', () => {
      const p: Project = { path: '/a/b/langwatch', name: 'langwatch', visible: true, repoRoot: '/a/b' };
      expect(getEffectiveRepoRoot(p)).toBe('/a/b');
    });
    it('returns path when repoRoot not set', () => {
      const p: Project = { path: '/a/b/langwatch', name: 'langwatch', visible: true };
      expect(getEffectiveRepoRoot(p)).toBe('/a/b/langwatch');
    });
  });

  describe('createProject', () => {
    it('derives name from last path component', () => {
      const p = createProject('/Users/me/Projects/my-app');
      expect(p.name).toBe('my-app');
      expect(p.path).toBe('/Users/me/Projects/my-app');
      expect(p.visible).toBe(true);
    });
    it('allows name override', () => {
      const p = createProject('/Users/me/Projects/my-app', { name: 'My App' });
      expect(p.name).toBe('My App');
    });
  });
});

describe('PullRequest — derivePRStatus', () => {
  function pr(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
      number: 1, title: 'PR', state: 'open', url: '', headRefName: 'feat',
      checksStatus: 'none', unresolvedThreads: 0, approvalCount: 0, checkRuns: [],
      ...overrides,
    };
  }

  it('merged state → merged', () => {
    expect(derivePRStatus(pr({ state: 'merged' }))).toBe('merged');
  });
  it('closed state → closed', () => {
    expect(derivePRStatus(pr({ state: 'closed' }))).toBe('closed');
  });
  it('CI failing → failing', () => {
    expect(derivePRStatus(pr({ checksStatus: 'fail' }))).toBe('failing');
  });
  it('unresolved threads → unresolved', () => {
    expect(derivePRStatus(pr({ unresolvedThreads: 3 }))).toBe('unresolved');
  });
  it('changes requested → changes_requested', () => {
    expect(derivePRStatus(pr({ reviewDecision: 'CHANGES_REQUESTED' }))).toBe('changes_requested');
  });
  it('no reviews + no approvals → review_needed', () => {
    expect(derivePRStatus(pr({ reviewDecision: '' }))).toBe('review_needed');
  });
  it('null reviewDecision + no approvals → review_needed', () => {
    expect(derivePRStatus(pr({ reviewDecision: null }))).toBe('review_needed');
  });
  it('REVIEW_REQUIRED + approvals → approved', () => {
    expect(derivePRStatus(pr({ reviewDecision: 'REVIEW_REQUIRED', approvalCount: 1 }))).toBe('approved');
  });
  it('empty reviewDecision + approvals + pending CI → pending_ci', () => {
    expect(derivePRStatus(pr({ reviewDecision: '', approvalCount: 1, checksStatus: 'pending' }))).toBe('pending_ci');
  });
  it('empty reviewDecision + approvals + pass CI → approved', () => {
    expect(derivePRStatus(pr({ reviewDecision: '', approvalCount: 2, checksStatus: 'pass' }))).toBe('approved');
  });
  it('APPROVED + pending CI → pending_ci', () => {
    expect(derivePRStatus(pr({ reviewDecision: 'APPROVED', checksStatus: 'pending' }))).toBe('pending_ci');
  });
  it('APPROVED + pass CI → approved', () => {
    expect(derivePRStatus(pr({ reviewDecision: 'APPROVED', checksStatus: 'pass' }))).toBe('approved');
  });

  // Priority ordering: failing > unresolved > changes > review > pending > approved
  it('CI failing overrides unresolved threads', () => {
    expect(derivePRStatus(pr({ checksStatus: 'fail', unresolvedThreads: 5 }))).toBe('failing');
  });
  it('unresolved overrides changes_requested', () => {
    expect(derivePRStatus(pr({ unresolvedThreads: 1, reviewDecision: 'CHANGES_REQUESTED' }))).toBe('unresolved');
  });
});

describe('TmuxSession', () => {
  it('matches Swift struct shape', () => {
    const ts: TmuxSession = { name: 'feat-login', path: '/Users/me/repo', attached: true };
    expect(ts.name).toBe('feat-login');
    expect(ts.path).toBe('/Users/me/repo');
    expect(ts.attached).toBe(true);
  });
});

describe('Worktree', () => {
  it('matches Swift struct shape', () => {
    const wt: Worktree = { path: '/Users/me/repo/.worktrees/feat-auth', branch: 'feat/auth', isBare: false };
    expect(wt.path).toBe('/Users/me/repo/.worktrees/feat-auth');
    expect(wt.branch).toBe('feat/auth');
    expect(wt.isBare).toBe(false);
  });

  it('getDirectoryName returns last component', () => {
    const wt: Worktree = { path: '/Users/me/repo/.worktrees/feat-auth', branch: null, isBare: false };
    expect(getDirectoryName(wt)).toBe('feat-auth');
  });
});
