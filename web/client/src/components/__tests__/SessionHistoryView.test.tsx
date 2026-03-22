import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SessionHistoryView from '../SessionHistoryView';
import type { ConversationTurn, ContentBlock } from '@kanban-code/shared';

function makeTurn(overrides: Partial<ConversationTurn> & { index: number }): ConversationTurn {
  return {
    lineNumber: overrides.index * 10,
    role: 'user',
    textPreview: `Turn ${overrides.index}`,
    contentBlocks: [],
    ...overrides,
  };
}

function makeTextBlock(text: string): ContentBlock {
  return { kind: { type: 'text' }, text };
}

function makeToolUseBlock(name: string, text: string): ContentBlock {
  return { kind: { type: 'toolUse', name, input: {} }, text };
}

function makeToolResultBlock(text: string): ContentBlock {
  return { kind: { type: 'toolResult', toolName: null }, text };
}

function makeThinkingBlock(): ContentBlock {
  return { kind: { type: 'thinking' }, text: 'thinking...' };
}

describe('SessionHistoryView', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Loading state', () => {
    it('shows loading indicator when isLoading is true', () => {
      render(<SessionHistoryView turns={[]} isLoading={true} />);
      expect(screen.getByTestId('session-history-loading')).toBeDefined();
      expect(screen.getByText('Loading conversation...')).toBeDefined();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when turns is empty and not loading', () => {
      render(<SessionHistoryView turns={[]} isLoading={false} />);
      expect(screen.getByTestId('session-history-empty')).toBeDefined();
      expect(screen.getByText('No conversation history')).toBeDefined();
    });
  });

  describe('Turn rendering', () => {
    it('renders user turns with prompt symbol', () => {
      const turns = [
        makeTurn({
          index: 0,
          role: 'user',
          textPreview: 'Hello Claude',
          contentBlocks: [makeTextBlock('Hello Claude')],
        }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);
      expect(screen.getByTestId('turn-user')).toBeDefined();
      expect(screen.getByText('Hello Claude')).toBeDefined();
    });

    it('renders assistant turns with bullet marker', () => {
      const turns = [
        makeTurn({
          index: 0,
          role: 'assistant',
          textPreview: 'I can help',
          contentBlocks: [makeTextBlock('I can help')],
        }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);
      expect(screen.getByTestId('turn-assistant')).toBeDefined();
      expect(screen.getByText('I can help')).toBeDefined();
    });

    it('renders assistant turn with fallback when no content blocks', () => {
      const turns = [
        makeTurn({
          index: 0,
          role: 'assistant',
          textPreview: 'Fallback text',
          contentBlocks: [],
        }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);
      expect(screen.getByText('Fallback text')).toBeDefined();
    });

    it('renders tool use lines', () => {
      const turns = [
        makeTurn({
          index: 0,
          role: 'assistant',
          textPreview: '',
          contentBlocks: [makeToolUseBlock('Read', 'Read /path/to/file.ts')],
        }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);
      expect(screen.getByTestId('tool-use-line')).toBeDefined();
      expect(screen.getByText('Read')).toBeDefined();
    });

    it('renders tool result lines', () => {
      const turns = [
        makeTurn({
          index: 0,
          role: 'assistant',
          textPreview: '',
          contentBlocks: [makeToolResultBlock('File contents here')],
        }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);
      expect(screen.getByTestId('tool-result-line')).toBeDefined();
      expect(screen.getByText('File contents here')).toBeDefined();
    });

    it('renders thinking lines', () => {
      const turns = [
        makeTurn({
          index: 0,
          role: 'assistant',
          textPreview: '',
          contentBlocks: [makeThinkingBlock()],
        }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);
      expect(screen.getByText('Thinking...')).toBeDefined();
    });

    it('renders multiple turns in order', () => {
      const turns = [
        makeTurn({ index: 0, role: 'user', textPreview: 'First', contentBlocks: [makeTextBlock('First')] }),
        makeTurn({ index: 1, role: 'assistant', textPreview: 'Second', contentBlocks: [makeTextBlock('Second')] }),
        makeTurn({ index: 2, role: 'user', textPreview: 'Third', contentBlocks: [makeTextBlock('Third')] }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);
      const userTurns = screen.getAllByTestId('turn-user');
      const assistantTurns = screen.getAllByTestId('turn-assistant');
      expect(userTurns.length).toBe(2);
      expect(assistantTurns.length).toBe(1);
    });

    it('uses gemini prompt symbol when assistant is gemini', () => {
      const turns = [
        makeTurn({ index: 0, role: 'user', textPreview: 'Hello', contentBlocks: [makeTextBlock('Hello')] }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} assistant="gemini" />);
      expect(screen.getByTestId('turn-user')).toBeDefined();
    });
  });

  describe('Checkpoint mode', () => {
    it('shows checkpoint banner when checkpointMode is true', () => {
      const turns = [
        makeTurn({ index: 0, role: 'user', textPreview: 'Turn 0' }),
      ];
      render(
        <SessionHistoryView
          turns={turns}
          isLoading={false}
          checkpointMode={true}
        />
      );
      expect(screen.getByTestId('checkpoint-banner')).toBeDefined();
      expect(screen.getByText(/Click a turn to restore to/)).toBeDefined();
    });

    it('does not show checkpoint banner when checkpointMode is false', () => {
      const turns = [
        makeTurn({ index: 0, role: 'user', textPreview: 'Turn 0' }),
      ];
      render(
        <SessionHistoryView
          turns={turns}
          isLoading={false}
          checkpointMode={false}
        />
      );
      expect(screen.queryByTestId('checkpoint-banner')).toBeNull();
    });

    it('calls onCancelCheckpoint when cancel button is clicked', () => {
      const onCancel = vi.fn();
      const turns = [makeTurn({ index: 0, role: 'user', textPreview: 'Turn 0' })];
      render(
        <SessionHistoryView
          turns={turns}
          isLoading={false}
          checkpointMode={true}
          onCancelCheckpoint={onCancel}
        />
      );
      fireEvent.click(screen.getByTestId('cancel-checkpoint'));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('calls onSelectTurn when a turn is clicked in checkpoint mode', () => {
      const onSelect = vi.fn();
      const turn = makeTurn({ index: 0, role: 'user', textPreview: 'Clickable turn' });
      render(
        <SessionHistoryView
          turns={[turn]}
          isLoading={false}
          checkpointMode={true}
          onSelectTurn={onSelect}
        />
      );
      fireEvent.click(screen.getByTestId('turn-user'));
      expect(onSelect).toHaveBeenCalledWith(turn);
    });
  });

  describe('Loading more indicator', () => {
    it('shows loading more indicator when hasMoreTurns and isLoadingMore', () => {
      const turns = [makeTurn({ index: 0, role: 'user', textPreview: 'Turn 0' })];
      render(
        <SessionHistoryView
          turns={turns}
          isLoading={false}
          hasMoreTurns={true}
          isLoadingMore={true}
        />
      );
      expect(screen.getByTestId('loading-more')).toBeDefined();
      expect(screen.getByText('Loading history...')).toBeDefined();
    });

    it('does not show loading more indicator when not loading', () => {
      const turns = [makeTurn({ index: 0, role: 'user', textPreview: 'Turn 0' })];
      render(
        <SessionHistoryView
          turns={turns}
          isLoading={false}
          hasMoreTurns={true}
          isLoadingMore={false}
        />
      );
      expect(screen.queryByTestId('loading-more')).toBeNull();
    });
  });

  describe('Search', () => {
    it('opens search bar on Ctrl+F', async () => {
      const turns = [makeTurn({ index: 0, role: 'user', textPreview: 'Hello world' })];
      render(<SessionHistoryView turns={turns} isLoading={false} />);

      expect(screen.queryByTestId('search-bar')).toBeNull();

      await act(async () => {
        fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      });

      expect(screen.getByTestId('search-bar')).toBeDefined();
    });

    it('closes search on Escape key', async () => {
      const turns = [makeTurn({ index: 0, role: 'user', textPreview: 'Hello world' })];
      render(<SessionHistoryView turns={turns} isLoading={false} />);

      await act(async () => {
        fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      });
      expect(screen.getByTestId('search-bar')).toBeDefined();

      await act(async () => {
        fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Escape' });
      });
      expect(screen.queryByTestId('search-bar')).toBeNull();
    });

    it('debounces search and requires min 2 chars', async () => {
      const turns = [
        makeTurn({ index: 0, role: 'user', textPreview: 'Hello world', contentBlocks: [makeTextBlock('Hello world')] }),
        makeTurn({ index: 1, role: 'assistant', textPreview: 'Hi there', contentBlocks: [makeTextBlock('Hi there')] }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);

      // Open search
      await act(async () => {
        fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      });

      const input = screen.getByTestId('search-input');

      // Type single char -- should not trigger search
      fireEvent.change(input, { target: { value: 'H' } });

      // Wait for debounce (real timers)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      // No results displayed for single char
      expect(screen.queryByTestId('search-no-results')).toBeNull();

      // Type 2+ chars
      fireEvent.change(input, { target: { value: 'Hello' } });

      // Wait for debounce
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      // Should find 1 match (client-side fallback)
      const container = screen.getByTestId('search-bar');
      expect(container.textContent).toContain('1/1');
    });

    it('shows 0 results when no matches found', async () => {
      const turns = [
        makeTurn({ index: 0, role: 'user', textPreview: 'Hello world', contentBlocks: [makeTextBlock('Hello world')] }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);

      await act(async () => {
        fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      });

      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: 'zzzzz' } });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(screen.getByTestId('search-no-results')).toBeDefined();
    });

    it('clears search results when input is emptied', async () => {
      const turns = [
        makeTurn({ index: 0, role: 'user', textPreview: 'Hello', contentBlocks: [makeTextBlock('Hello')] }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);

      await act(async () => {
        fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      });

      const input = screen.getByTestId('search-input');

      fireEvent.change(input, { target: { value: 'Hello' } });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      // Clear
      fireEvent.change(input, { target: { value: '' } });

      expect(screen.queryByTestId('search-no-results')).toBeNull();
    });
  });

  describe('Search highlighting', () => {
    it('highlights matching text in turns', async () => {
      const turns = [
        makeTurn({ index: 0, role: 'user', textPreview: 'Hello world', contentBlocks: [makeTextBlock('Hello world')] }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);

      await act(async () => {
        fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      });

      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: 'Hello' } });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      const marks = document.querySelectorAll('mark');
      expect(marks.length).toBeGreaterThan(0);
    });
  });

  describe('Search navigation', () => {
    it('shows navigation buttons when matches exist', async () => {
      const turns = [
        makeTurn({ index: 0, role: 'user', textPreview: 'test match', contentBlocks: [makeTextBlock('test match')] }),
        makeTurn({ index: 1, role: 'assistant', textPreview: 'test match 2', contentBlocks: [makeTextBlock('test match 2')] }),
      ];
      render(<SessionHistoryView turns={turns} isLoading={false} />);

      await act(async () => {
        fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      });

      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: 'test' } });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(screen.getByTestId('search-prev')).toBeDefined();
      expect(screen.getByTestId('search-next')).toBeDefined();
    });
  });
});
