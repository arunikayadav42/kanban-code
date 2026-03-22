import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import QueuedPromptsBar from '../QueuedPromptsBar';
import type { QueuedPrompt } from '@kanban-code/shared';

function makePrompt(overrides: Partial<QueuedPrompt> & { id: string }): QueuedPrompt {
  return {
    body: `Prompt ${overrides.id}`,
    sendAutomatically: false,
    ...overrides,
  };
}

describe('QueuedPromptsBar', () => {
  const defaultHandlers = {
    onSendNow: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  };

  describe('Rendering', () => {
    it('renders the bar container', () => {
      render(
        <QueuedPromptsBar
          prompts={[makePrompt({ id: 'p1' })]}
          {...defaultHandlers}
        />
      );
      expect(screen.getByTestId('queued-prompts-bar')).toBeDefined();
    });

    it('renders each prompt in the list', () => {
      const prompts = [
        makePrompt({ id: 'p1', body: 'First prompt' }),
        makePrompt({ id: 'p2', body: 'Second prompt' }),
      ];
      render(<QueuedPromptsBar prompts={prompts} {...defaultHandlers} />);
      expect(screen.getByText('First prompt')).toBeDefined();
      expect(screen.getByText('Second prompt')).toBeDefined();
    });

    it('shows bolt icon for auto-send prompts', () => {
      const prompts = [makePrompt({ id: 'p1', sendAutomatically: true })];
      render(<QueuedPromptsBar prompts={prompts} {...defaultHandlers} />);
      expect(screen.getByTestId('auto-send-icon')).toBeDefined();
    });

    it('does not show bolt icon for non-auto-send prompts', () => {
      const prompts = [makePrompt({ id: 'p1', sendAutomatically: false })];
      render(<QueuedPromptsBar prompts={prompts} {...defaultHandlers} />);
      expect(screen.queryByTestId('auto-send-icon')).toBeNull();
    });
  });

  describe('Send Now button', () => {
    it('renders Send Now button for each prompt', () => {
      const prompts = [
        makePrompt({ id: 'p1' }),
        makePrompt({ id: 'p2' }),
      ];
      render(<QueuedPromptsBar prompts={prompts} {...defaultHandlers} />);
      expect(screen.getByTestId('send-now-p1')).toBeDefined();
      expect(screen.getByTestId('send-now-p2')).toBeDefined();
    });

    it('calls onSendNow with prompt id when clicked', () => {
      const onSendNow = vi.fn();
      const prompts = [makePrompt({ id: 'p1' })];
      render(
        <QueuedPromptsBar
          prompts={prompts}
          onSendNow={onSendNow}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );
      fireEvent.click(screen.getByTestId('send-now-p1'));
      expect(onSendNow).toHaveBeenCalledWith('p1');
    });
  });

  describe('Edit button', () => {
    it('calls onEdit with the prompt when edit is clicked', () => {
      const onEdit = vi.fn();
      const prompt = makePrompt({ id: 'p1', body: 'Edit me' });
      render(
        <QueuedPromptsBar
          prompts={[prompt]}
          onSendNow={vi.fn()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      );
      fireEvent.click(screen.getByTestId('edit-prompt-p1'));
      expect(onEdit).toHaveBeenCalledWith(prompt);
    });
  });

  describe('Remove button', () => {
    it('calls onRemove with prompt id when remove is clicked', () => {
      const onRemove = vi.fn();
      const prompts = [makePrompt({ id: 'p1' })];
      render(
        <QueuedPromptsBar
          prompts={prompts}
          onSendNow={vi.fn()}
          onEdit={vi.fn()}
          onRemove={onRemove}
        />
      );
      fireEvent.click(screen.getByTestId('remove-prompt-p1'));
      expect(onRemove).toHaveBeenCalledWith('p1');
    });
  });

  describe('Dividers', () => {
    it('shows divider between prompts but not after last', () => {
      const prompts = [
        makePrompt({ id: 'p1' }),
        makePrompt({ id: 'p2' }),
        makePrompt({ id: 'p3' }),
      ];
      const { container } = render(
        <QueuedPromptsBar prompts={prompts} {...defaultHandlers} />
      );
      const hrs = container.querySelectorAll('hr');
      expect(hrs.length).toBe(2); // 3 items = 2 dividers
    });

    it('shows no divider for single prompt', () => {
      const prompts = [makePrompt({ id: 'p1' })];
      const { container } = render(
        <QueuedPromptsBar prompts={prompts} {...defaultHandlers} />
      );
      const hrs = container.querySelectorAll('hr');
      expect(hrs.length).toBe(0);
    });
  });
});
