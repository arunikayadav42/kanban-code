import { describe, it, expect } from 'vitest';
import {
  type Link,
  type SessionLink,
  type TmuxLink,
  type WorktreeLink,
  type PRLink,
  type IssueLink,
  type QueuedPrompt,
  type ManualOverrides,
  type CardLabel,
  type LinkSource,
  getTmuxAllSessionNames,
  getTmuxTerminalCount,
  createDefaultManualOverrides,
  isBranchDiscoveryBlocked,
  isPRDismissed,
  getEffectiveAssistant,
  getDisplayTitle,
  getPrimaryPR,
  getMergeablePR,
  getAllPRsDone,
  getCardLabel,
  getSessionId,
  getSessionPath,
  getTmuxSession,
  getWorstPRStatus,
  mergeBlocked,
  createLink,
  parseLinkFromJSON,
} from '../types/link.js';

// Helper to create a minimal link for testing
function testLink(overrides: Partial<Link> = {}): Link {
  return createLink({ id: 'card_test123', ...overrides });
}

describe('SessionLink', () => {
  it('holds session metadata', () => {
    const sl: SessionLink = { sessionId: 'abc-123', sessionPath: '/path/to/file.jsonl', sessionNumber: 3 };
    expect(sl.sessionId).toBe('abc-123');
    expect(sl.sessionPath).toBe('/path/to/file.jsonl');
    expect(sl.sessionNumber).toBe(3);
  });
});

describe('TmuxLink', () => {
  it('computes allSessionNames with primary only', () => {
    const tl: TmuxLink = { sessionName: 'proj-abc' };
    expect(getTmuxAllSessionNames(tl)).toEqual(['proj-abc']);
    expect(getTmuxTerminalCount(tl)).toBe(1);
  });

  it('computes allSessionNames with extras', () => {
    const tl: TmuxLink = { sessionName: 'proj-abc', extraSessions: ['proj-abc-sh1', 'proj-abc-sh2'] };
    expect(getTmuxAllSessionNames(tl)).toEqual(['proj-abc', 'proj-abc-sh1', 'proj-abc-sh2']);
    expect(getTmuxTerminalCount(tl)).toBe(3);
  });
});

describe('ManualOverrides', () => {
  it('creates defaults with all false', () => {
    const mo = createDefaultManualOverrides();
    expect(mo.worktreePath).toBe(false);
    expect(mo.tmuxSession).toBe(false);
    expect(mo.name).toBe(false);
    expect(mo.column).toBe(false);
    expect(mo.prLink).toBe(false);
    expect(mo.issueLink).toBe(false);
    expect(mo.dismissedPRs).toBeUndefined();
    expect(mo.branchWatermark).toBeUndefined();
  });

  describe('isBranchDiscoveryBlocked', () => {
    it('false by default', () => {
      expect(isBranchDiscoveryBlocked(createDefaultManualOverrides())).toBe(false);
    });
    it('true when branchWatermark is set', () => {
      expect(isBranchDiscoveryBlocked({ ...createDefaultManualOverrides(), branchWatermark: 1000 })).toBe(true);
    });
    it('true when worktreePath is true (legacy)', () => {
      expect(isBranchDiscoveryBlocked({ ...createDefaultManualOverrides(), worktreePath: true })).toBe(true);
    });
  });

  describe('isPRDismissed', () => {
    it('false by default', () => {
      expect(isPRDismissed(createDefaultManualOverrides(), 42)).toBe(false);
    });
    it('true when prLink is true (legacy — all PRs dismissed)', () => {
      expect(isPRDismissed({ ...createDefaultManualOverrides(), prLink: true }, 42)).toBe(true);
      expect(isPRDismissed({ ...createDefaultManualOverrides(), prLink: true }, 99)).toBe(true);
    });
    it('true when specific PR is in dismissedPRs', () => {
      expect(isPRDismissed({ ...createDefaultManualOverrides(), dismissedPRs: [42, 43] }, 42)).toBe(true);
    });
    it('false when different PR is in dismissedPRs', () => {
      expect(isPRDismissed({ ...createDefaultManualOverrides(), dismissedPRs: [42, 43] }, 99)).toBe(false);
    });
  });
});

describe('Link computed properties', () => {
  describe('effectiveAssistant', () => {
    it('defaults to claude when assistant is null', () => {
      expect(getEffectiveAssistant(testLink())).toBe('claude');
    });
    it('returns gemini when set', () => {
      expect(getEffectiveAssistant(testLink({ assistant: 'gemini' }))).toBe('gemini');
    });
  });

  describe('displayTitle', () => {
    it('priority: name first', () => {
      expect(getDisplayTitle(testLink({ name: 'My Card', promptBody: 'prompt' }))).toBe('My Card');
    });
    it('priority: promptBody if no name', () => {
      expect(getDisplayTitle(testLink({ promptBody: 'Fix the bug' }))).toBe('Fix the bug');
    });
    it('truncates promptBody to 100 chars', () => {
      const long = 'a'.repeat(200);
      expect(getDisplayTitle(testLink({ promptBody: long }))).toHaveLength(100);
    });
    it('priority: branch if no name/prompt', () => {
      expect(getDisplayTitle(testLink({ worktreeLink: { path: '/p', branch: 'feat-x' } }))).toBe('feat-x');
    });
    it('priority: PR title if no name/prompt/branch', () => {
      expect(getDisplayTitle(testLink({ prLinks: [{ number: 42, title: 'PR Title' }] }))).toBe('PR Title');
    });
    it('priority: session ID if nothing else', () => {
      expect(getDisplayTitle(testLink({ sessionLink: { sessionId: 'uuid-123' } }))).toBe('uuid-123');
    });
    it('falls back to card id', () => {
      expect(getDisplayTitle(testLink())).toBe('card_test123');
    });
  });

  describe('multi-PR computed properties', () => {
    it('getPrimaryPR returns first PR', () => {
      const link = testLink({ prLinks: [{ number: 42 }, { number: 43 }] });
      expect(getPrimaryPR(link)?.number).toBe(42);
    });
    it('getPrimaryPR returns null for empty prLinks', () => {
      expect(getPrimaryPR(testLink())).toBeNull();
    });
    it('getMergeablePR returns single open PR', () => {
      const link = testLink({ prLinks: [{ number: 42, status: 'approved' }] });
      expect(getMergeablePR(link)?.number).toBe(42);
    });
    it('getMergeablePR returns null for 2+ open PRs', () => {
      const link = testLink({ prLinks: [{ number: 42, status: 'approved' }, { number: 43, status: 'review_needed' }] });
      expect(getMergeablePR(link)).toBeNull();
    });
    it('getMergeablePR excludes merged/closed', () => {
      const link = testLink({ prLinks: [{ number: 42, status: 'merged' }, { number: 43, status: 'approved' }] });
      expect(getMergeablePR(link)?.number).toBe(43);
    });
    it('getAllPRsDone true when all merged/closed', () => {
      const link = testLink({ prLinks: [{ number: 42, status: 'merged' }, { number: 43, status: 'closed' }] });
      expect(getAllPRsDone(link)).toBe(true);
    });
    it('getAllPRsDone false when any PR is open', () => {
      const link = testLink({ prLinks: [{ number: 42, status: 'merged' }, { number: 43, status: 'approved' }] });
      expect(getAllPRsDone(link)).toBe(false);
    });
    it('getAllPRsDone false when no PRs', () => {
      expect(getAllPRsDone(testLink())).toBe(false);
    });
  });

  describe('cardLabel priority', () => {
    it('SESSION when sessionLink present', () => {
      expect(getCardLabel(testLink({ sessionLink: { sessionId: 'x' }, worktreeLink: { path: '/p' } }))).toBe('SESSION');
    });
    it('WORKTREE when worktreeLink but no session', () => {
      expect(getCardLabel(testLink({ worktreeLink: { path: '/p' } }))).toBe('WORKTREE');
    });
    it('ISSUE when issueLink but no session/worktree', () => {
      expect(getCardLabel(testLink({ issueLink: { number: 1 } }))).toBe('ISSUE');
    });
    it('PR when prLinks but no session/worktree/issue', () => {
      expect(getCardLabel(testLink({ prLinks: [{ number: 1 }] }))).toBe('PR');
    });
    it('TASK when no links', () => {
      expect(getCardLabel(testLink())).toBe('TASK');
    });
  });
});

describe('mergeBlocked', () => {
  it('returns null when merge is allowed', () => {
    const a = testLink({ id: 'card_a', sessionLink: { sessionId: 'x' } });
    const b = testLink({ id: 'card_b', worktreeLink: { path: '/p' } });
    expect(mergeBlocked(a, b)).toBeNull();
  });
  it('blocks merging with self', () => {
    const a = testLink({ id: 'card_a' });
    expect(mergeBlocked(a, a)).toBe('Cannot merge a card with itself');
  });
  it('blocks when both have sessions', () => {
    const a = testLink({ id: 'card_a', sessionLink: { sessionId: 'x' } });
    const b = testLink({ id: 'card_b', sessionLink: { sessionId: 'y' } });
    expect(mergeBlocked(a, b)).toBe('Cannot merge: both cards have sessions');
  });
  it('blocks when both have terminals', () => {
    const a = testLink({ id: 'card_a', tmuxLink: { sessionName: 'x' } });
    const b = testLink({ id: 'card_b', tmuxLink: { sessionName: 'y' } });
    expect(mergeBlocked(a, b)).toBe('Cannot merge: both cards have terminals');
  });
  it('blocks when both have different issues', () => {
    const a = testLink({ id: 'card_a', issueLink: { number: 1 } });
    const b = testLink({ id: 'card_b', issueLink: { number: 2 } });
    expect(mergeBlocked(a, b)).toBe('Cannot merge: both cards have different issues');
  });
  it('allows when both have same issue', () => {
    const a = testLink({ id: 'card_a', issueLink: { number: 1 } });
    const b = testLink({ id: 'card_b', issueLink: { number: 1 } });
    expect(mergeBlocked(a, b)).toBeNull();
  });
  it('blocks when both have different worktrees', () => {
    const a = testLink({ id: 'card_a', worktreeLink: { path: '/a', branch: 'feat-a' } });
    const b = testLink({ id: 'card_b', worktreeLink: { path: '/b', branch: 'feat-b' } });
    expect(mergeBlocked(a, b)).toBe('Cannot merge: both cards have different worktrees');
  });
});

describe('parseLinkFromJSON — backward compatibility', () => {
  it('parses new nested format', () => {
    const json = {
      id: 'card_new',
      column: 'in_progress',
      source: 'manual',
      sessionLink: { sessionId: 'abc', sessionPath: '/path.jsonl' },
      tmuxLink: { sessionName: 'proj-abc' },
      worktreeLink: { path: '/wt', branch: 'feat-x' },
      prLinks: [{ number: 42, status: 'approved' }],
      issueLink: { number: 11, body: 'Fix it' },
      manualOverrides: { worktreePath: false, tmuxSession: false, name: false, column: false, prLink: false, issueLink: false },
      manuallyArchived: false,
      isRemote: false,
    };
    const link = parseLinkFromJSON(json);
    expect(link.sessionLink?.sessionId).toBe('abc');
    expect(link.tmuxLink?.sessionName).toBe('proj-abc');
    expect(link.worktreeLink?.branch).toBe('feat-x');
    expect(link.prLinks[0].number).toBe(42);
    expect(link.issueLink?.number).toBe(11);
  });

  it('parses old flat format (sessionId, tmuxSession, worktreePath, githubPR, githubIssue)', () => {
    const json = {
      id: 'old-uuid',
      column: 'in_progress',
      source: 'discovered',
      sessionId: 'claude-uuid',
      sessionPath: '/path.jsonl',
      tmuxSession: 'feat-login',
      worktreePath: '/path/to/worktree',
      worktreeBranch: 'feat/login',
      githubPR: 456,
      githubIssue: 123,
      issueBody: 'Fix the login bug',
    };
    const link = parseLinkFromJSON(json);
    expect(link.sessionLink?.sessionId).toBe('claude-uuid');
    expect(link.sessionLink?.sessionPath).toBe('/path.jsonl');
    expect(link.tmuxLink?.sessionName).toBe('feat-login');
    expect(link.worktreeLink?.path).toBe('/path/to/worktree');
    expect(link.worktreeLink?.branch).toBe('feat/login');
    expect(link.prLinks[0].number).toBe(456);
    expect(link.issueLink?.number).toBe(123);
    expect(link.issueLink?.body).toBe('Fix the login bug');
  });

  it('migrates issueBody to promptBody when no githubIssue', () => {
    const json = {
      id: 'card_manual',
      column: 'backlog',
      source: 'manual',
      issueBody: 'Refactor the database layer',
    };
    const link = parseLinkFromJSON(json);
    expect(link.issueLink).toBeNull();
    expect(link.promptBody).toBe('Refactor the database layer');
  });

  it('worktreeBranch without worktreePath creates link with empty path', () => {
    const json = {
      id: 'card_branch_only',
      worktreeBranch: 'feat/remote-only',
    };
    const link = parseLinkFromJSON(json);
    expect(link.worktreeLink?.path).toBe('');
    expect(link.worktreeLink?.branch).toBe('feat/remote-only');
  });

  it('singular prLink fallback', () => {
    const json = {
      id: 'card_singular_pr',
      prLink: { number: 42, status: 'approved' },
    };
    const link = parseLinkFromJSON(json);
    expect(link.prLinks).toHaveLength(1);
    expect(link.prLinks[0].number).toBe(42);
  });

  it('defaults column to all_sessions when missing', () => {
    const link = parseLinkFromJSON({ id: 'card_no_col' });
    expect(link.column).toBe('all_sessions');
  });

  it('defaults source to discovered when missing', () => {
    const link = parseLinkFromJSON({ id: 'card_no_src' });
    expect(link.source).toBe('discovered');
  });

  it('defaults manuallyArchived to false', () => {
    const link = parseLinkFromJSON({ id: 'card_no_arch' });
    expect(link.manuallyArchived).toBe(false);
  });

  it('defaults isRemote to false', () => {
    const link = parseLinkFromJSON({ id: 'card_no_remote' });
    expect(link.isRemote).toBe(false);
  });

  it('defaults assistant to null (effectiveAssistant → claude)', () => {
    const link = parseLinkFromJSON({ id: 'card_legacy' });
    expect(link.assistant).toBeNull();
    expect(getEffectiveAssistant(link)).toBe('claude');
  });
});
