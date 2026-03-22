import { describe, it, expect } from 'vitest';
import {
  type Link,
  createLink,
  getProjectName,
  getCardType,
  enrichLink,
  validateColumnMove,
} from '../types/link.js';

// Minimal valid link factory
function makeLink(overrides: Partial<Link> = {}): Link {
  return createLink({ id: 'test-id', ...overrides });
}

// MARK: - getProjectName

describe('getProjectName', () => {
  it('returns the last path segment for a normal path', () => {
    const link = makeLink({ projectPath: '/home/user/projects/my-app' });
    expect(getProjectName(link)).toBe('my-app');
  });

  it('handles a trailing slash by ignoring empty segments', () => {
    const link = makeLink({ projectPath: '/home/user/projects/my-app/' });
    expect(getProjectName(link)).toBe('my-app');
  });

  it('returns null when projectPath is null', () => {
    const link = makeLink({ projectPath: null });
    expect(getProjectName(link)).toBeNull();
  });

  it('returns null when projectPath is undefined', () => {
    const link = makeLink({ projectPath: undefined });
    expect(getProjectName(link)).toBeNull();
  });

  it('handles a single-segment path', () => {
    const link = makeLink({ projectPath: 'my-app' });
    expect(getProjectName(link)).toBe('my-app');
  });
});

// MARK: - getCardType

describe('getCardType', () => {
  it('returns "sessions" when sessionLink is present', () => {
    const link = makeLink({ sessionLink: { sessionId: 'sess-1' }, source: 'discovered' });
    expect(getCardType(link)).toBe('sessions');
  });

  it('returns "tasks" when source is manual (and no sessionLink)', () => {
    const link = makeLink({ source: 'manual', sessionLink: null });
    expect(getCardType(link)).toBe('tasks');
  });

  it('returns "issues" when source is github_issue (and no sessionLink)', () => {
    const link = makeLink({ source: 'github_issue', sessionLink: null });
    expect(getCardType(link)).toBe('issues');
  });

  it('returns "other" for discovered source with no sessionLink', () => {
    const link = makeLink({ source: 'discovered', sessionLink: null });
    expect(getCardType(link)).toBe('other');
  });

  it('returns "other" for hook source with no sessionLink', () => {
    const link = makeLink({ source: 'hook', sessionLink: null });
    expect(getCardType(link)).toBe('other');
  });

  it('sessionLink presence takes priority over manual source', () => {
    const link = makeLink({ sessionLink: { sessionId: 'sess-2' }, source: 'manual' });
    expect(getCardType(link)).toBe('sessions');
  });
});

// MARK: - enrichLink

describe('enrichLink', () => {
  it('returns all computed fields populated', () => {
    const link = makeLink({
      id: 'card-1',
      name: 'My Task',
      projectPath: '/home/user/projects/my-repo',
      source: 'manual',
      sessionLink: null,
      prLinks: [],
    });
    const enriched = enrichLink(link);
    expect(enriched.displayTitle).toBe('My Task');
    expect(enriched.cardLabel).toBe('TASK');
    expect(enriched.worstPRStatus).toBeNull();
    expect(enriched.projectName).toBe('my-repo');
    expect(enriched.effectiveAssistant).toBeDefined();
    expect(typeof enriched.effectiveAssistant).toBe('string');
    expect(enriched.cardType).toBe('tasks');
  });

  it('preserves all original link fields', () => {
    const link = makeLink({ name: 'Keep Me', projectPath: '/a/b' });
    const enriched = enrichLink(link);
    expect(enriched.id).toBe('test-id');
    expect(enriched.name).toBe('Keep Me');
    expect(enriched.column).toBe(link.column);
  });

  it('sets cardLabel SESSION when sessionLink is present', () => {
    const link = makeLink({ sessionLink: { sessionId: 'sess-3' } });
    const enriched = enrichLink(link);
    expect(enriched.cardLabel).toBe('SESSION');
    expect(enriched.cardType).toBe('sessions');
  });

  it('sets worstPRStatus for a link with PRs', () => {
    const link = makeLink({
      prLinks: [{ number: 1, status: 'failing' }, { number: 2, status: 'approved' }],
    });
    const enriched = enrichLink(link);
    // 'failing' is highest urgency
    expect(enriched.worstPRStatus).toBe('failing');
  });
});

// MARK: - validateColumnMove

describe('validateColumnMove', () => {
  it('blocks move to in_progress when tmuxLink is present', () => {
    const link = makeLink({ tmuxLink: { sessionName: 'my-session' } });
    const result = validateColumnMove(link, 'in_progress');
    expect(result).toBe('Cannot move to In Progress: session is already running');
  });

  it('allows move to in_progress when no tmuxLink', () => {
    const link = makeLink({ tmuxLink: null });
    expect(validateColumnMove(link, 'in_progress')).toBeNull();
  });

  it('blocks move to in_review when prLinks is empty', () => {
    const link = makeLink({ prLinks: [] });
    const result = validateColumnMove(link, 'in_review');
    expect(result).toBe('Cannot move to In Review: no pull requests');
  });

  it('allows move to in_review when prLinks has at least one entry', () => {
    const link = makeLink({ prLinks: [{ number: 42, status: 'review_needed' }] });
    expect(validateColumnMove(link, 'in_review')).toBeNull();
  });

  it('blocks move to done when no merged PR exists', () => {
    const link = makeLink({ prLinks: [{ number: 1, status: 'approved' }] });
    const result = validateColumnMove(link, 'done');
    expect(result).toBe('Cannot move to Done: no merged pull request');
  });

  it('allows move to done when at least one PR is merged', () => {
    const link = makeLink({ prLinks: [{ number: 1, status: 'merged' }] });
    expect(validateColumnMove(link, 'done')).toBeNull();
  });

  it('allows move to backlog unconditionally', () => {
    const link = makeLink({ tmuxLink: { sessionName: 'x' }, prLinks: [] });
    expect(validateColumnMove(link, 'backlog')).toBeNull();
  });

  it('allows move to all_sessions unconditionally', () => {
    const link = makeLink();
    expect(validateColumnMove(link, 'all_sessions')).toBeNull();
  });

  it('allows move to in_progress when tmuxLink is null (not undefined)', () => {
    const link = makeLink({ tmuxLink: null });
    expect(validateColumnMove(link, 'in_progress')).toBeNull();
  });

  it('blocks done with prLinks containing only closed PRs', () => {
    const link = makeLink({ prLinks: [{ number: 1, status: 'closed' }] });
    expect(validateColumnMove(link, 'done')).toBe('Cannot move to Done: no merged pull request');
  });

  it('allows done when multiple PRs exist and one is merged', () => {
    const link = makeLink({
      prLinks: [
        { number: 1, status: 'closed' },
        { number: 2, status: 'merged' },
      ],
    });
    expect(validateColumnMove(link, 'done')).toBeNull();
  });

  it('allows move to in_review when tmuxLink present (no conflict)', () => {
    const link = makeLink({
      tmuxLink: { sessionName: 'sess' },
      prLinks: [{ number: 1, status: 'review_needed' }],
    });
    expect(validateColumnMove(link, 'in_review')).toBeNull();
  });
});
