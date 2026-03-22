import { describe, it, expect } from 'vitest';
import { createInitialState, reduce, type AppState, type Action } from '../board-store.js';
import { createLink, createDefaultManualOverrides } from '@kanban-code/shared';

function stateWith(links: Record<string, ReturnType<typeof createLink>>): AppState {
  return { ...createInitialState(), links };
}

describe('Reducer', () => {
  describe('createManualTask', () => {
    it('adds link to state and emits upsertLink effect', () => {
      const link = createLink({ id: 'card_test', name: 'Test', source: 'manual', column: 'backlog' });
      const { state, effects } = reduce(createInitialState(), { type: 'createManualTask', link });
      expect(state.links['card_test']).toBeDefined();
      expect(state.links['card_test'].name).toBe('Test');
      expect(effects).toHaveLength(1);
      expect(effects[0].type).toBe('upsertLink');
    });
  });

  describe('selectCard', () => {
    it('sets selectedCardId and updates lastOpenedAt', () => {
      const state = stateWith({ card_a: createLink({ id: 'card_a' }) });
      const { state: newState } = reduce(state, { type: 'selectCard', cardId: 'card_a' });
      expect(newState.selectedCardId).toBe('card_a');
      expect(newState.links['card_a'].lastOpenedAt).not.toBeNull();
    });

    it('sets null to deselect', () => {
      const state = { ...createInitialState(), selectedCardId: 'card_a' };
      const { state: newState } = reduce(state, { type: 'selectCard', cardId: null });
      expect(newState.selectedCardId).toBeNull();
    });
  });

  describe('moveCard', () => {
    it('updates column and sets manualOverrides.column', () => {
      const state = stateWith({ card_a: createLink({ id: 'card_a', column: 'backlog' }) });
      const { state: newState } = reduce(state, { type: 'moveCard', cardId: 'card_a', column: 'in_progress' });
      expect(newState.links['card_a'].column).toBe('in_progress');
      expect(newState.links['card_a'].manualOverrides.column).toBe(true);
    });

    it('sets manuallyArchived when moving to allSessions', () => {
      const state = stateWith({ card_a: createLink({ id: 'card_a', column: 'in_progress' }) });
      const { state: newState } = reduce(state, { type: 'moveCard', cardId: 'card_a', column: 'all_sessions' });
      expect(newState.links['card_a'].manuallyArchived).toBe(true);
    });

    it('clears sortOrder on move', () => {
      const state = stateWith({ card_a: createLink({ id: 'card_a', sortOrder: 5 }) });
      const { state: newState } = reduce(state, { type: 'moveCard', cardId: 'card_a', column: 'done' });
      expect(newState.links['card_a'].sortOrder).toBeNull();
    });

    it('clears manuallyArchived when moving out of allSessions', () => {
      const state = stateWith({ card_a: createLink({ id: 'card_a', column: 'all_sessions', manuallyArchived: true }) });
      const { state: newState } = reduce(state, { type: 'moveCard', cardId: 'card_a', column: 'backlog' });
      expect(newState.links['card_a'].manuallyArchived).toBe(false);
    });
  });

  describe('renameCard', () => {
    it('sets name and manualOverrides.name', () => {
      const state = stateWith({ card_a: createLink({ id: 'card_a', name: 'Old' }) });
      const { state: newState, effects } = reduce(state, { type: 'renameCard', cardId: 'card_a', name: 'New' });
      expect(newState.links['card_a'].name).toBe('New');
      expect(newState.links['card_a'].manualOverrides.name).toBe(true);
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });

    // Spec Section 7.8: renameCard must NOT trigger column reassignment
    it('does NOT change column or updatedAt', () => {
      const link = createLink({ id: 'card_a', column: 'backlog', updatedAt: '2020-01-01T00:00:00.000Z' });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, { type: 'renameCard', cardId: 'card_a', name: 'Renamed' });
      expect(newState.links['card_a'].column).toBe('backlog');
      // updatedAt should NOT change for rename
      expect(newState.links['card_a'].updatedAt).toBe('2020-01-01T00:00:00.000Z');
    });
  });

  describe('updatePrompt', () => {
    it('updates promptBody and promptImagePaths', () => {
      const state = stateWith({ card_a: createLink({ id: 'card_a' }) });
      const { state: newState, effects } = reduce(state, {
        type: 'updatePrompt', cardId: 'card_a', body: 'Fix the bug', imagePaths: ['/img/a.png'],
      });
      expect(newState.links['card_a'].promptBody).toBe('Fix the bug');
      expect(newState.links['card_a'].promptImagePaths).toEqual(['/img/a.png']);
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });

    it('emits deleteFiles effect for removed images', () => {
      const link = createLink({ id: 'card_a', promptImagePaths: ['/img/a.png', '/img/b.png'] });
      const state = stateWith({ card_a: link });
      const { effects } = reduce(state, {
        type: 'updatePrompt', cardId: 'card_a', body: 'Updated', imagePaths: ['/img/a.png'],
      });
      const deleteEffect = effects.find(e => e.type === 'deleteFiles');
      expect(deleteEffect).toBeDefined();
      if (deleteEffect?.type === 'deleteFiles') {
        expect(deleteEffect.paths).toEqual(['/img/b.png']);
      }
    });

    it('no-ops for missing card', () => {
      const { effects } = reduce(createInitialState(), {
        type: 'updatePrompt', cardId: 'missing', body: 'test',
      });
      expect(effects).toHaveLength(0);
    });
  });

  describe('archiveCard', () => {
    it('moves to allSessions, sets manuallyArchived, clears tmux', () => {
      const link = createLink({ id: 'card_a', column: 'in_progress', tmuxLink: { sessionName: 'proj-abc' } });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, { type: 'archiveCard', cardId: 'card_a' });
      expect(newState.links['card_a'].column).toBe('all_sessions');
      expect(newState.links['card_a'].manuallyArchived).toBe(true);
      expect(newState.links['card_a'].tmuxLink).toBeNull();
      expect(effects.some(e => e.type === 'killTmuxSessions')).toBe(true);
    });
  });

  describe('deleteCard', () => {
    it('removes link, adds to deletedCardIds, kills tmux, deletes session', () => {
      const link = createLink({
        id: 'card_a',
        sessionLink: { sessionId: 'sess-1', sessionPath: '/path.jsonl' },
        tmuxLink: { sessionName: 'proj-abc' },
      });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, { type: 'deleteCard', cardId: 'card_a' });
      expect(newState.links['card_a']).toBeUndefined();
      expect(newState.deletedCardIds).toContain('card_a');
      expect(newState.deletedSessionIds).toContain('sess-1');
      expect(effects.some(e => e.type === 'removeLink')).toBe(true);
      expect(effects.some(e => e.type === 'killTmuxSessions')).toBe(true);
      expect(effects.some(e => e.type === 'deleteSessionFile')).toBe(true);
    });

    it('clears selectedCardId if deleted card was selected', () => {
      const state = { ...stateWith({ card_a: createLink({ id: 'card_a' }) }), selectedCardId: 'card_a' };
      const { state: newState } = reduce(state, { type: 'deleteCard', cardId: 'card_a' });
      expect(newState.selectedCardId).toBeNull();
    });

    it('cleans up queued prompt images on delete', () => {
      const link = createLink({
        id: 'card_a',
        promptImagePaths: ['/img/prompt.png'],
        queuedPrompts: [{ id: 'q1', body: 'test', sendAutomatically: false, imagePaths: ['/img/queued.png'] }],
      });
      const state = stateWith({ card_a: link });
      const { effects } = reduce(state, { type: 'deleteCard', cardId: 'card_a' });
      const deleteFilesEffect = effects.find(e => e.type === 'deleteFiles');
      expect(deleteFilesEffect).toBeDefined();
      if (deleteFilesEffect?.type === 'deleteFiles') {
        expect(deleteFilesEffect.paths).toContain('/img/prompt.png');
        expect(deleteFilesEffect.paths).toContain('/img/queued.png');
      }
    });
  });

  describe('launchCard', () => {
    it('sets column to inProgress, isLaunching=true, creates tmuxLink', () => {
      const state = stateWith({ card_a: createLink({ id: 'card_a', column: 'backlog' }) });
      const { state: newState } = reduce(state, {
        type: 'launchCard', cardId: 'card_a', prompt: 'Fix it', projectPath: '/Users/me/repo',
      });
      expect(newState.links['card_a'].column).toBe('in_progress');
      expect(newState.links['card_a'].isLaunching).toBe(true);
      expect(newState.links['card_a'].tmuxLink).not.toBeNull();
      expect(newState.selectedCardId).toBe('card_a');
    });

    it('preserves shell-only session as extra on launch', () => {
      const link = createLink({
        id: 'card_a', column: 'backlog',
        tmuxLink: { sessionName: 'shell-card_a', isShellOnly: true },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'launchCard', cardId: 'card_a', prompt: 'Fix it', projectPath: '/Users/me/repo',
      });
      expect(newState.links['card_a'].tmuxLink?.extraSessions).toContain('shell-card_a');
    });
  });

  describe('resumeCard', () => {
    it('sets column to inProgress, isLaunching=true, clears manuallyArchived', () => {
      const link = createLink({
        id: 'card_a', column: 'all_sessions', manuallyArchived: true,
        sessionLink: { sessionId: 'sess-1' },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, { type: 'resumeCard', cardId: 'card_a' });
      expect(newState.links['card_a'].column).toBe('in_progress');
      expect(newState.links['card_a'].isLaunching).toBe(true);
      expect(newState.links['card_a'].manuallyArchived).toBe(false);
    });

    it('tmux name uses assistant prefix + session ID prefix', () => {
      const link = createLink({
        id: 'card_a', sessionLink: { sessionId: 'abcdef12-3456-7890' }, assistant: 'gemini',
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, { type: 'resumeCard', cardId: 'card_a' });
      expect(newState.links['card_a'].tmuxLink?.sessionName).toBe('gemini-abcdef12');
    });
  });

  describe('launchCompleted', () => {
    it('clears isLaunching, sets sessionLink and worktreeLink', () => {
      const link = createLink({ id: 'card_a', isLaunching: true, tmuxLink: { sessionName: 'proj-abc' } });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'launchCompleted', cardId: 'card_a', tmuxName: 'proj-abc',
        sessionLink: { sessionId: 'new-sess' }, worktreeLink: { path: '/wt', branch: 'feat-x' },
      });
      expect(newState.links['card_a'].isLaunching).toBeNull();
      expect(newState.links['card_a'].sessionLink?.sessionId).toBe('new-sess');
      expect(newState.links['card_a'].worktreeLink?.branch).toBe('feat-x');
    });

    it('preserves existing extraSessions', () => {
      const link = createLink({
        id: 'card_a', isLaunching: true,
        tmuxLink: { sessionName: 'proj-abc', extraSessions: ['proj-abc-sh1'] },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'launchCompleted', cardId: 'card_a', tmuxName: 'proj-new',
      });
      expect(newState.links['card_a'].tmuxLink?.sessionName).toBe('proj-new');
      expect(newState.links['card_a'].tmuxLink?.extraSessions).toEqual(['proj-abc-sh1']);
    });
  });

  describe('launchTmuxReady', () => {
    it('clears isLaunching and sets lastActivity', () => {
      const link = createLink({ id: 'card_a', isLaunching: true, tmuxLink: { sessionName: 'proj-abc' } });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, { type: 'launchTmuxReady', cardId: 'card_a' });
      expect(newState.links['card_a'].isLaunching).toBeNull();
      expect(newState.links['card_a'].lastActivity).not.toBeNull();
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });

    it('no-ops for missing card', () => {
      const { effects } = reduce(createInitialState(), { type: 'launchTmuxReady', cardId: 'missing' });
      expect(effects).toHaveLength(0);
    });
  });

  // Spec Section 7.8: launchFailed does NOT kill tmux
  describe('launchFailed', () => {
    it('clears isLaunching and tmuxLink but does NOT emit killTmux effect', () => {
      const link = createLink({ id: 'card_a', isLaunching: true, tmuxLink: { sessionName: 'proj-abc' } });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'launchFailed', cardId: 'card_a', error: 'oops',
      });
      expect(newState.links['card_a'].isLaunching).toBeNull();
      expect(newState.links['card_a'].tmuxLink).toBeNull();
      expect(newState.error).toBe('oops');
      // NO killTmux effect -- spec Section 7.8 behavioral invariant
      expect(effects.some(e => e.type === 'killTmuxSession' || e.type === 'killTmuxSessions')).toBe(false);
    });
  });

  describe('killTerminal', () => {
    it('killing primary with extras sets isPrimaryDead', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc', extraSessions: ['proj-abc-sh1'] },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, { type: 'killTerminal', cardId: 'card_a', sessionName: 'proj-abc' });
      expect(newState.links['card_a'].tmuxLink?.isPrimaryDead).toBe(true);
      expect(newState.links['card_a'].tmuxLink?.extraSessions).toEqual(['proj-abc-sh1']);
    });

    it('killing last extra while primary dead clears tmuxLink', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc', extraSessions: ['proj-abc-sh1'], isPrimaryDead: true },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, { type: 'killTerminal', cardId: 'card_a', sessionName: 'proj-abc-sh1' });
      expect(newState.links['card_a'].tmuxLink).toBeNull();
    });

    it('killing primary without extras clears tmuxLink', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc' },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, { type: 'killTerminal', cardId: 'card_a', sessionName: 'proj-abc' });
      expect(newState.links['card_a'].tmuxLink).toBeNull();
    });
  });

  // MARK: Terminal Management

  describe('addExtraTerminal', () => {
    it('adds session to extraSessions and creates tmux', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc' },
        projectPath: '/Users/me/repo',
      });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'addExtraTerminal', cardId: 'card_a', sessionName: 'proj-abc-sh1',
      });
      expect(newState.links['card_a'].tmuxLink?.extraSessions).toContain('proj-abc-sh1');
      expect(newState.busyCards).toContain('card_a');
      expect(effects.some(e => e.type === 'createTmuxSession')).toBe(true);
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });

    it('no-ops if card has no tmuxLink', () => {
      const link = createLink({ id: 'card_a' });
      const state = stateWith({ card_a: link });
      const { effects } = reduce(state, {
        type: 'addExtraTerminal', cardId: 'card_a', sessionName: 'extra-1',
      });
      expect(effects).toHaveLength(0);
    });
  });

  describe('extraTerminalCreated', () => {
    it('removes card from busyCards', () => {
      const state = { ...stateWith({ card_a: createLink({ id: 'card_a' }) }), busyCards: ['card_a'] };
      const { state: newState } = reduce(state, { type: 'extraTerminalCreated', cardId: 'card_a', sessionName: 'extra-1' });
      expect(newState.busyCards).not.toContain('card_a');
    });
  });

  describe('renameTerminalTab', () => {
    it('sets tab name for a session', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc', extraSessions: ['proj-sh1'] },
      });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'renameTerminalTab', cardId: 'card_a', sessionName: 'proj-sh1', label: 'Tests',
      });
      expect(newState.links['card_a'].tmuxLink?.tabNames?.['proj-sh1']).toBe('Tests');
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });

    it('removes tab name when label is empty', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc', tabNames: { 'proj-abc': 'Main' } },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'renameTerminalTab', cardId: 'card_a', sessionName: 'proj-abc', label: '',
      });
      expect(newState.links['card_a'].tmuxLink?.tabNames).toBeNull();
    });
  });

  describe('reorderTerminalTab', () => {
    it('moves session before another in extraSessions', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc', extraSessions: ['sh1', 'sh2', 'sh3'] },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'reorderTerminalTab', cardId: 'card_a', sessionName: 'sh3', beforeSession: 'sh1',
      });
      expect(newState.links['card_a'].tmuxLink?.extraSessions).toEqual(['sh3', 'sh1', 'sh2']);
    });

    it('moves session to end when beforeSession is null', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc', extraSessions: ['sh1', 'sh2', 'sh3'] },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'reorderTerminalTab', cardId: 'card_a', sessionName: 'sh1', beforeSession: null,
      });
      expect(newState.links['card_a'].tmuxLink?.extraSessions).toEqual(['sh2', 'sh3', 'sh1']);
    });
  });

  // MARK: Link Management

  describe('unlinkFromCard', () => {
    it('removes PR and adds to dismissedPRs', () => {
      const link = createLink({
        id: 'card_a',
        prLinks: [{ number: 42 }, { number: 99 }],
      });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'unlinkFromCard', cardId: 'card_a', linkType: { kind: 'pr', number: 42 },
      });
      expect(newState.links['card_a'].prLinks).toHaveLength(1);
      expect(newState.links['card_a'].prLinks[0].number).toBe(99);
      expect(newState.links['card_a'].manualOverrides.dismissedPRs).toContain(42);
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });

    it('removes issue link', () => {
      const link = createLink({
        id: 'card_a',
        issueLink: { number: 10 },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'unlinkFromCard', cardId: 'card_a', linkType: { kind: 'issue' },
      });
      expect(newState.links['card_a'].issueLink).toBeNull();
      expect(newState.links['card_a'].manualOverrides.issueLink).toBe(true);
    });

    it('removes worktree link and sets branchWatermark', () => {
      const link = createLink({
        id: 'card_a',
        worktreeLink: { path: '/wt/feat', branch: 'feat' },
        discoveredBranches: ['feat'],
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'unlinkFromCard', cardId: 'card_a', linkType: { kind: 'worktree' },
      });
      expect(newState.links['card_a'].worktreeLink).toBeNull();
      expect(newState.links['card_a'].discoveredBranches).toBeNull();
      expect(newState.links['card_a'].manualOverrides.branchWatermark).toBe(0);
    });

    it('removes tmux link', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc' },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'unlinkFromCard', cardId: 'card_a', linkType: { kind: 'tmux' },
      });
      expect(newState.links['card_a'].tmuxLink).toBeNull();
      expect(newState.links['card_a'].manualOverrides.tmuxSession).toBe(true);
    });
  });

  describe('addBranchToCard', () => {
    it('sets branch on existing worktreeLink', () => {
      const link = createLink({
        id: 'card_a',
        worktreeLink: { path: '/wt/old', branch: 'old' },
      });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'addBranchToCard', cardId: 'card_a', branch: 'feat-new',
      });
      expect(newState.links['card_a'].worktreeLink?.branch).toBe('feat-new');
      expect(newState.links['card_a'].worktreeLink?.path).toBe('/wt/old');
      expect(newState.links['card_a'].manualOverrides.worktreePath).toBe(true);
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });

    it('creates worktreeLink with empty path if none exists', () => {
      const link = createLink({ id: 'card_a' });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'addBranchToCard', cardId: 'card_a', branch: 'feat-x',
      });
      expect(newState.links['card_a'].worktreeLink?.branch).toBe('feat-x');
      expect(newState.links['card_a'].worktreeLink?.path).toBe('');
    });
  });

  describe('addIssueLinkToCard', () => {
    it('sets issueLink and marks manualOverride', () => {
      const link = createLink({ id: 'card_a' });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'addIssueLinkToCard', cardId: 'card_a', issueNumber: 42,
      });
      expect(newState.links['card_a'].issueLink?.number).toBe(42);
      expect(newState.links['card_a'].manualOverrides.issueLink).toBe(true);
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });
  });

  describe('addPRToCard', () => {
    it('adds PR link without duplicates', () => {
      const link = createLink({ id: 'card_a', prLinks: [{ number: 10 }] });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'addPRToCard', cardId: 'card_a', prNumber: 20,
      });
      expect(newState.links['card_a'].prLinks).toHaveLength(2);
      expect(newState.links['card_a'].prLinks.map(p => p.number)).toEqual([10, 20]);
    });

    it('does not add duplicate PR number', () => {
      const link = createLink({ id: 'card_a', prLinks: [{ number: 10 }] });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'addPRToCard', cardId: 'card_a', prNumber: 10,
      });
      expect(newState.links['card_a'].prLinks).toHaveLength(1);
    });

    it('un-dismisses a previously dismissed PR', () => {
      const link = createLink({
        id: 'card_a',
        prLinks: [],
        manualOverrides: { ...createDefaultManualOverrides(), dismissedPRs: [20, 30] },
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'addPRToCard', cardId: 'card_a', prNumber: 20,
      });
      expect(newState.links['card_a'].manualOverrides.dismissedPRs).toEqual([30]);
      expect(newState.links['card_a'].manualOverrides.prLink).toBe(false);
    });
  });

  describe('markPRMerged', () => {
    it('sets PR status to merged and moves card to done', () => {
      const link = createLink({
        id: 'card_a', column: 'in_review',
        prLinks: [{ number: 42, status: 'review_needed' }],
      });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'markPRMerged', cardId: 'card_a', prNumber: 42,
      });
      expect(newState.links['card_a'].prLinks[0].status).toBe('merged');
      expect(newState.links['card_a'].column).toBe('done');
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });
  });

  // MARK: Queued Prompts

  describe('addQueuedPrompt', () => {
    it('appends prompt to queuedPrompts', () => {
      const link = createLink({ id: 'card_a' });
      const state = stateWith({ card_a: link });
      const prompt = { id: 'q1', body: 'Fix tests', sendAutomatically: false };
      const { state: newState, effects } = reduce(state, {
        type: 'addQueuedPrompt', cardId: 'card_a', prompt,
      });
      expect(newState.links['card_a'].queuedPrompts).toHaveLength(1);
      expect(newState.links['card_a'].queuedPrompts![0].body).toBe('Fix tests');
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
    });
  });

  describe('updateQueuedPrompt', () => {
    it('updates existing prompt body and sendAutomatically', () => {
      const link = createLink({
        id: 'card_a',
        queuedPrompts: [{ id: 'q1', body: 'Old', sendAutomatically: false }],
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'updateQueuedPrompt', cardId: 'card_a', promptId: 'q1', body: 'New body', sendAutomatically: true,
      });
      expect(newState.links['card_a'].queuedPrompts![0].body).toBe('New body');
      expect(newState.links['card_a'].queuedPrompts![0].sendAutomatically).toBe(true);
    });

    it('no-ops if prompt ID not found', () => {
      const link = createLink({
        id: 'card_a',
        queuedPrompts: [{ id: 'q1', body: 'Old', sendAutomatically: false }],
      });
      const state = stateWith({ card_a: link });
      const { effects } = reduce(state, {
        type: 'updateQueuedPrompt', cardId: 'card_a', promptId: 'q_missing', body: 'New', sendAutomatically: false,
      });
      expect(effects).toHaveLength(0);
    });
  });

  describe('removeQueuedPrompt', () => {
    it('removes prompt by ID', () => {
      const link = createLink({
        id: 'card_a',
        queuedPrompts: [
          { id: 'q1', body: 'First', sendAutomatically: false },
          { id: 'q2', body: 'Second', sendAutomatically: true },
        ],
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'removeQueuedPrompt', cardId: 'card_a', promptId: 'q1',
      });
      expect(newState.links['card_a'].queuedPrompts).toHaveLength(1);
      expect(newState.links['card_a'].queuedPrompts![0].id).toBe('q2');
    });

    it('sets queuedPrompts to null when last prompt removed', () => {
      const link = createLink({
        id: 'card_a',
        queuedPrompts: [{ id: 'q1', body: 'Only', sendAutomatically: false }],
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'removeQueuedPrompt', cardId: 'card_a', promptId: 'q1',
      });
      expect(newState.links['card_a'].queuedPrompts).toBeNull();
    });
  });

  describe('sendQueuedPrompt', () => {
    it('removes prompt from queue and emits sendPromptToTmux effect', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc' },
        queuedPrompts: [{ id: 'q1', body: 'Run tests', sendAutomatically: false }],
        assistant: 'claude',
      });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'sendQueuedPrompt', cardId: 'card_a', promptId: 'q1',
      });
      expect(newState.links['card_a'].queuedPrompts).toBeNull();
      expect(effects.some(e => e.type === 'sendPromptToTmux')).toBe(true);
    });

    it('emits sendPromptWithImagesToTmux for prompts with images (claude)', () => {
      const link = createLink({
        id: 'card_a',
        tmuxLink: { sessionName: 'proj-abc' },
        queuedPrompts: [{ id: 'q1', body: 'Fix', sendAutomatically: false, imagePaths: ['/img/a.png'] }],
        assistant: 'claude',
      });
      const state = stateWith({ card_a: link });
      const { effects } = reduce(state, {
        type: 'sendQueuedPrompt', cardId: 'card_a', promptId: 'q1',
      });
      expect(effects.some(e => e.type === 'sendPromptWithImagesToTmux')).toBe(true);
    });

    it('no-ops if no tmuxLink', () => {
      const link = createLink({
        id: 'card_a',
        queuedPrompts: [{ id: 'q1', body: 'Run', sendAutomatically: false }],
      });
      const state = stateWith({ card_a: link });
      const { effects } = reduce(state, {
        type: 'sendQueuedPrompt', cardId: 'card_a', promptId: 'q1',
      });
      expect(effects).toHaveLength(0);
    });
  });

  // MARK: Card Organization

  describe('moveCardToProject', () => {
    it('updates projectPath and clears repo-specific links', () => {
      const link = createLink({
        id: 'card_a',
        projectPath: '/old/project',
        worktreeLink: { path: '/wt', branch: 'feat' },
        prLinks: [{ number: 10 }],
        discoveredBranches: ['feat'],
        tmuxLink: { sessionName: 'proj-abc' },
      });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'moveCardToProject', cardId: 'card_a', projectPath: '/new/project',
      });
      expect(newState.links['card_a'].projectPath).toBe('/new/project');
      expect(newState.links['card_a'].worktreeLink).toBeNull();
      expect(newState.links['card_a'].prLinks).toEqual([]);
      expect(newState.links['card_a'].discoveredBranches).toBeNull();
      expect(newState.links['card_a'].tmuxLink).toBeNull();
      expect(effects.some(e => e.type === 'killTmuxSessions')).toBe(true);
    });

    it('emits moveSessionFile when session exists and project changed', () => {
      const link = createLink({
        id: 'card_a',
        projectPath: '/old/project',
        sessionLink: { sessionId: 'sess-1', sessionPath: '/old/sess.jsonl' },
      });
      const state = stateWith({ card_a: link });
      const { effects } = reduce(state, {
        type: 'moveCardToProject', cardId: 'card_a', projectPath: '/new/project',
      });
      expect(effects.some(e => e.type === 'moveSessionFile')).toBe(true);
    });
  });

  describe('moveCardToFolder', () => {
    it('uses parentProjectPath for projectPath and folderPath for session move', () => {
      const link = createLink({
        id: 'card_a',
        projectPath: '/mono/repo',
        sessionLink: { sessionId: 'sess-1', sessionPath: '/old/sess.jsonl' },
        tmuxLink: { sessionName: 'proj-abc' },
      });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'moveCardToFolder', cardId: 'card_a', folderPath: '/mono/repo/packages/web', parentProjectPath: '/mono/repo',
      });
      expect(newState.links['card_a'].projectPath).toBe('/mono/repo');
      // Same project -> don't clear repo links
      expect(newState.links['card_a'].tmuxLink).toBeNull(); // tmux always cleared
      const moveEffect = effects.find(e => e.type === 'moveSessionFile');
      expect(moveEffect).toBeDefined();
      if (moveEffect?.type === 'moveSessionFile') {
        expect(moveEffect.newProjectPath).toBe('/mono/repo/packages/web');
      }
    });

    it('clears repo links when parent project differs', () => {
      const link = createLink({
        id: 'card_a',
        projectPath: '/old/project',
        worktreeLink: { path: '/wt', branch: 'feat' },
        prLinks: [{ number: 1 }],
      });
      const state = stateWith({ card_a: link });
      const { state: newState } = reduce(state, {
        type: 'moveCardToFolder', cardId: 'card_a', folderPath: '/new/folder', parentProjectPath: '/new/project',
      });
      expect(newState.links['card_a'].worktreeLink).toBeNull();
      expect(newState.links['card_a'].prLinks).toEqual([]);
    });
  });

  describe('mergeCards', () => {
    it('transfers links from source to target and removes source', () => {
      const source = createLink({
        id: 'card_src',
        worktreeLink: { path: '/wt', branch: 'feat' },
        prLinks: [{ number: 10 }],
        name: 'Source Name',
      });
      const target = createLink({
        id: 'card_tgt',
        sessionLink: { sessionId: 'sess-1' },
      });
      const state = stateWith({ card_src: source, card_tgt: target });
      const { state: newState, effects } = reduce(state, {
        type: 'mergeCards', sourceId: 'card_src', targetId: 'card_tgt',
      });
      expect(newState.links['card_src']).toBeUndefined();
      expect(newState.links['card_tgt']).toBeDefined();
      expect(newState.links['card_tgt'].worktreeLink?.branch).toBe('feat');
      expect(newState.links['card_tgt'].name).toBe('Source Name');
      expect(newState.links['card_tgt'].prLinks).toHaveLength(1);
      expect(newState.deletedCardIds).toContain('card_src');
      expect(effects.some(e => e.type === 'upsertLink')).toBe(true);
      expect(effects.some(e => e.type === 'removeLink')).toBe(true);
    });

    it('blocks merge when both have sessions', () => {
      const source = createLink({ id: 'card_src', sessionLink: { sessionId: 'sess-1' } });
      const target = createLink({ id: 'card_tgt', sessionLink: { sessionId: 'sess-2' } });
      const state = stateWith({ card_src: source, card_tgt: target });
      const { state: newState, effects } = reduce(state, {
        type: 'mergeCards', sourceId: 'card_src', targetId: 'card_tgt',
      });
      expect(newState.error).toContain('Cannot merge');
      expect(newState.links['card_src']).toBeDefined(); // source not removed
      expect(effects).toHaveLength(0);
    });

    it('deduplicates PR numbers on merge', () => {
      const source = createLink({ id: 'card_src', prLinks: [{ number: 10 }, { number: 20 }] });
      const target = createLink({ id: 'card_tgt', prLinks: [{ number: 10 }] });
      const state = stateWith({ card_src: source, card_tgt: target });
      const { state: newState } = reduce(state, {
        type: 'mergeCards', sourceId: 'card_src', targetId: 'card_tgt',
      });
      expect(newState.links['card_tgt'].prLinks.map(p => p.number)).toEqual([10, 20]);
    });

    it('selects target if source was selected', () => {
      const source = createLink({ id: 'card_src' });
      const target = createLink({ id: 'card_tgt' });
      const state = { ...stateWith({ card_src: source, card_tgt: target }), selectedCardId: 'card_src' };
      const { state: newState } = reduce(state, {
        type: 'mergeCards', sourceId: 'card_src', targetId: 'card_tgt',
      });
      expect(newState.selectedCardId).toBe('card_tgt');
    });
  });

  // MARK: Migration

  describe('beginMigration', () => {
    it('sets isLaunching and adds to busyCards', () => {
      const link = createLink({ id: 'card_a' });
      const state = stateWith({ card_a: link });
      const { state: newState, effects } = reduce(state, {
        type: 'beginMigration', cardId: 'card_a',
      });
      expect(newState.links['card_a'].isLaunching).toBe(true);
      expect(newState.busyCards).toContain('card_a');
      expect(effects).toHaveLength(0);
    });
  });

  describe('migrateSession', () => {
    it('updates assistant and session, kills old tmux', () => {
      const link = createLink({
        id: 'card_a',
        assistant: 'claude',
        sessionLink: { sessionId: 'old-sess' },
        tmuxLink: { sessionName: 'claude-old' },
      });
      const state = { ...stateWith({ card_a: link }), busyCards: ['card_a'] };
      const { state: newState, effects } = reduce(state, {
        type: 'migrateSession', cardId: 'card_a', newAssistant: 'gemini',
        newSessionId: 'new-sess', newSessionPath: '/new/path.json',
      });
      expect(newState.links['card_a'].assistant).toBe('gemini');
      expect(newState.links['card_a'].sessionLink?.sessionId).toBe('new-sess');
      expect(newState.links['card_a'].tmuxLink).toBeNull();
      expect(newState.links['card_a'].isLaunching).toBeNull();
      expect(newState.busyCards).not.toContain('card_a');
      expect(newState.deletedSessionIds).toContain('old-sess');
      expect(effects.some(e => e.type === 'killTmuxSessions')).toBe(true);
    });
  });

  describe('migrationFailed', () => {
    it('clears isLaunching and sets error', () => {
      const link = createLink({ id: 'card_a', isLaunching: true });
      const state = { ...stateWith({ card_a: link }), busyCards: ['card_a'] };
      const { state: newState } = reduce(state, {
        type: 'migrationFailed', cardId: 'card_a', error: 'API error',
      });
      expect(newState.links['card_a'].isLaunching).toBeNull();
      expect(newState.busyCards).not.toContain('card_a');
      expect(newState.error).toContain('Migration failed');
    });
  });

  // MARK: UI State

  describe('setPaletteOpen', () => {
    it('sets paletteOpen', () => {
      const { state } = reduce(createInitialState(), { type: 'setPaletteOpen', open: true });
      expect(state.paletteOpen).toBe(true);
    });

    it('clears paletteOpen', () => {
      const state = { ...createInitialState(), paletteOpen: true };
      const { state: newState } = reduce(state, { type: 'setPaletteOpen', open: false });
      expect(newState.paletteOpen).toBe(false);
    });
  });

  describe('setDetailExpanded', () => {
    it('sets detailExpanded', () => {
      const { state } = reduce(createInitialState(), { type: 'setDetailExpanded', expanded: true });
      expect(state.detailExpanded).toBe(true);
    });
  });

  describe('setSelectedProject', () => {
    it('sets selectedProjectPath', () => {
      const { state } = reduce(createInitialState(), { type: 'setSelectedProject', path: '/Users/me/proj' });
      expect(state.selectedProjectPath).toBe('/Users/me/proj');
    });

    it('clears with null', () => {
      const state = { ...createInitialState(), selectedProjectPath: '/old' };
      const { state: newState } = reduce(state, { type: 'setSelectedProject', path: null });
      expect(newState.selectedProjectPath).toBeNull();
    });
  });

  // MARK: Settings / Misc

  describe('setError', () => {
    it('sets error message', () => {
      const { state } = reduce(createInitialState(), { type: 'setError', message: 'Something broke' });
      expect(state.error).toBe('Something broke');
    });

    it('clears error with null', () => {
      const state = { ...createInitialState(), error: 'old error' };
      const { state: newState } = reduce(state, { type: 'setError', message: null });
      expect(newState.error).toBeNull();
    });
  });

  describe('setRateLimitedRepos', () => {
    it('sets rateLimitedRepos', () => {
      const { state } = reduce(createInitialState(), {
        type: 'setRateLimitedRepos', repos: ['/repo/a', '/repo/b'],
      });
      expect(state.rateLimitedRepos).toEqual(['/repo/a', '/repo/b']);
    });
  });

  describe('setIsRefreshingBacklog', () => {
    it('sets isRefreshingBacklog', () => {
      const { state } = reduce(createInitialState(), {
        type: 'setIsRefreshingBacklog', refreshing: true,
      });
      expect(state.isRefreshingBacklog).toBe(true);
    });
  });

  describe('settingsLoaded', () => {
    it('sets configuredProjects, excludedPaths, and globalRemoteSettings', () => {
      const projects = [{ path: '/proj', name: 'Proj', visible: true }];
      const { state } = reduce(createInitialState(), {
        type: 'settingsLoaded', projects, excludedPaths: ['/excluded'], remote: { host: 'example.com', user: 'me' } as any,
      });
      expect(state.configuredProjects).toEqual(projects);
      expect(state.excludedPaths).toEqual(['/excluded']);
      expect(state.globalRemoteSettings).not.toBeNull();
    });
  });

  // MARK: Background

  describe('gitHubIssuesUpdated', () => {
    it('merges updated links and removes stale github_issue cards', () => {
      const existingIssue = createLink({
        id: 'card_stale', source: 'github_issue', column: 'backlog',
        issueLink: { number: 5 },
      });
      const updatedIssue = createLink({
        id: 'card_updated', source: 'github_issue', column: 'backlog',
        issueLink: { number: 10 },
      });
      const manualCard = createLink({ id: 'card_manual', source: 'manual', column: 'backlog' });
      const state = stateWith({
        card_stale: existingIssue,
        card_manual: manualCard,
      });
      const { state: newState, effects } = reduce(state, {
        type: 'gitHubIssuesUpdated', links: [updatedIssue],
      });
      expect(newState.links['card_stale']).toBeUndefined(); // stale github issue removed
      expect(newState.links['card_updated']).toBeDefined(); // new issue added
      expect(newState.links['card_manual']).toBeDefined(); // manual card preserved
      expect(newState.lastGitHubRefresh).not.toBeNull();
      expect(effects.some(e => e.type === 'persistLinks')).toBe(true);
    });

    it('preserves in-memory changes with newer updatedAt', () => {
      const fresh = new Date().toISOString();
      const stale = new Date(Date.now() - 10_000).toISOString();
      const inMemory = createLink({ id: 'card_a', source: 'github_issue', column: 'backlog', name: 'Modified', updatedAt: fresh });
      const state = stateWith({ card_a: inMemory });
      const reconciled = createLink({ id: 'card_a', source: 'github_issue', column: 'backlog', name: 'Old', updatedAt: stale });
      const { state: newState } = reduce(state, {
        type: 'gitHubIssuesUpdated', links: [reconciled],
      });
      expect(newState.links['card_a'].name).toBe('Modified');
    });
  });

  // === Spec Section 7.8: reconciled action invariants ===

  describe('reconciled -- isLaunching guard', () => {
    it('preserves cards with isLaunching=true (no activity yet)', () => {
      const launching = createLink({
        id: 'card_a', column: 'in_progress', isLaunching: true,
        tmuxLink: { sessionName: 'proj-abc' },
        updatedAt: new Date().toISOString(),
      });
      const state = stateWith({ card_a: launching });
      const reconciledLink = createLink({ id: 'card_a', column: 'backlog' });
      const { state: newState } = reduce(state, {
        type: 'reconciled',
        result: { links: { card_a: reconciledLink }, activityMap: {} },
      });
      // Must preserve in-memory launching state, NOT overwrite with stale reconciled data
      expect(newState.links['card_a'].isLaunching).toBe(true);
      expect(newState.links['card_a'].column).toBe('in_progress');
    });

    it('clears isLaunching when activity is detected', () => {
      const launching = createLink({
        id: 'card_a', column: 'in_progress', isLaunching: true,
        sessionLink: { sessionId: 'sess-1' },
        updatedAt: new Date().toISOString(),
      });
      const state = stateWith({ card_a: launching });
      const reconciledLink = createLink({ id: 'card_a', column: 'in_progress' });
      const { state: newState } = reduce(state, {
        type: 'reconciled',
        result: {
          links: { card_a: reconciledLink },
          activityMap: { 'sess-1': 'actively_working' },
        },
      });
      expect(newState.links['card_a'].isLaunching).toBeNull();
    });

    it('clears stale isLaunching after 30s (crash recovery)', () => {
      const staleDate = new Date(Date.now() - 35_000).toISOString(); // 35s ago
      const launching = createLink({
        id: 'card_a', column: 'in_progress', isLaunching: true,
        updatedAt: staleDate,
      });
      const state = stateWith({ card_a: launching });
      const reconciledLink = createLink({ id: 'card_a', column: 'backlog' });
      const { state: newState } = reduce(state, {
        type: 'reconciled',
        result: { links: { card_a: reconciledLink }, activityMap: {} },
      });
      // Stale launch: isLaunching should be force-cleared
      expect(newState.links['card_a'].isLaunching).toBeNull();
    });
  });

  describe('reconciled -- deleted cards/sessions skip', () => {
    it('skips cards in deletedCardIds', () => {
      const state = {
        ...createInitialState(),
        deletedCardIds: ['card_a'],
        links: {},
      };
      const reconciledLink = createLink({ id: 'card_a', name: 'Resurrected' });
      const { state: newState } = reduce(state, {
        type: 'reconciled',
        result: { links: { card_a: reconciledLink } },
      });
      expect(newState.links['card_a']).toBeUndefined();
    });

    it('skips cards whose sessionId is in deletedSessionIds', () => {
      const state = {
        ...createInitialState(),
        deletedSessionIds: ['sess-dead'],
        links: {},
      };
      const reconciledLink = createLink({
        id: 'card_a', sessionLink: { sessionId: 'sess-dead' },
      });
      const { state: newState } = reduce(state, {
        type: 'reconciled',
        result: { links: { card_a: reconciledLink } },
      });
      expect(newState.links['card_a']).toBeUndefined();
    });
  });

  describe('reconciled -- last-writer-wins on updatedAt', () => {
    it('preserves in-memory changes with newer updatedAt', () => {
      const fresh = new Date().toISOString();
      const stale = new Date(Date.now() - 10_000).toISOString(); // 10s older
      const inMemory = createLink({ id: 'card_a', name: 'Renamed', updatedAt: fresh });
      const state = stateWith({ card_a: inMemory });
      const reconciledLink = createLink({ id: 'card_a', name: 'Old Name', updatedAt: stale });
      const { state: newState } = reduce(state, {
        type: 'reconciled',
        result: { links: { card_a: reconciledLink } },
      });
      expect(newState.links['card_a'].name).toBe('Renamed');
    });

    it('accepts reconciled data when it is newer', () => {
      const stale = new Date(Date.now() - 10_000).toISOString();
      const fresh = new Date().toISOString();
      const inMemory = createLink({ id: 'card_a', name: 'Old', updatedAt: stale });
      const state = stateWith({ card_a: inMemory });
      const reconciledLink = createLink({ id: 'card_a', name: 'Updated by reconciler', updatedAt: fresh });
      const { state: newState } = reduce(state, {
        type: 'reconciled',
        result: { links: { card_a: reconciledLink } },
      });
      expect(newState.links['card_a'].name).toBe('Updated by reconciler');
    });
  });

  describe('reconciled -- orphan worktree dedup', () => {
    it('absorbs orphan worktree cards into session cards on same branch', () => {
      const real = createLink({
        id: 'card_real', sessionLink: { sessionId: 'sess-1' },
        worktreeLink: { path: '/wt/feat-x', branch: 'feat-x' },
      });
      const orphan = createLink({
        id: 'card_orphan', source: 'discovered',
        worktreeLink: { path: '/wt/feat-x', branch: 'feat-x' },
      });
      const { state: newState } = reduce(createInitialState(), {
        type: 'reconciled',
        result: { links: { card_real: real, card_orphan: orphan } },
      });
      expect(newState.links['card_real']).toBeDefined();
      expect(newState.links['card_orphan']).toBeUndefined();
    });
  });

  describe('reconciled -- selected card validation', () => {
    it('clears selectedCardId if selected card no longer in links after merge', () => {
      // card_b exists in state but not in reconciled links -- it gets replaced
      // selectedCardId points to card_b which won't survive
      const cardA = createLink({ id: 'card_a', updatedAt: new Date().toISOString() });
      const state = {
        ...stateWith({ card_a: cardA }),
        selectedCardId: 'card_gone', // points to non-existent card
      };
      const { state: newState } = reduce(state, {
        type: 'reconciled',
        result: { links: { card_a: cardA } },
      });
      expect(newState.selectedCardId).toBeNull();
    });
  });
});
